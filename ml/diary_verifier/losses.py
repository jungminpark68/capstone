"""Fact classification plus same-claim, different-image contrastive supervision."""
import torch
import torch.nn.functional as F
from .common import context_text


def claim_key(example,fact):
    # A shared alias or phrase is not the same claim when its scene/cast changes.
    return (example['group_id'],context_text(example,fact))


def verification_loss(logits, targets, pair_keys, pair_weight=.25, margin=1.0,class_weights=None):
    classification = F.cross_entropy(logits, targets,weight=class_weights)
    scores = logits[:, 0] - logits[:, 1]
    pairs = []
    for i in range(len(pair_keys)):
        for j in range(i + 1, len(pair_keys)):
            if pair_keys[i] != pair_keys[j]:
                continue
            if targets[i].item() == 0 and targets[j].item() == 1:
                pairs.append(F.softplus(margin - (scores[i] - scores[j])))
            elif targets[i].item() == 1 and targets[j].item() == 0:
                pairs.append(F.softplus(margin - (scores[j] - scores[i])))
    contrastive = torch.stack(pairs).mean() if pairs else logits.sum() * 0
    return classification + pair_weight * contrastive, {"classification": float(classification.detach()), "contrastive": float(contrastive.detach()), "pairs": len(pairs)}


def paired_batches(items, batch_size, rng, use_pairs=True):
    if batch_size < 1 or (use_pairs and batch_size < 2):
        raise ValueError("Contrastive training needs batch_size >= 2; use pair_weight=0 for the plain-finetuning ablation")
    groups = {}
    for i, item in enumerate(items):
        example, fact = item
        key = claim_key(example,fact)
        groups.setdefault(key, {"supported": [], "contradicted": []})
        if fact["label"] in groups[key]:
            groups[key][fact["label"]].append(i)
    used, batches = set(), []
    keys = list(groups)
    rng.shuffle(keys)
    if use_pairs:
        for key in keys:
            positive, negative = groups[key]["supported"], groups[key]["contradicted"]
            rng.shuffle(positive)
            rng.shuffle(negative)
            for a, b in zip(positive, negative):
                batches.append([a, b])
                used.update((a, b))
    remaining = [i for i in range(len(items)) if i not in used]
    rng.shuffle(remaining)
    batches.extend(remaining[i:i+batch_size] for i in range(0, len(remaining), batch_size))
    rng.shuffle(batches)
    return batches
