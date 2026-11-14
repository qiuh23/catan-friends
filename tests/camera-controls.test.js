import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
mkdirSync('.local/component-tests',{recursive:true});
const path=new URL('../.local/component-tests/camera.cjs',import.meta.url);
writeFileSync(path,buildSync({entryPoints:['src/ui/table.tsx'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,jsx:'automatic'}).outputFiles[0].contents);
const {CameraControls,StageTools}=createRequire(import.meta.url)(path.pathname);
test('camera states always use a camera pictogram and short visible labels',()=>{
 for(const [autoFollow,followPaused,label,pressed] of [[true,false,'跟随',true],[true,true,'手动',false],[false,false,'关闭',false],[false,true,'关闭',false]]){
  const html=renderToStaticMarkup(createElement(CameraControls,{model:{autoFollow,followPaused}}));
  assert.match(html,/class="icon camera-state-icon"/);assert.ok(html.includes(`<span>${label}</span>`));assert.ok(html.includes(`aria-pressed="${pressed}"`));assert.match(html,/仅控制镜头，不会暂停对局/);assert.doesNotMatch(html,/暂停自动跟随/);
 }
 const css=readFileSync(new URL('../src/ui/theme.css',import.meta.url),'utf8');assert.match(css,/#camera-follow > span \{\s*display:inline/);assert.match(css,/\.at-table \.playing #camera-toolbar \{\s*display:flex/);
});
test('match pause and resume remain independent of camera follow',()=>{
 for(const paused of [false,true])for(const autoFollow of [false,true]){
  const html=renderToStaticMarkup(createElement(StageTools,{model:{isHost:true,state:{board:{},phase:'action',room:{paused}},autoFollow,followPaused:false,status:'connected',unreadChat:0}}));
  assert.ok(html.includes(`data-action="${paused?'resumeGame':'pauseGame'}"`));assert.ok(html.includes(`aria-label="${paused?'恢复对局':'暂停对局'}"`));assert.ok(html.includes(`data-follow-state="${autoFollow?'following':'off'}"`));
 }
});
