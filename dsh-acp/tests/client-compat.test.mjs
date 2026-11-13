import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// These are actual exports of the npm 0.2.2-rc.2 primitives source, not the
// desktop fork's namespace. Browser acceptance uses the real Web shell too.
const standardExports = [
  'Button', 'Input', 'MenuSurface', 'Modal', 'StateDot', 'Switch', 'Toast', 'rankByName',
  'IconCheckOutlineRegular', 'IconChevronDownOutlineRegular', 'IconChevronRightOutlineRegular',
  'IconCloseFillRegular', 'IconWarningOutlineRegular', 'IconAgentPresetOutlineRegular',
  'IconPlusOutlineRegular', 'IconRefreshOutlineRegular', 'IconSettingsOutlineRegular', 'IconTrashOutlineRegular',
];
const source = fs.readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');
const hostRoot = process.env.DSH_CLIENT_HOST_ROOT;
if (!hostRoot) throw new Error('Set DSH_CLIENT_HOST_ROOT to the supported host package directory (containing package.json).');
const hostRequire = createRequire(fs.realpathSync(path.join(hostRoot, 'package.json')));
const { Context } = await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/cordis')));

function client(extraPrimitives = {}) {
  let definition, cursor = 0;
  const states = new Map();
  const effects = [];
  const h = (type, props, ...children) => {
    assert.ok(type !== undefined, 'A rendered component must exist in the host export contract');
    return { type, props: { ...props, children }, children };
  };
  const primitives = Object.fromEntries(standardExports.map(name => [name, name]));
  primitives.rankByName = items => items;
  Object.assign(primitives, extraPrimitives);
  const react = {
    createElement: h, Fragment: 'Fragment',
    useState(initial) { const index = cursor++; return [states.has(index) ? states.get(index) : typeof initial === 'function' ? initial() : initial, value => states.set(index, value)]; },
    useEffect(fn) { effects.push(fn); }, useLayoutEffect() {}, useRef: value => ({ current: value }),
    useCallback: fn => fn, useMemo: fn => fn(), useId: () => 'test-picker',
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  };
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load({ factory }) { definition = factory(name => {
      if (name === 'react') return react;
      if (name === 'react-dom') return { createPortal: tree => tree };
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
      throw new Error(`Unexpected import ${name}`);
    }); } } },
    document: { getElementById: () => null, createElement: () => ({}), head: { appendChild() {} }, body: {} },
    setTimeout, clearTimeout, console,
  });
  return { definition, flushEffects: () => effects.splice(0).map(fn => fn()), render(component, props, values = []) {
    cursor = 0; states.clear(); values.forEach((value, index) => { if (value !== undefined) states.set(index, value); });
    return component(props);
  } };
}

const directory = { getSnapshot: () => ({ status: 'ready', current: null, groups: [], failures: [], pending: null }), subscribe: () => () => {} };
async function boot(fixture, navigation, initialShell) {
  const entries = [];
  const ctx = new Context();
  let shell = initialShell;
  const listeners = new Set();
  const slots = {
    inject: (_name, install) => install(),
    entriesOfSlot: name => name === 'sidebar.settings' && shell ? [shell] : [],
    subscribe: (name, listener) => { assert.equal(name, 'sidebar.settings'); listeners.add(listener); return () => listeners.delete(listener); },
    register(options, component) {
      const entry = { options, component }; entries.push(entry);
      return () => { const index = entries.indexOf(entry); if (index >= 0) entries.splice(index, 1); };
    },
  };
  ctx.provide('slots', slots);
  ctx.provide('locale', { register: () => () => {}, bind: () => key => key });
  ctx.provide('connection', { rpc: { call: async () => ({}) } });
  ctx.provide('remote', {});
  ctx.provide('remote.session', {});
  ctx.provide('modelDirectories', { directoryFor: () => ({ store: directory, load: async () => {}, select: async () => ({ ok: true }) }) });
  ctx.provide('sessions', { subagentAddress: () => undefined });
  if (navigation) ctx.provide('settingsNavigation', navigation);
  await ctx.plugin(fixture.definition);
  return { ctx, entries, setShell(value) { shell = value; for (const fn of listeners) fn(); }, settings: entries.find(entry => entry.options.name === 'settings.section'), picker: entries.find(entry => entry.options.name === 'conversation.input.model.options') };
}

function all(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(all);
  return [tree, ...all(tree.children)];
}
function expand(tree) {
  if (!tree || typeof tree !== 'object') return tree;
  if (Array.isArray(tree)) return tree.map(expand);
  if (typeof tree.type === 'function') return expand(tree.type(tree.props));
  return { ...tree, children: tree.children.map(expand) };
}

test('real Cordis activates the actual client and registers Agent settings without optional navigation', async () => {
  const fixture = client(); const app = await boot(fixture);
  try {
    assert.equal(app.settings.options.id, 'acp-agents');
    assert.ok(app.picker);
    assert.equal(app.picker.options.inject('session').openAgentSettings(), false);
    assert.doesNotThrow(() => expand(fixture.render(app.settings.component, app.settings.options.inject())));
  } finally { await app.ctx.fiber.dispose(); }
});

