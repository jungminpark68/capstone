"""Sealed development/final-test protocol for pretrained and selected LoRA conditions."""
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path
from .common import SYSTEM, file_sha, read_jsonl, validate_examples
from .evaluate import compare_runs, prediction_map, metrics
from .free_diary_data import atomic_json

DEFAULT_BASE = "Qwen/Qwen3-VL-4B-Instruct"


def directory_hash(folder):
    folder = Path(folder)
    return hashlib.sha256(json.dumps(
        [(str(p.relative_to(folder)), file_sha(p)) for p in sorted(folder.rglob("*")) if p.is_file()],
        ensure_ascii=False).encode()).hexdigest()


def create_plan(data, out, base_models=None, epochs=2, batch_size=2, accumulation=4,
                lr=1e-4, pair_weight=.25, lora_rank=16, seed=42, four_bit=True,
                max_pixels=200704, balanced=True, resolver=None, methods=None):
    data, out = Path(data).resolve(), Path(out).resolve()
    if out.exists():
        raise ValueError("Choose a new experiment directory; previous runs are preserved")
    if epochs < 1 or batch_size < 1 or accumulation < 1 or lr <= 0 or pair_weight < 0 or lora_rank < 1:
        raise ValueError("Invalid matched A/B/C settings")
    methods = list(methods if methods is not None else ("plain", "relation"))
    if not methods or len(set(methods)) != len(methods) or any(m not in ("plain", "relation") for m in methods):
        raise ValueError("Choose plain and/or relation without duplicates")
    if "relation" in methods and (batch_size < 2 or pair_weight <= 0):
        raise ValueError("Relation training needs batch size >=2 and a positive pair weight")
    info = json.loads((data / "dataset-info.json").read_text())
    if info.get("data_purpose") not in ("synthetic_controlled", "collected_human_reviewed_data"):
        raise ValueError("Use controlled schematic data or human-reviewed generated images")
    if info["data_purpose"] == "synthetic_controlled" and info.get("annotation_source") != "renderer_scene_graph_v1":
        raise ValueError("Controlled data needs renderer rule labels")
    parts = {name: validate_examples(read_jsonl(data / (name + ".jsonl")))
             for name in ("train", "dev", "test")}
    for name, rows in parts.items():
        if not rows:
            raise ValueError("Every split must be nonempty")
        for other, values in parts.items():
            if name != other:
                for key in ("group_id", "image_sha256"):
                    if {r[key] for r in rows} & {r[key] for r in values}:
                        raise ValueError("Event or image leakage between splits")
        for row in rows:
            image = (data / row["image"]).resolve()
            if not image.is_relative_to(data) or file_sha(image) != row["image_sha256"]:
                raise ValueError("Dataset images changed")
    if resolver is None:
        from .shared_encoder import checkpoint_revision
        resolver = checkpoint_revision
    models = list(dict.fromkeys(base_models or [DEFAULT_BASE]))
    if not models or any(not value.strip() for value in models):
        raise ValueError("Specify at least one public pretrained model")
    bases = [{"model": model, "revision": resolver(model)} for model in models]
    plan = {
        "schema_version": 1, "data": str(data), "out": str(out),
        "data_purpose": info["data_purpose"], "dataset_scope": info.get("dataset_scope", info["data_purpose"]),
        "split_sha256": {name: file_sha(data / (name + ".jsonl")) for name in parts},
        "dataset_info_sha256": file_sha(data / "dataset-info.json"),
        "bases": bases, "base_selection": "highest_pretrained_dev_macro_f1_then_model_name",
        "checkpoint_selection": "highest_dev_macro_f1_then_lower_dev_loss",
        "method_selection": "highest_dev_macro_f1_then_method_name",
        "system_prompt_sha256": hashlib.sha256(SYSTEM.encode()).hexdigest(),
        "settings": {"epochs": epochs, "batch_size": batch_size, "accumulation": accumulation,
                     "lr": lr, "pair_weight": pair_weight, "lora_rank": lora_rank,
                     "lora_alpha": 2 * lora_rank, "lora_dropout": .05, "seed": seed,
                     "four_bit": four_bit, "max_pixels": max_pixels, "balanced": balanced},
        "output_protocol": "same_original_LM_head_conditional_A_B_C_no_random_classifier",
        "test_used_for_selection": False,
        "methods": methods,
    }
    out.mkdir(parents=True)
    atomic_json(out / "plan.json", plan)
    return out / "plan.json"


