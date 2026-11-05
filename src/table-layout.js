// A required task can belong to someone other than the current turn's player.
// Keep this independent of optional panels and collapsed chat/log/player details.
export function requiredTask(state) {
  if(!state?.board||state.phase==='finished')return null;
  if(state.room?.paused)return {key:'paused',title:'对局已暂停',description:'等待房主恢复对局。'};
  if(state.phase==='discard'&&state.discards?.[state.me])return {
    key:`discard:${state.turnNo}:${state.discards[state.me]}`,
    title:`请弃掉 ${state.discards[state.me]} 张资源`,description:'需要你处理 · 选择资源后确认弃牌。',
  };
  if(state.phase==='steal'&&state.players[state.turn]?.id===state.me)return {
    key:`steal:${state.turnNo}`,title:'请选择一位对手',description:'需要你处理 · 抽取一张资源。',
  };
  if(state.offer&&state.offer.from!==state.me)return {
    key:`offer:${state.offer.id}`,title:'收到一笔交易报价',description:'查看对方提供与需要的资源。',
  };
  return null;
}
