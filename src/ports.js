// Both renderers derive offshore geometry from the authoritative coast edge.
export function portGeometry(board,port){
  const edge=board.edges[port.edge],a=board.vertices[port.vertices[0]],b=board.vertices[port.vertices[1]],tile=board.tiles[edge.tiles[0]];
  const midpoint={x:(a.x+b.x)/2,z:(a.z+b.z)/2},dx=midpoint.x-tile.x,dz=midpoint.z-tile.z,length=Math.hypot(dx,dz);
  const normal={x:dx/length,z:dz/length};
  return {a,b,midpoint,normal,label:{x:midpoint.x+normal.x*.72,z:midpoint.z+normal.z*.72},arms:[a,b].map(v=>({from:{x:v.x+normal.x*.13,z:v.z+normal.z*.13},to:{x:v.x+normal.x*.55,z:v.z+normal.z*.55},owner:v.level>0?v.owner:null,vertex:v.id}))};
}
export function portOwners(board,port){return [...new Set(port.vertices.map(id=>board.vertices[id]).filter(v=>v.owner&&v.level>0).map(v=>v.owner))];}
