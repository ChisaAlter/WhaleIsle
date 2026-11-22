'use strict';

const nodeTest = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');
const { gateTests, harnessDependencies, harnessWorkspace } = require('../../scripts/lib/test-prerequisites.cjs');

const HARNESS_DEPS = harnessDependencies();
const HARNESS_WORKSPACE = harnessWorkspace();
const test = gateTests(nodeTest, {
  ok: HARNESS_DEPS.ok && HARNESS_WORKSPACE.ok,
  reason: HARNESS_DEPS.ok ? HARNESS_WORKSPACE.reason : HARNESS_DEPS.reason,
});

const clientPath = path.join(__dirname, '../../vendor/dsh-project/client/client.js');
const clientRequire = createRequire(
  path.join(__dirname, '../../vendor/deepseek-harness/packages/client/ui-conversation/package.json'),
);
const vendorRequire = createRequire(
  path.join(__dirname, '../../vendor/deepseek-harness/package.json'),
);
const React = HARNESS_DEPS.ok ? clientRequire('react') : {};
const { JSDOM } = HARNESS_DEPS.ok ? vendorRequire('jsdom') : {};
const { act, createElement: h } = React;

async function waitFor(check, timeoutMs = 2500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  }
  return check();
}

function setControlValue(dom, el, value) {
  const proto = el.tagName === 'TEXTAREA'
    ? dom.window.HTMLTextAreaElement.prototype
    : el.tagName === 'SELECT'
      ? dom.window.HTMLSelectElement.prototype
      : dom.window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}

