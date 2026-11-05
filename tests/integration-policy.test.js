import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { deploymentConfig, requestAddress, originAllowed } from '../server/request-policy.js';
import { createServer } from '../server/index.js';
import { readRoom, readInvitation, invitationURL } from '../src/invitation.js';
import worker from '../worker/index.js';

test('invitations pin the source server, preserve legacy own-origin codes and never carry identities',()=>{
  assert.equal(readRoom('A-ABC234','aliyun'),'ABC234');
  assert.equal(readRoom('C-ABC234','cloudflare'),'ABC234');
  assert.equal(readRoom('ABC234','cloudflare'),'ABC234');
  assert.throws(()=>readRoom('A-ABC234','cloudflare'),/另一台服务器/);
  assert.throws(()=>readRoom('C-ABC234','aliyun'),/另一台服务器/);
  assert.throws(()=>readInvitation('?room=A-ABC234&server=cloudflare','aliyun'),/不一致/);
  assert.throws(()=>readInvitation('?room=A-ABC234&room=A-ZZZ999','aliyun'),/重复/);
  assert.throws(()=>readInvitation('?room=A-ABC234&watch=1','aliyun'),/不支持观战/);
  assert.throws(()=>readInvitation('?room=IO0123','aliyun'),/6 位/);
  const link=new URL(invitationURL('https://catan.example/?token=secret#private','ABC234','aliyun'));
  assert.equal(link.href,'https://catan.example/?room=A-ABC234');
  assert.equal(readInvitation(link.search,'aliyun'),'ABC234');
});

test('only explicit loopback proxy trust accepts a single valid X-Real-IP; arbitrary forwarding is ignored',()=>{
  const req=(remote,headers)=>({socket:{remoteAddress:remote},headers});
  const forwarded={'x-real-ip':'198.51.100.3','x-forwarded-for':'203.0.113.9','cf-connecting-ip':'203.0.113.10'};
  assert.equal(requestAddress(req('192.0.2.1',forwarded),'loopback'),'192.0.2.1');
  assert.equal(requestAddress(req('127.0.0.1',forwarded)),'127.0.0.1');
  assert.equal(requestAddress(req('127.0.0.1',forwarded),'loopback'),'198.51.100.3');
  for(const invalid of ['198.51.100.3, 203.0.113.9','garbage','198.51.100.3:123',''])assert.equal(requestAddress(req('::1',{'x-real-ip':invalid}),'loopback'),'::1');
  assert.equal(requestAddress(req('::ffff:127.0.0.1',{'x-real-ip':'2001:db8::1'}),'loopback'),'2001:db8::1');
  assert.throws(()=>deploymentConfig({backendId:'aliyun'}),/PUBLIC_ORIGIN/);
  assert.throws(()=>deploymentConfig({backendId:'aliyun',publicOrigin:'http://catan.example'}),/HTTPS/);
  assert.throws(()=>deploymentConfig({trustProxy:'*'}),/TRUST_PROXY/);
  assert.equal(originAllowed({headers:{host:'catan.example',origin:'http://catan.example'}},'https://catan.example'),false);
  assert.equal(originAllowed({headers:{origin:'https://catan.example/'}},'https://catan.example'),false);
});

test('Aliyun exact Origin, proxy per-client limits, revision marker and no-room WebSocket probe',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'catan-policy-'));
  const revision='a'.repeat(40);
  await writeFile(path.join(dir,'build-info.json'),JSON.stringify({revision}));
  const app=await createServer({host:'127.0.0.1',port:0,dataDir:path.join(dir,'data'),staticDir:dir,backendId:'aliyun',publicOrigin:'https://catan.example',trustProxy:'loopback'});
  const endpoint=`http://127.0.0.1:${app.port}`;
  try {
    assert.equal((await fetch(endpoint+'/api/rooms',{method:'POST',headers:{Origin:'http://catan.example'}})).status,403);
    assert.equal((await fetch(endpoint+'/api/health',{headers:{Origin:'https://other.example'}})).status,403);
    const marker=await (await fetch(endpoint+'/api/deployment',{headers:{Origin:'https://catan.example'}})).json();
    assert.equal(marker.backendId,'aliyun');assert.equal(marker.revision,revision);
    for(let i=0;i<120;i++)assert.equal((await fetch(endpoint+'/api/health',{headers:{'X-Real-IP':'198.51.100.1'}})).status,200);
    assert.equal((await fetch(endpoint+'/api/health',{headers:{'X-Real-IP':'198.51.100.1'}})).status,429);
    assert.equal((await fetch(endpoint+'/api/health',{headers:{'X-Real-IP':'198.51.100.2'}})).status,200);
    await new Promise((resolve,reject)=>{
      const socket=new WebSocket(endpoint.replace('http','ws')+'/api/connectivity/ws',{origin:'https://catan.example'});
      socket.on('error',reject);socket.on('message',raw=>{const data=JSON.parse(raw);assert.equal(data.revision,revision);assert.equal(data.backendId,'aliyun');socket.close();resolve();});
    });
    assert.equal(app.rooms.size,0);
    await new Promise((resolve,reject)=>{
      const socket=new WebSocket(endpoint.replace('http','ws')+'/api/connectivity/ws',{origin:'https://evil.example'});
      socket.on('open',()=>{socket.terminate();reject(new Error('Untrusted Origin upgraded'));});
      socket.on('unexpected-response',(_req,res)=>{assert.equal(res.statusCode,403);res.resume();resolve();});socket.on('error',()=>{});
    });
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});

test('Worker requires its own canonical Origin and edge limiter, rejects failed or exhausted limits',async()=>{
  const origin='https://catan-friends.qiuh23.workers.dev',base={BACKEND_ID:'cloudflare',PUBLIC_ORIGIN:origin,BUILD_SHA:'b'.repeat(40)};
  const request=(pathname,headers={})=>new Request(origin+pathname,{headers});
  assert.equal((await worker.fetch(request('/api/rooms'),base)).status,503);
  assert.equal((await worker.fetch(request('/api/health',{Origin:'http://catan-friends.qiuh23.workers.dev'}),base)).status,403);
  assert.equal((await worker.fetch(new Request('https://different.example/api/health'),base)).status,503);
  const marker=await (await worker.fetch(request('/api/health'),base)).json();
  assert.equal(marker.backendId,'cloudflare');assert.equal(marker.revision,base.BUILD_SHA);
  let received;
  const limited={...base,CATAN_RATE_LIMITER:{async limit({key}){received=key;return {success:false};}}};
  assert.equal((await worker.fetch(request('/api/rooms',{'CF-Connecting-IP':'198.51.100.5'}),limited)).status,429);
  assert.equal(received,'198.51.100.5');
  const broken={...base,CATAN_RATE_LIMITER:{async limit(){throw new Error('unavailable');}}};
  assert.equal((await worker.fetch(request('/api/rooms'),broken)).status,503);
});
