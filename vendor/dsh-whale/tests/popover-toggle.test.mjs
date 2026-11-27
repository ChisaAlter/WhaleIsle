// Regression tests for popovers and dropdown menus in `vendor/dsh-whale/client/client.js`.
// Verifies realistic browser pointer/mouse sequences (pointerdown -> mousedown -> mouseup -> click),
// ensuring clicking an already-open menu's trigger toggles it closed rather than closing on
// pointerdown/mousedown and immediately reopening on click.

import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CLIENT_FILE = path.join(REPO_ROOT, 'vendor', 'dsh-whale', 'client', 'client.js');

const require = createRequire(import.meta.url);
const { gateTests, harnessDependencies } = require(path.join(REPO_ROOT, 'scripts', 'lib', 'test-prerequisites.cjs'));

const HARNESS_DEPS = harnessDependencies();
const domTest = gateTests(nodeTest, HARNESS_DEPS);

const vendorRequire = createRequire(path.join(REPO_ROOT, 'vendor', 'deepseek-harness', 'package.json'));
const clientRequire = createRequire(path.join(REPO_ROOT, 'vendor', 'dsh-im', 'package.json'));
const { JSDOM } = HARNESS_DEPS.ok ? vendorRequire('jsdom') : {};

let cachedReactModules = null;
function loadReactModules() {
  if (!cachedReactModules) {
    const React = clientRequire('react');
    const ReactJsxRuntime = clientRequire('react/jsx-runtime');
    const ReactDOM = clientRequire('react-dom');
    const { createRoot } = clientRequire('react-dom/client');
    cachedReactModules = {
      React,
      ReactJsxRuntime,
      ReactDOM,
      createRoot,
      act: React.act,
      h: React.createElement,
    };
  }
  return cachedReactModules;
}

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

function defaultFixtures() {
  return {
    botsEnabled: true,
    skipNewHomeChatConfirm: false,
    hideBotCreatedWorkspaces: true,
    sidebarProjectsFirst: false,
    petBotId: 'bot-whale',
    botSidebarView: {
      sortBy: 'smart',
      hidePausedBots: false,
      hideSleepingWorkers: false,
    },
    bots: [
      {
        id: 'bot-whale',
        name: '鲸鱼娘',
        purpose: '贴身助理',
        avatar: 'mascot:W1',
        avatarColor: '#3b82f6',
        paused: false,
        dotState: 'idle',
        homeSessionId: 'sess-whale-home',
        chatSessionId: 'sess-whale-home',
        homePath: 'C:/Users/demo/.whaleisle/bots/bot-whale',
        needsYouCount: 0,
      },
      {
        id: 'bot-scout',
        name: '巡检官',
        purpose: '夜间巡检',
        avatar: 'mascot:A1',
        avatarColor: '#8b5cf6',
        paused: false,
        dotState: 'idle',
        homeSessionId: 'sess-scout-home',
        chatSessionId: 'sess-scout-home',
        homePath: 'C:/Users/demo/.whaleisle/bots/bot-scout',
        needsYouCount: 0,
      },
    ],
    groups: [],
    chatsByBot: {
      'bot-whale': {
        botId: 'bot-whale',
        chats: [
          { chatId: 'sess-whale-home', sessionId: 'sess-whale-home', origin: 'home', title: 'Home Chat' },
          { chatId: 'sess-whale-side', sessionId: 'sess-whale-side', origin: 'side', title: '支线讨论' },
          { chatId: 'sess-whale-work', sessionId: 'sess-whale-work', origin: 'work', title: 'Worker · repo' },
        ],
      },
      'bot-scout': {
        botId: 'bot-scout',
        chats: [
          { chatId: 'sess-scout-home', sessionId: 'sess-scout-home', origin: 'home', title: 'Home Chat' },
        ],
      },
    },
    needsYou: {},
    needsYouAt: Date.now(),
  };
}

