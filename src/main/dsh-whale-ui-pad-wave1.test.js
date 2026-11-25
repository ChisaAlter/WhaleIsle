'use strict';

const nodeTest = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { gateTests, harnessDependencies } = require('../../scripts/lib/test-prerequisites.cjs');

const HARNESS_DEPS = harnessDependencies();
const domTest = gateTests(nodeTest, HARNESS_DEPS);

const ROOT = path.resolve(__dirname, '..', '..');
const WHALE_CLIENT = path.join(ROOT, 'vendor', 'dsh-whale', 'client', 'client.js');
const PAD_CLIENT = path.join(ROOT, 'vendor', 'dsh-pad', 'lib', 'client.js');

const vendorRequire = createRequire(path.join(ROOT, 'vendor', 'deepseek-harness', 'package.json'));
const clientRequire = createRequire(path.join(ROOT, 'vendor', 'dsh-im', 'package.json'));
const React = clientRequire('react');
const ReactJsxRuntime = clientRequire('react/jsx-runtime');
const ReactDOM = clientRequire('react-dom');
const { createRoot } = clientRequire('react-dom/client');
const { JSDOM } = HARNESS_DEPS.ok ? vendorRequire('jsdom') : {};
const { act, createElement: h } = React;

function createFakeEventSourceClass(bucket) {
  return class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.listeners = new Map();
      this.closed = false;
      bucket.push(this);
    }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(fn);
    }
    removeEventListener(type, fn) {
      this.listeners.get(type)?.delete(fn);
    }
    close() {
      this.closed = true;
      this.readyState = 2;
    }
  };
}

