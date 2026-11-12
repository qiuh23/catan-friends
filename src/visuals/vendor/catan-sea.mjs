/** Cheap static radial sea colour. No textures, reflection target, lights, renderer or RAF. */
const PRESETS={day:{shallow:0x3997ac,deep:0x245d8d},dusk:{shallow:0x446f91,deep:0x283f67},night:{shallow:0x22516e,deep:0x102d4b}};
export function createCatanSeaMaterial(THREE,{radius=5.8,center=[0,0],phase='day'}={}){
 if(!(radius>0)||!Number.isFinite(radius)||!Array.isArray(center)||center.length!==2||!Number.isFinite(center[0])||!Number.isFinite(center[1]))throw new TypeError('positive radius and finite center[x,z] required');
 if(!Object.hasOwn(PRESETS,phase))throw new RangeError('unknown phase');
 const uniforms={uRadius:{value:radius},uCenter:{value:new THREE.Vector2(...center)},uShallow:{value:new THREE.Color()},uDeep:{value:new THREE.Color()}};
 const material=new THREE.ShaderMaterial({name:'CatanSeaV7',uniforms,transparent:false,depthWrite:true,toneMapped:false,
 vertexShader:`varying vec2 vXZ;void main(){vec4 w=modelMatrix*vec4(position,1.);vXZ=w.xz;gl_Position=projectionMatrix*viewMatrix*w;}`,
 fragmentShader:`uniform float uRadius;uniform vec2 uCenter;uniform vec3 uShallow,uDeep;varying vec2 vXZ;void main(){float r=length(vXZ-uCenter)/uRadius;float band=smoothstep(.66,1.03,r);float ripple=sin(vXZ.x*5.3+vXZ.y*1.1)*sin(vXZ.y*9.7-vXZ.x*.8)*.018;vec3 c=mix(uShallow,uDeep,clamp(band+ripple,0.,1.));gl_FragColor=vec4(c,1.);#include <colorspace_fragment>}`.replace(';#include',';\n#include').replace('<colorspace_fragment>}','<colorspace_fragment>\n}')+'\n'});
 let disposed=false,state={from:phase,to:phase,mix:1};
 function setState(next){if(disposed)return;let from,to,mix;if('phase'in next){from=to=next.phase;mix=1;}else({from,to,mix}=next);if(!Object.hasOwn(PRESETS,from)||!Object.hasOwn(PRESETS,to)||!Number.isFinite(mix)||mix<0||mix>1)throw new RangeError('valid phase or from/to/mix required');for(const [k,u]of [['shallow','uShallow'],['deep','uDeep']])uniforms[u].value.set(PRESETS[from][k]).lerp(new THREE.Color(PRESETS[to][k]),mix);state={from,to,mix};}
 function setRadius(value){if(disposed)return;if(!(value>0)||!Number.isFinite(value))throw new RangeError('positive radius required');uniforms.uRadius.value=value;}
 function dispose(){if(disposed)return;disposed=true;material.dispose();}
 setState({phase});return {material,setState,setRadius,getState:()=>({...state,disposed}),dispose};
}
