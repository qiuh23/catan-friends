// Offline grouping only. Runtime uses small baked ranges, never mesh clustering.
import {readFile,readdir,writeFile} from 'node:fs/promises';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const dir=new URL('../public/assets/v9/catan/variants/models/',import.meta.url),result={};
const targets={forest:1.18,wheat:1.20,sheep:1.55,ore:1.50,clay:1.50,desert:1.30};
for(const file of await readdir(dir)){
 const b=await readFile(new URL(file,dir)),{scene}=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');const mesh=scene.children.find(x=>x.name.endsWith('_decoration'));const g=mesh.geometry,p=g.attributes.position,idx=g.index.array,parent=Array.from({length:p.count},(_,i)=>i),seen=new Map();const root=i=>parent[i]===i?i:parent[i]=root(parent[i]);const union=(a,b)=>parent[root(b)]=root(a);
 for(let i=0;i<p.count;i++){const key=[p.getX(i),p.getY(i),p.getZ(i)].map(n=>Math.round(n*1e5)).join(',');if(seen.has(key))union(i,seen.get(key));else seen.set(key,i);}
 for(let i=0;i<idx.length;i+=3){union(idx[i],idx[i+1]);union(idx[i],idx[i+2]);}
 const by=new Map();for(let i=0;i<p.count;i++){const r=root(i);if(!by.has(r))by.set(r,{ids:[],min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]});const c=by.get(r);c.ids.push(i);for(let a=0;a<3;a++){const n=p.array[i*3+a];c.min[a]=Math.min(c.min[a],n);c.max[a]=Math.max(c.max[a],n);}}
 let groups=[...by.values()],merges=0;
 // Group overlapping parts of one tree/sheep/sheaf, never infer from appearance RNG.
 for(let changed=true;changed;){changed=false;outer:for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++)if(groups[i].min.every((n,a)=>n<=groups[j].max[a]+.012&&groups[i].max[a]>=groups[j].min[a]-.012)){
  const a=groups[i],b=groups[j];a.ids.push(...b.ids);a.min=a.min.map((n,k)=>Math.min(n,b.min[k]));a.max=a.max.map((n,k)=>Math.max(n,b.max[k]));groups.splice(j,1);merges++;changed=true;break outer;
 }}
 const resource=file.match(/catan_terrain_([a-z]+)_/)[1],rows=[];
 for(const group of groups){
  const cx=(group.min[0]+group.max[0])/2,cz=(group.min[2]+group.max[2])/2,ids=new Set(group.ids);
  const triangles=[];for(let i=0;i<idx.length;i+=3)if(ids.has(idx[i]))triangles.push([idx[i],idx[i+1],idx[i+2]]);
  const vertexClearance=scale=>{
   let minimum=Infinity;
   for(const triangle of triangles){const v=triangle.map(i=>[cx+(p.getX(i)-cx)*scale,cz+(p.getZ(i)-cz)*scale]);
    for(let a=0;a<6;a++){const vx=Math.cos(Math.PI/6+a*Math.PI/3),vz=Math.sin(Math.PI/6+a*Math.PI/3);
     for(let i=0;i<3;i++){const [x,z]=v[i],[bx,bz]=v[(i+1)%3],dx=bx-x,dz=bz-z,t=Math.max(0,Math.min(1,((vx-x)*dx+(vz-z)*dz)/(dx*dx+dz*dz)||0));minimum=Math.min(minimum,Math.hypot(x+t*dx-vx,z+t*dz-vz));}
    }
   }return minimum;
  };
  const vertexMargin=Math.min(.25,vertexClearance(1));
  const safe=scale=>{
   if(vertexClearance(scale)<vertexMargin-1e-7)return false;
   const point=i=>[cx+(p.getX(i)-cx)*scale,cz+(p.getZ(i)-cz)*scale];
   for(const i of group.ids){const [x,z]=point(i);for(let a=0;a<6;a++)if(x*Math.cos(a*Math.PI/3)+z*Math.sin(a*Math.PI/3)>Math.sqrt(3)/2-.10)return false;}
   for(const triangle of triangles){const v=triangle.map(point);for(let i=0;i<3;i++){const [x,z]=v[i],[bx,bz]=v[(i+1)%3],dx=bx-x,dz=bz-z,t=Math.max(0,Math.min(1,-(x*dx+z*dz)/(dx*dx+dz*dz)||0));if(Math.hypot(x+t*dx,z+t*dz)<.35)return false;}}
   return true;
  };
  let low=1,high=targets[resource];for(let i=0;i<20;i++){const mid=(low+high)/2;if(safe(mid))low=mid;else high=mid;}
  const scale=Math.floor(low*10000)/10000,ranges=[];group.ids.sort((a,b)=>a-b);for(const id of group.ids){const last=ranges.at(-1);if(last&&last[1]===id)last[1]++;else ranges.push([id,id+1]);}
  rows.push({center:[cx,cz],scale,ranges});
 }
 result[mesh.name]={vertices:p.count,groups:rows};
 console.log(file,rows.map(g=>g.scale));
}

await writeFile(new URL('../src/visuals/terrain-decoration-layout.js',import.meta.url),'// Generated from the existing GLB decoration parts by bake-terrain-readability.mjs.\nexport const DECORATION_LAYOUT='+JSON.stringify(result)+';\n');
