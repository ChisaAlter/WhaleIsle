'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CLIENT_BUNDLE = path.join(__dirname, '..', '..', 'vendor', 'dsh-remote', 'lib', 'client.js');

// Executes the shipped ModuleLoader bundle and returns its plugin exports.
function loadClientModule({ fetch, react, jsx } = {}) {
  let captured = null;
  const sandbox = {
    window: { __ModuleLoader__: { load: (registration) => { captured = registration; } } },
    document: {
      querySelector: () => null,
      createElement: () => ({ dataset: {}, remove() {} }),
      head: { appendChild() {} },
    },
    URL,
    console,
    fetch,
  };
  vm.runInNewContext(fs.readFileSync(CLIENT_BUNDLE, 'utf8'), sandbox, { filename: CLIENT_BUNDLE });
  assert.ok(captured && captured.id === 'dsh-remote', 'client bundle must register itself as "dsh-remote"');
  const requireStub = (spec) => {
    if (spec === 'react') {
      if (react) return react;
      return {
        createElement: () => null,
        useState: (init) => [init, () => {}],
        useEffect: () => {},
        useMemo: (fn) => fn(),
        useRef: (init) => ({ current: init }),
        useCallback: (fn) => fn,
        Fragment: Symbol('Fragment'),
      };
    }
    if (spec === 'react/jsx-runtime' && jsx) return { jsx, jsxs: jsx };
    return new Proxy({}, { get: () => () => null });
  };
  return captured.factory(requireStub);
}

// Minimal slots service honouring the real contract: inject() runs the
// callback synchronously when the slot is declared, otherwise parks it until
// declaration; declare() commits a spec and then notifies parked waiters.
// subscribe() mirrors SlotCore: listeners fire whenever the key mutates,
// including declaration commits and collapses.
function makeSlots() {
  const specs = new Map();
  const waiters = new Map();
  const subscribers = new Map();
  const registrations = [];
  const notify = (key) => {
    for (const fn of [...(subscribers.get(key) ?? [])]) fn();
  };
  return {
    registrations,
    spec: (key) => specs.get(key),
    subscribe(key, fn) {
      const list = subscribers.get(key) ?? new Set();
      list.add(fn);
      subscribers.set(key, list);
      return () => list.delete(fn);
    },
    register(options, component) {
      const entry = { options, component };
      registrations.push(entry);
      return () => {
        const at = registrations.indexOf(entry);
        if (at !== -1) registrations.splice(at, 1);
      };
    },
    inject(key, callback) {
      if (specs.has(key)) {
        callback();
        return () => {};
      }
      const list = waiters.get(key) ?? [];
      list.push(callback);
      waiters.set(key, list);
      return () => {};
    },
    declareAll(keys) {
      for (const key of keys) specs.set(key, { kind: 'list', scope: 'root' });
      for (const key of keys) notify(key);
      for (const key of keys) {
        const list = waiters.get(key) ?? [];
        waiters.delete(key);
        for (const callback of list) callback();
      }
    },
    declare(key) {
      this.declareAll([key]);
    },
  };
}

function makeCtx(slots) {
  const services = new Map([['slots', slots]]);
  const injectWaiters = [];
  const locales = new Map();
  const rootCtx = {
    slots,
    locale: {
      register: (ns, dicts) => { locales.set(ns, dicts); return () => locales.delete(ns); },
      bind: () => (key) => key,
    },
    effect: (fn) => fn(),
    get: (name) => services.get(name),
    provide(name, service) {
      services.set(name, service);
      for (const waiter of injectWaiters.splice(0)) waiter();
      return () => services.delete(name);
    },
    inject(names, fn) {
      const ready = names.every((name) => services.has(name));
      if (!ready) {
        injectWaiters.push(() => { if (names.every((name) => services.has(name))) fn(rootCtx); });
        return () => {};
      }
      fn(rootCtx);
      return () => {};
    },
    _locales: locales,
  };
  return rootCtx;
}

function applyWith(slots, options) {
  const mod = loadClientModule(options);
  assert.equal(mod.name, 'dsh-remote');
  assert.deepEqual([...mod.inject], ['slots', 'locale']);
  const ctx = makeCtx(slots);
  mod.apply(ctx);
  return { mod, ctx };
}

function registeredSeats(slots) {
  return slots.registrations.map((entry) => `${entry.options.name}#${entry.options.id ?? entry.options.key ?? ''}`);
}

