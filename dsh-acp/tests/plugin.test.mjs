import { test } from 'node:test';
import './client-options.test.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createAcpAgentsManager, conversationPrompt, extractLatestUserPromptBlocks } from '../lib/index.js';
import { saveAgentsConfig } from '../lib/presets.js';
import { runtimeBundle } from '../lib/agent-runtime.js';
import { registerDelegation, DELEGATION_PROVIDER } from '../lib/delegation.js';
import { AcpTurnExecution, AcpSessionConnection } from '../lib/acp-session.js';

function mockPreparedConnection(t) {
  t.mock.method(AcpSessionConnection.prototype, 'ensureReady', async function () {
    this.api = { getConfigOptions: async () => [], setSessionModel: async () => {} };
  });
}

const message = (id, role, text, kind) => ({ id, role, content: [{ type: 'text', text }], ...(kind ? { source: { kind } } : {}) });

test('delegation entries stay compact and preserve child navigation and full diagnostics', () => {
  const source = fs.readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');
  const start = source.indexOf('    function DelegationRow(');
  const end = source.indexOf('\n    function apply(ctx)', start);
  const h = (type, props, ...children) => ({ type, props: props || {}, children });
  const render = vm.compileFunction(`${source.slice(start, end)}\nreturn DelegationRow(props);`,
    ['props', 'h', 'useState', 'useEffect', 'ADD_PROVIDER_CARDS', 'IconAgentPresetOutlineRegular', 'StateDot', 'IconChevronRightOutlineRegular']);
  const data = { childId: 'child-compact', agentId: 'antigravity', agentName: 'Antigravity (反重力)', modelName: 'Gemini 4 Carbon (High)', task: 'Review the project', startedAt: Date.now() - 1000 };
  const opened = [];
  const run = (patch = {}) => render({ node: { data: { ...data, ...patch } }, openChild: (id) => opened.push(id), t: (key) => key },
    h, (value) => [typeof value === 'function' ? value() : value, () => {}], () => {},
    [{ id: 'antigravity', icon: 'https://example.test/antigravity.svg' }], 'AgentIcon', 'StateDot', 'Chevron');
  const row = run();
  assert.equal(row.props['data-status'], 'running');
  assert.equal(row.children.length, 1, 'no extra model, preview or diagnostic rows');
  const button = row.children[0];
  assert.equal(button.type, 'button');
  assert.match(button.props.title, /Gemini 4 Carbon/);
  assert.equal(button.children[0].children[0].type, 'img');
  assert.equal(button.children[0].children[0].props.src, 'https://example.test/antigravity.svg');
  assert.equal(button.children[1].children[0].children[0], 'Antigravity');
  assert.equal(button.children[1].children[1].children[0], 'Gemini 4 Carbon (High)');
  assert.equal(button.children[2].children[0], 'Review the project');
  assert.doesNotMatch(button.props.title, /反重力/);
  assert.equal(data.agentName, 'Antigravity (反重力)', 'presentation must not rename configured agents');
  button.props.onClick();
  assert.deepEqual(opened, ['child-compact']);
  const failed = run({ stopReason: 'error', diagnostic: 'Account cannot use this model', preview: 'old result', endedAt: Date.now() });
  assert.equal(failed.props['data-status'], 'failed');
  assert.equal(failed.children.length, 1);
  assert.equal(failed.children[0].children[2].children[0], 'Account cannot use this model');
  assert.match(failed.children[0].props['aria-label'], /Account cannot use this model/);
  const custom = run({ agentId: 'custom-account' });
  assert.equal(custom.children[0].children[0].children[0].type, 'AgentIcon');
  const fullWidth = run({ agentName: 'Antigravity（反重力） · Work', modelName: undefined, model: 'gemini-4-carbon-high' });
  assert.equal(fullWidth.children[0].children[1].children[0].children[0], 'Antigravity · Work');
  assert.equal(fullWidth.children[0].children[1].children[1].children[0], 'gemini-4-carbon-high');
  assert.equal(run({ agentName: 'Custom (Work)' }).children[0].children[1].children[0].children[0], 'Custom (Work)');
});

test('prompt settlement releases host tool waiters even without terminal tool updates', async () => {
  for (const failure of [false, true]) {
    let settle;
    const turn = new AcpTurnExecution({ connection: { api: {
      makeDeferred: async () => ({}), prompt: () => new Promise((resolve, reject) => { settle = failure ? () => reject(new Error('Original ACP failure')) : () => resolve({ stopReason: 'end_turn' }); }),
    } } });
    const entry = turn.registerToolCall({ toolCallId: 'read', kind: 'read', status: 'in_progress' });
    let awake = false;
    entry.waiters.push(() => { awake = true; });
    turn.beginPrompt();
    await new Promise(resolve => setImmediate(resolve));
    settle();
    await turn.promptPromise;
    assert.equal(awake, true);
    assert.equal(entry.status, failure ? 'failed' : 'completed');
    if (failure) assert.match(entry.outputText, /Original ACP failure/);
  }
});

