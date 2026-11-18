import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { editableModelOptions } from '../client-src/utils.js';

const source = fs.readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');
const treeNode = (type, props, ...children) => ({ type, props, children });
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.children)];

function fixture({ config = null, saving = false, effect = () => {} } = {}) {
  const values = [config, saving];
  let loaded;
  const hooks = {
    createElement: treeNode,
    Fragment: 'Fragment',
    useSyncExternalStore: (_, snapshot) => snapshot(),
    useState: () => [values.shift(), () => {}],
    useEffect: effect,
    useLayoutEffect() {},
    useMemo: fn => fn(),
    useCallback: fn => fn,
    useRef: current => ({ current }),
    useId: () => 'test-options',
  };
  const primitives = {
    Button: 'Button',
    IconSettingsOutline16: 'SettingsIcon',
    IconSettingsOutlineRegular: 'SettingsIcon',
  };
  vm.runInNewContext(source, {
    window: {
      __ModuleLoader__: {
        load({ factory }) {
          loaded = factory(name => {
            if (name === 'react') return hooks;
            if (name === 'react-dom') return { createPortal: tree => tree };
            if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
            throw new Error(`Unexpected require ${name}`);
          });
        },
      },
    },
    document: { getElementById: () => null, createElement: () => ({}), head: { appendChild() {} }, body: {} },
    setTimeout,
    clearTimeout,
    console,
  });
  let AgentSessionOptions;
  const ctx = {
    effect() {},
    locale: { register: () => () => {}, bind: () => key => key },
    connection: { rpc: { call: async () => ({}) } },
    slots: {
      inject: (_name, fn) => fn(),
      entriesOfSlot: () => [],
      subscribe: () => () => {},
      register: (spec, component) => {
        if (spec.name === 'conversation.input.model.options') AgentSessionOptions = component;
        return () => {};
      },
    },
    modelDirectories: { directoryFor: () => ({ store: {}, load: async () => {}, select: async () => ({}) }) },
    sessions: { subagentAddress: () => undefined },
    inject: (deps, fn) => {
      if (deps.every(dep => dep in ctx)) fn({ ...ctx });
    },
  };
  loaded.apply(ctx);
  return { editableModelOptions, AgentSessionOptions };
}
test('native menu options preserve dynamic boolean/select values and exclude routing, reasoning and permissions', () => {
 const { editableModelOptions } = fixture();
 const options = [
  { id: 'model', type: 'select' }, { id: 'budget', type: 'select', role: 'reasoning' },
  { id: 'effort', type: 'select' }, { id: 'permissions', type: 'select' },
  { id: 'sandbox', type: 'select' }, { id: 'unknown', type: 'text' },
  { id: 'fast', type: 'boolean' }, { id: 'format', type: 'select' },
 ];
 assert.deepEqual(Array.from(editableModelOptions({ options }), option => option.id), ['fast', 'format']);
});
test('native options respect host lock, persisted false/empty values, and Escape ownership', async () => {
 const config = { key: 'acp:fixture/model', options: [
  { id: 'fast', type: 'boolean', currentValue: true },
  { id: 'format', type: 'select', currentValue: 'json', options: [{ id: '', label: 'Automatic' }, { id: 'json' }] },
 ], selections: [{ id: 'fast', value: false }, { id: 'format', value: '' }] };
 for (const [locked, saving] of [[false, false], [true, false], [false, true]]) {
  const { AgentSessionOptions } = fixture({ config, saving });
  let dismissed = false, failure;
  const tree = AgentSessionOptions({ sessionId: 'session', directory: { subscribe() {}, getSnapshot: () => ({ current: { provider: 'acp:fixture', model: 'model' } }) },
   rpc: async () => ({}), t: key => key, locked, dismiss: () => { dismissed = true; }, openAgentSettings: () => false, reportFailure: text => { failure = text; } });
  const checkbox = nodes(tree).find(node => node.type === 'input');
  const select = nodes(tree).find(node => node.type === 'select');
  assert.equal(checkbox.props.checked, false); assert.equal(select.props.value, '');
  assert.equal(checkbox.props.disabled, locked || saving); assert.equal(select.props.disabled, locked || saving);
  for (const relatedTarget of [null, {}]) {
   let stopped = false; tree.props.onBlur({ relatedTarget, stopPropagation: () => { stopped = true; } });
   assert.equal(stopped, saving && relatedTarget === null);
  }
  for (const key of ['Enter', ' ', 'ArrowDown', 'Tab', 'Escape']) {
   let stopped = false; tree.props.onKeyDown({ key, stopPropagation: () => { stopped = true; } });
   assert.equal(stopped, key !== 'Escape');
  }
  nodes(tree).find(node => node.type === 'Button' || node.type?.name === 'Button').props.onClick();
  assert.equal(dismissed, true); assert.equal(failure, 'error.settingsNav');
 }
});
