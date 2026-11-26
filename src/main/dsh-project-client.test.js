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

async function waitFor(check, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let result;
    await act(async () => {
      result = await check();
    });
    if (result) return result;
    await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  }
  let finalResult;
  await act(async () => {
    finalResult = await check();
  });
  if (!finalResult) {
    throw new assert.AssertionError({
      message: `waitFor timed out after ${timeoutMs}ms: ${check.toString()}`,
      expected: 'truthy value',
      actual: finalResult,
    });
  }
  return finalResult;
}

async function flushUi(ms = 110) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
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

async function createDesktopClientBench(
  t,
  { locale = 'zh', initialProjects = [], containerWidth = 1280, provideWorkspacesOpenPath = false, interceptFetch = null } = {},
) {
  const { ProjectService } = await import('../../vendor/dsh-project/tests/harness-runtime.mjs');
  const httpMod = await import(pathToFileURL(path.join(__dirname, '../../vendor/dsh-project/lib/http.js')).href);

  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'whale-project-client-'));
  const home = path.join(tmpRoot, 'dsh-home');
  const repoDir = path.join(tmpRoot, 'repo');
  await fsp.mkdir(home, { recursive: true });
  await fsp.mkdir(repoDir, { recursive: true });

  const openedPaths = [];
  const hostCreatedSessions = [];
  const hostArchivedSessions = [];
  const hostSessionsById = new Map();

  const sessionController = {
    async create(opts = {}) {
      const id = `sess-coord-${hostCreatedSessions.length + 1}`;
      const rec = { id, cwd: opts.cwd || '', presentation: opts.presentation };
      hostCreatedSessions.push(rec);
      hostSessionsById.set(id, rec);
      return { id, sessionId: id };
    },
    async inspect(id) {
      const found = hostSessionsById.get(id);
      if (!found) {
        const err = new Error(`Session not found: ${id}`);
        err.name = 'ApiSessionNotFound';
        throw err;
      }
      return found;
    },
    async updatePresentation(id, presentation) {
      const found = hostSessionsById.get(id);
      if (found) found.presentation = presentation;
      return { ok: true };
    },
  };

  const workspaceRegistry = {
    archived: new Set(),
    isArchived(id) { return this.archived.has(id); },
    async archiveSession(id) {
      this.archived.add(id);
      hostArchivedSessions.push(id);
      return { ok: true };
    },
    async unarchiveSession(id) {
      this.archived.delete(id);
      return { ok: true };
    },
  };

  const hostCtx = {
    connection: { admit: () => ({ peer: { principal: { kind: 'owner' } } }) },
    sessionController,
    workspaceRegistry,
    agents: new Map(),
    get: (name) => {
      if (name === 'connection') return hostCtx.connection;
      if (name === 'sessionController') return sessionController;
      if (name === 'workspaceRegistry') return workspaceRegistry;
      return undefined;
    },
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
      hostSessionsById.set(seed.coordinatorSessionId, { id: seed.coordinatorSessionId, cwd: project.workspace });
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
    ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT', 'ResizeObserver', 'EventSource', 'fetch', 'Notification'].map((k) => [
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

  let currentWidth = containerWidth;
  const resizeObservers = [];
  class FakeResizeObserver {
    constructor(cb) {
      this.cb = cb;
      this.elements = [];
      resizeObservers.push(this);
    }
    observe(el) {
      this.elements.push(el);
      el.getBoundingClientRect = () => ({ width: currentWidth, height: 800, left: 0, top: 0, right: currentWidth, bottom: 800 });
      this.cb([{ target: el, contentRect: { width: currentWidth, height: 800 } }]);
    }
    disconnect() {}
    trigger(width) {
      currentWidth = width;
      for (const el of this.elements) {
        el.getBoundingClientRect = () => ({ width, height: 800, left: 0, top: 0, right: width, bottom: 800 });
      }
      this.cb([{ target: this.elements[0], contentRect: { width, height: 800 } }]);
    }
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
    const method = String(init.method || 'GET').toUpperCase();
    requestLog.push({ method, url: rawUrl });
    if (typeof interceptFetch === 'function') {
      const custom = await interceptFetch({ method, url: rawUrl, init });
      if (custom) {
        return {
          ok: custom.status >= 200 && custom.status < 300,
          status: custom.status,
          json: async () => custom.body,
        };
      }
    }
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
  const SegmentedControl = ({ id, options, value, onChange, label, disabled }) =>
    h(
      'div',
      { role: 'tablist', 'aria-label': label },
      options.map((opt) =>
        h('button', {
          key: opt.value,
          id: `${id}-${opt.value}`,
          type: 'button',
          role: 'tab',
          'aria-selected': value === opt.value ? 'true' : 'false',
          disabled: disabled || opt.disabled,
          onClick: () => onChange(opt.value),
        }, opt.label),
      ),
    );
  const Switch = ({ checked, onChange, label, disabled }) =>
    h('button', { type: 'button', role: 'switch', 'aria-checked': checked ? 'true' : 'false', 'aria-label': label, disabled, onClick: () => onChange(!checked) });
  const StateDot = ({ state }) => h('span', { 'data-state-dot': state });
  const Tag = ({ tone, children }) => h('span', { 'data-tag-tone': tone }, children);
  const Tooltip = ({ children }) => children;
  const toastsSeen = [];
  const Toast = ({ text, holdMs }) => {
    toastsSeen.push({ text, holdMs });
    return h('div', { role: 'alert', 'data-toast': 'true', 'data-hold-ms': String(holdMs) }, text);
  };

  const plugin = loadedModule.factory((id) => {
    if (id === 'react') return React;
    if (id === '@deepseek-ai/dsh-client-ui-primitives') {
      return { Button, Input, Modal, Pill, SegmentedTabs, SegmentedControl, Switch, StateDot, Tag, Tooltip, Toast };
    }
    throw new Error(`Unexpected module require: ${id}`);
  });

  const registeredSlots = new Map();
  const registeredLocales = new Map();
  const retainedSessions = [];
  const releasedSessions = [];
  const promptCalls = [];
  const workspaceOpenedPaths = [];
  let pickerUsed = '';

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
      if (name === 'workspaces' && provideWorkspacesOpenPath) {
        return {
          openPath: async (target, opts) => {
            workspaceOpenedPaths.push({ target, opts });
          },
        };
      }
      if (name === 'uiWorkspace') {
        return {
          selectDirectory: async () => { pickerUsed = 'selectDirectory'; return repoDir; },
          pickDirectory: async () => { pickerUsed = 'pickDirectory'; return repoDir; },
          unarchiveSession: async (sid) => { await workspaceRegistry.unarchiveSession(sid); },
        };
      }
      if (name === 'sessions') {
        return {
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
      useSession: (sel) => sel({ blank: true, awaitingFirstTurn: true, running: false, openState: 'open' }),
      useSessions: (sel) => sel({ byId: {} }),
      renderFactorySlot: (name, args, opts) => {
        factoryCalls.push({ name, args, opts });
        const Views = opts?.slots?.views;
        return h(
          'div',
          { 'data-embedded-conv': args.variant, 'data-embedded-hero': String(args.hero), 'data-embedded-phase': args.phase },
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
          useWorkspaces: (sel) => sel({ archivedSessionIds: [...workspaceRegistry.archived] }),
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
    await fsp.rm(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
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
    workspaceOpenedPaths,
    hostCreatedSessions,
    hostArchivedSessions,
    retainedSessions,
    releasedSessions,
    promptCalls,
    factoryCalls,
    eventSources,
    intervals,
    toastsSeen,
    resizeObservers,
    getPickerUsed: () => pickerUsed,
    mountPage,
  };
}

test('desktop client registers exact 4-slot surface with zero legacy rail, hex colors, or persistent toast violations', async (t) => {
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

  // Guard against legacy regressions and design-language violations.
  assert.doesNotMatch(b.clientSource, /dsh-project-task-rail/);
  assert.doesNotMatch(b.clientSource, /\/dsh-project\b/);
  assert.doesNotMatch(b.clientSource, /registerSessionNavigation/);
  assert.doesNotMatch(b.clientSource, /window\.confirm\s*\(/);
  assert.doesNotMatch(b.clientSource, /window\.innerWidth/);
  assert.doesNotMatch(b.clientSource, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(b.clientSource, /holdMs:\s*null/);
  assert.doesNotMatch(b.clientSource, /pj-modal-solid/);
  assert.doesNotMatch(b.clientSource, /The board of the DSH project/);
  assert.doesNotMatch(b.clientSource, /启动协调者/);
  // Design-language & motion contract static guards.
  assert.doesNotMatch(b.clientSource, /transition:\s*width\b/);
  assert.doesNotMatch(b.clientSource, /@keyframes\s+pj-breathe/);
  assert.doesNotMatch(b.clientSource, /\b11px\b/);
  assert.doesNotMatch(b.clientSource, /13px;line-height:18px/);
  assert.doesNotMatch(b.clientSource, /size:\s*15\b/);
  assert.match(b.clientSource, /\.pj-sdot\{[^}]*border-radius:50%;corner-shape:round/);
  assert.match(b.clientSource, /\.pj-settings-nav-btn:focus-visible\{outline:2px solid var\(--dsw-alias-label-primary\);outline-offset:-2px\}/);
  assert.match(b.clientSource, /:root\[data-dsh-minimal\]/);
  assert.match(b.clientSource, /Primitives\.usePresence/);
  assert.match(b.clientSource, /Primitives\.FlipText/);
  assert.match(b.clientSource, /'data-dsh-motion':\s*'popover'/);
  assert.match(b.clientSource, /'data-dsh-motion':\s*'overlay'/);
  assert.doesNotMatch(b.clientSource, /return\s+t\('(?:rulesSaved|libraryRefAdded|libraryRefRemoved|diffFeedbackSent|memoryDeleted|projectDeleted)'\)/);
  assert.doesNotMatch(b.clientSource, /return\s+archive\s*&&[\s\S]*deleteArchived/);
  assert.equal(b.intervals.length, 0, 'SSE must replace polling intervals');
});

test('zero-project empty state renders centered single canvas with no empty split columns or repeated titles', async (t) => {
  const b = await createDesktopClientBench(t);
  await b.mountPage();

  const emptySection = await waitFor(() => b.container.querySelector('[data-projects-empty="true"]'));
  assert.ok(emptySection, 'Centered empty state should render when there are 0 projects');
  assert.equal(b.container.querySelector('[data-projects-tasks-panel]'), null, 'No empty right tasks column on 0 projects');
  assert.equal(b.container.querySelector('.pj-list'), null, 'No nested left project list column');
  assert.match(emptySection.textContent, /用项目并行推进复杂目标/);
  assert.match(emptySection.textContent, /新建项目/);
});

test('full workspace lifecycle: create -> auto-ensure isolated coordinator -> 0-task auto-collapse -> SSE auto-expand -> wide task detail -> overview & delete', async (t) => {
  const b = await createDesktopClientBench(t);
  await b.mountPage();

  // 1. Open New Project modal, verify inline empty-name validation (no persistent toast), pick directory via selectDirectory, create.
  const newBtn = await waitFor(() => [...b.container.querySelectorAll('button')].find((el) => el.textContent.includes('新建项目')));
  assert.ok(newBtn);
  await act(async () => { newBtn.click(); });

  const dlg = b.container.querySelector('[role="dialog"][aria-label="新建项目"]');
  assert.ok(dlg, 'New Project modal should open');

  const createBtn = [...dlg.querySelectorAll('button')].find((el) => el.textContent.includes('创建项目'));
  assert.ok(createBtn);
  await act(async () => { createBtn.click(); });
  assert.ok(dlg.querySelector('input[aria-invalid="true"]'), 'Empty project name should show inline invalid state');
  assert.equal(b.toastsSeen.length, 0, 'Inline validation must not emit error toast');

  const pickBtn = [...dlg.querySelectorAll('button')].find((el) => el.textContent.includes('选择文件夹'));
  assert.ok(pickBtn);
  await act(async () => { pickBtn.click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  assert.equal(b.getPickerUsed(), 'selectDirectory', 'Should prefer uiWorkspace.selectDirectory()');

  const nameInput = dlg.querySelector('input[aria-label="项目名称"]');
  const goalInput = dlg.querySelector('textarea');
  await act(async () => {
    setControlValue(b.dom, nameInput, 'Whale Redesign');
    setControlValue(b.dom, goalInput, 'Keep layout crisp and wide.');
  });

  await act(async () => { createBtn.click(); });

  // 2. Enters Workspace automatically, auto-ensures isolated coordinator session with ZERO English prompt messages!
  const embedded = await waitFor(() => b.container.querySelector('[data-embedded-conv="embedded"]'));
  await flushUi();
  assert.ok(embedded, 'Coordinator embedded conversation should mount automatically without Start Coordinator gate');
  assert.equal(embedded.getAttribute('data-embedded-hero'), 'false', 'Embedded conversation must not flash Welcome Hero');
  assert.equal(embedded.getAttribute('data-embedded-phase'), 'active');
  assert.equal(b.promptCalls.length, 0, 'Must NEVER send automatic English prompt message');
  assert.equal(b.hostCreatedSessions.length, 1);
  assert.equal(b.hostCreatedSessions[0].presentation?.owner, 'dsh-project');

  const persistedList = await b.service.listProjects();
  assert.equal(persistedList.length, 1);
  const projectId = persistedList[0].id;
  assert.equal(fs.existsSync(path.join(b.home, 'projects', projectId, 'project.json')), true);

  // 3. With 0 tasks and 0 references, right drawer auto-collapses and topbar toggle shows "线程 · 0".
  assert.equal(b.container.querySelector('[data-projects-tasks-panel]'), null, 'Right drawer must default collapsed when 0 tasks & 0 references');
  const zeroTasksToggle = b.container.querySelector('button.pj-tasks-toggle');
  assert.ok(zeroTasksToggle);
  assert.match(zeroTasksToggle.textContent, /线程\s*·\s*0/, 'Topbar drawer toggle must display explicit count even at 0 tasks');
  assert.equal((await b.service.readProject(projectId)).autonomy, 'auto', 'New project must default to auto parallel mode');

  // 4. Workspace capsule opens folder, topbar autonomy & pause pills persist via PATCH.
  const openDirBtn = b.container.querySelector('button.pj-ws-pill');
  assert.ok(openDirBtn, 'Workspace capsule should render in unified 48px topbar');
  await act(async () => { openDirBtn.click(); });
  await waitFor(() => b.openedPaths.length === 1);
  assert.equal(b.openedPaths[0].action, 'open-path');
  assert.equal(b.openedPaths[0].payload.projectId, projectId);

  const autonomyBtn = b.container.querySelector('button[aria-label="派发模式"]');
  assert.ok(autonomyBtn);
  await act(async () => { autonomyBtn.click(); });
  await waitFor(async () => (await b.service.readProject(projectId)).autonomy === 'manual');
  await flushUi();

  const pauseBtn = b.container.querySelector('button[aria-label="暂停派发"]');
  assert.ok(pauseBtn);
  await act(async () => { pauseBtn.click(); });
  await waitFor(async () => (await b.service.readProject(projectId)).paused === true);
  await flushUi();

  await act(async () => {
    await b.service.updateProject(projectId, { paused: false, autonomy: 'manual' });
  });
  await flushUi();

  // 5. Backend adds a task -> SSE updates -> right Tasks panel auto-expands, no raw taskId chip, Quick Approve works.
  let task;
  await act(async () => {
    ({ task } = await b.service.addTask(projectId, {
      title: 'Verify live SSE sync',
      brief: 'Ensure task arrives via /projects-api/events',
    }));
  });
  await flushUi();

  const tasksPanel = await waitFor(() => b.container.querySelector('[data-projects-tasks-panel="true"]'));
  assert.ok(tasksPanel, 'Tasks panel should auto-expand when tasks appear');
  assert.match(b.container.querySelector('button.pj-tasks-toggle')?.textContent || '', /线程\s*·\s*1/);
  assert.match(tasksPanel.textContent, /Verify live SSE sync/);
  assert.doesNotMatch(tasksPanel.textContent, new RegExp(task.id.slice(0, 10)), 'Must not render raw internal task.id chip');

  const approveBtn = await waitFor(() =>
    [...tasksPanel.querySelectorAll('.pj-task-quick button')].find((el) => el.textContent.trim() === '批准'),
  );
  assert.ok(approveBtn, 'Queued unapproved task should show non-overlapping Approve action');
  await act(async () => { approveBtn.click(); });
  await waitFor(async () => (await b.service.readProject(projectId)).tasks.find((item) => item.id === task.id)?.approved === true);
  await flushUi();

  // 6. Click task card -> opens Wide Task Detail inside .pj-stage (NOT inside .pj-exec), switch to Diff tab, return to Coordinator.
  const taskCard = tasksPanel.querySelector('.pj-task-card');
  assert.ok(taskCard);
  await act(async () => { taskCard.click(); });
  await flushUi(40);

  const detailStage = await waitFor(() => b.container.querySelector('.pj-stage [data-projects-task-detail]'));
  assert.ok(detailStage, 'Task detail must drill in inside the wide main stage (.pj-stage)');
  assert.equal(tasksPanel.querySelector('[data-projects-task-detail]'), null, 'Task detail must not cram inside narrow tasks panel');

  const diffTab = detailStage.querySelector('#pj-tab-diff');
  assert.ok(diffTab);
  await act(async () => { diffTab.click(); });
  await waitFor(() => detailStage.querySelector('#pj-panel-diff'));
  await flushUi(40);

  const backCoordBtn = [...detailStage.querySelectorAll('button')].find((el) => el.textContent.includes('返回协调者'));
  assert.ok(backCoordBtn);
  await act(async () => { backCoordBtn.click(); });
  await waitFor(() => b.container.querySelector('.pj-stage [data-embedded-conv="embedded"]'));
  await flushUi(40);

  // 7. Navigate to Overview via topbar back button, then delete project via 2-step confirmation modal -> returns to empty state!
  const allProjectsBtn = b.container.querySelector('button[aria-label="全部项目"]');
  assert.ok(allProjectsBtn);
  await act(async () => { allProjectsBtn.click(); });
  const overview = await waitFor(() => b.container.querySelector('[data-projects-overview="true"]'));
  assert.ok(overview, 'Overview card grid should render');
  assert.match(overview.textContent, /Whale Redesign/);

  const delCardBtn = overview.querySelector('button[aria-label^="删除项目"]');
  assert.ok(delCardBtn);
  await act(async () => { delCardBtn.click(); });
  const delModal = await waitFor(() => b.container.querySelector('[role="dialog"][aria-label*="永久删除该项目"]'));
  assert.ok(delModal, 'Delete project confirmation modal should open');

  const confirmDelBtn = [...delModal.querySelectorAll('button')].find((el) => el.textContent.includes('确认删除项目'));
  assert.ok(confirmDelBtn);
  await act(async () => { confirmDelBtn.click(); });

  await waitFor(() => b.container.querySelector('[data-projects-empty="true"]'));
  await flushUi();
  assert.equal((await b.service.listProjects()).length, 0);
  assert.ok(b.hostArchivedSessions.includes('sess-coord-1'), 'Deleting project with archiveSessions=true should archive coordinator session');

  // Verify zero routine success toasts were emitted for create/approve/delete (and any emitted Toast auto-dismisses).
  assert.equal(b.toastsSeen.length, 0, `Routine actions must not emit success toasts, got: ${JSON.stringify(b.toastsSeen)}`);
  assert.ok(b.requestLog.length > 0);
  assert.ok(b.requestLog.every((req) => req.url.startsWith('/projects-api')));
});

test('topbar project switcher, agentPreset settings save, and narrow-width tasks overlay work cleanly', async (t) => {
  const b = await createDesktopClientBench(t, {
    initialProjects: [
      { name: 'Project One', goal: 'First goal' },
      { name: 'Project Two', goal: 'Second goal' },
    ],
  });
  await b.mountPage();
  await flushUi();

  // Switch between Project One and Project Two via topbar switcher.
  const switcherBtn = await waitFor(() => b.container.querySelector('button[aria-label="切换项目"]'));
  assert.ok(switcherBtn);
  const initialName = switcherBtn.textContent.trim();
  const targetName = initialName === 'Project One' ? 'Project Two' : 'Project One';

  await act(async () => { switcherBtn.click(); });
  const menuItem = await waitFor(() =>
    [...b.container.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent.includes(targetName)),
  );
  assert.ok(menuItem, 'Switcher dropdown should list other projects');
  await act(async () => { menuItem.click(); });
  await waitFor(() => b.container.querySelector('button[aria-label="切换项目"]')?.textContent.includes(targetName));
  await flushUi();

  // Open Settings, update agentPreset and project instructions + name via unified Save.
  const settingsBtn = b.container.querySelector('button[aria-label="项目设置"]');
  assert.ok(settingsBtn);
  await act(async () => { settingsBtn.click(); });
  const settingsDlg = await waitFor(() => b.container.querySelector('[role="dialog"][aria-label="项目设置"]'));
  assert.ok(settingsDlg);

  const presetInput = settingsDlg.querySelector('input[aria-label="默认预设"]');
  assert.ok(presetInput, 'Settings modal should expose agentPreset control');
  await act(async () => {
    presetInput.focus();
    setControlValue(b.dom, presetInput, 'coder-fast');
    presetInput.blur();
  });
  await flushUi();

  const targetProj = (await b.service.listProjects()).find((p) => p.name === targetName);
  await waitFor(async () => (await b.service.readProject(targetProj.id)).agentPreset === 'coder-fast');
  await flushUi(140);
  assert.equal((await b.service.readProject(targetProj.id)).agentPreset, 'coder-fast');

  // Close settings, add a task, shrink container below EXEC_DOCK_MIN (680px), and toggle Tasks drawer -> renders as overlay!
  const closeSettingsBtn = settingsDlg.querySelector('button[aria-label="关闭"]');
  await act(async () => { closeSettingsBtn.click(); });
  await act(async () => {
    await b.service.addTask(targetProj.id, { title: 'Overlay check task', brief: 'Check narrow width' });
  });
  await flushUi();

  // Wide container (1280px) shows workspace capsule cleanly in topbar.
  assert.ok(b.container.querySelector('button.pj-ws-pill'), 'Wide topbar should display workspace capsule');
  assert.equal(b.container.querySelector('[data-projects-topbar]')?.getAttribute('data-compact'), 'false');

  await act(async () => {
    b.resizeObservers[0].trigger(624);
  });
  await flushUi(40);
  // Narrow container (< 780px) hides workspace capsule instead of crushing it into a clipped dot, and keeps tasks closed in auto mode.
  assert.equal(b.container.querySelector('button.pj-ws-pill'), null, 'Narrow topbar must hide workspace capsule to avoid clipped dot');
  assert.equal(b.container.querySelector('[data-projects-topbar]')?.getAttribute('data-compact'), 'true');
  assert.equal(b.container.querySelector('[data-projects-tasks-panel]'), null);

  const toggleTasksBtn = b.container.querySelector('button.pj-tasks-toggle');
  assert.ok(toggleTasksBtn);
  await act(async () => { toggleTasksBtn.click(); });
  const overlayPanel = await waitFor(() => b.container.querySelector('.pj-exec.pj-exec-overlay'));
  assert.ok(overlayPanel, 'Opening tasks panel on narrow container must render as glass overlay without crushing main stage');
  await flushUi(40);
});

test('3-tab context drawer: action-first threads order, Library add/preview/remove & artifacts, inline Rules edit & Memory pin/search', async (t) => {
  const b = await createDesktopClientBench(t, {
    provideWorkspacesOpenPath: true,
    initialProjects: [
      { name: 'Claude Projects Parity', goal: 'Initial project rule.', autonomy: 'auto' },
    ],
  });
  const project = b.seeded[0];

  // Create real files inside repoDir for Library reference + task artifact testing.
  const docsDir = path.join(b.repoDir, 'docs');
  await fsp.mkdir(docsDir, { recursive: true });
  const specFile = path.join(docsDir, 'architecture.md');
  const artifactFile = path.join(docsDir, 'report.md');
  await fsp.writeFile(specFile, '# Architecture Spec\n', 'utf8');
  await fsp.writeFile(artifactFile, '# Worker Delivery Report\n', 'utf8');

  // Seed tasks across statuses to verify action-first group ordering: waiting -> running -> review -> idle -> resolved.
  const { task: runTask } = await b.service.addTask(project.id, { title: 'Running stream', brief: 'Active work' });
  await b.service.updateTask(project.id, runTask.id, { status: 'running' });
  const { task: waitTask } = await b.service.addTask(project.id, { title: 'Blocked API decision', brief: 'Need user input' });
  await b.service.updateTask(project.id, waitTask.id, { status: 'blocked' });
  const { task: revTask } = await b.service.addTask(project.id, { title: 'Deliver architecture report', brief: 'Produce doc' });
  await b.service.updateTask(project.id, revTask.id, {
    status: 'review',
    artifacts: [{ path: artifactFile, title: 'Architecture Report', kind: 'doc' }],
  });

  // Seed two shared memory topics via real HTTP API (one with sourceTaskId for task jump testing).
  await fetch(`/projects-api/projects/${project.id}/memory`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-projects-api': '1' },
    body: JSON.stringify({
      name: 'routing-rules',
      description: 'Core HTTP routing conventions',
      type: 'reference',
      text: 'All project routes live under /projects-api with CSRF header.',
      sourceTaskId: revTask.id,
    }),
  });
  await fetch(`/projects-api/projects/${project.id}/memory`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-projects-api': '1' },
    body: JSON.stringify({
      name: 'release-checklist',
      description: 'Packaging checklist',
      type: 'reference',
      text: 'Verify official build gates before release.',
    }),
  });

  await b.mountPage();
  await flushUi();

  // 1. Threads tab: "等你处理" (waiting) must appear FIRST above running & review.
  const panel = await waitFor(() => b.container.querySelector('[data-projects-tasks-panel="true"]'));
  assert.ok(panel);
  const groupKeys = [...panel.querySelectorAll('[data-thread-group]')].map((el) => el.getAttribute('data-thread-group'));
  assert.deepEqual(groupKeys.slice(0, 3), ['waiting', 'running', 'review'], 'Waiting-on-you group must sit at the very top');
  assert.ok(panel.querySelector('.pj-group-btn.pj-group-waiting'), 'Waiting group must carry yellow emphasis class');

  // 2. Switch to Library ("资料") tab: test inline validation, add reference, preview via workspaces.openPath, remove reference (disk file untouched), & inspect artifacts.
  const libTab = panel.querySelector('#pj-drawer-tab-library');
  assert.ok(libTab);
  await act(async () => { libTab.click(); });
  await waitFor(() => panel.querySelector('#pj-drawer-panel-library'));
  await flushUi(40);

  const addFileBtn = [...panel.querySelectorAll('button')].find((el) => el.textContent.includes('添加文件'));
  assert.ok(addFileBtn);
  await act(async () => { addFileBtn.click(); });

  const addForm = panel.querySelector('[data-library-add-form="true"]');
  assert.ok(addForm);
  const submitRefBtn = [...addForm.querySelectorAll('button')].find((el) => el.textContent.trim() === '添加');
  await act(async () => { submitRefBtn.click(); });
  assert.ok(addForm.querySelector('input[aria-invalid="true"]'), 'Empty path must show inline invalid state');

  await act(async () => {
    setControlValue(b.dom, addForm.querySelector('input[aria-label="参考文件路径"]'), 'docs/architecture.md');
    setControlValue(b.dom, addForm.querySelector('input[aria-label="资料标题"]'), '架构规范');
    setControlValue(b.dom, addForm.querySelector('input[aria-label="资料备注"]'), '核心约定文档');
  });
  await act(async () => { submitRefBtn.click(); });

  const refRow = await waitFor(() => panel.querySelector('[data-library-ref]'));
  await flushUi();
  assert.ok(refRow, 'Added reference should render in Library');
  assert.match(refRow.textContent, /架构规范/);

  // Click reference -> routes through workspaces.openPath for in-app shared rightbar preview.
  await act(async () => { refRow.querySelector('.pj-lib-main').click(); });
  await waitFor(() => b.workspaceOpenedPaths.length === 1);
  assert.ok(b.workspaceOpenedPaths[0].target.endsWith('architecture.md'));
  assert.equal(b.workspaceOpenedPaths[0].opts.sessionId, 'sess-coord-1');

  // Remove reference -> deletes pointer only, keeps disk file intact.
  const removeRefBtn = refRow.querySelector('button[aria-label^="移除参考资料"]');
  assert.ok(removeRefBtn);
  await act(async () => { removeRefBtn.click(); });
  await waitFor(() => panel.querySelector('[data-library-ref]') === null);
  await flushUi();
  assert.equal(fs.existsSync(specFile), true, 'Removing reference must never delete real disk file');

  // Task artifacts section shows the worker deliverable with source task jump link.
  const artifactRow = panel.querySelector('[data-library-artifact]');
  assert.ok(artifactRow, 'Task artifact should appear automatically in Library artifacts section');
  assert.match(artifactRow.textContent, /Architecture Report/);
  const artTaskLink = artifactRow.querySelector('.pj-task-link');
  assert.ok(artTaskLink);
  await act(async () => { artTaskLink.click(); });
  await waitFor(() => b.container.querySelector(`.pj-stage [data-projects-task-detail="${revTask.id}"]`));
  await flushUi(40);

  // Return to coordinator and switch to Memory ("记忆") tab.
  const backCoord = [...b.container.querySelectorAll('.pj-detail-bar button')].find((el) => el.textContent.includes('返回协调者'));
  await act(async () => { backCoord.click(); });
  await flushUi(40);

  const memTab = panel.querySelector('#pj-drawer-tab-memory');
  assert.ok(memTab);
  await act(async () => { memTab.click(); });
  await waitFor(() => panel.querySelector('#pj-drawer-panel-memory'));
  await flushUi(40);

  // 3. Inline Instructions edit & save without opening Settings modal.
  const rulesSection = panel.querySelector('[data-drawer-instructions="true"]');
  assert.ok(rulesSection);
  assert.match(rulesSection.textContent, /Initial project rule/);
  const editRulesBtn = [...rulesSection.querySelectorAll('button')].find((el) => el.textContent.includes('编辑'));
  await act(async () => { editRulesBtn.click(); });
  const rulesTextarea = rulesSection.querySelector('textarea[aria-label="项目规则"]');
  assert.ok(rulesTextarea);
  await act(async () => {
    setControlValue(b.dom, rulesTextarea, 'Clarify ambiguity first, then fan out in parallel.');
  });
  const saveRulesBtn = [...rulesSection.querySelectorAll('button')].find((el) => el.textContent.trim() === '保存');
  await act(async () => { saveRulesBtn.click(); });
  await waitFor(async () => (await b.service.readProject(project.id)).goal.includes('Clarify ambiguity first'));
  await flushUi();

  // 4. Memory Pin toggle, live backend search, and sourceTaskId jump.
  const routingCard = panel.querySelector('[data-memory-topic="routing-rules"]');
  assert.ok(routingCard);
  const pinBtn = routingCard.querySelector('.pj-pin-btn');
  assert.ok(pinBtn);
  await act(async () => { pinBtn.click(); });
  await waitFor(() => panel.querySelector('[data-memory-topic="routing-rules"]')?.getAttribute('data-memory-pinned') === 'true');
  await flushUi();

  const memSearchInput = panel.querySelector('input[aria-label="搜索共享记忆"]');
  assert.ok(memSearchInput);
  await act(async () => { setControlValue(b.dom, memSearchInput, 'CSRF'); });
  await waitFor(() =>
    b.requestLog.some((r) => r.method === 'GET' && r.url.includes(`/projects/${project.id}/memory?q=CSRF`))
    && panel.querySelectorAll('[data-memory-topic]').length === 1,
  );
  assert.ok(
    b.requestLog.some((r) => r.method === 'GET' && r.url.includes(`/projects/${project.id}/memory?q=CSRF`)),
    'Memory search must query backend /memory?q= endpoint',
  );
  const searchCards = [...panel.querySelectorAll('[data-memory-topic]')];
  assert.equal(searchCards.length, 1);
  assert.equal(searchCards[0].getAttribute('data-memory-topic'), 'routing-rules');

  // Click source task jump link on memory card -> opens wide TaskDetailStage.
  const memSourceLink = searchCards[0].querySelector('.pj-task-link');
  assert.ok(memSourceLink);
  await act(async () => { memSourceLink.click(); });
  await waitFor(() => b.container.querySelector(`.pj-stage [data-projects-task-detail="${revTask.id}"]`));
  await flushUi(40);

  // Routine Library add/remove and inline Rules save must NOT emit success toasts.
  assert.equal(b.toastsSeen.length, 0, `Routine drawer actions must not emit success toasts, got: ${JSON.stringify(b.toastsSeen)}`);
});

test('wide Diff view shows mergeability badge, prefills file feedback without auto-sending, and dispatches revision to worker session', async (t) => {
  const b = await createDesktopClientBench(t, {
    initialProjects: [
      { name: 'Diff Feedback Test', goal: 'Review changes fast.', autonomy: 'auto' },
    ],
    interceptFetch: ({ method, url }) => {
      if (method === 'GET' && /\/tasks\/[^/]+\/diff$/.test(url)) {
        return {
          status: 200,
          body: {
            available: true,
            branch: 'project/t-diff',
            worktreePath: '/tmp/wt-diff',
            baseRef: 'main',
            files: [{ path: 'src/router.js', status: 'modified', additions: 8, deletions: 2 }],
            diff: '@@ -1,2 +1,4 @@\n-old()\n+new()\n',
            truncated: false,
            mergeability: {
              status: 'clean',
              canMergeCleanly: true,
              changedFiles: 1,
              conflictFiles: [],
              reason: '',
            },
          },
        };
      }
      return null;
    },
  });
  const project = b.seeded[0];
  const { task } = await b.service.addTask(project.id, { title: 'Refactor router', brief: 'Clean up router.js' });
  await b.service.updateTask(project.id, task.id, { status: 'review' });
  const storedProj = await b.service.store.readProject(project.id);
  const storedTask = storedProj.tasks.find((item) => item.id === task.id);
  storedTask.childSessionId = 'sess-worker-diff';
  storedTask.branch = 'project/t-diff9999';
  await b.service.store.writeProject(storedProj);

  await b.mountPage();
  await flushUi();

  const card = await waitFor(() => b.container.querySelector('.pj-task-card'));
  // Task list card displays clean semantic "独立分支" badge (with full branch in hover title) instead of raw branch ID.
  assert.match(card.textContent, /独立分支/);
  assert.doesNotMatch(card.textContent, /project\/t-diff9999/);
  assert.equal(card.querySelector('.pj-chip-branch')?.getAttribute('title'), 'project/t-diff9999');
  await act(async () => { card.click(); });
  const detailStage = await waitFor(() => b.container.querySelector('.pj-stage [data-projects-task-detail]'));
  await flushUi(40);

  await act(async () => { detailStage.querySelector('#pj-tab-diff').click(); });
  const mergeBadge = await waitFor(() => detailStage.querySelector('[data-mergeability="clean"]'));
  assert.ok(mergeBadge, 'Diff toolbar must display mergeability pre-check badge');
  assert.match(mergeBadge.textContent, /可无冲突合并/);

  // Click per-file "提修改": prefills "[src/router.js] " without auto-sending.
  const reqBtn = detailStage.querySelector('button[aria-label="提修改: src/router.js"]');
  assert.ok(reqBtn);
  await act(async () => { reqBtn.click(); });
  const feedbackInput = detailStage.querySelector('input[aria-label="向此执行者发修改意见"]');
  assert.ok(feedbackInput);
  assert.equal(feedbackInput.value, '[src/router.js] ');
  assert.equal(b.promptCalls.length, 0, 'Clicking Request Changes must prefill only and never auto-send');

  // Complete revision comment and send -> prompts worker session & auto-switches to Chat tab.
  await act(async () => {
    setControlValue(b.dom, feedbackInput, '[src/router.js] 请补齐空路径边界判断');
  });
  const sendBtn = [...detailStage.querySelectorAll('[data-diff-feedback-bar] button')].find((el) => el.textContent.includes('发送'));
  assert.ok(sendBtn);
  await act(async () => { sendBtn.click(); });
  await waitFor(() => b.promptCalls.length === 1);
  await flushUi(40);

  assert.deepEqual(
    JSON.parse(JSON.stringify(b.promptCalls[0].blocks)),
    [{ type: 'text', text: '[src/router.js] 请补齐空路径边界判断' }],
  );
  assert.equal(b.promptCalls[0].mode, 'queue', 'ISession.prompt must pass required mode="queue"');
  assert.ok(detailStage.querySelector('#pj-panel-chat'), 'Sending Diff feedback must switch back to Chat tab to watch progress');
  assert.equal(b.toastsSeen.length, 0, 'Sending Diff feedback switches to Chat tab directly without emitting routine success toast');
});

test('3-color status dot priority (yellow > blue > green > grey), default auto NewProject modal, and background Notification on blur', async (t) => {
  const b = await createDesktopClientBench(t, {
    initialProjects: [
      { name: 'Status Priority Project', goal: 'Track live status dots.', autonomy: 'auto' },
    ],
  });
  const project = b.seeded[0];

  // Install safe mock Notification and simulate unfocused window later.
  const notifications = [];
  class MockNotification {
    constructor(title, opts) {
      this.title = title;
      this.body = opts?.body || '';
      this.onclick = null;
      notifications.push(this);
    }
  }
  MockNotification.permission = 'granted';
  Object.defineProperty(globalThis, 'Notification', { configurable: true, writable: true, value: MockNotification });
  Object.defineProperty(b.dom.window, 'Notification', { configurable: true, writable: true, value: MockNotification });
  b.dom.window.document.hasFocus = () => false;
  b.dom.window.focus = () => {};

  await b.mountPage();
  await flushUi();

  // 1. Default NewProjectModal selects "auto" (自动并行) with Claude Projects guidance text.
  const switcherBtn = await waitFor(() => b.container.querySelector('button[aria-label="切换项目"]'));
  await act(async () => { switcherBtn.click(); });
  const newItem = await waitFor(() => [...b.container.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent.includes('新建项目')));
  await act(async () => { newItem.click(); });
  const newDlg = await waitFor(() => b.container.querySelector('[role="dialog"][aria-label="新建项目"]'));
  assert.equal(newDlg.querySelector('#pj-new-autonomy-auto')?.getAttribute('aria-selected'), 'true', 'New project modal must default to auto parallel');
  assert.match(newDlg.textContent, /协调者先澄清需求，再自动并行派发线程/);
  const closeNewDlgBtn = await waitFor(() => newDlg.querySelector('button[aria-label="关闭"]'));
  await act(async () => { closeNewDlgBtn.click(); });
  await flushUi(40);

  // 2. Status dot priority: idle -> review (green) -> running (blue) -> blocked (yellow).
  const readTopbarDot = () => b.container.querySelector('button.pj-tasks-toggle [data-project-status]')?.getAttribute('data-project-status');
  const readSwitcherDot = () => b.container.querySelector('button[aria-label="切换项目"] [data-project-status]')?.getAttribute('data-project-status');
  assert.equal(readTopbarDot(), 'idle');
  assert.equal(readSwitcherDot(), 'idle');

  let tReview;
  await act(async () => {
    ({ task: tReview } = await b.service.addTask(project.id, { title: 'Review task', brief: 'Done' }));
    await b.service.updateTask(project.id, tReview.id, { status: 'review' });
  });
  await waitFor(() => readTopbarDot() === 'review');
  await flushUi();
  assert.equal(readSwitcherDot(), 'review');

  let tRun;
  await act(async () => {
    ({ task: tRun } = await b.service.addTask(project.id, { title: 'Running worker', brief: 'Working' }));
    await b.service.updateTask(project.id, tRun.id, { status: 'running' });
  });
  await waitFor(() => readTopbarDot() === 'running');
  await flushUi();
  assert.equal(readSwitcherDot(), 'running');

  let tBlocked;
  await act(async () => {
    ({ task: tBlocked } = await b.service.addTask(project.id, { title: 'Needs input', brief: 'Blocked' }));
    await b.service.updateTask(project.id, tBlocked.id, { status: 'blocked' });
  });
  await waitFor(() => readTopbarDot() === 'waiting');
  await flushUi();
  assert.equal(readSwitcherDot(), 'waiting');

  // Overview card displays the same highest-priority yellow status dot.
  const allProjectsBtn = await waitFor(() => b.container.querySelector('button[aria-label="全部项目"]'));
  await act(async () => { allProjectsBtn.click(); });
  const overviewCardDot = await waitFor(() => b.container.querySelector('.pj-card [data-project-status]'));
  assert.equal(overviewCardDot.getAttribute('data-project-status'), 'waiting');

  // Return to workspace and transition running task -> review while unfocused -> fires Notification!
  const projectCard = await waitFor(() => b.container.querySelector('.pj-card'));
  await act(async () => { projectCard.click(); });
  await waitFor(() => b.container.querySelector('[data-projects-topbar]'));
  await flushUi();

  await act(async () => {
    await b.service.updateTask(project.id, tRun.id, { status: 'review', output: 'Ready to inspect.' });
  });
  await waitFor(() => notifications.length === 1);
  await flushUi();
  assert.match(notifications[0].title, /Status Priority Project/);
  assert.match(notifications[0].body, /Running worker/);

  // Clicking notification focuses & navigates directly to that task's wide TaskDetailStage.
  await act(async () => { notifications[0].onclick?.(); });
  await waitFor(() => b.container.querySelector(`.pj-stage [data-projects-task-detail="${tRun.id}"]`));
  await flushUi(40);
});

test('concurrent SSE events across multiple projects within 80ms batch window never drop active project detail refresh', async (t) => {
  const b = await createDesktopClientBench(t, {
    initialProjects: [
      { name: 'Active Project A', goal: 'Primary active project', autonomy: 'auto' },
      { name: 'Background Project B', goal: 'Secondary project', autonomy: 'auto' },
    ],
  });
  await b.mountPage();
  await flushUi();

  const switcherBtn = await waitFor(() => b.container.querySelector('button[aria-label="切换项目"]'));
  assert.ok(switcherBtn);
  const activeName = switcherBtn.textContent.trim();
  const activeProj = b.seeded.find((p) => p.name === activeName);
  const bgProj = b.seeded.find((p) => p.name !== activeName);
  assert.ok(activeProj && bgProj);
  assert.equal(b.container.querySelector('[data-projects-tasks-panel]'), null, 'Starts collapsed with 0 tasks');

  // Fire SSE event on active project A, immediately followed within < 80ms by an SSE event on background project B.
  await act(async () => {
    await b.service.addTask(activeProj.id, { title: 'Active SSE Task', brief: 'Must not be dropped by batching' });
    await b.service.addTask(bgProj.id, { title: 'Background SSE Task', brief: 'Second project event in same 80ms window' });
  });
  await flushUi(140);

  const panel = await waitFor(() => b.container.querySelector('[data-projects-tasks-panel="true"]'));
  assert.ok(panel, 'Active project must still receive detail refresh and auto-expand tasks panel');
  assert.match(panel.textContent, /Active SSE Task/);
  assert.match(b.container.querySelector('button.pj-tasks-toggle')?.textContent || '', /线程\s*·\s*1/);
});
