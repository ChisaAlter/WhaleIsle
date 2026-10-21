import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const base = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://viewer.test/', pretendToBeVisual: true });
for (const key of ['window','document','HTMLElement','HTMLInputElement','Element','Node','Event','MouseEvent','MessageEvent','MutationObserver','DOMException']) Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = callback => setImmediate(() => callback(performance.now()));
globalThis.cancelAnimationFrame = clearImmediate;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.fetch = globalThis.fetch;
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');

// Exercise the actual Viewer body; only the automatic root creation is replaced so tests own teardown.
const viewerPath = path.join(base, 'viewer/index.tsx');
const css = { name: 'integration-viewer-css', setup(builder) {
  builder.onResolve({ filter: /\.css$/ }, args => ({ path: path.resolve(args.resolveDir, args.path), namespace: 'viewer-css' }));
  builder.onLoad({ filter: /.*/, namespace: 'viewer-css' }, () => ({ loader: 'js', contents: 'export default new Proxy({}, {get:(_,name)=>String(name)});' }));
  builder.onLoad({ filter: /[\\/]viewer[\\/]index\.tsx$/ }, async args => {
    const source = await readFile(args.path, 'utf8');
    const bootstrap = "createRoot(document.getElementById('root')!).render(<Viewer />);";
    assert.ok(source.includes(bootstrap), 'Viewer bootstrap is recognizable');
    return { contents: source.replace(bootstrap, 'export { Viewer };'), loader: 'tsx', resolveDir: path.dirname(args.path) };
  });
} };
const bundled = await build({ entryPoints: [viewerPath], bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic', packages: 'external', tsconfigRaw: {},
  define: { __WHALE_MAP_WORKER_SOURCE__: '""' }, alias: { '@whale-ui/react': path.join(base, 'react/index.ts'), '@whale-ui/language': path.join(base, 'language/index.ts') }, plugins: [css], logLevel: 'silent' });
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(require, loaded, loaded.exports);
const { Viewer } = loaded.exports;
let nextInstance = 0;
const baseTheme = { appearance: 'light', variables: {} };
const h = React.createElement;
after(() => dom.window.close());

async function mount() {
  const events = [], uncaught = [];
  const instanceId = `viewer-test-${++nextInstance}`;
  const parent = { postMessage: value => events.push(value) };
  Object.defineProperty(window, 'parent', { value: parent, configurable: true });
  window.name = `whale-ui:${instanceId}`;
  const element = document.createElement('div'); document.body.append(element);
  const root = createRoot(element, { onUncaughtError: error => uncaught.push(error) });
  await act(async () => root.render(h(Viewer)));
  const envelope = { channel: 'whale-ui', version: 2, instanceId };
  let current = { type: 'render', program: '', language: 'whale-ui', streaming: false, state: {}, theme: baseTheme, locale: 'en' };
  const dispatch = data => window.dispatchEvent(new window.MessageEvent('message', { source: parent, origin: 'https://host.test', data: { ...envelope, ...data } }));
  return { events, element, uncaught,
    diagnostics: () => events.filter(event => event.type === 'diagnostics'),
    async render(program, extra = {}) { current = { ...current, program, ...extra }; await act(async () => dispatch(current)); },
    async respond(request, result) { await act(async () => dispatch({ type: 'action-response', requestId: request.requestId, result })); },
    async resourceError(request, error) { await act(async () => dispatch({ type: 'bundle-response', requestId: request.requestId, name: request.name, error })); },
    async close() { await act(async () => root.unmount()); element.remove(); },
  };
}
async function click(element) { assert.ok(element); await act(async () => element.click()); }
const good = 'root = Col([Text("valid")])';

test('actual Viewer never labels a new broken source complete using the previous parse', async () => {
  const app = await mount();
  try {
    await app.render(good);
    assert.equal(app.diagnostics().at(-1).complete, true);
    const bad = 'root = Col([Text("unterminated';
    app.events.length = 0;
    await app.render(bad);
    const receipts = app.diagnostics();
    assert.ok(receipts.length > 0);
    assert.ok(receipts.every(event => event.program === bad && event.complete === false));
    assert.ok(receipts.at(-1).diagnostics.some(error => error.code === 'incomplete-input'));
    await app.render('root = Col([Text("repaired")])');
    assert.equal(app.diagnostics().at(-1).complete, true);
    assert.deepEqual(app.diagnostics().at(-1).diagnostics, []);
  } finally { await app.close(); }
});

