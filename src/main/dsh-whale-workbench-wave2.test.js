'use strict';

const nodeTest = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
require('../../scripts/lib/harness-peer-hook.cjs');
const { gateTests, harnessDependencies } = require('../../scripts/lib/test-prerequisites.cjs');

const HARNESS_DEPS = harnessDependencies();
const test = gateTests(nodeTest, HARNESS_DEPS);

const CLIENT_FILE = path.join(__dirname, '../../vendor/dsh-whale/client/client.js');
const whaleIndexUrl = pathToFileURL(path.join(__dirname, '../../vendor/dsh-whale/lib/index.js')).href;
const sideQaUrl = pathToFileURL(path.join(__dirname, '../../vendor/dsh-whale/lib/side-qa.js')).href;
const sseHubUrl = pathToFileURL(path.join(__dirname, '../../vendor/dsh-whale/lib/sse-hub.js')).href;
const memoryStoreUrl = pathToFileURL(path.join(__dirname, '../../vendor/dsh-whale/lib/memory-store.js')).href;

const vendorRequire = createRequire(path.join(__dirname, '../../vendor/deepseek-harness/package.json'));
const clientRequire = createRequire(path.join(__dirname, '../../vendor/dsh-im/package.json'));
const React = clientRequire('react');
const ReactJsxRuntime = clientRequire('react/jsx-runtime');
const ReactDOM = clientRequire('react-dom');
const { JSDOM } = HARNESS_DEPS.ok ? vendorRequire('jsdom') : {};
const { act, createElement: h } = React;

function makeTempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function createFakeHttpRes() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.chunks = [];
  res.ended = false;
  res.headersSent = false;
  res.writeHead = (code, headers = {}) => {
    res.statusCode = code;
    res.headers = { ...res.headers, ...headers };
    res.headersSent = true;
  };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.flushHeaders = () => { res.headersSent = true; };
  res.write = (chunk) => {
    res.chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  };
  res.end = (chunk) => {
    if (chunk !== undefined) res.write(chunk);
    res.ended = true;
    res.emit('finish');
  };
  res.bodyText = () => res.chunks.join('');
  return res;
}

