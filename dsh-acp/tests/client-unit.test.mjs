import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  sanitizeAgentId,
  deriveUniqueAgentId,
  safeHttpsIconUrl,
  copyTextToClipboard,
} from '../client-src/utils.js';
import { handlePickerKeyDown, computeMenuPos } from '../client-src/picker-data.js';
import { injectCss } from '../client-src/styles.js';

const bundleSource = fs.readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');

function mountClientBundle({ states = [], effects = [] } = {}) {
  let loaded;
  let stateCursor = 0;
  const h = (type, props, ...children) => ({ type, props: props || {}, children });
  const react = {
    createElement: h,
    Fragment: 'Fragment',
    useState(initial) {
      const idx = stateCursor++;
      const val = idx < states.length ? states[idx] : (typeof initial === 'function' ? initial() : initial);
      return [val, (next) => { states[idx] = typeof next === 'function' ? next(states[idx]) : next; }];
    },
    useEffect(fn) { effects.push(fn); },
    useLayoutEffect() {},
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useRef: (current) => ({ current }),
    useId: () => 'unit-id',
    useSyncExternalStore: (_sub, snap) => snap(),
  };
  const primitives = {
    Button: 'HostButton',
    Input: 'HostInput',
    MenuSurface: 'MenuSurface',
    Toast: 'Toast',
    Modal: 'Modal',
    StateDot: 'StateDot',
    Switch: 'HostSwitch',
    IconCloseFillRegular: 'IconClose',
    IconWarningOutlineRegular: 'IconWarn',
    IconCheckOutlineRegular: 'IconCheck',
    IconChevronDownOutlineRegular: 'IconDown',
    IconChevronRightOutlineRegular: 'IconRight',
    IconAgentPresetOutlineRegular: 'IconAgent',
    IconSettingsOutlineRegular: 'IconSettings',
    IconPlusOutlineRegular: 'IconPlus',
    IconRefreshOutlineRegular: 'IconRefresh',
    IconTrashOutlineRegular: 'IconTrash',
  };
  const styleNodes = [];
  const doc = {
    getElementById: (id) => styleNodes.find((n) => n.id === id) || null,
    createElement: (tag) => {
      const node = { tag, id: '', textContent: '', remove() { const i = styleNodes.indexOf(node); if (i >= 0) styleNodes.splice(i, 1); } };
      return node;
    },
    head: { appendChild: (n) => styleNodes.push(n) },
    body: {},
  };
  vm.runInNewContext(bundleSource, {
    window: {
      __ModuleLoader__: {
        load({ factory }) {
          loaded = factory((name) => {
            if (name === 'react') return react;
            if (name === 'react-dom') return { createPortal: (tree) => tree };
            if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
            throw new Error(`Unexpected require ${name}`);
          });
        },
      },
    },
    document: doc,
    setTimeout,
    clearTimeout,
    console,
  });

  const registered = new Map();
  const effectCleanups = [];
  const ctx = {
    effect: (fn) => { const c = fn(); if (typeof c === 'function') effectCleanups.push(c); },
    locale: { register: () => () => {}, bind: () => (key) => key },
    connection: { rpc: { call: async () => ({}) } },
    slots: {
      inject: (_name, fn) => fn(),
      entriesOfSlot: () => [],
      getVersion: () => 0,
      subscribe: () => () => {},
      register: (spec, component) => {
        registered.set(spec.name, { spec, component });
        return () => registered.delete(spec.name);
      },
    },
    modelDirectories: { directoryFor: () => ({ store: {}, load: async () => {}, select: async () => ({}) }) },
    sessions: { subagentAddress: () => undefined },
    uiConversation: { events: { register() {} } },
    uiWorkspace: { openSession() {} },
    inject: (_deps, fn) => fn({ ...ctx }),
  };
  loaded.apply(ctx);
  return {
    registered,
    styleNodes,
    effectCleanups,
    resetCursor() { stateCursor = 0; },
  };
}

function collectNodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(collectNodes);
  return [tree, ...collectNodes(tree.children)];
}

test('sanitizeAgentId and deriveUniqueAgentId handle pure Chinese names, duplicates, and 48-char cap', () => {
  assert.equal(sanitizeAgentId('我的智能体'), '');
  assert.equal(sanitizeAgentId('---Claude Code---'), 'claude-code');
  assert.equal(sanitizeAgentId('a'.repeat(80)).length, 48);

  const existing = new Set(['claude-code', 'claude-code-2']);
  assert.equal(deriveUniqueAgentId('Claude Code', existing), 'claude-code-3');
  const cnId = deriveUniqueAgentId('我的智能体', existing, 'custom');
  assert.match(cnId, /^custom-\d+$/);
  assert.ok(!existing.has(cnId));
});

