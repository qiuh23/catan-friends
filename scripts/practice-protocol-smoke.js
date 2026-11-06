import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

// Run against either local Node or local workerd; never requires a remote CI job.
const origin = process.env.TEST_URL || 'http://127.0.0.1:5175', sockets = [];
const options = { friendlyRobber: true, harbormaster: true };
const post = input => fetch(origin + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: crypto.randomUUID(), name: '人数协议检查', ...input }) });
async function connect(code, token) {
  const ws = new WebSocket(origin.replace(/^http/, 'ws') + `/api/rooms/${code}/ws`), client = { ws, messages: [] }; sockets.push(ws);
  ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', token, name: '人数协议检查' })));
  ws.on('message', raw => { const message = JSON.parse(raw); client.messages.push(message); if (message.type === 'state') client.state = message; });
  client.wait = async (predicate, after = 0) => {
    for (let i = 0; i < 500; i++) { const message = client.messages.slice(after).find(predicate); if (message) return message; await new Promise(resolve => setTimeout(resolve, 10)); }
    throw Error('Practice protocol message timeout');
  };
  client.command = async action => {
    const id = crypto.randomUUID(), after = client.messages.length;
    ws.send(JSON.stringify({ type: 'action', id, revision: client.state.revision, action }));
    const reply = await client.wait(message => message.id === id, after); assert.equal(reply.type, 'ack', JSON.stringify(reply));
    if(action.type!=='close')await client.wait(message=>message.type==='state',after);
    return reply;
  };
  await client.wait(message => ['state', 'error'].includes(message.type)); return client;
}
try {
  for (const playerCount of [3, 4, 5, 6]) {
    const token = crypto.randomUUID(), response = await post({ token, practice: true, playerCount, options });
    assert.equal(response.status, 201, await response.clone().text()); const { code } = await response.json(), client = await connect(code, token);
    assert.ok(client.state, JSON.stringify(client.messages)); const view = client.state.state, identity = view.me;
    assert.equal(view.players.length, playerCount); assert.equal(view.players.filter(player => player.bot).length, playerCount - 1);
    assert.equal(view.players.filter(player => !player.bot).length, 1); assert.equal(view.room.practice, true);
    assert.deepEqual(view.options, { ...options, playerExpansion: playerCount > 4 ? 'five-six-2025' : 'base' });
    assert.equal(view.board.tiles.length, playerCount > 4 ? 30 : 19); assert.equal(view.phase, 'setup-settlement');
    assert.equal(view.targetPoints, 11); assert.equal(view.random, undefined); assert.equal(view.deck, undefined);
    const list = await (await fetch(origin + '/api/rooms')).json(); assert.ok(!list.rooms.some(room => room.code === code));
    const foreign = await connect(code, crypto.randomUUID()); assert.equal(foreign.messages.at(-1).type, 'error');
    await client.command({ type: 'buildSettlement', vertex: view.legal.settlement[0] });
    await client.command({ type: 'buildRoad', edge: client.state.state.legal.road[0] });
    await client.command({ type: 'pause' }); const paused = structuredClone(client.state.state), pausedRevision = client.state.revision;
    await new Promise(resolve=>setTimeout(resolve,1200));
    assert.equal(client.state.state.room.paused,true);assert.equal(client.state.revision,pausedRevision);
    assert.deepEqual(client.state.state.board,paused.board);assert.equal(client.state.state.turn,paused.turn);assert.equal(client.state.state.phase,paused.phase);
    client.ws.close(); const returning = await connect(code, token);
    assert.ok(returning.state, JSON.stringify(returning.messages)); assert.equal(returning.state.state.me, identity); assert.equal(returning.state.state.players.length, playerCount);
    assert.deepEqual(returning.state.state.board, paused.board); assert.equal(returning.state.state.room.paused,true);
    await returning.command({ type: 'resume' }); assert.equal(returning.state.state.room.paused,false);
    const resumedRevision=returning.state.revision;
    await returning.wait(message=>message.type==='state'&&message.revision>resumedRevision,returning.messages.length);
    await returning.command({ type: 'close' });
  }
  for (const input of [
    { playerCount: 2 }, { playerCount: 7 }, { playerCount: 4.5 }, { playerCount: '4' },
    { playerCount: 4, options: { playerExpansion: 'five-six-2025' } },
    { playerCount: 6, options: { playerExpansion: 'base' } },
    { playerCount: 3, options: { seafarers: true } },
  ]) {
    const response = await post({ practice: true, ...input }); assert.equal(response.status, 400, JSON.stringify(input)); assert.ok((await response.json()).error);
  }
  const token = crypto.randomUUID(), response = await post({ token, playerCount: 6, options }); assert.equal(response.status, 201);
  const { code } = await response.json(), lobby = await connect(code, token);
  assert.ok(lobby.state, JSON.stringify(lobby.messages)); assert.equal(lobby.state.state.players.length, 1); assert.equal(lobby.state.state.phase, 'lobby');
  assert.deepEqual(lobby.state.state.options, { ...options, playerExpansion: 'base' }); assert.equal(lobby.state.state.maxPlayers,6); await lobby.command({ type: 'close' });
  console.log('Practice protocol passed: 3–6 totals, matched rules, variants, private bot rooms, paused bot turns, reconnect/resume, incompatible rejection and automatic ordinary lobby.');
} finally { for (const ws of sockets) ws.terminate(); }
