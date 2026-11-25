"""Free local SDXL generation with resumable jobs and mandatory human labels.

Requested edits are generation intentions, never ground-truth labels.
"""
import argparse
import csv
import hashlib
import json
import math
import shutil
from collections import Counter
from pathlib import Path
from .common import read_jsonl, write_jsonl, file_sha, validate_examples
from .synthetic import make_event, variant, event_facts, CASE_LABELS, COLORS, ACTIONS

DEFAULT_MODEL = "stabilityai/stable-diffusion-xl-base-1.0"
STYLE = (
    "A warm hand-drawn colored-pencil diary illustration on lightly textured ivory paper, "
    "simple friendly characters, clear outlines, soft pastel color areas, visible pencil strokes. "
    "A coherent single scene, full bodies and hands visible, distinct clothing colors, "
    "clearly recognizable actions and objects, uncluttered composition, no text or captions. "
    "Illustration rather than a photograph or a 3D render. "
)
NEGATIVE = "photograph, photorealistic, 3d render, text, watermark, blurry, indistinct objects"
ACTION_EN = {
    "bike": "riding a bicycle", "read": "holding an open book in both hands",
    "cup": "holding a cup in one hand", "bench": "sitting on a bench",
}


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(path)


def jobs(total=20, seed=42):
    if total < 1:
        raise ValueError("total must be positive")
    cases = list(CASE_LABELS)
    result = []
    for index in range(total):
        event_index, case_index = divmod(index, len(cases))
        expected = make_event(seed + 1009 * event_index)
        case = cases[case_index]
        requested = variant(expected, case)
        a, b = expected["actors"]
        row = {
            "id": f"sdxl-{seed}-{index:06d}",
            "event_id": f"sdxl-event-{seed}-{event_index:05d}",
            "group_id": f"sdxl-event-{seed}-{event_index:05d}",
            "scene": f"{'공원' if expected['place']=='park' else '집 안'}에서 A는 {ACTIONS[a['action']][0]}. B는 {ACTIONS[b['action']][0]}.",
            "characters": "\n".join(
                f"{p['id']}: {COLORS[p['color']][1]} 상의의 {'어르신' if p['id']=='A' else '아이'}"
                for p in expected["actors"]),
            "facts": [{**fact, "label": None} for fact in event_facts(expected)],
            "planned_variant": case,
            "generation_seed": seed + 7919 * index,
        }
        parts = [STYLE, "The setting is " +
                 ("a leafy public park." if requested["place"] == "park" else "a home living room.")]
        for person in requested["actors"]:
            who = "an older adult" if person["id"] == "A" else "a child"
            if not person["present"]:
                parts.append(f"Do not depict {who} in the {person['color']} shirt.")
                continue
            side = "left" if person["x"] < 192 else "right"
            action = ACTION_EN[person["action"]]
            if not person["has_object"]:
                action = {
                    "bike": "posing as if cycling, but without any bicycle",
                    "read": "holding both hands as if reading, but with no book",
                    "cup": "holding one empty hand in front, with no cup",
                    "bench": "in a seated pose, but with no bench or chair under the body",
                }[person["action"]]
            parts.append(f"On the {side}, {who} in a {person['color']} shirt is {action}.")
            if person["occluded"]:
                parts.append(f"An opaque foreground screen hides the {who}'s full body and objects.")
        if requested["extra_person"]:
            parts.append("One additional person in a gray shirt is standing in the center.")
        parts.append(f"A separate small table in the lower foreground holds exactly "
                     f"{requested['apple_count']} {requested['apple_color']} apples.")
        if requested["apples_occluded"]:
            parts.append("A large opaque cloth completely hides all apples on the table.")
        row["generation_prompt"] = " ".join(parts)
        result.append(row)
    return result


