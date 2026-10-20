import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootPath = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of ['window','document','HTMLElement','HTMLInputElement','HTMLButtonElement','Element','Node','MutationObserver','Event','MouseEvent','localStorage']) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const { z } = require('zod/v4');
async function loadSource(entry) {
  const bundled = await build({ entryPoints: [path.join(rootPath, entry)], bundle: true, write: false, format: 'cjs', platform: 'node', target: 'node22', jsx: 'automatic', packages: 'external', tsconfigRaw: {}, logLevel: 'silent' });
  const Module = require('node:module');
  const mod = new Module(path.join(rootPath, 'tests/react-runtime.generated.cjs'));
  mod.filename = path.join(rootPath, 'tests/react-runtime.generated.cjs');
  mod.paths = Module._nodeModulePaths(rootPath);
  mod._compile(bundled.outputFiles[0].text, mod.filename);
  return mod.exports;
}
const ui = await loadSource('react/index.ts');
const { createStore } = await loadSource('language/index.ts');
const h = React.createElement;
const Col = ui.defineComponent({ name: 'Col', description: 'Column', props: z.object({ children: z.array(z.any()) }), component: ({ props, renderNode }) => h('div', null, renderNode(props.children)) });
const Probe = ui.defineComponent({ name: 'Probe', description: 'Probe', props: z.object({ value: z.any() }), component: ({ props }) => h('output', null, JSON.stringify(props.value)) });
const Input = ui.defineComponent({ name: 'Input', description: 'Input', props: z.object({ value: ui.reactive(z.any()), label: z.string() }), component: ({ props }) => {
  const field = ui.useStateField(props.label, props.value);
  return h('input', { 'aria-label': props.label, value: field.value ?? '', onChange: event => field.setValue(event.target.value) });
} });
const OptionalInput = ui.defineComponent({ name: 'OptionalInput', description: 'Optional reactive Input', props: z.object({ value: ui.reactive(z.string()).optional(), label: z.string() }), component: ({ props }) => {
  const field = ui.useStateField(props.label, props.value);
  return h('input', { 'aria-label': props.label, value: field.value ?? '', onChange: event => field.setValue(event.target.value) });
} });
const Form = ui.defineComponent({ name: 'Form', description: 'Form', props: z.object({ children: z.array(z.any()) }), component: ({ props, renderNode, statementId }) => {
  const id = ui.useComponentIdentity();
  return h(ui.FormNameContext.Provider, { value: statementId ?? id }, renderNode(props.children));
} });
const Durable = ui.defineComponent({ name: 'Durable', description: 'Durable component', props: z.object({ label: z.string() }), component: ({ props }) => {
  const [count, setCount] = ui.useComponentState('count', 0);
  return h('button', { 'data-durable': props.label, onClick: () => setCount(value => value + 1) }, `${props.label}:${count}`);
} });
const Button = ui.defineComponent({ name: 'Button', description: 'Button', props: z.object({ label: z.string(), action: ui.action().optional() }), component: ({ props }) => {
  const trigger = ui.useTriggerAction();
  const form = ui.useFormName();
  const [error, setError] = React.useState('');
  return h('button', { 'data-action': props.label, onClick: () => { trigger(props.label, form, props.action).catch(error => setError(error.message)); } }, error || props.label);
} });
const Copy = ui.defineAction({ name: 'Copy', params: z.object({ text: z.string() }) });
const library = ui.createLibrary({ root: 'Col', components: [Col, Probe, Input, OptionalInput, Form, Button, Durable], actions: [Copy] });
async function mount(program, options = {}) {
  const element = document.createElement('div'); document.body.append(element);
  const root = createRoot(element);
  const events = [], states = [], errors = [];
  const props = { library, isStreaming: false, onAction: event => { events.push(event); }, onStateUpdate: state => states.push(state), onError: value => errors.push(value), ...options };
  await act(async () => { root.render(h(ui.Renderer, { ...props, response: program })); });
  return { element, events, states, errors,
    async update(response) { await act(async () => { root.render(h(ui.Renderer, { ...props, response })); }); },
    async close() { await act(async () => root.unmount()); element.remove(); },
  };
}
async function click(element) { await act(async () => { element.click(); }); }
async function type(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => { setter.call(input, value); input.dispatchEvent(new window.Event('input', { bubbles: true })); });
}
after(() => dom.window.close());