nodeTest('/dsh-whale/events SSE enforces auth, streams authoritative snapshots & live updates, and projects needsYou', async (t) => {
  const { apply: applyWhaleHost } = await import(whaleIndexUrl);
  const { buildWorkbenchSnapshot } = await import(sseHubUrl);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-sse-host-'));
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  const cleanups = [];
  t.after(async () => {
    for (const fn of cleanups.splice(0).reverse()) await fn?.();
    if (prevHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  const subscribers = new Set();
  const cards = [
    {
      id: 'todo-live-1',
      title: '发布前检查',
      mode: 'workspace-task',
      state: 'running',
      phase: '执行中…',
      pendingInput: [],
      sessionId: 'task-sess-1',
      deliverables: [],
      runs: [],
    },
  ];
  const todosMock = {
    available: true,
    list: () => cards,
    autoAdvanceEnabled: () => false,
    subscribe: (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
  const liveTaskAgent = {
    id: 'task-sess-1',
    status: 'running',
    session: { id: 'task-sess-1' },
  };
  let pendingApprovals = [{ id: 'appr-1' }];
  const services = new Map([
    ['whaleTodos', todosMock],
    ['agents', { get: (id) => (id === 'task-sess-1' ? liveTaskAgent : null) }],
    ['approval', { pending: (session) => (session?.id === 'task-sess-1' ? pendingApprovals : []) }],
    ['sessionProjections', { stateOf: () => ({ openTurnStartSeq: 3, lastTurn: 1, lastStepStartSeq: 4 }) }],
  ]);

  let requestHandler = null;
  const hostCtx = {
    get: (name) => services.get(name),
    provide: (name, value) => services.set(name, value),
    on: () => {},
    effect: (fn) => {
      const d = fn();
      if (typeof d === 'function') cleanups.push(d);
      else if (d && typeof d.then === 'function') {
        cleanups.push(async () => {
          const resolved = await d;
          if (typeof resolved === 'function') await resolved();
        });
      }
      return () => {};
    },
    logger: { warn: () => {}, info: () => {} },
    agentPresets: { register: () => () => {} },
    systemPrompt: { section: () => () => {} },
    connection: {
      requestRejection: (req) => (req.headers.authorization === 'Bearer ok-token' ? undefined : 401),
    },
    webServer: {
      register: (route) => {
        if (route.path === '/dsh-whale') requestHandler = route.handler;
        return () => {};
      },
    },
  };

  applyWhaleHost(hostCtx, {});
  assert.ok(requestHandler, 'webServer.register must register /dsh-whale handler');

  // Direct authoritative snapshot projection sees pending approval from Host service -> waiting_approval + needsYou.
  const snap = buildWorkbenchSnapshot(hostCtx, { get: () => ({ sessionId: 'resident-1', name: '鲸鱼娘' }) });
  assert.equal(snap.cards[0].state, 'waiting_approval');
  assert.deepEqual(snap.cards[0].pendingInput, ['approval']);
  assert.equal(snap.cards[0].rootTurn.open, true);
  assert.equal(snap.needsYou.length, 1);
  assert.equal(snap.needsYou[0].cardId, 'todo-live-1');

  // Unauthenticated SSE request -> 401.
  const unauthReq = Object.assign(new EventEmitter(), { method: 'GET', url: '/dsh-whale/events', headers: {} });
  const unauthRes = createFakeHttpRes();
  await requestHandler(unauthReq, unauthRes);
  assert.equal(unauthRes.statusCode, 401);

  // Authenticated SSE request -> 200 text/event-stream + initial snapshot frame + live broadcast.
  const authReq = Object.assign(new EventEmitter(), {
    method: 'GET',
    url: '/dsh-whale/events',
    headers: { authorization: 'Bearer ok-token' },
  });
  const authRes = createFakeHttpRes();
  await requestHandler(authReq, authRes);
  assert.equal(authRes.statusCode, 200);
  assert.match(String(authRes.headers['Content-Type'] ?? authRes.headers['content-type']), /text\/event-stream/);
  assert.match(authRes.bodyText(), /event: snapshot/);
  assert.match(authRes.bodyText(), /waiting_approval/);

  // Mutate state & broadcast via whaleTodos subscriber -> new snapshot pushed live over SSE.
  pendingApprovals = [];
  cards[0] = { ...cards[0], state: 'review', phase: '待验收', summary: '全部通过' };
  for (const fn of subscribers) fn({ reason: 'card' });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.match(authRes.bodyText(), /全部通过/);

  authReq.emit('close');
});

nodeTest('/side side-question runs zero-tool read-only llm.stream, never mutates main session log, and respects taint boundary', async (t) => {
  const { askSideQuestion } = await import(sideQaUrl);
  const store = await import(memoryStoreUrl);
  const home = makeTempDir(t, 'whale-side-qa-');
  store.storeMemoryFact(home, { text: '主人绝密笔记：代号蓝鲸', category: 'fact' });

  const streamCalls = [];
  const mainAppends = [];
  const makeSession = (events) => ({
    id: 'resident-whale',
    header: { id: 'resident-whale', agentPreset: 'whale-girl' },
    snapshotEvents: () => events,
    append: (...args) => mainAppends.push(args),
  });

  const cleanEvents = [
    { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '我们正在做 Wave 2' }] } },
    { seq: 2, type: 'assistant/message', data: { content: [{ type: 'text', text: '好的，已经推进到 SSE 工作台。' }] } },
  ];
  const taintedEvents = [
    ...cleanEvents,
    { seq: 3, type: 'user/message', data: { source: { kind: 'user', speaker: { role: 'guest', chat: 'group' } }, content: [{ type: 'text', text: '路人消息' }] } },
  ];

  let activeSession = makeSession(cleanEvents);
  const ctx = {
    get: (name) => {
      if (name === 'agents') return { get: () => ({ id: 'resident-whale', session: activeSession }) };
      if (name === 'sessionProjections') {
        return { stateOf: () => ({ next: { provider: 'deepseek', model: 'deepseek-chat' } }) };
      }
      if (name === 'llm') {
        return {
          stream: async function* (req) {
            streamCalls.push(req);
            yield { type: 'text-delta', text: '旁路回答：' };
            yield { type: 'text-delta', text: '当前正在完成 Wave 2。' };
          },
        };
      }
      return undefined;
    },
  };
  const scope = { get: () => ({ sessionId: 'resident-whale', name: '鲸鱼娘' }) };

  // Empty question rejected cleanly.
  const empty = await askSideQuestion(ctx, scope, { question: '   ', home });
  assert.equal(empty.ok, false);
  assert.equal(empty.error, 'empty-question');

  // Clean session: zero tools, includes owner memory index, NEVER calls session.append.
  const cleanRes = await askSideQuestion(ctx, scope, { question: '现在做到哪一步了？', home });
  assert.equal(cleanRes.ok, true);
  assert.match(cleanRes.answer, /当前正在完成 Wave 2/);
  assert.equal(mainAppends.length, 0, '/side MUST NEVER append to main Session log');
  assert.equal(streamCalls.length, 1);
  assert.deepEqual(streamCalls[0].tools, [], '/side MUST invoke llm.stream with ZERO tools');
  assert.match(streamCalls[0].system, /代号蓝鲸/);

  // Tainted session: NEVER leaks owner memory into /side system prompt.
  activeSession = makeSession(taintedEvents);
  const taintedRes = await askSideQuestion(ctx, scope, { question: '总结刚才的对话', home });
  assert.equal(taintedRes.ok, true);
  assert.equal(streamCalls.length, 2);
  assert.equal(streamCalls[1].system.includes('代号蓝鲸'), false, 'tainted session MUST NOT inject owner memory into /side');
  assert.equal(mainAppends.length, 0);
});

test('Orca Bots client mounts single right-panel tab + BotsModalHost, reconciles /dsh-bots/events SSE reconnects, and renders panel tabs & modal portal', async (t) => {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main></main></body></html>', {
    url: 'http://localhost:3123/',
    pretendToBeVisual: true,
  });

  const eventSources = [];
  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.listeners = new Map();
      this.closed = false;
      eventSources.push(this);
    }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(fn);
    }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
    close() { this.closed = true; this.readyState = 2; }
    emit(type, event = {}) {
      if (type === 'open') { this.readyState = 1; this.onopen?.(event); }
      if (type === 'error') { this.onerror?.(event); }
      for (const fn of this.listeners.get(type) ?? []) fn(event);
    }
  }

  const rpcCalls = [];
  const botsPayload = {
    botsEnabled: true,
    hideBotCreatedWorkspaces: true,
    petBotId: 'bot-1',
    bots: [
      {
        id: 'bot-1',
        name: '鲸鱼娘',
        purpose: '研发助理',
        avatar: 'whale',
        avatarColor: '#3b82f6',
        paused: false,
        dotState: 'working',
        homeSessionId: 'sess-bot-1',
        chatSessionId: 'sess-bot-1',
        homePath: 'C:/Users/demo/.whaleisle/bots/bot-1',
        needsYouCount: 1,
      },
    ],
    groups: [],
    chatsByBot: {
      'bot-1': {
        botId: 'bot-1',
        chats: [
          { chatId: 'sess-bot-1', sessionId: 'sess-bot-1', origin: 'home', title: 'Home Chat' },
          { chatId: 'sess-side-1', sessionId: 'sess-side-1', origin: 'side', title: '发布复盘' },
        ],
      },
    },
    needsYou: { 'bot-1': 1 },
    needsYouAt: Date.now(),
  };

  const workItems = [
    {
      uid: 'item-1',
      number: 1,
      botId: 'bot-1',
      title: '审批生产发布计划',
      status: 'needs_you',
      kind: 'ask',
      body: '是否现在合并并发布？',
      createdAt: Date.now() - 10_000,
      updatedAt: Date.now() - 5_000,
    },
    {
      uid: 'item-2',
      number: 2,
      botId: 'bot-1',
      title: '整理本周周报',
      status: 'working',
      kind: 'task',
      body: '正在汇总提交记录',
      createdAt: Date.now() - 20_000,
      updatedAt: Date.now() - 1_000,
    },
  ];

  const fakeFetch = async (url, init = {}) => {
    const rawUrl = String(url);
    if (rawUrl.endsWith('/dsh-bots/rpc')) {
      const body = init.body ? JSON.parse(String(init.body)) : {};
      rpcCalls.push(body);
      const { method } = body;
      let result = { ok: true };
      if (method === 'bots.list') result = botsPayload;
      else if (method === 'bots.items.owner.list') result = { items: workItems };
      else if (method === 'bots.automations.list') result = { automations: [] };
      else if (method === 'bots.access.list') result = { requests: [] };
      else if (method === 'bots.suggest') result = { suggestions: [] };
      else if (method === 'bots.chats.own' || method === 'bots.chats') result = { chats: botsPayload.chatsByBot['bot-1'].chats };
      else if (method === 'bots.files.list') result = { files: [{ path: 'SOUL.md', size: 120, mtimeMs: Date.now() }] };
      else if (method === 'bots.connectors') result = { connectors: [] };
      else if (method === 'bots.agentChoices') result = { models: [] };
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ ok: true, result }) };
    }
    return { ok: true, status: 200, statusText: 'OK', json: async () => ({ ok: true, result: {} }), text: async () => '<svg></svg>' };
  };

  const intervals = [];
  const origSetInterval = dom.window.setInterval.bind(dom.window);
  const origClearInterval = dom.window.clearInterval.bind(dom.window);
  const wrappedSetInterval = (fn, ms) => {
    intervals.push(ms);
    return origSetInterval(fn, ms);
  };
  dom.window.setInterval = wrappedSetInterval;

  const globalValues = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
    EventSource: FakeEventSource,
    fetch: fakeFetch,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const savedGlobals = Object.fromEntries(Object.keys(globalValues).map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const [k, v] of Object.entries(globalValues)) {
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: v });
  }

  let registration = null;
  dom.window.__ModuleLoader__ = { load: (entry) => { registration = entry; } };
  dom.window.EventSource = FakeEventSource;
  dom.window.fetch = fakeFetch;
  vm.runInNewContext(fs.readFileSync(CLIENT_FILE, 'utf8'), {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    EventSource: FakeEventSource,
    fetch: fakeFetch,
    setTimeout: dom.window.setTimeout.bind(dom.window),
    clearTimeout: dom.window.clearTimeout.bind(dom.window),
    setInterval: wrappedSetInterval,
    clearInterval: origClearInterval,
    AbortController,
    URL,
    URLSearchParams,
    CustomEvent: dom.window.CustomEvent,
    console,
  }, { filename: CLIENT_FILE });

  const { createRoot } = clientRequire('react-dom/client');
  const plugin = registration.factory((name) => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return ReactJsxRuntime;
    if (name === 'react-dom') return ReactDOM;
    if (name === 'react-dom/client') return { createRoot };
    return {};
  });

  const registeredSlots = new Map();
  const rightTabs = [];
  const openedSessions = [];
  const cleanups = [];
  const declared = new Set(['sidebar.right.pane.tab', 'shell.overlay', 'sidebar.sections.before']);
  const sidebarRight = { openTab: () => {}, openTabIn: () => true };
  const sidebarRightTabs = {
    register: (def) => {
      rightTabs.push(def);
      return () => {};
    },
  };
  const ctx = {
    effect: (fn) => { const d = fn(); if (typeof d === 'function') cleanups.push(d); return () => d?.(); },
    locale: {
      register: () => () => {},
      getLocale: () => ({ active: 'zh-CN' }),
      subscribe: () => () => {},
    },
    slots: {
      spec: (name) => declared.has(name),
      subscribe: () => () => {},
      inject: (_name, fn) => fn(),
      register: (opts, comp) => { registeredSlots.set(`${opts.name}:${opts.key ?? opts.id ?? ''}`, { opts, comp }); return () => {}; },
    },
    uiWorkspace: { openSession: (id) => openedSessions.push(id) },
    sessions: { list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => {} } },
    layout: { selectPanel: () => {} },
    settingsNavigation: { open: () => {}, close: () => {} },
    sidebarRight,
    sidebarRightTabs,
    get: (name) => ({ sidebarRight, sidebarRightTabs, uiWorkspace: ctx.uiWorkspace, sessions: ctx.sessions })[name],
    inject: (_deps, fn) => { fn(ctx); return () => {}; },
  };

  plugin.apply(ctx);

  // Single native right-sidebar tab + lightweight BotsModalHost overlay (NO legacy shell.overlay workbench!).
  assert.equal(rightTabs.length, 1);
  assert.equal(rightTabs[0].id, 'dsh-whale:bots-panel');
  assert.equal(rightTabs[0].kind, 'dsh-bots');
  const rightTabSlot = registeredSlots.get('sidebar.right.pane.tab:dsh-whale:bots-panel');
  const modalHostSlot = registeredSlots.get('shell.overlay:dsh-bots.modals');
  const sidebarSlot = registeredSlots.get('sidebar.sections.before:dsh-bots');
  assert.ok(rightTabSlot, 'native sidebar.right.pane.tab slot must be registered');
  assert.ok(modalHostSlot, 'shell.overlay:dsh-bots.modals slot must be registered');
  assert.equal(registeredSlots.has('shell.overlay:dsh-whale.workbench'), false, 'legacy Big Fish workbench overlay must be removed');

  const root = createRoot(dom.window.document.querySelector('main'));
  t.after(async () => {
    await act(async () => root.unmount());
    for (const d of cleanups.splice(0).reverse()) d?.();
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

  await act(async () => {
    root.render(h('div', null,
      h(sidebarSlot.comp, { wide: true }),
      h(rightTabSlot.comp, { sessionId: 'sess-bot-1' }),
      h(modalHostSlot.comp, {}),
    ));
  });
  await flush();

  // Subscribes via EventSource /dsh-bots/events (NO 3000ms polling interval).
  assert.equal(intervals.includes(3000), false, '3s setInterval polling must not exist');
  assert.ok(eventSources.some((es) => es.url.includes('/dsh-bots/events')), 'must subscribe via EventSource /dsh-bots/events');

  // Panel displays bot name and work items fetched via RPC.
  const initialText = dom.window.document.body.textContent;
  assert.match(initialText, /鲸鱼娘/);
  assert.match(initialText, /审批生产发布计划/);
  assert.match(initialText, /整理本周周报/);

  // Emit initial ready + granular bots:changed SSE event updating needsYou badge.
  await act(async () => {
    eventSources[0].emit('open');
    eventSources[0].emit('ready');
    eventSources[0].emit('bots:changed', {
      data: JSON.stringify({
        botIds: ['bot-1'],
        kinds: ['items'],
        needsYou: { counts: { 'bot-1': 3 }, at: Date.now() },
      }),
    });
  });
  await flush();
  assert.match(dom.window.document.body.textContent, /3/);

  // SSE disconnect preserves rendered items; reconnect ready triggers bots.list reconciliation.
  const listBeforeReconnect = rpcCalls.filter((c) => c.method === 'bots.list').length;
  await act(async () => {
    eventSources[0].emit('error', { wasClean: false });
  });
  await flush();
  assert.match(dom.window.document.body.textContent, /审批生产发布计划/, 'SSE disconnect must not clear rendered items');

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1100));
  });
  await flush();
  const reconnectedEs = eventSources.at(-1);
  assert.ok(reconnectedEs && reconnectedEs !== eventSources[0], 'SSE client must open a fresh EventSource on retry');
  await act(async () => {
    reconnectedEs.emit('open');
    reconnectedEs.emit('ready');
  });
  await flush();
  assert.ok(rpcCalls.filter((c) => c.method === 'bots.list').length > listBeforeReconnect, 'SSE reconnect ready must trigger bots.list reconciliation');

  // Opening Create menu -> New bot from sidebar triggers BotsModalHost portal dialog without legacy fullscreen overlay.
  const createTrigger = [...dom.window.document.querySelectorAll('.dsh-bots-header-actions button')].at(-1);
  assert.ok(createTrigger, 'sidebar header must expose create (+) trigger button');
  await act(async () => { createTrigger.click(); });
  await flush();
  const newBotItem = [...dom.window.document.querySelectorAll('.dsh-bots-popover .dsh-bots-menu-item')][0];
  assert.ok(newBotItem, 'create popover must render New bot menu item');
  await act(async () => { newBotItem.click(); });
  await flush();
  const dialog = dom.window.document.querySelector('[role="dialog"]');
  assert.ok(dialog, 'BotsModalHost must portal NewBotDialog into document.body');
  assert.equal(dom.window.document.documentElement.hasAttribute('data-dsh-whale-mode'), false);

  // Escape on the dialog closes the modal cleanly.
  await act(async () => {
    dialog.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await flush();
  assert.equal(dom.window.document.querySelector('[role="dialog"]'), null, 'Escape must dismiss BotsModalHost dialog');
});
