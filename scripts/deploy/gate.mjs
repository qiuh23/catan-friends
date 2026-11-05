import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

export const repository = 'qiuh23/catan-friends';
const shaPattern = /^[a-f0-9]{40}$/;
export function selectRelease(run, mainSha, artifacts, workflowId) {
  if (run?.repository?.full_name !== repository || !Number.isSafeInteger(run.repository.id) || run.repository.id < 1 || run.head_repository?.full_name !== repository || run.head_repository.id !== run.repository.id || !Number.isSafeInteger(workflowId) || workflowId < 1 || run.workflow_id !== workflowId || run.name !== 'Checks' || run.path !== '.github/workflows/checks.yml' || run.event !== 'push' || run.head_branch !== 'main' || run.status !== 'completed' || run.conclusion !== 'success' || !Number.isSafeInteger(run.id) || run.id < 1 || !shaPattern.test(run.head_sha ?? '') || run.head_sha !== mainSha) return null;
  const select = kind => {
    const matches = artifacts.filter(item => item.name === `${kind}-${run.head_sha}` && item.expired === false && item.workflow_run?.id === run.id && item.workflow_run?.head_sha === run.head_sha && item.workflow_run?.repository_id === run.repository.id && item.workflow_run?.head_repository_id === run.repository.id);
    if (matches.length !== 1 || !Number.isSafeInteger(matches[0].id) || matches[0].id < 1 || !/^sha256:[a-f0-9]{64}$/.test(matches[0].digest ?? '')) throw Error(`Missing or ambiguous checked ${kind} artifact.`);
    return { id: matches[0].id, sha256: matches[0].digest.slice(7) };
  };
  return { repository, commit: run.head_sha, runId: run.id, node: select('node'), worker: select('worker') };
}
export async function github(path) {
  if (process.env.GITHUB_REPOSITORY !== repository || !process.env.GITHUB_TOKEN) throw Error('Unexpected repository or missing GitHub authentication.');
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error(`GitHub metadata check failed (${response.status}).`);
  return response.json();
}
export async function resolveRelease(runId) {
  if (!Number.isSafeInteger(runId) || runId < 1) throw Error('Missing Checks run ID.');
  const [run, branch, artifacts, workflow] = await Promise.all([github(`/actions/runs/${runId}`), github('/git/ref/heads/main'), github(`/actions/runs/${runId}/artifacts?per_page=100`), github('/actions/workflows/checks.yml')]);
  return selectRelease(run, branch.object.sha, artifacts.artifacts ?? [], workflow.id);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const release = await resolveRelease(Number(process.env.CHECKS_RUN_ID || event.workflow_run?.id || event.inputs?.checks_run_id));
  if (release && execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== release.commit) throw Error('Trusted control checkout does not match checked current main.');
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `deploy=${Boolean(release)}\n`);
  if (release) await writeFile(process.env.RELEASE_RECORD, JSON.stringify(release));
  else console.log('Skipped: this is not a successful check of the exact current main.');
}
