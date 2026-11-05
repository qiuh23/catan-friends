import { RESOURCES, LABELS, COLORS, emptyHand, total, shuffle, createBoard, settlementSites, roadSites, citySites, longestRoad } from './board.js';
export { RESOURCES, LABELS, COLORS, total };
export const COSTS = { road: { wood: 1, brick: 1 }, settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 }, city: { wheat: 2, ore: 3 }, development: { sheep: 1, wheat: 1, ore: 1 } };
export const DEV_NAMES = { knight: '骑士', roadBuilding: '道路建设', plenty: '丰收', monopoly: '垄断', victory: '胜利点' };
const fail = message => { throw new Error(message); };
const requireRule = (condition, message) => { if (!condition) fail(message); };
export const afford = (hand, cost) => Object.entries(cost).every(([r,n]) => hand[r] >= n);
export function createGame() {
  return { version: 1, phase: 'lobby', players: [], board: null, turn: 0, turnNo: 0, dice: null, bank: emptyHand(19), deck: [], robber: null, discards: {}, setupIndex: 0, setupVertex: null, playedDev: false, freeRoads: 0, resumePhase: null, longest: null, army: null, offer: null, winner: null, log: [] };
}
export function addPlayer(g, id, name, bot = false) {
  requireRule(g.phase === 'lobby', '对局已经开始，不能加入新玩家。');
  requireRule(g.players.length < 4, '房间已有 4 位玩家。');
  requireRule(typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 16, '昵称需要 1–16 个字符。');
  requireRule(!g.players.some(p => p.id === id), '该玩家已在房间。');
  g.players.push({ id, name: name.trim(), color: COLORS.find(c => !g.players.some(p => p.color === c)), bot, ready: bot, hand: emptyHand(), dev: [], knights: 0, roadLength: 0 });
}
function log(g, text) { g.log.push({ id: (g.log.at(-1)?.id || 0)+1, text }); g.log = g.log.slice(-80); }
export function points(g, id, hidden = true) {
  const p = g.players.find(p => p.id === id);
  return (g.board?.vertices.filter(v => v.owner === id).reduce((sum,v) => sum+v.level,0) || 0) + (g.longest === id ? 2 : 0) + (g.army === id ? 2 : 0) + (hidden ? p.dev.filter(d => d.type === 'victory').length : 0);
}
function award(g, key, stat, minimum) {
  const max = Math.max(...g.players.map(p => p[stat]));
  const leaders = g.players.filter(p => p[stat] === max);
  g[key] = max < minimum ? null : leaders.some(p => p.id === g[key]) ? g[key] : leaders.length === 1 ? leaders[0].id : null;
}
export function updateAwards(g) {
  for (const p of g.players) p.roadLength = longestRoad(g.board, p.id);
  award(g,'longest','roadLength',5); award(g,'army','knights',3);
}
function victory(g) {
  if (['lobby','setup-settlement','setup-road'].includes(g.phase)) return;
  const p = g.players[g.turn];
  if (points(g,p.id) >= 10) { g.winner = p.id; g.phase = 'finished'; g.offer = null; log(g, `${p.name} 达到 ${points(g,p.id)} 分，赢得这座岛屿！`); }
}
function pay(g, p, cost) {
  requireRule(afford(p.hand,cost),'资源不足，请先交易或等待生产。');
  for (const [r,n] of Object.entries(cost)) { p.hand[r] -= n; g.bank[r] += n; }
}
function take(g, p, resource, n = 1) { g.bank[resource] -= n; p.hand[resource] += n; }
function bundle(value) {
  requireRule(value && typeof value === 'object' && !Array.isArray(value), '资源选择无效。');
  requireRule(Object.keys(value).every(r => RESOURCES.includes(r)), '包含未知资源。');
  const hand = emptyHand();
  for (const r of RESOURCES) { const n = value[r] ?? 0; requireRule(Number.isInteger(n) && n >= 0 && n <= 19, '资源数量需要是 0–19 的整数。'); hand[r] = n; }
  return hand;
}
export function tradeRatio(g, id, resource) {
  const ports = g.board.ports.filter(port => port.vertices.some(v => g.board.vertices[v].owner === id));
  return ports.some(p => p.resource === resource) ? 2 : ports.some(p => p.resource === 'any') ? 3 : 4;
}
export function victims(g) {
  const ids = new Set(g.board.tiles[g.robber].vertices.map(v => g.board.vertices[v].owner));
  return g.players.filter(p => ids.has(p.id) && p.id !== g.players[g.turn].id && total(p.hand) > 0).map(p => p.id);
}
function finishRobber(g) { g.phase = g.resumePhase || 'action'; g.resumePhase = null; }
function produce(g, sum) {
  for (const r of RESOURCES) {
    const demand = g.players.map(p => ({ p, n: g.board.vertices.filter(v => v.owner === p.id).reduce((n,v) => n + v.level * v.tiles.filter(id => { const t = g.board.tiles[id]; return id !== g.robber && t.number === sum && t.resource === r; }).length,0) })).filter(d => d.n > 0);
    const need = demand.reduce((n,d) => n+d.n,0);
    if (need <= g.bank[r]) for (const {p,n} of demand) take(g,p,r,n);
    else if (demand.length === 1) take(g,demand[0].p,r,g.bank[r]);
    else if (need) log(g, `${LABELS[r]}库存不足，本次该资源不分发。`);
  }
}
export function legal(g, id) {
  if (!g.board) return { settlement: [], road: [], city: [], robber: [], victims: [] };
  const current = g.players[g.turn]?.id === id;
  return {
    settlement: current && ['action','setup-settlement'].includes(g.phase) ? settlementSites(g,id,g.phase === 'setup-settlement') : [],
    road: current && ['action','setup-road','road-building'].includes(g.phase) ? roadSites(g,id,g.phase === 'setup-road' ? g.setupVertex : null) : [],
    city: current && g.phase === 'action' ? citySites(g,id) : [],
    robber: current && g.phase === 'robber' ? g.board.tiles.filter(t => t.id !== g.robber).map(t => t.id) : [],
    victims: current && g.phase === 'steal' ? victims(g) : [],
  };
}
// All mutations run on a clone: a rejected command never partially changes the room.
export function act(source, actorId, action, random = Math.random) {
  const g = structuredClone(source), p = g.players.find(p => p.id === actorId);
  requireRule(p && action && typeof action.type === 'string','操作或玩家身份无效。');
  const type = action.type, host = g.players[0].id === actorId;
  if (type === 'ready') {
    requireRule(g.phase === 'lobby','对局已开始。'); p.ready = !p.ready; return g;
  }
  if (type === 'start') {
    requireRule(host && g.phase === 'lobby','只有房主可以开始对局。');
    requireRule(g.players.length >= 3 && g.players.every(v => v.id === actorId || v.ready),'需要 3–4 位玩家，且其他玩家均已准备。');
    g.board = createBoard(random); g.robber = g.board.tiles.find(t => t.resource === 'desert').id;
    g.deck = shuffle([...Array(14).fill('knight'), ...Array(5).fill('victory'), ...Array(2).fill('roadBuilding'), ...Array(2).fill('plenty'), ...Array(2).fill('monopoly')],random);
    g.phase = 'setup-settlement'; log(g, '新的岛屿已展开。按顺序放置第一座村庄和道路，再逆序放置第二组。'); return g;
  }
  requireRule(g.phase !== 'lobby' && g.phase !== 'finished','当前不能执行该操作。');
  if (type === 'discard') {
    requireRule(g.phase === 'discard' && g.discards[actorId] > 0,'当前无需弃牌。');
    const cards = bundle(action.cards); requireRule(total(cards) === g.discards[actorId] && afford(p.hand,cards),`请选择恰好 ${g.discards[actorId]} 张手牌。`);
    pay(g,p,cards); delete g.discards[actorId]; log(g,`${p.name} 弃掉 ${total(cards)} 张资源牌。`);
    if (!Object.keys(g.discards).length) g.phase = 'robber'; return g;
  }
  if (type === 'acceptTrade') {
    requireRule(g.phase === 'action' && g.offer && g.offer.id === action.offerId && g.offer.from !== actorId,'交易已失效。');
    const from = g.players.find(v => v.id === g.offer.from), {give,want} = g.offer;
    requireRule(afford(from.hand,give) && afford(p.hand,want),'其中一方资源不足，无法成交。');
    for (const r of RESOURCES) { from.hand[r] += want[r]-give[r]; p.hand[r] += give[r]-want[r]; }
    log(g, `${from.name} 与 ${p.name} 完成交易。`); g.offer = null; return g;
  }
  requireRule(g.players[g.turn].id === actorId,'请等待你的回合。');
  const sites = legal(g,actorId);
  if (type === 'buildSettlement') {
    requireRule(sites.settlement.includes(action.vertex),'此处不能建造村庄：需连接自己的道路，且与其他建筑至少间隔一条空边。');
    const setup = g.phase === 'setup-settlement'; if (!setup) pay(g,p,COSTS.settlement);
    const v = g.board.vertices[action.vertex]; v.owner = actorId; v.level = 1;
    if (setup) {
      if (g.setupIndex >= g.players.length) for (const id of v.tiles) { const r = g.board.tiles[id].resource; if (r !== 'desert' && g.bank[r]) take(g,p,r); }
      g.setupVertex = v.id; g.phase = 'setup-road';
    }
    log(g,`${p.name} 建造了一座村庄。`); updateAwards(g);
  } else if (type === 'buildRoad') {
    requireRule(sites.road.includes(action.edge),'此处不能铺路：需连接自己的路网，且不能穿过对手建筑。');
    const setup = g.phase === 'setup-road', free = g.phase === 'road-building'; if (!setup && !free) pay(g,p,COSTS.road);
    g.board.edges[action.edge].owner = actorId; log(g,`${p.name} 铺设了一条道路。`);
    if (setup) {
      g.setupIndex++; g.setupVertex = null;
      const n = g.players.length;
      if (g.setupIndex === n*2) { g.turn = 0; g.turnNo = 1; g.phase = 'roll'; }
      else { g.turn = g.setupIndex < n ? g.setupIndex : n*2-1-g.setupIndex; g.phase = 'setup-settlement'; }
    } else if (free) {
      g.freeRoads--; if (!g.freeRoads || !roadSites(g,actorId).length) { g.phase = g.resumePhase; g.resumePhase = null; g.freeRoads = 0; }
    }
    updateAwards(g);
  } else if (type === 'buildCity') {
    requireRule(sites.city.includes(action.vertex),'只能升级自己的村庄，且最多建造 4 座城市。');
    pay(g,p,COSTS.city); g.board.vertices[action.vertex].level = 2; log(g,`${p.name} 将村庄升级为城市。`);
  } else if (type === 'roll') {
    requireRule(g.phase === 'roll','当前不能掷骰。');
    g.dice = [1+Math.floor(random()*6),1+Math.floor(random()*6)]; const sum = g.dice[0]+g.dice[1]; log(g,`${p.name} 掷出了 ${g.dice[0]} + ${g.dice[1]} = ${sum}。`);
    if (sum === 7) {
      g.discards = Object.fromEntries(g.players.filter(v => total(v.hand)>7).map(v => [v.id,Math.floor(total(v.hand)/2)]));
      g.resumePhase = 'action'; g.phase = Object.keys(g.discards).length ? 'discard' : 'robber';
    } else { produce(g,sum); g.phase = 'action'; }
  } else if (type === 'moveRobber') {
    requireRule(sites.robber.includes(action.tile),'请选择强盗当前所在格以外的地块。');
    g.robber = action.tile; log(g,`${p.name} 将强盗移到${LABELS[g.board.tiles[g.robber].resource]}地块。`);
    if (victims(g).length) g.phase = 'steal'; else finishRobber(g);
  } else if (type === 'steal') {
    requireRule(sites.victims.includes(action.victim),'只能从相邻且有资源的对手处抽取一张牌。');
    const victim = g.players.find(v => v.id === action.victim), cards = RESOURCES.flatMap(r => Array(victim.hand[r]).fill(r));
    const r = cards[Math.floor(random()*cards.length)]; victim.hand[r]--; p.hand[r]++; log(g,`${p.name} 从 ${victim.name} 手中抽取了一张资源牌。`); finishRobber(g);
  } else if (type === 'bankTrade') {
    requireRule(g.phase === 'action' && RESOURCES.includes(action.give) && RESOURCES.includes(action.want) && action.give !== action.want,'请选择两种不同的资源。');
    const ratio = tradeRatio(g,actorId,action.give); requireRule(p.hand[action.give] >= ratio && g.bank[action.want] > 0,'手牌或银行库存不足。');
    pay(g,p,{[action.give]:ratio}); take(g,p,action.want); log(g,`${p.name} 用 ${ratio} 张${LABELS[action.give]}换取了 1 张${LABELS[action.want]}。`);
  } else if (type === 'offerTrade') {
    requireRule(g.phase === 'action','掷骰并处理强盗后才能交易。');
    const give = bundle(action.give), want = bundle(action.want);
    requireRule(total(give)>0 && total(want)>0 && afford(p.hand,give) && RESOURCES.every(r => !give[r] || !want[r]),'请提供自己持有的资源，并选择不同的所需资源。');
    g.offer = {id: crypto.randomUUID(), from:actorId, give, want}; log(g,`${p.name} 发起了一笔资源交易。`);
  } else if (type === 'cancelTrade') {
    requireRule(g.phase === 'action','当前不能取消交易。'); g.offer = null;
  } else if (type === 'buyDevelopment') {
    requireRule(g.phase === 'action' && g.deck.length>0,'当前不能购买发展卡。'); pay(g,p,COSTS.development);
    p.dev.push({id:crypto.randomUUID(),type:g.deck.pop(),bought:g.turnNo}); log(g,`${p.name} 购买了一张发展卡。`);
  } else if (type === 'playDevelopment') {
    requireRule(['roll','action'].includes(g.phase) && !g.playedDev,'每回合只能打出一张发展卡。');
    const card = p.dev.find(c => c.id === action.cardId);
    requireRule(card && card.type !== 'victory' && card.bought < g.turnNo,'只能使用之前回合购入的发展卡；胜利点自动计分。');
    if (card.type === 'plenty') {
      const cards = bundle(action.cards); requireRule(total(cards)===2 && afford(g.bank,cards),'请选择银行中有库存的两张资源牌。');
      for (const r of RESOURCES) take(g,p,r,cards[r]);
    } else if (card.type === 'monopoly') {
      requireRule(RESOURCES.includes(action.resource),'请选择一种资源。');
      for (const other of g.players.filter(v => v.id !== actorId)) { p.hand[action.resource] += other.hand[action.resource]; other.hand[action.resource] = 0; }
    } else if (card.type === 'knight') {
      p.knights++; g.resumePhase = g.phase; g.phase = 'robber'; updateAwards(g);
    } else if (card.type === 'roadBuilding') {
      requireRule(roadSites(g,actorId).length>0,'没有可铺设的道路。');
      g.freeRoads = Math.min(2,15-g.board.edges.filter(e => e.owner === actorId).length); g.resumePhase = g.phase; g.phase = 'road-building';
    }
    p.dev = p.dev.filter(c => c.id !== card.id); g.playedDev = true; log(g,`${p.name} 打出了「${DEV_NAMES[card.type]}」。`);
  } else if (type === 'endTurn') {
    requireRule(g.phase === 'action','请先完成掷骰、弃牌或强盗操作。');
    // Victory belongs to the active player; check before handing the turn over.
    victory(g); if (g.winner) return g;
    g.turn = (g.turn+1)%g.players.length; g.turnNo++; g.phase = 'roll'; g.dice = null; g.playedDev = false; g.offer = null;
  } else fail('未知操作。');
  victory(g); return g;
}
export function viewFor(g, id) {
  const {deck,players,...rest} = structuredClone(g);
  return { ...rest, deckCount:deck.length, me:id, legal:legal(g,id), players:players.map(p => {
    const {hand,dev,...publicPlayer} = p;
    return { ...publicPlayer, cards:total(hand), developmentCount:dev.length, points:points(g,p.id,p.id===id || g.phase==='finished'), ...(p.id===id || g.phase==='finished' ? {hand,dev} : {}) };
  }) };
}

