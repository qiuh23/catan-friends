import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {openPolishFixture} from './immersive-polish-fixture.js';

const url=process.env.TEST_URL||'http://127.0.0.1:5213',out='docs/qa/visual-first',before=process.argv.includes('--before');
const baseline=before?execFileSync('git',['show','7baa5cc:src/main.js'],{encoding:'utf8'}):null;
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})}),errors=[],results=[];
await mkdir(out,{recursive:true});
const rooms=[
  {code:'ABC234',hostName:'超长昵称甲乙丙丁戊己庚辛壬癸子丑',playerCount:2,maxPlayers:6,phase:'lobby',options:{friendlyRobber:true}},
  {code:'DEF567',hostName:'海风',playerCount:6,maxPlayers:6,phase:'lobby',options:{harbormaster:true}},
  {code:'GHJ789',hostName:'岛屿',playerCount:4,maxPlayers:4,phase:'action',options:{}},
  {code:'KLM234',hostName:'暂停中的房主',playerCount:3,maxPlayers:4,phase:'action',status:'paused',options:{}},
];
async function shot(page,name){await page.screenshot({path:`${out}/${before?'before':'after'}-${name}.png`,scale:'css'});}
async function fits(page,selector){
  const report=await page.evaluate(selector=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,controls:[...document.querySelectorAll(selector)].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden').map(e=>({name:e.getAttribute('aria-label')||e.textContent,rect:e.getBoundingClientRect().toJSON()}))}),selector);
  assert.ok(report.scrollWidth<=report.width+1&&report.scrollHeight<=report.height+1,'document scrolls');
  for(const c of report.controls){const r=c.rect;assert.ok(r.left>=-1&&r.top>=-1&&r.right<=report.width+1&&r.bottom<=report.height+1,`cropped ${c.name}`);assert.ok(r.height>=43,`small target ${c.name}`);}
  for(let i=0;i<report.controls.length;i++)for(let j=i+1;j<report.controls.length;j++){const a=report.controls[i].rect,b=report.controls[j].rect;assert.ok(Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top))<1,`overlapping controls ${report.controls[i].name}/${report.controls[j].name}`);}
  return report;
}
async function outside(page,selector){const point=await page.locator(selector).evaluate(e=>{const r=e.getBoundingClientRect();return [{x:2,y:2},{x:innerWidth-2,y:2},{x:2,y:innerHeight-2}].find(p=>p.x<r.left||p.x>r.right||p.y<r.top||p.y>r.bottom);});assert.ok(point);await page.mouse.click(point.x,point.y);}
try{
  for(const [name,viewport] of [['desktop',{width:1366,height:768}],['portrait',{width:390,height:844}],['landscape',{width:844,height:390}],['small',{width:320,height:568}],['short-landscape',{width:667,height:320}]]){
    const context=await browser.newContext({viewport,hasTouch:name!=='desktop',isMobile:name!=='desktop'}),page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    if(before)await page.route('**/src/main.js*',route=>route.fulfill({body:baseline,contentType:'application/javascript'}));
    await page.route('**/api/rooms',route=>route.fulfill({json:{rooms}}));
    await page.goto(url);await page.locator('#board canvas').waitFor();await page.waitForTimeout(250);
    await fits(page,'#home-dock button,.topbar button,.board-controls button');await shot(page,`home-${name}`);
    await page.locator('[data-action="openEntry"]').click();await page.locator('#nickname').fill('保留的十六字昵称甲乙丙丁戊己庚');
    await page.locator('#create-friendlyRobber').check();await page.locator('#create-harbormaster').check();await shot(page,`entry-${name}`);
    assert.equal(await page.locator('#create-friendlyRobber').isChecked(),true);
    if(!before){
      if(name==='short-landscape')assert.ok(await page.locator('#create-room').evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),'create action below short-landscape fold');
      await page.locator('#create-friendlyRobber').focus();await page.keyboard.press('Space');assert.equal(await page.locator('#create-friendlyRobber').isChecked(),false);await page.keyboard.press('Space');
      await page.keyboard.press('Escape');await page.locator('[data-action="openEntry"]').click();assert.equal(await page.locator('#nickname').inputValue(),'保留的十六字昵称甲乙丙丁戊己庚');assert.equal(await page.locator('#create-friendlyRobber').isChecked(),true);
      await page.locator('[data-action="practice"]').click();await page.locator('label[for="practice-count-6"]').click();assert.ok(await page.locator('#practice-count-6').isChecked());await shot(page,`practice-${name}`);await outside(page,'#practice-dialog');assert.ok(await page.locator('#entry-dialog').isVisible());
    }
    await page.keyboard.press('Escape');await page.locator('[data-action="openRooms"]').click();await page.locator('.public-room').last().waitFor();await shot(page,`rooms-${name}`);
    if(!before){assert.equal(await page.locator('.public-room').count(),4);assert.ok(await page.locator('[data-list-room="DEF567"]').isDisabled());assert.ok(await page.locator('[data-list-room="GHJ789"]').isDisabled());assert.ok(await page.locator('[data-list-room="KLM234"]').isDisabled());}
    await outside(page,'#rooms-dialog');await page.locator('[data-action="rules"]').click();await shot(page,`rules-${name}`);await page.keyboard.press('Escape');
    if(!before){
      await page.unroute('**/api/rooms');await page.route('**/api/rooms',route=>route.fulfill({status:503,json:{error:'测试连接失败'}}));await page.locator('[data-action="openRooms"]').click();await page.locator('[data-action="refreshRooms"]:visible').click();await page.getByRole('alert').filter({hasText:'测试连接失败'}).waitFor();await page.getByRole('button',{name:'重试',exact:true}).waitFor();await shot(page,`error-${name}`);
    }
    results.push({name,homeFits:true,entry:true,rooms:true,rules:true,drafts:!before,keyboard:!before});await context.close();
  }
  if(!before)for(const [name,viewport] of [['desktop',{width:1366,height:768}],['portrait',{width:390,height:844}],['landscape',{width:844,height:390}],['short-landscape',{width:667,height:320}]])for(const phase of ['lobby','action','finished']){
    const client=await openPolishFixture(browser,{count:6,phase,viewport,touch:name!=='desktop',errors}),page=client.page;
    await fits(page,'#stage-tools button,#play-dock button,#player-orbit button');await shot(page,`${phase}-${name}`);
    if(phase==='lobby'){await page.locator('[data-action="openSettings"]:visible').first().click();await shot(page,`settings-${name}`);await outside(page,'#stage-dialog');}
    if(phase==='action'){await page.locator('[data-action="trade"]:visible').click();await page.locator('.resource-pick[data-side="give"][data-resource="wood"]').click();await outside(page,'#stage-dialog');await page.locator('[data-action="trade"]:visible').click();assert.equal(await page.locator('.exchange-body>.exchange-resources:nth-child(2) .exchange-card.wood output').textContent(),'1');await page.keyboard.press('Escape');assert.equal(client.actions.filter(a=>a.type==='offerTrade').length,0);}
    results.push({name,phase,viewportFits:true});await client.context.close();
  }
  assert.deepEqual(errors,[]);await writeFile(`${out}/${before?'before':'after'}-results.json`,JSON.stringify({scope:'Local Chromium emulation; protocol fixtures for six-player table states.',results,errors},null,2));console.log(`${before?'Baseline screenshots':'Visual-first acceptance'}: ${results.length} cases passed`);
}finally{await browser.close();}