// Reuse the shipped bundle and registered settings component; retain hook
// state across renders so async reads and the visible reload action execute.
function remoteSettingsFixture(fetch) {
  const hooks = [];
  const effects = [];
  let cursor = 0;
  const changed = (previous, deps) => !previous
    || deps.length !== previous.deps.length
    || deps.some((dep, index) => dep !== previous.deps[index]);
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], (value) => {
        hooks[index] = typeof value === 'function' ? value(hooks[index]) : value;
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = { current: initial };
      return hooks[index];
    },
    useCallback(fn, deps) {
      const index = cursor++;
      if (changed(hooks[index], deps)) hooks[index] = { deps: [...deps], value: fn };
      return hooks[index].value;
    },
    useEffect(fn, deps) {
      const index = cursor++;
      const previous = hooks[index];
      if (!changed(previous, deps)) return;
      hooks[index] = { deps: [...deps] };
      effects.push(() => {
        previous?.cleanup?.();
        hooks[index].cleanup = fn();
      });
    },
    Fragment: Symbol('Fragment'),
  };
  const slots = makeSlots();
  const { ctx } = applyWith(slots, { fetch, react, jsx: (type, props) => ({ type, props }) });
  slots.declare('settings.section');
  const section = slots.registrations.find((entry) => entry.options.id === 'remote-workspace').component;
  const dictionary = ctx._locales.get('dsh-remote').zh;
  const t = (key, args = {}) => dictionary[key].replace(/\{(\w+)\}/g, (match, name) => args[name] ?? match);
  return {
    render() {
      cursor = 0;
      const tree = section({ t });
      for (const effect of effects.splice(0)) effect();
      return tree;
    },
    async settle() {
      await new Promise(setImmediate);
      return this.render();
    },
  };
}

function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !node.props) return [];
  return [node, ...elements(node.props.children)];
}

function textContent(node) {
  if (Array.isArray(node)) return node.map(textContent).join(' ');
  if (node && typeof node === 'object') return textContent(node.props?.children);
  return node == null || typeof node === 'boolean' ? '' : String(node);
}

const REMOTE_FLOW_SLOTS = [
  'conversation.hero.workspace.directoryFlow.remote',
  'sidebar.workspaces.directoryFlow.remote',
];

test('dsh-remote registers bilingual dictionaries with key parity', () => {
  const slots = makeSlots();
  const { ctx } = applyWith(slots);
  const dicts = ctx._locales.get('dsh-remote');
  assert.ok(dicts && dicts.zh && dicts.en, 'dsh-remote dict must ship zh and en');
  assert.deepEqual(Object.keys(dicts.zh).sort(), Object.keys(dicts.en).sort(), 'zh/en key parity');
});

test('dsh-remote registers the settings section and remote-flow occupants when seats declare', () => {
  const slots = makeSlots();
  applyWith(slots);
  assert.deepEqual(registeredSeats(slots), [], 'must not register before the seats declare');
  slots.declare('settings.section');
  assert.deepEqual(registeredSeats(slots), ['settings.section#remote-workspace']);
  for (const key of REMOTE_FLOW_SLOTS) slots.declare(key);
  assert.deepEqual(registeredSeats(slots).sort(), [
    'conversation.hero.workspace.directoryFlow.remote#',
    'settings.section#remote-workspace',
    'sidebar.workspaces.directoryFlow.remote#',
  ]);
});

test('dsh-remote defers sidebar registrations until sidebarRightTabs is provided', () => {
  const slots = makeSlots();
  const { ctx } = applyWith(slots);
  slots.declareAll(['sidebar.right.pane.tab', 'sidebar.right.pane.tab.title']);
  assert.deepEqual(registeredSeats(slots), [], 'sidebar seats must wait for sidebarRightTabs');
  const tabTypes = [];
  ctx.provide('sidebarRightTabs', { register: (def) => { tabTypes.push(def); return () => {}; } });
  assert.deepEqual(tabTypes.map((def) => def.id).sort(), ['dsh-remote/explorer', 'dsh-remote/file']);
  const fileDef = tabTypes.find((def) => def.id === 'dsh-remote/file');
  assert.deepEqual([...fileDef.patterns], ['dsh-resource://dsh-remote/**']);
  assert.deepEqual(registeredSeats(slots).sort(), [
    'sidebar.right.pane.tab.title#dsh-remote/explorer',
    'sidebar.right.pane.tab.title#dsh-remote/file',
    'sidebar.right.pane.tab#dsh-remote/explorer',
    'sidebar.right.pane.tab#dsh-remote/file',
  ].sort());
});