function mountBotsClientInDom(t, { rpcHandler }) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main></main></body></html>', {
    url: 'http://localhost:3123/',
    pretendToBeVisual: true,
  });

  const eventSources = [];
  const rpcCalls = [];
  const FakeEventSource = createFakeEventSourceClass(eventSources);
  const fetchImpl = async (url, init = {}) => {
    const rawUrl = String(url);
    if (rawUrl.endsWith('/dsh-bots/rpc')) {
      const body = init.body ? JSON.parse(String(init.body)) : {};
      rpcCalls.push(body);
      const result = await rpcHandler(body.method, body.params ?? {});
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ ok: true, result }) };
    }
    return { ok: true, status: 200, statusText: 'OK', json: async () => ({ ok: true, result: {} }), text: async () => '<svg></svg>' };
  };

  const globalValues = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
    EventSource: FakeEventSource,
    fetch: fetchImpl,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const savedGlobals = Object.fromEntries(
    Object.keys(globalValues).map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]),
  );
  for (const [k, v] of Object.entries(globalValues)) {
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: v });
  }

  let spec = null;
  dom.window.__ModuleLoader__ = { load: (entry) => { spec = entry; } };
  dom.window.EventSource = FakeEventSource;
  dom.window.fetch = fetchImpl;

  vm.runInNewContext(
    fs.readFileSync(WHALE_CLIENT, 'utf8'),
    {
      window: dom.window,
      document: dom.window.document,
      localStorage: dom.window.localStorage,
      EventSource: FakeEventSource,
      fetch: fetchImpl,
      setTimeout: dom.window.setTimeout.bind(dom.window),
      clearTimeout: dom.window.clearTimeout.bind(dom.window),
      setInterval: dom.window.setInterval.bind(dom.window),
      clearInterval: dom.window.clearInterval.bind(dom.window),
      AbortController,
      URL,
      URLSearchParams,
      CustomEvent: dom.window.CustomEvent,
      console,
    },
    { filename: WHALE_CLIENT },
  );
  assert.ok(spec, 'dsh-whale client must register via __ModuleLoader__.load');

  const pluginExports = spec.factory((name) => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return ReactJsxRuntime;
    if (name === 'react-dom') return ReactDOM;
    if (name === 'react-dom/client') return { createRoot };
    return {};
  });

  const disposers = [];
  const registrations = [];
  const rightTabs = [];
  const calls = { openSession: [], selectPanel: [], openTab: [], openTabIn: [] };
  const specs = new Set([
    'sidebar.sections.before',
    'conversation.session.header.leading',
    'conversation.session.header.actions',
    'conversation.hero.frame',
    'main',
    'sidebar.right.pane.tab',
    'settings.pet.item',
    'shell.overlay',
  ]);
  const sidebarRight = {
    openTab: (kind, opts) => calls.openTab.push({ kind, opts }),
    openTabIn: (sid, kind, opts) => {
      calls.openTabIn.push({ sid, kind, opts });
      return true;
    },
  };
  const sidebarRightTabs = {
    register: (def) => {
      rightTabs.push(def);
      return () => {};
    },
  };
  const ctx = {
    locale: {
      register: () => () => {},
      getLocale: () => ({ active: 'zh-CN' }),
      subscribe: () => () => {},
    },
    sessions: { list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => {} } },
    uiWorkspace: { openSession: async (id) => { calls.openSession.push(id); } },
    layout: { selectPanel: (id) => { calls.selectPanel.push(id); } },
    settingsNavigation: { open: () => {}, close: () => {} },
    sidebarRight,
    sidebarRightTabs,
    slots: {
      spec: (name) => (specs.has(name) ? {} : undefined),
      subscribe: () => () => {},
      inject: (_name, fn) => fn(),
      register: (decl, component) => {
        registrations.push({ decl, component });
        return () => {};
      },
    },
    get: (name) => ({ sidebarRight, sidebarRightTabs, uiWorkspace: ctx.uiWorkspace, sessions: ctx.sessions })[name],
    inject: (_deps, fn) => { fn(ctx); return () => {}; },
    effect: (fn) => {
      const dispose = fn();
      if (typeof dispose === 'function') disposers.push(dispose);
      return () => dispose?.();
    },
  };

  pluginExports.apply(ctx);
  const root = createRoot(dom.window.document.querySelector('main'));
  t.after(async () => {
    await act(async () => root.unmount());
    for (const dispose of disposers.splice(0).reverse()) dispose?.();
    for (const es of eventSources) {
      if (!es.closed) es.close();
    }
    dom.window.close();
    for (const [k, desc] of Object.entries(savedGlobals)) {
      if (desc) Object.defineProperty(globalThis, k, desc);
      else delete globalThis[k];
    }
  });

  const flush = async () => {
    for (let i = 0; i < 6; i += 1) {
      await act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
    }
  };

  return { dom, root, flush, registrations, rightTabs, calls, rpcCalls, eventSources };
}

nodeTest('whale client removes legacy Proactive and Big Fish overlays, keeps Bots CSS layering, and decouples from dsh-pad', () => {
  const src = fs.readFileSync(WHALE_CLIENT, 'utf8');
  assert.doesNotMatch(src, /whale-inbox|whale-outbox|WhaleOperations|WhaleOpsCard|proactiveDispatch/);
  assert.doesNotMatch(src, /data-dsh-whale-mode|\.dsh-whale-mode-toggle|dsh-whale\.workbench/);
  assert.doesNotMatch(src, /dsh-whale:pad-display|--dshpad-reserve/, 'Bots client must stay decoupled from dsh-pad dock layout');

  assert.match(src, /\.dsh-bots-section/);
  assert.match(src, /\.dsh-bots-card/);
  assert.match(src, /\.dsh-bots-pcard/);
  assert.match(src, /\.dsh-bots-panel-root/);
  assert.match(src, /dshHideBotWorkspaces/);
  assert.match(src, /sidebarProjectsFirst/);

  const backdropZ = /\.dsh-bots-backdrop\s*\{[^}]*z-index:\s*(\d+)/.exec(src);
  const popoverZ = /\.dsh-bots-popover\s*\{[^}]*z-index:\s*(\d+)/.exec(src);
  assert.ok(backdropZ && popoverZ, 'Bots CSS must declare explicit z-index for backdrop and popover');
  assert.ok(Number(popoverZ[1]) > Number(backdropZ[1]), `popover z-index (${popoverZ[1]}) must sit above modal backdrop (${backdropZ[1]})`);
});

