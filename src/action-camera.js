// Public map coordinates only. This module never inspects hands, cards or trades.
export function feedbackPoints(board,event) {
  const points=[];
  for(const target of event?.targets||[]) {
    if(!Number.isInteger(target.id)||target.id<0)continue;
    if(target.kind==='edge') {
      const edge=board?.edges[target.id];if(!edge)continue;
      for(const id of [edge.a,edge.b])if(board.vertices[id])points.push({...board.vertices[id],y:.5});
    } else if(target.kind==='vertex') {
      const vertex=board?.vertices[target.id];if(vertex)points.push({...vertex,y:.6});
    } else if(target.kind==='tile') {
      const tile=board?.tiles[target.id];if(!tile)continue;
      points.push({...tile,y:.6});
      for(const id of tile.vertices||[])if(board.vertices[id])points.push({...board.vertices[id],y:.6});
    }
  }
  return points.filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.z));
}

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;

// Frame the actual target footprint in the unobscured rectangle. The eye vector
// retains the player's bearing; distance and pitch have conservative limits.
export function planActionCamera(board,event,{position,target={x:0,y:0,z:0},fov=34,frame,scale=1,minDistance=6*scale,maxDistance=45*scale}={}) {
  const points=feedbackPoints(board,event);if(!points.length||!position||!frame?.width||!frame?.height)return null;
  const center={x:(Math.min(...points.map(p=>p.x))+Math.max(...points.map(p=>p.x)))/2,y:.5,
    z:(Math.min(...points.map(p=>p.z))+Math.max(...points.map(p=>p.z)))/2};
  const offset={x:position.x-target.x,y:position.y-target.y,z:position.z-target.z};
  const currentDistance=Math.hypot(offset.x,offset.y,offset.z)||16*scale;
  const yaw=Math.atan2(offset.x,offset.z),polar=clamp(Math.acos(clamp(offset.y/currentDistance,-1,1)),.22,1.05);
  const eye={x:Math.sin(polar)*Math.sin(yaw),y:Math.cos(polar),z:Math.sin(polar)*Math.cos(yaw)};
  const right={x:Math.cos(yaw),y:0,z:-Math.sin(yaw)};
  const up={x:-Math.cos(polar)*Math.sin(yaw),y:Math.sin(polar),z:-Math.cos(polar)*Math.cos(yaw)};
  const tanV=Math.tan(fov*Math.PI/360)*.83,tanH=tanV*frame.width/frame.height;
  let distance=minDistance;
  // A visible neighborhood around the action avoids an isolated extreme closeup.
  for(const point of points)for(const dx of [-.65,.65])for(const dy of [-.3,.7])for(const dz of [-.65,.65]) {
    const relative={x:point.x+dx-center.x,y:point.y+dy-center.y,z:point.z+dz-center.z},depth=dot(relative,eye);
    distance=Math.max(distance,depth+Math.abs(dot(relative,right))/tanH,depth+Math.abs(dot(relative,up))/tanV);
  }
  // Each automatic shot can zoom in by at most 14%; panning does most of the work.
  distance=clamp(Math.max(distance,currentDistance*.86),minDistance,maxDistance);
  return {target:center,position:{x:center.x+eye.x*distance,y:center.y+eye.y*distance,z:center.z+eye.z*distance},distance,yaw,polar};
}