function makeHarnessCtx(disposers) {
  const declared = new Set(ALL_SLOT_SPECS);
  const registrations = [];
  const calls = { openSession: [] };
  const services = {
    sessions: {
      list: {
        getSnapshot: () => ({ byId: {} }),
        subscribe: () => () => {},
      },
    },
    uiWorkspace: { openSession: async (id) => { calls.openSession.push(id); } },
    sidebarRight: { openTab: () => {}, openTabIn: () => true },
    sidebarRightTabs: { register: () => () => {} },
  };
  const ctx = {
    locale: {
      register: () => () => {},
      getLocale: () => ({ active: 'zh-CN' }),
      subscribe: () => () => {},
    },
    layout: { selectPanel: () => {} },
    settingsNavigation: { open: () => {}, close: () => {} },
    ...services,
    slots: {
      spec: (name) => (declared.has(name) ? {} : undefined),
      subscribe: () => () => {},
      inject: (_name, fn) => fn(),
      register: (decl, component) => {
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
  return { ctx, registrations, calls };
}

function createDomHarness(t, options = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main></main><div id="outside-target">outside</div></body></html>', {
    url: 'http://localhost:3123/',
    pretendToBeVisual: true,
  });
  // Ensure minimal-motion instant presence transitions so closed popovers unmount deterministically.
  dom.window.document.documentElement.setAttribute('data-dsh-minimal', 'true');

  const eventSources = [];
  const rpcCalls = [];
  const fixtures = options.fixtures ?? defaultFixtures();
  const FakeEventSource = createFakeEventSourceClass(eventSources);

  const fetchImpl = async (url, init = {}) => {
    const rawUrl = String(url);
    if (rawUrl.endsWith('/dsh-bots/rpc')) {
      const body = init.body ? JSON.parse(String(init.body)) : {};
      rpcCalls.push(body);
      if (options.rpcOverride) {
        const overrideResult = await options.rpcOverride(body.method, body.params ?? {}, fixtures);
        if (overrideResult !== undefined) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({ ok: true, result: overrideResult }),
          };
        }
      }
      let result = { ok: true, items: [], chats: [], files: [], requests: [], automations: [], suggestions: [] };
      if (body.method === 'bots.list') result = fixtures;
      else if (body.method === 'bots.chatTree') result = fixtures.chatsByBot[body.params?.botId] ?? { chats: [] };
      else if (body.method === 'bots.chat.open') {
        const bot = fixtures.bots.find((b) => b.id === body.params?.botId);
        result = { sessionId: bot?.chatSessionId ?? bot?.homeSessionId ?? 'sess-whale-home' };
      } else if (body.method === 'bots.import.sources') {
        result = {
          sources: [
            {
              id: 'src-orca-1',
              name: '导入示例队友',
              source: 'orca',
              path: 'C:/Users/demo/.orca/bots/demo',
              avatar: 'mascot:W1',
              avatarColor: '#3b82f6',
              imported: false,
            },
          ],
        };
      }
      else if (body.method === 'bots.settings.set') {
        Object.assign(fixtures, body.params);
        result = { ok: true };
      } else if (body.method === 'bots.agentChoices') {
        result = { models: [] };
      } else if (body.method === 'bots.crew.list') {
        result = [];
      }
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

  const globalValues = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    MouseEvent: dom.window.MouseEvent,
    KeyboardEvent: dom.window.KeyboardEvent,
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

  const { React, ReactJsxRuntime, ReactDOM, createRoot, act, h } = loadReactModules();

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
  const host = makeHarnessCtx(disposers);
  pluginExports.apply(host.ctx);

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
      await act(async () => {
        await new Promise((resolve) => setImmediate(resolve));
      });
    }
  };

  // Realistic browser left-button click sequence: pointerdown -> mousedown -> mouseup -> click.
  const pressAndClick = async (target) => {
    await act(async () => {
      target.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true, cancelable: true }));
      target.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
      target.dispatchEvent(new dom.window.Event('pointerup', { bubbles: true, cancelable: true }));
      target.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
      target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    });
    await flush();
  };

  const pressKey = async (target, key) => {
    await act(async () => {
      const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      const notPrevented = target.dispatchEvent(event);
      if (notPrevented && (key === 'Enter' || key === ' ') && target.tagName === 'BUTTON') {
        target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
      }
    });
    await flush();
  };

  const slotComp = (predicate) => host.registrations.find((r) => predicate(r.decl))?.component;

  return {
    dom,
    doc: dom.window.document,
    root,
    act,
    h,
    rpcCalls,
    fixtures,
    host,
    flush,
    pressAndClick,
    pressKey,
    slotComp,
  };
}