test('activation rejection writes a durable failed delegation rather than a permanent running row', async (t) => {
  mockPreparedConnection(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-reject-'));
  const storeFile = path.join(dir, 'acp-agents.json');
  saveAgentsConfig([{ id: 'reviewer', name: 'Reviewer', command: 'node', enabled: true, models: [{ id: 'default' }] }], storeFile);
  const events = [];
  const subagents = { getProvider: () => ({}), resolveMaxDepth: () => 2, startActivation: async () => ({ childId: 'rejected-child', result: Promise.reject(new Error('Connection lost')) }) };
  const manager = createAcpAgentsManager({ subagents }, { storeFile });
  try {
    const child = await manager.delegate({ agent: 'reviewer', prompt: 'review' }, { id: 'parent', status: 'idle', followup: () => {}, session: { header: { cwd: dir }, snapshotEvents: () => events, append: (type, data) => events.push({ type, data }) } }, new AbortController().signal, 'caller');
    assert.equal((await child.result).stopReason, 'error');
    assert.equal(events.at(-1).type, 'acp-delegation/end');
    assert.equal(events.at(-1).data.diagnostic, 'Connection lost');
  } finally { await manager.closeAllConnections(); fs.rmSync(dir, { recursive: true }); }
});

test('abort during host activation settles the accepted receipt without delivering a completion notice', async (t) => {
  mockPreparedConnection(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-admission-abort-'));
  const storeFile = path.join(dir, 'acp-agents.json');
  saveAgentsConfig([{ id: 'reviewer', name: 'Reviewer', command: 'node', enabled: true, models: [{ id: 'default' }] }], storeFile);
  const abort = new AbortController();
  const events = [];
  const parent = { id: 'parent', status: 'idle', followup: () => assert.fail('cancelled admission must not wake parent'), session: { header: { cwd: dir }, snapshotEvents: () => events, append: (type, data) => events.push({ type, data }) } };
  const subagents = { getProvider: () => ({}), resolveMaxDepth: () => 2, startActivation: async () => { abort.abort(); throw abort.signal.reason; } };
  const manager = createAcpAgentsManager({ subagents }, { storeFile });
  try {
    await assert.rejects(manager.delegate({ agent: 'reviewer', prompt: 'review' }, parent, abort.signal, 'caller'), { name: 'AbortError' });
    assert.equal(events.filter(event => event.type === 'acp-delegation/start').length, 1);
    const ends = events.filter(event => event.type === 'acp-delegation/end');
    assert.equal(ends.length, 1);
    assert.equal(ends[0].data.status, 'cancelled');
    assert.equal(ends[0].data.deliveryState, 'disposed');
    const persisted = JSON.parse(fs.readFileSync(path.join(dir, 'acp-tasks.json'))).tasks;
    assert.equal(persisted[0].status, 'cancelled');
  } finally { await manager.closeAllConnections(); fs.rmSync(dir, { recursive: true }); }
});

test('old delegation rows recover the child terminal state without replay or rewriting history', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-recover-'));
  const storeFile = path.join(dir, 'acp-agents.json');
  saveAgentsConfig([], storeFile);
  let released = 0;
  const logs = {
    parent: [{ type: 'acp-delegation/start', data: { childId: 'child', runId: 'run', startedAt: 10 } }],
    child: [{ type: 'turn/end', time: 20, data: { reason: { kind: 'aborted' } } }],
  };
  const manager = createAcpAgentsManager({ sessionQuery: { observeSession: async id => ({ events: logs[id] || [], [Symbol.dispose]: () => { released++; } }) } }, { storeFile });
  try {
    assert.deepEqual(await manager.handleRpc('delegation-status', { parentSessionId: 'parent', childId: 'child', runId: 'run' }), { endedAt: 20, stopReason: 'aborted' });
    await assert.rejects(manager.handleRpc('delegation-status', { parentSessionId: 'unrelated', childId: 'child', runId: 'run' }), /does not belong/);
    assert.equal(released, 3);
    assert.equal(logs.parent.length, 1);
  } finally { await manager.closeAllConnections(); fs.rmSync(dir, { recursive: true }); }
});

test('native directory routes and catalogs exclude disabled agents and hidden models', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-directory-'));
  const storeFile = path.join(dir, 'agents.json');
  saveAgentsConfig([
    { id: 'enabled', name: 'Enabled', command: 'node', enabled: true, models: [{ id: 'ready' }, { id: 'hidden' }], hiddenModels: ['hidden'] },
    { id: 'disabled', name: 'Disabled', command: 'node', enabled: false, models: [{ id: 'stale' }] },
  ], storeFile);
  let providers;
  const handle = () => {};
  handle.replace = value => { providers = value; };
  const manager = createAcpAgentsManager({ llm: { registerAdapter(value) { providers = value; return handle; } } }, { storeFile });
  try {
    manager.syncAdapterRoutes();
    assert.deepEqual(providers, ['acp:enabled']);
    assert.deepEqual((await manager.adapter.listModels('acp:enabled')).map(model => model.id), ['ready']);
    assert.deepEqual(await manager.adapter.listModels('acp:disabled'), []);
    assert.deepEqual(manager.listDelegationAgents().map(agent => agent.id), ['enabled']);
    await manager.handleRpc('agent/toggle', { id: 'enabled', enabled: false });
    assert.deepEqual(providers, []);
    assert.deepEqual(await manager.adapter.listModels('acp:enabled'), []);
  } finally { await manager.dispose(); fs.rmSync(dir, { recursive: true }); }
});

