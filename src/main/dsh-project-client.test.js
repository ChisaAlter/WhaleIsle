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
function bench({ available = true, rejectCreation = false, detail = {}, cards = [], queue, team = null, runtimeSessions = {}, sessionStatuses = {}, factoryRenderer, rpcOverride, previewOverride, approvalActive = false, language } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main></main></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const savedGlobals = Object.fromEntries(['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const { createRoot } = clientRequire('react-dom/client');
  let registration, directoryAction, timer, root, adopted = false;
  const cleanups = [], entries = [], requests = [], navigation = [], retained = [], released = [], opened = [], sent = [], resizeObservers = [], factoryCalls = [], events = new Map(), sessionActions = new Map(), sessionNavigation = new Map(), locales = new Map();
  const project = { id: 'project-one', title: 'Project', coordinatorSessionId: 'coordinator-existing', workspaceId: 'workspace-existing',
    storageRoot: 'C:/profile/projects/project-one', canonicalWorkingDirectory: 'C:/workspace/real', lifecycle: 'ready', paused: false, diagnostics: [], ...(queue ? { queue } : {}), activity: detail?.activity ?? { running: 0, blocked: 0, queued: 0, state: 'idle' } };
  project.queue ??= { active: cards.find(card => card.status !== 'completed' && card.queue?.state !== 'cancelled' && card.queue?.state !== 'queued' && card.queue?.state !== 'discussing') ?? null, queued: cards.filter(card => card.queue?.state === 'queued'), paused: false };
  const sessionStatus = projection(new Map(Object.entries(sessionStatuses)));
  project.currentRequests = cards.filter(card => card.status !== 'completed');
  if (project.currentRequests.length && !detail?.activity) project.activity = { running: 1, blocked: 0, queued: 0, state: 'running' };
  const notesMarker = '<!-- whale-project:user-notes -->', generatedNotes = '# Generated current work records';
  const stored = { 'notes.md': `${generatedNotes}\n${notesMarker}\nInitial notes`, 'preferences.md': 'Initial preferences', 'charter.md': '', 'docs/report.md': 'Saved report' };
  const eventSource = projection({ entries: [...Array.from({ length: 60 }, (_, index) => turnRecord(index + 21)), ...toolRecords], hasMore: true, revision: 1 });
  const session = projection({ openState: 'open', openError: null });
  session.loadOlder = async () => { const previous = eventSource.getSnapshot(); eventSource.set({ entries: [...Array.from({ length: 20 }, (_, index) => turnRecord(index + 1)), ...previous.entries], hasMore: false, revision: 2 }); };
  const binding = { eventSource, session };
  dom.window.__ModuleLoader__ = { load: value => { registration = value; } };
  const sandbox = { window: dom.window,
    globalThis: { crypto: { randomUUID } }, TextEncoder, document: dom.window.document,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), matchMedia: query => ({ media: query, matches: query === '(prefers-reduced-motion: reduce)' }), ResizeObserver: class {
      constructor(callback) { this.callback = callback; this.disconnected = false; this.elements = []; resizeObservers.push(this); }
      observe(element) { this.elements.push(element); }
      disconnect() { this.disconnected = true; }
    },
    requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout, setTimeout, clearTimeout,
    setInterval: callback => { timer = callback; return 1; }, clearInterval() {} };
  vm.runInNewContext(fs.readFileSync(clientPath, 'utf8'), sandbox, { filename: clientPath });
  const Button = React.forwardRef(function Button({ variant, children, ...props }, ref) { return h('button', { type: 'button', ref, ...props }, children); });
  const Modal = ({ open, title, closeLabel, onClose, children, footer }) => !open ? null : h('section', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('button', { type: 'button', 'aria-label': closeLabel, onClick: onClose }, closeLabel), children, footer);
  const TaskDock = ({ title, summary, children, testId }) => { const [expanded, setExpanded] = React.useState(false); return h('section', { 'data-testid': testId }, h('button', { 'aria-expanded': expanded, onClick: () => setExpanded(!expanded) }, title), h('span', null, summary), expanded ? children : null); };
  const Menu = ({ open, anchor, items, onSelect }) => h(React.Fragment, null, anchor, open ? h('div', { role: 'menu' }, items.map(item => h('button', { key: item.id, role: 'menuitem', disabled: item.disabled, onClick: () => onSelect(item.id) }, item.label))) : null);
  const SegmentedTabs = ({ items, value, onChange, label }) => h('div', { role: 'tablist', 'aria-label': label }, items.map(item => h('button', {
    key: item.value, id: item.id, role: 'tab', 'aria-selected': item.value === value, 'aria-controls': item.panelId, onClick: () => onChange(item.value),
  }, item.label)));
  const primitives = { Button, Modal, TaskDock, Menu, SegmentedTabs, Toast: ({ text }) => clientRequire('react-dom').createPortal(h('div', { role: 'alert' }, text), dom.window.document.body), Input: props => h('input', props), IconCheckOutlineRegular: () => null, IconChevronUpOutlineRegular: () => null, IconChevronDownOutlineRegular: () => null, IconChevronRightOutlineRegular: () => null, IconPlusOutlineRegular: () => null, IconEllipsisOutlineRegular: () => null, Pill: ({ children, onClick, active, ...rest }) => onClick ? h('button', { ...rest, type: 'button', 'aria-pressed': active, onClick }, children) : h('span', null, children), Tag: ({ children }) => h('span', null, children), MarkdownText: ({ text }) => h('div', { 'data-markdown': true }, text), IconFolderCloseRegular: () => h('span', { 'aria-hidden': true }) , IconUsersOutlineRegular: () => null, IconChecklistOutlineRegular: () => null, useAnchoredPosition: () => ({ left: 0, top: 0 }) };
  const mounted = projection(project.coordinatorSessionId);
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
    workspaces: { list: projection({ scratchCwd: 'C:/scratch' }), create: async input => { requests.push({ method: 'workspace/create', input }); return { path: project.canonicalWorkingDirectory, workspaceId: project.workspaceId }; }, openPath: async (path, options) => { if (previewOverride) await previewOverride(path, options); opened.push({ path, options }); } },
    uiWorkspace: { registerDirectoryAction: action => { directoryAction = action; return () => { directoryAction = undefined; }; }, registerSessionActions: (owner, actions) => { assert.equal(sessionActions.has(owner), false); sessionActions.set(owner, actions); return () => sessionActions.delete(owner); }, registerSessionNavigation: (owner, source) => { assert.equal(sessionNavigation.has(owner), false); sessionNavigation.set(owner, source); return () => sessionNavigation.delete(owner); }, openSession: id => navigation.push(['session', id]) },
    uiSidebar: { selectTab: id => navigation.push(['tab', id]) },
    uiSession: { sessionStatus },
    settingsNavigation: { open: id => navigation.push(['settings', id]) },
    sessions: { scope: sessionId => ({ get: name => { assert.equal(name, 'conversation'); return { send: async text => sent.push({ sessionId, text }) }; } }), list: projection({ byId: { [project.coordinatorSessionId]: { id: project.coordinatorSessionId, retainedBy: { mainView: 1 } }, ...Object.fromEntries(Object.entries(runtimeSessions).map(([id, session]) => [id, { retainedBy: { mainView: id === project.coordinatorSessionId ? 1 : 0 }, ...session }])) },
      projectionsBySession: { [project.coordinatorSessionId]: { values: { agentTeam: team } } } }), retain: (address, options) => { retained.push({ address, options }); return { ready: Promise.resolve(binding), release: () => released.push(address.childSessionId) }; } },
    connection: { rpc: { call: async (prefix, method, input) => {
      assert.equal(prefix, '/dsh-project'); requests.push({ method, input });
      // The real RPC boundary returns independent JSON snapshots, never mutable fixture objects.
      return structuredClone(await (async () => {
      const override = rpcOverride?.(method, input, project, stored);
      if (override !== undefined) return await override;
      if (method === 'list') return { ok: true, value: { projects: adopted ? [project] : [], available } };
      if (method === 'create') { if (!rejectCreation) adopted = true; return rejectCreation ? { ok: false, error: { code: 'project/rejected', message: 'Creation failed' } } : { ok: true, value: { project, reused: true } }; }
      if (method === 'detail') return { ok: true, value: { project, workstreams: [], workers: [], revision: 'revision-1', ...detail, ...(detail?.workstreams ? { workstreams: detail.workstreams.map(({ latestReport, ...work }) => ({ ...work, hasReport: Boolean(latestReport) })) } : {}) } };
      if (method === 'requests/list') {
        const rows = cards.filter(card => input.kind === 'archived' ? card.archivedAt !== undefined : input.kind === 'completed' ? card.status === 'completed' && card.archivedAt === undefined : input.kind === 'cancelled' ? card.queue?.state === 'cancelled' : card.status !== 'completed' && card.queue?.state !== 'cancelled');
        const start = input.cursor ? rows.findIndex(card => card.id === input.cursor) + 1 : 0;
        assert.ok(start >= 0); const items = rows.slice(start, start + 10);
        return { ok: true, value: { items, total: rows.length, nextCursor: start + items.length < rows.length ? items.at(-1).id : null } };
      }
      if (method === 'requests/get') {
        const card = cards.find(item => item.id === input.requestId); assert.ok(card, 'Selected task belongs to the current Project');
        return { ok: true, value: { card } };
      }
      if (method === 'requests/queue') return { ok: true, value: { card: cards.find(item => item.id === input.requestId) } };
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
      })());
    } } },
  };
  plugin.apply(ctx);
  const overlay = () => entries.find(entry => entry.options.name === 'shell.overlay');
  const face = () => overlay().options.inject();
  const selectHook = source => selector => selector(useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot));
  function Slot({ entry, sessionId }) {
    const injected = entry.options.inject(), store = entry.options.store?.create();
    const matched = entry.options.select?.({ sessionId });
    if (entry.options.select && matched === null) return null;
    return h(entry.component, { ...injected, useProjects: selectHook(injected.hooks.projects), useProjectSessions: selectHook(injected.hooks.projectSessions),
      useProjectSessionStatus: selectHook(injected.hooks.projectSessionStatus), useWorkspaceList: selectHook(injected.hooks.workspaceList),
      openWithDraft: sessionId => navigation.push(['draft', sessionId]), useRequestModes: selectHook(injected.hooks.requestModes), useDismissals: selectHook(injected.hooks.dismissals), useProjectView: selectHook(injected.hooks.projectView),
      renderFactorySlot: (name, props, options) => { factoryCalls.push({ name, props, options }); return factoryRenderer ? factoryRenderer(name, props, options) : options?.fallback ?? null; },
      ...(store ? { useStore: selectHook(store), actions: store.actions } : {}),
      matched, sessionId, wide: true, t: ctx.locale.bind(entry.options.locale ?? 'dsh-project') });
  }
  function Slots() {
    const sessionId = useSyncExternalStore(mounted.subscribe, mounted.getSnapshot, mounted.getSnapshot);
    return h(React.Fragment, null, entries.filter(entry => entry.active && entry.options.name !== 'sidebar.nav.tab'
      && (approvalActive ? !['conversation.input.right', 'conversation.input.dock'].includes(entry.options.name) : entry.options.name !== 'conversation.approval.actions'))
      .map(entry => h(Slot, { key: `${entry.options.name}:${entry.options.id ?? entry.options.key}`, entry, sessionId })));
  }
  const render = () => root.render(h(Slots));
  const flush = async () => { await act(async () => { await new Promise(resolve => setImmediate(resolve)); }); };
  const findButton = label => [...dom.window.document.querySelectorAll('button')].find(element => isVisible(element) && (element.textContent === label || element.getAttribute('aria-label') === label));
  const panel = id => dom.window.document.querySelector(`[data-project-panel="${id}"]:not([hidden])`);
  const openPanel = async id => {
    if (panel(id)) return;
    const target = dom.window.document.querySelector(`[data-project-header-panel="${id}"] > button`);
    assert.ok(target && isVisible(target), 'The Project conversation-header entry must be reachable');
    await act(async () => { target.focus(); target.click(); await new Promise(resolve => setImmediate(resolve)); });
    assert.ok(panel(id), `The ${id} header panel opens`);
  };
  const openObserver = () => openPanel('requests');
  let focusedRequestId;
  const requestElement = id => panel('requests')?.querySelector('[data-project-request-id="' + id + '"]') ?? null;
  const click = async target => { assert.ok(target && isVisible(target), 'The selected public control is visible'); await act(async () => { target.focus(); target.click(); await new Promise(resolve => setImmediate(resolve)); }); };
  const openRequest = async (id, full = true) => {
    await openObserver();
    const card = requestElement(id); assert.ok(card && isVisible(card), 'The selected Request is visible in this Project');
    focusedRequestId = id;
    if (card.dataset.projectRequestMode === 'strip') await click(card.querySelector('.dsh-project-task-strip-open'));
    if (full && card.dataset.projectRequestMode === 'card') {
      const detail = [...card.querySelectorAll('button')].find(button => isVisible(button) && button.textContent === ctx.locale.bind('dsh-project')('taskDetail'));
      await click(detail);
    }
    assert.equal(card.dataset.projectRequestMode, full ? 'full' : 'card');
    return card;
  };
  const expandObserver = async () => {
    await openObserver();
    if (focusedRequestId && requestElement(focusedRequestId)?.dataset.projectRequestMode === 'strip') await openRequest(focusedRequestId);
  };
  const openTaskList = openObserver;
  const dialog = () => [...dom.window.document.querySelectorAll('section[role=dialog]')].find(isVisible) ?? null;
  const escape = async () => { await act(async () => { dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(resolve => setImmediate(resolve)); }); };
  const press = async label => {
    if (label === 'materials') {
      await openObserver();
      await press('taskMaterials'); return;
    }
    const target = findButton(label); assert.ok(target, `Missing button ${label}`);
    await act(async () => { target.focus(); target.click(); await new Promise(resolve => setImmediate(resolve)); });
  };
  return { entries, requests, navigation, retained, released, opened, sent, resizeObservers, factoryCalls, sessionNavigation, eventSource, session, stored, project, face, sessionActions, mounted, cards, panel, openPanel, dialog, escape, document: dom.window.document,
    get action() { return directoryAction; }, flush,
    mount: async () => { root = createRoot(dom.window.document.querySelector('main')); await act(async () => { render(); }); },
    render: async () => { await act(async () => { render(); }); },
    mountSession: async sessionId => { await act(async () => { mounted.set(sessionId); }); },
    press, openObserver, expandObserver, openTaskList, openRequest, requestElement, sessionStatus,
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

// Plugin snapshots come from the client realm; compare them as plain data.
const navigationEntries = b => JSON.parse(JSON.stringify(b.sessionNavigation.get('project')?.getSnapshot() ?? null));

test('the actual directory action is gated by availability, makes nothing before confirmation and resumes the unique coordinator', async () => {
  const unavailable = bench({ available: false });
  try { await unavailable.flush(); assert.equal(unavailable.action, undefined); assert.deepEqual(unavailable.requests.map(request => request.method), ['list']);
    await unavailable.mount(); assert.equal(unavailable.document.querySelector('.dsh-project-row-badge'), null); }
  finally { await unavailable.dispose(); }
  const b = bench();
  try {
    await b.flush(); assert.ok(b.action); assert.deepEqual(b.requests.map(request => request.method), ['list']); assert.deepEqual(b.navigation, []);
    assert.equal(b.entries.some(entry => entry.options.name === 'sidebar.nav.tab'), false);
    assert.equal(b.entries.some(entry => entry.options.name === 'sidebar.workspaces.sections'), false, 'Project has no separate sidebar category');
    assert.equal(b.entries.filter(entry => entry.options.name === 'sidebar.session.row.badge').length, 1);
    await b.mount(); assert.equal(b.document.querySelector('.dsh-project-row-badge'), null);
    assert.deepEqual(navigationEntries(b), []);
    // Cancelling a chooser never calls adopt; no draft/session transition occurs.
    await b.flush(); assert.deepEqual(b.navigation, []); assert.equal(b.requests.some(request => request.method === 'workspace/create'), false);
    await b.adopt();
    const rootStores = new Set(b.entries.filter(entry => entry.options.name === 'shell.overlay').map(entry => entry.options.store).filter(Boolean));
    assert.ok(rootStores.size > 0);
    assert.deepEqual(b.entries.filter(entry => entry.options.name.startsWith('conversation.') && rootStores.has(entry.options.store)).map(entry => entry.options.name), [], 'native slots require one scope per store handle; root viewing stores cannot mount under a session');
    assert.deepEqual(b.requests.filter(request => ['workspace/create', 'create'].includes(request.method)).map(request => request.method), ['create']);
    const creation = b.requests.find(request => request.method === 'create'); assert.equal(creation.input.workingDirectory, 'C:/workspace/alias'); assert.ok(creation.input.requestId);
    assert.deepEqual(b.navigation, [['tab', 'sessions'], ['session', 'coordinator-existing']]);
    assert.equal(b.document.querySelector('[data-testid=project-progress]'), null);
    assert.ok(b.document.querySelector('.dsh-project-header button')); assert.equal(b.panel('requests'), null);
    assert.equal(b.requests.some(request => ['delegate', 'prompt', 'message', 'store/write'].includes(request.method)), false);
    await b.adopt(); assert.deepEqual(b.navigation.at(-1), ['session', 'coordinator-existing']);
    assert.deepEqual(navigationEntries(b), [{ sessionId: 'coordinator-existing', workingDirectory: 'C:/workspace/real', archived: false }],
      'The Lead lists once among the ordinary conversations of its directory');
    await b.mountSession('coordinator-existing'); assert.equal(b.document.querySelector('.dsh-project-row-badge')?.textContent, 'tab');
    await b.mountSession('ordinary-session'); assert.equal(b.document.querySelector('.dsh-project-row-badge'), null, 'Only Project Leads carry the Project tag');
    assert.equal(b.entries.some(entry => ['sidebar.nav.tab', 'sidebar.page'].includes(entry.options.name)), false);
    assert.equal(b.requests.some(request => request.method === 'session/create'), false);
  } finally { await b.dispose(); }
});

test('a listed directory row offers New Project, then Open Project for the same directory', async () => {
  const b = bench();
  try {
    await b.flush();
    assert.equal(b.action.rowLabel('C:/workspace/real'), 'rowCreate');
    await b.action.adopt('C:/workspace/real'); await b.flush();
    assert.deepEqual(b.navigation.at(-1), ['session', 'coordinator-existing']);
    assert.equal(b.action.rowLabel('C:/workspace/real'), 'rowOpen');
    assert.equal(b.action.rowLabel('C:\\workspace\\real\\'), 'rowOpen', 'Separators and a trailing slash do not hide the existing Project');
    assert.equal(b.action.rowLabel('C:/workspace/other'), 'rowCreate');
  } finally { await b.dispose(); }
});

test('the New Session option starts the directory Project and carries the draft into its Lead', async () => {
  const blank = 'blank-session', scratch = 'scratch-session';
  const b = bench({ runtimeSessions: { [blank]: { id: blank, blank: true, cwd: 'C:/workspace/real' }, [scratch]: { id: scratch, blank: true, cwd: 'C:/scratch' } } });
  try {
    await b.flush(); await b.mount();
    await b.mountSession(scratch); assert.equal(b.document.querySelector('.dsh-project-hero-option'), null, 'A no-directory Session cannot become a Project');
    await b.mountSession(blank);
    const option = b.document.querySelector('.dsh-project-hero-option');
    assert.ok(option && isVisible(option)); assert.equal(option.textContent, 'tab'); assert.equal(option.title, 'heroHint');
    await act(async () => { option.click(); await new Promise(resolve => setImmediate(resolve)); }); await b.flush();
    const creation = b.requests.find(request => request.method === 'create'); assert.equal(creation.input.workingDirectory, 'C:/workspace/real');
    assert.deepEqual(b.navigation.slice(-2), [['tab', 'sessions'], ['draft', 'coordinator-existing']], 'The Lead opens through the draft-carrying navigation');
    assert.equal(b.navigation.some(([kind]) => kind === 'session'), false);
    assert.equal(b.requests.some(request => ['delegate', 'prompt', 'message'].includes(request.method)), false, 'Starting sends nothing on the user\'s behalf');
    assert.equal(b.document.querySelector('.dsh-project-hero-option').title, 'heroOpenHint');
  } finally { await b.dispose(); }
});

test('a failed New Session Project start stays on the blank Session with a visible reason', async () => {
  const blank = 'blank-session';
  const b = bench({ rejectCreation: true, runtimeSessions: { [blank]: { id: blank, blank: true, cwd: 'C:/workspace/real' } } });
  try {
    await b.flush(); await b.mount(); await b.mountSession(blank);
    await act(async () => { b.document.querySelector('.dsh-project-hero-option').click(); await new Promise(resolve => setImmediate(resolve)); }); await b.flush();
    assert.match(b.document.body.textContent, /Creation failed/);
    assert.deepEqual(b.navigation, []);
    assert.equal(b.document.querySelector('.dsh-project-hero-option').disabled, false);
  } finally { await b.dispose(); }
});

test('a rejected creation preserves the previous conversation and publishes no phantom Project', async () => {
  const b = bench({ rejectCreation: true });
  try { await b.flush(); await assert.rejects(b.action.adopt('C:/workspace/alias'), /Creation failed/); assert.deepEqual(b.navigation, []);
    assert.equal(b.entries.some(entry => entry.options.name === 'sidebar.nav.tab'), false); assert.equal(b.requests.some(request => request.method === 'detail'), false);
    await b.mount(); assert.equal(b.document.querySelector('.dsh-project-row-badge'), null);
    assert.deepEqual(navigationEntries(b), []); }
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
    assert.equal(b.panel('requests'), null);
    await b.press('real');
    assert.notEqual(b.document.querySelector('[role=alert]'), first, 'A repeated failure announces again');
    assert.equal(b.requests.filter(request => request.method === 'open').length, 2);
    await b.openObserver();
    assert.ok(b.panel('requests'));
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

test('the Lead Project opens one requirement panel from the header and each Request changes its own shape', async () => {
  const active = taskCard('active-a', 'Current development'), completed = taskCard('complete-b', 'Earlier result', 'completed');
  const b = bench({ cards: [active, completed] });
  try {
    await b.flush(); await b.adopt(); await b.mount();
    assert.equal(b.panel('requests'), null);
    await b.openObserver();
    const root = b.panel('requests');
    assert.ok(root); assert.equal(b.entries.some(entry => entry.options.name.startsWith('sidebar.right.')), false, 'Project owns no floating right-side pane');
    assert.equal(b.requestElement(active.id).dataset.projectRequestMode, 'card');
    assert.equal(b.requestElement(completed.id).dataset.projectRequestMode, 'strip');
    await b.openRequest(completed.id);
    assert.equal(b.requestElement(completed.id).dataset.projectRequestMode, 'full');
    assert.equal(b.requestElement(active.id).dataset.projectRequestMode, 'card');
    await b.press(completed.title + ' · observerStrip');
    assert.equal(b.requestElement(completed.id).dataset.projectRequestMode, 'strip');
    await b.openObserver();
    assert.equal(b.panel('requests'), root);
    assert.deepEqual(b.sent, []);
  } finally { await b.dispose(); }
});

test('header panels count requirements, keep portaled menus inside and close on Escape or an outside pointer', async () => {
  const active = taskCard('active-request', 'Current objective'), queued = taskCard('queued-request', 'Next objective');
  queued.queue = { state: 'queued', position: 1 };
  const b = bench({ cards: [active, queued], language: 'en' });
  try {
    await b.flush(); await b.adopt(); await b.mount();
    const trigger = b.document.querySelector('[data-project-header-panel=requests] > button');
    assert.equal(trigger.querySelector('.dsh-project-header-badge').textContent, '2');
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    await b.openObserver(); assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    const pointer = target => act(async () => { target.dispatchEvent(new b.document.defaultView.Event('pointerdown', { bubbles: true })); await new Promise(resolve => setImmediate(resolve)); });
    const menu = b.document.createElement('div'); menu.setAttribute('role', 'menu'); b.document.body.append(menu);
    await pointer(menu); assert.ok(b.panel('requests'), 'A portaled menu list belongs to the panel'); menu.remove();
    b.panel('requests').focus(); await b.escape();
    assert.equal(b.panel('requests'), null); assert.equal(b.document.activeElement, trigger);
    await b.openObserver(); await pointer(b.document.querySelector('main'));
    assert.equal(b.panel('requests'), null);
    await b.openPanel('team'); await b.openObserver();
    assert.ok(b.panel('team') && b.panel('requests'), 'Each header trigger owns its own panel');
  } finally { await b.dispose(); }
});

test('an empty Project opens through its original header and stays closed after navigation', async () => {
  const b = bench({ language: 'zh' });
  try {
    await b.flush(); await b.adopt(); await b.mount(); assert.equal(b.panel('requests'), null);
    await b.openObserver(); const root = b.panel('requests');
    const empty = root.querySelector('.dsh-project-requests-empty'); assert.ok(isVisible(empty));
    assert.equal(empty.querySelector('strong').textContent, '还没有任务');
    assert.match(empty.querySelector('p').textContent, /直接在主对话里说你要完成什么/);
    assert.ok(b.button('需求')); assert.ok(b.document.querySelector('[data-project-header-panel=team] > button')); assert.ok(b.button('成果与资料'));
    await b.escape(); assert.equal(b.panel('requests'), null); await b.poll(); await b.mountSession(null); await b.mountSession(b.project.coordinatorSessionId);
    assert.equal(b.panel('requests'), null);
    assert.equal(b.requests.some(request => ['delegate', 'prompt', 'message', 'store/write'].includes(request.method)), false); assert.deepEqual(b.sent, []);
  } finally { await b.dispose(); }
});

test('completed requirements remain bottom strips without changing the active requirement or Project activity', async () => {
  const active = taskCard('active-current', 'Current objective', 'pendingDelivery'), previous = taskCard('previous-delivered', 'Earlier objective', 'completed');
  const detail = { activity: { state: 'running', coordinatorRunning: true, running: 1 } };
  const b = bench({ cards: [previous, active], detail });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver();
    const current = b.requestElement(active.id), historical = b.requestElement(previous.id);
    assert.equal(current.dataset.projectRequestMode, 'card'); assert.equal(historical.dataset.projectRequestMode, 'strip');
    assert.ok(historical.closest('.dsh-project-requests-list')); assert.ok(current.closest('.dsh-project-requests-current'));
    assert.equal(historical.querySelector('.dsh-project-task-strip-open').getAttribute('aria-label'), previous.title + ' · completed');
    await b.openRequest(previous.id); await b.press('taskResults');
    assert.match(visibleText(historical), /Earlier objective was delivered/);
    assert.equal(current.dataset.projectRequestMode, 'card'); assert.equal(b.project.activity.state, 'running');
    assert.doesNotMatch(visibleText(current), /Earlier objective was delivered/);
    assert.equal(b.requests.some(request => ['stop', 'delegate', 'store/write'].includes(request.method)), false);
  } finally { await b.dispose(); }
});

test('each queued and completed requirement keeps its own strip, card, full and tab state', async () => {
  const active = taskCard('active-current', 'Current objective'), queued = taskCard('queued-next', 'Next objective'), done = taskCard('completed-old', 'Delivered objective', 'completed');
  queued.queue = { state: 'queued', position: 1 };
  const b = bench({ cards: [active, queued, done] });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver();
    assert.deepEqual([active, queued, done].map(card => b.requestElement(card.id).dataset.projectRequestMode), ['card', 'strip', 'strip']);
    await b.openRequest(queued.id); await b.press('taskActivity');
    await b.openRequest(done.id); const historical = b.requestElement(done.id);
    await act(async () => { [...historical.querySelectorAll('button')].find(button => button.textContent === 'taskResults').click(); });
    assert.equal(b.requestElement(queued.id).querySelector('[role=tabpanel]').id, queued.id + '-panel-activity');
    assert.equal(historical.querySelector('[role=tabpanel]').id, done.id + '-panel-results');
    await b.press(done.title + ' · observerStrip');
    assert.equal(b.requestElement(active.id).dataset.projectRequestMode, 'card'); assert.equal(b.requestElement(queued.id).dataset.projectRequestMode, 'full');
    const saved = b.face().hooks.requestModes.getSnapshot()[b.project.coordinatorSessionId].requests;
    assert.equal(saved[queued.id].mode, 'full'); assert.equal(saved[done.id].mode, 'strip');
  } finally { await b.dispose(); }
});

test('whole-requirement delivery folds the completed requirement while the next active requirement remains visible', async () => {
  const first = taskCard('first-request', 'First objective'), next = taskCard('next-request', 'Next objective');
  next.queue = { state: 'queued', position: 1 };
  const detail = { revision: 'before-delivery' }, b = bench({ cards: [first, next], detail });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openRequest(first.id);
    assert.equal(b.requestElement(first.id).dataset.projectRequestMode, 'full');
    Object.assign(first, taskCard(first.id, first.title, 'completed')); delete next.queue;
    b.project.queue = { active: next, queued: [], paused: false }; detail.revision = 'after-delivery';
    await b.poll(); await b.flush();
    assert.equal(b.requestElement(first.id).dataset.projectRequestMode, 'strip');
    assert.ok(b.requestElement(first.id).closest('.dsh-project-requests-list'));
    assert.equal(b.requestElement(next.id).dataset.projectRequestMode, 'card');
    assert.equal(b.requests.some(request => ['stop', 'delegate', 'requests/archive'].includes(request.method)), false);
  } finally { await b.dispose(); }
});

