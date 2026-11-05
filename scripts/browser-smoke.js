import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { toggleBoard, openStagePanel } from './browser-stage-helpers.js';
const url=process.env.TEST_URL||'http://127.0.0.1:5175';
await mkdir('test-results',{recursive:true});
const browser=await chromium.launch({headless:true});const errors=[];
try{
  const context=await browser.newContext({viewport:{width:1440,height:960}});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.locator('#board canvas').waitFor();await page.screenshot({path:'test-results/home-desktop.png',fullPage:true});
  await page.locator('#nickname').fill('海风');await page.getByRole('button',{name:'先和电脑练一局'}).click();
  await page.getByText('你的回合',{exact:true}).waitFor();await page.screenshot({path:'test-results/game-desktop.png',fullPage:true});
  const originalRoom=await page.locator('.room-code').textContent();await page.reload();await page.getByText('你的回合',{exact:true}).waitFor();assert.equal(await page.locator('.room-code').textContent(),originalRoom);
  // Use the shipped 2D fallback for repeatable location clicks; it invokes the same commands as 3D raycasts.
  await toggleBoard(page,'切换二维棋盘');await page.locator('#board [data-id]').first().click();await page.getByText('铺设起始道路').waitFor();await page.locator('#board [data-id]').first().click();
  await page.getByText('放置村庄').waitFor({timeout:25000});await page.locator('#board [data-id]').first().click();await page.getByText('铺设起始道路').waitFor();await page.locator('#board [data-id]').first().click();
  await page.getByRole('button',{name:'掷出骰子'}).waitFor({timeout:25000});await page.getByRole('button',{name:'掷出骰子'}).click();await page.waitForFunction(()=>document.querySelector('.dice-pair'));
  await toggleBoard(page,'切换三维棋盘');await page.screenshot({path:'test-results/game-after-setup.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/game-mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile overflow');
  await openStagePanel(page,'openSettings');await page.getByRole('button',{name:'玩法指南',exact:true}).click();await page.locator('#rules-dialog').waitFor({state:'visible'});await page.keyboard.press('Escape');
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const home=await mobile.newPage();home.on('pageerror',e=>errors.push(e.message));await home.goto(url);await home.locator('#board canvas').waitFor();await home.screenshot({path:'test-results/home-mobile.png',fullPage:true});assert.ok(await home.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);console.log('Browser smoke passed: desktop/mobile, practice setup, roll, refresh, rules, 2D/3D switching, no page errors or horizontal overflow.');
}finally{await browser.close();}
