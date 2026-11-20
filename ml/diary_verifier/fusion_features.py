"""Frozen Korean text / image patch extraction and versioned, label-free caches."""
import argparse
import hashlib
import json
import time
from dataclasses import dataclass,asdict
from pathlib import Path
import torch
from .shared_encoder import EncoderSpec,EncodedText,HuggingFaceTextEncoder,checkpoint_revision
from .common import context_text,file_sha,flat_examples,read_jsonl

TEMP_TEXT_MODEL='BAAI/bge-m3'
TEMP_IMAGE_MODEL='google/siglip2-base-patch16-384'


def canonical_sha(value):
    return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()


@dataclass(frozen=True)
class ImageEncoderSpec:
    model_id:str
    revision:str
    patch_dim:int
    processor_sha256:str

    @property
    def fingerprint(self):return canonical_sha(asdict(self))


class SiglipPatchEncoder:
    def __init__(self,model_id=TEMP_IMAGE_MODEL,revision='main',device='cpu',cache_dir=None):
        from transformers import AutoConfig,AutoImageProcessor,SiglipVisionModel
        pinned=checkpoint_revision(model_id,revision,cache_dir)
        load_revision=revision if Path(model_id).is_dir() else pinned
        config=AutoConfig.from_pretrained(model_id,revision=load_revision,cache_dir=cache_dir,trust_remote_code=False)
        if config.model_type!='siglip':raise ValueError('This adapter supports the tested SigLIP/SigLIP2 fixed-resolution vision backbone only')
        self.processor=AutoImageProcessor.from_pretrained(model_id,revision=load_revision,cache_dir=cache_dir)
        self.model,info=SiglipVisionModel.from_pretrained(model_id,config=config.vision_config,revision=load_revision,cache_dir=cache_dir,trust_remote_code=False,output_loading_info=True)
        if info.get('missing_keys'):raise ValueError(f'Image encoder checkpoint has missing parameters: {info["missing_keys"][:4]}')
        self.model.to(device).eval().requires_grad_(False)
        self.device=device
        self.spec=ImageEncoderSpec(model_id,pinned,config.vision_config.hidden_size,canonical_sha(self.processor.to_dict()))

    @torch.inference_mode()
    def encode(self,images):
        inputs=self.processor(images=images,return_tensors='pt').to(self.device)
        patches=self.model(**inputs).last_hidden_state
        if patches.ndim!=3 or patches.shape[-1]!=self.spec.patch_dim or not torch.isfinite(patches).all():
            raise ValueError('Invalid image patch features')
        return patches


def encoder_bundle(text_spec,image_spec):
    return {'schema_version':1,'text':asdict(text_spec),'image':asdict(image_spec),'feature_dtype':'float16','context_format':'confirmed_scene_characters_and_one_fact_v1','encoders_frozen':True}


def image_path(root,example):
    path=(Path(root)/example['image']).resolve()
    if not path.is_relative_to(Path(root).resolve()) or file_sha(path)!=example['image_sha256']:
        raise ValueError('Image is outside the dataset or changed since annotation')
    return path


class FeatureCache:
    def __init__(self,root,bundle=None):
        self.root=Path(root)
        path=self.root/'encoders.json'
        if path.exists():
            self.bundle=json.loads(path.read_text())
            if bundle is not None and self.bundle!=bundle:raise ValueError('Encoder/cache versions changed. Create a new cache and retrain the fusion head.')
        else:
            if bundle is None:raise ValueError('A prepared feature cache is required')
            self.root.mkdir(parents=True,exist_ok=True)
            self.bundle=bundle
            path.write_text(json.dumps(bundle,ensure_ascii=False,indent=2))
        self.text_spec=EncoderSpec(**self.bundle['text'])
        self.image_spec=ImageEncoderSpec(**self.bundle['image'])
        self.fingerprint=canonical_sha(self.bundle)

    def key_for_text(self,example,fact):
        return canonical_sha({'encoder':self.text_spec.fingerprint,'input':context_text(example,fact)})

    def filename(self,kind,key):
        if kind not in ('texts','images') or len(key)!=64 or any(c not in '0123456789abcdef' for c in key):raise ValueError('Invalid feature key')
        return self.root/kind/(key+'.pt')

    def save(self,kind,key,tensors):
        path=self.filename(kind,key);path.parent.mkdir(exist_ok=True)
        torch.save({k:v.detach().cpu().clone() if torch.is_tensor(v) else v for k,v in tensors.items()},path)

    def load(self,kind,key):
        return torch.load(self.filename(kind,key),map_location='cpu',weights_only=True)

    def batch(self,items):
        from torch.nn.utils.rnn import pad_sequence
        sentences,tokens,masks,images=[],[],[],[]
        for example,fact in items:
            text=self.load('texts',self.key_for_text(example,fact))
            image=self.load('images',example['image_sha256'])
            if text['encoder_fingerprint']!=self.text_spec.fingerprint or image['encoder_fingerprint']!=self.image_spec.fingerprint:
                raise ValueError('Feature file belongs to a different encoder')
            if text['input_sha256']!=canonical_sha(context_text(example,fact)) or image['image_sha256']!=example['image_sha256']:
                raise ValueError('Feature file does not match the requested text/image')
            sentences.append(text['sentence']);images.append(image['patches'])
            if self.text_spec.supports_tokens:tokens.append(text['tokens']);masks.append(text['mask'])
        text=EncodedText(torch.stack(sentences),pad_sequence(tokens,batch_first=True) if tokens else None,pad_sequence(masks,batch_first=True) if masks else None,self.text_spec).validate()
        image_mask=pad_sequence([torch.ones(len(image),dtype=torch.bool) for image in images],batch_first=True)
        return text,pad_sequence(images,batch_first=True),image_mask

    def assert_manifest(self,manifest):
        index=self.root/'indices'/(file_sha(manifest)+'.json')
        if not index.exists():raise ValueError('Cache the exact manifest version before training or inference')
        value=json.loads(index.read_text())
        if value['encoder_bundle_sha256']!=self.fingerprint:raise ValueError('Manifest cache has incompatible encoders')