test('native live Session status overrides stale summary state and resolves a reassigned work owner by task identity', async () => {
  const current = taskCard('native-status-request', 'Repair current module');
  current.work = [{ workstreamId: 'native-task', delegationRef: 'round-a', workerSessionId: 'previous-worker', title: 'Saved task name', status: 'running', current: true }];
  const team = { members: [{ id: 'current-worker', name: 'Current engineer', role: 'member' }], tasks: [{ id: 'native-task', subject: 'Actual assigned task', ownerName: 'Current engineer', status: 'in_progress' }] };
  const b = bench({ cards: [current], team, runtimeSessions: { 'current-worker': { id: 'current-worker', running: true } }, sessionStatuses: { 'current-worker': { running: false } } });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver();
    const card = b.requestElement(current.id); assert.match(visibleText(card), /Actual assigned task.*Current engineer.*teamAssigned/s);
    assert.doesNotMatch(visibleText(card), /Saved task name|previous-worker/);
    await act(async () => { b.sessionStatus.set(new Map([['current-worker', { running: true }]])); });
    assert.match(visibleText(card), /Actual assigned task.*Current engineer.*running/s);
    assert.equal(card.querySelector('[role=progressbar]').getAttribute('aria-valuenow'), '0');
  } finally { await b.dispose(); }
});