domTest('GlobalBotsSettings exposes global switches and desktop-pet bound bot selector via bots.settings.set', async (t) => {
  const state = {
    botsEnabled: true,
    skipNewHomeChatConfirm: false,
    hideBotCreatedWorkspaces: true,
    sidebarProjectsFirst: false,
    petBotId: 'bot-1',
    bots: [
      { id: 'bot-1', name: '鲸鱼娘', avatar: 'whale', avatarColor: '#3b82f6', homeSessionId: 's1', chatSessionId: 's1' },
      { id: 'bot-2', name: '代码评审官', avatar: 'owl', avatarColor: '#8b5cf6', homeSessionId: 's2', chatSessionId: 's2' },
    ],
    groups: [],
    chatsByBot: {},
    needsYou: {},
  };
  const updates = [];
  const mounted = mountBotsClientInDom(t, {
    rpcHandler: (method, params) => {
      if (method === 'bots.list') return state;
      if (method === 'bots.settings.set') {
        updates.push(params);
        Object.assign(state, params);
        return { ok: true };
      }
      return { ok: true };
    },
  });
  await mounted.flush();

  const settingsSlot = mounted.registrations.find((r) => r.decl.name === 'settings.pet.item');
  assert.ok(settingsSlot, 'settings.pet.item slot must be registered');

  await act(async () => {
    mounted.root.render(h(settingsSlot.component, {}));
  });
  await mounted.flush();

  const rootEl = mounted.dom.window.document.querySelector('[data-dsh-bots-global-settings]');
  assert.ok(rootEl, 'GlobalBotsSettings root must render');
  const switches = rootEl.querySelectorAll('button[role="switch"]');
  assert.equal(switches.length, 4);
  assert.equal(mounted.dom.window.document.documentElement.dataset.dshHideBotWorkspaces, 'true');

  // Toggle "Hide bot-created workspaces" off -> RPC bots.settings.set + dataset removed.
  await act(async () => { switches[2].click(); });
  await mounted.flush();
  assert.equal(updates.at(-1)?.hideBotCreatedWorkspaces, false);
  assert.equal(mounted.dom.window.document.documentElement.dataset.dshHideBotWorkspaces, undefined);

  // Switch desktop pet bound bot -> RPC bots.settings.set({ petBotId: 'bot-2' }).
  const select = rootEl.querySelector('select');
  assert.ok(select, 'GlobalBotsSettings must render desktop pet bot selector');
  assert.equal(select.value, 'bot-1');
  const setter = Object.getOwnPropertyDescriptor(mounted.dom.window.HTMLSelectElement.prototype, 'value').set;
  await act(async () => {
    setter.call(select, 'bot-2');
    select.dispatchEvent(new mounted.dom.window.Event('change', { bubbles: true }));
  });
  await mounted.flush();
  assert.equal(updates.at(-1)?.petBotId, 'bot-2');
});

