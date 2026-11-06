import {chromium,webkit} from 'playwright';
import {PerspectiveCamera,Vector3} from 'three';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createBoard} from '../shared/board.js';
import {openFixture,testURL,entry,names} from './map-first-fixture.js';
import {openStagePanel,closeStagePanel,toggleBoard} from './browser-stage-helpers.js';

// UI fixtures use the real rules and private-player projection over loopback.
// Actual room persistence and network behavior are covered by multiplayer smoke.
const errors=[],results=[],matrix=[
  ['desktop1920',{width:1920,height:1080},false],
  ['desktop1366',{width:1366,height:768},false],
  ['portrait',{width:390,height:844},true],
  ['landscape',{width:844,height:390},true],
  ['short-landscape',{width:667,height:320},true],
];
await mkdir('test-results',{recursive:true});await mkdir('docs/screenshots',{recursive:true});
const overlap=(a,b)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
async function layout(page,{home=false}={}){
  const metrics=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,scrollY,board:document.querySelector('#board').getBoundingClientRect().toJSON(),panels:[...document.querySelectorAll('#left-panel,#right-panel')].map(el=>({id:el.id,display:getComputedStyle(el).display,rect:el.getBoundingClientRect().toJSON()}))}));
  assert.ok(metrics.scrollHeight<=metrics.height+1&&metrics.scrollWidth<=metrics.width+1&&metrics.scrollY===0,`whole page scroll: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.board.x<=1&&metrics.board.y<=1&&metrics.board.width>=metrics.width-2&&metrics.board.height>=metrics.height-2,`board is not the viewport: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.panels.every(p=>p.display==='none'||p.rect.width===0||p.rect.height===0),'persistent side columns remain');
  const selector=home?'#home-dock button,.home .topbar button,.home .board-controls button,.topbar button': '#play-dock button,#stage-tools button,#stage-tools .stage-brand,#player-orbit button,#hand button';
  const controls=await page.locator(selector).evaluateAll(nodes=>nodes.filter(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden').map(el=>({name:el.getAttribute('aria-label')||el.textContent,box:el.getBoundingClientRect().toJSON()})));
  for(const {name,box}of controls)assert.ok(box.x>=-1&&box.y>=-1&&box.right<=metrics.width+1&&box.bottom<=metrics.height+1,`control outside viewport ${name} ${JSON.stringify(box)}`);
  for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++)assert.ok(overlap(controls[i].box,controls[j].box)<2,`overlapping controls ${controls[i].name}/${controls[j].name}`);
  if(!home){const banner=await page.locator('.turn-banner').boundingBox(),box={left:banner.x,right:banner.x+banner.width,top:banner.y,bottom:banner.y+banner.height};for(const control of controls)assert.ok(overlap(box,control.box)<2,`turn banner covers ${control.name}`);}
  if(!home){
    assert.equal(await page.locator('.resource-hand .resource-card').count(),5);
    const hand=await page.locator('.hand-tray').boundingBox();assert.ok(hand.y>=0&&hand.y+hand.height<=metrics.height+1,'resources require page scrolling');
    assert.ok(await page.locator('[data-action="openHand"]').isVisible(),'hand entry is missing');
    for(const key of ['road','settlement','city','development'])assert.ok(await page.locator(`#play-dock [data-build="${key}"]`).isVisible(),`missing ${key} entry`);
    for(const key of ['trade','endTurn'])assert.ok(await page.locator(`#play-dock [data-action="${key}"]`).isVisible(),`missing ${key} entry`);
  }
  return metrics;
}
async function mapFit(page,board){
  const canvas=page.locator('#board canvas'),bounds=await canvas.boundingBox();
  const meta=await canvas.evaluate(el=>({eye:JSON.parse(el.dataset.camera),target:JSON.parse(el.dataset.cameraTarget||'[0,0,0]'),view:JSON.parse(el.dataset.cameraView||'null')}));
  const camera=new PerspectiveCamera(34,bounds.width/bounds.height,.1,150);camera.position.fromArray(meta.eye);camera.lookAt(...meta.target);if(meta.view?.enabled)camera.setViewOffset(meta.view.fullWidth,meta.view.fullHeight,meta.view.offsetX,meta.view.offsetY,meta.view.width,meta.view.height);camera.updateMatrixWorld();
  const points=[...board.vertices.map(v=>({...v,y:.4,kind:'coast'})),...board.tiles.filter(t=>t.number).map(t=>({...t,y:.8,kind:'number'}))];
  for(const port of board.ports){const[a,b]=port.vertices.map(id=>board.vertices[id]),x=(a.x+b.x)/2,z=(a.z+b.z)/2,length=Math.hypot(x,z);points.push({x:x+x/length*.69,y:.4,z:z+z/length*.69,kind:'port'});}
  const occluders=await page.locator('#home-dock,#player-orbit,.hand-tray,#play-dock,#turn-banner>.turn-banner,#island-caption').evaluateAll(nodes=>nodes.filter(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden').map(el=>({name:el.id||el.className,box:el.getBoundingClientRect().toJSON()})));
  for(const point of points){const p=new Vector3(point.x,point.y,point.z).project(camera),pixel={x:bounds.x+(p.x+1)*bounds.width/2,y:bounds.y+(1-p.y)*bounds.height/2};assert.ok(Math.abs(p.x)<.99&&Math.abs(p.y)<.99,`cropped ${point.kind}: ${JSON.stringify(pixel)}`);for(const{name,box}of occluders)assert.ok(!(pixel.x>=box.x&&pixel.x<=box.right&&pixel.y>=box.y&&pixel.y<=box.bottom),`${point.kind} hidden by ${name}: ${JSON.stringify(pixel)}`);}
}
async function shot(page,name,{review=false,home=false}={}){
  const path=`test-results/map-first-${name}.png`;await page.screenshot({path,fullPage:true,scale:'css'});
  const metrics=await layout(page,{home});if(review)await page.screenshot({path:`docs/screenshots/map-first-${name}.png`,fullPage:true,scale:'css'});results.push({name,path,metrics});
}
async function camera(page){return page.locator('#board canvas').evaluate(el=>({eye:el.dataset.camera,target:el.dataset.cameraTarget,view:el.dataset.cameraView}));}
function sameCamera(a,b,message){for(const key of ['eye','target']){const x=JSON.parse(a[key]||'[0,0,0]'),y=JSON.parse(b[key]||'[0,0,0]');assert.ok(x.every((n,i)=>Math.abs(n-y[i])<1e-7),message);}assert.equal(a.view,b.view,message);}
let previewSeed=17;const preview=createBoard(()=>{previewSeed=(previewSeed*1664525+1013904223)>>>0;return previewSeed/4294967296;});
for(const[engine,type]of [['chromium',chromium],['webkit',webkit]]){
  if(process.env.MAP_ENGINE&&process.env.MAP_ENGINE!==engine)continue;
  const browser=await type.launch({headless:true});
  try{
    for(const[name,viewport,touch]of matrix){
      const context=await browser.newContext({viewport,hasTouch:touch,isMobile:touch}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
      await page.goto(testURL);await page.locator('#board canvas[data-camera]').waitFor();await page.waitForTimeout(180);
      await shot(page,`${engine}-home-${name}`,{home:true,review:engine==='chromium'&&['desktop1920','portrait'].includes(name)});await mapFit(page,preview);
      await entry(page);await page.locator('#nickname').fill('保留的入口昵称');await page.keyboard.press('Escape');await entry(page);assert.equal(await page.locator('#nickname').inputValue(),'保留的入口昵称','closing entry lost nickname');await context.close();
      for(const count of [3,6]){
        const client=await openFixture(browser,{count,viewport,touch,errors}),{page}=client;
        await shot(page,`${engine}-${count}-${name}`,{review:engine==='chromium'&&count===6});await mapFit(page,client.game.board);
        const circles=page.locator('#player-orbit [data-player]');assert.equal(await circles.count(),count,'player orbit count');
        assert.equal(await page.locator('#player-orbit [aria-current="true"]').count(),1,'current player lacks a noncolor marker');
        for(let i=0;i<count;i++){
          const circle=circles.nth(i),box=await circle.boundingBox();assert.ok(Math.abs(box.width-box.height)<1&&box.width>=40&&box.width<=56,'player is not a compact circular target');
          await circle.click();await page.locator('#stage-dialog[open]').waitFor();assert.ok((await page.locator('#stage-dialog').innerText()).includes(names[i]),'long full player name missing from public details');await closeStagePanel(page);
        }
        const before=await camera(page);
        for(const action of ['openChat','openLog','openSettings','openHand']){await openStagePanel(page,action);await closeStagePanel(page);sameCamera(await camera(page),before,`${action} moved the camera`);}
        if(count===6&&name==='portrait'&&engine==='chromium'){
          client.chat('带未读的新消息');await page.locator('.chat-unread').waitFor();await openStagePanel(page,'openChat');await page.locator('#chat-message').fill('保留的聊天草稿');client.chat('同时收到消息');await page.waitForTimeout(100);assert.equal(await page.locator('#chat-message').inputValue(),'保留的聊天草稿');await closeStagePanel(page);await openStagePanel(page,'openChat');assert.equal(await page.locator('#chat-message').inputValue(),'保留的聊天草稿');assert.equal(await page.locator('.chat-unread').count(),0);
          await page.setViewportSize({width:390,height:430});await page.locator('#chat-message').focus();const input=await page.locator('#chat-message').boundingBox();assert.ok(input.y>=0&&input.y+input.height<=430,'chat field leaves simulated keyboard viewport');await page.screenshot({path:'docs/screenshots/map-first-chat-keyboard-simulation.png',fullPage:true,scale:'css'});await page.setViewportSize(viewport);await closeStagePanel(page);
          await page.locator('#board canvas').focus();await page.keyboard.press('+');await page.waitForTimeout(250);const savedCamera=await camera(page);
          await page.reload();await page.locator('.playing #board canvas[data-camera]').waitFor();await page.waitForTimeout(200);assert.equal(await page.locator('#player-orbit [data-player]').count(),6,'refresh lost player state');assert.equal(await page.locator('#action-feedback').isVisible(),false,'refresh replayed old feedback');sameCamera(await camera(page),savedCamera,'refresh lost the manual 3D camera');await openStagePanel(page,'openChat');assert.equal(await page.locator('#chat-message').inputValue(),'保留的聊天草稿','refresh lost chat draft');await closeStagePanel(page);
          await toggleBoard(page,'切换二维棋盘');const svg=page.locator('#board>svg');await svg.focus();await page.keyboard.press('+');await page.mouse.move(180,410);await page.mouse.down();await page.mouse.move(205,427,{steps:4});await page.mouse.up();await page.waitForTimeout(200);const savedFlat=await svg.getAttribute('viewBox');
          await page.reload();await page.locator('.playing #board>svg').waitFor();await page.waitForTimeout(150);assert.equal(await page.locator('#board>svg').getAttribute('viewBox'),savedFlat,'refresh lost 2D renderer, pan or zoom');await shot(page,`${engine}-6-flat-portrait`);await toggleBoard(page,'切换三维棋盘');sameCamera(await camera(page),savedCamera,'2D/3D switch lost the manual 3D camera');
        }
        await client.context.close();
      }
    }
    if(engine==='chromium')for(const[name,viewport,insets]of [['portrait',{width:390,height:844},{top:32,bottom:24,left:0,right:0}],['landscape',{width:667,height:375},{top:0,bottom:21,left:59,right:59}]]){
      const client=await openFixture(browser,{count:6,viewport,touch:true,errors,insets});await shot(client.page,`chromium-safe-area-${name}`);await client.context.close();
    }
  }finally{await browser.close();}
}
assert.deepEqual(errors,[]);await writeFile('test-results/map-first-results.json',JSON.stringify({scope:'Local browser viewport/touch/keyboard-space simulations, no physical mobile device validation',results,errors},null,2));
console.log(`Map-first acceptance passed: ${results.length} screenshots, full map and no page scroll, compact player details, controls, chat drafts/unread, refresh and 2D/3D.`);
