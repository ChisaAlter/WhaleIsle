'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');

const clientPath = path.join(__dirname, '../../vendor/dsh-project/client/client.js');
const clientRequire = createRequire(path.join(__dirname, '../../vendor/deepseek-harness/packages/client/ui-conversation/package.json'));
const vendorRequire = createRequire(path.join(__dirname, '../../vendor/deepseek-harness/package.json'));
const React = clientRequire('react');
const { JSDOM } = vendorRequire('jsdom');
const { act, createElement: h, useSyncExternalStore } = React;

function projection(initial) {
  let value = initial;
  const listeners = new Set();
  return { getSnapshot: () => value, set: next => { value = next; for (const listener of listeners) listener(); },
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } };
}

const turnRecord = seq => ({ type: 'event', event: { type: 'assistant/message', seq, time: seq, data: {
  turn: seq, step: 1, message: { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: `Worker record ${seq}` }] },
} } });
const toolRecords = [
  { type: 'event', event: { type: 'tool/call', seq: 81, time: 81, data: { name: 'read_file', callId: 'call-1', arguments: '{"path":"src/app.js"}' } } },
  { type: 'event', event: { type: 'tool/result', seq: 82, time: 82, data: { message: { source: { kind: 'tool', callId: 'call-1' }, toolCallId: 'call-1', content: [{ type: 'text', text: 'actual repository content' }] } } } },
];

function isVisible(element) {
  if (element.closest('[hidden]')) return false;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName === 'DETAILS' && !parent.open && !parent.querySelector(':scope > summary')?.contains(element)) return false;
  }
  return true;
}

function visibleText(element) {
  const walker = element.ownerDocument.createTreeWalker(element, element.ownerDocument.defaultView.NodeFilter.SHOW_TEXT);
  let text = '';
  while (walker.nextNode()) if (isVisible(walker.currentNode.parentElement)) text += walker.currentNode.textContent;
  return text;
}

// The shipped browser module executes in a VM, but its components and hooks
// use real React and DOM events. Host RPC, slots and primitive appearance are
// the boundaries substituted here; model execution and desktop UI are separate.
function bench({ available = true, rejectCreation = false, detail = {}, cards = [], team = null, runtimeSessions = {}, factoryRenderer, rpcOverride, previewOverride, approvalActive = false, language } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main></main></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const savedGlobals = Object.fromEntries(['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const { createRoot } = clientRequire('react-dom/client');
  let registration, directoryAction, timer, root;
  const cleanups = [], entries = [], requests = [], navigation = [], retained = [], released = [], opened = [], sent = [], resizes = [], resizeObservers = [], factoryCalls = [], events = new Map(), sessionActions = new Map(), sessionNavigation = new Map(), locales = new Map();
  const project = { id: 'project-one', title: 'Project', coordinatorSessionId: 'coordinator-existing', workspaceId: 'workspace-existing',
    storageRoot: 'C:/profile/projects/project-one', canonicalWorkingDirectory: 'C:/workspace/real', lifecycle: 'ready', paused: false, diagnostics: [], activity: detail?.activity ?? { running: 0, blocked: 0, queued: 0, state: 'idle' } };
  project.currentRequests = cards.filter(card => card.status !== 'completed');
  if (project.currentRequests.length && !detail?.activity) project.activity = { running: 1, blocked: 0, queued: 0, state: 'running' };
  const notesMarker = '<!-- whale-project:user-notes -->', generatedNotes = '# Generated current work records';
  const stored = { 'notes.md': `${generatedNotes}\n${notesMarker}\nInitial notes`, 'preferences.md': 'Initial preferences', 'docs/report.md': 'Saved report' };
  const eventSource = projection({ entries: [...Array.from({ length: 60 }, (_, index) => turnRecord(index + 21)), ...toolRecords], hasMore: true, revision: 1 });
  const session = projection({ openState: 'open', openError: null });
  session.loadOlder = async () => { const previous = eventSource.getSnapshot(); eventSource.set({ entries: [...Array.from({ length: 20 }, (_, index) => turnRecord(index + 1)), ...previous.entries], hasMore: false, revision: 2 }); };
  const binding = { eventSource, session };
  dom.window.__ModuleLoader__ = { load: value => { registration = value; } };
  const sandbox = { window: dom.window,
    globalThis: { crypto: { randomUUID } }, TextEncoder, document: dom.window.document,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), ResizeObserver: class {
      constructor(callback) { this.callback = callback; this.disconnected = false; resizeObservers.push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
    },
    setInterval: callback => { timer = callback; return 1; }, clearInterval() {} };
  vm.runInNewContext(fs.readFileSync(clientPath, 'utf8'), sandbox, { filename: clientPath });
  const Button = React.forwardRef(function Button({ variant, children, ...props }, ref) { return h('button', { type: 'button', ref, ...props }, children); });
  const Modal = ({ open, title, closeLabel, onClose, children, footer }) => !open ? null : h('section', { role: 'dialog', 'aria-label': title },
    h('button', { type: 'button', 'aria-label': closeLabel, onClick: onClose }, closeLabel), children, footer);
  const TaskDock = ({ title, summary, children, testId }) => { const [expanded, setExpanded] = React.useState(false); return h('section', { 'data-testid': testId }, h('button', { 'aria-expanded': expanded, onClick: () => setExpanded(!expanded) }, title), h('span', null, summary), expanded ? children : null); };
  const Menu = ({ open, anchor, items, onSelect }) => h(React.Fragment, null, anchor, open ? h('div', { role: 'menu' }, items.map(item => h('button', { key: item.id, role: 'menuitem', onClick: () => onSelect(item.id) }, item.label))) : null);
  const SegmentedTabs = ({ items, value, onChange, label }) => h('div', { role: 'tablist', 'aria-label': label }, items.map(item => h('button', {
    key: item.value, id: item.id, role: 'tab', 'aria-selected': item.value === value, 'aria-controls': item.panelId, onClick: () => onChange(item.value),
  }, item.label)));
  const primitives = { Button, Modal, TaskDock, Menu, SegmentedTabs, Toast: ({ text }) => clientRequire('react-dom').createPortal(h('div', { role: 'alert' }, text), dom.window.document.body), Input: props => h('input', props), IconChevronDownOutlineRegular: () => null, IconChevronRightOutlineRegular: () => null, Pill: ({ children }) => h('span', null, children), MarkdownText: ({ text }) => h('div', { 'data-markdown': true }, text), IconFolderCloseRegular: () => h('span', { 'aria-hidden': true }) };
  const observer = projection(null), mounted = projection(project.coordinatorSessionId), observerSources = projection({ [project.coordinatorSessionId]: observer }), tabTypes = new Map(), closeHandlers = new Map();
  const observerIn = sessionId => observerSources.getSnapshot()[sessionId];
  const ensureObserver = sessionId => {
    if (observerIn(sessionId)) return observerIn(sessionId);
    const source = projection(null); observerSources.set({ ...observerSources.getSnapshot(), [sessionId]: source }); return source;
  };
  const foregroundObserver = () => observerIn(mounted.getSnapshot());
  const sidebarRight = {
    mounted,
    focusedTarget: element => {
      const sessionId = element?.closest?.('[data-observer-session]')?.dataset.observerSession, current = observerIn(sessionId)?.getSnapshot();
      return current && element?.closest?.('.dsh-project-observer') ? { sessionId,
        host: current.panel.host, paneId: current.panel.id, tabId: current.tab.id } : undefined;
    },
    tabsIn: sessionId => observerIn(sessionId)?.getSnapshot() ? [observerIn(sessionId).getSnapshot().tab] : [],
    focus: tabId => { assert.equal(foregroundObserver()?.getSnapshot()?.tab.id, tabId); },
    openTabIn: (sessionId, kind, options) => {
      assert.ok(sessionId); assert.ok(tabTypes.has(kind));
      const tab = { id: 'project-observer-tab', kind, title: 'Project' };
      ensureObserver(sessionId).set({ tab, panel: { id: 'project-observer-pane', host: 'float', rect: options.floating } });
      return true;
    },
    resizeFloat: (paneId, rect) => {
      const source = foregroundObserver(), current = source?.getSnapshot();
      assert.equal(current?.panel.id, paneId);
      if (['x', 'y', 'width', 'height'].every(key => current.panel.rect[key] === rect[key])) return;
      resizes.push({ sessionId: mounted.getSnapshot(), paneId, rect });
      source.set({ ...current, panel: { ...current.panel, rect } });
    },
    float: (tabId, rect) => {
      const source = foregroundObserver(), current = source?.getSnapshot(); assert.equal(current?.tab.id, tabId);
      source.set({ ...current, panel: { ...current.panel, host: 'float', rect } });
    },
    registerCloseHandler: (kind, handler) => { closeHandlers.set(kind, handler); return () => closeHandlers.delete(kind); },
    close: tabId => {
      const source = foregroundObserver(), current = source?.getSnapshot(); assert.equal(current?.tab.id, tabId);
      const proceed = () => { source.set(null); return true; };
      if (closeHandlers.get(current.tab.kind)?.(mounted.getSnapshot(), current.tab, proceed) !== false) proceed();
    },
  };
  const plugin = registration.factory(spec => {
    if (spec === 'react') return React;
    if (spec === 'react-dom') return clientRequire('react-dom');
    if (spec === '@deepseek-ai/dsh-experimental-client-ui-agent-team') return { TeamAction: () => null, teamEnglish: {}, teamChinese: {} };
    if (spec === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
    if (spec === '@deepseek-ai/dsh-client-store') return {
      createSnapshotStore: projection,
      defineStore: spec => ({ create: () => {
        const state = projection(spec.init());
        const actions = Object.fromEntries(Object.entries(spec.actions).map(([name, action]) => [name, (...args) => {
          const draft = { ...state.getSnapshot() }; action(draft, ...args); state.set(draft);
        }]));
        return { ...state, actions };
      } }),
    };
    throw new Error(`Unexpected module ${spec}`);
  });
  const ctx = {
    effect: setup => { const cleanup = setup(); if (typeof cleanup === 'function') cleanups.push(cleanup); },
    on: (name, listener) => { events.set(name, listener); return () => events.delete(name); },
    locale: { bind: scope => key => language ? locales.get(scope)?.[language]?.[key] ?? key : key,
      register: (scope, translations) => { locales.set(scope, translations); return () => locales.delete(scope); }, subscribe: () => () => {} },
    slots: { inject: (_key, install) => install(), register: (options, component) => { const entry = { options, component, active: true }; entries.push(entry); return () => { entry.active = false; }; } },
    workspaces: { create: async input => { requests.push({ method: 'workspace/create', input }); return { path: project.canonicalWorkingDirectory, workspaceId: project.workspaceId }; }, openPath: async (path, options) => { if (previewOverride) await previewOverride(path, options); opened.push({ path, options }); } },
    uiWorkspace: { registerDirectoryAction: action => { directoryAction = action; return () => { directoryAction = undefined; }; }, registerSessionActions: (owner, actions) => { assert.equal(sessionActions.has(owner), false); sessionActions.set(owner, actions); return () => sessionActions.delete(owner); }, registerSessionNavigation: (owner, source) => { assert.equal(sessionNavigation.has(owner), false); sessionNavigation.set(owner, source); return () => sessionNavigation.delete(owner); }, openSession: id => navigation.push(['session', id]) },
    uiSidebar: { selectTab: id => navigation.push(['tab', id]) },
    sidebarRight,
    sidebarRightTabs: { register: definition => { tabTypes.set(definition.kind, definition); return () => tabTypes.delete(definition.kind); } },
    settingsNavigation: { open: id => navigation.push(['settings', id]) },
    sessions: { scope: sessionId => ({ get: name => { assert.equal(name, 'conversation'); return { send: async text => sent.push({ sessionId, text }) }; } }), list: projection({ byId: { [project.coordinatorSessionId]: { id: project.coordinatorSessionId, retainedBy: { mainView: 1 } }, ...runtimeSessions },
      projectionsBySession: { [project.coordinatorSessionId]: { values: { agentTeam: team } } } }), retain: (address, options) => { retained.push({ address, options }); return { ready: Promise.resolve(binding), release: () => released.push(address.childSessionId) }; } },
    connection: { rpc: { call: async (prefix, method, input) => {
      assert.equal(prefix, '/dsh-project'); requests.push({ method, input });
      const override = rpcOverride?.(method, input, project, stored);
      if (override !== undefined) return await override;
      if (method === 'list') return { ok: true, value: { projects: [], available } };
      if (method === 'create') return rejectCreation ? { ok: false, error: { code: 'project/rejected', message: 'Creation failed' } } : { ok: true, value: { project, reused: true } };
      if (method === 'detail') return { ok: true, value: { project, workstreams: [], workers: [], revision: 'revision-1', ...detail, ...(detail?.workstreams ? { workstreams: detail.workstreams.map(({ latestReport, ...work }) => ({ ...work, hasReport: Boolean(latestReport) })) } : {}) } };
      if (method === 'requests/list') {
        const rows = cards.filter(card => input.kind === 'archived' ? card.archivedAt !== undefined : input.kind === 'completed' ? card.status === 'completed' && card.archivedAt === undefined : card.status !== 'completed');
        const start = input.cursor ? rows.findIndex(card => card.id === input.cursor) + 1 : 0;
        assert.ok(start >= 0); const items = rows.slice(start, start + 10);
        return { ok: true, value: { items, total: rows.length, nextCursor: start + items.length < rows.length ? items.at(-1).id : null } };
      }
      if (method === 'requests/get') {
        const card = cards.find(item => item.id === input.requestId); assert.ok(card, 'Selected task belongs to the current Project');
        return { ok: true, value: { card } };
      }
      if (method === 'requests/archive' || method === 'requests/restore') {
        const card = cards.find(item => item.id === input.requestId); assert.ok(card); assert.equal(card.status, 'completed');
        if (method === 'requests/archive') card.archivedAt = 10000;
        else delete card.archivedAt;
        return { ok: true, value: { card } };
      }
      if (method === 'workstreams/get') {
        const workstream = detail?.workstreams.find(work => input.workerSessionId ? work.workerSessionId === input.workerSessionId : work.id === input.workstreamId);
        assert.ok(workstream, 'The selected work must belong to this Project');
        return { ok: true, value: { workstream, worker: detail.workers.find(worker => worker.sessionId === workstream.workerSessionId) } };
      }
      if (method === 'store/list') return { ok: true, value: { docs: [{ path: 'docs/report.md', size: 12 }], notes: 'notes.md', preferences: 'preferences.md' } };
      if (method === 'store/results') {
        const work = detail?.workstreams?.find(work => work.id === input.workstreamId);
        assert.ok(work, 'Report history must use the selected Project work');
        return { ok: true, value: { items: work.latestReport ? [work.latestReport] : [], total: work.latestReport ? 1 : 0, nextCursor: null } };
      }
      if (method === 'store/read') return { ok: true, value: { path: input.path, text: stored[input.path], ...(input.path === 'notes.md' ? {
        generatedText: generatedNotes, userText: stored[input.path].slice(stored[input.path].indexOf(notesMarker) + notesMarker.length + 1),
      } : {}) } };
      if (method === 'store/write') { stored[input.path] = input.path === 'notes.md' ? `${generatedNotes}\n${notesMarker}\n${input.text}` : input.text; return { ok: true, value: { written: true, ...(input.path === 'notes.md' ? { generatedText: generatedNotes } : {}) } }; }
      if (method === 'open') return { ok: true, value: { canonicalPath: `C:/workspace/real/${input.path}`, root: 'C:/workspace/real' } };
      if (method === 'diff') return { ok: true, value: { worker: { cwd: 'C:/workspace/real', mode: 'existing' }, snapshot: { isGit: false, diff: '', dirty: null } } };
      if (['stop', 'pause'].includes(method)) return { ok: true, value: { state: 'stopped' } };
      if (['resume', 'archive', 'restore'].includes(method)) return { ok: true, value: { project } };
      if (method === 'rename') { project.title = input.title; return { ok: true, value: { project } }; }
      throw new Error(`Unexpected method ${method}`);
    } } },
  };
  plugin.apply(ctx);
  const overlay = () => entries.find(entry => entry.options.name === 'shell.overlay');
  const face = () => overlay().options.inject();
  const selectHook = source => selector => selector(useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot));
  function Slot({ entry, sessionId, observerSource = observer }) {
    const observed = useSyncExternalStore(observerSource.subscribe, observerSource.getSnapshot, observerSource.getSnapshot);
    const activeSessionId = useSyncExternalStore(mounted.subscribe, mounted.getSnapshot, mounted.getSnapshot);
    const rightTab = entry.options.name === 'sidebar.right.pane.tab' || entry.options.name === 'sidebar.right.pane.tab.title';
    if (rightTab && !observed) return null;
    const injected = entry.options.inject(rightTab ? sessionId : undefined), store = entry.options.store?.create();
    const matched = entry.options.select?.({ sessionId });
    if (entry.options.select && matched === null) return null;
    const visible = activeSessionId === sessionId && !(observed?.panel.host === 'float' && observed.panel.rect.height <= 38);
    const component = h(entry.component, { ...injected, useProjects: selectHook(injected.hooks.projects), useProjectSessions: selectHook(injected.hooks.projectSessions),
      useObserverModes: selectHook(injected.hooks.observerModes), useSidebarMounted: selectHook(injected.hooks.sidebarMounted), useProjectView: selectHook(injected.hooks.projectView),
      renderFactorySlot: (name, props, options) => { factoryCalls.push({ name, props, options }); return factoryRenderer ? factoryRenderer(name, props, options) : options?.fallback ?? null; },
      ...(store ? { useStore: selectHook(store), actions: store.actions } : {}),
      ...(rightTab ? { useTabInfo: () => {
        const info = useSyncExternalStore(observerSource.subscribe, observerSource.getSnapshot, observerSource.getSnapshot);
        return { ...info, tab: { ...info.tab, visible } };
      } } : {}),
      matched, sessionId, wide: true, t: ctx.locale.bind(entry.options.locale ?? 'dsh-project') });
    return rightTab ? h('div', { 'data-observer-session': sessionId, hidden: activeSessionId !== sessionId || entry.options.name === 'sidebar.right.pane.tab' && !visible }, component) : component;
  }
  function Slots() {
    const sources = useSyncExternalStore(observerSources.subscribe, observerSources.getSnapshot, observerSources.getSnapshot);
    const sessionId = useSyncExternalStore(mounted.subscribe, mounted.getSnapshot, mounted.getSnapshot);
    return h(React.Fragment, null, entries.filter(entry => entry.active && entry.options.name !== 'sidebar.nav.tab'
      && (approvalActive ? !['conversation.input.right', 'conversation.input.dock'].includes(entry.options.name) : entry.options.name !== 'conversation.approval.actions')).flatMap(entry => {
      const key = `${entry.options.name}:${entry.options.id ?? entry.options.key}`;
      return entry.options.name === 'sidebar.right.pane.tab' || entry.options.name === 'sidebar.right.pane.tab.title'
        ? Object.entries(sources).map(([owner, source]) => h(Slot, { key: `${key}:${owner}`, entry, sessionId: owner, observerSource: source }))
        : [h(Slot, { key, entry, sessionId })];
    }));
  }
  const render = () => root.render(h(Slots));
  const flush = async () => { await act(async () => { await new Promise(resolve => setImmediate(resolve)); }); };
  const findButton = label => [...dom.window.document.querySelectorAll('button')].find(element => isVisible(element) && (element.textContent === label || element.getAttribute('aria-label') === label));
  const openObserver = async () => {
    const target = dom.window.document.querySelector('.dsh-project-header-label');
    assert.ok(target && isVisible(target), 'The original Project conversation-header entry must be reachable');
    await act(async () => { target.focus(); target.click(); await new Promise(resolve => setImmediate(resolve)); });
  };
  const expandObserver = async () => {
    const target = [...dom.window.document.querySelectorAll('.dsh-project-mode-button')].find(isVisible);
    assert.ok(target, 'The floating observer expand/collapse control must be reachable');
    if (target.getAttribute('aria-expanded') === 'false') {
      await act(async () => { target.focus(); target.click(); await new Promise(resolve => setImmediate(resolve)); });
    }
    assert.equal(target.getAttribute('aria-expanded'), 'true');
    assert.equal(dom.window.document.querySelector(`[data-observer-session="${mounted.getSnapshot()}"] [data-project-observer-mode]`).dataset.projectObserverMode, 'full');
  };
  const press = async label => {
    if (label === 'materials') {
      if (!foregroundObserver()?.getSnapshot()) await openObserver();
      await expandObserver(); await press('taskMaterials'); return;
    }
    if (label === 'close' && !findButton('close') && foregroundObserver()?.getSnapshot()) {
      await act(async () => { sidebarRight.close(foregroundObserver().getSnapshot().tab.id); }); return;
    }
    const target = findButton(label); assert.ok(target, `Missing button ${label}`);
    await act(async () => { target.focus(); target.click(); await new Promise(resolve => setImmediate(resolve)); });
  };
  return { entries, requests, navigation, retained, released, opened, sent, resizes, resizeObservers, factoryCalls, sessionNavigation, eventSource, session, stored, project, face, sessionActions, sidebarRight, tabTypes, observer, observerIn, mounted, cards, document: dom.window.document,
    get action() { return directoryAction; }, flush,
    mount: async () => { root = createRoot(dom.window.document.querySelector('main')); await act(async () => { render(); }); },
    render: async () => { await act(async () => { render(); }); },
    mountSession: async sessionId => { await act(async () => { mounted.set(sessionId); }); },
    press, openObserver, expandObserver,
    disclose: async (label, scope = dom.window.document) => { const target = [...scope.querySelectorAll('summary')].find(element => isVisible(element) && element.textContent === label); assert.ok(target, `Missing disclosure ${label}`); await act(async () => { target.click(); await new Promise(resolve => setTimeout(resolve, 10)); }); },
    changeNotes: async text => { const editor = dom.window.document.querySelector('textarea'); assert.ok(editor); await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(editor, text);
      editor.dispatchEvent(new dom.window.Event('input', { bubbles: true })); editor.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    }); },
    button: findButton,
    adopt: async () => { await act(async () => { await directoryAction.adopt('C:/workspace/alias'); }); },
    poll: async () => { await act(async () => { timer(); await new Promise(resolve => setImmediate(resolve)); }); },
    dispose: async () => {
      await act(async () => { root?.unmount(); cleanups.reverse().forEach(cleanup => cleanup()); }); dom.window.close();
      for (const [key, descriptor] of Object.entries(savedGlobals)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    },
  };
}

test('the actual directory action is gated by availability, makes nothing before confirmation and resumes the unique coordinator', async () => {
  const unavailable = bench({ available: false });
  try { await unavailable.flush(); assert.equal(unavailable.action, undefined); assert.deepEqual(unavailable.requests.map(request => request.method), ['list']); }
  finally { await unavailable.dispose(); }
  const b = bench();
  try {
    await b.flush(); assert.ok(b.action); assert.deepEqual(b.requests.map(request => request.method), ['list']); assert.deepEqual(b.navigation, []);
    assert.equal(b.entries.some(entry => entry.options.name === 'sidebar.nav.tab'), false);
    // Cancelling a chooser never calls adopt; no draft/session transition occurs.
    await b.flush(); assert.deepEqual(b.navigation, []); assert.equal(b.requests.some(request => request.method === 'workspace/create'), false);
    await b.adopt();
    const rootStores = new Set(b.entries.filter(entry => ['shell.overlay', 'sidebar.workspaces.sections'].includes(entry.options.name)).map(entry => entry.options.store).filter(Boolean));
    assert.ok(rootStores.size > 0);
    assert.deepEqual(b.entries.filter(entry => entry.options.name.startsWith('conversation.') && rootStores.has(entry.options.store)).map(entry => entry.options.name), [], 'native slots require one scope per store handle; root viewing stores cannot mount under a session');
    assert.deepEqual(b.requests.filter(request => ['workspace/create', 'create'].includes(request.method)).map(request => request.method), ['create']);
    const creation = b.requests.find(request => request.method === 'create'); assert.equal(creation.input.workingDirectory, 'C:/workspace/alias'); assert.ok(creation.input.requestId);
    assert.deepEqual(b.navigation, [['tab', 'sessions'], ['session', 'coordinator-existing']]);
    await b.mount(); assert.equal(b.document.querySelector('[data-testid=project-progress]'), null);
    assert.ok(b.document.querySelector('.dsh-project-header button')); assert.equal(b.observer.getSnapshot(), null);
    assert.equal(b.requests.some(request => ['delegate', 'prompt', 'message', 'store/write'].includes(request.method)), false);
    await b.adopt(); assert.equal(b.sessionNavigation.size, 1); assert.deepEqual(Array.from(b.sessionNavigation.get('project').getSnapshot(), entry => ({ ...entry })), [{ sessionId: 'coordinator-existing', workingDirectory: 'C:/workspace/real', archived: false }]); assert.deepEqual(b.navigation.at(-1), ['session', 'coordinator-existing']);
    assert.equal(b.entries.some(entry => ['sidebar.nav.tab', 'sidebar.page'].includes(entry.options.name)), false);
    assert.equal(b.requests.some(request => request.method === 'session/create'), false);
  } finally { await b.dispose(); }
});

test('a rejected creation preserves the previous conversation and publishes no empty Project category', async () => {
  const b = bench({ rejectCreation: true });
  try { await b.flush(); await assert.rejects(b.action.adopt('C:/workspace/alias'), /Creation failed/); assert.deepEqual(b.navigation, []);
    assert.equal(b.entries.some(entry => entry.options.name === 'sidebar.nav.tab'), false); assert.equal(b.requests.some(request => request.method === 'detail'), false); }
  finally { await b.dispose(); }
});

test('Project header directory failures show a visible Toast without changing the overview', async () => {
  const b = bench({ language: 'en', rpcOverride: method => method === 'open'
    ? Promise.reject(new Error('The bound directory is unavailable')) : undefined });
  try {
    await b.flush(); await b.adopt(); await b.mount();
    const header = b.document.querySelector('.dsh-project-header');
    await b.press('real');
    const first = b.document.querySelector('[role=alert]');
    assert.ok(first && isVisible(first));
    assert.equal(first.textContent, 'Open project directory: The bound directory is unavailable');
    assert.equal(header.contains(first), false, 'Failure feedback does not take space in the header');
    assert.equal(b.observer.getSnapshot(), null);
    await b.press('real');
    assert.notEqual(b.document.querySelector('[role=alert]'), first, 'A repeated failure announces again');
    assert.equal(b.requests.filter(request => request.method === 'open').length, 2);
    await b.openObserver();
    assert.equal(b.observer.getSnapshot().panel.host, 'float');
  } finally { await b.dispose(); }
});

const workDetail = () => ({ activity: { running: 1, blocked: 0, queued: 0, state: 'running' }, workPage: { currentTotal: 1, currentCursor: null, currentNextCursor: null, historyTotal: 0 }, workstreams: [{ id: 'work-one', title: 'Implement feature', group: 'current', status: 'running', workerSessionId: 'worker-one', currentDelegationRef: 'actual-assignment', pendingSummary: true, latestReport: {
  delegationRef: 'actual-assignment', outcome: 'completed', at: 1000, summary: 'Actual worker summary', artifacts: [{ path: 'src/app.js', size: 3, sha256: '123', type: 'file' }], evidence: ['Worker ran the targeted command'], remainingIssues: ['An actual integration check remains'],
} }], workers: [{ sessionId: 'worker-one', workstreamId: 'work-one', role: 'worker', mode: 'existing', phase: 'active', activeRunId: 'run-one', cwd: 'C:/workspace/real' }] });

const taskCard = (id, title, status = 'running') => ({ id, projectId: 'project-one', title, revision: 1,
  goal: `${title} with an actual requirement`, goalPreview: `${title} with an actual requirement`, status, createdAt: 100, updatedAt: 200,
  conditions: ['Verify the behavior'], constraints: [], counts: { total: 0, completed: 0 }, members: [], memberTotal: 0,
  work: [], versions: [{ revision: 1, title, goal: `${title} with an actual requirement`, at: 100 }],
  ...(status === 'completed' ? { delivery: { id: `${id}-delivery`, outcome: 'completed', summary: `${title} was delivered`,
    summaryPreview: `${title} was delivered`, evidence: ['Verified output'], remainingIssues: [], at: 200, applicable: true, reportRefs: [], terminalRefs: [], artifacts: [] } } : {}) });

function taskForWork(detail, status = 'running') {
  const work = detail.workstreams[0], card = taskCard('request-one', work.title, status);
  card.work = [{ workstreamId: work.id, delegationRef: work.currentDelegationRef, workerSessionId: work.workerSessionId,
    title: work.title, memberName: 'Engineer', status: work.status, current: true, updatedAt: work.updatedAt ?? 1000,
    ...(work.latestReport ? { reportId: 'saved-report' } : {}) }];
  return card;
}

test('the Lead Project only opens its floating observer explicitly and collapse and expand preserve the same tab', async () => {
  const b = bench({ cards: [taskCard('task-a', 'Repair search')] });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.flush();
    assert.equal(b.sidebarRight.tabsIn(b.project.coordinatorSessionId).length, 0);
    assert.equal(b.requests.some(request => request.method === 'requests/list'), false);
    await b.openObserver();
    assert.equal(b.sidebarRight.tabsIn(b.project.coordinatorSessionId).length, 1);
    assert.equal(b.tabTypes.get('project').floatingOnly, true);
    assert.equal(b.observer.getSnapshot().panel.host, 'float');
    assert.equal(b.document.querySelector('[data-project-observer-mode]').dataset.projectObserverMode, 'full');
    assert.equal(b.document.querySelector('.dsh-project-observer-title-text').textContent, b.project.title);
    const original = b.observer.getSnapshot(), body = b.document.querySelector('[data-project-observer-mode]');
    assert.equal(body.querySelectorAll('[data-project-request-id=task-a]').length, 1);
    await b.press('observerStrip');
    assert.equal(b.document.querySelector('[data-project-observer-mode]').dataset.projectObserverMode, 'strip');
    assert.equal(b.observer.getSnapshot().panel.rect.height, 38);
    await b.press('observerExpand');
    assert.equal(b.document.querySelector('[data-project-observer-mode]').dataset.projectObserverMode, 'full');
    assert.equal(b.document.querySelector('[data-project-observer-mode]'), body);
    assert.equal(b.observer.getSnapshot().tab, original.tab);
    assert.equal(b.observer.getSnapshot().panel.id, original.panel.id);
    assert.equal(b.observer.getSnapshot().panel.host, 'float');
    assert.equal(b.document.querySelector('.dsh-project-observer-list').querySelectorAll('[data-project-request-id=task-a]').length, 1);
    await b.openObserver();
    assert.equal(b.sidebarRight.tabsIn(b.project.coordinatorSessionId).length, 1, 'Opening Project again focuses the existing observer');
  } finally { await b.dispose(); }
});

