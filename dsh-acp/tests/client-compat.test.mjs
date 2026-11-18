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
async function boot(fixture, navigation, initialShell, optionEntries = []) {
  const entries = [];
  const ctx = new Context();
  let shell = initialShell;
  const listeners = new Set();
  const slots = {
    inject: (_name, install) => install(),
    entriesOfSlot: name => name === 'sidebar.settings' && shell ? [shell]
      : name === 'conversation.input.model.options' ? optionEntries : [],
    getVersion: () => 0,
    subscribe: (name, listener) => { listeners.add(listener); return () => listeners.delete(listener); },
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

test('Agent-first picker shadows only the model seat without claiming native child slots', async () => {
  const fixture = client(); const app = await boot(fixture);
  try {
    const selector = app.entries.find(entry => entry.options.name === 'conversation.input.model');
    assert.equal(selector.options.priority, -10);
    assert.equal(selector.options.children, undefined);
    assert.equal(app.picker.options.children, undefined);
    const tree = expand(fixture.render(app.picker.component, { ...app.picker.options.inject('session'), dismiss() {}, reportFailure() {} }));
    assert.ok(all(tree).some(node => node.props?.icon?.type === 'IconSettingsOutlineRegular'));
    assert.equal(all(tree).some(node => node.type === 'MenuSurface'), false);
  } finally { await app.ctx.fiber.dispose(); }
});

test('restored picker reuses the real Team entry callbacks, locale and session hooks', async () => {
  const fixture = client();
  const selectTeamMode = () => {};
  const requestDisableConfirmation = () => {};
  const native = { options: { id: 'agent-team' }, locale: 'agent-team', component: 'NativeTeamToggle',
    inject(sessionId) { assert.equal(sessionId, 'session'); return { selectTeamMode, requestDisableConfirmation }; } };
  const app = await boot(fixture, undefined, undefined, [native]);
  try {
    const selector = app.entries.find(entry => entry.options.name === 'conversation.input.model');
    const useProjection = () => {}, useSession = () => {}, useSessions = () => {};
    const owner = { locked: true, dismiss() {}, reportFailure() {} };
    const tree = fixture.render(selector.component, {
      ...selector.options.inject('session'), useProjection, useSession, useSessions,
    });
    const [team] = tree.props.renderHostOptions(owner);
    assert.equal(team.type, native.component);
    assert.equal(team.props.selectTeamMode, selectTeamMode);
    assert.equal(team.props.requestDisableConfirmation, requestDisableConfirmation);
    assert.equal(team.props.useProjection, useProjection);
    assert.equal(team.props.useSession, useSession);
    assert.equal(team.props.useSessions, useSessions);
    assert.equal(team.props.locked, true);
    assert.equal(team.props.dismiss, owner.dismiss);
    assert.equal(team.props.reportFailure, owner.reportFailure);
    // Opening the restored component must resolve every primitive on the
    // standard host, not only render the closed trigger.
    const opened = fixture.render(tree.type, tree.props, [true]);
    assert.ok(all(opened).some(node => node.type === 'MenuSurface'));
    assert.ok(all(opened).some(node => node.props?.role === 'searchbox'));
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
    assert.match(source, /primitives\.FlipText \?\?/);
    assert.match(source, /primitives\.usePresence \?\?/);
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

test('Agent picker previews candidate capabilities without borrowing the current agent values or closing on selection', async () => {
  const fixture = client(); const app = await boot(fixture);
  try {
    const selector = app.entries.find(entry => entry.options.name === 'conversation.input.model');
    const wrapped = fixture.render(selector.component, selector.options.inject('session'));
    const catalog = [
      { id: 'devin', name: 'Devin', enabled: true, models: [{ id: 'swe', name: 'SWE', efforts: [{ id: 'medium', name: 'Medium' }] }] },
      { id: 'buddy', name: 'CodeBuddy', enabled: true, models: [
        { id: 'hy4', name: 'Hy4', efforts: [{ id: 'on', name: 'On (default)' }], options: [{ id: 'multitask', name: 'Multitask', type: 'boolean', currentValue: false }] },
        { id: 'fixed', name: 'Fixed' },
      ] },
    ];
    const current = { provider: 'acp:devin', model: 'swe', reasoningEffort: 'medium' };
    const submitted = []; const writes = [];
    const props = { ...wrapped.props,
      directory: { subscribe: () => () => {}, getSnapshot: () => ({ current, pending: null, groups: [], failures: [], status: 'ready' }) },
      select: async selection => { submitted.push(selection); return { ok: true }; },
      rpc: async (method, input) => { writes.push({ method, input }); return { selections: [] }; },
    };
    const tree = fixture.render(wrapped.type, props, [true, 'acp:buddy', catalog]);
    const aside = all(tree).find(node => node.props?.className === 'dsh-acp-ms-aside');
    assert.equal(all(aside).some(node => node.children?.includes('aside.preview')), true);
    assert.equal(all(aside).some(node => node.children?.includes('Hy4')), true);
    assert.equal(all(aside).some(node => node.children?.includes('On (default)')), true);
    assert.equal(all(aside).some(node => node.children?.includes('Medium')), false);
    const checkbox = all(aside).find(node => node.type === 'input' && node.props.type === 'checkbox');
    assert.equal(checkbox.props.disabled, true, 'preview is read-only until its model is selected');
    await checkbox.props.onChange({ target: { checked: true } });
    assert.equal(writes.length, 0);
    const effort = all(aside).find(node => node.type === 'button' && node.children?.some(child => child?.children?.includes('On (default)')));
    effort.props.onClick();
    assert.deepEqual({ ...submitted[0] }, { provider: 'acp:buddy', model: 'hy4', reasoningEffort: 'on' });
    const row = all(tree).find(node => node.props?.role === 'menuitemradio' && node.props.title === 'Hy4');
    await row.props.onClick();
    assert.equal(submitted[1].provider, 'acp:buddy');
    // closeAfterSelection requires queueMicrotask + trigger focus. Neither is
    // available in this host fixture: default model selection must stay open.
    const fixed = fixture.render(wrapped.type, props, [true, 'acp:buddy', catalog, '', 1]);
    const fixedAside = all(fixed).find(node => node.props?.className === 'dsh-acp-ms-aside');
    assert.equal(all(fixedAside).some(node => node.props?.role === 'group'), false);
    assert.equal(all(fixedAside).some(node => node.type === 'input'), false);
  } finally { await app.ctx.fiber.dispose(); }
});
