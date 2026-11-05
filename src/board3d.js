import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LABELS } from '../shared/board.js';
import { resourceIllustration } from './icons.js';
import { BoardAssets, Batches, buildTerrain, clearLayer } from './terrain.js';
import { boardFrame } from './board-frame.js';

export class Board {
  constructor(container,onSelect,onHover) {
    this.container=container;this.onSelect=onSelect;this.onHover=onHover;
    this.frame=0;this.visible=true;this.metrics={renders:0,landBuilds:0,pieceBuilds:0,markerBuilds:0};
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});
    this.assets=new BoardAssets();
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#b8d8d2');
    this.camera=new THREE.PerspectiveCamera(34,1,.1,150);
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.shadowMap.autoUpdate=false;
    container.append(this.renderer.domElement);
    const canvas=this.renderer.domElement;
    canvas.setAttribute('aria-label','卡坦岛 3D 棋盘，拖动旋转，双指或滚轮缩放；也可切换二维棋盘用键盘落子');
    this.controls=new OrbitControls(this.camera,canvas);
    this.controls.enableDamping=!matchMedia('(prefers-reduced-motion:reduce)').matches;
    this.controls.enablePan=false;this.controls.minPolarAngle=.15;this.controls.maxPolarAngle=1.12;
    this.controls.addEventListener('change',()=>this.invalidate());
    this.scene.add(new THREE.HemisphereLight(0xfff9e9,0x78988c,2.3));
    this.sun=new THREE.DirectionalLight(0xffeed2,2.3);this.sun.position.set(-5,13,8);
    this.sun.shadow.mapSize.set(1024,1024);Object.assign(this.sun.shadow.camera,{left:-9,right:9,top:9,bottom:-9});
    this.sun.shadow.normalBias=.035;this.sun.shadow.bias=-.0001;this.scene.add(this.sun);
    this.seaBase=new THREE.Mesh(this.assets.geometries.sea,this.assets.material('sea'));
    this.seaBase.material.color.set(0xa7cdc7);this.seaBase.position.y=-.04;this.scene.add(this.seaBase);
    this.land=new THREE.Group();this.pieces=new THREE.Group();this.markers=new THREE.Group();
    this.scene.add(this.land,this.pieces,this.markers);
    this.assets.materials.set('marker',new THREE.MeshBasicMaterial({color:0xffef9d,depthTest:false,depthWrite:false,toneMapped:false}));
    this.assets.materials.set('outline',new THREE.MeshBasicMaterial({color:0x234c43,depthTest:false,depthWrite:false,toneMapped:false}));
    this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();this.pointers=new Set();
    this.events=new AbortController();const options={signal:this.events.signal};
    canvas.addEventListener('pointerdown',e=>{
      this.pointers.add(e.pointerId);this.down=this.pointers.size===1?{id:e.pointerId,x:e.clientX,y:e.clientY}:null;
    },options);
    canvas.addEventListener('pointercancel',e=>{this.pointers.delete(e.pointerId);this.down=null;},options);
    canvas.addEventListener('pointerup',e=>{
      this.pointers.delete(e.pointerId);const down=this.down;this.down=null;
      if(!down||down.id!==e.pointerId||this.pointers.size||Math.hypot(e.clientX-down.x,e.clientY-down.y)>7)return;
      const target=this.pick(e,e.pointerType==='touch');if(target)this.onSelect(target);
    },options);
    canvas.addEventListener('pointermove',e=>{
      if(e.pointerType==='touch'||this.pointers.size)return;
      const hit=this.hit(e),data=hit?.object.userData,tile=data?.tile;
      canvas.style.cursor=this.pick(e,false,false)?'pointer':'grab';
      this.onHover(data?.port!==undefined?(data.port==='any'?'普通港口 3:1':`${LABELS[data.port]}港口 2:1`)
        :tile===undefined?'':`${LABELS[this.board.tiles[tile].resource]}${this.board.tiles[tile].number?` · ${this.board.tiles[tile].number} 点生产`:' · 不生产资源'}`);
    },options);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.stopFrame();else this.invalidate();},options);
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(container);
    this.intersection=new IntersectionObserver(entries=>{
      this.visible=entries[0].isIntersecting;if(this.visible)this.invalidate();else this.stopFrame();
    });this.intersection.observe(container);
    this.resize();
  }
  stopFrame() {cancelAnimationFrame(this.frame);this.frame=0;}
  invalidate() {
    if(this.disposed||this.frame||document.hidden||!this.visible)return;
    this.frame=requestAnimationFrame(()=>{
      this.frame=0;this.controls.update();this.renderer.render(this.scene,this.camera);this.metrics.renders++;
      const {calls,triangles}=this.renderer.info.render;
      this.renderer.domElement.dataset.renderStats=JSON.stringify({...this.metrics,calls,triangles,...this.renderer.info.memory,dpr:this.renderer.getPixelRatio(),shadows:this.renderer.shadowMap.enabled});
      this.renderer.domElement.dataset.camera=JSON.stringify(this.camera.position.toArray());
      this.renderer.domElement.dataset.cameraView=JSON.stringify(this.camera.view);
    });
  }
  resize() {
    const w=this.container.clientWidth,h=this.container.clientHeight;if(!w||!h||this.disposed)return;
    const mobile=this.mobile=matchMedia('(pointer:coarse)').matches||Math.min(innerWidth,innerHeight)<=600;
    const dpr=Math.min(devicePixelRatio||1,mobile?1.35:1.75,Math.sqrt((mobile?1200000:2000000)/(w*h)));
    const changed=w!==this.width||h!==this.height;
    this.width=w;this.height=h;this.renderer.setPixelRatio(dpr);this.renderer.setSize(w,h,false);
    this.renderer.shadowMap.enabled=!mobile;this.sun.castShadow=!mobile;this.renderer.shadowMap.needsUpdate=true;
    if(changed){this.updateProjection();if(this.board)this.fit(true);else this.invalidate();}
    else this.invalidate();
  }
  setViewportPadding(padding={}) {
    const key=JSON.stringify([padding.top||0,padding.right||0,padding.bottom||0,padding.left||0]);
    if(key===this.paddingKey)return;
    this.paddingKey=key;this.padding=padding;this.updateProjection();
    if(this.board)this.fit(true);else this.invalidate();
  }
  updateProjection() {
    if(!this.width||!this.height)return;
    this.viewportFrame=boardFrame(this.width,this.height,this.padding);
    const f=this.viewportFrame;
    // Off-axis projection centers the island in the unobscured play area while
    // rendering the sea to every edge of the full viewport.
    this.camera.setViewOffset(f.width,f.height,-f.left,-f.top,this.width,this.height);
    this.camera.updateProjectionMatrix();
  }
  reset() {
    const scale=this.boardScale||1;
    const portrait=(this.container?.clientWidth||this.width)<(this.container?.clientHeight||this.height);
    this.camera.position.set(...(portrait?[.3*scale,16*scale,3*scale]:[14*scale,8*scale,.3*scale]));this.controls.target.set(0,0,0);
    this.fit(false);
  }
  zoomBy(factor) {
    if(!Number.isFinite(factor)||factor<=0)return;
    const distance=Math.max(this.controls.minDistance,Math.min(this.controls.maxDistance,this.camera.position.length()/factor));
    this.camera.position.setLength(distance);this.controls.update();this.invalidate();
  }
  fit(preserveZoom=false) {
    const scale=this.boardScale||1,f=this.viewportFrame||boardFrame(this.width,this.height);
    const relativeZoom=preserveZoom&&this.fitDistance?this.camera.position.length()/this.fitDistance:1;
    for(let i=0;i<14;i++) {
      this.camera.lookAt(this.controls.target);this.camera.updateMatrixWorld();
      const points=(this.fitPoints||[]).map(p=>new THREE.Vector3(p.x,p.y,p.z));
      const right=new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld,0),up=new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld,1);
      for(const p of this.portBounds||[])for(const dx of [-.46,.46])for(const dy of [-.23,.23])points.push(new THREE.Vector3(p.x,p.y,p.z).addScaledVector(right,dx).addScaledVector(up,dy));
      const projected=points.map(p=>p.project(this.camera));
      const minX=Math.min(...projected.map(p=>p.x)),maxX=Math.max(...projected.map(p=>p.x)),minY=Math.min(...projected.map(p=>p.y)),maxY=Math.max(...projected.map(p=>p.y));
      // Perspective makes the near coast larger. Center its actual projected
      // bounds rather than leaving unused space above the island's origin.
      this.camera.view.offsetX+=((minX+maxX)/2-f.centerX)*this.width/2;
      this.camera.view.offsetY-=((minY+maxY)/2-f.centerY)*this.height/2;
      this.camera.updateProjectionMatrix();
      const factor=Math.max(.1,(maxX-minX)/2/f.halfWidth,(maxY-minY)/2/f.halfHeight);
      if(Math.abs(factor-1)<.006)break;
      this.camera.position.multiplyScalar(Math.max(.7,Math.min(1.35,factor)));
    }
    this.fitDistance=this.camera.position.length();
    this.camera.position.multiplyScalar(relativeZoom);
    this.controls.maxDistance=Math.max(24*scale,this.camera.position.length()*1.4);
    this.controls.minDistance=5*scale;this.controls.update();this.invalidate();
  }
  hit(e) {
    const rect=this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
    this.scene.updateMatrixWorld();this.raycaster.setFromCamera(this.pointer,this.camera);
    return this.raycaster.intersectObjects(this.targets||[],false)[0];
  }
  pick(e,touch,notify=true) {
    const rect=this.renderer.domElement.getBoundingClientRect();
    // Use screen-space hit regions, independent of DPR or zoom. Ambiguous touches
    // ask for zoom instead of silently selecting the neighboring intersection.
    const candidates=(this.markerTargets||[]).map(marker=>{
      const p=marker.position.clone().project(this.camera);
      return {marker,distance:Math.hypot(rect.left+(p.x+1)*rect.width/2-e.clientX,rect.top+(1-p.y)*rect.height/2-e.clientY)};
    }).filter(p=>p.distance<=(touch?22:11)).sort((a,b)=>a.distance-b.distance);
    if(candidates.length) {
      if(touch&&candidates[1]&&candidates[1].distance-candidates[0].distance<6) {
        if(notify)this.onHover('相邻落点较近，请双指放大后再点选。');return null;
      }
      return candidates[0].marker.userData;
    }
    const hit=this.hit(e);return hit?.object.userData.kind?hit.object.userData:null;
  }
  label(key,draw,width=128,height=128) {
    if(!this.assets.textures.has(key)) {
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
      this.assets.textures.set(key,texture);draw(canvas.getContext('2d'),texture);
      this.assets.materials.set(key,new THREE.SpriteMaterial({map:texture,depthTest:false,depthWrite:false,toneMapped:false}));
    }
    const sprite=new THREE.Sprite(this.assets.materials.get(key));sprite.renderOrder=12;return sprite;
  }
  numberToken(number) {
    const sprite=this.label(`number:${number}`,c=>{
      c.fillStyle='#fff4d5';c.beginPath();c.arc(64,64,59,0,Math.PI*2);c.fill();c.strokeStyle='#b6a479';c.lineWidth=3;c.stroke();
      c.fillStyle=[6,8].includes(number)?'#a13522':'#213e37';c.textAlign='center';c.textBaseline='middle';c.font='bold 54px "Segoe UI",sans-serif';c.fillText(String(number),64,54);
      const dots=6-Math.abs(7-number);for(let i=0;i<dots;i++){c.beginPath();c.arc(64+(i-(dots-1)/2)*11,96,3.5,0,Math.PI*2);c.fill();}
    });sprite.scale.set(.61,.61,1);return sprite;
  }
  portToken(resource) {
    const sprite=this.label(`port:${resource}`,(c,texture)=>{
      c.fillStyle='#fff6df';c.beginPath();c.roundRect(2,2,252,124,18);c.fill();c.strokeStyle='#718f7c';c.lineWidth=3;c.stroke();
      c.fillStyle='#244940';c.textAlign='center';c.textBaseline='middle';c.font='700 53px "Segoe UI",sans-serif';c.fillText(resource==='any'?'3:1':'2:1',resource==='any'?128:174,68);
      if(resource!=='any') {
        const art=new Image();art.onload=()=>{if(this.assets.disposed)return;c.drawImage(art,10,17,94,94);texture.needsUpdate=true;this.invalidate();};
        art.src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(resourceIllustration(resource))}`;
      }
    },256,128);sprite.scale.set(.92,.46,1);sprite.userData={port:resource};return sprite;
  }
  set(state,mode) {
    const b=state.board;if(!b||this.disposed)return;this.board=b;
    const key=JSON.stringify([b.tiles.map(t=>[t.id,t.x,t.z,t.resource,t.number]),b.vertices.map(v=>[v.x,v.z]),b.ports]);
    let changed=false;
    if(key!==this.landKey) {
      this.landKey=key;this.pieceKey=this.markerKey=null;clearLayer(this.land);this.metrics.landBuilds++;changed=true;
      this.boardScale=b.tiles.length>19?Math.max(...b.tiles.map(t=>Math.hypot(t.x,t.z)+1.5))/5.8:1;
      this.seaBase.scale.set(5.8*this.boardScale,.14,5.8*this.boardScale);
      buildTerrain(b,this.assets,this.land);
      this.tiles=b.tiles.map(t=>{
        // Invisible raycast surfaces share geometry/material and cost no draw calls.
        const hex=new THREE.Mesh(this.assets.geometries.hex,this.assets.material());hex.position.set(t.x,.235,t.z);hex.scale.set(.942,.075,.942);hex.userData={tile:t.id};hex.visible=false;this.land.add(hex);return hex;
      });
      for(const tile of b.tiles)if(tile.number){const token=this.numberToken(tile.number);token.position.set(tile.x,.43,tile.z);this.land.add(token);}
      this.portBounds=[];this.portTargets=[];
      for(const port of b.ports) {
        const a=b.vertices[port.vertices[0]],v=b.vertices[port.vertices[1]],x=(a.x+v.x)/2,z=(a.z+v.z)/2,l=Math.hypot(x,z);
        const p={x:x+x/l*.69,y:.4,z:z+z/l*.69};this.portBounds.push(p);
        const label=this.portToken(port.resource);label.position.set(p.x,p.y,p.z);this.land.add(label);this.portTargets.push(label);
      }
      this.fitPoints=[...b.vertices.map(v=>({x:v.x,y:.4,z:v.z})),...b.tiles.map(t=>({x:t.x,y:1,z:t.z}))];this.reset();
    }
    const colors=state.players.map(p=>[p.id,p.color]);
    const pieceKey=JSON.stringify([b.edges.map(e=>e.owner),b.vertices.map(v=>[v.owner,v.level]),colors,state.robber]);
    if(pieceKey!==this.pieceKey) {
      this.pieceKey=pieceKey;clearLayer(this.pieces);this.metrics.pieceBuilds++;changed=true;
      const batch=new Batches(this.assets),color=id=>state.players.find(p=>p.id===id)?.color||'#e57c54';
      const add=(shape,c,x,y,z,sx,sy,sz,r=0)=>batch.add(shape,c,x,y,z,sx,sy,sz,r,'overlay');
      for(const edge of b.edges.filter(e=>e.owner)) {
        const a=b.vertices[edge.a],v=b.vertices[edge.b],x=(a.x+v.x)/2,z=(a.z+v.z)/2,r=-Math.atan2(v.z-a.z,v.x-a.x);
        add('box',0x385347,x,.31,z,.76,.08,.18,r);add('box',color(edge.owner),x,.37,z,.72,.12,.13,r);
      }
      for(const v of b.vertices.filter(v=>v.owner)) {
        add('box',0x344b40,v.x,.31,v.z,.31,.045,.30);
        add('box',color(v.owner),v.x,.43,v.z,.24,.23,.25);
        add('roof',color(v.owner),v.x,.62,v.z,.21,.18,.21,Math.PI/4);
        if(v.level===2){add('box',color(v.owner),v.x+.19,.5,v.z,.20,.38,.22);add('roof',color(v.owner),v.x+.19,.76,v.z,.18,.15,.18,Math.PI/4);}
      }
      if(state.robber!==null&&state.robber!==undefined) {
        const t=b.tiles[state.robber];add('cone',0x283e38,t.x,.53,t.z+.4,.14,.4,.14);add('wool',0x283e38,t.x,.8,t.z+.4,.09,.10,.09);
      }
      batch.finish(this.pieces);
    }
    const markerKey=JSON.stringify([mode,state.legal?.[mode]||[]]);
    if(markerKey!==this.markerKey) {
      this.markerKey=markerKey;clearLayer(this.markers);this.metrics.markerBuilds++;this.markerTargets=[];changed=true;
      for(const tile of this.tiles)tile.userData={tile:tile.userData.tile,...(mode==='robber'&&state.legal?.robber.includes(tile.userData.tile)?{kind:'tile',id:tile.userData.tile}:{})};
      const sites=['road','settlement','city'].includes(mode)?state.legal?.[mode]||[]:[];
      const fill=new THREE.InstancedMesh(this.assets.geometries.cylinder,this.assets.materials.get('marker'),sites.length);
      const rim=new THREE.InstancedMesh(this.assets.geometries.ring,this.assets.materials.get('outline'),sites.length);
      const transform=new THREE.Object3D();
      for(const [index,id] of sites.entries()) {
        let x,z;if(mode==='road'){const e=b.edges[id],a=b.vertices[e.a],v=b.vertices[e.b];x=(a.x+v.x)/2;z=(a.z+v.z)/2;}else({x,z}=b.vertices[id]);
        const marker=new THREE.Object3D();marker.position.set(x,.39,z);
        marker.userData={kind:mode==='road'?'edge':'vertex',id};this.markerTargets.push(marker);
        transform.position.copy(marker.position);transform.scale.set(.14,.055,.14);transform.rotation.set(0,0,0);transform.updateMatrix();fill.setMatrixAt(index,transform.matrix);
        transform.position.y=.425;transform.scale.setScalar(.145);transform.rotation.x=-Math.PI/2;transform.updateMatrix();rim.setMatrixAt(index,transform.matrix);
      }
      for(const [mesh,order] of [[fill,20],[rim,21]]){mesh.renderOrder=order;mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();if(sites.length)this.markers.add(mesh);else mesh.dispose();}
    }
    this.targets=[...this.tiles,...this.portTargets];
    if(changed){this.renderer.shadowMap.needsUpdate=true;this.invalidate();}
  }
  dispose() {
    if(this.disposed)return;this.disposed=true;this.stopFrame();this.events.abort();this.observer.disconnect();this.intersection.disconnect();this.controls.dispose();
    for(const group of [this.land,this.pieces,this.markers])clearLayer(group);
    this.scene.clear();this.sun.shadow.dispose();this.assets.dispose();this.renderer.dispose();this.renderer.forceContextLoss();this.renderer.domElement.remove();
  }
}
