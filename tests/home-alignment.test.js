import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import postcss from 'postcss';

test('home action order, inline join, exact copy and pregame header for both editions', async () => {
  const vite=await createServer({configFile:false,server:{middlewareMode:true},optimizeDeps:{noDiscovery:true,include:[]},esbuild:{jsx:'automatic'}});
  try {
    const {HomeActions,HomePanel,PregameHeader}=await vite.ssrLoadModule('/src/ui/entry.tsx');
    for(const domestic of [true,false]) {
      const model={domestic,backendId:domestic?'aliyun':'cloudflare',code:'',publicCode:domestic?'A-ABC123':'C-ABC123',status:'connected',statusText:'已连接',busy:false,entryError:'',name:'好友',nickname:{id:'n1',name:'随机昵称'},invite:'',joinExpanded:false,returnableRooms:[],roomList:{status:'ready',rooms:[]}};
      const render=Component=>renderToStaticMarkup(React.createElement(Component,{model}));
      let html=render(HomeActions);
      assert.deepEqual([...html.matchAll(/<button[^>]*data-action="(openEntry|toggleJoin|homePractice)"[^>]*>.*?<span>(.*?)<\/span><\/button>/g)].map(m=>[m[1],m[2]]),[['openEntry','创建房间'],['toggleJoin','加入房间'],['homePractice','单人练习']]);
      assert.equal((html.match(/class="primary"/g)||[]).length,1);
      assert.match(html,/<form id="join-form" hidden="">/);
      assert.ok(html.indexOf('data-action="homePractice"')<html.indexOf('class="public-rooms"'));
      assert.match(html,/暂无公开房间/);assert.match(html,/>加入<\/button>/);
      model.joinExpanded=true;html=render(HomeActions);assert.match(html,/aria-expanded="true"/);assert.doesNotMatch(html,/<form id="join-form" hidden/);
      assert.equal(html.includes('id="join-nickname"'),!domestic);
      const config=render(HomePanel);assert.match(config,/开一桌/);assert.match(config,/create-visibility/);assert.match(config,/create-friendlyRobber/);assert.doesNotMatch(config,/join-code/);
      const header=render(PregameHeader);assert.deepEqual([...header.matchAll(/data-action="([^"]+)"/g)].map(m=>m[1]),['copyRoomCode','invite','home']);
      for(const copy of ['复制房间码','邀请朋友','退出房间',model.publicCode])assert.ok(header.includes(copy));
    }
  } finally {await vite.close();}
});

test('entry layout overrides add no color, typography, artwork or motion declarations',()=>{
  const css=readFileSync(new URL('../src/ui/theme.css',import.meta.url),'utf8');
  const start=css.indexOf('/* Entry alignment changes placement only;');
  const end=css.indexOf('@media (orientation: landscape)',start);
  postcss.parse(css.slice(start,end)).walkDecls(decl=>assert.doesNotMatch(decl.prop,/color|background|font|shadow|animation|transition/));
  const root=readFileSync(new URL('../src/ui/root.tsx',import.meta.url),'utf8');
  assert.match(root,/s\?\.phase === "lobby" \? <PregameHeader/);
});