domTest('SidebarBotsSection top action popovers toggle closed on second click, switch cleanly, and dismiss on outside click / Escape / keyboard', async (t) => {
  const { doc, root, act, h, flush, pressAndClick, pressKey, slotComp } = createDomHarness(t);
  const SidebarComp = slotComp((d) => d.name === 'sidebar.sections.before');
  const OverlayComp = slotComp((d) => d.name === 'shell.overlay' && d.id === 'dsh-bots.modals');

  await act(async () => {
    root.render(h('div', null, h(SidebarComp, { wide: true }), h(OverlayComp, {})));
  });
  await flush();

  const headerActions = doc.querySelector('.dsh-bots-header-actions');
  assert.ok(headerActions, 'sidebar bots header actions must render');
  const actionButtons = [...headerActions.querySelectorAll(':scope > button.dsh-bots-icon-btn')];
  assert.equal(actionButtons.length, 3, 'header actions must have search, options, and create buttons');
  const [searchBtn, optionsBtn, createBtn] = actionButtons;
  const outsideTarget = doc.querySelector('#outside-target');

  const hasEl = (selector) => Boolean(doc.querySelector(selector));

  // 1. Options button: click to open -> click again (including nested SVG) closes without reopening.
  assert.equal(optionsBtn.getAttribute('aria-haspopup'), 'menu');
  assert.equal(optionsBtn.getAttribute('aria-expanded'), 'false');
  await pressAndClick(optionsBtn);
  assert.equal(hasEl('[data-dsh-bots-popover="options"]'), true, 'OptionsPopover must open on first click');
  assert.equal(optionsBtn.getAttribute('aria-expanded'), 'true');

  // Clicking an inner SVG child of the trigger button must also toggle closed cleanly.
  const optionsIcon = optionsBtn.querySelector('svg') ?? optionsBtn;
  await pressAndClick(optionsIcon);
  assert.equal(hasEl('[data-dsh-bots-popover="options"]'), false, 'OptionsPopover must close on second click (not reopen)');
  assert.equal(optionsBtn.getAttribute('aria-expanded'), 'false');

  // 2. Create (+) button: click to open -> click again closes without reopening.
  assert.equal(createBtn.getAttribute('aria-haspopup'), 'menu');
  assert.equal(createBtn.getAttribute('aria-expanded'), 'false');
  await pressAndClick(createBtn);
  assert.equal(hasEl('[data-dsh-bots-popover="create"]'), true, 'CreateMenuPopover must open on first click');
  assert.equal(createBtn.getAttribute('aria-expanded'), 'true');

  const createIcon = createBtn.querySelector('svg') ?? createBtn;
  await pressAndClick(createIcon);
  assert.equal(hasEl('[data-dsh-bots-popover="create"]'), false, 'CreateMenuPopover must close on second click (not reopen)');
  assert.equal(createBtn.getAttribute('aria-expanded'), 'false');

  // 3. Switching directly between Options and Create popovers in one click.
  await pressAndClick(optionsBtn);
  assert.equal(hasEl('[data-dsh-bots-popover="options"]'), true);
  assert.equal(hasEl('[data-dsh-bots-popover="create"]'), false);

  await pressAndClick(createBtn);
  assert.equal(hasEl('[data-dsh-bots-popover="options"]'), false, 'switching to Create must close Options');
  assert.equal(hasEl('[data-dsh-bots-popover="create"]'), true, 'switching to Create must open Create in one click');

  await pressAndClick(optionsBtn);
  assert.equal(hasEl('[data-dsh-bots-popover="create"]'), false, 'switching back to Options must close Create');
  assert.equal(hasEl('[data-dsh-bots-popover="options"]'), true, 'switching back to Options must open Options in one click');

  // 4. Outside click dismisses active popover.
  await pressAndClick(outsideTarget);
  assert.equal(hasEl('[data-dsh-bots-popover="options"]'), false, 'outside click must dismiss OptionsPopover');
  assert.equal(optionsBtn.getAttribute('aria-expanded'), 'false');

  // 5. Escape dismisses active popover and restores focus when focus was inside the popover.
  await pressAndClick(optionsBtn);
  const firstOptionItem = doc.querySelector('[data-dsh-bots-popover="options"] button');
  assert.ok(firstOptionItem);
  firstOptionItem.focus();
  await pressKey(firstOptionItem, 'Escape');
  assert.equal(hasEl('[data-dsh-bots-popover="options"]'), false, 'Escape must dismiss OptionsPopover');
  assert.equal(doc.activeElement === optionsBtn, true, 'Escape from inside popover must restore focus to trigger');

  // 6. Keyboard Enter and Space toggle open and closed cleanly.
  optionsBtn.focus();
  await pressKey(optionsBtn, 'Enter');
  assert.equal(hasEl('[data-dsh-bots-popover="options"]'), true, 'Enter must open OptionsPopover');
  await pressKey(optionsBtn, 'Enter');
  assert.equal(hasEl('[data-dsh-bots-popover="options"]'), false, 'second Enter must close OptionsPopover');

  createBtn.focus();
  await pressKey(createBtn, ' ');
  assert.equal(hasEl('[data-dsh-bots-popover="create"]'), true, 'Space must open CreateMenuPopover');
  await pressKey(createBtn, ' ');
  assert.equal(hasEl('[data-dsh-bots-popover="create"]'), false, 'second Space must close CreateMenuPopover');

  // 7. Search toggle opens and closes cleanly on consecutive clicks.
  await pressAndClick(searchBtn);
  assert.equal(hasEl('.dsh-bots-search-input'), true, 'search input must open on first click');
  await pressAndClick(searchBtn);
  assert.equal(hasEl('.dsh-bots-search-input'), false, 'search input must close on second click');
});

