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
  assert.ok(!Object.values(tool.parameters).some((parameter) => parameter.required));
  const exec = { agent: { id: 'parent' }, signal: new AbortController().signal };
  await tool.execute({ task_id: 'task-1' }, exec);
  await tool.execute({ agent_id: 'child-1', wait_ms: 500 }, exec);
  assert.deepEqual(waits, [['task-1', 0], ['task-1', 500]]);
  assert.throws(() => tool.execute({}, exec), /task_id or agent_id/);
  assert.throws(() => tool.execute({ task_id: 'task-1', wait_ms: 30000 }, exec), /wait_ms/);
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
    assert.equal(host.get(tool.name).description, tool.description);
    assert.deepEqual(Object.keys(host.get(tool.name).parameters), Object.keys(tool.inputSchema.properties));
  }
});
