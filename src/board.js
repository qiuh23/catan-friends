export { Board } from './board3d.js';
import { LABELS } from '../shared/board.js';
import { resourceIllustration } from './icons.js';
import { terrain } from './terrain.js';
import { boardFrame } from './board-frame.js';

export class FlatBoard {
  constructor(container,onSelect,onHover){
    this.container=container;this.onSelect=onSelect;this.onHover=onHover;
    this.zoom=1;this.pan={x:0,y:0};this.pointers=new Map();this.events=new AbortController();
    const options={signal:this.events.signal};
    container.addEventListener('pointerdown',e=>{
      if(!e.target.closest('svg'))return;
      if(!this.pointers.size)this.suppressClick=false;
      this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(this.pointers.size===1)this.gesture={kind:'pan',x:e.clientX,y:e.clientY,pan:{...this.pan}};
      else {const [a,b]=[...this.pointers.values()];this.gesture={kind:'pinch',distance:Math.hypot(a.x-b.x,a.y-b.y),zoom:this.zoom};this.suppressClick=true;}
    },options);
    window.addEventListener('pointermove',e=>{
      if(!this.pointers.has(e.pointerId))return;
      this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const g=this.gesture;
      if(this.pointers.size===2&&g?.kind==='pinch') {
        const [a,b]=[...this.pointers.values()],distance=Math.hypot(a.x-b.x,a.y-b.y),next=g.zoom*distance/(g.distance||1);
        this.zoomAt(next/this.zoom,(a.x+b.x)/2,(a.y+b.y)/2);
      } else if(this.pointers.size===1&&g?.kind==='pan') {
        const dx=e.clientX-g.x,dy=e.clientY-g.y;
        if(Math.hypot(dx,dy)>7)this.suppressClick=true;
        if(this.suppressClick){this.pan={x:g.pan.x+dx/this.scale,y:g.pan.y+dy/this.scale};this.resize();}
      }
    },options);
    const release=e=>{this.pointers.delete(e.pointerId);if(!this.pointers.size)this.gesture=null;};
    window.addEventListener('pointerup',release,options);window.addEventListener('pointercancel',release,options);
    container.addEventListener('wheel',e=>{e.preventDefault();this.zoomAt(Math.exp(-e.deltaY*.0015),e.clientX,e.clientY);},{...options,passive:false});
    container.addEventListener('keydown',e=>{
      if(['+','=','-','0'].includes(e.key)){e.preventDefault();if(e.key==='0')this.reset();else this.zoomAt(e.key==='-'?1/1.25:1.25);}
    },options);
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(container);
  }
  reset(){this.zoom=1;this.pan={x:0,y:0};this.resize();}
  zoomBy(factor){if(Number.isFinite(factor)&&factor>0)this.zoomAt(factor);}
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
    if(key===this.paddingKey)return;this.paddingKey=key;this.padding=padding;this.resize();
  }
  resize() {
    const svg=this.container.querySelector('svg'),bounds=this.contentBounds,w=this.container.clientWidth,h=this.container.clientHeight;
    if(!svg||!bounds||!w||!h)return;
    if(this.landscape!==(w>h)&&this.state){this.key=null;this.set(this.state,this.mode);return;}
    const f=boardFrame(w,h,this.padding),scale=this.scale=Math.min(f.width/bounds.width,f.height/bounds.height)*.96*this.zoom;
    const x=bounds.x-f.left/scale-(f.width/scale-bounds.width)/2-this.pan.x,y=bounds.y-f.top/scale-(f.height/scale-bounds.height)/2-this.pan.y;
    svg.setAttribute('viewBox',`${x} ${y} ${w/scale} ${h/scale}`);
  }
  set(state,mode){
    const b=state.board;if(!b)return;this.state=state;this.mode=mode;
    const landscape=this.container.clientWidth>this.container.clientHeight;
    if(this.landscape!==undefined&&this.landscape!==landscape)this.pan=landscape?{x:this.pan.y,y:-this.pan.x}:{x:-this.pan.y,y:this.pan.x};
    this.landscape=landscape;
    const key=JSON.stringify([b,state.robber,state.players.map(p=>[p.id,p.color]),mode,state.legal?.[mode],landscape]);if(key===this.key)return;this.key=key;
    const point=(x,z)=>landscape?{x:z*50+300,y:-x*50+290}:{x:x*50+300,y:z*50+290};
    const pos=v=>{const p=point(v.x,v.z);return `${p.x},${p.y}`;},color=id=>state.players.find(p=>p.id===id)?.color||'#173b3d';
    const tiles=b.tiles.map(t=>{const {x,y}=point(t.x,t.z),hot=[6,8].includes(t.number),dots=t.number?6-Math.abs(7-t.number):0;return `<g data-tile="${t.id}" role="img" aria-label="${LABELS[t.resource]}${t.number?'，'+t.number+' 点生产':'，不生产资源'}"><title>${LABELS[t.resource]}${t.number?' · '+t.number+' 点':''}</title><polygon points="${t.vertices.map(id=>pos(b.vertices[id])).join(' ')}" fill="#${terrain[t.resource].toString(16)}" stroke="#f2f0df" stroke-width="2"/><polygon points="${t.vertices.map(id=>pos(b.vertices[id])).join(' ')}" fill="url(#terrain-${t.resource})"/>${t.resource!=='desert'?resourceIllustration(t.resource).replace('<svg ',`<svg x="${x-13}" y="${y-42}" width="26" height="26" `):''}${t.number?`<circle cx="${x}" cy="${y+3}" r="18" fill="#fff5d9" stroke="#b39c6f" stroke-width="1.5"/><text x="${x}" y="${y+8}" text-anchor="middle" font-size="19" font-weight="700" fill="${hot?'#a93f28':'#173b3d'}">${t.number}</text>${Array.from({length:dots},(_,i)=>`<circle cx="${x+(i-(dots-1)/2)*4}" cy="${y+15}" r="1.1" fill="${hot?'#a93f28':'#173b3d'}"/>`).join('')}`:''}${state.robber===t.id?`<rect x="${x-21}" y="${y+22}" width="42" height="17" rx="6" fill="#283e39"/><text x="${x}" y="${y+34}" text-anchor="middle" font-size="11" fill="#fff7e4">强盗</text>`:''}</g>`;}).join('');
    const roads=b.edges.filter(e=>e.owner).map(e=>`<line x1="${point(b.vertices[e.a].x,b.vertices[e.a].z).x}" y1="${point(b.vertices[e.a].x,b.vertices[e.a].z).y}" x2="${point(b.vertices[e.b].x,b.vertices[e.b].z).x}" y2="${point(b.vertices[e.b].x,b.vertices[e.b].z).y}" stroke="${color(e.owner)}" stroke-width="8"/>`).join('');
    const buildings=b.vertices.filter(v=>v.owner).map(v=>`<rect x="${point(v.x,v.z).x-7}" y="${point(v.x,v.z).y-7}" width="${v.level===2?20:14}" height="14" fill="${color(v.owner)}" stroke="white" stroke-width="2"/>`).join('');
    const markers=(state.legal?.[mode]||[]).filter(()=>['road','settlement','city'].includes(mode)).map(id=>{let x,z;if(mode==='road'){const e=b.edges[id];x=(b.vertices[e.a].x+b.vertices[e.b].x)/2;z=(b.vertices[e.a].z+b.vertices[e.b].z)/2;}else({x,z}=b.vertices[id]);return `<circle data-id="${id}" cx="${point(x,z).x}" cy="${point(x,z).y}" r="9" fill="#fff1a5" stroke="#173b3d" stroke-width="2"/>`;}).join('');
    const ports=b.ports.map(p=>{const a=b.vertices[p.vertices[0]],c=b.vertices[p.vertices[1]],x=(a.x+c.x)/2,z=(a.z+c.z)/2,l=Math.hypot(x,z),{x:px,y:py}=point(x+x/l*.65,z+z/l*.65);return `<g role="img" aria-label="${p.resource==='any'?'普通港口 3:1':LABELS[p.resource]+'港口 2:1'}"><title>${p.resource==='any'?'普通港口 3:1':LABELS[p.resource]+'港口 2:1'}</title><rect x="${px-30}" y="${py-14}" width="60" height="28" rx="6" fill="#faf4e3" stroke="#9bae99"/>${p.resource!=='any'?resourceIllustration(p.resource).replace('<svg ',`<svg x="${px-28}" y="${py-13}" width="26" height="26" `):''}<text x="${p.resource==='any'?px:px+12}" y="${py+5}" text-anchor="middle" font-size="14" font-weight="600" fill="#173b3d">${p.resource==='any'?'3:1':'2:1'}</text></g>`;}).join('');
    const extents=b.vertices.map(v=>point(v.x,v.z));
    for(const p of b.ports){const a=b.vertices[p.vertices[0]],c=b.vertices[p.vertices[1]],x=(a.x+c.x)/2,z=(a.z+c.z)/2,l=Math.hypot(x,z),{x:px,y:py}=point(x+x/l*.65,z+z/l*.65);extents.push({x:px-32,y:py-16},{x:px+32,y:py+16});}
    const minX=Math.min(...extents.map(p=>p.x))-8,minY=Math.min(...extents.map(p=>p.y))-8,maxX=Math.max(...extents.map(p=>p.x))+8,maxY=Math.max(...extents.map(p=>p.y))+8;
    this.contentBounds={x:minX,y:minY,width:maxX-minX,height:maxY-minY};
    const bounds=`${minX} ${minY} ${maxX-minX} ${maxY-minY}`;
    this.container.innerHTML=`<svg viewBox="${bounds}" role="group" aria-label="卡坦岛二维棋盘，Tab 选择位置，回车落子"><defs><pattern id="terrain-wood" width="14" height="14" patternUnits="userSpaceOnUse"><path d="m3 2 4 8H0ZM10 8l3 5H7Z" fill="#244e3c" opacity=".14"/></pattern><pattern id="terrain-brick" width="18" height="12" patternUnits="userSpaceOnUse"><path d="M0 6h18M9 0v6M4 6v6M14 6v6" stroke="#754d35" opacity=".16" fill="none"/></pattern><pattern id="terrain-wheat" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M6 12V1M6 5 2 2M6 8l4-4" stroke="#917126" opacity=".22" fill="none"/></pattern><pattern id="terrain-sheep" width="18" height="16" patternUnits="userSpaceOnUse"><path d="M2 13q4-4 8 0M8 5q3-3 6 0" stroke="#456d35" opacity=".17" fill="none"/></pattern><pattern id="terrain-ore" width="18" height="16" patternUnits="userSpaceOnUse"><path d="m1 15 6-11 7 11M5 8l2-4 3 5" stroke="#405c68" opacity=".19" fill="none"/></pattern><pattern id="terrain-desert" width="22" height="14" patternUnits="userSpaceOnUse"><path d="M1 9q5-6 10 0t10 0" stroke="#9d8452" opacity=".18" fill="none"/></pattern></defs>${tiles}${ports}${roads}${buildings}${markers}</svg>`;
    this.resize();
    const svg=this.container.querySelector('svg');svg.style.touchAction='none';svg.setAttribute('tabindex','0');svg.setAttribute('aria-label','卡坦岛二维棋盘，拖动平移，双指或加减键缩放；Tab 选择位置，回车落子，0 复位');
    const activate=(el,kind,id,name)=>{el.setAttribute('role','button');el.setAttribute('tabindex','0');el.setAttribute('aria-label',name);el.onclick=e=>{if(e?.detail&&this.suppressClick)return;if(kind==='tile'||!e||e.detail===0)this.onSelect({kind,id});};el.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();el.onclick();}};};
    for(const el of this.container.querySelectorAll('[data-id]'))activate(el,mode==='road'?'edge':'vertex',Number(el.dataset.id),`${mode==='road'?'道路':'交叉点'} ${Number(el.dataset.id)+1}`);
    this.container.querySelector('svg').onclick=e=>{
      if(e.detail===0||this.suppressClick)return;
      const candidates=[...this.container.querySelectorAll('[data-id]')].map(el=>{
        const center=new DOMPoint(Number(el.getAttribute('cx')),Number(el.getAttribute('cy'))).matrixTransform(el.getScreenCTM());
        return {el,distance:Math.hypot(center.x-e.clientX,center.y-e.clientY)};
      }).filter(p=>p.distance<=(e.pointerType==='touch'?22:11)).sort((a,b)=>a.distance-b.distance);
      if(!candidates.length)return;
      if(e.pointerType==='touch'&&candidates[1]&&candidates[1].distance-candidates[0].distance<6){this.onHover('相邻落点较近，请放大棋盘后再点选。');return;}
      this.onSelect({kind:mode==='road'?'edge':'vertex',id:Number(candidates[0].el.dataset.id)});
    };
    if(mode==='robber')for(const el of this.container.querySelectorAll('[data-tile]'))if(state.legal.robber.includes(Number(el.dataset.tile)))activate(el,'tile',Number(el.dataset.tile),`将强盗移动至 ${LABELS[b.tiles[Number(el.dataset.tile)].resource]}地块 ${Number(el.dataset.tile)+1}`);
  }
  dispose(){this.events.abort();this.observer.disconnect();this.container.innerHTML='';}
}
