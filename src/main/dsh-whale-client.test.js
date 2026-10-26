'use strict';

// Contract test for vendor/dsh-whale/client/client.js at the plugin module
// boundary: exports.inject, the slot registrations' inject face, and the
// window.__dshWhaleOpen pet bridge. The harness 0.1.6 client removed
// sessions.open() — view selection moved to uiWorkspace.openSession — so every
// "open her session" path must route through a unified helper that prefers
// uiWorkspace and falls back to sessions.open on pre-0.1.6 hosts.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CLIENT_FILE = path.join(__dirname, '..', '..', 'vendor', 'dsh-whale', 'client', 'client.js');
const PACKAGE_FILE = path.join(__dirname, '..', '..', 'vendor', 'dsh-whale', 'package.json');

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

function loadPlugin({ stateful = false } = {}) {
  const spec = { current: null };
  const window = {
    __ModuleLoader__: { load: (entry) => { spec.current = entry; } },
    confirm: () => false,
  };
  const document = {
    getElementById: () => null,
    createElement: () => ({}),
    head: { appendChild() {} },
  };
  vm.runInNewContext(fs.readFileSync(CLIENT_FILE, 'utf8'), { window, document }, { filename: CLIENT_FILE });
  assert.ok(spec.current, 'client.js must register itself with __ModuleLoader__');

  const stateWrites = [];
  const states = [];
  const refs = [];
  const effects = [];
  let cursor = 0;
  let refCursor = 0;
  let effectCursor = 0;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (init) => {
      if (!stateful) return [init, (value) => stateWrites.push(value)];
      const index = cursor++;
      if (!(index in states)) states[index] = typeof init === 'function' ? init() : init;
      return [states[index], (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    },
    useEffect: (fn, dependencies) => {
      if (!stateful) return fn();
      const index = effectCursor++;
      const previous = effects[index];
      if (previous && dependencies?.every((value, key) => Object.is(value, previous.dependencies?.[key]))) return;
      previous?.cleanup?.();
      effects[index] = { dependencies, cleanup: fn() };
    },
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useRef: (value) => {
      if (!stateful) return { current: value };
      const index = refCursor++;
      if (!(index in refs)) refs[index] = { current: value };
      return refs[index];
    },
    Fragment: Symbol('Fragment'),
  };
  const require = (name) => {
    if (name === 'react') return react;
    return {};
  };
  const exports = spec.current.factory(require);
  return { exports, window, stateWrites, render: (component, props) => {
    cursor = 0;
    refCursor = 0;
    effectCursor = 0;
    return component(props);
  } };
}

function findElement(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of (node.children ?? []).flat(Infinity)) {
    const hit = findElement(child, predicate);
    if (hit) return hit;
  }
  return null;
}

function translate(key, args = {}) {
  return Object.entries(args).reduce((text, [name, value]) => `${text} ${name}=${value}`, key);
}

async function settingsBench(rpc) {
  const plugin = loadPlugin({ stateful: true });
  const { ctx, registrations } = makeCtx({ specs: ['settings.pet.item'] });
  plugin.exports.apply(ctx);
  const component = registrations.find((entry) => entry.decl.name === 'settings.pet.item').component;
  const props = { t: translate, rpc };
  const render = () => plugin.render(component, props);
  render();
  await settle();
  return { plugin, render };
}

const personaDialog = (tree) => findElement(tree, (node) => node.props.title === 'field.personaText');
const feedback = (tree, predicate) => findElement(tree, (node) => typeof node.props.text === 'string' && predicate(node.props));

async function editPersona(bench, draft) {
  const edit = findElement(bench.render(), (node) => node.children.includes('edit'));
  assert.ok(edit, 'the persona editor must be available');
  edit.props.onClick();
  const dialog = personaDialog(bench.render());
  const textarea = findElement(dialog, (node) => node.type === 'textarea');
  textarea.props.onChange({ target: { value: draft } });
  return findElement(personaDialog(bench.render()).props.footer, (node) => node.children.includes('save'));
}