test('a saved per-requirement strip reopens without expanding another requirement', async () => {
  const current = taskCard('saved-request', 'Saved objective'), b = bench({ cards: [current] });
  try {
    await b.flush(); await b.adopt();
    b.face().hooks.requestModes.set({ [b.project.coordinatorSessionId]: { requests: { [current.id]: { mode: 'strip', completed: false } } } });
    await b.mount(); await b.openObserver(); const root = b.panel('requests');
    assert.equal(b.requestElement(current.id).dataset.projectRequestMode, 'strip');
    await b.openRequest(current.id); assert.equal(b.requestElement(current.id).dataset.projectRequestMode, 'full');
    assert.equal(b.panel('requests'), root);
  } finally { await b.dispose(); }
});

test('a narrow window keeps the exact requirement controls reachable in the header panel', async () => {
  const current = taskCard('narrow-request', 'Long readable requirement'), b = bench({ cards: [current], language: 'zh' });
  try {
    Object.defineProperty(b.document.defaultView, 'innerWidth', { configurable: true, value: 236 });
    Object.defineProperty(b.document.defaultView, 'innerHeight', { configurable: true, value: 420 });
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver();
    await b.press(current.title + ' · 收起'); assert.equal(b.requestElement(current.id).dataset.projectRequestMode, 'strip');
    await b.openRequest(current.id); assert.equal(b.requestElement(current.id).dataset.projectRequestMode, 'full');
    assert.ok(isVisible(b.button('收起详情'))); assert.ok(isVisible(b.button('成果与资料')));
  } finally { await b.dispose(); }
});

test('task cards open the exact Request and show its team, result and activity under one Project', async () => {
  const task = taskCard('task-a', 'Repair search', 'completed');
  task.work = [{ workstreamId: 'work-one', delegationRef: 'actual-assignment', title: 'Implement feature', memberName: 'Engineer',
    workerSessionId: 'worker-one', status: 'completed', hasReport: true, updatedAt: 150, assignmentAt: 120, reportAt: 180, terminalAt: 190 }];
  const b = bench({ detail: workDetail(), cards: [task] });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.flush(); await b.openObserver(); await b.expandObserver();
    await b.openRequest(task.id);
    assert.equal(b.requests.filter(request => request.method === 'requests/get').at(-1).input.requestId, task.id);
    assert.equal(b.document.querySelector('[data-project-detail-id]').dataset.projectDetailId, task.id);
    await b.press('taskOverview');
    assert.match(b.document.querySelector('.dsh-project-task-tab-body').textContent, /actual requirement/);
    await b.press('taskTeam'); assert.match(b.document.querySelector('.dsh-project-task-tab-body').textContent, /Engineer/);
    await b.press('taskResults'); assert.match(b.document.querySelector('.dsh-project-task-tab-body').textContent, /was delivered/);
    await b.press('taskActivity'); assert.match(b.document.querySelector('.dsh-project-task-tab-body').textContent, /requestVersion/);
    assert.equal(b.navigation.some(entry => entry[0] === 'session' && entry[1] === 'worker-one'), false);
  } finally { await b.dispose(); }
});

test('requirement versions expand to their full original goal, constraints and completion conditions', async () => {
  for (const language of ['en', 'zh']) {
    const task = taskCard('versioned-request', 'Repair login');
    const oldGoal = 'Original goal '.repeat(30) + 'Preserve the complete original goal ending.';
    const oldConstraint = 'Keep saved credentials unchanged '.repeat(12) + 'Original restriction ending.';
    const oldCondition = 'Verify the original login path '.repeat(12) + 'Original completion ending.';
    task.revision = 2; task.goal = 'Current revised goal';
    task.versions = [
      { revision: 1, title: task.title, goal: oldGoal, constraints: [oldConstraint], conditions: [oldCondition], at: 100 },
      { revision: 2, title: task.title, goal: task.goal, constraints: [], conditions: [], at: 200 },
    ];
    const b = bench({ cards: [task], language });
    try {
      await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); await b.openRequest(task.id);
      await b.press(language === 'en' ? 'Activity' : '活动');
      const versions = [...b.document.querySelectorAll('.dsh-project-task-version')];
      assert.equal(versions.length, 2); assert.equal(versions.every(version => !version.open), true);
      const original = versions.find(version => version.querySelector('strong').textContent.endsWith(' 1'));
      await b.disclose(original.querySelector('summary').textContent);
      const originalText = visibleText(original);
      for (const text of [oldGoal, oldConstraint, oldCondition]) assert.ok(originalText.includes(text), 'the entire saved field is visible');
      assert.equal(originalText.includes(task.goal), false, 'the original version does not borrow the current goal');
      const current = versions.find(version => version.querySelector('strong').textContent.endsWith(' 2'));
      await b.disclose(current.querySelector('summary').textContent);
      assert.ok(visibleText(current).includes(language === 'en' ? 'No constraints recorded.' : '未记录约束。'));
      assert.ok(visibleText(current).includes(language === 'en' ? 'No completion conditions recorded.' : '未记录完成条件。'));
      await b.press(language === 'en' ? 'Overview' : '概览');
      await b.disclose(language === 'en' ? 'Assignment' : '工作要求');
      assert.ok(visibleText(b.document.querySelector('.dsh-project-task-tab-body')).includes(task.goal));
      assert.equal(b.requests.some(request => ['store/write', 'requests/archive', 'requests/restore'].includes(request.method)), false);
      assert.equal(b.sent.length, 0, 'viewing a version sends no user or worker request');
    } finally { await b.dispose(); }
  }
});

