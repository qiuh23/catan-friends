import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createAssetLibrary, createInstancedParts} from './vendor/asset-library.mjs';
import {deriveTerrainAppearanceSeed, groupTerrainVariants, hashAppearance} from './vendor/terrain-variants.mjs';
import {ROBBER_SUPPORT} from './robber-support-data.js';
import {ROBBER_URL, robberSupport} from './robber.js';
import {portGeometry} from '../ports.js';

export const TERRAIN_URL='/assets/v9/catan/variants/models/';
export const ARCHITECTURE_URL='/assets/v9/catan_architecture/models/';
const architecture=['village_timber','village_dormer','city_citadel','city_clockhall','pier_detailed'];
export function buildingAsset(vertex) {
  const variant=hashAppearance(vertex.id)%2;
  return vertex.level===2?['city_citadel','city_clockhall'][variant]:['village_timber','village_dormer'][variant];
}
export function instanceMatrix({x=0,y=0,z=0,rotationY=0,scaleX=1}) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),rotationY),new THREE.Vector3(scaleX,1,1));
}

// Each Board owns a URL cache. A disposed board never frees another board's
// geometry, and pending loads are released after they settle.
export class BoardModels {
  constructor({Loader=GLTFLoader}={}) {
    this.library=createAssetLibrary({GLTFLoader:Loader});
    this.nightUniform={value:0};this.windowMaterials=new Map();this.robberMaterials=new Set();this.robberPlacements=new Map();
    this.ready=new Map();this.requests=new Map();this.layers=new Map();this.disposed=false;
  }
  load(url) {
    if(this.disposed)return Promise.reject(new Error('Board models disposed'));
    if(!this.requests.has(url))this.requests.set(url,this.library.load(url).then(gltf=>{
      if(!this.disposed){
        if(url.startsWith(ARCHITECTURE_URL)&&!url.endsWith('pier_detailed.glb'))gltf.scene.traverse(object=>{
          const original=object.material;
          if(!object.isMesh||Array.isArray(original)||!original.vertexColors||original.name==='OwnerTint')return;
          if(!this.windowMaterials.has(original)){
            const material=original.clone();
            material.onBeforeCompile=shader=>{
              shader.uniforms.uWindowNight=this.nightUniform;
              shader.fragmentShader='uniform float uWindowNight;\n'+shader.fragmentShader;
              shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
                #ifdef USE_COLOR
                  float windowMask=1.-step(.004,max(max(abs(vColor.r-.019),abs(vColor.g-.058)),abs(vColor.b-.068)));
                  totalEmissiveRadiance+=vec3(1.,.36,.065)*7.*uWindowNight*windowMask;
                #endif`);
            };
            material.customProgramCacheKey=()=> 'catan-warm-windows-v1';
            this.windowMaterials.set(original,material);
          }
          object.material=this.windowMaterials.get(original);
        });
        if(url===ROBBER_URL)gltf.scene.traverse(object=>{
          if(!object.isMesh)return;
          const material=object.material.clone();
          material.emissive.set(0x253d31);material.emissiveIntensity=.25;
          material.onBeforeCompile=shader=>{
            shader.uniforms.uRobberNight=this.nightUniform;
            shader.fragmentShader='uniform float uRobberNight;\n'+shader.fragmentShader;
            shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
              float robberRim=pow(1.-abs(dot(normalize(normal),normalize(vViewPosition))),3.);
              totalEmissiveRadiance+=vec3(1.,.69,.30)*robberRim*(.18+.12*uRobberNight);`);
          };
          material.customProgramCacheKey=()=> 'catan-robber-rim-v1';
          object.material=material;this.robberMaterials.add(material);
        });
        this.ready.set(url,gltf.scene);
      }
      return gltf;
    }));
    return this.requests.get(url);
  }
  setNight(value){this.nightUniform.value=value;}
  choices(board) {return groupTerrainVariants(board.tiles,{seed:deriveTerrainAppearanceSeed(board),baseURL:TERRAIN_URL});}
  async prepare(board) {
    const urls=[...this.choices(board).map(g=>g.url),...architecture.map(name=>`${ARCHITECTURE_URL}${name}.glb`),ROBBER_URL];
    const results=await Promise.allSettled(urls.map(url=>this.load(url)));
    return {requested:urls.length,loaded:results.filter(r=>r.status==='fulfilled').length,failed:urls.filter((_,i)=>results[i].status==='rejected')};
  }
  releaseLayer(layer) {
    for(const handle of this.layers.get(layer)||[])handle.dispose();
    this.layers.delete(layer);
  }
  add(layer,url,instances,{tileIds,ownerColors}={}) {
    const source=this.ready.get(url);if(!source||!instances.length)return false;
    const handle=createInstancedParts(THREE,source,instances.map(instanceMatrix),{tileIds,ownerColors});
    for(const mesh of handle.meshes){mesh.userData.blender=true;layer.add(mesh);}
    if(!this.layers.has(layer))this.layers.set(layer,[]);
    this.layers.get(layer).push(handle);return true;
  }
  terrain(board,layer) {
    const loaded=new Set();
    for(const group of this.choices(board))if(this.add(layer,group.url,group.instances,{tileIds:group.instances.map(i=>i.tileId)}))for(const item of group.instances)loaded.add(item.tileId);
    return loaded;
  }
  ports(board,layer) {
    const instances=board.ports.flatMap(port=>portGeometry(board,port).arms.map(({from:a,to:b})=>({x:(a.x+b.x)/2,y:-.006,z:(a.z+b.z)/2,rotationY:-Math.atan2(b.z-a.z,b.x-a.x),scaleX:Math.hypot(b.x-a.x,b.z-a.z)/.42})));
    return this.add(layer,`${ARCHITECTURE_URL}pier_detailed.glb`,instances);
  }
  buildings(vertices,color,layer) {
    const groups=new Map(),loaded=new Set();
    for(const v of vertices){const name=buildingAsset(v);if(!groups.has(name))groups.set(name,[]);groups.get(name).push(v);}
    for(const [name,items]of groups)if(this.add(layer,`${ARCHITECTURE_URL}${name}.glb`,items.map(v=>({x:v.x,y:.27,z:v.z})),{ownerColors:items.map(v=>color(v.owner))}))for(const v of items)loaded.add(v.id);
    return loaded;
  }
  robber(board,tile,layer) {
    const group=this.choices(board).find(group=>group.instances.some(instance=>instance.tileId===tile.id));
    const rotation=group?.instances.find(instance=>instance.tileId===tile.id)?.rotationY||0;
    const source=this.ready.get(group?.url),key=JSON.stringify([group?.url,rotation,Boolean(source)]);
    if(!this.robberPlacements.has(key)){
      const asset=group?.url.split('/').at(-1).replace('.glb','');
      const baked=source&&ROBBER_SUPPORT[asset]?.poses[Math.round(rotation/(Math.PI/3))%6];
      this.robberPlacements.set(key,baked||robberSupport(null));
    }
    const pose=this.robberPlacements.get(key);
    const loaded=this.add(layer,ROBBER_URL,[{x:tile.x+pose.x,y:pose.y,z:tile.z+pose.z,rotationY:pose.rotationY}]);
    return {...pose,loaded};
  }
  async dispose() {
    if(this.disposed)return;this.disposed=true;
    for(const layer of [...this.layers.keys()])this.releaseLayer(layer);
    this.ready.clear();await this.library.dispose();this.requests.clear();
    for(const material of this.robberMaterials)material.dispose();this.robberMaterials.clear();this.robberPlacements.clear();
    for(const material of this.windowMaterials.values())material.dispose();this.windowMaterials.clear();
  }
}
