'use strict';

// Contract tests for the Orca-parity Bots client bundle (`vendor/dsh-whale/client/client.js`).
// Verifies ModuleLoader registration, Harness slot declarations, single-right-sidebar
// integration, desktop pet bridge (`window.__dshWhaleOpen`), live React/DOM component
// contracts, and complete removal of the legacy Big Fish `data-dsh-whale-mode` overlay.

const nodeTest = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { gateTests, harnessDependencies } = require('../../scripts/lib/test-prerequisites.cjs');

const HARNESS_DEPS = harnessDependencies();
const domTest = gateTests(nodeTest, HARNESS_DEPS);

const CLIENT_FILE = path.join(__dirname, '..', '..', 'vendor', 'dsh-whale', 'client', 'client.js');
const PACKAGE_FILE = path.join(__dirname, '..', '..', 'vendor', 'dsh-whale', 'package.json');

const vendorRequire = createRequire(path.join(__dirname, '..', '..', 'vendor', 'deepseek-harness', 'package.json'));
const clientRequire = createRequire(path.join(__dirname, '..', '..', 'vendor', 'dsh-im', 'package.json'));
const React = clientRequire('react');
const ReactJsxRuntime = clientRequire('react/jsx-runtime');
const ReactDOM = clientRequire('react-dom');
const { createRoot } = clientRequire('react-dom/client');
const { JSDOM } = HARNESS_DEPS.ok ? vendorRequire('jsdom') : {};
const { act, createElement: h } = React;

const ALL_SLOT_SPECS = [
  'sidebar.sections.before',
  'conversation.session.header.leading',
  'conversation.session.header.actions',
  'conversation.hero.frame',
  'main',
  'sidebar.right.pane.tab',
  'settings.pet.item',
  'shell.overlay',
];

const settle = async () => {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

function createFakeEventSourceClass(bucket) {
  return class FakeEventSource {
    constructor(url, init) {
      this.url = url;
      this.init = init;
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
    emit(type, event = {}) {
      if (type === 'open') this.readyState = 1;
      if (type === 'error') this.onerror?.(event);
      for (const fn of this.listeners.get(type) ?? []) fn(event);
    }
  };
}

function makeRpcFetch(rpcHandler, rpcCalls) {
  return async (url, init = {}) => {
    const rawUrl = String(url);
    if (rawUrl.endsWith('/dsh-bots/rpc')) {
      const body = init.body ? JSON.parse(String(init.body)) : {};
      rpcCalls.push(body);
      const result = await rpcHandler(body.method, body.params ?? {});
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ ok: true, result }),
      };
    }
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ ok: true, result: {} }),
      text: async () => '<svg></svg>',
    };
  };
}

function defaultBotFixtures() {
  return {
    botsEnabled: true,
    skipNewHomeChatConfirm: false,
    hideBotCreatedWorkspaces: true,
    sidebarProjectsFirst: false,
    petBotId: 'bot-whale',
    bots: [
      {
        id: 'bot-whale',
        name: '鲸鱼娘',
        purpose: '贴身助理',
        avatar: 'whale',
        avatarColor: '#3b82f6',
        paused: false,
        dotState: 'idle',
        homeSessionId: 'sess-whale-home',
        chatSessionId: 'sess-whale-home',
        homePath: 'C:/Users/demo/.whaleisle/bots/bot-whale',
        needsYouCount: 1,
      },
      {
        id: 'bot-paused',
        name: '巡检官',
        purpose: '夜间巡检',
        avatar: 'owl',
        avatarColor: '#8b5cf6',
        paused: true,
        dotState: 'paused',
        homeSessionId: 'sess-paused-home',
        chatSessionId: 'sess-paused-home',
        homePath: 'C:/Users/demo/.whaleisle/bots/bot-paused',
        needsYouCount: 0,
      },
    ],
    groups: [
      {
        id: 'grp-1',
        name: '核心小组',
        members: [{ botId: 'bot-whale' }, { botId: 'bot-paused' }],
        unread: false,
      },
    ],
    chatsByBot: {
      'bot-whale': {
        botId: 'bot-whale',
        chats: [
          { chatId: 'sess-whale-home', sessionId: 'sess-whale-home', origin: 'home', title: 'Home Chat' },
          {
            chatId: 'sess-whale-side',
            sessionId: 'sess-whale-side',
            origin: 'side',
            title: '支线讨论',
            runningTotal: 1,
            running: [{ id: 'w-side-1', title: '调研小弟', state: 'running', sessionId: 'sess-w-side-1' }],
          },
        ],
      },
      'bot-paused': {
        botId: 'bot-paused',
        chats: [
          { chatId: 'sess-paused-home', sessionId: 'sess-paused-home', origin: 'home', title: 'Home Chat' },
        ],
      },
    },
    needsYou: { 'bot-whale': 1 },
    needsYouAt: Date.now(),
  };
}

function loadBotsPluginVm(t, { rpcHandler, documentStub } = {}) {
  const spec = { current: null };
  const eventSources = [];
  const rpcCalls = [];
  const storage = new Map();
  const FakeEventSource = createFakeEventSourceClass(eventSources);
  const fetchImpl = makeRpcFetch(rpcHandler ?? (() => defaultBotFixtures()), rpcCalls);

  const windowObj = {
    innerWidth: 1400,
    innerHeight: 900,
    __ModuleLoader__: {
      load(entry) {
        spec.current = entry;
      },
    },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    EventSource: FakeEventSource,
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener() {},
    removeEventListener() {},
  };

  const docObj = documentStub ?? {
    visibilityState: 'visible',
    documentElement: { dataset: {} },
    head: { appendChild() {} },
    createElement: () => ({ textContent: '' }),
    addEventListener() {},
    removeEventListener() {},
  };

  vm.runInNewContext(
    fs.readFileSync(CLIENT_FILE, 'utf8'),
    {
      window: windowObj,
      document: docObj,
      localStorage: windowObj.localStorage,
      EventSource: FakeEventSource,
      fetch: fetchImpl,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      AbortController,
      URL,
      URLSearchParams,
      console,
    },
    { filename: CLIENT_FILE },
  );

  assert.ok(spec.current, 'client.js must call window.__ModuleLoader__.load(...)');
  assert.equal(spec.current.id, 'dsh-whale');

  const pluginExports = spec.current.factory((id) => {
    if (id === 'react') return React;
    if (id === 'react/jsx-runtime') return ReactJsxRuntime;
    if (id === 'react-dom') return ReactDOM;
    if (id === 'react-dom/client') return { createRoot };
    return {};
  });

  const disposers = [];
  t.after(() => {
    for (const dispose of disposers.splice(0).reverse()) {
      dispose?.();
    }
    for (const es of eventSources) {
      if (!es.closed) es.close();
    }
  });

  return { spec: spec.current, exports: pluginExports, window: windowObj, document: docObj, eventSources, rpcCalls, disposers };
}

