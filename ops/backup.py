#!/usr/bin/python3
"""Root-only, bounded backup of atomic JSON room files; never restores data."""
import fcntl,json,os,re,tarfile,tempfile,time
from pathlib import Path

DATA=Path('/var/lib/catan-friends')
BACKUPS=Path('/var/backups/catan-friends')
STATE=Path('/var/lib/catan-friends-deploy-state')
MAX_BYTES=256*1024**2
ROOM=re.compile(r'[A-HJ-NP-Z2-9]{6}\.json')

def backup():
    if os.geteuid()!=0:raise RuntimeError('Backup requires root.')
    BACKUPS.mkdir(mode=0o700,exist_ok=True)
    with open(STATE/'backup.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        stamp=time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())
        target=BACKUPS/(stamp+'-'+str(os.getpid())+'.tar.gz')
        with tempfile.TemporaryDirectory(prefix='.snapshot-',dir=BACKUPS) as stage:
            root=Path(stage);(root/'rooms').mkdir(mode=0o700)
            size=0
            for source in sorted(DATA.iterdir()):
                if not ROOM.fullmatch(source.name):continue
                if source.is_symlink() or not source.is_file():raise RuntimeError('Invalid room file.')
                if source.stat().st_size>64*1024**2:raise RuntimeError('Room file exceeds snapshot bound.')
                try:raw=source.read_bytes()
                except FileNotFoundError:continue # expired room removed concurrently
                size+=len(raw)
                if size>MAX_BYTES:raise RuntimeError('Room snapshot exceeds backup budget; export to approved external storage.')
                record=json.loads(raw)
                if record.get('version')!=1 or not isinstance(record.get('identities'),dict):raise RuntimeError('Unsupported room state schema.')
                (root/'rooms'/source.name).write_bytes(raw)
            config=root/'config';config.mkdir(mode=0o700)
            for name,source in {
                'server.env':'/etc/catan-friends/server.env',
                'service':'/etc/systemd/system/catan-friends.service',
                'nginx':'/etc/nginx/sites-available/catan-friends',
                'release-state.json':'/var/lib/catan-friends-deploy-state/state.json',
            }.items():
                p=Path(source)
                if p.is_file() and not p.is_symlink():(config/name).write_bytes(p.read_bytes())
            (root/'snapshot.json').write_text(json.dumps({'schema':1,'stateSchema':1,'at':stamp,'rooms':len(list((root/'rooms').iterdir())),'consistency':'each room is a complete atomic saved revision; different rooms may have different capture times'})+'\n')
            temporary=target.with_suffix('.pending')
            try:
                with tarfile.open(temporary,'w:gz') as archive:archive.add(root,arcname='snapshot',recursive=True)
                os.chmod(temporary,0o600)
                if temporary.stat().st_size>MAX_BYTES:raise RuntimeError('Backup exceeds 256MiB budget.')
                os.replace(temporary,target)
            finally:temporary.unlink(missing_ok=True)
        # Retain at most 14 days AND 256MiB. Budget pressure shortens retention;
        # never touch other projects, manual archives, or current room data.
        archives=sorted(p for p in BACKUPS.glob('*.tar.gz') if re.fullmatch(r'\d{8}T\d{6}Z-\d+\.tar\.gz',p.name) and not p.is_symlink())
        for p in archives:
            if p!=target and p.stat().st_mtime<time.time()-14*86400:p.unlink()
        archives=[p for p in archives if p.exists()]
        total=sum(p.stat().st_size for p in archives)
        for p in archives:
            if total<=MAX_BYTES:break
            if p==target:continue
            total-=p.stat().st_size;p.unlink()
        return target.name

if __name__=='__main__':
    try:print('Saved backup '+backup())
    except Exception:raise SystemExit('Catan backup failed; inspect root-only storage and schema. No room data was removed.')
