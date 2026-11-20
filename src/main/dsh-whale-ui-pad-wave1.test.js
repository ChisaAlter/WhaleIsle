'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const WHALE_CLIENT = path.join(ROOT, 'vendor', 'dsh-whale', 'client', 'client.js');
const PAD_CLIENT = path.join(ROOT, 'vendor', 'dsh-pad', 'lib', 'client.js');

const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve));
};

function findElement(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  const kids = Array.isArray(node.children)
    ? node.children
    : (Array.isArray(node.props?.children) ? node.props.children : (node.props?.children ? [node.props.children] : []));
  for (const child of kids.flat(Infinity)) {
    const hit = findElement(child, predicate);
    if (hit) return hit;
  }
  return null;
}

function loadWhaleClient({
  stateful = true,
  matchMediaMatches = false,
  sessionsList = [],
  onModalLayer,
  pickWorkspaceDirectory,
} = {}) {
  const spec = { current: null };
  const storage = new Map();
  const docAttrs = new Map();
  const docStyles = new Map();
  const document = {
    hidden: false,
    documentElement: {
      dataset: {},
      setAttribute: (k, v) => docAttrs.set(k, String(v)),
      removeAttribute: (k) => docAttrs.delete(k),
      getAttribute: (k) => (docAttrs.has(k) ? docAttrs.get(k) : null),
      hasAttribute: (k) => docAttrs.has(k),
      style: {
        setProperty: (k, v) => docStyles.set(k, String(v)),
        removeProperty: (k) => docStyles.delete(k),
      },
    },
    getElementById: () => null,
    querySelector: () => null,
    createElement: () => ({ style: {}, setAttribute() {}, remove() {} }),
    head: { appendChild() {} },
    addEventListener() {},
    removeEventListener() {},
  };
  const window = {
    innerWidth: matchMediaMatches ? 780 : 1400,
    innerHeight: 900,
    __ModuleLoader__: { load: (entry) => { spec.current = entry; } },
    matchMedia: () => ({
      matches: matchMediaMatches,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }),
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: (cb) => { cb(); return 1; },
    cancelAnimationFrame() {},
    shell: pickWorkspaceDirectory ? { pickWorkspaceDirectory } : undefined,
    confirm: () => false,
  };
  vm.runInNewContext(
    fs.readFileSync(WHALE_CLIENT, 'utf8'),
    { window, document, localStorage: window.localStorage, MutationObserver: class { observe() {} disconnect() {} }, console },
    { filename: WHALE_CLIENT },
  );
  assert.ok(spec.current);

  const states = [];
  const refs = [];
  const effects = [];
  let c = 0;
  let rc = 0;
  let ec = 0;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (init) => {
      if (!stateful) return [typeof init === 'function' ? init() : init, () => {}];
      const i = c++;
      if (!(i in states)) states[i] = typeof init === 'function' ? init() : init;
      return [states[i], (v) => { states[i] = typeof v === 'function' ? v(states[i]) : v; }];
    },
    useEffect: (fn, deps) => {
      if (!stateful) return fn();
      const i = ec++;
      const prev = effects[i];
      if (prev && deps?.every((v, k) => Object.is(v, prev.deps?.[k]))) return;
      prev?.cleanup?.();
      effects[i] = { deps, cleanup: fn() };
    },
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useRef: (v) => {
      if (!stateful) return { current: v };
      const i = rc++;
      if (!(i in refs)) refs[i] = { current: v };
      return refs[i];
    },
    Fragment: Symbol('Fragment'),
  };
  const modalLayerCalls = [];
  const primitives = {
    useModalLayer: (opts) => {
      modalLayerCalls.push(opts);
      onModalLayer?.(opts);
    },
    useSessions: () => ({
      byId: Object.fromEntries(sessionsList.map((row) => [row.id, row])),
      list: sessionsList,
    }),
    Button: (props) => ({ type: 'Button', props, children: props.children ? [props.children] : [] }),
    Modal: (props) => ({ type: 'Modal', props, children: props.children ? [props.children] : [] }),
    Toast: (props) => ({ type: 'Toast', props, children: [] }),
    Input: (props) => ({ type: 'Input', props, children: [] }),
    Spinner: (props) => ({ type: 'Spinner', props, children: [] }),
  };
  const exports = spec.current.factory((name) => {
    if (name === 'react') return react;
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
    return {};
  });
  return {
    exports,
    window,
    document,
    docAttrs,
    docStyles,
    storage,
    modalLayerCalls,
    resetState: () => { states.length = 0; refs.length = 0; effects.length = 0; },
    render: (component, props) => {
      c = 0; rc = 0; ec = 0;
      return component(props);
    },
  };
}

