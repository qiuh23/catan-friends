// Device hints control layout and scheduling only. Appearance is a player choice.
export const QUALITY_KEY='catan:graphics-quality';
export const QUALITY_HINT_KEY='catan:graphics-quality-hint-shown';
export const normalizeQuality=value=>value==='low'?'low':'high';
export function createQualityPreference(storage){
  let chosen=null,shown=false;
  try{const value=storage?.getItem(QUALITY_KEY);if(value==='high'||value==='low')chosen=value;shown=storage?.getItem(QUALITY_HINT_KEY)==='1';}catch{}
  return {
    get value(){return normalizeQuality(chosen);},
    get canSuggest(){return chosen===null&&!shown;},
    choose(value){chosen=normalizeQuality(value);try{storage?.setItem(QUALITY_KEY,chosen);}catch{}return chosen;},
    markShown(){shown=true;try{storage?.setItem(QUALITY_HINT_KEY,'1');}catch{}},
  };
}
// Compare actual animation frames to their intended cadence, not an assumed 60Hz.
// Three consecutive 2s windows below half the requested rate are required.
export class AnimationStutterMonitor {
  constructor(){this.suspend(0);}
  reset(){this.last=0;this.started=0;this.frames=0;this.slow=0;this.windows=0;this.target=0;}
  suspend(now){this.reset();this.readyAt=now+2500;}
  sample(now,{active=false,targetMs=1000/60,foreground=true,settled=true}={}){
    if(!foreground||!settled){this.suspend(now);return false;}
    if(!active||now<this.readyAt){this.reset();return false;}
    if(!this.last||this.target!==targetMs){this.last=this.started=now;this.target=targetMs;return false;}
    const elapsed=now-this.last;this.last=now;
    // Long pauses are interruption/suspension, not sustained animation evidence.
    if(elapsed<=0||elapsed>500){this.suspend(now);return false;}
    this.frames++;if(elapsed>Math.max(80,targetMs*2))this.slow++;
    if(now-this.started<2000)return false;
    this.windows=this.frames>=10&&this.slow/this.frames>=.7?this.windows+1:0;
    this.started=now;this.frames=this.slow=0;
    if(this.windows<3)return false;
    this.suspend(now);return true;
  }
}