test('dsh-remote survives a composition with no sidebar-right bundle at all', () => {
  const slots = makeSlots();
  applyWith(slots);
  slots.declareAll(['settings.section', ...REMOTE_FLOW_SLOTS]);
  const seats = registeredSeats(slots);
  assert.equal(seats.filter((seat) => seat.startsWith('sidebar.right.')).length, 0);
  assert.ok(seats.includes('settings.section#remote-workspace'));
});

test('dsh-remote file tab title resolves the remote path from the resource address', () => {
  const slots = makeSlots();
  const { ctx } = applyWith(slots);
  const tabTypes = [];
  ctx.provide('sidebarRightTabs', { register: (def) => { tabTypes.push(def); return () => {}; } });
  const fileDef = tabTypes.find((def) => def.id === 'dsh-remote/file');
  const address = 'dsh-resource://dsh-remote/' + encodeURIComponent('sess-1') + '/' + encodeURIComponent('/srv/app/README.md');
  assert.equal(fileDef.title(address), 'README.md');
  assert.equal(typeof fileDef.title('not-a-resource'), 'string');
});

test('remote settings show loading before a successful empty registry', async () => {
  const data = {
    '/api/dsh-remote/machines': { machines: [], currentId: null },
    '/api/dsh-remote/status': { connected: false },
    '/api/dsh-remote/forwards': { forwards: [] },
    '/api/dsh-remote/ssh-config': { entries: [] },
  };
  const requested = [];
  const fixture = remoteSettingsFixture(async (url) => {
    requested.push(url);
    assert.ok(Object.hasOwn(data, url), 'unexpected request: ' + url);
    return { status: 200, json: async () => data[url] };
  });
  const loading = fixture.render();
  assert.match(textContent(elements(loading).find((element) => element.props.role === 'status')), /正在读取/);
  assert.doesNotMatch(textContent(loading), /还没有保存的 SSH 机器/);
  const ready = await fixture.settle();
  assert.equal(elements(ready).some((element) => element.props.role === 'status'), false);
  assert.equal(elements(ready).some((element) => element.props.role === 'alert'), false);
  assert.match(textContent(ready), /还没有保存的 SSH 机器/);
  assert.deepEqual(requested.sort(), Object.keys(data).sort());
});

for (const resource of ['machines', 'status', 'forwards']) {
  test('remote settings expose ' + resource + ' read rejection and recover through reload', async () => {
    let fail = true;
    const data = {
      '/api/dsh-remote/machines': { machines: [{ id: 'canary', name: 'Saved SSH canary', host: 'ssh.example', port: 22, username: 'dev' }], currentId: null },
      '/api/dsh-remote/status': { connected: false },
      '/api/dsh-remote/forwards': { forwards: [] },
      '/api/dsh-remote/ssh-config': { entries: [] },
    };
    const fixture = remoteSettingsFixture(async (url) => {
      assert.ok(Object.hasOwn(data, url), 'unexpected request: ' + url);
      if (fail && url === '/api/dsh-remote/' + resource) {
        return { status: 503, json: async () => ({ error: resource + ' read refused' }) };
      }
      return { status: 200, json: async () => data[url] };
    });
    fixture.render();
    const failed = await fixture.settle();
    const alert = elements(failed).find((element) => element.props.role === 'alert');
    assert.ok(alert, resource + ' failure must stay visible instead of becoming null/empty');
    assert.ok(textContent(alert).includes(resource + ' read refused'));
    assert.doesNotMatch(textContent(failed), /还没有保存的 SSH 机器/);
    const reload = elements(alert).find((element) => typeof element.props.onClick === 'function');
    assert.equal(textContent(reload), '重新读取');
    fail = false;
    reload.props.onClick();
    assert.equal(elements(fixture.render()).some((element) => element.props.role === 'status'), true);
    const recovered = await fixture.settle();
    assert.equal(elements(recovered).some((element) => element.props.role === 'alert'), false);
    assert.match(textContent(recovered), /Saved SSH canary/);
  });
}
