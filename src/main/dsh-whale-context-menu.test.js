'use strict';

// Behavior contracts for right-click context menus across all four dsh-whale surfaces:
// bot sidebar card, group sidebar card, Chats tab row, and sub-chat/worker rows.

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
const vendorRequire = createRequire(path.join(__dirname, '..', '..', 'vendor', 'deepseek-harness', 'package.json'));
const clientRequire = createRequire(path.join(__dirname, '..', '..', 'vendor', 'dsh-im', 'package.json'));
const React = clientRequire('react');
const ReactJsxRuntime = clientRequire('react/jsx-runtime');
const ReactDOM = clientRequire('react-dom');
const { createRoot } = clientRequire('react-dom/client');
const { JSDOM } = HARNESS_DEPS.ok ? vendorRequire('jsdom') : {};
const { act, createElement: h } = React;

function buildFixtures() {
  return {
    botsEnabled: true,
    skipNewHomeChatConfirm: false,
    hideBotCreatedWorkspaces: false,
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
        needsYouCount: 0,
      },
    ],
    groups: [
      {
        id: 'grp-1',
        name: '核心小组',
        members: [{ botId: 'bot-whale' }],
        unread: false,
      },
    ],
    chatsByBot: {
      'bot-whale': {
        botId: 'bot-whale',
        chats: [
          {
            chatId: 'sess-whale-home',
            sessionId: 'sess-whale-home',
            origin: 'home',
            title: 'Home Chat',
            runningTotal: 1,
            running: [{ id: 'w-home-1', title: '主线小弟', state: 'running', sessionId: 'sess-w-home-1' }],
          },
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
    },
    needsYou: {},
    needsYouAt: Date.now(),
  };
}

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
  };
}

function mountWhaleInDom(t) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main></main></body></html>', {
    url: 'http://localhost:3123/',
    pretendToBeVisual: true,
  });
  if (!dom.window.PointerEvent) {
    dom.window.PointerEvent = dom.window.MouseEvent;
  }

  const eventSources = [];
  const fixtures = buildFixtures();
  const FakeEventSource = createFakeEventSourceClass(eventSources);

  const fetchImpl = async (url, init = {}) => {
    const rawUrl = String(url);
    if (!rawUrl.endsWith('/dsh-bots/rpc')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }), text: async () => '<svg></svg>' };
    }
    const body = init.body ? JSON.parse(String(init.body)) : {};
    let result = { ok: true, items: [], chats: [], files: [], requests: [], automations: [], suggestions: [] };
    if (body.method === 'bots.list') {
      result = fixtures;
    } else if (body.method === 'bots.chats.tree' || body.method === 'bots.chatTree') {
      result = fixtures.chatsByBot['bot-whale'];
    } else if (body.method === 'bots.crew.list') {
      result = { crew: [] };
    } else if (body.method === 'bots.voice.state') {
      result = { ok: true, available: false, enabled: false, state: 'unavailable' };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, result }) };
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

  const declared = new Set([
    'sidebar.sections.before',
    'conversation.session.header.leading',
    'conversation.session.header.actions',
    'conversation.hero.frame',
    'main',
    'sidebar.right.pane.tab',
    'settings.pet.item',
    'shell.overlay',
  ]);
  const registrations = [];
  const rightTabs = [];
  const disposers = [];
  const sessions = { list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => {} } };
  const sidebarRight = { openTab() {}, openTabIn: () => true };
  const sidebarRightTabs = {
    register(def) {
      rightTabs.push(def);
      return () => {};
    },
  };
  const services = { sessions, sidebarRight, sidebarRightTabs };
  const ctx = {
    locale: {
      register: () => () => {},
      getLocale: () => ({ active: 'zh-CN' }),
      subscribe: () => () => {},
    },
    layout: { selectPanel() {} },
    settingsNavigation: { open() {}, close() {} },
    sessions,
    sidebarRight,
    sidebarRightTabs,
    slots: {
      spec: (name) => (declared.has(name) ? {} : undefined),
      subscribe: () => () => {},
      inject: (_name, fn) => fn(),
      register(decl, component) {
        registrations.push({ decl, component });
        return () => {};
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
  pluginExports.apply(ctx);

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

  return { dom, root, registrations, rightTabs, flush };
}

async function dispatchRightClick(dom, target, x, y, flush) {
  await act(async () => {
    target.dispatchEvent(new dom.window.PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y,
    }));
    target.dispatchEvent(new dom.window.MouseEvent('mousedown', {
      bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y,
    }));
    target.dispatchEvent(new dom.window.MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y,
    }));
  });
  await flush();
}

async function dispatchLeftDown(dom, target, flush) {
  await act(async () => {
    target.dispatchEvent(new dom.window.PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, button: 0,
    }));
    target.dispatchEvent(new dom.window.MouseEvent('mousedown', {
      bubbles: true, cancelable: true, button: 0,
    }));
  });
  await flush();
}

function observePopoverRemovals(dom) {
  let removedCount = 0;
  const observer = new dom.window.MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.removedNodes) {
        if (node.nodeType === 1 && (node.classList?.contains('dsh-bots-popover') || node.querySelector?.('.dsh-bots-popover'))) {
          removedCount += 1;
        }
      }
    }
  });
  observer.observe(dom.window.document.body, { childList: true, subtree: true });
  return { getCount: () => removedCount, disconnect: () => observer.disconnect() };
}

