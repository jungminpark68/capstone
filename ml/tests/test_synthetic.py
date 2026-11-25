"""Controlled-renderer invariants; no research accuracy is fabricated in these tests."""
import ast
import contextlib
import hashlib
import io
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
import torch
from diary_verifier.synthetic import CASE_LABELS,make_event,variant,truth_labels,make_example,create_dataset,always_supported_baseline,case_report
from diary_verifier.common import read_jsonl,context_text
from diary_verifier.fusion_features import FeatureCache,encoder_bundle,extract_features
from diary_verifier.fusion_train import train_fusion
from diary_verifier.fusion_model import FusionCheckpoint,FusionVerifier
from diary_verifier.evaluate import compare_runs
from test_fusion_pipeline import FixtureTextEncoder,FixtureImageEncoder

ML=Path(__file__).resolve().parents[1]

class SyntheticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):torch.set_num_threads(2)

    def test_variants_have_exact_fact_targets(self):
        for seed in range(12):
            expected=make_event(seed)
            self.assertEqual(truth_labels(expected,expected),['supported']*8)
            targets={'role_swap':[2,3],'wrong_place':[0],'extra_person':[1],'wrong_count':[5],'spatial_swap':[6],'wrong_color':[7]}
            for case,indices in targets.items():
                labels=truth_labels(expected,variant(expected,case))
                self.assertEqual([i for i,label in enumerate(labels) if label=='contradicted'],indices,(seed,case))
            hidden=truth_labels(expected,variant(expected,'occluded_objects'))
            self.assertEqual([i for i,label in enumerate(hidden) if label=='uncertain'],[5,7])
            actor_hidden=truth_labels(expected,variant(expected,'occluded_actor'))
            self.assertNotIn('contradicted',actor_hidden);self.assertIn('uncertain',actor_hidden)
            for case in ['missing_person','missing_object']:self.assertIn('contradicted',truth_labels(expected,variant(expected,case)))

    def test_generation_is_deterministic_and_images_are_real(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            first=make_example(42,'role_swap',root/'images');second=make_example(42,'role_swap',root/'images')
            self.assertEqual(first,second)
            path=root/first['image'];self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),first['image_sha256'])
            with Image.open(path) as image:self.assertEqual(image.size,(384,384));image.verify()

    def test_event_and_image_families_never_cross_splits(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);info=create_dataset(root,events=6)
            self.assertEqual(info['images'],6*len(CASE_LABELS));self.assertEqual(info['facts'],6*len(CASE_LABELS)*8)
            parts={name:read_jsonl(root/(name+'.jsonl')) for name in ['train','dev','test']}
            for name,rows in parts.items():
                self.assertEqual({f['label'] for row in rows for f in row['facts']},{'supported','contradicted','uncertain'})
                for other,values in parts.items():
                    if other!=name:
                        self.assertFalse({r['event_id'] for r in rows}&{r['event_id'] for r in values})
                        self.assertFalse({r['image_sha256'] for r in rows}&{r['image_sha256'] for r in values})
                for row in rows:
                    text=context_text(row,row['facts'][0]);self.assertNotIn('synthetic_actual',text);self.assertNotIn('synthetic_case',text);self.assertNotIn('supported',text)

    def test_synthetic_checkpoint_is_explicit_and_not_served_as_real(self):
        with tempfile.TemporaryDirectory() as temp,contextlib.redirect_stdout(io.StringIO()):
            root=Path(temp);data=root/'data';create_dataset(data,events=6)
            text,image=FixtureTextEncoder(),FixtureImageEncoder()
            cache=FeatureCache(root/'cache',encoder_bundle(text.spec,image.spec))
            for name in ['train','dev']:extract_features(data/(name+'.jsonl'),cache,text,image)
            with self.assertRaisesRegex(ValueError,'explicit synthetic'):train_fusion(data,cache.root,root/'rejected',epochs=1,pair_weight=0,hidden=16,heads=2)
            config=train_fusion(data,cache.root,root/'head',epochs=1,pair_weight=.25,hidden=16,heads=2,allow_synthetic=True,balanced=True)
            self.assertEqual(config['data_purpose'],'synthetic_controlled');self.assertEqual(len(config['class_weights']),3)
            with self.assertRaises(ValueError):FusionCheckpoint(root/'head')
            with self.assertRaises(ValueError):FusionCheckpoint(root/'head',allow_software_fixture=True)
            with self.assertRaises(ValueError):FusionVerifier(root/'head')
            checkpoint=FusionCheckpoint(root/'head',allow_synthetic=True)
            self.assertTrue(checkpoint.synthetic);self.assertFalse(checkpoint.trained)

    def test_constant_control_is_labelled_as_synthetic_not_learned_accuracy(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);create_dataset(root/'data',events=6);manifest=root/'data/test.jsonl'
            always_supported_baseline(manifest,root/'constant.jsonl')
            report=compare_runs(manifest,[root/'constant.jsonl'],root/'comparison.json',bootstrap=20)
            self.assertEqual(report['scope'],'synthetic_controlled_test_only')
            self.assertEqual(report['runs']['constant']['error_fact_recall'],0)
            self.assertEqual(report['runs']['constant']['error_image_false_pass_rate'],1)
            paths=case_report(manifest,[root/'constant.jsonl'],root/'by-case.json')
            self.assertTrue(Path(paths[0]).is_file());self.assertIn('규칙 정답',Path(paths[0]).read_text())

    def test_one_notebook_bundles_sources_and_creates_data_without_uploads(self):
        notebook=json.loads((ML/'notebooks/memory_connect_synthetic_kaggle.ipynb').read_text())
        cells=[c for c in notebook['cells'] if c['cell_type']=='code']
        for cell in cells:ast.parse(''.join(cell['source']));self.assertEqual(cell['outputs'],[])
        bundle=''.join(cells[1]['source']);tree=ast.parse(bundle)
        sources=ast.literal_eval(tree.body[0].value)
        for name,source in sources.items():self.assertEqual(source,(ML/name).read_text())
        self.assertTrue(notebook['metadata']['memory_connect']['self_contained'])
        combined=''.join(''.join(c['source']) for c in cells)
        self.assertNotIn('api.openai.com',combined);self.assertNotIn('DIARY_API_KEY',combined)
        with tempfile.TemporaryDirectory() as temp:
            work=Path(temp)/'lab'
            setup=''.join(cells[0]['source']).replace('Path("/kaggle/working/memory-synthetic")',f'Path({str(work)!r})')
            setup=setup.replace('N_EVENTS=30','N_EVENTS=6')
            script=setup+'\n'+bundle+'\nrun("diary_verifier.synthetic","--out",DATA,"--events",str(N_EVENTS),"--seed",str(DATA_SEED))\n'
            completed=subprocess.run([os.sys.executable,'-c',script],capture_output=True,text=True)
            self.assertEqual(completed.returncode,0,completed.stderr[-1500:])
            self.assertTrue((work/'synthetic-v1/data/dataset-info.json').is_file())

if __name__=='__main__':unittest.main()