def extract_features(manifest,cache,text_encoder,image_encoder):
    from PIL import Image
    examples=read_jsonl(manifest)
    if text_encoder.spec.fingerprint!=cache.text_spec.fingerprint or image_encoder.spec.fingerprint!=cache.image_spec.fingerprint:
        raise ValueError('Extractor does not match declared encoders')
    started=time.perf_counter();new_text,new_image=0,0
    for example,fact in flat_examples(examples):
        path=image_path(Path(manifest).parent,example)
        if not cache.filename('images',example['image_sha256']).exists():
            with Image.open(path) as raw:patches=image_encoder.encode([raw.convert('RGB')])[0]
            cache.save('images',example['image_sha256'],{'patches':patches.half(),'image_sha256':example['image_sha256'],'encoder_fingerprint':image_encoder.spec.fingerprint})
            new_image+=1
        text_key=cache.key_for_text(example,fact)
        if not cache.filename('texts',text_key).exists():
            text=text_encoder.encode([context_text(example,fact)]).validate()
            cache.save('texts',text_key,{'sentence':text.sentence[0].half(),'tokens':text.tokens[0].half() if text.tokens is not None else None,'mask':text.mask[0].bool() if text.mask is not None else None,'input_sha256':canonical_sha(context_text(example,fact)),'encoder_fingerprint':text_encoder.spec.fingerprint})
            new_text+=1
    summary={'manifest_sha256':file_sha(manifest),'encoder_bundle_sha256':cache.fingerprint,'facts':sum(len(example['facts']) for example in examples),'new_text_features':new_text,'new_image_features':new_image,'elapsed_seconds':time.perf_counter()-started,'human_labels_encoded':False}
    folder=cache.root/'indices';folder.mkdir(exist_ok=True)
    (folder/(file_sha(manifest)+'.json')).write_text(json.dumps(summary,indent=2))
    return summary


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifests',nargs='+',required=True)
    parser.add_argument('--cache',required=True)
    parser.add_argument('--text-model',default=TEMP_TEXT_MODEL)
    parser.add_argument('--image-model',default=TEMP_IMAGE_MODEL)
    parser.add_argument('--pooling',choices=['cls','mean'],default='cls')
    parser.add_argument('--max-tokens',type=int,default=1024)
    parser.add_argument('--device',default='cuda' if torch.cuda.is_available() else 'cpu')
    parser.add_argument('--model-cache')
    args=parser.parse_args()
    previous=Path(args.cache)/'encoders.json'
    pinned=json.loads(previous.read_text()) if previous.exists() else None
    if pinned and (pinned['text']['model_id']!=args.text_model or pinned['image']['model_id']!=args.image_model or pinned['text']['pooling']!=args.pooling or pinned['text']['max_tokens']!=args.max_tokens):
        raise SystemExit('Choose a new cache directory when changing encoder settings')
    # Existing caches pin immutable checkpoint revisions, not a moving main branch.
    text=HuggingFaceTextEncoder(args.text_model,revision=pinned['text']['revision'] if pinned else 'main',pooling=args.pooling,max_tokens=args.max_tokens,device=args.device,cache_dir=args.model_cache)
    image=SiglipPatchEncoder(args.image_model,revision=pinned['image']['revision'] if pinned else 'main',device=args.device,cache_dir=args.model_cache)
    cache=FeatureCache(args.cache,encoder_bundle(text.spec,image.spec))
    for manifest in args.manifests:print(json.dumps(extract_features(manifest,cache,text,image),ensure_ascii=False),flush=True)


if __name__=='__main__':main()