domTest('BotSubChatList, BotChatsTab, AvatarPickerPopover, and inline menus toggle closed cleanly on second click', async (t) => {
  const {
    dom,
    doc,
    root,
    act,
    h,
    flush,
    pressAndClick,
    pressKey,
    slotComp,
  } = createDomHarness(t);
  const SidebarComp = slotComp((d) => d.name === 'sidebar.sections.before');
  const RightPanelComp = slotComp((d) => d.name === 'sidebar.right.pane.tab');
  const LeadingComp = slotComp((d) => d.name === 'conversation.session.header.leading');
  const OverlayComp = slotComp((d) => d.name === 'shell.overlay' && d.id === 'dsh-bots.modals');

  await act(async () => {
    root.render(h('div', null,
      h(SidebarComp, { wide: true }),
      h('section', { id: 'right-panel-host' }, h(RightPanelComp, { botId: 'bot-whale' })),
      h('section', { id: 'leading-host' }, h(LeadingComp, { sessionId: 'sess-whale-home' })),
      h(OverlayComp, {}),
    ));
  });
  await flush();

  const outsideTarget = doc.querySelector('#outside-target');
  const hasEl = (selector) => Boolean(doc.querySelector(selector));

  // 1. BotSubChatList '...' button: open -> second click closes -> switch to second row -> Escape closes.
  const subMoreButtons = [...doc.querySelectorAll('.dsh-bots-subrow-more-btn')];
  assert.ok(subMoreButtons.length >= 2, 'BotSubChatList must render at least 2 chat row action buttons');
  const [subMore1, subMore2] = subMoreButtons;

  await pressAndClick(subMore1);
  assert.equal(hasEl('.dsh-bots-chat-row-menu'), true, 'BotSubChatList menu must open on first click');
  assert.equal(subMore1.getAttribute('aria-expanded'), 'true');

  await pressAndClick(subMore1.querySelector('svg') ?? subMore1);
  assert.equal(hasEl('.dsh-bots-chat-row-menu'), false, 'BotSubChatList menu must close on second click');
  assert.equal(subMore1.getAttribute('aria-expanded'), 'false');

  await pressAndClick(subMore1);
  await pressAndClick(subMore2);
  assert.equal(hasEl('.dsh-bots-chat-row-menu'), true, 'clicking another row action button must switch menu open');
  assert.equal(subMore1.getAttribute('aria-expanded'), 'false');
  assert.equal(subMore2.getAttribute('aria-expanded'), 'true');

  await pressKey(doc, 'Escape');
  assert.equal(hasEl('.dsh-bots-chat-row-menu'), false, 'Escape must close BotSubChatList menu');

  // 2. BotPanelHeader AvatarPickerPopover: open -> second click closes -> outside click closes -> Escape closes.
  const headerAvatarBtn = doc.querySelector('#right-panel-host .dsh-bots-panel-avatar-trigger');
  assert.ok(headerAvatarBtn, 'BotPanelHeader avatar trigger must render');
  await pressAndClick(headerAvatarBtn);
  assert.equal(hasEl('[data-dsh-bots-popover="avatar-picker"]'), true, 'AvatarPickerPopover must open on first click');
  assert.equal(headerAvatarBtn.getAttribute('aria-expanded'), 'true');

  await pressAndClick(headerAvatarBtn);
  assert.equal(hasEl('[data-dsh-bots-popover="avatar-picker"]'), false, 'AvatarPickerPopover must close on second click');
  assert.equal(headerAvatarBtn.getAttribute('aria-expanded'), 'false');

  await pressAndClick(headerAvatarBtn);
  assert.equal(hasEl('[data-dsh-bots-popover="avatar-picker"]'), true);
  await pressAndClick(outsideTarget);
  assert.equal(hasEl('[data-dsh-bots-popover="avatar-picker"]'), false, 'outside click must close AvatarPickerPopover');

  await pressAndClick(headerAvatarBtn);
  assert.equal(hasEl('[data-dsh-bots-popover="avatar-picker"]'), true);
  await pressKey(doc, 'Escape');
  assert.equal(hasEl('[data-dsh-bots-popover="avatar-picker"]'), false, 'Escape must close AvatarPickerPopover');

  // 3. BotPanelHeader inline '...' menu regression check.
  const panelMoreBtn = doc.querySelector('#right-panel-host .dsh-bots-pmenu-wrap > button[aria-haspopup="menu"]');
  assert.ok(panelMoreBtn);
  await pressAndClick(panelMoreBtn);
  assert.equal(panelMoreBtn.getAttribute('aria-expanded'), 'true');
  await pressAndClick(panelMoreBtn);
  assert.equal(panelMoreBtn.getAttribute('aria-expanded'), 'false');

  // 4. BotConversationLeading pill menu regression check.
  const leadingPill = doc.querySelector('#leading-host .dsh-bots-conv-pill');
  assert.ok(leadingPill);
  await pressAndClick(leadingPill);
  assert.equal(leadingPill.getAttribute('aria-expanded'), 'true');
  await pressAndClick(leadingPill);
  assert.equal(leadingPill.getAttribute('aria-expanded'), 'false');

  // 5. BotChatsTab '...' row action menu: open -> second click closes -> switch to another row -> outside click closes.
  const tabBtns = [...doc.querySelectorAll('#right-panel-host [role="tab"]')];
  assert.equal(tabBtns.length, 4);
  await pressAndClick(tabBtns[2]);
  const chatMoreBtns = [...doc.querySelectorAll('#right-panel-host .dsh-bots-chat-more-btn')];
  assert.ok(chatMoreBtns.length >= 2, 'BotChatsTab must render at least 2 chat row more buttons');
  const [chatMore1, chatMore2] = chatMoreBtns;

  await pressAndClick(chatMore1);
  assert.equal(hasEl('[data-dsh-bots-popover="chats-row-menu"]'), true, 'BotChatsTab menu must open on first click');
  assert.equal(chatMore1.getAttribute('aria-expanded'), 'true');

  await pressAndClick(chatMore1.querySelector('svg') ?? chatMore1);
  assert.equal(hasEl('[data-dsh-bots-popover="chats-row-menu"]'), false, 'BotChatsTab menu must close on second click');
  assert.equal(chatMore1.getAttribute('aria-expanded'), 'false');

  await pressAndClick(chatMore1);
  await pressAndClick(chatMore2);
  assert.equal(hasEl('[data-dsh-bots-popover="chats-row-menu"]'), true, 'clicking second chat row button must switch menu');
  assert.equal(chatMore1.getAttribute('aria-expanded'), 'false');
  assert.equal(chatMore2.getAttribute('aria-expanded'), 'true');

  await pressAndClick(outsideTarget);
  assert.equal(hasEl('[data-dsh-bots-popover="chats-row-menu"]'), false, 'outside click must close BotChatsTab menu');

  // BotChatsTab closeOnScroll: scrolling any ancestor/container closes the row action menu.
  await pressAndClick(chatMore1);
  assert.equal(hasEl('[data-dsh-bots-popover="chats-row-menu"]'), true, 'BotChatsTab menu must reopen before scroll check');
  const scrollTarget = doc.querySelector('#right-panel-host .dsh-bots-panel-scroll') ?? doc.querySelector('#right-panel-host');
  assert.ok(scrollTarget);
  await act(async () => {
    scrollTarget.dispatchEvent(new dom.window.Event('scroll', { bubbles: false }));
  });
  await flush();
  assert.equal(hasEl('[data-dsh-bots-popover="chats-row-menu"]'), false, 'scrolling must close BotChatsTab menu via closeOnScroll');

  // 6. NewBotDialog AvatarPickerPopover: open from sidebar '+' -> toggle avatar picker -> Escape closes picker first, then modal.
  const createBtn = [...doc.querySelectorAll('.dsh-bots-header-actions > button.dsh-bots-icon-btn')][2];
  await pressAndClick(createBtn);
  const startFromScratchBtn = doc.querySelector('[data-dsh-bots-popover="create"] button');
  assert.ok(startFromScratchBtn);
  await pressAndClick(startFromScratchBtn);

  const modalAvatarBtn = doc.querySelector('.dsh-bots-modal button[aria-haspopup="dialog"]');
  assert.ok(modalAvatarBtn, 'NewBotDialog avatar trigger must render');
  await pressAndClick(modalAvatarBtn);
  assert.equal(hasEl('[data-dsh-bots-popover="avatar-picker"]'), true, 'NewBotDialog AvatarPickerPopover must open');
  assert.equal(modalAvatarBtn.getAttribute('aria-expanded'), 'true');

  await pressAndClick(modalAvatarBtn);
  assert.equal(hasEl('[data-dsh-bots-popover="avatar-picker"]'), false, 'NewBotDialog AvatarPickerPopover must close on second click');
  assert.equal(modalAvatarBtn.getAttribute('aria-expanded'), 'false');

  await pressAndClick(modalAvatarBtn);
  assert.equal(hasEl('[data-dsh-bots-popover="avatar-picker"]'), true);
  const modalEl = doc.querySelector('.dsh-bots-modal');
  assert.ok(modalEl);
  await pressKey(modalEl, 'Escape');
  assert.equal(hasEl('[data-dsh-bots-popover="avatar-picker"]'), false, 'first Escape closes AvatarPickerPopover');
  assert.equal(hasEl('.dsh-bots-modal'), true, 'first Escape keeps NewBotDialog open');
  await pressKey(modalEl, 'Escape');
  assert.equal(hasEl('.dsh-bots-modal'), false, 'second Escape closes NewBotDialog');

  // 7. BotImportDialog AvatarPickerPopover: open from sidebar '+' -> toggle avatar picker -> Escape closes picker first, then dialog.
  await pressAndClick(createBtn);
  const createItems = [...doc.querySelectorAll('[data-dsh-bots-popover="create"] button')];
  assert.ok(createItems.length >= 4, 'CreateMenuPopover must include import-from-app item');
  await pressAndClick(createItems[3]);

  const importAvatarBtn = doc.querySelector('.dsh-bots-modal button[aria-haspopup="dialog"]');
  assert.ok(importAvatarBtn, 'BotImportDialog avatar trigger must render');
  await pressAndClick(importAvatarBtn);
  assert.equal(hasEl('[data-dsh-bots-popover="avatar-picker"]'), true, 'BotImportDialog AvatarPickerPopover must open');
  assert.equal(importAvatarBtn.getAttribute('aria-expanded'), 'true');

  await pressAndClick(importAvatarBtn);
  assert.equal(hasEl('[data-dsh-bots-popover="avatar-picker"]'), false, 'BotImportDialog AvatarPickerPopover must close on second click');
  assert.equal(importAvatarBtn.getAttribute('aria-expanded'), 'false');

  await pressAndClick(importAvatarBtn);
  assert.equal(hasEl('[data-dsh-bots-popover="avatar-picker"]'), true);
  await pressKey(doc, 'Escape');
  assert.equal(hasEl('[data-dsh-bots-popover="avatar-picker"]'), false, 'first Escape closes BotImportDialog AvatarPickerPopover only');
  assert.equal(hasEl('.dsh-bots-modal'), true, 'first Escape must keep BotImportDialog open');
  await pressKey(doc, 'Escape');
  assert.equal(hasEl('.dsh-bots-modal'), false, 'second Escape closes BotImportDialog');
});

