import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

// Cache bytes, never live Three.js objects: switching 2D/3D can reuse a download
// while each Board still owns and disposes its geometry/materials independently.
// Page-local, bounded and short-lived; content-addressed HTTP disk cache persists
// across reloads. Versioned paths/query strings are separate keys.
export function createModelByteCache({maxBytes=24*1024*1024,ttlMs=5*60*1000,timeoutMs=30000,fetcher=(...args)=>fetch(...args),now=()=>Date.now()}={}) {
  const entries=new Map(),reload=new Set();let bytes=0;
  function remove(key,entry){if(entries.get(key)!==entry)return;entries.delete(key);bytes-=entry.bytes||0;}
  function trim(){for(const [key,entry]of entries)if(entry.bytes&&(now()-entry.used>ttlMs||bytes>maxBytes))remove(key,entry);}
  function load(url){
    trim();let entry=entries.get(url);
    if(entry){entry.used=now();entries.delete(url);entries.set(url,entry);return entry.promise;}
    entry={used:now(),bytes:0};entries.set(url,entry);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    entry.promise=(async()=>{
      const cache=reload.delete(url)?'reload':'default';
      const response=await fetcher(url,{signal:controller.signal,cache});
      if(!response.ok)throw new Error(`Model request failed (${response.status})`);
      const buffer=await response.arrayBuffer();
      if(entries.get(url)===entry){entry.bytes=buffer.byteLength;entry.used=now();bytes+=entry.bytes;trim();}return buffer;
    })().catch(error=>{remove(url,entry);throw error;}).finally(()=>clearTimeout(timer));
    return entry.promise;
  }
  return {load,evict(url,{forceReload=false}={}){const entry=entries.get(url);if(entry)remove(url,entry);if(forceReload)reload.add(url);},stats:()=>({entries:entries.size,bytes}),clear(){entries.clear();reload.clear();bytes=0;}};
}
export function modelAssetURL(url){return typeof __MODEL_ASSET_URLS__!=='undefined'?__MODEL_ASSET_URLS__[url]||url:url;}
const modelBytes=createModelByteCache();
export class CachedModelLoader extends GLTFLoader {
  async loadAsync(url){
    url=modelAssetURL(url);
    const bytes=await modelBytes.load(url);
    try{return await this.parseAsync(bytes,url.slice(0,url.lastIndexOf('/')+1));}
    catch(error){modelBytes.evict(url,{forceReload:true});throw error;}
  }
}