def load_plan(path):
    plan = json.loads(Path(path).read_text())
    data = Path(plan["data"])
    for name, digest in plan["split_sha256"].items():
        if file_sha(data / (name + ".jsonl")) != digest:
            raise ValueError("The sealed dataset manifest changed")
    if file_sha(data / "dataset-info.json") != plan["dataset_info_sha256"]:
        raise ValueError("The dataset version changed")
    if hashlib.sha256(SYSTEM.encode()).hexdigest() != plan["system_prompt_sha256"]:
        raise ValueError("The shared inference prompt changed")
    return plan


def run_module(*args):
    subprocess.run([sys.executable, "-m", *map(str, args)], check=True)


def predict_condition(plan, base, split, target, adapter=None, runner=run_module):
    target = Path(target)
    manifest = Path(plan["data"]) / (split + ".jsonl")
    if target.exists():
        # Incomplete predictions are never scored or silently treated as complete.
        prediction_map(read_jsonl(target), read_jsonl(manifest), file_sha(manifest))
        return target
    args = ["diary_verifier.predict", "--manifest", manifest, "--out", target,
            "--base-model", base["model"], "--revision", base["revision"],
            "--max-pixels", plan["settings"]["max_pixels"]]
    if adapter:
        args += ["--adapter", adapter]
    if plan["settings"]["four_bit"]:
        args.append("--four-bit")
    if plan["data_purpose"] == "synthetic_controlled":
        args.append("--synthetic")
    runner(*args)
    prediction_map(read_jsonl(target), read_jsonl(manifest), file_sha(manifest))
    return target


def comparison(plan, split, paths, target):
    import csv
    import html as html_module
    report = compare_runs(Path(plan["data"]) / (split + ".jsonl"), paths, target)
    report["evaluation_split"] = split
    report["dataset_scope"] = plan["dataset_scope"]
    report["test_used_for_selection"] = False
    atomic_json(target, report)
    html = Path(target).with_suffix(".html")
    banner = ("개발(검증) 자료 · 모델과 설정을 선택하는 결과입니다. 최종 시험 성능이 아닙니다."
              if split == "dev" else "고정 시험 자료 · 개발 단계에서 봉인한 모델을 평가한 결과입니다.")
    domain = ('코드 도식형 합성 자료의 결과입니다.' if plan['data_purpose']=='synthetic_controlled'
              else '사람이 검토한 SDXL 색연필풍 대체 자료의 결과이며 실제 앱 생성 모델의 성능이 아닙니다.'
              if plan['dataset_scope'].startswith('free_sdxl') else '사람이 검토한 수집 자료 범위의 결과입니다.')
    page = html.read_text()
    page = page.replace("<h1>그림일기 판정기 성능 비교</h1>",
                        "<h1>그림일기 판정기 성능 비교</h1><p><strong>" + banner + "</strong></p><p>"+html_module.escape(domain)+"</p>")
    html.write_text(page)
    markdown=Path(target).with_suffix('.md')
    markdown.write_text(banner+'\n\n'+domain+'\n\n'+markdown.read_text(),encoding='utf-8')
    csv_path=Path(target).with_suffix('.csv')
    with csv_path.open(encoding='utf-8-sig',newline='') as stream:table=list(csv.reader(stream))
    with csv_path.open('w',encoding='utf-8-sig',newline='') as stream:
        writer=csv.writer(stream)
        writer.writerow(table[0]+['evaluation_split','dataset_scope'])
        writer.writerows(row+[split,plan['dataset_scope']] for row in table[1:])
    return report


