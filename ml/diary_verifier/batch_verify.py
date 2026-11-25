"""Check app-exported diaries in Kaggle and return image/claim-bound predictions."""
import argparse
import base64
import hashlib
import io
import json
from datetime import datetime, timezone
from pathlib import Path
from PIL import Image
from . import LABELS


def request_context(item):
    return {key:item[key] for key in ('recordId','imageSha256','scene','characters','facts')}


def request_fingerprint(item):
    context=request_context(item)
    return hashlib.sha256(json.dumps(context,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def validate_request(item):
    if not isinstance(item,dict) or not isinstance(item.get('recordId'),str) or not item['recordId'] or len(item['recordId'])>100:
        raise ValueError('Missing record ID')
    if not isinstance(item.get('scene'),str) or not item['scene'].strip() or len(item['scene'])>3000 or not isinstance(item.get('characters'),str) or len(item['characters'])>3000:
        raise ValueError('Invalid scene/character context')
    facts=item.get('facts')
    if not isinstance(facts,list) or not 1<=len(facts)<=16 or any(not isinstance(f,dict) or not isinstance(f.get('id'),str) or not f['id'] or not isinstance(f.get('text'),str) or not f['text'].strip() or len(f['text'])>300 or set(f)-{'id','text','kind'} for f in facts):
        raise ValueError('Expected 1–16 facts without human labels')
    if len({f['id'] for f in facts})!=len(facts):raise ValueError('Duplicate fact IDs')
    image=item.get('image','')
    if not isinstance(image,str) or len(image)>6_000_000 or not image.startswith(('data:image/png;base64,','data:image/jpeg;base64,','data:image/webp;base64,')):
        raise ValueError('Unsupported/excessive embedded image')
    raw=base64.b64decode(image.split(',',1)[1],validate=True)
    if hashlib.sha256(raw).hexdigest()!=item.get('imageSha256'):raise ValueError('Image hash mismatch')
    if request_fingerprint(item)!=item.get('requestFingerprint'):raise ValueError('Image/facts request fingerprint mismatch')
    with Image.open(io.BytesIO(raw)) as source:
        if source.format not in ('PNG','JPEG','WEBP') or source.width*source.height>20_000_000:raise ValueError('Unsupported/excessive image dimensions')
        source.load();decoded=source.convert('RGB')
    return decoded


def load_requests(paths):
    items={}
    for path in paths:
        value=json.loads(Path(path).read_text(encoding='utf-8'))
        if value.get('kind')!='memory_connect_verification_requests' or value.get('schemaVersion')!=1 or not isinstance(value.get('items'),list):
            raise ValueError('Select app-exported Kaggle request JSON files')
        for item in value['items']:
            validate_request(item)
            items.setdefault(item['requestFingerprint'],item)
    if not items:raise ValueError('No diary requests')
    return list(items.values())


def batch_verify(items,verifier,out):
    out=Path(out)
    if out.exists():raise ValueError('Choose a new output file')
    if not verifier.trained or getattr(verifier,'backend_mode',None)!='local_fusion':raise ValueError('A fusion model trained with human-reviewed data is required')
    predictions=[]
    for item in items:
        image=validate_request(item)
        results=verifier.verify_image(image,item['scene'],item['characters'],item['facts'])
        if len(results)!=len(item['facts']) or {r['factId'] for r in results}!={f['id'] for f in item['facts']} or any(r.get('label') not in LABELS or not r.get('reason') for r in results):
            raise ValueError('Verifier returned incomplete predictions')
        predictions.append({key:item[key] for key in ('requestFingerprint','imageSha256','recordId')}|{
            'mode':'local_fusion','trainedModel':True,'model':str(verifier.adapter),'trainingScope':verifier.training_scope,'results':results})
    value={'schemaVersion':1,'kind':'memory_connect_verification_predictions','createdAt':datetime.now(timezone.utc).isoformat(),'items':predictions}
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')
    return value


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--requests',nargs='+',required=True)
    parser.add_argument('--checkpoint',required=True)
    parser.add_argument('--out',required=True)
    parser.add_argument('--device')
    parser.add_argument('--model-cache')
    args=parser.parse_args()
    items=load_requests(args.requests)
    from .fusion_model import FusionVerifier
    model=FusionVerifier(args.checkpoint,device=args.device,model_cache=args.model_cache)
    result=batch_verify(items,model,args.out)
    print(f"Wrote {len(result['items'])} diary predictions: {args.out}")


if __name__=='__main__':main()
