import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createServer } from '../server/index.js';
import { CatanRoom } from '../worker/index.js';
import { roomCreationSettings } from '../shared/room-create.js';
import { RuntimeClient } from './runtime-client.js';

const variants = { friendlyRobber: true, harbormaster: true };
const rulesFor = count => count > 4 ? 'five-six-2025' : 'base';
const invalid = [
  ...[null, 2, 7, 3.5, '4', true].map(playerCount => ({ playerCount })),
  { playerCount: 3, options: { playerExpansion: 'five-six-2025' } },
  { playerCount: 4, options: { playerExpansion: 'five-six-2025' } },
  { playerCount: 5, options: { playerExpansion: 'base' } },
  { playerCount: 6, options: { playerExpansion: 'base' } },
  { playerCount: 4, options: { seafarers: true } },
];
function assertPractice(view, count) {
  assert.equal(view.players.length, count);
  assert.equal(view.players.filter(player => !player.bot).length, 1);
  assert.equal(view.players.filter(player => player.bot).length, count - 1);
  assert.equal(view.options.playerExpansion, rulesFor(count));
  assert.equal(view.options.friendlyRobber, true);
  assert.equal(view.options.harbormaster, true);
  assert.equal(view.targetPoints, 11);
  assert.equal(view.board.tiles.length, count > 4 ? 30 : 19);
  assert.equal(view.phase, 'setup-settlement');
}

test('creation contract auto-matches 3–6 total seats, preserves variants and supports legacy clients', () => {
  for (const playerCount of [3, 4, 5, 6]) {
    const input = { practice: true, playerCount, options: { ...variants } }, before = structuredClone(input);
    const settings = roomCreationSettings(input);
    assert.equal(settings.playerCount, playerCount);
    assert.equal(settings.options.playerExpansion, rulesFor(playerCount));
    assert.deepEqual(settings.options, { ...variants, playerExpansion: rulesFor(playerCount) });
    assert.deepEqual(input, before, 'validation must not clear the submitted choice');
  }
  assert.equal(roomCreationSettings({ practice: true }).playerCount, 3);
  assert.equal(roomCreationSettings({ practice: true, options: { playerExpansion: 'five-six-2025' } }).playerCount, 5);
  for (const input of invalid) assert.throws(() => roomCreationSettings(input));
});

