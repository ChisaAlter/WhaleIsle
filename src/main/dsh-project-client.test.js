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

// The shipped browser module executes in a VM, but its components and hooks
// use real React and DOM events. Host RPC, slots and primitive appearance are
// the boundaries substituted here; model execution and desktop UI are separate.
function bench({ available = true, rejectCreation = false, detail = {}, rpcOverride, approvalActive = false } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main></main></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const savedGlobals = Object.fromEntries(['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const { createRoot } = clientRequire('react-dom/client');
  let registration, directoryAction, timer, root;
  const cleanups = [], entries = [], requests = [], navigation = [], retained = [], released = [], opened = [], sent = [], events = new Map();
  const project = { id: 'project-one', title: 'Project', coordinatorSessionId: 'coordinator-existing', workspaceId: 'workspace-existing',
    storageRoot: 'C:/profile/projects/project-one', canonicalWorkingDirectory: 'C:/workspace/real', lifecycle: 'ready', paused: false, diagnostics: [], activity: detail?.activity ?? { running: 0, blocked: 0, queued: 0, state: 'idle' } };
  const notesMarker = '<!-- whale-project:user-notes -->', generatedNotes = '# Generated current work records';
  const stored = { 'notes.md': `${generatedNotes}\n${notesMarker}\nInitial notes`, 'preferences.md': 'Initial preferences', 'docs/report.md': 'Saved report' };
  const eventSource = projection({ entries: [...Array.from({ length: 60 }, (_, index) => turnRecord(index + 21)), ...toolRecords], hasMore: true, revision: 1 });
  const session = projection({ openState: 'open', openError: null });
  session.loadOlder = async () => { const previous = eventSource.getSnapshot(); eventSource.set({ entries: [...Array.from({ length: 20 }, (_, index) => turnRecord(index + 1)), ...previous.entries], hasMore: false, revision: 2 }); };
  const binding = { eventSource, session };
  const sandbox = { window: { __ModuleLoader__: { load: value => { registration = value; } } },
    globalThis: { crypto: { randomUUID } }, document: dom.window.document, setInterval: callback => { timer = callback; return 1; }, clearInterval() {} };
  vm.runInNewContext(fs.readFileSync(clientPath, 'utf8'), sandbox, { filename: clientPath });
  const Button = ({ variant, children, ...props }) => h('button', { type: 'button', ...props }, children);
  const Modal = ({ open, title, closeLabel, onClose, children, footer }) => !open ? null : h('section', { role: 'dialog', 'aria-label': title },
    h('button', { type: 'button', 'aria-label': closeLabel, onClick: onClose }, closeLabel), children, footer);
  const TaskDock = ({ title, summary, children, testId }) => { const [expanded, setExpanded] = React.useState(false); return h('section', { 'data-testid': testId }, h('button', { 'aria-expanded': expanded, onClick: () => setExpanded(!expanded) }, title), h('span', null, summary), expanded ? children : null); };
  const Menu = ({ open, anchor, items, onSelect }) => h(React.Fragment, null, anchor, open ? h('div', { role: 'menu' }, items.map(item => h('button', { key: item.id, role: 'menuitem', onClick: () => onSelect(item.id) }, item.label))) : null);
  const SegmentedTabs = ({ items, value, onChange, label }) => h('div', { role: 'tablist', 'aria-label': label }, items.map(item => h('button', {
    key: item.value, id: item.id, role: 'tab', 'aria-selected': item.value === value, 'aria-controls': item.panelId, onClick: () => onChange(item.value),
  }, item.label)));
  const primitives = { Button, Modal, TaskDock, Menu, SegmentedTabs, Input: props => h('input', props), IconChevronDownOutlineRegular: () => null, IconChevronRightOutlineRegular: () => null, Pill: ({ children }) => h('span', null, children), MarkdownText: ({ text }) => h('div', { 'data-markdown': true }, text), IconFolderCloseRegular: () => h('span', { 'aria-hidden': true }) };
  const plugin = registration.factory(spec => {
    if (spec === 'react') return React;
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
    locale: { bind: () => key => key, register: () => () => {}, subscribe: () => () => {} },
    slots: { inject: (_key, install) => install(), register: (options, component) => { const entry = { options, component, active: true }; entries.push(entry); return () => { entry.active = false; }; } },
    workspaces: { create: async input => { requests.push({ method: 'workspace/create', input }); return { path: project.canonicalWorkingDirectory, workspaceId: project.workspaceId }; }, openPath: async (path, options) => opened.push({ path, options }) },
    uiWorkspace: { registerDirectoryAction: action => { directoryAction = action; return () => { directoryAction = undefined; }; }, openSession: id => navigation.push(['session', id]) },
    uiSidebar: { selectTab: id => navigation.push(['tab', id]) },
    settingsNavigation: { open: id => navigation.push(['settings', id]) },
    sessions: { scope: sessionId => ({ get: name => { assert.equal(name, 'conversation'); return { send: async text => sent.push({ sessionId, text }) }; } }), list: projection({ byId: { [project.coordinatorSessionId]: { id: project.coordinatorSessionId, retainedBy: { mainView: 1 } } } }), retain: (address, options) => { retained.push({ address, options }); return { ready: Promise.resolve(binding), release: () => released.push(address.childSessionId) }; } },
    connection: { rpc: { call: async (prefix, method, input) => {
      assert.equal(prefix, '/dsh-project'); requests.push({ method, input });
      const override = rpcOverride?.(method, input, project, stored);
      if (override !== undefined) return await override;
      if (method === 'list') return { ok: true, value: { projects: [], available } };
      if (method === 'create') return rejectCreation ? { ok: false, error: { code: 'project/rejected', message: 'Creation failed' } } : { ok: true, value: { project, reused: true } };
      if (method === 'detail') return { ok: true, value: { project, workstreams: [], workers: [], revision: 'revision-1', ...detail, ...(detail?.workstreams ? { workstreams: detail.workstreams.map(({ latestReport, ...work }) => ({ ...work, hasReport: Boolean(latestReport) })) } : {}) } };
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
      throw new Error(`Unexpected method ${method}`);
    } } },
  };
  plugin.apply(ctx);
  const overlay = () => entries.find(entry => entry.options.name === 'shell.overlay');
  const face = () => overlay().options.inject();
  const selectHook = source => selector => selector(useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot));
  function Slot({ entry }) {
    const injected = entry.options.inject(), store = entry.options.store?.create();
    const matched = entry.options.select?.({ sessionId: project.coordinatorSessionId });
    if (entry.options.select && matched === null) return null;
    return h(entry.component, { ...injected, useProjects: selectHook(injected.hooks.projects), useProjectSessions: selectHook(injected.hooks.projectSessions),
      ...(store ? { useStore: selectHook(store), actions: store.actions } : {}), matched, sessionId: project.coordinatorSessionId, wide: true, t: key => key });
  }
  const render = () => root.render(h(React.Fragment, null, entries.filter(entry => entry.active && entry.options.name !== 'sidebar.nav.tab'
    && (approvalActive ? !['conversation.input.right', 'conversation.input.dock'].includes(entry.options.name) : entry.options.name !== 'conversation.approval.actions')).map(entry => h(Slot, { key: `${entry.options.name}:${entry.options.id}`, entry }))));
  const flush = async () => { await act(async () => { await new Promise(resolve => setImmediate(resolve)); }); };
  const findButton = label => [...dom.window.document.querySelectorAll('button')].find(element => element.textContent === label || element.getAttribute('aria-label') === label);
  return { entries, requests, navigation, retained, released, opened, sent, eventSource, session, stored, project, face, document: dom.window.document,
    get action() { return directoryAction; }, flush,
    mount: async () => { root = createRoot(dom.window.document.querySelector('main')); await act(async () => { render(); }); },
    render: async () => { await act(async () => { render(); }); },
    press: async label => { const target = findButton(label); assert.ok(target, `Missing button ${label}`); await act(async () => { target.click(); await new Promise(resolve => setImmediate(resolve)); }); },
    disclose: async label => { const target = [...dom.window.document.querySelectorAll('summary')].find(element => element.textContent === label); assert.ok(target, `Missing disclosure ${label}`); await act(async () => { target.click(); await new Promise(resolve => setTimeout(resolve, 10)); }); },
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
    assert.deepEqual(b.requests.filter(request => ['workspace/create', 'create'].includes(request.method)).map(request => request.method), ['create']);
    const creation = b.requests.find(request => request.method === 'create'); assert.equal(creation.input.workingDirectory, 'C:/workspace/alias'); assert.ok(creation.input.requestId);
    assert.deepEqual(b.navigation, [['tab', 'sessions'], ['session', 'coordinator-existing']]);
    await b.mount(); assert.equal(b.document.querySelector('[data-testid=project-progress]'), null); assert.ok(b.document.querySelector('.dsh-project-empty'));
    assert.equal(b.requests.some(request => ['delegate', 'prompt', 'message', 'store/write'].includes(request.method)), false);
    await b.adopt(); assert.equal(b.entries.filter(entry => entry.options.name === 'sidebar.workspaces.sections').length, 1); assert.deepEqual(b.navigation.at(-1), ['session', 'coordinator-existing']);
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

const workDetail = () => ({ activity: { running: 1, blocked: 0, queued: 0, state: 'running' }, workPage: { currentTotal: 1, currentCursor: null, currentNextCursor: null, historyTotal: 0 }, workstreams: [{ id: 'work-one', title: 'Implement feature', group: 'current', status: 'running', workerSessionId: 'worker-one', currentDelegationRef: 'actual-assignment', pendingSummary: true, latestReport: {
  delegationRef: 'actual-assignment', outcome: 'completed', at: 1000, summary: 'Actual worker summary', artifacts: [{ path: 'src/app.js', size: 3, sha256: '123', type: 'file' }], evidence: ['Worker ran the targeted command'], remainingIssues: ['An actual integration check remains'],
} }], workers: [{ sessionId: 'worker-one', workstreamId: 'work-one', role: 'worker', mode: 'existing', phase: 'active', activeRunId: 'run-one', cwd: 'C:/workspace/real' }] });

test('progress prioritizes unresolved and current work while older results and metadata open explicitly', async () => {
  const detail = { activity: { running: 1, blocked: 1, queued: 1, state: 'blocked' }, workPage: { currentTotal: 3, currentCursor: null, currentNextCursor: null, historyTotal: 5 }, workstreams: [], workers: [] };
  for (let index = 0; index < 5; index++) {
    detail.workstreams.push({ id: `result-${index}`, title: `Finished ${index}`, group: 'history', status: 'done', updatedAt: index, latestReport: { delegationRef: `history-${index}`, outcome: 'completed', at: index + 1, summary: `Historical report ${index}`, artifacts: [] } });
  }
  for (const [id, status, phase, updatedAt] of [['active', 'running', 'active', 8], ['blocked', 'blocked', 'idle', 7], ['queued', 'open', 'queued', 9]]) {
    detail.workstreams.push({ id, title: `Current ${id}`, group: 'current', status, updatedAt, workerSessionId: `worker-${id}`, currentDelegationRef: `report-${id}`, delegation: { phase }, latestReport: { delegationRef: `report-${id}`, outcome: 'completed', at: updatedAt, summary: `Report ${id}`, artifacts: [] } });
    detail.workers.push({ sessionId: `worker-${id}`, workstreamId: id, role: 'worker', mode: 'existing', phase, cwd: `C:/workspace/${id}`, ...(phase === 'active' ? { activeRunId: 'real-active-run' } : {}) });
  }
  const older = detail.workstreams.slice(0, 2).reverse();
  detail.workstreams = ['blocked', 'active', 'queued', 'result-4', 'result-3', 'result-2'].map(id => detail.workstreams.find(work => work.id === id));
  const b = bench({ detail, rpcOverride: (method, input) => method === 'workstreams/list' ? { ok: true, value: { workstreams: older, workers: [], total: 5, nextCursor: null } } : undefined });
  try {
    await b.flush(); await b.adopt(); await b.mount();
    const dock = b.document.querySelector('[data-testid=project-progress]');
    assert.equal(dock.querySelectorAll('[data-workstream-id]').length, 0);
    assert.match(dock.textContent, /1 · blocked · 1 · running/);
    assert.equal(b.requests.some(request => request.method === 'workstreams/get' || request.method === 'workstreams/list'), false);
    await b.press('progress');
    assert.deepEqual([...dock.querySelectorAll('[data-workstream-id]')].map(row => row.dataset.workstreamId), ['blocked', 'active', 'queued', 'result-4', 'result-3', 'result-2']);
    assert.doesNotMatch(dock.textContent, /Historical report|C:\/workspace|Report active|Finished 0|Finished 1/);
    assert.equal(b.button('viewProcess'), undefined);
    await b.disclose('workDetails');
    const execution = [...dock.querySelectorAll('details')].find(element => element.querySelector('summary')?.textContent === 'executionInfo');
    assert.equal(execution.open, false); assert.ok(b.button('viewProcess')); assert.doesNotMatch(dock.textContent, /Report blocked/);
    await b.disclose('executionInfo'); assert.equal(execution.open, true); assert.match(execution.textContent, /C:\/workspace\/blocked/);
    await b.press('viewResult'); await b.flush(); assert.match(b.document.querySelector('[role=dialog]').textContent, /Report blocked/); await b.press('close');
    await b.disclose('earlierWork (2)');
    assert.deepEqual({ ...b.requests.find(request => request.method === 'workstreams/list').input }, { projectId: 'project-one', kind: 'history', cursor: 'result-2' });
    assert.deepEqual([...dock.querySelectorAll('[data-workstream-id]')].map(row => row.dataset.workstreamId), ['blocked', 'active', 'queued', 'result-4', 'result-3', 'result-2', 'result-1', 'result-0']);
    assert.doesNotMatch(dock.textContent, /Historical report/);
    await b.disclose('earlierWork (2)');
    assert.equal(dock.querySelector('[data-workstream-id=result-0]'), null);
  } finally { await b.dispose(); }
});

test('open history keeps its page across revisions and discards a slower obsolete refresh', async () => {
  const recent = Array.from({ length: 3 }, (_, index) => ({ id: `recent-${index}`, title: `Recent ${index}`, status: 'done', group: 'history' }));
  const detail = { revision: 'history-1', workstreams: recent, workers: [], workPage: { currentTotal: 0, historyTotal: 44 } };
  let releaseOld;
  const b = bench({ detail, rpcOverride: (method, input, project) => {
    if (method === 'list') return { ok: true, value: { projects: [project], available: true } };
    if (method !== 'workstreams/list') return;
    const value = { cursor: input.cursor ?? null, workstreams: [{ id: 'older-work', title: `Evidence ${detail.revision}`, status: 'done', group: 'history' }], workers: [], total: 44, nextCursor: input.cursor === 'recent-2' ? 'page-two' : null };
    if (detail.revision === 'history-2') return new Promise(resolve => { releaseOld = () => resolve({ ok: true, value }); });
    return { ok: true, value };
  } });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.press('progress'); await b.disclose('earlierWork (41)'); await b.press('next');
    const history = b.document.querySelector('.dsh-project-work-history');
    detail.revision = 'history-2'; await b.poll(); assert.equal(typeof releaseOld, 'function');
    detail.revision = 'history-3'; await b.poll(); await b.flush();
    assert.equal(history.open, true); assert.match(history.textContent, /Evidence history-3/);
    assert.equal(b.requests.filter(request => request.method === 'workstreams/list').at(-1).input.cursor, 'page-two');
    await act(async () => { releaseOld(); await new Promise(resolve => setImmediate(resolve)); });
    assert.match(history.textContent, /Evidence history-3/); assert.doesNotMatch(history.textContent, /Evidence history-2/);
    assert.equal(b.button('previous').disabled, false);
  } finally { await b.dispose(); }
});

test('continuing the history anchor resets to the real backend first page without stale work or a retry', async () => {
  const { ProjectService } = await import('../../vendor/dsh-project/lib/service.js');
  const host = Object.create(ProjectService.prototype);
  const works = Array.from({ length: 26 }, (_, index) => ({ id: `history-${index}`, projectId: 'project-one', title: `Saved ${index}`, status: 'done', group: 'history' }));
  host.workRows = async () => works.map(work => ({ work, status: work.status, group: work.group, jobs: [] }));
  const detail = { revision: 'anchor-1', workstreams: works.slice(0, 3), workers: [], workPage: { currentTotal: 0, historyTotal: 26 } };
  const b = bench({ detail, rpcOverride: (method, input, project) => {
    if (method === 'list') return { ok: true, value: { projects: [project], available: true } };
    if (method === 'workstreams/list') return host.listWorkstreams('project-one', input).then(value => ({ ok: true, value }));
  } });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.press('progress'); await b.disclose('earlierWork (23)'); await b.press('next');
    const history = b.document.querySelector('.dsh-project-work-history');
    assert.match(history.textContent, /Saved 25/);
    Object.assign(works[22], { status: 'running', group: 'current' });
    detail.revision = 'anchor-2'; detail.workstreams = [works[22], ...works.slice(0, 3)]; detail.workPage = { currentTotal: 1, historyTotal: 25 };
    const before = b.requests.filter(request => request.method === 'workstreams/list').length;
    await b.poll(); await b.flush();
    assert.equal(history.open, true); assert.doesNotMatch(history.textContent, /Saved 22|does not belong/);
    assert.match(history.textContent, /Saved 0/); assert.equal(history.querySelectorAll('[data-workstream-id]').length, 20);
    assert.equal(b.requests.filter(request => request.method === 'workstreams/list').length, before + 1, 'backend reset consumes its returned first page without retrying');
    assert.equal(b.button('previous'), undefined); assert.equal(b.button('next').disabled, false);
    await assert.rejects(host.listWorkstreams('project-one', { kind: 'history', cursor: 'foreign-work' }), { code: 'work_cursor' });
  } finally { await b.dispose(); }
});

test('a single current work title is visible on the collapsed progress line', async () => {
  const b = bench({ detail: workDetail() });
  try {
    await b.flush(); await b.adopt(); await b.mount();
    const dock = b.document.querySelector('[data-testid=project-progress]');
    assert.match(dock.textContent, /Implement feature · 1 · running/);
    assert.equal(b.button('progress').getAttribute('aria-expanded'), 'false');
    assert.doesNotMatch(dock.textContent, /Actual worker summary|C:\/workspace/);
  } finally { await b.dispose(); }
});

test('current work pages replace the visible window and polling keeps the selected cursor and aggregate attention', async () => {
  const workstreams = Array.from({ length: 41 }, (_, index) => ({ id: `work-${index}`, title: `Current work ${index}`, group: 'current', status: index === 0 ? 'blocked' : 'running' }));
  const b = bench({ detail: { workstreams, workers: [] }, rpcOverride: (method, input, project) => {
    project.activity = { running: 40, blocked: 1, queued: 0, state: 'blocked' };
    if (method === 'list') return { ok: true, value: { projects: [project], available: true } };
    if (method !== 'detail') return;
    const start = input.currentCursor === 'work-19' ? 20 : input.currentCursor === 'work-39' ? 40 : 0;
    const page = workstreams.slice(start, start + 20);
    return { ok: true, value: { project, workstreams: page, workers: [], revision: `revision-${start}`, workPage: {
      currentTotal: 41, currentCursor: input.currentCursor ?? null, currentNextCursor: start + page.length < 41 ? page.at(-1).id : null, historyTotal: 0,
    } } };
  } });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.press('progress');
    const dock = b.document.querySelector('[data-testid=project-progress]');
    const visible = () => [...dock.querySelectorAll('[data-workstream-id]')].map(row => row.dataset.workstreamId);
    assert.deepEqual(visible(), workstreams.slice(0, 20).map(work => work.id));
    await b.press('next'); assert.deepEqual(visible(), workstreams.slice(20, 40).map(work => work.id));
    await b.press('next'); assert.deepEqual(visible(), ['work-40']);
    assert.match(dock.textContent, /1 · blocked · 40 · running/);
    await b.poll(); assert.equal(b.requests.filter(request => request.method === 'detail').at(-1).input.currentCursor, 'work-39');
    assert.deepEqual(visible(), ['work-40']);
    await b.press('previous'); assert.deepEqual(visible(), workstreams.slice(20, 40).map(work => work.id));
    await b.press('previous'); assert.deepEqual(visible(), workstreams.slice(0, 20).map(work => work.id));
    assert.equal(b.button('previous'), undefined);
  } finally { await b.dispose(); }
});

test('stopped work remains inspectable without a failure or a promised automatic summary', async () => {
  const detail = workDetail();
  Object.assign(detail.workstreams[0], { status: 'blocked', blockedReason: 'stopped' });
  Object.assign(detail.workers[0], { phase: 'idle', stopped: true, activeRunId: '' });
  const b = bench({ detail });
  try {
    b.project.paused = true;
    await b.flush(); await b.adopt(); await b.mount(); await b.press('progress');
    const dock = b.document.querySelector('[data-testid=project-progress]');
    assert.match(dock.textContent, /paused/); assert.match(dock.textContent, /resumeHint/);
    assert.doesNotMatch(dock.textContent, /pendingSummary|blocked|stopped/);
    assert.equal(dock.querySelector('.dsh-project-error'), null);
    await b.disclose('workDetails'); await b.press('viewProcess'); assert.ok(b.retained.length);
  } finally { await b.dispose(); }
});

test('an individual worker remains stopping until its actual drain finishes', async () => {
  const detail = workDetail(); Object.assign(detail.workers[0], { phase: 'stopping', stopped: true });
  const b = bench({ detail, rpcOverride: (method, _input, project) => method === 'list' ? { ok: true, value: { projects: [project], available: true } } : undefined });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.press('progress');
    const heading = b.document.querySelector('[data-workstream-id=work-one] .dsh-project-work-heading');
    assert.match(heading.textContent, /stopping/); assert.doesNotMatch(heading.textContent, /paused|done|failed/);
    Object.assign(detail.workers[0], { phase: 'idle', activeRunId: '' }); detail.workstreams[0].status = 'blocked';
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
    const b = bench({ detail });
    try {
      await b.flush(); await b.adopt(); await b.mount(); await b.press('progress');
      const state = b.document.querySelector('[data-workstream-id=work-one] .dsh-project-work-heading span');
      assert.equal(state.textContent, stage.expected); assert.equal(work.pendingSummary, true); assert.equal(work.latestReport.delegationRef, 'actual-assignment');
      assert.equal(b.sent.length, 0); assert.equal(b.requests.some(request => ['delegate', 'resume', 'store/write'].includes(request.method)), false);
    } finally { await b.dispose(); }
  }
});

