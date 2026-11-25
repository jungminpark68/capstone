"""Local VLM draft labels, never human gold. Test images remain blind."""
import argparse
import hashlib
import json
from pathlib import Path
from .common import read_jsonl, write_jsonl, file_sha, context_text, SYSTEM
from .free_diary_data import atomic_json

def ensure_registry(root):
    root=Path(root)
    path=root/'review-splits.json'
    registry=json.loads(path.read_text()) if path.exists() else {'version':1,'events':{},'images':{}}
    cycle=['train','train','dev','train','test','train','train','dev','train','test']
    for row in read_jsonl(root/'generated-manifest.jsonl'):
        event=row['event_id']
        if event not in registry['events']:
            registry['events'][event]=cycle[len(registry['events'])%len(cycle)]
        fingerprint=hashlib.sha256(json.dumps(
            [row['image_sha256'],[context_text(row,f) for f in row['facts']]],
            ensure_ascii=False).encode()).hexdigest()
        if row['id'] in registry['images'] and registry['images'][row['id']]!=fingerprint:
            raise ValueError('Registered image or source facts changed')
        if file_sha(root/row['image'])!=row['image_sha256']:raise ValueError('Image bytes changed')
        registry['images'][row['id']]=fingerprint
    atomic_json(path,registry)
    return registry

def suggestions(root,registry=None):
    root=Path(root)
    registry=registry or ensure_registry(root)
    path=root/'draft-labels.jsonl'
    lookup={}
    image_splits={r['id']:registry['events'][r['event_id']] for r in read_jsonl(root/'generated-manifest.jsonl')}
    for row in read_jsonl(path) if path.exists() else []:
        if row['fingerprint']!=registry['images'].get(row['image_id']):raise ValueError('Stale draft label')
        if row['split']=='test' or image_splits.get(row['image_id'])!=row['split']:raise ValueError('Test predictions or changed splits cannot be draft gold')
        key=(row['image_id'],row['fact_id'])
        if key in lookup:raise ValueError('Duplicate draft')
        lookup[key]=row
    return lookup

def generate_drafts(root,model='Qwen/Qwen3-VL-4B-Instruct',four_bit=True,max_pixels=200704,factory=None,resolver=None):
    from . import LABELS
    root=Path(root);registry=ensure_registry(root)
    settings_path=root/'draft-model.json'
    previous=json.loads(settings_path.read_text()) if settings_path.exists() else None
    if resolver is None:
        from .shared_encoder import checkpoint_revision
        resolver=checkpoint_revision
    revision=previous['revision'] if previous else resolver(model)
    settings={'model':model,'revision':revision,'four_bit':four_bit,'max_pixels':max_pixels,
              'system_prompt_sha256':hashlib.sha256(SYSTEM.encode()).hexdigest(),
              'purpose':'machine_draft_not_human_gold'}
    if previous and previous!=settings:raise ValueError('Draft model settings changed; preserve this dataset and use a new source version')
    atomic_json(settings_path,settings)
    known=suggestions(root,registry)
    pending=[row for row in read_jsonl(root/'generated-manifest.jsonl')
             if registry['events'][row['event_id']]!='test'
             and any((row['id'],f['id']) not in known for f in row['facts'])]
    if not pending:
        print('No new train/dev images; test images remain blind.');return
    if factory is None:
        from .model import LocalVerifier
        factory=LocalVerifier
    verifier=factory(base_model=model,revision=revision,four_bit=four_bit,max_pixels=max_pixels)
    rows=list(known.values())
    for image in pending:
        for fact in image['facts']:
            key=(image['id'],fact['id'])
            if key in known:continue
            probabilities=verifier.probabilities(verifier.encode([(image,fact)],root))[0]
            if len(probabilities)!=3 or any(not isinstance(p,(int,float)) or not 0<=p<=1 for p in probabilities):
                raise ValueError('Invalid draft model output')
            label=LABELS[max(range(3),key=probabilities.__getitem__)]
            row={'image_id':image['id'],'fact_id':fact['id'],'label':label,
                 'probabilities':dict(zip(LABELS,probabilities)),'probabilities_calibrated':False,
                 'fingerprint':registry['images'][image['id']],
                 'split':registry['events'][image['event_id']],'model':model,'revision':revision,
                 'status':'unreviewed_machine_draft'}
            rows.append(row);known[key]=row
        temporary=root/'draft-labels.tmp'
        write_jsonl(temporary,rows);temporary.replace(root/'draft-labels.jsonl')
        print('Draft complete:',image['id'],flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',required=True)
    p.add_argument('--model',default='Qwen/Qwen3-VL-4B-Instruct')
    p.add_argument('--four-bit',action='store_true')
    a=p.parse_args()
    generate_drafts(a.source,a.model,a.four_bit)
