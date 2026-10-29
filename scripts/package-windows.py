"""Create a portable source ZIP without Git metadata, credentials, or caches."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path(__file__).resolve().parent.parent
output = root.parent / 'memory-diary-windows.zip'
files = ['package.json', '.gitignore', '.env.example', 'start-windows.cmd', 'README.md',
         'server.js', 'api-errors.js', 'diary.js', 'prompts.js', 'demo.html']
for folder in ['public', 'scripts', 'test']:
    files.extend(str(p.relative_to(root)) for p in (root / folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts)
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for name in sorted(set(files)):
        source = root / name
        if source.name == '.env' or source.suffix == '.log':
            raise RuntimeError('Credential or log file must not be packaged')
        data = source.read_bytes()
        if name == 'start-windows.cmd':
            data = data.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
        archive.writestr('memory-diary/' + Path(name).as_posix(), data)
with ZipFile(output) as archive:
    assert archive.testzip() is None
    assert not any(name.endswith('/.env') or '/.git/' in name for name in archive.namelist())
    print(f'Created {output.name}: {len(archive.namelist())} files, {output.stat().st_size} bytes')
