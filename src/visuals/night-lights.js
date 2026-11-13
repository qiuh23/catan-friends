import * as THREE from 'three';
import {portGeometry} from '../ports.js';
// Two actual, caged harbour lanterns. No extra shadow maps or per-window lights.
export function createNightLights(scene) {
  const group=new THREE.Group();group.name='HarbourLanterns';scene.add(group);
  const box=new THREE.BoxGeometry(1,1,1),bronze=new THREE.MeshStandardMaterial({color:0x483520,roughness:.8});
  const glass=new THREE.MeshStandardMaterial({color:0xffbd69,emissive:0xff9b37,emissiveIntensity:0,roughness:.55});
  const lights=[];
  function cube(position,scale,material){const mesh=new THREE.Mesh(box,material);mesh.position.set(...position);mesh.scale.set(...scale);mesh.raycast=()=>{};group.add(mesh);}
  return {
    setBoard(board){
      group.clear();lights.length=0;
      if(!board.ports.length)return;
      for(const index of [0,Math.floor(board.ports.length/2)]){
        const {from:a,to:b}=portGeometry(board,board.ports[index]).arms[0],x=a.x+(b.x-a.x)*.7,z=a.z+(b.z-a.z)*.7,y=.18;
        cube([x,y+.06,z],[.018,.12,.018],bronze);cube([x,y+.15,z],[.052,.07,.052],glass);
        for(const dy of [-.042,.042])cube([x,y+.15+dy,z],[.074,.015,.074],bronze);
        for(const dx of [-.029,.029])for(const dz of [-.029,.029])cube([x+dx,y+.15,z+dz],[.009,.08,.009],bronze);
        const light=new THREE.PointLight(0xffab55,0,.85,2);light.position.set(x,y+.15,z);light.castShadow=false;group.add(light);lights.push(light);
      }
    },
    setNight(value,{lowPower=false}={}){glass.emissiveIntensity=value*4;for(const light of lights)light.intensity=lowPower?0:value*.12;},
    dispose(){group.removeFromParent();group.clear();box.dispose();bronze.dispose();glass.dispose();},
  };
}