test('background process renders real Session records in pages and never opens a worker chat or input', async () => {
  const b = bench({ detail: workDetail() });
  try {
    const emptyRecords = [turnRecord(83), turnRecord(84)];
    emptyRecords[0].event.data.message.content = []; emptyRecords[1].event.data.message.content = [{ type: 'text', text: ' \n\t ' }];
    b.eventSource.set({ ...b.eventSource.getSnapshot(), entries: [...b.eventSource.getSnapshot().entries, ...emptyRecords], revision: 2 });
    await b.flush(); await b.adopt(); await b.mount(); await b.press('progress');
    await b.disclose('workDetails');
    const heading = b.document.querySelector('[data-workstream-id=work-one] .dsh-project-work-heading'); assert.match(heading.textContent, /running/); assert.doesNotMatch(heading.textContent, /pendingSummary/);
    await b.press('viewResult'); await b.flush(); assert.match(b.document.querySelector('[role=dialog]').textContent, /An actual integration check remains/); await b.press('close');
    const navigation = b.navigation.length;
    await b.press('viewProcess'); await b.flush();
    assert.equal(b.retained[0].address.parentSessionId, 'coordinator-existing'); assert.equal(b.retained[0].address.childSessionId, 'worker-one'); assert.equal(b.retained[0].address.mode, 'continuable');
    assert.equal(b.document.querySelector('[role=dialog]').querySelectorAll('textarea,input').length, 0); assert.equal(b.navigation.length, navigation);
    assert.match(b.document.body.textContent, /Worker record 80/); assert.match(b.document.body.textContent, /actual repository content/);
    const dialog = b.document.querySelector('[role=dialog]');
    assert.equal(dialog.querySelectorAll('[data-markdown]').length, 46); assert.equal(dialog.querySelectorAll('.dsh-project-record-row').length, 48);
    const assistantRows = [...dialog.querySelectorAll('.dsh-project-record-row')].filter(row => row.querySelector('strong')?.textContent === 'assistant');
    assert.equal(assistantRows.length, 46); assert.ok(assistantRows.every(row => row.querySelector('[data-markdown]')?.textContent.trim()));
    assert.match(dialog.textContent, /Worker record 35/); assert.doesNotMatch(dialog.textContent, /Worker record 34/);
    const toolCall = [...dialog.querySelectorAll('details')].find(row => row.querySelector('summary')?.textContent === 'tool: read_file');
    assert.equal(toolCall.querySelector('pre').textContent, '{"path":"src/app.js"}');
    await b.press('previous'); assert.match(b.document.body.textContent, /Worker record 21/); assert.match(dialog.textContent, /Worker record 34/); assert.doesNotMatch(dialog.textContent, /Worker record 35|Worker record 80/);
    await b.press('older'); assert.match(b.document.querySelector('[role=dialog]').textContent, /Worker record 1/);
    await b.press('close'); assert.deepEqual(b.released, ['worker-one']); assert.equal(b.navigation.length, navigation);
    assert.deepEqual(b.eventSource.getSnapshot().entries.slice(-2), emptyRecords);
    assert.equal(b.requests.some(request => ['delegate', 'message', 'prompt'].includes(request.method)), false);
  } finally { await b.dispose(); }
});

