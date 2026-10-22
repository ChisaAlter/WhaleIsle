import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const bundle = await build({ stdin: { contents: "export * from './library';export * from './react'", sourcefile: 'details-tests.ts', resolveDir: base, loader: 'ts' }, write: false, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external', alias: { '@whale-ui/react': path.join(base, 'react/index.ts') }, logLevel: 'silent' });
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, loaded, loaded.exports);
const ui = loaded.exports;
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://whale.test/', pretendToBeVisual: true });
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'MutationObserver']) Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true, writable: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
const disclosureSource = 'root = Col([Details("Edit",[Input($n,"Count","number")]), Details("Explanation",[Text("Reason")],true), Text($n+""),Button("Send",@ToAssistant("Review"))])\n$n = 2';
async function mount(initialState, source = disclosureSource) {
  const element = document.createElement('div'); document.body.append(element);
  const root = createRoot(element), states = [], actions = [];
  await act(async () => root.render(React.createElement(ui.Renderer, { response: source, library: ui.library, initialState, onStateUpdate: value => states.push(structuredClone(value)), onAction: action => { actions.push(action); return { ok: true }; } })));
  return { element, states, actions, close: async () => { await act(async () => root.unmount()); element.remove(); } };
}
test('secondary disclosure keeps edited inputs mounted and restores its own open state', async () => {
  let app = await mount();
  try {
    const [edit, explanation] = app.element.querySelectorAll('details'), field = edit.querySelector('input');
    assert.equal(edit.open, false); assert.equal(explanation.open, true);
    await act(async () => { edit.open = true; edit.dispatchEvent(new Event('toggle')); });
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(field, 7); field.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { edit.open = false; edit.dispatchEvent(new Event('toggle')); });
    assert.equal(edit.querySelector('input'), field); assert.equal(field.value, '7');
    await act(async () => { edit.open = true; edit.dispatchEvent(new Event('toggle')); });
    const snapshot = app.states.at(-1); assert.equal(snapshot.$n, 7);
    await app.close(); app = await mount(snapshot);
    assert.equal(app.element.querySelector('details').open, true); assert.equal(app.element.querySelector('input').value, '7');
    await act(async () => app.element.querySelector('button').click());
    assert.equal(app.actions.length, 1); assert.ok(!JSON.stringify(app.actions[0]).includes('__whale_component_state__'));
  } finally { await app.close(); }
});

test('documented collection editor disables updates after deleting the selected task', async () => {
  const source = readFileSync(path.join(base, 'runtime/guide.ts'), 'utf8').split('An editable collection')[1];
  const program = source.match(/^root = [\s\S]*?(?=`,)/m)?.[0];
  assert.ok(program);
  const app = await mount(undefined, program);
  const button = name => [...app.element.querySelectorAll('button')].find(e => e.textContent === name);
  try {
    await act(async () => button('Delete').click());
    assert.match(app.element.textContent, /0 remaining/);
    assert.match(app.element.textContent, /Select a task to edit/);
    assert.equal(button('Apply').disabled, true);
    assert.equal(app.element.querySelector('input[type=number]'), null);
    const field = app.element.querySelector('input');
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(field, 'New item'); field.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => button('Add').click());
    await act(async () => button('Edit').click());
    assert.equal(button('Apply').disabled, false);
    assert.match(app.element.textContent, /Selected: New item/);
  } finally { await app.close(); }
});
