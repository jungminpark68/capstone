import argparse
import json
import time
from pathlib import Path
from . import BASE_MODEL, LABELS
from .common import read_jsonl, flat_examples, write_jsonl, file_sha


def main():
    parser = argparse.ArgumentParser(description="Predict labels without exposing human annotations to the model")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--base-model", required=True)
    parser.add_argument("--adapter")
    parser.add_argument("--four-bit", action="store_true")
    args = parser.parse_args()
    from .model import LocalVerifier
    if Path(args.out).exists():
        raise SystemExit("Prediction output exists; choose a new run file")
    config = json.loads((Path(args.adapter) / "verifier_config.json").read_text()) if args.adapter else {}
    verifier = LocalVerifier(args.base_model, adapter=args.adapter, four_bit=args.four_bit, max_pixels=config.get('max_pixels', 200704))
    examples = read_jsonl(args.manifest)
    rows = []
    for example, fact in flat_examples(examples):
        before = time.perf_counter()
        probabilities = verifier.probabilities(verifier.encode([(example, fact)], Path(args.manifest).parent))[0]
        rows.append({"example_id": example['id'], "fact_id": fact['id'], "label": LABELS[max(range(3), key=probabilities.__getitem__)],
                     "probabilities": dict(zip(LABELS, probabilities)), "probabilities_calibrated": False, "latency_seconds": time.perf_counter() - before,
                     "model": str(args.adapter or args.base_model), "backend": "local_finetuned" if args.adapter else "local_pretrained",
                     "manifest_sha256": file_sha(args.manifest), "error": None})
        # Persist progress; incomplete runs are rejected by the evaluator.
        write_jsonl(args.out, rows)
    print(f"Wrote {len(rows)} predictions: {args.out}")


if __name__ == "__main__":
    main()
