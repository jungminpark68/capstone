"""Draft suggestions are separate from confirmed gold, and test images stay blind."""
import csv
import json
import tempfile
import unittest
from pathlib import Path
from diary_verifier.synthetic import create_dataset,make_example
from diary_verifier.common import read_jsonl,write_jsonl
from diary_verifier.free_diary_data import review_template,save_review,prepare_reviewed
from diary_verifier.draft_labels import ensure_registry,generate_drafts,suggestions

class FixtureVerifier:
    calls=0
    def __init__(self,**kwargs):pass
    def encode(self,items,root):return items
    def probabilities(self,batch):
        type(self).calls+=1
        return [[.1,.8,.1]]

class DraftTests(unittest.TestCase):
    def test_drafts_review_resume_blinding_and_fixed_export(self):
        import shutil
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            create_dataset(root/'fixture',events=6)
            source=root/'source';source.mkdir()
            shutil.copytree(root/'fixture/images',source/'images')
            rows=sum([read_jsonl(root/'fixture'/(s+'.jsonl')) for s in ('train','dev','test')],[])
            for row in rows:
                for fact in row['facts']:fact['label']=None
            write_jsonl(source/'generated-manifest.jsonl',rows)
            (source/'generator-settings.json').write_text(json.dumps({'source':'local_sdxl','model':'software-fixture'}))
            review_template(source)
            FixtureVerifier.calls=0
            generate_drafts(source,model='fixture',factory=FixtureVerifier,resolver=lambda _: 'a'*40)
            registry=ensure_registry(source);old_events=dict(registry['events'])
            drafts=suggestions(source)
            self.assertTrue(drafts)
            test_ids={r['id'] for r in rows if registry['events'][r['event_id']]=='test'}
            self.assertFalse(test_ids&{key[0] for key in drafts})
            with (source/'human-review.csv').open(encoding='utf-8-sig',newline='') as stream:
                self.assertTrue(all(not r['label'] for r in csv.DictReader(stream)))
            calls=FixtureVerifier.calls
            generate_drafts(source,model='fixture',factory=FixtureVerifier,resolver=lambda _: 'b'*40)
            self.assertEqual(FixtureVerifier.calls,calls)
            with self.assertRaisesRegex(ValueError,'Reviewer'):
                save_review(source,rows[0]['id'],{},'')
            for image in rows:
                save_review(source,image['id'],{f['id']:'supported' for f in image['facts']},'tester')
            with (source/'human-review.csv').open(encoding='utf-8-sig',newline='') as stream:
                reviews=list(csv.DictReader(stream))
            assisted=next(r for r in reviews if r['image_id'] not in test_ids)
            self.assertEqual(assisted['draft_label'],'contradicted')
            self.assertEqual(assisted['label'],'supported')
            self.assertEqual(assisted['review_mode'],'assisted')
            blind=next(r for r in reviews if r['image_id'] in test_ids)
            self.assertEqual(blind['draft_label'],'');self.assertEqual(blind['review_mode'],'blind')
            info=prepare_reviewed(source,root/'ready')
            for split in ('train','dev','test'):
                for row in read_jsonl(root/'ready'/(split+'.jsonl')):
                    self.assertEqual(registry['events'][row['event_id']],split)
            extra=make_example(99991,'correct',source/'images','added-event')
            write_jsonl(source/'generated-manifest.jsonl',rows+[extra])
            updated=ensure_registry(source)
            self.assertEqual({k:updated['events'][k] for k in old_events},old_events)
            # A draft must not survive a changed source fact.
            extra_rows=read_jsonl(source/'generated-manifest.jsonl')
            extra_rows[0]['facts'][0]['text']='changed'
            write_jsonl(source/'generated-manifest.jsonl',extra_rows)
            with self.assertRaisesRegex(ValueError,'source facts changed'):ensure_registry(source)

if __name__=='__main__':unittest.main()