def generate(out, total=20, seed=42, steps=25, size=1024, guidance=6.5,
             model=DEFAULT_MODEL, cpu_offload=True, pipeline=None, revision=None):
    """A pipeline can be injected for software tests; no model scores are inferred."""
    out = Path(out)
    (out / "images").mkdir(parents=True, exist_ok=True)
    if steps < 1 or size < 512 or size % 64 or guidance <= 0:
        raise ValueError("Use positive steps/guidance and size >=512 divisible by 64")
    settings_path = out / "generator-settings.json"
    previous = json.loads(settings_path.read_text()) if settings_path.exists() else None
    if revision is None:
        if previous:
            revision = previous["revision"]
        elif pipeline is not None:
            raise ValueError("An injected software-test pipeline must identify its revision")
        else:
            from huggingface_hub import hf_hub_download
            # Diffusers repositories pin model_index.json, not a root config.json.
            revision = Path(hf_hub_download(model, "model_index.json")).parent.name
            if len(revision) != 40 or any(c not in "0123456789abcdef" for c in revision):
                raise ValueError("Could not resolve the immutable SDXL checkpoint revision")
    settings = {"model": model, "revision": revision, "seed": seed, "steps": steps,
                "size": size, "guidance": guidance, "style": STYLE, "negative_prompt": NEGATIVE,
                "annotation_policy": "human_labels_required_not_prompt_intentions",
                "source": "software_test_fixture" if pipeline is not None else "local_sdxl"}
    if previous and previous != settings:
        raise ValueError("Generation settings changed; choose a new source directory")
    atomic_json(settings_path, settings)
    desired = jobs(total, seed)
    ledger_path = out / "generated-manifest.jsonl"
    rows = read_jsonl(ledger_path) if ledger_path.exists() else []
    by_id = {row["id"]: row for row in rows}
    for row in rows:
        if file_sha(out / row["image"]) != row["image_sha256"]:
            raise ValueError("A previously generated image changed")
    for job in desired:
        if job['id'] in by_id and by_id[job['id']]['generation_prompt'] != job['generation_prompt']:
            raise ValueError('Existing job has a different prompt')
    if all(job['id'] in by_id for job in desired):
        review_template(out)
        print('All requested images already exist; no generation model was loaded.',flush=True)
        return rows
    if pipeline is None:
        import torch
        if not torch.cuda.is_available():
            raise ValueError("Enable a Kaggle CUDA GPU for free SDXL generation")
        from diffusers import StableDiffusionXLPipeline
        pipeline = StableDiffusionXLPipeline.from_pretrained(
            model, revision=revision, variant="fp16",
            torch_dtype=torch.float16, use_safetensors=True)
        if cpu_offload:
            pipeline.enable_model_cpu_offload()
        else:
            pipeline.to("cuda")
        pipeline.vae.enable_slicing()
    for job in desired:
        if job["id"] in by_id:
            if by_id[job["id"]]["generation_prompt"] != job["generation_prompt"]:
                raise ValueError("Existing job has a different prompt")
            continue
        import torch
        result = pipeline(prompt=job["generation_prompt"], negative_prompt=NEGATIVE,
                          num_inference_steps=steps, guidance_scale=guidance,
                          height=size, width=size,
                          generator=torch.Generator(device="cpu").manual_seed(job["generation_seed"]))
        relative = "images/" + job["id"] + ".jpg"
        target = out / relative
        temp = target.with_suffix(".tmp")
        result.images[0].convert("RGB").save(temp, format="JPEG", quality=92)
        temp.replace(target)
        row = {**job, "image": relative, "image_sha256": file_sha(target),
               "annotation_status": "pending_human_review",
               "generation": {"model": model, "revision": revision, "steps": steps,
                              "size": size, "guidance": guidance, "style": STYLE,
                              "source": settings["source"]}}
        rows.append(row)
        by_id[row["id"]] = row
        temp_ledger = ledger_path.with_suffix(".tmp")
        write_jsonl(temp_ledger, rows)
        temp_ledger.replace(ledger_path)
        review_template(out)
        print(f"Generated {len(rows)} / requested {total}: {row['id']}", flush=True)
    return rows


def review_template(root):
    root = Path(root)
    target = root / "human-review.csv"
    existing = {}
    if target.exists():
        with target.open(encoding="utf-8-sig", newline="") as stream:
            for row in csv.DictReader(stream):
                key = (row["image_id"], row["fact_id"])
                if key in existing:
                    raise ValueError("Duplicate review row")
                existing[key] = row
    fields = ["image_id", "fact_id", "image", "fact_text", "label", "reviewer", "notes", "draft_label", "review_mode"]
    values = []
    for image in read_jsonl(root / "generated-manifest.jsonl"):
        for fact in image["facts"]:
            value = existing.get((image["id"], fact["id"]), {})
            if value and (value["fact_text"] != fact["text"] or value["image"] != image["image"]):
                raise ValueError("Review CSV no longer matches the generated facts")
            values.append(dict(zip(fields, [image["id"], fact["id"], image["image"],
                                           fact["text"], value.get("label", ""),
                                           value.get("reviewer", ""), value.get("notes", ""),value.get('draft_label',''),
                                           value.get('review_mode','manual' if value.get('label') else '')])))
    temp = target.with_suffix(".tmp")
    with temp.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(values)
    temp.replace(target)
    return target


