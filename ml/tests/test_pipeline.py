import base64
import io
import json
import random
import tempfile
import unittest
from pathlib import Path
from PIL import Image
from diary_verifier.common import context_text, write_jsonl, read_jsonl
from diary_verifier.prepare import convert_records, split_groups
from diary_verifier.evaluate import metrics, prediction_map, paired_bootstrap


def fixture(index, event=None):
    buffer=io.BytesIO()
    Image.new('RGB',(8,8),(index*20%256,100,150)).save(buffer,format='PNG')
    return {'id':f'review-{index}','record':{'id':event or f'event-{index}','confirmed':True,'scene':'A가 자전거를 탄다.','people':[{'alias':'A','name':'나','visual':'파란 옷'}]},
            'imageProvenance':{'kind':'uploaded_generated','model':'SOFTWARE-TEST-FIXTURE'},'humanSource':'manual_review','image':'data:image/png;base64,'+base64.b64encode(buffer.getvalue()).decode(),
            'facts':[{'id':'fact-1','text':'A가 자전거를 탄다.','kind':'actor_action'}],'humanLabels':{'fact-1':'supported'}}


class PipelineTests(unittest.TestCase):
    def test_reject_demonstrations_and_missing_labels(self):
        with tempfile.TemporaryDirectory() as out:
            example=fixture(1);example['imageProvenance']['kind']='example'
            with self.assertRaises(ValueError):convert_records([example],out)
            example=fixture(1);example['humanLabels']={}
            with self.assertRaises(ValueError):convert_records([example],out)

    def test_groups_connect_same_event_and_same_image_and_edit_parent(self):
        with tempfile.TemporaryDirectory() as out:
            a,b,c=fixture(1,'same'),fixture(2,'same'),fixture(3)
            d=fixture(4);d['image']=c['image']
            e=fixture(5);e['imageProvenance']['originImageId']='review-2'
            rows=convert_records([a,b,c,d,e,fixture(6),fixture(7)],out)
            split=split_groups(rows)
            location={row['source_record_id']:name for name,rs in split.items() for row in rs}
            self.assertEqual(location['review-1'],location['review-2'])
            self.assertEqual(location['review-2'],location['review-5'])
            self.assertEqual(location['review-3'],location['review-4'])
            sets=[{row['image_sha256'] for row in rs} for rs in split.values()]
            self.assertTrue(all(not sets[i]&sets[j] for i in range(3) for j in range(i)))
            self.assertEqual(json.dumps(split,sort_keys=True),json.dumps(split_groups(rows),sort_keys=True))

    def test_conflicting_human_labels_are_not_silently_overwritten(self):
        with tempfile.TemporaryDirectory() as out:
            a,b=fixture(1),fixture(1);b['humanLabels']['fact-1']='contradicted'
            with self.assertRaises(ValueError):convert_records([a,b],out)

    def test_no_training_without_independent_groups(self):
        with tempfile.TemporaryDirectory() as out:
            with self.assertRaises(ValueError):split_groups(convert_records([fixture(1)],out))

    def test_gold_label_cannot_leak_into_model_prompt(self):
        text=context_text({'scene':'公園','characters':'A=blue','humanLabels':{'SECRET':'contradicted'}},{'text':'A is sitting','label':'contradicted'})
        self.assertNotIn('SECRET',text);self.assertNotIn('contradicted',text)

    def test_complete_paired_evaluation_and_unknowns(self):
        examples=[{'id':'i','group_id':'g1','image':'x','facts':[{'id':'f1','text':'x','label':'contradicted','kind':'actor_action'},{'id':'f2','text':'y','label':'uncertain'}]},
                  {'id':'j','group_id':'g2','image':'z','facts':[{'id':'f1','text':'z','label':'supported'}]}]
        rows=[{'example_id':e['id'],'fact_id':f['id'],'label':'supported','model':'fixture','backend':'fixture','error':None} for e in examples for f in e['facts']]
        predictions=prediction_map(rows,examples)
        result=metrics(examples,predictions)
        self.assertEqual(result['error_image_false_pass_rate'],1)
        self.assertEqual(result['error_fact_recall'],0)
        self.assertEqual(result['normal_image_false_alarm_rate'],0)
        with self.assertRaises(ValueError):prediction_map(rows[:-1],examples)
        with self.assertRaises(ValueError):prediction_map(rows+[rows[0]],examples)
        self.assertEqual(paired_bootstrap(examples,predictions,predictions,20)['macro_f1_difference_ci95'],[0,0])

    def test_real_autograd_for_same_claim_contrastive_loss(self):
        import torch
        from diary_verifier.losses import verification_loss,paired_batches
        logits=torch.zeros((2,3),requires_grad=True)
        targets=torch.tensor([0,1])
        loss,details=verification_loss(logits,targets,['same','same'],.5)
        self.assertEqual(details['pairs'],1)
        loss.backward()
        self.assertTrue(torch.isfinite(logits.grad).all())
        self.assertLess(logits.grad[0,0],-1/3)
        self.assertGreater(logits.grad[1,0],1/6)
        examples=[({'group_id':'g'},{'text':'same','label':label}) for label in ['supported','contradicted','uncertain']]
        batches=paired_batches(examples,2,random.Random(42))
        self.assertEqual(sorted(i for batch in batches for i in batch),[0,1,2])
        self.assertIn([0,1],batches)
        with self.assertRaises(ValueError):paired_batches(examples,1,random.Random())

    def test_local_service_declares_real_model_provenance(self):
        from diary_verifier.serve import create_service
        class Stub:
            adapter='TEST-ONLY-NOT-A-TRAINED-MODEL';base_model='fixture';trained=False
        schema=create_service(Stub()).openapi()
        self.assertIn('/verify',schema['paths']);self.assertIn('/health',schema['paths'])


if __name__=='__main__':unittest.main()
