#!/usr/bin/python3
"""Measure free space and catan growth; emit warnings without deleting data."""
import json,os,subprocess,time
from pathlib import Path

def size(root):
    return sum(p.stat().st_size for p in Path(root).rglob('*') if p.is_file() and not p.is_symlink()) if Path(root).exists() else 0

def inspect():
    state=Path('/var/lib/catan-friends-deploy-state/storage.json')
    v=os.statvfs('/');total=v.f_blocks*v.f_frsize;free=v.f_bavail*v.f_frsize
    now=time.time();used=sum(size(p) for p in ['/opt/catan-friends/releases','/var/lib/catan-friends','/var/log/catan-friends','/var/backups/catan-friends'])
    try:old=json.loads(state.read_text())
    except (OSError,ValueError):old={}
    interval=now-old.get('baselineAt',now)
    baseline=old.get('baselineBytes',used)
    daily=max(0,used-baseline)*86400/interval if interval>=86400 else None
    days=(free-5*1024**3)/daily if daily else None
    level='critical' if free<5*1024**3 or free/total<.10 else ('warning' if free/total<.20 or (days is not None and days<14) else 'ok')
    report={'at':now,'freeBytes':free,'totalBytes':total,'catanBytes':used,'growthBytesPerDay':daily,'daysUntil5GiB':days,'level':level,'baselineAt':old.get('baselineAt',now),'baselineBytes':baseline}
    temporary=state.with_suffix('.tmp');temporary.write_text(json.dumps(report)+'\n');os.replace(temporary,state)
    if level!='ok':subprocess.run(['logger','-p','daemon.err' if level=='critical' else 'daemon.warning','-t','catan-friends',f'Storage {level}; freeMiB={free//1024**2}; check /var/lib/catan-friends-deploy-state/storage.json; no data automatically deleted.'],check=True)
    print(json.dumps({k:report[k] for k in ['freeBytes','catanBytes','growthBytesPerDay','daysUntil5GiB','level']}))

if __name__=='__main__':inspect()
