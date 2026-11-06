import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

// Local Vite server only. Instrument the constructor in the response, never in
// shipped code, to inspect actual pooled geometry and take repeatable bearings.
const base=process.env.TEST_URL||'http://127.0.0.1:5187';
const output='docs/qa/home-showcase',results=[],errors=[];
await mkdir(output,{recursive:true});await mkdir('test-results/home-showcase',{recursive:true});
async function instrument(context) {
  await context.route('**/@vite/client',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('async connect(handlers) {','async connect(handlers) { return;')});});
  await context.route('**/src/board3d.js*',async route=>{
    const response=await route.fetch();const body=(await response.text()).replace('constructor(container,onSelect,onHover) {','constructor(container,onSelect,onHover) { globalThis.qaBoard=this;');
    await route.fulfill({response,body});
  });
  context.on('page',page=>page.on('pageerror',e=>errors.push(e.message)));
}
const stats=page=>page.evaluate(()=>({memory:{...qaBoard.renderer.info.memory},landBuilds:qaBoard.metrics.landBuilds,pieceBuilds:qaBoard.metrics.pieceBuilds,
  assets:qaBoard.assets.materials.size,textures:qaBoard.assets.textures.size,children:qaBoard.scene.children.length,time:qaBoard.homeTime,angle:qaBoard.homeAngle,renders:qaBoard.metrics.renders}));
async function snapshot(page,angle,time) {
  await page.evaluate(({angle,time})=>{
    const b=qaBoard,r=b.camera.position.length();b.stopAmbient();b.ambientEnabled=false;b.controls.enableDamping=false;b.homeAngle=angle*Math.PI/180;
    b.camera.position.set(Math.sin(b.homeAngle)*Math.sin(.78)*r,Math.cos(.78)*r,Math.cos(b.homeAngle)*Math.sin(.78)*r);
    b.animateDemo(time);b.controls.update();b.invalidate();
  },{angle,time});await page.waitForTimeout(90);
}
async function auditOrbit(page) {
  return page.evaluate(()=>{
    const b=qaBoard,V=b.camera.position.constructor,M=b.camera.matrixWorld.constructor,position=new V(),local=new M(),matrix=new M();
    const frame=JSON.parse(document.querySelector('#board').dataset.homePadding),w=innerWidth,h=innerHeight;
    const visible=e=>e.getClientRects().length&&getComputedStyle(e).display!=='none';
    const ui=[...document.querySelectorAll('.topbar .brand,.topbar nav,.entry-server,#home-welcome,#home-dock,.board-controls')].filter(visible).map(e=>({name:e.id||e.className,rect:e.getBoundingClientRect().toJSON()}));
    const buttons=[...document.querySelectorAll('.topbar a,.topbar button,#home-dock button,.board-controls button')].filter(visible).map(e=>({name:e.getAttribute('aria-label')||e.textContent,rect:e.getBoundingClientRect().toJSON()}));
    const failures=[];let points=0,minGap=Infinity,label;
    const project=point=>{
      const p=point.clone().project(b.camera),x=(p.x+1)*w/2,y=(1-p.y)*h/2;points++;
      minGap=Math.min(minGap,x-frame.left,w-frame.right-x,y-frame.top,h-frame.bottom-y);
      if((x<frame.left-1||x>w-frame.right+1||y<frame.top-1||y>h-frame.bottom+1)&&failures.length<5)failures.push({angle:b.homeAngle,x,y,point:point.toArray(),label});
    };
    b.stopAmbient();b.ambientEnabled=false;b.controls.enableDamping=false;const radius=b.camera.position.length();
    for(let degrees=0;degrees<360;degrees+=15) {
      b.homeAngle=degrees*Math.PI/180;b.camera.position.set(Math.sin(b.homeAngle)*Math.sin(.78)*radius,Math.cos(.78)*radius,Math.cos(b.homeAngle)*Math.sin(.78)*radius);b.controls.update();b.camera.updateMatrixWorld();b.scene.updateMatrixWorld(true);
      const right=new V().setFromMatrixColumn(b.camera.matrixWorld,0),up=new V().setFromMatrixColumn(b.camera.matrixWorld,1);
      for(const root of [b.land,b.demoLayer])root?.traverse(object=>{
        label={type:object.type,geometry:object.geometry?.type,root:root===b.land?'land':'demo'};
        if(!object.visible||object.parent&&!object.parent.visible)return;
        if(object.isSprite){const center=object.getWorldPosition(new V()),scale=object.getWorldScale(new V());for(const x of [-.5,.5])for(const y of [-.5,.5])project(center.clone().addScaledVector(right,x*scale.x).addScaledVector(up,y*scale.y));}
        else if(object.isInstancedMesh){object.geometry.computeBoundingBox();const box=object.geometry.boundingBox;for(let i=0;i<object.count;i++){
          object.getMatrixAt(i,local);matrix.multiplyMatrices(object.matrixWorld,local);
          for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])project(position.set(x,y,z).applyMatrix4(matrix));
        }}
      });
    }
    return {failures,points,minGap,frame,ui,buttons,ports:b.portTargets.length,overflow:document.documentElement.scrollWidth>w+1||document.documentElement.scrollHeight>h+1};
  });
}
function checkUI(report,width,height) {
  assert.equal(report.overflow,false);assert.equal(report.ports,9);assert.deepEqual(report.failures,[],'actual scenery / complete port corners enter HUD space');
  for(const c of report.buttons){const r=c.rect;assert.ok(r.left>=0&&r.top>=0&&r.right<=width+1&&r.bottom<=height+1,`cropped ${c.name}`);assert.ok(r.height>=44,`short target ${c.name}`);}
  const overlap=(a,b)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
  for(let i=0;i<report.ui.length;i++)for(let j=i+1;j<report.ui.length;j++)assert.ok(overlap(report.ui[i].rect,report.ui[j].rect)<1,`HUD overlap ${report.ui[i].name}/${report.ui[j].name}`);
}