domTest('useAnchoredPopoverDismiss deduplicates pointerdown+mousedown and intercepts Escape in capture phase', async (t) => {
  const { dom, doc, root, act, h, flush } = createDomHarness(t);
  const esbuild = require('esbuild');
  const hookPath = path.join(REPO_ROOT, 'vendor', 'dsh-whale', 'src', 'client', 'components', 'useAnchoredPopoverDismiss.ts');
  const built = await esbuild.build({
    entryPoints: [hookPath],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    external: ['react'],
    write: false,
  });
  const mod = { exports: {} };
  const { React } = loadReactModules();
  vm.runInNewContext(
    `(function(require, module, exports) { ${built.outputFiles[0].text} })`,
    {
      window: dom.window,
      document: dom.window.document,
      setTimeout: dom.window.setTimeout.bind(dom.window),
      clearTimeout: dom.window.clearTimeout.bind(dom.window),
      console,
    },
  )((id) => (id === 'react' ? React : {}), mod, mod.exports);
  const { useAnchoredPopoverDismiss } = mod.exports;

  let closeCount = 0;
  function HarnessComp() {
    const triggerRef = React.useRef(null);
    const popoverRef = React.useRef(null);
    useAnchoredPopoverDismiss({
      open: true,
      popoverRef,
      triggerRef,
      onClose: () => {
        closeCount += 1;
      },
    });
    return h('div', null,
      h('button', { ref: triggerRef, id: 'hook-trigger', type: 'button' }, h('span', { id: 'hook-trigger-child' }, 'Trigger')),
      h('div', { ref: popoverRef, id: 'hook-popover' }, h('button', { id: 'hook-item', type: 'button' }, 'Item')),
    );
  }

  await act(async () => {
    root.render(h(HarnessComp));
  });
  await flush();

  const outsideTarget = doc.querySelector('#outside-target');
  const triggerChild = doc.querySelector('#hook-trigger-child');
  const popoverItem = doc.querySelector('#hook-item');

  // 1. Inside trigger / popover presses must never call onClose.
  await act(async () => {
    triggerChild.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true, cancelable: true }));
    triggerChild.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    popoverItem.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true, cancelable: true }));
    popoverItem.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  });
  assert.equal(closeCount, 0, 'presses inside trigger or popover must not invoke onClose');

  // 2. Single outside press firing pointerdown -> mousedown invokes onClose strictly once.
  await act(async () => {
    outsideTarget.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true, cancelable: true }));
    outsideTarget.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  });
  assert.equal(closeCount, 1, 'pointerdown + mousedown from one outside press must invoke onClose exactly once');

  // 3. Legacy mousedown-only outside press still invokes onClose once.
  await act(async () => {
    outsideTarget.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  });
  assert.equal(closeCount, 2, 'mousedown-only outside press must invoke onClose once');

  // 4. Capture-phase Escape calls onClose once, sets defaultPrevented, and blocks bubble listeners on document.
  let bubbleSawEscape = false;
  const onBubbleKey = (e) => {
    if (e.key === 'Escape') bubbleSawEscape = true;
  };
  doc.addEventListener('keydown', onBubbleKey);
  try {
    let escEvent;
    await act(async () => {
      escEvent = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      doc.body.dispatchEvent(escEvent);
    });
    assert.equal(closeCount, 3, 'Escape must invoke onClose once');
    assert.equal(escEvent.defaultPrevented, true, 'Escape must call preventDefault()');
    assert.equal(bubbleSawEscape, false, 'capture-phase Escape must stopPropagation before document bubble listeners');
  } finally {
    doc.removeEventListener('keydown', onBubbleKey);
  }
});

