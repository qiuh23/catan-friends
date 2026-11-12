// A room-owned active-play clock. No local timezone, secret game data, or timers.
export const GAME_DAY_MS = 12 * 60 * 1000;
export const HOME_DAY_MS = 100 * 1000;
export function sceneElapsed(clock, now) {
  return Math.max(0,clock.elapsedMs + (clock.resumedAt===null ? 0 : Math.max(0,now-clock.resumedAt)));
}
export function updateSceneClock(record, now, online) {
  const lobby=record.game.phase==='lobby';
  // Old saves start at a deterministic point based only on public turn count.
  record.sceneClock ||= {elapsedMs:lobby?0:Math.max(0,(record.game.turnNo||1)-1)*15000,resumedAt:null};
  const elapsedMs=lobby?0:sceneElapsed(record.sceneClock,now);
  const present=online===undefined ? record.hostConnected : record.game.players.some(p=>!p.bot&&online.includes(p.id));
  const running=!lobby&&record.game.phase!=='finished'&&!record.paused&&present;
  record.sceneClock={elapsedMs,resumedAt:running?now:null};
}
export function projectSceneClock(record, now) {
  return {elapsedMs:sceneElapsed(record.sceneClock,now),sampledAt:now,running:record.sceneClock.resumedAt!==null};
}