def prepare_reviewed(root, out, seed=42):
    """Only complete, explicit human reviews enter training; incomplete images stay pending."""
    from . import LABELS
    from .prepare import split_groups
    root, out = Path(root), Path(out)
    if out.exists():
        raise ValueError("Choose a new versioned reviewed dataset directory")
    settings = json.loads((root / "generator-settings.json").read_text())
    if settings.get("source") != "local_sdxl":
        raise ValueError("Software-test pictures cannot be labelled as real generated training data")
    images = read_jsonl(root / "generated-manifest.jsonl")
    lookup = {}
    with (root / "human-review.csv").open(encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            key = (row["image_id"], row["fact_id"])
            if key in lookup:
                raise ValueError("Duplicate review")
            lookup[key] = row
    reviewed = []
    for image in images:
        facts = []
        for fact in image["facts"]:
            row = lookup.get((image["id"], fact["id"]))
            if row is None or row["fact_text"] != fact["text"] or row["image"] != image["image"]:
                raise ValueError("Review must match exact image and fact")
            if not row["label"]:
                continue
            if row["label"] not in LABELS or not row["reviewer"].strip():
                raise ValueError("A valid human label and reviewer ID are required")
            facts.append({**fact, "label": row["label"], 'draft_label':row.get('draft_label',''), 'review_mode':row.get('review_mode','manual')})
        if len(facts) != len(image["facts"]):
            continue
        if file_sha(root / image["image"]) != image["image_sha256"]:
            raise ValueError("Image bytes changed after review")
        reviewed.append({**image, "facts": facts, "annotation_status": "single_reviewer",
                         "human_source": "manual_review", "data_purpose": "collected_human_reviewed_data"})
    validate_examples(reviewed)
    if len({row["event_id"] for row in reviewed}) < 6:
        raise ValueError("Review at least 6 independent events before making train/dev/test")
    registry_path=root/'review-splits.json'
    if registry_path.exists():
        from .draft_labels import ensure_registry
        registry=ensure_registry(root)
        parts={name:[] for name in ('train','dev','test')}
        for image in reviewed:
            split=registry['events'][image['event_id']]
            if split=='test' and any(lookup[(image['id'],f['id'])].get('review_mode') not in ('blind','manual') for f in image['facts']):
                raise ValueError('Test labels must be blind human reviews')
            parts[split].append(image)
        if any(not rows for rows in parts.values()):raise ValueError('Review more events to fill the fixed train/dev/test splits')
        for first,rows in parts.items():
            for second,values in parts.items():
                if first!=second and {r['image_sha256'] for r in rows}&{r['image_sha256'] for r in values}:raise ValueError('Same image leaked across fixed splits')
    else:
        parts = split_groups(reviewed, seed)
    out.mkdir(parents=True)
    (out / "images").mkdir()
    if registry_path.exists():shutil.copyfile(registry_path,out/'review-splits.json')
    for row in reviewed:
        shutil.copyfile(root / row["image"], out / row["image"])
    for name, rows in parts.items():
        write_jsonl(out / (name + ".jsonl"), rows)
    info = {
        "schema_version": 1, "data_purpose": "collected_human_reviewed_data",
        "dataset_scope": "free_sdxl_colored_pencil_proxy_human_reviewed_not_app_generator",
        "generator": settings, "reviewed_images": len(reviewed),
        "pending_images_excluded": len(images) - len(reviewed),
        "splits": {name: {"images": len(rows),
                           "groups": len({row["group_id"] for row in rows}),
                           "labels": dict(Counter(f["label"] for row in rows for f in row["facts"]))}
                   for name, rows in parts.items()},
        "warning": "Requested variants are not truth. Independent review is needed for a formal test set. "
                   "This SDXL proxy domain does not measure the app generator's production error rate.",
    }
    atomic_json(out / "dataset-info.json", info)
    return info




def save_review(root,image_id,labels,reviewer):
    from . import LABELS
    from .draft_labels import ensure_registry,suggestions
    root=Path(root)
    registry=ensure_registry(root)
    image=next(r for r in read_jsonl(root/'generated-manifest.jsonl') if r['id']==image_id)
    if not reviewer.strip() or set(labels)!={f['id'] for f in image['facts']} or any(v not in LABELS for v in labels.values()):
        raise ValueError('Reviewer and complete explicit labels are required')
    blind=registry['events'][image['event_id']]=='test'
    drafts={} if blind else suggestions(root,registry)
    review_template(root)
    with (root/'human-review.csv').open(encoding='utf-8-sig',newline='') as stream:values=list(csv.DictReader(stream))
    for row in values:
        if row['image_id']==image_id:
            draft=drafts.get((image_id,row['fact_id']),{}).get('label','')
            row.update(label=labels[row['fact_id']],reviewer=reviewer.strip(),draft_label=draft,
                       review_mode='blind' if blind else 'assisted' if draft else 'manual')
    temporary=root/'human-review.tmp'
    with temporary.open('w',encoding='utf-8-sig',newline='') as stream:
        writer=csv.DictWriter(stream,fieldnames=list(values[0]));writer.writeheader();writer.writerows(values)
    temporary.replace(root/'human-review.csv')
def review_widget(root, start=0, reviewer=""):
    """Show only source facts and pixels; requested error types are hidden to reduce priming."""
    import ipywidgets as widgets
    from IPython.display import display, clear_output, HTML
    root = Path(root)
    rows = read_jsonl(root / "generated-manifest.jsonl")
    if not rows:
        raise ValueError("Generate images first")
    review_template(root)
    from .draft_labels import ensure_registry,suggestions
    registry=ensure_registry(root)
    drafts=suggestions(root,registry)
    position = [min(max(0, start), len(rows) - 1)]
    panel, status = widgets.Output(), widgets.Output()
    reviewer_box = widgets.Text(value=reviewer, description="검토자 ID")
    previous = widgets.Button(description="이전")
    following = widgets.Button(description="다음")
    save = widgets.Button(description="정답 저장 후 다음", button_style="success")
    dropdowns = []

    def read_reviews():
        with (root / "human-review.csv").open(encoding="utf-8-sig", newline="") as stream:
            return list(csv.DictReader(stream))

    def show():
        import html
        row = rows[position[0]]
        blind=registry['events'][row['event_id']]=='test'
        lookup = {(r["image_id"], r["fact_id"]): r for r in read_reviews()}
        dropdowns.clear()
        with panel:
            clear_output(wait=True)
            display(HTML(f"<b>{position[0]+1} / {len(rows)}</b><p>{html.escape(row['scene'])}</p>"
                         f"<p>{html.escape(row['characters']).replace(chr(10), '<br>')}</p>"))
            print('최종 평가용 · 초벌 답을 숨긴 직접 판정' if blind else '학습/검증용 · 초벌 답을 확인하고 틀린 항목만 수정하세요.')
            from PIL import Image
            with Image.open(root / row["image"]) as image:
                thumbnail = image.copy()
                thumbnail.thumbnail((600, 600))
                display(thumbnail)
            for fact in row["facts"]:
                choice = widgets.Dropdown(
                    options=[("미판정", ""), ("일치", "supported"), ("불일치", "contradicted"),
                             ("판단 불가", "uncertain")],
                    value=lookup[(row["id"], fact["id"])]["label"] or ('' if blind else drafts.get((row['id'],fact['id']),{}).get('label','')),
                    description=fact["id"], layout=widgets.Layout(width="100%"))
                dropdowns.append(choice)
                display(widgets.HTML(value=html.escape(fact["text"])), choice)

    def move(delta):
        position[0] = min(max(0, position[0] + delta), len(rows) - 1)
        show()

    def save_current(_):
        with status:
            clear_output(wait=True)
            if not reviewer_box.value.strip() or any(not choice.value for choice in dropdowns):
                print("검토자 ID와 모든 사실의 판정을 입력하세요. 가려져 확인할 수 없으면 판단 불가입니다.")
                return
            row = rows[position[0]]
            selected = {fact["id"]: choice.value for fact, choice in zip(row["facts"], dropdowns)}
            save_review(root,row['id'],selected,reviewer_box.value)
            print("사람 정답 저장:", row["id"])
        move(1)

    previous.on_click(lambda _: move(-1))
    following.on_click(lambda _: move(1))
    save.on_click(save_current)
    display(widgets.VBox([reviewer_box, widgets.HBox([previous, following, save]), status, panel]))
    show()
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    gen = sub.add_parser("generate")
    gen.add_argument("--out", required=True)
    gen.add_argument("--total", type=int, default=20)
    gen.add_argument("--seed", type=int, default=42)
    gen.add_argument("--steps", type=int, default=25)
    gen.add_argument("--size", type=int, default=1024)
    gen.add_argument("--guidance", type=float, default=6.5)
    gen.add_argument("--model", default=DEFAULT_MODEL)
    gen.add_argument("--no-cpu-offload", action="store_true")
    prep = sub.add_parser("prepare")
    prep.add_argument("--source", required=True)
    prep.add_argument("--out", required=True)
    prep.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    if args.command == "generate":
        generate(args.out, args.total, args.seed, args.steps, args.size, args.guidance,
                 args.model, not args.no_cpu_offload)
    else:
        print(json.dumps(prepare_reviewed(args.source, args.out, args.seed), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
