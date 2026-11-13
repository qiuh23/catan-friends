/** Catan V7: explicitly driven artistic daylight/weather presets, not a clock or weather system.
 * Pass existing THREE/scene/renderer. No renderer, textures, network or RAF is created.
 */
export const CATAN_DAYLIGHT=Object.freeze({sunColor:0xffe9cb,sunIntensity:4.2,skyColor:0xeaf3ff,groundColor:0x718575,skyIntensity:1.4,sunDirection:[-6,10,-7],exposure:1,shadowMapSize:1024,shadowRadius:1.05,shadowNormalBias:.018,shadowBias:-.00012,suggestedSeaColor:0x397f82});
export const CATAN_PHASES=Object.freeze({
 day:{sunColor:0xffe9cb,sunIntensity:4.2,skyColor:0xeaf3ff,groundColor:0x718575,skyIntensity:1.4,direction:[-6,10,-7]},
 dusk:{sunColor:0xffc286,sunIntensity:1.50,skyColor:0xb9cbe7,groundColor:0x6f7266,skyIntensity:1.05,direction:[-8,4,-6]},
 night:{sunColor:0xbad8ff,sunIntensity:1.10,skyColor:0x9fb9df,groundColor:0x536778,skyIntensity:1.45,direction:[5,9,-10]},
});
export function installCatanDaylight(THREE,{scene,renderer,radius=6.6,mobile=false,lowPower=false,previousLights=[],invalidate=()=>{}}={}){
 if(!scene?.add||!renderer?.shadowMap)throw new TypeError('scene and renderer are required');
 if(!(radius>0)||!Number.isFinite(radius))throw new RangeError('radius must be positive');
 if(!Array.isArray(previousLights)||previousLights.some(x=>!x?.isLight))throw new TypeError('previousLights must contain Lights');
 if(typeof invalidate!=='function')throw new TypeError('invalidate must be a function');
 const saved={toneMapping:renderer.toneMapping,toneMappingExposure:renderer.toneMappingExposure,outputColorSpace:renderer.outputColorSpace,shadowType:renderer.shadowMap.type,shadowEnabled:renderer.shadowMap.enabled,shadowAutoUpdate:renderer.shadowMap.autoUpdate};
 const detached=previousLights.map(light=>({light,parent:light.parent}));for(const {light,parent}of detached)parent?.remove(light);
 const group=new THREE.Group();group.name='CatanDaylightV7';
 const sky=new THREE.HemisphereLight();sky.name='CatanSkyFill';
 const sun=new THREE.DirectionalLight();sun.name='CatanSun';sun.target.position.set(0,.25,0);
 sun.shadow.mapSize.set(1024,1024);sun.shadow.normalBias=.018;sun.shadow.bias=-.00012;
 group.add(sky,sun,sun.target);scene.add(group);
 renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
 renderer.shadowMap.type=THREE.PCFShadowMap;renderer.shadowMap.autoUpdate=false;
 let disposed=false,boardRadius=Math.max(3,radius),phase='day',weather='clear',transition=null;
 const quality={mobile:Boolean(mobile),lowPower:Boolean(lowPower)};
 function stateFor(p,w){
  const a=CATAN_PHASES[p],cloud=w==='overcast';
  return {sunColor:new THREE.Color(a.sunColor).lerp(new THREE.Color(0xe3eaf2),cloud?.65:0),skyColor:new THREE.Color(a.skyColor),groundColor:new THREE.Color(a.groundColor),sunIntensity:a.sunIntensity*(cloud?.45:1),skyIntensity:a.skyIntensity*(cloud?1.18:1),direction:new THREE.Vector3(...a.direction).normalize(),shadowRadius:cloud?1.6:1.05};
 }
 let current=stateFor(phase,weather);
 function copyState(s){return {...s,sunColor:s.sunColor.clone(),skyColor:s.skyColor.clone(),groundColor:s.groundColor.clone(),direction:s.direction.clone()};}
 function markDirty(){if(disposed)return;renderer.shadowMap.needsUpdate=true;invalidate();}
 function apply(){
  const shadows=!quality.lowPower;
  renderer.shadowMap.enabled=shadows;sun.castShadow=shadows;
  sun.color.copy(current.sunColor);sky.color.copy(current.skyColor);sky.groundColor.copy(current.groundColor);
  sun.intensity=current.sunIntensity*(shadows?1:2.35/2.65);sky.intensity=current.skyIntensity*(shadows?1:1.30/1.22);
  sun.position.copy(current.direction).multiplyScalar(boardRadius*2.5).add(sun.target.position);sun.shadow.radius=current.shadowRadius;
  markDirty();
 }
 function setBoardRadius(value){
  if(disposed)return;
  if(!(value>0)||!Number.isFinite(value))throw new RangeError('radius must be positive');
  boardRadius=Math.max(3,value);Object.assign(sun.shadow.camera,{left:-boardRadius,right:boardRadius,top:boardRadius,bottom:-boardRadius,near:.1,far:boardRadius*5.5});sun.shadow.camera.updateProjectionMatrix();apply();
 }
 function setQuality(next={}){
  if(disposed)return;
  if(!next||typeof next!=='object')throw new TypeError('quality must be an object');
  if('mobile'in next)quality.mobile=Boolean(next.mobile);if('lowPower'in next)quality.lowPower=Boolean(next.lowPower);apply();
 }
 function setEnvironment(next={}){
  if(disposed)return;
  const p=next.phase??phase,w=next.weather??weather,duration=next.transitionSeconds??0;
  if(!Object.hasOwn(CATAN_PHASES,p)||!['clear','overcast'].includes(w))throw new RangeError('phase: day/dusk/night; weather: clear/overcast');
  if(!Number.isFinite(duration)||duration<0)throw new RangeError('transitionSeconds must be nonnegative');
  const target=stateFor(p,w);phase=p;weather=w;
  if(duration===0){current=target;transition=null;apply();}
  else {transition={from:copyState(current),to:target,elapsed:0,duration};markDirty();}
 }
 // Absolute shared appearance state. mix is already eased by caller; no clock/easing here.
 function setState(next={}){
  if(disposed)return;
  if('phase'in next){setEnvironment({phase:next.phase,weather:next.weather??weather,transitionSeconds:0});return;}
  const {from,to,mix}=next,w=next.weather??weather;
  if(!Object.hasOwn(CATAN_PHASES,from)||!Object.hasOwn(CATAN_PHASES,to)||!['clear','overcast'].includes(w)||!Number.isFinite(mix)||mix<0||mix>1)throw new RangeError('valid from/to/mix and weather required');
  const a=stateFor(from,w),b=stateFor(to,w),value=copyState(a);
  for(const key of ['sunColor','skyColor','groundColor'])value[key].lerp(b[key],mix);
  value.direction.lerp(b.direction,mix).normalize();
  for(const key of ['sunIntensity','skyIntensity','shadowRadius'])value[key]=a[key]+(b[key]-a[key])*mix;
  current=value;phase=mix===0?from:to;weather=w;transition=null;apply();
 }
 // Caller supplies elapsed seconds from its existing finite transition/render path.
 // Returns true while more transition frames are needed; never schedules one itself.
 function update(deltaSeconds){
  if(disposed||!transition)return false;
  if(!Number.isFinite(deltaSeconds)||deltaSeconds<0)throw new RangeError('deltaSeconds must be nonnegative');
  transition.elapsed+=deltaSeconds;const t=Math.min(1,transition.elapsed/transition.duration),u=t*t*(3-2*t),a=transition.from,b=transition.to;
  for(const key of ['sunColor','skyColor','groundColor'])current[key].copy(a[key]).lerp(b[key],u);
  current.direction.copy(a.direction).lerp(b.direction,u).normalize();
  for(const key of ['sunIntensity','skyIntensity','shadowRadius'])current[key]=a[key]+(b[key]-a[key])*u;
  if(t===1)transition=null;apply();return transition!==null;
 }
 // Match the visible sky source; call after update() if sky owns the direction.
 function setSourceDirection(value){
  if(disposed)return;
  if(Array.isArray(value)&&(value.length!==3||![value[0],value[1],value[2]].every(Number.isFinite)))throw new TypeError('source direction array must have exactly three finite values');
  const v=Array.isArray(value)?new THREE.Vector3(...value):(value?.isVector3?value.clone():null);
  if(!v||![v.x,v.y,v.z].every(Number.isFinite)||v.lengthSq()<1e-12)throw new TypeError('source direction must be a finite nonzero vector');
  current.direction.copy(v).normalize();apply();
 }
 function getLightingState(){return {direction:current.direction.clone(),color:sun.color.clone(),intensity:sun.intensity,phase,weather};}
 function getState(){return {phase,weather,...quality,transitionActive:transition!==null,transitionProgress:transition?Math.min(1,transition.elapsed/transition.duration):1,disposed};}
 function dispose({restorePreviousLights=false,restoreRenderer=false}={}){
  if(disposed)return;disposed=true;transition=null;group.removeFromParent();sun.shadow.dispose();
  if(restorePreviousLights)for(const {light,parent}of detached)parent?.add(light);
  if(restoreRenderer){renderer.toneMapping=saved.toneMapping;renderer.toneMappingExposure=saved.toneMappingExposure;renderer.outputColorSpace=saved.outputColorSpace;renderer.shadowMap.type=saved.shadowType;renderer.shadowMap.enabled=saved.shadowEnabled;renderer.shadowMap.autoUpdate=saved.shadowAutoUpdate;renderer.shadowMap.needsUpdate=true;}
 }
 setBoardRadius(radius);
 return {group,sky,sun,markDirty,setBoardRadius,setQuality,setEnvironment,setState,update,getState,getLightingState,setSourceDirection,dispose};
}