test('the settings model control preserves slashes inside the selected model id', async () => {
  const plugin = loadPlugin({ stateful: true });
  const { ctx, registrations } = makeCtx({ specs: ['settings.pet.item'] });
  plugin.exports.apply(ctx);
  const component = registrations.find((entry) => entry.decl.name === 'settings.pet.item').component;
  const calls = [];
  const props = { t: (key) => key, rpc: async (method, payload) => {
    calls.push({ method, payload });
    return { name: '鲸鱼娘', imDefault: true };
  } };
  plugin.render(component, props);
  await settle();
  const tree = plugin.render(component, props);
  const find = (node) => {
    if (!node || typeof node !== 'object') return null;
    if (node.props?.['aria-label'] === 'field.model') return node;
    for (const child of (node.children ?? []).flat(Infinity)) { const hit = find(child); if (hit) return hit; }
    return null;
  };
  const control = find(tree);
  assert.ok(control);
  control.props.onChange('openrouter/anthropic/claude-fable-5.1');
  await settle();
  const saved = calls.find((call) => call.method === 'settings/update').payload;
  assert.equal(saved.model.provider, 'openrouter');
  assert.equal(saved.model.model, 'anthropic/claude-fable-5.1');
});

// Builds the host ctx. `sessionsShape: '0.1.6'` carries catalog methods only
// (no open); `'0.1.5'` adds open(). `uiWorkspace` may be provided as a direct
// ctx property or only through ctx.get.
function makeCtx({ sessionsShape = '0.1.6', uiWorkspace = undefined, viaGet = false, specs = [] } = {}) {
  const calls = { openSession: [], sessionsOpen: [], selectPanel: [] };
  const sessions = {
    retain() {}, create() {}, search() {},
    ...(sessionsShape === '0.1.5' ? { open: async (id) => { calls.sessionsOpen.push(id); } } : {}),
  };
  const workspace = uiWorkspace === false
    ? undefined
    : { openSession: (id) => calls.openSession.push(id) };
  const declared = specs.length ? new Set(specs) : new Set([
    'sidebar.panellist', 'main', 'sidebar.footer.action',
    'conversation.session.header.actions', 'conversation.session.header.leading',
  ]);
  const registrations = [];
  const rpcCalls = [];
  const disposers = [];
  const services = { sessions, uiWorkspace: workspace };

  const ctx = {
    effect: (fn) => { disposers.push(fn()); },
    locale: { register: () => () => {}, bind: () => (key) => key },
    connection: {
      rpc: {
        call: async (_prefix, endpoint) => {
          rpcCalls.push(endpoint);
          if (endpoint === 'assistant/ensure') return { result: { value: { sessionId: 'session-whale-1' } } };
          return { result: { value: { name: '鲸鱼娘' } } };
        },
      },
    },
    layout: { selectPanel: (id) => calls.selectPanel.push(id) },
    slots: {
      inject: (_name, fn) => { fn(); },
      register: (decl, component) => { registrations.push({ decl, component }); return () => {}; },
      spec: (name) => (declared.has(name) ? {} : undefined),
      subscribe: () => () => {},
    },
    get: (name) => services[name],
  };
  if (!viaGet) {
    ctx.sessions = sessions;
    if (workspace) ctx.uiWorkspace = workspace;
  }
  return { ctx, calls, registrations, rpcCalls };
}

const faceOf = (registrations, slotName) => {
  const hit = registrations.find((entry) => entry.decl.name === slotName);
  assert.ok(hit, `expected a ${slotName} registration`);
  return hit.decl.inject();
};

const registeredNames = (registrations) => registrations.map((entry) => `${entry.decl.name}:${entry.decl.id ?? ''}`);

test('client declares the uiWorkspace service dependency', () => {
  const { exports } = loadPlugin();
  assert.ok(exports.inject.includes('uiWorkspace'), 'exports.inject must include uiWorkspace');
  const manifest = JSON.parse(fs.readFileSync(PACKAGE_FILE, 'utf8'));
  assert.ok(
    manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-workspace'),
    'dsh.client.inject must include @deepseek-ai/dsh-client-ui-workspace',
  );
});

