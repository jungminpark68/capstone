import argparse
import time
from pathlib import Path
from . import LABELS
from .common import read_jsonl,flat_examples,write_jsonl,file_sha
from .fusion_features import FeatureCache,image_path
from .fusion_model import FusionCheckpoint,FusionVerifier


def predict_cached(manifest,cache_path,checkpoint,out,device='cpu',allow_software_fixture=False,allow_synthetic=False):
    if Path(out).exists():raise ValueError('Output already exists; use a new prediction run')
    rows=read_jsonl(manifest);items=flat_examples(rows)
    if not items:raise ValueError('No facts to predict')
    model=FusionCheckpoint(checkpoint,device,allow_software_fixture=allow_software_fixture,allow_synthetic=allow_synthetic)
    cache=FeatureCache(cache_path);cache.assert_manifest(manifest);model.check_cache(cache)
    predictions=[]
    for example,fact in items:
        before=time.perf_counter()
        probabilities=model.probabilities(*cache.batch([(example,fact)]))[0]
        predictions.append({'example_id':example['id'],'fact_id':fact['id'],'label':LABELS[max(range(3),key=probabilities.__getitem__)],
                            'probabilities':dict(zip(LABELS,probabilities)),'probabilities_calibrated':False,'latency_seconds':time.perf_counter()-before,
                            'latency_scope':'cached_features_plus_fusion_head','feature_cache_used':True,'model':model.model_id,
                            'backend':'local_fusion' if model.trained else 'synthetic_controlled_fusion' if model.synthetic else 'software_test_fixture_fusion','training_scope':'fusion_head_only_frozen_encoders',
                            'manifest_sha256':file_sha(manifest),'error':None})
    write_jsonl(out,predictions)
    return predictions


def predict_from_images(manifest,checkpoint,out,device=None,model_cache=None,allow_synthetic=False):
    from PIL import Image
    if Path(out).exists():raise ValueError('Output already exists; use a new prediction run')
    items=flat_examples(read_jsonl(manifest))
    if not items:raise ValueError('No facts to predict')
    model=FusionVerifier(checkpoint,device=device,model_cache=model_cache,allow_synthetic=allow_synthetic)
    rows=[]
    for example,fact in items:
        before=time.perf_counter()
        path=image_path(Path(manifest).parent,example)
        with Image.open(path) as raw:result=model.verify_image(raw.convert('RGB'),example.get('scene',''),example.get('characters',''),[fact])[0]
        rows.append({'example_id':example['id'],'fact_id':fact['id'],'label':result['label'],'model':model.checkpoint.model_id,'backend':model.backend_mode,
                     'training_scope':model.training_scope,'manifest_sha256':file_sha(manifest),'error':None,'feature_cache_used':False,
                     'latency_seconds':time.perf_counter()-before,'latency_scope':'image_text_encoders_and_fusion_head_excluding_weight_loading'})
        write_jsonl(out,rows)
    return rows


def main():
    parser=argparse.ArgumentParser(description='Predict using the locally learned Korean embedding/image fusion head')
    for name in ('manifest','checkpoint','out'):parser.add_argument('--'+name,required=True)
    parser.add_argument('--cache')
    parser.add_argument('--from-images',action='store_true',help='Includes encoder computation; use for end-to-end runtime comparisons')
    parser.add_argument('--device',default='cpu')
    parser.add_argument('--model-cache')
    parser.add_argument('--synthetic',action='store_true')
    args=parser.parse_args()
    if args.from_images:rows=predict_from_images(args.manifest,args.checkpoint,args.out,args.device,args.model_cache,allow_synthetic=args.synthetic)
    else:
        if not args.cache:parser.error('--cache or --from-images is required')
        rows=predict_cached(args.manifest,args.cache,args.checkpoint,args.out,args.device,allow_synthetic=args.synthetic)
    print(f'Wrote {len(rows)} predictions. Cached-head timing must not be compared directly with end-to-end API timing.')


if __name__=='__main__':main()
