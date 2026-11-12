import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {collectModelAssets,modelAssetPlugin,cloudflareHeaders,digest,IMMUTABLE_CACHE,REVALIDATE_CACHE} from '../scripts/asset-cache.mjs';
import {staticAssets} from '../server/static-assets.js';
import {createModelByteCache} from '../src/visuals/model-byte-cache.js';
import worker from '../worker/index.js';

const logical='/assets/v9/model.glb';
function glb(label,uri){const text=JSON.stringify({asset:{version:'2.0',generator:label},buffers:uri?[{uri}]:[]}),json=Buffer.from(text.padEnd(Math.ceil(text.length/4)*4));const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(header.length+json.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);return Buffer.concat([header,json]);}
async function temporary(fn){const dir=await mkdtemp(path.join(tmpdir(),'catan-assets-'));try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}
async function put(dir,name,bytes){await mkdir(path.dirname(path.join(dir,name)),{recursive:true});await writeFile(path.join(dir,name),bytes);}
async function output(dir,entries){const plugin=modelAssetPlugin(entries),bundle={};plugin.configResolved({root:dir,build:{outDir:'dist'}});plugin.buildStart.call({emitFile(asset){bundle[asset.fileName]={...asset};}});for(const e of entries)await put(path.join(dir,'dist'),e.logical,e.bytes);for(const [file,asset]of Object.entries(bundle))await put(path.join(dir,'dist'),file,asset.source);await plugin.writeBundle({},bundle);return JSON.parse(await readFile(path.join(dir,'dist/asset-cache-manifest.json'),'utf8'));}

