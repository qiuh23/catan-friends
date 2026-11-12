import {spawn} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=process.cwd(),origin='http://127.0.0.1:8792',manifest=JSON.parse(await readFile('dist/asset-cache-manifest.json','utf8'));
const processHandle=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--config','wrangler.local.jsonc','--local','--ip','127.0.0.1','--port','8792','--inspector-port','0'],{cwd:root,env:{...process.env,XDG_CONFIG_HOME:process.env.XDG_CONFIG_HOME||root+'/.local/wrangler-config',WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe']});
let log='';processHandle.stdout.on('data',data=>log+=data);processHandle.stderr.on('data',data=>log+=data);
try{
  let ready=false;for(let i=0;i<80;i++){try{const r=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(800)});if(r.ok){ready=true;break;}}catch{}if(processHandle.exitCode!==null)break;await new Promise(r=>setTimeout(r,500));}
  if(!ready)throw Error('Local Worker unavailable\n'+log);
  const logical=Object.keys(manifest.models)[0],hashed=manifest.models[logical],results=[];
  for(const path of ['/', '/build-info.json',hashed,logical,'/assets/content/missing/model.glb']){const r=await fetch(origin+path,{redirect:'manual'});results.push({path,status:r.status,cache:r.headers.get('cache-control'),etag:r.headers.get('etag'),location:r.headers.get('location'),type:r.headers.get('content-type')});await r.arrayBuffer();}
  assert.match(results[0].cache,/max-age=0/);assert.match(results[1].cache,/max-age=0/);assert.equal(results[2].cache,'public, max-age=31536000, immutable');assert.equal(results[3].status,302);assert.equal(results[3].location,hashed);assert.equal(results[4].status,404);assert.equal(results[4].cache,'no-store');
  const conditional=await fetch(origin+hashed,{headers:{'If-None-Match':results[2].etag}});assert.equal(conditional.status,304);results.push({path:hashed,conditional:true,status:conditional.status,bytes:(await conditional.arrayBuffer()).byteLength});
  await mkdir('test-results/asset-cache',{recursive:true});await writeFile('test-results/asset-cache/worker-http.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{processHandle.kill('SIGTERM');await new Promise(resolve=>{if(processHandle.exitCode!==null)return resolve();processHandle.once('exit',resolve);setTimeout(()=>{processHandle.kill('SIGKILL');resolve();},3000).unref();});await mkdir('test-results/asset-cache',{recursive:true});await writeFile('test-results/asset-cache/worker-http.log',log);}