test('mounted data objects with value retain all fields', async () => {
  const mounted = await mount('root = Col([Probe($item),Probe($item.unit)])\n$item = {value:10,unit:"kg"}');
  assert.deepEqual([...mounted.element.querySelectorAll('output')].map(node => node.textContent), ['{"value":10,"unit":"kg"}', '"kg"']);
  assert.deepEqual(mounted.errors.flat(), []);
  await mounted.close();
});

test('mixed form submits binding and edited ordinary member, excludes other forms and hidden component state', async () => {
  const mounted = await mount('root = Col([first, second])\nfirst = Form([Input($qty,"Qty"), Input("draft","Note"),Durable("timer"),Button("Send",@ToAssistant("Use inputs"))])\nsecond = Form([Input($other,"Other")])\n$qty = 7\n$other = 99');
  await type(mounted.element.querySelector('input[aria-label="Note"]'), 'edited note');
  await click(mounted.element.querySelector('[data-durable]'));
  await click(mounted.element.querySelector('[data-action="Send"]'));
  assert.equal(mounted.events.length, 1);
  assert.deepEqual(mounted.events[0].formState, { $qty: 7, first: { Note: 'edited note' } });
  assert.ok(mounted.states.some(state => state.__whale_component_state__));
  assert.deepEqual(mounted.errors.flat(), []);
  await mounted.close();
});

test('ordered steps read latest state, await host acknowledgements, and stop on failure', async () => {
  const observed = [];
  let release;
  const ack = new Promise(resolve => { release = resolve; });
  const mounted = await mount('root = Col([Probe($n),Button("Go",Action([@Set($n,$n+1),@Copy($n+""),@Set($n,$n+1),@ToAssistant($n+"",{n:$n})]))])\n$n = 1', {
    onAction: async event => { observed.push(event); if (event.type === 'Copy') await ack; return { ok: true }; },
  });
  await click(mounted.element.querySelector('[data-action]'));
  assert.equal(mounted.element.querySelector('output').textContent, '2');
  assert.equal(observed.length, 1);
  assert.equal(observed[0].params.text, '2');
  await act(async () => release());
  assert.equal(mounted.element.querySelector('output').textContent, '3');
  assert.equal(observed[1].humanFriendlyMessage, '3');
  assert.deepEqual(observed[1].params.context, { n: 3 });
  await mounted.close();
  const failed = await mount('root = Col([Probe($n),Button("Go",Action([@Copy("x"),@Set($n,8),@ToAssistant("never")]))])\n$n = 1', { onAction: async () => ({ ok: false, error: 'copy denied' }) });
  await click(failed.element.querySelector('[data-action]'));
  assert.equal(failed.element.querySelector('output').textContent, '1');
  assert.equal(failed.element.querySelector('[data-action]').textContent, 'copy denied');
  await failed.close();
});

test('pending old actions stop after source replacement or unmount and survive ordinary value changes', async () => {
  const source = 'root = Col([Button("Old",Action([@Copy("a"),@Set($n,$n+1),@ToAssistant("after")]))])\n$n = 1';
  for (const change of ['source', 'unmount', 'store']) {
    const store = createStore();
    const events = [];
    let release;
    const acknowledgement = new Promise(resolve => { release = resolve; });
    const mounted = await mount(source, { store, onAction: async event => { events.push(event); if (event.type === 'Copy') await acknowledgement; return { ok: true }; } });
    await click(mounted.element.querySelector('[data-action]'));
    if (change === 'source') await mounted.update('root = Col([Probe($n)])\n$n = 2');
    else if (change === 'unmount') await mounted.close();
    else await act(async () => store.set('$n', 7));
    await act(async () => release());
    assert.equal(events.length, change === 'store' ? 2 : 1, change);
    assert.equal(store.get('$n'), change === 'store' ? 8 : change === 'source' ? 2 : 1, change);
    if (change !== 'unmount') await mounted.close();
  }
});

