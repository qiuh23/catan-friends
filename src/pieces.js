import { Color } from 'three';
import {roadFrame,roadConnections,createRoadJunctionGeometries,ROAD_JOIN_REACH} from './visuals/road-geometry.js';

const shade=(value,light)=>new Color(value).offsetHSL(0,0,light).getHex();

// Home and matches use this same topology, ownership and geometry path. The
// optional tags only let the home timeline reveal already-built instances.
export function addRoadNetwork(batch,board,color,{tagPieces=false}={}) {
  const connections=roadConnections(board);
  for(const edge of board.edges.filter(e=>e.owner)) {
    if(tagPieces)batch.piece={kind:'road',id:edge.id};
    addRoad(batch,board.vertices[edge.a],board.vertices[edge.b],color(edge.owner),{ends:connections.ends(edge)});
  }
  for(const [id,owner]of connections.joined) {
    if(tagPieces)batch.piece={kind:'junction',id,edges:board.vertices[id].edges.filter(edge=>board.edges[edge].owner===owner)};
    addRoadJunction(batch,board.vertices[id],color(owner),connections.junctions.get(id));
  }
  batch.piece=null;
  return connections;
}

export function addBoardBuildings(batch,vertices,color,models,layer) {
  const loaded=models.buildings(vertices,color,layer);
  for(const vertex of vertices)if(!loaded.has(vertex.id))addBuilding(batch,vertex,color(vertex.owner));
}

export function addRoad(batch,a,b,color,{ends=[null,null]}={}) {
  const f=roadFrame(a,b),baseGap=(f.length-Math.min(.79,f.length*.79))/2;
  if(a.x>b.x||a.x===b.x&&a.z>b.z)ends=[ends[1],ends[0]];
  const start=ends[0]??baseGap,end=ends[1]??baseGap,length=f.length-start-end,center=(start-end)/2;
  f.x+=f.dx*center;f.z+=f.dz*center;
  const add=(shape,c,along,side,y,sx,sy,sz)=>batch.add(shape,c,f.x+f.dx*along-f.dz*side,y,f.z+f.dz*along+f.dx*side,sx,sy,sz,f.rotation,'pieces');
  // The shared edge is level at .2675. Set the bedding into that surface and
  // leave both junctions free for buildings and legal-move targets.
  add('paving',0x48534c,0,0,.284,length+.035,.034,.196);
  add('paving',0xc4b59b,0,0,.306,length,.022,.180);
  // Owner-colour curbs remain continuous and readable from the full map.
  const connected=ends.map(value=>value===ROAD_JOIN_REACH);
  for(const side of [-.078,.078]){
    const trims=connected.map(value=>value?0:.009),rims=connected.map(value=>value?0:.0225);
    add(connected.some(Boolean)?'box':'paving',shade(color,-.07),(trims[0]-trims[1])/2,side,.329,length-trims[0]-trims[1],.038,.033);
    add('box',shade(color,.12),(rims[0]-rims[1])/2,side,.350,length-rims[0]-rims[1],.008,.012);
  }
  const count=Math.max(3,Math.round(length/.13)),step=(length-.032)/count;
  for(let row=0;row<2;row++)for(let i=0;i<count;i++){
    const along=(i-(count-1)/2)*step,side=(row-.5)*.058;
    const tint=[0xa6a18f,0xbcb49f,0xcfc3a8,0xaaa797][(i+row*3)%4];
    add('paving',tint,along,side,.328+(i%3)*.0015,step-.010,.032,.054);
  }
}
export function addBuilding(batch,v,owner) {
  const dark=0x203a3e,ivory=0xfff5da;
  const add=(shape,c,x,y,z,sx,sy,sz)=>batch.add(shape,c,x,y,z,sx,sy,sz,0,'pieces');
  add('cylinder',dark,v.x,.29,v.z,v.level===2?.235:.205,.04,v.level===2?.235:.205);
  add('cylinder',ivory,v.x,.315,v.z,v.level===2?.215:.185,.035,v.level===2?.215:.185);
  if(v.level===2) {
    add('box',dark,v.x,.35,v.z,.37,.045,.29);add('box',owner,v.x,.475,v.z,.33,.255,.255);
    add('box',owner,v.x-.075,.59,v.z,.17,.40,.255);
    add('box',ivory,v.x-.075,.80,v.z,.205,.045,.30);add('box',shade(owner,.08),v.x-.075,.83,v.z,.17,.035,.26);
    add('box',ivory,v.x+.105,.625,v.z,.18,.04,.285);add('box',shade(owner,.08),v.x+.105,.65,v.z,.15,.035,.25);
    add('box',dark,v.x-.075,.64,v.z+.132,.055,.085,.012);add('box',dark,v.x+.08,.44,v.z+.132,.065,.12,.012);
  }else {
    add('box',dark,v.x,.35,v.z,.29,.04,.27);add('box',owner,v.x,.465,v.z,.27,.23,.25);
    add('box',dark,v.x,.585,v.z,.35,.025,.31);add('roof',shade(owner,-.07),v.x,.665,v.z,.33,.17,.29);
    add('box',ivory,v.x,.56,v.z+.132,.27,.025,.012);add('box',dark,v.x,.415,v.z+.132,.065,.12,.014);
  }
}

// Mitered pavement continues the road's exact width, levels and owner curbs.
// The two/three-arm shapes are cached and instanced, never a circular end cap.
export function addRoadJunction(batch,vertex,color,{arms,rotation}){
  const {x,z}=vertex,prefix=`road-join-${arms}`;
  if(!batch.assets.geometries[prefix+'-bed'])for(const [part,geometry]of Object.entries(createRoadJunctionGeometries(arms)))batch.assets.geometries[prefix+'-'+part]=geometry;
  const add=(part,c,y,sy)=>batch.add(prefix+'-'+part,c,x,y,z,1,sy,1,rotation,'pieces');
  add('bed',0x48534c,.284,.034);add('base',0xc4b59b,.306,.022);
  add('curb',shade(color,-.07),.329,.038);add('rim',shade(color,.12),.350,.008);
  add('paving',0xbcb49f,.328,.032);add('grout',0x918a78,.3444,.0008);
}