test('an empty Project opens a readable overview through its original header and stays closed after navigation', async () => {
  const b = bench({ language: 'zh', rpcOverride: (method, _input, project) => method === 'list'
    ? { ok: true, value: { projects: [project], available: true } } : undefined });
  try {
    await b.flush(); await b.adopt(); await b.mount();
    assert.equal(b.observer.getSnapshot(), null); assert.equal(b.document.querySelector('[data-project-observer-mode]'), null);
    await b.openObserver();
    const body = b.document.querySelector('[data-project-observer-mode]'), empty = body.querySelector('.dsh-project-observer-list .dsh-project-observer-empty');
    assert.equal(body.dataset.projectObserverMode, 'full'); assert.ok(isVisible(empty));
    assert.equal(empty.querySelector('strong').textContent, '还没有任务');
    assert.match(empty.querySelector('p').textContent, /直接在主对话里说你要完成什么/);
    assert.equal(b.document.querySelector('.dsh-project-observer-title-state').textContent, '待命');
    assert.ok(b.button('收起')); assert.equal(b.button('收起').getAttribute('aria-expanded'), 'true');
    await b.press('收起'); assert.equal(body.dataset.projectObserverMode, 'strip');
    assert.ok(isVisible(b.document.querySelector('.dsh-project-observer-title-state')));
    await b.press('展开');
    assert.equal(body.dataset.projectObserverMode, 'full'); assert.ok(b.button('任务')); assert.ok(b.button('团队')); assert.ok(b.button('成果与资料'));
    await b.press('close'); assert.equal(b.observer.getSnapshot(), null);
    await b.poll(); await b.mountSession(null); await b.mountSession(b.project.coordinatorSessionId);
    assert.ok(b.document.querySelector('.dsh-project-header button')); assert.equal(b.observer.getSnapshot(), null);
    assert.equal(b.sidebarRight.tabsIn(b.project.coordinatorSessionId).length, 0);
    assert.deepEqual(b.sent, []); assert.equal(b.requests.some(request => ['delegate', 'prompt', 'message', 'store/write'].includes(request.method)), false);
  } finally { await b.dispose(); }
});

test('observer state follows the current Project activity rather than the latest completed Request', async () => {
  const b = bench({ language: 'zh', cards: [taskCard('completed-request', 'Earlier delivered goal', 'completed')],
    rpcOverride: (method, _input, project) => method === 'list' ? { ok: true, value: { projects: [project], available: true } } : undefined });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); await b.press('收起');
    assert.equal(b.document.querySelector('.dsh-project-observer-title-text').textContent, b.project.title);
    assert.doesNotMatch(b.document.querySelector('.dsh-project-observer-title-text').textContent, /Earlier delivered goal/);
    for (const [state, label] of [['running', '进行中'], ['queued', '排队中'], ['pendingDelivery', '交付未完成'], ['summaryFailed', '汇总失败'],
      ['needsReview', '结果需复核'], ['paused', '已停止'], ['done', '已完成'], ['idle', '待命']]) {
      b.project.activity = { ...b.project.activity, state };
      await b.poll();
      assert.equal(b.document.querySelector('.dsh-project-observer-title-state').textContent, label, state);
      assert.equal(b.document.querySelector('[data-project-observer-mode]').dataset.projectObserverMode, 'strip');
    }
    b.project.archiving = true; await b.poll();
    assert.equal(b.document.querySelector('.dsh-project-observer-title-state').textContent, '归档中');
    b.project.archiving = false; b.project.lifecycle = 'archived'; await b.poll();
    assert.equal(b.document.querySelector('.dsh-project-observer-title-state').textContent, '已归档');
    assert.deepEqual(b.sent, []);
  } finally { await b.dispose(); }
});

test('a minimum-width Project float keeps its single collapse and expand control reachable', async () => {
  const b = bench({ language: 'zh' });
  try {
    Object.defineProperty(b.document.defaultView, 'innerWidth', { configurable: true, value: 236 });
    Object.defineProperty(b.document.defaultView, 'innerHeight', { configurable: true, value: 420 });
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver();
    assert.equal(b.observer.getSnapshot().panel.rect.width, 220);
    assert.equal(b.document.querySelectorAll('.dsh-project-mode-button').length, 1);
    assert.equal(b.document.querySelector('.dsh-project-observer-title-state').textContent, '待命');
    for (const [label, mode] of [['收起', 'strip'], ['展开', 'full'], ['收起', 'strip'], ['展开', 'full']]) {
      assert.ok(b.button(label)); await b.press(label);
      assert.equal(b.document.querySelector('[role=menu]'), null);
      assert.equal(b.document.querySelector('[data-project-observer-mode]').dataset.projectObserverMode, mode);
      const rect = b.observer.getSnapshot().panel.rect;
      assert.ok(rect.x >= 8 && rect.x + rect.width <= 236); assert.ok(rect.y + rect.height <= 408);
    }
    await b.press('close'); assert.equal(b.observer.getSnapshot(), null);
  } finally { await b.dispose(); }
});

test('an explicitly reopened saved strip expands the existing observer without replacing its body or notes', async () => {
  const b = bench();
  try {
    await b.flush(); await b.adopt();
    const savedTab = { id: 'saved-project-tab', kind: 'project', title: 'Project' }, savedPanel = { id: 'saved-project-pane', host: 'float', rect: { x: 96, y: 80, width: 350, height: 38 } };
    b.observer.set({ tab: savedTab, panel: savedPanel });
    await b.mount();
    const body = b.document.querySelector('[data-project-observer-mode]');
    assert.equal(body.dataset.projectObserverMode, 'strip'); assert.equal(b.observer.getSnapshot().panel.rect.height, 38, 'Mounting a restored strip does not auto-expand');
    await b.openObserver();
    assert.equal(b.observer.getSnapshot().tab, savedTab); assert.equal(b.observer.getSnapshot().panel.id, savedPanel.id);
    assert.deepEqual({ ...b.observer.getSnapshot().panel.rect }, { x: 96, y: 80, width: 350, height: 520 });
    assert.equal(b.document.querySelector('[data-project-observer-mode]'), body); assert.equal(body.dataset.projectObserverMode, 'full');
    await b.press('materials'); await b.press('notes'); await b.changeNotes('Keep the original editor draft');
    const editor = b.document.querySelector('textarea');
    await b.press('observerStrip'); await b.openObserver(); await b.expandObserver();
    assert.equal(b.document.querySelector('textarea'), editor); assert.equal(editor.value, 'Keep the original editor draft');
    assert.ok(isVisible(editor));
    await b.openObserver(); assert.equal(body.dataset.projectObserverMode, 'full'); assert.equal(b.document.querySelector('textarea'), editor);
    await b.press('close'); assert.ok(b.document.querySelector('[role=dialog][aria-label=unsaved]'));
    assert.equal(b.requests.some(request => request.method === 'store/write'), false);
  } finally { await b.dispose(); }
});

test('the English short-window observer uses one collapse and expand control and keeps the current summary failure state', async () => {
  const b = bench({ language: 'en', detail: { activity: { state: 'summaryFailed', summaryFailed: 1 } } });
  try {
    Object.defineProperty(b.document.defaultView, 'innerWidth', { configurable: true, value: 296 });
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver();
    assert.equal(b.document.querySelectorAll('.dsh-project-mode-button').length, 1);
    assert.equal(b.document.querySelector('.dsh-project-observer-title-state').textContent, 'Summary failed');
    assert.ok(b.button('Collapse')); assert.equal(b.button('Collapse').getAttribute('aria-expanded'), 'true');
    await b.press('Collapse'); assert.ok(b.button('Expand')); assert.equal(b.button('Expand').getAttribute('aria-expanded'), 'false');
    assert.equal(b.document.querySelector('.dsh-project-observer-title-state').textContent, 'Summary failed');
    await b.press('Expand'); assert.equal(b.document.querySelector('[data-project-observer-mode]').dataset.projectObserverMode, 'full');
    await b.press('close'); assert.equal(b.observer.getSnapshot(), null);
  } finally { await b.dispose(); }
});

test('window and composer fitting preserve the latest user placement and only clamp actual overlap', async () => {
  const b = bench();
  try {
    Object.defineProperty(b.document.defaultView, 'innerWidth', { configurable: true, value: 1000 });
    Object.defineProperty(b.document.defaultView, 'innerHeight', { configurable: true, value: 800 });
    let composerTop = 700;
    const composer = b.document.createElement('div'); composer.setAttribute('data-composer-card', '');
    composer.getBoundingClientRect = () => ({ top: composerTop, height: 80 }); b.document.body.append(composer);
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver();
    const initial = b.observer.getSnapshot(), moved = { x: 96, y: 112, width: 350, height: 196 };
    await act(async () => { b.sidebarRight.resizeFloat(initial.panel.id, moved); });
    const beforeFit = b.resizes.length;
    await act(async () => { b.document.defaultView.dispatchEvent(new b.document.defaultView.Event('resize')); });
    assert.deepEqual({ ...b.observer.getSnapshot().panel.rect }, moved); assert.equal(b.resizes.length, beforeFit);
    composerTop = 420;
    await act(async () => { b.resizeObservers.find(observer => !observer.disconnected).callback(); });
    assert.deepEqual({ ...b.observer.getSnapshot().panel.rect }, moved); assert.equal(b.resizes.length, beforeFit);
    composerTop = 280;
    await act(async () => { b.resizeObservers.find(observer => !observer.disconnected).callback(); });
    assert.deepEqual({ ...b.observer.getSnapshot().panel.rect }, { ...moved, y: 72 });
    assert.equal(b.resizes.length, beforeFit + 1);
    composerTop = 700;
    await act(async () => { b.resizeObservers.find(observer => !observer.disconnected).callback(); });
    // Room returning restores the user's frame; collapsing must not replace it with a default height.
    await b.press('observerStrip'); assert.deepEqual({ ...b.observer.getSnapshot().panel.rect }, { ...moved, height: 38 });
    await b.press('observerExpand'); assert.deepEqual({ ...b.observer.getSnapshot().panel.rect }, moved);
  } finally { await b.dispose(); }
});

