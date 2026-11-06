import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { repository, selectRelease } from '../scripts/deploy/gate.mjs';
import { cloudAssistantCommand, cloudflareRequest, marker, mayRollbackWorker, publicOrigin, runWorkerDeploy, signedArtifactURL, transientCloudflareCommand } from '../scripts/deploy/release.mjs';

const commit = 'a'.repeat(40), workflowId = 41;
test('Cloudflare management reads survive transient 503, rate limiting and transport failures', async () => {
  const waits = [], responses = [new Response('busy', {status:503}), new Response('limited', {status:429, headers:{'Retry-After':'3'}}), new TypeError('network failed'), Response.json({success:true})];
  const fetchImpl = async (_url, init) => {assert.equal(init.method,'GET');assert(init.signal);const next=responses.shift();if(next instanceof Error)throw next;return next;};
  const result=await cloudflareRequest('https://api.cloudflare.com/test',{method:'GET'},{fetchImpl,sleep:async ms=>waits.push(ms)});
  assert.equal(result.status,200);assert.deepEqual(waits,[1000,3000,4000]);assert.equal(responses.length,0);
});
test('Cloudflare read retries are bounded and respect a capped Retry-After date', async () => {
  let calls=0;const waits=[],now=Date.UTC(2026,10,6);
  const result=await cloudflareRequest('https://api.cloudflare.com/test',{method:'GET'},{fetchImpl:async()=>{calls++;return new Response('busy',{status:503,headers:{'Retry-After':new Date(now+120000).toUTCString()}});},sleep:async ms=>waits.push(ms),now:()=>now});
  assert.equal(result.status,503);assert.equal(calls,4);assert.deepEqual(waits,[30000,30000,30000]);
});
test('Cloudflare authorization failures and deployment mutations are never retried', async () => {
  for(const [method,status] of [['GET',403],['POST',503]]){
    let calls=0;const result=await cloudflareRequest('https://api.cloudflare.com/test',{method},{fetchImpl:async()=>{calls++;return new Response('failed',{status});},sleep:async()=>assert.fail('must not retry')});
    assert.equal(result.status,status);assert.equal(calls,1);
  }
  let calls=0;await assert.rejects(cloudflareRequest('https://api.cloudflare.com/test',{method:'GET'},{fetchImpl:async()=>{calls++;throw new DOMException('timed out','TimeoutError');},sleep:async()=>{}}),/timed out/);assert.equal(calls,4);
});
test('fixed Wrangler retries transient provider errors against the same artifact and rechecks current main', async () => {
  const calls=[],waits=[];let checks=0;
  await runWorkerDeploy({commit},{directory:'.local/tool',config:'/fixed/catan-wrangler.json',checkCurrent:async()=>{checks++;},execute:args=>{calls.push([...args]);return calls.length===1?{status:1,stderr:'GET /accounts/id/workers/scripts/catan-friends/deployments -> 503 Service Unavailable'}:{status:0};},sleep:async ms=>waits.push(ms),report:()=>{}});
  assert.equal(checks,2);assert.equal(calls.length,2);assert.deepEqual(calls[0],['deploy','--no-bundle','--config','/fixed/catan-wrangler.json']);assert.deepEqual(calls[1],calls[0]);assert.deepEqual(waits,[2000]);
});
test('fixed Wrangler stops on superseded main, permanent errors and exhausted retry budget', async () => {
  for(const output of ['Authentication error [code:10000] HTTP 503','Configuration error: invalid binding','Validation error: asset upload failed','permission denied','missing wrangler executable'])assert.equal(transientCloudflareCommand(output),false);
  let calls=0,checks=0;
  await assert.rejects(runWorkerDeploy({commit},{directory:'.local/tool',config:'/fixed/config',checkCurrent:async()=>{if(++checks===2)throw Error('superseded main');},execute:()=>{calls++;return {status:1,stderr:'upstream connect error'};},sleep:async()=>{},report:()=>{}}),/superseded/);assert.equal(calls,1);
  calls=0;await assert.rejects(runWorkerDeploy({commit},{directory:'.local/tool',config:'/fixed/config',checkCurrent:async()=>{},execute:()=>{calls++;return {status:1,stderr:'HTTP 503'};},sleep:async()=>{},report:()=>{}}),/deployment failed/);assert.equal(calls,4);
  calls=0;await assert.rejects(runWorkerDeploy({commit},{directory:'.local/tool',config:'/fixed/config',checkCurrent:async()=>{},execute:()=>{calls++;return {status:1,stderr:'Configuration error'};},sleep:async()=>assert.fail('must not retry'),report:()=>{}}),/deployment failed/);assert.equal(calls,1);
});
function fixture() {
  const run = { id: 123, workflow_id: workflowId, name: 'Checks', path: '.github/workflows/checks.yml', event: 'push', status: 'completed', conclusion: 'success', head_branch: 'main', head_sha: commit, repository: { id: 17, full_name: repository }, head_repository: { id: 17, full_name: repository } };
  const artifacts = ['node', 'worker'].map((kind, i) => ({ id: i + 201, name: `${kind}-${commit}`, expired: false, digest: `sha256:${'b'.repeat(64)}`, workflow_run: { id: run.id, head_sha: commit, repository_id: 17, head_repository_id: 17 } }));
  return { run, artifacts };
}
test('only the exact successful own-repository main push and workflow identity can release', () => {
  const { run, artifacts } = fixture();
  assert.equal(selectRelease(run, commit, artifacts, workflowId).commit, commit);
  for (const patch of [{ event: 'pull_request' }, { event: 'workflow_dispatch' }, { head_branch: 'other' }, { head_sha: 'c'.repeat(40) }, { conclusion: 'failure' }, { status: 'in_progress' }, { path: '.github/workflows/evil.yml' }, { workflow_id: 999 }, { repository: { id: 17, full_name: 'Jack15678/catan-friends' } }, { head_repository: { id: 18, full_name: repository } }]) assert.equal(selectRelease({ ...run, ...patch }, commit, artifacts, workflowId), null);
  assert.equal(selectRelease(run, 'c'.repeat(40), artifacts, workflowId), null);
});
test('ambiguous, expired, substituted and unverifiable artifacts fail closed', () => {
  const { run, artifacts } = fixture();
  for (const patch of [{ expired: true }, { digest: undefined }, { digest: 'sha256:bad' }, { id: -1 }, { workflow_run: { ...artifacts[0].workflow_run, id: 999 } }, { workflow_run: { ...artifacts[0].workflow_run, head_repository_id: 18 } }]) assert.throws(() => selectRelease(run, commit, [{ ...artifacts[0], ...patch }, artifacts[1]], workflowId));
  assert.throws(() => selectRelease(run, commit, [...artifacts, artifacts[0]], workflowId));
});
test('artifact downloads and public probes reject credentials, redirects and wrong-server markers', () => {
  assert.equal(signedArtifactURL('https://productionresultssa12.blob.core.windows.net/a?sig=value'), 'https://productionresultssa12.blob.core.windows.net/a?sig=value');
  for (const url of ['http://productionresultssa12.blob.core.windows.net/a', 'https://productionresultssa12.blob.core.windows.net.evil.test/a', 'https://user@productionresultssa12.blob.core.windows.net/a', 'https://productionresultssa12.blob.core.windows.net/a#x', 'https://example.test/a']) assert.throws(() => signedArtifactURL(url));
  assert.equal(publicOrigin('https://catan.example.test'), 'https://catan.example.test');
  for (const origin of ['http://catan.example.test', 'https://catan.example.test/path', 'https://user@catan.example.test', 'https://catan.example.test/']) assert.throws(() => publicOrigin(origin));
  marker({ ok: true, game: 'catan-friends', backendId: 'aliyun', siteEdition:'cn', revision: commit }, { commit }, 'aliyun');
  assert.throws(() => marker({ ok: true, game: 'catan-friends', backendId: 'cloudflare', revision: commit }, { commit }, 'aliyun'));
  assert.throws(() => marker({ ok: true, game:'catan-friends',backendId:'aliyun',siteEdition:'global',revision:commit },{commit},'aliyun'));
  assert.throws(() => marker({ ok: true, game: 'catan-friends', backendId: 'aliyun', revision: 'c'.repeat(40) }, { commit }, 'aliyun'));
});
test('Worker rollback refuses a newer or external release and an unrecorded first deployment', () => {
  const record = { previousVersion: 'old', previousStateSchema:3, attemptVersion: 'attempt' };
  assert.equal(mayRollbackWorker(record, 'attempt', commit, { commit }), true);
  assert.equal(mayRollbackWorker({...record,previousStateSchema:1},'attempt',commit,{commit}),false);
  assert.equal(mayRollbackWorker({...record,previousStateSchema:undefined},'attempt',commit,{commit}),false);
  assert.equal(mayRollbackWorker(record, 'external', commit, { commit }), false);
  assert.equal(mayRollbackWorker(record, 'attempt', 'c'.repeat(40), { commit }), false);
  assert.equal(mayRollbackWorker({ previousVersion: null, attemptVersion: 'attempt' }, 'attempt', commit, { commit }), false);
  assert.equal(mayRollbackWorker({ previousVersion: 'old', attemptVersion: null }, 'attempt', commit, { commit }), false);
});
test('Cloud Assistant executes only the fixed root receiver as the isolated Catan identity', () => {
  const encoded = Buffer.from(JSON.stringify({ action: 'rollback', commit, runId: 123 })).toString('base64');
  const command = cloudAssistantCommand(encoded);
  assert.match(command, /sudo -- \/usr\/local\/sbin\/catan-friends-deploy/);
  assert.match(command, /set -euo pipefail/);
  for (const injected of ["x'; rm /", '$(id)', 'a'.repeat(32001), 'bad\nrequest']) assert.throws(() => cloudAssistantCommand(injected));
});

