import {chromium} from 'playwright';
import {PerspectiveCamera,Vector3} from 'three';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {openFixture} from './map-first-fixture.js';
const out=process.env.BUILD_DOCK_OUTPUT||'docs/qa/build-dock',edition=process.env.TEST_EDITION||'global';
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const errors=[],results=[];await mkdir(out,{recursive:true});
const settle=p=>p.waitForTimeout(180);
async function flat(p){await p.locator('[data-action="openSettings"]').click();await p.locator('[data-action="toggleFlat"]').click();await p.keyboard.press('Escape');await settle(p);}
async function shape(p,isFlat){return isFlat?p.locator('#board [data-id]').first().getAttribute('data-site-shape'):p.locator('#board canvas').getAttribute('data-site-shape');}
async function fits(p,before) {
  const r=await p.evaluate(()=>{
    const box=s=>document.querySelector(s)?.getBoundingClientRect().toJSON();
    return {dock:box('#play-dock'),cost:box('.build-cost'),hand:box('.hand-tray'),width:innerWidth,height:innerHeight,sw:document.documentElement.scrollWidth,sh:document.documentElement.scrollHeight,
      resources:[...document.querySelectorAll('.cost-resources>span')].map(e=>e.getBoundingClientRect().toJSON()),buttons:[...document.querySelectorAll('.build-cost button')].map(e=>e.getBoundingClientRect().toJSON())};
  });
  assert.ok(r.sw<=r.width+1&&r.sh<=r.height+1,'page overflow');
  assert.ok(r.cost.top>=r.dock.top&&r.cost.bottom<=r.dock.bottom+1,'cost escaped dock');
  assert.ok(r.dock.height<=before.height+1,`dock grew over hand: ${JSON.stringify({before,after:r.dock})}`);
  assert.ok(r.dock.top>=before.top-1,'cost rose into board');
  for(const b of [...r.resources,...r.buttons])assert.ok(b.left>=r.dock.left&&b.right<=r.dock.right+1&&b.top>=r.dock.top&&b.bottom<=r.dock.bottom+1,'cost content clipped');
  for(const b of r.buttons)assert.ok(b.width>=44&&b.height>=44,'small touch target');
  const overlap=Math.max(0,Math.min(r.dock.right,r.hand.right)-Math.max(r.dock.left,r.hand.left))*Math.max(0,Math.min(r.dock.bottom,r.hand.bottom)-Math.max(r.dock.top,r.hand.top));
  assert.equal(overlap,0,'cost dock overlaps hand');
  return r;
}
async function blank(p){const point=await p.evaluate(()=>{
  const h=innerHeight,w=innerWidth;
  for(const [x,y] of [[6,h*.45],[w-6,h*.45],[6,h*.65],[w/2,h*.30]])if(document.elementFromPoint(x,y)?.closest('#board'))return {x,y};
  throw Error('no blank map point');
});await p.touchscreen.tap(point.x,point.y);await settle(p);}
async function gestures(p) {
  const {width,height}=p.viewportSize(),x=width/2,y=height*.48;
  await p.mouse.move(x,y);await p.mouse.down();await p.mouse.move(x+35,y+18,{steps:5});await p.mouse.up();await settle(p);
  assert.equal(await p.locator('.build-cost').count(),1,'drag dismissed costs');
  const cdp=await p.context().newCDPSession(p);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-25,y,id:1},{x:x+25,y,id:2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-42,y,id:1},{x:x+42,y,id:2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();await settle(p);
  assert.equal(await p.locator('.build-cost').count(),1,'pinch dismissed costs');
}
async function place(c,kind,isFlat) {
  const p=c.page,type=kind==='road'?'buildRoad':kind==='city'?'buildCity':'buildSettlement',before=c.actions.filter(a=>a.type===type).length;
  if(isFlat){
    const points=await p.locator('#board [data-id]').evaluateAll(es=>es.map(el=>{const p=new DOMPoint(Number(el.getAttribute('cx')),Number(el.getAttribute('cy'))).matrixTransform(el.getScreenCTM());return {x:p.x,y:p.y,id:el.dataset.id};}));
    for(const pt of points){if(!await p.evaluate(({x,y})=>Boolean(document.elementFromPoint(x,y)?.closest('#board')),pt))continue;await p.touchscreen.tap(pt.x,pt.y);await settle(p);if(c.actions.filter(a=>a.type===type).length>before)break;}
  }else{
    const d=await p.locator('#board canvas').evaluate(el=>({r:el.getBoundingClientRect().toJSON(),eye:JSON.parse(el.dataset.camera),target:JSON.parse(el.dataset.cameraTarget),view:JSON.parse(el.dataset.cameraView)}));
    const camera=new PerspectiveCamera(34,d.r.width/d.r.height,.1,150);camera.position.fromArray(d.eye);camera.lookAt(...d.target);camera.view=d.view;camera.updateProjectionMatrix();camera.updateMatrixWorld();
    for(const id of c.legal()[kind]){
      let pos=c.game.board.vertices[id];if(kind==='road'){const e=c.game.board.edges[id],a=c.game.board.vertices[e.a],b=c.game.board.vertices[e.b];pos={x:(a.x+b.x)/2,z:(a.z+b.z)/2};}
      const v=new Vector3(pos.x,.298,pos.z).project(camera),x=d.r.left+(v.x+1)*d.r.width/2,y=d.r.top+(1-v.y)*d.r.height/2;
      if(!await p.evaluate(({x,y})=>Boolean(document.elementFromPoint(x,y)?.closest('#board')),{x,y}))continue;
      await p.mouse.move(x,y);const selected=await p.locator('#board canvas').getAttribute('data-selected-site');
      if(selected!==`${kind==='road'?'edge':'vertex'}:${id}`)continue;
      await p.touchscreen.tap(x,y);await settle(p);if(c.actions.filter(a=>a.type===type).length>before)break;
    }
  }
  assert.equal(c.actions.filter(a=>a.type===type).length,before+1,`${kind} was not placed once by touching a legal target`);
  assert.equal(await p.locator('.build-cost').count(),0,'successful placement kept costs');
}
try {
  const views=[['portrait',{width:390,height:844}],['small',{width:320,height:568}],['landscape',{width:844,height:390}],['short-landscape',{width:667,height:320}],['desktop',{width:1366,height:768}]];
  for(const [name,viewport] of views)for(const isFlat of [false,true]){
    const c=await openFixture(browser,{count:4,viewport,touch:true,errors}),p=c.page,mode=isFlat?'2d':'3d';if(isFlat)await flat(p);
    const base=structuredClone(c.game),before=await p.locator('#play-dock').boundingBox();before.top=before.y;
    await p.locator('[data-build="road"]').click();await settle(p);assert.equal(await shape(p,isFlat),'road','first tap did not enter placement');
    await fits(p,before);await p.screenshot({path:`${out}/${edition}-${name}-${mode}-road.png`});
    await gestures(p);await blank(p);
    assert.equal(await p.locator('.build-cost').count(),0,'blank tap kept costs');
    assert.equal(await shape(p,isFlat),'road','blank tap canceled placement');
    assert.equal(await p.getByRole('button',{name:'取消道路建造',exact:true}).count(),1,'cancel is not discoverable after dismissal');
    await p.getByRole('button',{name:'取消道路建造',exact:true}).click();assert.equal(await p.locator('.build-cost').count(),0);
    assert.equal(isFlat?await p.locator('#board [data-id]').count():await shape(p,false),isFlat?0:'','cancel left placement active');
    await p.locator('[data-build="road"]').click();await settle(p);
    // Overview/reset is a control, not blank space; its activation must retain costs.
    await p.locator('[data-action="overview"]').first().click();await p.waitForTimeout(550);
    assert.equal(await p.locator('.build-cost').count(),1);await place(c,'road',isFlat);
    for(const kind of ['settlement','city']){
      const g=structuredClone(base);g.turnNo+=kind==='settlement'?2:3;
      if(kind==='settlement'){
        const v=g.board.vertices.find(v=>!v.owner&&v.edges.every(id=>{const e=g.board.edges[id],other=g.board.vertices[e.a===v.id?e.b:e.a];return !other.owner;}));
        assert.ok(v);g.board.edges[v.edges[0]].owner='p0';
      }
      c.set(g);await settle(p);await p.locator(`[data-build="${kind}"]`).click();await settle(p);await fits(p,before);
      assert.equal(await shape(p,isFlat),kind);await p.screenshot({path:`${out}/${edition}-${name}-${mode}-${kind}.png`});
      await place(c,kind,isFlat);
    }
    const poor=structuredClone(base);poor.turnNo+=4;for(const k in poor.players[0].hand)poor.players[0].hand[k]=0;c.set(poor);await settle(p);
    await p.locator('[data-build="road"]').click();await settle(p);assert.match(await p.locator('.build-cost').textContent(),/缺木1、砖1/);await fits(p,before);
    assert.equal(isFlat?await p.locator('#board [data-id]').count():await shape(p,false),isFlat?0:'','insufficient resources enabled placement');
    await p.screenshot({path:`${out}/${edition}-${name}-${mode}-missing.png`});await blank(p);assert.equal(await p.locator('.build-cost').count(),0);
    const off=structuredClone(base);off.turn=1;off.turnNo+=5;c.set(off);await settle(p);await p.locator('[data-build="road"]').click();assert.match(await p.locator('.build-cost').textContent(),/等待你的回合/);await blank(p);
    const free=structuredClone(base);free.phase='road-building';free.freeRoads=2;free.resumePhase='action';free.turnNo+=6;c.set(free);await settle(p);await p.locator('[data-build="road"]').click();assert.match(await p.locator('.build-cost').textContent(),/本次免费/);await fits(p,before);await blank(p);assert.equal(await shape(p,isFlat),'road');
    const normal=structuredClone(base);normal.turnNo+=7;c.set(normal);await settle(p);const n=c.actions.length;await p.locator('[data-build="development"]').click();await settle(p);assert.equal(c.actions.length,n,'inspection bought a card');await fits(p,before);await p.screenshot({path:`${out}/${edition}-${name}-${mode}-development.png`});await p.locator('[data-action="buyDevelopment"]').click();await settle(p);assert.equal(c.actions.filter(a=>a.type==='buyDevelopment').length,1);assert.equal(await p.locator('.build-cost').count(),0);
    await p.locator('[data-build="road"]').click();c.set({...c.game,turn:1,turnNo:c.game.turnNo+1});await settle(p);assert.equal(await p.locator('.build-cost').count(),0,'turn change retained costs');assert.equal(await p.locator('#play-dock [aria-pressed="true"]').count(),0,'turn change retained selection');
    results.push({name,viewport,mode,oneTapPlacement:true,blankKeepsPlacement:true,panPinchKeepCosts:true,costInsideDock:true,noHandOverlap:true,allBuildTypes:true,insufficientResources:true,otherTurn:true,freeRoad:true,developmentExplicit:true,turnCleanup:true});console.log(`${edition} ${name} ${mode} passed`);await c.context.close();
  }
  assert.deepEqual(errors,[]);await writeFile(`${out}/results-${edition}.json`,JSON.stringify({scope:'Local Chromium touch emulation with authoritative game protocol fixtures. Not a physical phone or Safari test.',results,errors},null,2));
}finally{await browser.close();}
