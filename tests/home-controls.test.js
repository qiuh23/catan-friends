import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

const read = file => readFileSync(new URL('../'+file, import.meta.url), 'utf8');
const main = read('src/main.js');

// Render the real control subtree without starting a browser, a DOM, or a room.
// Keep the implementation's shared Button and Icon rather than test doubles.
test('home has only 2D/3D while connection, room, and practice retain their controls', async () => {
  const server = await createServer({configFile:false,server:{middlewareMode:true,ws:false},optimizeDeps:{noDiscovery:true,include:[]},esbuild:{jsx:'automatic'},define:{__SITE_EDITION__:'"global"'}});
  try {
    const {Button, Icon} = await server.ssrLoadModule('/src/ui/primitives.tsx');
    const {StageTools} = await server.ssrLoadModule('/src/ui/table.tsx');
    const subtree = read('src/ui/root.tsx').match(/<div className="board-controls">[\s\S]*?<\/div>/)?.[0];
    assert.ok(subtree, 'test the rendered production control subtree');
    const compiled = ts.transpileModule(`module.exports = function Controls({model:m}) { const s = m.state; return (${subtree}); };`, {compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS}}).outputText;
    const context = {module:{exports:{}},React,Button,Icon};
    vm.runInNewContext(compiled,context);
    const render = model => renderToStaticMarkup(React.createElement(context.module.exports,{model}));
    const buttons = html => html.match(/<button\b[^>]*>/g) || [];
    const base = {state:null,code:'',flat:false,homeMotion:{hidden:false,disabled:false,label:'暂停展示首页岛屿',playing:true,glyph:'pause'}};
    for (const flat of [false,true]) for (const reducedMotion of [false,true]) {
      const html = render({...base,flat,homeMotion:{...base.homeMotion,disabled:flat||reducedMotion}});
      assert.equal(buttons(html).length,1);
      assert.match(html,/id="flat-toggle"/);
      assert.match(html,new RegExp(`aria-label="切换${flat?'三':'二'}维棋盘"`));
      assert.doesNotMatch(html,/home-motion|data-action="reset"|data-action="homeMotion"/);
      assert.match(html,new RegExp(`>${flat?'3D':'2D'}<`));
    }
    const states = [
      {name:'connecting',state:null,code:'ABC234',status:'connecting'},
      {name:'reconnecting',state:{phase:'action'},code:'ABC234',status:'reconnecting'},
      {name:'waiting',state:{phase:'lobby'},code:'ABC234',status:'connected'},
      {name:'active',state:{phase:'action'},code:'ABC234',status:'connected'},
      {name:'practice',state:{phase:'action',room:{practice:true}},code:'ABC234',status:'connected'},
    ];
    for (const state of states) {
      const html = render({...base,...state,homeMotion:{...base.homeMotion,hidden:true}});
      assert.equal(buttons(html).length,3,state.name);
      assert.match(buttons(html)[0],/id="home-motion"[^>]*hidden=""/);
      assert.match(buttons(html)[1],/data-action="reset"/);
      assert.match(buttons(html)[2],/id="flat-toggle"/);
    }
    for (const domestic of [false,true]) for (const status of ['connected','reconnecting']) for (const paused of [false,true]) {
      const model = {...base,domestic,status,isHost:true,autoFollow:true,followPaused:false,busy:false,unreadChat:0,state:{phase:'action',board:{},room:{paused}}};
      const html = renderToStaticMarkup(React.createElement(StageTools,{model}));
      assert.deepEqual(buttons(html).map(button=>button.match(/data-action="([^"]+)"/)[1]),[
        'overview','toggleFollow',paused?'resumeGame':'pauseGame',...(!domestic?['openChat']:[]),'openLog','openSettings',
      ]);
      assert.equal(buttons(html)[2].includes('disabled'),status!=='connected');
    }
    assert.equal(buttons(render(base)).length,1,'returning home restores the single-toggle control');
  } finally { await server.close(); }
});

test('default home motion starts without the removed buttons and retains existing pause guards', () => {
  assert.match(main,/let showcaseInterrupted=false,pageAway=false/);
  const updateAmbient = main.match(/function updateAmbient\(\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(updateAmbient);
  const calls=[];
  const context={state:null,code:'',pageAway:false,showcaseInterrupted:false,document:{hidden:false,querySelector:()=>null},board:{setAmbient:(...args)=>calls.push(args)},reducedMotion:()=>false,renderUI:()=>{},uiModel:()=>({})};
  vm.createContext(context);vm.runInContext(updateAmbient,context);
  const update = () => {vm.runInContext('updateAmbient()',context);return calls.at(-1);};
  assert.equal(update()[0],true,'fresh home still starts automatic rotation');
  assert.equal(update()[1].sceneEnabled,true,'scene animation still starts by default');
  for (const flag of ['pageAway','showcaseInterrupted']) {context[flag]=true;assert.equal(update()[0],false);context[flag]=false;}
  context.document.hidden=true;assert.equal(update()[0],false);context.document.hidden=false;
  context.document.querySelector=()=>({open:true});assert.equal(update()[0],false);context.document.querySelector=()=>null;
  context.reducedMotion=()=>true;assert.equal(update()[1].reducedMotion,true);context.reducedMotion=()=>false;
  context.code='ABC234';assert.equal(update()[0],false);context.code='';
  context.state={phase:'action'};assert.equal(update()[0],false);context.state=null;
  assert.equal(update()[0],true,'home motion resumes with the original state guards cleared');
});
