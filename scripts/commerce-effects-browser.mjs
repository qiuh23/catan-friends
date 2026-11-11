import {chromium} from 'playwright';
import {PerspectiveCamera,Vector3} from 'three';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {openFixture} from './map-first-fixture.js';
import {portGeometry} from '../src/ports.js';
import {updateAwards} from '../shared/game.js';
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'}),errors=[],results=[],edition=process.env.TEST_EDITION||'global';
async function waitEvent(p,event){await p.waitForFunction(id=>{const e=document.querySelector('#action-feedback');return !e.hidden&&e.dataset.eventIds?.split(',').includes(String(id));},event.id);}
async function shot(p,label){await p.screenshot({path:`docs/qa/commerce/after-${edition}-${label}.png`});}
try{
  for(const flat of [false,true]){
    const c=await openFixture(browser,{count:4,errors}),p=c.page,mode=flat?'2d':'3d';
    if(flat){await p.locator('[data-action="openSettings"]:visible').click();await p.locator('[data-action="toggleFlat"]').click();await p.keyboard.press('Escape');}
    let g=structuredClone(c.game);g.board.vertices.forEach(v=>{v.owner=null;v.level=0;});g.board.tiles.forEach(t=>t.number=t.resource==='desert'?0:2);
    const tile=g.board.tiles.find(t=>t.resource!=='desert');tile.number=8;
    Object.assign(g.board.vertices[tile.vertices[0]],{owner:'p0',level:1});Object.assign(g.board.vertices[tile.vertices[2]],{owner:'p1',level:1});
    g.phase='roll';g.bank[tile.resource]=5;c.set(g);
    let event=c.action('p0',{type:'roll'},()=>.51);assert.equal(event.kind,'production');await waitEvent(p,event);await shot(p,`production-${mode}`);
    c.publish();c.publish();await p.waitForTimeout(1500);assert.equal(await p.locator('#action-feedback').isVisible(),false,'duplicate replay extended animation');
    g=structuredClone(c.game);g.phase='robber';g.resumePhase='action';c.set(g);
    c.action('p0',{type:'moveRobber',tile:tile.id});event=c.action('p0',{type:'steal',victim:'p1'});await waitEvent(p,event);await shot(p,`robber-${mode}`);
    assert.ok(!/wood|ore|brick|sheep|wheat/.test(await p.locator('#action-feedback').textContent()),'theft exposed resource');
    await p.waitForTimeout(1400);
    g=structuredClone(c.game);g.phase='roll';c.set(g);event=c.action('p0',{type:'roll'},()=>.51);assert.equal(event.kind,'blocked');await waitEvent(p,event);await shot(p,`blocked-${mode}`);
    if(flat)assert.ok(await p.locator('.robber-outline').count()>0);
    await p.waitForTimeout(1400);
    g=structuredClone(c.game);g.players[0].knights=3;updateAwards(g);event=g.presentation.events.at(-1);c.set(g);await waitEvent(p,event);assert.match(await p.locator('#action-feedback').textContent(),/最大军队/);await shot(p,`award-${mode}`);
    await p.waitForTimeout(1400);
    g=structuredClone(c.game);const port=g.board.ports[0];for(const [i,id] of port.vertices.entries())Object.assign(g.board.vertices[id],{owner:`p${i}`,level:i+1});c.set(g);
    if(flat){await p.locator(`[data-port="${port.id}"]`).focus();await p.keyboard.press('Enter');}
    else {
      await p.locator('[data-action="overview"]:visible').first().click();await p.waitForTimeout(500);
      const {label}=portGeometry(g.board,port),point=await p.locator('#board canvas').evaluate(canvas=>({bounds:canvas.getBoundingClientRect().toJSON(),eye:JSON.parse(canvas.dataset.camera),target:JSON.parse(canvas.dataset.cameraTarget),view:JSON.parse(canvas.dataset.cameraView)})),camera=new PerspectiveCamera(34,point.bounds.width/point.bounds.height,.1,150);
      camera.position.fromArray(point.eye);camera.lookAt(...point.target);camera.view=point.view;camera.updateProjectionMatrix();camera.updateMatrixWorld();const v=new Vector3(label.x,.4,label.z).project(camera);
      await p.mouse.click(point.bounds.left+(v.x+1)*point.bounds.width/2,point.bounds.top+(1-v.y)*point.bounds.height/2);
    }
    await p.locator('.port-detail').waitFor();assert.equal(await p.locator('.port-endpoints > span').count(),2);await shot(p,`shared-port-${mode}`);
    await p.keyboard.press('Escape');
    results.push({edition,mode,production:true,blocked:true,robberPrivacy:true,award:true,sharedPort:true,dedup:true});await c.context.close();
  }
  assert.deepEqual(errors,[]);await writeFile(`docs/qa/commerce/effects-${edition}.json`,JSON.stringify({results,errors},null,2));console.log(`${edition}: 2D/3D effects and shared ports passed`);
}finally{await browser.close();}
