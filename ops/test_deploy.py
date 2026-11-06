"""Offline safety tests. All paths, network and service operations are isolated."""
import base64,hashlib,importlib.util,io,json,os,sys,tarfile,tempfile,types,unittest,zipfile
from pathlib import Path
from unittest.mock import patch

if os.name=='nt':sys.modules.setdefault('fcntl',types.SimpleNamespace(LOCK_EX=2,flock=lambda *args:None))
spec=importlib.util.spec_from_file_location('catan_deploy',Path(__file__).with_name('deploy.py'))
deploy=importlib.util.module_from_spec(spec);spec.loader.exec_module(deploy)
SHA='a'*40
OTHER='b'*40
IDENTITY={'action':'install','commit':SHA,'runId':12,'artifactId':34,'artifactUrl':'https://productionresultssa1.blob.core.windows.net/actions/result?sig=withheld','artifactSha256':'c'*64}
MANIFEST={'schema':1,'stateSchema':3,'repository':'qiuh23/catan-friends','commit':SHA,'runId':12,'platform':'linux','arch':'x64','nodeMajor':24}

def encoded(data):return base64.b64encode(json.dumps(data).encode())

def bundle(extra=None,manifest=None):
    files={'release.json':json.dumps(manifest or MANIFEST).encode(),'dist/build-info.json':json.dumps({'schema':1,'repository':'qiuh23/catan-friends','revision':SHA}).encode(),'server/index.js':b'// app','package.json':b'{}','package-lock.json':b'{}'}
    out=io.BytesIO()
    with tarfile.open(fileobj=out,mode='w:gz') as archive:
        for name,raw in files.items():
            entry=tarfile.TarInfo(name);entry.size=len(raw);archive.addfile(entry,io.BytesIO(raw))
        if extra:archive.addfile(extra,io.BytesIO(b'x'*extra.size) if extra.isfile() else None)
    return out.getvalue()

def zipbundle(tar,extra=False):
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w') as archive:
        archive.writestr('catan.tar.gz',tar)
        archive.writestr('catan.tar.gz.sha256',hashlib.sha256(tar).hexdigest()+'  catan.tar.gz\n')
        if extra:archive.writestr('room.json','private')
    return out.getvalue()