for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]) {
  const browser=await type.launch({headless:true});
  try {
    const liveContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await instrument(liveContext);
    const live=await liveContext.newPage();let writes=0,sockets=0;live.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/rooms'))writes++;});live.on('websocket',ws=>{if(ws.url().includes('/api/rooms/'))sockets++;});
    await live.goto(base);await live.locator('canvas[data-camera]').waitFor();await live.waitForTimeout(500);
    // Warm every model once before comparing renderer allocations.
    await live.evaluate(()=>{for(const t of [3,21]){qaBoard.animateDemo(t);qaBoard.renderer.render(qaBoard.scene,qaBoard.camera);}qaBoard.animateDemo(qaBoard.homeTime);});
    const liveStart=await stats(live),started=Date.now();
    for(const [name,width,height] of [['desktop',1440,1000],['laptop',1366,768],['portrait',390,844],['small',320,568],['landscape',844,390],['short-landscape',667,320]]) {
      const context=await browser.newContext({viewport:{width,height},isMobile:name!=='desktop'&&name!=='laptop',hasTouch:name!=='desktop'&&name!=='laptop'});await instrument(context);
      const page=await context.newPage();await page.goto(base);await page.locator('canvas[data-camera]').waitFor();await page.waitForTimeout(200);
      const report=await auditOrbit(page);checkUI(report,width,height);
      if(engine==='chromium'&&['desktop','portrait','short-landscape'].includes(name))for(const [angle,time] of [[0,3],[90,11],[180,21],[270,26]]){await snapshot(page,angle,time);await page.screenshot({path:`${output}/${name}-${angle}.png`,scale:'css'});}
      await page.locator('#home-motion').click();await page.locator('#home-motion').click();
      const first=await stats(page);await page.waitForTimeout(600);const second=await stats(page);assert.ok(second.angle>first.angle+.005,'orbit does not advance continuously');
      // A plain map click, a drag, a wheel/pinch and keyboard input all interrupt.
      if(name==='desktop'||name==='laptop')await page.mouse.click(width/2,height/2);else await page.touchscreen.tap(width/2,height/2);
      await page.waitForTimeout(120);const clicked=await stats(page);await page.waitForTimeout(160);assert.equal((await stats(page)).angle,clicked.angle);assert.match(await page.locator('#home-motion').getAttribute('aria-label'),/恢复展示/);
      await page.locator('#home-motion').click();await page.mouse.move(width/2,height/2);await page.mouse.down();await page.mouse.move(width/2+45,height/2+12,{steps:4});await page.mouse.up();await page.waitForTimeout(160);assert.equal(await page.locator('canvas').getAttribute('data-ambient'),'stopped');
      await page.locator('#home-motion').click();await page.mouse.move(width/2,height/2);
      if(engine==='webkit'&&name!=='desktop'&&name!=='laptop')await page.locator('canvas').dispatchEvent('wheel',{clientX:width/2,clientY:height/2,deltaY:-60,bubbles:true,cancelable:true});
      else await page.mouse.wheel(0,-60);
      await page.waitForTimeout(100);assert.match(await page.locator('#home-motion').getAttribute('aria-label'),/恢复展示/);
      await page.locator('#home-motion').click();await page.locator('canvas').focus();await page.keyboard.press('+');assert.match(await page.locator('#home-motion').getAttribute('aria-label'),/恢复展示/);
      await page.locator('[data-action="reset"]').click();await page.locator('#home-motion').click();
      await page.locator('[data-action="rules"]').click();await page.waitForTimeout(90);const modal=await stats(page);await page.waitForTimeout(200);assert.equal((await stats(page)).time,modal.time);await page.keyboard.press('Escape');await page.waitForTimeout(160);assert.ok((await stats(page)).time>modal.time);
      // Simulate Page Visibility explicitly; unlike physical app switching this
      // is a browser document override, and is identified as such in the report.
      await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});const hidden=await stats(page);await page.waitForTimeout(180);assert.equal((await stats(page)).time,hidden.time);
      await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
      await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(160);assert.equal(await page.locator('canvas').getAttribute('data-ambient'),'stopped');assert.ok(await page.locator('#home-motion').isDisabled());assert.equal(JSON.parse(await page.locator('canvas').getAttribute('data-demo')).pose.city,1);
      if(engine==='chromium'&&name==='portrait')await page.screenshot({path:`${output}/portrait-reduced-motion.png`});
      await page.emulateMedia({reducedMotion:'no-preference'});await page.locator('#flat-toggle').click();await page.locator('#board>svg').waitFor();assert.equal(await page.locator('[data-building="city"]').count(),1);assert.equal(await page.evaluate(()=>qaBoard.disposed&&qaBoard.demoLayer===null&&qaBoard.ambientTimer===0),true);assert.ok(await page.locator('#home-motion').isDisabled());
      if(engine==='chromium'&&name==='portrait')await page.screenshot({path:`${output}/portrait-2d.png`});
      await page.locator('#flat-toggle').click();await page.locator('canvas[data-camera]').waitFor();assert.ok(await page.locator('#home-motion').isEnabled());
      if(engine==='chromium'&&name==='portrait') {
        const cdp=await context.newCDPSession(page);
        await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:44,bottom:34,left:0,right:0}});await page.waitForTimeout(130);checkUI(await auditOrbit(page),width,height);
        await page.setViewportSize({width:844,height:390});await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,bottom:21,left:44,right:44}});await page.waitForTimeout(130);checkUI(await auditOrbit(page),844,390);
        await page.screenshot({path:`${output}/landscape-safe-area.png`});
        await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,bottom:0,left:0,right:0}});
        await page.locator('#home-motion').click();await page.locator('#home-motion').click();
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:390,y:180,id:1},{x:450,y:180,id:2}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:365,y:180,id:1},{x:475,y:180,id:2}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        assert.match(await page.locator('#home-motion').getAttribute('aria-label'),/恢复展示/);
      }
      if(name==='portrait'||name==='short-landscape')for(const backendId of ['aliyun','cloudflare']){
        await page.route('**/api/deployment',route=>route.fulfill({json:{game:'catan-friends',backendId,publicOrigin:new URL(base).origin}}));
        await page.reload();await page.locator('canvas[data-camera]').waitFor();await page.waitForTimeout(100);const size=page.viewportSize();checkUI(await auditOrbit(page),size.width,size.height);
      }
      await page.evaluate(()=>window.addEventListener('pagehide',()=>sessionStorage.setItem('qa:cleanup',JSON.stringify({disposed:qaBoard.disposed,demo:qaBoard.demoLayer,timer:qaBoard.ambientTimer})),{once:true}));
      await page.goto(`${base}/?qa=page-change`);await page.locator('canvas[data-camera]').waitFor();assert.deepEqual(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('qa:cleanup'))),{disposed:true,demo:null,timer:0});
      results.push({engine,name,width,height,orbitBearings:24,projectedPoints:report.points,minGap:report.minGap,gestures:true,modal:true,visibilitySimulation:true,reducedMotion:true,rendererCleanup:true});
      console.log(`${engine} ${name}: complete orbit, gestures, pauses, renderer cleanup`);await context.close();
    }
    // Real-time idle cycles, plus many accelerated pose cycles on the same pool.
    while((await stats(live)).time<92){await live.waitForTimeout(1000);if(Date.now()-started>160000)throw Error('live showcase stopped unexpectedly');}
    const liveEnd=await stats(live);assert.ok(liveEnd.angle-liveStart.angle>1.8);assert.equal(writes,0);assert.equal(sockets,0);
    assert.deepEqual(liveEnd.memory,liveStart.memory);assert.equal(liveEnd.landBuilds,liveStart.landBuilds);assert.equal(liveEnd.pieceBuilds,liveStart.pieceBuilds);assert.equal(liveEnd.children,liveStart.children);assert.equal(liveEnd.assets,liveStart.assets);
    const accelerated=await live.evaluate(()=>{const b=qaBoard;b.stopAmbient();b.ambientEnabled=false;const samples=[];for(let cycle=0;cycle<12;cycle++){for(let step=0;step<120;step++)b.animateDemo(cycle*30+step*.25);b.animateDemo(21);b.renderer.render(b.scene,b.camera);samples.push({...b.renderer.info.memory,children:b.scene.children.length,landBuilds:b.metrics.landBuilds,pieceBuilds:b.metrics.pieceBuilds});}return samples;});
    assert.ok(accelerated.every(s=>JSON.stringify(s)===JSON.stringify(accelerated[0])));
    results.push({engine,liveSeconds:liveEnd.time,liveStart,liveEnd,acceleratedCycles:12,accelerated,writes,sockets});
    console.log(`${engine}: 3 real-time loops + 12 accelerated loops, stable pools, zero room traffic`);
    await liveContext.close();
  } finally {await browser.close();}
}