test('native directory offers only advertised reasoning and leaves model defaults to the agent', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-directory-effort-'));
  const storeFile = path.join(dir, 'agents.json');
  const efforts = [{ id: 'high', name: 'High' }, { id: 'max', name: 'Maximum' }];
  saveAgentsConfig([{ id: 'adjustable', name: 'Adjustable', enabled: true, models: [
    { id: 'fixed', defaultEffort: 'medium', efforts: [] },
    { id: 'dynamic', defaultEffort: 'high', efforts },
    { id: 'stale-default', defaultEffort: 'medium', efforts },
  ] }], storeFile);
  const manager = createAcpAgentsManager({}, { storeFile });
  try {
    const models = await manager.adapter.listModels('acp:adjustable');
    assert.equal(models[0].reasoning, undefined);
    const fixed = await manager.adapter.resolveModel('acp:adjustable', 'fixed');
    assert.equal(fixed.contextManagement, 'provider');
    assert.equal(fixed.context, undefined, 'unknown upstream capacity must remain unknown');
    for (const model of models.slice(1)) {
      assert.deepEqual(model.reasoning.efforts.map(effort => effort.id), ['high', 'max']);
      assert.equal(model.reasoning.defaultEffort, undefined, 'host model changes must not force a cached effort');
      assert.deepEqual((await manager.adapter.resolveModel('acp:adjustable', model.id)).reasoning, model.reasoning);
    }
  } finally { await manager.dispose(); fs.rmSync(dir, { recursive: true }); }
});

test('agent switching seeds context and returning agents receive missed turns', () => {
  const first = {};
  const messages = [message('1', 'user', 'Keep the UI blue'), message('2', 'assistant', 'Agreed'), message('3', 'user', 'Implement the selector')];
  assert.match(conversationPrompt(messages, first)[0].text, /Keep the UI blue/);
  assert.equal(first.promptCursor, '3');
  const next = [...messages, message('4', 'assistant', 'Selector ready'), message('5', 'user', 'Add keyboard support')];
  const prompt = conversationPrompt(next, first)[0].text;
  assert.match(prompt, /Selector ready/);
  assert.match(prompt, /Add keyboard support/);
  assert.doesNotMatch(prompt, /Keep the UI blue/);
  assert.equal(conversationPrompt(next, { restoredSession: true })[0].text, 'Add keyboard support');
  const attachmentPrompt = conversationPrompt([...messages, { id: 'file', role: 'user', content: [{ type: 'file', attachment: { name: 'requirements.md' } }] }], {});
  assert.match(attachmentPrompt[0].text, /Attached file: requirements.md/);
});

test('delegation messages and result notices reach ACP instead of replaying old user input', () => {
  for (const kind of ['agent-message', 'subagent-settled']) {
    assert.equal(extractLatestUserPromptBlocks([message('1', 'user', 'old'), message('2', 'user', 'child task', kind)])[0].text, 'child task');
  }
  assert.equal(extractLatestUserPromptBlocks([message('1', 'user', 'real'), message('2', 'user', 'marker', 'model-change')])[0].text, 'real');
});

test('bundled MCP injection uses the same product-owned namespace as the bridge', () => {
  const injection = runtimeBundle().acpMcpInjection({ endpoint: 'http://127.0.0.1:1', authorization: 'Bearer test', bridgeCommand: process.execPath, bridgeEntrypoint: '/bridge.cjs' });
  assert.equal(injection.acpServers[0].serverId, 'dsh-acp-agents');
  assert.equal(injection.processEnvironment.DSH_ACP_MCP_AUTHORIZATION, 'Bearer test');
  assert.equal(injection.processEnvironment.T3_ACP_MCP_AUTHORIZATION, undefined);
});