test('__dshWhaleOpen opens her session through uiWorkspace on a 0.1.6 host', async () => {
  const { exports, window } = loadPlugin();
  const { ctx, calls } = makeCtx();
  exports.apply(ctx);
  assert.equal(typeof window.__dshWhaleOpen, 'function');
  const sessionId = await window.__dshWhaleOpen();
  assert.equal(sessionId, 'session-whale-1');
  assert.deepEqual(calls.openSession, ['session-whale-1']);
  assert.deepEqual(calls.selectPanel, [null]);
  assert.deepEqual(calls.sessionsOpen, []);
});

test('__dshWhaleOpen falls back to sessions.open on a 0.1.5 host', async () => {
  const { exports, window } = loadPlugin();
  const { ctx, calls } = makeCtx({ sessionsShape: '0.1.5', uiWorkspace: false });
  exports.apply(ctx);
  const sessionId = await window.__dshWhaleOpen();
  assert.equal(sessionId, 'session-whale-1');
  assert.deepEqual(calls.sessionsOpen, ['session-whale-1']);
  assert.deepEqual(calls.selectPanel, [null]);
});

test('inject face openSession prefers uiWorkspace and resolves uiWorkspace via ctx.get', async () => {
  const { exports } = loadPlugin();
  const { ctx, calls, registrations } = makeCtx({ viaGet: true });
  exports.apply(ctx);
  const face = faceOf(registrations, 'main');
  assert.equal(typeof face.openSession, 'function');
  await face.openSession('session-whale-1');
  assert.deepEqual(calls.openSession, ['session-whale-1']);
  await assert.rejects(() => face.openSession('   '), /no-session/);
});

test('main-panel redirect opens her session through uiWorkspace on a 0.1.6 host', async () => {
  const { exports } = loadPlugin();
  const { ctx, calls, registrations } = makeCtx({ specs: ['sidebar.panellist', 'main'] });
  exports.apply(ctx);
  const redirect = registrations.find((entry) => entry.decl.name === 'main');
  redirect.component(faceOf(registrations, 'main'));
  await settle();
  assert.deepEqual(calls.openSession, ['session-whale-1']);
  assert.deepEqual(calls.selectPanel, [null]);
});

test('main-panel redirect surfaces the service-unavailable error when neither API exists', async () => {
  const { exports, stateWrites } = loadPlugin();
  const { ctx, registrations } = makeCtx({ uiWorkspace: false, specs: ['sidebar.panellist', 'main'] });
  exports.apply(ctx);
  const redirect = registrations.find((entry) => entry.decl.name === 'main');
  redirect.component(faceOf(registrations, 'main'));
  await settle();
  assert.ok(stateWrites.includes('sessions service unavailable'));
});

test('sidebar footer fallback opens her session through uiWorkspace on a 0.1.6 host', async () => {
  const { exports } = loadPlugin();
  const { ctx, calls, registrations } = makeCtx({ specs: ['sidebar.footer.action'] });
  exports.apply(ctx);
  const footer = registrations.find((entry) => entry.decl.name === 'sidebar.footer.action');
  const tree = footer.component(faceOf(registrations, 'sidebar.footer.action'));
  const button = findElement(tree, (node) => node.props['aria-label'] === 'tab');
  assert.ok(button, 'the footer must retain its accessible open action');
  await button.props.onClick();
  await settle();
  assert.deepEqual(calls.openSession, ['session-whale-1']);
});

test('the footer waits for the workspace result and surfaces a rejected open', async () => {
  const plugin = loadPlugin({ stateful: true });
  const { ctx, registrations } = makeCtx({ specs: ['sidebar.footer.action'] });
  const pending = Promise.withResolvers();
  ctx.uiWorkspace.openSession = () => pending.promise;
  plugin.exports.apply(ctx);
  const footer = registrations.find((entry) => entry.decl.name === 'sidebar.footer.action');
  const props = faceOf(registrations, 'sidebar.footer.action');
  props.t = translate;
  const render = () => plugin.render(footer.component, props);
  const action = findElement(render(), (node) => node.props['aria-label'] === 'tab').props.onClick();
  await settle();
  const busy = findElement(render(), (node) => node.props['aria-label'] === 'tab');
  assert.equal(busy.props.loading, true);
  assert.equal(busy.props.disabled, true);
  pending.reject(new Error('workspace rejected'));
  await action;
  const tree = render();
  assert.equal(findElement(tree, (node) => node.props['aria-label'] === 'tab').props.disabled, false);
  assert.ok(feedback(tree, (props) => props.text.includes('workspace rejected') && !props.success));
});

