import inspect
import json
from pathlib import Path
from . import BASE_MODEL, LABEL_TOKENS, LABELS
from .common import SYSTEM, context_text, file_sha


class LocalVerifier:
    def __init__(self, base_model=BASE_MODEL, adapter=None, device=None, four_bit=False, max_pixels=200704, training=False):
        if not base_model:raise ValueError('사전학습모델이 아직 지정되지 않았습니다. 후보 검토 후 체크포인트를 명시하세요.')
        import torch
        from transformers import AutoProcessor, AutoModelForImageTextToText, BitsAndBytesConfig
        self.torch = torch
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.base_model, self.adapter = base_model, adapter
        if four_bit and self.device != "cuda":
            raise ValueError("4-bit loading requires a supported CUDA GPU")
        self.dtype = torch.bfloat16 if self.device == "cuda" and torch.cuda.is_bf16_supported() else torch.float16 if self.device == "cuda" else torch.float32
        if adapter:
            config = json.loads((Path(adapter) / "verifier_config.json").read_text())
            if config["base_model"] != base_model or config["labels"] != list(LABELS):
                raise ValueError("Adapter base model/label protocol does not match")
        self.processor = AutoProcessor.from_pretrained(adapter or base_model, max_pixels=max_pixels, min_pixels=3136, use_fast=False)
        self.processor.tokenizer.padding_side = "left"
        ids = [self.processor.tokenizer.encode(token, add_special_tokens=False) for token in LABEL_TOKENS]
        if any(len(token_ids) != 1 for token_ids in ids) or len({token_ids[0] for token_ids in ids}) != 3:
            raise ValueError("The classifier protocol needs three distinct single-token labels A/B/C")
        self.label_ids = [token_ids[0] for token_ids in ids]
        kwargs = {"dtype": self.dtype, "attn_implementation": "sdpa", "trust_remote_code": False}
        if four_bit:
            kwargs.update(quantization_config=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=self.dtype), device_map={"": 0})
        self.model = AutoModelForImageTextToText.from_pretrained(base_model, **kwargs)
        self.last_logit_only = "logits_to_keep" in inspect.signature(self.model.forward).parameters
        if not four_bit:
            self.model.to(self.device)
        if training:
            from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
            if four_bit:
                self.model = prepare_model_for_kbit_training(self.model)
            # Adapt language attention, hybrid recurrent projections and MLPs; keep the vision backbone frozen.
            self.lora_targets=[name for name,module in self.model.named_modules() if isinstance(module,torch.nn.Linear) and 'language_model' in name and not name.endswith('lm_head')]
            if not self.lora_targets:raise ValueError('No supported language-model linear projections found; inspect this backbone before training')
            self.model = get_peft_model(self.model, LoraConfig(r=16, lora_alpha=32, lora_dropout=.05, target_modules=self.lora_targets, task_type="CAUSAL_LM"))
            self.model.config.use_cache = False
            self.model.enable_input_require_grads()
            self.model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
        elif adapter:
            from peft import PeftModel
            self.model = PeftModel.from_pretrained(self.model, adapter, is_trainable=False)
        self.model.train(training)

    def encode(self, items, image_root):
        from PIL import Image
        texts, images = [], []
        for example, fact in items:
            path = (Path(image_root) / example["image"]).resolve()
            if not path.is_relative_to(Path(image_root).resolve()):
                raise ValueError("Image paths must stay inside the dataset directory")
            if example.get('image_sha256') and file_sha(path)!=example['image_sha256']:
                raise ValueError('Image bytes changed since the manifest was created')
            with Image.open(path) as image:
                image.load()
                images.append(image.convert("RGB"))
            texts.append(self.text_for(example, fact))
        return self.encode_images(texts, images)

    def text_for(self, example, fact):
        messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": [{"type": "image"}, {"type": "text", "text": context_text(example, fact) + "\nA/B/C 중 한 글자로 판정한다."}]}]
        # Direct A/B/C classification needs a non-thinking prefix in both pretrained and trained runs.
        return self.processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)

    def encode_images(self, texts, images):
        batch = self.processor(text=texts, images=images, padding=True, return_tensors="pt")
        batch = batch.to(self.device)
        for key in ("pixel_values", "pixel_values_videos"):
            if key in batch:
                batch[key] = batch[key].to(self.dtype)
        return batch

    def logits(self, batch):
        kwargs = {"logits_to_keep": 1} if self.last_logit_only else {}
        return self.model(**batch, **kwargs).logits[:, -1, self.label_ids].float()

    def probabilities(self, batch):
        with self.torch.inference_mode():
            return self.logits(batch).softmax(-1).cpu().tolist()

    @property
    def trained(self):
        return bool(self.adapter)
