import {GAME_DAY_MS, HOME_DAY_MS} from '../../shared/scene-clock.js';
export {GAME_DAY_MS, HOME_DAY_MS};
const smooth=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
// Initial morning, sunset, night, dawn. Adjacent segments share endpoints and
// zero slopes: both colour and orbit are continuous, including the wrap.
export function dayNightAt(elapsedMs, periodMs=GAME_DAY_MS) {
  const cycle=((elapsedMs/periodMs+.08)%1+1)%1;
  const stops=[[0,'dusk'],[.12,'day'],[.32,'day'],[.46,'dusk'],[.56,'night'],[.88,'night'],[1,'dusk']];
  const i=stops.findIndex((s,j)=>j<stops.length-1&&cycle>=s[0]&&cycle<stops[j+1][0]);
  const [a,from]=stops[i], [b,to]=stops[i+1],mix=smooth(a,b,cycle);
  const theta=cycle*Math.PI*2,altitude=Math.sin(theta),moonAltitude=-altitude;
  const body=(angle)=>({x:-.84*Math.cos(angle),y:.43+.38*Math.sin(angle),opacity:smooth(-.08,.16,Math.sin(angle))});
  const sun=body(theta),moon=body(theta+Math.PI);
  const night=from==='night'?(to==='night'?1:1-mix):to==='night'?mix:0;
  // Both sources retain a small rearward component. Their horizon crossover
  // has no zero-length vector or abrupt shadow reversal.
  const blend=smooth(-.16,.16,-altitude);
  const sunDirection=[-Math.cos(theta),Math.max(.035,altitude),-.55];
  const moonDirection=[Math.cos(theta),Math.max(.035,moonAltitude),-.55];
  const direction=sunDirection.map((v,j)=>v+(moonDirection[j]-v)*blend);
  return {cycle,from,to,mix,night,direction,sun,moon};
}
// Monotonic client interpolation between authoritative room samples. Repeated
// UI rerenders do not restart the anchor; performance.now avoids wall-clock jumps.
export class SceneClock {
  constructor(){this.key=null;this.sample=null;this.receivedAt=0;}
  receive(sample,now){
    const key=JSON.stringify(sample);
    if(key===this.key)return;
    this.key=key;this.sample=sample;this.receivedAt=now;
  }
  elapsed(now){return this.sample?this.sample.elapsedMs+(this.sample.running?Math.max(0,now-this.receivedAt):0):0;}
}