function makeHarnessCtx({
  specs = ALL_SLOT_SPECS,
  uiWorkspace = true,
  sessionsOpen = false,
  contextMenus: includeContextMenus = false,
  disposers = [],
} = {}) {
  const declared = new Set(specs);
  const registrations = [];
  const rightTabs = [];
  const contextMenuRegistrations = [];
  const calls = {
    openSession: [],
    sessionsOpen: [],
    selectPanel: [],
    openTab: [],
    openTabIn: [],
    settingsOpen: [],
    settingsClose: 0,
    localeRegistered: [],
  };
  const slotDisposed = [];
  let rightTabDisposed = 0;
  let contextMenuDisposed = 0;

  const sessions = {
    list: {
      getSnapshot: () => ({ byId: {} }),
      subscribe: () => () => {},
    },
    ...(sessionsOpen ? { open: async (id) => { calls.sessionsOpen.push(id); } } : {}),
  };
  const workspace = uiWorkspace
    ? { openSession: async (id) => { calls.openSession.push(id); } }
    : undefined;
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
      return () => { rightTabDisposed += 1; };
    },
  };
  const contextMenus = includeContextMenus
    ? {
      register: (contribution) => {
        contextMenuRegistrations.push(contribution);
        return () => { contextMenuDisposed += 1; };
      },
    }
    : undefined;

  const services = {
    sessions,
    uiWorkspace: workspace,
    sidebarRight,
    sidebarRightTabs,
    ...(contextMenus ? { contextMenus } : {}),
  };

  const ctx = {
    locale: {
      register: (ns, dicts) => {
        calls.localeRegistered.push({ ns, langs: Object.keys(dicts) });
        return () => {};
      },
      getLocale: () => ({ active: 'zh-CN' }),
      subscribe: () => () => {},
    },
    layout: {
      selectPanel: (id) => calls.selectPanel.push(id),
    },
    settingsNavigation: {
      open: (section) => calls.settingsOpen.push(section),
      close: () => { calls.settingsClose += 1; },
    },
    sessions,
    ...(workspace ? { uiWorkspace: workspace } : {}),
    sidebarRight,
    sidebarRightTabs,
    ...(contextMenus ? { contextMenus } : {}),
    slots: {
      spec: (name) => (declared.has(name) ? {} : undefined),
      subscribe: () => () => {},
      inject: (_name, fn) => fn(),
      register: (decl, component) => {
        registrations.push({ decl, component });
        return () => { slotDisposed.push(`${decl.name}:${decl.key ?? decl.id ?? ''}`); };
      },
    },
    get: (key) => services[key],
    inject: (_deps, cb) => {
      cb(ctx);
      return () => {};
    },
    effect: (fn) => {
      const dispose = fn();
      if (typeof dispose === 'function') disposers.push(dispose);
      return () => dispose?.();
    },
  };

  return {
    ctx,
    registrations,
    rightTabs,
    contextMenuRegistrations,
    calls,
    slotDisposed,
    get rightTabDisposed() { return rightTabDisposed; },
    get contextMenuDisposed() { return contextMenuDisposed; },
  };
}

nodeTest('package.json and client.js declare Orca Bots service dependencies and remove legacy Big Fish overlay', (t) => {
  const source = fs.readFileSync(CLIENT_FILE, 'utf8');
  assert.doesNotMatch(source, /data-dsh-whale-mode/, 'legacy data-dsh-whale-mode fullscreen overlay must be removed');
  assert.doesNotMatch(source, /\.dsh-whale-mode-toggle|\.dsh-whale-mode-head/, 'legacy Big Fish mode CSS must be removed');
  assert.doesNotMatch(source, /dsh-whale\.workbench/, 'legacy shell.overlay workbench slot must be removed');

  const manifest = JSON.parse(fs.readFileSync(PACKAGE_FILE, 'utf8'));
  for (const dep of [
    '@deepseek-ai/dsh-client-connection',
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-sidebar',
    '@deepseek-ai/dsh-client-ui-sidebar-right',
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-layout',
    '@deepseek-ai/dsh-client-ui-workspace',
  ]) {
    assert.ok(manifest.dsh.client.inject.includes(dep), `dsh.client.inject must include ${dep}`);
  }

  // Minimal document stub without querySelector or setAttribute must not throw during inline CSS mount.
  const plugin = loadBotsPluginVm(t, {
    documentStub: {
      visibilityState: 'visible',
      documentElement: { dataset: {} },
      head: { appendChild() {} },
      createElement: () => ({ textContent: '' }),
      addEventListener() {},
      removeEventListener() {},
    },
  });
  assert.equal(plugin.exports.name, 'dsh-whale');
  for (const dep of ['slots', 'locale', 'sessions', 'uiWorkspace', 'connection', 'settingsNavigation', 'layout']) {
    assert.ok(plugin.exports.inject.includes(dep), `exports.inject must include ${dep}`);
  }
});

