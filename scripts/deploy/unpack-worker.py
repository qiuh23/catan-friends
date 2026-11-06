"""Unpack the checked Worker artifact as bounded data, never execute its code."""
import json
import pathlib
import re
import stat
import sys
import zipfile

archive_path, destination, commit, run_id = sys.argv[1:]
root = pathlib.Path(destination)
root.mkdir(mode=0o700)
with zipfile.ZipFile(archive_path) as archive:
    entries = archive.infolist()
    if len(entries) > 2000 or sum(i.file_size for i in entries) > 100 * 1024 * 1024:
        raise ValueError('Worker artifact exceeds bounds')
    names = set()
    for item in entries:
        name = item.filename
        path = pathlib.PurePosixPath(name)
        if '\\' in name or path.is_absolute() or any(p in ('', '.', '..') for p in name.rstrip('/').split('/')) or name in names:
            raise ValueError('Unsafe or duplicate archive member')
        names.add(name)
        mode = item.external_attr >> 16
        if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)):
            raise ValueError('Unsupported archive member')
        if not (name == 'release.json' or name == 'worker/' or name == 'worker/index.js' or name.startswith('assets/')):
            raise ValueError('Unexpected Worker artifact member')
        target = root.joinpath(*path.parts)
        if item.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(item) as source, target.open('xb') as output:
                while chunk := source.read(1024 * 1024):
                    output.write(chunk)
    if not {'release.json', 'worker/index.js', 'assets/index.html', 'assets/build-info.json'} <= names:
        raise ValueError('Incomplete Worker artifact')
manifest = json.loads((root / 'release.json').read_text())
if manifest != {'schema': 1, 'stateSchema': 3, 'repository': 'qiuh23/catan-friends', 'commit': commit, 'runId': int(run_id), 'platform': 'linux', 'arch': 'x64', 'nodeMajor': 24}:
    raise ValueError('Worker release identity mismatch')
marker = json.loads((root / 'assets/build-info.json').read_text())
if marker.get('repository') != 'qiuh23/catan-friends' or marker.get('revision') != commit:
    raise ValueError('Worker assets source identity mismatch')
