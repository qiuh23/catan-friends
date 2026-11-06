import { rename as renameFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const temporaryLocks = new Set(['EPERM', 'EACCES', 'EBUSY']);
const retryDelays = [10, 25, 50, 100, 200];

// Windows scanners and readers can briefly hold the destination open. Retrying
// the same atomic rename keeps the previous checkpoint intact until replacement
// succeeds. Never unlink the destination or acknowledge a failed checkpoint.
export async function renameWithRetry(source, destination, { rename = renameFile, delay = sleep } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await rename(source, destination); }
    catch (error) {
      if (!temporaryLocks.has(error?.code) || attempt >= retryDelays.length) throw error;
      await delay(retryDelays[attempt]);
    }
  }
}
