import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LABELS } from '../shared/board.js';
import { resourceIllustration } from './icons.js';
import { BoardAssets, Batches, buildTerrain, clearLayer } from './terrain.js';
import { boardFrame } from './board-frame.js';
import { feedbackPoints, planActionCamera } from './action-camera.js';
import { feedbackAnchor, mapViewKey } from './map-feedback.js';

function gableRoof(){
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([
    -.5,-.5,.5,.5,-.5,.5,0,.5,.5, .5,-.5,-.5,-.5,-.5,-.5,0,.5,-.5,
    -.5,-.5,-.5,-.5,-.5,.5,0,.5,.5, -.5,-.5,-.5,0,.5,.5,0,.5,-.5,
    .5,-.5,.5,.5,-.5,-.5,0,.5,-.5, .5,-.5,.5,0,.5,-.5,0,.5,.5,
    -.5,-.5,-.5,.5,-.5,-.5,.5,-.5,.5, -.5,-.5,-.5,.5,-.5,.5,-.5,-.5,.5,
  ],3));geometry.computeVertexNormals();return geometry;
}

export class Board {
  constructor(container,onSelect,onHover) {
    this.container=container;this.onSelect=onSelect;this.onHover=onHover;
    this.frame=0;this.visible=true;this.metrics={renders:0,landBuilds:0,pieceBuilds:0,markerBuilds:0};
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});
    this.assets=new BoardAssets();
    this.assets.geometries.roof.dispose();this.assets.geometries.roof=gableRoof();
    this.assets.geometries['site-ring']=new THREE.RingGeometry(.095,.125,24);
    this.assets.geometries['site-city-ring']=new THREE.RingGeometry(.225,.25,24);
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#b8d8d2');
    this.camera=new THREE.PerspectiveCamera(34,1,.1,150);
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.shadowMap.autoUpdate=false;
    container.append(this.renderer.domElement);
    const canvas=this.renderer.domElement;
    canvas.setAttribute('aria-label','卡坦岛 3D 棋盘，拖动旋转，双指或滚轮缩放；加减键缩放，0 回到全局；也可切换二维棋盘用键盘落子');canvas.tabIndex=0;
    this.controls=new OrbitControls(this.camera,canvas);
    this.controls.enableDamping=!matchMedia('(prefers-reduced-motion:reduce)').matches;
    this.controls.enablePan=false;this.controls.minPolarAngle=.15;this.controls.maxPolarAngle=1.12;
    this.controls.addEventListener('change',()=>this.invalidate());
    this.controls.addEventListener('start',()=>this.cancelFocus());
    this.scene.add(new THREE.HemisphereLight(0xfff9e9,0x78988c,2.3));
    this.sun=new THREE.DirectionalLight(0xffeed2,2.3);this.sun.position.set(-5,13,8);
    this.sun.shadow.mapSize.set(1024,1024);Object.assign(this.sun.shadow.camera,{left:-9,right:9,top:9,bottom:-9});
    this.sun.shadow.normalBias=.035;this.sun.shadow.bias=-.0001;this.scene.add(this.sun);
    this.seaBase=new THREE.Mesh(this.assets.geometries.sea,this.assets.material('sea'));
    this.seaBase.material.color.set(0xa7cdc7);this.seaBase.position.y=-.04;this.scene.add(this.seaBase);
    this.land=new THREE.Group();this.pieces=new THREE.Group();this.markers=new THREE.Group();this.selectionLayer=new THREE.Group();this.feedbackLayer=new THREE.Group();
    this.scene.add(this.land,this.pieces,this.markers,this.selectionLayer,this.feedbackLayer);
    // These are small ground inlays. Depth remains enabled so a nearby roof,
    // tree or rock naturally hides an inlay instead of being crossed by it.
    for(const [key,color,opacity] of [['marker',0xd4bb79,.88],['outline',0x49695e,.7],['selected',0xf0db9e,1],['feedback',0x81b6a4,.95]])
      this.assets.materials.set(key,new THREE.MeshBasicMaterial({color,opacity,transparent:opacity<1,depthTest:true,depthWrite:false,toneMapped:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
    // Painted pieces use depth so their pale plinth cannot draw over a roof or
    // tower. They keep one shared material and do not add mobile shadow passes.
    this.assets.materials.set('pieces',new THREE.MeshStandardMaterial({color:0xffffff,roughness:.65,metalness:.035,flatShading:true}));
    this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();this.pointers=new Set();
    this.events=new AbortController();const options={signal:this.events.signal};
    canvas.addEventListener('pointerdown',()=>{this.stopAmbient(true);this.cancelFocus();},{...options,capture:true});
    canvas.addEventListener('wheel',()=>this.manualInput(),{...options,capture:true,passive:true});
    canvas.addEventListener('keydown',e=>{
      if(!['+','=','-','0'].includes(e.key))return;e.preventDefault();this.manualInput();
      if(e.key==='0')this.reset();else this.zoomBy(e.key==='-'?.8:1.25);
    },options);
    canvas.addEventListener('pointerdown',e=>{
      this.pointers.add(e.pointerId);this.down=this.pointers.size===1?{id:e.pointerId,x:e.clientX,y:e.clientY}:null;
      if(this.pointers.size===1){this.pointerManual=false;this.selectSite(this.pick(e,e.pointerType==='touch',false));}else {this.selectSite(null);this.manualInput();}
    },options);
    canvas.addEventListener('pointercancel',e=>{this.pointers.delete(e.pointerId);this.down=null;this.selectSite(null);},options);
    canvas.addEventListener('pointerup',e=>{
      this.pointers.delete(e.pointerId);const down=this.down;this.down=null;
      if(!down||down.id!==e.pointerId||this.pointers.size||this.pointerManual||Math.hypot(e.clientX-down.x,e.clientY-down.y)>7)return;
      const target=this.pick(e,e.pointerType==='touch');this.selectSite(target);if(target)this.onSelect(target);
    },options);
    canvas.addEventListener('pointermove',e=>{
      if(this.down&&this.pointers.has(e.pointerId)&&!this.pointerManual&&Math.hypot(e.clientX-this.down.x,e.clientY-this.down.y)>3){this.pointerManual=true;this.selectSite(null);this.manualInput();}
      if(e.pointerType==='touch'||this.pointers.size)return;
      const hit=this.hit(e),data=hit?.object.userData,tile=data?.tile;
      const target=this.pick(e,false,false,hit);this.selectSite(target);canvas.style.cursor=target?'pointer':'grab';
      this.onHover(data?.port!==undefined?(data.port==='any'?'普通港口 3:1':`${LABELS[data.port]}港口 2:1`)
        :tile===undefined?'':`${LABELS[this.board.tiles[tile].resource]}${this.board.tiles[tile].number?` · ${this.board.tiles[tile].number} 点生产`:' · 不生产资源'}`);
    },options);
    canvas.addEventListener('pointerleave',()=>{if(!this.pointers.size)this.selectSite(null);},options);
    document.addEventListener('visibilitychange',()=>{if(document.hidden){this.stopFrame();this.stopAmbient();}else {this.scheduleAmbient();this.invalidate();}},options);
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(container);
    this.intersection=new IntersectionObserver(entries=>{
      this.visible=entries[0].isIntersecting;if(this.visible){this.scheduleAmbient();this.invalidate();}else {this.stopFrame();this.stopAmbient();}
    });this.intersection.observe(container);
    this.resize();
  }
  stopFrame() {cancelAnimationFrame(this.frame);this.frame=0;}
  setAmbient(enabled,{reducedMotion=false}={}) {
    const was=this.ambientEnabled;this.ambientEnabled=Boolean(enabled)&&!reducedMotion;
    if(!this.ambientEnabled){this.stopAmbient();return;}
    if(!was&&!this.ambientInterrupted){this.ambientOffset=this.camera.position.clone().sub(this.controls.target);this.ambientOrigin=this.controls.target.clone();this.ambientPhase=0;}
    this.scheduleAmbient();
  }
  stopAmbient(interrupted=false) {
    clearTimeout(this.ambientTimer);this.ambientTimer=0;
    if(interrupted)this.ambientInterrupted=true;
    if(this.renderer?.domElement)this.renderer.domElement.dataset.ambient='stopped';
  }
  scheduleAmbient() {
    if(this.disposed||!this.ambientEnabled||this.ambientInterrupted||this.ambientTimer||document.hidden||!this.visible||!this.ambientOffset)return;
    this.renderer.domElement.dataset.ambient='running';
    // Eight modest updates per second; no continuous render loop on the home
    // scene, and a bounded two-degree sway never accumulates into a new view.
    this.ambientTimer=setTimeout(()=>{
      this.ambientTimer=0;this.ambientPhase=(this.ambientPhase||0)+.125;
      const offset=this.ambientOffset.clone().applyAxisAngle(new THREE.Vector3(0,1,0),Math.sin(this.ambientPhase/18)*.035);
      this.controls.target.copy(this.ambientOrigin);this.camera.position.copy(this.ambientOrigin).add(offset);this.invalidate();this.scheduleAmbient();
    },125);
  }
  invalidate() {
    if(this.disposed||this.frame||document.hidden||!this.visible)return;
    this.frame=requestAnimationFrame(now=>{
      this.frame=0;
      const shot=this.focusAnimation;
      if(shot) {
        const t=Math.min(1,(now-shot.start)/650),ease=t*t*(3-2*t);
        this.controls.target.lerpVectors(shot.fromTarget,shot.target,ease);this.camera.position.lerpVectors(shot.from,shot.position,ease);
        if(t===1)this.focusAnimation=null;
      }
      this.controls.update();this.renderer.render(this.scene,this.camera);this.metrics.renders++;
      const {calls,triangles}=this.renderer.info.render;
      this.renderer.domElement.dataset.renderStats=JSON.stringify({...this.metrics,calls,triangles,...this.renderer.info.memory,dpr:this.renderer.getPixelRatio(),shadows:this.renderer.shadowMap.enabled});
      this.renderer.domElement.dataset.camera=JSON.stringify(this.camera.position.toArray());
      this.renderer.domElement.dataset.cameraTarget=JSON.stringify(this.controls.target.toArray());
      this.renderer.domElement.dataset.cameraFocus=this.focusAnimation?'moving':this.viewMode||'overview';
      this.renderer.domElement.dataset.cameraEvent=this.focusEvent||'';
      this.renderer.domElement.dataset.cameraView=JSON.stringify(this.camera.view);
      this.onProjectionChange?.();
      if(this.focusAnimation)this.invalidate();
    });
  }
  resize() {
    const w=this.container.clientWidth,h=this.container.clientHeight;if(!w||!h||this.disposed)return;
    const mobile=this.mobile=matchMedia('(pointer:coarse)').matches||Math.min(innerWidth,innerHeight)<=600;
    const dpr=Math.min(devicePixelRatio||1,mobile?1.35:1.75,Math.sqrt((mobile?1200000:2000000)/(w*h)));
    const changed=w!==this.width||h!==this.height;
    this.width=w;this.height=h;this.renderer.setPixelRatio(dpr);this.renderer.setSize(w,h,false);
    this.renderer.shadowMap.enabled=!mobile;this.sun.castShadow=!mobile;this.renderer.shadowMap.needsUpdate=true;
    if(changed){this.cancelFocus();this.updateProjection();if(this.board&&(!this.viewMode||this.viewMode==='overview'))this.fit(true);else this.invalidate();}
    else this.invalidate();
  }
  setViewportPadding(padding={},{preserveView=false}={}) {
    const key=JSON.stringify([padding.top||0,padding.right||0,padding.bottom||0,padding.left||0]);
    if(key===this.paddingKey)return;
    this.paddingKey=key;this.padding=padding;this.cancelFocus();this.updateProjection();
    if(this.board&&!preserveView&&!this.reducedMotion&&(!this.viewMode||this.viewMode==='overview'))this.fit(true);else this.invalidate();
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
  reset({defaultOrientation=false}={}) {
    this.cancelFocus();this.followBaseline=null;this.viewMode='overview';this.focusEvent='';
    const scale=this.boardScale||1;
    const portrait=(this.container?.clientWidth||this.width)<(this.container?.clientHeight||this.height);
    const offset=this.camera.position.clone().sub(this.controls.target);
    if(defaultOrientation||offset.lengthSq()<1)offset.set(...(portrait?[.3*scale,16*scale,3*scale]:[14*scale,8*scale,.3*scale]));
    this.controls.target.set(0,0,0);this.camera.position.copy(offset);this.updateProjection();
    this.fit(false);
  }
  zoomBy(factor) {
    if(!Number.isFinite(factor)||factor<=0)return;
    this.manualInput();const offset=this.camera.position.clone().sub(this.controls.target);
    const distance=Math.max(this.controls.minDistance,Math.min(this.controls.maxDistance,offset.length()/factor));
    this.camera.position.copy(this.controls.target).add(offset.setLength(distance));this.controls.update();this.invalidate();
  }
  manualInput(){this.stopAmbient(true);this.cancelFocus();this.followBaseline=null;this.viewMode='manual';this.onManual?.();}
  cancelFocus(){if(!this.focusAnimation)return;this.focusAnimation=null;this.invalidate();}
  projectFeedbackTarget(target) {
    const anchor=feedbackAnchor(this.board,target);if(!anchor||this.disposed)return null;
    const rect=this.renderer.domElement.getBoundingClientRect(),container=this.container.getBoundingClientRect();
    if(!rect.width||!rect.height)return null;
    this.camera.updateMatrixWorld();
    const projected=new THREE.Vector3(anchor.x,anchor.y,anchor.z).project(this.camera);
    const x=rect.left-container.left+(projected.x+1)*rect.width/2,y=rect.top-container.top+(1-projected.y)*rect.height/2;
    return {x,y,visible:Number.isFinite(x)&&Number.isFinite(y)&&projected.z>=-1&&projected.z<=1&&x>=0&&y>=0&&x<=container.width&&y<=container.height};
  }
  projectNumberObstacles() {
    if(!this.board||this.disposed)return [];
    const rect=this.renderer.domElement.getBoundingClientRect(),container=this.container.getBoundingClientRect();
    this.camera.updateMatrixWorld();
    const right=new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld,0),up=new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld,1);
    return this.board.tiles.filter(tile=>tile.number).flatMap(tile=>{
      const center=new THREE.Vector3(tile.x,.43,tile.z),projected=center.clone().project(this.camera);
      if(projected.z < -1||projected.z > 1)return [];
      const corners=[];
      for(const dx of [-.305,.305])for(const dy of [-.305,.305]) {
        const point=center.clone().addScaledVector(right,dx).addScaledVector(up,dy).project(this.camera);
        corners.push({x:rect.left-container.left+(point.x+1)*rect.width/2,y:rect.top-container.top+(1-point.y)*rect.height/2});
      }
      const x=Math.min(...corners.map(p=>p.x))-2,y=Math.min(...corners.map(p=>p.y))-2;
      return [{x,y,width:Math.max(...corners.map(p=>p.x))-x+2,height:Math.max(...corners.map(p=>p.y))-y+2}];
    });
  }
  exportView() {
    return {kind:'3d',mapKey:mapViewKey(this.board),position:this.camera.position.toArray(),target:this.controls.target.toArray(),
      viewMode:this.viewMode,fitDistance:this.fitDistance,width:this.width,height:this.height,paddingKey:this.paddingKey,view:this.camera.view?{...this.camera.view}:null};
  }
  importView(view) {
    if(view?.kind!=='3d'||view.mapKey!==mapViewKey(this.board)||![view.position,view.target].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite)))return false;
    const position=new THREE.Vector3().fromArray(view.position),target=new THREE.Vector3().fromArray(view.target),distance=position.distanceTo(target);
    if(distance<.1||distance>140)return false;
    this.cancelFocus();this.followBaseline=null;this.focusEvent='';this.viewMode=view.viewMode||'overview';
    this.camera.position.copy(position);this.controls.target.copy(target);
    this.controls.maxDistance=Math.max(this.controls.maxDistance,distance*1.1);
    if(Number.isFinite(view.fitDistance)&&view.fitDistance>0)this.fitDistance=view.fitDistance;
    // fit() centres the projected island with an off-axis offset. Preserve it
    // exactly on a renderer toggle; resize uses the current unobscured frame.
    if(view.width===this.width&&view.height===this.height&&view.paddingKey===this.paddingKey&&view.view) {
      this.camera.view={...view.view};this.camera.updateProjectionMatrix();
    }else this.updateProjection();
    this.controls.update();this.camera.updateMatrixWorld();this.invalidate();return true;
  }
  siteMesh(marker,material,factor,order){
    const road=marker.userData.kind==='edge',mesh=new THREE.Mesh(this.assets.geometries[road?'box':this.mode==='city'?'site-city-ring':'site-ring'],this.assets.materials.get(material));
    mesh.position.copy(marker.position);mesh.renderOrder=order;
    if(road){mesh.rotation.y=marker.rotation.y;mesh.scale.set(.52*factor,.012,.025*factor);}
    else {mesh.rotation.x=-Math.PI/2;mesh.scale.setScalar(factor);}
    return mesh;
  }
  selectSite(target){
    const marker=(this.markerTargets||[]).find(m=>m.userData.kind===target?.kind&&m.userData.id===target?.id),key=marker?`${target.kind}:${target.id}`:'';
    if(key===this.selectedSiteKey)return;this.selectedSiteKey=key;clearLayer(this.selectionLayer);
    if(marker) {
      if(marker.userData.kind==='edge') {
        // A selected road gains two fine rails; its centre remains transparent.
        for(const side of [-1,1]){const mesh=this.siteMesh(marker,'selected',1.08,24);mesh.position.x+=Math.sin(marker.rotation.y)*side*.052;mesh.position.z+=Math.cos(marker.rotation.y)*side*.052;this.selectionLayer.add(mesh);}
      }else for(const factor of [1,this.mode==='city'?1.22:1.65])this.selectionLayer.add(this.siteMesh(marker,'selected',factor,24));
    }
    this.renderer.domElement.dataset.selectedSite=key;this.invalidate();
  }
  setFeedback(event,{reducedMotion=this.reducedMotion??false}={}) {
    this.feedback=event;this.reducedMotion=reducedMotion;this.controls.enableDamping=!reducedMotion;
    const key=JSON.stringify(event?.targets||[]);if(key===this.feedbackKey)return;this.feedbackKey=key;
    clearLayer(this.feedbackLayer);
    for(const target of event?.targets||[]) {
      const points=feedbackPoints(this.board,{targets:[target]});if(!points.length)continue;
      if(target.kind==='edge') {
        const a=points[0],b=points[1];
        const angle=-Math.atan2(b.z-a.z,b.x-a.x),length=Math.hypot(b.x-a.x,b.z-a.z)*.67;
        // Fine ground rails follow the built road, leave both intersections
        // free, and preserve its painted owner colour and original material.
        for(const side of [-1,1]) {
          const mesh=new THREE.Mesh(this.assets.geometries.box,this.assets.materials.get('feedback')),offset=side*.112;
          mesh.position.set((a.x+b.x)/2+Math.sin(angle)*offset,.323,(a.z+b.z)/2+Math.cos(angle)*offset);mesh.scale.set(length,.012,.018);mesh.rotation.y=angle;mesh.renderOrder=23;this.feedbackLayer.add(mesh);
        }
      } else if(target.kind==='tile') {
        const tile=this.board.tiles[target.id];
        // Trace the actual shared-edge hexagon, not a circle through its trees.
        for(let i=0;i<tile.vertices.length;i++) {
          const va=this.board.vertices[tile.vertices[i]],vb=this.board.vertices[tile.vertices[(i+1)%tile.vertices.length]],a={x:tile.x+(va.x-tile.x)*.94,z:tile.z+(va.z-tile.z)*.94},b={x:tile.x+(vb.x-tile.x)*.94,z:tile.z+(vb.z-tile.z)*.94};
          const mesh=new THREE.Mesh(this.assets.geometries.box,this.assets.materials.get('feedback'));
          mesh.position.set((a.x+b.x)/2,.294,(a.z+b.z)/2);mesh.scale.set(Math.hypot(b.x-a.x,b.z-a.z)*.90,.009,.018);mesh.rotation.y=-Math.atan2(b.z-a.z,b.x-a.x);mesh.renderOrder=23;this.feedbackLayer.add(mesh);
        }
      } else {
        const p=this.board.vertices[target.id],mesh=new THREE.Mesh(this.assets.geometries.ring,this.assets.materials.get('feedback'));
        mesh.position.set(p.x,.323,p.z);mesh.rotation.x=-Math.PI/2;mesh.scale.setScalar(.255);mesh.renderOrder=23;this.feedbackLayer.add(mesh);
      }
    }
    this.renderer.domElement.dataset.feedbackTargets=key;this.invalidate();
  }
  focusFeedback(event,{reducedMotion=false,manual=false}={}) {
    if(this.disposed||this.pointers.size||reducedMotion&&!manual)return false;
    this.followBaseline??=this.camera.position.distanceTo(this.controls.target);
    const plan=planActionCamera(this.board,event,{position:this.camera.position,target:this.controls.target,fov:this.camera.fov,frame:this.viewportFrame,scale:this.boardScale||1,minDistance:Math.max(this.controls.minDistance,this.followBaseline*.86),maxDistance:this.controls.maxDistance});
    if(!plan)return false;
    this.cancelFocus();this.controls.update();this.updateProjection();this.viewMode='focused';this.focusEvent=String(event.id||'');
    const position=new THREE.Vector3(plan.position.x,plan.position.y,plan.position.z),target=new THREE.Vector3(plan.target.x,plan.target.y,plan.target.z);
    if(reducedMotion) {this.camera.position.copy(position);this.controls.target.copy(target);this.controls.update();}
    else this.focusAnimation={start:performance.now(),from:this.camera.position.clone(),fromTarget:this.controls.target.clone(),position,target};
    this.invalidate();return true;
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
    this.controls.minDistance=6*scale;this.controls.update();
    // Orientation/viewport changes must not be undone by the next ambient tick.
    if(this.ambientEnabled&&!this.ambientInterrupted){this.ambientOffset=this.camera.position.clone().sub(this.controls.target);this.ambientOrigin=this.controls.target.clone();this.ambientPhase=0;}
    this.invalidate();
  }
  hit(e) {
    const rect=this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
    this.scene.updateMatrixWorld();this.raycaster.setFromCamera(this.pointer,this.camera);
    // Scenery carries its owning tile ID. The first actual surface therefore
    // chooses that tile, rather than a different flat hex behind a tall tree.
    for(const hit of this.raycaster.intersectObjects([this.land,this.pieces],true)) {
      if(hit.object.isSprite&&hit.object.userData.port===undefined)continue;
      const tile=hit.object.userData.tileIds?.[hit.instanceId];
      return Number.isInteger(tile)?{...hit,object:this.tiles[tile]}:hit;
    }
  }
  pick(e,touch,notify=true,nearest) {
    const rect=this.renderer.domElement.getBoundingClientRect();
    this.scene.updateMatrixWorld();this.camera.updateMatrixWorld();
    // Use screen-space hit regions, independent of DPR or zoom. Ambiguous touches
    // ask for zoom instead of silently selecting the neighboring intersection.
    const candidates=(this.markerTargets||[]).map(marker=>{
      const p=marker.position.clone().project(this.camera);
      return {marker,distance:p.z>=-1&&p.z<=1?Math.hypot(rect.left+(p.x+1)*rect.width/2-e.clientX,rect.top+(1-p.y)*rect.height/2-e.clientY):Infinity};
    }).filter(p=>p.distance<=(touch?22:11)).sort((a,b)=>a.distance-b.distance).filter(({marker})=>this.siteVisible(marker));
    if(candidates.length) {
      if(touch&&candidates[1]&&candidates[1].distance-candidates[0].distance<6) {
        if(notify)this.onHover('相邻落点较近，请双指放大后再点选。');return null;
      }
      return candidates[0].marker.userData;
    }
    const hit=nearest||this.hit(e);return hit?.object.userData.kind?hit.object.userData:null;
  }
  siteVisible(marker) {
    // Occlusion is checked at the visual inlay, independently of the larger
    // screen-space hit disc. A hidden site cannot be clicked through a tree or
    // another player's building. A city upgrade may target its own building.
    const direction=marker.position.clone().sub(this.camera.position),distance=direction.length();
    this.raycaster.set(this.camera.position,direction.normalize());
    this.raycaster.camera=this.camera;
    // Billboard labels render above ground hints. Do not activate a site whose
    // visible centre is covered by a number/port label, either.
    if(this.raycaster.intersectObjects(this.land.children.filter(object=>object.visible&&object.isSprite),false).length)return false;
    const occluders=[...this.land.children,...this.pieces.children].filter(object=>object.visible&&!object.isSprite);
    return !this.raycaster.intersectObjects(occluders,false).some(hit=>{
      if(!hit.object.visible||hit.object.isSprite||hit.distance>=distance-.035)return false;
      if(this.mode==='city'&&hit.object.parent===this.pieces&&Math.hypot(hit.point.x-marker.position.x,hit.point.z-marker.position.z)<.28)return false;
      return true;
    });
  }
  label(key,draw,width=128,height=128) {
    if(!this.assets.textures.has(key)) {
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
      this.assets.textures.set(key,texture);draw(canvas.getContext('2d'),texture);
      this.assets.materials.set(key,new THREE.SpriteMaterial({map:texture,depthTest:false,depthWrite:false,toneMapped:false}));
    }
    const sprite=new THREE.Sprite(this.assets.materials.get(key));sprite.renderOrder=30;return sprite;
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
    const b=state.board;if(!b||this.disposed)return;this.board=b;this.mode=mode;
    const key=JSON.stringify([b.tiles.map(t=>[t.id,t.x,t.z,t.resource,t.number]),b.vertices.map(v=>[v.x,v.z]),b.ports]);
    let changed=false;
    if(key!==this.landKey) {
      this.stopAmbient();this.ambientEnabled=false;this.ambientInterrupted=false;this.ambientOffset=null;this.followBaseline=null;
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
      // A newly created map uses the play canvas's current orientation. The
      // narrow home preview can otherwise carry its low landscape pitch into a
      // portrait game and leave most of the available play area empty.
      this.fitPoints=[...b.vertices.map(v=>({x:v.x,y:.4,z:v.z})),...b.tiles.map(t=>({x:t.x,y:1,z:t.z}))];this.reset({defaultOrientation:true});
    }
    const colors=state.players.map(p=>[p.id,p.color]);
    const pieceKey=JSON.stringify([b.edges.map(e=>e.owner),b.vertices.map(v=>[v.owner,v.level]),colors,state.robber]);
    if(pieceKey!==this.pieceKey) {
      this.pieceKey=pieceKey;clearLayer(this.pieces);this.metrics.pieceBuilds++;changed=true;
      const batch=new Batches(this.assets),color=id=>state.players.find(p=>p.id===id)?.color||'#e57c54';
      const shade=(value,light)=>new THREE.Color(value).offsetHSL(0,0,light).getHex();
      const add=(shape,c,x,y,z,sx,sy,sz,r=0)=>batch.add(shape,c,x,y,z,sx,sy,sz,r,'pieces');
      for(const edge of b.edges.filter(e=>e.owner)) {
        const a=b.vertices[edge.a],v=b.vertices[edge.b],x=(a.x+v.x)/2,z=(a.z+v.z)/2,r=-Math.atan2(v.z-a.z,v.x-a.x);
        add('box',0x203a3e,x,.31,z,.84,.055,.21,r);add('box',0xfff6df,x,.35,z,.81,.05,.17,r);
        add('box',color(edge.owner),x,.40,z,.77,.09,.125,r);add('box',shade(color(edge.owner),.15),x,.451,z,.69,.012,.035,r);
      }
      for(const v of b.vertices.filter(v=>v.owner)) {
        const owner=color(v.owner),dark=0x203a3e,ivory=0xfff5da;
        add('cylinder',dark,v.x,.29,v.z,v.level===2?.235:.205,.04,v.level===2?.235:.205);
        add('cylinder',ivory,v.x,.315,v.z,v.level===2?.215:.185,.035,v.level===2?.215:.185);
        if(v.level===2){
          // A compact stepped tower silhouette contrasts with the village roof.
          add('box',dark,v.x,.35,v.z,.37,.045,.29);add('box',owner,v.x,.475,v.z,.33,.255,.255);
          add('box',owner,v.x-.075,.59,v.z,.17,.40,.255);
          add('box',ivory,v.x-.075,.80,v.z,.205,.045,.30);add('box',shade(owner,.08),v.x-.075,.83,v.z,.17,.035,.26);
          add('box',ivory,v.x+.105,.625,v.z,.18,.04,.285);add('box',shade(owner,.08),v.x+.105,.65,v.z,.15,.035,.25);
          add('box',dark,v.x-.075,.64,v.z+.132,.055,.085,.012);add('box',dark,v.x+.08,.44,v.z+.132,.065,.12,.012);
        }else{
          add('box',dark,v.x,.35,v.z,.29,.04,.27);add('box',owner,v.x,.465,v.z,.27,.23,.25);
          add('box',dark,v.x,.585,v.z,.35,.025,.31);add('roof',shade(owner,-.07),v.x,.665,v.z,.33,.17,.29);
          add('box',ivory,v.x,.56,v.z+.132,.27,.025,.012);add('box',dark,v.x,.415,v.z+.132,.065,.12,.014);
        }
      }
      if(state.robber!==null&&state.robber!==undefined) {
        const t=b.tiles[state.robber];add('cone',0x283e38,t.x,.53,t.z+.4,.14,.4,.14);add('wool',0x283e38,t.x,.8,t.z+.4,.09,.10,.09);
      }
      batch.finish(this.pieces);
    }
    const markerKey=JSON.stringify([mode,state.legal?.[mode]||[]]);
    if(markerKey!==this.markerKey) {
      this.markerKey=markerKey;this.selectSite(null);clearLayer(this.markers);this.metrics.markerBuilds++;this.markerTargets=[];changed=true;
      for(const tile of this.tiles)tile.userData={tile:tile.userData.tile,...(mode==='robber'&&state.legal?.robber.includes(tile.userData.tile)?{kind:'tile',id:tile.userData.tile}:{})};
      const sites=['road','settlement','city'].includes(mode)?state.legal?.[mode]||[]:[];
      const shape=this.assets.geometries[mode==='road'?'box':mode==='city'?'site-city-ring':'site-ring'];
      const layers=[['outline',1.14,20],['marker',1,21]].map(([material,factor,order])=>({mesh:new THREE.InstancedMesh(shape,this.assets.materials.get(material),sites.length),factor,order}));
      const transform=new THREE.Object3D();
      for(const [index,id] of sites.entries()) {
        let x,z,rotation=0;if(mode==='road'){const e=b.edges[id],a=b.vertices[e.a],v=b.vertices[e.b];x=(a.x+v.x)/2;z=(a.z+v.z)/2;rotation=-Math.atan2(v.z-a.z,v.x-a.x);}else({x,z}=b.vertices[id]);
        const marker=new THREE.Object3D();marker.position.set(x,.298,z);
        marker.rotation.y=rotation;
        marker.userData={kind:mode==='road'?'edge':'vertex',id};this.markerTargets.push(marker);
        for(const {mesh,factor} of layers){transform.position.copy(marker.position);if(mode==='road'){transform.rotation.set(0,rotation,0);transform.scale.set(.52*factor,.009,.025*factor);}else{transform.rotation.set(-Math.PI/2,0,0);transform.scale.setScalar(factor);}transform.updateMatrix();mesh.setMatrixAt(index,transform.matrix);}
      }
      for(const {mesh,order} of layers){mesh.renderOrder=order;mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();if(sites.length)this.markers.add(mesh);else mesh.dispose();}
      this.renderer.domElement.dataset.siteShape=mode||'';
    }
    this.targets=[...this.tiles,...this.portTargets];
    if(changed){this.renderer.shadowMap.needsUpdate=true;this.invalidate();}
  }
  dispose() {
    if(this.disposed)return;this.disposed=true;this.onProjectionChange=null;this.stopFrame();this.stopAmbient();this.events.abort();this.observer.disconnect();this.intersection.disconnect();this.controls.dispose();
    for(const group of [this.land,this.pieces,this.markers,this.selectionLayer,this.feedbackLayer])clearLayer(group);
    this.scene.clear();this.sun.shadow.dispose();this.assets.dispose();this.renderer.dispose();this.renderer.forceContextLoss();this.renderer.domElement.remove();
  }
}
