import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { Vector3 } from 'three';
import { createBoard } from '../shared/board.js';
import { boardCamera, openStagePanel, closeStagePanel, toggleBoard } from './browser-stage-helpers.js';

const url=process.env.TEST_URL||'http://127.0.0.1:5185',results=[],errors=[];
await mkdir('test-results/immersive',{recursive:true});
let seed=17;const preview=createBoard(()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;});
async function open(browser,viewport,touch=false){
  const context=await browser.newContext({viewport,isMobile:touch,hasTouch:touch,deviceScaleFactor:1});
  const page=await context.newPage();page.on('pageerror',e=>{errors.push(e.message);console.log('pageerror:',e.message);});
  await page.route('**/api/rooms',route=>route.request().method()==='GET'?route.fulfill({json:{rooms:[]}}):route.continue());
  await page.goto(url);await page.locator('#board canvas[data-render-stats]').waitFor();
  return {context,page};
}
async function homeFit(page){
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'home horizontal overflow');
  const rects=await page.locator('#board,#island-caption,.tile-hint,.board-controls,.home-intro,#create-room').evaluateAll(els=>els.map(el=>({id:el.id||el.className,rect:el.getBoundingClientRect().toJSON()})));
  for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
    const a=rects[i],b=rects[j],overlap=Math.max(0,Math.min(a.rect.right,b.rect.right)-Math.max(a.rect.x,b.rect.x))*Math.max(0,Math.min(a.rect.bottom,b.rect.bottom)-Math.max(a.rect.y,b.rect.y));
    assert.ok(overlap<2,`home overlap ${a.id}/${b.id}`);
  }
  const bounds=await page.locator('#board canvas').boundingBox(),camera=await boardCamera(page,bounds);
  for(const port of preview.ports){
    const [a,b]=port.vertices.map(i=>preview.vertices[i]),x=(a.x+b.x)/2,z=(a.z+b.z)/2,length=Math.hypot(x,z),p=new Vector3(x+x/length*.69,.4,z+z/length*.69).project(camera);
    assert.ok(Math.abs(p.x)<.97&&Math.abs(p.y)<.97,`port outside fitted preview ${JSON.stringify(p)}`);
    const px=bounds.x+(p.x+1)*bounds.width/2,py=bounds.y+(1-p.y)*bounds.height/2;
    for(const {id,rect} of rects.filter(r=>r.id!=='board'))assert.ok(px<rect.x||px>rect.right||py<rect.y||py>rect.bottom,`port overlaps ${id}`);
  }
}
async function shot(page,name){await page.screenshot({path:`test-results/immersive/${name}.png`,fullPage:true,scale:'css'});results.push(name);console.log(name);}
for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await type.launch({headless:true});
  try{
    for(const [name,viewport,touch] of (process.env.UI_PHASE==='practice'?[]:[
      ['desktop',{width:1440,height:900},false],['narrow',{width:940,height:700},false],
      ['phone',{width:390,height:844},true],['landscape',{width:844,height:390},true],['small',{width:320,height:568},true],
      ['zoom-reflow',{width:720,height:600},false],
    ])){
      const {context,page}=await open(browser,viewport,touch);await homeFit(page);await shot(page,`${engine}-home-${name}`);
      if(name==='small'||name==='narrow'){
        await page.evaluate(()=>{const els=[...document.querySelectorAll('body *:not(svg):not(svg *)')],sizes=els.map(el=>parseFloat(getComputedStyle(el).fontSize));els.forEach((el,i)=>el.style.fontSize=`${sizes[i]*1.5}px`);});
        await page.waitForTimeout(120);await homeFit(page);await shot(page,`${engine}-home-${name}-text150`);
      }
      await context.close();
    }
    for(const count of [3,4,5,6]){
      const {context,page}=await open(browser,{width:390,height:844},true);let view;
      page.on('websocket',ws=>ws.on('framereceived',({payload})=>{try{const m=JSON.parse(payload);if(m.type==='state')view=m.state;}catch{}}));
      await page.locator('#nickname').fill(`练习${count}`);
      await page.locator('#create-friendlyRobber').check();await page.locator('#create-harbormaster').check();
      await page.locator('#create-count-6').check();await page.locator('#create-count-3').check();
      assert.ok(await page.locator('#create-friendlyRobber').isChecked());assert.ok(await page.locator('#create-harbormaster').isChecked());
      await page.getByRole('button',{name:'人机练习',exact:true}).click();
      assert.equal(view,undefined,'practice started before confirming count');
      await page.locator(`#practice-count-${count}`).check();
      assert.match(await page.locator('#practice-seats').innerText(),new RegExp(`电脑\\s*${count-1}`));
      assert.match(await page.locator('#practice-rule-summary').innerText(),count>4?/5–6 人扩充/:/基础版/);
      assert.ok(await page.locator('#practice-friendlyRobber').isChecked());assert.ok(await page.locator('#practice-harbormaster').isChecked());
      await shot(page,`${engine}-practice-${count}`);
      if(count===6){
        await page.setViewportSize({width:844,height:390});
        const dialog=await page.locator('#practice-dialog').boundingBox(),start=await page.locator('#practice-start').boundingBox();
        assert.ok(dialog.y>=0&&dialog.y+dialog.height<=390,'practice dialog leaves short landscape');
        assert.ok(start.y>=dialog.y&&start.y+start.height<=dialog.y+dialog.height,'practice confirmation requires page scrolling');
        assert.ok(await page.locator('#practice-dialog').evaluate(el=>el.scrollHeight<=el.clientHeight+1),'short landscape practice scrolls');
        await shot(page,`${engine}-practice-landscape`);await page.setViewportSize({width:390,height:844});
      }
      await page.getByRole('button',{name:'开始练习',exact:false}).click();
      await page.locator('.playing #board canvas[data-render-stats]').waitFor();
      assert.equal(view.players.length,count);assert.equal(view.players.filter(p=>p.bot).length,count-1);
      assert.equal(view.options.playerExpansion,count>4?'five-six-2025':'base');assert.equal(view.targetPoints,11);
      const identity=view.me,room=page.url();await page.reload();await page.locator('.playing #board canvas[data-render-stats]').waitFor();
      assert.equal(view.me,identity);assert.equal(page.url(),room);assert.equal(view.players.length,count);
      await toggleBoard(page,'切换二维棋盘');await page.locator('#board [data-id]').first().click();await page.getByText('铺设起始道路',{exact:true}).waitFor();
      await page.locator('#board [data-id]').first().click();
      // Let the existing bot scheduler finish the remaining setup placements.
      // Sending host commands during that burst correctly rejects a stale revision.
      for(let i=0;i<300&&!(view.phase==='setup-settlement'&&view.turn===0&&view.setupIndex===count*2-1);i++)await page.waitForTimeout(20);
      assert.ok(view.phase==='setup-settlement'&&view.turn===0&&view.setupIndex===count*2-1,'bots did not return setup to the human');
      await toggleBoard(page,'切换三维棋盘');
      await shot(page,`${engine}-game-${count}`);
      await openStagePanel(page,'openSettings');await page.getByRole('button',{name:'解散房间',exact:true}).click();await page.getByRole('button',{name:'确认解散',exact:true}).click();
      await page.locator('.table.home').waitFor().catch(async error=>{await shot(page,`${engine}-close-error`);console.log((await page.locator('body').innerText()).slice(-1800));throw error;});await context.close();
    }
    // Live room settings retain incompatible choices and require an explicit fix.
    const {context,page}=await open(browser,{width:940,height:700});
    await page.locator('#nickname').fill('规则检查');await page.locator('#create-count-5').check();await page.locator('#create-friendlyRobber').check();
    await page.getByRole('button',{name:'创建好友房间',exact:false}).click();await page.locator('#room-settings-form').waitFor();
    for(let i=0;i<4;i++){await page.getByRole('button',{name:'添加电脑玩家',exact:false}).click();await page.waitForTimeout(100);}
    await page.locator('#room-count-3').check();
    assert.ok(await page.locator('#room-compatibility').isVisible());assert.ok(await page.locator('#room-friendlyRobber').isChecked());
    assert.ok(await page.getByRole('button',{name:'保存规则 · 重新准备'}).isDisabled());
    await page.locator('#room-count-6').check();assert.ok(await page.locator('#room-compatibility').isHidden());
    await page.getByRole('button',{name:'保存规则 · 重新准备'}).click();
    await shot(page,`${engine}-room-rules`);
    await page.getByRole('button',{name:'解散房间',exact:true}).click();await page.getByRole('button',{name:'确认解散',exact:true}).click();
    await context.close();
  }finally{await browser.close();}
}
assert.deepEqual(errors,[]);
await writeFile('test-results/immersive/results.json',JSON.stringify({results,errors},null,2));
console.log(`Immersive UI passed: ${results.length} screenshots, Chromium/WebKit, separated homepage regions and fitted ports, 150% text, 3–6 real practice/variants/reconnect/builds, incompatible room choices retained.`);
