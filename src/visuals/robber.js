import * as THREE from 'three';
export const ROBBER_URL='/assets/v9/catan_robber/hooded.glb';
const turn=(x,z,angle)=>({x:x*Math.cos(angle)+z*Math.sin(angle),z:z*Math.cos(angle)-x*Math.sin(angle)});

// Sample only the selected tile's actual, rotated GLB. This is computed once
// per terrain variant/rotation, never per frame or over the whole island.
export function robberSupport(source,terrainRotation=0) {
  if(!source)return {x:0,y:.33,z:.4,rotationY:0};
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
  for(let i=0;i<6;i++){
    const rotationY=i*Math.PI/3,origin=turn(0,.4,rotationY);
    const sample=(x,z)=>{const p=turn(x,z,rotationY);return {x:origin.x+p.x,z:origin.z+p.z};};
    const feet=[[-.055,-.025],[.055,-.025],[-.055,.07],[.055,.07],[0,.02]].map(([x,z])=>height(sample(x,z),ground.length?ground:meshes));
    const support=Math.max(...feet),spread=support-Math.min(...feet);
    const cover=[[-.18,.02],[-.08,-.04],[.07,.02],[-.08,.10],[0,.02]].map(([x,z])=>height(sample(x,z),meshes));
    const obstruction=Math.max(0,Math.max(...cover)-support-.035);
    const score=obstruction*10+spread*2+support+i*.001;
    if(!best||score<best.score)best={...origin,y:support+.008,rotationY,score,spread,obstruction};
  }
  return best;
}

export function createRobberHighlight(assets,pose,tile) {
  if(!assets.geometries['robber-halo'])assets.geometries['robber-halo']=new THREE.RingGeometry(.78,1,32);
  if(!assets.materials.has('robber-halo'))assets.materials.set('robber-halo',new THREE.MeshBasicMaterial({color:0xf4d990,transparent:true,opacity:.7,depthTest:true,depthWrite:false,toneMapped:false,side:THREE.DoubleSide}));
  const mesh=new THREE.Mesh(assets.geometries['robber-halo'],assets.materials.get('robber-halo'));
  const offset=turn(-.035,.02,pose.rotationY);
  mesh.position.set(tile.x+pose.x+offset.x,pose.y+.004,tile.z+pose.z+offset.z);
  mesh.rotation.set(-Math.PI/2,0,pose.rotationY);mesh.scale.set(.145,.045,1);
  mesh.userData.robberHighlight=true;return mesh;
}