async function verifyContextMenuSurface(harness, label, getTarget, { checkNoBubble = false } = {}) {
  const { dom, flush } = harness;
  const doc = dom.window.document;
  dom.window.innerWidth = 1400;
  dom.window.innerHeight = 900;

  let target = getTarget();
  assert.ok(target, `${label}: target element must exist`);

  // Close any stale popover first
  await dispatchLeftDown(dom, doc.body, flush);
  assert.equal(doc.querySelectorAll('.dsh-bots-popover').length, 0, `${label}: pre-state clean`);

  let bubbled = 0;
  const onAncestorContext = () => { bubbled += 1; };
  if (checkNoBubble) {
    doc.body.addEventListener('contextmenu', onAncestorContext);
  }

  try {
    await dispatchRightClick(dom, target, 240, 160, flush);
    if (checkNoBubble) {
      assert.equal(bubbled, 0, `${label}: contextmenu must call stopPropagation()`);
    }
    const pop1 = doc.querySelector('.dsh-bots-popover');
    assert.ok(pop1, `${label}: first right-click must open popover`);
    const left1 = Number.parseFloat(pop1.style.left);
    const top1 = Number.parseFloat(pop1.style.top);

    // Repeat right-click on the same trigger: must NOT remove/reopen popover, and must move coordinates.
    const watcher = observePopoverRemovals(dom);
    try {
      target = getTarget();
      await dispatchRightClick(dom, target, 320, 220, flush);
      assert.equal(watcher.getCount(), 0, `${label}: repeated right-click on trigger must not close popover first`);
    } finally {
      watcher.disconnect();
    }
    const popovers = doc.querySelectorAll('.dsh-bots-popover');
    assert.equal(popovers.length, 1, `${label}: exactly one popover must remain open`);
    assert.notEqual(Number.parseFloat(popovers[0].style.left), left1, `${label}: left coordinate must update`);
    assert.notEqual(Number.parseFloat(popovers[0].style.top), top1, `${label}: top coordinate must update`);

    // Left-click on trigger must dismiss popover.
    await dispatchLeftDown(dom, getTarget(), flush);
    assert.equal(doc.querySelectorAll('.dsh-bots-popover').length, 0, `${label}: left-click must close popover`);

    // Narrow viewport clamping keeps left >= 8 and top >= 8.
    dom.window.innerWidth = 120;
    dom.window.innerHeight = 120;
    await dispatchRightClick(dom, getTarget(), 2, 2, flush);
    const narrowPop = doc.querySelector('.dsh-bots-popover');
    assert.ok(narrowPop, `${label}: narrow viewport popover must render`);
    assert.ok(Number.parseFloat(narrowPop.style.left) >= 8, `${label}: left clamped >= 8`);
    assert.ok(Number.parseFloat(narrowPop.style.top) >= 8, `${label}: top clamped >= 8`);
    await dispatchLeftDown(dom, doc.body, flush);
  } finally {
    if (checkNoBubble) {
      doc.body.removeEventListener('contextmenu', onAncestorContext);
    }
  }
}

domTest('all 4 dsh-whale context menu surfaces keep popover mounted on repeated right-click, dismiss on left-click, and clamp >= 8px', async (t) => {
  const harness = mountWhaleInDom(t);
  const { dom, root, registrations, flush } = harness;
  const SidebarComp = registrations.find((r) => r.decl.name === 'sidebar.sections.before')?.component;
  const RightPanelComp = registrations.find((r) => r.decl.name === 'sidebar.right.pane.tab')?.component;
  assert.ok(SidebarComp && RightPanelComp);

  await act(async () => {
    root.render(h('div', null, h(SidebarComp, { wide: true }), h(RightPanelComp, { botId: 'bot-whale' })));
  });
  await flush();

  // Switch right panel to the Chats tab so BotChatsTab rows render alongside sidebar tree rows.
  const chatsTab = [...dom.window.document.querySelectorAll('[role="tab"]')]
    .find((btn) => /对话|Chats/.test(btn.textContent || ''));
  assert.ok(chatsTab, 'Chats tab button must exist');
  await act(async () => { chatsTab.click(); });
  await flush();

  await verifyContextMenuSurface(
    harness,
    'BotSidebarCard',
    () => [...dom.window.document.querySelectorAll('.dsh-bots-card')]
      .find((el) => el.querySelector('.dsh-bots-card-name')?.textContent === '鲸鱼娘'),
  );

  await verifyContextMenuSurface(
    harness,
    'BotGroupSidebarCard',
    () => [...dom.window.document.querySelectorAll('.dsh-bots-card')]
      .find((el) => el.querySelector('.dsh-bots-card-name')?.textContent === '核心小组'),
  );

  await verifyContextMenuSurface(
    harness,
    'BotSubChatList-subrow',
    () => dom.window.document.querySelector('.dsh-bots-subrow'),
  );

  await verifyContextMenuSurface(
    harness,
    'BotSubChatList-worker',
    () => dom.window.document.querySelector('.dsh-bots-worker-row'),
  );

  await verifyContextMenuSurface(
    harness,
    'BotChatsTab-row',
    () => dom.window.document.querySelector('.dsh-bots-chat-row'),
    { checkNoBubble: true },
  );
});