class InstallerSafety(unittest.TestCase):
    def test_payload_requires_exact_bounded_release_identity(self):
        self.assertEqual(deploy.payload(encoded(IDENTITY)),IDENTITY)
        for update in [{'runId':True},{'commit':'../../data'},{'action':'shell'},{'command':'rm'},{'artifactUrl':'https://productionresultssa1.blob.core.windows.net.evil.example/file'},{'artifactUrl':'https://u:p@productionresultssa1.blob.core.windows.net/file'},{'artifactUrl':'https://productionresultssa1.blob.core.windows.net:443/file'},{'artifactUrl':'http://productionresultssa1.blob.core.windows.net/file'},{'artifactId':0}]:
            with self.subTest(update=update),self.assertRaises((ValueError,TypeError)):deploy.payload(encoded({**IDENTITY,**update}))
        with self.assertRaises(ValueError):deploy.payload(b'A'*16385)

    def test_valid_artifact_extracts_only_release_files(self):
        with tempfile.TemporaryDirectory() as temp:
            raw=zipbundle(bundle());data={**IDENTITY,'artifactSha256':hashlib.sha256(raw).hexdigest()}
            deploy.unpack_zip(raw,Path(temp),data)
            self.assertTrue((Path(temp)/'server/index.js').is_file())
            self.assertFalse((Path(temp)/'.data').exists())

    def test_artifact_digest_and_extra_files_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            for extra in [False,True]:
                raw=zipbundle(bundle(),extra)
                data={**IDENTITY,'artifactSha256':hashlib.sha256(raw).hexdigest() if extra else '0'*64}
                with self.assertRaises(ValueError):deploy.unpack_zip(raw,Path(temp),data)

    def test_unsafe_tar_members_and_state_schema_rejected(self):
        members=[]
        for name in ['../rooms.json','/etc/passwd','server/../../rooms.json','server\\evil','.data/ABCDEF.json','server/index.js']:
            member=tarfile.TarInfo(name);member.size=1;members.append(member)
        for kind in [tarfile.SYMTYPE,tarfile.LNKTYPE,tarfile.FIFOTYPE]:
            member=tarfile.TarInfo('server/link');member.type=kind;member.linkname='/etc/passwd';members.append(member)
        for member in members:
            with tempfile.TemporaryDirectory() as temp,self.subTest(member=member.name,kind=member.type),self.assertRaises(ValueError):deploy.safe_tar(bundle(member),Path(temp),IDENTITY)
        with tempfile.TemporaryDirectory() as temp,self.assertRaises(ValueError):deploy.safe_tar(bundle(manifest={**MANIFEST,'stateSchema':2}),Path(temp),IDENTITY)

    def test_public_provenance_rejects_stale_or_wrong_sources(self):
        main={'object':{'sha':SHA}}
        run={'id':12,'workflow_id':56,'name':'Checks','head_sha':SHA,'head_branch':'main','event':'push','conclusion':'success','status':'completed','path':'.github/workflows/checks.yml','repository':{'id':78,'full_name':'qiuh23/catan-friends'},'head_repository':{'id':78,'full_name':'qiuh23/catan-friends'}}
        workflow={'id':56}
        artifact={'id':34,'expired':False,'digest':'sha256:'+IDENTITY['artifactSha256'],'name':'node-'+SHA,'workflow_run':{'id':12,'head_sha':SHA,'repository_id':78,'head_repository_id':78}}
        with patch.object(deploy,'github',side_effect=[main,run,workflow,artifact]):deploy.provenance(IDENTITY)
        cases=[({'object':{'sha':OTHER}},run,workflow,artifact),(main,{**run,'event':'pull_request'},workflow,artifact),(main,{**run,'conclusion':'failure'},workflow,artifact),(main,{**run,'path':'.github/workflows/other.yml'},workflow,artifact),(main,{**run,'workflow_id':99},workflow,artifact),(main,run,workflow,{**artifact,'expired':True}),(main,run,workflow,{**artifact,'digest':'sha256:'+'0'*64}),(main,run,workflow,{**artifact,'workflow_run':{**artifact['workflow_run'],'head_repository_id':99}})]
        for rows in cases:
            with self.subTest(rows=rows),patch.object(deploy,'github',side_effect=rows),self.assertRaises(ValueError):deploy.provenance(IDENTITY)

    @unittest.skipIf(os.name=='nt','Real symlink lifecycle runs on Linux; archive and provenance tests still run on Windows.')
    def test_rollback_preserves_room_data_and_matches_current_attempt(self):
        with tempfile.TemporaryDirectory() as temp:
            base=Path(temp)/'app';state=Path(temp)/'state';data=Path(temp)/'data'
            base.mkdir();state.mkdir();data.mkdir();(data/'ABCDEF.json').write_text('private current room')
            releases=base/'releases';releases.mkdir();current=releases/(SHA+'-12');previous=releases/(OTHER+'-11');current.mkdir();previous.mkdir()
            (previous/'release.json').write_text(json.dumps({**MANIFEST,'commit':OTHER,'runId':11}))
            (base/'current').symlink_to(current);(state/'state.json').write_text(json.dumps({'commit':SHA,'runId':12,'current':str(current),'previous':str(previous)}))
            with patch.object(deploy,'BASE',base),patch.object(deploy,'STATE',state),patch.object(deploy,'run') as run,patch.object(deploy,'probe') as probe:
                with self.assertRaises(ValueError):deploy.rollback({'commit':OTHER,'runId':11})
                run.assert_not_called()
                deploy.rollback({'commit':SHA,'runId':12})
                self.assertEqual((base/'current').resolve(),previous)
                self.assertEqual((data/'ABCDEF.json').read_text(),'private current room')
                probe.assert_called_once_with(OTHER)

    @unittest.skipIf(os.name=='nt','Real symlink lifecycle runs on Linux.')
    def test_failed_install_rolls_back_code_without_replacing_saved_room(self):
        with tempfile.TemporaryDirectory() as temp:
            base=Path(temp)/'app';state=Path(temp)/'state';data=Path(temp)/'data'
            base.mkdir();state.mkdir();data.mkdir();(data/'ABCDEF.json').write_text('newest saved action')
            releases=base/'releases';releases.mkdir();previous=releases/(OTHER+'-11');previous.mkdir()
            (previous/'release.json').write_text(json.dumps({**MANIFEST,'commit':OTHER,'runId':11}))
            (base/'current').symlink_to(previous)
            (state/'state.json').write_text(json.dumps({'commit':OTHER,'runId':11,'current':str(previous),'previous':None}))
            raw=zipbundle(bundle());identity={**IDENTITY,'artifactSha256':hashlib.sha256(raw).hexdigest()}
            backup=unittest.mock.Mock()
            def probe(commit):
                if commit==SHA:raise ValueError('New release failed its health check.')
            with patch.object(deploy,'BASE',base),patch.object(deploy,'STATE',state),patch.object(deploy,'run'),patch.object(deploy,'probe',side_effect=probe),patch.object(deploy,'provenance'),patch.object(deploy,'request',return_value=raw),patch.object(deploy.subprocess,'check_output',return_value='24'),patch.object(deploy.os,'statvfs',return_value=types.SimpleNamespace(f_bavail=20*1024**3,f_frsize=1)),patch.dict(sys.modules,{'backup':types.SimpleNamespace(backup=backup)}):
                with self.assertRaises(ValueError):deploy.install(identity)
            backup.assert_called_once()
            self.assertEqual((base/'current').resolve(),previous)
            self.assertEqual((releases/(SHA+'-12')).stat().st_mode&0o777,0o755)
            self.assertEqual((data/'ABCDEF.json').read_text(),'newest saved action')
            self.assertEqual(json.loads((state/'state.json').read_text())['commit'],OTHER)
            # A GitHub rerun retains runId. Reuse only after comparing the fresh
            # checked artifact to the entire existing immutable tree.
            with patch.object(deploy,'BASE',base),patch.object(deploy,'STATE',state),patch.object(deploy,'run'),patch.object(deploy,'probe'),patch.object(deploy,'provenance'),patch.object(deploy,'request',return_value=raw),patch.object(deploy.subprocess,'check_output',return_value='24'),patch.object(deploy.os,'statvfs',return_value=types.SimpleNamespace(f_bavail=20*1024**3,f_frsize=1)),patch.dict(sys.modules,{'backup':types.SimpleNamespace(backup=backup)}):
                deploy.install(identity)
                target=(base/'current').resolve();old_state=(state/'state.json').read_bytes()
                deploy.install(identity) # idempotent duplicate keeps rollback pointer
            self.assertEqual(target,releases/(SHA+'-12'))
            self.assertEqual((state/'state.json').read_bytes(),old_state)
            self.assertEqual((data/'ABCDEF.json').read_text(),'newest saved action')

    def test_existing_release_reuse_rejects_modified_files_or_links(self):
        with tempfile.TemporaryDirectory() as temp:
            expected=Path(temp)/'expected';existing=Path(temp)/'existing';expected.mkdir();existing.mkdir()
            (expected/'app.js').write_text('checked');(existing/'app.js').write_text('changed')
            with self.assertRaises(ValueError):deploy.same_tree(expected,existing)
            (existing/'app.js').write_text('checked');deploy.same_tree(expected,existing)
            (existing/'extra.json').write_text('unexpected')
            with self.assertRaises(ValueError):deploy.same_tree(expected,existing)

    @unittest.skipIf(os.name=='nt','Real symlink lifecycle runs on Linux.')
    def test_state_write_failure_cannot_stop_service_or_switch_pointer(self):
        with tempfile.TemporaryDirectory() as temp:
            base=Path(temp)/'app';state=Path(temp)/'state';data=Path(temp)/'data'
            base.mkdir();state.mkdir();data.mkdir();(data/'ABCDEF.json').write_text('saved room')
            releases=base/'releases';releases.mkdir();previous=releases/(OTHER+'-11');previous.mkdir()
            (previous/'release.json').write_text(json.dumps({**MANIFEST,'commit':OTHER,'runId':11}));(base/'current').symlink_to(previous)
            old=json.dumps({'commit':OTHER,'runId':11,'current':str(previous),'previous':None});(state/'state.json').write_text(old)
            raw=zipbundle(bundle());identity={**IDENTITY,'artifactSha256':hashlib.sha256(raw).hexdigest()}
            with patch.object(deploy,'BASE',base),patch.object(deploy,'STATE',state),patch.object(deploy,'run') as run,patch.object(deploy,'save_state',side_effect=OSError('Disk write failed.')),patch.object(deploy,'provenance'),patch.object(deploy,'request',return_value=raw),patch.object(deploy.subprocess,'check_output',return_value='24'),patch.object(deploy.os,'statvfs',return_value=types.SimpleNamespace(f_bavail=20*1024**3,f_frsize=1)),patch.dict(sys.modules,{'backup':types.SimpleNamespace(backup=lambda:None)}):
                with self.assertRaises(OSError):deploy.install(identity)
                run.assert_not_called()
            self.assertEqual((base/'current').resolve(),previous)
            self.assertEqual((state/'state.json').read_text(),old)
            self.assertEqual((data/'ABCDEF.json').read_text(),'saved room')

    @unittest.skipIf(os.name=='nt','Real symlink lifecycle runs on Linux.')
    def test_rollback_rejects_legacy_state_before_touching_service_or_data(self):
        with tempfile.TemporaryDirectory() as temp:
            base=Path(temp)/'app';state=Path(temp)/'state';base.mkdir();state.mkdir();releases=base/'releases';releases.mkdir()
            current=releases/(SHA+'-12');previous=releases/(OTHER+'-11');current.mkdir();previous.mkdir()
            (previous/'release.json').write_text(json.dumps({**MANIFEST,'stateSchema':1,'commit':OTHER,'runId':11}))
            (base/'current').symlink_to(current);(state/'state.json').write_text(json.dumps({'commit':SHA,'runId':12,'current':str(current),'previous':str(previous)}))
            with patch.object(deploy,'BASE',base),patch.object(deploy,'STATE',state),patch.object(deploy,'run') as run:
                with self.assertRaisesRegex(ValueError,'compatible repair'):deploy.rollback({'commit':SHA,'runId':12})
                run.assert_not_called();self.assertEqual((base/'current').resolve(),current)

    def test_backup_can_restore_complete_private_room_record_offline(self):
        spec=importlib.util.spec_from_file_location('catan_backup',Path(__file__).with_name('backup.py'))
        backup=importlib.util.module_from_spec(spec);spec.loader.exec_module(backup)
        with tempfile.TemporaryDirectory() as temp:
            data=Path(temp)/'data';backups=Path(temp)/'backups';state=Path(temp)/'state';restored=Path(temp)/'restored'
            for p in [data,backups,state,restored]:p.mkdir()
            record={'version':3,'identities':{'hashed-secret':'player-id'},'revision':7,'random':{'algorithm':'chacha20-v1','key':[1]*8},'game':{'privateHand':[1,2]}}
            (data/'ABCDEF.json').write_text(json.dumps(record));(data/'ABCDEF.json.tmp').write_text('unfinished write')
            tombstone={'version':3,'closed':True,'revision':9};(data/'ABC234.json').write_text(json.dumps(tombstone))
            (data/'moderation').mkdir();ledger={'version':1,'audit':[{'action':'hide-chat','reason':'retained evidence'}]};(data/'moderation'/'ABCDEF.json').write_text(json.dumps(ledger))
            with patch.object(backup,'DATA',data),patch.object(backup,'BACKUPS',backups),patch.object(backup,'STATE',state),patch.object(backup.os,'geteuid',return_value=0,create=True):name=backup.backup()
            with tarfile.open(backups/name,'r:gz') as archive:
                raw=archive.extractfile('snapshot/rooms/ABCDEF.json').read()
                self.assertFalse(any(p.name.endswith('.tmp') for p in archive.getmembers()))
                self.assertEqual(json.load(archive.extractfile('snapshot/moderation/ABCDEF.json')),ledger)
                self.assertEqual(json.load(archive.extractfile('snapshot/rooms/ABC234.json')),tombstone)
                self.assertEqual(json.load(archive.extractfile('snapshot/snapshot.json'))['stateSchema'],3)
                (restored/'ABCDEF.json').write_bytes(raw)
            self.assertEqual(json.loads((restored/'ABCDEF.json').read_text()),record)
            self.assertEqual(json.loads((data/'ABCDEF.json').read_text()),record)

if __name__=='__main__':unittest.main()
