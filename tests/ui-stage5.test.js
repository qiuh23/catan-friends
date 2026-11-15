import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import postcss from 'postcss';
import {createServer} from 'vite';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {fixture} from '../scripts/map-first-fixture.js';
import {viewFor} from '../shared/game.js';
import {BoardAssets} from '../src/terrain.js';
import {createRobberHighlight} from '../src/visuals/robber.js';
const read = file => readFileSync(new URL('../'+file, import.meta.url), 'utf8');
const css = file => postcss.parse(read('src/'+file));
const rule = (file, selector) => {
  const values = {};
  css(file).walkRules(r => { if(r.selector === selector) r.walkDecls(d => {values[d.prop] = d.value;}); });
  return values;
};

test('home dock uses the paper surface, accent/white contrast and panel tokens', () => {
  const dock = rule('home-family.css','#home-dock');
  assert.equal(dock.background,'color-mix(in srgb, var(--paper) 95%, transparent)');
  assert.equal(dock['box-shadow'],'var(--shadow-2)');
  assert.equal(dock['border-radius'],'var(--radius-panel)');
  const primary = rule('home-family.css','#home-dock .primary');
  assert.equal(primary.background,'var(--accent)'); assert.equal(primary.color,'white');
  const linear = n => (n /= 255) <= .04045 ? n/12.92 : ((n+.055)/1.055)**2.4;
  const luminance = hex => [.2126,.7152,.0722].reduce((sum,k,i) => sum+k*linear(parseInt(hex.slice(i*2,i*2+2),16)),0);
  assert.ok(1.05/(luminance('b65c35')+.05)>4.5,'small white text meets 4.5:1 on accent');
});

test('turn identity, unavailable cards and semantic trade states use existing tokens', () => {
  assert.equal(rule('table.css','.at-table .turn-banner')['border-left'],'3px solid var(--muted)');
  assert.equal(rule('table.css','.at-table .turn-banner.your-turn')['border-left-color'],'var(--player)');
  css('table.css').walkRules(r => { if(r.selector.includes('.turn-banner')) r.walkDecls('box-shadow',d => assert.equal(d.value,'var(--shadow-2)')); });
  for(const file of ['style.css','table.css','ui/theme.css']) css(file).walkRules(r => {
    if(/\.resource-card\s*>\s*strong$/.test(r.selector)) r.walkDecls('font-size',d => assert.equal(d.value,'18px'));
    if(/^\.resource-card(?:\.\w+)?$/.test(r.selector)) r.walkDecls('background',d => assert.equal(d.value,'var(--paper)'));
  });
  assert.equal(rule('ui/theme.css','.at-table .resource-card > strong')['font-weight'],'700');
  assert.equal(rule('ui/theme.css','.at-table .resource-card.unavailable').filter,'saturate(.4)');
  assert.equal(rule('ui/theme.css','.at-table .resource-card.unavailable > strong').color,'var(--muted)');
  assert.equal(rule('commerce.css','.exchange-tabs button[aria-pressed=true]')['box-shadow'],'inset 0 -2px var(--accent)');
  for(const [state,color] of [['ready','wood'],['unavailable','brick']]) {
    const value = rule('commerce.css',`.trade-${state} > :is(.exchange-preview, .exchange-reason)`);
    assert.equal(value.color,`var(--${color})`);
    assert.equal(value.background,`color-mix(in srgb, var(--${color}) 10%, transparent)`);
  }
});

test('five trade columns fit independent 44px targets; footer remains in the scroll flow', () => {
  const button = rule('commerce.css','.exchange-card .exchange-stepper button');
  for(const dimension of ['width','min-width','height','min-height']) assert.equal(button[dimension],'var(--touch-size)');
  assert.equal(button['border-radius'],'50%'); assert.match(button.background,/32px 32px/);
  assert.equal(rule('commerce.css','.exchange-stepper').display,'grid');
  assert.equal(rule('commerce.css','.exchange-footer').position,'static','no sticky footer can cover a stepper');
  assert.equal(rule('table.css','#stage-dialog-content')['overflow-y'],'auto');
  assert.equal(rule('table.css','#stage-dialog-content')['min-height'],'0');
  // Arithmetic checks the known CSS tracks, not browser text layout or pixels.
  const portraitTrack = ((390-24-2-24)-4*3)/5-2;
  const landscapeTrack = (((600-2-28)-10)/2-4*6)/5-2;
  assert.ok(portraitTrack>=44); assert.ok(landscapeTrack>=44);
  // At 844x390 the two give/want blocks share a row. Every long block and the
  // footer stay in the same min-height:0, overflow-y:auto dialog scroll region.
  assert.match(read('src/ui/theme.css'),/\.exchange-body:not\(\.current-offer\):not\(\.exchange-empty\)\s*\{[^}]*grid-template-columns: 1fr 1fr/);
  assert.ok(2*44+16*1.6+44 < 390-12,'one landscape picker fits before scrollable headings/footer');
});