function makeWhaleCtx({ rpcImpl, specs = ['shell.overlay', 'settings.pet.item', 'conversation.session.header.actions', 'sidebar.panellist', 'main'] } = {}) {
  const registrations = [];
  const calls = { openSession: [], selectPanel: [], rpc: [] };
  const ctx = {
    locale: { register: () => () => {}, bind: () => (k) => k },
    effect: (fn) => { fn(); return () => {}; },
    connection: {
      rpc: {
        call: async (prefix, endpoint, input) => {
          calls.rpc.push({ prefix, endpoint, input });
          if (rpcImpl) return { result: { value: await rpcImpl(endpoint, input) } };
          if (endpoint === 'assistant/ensure') return { result: { value: { sessionId: 'whale-resident' } } };
          return { result: { value: { name: '鲸鱼娘', sessionId: 'whale-resident', taskRootDir: 'C:\\Users\\demo\\WhaleTasks', bigFishEnabled: false, bigFishPrompted: true, bigFishTab: 'panel' } } };
        },
      },
    },
    uiWorkspace: { openSession: async (id) => { calls.openSession.push(id); } },
    layout: { selectPanel: (id) => { calls.selectPanel.push(id); } },
    slots: {
      spec: (name) => specs.includes(name),
      subscribe: () => () => {},
      inject: (name, fn) => { if (specs.includes(name)) fn(); },
      register: (decl, component) => { registrations.push({ decl, component }); return () => {}; },
      has: () => false,
    },
  };
  return { ctx, registrations, calls };
}