test('a completed requirement opens its exact details and results from its own bottom strip', async () => {
  const task = taskCard('delivered-result', 'Delivered analysis', 'completed'), b = bench({ language: 'en', cards: [task] });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver();
    const card = b.requestElement(task.id); assert.ok(card.closest('.dsh-project-requests-list')); assert.equal(card.dataset.projectRequestMode, 'strip');
    await b.openRequest(task.id); assert.equal(card.querySelector('[role=tabpanel]').id, task.id + '-panel-overview');
    await b.press('Results'); assert.equal(card.querySelector('[role=tabpanel]').id, task.id + '-panel-results');
    assert.match(visibleText(card), /Delivered analysis was delivered/); assert.doesNotMatch(visibleText(card), /actual requirement/);
    assert.equal(b.requests.filter(request => request.method === 'requests/get').at(-1).input.requestId, task.id);
    assert.equal(b.requests.some(request => request.method === 'session/create' || request.method === 'archive'), false);
  } finally { await b.dispose(); }
});

test('the current card exposes the real requirement queue and sends exact enqueue, reorder and cancel actions', async () => {
  const current = taskCard('active-a', 'Current A'), first = taskCard('queued-b', 'Queued B'), second = taskCard('queued-c', 'Queued C'), draft = taskCard('draft-d', 'Discuss D');
  current.queue = { state: 'active', released: false };
  first.queue = { state: 'queued', position: 1 }; second.queue = { state: 'queued', position: 2 }; draft.queue = { state: 'discussing' };
  const queue = { active: current, queued: [{ ...first, position: 1 }, { ...second, position: 2 }], paused: false };
  const b = bench({ cards: [current, first, second, draft], queue });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver();
    const card = b.requestElement(current.id);
    assert.ok(isVisible(card)); assert.equal(card.dataset.projectRequestMode, 'card');
    assert.deepEqual([first, second].map(item => b.requestElement(item.id).dataset.projectRequestMode), ['strip', 'strip']);
    assert.match(visibleText(b.requestElement(first.id)), /Queued B.*statusQueuePosition/s);
    assert.match(visibleText(b.requestElement(second.id)), /Queued C.*statusQueuePosition/s);
    await b.openTaskList(); await b.openRequest(second.id); await b.press(`${second.title} · more`); await b.press('requestMoveUp');
    const actions = () => b.requests.filter(request => request.method === 'requests/queue').map(request => ({ ...request.input }));
    assert.deepEqual(actions()[0], { projectId: b.project.id, requestId: second.id, requestRevision: 1, action: 'move', beforeRequestId: first.id });
    await b.press(`${second.title} · more`); await b.press('requestCancel');
    assert.deepEqual(actions()[1], { projectId: b.project.id, requestId: second.id, requestRevision: 1, action: 'cancel' });
    await b.openTaskList(); await b.openRequest(draft.id); await b.press(`${draft.title} · more`); await b.press('requestEnqueue');
    assert.deepEqual(actions()[2], { projectId: b.project.id, requestId: draft.id, requestRevision: 1, action: 'enqueue' });
    assert.equal(b.sent.length, 0); assert.equal(b.requests.some(request => ['delegate', 'stop', 'archive', 'store/write'].includes(request.method)), false);
  } finally { await b.dispose(); }
});

test('paused active requirements resume while released or cancelled requirements rejoin without a project resume', async () => {
  for (const state of ['active', 'released', 'cancelled', 'paused-head']) {
    const request = taskCard('retained-request', 'Retained work', 'paused');
    request.queue = { state: state === 'released' ? 'active' : state === 'paused-head' ? 'queued' : state, released: state === 'released', position: state === 'paused-head' ? 1 : null };
    const queue = { active: state === 'active' ? request : null, queued: state === 'paused-head' ? [request] : [], paused: true };
    const b = bench({ cards: [request], queue });
    try {
      await b.flush(); await b.adopt(); await b.mount();
      if (state === 'cancelled') {
        await b.openTaskList(); await b.press('more'); await b.press('taskCancelled · 1'); await b.openRequest(request.id);
        await b.press(`${request.title} · more`);
      } else await b.openRequest(request.id, false);
      const label = state === 'active' ? 'requestResume' : state === 'paused-head' ? 'requestResumeQueue' : 'requestRejoin';
      assert.ok(b.button(label));
      assert.equal(b.button(state === 'active' ? 'requestRejoin' : 'requestResume'), undefined);
      await b.press(label);
      assert.equal(b.requests.filter(item => item.method === 'requests/queue').at(-1).input.action, ['active', 'paused-head'].includes(state) ? 'resume' : 'enqueue');
      assert.equal(b.requests.some(item => item.method === 'resume'), false, 'Rejoining a requirement never issues the whole-project resume command');
    } finally { await b.dispose(); }
  }
});

test('queue action failures stay visible as a Toast and preserve the requirement view and queue', async () => {
  const draft = taskCard('draft-requirement', 'Discussed objective'); draft.queue = { state: 'discussing' };
  let reject;
  const b = bench({ cards: [draft], queue: { active: null, queued: [], paused: false }, rpcOverride: method => method === 'requests/queue' ? new Promise((_resolve, fail) => { reject = fail; }) : undefined });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openRequest(draft.id, false);
    const body = b.panel('requests');
    await b.press('requestEnqueue');
    assert.ok(b.button('requestEnqueue').disabled);
    await act(async () => { reject(new Error('The requirement changed before queue admission')); await new Promise(resolve => setImmediate(resolve)); });
    const toast = b.document.querySelector('[role=alert]');
    assert.equal(toast.textContent, 'The requirement changed before queue admission'); assert.equal(body.contains(toast), false);
    assert.equal(b.requestElement(draft.id).dataset.projectRequestMode, 'card'); assert.equal(b.button('requestEnqueue').disabled, false);
    assert.equal(draft.queue.state, 'discussing'); assert.equal(b.project.queue.queued.length, 0); assert.equal(b.sent.length, 0);
  } finally { await b.dispose(); }
});

test('a historical file preview closes the requirement panel and reopens with each requirement in its own shape', async () => {
  const current = taskCard('current-request', 'Continue the current objective', 'pendingDelivery'), completed = taskCard('completed-request', 'Inspect the earlier delivery', 'completed');
  completed.delivery.artifacts = [{ path: 'historical.txt', workstreamId: 'old-work', delegationRef: 'old-assignment', location: 'project', size: 3 }];
  const b = bench({ cards: [current, completed] });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openRequest(completed.id); await b.press('taskResults');
    await b.press('openFile: historical.txt');
    assert.equal(b.opened.at(-1).path, 'C:/workspace/real/historical.txt');
    assert.equal(b.panel('requests'), null, 'The native preview is not covered by the requirement panel');
    await b.openObserver();
    assert.equal(b.requestElement(completed.id).dataset.projectRequestMode, 'full'); assert.equal(b.requestElement(current.id).dataset.projectRequestMode, 'card');
    assert.match(visibleText(b.requestElement(current.id)), /Continue the current objective/); assert.doesNotMatch(visibleText(b.requestElement(current.id)), /Inspect the earlier delivery|was delivered/);
    await b.press('taskResults');
    assert.match(visibleText(b.requestElement(completed.id)), /Inspect the earlier delivery was delivered/);
    assert.equal(b.requests.some(request => ['store/write', 'requests/archive', 'delegate', 'resume'].includes(request.method)), false);
  } finally { await b.dispose(); }
});

test('idle members and submitted reports keep the active requirement awaiting delivery beside completed bottom strips', async () => {
  const detail = workDetail(); detail.activity = { running: 0, blocked: 0, queued: 0, state: 'idle' }; detail.workstreams[0].status = 'completed';
  const current = taskForWork(detail, 'pendingDelivery'), completed = taskCard('previous-delivery', 'Earlier delivered objective', 'completed'); current.counts = { total: 1, completed: 1 };
  const b = bench({ detail, cards: [current, completed] });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver();
    const active = b.requestElement(current.id), saved = b.requestElement(completed.id);
    assert.equal(active.dataset.projectRequestStatus, 'requestHandover'); assert.equal(saved.dataset.projectRequestMode, 'strip');
    assert.equal(active.querySelector('[role=progressbar]').getAttribute('aria-valuenow'), '1');
    assert.equal(active.querySelector('[role=progressbar]').getAttribute('aria-valuemax'), '1');
    assert.equal(current.status, 'pendingDelivery'); assert.doesNotMatch(visibleText(active), /Earlier delivered objective/);
    await b.openRequest(completed.id); await b.press('taskResults');
    assert.equal(active.dataset.projectRequestMode, 'card'); assert.match(visibleText(saved), /Earlier delivered objective was delivered/);
    await b.openPanel('team'); assert.ok(isVisible(active)); assert.ok(isVisible(saved));
    assert.equal(b.requests.some(request => ['requests/archive', 'archive', 'store/write', 'delegate', 'message'].includes(request.method)), false); assert.deepEqual(b.sent, []);
  } finally { await b.dispose(); }
});

test('collapsing a historical result leaves the current card and both requirement identities intact', async () => {
  const current = taskCard('current-request', 'Continue the current objective'), completed = taskCard('completed-request', 'Inspect the earlier delivery', 'completed'); const b = bench({ cards: [current, completed] });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); const active = b.requestElement(current.id);
    await b.openRequest(completed.id); await b.press('taskResults'); assert.match(visibleText(b.requestElement(completed.id)), /Inspect the earlier delivery was delivered/);
    await b.press(completed.title + ' · observerStrip'); assert.equal(b.requestElement(completed.id).dataset.projectRequestMode, 'strip');
    assert.equal(b.requestElement(current.id), active); assert.equal(active.dataset.projectRequestMode, 'card'); assert.ok(isVisible(active));
    assert.doesNotMatch(visibleText(active), /Inspect the earlier delivery was delivered/);
    assert.equal(b.requests.some(request => ['store/write', 'requests/archive', 'archive'].includes(request.method)), false);
  } finally { await b.dispose(); }
});

test('the completed bottom group pages independently and opens the exact saved result without hiding active progress', async () => {
  const current = taskCard('current-paged', 'Current objective', 'pendingDelivery'), completed = Array.from({ length: 14 }, (_, i) => taskCard('completed-' + i, 'Completed objective ' + i, 'completed'));
  const b = bench({ cards: [current, ...completed] });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver();
    const group = b.document.querySelector('.dsh-project-requests-list'), ids = () => [...group.querySelectorAll('[data-project-request-id]')].map(card => card.dataset.projectRequestId);
    assert.deepEqual(ids(), completed.slice(0,10).map(card => card.id)); await b.press('taskMore');
    assert.deepEqual(ids(), completed.slice(10).map(card => card.id)); assert.equal(b.requestElement(current.id).dataset.projectRequestMode, 'card');
    await b.openRequest(completed[13].id); await b.press('taskResults');
    assert.match(visibleText(b.requestElement(completed[13].id)), /Completed objective 13 was delivered/);
    await b.press(completed[13].title + ' · observerStrip'); assert.deepEqual(ids(), completed.slice(10).map(card => card.id));
    await b.press('previous'); assert.deepEqual(ids(), completed.slice(0,10).map(card => card.id));
    assert.equal(b.requests.some(request => ['requests/archive', 'archive', 'delegate', 'message', 'store/write'].includes(request.method)), false);
  } finally { await b.dispose(); }
});

