import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadAgentsConfig, saveAgentsConfig, loadSessionStore, saveSessionStore } from '../lib/presets.js';
import { createTaskStore } from '../lib/tasks.js';
import { readJsonStore, writeJsonStore, listStoreIssues } from '../lib/store-file.js';
import { createTaskCheckout } from '../lib/isolation.js';
import { acpRuntimePolicy } from '../lib/host-contract.js';
import { runtimeBundle, initAgentRuntime } from '../lib/agent-runtime.js';

const tempDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const quietly = (t) => t.mock.method(console, 'warn', () => {});

test('an unreadable agent store is preserved instead of being overwritten by the next save', (t) => {
  quietly(t);
  const dir = tempDir('acp-corrupt-agents-');
  try {
    const file = path.join(dir, 'acp-agents.json');
    const original = '{ "version": 2, "agents": [{ "id": "mine", "env": { "API_KEY": "secret" } },] }';
    fs.writeFileSync(file, original);
    const loaded = loadAgentsConfig(file);
    assert.ok(!loaded.some((agent) => agent.id === 'mine'));
    saveAgentsConfig(loaded, file);
    const preserved = fs.readdirSync(dir).filter((name) => name.startsWith('acp-agents.json.corrupt-'));
    assert.equal(preserved.length, 1);
    assert.equal(fs.readFileSync(path.join(dir, preserved[0]), 'utf8'), original);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('an unreadable task or session store does not prevent startup and is preserved', (t) => {
  quietly(t);
  const dir = tempDir('acp-corrupt-tasks-');
  try {
    const storeFile = path.join(dir, 'acp-agents.json');
    fs.writeFileSync(path.join(dir, 'acp-tasks.json'), '{"tasks":');
    fs.writeFileSync(path.join(dir, 'acp-agent-sessions.json'), '[]');
    const store = createTaskStore({}, storeFile);
    assert.equal(store.tasks.size, 0);
    assert.deepEqual(loadSessionStore(storeFile), {});
    const names = fs.readdirSync(dir);
    assert.ok(names.some((name) => name.startsWith('acp-tasks.json.corrupt-')));
    assert.ok(names.some((name) => name.startsWith('acp-agent-sessions.json.corrupt-')));
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('stores containing credentials, prompts and results are owner-only', { skip: process.platform === 'win32' }, () => {
  const dir = tempDir('acp-store-mode-');
  try {
    const storeFile = path.join(dir, 'acp-agents.json');
    saveAgentsConfig([{ id: 'mine', name: 'Mine', command: 'node', env: { API_KEY: 'secret' } }], storeFile);
    saveSessionStore({ conversation: 'external' }, storeFile);
    createTaskStore({}, storeFile).save();
    for (const name of ['acp-agents.json', 'acp-agent-sessions.json', 'acp-tasks.json']) {
      assert.equal(fs.statSync(path.join(dir, name)).mode & 0o777, 0o600, name);
    }
    assert.deepEqual(fs.readdirSync(dir).filter((name) => name.includes('.tmp')), []);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('old settled receipts retain exact results and idempotency across restart', async () => {
  const dir = tempDir('acp-task-prune-');
  try {
    const settled = Array.from({ length: 505 }, (_, index) => ({
      taskId: `settled-${index}`, parentId: 'parent', childId: `child-${index}`, endedAt: 1000 + index, status: 'completed', deliveryState: 'acknowledged',
      output: [{ type: 'text', text: `result-${index}` }], requestKey: `parent\0request-${index}`, requestArguments: JSON.stringify({ prompt: `work-${index}` }),
    }));
    const kept = [
      { taskId: 'running', parentId: 'parent', childId: 'child-running', status: 'running', deliveryState: 'pending', output: [] },
      { taskId: 'undelivered', parentId: 'parent', childId: 'child-undelivered', endedAt: 1, status: 'completed', deliveryState: 'pending', output: [] },
    ];
    fs.writeFileSync(path.join(dir, 'acp-tasks.json'), JSON.stringify({ version: 1, tasks: [...kept, ...settled] }));
    const store = createTaskStore({}, path.join(dir, 'acp-agents.json'));
    store.save();
    const ids = new Set(JSON.parse(fs.readFileSync(path.join(dir, 'acp-tasks.json'), 'utf8')).tasks.map((task) => task.taskId));
    assert.equal(ids.size, 507);
    assert.ok(ids.has('running') && ids.has('undelivered'));
    const reopened = createTaskStore({}, path.join(dir, 'acp-agents.json'));
    assert.equal(reopened.get('parent', 'settled-0').output[0].text, 'result-0');
    const retry = await reopened.once({ id: 'parent' }, 'request-0', { prompt: 'work-0' }, () => assert.fail('must not start a duplicate'));
    assert.equal(retry.taskId, 'settled-0');
    assert.equal(retry.recovered, true);
    await assert.rejects(reopened.once({ id: 'parent' }, 'request-0', { prompt: 'changed' }, () => assert.fail('must not start a duplicate')), /different task arguments/);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('task checkouts are excluded from the parent repository status', async () => {
  const dir = tempDir('acp-worktree-exclude-');
  try {
    const git = (...args) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: dir, encoding: 'utf8' });
    git('init', '-q');
    git('config', 'core.autocrlf', 'false');
    fs.writeFileSync(path.join(dir, 'tracked.txt'), 'base\n');
    git('add', 'tracked.txt'); git('commit', '-q', '-m', 'base');
    await createTaskCheckout(dir, 'first');
    await createTaskCheckout(dir, 'second');
    assert.equal(git('status', '--porcelain', '--untracked-files=all'), '');
    const exclude = fs.readFileSync(path.join(dir, '.git', 'info', 'exclude'), 'utf8');
    assert.equal(exclude.split('\n').filter((line) => line === '/.agent-worktrees/').length, 1);
    assert.equal(fs.readFileSync(path.join(dir, '.agent-worktrees', 'second', 'tracked.txt'), 'utf8'), 'base\n');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('only an unrestricted host sandbox puts the agent in its own no-prompt mode', async () => {
  await initAgentRuntime();
  const { AntigravityAcpSupport, AcpClientPolicy } = runtimeBundle().providers;
  const cwd = '/workspace';
  const sandboxed = acpRuntimePolicy({ cwd, readOnly: false, sandboxMode: 'workspace-write', ask: false });
  assert.equal(sandboxed.runtimeMode, 'approval-required');
  assert.equal(AntigravityAcpSupport.antigravityPermissionMode(sandboxed.runtimeMode), 'default');
  // The client policy then enforces the sandbox without asking.
  assert.equal(AcpClientPolicy.acpPermissionDisposition(sandboxed, { toolCall: { kind: 'execute' } }), 'deny');
  assert.equal(AcpClientPolicy.acpPermissionDisposition(sandboxed, { toolCall: { kind: 'edit', locations: [{ path: '/workspace/a.txt' }] } }), 'allow');
  assert.equal(AcpClientPolicy.acpPermissionDisposition(sandboxed, { toolCall: { kind: 'edit', locations: [{ path: '/etc/passwd' }] } }), 'deny');

  const unrestricted = acpRuntimePolicy({ cwd, readOnly: false, sandboxMode: 'danger-full-access', ask: false });
  assert.equal(AntigravityAcpSupport.antigravityPermissionMode(unrestricted.runtimeMode), 'yolo');
  assert.equal(acpRuntimePolicy({ cwd, readOnly: false, sandboxMode: 'danger-full-access', ask: true }).runtimeMode, 'approval-required');
  assert.equal(acpRuntimePolicy({ cwd, readOnly: true, sandboxMode: 'danger-full-access', ask: false }).sandboxPolicy.type, 'readOnly');
});

test('host acp_result accepts the documented task_id, agent_id and wait_ms forms', async () => {
  const { registerDelegation } = await import('../lib/delegation.js');
  const tools = new Map();
  const ctx = { effect: (fn) => fn(), subagents: { registerProvider() {} }, tools: { register: (tool) => tools.set(tool.name, tool) } };
  const tasks = new Map([['task-1', { taskId: 'task-1', childId: 'child-1', parentId: 'parent' }]]);
  const waits = [];
  const manager = {
    tasks: { get: (parentId, id) => { const task = tasks.get(id) || [...tasks.values()].find((item) => item.childId === id); if (!task || task.parentId !== parentId) throw new Error('unknown'); return task; } },
    waitTask: async (agent, taskId, waitMs) => { waits.push([taskId, waitMs]); return { taskId }; },
  };
  registerDelegation(ctx, manager);
  const tool = tools.get('acp_result');
  assert.equal(tool.parameters.type, 'object');
  assert.equal(tool.parameters.required, undefined);
  assert.ok(!Object.values(tool.parameters.properties).some((parameter) => parameter.required));
  const exec = { agent: { id: 'parent' }, signal: new AbortController().signal };
  await tool.execute({ task_id: 'task-1' }, exec);
  await tool.execute({ agent_id: 'child-1', wait_ms: 500 }, exec);
  assert.deepEqual(waits, [['task-1', 0], ['task-1', 500]]);
  await assert.rejects(tool.execute({}, exec), /task_id or agent_id/);
  await assert.rejects(tool.execute({ task_id: 'task-1', wait_ms: 30000 }, exec), /wait_ms/);
});

test('existing loose stores and default profiles are restricted without removing temporary files', { skip: process.platform === 'win32' }, async () => {
  const { appendPrivateLog, readJsonStore } = await import('../lib/store-file.js');
  const { createAcpAgentsManager } = await import('../lib/index.js');
  const dir = tempDir('acp-loose-');
  try {
    const storeFile = path.join(dir, 'acp-agents.json');
    fs.writeFileSync(storeFile, JSON.stringify({ version: 2, agents: [] }), { mode: 0o644 });
    fs.chmodSync(storeFile, 0o644);
    const profiles = path.join(dir, 'acp-profiles');
    fs.mkdirSync(profiles, { mode: 0o755 }); fs.chmodSync(profiles, 0o755);
    const stale = `${storeFile}.tmp-1-1-1`, fresh = `${storeFile}.tmp-2-2-2`, legacy = path.join(dir, 'acp-tasks.json.tmp');
    for (const file of [stale, fresh, legacy]) fs.writeFileSync(file, '{"secret":true}');
    const old = new Date(Date.now() - 120_000);
    fs.utimesSync(stale, old, old); fs.utimesSync(legacy, old, old);
    const manager = createAcpAgentsManager({}, { storeFile });
    try {
      assert.equal(fs.statSync(storeFile).mode & 0o777, 0o600);
      assert.equal(fs.statSync(profiles).mode & 0o777, 0o700);
      assert.ok(fs.existsSync(stale) && fs.existsSync(legacy));
      assert.ok(fs.existsSync(fresh), 'a concurrent writer\'s temporary file is left alone');
    } finally { await manager.dispose(); }
    assert.equal(readJsonStore(path.join(dir, 'missing.json'), { fallback: 'none' }), 'none');
    const log = path.join(dir, 'acp-error.log');
    appendPrivateLog(log, 'proxy https://user:pass@example.test Bearer abc.def access_token=xyz\n', { maxBytes: 64 });
    assert.equal(fs.statSync(log).mode & 0o777, 0o600);
    assert.doesNotMatch(fs.readFileSync(log, 'utf8'), /pass@|abc\.def|xyz/);
    appendPrivateLog(log, 'second\n', { maxBytes: 64 });
    assert.equal(fs.readFileSync(log, 'utf8'), 'second\n');
    assert.ok(fs.existsSync(`${log}.1`));
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('the settings catalog reports preserved files after clean reads and a new process', async (t) => {
  quietly(t);
  const { createAcpAgentsManager } = await import('../lib/index.js');
  const { listStoreIssues } = await import('../lib/store-file.js');
  const dir = tempDir('acp-store-issue-');
  try {
    const storeFile = path.join(dir, 'acp-agents.json');
    fs.writeFileSync(storeFile, 'not json');
    const manager = createAcpAgentsManager({}, { storeFile });
    try {
      const issue = (await manager.buildCatalog()).storeIssues.find((item) => item.file === storeFile);
      assert.ok(issue && fs.existsSync(issue.preservedAs));
      saveAgentsConfig([], storeFile);
      loadAgentsConfig(storeFile);
      assert.ok(listStoreIssues().some((item) => item.preservedAs === issue.preservedAs));
      const script = `import {readJsonStore,listStoreIssues} from ${JSON.stringify(new URL('../lib/store-file.js', import.meta.url).href)}; readJsonStore(process.argv[1]); console.log(JSON.stringify(listStoreIssues()));`;
      const restarted = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script, storeFile], { encoding: 'utf8' }));
      assert.ok(restarted.some((item) => item.preservedAs === issue.preservedAs));
      fs.renameSync(issue.preservedAs, storeFile);
      fs.writeFileSync(storeFile, JSON.stringify({ version: 2, agents: [] }));
      loadAgentsConfig(storeFile);
      assert.ok(!listStoreIssues().some((item) => item.file === storeFile));
    } finally { await manager.dispose(); }
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('store reads preserve old temporary files and failed writes clean only their own file', () => {
  const dir = tempDir('acp-owned-write-');
  try {
    const file = path.join(dir, 'store.json');
    writeJsonStore(file, '{"ok":true}');
    const foreign = [`${file}.tmp.keep`, `${file}.tmp-1-1-1`];
    const old = new Date(Date.now() - 120_000);
    for (const name of foreign) { fs.writeFileSync(name, 'keep'); fs.utimesSync(name, old, old); }
    assert.deepEqual(readJsonStore(file), { ok: true });
    const blocked = path.join(dir, 'blocked.json');
    fs.mkdirSync(blocked);
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.throws(() => writeJsonStore(blocked, '{}'));
      writeJsonStore(file, '{"ok":true}');
      assert.deepEqual(fs.readdirSync(dir).filter((name) => name.includes('.tmp')).sort(), foreign.map((name) => path.basename(name)).sort());
      for (const name of foreign) assert.equal(fs.readFileSync(name, 'utf8'), 'keep');
    }
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('host tools and the MCP bridge publish identical task-control schemas', async () => {
  const { registerDelegation, AGENT_TOOLS, CONTROL_TOOLS } = await import('../lib/delegation.js');
  const { createWhaleIsleMcp } = await import('../lib/mcp-server.js');
  const host = new Map();
  registerDelegation({ effect: (fn) => fn(), subagents: { registerProvider() {} }, tools: { register: (tool) => host.set(tool.name, tool) } }, {});
  const mcp = createWhaleIsleMcp({ ctx: {} });
  const listed = (await mcp.dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, {})).body.result.tools;
  for (const tool of [...AGENT_TOOLS, ...CONTROL_TOOLS]) {
    const remote = listed.find((item) => item.name === tool.name);
    assert.deepEqual(remote, tool, tool.name);
    const compiled = host.get(tool.name);
    assert.equal(typeof compiled.description, 'string', `${tool.name} root description must be a string`);
    assert.equal(compiled.description, tool.description);
    assert.equal(compiled.parameters.type, 'object');
    assert.equal(compiled.parameters.description, undefined, `${tool.name} compiled parameters must not leak a root description`);
    assert.deepEqual(Object.keys(compiled.parameters.properties), Object.keys(tool.inputSchema.properties));
    assert.deepEqual(compiled.parameters.required, tool.inputSchema.required);
  }
  const delegateSchema = host.get('acp_delegate').parameters;
  assert.deepEqual(delegateSchema.properties.options.items.properties.value, { oneOf: [{ type: 'string' }, { type: 'boolean' }] });
  assert.deepEqual(delegateSchema.properties.options.items.required, ['id', 'value']);
  assert.equal(delegateSchema.properties.timeout_ms.minimum, undefined);
  assert.equal(delegateSchema.properties.timeout_ms.maximum, undefined);
  assert.equal(host.get('acp_result').parameters.properties.wait_ms.minimum, undefined);
  assert.equal(host.get('acp_result').parameters.properties.wait_ms.maximum, undefined);
  await assert.rejects(host.get('acp_delegate').execute({ agent: 'a', prompt: 'p', timeout_ms: 20001 }, { agent: { id: 'p' }, signal: new AbortController().signal }), /timeout_ms/);
  await assert.rejects(host.get('acp_delegate').execute({ agent: 'a', prompt: 'p', timeout_ms: -1 }, { agent: { id: 'p' }, signal: new AbortController().signal }), /timeout_ms/);
});

test('delegate cwd blocks APPDATA, LOCALAPPDATA, ~/.config and userData subdirectories', async (t) => {
  const { validateExplicitDelegateCwd } = await import('../lib/delegate-cwd.js');
  const root = tempDir('acp-cwd-guard-');
  const prevEnv = {
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
  };
  try {
    const fakeHome = path.join(root, 'home');
    const dotConfigSub = path.join(fakeHome, '.config', 'whale-secret');
    const appDataSub = path.join(root, 'roaming-appdata', 'vendor-app');
    const localAppDataSub = path.join(root, 'local-appdata', 'vendor-cache');
    const xdgConfigSub = path.join(root, 'xdg-config', 'nested');
    const userData = path.join(root, 'electron-userdata');
    const dshHome = path.join(userData, 'dsh-home');
    const siblingUserData = path.join(userData, 'chisacode-home');
    const safeProject = path.join(root, 'workspace', 'my-project');
    for (const dir of [dotConfigSub, appDataSub, localAppDataSub, xdgConfigSub, dshHome, siblingUserData, safeProject]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    t.mock.method(os, 'homedir', () => fakeHome);
    process.env.APPDATA = path.join(root, 'roaming-appdata');
    process.env.LOCALAPPDATA = path.join(root, 'local-appdata');
    process.env.XDG_CONFIG_HOME = path.join(root, 'xdg-config');
    process.env.XDG_DATA_HOME = path.join(root, 'xdg-data');

    for (const forbidden of [appDataSub, localAppDataSub, dotConfigSub, xdgConfigSub]) {
      assert.throws(() => validateExplicitDelegateCwd(forbidden, { dshHome }), /系统配置或凭据目录/);
    }
    assert.throws(() => validateExplicitDelegateCwd(siblingUserData, { dshHome }), /应用数据目录/);
    assert.equal(validateExplicitDelegateCwd(safeProject, { dshHome }), fs.realpathSync.native(safeProject));
  } finally {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('root session ACP connections release subprocesses and MCP tokens on ctx.effect or agent/disposed', async (t) => {
  const { createAcpAgentsManager, apply } = await import('../lib/index.js');
  const { AcpSessionConnection, AcpTurnExecution } = await import('../lib/acp-session.js');
  const root = tempDir('acp-root-dispose-');
  const storeFile = path.join(root, 'agents.json');
  saveAgentsConfig([{ id: 'root-agent', name: 'Root Agent', enabled: true, command: process.execPath, models: [{ id: 'default' }] }], storeFile);
  let closedCount = 0;
  t.mock.method(AcpSessionConnection.prototype, 'ensureReady', async function () {
    this.api = { getConfigOptions: async () => [], setSessionModel: async () => {} };
  });
  t.mock.method(AcpSessionConnection.prototype, 'close', async function () {
    if (!this.closed) {
      this.closed = true;
      closedCount += 1;
    }
  });
  t.mock.method(AcpTurnExecution.prototype, 'beginPrompt', function () {
    this.complete({ stopReason: 'end_turn' });
  });

  // 1) Root session disposed via agent.ctx.effect (IdleSessionRelease / handle.dispose)
  const effectDisposers = [];
  const rootHost = {
    id: 'root-session-1',
    options: { provider: 'acp:root-agent' },
    session: { id: 'root-session-1', header: { cwd: root }, snapshotEvents: () => [], append() {} },
    ctx: { effect: (gen) => { const it = gen(); const step = it.next(); if (typeof step.value === 'function') effectDisposers.push(step.value); } },
  };
  const manager = createAcpAgentsManager({
    agents: { get: (id) => (id === rootHost.id ? rootHost : undefined) },
    webServer: { getOrigin: () => 'http://127.0.0.1:0', register: () => () => {} },
  }, { storeFile });
  try {
    for await (const _chunk of manager.adapter.stream({ provider: 'acp:root-agent', model: 'default', sessionId: rootHost.id, messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'hi' }] }], signal: new AbortController().signal })) { /* drain */ }
    const active = (await manager.buildCatalog()).activeSessions;
    assert.equal(active.length, 1);
    const issuedTokens = [];
    // Verify mcpToken was issued and is active before disposal
    const prevRevoke = manager.whaleisleMcp.revokeToken.bind(manager.whaleisleMcp);
    t.mock.method(manager.whaleisleMcp, 'revokeToken', (tok) => { issuedTokens.push(tok); return prevRevoke(tok); });
    assert.equal(effectDisposers.length, 1);
    await effectDisposers[0]();
    assert.equal(closedCount, 1);
    assert.equal(issuedTokens.length, 1);
    assert.equal(manager.whaleisleMcp.sessionFor(issuedTokens[0]), null);
    assert.equal((await manager.buildCatalog()).activeSessions.length, 0);

    // 2) Root session disposed via agent/disposed event without agent.ctx.effect
    const listeners = new Map();
    const hostCtx = {
      agents: { get: (id) => (id === 'root-session-2' ? rootHost2 : undefined) },
      webServer: { getOrigin: () => 'http://127.0.0.1:0', register: () => () => {} },
      llm: { registerAdapter: () => () => {} },
      on(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, []); listeners.get(ev).push(fn); return () => {}; },
      inject() {},
      effect() {},
    };
    const rootHost2 = {
      id: 'root-session-2',
      options: { provider: 'acp:root-agent' },
      session: { id: 'root-session-2', header: { cwd: root }, snapshotEvents: () => [], append() {} },
    };
    // Verify releaseAgentConnections closes & revokes even without ctx.effect
    for await (const _chunk of manager.adapter.stream({ provider: 'acp:root-agent', model: 'default', sessionId: rootHost2.id, messages: [{ id: 'm2', role: 'user', content: [{ type: 'text', text: 'hi2' }] }], signal: new AbortController().signal })) { /* drain */ }
    assert.equal((await manager.buildCatalog()).activeSessions.length, 1);
    await manager.releaseAgentConnections(rootHost2);
    assert.equal(closedCount, 2);
    assert.equal(issuedTokens.length, 2);
    assert.equal(manager.whaleisleMcp.sessionFor(issuedTokens[1]), null);
    assert.equal((await manager.buildCatalog()).activeSessions.length, 0);
    // apply() registers agent/disposed listener
    apply(hostCtx, { storeFile });
    assert.ok((listeners.get('agent/disposed') || []).length >= 1);
  } finally {
    await manager.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('requestAcpApproval honors allowed-always, session/options guards non-object option, and failed worktree preparation cleans up', async (t) => {
  const { createAcpAgentsManager } = await import('../lib/index.js');
  const { AcpSessionConnection, AcpTurnExecution } = await import('../lib/acp-session.js');
  const root = tempDir('acp-p2-fixes-');
  const storeFile = path.join(root, 'agents.json');
  saveAgentsConfig([{ id: 'p2-agent', name: 'P2 Agent', enabled: true, command: process.execPath, models: [{ id: 'default', options: [{ id: 'opt', type: 'boolean' }] }] }], storeFile);

  // 1) session/options non-object option guard
  const manager = createAcpAgentsManager({
    approval: {
      policyOf: () => 'ask',
      request: async () => 'allowed-always',
    },
    sandboxPolicy: { resolve: () => ({ mode: 'workspace-write' }) },
    subagents: { getProvider: () => ({}), resolveMaxDepth: () => 2 },
  }, { storeFile });

  try {
    for (const badOption of [null, 'bad', 123, ['arr']]) {
      await assert.rejects(
        manager.handleRpc('session/options', { sessionId: 's1', agentId: 'p2-agent', model: 'default', option: badOption }),
        /plain object/,
      );
    }

    // 2) allowed-always approval flows through requestApproval -> acceptForSession
    t.mock.method(AcpSessionConnection.prototype, 'ensureReady', async function () {
      this.api = { getConfigOptions: async () => [], setSessionModel: async () => {} };
    });
    const hostAgent = {
      id: 'root-approval',
      session: { id: 'root-approval', header: { cwd: root }, snapshotEvents: () => [], append() {} },
    };
    let capturedRequestApproval;
    const origResolve = AcpSessionConnection.prototype._resolvePermission;
    t.mock.method(AcpSessionConnection.prototype, 'ensureReady', async function () {
      capturedRequestApproval = this.requestApproval;
      this.api = { getConfigOptions: async () => [], setSessionModel: async () => {} };
    });
    t.mock.method(AcpTurnExecution.prototype, 'beginPrompt', function () { this.complete({ stopReason: 'end_turn' }); });
    for await (const _c of manager.adapter.stream({ provider: 'acp:p2-agent', model: 'default', sessionId: 'root-approval', messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'hi' }] }], signal: new AbortController().signal })) { /* drain */ }
    // Verify directly via captured requestApproval & AcpSessionConnection._resolvePermission
    assert.equal(typeof capturedRequestApproval, 'function');
    const connForPerm = new AcpSessionConnection({
      agentConfig: { name: 'P2' },
      requestApproval: capturedRequestApproval,
      getRuntimePolicy: () => ({
        cwd: root,
        runtimeMode: 'approval-required',
        approvalPolicy: 'on-request',
        sandboxPolicy: { type: 'workspaceWrite', writableRoots: [root] },
      }),
    });
    connForPerm.activeTurn = new AcpTurnExecution({ connection: connForPerm, hostAgent, signal: new AbortController().signal });
    const permRes = await origResolve.call(connForPerm, {
      sessionId: 's',
      toolCall: { toolCallId: 'tc1', title: 'Run cmd', kind: 'execute' },
      options: [
        { optionId: 'once', name: 'Once', kind: 'allow_once' },
        { optionId: 'always', name: 'Always', kind: 'allow_always' },
      ],
    }, connForPerm.getRuntimePolicy());
    assert.deepEqual(permRes, { outcome: { outcome: 'selected', optionId: 'always' } });

    // 3) prepareDelegationConnection failure cleans up orphaned worktree
    const repo = path.join(root, 'repo');
    fs.mkdirSync(repo);
    const git = (...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: repo, encoding: 'utf8', windowsHide: true });
    git('init', '-q');
    fs.writeFileSync(path.join(repo, 'file.txt'), 'v1\n');
    git('add', 'file.txt');
    git('commit', '-q', '-m', 'init');

    t.mock.method(AcpSessionConnection.prototype, 'ensureReady', async () => {
      throw new Error('simulated startup failure');
    });
    const parent = {
      id: 'parent-wt',
      status: 'idle',
      followup() {},
      session: { id: 'parent-wt', header: { cwd: repo }, snapshotEvents: () => [], append() {} },
    };
    const wtManager = createAcpAgentsManager({
      sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
      approval: { policyOf: () => 'never' },
      subagents: { getProvider: () => ({}), resolveMaxDepth: () => 2 },
    }, { storeFile });
    try {
      await assert.rejects(
        wtManager.delegate({ agent: 'p2-agent', prompt: 'do work', isolation: 'worktree' }, parent, new AbortController().signal, 'caller'),
        /simulated startup failure/,
      );
      const worktreeBase = path.join(repo, '.agent-worktrees');
      const remaining = fs.existsSync(worktreeBase) ? fs.readdirSync(worktreeBase) : [];
      assert.deepEqual(remaining, [], 'orphaned worktree must be removed when preparation fails');
      const listedWorktrees = git('worktree', 'list', '--porcelain');
      assert.doesNotMatch(listedWorktrees, /\.agent-worktrees/);
    } finally {
      await wtManager.dispose();
    }
  } finally {
    await manager.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
