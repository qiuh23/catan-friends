import { createBoard } from '../shared/board.js';

export const SHOWCASE_SECONDS=30;
export const ORBIT_SECONDS=300;
const smooth=value=>{const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);};

// Local illustration data only: no Room, Connection, game reducer or legal moves.
// Its settled snapshot also serves the static 2D/reduced-motion illustration.
export function createHomeExample() {
  let seed=17;
  const board=createBoard(()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;});
  const vertex=board.vertices.filter(v=>v.tiles.length===3).sort((a,b)=>Math.hypot(a.x,a.z-1.3)-Math.hypot(b.x,b.z-1.3))[0];
  const roads=[],visited=new Set([vertex.id]);let current=vertex.id;
  for(let i=0;i<4;i++) {
    const edge=board.vertices[current].edges.map(id=>board.edges[id]).filter(e=>!visited.has(e.a===current?e.b:e.a))
      .sort((a,b)=>Math.hypot(board.vertices[a.a===current?a.b:a.a].x,board.vertices[a.a===current?a.b:a.a].z)-Math.hypot(board.vertices[b.a===current?b.b:b.a].x,board.vertices[b.a===current?b.b:b.a].z))[0];
    if(!edge)break;
    const next=edge.a===current?edge.b:edge.a;roads.push({edge:edge.id,from:current,to:next});edge.owner='illustration';visited.add(next);current=next;
  }
  vertex.owner='illustration';vertex.level=2;
  return {board,players:[{id:'illustration',color:'#b65c35'}],robber:null,legal:{},homeDemo:{vertex:vertex.id,roads}};
}

export function showcasePose(seconds) {
  const t=((seconds%SHOWCASE_SECONDS)+SHOWCASE_SECONDS)%SHOWCASE_SECONDS;
  const end=1-smooth((t-26)/1.6);
  return {village:smooth((t-1.5)/1.3)*(1-smooth((t-14.5)/1)),
    city:smooth((t-15.5)/1.4)*end,roads:Array.from({length:4},(_,i)=>smooth((t-4-i*2.5)/1.4)*end)};
}

// A rotationally symmetric envelope covers scenery, roofs, docks AND billboard
// corners at every bearing. It is fit once per layout, never once per frame.
export function showcaseEnvelope(board) {
  let radius=Math.max(...board.vertices.map(v=>Math.hypot(v.x,v.z)+.22));
  for(const port of board.ports) {
    const a=board.vertices[port.vertices[0]],b=board.vertices[port.vertices[1]];
    radius=Math.max(radius,Math.hypot((a.x+b.x)/2,(a.z+b.z)/2)+.69+.56);
  }
  return Array.from({length:96},(_,i)=>[-.12,1.16].map(y=>({x:Math.cos(i*Math.PI/48)*radius,y,z:Math.sin(i*Math.PI/48)*radius}))).flat();
}

// All rectangles are real DOM measurements in the full canvas's coordinates.
export function homePadding(width,height,{header,brand,nav,welcome,server,dock,controls,safe={},sideControls=false}) {
  if(sideControls) {
    return {top:(safe.top||0)+12,bottom:(safe.bottom||0)+12,
      left:Math.max(safe.left||0,...[brand,welcome,server,controls].filter(Boolean).map(r=>r.right))+12,
      right:width-Math.min(width-(safe.right||0),...[nav,dock].filter(Boolean).map(r=>r.left))+12};
  }
  const top=Math.max(safe.top||0,...[header,welcome,server].filter(Boolean).map(r=>r.bottom))+12;
  const bottom=height-Math.min(height-(safe.bottom||0),...[dock,!sideControls&&controls].filter(Boolean).map(r=>r.top))+12;
  return {top,bottom,left:(safe.left||0)+12,right:sideControls&&controls?width-controls.left+12:(safe.right||0)+12};
}
