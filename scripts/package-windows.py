"""Create a portable source ZIP without Git metadata, credentials, or caches."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import argparse
root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--out', type=Path, default=root.parent / 'memory-diary-windows.zip')
parser.add_argument('--prefix', default='memory-diary')
args = parser.parse_args()
if not args.prefix or '/' in args.prefix or '\\' in args.prefix or args.prefix in ('.','..'):
    parser.error('Use a single directory name for --prefix')
output = args.out
output.parent.mkdir(parents=True, exist_ok=True)
files = ['package.json', '.gitignore', '.env.example', 'start-windows.cmd', 'README.md', 'CHANGELOG.md',
         'demo.html', 'verification-demo.html']
files.extend(path.name for path in root.glob('*.js'))
for folder in ['public', 'scripts', 'test']:
    files.extend(str(p.relative_to(root)) for p in (root / folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts)
for folder in ['ml', 'docs']:
    files.extend(str(p.relative_to(root)) for p in (root / folder).rglob('*')
                 if p.is_file() and p.suffix in ('.py','.md','.txt','.ipynb')
                 and not {'__pycache__','features','data','runs','presentations'} & set(p.relative_to(root).parts))
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for name in sorted(set(files)):
        source = root / name
        if source.name == '.env' or source.suffix == '.log':
            raise RuntimeError('Credential or log file must not be packaged')
        data = source.read_bytes()
        if name == 'start-windows.cmd':
            data = data.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
        archive.writestr(args.prefix + '/' + Path(name).as_posix(), data)
with ZipFile(output) as archive:
    assert archive.testzip() is None
    assert not any(name.endswith('/.env') or '/.git/' in name for name in archive.namelist())
    for name in ['verification.js', 'scene-pipeline.js', 'ml/diary_verifier/fusion_train.py', 'ml/notebooks/memory_connect_fusion_kaggle.ipynb']:
        assert args.prefix + '/' + name in archive.namelist(), f'Missing runtime/research source: {name}'
    print(f'Created {output.name}: {len(archive.namelist())} files, {output.stat().st_size} bytes')