test('registered artifacts open in the application under their authorized directory and non-Git diff stays explicit', async () => {
  const b = bench({ detail: workDetail() });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.press('progress');
    await b.disclose('workDetails');
    await b.press('viewResult'); await b.flush();
    await b.press('openFile: app.js'); const artifact = b.requests.filter(request => request.method === 'open').at(-1); assert.equal(artifact.input.workstreamId, 'work-one'); assert.equal(artifact.input.path, 'src/app.js'); assert.equal(artifact.input.delegationRef, 'actual-assignment');
    assert.equal(b.opened[0].path, 'C:/workspace/real/src/app.js');
    assert.equal(b.opened[0].options.sessionId, 'coordinator-existing'); assert.equal(b.opened[0].options.workingDirectory, 'C:/workspace/real'); assert.equal(b.opened[0].options.presentation, 'mini');
    await b.press('close'); await b.press('diff'); assert.match(b.document.querySelector('[role=dialog]').textContent, /diffScope/); assert.match(b.document.querySelector('[role=dialog]').textContent, /notGit/); assert.doesNotMatch(b.document.querySelector('[role=dialog]').textContent, /noDiff/);
  } finally { await b.dispose(); }
});

test('viewing a work result fetches that exact work outside the visible materials page and preserves file authority', async () => {
  const detail = workDetail(), work = detail.workstreams[0];
  Object.assign(work, { id: 'off-page-work', title: 'Inspect a separate module', status: 'done', group: 'history', pendingSummary: false });
  Object.assign(work.latestReport, { remainingIssues: [], artifacts: [{ path: 'C:/owned-branch/src/module.js', location: 'worktree', size: 72 }] });
  detail.workers[0].workstreamId = work.id;
  const originalReport = JSON.stringify(work.latestReport);
  const unrelated = { workstreamId: 'other-work', title: 'Visible page work', current: true, reportCount: 1, report: { delegationRef: 'other-report', outcome: 'completed', at: 2000, summary: 'Unrelated visible report', artifacts: [] } };
  const b = bench({ detail, rpcOverride: method => method === 'store/list' ? { ok: true, value: { docs: [], results: [unrelated], nextResultsCursor: 'later-page' } } : undefined });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.press('progress'); await b.press('viewResult'); await b.flush();
    const dialog = b.document.querySelector('[role=dialog]');
    assert.deepEqual([...dialog.querySelectorAll('[data-result-workstream-id]')].map(row => row.dataset.resultWorkstreamId), [work.id]);
    assert.doesNotMatch(dialog.textContent, /Unrelated visible report/);
    const targetRequests = b.requests.filter(request => ['workstreams/get', 'store/results'].includes(request.method));
    assert.deepEqual(targetRequests.map(request => request.method).sort(), ['store/results', 'workstreams/get']);
    assert.ok(targetRequests.every(request => request.input.projectId === b.project.id && request.input.workstreamId === work.id));
    await b.press('openFile: module.js');
    const opened = b.requests.filter(request => request.method === 'open').at(-1);
    assert.equal(opened.input.projectId, b.project.id); assert.equal(opened.input.workstreamId, work.id); assert.equal(opened.input.delegationRef, work.latestReport.delegationRef); assert.equal(opened.input.path, work.latestReport.artifacts[0].path);
    await b.press('allResults'); assert.deepEqual([...dialog.querySelectorAll('[data-result-workstream-id]')].map(row => row.dataset.resultWorkstreamId), ['other-work']);
    assert.equal(JSON.stringify(work.latestReport), originalReport); assert.equal(b.sent.length, 0); assert.equal(b.requests.some(request => ['delegate', 'resume', 'store/write'].includes(request.method)), false);
  } finally { await b.dispose(); }
});

