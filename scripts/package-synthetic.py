"""Package the self-contained synthetic Kaggle notebook without outputs or weights."""
import argparse
import json
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
root=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--out',type=Path,required=True)
args=parser.parse_args()
notebook=root/'ml/notebooks/memory_connect_synthetic_kaggle.ipynb'
value=json.loads(notebook.read_text(encoding='utf-8'))
assert value['metadata']['memory_connect']['self_contained'] is True
assert all(not cell.get('outputs') for cell in value['cells'])
args.out.parent.mkdir(parents=True,exist_ok=True)
with ZipFile(args.out,'w',ZIP_DEFLATED) as archive:
    archive.write(notebook,'memory-synthetic-v0.15/memory_connect_synthetic_kaggle.ipynb')
    archive.write(root/'docs/kaggle-synthetic-guide.md','memory-synthetic-v0.15/README.md')
print(f'Created {args.out.name}: {args.out.stat().st_size} bytes')
