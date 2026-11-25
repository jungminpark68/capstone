"""Software tests only; generated fixtures are never research performance data."""
import ast
import base64
import contextlib
import hashlib
import io
import json
import os
import subprocess
import shutil
import tempfile
import unittest
from unittest.mock import patch
import zipfile
from pathlib import Path
import torch
from PIL import Image
from diary_verifier.batch_verify import request_fingerprint,validate_request,batch_verify
from diary_verifier.fusion_train import train_fusion
from diary_verifier.fusion_model import FusionCheckpoint
from diary_verifier.fusion_predict import predict_cached
from diary_verifier.evaluate import compare_runs
from diary_verifier.experiment import experiment
from test_fusion_pipeline import make_fixture

ROOT=Path(__file__).resolve().parents[1]

class SoftwareVerifier:
    trained=True
    backend_mode='local_fusion'
    adapter='SOFTWARE-TEST-DOUBLE'
    training_scope='fusion_head_only_frozen_encoders'
    def verify_image(self,image,scene,characters,facts):return [{'factId':f['id'],'label':'uncertain','reason':'소프트웨어 연결 시험용 응답'} for f in facts]

def request_fixture():
    buffer=io.BytesIO();Image.new('RGB',(8,8),'green').save(buffer,format='PNG');raw=buffer.getvalue()
    item={'recordId':'event-software-test','imageSha256':hashlib.sha256(raw).hexdigest(),'scene':'A가 자전거를 탄다.','characters':'A: 노란 옷','facts':[{'id':'fact-1','text':'A가 자전거를 탄다.','kind':'actor_action'}],'image':'data:image/png;base64,'+base64.b64encode(raw).decode()}
    item['requestFingerprint']=request_fingerprint(item);return item

class IntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):torch.set_num_threads(2)

    @unittest.skipUnless((ROOT.parent/'public/diary-verification.js').is_file() and shutil.which('node'),'App interoperability check requires the separate web-app package and Node')
    def test_javascript_request_is_verified_by_python(self):
        fixture=request_fixture()
        script="""import {diaryCheckRequest} from './public/diary-verification.js';import {exampleRecord} from './public/lab-samples.js';let data='';for await(const chunk of process.stdin)data+=chunk;console.log(JSON.stringify(await diaryCheckRequest({image:JSON.parse(data).image,sceneRecord:exampleRecord})));"""
        process=subprocess.run(['node','--input-type=module','-e',script],cwd=ROOT.parent,input=json.dumps(fixture),text=True,capture_output=True,check=True)
        item=json.loads(process.stdout);image=validate_request(item)
        self.assertEqual(image.size,(8,8));self.assertEqual(request_fingerprint(item),item['requestFingerprint'])
        item['facts'][0]['text']='그림과 다른 사실'
        with self.assertRaisesRegex(ValueError,'fingerprint'):validate_request(item)

    def test_batch_has_binding_and_never_accepts_untrained_weights(self):
        item=request_fixture()
        with tempfile.TemporaryDirectory() as temp:
            value=batch_verify([item],SoftwareVerifier(),Path(temp)/'predictions.json')
            self.assertEqual(value['items'][0]['requestFingerprint'],item['requestFingerprint'])
            self.assertEqual(value['items'][0]['results'][0]['label'],'uncertain')
            verifier=SoftwareVerifier();verifier.trained=False
            with self.assertRaisesRegex(ValueError,'human-reviewed'):batch_verify([item],verifier,Path(temp)/'invalid.json')
        item['imageSha256']='0'*64
        with self.assertRaisesRegex(ValueError,'hash mismatch'):validate_request(item)

    def test_pooled_and_attention_train_reload_and_produce_reports(self):
        with tempfile.TemporaryDirectory() as temp,contextlib.redirect_stdout(io.StringIO()):
            root=Path(temp);data,cache=make_fixture(root);predictions=[]
            for method in ['pooled','cross_attention']:
                checkpoint=root/method
                config=train_fusion(data,cache.root,checkpoint,epochs=1,batch_size=2,hidden=16,heads=2,device='cpu',pair_weight=0,fusion_method=method)
                self.assertEqual(config['fusion_method'],method)
                with self.assertRaises(ValueError):FusionCheckpoint(checkpoint)
                path=root/(method+'.jsonl');predict_cached(data/'test.jsonl',cache.root,checkpoint,path,allow_software_fixture=True);predictions.append(path)
            report=compare_runs(data/'test.jsonl',predictions,root/'software-only.json',bootstrap=20)
            self.assertEqual(len(report['runs']),2)
            for suffix in ['json','html','csv','md']:self.assertTrue((root/('software-only.'+suffix)).is_file())
            self.assertIn('cross_attention minus pooled',report['paired_comparisons'])

    def test_notebooks_are_clean_and_code_zip_autodetection_works(self):
        notebook=json.loads((ROOT/'notebooks/memory_connect_verifier_kaggle.ipynb').read_text())
        for cell in notebook['cells']:
            if cell['cell_type']=='code':ast.parse(''.join(cell['source']));self.assertEqual(cell['outputs'],[])
        setup=''.join(next(c for c in notebook['cells'] if c['cell_type']=='code')['source'])
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);inputs=root/'input';inputs.mkdir()
            with zipfile.ZipFile(inputs/'memory-verifier-test.zip','w') as archive:
                archive.writestr('memory-verifier/ml/diary_verifier/fusion_train.py','# software fixture')
            source=setup.replace("Path('/kaggle/working/memory-verifier')",f'Path({str(root/"working")!r})').replace("Path('/kaggle/input')",f'Path({str(inputs)!r})')
            old={key:os.environ.get(key) for key in ['PYTHONPATH','HF_HOME']}
            try:
                values={}
                with contextlib.redirect_stdout(io.StringIO()):exec(compile(source,'notebook-setup','exec'),values)
                self.assertTrue((values['PROJECT']/'ml/diary_verifier/fusion_train.py').is_file())
            finally:
                for key,value in old.items():
                    if value is None:os.environ.pop(key,None)
                    else:os.environ[key]=value

    def test_experiment_runs_three_conditions_with_fixture_only_inference(self):
        with tempfile.TemporaryDirectory() as temp,contextlib.redirect_stdout(io.StringIO()):
            root=Path(temp);data,cache=make_fixture(root)
            def fixture_predict(*args,**kwargs):return predict_cached(*args,**kwargs,allow_software_fixture=True)
            with patch('diary_verifier.experiment.predict_cached',fixture_predict):
                value=experiment(data,cache.root,root/'experiment',device='cpu',epochs=1,batch_size=2,seeds=[42])
            self.assertTrue(value['relation_pairs_available'])
            self.assertTrue((root/'experiment/seed-summary.csv').is_file())
            report=json.loads((root/'experiment/comparison-seed42.json').read_text())
            self.assertEqual(report['scope'],'software_test_fixture_only')
            self.assertEqual(len(report['runs']),3)
            self.assertIn('relation-seed42 minus plain-seed42',report['paired_comparisons'])

if __name__=='__main__':unittest.main()
