import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { openFixture } from './map-first-fixture.js';
import { toggleBoard } from './browser-stage-helpers.js';

const browser=await chromium.launch({headless:true}),results=[],errors=[];
await mkdir('test-results',{recursive:true});
async function camera(page) {
  await page.locator('#board canvas[data-camera]').waitFor();
  return page.locator('#board canvas').evaluate(el=>({eye:JSON.parse(el.dataset.camera),target:JSON.parse(el.dataset.cameraTarget),view:JSON.parse(el.dataset.cameraView)}));
}
function sameCamera(actual,expected,message) {
  for(const key of ['eye','target'])assert.ok(actual[key].every((v,i)=>Math.abs(v-expected[key][i])<1e-7),`${message}: ${key}`);
  assert.deepEqual(actual.view,expected.view,`${message}: projection`);
}
const flatView=page=>page.locator('#board>svg').getAttribute('viewBox');
try {
  for(const [name,viewport,touch]of [['desktop',{width:1366,height:768},false],['portrait',{width:390,height:844},true],['short-landscape',{width:667,height:320},true]]) {
    const client=await openFixture(browser,{count:6,viewport,touch,errors}),{page}=client;
    await page.locator('#board canvas').focus();await page.keyboard.press('+');await page.keyboard.press('+');await page.waitForTimeout(350);
    assert.equal(await page.locator('#camera-toolbar').getAttribute('data-follow-state'),'manual');const manual3d=await camera(page);
    await toggleBoard(page,'切换二维棋盘');
    await page.locator('#board>svg').focus();await page.keyboard.press('+');await page.keyboard.press('+');
    await page.mouse.move(32,Math.floor(viewport.height/2));await page.mouse.down();await page.mouse.move(60,Math.floor(viewport.height/2)+20,{steps:4});await page.mouse.up();await page.waitForTimeout(150);
    const manual2d=await flatView(page);
    await toggleBoard(page,'切换三维棋盘');await page.waitForTimeout(180);sameCamera(await camera(page),manual3d,'renderer toggle moved 3D view');
    await toggleBoard(page,'切换二维棋盘');assert.equal(await flatView(page),manual2d,'renderer toggle moved 2D view');
    await page.reload();await page.locator('.playing #board>svg').waitFor();await page.waitForTimeout(200);
    assert.equal(await flatView(page),manual2d,'refresh changed 2D renderer or view');
    assert.equal(await page.locator('#camera-toolbar').getAttribute('data-follow-state'),'manual','refresh resumed auto-follow over a manual view');
    await toggleBoard(page,'切换三维棋盘');await page.waitForTimeout(180);sameCamera(await camera(page),manual3d,'refresh lost saved 3D view');
    const beforeReconnect=await camera(page);client.disconnect();await page.waitForTimeout(900);await page.locator('#board[aria-busy="false"]').waitFor();sameCamera(await camera(page),beforeReconnect,'reconnection moved manual view');
    await page.reload();await page.locator('.playing #board canvas[data-camera]').waitFor();await page.waitForTimeout(200);sameCamera(await camera(page),manual3d,'refresh moved manual 3D view');
    const edge=client.legal('p0').road[0];assert.ok(Number.isInteger(edge));client.action('p0',{type:'buildRoad',edge});await page.waitForTimeout(500);sameCamera(await camera(page),manual3d,'next public action resumed automatic camera after reload');
    const persisted=await page.evaluate(()=>Object.entries(sessionStorage).filter(([key])=>key.startsWith('catan:view:')).map(([key,value])=>({key,view:JSON.parse(value)})));
    assert.ok(persisted.every(({view})=>!('hand'in view)&&!('dev'in view)&&!('token'in view)),'view cache contains private game fields');
    results.push({name,viewport,rendererRoundTrip:true,flatRefresh:true,manualFollowPreserved:true,reconnect:true,threeDRefresh:true,nextActionKeepsView:true});await client.context.close();
  }
  assert.deepEqual(errors,[]);await writeFile('test-results/view-recovery-browser.json',JSON.stringify({results,errors},null,2)+'\n');console.log(JSON.stringify({passed:results.length,results},null,2));
}finally {await browser.close();}
