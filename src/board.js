import {portGeometry} from './ports.js';
export { Board } from './board3d.js';
import { LABELS } from '../shared/board.js';
import { resourceIllustration } from './icons.js';
import { terrain } from './terrain.js';
import { boardFrame } from './board-frame.js';
import { feedbackPoints } from './action-camera.js';
import { feedbackAnchor, mapViewKey } from './map-feedback.js';

const buildingPath=(kind,x,y,scale=1)=>{
  const points=kind==='city'?[[-12,9],[12,9],[12,-2],[4,-2],[4,-13],[-5,-13],[-5,-5],[-12,-5]]:[[-9,8],[9,8],[9,-1],[0,-10],[-9,-1]];
  return points.map(([px,py],i)=>`${i?'L':'M'}${x+px*scale} ${y+py*scale}`).join('')+'Z';
};

export class FlatBoard {
  constructor(container,onSelect,onHover){
    this.container=container;this.onSelect=onSelect;this.onHover=onHover;
    this.zoom=1;this.pan={x:0,y:0};this.pointers=new Map();this.events=new AbortController();
    const options={signal:this.events.signal};
    container.addEventListener('pointerdown',e=>{
      if(!e.target.closest('svg'))return;
      this.cancelFocus();
      if(!this.pointers.size){this.suppressClick=false;this.pointerManual=false;}
      this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(this.pointers.size===1){this.gesture={kind:'pan',x:e.clientX,y:e.clientY,pan:{...this.pan}};const candidates=this.siteCandidates(e.clientX,e.clientY,e.pointerType==='touch');this.selectSite(candidates[0]&&(!candidates[1]||candidates[1].distance-candidates[0].distance>=6)?candidates[0].el:null);}
      else {const [a,b]=[...this.pointers.values()];this.gesture={kind:'pinch',distance:Math.hypot(a.x-b.x,a.y-b.y),zoom:this.zoom};this.suppressClick=true;this.selectSite(null);this.manualInput();}
    },options);
    window.addEventListener('pointermove',e=>{
      if(!this.pointers.has(e.pointerId))return;
      this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const g=this.gesture;
      if(this.pointers.size===2&&g?.kind==='pinch') {
        const [a,b]=[...this.pointers.values()],distance=Math.hypot(a.x-b.x,a.y-b.y),next=g.zoom*distance/(g.distance||1);
        this.zoomAt(next/this.zoom,(a.x+b.x)/2,(a.y+b.y)/2);
      } else if(this.pointers.size===1&&g?.kind==='pan') {
        const dx=e.clientX-g.x,dy=e.clientY-g.y;
        if(Math.hypot(dx,dy)>3&&!this.pointerManual){this.pointerManual=true;this.selectSite(null);this.manualInput();}
        if(Math.hypot(dx,dy)>7)this.suppressClick=true;
        if(this.suppressClick){this.pan={x:g.pan.x+dx/this.scale,y:g.pan.y+dy/this.scale};this.resize();}
      }
    },options);
    const release=e=>{this.pointers.delete(e.pointerId);if(e.type==='pointercancel'){this.suppressClick=true;this.selectSite(null);}if(!this.pointers.size)this.gesture=null;};
    window.addEventListener('pointerup',release,options);window.addEventListener('pointercancel',release,options);
    container.addEventListener('wheel',e=>{e.preventDefault();this.manualInput();this.zoomAt(Math.exp(-e.deltaY*.0015),e.clientX,e.clientY);},{...options,passive:false});
    container.addEventListener('keydown',e=>{
      if(['+','=','-','0'].includes(e.key)){e.preventDefault();this.manualInput();if(e.key==='0')this.reset();else this.zoomAt(e.key==='-'?1/1.25:1.25);}
    },options);
    this.observer=new ResizeObserver(()=>{this.cancelFocus();this.resize();});this.observer.observe(container);
  }
  reset(){this.cancelFocus();this.followZoomBaseline=null;this.zoom=1;this.pan={x:0,y:0};this.resize();}
  zoomBy(factor){if(Number.isFinite(factor)&&factor>0){this.manualInput();this.zoomAt(factor);}}
  manualInput(){this.cancelFocus();this.followZoomBaseline=null;this.onManual?.();}
  cancelFocus(){cancelAnimationFrame(this.focusFrame);this.focusFrame=0;}
  selectSite(el){
    if(!el?.hasAttribute('data-id')&&!el?.hasAttribute('data-port'))el=null;
    const port=el?.hasAttribute('data-port')?Number(el.dataset.port):el&&this.mode!=='road'?this.state.board.ports.find(p=>p.vertices.includes(Number(el.dataset.id)))?.id:null;
    for(const entry of this.container.querySelectorAll('[data-port]'))entry.dataset.selected=String(Number(entry.dataset.port)===port);
    for(const site of this.container.querySelectorAll('[data-id]')){
      const selected=site===el;site.dataset.selected=String(selected);
      site.querySelector('[data-marker-fill]')?.setAttribute(this.mode==='road'?'fill':'stroke',selected?'#687f63':'#9d8c55');
      site.querySelector('[data-marker-rim]')?.setAttribute('opacity',selected?'1':'0');
    }
    const svg=this.container.querySelector('svg');if(svg)svg.dataset.selectedSite=el?`${this.mode==='road'?'edge':'vertex'}:${el.dataset.id}`:'';
  }
  siteCandidates(clientX,clientY,touch=false) {
    return [...this.container.querySelectorAll('[data-id]')].map(el=>{
      const center=new DOMPoint(Number(el.getAttribute('cx')),Number(el.getAttribute('cy'))).matrixTransform(el.getScreenCTM());
      return {el,distance:Math.hypot(center.x-clientX,center.y-clientY)};
    }).filter(p=>p.distance<=(touch?22:11)).sort((a,b)=>a.distance-b.distance);
  }
  point(x,z){return this.landscape?{x:z*50+300,y:-x*50+290}:{x:x*50+300,y:z*50+290};}
  projectFeedbackTarget(target) {
    const anchor=feedbackAnchor(this.state?.board,target),svg=this.container.querySelector('svg'),matrix=svg?.getScreenCTM();
    if(!anchor||!matrix)return null;
    const local=this.point(anchor.x,anchor.z),screen=new DOMPoint(local.x,local.y).matrixTransform(matrix),rect=this.container.getBoundingClientRect();
    const x=screen.x-rect.left,y=screen.y-rect.top;
    return {x,y,visible:Number.isFinite(x)&&Number.isFinite(y)&&x>=0&&y>=0&&x<=rect.width&&y<=rect.height};
  }
  projectNumberObstacles() {
    const matrix=this.container.querySelector('svg')?.getScreenCTM(),rect=this.container.getBoundingClientRect();
    if(!matrix||!this.state?.board)return [];
    const rx=18*Math.hypot(matrix.a,matrix.c)+2,ry=18*Math.hypot(matrix.b,matrix.d)+2;
    return this.state.board.tiles.filter(tile=>tile.number).map(tile=>{
      const p=this.point(tile.x,tile.z),center=new DOMPoint(p.x,p.y+3).matrixTransform(matrix);
      return {x:center.x-rect.left-rx,y:center.y-rect.top-ry,width:rx*2,height:ry*2};
    });
  }
  exportView(){return {kind:'2d',mapKey:mapViewKey(this.state?.board),zoom:this.zoom,pan:{...this.pan},landscape:this.landscape};}
  importView(view) {
    if(view?.kind!=='2d'||view.mapKey!==mapViewKey(this.state?.board)||!Number.isFinite(view.zoom)||view.zoom<1||view.zoom>4||!Number.isFinite(view.pan?.x)||!Number.isFinite(view.pan?.y))return false;
    this.cancelFocus();this.followZoomBaseline=null;this.zoom=view.zoom;this.pan={...view.pan};
    if(view.landscape!==this.landscape)this.pan=this.landscape?{x:this.pan.y,y:-this.pan.x}:{x:-this.pan.y,y:this.pan.x};
    this.resize();return true;
  }
  setFeedback(event,{reducedMotion=this.reducedMotion??false}={}) {
    this.feedback=event;this.reducedMotion=reducedMotion;
    const svg=this.container.querySelector('svg');if(!svg||!this.state?.board)return;
    let layer=svg.querySelector('[data-feedback-layer]');
    if(!layer){layer=document.createElementNS('http://www.w3.org/2000/svg','g');layer.setAttribute('data-feedback-layer','');layer.setAttribute('pointer-events','none');layer.setAttribute('aria-hidden','true');svg.append(layer);}
    const b=this.state.board;
    layer.innerHTML=(event?.targets||[]).map(target=>{
      const points=feedbackPoints(b,{targets:[target]});if(!points.length)return '';
      if(target.kind==='edge') {const a=this.point(points[0].x,points[0].z),c=this.point(points[1].x,points[1].z),length=Math.hypot(c.x-a.x,c.y-a.y),angle=Math.atan2(c.y-a.y,c.x-a.x)*180/Math.PI;return `<g transform="translate(${(a.x+c.x)/2} ${(a.y+c.y)/2}) rotate(${angle})"><rect x="${-length*.34}" y="-7" width="${length*.68}" height="14" rx="2" fill="none" stroke="#628f7c" stroke-width="1.6" stroke-dasharray="6 3"/></g>`;}
      if(target.kind==='tile'){const tile=b.tiles[target.id],path=tile.vertices.map(id=>{const v=b.vertices[id],p=this.point(tile.x+(v.x-tile.x)*.94,tile.z+(v.z-tile.z)*.94);return `${p.x},${p.y}`;}).join(' ');return `<polygon class="${['robber','steal','blocked'].includes(event.targetKinds?.[`${target.kind}:${target.id}`]||event.kind)?'robber-outline':'production-outline'}" points="${path}" fill="none" stroke="#d3ac54" stroke-width="4"/>`;}
      const p=this.point(points[0].x,points[0].z);return `<circle cx="${p.x}" cy="${p.y}" r="14" fill="none" stroke="#628f7c" stroke-width="1.8" stroke-dasharray="5 3"/>`;
    }).join('');
    svg.dataset.feedbackTargets=JSON.stringify(event?.targets||[]);
  }
  focusFeedback(event,{reducedMotion=false,manual=false}={}) {
    if(this.pointers.size||reducedMotion&&!manual)return false;
    const points=feedbackPoints(this.state?.board,event).map(p=>this.point(p.x,p.z)),bounds=this.contentBounds;if(!points.length||!bounds)return false;
    const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y)),maxY=Math.max(...points.map(p=>p.y));
    const f=boardFrame(this.container.clientWidth,this.container.clientHeight,this.padding),baseScale=Math.min(f.width/bounds.width,f.height/bounds.height)*.96;
    this.followZoomBaseline??=this.zoom;
    const zoom=Math.max(1,Math.min(2.5,this.followZoomBaseline*1.16,f.width/(maxX-minX+100)/baseScale,f.height/(maxY-minY+100)/baseScale));
    const pan={x:bounds.x+bounds.width/2-(minX+maxX)/2,y:bounds.y+bounds.height/2-(minY+maxY)/2},from={pan:{...this.pan},zoom:this.zoom};
    this.cancelFocus();
    if(reducedMotion){this.pan=pan;this.zoom=zoom;this.resize();return true;}
    const start=performance.now(),step=now=>{const t=Math.min(1,(now-start)/450),ease=t*t*(3-2*t);this.pan={x:from.pan.x+(pan.x-from.pan.x)*ease,y:from.pan.y+(pan.y-from.pan.y)*ease};this.zoom=from.zoom+(zoom-from.zoom)*ease;this.resize();this.focusFrame=t<1?requestAnimationFrame(step):0;};
    this.focusFrame=requestAnimationFrame(step);return true;
  }
  zoomAt(factor,clientX,clientY) {
    const svg=this.container.querySelector('svg');if(!svg)return;
    const rect=svg.getBoundingClientRect(),x=clientX==null ? .5 : (clientX-rect.left)/rect.width,y=clientY==null ? .5 : (clientY-rect.top)/rect.height;
    const before={x:svg.viewBox.baseVal.x+x*svg.viewBox.baseVal.width,y:svg.viewBox.baseVal.y+y*svg.viewBox.baseVal.height};
    this.zoom=Math.max(1,Math.min(4,this.zoom*factor));this.resize();
    this.pan.x+=svg.viewBox.baseVal.x+x*svg.viewBox.baseVal.width-before.x;
    this.pan.y+=svg.viewBox.baseVal.y+y*svg.viewBox.baseVal.height-before.y;this.resize();
  }
  setViewportPadding(padding={}) {
    const key=JSON.stringify([padding.top||0,padding.right||0,padding.bottom||0,padding.left||0]);
    if(key===this.paddingKey)return;this.paddingKey=key;this.padding=padding;this.cancelFocus();this.resize();
  }
  resize() {
    const svg=this.container.querySelector('svg'),bounds=this.contentBounds,w=this.container.clientWidth,h=this.container.clientHeight;
    if(!svg||!bounds||!w||!h)return;
    if(this.landscape!==(w>h)&&this.state){this.key=null;this.set(this.state,this.mode);return;}
    const f=boardFrame(w,h,this.padding),scale=this.scale=Math.min(f.width/bounds.width,f.height/bounds.height)*.96*this.zoom;
    const x=bounds.x-f.left/scale-(f.width/scale-bounds.width)/2-this.pan.x,y=bounds.y-f.top/scale-(f.height/scale-bounds.height)/2-this.pan.y;
    svg.setAttribute('viewBox',`${x} ${y} ${w/scale} ${h/scale}`);
    this.onProjectionChange?.();
  }
  set(state,mode){
    const b=state.board;if(!b)return;
    if(Boolean(state.homeDemo)!==Boolean(this.homeShowcase)){this.zoom=1;this.pan={x:0,y:0};this.homeShowcase=Boolean(state.homeDemo);}
    this.state=state;this.mode=mode;
    const mapKey=mapViewKey(b);if(mapKey!==this.mapKey){this.mapKey=mapKey;this.followZoomBaseline=null;}
    const landscape=this.container.clientWidth>this.container.clientHeight;
    if(this.landscape!==undefined&&this.landscape!==landscape)this.pan=landscape?{x:this.pan.y,y:-this.pan.x}:{x:-this.pan.y,y:this.pan.x};
    this.landscape=landscape;
    const key=JSON.stringify([b,state.robber,state.players.map(p=>[p.id,p.color]),mode,state.legal?.[mode],landscape]);if(key===this.key)return;this.key=key;
    const point=(x,z)=>landscape?{x:z*50+300,y:-x*50+290}:{x:x*50+300,y:z*50+290};
    const pos=v=>{const p=point(v.x,v.z);return `${p.x},${p.y}`;},color=id=>state.players.find(p=>p.id===id)?.color||'#173b3d';
    const tiles=b.tiles.map(t=>{const {x,y}=point(t.x,t.z),hot=[6,8].includes(t.number),dots=t.number?6-Math.abs(7-t.number):0;return `<g data-tile="${t.id}" role="img" aria-label="${LABELS[t.resource]}${t.number?'，'+t.number+' 点生产':'，不生产资源'}"><title>${LABELS[t.resource]}${t.number?' · '+t.number+' 点':''}</title><polygon points="${t.vertices.map(id=>pos(b.vertices[id])).join(' ')}" fill="#${terrain[t.resource].toString(16)}" stroke="#f2f0df" stroke-width="2"/><polygon points="${t.vertices.map(id=>pos(b.vertices[id])).join(' ')}" fill="url(#terrain-${t.resource})"/>${t.resource!=='desert'?resourceIllustration(t.resource).replace('<svg ',`<svg x="${x-13}" y="${y-42}" width="26" height="26" `):''}${t.number?`<circle cx="${x}" cy="${y+3}" r="18" fill="#fff5d9" stroke="#b39c6f" stroke-width="1.5"/><text x="${x}" y="${y+8}" text-anchor="middle" font-size="19" font-weight="700" fill="${hot?'#a93f28':'#173b3d'}">${t.number}</text>${Array.from({length:dots},(_,i)=>`<circle cx="${x+(i-(dots-1)/2)*4}" cy="${y+15}" r="1.1" fill="${hot?'#a93f28':'#173b3d'}"/>`).join('')}`:''}${state.robber===t.id?`<rect x="${x-21}" y="${y+22}" width="42" height="17" rx="6" fill="#283e39"/><text x="${x}" y="${y+34}" text-anchor="middle" font-size="11" fill="#fff7e4">强盗</text>`:''}</g>`;}).join('');
    const roads=b.edges.filter(e=>e.owner).map(e=>{const a=point(b.vertices[e.a].x,b.vertices[e.a].z),c=point(b.vertices[e.b].x,b.vertices[e.b].z),path=`M${a.x+(c.x-a.x)*.10} ${a.y+(c.y-a.y)*.10}L${c.x+(a.x-c.x)*.10} ${c.y+(a.y-c.y)*.10}`;return `<g role="img" aria-label="道路"><path d="${path}" stroke="#203a3e" stroke-width="12" stroke-linecap="round"/><path d="${path}" stroke="#fff5da" stroke-width="9" stroke-linecap="round"/><path d="${path}" stroke="${color(e.owner)}" stroke-width="6" stroke-linecap="round"/></g>`;}).join('');
    const buildings=b.vertices.filter(v=>v.owner).map(v=>{const {x,y}=point(v.x,v.z),kind=v.level===2?'city':'settlement',path=buildingPath(kind,x,y);return `<g data-building="${kind}" role="img" aria-label="${kind==='city'?'城市':'村庄'}"><path d="${path}" fill="#fff5da" stroke="#203a3e" stroke-width="5" stroke-linejoin="round"/><path d="${path}" fill="${color(v.owner)}" stroke="#fff5da" stroke-width="1.8" stroke-linejoin="round"/>${kind==='settlement'?`<path d="M${x-8} ${y-1}L${x} ${y-9}L${x+8} ${y-1}" fill="none" stroke="#203a3e" stroke-width="2"/>`:`<path d="M${x-4} ${y-5}V${y-11}M${x+3} ${y-2}H${x+10}" fill="none" stroke="#fff5da" stroke-width="2"/>`}<path d="M${x-2} ${y+7}V${y+1}H${x+2}V${y+7}" fill="#203a3e"/></g>`;}).join('');
    const markers=(state.legal?.[mode]||[]).filter(()=>['road','settlement','city'].includes(mode)).map(id=>{
      let x,z,shape;if(mode==='road'){const e=b.edges[id],a=point(b.vertices[e.a].x,b.vertices[e.a].z),c=point(b.vertices[e.b].x,b.vertices[e.b].z);x=(b.vertices[e.a].x+b.vertices[e.b].x)/2;z=(b.vertices[e.a].z+b.vertices[e.b].z)/2;const angle=Math.atan2(c.y-a.y,c.x-a.x)*180/Math.PI;shape=`<g transform="rotate(${angle} ${point(x,z).x} ${point(x,z).y})"><rect x="${point(x,z).x-14}" y="${point(x,z).y-3.5}" width="28" height="7" rx="1.5" fill="none" stroke="#687f63" stroke-width="1.2" opacity="0" data-marker-rim/><rect x="${point(x,z).x-13}" y="${point(x,z).y-.7}" width="26" height="1.4" rx=".7" fill="#9d8c55" data-marker-fill/></g>`;}
      else {({x,z}=b.vertices[id]);const p=point(x,z);shape=`<circle cx="${p.x}" cy="${p.y}" r="${mode==='city'?15:10}" fill="none" stroke="#687f63" stroke-width="1.3" opacity="0" data-marker-rim/><circle cx="${p.x}" cy="${p.y}" r="${mode==='city'?12:5.8}" fill="none" stroke="#9d8c55" stroke-width="1.4" data-marker-fill/>`;}
      const p=point(x,z);return `<g data-id="${id}" data-site-shape="${mode}" data-selected="false" cx="${p.x}" cy="${p.y}"><circle cx="${p.x}" cy="${p.y}" r="13" fill="transparent"/>${shape}</g>`;
    }).join('');
    const ports=b.ports.map(p=>{const g=portGeometry(b,p),{x:px,y:py}=point(g.label.x,g.label.z),name=p.resource==='any'?'普通港口 3:1':LABELS[p.resource]+'港口 2:1';
      const arms=g.arms.map(arm=>{const a=point(arm.from.x,arm.from.z),c=point(arm.to.x,arm.to.z),v=point(b.vertices[arm.vertex].x,b.vertices[arm.vertex].z),color=state.players.find(p=>p.id===arm.owner)?.color||'#ab8d62';return `<line x1="${a.x}" y1="${a.y}" x2="${c.x}" y2="${c.y}" stroke="#725b40" stroke-width="9"/><line x1="${a.x}" y1="${a.y}" x2="${c.x}" y2="${c.y}" stroke="${color}" stroke-width="5"/><circle cx="${v.x}" cy="${v.y}" r="${arm.owner?10:7}" fill="none" stroke="${color}" stroke-width="2"/>`;}).join('');
      return `<g data-port="${p.id}" role="button" tabindex="0" aria-label="${name}，落点 ${p.vertices.map(id=>id+1).join('、')}"><title>${name}</title>${arms}<rect x="${px-30}" y="${py-14}" width="60" height="28" rx="6" fill="#faf4e3" stroke="#9bae99"/>${p.resource!=='any'?resourceIllustration(p.resource).replace('<svg ',`<svg x="${px-28}" y="${py-13}" width="26" height="26" `):''}<text x="${p.resource==='any'?px:px+12}" y="${py+5}" text-anchor="middle" font-size="14" font-weight="600" fill="#173b3d">${p.resource==='any'?'3:1':'2:1'}</text></g>`;}).join('');
    const extents=b.vertices.map(v=>point(v.x,v.z));
    for(const p of b.ports){const g=portGeometry(b,p),{x:px,y:py}=point(g.label.x,g.label.z);extents.push({x:px-32,y:py-16},{x:px+32,y:py+16});}
    const minX=Math.min(...extents.map(p=>p.x))-8,minY=Math.min(...extents.map(p=>p.y))-8,maxX=Math.max(...extents.map(p=>p.x))+8,maxY=Math.max(...extents.map(p=>p.y))+8;
    this.contentBounds={x:minX,y:minY,width:maxX-minX,height:maxY-minY};
    const bounds=`${minX} ${minY} ${maxX-minX} ${maxY-minY}`;
    this.container.innerHTML=`<svg viewBox="${bounds}" role="group" aria-label="卡坦岛二维棋盘，Tab 选择位置，回车落子"><defs><pattern id="terrain-wood" width="14" height="14" patternUnits="userSpaceOnUse"><path d="m3 2 4 8H0ZM10 8l3 5H7Z" fill="#244e3c" opacity=".14"/></pattern><pattern id="terrain-brick" width="18" height="12" patternUnits="userSpaceOnUse"><path d="M0 6h18M9 0v6M4 6v6M14 6v6" stroke="#754d35" opacity=".16" fill="none"/></pattern><pattern id="terrain-wheat" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M6 12V1M6 5 2 2M6 8l4-4" stroke="#917126" opacity=".22" fill="none"/></pattern><pattern id="terrain-sheep" width="18" height="16" patternUnits="userSpaceOnUse"><path d="M2 13q4-4 8 0M8 5q3-3 6 0" stroke="#456d35" opacity=".17" fill="none"/></pattern><pattern id="terrain-ore" width="18" height="16" patternUnits="userSpaceOnUse"><path d="m1 15 6-11 7 11M5 8l2-4 3 5" stroke="#405c68" opacity=".19" fill="none"/></pattern><pattern id="terrain-desert" width="22" height="14" patternUnits="userSpaceOnUse"><path d="M1 9q5-6 10 0t10 0" stroke="#9d8452" opacity=".18" fill="none"/></pattern></defs>${tiles}${ports}${roads}${buildings}${markers}</svg>`;
    this.resize();
    const svg=this.container.querySelector('svg');svg.style.touchAction='none';svg.setAttribute('tabindex','0');svg.setAttribute('aria-label','卡坦岛二维棋盘，拖动平移，双指或加减键缩放；Tab 选择位置，回车落子，0 复位');
    const activate=(el,kind,id,name)=>{el.setAttribute('role','button');el.setAttribute('tabindex','0');el.setAttribute('aria-label',name);el.onclick=e=>{if(e?.detail&&this.suppressClick)return;this.selectSite(el.hasAttribute('data-id')||el.hasAttribute('data-port')?el:null);if(kind==='tile'||kind==='port'||!e||e.detail===0)this.onSelect({kind,id});};el.onfocus=()=>this.selectSite(el);el.onblur=()=>this.selectSite(null);el.onpointerenter=()=>this.selectSite(el);el.onpointerleave=()=>{if(document.activeElement!==el)this.selectSite(null);};el.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();el.onclick();}};};
    for(const el of this.container.querySelectorAll('[data-id]'))activate(el,mode==='road'?'edge':'vertex',Number(el.dataset.id),`${mode==='road'?'铺设道路':mode==='city'?'升级城市':'建造村庄'} · 位置 ${Number(el.dataset.id)+1}`);
    this.container.querySelector('svg').onclick=e=>{
      if(e.detail===0||this.suppressClick)return;
      const candidates=this.siteCandidates(e.clientX,e.clientY,e.pointerType==='touch');
      if(!candidates.length){if(!this.pointerManual&&!e.target.closest('[role="button"]'))this.onBlankTap?.();return;}
      if(e.pointerType==='touch'&&candidates[1]&&candidates[1].distance-candidates[0].distance<6){this.onHover('相邻落点较近，请放大棋盘后再点选。');return;}
      this.selectSite(candidates[0].el);this.onSelect({kind:mode==='road'?'edge':'vertex',id:Number(candidates[0].el.dataset.id)});
    };
    for(const el of this.container.querySelectorAll('[data-port]')){activate(el,'port',Number(el.dataset.port),el.getAttribute('aria-label'));el.addEventListener('click',e=>e.stopPropagation());}
    if(mode==='robber')for(const el of this.container.querySelectorAll('[data-tile]'))if(state.legal.robber.includes(Number(el.dataset.tile)))activate(el,'tile',Number(el.dataset.tile),`将强盗移动至 ${LABELS[b.tiles[Number(el.dataset.tile)].resource]}地块 ${Number(el.dataset.tile)+1}`);
    this.setFeedback(this.feedback,{reducedMotion:this.reducedMotion});
  }
  dispose(){this.onProjectionChange=null;this.cancelFocus();this.events.abort();this.observer.disconnect();this.container.innerHTML='';}
}