test('a rejected persona save keeps the draft and dialog and shows no saved feedback', async () => {
  let reject = true;
  const calls = [];
  const bench = await settingsBench(async (method, payload) => {
    calls.push({ method, payload });
    if (method === 'settings/update' && reject) throw new Error('write rejected');
    return { name: '鲸鱼娘', personaText: method === 'settings/update' ? payload.personaText : 'server persona', imDefault: true };
  });
  const save = await editPersona(bench, 'my unsaved persona');
  save.props.onClick();
  await settle();
  let tree = bench.render();
  let dialog = personaDialog(tree);
  assert.equal(dialog.props.open, true);
  assert.equal(findElement(dialog, (node) => node.type === 'textarea').props.value, 'my unsaved persona');
  assert.ok(feedback(tree, (props) => props.text.includes('write rejected') && !props.success));
  assert.equal(feedback(tree, (props) => props.success === true), null);
  reject = false;
  findElement(dialog.props.footer, (node) => node.children.includes('save')).props.onClick();
  await settle();
  tree = bench.render();
  assert.equal(personaDialog(tree).props.open, false);
  assert.ok(feedback(tree, (props) => props.text === 'saved' && props.success === true));
  const saves = calls.filter((call) => call.method === 'settings/update');
  assert.equal(saves.length, 2);
  assert.equal(saves.at(-1).payload.personaText, 'my unsaved persona');
});

test('an accepted save followed by a failed catalog refresh reports both facts without full success', async () => {
  let accepted = false;
  const calls = [];
  const bench = await settingsBench(async (method, payload) => {
    calls.push({ method, payload });
    if (method === 'settings/update') { accepted = true; return { name: '鲸鱼娘', personaText: payload.personaText }; }
    if (accepted) throw new Error('catalog refresh rejected');
    return { name: '鲸鱼娘', personaText: 'server persona', imDefault: true };
  });
  const save = await editPersona(bench, 'accepted persona');
  save.props.onClick();
  await settle();
  const tree = bench.render();
  assert.equal(personaDialog(tree).props.open, false);
  assert.equal(calls.filter((call) => call.method === 'settings/update').length, 1);
  assert.equal(feedback(tree, (props) => props.success === true), null);
  assert.ok(feedback(tree, (props) => props.text.includes('saved') && props.text.includes('catalog refresh rejected') && !props.success));
});

test('whale slots use the project head and keep normal sessions untouched', () => {
  const { exports } = loadPlugin();
  const { ctx, registrations } = makeCtx({ specs: ['sidebar.panellist', 'main', 'conversation.session.header.actions', 'conversation.session.header.leading'] });
  exports.apply(ctx);
  assert.ok(registeredNames(registrations).includes('conversation.session.header.leading:'));

  const glyph = registrations.find((entry) => entry.decl.name === 'sidebar.panellist');
  const images = glyph.component({ size: 18 }).children;
  assert.deepEqual(Array.from(images, image => image.props.src), ['/whale-isle-head.png', 'claude-isle-head.png']);
  assert.deepEqual(Array.from(images, image => image.props['data-dsh-mascot']), ['default', 'claude']);
  for (const image of images) {
    assert.equal(image.type, 'img');
    assert.equal(image.props.width, 18);
    assert.equal(image.props.height, 18);
    assert.equal(image.props.alt, '');
  }

  const mark = registrations.find((entry) => entry.decl.name === 'conversation.session.header.leading');
  const mine = mark.component({
    sessionId: 'session-whale-1',
    useSessions: (select) => select({ byId: { 'session-whale-1': { presentation: { owner: 'dsh-whale:assistant' } } } }),
  });
  assert.equal(mine.type.name ?? mine.type, 'WhalePanelGlyph');
  const other = mark.component({
    sessionId: 'session-other',
    useSessions: (select) => select({ byId: { 'session-other': { presentation: { owner: 'plugin:other' } } } }),
  });
  assert.equal(other, null);
});
