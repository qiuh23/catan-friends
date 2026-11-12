import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {openFixture} from './map-first-fixture.js';

// Run against `npm run dev`, TEST_URL=http://127.0.0.1:5175. This instrumented
// response is test-only: no debug globals are shipped in the production app.
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const out='test-results/v9',errors=[],results=[];await mkdir(out,{recursive:true});
async function instrument({failure=false}={}) {
  return {async newContext(options){
    const context=await browser.newContext(options);
    await context.route('**/src/board3d.js*',async route=>{const response=await route.fetch(),source=await response.text();assert.ok(source.includes('export class Board {'));await route.fulfill({response,body:source.replace('export class Board {','class ActualBoard {')+'\nexport class Board extends ActualBoard { constructor(...args){ super(...args); window.__visualBoard=this; } }'});});
    if(failure)await context.route('**/assets/v9/**/*.glb',route=>route.abort('failed'));
    const original=context.newPage.bind(context);context.newPage=async()=>{const page=await original();page.on('console',message=>{if(message.type()==='error'&&!failure)errors.push(message.text());});return page;};
    return context;
  }};
}
try {
  for(const count of [4,6])for(const viewport of [{width:1366,height:768},{width:390,height:844},{width:844,height:390}]){
    const client=await openFixture(await instrument(),{count,viewport,touch:viewport.width!==1366,reducedMotion:'reduce',errors});
    const {page}=client;
    await page.waitForFunction(()=>{const b=window.__visualBoard;return b&&JSON.parse(b.renderer.domElement.dataset.models||'{}').tiles===b.board.tiles.length;});
    const key=`${count}-${viewport.width}x${viewport.height}`;
    for(const phase of ['day','dusk','night'])for(const weather of ['clear','overcast']){
      await page.evaluate(({phase,weather})=>window.__visualBoard.setEnvironment({phase,weather}),{phase,weather});
      await page.waitForTimeout(150);await page.screenshot({path:`${out}/${key}-${phase}-${weather}.png`});
    }
    const result=await page.evaluate(()=>{
      const b=window.__visualBoard,stats=()=>({...b.renderer.info.memory,programs:b.renderer.info.programs.length});
      b.setEnvironment({phase:'day'});b.renderer.render(b.scene,b.camera);const before=stats();
      for(let i=0;i<8;i++){b.refreshModels=true;b.set(b.latestState,b.mode);b.renderer.render(b.scene,b.camera);}
      const after=stats();
      b.setQuality({lowPower:true});const low={shadows:b.renderer.shadowMap.enabled,sky:b.environment.sky.getState().lowQuality};
      b.setQuality({lowPower:false});
      b.camera.position.set(8,Math.cos(1.12)*10,Math.sin(1.12)*10);b.camera.lookAt(b.controls.target);b.invalidate();
      return {before,after,low,stats:JSON.parse(b.renderer.domElement.dataset.renderStats),models:JSON.parse(b.renderer.domElement.dataset.models)};
    });
    assert.deepEqual(result.after,result.before,`resources grew after rebuild: ${key}`);assert.equal(result.low.shadows,false);assert.equal(result.low.sky,true);
    await page.screenshot({path:`${out}/${key}-low-angle.png`});results.push({key,...result});await client.context.close();
  }
  const fallback=await openFixture(await instrument({failure:true}),{count:6,reducedMotion:'reduce',errors});
  await fallback.page.waitForFunction(()=>Boolean(window.__visualBoard?.renderer.domElement.dataset.modelLoad));
  const fallbackStats=await fallback.page.evaluate(()=>({models:JSON.parse(window.__visualBoard.renderer.domElement.dataset.models),load:JSON.parse(window.__visualBoard.renderer.domElement.dataset.modelLoad),children:window.__visualBoard.land.children.length}));
  assert.equal(fallbackStats.models.tiles,0);assert.ok(fallbackStats.load.failed.length>0);assert.ok(fallbackStats.children>0);
  await fallback.page.screenshot({path:`${out}/fallback.png`});await fallback.context.close();
  assert.deepEqual(errors,[]);await writeFile(`${out}/results.json`,JSON.stringify({results,fallbackStats,errors},null,2));console.log(JSON.stringify({results,fallbackStats,errors},null,2));
} finally {await browser.close();}
