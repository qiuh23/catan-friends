import { normalizeOptions, ruleProfile } from './game.js';
import { Room, fingerprint } from './room.js';
import { UserError } from './errors.js';

// Keep Node and Durable Objects on one creation contract. Only practice needs
// a total up front to fill bots; human lobbies choose their edition at start.
// Legacy explicit totals/editions remain validated for older practice clients.
export function roomCreationSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new UserError('房间设置无效。');
  const options = normalizeOptions(input.options);
  let playerCount = input.playerCount;
  if (playerCount !== undefined) {
    if (!Number.isInteger(playerCount) || playerCount < 3 || playerCount > 6) throw new UserError('总人数需要是 3–6 的整数。');
    const expansion = playerCount > 4 ? 'five-six-2025' : 'base';
    if (input.options?.playerExpansion === undefined) options.playerExpansion = expansion;
    else if (options.playerExpansion !== expansion) throw new UserError(`${playerCount} 人需要${playerCount > 4 ? ' 5–6 人扩充规则' : '基础规则（3–4 人）'}，请调整人数或规则。`);
  } else playerCount = ruleProfile(options).minPlayers;
  return { practice: input.practice === true, playerCount, options, visibility: input.visibility ?? 'public' };
}

export async function createRoomFromInput(input, now = Date.now()) {
  const settings = roomCreationSettings(input), hash = await fingerprint(input.token);
  const room = new Room(undefined, now), id = room.join(hash, input.name, now);
  const command = action => room.handle(id, { id: crypto.randomUUID(), revision: room.record.revision, action }, now);
  room.record.practice = settings.practice;
  command({ type: 'configure', visibility: settings.visibility, options: settings.options });
  if (settings.practice) {
    for (let i = 1; i < settings.playerCount; i++) command({ type: 'addBot' });
    command({ type: 'start' });
  }
  return room;
}
