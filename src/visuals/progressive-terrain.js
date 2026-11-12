import * as THREE from 'three';
import {buildTerrain,buildTileTerrain} from '../terrain.js';
import {PIER_URL} from './board-models.js';

// Keep every mesh directly under land for the existing nonrecursive occlusion
// and instance picking. A completed download replaces only its own placeholder,
// never the coast, labels, other tiles, selection or camera.
export class ProgressiveTerrain {
  constructor(models,assets,land){this.models=models;this.assets=assets;this.land=land;this.parts=new Map();this.fades=[];}
  attach(holder){const nodes=[...holder.children];this.land.add(...nodes);return {holder,nodes};}
  release(part){
    this.models.releaseLayer(part.holder);
    for(const node of part.nodes){if(node.parent){node.removeFromParent();if(node.isInstancedMesh)node.dispose();}}
  }
  reset(board){
    this.dispose();this.board=board;this.groups=this.models.choices(board);
    for(const group of this.groups){
      const ids=new Set(group.instances.map(i=>i.tileId)),tiles=board.tiles.filter(t=>ids.has(t.id));
      this.parts.set(group.url,{group,tiles,status:'pending',placeholder:null,display:null});
    }
    if(board.ports.length)this.parts.set(PIER_URL,{status:'pending',placeholder:null,display:null});
    this.update({immediate:true});
  }
  update({immediate=false,reducedMotion=false,now=performance.now()}={}){
    let changed=false;
    for(const [url,part]of this.parts){
      const status=this.models.ready.has(url)?'ready':this.models.failed.has(url)?'failed':'pending';
      if(part.display&&part.status===status)continue;
      if(status==='pending'){
        part.status='pending';
        if(!part.display&&!part.placeholder&&part.tiles){const holder=new THREE.Group();buildTileTerrain(part.tiles,this.assets,holder,{placeholder:true});part.placeholder=this.attach(holder);changed=true;}
        continue;
      }
      // An explicit retry can replace a failed fallback, without rebuilding any
      // already-complete tiles. Finish any older transition before replacing it.
      this.finishPart(part);
      if(part.display)this.release(part.display);
      const holder=new THREE.Group();
      if(status==='ready'){
        if(part.group)this.models.add(holder,url,part.group.instances,{tileIds:part.group.instances.map(i=>i.tileId)});
        else this.models.ports(this.board,holder);
      }else if(part.tiles)buildTileTerrain(part.tiles,this.assets,holder);
      else buildTerrain(this.board,this.assets,holder,{loadedTiles:new Set(this.board.tiles.map(t=>t.id)),coast:false});
      part.display=this.attach(holder);part.status=status;changed=true;
      if(immediate||reducedMotion){if(part.placeholder)this.release(part.placeholder);part.placeholder=null;}
      else {
        const materials=[];
        for(const mesh of part.display.nodes){
          const original=mesh.material,fade=original.clone();fade.transparent=true;fade.opacity=0;fade.depthWrite=false;
          mesh.material=fade;materials.push({mesh,original,fade});
        }
        this.fades.push({part,materials,start:now});
      }
    }
    return changed;
  }
  finishPart(part){for(const fade of [...this.fades])if(fade.part===part)this.finish(fade);}
  finish(fade){
    for(const {mesh,original,fade:material}of fade.materials){mesh.material=original;material.dispose();}
    if(fade.part.placeholder)this.release(fade.part.placeholder);fade.part.placeholder=null;
    this.fades.splice(this.fades.indexOf(fade),1);
  }
  tick(now,{reducedMotion=false}={}){
    for(const fade of [...this.fades]){
      const t=reducedMotion?1:Math.min(1,Math.max(0,(now-fade.start)/240));
      for(const {fade:material}of fade.materials)material.opacity=t*t*(3-2*t);
      if(t===1)this.finish(fade);
    }
    return this.fades.length>0;
  }
  stats(){
    let tiles=0,pending=0,failed=0;for(const part of this.parts.values()){
      if(part.status==='ready')tiles+=part.tiles?.length||0;
      else if(part.status==='failed')failed++;else pending++;
    }
    return {version:9,tiles,total:this.board?.tiles.length||0,ports:this.parts.get(PIER_URL)?.status==='ready',pending,failed};
  }
  dispose(){
    for(const fade of [...this.fades])this.finish(fade);
    for(const part of this.parts.values()){if(part.placeholder)this.release(part.placeholder);if(part.display)this.release(part.display);}
    this.parts.clear();
  }
}