nodeTest('apply(ctx) registers every Orca Bots slot, single right-sidebar tab, BotsModalHost, and cleans up on dispose', (t) => {
  const plugin = loadBotsPluginVm(t);
  const host = makeHarnessCtx({ disposers: plugin.disposers });

  plugin.exports.apply(host.ctx);

  assert.equal(host.calls.localeRegistered.length, 1);
  assert.equal(host.calls.localeRegistered[0].ns, 'dsh-whale');
  assert.deepEqual(host.calls.localeRegistered[0].langs.sort(), ['en', 'zh']);

  const hasSlot = (predicate) => host.registrations.some((r) => predicate(r.decl));
  assert.ok(hasSlot((d) => d.name === 'sidebar.sections.before' && d.id === 'dsh-bots'));
  assert.ok(hasSlot((d) => d.name === 'conversation.session.header.leading'));
  assert.ok(hasSlot((d) => d.name === 'conversation.session.header.actions' && d.id === 'dsh-bots-actions'));
  assert.ok(hasSlot((d) => d.name === 'conversation.hero.frame' && d.id === 'dsh-bots-frame'));
  assert.ok(hasSlot((d) => d.name === 'main' && d.key === 'dsh-bots:group'));
  assert.ok(hasSlot((d) => d.name === 'main' && d.key === 'dsh-bots:settings'));
  assert.ok(hasSlot((d) => d.name === 'main' && d.key === 'whale'));
  assert.ok(hasSlot((d) => d.name === 'sidebar.right.pane.tab' && d.key === 'dsh-whale:bots-panel'));
  assert.ok(hasSlot((d) => d.name === 'settings.pet.item' && d.id === 'whale'));
  assert.ok(hasSlot((d) => d.name === 'shell.overlay' && d.id === 'dsh-bots.modals'));

  // Legacy slots must NOT be registered.
  assert.equal(hasSlot((d) => d.name === 'sidebar.panellist'), false);
  assert.equal(hasSlot((d) => d.name === 'sidebar.footer.action'), false);
  assert.equal(hasSlot((d) => d.name === 'shell.overlay' && d.id === 'dsh-whale.workbench'), false);

  // Single native right sidebar tab contract.
  assert.equal(host.rightTabs.length, 1);
  assert.equal(host.rightTabs[0].id, 'dsh-whale:bots-panel');
  assert.equal(host.rightTabs[0].kind, 'dsh-bots');
  assert.equal(host.rightTabs[0].priority, 'extension');
  assert.equal(host.rightTabs[0].keepMounted, true);

  // Desktop pet jump bridge and hand-to-bot / draft bridges are installed.
  assert.equal(typeof plugin.window.__dshWhaleOpen, 'function');
  assert.equal(typeof plugin.window.__dshWhaleHandToBot, 'function');
  assert.equal(typeof plugin.window.__DSH_BOTS_HAS_UNSAVED_DRAFT__, 'function');

  // Calling all disposers cleans up slots, right tab, SSE, and window bridges.
  for (const dispose of plugin.disposers.splice(0).reverse()) {
    dispose?.();
  }
  assert.equal(plugin.window.__dshWhaleOpen, undefined);
  assert.equal(plugin.window.__dshWhaleHandToBot, undefined);
  assert.equal(plugin.window.__DSH_BOTS_HAS_UNSAVED_DRAFT__, undefined);
  assert.equal(host.rightTabDisposed, 1);
  assert.ok(host.slotDisposed.length >= 10);
  assert.ok(plugin.eventSources.every((es) => es.closed));
});

nodeTest('window.__dshWhaleOpen opens bound pet bot via uiWorkspace, falls back to sessions.open, and opens new-bot modal when empty', async (t) => {
  // 1. uiWorkspace host opens petBotId's Home Chat and clears panel.
  {
    const fixtures = defaultBotFixtures();
    const plugin = loadBotsPluginVm(t, {
      rpcHandler: (method, params) => {
        if (method === 'bots.list') return fixtures;
        if (method === 'bots.chat.open') return { sessionId: params.botId === 'bot-whale' ? 'sess-whale-home' : 'sess-other' };
        return { ok: true };
      },
    });
    const host = makeHarnessCtx({ disposers: plugin.disposers });
    plugin.exports.apply(host.ctx);
    const sid = await plugin.window.__dshWhaleOpen();
    await settle();
    assert.equal(sid, 'sess-whale-home');
    assert.deepEqual(host.calls.openSession, ['sess-whale-home']);
    assert.deepEqual(host.calls.selectPanel, [null]);
    assert.deepEqual(host.calls.sessionsOpen, []);
  }

  // 2. Pre-0.1.6 host without uiWorkspace falls back to sessions.open.
  {
    const fixtures = defaultBotFixtures();
    const plugin = loadBotsPluginVm(t, {
      rpcHandler: (method) => {
        if (method === 'bots.list') return fixtures;
        if (method === 'bots.chat.open') return { sessionId: 'sess-whale-home' };
        return { ok: true };
      },
    });
    const host = makeHarnessCtx({ uiWorkspace: false, sessionsOpen: true, disposers: plugin.disposers });
    plugin.exports.apply(host.ctx);
    const sid = await plugin.window.__dshWhaleOpen();
    await settle();
    assert.equal(sid, 'sess-whale-home');
    assert.deepEqual(host.calls.sessionsOpen, ['sess-whale-home']);
    assert.deepEqual(host.calls.selectPanel, [null]);
  }

  // 3. When no bots exist, __dshWhaleOpen returns null and clears panel (opening new-bot modal).
  {
    const plugin = loadBotsPluginVm(t, {
      rpcHandler: (method) => {
        if (method === 'bots.list') return { bots: [], groups: [], chatsByBot: {}, needsYou: {} };
        return { ok: true };
      },
    });
    const host = makeHarnessCtx({ disposers: plugin.disposers });
    plugin.exports.apply(host.ctx);
    const sid = await plugin.window.__dshWhaleOpen();
    await settle();
    assert.equal(sid, null);
    assert.deepEqual(host.calls.selectPanel, [null]);
  }
});