test('independent requirement shapes preserve unsaved materials and the coordinator composer draft', async () => {
  const current = taskCard('current-with-notes', 'Continue while retaining notes'), b = bench({ cards: [current] });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.press('materials'); await b.press('notes'); await b.changeNotes('Unsaved material for the current Project');
    const editor = b.document.querySelector('.dsh-project-materials textarea'), draft = b.document.createElement('textarea'); draft.value = 'Unsent coordinator follow-up'; b.document.body.append(draft);
    await b.openRequest(current.id); await b.press(current.title + ' · observerStrip'); await b.openRequest(current.id);
    assert.equal(b.document.querySelector('.dsh-project-materials textarea'), editor); assert.equal(editor.value, 'Unsaved material for the current Project'); assert.ok(isVisible(editor));
    assert.equal(draft.value, 'Unsent coordinator follow-up'); assert.equal(b.document.querySelector('[role=dialog][aria-label=unsaved]'), null);
    assert.equal(b.requests.some(request => ['store/write', 'delegate', 'prompt', 'message', 'resume'].includes(request.method)), false); assert.deepEqual(b.sent, []);
    await b.press('close'); assert.ok(b.document.querySelector('[role=dialog][aria-label=unsaved]')); await b.press('keepEditing'); assert.equal(editor.value, 'Unsaved material for the current Project');
  } finally { await b.dispose(); }
});

test('completed Request cards move to the second-level archive without archiving the Project', async () => {
  const current = taskCard('task-open', 'Current request');
  const completed = taskCard('task-done', 'Delivered request', 'completed');
  const b = bench({ cards: [current, completed] });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.flush(); await b.openTaskList();
    const listed = () => [...b.document.querySelectorAll('[data-project-request-id]')].map(element => element.dataset.projectRequestId);
    assert.deepEqual(listed(), ['task-open', 'task-done']);
    await b.openRequest(completed.id);
    await b.press('Delivered request · more'); await b.press('taskArchiveAction'); await b.flush();
    assert.deepEqual(b.requests.filter(request => request.method === 'requests/archive').map(request => ({ ...request.input })), [{ projectId: 'project-one', requestId: 'task-done' }]);
    assert.equal(b.project.lifecycle, 'ready'); assert.equal(b.requests.some(request => request.method === 'archive'), false);
    assert.equal(b.requestElement(completed.id), null);
    await b.press('more'); await b.press('taskArchive · 1');
    assert.equal(b.document.querySelector('.dsh-project-requests-list [data-project-request-id=task-done]')?.textContent.includes('Delivered request'), true);
    await b.press('Delivered request · more'); await b.press('taskRestoreAction'); await b.flush();
    assert.deepEqual(b.requests.filter(request => request.method === 'requests/restore').map(request => ({ ...request.input })), [{ projectId: 'project-one', requestId: 'task-done' }]);
    await b.press('taskBack');
    assert.deepEqual(listed(), ['task-open', 'task-done']);
  } finally { await b.dispose(); }
});

test('the Team header panel shows the Project roster and opens one exact member record in the dialog', async () => {
  const team = { members: [
    { id: 'coordinator-existing', role: 'lead', name: 'Lead', phase: 'active' },
    { id: 'worker-one', role: 'worker', name: 'Engineer', description: 'Implementation', phase: 'active' },
  ], tasks: [{ id: 'team-task', subject: 'Search endpoint', description: 'Inspect search queries', ownerName: 'Engineer', status: 'in_progress' }] };
  const b = bench({ detail: workDetail(), team });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openPanel('team');
    const overview = b.document.querySelector('.dsh-project-observer-team');
    assert.match(overview.textContent, /Engineer|Search endpoint|Inspect search queries/);
    assert.equal(overview.querySelectorAll('.dsh-project-team-row').length, 2);
    await b.press('viewProcess'); await b.flush();
    assert.equal(b.requests.filter(request => request.method === 'workstreams/get').at(-1).input.workerSessionId, 'worker-one');
    assert.equal(b.navigation.some(row => row[0] === 'session' && row[1] === 'worker-one'), false);
    assert.match(b.dialog().textContent, /Worker record/);
    await b.press('close'); assert.equal(b.dialog(), null); assert.match(b.document.querySelector('.dsh-project-observer-team').textContent, /Engineer|Search endpoint/);
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
    await b.flush(); await b.adopt(); await b.mount(); await b.openPanel('team');
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
      await b.flush(); await b.adopt(); await b.mount(); await b.openPanel('team');
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
      await b.flush(); await b.adopt(); await b.mount(); await b.openPanel('team');
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
      await b.flush(); await b.adopt(); await b.mount(); await b.openPanel('team');
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
      await b.press('close'); await b.openRequest(card.id); await b.press('taskResults'); await b.flush();
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
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); await b.expandObserver(); await b.press('Results & materials');
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

test('Project navigation publishes exact coordinator archive state and unregisters on dispose', async () => {
  let listed = true;
  const b = bench({ rpcOverride: (method, _input, project) => {
    if (method === 'list') return { ok: true, value: { available: true, projects: listed ? [project] : [] } };
    if (method === 'archive' || method === 'restore') { project.lifecycle = method === 'archive' ? 'archived' : 'ready'; return { ok: true, value: { project } }; }
  } });
  try {
    await b.flush(); await b.mount();
    const entries = () => navigationEntries(b);
    const entry = archived => [{ sessionId: b.project.coordinatorSessionId, workingDirectory: 'C:/workspace/real', archived }];
    assert.deepEqual(entries(), entry(false));
    await act(async () => { await b.face().command(b.project.id, 'archive'); });
    assert.deepEqual(entries(), entry(true));
    await act(async () => { b.sessionActions.get('project').restore(b.project.coordinatorSessionId); await new Promise(resolve => setImmediate(resolve)); });
    assert.equal(b.requests.filter(request => request.method === 'restore').at(-1).input.projectId, b.project.id);
    assert.deepEqual(entries(), entry(false));
    listed = false; await b.poll(); assert.deepEqual(entries(), []);
  } finally { await b.dispose(); }
  assert.equal(b.sessionActions.size, 0); assert.equal(b.sessionNavigation.size, 0);
});

test('opening a Project material uses the native mini preview and leaves unrelated requirements unchanged', async () => {
  const current = taskCard('material-current', 'Current development'), b = bench({ cards: [current] });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.press('materials'); await b.flush(); await b.disclose('docs (1)'); await b.press('openFile: report.md');
    assert.equal(b.opened.at(-1).path, 'C:/workspace/real/docs/report.md'); assert.equal(b.opened.at(-1).options.presentation, 'mini');
    assert.ok(b.document.querySelector('.dsh-project-materials')); await b.openObserver(); assert.equal(b.requestElement(current.id).dataset.projectRequestMode, 'card');
  } finally { await b.dispose(); }
});

test('requirement shape changes preserve the exact queued page without duplicating cards', async () => {
  const cards = Array.from({ length: 14 }, (_, index) => taskCard('task-' + index, 'Task ' + index)), b = bench({ cards });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver(); const listed = () => [...b.document.querySelectorAll('[data-project-request-id]')].map(card => card.dataset.projectRequestId);
    assert.deepEqual(listed(), cards.slice(0,10).map(card => card.id)); await b.press('taskMore');
    assert.deepEqual(listed(), [cards[0].id, ...cards.slice(10).map(card => card.id)]); const reads = b.requests.filter(request => request.method === 'requests/list').length;
    await b.openRequest(cards[13].id); await b.press(cards[13].title + ' · observerStrip');
    assert.deepEqual(listed(), [cards[0].id, ...cards.slice(10).map(card => card.id)]); assert.equal(b.requestElement(cards[0].id).dataset.projectRequestMode, 'card');
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
    await b.flush(); await b.adopt(); await b.mount(); await b.openTaskList(); await b.press('taskMore');
    assert.equal(typeof releaseOld, 'function');
    detail.revision = 'request-page-2';
    cards[0].title = 'New Task 0';
    await b.poll(); await b.flush();
    const list = b.panel('requests');
    assert.match(list.textContent, /New Task 0/); assert.doesNotMatch(list.textContent, /Old Task 10/);
    await act(async () => { releaseOld(); await new Promise(resolve => setImmediate(resolve)); });
    assert.match(list.textContent, /New Task 0/); assert.doesNotMatch(list.textContent, /Old Task 10/);
    assert.equal(pageReads, 1);
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
    assert.match(b.panel('requests').textContent, /Implement feature|running/);
    await b.openTaskList(); await b.openRequest(task.id); await b.press('taskTeam'); await b.flush();
    const work = b.document.querySelector('[data-workstream-id=work-one]'); assert.ok(work);
    assert.match(work.textContent, /running/);
    await b.press('stopWork');
    assert.deepEqual({ ...b.requests.filter(request => request.method === 'stop').at(-1).input },
      { projectId: 'project-one', workstreamId: 'work-one', requestId: b.requests.filter(request => request.method === 'stop').at(-1).input.requestId });
    await b.disclose('workDetails', work); await b.flush();
    assert.ok(b.button('viewProcess')); await b.press('diff'); await b.flush();
    assert.match(b.dialog().textContent, /diffScope|notGit/);
    await b.press('close'); assert.equal(b.dialog(), null); assert.ok(isVisible(b.document.querySelector('[data-workstream-id=work-one]')));
  } finally { await b.dispose(); }
});

test('an accepted objective without a worker shows its goal, revision and pending delivery', async () => {
  const card = taskCard('real-request', 'Explain the saved API decision', 'pendingDelivery');
  card.revision = 2;
  const b = bench({ cards: [card], detail: { workstreams: [], workers: [] } });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openTaskList(); await b.openRequest(card.id);
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
    const dialog = b.dialog(), records = [...dialog.querySelectorAll('.dsh-project-body')].find(element => isVisible(element) && element.querySelector('.dsh-project-record-round'));
    assert.equal(loads, 1); assert.match(records.textContent, /Original exact assignment/); assert.match(records.textContent, /Original exact result/); assert.doesNotMatch(records.textContent, /Later unrelated assignment|Worker record 76/);
    assert.equal(b.requests.filter(row => row.method === 'workstreams/get').at(-1).input.workstreamId, ref.workstreamId);
    await b.press('backToResults'); assert.equal(b.document.querySelector('.dsh-project-materials'), materials); assert.equal(scrollBody.scrollTop, 310);
    assert.match(materials.textContent, /Original result/); assert.equal(materials.querySelector('.dsh-project-results-list').hidden, true);
    await b.press('allResults'); assert.equal(scrollBody.scrollTop, 520, 'Return restores the nonzero original delivery-list position'); assert.match(materials.textContent, /Original delivery/);
    await b.press('notes'); await b.changeNotes('Keep the original draft');
    await b.press('close');
    // Closing Materials protects the same retained draft.
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
    await b.flush(); await b.adopt(); await b.mount(); await b.openTaskList(); await b.openRequest(task.id); await b.press('taskTeam'); await b.flush();
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
    await b.flush(); await b.adopt(); await b.mount(); await b.openTaskList(); await b.openRequest(task.id); await b.press('taskTeam'); await b.flush();
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
      await b.flush(); await b.adopt(); await b.mount(); await b.openTaskList(); await b.openRequest(task.id); await b.press('taskTeam'); await b.flush();
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
    await b.flush(); await b.adopt(); await b.mount(); await b.openTaskList(); await b.openRequest(task.id); await b.press('taskTeam'); await b.flush();
    await b.disclose('workDetails', b.document.querySelector('[data-workstream-id=work-one]'));
    const heading = b.document.querySelector('[data-workstream-id=work-one] .dsh-project-work-heading'); assert.match(heading.textContent, /running/); assert.doesNotMatch(heading.textContent, /pendingSummary/);
    await b.press('viewResult'); await b.flush(); assert.match(b.dialog().textContent, /An actual integration check remains/); await b.press('close');
    const navigation = b.navigation.length;
    assert.equal(b.document.querySelector('[data-workstream-id=work-one] .dsh-project-work-details').open, true, 'Returning preserves the expanded work details');
    await b.press('viewProcess'); await b.flush();
    assert.equal(b.retained[0].address.parentSessionId, 'coordinator-existing'); assert.equal(b.retained[0].address.childSessionId, 'worker-one'); assert.equal(b.retained[0].address.mode, 'continuable');
    assert.equal(b.dialog().querySelectorAll('textarea,input').length, 0); assert.equal(b.navigation.length, navigation);
    assert.match(b.document.body.textContent, /Worker record 80/); assert.match(b.document.body.textContent, /actual repository content/);
    const dialog = b.dialog();
    assert.equal(dialog.querySelectorAll('[data-markdown]').length, 46); assert.equal(dialog.querySelectorAll('.dsh-project-record-row').length, 48);
    const assistantRows = [...dialog.querySelectorAll('.dsh-project-record-row')].filter(row => row.querySelector('strong')?.textContent === 'assistant');
    assert.equal(assistantRows.length, 46); assert.ok(assistantRows.every(row => row.querySelector('[data-markdown]')?.textContent.trim()));
    assert.match(dialog.textContent, /Worker record 35/); assert.doesNotMatch(dialog.textContent, /Worker record 34/);
    const toolCall = [...dialog.querySelectorAll('details')].find(row => row.querySelector('summary')?.textContent.startsWith('tool: read_file · '));
    assert.equal(toolCall.querySelector('time').dateTime, new Date(81).toISOString());
    assert.equal(toolCall.querySelector('pre').textContent, '{"path":"src/app.js"}');
    await b.press('previous'); assert.match(b.document.body.textContent, /Worker record 21/); assert.match(dialog.textContent, /Worker record 34/); assert.doesNotMatch(dialog.textContent, /Worker record 35|Worker record 80/);
    await b.press('older'); assert.match(b.dialog().textContent, /Worker record 1/);
    await b.press('close'); assert.deepEqual(b.released, ['worker-one']); assert.equal(b.navigation.length, navigation);
    assert.deepEqual(b.eventSource.getSnapshot().entries.slice(-2), emptyRecords);
    assert.equal(b.requests.some(request => ['delegate', 'message', 'prompt'].includes(request.method)), false);
  } finally { await b.dispose(); }
});

