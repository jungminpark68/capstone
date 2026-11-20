"""Replaceable Korean text-encoder contract; not a trained visual classifier."""
from dataclasses import dataclass, asdict
from typing import Protocol
import hashlib
import json
from pathlib import Path
import torch


def checkpoint_revision(model_id,revision='main',cache_dir=None):
    """Resolve a moving Hub branch before loading tokenizer and weights."""
    local=Path(model_id)
    if local.is_dir():
        digest=hashlib.sha256()
        files=sorted(path for path in local.rglob('*') if path.is_file() and path.suffix in ('.json','.txt','.model','.safetensors','.bin'))
        if not files:raise ValueError('No checkpoint files found in the local encoder directory')
        for path in files:
            digest.update(str(path.relative_to(local)).encode())
            with path.open('rb') as stream:
                for block in iter(lambda:stream.read(1024*1024),b''):digest.update(block)
        return 'local-sha256:'+digest.hexdigest()
    from huggingface_hub import hf_hub_download
    config=Path(hf_hub_download(model_id,'config.json',revision=revision,cache_dir=cache_dir))
    commit=config.parent.name
    if len(commit)!=40 or any(c not in '0123456789abcdef' for c in commit):
        raise ValueError('Could not resolve the immutable encoder checkpoint revision')
    return commit


@dataclass(frozen=True)
class EncoderSpec:
    model_id: str
    revision: str
    sentence_dim: int
    token_dim: int
    pooling: str
    max_tokens: int
    supports_tokens: bool = True

    def __post_init__(self):
        if not self.model_id or not self.revision or self.sentence_dim<1 or self.max_tokens<1 or self.supports_tokens and self.token_dim<1:
            raise ValueError('An identified checkpoint, dimensions and token limit are required')

    @property
    def fingerprint(self):
        return hashlib.sha256(json.dumps(asdict(self), sort_keys=True).encode()).hexdigest()


@dataclass
class EncodedText:
    sentence: torch.Tensor
    tokens: torch.Tensor | None
    mask: torch.Tensor | None
    spec: EncoderSpec

    def validate(self):
        if self.sentence.ndim != 2 or self.sentence.shape[-1] != self.spec.sentence_dim:
            raise ValueError('Sentence embedding dimension does not match the declared contract')
        if not torch.isfinite(self.sentence).all():raise ValueError('Nonfinite sentence features')
        if self.spec.supports_tokens:
            if self.tokens is None or self.mask is None or self.tokens.ndim != 3 or self.tokens.shape[:2] != self.mask.shape or self.tokens.shape[0] != self.sentence.shape[0] or self.tokens.shape[-1] != self.spec.token_dim:
                raise ValueError('Expected uncompressed token features and their mask')
            if not self.mask.bool().any(dim=1).all():raise ValueError('Each input needs at least one visible text token')
            if not torch.isfinite(self.tokens).all():raise ValueError('Nonfinite token features')
        return self


class TextEncoder(Protocol):
    spec: EncoderSpec
    def encode(self, texts: list[str]) -> EncodedText: ...


class HuggingFaceTextEncoder:
    """An interim frozen encoder. The matching team can implement the same protocol."""
    def __init__(self, model_id, revision='main', pooling='cls', max_tokens=512, device='cpu',cache_dir=None):
        from transformers import AutoModel, AutoTokenizer
        if pooling not in ('cls','mean'):raise ValueError('Specify the checkpoint-appropriate pooling rule')
        resolved_revision=checkpoint_revision(model_id,revision,cache_dir)
        load_revision=revision if Path(model_id).is_dir() else resolved_revision
        self.tokenizer=AutoTokenizer.from_pretrained(model_id, revision=load_revision, trust_remote_code=False,cache_dir=cache_dir)
        self.model=AutoModel.from_pretrained(model_id, revision=load_revision, trust_remote_code=False,cache_dir=cache_dir).to(device).eval()
        self.model.requires_grad_(False)
        self.device=device
        self.spec=EncoderSpec(model_id,resolved_revision,self.model.config.hidden_size,self.model.config.hidden_size,pooling,max_tokens)

    @torch.inference_mode()
    def encode(self,texts):
        if not texts or any(not isinstance(text,str) or not text.strip() for text in texts):raise ValueError('Nonempty text blocks required')
        data=self.tokenizer(texts,return_tensors='pt',padding=True,truncation=False)
        if data['input_ids'].shape[1]>self.spec.max_tokens:
            raise ValueError('Input is too long. Split main/supporting events into blocks; do not silently truncate the main facts.')
        data=data.to(self.device)
        tokens=self.model(**data).last_hidden_state
        mask=data['attention_mask'].bool()
        sentence=tokens[:,0] if self.spec.pooling=='cls' else (tokens*mask.unsqueeze(-1)).sum(1)/mask.sum(1,keepdim=True)
        return EncodedText(torch.nn.functional.normalize(sentence,dim=-1),tokens,mask,self.spec).validate()


