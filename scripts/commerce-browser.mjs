import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {openFixture} from './map-first-fixture.js';
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'}),errors=[],results=[];
const edition=process.env.TEST_EDITION||'global',out='docs/qa/commerce';
await mkdir(out,{recursive:true});
async function fits(page){
  const r=await page.evaluate(()=>({w:innerWidth,h:innerHeight,sw:document.documentElement.scrollWidth,sh:document.documentElement.scrollHeight,buttons:[...document.querySelectorAll('.exchange-footer button')].map(e=>e.getBoundingClientRect().toJSON())}));
  assert.ok(r.sw<=r.w+1&&r.sh<=r.h+1,'whole page scrolls');
  for(const b of r.buttons)assert.ok(b.top>=0&&b.bottom<=r.h&&b.left>=0&&b.right<=r.w,'footer action clipped');
}
async function close(page){await page.keyboard.press('Escape');await page.waitForTimeout(80);}
try {
  for(const [name,viewport] of [['desktop',{width:1366,height:768}],['portrait',{width:390,height:844}],['small',{width:320,height:568}],['landscape',{width:844,height:390}],['short-landscape',{width:667,height:320}]]){
    const c=await openFixture(browser,{count:4,viewport,touch:name!=='desktop',errors}),p=c.page;
    await p.locator('[data-action="trade"]:visible').click();
    const wood=p.locator('.resource-pick[data-side="give"][data-resource="wood"]');
    if(name==='desktop')await wood.click();else await wood.tap();
    await p.locator('.resource-pick[data-side="want"][data-resource="ore"]').click();
    await fits(p);await p.screenshot({path:`${out}/after-${edition}-${name}-trade.png`});
    assert.equal(await p.locator('.resource-pick[data-side="want"][data-resource="wood"]').isDisabled(),true);
    await close(p);await p.locator('[data-action="trade"]:visible').click();
    assert.equal(await p.locator('.exchange-card.wood output').first().textContent(),'1');
    await p.mouse.click(2,2);await p.locator('#stage-dialog').waitFor({state:'hidden'});
    await p.locator('[data-action="trade"]:visible').click();await p.goBack();await p.locator('#stage-dialog').waitFor({state:'hidden'});
    await p.locator('[data-action="trade"]:visible').click();
    await p.locator('[data-action="publishTrade"]').click();
    await p.locator('[data-action="cancelTrade"]').waitFor();
    assert.equal(c.actions.filter(a=>a.type==='offerTrade').length,1);
    await fits(p);await p.screenshot({path:`${out}/after-${edition}-${name}-offer.png`});
    await p.locator('[data-action="cancelTrade"]').click();
    await p.locator('[data-trade-view="bank"]').click();
    await fits(p);await p.screenshot({path:`${out}/after-${edition}-${name}-bank.png`});
    const bankBefore=c.game.players[0].hand.ore;await p.locator('[data-action="exchangeBank"]').click();
    assert.equal(c.game.players[0].hand.ore,bankBefore+1,'bank exchange failed');
    await close(p);
    const before=c.actions.length;await p.locator('[data-build="development"]:visible').click();
    assert.equal(c.actions.length,before,'inspecting development spent resources');
    await p.locator('.build-cost').waitFor();await p.screenshot({path:`${out}/after-${edition}-${name}-cost.png`});
    await p.locator('[data-action="closeCost"]').click();
    c.set({...c.game,turn:1});
    c.action('p1',{type:'offerTrade',give:{ore:1},want:{wood:1}});
    await p.waitForTimeout(150);assert.equal(await p.locator('#stage-dialog').isVisible(),false,'incoming offer interrupted map');
    await p.locator('[data-action="trade"]:visible').click();await p.locator('[data-action="acceptTrade"]').waitFor();await fits(p);
    await p.locator('[data-action="acceptTrade"]').click();assert.equal(c.game.offer,null);
    await close(p);await p.locator('[data-action="openSettings"]:visible').click();await p.locator('[data-action="toggleFlat"]:visible').click();await close(p);
    await p.locator('[data-port]').first().focus();await p.keyboard.press('Enter');await p.locator('.port-detail').waitFor();
    await p.screenshot({path:`${out}/after-${edition}-${name}-port-2d.png`});
    await close(p);
    results.push({name,edition,draft:true,trade:true,bank:true,costInspection:true,incomingNonmodal:true,portKeyboard:true});await c.context.close();
  }
  assert.deepEqual(errors,[]);await writeFile(`${out}/results-${edition}.json`,JSON.stringify({scope:'Local Edge Chromium emulation with authoritative game protocol fixtures; no physical phone.',results,errors},null,2));
  console.log(`${edition}: ${results.length} viewport scenarios passed`);
}finally{await browser.close();}
