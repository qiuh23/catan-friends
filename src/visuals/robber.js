import * as THREE from 'three';
export const ROBBER_SCALE=1.45;
export const ROBBER_HIGHLIGHT=Object.freeze({dayRim:1.6,nightRim:2.2,rimPower:4,outlineColor:0xffd56a});
export const ROBBER_RADIUS=.47;
export const ROBBER_URL='/assets/v9/catan_robber/hooded.glb';
const turn=(x,z,angle)=>({x:x*Math.cos(angle)+z*Math.sin(angle),z:z*Math.cos(angle)-x*Math.sin(angle)});

// Sample only the selected tile's actual, rotated GLB. This is computed once
// per terrain variant/rotation, never per frame or over the whole island.
export function robberSupport(source,terrainRotation=0) {
  if(!source)return {x:0,y:.33,z:ROBBER_RADIUS,rotationY:0};
  source.updateMatrixWorld(true);
  const meshes=[];source.traverse(mesh=>{if(mesh.isMesh)meshes.push(mesh);});
  const ground=meshes.filter(mesh=>mesh.name.endsWith('_ground'));
  const ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0);
  const height=(point,objects)=>{
    const local=turn(point.x,point.z,-terrainRotation);
    ray.set(new THREE.Vector3(local.x,4,local.z),down);
    return ray.intersectObjects(objects,false)[0]?.point.y??.33;
  };
  let best;
  for(const radius of [ROBBER_RADIUS,.43,.51])for(let i=0;i<12;i++){
    const rotationY=i*Math.PI/6,origin=turn(0,radius,rotationY);
    const sample=(x,z)=>{const p=turn(x*ROBBER_SCALE,z*ROBBER_SCALE,rotationY);return {x:origin.x+p.x,z:origin.z+p.z};};
    const feet=[[-.055,-.025],[.055,-.025],[-.055,.07],[.055,.07],[0,.02]].map(([x,z])=>height(sample(x,z),ground.length?ground:meshes));
    const support=Math.max(...feet),spread=support-Math.min(...feet);
    const cover=[[-.195,.02],[-.08,-.051],[.083,.02],[-.08,.109],[0,.02]].map(([x,z])=>height(sample(x,z),meshes));
    const obstruction=Math.max(0,Math.max(...cover)-support-.035);
    const score=obstruction*20+spread*10+support+i*.001+Math.abs(radius-ROBBER_RADIUS)*.1;
    if(!best||score<best.score)best={...origin,y:support+.008,rotationY,score,spread,obstruction};
  }
  return best;
}

export function createRobberHighlight(assets,pose,tile) {
  if(!assets.geometries['robber-halo'])assets.geometries['robber-halo']=new THREE.RingGeometry(.64,1,48);
  if(!assets.materials.has('robber-halo'))assets.materials.set('robber-halo',new THREE.MeshBasicMaterial({color:0xffd56a,transparent:true,opacity:.95,depthTest:true,depthWrite:false,toneMapped:false,side:THREE.DoubleSide}));
  const mesh=new THREE.Mesh(assets.geometries['robber-halo'],assets.materials.get('robber-halo'));
  const offset=turn(-.035*ROBBER_SCALE,.02*ROBBER_SCALE,pose.rotationY);
  mesh.position.set(tile.x+pose.x+offset.x,pose.y+.012,tile.z+pose.z+offset.z);
  mesh.rotation.set(-Math.PI/2,0,pose.rotationY);mesh.scale.set(.17*ROBBER_SCALE,.075*ROBBER_SCALE,1);
  mesh.raycast=()=>{};mesh.userData.robberHighlight=true;return mesh;
}

// A bounded silhouette shell makes the one robber legible at whole-board scale.
// It is depth-tested, has no shadow/light, and never participates in picking.
export function createRobberOutline(body){
  const geometry=body.geometry.clone(),colors=geometry.attributes.color,index=geometry.index,triangles=[];
  // Outline only the cloak/hood, not thin facial features, belts or fingers.
  // Expanding those small details would cover the face instead of framing it.
  const cloth=i=>{const r=colors.getX(i),g=colors.getY(i),b=colors.getZ(i);return g>.06&&g>r*1.4&&g>b*1.2;};
  for(let i=0;i<index.count;i+=3){const a=index.getX(i),b=index.getX(i+1),c=index.getX(i+2);if(cloth(a)&&cloth(b)&&cloth(c))triangles.push(a,b,c);}
  geometry.setIndex(triangles);geometry.computeBoundingBox();const center=geometry.boundingBox.getCenter(new THREE.Vector3());
  geometry.translate(-center.x,-center.y,-center.z);geometry.scale(1.085,1.05,1.085);geometry.translate(center.x,center.y,center.z);
  const material=new THREE.MeshBasicMaterial({color:ROBBER_HIGHLIGHT.outlineColor,side:THREE.BackSide,toneMapped:false,depthWrite:false});
  const mesh=new THREE.InstancedMesh(geometry,material,body.count),matrix=new THREE.Matrix4();
  for(let i=0;i<body.count;i++){body.getMatrixAt(i,matrix);mesh.setMatrixAt(i,matrix);}
  mesh.name='RobberGoldenOutline';mesh.userData.robberOutline=true;mesh.raycast=()=>{};mesh.castShadow=mesh.receiveShadow=false;mesh.renderOrder=1;
  mesh.computeBoundingBox();mesh.computeBoundingSphere();
  return {mesh,dispose(){mesh.removeFromParent();mesh.dispose();geometry.dispose();material.dispose();}};
}
