import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import postcss from 'postcss';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const order = ['tokens.css', 'chat-preview.css', 'style.css', 'table.css', 'entry.css',
  'map-first.css', 'immersive-polish.css', 'home-family.css', 'home-showcase.css',
  'visual-first.css', 'commerce.css', 'notices.css', 'graphics-quality.css', 'ui/theme.css'];
const sheets = order.map(file => ({file, root: postcss.parse(read('src/' + file))}));
const normalize = text => text.replace(/\s+/g, '');

// Resolve the source-order declarations for an exact selector. This exercises
// component media branches, not browser pixel layout or computed specificity.
function matches(query, width, height) {
  return query.split(',').some(branch => [...branch.matchAll(/\(([^)]+)\)/g)].every(([, condition]) => {
    const [feature, value] = condition.split(':').map(s => s.trim());
    if (feature === 'orientation') return value === (width > height ? 'landscape' : 'portrait');
    if (feature === 'max-width') return width <= parseFloat(value);
    if (feature === 'min-width') return width >= parseFloat(value);
    if (feature === 'max-height') return height <= parseFloat(value);
    if (/^width > /.test(feature)) return width > parseFloat(feature.slice(8));
    if (feature === 'prefers-reduced-motion') return false;
    throw new Error('Unhandled media condition: ' + condition);
  }));
}
function declarations(selector, viewport) {
  const result = {};
  for (const {root} of sheets) root.walkRules(rule => {
    if (normalize(rule.selector) !== normalize(selector)) return;
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type === 'atrule' && parent.name === 'media' && !matches(parent.params, ...viewport)) return;
    }
    rule.walkDecls(d => { result[d.prop] = d.value; });
  });
  return result;
}

test('every UI font declaration uses the nine px steps and standard weights', () => {
  const steps = new Set([11,12,13,14,16,18,20,24,32].map(n => n+'px'));
  for (const {file, root} of sheets) {
    root.walkDecls('font-size', d => assert.ok(steps.has(d.value), `${file}: ${d.parent.selector} ${d.value}`));
    root.walkDecls('font-weight', d => assert.ok(['400','500','600','700','800'].includes(d.value), `${file}: ${d.value}`));
    root.walkDecls('font', d => assert.equal(d.value, 'inherit', 'shorthand cannot hide another font scale'));
  }
  assert.equal(declarations('.chat-report', [390,844])['font-size'], '12px');
  assert.equal(declarations('.chat-preview span', [390,844])['font-size'], '12px');
  assert.equal(declarations('.circle-bot', [390,844])['font-size'], '11px');
});

test('icons share one sizing/stroke owner and the design records retain 180ms motion', () => {
  const values = declarations(':root', [1440,900]);
  for (const [name, value] of Object.entries({inline:'16px',button:'20px',toolbar:'24px',empty:'40px',stroke:'1.65'}))
    assert.equal(values['--icon-'+name], value);
  const icon = declarations('.icon', [1440,900]);
  assert.equal(icon.width, 'var(--icon-size)');
  assert.equal(icon.height, 'var(--icon-size)');
  assert.equal(icon['stroke-width'], 'var(--icon-stroke)');
  for (const {file, root} of sheets) root.walkRules(rule => {
    if (!/(?:^|\s|[>,])\.icon(?:[:\s,]|$)/.test(rule.selector)) return;
    rule.walkDecls(d => { if (['width','height','stroke-width'].includes(d.prop)) {
      assert.equal(file, 'ui/theme.css'); assert.equal(rule.selector, '.icon');
    }});
  });
  assert.match(read('src/icons.js'), /stroke-width="1\.65"/);
  const design = JSON.parse(read('.impeccable/design.json'));
  for (const [name, value] of Object.entries(design.extensions.tokens)) assert.equal(values[name], value, name);
  assert.equal(values['--duration-2'], '180ms');
  assert.equal(design.extensions.motion[1].value, '180ms cubic-bezier(.2,.7,.3,1)');
  assert.match(read('DESIGN.md'), /120ms \/ 180ms \/ 240ms/);
});

test('width breakpoints are only 640/950/1190 and short landscape has exactly two owners', () => {
  const owners = [];
  for (const {file, root} of sheets) root.walkAtRules('media', media => {
    for (const match of media.params.matchAll(/(?:width:\s*|width\s*>\s*)(\d+)px/g))
      assert.ok([640,950,1190].includes(Number(match[1])), `${file}: ${media.params}`);
    if (media.params.includes('height')) {
      assert.equal(media.params, '(orientation: landscape) and (max-height: 600px)');
      owners.push(file);
    }
  });
  assert.deepEqual(owners, ['table.css', 'ui/theme.css']);
  for (const width of [639,640,641,949,950,951,1189,1190,1191,1440]) {
    assert.equal(matches('(max-width: 640px)', width, 900), width <= 640);
    assert.equal(matches('(max-width: 950px)', width, 900), width <= 950);
    assert.equal(matches('(width > 1190px)', width, 900), width > 1190);
  }
});

test('entry, dock, hand, trade and feedback keep their desktop/portrait/landscape media branches', () => {
  const desktop = [1440,900], phone = [390,844], landscape = [844,390];
  assert.equal(declarations('.at-home #home-welcome h1', desktop)['font-size'], '32px');
  assert.equal(declarations('.at-home #home-welcome h1', landscape)['font-size'], '24px');
  assert.equal(declarations('.home #home-dock', landscape)['flex-direction'], 'column');
  assert.equal(declarations('#entry-content #entry-form', landscape)['grid-template-columns'], '1fr 1fr');
  assert.equal(declarations('#entry-content #entry-form', phone)['grid-template-columns'], undefined);
  assert.equal(declarations('.at-table #play-dock', phone)['max-width'], 'calc(100% - 16px)');
  assert.match(declarations('.at-table .hand-tray', phone).bottom, /75px/);
  assert.match(declarations('.at-table .hand-tray', landscape).bottom, /15px/);
  assert.equal(declarations('.exchange', phone).display, 'flex');
  assert.equal(declarations('.exchange', landscape).display, 'grid');
  assert.equal(declarations('.exchange', [844,601]).display, 'flex');
  assert.equal(declarations('.exchange', [600,390]).display, 'flex');
  assert.equal(declarations('.exchange .resource-pick', landscape)['min-height'], '44px');
  assert.match(declarations('#action-feedback', phone).width, /230px/);
  assert.equal(declarations('#action-feedback', landscape).width, '214px');
  assert.equal(declarations('#action-feedback p', landscape)['-webkit-line-clamp'], '2');
  assert.equal(declarations('.at-table .turn-banner', landscape)['min-width'], '170px');
  assert.equal(declarations('.at-table .turn-banner', [640,390])['min-width'], '140px');
  assert.equal(declarations('.at-table .playing #camera-toolbar', landscape).display, 'flex');
});
