import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createAssetLibrary, createInstancedParts} from './vendor/asset-library.mjs';
import {deriveTerrainAppearanceSeed, groupTerrainVariants, hashAppearance} from './vendor/terrain-variants.mjs';
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
    this.ready=new Map();this.requests=new Map();this.layers=new Map();this.disposed=false;
  }
  load(url) {
    if(this.disposed)return Promise.reject(new Error('Board models disposed'));
    if(!this.requests.has(url))this.requests.set(url,this.library.load(url).then(gltf=>{
      if(!this.disposed)this.ready.set(url,gltf.scene);
      return gltf;
    }));
    return this.requests.get(url);
  }
  choices(board) {return groupTerrainVariants(board.tiles,{seed:deriveTerrainAppearanceSeed(board),baseURL:TERRAIN_URL});}
  async prepare(board) {
    const urls=[...this.choices(board).map(g=>g.url),...architecture.map(name=>`${ARCHITECTURE_URL}${name}.glb`)];
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
  async dispose() {
    if(this.disposed)return;this.disposed=true;
    for(const layer of [...this.layers.keys()])this.releaseLayer(layer);
    this.ready.clear();await this.library.dispose();this.requests.clear();
  }
}
