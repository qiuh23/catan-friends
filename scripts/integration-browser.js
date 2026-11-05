import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const url=process.env.TEST_URL||'http://127.0.0.1:5175';
const browser=await chromium.launch({headless:true});
await mkdir('test-results',{recursive:true});
try {
  for(const backendId of ['aliyun','cloudflare']){
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    // Metadata is mocked so the production invitation UI can be tested at loopback.
    // All actual room/WS requests still use the local Node runtime.
    await page.route('**/api/deployment',route=>route.fulfill({json:{ok:true,game:'catan-friends',backendId,publicOrigin:new URL(url).origin}}));
    const wrong=backendId==='aliyun'?'C':'A';
    await page.goto(`${url}/?room=${wrong}-ABC234`);
    await page.getByRole('alert').filter({hasText:'另一台服务器'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'创建好友房间'}).isDisabled(),true);
    assert.equal(new URL(page.url()).searchParams.get('room'),`${wrong}-ABC234`);
    await page.screenshot({path:`test-results/${backendId}-wrong-server-mobile.png`,fullPage:true});
    await page.goto(url);await page.locator('#nickname').fill(`本地${backendId}`);
    await page.getByRole('button',{name:'创建好友房间'}).click();await page.getByRole('heading',{name:'等朋友入座'}).waitFor();
    assert.match(new URL(page.url()).searchParams.get('room'),backendId==='aliyun'?/^A-[A-HJ-NP-Z2-9]{6}$/:/^C-[A-HJ-NP-Z2-9]{6}$/);
    const lobby=page.getByRole('link',{name:'返回当前服务器游戏大厅'});
    assert.equal(await lobby.getAttribute('href'),backendId==='aliyun'?'https://magical-athlete-online.cn/':'https://magical-athlete.qiuh23.workers.dev/lobby/');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'production header must fit mobile');
    await page.screenshot({path:`test-results/${backendId}-room-mobile.png`,fullPage:true});
    assert.deepEqual(errors,[]);await context.close();
  }
  console.log('Integration browser passed: wrong-server invitation is blocked without navigation; A/C own-server codes, trusted return links and mobile headers fit.');
}finally{await browser.close();}
