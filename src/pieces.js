import { Color } from 'three';

const shade=(value,light)=>new Color(value).offsetHSL(0,0,light).getHex();
export function addRoad(batch,a,b,color) {
  const x=(a.x+b.x)/2,z=(a.z+b.z)/2,r=-Math.atan2(b.z-a.z,b.x-a.x);
  const add=(shape,c,y,sx,sy,sz)=>batch.add(shape,c,x,y,z,sx,sy,sz,r,'pieces');
  add('box',0x203a3e,.31,.84,.055,.21);add('box',0xfff6df,.35,.81,.05,.17);
  add('box',color,.40,.77,.09,.125);add('box',shade(color,.15),.451,.69,.012,.035);
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
