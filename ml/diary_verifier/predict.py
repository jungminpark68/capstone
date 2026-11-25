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
    parser.add_argument('--revision')
    parser.add_argument('--max-pixels',type=int,default=200704)
    parser.add_argument('--synthetic',action='store_true')
    args = parser.parse_args()
    from .model import LocalVerifier
    if Path(args.out).exists():
        raise SystemExit("Prediction output exists; choose a new run file")
    config = json.loads((Path(args.adapter) / "verifier_config.json").read_text()) if args.adapter else {}
    info_path=Path(args.manifest).parent/'dataset-info.json'
    purpose=json.loads(info_path.read_text()).get('data_purpose') if info_path.exists() else None
    if purpose=='synthetic_controlled' and not args.synthetic:raise SystemExit('Synthetic prediction requires explicit --synthetic')
    verifier = LocalVerifier(args.base_model, adapter=args.adapter, four_bit=args.four_bit, max_pixels=config.get('max_pixels', args.max_pixels),
                             revision=args.revision,allow_synthetic=args.synthetic)
    identity=f'{args.base_model}@{verifier.revision or "unresolved"}:4bit={args.four_bit}'
    if args.adapter:identity+=':adapter='+file_sha(Path(args.adapter)/'adapter_model.safetensors')[:16]
    backend='local_finetuned' if args.adapter else 'local_pretrained'
    if purpose=='synthetic_controlled':backend='synthetic_controlled_vlm_'+('finetuned' if args.adapter else 'pretrained')
    examples = read_jsonl(args.manifest)
    rows = []
    for example, fact in flat_examples(examples):
        before = time.perf_counter()
        probabilities = verifier.probabilities(verifier.encode([(example, fact)], Path(args.manifest).parent))[0]
        rows.append({"example_id": example['id'], "fact_id": fact['id'], "label": LABELS[max(range(3), key=probabilities.__getitem__)],
                     "probabilities": dict(zip(LABELS, probabilities)), "probabilities_calibrated": False, "latency_seconds": time.perf_counter() - before,
                     "model": identity, "backend": backend,'latency_scope':'end_to_end_encoder_and_conditional_ABC_classification',
                     "manifest_sha256": file_sha(args.manifest), "error": None})
        # Persist progress; incomplete runs are rejected by the evaluator.
        write_jsonl(args.out, rows)
    print(f"Wrote {len(rows)} predictions: {args.out}")


if __name__ == "__main__":
    main()
