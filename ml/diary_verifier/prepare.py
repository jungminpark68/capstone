"""Convert human-reviewed app exports into image/group-disjoint train/dev/test sets."""
import argparse
import base64
import hashlib
import json
import random
import re
import io
from collections import Counter
from pathlib import Path
from .common import write_jsonl, validate_examples


def convert_records(records, output):
    output = Path(output)
    (output / "images").mkdir(parents=True, exist_ok=True)
    rows, seen = [], {}
    for record in records:
        provenance = record.get("imageProvenance", {})
        if provenance.get("kind") not in ("generated_api", "uploaded_generated") or record.get("humanSource") != "manual_review":
            raise ValueError("Only AI-generated images with explicit manual_review labels can enter this dataset. Examples and unknown sources are rejected.")
        scene = record.get("record", {})
        if scene.get("confirmed") is not True or not scene.get("id"):
            raise ValueError("A user-confirmed scene ID is required")
        match = re.fullmatch(r"data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)", record.get("image", ""))
        if not match:
            raise ValueError("Expected an embedded PNG/JPEG/WebP; SVG demonstrations are not training data")
        data = base64.b64decode(match[2], validate=True)
        valid = data.startswith(b"\x89PNG\r\n\x1a\n") if match[1] == "png" else data.startswith(b"\xff\xd8\xff") if match[1] == "jpeg" else data[:4] == b"RIFF" and data[8:12] == b"WEBP"
        if not valid or len(data) > 12_000_000:
            raise ValueError("Invalid image header or excessive image size")
        from PIL import Image
        with Image.open(io.BytesIO(data)) as image:
            if image.width * image.height > 20_000_000:
                raise ValueError('Excessive image dimensions')
            image.verify()
        digest = hashlib.sha256(data).hexdigest()
        relative = f"images/{digest}.{match[1]}"
        (output / relative).write_bytes(data)
        labels = record.get("humanLabels", {})
        facts = [{"id": fact["id"], "text": fact["text"], "kind": fact.get("kind", "other"), "label": labels.get(fact["id"])} for fact in record.get("facts", [])]
        key = (digest, scene["id"], tuple((fact["text"], fact["label"]) for fact in facts))
        if key in seen:
            continue
        chars = "\n".join(f"{person['alias']}({person['name']}): {person.get('visual', '')}" for person in scene.get("people", []))
        row = {"id": f"image-{len(rows)+1:06d}", "source_record_id":record.get('id'), "event_id": scene["id"], "group_id": scene["id"], "image_sha256": digest, "image": relative,
               "scene": scene.get("scene", ""), "characters": chars, "facts": facts, "annotation_status": "single_reviewer",
               "generation": provenance, "human_source": record["humanSource"], "prompt_family_id": record.get("promptFamilyId") or provenance.get("promptFamilyId"),
               "origin_image_id": record.get("originImageId") or provenance.get("originImageId")}
        rows.append(row)
        seen[key] = row["id"]
    validate_examples(rows)
    # Same image/claim with conflicting labels must be adjudicated, never silently majority-voted.
    judgments = {}
    for row in rows:
        for fact in row["facts"]:
            key = (row["image_sha256"], fact["text"], row["characters"])
            if key in judgments and judgments[key] != fact["label"]:
                raise ValueError("Conflicting human labels for the same image/claim; resolve before training")
            judgments[key] = fact["label"]
    return rows


def split_groups(rows, seed=42):
    parent = list(range(len(rows)))
    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    keys = {}
    for i, row in enumerate(rows):
        links = [("event", row["event_id"]), ("image", row["image_sha256"]), ("image", row.get("origin_image_id")), ("source",row.get('source_record_id')), ("source",row.get('origin_image_id')), ("family", row.get("prompt_family_id"))]
        for kind, value in links:
            if not value:
                continue
            key = (kind, value)
            if key in keys:
                parent[root(i)] = root(keys[key])
            keys[key] = i
    groups = {}
    for i, row in enumerate(rows):
        groups.setdefault(root(i), []).append(row)
    if len(groups) < 3:
        raise ValueError("At least 3 independent event/image families are needed for disjoint train/dev/test. Current data are insufficient.")
    families = list(groups.values())
    random.Random(seed).shuffle(families)
    n_dev = max(1, round(len(families) * .15))
    n_test = max(1, round(len(families) * .15))
    buckets = {"dev": families[:n_dev], "test": families[n_dev:n_dev+n_test], "train": families[n_dev+n_test:]}
    split = {}
    for name, blocks in buckets.items():
        split[name] = []
        for block in blocks:
            group = "group-" + hashlib.sha256("|".join(sorted(item["id"] for item in block)).encode()).hexdigest()[:16]
            for row in block:
                row["group_id"] = group
                split[name].append(row)
    return split


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("exports", nargs="+")
    parser.add_argument("--out", required=True)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    output = Path(args.out)
    if (output / "dataset-info.json").exists():
        raise SystemExit("Output already contains a dataset; select a new version directory")
    records = []
    for path in args.exports:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        records.extend(data["records"])
    try:
        rows = convert_records(records, output)
        split = split_groups(rows, args.seed)
    except (ValueError, KeyError, TypeError) as error:
        raise SystemExit(str(error)) from error
    for name, items in split.items():
        write_jsonl(output / f"{name}.jsonl", items)
    info = {"schema_version": 1, "seed": args.seed, "sample_scope": "human_reviewed_collected_sample", "data_purpose":"collected_human_reviewed_data", "trained_model": False,
            "splits": {name: {"images": len(items), "groups": len({row['group_id'] for row in items}), "labels": dict(Counter(fact["label"] for row in items for fact in row["facts"]))} for name, items in split.items()},
            "warning": "Single-reviewer labels require independent review/adjudication for a formal fixed test set. Counterfactual stress data do not estimate generator error prevalence."}
    (output / "dataset-info.json").write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(info, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