// Real local Node rooms (not a WebSocket fixture). Only explicit entry creates
// these rooms; no demonstration data is included in their persisted records.
const browser=await chromium.launch({headless:true});
try {
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});await instrument(context);
  const page=await context.newPage();await page.goto(base);await page.locator('canvas[data-camera]').waitFor();
  await page.mouse.click(200,400);await page.mouse.wheel(0,-100);
  await page.locator('[data-action="openEntry"]').click();await page.locator('#nickname').fill('展示隔离房主');await page.locator('#create-room').click();await page.locator('.waiting-banner').waitFor();
  assert.equal(await page.evaluate(()=>qaBoard.homeShowcase||Boolean(qaBoard.demoLayer)||Boolean(qaBoard.ambientTimer)),false);assert.equal(await page.locator('#home-motion').isVisible(),false);
  const waiting=await page.evaluate(()=>({eye:qaBoard.camera.position.toArray(),target:qaBoard.controls.target.toArray()}));await page.waitForTimeout(200);assert.deepEqual(await page.evaluate(()=>qaBoard.camera.position.toArray()),waiting.eye);assert.deepEqual(waiting.target,[0,0,0]);
  const guestContext=await browser.newContext({viewport:{width:667,height:320}});await instrument(guestContext);const guest=await guestContext.newPage();await guest.goto(page.url());await guest.locator('[data-action="openEntry"]').click();await guest.locator('#nickname').fill('展示隔离朋友');await guest.locator('#entry-form button[type=submit]').click();await guest.locator('.waiting-banner').waitFor();await guest.locator('[data-action="ready"]').click();
  await page.locator('[data-action="addBot"]').click();await page.locator('[data-action="start"]').click();await page.waitForFunction(()=>!document.querySelector('#table').classList.contains('waiting'));
  assert.equal(await page.evaluate(()=>qaBoard.homeShowcase||Boolean(qaBoard.demoLayer)||Boolean(qaBoard.ambientTimer)),false);assert.equal(await page.locator('#action-feedback').isVisible(),false);assert.ok(await page.locator('#board canvas').getAttribute('data-site-shape'));
  await page.locator('[data-action="openSettings"]').click();await page.locator('#stage-dialog [data-action="home"]').click();await page.locator('[data-action="confirmRoomDialog"]').click();await page.locator('#home-dock').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>qaBoard.homeShowcase),true);
  await page.locator('[data-action="homePractice"]').click();await page.locator('#practice-count-3').check();await page.locator('#practice-start').click();await page.waitForFunction(()=>document.querySelector('#table').classList.contains('playing'));
  assert.equal(await page.evaluate(()=>qaBoard.homeShowcase||Boolean(qaBoard.demoLayer)||Boolean(qaBoard.ambientTimer)),false);
  results.push({realNodeHumanCreateJoinAndStart:true,waitingCameraReset:true,realNodePractice:true,returnHome:true,homeFeedback:false});
  await guestContext.close();await context.close();
} finally {await browser.close();}
assert.deepEqual(errors,[]);await writeFile(`${output}/results.json`,JSON.stringify({results,errors},null,2)+'\n');console.log(JSON.stringify({passed:true,cases:results.length,errors}));
