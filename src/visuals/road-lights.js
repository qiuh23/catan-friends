import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {roadLampPose} from './road-geometry.js';

function lanternFrame() {
  const parts=[];
  const box=(x,y,z,sx,sy,sz)=>parts.push(new THREE.BoxGeometry(sx,sy,sz).translate(x,y,z));
  box(0,.012,0,.045,.024,.045);box(0,.137,0,.018,.25,.018);
  box(0,.267,0,.062,.018,.062);box(0,.350,0,.078,.018,.078);
  box(0,.363,0,.045,.012,.045);
  for(const x of [-.024,.024])for(const z of [-.024,.024])box(x,.309,z,.007,.076,.007);
  const geometry=mergeGeometries(parts);for(const part of parts)part.dispose();return geometry;
}

// Three instanced draws for every built road together. No PointLight, shadows,
// textures, extra RAF/timer, or allocation during day/night interpolation.
export function createRoadLights(scene) {
  const group=new THREE.Group();group.name='BuiltRoadLanterns';scene.add(group);
  const bronze=new THREE.MeshStandardMaterial({color:0x493d2d,metalness:.28,roughness:.72});
  const glass=new THREE.MeshStandardMaterial({color:0xdfbe7e,emissive:0xffb35b,emissiveIntensity:0,roughness:.48});
  const night={value:0},strength={value:1};
  const pool=new THREE.ShaderMaterial({
    uniforms:{uNight:night,uStrength:strength,uWarm:{value:new THREE.Color(0xffbf72)}},
    vertexShader:`varying vec2 vUv;
      void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
    fragmentShader:`uniform float uNight;uniform float uStrength;uniform vec3 uWarm;varying vec2 vUv;
      void main(){vec2 p=(vUv-.5)*2.;float glow=pow(max(0.,1.-dot(p,p)),2.);
      gl_FragColor=vec4(uWarm,glow*uNight*uStrength*.34);}`,
    transparent:true,depthWrite:false,depthTest:true,blending:THREE.AdditiveBlending,
    toneMapped:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1,
  });
  const geometry={frame:lanternFrame(),glass:new THREE.BoxGeometry(.041,.064,.041).translate(0,.309,0),pool:new THREE.PlaneGeometry(.67,.134).rotateX(-Math.PI/2)};
  let key=null,rows=[],meshes=[],disposed=false,reveals=new Map();
  const transform=new THREE.Object3D();
  function clear(){for(const mesh of meshes){mesh.removeFromParent();mesh.dispose();}meshes=[];rows=[];}
  function matrix(row,index,amount=1) {
    const p=row.pose;
    transform.position.set(p.x,p.y,p.z);transform.rotation.set(0,p.rotation,0);transform.scale.setScalar(amount);transform.updateMatrix();
    meshes[0].setMatrixAt(index,transform.matrix);meshes[1].setMatrixAt(index,transform.matrix);
    // This soft pool sits over the paving, rather than glowing through terrain.
    transform.position.set(p.frame.x,.355,p.frame.z);transform.scale.set(amount,1,amount);transform.updateMatrix();meshes[2].setMatrixAt(index,transform.matrix);
  }
  function changed(){for(const mesh of meshes)mesh.instanceMatrix.needsUpdate=true;}
  return {
    group,
    setBoard(board){
      if(disposed)return;
      const owned=board.edges.filter(edge=>edge.owner);
      const next=JSON.stringify(owned.map(edge=>[edge.id,edge.owner,board.vertices[edge.a].x,board.vertices[edge.a].z,board.vertices[edge.b].x,board.vertices[edge.b].z]));
      if(next===key)return;key=next;clear();reveals.clear();
      rows=owned.map(edge=>({id:edge.id,pose:roadLampPose(board.vertices[edge.a],board.vertices[edge.b])}));
      if(!rows.length)return;
      meshes=[new THREE.InstancedMesh(geometry.frame,bronze,rows.length),new THREE.InstancedMesh(geometry.glass,glass,rows.length),new THREE.InstancedMesh(geometry.pool,pool,rows.length)];
      meshes.forEach((mesh,i)=>{mesh.name=['RoadLampFrames','RoadLampGlass','RoadLampPools'][i];mesh.raycast=()=>{};mesh.castShadow=false;mesh.receiveShadow=false;group.add(mesh);});
      rows.forEach((row,i)=>matrix(row,i));changed();
      for(const mesh of meshes){mesh.computeBoundingBox();mesh.computeBoundingSphere();}
    },
    setReveal(amounts){
      if(disposed||!meshes.length)return;
      let dirty=false;
      rows.forEach((row,i)=>{const road=Math.max(0,Math.min(1,amounts.get(row.id)??1)),t=Math.max(0,Math.min(1,(road-.65)/.35)),amount=t*t*(3-2*t);
        if(reveals.get(row.id)===amount)return;reveals.set(row.id,amount);matrix(row,i,amount);dirty=true;});
      if(dirty)changed();
    },
    setNight(value,{lowPower=false}={}){
      if(disposed)return;const amount=Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;
      night.value=amount;strength.value=lowPower?.60:1;glass.emissiveIntensity=amount*3.8;
      if(meshes[2])meshes[2].visible=amount>.001;
    },
    getState(){return {roads:rows.length,drawCalls:meshes.length,night:night.value,lights:0,shadowLights:0};},
    dispose(){if(disposed)return;disposed=true;clear();group.removeFromParent();for(const value of Object.values(geometry))value.dispose();bronze.dispose();glass.dispose();pool.dispose();reveals.clear();},
  };
}
