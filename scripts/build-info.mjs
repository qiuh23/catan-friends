import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(revision)) throw Error('A full source revision is required.');
await writeFile('dist/build-info.json', JSON.stringify({ schema: 1, repository: 'qiuh23/catan-friends', revision }) + '\n');