test('notes save and reload, while failed writes keep editing and require an explicit discard', async () => {
  let failWrites = true;
  const b = bench({ rpcOverride: method => method === 'store/write' && failWrites ? { ok: false, error: { code: 'storage/failed', message: 'Disk write failed' } } : undefined });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.press('materials'); await b.flush(); await b.press('notes');
    assert.equal(b.document.querySelector('textarea').value, 'Initial notes');
    const generated = b.document.querySelector('[role=dialog] details'); assert.equal(generated.open, false); assert.match(generated.textContent, /Generated current work records/);
    assert.doesNotMatch(b.document.querySelector('textarea').value, /Generated|whale-project/);
    await b.changeNotes('Keep this edit'); await b.press('save');
    assert.equal(b.document.querySelector('textarea').value, 'Keep this edit'); assert.match(b.document.querySelector('[role=alert]').textContent, /Disk write failed/); assert.match(b.stored['notes.md'], /\nInitial notes$/);
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
    await b.disclose('errorDetails'); assert.equal(diagnostic.open, true); assert.equal(selected(), 'preferences'); assert.equal(b.document.querySelector('textarea').value, 'Use the project test command');
    await b.press('keepEditing'); await b.press('notes');
    const nextConfirmation = b.document.querySelector('[role=dialog][aria-label=unsaved]'); assert.ok(nextConfirmation); assert.equal(nextConfirmation.querySelector('[role=alert]'), null); assert.equal(nextConfirmation.querySelector('details'), null);
    assert.equal(selected(), 'preferences'); assert.equal(b.document.querySelector('textarea').value, 'Use the project test command');
    failWrites = false; await b.press('saveAndSwitch');
    assert.equal(selected(), 'notes'); assert.equal(b.document.querySelector('textarea').value, 'Initial notes'); assert.equal(b.stored['preferences.md'], 'Use the project test command'); assert.equal(b.document.querySelector('[role=dialog][aria-label=unsaved]'), null);
    const write = b.requests.filter(request => request.method === 'store/write').at(-1); assert.equal(write.input.path, 'preferences.md'); assert.equal(write.input.text, 'Use the project test command');
    assert.equal(b.sent.length, 0); assert.equal(b.requests.some(request => ['delegate', 'resume'].includes(request.method)), false);
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

test('a history load with no added records preserves the current page', async () => {
  const b = bench({ detail: workDetail() });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.press('progress'); await b.disclose('workDetails'); await b.press('viewProcess'); await b.flush();
    await b.press('previous'); b.session.loadOlder = async () => {};
    const before = b.document.querySelector('[role=dialog]').textContent;
    await b.press('older'); assert.equal(b.document.querySelector('[role=dialog]').textContent, before);
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
  const b = bench({ detail: workDetail(), rpcOverride: (method, _input, project) => {
    if (method === 'list') { project.paused = true; return { ok: true, value: { projects: [project], available: true } }; }
    if (method === 'resume') { project.paused = false; return { ok: true, value: { project, note: 'Ready for a new user message.' } }; }
    if (method === 'archive') { project.lifecycle = 'archived'; return { ok: true, value: { project } }; }
    if (method === 'restore') { project.lifecycle = 'ready'; return { ok: true, value: { project } }; }
  } });
  try {
    await b.flush(); await b.mount(); await b.flush(); await b.press('progress');
    for (const action of ['resume', 'archive', 'restore']) {
      const before = b.requests.filter(request => request.method === 'detail').length;
      await act(async () => { await b.face().command('project-one', action); });
      assert.ok(b.requests.filter(request => request.method === 'detail').length > before);
      await b.render();
      if (action === 'archive') { assert.match(b.document.body.textContent, /archivedHint/); assert.equal(b.button('progress'), undefined); assert.ok(b.button('restore')); }
      else { if (b.button('progress')?.getAttribute('aria-expanded') === 'false') await b.press('progress'); if (!b.document.querySelector('.dsh-project-work-details')?.open) await b.disclose('workDetails'); assert.ok(b.button('viewProcess')); await b.press('viewResult'); await b.flush(); assert.match(b.document.querySelector('[role=dialog]').textContent, /Actual worker summary/); await b.press('close'); assert.doesNotMatch(b.document.body.textContent, /archivedHint/); }
    }
  } finally { await b.dispose(); }
});

test('stop controls invoke the same Host stop command and incremental polling preserves unchanged details', async () => {
  const detail = workDetail();
  const b = bench({ detail, rpcOverride: (method, input, project) => method === 'list' ? { ok: true, value: { projects: [project], available: true } }
    : method === 'detail' && input.since ? { ok: true, value: { unchanged: true, revision: input.since } } : undefined });
  try {
    await b.flush(); await b.mount(); await b.flush(); await b.press('progress'); await b.press('stopWork'); await b.press('stop');
    const stops = b.requests.filter(request => request.method === 'stop'); assert.equal(stops.length, 2); assert.equal(stops[0].input.workstreamId, 'work-one'); assert.equal(stops[1].input.workstreamId, undefined); assert.ok(stops.every(request => request.input.projectId === 'project-one' && request.input.requestId));
    await b.poll(); await b.disclose('workDetails'); assert.ok(b.requests.some(request => request.method === 'detail' && request.input.since === 'revision-1')); await b.press('viewResult'); await b.flush(); assert.match(b.document.querySelector('[role=dialog]').textContent, /Actual worker summary/);
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
      const row = b.document.querySelector('.dsh-project-row');
      await act(async () => { row.dispatchEvent(new b.document.defaultView.MouseEvent('contextmenu', { bubbles: true })); });
      await b.press('archive');
      assert.ok(b.document.querySelector('[role=dialog][aria-label=archiveActive]'));
      assert.equal(b.requests.some(request => request.method === 'archive'), false);
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
    const b = bench({ detail });
    try {
      await b.flush(); await b.adopt(); await b.mount(); await b.press('progress'); await b.press('stopWork');
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
    const b = bench({ detail });
    try {
      await b.flush(); await b.adopt(); await b.mount();
      const draft = b.document.createElement('textarea'); draft.value = 'Keep my unsent requirement'; b.document.body.append(draft);
      assert.match(b.document.querySelector('[data-testid=project-progress]').textContent, /summaryFailed/);
      await b.press('progress'); assert.match(b.document.body.textContent, /Actual provider failed/); await b.press('retrySummary');
      assert.equal(b.sent.length, 1); assert.equal(b.sent[0].sessionId, b.project.coordinatorSessionId);
      assert.match(b.sent[0].text, /retrySummaryPrompt\nImplement feature · 1970-01-01T00:00:0[12]\.000Z/);
      assert.doesNotMatch(b.sent[0].text, /current-ref|actual-run/); assert.equal(draft.value, 'Keep my unsent requirement');
      assert.equal(b.requests.some(request => ['delegate', 'prompt', 'resume'].includes(request.method)), false);
    } finally { await b.dispose(); }
  }
});

test('a changed result cannot be submitted as the failed result by the summary action', async () => {
  const detail = workDetail(); Object.assign(detail.workstreams[0], { summaryFailure: { delegationRef: 'old-ref', error: { message: 'Failed' } } });
  const b = bench({ detail, rpcOverride: method => method === 'workstreams/get' ? { ok: true, value: { workstream: { title: 'New result', latestReport: { delegationRef: 'new-ref', at: 2 } } } } : undefined });
  try { await b.flush(); await b.adopt(); await b.mount(); await b.press('progress'); await b.press('retrySummary'); assert.equal(b.sent.length, 0); assert.match(b.document.body.textContent, /resultUpdated/); }
  finally { await b.dispose(); }
});

test('a missing credential has an actionable settings entry and preserves the complete diagnostic on demand', async () => {
  const detail = workDetail(), work = detail.workstreams[0];
  Object.assign(detail.activity, { running: 0, summaryFailed: 1, state: 'summaryFailed' });
  Object.assign(work, { status: 'done', summaryFailure: { delegationRef: 'current', error: { code: 'MISSING_CREDENTIAL', message: 'Exact native provider diagnostic' } } });
  const b = bench({ detail });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.press('progress');
    const dock = b.document.querySelector('[data-testid=project-progress]');
    assert.match(dock.textContent, /summaryCredentialHint/);
    const diagnostics = [...dock.querySelectorAll('details')].find(e => e.querySelector('summary')?.textContent === 'errorDetails');
    assert.equal(diagnostics.open, false); assert.equal(diagnostics.querySelector('pre').textContent, 'MISSING_CREDENTIAL\nExact native provider diagnostic');
    await b.press('modelSettings'); assert.deepEqual(b.navigation.at(-1), ['settings', 'models']);
    assert.equal(b.sent.length, 0); assert.equal(b.requests.some(r => ['delegate', 'resume', 'store/write'].includes(r.method)), false);
    await b.disclose('errorDetails'); assert.equal(diagnostics.open, true);
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
      await act(async () => { row.querySelector('button').click(); await new Promise(resolve => setImmediate(resolve)); });
      const opened = b.requests.filter(r => r.method === 'open').at(-1);
      assert.equal(opened.input.path, files[i].path); assert.equal(opened.input.delegationRef, reports[i].delegationRef); assert.equal(opened.input.workstreamId, `work-${i}`);
      await act(async () => { row.querySelector('[aria-label="fileMore: app.js"]').click(); });
      await act(async () => { row.querySelector('[role=menuitem]').click(); });
      assert.equal(row.querySelector('.dsh-project-path').textContent, files[i].path); assert.equal(b.requests.filter(r => r.method === 'open').length, i + 1);
    }
  } finally { await b.dispose(); }
});

test('same-named Projects show distinct short directories and retain their own coordinator destination', async () => {
  let other;
  const b = bench({ rpcOverride: (method, input, project) => {
    if (method === 'list') { other = { ...project, id: 'other-project', coordinatorSessionId: 'other-lead', canonicalWorkingDirectory: 'C:/another/real' }; return { ok: true, value: { available: true, projects: [project, other] } }; }
    if (method === 'detail' && input.projectId === other.id) return { ok: true, value: { project: other, workstreams: [], workers: [], revision: 'other-revision' } };
  } });
  try {
    await b.flush(); await b.mount();
    const rows = [...b.document.querySelectorAll('button.dsh-project-row')]; assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(e => e.querySelector('.dsh-project-row-title').textContent), ['Project', 'Project']);
    assert.deepEqual(rows.map(e => e.querySelector('.dsh-project-muted').textContent), ['…/workspace/real', '…/another/real']);
    await act(async () => { rows[1].click(); await new Promise(resolve => setImmediate(resolve)); });
    assert.deepEqual(b.navigation.at(-1), ['session', 'other-lead']);
    assert.equal(b.requests.some(r => ['create', 'delegate', 'resume'].includes(r.method)), false);
  } finally { await b.dispose(); }
});

