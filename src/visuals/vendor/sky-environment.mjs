/** V9 more visible, tiered background stars; approved atmosphere/light model unchanged. Inject the game's one installed THREE instance.
 * One background triangle; no renderer, RAF, texture download, fog or light is created.
 * Atmospheric coefficients/phase/noise adapted from Three.js Sky, MIT.
 * Copyright © 2010-2026 three.js authors. Full notice in SKY_SOURCES.md.
 * See SKY_INTEGRATION.md for the shared state/light/surface integration contract.
 */
export const SKY_SOURCE_DIRECTIONS = Object.freeze({
  catan: Object.freeze({ day: Object.freeze([-6, 10, -7]), dusk: Object.freeze([-8, 4, -6]), night: Object.freeze([5, 9, -10]) }),
  athlete: Object.freeze({ day: Object.freeze([-8, 20, 12]), dusk: Object.freeze([-16, 7, -18]), night: Object.freeze([8, 16, 10]) }),
});
/** Normalized viewport-height radii, matched to each approved mobile preview. */
export const SKY_STAR_PROFILES = Object.freeze({
  catan: Object.freeze({radiusMin:Object.freeze([.0010,.0018,.0035]),radiusMax:Object.freeze([.0016,.0028,.0050])}),
  athlete: Object.freeze({radiusMin:Object.freeze([.00167,.00313,.0050]),radiusMax:Object.freeze([.00229,.00396,.00625])}),
});
export const SKY_ATMOSPHERE_PROFILES = Object.freeze({
  catan: Object.freeze({rayleigh:2.2,turbidity:2.1,mieCoefficient:.0035,mieDirectionalG:.80,daylightScale:26,cloudOpacity:.08}),
  athlete: Object.freeze({rayleigh:1.8,turbidity:1.8,mieCoefficient:.0032,mieDirectionalG:.78,daylightScale:28,cloudOpacity:.06}),
});
const PALETTE = Object.freeze({
  day: { zenith: '#4993cb', horizon: '#d6e9ed', nadir: '#9bbab9', source: '#fff5e7', night: 0, radius: .2666, clouds: 1 },
  dusk: { zenith: '#313a63', horizon: '#a27669', nadir: '#777b90', source: '#ffe2bd', night: .12, radius: .2666, clouds: .65 },
  night: { zenith: '#07142d', horizon: '#354969', nadir: '#1c3047', source: '#dce8f5', night: 1, radius: .38, clouds: .2 },
});
const VERTEX = /* glsl */`
varying vec2 vSkyNdc;
void main() {
  vSkyNdc = position.xy;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;
const FRAGMENT = /* glsl */`
precision highp float;
varying vec2 vSkyNdc;
uniform mat4 uInverseProjection;
uniform mat4 uCameraWorld;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uForward;
uniform vec3 uSourceDirection;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uNadir;
uniform vec3 uSourceColor;
uniform vec3 uBetaR;
uniform vec3 uBetaM;
uniform vec3 uSunTransmittance;
uniform float uSunEnergy;
uniform float uMieG;
uniform float uAspect;
uniform float uTanHalfFov;
uniform float uDiorama;
uniform float uOrthographic;
uniform float uNight;
uniform float uSourceRadius;
uniform float uClouds;
uniform float uOpacity;
uniform float uStarMode;
uniform float uStarIntensity;
uniform vec3 uStarRadiusMin;
uniform vec3 uStarRadiusMax;
const float PI = 3.141592653589793;
// Rayleigh/Henyey-Greenstein phase and optical lengths follow Three Sky's
// atmospheric model; reduced single scattering, not a complete Preetham clone.
float airMass(float y) {
  float zenith = acos(clamp(y,0.,1.));
  return 1. / (cos(zenith) + .15 * pow(93.885 - degrees(zenith),-1.253));
}
vec3 daylightRadiance(vec3 ray, float cosTheta, out vec3 transmittance) {
  float path = airMass(ray.y);
  transmittance = exp(-(uBetaR*8400. + uBetaM*1250.)*path);
  float rayleighPhase = .05968310366 * (1.+cosTheta*cosTheta);
  float g2 = uMieG*uMieG;
  float miePhase = .07957747155 * (1.-g2) / pow(max(.0001,1.+g2-2.*uMieG*cosTheta),1.5);
  vec3 phase = (uBetaR*rayleighPhase + uBetaM*miePhase) / (uBetaR+uBetaM);
  // Both incoming and view paths attenuate spectrally. Mie forward scattering
  // joins the small sun to its surroundings; there is no pasted Gaussian halo.
  return uSunEnergy * uSunTransmittance * phase * (1.-transmittance);
}
vec2 gradient(vec2 i) {
  vec3 p = fract(i.xyx * vec3(.1031,.1030,.0973));
  p += dot(p,p.yzx+33.33);
  return fract((p.xx+p.yz)*p.zy)*2.-1.;
}
float noise21(vec2 p) {
  vec2 i=floor(p),f=fract(p),u=f*f*f*(f*(f*6.-15.)+10.);
  float a=dot(gradient(i),f),b=dot(gradient(i+vec2(1.,0.)),f-vec2(1.,0.));
  float c=dot(gradient(i+vec2(0.,1.)),f-vec2(0.,1.)),d=dot(gradient(i+vec2(1.)),f-vec2(1.));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y)*.8+.5;
}
float hash21(vec2 p) {
  vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);
  return fract((q.x+q.y)*q.z);
}
void main() {
  vec3 ray;
  if (uDiorama > .5) {
    // Explicit artistic option only: same camera orientation, no default tilt.
    ray=normalize(uForward+uRight*(vSkyNdc.x*uAspect*uTanHalfFov)+uUp*(vSkyNdc.y*uTanHalfFov));
  } else if (uOrthographic > .5) {
    ray=normalize((uCameraWorld*vec4(0.,0.,-1.,0.)).xyz);
  } else {
    vec4 view=uInverseProjection*vec4(vSkyNdc,1.,1.);
    ray=normalize((uCameraWorld*vec4(view.xyz/view.w,0.)).xyz);
  }
  float cosTheta=clamp(dot(ray,uSourceDirection),-1.,1.);
  float chord=length(ray-uSourceDirection);
  float radius=2.*sin(uSourceRadius*.5);
  // Evaluate derivatives before nonuniform branches. Real small angular discs
  // remain angular discs; no minimum pixel radius or visibility inflation.
  float aa=max(fwidth(chord),.00001);
  float disc=1.-smoothstep(radius-aa,radius+aa,chord);
  float aboveHorizon=smoothstep(-.004,.006,ray.y);
  vec3 sky,viewTransmittance=vec3(1.);
  if (uNight < .999) {
    vec3 daylight=daylightRadiance(ray,cosTheta,viewTransmittance);
    // Below the horizon this is ambient lower-hemisphere colour, not a lifted
    // sky/horizon. Actual terrain/sea should cover it in a world scene.
    vec3 lower=mix(uNadir*.82,uNadir,smoothstep(-1.,0.,ray.y));
    daylight=mix(lower,daylight,smoothstep(-.12,.015,ray.y));
    sky=daylight;
  } else { sky=vec3(0.); }
  vec3 nightSky=ray.y>=0.
    ? mix(uHorizon,uZenith,pow(clamp(ray.y,0.,1.),.65))
    : mix(uHorizon,uNadir,smoothstep(0.,.55,-ray.y));
  sky=mix(sky,nightSky,uNight);
  // V8_STARS_BEGIN: only star sampling is artistic; ray/source stay untouched.
  if(uStarMode>.5 && uStarIntensity>0. && uNight>.03) {
    if(uStarMode>1.5) {
      // Explicit scenic backdrop, NOT astronomical/world-direction projection.
      // Fixed normalized-height coordinates: stable while orbiting, no animation.
      vec2 starCell=vec2(vSkyNdc.x*uAspect,vSkyNdc.y)*14.+vec2(41.23,17.71);
      vec2 starID=floor(starCell);
      vec2 offset=vec2(hash21(starID+17.),hash21(starID+53.))*.60+.20;
      float d=length(fract(starCell)-offset);
      vec2 starPixel=fwidth(starCell);
      float aaStar=max(max(starPixel.x,starPixel.y),.015);
      // V9: 65% small / 25% medium / 10% prominent.
      // Radius uniforms preserve each game's approved mobile-preview scale.
      float rank=hash21(starID+137.);
      float variation=hash21(starID+29.);
      float size,brightness;
      if(rank<.65) {
        size=mix(uStarRadiusMin.x,uStarRadiusMax.x,variation);
        brightness=mix(.42,.68,hash21(starID+83.));
      } else if(rank<.90) {
        size=mix(uStarRadiusMin.y,uStarRadiusMax.y,variation);
        brightness=mix(1.0,1.45,hash21(starID+83.));
      } else {
        size=mix(uStarRadiusMin.z,uStarRadiusMax.z,variation);
        brightness=mix(2.0,2.8,hash21(starID+83.));
      }
      float threshold=.935;
      #ifdef SKY_LOW_QUALITY
        threshold=.955;
      #endif
      float star=(1.-smoothstep(size,size+aaStar,d))*step(threshold,hash21(starID));
      float fade=smoothstep(.18,.90,uNight)*uStarIntensity;
      vec3 tint=mix(vec3(.55,.68,.92),vec3(.88,.94,1.),hash21(starID+109.));
      sky+=tint*star*brightness*fade;
    } else {
      #ifndef SKY_LOW_QUALITY
        // Legacy physical stars: only above the actual horizon. Parallel ortho
        // rays do not turn these into a screen-space constellation.
        vec2 sphereUV=vec2(atan(ray.z,ray.x)/(2.*PI)+.5,asin(clamp(ray.y,-1.,1.))/PI+.5);
        vec2 starCell=sphereUV*vec2(680.,340.),starID=floor(starCell);
        vec2 starOffset=vec2(hash21(starID+17.),hash21(starID+53.))*.56+.22;
        float starDist=length(fract(starCell)-starOffset);
        float starAA=max(fwidth(starDist),.035);
        float star=(1.-smoothstep(.045,.045+starAA,starDist))*step(.996,hash21(starID));
        sky+=vec3(.32,.42,.62)*star*pow(uNight,3.)*aboveHorizon*(.25+.6*hash21(starID+83.))*uStarIntensity;
      #endif
    }
  }
  // V8_STARS_END
  #ifndef SKY_LOW_QUALITY
    if(uClouds>.001) {
      vec2 p=ray.xz/max(.18,ray.y+.25);
      float n=noise21(p*2.1)*.66+noise21(p*4.8+9.)*.34;
      float mask=smoothstep(.59,.77,n)*smoothstep(.025,.18,ray.y)*(1.-smoothstep(.75,.95,ray.y));
      vec3 cloudColor=mix(vec3(.65,.73,.84),vec3(.025,.04,.07),uNight);
      // Thin, static high cloud. Cloud opacity attenuates both solar core and sky.
      float opacity=mask*uClouds;
      sky=mix(sky,cloudColor,opacity);
      disc*=1.-opacity;
    }
  #endif
  float moonMix=smoothstep(.25,.9,uNight);
  if (disc>0. && aboveHorizon>0.) {
    if (moonMix<.999) {
      // Small HDR solar core, spectral attenuation shares the atmosphere's path.
      // Warm daylight reaching the scene is a separate DirectionalLight.
      vec3 solar=uSourceColor*viewTransmittance*35.;
      sky+=solar*disc*aboveHorizon*(1.-moonMix);
    }
    if (moonMix>.001) {
      vec3 right=normalize(cross(vec3(0.,1.,0.),uSourceDirection));
      vec3 up=normalize(cross(uSourceDirection,right));
      vec2 local=vec2(dot(ray,right),dot(ray,up))/max(radius,.001);
      float depth=sqrt(max(0.,1.-dot(local,local)));
      float phase=smoothstep(-.07,.07,local.x*.38+depth*.85);
      float maria=0.;
      #ifndef SKY_LOW_QUALITY
        maria=smoothstep(.35,.63,noise21(local*3.8+11.)*.68+noise21(local*8.5+27.)*.32)*.13;
      #endif
      vec3 lunar=uSourceColor*(.62+.38*depth-maria)*mix(.09,1.,phase);
      sky=mix(sky,lunar,disc*aboveHorizon*moonMix);
    }
  }
  gl_FragColor=vec4(max(sky,vec3(0.)),uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <premultiplied_alpha_fragment>
}`;

/** Options: style defaults physical. artistic/legacy board-diorama is explicit opt-in.
 * State is {mode:'day'|'dusk'|'night'} or {from,to,mix}; twilight aliases dusk.
 * Light direction is FROM the board TOWARD the source, not light-ray travel.
 */
export function createSkyEnvironment({
  THREE, scene, camera, style = 'physical', lowQuality = false,
  state = { mode: 'day' }, directions,
  opacity = 1, aspect, backdropElevation, backdropFov, minHorizontalFov = 0, premultipliedAlpha = true,
  profile = 'catan', atmosphere = {}, starMode = 'physical', starIntensity = 1,
} = {}) {
  if (!THREE?.ShaderMaterial || !scene?.isScene || !camera?.isCamera) throw new TypeError('THREE, scene and camera required');
  if (!['physical','artistic','board-diorama'].includes(style)) throw new RangeError('style must be physical or artistic (board-diorama is a legacy alias)');
  const artistic=style!=='physical';
  const starModes={off:0,physical:1,diorama:2};
  const validateStars=(mode,intensity)=>{
    if(!Object.hasOwn(starModes,mode))throw new RangeError('starMode must be off, physical or diorama');
    if(!Number.isFinite(intensity)||intensity<0||intensity>1)throw new RangeError('starIntensity must be in [0,1]');
  };
  validateStars(starMode,starIntensity);
  if (!Object.hasOwn(SKY_ATMOSPHERE_PROFILES,profile)) throw new RangeError('profile must be catan or athlete');
  // A profile must not accidentally inherit another game's source directions.
  const resolvedDirections=directions??SKY_SOURCE_DIRECTIONS[profile];
  if (!atmosphere || typeof atmosphere!=='object' || Array.isArray(atmosphere)) throw new TypeError('atmosphere must be an object');
  const optics={...SKY_ATMOSPHERE_PROFILES[profile],...atmosphere};
  const ranges={rayleigh:[.1,6],turbidity:[1,12],mieCoefficient:[.0001,.03],mieDirectionalG:[0,.95],daylightScale:[1,80],cloudOpacity:[0,.4]};
  for (const key of Object.keys(atmosphere)) if (!Object.hasOwn(ranges,key)) throw new RangeError('Unknown atmosphere parameter: '+key);
  for (const [key,[lo,hi]] of Object.entries(ranges)) if (!Number.isFinite(optics[key])||optics[key]<lo||optics[key]>hi) throw new RangeError(key+' is out of range');
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new RangeError('opacity must be in [0,1]');
  if (backdropElevation!==undefined && (!Number.isFinite(backdropElevation) || backdropElevation < -85 || backdropElevation > 85)) throw new RangeError('backdropElevation must be in [-85,85] degrees');
  if (backdropFov!==undefined && (!Number.isFinite(backdropFov) || backdropFov < 10 || backdropFov > 140)) throw new RangeError('backdropFov must be in [10,140] degrees');
  if (!Number.isFinite(minHorizontalFov) || minHorizontalFov < 0 || minHorizontalFov > 120) throw new RangeError('minHorizontalFov must be in [0,120] degrees');
  const directionMap = {};
  const asDirection = value => {
    if (!value?.isVector3 && (!Array.isArray(value) || value.length !== 3)) throw new TypeError('Source direction must be Vector3 or a length-3 array');
    if (Array.isArray(value) && ![0,1,2].every(i=>Number.isFinite(value[i]))) throw new RangeError('Every source direction component must be finite');
    const v = value?.isVector3 ? value.clone() : new THREE.Vector3(...value);
    if (![v.x,v.y,v.z].every(Number.isFinite) || v.lengthSq() < 1e-12) throw new RangeError('Source direction must be a finite nonzero Vector3 or [x,y,z]');
    v.normalize();
    // Celestial tangent basis uses world up; exact zenith is excluded explicitly.
    if (Math.abs(v.y) > .99999) throw new RangeError('Use a source slightly away from exact zenith/nadir');
    return v;
  };
  for (const mode of Object.keys(PALETTE)) directionMap[mode] = asDirection(resolvedDirections[mode]);
  const baseDirections=Object.fromEntries(Object.entries(directionMap).map(([key,value])=>[key,value.clone()]));
  const uniforms = {
    uInverseProjection:{value:new THREE.Matrix4()}, uCameraWorld:{value:new THREE.Matrix4()},
    uRight:{value:new THREE.Vector3()}, uUp:{value:new THREE.Vector3()}, uForward:{value:new THREE.Vector3()},
    uSourceDirection:{value:new THREE.Vector3()},
    uBetaR:{value:new THREE.Vector3(5.804542996261093e-6,1.3562911419845635e-5,3.0265902468824876e-5).multiplyScalar(optics.rayleigh)},
    uBetaM:{value:new THREE.Vector3(1.8399918514433978e14,2.7798023919660528e14,4.0790479543861094e14).multiplyScalar(.434*(.2*optics.turbidity)*10e-18*optics.mieCoefficient)},
    uSunTransmittance:{value:new THREE.Vector3()},uSunEnergy:{value:0},uMieG:{value:optics.mieDirectionalG},
    uZenith:{value:new THREE.Color()},
    uHorizon:{value:new THREE.Color()}, uNadir:{value:new THREE.Color()}, uSourceColor:{value:new THREE.Color()},
    uAspect:{value:1}, uTanHalfFov:{value:Math.tan(THREE.MathUtils.degToRad(backdropFov??35)*.5)},
    uDiorama:{value:artistic?1:0}, uOrthographic:{value:0},
    uNight:{value:0}, uSourceRadius:{value:0}, uClouds:{value:0}, uOpacity:{value:opacity},
    uStarMode:{value:starModes[starMode]},uStarIntensity:{value:starIntensity},
    uStarRadiusMin:{value:new THREE.Vector3(...SKY_STAR_PROFILES[profile].radiusMin).multiplyScalar(28)},
    uStarRadiusMax:{value:new THREE.Vector3(...SKY_STAR_PROFILES[profile].radiusMax).multiplyScalar(28)},
  };
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0, 3,-1,0, -1,3,0],3));
  const material = new THREE.ShaderMaterial({
    name:'V8AtmosphericBackground', vertexShader:VERTEX, fragmentShader:FRAGMENT, uniforms,
    defines:lowQuality?{SKY_LOW_QUALITY:1}:{}, depthTest:false, depthWrite:false,
    transparent:false, blending:THREE.NoBlending, toneMapped:true, fog:false, premultipliedAlpha:Boolean(premultipliedAlpha),
  });
  const mesh = new THREE.Mesh(geometry,material);
  mesh.name='V8AtmosphericBackground'; mesh.frustumCulled=false; mesh.renderOrder=-1000000;
  mesh.castShadow=false; mesh.receiveShadow=false;
  mesh.raycast=()=>{}; // Cannot intercept board hit tests, including recursive ones.
  mesh.userData.skyEnvironment=true;
  scene.add(mesh);
  let disposed=false, currentState=null, currentCamera=camera, explicitAspect=aspect;
  let sourceAlignment='world';
  let quality=Boolean(lowQuality), fallbackYaw=new THREE.Vector3(0,0,-1);
  const worldUp=new THREE.Vector3(0,1,0);
  const normalizeMode = mode => {
    const m = mode==='twilight'?'dusk':mode;
    if (!Object.hasOwn(PALETTE,m)) throw new RangeError('mode must be day, dusk/twilight or night');
    return m;
  };
  const parseState = next => {
    if (!next || typeof next!=='object') throw new TypeError('state must be an object');
    if ('mode' in next) { const mode=normalizeMode(next.mode); return {from:mode,to:mode,mix:1}; }
    const from=normalizeMode(next.from),to=normalizeMode(next.to),mix=next.mix;
    if (!Number.isFinite(mix) || mix<0 || mix>1) throw new RangeError('mix must be in [0,1]');
    return {from,to,mix};
  };
  function refreshOptics() {
    const y=uniforms.uSourceDirection.value.y;
    const zenith=Math.acos(Math.max(0,Math.min(1,y)));
    const path=1/(Math.cos(zenith)+.15*Math.pow(93.885-THREE.MathUtils.radToDeg(zenith),-1.253));
    const betaR=uniforms.uBetaR.value,betaM=uniforms.uBetaM.value;
    uniforms.uSunTransmittance.value.set(...['x','y','z'].map(k=>Math.exp(-(betaR[k]*8400+betaM[k]*1250)*path*.5)));
    uniforms.uSunEnergy.value=optics.daylightScale*Math.max(0,1-Math.exp(-(1.6110731556870734-Math.acos(Math.max(-1,Math.min(1,y))))/1.5));
  }
  function setState(next) {
    if (disposed) return;
    const parsed=parseState(next),a=PALETTE[parsed.from],b=PALETTE[parsed.to],t=parsed.mix;
    // Explicit mix is used directly, never wall-clock time, frame count or hidden easing.
    const dir=directionMap[parsed.from].clone().lerp(directionMap[parsed.to],t);
    if (dir.lengthSq()<1e-12) throw new RangeError('Interpolated directions cancel; provide compatible directions');
    dir.normalize();
    if (Math.abs(dir.y)>.99999) throw new RangeError('Interpolated source reaches exact zenith/nadir');
    for (const [key,name] of [['zenith','uZenith'],['horizon','uHorizon'],['nadir','uNadir'],['source','uSourceColor']]) {
      uniforms[name].value.set(a[key]).lerp(new THREE.Color(b[key]),t);
    }
    uniforms.uSourceDirection.value.copy(dir);
    uniforms.uNight.value=a.night+(b.night-a.night)*t;
    uniforms.uSourceRadius.value=THREE.MathUtils.degToRad(a.radius+(b.radius-a.radius)*t);
    uniforms.uClouds.value=(a.clouds+(b.clouds-a.clouds)*t)*optics.cloudOpacity;
    refreshOptics();
    currentState=parsed;
  }
  function setSourceDirection(value) {
    if (disposed) return;
    uniforms.uSourceDirection.value.copy(asDirection(value));
    refreshOptics();
  }
  function update(next={}) {
    if (disposed) return;
    if (!next || typeof next!=='object') throw new TypeError('update expects an object');
    const candidate=next.camera??currentCamera;
    if (!candidate?.isPerspectiveCamera && !candidate?.isOrthographicCamera) throw new TypeError('Only PerspectiveCamera and OrthographicCamera are supported');
    const nextAspect='aspect'in next?next.aspect:explicitAspect;
    if (nextAspect!==undefined && (!Number.isFinite(nextAspect)||nextAspect<=0)) throw new RangeError('aspect must be positive');
    const inferred=candidate.isPerspectiveCamera?candidate.aspect:Math.abs((candidate.right-candidate.left)/(candidate.top-candidate.bottom));
    const resolved=nextAspect??inferred;
    if (!Number.isFinite(resolved)||resolved<=0) throw new RangeError('Camera aspect must be finite and positive');
    const sourceOverride='sourceDirection'in next?asDirection(next.sourceDirection):null;
    if ('state'in next) setState(next.state);
    if (sourceOverride) { uniforms.uSourceDirection.value.copy(sourceOverride); refreshOptics(); }
    currentCamera=candidate; explicitAspect=nextAspect;
    candidate.updateWorldMatrix(true,false);
    uniforms.uInverseProjection.value.copy(candidate.projectionMatrixInverse);
    uniforms.uCameraWorld.value.copy(candidate.matrixWorld);
    uniforms.uOrthographic.value=candidate.isOrthographicCamera?1:0;
    uniforms.uAspect.value=resolved;
    const actualFov=backdropFov??(candidate.isPerspectiveCamera?candidate.getEffectiveFOV():35);
    uniforms.uTanHalfFov.value=Math.max(Math.tan(THREE.MathUtils.degToRad(actualFov)*.5),Math.tan(THREE.MathUtils.degToRad(minHorizontalFov)*.5)/resolved);
    // No hidden virtual tilt: use the actual camera's complete orientation.
    const forward=candidate.getWorldDirection(new THREE.Vector3());
    const right=new THREE.Vector3().setFromMatrixColumn(candidate.matrixWorld,0).normalize();
    const up=new THREE.Vector3().setFromMatrixColumn(candidate.matrixWorld,1).normalize();
    if (artistic && backdropElevation!==undefined) {
      const horizontal=forward.clone();horizontal.y=0;
      if(horizontal.lengthSq()>1e-8)fallbackYaw.copy(horizontal.normalize());
      const elevation=THREE.MathUtils.degToRad(backdropElevation);
      forward.copy(fallbackYaw).multiplyScalar(Math.cos(elevation)).addScaledVector(worldUp,Math.sin(elevation));
      right.crossVectors(fallbackYaw,worldUp).normalize();up.crossVectors(right,forward).normalize();
    }
    uniforms.uRight.value.copy(right);uniforms.uUp.value.copy(up);uniforms.uForward.value.copy(forward);
  }
  function alignSourcesToCamera(referenceCamera=currentCamera) {
    if (disposed) return;
    if (!artistic) throw new Error('Deprecated source alignment is only for explicit artistic staging; V7 integrations must not use it');
    if (!referenceCamera?.isCamera) throw new TypeError('camera required');
    referenceCamera.updateWorldMatrix(true,false);
    const heading=referenceCamera.getWorldDirection(new THREE.Vector3()); heading.y=0;
    if (heading.lengthSq()<1e-8) throw new RangeError('Near-vertical camera needs a nonvertical reference heading');
    heading.normalize();
    const rotation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,-1),heading);
    for (const mode of Object.keys(directionMap)) directionMap[mode].copy(baseDirections[mode]).applyQuaternion(rotation).normalize();
    sourceAlignment='explicit-initial-camera';
    setState(currentState);
    update({camera:referenceCamera});
    return getLightingState();
  }
  function setStars(next={}) {
    if(disposed)return;
    if(!next||typeof next!=='object')throw new TypeError('stars settings must be an object');
    const mode=next.mode??starMode,intensity=next.intensity??starIntensity;
    validateStars(mode,intensity);
    starMode=mode;starIntensity=intensity;
    uniforms.uStarMode.value=starModes[mode];uniforms.uStarIntensity.value=intensity;
  }
  function setQuality(value) {
    if (disposed) return;
    const next=typeof value==='object'?Boolean(value.lowQuality):Boolean(value);
    if (next===quality) return;
    quality=next; material.defines=quality?{SKY_LOW_QUALITY:1}:{}; material.needsUpdate=true;
  }
  function getLightingState() {
    return {
      direction:uniforms.uSourceDirection.value.clone(),
      sourceColor:uniforms.uSourceColor.value.clone(),
      source:uniforms.uNight.value===1?'moon':uniforms.uNight.value<.15?'sun':'blend',
      nightMix:uniforms.uNight.value,
      angularRadius:uniforms.uSourceRadius.value,
    };
  }
  /** Project source into THIS background's projection, not the board camera. */
  function projectDirection(value=uniforms.uSourceDirection.value) {
    const dir=asDirection(value),tan=uniforms.uTanHalfFov.value;
    let x,y,forward;
    if (artistic) {
      forward=dir.dot(uniforms.uForward.value);
      x=dir.dot(uniforms.uRight.value)/(forward*tan*uniforms.uAspect.value);
      y=dir.dot(uniforms.uUp.value)/(forward*tan);
    } else if (currentCamera.isOrthographicCamera) {
      const view=currentCamera.getWorldDirection(new THREE.Vector3());
      const angle=dir.angleTo(view);
      return {x:null,y:null,visible:angle<=uniforms.uSourceRadius.value&&dir.y>0,parallelRays:true};
    } else {
      const view=dir.clone().transformDirection(currentCamera.matrixWorldInverse);
      const p=new THREE.Vector4(view.x,view.y,view.z,0).applyMatrix4(currentCamera.projectionMatrix);
      x=p.x/p.w; y=p.y/p.w; forward=-view.z;
    }
    return {x,y,visible:forward>0&&dir.y>0&&Math.abs(x)<=1&&Math.abs(y)<=1,parallelRays:false};
  }
  function getProjectionState() {
    return {style,aspect:uniforms.uAspect.value,orthographic:Boolean(uniforms.uOrthographic.value),
      backdropElevation:backdropElevation??null,backdropFov:backdropFov??null,minHorizontalFov,sourceAlignment,effectiveVerticalFov:THREE.MathUtils.radToDeg(2*Math.atan(uniforms.uTanHalfFov.value)),right:uniforms.uRight.value.clone(),up:uniforms.uUp.value.clone(),forward:uniforms.uForward.value.clone(),
      sourceProjection:projectDirection(),adaptation:artistic?'Explicit artistic perspective uses the actual camera orientation by default; no guaranteed sun/moon visibility. Orthographic surrogate FOV is not a physical co-projection.':'Physical infinite directional sky; orthographic rays are parallel. No source visibility guarantee.'};
  }
  function getState() { return {...currentState,lowQuality:quality,opacity,profile,starMode,starIntensity,disposed}; }
  function dispose() {
    if (disposed) return; disposed=true;
    mesh.removeFromParent(); mesh.onBeforeRender=()=>{}; geometry.dispose(); material.dispose();
  }
  const renderViewport=new THREE.Vector4();
  mesh.onBeforeRender=(renderer,_scene,renderCamera)=>{
    // View-offset cameras (Catan) may have a virtual aspect unlike the canvas.
    // Read the actual viewport without changing renderer state or a saved override.
    const savedAspect=explicitAspect;
    let renderAspect=savedAspect;
    if (renderAspect===undefined && renderer?.getViewport) {
      renderer.getViewport(renderViewport);
      if (renderViewport.z>0 && renderViewport.w>0) renderAspect=renderViewport.z/renderViewport.w;
    }
    try { update({camera:renderCamera,aspect:renderAspect}); }
    finally { explicitAspect=savedAspect; }
  };
  try { setState(state); update(); }
  catch(error) { dispose(); throw error; }
  return {mesh,material,uniforms,setState,setSourceDirection,alignSourcesToCamera,update,setQuality,setStars,getState,getLightingState,getProjectionState,projectDirection,dispose};
}
