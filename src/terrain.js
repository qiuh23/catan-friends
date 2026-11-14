import * as THREE from 'three';
import {portGeometry} from './ports.js';
import {createPavingGeometry} from './visuals/road-geometry.js';

export const terrain = {wood:0x648c68,brick:0xc08459,sheep:0xa5be70,wheat:0xddbd61,ore:0x88989b,desert:0xdfc88d};

// Every board owns its pool. Rebuilding a layer releases instances, not shared assets.
export class BoardAssets {
  constructor() {
    this.geometries = {
      hex:new THREE.CylinderGeometry(1,1,1,6),
      cone:new THREE.ConeGeometry(1,1,6),
      roof:new THREE.ConeGeometry(1,1,4),
      rock:new THREE.DodecahedronGeometry(1,0),
      wool:new THREE.IcosahedronGeometry(1,0),
      box:new THREE.BoxGeometry(1,1,1),
      paving:createPavingGeometry(),
      cylinder:new THREE.CylinderGeometry(1,1,1,8),
      ring:new THREE.RingGeometry(.83,1.08,16),
      sea:new THREE.CylinderGeometry(1,1,1,48),
    };
    this.materials = new Map();
    this.textures = new Map();
  }
  material(key='land') {
    if(!this.materials.has(key)) {
      const unlit=['overlay','water','sea'].includes(key);
      this.materials.set(key,unlit
        ? new THREE.MeshBasicMaterial({color:0xffffff,toneMapped:false,depthTest:key!=='overlay'})
        : new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,flatShading:true}));
    }
    return this.materials.get(key);
  }
  dispose() {
    this.disposed=true;
    for(const g of Object.values(this.geometries))g.dispose();
    for(const m of this.materials.values())m.dispose();
    for(const t of this.textures.values())t.dispose();
    this.materials.clear();this.textures.clear();
  }
}

export function clearLayer(group) {
  group.traverse(object=>{if(object.isInstancedMesh)object.dispose();});
  group.clear();
}

// One draw per primitive/material, with per-instance palette and transform variation.
export class Batches {
  constructor(assets) {this.assets=assets;this.entries=new Map();}
  add(shape,color,x,y,z,sx=1,sy=sx,sz=sx,rotation=0,kind='land') {
    const key=`${kind}:${shape}`;
    if(!this.entries.has(key))this.entries.set(key,{shape,kind,items:[]});
    this.entries.get(key).items.push({color,x,y,z,sx,sy,sz,rotation,tile:this.tile,piece:this.piece});
  }
  finish(group) {
    const transform=new THREE.Object3D(),color=new THREE.Color();
    for(const {shape,kind,items} of this.entries.values()) {
      const mesh=new THREE.InstancedMesh(this.assets.geometries[shape],this.assets.material(kind),items.length);
      if(items.some(p=>Number.isInteger(p.tile)))mesh.userData.tileIds=items.map(p=>p.tile);
      if(items.some(p=>p.piece))mesh.userData.pieces=items.map(p=>p.piece);
      items.forEach((p,i)=>{
        transform.position.set(p.x,p.y,p.z);transform.scale.set(p.sx,p.sy,p.sz);transform.rotation.set(0,p.rotation,0);transform.updateMatrix();
        mesh.setMatrixAt(i,transform.matrix);mesh.setColorAt(i,color.set(p.color));
      });
      mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor.needsUpdate=true;
      mesh.castShadow=kind==='land';mesh.receiveShadow=kind==='land';
      if(kind==='overlay')mesh.renderOrder=8;
      mesh.computeBoundingSphere();group.add(mesh);
    }
  }
}

export function tileRandom(tile) {
  let seed=2166136261;
  for(const c of `${tile.id}:${tile.q}:${tile.r}:${tile.resource}`)seed=Math.imul(seed^c.charCodeAt(0),16777619);
  return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
}