test('durable component state has sibling identity and restores from source state snapshot', async () => {
  const source = 'root = Col([a,b])\na = Durable("a")\nb = Durable("b")';
  const mounted = await mount(source);
  await click(mounted.element.querySelector('[data-durable="a"]'));
  assert.deepEqual([...mounted.element.querySelectorAll('[data-durable]')].map(node => node.textContent), ['a:1', 'b:0']);
  const saved = mounted.states.at(-1);
  await mounted.close();
  const restored = await mount(source, { initialState: saved });
  assert.deepEqual([...restored.element.querySelectorAll('[data-durable]')].map(node => node.textContent), ['a:1', 'b:0']);
  await restored.close();
});

test('inline branches and repeated loop items retain distinct component identity', async () => {
  const store = createStore();
  const source = 'root = Col([$tab ? Input("alpha","A") : Input("beta","B"), $tab ? Durable("a") : Durable("b")])\n$tab = true';
  const mounted = await mount(source, { store });
  await type(mounted.element.querySelector('input'), 'edited A');
  await click(mounted.element.querySelector('[data-durable]'));
  await act(async () => store.set('$tab', false));
  assert.equal(mounted.element.querySelector('input').value, 'beta');
  assert.equal(mounted.element.querySelector('[data-durable]').textContent, 'b:0');
  await act(async () => store.set('$tab', true));
  assert.equal(mounted.element.querySelector('input').value, 'edited A');
  assert.equal(mounted.element.querySelector('[data-durable]').textContent, 'a:1');
  await mounted.close();
  const repeated = await mount('root = Col(@Each([{id:"a"},{id:"b"}],"item",Durable(item.id)))');
  await click(repeated.element.querySelector('[data-durable="a"]'));
  assert.deepEqual([...repeated.element.querySelectorAll('[data-durable]')].map(node => node.textContent), ['a:1', 'b:0']);
  await repeated.close();
});

test('optional reactive schema preserves bound state target', async () => {
  const store = createStore();
  const mounted = await mount('root = Col([OptionalInput($selected,"Selection"),Probe($selected)])\n$selected = "First"', { store });
  await type(mounted.element.querySelector('input'), 'Second');
  assert.equal(store.get('$selected'), 'Second');
  assert.equal(mounted.element.querySelector('output').textContent, '"Second"');
  await act(async () => store.set('$selected', null));
  assert.deepEqual(mounted.errors.at(-1) ?? [], []);
  assert.equal(mounted.element.querySelector('input').value, '');
  await mounted.close();
});

test('explicitly migrated legacy field records restore and submit by declared name', async () => {
  const mounted = await mount('root = Col([contact])\ncontact = Form([Input("draft","Note"),Button("Send",@ToAssistant("Send"))])', { initialState: { contact: { Note: { __whaleField: 1, value: 'saved note', componentType: 'Input' } } } });
  assert.equal(mounted.element.querySelector('input').value, 'saved note');
  await click(mounted.element.querySelector('[data-action]'));
  assert.deepEqual(mounted.events[0].formState, { contact: { Note: 'saved note' } });
  await mounted.close();
});

test('clean diagnostics are delivered again when a different source replaces a clean program', async () => {
  const receipts = [];
  const app = await mount('root = Col([Probe("first")])', { onError: errors => receipts.push(errors) });
  try {
    assert.deepEqual(receipts, [[]]);
    await app.update('root = Col([Probe("second")])');
    assert.deepEqual(receipts, [[], []]);
  } finally { await app.close(); }
});

test('same source dynamic errors recover when its document store value is corrected', async () => {
  const Numeric = ui.defineComponent({ name: 'Numeric', description: 'numeric', props: z.object({ value: z.number() }), component: ({ props }) => h('output', null, String(props.value)) });
  const localLibrary = ui.createLibrary({ root: 'Col', components: [Col, Input, Numeric] });
  const store = createStore();
  const mounted = await mount('root = Col([Input($n,"n"),Numeric($n)])\n$n = 1', { library: localLibrary, store });
  await type(mounted.element.querySelector('input'), 'bad');
  assert.ok(mounted.errors.at(-1).some(error => error.code === 'type-mismatch'));
  await mounted.update('root = Col([Input($n,"n"),Numeric($n)])\n$n = 1\n');
  assert.ok(mounted.errors.at(-1).some(error => error.code === 'type-mismatch'));
  await act(async () => store.set('$n', 5));
  assert.deepEqual(mounted.errors.at(-1), []);
  assert.equal(mounted.element.querySelector('output').textContent, '5');
  await mounted.close();
});