test('a restored Project observer never saves a zero-size boot viewport and remains readable after reveal', async () => {
  for (const viewport of [{ width: 0, height: 0 }, { width: 0, height: 912 }, { width: 1441, height: 0 }]) {
    const b = bench(); let unsubscribeModes, unsubscribeSaved;
    try {
      await b.flush(); await b.adopt();
      const tab = { id: 'restored-project-tab', kind: 'project', title: 'Project' };
      const rect = { x: 949, y: 80, width: 480, height: 520 };
      const restored = { tab, panel: { id: 'restored-project-pane', host: 'float', rect } };
      b.observer.set(restored);
      Object.defineProperty(b.document.defaultView, 'innerWidth', { configurable: true, value: viewport.width });
      Object.defineProperty(b.document.defaultView, 'innerHeight', { configurable: true, value: viewport.height });
      const modes = b.face().hooks.observerModes, initialModes = modes.getSnapshot();
      let modeWrites = 0, savedWrites = 0;
      unsubscribeModes = modes.subscribe(() => modeWrites++); unsubscribeSaved = b.observer.subscribe(() => savedWrites++);
      await b.mount();
      const body = b.document.querySelector('[data-project-observer-mode]'); assert.ok(body);
      assert.equal(body.dataset.projectObserverMode, 'full');
      await b.mountSession(null); await b.mountSession(b.project.coordinatorSessionId);
      assert.equal(b.document.querySelector('[data-project-observer-mode]'), body);
      assert.equal(b.observer.getSnapshot(), restored); assert.equal(b.observer.getSnapshot().panel.rect, rect);
      assert.equal(b.resizes.length, 0, 'Boot fitting must not issue a saved-layout resize');
      assert.equal(savedWrites, 0); assert.equal(modeWrites, 0); assert.equal(modes.getSnapshot(), initialModes);

      Object.defineProperty(b.document.defaultView, 'innerWidth', { configurable: true, value: 1441 });
      Object.defineProperty(b.document.defaultView, 'innerHeight', { configurable: true, value: 912 });
      await act(async () => { b.document.defaultView.dispatchEvent(new b.document.defaultView.Event('resize')); });
      assert.deepEqual({ ...b.observer.getSnapshot().panel.rect }, rect);
      assert.equal(b.resizes.length, 0); assert.equal(savedWrites, 0); assert.equal(modeWrites, 0);
      assert.equal(b.document.querySelector('[data-project-observer-mode]'), body); assert.ok(isVisible(body));
      assert.equal(body.dataset.projectObserverMode, 'full'); assert.ok(b.button('observerStrip'));
      await b.press('observerStrip');
      assert.deepEqual({ ...b.observer.getSnapshot().panel.rect }, { ...rect, height: 38 });
      assert.equal(body.dataset.projectObserverMode, 'strip');
      await b.press('observerExpand');
      assert.deepEqual({ ...b.observer.getSnapshot().panel.rect }, rect);
      assert.equal(body.dataset.projectObserverMode, 'full');
      assert.equal(b.document.querySelector('[data-project-observer-mode]'), body); assert.equal(b.observer.getSnapshot().tab, tab);
    } finally { unsubscribeModes?.(); unsubscribeSaved?.(); await b.dispose(); }
  }
});

test('a restored full observer stays expanded when fitting a shorter window', async () => {
  const b = bench();
  try {
    Object.defineProperty(b.document.defaultView, 'innerWidth', { configurable: true, value: 1000 });
    Object.defineProperty(b.document.defaultView, 'innerHeight', { configurable: true, value: 800 });
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver();
    const current = b.observer.getSnapshot(), restored = { x: 96, y: 100, width: 350, height: 600 };
    await act(async () => { b.sidebarRight.resizeFloat(current.panel.id, restored); });
    const body = b.document.querySelector('[data-project-observer-mode]');
    assert.equal(body.dataset.projectObserverMode, 'full'); assert.equal(b.face().hooks.observerModes.getSnapshot()[b.project.coordinatorSessionId], undefined);
    Object.defineProperty(b.document.defaultView, 'innerHeight', { configurable: true, value: 400 });
    await act(async () => { b.document.defaultView.dispatchEvent(new b.document.defaultView.Event('resize')); });
    assert.deepEqual({ ...b.observer.getSnapshot().panel.rect }, { x: 96, y: 20, width: 350, height: 368 });
    assert.equal(body.dataset.projectObserverMode, 'full'); assert.ok(b.button('taskMaterials'));
    await b.mountSession(null); await b.mountSession(b.project.coordinatorSessionId);
    assert.equal(b.document.querySelector('[data-project-observer-mode]'), body); assert.equal(body.dataset.projectObserverMode, 'full');
  } finally { await b.dispose(); }
});

test('retained observers with identical pane and tab ids keep per-Session modes and only fit the mounted Session', async () => {
  const b = bench({ cards: [taskCard('shared-task', 'Shared task id')], rpcOverride: (method, input, project) => method === 'detail' && input.projectId === 'project-two'
    ? { ok: true, value: { project: { ...project, id: 'project-two', title: 'Second Project', coordinatorSessionId: 'coordinator-two' }, workers: [], workstreams: [], revision: 'revision-two' } } : undefined });
  const ownerA = b.project.coordinatorSessionId, ownerB = 'coordinator-two';
  const body = owner => b.document.querySelector(`[data-observer-session="${owner}"] .dsh-project-observer`);
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); await b.press('observerStrip');
    const retainedA = body(ownerA), staleFit = b.resizeObservers.at(-1).callback;
    await act(async () => { await b.face().readDetail('project-two'); b.face().openObserver('project-two'); });
    const retainedB = body(ownerB), sourceB = b.observerIn(ownerB);
    assert.ok(retainedA); assert.ok(retainedB); assert.equal(isVisible(retainedB), false);
    assert.equal(b.observer.getSnapshot().panel.id, sourceB.getSnapshot().panel.id);
    assert.equal(b.observer.getSnapshot().tab.id, sourceB.getSnapshot().tab.id);
    assert.equal(retainedB.dataset.projectObserverMode, 'full', 'A remembered strip does not change B with the same pane id');
    assert.equal(sourceB.getSnapshot().panel.rect.height, 520, 'The initial Project float leaves room for the conversation');
    await b.mountSession(ownerB); await b.expandObserver();
    assert.equal(retainedA.dataset.projectObserverMode, 'strip'); assert.equal(retainedB.dataset.projectObserverMode, 'full');
    assert.equal(b.observer.getSnapshot().panel.rect.height, 38);
    const bHeight = sourceB.getSnapshot().panel.rect.height, beforeStale = b.resizes.length;
    await act(async () => {
      staleFit();
      b.face().resizeObserver(ownerA, b.observer.getSnapshot().panel, b.observer.getSnapshot().tab.id, 'full');
    });
    assert.equal(b.resizes.length, beforeStale, 'A late background callback cannot reach foreground native pane operations');
    assert.equal(sourceB.getSnapshot().panel.rect.height, bHeight); assert.equal(retainedA.dataset.projectObserverMode, 'strip');
    Object.defineProperty(b.document.defaultView, 'innerHeight', { configurable: true, value: 520 });
    const beforeResize = b.resizes.length;
    await act(async () => { b.document.defaultView.dispatchEvent(new b.document.defaultView.Event('resize')); });
    assert.equal(b.resizes.length, beforeResize + 1, 'Only the active retained observer subscribes to window resizing');
    assert.equal(sourceB.getSnapshot().panel.rect.height, 488); assert.equal(b.observer.getSnapshot().panel.rect.height, 38);
    assert.equal(b.resizes.at(-1).sessionId, ownerB);
    await b.mountSession(ownerA);
    assert.equal(body(ownerA), retainedA); assert.equal(body(ownerB), retainedB);
    assert.equal(retainedA.dataset.projectObserverMode, 'strip'); assert.equal(retainedB.dataset.projectObserverMode, 'full');
    assert.equal(b.observer.getSnapshot().panel.rect.height, 38);
    Object.defineProperty(b.document.defaultView, 'innerWidth', { configurable: true, value: 296 });
    await act(async () => { b.document.defaultView.dispatchEvent(new b.document.defaultView.Event('resize')); });
    assert.equal(b.observer.getSnapshot().panel.rect.width, 280, 'The active strip fits even though its retained body tab is not visible');
    assert.equal(sourceB.getSnapshot().panel.rect.width, 480);
    await b.mountSession(null);
    const beforeSettings = b.resizes.length;
    await act(async () => {
      b.document.defaultView.dispatchEvent(new b.document.defaultView.Event('resize'));
      staleFit();
      b.face().resizeObserver(ownerB, sourceB.getSnapshot().panel, sourceB.getSnapshot().tab.id, 'full');
    });
    assert.equal(b.resizes.length, beforeSettings, 'A settings page without a Session issues no native pane operations and does not throw');
    await b.mountSession(ownerB);
    assert.equal(retainedB.dataset.projectObserverMode, 'full'); assert.equal(sourceB.getSnapshot().panel.rect.width, 280);
    assert.equal(b.resizeObservers.filter(observer => !observer.disconnected).length, 1);
  } finally { await b.dispose(); }
});

test('closing a clean Session observer cannot consume another Session draft with the same tab id', async () => {
  const b = bench({ rpcOverride: (method, input, project) => method === 'detail' && input.projectId === 'project-two'
    ? { ok: true, value: { project: { ...project, id: 'project-two', title: 'Second Project', coordinatorSessionId: 'coordinator-two' }, workers: [], workstreams: [] } } : undefined });
  const ownerA = b.project.coordinatorSessionId, ownerB = 'coordinator-two';
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.press('materials'); await b.press('notes');
    const editorA = b.document.querySelector(`[data-observer-session="${ownerA}"] textarea`);
    await act(async () => { await b.face().readDetail('project-two'); b.face().openObserver('project-two'); });
    await b.changeNotes('Unsaved original Session A notes');
    await b.mountSession(ownerB); await b.press('materials'); await b.press('notes');
    assert.equal(b.observer.getSnapshot().tab.id, b.observerIn(ownerB).getSnapshot().tab.id);
    assert.equal(b.document.querySelector(`[data-observer-session="${ownerB}"] textarea`).value, 'Initial notes');
    await b.press('close');
    assert.equal(b.observerIn(ownerB).getSnapshot(), null, 'A clean B closes immediately rather than opening A draft confirmation');
    assert.equal(b.document.querySelector('[role=dialog][aria-label=unsaved]'), null);
    assert.equal(editorA.value, 'Unsaved original Session A notes'); assert.ok(b.observer.getSnapshot());
    await b.mountSession(ownerA); await b.press('close');
    assert.ok(b.observer.getSnapshot(), 'The A observer stays mounted until its own dirty editor is resolved');
    assert.ok(b.document.querySelector('[role=dialog][aria-label=unsaved]'));
    await b.press('keepEditing'); assert.equal(b.document.querySelector(`[data-observer-session="${ownerA}"] textarea`), editorA);
    assert.equal(editorA.value, 'Unsaved original Session A notes'); assert.equal(b.requests.some(request => request.method === 'store/write'), false);
  } finally { await b.dispose(); }
});

test('a late file preview from a background Session cannot contract the mounted observer with the same pane id', async () => {
  let finishPreview;
  const b = bench({ previewOverride: () => new Promise(resolve => { finishPreview = resolve; }), rpcOverride: (method, input, project) => method === 'detail' && input.projectId === 'project-two'
    ? { ok: true, value: { project: { ...project, id: 'project-two', title: 'Second Project', coordinatorSessionId: 'coordinator-two' }, workers: [], workstreams: [] } } : undefined });
  const ownerA = b.project.coordinatorSessionId, ownerB = 'coordinator-two';
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.press('materials'); await b.disclose('docs (1)');
    const file = b.button('openFile: report.md');
    await act(async () => { file.focus(); file.click(); await new Promise(resolve => setImmediate(resolve)); });
    assert.equal(typeof finishPreview, 'function');
    await act(async () => { await b.face().readDetail('project-two'); b.face().openObserver('project-two'); });
    await b.mountSession(ownerB); await b.expandObserver();
    const sourceB = b.observerIn(ownerB), originalB = sourceB.getSnapshot().panel.rect, beforeCompletion = b.resizes.length;
    await act(async () => { finishPreview(); await new Promise(resolve => setImmediate(resolve)); });
    assert.equal(b.opened.length, 1); assert.equal(b.opened[0].options.sessionId, ownerA);
    assert.equal(b.resizes.length, beforeCompletion, 'Completing A native preview does not mutate B geometry');
    assert.equal(sourceB.getSnapshot().panel.rect, originalB);
    assert.equal(b.document.querySelector(`[data-observer-session="${ownerB}"] .dsh-project-observer`).dataset.projectObserverMode, 'full');
    await b.mountSession(ownerA);
    assert.equal(b.document.querySelector(`[data-observer-session="${ownerA}"] .dsh-project-observer`).dataset.projectObserverMode, 'full', 'The late preview does not change the background Session remembered mode either');
  } finally { await b.dispose(); }
});

test('task cards open the exact Request and show its team, result and activity under one Project', async () => {
  const task = taskCard('task-a', 'Repair search', 'completed');
  task.work = [{ workstreamId: 'work-one', delegationRef: 'actual-assignment', title: 'Implement feature', memberName: 'Engineer',
    workerSessionId: 'worker-one', status: 'completed', hasReport: true, updatedAt: 150, assignmentAt: 120, reportAt: 180, terminalAt: 190 }];
  const b = bench({ detail: workDetail(), cards: [task] });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.flush(); await b.openObserver(); await b.expandObserver();
    await b.press(task.title);
    assert.equal(b.requests.filter(request => request.method === 'requests/get').at(-1).input.requestId, task.id);
    assert.equal(b.document.querySelector('[data-project-detail-id]').dataset.projectDetailId, task.id);
    assert.match(b.document.querySelector('.dsh-project-task-tab-body').textContent, /actual requirement/);
    await b.press('taskTeam'); assert.match(b.document.querySelector('.dsh-project-task-tab-body').textContent, /Engineer/);
    await b.press('taskResults'); assert.match(b.document.querySelector('.dsh-project-task-tab-body').textContent, /was delivered/);
    await b.press('taskActivity'); assert.match(b.document.querySelector('.dsh-project-task-tab-body').textContent, /requestVersion/);
    assert.equal(b.navigation.some(entry => entry[0] === 'session' && entry[1] === 'worker-one'), false);
  } finally { await b.dispose(); }
});

test('the delivered Request card opens its exact results tab from View results', async () => {
  const task = taskCard('delivered-result', 'Delivered analysis', 'completed');
  const b = bench({ language: 'en', cards: [task] });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver();
    const card = b.document.querySelector('[data-project-request-id=delivered-result]'); assert.ok(card && isVisible(card));
    const viewResults = [...card.querySelectorAll('button')].find(button => button.textContent === 'View results'); assert.ok(viewResults);
    await act(async () => { viewResults.click(); await new Promise(resolve => setImmediate(resolve)); });
    assert.equal(b.requests.filter(request => request.method === 'requests/get').at(-1).input.requestId, task.id);
    assert.equal(b.document.querySelector('[data-project-detail-id]').dataset.projectDetailId, task.id);
    const results = b.document.querySelector('.dsh-project-task-tab-body');
    assert.equal(results.id, `${task.id}-panel-results`); assert.ok(isVisible(results));
    assert.match(visibleText(results), /Delivered analysis was delivered/);
    assert.doesNotMatch(visibleText(results), /actual requirement/);
    assert.equal(b.requests.some(request => request.method === 'session/create' || request.method === 'archive'), false);
  } finally { await b.dispose(); }
});

test('completed Request cards move to the second-level archive without archiving the Project', async () => {
  const current = taskCard('task-open', 'Current request');
  const completed = taskCard('task-done', 'Delivered request', 'completed');
  const b = bench({ cards: [current, completed] });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.flush(); await b.openObserver(); await b.expandObserver();
    const list = b.document.querySelector('.dsh-project-observer-list');
    assert.deepEqual([...list.querySelectorAll('[data-project-request-id]')].map(element => element.dataset.projectRequestId), ['task-open', 'task-done']);
    await b.press('Delivered request · more'); await b.press('taskArchiveAction'); await b.flush();
    assert.deepEqual(b.requests.filter(request => request.method === 'requests/archive').map(request => ({ ...request.input })), [{ projectId: 'project-one', requestId: 'task-done' }]);
    assert.equal(b.project.lifecycle, 'ready'); assert.equal(b.requests.some(request => request.method === 'archive'), false);
    assert.equal(list.querySelector('[data-project-request-id=task-done]'), null);
    await b.press('taskArchive · 1');
    assert.equal(list.querySelector('[data-project-request-id=task-done]')?.textContent.includes('Delivered request'), true);
    await b.press('Delivered request · more'); await b.press('taskRestoreAction'); await b.flush();
    assert.deepEqual(b.requests.filter(request => request.method === 'requests/restore').map(request => ({ ...request.input })), [{ projectId: 'project-one', requestId: 'task-done' }]);
  } finally { await b.dispose(); }
});

test('the full Project float shows the native Team roster and returns from one exact member record', async () => {
  const team = { members: [
    { id: 'coordinator-existing', role: 'lead', name: 'Lead', phase: 'active' },
    { id: 'worker-one', role: 'worker', name: 'Engineer', description: 'Implementation', phase: 'active' },
  ], tasks: [{ id: 'team-task', subject: 'Search endpoint', description: 'Inspect search queries', ownerName: 'Engineer', status: 'in_progress' }] };
  const b = bench({ detail: workDetail(), team });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); await b.expandObserver(); await b.press('team');
    const overview = b.document.querySelector('.dsh-project-observer-team');
    assert.match(overview.textContent, /Engineer|Search endpoint|Inspect search queries/);
    assert.equal(overview.querySelectorAll('.dsh-project-team-row').length, 2);
    await b.press('viewProcess'); await b.flush();
    assert.equal(b.requests.filter(request => request.method === 'workstreams/get').at(-1).input.workerSessionId, 'worker-one');
    assert.equal(b.navigation.some(row => row[0] === 'session' && row[1] === 'worker-one'), false);
    await b.press('teamBack'); assert.match(b.document.querySelector('.dsh-project-observer-team').textContent, /Engineer|Search endpoint/);
  } finally { await b.dispose(); }
});

