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
  const home = makeTempDir(t, 'whale-sse-host-');
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(() => {
    if (prevHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prevHome;
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
  const cleanups = [];
  const hostCtx = {
    get: (name) => services.get(name),
    provide: (name, value) => services.set(name, value),
    on: () => {},
    effect: (fn) => { const d = fn(); if (typeof d === 'function') cleanups.push(d); },
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
  t.after(() => { for (const fn of cleanups.reverse()) fn?.(); });

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

test('Big Fish client uses SSE + reconnect snapshot reconciliation, needsYou badges, deliverables, review continue, autoAdvance, and /side modal', async (t) => {
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
  const fetchCalls = [];
  let snapshotPayload = {
    cards: [
      {
        id: 'todo-1',
        title: '代码审查任务',
        description: '检查接口变更',
        mode: 'workspace-task',
        cwd: 'C:/work/repo',
        state: 'waiting_approval',
        phase: '等待审批：shell',
        pendingInput: ['approval'],
        sessionId: 'task-sess-1',
        deliverables: [],
        runs: [{ runId: 'r1', attempt: 1, state: 'waiting_approval' }],
        summary: '',
        error: '',
        pinned: false,
        archived: false,
      },
      {
        id: 'todo-2',
        title: '产出周报',
        description: '汇总交付',
        mode: 'workspace-task',
        cwd: 'C:/work/briefs',
        state: 'review',
        phase: '待验收',
        pendingInput: [],
        sessionId: 'task-sess-2',
        deliverables: [{ path: 'C:/work/briefs/weekly.md', description: '本周总结', seq: 4, index: 0, sessionId: 'task-sess-2' }],
        runs: [{ runId: 'r2', attempt: 1, state: 'review' }],
        summary: '已完成三项核心交付总结。',
        error: '',
        pinned: false,
        archived: false,
      },
    ],
    autoAdvance: false,
    needsYou: [
      { kind: 'card', cardId: 'todo-1', title: '代码审查任务', sessionId: 'task-sess-1', state: 'waiting_approval', pendingInput: ['approval'], phase: '等待审批：shell' },
    ],
    activeCount: 1,
  };

  const rpcHandler = async (channel, endpoint, body = {}) => {
    rpcCalls.push({ channel, endpoint, body });
    if (endpoint === 'todos/snapshot') return { ok: true, value: snapshotPayload };
    if (endpoint === 'todos/list') return { ok: true, value: { cards: snapshotPayload.cards } };
    if (endpoint === 'todos/auto-advance') {
      snapshotPayload = { ...snapshotPayload, autoAdvance: body.enabled === true };
      return { ok: true, value: { autoAdvance: snapshotPayload.autoAdvance } };
    }
    if (endpoint === 'todos/continue') {
      return { ok: true, value: { card: { id: body.id, state: 'running', sessionId: 'task-sess-2' } } };
    }
    if (endpoint === 'side/ask') {
      return { ok: true, value: { ok: true, answer: '这是旁路即时回答，不写入主会话。', model: 'deepseek/deepseek-chat' } };
    }
    if (endpoint === 'state' || endpoint === 'ensure' || endpoint === 'settings') {
      return {
        ok: true,
        value: {
          ok: true,
          settings: { enabled: true, bigFishEnabled: true, bigFishTab: 'task', name: '鲸鱼娘', sessionId: 'resident-1', autoAdvance: snapshotPayload.autoAdvance },
          sessionId: 'resident-1',
        },
      };
    }
    return { ok: true, value: { ok: true } };
  };

  const fakeFetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    fetchCalls.push({ url: String(url), method: init.method ?? 'GET', body });
    return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '{"ok":true}' };
  };

  const intervals = [];
  const wrappedSetInterval = (fn, ms) => {
    intervals.push(ms);
    return setInterval(fn, ms);
  };

  const globalValues = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
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
    EventSource: FakeEventSource,
    fetch: fakeFetch,
    setTimeout,
    clearTimeout,
    setInterval: wrappedSetInterval,
    clearInterval,
    AbortController,
    URL,
    URLSearchParams,
    CustomEvent: dom.window.CustomEvent,
  }, { filename: CLIENT_FILE });

  const iconStub = () => null;
  const primitives = {
    Button: React.forwardRef(function StubButton({ children, loading, feedback, variant, size, ...props }, ref) {
      return h('button', { type: 'button', ...props, ref }, children);
    }),
    Input: (props) => h('input', props),
    Modal: ({ open, title, children, footer, onClose }) => (open
      ? h('div', { role: 'dialog', 'aria-label': title },
          title ? h('h3', null, title) : null,
          children,
          footer,
          onClose ? h('button', { type: 'button', onClick: onClose }, '关闭弹窗') : null)
      : null),
    Menu: ({ trigger, children }) => h('div', null, trigger, children),
    SettingsSelect: ({ value, onChange, options = [], ...props }) => h('select', { ...props, value, onChange: (e) => onChange?.(e.target.value) },
      options.map((o) => h('option', { key: o.value, value: o.value }, o.label))),
    StateDot: () => h('span', { className: 'stub-dot' }),
    Switch: ({ checked, onChange, disabled, 'aria-label': ariaLabel }) => h('input', {
      type: 'checkbox',
      checked: Boolean(checked),
      disabled,
      'aria-label': ariaLabel,
      onChange: (e) => onChange?.(e),
    }),
    Toast: ({ text }) => (text ? h('div', { role: 'status' }, text) : null),
    Tooltip: ({ children }) => children,
    IconSettingsOutline16: iconStub,
    IconEllipsisOutline16: iconStub,
    IconPlusOutline16: iconStub,
    IconPanelRightOutline16: iconStub,
    IconPinOutlineRegular: iconStub,
    useModalLayer: () => {},
  };
  const plugin = registration.factory((name) => {
    if (name === 'react') return React;
    if (name === 'react-dom') return clientRequire('react-dom');
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
    return {};
  });

  const registeredSlots = new Map();
  const openedSessions = [];
  const cleanups = [];
  let dictionaries = {};
  plugin.apply({
    effect: (fn) => { const d = fn(); if (typeof d === 'function') cleanups.push(d); },
    locale: {
      register: (_ns, dicts) => { dictionaries = dicts; return () => {}; },
      bind: () => (key) => dictionaries?.zh?.[key] ?? key,
      getLocale: () => ({ active: 'zh' }),
    },
    connection: { rpc: { call: rpcHandler } },
    slots: {
      spec: (name) => name === 'shell.overlay',
      inject: (_name, fn) => fn(),
      register: (opts, comp) => { registeredSlots.set(`${opts.name}:${opts.id}`, { opts, comp }); return () => {}; },
    },
    uiWorkspace: {
      openSession: (id) => openedSessions.push(id),
      activeSessionId: () => 'resident-1',
    },
    sessions: { activeId: () => 'resident-1', open: (id) => openedSessions.push(id) },
    layout: { setSidebarCollapsed: () => {}, sidebarCollapsed: false },
    settingsNavigation: { open: () => {} },
  });

  const workbenchSlot = registeredSlots.get('shell.overlay:dsh-whale.workbench');
  assert.ok(workbenchSlot, 'Big Fish shell.overlay workbench slot must be registered');

  const { createRoot } = clientRequire('react-dom/client');
  const root = createRoot(dom.window.document.querySelector('main'));
  t.after(async () => {
    await act(async () => root.unmount());
    for (const d of cleanups.reverse()) d?.();
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

  const injected = workbenchSlot.opts.inject();
  await act(async () => {
    root.render(h(workbenchSlot.comp, {
      ...injected,
      renderSlot: () => null,
    }));
  });
  await flush();
  await act(async () => {
    injected.mode.set({
      active: true,
      tab: 'task',
      sideOpen: true,
      enabled: true,
      name: '鲸鱼娘',
      sessionId: 'resident-1',
    });
  });
  await flush();

  // Connected via SSE /dsh-whale/events (NO 3000ms polling interval!).
  assert.equal(intervals.includes(3000), false, '3s setInterval polling must be eliminated');
  assert.ok(eventSources.length >= 1 && eventSources.some((es) => es.url.includes('/dsh-whale/events')), 'must subscribe via EventSource /dsh-whale/events');

  // Push initial snapshot over SSE.
  await act(async () => {
    for (const es of eventSources) {
      es.emit('open');
      es.emit('snapshot', { data: JSON.stringify(snapshotPayload) });
    }
  });
  await flush();

  const text = dom.window.document.body.textContent;
  assert.match(text, /代码审查任务/);
  assert.match(text, /等待审批/);
  assert.match(text, /产出周报/);
  assert.match(text, /weekly\.md|本周总结/);

  // SSE disconnect does NOT mark running/waiting_approval card as ended!
  const beforeDisconnectCount = rpcCalls.filter((c) => c.endpoint === 'todos/snapshot').length;
  await act(async () => {
    eventSources[0].emit('error', { wasClean: true });
  });
  await flush();
  assert.match(dom.window.document.body.textContent, /等待审批/, 'SSE disconnect must NEVER falsely mark card as ended');

  // Reconnect triggers full snapshot reconciliation.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1150));
  });
  await flush();
  const latestEs = eventSources.at(-1);
  if (latestEs && !latestEs.closed) {
    await act(async () => { latestEs.emit('open'); });
    await flush();
  }
  const afterReconnectCount = rpcCalls.filter((c) => c.endpoint === 'todos/snapshot').length;
  assert.ok(afterReconnectCount > beforeDisconnectCount, 'SSE reconnect must trigger full todos/snapshot reconciliation');

  // Toggle Auto-advance switch -> RPC todos/auto-advance with enabled: true.
  const autoCheckbox = dom.window.document.querySelector('input[type="checkbox"]');
  assert.ok(autoCheckbox, 'Auto-advance toggle must be rendered');
  await act(async () => { autoCheckbox.click(); });
  await flush();
  const autoCall = rpcCalls.find((c) => c.endpoint === 'todos/auto-advance');
  assert.ok(autoCall && autoCall.body.enabled === true, 'Auto-advance toggle must send enabled: true');

  // Click deliverable Open button -> POST /api/present.open.
  const openDelivBtn = [...dom.window.document.querySelectorAll('.dsh-whale-deliverable-row button')].find((b) => /打开/.test(b.textContent));
  assert.ok(openDelivBtn, 'deliverable Open button must be rendered');
  await act(async () => { openDelivBtn.click(); });
  await flush();
  assert.ok(fetchCalls.some((c) => c.url.includes('present.open')));

  // Review inline follow-up revision: click 追问修订 -> enter feedback -> click 继续执行 -> RPC todos/continue.
  const openContinueBtn = [...dom.window.document.querySelectorAll('button')].find((b) => b.textContent.trim() === '追问修订');
  assert.ok(openContinueBtn, 'review card must render 追问修订 toggle button');
  await act(async () => { openContinueBtn.click(); });
  await flush();
  const followInput = dom.window.document.querySelector('.dsh-whale-continue-box textarea');
  assert.ok(followInput, 'review card must render inline follow-up textarea');
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set;
  await act(async () => {
    setter.call(followInput, '请再补一节结论');
    followInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  const followBtn = [...dom.window.document.querySelectorAll('.dsh-whale-continue-box button')].find((b) => /继续执行/.test(b.textContent));
  assert.ok(followBtn, 'review follow-up submit button must be rendered');
  await act(async () => { followBtn.click(); });
  await flush();
  const contCall = rpcCalls.find((c) => c.endpoint === 'todos/continue');
  assert.ok(contCall, 'review follow-up must call RPC todos/continue');
  assert.equal(contCall.body.id, 'todo-2');
  assert.equal(contCall.body.feedback, '请再补一节结论');

  // Open /side modal and ask a question -> RPC side/ask.
  const sideBtn = [...dom.window.document.querySelectorAll('button')].find((b) => /\/side/.test(b.textContent));
  assert.ok(sideBtn, '/side button must be rendered in Big Fish mode');
  await act(async () => { sideBtn.click(); });
  await flush();
  const sideInput = dom.window.document.querySelector('.dsh-whale-side-qa textarea');
  assert.ok(sideInput, '/side modal textarea must be rendered');
  await act(async () => {
    setter.call(sideInput, '这两个任务谁先跑完？');
    sideInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  const askBtn = [...dom.window.document.querySelectorAll('[role="dialog"] button')].find((b) => /发送|提问/.test(b.textContent));
  assert.ok(askBtn, '/side submit button must be rendered');
  await act(async () => { askBtn.click(); });
  await flush();
  assert.ok(rpcCalls.some((c) => c.endpoint === 'side/ask'));
  assert.match(dom.window.document.body.textContent, /这是旁路即时回答，不写入主会话/);
});