test('result records return to the same result dialog and closing it leaves the requirement panel in place', async () => {
  const detail = workDetail(), task = taskForWork(detail), b = bench({ detail, cards: [task] });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openRequest(task.id); await b.press('taskTeam'); await b.flush();
    const origin = b.button('viewResult'); await b.press('viewResult'); await b.flush();
    const report = b.dialog(); assert.match(report.textContent, /Actual worker summary/);
    await b.press('viewProcess'); await b.flush(); assert.doesNotMatch(visibleText(b.dialog()), /Actual worker summary/);
    await b.press('backToResults'); assert.match(visibleText(b.dialog()), /Actual worker summary/);
    await b.press('close'); assert.equal(b.dialog(), null);
    assert.ok(isVisible(origin), 'The requirement panel stays open beneath the dialog'); assert.equal(b.requestElement(task.id).dataset.projectRequestMode, 'full');
  } finally { await b.dispose(); }
});

test('registered artifacts open in the application under their authorized directory and non-Git diff stays explicit', async () => {
  const detail = workDetail(), task = taskForWork(detail), b = bench({ detail, cards: [task] });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openTaskList(); await b.openRequest(task.id); await b.press('taskTeam'); await b.flush();
    await b.press('viewResult'); await b.flush();
    const result = b.dialog()?.querySelector('[data-result-workstream-id=work-one]');
    const originalButton = b.button('openFile: app.js'); originalButton.focus();
    await b.press('openFile: app.js'); const artifact = b.requests.filter(request => request.method === 'open').at(-1); assert.equal(artifact.input.workstreamId, 'work-one'); assert.equal(artifact.input.path, 'src/app.js'); assert.equal(artifact.input.delegationRef, 'actual-assignment');
    assert.equal(b.opened[0].path, 'C:/workspace/real/src/app.js');
    assert.equal(b.opened[0].options.sessionId, 'coordinator-existing'); assert.equal(b.opened[0].options.workingDirectory, 'C:/workspace/real'); assert.equal(b.opened[0].options.presentation, 'mini');
    assert.ok(result); assert.equal(b.dialog(), null, 'The native preview replaces the result dialog'); assert.equal(b.panel('requests'), null);
    await b.expandObserver(); assert.equal(b.requestElement(task.id).dataset.projectRequestMode, 'full');
    await b.disclose('workDetails', b.document.querySelector('[data-workstream-id=work-one]'));
    await b.press('diff'); assert.match(b.dialog().textContent, /diffScope|notGit/);
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
    await b.flush(); await b.adopt(); await b.mount(); await b.openTaskList(); await b.openRequest(task.id); await b.press('taskTeam'); await b.flush();
    await b.press('viewResult'); await b.flush();
    const dialog = b.dialog();
    const visibleResults = () => [...dialog.querySelectorAll('[data-result-workstream-id]')].filter(isVisible);
    assert.deepEqual(visibleResults().map(row => row.dataset.resultWorkstreamId), [work.id]);
    assert.doesNotMatch(visibleResults().map(row => row.textContent).join('\n'), /Unrelated visible report/);
    const targetRequests = b.requests.filter(request => ['workstreams/get', 'store/results'].includes(request.method));
    assert.deepEqual(targetRequests.map(request => request.method).sort(), ['store/results', 'workstreams/get', 'workstreams/get']);
    assert.ok(targetRequests.every(request => request.input.projectId === b.project.id && request.input.workstreamId === work.id));
    await b.press('openFile: module.js');
    const opened = b.requests.filter(request => request.method === 'open').at(-1);
    assert.equal(opened.input.projectId, b.project.id); assert.equal(opened.input.workstreamId, work.id); assert.equal(opened.input.delegationRef, work.latestReport.delegationRef); assert.equal(opened.input.path, work.latestReport.artifacts[0].path);
    await b.expandObserver(); await b.press('taskMaterials'); const returnedMaterials = b.document.querySelector('.dsh-project-materials');
    assert.deepEqual([...returnedMaterials.querySelectorAll('[data-result-workstream-id]')].filter(isVisible).map(row => row.dataset.resultWorkstreamId), ['other-work']);
    assert.equal(JSON.stringify(work.latestReport), originalReport); assert.equal(b.sent.length, 0); assert.equal(b.requests.some(request => ['delegate', 'resume', 'store/write'].includes(request.method)), false);
  } finally { await b.dispose(); }
});

test('a failed authorized file read or native preview keeps the original materials visible', async () => {
  for (const boundary of ['authority', 'preview']) {
    const detail = workDetail(), task = taskForWork(detail), b = bench({ detail, cards: [task], rpcOverride: method => boundary === 'authority' && method === 'open' ? { ok: false, error: { message: 'Actual file access failed' } } : undefined,
      previewOverride: boundary === 'preview' ? async () => { throw new Error('Actual native preview failed'); } : undefined });
    try {
      await b.flush(); await b.adopt(); await b.mount(); await b.openTaskList(); await b.openRequest(task.id); await b.press('taskTeam'); await b.flush(); await b.press('viewResult'); await b.flush();
      const originalResult = b.dialog()?.querySelector('[data-result-workstream-id=work-one]');
      await b.press('openFile: app.js'); assert.ok(isVisible(originalResult)); assert.ok(b.panel('requests'));
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
    assert.ok(isVisible(replacement)); assert.ok(b.dialog()); assert.equal(b.face().hooks.projectView.getSnapshot().materialsPreview, false); assert.equal(b.opened.length, 1);

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
    assert.equal(isVisible(replacement), false); assert.equal(b.dialog(), null);
    assert.equal(b.face().hooks.projectView.getSnapshot().materialsPreview, true);
    await act(async () => { b.face().showMaterials('project-one'); });
    assert.equal(b.document.querySelector('[data-result-workstream-id=work-one]'), replacement);
    assert.ok(isVisible(replacement)); assert.equal(content.scrollTop, 123); assert.equal(b.document.activeElement, originalButton);
    await act(async () => { finishOlder(); await older; });
    assert.ok(b.dialog()); assert.ok(isVisible(replacement));
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
    assert.equal(isVisible(editor), false); assert.equal(b.dialog(), null); assert.equal(b.face().hooks.projectView.getSnapshot().materialsPreview, true);
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
      await b.flush(); await b.adopt(); await b.mount(); await b.openTaskList(); await b.openRequest(previous.id); await b.press('taskTeam');
      const task = b.document.querySelector('[data-project-detail-id=request-a]'), member = task.querySelector('.dsh-project-task-member');
      assert.equal(task.querySelectorAll('.dsh-project-task-member').length, 1); assert.equal(task.querySelector('[data-project-detail-id=request-b]'), null);
      assert.equal(b.requestElement(previous.id).querySelector('.dsh-project-task-title').textContent, 'Request A');
      assert.match(task.textContent, /requestVersion 2/); assert.match(member.textContent, hasReport ? /completed/ : /failed/);
      if (!hasReport) assert.match(member.textContent, /Actual failure from requirement A/);
      if (hasReport) {
        await b.press('viewResult'); const exact = b.requests.filter(request => request.method === 'store/results').at(-1); assert.equal(exact.input.projectId, 'project-one'); assert.equal(exact.input.workstreamId, currentWork.id); assert.equal(exact.input.delegationRef, old.ref);
        const report = b.dialog();
        assert.match(report.textContent, /Actual earlier inspection/); assert.doesNotMatch(report.textContent, /Actual worker summary/); await b.press('close');
      } else { assert.equal([...member.querySelectorAll('button')].some(button => button.textContent === 'viewResult'), false); }
      await b.press('viewProcess'); await b.flush(); const records = b.dialog();
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
    await b.press('close'); assert.equal(b.dialog(), null);
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
    await b.flush(); await b.adopt(); await b.mount(); await b.flush(); await b.openTaskList(); await b.openRequest(task.id); await b.press('taskTeam'); await b.flush();
    for (const action of ['resume', 'archive', 'restore']) {
      const before = b.requests.filter(request => request.method === 'detail').length;
      await act(async () => { await b.face().command('project-one', action); });
      assert.ok(b.requests.filter(request => request.method === 'detail').length > before);
      await b.render();
      if (action === 'archive') { assert.match(b.document.body.textContent, /archivedHint/); assert.ok(b.button('restore')); }
      else { assert.ok(b.document.querySelector('[data-workstream-id=work-one]')); await b.press('viewResult'); await b.flush();
        assert.match(b.dialog().textContent, /Actual worker summary/);
        await b.press('close'); assert.doesNotMatch(b.document.body.textContent, /archivedHint/); }
    }
  } finally { await b.dispose(); }
});

test('stop controls invoke the same Host stop command and incremental polling preserves unchanged details', async () => {
  const detail = workDetail(), task = taskForWork(detail);
  const b = bench({ detail, cards: [task], rpcOverride: (method, input, project) => method === 'list' ? { ok: true, value: { projects: [project], available: true } }
    : method === 'detail' && input.since ? { ok: true, value: { unchanged: true, revision: input.since } } : undefined });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openTaskList(); await b.openRequest(task.id); await b.press('taskTeam'); await b.flush();
    await b.press('stopWork'); await b.press('stop');
    const stops = b.requests.filter(request => request.method === 'stop'); assert.equal(stops.length, 2); assert.equal(stops[0].input.workstreamId, 'work-one'); assert.equal(stops[1].input.workstreamId, undefined); assert.ok(stops.every(request => request.input.projectId === 'project-one' && request.input.requestId));
    await b.poll(); await b.disclose('workDetails', b.document.querySelector('[data-workstream-id=work-one]'));
    assert.ok(b.requests.some(request => request.method === 'detail' && request.input.since === 'revision-1'));
    await b.press('viewResult'); await b.flush(); assert.match(b.dialog().textContent, /Actual worker summary/);
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
      await b.flush(); await b.adopt(); await b.mount(); await b.openTaskList(); await b.openRequest(task.id); await b.press('taskTeam'); await b.flush(); await b.press('stopWork');
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
      await b.flush(); await b.adopt(); await b.mount(); await b.openTaskList(); await b.openRequest(task.id); await b.press('taskTeam'); await b.flush();
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
    await b.flush(); await b.adopt(); await b.mount(); await b.openTaskList(); await b.openRequest(task.id);
    const recovery = b.document.querySelector('[data-request-recovery-id=imported-request]');
    assert.equal(recovery.querySelector('strong').textContent, 'Retained original goal · requestVersion 4');
    assert.match(recovery.textContent, /authorityErrorHint/); assert.doesNotMatch(b.document.querySelector('.dsh-project-task-full').textContent, /handoverErrorHint|summaryCredentialHint|summaryErrorHint/);
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
    await b.flush(); await b.adopt(); await b.mount(); await b.openTaskList(); await b.openRequest(requestCard.id);
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
    await b.flush(); await b.adopt(); await b.mount(); await b.openTaskList(); await b.openRequest(task.id);
    const draft = b.document.createElement('textarea'); draft.value = 'Unsent follow-up'; b.document.body.append(draft);
    assert.match(b.document.querySelector('[data-project-detail-id=request-one]').textContent, /Repair the import|requestVersion 2/);
    await b.disclose('errorDetails', b.document.querySelector('[data-project-detail-id=request-one]'));
    await b.press('retrySummary'); assert.equal(b.sent.length, 1);
    assert.match(b.sent[0].text, /retrySummaryPrompt\nRepair the import · requestVersion 2\nFix and verify the import/);
    assert.equal(draft.value, 'Unsent follow-up');
    stale = true; await b.press('retrySummary'); assert.equal(b.sent.length, 1);
    assert.match(b.document.querySelector('[role=alert]').textContent, /resultUpdated/);
    stale = false; authorityMissing = true; await b.press('retrySummary'); assert.equal(b.sent.length, 1);
    assert.match(b.document.querySelector('[role=alert]').textContent, /authorityErrorHint/);
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
  try { await b.flush(); await b.adopt(); await b.mount(); await b.openTaskList(); await b.openRequest(task.id); await b.press('taskTeam'); await b.flush();
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
    await b.flush(); await b.adopt(); await b.mount(); await b.openTaskList(); await b.openRequest(task.id); await b.press('taskTeam'); await b.flush();
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
    const dialog = b.dialog(), card = dialog.querySelector('[data-delivery-id=delivery-partial]');
    assert.ok(isVisible(card.querySelector('.dsh-project-result-conclusion'))); assert.match(card.textContent, /The provider must be configured/);
    assert.equal(b.button('viewProcess'), undefined); const fullDetails = card.querySelector('details'); assert.equal(fullDetails.open, false);
    await b.disclose('deliveryDetails', card); const recordButton = b.button('viewProcess'); recordButton.focus();
    recordButton.getClientRects = () => isVisible(recordButton) ? [{}] : [];
    const materials = dialog.querySelector('.dsh-project-materials'), content = materials.querySelector('.dsh-project-materials-content'); content.scrollTop = 176;
    content.getClientRects = () => isVisible(content) ? [{}] : [];
    await b.press('viewProcess'); await b.flush();
    content.scrollTop = 0;
    assert.ok(dialog.querySelector('.dsh-project-context')); assert.equal(isVisible(materials), false);
    assert.ok(b.document.activeElement === dialog.querySelector('.dsh-project-context button'), 'The process preview receives focus on its return control');
    assert.match(dialog.textContent, /Actual inspection before the failure/); assert.match(dialog.textContent, /Actual terminal provider failure/); assert.doesNotMatch(dialog.textContent, /runRecordsMissing/);
    assert.deepEqual(b.retained.map(item => ({ ...item.address })), [{ parentSessionId: 'coordinator-existing', childSessionId: 'worker-one', mode: 'continuable' }]);
    assert.equal(b.requests.filter(request => request.method === 'workstreams/get').at(-1).input.workstreamId, work.id); assert.equal(b.requests.some(request => request.method === 'store/results'), false);
    await b.press('backToResults'); assert.equal(isVisible(materials), true);
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
      await b.press('materials'); assert.equal(b.document.querySelectorAll('.dsh-project-artifact')[i], row);
      await act(async () => { row.querySelector('[aria-label="fileMore: app.js"]').click(); });
      await act(async () => { row.querySelector('[role=menuitem]').click(); });
      assert.equal(row.querySelector('.dsh-project-path').textContent, files[i].path); assert.equal(b.requests.filter(r => r.method === 'open').length, i + 1);
    }
  } finally { await b.dispose(); }
});

