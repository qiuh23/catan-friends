export const RESOURCES = ['wood', 'brick', 'sheep', 'wheat', 'ore'];
export const LABELS = { wood: '木材', brick: '砖块', sheep: '羊毛', wheat: '粮食', ore: '矿石', desert: '沙漠' };
export const COLORS = ['#e57c54', '#5997d0', '#e6bd55', '#ae8bca'];
export const emptyHand = (n = 0) => Object.fromEntries(RESOURCES.map(r => [r, n]));
export const total = hand => RESOURCES.reduce((n, r) => n + (hand[r] || 0), 0);
export function shuffle(a, random = Math.random) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}
export function createBoard(random = Math.random) {
  const tiles = [], vertices = [], edges = [], vertexMap = new Map(), edgeMap = new Map();
  const terrain = shuffle(['wood','wood','wood','wood','brick','brick','brick','sheep','sheep','sheep','sheep','wheat','wheat','wheat','wheat','ore','ore','ore','desert'], random);
  for (let r = -2; r <= 2; r++) for (let q = Math.max(-2, -r - 2); q <= Math.min(2, -r + 2); q++) {
    const tile = { id: tiles.length, q, r, x: Math.sqrt(3) * (q + r / 2), z: 1.5 * r, resource: terrain[tiles.length], number: 0, vertices: [] };
    for (let c = 0; c < 6; c++) {
      const a = (c * 60 - 30) * Math.PI / 180, x = tile.x + Math.cos(a), z = tile.z + Math.sin(a);
      const key = `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
      if (!vertexMap.has(key)) { vertexMap.set(key, vertices.length); vertices.push({ id: vertices.length, x, z, tiles: [], edges: [], owner: null, level: 0 }); }
      const id = vertexMap.get(key); vertices[id].tiles.push(tile.id); tile.vertices.push(id);
    }
    for (let c = 0; c < 6; c++) {
      const ends = [tile.vertices[c], tile.vertices[(c + 1) % 6]].sort((a,b) => a-b), key = ends.join(',');
      if (!edgeMap.has(key)) {
        const id = edges.length; edgeMap.set(key, id); edges.push({ id, a: ends[0], b: ends[1], tiles: [], owner: null });
        for (const v of ends) vertices[v].edges.push(id);
      }
      edges[edgeMap.get(key)].tiles.push(tile.id);
    }
    tiles.push(tile);
  }
  // Rejection sampling keeps the highly productive 6/8 hexes non-adjacent.
  const tokens = [2,3,3,4,4,5,5,6,6,8,8,9,9,10,10,11,11,12];
  let valid = false;
  for (let attempt = 0; attempt < 10000 && !valid; attempt++) {
    const numbers = shuffle(tokens, random);
    for (const tile of tiles) tile.number = tile.resource === 'desert' ? 0 : numbers.pop();
    valid = edges.every(e => e.tiles.length < 2 || !e.tiles.every(i => [6,8].includes(tiles[i].number)));
  }
  const coast = edges.filter(e => e.tiles.length === 1).sort((a,b) => {
    const angle = e => Math.atan2(vertices[e.a].z + vertices[e.b].z, vertices[e.a].x + vertices[e.b].x);
    return angle(a)-angle(b);
  });
  const types = shuffle(['any','any','any','any',...RESOURCES], random);
  const ports = [0,3,7,10,13,17,20,23,27].map((i,id) => ({ id, edge: coast[i].id, vertices: [coast[i].a, coast[i].b], resource: types[id] }));
  return { tiles, vertices, edges, ports };
}
export function neighbors(board, vertexId) {
  return board.vertices[vertexId].edges.map(id => { const e = board.edges[id]; return e.a === vertexId ? e.b : e.a; });
}
export function settlementSites(g, playerId, setup = false) {
  if (g.board.vertices.filter(v => v.owner === playerId && v.level === 1).length >= 5) return [];
  return g.board.vertices.filter(v => !v.owner && neighbors(g.board, v.id).every(id => !g.board.vertices[id].owner) && (setup || v.edges.some(id => g.board.edges[id].owner === playerId))).map(v => v.id);
}
export function roadSites(g, playerId, setupVertex = null) {
  if (g.board.edges.filter(e => e.owner === playerId).length >= 15) return [];
  return g.board.edges.filter(e => !e.owner && (setupVertex !== null ? [e.a,e.b].includes(setupVertex) : [e.a,e.b].some(id => {
    const v = g.board.vertices[id];
    return v.owner === playerId || (!v.owner && v.edges.some(eid => g.board.edges[eid].owner === playerId));
  }))).map(e => e.id);
}
export function citySites(g, playerId) {
  return g.board.vertices.filter(v => v.owner === playerId && v.level === 2).length >= 4 ? [] : g.board.vertices.filter(v => v.owner === playerId && v.level === 1).map(v => v.id);
}
export function longestRoad(board, playerId) {
  const own = board.edges.filter(e => e.owner === playerId);
  function walk(at, used) {
    const v = board.vertices[at];
    if (used.size && v.owner && v.owner !== playerId) return used.size;
    let best = used.size;
    for (const id of v.edges) {
      if (board.edges[id].owner !== playerId || used.has(id)) continue;
      const e = board.edges[id]; used.add(id); best = Math.max(best, walk(e.a === at ? e.b : e.a, used)); used.delete(id);
    }
    return best;
  }
  return Math.max(0, ...[...new Set(own.flatMap(e => [e.a,e.b]))].map(v => walk(v, new Set())));
}