def develop(plan_path, runner=run_module):
    plan = load_plan(plan_path)
    out, data, settings = Path(plan["out"]), Path(plan["data"]), plan["settings"]
    if (out / "test-started.json").exists():
        raise ValueError("Final testing has started; development is sealed")
    if (out / "selection.json").exists():
        raise ValueError("Development is already sealed; choose a new experiment for new settings")
    dev_rows = read_jsonl(data / "dev.jsonl")
    candidates = []
    for index, base in enumerate(plan["bases"]):
        path = predict_condition(plan, base, "dev", out / f"candidate-{index:02d}.jsonl", runner=runner)
        pred = prediction_map(read_jsonl(path), dev_rows, file_sha(data / "dev.jsonl"))
        candidates.append({"base": base, "macro_f1": metrics(dev_rows, pred)["macro_f1"],
                           "predictions": str(path)})
    candidates.sort(key=lambda row: (-row["macro_f1"], row["base"]["model"]))
    selected_base = candidates[0]["base"]
    print("Selected base on development data:", selected_base, flush=True)
    dev_folder = out / "development"
    dev_folder.mkdir(exist_ok=True)
    pretrained = dev_folder / "pretrained.jsonl"
    shutil.copyfile(candidates[0]["predictions"], pretrained)
    paths, adapter_hashes = [pretrained], {}
    for method in plan.get("methods", ["plain", "relation"]):
        weight = 0. if method == "plain" else settings["pair_weight"]
        adapter = out / method
        if not (adapter / "training-complete.json").exists():
            if adapter.exists() and any(adapter.iterdir()):
                raise ValueError("Interrupted training directory exists; preserve it and use a new experiment")
            args = ["diary_verifier.train", "--data", data, "--out", adapter,
                    "--base-model", selected_base["model"], "--revision", selected_base["revision"]]
            for key in ("epochs", "batch_size", "accumulation", "lr", "seed", "max_pixels",
                        "lora_rank", "lora_alpha", "lora_dropout"):
                args += ["--" + key.replace("_", "-"), settings[key]]
            args += ["--pair-weight", weight]
            for key in ("four_bit", "balanced"):
                if settings[key]:
                    args.append("--" + key.replace("_", "-"))
            if plan["data_purpose"] == "synthetic_controlled":
                args.append("--synthetic")
            runner(*args)
        config = json.loads((adapter / "verifier_config.json").read_text())
        if (config["base_model"] != selected_base["model"] or config["revision"] != selected_base["revision"]
                or config["pair_weight"] != weight or config["train_sha256"] != plan["split_sha256"]["train"]
                or config["dev_sha256"] != plan["split_sha256"]["dev"]):
            raise ValueError("Adapter does not match the selected model, data or loss condition")
        adapter_hashes[method] = directory_hash(adapter)
        paths.append(predict_condition(plan, selected_base, "dev", dev_folder / (method + ".jsonl"),
                                       adapter, runner))
    report = comparison(plan, "dev", paths, out / "development-comparison.json")
    chosen_method = sorted(report["runs"], key=lambda name: (-report["runs"][name]["macro_f1"], name))[0]
    selection = {"plan_sha256": file_sha(plan_path), "base": selected_base,
                 "base_candidates": candidates, "selected_method_on_dev": chosen_method,
                 "adapter_sha256": adapter_hashes, "development_report_sha256": file_sha(out / "development-comparison.json"),
                 "test_used_for_selection": False}
    atomic_json(out / "selection.json", selection)
    return selection


def final_test(plan_path, runner=run_module):
    plan = load_plan(plan_path)
    out = Path(plan["out"])
    seal_path = out / "selection.json"
    seal = json.loads(seal_path.read_text())
    if file_sha(plan_path) != seal["plan_sha256"]:
        raise ValueError("Experiment settings changed after selection")
    if file_sha(out / "development-comparison.json") != seal["development_report_sha256"]:
        raise ValueError("Development selection report changed")
    for method, digest in seal["adapter_sha256"].items():
        if directory_hash(out / method) != digest:
            raise ValueError("Selected weights changed after development")
    lock = out / "test-started.json"
    seal_sha = file_sha(seal_path)
    if lock.exists():
        if json.loads(lock.read_text())["selection_sha256"] != seal_sha:
            raise ValueError("A different model selection already used this final-test run")
    else:
        atomic_json(lock, {"selection_sha256": seal_sha, "models_fixed_before_test": True})
    folder = out / "final-test"
    folder.mkdir(exist_ok=True)
    paths = [predict_condition(plan, seal["base"], "test", folder / (method + ".jsonl"),
                               None if method == "pretrained" else out / method, runner)
             for method in ["pretrained", *plan.get("methods", ["plain", "relation"])]]
    report = comparison(plan, "test", paths, out / "final-test-comparison.json")
    atomic_json(out / "test-complete.json", {"selection_sha256": seal_sha,
                                           "report_sha256": file_sha(out / "final-test-comparison.json")})
    return report



