import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createResourceHandlers } from '../resources/handlers.mjs';
const require = createRequire(import.meta.url);
const { renderUiTool: tool } = require('../../renderer/whale-ui/host.cjs');

test('built validator retains complete programs and emits durable presentation metadata', async () => {
  const program = 'root = Col([Text("ready"), Input($n, "Number", "number"), Text(@Format($n * 2))])\n$n = 2';
  const value = await tool.execute({ program });
  assert.deepEqual(value, { version: 1, language: 'whale-ui', program });
  assert.deepEqual(tool.output.presentationMeta({}, value), { whaleUi: value });
  assert.match(tool.output.render({}, value)[0].text, /ready/);
  assert.equal((await tool.execute({ spec: { items: [{ type: 'text', content: 'ready' }] } })).language, 'dsh-ui');
  assert.equal((await tool.execute({ program: 'root = Col([Plot({series:[{expr:"sin(x)"}],xMin:-6,xMax:6})])' })).version, 1);
});

test('built validator rejects incomplete final source, missing references, budgets and dropped specialized nodes', async () => {
  for (const program of ['root = Col([missing])', 'root = Col([Text("ready")', 'root = Col([Text(@Range(0, 1000000))])', 'root = Col([Mermaid({})])', 'root = Col([Input($n)])\n$n = @Sum([1,2])']) {
    await assert.rejects(tool.execute({ program }), /incomplete|invalid|budget|literal/i, program);
  }
  await assert.rejects(tool.execute({ spec: { items: [{ type: 'text', content: 'valid' }, { type: 'imaginary', text: 'bad' }] } }), /invalid/i);
  await assert.rejects(tool.execute({ program: 'root = Col([])', spec: {} }), /exactly one/);
  const oversized = { tabs: Array.from({ length: 13 }, (_, index) => ({ label: `Tab ${index}`, items: [{ type: 'text', content: `Item ${index}` }] })) };
  for (const program of [`root = Col([Tabs(${JSON.stringify(oversized)})])`, `root = Col([Genui(${JSON.stringify({ items: [{ type: 'tabs', ...oversized }] })})])`]) {
    await assert.rejects(tool.execute({ program }), /truncated by policy/i);
  }
});

test('resource handlers query only fixed origins, preserve response contracts and reuse successful reads', async () => {
  const calls = [];
  const handler = createResourceHandlers(async (url, options) => {
    calls.push(url); assert.ok(options.signal);
    const parsed = new URL(url);
    assert.ok(['en.wikipedia.org', 'commons.wikimedia.org', 'router.project-osrm.org'].includes(parsed.hostname));
    if (parsed.hostname === 'router.project-osrm.org') return Response.json({ code: 'Ok', routes: [{ geometry: { coordinates: [[121, 31], [122, 32]] } }] });
    if (parsed.pathname.includes('/summary/')) return Response.json({ coordinates: { lat: 31, lon: 121 }, thumbnail: { source: 'https://upload.wikimedia.org/place.jpg' } });
    if (parsed.pathname.includes('/media-list/')) return Response.json({ items: [] });
    return Response.json({ query: { pages: [{ title: 'Shanghai', thumbnail: { source: 'https://upload.wikimedia.org/place.jpg' }, imageinfo: [{ thumburl: 'https://upload.wikimedia.org/place2.jpg', mime: 'image/jpeg' }] }] } });
  });
  assert.deepEqual(await (await handler('wiki', { title: 'Shanghai' })).json(), { lat: 31, lng: 121, photos: ['https://upload.wikimedia.org/place.jpg'] });
  const first = calls.length; await handler('wiki', { title: 'Shanghai' }); assert.equal(calls.length, first);
  assert.deepEqual(await (await handler('street-route', { coords: '121,31;122,32' })).json(), { points: [[31, 121], [32, 122]] });
  assert.equal((await (await handler('image-search', { q: 'Shanghai' })).json()).images.length, 2);
  for (const coords of ['', '1,NaN;2,3', '181,0;1,2', '0,91;1,2', '1,2,3;4,5']) assert.equal((await handler('street-route', { coords })).status, 400);
  assert.equal((await handler('wiki', { title: '' })).status, 400);
  assert.equal((await handler('other', {})).status, 400);
});
