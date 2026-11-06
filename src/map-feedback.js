// Bubble anchors come only from public board geometry. In particular, an edge
// uses its midpoint, not either adjacent vertex, and a tile uses its centre,
// not the centroid of a collection of unrelated public events.
export function feedbackAnchor(board,target) {
  if(!target || !Number.isSafeInteger(target.id) || target.id<0)return null;
  let point;
  if(target.kind==='edge') {
    const edge=board?.edges?.[target.id],a=board?.vertices?.[edge?.a],b=board?.vertices?.[edge?.b];
    if(a&&b)point={x:(a.x+b.x)/2,y:.45,z:(a.z+b.z)/2};
  }else if(target.kind==='vertex') {
    const vertex=board?.vertices?.[target.id];if(vertex)point={x:vertex.x,y:.65,z:vertex.z};
  }else if(target.kind==='tile') {
    const tile=board?.tiles?.[target.id];if(tile)point={x:tile.x,y:.6,z:tile.z};
  }
  return point&&Object.values(point).every(Number.isFinite)?point:null;
}

// Restoring a renderer view must never carry another island's camera into a
// rematch. Ownership changes on the same map intentionally keep the same key.
export function mapViewKey(board) {
  if(!board?.tiles||!board?.vertices)return '';
  return JSON.stringify([board.tiles.map(t=>[t.id,t.x,t.z,t.resource,t.number]),board.vertices.map(v=>[v.x,v.z]),board.ports]);
}
