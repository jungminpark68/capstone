"""Train and compare pooled, plain-attention and relation-loss verifiers."""
import argparse
import json
import csv
import statistics
from pathlib import Path
from .common import read_jsonl,file_sha
from .losses import claim_key
from .fusion_train import train_fusion
from .fusion_predict import predict_cached,predict_from_images
from .evaluate import compare_runs


def has_relation_pairs(examples):
    claims={}
    for example in examples:
        for fact in example['facts']:claims.setdefault(claim_key(example,fact),set()).add(fact['label'])
    return any({'supported','contradicted'}<=labels for labels in claims.values())


def experiment(data,cache,out,device='cpu',epochs=15,batch_size=8,seeds=(42,),text_mode='sentence',end_to_end=False,allow_synthetic=False,balanced=False):
    data,out=Path(data),Path(out)
    if out.exists():raise ValueError('Choose a new experiment output directory; previous results are preserved')
    train=read_jsonl(data/'train.jsonl')
    if not train:raise ValueError('Collect human-reviewed images before training')
    pairs=has_relation_pairs(train)
    setups=[('pooled','pooled',0.),('plain','cross_attention',0.)]+([('relation','cross_attention',.25)] if pairs else [])
    out.mkdir(parents=True)
    protocol={'train_manifest_sha256':file_sha(data/'train.jsonl'),'dev_manifest_sha256':file_sha(data/'dev.jsonl'),'test_manifest_sha256':file_sha(data/'test.jsonl'),
              'seeds':list(seeds),'epochs':epochs,'batch_size':batch_size,'text_mode':text_mode,'encoders_frozen':True,'test_used_for_selection':False,
              'relation_pairs_available':pairs,'skipped':[] if pairs else ['relation: no same-claim supported/contradicted pair in training data'],
              'latency_mode':'end_to_end' if end_to_end else 'cached_features_head_only','data_purpose':json.loads((data/'dataset-info.json').read_text())['data_purpose'],'allow_synthetic':allow_synthetic,'balanced':balanced}
    (out/'protocol.json').write_text(json.dumps(protocol,indent=2),encoding='utf-8')
    reports=[];across_seeds={}
    for seed in seeds:
        predictions=[]
        for name,fusion,weight in setups:
            checkpoint=out/f'{name}-seed{seed}'
            train_fusion(data,cache,checkpoint,device=device,epochs=epochs,batch_size=batch_size,seed=seed,text_mode=text_mode,pair_weight=weight,fusion_method=fusion,allow_synthetic=allow_synthetic,balanced=balanced)
            target=out/f'{name}-seed{seed}.jsonl'
            if end_to_end:predict_from_images(data/'test.jsonl',checkpoint,target,device=device,allow_synthetic=allow_synthetic)
            else:predict_cached(data/'test.jsonl',cache,checkpoint,target,device=device,allow_synthetic=allow_synthetic)
            predictions.append(target)
        report=compare_runs(data/'test.jsonl',predictions,out/f'comparison-seed{seed}.json')
        for name,run in report['runs'].items():
            method=name.rsplit('-seed',1)[0]
            across_seeds.setdefault(method,[]).append(run)
        reports.append(str(out/f'comparison-seed{seed}.html'))
    keys=['macro_f1','error_fact_recall','error_image_false_pass_rate','normal_image_false_alarm_rate','image_abstention_rate']
    with (out/'seed-summary.csv').open('w',encoding='utf-8-sig',newline='') as stream:
        writer=csv.writer(stream);writer.writerow(['method','metric','runs','mean','sample_std'])
        for method,runs in across_seeds.items():
            for metric in keys:
                values=[r[metric] for r in runs if r[metric] is not None]
                writer.writerow([method,metric,len(values),statistics.mean(values) if values else None,statistics.stdev(values) if len(values)>1 else None])
    return {'reports':reports,'relation_pairs_available':pairs,'seed_summary':str(out/'seed-summary.csv')}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('data','cache','out'):parser.add_argument('--'+name,required=True)
    parser.add_argument('--device',default='cpu')
    parser.add_argument('--epochs',type=int,default=15)
    parser.add_argument('--batch-size',type=int,default=8)
    parser.add_argument('--seeds',type=int,nargs='+',default=[42])
    parser.add_argument('--text-mode',choices=['sentence','tokens'],default='sentence')
    parser.add_argument('--end-to-end',action='store_true')
    parser.add_argument('--synthetic',action='store_true')
    parser.add_argument('--balanced',action='store_true')
    args=parser.parse_args()
    result=experiment(args.data,args.cache,args.out,args.device,args.epochs,args.batch_size,args.seeds,args.text_mode,args.end_to_end,allow_synthetic=args.synthetic,balanced=args.balanced)
    print(json.dumps(result,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
