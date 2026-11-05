import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repository, resolveRelease } from './gate.mjs';

export function signedArtifactURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || !/^productionresultssa[a-z0-9]+\.blob\.core\.windows\.net$/.test(url.hostname)) throw Error('Untrusted GitHub artifact delivery host.');
  return url.href;
}
export function publicOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password || url.hostname.includes('*')) throw Error('An exact approved HTTPS public origin is required.');
  return url.origin;
}
export function marker(value, release, backendId) {
  if (value?.ok !== true || value.game !== 'catan-friends' || value.backendId !== backendId || value.revision !== release.commit) throw Error('Public backend identity differs from checked release.');
}
async function artifactURL(artifact) {
  const response = await fetch(`https://api.github.com/repos/${repository}/actions/artifacts/${artifact.id}/zip`, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }, redirect: 'manual', signal: AbortSignal.timeout(20000) });
  if (response.status !== 302) throw Error(`Cannot obtain checked artifact (${response.status}).`);
  return signedArtifactURL(response.headers.get('location'));
}
async function prepare(release) {
  const response = await fetch(await artifactURL(release.worker), { redirect: 'error', signal: AbortSignal.timeout(120000) });
  if (!response.ok || !response.body) throw Error('Worker artifact download failed.');
  const chunks = []; let length = 0;
  for await (const chunk of response.body) { length += chunk.length; if (length > 100 * 1024 * 1024) throw Error('Worker artifact too large.'); chunks.push(chunk); }
  const data = Buffer.concat(chunks);
  if (createHash('sha256').update(data).digest('hex') !== release.worker.sha256) throw Error('Worker artifact ZIP digest mismatch.');
  const zip = resolve(process.env.RUNNER_TEMP, 'catan-worker.zip');
  const output = resolve(process.env.RUNNER_TEMP, 'catan-worker-release');
  await writeFile(zip, data, { mode: 0o600 });
  execFileSync('python3', ['scripts/deploy/unpack-worker.py', zip, output, release.commit, String(release.runId)], { stdio: 'inherit', timeout: 60000 });
  const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  // Target names, bindings and origins come from trusted main, never artifacts.
  if (config.name !== 'catan-friends' || config.durable_objects?.bindings?.find(item => item.name === 'ROOMS')?.class_name !== 'CatanRoom') throw Error('Unexpected trusted Worker target.');
  const worker = { ...config, main: join(output, 'worker/index.js'), assets: { ...config.assets, directory: join(output, 'assets') }, vars: { ...config.vars, BUILD_SHA: release.commit, BACKEND_ID: 'cloudflare' } };
  delete worker.$schema;
  const deployer = resolve(process.env.RUNNER_TEMP, 'catan-deployer');
  await mkdir(deployer, { recursive: true });
  await writeFile(join(deployer, 'package.json'), JSON.stringify({ name: 'trusted-catan-deployer', private: true }));
  await writeFile(resolve(process.env.RUNNER_TEMP, 'catan-wrangler.json'), JSON.stringify(worker));
}
async function cf(path, body) {
  if (!/^[a-f0-9]{32}$/i.test(process.env.CLOUDFLARE_ACCOUNT_ID ?? '') || !process.env.CLOUDFLARE_API_TOKEN) throw Error('Missing dedicated Cloudflare release credentials.');
  return fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/catan-friends${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
}
const cloudRecordPath = () => resolve(process.env.RUNNER_TEMP, 'catan-cloudflare-attempt.json');
async function currentVersion() {
  const response = await cf('/deployments');
  if (response.status === 404) return null;
  if (!response.ok) throw Error(`Cannot inspect Catan Worker deployment (${response.status}).`);
  const body = await response.json(), versions = body.result?.deployments?.[0]?.versions;
  if (!body.success || !Array.isArray(versions) || versions.length !== 1 || versions[0].percentage !== 100 || !/^[a-f0-9-]{36}$/i.test(versions[0].version_id)) throw Error('Expected one full-traffic Worker version.');
  return versions[0].version_id;
}
async function previous() {
  const previousVersion = await currentVersion();
  await writeFile(cloudRecordPath(), JSON.stringify({ previousVersion, attemptVersion: null }), { mode: 0o600 });
}
async function versionRevision(version) {
  const response = await cf(`/versions/${version}`);
  if (!response.ok) throw Error('Cannot inspect immutable Worker version bindings.');
  const body = await response.json();
  if (!body.success || body.result?.id !== version) throw Error('Unexpected Worker version identity.');
  const values = body.result.resources?.bindings?.filter(binding => binding.name === 'BUILD_SHA' && binding.type === 'plain_text');
  if (values?.length !== 1) throw Error('Worker version has no unique source revision binding.');
  return values[0].text;
}
async function recordWorker(release) {
  const record = JSON.parse(await readFile(cloudRecordPath(), 'utf8'));
  const version = await currentVersion();
  if (!version || await versionRevision(version) !== release.commit) throw Error('Current Worker is not this checked release; refusing to record another deployment for rollback.');
  await writeFile(cloudRecordPath(), JSON.stringify({ ...record, attemptVersion: version }), { mode: 0o600 });
}
export function mayRollbackWorker(record, activeVersion, activeRevision, release) {
  return Boolean(record?.previousVersion && record.attemptVersion && record.previousVersion !== record.attemptVersion && activeVersion === record.attemptVersion && activeRevision === release.commit);
}
async function rollbackWorker(release) {
  const record = JSON.parse(await readFile(cloudRecordPath(), 'utf8'));
  if (!record.previousVersion || !record.attemptVersion) {
    const message = 'Catan CF automatic rollback skipped: no prior version or no safely recorded attempt. Keep lobby disabled; inspect before any manual repair. No Worker or Durable Object state was deleted.';
    console.log(message);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, message + '\n');
    return;
  }
  const activeVersion = await currentVersion(), revision = activeVersion ? await versionRevision(activeVersion) : null;
  if (!mayRollbackWorker(record, activeVersion, revision, release)) throw Error('Catan Worker changed outside this attempt; refusing to overwrite the newer/external deployment.');
  // Cloudflare rejects incompatible DO rollback without force. Do not bypass it.
  const response = await cf('/deployments', { strategy: 'percentage', versions: [{ version_id: record.previousVersion, percentage: 100 }], annotations: { 'workers/message': 'Catan paired release failed; restore previous code only' } });
  const body = await response.json();
  if (!response.ok || !body.success) throw Error('Catan Worker rollback refused; inspect bindings/state compatibility before repair.');
  if (await currentVersion() !== record.previousVersion) throw Error('Catan Worker rollback result differs from expected previous version.');
}
async function assertCurrent(release) {
  const current = await resolveRelease(release.runId);
  if (!current || JSON.stringify(current) !== JSON.stringify(release) || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== release.commit) throw Error('Release became stale or the trusted control checkout does not match current checked main.');
}
export function cloudAssistantCommand(encoded) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length > 32000) throw Error('Invalid bounded deployment request.');
  return `#!/usr/bin/env bash\nset -euo pipefail\nprintf '%s\\n' '${encoded}' | sudo -- /usr/local/sbin/catan-friends-deploy\n`;
}
function aliyun(operation, args) {
  try { return JSON.parse(execFileSync('aliyun', ['ecs', operation, '--region', process.env.ALIYUN_REGION_ID, '--RegionId', process.env.ALIYUN_REGION_ID, ...args], { encoding: 'utf8', timeout: 45000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })); }
  catch { throw Error(`Catan Cloud Assistant ${operation} failed; command payload and credentials are withheld.`); }
}
async function installAliyun(release, action) {
  if (!/^cn-[a-z0-9-]+$/.test(process.env.ALIYUN_REGION_ID ?? '') || !/^i-[a-z0-9]+$/.test(process.env.ALIYUN_INSTANCE_ID ?? '')) throw Error('Missing fixed Catan ECS target.');
  const request = { action, commit: release.commit, runId: release.runId };
  if (action === 'install') Object.assign(request, { artifactId: release.node.id, artifactUrl: await artifactURL(release.node), artifactSha256: release.node.sha256 });
  const encoded = Buffer.from(JSON.stringify(request)).toString('base64');
  const command = Buffer.from(cloudAssistantCommand(encoded)).toString('base64');
  const started = aliyun('RunCommand', ['--InstanceId.1', process.env.ALIYUN_INSTANCE_ID, '--Name', `catan-${action}-${release.runId}`, '--Type', 'RunShellScript', '--Username', 'catan-friends-deploy', '--WorkingDir', '/tmp', '--Timeout', '900', '--KeepCommand', 'false', '--RepeatMode', 'Once', '--ContentEncoding', 'Base64', '--CommandContent', command]);
  if (typeof started.InvokeId !== 'string') throw Error('No Catan deployment invocation ID returned.');
  const deadline = Date.now() + 920000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    const body = aliyun('DescribeInvocationResults', ['--InvokeId', started.InvokeId, '--InstanceId', process.env.ALIYUN_INSTANCE_ID]);
    const result = body.Invocation?.InvocationResults?.InvocationResult?.[0] ?? body.InvocationResults?.InvocationResult?.[0];
    if (result?.InvocationStatus === 'Success' && result.ExitCode === 0) { console.log(`Catan-only ${action} verified by Cloud Assistant for ${release.commit}.`); return; }
    if (['Failed', 'Timeout', 'Cancelled', 'Stopped', 'Terminated', 'Invalid'].includes(result?.InvocationStatus)) throw Error(`Catan ${action} failed (${result.InvocationStatus}); inspect invocation ${started.InvokeId}.`);
  }
  throw Error(`Catan ${action} result timed out; inspect invocation ${started.InvokeId} and actual state before retrying.`);
}
async function verify(release) {
  const domestic = publicOrigin(process.env.CATAN_ALIYUN_ORIGIN), cloudflare = publicOrigin(process.env.CATAN_CLOUDFLARE_ORIGIN);
  if (domestic === cloudflare) throw Error('Independent backends require independent origins.');
  for (const [origin, backendId] of [[domestic, 'aliyun'], [cloudflare, 'cloudflare']]) {
    let last;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const response = await fetch(`${origin}/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw Error(`Public health returned ${response.status}.`);
        marker(await response.json(), release, backendId);
        const assets = await fetch(`${origin}/build-info.json`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        const info = await assets.json();
        if (!assets.ok || info.revision !== release.commit || info.repository !== repository) throw Error('Public assets do not match backend.');
        const page = await fetch(`${origin}/`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        if (!page.ok || !page.headers.get('content-type')?.includes('text/html')) throw Error('Public HTML is unavailable.');
        const html = await page.text();
        const links = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match => new URL(match[1], origin)).filter(url => /\.(?:js|css)$/.test(url.pathname));
        if (!links.some(url => url.pathname.endsWith('.js'))) throw Error('Public HTML has no application script.');
        for (const url of links) {
          if (url.origin !== origin || !/^\/assets\/[^/?#]+\.(?:js|css)$/.test(url.pathname) || url.search || url.hash) throw Error('Public assets use an unexpected origin or non-build path.');
          const asset = await fetch(url, { signal: AbortSignal.timeout(15000) });
          const mime = asset.headers.get('content-type') ?? '';
          if (!asset.ok || !(url.pathname.endsWith('.css') ? mime.includes('text/css') : /javascript|ecmascript/.test(mime)) || (await asset.text()).length < 1) throw Error('Public JS/CSS asset is unavailable or has the wrong MIME type.');
        }
        const socketURL = new URL('/api/connectivity/ws', origin); socketURL.protocol = 'wss:';
        await new Promise((resolve, reject) => {
          const socket = new WebSocket(socketURL); let done = false;
          const end = error => { if (done) return; done = true; clearTimeout(timer); socket.close(); error ? reject(error) : resolve(); };
          const timer = setTimeout(() => end(Error('Public WSS marker timed out.')), 8000);
          socket.onmessage = event => { try { marker(JSON.parse(String(event.data)), release, backendId); end(); } catch (e) { end(e); } };
          socket.onerror = () => end(Error('Public WSS failed.')); socket.onclose = () => end(Error('Public WSS closed before marker.'));
        });
        last = null; break;
      } catch (error) { last = error; await new Promise(resolve => setTimeout(resolve, 2000)); }
    }
    if (last) throw last;
  }
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `Catan checked release: \`${release.commit}\` · Checks ${release.runId}\n\n[Aliyun](${domestic}) · [Cloudflare](${cloudflare})\n\nMatching public frontend/backend SHA and HTTPS/WSS probes passed. This probe creates no room. Lobby activation and multiplayer acceptance remain separate.\n`);
}
async function output(name, value) { if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const action = process.argv[2], release = JSON.parse(await readFile(process.env.RELEASE_RECORD, 'utf8'));
  if (action === 'prepare') await prepare(release);
  else if (action === 'assert-current') await assertCurrent(release);
  else if (action === 'previous') await previous();
  else if (action === 'record-worker') await recordWorker(release);
  else if (action === 'rollback-worker') await rollbackWorker(release);
  else if (action === 'install' || action === 'rollback') await installAliyun(release, action);
  else if (action === 'verify') await verify(release);
  else throw Error('Unknown release action.');
}
