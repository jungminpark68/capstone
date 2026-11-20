"""Explicit, separately billed API baseline using the same whitelisted context."""
import argparse
import base64
import hashlib
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from . import LABELS
from .common import SYSTEM, context_text, flat_examples, read_jsonl, write_jsonl, file_sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--model", required=True, help="Use an available strong model/snapshot; no deliberately weak default")
    parser.add_argument("--out", required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    items = flat_examples(read_jsonl(args.manifest))
    if args.dry_run:
        print(json.dumps({"model": args.model, "calls": len(items), "paid_calls": 0, "note": "Images and human labels are not sent in dry-run"}))
        return
    key = os.environ.get("DIARY_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not key:
        raise SystemExit("Set DIARY_API_KEY or OPENAI_API_KEY in the runtime secrets/environment; never put keys in datasets")
    if Path(args.out).exists():
        raise SystemExit("Output exists; choose a new run file")
    rows, root, manifest_sha = [], Path(args.manifest).parent.resolve(), file_sha(args.manifest)
    for example, fact in items:
        path = (root / example["image"]).resolve()
        if not path.is_relative_to(root) or hashlib.sha256(path.read_bytes()).hexdigest() != example["image_sha256"]:
            raise ValueError("Image is outside the dataset or changed since annotation")
        suffix = path.suffix.lower().lstrip(".")
        mime = "jpeg" if suffix in ("jpg", "jpeg") else suffix
        payload = {"model": args.model, "response_format": {"type": "json_object"}, "messages": [
            {"role": "system", "content": SYSTEM + '\nJSON {"label":"supported|contradicted|uncertain","reason":"짧은 관찰 근거"}만 반환한다.'},
            {"role": "user", "content": [{"type": "text", "text": context_text(example, fact)}, {"type": "image_url", "image_url": {"url": f"data:image/{mime};base64," + base64.b64encode(path.read_bytes()).decode(), "detail": "high"}}]}]}
        request = urllib.request.Request("https://api.openai.com/v1/chat/completions", data=json.dumps(payload).encode(), headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
        row = {"example_id": example["id"], "fact_id": fact["id"], "model": args.model, "backend": "baseline_vlm", "manifest_sha256": manifest_sha}
        started = time.perf_counter()
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                result = json.load(response)
            value = json.loads(result["choices"][0]["message"]["content"])
            if value.get("label") not in LABELS:
                raise ValueError("Invalid API classification label")
            row.update(label=value["label"], reason=value.get("reason", ""), usage=result.get("usage"), returned_model=result.get("model"), error=None)
        except urllib.error.HTTPError as error:
            row.update(label=None, error=f"HTTP {error.code}")
        except Exception as error:
            row.update(label=None, error=type(error).__name__)
        row["latency_seconds"] = time.perf_counter() - started
        rows.append(row)
        write_jsonl(args.out, rows)
        if row["error"]:
            raise SystemExit(f"API run stopped on {row['error']}; no fabricated labels were written. Inspect configuration and start a new run. The evaluator rejects incomplete coverage.")
    print(f"Wrote {len(rows)} API predictions: {args.out}")


if __name__ == "__main__":
    main()
