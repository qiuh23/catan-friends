import { Color } from 'three';
import {roadFrame} from './visuals/road-geometry.js';

const shade=(value,light)=>new Color(value).offsetHSL(0,0,light).getHex();
export function addRoad(batch,a,b,color) {
  const f=roadFrame(a,b),length=Math.min(.79,f.length*.79);
  const add=(shape,c,along,side,y,sx,sy,sz)=>batch.add(shape,c,f.x+f.dx*along-f.dz*side,y,f.z+f.dz*along+f.dx*side,sx,sy,sz,f.rotation,'pieces');
  // The shared edge is level at .2675. Set the bedding into that surface and
  // leave both junctions free for buildings and legal-move targets.
  add('paving',0x48534c,0,0,.284,length+.035,.034,.196);
  add('paving',0xc4b59b,0,0,.306,length,.022,.180);
  // Owner-colour curbs remain continuous and readable from the full map.
  for(const side of [-.078,.078]){
    add('paving',shade(color,-.07),0,side,.329,length-.018,.038,.033);
    add('box',shade(color,.12),0,side,.350,length-.045,.008,.012);
  }
  const count=6,step=(length-.032)/count;
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