async function createDesktopClientBench(t, { locale = 'zh', initialProjects = [] } = {}) {
  const { ProjectService } = await import('../../vendor/dsh-project/tests/harness-runtime.mjs');
  const httpMod = await import(pathToFileURL(path.join(__dirname, '../../vendor/dsh-project/lib/http.js')).href);

  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'whale-project-client-'));
  const home = path.join(tmpRoot, 'dsh-home');
  const repoDir = path.join(tmpRoot, 'repo');
  await fsp.mkdir(home, { recursive: true });
  await fsp.mkdir(repoDir, { recursive: true });

  const openedPaths = [];
  const hostCtx = {
    connection: { admit: () => ({ ok: true }) },
    agents: new Map(),
    get: () => undefined,
  };
  const service = new ProjectService(hostCtx, {
    home,
    desktop: async (action, payload) => {
      openedPaths.push({ action, payload });
      return { ok: true, canonicalPath: payload?.path || '' };
    },
  });

  const seeded = [];
  for (const seed of initialProjects) {
    const project = await service.createProject({
      name: seed.name,
      goal: seed.goal || '',
      workspace: seed.workspace ?? repoDir,
      autonomy: seed.autonomy || 'manual',
      concurrency: seed.concurrency || 2,
    });
    if (seed.coordinatorSessionId) {
      await service.updateProject(project.id, { coordinatorSessionId: seed.coordinatorSessionId });
    }
    seeded.push(project);
  }

  const handler = httpMod.createProjectsHttpHandler(hostCtx, service, { requireConnection: true });
  const server = http.createServer((req, res) => {
    handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const dom = new JSDOM('<!doctype html><html><head></head><body><main></main></body></html>', {
    url: baseUrl,
    pretendToBeVisual: true,
  });

  const saved = Object.fromEntries(
    ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT', 'ResizeObserver', 'EventSource', 'fetch'].map((k) => [
      k,
      Object.getOwnPropertyDescriptor(globalThis, k),
    ]),
  );

  const storage = new Map();
  Object.defineProperty(dom.window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => { storage.set(k, String(v)); },
      removeItem: (k) => { storage.delete(k); },
    },
  });

  const resizeObservers = [];
  class FakeResizeObserver {
    constructor(cb) {
      this.cb = cb;
      this.elements = [];
      resizeObservers.push(this);
    }
    observe(el) {
      this.elements.push(el);
      el.getBoundingClientRect = () => ({ width: 1280, height: 800, left: 0, top: 0, right: 1280, bottom: 800 });
      this.cb([{ target: el, contentRect: { width: 1280, height: 800 } }]);
    }
    disconnect() {}
  }

  const eventSources = [];
  class LiveBridgeEventSource {
    constructor(url, init) {
      this.url = url;
      this.init = init;
      this.listeners = new Map();
      this.closed = false;
      this.unsub = service.subscribeEvents((event) => {
        if (this.closed) return;
        this.emit('update', event);
      });
      eventSources.push(this);
      queueMicrotask(() => {
        if (!this.closed) this.emit('ready', { ok: true });
      });
    }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(fn);
    }
    emit(type, data) {
      const set = this.listeners.get(type);
      if (!set) return;
      for (const fn of [...set]) {
        fn({ type, data: typeof data === 'string' ? data : JSON.stringify(data) });
      }
    }
    close() {
      this.closed = true;
      this.unsub?.();
    }
  }

  const nativeFetch = globalThis.fetch.bind(globalThis);
  const requestLog = [];
  const bridgedFetch = async (input, init = {}) => {
    const rawUrl = typeof input === 'string' ? input : input.url;
    const resolvedUrl = rawUrl.startsWith('http') ? rawUrl : new URL(rawUrl, baseUrl).href;
    requestLog.push({ method: String(init.method || 'GET').toUpperCase(), url: rawUrl });
    return nativeFetch(resolvedUrl, init);
  };

  for (const [k, v] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: FakeResizeObserver,
    EventSource: LiveBridgeEventSource,
    fetch: bridgedFetch,
  })) {
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: v });
  }

  const { createRoot } = clientRequire('react-dom/client');

  let loadedModule = null;
  dom.window.__ModuleLoader__ = { load: (mod) => { loadedModule = mod; } };
  const clientSource = fs.readFileSync(clientPath, 'utf8');
  const intervals = [];

  vm.runInNewContext(
    clientSource,
    {
      window: dom.window,
      document: dom.window.document,
      globalThis,
      console,
      URL,
      EventSource: LiveBridgeEventSource,
      ResizeObserver: FakeResizeObserver,
      fetch: bridgedFetch,
      setTimeout,
      clearTimeout,
      setInterval: (fn, ms) => { intervals.push(ms); return setInterval(fn, ms); },
      clearInterval,
    },
    { filename: clientPath },
  );

  const Button = React.forwardRef(function MockButton({ variant, size, shape, icon, loading, feedback, children, ...rest }, ref) {
    return h('button', { type: 'button', ref, ...rest, disabled: rest.disabled || loading }, icon, children);
  });
  const Input = React.forwardRef(function MockInput({ variant, icon, ...rest }, ref) {
    return h('input', { ref, ...rest });
  });
  const Modal = ({ open, onClose, title, description, closeLabel, children, footer, headless }) =>
    !open
      ? null
      : h(
          'div',
          { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
          headless
            ? children
            : h(
                React.Fragment,
                null,
                h('h2', null, title),
                description && h('p', null, description),
                closeLabel && h('button', { type: 'button', 'aria-label': closeLabel, onClick: onClose }, closeLabel),
                children,
                footer,
              ),
        );
  const Pill = ({ active, onClick, children, ...rest }) =>
    onClick ? h('button', { type: 'button', 'aria-pressed': active ? 'true' : 'false', onClick, ...rest }, children) : h('span', rest, children);
  const SegmentedTabs = ({ items, value, onChange, label }) =>
    h(
      'div',
      { role: 'tablist', 'aria-label': label },
      items.map((item) =>
        h('button', {
          key: item.value,
          id: item.id,
          type: 'button',
          role: 'tab',
          'aria-selected': value === item.value ? 'true' : 'false',
          'aria-controls': item.panelId,
          onClick: () => onChange(item.value),
        }, item.label),
      ),
    );
  const Switch = ({ checked, onChange, label, disabled }) =>
    h('button', { type: 'button', role: 'switch', 'aria-checked': checked ? 'true' : 'false', 'aria-label': label, disabled, onClick: () => onChange(!checked) });
  const StateDot = ({ state }) => h('span', { 'data-state-dot': state });
  const Tag = ({ tone, children }) => h('span', { 'data-tag-tone': tone }, children);
  const Tooltip = ({ children }) => children;
  const Toast = ({ text }) => h('div', { role: 'alert', 'data-toast': 'true' }, text);

  const plugin = loadedModule.factory((id) => {
    if (id === 'react') return React;
    if (id === '@deepseek-ai/dsh-client-ui-primitives') {
      return { Button, Input, Modal, Pill, SegmentedTabs, Switch, StateDot, Tag, Tooltip, Toast };
    }
    throw new Error(`Unexpected module require: ${id}`);
  });

  const registeredSlots = new Map();
  const registeredLocales = new Map();
  const createdSessions = [];
  const retainedSessions = [];
  const releasedSessions = [];
  const promptCalls = [];

  const clientCtx = {
    effect: (fn) => { fn(); },
    locale: {
      getLocale: () => ({ active: locale }),
      register: (ns, dicts) => { registeredLocales.set(ns, dicts); return () => {}; },
    },
    slots: {
      inject: (_name, cb) => { cb(); },
      register: (meta, component) => {
        registeredSlots.set(`${meta.name}:${meta.key || meta.id || 'default'}`, { meta, component });
        return () => {};
      },
    },
    get: (name) => {
      if (name === 'uiWorkspace') {
        return {
          pickDirectory: async () => repoDir,
          unarchiveSession: async () => {},
        };
      }
      if (name === 'sessions') {
        return {
          create: async (opts) => {
            const sid = `sess-coord-${createdSessions.length + 1}`;
            createdSessions.push({ sid, opts });
            return sid;
          },
          retain: (target, opts) => {
            const ref = {
              target,
              opts,
              ready: Promise.resolve(),
              release: () => { releasedSessions.push(target); },
              binding: {
                session: {
                  prompt: async (blocks, mode) => {
                    promptCalls.push({ target, blocks, mode });
                    return { ok: true };
                  },
                },
              },
            };
            retainedSessions.push(ref);
            return ref;
          },
        };
      }
      return undefined;
    },
  };

  plugin.apply(clientCtx);

  const container = dom.window.document.querySelector('main');
  const root = createRoot(container);
  const factoryCalls = [];

  const SessionProvider = ({ session, children }) =>
    h('div', { 'data-session-provider': typeof session?.target === 'string' ? session.target : JSON.stringify(session?.target) }, children);

  const renderSlot = (slotName, slotProps) => {
    const entry = registeredSlots.get(`${slotName}:default`);
    if (!entry) return null;
    return h(entry.component, {
      ...slotProps,
      sessionId: 'sess-mock',
      useSession: (sel) => sel({ blank: false, awaitingFirstTurn: false, running: false, openState: 'open' }),
      useSessions: (sel) => sel({ byId: {} }),
      renderFactorySlot: (name, args, opts) => {
        factoryCalls.push({ name, args, opts });
        const Views = opts?.slots?.views;
        return h(
          'div',
          { 'data-embedded-conv': args.variant },
          Views ? h(Views, { renderSlot: (n, p) => h('div', { 'data-conv-view': `${n}:${p.view}` }) }) : null,
        );
      },
    });
  };

  const mountPage = async () => {
    const mainEntry = registeredSlots.get('main:projects');
    await act(async () => {
      root.render(
        h(mainEntry.component, {
          SessionProvider,
          renderSlot,
          useWorkspaces: (sel) => sel({ archivedSessionIds: [] }),
        }),
      );
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
  };

  t.after(async () => {
    await act(async () => { root.unmount(); });
    for (const es of eventSources) es.close();
    handler.closeAllStreams();
    service.dispose();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    for (const [k, desc] of Object.entries(saved)) {
      if (desc) Object.defineProperty(globalThis, k, desc);
      else delete globalThis[k];
    }
    dom.window.close();
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  });

  return {
    dom,
    container,
    service,
    home,
    repoDir,
    seeded,
    clientSource,
    registeredSlots,
    registeredLocales,
    requestLog,
    openedPaths,
    createdSessions,
    retainedSessions,
    releasedSessions,
    promptCalls,
    factoryCalls,
    eventSources,
    intervals,
    mountPage,
  };
}

test('desktop client registers exact v2 4-slot surface with zero legacy rail, RPC, or design-language violations', async (t) => {
  const b = await createDesktopClientBench(t);

  assert.deepEqual(
    [...b.registeredSlots.keys()].sort(),
    [
      'main:projects',
      'projects.conversation:default',
      'sidebar.panellist:projects',
      'tool.call.toolview:projects_dispatch',
    ],
  );
  assert.ok(b.registeredLocales.has('dsh-project'));
  assert.equal(b.registeredLocales.get('dsh-project').zh.nav, '项目');
  assert.equal(b.registeredLocales.get('dsh-project').en.nav, 'Projects');

  // Guard against v1 regressions and design-language violations.
  assert.doesNotMatch(b.clientSource, /dsh-project-task-rail/);
  assert.doesNotMatch(b.clientSource, /\/dsh-project\b/);
  assert.doesNotMatch(b.clientSource, /registerSessionNavigation/);
  assert.doesNotMatch(b.clientSource, /window\.confirm\s*\(/);
  assert.doesNotMatch(b.clientSource, /window\.innerWidth/);
  assert.doesNotMatch(b.clientSource, /#[0-9a-fA-F]{3,8}\b/);
  assert.equal(b.intervals.length, 0, 'SSE must replace polling intervals');
});

test('desktop client communicates end-to-end with real /projects-api router, persists project.json, opens workspace path, and syncs SSE task updates', async (t) => {
  const b = await createDesktopClientBench(t);
  await b.mountPage();

  // 1. Create a new project via the New Project modal + directory picker -> real POST /projects-api/projects.
  const newBtn = [...b.container.querySelectorAll('button')].find((el) => el.textContent.includes('新建项目'));
  assert.ok(newBtn, 'New Project button should be rendered');
  await act(async () => { newBtn.click(); });

  const dlg = b.container.querySelector('[role="dialog"][aria-label="新建项目"]');
  assert.ok(dlg, 'New Project modal should open');

  const pickBtn = [...dlg.querySelectorAll('button')].find((el) => el.textContent.includes('选择文件夹'));
  assert.ok(pickBtn);
  await act(async () => { pickBtn.click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

  const nameInput = dlg.querySelector('input[aria-label="项目名称"]');
  const goalInput = dlg.querySelector('textarea');
  await act(async () => {
    setControlValue(b.dom, nameInput, 'Whale Desktop Board');
    if (goalInput) setControlValue(b.dom, goalInput, 'Ship real v2 three-pane board.');
  });

  const createBtn = [...dlg.querySelectorAll('button')].find((el) => el.textContent.includes('创建项目'));
  assert.ok(createBtn);
  await act(async () => { createBtn.click(); });

  const openDirBtn = await waitFor(() => b.container.querySelector('button.pj-ws-pill'));
  const persistedList = await b.service.listProjects();
  assert.equal(persistedList.length, 1);
  const projectId = persistedList[0].id;
  assert.equal(persistedList[0].name, 'Whale Desktop Board');
  assert.equal(persistedList[0].workspace, b.repoDir);
  assert.equal(fs.existsSync(path.join(b.home, 'projects', projectId, 'project.json')), true);

  // 2. Click workspace path capsule -> hits real POST /projects-api/open-path -> invokes desktop open-path bridge.
  assert.ok(openDirBtn, 'Workspace capsule button should render in coordinator header');
  await act(async () => { openDirBtn.click(); });
  await waitFor(() => b.openedPaths.length === 1);
  assert.equal(b.openedPaths.length, 1);
  assert.equal(b.openedPaths[0].action, 'open-path');
  assert.equal(b.openedPaths[0].payload.projectId, projectId);

  // 3. Toggle autonomy and pause from header -> persists through real PATCH /projects-api/projects/:id.
  const autonomyBtn = await waitFor(() => {
    const btn = b.container.querySelector('button[aria-label="派发模式"]');
    return btn && !btn.disabled ? btn : null;
  });
  assert.ok(autonomyBtn);
  await act(async () => { autonomyBtn.click(); });
  await waitFor(async () => (await b.service.readProject(projectId)).autonomy === 'auto');
  assert.equal((await b.service.readProject(projectId)).autonomy, 'auto');

  const pauseBtn = await waitFor(() => {
    const btn = b.container.querySelector('button[aria-label="暂停派发"]');
    return btn && !btn.disabled ? btn : null;
  });
  assert.ok(pauseBtn);
  await act(async () => { pauseBtn.click(); });
  await waitFor(async () => (await b.service.readProject(projectId)).paused === true);
  assert.equal((await b.service.readProject(projectId)).paused, true);

  // Resume & switch back to manual so quick-approve button renders on new queued task.
  await b.service.updateProject(projectId, { paused: false, autonomy: 'manual' });
  await act(async () => { await new Promise((r) => setTimeout(r, 40)); });

  // 4. Start coordinator session -> binds coordinatorSessionId and embeds native conversation.content slot.
  const startCoordBtn = await waitFor(() =>
    [...b.container.querySelectorAll('button')].find((el) => el.textContent.includes('启动协调者')),
  );
  assert.ok(startCoordBtn);
  await act(async () => { startCoordBtn.click(); });
  await waitFor(() => b.container.querySelector('[data-embedded-conv="embedded"]'));

  assert.equal(b.createdSessions.length, 1);
  assert.equal((await b.service.readProject(projectId)).coordinatorSessionId, 'sess-coord-1');
  assert.ok(b.container.querySelector('[data-embedded-conv="embedded"]'));
  assert.ok(b.factoryCalls.some((c) => c.name === 'conversation.content' && c.args.variant === 'embedded'));

  // 5. Backend adds a task -> SSE event refreshes right Threads pane -> Quick Approve persists to disk.
  const { task } = await b.service.addTask(projectId, {
    title: 'Verify live SSE sync',
    brief: 'Ensure task arrives via /projects-api/events',
  });
  const approveBtn = await waitFor(() =>
    [...b.container.querySelectorAll('.pj-task-quick button')].find((el) => el.textContent.trim() === '批准'),
  );
  assert.match(b.container.textContent, /Verify live SSE sync/);
  assert.ok(approveBtn, 'Queued unapproved task should show quick Approve button');
  await act(async () => { approveBtn.click(); });
  await waitFor(async () => (await b.service.readProject(projectId)).tasks.find((item) => item.id === task.id)?.approved === true);

  const afterApprove = await b.service.readProject(projectId);
  assert.equal(afterApprove.tasks.find((item) => item.id === task.id)?.approved, true);

  // Verify every API call targeted /projects-api and never touched legacy /dsh-project.
  assert.ok(b.requestLog.length > 0);
  assert.ok(b.requestLog.every((req) => req.url.startsWith('/projects-api')));
});