test('whale client removes Proactive shell, preserves relative claude-isle-head.png, and satisfies CSS/React18/button contracts', () => {
  const src = fs.readFileSync(WHALE_CLIENT, 'utf8');
  assert.doesNotMatch(src, /whale-inbox|whale-outbox|WhaleOperations|WhaleOpsCard|proactiveDispatch/);
  assert.match(src, /["']claude-isle-head\.png["']/);
  assert.doesNotMatch(src, /["']\/claude-isle-head\.png["']/);
  assert.doesNotMatch(src, /iconOnly\s*:\s*true/);
  assert.match(src, /dsh-whale-icon-btn/);
  assert.match(src, /inert\s*:\s*["']{2}/);
  assert.match(src, /@container\s*\(max-width:\s*390px\)/);
  assert.match(src, /padding-right:\s*0\s*!important/);
  assert.match(src, /\.dsh-project-task-rail/);
  assert.match(src, /data-dsh-whale-dragging/);
  assert.match(src, /html\[data-platform="darwin"\]\[data-fullscreen\]/);
  assert.match(src, /data-window-drag-exclude/);
  assert.match(src, /dsh-whale-danger-button/);
  assert.match(src, /rgb\(from var\(--dsw-specific-sidebar-fill\) r g b \/ 1\)/);
  // At least 3 primary modal buttons (onboarding, task editor Save, task confirm primary)
  const primaryMatches = src.match(/variant:\s*["']primary["']/g) ?? [];
  assert.ok(primaryMatches.length >= 3, `expected >= 3 primary modal buttons, found ${primaryMatches.length}`);
});

test('WhaleSettings exposes taskRootDir input/picker/reset and updates mode.taskRootDir & name', async () => {
  const pickedDir = 'D:\\MyIsolatedTasks';
  const plugin = loadWhaleClient({
    pickWorkspaceDirectory: async () => pickedDir,
  });
  let serverSettings = {
    name: '鲸鱼娘',
    taskRootDir: 'C:\\Users\\demo\\WhaleTasks',
    imDefault: true,
    bigFishEnabled: false,
    bigFishPrompted: true,
  };
  const updates = [];
  const { ctx, registrations } = makeWhaleCtx({
    rpcImpl: async (endpoint, input) => {
      if (endpoint === 'settings/update') {
        updates.push(input);
        serverSettings = { ...serverSettings, ...input };
      }
      return { ...serverSettings };
    },
  });
  plugin.exports.apply(ctx);
  const settingsSlot = registrations.find((r) => r.decl.name === 'settings.pet.item');
  assert.ok(settingsSlot);
  const rpc = async (endpoint, input) => {
    const res = await ctx.connection.rpc.call('/dsh-whale', endpoint, input);
    return res.result.value;
  };
  const props = { t: (k) => k, rpc };
  plugin.render(settingsSlot.component, props);
  await settle();
  let tree = plugin.render(settingsSlot.component, props);

  const taskRootInput = findElement(tree, (n) => n.props?.['aria-label'] === 'field.taskRootDir');
  assert.ok(taskRootInput, 'settings must render taskRootDir input');
  assert.equal(taskRootInput.props.value, 'C:\\Users\\demo\\WhaleTasks');

  const pickBtn = findElement(tree, (n) => typeof n.props?.onClick === 'function' && n.children?.includes('field.taskRootDirPick'));
  assert.ok(pickBtn, 'settings must render directory picker button when window.shell.pickWorkspaceDirectory exists');
  await pickBtn.props.onClick();
  await settle();
  assert.equal(updates.at(-1)?.taskRootDir, pickedDir);

  tree = plugin.render(settingsSlot.component, props);
  const resetBtn = findElement(tree, (n) => typeof n.props?.onClick === 'function' && n.children?.includes('field.taskRootDirReset'));
  assert.ok(resetBtn);
  await resetBtn.props.onClick();
  await settle();
  assert.equal(updates.at(-1)?.taskRootDir, '');
});

test('createBigFish hydrates on boot, coalesces concurrent settings/update, gates WhaleHeaderGear, and wires narrow useModalLayer', async () => {
  const plugin = loadWhaleClient({
    matchMediaMatches: true,
    sessionsList: [
      { id: 'whale-resident', title: '鲸鱼娘', retainedBy: { mainView: 0 } },
      { id: 'other-session', title: '重构任务', retainedBy: { mainView: 1 } },
    ],
  });
  let serverSettings = {
    name: '小鲸鱼',
    sessionId: 'whale-resident',
    taskRootDir: 'D:\\SafeTasks',
    bigFishEnabled: true,
    bigFishPrompted: true,
    bigFishTab: 'panel',
  };
  let inflight = 0;
  let maxInflight = 0;
  const { ctx, registrations } = makeWhaleCtx({
    rpcImpl: async (endpoint, input) => {
      if (endpoint === 'settings/update') {
        inflight += 1;
        maxInflight = Math.max(maxInflight, inflight);
        await new Promise((r) => setTimeout(r, 15));
        serverSettings = { ...serverSettings, ...input };
        inflight -= 1;
      }
      if (endpoint === 'assistant/ensure') return { sessionId: 'whale-resident' };
      return { ...serverSettings };
    },
  });
  plugin.exports.apply(ctx);
  await settle();

  // WhaleHeaderGear returns null while big-fish mode is active (hydrated true).
  const gearSlot = registrations.find((r) => r.decl.name === 'conversation.session.header.actions');
  assert.ok(gearSlot);
  const overlaySlot = registrations.find((r) => r.decl.name === 'shell.overlay');
  assert.ok(overlaySlot);

  // Render overlay in narrow mode while active -> useModalLayer must be called & back-to-whale shown for other-session.
  const face = overlaySlot.decl.inject();
  const overlayTree = plugin.render(overlaySlot.component, {
    ...face,
    t: (k, a) => (a ? `${k}:${JSON.stringify(a)}` : k),
    renderSlot: () => null,
  });
  assert.ok(plugin.modalLayerCalls.length >= 1, 'narrow drawer must use useModalLayer');
  const aside = findElement(overlayTree, (n) => n.type === 'aside');
  assert.ok(aside, 'overlay must render aside');
  assert.equal(aside.props.tabIndex, -1);

  // Concurrent mode.tab calls must serialize (maxInflight === 1).
  await Promise.all([face.mode.tab('task'), face.mode.tab('panel'), face.mode.tab('task')]);
  assert.equal(maxInflight, 1, 'settings/update queue must serialize concurrent writes');
  assert.equal(serverSettings.bigFishTab, 'task');

  plugin.resetState();
  const gearWhenActive = plugin.render(gearSlot.component, { ...gearSlot.decl.inject(), t: (k) => k });
  assert.equal(gearWhenActive, null, 'WhaleHeaderGear must hide when Big Fish mode is active');
});

test('dsh-pad embeddedMode suppresses Dock reserve/announce/watchIds, PanelCard captures Escape, and WhalePanels preserves draft on unavailable', (t) => {
  const padSrc = fs.readFileSync(PAD_CLIENT, 'utf8');
  assert.match(padSrc, /setEmbeddedMode/);
  assert.match(padSrc, /embeddedMode/);
  assert.match(padSrc, /dsh-whale:pad-display/);
  assert.match(padSrc, /data-ds-dark-theme/);
  assert.match(padSrc, /data-dsh-skin/);
  assert.match(padSrc, /addEventListener\("keydown",\s*onKey,\s*true\)/);
  assert.match(padSrc, /(?:event|e)\.preventDefault\(\);\s*(?:event|e)\.stopPropagation\(\)/);
  assert.match(padSrc, /variant:\s*"primary"/);
  assert.match(padSrc, /onDraftInserted/);
  assert.match(padSrc, /MenuIcon\.up/);
  assert.match(padSrc, /MenuIcon\.down/);

  // Runtime test of PadClient embeddedMode inside vm (mirroring dsh-pad-ball.test.js).
  const storage = new Map();
  storage.set('dsh-pad:layout', JSON.stringify({ expanded: true, width: 320, dock: { x: 100, y: 100 } }));
  let factory;
  const docProps = new Map();
  const window = {
    innerWidth: 1400,
    innerHeight: 900,
    addEventListener() {},
    removeEventListener() {},
    __ModuleLoader__: { load: (entry) => { factory = entry.factory; } },
  };
  const document = {
    documentElement: {
      classList: { toggle() {}, add() {}, remove() {} },
      style: {
        setProperty: (k, v) => docProps.set(k, String(v)),
        removeProperty: (k) => docProps.delete(k),
      },
      setAttribute() {},
      removeAttribute() {},
    },
    head: { appendChild() {} },
    createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
  };
  const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  };
  vm.runInContext(padSrc, vm.createContext({
    window,
    document,
    localStorage,
    console,
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    matchMedia: () => ({ addEventListener() {}, removeEventListener() {} }),
    MutationObserver: class { observe() {} disconnect() {} },
  }));
  const effectCleanups = [];
  t.after(() => { for (const cleanup of effectCleanups) cleanup(); });
  const react = {
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useRef: (v) => ({ current: v }),
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useEffect: (fn) => { const c = fn(); if (typeof c === 'function') effectCleanups.push(c); },
    useSyncExternalStore: (_sub, snap) => snap(),
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    Component: class { constructor(props) { this.props = props; } },
    Fragment: Symbol('Fragment'),
  };
  const jsx = (type, props) => ({ type, props });
  const pad = factory((name) => ({
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: react.Fragment },
    '@deepseek-ai/dsh-client-ui-primitives': {
      Button: (p) => ({ type: 'Button', props: p }),
      Modal: (p) => ({ type: 'Modal', props: p }),
      Toast: (p) => ({ type: 'Toast', props: p }),
    },
  })[name]);

  const slots = [];
  pad.apply({
    locale: { register: () => () => {} },
    effect() {},
    slots: {
      inject: (_n, fn) => fn(),
      register: (meta, comp) => { slots.push({ meta, comp }); return () => {}; },
    },
  });
  const whalePanelsSlot = slots.find((s) => s.meta.id === 'dsh-pad.whale');
  const dockSlot = slots.find((s) => s.meta.id === 'dsh-pad');
  assert.ok(whalePanelsSlot && dockSlot);

  // Mounting WhalePanels turns on embeddedMode -> Dock reserve MUST be 0 (not 320px from stored layout)!
  whalePanelsSlot.comp({ t: (k) => k });
  const Dock = dockSlot.comp({ t: (k) => k }).props.children[0].type;
  Dock({ t: (k) => k });
  assert.equal(docProps.get('--dshpad-reserve'), '0px');
  for (const cleanup of effectCleanups) cleanup();
});