domTest('Orca Bots components render sidebar, conversation header/frame, global settings, legacy redirect, and BotsModalHost in JSDOM', async (t) => {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main></main></body></html>', {
    url: 'http://localhost:3123/',
    pretendToBeVisual: true,
  });

  const eventSources = [];
  const rpcCalls = [];
  const FakeEventSource = createFakeEventSourceClass(eventSources);
  const fixtures = defaultBotFixtures();
  const fetchImpl = makeRpcFetch((method, params) => {
    if (method === 'bots.list') return fixtures;
    if (method === 'bots.chat.open') return { sessionId: 'sess-whale-home' };
    if (method === 'bots.settings.set') {
      Object.assign(fixtures, params);
      return { ok: true };
    }
    if (method === 'bots.update') {
      const target = fixtures.bots.find((b) => b.id === params.botId);
      if (target) Object.assign(target, params);
      return { bot: target };
    }
    if (method === 'bots.agentChoices') return { models: [] };
    return { ok: true, items: [], chats: [], files: [], requests: [], automations: [], suggestions: [] };
  }, rpcCalls);

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
    fs.readFileSync(CLIENT_FILE, 'utf8'),
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
    { filename: CLIENT_FILE },
  );

  const pluginExports = spec.factory((id) => {
    if (id === 'react') return React;
    if (id === 'react/jsx-runtime') return ReactJsxRuntime;
    if (id === 'react-dom') return ReactDOM;
    if (id === 'react-dom/client') return { createRoot };
    return {};
  });

  const disposers = [];
  const host = makeHarnessCtx({ disposers });
  pluginExports.apply(host.ctx);

  const root = createRoot(dom.window.document.querySelector('main'));
  t.after(async () => {
    await act(async () => root.unmount());
    for (const dispose of disposers.splice(0).reverse()) {
      dispose?.();
    }
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

  await flush();

  // Inline CSS mounted idempotently into document.head (all 4 stylesheets in order).
  const styleTags = dom.window.document.head.querySelectorAll('style[data-dsh-whale-style]');
  const styleIds = [...styleTags].map((el) => el.getAttribute('data-dsh-whale-style'));
  assert.equal(styleTags.length, 4, 'all 4 bots stylesheets must be mounted with data-dsh-whale-style');
  assert.deepEqual(styleIds, [
    'src/client/styles/bots.css',
    'src/client/styles/bots-panels.css',
    'src/client/styles/bots-enhancements.css',
    'src/client/styles/bots-group-enhancements.css',
  ]);

  const slotComp = (predicate) => host.registrations.find((r) => predicate(r.decl))?.component;
  const SidebarComp = slotComp((d) => d.name === 'sidebar.sections.before');
  const LeadingComp = slotComp((d) => d.name === 'conversation.session.header.leading');
  const ActionsComp = slotComp((d) => d.name === 'conversation.session.header.actions');
  const FrameComp = slotComp((d) => d.name === 'conversation.hero.frame');
  const SettingsComp = slotComp((d) => d.name === 'settings.pet.item');
  const OverlayComp = slotComp((d) => d.name === 'shell.overlay' && d.id === 'dsh-bots.modals');
  const LegacyWhaleComp = slotComp((d) => d.name === 'main' && d.key === 'whale');

  await act(async () => {
    root.render(h('div', null,
      h(SidebarComp, { wide: true }),
      h('section', { id: 'bot-header' },
        h(LeadingComp, { sessionId: 'sess-whale-home' }),
        h(ActionsComp, { sessionId: 'sess-whale-home' }),
      ),
      h('section', { id: 'normal-header' },
        h(LeadingComp, { sessionId: 'ordinary-session-1' }),
        h(ActionsComp, { sessionId: 'ordinary-session-1' }),
      ),
      h('section', { id: 'paused-frame' },
        h(FrameComp, {
          useSessions: (sel) => sel({ byId: { 'sess-paused-home': { id: 'sess-paused-home', retainedBy: { mainView: 1 } } } }),
        }, h('span', { className: 'inner-hero' }, 'PausedBody')),
      ),
      h('section', { id: 'normal-frame' },
        h(FrameComp, {
          useSessions: (sel) => sel({ byId: { 'ordinary-session-1': { id: 'ordinary-session-1', retainedBy: { mainView: 1 } } } }),
        }, h('span', { className: 'inner-hero' }, 'NormalBody')),
      ),
      h('section', { id: 'global-settings' }, h(SettingsComp, {})),
      h(OverlayComp, {}),
    ));
  });
  await flush();

  // Sidebar renders bots: multi-chat bot expands tree without parent-child double highlight;
  // single-chat bot omits redundant Home Chat subrow and fold button.
  assert.match(dom.window.document.body.textContent, /鲸鱼娘/);
  const cards = [...dom.window.document.querySelectorAll('.dsh-bots-card-wrap')].map((wrap) => ({
    name: wrap.querySelector('.dsh-bots-card-name')?.textContent,
    card: wrap.querySelector('.dsh-bots-card'),
    foldBtn: wrap.querySelector('.dsh-bots-card-fold-btn'),
    sublist: wrap.querySelector('.dsh-bots-sublist'),
  }));
  const whaleCard = cards.find((c) => c.name === '鲸鱼娘');
  const pausedCard = cards.find((c) => c.name === '巡检官');
  assert.ok(whaleCard?.foldBtn && whaleCard?.sublist, 'multi-chat bot must keep fold toggle and sublist');
  assert.equal(pausedCard?.foldBtn, null, 'single-chat bot must omit redundant fold button');
  assert.equal(pausedCard?.sublist, null, 'single-chat bot must omit redundant Home Chat subrow');
  assert.equal(pausedCard?.card?.getAttribute('data-active'), 'true', 'single-chat active bot highlights its own row');

  // Switch active selection to multi-chat bot and verify parent stays unlit while active subrow highlights.
  await act(async () => { whaleCard.card.click(); });
  await flush();
  assert.equal(whaleCard.card.getAttribute('data-active'), 'false');
  assert.equal(whaleCard.card.getAttribute('data-has-active-child'), 'true');
  assert.ok(whaleCard.sublist.querySelector('.dsh-bots-subrow[data-active="true"]'));

  const waitFrames = async (ms = 60) => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
    await flush();
  };

  // Smooth disclosure checks: section header, bot sublist card, and sub-chat workers rotate a single chevron and animate 0fr <-> 1fr.
  const workerDisclosure = whaleCard.sublist.querySelector('.dsh-bots-workers-disclosure');
  const workerChevron = whaleCard.sublist.querySelector('.dsh-bots-subrow .dsh-bots-icon-btn-sm .dsh-bots-chevron');
  const workerFoldBtn = workerChevron?.closest('button');
  assert.ok(workerDisclosure && workerChevron && workerFoldBtn);
  assert.equal(workerDisclosure.getAttribute('data-state'), 'open');
  assert.equal(workerChevron.getAttribute('data-open'), 'true');
  await act(async () => { workerFoldBtn.click(); });
  await flush();
  assert.equal(workerChevron.getAttribute('data-open'), 'false');
  assert.equal(workerDisclosure.getAttribute('data-state'), 'closed');
  const workerFoldMetaBtn = whaleCard.sublist.querySelector('.dsh-bots-subrow-fold-meta');
  assert.ok(workerFoldMetaBtn, 'folded worker summary must render clickable .dsh-bots-subrow-fold-meta button');
  await act(async () => { workerFoldMetaBtn.click(); });
  await waitFrames();
  assert.equal(workerChevron.getAttribute('data-open'), 'true');
  assert.equal(whaleCard.sublist.querySelector('.dsh-bots-workers-disclosure')?.getAttribute('data-state'), 'open');

  const botChevron = whaleCard.foldBtn.querySelector('.dsh-bots-chevron');
  const botDisclosure = whaleCard.foldBtn.closest('.dsh-bots-card-wrap')?.querySelector('.dsh-bots-sublist-disclosure');
  assert.ok(botChevron && botDisclosure);
  assert.equal(botChevron.getAttribute('data-open'), 'true');
  assert.equal(botDisclosure.getAttribute('data-state'), 'open');
  await act(async () => { whaleCard.foldBtn.click(); });
  await flush();
  assert.equal(botChevron.getAttribute('data-open'), 'false');
  assert.equal(botDisclosure.getAttribute('data-state'), 'closed');
  await act(async () => { whaleCard.foldBtn.click(); });
  await waitFrames();
  assert.equal(botChevron.getAttribute('data-open'), 'true');
  assert.equal(whaleCard.foldBtn.closest('.dsh-bots-card-wrap')?.querySelector('.dsh-bots-sublist-disclosure')?.getAttribute('data-state'), 'open');

  const sectionToggle = dom.window.document.querySelector('.dsh-bots-header-toggle');
  const sectionChevron = sectionToggle?.querySelector('.dsh-bots-chevron');
  const sectionDisclosure = dom.window.document.querySelector('.dsh-bots-section-disclosure');
  assert.ok(sectionToggle && sectionChevron && sectionDisclosure);
  assert.equal(sectionChevron.getAttribute('data-open'), 'true');
  assert.equal(sectionDisclosure.getAttribute('data-state'), 'open');
  await act(async () => { sectionToggle.click(); });
  await flush();
  assert.equal(sectionChevron.getAttribute('data-open'), 'false');
  assert.equal(sectionDisclosure.getAttribute('data-state'), 'closed');
  await waitFrames(40);
  assert.ok(dom.window.document.querySelector('.dsh-bots-preview-wrap .dsh-bots-preview-strip'), 'collapsed preview strip renders while section is collapsed');
  await act(async () => { sectionToggle.click(); });
  await waitFrames();
  assert.equal(sectionChevron.getAttribute('data-open'), 'true');
  assert.equal(dom.window.document.querySelector('.dsh-bots-section-disclosure')?.getAttribute('data-state'), 'open');

  // Leading header pill renders compact chat switcher dropdown & smooth-reveal labels.
  const leadingEl = dom.window.document.querySelector('#bot-header [data-dsh-bots-conv-leading="bot-whale"]');
  assert.ok(leadingEl);
  assert.ok(dom.window.document.querySelector('#bot-header [data-dsh-bots-conv-actions="bot-whale"]'));
  assert.equal(dom.window.document.querySelector('#normal-header').children.length, 0, 'ordinary sessions must remain untouched');
  const leadingPill = leadingEl.querySelector('.dsh-bots-conv-pill');
  assert.ok(leadingPill);
  assert.ok(leadingPill.querySelector('.dsh-bots-reveal-label'));
  await act(async () => { leadingPill.click(); });
  await flush();
  const sideChatMenuItem = [...leadingEl.querySelectorAll('.dsh-bots-pmenu [role="menuitemradio"]')]
    .find((btn) => btn.textContent?.includes('支线讨论'));
  assert.ok(sideChatMenuItem, 'dropdown menu must list bot chats');
  await act(async () => { sideChatMenuItem.click(); });
  await flush();
  assert.ok(host.calls.openSession.includes('sess-whale-side'));

  // Aggregated actions toolbar houses home, pause, settings (removed duplicate chats/files buttons).
  const botActions = dom.window.document.querySelector('#bot-header [data-dsh-bots-conv-actions="bot-whale"]');
  const toolbar = botActions.querySelector('.dsh-bots-conv-toolbar');
  assert.ok(toolbar);
  assert.ok(toolbar.querySelector('[data-dsh-bots-conv-action="home"]'));
  assert.ok(toolbar.querySelector('.dsh-bots-reveal-slot [data-dsh-bots-conv-action="pause"]'));
  assert.ok(toolbar.querySelector('.dsh-bots-reveal-slot [data-dsh-bots-conv-action="settings"]'));
  assert.equal(toolbar.querySelector('[data-dsh-bots-conv-action="chats"]'), null);
  assert.equal(toolbar.querySelector('[data-dsh-bots-conv-action="files"]'), null);

  // Tokenized translucent styling contract: zero solid active gray, zero raw hex/rgb/ms/theme branches.
  const inlineCssText = [...styleTags].map((el) => el.textContent).join('\n');
  assert.doesNotMatch(inlineCssText, /--dsw-specific-sidebar-nav-item-active/);
  assert.doesNotMatch(inlineCssText, /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\b\d+ms\b|data-ds-dark-theme|prefers-color-scheme|webkit-scrollbar/);
  assert.match(inlineCssText, /\.dsh-bots-conv-pill\b/);
  assert.match(inlineCssText, /\.dsh-bots-conv-toolbar\b/);
  assert.match(inlineCssText, /\.dsh-bots-reveal-slot\b/);
  assert.match(inlineCssText, /grid-template-columns:\s*0fr/);
  assert.match(inlineCssText, /\.dsh-bots-disclosure\b[\s\S]*grid-template-rows:\s*1fr/);
  assert.match(inlineCssText, /\.dsh-bots-disclosure\[data-state=['"]closed['"]\][\s\S]*grid-template-rows:\s*0fr/);
  assert.match(inlineCssText, /\.dsh-bots-chevron\[data-open=['"]true['"]\][\s\S]*rotate\(90deg\)/);
  assert.match(inlineCssText, /\.dsh-bots-popover\[data-motion=['"]presence['"]\]/);
  assert.match(inlineCssText, /:root\[data-dsh-minimal\]/);
  assert.match(inlineCssText, /var\(--ds-transition-duration\)/);
  assert.match(inlineCssText, /\.dsh-bots-panel-tab\[aria-selected=['"]true['"]\]::after/);

  // Conversation frame shows paused banner only for paused bots, never for ordinary sessions.
  assert.ok(dom.window.document.querySelector('#paused-frame .dsh-bots-paused-banner'));
  assert.equal(dom.window.document.querySelector('#normal-frame .dsh-bots-paused-banner'), null);

  // Clicking a conversation header action opens the native right sidebar tab (single right panel).
  const homeActionBtn = dom.window.document.querySelector('#bot-header [data-dsh-bots-conv-actions="bot-whale"] button');
  assert.ok(homeActionBtn);
  await act(async () => { homeActionBtn.click(); });
  await flush();
  assert.ok(host.calls.openTabIn.some((c) => c.kind === 'dsh-bots' && c.opts?.expand === true));

  // GlobalBotsSettings toggles send bots.settings.set RPC and sync dataset attribute.
  const settingsRoot = dom.window.document.querySelector('#global-settings [data-dsh-bots-global-settings]');
  assert.ok(settingsRoot);
  const switches = settingsRoot.querySelectorAll('button[role="switch"]');
  assert.equal(switches.length, 3);
  await act(async () => { switches[2].click(); });
  await flush();
  assert.ok(rpcCalls.some((c) => c.method === 'bots.settings.set' && c.params?.hideBotCreatedWorkspaces === false));
  assert.equal(dom.window.document.documentElement.dataset.dshHideBotWorkspaces, undefined);

  // Legacy 'whale' main panel redirects cleanly to the default bot session.
  await act(async () => {
    root.render(h('div', null, h(LegacyWhaleComp, {}), h(OverlayComp, {})));
  });
  await flush();
  assert.ok(host.calls.openSession.includes('sess-whale-home'));
  assert.equal(dom.window.document.documentElement.hasAttribute('data-dsh-whale-mode'), false);
});

domTest('Wave 2 wiring: HandToBotDialog, workspace context menu, prefill/flash events, subchat actions, and Group workbench', async (t) => {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main><div data-dsh-composer="true"><textarea id="host-composer"></textarea></div><div id="mount"></div></main></body></html>', {
    url: 'http://localhost:3123/',
    pretendToBeVisual: true,
  });

  const eventSources = [];
  const rpcCalls = [];
  const FakeEventSource = createFakeEventSourceClass(eventSources);
  const fixtures = defaultBotFixtures();
  const fetchImpl = makeRpcFetch((method, params) => {
    if (method === 'bots.list') return fixtures;
    if (method === 'bots.chat.open') return { sessionId: 'sess-whale-home' };
    if (method === 'bots.chatTree') return fixtures.chatsByBot[params.botId] ?? { chats: [] };
    if (method === 'bots.takeOver') {
      return { ok: true, botId: params.botId, sessionId: 'sess-handed-1', cwd: params.cwd };
    }
    if (method === 'bots.chat.delete') return { ok: true };
    if (method === 'bots.work.stop') return { ok: true };
    if (method === 'bots.groups.items') {
      return {
        items: [
          {
            uid: 'item-grp-1',
            number: 7,
            botId: 'bot-whale',
            title: '群内发布确认',
            status: 'needs_you',
            groupId: 'grp-1',
            updatedAt: Date.now(),
          },
        ],
        counts: { total: 1, open: 1, needsYou: 1, byBot: { 'bot-whale': { open: 1, needsYou: 1, total: 1 } } },
      };
    }
    if (method === 'bots.groups.read') {
      return {
        group: fixtures.groups[0],
        messages: [
          {
            id: 'msg-1',
            sequence: 1,
            text: '请同步一下进度',
            turns: [
              {
                botId: 'bot-whale',
                status: 'replying',
                reply: '检查完成，请看 **关键结果**',
                startedAt: Date.now() - 2000,
              },
            ],
            createdAt: Date.now(),
          },
        ],
      };
    }
    if (method === 'bots.groups.stop') return { ok: true };
    if (method === 'bots.upNext.list') {
      const nowTs = Date.now();
      return {
        seenAt: nowTs - 10_000,
        openSuggestions: [
          {
            id: 'sug-open-unread',
            title: '新发现的未读建议',
            why: '需要核查构建日志',
            status: 'open',
            createdAt: nowTs - 2_000,
          },
          {
            id: 'sug-open-read',
            title: '已读的历史开放建议',
            why: '此前已经看过',
            status: 'open',
            createdAt: nowTs - 60_000,
          },
        ],
        suggestions: [
          {
            id: 'sug-open-unread',
            title: '新发现的未读建议',
            status: 'open',
            createdAt: nowTs - 2_000,
          },
          {
            id: 'sug-open-read',
            title: '已读的历史开放建议',
            status: 'open',
            createdAt: nowTs - 60_000,
          },
          {
            id: 'sug-started',
            title: '已启动的历史建议不应渲染',
            status: 'started',
            createdAt: nowTs - 1_000,
          },
          {
            id: 'sug-dismissed',
            title: '已忽略的历史建议不应渲染',
            status: 'dismissed',
            createdAt: nowTs - 1_000,
          },
          {
            id: 'sug-replaced',
            title: '已替换的历史建议不应渲染',
            status: 'replaced',
            createdAt: nowTs - 1_000,
          },
        ],
      };
    }
    if (method === 'bots.upNext.seen' || method === 'bots.upNext.unseen') return { ok: true };
    if (method === 'bots.agentChoices') return { models: [] };
    return { ok: true, items: [], chats: [], files: [], requests: [], automations: [], suggestions: [] };
  }, rpcCalls);

  const globalValues = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    HTMLInputElement: dom.window.HTMLInputElement,
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
    fs.readFileSync(CLIENT_FILE, 'utf8'),
    {
      window: dom.window,
      document: dom.window.document,
      localStorage: dom.window.localStorage,
      sessionStorage: dom.window.sessionStorage,
      Event: dom.window.Event,
      CustomEvent: dom.window.CustomEvent,
      HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
      HTMLInputElement: dom.window.HTMLInputElement,
      EventSource: FakeEventSource,
      fetch: fetchImpl,
      setTimeout: dom.window.setTimeout.bind(dom.window),
      clearTimeout: dom.window.clearTimeout.bind(dom.window),
      setInterval: dom.window.setInterval.bind(dom.window),
      clearInterval: dom.window.clearInterval.bind(dom.window),
      queueMicrotask,
      AbortController,
      URL,
      URLSearchParams,
      console,
    },
    { filename: CLIENT_FILE },
  );

  const pluginExports = spec.factory((id) => {
    if (id === 'react') return React;
    if (id === 'react/jsx-runtime') return ReactJsxRuntime;
    if (id === 'react-dom') return ReactDOM;
    if (id === 'react-dom/client') return { createRoot };
    return {};
  });

  const disposers = [];
  const host = makeHarnessCtx({ contextMenus: true, disposers });
  pluginExports.apply(host.ctx);

  const root = createRoot(dom.window.document.querySelector('#mount'));
  t.after(async () => {
    await act(async () => root.unmount());
    for (const dispose of disposers.splice(0).reverse()) {
      dispose?.();
    }
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

  await flush();

  // Workspace context menu contribution registered cleanly.
  const wsContrib = host.contextMenuRegistrations.find((c) => c.id === 'dsh-whale.workspace.hand-to-bot');
  assert.ok(wsContrib && wsContrib.target === 'workspace');
  const resolvedActions = wsContrib.resolve({ workspaceId: 'ws-demo', path: 'C:/repo/demo', displayTitle: 'demo-app' });
  assert.equal(resolvedActions.length, 1);

  const slotComp = (predicate) => host.registrations.find((r) => predicate(r.decl))?.component;
  const SidebarComp = slotComp((d) => d.name === 'sidebar.sections.before');
  const RightPanelComp = slotComp((d) => d.name === 'sidebar.right.pane.tab');
  const GroupRoomComp = slotComp((d) => d.name === 'main' && d.key === 'dsh-bots:group');
  const OverlayComp = slotComp((d) => d.name === 'shell.overlay' && d.id === 'dsh-bots.modals');

  await act(async () => {
    root.render(h('div', null,
      h(SidebarComp, { wide: true }),
      h('section', { id: 'right-panel-host' }, h(RightPanelComp, {})),
      h('section', { id: 'group-room-host' }, h(GroupRoomComp, {})),
      h(OverlayComp, {}),
    ));
  });
  await flush();

  // 1. Trigger HandToBotDialog via workspace context menu run() and submit bots.takeOver.
  await act(async () => { resolvedActions[0].run(); });
  await flush();
  const handDialog = dom.window.document.querySelector('[data-dsh-bots-hand-dialog="true"]');
  assert.ok(handDialog, 'HandToBotDialog must mount inside BotsModalHost');
  assert.match(handDialog.textContent, /demo-app/);
  assert.match(handDialog.textContent, /C:\/repo\/demo/);

  const newSideBtn = [...handDialog.querySelectorAll('.dsh-bots-seg-btn')][1];
  const goalInput = handDialog.querySelector('#dsh-bots-hand-goal');
  const confirmBtn = handDialog.querySelector('.dsh-bots-modal-footer button[data-variant="primary"]');
  assert.ok(newSideBtn && goalInput && confirmBtn);
  await act(async () => { newSideBtn.click(); });
  await act(async () => {
    const propsKey = Object.keys(goalInput).find((k) => k.startsWith('__reactProps$'));
    assert.ok(propsKey, 'textarea must expose React props');
    goalInput[propsKey].onChange({ target: { value: '检查测试并整理待办' } });
  });
  await flush();
  assert.equal(goalInput.value, '检查测试并整理待办');
  await act(async () => { confirmBtn.click(); });
  await flush();

  const takeOverCall = rpcCalls.find((c) => c.method === 'bots.takeOver');
  assert.ok(takeOverCall, 'Confirming HandToBotDialog must invoke bots.takeOver');
  assert.equal(takeOverCall.params.botId, 'bot-whale');
  assert.equal(takeOverCall.params.cwd, 'C:/repo/demo');
  assert.equal(takeOverCall.params.title, 'demo-app');
  assert.equal(takeOverCall.params.chat, 'new');
  assert.equal(takeOverCall.params.prompt, '检查测试并整理待办');
  assert.ok(host.calls.openSession.includes('sess-handed-1'));

  // 2. Trigger HandToBotDialog via global event `dsh-bots:hand-to-bot` and jump to NewBotDialog.
  await act(async () => {
    dom.window.dispatchEvent(new dom.window.CustomEvent('dsh-bots:hand-to-bot', {
      detail: { cwd: 'C:/repo/alpha', name: 'Alpha', initialPrompt: '接管 Alpha' },
    }));
  });
  await flush();
  const handDialog2 = dom.window.document.querySelector('[data-dsh-bots-hand-dialog="true"]');
  assert.ok(handDialog2);
  const createNewBtn = handDialog2.querySelector('.dsh-bots-hand-create-btn');
  assert.ok(createNewBtn);
  await act(async () => { createNewBtn.click(); });
  await flush();
  assert.equal(dom.window.document.querySelector('[data-dsh-bots-hand-dialog="true"]'), null);
  const newBotInput = dom.window.document.querySelector('.dsh-bots-modal input[type="text"]');
  assert.ok(newBotInput && newBotInput.value === 'Alpha', 'NewBotDialog should receive prefilled workspace name');

  // Close NewBotDialog via Escape.
  await act(async () => {
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
  });
  await flush();

  // 3. Global events: prefill-chat-draft & flash-chat-pane.
  const hostComposer = dom.window.document.querySelector('#host-composer');
  await act(async () => {
    dom.window.dispatchEvent(new dom.window.CustomEvent('dsh-bots:prefill-chat-draft', {
      detail: { botId: 'bot-whale', sessionId: 'sess-whale-home', text: '每天早上9点巡检' },
    }));
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  await flush();
  assert.equal(dom.window.sessionStorage.getItem('dsh-bots.prefillDraft:bot-whale'), '每天早上9点巡检');
  assert.equal(hostComposer.value, '每天早上9点巡检');

  await act(async () => {
    dom.window.dispatchEvent(new dom.window.CustomEvent('dsh-bots:flash-chat-pane', {
      detail: { botId: 'bot-whale', sessionId: 'sess-whale-home' },
    }));
  });
  await flush();
  assert.ok(dom.window.document.querySelector('main').classList.contains('dsh-bots-pane-rim-flash'));

  // 4. BotSubChatList '...' menu protects Home Chat and deletes Side Chat via bots.chat.delete.
  const subrows = [...dom.window.document.querySelectorAll('.dsh-bots-subrow')];
  assert.ok(subrows.length >= 2);
  const homeMoreBtn = subrows[0].querySelector('.dsh-bots-subrow-more-btn');
  const sideMoreBtn = subrows[1].querySelector('.dsh-bots-subrow-more-btn');
  assert.ok(homeMoreBtn && sideMoreBtn);
  await act(async () => { homeMoreBtn.click(); });
  await flush();
  const homeDeleteBtn = dom.window.document.querySelector('.dsh-bots-chat-row-menu .dsh-bots-menu-item-danger');
  assert.ok(homeDeleteBtn && homeDeleteBtn.disabled, 'Home Chat delete menu item must be disabled');

  await act(async () => { sideMoreBtn.click(); });
  await flush();
  const sideDeleteBtn = dom.window.document.querySelector('.dsh-bots-chat-row-menu .dsh-bots-menu-item-danger');
  assert.ok(sideDeleteBtn && !sideDeleteBtn.disabled, 'Side Chat delete menu item must be enabled');
  await act(async () => { sideDeleteBtn.click(); });
  await flush();
  assert.ok(rpcCalls.some((c) => c.method === 'bots.chat.delete' && c.params?.botId === 'bot-whale' && c.params?.sessionId === 'sess-whale-side'));

  // 4.5 Up Next real backend contract: filters out started/dismissed/replaced and derives unread from seenAt.
  const rightPanelHost = dom.window.document.querySelector('#right-panel-host');
  assert.ok(rightPanelHost);
  assert.match(rightPanelHost.textContent, /新发现的未读建议/);
  assert.match(rightPanelHost.textContent, /已读的历史开放建议/);
  assert.doesNotMatch(rightPanelHost.textContent, /已启动的历史建议不应渲染/);
  assert.doesNotMatch(rightPanelHost.textContent, /已忽略的历史建议不应渲染/);
  assert.doesNotMatch(rightPanelHost.textContent, /已替换的历史建议不应渲染/);
  const upNextCards = [...rightPanelHost.querySelectorAll('.dsh-bots-pcard[data-unread]')];
  const unreadCard = upNextCards.find((card) => card.textContent?.includes('新发现的未读建议'));
  const readCard = upNextCards.find((card) => card.textContent?.includes('已读的历史开放建议'));
  assert.equal(unreadCard?.getAttribute('data-unread'), 'true', 'createdAt > seenAt must be marked unread');
  assert.equal(readCard?.getAttribute('data-unread'), 'false', 'createdAt <= seenAt must be marked read');
  const markReadBtn = unreadCard?.querySelector('button[title="标为已读"], button[title="Mark as read"]');
  assert.ok(markReadBtn, 'unread Up Next card must expose mark-as-read button');
  await act(async () => { markReadBtn.click(); });
  await flush();
  assert.ok(rpcCalls.some((c) => c.method === 'bots.upNext.seen' && c.params?.id === 'sug-open-unread'));

  // 5. Group workbench in RightPanel + GroupRoomView safe Markdown & Stop RPC.
  const groupCard = [...dom.window.document.querySelectorAll('.dsh-bots-card')]
    .find((card) => card.querySelector('.dsh-bots-card-name')?.textContent === '核心小组');
  assert.ok(groupCard, 'Group card must render in sidebar');
  await act(async () => { groupCard.click(); });
  await flush();
  assert.ok(rpcCalls.some((c) => c.method === 'bots.groups.items' && c.params?.groupId === 'grp-1'));
  assert.match(dom.window.document.querySelector('#right-panel-host').textContent, /群内发布确认/);
  assert.ok(dom.window.document.querySelector('#group-room-host strong')?.textContent === '关键结果', 'GroupRoomView should render safe Markdown bold nodes');
  const stopBtn = [...dom.window.document.querySelectorAll('#group-room-host button')]
    .find((btn) => /停止|Stop/i.test(btn.textContent || ''));
  assert.ok(stopBtn, 'Active group turn must expose Stop button');
  await act(async () => { stopBtn.click(); });
  await flush();
  assert.ok(rpcCalls.some((c) => c.method === 'bots.groups.stop' && c.params?.groupId === 'grp-1'));

  // 6. Disposing unregisters workspace context menu and global bridges cleanly.
  for (const dispose of disposers.splice(0).reverse()) {
    dispose?.();
  }
  assert.equal(host.contextMenuDisposed, 1);
  assert.equal(dom.window.__dshWhaleHandToBot, undefined);
});