test('optional navigation still opens Agent settings on hosts that supply it', async () => {
  const opened = []; const fixture = client(); const app = await boot(fixture, { open: id => opened.push(id) });
  try {
    assert.equal(app.picker.options.inject('session').openAgentSettings(), true);
    assert.deepEqual(opened, ['acp-agents']);
  } finally { await app.ctx.fiber.dispose(); }
});

test('standard primitives render the public extension without replacing the native picker', async () => {
  const fixture = client(); const app = await boot(fixture);
  try {
    assert.equal(app.entries.some(entry => entry.options.name === 'conversation.input.model'), false);
    assert.equal(app.picker.options.children, undefined);
    const tree = expand(fixture.render(app.picker.component, { ...app.picker.options.inject('session'), dismiss() {}, reportFailure() {} }));
    assert.ok(all(tree).some(node => node.props?.icon?.type === 'IconSettingsOutlineRegular'));
    assert.equal(all(tree).some(node => node.type === 'MenuSurface'), false);
  } finally { await app.ctx.fiber.dispose(); }
});

test('standard permission select preserves controlled values, labels, disabled options and string change contract', async () => {
  const fixture = client(); const app = await boot(fixture);
  try {
    const catalog = { agents: [{ id: 'claude-code', name: 'Claude Code', enabled: false, models: [], account: {} }] };
    const tree = fixture.render(app.settings.component, app.settings.options.inject(), [catalog, 'claude-code', false]);
    const control = all(tree).find(node => typeof node.type === 'function' && node.type.name === 'NativeSettingsSelect');
    assert.ok(control);
    const selected = control.type({ ...control.props, value: 'ask', disabled: true, options: [{ id: 'ask', label: 'Ask' }, { id: 'all', label: 'Allow', disabled: true }], onChange: value => { assert.equal(value, 'all'); assert.equal(typeof value, 'string'); } });
    assert.equal(selected.type, 'select'); assert.equal(selected.props.value, 'ask'); assert.equal(selected.props.disabled, true);
    assert.equal(selected.children[0][1].props.disabled, true);
    selected.props.onChange({ currentTarget: { value: 'all' } });
    const busy = all(tree).find(node => typeof node.type === 'function' && node.type.name === 'Button');
    const button = busy.type({ ...busy.props, loading: true });
    assert.equal(button.props.disabled, true); assert.equal(button.props['aria-busy'], true);
    assert.equal(Object.hasOwn(button.props, 'loading'), false);
  } finally { await app.ctx.fiber.dispose(); }
});

test('desktop-provided controls and icons take precedence; text/presence extensions are not required', async () => {
  const fixture = client({ SettingsSelect: 'DesktopSettingsSelect', IconSettingsOutline16: 'DesktopSettingsIcon' });
  const app = await boot(fixture);
  try {
    const tree = expand(fixture.render(app.picker.component, { ...app.picker.options.inject('session'), dismiss() {}, reportFailure() {} }));
    assert.ok(all(tree).some(node => node.props?.icon?.type === 'DesktopSettingsIcon'));
    assert.doesNotMatch(source, /\b(?:FlipText|usePresence)\b/);
    const catalog = { agents: [{ id: 'claude-code', name: 'Claude Code', models: [], account: {} }] };
    const settings = expand(fixture.render(app.settings.component, app.settings.options.inject(), [catalog, 'claude-code', false]));
    assert.ok(all(settings).some(node => node.type === 'DesktopSettingsSelect'));
  } finally { await app.ctx.fiber.dispose(); }
});


test('standard shell navigation shares the root handle, opens the Agent section and releases stale bindings', async () => {
  const fixture = client();
  const shell = { store: { spec: { actions: { openSection() {} } } } };
  const app = await boot(fixture, undefined, shell);
  const opened = [];
  const actions = { openSection: id => opened.push(id) };
  try {
    const bridge = app.entries.find(entry => entry.options.id === 'dsh-acp-settings-navigation');
    assert.ok(bridge);
    assert.equal(bridge.options.name, 'shell.overlay');
    assert.equal(bridge.options.store, shell.store, 'the existing root shell handle is reused');
    assert.equal(bridge.options.children, undefined, 'no settings slots are redeclared');
    assert.equal(fixture.render(bridge.component, { ...bridge.options.inject(), actions }), null);
    const [unmount] = fixture.flushEffects();
    assert.equal(app.picker.options.inject('session').openAgentSettings(), true);
    assert.deepEqual(opened, ['acp-agents']);
    unmount();
    assert.equal(app.picker.options.inject('session').openAgentSettings(), false);
    fixture.render(bridge.component, { ...bridge.options.inject(), actions }); fixture.flushEffects();
    app.setShell(undefined);
    assert.equal(app.entries.includes(bridge), false);
    assert.equal(app.picker.options.inject('session').openAgentSettings(), false);
    app.setShell(shell);
    const restored = app.entries.find(entry => entry.options.id === 'dsh-acp-settings-navigation');
    assert.ok(restored); assert.notEqual(restored, bridge);
  } finally { await app.ctx.fiber.dispose(); }
});
