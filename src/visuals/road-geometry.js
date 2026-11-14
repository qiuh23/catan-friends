import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
export const ROAD_JOIN_REACH=.22;

// A low bevel keeps the paved road toy-like without a texture or per-stone mesh.
export function createPavingGeometry() {
  const shape=new THREE.Shape();
  shape.moveTo(-.46,-.46);shape.lineTo(.46,-.46);shape.lineTo(.46,.46);shape.lineTo(-.46,.46);shape.closePath();
  const geometry=new THREE.ExtrudeGeometry(shape,{depth:.84,steps:1,bevelEnabled:true,bevelSegments:1,bevelSize:.04,bevelThickness:.08,curveSegments:1});
  geometry.translate(0,0,-.42);geometry.rotateX(-Math.PI/2);
  geometry.computeBoundingBox();return geometry;
}

export function roadFrame(a,b) {
  // Canonical ordering keeps stone staggering and lamp placement stable when
  // callers supply the same physical edge in the opposite direction.
  if(a.x>b.x||a.x===b.x&&a.z>b.z)[a,b]=[b,a];
  const dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);
  return {x:(a.x+b.x)/2,z:(a.z+b.z)/2,dx:dx/length,dz:dz/length,length,rotation:-Math.atan2(dz,dx)};
}

export function roadLampPose(a,b) {
  const frame=roadFrame(a,b),along=.10,side=.064;
  return {x:frame.x+frame.dx*along-frame.dz*side,y:.321,z:frame.z+frame.dz*along+frame.dx*side,rotation:frame.rotation,frame};
}

// Cosmetic connectivity only. Authoritative rules, legal sites and longest-road
// scoring remain in shared/. An opponent's building cuts the visual chain too.
export function roadConnections(board){
  const incident=new Map(),joined=new Map(),junctions=new Map();
  for(const edge of board.edges){if(!edge.owner)continue;for(const id of [edge.a,edge.b]){
    if(!incident.has(id))incident.set(id,new Map());
    const owners=incident.get(id);if(!owners.has(edge.owner))owners.set(edge.owner,[]);owners.get(edge.owner).push(edge);
  }}
  for(const [id,owners]of incident){
    const vertex=board.vertices[id];
    for(const [owner,edges]of owners)if(edges.length>=2&&(!vertex.owner||vertex.owner===owner)){
      joined.set(id,owner);
      const angles=edges.map(edge=>{const end=board.vertices[edge.a===id?edge.b:edge.a];return (Math.atan2(end.z-vertex.z,end.x-vertex.x)+Math.PI*2)%(Math.PI*2);}).sort((a,b)=>a-b);
      // Every valid hex vertex has three possible arms, separated by 120°.
      const start=angles.length===2&&angles[1]-angles[0]>Math.PI?angles[1]:angles[0];
      junctions.set(id,{arms:angles.length,rotation:-start});
    }
  }
  return {joined,junctions,ends(edge){return [edge.a,edge.b].map(id=>joined.get(id)===edge.owner?ROAD_JOIN_REACH:joined.has(id) ? .16 : null);}};
}

function junctionPoints(arms,width){
  return Array.from({length:arms},(_,i)=>{
    const angle=i*2*Math.PI/3,next=i===arms-1?Math.PI*2:(i+1)*2*Math.PI/3,gap=next-angle;
    const dx=Math.cos(angle),dz=Math.sin(angle),nx=-dz,nz=dx,along=width/Math.tan(gap/2);
    return {right:[dx*(ROAD_JOIN_REACH+.003)-nx*width,dz*(ROAD_JOIN_REACH+.003)-nz*width],left:[dx*(ROAD_JOIN_REACH+.003)+nx*width,dz*(ROAD_JOIN_REACH+.003)+nz*width],corner:[dx*along+nx*width,dz*along+nz*width]};
  });
}
function extrudedJunction(points){
  const shape=new THREE.Shape();points.forEach(([x,z],i)=>i?shape.lineTo(x,-z):shape.moveTo(x,-z));shape.closePath();
  const geometry=new THREE.ExtrudeGeometry(shape,{depth:1,steps:1,bevelEnabled:false,curveSegments:1});geometry.translate(0,0,-.5);geometry.rotateX(-Math.PI/2);return geometry;
}
export function createRoadJunctionGeometries(arms){
  if(![2,3].includes(arms))throw new RangeError('A road junction needs two or three arms');
  const polygon=width=>extrudedJunction(junctionPoints(arms,width).flatMap(p=>[p.right,p.left,p.corner]));
  // These strips follow the mitered road outline; they never cap an open arm.
  const ribbons=(outside,inside)=>{
    const outer=junctionPoints(arms,outside),inner=junctionPoints(arms,inside),strips=outer.map((o,i)=>{const j=(i+1)%arms,n=inner[i];return extrudedJunction([o.left,o.corner,outer[j].right,inner[j].right,n.corner,n.left]);});
    const geometry=mergeGeometries(strips);for(const strip of strips)strip.dispose();return geometry;
  };
  const seams=[polygon(.002)];
  for(let i=0;i<arms;i++){
    const angle=i*2*Math.PI/3,dx=Math.cos(angle),dz=Math.sin(angle),nx=-dz,nz=dx;
    seams.push(extrudedJunction([[.127,-.0615],[.133,-.0615],[.133,.0615],[.127,.0615]].map(([along,side])=>[dx*along+nx*side,dz*along+nz*side])));
  }
  const grout=mergeGeometries(seams);for(const seam of seams)seam.dispose();
  return {bed:polygon(.098),base:polygon(.090),curb:ribbons(.0945,.0615),rim:ribbons(.084,.072),paving:polygon(.0615),grout};
}

// Put the visual legal-site inlay above a new paved junction. Pick radii and
// visibility logic stay unchanged, so the junction cannot bury its build hint.
export function roadSiteHeight(mode,id,joined){return mode!=='road'&&joined?.has(id) ? .378 : .298;}