test('queued work explains the actual gate and an open report refreshes changed prerequisites without rerunning it', async () => {
  for (const [kind, label] of [['dependencies', 'waitingDependencies'], ['directory', 'waitingDirectory'], ['capacity', 'waitingCapacity']]) {
    const detail = workDetail(), work = detail.workstreams[0]; Object.assign(work, { delegation: { phase: 'queued', waitingReason: { kind, workTitles: kind === 'capacity' ? [] : ['API contract'] } } });
    const b = bench({ detail, rpcOverride: (method, _input, project) => method === 'list' ? { ok: true, value: { projects: [project], available: true } } : undefined });
    try {
      await b.flush(); await b.adopt(); await b.mount(); await b.press('progress'); assert.match(b.document.body.textContent, new RegExp(label));
      if (kind !== 'capacity') assert.match(b.document.body.textContent, /API contract/);
      await b.disclose('workDetails'); work.prerequisitesChanged = true; work.latestReport.prerequisitesChanged = true;
      await b.poll(); await b.flush(); assert.match(b.document.body.textContent, /prerequisitesChanged/);
      assert.equal(b.requests.filter(request => request.method === 'workstreams/get').length, 2, 'dependency warning refreshes details even when downstream updatedAt stays unchanged');
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
    await b.flush(); await b.adopt(); await b.mount(); await b.press('materials'); await b.flush(); assert.match(b.document.querySelector('[role=dialog]').textContent, /Current result needs an external check/);
    const history = [...b.document.querySelectorAll('details')].find(element => element.querySelector('summary')?.textContent.startsWith('resultHistory'));
    assert.equal(history.querySelector('summary').textContent, 'resultHistory (1)');
    await act(async () => { history.open = true; history.dispatchEvent(new b.document.defaultView.Event('toggle')); await new Promise(resolve => setImmediate(resolve)); }); await b.flush();
    assert.equal(b.requests.filter(request => request.method === 'store/results').length, 1);
    assert.match(history.textContent, /Earlier completed result/); await b.press('openFile: old.js');
    const opened = b.requests.filter(request => request.method === 'open').at(-1); assert.equal(opened.input.delegationRef, 'old-assignment'); assert.equal(opened.input.workstreamId, 'work-one'); assert.equal(opened.input.path, 'src/old.js');
    assert.match(b.document.querySelector('[role=dialog]').textContent, /modifiedArtifact/);
  } finally { await b.dispose(); }
});
