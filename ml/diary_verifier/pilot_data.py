"""Fixed-group pilot collection, explicit human review and GPU experiment input.

Machine drafts never become training labels. Held-out test hints are stripped.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import random
import re
import shutil
import tempfile

from . import LABELS
from .common import file_sha, read_jsonl, validate_examples, write_jsonl

SOURCE_SCHEMA = "memory-itda-verifier-pilot-source-v1"
REVIEW_SCHEMA = "memory-itda-verifier-human-review-v1"


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":")).encode()).hexdigest()


def load_source(path):
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    core = {k: v for k, v in value.items() if k != "dataset_id"}
    if value.get("schema") != SOURCE_SCHEMA or value.get("dataset_id") != fingerprint(core):
        raise ValueError("Pilot source fingerprint changed; use the original collection")
    for row in value["items"]:
        if value["groups"][row["group_id"]] == "test" and any(
                "draft_label" in f or "draft_reason" in f for f in row["facts"]):
            raise ValueError("Test suggestions must not be included")
    return value


def make_source(manifest, out, seed=42):
    manifest, out = Path(manifest).resolve(), Path(out).resolve()
    if out.exists():
        raise ValueError("Choose a new source directory; existing files are preserved")
    rows = read_jsonl(manifest)
    groups = sorted({r["group_id"] for r in rows})
    if len(groups) < 6:
        raise ValueError("Use at least six independent event groups for this pilot")
    random.Random(seed).shuffle(groups)
    n_dev = max(1, round(len(groups) * .2))
    n_test = max(1, round(len(groups) * .2))
    n_train = len(groups) - n_dev - n_test
    registry = {g: "train" if i < n_train else "dev" if i < n_train+n_dev else "test"
                for i, g in enumerate(groups)}
    items, ids, hashes = [], set(), {}
    for row in rows:
        if row.get("generation", {}).get("kind") not in ("generated_api", "uploaded_generated"):
            raise ValueError("Only generated-image pilot sources are accepted")
        if not isinstance(row.get("id"), str) or not re.fullmatch(r"[\w-]{1,100}", row["id"]):
            raise ValueError("Use a plain image ID without path separators")
        if row["id"] in ids:
            raise ValueError("Duplicate image ID")
        ids.add(row["id"])
        path = (manifest.parent / row["image"]).resolve()
        if not path.is_relative_to(manifest.parent) or not path.is_file() or path.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
            raise ValueError("Image must be inside the source directory")
        digest = file_sha(path)
        if digest != row.get("image_sha256"):
            raise ValueError("Source image bytes changed")
        if digest in hashes and hashes[digest] != row["group_id"]:
            raise ValueError("The same image belongs to different event groups")
        hashes[digest] = row["group_id"]
        fact_ids, facts = set(), []
        for fact in row["facts"]:
            if not fact.get("id") or fact["id"] in fact_ids or not fact.get("text", "").strip():
                raise ValueError("Invalid/duplicate source fact")
            fact_ids.add(fact["id"])
            value = {"id": fact["id"], "kind": fact.get("kind", "other"), "text": fact["text"]}
            if registry[row["group_id"]] != "test" and fact.get("draft_label") in LABELS:
                value.update(draft_label=fact["draft_label"],
                             draft_reason=fact.get("draft_reason", "AI 초벌 · 직접 확인 필요"))
            facts.append(value)
        if not facts:
            raise ValueError("Every image needs facts")
        items.append({"id": row["id"], "event_id": row.get("event_id", row["group_id"]),
                      "group_id": row["group_id"], "image": "images/" + row["id"] + path.suffix.lower(),
                      "image_sha256": digest, "scene": row["scene"], "characters": row["characters"],
                      "facts": facts, "generation": row["generation"]})
    core = {"schema": SOURCE_SCHEMA, "seed": seed, "groups": registry, "items": items,
            "scope": "chat_generated_colored_pencil_pilot_not_app_generator",
            "prior_drafts_existed_for_all_images": True,
            "source_note": "AI 초벌은 정답이 아닙니다. 시험용 초벌과 생성 의도는 이 묶음에서 제거했습니다. 기존 20장 예비 자료이며 새 독립 평가 자료를 대체하지 않습니다."}
    source = {**core, "dataset_id": fingerprint(core)}
    # Validate everything before creating the destination.
    out.mkdir(parents=True)
    (out / "images").mkdir()
    for original, item in zip(rows, items):
        shutil.copyfile(manifest.parent / original["image"], out / item["image"])
    (out / "pilot-source.json").write_text(json.dumps(source, ensure_ascii=False, indent=2), encoding="utf-8")
    return source


def prepare_reviewed(source_path, review_path, out):
    source_path, out = Path(source_path).resolve(), Path(out).resolve()
    source = load_source(source_path)
    if out.exists():
        raise ValueError("Choose a new dataset directory; existing data are preserved")
    review = json.loads(Path(review_path).read_text(encoding="utf-8-sig"))
    if review.get("software_test_only") is True:
        raise ValueError("Software-test reviews are not human training labels")
    if review.get("schema") != REVIEW_SCHEMA or review.get("dataset_id") != source["dataset_id"]:
        raise ValueError("Review file belongs to a different pilot collection")
    lookup = {}
    for row in review.get("reviews", []):
        if row.get("image_id") in lookup:
            raise ValueError("Duplicate reviewed image")
        lookup[row.get("image_id")] = row
    expected = {r["id"] for r in source["items"]}
    if set(lookup) != expected:
        raise ValueError(f"Complete all {len(expected)} images first; reviewed {len(set(lookup)&expected)}. Machine drafts cannot fill missing labels.")
    parts = {name: [] for name in ("train", "dev", "test")}
    image_paths = []
    hashes = {}
    for item in source["items"]:
        r = lookup[item["id"]]
        split = source["groups"][item["group_id"]]
        if r.get("confirmed_by_human") is not True or not isinstance(r.get("reviewer"), str) or not r["reviewer"].strip():
            raise ValueError("Explicit human confirmation and reviewer ID are required")
        if r.get("review_mode") not in ("assisted", "blind") or split == "test" and r["review_mode"] != "blind":
            raise ValueError("Test labels must be reviewed without suggestions")
        if r.get("image_sha256") != item["image_sha256"]:
            raise ValueError("Review image fingerprint changed")
        labels = r.get("labels", {})
        if not isinstance(labels, dict) or set(labels) != {f["id"] for f in item["facts"]} or any(v not in LABELS for v in labels.values()):
            raise ValueError("Every fact needs an explicit supported/contradicted/uncertain label")
        path = (source_path.parent / item["image"]).resolve()
        if not path.is_relative_to(source_path.parent) or file_sha(path) != item["image_sha256"]:
            raise ValueError("Source image changed after review")
        digest = item["image_sha256"]
        if digest in hashes and hashes[digest] != split:
            raise ValueError("Same image leaked across data splits")
        hashes[digest] = split
        facts = [{"id": f["id"], "kind": f["kind"], "text": f["text"], "label": labels[f["id"]]}
                 for f in item["facts"]]
        parts[split].append({**{k: item[k] for k in ("id", "event_id", "group_id", "image", "image_sha256", "scene", "characters", "generation")},
                             "facts": facts, "annotation_status": "single_reviewer",
                             "human_source": "manual_review", "reviewer": r["reviewer"].strip(),
                             "review_mode": r["review_mode"]})
        image_paths.append((path, item["image"]))
    for name, values in parts.items():
        validate_examples(values)
        if not values:
            raise ValueError("Every fixed split must have reviewed images")
    counts = Counter(f["label"] for row in parts["train"] for f in row["facts"])
    missing = [label for label in LABELS if not counts[label]]
    if missing:
        raise ValueError("Human-reviewed training data lack " + ", ".join(missing) + ". Add genuinely matching examples in a new collection; do not relabel clear pictures as uncertain.")
    info = {"schema_version": 1, "data_purpose": "collected_human_reviewed_data",
            "dataset_scope": "chat_generated_colored_pencil_20_image_pilot_single_reviewer_not_app_generator",
            "dataset_id": source["dataset_id"], "review_sha256": file_sha(review_path),
            "source_sha256": file_sha(source_path), "pilot_only": True,
            "prior_drafts_existed_for_all_images": source["prior_drafts_existed_for_all_images"],
            "test_review_suggestions_visible": False,
            "splits": {name: {"images": len(rows), "facts": sum(len(r["facts"]) for r in rows),
                              "groups": len({r["group_id"] for r in rows}),
                              "labels": dict(Counter(f["label"] for r in rows for f in r["facts"]))}
                       for name, rows in parts.items()},
            "warning": "20-image pilot with single-rater labels. Prior AI drafts existed. No production generator error-rate or clinical efficacy claim."}
    out.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix="pilot-preparing-", dir=out.parent))
    try:
        (temporary / "images").mkdir()
        for path, relative in image_paths:
            shutil.copyfile(path, temporary / relative)
        for name, values in parts.items():
            write_jsonl(temporary / (name + ".jsonl"), values)
        (temporary / "dataset-info.json").write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.rename(out)
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return info


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    make = sub.add_parser("source")
    make.add_argument("--manifest", required=True)
    make.add_argument("--out", required=True)
    make.add_argument("--seed", type=int, default=42)
    prepare = sub.add_parser("prepare")
    prepare.add_argument("--source", required=True)
    prepare.add_argument("--reviews", required=True)
    prepare.add_argument("--out", required=True)
    args = parser.parse_args()
    result = make_source(args.manifest, args.out, args.seed) if args.command == "source" else prepare_reviewed(args.source, args.reviews, args.out)
    print(json.dumps({k: v for k, v in result.items() if k != "items"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
