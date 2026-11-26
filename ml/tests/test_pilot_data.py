"""Pilot software checks; fixture labels/predictions are not human gold or model scores."""
import ast
import base64
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

from diary_verifier.common import file_sha, read_jsonl, write_jsonl
from diary_verifier.pilot_data import make_source, prepare_reviewed, load_source, SOURCE_SCHEMA, REVIEW_SCHEMA
from diary_verifier.vlm_benchmark import create_plan, develop, final_test

ROOT = Path(__file__).resolve().parents[2]
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=')


def fixture(root):
    raw = root / 'raw'
    (raw / 'images').mkdir(parents=True)
    rows = []
    for n in range(20):
        p = raw / f'images/{n}.png'
        p.write_bytes(PNG + str(n).encode())
        rows.append({'id':f'image-{n}', 'event_id':f'event-{n//2}', 'group_id':f'event-{n//2}',
                     'image':f'images/{n}.png', 'image_sha256':file_sha(p), 'scene':'소프트웨어 시험용 사건',
                     'characters':'A: 시험용 인물', 'generation':{'kind':'uploaded_generated','source':'software-test-fixture'},
                     'facts':[{'id':f'f-{i}', 'text':f'시험 사실 {i}', 'kind':'object', 'label':None,
                               'draft_label':'supported', 'draft_reason':'소프트웨어 시험용 임의 답'} for i in range(8)]})
    write_jsonl(raw / 'manifest.jsonl', rows)
    source = make_source(raw / 'manifest.jsonl', root / 'source')
    return source


def review(root, source):
    value = {'schema':REVIEW_SCHEMA,'dataset_id':source['dataset_id'],'reviews':[]}
    for item in source['items']:
        value['reviews'].append({'image_id':item['id'], 'image_sha256':item['image_sha256'],
                                 'confirmed_by_human':True, 'reviewer':'software-fixture-only',
                                 'review_mode':'blind' if source['groups'][item['group_id']]=='test' else 'assisted',
                                 'labels':{f['id']:['supported','contradicted','uncertain'][i%3] for i,f in enumerate(item['facts'])}})
    path = root / 'review.json'
    path.write_text(json.dumps(value))
    return path, value


