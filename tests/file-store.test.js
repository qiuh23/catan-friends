import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renameWithRetry } from '../server/file-store.js';

test('atomic rename retries two temporary Windows locks before succeeding on the same paths', async () => {
  const calls = [], waits = [], locked = Object.assign(new Error('temporarily open'), { code: 'EPERM' });
  await renameWithRetry('checkpoint.tmp', 'checkpoint.json', {
    async rename(...paths) { calls.push(paths); if (calls.length < 3) throw locked; },
    async delay(ms) { waits.push(ms); },
  });
  assert.deepEqual(calls, Array(3).fill(['checkpoint.tmp', 'checkpoint.json']));
  assert.deepEqual(waits, [10, 25]);
});

test('EPERM, EACCES and EBUSY alone are retried; other failures propagate without delay', async () => {
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    let calls = 0, waits = 0;
    await renameWithRetry('source', 'destination', {
      async rename() { if (++calls === 1) throw Object.assign(new Error(code), { code }); },
      async delay() { waits++; },
    });
    assert.equal(calls, 2, code); assert.equal(waits, 1, code);
  }
  for (const code of ['EIO', 'ENOENT', 'ENOSPC', 'EXDEV', undefined]) {
    const failure = Object.assign(new Error('permanent failure'), { code }); let calls = 0, waits = 0;
    await assert.rejects(renameWithRetry('source', 'destination', {
      async rename() { calls++; throw failure; }, async delay() { waits++; },
    }), error => error === failure);
    assert.equal(calls, 1, String(code)); assert.equal(waits, 0, String(code));
  }
});

test('persistent lock exhausts the bounded delay budget and preserves the final failure', async () => {
  let calls = 0, finalFailure; const waits = [];
  await assert.rejects(renameWithRetry('source', 'destination', {
    async rename() { finalFailure = Object.assign(new Error(`locked ${++calls}`), { code: 'EPERM' }); throw finalFailure; },
    async delay(ms) { waits.push(ms); },
  }), error => error === finalFailure);
  assert.equal(calls, 6); assert.deepEqual(waits, [10, 25, 50, 100, 200]);
  assert.equal(waits.reduce((sum, ms) => sum + ms, 0), 385);
});

test('default implementation atomically replaces an existing checkpoint and consumes its temporary file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'catan-file-store-'));
  const source = path.join(directory, 'room.json.tmp'), destination = path.join(directory, 'room.json');
  try {
    await writeFile(destination, '{"revision":1}'); await writeFile(source, '{"revision":2}');
    await renameWithRetry(source, destination);
    assert.equal(await readFile(destination, 'utf8'), '{"revision":2}');
    await assert.rejects(stat(source), { code: 'ENOENT' });
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});
