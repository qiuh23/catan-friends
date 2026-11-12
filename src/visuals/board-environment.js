import * as THREE from 'three';
import {dayNightAt} from './day-night.js';
import {installCatanDaylight} from './vendor/catan-daylight.mjs';
import {createCatanSeaMaterial} from './vendor/catan-sea.mjs';
import {createSkyEnvironment} from './vendor/sky-environment.mjs';

// One explicit, deterministic appearance state owns sky, sea and lighting.
// The caller advances finite transitions from its existing render scheduler.
export function createBoardEnvironment({scene,camera,renderer,seaMesh,invalidate=()=>{}}) {
  const lighting=installCatanDaylight(THREE,{scene,renderer,invalidate});
  const sky=createSkyEnvironment({THREE,scene,camera,profile:'catan',style:'physical',starMode:'diorama'});
  const sea=createCatanSeaMaterial(THREE,{radius:5.8,phase:'day'});
  const previousSea=seaMesh.material;seaMesh.material=sea.material;
  let phase='day',weather='clear',transition=null,disposed=false,cycle=null,night=0;
  function apply(state) {
    night=state.night??((state.from==='night'?1:0)*(1-state.mix)+(state.to==='night'?1:0)*state.mix);
    lighting.setState({...state,weather});sky.setState(state);sea.setState(state);
    sky.setSourceDirection(lighting.getLightingState().direction);
  }
  function settle(){if(transition){phase=transition.to;transition=null;apply({from:phase,to:phase,mix:1});}}
  return {
    lighting,sky,sea,
    setCycle(elapsedMs,periodMs) {
      if(disposed)return;
      const state=dayNightAt(elapsedMs,periodMs);cycle=state.cycle;transition=null;
      phase=state.mix<.5?state.from:state.to;
      apply(state);lighting.setSourceDirection(state.direction);sky.setSourceDirection(state.direction);
      sky.uniforms.uOrbit.value=1;
      sky.uniforms.uOrbitSun.value.set(state.sun.x,state.sun.y,state.sun.opacity);
      sky.uniforms.uOrbitMoon.value.set(state.moon.x,state.moon.y,state.moon.opacity);
      return state;
    },
    setEnvironment(next={},stable=false) {
      if(disposed)return;
      cycle=null;sky.uniforms.uOrbit.value=0;
      const to=next.phase??phase,w=next.weather??weather,duration=next.transitionSeconds??0;
      if(!['day','dusk','night'].includes(to)||!['clear','overcast'].includes(w)||!Number.isFinite(duration)||duration<0)throw new RangeError('Expected day/dusk/night, clear/overcast and nonnegative duration');
      // Complete an interrupted finite transition before selecting a new one.
      settle();weather=w;
      if(duration>0&&!stable&&to!==phase)transition={from:phase,to,elapsed:0,duration};
      else {phase=to;transition=null;apply({from:phase,to:phase,mix:1});}
      invalidate();
    },
    update(seconds,stable=false) {
      if(disposed)return false;
      if(!Number.isFinite(seconds)||seconds<0)throw new RangeError('Expected nonnegative deltaSeconds');
      if(stable)settle();
      if(!transition)return false;
      transition.elapsed+=seconds;const t=Math.min(1,transition.elapsed/transition.duration),mix=t*t*(3-2*t);
      apply({from:transition.from,to:transition.to,mix});
      if(t===1){phase=transition.to;transition=null;}return Boolean(transition);
    },
    setQuality({mobile=false,lowPower=false}={}){if(disposed)return;lighting.setQuality({mobile,lowPower});sky.setQuality(mobile||lowPower);},
    setRadius(scale){if(disposed)return;lighting.setBoardRadius(6.6*scale);sea.setRadius(5.8*scale);},
    getState(){return {phase,weather,cycle,night,transitionActive:Boolean(transition),target:transition?.to??phase};},
    dispose(){if(disposed)return;disposed=true;transition=null;seaMesh.material=previousSea;sea.dispose();sky.dispose();lighting.dispose();},
  };
}