test('3D selection and robber ground feedback mirror CSS while retaining depth/picking', () => {
  const board = read('src/board3d.js');
  for(const name of ['marker','outline','selected','feedback']) assert.match(board,new RegExp(`\\['${name}',0xc99b3f,`));
  assert.match(board,/\['robber-feedback',0x493e57,1\]/);
  assert.match(board,/new THREE.Color\('#b8d8d2'\)/);
  assert.match(board,/depthTest:true,depthWrite:false,toneMapped:false/);
  const assets=new BoardAssets(), ring=createRobberHighlight(assets,{x:0,y:.33,z:0,rotationY:0},{x:0,z:0});
  assert.equal(ring.material.color.getHexString(),'493e57'); assert.equal(ring.material.depthTest,true);
  assert.equal(ring.material.depthWrite,false); assert.equal(ring.material.toneMapped,false);
  const hits=[];ring.raycast(null,hits);assert.deepEqual(hits,[]);assets.dispose();
  const colors = new Set(readdirSync(new URL('../src',import.meta.url)).filter(f=>f.endsWith('.css')).concat('ui/theme.css').flatMap(file=>read('src/'+file).match(/#[\da-f]{3,8}\b/gi)||[]));
  assert.ok(colors.size<=90,`${colors.size} CSS hex colors`);
});

test('React presentation follows live shortages, turn ownership and every trade restriction without mutating state', async () => {
  const server=await createServer({configFile:false,server:{middlewareMode:true},optimizeDeps:{noDiscovery:true,include:[]},esbuild:{jsx:'automatic'},define:{__SITE_EDITION__:'"global"'}});
  try {
    const {Hand,Banner}=await server.ssrLoadModule('/src/ui/table.tsx');
    const {TradePanel}=await server.ssrLoadModule('/src/ui/commerce.tsx');
    const game=fixture(4);game.board.vertices.forEach(v=>{v.owner=null;v.level=0;});
    const state=viewFor(game,'p0');state.room={paused:false};
    const model={state,status:'connected',statusText:'已连接',busy:false,myTurn:true,task:null,selectedBuild:'',inspectedBuild:'',draft:new Map(),tradeView:'bank',tradePage:'compose'};
    const render=Component=>renderToStaticMarkup(React.createElement(Component,{model}));
    const me=state.players.find(p=>p.id===state.me);me.hand.wood=0;me.hand.ore=2;me.hand.wheat=2;
    assert.match(render(Hand),/resource-card wood unavailable/);
    assert.doesNotMatch(render(Hand),/resource-card ore unavailable/);
    model.inspectedBuild='city';assert.match(render(Hand),/resource-card ore unavailable/);
    me.hand.ore=3;assert.doesNotMatch(render(Hand),/resource-card ore unavailable/);
    const before=structuredClone(state);render(Hand);assert.deepEqual(state,before);
    assert.match(render(Banner),/your-turn/);assert.ok(render(Banner).includes(`--player:${state.players[state.turn].color}`));
    model.myTurn=false;assert.doesNotMatch(render(Banner),/your-turn/);model.myTurn=true;
    const available = (yes,action) => {
      const html=render(TradePanel);assert.ok(html.includes(`trade-${yes?'ready':'unavailable'}`));
      const button=html.match(new RegExp(`<button[^>]*data-action="${action}"[^>]*>`))[0];
      assert.equal(button.includes('disabled'),!yes);
    };
    me.hand.wood=4;state.bank.ore=1;available(true,'exchangeBank');
    state.bank.ore=0;available(false,'exchangeBank');state.bank.ore=1;
    me.hand.wood=3;available(false,'exchangeBank');me.hand.wood=4;
    model.draft.set('bank-want','wood');available(false,'exchangeBank');model.draft.delete('bank-want');
    for(const key of ['paused','offline','busy']) {
      if(key==='paused')state.room.paused=true;else if(key==='offline')model.status='reconnecting';else model.busy=true;
      available(false,'exchangeBank');state.room.paused=false;model.status='connected';model.busy=false;
    }
    model.tradeView='players';available(false,'publishTrade');
    model.draft.set('give-wood','1');model.draft.set('want-ore','1');available(true,'publishTrade');
    state.turn=1;available(false,'publishTrade');state.turn=0;
    state.pairStep='secondary';available(false,'publishTrade');state.pairStep='primary';
    state.offer={id:'offer-1',from:'p1',give:{ore:1},want:{wood:2}};state.turn=1;model.tradePage='offers';available(true,'acceptTrade');
    me.hand.wood=1;available(false,'acceptTrade');me.hand.wood=4;
    state.offer.from='p0';assert.match(render(TradePanel),/trade-pending/);assert.doesNotMatch(render(TradePanel),/trade-ready/);
    state.offer=null;assert.match(render(TradePanel),/暂无公开报价/);
  } finally { await server.close(); }
});