test('safeHttpsIconUrl allows only https URLs and copyTextToClipboard throws when clipboard APIs are unavailable', async () => {
  assert.equal(safeHttpsIconUrl('https://cdn.example.com/icon.svg'), 'https://cdn.example.com/icon.svg');
  for (const bad of ['', 'http://example.com/a.svg', 'javascript:alert(1)', 'file:///etc/passwd', 'data:image/svg+xml,<svg/>']) {
    assert.equal(safeHttpsIconUrl(bad), null, `must reject ${bad}`);
  }
  await assert.rejects(copyTextToClipboard('https://example.com/auth'), /Clipboard|unavailable/i);
  await assert.rejects(copyTextToClipboard(''), /Nothing to copy/i);
});

test('handlePickerKeyDown lets ArrowLeft/Home/End edit non-empty search text and routes empty/pos-0 ArrowLeft & Shift+Tab to rail', () => {
  let railFocused = 0;
  let highlighted = 2;
  const railBtn = { focus: () => { railFocused += 1; }, closest: () => railBtn };
  const searchEl = {
    value: 'claude',
    selectionStart: 3,
    selectionEnd: 3,
    closest: () => null,
    focus() {},
  };
  const menuEl = {
    querySelectorAll: () => [railBtn],
    querySelector: () => railBtn,
  };
  const makeEvent = (key, extra = {}) => {
    let prevented = false;
    return {
      key,
      target: searchEl,
      nativeEvent: { isComposing: false },
      preventDefault: () => { prevented = true; },
      get prevented() { return prevented; },
      ...extra,
    };
  };
  const deps = {
    open: true,
    close() {},
    searchEl,
    menuEl,
    busy: false,
    visibleModels: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    activeModelIndex: 1,
    setHighlightedIndex: (v) => { highlighted = v; },
    chooseModel() {},
    filterTabs: [],
    effectiveActiveTab: 'builtin',
    setActiveTab() {},
  };

  // Caret in middle of search query: ArrowLeft/Home/End must NOT be intercepted
  for (const key of ['ArrowLeft', 'Home', 'End']) {
    const ev = makeEvent(key);
    handlePickerKeyDown(ev, deps);
    assert.equal(ev.prevented, false, `${key} inside non-empty search must not be hijacked`);
  }
  assert.equal(railFocused, 0);
  assert.equal(highlighted, 2);

  // Caret at 0 with Shift+Tab or empty search with ArrowLeft jumps focus to rail
  searchEl.value = '';
  searchEl.selectionStart = 0;
  searchEl.selectionEnd = 0;
  const leftEmpty = makeEvent('ArrowLeft');
  handlePickerKeyDown(leftEmpty, deps);
  assert.equal(leftEmpty.prevented, true);
  assert.equal(railFocused, 1);

  searchEl.value = 'claude';
  searchEl.selectionStart = 3;
  searchEl.selectionEnd = 3;
  const shiftTab = makeEvent('Tab', { shiftKey: true });
  handlePickerKeyDown(shiftTab, deps);
  assert.equal(shiftTab.prevented, true);
  assert.equal(railFocused, 2);
});

test('computeMenuPos clamps to non-negative coordinates on narrow viewports', () => {
  const prevWin = globalThis.window;
  globalThis.window = { innerWidth: 320, innerHeight: 400 };
  try {
    const pos = computeMenuPos(
      { getBoundingClientRect: () => ({ left: 20, right: 120, top: 30, bottom: 60 }) },
      { offsetWidth: 640, offsetHeight: 500 },
    );
    assert.ok(pos.left >= 0, `left must not be negative: ${pos.left}`);
    assert.ok(pos.top >= 0, `top must not be negative: ${pos.top}`);
  } finally {
    if (prevWin === undefined) delete globalThis.window;
    else globalThis.window = prevWin;
  }
});

test('injectCss reference-counts and removes injected <style> node on final dispose', () => {
  const prevDoc = globalThis.document;
  const nodes = [];
  globalThis.document = {
    getElementById: (id) => nodes.find((n) => n.id === id) || null,
    createElement: () => {
      const n = { id: '', textContent: '', remove() { const i = nodes.indexOf(n); if (i >= 0) nodes.splice(i, 1); } };
      return n;
    },
    head: { appendChild: (n) => nodes.push(n) },
  };
  try {
    const d1 = injectCss();
    const d2 = injectCss();
    assert.equal(nodes.length, 1);
    d1();
    assert.equal(nodes.length, 1, 'style stays mounted while second holder is active');
    d2();
    assert.equal(nodes.length, 0, 'style is removed once last holder disposes');
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
  }
});

