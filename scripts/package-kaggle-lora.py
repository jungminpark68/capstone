"""Package the two self-contained API-free Kaggle notebooks and Korean guide."""
import argparse
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--out", type=Path, required=True)
parser.add_argument("--generation-only",action="store_true")
args = parser.parse_args()
files = [
    (root / "ml/notebooks/memory_connect_free_diary_data_kaggle.ipynb", "01_free_diary_data.ipynb"),
    (root / "ml/notebooks/memory_connect_pretrained_lora_kaggle.ipynb", "02_pretrained_vs_lora.ipynb"),
    (root / "docs/kaggle-pretrained-lora-guide.md", "README.md"),
]
if args.generation_only:files=[files[0],files[2]]
for path, _ in files:
    if path.suffix!=".ipynb":continue
    notebook = json.loads(path.read_text(encoding="utf-8"))
    assert notebook["metadata"]["memory_connect"]["self_contained"]
    assert all(not cell.get("outputs") for cell in notebook["cells"])
args.out.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(args.out, "w", ZIP_DEFLATED) as archive:
    for path, name in files:
        archive.write(path, "memory-kaggle-v0.17/" + name)
with ZipFile(args.out) as archive:
    assert archive.testzip() is None
print(f"Created {args.out.name}: {args.out.stat().st_size} bytes")