test('model URLs are content hashes, stable across builds/editions and only changed bytes get new URLs',async()=>temporary(async dir=>{
  const publicDir=path.join(dir,'public');await put(publicDir,logical,glb('a'));await put(publicDir,'/assets/v9/unchanged.glb',glb('stable'));
  const first=await collectModelAssets(publicDir),again=await collectModelAssets(publicDir);assert.deepEqual(first,again);
  const original=await output(dir,first);assert.equal(Object.keys(original.models).length,2);
  await assert.rejects(readFile(path.join(dir,'dist',logical)),{code:'ENOENT'},'release contains no duplicate fixed-path GLB');
  for(const entry of first){assert.match(entry.url,new RegExp(digest(entry.bytes)));assert.deepEqual(await readFile(path.join(dir,'dist',entry.url)),entry.bytes);}
  await put(publicDir,logical,glb('b'));const changed=await collectModelAssets(publicDir);assert.notEqual(changed[0].url,first[0].url);assert.equal(changed[1].url,first[1].url);
  await put(publicDir,logical,glb('a'));assert.deepEqual(await collectModelAssets(publicDir),first,'rollback restores identical URLs, not a new deploy identifier');
  await put(publicDir,logical,glb('external','texture.bin'));await assert.rejects(collectModelAssets(publicDir),/External GLB dependency/);
}));
test('Cloudflare emits explicit immutable paths, revalidates HTML/fixed files and rejects rule overflow',()=>{
  const headers=cloudflareHeaders(['/assets/content/hash/model.glb']);assert.ok(headers.startsWith(`/*\n  Cache-Control: ${REVALIDATE_CACHE}`));assert.match(headers,/! Cache-Control\n  Cache-Control: public, max-age=31536000, immutable/);assert.doesNotMatch(headers,/\/assets\/\*/);assert.throws(()=>cloudflareHeaders(Array(100).fill('/hash')),/limit/);
});
test('Node HTTP: long cache only verified hashes; 304 unchanged, 200 changed, no stale HTML or missing-model fallback',async()=>temporary(async dir=>{
  const bytes=glb('one'),hashed=`/assets/content/${digest(bytes)}/model.glb`,dist=path.join(dir,'dist');await put(dist,hashed,bytes);await put(dist,'index.html','<html>first</html>');await put(dist,'build-info.json','{"revision":"a"}');await put(dist,'fixed.txt','fixed');
  await put(dist,'asset-cache-manifest.json',JSON.stringify({schema:1,models:{[logical]:hashed},files:{[hashed]:{etag:`"${digest(bytes)}"`,size:bytes.length}}}));
  let handler=await staticAssets(dist),requests=[];const server=http.createServer((req,res)=>{requests.push(req.url);handler(req,res,new URL(req.url,'http://local')).catch(e=>{res.writeHead(500);res.end(e.message);});});server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
  try{
    const first=await fetch(origin+hashed);assert.equal(first.status,200);assert.equal(first.headers.get('cache-control'),IMMUTABLE_CACHE);assert.equal(first.headers.get('content-type'),'model/gltf-binary');assert.deepEqual(Buffer.from(await first.arrayBuffer()),bytes);const tag=first.headers.get('etag');
    const same=await fetch(origin+hashed,{headers:{'If-None-Match':tag}});assert.equal(same.status,304);assert.equal((await same.arrayBuffer()).byteLength,0);
    assert.equal((await fetch(origin+hashed,{headers:{'If-None-Match':`W/${tag}`}})).status,304);
    const head=await fetch(origin+hashed,{method:'HEAD'});assert.equal(head.headers.get('content-length'),String(bytes.length));assert.equal((await head.arrayBuffer()).byteLength,0);
    const old=await fetch(origin+logical,{redirect:'manual'});assert.equal(old.status,302);assert.equal(old.headers.get('location'),hashed);assert.equal(old.headers.get('cache-control'),REVALIDATE_CACHE);
    const html=await fetch(origin+'/');assert.equal(html.headers.get('cache-control'),REVALIDATE_CACHE);const htmlTag=html.headers.get('etag');await html.text();assert.equal((await fetch(origin+'/',{headers:{'If-None-Match':htmlTag}})).status,304);
    await put(dist,'index.html','<html>updated</html>');const update=await fetch(origin+'/',{headers:{'If-None-Match':htmlTag}});assert.equal(update.status,200);assert.equal(await update.text(),'<html>updated</html>');
    for(const uri of ['/build-info.json','/fixed.txt','/asset-cache-manifest.json']){const r=await fetch(origin+uri);assert.equal(r.headers.get('cache-control'),REVALIDATE_CACHE);await r.text();}
    for(const uri of ['/assets/content/missing/model.glb','/assets/missing','/_headers']){const r=await fetch(origin+uri);assert.equal(r.status,404);assert.equal(r.headers.get('cache-control'),'no-store');assert.notEqual(await r.text(),'<html>updated</html>');}
    // A partial/mutated artifact is not blessed immutable just because its path looks hashed.
    await put(dist,hashed,glb('tampered'));const mismatched=await fetch(origin+hashed,{headers:{'If-None-Match':tag}});assert.equal(mismatched.status,200);assert.equal(mismatched.headers.get('cache-control'),REVALIDATE_CACHE);await mismatched.arrayBuffer();
    // A cache clear/eviction can always fetch the exact current bytes again.
    await put(dist,hashed,bytes);handler=await staticAssets(dist);assert.equal((await fetch(origin+hashed)).status,200);assert.ok(requests.length>10);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}));
test('parse failure evicts bytes and forces exactly the next explicit attempt past HTTP cache',async()=>{
  const modes=[],cache=createModelByteCache({fetcher:async(_url,options)=>{modes.push(options.cache);return {ok:true,arrayBuffer:async()=>new ArrayBuffer(8)};}});
  await cache.load('/hash');cache.evict('/hash',{forceReload:true});await cache.load('/hash');await cache.load('/hash');cache.clear();await cache.load('/hash');assert.deepEqual(modes,['default','reload','default']);
});
test('Worker unknown hash stays 404/no-store; clean navigation can use the current shell',async()=>{
  const calls=[],env={BACKEND_ID:'local',SITE_EDITION:'global',ASSETS:{fetch:async request=>{const url=new URL(request.url);calls.push(url.pathname);return url.pathname==='/'?new Response('<html>shell</html>',{headers:{'cache-control':REVALIDATE_CACHE}}):new Response('Not found',{status:404,headers:{'cache-control':IMMUTABLE_CACHE}});}}};
  const missing=await worker.fetch(new Request('https://test/assets/content/old/model.glb'),env);assert.equal(missing.status,404);assert.equal(missing.headers.get('cache-control'),'no-store');assert.equal(await missing.text(),'Not found');
  const clean=await worker.fetch(new Request('https://test/lobby'),env);assert.equal(await clean.text(),'<html>shell</html>');assert.equal(clean.headers.get('cache-control'),REVALIDATE_CACHE);assert.deepEqual(calls,['/assets/content/old/model.glb','/lobby','/']);
});

test('Node release switch: unchanged model 304, changed model new URL/200, rollback reuses the old URL',async()=>temporary(async dir=>{
  const dist=path.join(dir,'dist'),a=glb('version-a'),b=glb('version-b'),stable=glb('unchanged');
  const url=bytes=>`/assets/content/${digest(bytes)}/model.glb`,urls={a:url(a),b:url(b),stable:url(stable)};
  async function release(version){
    const entries=[{logical,url:urls[version],bytes:version==='a'?a:b},{logical:'/assets/v9/stable.glb',url:urls.stable,bytes:stable}];
    const manifest={schema:1,models:{},files:{}};
    for(const entry of entries){await put(dist,entry.url,entry.bytes);manifest.models[entry.logical]=entry.url;manifest.files[entry.url]={etag:`"${digest(entry.bytes)}"`,size:entry.bytes.length};}
    await put(dist,'asset-cache-manifest.json',JSON.stringify(manifest));return staticAssets(dist);
  }
  let handler=await release('a');const server=http.createServer((req,res)=>{handler(req,res,new URL(req.url,'http://local')).catch(()=>{res.writeHead(500);res.end();});});server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
  try{
    const tags={};for(const key of ['a','stable']){const response=await fetch(origin+urls[key]);tags[key]=response.headers.get('etag');assert.equal(response.status,200);await response.arrayBuffer();}
    handler=await release('b');await rm(path.join(dist,urls.a));
    const keep=await fetch(origin+urls.stable,{headers:{'If-None-Match':tags.stable}});assert.equal(keep.status,304);assert.equal((await keep.arrayBuffer()).byteLength,0);
    const change=await fetch(origin+urls.b,{headers:{'If-None-Match':tags.a}});assert.equal(change.status,200);assert.equal(change.headers.get('cache-control'),IMMUTABLE_CACHE);assert.deepEqual(Buffer.from(await change.arrayBuffer()),b);
    const old=await fetch(origin+urls.a);assert.equal(old.status,404);assert.equal(old.headers.get('cache-control'),'no-store');await old.text();
    const alias=await fetch(origin+logical,{redirect:'manual'});assert.equal(alias.headers.get('location'),urls.b);
    handler=await release('a');await rm(path.join(dist,urls.b));
    const rollback=await fetch(origin+urls.a,{headers:{'If-None-Match':tags.a}});assert.equal(rollback.status,304);assert.equal((await rollback.arrayBuffer()).byteLength,0);
    assert.equal((await fetch(origin+logical,{redirect:'manual'})).headers.get('location'),urls.a);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}));
