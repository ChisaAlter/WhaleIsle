import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');
const start = source.indexOf('    function editableModelOptions(');
const end = source.indexOf('\n    // Separate, durable reply', start);
const compile = vm.compileFunction(`${source.slice(start, end)}\nreturn { editableModelOptions, AgentSessionOptions };`,
 ['h', 'useSyncExternalStore', 'useState', 'useEffect', 'useRef', 'ACP_PREFIX', 'Button', 'IconSettingsOutline16']);
const treeNode = (type, props, ...children) => ({ type, props, children });
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.children)];
function fixture({ config = null, current = { provider: 'acp:fixture', model: 'model' }, pending = null, saving = false, effect = () => {} } = {}) {
 const values = [config, saving];
 return compile(treeNode, (_, snapshot) => snapshot(), () => [values.shift(), () => {}], effect, current => ({current}), 'acp:', 'Button', 'SettingsIcon');
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
  nodes(tree).find(node => node.type === 'Button').props.onClick();
  assert.equal(dismissed, true); assert.equal(failure, 'error.settingsNav');
 }
});