test('same-named Projects list under their exact directories with their own coordinator', async () => {
  let other;
  const b = bench({ rpcOverride: (method, input, project) => {
    if (method === 'list') { other = { ...project, id: 'other-project', coordinatorSessionId: 'other-lead', canonicalWorkingDirectory: 'C:/another/real' }; return { ok: true, value: { available: true, projects: [project, other] } }; }
    if (method === 'detail' && input.projectId === other.id) return { ok: true, value: { project: other, workstreams: [], workers: [], revision: 'other-revision' } };
  } });
  try {
    await b.flush(); await b.mount();
    assert.deepEqual(navigationEntries(b), [
      { sessionId: 'coordinator-existing', workingDirectory: 'C:/workspace/real', archived: false },
      { sessionId: 'other-lead', workingDirectory: 'C:/another/real', archived: false }]);
    for (const sessionId of ['coordinator-existing', 'other-lead']) { await b.mountSession(sessionId); assert.equal(b.document.querySelector('.dsh-project-row-badge')?.textContent, 'tab'); }
    assert.equal(b.requests.some(r => ['create', 'delegate', 'resume'].includes(r.method)), false);
  } finally { await b.dispose(); }
});

test('queued work explains the actual gate and an open report refreshes changed prerequisites without rerunning it', async () => {
  for (const [kind, label] of [['dependencies', 'waitingDependencies'], ['directory', 'waitingDirectory'], ['capacity', 'waitingCapacity']]) {
    const detail = workDetail(), work = detail.workstreams[0]; Object.assign(work, { delegation: { phase: 'queued', waitingReason: { kind, workTitles: kind === 'capacity' ? [] : ['API contract'] } } });
    const task = taskForWork(detail), b = bench({ detail, cards: [task], rpcOverride: (method, _input, project) => method === 'list' ? { ok: true, value: { projects: [project], available: true } } : undefined });
    try {
      await b.flush(); await b.adopt(); await b.mount(); await b.openTaskList(); await b.openRequest(task.id); await b.press('taskTeam'); assert.match(b.document.body.textContent, new RegExp(label));
      if (kind !== 'capacity') assert.match(b.document.body.textContent, /API contract/);
      await b.disclose('workDetails'); const previousReads = b.requests.filter(request => request.method === 'workstreams/get').length;
      work.prerequisitesChanged = true; work.latestReport.prerequisitesChanged = true; detail.revision = 'dependency-result-changed';
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
    await b.press('materials'); assert.match(b.document.querySelector('.dsh-project-materials').textContent, /modifiedArtifact/);
  } finally { await b.dispose(); }
});

test('the board summarizes the whole Project and each card states its plain status, next step and undo', async () => {
  const current = taskCard('active-a', 'Current A'), first = taskCard('queued-b', 'Queued B'), draft = taskCard('draft-d', 'Discuss D'), done = taskCard('done-e', 'Delivered E', 'completed');
  current.queue = { state: 'active', released: false }; first.queue = { state: 'queued', position: 1 }; draft.queue = { state: 'discussing' };
  const queue = { active: current, queued: [{ ...first, position: 1 }], discussingCount: 1, paused: false };
  const b = bench({ cards: [current, first, draft, done], queue });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver();
    const board = b.document.querySelector('.dsh-project-board'); assert.ok(board && isVisible(board));
    const cells = Object.fromEntries([...board.querySelectorAll('.dsh-project-board-cell')].map(cell => [cell.querySelector('.dsh-project-board-label').textContent, cell.querySelector('strong').textContent]));
    assert.deepEqual(cells, { boardActive: '1', boardBlocked: '0', boardWaiting: '2', boardDelivered: '1' });
    assert.match(visibleText(b.requestElement(current.id).querySelector('.dsh-project-task-state')), /statusActive/);
    assert.match(visibleText(b.requestElement(first.id)), /Queued B.*statusQueued/s);
    const discussing = await b.openRequest(draft.id, false);
    assert.match(visibleText(discussing.querySelector('.dsh-project-task-state')), /statusDiscussing/);
    assert.match(visibleText(discussing.querySelector('.dsh-project-task-next')), /nextStep.*nextDiscussing/s);
    await b.press('requestUndo');
    assert.deepEqual({ ...b.requests.filter(request => request.method === 'requests/queue').at(-1).input }, { projectId: b.project.id, requestId: draft.id, requestRevision: 1, action: 'cancel' });
    assert.equal(b.sent.length, 0);
  } finally { await b.dispose(); }
});

test('Project rules edit charter.md with common-rule toggles, a size meter and a blocked oversized save', async () => {
  const b = bench();
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.press('materials'); await b.flush(); await b.press('charter');
    assert.equal(b.document.querySelector('[role=tab][aria-selected=true]').textContent, 'charter');
    assert.equal(b.document.querySelector('textarea').getAttribute('aria-label'), 'charter');
    await b.press('charterExampleTests');
    assert.equal(b.document.querySelector('textarea').value, 'charterLineTests');
    assert.equal(b.button('charterExampleTests').getAttribute('aria-pressed'), 'true');
    await b.press('charterExampleTests'); assert.equal(b.document.querySelector('textarea').value, '');
    await b.changeNotes('- Keep the public API stable'); await b.press('save');
    const write = b.requests.filter(request => request.method === 'store/write').at(-1);
    assert.equal(write.input.path, 'charter.md'); assert.equal(write.input.text, '- Keep the public API stable'); assert.equal(b.stored['charter.md'], '- Keep the public API stable');
    await b.changeNotes('x'.repeat(16001));
    assert.equal(b.document.querySelector('.dsh-project-charter-meter').dataset.over, 'true');
    assert.equal(b.button('save').disabled, true);
  } finally { await b.dispose(); }
});

test('a delivered card lists its files, opens them with exact authority and shows a per-file colored diff', async () => {
  const task = taskCard('delivered-files', 'Login remember me', 'completed');
  task.work = [{ workstreamId: 'work-one', delegationRef: 'actual-assignment', workerSessionId: 'worker-one', title: 'Remember-me login', status: 'completed', memberRole: 'worker', current: true }];
  task.delivery.artifacts = [{ path: 'src/login.js', size: 120, sha256: 'a', type: 'file', workstreamId: 'work-one', delegationRef: 'actual-assignment' },
    { path: 'src/login.test.js', size: 80, sha256: 'b', type: 'file', workstreamId: 'work-one', delegationRef: 'actual-assignment' }];
  task.delivery.pages = [];
  const diff = ['diff --git a/src/login.js b/src/login.js', 'index 1..2 100644', '--- a/src/login.js', '+++ b/src/login.js', '@@ -1,2 +1,3 @@', ' const a = 1;', '-const b = 2;', '+const b = 3;', '+const remember = true;',
    'diff --git a/src/new.js b/src/new.js', 'new file mode 100644', '--- /dev/null', '+++ b/src/new.js', '@@ -0,0 +1 @@', '+export {};', ''].join('\n');
  const b = bench({ cards: [task], rpcOverride: method => method === 'diff' ? { ok: true, value: { worker: { cwd: 'C:/workspace/real', mode: 'existing' },
    snapshot: { isGit: true, diff, truncated: false, files: [{ path: 'src/login.js', status: ' M' }, { path: 'src/new.js', status: 'A ' }, { path: 'notes.txt', status: '??' }] } } } : undefined });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver();
    const card = await b.openRequest(task.id, false); await b.flush();
    const delivery = card.querySelector('.dsh-project-task-delivery'); assert.ok(delivery && isVisible(delivery));
    assert.deepEqual([...delivery.querySelectorAll('.dsh-project-task-file')].map(item => item.getAttribute('title')), ['src/login.js', 'src/login.test.js']);
    await b.press('viewChanges'); await b.flush();
    const files = [...b.document.querySelectorAll('.dsh-project-diff-file')];
    assert.deepEqual(files.map(item => item.dataset.diffPath), ['src/login.js', 'src/new.js', 'notes.txt']);
    assert.match(files[0].querySelector('summary').textContent, /diff_modified.*\+2.*−1/s);
    assert.match(files[1].querySelector('summary').textContent, /diff_added/);
    assert.match(files[2].textContent, /diff_untracked.*diffUntrackedHint/s);
    assert.deepEqual([...files[0].querySelectorAll('.dsh-project-diff-line')].map(line => line.dataset.kind), ['hunk', 'context', 'del', 'add', 'add']);
    assert.match(b.document.querySelector('.dsh-project-diff-summary').textContent, /diffFileCount.*\+3.*−1/s);
    assert.match(b.dialog().textContent, /diffScope/);
    // Opening a file contracts the observer for the native preview, so it comes last.
    await b.press('openFile: login.js');
    const opened = b.requests.filter(request => request.method === 'open').at(-1).input;
    assert.equal(opened.workstreamId, 'work-one'); assert.equal(opened.delegationRef, 'actual-assignment'); assert.equal(opened.path, 'src/login.js');
  } finally { await b.dispose(); }
});