class PilotDataTests(unittest.TestCase):
    def test_fixed_group_source_strips_test_hints_and_generation_intentions(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder);source = fixture(root)
            self.assertEqual(source['schema'], SOURCE_SCHEMA)
            counts = {s:sum(source['groups'][r['group_id']]==s for r in source['items']) for s in ['train','dev','test']}
            self.assertEqual(counts, {'train':12,'dev':4,'test':4})
            for row in source['items']:
                self.assertNotIn('planned_variant', row)
                self.assertTrue(all('label' not in f for f in row['facts']))
                if source['groups'][row['group_id']]=='test':
                    self.assertTrue(all('draft_label' not in f and 'draft_reason' not in f for f in row['facts']))
            self.assertEqual(load_source(root/'source/pilot-source.json'),source)

    def test_machine_drafts_and_partial_reviews_never_become_labels(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);source=fixture(root);path,value=review(root,source)
            value['reviews'].pop();path.write_text(json.dumps(value))
            with self.assertRaisesRegex(ValueError,'Complete all 20'):prepare_reviewed(root/'source/pilot-source.json',path,root/'ready')
            self.assertFalse((root/'ready').exists())

    def test_software_review_cannot_be_used_as_human_training_data(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);source=fixture(root);path,value=review(root,source)
            value['software_test_only']=True;path.write_text(json.dumps(value))
            with self.assertRaisesRegex(ValueError,'not human training labels'):prepare_reviewed(root/'source/pilot-source.json',path,root/'ready')

    def test_default_three_conditions_remain_available(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);source=fixture(root);path,_=review(root,source)
            data=root/'ready';prepare_reviewed(root/'source/pilot-source.json',path,data)
            plan=create_plan(data,root/'experiment',['fixture/base'],resolver=lambda _:'a'*40)
            self.assertEqual(json.loads(plan.read_text())['methods'],['plain','relation'])
            with self.assertRaisesRegex(ValueError,'without duplicates'):create_plan(data,root/'bad',['fixture/base'],resolver=lambda _:'a'*40,methods=['plain','plain'])
            single=create_plan(data,root/'single',['fixture/base'],resolver=lambda _:'a'*40,methods=['plain'],batch_size=1,pair_weight=0)
            self.assertEqual(json.loads(single.read_text())['settings']['batch_size'],1)
            with self.assertRaisesRegex(ValueError,'Relation training needs'):create_plan(data,root/'bad-relation',['fixture/base'],resolver=lambda _:'a'*40,methods=['relation'],batch_size=1)

    def test_source_and_image_fingerprints_are_enforced(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);source=fixture(root);path,_=review(root,source)
            source_path=root/'source/pilot-source.json'
            tampered=json.loads(source_path.read_text());tampered['items'][0]['scene']='바뀐 사건';source_path.write_text(json.dumps(tampered))
            with self.assertRaisesRegex(ValueError,'fingerprint changed'):prepare_reviewed(source_path,path,root/'ready')
            source_path.write_text(json.dumps(source));(root/'source'/source['items'][0]['image']).write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'image changed'):prepare_reviewed(source_path,path,root/'ready')

    def test_wrong_dataset_unconfirmed_blindness_and_label_coverage(self):
        for mutation,reason in [
            (lambda v:v.update(dataset_id='wrong'),'different pilot'),
            (lambda v:v['reviews'][0].update(confirmed_by_human=False),'human confirmation'),
            (lambda v:v['reviews'][0]['labels'].pop('f-0'),'Every fact'),
            (lambda v:v['reviews'].append(v['reviews'][0]),'Duplicate reviewed'),
        ]:
            with self.subTest(reason=reason),tempfile.TemporaryDirectory() as folder:
                root=Path(folder);source=fixture(root);path,value=review(root,source);mutation(value);path.write_text(json.dumps(value))
                with self.assertRaisesRegex(ValueError,reason):prepare_reviewed(root/'source/pilot-source.json',path,root/'ready')
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);source=fixture(root);path,value=review(root,source)
            target=next(r for r in value['reviews'] if source['groups'][next(i['group_id'] for i in source['items'] if i['id']==r['image_id'])]=='test')
            target['review_mode']='assisted';path.write_text(json.dumps(value))
            with self.assertRaisesRegex(ValueError,'without suggestions'):prepare_reviewed(root/'source/pilot-source.json',path,root/'ready')

    def test_prepare_preserves_fixed_splits_and_reports_real_label_counts(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);source=fixture(root);path,_=review(root,source)
            info=prepare_reviewed(root/'source/pilot-source.json',path,root/'ready')
            self.assertTrue(info['pilot_only']);self.assertEqual(info['splits']['train']['facts'],96)
            parts={name:read_jsonl(root/'ready'/(name+'.jsonl')) for name in ['train','dev','test']}
            for name,rows in parts.items():
                for row in rows:
                    self.assertEqual(source['groups'][row['group_id']],name)
                    self.assertEqual(file_sha(root/'ready'/row['image']),row['image_sha256'])
                    self.assertTrue(all('draft_label' not in f for f in row['facts']))
            self.assertEqual(set(parts['train'][0]['facts'][i]['label'] for i in range(3)),{'supported','contradicted','uncertain'})

    def test_missing_training_class_does_not_get_fabricated(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);source=fixture(root);path,value=review(root,source)
            for row in value['reviews']:
                row['labels']={k:'supported' for k in row['labels']}
            path.write_text(json.dumps(value))
            with self.assertRaisesRegex(ValueError,'lack contradicted, uncertain'):prepare_reviewed(root/'source/pilot-source.json',path,root/'ready')

    def test_plain_only_protocol_uses_one_training_run_and_two_final_runs(self):
        with tempfile.TemporaryDirectory() as folder,contextlib.redirect_stdout(io.StringIO()):
            root=Path(folder);source=fixture(root);path,_=review(root,source)
            data=root/'ready';prepare_reviewed(root/'source/pilot-source.json',path,data)
            plan=create_plan(data,root/'experiment',['fixture/base'],resolver=lambda _: 'a'*40,methods=['plain'])
            calls=[]
            def runner(*args):
                calls.append(args)
                def arg(name):return args[args.index(name)+1]
                out=Path(arg('--out'))
                if args[0].endswith('.train'):
                    out.mkdir();(out/'adapter_model.safetensors').write_bytes(b'SOFTWARE FIXTURE NOT WEIGHTS')
                    config={'base_model':arg('--base-model'),'revision':arg('--revision'),'pair_weight':arg('--pair-weight'),
                            'train_sha256':file_sha(data/'train.jsonl'),'dev_sha256':file_sha(data/'dev.jsonl')}
                    (out/'verifier_config.json').write_text(json.dumps(config));(out/'training-complete.json').write_text('{}')
                else:
                    manifest=Path(arg('--manifest'))
                    values=[{'example_id':r['id'],'fact_id':f['id'],'label':'supported','model':'fixture-only','backend':'software_test_fixture_vlm',
                             'manifest_sha256':file_sha(manifest),'error':None} for r in read_jsonl(manifest) for f in r['facts']]
                    write_jsonl(out,values)
            develop(plan,runner)
            self.assertEqual(len([c for c in calls if c[0].endswith('.train')]),1)
            self.assertTrue(all(Path(c[c.index('--manifest')+1]).name!='test.jsonl' for c in calls if '--manifest' in c))
            report=final_test(plan,runner)
            self.assertEqual(set(report['runs']),{'pretrained','plain'})
            self.assertEqual(report['scope'],'software_test_fixture_only')
            with self.assertRaisesRegex(ValueError,'development is sealed'):develop(plan,runner)

    def test_notebook_syntax_and_default_never_run_final_test(self):
        spec=importlib.util.spec_from_file_location('pilot_builder',ROOT/'scripts/package-verifier-pilot.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        book=module.notebook()
        self.assertTrue(book['metadata']['memory_connect']['self_contained'])
        self.assertFalse(book['metadata']['memory_connect']['contains_trained_results'])
        text=''
        for cell in book['cells']:
            if cell['cell_type']=='code':
                ast.parse(''.join(cell['source']));self.assertFalse(cell['outputs']);text+=''.join(cell['source'])
        self.assertIn('METHODS=["plain"]',text);self.assertIn('RUN_FINAL_TEST=False',text)
        self.assertIn('prepare_reviewed(SOURCE,REVIEWS,DATA)',text)
        self.assertNotIn('DATA_MODE="schematic"',text)


if __name__=='__main__':unittest.main()