test('the Project Team shows real work names, queue reasons and report states without repeating assigned work', async () => {
  const sessionId = index => `session-00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const names = ['Review source', 'Check dependencies', 'Update files', 'Validate layout', 'Save report', 'Prepare delivery', 'Resolve blocker'];
  const report = { delegationRef: 'report-round', outcome: 'completed', at: 1000, summary: 'Saved member report', artifacts: [], evidence: [], remainingIssues: [] };
  const detail = { workstreams: names.map((title, index) => ({ id: `work-${index}`, title, workerSessionId: sessionId(index + 1),
    status: index >= 4 && index <= 5 ? 'done' : index === 6 ? 'blocked' : index === 0 ? 'running' : 'open',
    currentDelegationRef: index >= 4 && index <= 5 ? 'report-round' : `round-${index}`,
    ...(index >= 1 && index <= 3 ? { delegation: { phase: 'queued', waitingReason: { kind: ['dependencies', 'directory', 'capacity'][index - 1], workTitles: index === 3 ? [] : ['API contract'] } } } : {}),
    ...(index >= 4 && index <= 5 ? { latestReport: report, pendingSummary: index === 5 } : {}),
    ...(index === 6 ? { blockedReason: 'Target branch is unavailable' } : {}) })),
  workers: names.map((_title, index) => ({ sessionId: sessionId(index + 1), workstreamId: `work-${index}`, phase: 'active', jobs: [] })) };
  const team = { members: [{ id: 'coordinator-existing', role: 'lead', name: 'lead', phase: 'active' }, ...names.map((title, index) => ({
    id: sessionId(index + 1), name: `member-${sessionId(index + 1).replace(/^session-/, '')}`, description: title, role: 'member', phase: 'active',
  }))], tasks: names.map((subject, index) => ({ id: `work-${index}`, subject, description: `Accepted work: ${subject}`,
    ownerName: `member-${sessionId(index + 1).replace(/^session-/, '')}`, status: index >= 4 && index <= 5 ? 'completed' : 'in_progress', blockedBy: [] })) };
  team.tasks.push({ id: 'unassigned-check', subject: 'Unassigned check', description: 'A real unassigned task', status: 'pending', blockedBy: [] });
  const b = bench({ language: 'zh', detail, team, runtimeSessions: { [sessionId(1)]: { id: sessionId(1), running: true } } });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); await b.press('团队');
    const overview = b.document.querySelector('.dsh-project-observer-team'), text = visibleText(overview);
    assert.equal(overview.querySelectorAll('[data-team-member-id]').length, 8);
    assert.equal(new Set([...overview.querySelectorAll('[data-team-member-id]')].map(row => row.dataset.teamMemberId)).size, 8);
    assert.doesNotMatch(text, /member-00000000|session-00000000/);
    assert.equal(overview.querySelectorAll('.dsh-project-team-work').length, 1);
    assert.equal(overview.querySelector('.dsh-project-team-work strong').textContent, 'Unassigned check');
    const states = ['进行中', '排队中', '排队中', '排队中', '已提交报告', '等待汇总', '需要处理'];
    for (const [index, title] of names.entries()) {
      const row = overview.querySelector(`[data-team-member-id="${sessionId(index + 1)}"]`);
      assert.equal(row.querySelector('.dsh-project-team-row-content strong').textContent, title);
      assert.equal(row.querySelector('.dsh-project-team-row > span').textContent, states[index]);
      assert.equal(text.split(title).length - 1, 1, 'Assigned work appears once in the visible roster');
    }
    assert.match(visibleText(overview.querySelector(`[data-team-member-id="${sessionId(2)}"]`)), /等待前置工作完成.*API contract/);
    assert.match(visibleText(overview.querySelector(`[data-team-member-id="${sessionId(3)}"]`)), /等待其他工作释放目录.*API contract/);
    assert.match(visibleText(overview.querySelector(`[data-team-member-id="${sessionId(4)}"]`)), /等待团队空出执行名额/);
    assert.match(visibleText(overview.querySelector(`[data-team-member-id="${sessionId(7)}"]`)), /Target branch is unavailable/);
    assert.doesNotMatch(visibleText(overview.querySelector(`[data-team-member-id="${sessionId(5)}"]`)), /空闲|已交付/);
    const worker = overview.querySelector(`[data-team-member-id="${sessionId(1)}"]`);
    await b.disclose('详情', worker); await b.disclose('执行信息', worker);
    assert.match(visibleText(worker), /member-00000000-0000-4000-8000-000000000001/);
    await act(async () => { worker.querySelector('button').click(); await new Promise(resolve => setImmediate(resolve)); });
    assert.equal(b.requests.filter(request => request.method === 'workstreams/get').at(-1).input.workerSessionId, sessionId(1));
    assert.equal(b.navigation.some(row => row[0] === 'session' && row[1] === sessionId(1)), false);
  } finally { await b.dispose(); }
});

test('the Project Team uses whole-project summary failure even without a displayed workstream', async () => {
  const failure = { delegationRef: 'failed-summary-round', error: { code: 'summary/rejected', message: 'The current summary was rejected' } };
  for (const displayed of [true, false]) {
    const detail = { activity: { state: 'summaryFailed', summaryFailed: 1, coordinatorRunning: false },
      workstreams: displayed ? [{ id: 'failed-summary-work', title: 'Saved analysis', workerSessionId: 'worker-one', status: 'done',
        currentDelegationRef: failure.delegationRef, pendingSummary: true, summaryFailure: failure,
        latestReport: { delegationRef: failure.delegationRef, outcome: 'completed', summary: 'Saved member analysis', artifacts: [] } }] : [],
      workers: displayed ? [{ sessionId: 'worker-one', phase: 'active', jobs: [] }] : [] };
    const team = { members: [{ id: 'coordinator-existing', role: 'lead', name: 'Lead', phase: 'active' },
      ...(displayed ? [{ id: 'worker-one', role: 'member', name: 'Analyst', phase: 'active' }] : [])], tasks: [] };
    const b = bench({ language: 'en', detail, team });
    try {
      await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); await b.press('Team');
      const overview = b.document.querySelector('.dsh-project-observer-team'), lead = overview.querySelector('[data-team-member-id=coordinator-existing]');
      assert.equal(lead.querySelector('.dsh-project-team-row > span').textContent, 'Summary failed');
      assert.match(visibleText(lead), /The summary did not finish/);
      assert.doesNotMatch(visibleText(lead), /Ready|Awaiting summary|Working in the main conversation|request is delivered/);
      if (displayed) {
        const worker = overview.querySelector('[data-team-member-id=worker-one]');
        assert.equal(worker.querySelector('.dsh-project-team-row > span').textContent, 'Summary failed');
        await b.disclose('Details', worker); await b.disclose('Error details', worker);
        assert.match(visibleText(worker), /summary\/rejected.*The current summary was rejected/s);
      }
    } finally { await b.dispose(); }
  }
});

test('the Project Team does not promise automatic summary for paused or cold-held member reports', async () => {
  for (const hold of ['project', 'cold-report', 'cold-unfinished']) {
    const completed = hold !== 'cold-unfinished', stopped = hold !== 'project';
    const detail = { activity: { state: hold === 'cold-report' ? 'idle' : 'paused', coordinatorRunning: false, pendingSummary: 0, pendingDelivery: 0 },
      workstreams: [{ id: 'held-work', title: 'Retained analysis', workerSessionId: 'worker-one', status: completed ? 'done' : 'blocked',
        currentDelegationRef: 'held-round', pendingSummary: true, ...(completed ? {
          latestReport: { delegationRef: 'held-round', outcome: 'completed', summary: 'Saved member analysis', artifacts: [] },
        } : { blockedReason: 'stopped' }) }], workers: [{ sessionId: 'worker-one', phase: 'active', stopped, jobs: [] }] };
    const team = { members: [{ id: 'coordinator-existing', role: 'lead', name: 'Lead', phase: 'active' },
      { id: 'worker-one', role: 'member', name: 'Analyst', phase: 'active' }], tasks: [] };
    const b = bench({ language: 'en', detail, team }); b.project.paused = hold === 'project';
    try {
      await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); await b.press('Team');
      const overview = b.document.querySelector('.dsh-project-observer-team'), worker = overview.querySelector('[data-team-member-id=worker-one]');
      const lead = overview.querySelector('[data-team-member-id=coordinator-existing]');
      assert.equal(worker.querySelector('.dsh-project-team-row > span').textContent, completed ? 'Report submitted' : 'Stopped');
      assert.equal(lead.querySelector('.dsh-project-team-row > span').textContent, hold === 'cold-report' ? 'Ready' : 'Stopped');
      assert.doesNotMatch(visibleText(overview), /Awaiting summary|Preparing summary|Working in the main conversation|request is delivered/);
      if (!completed) assert.match(visibleText(worker), /Give a new instruction in the main conversation/);
      if (hold === 'project') assert.match(visibleText(lead), /Give a new instruction in the main conversation/);
      assert.equal(detail.workstreams[0].pendingSummary, true, 'The held report record is retained, not rewritten to hide the state');
    } finally { await b.dispose(); }
  }
});

test('the Project Team distinguishes background work from the coordinator main-conversation run', async () => {
  for (const coordinatorRunning of [false, true]) {
    const detail = { activity: { state: 'running', running: 1, coordinatorRunning },
      workstreams: [{ id: 'background-work', title: 'Background analysis', workerSessionId: 'worker-one', status: 'running' }],
      workers: [{ sessionId: 'worker-one', activeRunId: 'worker-run', phase: 'active', jobs: [] }] };
    const team = { members: [{ id: 'coordinator-existing', role: 'lead', name: 'Lead', phase: 'active' },
      { id: 'worker-one', role: 'member', name: 'Analyst', phase: 'active' }], tasks: [] };
    const b = bench({ language: 'en', detail, team, runtimeSessions: { 'coordinator-existing': { id: 'coordinator-existing', running: !coordinatorRunning } } });
    try {
      await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); await b.press('Team');
      const overview = b.document.querySelector('.dsh-project-observer-team'), lead = overview.querySelector('[data-team-member-id=coordinator-existing]');
      assert.equal(lead.querySelector('.dsh-project-team-row > span').textContent, 'In progress');
      assert.equal(overview.querySelector('[data-team-member-id=worker-one] .dsh-project-team-row > span').textContent, 'In progress');
      if (coordinatorRunning) {
        assert.match(visibleText(lead), /Working in the main conversation/);
        assert.doesNotMatch(visibleText(lead), /coordinator is not running/);
      } else {
        assert.match(visibleText(lead), /Team members are working in the background; the coordinator is not running/);
        assert.doesNotMatch(visibleText(lead), /Working in the main conversation/);
      }
    } finally { await b.dispose(); }
  }
});

test('committed GenUI pages reach the factory with their exact publisher and file props in materials and Request results', async () => {
  const card = taskCard('published-request', 'Published analysis', 'completed');
  const pages = [
    { callId: 'visual-call-one', sessionId: 'publisher-worker-one', file: { attachmentId: 'attachment-one', name: 'chart.html', bytes: 2048 }, title: 'Analysis chart', height: 320 },
    { callId: 'visual-call-two', sessionId: 'publisher-worker-two', file: { attachmentId: 'attachment-two', name: 'diagram.html', bytes: 1024 }, title: 'Analysis diagram', height: 240 },
  ];
  card.delivery = { ...card.delivery, title: card.title, requestId: card.id, requestRevision: card.revision, pages };
  for (const available of [true, false]) {
    const b = bench({ cards: [card], factoryRenderer: available ? (name, props) => {
      assert.equal(name, 'visual-reply.page');
      return h('section', { 'data-genui-page': props.file.attachmentId, 'data-publisher-session': props.sessionId, 'data-height': props.height }, props.title);
    } : undefined, rpcOverride: method => method === 'store/list' ? { ok: true, value: { docs: [], results: [], deliveries: { items: [card.delivery], total: 1, nextCursor: null } } } : undefined });
    try {
      await b.flush(); await b.adopt(); await b.mount(); await b.press('materials'); await b.flush();
      const materialPages = b.document.querySelector('.dsh-project-visual-results'); assert.ok(materialPages); assert.ok(isVisible(materialPages));
      assert.match(b.document.querySelector('.dsh-project-materials').textContent, /Published analysis was delivered/);
      assert.equal(materialPages.querySelectorAll(available ? '[data-genui-page]' : '[role=status]').length, 2);
      if (available) assert.deepEqual([...materialPages.querySelectorAll('[data-publisher-session]')].map(page => page.dataset.publisherSession), pages.map(page => page.sessionId));
      await b.press('taskList'); await b.press(card.title); await b.press('taskResults'); await b.flush();
      const requestPages = b.document.querySelector('.dsh-project-task-tab-body .dsh-project-visual-results'); assert.ok(requestPages); assert.ok(isVisible(requestPages));
      assert.equal(requestPages.querySelectorAll(available ? '[data-genui-page]' : '[role=status]').length, 2);
      for (const call of b.factoryCalls) {
        const page = pages.find(page => page.file.attachmentId === call.props.file.attachmentId); assert.ok(page);
        assert.equal(call.name, 'visual-reply.page');
        assert.deepEqual(JSON.parse(JSON.stringify(call.props)), { sessionId: page.sessionId, file: page.file, title: page.title, height: page.height });
        assert.ok(React.isValidElement(call.options.fallback));
      }
      assert.equal(b.requests.some(request => request.method === 'open' || request.method === 'session/create'), false);
      assert.equal(b.opened.length, 0);
      assert.equal(b.navigation.some(row => row[0] === 'session' && row[1].startsWith('publisher-')), false);
    } finally { await b.dispose(); }
  }
});

test('already-open Materials refreshes committed delivery pages by detail revision without replacing an unsaved note draft', async () => {
  const detail = { revision: 'materials-resources-before' };
  const task = taskCard('new-material-delivery', 'Newly committed analysis', 'completed');
  const page = { callId: 'new-page-call', sessionId: 'original-page-publisher',
    file: { attachmentId: 'new-page-attachment', name: 'live-analysis.html', bytes: 2048 }, title: 'New analysis page', height: 360 };
  const delivery = { ...task.delivery, title: task.title, requestId: task.id, requestRevision: task.revision, pages: [page] };
  let listing = { docs: [], results: [], notes: 'notes.md', preferences: 'preferences.md',
    deliveries: { items: [], total: 0, nextCursor: null } };
  const b = bench({ language: 'en', detail, rpcOverride: (method, _input, project) => {
    if (method === 'list') return { ok: true, value: { projects: [project], available: true } };
    if (method === 'store/list') return { ok: true, value: listing };
  }, factoryRenderer: (name, props) => {
    assert.equal(name, 'visual-reply.page');
    return h('section', { 'data-genui-page': props.file.attachmentId, 'data-publisher-session': props.sessionId }, props.title);
  } });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); await b.press('Results & materials');
    const materials = b.document.querySelector('.dsh-project-materials'); assert.ok(materials && isVisible(materials));
    assert.match(visibleText(materials), /Results will be saved here/);
    assert.equal(materials.querySelector('[data-genui-page]'), null);
    await b.press('Notes'); await b.changeNotes('Keep this unsaved Project note');
    const editor = materials.querySelector('textarea'), listingReads = b.requests.filter(request => request.method === 'store/list').length;
    const noteReads = b.requests.filter(request => request.method === 'store/read' && request.input.path === 'notes.md').length;
    assert.ok(editor && isVisible(editor)); assert.equal(editor.value, 'Keep this unsaved Project note');

    listing = { ...listing, deliveries: { items: [delivery], total: 1, nextCursor: null } };
    detail.revision = 'materials-resources-after';
    await b.poll(); await b.flush();
    assert.equal(b.requests.filter(request => request.method === 'detail').at(-1).input.since, 'materials-resources-before');
    assert.equal(b.requests.filter(request => request.method === 'store/list').length, listingReads + 1);
    assert.equal(b.requests.filter(request => request.method === 'store/read' && request.input.path === 'notes.md').length, noteReads);
    assert.equal(b.document.querySelector('.dsh-project-materials'), materials);
    assert.equal(materials.querySelector('textarea'), editor); assert.ok(isVisible(editor));
    assert.equal(editor.value, 'Keep this unsaved Project note'); assert.equal(b.button('Save').disabled, false);
    assert.equal(b.document.querySelector('[role=tab][aria-selected=true]').textContent, 'Notes');
    assert.equal(b.requests.some(request => request.method === 'store/write'), false);

    await b.press('Results');
    assert.ok(b.document.querySelector('[role=dialog][aria-label="Unsaved changes"]'));
    assert.equal(materials.querySelector('textarea'), editor); assert.equal(editor.value, 'Keep this unsaved Project note');
    await b.press('Discard and switch');
    assert.equal(b.document.querySelector('.dsh-project-materials'), materials);
    assert.equal(b.requests.filter(request => request.method === 'store/list').length, listingReads + 1, 'Returning to results uses the revision-refreshed resources, not a new fetch');
    assert.match(visibleText(materials), /Newly committed analysis was delivered/);
    const renderedPage = materials.querySelector('[data-genui-page=new-page-attachment]'); assert.ok(renderedPage && isVisible(renderedPage));
    assert.equal(renderedPage.dataset.publisherSession, page.sessionId); assert.equal(renderedPage.textContent, page.title);
    assert.deepEqual(JSON.parse(JSON.stringify(b.factoryCalls.at(-1).props)), { sessionId: page.sessionId, file: page.file, title: page.title, height: page.height });
    assert.equal(b.requests.some(request => request.method === 'store/write'), false);
  } finally { await b.dispose(); }
});

test('Project navigation updates exact coordinator archive state and unregisters on dispose', async () => {
  let listed = true;
  const b = bench({ rpcOverride: (method, _input, project) => {
    if (method === 'list') return { ok: true, value: { available: true, projects: listed ? [project] : [] } };
    if (method === 'archive' || method === 'restore') { project.lifecycle = method === 'archive' ? 'archived' : 'ready'; return { ok: true, value: { project } }; }
  } });
  try {
    await b.flush(); await b.mount();
    const source = b.sessionNavigation.get('project'); assert.ok(source);
    const rows = () => Array.from(source.getSnapshot(), row => ({ ...row }));
    assert.deepEqual(rows(), [{ sessionId: b.project.coordinatorSessionId, workingDirectory: b.project.canonicalWorkingDirectory, archived: false }]);
    await act(async () => { await b.face().command(b.project.id, 'archive'); }); assert.equal(rows()[0].archived, true);
    await act(async () => { b.sessionActions.get('project').restore(b.project.coordinatorSessionId); await new Promise(resolve => setImmediate(resolve)); });
    assert.equal(rows()[0].archived, false); assert.equal(b.requests.filter(request => request.method === 'restore').at(-1).input.projectId, b.project.id);
    listed = false; await b.poll(); assert.deepEqual(rows(), []);
  } finally { await b.dispose(); }
  assert.equal(b.sessionNavigation.size, 0);
});

test('opening a Project material in the native mini preview contracts its originating float', async () => {
  const b = bench();
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.press('materials'); await b.flush();
    await b.disclose('docs (1)'); await b.press('openFile: report.md');
    assert.equal(b.opened.at(-1).path, 'C:/workspace/real/docs/report.md');
    assert.equal(b.opened.at(-1).options.presentation, 'mini');
    assert.equal(b.observer.getSnapshot().panel.rect.height, 38);
    assert.equal(b.document.querySelector('[data-project-observer-mode]').dataset.projectObserverMode, 'strip');
  } finally { await b.dispose(); }
});

test('collapsing and expanding preserves the exact Request page without duplicating task cards', async () => {
  const cards = Array.from({ length: 14 }, (_, index) => taskCard(`task-${index}`, `Task ${index}`));
  const b = bench({ cards });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.flush(); await b.openObserver();
    assert.equal(b.document.querySelector('.dsh-project-observer-title-text').textContent, b.project.title);
    assert.equal(b.document.querySelector('[data-project-observer-mode]').dataset.projectObserverMode, 'full');
    const list = b.document.querySelector('.dsh-project-observer-list');
    assert.match(visibleText(list), /Task 0/);
    await b.expandObserver();
    assert.deepEqual([...b.document.querySelector('.dsh-project-observer-list').querySelectorAll('[data-project-request-id]')].map(row => row.dataset.projectRequestId),
      cards.slice(0, 10).map(card => card.id));
    await b.press('taskMore');
    assert.deepEqual([...b.document.querySelector('.dsh-project-observer-list').querySelectorAll('[data-project-request-id]')].map(row => row.dataset.projectRequestId),
      cards.slice(10).map(card => card.id));
    const reads = b.requests.filter(request => request.method === 'requests/list').length;
    await b.press('observerStrip'); assert.equal(isVisible(list), false);
    await b.press('observerExpand');
    assert.equal(b.document.querySelector('.dsh-project-observer-list'), list);
    assert.deepEqual([...list.querySelectorAll('[data-project-request-id]')].map(row => row.dataset.projectRequestId), cards.slice(10).map(card => card.id));
    assert.match(visibleText(list), /Task 10/); assert.doesNotMatch(visibleText(list), /Task 0/);
    assert.equal(b.requests.filter(request => request.method === 'requests/list').length, reads);
  } finally { await b.dispose(); }
});

test('a slower obsolete Request page cannot replace the new revision first page', async () => {
  const cards = Array.from({ length: 14 }, (_, index) => taskCard(`task-${index}`, `Task ${index}`));
  let releaseOld, pageReads = 0;
  const detail = { revision: 'request-page-1' };
  const b = bench({ cards, detail, rpcOverride: (method, input, project) => {
    if (method === 'list') return { ok: true, value: { projects: [project], available: true } };
    if (method !== 'requests/list' || input.kind !== 'current' || input.cursor !== 'task-9') return;
    const page = { items: cards.slice(10).map(item => ({ ...item, title: detail.revision === 'request-page-1' ? `Old ${item.title}` : `New ${item.title}` })), total: 14, nextCursor: null };
    pageReads++;
    return pageReads === 1 ? new Promise(resolve => { releaseOld = () => resolve({ ok: true, value: page }); }) : { ok: true, value: page };
  } });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); await b.expandObserver(); await b.press('taskMore');
    assert.equal(typeof releaseOld, 'function');
    detail.revision = 'request-page-2';
    cards[0].title = 'New Task 0';
    await b.poll(); await b.flush();
    const list = b.document.querySelector('.dsh-project-observer-list');
    assert.match(list.textContent, /New Task 0/); assert.doesNotMatch(list.textContent, /Old Task 10/);
    await act(async () => { releaseOld(); await new Promise(resolve => setImmediate(resolve)); });
    assert.match(list.textContent, /New Task 0/); assert.doesNotMatch(list.textContent, /Old Task 10/);
    assert.equal(pageReads, 1);
  } finally { await b.dispose(); }
});

test('the short Project float keeps collapse and expand inside the viewport', async () => {
  const b = bench({ cards: [taskCard('task-a', 'Implement request')] });
  try {
    Object.defineProperty(b.document.defaultView, 'innerWidth', { configurable: true, value: 296 });
    Object.defineProperty(b.document.defaultView, 'innerHeight', { configurable: true, value: 330 });
    b.document.documentElement.setAttribute('data-windows-titlebar', '');
    b.document.documentElement.style.setProperty('--dshd-wco-caption', '36px');
    await b.flush(); await b.adopt(); await b.mount(); await b.flush(); await b.openObserver();
    const initial = b.observer.getSnapshot().panel.rect;
    assert.ok(initial.x >= 8 && initial.x + initial.width <= 296);
    assert.ok(initial.y >= 56 && initial.y + initial.height <= 330, 'The float clears desktop window controls');
    await b.press('observerStrip'); assert.equal(b.observer.getSnapshot().panel.rect.height, 38);
    await b.press('observerExpand'); assert.equal(b.document.querySelector('[data-project-observer-mode]').dataset.projectObserverMode, 'full');
    await b.expandObserver(); assert.ok(b.observer.getSnapshot().panel.rect.height <= 330 - initial.y - 12);
  } finally { await b.dispose(); }
});

test('Project collapse and expand preserve the user-sized frame through a narrow viewport', async () => {
  const b = bench();
  try {
    const view = b.document.defaultView;
    Object.defineProperty(view, 'innerWidth', { configurable: true, value: 1200 });
    Object.defineProperty(view, 'innerHeight', { configurable: true, value: 800 });
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver();
    const preferred = { x: 100, y: 90, width: 420, height: 350 };
    await act(async () => { b.sidebarRight.resizeFloat(b.observer.getSnapshot().panel.id, preferred); });
    await b.press('observerStrip'); assert.equal(b.observer.getSnapshot().panel.rect.height, 38);
    await b.press('observerExpand'); assert.deepEqual({ ...b.observer.getSnapshot().panel.rect }, preferred);
    Object.defineProperty(view, 'innerWidth', { configurable: true, value: 360 });
    Object.defineProperty(view, 'innerHeight', { configurable: true, value: 320 });
    await act(async () => { view.dispatchEvent(new view.Event('resize')); });
    const narrow = b.observer.getSnapshot().panel.rect;
    assert.ok(narrow.height < preferred.height && narrow.width < preferred.width);
    assert.ok(narrow.x >= 8 && narrow.x + narrow.width <= 360);
    assert.ok(narrow.y >= 20 && narrow.y + narrow.height <= 308);
    await b.press('observerStrip'); await b.press('observerExpand');
    assert.deepEqual({ ...b.observer.getSnapshot().panel.rect }, { ...narrow });
    Object.defineProperty(view, 'innerWidth', { configurable: true, value: 1200 });
    Object.defineProperty(view, 'innerHeight', { configurable: true, value: 800 });
    await act(async () => { view.dispatchEvent(new view.Event('resize')); });
    assert.deepEqual({ ...b.observer.getSnapshot().panel.rect }, preferred);
  } finally { await b.dispose(); }
});

test('user-sized Project observers retain separate frames for identical Session pane ids until close', async () => {
  const b = bench({ rpcOverride: (method, input, project) => method === 'detail' && input.projectId === 'project-two'
    ? { ok: true, value: { project: { ...project, id: 'project-two', title: 'Second Project', coordinatorSessionId: 'coordinator-two' }, workers: [], workstreams: [] } } : undefined });
  const ownerA = b.project.coordinatorSessionId, ownerB = 'coordinator-two';
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver();
    const frameA = { x: 60, y: 70, width: 400, height: 350 }, frameB = { x: 100, y: 50, width: 360, height: 410 };
    await act(async () => { b.sidebarRight.resizeFloat(b.observer.getSnapshot().panel.id, frameA); });
    await b.press('observerStrip');
    await act(async () => { await b.face().readDetail('project-two'); b.face().openObserver('project-two'); });
    await b.mountSession(ownerB);
    const sourceB = b.observerIn(ownerB);
    assert.equal(sourceB.getSnapshot().panel.id, b.observer.getSnapshot().panel.id);
    await act(async () => { b.sidebarRight.resizeFloat(sourceB.getSnapshot().panel.id, frameB); });
    await b.press('observerStrip'); await b.press('observerExpand');
    assert.deepEqual({ ...sourceB.getSnapshot().panel.rect }, frameB);
    await b.mountSession(ownerA); await b.press('observerExpand');
    assert.deepEqual({ ...b.observer.getSnapshot().panel.rect }, frameA);
    await b.press('close'); await b.openObserver();
    assert.equal(b.observer.getSnapshot().panel.rect.height, 520, 'A newly created panel does not inherit the closed panel preferred frame');
    assert.deepEqual({ ...sourceB.getSnapshot().panel.rect }, frameB);
  } finally { await b.dispose(); }
});

test('the Request Team preserves real member stop, process and non-Git diff controls', async () => {
  const task = taskCard('task-running', 'Implement feature');
  task.work = [{ workstreamId: 'work-one', delegationRef: 'actual-assignment', workerSessionId: 'worker-one', title: 'Implement feature',
    memberName: 'Engineer', status: 'running', current: true, updatedAt: 1000, reportId: 'actual-report' }];
  task.workPreview = [{ delegationRef: 'actual-assignment', title: 'Implement feature', status: 'running' }];
  const b = bench({ detail: workDetail(), cards: [task] });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.flush(); await b.openObserver();
    assert.match(b.document.querySelector('.dsh-project-observer-full-body').textContent, /Implement feature|running/);
    await b.expandObserver(); await b.press(task.title); await b.press('taskTeam'); await b.flush();
    const work = b.document.querySelector('[data-workstream-id=work-one]'); assert.ok(work);
    assert.match(work.textContent, /running/);
    await b.press('stopWork');
    assert.deepEqual({ ...b.requests.filter(request => request.method === 'stop').at(-1).input },
      { projectId: 'project-one', workstreamId: 'work-one', requestId: b.requests.filter(request => request.method === 'stop').at(-1).input.requestId });
    await b.disclose('workDetails', work); await b.flush();
    assert.ok(b.button('viewProcess')); await b.press('diff'); await b.flush();
    assert.match(b.document.querySelector('.dsh-project-observer-subview').textContent, /diffScope|notGit/);
    await b.press('taskBack'); assert.ok(b.document.querySelector('[data-workstream-id=work-one]'));
  } finally { await b.dispose(); }
});

test('an accepted objective without a worker shows its goal, revision and pending delivery', async () => {
  const card = taskCard('real-request', 'Explain the saved API decision', 'pendingDelivery');
  card.revision = 2;
  const b = bench({ cards: [card], detail: { workstreams: [], workers: [] } });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); await b.expandObserver(); await b.press(card.title);
    const detail = b.document.querySelector('[data-project-detail-id=real-request]');
    assert.match(detail.textContent, /Explain the saved API decision/);
    assert.match(detail.textContent, /requestVersion 2/);
    assert.match(detail.textContent, /pendingDelivery/);
    await b.press('taskTeam'); assert.match(detail.textContent, /taskNoMembers/);
    assert.equal(b.requests.some(request => request.method === 'workstreams/get'), false);
  } finally { await b.dispose(); }
});

test('supporting member reports page independently beside a committed delivery', async () => {
  const rows = Array.from({ length: 25 }, (_, index) => ({ workstreamId: `work-${index}`, title: `Member result ${index}`, current: true, reportCount: 1,
    report: { delegationRef: `ref-${index}`, outcome: 'completed', summary: `Actual report ${index}`, at: index + 1, artifacts: [] } }));
  const delivery = { id: 'committed-delivery', requestId: 'real-request', title: 'User objective', outcome: 'completed', requestRevision: 1, at: 1, summary: 'Delivered objective', reportRefs: [], artifacts: [], evidence: [], remainingIssues: [], applicable: true };
  const b = bench({ rpcOverride: (method, input) => {
    if (method !== 'store/list') return;
    const start = input.resultsCursor ? rows.findIndex(row => row.report.delegationRef === input.resultsCursor) + 1 : 0, results = rows.slice(start, start + 10);
    return { ok: true, value: { docs: [], deliveries: { items: [delivery], total: 1, nextCursor: null }, results, resultsTotal: rows.length, nextResultsCursor: start + results.length < rows.length ? results.at(-1).report.delegationRef : null } };
  } });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.press('materials'); await b.flush(); await b.disclose('memberReports');
    await b.press('next'); await b.press('next');
    const dialog = b.document.querySelector('.dsh-project-materials');
    assert.equal(dialog.querySelectorAll('[data-result-workstream-id]').length, 5); assert.match(dialog.textContent, /Actual report 24/);
    assert.match(dialog.textContent, /Delivered objective/); assert.equal(b.button('next'), undefined);
    await b.press('previous'); assert.match(dialog.textContent, /Actual report 10/);
    const requests = b.requests.filter(row => row.method === 'store/list');
    assert.deepEqual(requests.map(row => row.input.resultsCursor), [undefined, 'ref-9', 'ref-19', 'ref-9']);
    assert.ok(requests.every(row => row.input.kind !== 'deliveries' && row.input.cursor === undefined));
  } finally { await b.dispose(); }
});

test('an old delivery opens its actual assignment round and returning preserves result and notes position', async () => {
  const detail = workDetail(), work = detail.workstreams[0], ref = { workstreamId: work.id, delegationRef: 'old-assignment', runId: 'old-run' };
  const report = { delegationRef: ref.delegationRef, outcome: 'completed', at: 1, summary: 'Original result', artifacts: [] };
  work.delegations = [{ ref: ref.delegationRef, messageId: 'native-old-assignment', runId: ref.runId, createdAt: 1, phase: 'done' }, { ref: work.currentDelegationRef, messageId: 'native-new-assignment', runId: 'run-one', createdAt: 5, phase: 'running' }];
  const delivery = { id: 'old-delivery', requestId: 'original-request', title: 'Original goal', outcome: 'completed', requestRevision: 1, at: 1, summary: 'Original delivery', reportRefs: [{ workstreamId: ref.workstreamId, delegationRef: ref.delegationRef }], artifacts: [], evidence: [], remainingIssues: [], applicable: true };
  const b = bench({ detail, rpcOverride: (method, input) => {
    if (method === 'store/list') return { ok: true, value: { docs: [], deliveries: { items: [delivery], total: 1, nextCursor: null }, results: [{ workstreamId: work.id, title: work.title, current: true, reportCount: 2, report: work.latestReport }], resultsTotal: 1 } };
    if (method === 'store/results') return { ok: true, value: { items: input.delegationRef ? [report] : [work.latestReport, report], total: 2, nextCursor: null } };
  } });
  const event = (seq, type, data) => ({ type: 'event', event: { seq, time: seq, type, data } });
  const old = [event(1, 'turn/start', { turn: 1 }), event(2, 'user/message', { id: 'actual-user-event', source: { kind: 'team-message', senderId: b.project.coordinatorSessionId, messageId: 'native-old-assignment' }, content: [{ type: 'text', text: 'Original exact assignment' }] }), event(3, 'assistant/message', { turn: 1, message: { content: [{ type: 'text', text: 'Original exact result' }] } }), event(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } })];
  const later = [event(5, 'turn/start', { turn: 2 }), event(6, 'user/message', { id: 'later-user-event', source: { kind: 'team-message', senderId: b.project.coordinatorSessionId, messageId: 'native-new-assignment' }, content: [{ type: 'text', text: 'Later unrelated assignment' }] }), ...Array.from({ length: 70 }, (_, index) => turnRecord(index + 7))];
  let loads = 0; b.eventSource.set({ entries: later, hasMore: true, revision: 1 });
  b.session.loadOlder = async () => { loads++; b.eventSource.set({ entries: [...old, ...later], hasMore: false, revision: 2 }); };
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.press('materials'); await b.flush();
    await b.disclose('reportSource');
    const materials = b.document.querySelector('.dsh-project-materials'), scrollBody = materials.querySelector('.dsh-project-materials-content');
    scrollBody.getClientRects = () => isVisible(scrollBody) ? [{}] : [];
    scrollBody.scrollTop = 520;
    await b.press(work.title); await b.flush();
    assert.equal(b.requests.filter(row => row.method === 'store/results').at(-1).input.delegationRef, ref.delegationRef);
    scrollBody.scrollTop = 310;
    await b.press('viewProcess'); await b.flush();
    assert.equal(isVisible(scrollBody), false);
    scrollBody.scrollTop = 0; // Chromium clamps the hidden container in the installed path.
    const dialog = b.document.querySelector('.dsh-project-observer-subview'), records = [...dialog.querySelectorAll('.dsh-project-body')].find(element => isVisible(element) && element.querySelector('.dsh-project-record-round'));
    assert.equal(loads, 1); assert.match(records.textContent, /Original exact assignment/); assert.match(records.textContent, /Original exact result/); assert.doesNotMatch(records.textContent, /Later unrelated assignment|Worker record 76/);
    assert.equal(b.requests.filter(row => row.method === 'workstreams/get').at(-1).input.workstreamId, ref.workstreamId);
    await b.press('backToResults'); assert.equal(b.document.querySelector('.dsh-project-materials'), materials); assert.equal(scrollBody.scrollTop, 310);
    assert.match(materials.textContent, /Original result/); assert.equal(materials.querySelector('.dsh-project-results-list').hidden, true);
    await b.press('allResults'); assert.equal(scrollBody.scrollTop, 520, 'Return restores the nonzero original delivery-list position'); assert.match(materials.textContent, /Original delivery/);
    await b.press('notes'); await b.changeNotes('Keep the original draft');
    await b.press('team');
    // Leaving Materials for the Project Team protects the same retained draft.
    assert.ok(b.button('keepEditing')); await b.press('keepEditing');
    assert.equal(materials.querySelector('textarea').value, 'Keep the original draft'); assert.equal(b.sent.length, 0); assert.equal(b.navigation.filter(row => row[0] === 'session' && row[1] === work.workerSessionId).length, 0);
  } finally { await b.dispose(); }
});

test('stopped work remains inspectable without a failure or a promised automatic summary', async () => {
  const detail = workDetail();
  Object.assign(detail.activity, { running: 0, state: 'paused' });
  Object.assign(detail.workstreams[0], { status: 'blocked', blockedReason: 'stopped' });
  Object.assign(detail.workers[0], { phase: 'idle', stopped: true, activeRunId: '' });
  const task = taskForWork(detail, 'paused'), b = bench({ detail, cards: [task] });
  try {
    b.project.paused = true;
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); await b.expandObserver(); await b.press(task.title); await b.press('taskTeam'); await b.flush();
    const work = b.document.querySelector('[data-workstream-id=work-one]');
    assert.match(work.textContent, /paused/); assert.doesNotMatch(work.textContent, /pendingSummary|stopped/);
    assert.equal(work.querySelector('.dsh-project-error'), null);
    await b.disclose('workDetails', work); await b.press('viewProcess'); await b.flush(); assert.ok(b.retained.length);
    assert.equal(b.sent.length, 0); assert.equal(b.requests.some(request => ['delegate', 'prompt', 'resume'].includes(request.method)), false);
  } finally { await b.dispose(); }
});

test('an individual worker remains stopping until its actual drain finishes', async () => {
  const detail = workDetail(); Object.assign(detail.workers[0], { phase: 'stopping', stopped: true });
  const task = taskForWork(detail), b = bench({ detail, cards: [task], rpcOverride: (method, _input, project) => method === 'list' ? { ok: true, value: { projects: [project], available: true } } : undefined });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); await b.expandObserver(); await b.press(task.title); await b.press('taskTeam'); await b.flush();
    const heading = b.document.querySelector('[data-workstream-id=work-one] .dsh-project-work-heading');
    assert.match(heading.textContent, /stopping/); assert.doesNotMatch(heading.textContent, /paused|done|failed/);
    Object.assign(detail.workers[0], { phase: 'idle', activeRunId: '' }); detail.workstreams[0].status = 'blocked'; detail.revision = 'revision-2'; task.work[0].status = 'blocked';
    await b.poll(); assert.match(heading.textContent, /paused/); assert.doesNotMatch(heading.textContent, /stopping/);
    assert.equal(b.sent.length, 0); assert.equal(b.requests.some(request => ['delegate', 'resume'].includes(request.method)), false);
  } finally { await b.dispose(); }
});

test('an older pending summary never hides current running, queued or preparing work', async () => {
  const stages = [
    { status: 'done', phase: 'active', activeRunId: 'new-native-run', delegationPhase: 'running', expected: 'running' },
    { status: 'running', phase: 'idle', activeRunId: '', delegationPhase: 'running', expected: 'running' },
    { status: 'open', phase: 'idle', activeRunId: '', delegationPhase: 'queued', expected: 'queued' },
    { status: 'open', phase: 'provisioning', activeRunId: '', delegationPhase: 'preparing', expected: 'provisioning' },
    { status: 'done', phase: 'idle', activeRunId: '', delegationPhase: 'done', expected: 'pendingSummary' },
  ];
  for (const stage of stages) {
    const detail = workDetail(), work = detail.workstreams[0];
    Object.assign(work, { status: stage.status, currentDelegationRef: stage.expected === 'pendingSummary' ? work.latestReport.delegationRef : 'new-requirement', delegation: { phase: stage.delegationPhase } });
    Object.assign(detail.workers[0], { phase: stage.phase, activeRunId: stage.activeRunId, jobs: [] });
    const task = taskForWork(detail, stage.expected), b = bench({ detail, cards: [task] });
    try {
      await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); await b.expandObserver(); await b.press(task.title); await b.press('taskTeam'); await b.flush();
      const state = b.document.querySelector('[data-workstream-id=work-one] .dsh-project-work-heading span');
      assert.equal(state.textContent, stage.expected); assert.equal(work.pendingSummary, true); assert.equal(work.latestReport.delegationRef, 'actual-assignment');
      assert.equal(b.sent.length, 0); assert.equal(b.requests.some(request => ['delegate', 'resume', 'store/write'].includes(request.method)), false);
    } finally { await b.dispose(); }
  }
});

test('background process renders real Session records in pages and never opens a worker chat or input', async () => {
  const detail = workDetail(), task = taskForWork(detail), b = bench({ detail, cards: [task] });
  try {
    const emptyRecords = [turnRecord(83), turnRecord(84)];
    emptyRecords[0].event.data.message.content = []; emptyRecords[1].event.data.message.content = [{ type: 'text', text: ' \n\t ' }];
    b.eventSource.set({ ...b.eventSource.getSnapshot(), entries: [...b.eventSource.getSnapshot().entries, ...emptyRecords], revision: 2 });
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); await b.expandObserver(); await b.press(task.title); await b.press('taskTeam'); await b.flush();
    await b.disclose('workDetails', b.document.querySelector('[data-workstream-id=work-one]'));
    const heading = b.document.querySelector('[data-workstream-id=work-one] .dsh-project-work-heading'); assert.match(heading.textContent, /running/); assert.doesNotMatch(heading.textContent, /pendingSummary/);
    await b.press('viewResult'); await b.flush(); assert.match(b.document.querySelector('.dsh-project-observer-subview').textContent, /An actual integration check remains/); await b.press('taskBack');
    const navigation = b.navigation.length;
    await b.disclose('workDetails', b.document.querySelector('[data-workstream-id=work-one]'));
    await b.press('viewProcess'); await b.flush();
    assert.equal(b.retained[0].address.parentSessionId, 'coordinator-existing'); assert.equal(b.retained[0].address.childSessionId, 'worker-one'); assert.equal(b.retained[0].address.mode, 'continuable');
    assert.equal(b.document.querySelector('.dsh-project-observer-subview').querySelectorAll('textarea,input').length, 0); assert.equal(b.navigation.length, navigation);
    assert.match(b.document.body.textContent, /Worker record 80/); assert.match(b.document.body.textContent, /actual repository content/);
    const dialog = b.document.querySelector('.dsh-project-observer-subview');
    assert.equal(dialog.querySelectorAll('[data-markdown]').length, 46); assert.equal(dialog.querySelectorAll('.dsh-project-record-row').length, 48);
    const assistantRows = [...dialog.querySelectorAll('.dsh-project-record-row')].filter(row => row.querySelector('strong')?.textContent === 'assistant');
    assert.equal(assistantRows.length, 46); assert.ok(assistantRows.every(row => row.querySelector('[data-markdown]')?.textContent.trim()));
    assert.match(dialog.textContent, /Worker record 35/); assert.doesNotMatch(dialog.textContent, /Worker record 34/);
    const toolCall = [...dialog.querySelectorAll('details')].find(row => row.querySelector('summary')?.textContent.startsWith('tool: read_file · '));
    assert.equal(toolCall.querySelector('time').dateTime, new Date(81).toISOString());
    assert.equal(toolCall.querySelector('pre').textContent, '{"path":"src/app.js"}');
    await b.press('previous'); assert.match(b.document.body.textContent, /Worker record 21/); assert.match(dialog.textContent, /Worker record 34/); assert.doesNotMatch(dialog.textContent, /Worker record 35|Worker record 80/);
    await b.press('older'); assert.match(b.document.querySelector('.dsh-project-observer-subview').textContent, /Worker record 1/);
    await b.press('taskBack'); assert.deepEqual(b.released, ['worker-one']); assert.equal(b.navigation.length, navigation);
    assert.deepEqual(b.eventSource.getSnapshot().entries.slice(-2), emptyRecords);
    assert.equal(b.requests.some(request => ['delegate', 'message', 'prompt'].includes(request.method)), false);
  } finally { await b.dispose(); }
});

test('registered artifacts open in the application under their authorized directory and non-Git diff stays explicit', async () => {
  const detail = workDetail(), task = taskForWork(detail), b = bench({ detail, cards: [task] });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); await b.expandObserver(); await b.press(task.title); await b.press('taskTeam'); await b.flush();
    await b.press('viewResult'); await b.flush();
    const result = b.document.querySelector('.dsh-project-observer-subview [data-result-workstream-id=work-one]');
    const originalButton = b.button('openFile: app.js'); originalButton.focus();
    await b.press('openFile: app.js'); const artifact = b.requests.filter(request => request.method === 'open').at(-1); assert.equal(artifact.input.workstreamId, 'work-one'); assert.equal(artifact.input.path, 'src/app.js'); assert.equal(artifact.input.delegationRef, 'actual-assignment');
    assert.equal(b.opened[0].path, 'C:/workspace/real/src/app.js');
    assert.equal(b.opened[0].options.sessionId, 'coordinator-existing'); assert.equal(b.opened[0].options.workingDirectory, 'C:/workspace/real'); assert.equal(b.opened[0].options.presentation, 'mini');
    assert.equal(b.observer.getSnapshot().panel.rect.height, 38); assert.equal(isVisible(result), false);
    await b.expandObserver(); assert.equal(b.document.querySelector('.dsh-project-observer-subview [data-result-workstream-id=work-one]'), result);
    await b.press('taskBack'); await b.disclose('workDetails', b.document.querySelector('[data-workstream-id=work-one]'));
    await b.press('diff'); assert.match(b.document.querySelector('.dsh-project-observer-subview').textContent, /diffScope|notGit/);
  } finally { await b.dispose(); }
});

test('viewing a work result fetches that exact work outside the visible materials page and preserves file authority', async () => {
  const detail = workDetail(), work = detail.workstreams[0];
  Object.assign(work, { id: 'off-page-work', title: 'Inspect a separate module', status: 'done', group: 'history', pendingSummary: false });
  Object.assign(work.latestReport, { remainingIssues: [], artifacts: [{ path: 'C:/owned-branch/src/module.js', location: 'worktree', size: 72 }] });
  detail.workers[0].workstreamId = work.id;
  const originalReport = JSON.stringify(work.latestReport);
  const unrelated = { workstreamId: 'other-work', title: 'Visible page work', current: true, reportCount: 1, report: { delegationRef: 'other-report', outcome: 'completed', at: 2000, summary: 'Unrelated visible report', artifacts: [] } };
  const task = taskForWork(detail), b = bench({ detail, cards: [task], rpcOverride: method => method === 'store/list' ?
    { ok: true, value: { docs: [], results: [unrelated], nextResultsCursor: 'later-page' } } : undefined });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); await b.expandObserver(); await b.press(task.title); await b.press('taskTeam'); await b.flush();
    await b.press('viewResult'); await b.flush();
    const dialog = b.document.querySelector('.dsh-project-observer-subview');
    const visibleResults = () => [...dialog.querySelectorAll('[data-result-workstream-id]')].filter(isVisible);
    assert.deepEqual(visibleResults().map(row => row.dataset.resultWorkstreamId), [work.id]);
    assert.doesNotMatch(visibleResults().map(row => row.textContent).join('\n'), /Unrelated visible report/);
    const targetRequests = b.requests.filter(request => ['workstreams/get', 'store/results'].includes(request.method));
    assert.deepEqual(targetRequests.map(request => request.method).sort(), ['store/results', 'workstreams/get', 'workstreams/get']);
    assert.ok(targetRequests.every(request => request.input.projectId === b.project.id && request.input.workstreamId === work.id));
    await b.press('openFile: module.js');
    const opened = b.requests.filter(request => request.method === 'open').at(-1);
    assert.equal(opened.input.projectId, b.project.id); assert.equal(opened.input.workstreamId, work.id); assert.equal(opened.input.delegationRef, work.latestReport.delegationRef); assert.equal(opened.input.path, work.latestReport.artifacts[0].path);
    await b.expandObserver(); await b.press('taskBack'); await b.press('taskMaterials'); const returnedMaterials = b.document.querySelector('.dsh-project-materials');
    assert.deepEqual([...returnedMaterials.querySelectorAll('[data-result-workstream-id]')].filter(isVisible).map(row => row.dataset.resultWorkstreamId), ['other-work']);
    assert.equal(JSON.stringify(work.latestReport), originalReport); assert.equal(b.sent.length, 0); assert.equal(b.requests.some(request => ['delegate', 'resume', 'store/write'].includes(request.method)), false);
  } finally { await b.dispose(); }
});

test('a failed authorized file read or native preview keeps the original materials visible', async () => {
  for (const boundary of ['authority', 'preview']) {
    const detail = workDetail(), task = taskForWork(detail), b = bench({ detail, cards: [task], rpcOverride: method => boundary === 'authority' && method === 'open' ? { ok: false, error: { message: 'Actual file access failed' } } : undefined,
      previewOverride: boundary === 'preview' ? async () => { throw new Error('Actual native preview failed'); } : undefined });
    try {
      await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); await b.expandObserver(); await b.press(task.title); await b.press('taskTeam'); await b.flush(); await b.press('viewResult'); await b.flush();
      const originalResult = b.document.querySelector('.dsh-project-observer-subview [data-result-workstream-id=work-one]');
      await b.press('openFile: app.js'); assert.ok(isVisible(originalResult)); assert.equal(b.observer.getSnapshot().panel.rect.height > 38, true);
      assert.match(originalResult.querySelector('[role=alert]').textContent, boundary === 'authority' ? /Actual file access failed/ : /Actual native preview failed/); assert.equal(b.opened.length, 0);
      assert.equal(b.requests.filter(request => request.method === 'open').length, 1);
    } finally { await b.dispose(); }
  }
});

test('a late native preview cannot suspend reopened or explicitly returned Project materials', async () => {
  let finishPreview;
  const b = bench({ detail: workDetail(), previewOverride: () => new Promise(resolve => { finishPreview = resolve; }) });
  try {
    await b.flush(); await b.adopt(); await b.mount();
    await act(async () => { b.face().showMaterials('project-one', 'work-one'); }); await b.flush();
    const original = b.document.querySelector('[data-result-workstream-id=work-one]'); await b.press('openFile: app.js'); assert.equal(typeof finishPreview, 'function');
    await b.press('close'); await act(async () => { b.face().showMaterials('project-one', 'work-one'); }); await b.flush();
    const replacement = b.document.querySelector('[data-result-workstream-id=work-one]'); assert.notEqual(replacement, original);
    await act(async () => { finishPreview(); await new Promise(resolve => setImmediate(resolve)); });
    assert.ok(isVisible(replacement)); assert.ok(b.document.querySelector('[role=dialog]')); assert.equal(b.face().hooks.projectView.getSnapshot().materialsPreview, false); assert.equal(b.opened.length, 1);

    // Two authorized opens may settle out of order. Returning from the first
    // completed preview cancels every older outstanding visual transition.
    const content = b.document.querySelector('.dsh-project-materials-content'); content.scrollTop = 123;
    const originalButton = b.button('openFile: app.js'); originalButton.focus();
    let older, current, finishOlder;
    await act(async () => {
      older = b.face().read(b.project.id, 'open', { workstreamId: 'work-one', delegationRef: 'actual-assignment', path: 'src/app.js' });
      await new Promise(resolve => setImmediate(resolve)); finishOlder = finishPreview;
      current = b.face().read(b.project.id, 'open', { path: 'docs/report.md' });
      await new Promise(resolve => setImmediate(resolve));
    });
    await act(async () => { finishPreview(); await current; });
    assert.equal(isVisible(replacement), false); assert.equal(b.document.querySelector('[role=dialog]'), null);
    assert.equal(b.face().hooks.projectView.getSnapshot().materialsPreview, true);
    await act(async () => { b.face().showMaterials('project-one'); });
    assert.equal(b.document.querySelector('[data-result-workstream-id=work-one]'), replacement);
    assert.ok(isVisible(replacement)); assert.equal(content.scrollTop, 123); assert.equal(b.document.activeElement, originalButton);
    await act(async () => { finishOlder(); await older; });
    assert.ok(b.document.querySelector('[role=dialog]')); assert.ok(isVisible(replacement));
    assert.equal(b.document.querySelector('[data-result-workstream-id=work-one]'), replacement);
    assert.equal(content.scrollTop, 123); assert.equal(b.document.activeElement, originalButton);
    assert.equal(b.face().hooks.projectView.getSnapshot().materialsPreview, false); assert.equal(b.opened.length, 3);
  } finally { await b.dispose(); }
});

test('a pending file preview cannot hide a different tab or result in the same materials dialog', async () => {
  for (const destination of ['notes', 'preferences']) {
    let finishPreview;
    const b = bench({ previewOverride: () => new Promise(resolve => { finishPreview = resolve; }) });
    try {
      await b.flush(); await b.adopt(); await b.mount(); await b.press('materials'); await b.flush(); await b.disclose('docs (1)');
      await b.press('openFile: report.md'); assert.equal(typeof finishPreview, 'function');
      await b.press(destination); await b.flush();
      const content = b.document.querySelector('.dsh-project-materials-content'); content.scrollTop = 257;
      await act(async () => { finishPreview(); await new Promise(resolve => setImmediate(resolve)); });
      assert.equal(b.observer.getSnapshot().panel.rect.height > 38, true);
      assert.ok(isVisible(content)); assert.equal(content.scrollTop, 257);
      assert.equal(b.document.querySelector('[role=tab][aria-selected=true]').textContent, destination);
      assert.equal(b.opened.length, 1); assert.equal(b.sent.length, 0);
    } finally { await b.dispose(); }
  }
});

test('file preview preserves a draft in its original Project and a different Project still requires an explicit transition', async () => {
  const b = bench({ rpcOverride: (method, input, project) => method === 'detail' && input.projectId === 'project-two' ? { ok: true, value: { project: { ...project, id: 'project-two', title: 'Another Project', coordinatorSessionId: 'coordinator-two' }, workers: [], workstreams: [] } } : undefined });
  try {
    await b.flush(); await b.adopt(); await b.mount();
    await act(async () => { b.face().showMaterials('project-one'); }); await b.flush(); await b.press('notes'); await b.changeNotes('An unsaved original Project draft');
    const editor = b.document.querySelector('textarea'); editor.focus();
    await act(async () => { await b.face().read('project-one', 'open', { path: 'docs/report.md' }); });
    assert.equal(isVisible(editor), false); assert.equal(b.document.querySelector('[role=dialog]'), null); assert.equal(b.face().hooks.projectView.getSnapshot().materialsPreview, true);
    await act(async () => { await b.face().openProject('project-two'); b.face().showMaterials('project-two'); });
    const confirmation = b.document.querySelector('[role=dialog][aria-label=unsaved]'); assert.match(confirmation.textContent, /Project/);
    assert.equal(b.document.querySelector('textarea'), editor); assert.equal(editor.value, 'An unsaved original Project draft'); assert.equal(b.requests.some(request => request.method === 'store/write'), false);
    await b.press('keepEditing'); assert.ok(isVisible(editor)); await b.press('save'); const write = b.requests.filter(request => request.method === 'store/write').at(-1);
    assert.equal(write.input.projectId, 'project-one'); assert.equal(write.input.path, 'notes.md'); assert.equal(write.input.text, 'An unsaved original Project draft');
  } finally { await b.dispose(); }
});

test('a reused member keeps an earlier requirement failure or report reachable by its exact assignment across detail pages', async () => {
  for (const [hasReport, onPage] of [[false, true], [true, false]]) {
    const detail = workDetail(), currentWork = detail.workstreams[0], worker = detail.workers[0];
    currentWork.title = 'Current requirement B';
    const old = { ref: 'requirement-a-assignment', messageId: 'native-requirement-a', runId: 'native-a-run', createdAt: 1000, requestId: 'request-a', requestRevision: 2 };
    currentWork.delegations = [old, { ref: currentWork.currentDelegationRef, messageId: 'native-requirement-b', runId: 'run-one', createdAt: 2000, requestId: 'request-b', requestRevision: 1 }];
    const oldReport = { delegationRef: old.ref, at: 1100, outcome: 'completed', summary: 'Actual earlier inspection', artifacts: [], request: { id: old.requestId, title: 'Request A', revision: 2 } };
    const previous = taskCard(old.requestId, 'Request A', hasReport ? 'pendingDelivery' : 'blocked'); previous.revision = 2;
    previous.work = [{ workstreamId: currentWork.id, delegationRef: old.ref, workerSessionId: currentWork.workerSessionId,
      title: 'Original inspection', memberName: 'Engineer', status: hasReport ? 'completed' : 'failed', current: false,
      blockedReason: hasReport ? undefined : 'Actual failure from requirement A', ...(hasReport ? { reportId: 'old-report' } : {}), updatedAt: 1100 }];
    const current = taskForWork(detail); current.id = 'request-b';
    const b = bench({ detail: onPage ? detail : { ...detail, workstreams: [], workers: [] }, cards: [previous, current], rpcOverride: (method, input) => method === 'workstreams/get' ? { ok: true, value: { workstream: currentWork, worker } }
      : method === 'store/results' ? { ok: true, value: { items: input.delegationRef === old.ref ? [oldReport] : [currentWork.latestReport], total: 2, nextCursor: null } } : undefined });
    b.project.currentRequests = [
      { id: old.requestId, title: 'Request A', revision: 2, requiredWork: [{ workstreamId: currentWork.id, delegationRef: old.ref, currentDelegationRef: currentWork.currentDelegationRef, runId: old.runId, title: 'Original inspection', phase: hasReport ? 'accepted' : 'failed', hasReport, outcome: hasReport ? 'completed' : undefined, error: hasReport ? '' : 'Actual failure from requirement A', at: 1100 }] },
      { id: 'request-b', title: 'Request B', revision: 1, requiredWork: [{ workstreamId: currentWork.id, delegationRef: currentWork.currentDelegationRef, currentDelegationRef: currentWork.currentDelegationRef, phase: 'accepted', hasReport: true }] },
    ];
    b.eventSource.set({ revision: 2, hasMore: false, entries: [{ type: 'event', event: { type: 'user/message', seq: 90, time: 1000, data: { id: old.messageId, source: { kind: 'team-message' }, content: [{ type: 'text', text: 'Original requirement A assignment' }] } } }, turnRecord(91)] });
    try {
      await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); await b.expandObserver(); await b.press(previous.title); await b.press('taskTeam');
      const task = b.document.querySelector('[data-project-detail-id=request-a]'), member = task.querySelector('.dsh-project-task-member');
      assert.equal(task.querySelectorAll('.dsh-project-task-member').length, 1); assert.equal(task.querySelector('[data-project-detail-id=request-b]'), null);
      assert.match(task.textContent, /Request A.*requestVersion 2/); assert.match(member.textContent, hasReport ? /completed/ : /failed/);
      if (!hasReport) assert.match(member.textContent, /Actual failure from requirement A/);
      if (hasReport) {
        await b.press('viewResult'); const exact = b.requests.filter(request => request.method === 'store/results').at(-1); assert.equal(exact.input.projectId, 'project-one'); assert.equal(exact.input.workstreamId, currentWork.id); assert.equal(exact.input.delegationRef, old.ref);
        const report = b.document.querySelector('.dsh-project-observer-subview');
        assert.match(report.textContent, /Actual earlier inspection/); assert.doesNotMatch(report.textContent, /Actual worker summary/); await b.press('taskBack');
      } else { assert.equal([...member.querySelectorAll('button')].some(button => button.textContent === 'viewResult'), false); }
      await b.press('viewProcess'); await b.flush(); const records = b.document.querySelector('.dsh-project-observer-subview');
      assert.match(records.textContent, /Original requirement A assignment/); assert.doesNotMatch(records.textContent, /runRecordsMissing/);
      assert.equal(b.retained.at(-1).address.childSessionId, 'worker-one'); assert.equal(b.sent.length, 0); assert.equal(b.requests.some(request => ['delegate', 'resume', 'stop'].includes(request.method)), false);
    } finally { await b.dispose(); }
  }
});

test('Project-owned lifecycle commands use the shared rename and active-archive flow and never fall back for a missing Project', async () => {
  const detail = workDetail(), b = bench({ detail });
  try {
    await b.flush(); await b.adopt(); await b.mount();
    const owned = b.sessionActions.get('project'); assert.ok(owned);
    await act(async () => { owned.rename('coordinator-existing'); await new Promise(resolve => setImmediate(resolve)); });
    const editor = b.document.querySelector('input[aria-label=rename]'); assert.equal(editor.value, 'Project');
    await act(async () => { Object.getOwnPropertyDescriptor(b.document.defaultView.HTMLInputElement.prototype, 'value').set.call(editor, 'Renamed Project'); editor.dispatchEvent(new b.document.defaultView.Event('input', { bubbles: true })); editor.dispatchEvent(new b.document.defaultView.Event('change', { bubbles: true })); });
    await b.press('save'); const rename = b.requests.filter(request => request.method === 'rename').at(-1); assert.equal(rename.input.projectId, b.project.id); assert.equal(rename.input.title, 'Renamed Project'); assert.equal(b.project.title, 'Renamed Project');
    const reads = b.requests.filter(request => request.method === 'detail').length;
    await act(async () => { owned.archive('coordinator-existing'); await new Promise(resolve => setImmediate(resolve)); });
    assert.equal(b.requests.filter(request => request.method === 'detail').length, reads + 1); assert.ok(b.document.querySelector('[role=dialog][aria-label=archiveActive]')); assert.equal(b.requests.some(request => request.method === 'archive'), false);
    await b.press('cancel'); assert.equal(b.requests.some(request => request.method === 'archive'), false);
    await act(async () => { owned.archive('coordinator-existing'); await new Promise(resolve => setImmediate(resolve)); }); await b.press('archiveActive'); assert.equal(b.requests.filter(request => request.method === 'archive').length, 1);
    assert.equal(typeof owned.restore, 'function');
    await act(async () => { owned.restore('coordinator-existing'); await new Promise(resolve => setImmediate(resolve)); });
    assert.equal(b.requests.filter(request => request.method === 'restore').at(-1).input.projectId, b.project.id);
    const restores = b.requests.filter(request => request.method === 'restore').length;
    await act(async () => { owned.restore('a-missing-project-lead'); await new Promise(resolve => setImmediate(resolve)); });
    assert.equal(b.requests.filter(request => request.method === 'restore').length, restores);
    await act(async () => { owned.rename('a-missing-project-lead'); await new Promise(resolve => setImmediate(resolve)); });
    assert.ok(b.document.querySelector('[role=dialog][aria-label=unavailable]')); assert.equal(b.requests.filter(request => request.method === 'rename').length, 1); assert.equal(b.navigation.some(entry => entry[0] === 'session' && entry[1] === 'a-missing-project-lead'), false);
    assert.equal(b.requests.some(request => ['delegate', 'resume', 'session/rename', 'session/archive'].includes(request.method)), false);
  } finally { await b.dispose(); }
  assert.equal(b.sessionActions.size, 0);
});

test('notes save and reload, while failed writes keep editing and require an explicit discard', async () => {
  let failWrites = true;
  const b = bench({ rpcOverride: method => method === 'store/write' && failWrites ? { ok: false, error: { code: 'storage/failed', message: 'Disk write failed' } } : undefined });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.press('materials'); await b.flush(); await b.press('notes');
    assert.equal(b.document.querySelector('textarea').value, 'Initial notes');
    const generated = b.document.querySelector('.dsh-project-materials details'); assert.equal(generated.open, false); assert.match(generated.textContent, /Generated current work records/);
    assert.doesNotMatch(b.document.querySelector('textarea').value, /Generated|whale-project/);
    await b.changeNotes('Keep this edit'); await b.press('save');
    assert.equal(b.document.querySelector('textarea').value, 'Keep this edit');
    const failure = b.document.querySelector('[role=alert]'); assert.ok(isVisible(failure)); assert.equal(failure.closest('details'), null); assert.ok(failure.textContent.trim());
    const diagnostic = b.document.querySelector('.dsh-project-error-details'); assert.equal(diagnostic.open, false); assert.equal(diagnostic.querySelector('pre').textContent, 'Disk write failed');
    await b.disclose('errorDetails', diagnostic); assert.equal(diagnostic.open, true); assert.equal(b.document.querySelector('textarea').value, 'Keep this edit'); assert.match(b.stored['notes.md'], /\nInitial notes$/);
    await b.press('close'); assert.ok(b.document.querySelector('[role=dialog][aria-label=unsaved]')); await b.press('keepEditing'); assert.equal(b.document.querySelector('textarea').value, 'Keep this edit');
    failWrites = false; await b.press('save'); assert.match(b.stored['notes.md'], /\nKeep this edit$/); assert.equal(b.stored['notes.md'].match(/Generated current work records/g).length, 1); assert.ok(b.document.querySelector('[role=status]'));
    assert.equal(b.requests.filter(request => request.method === 'store/write').at(-1).input.text, 'Keep this edit');
    await b.press('close'); await b.press('materials'); await b.flush(); await b.press('notes'); assert.equal(b.document.querySelector('textarea').value, 'Keep this edit');
    await b.press('workResults'); const documents = b.document.querySelector('.dsh-project-documents'); assert.equal(documents.open, false); await b.disclose('docs (1)'); await b.press('openFile: report.md'); assert.equal(b.opened.at(-1).path, 'C:/workspace/real/docs/report.md');
    const opened = b.requests.filter(request => request.method === 'open').at(-1); assert.equal(opened.input.path, 'docs/report.md'); assert.equal(opened.input.workstreamId, undefined);
  } finally { await b.dispose(); }
});

test('switching materials with a draft offers keep, discard and save while a failed save preserves the active editor', async () => {
  let failWrites = false;
  const b = bench({ rpcOverride: method => method === 'store/write' && failWrites ? { ok: false, error: { code: 'storage/failed', message: 'Disk write failed' } } : undefined });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.press('materials'); await b.flush(); await b.press('notes');
    const selected = () => b.document.querySelector('[role=tab][aria-selected=true]').textContent;
    await b.changeNotes('Unsaved background'); await b.press('preferences');
    assert.equal(selected(), 'notes'); assert.ok(b.document.querySelector('[role=dialog][aria-label=unsaved]'));
    await b.press('keepEditing'); assert.equal(b.document.querySelector('textarea').value, 'Unsaved background'); assert.equal(b.requests.some(request => request.method === 'store/write'), false);
    await b.press('preferences'); await b.press('discardAndSwitch');
    assert.equal(selected(), 'preferences'); assert.equal(b.document.querySelector('textarea').value, 'Initial preferences'); assert.match(b.stored['notes.md'], /\nInitial notes$/);
    await b.changeNotes('Use the project test command'); await b.press('notes'); failWrites = true; await b.press('saveAndSwitch');
    assert.equal(selected(), 'preferences'); assert.equal(b.document.querySelector('textarea').value, 'Use the project test command'); assert.equal(b.stored['preferences.md'], 'Initial preferences');
    const confirmation = b.document.querySelector('[role=dialog][aria-label=unsaved]');
    const failure = confirmation.querySelector('[role=alert]'); assert.ok(failure); assert.ok(failure.textContent.trim()); assert.equal(failure.closest('details'), null);
    const diagnostic = confirmation.querySelector('details'); assert.equal(diagnostic.open, false); assert.equal(diagnostic.querySelector('pre').textContent, 'Disk write failed');
    await b.disclose('errorDetails', confirmation); assert.equal(diagnostic.open, true); assert.equal(selected(), 'preferences'); assert.equal(b.document.querySelector('textarea').value, 'Use the project test command');
    await b.press('keepEditing'); await b.press('notes');
    const nextConfirmation = b.document.querySelector('[role=dialog][aria-label=unsaved]'); assert.ok(nextConfirmation); assert.equal(nextConfirmation.querySelector('[role=alert]'), null); assert.equal(nextConfirmation.querySelector('details'), null);
    assert.equal(selected(), 'preferences'); assert.equal(b.document.querySelector('textarea').value, 'Use the project test command');
    failWrites = false; await b.press('saveAndSwitch');
    assert.equal(selected(), 'notes'); assert.equal(b.document.querySelector('textarea').value, 'Initial notes'); assert.equal(b.stored['preferences.md'], 'Use the project test command'); assert.equal(b.document.querySelector('[role=dialog][aria-label=unsaved]'), null);
    const write = b.requests.filter(request => request.method === 'store/write').at(-1); assert.equal(write.input.path, 'preferences.md'); assert.equal(write.input.text, 'Use the project test command');
    assert.equal(b.sent.length, 0); assert.equal(b.requests.some(request => ['delegate', 'resume'].includes(request.method)), false);
  } finally { await b.dispose(); }
});

test('oversized UTF-8 drafts are rejected before saving and remain editable through navigation', async () => {
  const b = bench();
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.press('materials'); await b.flush(); await b.press('notes');
    const boundary = '鲸'.repeat(85333) + 'a';
    assert.equal(Buffer.byteLength(boundary, 'utf8'), 256000);
    await b.changeNotes(boundary); assert.equal(b.button('save').disabled, false);
    await b.changeNotes(boundary + 'b'); assert.equal(b.button('save').disabled, true);
    assert.equal(b.document.querySelector('[role=alert]').textContent, 'textTooLong');
    await b.press('preferences'); assert.equal(b.button('saveAndSwitch').disabled, true);
    await b.press('keepEditing'); assert.equal(b.document.querySelector('textarea').value, boundary + 'b');
    await b.press('close'); assert.equal(b.button('saveAndClose').disabled, true);
    await b.press('keepEditing'); assert.equal(b.requests.some(request => request.method === 'store/write'), false);
    await b.changeNotes(boundary); await b.press('save');
    assert.equal(b.requests.filter(request => request.method === 'store/write').at(-1).input.text, boundary);
    assert.equal(b.document.querySelector('[role=alert]'), null);
  } finally { await b.dispose(); }
});

test('saving notes stays saved when the subsequent detail refresh fails', async () => {
  let rejectDetail = false;
  const b = bench({ rpcOverride: method => method === 'detail' && rejectDetail ? Promise.reject(new Error('Detail refresh failed')) : undefined });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.press('materials'); await b.flush(); await b.press('notes');
    await b.changeNotes('Actually saved'); rejectDetail = true; await b.press('save');
    assert.match(b.stored['notes.md'], /Actually saved/); assert.ok(b.document.querySelector('[role=status]'));
    await b.press('close'); assert.equal(b.document.querySelector('[role=dialog]'), null);
  } finally { await b.dispose(); }
});

test('navigating to another Project preserves unsaved materials until explicit close', async () => {
  const b = bench({ rpcOverride: (method, input, project) => method === 'detail' && input.projectId === 'project-two'
    ? { ok: true, value: { project: { ...project, id: 'project-two', coordinatorSessionId: 'coordinator-two' }, workers: [], workstreams: [] } } : undefined });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.press('materials'); await b.flush(); await b.press('notes'); await b.changeNotes('Keep this draft');
    await act(async () => { await b.face().openProject('project-two'); });
    assert.equal(b.document.querySelector('textarea').value, 'Keep this draft');
    await b.press('close'); assert.ok(b.document.querySelector('[role=dialog][aria-label=unsaved]'));
  } finally { await b.dispose(); }
});

test('partial lifecycle command receipts refresh real details and preserve worker results', async () => {
  const detail = workDetail(), task = taskForWork(detail), b = bench({ detail, cards: [task], rpcOverride: (method, _input, project) => {
    if (method === 'list') { project.paused = true; return { ok: true, value: { projects: [project], available: true } }; }
    if (method === 'resume') { project.paused = false; return { ok: true, value: { project, note: 'Ready for a new user message.' } }; }
    if (method === 'archive') { project.lifecycle = 'archived'; return { ok: true, value: { project } }; }
    if (method === 'restore') { project.lifecycle = 'ready'; return { ok: true, value: { project } }; }
  } });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.flush(); await b.openObserver(); await b.expandObserver(); await b.press(task.title); await b.press('taskTeam'); await b.flush();
    for (const action of ['resume', 'archive', 'restore']) {
      const before = b.requests.filter(request => request.method === 'detail').length;
      await act(async () => { await b.face().command('project-one', action); });
      assert.ok(b.requests.filter(request => request.method === 'detail').length > before);
      await b.render();
      if (action === 'archive') { assert.match(b.document.body.textContent, /archivedHint/); assert.ok(b.button('restore')); }
      else { assert.ok(b.document.querySelector('[data-workstream-id=work-one]')); await b.press('viewResult'); await b.flush();
        assert.match(b.document.querySelector('.dsh-project-observer-subview').textContent, /Actual worker summary/);
        await b.press('taskBack'); assert.doesNotMatch(b.document.body.textContent, /archivedHint/); }
    }
  } finally { await b.dispose(); }
});

test('stop controls invoke the same Host stop command and incremental polling preserves unchanged details', async () => {
  const detail = workDetail(), task = taskForWork(detail);
  const b = bench({ detail, cards: [task], rpcOverride: (method, input, project) => method === 'list' ? { ok: true, value: { projects: [project], available: true } }
    : method === 'detail' && input.since ? { ok: true, value: { unchanged: true, revision: input.since } } : undefined });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); await b.expandObserver(); await b.press(task.title); await b.press('taskTeam'); await b.flush();
    await b.press('stopWork'); await b.press('stop');
    const stops = b.requests.filter(request => request.method === 'stop'); assert.equal(stops.length, 2); assert.equal(stops[0].input.workstreamId, 'work-one'); assert.equal(stops[1].input.workstreamId, undefined); assert.ok(stops.every(request => request.input.projectId === 'project-one' && request.input.requestId));
    await b.poll(); await b.disclose('workDetails', b.document.querySelector('[data-workstream-id=work-one]'));
    assert.ok(b.requests.some(request => request.method === 'detail' && request.input.since === 'revision-1'));
    await b.press('viewResult'); await b.flush(); assert.match(b.document.querySelector('.dsh-project-observer-subview').textContent, /Actual worker summary/);
  } finally { await b.dispose(); }
});

test('a later Project navigation supersedes an older detail response', async () => {
  let defer = false, finishOlder;
  const b = bench({ rpcOverride: (method, input, project) => {
    if (method !== 'detail') return;
    if (input.projectId === 'project-two') return { ok: true, value: { project: { ...project, id: 'project-two', coordinatorSessionId: 'coordinator-two' }, workers: [], workstreams: [] } };
    if (defer) return new Promise(resolve => { finishOlder = () => resolve({ ok: true, value: { project, workers: [], workstreams: [] } }); });
  } });
  try {
    await b.flush(); await b.adopt(); defer = true;
    const older = b.face().openProject('project-one'); await b.face().openProject('project-two'); const before = b.navigation.length; finishOlder(); await older;
    assert.equal(b.navigation.length, before); assert.deepEqual(b.navigation.at(-1), ['session', 'coordinator-two']);
  } finally { await b.dispose(); }
});

test('approval takeover keeps the Host stop action available while the coordinator runs or a worker prepares', async () => {
  for (const activity of [{ coordinatorRunning: true, running: 1, state: 'running' }, { provisioning: 1, state: 'provisioning' }]) {
    const b = bench({ approvalActive: true, detail: { activity }, rpcOverride: (method, _input, project) => method === 'list' ? { ok: true, value: { projects: [project], available: true } } : undefined });
    try {
      await b.flush(); await b.mount(); await b.flush();
      assert.equal(b.document.querySelector('[data-testid=project-progress]'), null);
      assert.equal(b.document.querySelectorAll('button[aria-label=stop]').length, 1);
      assert.equal(b.button('stop').textContent, 'stop');
      await b.press('stop');
      const stop = b.requests.find(request => request.method === 'stop');
      assert.equal(stop.input.projectId, 'project-one'); assert.equal(stop.input.workstreamId, undefined); assert.ok(stop.input.requestId);
    } finally { await b.dispose(); }
  }
});

test('archiving confirms whole-project activity even when its active member is outside the displayed page', async () => {
  for (const activity of [{ running: 1, state: 'running' }, { queued: 1, state: 'queued' }, { provisioning: 1, state: 'provisioning' }]) {
    const b = bench({ detail: { activity, workers: [], workstreams: [] }, rpcOverride: (method, _input, project) => method === 'list' ? { ok: true, value: { projects: [project], available: true } } : undefined });
    try {
      await b.flush(); await b.mount(); await b.flush();
      const owned = b.sessionActions.get('project'); assert.equal(typeof owned.archive, 'function');
      await act(async () => { owned.archive(b.project.coordinatorSessionId); await new Promise(resolve => setImmediate(resolve)); });
      assert.ok(b.document.querySelector('[role=dialog][aria-label=archiveActive]'));
      assert.equal(b.requests.some(request => request.method === 'archive'), false);
      await b.press('cancel'); assert.equal(b.requests.some(request => request.method === 'archive'), false);
      await act(async () => { owned.archive(b.project.coordinatorSessionId); await new Promise(resolve => setImmediate(resolve)); });
      await b.press('archiveActive');
      assert.equal(b.requests.filter(request => request.method === 'archive').length, 1);
    } finally { await b.dispose(); }
  }
});

test('queued and preparing work can be withdrawn individually without stopping other Project work', async () => {
  for (const phase of ['queued', 'preparing']) {
    const detail = workDetail();
    Object.assign(detail.workstreams[0], { status: 'open', delegation: { phase } });
    Object.assign(detail.workers[0], { activeRunId: '', phase, jobs: [] });
    const task = taskCard('request-one', 'Implement feature', phase);
    task.work = [{ workstreamId: 'work-one', delegationRef: 'actual-assignment', title: 'Implement feature', memberName: 'Engineer',
      status: phase, workerSessionId: 'worker-one', current: true }];
    const b = bench({ detail, cards: [task] });
    try {
      await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); await b.expandObserver(); await b.press(task.title); await b.press('taskTeam'); await b.flush(); await b.press('stopWork');
      const stops = b.requests.filter(request => request.method === 'stop');
      assert.equal(stops.length, 1); assert.equal(stops[0].input.projectId, 'project-one'); assert.equal(stops[0].input.workstreamId, 'work-one');
    } finally { await b.dispose(); }
  }
});

test('summary failures offer an ordinary scoped user request for saved reports or real terminals without replacing drafts', async () => {
  for (const hasReport of [true, false]) {
    const detail = workDetail(), work = detail.workstreams[0];
    detail.activity = { running: 0, summaryFailed: 1, state: 'summaryFailed' };
    Object.assign(work, { status: hasReport ? 'done' : 'blocked', currentDelegationRef: 'current-ref', summaryFailure: { delegationRef: 'current-ref', runId: 'actual-run', error: { code: 'NETWORK', message: 'Actual provider failed' } } });
    Object.assign(detail.workers[0], { activeRunId: '', phase: 'idle', stopped: !hasReport });
    if (hasReport) Object.assign(work.latestReport, { delegationRef: 'current-ref', at: 1000 });
    else { delete work.latestReport; work.recentSettlements = [{ runId: 'actual-run', delegationRefs: ['current-ref'], at: 2000, summary: 'Actual failed turn' }]; }
    const task = taskCard('request-one', 'Implement feature', 'summaryFailed');
    task.work = [{ workstreamId: work.id, delegationRef: work.currentDelegationRef, title: work.title,
      memberName: 'Engineer', workerSessionId: 'worker-one', status: work.status, current: true, updatedAt: 1000 }];
    const b = bench({ detail, cards: [task] });
    try {
      await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); await b.expandObserver(); await b.press(task.title); await b.press('taskTeam'); await b.flush();
      const draft = b.document.createElement('textarea'); draft.value = 'Keep my unsent requirement'; b.document.body.append(draft);
      assert.match(b.document.querySelector('[data-workstream-id=work-one]').textContent, /Actual provider failed/);
      await b.press('retrySummary');
      assert.equal(b.sent.length, 1); assert.equal(b.sent[0].sessionId, b.project.coordinatorSessionId);
      assert.match(b.sent[0].text, /retrySummaryPrompt\nImplement feature · 1970-01-01T00:00:0[12]\.000Z/);
      assert.doesNotMatch(b.sent[0].text, /current-ref|actual-run/); assert.equal(draft.value, 'Keep my unsent requirement');
      assert.equal(b.requests.some(request => ['delegate', 'prompt', 'resume'].includes(request.method)), false);
    } finally { await b.dispose(); }
  }
});

test('a migrated requirement without original authority preserves the goal and diagnostics without a summary recovery action', async () => {
  const detail = workDetail(), work = detail.workstreams[0];
  const request = { id: 'imported-request', revision: 4, title: 'Retained original goal', goal: 'Original user objective',
    authorityError: 'Actual migration diagnostic: original user message is unavailable', handoverError: 'Older handover failure' };
  Object.assign(detail.activity, { running: 0, blocked: 1, state: 'blocked' });
  Object.assign(work, { status: 'done', pendingSummary: false, request, summaryFailure: { delegationRef: work.currentDelegationRef, error: { code: 'ORIGINAL_PROVIDER_FAILURE', message: 'Saved native failure' } } });
  Object.assign(detail.workers[0], { phase: 'idle', activeRunId: '' });
  const task = { ...taskCard(request.id, request.title, 'blocked'), ...request };
  task.work = [{ workstreamId: work.id, delegationRef: work.currentDelegationRef, title: work.title,
    memberName: 'Engineer', workerSessionId: 'worker-one', status: work.status, current: true }];
  const b = bench({ detail, cards: [task] });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); await b.expandObserver(); await b.press(task.title);
    const recovery = b.document.querySelector('[data-request-recovery-id=imported-request]');
    assert.equal(recovery.querySelector('strong').textContent, 'Retained original goal · requestVersion 4');
    assert.match(recovery.textContent, /authorityErrorHint/); assert.doesNotMatch(b.document.querySelector('.dsh-project-observer-detail').textContent, /handoverErrorHint|summaryCredentialHint|summaryErrorHint/);
    assert.equal(b.button('retrySummary'), undefined); assert.equal(b.button('modelSettings'), undefined);
    const diagnostic = recovery.querySelector('.dsh-project-error-details'); assert.equal(diagnostic.open, false);
    await b.disclose('errorDetails', recovery); assert.equal(diagnostic.querySelector('pre').textContent, request.authorityError);
    await b.press('taskTeam'); await b.flush(); await b.disclose('workDetails', b.document.querySelector('[data-workstream-id=work-one]'));
    assert.match(b.document.querySelector('[data-workstream-id=work-one]').textContent, /ORIGINAL_PROVIDER_FAILURE\nSaved native failure/);
    assert.equal(b.sent.length, 0); assert.equal(b.requests.some(item => ['delegate', 'prompt', 'resume', 'store/write'].includes(item.method)), false);
  } finally { await b.dispose(); }
});

test('authority requirement original goals remain readable in Request detail and bounded Materials pages', async () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({ id: `stored-request-${i}`, title: `Original objective ${i}`, revision: i + 1,
    goal: `Original detailed goal ${i}\n${'Preserve the exact saved requirement. '.repeat(80)}`, authorityError: `Original authorization diagnostic ${i}` }));
  const delivery = { id: 'kept-delivery', requestId: 'delivered-request', title: 'Existing delivered result', status: 'delivered', outcome: 'completed',
    requestRevision: 1, at: 1, summary: 'Existing conclusion remains available', reportRefs: [], applicable: true };
  const requestCard = { ...taskCard(rows[0].id, rows[0].title, 'blocked'), ...rows[0] };
  const b = bench({ cards: [requestCard], detail: { workstreams: [], workers: [] }, rpcOverride: (method, input) => {
    if (method !== 'store/list') return;
    const start = input.kind === 'requests' ? rows.findIndex(row => row.id === input.cursor) + 1 : 0;
    const items = rows.slice(start, start + 10), requests = { items, total: rows.length, nextCursor: start + items.length < rows.length ? items.at(-1).id : null };
    return { ok: true, value: input.kind === 'requests' ? { requests } : { requests, docs: [], results: [], deliveries: { items: [delivery], total: 1, nextCursor: null } } };
  } });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); await b.expandObserver(); await b.press(requestCard.title);
    const requestDetail = b.document.querySelector('[data-project-detail-id=stored-request-0]');
    const progressGoal = requestDetail.querySelector('[data-markdown]'); assert.equal(progressGoal.textContent, rows[0].goal);
    assert.match(requestDetail.textContent, /authorityErrorHint/); assert.equal(b.button('retrySummary'), undefined);
    await b.press('materials'); await b.flush();
    const dialog = b.document.querySelector('.dsh-project-materials'), visibleIds = () => [...dialog.querySelectorAll('[data-request-recovery-id]')].map(card => card.dataset.requestRecoveryId);
    assert.deepEqual(visibleIds(), rows.slice(0, 10).map(row => row.id));
    const card = dialog.querySelector('[data-request-recovery-id]'), goal = card.querySelector('[data-markdown]');
    assert.equal(card.querySelector('strong').textContent, `${rows[0].title} · requestVersion ${rows[0].revision}`);
    assert.equal(isVisible(goal), false); await b.disclose('workRequest', card); assert.equal(goal.textContent, rows[0].goal); assert.equal(isVisible(goal), true);
    assert.doesNotMatch(card.textContent, /stored-request-0/); assert.equal(b.button('retrySummary'), undefined);
    const diagnostic = card.querySelector('.dsh-project-error-details'); assert.equal(diagnostic.open, false);
    await b.disclose('errorDetails', card); assert.equal(diagnostic.querySelector('pre').textContent, rows[0].authorityError);
    await b.press('earlierRequests'); assert.deepEqual(visibleIds(), rows.slice(10, 20).map(row => row.id));
    await b.press('earlierRequests'); assert.deepEqual(visibleIds(), rows.slice(20).map(row => row.id)); assert.equal(b.button('earlierRequests'), undefined);
    await b.press('previous'); assert.deepEqual(visibleIds(), rows.slice(10, 20).map(row => row.id));
    assert.deepEqual(b.requests.filter(item => item.method === 'store/list' && item.input.kind === 'requests').map(item => item.input.cursor), ['stored-request-9', 'stored-request-19', 'stored-request-9']);
    assert.match(dialog.querySelector('[data-delivery-id=kept-delivery]').textContent, /Existing conclusion remains available/);
    assert.equal(b.sent.length, 0); assert.equal(b.requests.some(item => ['delegate', 'prompt', 'resume', 'store/write'].includes(item.method)), false);
  } finally { await b.dispose(); }
});

test('imported historical deliveries keep their original result references without claiming current completion', async () => {
  for (const [status, outcome] of [['historical', 'completed'], ['obsolete', 'failed']]) {
    const detail = workDetail(), work = detail.workstreams[0], originalRef = 'original-assignment';
    const report = { ...work.latestReport, delegationRef: originalRef, summary: 'Original saved member conclusion' };
    const delivery = { id: 'imported-delivery', requestId: 'original-request', requestRevision: 3, title: 'Original objective', status, outcome,
      summary: 'Original saved coordinator conclusion', evidence: ['Original verification'], remainingIssues: [],
      reportRefs: [{ workstreamId: work.id, delegationRef: originalRef }], at: 900, applicable: false, error: 'Actual preserved handover diagnostic' };
    const b = bench({ detail, rpcOverride: (method, input) => {
      if (method === 'store/list') return { ok: true, value: { docs: [], results: [{ workstreamId: work.id, title: work.title, report: work.latestReport, reportCount: 2, current: true }],
        deliveries: { items: [delivery], total: 1, nextCursor: null } } };
      if (method === 'store/results' && input.delegationRef === originalRef) return { ok: true, value: { items: [report], total: 1 } };
    } });
    try {
      await b.flush(); await b.adopt(); await b.mount(); await b.press('materials'); await b.flush();
      const card = b.document.querySelector('[data-delivery-id=imported-delivery]');
      assert.match(card.querySelector('.dsh-project-result-heading').textContent, /historicalDelivery/);
      assert.doesNotMatch(card.querySelector('.dsh-project-result-heading').textContent, /\bdelivered\b|\bpartialDelivery\b/);
      assert.match(card.textContent, /Original saved coordinator conclusion/); assert.match(card.textContent, /Original verification/);
      assert.match(card.textContent, /historicalDeliveryHint/); assert.doesNotMatch(card.textContent, /deliveryChangedHint/);
      const diagnostic = card.querySelector('.dsh-project-error-details'); assert.equal(diagnostic.open, false);
      await b.disclose('errorDetails', card); assert.equal(diagnostic.querySelector('pre').textContent, delivery.error);
      await b.disclose('deliveryDetails', card);
      const fullDetails = [...card.querySelectorAll('details')].find(item => item.querySelector('summary')?.textContent === 'deliveryDetails');
      assert.equal(fullDetails.open, true); assert.match(fullDetails.textContent, new RegExp(`result · ${outcome}`));
      await b.disclose('reportSource', card); await b.press(work.title); await b.flush();
      const exact = b.requests.filter(item => item.method === 'store/results' && item.input.delegationRef).at(-1);
      assert.equal(exact.input.workstreamId, work.id); assert.equal(exact.input.delegationRef, originalRef);
      const selected = [...b.document.querySelectorAll('[data-result-workstream-id]')].find(isVisible);
      assert.match(selected.textContent, /Original saved member conclusion/); assert.doesNotMatch(selected.textContent, /Actual worker summary/);
      assert.equal(b.sent.length, 0); assert.equal(b.requests.some(item => ['delegate', 'prompt', 'resume', 'store/write'].includes(item.method)), false);
    } finally { await b.dispose(); }
  }
});

test('a failed Request handover without member rows offers a fresh scoped summary and preserves the composer draft', async () => {
  const task = taskCard('request-one', 'Repair the import', 'summaryFailed');
  Object.assign(task, { revision: 2, goal: 'Fix and verify the import', handoverError: 'Actual checkpoint write failed' });
  const b = bench({ cards: [task], detail: { workstreams: [], workers: [] }, rpcOverride: (method, input, project) => {
    if (method === 'detail') project.currentRequests = [{ ...task, revision: stale ? 3 : 2,
      ...(authorityMissing ? { authorityError: 'Actual missing authorization' } : {}) }];
  } });
  let stale = false, authorityMissing = false;
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); await b.expandObserver(); await b.press(task.title);
    const draft = b.document.createElement('textarea'); draft.value = 'Unsent follow-up'; b.document.body.append(draft);
    assert.match(b.document.querySelector('[data-project-detail-id=request-one]').textContent, /Repair the import|requestVersion 2/);
    await b.press('retrySummary'); assert.equal(b.sent.length, 1);
    assert.match(b.sent[0].text, /retrySummaryPrompt\nRepair the import · requestVersion 2\nFix and verify the import/);
    assert.equal(draft.value, 'Unsent follow-up');
    stale = true; await b.press('retrySummary'); assert.equal(b.sent.length, 1);
    assert.match(b.document.querySelector('.dsh-project-observer').textContent, /resultUpdated/);
    stale = false; authorityMissing = true; await b.press('retrySummary'); assert.equal(b.sent.length, 1);
    assert.match(b.document.querySelector('.dsh-project-observer').textContent, /authorityErrorHint/);
    assert.equal(b.requests.some(request => ['delegate', 'resume', 'store/write'].includes(request.method)), false);
  } finally { await b.dispose(); }
});

test('a changed result cannot be submitted as the failed result by the summary action', async () => {
  const detail = workDetail(); Object.assign(detail.workstreams[0], { currentDelegationRef: 'old-ref', summaryFailure: { delegationRef: 'old-ref', error: { message: 'Failed' } } });
  detail.workers[0].phase = 'idle'; detail.workers[0].activeRunId = '';
  const task = taskCard('request-one', 'Implement feature', 'summaryFailed');
  task.work = [{ workstreamId: 'work-one', delegationRef: 'old-ref', title: 'Implement feature', memberName: 'Engineer', status: 'done', current: true }];
  let reads = 0;
  const b = bench({ detail, cards: [task], rpcOverride: method => method === 'workstreams/get' && ++reads > 1 ?
    { ok: true, value: { workstream: { title: 'New result', latestReport: { delegationRef: 'new-ref', at: 2 }, summaryFailure: { delegationRef: 'old-ref' } } } } : undefined });
  try { await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); await b.expandObserver(); await b.press(task.title); await b.press('taskTeam'); await b.flush();
    await b.press('retrySummary'); assert.equal(b.sent.length, 0); assert.match(b.document.body.textContent, /resultUpdated/); }
  finally { await b.dispose(); }
});

test('a missing credential has an actionable settings entry and preserves the complete diagnostic on demand', async () => {
  const detail = workDetail(), work = detail.workstreams[0];
  Object.assign(detail.activity, { running: 0, summaryFailed: 1, state: 'summaryFailed' });
  Object.assign(work, { status: 'done', currentDelegationRef: 'current', summaryFailure: { delegationRef: 'current', error: { code: 'MISSING_CREDENTIAL', message: 'Exact native provider diagnostic' } } });
  Object.assign(work.latestReport, { delegationRef: 'current' }); Object.assign(detail.workers[0], { activeRunId: '', phase: 'idle' });
  const task = taskCard('request-one', 'Implement feature', 'summaryFailed');
  task.work = [{ workstreamId: work.id, delegationRef: work.currentDelegationRef, title: work.title,
    memberName: 'Engineer', workerSessionId: 'worker-one', status: work.status, current: true, updatedAt: 1000 }];
  const b = bench({ detail, cards: [task] });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); await b.expandObserver(); await b.press(task.title); await b.press('taskTeam'); await b.flush();
    const workRow = b.document.querySelector('[data-workstream-id=work-one]');
    assert.match(workRow.textContent, /summaryCredentialHint/);
    const diagnostics = [...workRow.querySelectorAll('details')].find(e => e.querySelector('summary')?.textContent === 'errorDetails');
    assert.equal(diagnostics.open, false); assert.equal(diagnostics.querySelector('pre').textContent, 'MISSING_CREDENTIAL\nExact native provider diagnostic');
    await b.press('modelSettings'); assert.deepEqual(b.navigation.at(-1), ['settings', 'models']);
    assert.equal(b.sent.length, 0); assert.equal(b.requests.some(r => ['delegate', 'resume', 'store/write'].includes(r.method)), false);
    await b.disclose('errorDetails'); assert.equal(diagnostics.open, true);
  } finally { await b.dispose(); }
});

test('a partial delivery without a report opens its exact terminal records and returns to the same Project results', async () => {
  const detail = workDetail(), work = detail.workstreams[0];
  const receipt = { ref: 'failed-assignment', messageId: 'native-request', runId: 'native-failed-run', createdAt: 1000, requestId: 'requirement-one', requestRevision: 2 };
  Object.assign(work, { status: 'blocked', currentDelegationRef: receipt.ref, pendingSummary: false, delegations: [receipt] }); delete work.latestReport;
  Object.assign(detail.workers[0], { phase: 'idle', activeRunId: '', stopped: true });
  const delivery = { id: 'delivery-partial', requestId: receipt.requestId, requestRevision: 2, title: 'Check repository behavior', summary: 'The external check is blocked.', outcome: 'partial',
    evidence: ['The worker inspected the original repository.'], remainingIssues: ['The provider must be configured.'], reportRefs: [], terminalRefs: [{ workstreamId: work.id, delegationRef: receipt.ref, runId: receipt.runId }], artifacts: [], at: 1100, applicable: true };
  const b = bench({ detail, rpcOverride: method => method === 'store/list' ? { ok: true, value: { docs: [], results: [], deliveries: { items: [delivery], total: 1, nextCursor: null } } } : undefined });
  try {
    b.eventSource.set({ revision: 2, hasMore: false, entries: [
      { type: 'event', event: { type: 'turn/start', seq: 100, time: 1000, data: { turn: 7 } } },
      { type: 'event', event: { type: 'user/message', seq: 101, time: 1001, data: { id: receipt.messageId, source: { kind: 'team-message' }, content: [{ type: 'text', text: 'The original assigned inspection' }] } } },
      { type: 'event', event: { type: 'assistant/message', seq: 102, time: 1002, data: { turn: 7, step: 1, message: { content: [{ type: 'text', text: 'Actual inspection before the failure' }] } } } },
      { type: 'event', event: { type: 'turn/end', seq: 103, time: 1100, data: { turn: 7, reason: { kind: 'error', error: { message: 'Actual terminal provider failure' } } } } },
    ] });
    await b.flush(); await b.adopt(); await b.mount(); await b.press('materials'); await b.flush();
    const dialog = b.document.querySelector('.dsh-project-observer'), card = dialog.querySelector('[data-delivery-id=delivery-partial]');
    assert.equal(dialog.getAttribute('data-project-observer-mode'), 'full');
    assert.ok(isVisible(card.querySelector('.dsh-project-result-conclusion'))); assert.match(card.textContent, /The provider must be configured/);
    assert.equal(b.button('viewProcess'), undefined); const fullDetails = card.querySelector('details'); assert.equal(fullDetails.open, false);
    await b.disclose('deliveryDetails', card); const recordButton = b.button('viewProcess'); recordButton.focus();
    recordButton.getClientRects = () => isVisible(recordButton) ? [{}] : [];
    const materials = dialog.querySelector('.dsh-project-materials'), content = materials.querySelector('.dsh-project-materials-content'); content.scrollTop = 176;
    content.getClientRects = () => isVisible(content) ? [{}] : [];
    await b.press('viewProcess'); await b.flush();
    content.scrollTop = 0;
    assert.ok(dialog.querySelector('.dsh-project-observer-subview')); assert.equal(isVisible(materials), false);
    assert.equal(b.document.activeElement, b.button('backToResults'));
    assert.match(dialog.textContent, /Actual inspection before the failure/); assert.match(dialog.textContent, /Actual terminal provider failure/); assert.doesNotMatch(dialog.textContent, /runRecordsMissing/);
    assert.deepEqual(b.retained.map(item => ({ ...item.address })), [{ parentSessionId: 'coordinator-existing', childSessionId: 'worker-one', mode: 'continuable' }]);
    assert.equal(b.requests.filter(request => request.method === 'workstreams/get').at(-1).input.workstreamId, work.id); assert.equal(b.requests.some(request => request.method === 'store/results'), false);
    await b.press('backToResults'); assert.equal(dialog.getAttribute('data-project-observer-mode'), 'full'); assert.equal(isVisible(materials), true);
    assert.equal(dialog.querySelector('[data-delivery-id=delivery-partial]'), card); assert.equal(fullDetails.open, true); assert.equal(content.scrollTop, 176);
    assert.equal(b.document.activeElement, recordButton);
    assert.deepEqual(b.released, ['worker-one']); assert.equal(b.sent.length, 0); assert.equal(b.requests.some(request => ['delegate', 'resume', 'store/write'].includes(request.method)), false);
  } finally { await b.dispose(); }
});

test('result conclusions preserve saved operators and literal Markdown inside code', async () => {
  const summary = 'Verified `return value * 2;`, `left ** right` and `[a](b)` without changing their literals.';
  const report = { delegationRef: 'actual-report', outcome: 'completed', at: 1, summary, artifacts: [] };
  const delivery = { id: 'delivery-operators', requestId: 'request-operators', requestRevision: 1, title: 'Verify operators', summary,
    outcome: 'completed', evidence: [], remainingIssues: [], reportRefs: [], artifacts: [], at: 1, applicable: true };
  const b = bench({ rpcOverride: method => method === 'store/list' ? { ok: true, value: {
    docs: [], results: [{ workstreamId: 'work-operators', title: 'Verify operators', current: true, reportCount: 1, report }],
    deliveries: { items: [delivery], total: 1, nextCursor: null },
  } } : undefined });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.press('materials'); await b.flush();
    const conclusions = [...b.document.querySelectorAll('.dsh-project-result-conclusion')];
    assert.equal(conclusions.length, 2);
    for (const conclusion of conclusions) {
      assert.match(conclusion.textContent, /return value \* 2;/);
      assert.match(conclusion.textContent, /left \*\* right/);
      assert.match(conclusion.textContent, /\[a\]\(b\)/);
    }
  } finally { await b.dispose(); }
});

test('same-named results retain distinct source locations and open the exact recorded artifact', async () => {
  const files = [{ path: 'C:\\project\\src\\app.js', location: 'existing', size: 1024 }, { path: 'C:\\owned-branch\\src\\app.js', location: 'worktree', size: 4096 }];
  const reports = files.map((file, i) => ({ delegationRef: `actual-report-${i}`, outcome: 'completed', at: i + 1, summary: 'Actual result', artifacts: [file] }));
  const b = bench({ rpcOverride: method => method === 'store/list' ? { ok: true, value: { docs: [], results: reports.map((report, i) => ({ workstreamId: `work-${i}`, title: `Work ${i}`, current: true, reportCount: 1, report })) } } : undefined });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.press('materials'); await b.flush();
    const rows = [...b.document.querySelectorAll('.dsh-project-artifact')]; assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(e => e.querySelector('button').textContent), ['app.js', 'app.js']);
    assert.match(rows[0].textContent, /artifactExisting/); assert.match(rows[1].textContent, /artifactWorktree/);
    for (const [i, row] of rows.entries()) {
      assert.equal(row.querySelector('.dsh-project-path'), null); assert.equal(row.querySelector('button').title, files[i].path);
      const reportDetails = row.closest('article').querySelector('.dsh-project-result-disclosure'); assert.equal(reportDetails.open, false);
      await act(async () => { row.querySelector('button').focus(); row.querySelector('button').click(); await new Promise(resolve => setImmediate(resolve)); });
      const opened = b.requests.filter(r => r.method === 'open').at(-1);
      assert.equal(opened.input.path, files[i].path); assert.equal(opened.input.delegationRef, reports[i].delegationRef); assert.equal(opened.input.workstreamId, `work-${i}`);
      assert.equal(b.observer.getSnapshot().panel.rect.height, 38);
      await b.expandObserver(); assert.equal(b.document.querySelectorAll('.dsh-project-artifact')[i], row);
      await act(async () => { row.querySelector('[aria-label="fileMore: app.js"]').click(); });
      await act(async () => { row.querySelector('[role=menuitem]').click(); });
      assert.equal(row.querySelector('.dsh-project-path').textContent, files[i].path); assert.equal(b.requests.filter(r => r.method === 'open').length, i + 1);
    }
  } finally { await b.dispose(); }
});

test('same-named Projects register their exact directories and retain their own coordinator destination', async () => {
  let other;
  const b = bench({ rpcOverride: (method, input, project) => {
    if (method === 'list') { other = { ...project, id: 'other-project', coordinatorSessionId: 'other-lead', canonicalWorkingDirectory: 'C:/another/real' }; return { ok: true, value: { available: true, projects: [project, other] } }; }
    if (method === 'detail' && input.projectId === other.id) return { ok: true, value: { project: other, workstreams: [], workers: [], revision: 'other-revision' } };
  } });
  try {
    await b.flush(); await b.mount();
    const rows = Array.from(b.sessionNavigation.get('project').getSnapshot(), row => ({ ...row })); assert.equal(rows.length, 2);
    assert.deepEqual(rows, [{ sessionId: 'coordinator-existing', workingDirectory: 'C:/workspace/real', archived: false }, { sessionId: 'other-lead', workingDirectory: 'C:/another/real', archived: false }]);
    assert.equal(b.document.querySelectorAll('button.dsh-project-row').length, 0, 'Project uses the native directory groups instead of a duplicate Project category');
    await act(async () => { await b.face().openProject(other.id); });
    assert.deepEqual(b.navigation.at(-1), ['session', 'other-lead']);
    assert.equal(b.requests.some(r => ['create', 'delegate', 'resume'].includes(r.method)), false);
  } finally { await b.dispose(); }
});

test('queued work explains the actual gate and an open report refreshes changed prerequisites without rerunning it', async () => {
  for (const [kind, label] of [['dependencies', 'waitingDependencies'], ['directory', 'waitingDirectory'], ['capacity', 'waitingCapacity']]) {
    const detail = workDetail(), work = detail.workstreams[0]; Object.assign(work, { delegation: { phase: 'queued', waitingReason: { kind, workTitles: kind === 'capacity' ? [] : ['API contract'] } } });
    const task = taskForWork(detail), b = bench({ detail, cards: [task], rpcOverride: (method, _input, project) => method === 'list' ? { ok: true, value: { projects: [project], available: true } } : undefined });
    try {
      await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); await b.expandObserver(); await b.press(task.title); await b.press('taskTeam'); assert.match(b.document.body.textContent, new RegExp(label));
      if (kind !== 'capacity') assert.match(b.document.body.textContent, /API contract/);
      await b.disclose('workDetails'); const previousReads = b.requests.filter(request => request.method === 'workstreams/get').length;
      work.prerequisitesChanged = true; work.latestReport.prerequisitesChanged = true;
      await b.poll(); await b.flush(); assert.match(b.document.body.textContent, /prerequisitesChanged/);
      assert.equal(b.requests.filter(request => request.method === 'workstreams/get').length, previousReads + 1, 'dependency warning refreshes expanded details even when downstream updatedAt stays unchanged');
      assert.equal(b.requests.some(request => request.method === 'delegate'), false);
    } finally { await b.dispose(); }
  }
});

test('archive keeps its read-only composer throughout the request and archived materials cannot be edited', async () => {
  let finishArchive;
  const b = bench({ rpcOverride: (method, _input, project) => method === 'archive' ? new Promise(resolve => { finishArchive = () => { project.lifecycle = 'archived'; resolve({ ok: true, value: { project } }); }; })
    : method === 'restore' ? (project.lifecycle = 'ready', { ok: true, value: { project } }) : undefined });
  try {
    await b.flush(); await b.adopt(); await b.mount();
    let command; await act(async () => { command = b.face().command('project-one', 'archive'); await new Promise(resolve => setImmediate(resolve)); }); await b.render();
    assert.match(b.document.body.textContent, /archiving/); assert.equal(b.button('restore'), undefined);
    await act(async () => { finishArchive(); await command; }); await b.render();
    assert.match(b.document.body.textContent, /archivedHint/); assert.ok(b.button('restore'));
    await b.press('materials'); await b.flush(); await b.press('notes'); assert.equal(b.document.querySelector('textarea').readOnly, true); assert.equal(b.button('save'), undefined);
    await b.press('close'); await b.press('restore'); await b.render(); assert.doesNotMatch(b.document.body.textContent, /archivedHint/);
    assert.equal(b.requests.some(request => ['delegate', 'prompt', 'message'].includes(request.method)), false);
  } finally { await b.dispose(); }
});

test('results keep earlier reports reachable and opening changed artifacts explains the current preview', async () => {
  const old = { delegationRef: 'old-assignment', outcome: 'completed', at: 1, summary: 'Earlier completed result', artifacts: [{ path: 'src/old.js' }] };
  const current = { delegationRef: 'current-assignment', outcome: 'blocked', at: 2, summary: 'Current result needs an external check', artifacts: [] };
  const b = bench({ rpcOverride: (method, _input, _project) => method === 'store/list' ? { ok: true, value: { docs: [], results: [{ workstreamId: 'work-one', title: 'Continuing work', current: true, reportCount: 2, report: current }] } }
    : method === 'store/results' ? { ok: true, value: { items: [current, old], total: 2, hasMore: false, nextCursor: null } }
      : method === 'open' ? { ok: true, value: { canonicalPath: 'C:/workspace/real/src/old.js', root: 'C:/workspace/real', modifiedSinceReport: true } } : undefined });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.press('materials'); await b.flush(); assert.match(b.document.querySelector('.dsh-project-materials').textContent, /Current result needs an external check/);
    const history = [...b.document.querySelectorAll('details')].find(element => element.querySelector('summary')?.textContent.startsWith('resultHistory'));
    assert.equal(history.querySelector('summary').textContent, 'resultHistory (1)');
    await act(async () => { history.open = true; history.dispatchEvent(new b.document.defaultView.Event('toggle')); await new Promise(resolve => setImmediate(resolve)); }); await b.flush();
    assert.equal(b.requests.filter(request => request.method === 'store/results').length, 1);
    assert.match(history.textContent, /Earlier completed result/); await b.press('openFile: old.js');
    const opened = b.requests.filter(request => request.method === 'open').at(-1); assert.equal(opened.input.delegationRef, 'old-assignment'); assert.equal(opened.input.workstreamId, 'work-one'); assert.equal(opened.input.path, 'src/old.js');
    assert.equal(b.observer.getSnapshot().panel.rect.height, 38);
    await b.expandObserver(); assert.match(b.document.querySelector('.dsh-project-materials').textContent, /modifiedArtifact/);
  } finally { await b.dispose(); }
});
