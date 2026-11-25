"""Software protocol tests. Tiny random models and fixtures are never research scores."""
import ast
import contextlib
import csv
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import torch
from PIL import Image
from diary_verifier import LABELS
from diary_verifier.common import read_jsonl, write_jsonl, file_sha
from diary_verifier.synthetic import create_dataset
from diary_verifier.free_diary_data import jobs, generate, prepare_reviewed, review_template
from diary_verifier.vlm_benchmark import create_plan, develop, final_test, gallery

ML = Path(__file__).resolve().parents[1]


class FakePipeline:
    def __init__(self):
        self.calls = 0

    def __call__(self, **kwargs):
        self.calls += 1
        return SimpleNamespace(images=[Image.new("RGB", (512, 512),
                                                  (self.calls % 255, 80, 100))])


class AblationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(2)

    def test_bulk_jobs_keep_intentions_separate_from_unknown_truth(self):
        rows = jobs(1000)
        self.assertEqual(len(rows), 1000)
        self.assertEqual(len({row["id"] for row in rows}), 1000)
        self.assertEqual(len({row["event_id"] for row in rows}), 91)
        self.assertTrue(all(f["label"] is None for row in rows for f in row["facts"]))
        self.assertEqual(rows[0]["facts"], rows[1]["facts"])
        self.assertNotEqual(rows[0]["generation_prompt"], rows[1]["generation_prompt"])
        self.assertIn("colored-pencil", rows[0]["generation_prompt"])
        self.assertEqual(jobs(20), rows[:20])

    def test_generation_resumes_and_preserves_human_work(self):
        with tempfile.TemporaryDirectory() as folder, contextlib.redirect_stdout(io.StringIO()):
            root = Path(folder)
            pipeline = FakePipeline()
            generate(root, total=3, size=512, pipeline=pipeline, revision="test-revision")
            self.assertEqual(pipeline.calls, 3)
            path = root / "human-review.csv"
            with path.open(encoding="utf-8-sig", newline="") as stream:
                reviews = list(csv.DictReader(stream))
            reviews[0].update(label="uncertain", reviewer="test-reviewer")
            with path.open("w", encoding="utf-8-sig", newline="") as stream:
                writer = csv.DictWriter(stream, fieldnames=list(reviews[0]))
                writer.writeheader()
                writer.writerows(reviews)
            generate(root, total=5, size=512, pipeline=pipeline, revision="test-revision")
            self.assertEqual(pipeline.calls, 5)
            with path.open(encoding="utf-8-sig", newline="") as stream:
                updated = list(csv.DictReader(stream))
            self.assertEqual(updated[0]["label"], "uncertain")
            self.assertEqual(len(updated), 40)
            self.assertTrue(all(f["label"] is None for row in read_jsonl(root / "generated-manifest.jsonl")
                                for f in row["facts"]))
            with self.assertRaisesRegex(ValueError, "settings changed"):
                generate(root, total=5, size=512, steps=30, pipeline=pipeline, revision="test-revision")
            with self.assertRaisesRegex(ValueError, "Software-test"):
                prepare_reviewed(root, root / "rejected")
            image = root / read_jsonl(root / "generated-manifest.jsonl")[0]["image"]
            image.write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "image changed"):
                generate(root, total=5, size=512, pipeline=pipeline, revision="test-revision")

    def test_sdxl_revision_uses_diffusers_model_index(self):
        with tempfile.TemporaryDirectory() as folder:
            snapshot='/fixture/snapshots/'+'a'*40+'/model_index.json'
            with patch('huggingface_hub.hf_hub_download',return_value=snapshot) as download, \
                 patch('torch.cuda.is_available',return_value=False):
                with self.assertRaisesRegex(ValueError,'Enable a Kaggle CUDA GPU'):
                    generate(folder,total=1)
            self.assertEqual(download.call_args.args[1],'model_index.json')

    def test_reviewed_preparation_excludes_unreviewed_and_groups_families(self):
        # Handcrafted fixture exercises a reviewed-data converter, not generator quality.
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            create_dataset(root / "fixture", events=6)
            rows = sum([read_jsonl(root / "fixture" / (name + ".jsonl"))
                        for name in ("train", "dev", "test")], [])
            source = root / "source"
            source.mkdir()
            import shutil
            shutil.copytree(root / "fixture/images", source / "images")
            for row in rows:
                row["generation"] = {"source": "local_sdxl", "model": "software-fixture-only"}
            write_jsonl(source / "generated-manifest.jsonl", rows)
            (source / "generator-settings.json").write_text(json.dumps(
                {"source": "local_sdxl", "model": "software-fixture-only"}))
            path = review_template(source)
            truths = {(r["id"], f["id"]): f["label"] for r in rows for f in r["facts"]}
            with path.open(encoding="utf-8-sig", newline="") as stream:
                reviews = list(csv.DictReader(stream))
            for r in reviews:
                if r["image_id"] != rows[0]["id"]:
                    r["label"] = truths[(r["image_id"], r["fact_id"])]
                    r["reviewer"] = "fixture-reviewer"
            with path.open("w", encoding="utf-8-sig", newline="") as stream:
                writer = csv.DictWriter(stream, fieldnames=list(reviews[0]))
                writer.writeheader()
                writer.writerows(reviews)
            info = prepare_reviewed(source, root / "ready")
            self.assertEqual(info["pending_images_excluded"], 1)
            self.assertEqual(info["reviewed_images"], len(rows) - 1)
            parts = [read_jsonl(root / "ready" / (name + ".jsonl")) for name in ("train", "dev", "test")]
            for i, values in enumerate(parts):
                for other in parts[i + 1:]:
                    self.assertFalse({r["event_id"] for r in values} & {r["event_id"] for r in other})

    def test_development_never_predicts_test_and_final_checks_seal(self):
        with tempfile.TemporaryDirectory() as folder, contextlib.redirect_stdout(io.StringIO()):
            root = Path(folder)
            data = root / "data"
            create_dataset(data, events=6)
            plan_path = create_plan(data, root / "experiment", ["fixture/base"],
                                    resolver=lambda _: "a" * 40)
            calls = []

            def runner(*args):
                calls.append(args)
                def arg(name):
                    return args[args.index(name) + 1]
                if args[0].endswith(".train"):
                    out = Path(arg("--out"))
                    out.mkdir()
                    (out / "adapter_model.safetensors").write_bytes(b"SOFTWARE FIXTURE")
                    config = {"base_model": arg("--base-model"), "revision": arg("--revision"),
                              "pair_weight": arg("--pair-weight"),
                              "train_sha256": file_sha(data / "train.jsonl"),
                              "dev_sha256": file_sha(data / "dev.jsonl")}
                    (out / "verifier_config.json").write_text(json.dumps(config))
                    (out / "training-complete.json").write_text("{}")
                else:
                    manifest, out = Path(arg("--manifest")), Path(arg("--out"))
                    rows = [{"example_id": r["id"], "fact_id": f["id"], "label": "supported",
                             "error": None, "model": "constant-software-fixture",
                             "backend": "software_test_fixture_vlm",
                             "manifest_sha256": file_sha(manifest)}
                            for r in read_jsonl(manifest) for f in r["facts"]]
                    write_jsonl(out, rows)

            seal = develop(plan_path, runner)
            self.assertTrue(all(not (Path(args[args.index("--manifest") + 1]).name == "test.jsonl")
                                for args in calls if "--manifest" in args))
            training = [args for args in calls if args[0].endswith(".train")]
            self.assertEqual(len(training), 2)
            def normalized(args):
                args = list(args)
                for name in ("--out", "--pair-weight"):
                    index = args.index(name)
                    args[index + 1] = "MATCHED"
                return args
            self.assertEqual(normalized(training[0]), normalized(training[1]))
            seal_sha = file_sha(root / "experiment/selection.json")
            weight = root / "experiment/plain/adapter_model.safetensors"
            original = weight.read_bytes()
            weight.write_bytes(b"MODIFIED")
            with self.assertRaisesRegex(ValueError, "weights changed"):
                final_test(plan_path, runner)
            weight.write_bytes(original)
            final_test(plan_path, runner)
            self.assertEqual(file_sha(root / "experiment/selection.json"), seal_sha)
            test_calls = [args for args in calls if "--manifest" in args
                          and Path(args[args.index("--manifest") + 1]).name == "test.jsonl"]
            self.assertEqual(len(test_calls), 3)
            with self.assertRaisesRegex(ValueError, "development is sealed"):
                develop(plan_path, runner)
            paths = [root / "experiment/final-test" / (name + ".jsonl")
                     for name in ("pretrained", "plain", "relation")]
            gallery(data / "test.jsonl", paths, root / "gallery.html", limit=2)
            self.assertIn("오분류가 많은", (root / "gallery.html").read_text())
            plan = json.loads(plan_path.read_text())
            plan["settings"]["lr"] = .002
            plan_path.write_text(json.dumps(plan))
            with self.assertRaisesRegex(ValueError, "settings changed"):
                final_test(plan_path, runner)


    def test_real_tiny_qwen_lora_lifecycle_without_claiming_pretrained_accuracy(self):
        # Random tiny Qwen3-VL weights test library integration only; no performance is reported.
        from transformers import Qwen3VLConfig, Qwen3VLForConditionalGeneration, BatchEncoding
        from diary_verifier.model import LocalVerifier
        from diary_verifier.train import main as train_main

        class Processor:
            def __init__(self):
                self.tokenizer = SimpleNamespace(encode=lambda token, **_: [{"A":1,"B":2,"C":3}[token]])

            def apply_chat_template(self, messages, **kwargs):
                return json.dumps(messages, ensure_ascii=False)

            def __call__(self, text, images, **kwargs):
                return BatchEncoding({"input_ids": torch.tensor([[4,5,6]] * len(text)),
                                      "attention_mask": torch.ones(len(text),3,dtype=torch.long)})

            def save_pretrained(self, folder):
                (Path(folder) / "processor-fixture.json").write_text("{}")

        def tiny_model(*args, **kwargs):
            torch.manual_seed(123)
            config = Qwen3VLConfig(
                text_config={"vocab_size":32,"hidden_size":32,"intermediate_size":64,
                             "num_hidden_layers":1,"num_attention_heads":4,"num_key_value_heads":2,
                             "head_dim":8,"rope_parameters":{"rope_type":"default",
                             "rope_theta":10000.0,"mrope_section":[1,1,2]}},
                vision_config={"depth":1,"hidden_size":32,"intermediate_size":64,
                               "num_heads":4,"out_hidden_size":32,"deepstack_visual_indexes":[]})
            return Qwen3VLForConditionalGeneration(config)

        original = LocalVerifier
        def cpu_factory(*args, **kwargs):
            return original(*args, device="cpu", **kwargs)

        with tempfile.TemporaryDirectory() as folder, contextlib.redirect_stdout(io.StringIO()):
            root = Path(folder)
            create_dataset(root / "data", events=6)
            with patch("transformers.AutoProcessor.from_pretrained",side_effect=lambda *a,**k:Processor()), \
                 patch("transformers.AutoModelForImageTextToText.from_pretrained",side_effect=tiny_model):
                pretrained = original("fixture/tiny",device="cpu",revision="a"*40)
                self.assertFalse(pretrained.trained)
                argv = ["train","--data",str(root/"data"),"--out",str(root/"adapter"),
                        "--base-model","fixture/tiny","--revision","a"*40,"--synthetic",
                        "--epochs","1","--batch-size","2","--accumulation","2","--lora-rank","2",
                        "--lora-alpha","4","--balanced"]
                with patch.object(sys,"argv",argv),patch("torch.cuda.is_available",return_value=True), \
                     patch("diary_verifier.model.LocalVerifier",side_effect=cpu_factory):
                    train_main()
                config = json.loads((root/"adapter/verifier_config.json").read_text())
                self.assertEqual(config["output_protocol"],"conditional_next_token_A_B_C_no_new_classifier")
                self.assertEqual(config["best_epoch"],1)
                self.assertFalse(config["test_used_for_selection"])
                self.assertTrue((root/"adapter/adapter_model.safetensors").is_file())
                with self.assertRaisesRegex(ValueError,"explicit opt-in"):
                    original("fixture/tiny",adapter=root/"adapter",device="cpu")
                restored = original("fixture/tiny",adapter=root/"adapter",device="cpu",allow_synthetic=True)
                self.assertFalse(restored.trained)
                example = read_jsonl(root/"data/dev.jsonl")[0]
                probabilities = restored.probabilities(restored.encode([(example,example["facts"][0])],root/"data"))
                self.assertAlmostEqual(sum(probabilities[0]),1.,places=5)
                self.assertEqual(restored.revision,"a"*40)
                self.assertEqual(restored.backend_mode,"synthetic_controlled_vlm_finetuned")
    def test_notebooks_are_self_contained_and_do_not_call_paid_apis(self):
        for name in ("memory_connect_free_diary_data_kaggle.ipynb",
                     "memory_connect_pretrained_lora_kaggle.ipynb"):
            notebook = json.loads((ML / "notebooks" / name).read_text())
            sources = []
            for cell in notebook["cells"]:
                if cell["cell_type"] == "code":
                    source = "".join(cell["source"])
                    ast.parse(source)
                    self.assertEqual(cell["outputs"], [])
                    sources.append(source)
                    if source.startswith("BUNDLED_SOURCES="):
                        bundle = ast.literal_eval(ast.parse(source).body[0].value)
                        for path, text in bundle.items():
                            self.assertEqual(text, (ML / path).read_text())
            combined = "".join(sources)
            self.assertNotIn("api.openai.com", combined)
            self.assertNotIn("DIARY_API_KEY", combined)
            self.assertTrue(notebook["metadata"]["memory_connect"]["self_contained"])
        self.assertIn("RUN_FINAL_TEST=False", combined)


if __name__ == "__main__":
    unittest.main()
