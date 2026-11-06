#!/usr/bin/python3
"""Fixed root installer. SSH payload is data; no package script runs as root."""
import base64,fcntl,gzip,hashlib,io,json,os,re,shutil,subprocess,sys,tarfile,tempfile,time,urllib.request,urllib.parse,zipfile
from pathlib import Path,PurePosixPath

REPOSITORY='qiuh23/catan-friends'
BASE=Path('/opt/catan-friends')
STATE=Path('/var/lib/catan-friends-deploy-state')
MAX_ZIP=128*1024**2
MAX_TAR=256*1024**2
ALLOWED={'dist','server','shared','node_modules','package.json','package-lock.json','release.json'}
SHA=re.compile(r'[0-9a-f]{40}')
NODE='/opt/node/bin/node'

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

def request(url,maximum):
    req=urllib.request.Request(url,headers={'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'catan-friends-fixed-installer'})
    with urllib.request.build_opener(NoRedirect).open(req,timeout=45) as response:
        data=response.read(maximum+1)
    if len(data)>maximum:raise ValueError('Response exceeds bound.')
    return data

def github(suffix):return json.loads(request('https://api.github.com/repos/'+REPOSITORY+suffix,2*1024**2))

def positive(value):return type(value) is int and 0<value<10**16

def payload(raw):
    if len(raw)>16384:raise ValueError('Payload too large.')
    data=json.loads(base64.b64decode(raw,validate=True))
    if not isinstance(data,dict) or data.get('action') not in ['install','rollback']:raise ValueError('Invalid action.')
    required={'action','commit','runId'}
    if data['action']=='install':required|={'artifactId','artifactUrl','artifactSha256'}
    if set(data)!=required or not SHA.fullmatch(data.get('commit','')) or not positive(data.get('runId')):raise ValueError('Invalid release identity.')
    if data['action']=='install':
        if not positive(data['artifactId']) or not re.fullmatch(r'[0-9a-f]{64}',data['artifactSha256']):raise ValueError('Invalid artifact identity.')
        url=urllib.parse.urlsplit(data['artifactUrl'])
        if url.scheme!='https' or url.username or url.password or url.port is not None or url.fragment or not re.fullmatch(r'productionresultssa[a-z0-9]+\.blob\.core\.windows\.net',url.hostname or ''):raise ValueError('Invalid artifact download host.')
    return data

def provenance(data):
    main=github('/git/ref/heads/main')
    if main.get('object',{}).get('sha')!=data['commit']:raise ValueError('Superseded main release.')
    run=github('/actions/runs/'+str(data['runId']))
    workflow=github('/actions/workflows/checks.yml')
    repo_id=run.get('repository',{}).get('id')
    if not all([positive(repo_id),positive(workflow.get('id')),run.get('workflow_id')==workflow['id'],run.get('name')=='Checks',run.get('id')==data['runId'],run.get('head_sha')==data['commit'],run.get('head_branch')=='main',run.get('event')=='push',run.get('conclusion')=='success',run.get('status')=='completed',run.get('path')=='.github/workflows/checks.yml',run.get('repository',{}).get('full_name')==REPOSITORY,run.get('head_repository',{}).get('full_name')==REPOSITORY,run.get('head_repository',{}).get('id')==repo_id]):raise ValueError('Checks run provenance rejected.')
    artifact=github('/actions/artifacts/'+str(data['artifactId']))
    if not all([artifact.get('id')==data['artifactId'],not artifact.get('expired',True),artifact.get('digest')=='sha256:'+data['artifactSha256'],artifact.get('workflow_run',{}).get('id')==data['runId'],artifact.get('workflow_run',{}).get('head_sha')==data['commit'],artifact.get('workflow_run',{}).get('repository_id')==repo_id,artifact.get('workflow_run',{}).get('head_repository_id')==repo_id,artifact.get('name')=='node-'+data['commit']]):raise ValueError('Artifact provenance rejected.')

def safe_tar(raw,target,data):
    # Bound expanded tar bytes before parsing headers; getmembers() otherwise
    # seeks through a declared huge member before member-size validation.
    with gzip.GzipFile(fileobj=io.BytesIO(raw)) as compressed:
        expanded=compressed.read(MAX_TAR+16*1024**2+1)
    if len(expanded)>MAX_TAR+16*1024**2:raise ValueError('Expanded tar exceeds release budget.')
    with tarfile.open(fileobj=io.BytesIO(expanded),mode='r:') as archive:
        members=archive.getmembers();total=0;seen=set()
        if len(members)>20000:raise ValueError('Archive has too many entries.')
        for member in members:
            name=member.name.removeprefix('./');parts=PurePosixPath(name).parts
            if not name or name.startswith('/') or '\\' in name or any(p in ['.','..'] for p in parts) or not parts or parts[0] not in ALLOWED or name in seen or not (member.isfile() or member.isdir()):raise ValueError('Unsafe archive member.')
            seen.add(name);total+=member.size
            if total>MAX_TAR or member.size>64*1024**2:raise ValueError('Archive exceeds release budget.')
            if parts[0] in ['package.json','package-lock.json','release.json'] and len(parts)!=1:raise ValueError('Invalid top-level file.')
        required={'release.json','dist/build-info.json','server/index.js','package.json','package-lock.json'}
        if not required.issubset(seen):raise ValueError('Missing release files.')
        release=json.load(archive.extractfile(next(m for m in members if m.name.removeprefix('./')=='release.json')))
        expected={'schema':1,'stateSchema':3,'repository':REPOSITORY,'commit':data['commit'],'runId':data['runId'],'platform':'linux','arch':'x64','nodeMajor':24}
        if release!=expected:raise ValueError('Unsupported release manifest.')
        build=json.load(archive.extractfile(next(m for m in members if m.name.removeprefix('./')=='dist/build-info.json')))
        if build.get('schema')!=1 or build.get('repository')!=REPOSITORY or build.get('revision')!=data['commit']:raise ValueError('Frontend identity mismatch.')
        for member in members:
            name=member.name.removeprefix('./');destination=target/name
            if member.isdir():destination.mkdir(parents=True,exist_ok=True,mode=0o755)
            else:
                destination.parent.mkdir(parents=True,exist_ok=True,mode=0o755)
                with destination.open('xb') as output:shutil.copyfileobj(archive.extractfile(member),output)
                destination.chmod(0o644)
    return release

def unpack_zip(raw,target,data):
    if hashlib.sha256(raw).hexdigest()!=data['artifactSha256']:raise ValueError('ZIP digest mismatch.')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        names=archive.namelist()
        if sorted(names)!=['catan.tar.gz','catan.tar.gz.sha256']:raise ValueError('Unexpected artifact ZIP files.')
        if any(x.file_size>MAX_ZIP or x.flag_bits&1 for x in archive.infolist()):raise ValueError('Unsafe artifact ZIP.')
        tar=archive.read('catan.tar.gz');check=archive.read('catan.tar.gz.sha256').decode('ascii').strip()
        if not re.fullmatch(r'[0-9a-f]{64}  catan\.tar\.gz',check) or check.split()[0]!=hashlib.sha256(tar).hexdigest():raise ValueError('Tar digest mismatch.')
    return safe_tar(tar,target,data)

def run(*args):subprocess.run(args,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=60)

def link(name,target):
    temp=BASE/('.'+name+'.new');temp.unlink(missing_ok=True)
    temp.symlink_to(target);os.replace(temp,BASE/name)

def probe(commit):
    for _ in range(20):
        try:
            health=json.loads(request('http://127.0.0.1:3005/api/health',16384))
            build=json.loads(request('http://127.0.0.1:3005/build-info.json',16384))
            if health.get('ok') is True and health.get('game')=='catan-friends' and health.get('revision')==commit and build.get('revision')==commit:return
        except Exception:pass
        time.sleep(.5)
    raise ValueError('Loopback release health failed.')

def save_state(state):
    temp=STATE/'state.tmp';temp.write_text(json.dumps(state)+'\n');os.chmod(temp,0o600);os.replace(temp,STATE/'state.json')

def same_tree(expected,existing):
    def inspect(root):
        result={}
        if not root.is_dir() or root.is_symlink():raise ValueError('Invalid immutable release directory.')
        for path in sorted(root.rglob('*')):
            if path.is_symlink() or not (path.is_dir() or path.is_file()):raise ValueError('Invalid immutable release member.')
            result[path.relative_to(root).as_posix()]=None if path.is_dir() else hashlib.sha256(path.read_bytes()).hexdigest()
        return result
    if inspect(expected)!=inspect(existing):raise ValueError('Existing immutable release content differs from checked artifact.')

def rollback(data):
    state=json.loads((STATE/'state.json').read_text())
    if state.get('commit')!=data['commit'] or state.get('runId')!=data['runId']:raise ValueError('Rollback does not match current attempt.')
    current=BASE/'current'
    if not current.is_symlink() or str(current.resolve())!=state.get('current'):raise ValueError('Current pointer mismatch.')
    previous=state.get('previous')
    if previous:
        path=Path(previous)
        if path.parent!=BASE/'releases' or not path.is_dir() or path.is_symlink():raise ValueError('Invalid previous release.')
        manifest=json.loads((path/'release.json').read_text())
        if manifest.get('stateSchema')!=3:raise ValueError('Previous code cannot enforce private random/chat/moderation state. Install a compatible repair release; do not restore older game data.')
        run('systemctl','stop','catan-friends')
        link('current',path);run('systemctl','start','catan-friends');probe(manifest['commit'])
        save_state({'commit':manifest['commit'],'runId':manifest['runId'],'current':str(path),'previous':None,'rolledBackAttempt':data['commit']})
    else:
        run('systemctl','stop','catan-friends')
        current.unlink();save_state({'commit':None,'runId':None,'current':None,'previous':None,'failedFirstRelease':data['commit']})

def install(data):
    v=os.statvfs('/')
    if v.f_bavail*v.f_frsize<5*1024**3:raise ValueError('Less than 5GiB free; release refused.')
    if subprocess.check_output([NODE,'-p','process.versions.node.split(".")[0]'],text=True).strip()!='24':raise ValueError('Host requires Node24.')
    provenance(data)
    release=BASE/'releases'/(data['commit']+'-'+str(data['runId']))
    raw=request(data['artifactUrl'],MAX_ZIP)
    with tempfile.TemporaryDirectory(prefix='.stage-',dir=BASE/'releases') as temporary:
        stage=Path(temporary);unpack_zip(raw,stage,data)
        if release.exists():same_tree(stage,release)
        # Recheck immediately before a switch; slow downloads may become stale.
        provenance(data)
        if (BASE/'current').is_symlink() and (BASE/'current').resolve()==release:
            existing=json.loads((STATE/'state.json').read_text())
            if existing.get('commit')!=data['commit'] or existing.get('runId')!=data['runId']:raise ValueError('Current release state mismatch.')
            probe(data['commit'])
            return # Already applied: never overwrite its previous rollback target.
        sys.path.insert(0,'/usr/local/lib/catan-friends-ops')
        from backup import backup
        backup()
        previous=str((BASE/'current').resolve()) if (BASE/'current').is_symlink() else None
        if previous and Path(previous).parent!=BASE/'releases':raise ValueError('Invalid current pointer.')
        stage.chmod(0o755) # mkdtemp starts 0700; app user must traverse release.
        if not release.exists():
            os.rename(stage,release)
            # TemporaryDirectory must still find its directory on normal cleanup.
            stage.mkdir(mode=0o700)
    state={'commit':data['commit'],'runId':data['runId'],'current':str(release),'previous':previous}
    old_state=(STATE/'state.json').read_bytes() if (STATE/'state.json').is_file() else None
    # Persist rollback intent before touching the running service or pointer.
    # If this fails, existing code and process remain unchanged.
    save_state(state)
    try:
        run('systemctl','stop','catan-friends')
        link('current',release)
        if previous:link('previous',previous)
        run('systemctl','start','catan-friends');probe(data['commit'])
    except Exception:
        # Only this attempt is rolled back. Data directory is never replaced.
        if (BASE/'current').is_symlink() and (BASE/'current').resolve()==release:rollback(data)
        else:
            if old_state is not None:(STATE/'state.json').write_bytes(old_state)
            else:(STATE/'state.json').unlink(missing_ok=True)
            if previous:
                run('systemctl','start','catan-friends')
                probe(json.loads((Path(previous)/'release.json').read_text())['commit'])
        raise
    retained={release,Path(previous) if previous else release}
    others=sorted((p for p in (BASE/'releases').iterdir() if p.is_dir() and not p.is_symlink() and re.fullmatch(r'[0-9a-f]{40}-[1-9][0-9]*',p.name) and p not in retained),key=lambda p:p.stat().st_mtime,reverse=True)
    # Retain current + previous + one older verified release, never data.
    for old in others[1:]:shutil.rmtree(old)

def main():
    if os.geteuid()!=0 or len(sys.argv)!=1:raise ValueError('Only fixed root entry point permitted.')
    os.umask(0o022)
    data=payload(sys.stdin.buffer.read(16385).strip())
    with open(STATE/'deploy.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        (install if data['action']=='install' else rollback)(data)
    print(json.dumps({'ok':True,'action':data['action'],'commit':data['commit'],'runId':data['runId']}))

if __name__=='__main__':
    try:main()
    except Exception:raise SystemExit('Catan deployment rejected or failed. Credentials, signed URLs and room data withheld; inspect host state as administrator.')