test('a delivered requirement shows its own changes, reverts after confirmation and hands a conflicting revert to the coordinator', async () => {
  const task = taskCard('delivered-changes', 'Login remember me', 'completed');
  task.work = [{ workstreamId: 'work-one', delegationRef: 'actual-assignment', workerSessionId: 'worker-one', title: 'Remember-me login', status: 'completed', memberRole: 'worker', current: true }];
  task.changes = { isGit: true, revertible: true, fileCount: 2, added: 4, removed: 1 };
  let conflict = true;
  const diff = ['diff --git a/src/login.js b/src/login.js', '--- a/src/login.js', '+++ b/src/login.js', '@@ -1 +1,2 @@', '-old', '+new', '+remember', ''].join('\n');
  const b = bench({ cards: [task], rpcOverride: (method, input) => method === 'requests/changes'
    ? { ok: true, value: { files: [{ path: 'src/login.js', status: 'M', added: 2, removed: 1 }, { path: 'assets/logo.png', status: 'A', added: 0, removed: 0, binary: true }], diff, truncated: false, final: true } }
    : method === 'requests/revert' ? conflict ? { ok: false, error: { code: 'revert_conflict', message: 'error: patch failed: src/login.js:1' } } : { ok: true, value: { requestId: input.requestId, reverted: true } } : undefined });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver();
    const card = await b.openRequest(task.id, false); await b.flush();
    assert.match(card.querySelector('.dsh-project-task-changes').textContent, /changeStats.*\+4.*−1/s);
    await b.press('viewChanges'); await b.flush();
    assert.equal(b.requests.filter(request => request.method === 'requests/changes').at(-1).input.requestId, task.id);
    assert.match(b.document.querySelector('[data-request-diff]').textContent, /requestDiffScope/);
    assert.deepEqual([...b.document.querySelectorAll('.dsh-project-diff-file')].map(item => item.dataset.diffPath), ['src/login.js', 'assets/logo.png']);
    assert.match(b.document.querySelector('[data-diff-path="assets/logo.png"]').textContent, /diff_added.*diffBinary/s);
    await b.press('revertChanges');
    assert.ok(b.document.querySelector('[role=dialog][aria-label=revertTitle]'));
    assert.equal(b.requests.some(request => request.method === 'requests/revert'), false, 'revert waits for confirmation');
    await b.press('revertConfirm');
    assert.deepEqual({ ...b.requests.filter(request => request.method === 'requests/revert').at(-1).input }, { projectId: b.project.id, requestId: task.id, requestRevision: 1 });
    const conflictDialog = b.document.querySelector('[role=dialog][aria-label=revertConflictTitle]'); assert.ok(conflictDialog);
    assert.match(conflictDialog.textContent, /patch failed: src\/login\.js/);
    await b.press('revertAsk');
    assert.deepEqual(b.sent.map(item => item.text), ['revertAskPrompt']);
    assert.equal(b.document.querySelector('[role=dialog][aria-label=revertConflictTitle]') === null, true);
    conflict = false;
    await b.press('revertChanges'); await b.press('revertConfirm'); await b.flush();
    assert.equal(b.requests.filter(request => request.method === 'requests/revert').length, 2);
    assert.ok([...b.document.querySelectorAll('[role=alert]')].some(item => item.textContent === 'revertDone'));
  } finally { await b.dispose(); }
});

test('requirement diffs distinguish same-named files in actual workspaces and report a partial revert without claiming no changes', async () => {
  const task = taskCard('multi-directory-changes', 'Primary and isolated results', 'completed');
  task.changes = { isGit: true, revertible: true, fileCount: 3, added: 3, removed: 1 };
  const patch = value => ['diff --git a/result.txt b/result.txt', '--- a/result.txt', '+++ b/result.txt', '@@ -1 +1 @@', '-old', `+${value}`, ''].join('\n');
  const partial = 'Isolated file is locked. Reverted directories: C:/workspace/real. Not reverted: C:/profile/project-worktrees/isolated. Retry touches only the remaining directory.';
  const b = bench({ cards: [task], rpcOverride: method => method === 'requests/changes' ? { ok: true, value: { final: true, files: [], diff: '', workspaces: [
    { workingDirectory: 'C:/workspace/real', files: [{ path: 'result.txt', status: 'M', added: 1, removed: 1 }], diff: patch('primary') },
    { workingDirectory: 'C:/profile/project-worktrees/isolated', files: [{ path: 'result.txt', status: 'M', added: 1, removed: 1 }, { path: 'binary.png', status: 'A', added: 0, removed: 0, binary: true }], diff: patch('isolated') },
  ] } } : method === 'requests/revert' ? { ok: false, error: { code: 'revert_partial', message: partial } } : undefined });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver();
    await b.openRequest(task.id, false); await b.flush(); await b.press('viewChanges'); await b.flush();
    const files = [...b.document.querySelectorAll('.dsh-project-diff-file')];
    assert.deepEqual(files.map(file => [file.dataset.diffDirectory, file.dataset.diffPath]), [
      ['C:/workspace/real', 'result.txt'], ['C:/profile/project-worktrees/isolated', 'result.txt'], ['C:/profile/project-worktrees/isolated', 'binary.png'],
    ]);
    assert.match(files[0].textContent, /result\.txt · …\/real.*\+primary/s);
    assert.match(files[1].textContent, /result\.txt · …\/isolated.*\+isolated/s);
    assert.equal(files[2].querySelector('.dsh-project-diff-name').title, 'diffWorkingDirectory: C:/profile/project-worktrees/isolated\ndiffRepositoryPath: binary.png');
    await b.press('revertChanges'); await b.press('revertConfirm'); await b.flush();
    assert.equal(b.document.querySelector('[role=dialog][aria-label=revertTitle]'), null);
    assert.equal(b.document.querySelector('[role=dialog][aria-label=revertConflictTitle]'), null);
    assert.ok([...b.document.querySelectorAll('[role=alert]')].some(item => item.textContent === partial));
    assert.doesNotMatch(visibleText(b.document.body), /revertConflictBody|revertDone/, 'a partially applied revert is neither an all-or-nothing conflict nor success');
  } finally { await b.dispose(); }
});

test('a requirement bound to a repository subdirectory keeps repository-relative paths separate from its workspace label', async () => {
  const task = taskCard('subdirectory-changes', 'App directory result', 'completed');
  task.changes = { isGit: true, revertible: true, fileCount: 1, added: 1, removed: 0 };
  const diff = ['diff --git a/app/result.txt b/app/result.txt', 'new file mode 100644', '--- /dev/null', '+++ b/app/result.txt', '@@ -0,0 +1 @@', '+result', ''].join('\n');
  const b = bench({ cards: [task], rpcOverride: method => method === 'requests/changes' ? { ok: true, value: { final: true,
    workspaces: [{ workingDirectory: 'C:/repo/app', files: [{ path: 'app/result.txt', status: 'A', added: 1, removed: 0 }], diff }] } } : undefined });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver();
    await b.openRequest(task.id, false); await b.flush(); await b.press('viewChanges'); await b.flush();
    const file = b.document.querySelector('.dsh-project-diff-file');
    assert.equal(file.dataset.diffPath, 'app/result.txt'); assert.equal(file.dataset.diffDirectory, 'C:/repo/app');
    const name = file.querySelector('.dsh-project-diff-name');
    assert.equal(name.textContent, 'app/result.txt · …/app');
    assert.equal(name.title, 'diffWorkingDirectory: C:/repo/app\ndiffRepositoryPath: app/result.txt');
    assert.doesNotMatch(file.textContent + name.title, /C:\/repo\/app\/app\/result\.txt/, 'the workspace cwd is not the repository-relative path root');
    assert.match(file.textContent, /\+result/);
  } finally { await b.dispose(); }
});

test('diff scope labels use unique directory suffixes when final components match and preserve roots', async () => {
  const task = taskCard('matching-directory-names', 'Distinct app scopes', 'completed');
  task.changes = { isGit: true, revertible: true, fileCount: 4, added: 4, removed: 0 };
  const directories = ['C:/repo/primary/app', 'C:/repo/isolated/app', 'C:\\', '/'];
  const b = bench({ cards: [task], rpcOverride: method => method === 'requests/changes' ? { ok: true, value: { final: true,
    workspaces: directories.map(workingDirectory => ({ workingDirectory, files: [{ path: 'result.txt', status: 'A', added: 1, removed: 0 }], diff: '' })) } } : undefined });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver();
    await b.openRequest(task.id, false); await b.flush(); await b.press('viewChanges'); await b.flush();
    const names = [...b.document.querySelectorAll('.dsh-project-diff-name')];
    assert.deepEqual(names.map(name => name.textContent), ['result.txt · …/primary/app', 'result.txt · …/isolated/app', 'result.txt · C:\\', 'result.txt · /']);
    assert.deepEqual(names.map(name => name.title), directories.map(directory => `diffWorkingDirectory: ${directory}\ndiffRepositoryPath: result.txt`));
    assert.deepEqual([...b.document.querySelectorAll('.dsh-project-diff-file')].map(file => file.dataset.diffPath), directories.map(() => 'result.txt'));
  } finally { await b.dispose(); }
});

test('notes show the Project decision log without its internal markers', async () => {
  const b = bench({ rpcOverride: (method, input, _project, stored) => {
    if (method === 'store/read' && input.path === 'decisions.md') stored['decisions.md'] = '# 决策日志\n\n## 2026-10-16 · Remember me（第 1 版）\n<!-- decision:delivery-a -->\n- 结果：完整交付\n- 决策：Use an HttpOnly cookie.\n';
  } });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.press('materials'); await b.flush(); await b.press('notes'); await b.flush();
    await b.disclose('decisionLog');
    const log = b.document.querySelector('[data-decision-log]');
    assert.match(log.textContent, /Use an HttpOnly cookie/); assert.doesNotMatch(log.textContent, /decision:delivery-a|# 决策日志/);
  } finally { await b.dispose(); }
});

test('a queued requirement that is already investigating says so while development still waits', async () => {
  const current = taskCard('active-a', 'Current A'), next = taskCard('queued-b', 'Queued B');
  current.queue = { state: 'active', released: false }; next.queue = { state: 'queued', position: 1 };
  next.workPreview = [{ workstreamId: 'work-b', delegationRef: 'b-read', title: 'Investigate B', status: 'running', memberName: 'member-b', workerSessionId: 'worker-b' }];
  next.work = [{ ...next.workPreview[0], memberRole: 'readonly', current: true }];
  const b = bench({ cards: [current, next], queue: { active: current, queued: [{ ...next, position: 1 }], paused: false } });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.openObserver();
    const card = await b.openRequest(next.id, false);
    assert.match(visibleText(card.querySelector('.dsh-project-task-state')), /statusQueued/);
    assert.match(visibleText(card.querySelector('.dsh-project-task-next')), /nextStep.*nextQueuedPreparing/s);
  } finally { await b.dispose(); }
});