test('DelegationRow handles missing fields without throwing and AgentSessionOptions skips RPC when sessionId is empty', async () => {
  const effects = [];
  const mounted = mountClientBundle({ effects });
  assert.equal(mounted.styleNodes.length, 1);

  // DelegationRow null-safety for legacy/partial event payloads
  const DelegationRow = mounted.registered.get('conversation.chat.node').component;
  mounted.resetCursor();
  const row = DelegationRow({
    node: { data: { childId: 'c1', runId: 'r1', pendingInteraction: { kind: 'custom_unknown' } } },
    openChild() {},
    t: (k) => k,
  });
  assert.equal(row.props['data-status'], 'running');
  assert.doesNotMatch(JSON.stringify(row), /NaN/);

  // AgentSessionOptions skips session/options RPC when sessionId is empty (pre-first-message)
  const AgentSessionOptions = mounted.registered.get('conversation.input.model.options').component;
  const rpcCalls = [];
  const failures = [];
  effects.length = 0;
  mounted.resetCursor();
  AgentSessionOptions({
    sessionId: '',
    directory: { subscribe: () => () => {}, getSnapshot: () => ({ current: { provider: 'acp:codex', model: 'gpt-5' } }) },
    rpc: async (m, p) => { rpcCalls.push([m, p]); return {}; },
    t: (k) => k,
    locked: false,
    dismiss() {},
    openAgentSettings: () => true,
    reportFailure: (msg) => failures.push(msg),
  });
  for (const eff of effects.splice(0)) eff();
  assert.equal(rpcCalls.length, 0, 'empty sessionId must not call session/options');
  assert.equal(failures.length, 0);

  // Dispose removes injected styles cleanly
  for (const cleanup of mounted.effectCleanups.reverse()) cleanup();
  assert.equal(mounted.styleNodes.length, 0);
});

test('AgentModelSelect retry preserves reasoningEffort on same-model effort failure', async () => {
  const effects = [];
  const mounted = mountClientBundle({ effects });
  const selector = mounted.registered.get('conversation.input.model').component;
  const submitted = [];
  const current = { provider: 'acp:codex', model: 'gpt-5', reasoningEffort: 'low' };
  const dir = { subscribe: () => () => {}, getSnapshot: () => ({ status: 'ready', current, groups: [], failures: [], pending: null }) };
  const wrapped = selector({
    sessionId: 's1',
    directory: dir,
    load: async () => {},
    select: async (sel) => { submitted.push(sel); return { ok: true }; },
    rpc: async () => ({ agents: [] }),
    openAgentSettings: () => true,
    t: (k) => k,
    renderHostOptions: () => [],
  });
  // Verify the inner component preserves Toast retry action when failedAction has reasoningEffort
  const states = [
    false, // open
    'builtin', // activeTab
    [], // acpCatalog
    '', // query
    null, // highlightedIndex
    false, // selectionFocus
    { seq: 1, text: 'failed', catalog: false }, // toast
    { selection: { provider: 'acp:codex', model: 'gpt-5', reasoningEffort: 'high' }, category: { id: 'acp:codex', isExternal: true, enabled: true } }, // failedAction
  ];
  const mounted2 = mountClientBundle({ states });
  const wrapped2 = mounted2.registered.get('conversation.input.model').component({
    sessionId: 's1',
    available: true,
    directory: dir,
    load: async () => {},
    select: async (sel) => { submitted.push(sel); return { ok: true }; },
    rpc: async () => ({ agents: [] }),
    openAgentSettings: () => true,
    t: (k) => k,
    renderHostOptions: () => [],
  });
  mounted2.resetCursor();
  const tree = wrapped2.type(wrapped2.props);
  const toastNode = collectNodes(tree).find((n) => n.type === 'Toast');
  assert.ok(toastNode, 'Toast should render when toast state is set');
  const retryBtn = toastNode.props.actions.find((a) => a.label === 'action.retry');
  assert.ok(retryBtn, 'Toast should expose retry action');
  await retryBtn.onClick();
  assert.equal(submitted.length, 1, 'retrying same-model reasoning effort must not early-return');
  assert.deepEqual(submitted[0], { provider: 'acp:codex', model: 'gpt-5', reasoningEffort: 'high' });
  void wrapped;
});
