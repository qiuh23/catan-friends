import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {openFixture} from './map-first-fixture.js';
import {openStagePanel,closeStagePanel,toggleBoard} from './browser-stage-helpers.js';

const out='test-results/notice-stability',errors=[],results=[];
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const waitEvent=(p,id)=>p.waitForFunction(id=>document.querySelector('#action-feedback').dataset.eventIds?.split(',').includes(String(id)),id,{timeout:6500});
try {
  for(const [name,viewport,touch] of [['desktop',{width:1366,height:768},false],['phone',{width:390,height:844},true],['landscape',{width:667,height:320},true]])for(const flat of [false,true]){
    const c=await openFixture(browser,{turn:1,viewport,touch,errors,reducedMotion:'reduce'}),p=c.page;
    if(flat)await toggleBoard(p,'切换二维棋盘');
    const first=c.action('p1',{type:'buildRoad',edge:c.legal('p1').road[0]});await waitEvent(p,first.id);
    const notice=p.locator('#action-feedback'),original=await notice.textContent(),target=await notice.getAttribute('data-target');
    const second=c.action('p1',{type:'buildRoad',edge:c.legal('p1').road[0]});
    const third=c.action('p1',{type:'buildRoad',edge:c.legal('p1').road[0]});
    for(let i=0;i<5;i++){c.publish();await p.waitForTimeout(200);assert.equal(await notice.textContent(),original);assert.equal(await notice.getAttribute('data-target'),target);assert.equal(await notice.isVisible(),true);}
    await waitEvent(p,third.id);assert.ok((await notice.getAttribute('data-event-ids')).split(',').includes(String(second.id)));
    assert.match(await notice.textContent(),/\+1 项/);assert.equal(await notice.evaluate(n=>getComputedStyle(n).pointerEvents),'none');
    await p.screenshot({path:`${out}/${name}-${flat?'2d':'3d'}-notice.png`});
    // Required lifetime survives an open modal. Native focus and pointer/touch
    // dismissal remain on the modal; notice updates cannot move its buttons.
    await openStagePanel(p,'openSettings');const before=await p.locator('#stage-dialog').boundingBox();
    c.notice('操作未完成，请重试。');await p.locator('#toast.show').waitFor();
    const focus=await p.evaluate(()=>document.activeElement?.getAttribute('data-action'));
    c.notice('操作未完成，请重试。');c.notice('连接已恢复。');
    await p.waitForTimeout(500);assert.equal(await p.locator('#toast').textContent(),'操作未完成，请重试。');
    assert.deepEqual(await p.locator('#stage-dialog').boundingBox(),before);
    assert.equal(await p.evaluate(()=>document.activeElement?.getAttribute('data-action')),focus);
    assert.equal(await p.locator('#toast').evaluate(n=>n.matches(':popover-open')),true);
    await p.screenshot({path:`${out}/${name}-${flat?'2d':'3d'}-dialog.png`});
    const close=p.locator('[data-action="closeStagePanel"]');if(touch)await close.tap();else await close.click();
    await p.locator('#stage-dialog').waitFor({state:'hidden'});assert.equal(await notice.isVisible(),true);
    await p.waitForFunction(()=>document.querySelector('#toast').textContent==='连接已恢复。',null,{timeout:7000});
    await p.waitForFunction(()=>document.querySelector('#action-feedback').hidden,null,{timeout:6500});
    c.publish();c.publish();await p.waitForTimeout(250);assert.equal(await notice.isVisible(),false);
    await openStagePanel(p,'openSettings');await p.keyboard.press('Escape');await p.locator('#stage-dialog').waitFor({state:'hidden'});
    await openStagePanel(p,'openSettings');await p.goBack();await p.locator('#stage-dialog').waitFor({state:'hidden'});
    await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
    c.action('p1',{type:'buyDevelopment'});await p.waitForTimeout(250);
    await p.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await p.waitForTimeout(250);
    assert.equal(await notice.isVisible(),false,'hidden-page actions replayed when returning');
    await p.reload();await p.locator('.playing #board canvas').waitFor();await p.waitForTimeout(250);assert.equal(await notice.isVisible(),false);
    results.push({name,flat,burst:true,dedup:true,modal:true,touch,escape:true,back:true,reload:true});await c.context.close();
  }
  assert.deepEqual(errors,[]);await writeFile(`${out}/results.json`,JSON.stringify({results,errors,scope:'Local Chromium fixtures, simulated touch; not physical-device acceptance'},null,2));
}finally{await browser.close();}
