import argparse
import hashlib
import json
import random
from collections import defaultdict
from pathlib import Path
from . import LABELS
from .common import read_jsonl, validate_examples, file_sha


def prediction_map(rows, examples, manifest_sha=None):
    expected = {(example["id"], fact["id"]) for example in examples for fact in example["facts"]}
    predictions = {}
    for row in rows:
        key = (row.get("example_id"), row.get("fact_id"))
        if key not in expected or key in predictions or row.get("error") or row.get("label") not in LABELS:
            raise ValueError("Invalid, duplicate, failed or unexpected prediction")
        if manifest_sha and row.get("manifest_sha256") != manifest_sha:
            raise ValueError("Prediction was made against a different manifest")
        predictions[key] = row
    if set(predictions) != expected:
        raise ValueError("Incomplete test coverage; do not compare only successful API/model responses")
    identities = {(row.get("backend"), row.get("model")) for row in rows}
    if len(identities) != 1:
        raise ValueError("A prediction run must identify one model and backend")
    return predictions


def metrics(examples, predictions):
    matrix = {gold: {pred: 0 for pred in LABELS} for gold in LABELS}
    false_pass, error_images, normal_images, false_alarm, deferred = 0, 0, 0, 0, 0
    kind_counts = defaultdict(lambda: {"gold_errors": 0, "found_errors": 0})
    for example in examples:
        gold = [fact["label"] for fact in example["facts"]]
        pred = [predictions[(example["id"], fact["id"])]["label"] for fact in example["facts"]]
        for fact, g, p in zip(example["facts"], gold, pred):
            matrix[g][p] += 1
            if g == "contradicted":
                kind_counts[fact.get("kind", "other")]["gold_errors"] += 1
                kind_counts[fact.get("kind", "other")]["found_errors"] += p == "contradicted"
        if "contradicted" in gold:
            error_images += 1
            false_pass += all(label == "supported" for label in pred)
        if all(label == "supported" for label in gold):
            normal_images += 1
            false_alarm += "contradicted" in pred
        deferred += "uncertain" in pred
    classes = {}
    for label in LABELS:
        tp = matrix[label][label]
        support = sum(matrix[label].values())
        guessed = sum(matrix[g][label] for g in LABELS)
        precision = tp / guessed if guessed else 0.
        recall = tp / support if support else 0.
        classes[label] = {"precision": precision, "recall": recall, "f1": 2*precision*recall/(precision+recall) if precision+recall else 0., "support": support}
    total = sum(sum(row.values()) for row in matrix.values())
    return {"images": len(examples), "facts": total, "groups": len({example['group_id'] for example in examples}), "confusion": matrix, "classes": classes,
            "macro_f1": sum(value['f1'] for value in classes.values()) / 3, "accuracy": sum(matrix[label][label] for label in LABELS) / total if total else None,
            "error_fact_recall": classes['contradicted']['recall'], "error_images": error_images,
            "error_image_false_pass_rate": false_pass/error_images if error_images else None,
            "normal_image_false_alarm_rate": false_alarm/normal_images if normal_images else None,
            "image_abstention_rate": deferred/len(examples) if examples else None,
            "error_recall_by_kind": {kind: {**counts, "recall": counts['found_errors']/counts['gold_errors']} for kind, counts in kind_counts.items()}}


def paired_bootstrap(examples, first, second, iterations=500, seed=42):
    groups = defaultdict(list)
    for example in examples:
        groups[example["group_id"]].append(example)
    keys, rng, differences = list(groups), random.Random(seed), []
    if len(keys) < 2:
        return {"macro_f1_difference_ci95": None, "reason": "Fewer than two independent test groups"}
    for _ in range(iterations):
        sample = [row for _ in keys for row in groups[rng.choice(keys)]]
        differences.append(metrics(sample, second)["macro_f1"] - metrics(sample, first)["macro_f1"])
    differences.sort()
    return {"resampling_unit": "event_image_family", "iterations": iterations,
            "macro_f1_difference": metrics(examples, second)["macro_f1"] - metrics(examples, first)["macro_f1"],
            "macro_f1_difference_ci95": [differences[int(.025*(iterations-1))], differences[int(.975*(iterations-1))]]}


def main():
    parser = argparse.ArgumentParser(description="Complete, paired comparison on a fixed human-labelled test set")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--predictions", nargs="+", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--bootstrap", type=int, default=500)
    args = parser.parse_args()
    if args.bootstrap < 20:
        raise SystemExit("Use at least 20 bootstrap samples")
    examples = validate_examples(read_jsonl(args.manifest))
    if not examples:
        raise SystemExit("No test examples: do not manufacture performance figures")
    runs, predictions = {}, {}
    for path in args.predictions:
        name = Path(path).stem
        if name in runs:
            raise ValueError("Prediction file stems must be unique")
        rows = read_jsonl(path)
        predictions[name] = prediction_map(rows, examples, file_sha(args.manifest))
        runs[name] = {"model": rows[0]['model'], "backend": rows[0]['backend'], **metrics(examples, predictions[name]),
                      "latency_scopes":sorted({row.get('latency_scope','unspecified') for row in rows}),
                      "total_inference_seconds": sum(row.get('latency_seconds', 0) for row in rows), "prediction_sha256": file_sha(path)}
    first = next(iter(runs))
    report = {"scope": "collected_fixed_test_set_only", "manifest_sha256": file_sha(args.manifest), "runs": runs,
              "paired_against_first_run": {name: paired_bootstrap(examples, predictions[first], predictions[name], args.bootstrap) for name in runs if name != first},
              "note": "No clinical efficacy claim. Synthetic stress-set prevalence is not a generator's production error rate. Single-rater labels are provisional. Probabilities are uncalibrated. Cached-feature head latency is not comparable to end-to-end API/encoder latency."}
    Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({name: {key: value[key] for key in ['macro_f1','error_fact_recall','error_image_false_pass_rate','image_abstention_rate']} for name, value in runs.items()}, indent=2))


if __name__ == "__main__":
    main()
