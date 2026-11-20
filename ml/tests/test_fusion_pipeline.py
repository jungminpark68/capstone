import contextlib
import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path
import torch
from PIL import Image
from diary_verifier.common import write_jsonl,read_jsonl,context_text,file_sha
from diary_verifier.shared_encoder import EncoderSpec,EncodedText,FactFusionHead
from diary_verifier.fusion_features import ImageEncoderSpec,FeatureCache,encoder_bundle,extract_features,canonical_sha
from diary_verifier.fusion_train import train_fusion
from diary_verifier.fusion_model import FusionCheckpoint,FusionVerifier
from diary_verifier.fusion_predict import predict_cached
from diary_verifier.losses import verification_loss,claim_key


class FixtureTextEncoder:
    def __init__(self,tokens=True):
        self.spec=EncoderSpec('SOFTWARE-TEST-TEXT','fixture-v1',8,8 if tokens else 0,'mean',1024,tokens)
    def encode(self,texts):
        # Deterministic test doubles, not meaningful Korean embeddings or model evaluation data.
        vectors=[]
        for text in texts:
            generator=torch.Generator().manual_seed(int(hashlib.sha256(text.encode()).hexdigest()[:8],16))
            vectors.append(torch.randn(4,8,generator=generator))
        tokens=torch.stack(vectors)
        return EncodedText(tokens.mean(1),tokens if self.spec.supports_tokens else None,torch.ones(len(texts),4,dtype=torch.bool) if self.spec.supports_tokens else None,self.spec)


class FixtureImageEncoder:
    spec=ImageEncoderSpec('SOFTWARE-TEST-IMAGE','fixture-v1',6,'fixture-processor')
    def encode(self,images):
        return torch.stack([torch.tensor(list(image.getpixel((0,0)))*4,dtype=torch.float32).reshape(2,6)/255 for image in images])


def make_fixture(root,tokens=True):
    data=root/'data';data.mkdir()
    rows=[]
    for index,(group,label) in enumerate([('train','supported'),('train','contradicted'),('train','uncertain'),('dev','supported'),('dev','uncertain'),('test','contradicted')]):
        path=data/f'image-{index}.png';Image.new('RGB',(8,8),(30+index*25,100,170)).save(path)
        rows.append({'id':f'image-{index}','group_id':group,'event_id':group,'image':path.name,'image_sha256':file_sha(path),'scene':'A가 자전거를 탄다.','characters':'A=파란 옷','facts':[{'id':'f1','text':'A가 자전거를 탄다.','kind':'actor_action','label':label}]})
    for group in ('train','dev','test'):write_jsonl(data/f'{group}.jsonl',[row for row in rows if row['group_id']==group])
    (data/'dataset-info.json').write_text(json.dumps({'data_purpose':'software_test_fixture'}))
    text,image=FixtureTextEncoder(tokens),FixtureImageEncoder()
    cache=FeatureCache(root/'features',encoder_bundle(text.spec,image.spec))
    for group in ('train','dev','test'):extract_features(data/f'{group}.jsonl',cache,text,image)
    return data,cache


class FusionPipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):torch.set_num_threads(2)

    def test_cache_does_not_encode_gold_labels(self):
        with tempfile.TemporaryDirectory() as temp:
            data,cache=make_fixture(Path(temp))
            example=read_jsonl(data/'train.jsonl')[0];fact=example['facts'][0]
            stored=cache.load('texts',cache.key_for_text(example,fact))
            self.assertNotIn('label',stored)
            changed={**fact,'label':'contradicted'}
            self.assertEqual(cache.key_for_text(example,fact),cache.key_for_text(example,changed))
            self.assertNotIn('supported',context_text(example,fact))

    def test_actual_head_training_save_load_and_complete_prediction(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);data,cache=make_fixture(root)
            with contextlib.redirect_stdout(io.StringIO()):config=train_fusion(data,cache.root,root/'head',epochs=2,batch_size=2,hidden=16,heads=2,device='cpu')
            self.assertTrue(config['weights_learned']);self.assertFalse(config['encoders_finetuned']);self.assertFalse(config['test_used_for_selection'])
            self.assertEqual(config['data_purpose'],'software_test_fixture')
            self.assertEqual(len(json.loads((root/'head/history.json').read_text())),2)
            with self.assertRaises(ValueError):FusionCheckpoint(root/'head')
            with self.assertRaises(ValueError):FusionVerifier(root/'head')
            model=FusionCheckpoint(root/'head',allow_software_fixture=True)
            example=read_jsonl(data/'test.jsonl')[0];batch=cache.batch([(example,example['facts'][0])])
            probabilities=model.probabilities(*batch)
            self.assertAlmostEqual(sum(probabilities[0]),1,places=5)
            rows=predict_cached(data/'test.jsonl',cache.root,root/'head',root/'predictions.jsonl',allow_software_fixture=True)
            self.assertEqual(rows[0]['backend'],'software_test_fixture_fusion')
            self.assertEqual(rows[0]['manifest_sha256'],file_sha(data/'test.jsonl'))
            self.assertEqual(rows[0]['latency_scope'],'cached_features_plus_fusion_head')

    def test_sentence_only_external_embedding_does_not_need_original_tokens(self):
        with tempfile.TemporaryDirectory() as temp:
            data,cache=make_fixture(Path(temp),tokens=False)
            example=read_jsonl(data/'train.jsonl')[0];text,patches,mask=cache.batch([(example,example['facts'][0])])
            self.assertIsNone(text.tokens)
            head=FactFusionHead(cache.text_spec,6,16,2,text_mode='sentence')
            self.assertEqual(tuple(head(text,patches,mask).shape),(1,3))
            with self.assertRaises(ValueError):FactFusionHead(cache.text_spec,6,text_mode='tokens')

    def test_encoder_fingerprint_change_rejects_old_head(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);data,cache=make_fixture(root)
            with contextlib.redirect_stdout(io.StringIO()):train_fusion(data,cache.root,root/'head',epochs=1,batch_size=2,hidden=16,heads=2,device='cpu')
            model=FusionCheckpoint(root/'head',allow_software_fixture=True)
            changed=json.loads(json.dumps(cache.bundle));changed['text']['revision']='new-matching-model'
            other=FeatureCache(root/'new-cache',changed)
            with self.assertRaises(ValueError):model.check_cache(other)

    def test_shared_alias_with_changed_character_is_not_a_contrastive_claim(self):
        # A prompt family may share "A rides" but A can refer to different people.
        fact={'text':'A가 자전거를 탄다.'}
        grandmother={'group_id':'family','scene':'공원에서 자전거 타기','characters':'A=할머니, 보라색 옷'}
        granddaughter={**grandmother,'characters':'A=손녀, 노란색 옷'}
        keys=[claim_key(grandmother,fact),claim_key(granddaughter,fact)]
        self.assertNotEqual(*keys)
        _,detail=verification_loss(torch.randn(2,3),torch.tensor([0,1]),keys)
        self.assertEqual(detail['pairs'],0)

    def test_live_frozen_inference_features_can_train_a_head(self):
        spec=EncoderSpec('fixture','v1',8,8,'mean',32)
        with torch.inference_mode():
            text=EncodedText(torch.randn(2,8),torch.randn(2,3,8),torch.ones(2,3,dtype=torch.bool),spec)
            image=torch.randn(2,4,6)
        for mode in ('sentence','tokens'):
            head=FactFusionHead(spec,6,16,2,text_mode=mode)
            head(text,image).sum().backward()
            self.assertTrue(torch.isfinite(head.text_projection.weight.grad).all())

    def test_new_manifest_requires_recache_and_train_dev_leak_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);data,cache=make_fixture(root)
            train=read_jsonl(data/'train.jsonl');write_jsonl(data/'dev.jsonl',[train[0]])
            with self.assertRaises(ValueError):train_fusion(data,cache.root,root/'head',epochs=1,batch_size=2,hidden=16,heads=2,device='cpu')
            with self.assertRaises(ValueError):cache.assert_manifest(data/'dev.jsonl')


if __name__=='__main__':unittest.main()