test('model settings use the newly selected live catalog and cannot override routing or permissions', async () => {
  const conn = new AcpSessionConnection({ agentConfig: { name: 'Dynamic settings' } });
  conn.ensureReady = async () => {};
  let selected = 'old';
  const applied = [];
  conn.api = {
    getConfigOptions: async () => [
      { type: 'select', id: 'model', category: 'model', options: [{ value: 'old' }, { value: 'new' }] },
      { type: 'select', id: 'effort', category: 'reasoning_effort', options: [{ value: selected === 'old' ? 'low' : 'high' }] },
      { type: 'select', id: 'format', options: [{ value: selected === 'old' ? 'text' : 'json' }] },
      { type: 'select', id: 'permissions', category: 'permission', options: [{ value: 'full' }] },
    ],
    setConfigOption: async (id, value) => { applied.push([id, value]); if (id === 'model') selected = value; },
  };
  conn.currentModel = 'old';
  conn.currentEffort = 'high'; // a previous model's cached value must not skip validation/application
  await conn.syncModelAndEffort('new', 'high', undefined, true);
  assert.deepEqual(applied, [['model', 'new'], ['effort', 'high']]);
  await conn.syncOption('format', 'json');
  await assert.rejects(conn.syncOption('format', 'text'), /not available/);
  await assert.rejects(conn.syncOption('model', 'old'), /Select models with model/);
  await assert.rejects(conn.syncOption('permissions', 'full'), /cannot raise permissions/);
  assert.deepEqual(applied.at(-1), ['format', 'json']);
  conn.api.getConfigOptions = async () => [];
  conn.currentEffort = undefined;
  await assert.rejects(conn.syncModelAndEffort(undefined, 'medium', undefined, true), /does not advertise/);
  await conn.syncModelAndEffort(undefined, 'medium'); // legacy composer default
});

test('configured agents share one discovery/delegation catalog and preserve parent selection', async (t) => {
  mockPreparedConnection(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-config-'));
  const storeFile = path.join(dir, 'acp-agents.json');
  saveAgentsConfig([{ id: 'reviewer', name: 'Reviewer', command: 'node', enabled: true, models: [{ id: 'review-model' }], env: { API_KEY: 'test-secret' } }], storeFile);
  const calls = [];
  const tools = new Map();
  const subagents = { getProvider: () => ({}), resolveMaxDepth: () => 2, startActivation: async (spec) => { calls.push(spec); return { childId: spec.childId, result: Promise.resolve({ output: [], stopReason: 'completed' }) }; }, registerProvider: (provider) => { assert.equal(provider.name, DELEGATION_PROVIDER); return () => {}; } };
  const ctx = { agents: new Map(), subagents, effect: (fn) => fn(), tools: { register: (definition) => { tools.set(definition.name, definition); return () => {}; } } };
  const manager = createAcpAgentsManager(ctx, { storeFile });
  try {
    registerDelegation(ctx, manager);
    const events = [];
    const parent = { id: 'parent', status: 'idle', followup: () => {}, session: { header: { cwd: dir }, snapshotEvents: () => events, append: (type, data) => events.push({ type, data }) }, options: { provider: 'native', model: 'main' } };
    const signal = new AbortController().signal;
    const catalog = await tools.get('acp_agents').execute({}, { agent: parent, signal });
    assert.deepEqual(catalog.agents.map((agent) => agent.id), ['reviewer']);
    assert.ok(!JSON.stringify(catalog).includes('test-secret'));
    const result = await tools.get('acp_delegate').execute({ agent: 'reviewer', prompt: 'review it' }, { agent: parent, signal });
    assert.equal(result.subagentId, calls[0].childId);
    assert.equal(calls[0].request.agentOptions.provider, 'acp:reviewer');
    assert.equal(calls[0].request.agentOptions.model, 'review-model');
    assert.equal(calls[0].request.maxDepth, 2);
    assert.equal(calls[0].parent, parent, 'flattened host API must receive the exact parent');
    assert.equal(calls[0].prompt, calls[0].request.prompt);
    assert.equal(calls[0].agentOptions, calls[0].request.agentOptions);
    assert.equal(calls[0].maxDepth, 2);
    assert.deepEqual(parent.options, { provider: 'native', model: 'main' });
    await assert.rejects(manager.delegate({ agent: 'missing', prompt: 'x' }, parent, signal, 'caller'), /not enabled/);
    await assert.rejects(manager.delegate({ agent: 'reviewer', prompt: '' }, parent, signal, 'caller'), /non-empty/);
    await assert.rejects(manager.delegate({ agent: 'reviewer', model: 'invented', prompt: 'review' }, parent, signal, 'caller'), /Available model ids: review-model/);
    assert.equal(calls.length, 1, 'invalid model must not start a child');
  } finally {
    await manager.closeAllConnections();
    // Only this test-created, absolute temporary directory is removed.
    fs.rmSync(dir, { recursive: true });
  }
});
