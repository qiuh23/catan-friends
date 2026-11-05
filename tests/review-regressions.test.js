import test from 'node:test';
import assert from 'node:assert/strict';
import { CatanRoom } from '../worker/index.js';
import { Room, HOST_RETENTION } from '../shared/room.js';

globalThis.WebSocketRequestResponsePair ||= class {};

async function fixture(now) {
  const room = new Room(undefined, now), host = room.join('host-hash', '房主', now);
  room.presence([host], now);
  const saved = new Map([['room', structuredClone(room.record)], ['code', 'ABC234']]);
  let attachment = { id: host, createdAt: now, lastSeen: now, window: now, n: 0 };
  const socket = {
    readyState: 1, messages: [],
    deserializeAttachment: () => structuredClone(attachment),
    serializeAttachment(value) { attachment = structuredClone(value); },
    send(raw) { this.messages.push(JSON.parse(raw)); },
    close() { this.readyState = 3; },
  };
  const storage = {
    async get(key) { return structuredClone(saved.get(key)); },
    async put(key, value) { saved.set(key, structuredClone(value)); },
    async setAlarm(value) { saved.set('alarm', value); },
    async deleteAlarm() { saved.delete('alarm'); },
    async transaction(callback) { return callback(storage); },
  };
  const ctx = {
    storage, getWebSockets: () => [socket], setWebSocketAutoResponse() {},
    blockConcurrencyWhile(callback) { this.initialized = callback(); },
  };
  const env = { ROOMS: { idFromName: value => value, get: () => ({ fetch: async () => Response.json({ ok: true }) }) } };
  const object = new CatanRoom(ctx, env);
  await ctx.initialized;
  return { object, saved, socket };
}

test('Worker directory reads reconcile a stale last host connection before choosing the next expiry alarm', async () => {
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    const { object, saved } = await fixture(now);
    assert.equal(saved.get('alarm'), now + 30_000);

    // A delayed alarm and a stale/half-open owner socket must not let a public
    // list read erase the only lifecycle alarm while keeping hostConnected=true.
    now += 90_001;
    const response = await object.fetch(new Request('https://test/summary?code=ABC234'));
    assert.equal(response.status, 200);
    const summary = await response.json();
    assert.equal(object.room.record.hostConnected, false);
    assert.equal(summary.expiresAt, 1_000_000 + HOST_RETENTION);
    assert.ok(saved.get('alarm') > now, 'a missing owner still has a persisted future expiry alarm');
  } finally { Date.now = originalNow; }
});

test('Worker authenticated sync before ordinary expiry restores host presence; after expiry cannot revive it', async () => {
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    const before = await fixture(now);
    now += HOST_RETENTION - 1;
    await before.object.webSocketMessage(before.socket, JSON.stringify({ type: 'sync' }));
    assert.equal(before.object.room.record.hostConnected, true);
    assert.equal(before.object.room.deadline(), null);
    assert.equal(before.socket.messages.at(-1).type, 'state');
    assert.equal(before.socket.messages.at(-1).state.room.expiresAt, null);

    now = 10_000_000;
    const after = await fixture(now);
    now += HOST_RETENTION + 1;
    await after.object.webSocketMessage(after.socket, JSON.stringify({ type: 'sync' }));
    assert.equal(after.object.room.record.closed, true);
    assert.equal(after.saved.get('room').game, undefined);
    assert.equal(after.socket.messages.at(-1).type, 'error');
    assert.equal(after.socket.messages.at(-1).fatal, true);
  } finally { Date.now = originalNow; }
});