test('Node HTTP creates exact 3–6 practice rosters and restores them; rejects incompatible requests atomically', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'catan-practice-'));
  let app = await createServer({ port: 0, dataDir, botDelay: 60_000 });
  const clients = [], created = [], origin = () => `http://127.0.0.1:${app.port}`;
  const post = input => fetch(origin() + '/api/rooms', { method: 'POST', body: JSON.stringify({ token: crypto.randomUUID(), name: '练习玩家', ...input }) });
  async function join(code, token) {
    const client = new RuntimeClient(new WebSocket(origin() + `/api/rooms/${code}/ws`)); clients.push(client);
    client.ws.addEventListener('open', () => client.ws.send(JSON.stringify({ type: 'hello', token, name: '练习玩家' })));
    await client.wait(message => ['state', 'error'].includes(message.type)); return client;
  }
  try {
    for (const playerCount of [3, 4, 5, 6]) {
      const token = crypto.randomUUID(), response = await post({ token, practice: true, playerCount, options: variants });
      assert.equal(response.status, 201, await response.clone().text()); const { code } = await response.json();
      const client = await join(code, token); assertPractice(client.state.state, playerCount);
      assert.equal(client.state.state.room.practice, true);
      assert.equal(app.rooms.get(code).summary(code), null);
      assert.equal(client.state.state.deck, undefined); assert.equal(client.state.state.random, undefined);
      const foreign = await join(code, crypto.randomUUID()); assert.equal(foreign.messages.at(-1).type, 'error');
      created.push({ code, token, playerCount, identity: client.state.state.me, board: client.state.state.board });
    }
    const before = app.rooms.size;
    for (const input of invalid) {
      const response = await post({ practice: true, ...input }); assert.equal(response.status, 400, JSON.stringify(input));
      assert.ok((await response.json()).error); assert.equal(app.rooms.size, before);
    }
    for (const client of clients) client.close(); await app.close();
    app = await createServer({ port: 0, dataDir, botDelay: 60_000 });
    for (const { code, token, playerCount, identity, board } of created) {
      const client = await join(code, token); assertPractice(client.state.state, playerCount);
      assert.equal(client.state.state.me, identity); assert.deepEqual(client.state.state.board, board);
    }
    // Old clients cannot force the smaller edition on an occupied large room.
    const token = crypto.randomUUID(), response = await post({ token, playerCount: 6, options: { ...variants, playerExpansion: rulesFor(6) } });
    assert.equal(response.status, 201); const { code } = await response.json(), client = await join(code, token);
    assert.equal(client.state.state.players.length, 1); assert.equal(client.state.state.phase, 'lobby');
    for (let i = 0; i < 4; i++) await client.act({ type: 'addBot' });
    const room = app.rooms.get(code), game = structuredClone(room.record.game), revision = room.record.revision;
    const result = await client.request({ type: 'setOptions', options: { ...variants, playerExpansion: 'base' } });
    assert.equal(result.result.type, 'error'); assert.match(result.result.message, /实际人数/);
    assert.deepEqual(room.record.game, game); assert.equal(room.record.revision, revision);
  } finally {
    for (const client of clients) client.close(); await app.close();
    await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

globalThis.WebSocketRequestResponsePair ||= class {};
async function durableFixture(saved = new Map()) {
  const sockets = [];
  const storage = {
    async get(key) { return structuredClone(saved.get(key)); },
    async put(key, value) { saved.set(key, structuredClone(value)); },
    async setAlarm(time) { saved.set('alarm', time); }, async deleteAlarm() { saved.delete('alarm'); },
    async transaction(callback) {
      const before = structuredClone(saved);
      try { return await callback(storage); } catch (error) { saved.clear(); for (const [key, value] of before) saved.set(key, value); throw error; }
    },
  };
  const ctx = { storage, getWebSockets: () => sockets, setWebSocketAutoResponse() {}, blockConcurrencyWhile(callback) { this.ready = callback(); } };
  const env = { ROOMS: { idFromName: id => id, get: () => ({ fetch: async () => Response.json({ ok: true }) }) } };
  const object = new CatanRoom(ctx, env); await ctx.ready;
  async function hello(token) {
    let attachment = { id: null, n: 0, window: Date.now(), createdAt: Date.now() };
    const socket = { readyState: 1, messages: [], deserializeAttachment: () => structuredClone(attachment), serializeAttachment(value) { attachment = structuredClone(value); }, send(raw) { this.messages.push(JSON.parse(raw)); }, close() { this.readyState = 3; } };
    sockets.push(socket); await object.webSocketMessage(socket, JSON.stringify({ type: 'hello', token, name: '练习玩家' })); return socket;
  }
  return { object, saved, hello, create: input => object.fetch(new Request('https://test/create?code=ABC234', { method: 'POST', body: JSON.stringify({ token: crypto.randomUUID(), name: '练习玩家', ...input }) })) };
}

test('Worker Durable Object matches Node practice totals, variants, restart identity and rejection behavior', async () => {
  for (const playerCount of [3, 4, 5, 6]) {
    const fixture = await durableFixture(), token = crypto.randomUUID();
    const response = await fixture.create({ token, practice: true, playerCount, options: variants }); assert.equal(response.status, 201, await response.text());
    const socket = await fixture.hello(token), view = socket.messages.at(-1).state; assertPractice(view, playerCount);
    assert.equal(view.room.practice, true); assert.equal(fixture.object.room.summary('ABC234'), null);
    assert.equal((await fixture.hello(crypto.randomUUID())).messages.at(-1).type, 'error');
    const restored = await durableFixture(fixture.saved), returning = await restored.hello(token), after = returning.messages.at(-1).state;
    assertPractice(after, playerCount); assert.equal(after.me, view.me); assert.deepEqual(after.board, view.board);
    assert.equal(after.deck, undefined); assert.equal(after.random, undefined);
  }
  for (const input of invalid) {
    const fixture = await durableFixture(), response = await fixture.create({ practice: true, ...input });
    assert.equal(response.status, 400, JSON.stringify(input)); assert.ok((await response.json()).error);
    assert.equal(fixture.object.room, null); assert.equal(fixture.saved.has('room'), false);
  }
  const fixture = await durableFixture(), token = crypto.randomUUID();
  assert.equal((await fixture.create({ token, playerCount: 6, options: { ...variants, playerExpansion: rulesFor(6) } })).status, 201);
  const socket = await fixture.hello(token), id = socket.deserializeAttachment().id;
  async function command(action) { const commandId = crypto.randomUUID(); await fixture.object.webSocketMessage(socket, JSON.stringify({ type: 'action', id: commandId, revision: fixture.object.room.record.revision, action })); return socket.messages.findLast(message => message.id === commandId); }
  for (let i = 0; i < 4; i++) assert.equal((await command({ type: 'addBot' })).type, 'ack');
  assert.equal(fixture.object.room.record.hostId, id);
  const game = structuredClone(fixture.object.room.record.game), revision = fixture.object.room.record.revision;
  const reply = await command({ type: 'setOptions', options: { ...variants, playerExpansion: 'base' } });
  assert.equal(reply.type, 'error'); assert.match(reply.message, /实际人数/);
  assert.deepEqual(fixture.object.room.record.game, game); assert.equal(fixture.object.room.record.revision, revision);
});

test('Node creates a six-seat human lobby without an edition hint and restores paused practice after restart', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'catan-auto-room-'));
  let app = await createServer({ port: 0, dataDir, botDelay: 60_000 }); const clients = [];
  const origin = () => `http://127.0.0.1:${app.port}`;
  async function create(input = {}) {
    const token = crypto.randomUUID(), response = await fetch(origin() + '/api/rooms', { method: 'POST', body: JSON.stringify({ token, name: '自动人数', options: variants, ...input }) });
    assert.equal(response.status, 201); return { token, ...(await response.json()) };
  }
  async function join({ token, code }) {
    const client = new RuntimeClient(new WebSocket(origin() + `/api/rooms/${code}/ws`)); clients.push(client);
    client.ws.addEventListener('open', () => client.ws.send(JSON.stringify({ type: 'hello', token, name: '自动人数' })));
    await client.wait(message => message.type === 'state'); return client;
  }
  try {
    for (const count of [3, 4, 5, 6]) {
      const room = await create(), client = await join(room);
      assert.equal(client.state.state.room.maxPlayers, 6);
      for (let i = 1; i < count; i++) await client.act({ type: 'addBot' });
      assert.equal(client.state.state.options.playerExpansion, rulesFor(count));
      await client.act({ type: 'start' });
      assert.equal(client.state.state.board.tiles.length, count > 4 ? 30 : 19);
      assert.equal(client.state.state.deckCount, count > 4 ? 34 : 25);
      assert.equal(client.state.state.profile.turnRule, count > 4 ? 'paired' : 'single');
      assert.equal(client.state.state.options.harbormaster, true);
    }
    const room = await create({ practice: true, playerCount: 6 }), client = await join(room);
    if (!app.rooms.get(room.code).nextBot()) {
      await client.act({ type: 'buildSettlement', vertex: client.state.state.legal.settlement[0] });
      await client.act({ type: 'buildRoad', edge: client.state.state.legal.road[0] });
    }
    await client.act({ type: 'pause' }); const game = JSON.parse(JSON.stringify(app.rooms.get(room.code).record.game)), identity = client.state.state.me;
    assert.equal(app.rooms.get(room.code).nextBot(), null);
    for (const peer of clients) peer.close(); await app.close();
    app = await createServer({ port: 0, dataDir, botDelay: 60_000 });
    const returned = await join(room); assert.equal(returned.state.state.me, identity); assert.equal(returned.state.state.room.paused, true);
    assert.deepEqual(app.rooms.get(room.code).record.game, game);
    assert.equal((await returned.request({ type: 'roll' })).result.type, 'error');
    await returned.act({ type: 'resume' }); assert.ok(app.rooms.get(room.code).nextBot());
  } finally {
    for (const peer of clients) peer.close(); await app.close();
    await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('Worker creates automatic human editions for 3–6 seats and keeps paused practice frozen across alarm and restart', async () => {
  async function command(fixture, socket, action) {
    const id = crypto.randomUUID(); await fixture.object.webSocketMessage(socket, JSON.stringify({ type: 'action', id, revision: fixture.object.room.record.revision, action }));
    const reply = socket.messages.findLast(message => message.id === id); assert.equal(reply.type, 'ack', JSON.stringify(reply));
  }
  for (const count of [3, 4, 5, 6]) {
    const fixture = await durableFixture(), token = crypto.randomUUID();
    assert.equal((await fixture.create({ token, options: variants })).status, 201);
    const socket = await fixture.hello(token); assert.equal(socket.messages.at(-1).state.maxPlayers, 6);
    for (let i = 1; i < count; i++) await command(fixture, socket, { type: 'addBot' });
    assert.equal(socket.messages.at(-1).state.options.playerExpansion, rulesFor(count));
    await command(fixture, socket, { type: 'start' });
    const view = socket.messages.at(-1).state;
    assert.equal(view.board.tiles.length, count > 4 ? 30 : 19); assert.equal(view.deckCount, count > 4 ? 34 : 25);
    assert.equal(view.profile.turnRule, count > 4 ? 'paired' : 'single'); assert.equal(view.options.harbormaster, true);
  }
  const fixture = await durableFixture(), token = crypto.randomUUID();
  assert.equal((await fixture.create({ token, options: variants, practice: true, playerCount: 6 })).status, 201);
  const socket = await fixture.hello(token); let view = socket.messages.at(-1).state;
  if (!fixture.object.room.nextBot()) {
    await command(fixture, socket, { type: 'buildSettlement', vertex: view.legal.settlement[0] }); view = socket.messages.at(-1).state;
    await command(fixture, socket, { type: 'buildRoad', edge: view.legal.road[0] });
  }
  assert.ok(fixture.object.room.nextBot()); await command(fixture, socket, { type: 'pause' });
  const before = structuredClone(fixture.object.room.record.game); await fixture.object.alarm();
  assert.deepEqual(fixture.object.room.record.game, before);
  const restored = await durableFixture(fixture.saved), returning = await restored.hello(token);
  assert.equal(returning.messages.at(-1).state.room.paused, true); assert.equal(restored.object.room.nextBot(), null);
  assert.deepEqual(restored.object.room.record.game, before);
  await command(restored, returning, { type: 'resume' }); assert.ok(restored.object.room.nextBot());
});
