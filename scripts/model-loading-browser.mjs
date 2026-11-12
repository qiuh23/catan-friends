import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {openFixture} from './map-first-fixture.js';
const base=process.env.TEST_URL||'http://127.0.0.1:5191',out='test-results/model-loading';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox']});
const results=[],errors=[];
async function context(viewport,{hold=false,fail=false,reducedMotion='no-preference'}={}){
  const c=await browser.newContext({viewport,hasTouch:viewport.width<1000,isMobile:viewport.width<1000,reducedMotion});
  let release,held=false,failedURL=null,allowRetry=false;const barrier=new Promise(resolve=>release=resolve),requests=[];
  await c.route('**/src/board3d.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('export class Board {','class ActualBoard {')+'\nexport class Board extends ActualBoard { constructor(...args){ super(...args); window.__visualBoard=this; } }'});});
  await c.route('**/api/deployment',route=>route.fulfill({json:{game:'catan-friends',siteEdition:'global',backendId:'local',publicOrigin:base}}));
  await c.route('**/api/rooms',route=>route.fulfill({json:{rooms:[]}}));
  await c.route('**/assets/**/*.glb',async route=>{
    const url=route.request().url();requests.push(url);
    if(url.includes('/variants/')&&hold&&!held){held=true;await barrier;}
    if(url.includes('/variants/')&&fail&&!failedURL)failedURL=url;
    if(url===failedURL&&!allowRetry)return route.abort('failed');
    return route.continue();
  });
  const p=await c.newPage();p.on('pageerror',error=>errors.push(error.message));
  return {c,p,requests,release,retry(){allowRetry=true;},get failedURL(){return failedURL;}};
}
const snap=page=>page.evaluate(()=>{const b=window.__visualBoard;return {models:JSON.parse(b.renderer.domElement.dataset.models||'{}'),load:JSON.parse(b.renderer.domElement.dataset.modelLoad||'null'),landBuilds:b.metrics.landBuilds,labels:b.land.children.filter(x=>x.isSprite).map(x=>x.uuid),children:b.land.children.length,handles:b.models.layers.size};});
try{
  for(const viewport of [{width:1366,height:768},{width:390,height:844}]){
    const client=await context(viewport,{hold:true});const {p}=client;
    await p.goto(base);await p.waitForFunction(()=>window.__visualBoard?.terrainPresentation.stats().tiles>0);
    const partial=await snap(p);assert.ok(partial.models.tiles<partial.models.total);assert.equal(partial.landBuilds,1);
    await p.evaluate(()=>{const b=window.__visualBoard;window.__retainedMeshes=b.land.children.filter(x=>x.userData.blender).map(x=>x.uuid);});
    await p.screenshot({path:`${out}/${viewport.width}-partial.png`});client.release();
    await p.waitForFunction(()=>{const b=window.__visualBoard;return b?.renderer.domElement.dataset.modelLoad&&b.terrainPresentation.stats().tiles===b.board.tiles.length&&!b.terrainPresentation.fades.length;});
    const complete=await snap(p);assert.equal(complete.landBuilds,1);assert.deepEqual(complete.labels,partial.labels);
    assert.ok(await p.evaluate(()=>window.__retainedMeshes.every(id=>window.__visualBoard.land.children.some(x=>x.uuid===id))));
    assert.equal(await p.locator('.board-model-status').isVisible(),false);
    await p.screenshot({path:`${out}/${viewport.width}-complete.png`});
    const coldRequests=client.requests.length;
    await p.locator('#flat-toggle').click();await p.locator('#flat-toggle').click();
    await p.waitForFunction(()=>{const b=window.__visualBoard;return !b.disposed&&b.renderer.domElement.dataset.modelLoad&&b.terrainPresentation.stats().tiles===b.board.tiles.length;});
    assert.equal(client.requests.length,coldRequests,'2D/3D must reuse byte cache');
    results.push({viewport,partial,complete,coldRequests,repeatedRequests:client.requests.length-coldRequests});await client.c.close();
  }
  const failure=await context({width:390,height:844},{fail:true,reducedMotion:'reduce'});await failure.p.goto(base);
  await failure.p.waitForFunction(()=>Boolean(window.__visualBoard?.renderer.domElement.dataset.modelLoad));
  const beforeRetry=await snap(failure.p);assert.ok(beforeRetry.models.failed>0);assert.equal(beforeRetry.load.failed.length,1);
  const prior=failure.requests.length;await failure.p.waitForTimeout(250);assert.equal(failure.requests.length,prior,'no retry loop');
  await failure.p.screenshot({path:`${out}/failure.png`});failure.retry();await failure.p.locator('.board-model-status button').click();
  await failure.p.waitForFunction(()=>window.__visualBoard?.renderer.domElement.dataset.modelLoad&&window.__visualBoard.terrainPresentation.stats().failed===0);
  const afterRetry=await snap(failure.p);assert.equal(afterRetry.models.tiles,afterRetry.models.total);assert.equal(afterRetry.landBuilds,1);assert.equal(failure.requests.length,prior+1);
  await failure.p.screenshot({path:`${out}/recovered.png`});results.push({beforeRetry,afterRetry,retryRequests:failure.requests.length-prior});await failure.c.close();
  // The existing real-application fixture exercises game entry, hidden city
  // exclusion, legal actions and stale homepage completions on 19/30 tiles.
  for(const count of [4,6]){
    const wrapped={async newContext(options){const c=await browser.newContext(options);await c.route('**/src/board3d.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('export class Board {','class ActualBoard {')+'\nexport class Board extends ActualBoard { constructor(...args){ super(...args); window.__visualBoard=this; } }'});});return c;}};
    const client=await openFixture(wrapped,{count,viewport:{width:844,height:390},touch:true,reducedMotion:'reduce',errors});
    await client.page.waitForFunction(()=>{const b=window.__visualBoard;return b?.renderer.domElement.dataset.modelLoad&&b.terrainPresentation.stats().tiles===b.board.tiles.length;});
    const game=await client.page.evaluate(()=>{const b=window.__visualBoard;return {required:b.requiredModelUrls,load:JSON.parse(b.renderer.domElement.dataset.modelLoad),models:JSON.parse(b.renderer.domElement.dataset.models)};});
    assert.ok(!game.required.some(url=>url.includes('/city_')));assert.ok(game.required.some(url=>url.includes('robber')));
    const identities=await client.page.evaluate(()=>window.__visualBoard.land.children.map(x=>x.uuid));client.chat('模型加载不会重置地图');await client.page.waitForTimeout(300);assert.deepEqual(await client.page.evaluate(()=>window.__visualBoard.land.children.map(x=>x.uuid)),identities);
    await client.page.screenshot({path:`${out}/game-${count}-landscape.png`});results.push({count,game});await client.context.close();
  }
  assert.deepEqual(errors,[]);await writeFile(`${out}/results.json`,JSON.stringify({results,errors},null,2));console.log(JSON.stringify({results,errors},null,2));
}finally{await browser.close();}
