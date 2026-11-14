import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {enhanceTerrainReadability,RESOURCE_HEIGHT,TERRAIN_SURFACE,terrainFitPoints} from '../src/visuals/terrain-readability.js';
import {ROBBER_SCALE,ROBBER_RADIUS} from '../src/visuals/robber.js';
import {ROBBER_SUPPORT} from '../src/visuals/robber-support-data.js';
import {portGeometry} from '../src/ports.js';
import {BoardModels,TERRAIN_URL} from '../src/visuals/board-models.js';
const parse=async file=>{const b=await readFile(new URL('../public'+file,import.meta.url));return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');};

test('17 variants grow by resource while preserving ground footprints, number clearings and edge lanes',async()=>{
  for(const file of await readdir(new URL('../public'+TERRAIN_URL,import.meta.url))){
    const {scene}=await parse(TERRAIN_URL+file),resource=file.match(/catan_terrain_([a-z]+)_/)[1],before=[];
    scene.traverse(m=>{if(m.isMesh)before.push({m,p:m.geometry.attributes.position.array.slice(),count:m.geometry.index.count,colors:m.geometry.attributes.color.array.slice()});});
    enhanceTerrainReadability(scene,resource);
    for(const {m,p,count,colors}of before){
      const now=m.geometry.attributes.position.array;assert.equal(m.geometry.index.count,count);assert.deepEqual(m.geometry.attributes.color.array,colors);
      let raised=0;
      for(let i=0;i<now.length;i+=3){
        if(m.name.endsWith('_ground')){assert.equal(now[i],p[i]);assert.equal(now[i+2],p[i+2]);}
        else for(let a=0;a<6;a++)assert.ok(now[i]*Math.cos(a*Math.PI/3)+now[i+2]*Math.sin(a*Math.PI/3)<=Math.sqrt(3)/2-.10+1e-6,'edge/building lane');
        assert.ok(Number.isFinite(now[i+1]));
        if(p[i+1]<=TERRAIN_SURFACE)assert.equal(now[i+1],p[i+1]);
        else {raised++;assert.ok(Math.abs((now[i+1]-TERRAIN_SURFACE)-(p[i+1]-TERRAIN_SURFACE)*RESOURCE_HEIGHT[resource])<1e-6);}
      }
      if(m.name.endsWith('_decoration')){
        const index=m.geometry.index.array;let beforeVertex=Infinity,afterVertex=Infinity;
        for(let i=0;i<index.length;i+=3){
          const points=[index[i],index[i+1],index[i+2]].map(j=>[now[j*3],now[j*3+2]]);
          for(let a=0;a<6;a++){
            const vx=Math.cos(Math.PI/6+a*Math.PI/3),vz=Math.sin(Math.PI/6+a*Math.PI/3);
            for(const [array,old]of [[p,true],[now,false]])for(let j=0;j<3;j++){
              const ia=index[i+j],ib=index[i+(j+1)%3],x=array[ia*3],z=array[ia*3+2],dx=array[ib*3]-x,dz=array[ib*3+2]-z,t=Math.max(0,Math.min(1,((vx-x)*dx+(vz-z)*dz)/(dx*dx+dz*dz)||0)),distance=Math.hypot(x+t*dx-vx,z+t*dz-vz);
              if(old)beforeVertex=Math.min(beforeVertex,distance);else afterVertex=Math.min(afterVertex,distance);
            }
          }
          const crosses=points.map(([x,z],j)=>{const [bx,bz]=points[(j+1)%3];return x*bz-z*bx;});
          assert.ok(!(crosses.every(c=>c>1e-9)||crosses.every(c=>c< -1e-9)),'no triangle covers token');
          for(let j=0;j<3;j++){const [x,z]=points[j],[bx,bz]=points[(j+1)%3],dx=bx-x,dz=bz-z,t=Math.max(0,Math.min(1,-(x*dx+z*dz)/(dx*dx+dz*dz)||0));assert.ok(Math.hypot(x+t*dx,z+t*dz)>=.35-1e-6,'number clearing');}
        }
        assert.ok(afterVertex>=Math.min(.25,beforeVertex)-1e-6,'building footprint must retain its clearance');
      }
      assert.ok(raised>0);const once=now.slice();enhanceTerrainReadability(scene,resource);assert.deepEqual(now,once,'repeated loads must not compound enlargement');
    }
  }
});
test('runtime loader applies the mapping before instancing and keeps source bytes unchanged',async()=>{
 const file='catan_terrain_sheep_01.glb',url=TERRAIN_URL+file,{scene}=await parse(url),raw=new THREE.Box3().setFromObject(scene);
 const models=new BoardModels({Loader:class{loadAsync(url){return parse(url);}}});await models.load(url);
 const result=new THREE.Box3().setFromObject(models.ready.get(url));assert.ok(result.max.y>raw.max.y+.1);assert.equal(result.max.x,raw.max.x);await models.dispose();
});
test('enlarged robber clears the number and all six road boundaries at every supported pose',async()=>{
 const {scene}=await parse('/assets/v9/catan_robber/hooded.glb'),positions=[];
 scene.updateMatrixWorld(true);scene.traverse(m=>{if(m.isMesh){const p=m.geometry.attributes.position;for(let i=0;i<p.count;i++)positions.push(new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(m.matrixWorld));}});
 for(const asset of Object.values(ROBBER_SUPPORT))for(const pose of asset.poses){
   assert.ok(Math.hypot(pose.x,pose.z)>=.43-1e-6&&Math.hypot(pose.x,pose.z)<=.51+1e-6);
   for(const p of positions){const x=pose.x+ROBBER_SCALE*(p.x*Math.cos(pose.rotationY)+p.z*Math.sin(pose.rotationY)),z=pose.z+ROBBER_SCALE*(p.z*Math.cos(pose.rotationY)-p.x*Math.sin(pose.rotationY));
     assert.ok(Math.hypot(x,z)>.34,'number clearing');
     for(let i=0;i<6;i++)assert.ok(x*Math.cos(i*Math.PI/3)+z*Math.sin(i*Math.PI/3)<Math.sqrt(3)/2-.14,'road/building lane');
   }
 }
});

test('portrait and landscape projection can frame all enlarged geometry with the existing fit workflow',async()=>{
 const {createBoard}=await import('../shared/board.js'),{Board}=await import('../src/board3d.js');
 const models=new BoardModels({Loader:class{loadAsync(url){return parse(url);}}});
 for(const expansion of [false,true]){
  const b=createBoard(()=>.43,expansion?{playerExpansion:'five-six-2025'}:{});await models.prepare(b);const layer=new THREE.Group();models.terrain(b,layer);models.ports(b,layer);
  const points=[];layer.updateMatrixWorld(true);for(const mesh of layer.children){const p=mesh.geometry.attributes.position,m=new THREE.Matrix4();for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,m);for(let j=0;j<p.count;j++)points.push(new THREE.Vector3().fromBufferAttribute(p,j).applyMatrix4(m));}}
  for(const [width,height,position]of [[390,844,[.3,16,3]],[844,390,[14,8,.3]],[320,640,[.3,16,7.5]]]){
   const view=Object.create(Board.prototype),camera=new THREE.PerspectiveCamera(34,width/height,.1,150);camera.position.set(...position);const controls={target:new THREE.Vector3(),update(){camera.lookAt(this.target);camera.updateMatrixWorld();}};
   Object.assign(view,{board:b,width,height,camera,controls,fitPoints:terrainFitPoints(b),portBounds:b.ports.map(p=>({...portGeometry(b,p).label,y:.4})),invalidate(){}});view.updateProjection();view.fit();
   const projected=points.map(point=>point.clone().project(camera)),maxX=projected.reduce((m,p)=>Math.max(m,Math.abs(p.x)),0),maxY=projected.reduce((m,p)=>Math.max(m,Math.abs(p.y)),0);assert.ok(maxX<=1.025&&maxY<=1.025,`${width}x${height}: geometry cropped ${maxX} ${maxY}; point ${points[projected.findIndex(p=>Math.abs(p.y)===maxY)]?.toArray()}`);
  }
  models.releaseLayer(layer);
 }
 await models.dispose();
});
