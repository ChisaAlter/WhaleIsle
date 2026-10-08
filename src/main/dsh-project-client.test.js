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
function bench({ available = true, rejectCreation = false, detail = {}, rpcOverride } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main></main></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const savedGlobals = Object.fromEntries(['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const { createRoot } = clientRequire('react-dom/client');
  let registration, directoryAction, timer, root;
  const cleanups = [], entries = [], requests = [], navigation = [], retained = [], released = [], opened = [], events = new Map();
  const project = { id: 'project-one', title: 'Project', coordinatorSessionId: 'coordinator-existing', workspaceId: 'workspace-existing',
    storageRoot: 'C:/profile/projects/project-one', canonicalWorkingDirectory: 'C:/workspace/real', lifecycle: 'ready', paused: false, diagnostics: [] };
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
  const TaskDock = ({ title, children, testId }) => { const [expanded, setExpanded] = React.useState(false); return h('section', { 'data-testid': testId }, h('button', { 'aria-expanded': expanded, onClick: () => setExpanded(!expanded) }, title), expanded ? children : null); };
  const Menu = ({ open, anchor, items, onSelect }) => h(React.Fragment, null, anchor, open ? h('div', { role: 'menu' }, items.map(item => h('button', { key: item.id, role: 'menuitem', onClick: () => onSelect(item.id) }, item.label))) : null);
  const primitives = { Button, Modal, TaskDock, Menu, Input: props => h('input', props), IconChevronDownOutlineRegular: () => null, IconChevronRightOutlineRegular: () => null, Pill: ({ children }) => h('span', null, children), MarkdownText: ({ text }) => h('div', { 'data-markdown': true }, text), IconFolderCloseRegular: () => h('span', { 'aria-hidden': true }) };
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
    slots: { inject: (_key, install) => install(), register: (options, component) => { entries.push({ options, component }); return () => {}; } },
    workspaces: { create: async input => { requests.push({ method: 'workspace/create', input }); return { path: project.canonicalWorkingDirectory, workspaceId: project.workspaceId }; }, openPath: async (path, options) => opened.push({ path, options }) },
    uiWorkspace: { registerDirectoryAction: action => { directoryAction = action; return () => { directoryAction = undefined; }; }, openSession: id => navigation.push(['session', id]) },
    uiSidebar: { selectTab: id => navigation.push(['tab', id]) },
    sessions: { list: projection({ byId: { [project.coordinatorSessionId]: { id: project.coordinatorSessionId, retainedBy: { mainView: 1 } } } }), retain: (address, options) => { retained.push({ address, options }); return { ready: Promise.resolve(binding), release: () => released.push(address.childSessionId) }; } },
    connection: { rpc: { call: async (prefix, method, input) => {
      assert.equal(prefix, '/dsh-project'); requests.push({ method, input });
      const override = rpcOverride?.(method, input, project, stored);
      if (override !== undefined) return await override;
      if (method === 'list') return { ok: true, value: { projects: [], available } };
      if (method === 'create') return rejectCreation ? { ok: false, error: { code: 'project/rejected', message: 'Creation failed' } } : { ok: true, value: { project, reused: true } };
      if (method === 'detail') return { ok: true, value: { project, workstreams: [], workers: [], revision: 'revision-1', ...detail } };
      if (method === 'store/list') return { ok: true, value: { docs: [{ path: 'docs/report.md', size: 12 }], notes: 'notes.md', preferences: 'preferences.md' } };
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
    return h(entry.component, { ...injected, useProjects: selectHook(injected.hooks.projects), useProjectSessions: selectHook(injected.hooks.projectSessions),
      ...(store ? { useStore: selectHook(store), actions: store.actions } : {}), sessionId: project.coordinatorSessionId, wide: true, t: key => key });
  }
  const render = () => root.render(h(React.Fragment, null, entries.filter(entry => entry.options.name !== 'sidebar.nav.tab').map(entry => h(Slot, { key: entry.options.name, entry }))));
  const flush = async () => { await act(async () => { await new Promise(resolve => setImmediate(resolve)); }); };
  const findButton = label => [...dom.window.document.querySelectorAll('button')].find(element => element.textContent === label || element.getAttribute('aria-label') === label);
  return { entries, requests, navigation, retained, released, opened, eventSource, session, stored, project, face, document: dom.window.document,
    get action() { return directoryAction; }, flush,
    mount: async () => { root = createRoot(dom.window.document.querySelector('main')); await act(async () => { render(); }); },
    render: async () => { await act(async () => { render(); }); },
    press: async label => { const target = findButton(label); assert.ok(target, `Missing button ${label}`); await act(async () => { target.click(); await new Promise(resolve => setImmediate(resolve)); }); },
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

const workDetail = () => ({ workstreams: [{ id: 'work-one', title: 'Implement feature', status: 'running', workerSessionId: 'worker-one', pendingSummary: true, latestReport: {
  summary: 'Actual worker summary', artifacts: [{ path: 'src/app.js', size: 3, sha256: '123', type: 'file' }], evidence: ['Worker ran the targeted command'], remainingIssues: ['An actual integration check remains'],
} }], workers: [{ sessionId: 'worker-one', workstreamId: 'work-one', role: 'worker', mode: 'existing', phase: 'active', activeRunId: 'run-one', cwd: 'C:/workspace/real' }] });

test('background process renders real Session records in pages and never opens a worker chat or input', async () => {
  const b = bench({ detail: workDetail() });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.press('progress');
    assert.match(b.document.body.textContent, /pendingSummary/); assert.match(b.document.body.textContent, /An actual integration check remains/);
    const navigation = b.navigation.length;
    await b.press('process'); await b.flush();
    assert.equal(b.retained[0].address.parentSessionId, 'coordinator-existing'); assert.equal(b.retained[0].address.childSessionId, 'worker-one'); assert.equal(b.retained[0].address.mode, 'continuable');
    assert.equal(b.document.querySelector('[role=dialog]').querySelectorAll('textarea,input').length, 0); assert.equal(b.navigation.length, navigation);
    assert.match(b.document.body.textContent, /Worker record 80/); assert.match(b.document.body.textContent, /actual repository content/);
    assert.equal(b.document.querySelectorAll('[data-markdown]').length, 49); // 48 assistant records plus the main report.
    await b.press('previous'); assert.match(b.document.body.textContent, /Worker record 21/); assert.doesNotMatch(b.document.querySelector('[role=dialog]').textContent, /Worker record 80/);
    await b.press('older'); assert.match(b.document.querySelector('[role=dialog]').textContent, /Worker record 1/);
    await b.press('close'); assert.deepEqual(b.released, ['worker-one']); assert.equal(b.navigation.length, navigation);
    assert.equal(b.requests.some(request => ['delegate', 'message', 'prompt'].includes(request.method)), false);
  } finally { await b.dispose(); }
});

test('registered artifacts open in the application under their authorized directory and non-Git diff stays explicit', async () => {
  const b = bench({ detail: workDetail() });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.press('progress');
    await b.press('openFile'); const artifact = b.requests.filter(request => request.method === 'open').at(-1); assert.equal(artifact.input.workstreamId, 'work-one'); assert.equal(artifact.input.path, 'src/app.js');
    assert.equal(b.opened[0].path, 'C:/workspace/real/src/app.js');
    assert.equal(b.opened[0].options.sessionId, 'coordinator-existing'); assert.equal(b.opened[0].options.workingDirectory, 'C:/workspace/real'); assert.equal(b.opened[0].options.presentation, 'mini');
    await b.press('diff'); assert.match(b.document.querySelector('[role=dialog]').textContent, /notGit/); assert.doesNotMatch(b.document.querySelector('[role=dialog]').textContent, /noDiff/);
  } finally { await b.dispose(); }
});

test('notes save and reload, while failed writes keep editing and require an explicit discard', async () => {
  let failWrites = true;
  const b = bench({ rpcOverride: method => method === 'store/write' && failWrites ? { ok: false, error: { code: 'storage/failed', message: 'Disk write failed' } } : undefined });
  try {
    await b.flush(); await b.adopt(); await b.mount(); await b.press('materials'); await b.flush(); await b.press('notes');
    assert.equal(b.document.querySelector('textarea').value, 'Initial notes');
    assert.match(b.document.querySelector('[role=dialog]').textContent, /Generated current work records/); assert.match(b.document.querySelector('[role=dialog]').textContent, /generatedReadonly/);
    assert.doesNotMatch(b.document.querySelector('textarea').value, /Generated|whale-project/);
    await b.changeNotes('Keep this edit'); await b.press('save');
    assert.equal(b.document.querySelector('textarea').value, 'Keep this edit'); assert.match(b.document.querySelector('[role=alert]').textContent, /Disk write failed/); assert.match(b.stored['notes.md'], /\nInitial notes$/);
    await b.press('close'); assert.ok(b.document.querySelector('[role=dialog][aria-label=unsaved]')); await b.press('keepEditing'); assert.equal(b.document.querySelector('textarea').value, 'Keep this edit');
    failWrites = false; await b.press('save'); assert.match(b.stored['notes.md'], /\nKeep this edit$/); assert.equal(b.stored['notes.md'].match(/Generated current work records/g).length, 1); assert.ok(b.document.querySelector('[role=status]'));
    assert.equal(b.requests.filter(request => request.method === 'store/write').at(-1).input.text, 'Keep this edit');
    await b.press('close'); await b.press('materials'); await b.flush(); await b.press('notes'); assert.equal(b.document.querySelector('textarea').value, 'Keep this edit');
    await b.press('docs/report.md'); assert.equal(b.opened.at(-1).path, 'C:/workspace/real/docs/report.md');
    const opened = b.requests.filter(request => request.method === 'open').at(-1); assert.equal(opened.input.path, 'docs/report.md'); assert.equal(opened.input.workstreamId, undefined);
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
    await b.flush(); await b.adopt(); await b.mount(); await b.press('progress'); await b.press('process'); await b.flush();
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
      assert.match(b.document.body.textContent, /Actual worker summary/); assert.ok(b.button('process'));
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
    await b.poll(); assert.ok(b.requests.some(request => request.method === 'detail' && request.input.since === 'revision-1')); assert.match(b.document.body.textContent, /Actual worker summary/);
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
