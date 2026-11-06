import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const mode=process.env.CAPTURE_PREFIX||'after',base=process.env.TEST_URL||'http://127.0.0.1:5183';
const results=[],errors=[];
await mkdir('docs/qa/entry-design',{recursive:true});
const overlap=(a,b)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y));
for(const [engine,type]of [['chromium',chromium],['webkit',webkit]]) {
 const browser=await type.launch({headless:true});
 for(const [name,viewport]of [['desktop',{width:1440,height:1000}],['portrait',{width:390,height:844}],['landscape',{width:844,height:390}],['small',{width:320,height:568}],['short-landscape',{width:667,height:320}]]) {
  const context=await browser.newContext({viewport,hasTouch:name!=='desktop',isMobile:name!=='desktop'}),page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);await page.locator('#board canvas[data-camera]').waitFor();await page.waitForTimeout(250);
  const metrics=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight}));
  assert.ok(metrics.scrollWidth<=metrics.width+1&&metrics.scrollHeight<=metrics.height+1,'home page overflow');
  const controls=await page.locator('.topbar a,.topbar button,#home-dock button,.home .board-controls button').evaluateAll(ns=>ns.filter(e=>e.getClientRects().length).map(e=>({name:e.getAttribute('aria-label')||e.textContent,rect:e.getBoundingClientRect().toJSON()})));
  for(const c of controls){assert.ok(c.rect.x>=0&&c.rect.y>=0&&c.rect.right<=viewport.width&&c.rect.bottom<=viewport.height,`${name} cropped ${c.name}`);assert.ok(c.name.trim());assert.ok(c.rect.height>=44,`${name} short touch target ${c.name}`);}
  for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++)assert.ok(overlap(controls[i].rect,controls[j].rect)<2,`${name} overlap ${controls[i].name}/${controls[j].name}`);
  if(engine==='chromium'&&!name.includes('small')&&!name.includes('short'))await page.screenshot({path:`docs/qa/entry-design/${mode}-${name}.png`});
  await page.locator('[data-action="openEntry"]').click();
  if(engine==='chromium'&&!name.includes('small')&&!name.includes('short'))await page.screenshot({path:`docs/qa/entry-design/${mode}-entry-${name}.png`});
  await page.locator('#nickname').fill('岛屿探险家');
  assert.equal(await page.locator('.variant-card').filter({visible:true}).count(),2);
  assert.ok(await page.locator('#entry-content').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'entry horizontal overflow');
  for(const selector of ['#nickname','#join-code','#create-room','#create-friendlyRobber','#create-harbormaster']) {
   const target=page.locator(selector).locator('..');await target.scrollIntoViewIfNeeded();
   const rect=await target.boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=viewport.width+1,'entry control outside viewport');
  }
  await page.locator('#nickname').scrollIntoViewIfNeeded();
  await page.locator('#create-friendlyRobber').check();await page.selectOption('#create-visibility','private');
  await page.keyboard.press('Escape');await page.locator('[data-action="openEntry"]').click();assert.equal(await page.locator('#nickname').inputValue(),'岛屿探险家');assert.ok(await page.locator('#create-friendlyRobber').isChecked());assert.equal(await page.locator('#create-visibility').inputValue(),'private');
  const input=page.locator('#nickname');await input.focus();await page.keyboard.press('Tab');assert.equal(await page.locator('#join-code').evaluate(e=>document.activeElement===e),true);
  await page.keyboard.press('Escape');await page.locator('[data-action="homePractice"]').click();await page.locator('#practice-dialog').waitFor({state:'visible'});assert.equal(await page.locator('#practice-dialog .count-buttons label').count(),4);
  await page.locator('#practice-count-6').check();assert.match(await page.locator('#practice-rule-summary').innerText(),/5–6/);await page.keyboard.press('Escape');
  await page.locator('[data-action="openRooms"]').click();await page.locator('#rooms-dialog').waitFor({state:'visible'});await page.keyboard.press('Escape');
  await page.locator('[data-action="rules"]').click();await page.locator('#rules-dialog').waitFor({state:'visible'});await page.keyboard.press('Escape');
  results.push({engine,name,...metrics,controls:controls.length});await context.close();
 }
 await browser.close();
}
assert.deepEqual(errors,[]);
await writeFile('docs/qa/entry-design/check-results.json',JSON.stringify({results,errors},null,2));console.log(JSON.stringify({cases:results.length,errors}));
