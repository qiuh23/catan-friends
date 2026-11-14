import { RESOURCES, LABELS, COLORS, emptyHand, total, shuffle, createBoard, settlementSites, roadSites, citySites, longestRoad } from './board.js';
import { createRandomStream, randomIndex } from './random.js';
import { UserError } from './errors.js';
export { RESOURCES, LABELS, COLORS, total };
export const COSTS = { road: { wood: 1, brick: 1 }, settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 }, city: { wheat: 2, ore: 3 }, development: { sheep: 1, wheat: 1, ore: 1 } };
export const DEV_NAMES = { knight: '骑士', roadBuilding: '道路建设', plenty: '丰收', monopoly: '垄断', victory: '胜利点' };
const fail = message => { throw new UserError(message); };
const requireRule = (condition, message) => { if (!condition) fail(message); };
export const afford = (hand, cost) => Object.entries(cost).every(([r,n]) => hand[r] >= n);
export function normalizeOptions(options = {}) {
  requireRule(options && typeof options === 'object' && !Array.isArray(options), '规则选项无效。');
  requireRule(Object.keys(options).every(key => ['friendlyRobber','harbormaster','playerExpansion'].includes(key)), '包含尚未支持的拓展规则。');
  requireRule(['friendlyRobber','harbormaster'].every(key => options[key] === undefined || typeof options[key] === 'boolean'), '规则开关必须为布尔值。');
  requireRule(options.playerExpansion === undefined || ['base','five-six-2025'].includes(options.playerExpansion), '人数扩充版本无效。');
  return { friendlyRobber: options.friendlyRobber ?? false, harbormaster: options.harbormaster ?? false, playerExpansion: options.playerExpansion ?? 'base' };
}
export function ruleProfile(value = {}) {
  const options = Array.isArray(value.players) && value.phase === 'lobby' ? optionsForPlayers(value.options, value.players.length) : normalizeOptions(Array.isArray(value.players) ? value.options : value.options || value);
  return options.playerExpansion === 'five-six-2025'
    ? {id:'five-six-2025',version:'2025',minPlayers:5,maxPlayers:6,resourceCount:24,landHexes:30,developmentCards:34,turnRule:'paired'}
    : {id:'base',version:'2025',minPlayers:3,maxPlayers:4,resourceCount:19,landHexes:19,developmentCards:25,turnRule:'single'};
}
// Seat count owns the board edition in the waiting room. Persisted games keep
// their original edition once started, even while their humans are offline.
export function optionsForPlayers(options, count) {
  return { ...normalizeOptions(options), playerExpansion: count >= 5 ? 'five-six-2025' : 'base' };
}
export function targetPoints(g) { return g.options?.harbormaster ? 11 : 10; }
export function createGame(options = {}, seed) {
  const rules = normalizeOptions(options), profile=ruleProfile(rules);
  return { version: 1, random:createRandomStream(seed), options: rules, targetPoints: rules.harbormaster ? 11 : 10, harbormaster: null, phase: 'lobby', players: [], board: null, turn: 0, primaryTurn:0, pairStep:'primary', turnNo: 0, dice: null, bank: emptyHand(profile.resourceCount), deck: [], robber: null, discards: {}, setupIndex: 0, setupVertex: null, playedDev: false, freeRoads: 0, resumePhase: null, longest: null, army: null, offer: null, winner: null, log: [] };
}
export function addPlayer(g, id, name, bot = false) {
  requireRule(g.phase === 'lobby', '对局已经开始，不能加入新玩家。');
  requireRule(g.players.length < 6, '房间已有 6 位玩家。');
  requireRule(typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 16, '昵称需要 1–16 个字符。');
  requireRule(!g.players.some(p => p.id === id), '该玩家已在房间。');
  g.players.push({ id, name: name.trim(), color: COLORS.find(c => !g.players.some(p => p.color === c)), bot, ready: bot, hand: emptyHand(), dev: [], knights: 0, roadLength: 0 });
}
function log(g, text) { g.log.push({ id: (g.log.at(-1)?.id || 0)+1, text }); g.log = g.log.slice(-80); }
function chooseStartingPlayer(g, random) {
  let candidates = g.players.map((_, index) => index);
  // A broken fixture/source must fail atomically, never hang or silently favor
  // a seat. Real authority uses the room's persisted, unbiased random stream.
  for (let rounds = 1; rounds <= 128; rounds++) {
    const rolls = candidates.map(index => ({ index, dice: [randomIndex(6,random)+1, randomIndex(6,random)+1] }));
    const highest = Math.max(...rolls.map(({dice}) => dice[0]+dice[1]));
    const leaders = rolls.filter(({dice}) => dice[0]+dice[1] === highest);
    log(g, `${rounds === 1 ? '先手掷骰' : '同分加掷'}：${rolls.map(({index,dice}) => `${g.players[index].name} ${dice[0]}+${dice[1]}=${dice[0]+dice[1]}`).join('；')}。`);
    if (leaders.length === 1) {
      const winner = {...leaders[0], rounds};
      log(g, `${g.players[winner.index].name} 获得先手；按座次顺序放置第一组，逆序放置第二组。`);
      return winner;
    }
    candidates = leaders.map(({index}) => index);
  }
  throw new Error('先手掷骰达到重试上限。');
}
// Presentation is an append-only public stream. Never copy commands, hands,
// development-card objects, or trade bundles into these records.
function present(g, kind, actorId, text, targets = []) {
  g.presentation ||= { epoch: crypto.randomUUID(), sequence: 0, events: [] };
  const stream = g.presentation;
  stream.events.push({ id: ++stream.sequence, kind, actorId, text, targets });
  stream.events = stream.events.slice(-80);
}
export function points(g, id, hidden = true) {
  const p = g.players.find(p => p.id === id);
  return (g.board?.vertices.filter(v => v.owner === id).reduce((sum,v) => sum+v.level,0) || 0) + (g.longest === id ? 2 : 0) + (g.army === id ? 2 : 0) + (g.options?.harbormaster && g.harbormaster === id ? 2 : 0) + (hidden ? p.dev.filter(d => d.type === 'victory').length : 0);
}
function award(g, key, stat, minimum) {
  const max = Math.max(...g.players.map(p => p[stat]));
  const leaders = g.players.filter(p => p[stat] === max);
  g[key] = max < minimum ? null : leaders.some(p => p.id === g[key]) ? g[key] : leaders.length === 1 ? leaders[0].id : null;
}
export function updateAwards(g) {
  const previous={longest:g.longest,army:g.army,harbormaster:g.harbormaster};
  for (const p of g.players) p.roadLength = longestRoad(g.board, p.id);
  award(g,'longest','roadLength',5); award(g,'army','knights',3);
  // Count buildings, never roads or merely reaching the coast. A city is worth two.
  for (const p of g.players) p.harborPoints = g.board.vertices.filter(v => v.owner === p.id && g.board.ports.some(port => port.vertices.includes(v.id))).reduce((sum,v) => sum+v.level,0);
  if (g.options?.harbormaster) award(g,'harbormaster','harborPoints',3);
  else g.harbormaster = null;
  for(const [key,name] of [['longest','最长道路'],['army','最大军队'],['harbormaster','卡坦港口']]){
    if(previous[key]===g[key]||!g.presentation)continue;
    const holder=g.players.find(p=>p.id===(g[key]||previous[key]));
    if(!holder)continue;
    const target=g.board.vertices.find(v=>v.owner===holder.id);
    const text=g[key]?`${holder.name} 获得${name} · +2 分${previous[key]?'（奖项转移）':''}`:`${holder.name} 失去${name} · −2 分`;
    log(g,text);present(g,'award',holder.id,text,target?[{kind:'vertex',id:target.id}]:[]);
  }
}
function victory(g) {
  if (['lobby','setup-settlement','setup-road'].includes(g.phase)) return;
  const p = g.players[g.turn];
  if (points(g,p.id) >= targetPoints(g)) { g.winner = p.id; g.phase = 'finished'; g.offer = null; log(g, `${p.name} 达到 ${points(g,p.id)} 分，赢得这座岛屿！`); }
}
function pay(g, p, cost) {
  requireRule(afford(p.hand,cost),'资源不足，请先交易或等待生产。');
  for (const [r,n] of Object.entries(cost)) { p.hand[r] -= n; g.bank[r] += n; }
}
function take(g, p, resource, n = 1) { g.bank[resource] -= n; p.hand[resource] += n; }
function bundle(value, maximum = 19) {
  requireRule(value && typeof value === 'object' && !Array.isArray(value), '资源选择无效。');
  requireRule(Object.keys(value).every(r => RESOURCES.includes(r)), '包含未知资源。');
  const hand = emptyHand();
  for (const r of RESOURCES) { const n = value[r] ?? 0; requireRule(Number.isInteger(n) && n >= 0 && n <= maximum, `资源数量需要是 0–${maximum} 的整数。`); hand[r] = n; }
  return hand;
}
export function tradeRatio(g, id, resource) {
  const ports = g.board.ports.filter(port => port.vertices.some(v => g.board.vertices[v].owner === id));
  return ports.some(p => p.resource === resource) ? 2 : ports.some(p => p.resource === 'any') ? 3 : 4;
}
export function victims(g) {
  const ids = new Set(g.board.tiles[g.robber].vertices.map(v => g.board.vertices[v].owner));
  return g.players.filter(p => ids.has(p.id) && p.id !== g.players[g.turn].id && total(p.hand) > 0 && (!g.options?.friendlyRobber || points(g,p.id,false) > 2)).map(p => p.id);
}
function robberSites(g) {
  const tiles = g.board.tiles.filter(t => t.id !== g.robber);
  if (!g.options?.friendlyRobber) return tiles.map(t => t.id);
  // Hidden VP cards must not affect legal targets (and reveal their existence).
  const protectedIds = new Set(g.players.filter(p => points(g,p.id,false) <= 2).map(p => p.id));
  const safe = tiles.filter(t => t.vertices.every(v => !protectedIds.has(g.board.vertices[v].owner)));
  // Sixth-edition fallback: retreat to the desert, even if it is the current hex.
  return safe.length ? safe.map(t => t.id) : g.board.tiles.filter(t => t.resource === 'desert').map(t => t.id);
}
function finishRobber(g) { g.phase = g.resumePhase || 'action'; g.resumePhase = null; }
function produce(g, sum) {
  const productiveTiles = new Set();
  for (const r of RESOURCES) {
    const demand = g.players.map(p => ({ p, n: g.board.vertices.filter(v => v.owner === p.id).reduce((n,v) => n + v.level * v.tiles.filter(id => { const t = g.board.tiles[id]; return id !== g.robber && t.number === sum && t.resource === r; }).length,0) })).filter(d => d.n > 0);
    const need = demand.reduce((n,d) => n+d.n,0);
    const paid=new Map();
    if (need <= g.bank[r]) { for (const {p,n} of demand) {take(g,p,r,n);paid.set(p.id,n);} }
    else if (demand.length === 1) {const n=g.bank[r];take(g,demand[0].p,r,n);paid.set(demand[0].p.id,n);}
    else if (need) log(g, `${LABELS[r]}库存不足，本次该资源不分发。`);
    // Stable attribution for a partial single-player payout. Unpaid tiles
    // cannot receive harvest feedback, even when their dice number matches.
    for(const t of g.board.tiles.filter(t=>t.id!==g.robber&&t.number===sum&&t.resource===r))for(const id of t.vertices){
      const v=g.board.vertices[id],n=Math.min(v.level||0,paid.get(v.owner)||0);
      if(n){productiveTiles.add(t.id);paid.set(v.owner,paid.get(v.owner)-n);}
    }
  }
  return g.board.tiles.filter(t => productiveTiles.has(t.id)).map(t => ({ kind: 'tile', id: t.id }));
}
export function legal(g, id) {
  if (!g.board) return { settlement: [], road: [], city: [], robber: [], victims: [] };
  const current = g.players[g.turn]?.id === id;
  return {
    settlement: current && ['action','setup-settlement'].includes(g.phase) ? settlementSites(g,id,g.phase === 'setup-settlement') : [],
    road: current && ['action','setup-road','road-building'].includes(g.phase) ? roadSites(g,id,g.phase === 'setup-road' ? g.setupVertex : null) : [],
    city: current && g.phase === 'action' ? citySites(g,id) : [],
    robber: current && g.phase === 'robber' ? robberSites(g) : [],
    victims: current && g.phase === 'steal' ? victims(g) : [],
  };
}
// All mutations run on a clone: a rejected command never partially changes the room.
export function act(source, actorId, action, fixtureRandom) {
  const g = structuredClone(source), p = g.players.find(p => p.id === actorId);
  // The stream is inside this clone: failed rules and persistence retries leave
  // the original stream untouched. Legacy games get entropy once on room load.
  const random = fixtureRandom || (g.random ??= createRandomStream());
  requireRule(p && action && typeof action.type === 'string','操作或玩家身份无效。');
  const type = action.type, host = (g.hostId || g.players[0]?.id) === actorId;
  if (type === 'ready') {
    requireRule(g.phase === 'lobby','对局已开始。'); p.ready = typeof action.ready === 'boolean' ? action.ready : !p.ready; return g;
  }
  if (type === 'setOptions') {
    requireRule(host && g.phase === 'lobby','只有房主可以在开局前更改规则。');
    const requested=normalizeOptions(action.options);
    requireRule(!(action.options?.playerExpansion === 'base' && g.players.length > 4),'当前实际人数需要 5–6 人扩充；人数规则自动匹配，请保留变体并刷新设置。');
    const options=optionsForPlayers(requested,g.players.length),profile=ruleProfile(options);
    g.options = options; g.targetPoints = targetPoints(g); g.harbormaster = null;g.bank=emptyHand(profile.resourceCount);
    for (const player of g.players) player.ready = player.bot;
    return g;
  }
  if (type === 'start') {
    requireRule(host && g.phase === 'lobby','只有房主可以开始对局。');
    g.options = optionsForPlayers(g.options,g.players.length);
    const profile=ruleProfile(g), expanded=profile.turnRule==='paired';
    requireRule(g.players.length >= 3 && g.players.length<=6 && g.players.every(v => v.id === actorId || v.ready),'需要 3–6 位玩家，且其他玩家均已准备。');
    g.startingPlayer = chooseStartingPlayer(g,random);
    g.bank = emptyHand(profile.resourceCount);
    g.board = createBoard(random,g.options); g.robber = g.board.tiles.find(t => t.resource === 'desert').id;
    g.deck = shuffle([...Array(expanded?20:14).fill('knight'), ...Array(5).fill('victory'), ...Array(expanded?3:2).fill('roadBuilding'), ...Array(expanded?3:2).fill('plenty'), ...Array(expanded?3:2).fill('monopoly')],random);
    g.turn=g.startingPlayer.index;g.primaryTurn=g.turn;g.pairStep='primary';
    g.presentation = { epoch: crypto.randomUUID(), sequence: 0, events: [] };
    g.phase = 'setup-settlement'; log(g, '新的岛屿已展开。按顺序放置第一座村庄和道路，再逆序放置第二组。'); return g;
  }
  requireRule(g.phase !== 'lobby' && g.phase !== 'finished','当前不能执行该操作。');
  if (type === 'discard') {
    requireRule(g.phase === 'discard' && g.discards[actorId] > 0,'当前无需弃牌。');
    const cards = bundle(action.cards,ruleProfile(g).resourceCount); requireRule(total(cards) === g.discards[actorId] && afford(p.hand,cards),`请选择恰好 ${g.discards[actorId]} 张手牌。`);
    pay(g,p,cards); delete g.discards[actorId]; log(g,`${p.name} 弃掉 ${total(cards)} 张资源牌。`);
    present(g,'discard',actorId,`${p.name} 完成弃牌。`);
    if (!Object.keys(g.discards).length) g.phase = 'robber'; return g;
  }
  if (type === 'acceptTrade') {
    requireRule(g.pairStep!=='secondary','配对玩家二不能与其他玩家交易。');
    requireRule(g.phase === 'action' && g.offer && g.offer.id === action.offerId && g.offer.from !== actorId,'交易已失效。');
    const from = g.players.find(v => v.id === g.offer.from), {give,want} = g.offer;
    requireRule(afford(from.hand,give) && afford(p.hand,want),'其中一方资源不足，无法成交。');
    for (const r of RESOURCES) { from.hand[r] += want[r]-give[r]; p.hand[r] += give[r]-want[r]; }
    log(g, `${from.name} 与 ${p.name} 完成交易。`); present(g,'trade',actorId,`${from.name} 与 ${p.name} 完成交易。`); g.offer = null; return g;
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
    log(g,`${p.name} 建造了一座村庄。`); present(g,'settlement',actorId,`${p.name} 建造了一座村庄。`,[{kind:'vertex',id:action.vertex}]); updateAwards(g);
  } else if (type === 'buildRoad') {
    requireRule(sites.road.includes(action.edge),'此处不能铺路：需连接自己的路网，且不能穿过对手建筑。');
    const setup = g.phase === 'setup-road', free = g.phase === 'road-building'; if (!setup && !free) pay(g,p,COSTS.road);
    g.board.edges[action.edge].owner = actorId; log(g,`${p.name} 铺设了一条道路。`); present(g,'road',actorId,`${p.name} 铺设了一条道路。`,[{kind:'edge',id:action.edge}]);
    if (setup) {
      g.setupIndex++; g.setupVertex = null;
      const n = g.players.length;
      // Missing metadata identifies an already-started legacy game: preserve
      // its original seat-zero snake and first turn without drawing again.
      const first = g.startingPlayer?.index ?? 0;
      if (g.setupIndex === n*2) { g.turn = first; g.primaryTurn = first; g.turnNo = 1; g.phase = 'roll'; }
      else { g.turn = (first + (g.setupIndex < n ? g.setupIndex : n*2-1-g.setupIndex)) % n; g.phase = 'setup-settlement'; }
    } else if (free) {
      g.freeRoads--; if (!g.freeRoads || !roadSites(g,actorId).length) { g.phase = g.resumePhase; g.resumePhase = null; g.freeRoads = 0; }
    }
    updateAwards(g);
  } else if (type === 'buildCity') {
    requireRule(sites.city.includes(action.vertex),'只能升级自己的村庄，且最多建造 4 座城市。');
    pay(g,p,COSTS.city); g.board.vertices[action.vertex].level = 2; log(g,`${p.name} 将村庄升级为城市。`); present(g,'city',actorId,`${p.name} 将村庄升级为城市。`,[{kind:'vertex',id:action.vertex}]); updateAwards(g);
  } else if (type === 'roll') {
    requireRule(g.phase === 'roll','当前不能掷骰。');
    g.dice = [1+randomIndex(6,random),1+randomIndex(6,random)]; const sum = g.dice[0]+g.dice[1]; log(g,`${p.name} 掷出了 ${g.dice[0]} + ${g.dice[1]} = ${sum}。`);
    if (sum === 7) {
      g.discards = Object.fromEntries(g.players.filter(v => total(v.hand)>7).map(v => [v.id,Math.floor(total(v.hand)/2)]));
      g.resumePhase = 'action'; g.phase = Object.keys(g.discards).length ? 'discard' : 'robber';
      present(g,'roll',actorId,`${p.name} 掷出 7，等待弃牌与移动强盗。`);
    } else {
      const targets=produce(g,sum); g.phase = 'action';
      const owners=new Set(targets.flatMap(t=>g.board.tiles[t.id].vertices.map(id=>g.board.vertices[id].owner)).filter(Boolean));
      const names=g.players.filter(player=>owners.has(player.id)).map(player=>player.name).join('、');
      present(g,targets.length?'production':'roll',actorId,targets.length?`${p.name} 掷出 ${sum} · ${names} 收获，${targets.length} 处地块产出。`:`${p.name} 掷出 ${sum}，本次没有地块产出。`,targets);
      const blocked=g.board.tiles[g.robber];
      if(blocked?.number===sum&&blocked.vertices.some(id=>g.board.vertices[id].owner))present(g,'blocked',actorId,'强盗阻断 · 此处没有产出。',[{kind:'tile',id:blocked.id}]);
    }
  } else if (type === 'moveRobber') {
    requireRule(sites.robber.includes(action.tile),g.options?.friendlyRobber ? '友善强盗不能影响公开分不超过 2 分的玩家；无合法地块时须退回沙漠。' : '请选择强盗当前所在格以外的地块。');
    g.robber = action.tile; log(g,`${p.name} 将强盗移到${LABELS[g.board.tiles[g.robber].resource]}地块。`);
    present(g,'robber',actorId,`${p.name} 移动了强盗。`,[{kind:'tile',id:action.tile}]);
    if (victims(g).length) g.phase = 'steal'; else finishRobber(g);
  } else if (type === 'steal') {
    requireRule(sites.victims.includes(action.victim),'只能从相邻且有资源的对手处抽取一张牌。');
    const victim = g.players.find(v => v.id === action.victim), cards = RESOURCES.flatMap(r => Array(victim.hand[r]).fill(r));
    const r = cards[randomIndex(cards.length,random)]; victim.hand[r]--; p.hand[r]++; log(g,`${p.name} 从 ${victim.name} 手中抽取了一张资源牌。`); present(g,'steal',actorId,`${p.name} 从 ${victim.name} 手中抽取了一张资源牌。`,[{kind:'tile',id:g.robber}]); finishRobber(g);
  } else if (type === 'bankTrade') {
    requireRule(g.phase === 'action' && RESOURCES.includes(action.give) && RESOURCES.includes(action.want) && action.give !== action.want,'请选择两种不同的资源。');
    const ratio = tradeRatio(g,actorId,action.give); requireRule(p.hand[action.give] >= ratio && g.bank[action.want] > 0,'手牌或银行库存不足。');
    pay(g,p,{[action.give]:ratio}); take(g,p,action.want); log(g,`${p.name} 用 ${ratio} 张${LABELS[action.give]}换取了 1 张${LABELS[action.want]}。`);
    present(g,'trade',actorId,`${p.name} 完成银行或港口交易。`);
  } else if (type === 'offerTrade') {
    requireRule(g.phase === 'action','掷骰并处理强盗后才能交易。');
    requireRule(g.pairStep!=='secondary','配对玩家二不能与其他玩家交易。');
    const give = bundle(action.give,ruleProfile(g).resourceCount), want = bundle(action.want,ruleProfile(g).resourceCount);
    requireRule(total(give)>0 && total(want)>0 && afford(p.hand,give) && RESOURCES.every(r => !give[r] || !want[r]),'请提供自己持有的资源，并选择不同的所需资源。');
    g.offer = {id: crypto.randomUUID(), from:actorId, give, want}; log(g,`${p.name} 发起了一笔资源交易。`);
  } else if (type === 'cancelTrade') {
    requireRule(g.phase === 'action','当前不能取消交易。'); g.offer = null;
  } else if (type === 'buyDevelopment') {
    requireRule(g.phase === 'action' && g.deck.length>0,'当前不能购买发展卡。'); pay(g,p,COSTS.development);
    p.dev.push({id:crypto.randomUUID(),type:g.deck.pop(),bought:g.turnNo}); log(g,`${p.name} 购买了一张发展卡。`);
    present(g,'development',actorId,`${p.name} 购买了一张发展卡。`);
  } else if (type === 'playDevelopment') {
    requireRule(['roll','action'].includes(g.phase) && !g.playedDev,'每回合只能打出一张发展卡。');
    const card = p.dev.find(c => c.id === action.cardId);
    requireRule(card && card.type !== 'victory' && card.bought < g.turnNo,'只能使用之前回合购入的发展卡；胜利点自动计分。');
    if (card.type === 'plenty') {
      const cards = bundle(action.cards,ruleProfile(g).resourceCount); requireRule(total(cards)===2 && afford(g.bank,cards),'请选择银行中有库存的两张资源牌。');
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
    present(g,'development',actorId,`${p.name} 打出了「${DEV_NAMES[card.type]}」。`);
  } else if (type === 'endTurn') {
    requireRule(g.phase === 'action','请先完成掷骰、弃牌或强盗操作。');
    // Victory belongs to the active player; check before handing the turn over.
    victory(g); if (g.winner) return g;
    if(ruleProfile(g).turnRule==='paired' && g.pairStep!=='secondary') {
      g.primaryTurn=g.turn;g.turn=(g.primaryTurn+3)%g.players.length;g.pairStep='secondary';g.phase='action';
    } else {
      g.turn=((g.pairStep==='secondary' ? g.primaryTurn : g.turn)+1)%g.players.length;g.primaryTurn=g.turn;g.pairStep='primary';g.phase='roll';g.dice=null;
    }
    g.turnNo++;g.playedDev=false;g.offer=null;
  } else fail('未知操作。');
  victory(g); return g;
}
export function viewFor(g, id) {
  const {deck,players,presentation} = structuredClone(g), rest={};
  // Allowlist rather than spreading authority state (including future secrets).
  for (const key of ['version','options','targetPoints','harbormaster','phase','board','turn','primaryTurn','pairStep','turnNo','dice','bank','robber','discards','setupIndex','setupVertex','playedDev','freeRoads','resumePhase','longest','army','offer','winner','log','hostId']) {
    if (g[key]!==undefined) rest[key]=structuredClone(g[key]);
  }
  // An explicit projection keeps future internal metadata out of public views.
  const publicPresentation = presentation ? {epoch:presentation.epoch,sequence:presentation.sequence,events:presentation.events.map(({id,kind,actorId,text,targets})=>({id,kind,actorId,text,targets:targets.map(({kind,id})=>({kind,id}))}))} : undefined;
  // Publish only the already-rolled result, never a stream or future metadata.
  if (g.startingPlayer) {
    const {index,dice,rounds} = g.startingPlayer;
    rest.startingPlayer = {index,dice:[dice[0],dice[1]],rounds};
  }
  const profile=ruleProfile(g);
  return { ...rest, ...(publicPresentation?{presentation:publicPresentation}:{}), options:g.phase==='lobby'?optionsForPlayers(g.options,g.players.length):normalizeOptions(g.options), profile,minPlayers:g.phase==='lobby'?3:profile.minPlayers,maxPlayers:g.phase==='lobby'?6:profile.maxPlayers,primaryTurn:g.primaryTurn??g.turn,pairStep:g.pairStep||'primary',targetPoints:targetPoints(g), harbormaster:g.harbormaster || null, deckCount:deck.length, me:id, legal:legal(g,id), players:players.map(p => {
    const {hand,dev} = p, publicPlayer={};
    for(const key of ['id','name','nicknameId','nicknameBadge','color','bot','ready','knights','roadLength','harborPoints'])if(p[key]!==undefined)publicPlayer[key]=p[key];
    return { ...publicPlayer, cards:total(hand), developmentCount:dev.length, points:points(g,p.id,p.id===id || g.phase==='finished'), ...(p.id===id ? {hand,dev} : {}) };
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