export function botAction(g, id) {
  const p = g.players.find(p => p.id===id), sites = legal(g,id);
  if (g.phase === 'discard' && g.discards[id]) {
    const cards=emptyHand(), held={...p.hand};
    for(let n=0;n<g.discards[id];n++) { const r=RESOURCES.toSorted((a,b)=>held[b]-held[a])[0]; cards[r]++; held[r]--; }
    return {type:'discard',cards};
  }
  if (g.players[g.turn].id !== id) return null;
  const value = v => g.board.vertices[v].tiles.reduce((sum,t) => sum+(g.board.tiles[t].number ? 6-Math.abs(7-g.board.tiles[t].number) : 0),0);
  if (g.phase==='setup-settlement') return {type:'buildSettlement',vertex:sites.settlement.toSorted((a,b)=>value(b)-value(a))[0]};
  const bestRoad = () => sites.road.toSorted((a,b) => {
    const score = eid => { const e=g.board.edges[eid]; return Math.max(...[e.a,e.b].map(v=> g.board.vertices[v].owner ? -10 : value(v) - g.board.vertices[v].edges.filter(i=>g.board.edges[i].owner===id).length*4)); };
    return score(b)-score(a);
  })[0];
  if (['setup-road','road-building'].includes(g.phase)) return {type:'buildRoad',edge:bestRoad()};
  if (g.phase==='roll') return {type:'roll'};
  if (g.phase==='robber') {
    const score = tid => g.board.tiles[tid].vertices.reduce((s,v)=>s+(g.board.vertices[v].owner===id ? -8 : g.board.vertices[v].owner ? 3 : 0),0);
    return {type:'moveRobber',tile:sites.robber.toSorted((a,b)=>score(b)-score(a))[0]};
  }
  if (g.phase==='steal') return {type:'steal',victim:sites.victims[0]};
  if (g.phase!=='action') return null;
  const card=p.dev.find(c=>c.type!=='victory' && c.bought<g.turnNo);
  if (card && !g.playedDev) {
    const action={type:'playDevelopment',cardId:card.id};
    if(card.type==='knight' || (card.type==='roadBuilding' && sites.road.length)) return action;
    if(card.type==='monopoly') return {...action,resource:RESOURCES.toSorted((a,b)=>p.hand[a]-p.hand[b])[0]};
    if(card.type==='plenty' && total(g.bank)>=2) {
      const cards=emptyHand(); for(let n=0;n<2;n++) { const r=RESOURCES.filter(r=>g.bank[r]>cards[r]).toSorted((a,b)=>p.hand[a]+cards[a]-p.hand[b]-cards[b])[0]; cards[r]++; } return {...action,cards};
    }
  }
  if(sites.city.length && afford(p.hand,COSTS.city)) return {type:'buildCity',vertex:sites.city.toSorted((a,b)=>value(b)-value(a))[0]};
  if(sites.settlement.length && afford(p.hand,COSTS.settlement)) return {type:'buildSettlement',vertex:sites.settlement.toSorted((a,b)=>value(b)-value(a))[0]};
  const owned=g.board.edges.filter(e=>e.owner===id).length;
  if(sites.road.length && owned<15 && afford(p.hand,COSTS.road) && !sites.settlement.length) return {type:'buildRoad',edge:bestRoad()};
  const target=sites.settlement.length ? COSTS.settlement : sites.city.length ? COSTS.city : sites.road.length ? COSTS.road : COSTS.development;
  for(const want of RESOURCES.filter(r=>(target[r]||0)>p.hand[r] && g.bank[r]>0)) {
    const give=RESOURCES.find(r=>r!==want && p.hand[r]-(target[r]||0)>=tradeRatio(g,id,r));
    if(give) return {type:'bankTrade',give,want};
  }
  if(g.deck.length && afford(p.hand,COSTS.development)) return {type:'buyDevelopment'};
  return {type:'endTurn'};
}
