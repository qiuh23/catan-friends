import test from 'node:test';
import assert from 'node:assert/strict';
import { Room, PRACTICE_RETENTION } from '../shared/room.js';
import { createRoomFromInput } from '../shared/room-create.js';

const variants = { friendlyRobber: true, harbormaster: true };
const at = 1_000_000;
const send = (room, actor, action) => room.handle(actor, { id: crypto.randomUUID(), revision: room.record.revision, action }, at);

test('actual seats choose all 3–6 editions and supplies without a creation-time guess; compatible variants survive', async () => {
  for (const count of [3, 4, 5, 6]) {
    const room = await createRoomFromInput({ token: crypto.randomUUID(), name: '房主', options: variants }, at), host = room.record.hostId;
    assert.throws(() => send(room, host, { type: 'start' }), /3–6/);
    for (let n = 1; n < count; n++) send(room, host, { type: 'addBot' });
    const lobby = room.snapshot(host, [host], at).state;
    assert.equal(lobby.minPlayers, 3); assert.equal(lobby.maxPlayers, 6);
    assert.equal(lobby.room.minPlayers, 3); assert.equal(lobby.room.maxPlayers, 6);
    assert.equal(lobby.options.playerExpansion, count > 4 ? 'five-six-2025' : 'base');
    assert.equal(room.summary('ABC234', at).maxPlayers, 6);
    assert.equal(room.summary('ABC234', at).status, count === 6 ? 'full' : 'waiting');
    send(room, host, { type: 'setOptions', options: variants });
    send(room, host, { type: 'start' });
    const game = room.record.game, supply = count > 4 ? 24 : 19;
    assert.deepEqual(game.options, { ...variants, playerExpansion: count > 4 ? 'five-six-2025' : 'base' });
    assert.equal(game.board.tiles.length, count > 4 ? 30 : 19);
    assert.equal(game.deck.length, count > 4 ? 34 : 25);
    assert.ok(Object.values(game.bank).every(amount => amount === supply));
    assert.equal(room.snapshot(host).state.profile.turnRule, count > 4 ? 'paired' : 'single');
    room.presence([], at + 1);
    assert.deepEqual(room.record.game.options, game.options, 'disconnect changed frozen rules');
    assert.throws(() => room.join('new-person', '新玩家', at + 2), /已经开始/);
    assert.throws(() => send(room, host, { type: 'setOptions', options: {} }), /开局前/);
    assert.throws(() => send(room, host, { type: 'removeBot', playerId: game.players[1].id }), /开局前/);
  }
});

test('rematch recalculates the next game from changed seats while preserving variants and old active saves', async () => {
  const room = await createRoomFromInput({ token: crypto.randomUUID(), name: '房主', options: variants }, at), host = room.record.hostId;
  for (let i = 1; i < 6; i++) send(room, host, { type: 'addBot' });
  send(room, host, { type: 'start' });
  room.record.game.phase = 'finished'; room.record.game.winner = host;
  send(room, host, { type: 'rematch' });
  for (let i = 0; i < 2; i++) send(room, host, { type: 'removeBot', playerId: room.record.game.players.at(-1).id });
  assert.equal(room.snapshot(host).state.options.playerExpansion, 'base');
  send(room, host, { type: 'start' });
  assert.deepEqual(room.record.game.options, { ...variants, playerExpansion: 'base' });
  assert.equal(room.record.game.board.tiles.length, 19); assert.equal(room.record.game.deck.length, 25);
  const saved = structuredClone(room.record); delete saved.game.options; delete saved.game.targetPoints;
  const restored = new Room(saved, at + 10);
  assert.equal(restored.snapshot(host).state.options.playerExpansion, 'base');
  assert.equal(restored.snapshot(host).state.board.tiles.length, 19);
});

test('practice pause freezes bot turns, rejects moves, permits chat and survives restore with the same ten-minute retention', async () => {
  for (const count of [3, 6]) {
    const room = await createRoomFromInput({ token: crypto.randomUUID(), name: '练习', practice: true, playerCount: count, options: variants }, at), host = room.record.hostId;
    room.presence([host], at);
    let view = room.snapshot(host).state;
    send(room, host, { type: 'buildSettlement', vertex: view.legal.settlement[0] });
    view = room.snapshot(host).state; send(room, host, { type: 'buildRoad', edge: view.legal.road[0] });
    assert.ok(room.nextBot(), 'fixture must pause an actual pending bot turn');
    send(room, host, { type: 'pause' }); const game = structuredClone(room.record.game);
    assert.equal(room.nextBot(), null); assert.equal(room.tick(at + 100), false);
    assert.deepEqual(room.record.game, game);
    assert.throws(() => send(room, host, { type: 'roll' }), /暂停/);
    send(room, host, { type: 'chat', text: '暂停仍可聊天' }); assert.deepEqual(room.record.game, game);
    room.presence([], at + 200); assert.equal(room.deadline(), at + 200 + PRACTICE_RETENTION);
    const restored = new Room(structuredClone(room.record), at + 300);
    restored.presence([host], at + 300); assert.equal(restored.record.paused, true);
    assert.equal(restored.nextBot(), null); assert.deepEqual(restored.record.game, game);
    send(restored, host, { type: 'resume' }); assert.ok(restored.nextBot());
    assert.equal(restored.tick(at + 400), true);
  }
});

test('only the room host may pause or resume a live human game', async () => {
  const room = await createRoomFromInput({ token: crypto.randomUUID(), name: '房主' }, at), host = room.record.hostId;
  const guest = room.join('guest', '朋友', at); send(room, host, { type: 'addBot' });
  send(room, guest, { type: 'ready', ready: true }); send(room, host, { type: 'start' });
  assert.throws(() => send(room, guest, { type: 'pause' }), /房主/);
  send(room, host, { type: 'pause' }); assert.throws(() => send(room, guest, { type: 'resume' }), /房主/);
  send(room, host, { type: 'resume' }); assert.equal(room.record.paused, false);
});