function scenery(tile,batch) {
  const random=tileRandom(tile),angle=random()*Math.PI*2;
  const count=tile.resource==='wood'?7:tile.resource==='sheep'?4:5;
  for(let i=0;i<count;i++) {
    const a=angle+i*Math.PI*2/count+(random()-.5)*.22,r=.51+random()*.08;
    const x=tile.x+Math.cos(a)*r,z=tile.z+Math.sin(a)*r,s=.8+random()*.3;
    // Keep the number's central clearing and the .14-wide edge/vertex lanes clear.
    if(tile.resource==='wood') {
      batch.add('hex',0x507953,x,.285,z,.19,.025,.18,a);
      batch.add('cylinder',0x785940,x,.37,z,.035,.21,.035);
      batch.add('cone',i%2?0x285b44:0x3b7650,x,.53,z,.14*s,.38*s,.14*s,a);
      batch.add('cone',i%2?0x3c7953:0x568c5b,x,.66,z,.105*s,.27*s,.105*s,a+.4);
      if(i%3===0)batch.add('rock',0x9cac7a,x+.12,.31,z,.065,.05,.055,a);
    } else if(tile.resource==='ore') {
      const height=(.32+random()*.25)*s;
      batch.add('rock',i%2?0x637782:0x77868a,x,.3+height*.27,z,.18*s,height*.58,.17*s,a);
      batch.add('cone',i%2?0x526771:0x71868b,x,.32+height*.5,z,.18*s,height,.17*s,a);
      // Small mineral seams and broken scree, rather than identical snowy peaks.
      batch.add('box',0xd9c998,x+.09,.35+height*.25,z+.08,.025,height*.6,.035,a);
      batch.add('rock',0xb9c7c0,x-.11,.31,z+.12,.07,.045,.06,a);
    } else if(tile.resource==='brick') {
      const height=.10+random()*.13;
      batch.add('hex',0xa66343,x,.29+height*.3,z,.19*s,height*.6,.18*s,a);
      batch.add('hex',i%2?0xce9163:0xb9754f,x,.3+height*.7,z,.15*s,height*.4,.14*s,a);
      batch.add('rock',0xdca77a,x+.03,.32+height,z,.12,.065,.11,a);
      batch.add('box',0x94523c,x-.11,.31,z+.09,.08,.045,.06,a);
    } else if(tile.resource==='wheat') {
      const rotation=angle+.4,dx=Math.cos(rotation),dz=-Math.sin(rotation);
      batch.add('box',0xa98a3c,x,.29,z,.26,.024,.28,rotation);
      for(let row=0;row<4;row++) {
        const offset=(row-1.5)*.061;
        batch.add('box',row%2?0xf5d67b:0xd3a540,x+dx*offset,.335+random()*.015,z+dz*offset,.038,.065,.255,rotation);
      }
      if(i%2===0)batch.add('cone',0xf0d084,x+.12,.39,z,.045,.19,.045,a);
    } else if(tile.resource==='sheep') {
      batch.add('rock',i%2?0xbed18a:0x8faa5f,x,.28,z,.22,.055,.18,a);
      if(i<3) {
        const dx=Math.cos(a),dz=Math.sin(a);
        batch.add('wool',0xfaf3df,x,.395,z,.13,.095,.085,a);
        batch.add('wool',0x485748,x+dx*.12,.405,z-dz*.12,.053,.06,.047,a);
        for(const offset of [-.065,.065])batch.add('box',0x56614c,x+offset,.32,z,.024,.075,.027,a);
      }
      batch.add('cone',0x65864c,x-.13,.33,z+.08,.03,.10,.035,a);
    } else {
      batch.add('rock',i%2?0xe9d49f:0xcbb278,x,.285,z,.18*s,.045,.13,a);
      if(i%2===0)batch.add('rock',0xab9a72,x,.30,z,.045,.035,.04,a);
    }
  }
}

export function buildTileTerrain(tiles,assets,group,{placeholder=false}={}) {
  const batch=new Batches(assets);
  for(const tile of tiles) {
    batch.tile=tile.id;
    batch.add('hex',0xb29b70,tile.x,.075,tile.z,.99,.18,.99);
    batch.add('hex',0xe7d7a6,tile.x,.18,tile.z,.985,.05,.985);
    batch.add('hex',terrain[tile.resource],tile.x,placeholder?.215:.235,tile.z,.942,placeholder?.05:.075,.942);
    if(!placeholder)scenery(tile,batch);
  }
  batch.finish(group);
}

export function buildTerrain(board,assets,group,{loadedTiles=new Set(),loadedPorts=false,coast=true}={}) {
  buildTileTerrain(board.tiles.filter(tile=>!loadedTiles.has(tile.id)),assets,group);
  const batch=new Batches(assets);
  batch.tile=undefined;
  const portEdges=new Set(board.ports.map(p=>p.edge));
  for(const edge of coast?board.edges.filter(e=>e.tiles.length===1):[]) {
    const a=board.vertices[edge.a],b=board.vertices[edge.b],x=(a.x+b.x)/2,z=(a.z+b.z)/2;
    const tile=board.tiles[edge.tiles[0]],nx=(x-tile.x)/Math.sqrt(.75),nz=(z-tile.z)/Math.sqrt(.75),rotation=-Math.atan2(b.z-a.z,b.x-a.x);
    batch.add('box',0xe6d6a3,x+nx*.035,.12,z+nz*.035,.96,.055,.15,rotation);
    for(let i=0;i<2;i++)batch.add('box',i?0xcde4d9:0x90c5bb,x+nx*(.22+i*.22),.053,z+nz*(.22+i*.22),i?.42:.77,.012,.045,rotation,'water');
    if(!portEdges.has(edge.id))batch.add('rock',0x829b8c,x+nx*.16,.12,z+nz*.16,.08,.06,.09,rotation);
  }
  if(!loadedPorts)for(const port of board.ports) {
    for(const arm of portGeometry(board,port).arms){
      const a=arm.from,b=arm.to,length=Math.hypot(b.x-a.x,b.z-a.z),rotation=-Math.atan2(b.z-a.z,b.x-a.x);
      batch.add('box',0x957449,(a.x+b.x)/2,.155,(a.z+b.z)/2,length,.06,.16,rotation);
      for(let i=0;i<4;i++){const t=(i+.5)/4;batch.add('box',0xc8ac78,a.x+(b.x-a.x)*t,.195,a.z+(b.z-a.z)*t,length/5,.018,.17,rotation);}
      for(const end of [a,b])batch.add('box',0x69543c,end.x,.08,end.z,.065,.22,.065);
    }
  }
  batch.finish(group);
}