test('actual Viewer reports changing content titles and clears the heading on source replacement', async () => {
  const app = await mount();
  const title = () => app.events.findLast(event => event.type === 'title')?.title;
  try {
    await app.render('root = Col([Title("First page"),Button("Rename",@Set($heading,"Other page")),Title($heading)])\n$heading = "Other heading"');
    await act(async () => { await new Promise(resolve => setImmediate(resolve)); });
    assert.equal(title(), 'First page');
    await app.render('root = Col([Title($heading),Button("Rename",@Set($heading,"Other page"))])\n$heading = "First page"');
    await act(async () => { await new Promise(resolve => setImmediate(resolve)); });
    assert.equal(title(), 'First page');
    await click(app.element.querySelector('button'));
    await act(async () => { await new Promise(resolve => setImmediate(resolve)); });
    assert.equal(title(), 'Other page');
    await app.render(good);
    await act(async () => { await new Promise(resolve => setImmediate(resolve)); });
    assert.equal(title(), '');
  } finally { await app.close(); }
});

test('transparent host surfaces keep neutral primary actions distinct from business accents across themes', async () => {
  const app = await mount();
  try {
    const program = 'root = Col([Input($count,"Count","number"),Button("Add",@Set($count,$count+1))])\n$count = 2';
    for (const [appearance, accent, foreground] of [['light','#101116','#ffffff'], ['dark','#f1f2f4','#101116']]) {
      await app.render(program, { theme: { appearance, variables: { '--dsw-alias-bg-base': 'transparent', '--dsw-alias-brand-primary': accent, '--dsw-alias-state-business-primary': '#4176e6', '--dsw-alias-label-primary-foreground': foreground } } });
      assert.equal(document.documentElement.style.getPropertyValue('--whale-on-accent'), foreground);
      assert.equal(document.documentElement.style.getPropertyValue('--whale-accent'), '#4176e6');
      assert.equal(document.documentElement.style.getPropertyValue('--whale-button'), accent);
      assert.equal(document.body.style.getPropertyValue('--whale-button'), accent);
      assert.equal(document.documentElement.style.getPropertyValue('--whale-bg'), 'transparent');
    }
    await click(app.element.querySelector('button'));
    assert.equal(app.element.querySelector('input').value, '3');
    await app.render(program, { theme: baseTheme });
    assert.equal(document.documentElement.style.getPropertyValue('--whale-on-accent'), '');
    assert.equal(app.element.querySelector('input').value, '3');
  } finally { await app.close(); }
});

test('actual Viewer reports unsupported business operations even when their results are unused', async () => {
  const app = await mount();
  try {
    for (const declaration of ['q = Query("some_tool")', 'm = Mutation("some_tool")']) {
      await app.render(`${good}\n${declaration}`);
      assert.equal(app.diagnostics().at(-1).complete, false);
      assert.ok(app.diagnostics().at(-1).diagnostics.some(error => error.code === 'unsupported-business-provider'));
      assert.match(app.element.querySelector('.whale-viewer-diagnostics').textContent, /no business-tool provider/);
    }
    assert.equal(app.events.filter(event => event.type === 'action').length, 0);
    await app.render(good);
    assert.equal(app.diagnostics().at(-1).complete, true);
    assert.deepEqual(app.diagnostics().at(-1).diagnostics, []);
  } finally { await app.close(); }
});

test('valid streaming source receives complete success on settlement without changing text', async () => {
  const app = await mount();
  try {
    await app.render(good, { streaming: true });
    assert.equal(app.diagnostics().at(-1).complete, false);
    await app.render(good, { streaming: false });
    assert.equal(app.diagnostics().at(-1).complete, true);
  } finally { await app.close(); }
});

test('equivalent raw historical JSON retains current compiled diagnostics and component identity', async () => {
  const app = await mount();
  try {
    const spec = { items: [{ type: 'input', id: 'note', label: 'Note', value: 'draft' }] };
    await app.render(JSON.stringify(spec), { language: 'dsh-ui' });
    assert.equal(app.diagnostics().at(-1).complete, true);
    const input = app.element.querySelector('input');
    assert.ok(input);
    const pretty = JSON.stringify(spec, null, 2);
    await app.render(pretty);
    assert.equal(app.element.querySelector('input'), input);
    assert.equal(app.diagnostics().at(-1).program, pretty);
    assert.equal(app.diagnostics().at(-1).complete, true);
  } finally { await app.close(); }
});

