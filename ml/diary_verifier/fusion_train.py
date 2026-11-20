"""Train a small verifier on cached Korean fact embeddings and image patches."""
import argparse
import json
import math
import random
from pathlib import Path
import torch
from . import LABELS
from .common import read_jsonl,flat_examples,file_sha
from .fusion_features import FeatureCache
from .shared_encoder import FactFusionHead
from .losses import paired_batches,verification_loss,claim_key


def train_fusion(data,cache_path,out,epochs=15,batch_size=8,learning_rate=3e-4,pair_weight=.25,hidden=256,heads=4,text_mode='sentence',seed=42,device=None,patience=4):
    data,out=Path(data),Path(out)
    if (out/'fusion_config.json').exists():raise ValueError('Choose a new run directory; existing learned weights are not overwritten')
    if epochs<1 or batch_size<1 or pair_weight<0 or learning_rate<=0 or hidden<1 or heads<1 or hidden%heads or patience<1:raise ValueError('Invalid training settings')
    if pair_weight>0 and batch_size<2:raise ValueError('Same-claim contrastive training needs batch size >= 2')
    purpose=json.loads((data/'dataset-info.json').read_text()).get('data_purpose')
    if purpose not in ('collected_human_reviewed_data','software_test_fixture'):raise ValueError('Prepare/version the reviewed dataset first; do not label unknown data as real training data')
    train,dev=read_jsonl(data/'train.jsonl'),read_jsonl(data/'dev.jsonl')
    if not train or not dev or {row['group_id'] for row in train}&{row['group_id'] for row in dev}:raise ValueError('Nonempty, independent train/dev event groups are required')
    if {row['image_sha256'] for row in train}&{row['image_sha256'] for row in dev}:raise ValueError('The same image leaked across train/dev')
    items,dev_items=flat_examples(train),flat_examples(dev)
    if set(fact['label'] for _,fact in items)!=set(LABELS):raise ValueError('Training requires all three human-labelled classes, including genuinely ambiguous examples')
    cache=FeatureCache(cache_path)
    for name in ('train','dev'):cache.assert_manifest(data/(name+'.jsonl'))
    rng=random.Random(seed);torch.manual_seed(seed)
    device=device or ('cuda' if torch.cuda.is_available() else 'cpu')
    head=FactFusionHead(cache.text_spec,cache.image_spec.patch_dim,hidden,heads,text_mode=text_mode).to(device)
    optimizer=torch.optim.AdamW(head.parameters(),lr=learning_rate,weight_decay=.01)
    best,stale,history=float('inf'),0,[]
    out.mkdir(parents=True,exist_ok=True)
    for epoch in range(epochs):
        head.train();loss_total,pairs=0.,0
        batches=paired_batches(items,batch_size,rng,batch_size>=2)
        for indices in batches:
            selected=[items[i] for i in indices]
            features=cache.batch(selected)
            logits=head(*features)
            targets=torch.tensor([LABELS.index(fact['label']) for _,fact in selected],device=device)
            keys=[claim_key(example,fact) for example,fact in selected]
            loss,detail=verification_loss(logits,targets,keys,pair_weight)
            if not torch.isfinite(loss):raise RuntimeError('Nonfinite training loss')
            optimizer.zero_grad(set_to_none=True);loss.backward();torch.nn.utils.clip_grad_norm_(head.parameters(),1.);optimizer.step()
            loss_total+=float(loss.detach());pairs+=detail['pairs']
        if pair_weight>0 and not pairs:raise ValueError('No correct/error pair shares a human-confirmed fact. Collect pairs or run the plain-head baseline with pair_weight=0.')
        head.eval();dev_total=0.
        with torch.inference_mode():
            for example,fact in dev_items:
                logits=head(*cache.batch([(example,fact)]))
                dev_total+=float(torch.nn.functional.cross_entropy(logits,torch.tensor([LABELS.index(fact['label'])],device=device)))
        dev_loss=dev_total/len(dev_items)
        if not math.isfinite(dev_loss):raise RuntimeError('Nonfinite development loss')
        summary={'epoch':epoch+1,'train_loss':loss_total/len(batches),'dev_loss':dev_loss,'contrastive_pairs':pairs,'test_used':False}
        history.append(summary)
        print(json.dumps(summary),flush=True)
        if dev_loss<best:
            best,stale=dev_loss,0
            temp=out/'fusion_head.tmp';torch.save({name:value.detach().cpu() for name,value in head.state_dict().items()},temp);temp.replace(out/'fusion_head.pt')
            config={'architecture':'shared_encoder_fact_fusion','weights_learned':True,'data_purpose':purpose,'labels':list(LABELS),'encoders':cache.bundle,
                    'hidden':hidden,'heads':heads,'text_mode':text_mode,'training_scope':'fusion_head_only_frozen_encoders','encoders_finetuned':False,'seed':seed,'pair_weight':pair_weight,
                    'train_manifest_sha256':file_sha(data/'train.jsonl'),'dev_manifest_sha256':file_sha(data/'dev.jsonl'),'best_dev_loss':best,'weights_sha256':file_sha(out/'fusion_head.pt'),
                    'trainable_parameters':sum(parameter.numel() for parameter in head.parameters()),'test_used_for_selection':False}
            (out/'fusion_config.json').write_text(json.dumps(config,ensure_ascii=False,indent=2))
        else:stale+=1
        (out/'history.json').write_text(json.dumps(history,indent=2))
        if stale>=patience:break
    return json.loads((out/'fusion_config.json').read_text())


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('data','cache','out'):parser.add_argument('--'+name,required=True)
    parser.add_argument('--epochs',type=int,default=15)
    parser.add_argument('--batch-size',type=int,default=8)
    parser.add_argument('--lr',type=float,default=3e-4)
    parser.add_argument('--pair-weight',type=float,default=.25)
    parser.add_argument('--hidden',type=int,default=256)
    parser.add_argument('--heads',type=int,default=4)
    parser.add_argument('--text-mode',choices=['sentence','tokens'],default='sentence')
    parser.add_argument('--seed',type=int,default=42)
    parser.add_argument('--device')
    args=parser.parse_args()
    result=train_fusion(args.data,args.cache,args.out,epochs=args.epochs,batch_size=args.batch_size,learning_rate=args.lr,pair_weight=args.pair_weight,hidden=args.hidden,heads=args.heads,text_mode=args.text_mode,seed=args.seed,device=args.device)
    print(json.dumps({'checkpoint':args.out,'training_scope':result['training_scope'],'data_purpose':result['data_purpose'],'trainable_parameters':result['trainable_parameters']}))


if __name__=='__main__':main()
