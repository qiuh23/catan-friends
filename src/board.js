import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LABELS } from '../shared/board.js';
import { resourceIllustration } from './icons.js';
const terrain={wood:0x659477,brick:0xc48c69,sheep:0xa9c584,wheat:0xdfc578,ore:0x8b9e9e,desert:0xe2cf9e};
const material=(color,extra={})=>new THREE.MeshStandardMaterial({color,roughness:1,...extra});
const geo={hex:new THREE.CylinderGeometry(.975,.975,.23,6),trunk:new THREE.CylinderGeometry(.045,.065,.22,5),tree:new THREE.ConeGeometry(.19,.52,6),rock:new THREE.DodecahedronGeometry(.23,0),body:new THREE.IcosahedronGeometry(.12,1),road:new THREE.BoxGeometry(.66,.12,.13),house:new THREE.BoxGeometry(.23,.2,.24),roof:new THREE.ConeGeometry(.205,.18,4),city:new THREE.BoxGeometry(.22,.38,.22)};
function mesh(group,geometry,color,x,y,z,scale=1){const m=new THREE.Mesh(geometry,typeof color==='number'||typeof color==='string'?material(color):color);m.position.set(x,y,z);m.scale.setScalar(scale);m.castShadow=true;m.receiveShadow=true;group.add(m);return m;}
function portToken(resource){
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=128;const c=canvas.getContext('2d');
  c.fillStyle='#faf4e3';c.beginPath();c.roundRect(4,4,248,120,18);c.fill();c.strokeStyle='#9bae99';c.lineWidth=4;c.stroke();
  c.fillStyle='#244940';c.textAlign='center';c.textBaseline='middle';c.font='700 53px "Segoe UI",sans-serif';c.fillText(resource==='any'?'3:1':'2:1',resource==='any'?128:174,68);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  if(resource!=='any'){const art=new Image();art.onload=()=>{c.drawImage(art,10,17,94,94);texture.needsUpdate=true;};art.src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(resourceIllustration(resource))}`;}
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false,toneMapped:false}));sprite.scale.set(.9,.45,1);sprite.renderOrder=4;sprite.userData={port:resource};return sprite;
}
function numberToken(number){
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;const c=canvas.getContext('2d');
  c.fillStyle='#f6efd7';c.beginPath();c.arc(128,128,119,0,Math.PI*2);c.fill();c.strokeStyle='#d0bd8f';c.lineWidth=6;c.stroke();
  c.fillStyle=[6,8].includes(number)?'#a93f28':'#263f39';c.textAlign='center';c.textBaseline='middle';c.font='bold 108px "Segoe UI",sans-serif';c.fillText(String(number),128,112);
  const dots=6-Math.abs(7-number);for(let i=0;i<dots;i++){c.beginPath();c.arc(128+(i-(dots-1)/2)*23,192,7,0,Math.PI*2);c.fill();}
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false,toneMapped:false}));sprite.scale.set(.58,.58,1);sprite.renderOrder=5;return sprite;
}
function scenery(tile,group){
  const offsets=[[-.41,.15],[.4,.18],[-.25,-.44],[.27,-.38],[.13,.52]];
  const rand=i=>Math.abs(Math.sin(tile.id*39+i*77));
  offsets.forEach(([x,z],i)=>{
    const px=tile.x+x,pz=tile.z+z;
    if(tile.resource==='wood') {mesh(group,geo.trunk,0x795b41,px,.39,pz);mesh(group,geo.tree,i%2?0x2e624b:0x3e7958,px,.67+rand(i)*.08,pz,.85+rand(i)*.4);}
    if(tile.resource==='ore'){const m=mesh(group,new THREE.ConeGeometry(.25,.55,5),i%2?0x697d82:0x829499,px,.52,pz,1+rand(i)*.5);m.rotation.y=rand(i)*3;mesh(group,new THREE.ConeGeometry(.082,.16,5),0xdce3db,px,m.position.y+.23,pz);}
    if(tile.resource==='brick'){const m=mesh(group,geo.rock,i%2?0xa9674d:0xb67550,px,.36,pz,.7+rand(i));m.scale.y=.65;m.rotation.set(.1,rand(i)*5,.3);}
    if(tile.resource==='wheat'){
      const patch=new THREE.Group();patch.position.set(px,.31,pz);patch.rotation.y=.35;group.add(patch);
      for(let n=0;n<4;n++)mesh(patch,new THREE.BoxGeometry(.035,.055,.25),n%2?0xf6dda0:0xc39c45,(n-1.5)*.07,0,0);
    }
    if(tile.resource==='sheep' && i<4){mesh(group,geo.body,0xf7f3df,px,.39,pz).scale.set(1.4,.85,1);mesh(group,geo.body,0x516356,px+.13,.4,pz,.45);for(const dx of [-.06,.06])mesh(group,new THREE.BoxGeometry(.025,.08,.025),0x576656,px+dx,.3,pz);}
    if(tile.resource==='desert'){const m=mesh(group,geo.rock,0xc3aa74,px,.29,pz,.25+rand(i)*.3);m.scale.y=.4;}
  });
}
function disposeGroup(group){group.traverse(o=>{if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material]){m.map?.dispose();m.dispose();}}if(o.geometry && !Object.values(geo).includes(o.geometry))o.geometry.dispose();});group.clear();}
export class Board {
  constructor(container,onSelect,onHover){
    this.container=container;this.onSelect=onSelect;this.onHover=onHover;this.targets=[];this.frame=0;
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#b8d8d2');
    this.camera=new THREE.PerspectiveCamera(34,1,.1,100);this.camera.position.set(7,10,12);
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1;this.renderer.setClearColor('#b8d8d2');container.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label','可旋转的卡坦岛 3D 棋盘，拖动旋转，滚轮缩放');
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.enablePan=false;this.controls.minDistance=9;this.controls.maxDistance=24;this.controls.minPolarAngle=.15;this.controls.maxPolarAngle=1.18;this.controls.target.set(0,0,0);
    this.scene.add(new THREE.HemisphereLight(0xffffef,0x759f9b,2.2));const sun=new THREE.DirectionalLight(0xfff2d4,2.6);sun.position.set(-5,13,8);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-8,right:8,top:8,bottom:-8});sun.shadow.normalBias=.03;sun.shadow.bias=-.0001;this.scene.add(sun);
    const sea=mesh(this.scene,new THREE.CircleGeometry(100,64),new THREE.MeshBasicMaterial({color:0xb8d8d2,toneMapped:false}),0,-.14,0);sea.rotation.x=-Math.PI/2;sea.castShadow=false;
    // A subtle sculpted sea base carries the physical tabletop island.
    this.seaBase=mesh(this.scene,new THREE.CylinderGeometry(5.8,5.9,.14,96),new THREE.MeshBasicMaterial({color:0xa7cdc7,toneMapped:false}),0,-.03,0);
    this.land=new THREE.Group();this.pieces=new THREE.Group();this.markers=new THREE.Group();this.scene.add(this.land,this.pieces,this.markers);
    this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();
    this.renderer.domElement.addEventListener('pointerdown',e=>this.down={x:e.clientX,y:e.clientY});
    this.renderer.domElement.addEventListener('pointerup',e=>{if(!this.down||Math.hypot(e.clientX-this.down.x,e.clientY-this.down.y)>7)return;const hit=this.hit(e);if(hit?.object.userData.kind)this.onSelect(hit.object.userData);});
    this.renderer.domElement.addEventListener('pointermove',e=>{const hit=this.hit(e);this.renderer.domElement.style.cursor=hit?.object.userData.kind?'pointer':'grab';const t=hit?.object.userData.tile;this.onHover(hit?.object.userData.port!==undefined?`${hit.object.userData.port==='any'?'普通港口 3:1':LABELS[hit.object.userData.port]+'港口 2:1'}`:t===undefined?'':`${LABELS[this.board.tiles[t].resource]}${this.board.tiles[t].number ? ` · ${this.board.tiles[t].number} 点生产` : ' · 不生产资源'}`);});
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(container);this.resize();
    const animate=()=>{this.frame=requestAnimationFrame(animate);this.controls.update();this.renderer.render(this.scene,this.camera);};animate();
  }
  resize(){const w=this.container.clientWidth,h=this.container.clientHeight;if(!w||!h)return;this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h);if(this.fitPoints)this.reset();}
  hit(e){const r=this.renderer.domElement.getBoundingClientRect();this.pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);this.raycaster.setFromCamera(this.pointer,this.camera);return this.raycaster.intersectObjects(this.targets,false)[0];}
  reset(){
    const scale=this.boardScale||1;this.camera.position.set(7*scale,10*scale,12*scale);this.controls.target.set(0,0,0);
    // Fit the real tile and port-label bounds to this canvas, including narrow panels.
    for(let i=0;i<14;i++){
      this.camera.lookAt(this.controls.target);this.camera.updateMatrixWorld();
      const points=(this.fitPoints||[]).map(p=>new THREE.Vector3(p.x,p.y,p.z));
      const right=new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld,0),up=new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld,1);
      for(const p of this.portBounds||[])for(const dx of [-.45,.45])for(const dy of [-.225,.225])points.push(new THREE.Vector3(p.x,p.y,p.z).addScaledVector(right,dx).addScaledVector(up,dy));
      const projected=points.map(p=>p.project(this.camera));
      const factor=Math.max(.1,...projected.map(p=>Math.max(Math.abs(p.x)/.92,Math.abs(p.y)/.88)));
      if(Math.abs(factor-1)<.006)break;this.camera.position.multiplyScalar(Math.max(.7,Math.min(1.35,factor)));
    }
    this.controls.maxDistance=Math.max(24*scale,this.camera.position.length()*1.4);this.controls.update();
    this.renderer.domElement.dataset.camera=JSON.stringify(this.camera.position.toArray());
  }
  set(state,mode){
    const board=state.board;if(!board)return;this.board=board;
    const key=board.tiles.map(t=>`${t.resource}:${t.number}`).join('|');
    if(this.key!==key){this.key=key;disposeGroup(this.land);this.tiles=[];this.portTargets=[];
      const scale=board.tiles.length>19?Math.max(...board.tiles.map(t=>Math.hypot(t.x,t.z)+1.5))/5.8:1;this.seaBase.scale.set(scale,1,scale);this.boardScale=scale;this.controls.minDistance=9*scale;this.controls.maxDistance=24*scale;
      this.fitPoints=[...board.vertices.map(v=>({x:v.x,y:.4,z:v.z})),...board.tiles.map(t=>({x:t.x,y:1.15,z:t.z}))];this.portBounds=[];
      for(const port of board.ports){const a=board.vertices[port.vertices[0]],b=board.vertices[port.vertices[1]],x=(a.x+b.x)/2,z=(a.z+b.z)/2,l=Math.hypot(x,z);this.portBounds.push({x:x+x/l*.65,y:.38,z:z+z/l*.65});}
      this.reset();
      for(const tile of board.tiles){const hex=mesh(this.land,geo.hex,terrain[tile.resource],tile.x,.12,tile.z);hex.userData={tile:tile.id};this.tiles.push(hex);scenery(tile,this.land);
        if(tile.number){const token=numberToken(tile.number);token.position.set(tile.x,.4,tile.z);this.land.add(token);}
      }
      for(const port of board.ports){const a=board.vertices[port.vertices[0]],b=board.vertices[port.vertices[1]],x=(a.x+b.x)/2,z=(a.z+b.z)/2,l=Math.hypot(x,z),px=x+x/l*.65,pz=z+z/l*.65;
        const dock=mesh(this.land,new THREE.BoxGeometry(.27,.06,.7),0xa88e68,(x+px)/2,.13,(z+pz)/2);dock.rotation.y=Math.atan2(px-x,pz-z);
        const text=portToken(port.resource);text.position.set(px,.38,pz);this.land.add(text);this.portTargets.push(text);
      }
    }
    disposeGroup(this.pieces);disposeGroup(this.markers);
    const color=id=>state.players.find(p=>p.id===id)?.color||'#e57c54';
    for(const e of board.edges.filter(e=>e.owner)){const a=board.vertices[e.a],b=board.vertices[e.b],r=mesh(this.pieces,geo.road,color(e.owner),(a.x+b.x)/2,.32,(a.z+b.z)/2);r.rotation.y=-Math.atan2(b.z-a.z,b.x-a.x);}
    for(const v of board.vertices.filter(v=>v.owner)){
      const group=new THREE.Group();group.position.set(v.x,.3,v.z);this.pieces.add(group);
      mesh(group,geo.house,color(v.owner),0,.1,0);const roof=mesh(group,geo.roof,color(v.owner),0,.27,0);roof.rotation.y=Math.PI/4;
      if(v.level===2){mesh(group,geo.city,color(v.owner),.2,.19,0);const roof2=mesh(group,geo.roof,color(v.owner),.2,.45,0);roof2.rotation.y=Math.PI/4;}
    }
    if(state.robber!==null && state.robber!==undefined){const t=board.tiles[state.robber];mesh(this.pieces,new THREE.ConeGeometry(.16,.45,12),0x364b49,t.x,.55,t.z);mesh(this.pieces,new THREE.SphereGeometry(.105,12,8),0x364b49,t.x,.84,t.z);}
    this.targets=[...this.tiles,...(this.portTargets||[])];
    for(const t of this.tiles)t.userData={tile:t.userData.tile,...(mode==='robber' && state.legal?.robber.includes(t.userData.tile)?{kind:'tile',id:t.userData.tile}:{})};
    const sites=state.legal?.[mode]||[];
    if(['settlement','city','road'].includes(mode))for(const id of sites){
      let x,z;if(mode==='road'){const e=board.edges[id],a=board.vertices[e.a],b=board.vertices[e.b];x=(a.x+b.x)/2;z=(a.z+b.z)/2;}else{x=board.vertices[id].x;z=board.vertices[id].z;}
      const marker=mesh(this.markers,new THREE.CylinderGeometry(mode==='road'?.13:.15,mode==='road'?.13:.15,.055,24),material(0xfff1a5,{emissive:0xffd573,emissiveIntensity:.3}),x,.36,z);marker.userData={kind:mode==='road'?'edge':'vertex',id};marker.renderOrder=3;this.targets.unshift(marker);
    }
  }
  dispose(){cancelAnimationFrame(this.frame);this.observer.disconnect();this.controls.dispose();for(const group of [this.land,this.pieces,this.markers])disposeGroup(group);this.renderer.dispose();this.renderer.domElement.remove();}
}

export class FlatBoard {
  constructor(container,onSelect,onHover){this.container=container;this.onSelect=onSelect;this.onHover=onHover;}
  reset(){}
  set(state,mode){
    const b=state.board;if(!b)return;const pos=v=>`${v.x*50+300},${v.z*50+290}`,color=id=>state.players.find(p=>p.id===id)?.color||'#173b3d';
    const tiles=b.tiles.map(t=>{const x=t.x*50+300,y=t.z*50+290,hot=[6,8].includes(t.number),dots=t.number?6-Math.abs(7-t.number):0;return `<g data-tile="${t.id}" role="img" aria-label="${LABELS[t.resource]}${t.number?'，'+t.number+' 点生产':'，不生产资源'}"><title>${LABELS[t.resource]}${t.number?' · '+t.number+' 点':''}</title><polygon points="${t.vertices.map(id=>pos(b.vertices[id])).join(' ')}" fill="#${terrain[t.resource].toString(16)}" stroke="#f2f0df" stroke-width="2"/><polygon points="${t.vertices.map(id=>pos(b.vertices[id])).join(' ')}" fill="url(#terrain-${t.resource})"/>${t.resource!=='desert'?resourceIllustration(t.resource).replace('<svg ',`<svg x="${x-13}" y="${y-42}" width="26" height="26" `):''}${t.number?`<circle cx="${x}" cy="${y+3}" r="18" fill="#fff5d9" stroke="#b39c6f" stroke-width="1.5"/><text x="${x}" y="${y+8}" text-anchor="middle" font-size="19" font-weight="700" fill="${hot?'#a93f28':'#173b3d'}">${t.number}</text>${Array.from({length:dots},(_,i)=>`<circle cx="${x+(i-(dots-1)/2)*4}" cy="${y+15}" r="1.1" fill="${hot?'#a93f28':'#173b3d'}"/>`).join('')}`:''}${state.robber===t.id?`<rect x="${x-21}" y="${y+22}" width="42" height="17" rx="6" fill="#283e39"/><text x="${x}" y="${y+34}" text-anchor="middle" font-size="11" fill="#fff7e4">强盗</text>`:''}</g>`;}).join('');
    const roads=b.edges.filter(e=>e.owner).map(e=>`<line x1="${b.vertices[e.a].x*50+300}" y1="${b.vertices[e.a].z*50+290}" x2="${b.vertices[e.b].x*50+300}" y2="${b.vertices[e.b].z*50+290}" stroke="${color(e.owner)}" stroke-width="8"/>`).join('');
    const buildings=b.vertices.filter(v=>v.owner).map(v=>`<rect x="${v.x*50+293}" y="${v.z*50+283}" width="${v.level===2?20:14}" height="14" fill="${color(v.owner)}" stroke="white" stroke-width="2"/>`).join('');
    const markers=(state.legal?.[mode]||[]).filter(()=>['road','settlement','city'].includes(mode)).map(id=>{let x,z;if(mode==='road'){const e=b.edges[id];x=(b.vertices[e.a].x+b.vertices[e.b].x)/2;z=(b.vertices[e.a].z+b.vertices[e.b].z)/2;}else({x,z}=b.vertices[id]);return `<circle data-id="${id}" cx="${x*50+300}" cy="${z*50+290}" r="9" fill="#fff1a5" stroke="#173b3d" stroke-width="2"/>`;}).join('');
    const ports=b.ports.map(p=>{const a=b.vertices[p.vertices[0]],c=b.vertices[p.vertices[1]],x=(a.x+c.x)/2,z=(a.z+c.z)/2,l=Math.hypot(x,z),px=(x+x/l*.65)*50+300,py=(z+z/l*.65)*50+290;return `<g role="img" aria-label="${p.resource==='any'?'普通港口 3:1':LABELS[p.resource]+'港口 2:1'}"><title>${p.resource==='any'?'普通港口 3:1':LABELS[p.resource]+'港口 2:1'}</title><rect x="${px-30}" y="${py-14}" width="60" height="28" rx="6" fill="#faf4e3" stroke="#9bae99"/>${p.resource!=='any'?resourceIllustration(p.resource).replace('<svg ',`<svg x="${px-28}" y="${py-13}" width="26" height="26" `):''}<text x="${p.resource==='any'?px:px+12}" y="${py+5}" text-anchor="middle" font-size="14" font-weight="600" fill="#173b3d">${p.resource==='any'?'3:1':'2:1'}</text></g>`;}).join('');
    const bounds=b.tiles.length>19?`${Math.min(...b.vertices.map(v=>v.x))*50+245} ${Math.min(...b.vertices.map(v=>v.z))*50+235} ${(Math.max(...b.vertices.map(v=>v.x))-Math.min(...b.vertices.map(v=>v.x)))*50+110} ${(Math.max(...b.vertices.map(v=>v.z))-Math.min(...b.vertices.map(v=>v.z)))*50+110}`:'0 0 600 580';
    this.container.innerHTML=`<svg viewBox="${bounds}" role="group" aria-label="卡坦岛二维棋盘，Tab 选择位置，回车落子"><defs><pattern id="terrain-wood" width="14" height="14" patternUnits="userSpaceOnUse"><path d="m3 2 4 8H0ZM10 8l3 5H7Z" fill="#244e3c" opacity=".14"/></pattern><pattern id="terrain-brick" width="18" height="12" patternUnits="userSpaceOnUse"><path d="M0 6h18M9 0v6M4 6v6M14 6v6" stroke="#754d35" opacity=".16" fill="none"/></pattern><pattern id="terrain-wheat" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M6 12V1M6 5 2 2M6 8l4-4" stroke="#917126" opacity=".22" fill="none"/></pattern><pattern id="terrain-sheep" width="18" height="16" patternUnits="userSpaceOnUse"><path d="M2 13q4-4 8 0M8 5q3-3 6 0" stroke="#456d35" opacity=".17" fill="none"/></pattern><pattern id="terrain-ore" width="18" height="16" patternUnits="userSpaceOnUse"><path d="m1 15 6-11 7 11M5 8l2-4 3 5" stroke="#405c68" opacity=".19" fill="none"/></pattern><pattern id="terrain-desert" width="22" height="14" patternUnits="userSpaceOnUse"><path d="M1 9q5-6 10 0t10 0" stroke="#9d8452" opacity=".18" fill="none"/></pattern></defs>${tiles}${ports}${roads}${buildings}${markers}</svg>`;
    const activate=(el,kind,id,name)=>{el.setAttribute('role','button');el.setAttribute('tabindex','0');el.setAttribute('aria-label',name);el.onclick=()=>this.onSelect({kind,id});el.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();el.onclick();}};};
    for(const el of this.container.querySelectorAll('[data-id]'))activate(el,mode==='road'?'edge':'vertex',Number(el.dataset.id),`${mode==='road'?'道路':'交叉点'} ${Number(el.dataset.id)+1}`);
    if(mode==='robber')for(const el of this.container.querySelectorAll('[data-tile]'))if(state.legal.robber.includes(Number(el.dataset.tile)))activate(el,'tile',Number(el.dataset.tile),`将强盗移动至 ${LABELS[b.tiles[Number(el.dataset.tile)].resource]}地块 ${Number(el.dataset.tile)+1}`);
  }
  dispose(){this.container.innerHTML='';}
}