domTest('Sidebar bot tree omits Home Chat subrow, surfaces home workers, avoids tail overlap, and fixes subagent menu actions without chatId', async (t) => {
  const customFixtures = defaultFixtures();
  customFixtures.botSidebarView.sortBy = 'manual';
  // bot-whale: home chat with 1 running worker + 1 non-home work subchat (without chatId, matching decorateChatRow) + 1 side chat with folded worker
  customFixtures.chatsByBot['bot-whale'] = {
    botId: 'bot-whale',
    homeSessionId: 'sess-whale-home',
    chats: [
      {
        id: 'sess-whale-home',
        sessionId: 'sess-whale-home',
        origin: 'home',
        title: 'Home Chat',
        closed: false,
        runningTotal: 1,
        running: [
          {
            id: 'work-home-1',
            dispatchId: 'disp-home-1',
            taskId: 'task-home-1',
            sessionId: 'sess-home-worker-1',
            title: '主对话子代理A',
            state: 'running',
            createdAt: Date.now() - 5000,
          },
        ],
        finished: [
          {
            id: 'work-home-done',
            sessionId: 'sess-home-worker-done',
            title: '已完成子代理B',
            state: 'done',
          },
        ],
      },
      {
        id: 'sess-whale-work-chat',
        sessionId: 'sess-whale-work-chat',
        origin: 'work',
        title: 'Worker · repo',
        closed: false,
        lastActiveAt: Date.now() - 10_000,
        runningTotal: 1,
        running: [
          {
            id: 'work-nested-1',
            sessionId: 'sess-nested-worker-1',
            title: '嵌套运行子代理',
            state: 'running',
            createdAt: Date.now() - 3000,
          },
        ],
      },
    ],
  };
  // bot-scout: ONLY home chat + 1 running home worker (no non-home subchats) -> fold button and worker list must still appear
  customFixtures.chatsByBot['bot-scout'] = {
    botId: 'bot-scout',
    homeSessionId: 'sess-scout-home',
    chats: [
      {
        id: 'sess-scout-home',
        sessionId: 'sess-scout-home',
        origin: 'home',
        title: 'Home Chat',
        closed: false,
        runningTotal: 1,
        running: [
          {
            id: 'work-scout-1',
            sessionId: 'sess-scout-worker-1',
            title: '巡检子代理',
            state: 'running',
            createdAt: Date.now() - 2000,
          },
        ],
      },
    ],
  };

  let failNextDelete = false;
  const { doc, root, act, h, rpcCalls, host, flush, pressAndClick, slotComp } = createDomHarness(t, {
    fixtures: customFixtures,
    rpcOverride: (method) => {
      if (method === 'bots.chat.delete') {
        if (failNextDelete) {
          failNextDelete = false;
          throw new Error('delete_blocked_for_test');
        }
        return { ok: true, deleted: true };
      }
      if (method === 'bots.work.stop') return { ok: true, stopped: true };
      return undefined;
    },
  });
  const SidebarComp = slotComp((d) => d.name === 'sidebar.sections.before');
  const OverlayComp = slotComp((d) => d.name === 'shell.overlay' && d.id === 'dsh-bots.modals');

  await act(async () => {
    root.render(h('div', null, h(SidebarComp, { wide: true }), h(OverlayComp, {})));
  });
  await flush();

  const wraps = [...doc.querySelectorAll('.dsh-bots-card-wrap')];
  const whaleWrap = wraps.find((w) => w.querySelector('.dsh-bots-card-name')?.textContent === '鲸鱼娘');
  const scoutWrap = wraps.find((w) => w.querySelector('.dsh-bots-card-name')?.textContent === '巡检官');
  assert.ok(whaleWrap && scoutWrap);

  // Drag handle sits on .dsh-bots-card only, never wrapping subrows/workers in draggable="true".
  assert.notEqual(whaleWrap.getAttribute('draggable'), 'true', '.dsh-bots-card-wrap must not be draggable');
  assert.equal(whaleWrap.querySelector('.dsh-bots-card')?.getAttribute('draggable'), 'true', '.dsh-bots-card keeps manualSort draggable');

  // 1. Home Chat subrow is gone; home workers render directly under bot card; bot with only home workers still shows fold chevron.
  assert.equal([...whaleWrap.querySelectorAll('.dsh-bots-subrow')].some((r) => r.textContent?.includes('Home Chat')), false);
  assert.ok(scoutWrap.querySelector('.dsh-bots-card-fold-btn'), 'bot with only home workers must show fold button');
  assert.ok(scoutWrap.querySelector('.dsh-bots-worker-list[data-root-workers="true"]'), 'home workers must render directly under bot card');
  assert.match(whaleWrap.textContent, /主对话子代理A/);
  assert.match(whaleWrap.textContent, /已完成子代理B/);
  assert.match(whaleWrap.textContent, /Worker · repo/);

  // 2. Clicking bot card opens Home Chat and highlights parent card itself (data-active="true"), even while sublist is expanded.
  await pressAndClick(whaleWrap.querySelector('.dsh-bots-card'));
  assert.equal(whaleWrap.querySelector('.dsh-bots-card')?.getAttribute('data-active'), 'true');
  assert.equal(whaleWrap.querySelector('.dsh-bots-card')?.getAttribute('data-has-active-child'), 'false');

  // Clicking a home worker row highlights that worker row and marks parent data-has-active-child="true".
  const homeWorkerRow = [...whaleWrap.querySelectorAll('.dsh-bots-worker-list[data-root-workers="true"] .dsh-bots-worker-row')]
    .find((el) => el.textContent?.includes('主对话子代理A'));
  assert.ok(homeWorkerRow);
  await pressAndClick(homeWorkerRow);
  assert.equal(homeWorkerRow.getAttribute('data-active'), 'true');
  assert.equal(whaleWrap.querySelector('.dsh-bots-card')?.getAttribute('data-active'), 'false');
  assert.equal(whaleWrap.querySelector('.dsh-bots-card')?.getAttribute('data-has-active-child'), 'true');
  assert.ok(host.calls.openSession.includes('sess-home-worker-1'));

  // Clicking bot card again re-highlights parent card for Home Chat.
  await pressAndClick(whaleWrap.querySelector('.dsh-bots-card'));
  assert.equal(whaleWrap.querySelector('.dsh-bots-card')?.getAttribute('data-active'), 'true');
  assert.equal(whaleWrap.querySelector('.dsh-bots-card')?.getAttribute('data-has-active-child'), 'false');

  // 3. CSS layout contract: subrow-more-btn and worker-stop-btn use flex flow (no position: absolute overlap),
  //    and worker rows share the exact 16px centered icon slot + 8px padding + 6px gap as sibling subrows so icons & titles align.
  const cssText = [...doc.head.querySelectorAll('style[data-dsh-whale-style]')].map((el) => el.textContent).join('\n');
  const subrowMoreBlock = /\.dsh-bots-subrow-more-btn\s*\{([^}]*)\}/.exec(cssText);
  assert.ok(subrowMoreBlock && !/position:\s*absolute/.test(subrowMoreBlock[1]), '.dsh-bots-subrow-more-btn must not use position: absolute');
  const workerStopBlock = /\.dsh-bots-worker-row\s+\.dsh-bots-worker-stop-btn\s*\{([^}]*)\}/.exec(cssText);
  assert.ok(workerStopBlock && !/position:\s*absolute/.test(workerStopBlock[1]), '.dsh-bots-worker-row .dsh-bots-worker-stop-btn must not use position: absolute');
  const subrowIconBlock = /\.dsh-bots-subrow-icon\s*\{([^}]*)\}/.exec(cssText);
  const workerIconBlock = /\.dsh-bots-worker-icon\s*\{([^}]*)\}/.exec(cssText);
  assert.ok(subrowIconBlock && /width:\s*16px/.test(subrowIconBlock[1]), '.dsh-bots-subrow-icon must be 16px wide');
  assert.ok(
    workerIconBlock && /width:\s*16px/.test(workerIconBlock[1]) && /justify-content:\s*center/.test(workerIconBlock[1]),
    '.dsh-bots-worker-icon must be a centered 16px box matching .dsh-bots-subrow-icon',
  );
  assert.ok(
    homeWorkerRow.querySelector('.dsh-bots-worker-icon > .dsh-bots-worker-dot'),
    'worker dot must render inside .dsh-bots-worker-icon so icon centers and title left edges align with .dsh-bots-subrow',
  );

  // 4. Real backend subrow WITHOUT chatId opens '...' menu on first click and executes Open / Delete.
  const workSubrow = whaleWrap.querySelector('.dsh-bots-subrow');
  assert.ok(workSubrow);
  const workMoreBtn = workSubrow.querySelector('.dsh-bots-subrow-more-btn');
  assert.ok(workMoreBtn);
  assert.equal(workSubrow.getAttribute('data-menu-open'), 'false');
  assert.equal(workMoreBtn.getAttribute('aria-expanded'), 'false');

  await pressAndClick(workMoreBtn);
  const subrowMenu = doc.querySelector('.dsh-bots-chat-row-menu');
  assert.ok(subrowMenu, 'subrow without chatId must open .dsh-bots-chat-row-menu on first click');
  assert.equal(workSubrow.getAttribute('data-menu-open'), 'true');

  const openItem = [...subrowMenu.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent?.includes('打开对话'));
  assert.ok(openItem);
  await pressAndClick(openItem);
  assert.equal(doc.querySelector('.dsh-bots-chat-row-menu'), null);
  assert.ok(host.calls.openSession.includes('sess-whale-work-chat'));
  assert.equal(workSubrow.getAttribute('data-active'), 'true');
  assert.equal(whaleWrap.querySelector('.dsh-bots-card')?.getAttribute('data-has-active-child'), 'true');

  // Re-open menu and delete subrow chat.
  await pressAndClick(workMoreBtn);
  const delItem = doc.querySelector('.dsh-bots-chat-row-menu .dsh-bots-menu-item-danger');
  assert.ok(delItem && !delItem.disabled);
  await pressAndClick(delItem);
  assert.ok(rpcCalls.some((c) => c.method === 'bots.chat.delete' && c.params?.botId === 'bot-whale' && c.params?.sessionId === 'sess-whale-work-chat'));

  // 5. Worker row '...' menu opens, toggles, stops running worker, and supports open/delete.
  const workerMoreBtn = homeWorkerRow.querySelector('.dsh-bots-subrow-more-btn');
  assert.ok(workerMoreBtn, 'worker row must render .dsh-bots-subrow-more-btn');
  await pressAndClick(workerMoreBtn);
  const workerMenu = doc.querySelector('.dsh-bots-chat-row-menu');
  assert.ok(workerMenu, 'worker row menu must open on first click');
  assert.equal(homeWorkerRow.getAttribute('data-menu-open'), 'true');

  const stopItem = [...workerMenu.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent?.includes('停止运行'));
  assert.ok(stopItem, 'running worker menu must include Stop worker action');
  await pressAndClick(stopItem);
  assert.ok(rpcCalls.some((c) => c.method === 'bots.work.stop' && c.params?.botId === 'bot-whale' && c.params?.workId === 'work-home-1'));

  // Worker row delete error must surface via error toast (never swallowed).
  failNextDelete = true;
  await pressAndClick(workerMoreBtn);
  const workerDeleteItem = doc.querySelector('.dsh-bots-chat-row-menu .dsh-bots-menu-item-danger');
  assert.ok(workerDeleteItem, 'worker row menu with sessionId must include Delete chat action');
  await pressAndClick(workerDeleteItem);
  const errToast = doc.querySelector('.dsh-bots-toast[data-tone="error"]');
  assert.ok(errToast, 'delete failure on worker row must surface an error toast');
});
