"""Package only the standalone verifier, notebooks and guide; never weights/data/keys."""
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
root=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--out',type=Path,required=True)
parser.add_argument('--prefix',default='memory-verifier-v0.14')
args=parser.parse_args()
if not args.prefix or Path(args.prefix).name!=args.prefix or '\\' in args.prefix:parser.error('Use a single directory name')
files={}
for folder in ['ml/diary_verifier','ml/tests']:
    for path in (root/folder).glob('*.py'):files[path.relative_to(root).as_posix()]=path.read_bytes()
for relative in ['ml/requirements-fusion.txt','ml/README.md','ml/make_fusion_notebooks.py','ml/notebooks/memory_connect_verifier_kaggle.ipynb','ml/notebooks/memory_connect_verifier_colab.ipynb']:
    files[relative]=(root/relative).read_bytes()
for name in ['kaggle-verifier-guide.md','model-selection-and-sharing.md','verification-prototype.md','diary-data-and-questions.md']:
    files['docs/'+name]=(root/'docs'/name).read_bytes()
files['README.md']=(root/'docs/kaggle-verifier-guide.md').read_bytes()
manifest={'version':json.loads((root/'package.json').read_text())['version'],'contains_trained_weights':False,'contains_training_images':False,'files':{name:hashlib.sha256(data).hexdigest() for name,data in files.items()}}
files['package-manifest.json']=json.dumps(manifest,ensure_ascii=False,indent=2).encode()
args.out.parent.mkdir(parents=True,exist_ok=True)
with ZipFile(args.out,'w',ZIP_DEFLATED) as archive:
    for name,data in sorted(files.items()):archive.writestr(args.prefix+'/'+name,data)
with ZipFile(args.out) as archive:
    assert archive.testzip() is None
    assert all(not n.endswith(('.pt','.safetensors','.env')) for n in archive.namelist())
print(f'Created {args.out.name}: {len(files)} files, {args.out.stat().st_size} bytes')
