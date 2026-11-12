import * as THREE from 'three';
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
  let phase='day',weather='clear',transition=null,disposed=false;
  function apply(state) {
    lighting.setState({...state,weather});sky.setState(state);sea.setState(state);
    sky.setSourceDirection(lighting.getLightingState().direction);
  }
  function settle(){if(transition){phase=transition.to;transition=null;apply({from:phase,to:phase,mix:1});}}
  return {
    lighting,sky,sea,
    setEnvironment(next={},stable=false) {
      if(disposed)return;
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
    getState(){return {phase,weather,transitionActive:Boolean(transition),target:transition?.to??phase};},
    dispose(){if(disposed)return;disposed=true;transition=null;seaMesh.material=previousSea;sea.dispose();sky.dispose();lighting.dispose();},
  };
}
