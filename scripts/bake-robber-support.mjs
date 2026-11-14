// Run when support geometry, readability mapping or the robber footprint changes.
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {robberSupport} from '../src/visuals/robber.js';
import {enhanceTerrainReadability} from '../src/visuals/terrain-readability.js';
const root=new URL('../public/assets/v9/catan/variants/models/',import.meta.url),data={};
for(const file of await readdir(root)){
 const bytes=await readFile(new URL(file,root)),{scene}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 enhanceTerrainReadability(scene,file.match(/catan_terrain_([a-z]+)_/)[1]);
 data[file.replace('.glb','')]={sha256:createHash('sha256').update(bytes).digest('hex'),poses:Array.from({length:6},(_,i)=>robberSupport(scene,i*Math.PI/3))};
}
await writeFile(new URL('../src/visuals/robber-support-data.js',import.meta.url),'// Baked from unchanged source GLBs after the runtime readability mapping and enlarged robber footprint.\nexport const ROBBER_SUPPORT='+JSON.stringify(data,null,2)+';\n');
console.log('Baked',Object.keys(data).length,'variants; maximum obstruction',Math.max(...Object.values(data).flatMap(x=>x.poses.map(p=>p.obstruction))));
