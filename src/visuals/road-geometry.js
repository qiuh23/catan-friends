import * as THREE from 'three';

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
