import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const IMMUTABLE_CACHE='public, max-age=31536000, immutable';
export const REVALIDATE_CACHE='public, max-age=0, must-revalidate';
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function filesAt(root,prefix=''){
  const files=[];
  for(const entry of await readdir(path.join(root,prefix),{withFileTypes:true})){
    const name=path.posix.join(prefix,entry.name);
    if(entry.isDirectory())files.push(...await filesAt(root,name));
    else if(entry.isFile())files.push(name);
  }
  return files.sort();
}
export async function collectModelAssets(publicDir){
  if(publicDir instanceof URL)publicDir=fileURLToPath(publicDir);
  const entries=[];
  for(const file of await filesAt(publicDir))if(file.endsWith('.glb')){
    const bytes=await readFile(path.join(publicDir,file));
    // The fingerprint must cover every byte on which the model depends.
    // External textures/buffers need a dependency-aware pipeline, not a GLB-only hash.
    if(bytes.readUInt32LE(0)!==0x46546c67)throw Error(`Invalid GLB: ${file}`);
    const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
    if([...json.buffers||[],...json.images||[]].some(item=>item.uri&&!item.uri.startsWith('data:')))throw Error(`External GLB dependency: ${file}`);
    entries.push({logical:'/'+file,url:`/assets/content/${digest(bytes)}/${path.basename(file)}`,bytes});
  }
  return entries;
}
export function cloudflareHeaders(urls){
  // Exact paths avoid caching a missing/removed asset's SPA fallback as immutable.
  // Workers accepts at most 100 rules. Fail loudly rather than silently losing policy.
  if(urls.length+1>100)throw Error('Asset header rules exceed Cloudflare limit; update the cache routing design.');
  return `/*\n  Cache-Control: ${REVALIDATE_CACHE}\n\n`+urls.map(url=>`${url}\n  ! Cache-Control\n  Cache-Control: ${IMMUTABLE_CACHE}\n`).join('\n');
}
export function modelAssetPlugin(entries){
  let output;
  return {
    name:'catan-content-addressed-models',apply:'build',
    configResolved(config){output=path.resolve(config.root,config.build.outDir);},
    buildStart(){for(const entry of entries)this.emitFile({type:'asset',fileName:entry.url.slice(1),source:entry.bytes});},
    async writeBundle(_options,bundle){
      const files={};
      for(const [file,item]of Object.entries(bundle)){
        if(!file.startsWith('assets/'))continue;
        const bytes=item.type==='chunk'?Buffer.from(item.code):Buffer.from(item.source);
        files['/'+file]={etag:`"${digest(bytes)}"`,size:bytes.byteLength};
      }
      const models=Object.fromEntries(entries.map(e=>[e.logical,e.url]));
      // No second copy of the large models in the release. Legacy fixed URLs get
      // a temporary redirect, never a one-year immutable response.
      for(const entry of entries)await rm(path.join(output,entry.logical.slice(1)));
      await writeFile(path.join(output,'asset-cache-manifest.json'),JSON.stringify({schema:1,models,files})+'\n');
      await writeFile(path.join(output,'_headers'),cloudflareHeaders(Object.keys(files)));
      await writeFile(path.join(output,'_redirects'),entries.map(e=>`${e.logical} ${e.url} 302`).join('\n')+'\n');
    }
  };
}