class FactFusionHead(torch.nn.Module):
    """Trainable cross-attention over text tokens and image patches. Random until trained."""
    def __init__(self, spec: EncoderSpec, image_dim: int, hidden=256, heads=4,text_mode='tokens'):
        super().__init__()
        if text_mode not in ('sentence','tokens'):raise ValueError('Choose sentence or tokens explicitly')
        if text_mode=='tokens' and not spec.supports_tokens:raise ValueError('Token-mode verification needs pre-autoencoder token features. Use an explicitly trained sentence-mode head for pooled vectors.')
        self.text_mode=text_mode
        self.encoder_fingerprint=spec.fingerprint
        self.image_dim=image_dim
        self.text_projection=torch.nn.Linear(spec.token_dim if text_mode=='tokens' else spec.sentence_dim,hidden)
        self.image_projection=torch.nn.Linear(image_dim,hidden)
        self.cross_attention=torch.nn.MultiheadAttention(hidden,heads,batch_first=True)
        self.classifier=torch.nn.Sequential(torch.nn.LayerNorm(hidden*3),torch.nn.Linear(hidden*3,hidden),torch.nn.GELU(),torch.nn.Linear(hidden,3))

    def forward(self,text:EncodedText,image_patches,image_mask=None):
        text.validate()
        if text.spec.fingerprint!=self.encoder_fingerprint:
            raise ValueError('Text encoder changed. Rebuild/retrain or explicitly validate the fusion adapter; equal vector sizes do not imply compatible meanings.')
        if image_patches.ndim!=3 or image_patches.shape[0]!=text.sentence.shape[0] or image_patches.shape[-1]!=self.image_dim or not torch.isfinite(image_patches).all():
            raise ValueError('Expected image patch features [batch, patches, image_dim]')
        def prepare(value,layer):
            value=value.to(device=layer.weight.device,dtype=layer.weight.dtype)
            return value.clone() if value.is_inference() and torch.is_grad_enabled() else value
        # Sentence-mode uses one pooled fact query; it does not invent original text-token features.
        queries=text.tokens if self.text_mode=='tokens' else text.sentence.unsqueeze(1)
        query=self.text_projection(prepare(queries,self.text_projection))
        keys=self.image_projection(prepare(image_patches,self.image_projection))
        if image_mask is not None and (image_mask.shape!=image_patches.shape[:2] or not image_mask.bool().any(1).all()):raise ValueError('Invalid image patch mask')
        padding=None if image_mask is None else ~image_mask.to(device=keys.device,dtype=torch.bool)
        aligned,_=self.cross_attention(query,keys,keys,key_padding_mask=padding,need_weights=False)
        mask=(text.mask.to(query.device) if self.text_mode=='tokens' else torch.ones(query.shape[:2],device=query.device,dtype=torch.bool)).unsqueeze(-1)
        if mask.is_inference() and torch.is_grad_enabled():mask=mask.clone()
        q=(query*mask).sum(1)/mask.sum(1)
        v=(aligned*mask).sum(1)/mask.sum(1)
        return self.classifier(torch.cat([q,v,q*v],dim=-1))
