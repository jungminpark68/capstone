"""A trained local verifier backed by frozen, replaceable encoders."""
import json
from pathlib import Path
import torch
from . import LABELS
from .common import context_text,file_sha
from .shared_encoder import EncoderSpec,EncodedText,FactFusionHead,HuggingFaceTextEncoder
from .fusion_features import ImageEncoderSpec,SiglipPatchEncoder,encoder_bundle,canonical_sha


class FusionCheckpoint:
    def __init__(self,path,device='cpu',allow_software_fixture=False):
        self.path=Path(path)
        self.config=json.loads((self.path/'fusion_config.json').read_text())
        c=self.config
        if c.get('architecture')!='shared_encoder_fact_fusion' or c.get('labels')!=list(LABELS) or not c.get('weights_learned'):
            raise ValueError('Not a learned fusion checkpoint')
        self.trained=c.get('data_purpose')=='collected_human_reviewed_data'
        if not self.trained and not allow_software_fixture:
            raise ValueError('Software-test or untrained weights cannot be served as a real verifier')
        if file_sha(self.path/'fusion_head.pt')!=c['weights_sha256']:raise ValueError('Checkpoint weights changed or are incomplete')
        self.text_spec=EncoderSpec(**c['encoders']['text'])
        self.image_spec=ImageEncoderSpec(**c['encoders']['image'])
        self.head=FactFusionHead(self.text_spec,self.image_spec.patch_dim,c['hidden'],c['heads'],text_mode=c['text_mode'],fusion_method=c.get('fusion_method','cross_attention')).to(device)
        self.head.load_state_dict(torch.load(self.path/'fusion_head.pt',map_location=device,weights_only=True),strict=True)
        self.head.eval()
        self.model_id='fusion:'+c['weights_sha256'][:16]

    def check_cache(self,cache):
        if cache.fingerprint!=canonical_sha(self.config['encoders']):raise ValueError('This checkpoint was trained with different text/image encoders')

    @torch.inference_mode()
    def probabilities(self,text,patches,image_mask=None):
        return self.head(text,patches,image_mask).softmax(-1).cpu().tolist()


class FusionVerifier:
    """The matching team's TextEncoder can be injected without changing the head API."""
    backend_mode='local_fusion'
    training_scope='fusion_head_only_frozen_encoders'

    def __init__(self,checkpoint,device=None,model_cache=None,text_encoder=None,image_encoder=None):
        device=device or ('cuda' if torch.cuda.is_available() else 'cpu')
        self.checkpoint=FusionCheckpoint(checkpoint,device)
        self.trained=self.checkpoint.trained
        self.adapter=self.checkpoint.model_id
        self.base_model='BGE/SigLIP-compatible encoder fusion'
        text,image=self.checkpoint.text_spec,self.checkpoint.image_spec
        self.text_encoder=text_encoder or HuggingFaceTextEncoder(text.model_id,revision=text.revision,pooling=text.pooling,max_tokens=text.max_tokens,device=device,cache_dir=model_cache)
        self.image_encoder=image_encoder or SiglipPatchEncoder(image.model_id,revision=image.revision,device=device,cache_dir=model_cache)
        if self.text_encoder.spec.fingerprint!=text.fingerprint or self.image_encoder.spec.fingerprint!=image.fingerprint:
            raise ValueError('Encoder changed. Replace/retrain the connection head before serving.')

    def predict_features(self,text:EncodedText,image_patches,image_mask=None):
        return self.checkpoint.probabilities(text,image_patches,image_mask)

    def verify_image(self,image,scene,characters,facts):
        # Encode the image once, rather than once for every fact.
        patches=self.image_encoder.encode([image])
        results=[]
        for fact in facts:
            example={'scene':scene,'characters':characters}
            text=self.text_encoder.encode([context_text(example,fact)])
            probabilities=self.predict_features(text,patches)[0]
            label=LABELS[max(range(3),key=probabilities.__getitem__)]
            results.append({'factId':fact['id'],'label':label,'reason':'자체 학습한 문장–이미지 연결 모듈의 판정입니다. 근거 영역 설명과 확률 보정은 별도 검증이 필요합니다.'})
        return results
