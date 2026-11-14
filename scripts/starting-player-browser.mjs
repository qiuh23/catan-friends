// Read-only production scope: this script creates only temporary local rooms
// and a loopback WebSocket fixture. No remote game, deployment or account writes.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {createServer} from '../server/index.js';
import {createGame,addPlayer,act,botAction} from '../shared/game.js';

const edition=process.argv[2]||'global',dataDir=await mkdtemp(path.join(os.tmpdir(),'catan-start-browser-'));
const app=await createServer({port:0,dataDir,siteEdition:edition});
process.env.TEST_URL=`http://127.0.0.1:${app.port}`;process.env.TEST_EDITION=edition;
const {openFixture}=await import('./map-first-fixture.js');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const out=`test-results/starting-player/${edition}`,errors=[],results=[];await mkdir(out,{recursive:true});
function tiedGame() {
  let g=createGame();for(let i=0;i<4;i++)addPlayer(g,`p${i}`,i===3?'海风和很长很长的名字':`玩家${i}`,true);
  // p1 and p3 tie, then p3 wins. All display text comes from authority results.
  const dice=[1,1,5,5,3,4,6,4,2,3,5,6].map(n=>(n-.5)/6);let seed=81;
  const random=()=>dice.length?dice.shift():((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  return act(g,'p0',{type:'start'},random);
}
try {
  for(const [name,viewport] of [['desktop',{width:1366,height:768}],['portrait',{width:390,height:844}],['landscape',{width:667,height:320}]]) {
    const c=await openFixture(browser,{count:4,setup:true,viewport,touch:name!=='desktop',errors,reducedMotion:'reduce'}),page=c.page;
    c.set(tiedGame());const note=page.locator('.starting-player-note');await note.waitFor();
    assert.match(await note.innerText(),/先手：海风和很长很长的名字 · 5\+6=11（加掷 1 轮）/);
    assert.equal(await page.locator('dialog[open]').count(),0);
    const measure=await note.evaluate(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scroll:node.scrollWidth,client:node.clientWidth};});
    assert.ok(measure.x>=0&&measure.y>=0&&measure.x+measure.width<=viewport.width+1&&measure.y+measure.height<=viewport.height+1);assert.ok(measure.scroll<=measure.client+1);
    await page.screenshot({path:`${out}/${name}-setup.png`});
    await page.locator('#stage-tools [data-action="openLog"]').click();await page.locator('#stage-dialog[open]').waitFor();
    assert.match(await page.locator('#stage-dialog').innerText(),/先手掷骰：.*玩家1 5\+5=10/);assert.match(await page.locator('#stage-dialog').innerText(),/同分加掷：玩家1 2\+3=5；海风和很长很长的名字 5\+6=11/);
    await page.keyboard.press('Escape');await page.locator('#stage-dialog').waitFor({state:'hidden'});
    await page.reload();await note.waitFor();assert.match(await note.innerText(),/5\+6=11/);assert.equal(await page.locator('dialog[open]').count(),0);
    let g=c.game;while(g.phase.startsWith('setup-'))g=act(g,g.players[g.turn].id,botAction(g,g.players[g.turn].id));c.set(g);
    await note.waitFor({state:'detached'});assert.equal(g.turn,3);assert.equal(g.phase,'roll');assert.equal(g.dice,null);
    assert.deepEqual(errors,[]);results.push({name,viewport,measure,firstPlayer:3,tieRound:1,history:true,reload:true,noModal:true,firstProduction:true});await c.context.close();
  }
  await writeFile(`${out}/results.json`,JSON.stringify({edition,results,errors,scope:'Local Chromium and simulated touch, not physical devices.'},null,2));
  console.log(`${edition}: starting dice, tie history, nonmodal HUD, reload and first production passed at desktop/portrait/landscape sizes.`);
} finally {await browser.close();await app.close();await rm(dataDir,{recursive:true,force:true});}