test('invalid saved state stays visible as a state diagnostic and is never replaced by an empty snapshot', async () => {
  const app = await mount();
  try {
    await app.render(good, { state: { format: 'whale-ui-state', version: 999, values: {} } });
    assert.deepEqual(app.uncaught, []);
    assert.equal(app.diagnostics().at(-1).complete, false);
    assert.ok(app.diagnostics().at(-1).diagnostics.some(error => error.phase === 'state' && error.code === 'invalid-state'));
    assert.match(app.element.textContent, /Unsupported Whale UI interaction state/);
    assert.equal(app.events.filter(event => event.type === 'state').length, 0);
  } finally { await app.close(); }
});

test('an old link failure arriving after source replacement cannot poison the new source', async () => {
  const app = await mount();
  try {
    await app.render('root = Col([Link("Old link","https://example.com")])');
    await click(app.element.querySelector('a'));
    const request = app.events.findLast(event => event.type === 'action');
    await app.render(good);
    assert.equal(app.diagnostics().at(-1).complete, true);
    await app.respond(request, { ok: false, error: 'old host link rejected' });
    assert.equal(app.diagnostics().at(-1).complete, true);
    assert.deepEqual(app.diagnostics().at(-1).diagnostics, []);
  } finally { await app.close(); }
});

test('rejected EChart bundle marks Viewer incomplete and a valid source recovers without losing input state', async () => {
  const app = await mount();
  try {
    const source = 'root = Col([Input($n,"Amount","number"),chart])\nchart = EChart({chart:"bar",data:[{label:"A",value:1}]})\n$n = 1';
    await app.render(source);
    const input = app.element.querySelector('input[type="number"]');
    assert.ok(input);
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, '7');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const request = app.events.findLast(event => event.type === 'bundle' && event.name === 'echarts-core.js');
    assert.ok(request, 'actual EChart requests the host engine bundle');
    await app.resourceError(request, 'integration chart engine is unavailable');
    assert.equal(app.diagnostics().at(-1).complete, false);
    assert.ok(app.diagnostics().at(-1).diagnostics.some(error => error.phase === 'render'));
    assert.ok(app.element.querySelector('.whale-viewer-diagnostics'), 'async failure is visible in Viewer diagnostics');
    assert.equal(app.element.querySelector('input[type="number"]'), input, 'render diagnostics provider preserves mounted inputs');
    assert.equal(input.value, '7');
    assert.equal(app.events.findLast(event => event.type === 'state').state.values.$n, 7);
    await app.render('root = Col([Input($n,"Amount","number"),Text("recovered")])\n$n = 2');
    assert.equal(app.diagnostics().at(-1).complete, true);
    assert.deepEqual(app.diagnostics().at(-1).diagnostics, []);
    assert.equal(app.element.querySelector('input[type="number"]'), input);
    assert.equal(input.value, '7');
  } finally { await app.close(); }
});

test('link failure follows source identity and pending actions ignore theme and locale changes', async () => {
  const app = await mount();
  try {
    const source = 'root = Col([Link("Open","https://example.com")])';
    await app.render(source);
    await click(app.element.querySelector('a'));
    const request = app.events.findLast(event => event.type === 'action');
    await app.respond(request, { ok: false, error: 'host link rejected' });
    assert.ok(app.diagnostics().at(-1).diagnostics.some(error => error.message.includes('host link rejected')));
    await app.render(good);
    assert.equal(app.diagnostics().at(-1).complete, true);
    assert.deepEqual(app.diagnostics().at(-1).diagnostics, []);
    const plan = 'root = Col([Button("Copy",Action([@CopyToClipboard("a"),@ToAssistant("still current")]))])';
    await app.render(plan);
    await click(app.element.querySelector('button'));
    const copy = app.events.findLast(event => event.type === 'action');
    assert.equal(copy.action, 'clipboard');
    await app.render(plan, { theme: { appearance: 'dark', variables: {} }, locale: 'zh' });
    await app.respond(copy, { ok: true });
    const assistant = app.events.findLast(event => event.type === 'action');
    assert.equal(assistant.action, 'assistant');
    assert.equal(assistant.message, 'still current');
    await app.respond(assistant, { ok: true });
  } finally { await app.close(); }
});
