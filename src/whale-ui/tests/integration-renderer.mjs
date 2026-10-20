import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const base = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://whale.test/', pretendToBeVisual: true });
for (const name of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'MutationObserver']) Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true, writable: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = callback => setImmediate(() => callback(performance.now()));
globalThis.cancelAnimationFrame = clearImmediate;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const cssModules = { name: 'integration-css-modules', setup(builder) {
  builder.onResolve({ filter: /\.css$/ }, args => ({ path: path.resolve(args.resolveDir, args.path), namespace: 'integration-css' }));
  builder.onLoad({ filter: /.*/, namespace: 'integration-css' }, () => ({ loader: 'js', contents: 'export default new Proxy({}, {get:(_,name)=>String(name)});' }));
} };
const bundle = await build({
  stdin: { contents: `export { createStore } from './language/index.ts'; export { Renderer } from './react/index.ts'; export { createWhaleLibrary } from './library.ts'; export * from './runtime/state.ts'; export { genuiComponents, compileDocument } from './runtime/genui-adapter.tsx';`, sourcefile: 'integration-renderer-entry.ts', resolveDir: base, loader: 'ts' },
  bundle: true, write: false, format: 'cjs', platform: 'node', target: 'node22', packages: 'external', jsx: 'automatic', tsconfigRaw: {},
  alias: { '@whale-ui/react': path.join(base, 'react/index.ts'), '@whale-ui/language': path.join(base, 'language/index.ts') }, plugins: [cssModules], logLevel: 'silent',
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, loaded, loaded.exports);
const ui = loaded.exports;
const library = ui.createWhaleLibrary(ui.genuiComponents);
const h = React.createElement;
after(() => dom.window.close());

async function mount(source, options = {}) {
  const element = document.createElement('div'); document.body.append(element);
  const root = createRoot(element);
  const store = options.store ?? ui.createPersistentStore(ui.createStore);
  const states = [], errors = [], actions = [], parse = [];
  let closed = false;
  const unsubscribe = store.subscribePersisted(state => { states.push(structuredClone(state)); if (states.length > 40) throw new Error('Integration state callback failed to settle'); });
  const props = { library, response: source, store, initialState: options.initialState ?? {}, isStreaming: false, onError: value => errors.push(value), onAction: async event => { actions.push(event); return options.onAction?.(event) ?? { ok: true }; }, onParseResult: result => parse.push(result) };
  await act(async () => root.render(h(ui.Renderer, props)));
  return { element, store, states, errors, actions, parse,
    async update(response, extra = {}) { Object.assign(props, extra, { response }); await act(async () => root.render(h(ui.Renderer, props))); },
    unmountNow() { if (!closed) { root.unmount(); closed = true; } },
    async close() { if (!closed) { await act(async () => root.unmount()); closed = true; } unsubscribe(); element.remove(); },
  };
}
function button(element, text) { return [...element.querySelectorAll('button')].find(node => node.textContent.trim() === text); }
async function click(element) { assert.ok(element, 'target button exists'); await act(async () => element.click()); }
async function type(input, value) {
  assert.ok(input, 'target input exists');
  const prototype = input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
}
function genuiField(state, id) { return Object.values(state.__whale_component_state__ ?? {}).find(value => value?.fields?.[id] !== undefined)?.fields[id]; }

const genuiSpec = { title: 'GenUI section', items: [{ type: 'input', id: 'note', label: 'GenUI Note', value: 'genui draft' }, { type: 'button', label: 'GenUI Send', action: 'submit-genui' }] };
function mixedSource(n = 1, title = 'Combined') {
  return `root = Col([Title(${JSON.stringify(title)}),form, legacy,Text($n + ""), Button("Reset n", @Reset($n))])\nform = Form([Input($n,"Whale number","number"),Input("whale draft","Whale Note"),Button("Whale Send", @ToAssistant("Submit Whale"))])\nlegacy = Genui(${JSON.stringify(genuiSpec)})\n$n = ${n}`;
}

test('actual registry Renderer preserves later edit and pristine Reset through source updates with original hydration', async () => {
  const saved = { $n: 7 };
  const app = await mount(mixedSource(), { initialState: saved });
  try {
    const number = () => app.element.querySelector('input[type="number"]');
    assert.equal(number().value, '7');
    await type(number(), '8');
    assert.equal(app.store.get('$n'), 8);
    await app.update(mixedSource(2, 'Source updated'));
    assert.equal(number().value, '8');
    await click(button(app.element, 'Reset n'));
    assert.equal(number().value, '2');
    assert.ok(!Object.hasOwn(app.store.getPersistedSnapshot(), '$n'));
    await app.update(mixedSource(3, 'Next default'));
    assert.equal(number().value, '3');
    assert.ok(!Object.hasOwn(app.store.getPersistedSnapshot(), '$n'));
    assert.deepEqual(app.errors.at(-1) ?? [], []);
  } finally { await app.close(); }
});

test('GenUI and Whale inputs share one durable store and action executor without callback churn', async () => {
  const app = await mount(mixedSource());
  let saved;
  try {
    assert.equal(app.element.querySelectorAll('[data-genui]').length, 1);
    await type(app.element.querySelector('input[type="number"]'), '9');
    const genuiInput = app.element.querySelector('[data-genui] input');
    await type(genuiInput, 'edited GenUI note');
    const whaleInput = [...app.element.querySelectorAll('input')].find(node => !node.closest('[data-genui]') && node.type !== 'number');
    await type(whaleInput, 'edited Whale note');
    await click(button(app.element, 'Whale Send'));
    assert.equal(app.actions.length, 1);
    assert.equal(app.actions[0].formState.$n, 9);
    assert.ok(JSON.stringify(app.actions[0].formState).includes('edited Whale note'));
    assert.ok(!Object.hasOwn(app.actions[0].formState, '__whale_component_state__'));
    await click(button(app.element, 'GenUI Send'));
    assert.equal(app.actions.length, 2);
    assert.equal(app.actions[1].type, 'continue_conversation');
    assert.equal(app.actions[1].params.context.action, 'submit-genui');
    assert.equal(app.actions[1].formState.$n, 9);
    saved = app.store.getPersistedSnapshot();
    assert.equal(genuiField(saved, 'note'), 'edited GenUI note');
    const callbacks = app.states.length;
    await act(async () => { await new Promise(resolve => setImmediate(resolve)); });
    assert.equal(app.states.length, callbacks, 'state settles without a render feedback loop');
    assert.ok(callbacks < 15);
    await app.update(mixedSource(2, 'Retained updated source'));
    assert.equal(app.element.querySelector('[data-genui] input'), genuiInput, 'source update preserves GenUI input identity');
    assert.equal(genuiInput.value, 'edited GenUI note');
    assert.equal(genuiField(app.store.getPersistedSnapshot(), 'note'), 'edited GenUI note');
    assert.deepEqual(app.errors.at(-1) ?? [], []);
  } finally { await app.close(); }
  const restored = await mount(mixedSource(2), { initialState: saved });
  try {
    assert.equal(restored.element.querySelector('input[type="number"]').value, '9');
    assert.equal(restored.element.querySelector('[data-genui] input').value, 'edited GenUI note');
    assert.ok([...restored.element.querySelectorAll('input')].some(node => node.value === 'edited Whale note'));
    assert.deepEqual(restored.errors.at(-1) ?? [], []);
  } finally { await restored.close(); }
});

test('two live Renderer documents isolate bindings and GenUI state without a global active store', async () => {
  const first = await mount(mixedSource());
  const second = await mount(mixedSource());
  try {
    await type(first.element.querySelector('input[type="number"]'), '14');
    await type(first.element.querySelector('[data-genui] input'), 'first only');
    assert.equal(first.store.get('$n'), 14);
    assert.equal(second.store.get('$n'), 1);
    assert.equal(second.element.querySelector('[data-genui] input').value, 'genui draft');
    await click(button(first.element, 'GenUI Send'));
    assert.equal(first.actions.length, 1);
    assert.equal(second.actions.length, 0);
    assert.equal(genuiField(first.store.getPersistedSnapshot(), 'note'), 'first only');
    assert.notEqual(genuiField(second.store.getPersistedSnapshot(), 'note'), 'first only');
  } finally { await first.close(); await second.close(); }
});

test('GenUI final edit reaches the shared persisted store before immediate unmount', async () => {
  const app = await mount(mixedSource());
  const input = app.element.querySelector('[data-genui] input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  try {
    await act(async () => {
      setter.call(input, 'last edit before close');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      assert.equal(genuiField(app.store.getPersistedSnapshot(), 'note'), 'last edit before close');
      app.unmountNow();
    });
  } finally { await app.close(); }
});

test('GenUI actions surface failed host acknowledgement and remain retryable', async () => {
  let calls = 0;
  const app = await mount(mixedSource(), { onAction: async () => { calls++; return calls === 1 ? { ok: false, error: 'integration host rejected' } : { ok: true }; } });
  try {
    await click(button(app.element, 'GenUI Send'));
    assert.equal(calls, 1);
    assert.match(app.element.querySelector('[data-genui] [role="alert"]').textContent, /integration host rejected/);
    await click(button(app.element, 'GenUI Send'));
    assert.equal(calls, 2);
    assert.equal(app.element.querySelector('[data-genui] [role="alert"]'), null);
  } finally { await app.close(); }
});

test('historical dsh-ui JSON compiles into same actual registry and persists GenUI field state', async () => {
  const compiled = ui.compileDocument(JSON.stringify(genuiSpec), 'dsh-ui', false);
  assert.equal(compiled.complete, true);
  assert.deepEqual(compiled.diagnostics, []);
  const app = await mount(compiled.program);
  try {
    await type(app.element.querySelector('[data-genui] input'), 'historical edit');
    assert.equal(genuiField(app.store.getPersistedSnapshot(), 'note'), 'historical edit');
    assert.deepEqual(app.errors.at(-1) ?? [], []);
  } finally { await app.close(); }
});
