import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {terrain} from '../src/terrain.js';
import {resourceIllustration} from '../src/icons.js';
import {alignTerrainPalette,TERRAIN_SURFACE} from '../src/visuals/terrain-readability.js';
import {BoardModels,TERRAIN_URL} from '../src/visuals/board-models.js';
import {COLORS} from '../shared/board.js';
import {createHomeExample} from '../src/home-showcase.js';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const parse=async file=>{const b=await readFile(new URL('../public'+file,import.meta.url));return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');};
const mapping={forest:'wood',clay:'brick',sheep:'sheep',wheat:'wheat',ore:'ore'};
const colors={wood:'#397456',brick:'#ae674a',sheep:'#66863e',wheat:'#a28027',ore:'#637e8c'};

test('resource and feedback tokens match both design records without changing player identity colors',async()=>{
 const css=await read('src/tokens.css'),design=await read('DESIGN.md'),json=JSON.parse(await read('.impeccable/design.json'));
 const values=Object.fromEntries([...css.split('@media')[0].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m=>[m[1],m[2]]));
 assert.deepEqual(json.extensions.tokens,values);
 for(const [r,value]of Object.entries({...colors,'feedback-gain':'#c99b3f','feedback-robber':'#493e57','feedback-select':'#c99b3f'})){
  assert.equal(values['--'+r],value);assert.ok(design.includes(`  ${r}: "${value}"`));
 }
 assert.deepEqual(terrain,{wood:0x477e5f,brick:0xb97854,sheep:0x7d9c4f,wheat:0xb08f31,ore:0x6d8794,desert:0xdfc88d});
 for(const [r,value]of Object.entries(terrain))assert.equal(json.extensions.terrainPalette[r],'#'+value.toString(16));
 assert.deepEqual(COLORS,['#e57c54','#5997d0','#e6bd55','#ae8bca','#52a57b','#a47b54']);
 assert.equal(createHomeExample('#123456').players[0].color,'#123456');
 assert.match(await read('src/main.js'),/createHomeExample\(getComputedStyle\(document.documentElement\).getPropertyValue\('--accent'\)/);
 assert.match(await read('src/ui/table.tsx'),/owner\?\.color \|\| "var\(--line\)"/);
});

test('standalone resource illustrations carry token main fills and keep recognizable detail',()=>{
 for(const [r,value]of Object.entries(colors)){
  const svg=resourceIllustration(r);assert.ok(svg.includes(`fill="${value}"`),r+' has its main resource color');
  assert.ok(new Set([...svg.matchAll(/(?:fill|stroke)="(#[a-f0-9]+)"/g)].map(m=>m[1])).size>=4,r+' retains light and shade');
  assert.ok(!svg.includes('var('),'standalone image/canvas textures must resolve their own fills');
 }
 assert.ok(resourceIllustration('sheep').includes('fill="#fffdf0"'),'sheep keep white wool');
 assert.ok(resourceIllustration('wood').includes('fill="#8e6240"'),'trees keep brown trunks');
});

test('all 17 actual V9 variants align surface hue while preserving geometry, neutrals, detail and idempotence',async()=>{
 let changed=0,deserts=0;const color=new THREE.Color(),hsl={};
 for(const file of await readdir(new URL('../public'+TERRAIN_URL,import.meta.url))){
  const {scene}=await parse(TERRAIN_URL+file),resource=file.match(/catan_terrain_([a-z]+)_/)[1],before=[];
  scene.traverse(m=>{if(m.isMesh)before.push({m,positions:m.geometry.attributes.position.array.slice(),indices:m.geometry.index.array.slice(),colors:m.geometry.attributes.color.array.slice()});});
  alignTerrainPalette(scene,resource);
  const target=mapping[resource]&&new THREE.Color(terrain[mapping[resource]]).getHSL({},THREE.SRGBColorSpace);
  let n=0,l=0,min=1,max=0;
  for(const {m,positions,indices,colors:old}of before){
   const now=m.geometry.attributes.color,p=m.geometry.attributes.position;
   assert.deepEqual(p.array,positions,'palette never changes positions');assert.deepEqual(m.geometry.index.array,indices,'palette never changes indices');
   if(resource==='desert'||resource==='sheep'&&m.name.endsWith('_decoration')){assert.deepEqual(now.array,old,'desert and sheep detail remain untouched');continue;}
   for(let i=0;i<now.count;i++){
    const oldHSL=new THREE.Color().setRGB(old[i*3],old[i*3+1],old[i*3+2]).getHSL({},THREE.SRGBColorSpace);
    if(m.name.endsWith('_ground')&&p.getY(i)<TERRAIN_SURFACE-1e-5||resource==='forest'&&m.name.endsWith('_decoration')&&(oldHSL.h<.20||oldHSL.h>.48)){
     assert.deepEqual(Array.from(now.array.slice(i*3,i*3+3)),Array.from(old.slice(i*3,i*3+3)),'earth rims and tree trunks remain untouched');continue;
    }
    color.fromBufferAttribute(now,i).getHSL(hsl,THREE.SRGBColorSpace);assert.ok(Math.abs(hsl.h-target.h)<1e-5,'same resource hue');
    if(m.name.endsWith('_ground')){l+=hsl.l;n++;min=Math.min(min,hsl.l);max=Math.max(max,hsl.l);}
   }
  }
  if(target){changed++;assert.ok(Math.abs(l/n-target.l)<1e-5,'ground mean follows brighter terrain anchor');assert.ok(max-min>.005,'facet shading is retained');}
  else deserts++;
  const once=before.map(({m})=>m.geometry.attributes.color.array.slice());alignTerrainPalette(scene,resource);
  before.forEach(({m},i)=>assert.deepEqual(m.geometry.attributes.color.array,once[i],'repeated calls do not compound color shifts'));
 }
 assert.equal(changed,15);assert.equal(deserts,2);
});

test('normal GLB loading applies the shared palette before creating terrain instances',async()=>{
 const models=new BoardModels({Loader:class{loadAsync(url){return parse(url);}}}),url=TERRAIN_URL+'catan_terrain_forest_01.glb';
 await models.load(url);const scene=models.ready.get(url);assert.equal(scene.userData.terrainPalette,'wood');assert.equal(scene.userData.terrainReadability,'forest');
 const layer=new THREE.Group();assert.equal(models.add(layer,url,[{x:0,z:0}],{tileIds:[0]}),true);
 for(const mesh of layer.children)assert.ok(mesh.geometry.attributes.color,'instances consume aligned vertex colors');
 models.releaseLayer(layer);await models.dispose();
});

test('production, robber and port feedback resolve semantic colors instead of old inline hex colors',async()=>{
 const css=await read('src/commerce.css');
 assert.match(css,/\.production-outline\s*\{[^}]*stroke:var\(--feedback-gain\)/);
 assert.match(css,/\.robber-outline\s*\{[^}]*stroke:var\(--feedback-robber\)/);
 assert.match(css,/\[data-port\]\[data-selected=true\]\s*\{[^}]*var\(--feedback-select\)/);
 assert.doesNotMatch(css,/#(?:f1c86e|92762e|493e57|d8ad58)\b/);
});
