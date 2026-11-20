import argparse
import json
import math
import random
from collections import Counter
from pathlib import Path
from . import BASE_MODEL, LABELS
from .common import read_jsonl, flat_examples, file_sha
from .losses import paired_batches, verification_loss, claim_key


def main():
    parser = argparse.ArgumentParser(description="LoRA fact classifier with optional same-claim relation contrastive training")
    parser.add_argument("--data", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--base-model", required=True, help="Select a VLM candidate after the shared-encoder review; no automatic backbone choice")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--accumulation", type=int, default=4)
    parser.add_argument("--lr", type=float, default=2e-4)
    parser.add_argument("--pair-weight", type=float, default=.25)
    parser.add_argument("--four-bit", action="store_true")
    parser.add_argument("--max-pixels", type=int, default=200704)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    import torch
    from .model import LocalVerifier
    if not torch.cuda.is_available():
        raise SystemExit("Real VLM finetuning requires a GPU. Run this command in the supplied Colab notebook or on your GPU server.")
    if args.epochs < 1 or args.accumulation < 1 or args.pair_weight < 0:
        raise SystemExit("Invalid training hyperparameters")
    data, out = Path(args.data), Path(args.out)
    if (out / "verifier_config.json").exists():
        raise SystemExit("Choose a new output directory; existing trained weights are not overwritten")
    train, dev = read_jsonl(data / "train.jsonl"), read_jsonl(data / "dev.jsonl")
    if not train or not dev or {row['group_id'] for row in train} & {row['group_id'] for row in dev}:
        raise SystemExit("Nonempty disjoint train/dev groups are required")
    items, dev_items = flat_examples(train), flat_examples(dev)
    labels = Counter(fact["label"] for _, fact in items)
    if any(labels[label] == 0 for label in LABELS):
        raise SystemExit("Training data must include supported, contradicted and genuinely uncertain examples")
    rng = random.Random(args.seed)
    torch.manual_seed(args.seed)
    if args.pair_weight>0 and args.batch_size<2:
        raise SystemExit('Contrastive training needs batch size >= 2')
    # Use identical batching for plain and contrastive ablations; only the loss weight differs.
    batches = paired_batches(items, args.batch_size, rng, args.batch_size>=2)
    eligible = sum(any(items[i][1]["label"] == "supported" for i in batch) and any(items[i][1]["label"] == "contradicted" for i in batch) and len({(items[i][0]['group_id'], items[i][1]['text']) for i in batch}) == 1 for batch in batches)
    if args.pair_weight > 0 and not eligible:
        raise SystemExit("No human-labelled supported/contradicted image pair shares a confirmed claim within an event group. Collect these pairs, or use --pair-weight 0 for the plain-finetuning baseline.")
    verifier = LocalVerifier(base_model=args.base_model, training=True, four_bit=args.four_bit, max_pixels=args.max_pixels)
    optimizer = torch.optim.AdamW((parameter for parameter in verifier.model.parameters() if parameter.requires_grad), lr=args.lr)
    scaler = torch.amp.GradScaler("cuda", enabled=verifier.dtype == torch.float16)
    best, history = float("inf"), []
    out.mkdir(parents=True, exist_ok=True)
    for epoch in range(args.epochs):
        verifier.model.train()
        batches = paired_batches(items, args.batch_size, rng, args.batch_size>=2)
        optimizer.zero_grad(set_to_none=True)
        running, pair_count = 0., 0
        for step, indices in enumerate(batches):
            selected = [items[i] for i in indices]
            batch = verifier.encode(selected, data)
            logits = verifier.logits(batch)
            targets = torch.tensor([LABELS.index(fact["label"]) for _, fact in selected], device=verifier.device)
            keys = [claim_key(example,fact) for example, fact in selected]
            loss, details = verification_loss(logits, targets, keys, args.pair_weight)
            # The final accumulation window may contain fewer than accumulation steps.
            window = min(args.accumulation, len(batches) - (step // args.accumulation) * args.accumulation)
            scaler.scale(loss / window).backward()
            if (step + 1) % args.accumulation == 0 or step + 1 == len(batches):
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(verifier.model.parameters(), 1.)
                scaler.step(optimizer)
                scaler.update()
                optimizer.zero_grad(set_to_none=True)
            running += float(loss.detach())
            pair_count += details["pairs"]
            if not math.isfinite(running):
                raise RuntimeError("Nonfinite training loss; inspect precision, inputs and learning rate")
        verifier.model.eval()
        total, count = 0., 0
        with torch.inference_mode():
            for example, fact in dev_items:
                logits = verifier.logits(verifier.encode([(example, fact)], data))
                total += float(torch.nn.functional.cross_entropy(logits, torch.tensor([LABELS.index(fact['label'])], device=verifier.device)))
                count += 1
        dev_loss = total / count
        if not math.isfinite(dev_loss):raise RuntimeError('Nonfinite dev loss; no checkpoint has been selected')
        record = {"epoch": epoch + 1, "train_loss": running / len(batches), "dev_loss": dev_loss, "contrastive_pairs": pair_count}
        history.append(record)
        print(json.dumps(record), flush=True)
        if dev_loss < best:
            best = dev_loss
            verifier.model.save_pretrained(out)
            verifier.processor.save_pretrained(out)
            config = {"base_model": args.base_model, "labels": list(LABELS), "label_tokens": ["A", "B", "C"], "max_pixels": args.max_pixels,
                      "method": "relation_contrastive_lora" if args.pair_weight else "plain_lora", "pair_weight": args.pair_weight, "seed": args.seed,
                      "train_sha256": file_sha(data / 'train.jsonl'), "dev_sha256": file_sha(data / 'dev.jsonl'), "best_dev_loss": best,
                      "torch_version": torch.__version__, "test_used_for_selection": False,"lora_targets":verifier.lora_targets,"thinking_enabled":False}
            (out / "verifier_config.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
        (out / "history.json").write_text(json.dumps(history, indent=2), encoding="utf-8")
    print(f"Saved best adapter selected on dev only: {out}")


if __name__ == "__main__":
    main()