test('Worker extraction rejects traversal, symlinks, duplicate members and manifest substitution', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'catan-worker-validation-'));
  const python = process.platform === 'win32' ? 'python' : 'python3';
  try {
    const maker = `import json,sys,zipfile,stat\nfrom pathlib import Path\nroot,sha=sys.argv[1:]\nmanifest={'schema':1,'stateSchema':3,'repository':'qiuh23/catan-friends','commit':sha,'runId':123,'platform':'linux','arch':'x64','nodeMajor':24,'siteEdition':'global'}\nfor kind in ['valid','traversal','symlink','duplicate','manifest','edition']:\n with zipfile.ZipFile(Path(root)/(kind+'.zip'),'w') as z:\n  m=dict(manifest)\n  if kind=='manifest': m['commit']='c'*40\n  if kind=='edition': m['siteEdition']='cn'\n  z.writestr('release.json',json.dumps(m));z.writestr('worker/index.js','export default {}');z.writestr('assets/index.html','<html>');z.writestr('assets/build-info.json',json.dumps({'repository':'qiuh23/catan-friends','revision':sha,'siteEdition':'global'}))\n  if kind=='traversal': z.writestr('assets/../../escaped','bad')\n  if kind=='duplicate': z.writestr('assets/index.html','duplicate')\n  if kind=='symlink':\n   i=zipfile.ZipInfo('assets/link');i.create_system=3;i.external_attr=(stat.S_IFLNK|0o777)<<16;z.writestr(i,'../../escaped')\n`;
    execFileSync(python, ['-c', maker, temporary, commit], { stdio: 'pipe' });
    for (const kind of ['valid', 'traversal', 'symlink', 'duplicate', 'manifest', 'edition']) {
      const result = spawnSync(python, ['scripts/deploy/unpack-worker.py', path.join(temporary, `${kind}.zip`), path.join(temporary, `${kind}-out`), commit, '123'], { encoding: 'utf8' });
      assert.equal(result.status === 0, kind === 'valid', `${kind}: ${result.stderr}`);
    }
    assert.equal(await readFile(path.join(temporary, 'valid-out/assets/index.html'), 'utf8'), '<html>');
    await assert.rejects(readFile(path.join(temporary, 'escaped')));
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
test('production credentials stay behind the default-off main gate and trusted checkout', async () => {
  const workflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /vars\.CATAN_PRODUCTION_ENABLED == 'true'/);
  assert.match(workflow, /vars\.CATAN_STATE_SCHEMA == '3'/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /role-to-assume: \$\{\{ vars\.ALIYUN_ROLE_ARN \}\}/);
  assert.doesNotMatch(workflow, /CATAN_SSH_PRIVATE_KEY|ACCESS_KEY_SECRET|ACCESS_KEY_ID/);
  assert.doesNotMatch(workflow, /pull_request_target|npm (ci|install|run deploy)|ref:.*head_sha/);
  const checks = await readFile(new URL('../.github/workflows/checks.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(checks, /secrets\.|playwright install|npm run test:browser/);
  const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
  assert.match(workflow, new RegExp(`wranglerVersion: ${lock.packages['node_modules/wrangler'].version.replaceAll('.', '\\.')}`));
  assert.match(workflow, /command: --version/);
  assert.match(workflow, /run: node scripts\/deploy\/release\.mjs deploy-worker/);
});
