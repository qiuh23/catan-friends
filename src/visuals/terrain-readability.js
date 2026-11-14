import {portGeometry} from '../ports.js';
import {DECORATION_LAYOUT} from './terrain-decoration-layout.js';
// Lift each resource's recognizable silhouette without spreading into the number
// clearing, road lanes or building sites. Source GLB bytes and the hex footprint
// stay unchanged. Relief and decoration share the same vertical mapping; baked
// cluster widths are constrained separately to retain the protected lanes.
export const TERRAIN_SURFACE=.2675;
export const RESOURCE_HEIGHT=Object.freeze({forest:1.24,wheat:1.65,sheep:1.55,ore:1.30,clay:1.48,desert:1.25});
export function readableHeight(y,resource){return y<=TERRAIN_SURFACE?y:TERRAIN_SURFACE+(y-TERRAIN_SURFACE)*(RESOURCE_HEIGHT[resource]??1);}
export function enhanceTerrainReadability(scene,resource){
  if(!RESOURCE_HEIGHT[resource]||scene.userData.terrainReadability)return;
  scene.traverse(mesh=>{
    if(!mesh.isMesh||!/_ground$|_decoration$/.test(mesh.name))return;
    const geometry=mesh.geometry,position=geometry.attributes.position;
    for(let i=0;i<position.count;i++)position.setY(i,readableHeight(position.getY(i),resource));
    // Widen recognizable clusters about their own centres, rather than scaling
    // the whole hex. Offline bounds cap each cluster before the token/edge lanes.
    const layout=DECORATION_LAYOUT[mesh.name];
    if(layout?.vertices===position.count)for(const {center:[x,z],scale,ranges}of layout.groups)for(const [start,end]of ranges)for(let i=start;i<end;i++){
      position.setX(i,x+(position.getX(i)-x)*scale);position.setZ(i,z+(position.getZ(i)-z)*scale);
    }
    position.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
  });
  scene.userData.terrainReadability=resource;
}

// Bound the lifted silhouettes at hex corners as well as centres. A peak near a
// far edge must remain in frame in a short landscape viewport.
export function terrainFitPoints(board){
  const points=board.vertices.flatMap(v=>[0,1.2].map(y=>({x:v.x,y,z:v.z})));
  // Include the low pier feet too, not only their higher floating labels.
  for(const port of board.ports){const {normal,arms}=portGeometry(board,port);
    for(const arm of arms)for(const end of [arm.from,arm.to])for(const side of [-.09,.09])for(const y of [-.01,.25])points.push({x:end.x-normal.z*side,y,z:end.z+normal.x*side});
  }
  return points;
}
