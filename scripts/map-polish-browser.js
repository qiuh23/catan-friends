import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {act,viewFor,legal} from '../shared/game.js';
import {polishGame,polishURL} from './immersive-polish-fixture.js';

const browser=await chromium.launch({headless:true}),errors=[],results=[];
await mkdir('test-results/map-polish',{recursive:true});
function scene(count,mode){
  let game=polishGame(count,{phase:mode==='settlement'||mode==='road'?'setup-settlement':'action'});
  if(mode==='road')game=act(game,'p0',{type:'buildSettlement',vertex:legal(game,'p0').settlement[0]},()=>.43);
  if(mode==='robber'){game.phase='robber';game.resumePhase='action';}
  return viewFor(game,'p0');
}
async function shot(page,name){const path=`test-results/map-polish/${name}.png`;await page.screenshot({path,scale:'css'});results.push({name,path});console.log(name);}
async function load(page,state,mode,kind='3d'){
  await page.evaluate(async ({state,mode,kind})=>{
    window.mapBoard?.dispose();window.mapClasses=await import('/src/board.js');window.mapState=state;window.mapMode=mode;window.selections=[];window.hints=[];
    window.mapBoard=new window.mapClasses[kind==='3d'?'Board':'FlatBoard'](document.querySelector('#fixture'),target=>window.selections.push(target),text=>window.hints.push(text));
    window.mapBoard.setViewportPadding({top:40,bottom:40,left:16,right:16});window.mapBoard.set(state,mode);
  },{state,mode,kind});
  await page.locator(kind==='3d'?'canvas[data-camera]':'#fixture>svg').waitFor();await page.waitForTimeout(100);
}
async function candidateReport(page,touch=false){
  return page.evaluate(touch=>{
    const b=window.mapBoard,canvas=b.renderer?.domElement||b.container.querySelector('svg'),rect=canvas.getBoundingClientRect();
    let candidates;
    if(b.markerTargets)candidates=b.markerTargets.map(marker=>{const p=marker.position.clone().project(b.camera);return {kind:marker.userData.kind,id:marker.userData.id,x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2};});
    else candidates=[...canvas.querySelectorAll('[data-id]')].map(el=>{const p=new DOMPoint(Number(el.getAttribute('cx')),Number(el.getAttribute('cy'))).matrixTransform(el.getScreenCTM());return{kind:window.mapMode==='road'?'edge':'vertex',id:Number(el.dataset.id),x:p.x,y:p.y};});
    const legal=window.mapState.legal[window.mapMode];
    return {candidates:candidates.map(candidate=>({...candidate,hit:b.pick?.({clientX:candidate.x,clientY:candidate.y},touch,false)||null})),legal,rect:rect.toJSON(),markerDepth:b.markers?.children.map(m=>m.material.depthTest)};
  },touch);
}
async function gesture(page,point,{pinch=false}={}){
  const cdp=await page.context().newCDPSession(page),start=[{x:point.x,y:point.y}];
  if(pinch)start.push({x:point.x+35,y:point.y+15});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:start});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:start.map((p,i)=>({...p,x:p.x+(i?45:-20),y:p.y+(i?15:-10)}))});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();await page.waitForTimeout(60);
}
try{
  for(const count of [3,6])for(const [name,viewport,touch] of [['desktop',{width:1366,height:768},false],['portrait',{width:390,height:844},true],['short-landscape',{width:667,height:320},true]]){
    const context=await browser.newContext({viewport,isMobile:touch,hasTouch:touch}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/map-polish-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#b8d8d2}#fixture{width:100%;height:100%}canvas,svg{display:block;width:100%;height:100%;touch-action:none}[data-id]:focus{outline:none}</style><div id="fixture"></div>'}));await page.goto(`${polishURL}/map-polish-fixture`);
    for(const mode of ['settlement','road','city']){
      const state=scene(count,mode);assert.ok(state.legal[mode].length,`fixture missing ${mode} sites`);
      for(const kind of ['3d','2d']){
        for(const [zoom,factor] of [['far',1],['near',1.6]]){
          await load(page,state,mode,kind);
          if(factor!==1){await page.evaluate(({factor,mode})=>{const b=window.mapBoard,kind=mode==='road'?'edge':'vertex',id=window.mapState.legal[mode][0];b.focusFeedback({id:1,targets:[{kind,id}]},{manual:true,reducedMotion:true});b.zoomBy(factor);},{factor,mode});await page.waitForTimeout(80);}
          const report=await candidateReport(page,touch);assert.deepEqual(report.candidates.map(c=>c.id).sort((a,b)=>a-b),[...report.legal].sort((a,b)=>a-b),'candidate ID is not the actual shared edge/vertex ID');
          if(kind==='3d'){
            assert.ok(report.markerDepth.every(Boolean),'candidates bypass depth and draw through scenery');
            const visible=report.candidates.filter(c=>c.hit&&c.hit.kind===c.kind&&c.hit.id===c.id&&c.x>25&&c.x<viewport.width-25&&c.y>25&&c.y<viewport.height-25);
            assert.ok(visible.length,`no selectable ${mode} ${count} ${name} ${zoom}`);
            let nearest=null;for(let i=0;i<visible.length;i++)for(let j=i+1;j<visible.length;j++){const distance=Math.hypot(visible[i].x-visible[j].x,visible[i].y-visible[j].y);if(!nearest||distance<nearest.distance)nearest={a:visible[i],b:visible[j],distance};}
            if(touch&&nearest?.distance<44){const pick=await page.evaluate(({a,b})=>window.mapBoard.pick({clientX:(a.x+b.x)/2,clientY:(a.y+b.y)/2},true,false),nearest);assert.equal(pick,null,'ambiguous neighboring touch silently selected a site');}
            const target=visible[0];await page.mouse.move(target.x,target.y);await page.waitForTimeout(40);assert.equal(await page.locator('canvas').getAttribute('data-selected-site'),`${target.kind}:${target.id}`);
            await page.mouse.click(target.x,target.y);assert.deepEqual(await page.evaluate(()=>window.selections.at(-1)),{kind:target.kind,id:target.id},'mouse click did not select the visible legal site');
            if(touch){await page.touchscreen.tap(target.x,target.y);assert.deepEqual(await page.evaluate(()=>window.selections.at(-1)),{kind:target.kind,id:target.id},'touch selected a neighboring site');}
            const before=await page.evaluate(()=>window.selections.length),gestureView=await page.evaluate(()=>window.mapBoard.exportView());await page.mouse.move(target.x,target.y);await page.mouse.down();await page.mouse.move(target.x+40,target.y+20,{steps:5});await page.mouse.up();assert.equal(await page.evaluate(()=>window.selections.length),before,'drag placed a piece');
            await page.evaluate(view=>window.mapBoard.importView(view),gestureView);await page.waitForTimeout(40);await page.mouse.move(target.x,target.y);await page.mouse.down();await page.mouse.move(target.x+35,target.y+18,{steps:4});await page.mouse.move(target.x,target.y,{steps:4});await page.mouse.up();assert.equal(await page.evaluate(()=>window.selections.length),before,'dragging away and back to the original site placed a piece');
          }else{
            const target=report.candidates.find(c=>c.x>25&&c.x<viewport.width-25&&c.y>25&&c.y<viewport.height-25);assert.ok(target);
            await page.locator(`[data-id="${target.id}"]`).focus();await page.keyboard.press('Enter');assert.deepEqual(await page.evaluate(()=>window.selections.at(-1)),{kind:target.kind,id:target.id},'keyboard picked a neighboring site');
            const before=await page.evaluate(()=>window.selections.length);await page.mouse.click(target.x,target.y);assert.equal(await page.evaluate(()=>window.selections.length),before+1,'SVG mouse click did not select the visible legal site');
            if(touch){const before=await page.evaluate(()=>window.selections.length);await page.touchscreen.tap(target.x,target.y);assert.equal(await page.evaluate(()=>window.selections.length),before+1,'SVG touch did not select the visible legal site');assert.deepEqual(await page.evaluate(()=>window.selections.at(-1)),{kind:target.kind,id:target.id});}
          }
          await shot(page,`${count}-${name}-${kind}-${mode}-${zoom}`);
          if(touch){const target=report.candidates.find(c=>c.x>35&&c.x<viewport.width-70&&c.y>35&&c.y<viewport.height-50);if(target){const before=await page.evaluate(()=>window.selections.length);await gesture(page,target);await gesture(page,target,{pinch:true});assert.equal(await page.evaluate(()=>window.selections.length),before,'touch drag or pinch placed a piece');}}
        }
      }
    }
    // The same focus target repeated must settle at a bounded distance; it must
    // never multiply zoom with every sequential action.
    await load(page,scene(count,'city'),'');
    const follow=await page.evaluate(()=>{const b=window.mapBoard,id=window.mapState.board.vertices.find(v=>v.owner)?.id,event={id:1,targets:[{kind:'vertex',id}]},distances=[];for(let i=0;i<12;i++){b.focusFeedback({...event,id:i+1},{manual:true,reducedMotion:true});distances.push(b.camera.position.distanceTo(b.controls.target));}return distances;});
    assert.ok(follow.every(Number.isFinite));assert.ok(Math.abs(follow.at(-1)-follow[1])<.001,`sequential actions keep zooming: ${follow}`);
    await page.evaluate(()=>{window.mapBoard.setAmbient(true,{reducedMotion:false});});await page.waitForTimeout(100);assert.equal(await page.locator('canvas').getAttribute('data-ambient'),'running');
    const hiddenRenders=await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));return window.mapBoard.metrics.renders;});await page.waitForTimeout(180);assert.equal(await page.evaluate(()=>window.mapBoard.metrics.renders),hiddenRenders,'hidden page kept rendering the ambient scene');assert.equal(await page.locator('canvas').getAttribute('data-ambient'),'stopped');await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
    await page.mouse.move(viewport.width/2,viewport.height/2);await page.mouse.down();await page.mouse.up();await page.waitForTimeout(30);assert.equal(await page.locator('canvas').getAttribute('data-ambient'),'stopped','manual map use did not stop homepage animation');
    await page.evaluate(()=>window.mapBoard.setAmbient(true,{reducedMotion:true}));assert.equal(await page.locator('canvas').getAttribute('data-ambient'),'stopped','reduced motion enabled ambient animation');
    await load(page,scene(count,'city'),'','2d');
    const flatFollow=await page.evaluate(()=>{const b=window.mapBoard,id=window.mapState.board.vertices.find(v=>v.owner)?.id,zooms=[];for(let i=0;i<12;i++){b.focusFeedback({id:i+1,targets:[{kind:'vertex',id}]},{manual:true,reducedMotion:true});zooms.push(b.zoom);}return zooms;});
    assert.ok(Math.abs(flatFollow.at(-1)-flatFollow[1])<.001,`sequential SVG actions keep zooming: ${flatFollow}`);
    await context.close();
  }
  assert.deepEqual(errors,[]);await writeFile('test-results/map-polish/results.json',JSON.stringify({scope:'Local Chromium WebGL/SVG viewport and CDP touch simulations; no physical mobile device validation',results,errors},null,2));console.log(`Map polish passed: ${results.length} screenshots, 3/6-player near/far 2D/3D, shared IDs, depth, gestures, keyboard, bounded follow and ambient handoff.`);
}finally{await browser.close();}