def gallery(manifest, predictions, out, limit=12):
    """Display selected difficult examples; aggregate reports always use the full split."""
    import base64
    import html
    from . import LABELS
    rows = read_jsonl(manifest)
    mapped = {Path(path).stem: prediction_map(read_jsonl(path), rows, file_sha(manifest))
              for path in predictions}
    rows.sort(key=lambda row: -sum(
        pred[(row["id"], fact["id"])]["label"] != fact["label"]
        for pred in mapped.values() for fact in row["facts"]))
    names = {"supported": "일치", "contradicted": "불일치", "uncertain": "판단 불가"}
    cards = []
    for row in rows[:limit]:
        path = Path(manifest).parent / row["image"]
        mime = "image/png" if path.suffix == ".png" else "image/jpeg"
        image = base64.b64encode(path.read_bytes()).decode()
        table = "<tr><th>확인 사실</th><th>정답</th>" + "".join(
            "<th>" + html.escape(name) + "</th>" for name in mapped) + "</tr>"
        for fact in row["facts"]:
            table += "<tr><td>" + html.escape(fact["text"]) + "</td><td>" + names[fact["label"]] + "</td>"
            for pred in mapped.values():
                value = pred[(row["id"], fact["id"])]["label"]
                table += ("<td style='background:#fff0e7'>" if value != fact["label"] else "<td>") + names[value] + "</td>"
            table += "</tr>"
        cards.append("<article><h2>" + html.escape(row["id"]) + "</h2><img src='data:" + mime +
                     ";base64," + image + "'><p>" + html.escape(row["characters"]).replace("\n", "<br>") +
                     "</p><div class='scroll'><table>" + table + "</table></div></article>")
    page = """<!doctype html><html lang="ko"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>순정·파인튜닝 판정 비교</title><style>
body{font:16px/1.6 system-ui;background:#f8f7ef;color:#293e33;max-width:1200px;margin:auto;padding:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,450px),1fr));gap:20px}
article{background:white;border:1px solid #dce2d4;border-radius:16px;padding:20px;min-width:0}
img{width:100%;max-width:512px}.scroll{overflow:auto}table{border-collapse:collapse;font-size:13px;width:100%}
th,td{padding:8px;border-bottom:1px solid #dce2d4;min-width:60px}h2{font-size:18px}
</style><h1>그림·정답·실제 모델 예측</h1>
<p>오분류가 많은 예시부터 표시합니다. 전체 성능표는 모든 자료를 사용합니다.
도식형 자료의 정답은 구성 규칙, 실제 생성 그림의 정답은 사람 검토입니다.</p><div class="grid">"""
    Path(out).write_text(page + "".join(cards) + "</div></html>", encoding="utf-8")
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    init = sub.add_parser("init")
    init.add_argument("--data", required=True)
    init.add_argument("--out", required=True)
    init.add_argument("--base-models", nargs="+", default=[DEFAULT_BASE])
    for name, kind, default in (("epochs", int, 2), ("batch-size", int, 2), ("accumulation", int, 4),
                                ("lr", float, 1e-4), ("pair-weight", float, .25),
                                ("lora-rank", int, 16), ("seed", int, 42), ("max-pixels", int, 200704)):
        init.add_argument("--" + name, type=kind, default=default)
    init.add_argument("--no-four-bit", action="store_true")
    init.add_argument("--unbalanced", action="store_true")
    init.add_argument("--methods", nargs="+", choices=["plain", "relation"], default=["plain", "relation"])
    for command in ("develop", "test"):
        child = sub.add_parser(command)
        child.add_argument("--plan", required=True)
    args = parser.parse_args()
    if args.command == "init":
        print(create_plan(args.data, args.out, args.base_models, args.epochs, args.batch_size,
                          args.accumulation, args.lr, args.pair_weight, args.lora_rank, args.seed,
                          not args.no_four_bit, args.max_pixels, not args.unbalanced, methods=args.methods))
    elif args.command == "develop":
        print(json.dumps(develop(args.plan), ensure_ascii=False, indent=2))
    else:
        report = final_test(args.plan)
        print(json.dumps({k: v["macro_f1"] for k, v in report["runs"].items()}, indent=2))


if __name__ == "__main__":
    main()
