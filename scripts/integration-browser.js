import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import {openStagePanel} from './browser-stage-helpers.js';

const url=process.env.TEST_URL||'http://127.0.0.1:5175';
const browser=await chromium.launch({headless:true});
await mkdir('test-results',{recursive:true});
try {
  for(const backendId of [process.env.TEST_EDITION==='cn'?'aliyun':'cloudflare']){
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    // Metadata is mocked so the production invitation UI can be tested at loopback.
    // All actual room/WS requests still use the local Node runtime.
    await page.route('**/api/deployment',route=>route.fulfill({json:{ok:true,siteEdition:process.env.TEST_EDITION||'global',game:'catan-friends',backendId,publicOrigin:new URL(url).origin}}));
    const wrong=backendId==='aliyun'?'C':'A';
    await page.goto(`${url}/?room=${wrong}-ABC234`);
    await page.locator('[data-action=openEntry]').click();
    await page.getByRole('alert').filter({hasText:'此邀请不属于当前站点'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'创建好友房间'}).isDisabled(),true);
    assert.equal(new URL(page.url()).searchParams.get('room'),`${wrong}-ABC234`);
    await page.screenshot({path:`test-results/${backendId}-wrong-server-mobile.png`,fullPage:true});
    await page.goto(url);await page.locator('[data-action=openEntry]').click();if(await page.locator('#nickname').count())await page.locator('#nickname').fill(`本地${backendId}`);
    await page.getByRole('button',{name:'创建好友房间'}).click();await page.locator('.waiting-banner').waitFor();
    await openStagePanel(page,'openSettings');
    assert.match(new URL(page.url()).searchParams.get('room'),backendId==='aliyun'?/^A-[A-HJ-NP-Z2-9]{6}$/:/^C-[A-HJ-NP-Z2-9]{6}$/);
    const lobby=page.getByRole('link',{name:'返回游戏大厅'});
    assert.equal(await lobby.getAttribute('href'),backendId==='aliyun'?'https://magical-athlete-online.cn/':'https://magical-athlete.qiuh23.workers.dev/lobby/');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'production header must fit mobile');
    await page.screenshot({path:`test-results/${backendId}-room-mobile.png`,fullPage:true});
    const roomURL=page.url(),destination=await lobby.getAttribute('href');
    await lobby.click();await page.getByText(/你是房主。返回游戏大厅会暂离房间并保留房主身份/).waitFor();
    assert.equal(page.url(),roomURL);await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(page.url(),roomURL);
    // Capture the destination locally; never contact production during this test.
    await page.route(destination,route=>route.fulfill({contentType:'text/html',body:'<h1>对应服务器游戏大厅</h1>'}));
    await lobby.click();await page.getByRole('button',{name:'暂离并返回',exact:true}).click();await page.waitForURL(destination);
    const returned=new URL(page.url());assert.equal(returned.search,'');assert.equal(returned.hash,'');
    assert.deepEqual(errors,[]);await context.close();
  }
  console.log('Integration browser passed: wrong-server invitation blocked; A/C room codes, confirmation/cancel and corresponding lobby navigation without queries or tokens; mobile headers fit.');
}finally{await browser.close();}