domTest('Bots client mounts single native right-sidebar tab and lightweight BotsModalHost without a second right sidebar or overlay drawer', async (t) => {
  const fixtures = {
    botsEnabled: true,
    hideBotCreatedWorkspaces: true,
    petBotId: 'bot-whale',
    bots: [
      { id: 'bot-whale', name: '鲸鱼娘', avatar: 'whale', avatarColor: '#3b82f6', homeSessionId: 'sess-whale', chatSessionId: 'sess-whale', needsYouCount: 2 },
    ],
    groups: [],
    chatsByBot: {
      'bot-whale': {
        botId: 'bot-whale',
        chats: [{ chatId: 'sess-whale', sessionId: 'sess-whale', origin: 'home', title: 'Home Chat' }],
      },
    },
    needsYou: { 'bot-whale': 2 },
  };

  const mounted = mountBotsClientInDom(t, {
    rpcHandler: (method) => (method === 'bots.list' ? fixtures : { ok: true, items: [], chats: [], files: [], requests: [], automations: [], suggestions: [] }),
  });
  await mounted.flush();

  // Single native right-sidebar tab registration (no custom overlay sidebar).
  assert.equal(mounted.rightTabs.length, 1);
  assert.equal(mounted.rightTabs[0].id, 'dsh-whale:bots-panel');
  assert.equal(mounted.rightTabs[0].kind, 'dsh-bots');

  const overlaySlot = mounted.registrations.find((r) => r.decl.name === 'shell.overlay');
  assert.ok(overlaySlot);
  assert.equal(overlaySlot.decl.id, 'dsh-bots.modals');

  const actionsSlot = mounted.registrations.find((r) => r.decl.name === 'conversation.session.header.actions');
  assert.ok(actionsSlot);

  await act(async () => {
    mounted.root.render(h('div', null,
      h(actionsSlot.component, { sessionId: 'sess-whale' }),
      h(overlaySlot.component, {}),
    ));
  });
  await mounted.flush();

  // Overlay renders no <aside> drawer and sets no fullscreen data-dsh-whale-mode attribute.
  assert.equal(mounted.dom.window.document.querySelector('aside'), null);
  assert.equal(mounted.dom.window.document.documentElement.hasAttribute('data-dsh-whale-mode'), false);

  // Clicking conversation header Home/Chats/Files buttons opens the single native right tab.
  const actionButtons = mounted.dom.window.document.querySelectorAll('[data-dsh-bots-conv-actions="bot-whale"] button');
  assert.ok(actionButtons.length >= 3);
  await act(async () => { actionButtons[0].click(); });
  await mounted.flush();
  assert.ok(mounted.calls.openTabIn.some((call) => call.sid === 'sess-whale' && call.kind === 'dsh-bots' && call.opts?.expand === true));
});

nodeTest('dsh-pad embeddedMode suppresses Dock reserve/announce/watchIds, PanelCard captures Escape, and WhalePanels preserves draft on unavailable', (t) => {
  const padSrc = fs.readFileSync(PAD_CLIENT, 'utf8');
  assert.match(padSrc, /setEmbeddedMode/);
  assert.match(padSrc, /embeddedMode/);
  assert.match(padSrc, /dsh-whale:pad-display/);
  assert.match(padSrc, /data-ds-dark-theme/);
  assert.match(padSrc, /data-dsh-skin/);
  assert.match(padSrc, /addEventListener\("keydown",\s*onKey,\s*(?:true|\{\s*capture:\s*true\s*\})\)/);
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
    getElementById: () => null,
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
    ResizeObserver: class { observe() {} disconnect() {} },
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
    useLayoutEffect: (fn) => { const c = fn(); if (typeof c === 'function') effectCleanups.push(c); },
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
    effect(fn, label) {
      if (label !== 'dsh-pad: stream') {
        const cleanup = fn();
        if (typeof cleanup === 'function') effectCleanups.push(cleanup);
      }
    },
    slots: {
      inject: (_n, fn) => fn(),
      entries: () => [],
      onEntryError: () => () => {},
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

nodeTest('Bots client portals modals into document.body and stays decoupled from dsh-pad floating dock', () => {
  const whaleSrc = fs.readFileSync(WHALE_CLIENT, 'utf8');
  const padSrc = fs.readFileSync(PAD_CLIENT, 'utf8');
  assert.match(whaleSrc, /createPortal/);
  assert.match(whaleSrc, /sidebarRightTabs/);
  assert.doesNotMatch(whaleSrc, /dsh-pad|dshpad/i, 'dsh-whale Bots client must stay independent of dsh-pad');
  assert.match(padSrc, /createPortal\(focusOverlay,\s*document\.body\)/);
});
