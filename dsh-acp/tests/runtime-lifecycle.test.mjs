import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { apply, createAcpAgentsManager } from '../lib/index.js';
import { AcpSessionConnection, AcpTurnExecution } from '../lib/acp-session.js';
import { configureRuntimeHost, initAgentRuntime, runtimeBundle } from '../lib/agent-runtime.js';
import { prepareConversationPrompt } from '../lib/prompt-context.js';
import { createTaskStore } from '../lib/tasks.js';
import { writeJsonStore } from '../lib/store-file.js';
import { approvalPolicyOf } from '../lib/host-contract.js';
import { executeTeamTool, listTeamMembers } from '../lib/team.js';
import { saveAgentsConfig } from '../lib/presets.js';

const tempDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

test('P1-1: ensureReady abort/timeout does not deadlock inside _close() waiting on hung _start()', async () => {
  const hung = deferred();
  const conn = new AcpSessionConnection({ cwd: os.tmpdir(), agentConfig: { id: 'hung', name: 'Hung' } });
  conn._start = () => hung.promise;
  const ac = new AbortController();
  const started = Date.now();
  setTimeout(() => ac.abort(new Error('user cancelled')), 30);
  await assert.rejects(conn.ensureReady(ac.signal), { name: 'AbortError' });
  await conn.close();
  assert.ok(Date.now() - started < 2000, '_close() must not block indefinitely on hung _startupPromise');
  assert.equal(conn.closed, true);
});

test('P1-2: 10 acp_* mirror tools register via ctx.inject(["tools"]) even when tools mounts late or reloads', async () => {
  const root = tempDir('acp-late-tools-');
  const storeFile = path.join(root, 'agents.json');
  saveAgentsConfig([], storeFile);
  const injectCallbacks = [];
  const registered = new Set();
  const cleanups = [];
  const hostCtx = {
    llm: { registerAdapter: () => () => {} },
    webServer: { getOrigin: () => 'http://127.0.0.1:0', register: () => () => {} },
    connection: { requestRejection: () => undefined },
    on: () => () => {},
    effect: (fn) => { const c = fn(); if (typeof c === 'function') cleanups.push(c); },
    inject: (deps, fn) => injectCallbacks.push({ deps, fn }),
  };
  apply(hostCtx, { storeFile });
  try {
    const toolsHook = injectCallbacks.find((entry) => Array.isArray(entry.deps) && entry.deps.length === 1 && entry.deps[0] === 'tools');
    assert.ok(toolsHook, 'apply() must register mirror tools via ctx.inject(["tools"], ...)');
    const toolDisposers = [];
    toolsHook.fn({
      effect: (fn) => { const d = fn(); if (typeof d === 'function') toolDisposers.push(d); },
      tools: {
        register: (tool) => {
          registered.add(tool.name);
          return () => registered.delete(tool.name);
        },
      },
    });
    assert.equal(registered.size, 10);
    assert.ok(registered.has('acp_read') && registered.has('acp_execute') && registered.has('acp_tool'));
    for (const d of toolDisposers) d();
    assert.equal(registered.size, 0);
  } finally {
    for (const c of cleanups.reverse()) await c();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1-3: autoDeliverWrites triggers on normal prompt-done in non-git dir and deduplicates already-presented files', async (t) => {
  const root = tempDir('acp-autodeliver-');
  const storeFile = path.join(root, 'agents.json');
  saveAgentsConfig([{ id: 'writer', name: 'Writer', enabled: true, command: process.execPath, models: [{ id: 'default' }] }], storeFile);
  const fileA = path.join(root, 'a.html');
  const fileB = path.join(root, 'b.html');
  fs.writeFileSync(fileA, '<h1>A</h1>');
  fs.writeFileSync(fileB, '<h1>B</h1>');

  const appended = [];
  const dshSession = {
    id: 'auto-session',
    header: { cwd: root },
    snapshotEvents: () => [],
    append: (type, data) => appended.push({ type, data }),
  };
  const dshAgent = { id: 'auto-session', options: { provider: 'acp:writer' }, session: dshSession };
  const ctx = {
    agents: new Map([[dshAgent.id, dshAgent]]),
    webServer: { getOrigin: () => 'http://127.0.0.1:0', register: () => () => {} },
    fs: {
      resolve: async (p, { cwd }) => path.resolve(cwd, p),
      stat: async (target) => (fs.existsSync(target) ? { type: 'file' } : undefined),
      processPath: (target) => target,
    },
    sessionProjections: { stateOf: () => ({ lastTurn: 1, openTurnStartSeq: 0 }) },
    get(name) { return this[name]; },
  };
  const manager = createAcpAgentsManager(ctx, { storeFile, autoDeliverWrites: true });
  t.mock.method(AcpSessionConnection.prototype, 'ensureReady', async function () {
    this.api = { getConfigOptions: async () => [], setSessionModel: async () => {} };
    this.writtenPaths.add(fileA);
    this.writtenPaths.add(fileB);
    // Mark fileA as already presented via whaleisle_present
    manager.whaleisleMcp.sessionFor(this.mcpToken)?.presented.add(fileA);
  });
  t.mock.method(AcpTurnExecution.prototype, 'beginPrompt', function () {
    this.complete({ stopReason: 'end_turn' });
  });

  try {
    for await (const _chunk of manager.adapter.stream({
      provider: 'acp:writer',
      model: 'default',
      sessionId: dshAgent.id,
      messages: [{ id: 'u1', role: 'user', content: [{ type: 'text', text: 'write files' }] }],
      signal: new AbortController().signal,
    })) { /* drain */ }

    const delivered = appended.filter((ev) => ev.type === 'deliverables/presented');
    assert.equal(delivered.length, 1, 'autoDeliverWrites must run before prompt-done returns');
    assert.deepEqual(delivered[0].data.files.map((f) => f.path), [fileB]);
  } finally {
    await manager.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1-4: foreground turn re-entry after tool-calls rebinds callOptions.signal so abort cancels cleanly without zombie turn', async (t) => {
  const root = tempDir('acp-reentry-signal-');
  const storeFile = path.join(root, 'agents.json');
  saveAgentsConfig([{ id: 'stepper', name: 'Stepper', enabled: true, command: process.execPath, models: [{ id: 'default' }] }], storeFile);
  const dshAgent = {
    id: 'step-session',
    options: { provider: 'acp:stepper' },
    session: { id: 'step-session', header: { cwd: root }, snapshotEvents: () => [], append() {} },
  };
  const manager = createAcpAgentsManager({ agents: new Map([[dshAgent.id, dshAgent]]) }, { storeFile });
  let cancelCount = 0;
  let promptStarts = 0;
  t.mock.method(AcpSessionConnection.prototype, 'ensureReady', async function () {
    this.api = {
      getConfigOptions: async () => [],
      setSessionModel: async () => {},
      cancel: async () => { cancelCount += 1; },
    };
  });
  t.mock.method(AcpTurnExecution.prototype, 'beginPrompt', function () {
    promptStarts += 1;
    this.attachSignal(this.signal);
    if (promptStarts === 1) {
      // Yield one completed tool call and keep turn open waiting for step 2
      this.registerToolCall({ toolCallId: 'tc-1', kind: 'read', status: 'completed', outputText: 'ok' });
    } else {
      this.queue.push({ type: 'text', text: 'FRESH_TURN_OK' });
      this.complete({ stopReason: 'end_turn' });
    }
  });

  try {
    const signal1 = new AbortController().signal;
    const step1Chunks = [];
    for await (const c of manager.adapter.stream({
      provider: 'acp:stepper', model: 'default', sessionId: dshAgent.id,
      messages: [{ id: 'u1', role: 'user', content: [{ type: 'text', text: 'step1' }] }],
      signal: signal1,
    })) step1Chunks.push(c);
    assert.equal(step1Chunks.at(-1).reason.kind, 'tool-calls');

    // Re-enter with a distinct step-2 AbortController and abort it
    const ac2 = new AbortController();
    setTimeout(() => ac2.abort(new Error('step2 cancelled')), 30);
    await assert.rejects(async () => {
      for await (const _c of manager.adapter.stream({
        provider: 'acp:stepper', model: 'default', sessionId: dshAgent.id,
        messages: [{ id: 'u1', role: 'user', content: [{ type: 'text', text: 'step1' }] }],
        signal: ac2.signal,
      })) { /* drain */ }
    }, { name: 'AbortError' });
    assert.equal(cancelCount, 1, 'aborting step-2 signal must invoke api.cancel()');

    // Subsequent user turn starts cleanly instead of reusing a zombie activeTurn
    const nextChunks = [];
    for await (const c of manager.adapter.stream({
      provider: 'acp:stepper', model: 'default', sessionId: dshAgent.id,
      messages: [
        { id: 'u1', role: 'user', content: [{ type: 'text', text: 'step1' }] },
        { id: 'u2', role: 'user', content: [{ type: 'text', text: 'fresh turn' }] },
      ],
      signal: new AbortController().signal,
    })) nextChunks.push(c);
    assert.equal(promptStarts, 2);
    assert.ok(nextChunks.some((c) => c.type === 'text-delta' && c.text.includes('FRESH_TURN_OK')));
  } finally {
    await manager.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1-5: prepareConversationPrompt passes slash commands verbatim, skips own previous reply on turn 2, and does not mutate cursor before async prep succeeds', async (t) => {
  const conn = { promptCursor: 'u1', lastAssistantMessageId: 'a1', agentConfig: { providerId: 'acp:alpha' } };
  const msgs = [
    { id: 'u1', role: 'user', content: [{ type: 'text', text: 'first' }] },
    { id: 'a1', role: 'assistant', provider: 'acp:alpha', content: [{ type: 'text', text: 'my own reply' }] },
    { id: 'u2', role: 'user', content: [{ type: 'text', text: 'second' }] },
  ];
  const turn2 = prepareConversationPrompt(msgs, conn);
  assert.deepEqual(turn2.prompt, [{ type: 'text', text: 'second' }]);
  assert.equal(turn2.nextCursor, 'u2');
  assert.equal(conn.promptCursor, 'u1', 'prepareConversationPrompt must remain pure without mutating conn');

  // Slash command on turn 2+ passes through verbatim without Conversation context wrapper
  const slashMsgs = [
    ...msgs.slice(0, 2),
    { id: 'u2', role: 'user', content: [{ type: 'text', text: '/compact' }] },
  ];
  const slash = prepareConversationPrompt(slashMsgs, { promptCursor: 'u1' });
  assert.deepEqual(slash.prompt, [{ type: 'text', text: '/compact' }]);

  // Async attachment failure must NOT advance conn.promptCursor
  const root = tempDir('acp-cursor-atomic-');
  const storeFile = path.join(root, 'agents.json');
  saveAgentsConfig([{ id: 'alpha', name: 'Alpha', enabled: true, command: process.execPath, models: [{ id: 'default' }] }], storeFile);
  const dshAgent = { id: 's-cur', options: { provider: 'acp:alpha' }, session: { id: 's-cur', header: { cwd: root }, snapshotEvents: () => [], append() {} } };
  const manager = createAcpAgentsManager({ agents: new Map([[dshAgent.id, dshAgent]]) }, { storeFile });
  let capturedConn;
  t.mock.method(AcpSessionConnection.prototype, 'ensureReady', async function () {
    capturedConn = this;
    this.supportsImages = false;
    this.api = { getConfigOptions: async () => [], setSessionModel: async () => {} };
  });
  try {
    const chunks = [];
    for await (const c of manager.adapter.stream({
      provider: 'acp:alpha', model: 'default', sessionId: dshAgent.id,
      messages: [{ id: 'u-img', role: 'user', content: [{ type: 'image', attachment: { attachmentId: 'img1', mediaType: 'image/png' } }] }],
      signal: new AbortController().signal,
    })) chunks.push(c);
    assert.equal(chunks.at(-1).reason.kind, 'error');
    assert.equal(capturedConn.promptCursor, undefined, 'failed attachment preparation must not commit promptCursor');
  } finally {
    await manager.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1-6 & P1-7(P2): ACP v2 state_update(idle) preserves promptResponse usage/stopReason; Antigravity question error settles pending tool', async () => {
  // P1-6: ACP v2 merge
  const conn = new AcpSessionConnection({ cwd: os.tmpdir(), agentConfig: { id: 'v2', name: 'V2' } });
  conn.protocolVersion = 2;
  conn.acpSessionId = 'v2-sess';
  conn.agentWork = { state: 'running' };
  const turn = new AcpTurnExecution({
    connection: conn,
    promptBlocks: [{ type: 'text', text: 'hi' }],
  });
  conn.activeTurn = turn;
  const openTool = turn.registerToolCall({ toolCallId: 'bg-read', kind: 'read', status: 'in_progress' });
  conn.api = {
    makeDeferred: async () => ({}),
    prompt: async () => ({ stopReason: 'end_turn', usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 } }),
  };
  await turn.beginPrompt();
  assert.equal(turn.promptDone, false, 'v2 turn waits for state_update idle');
  conn._onRuntimeEvent({
    _tag: 'UnknownUpdate',
    updateType: 'state_update',
    rawPayload: { sessionId: 'v2-sess', update: { sessionUpdate: 'state_update', state: 'idle' } },
  });
  assert.equal(turn.promptDone, true);
  assert.equal(turn.stopReason, 'end_turn');
  assert.deepEqual(turn.usage, { inputTokens: 12, outputTokens: 8, totalTokens: 20 });
  assert.equal(openTool.status, 'completed', 'preserved end_turn must settle open tool as completed, not failed');

  // P1-7(P2): Antigravity user-input early cancel / exception settles pending tool
  await initAgentRuntime();
  const agyConn = new AcpSessionConnection({
    cwd: os.tmpdir(),
    agentConfig: { name: 'Antigravity' },
    requestUserInput: async () => { throw new Error('question UI closed'); },
  });
  agyConn.wiring = { isAntigravity: true };
  agyConn.activeTurn = new AcpTurnExecution({ connection: agyConn });
  const req = {
    sessionId: 's',
    toolCall: { toolCallId: 'interaction_err', title: 'Choose', kind: 'other' },
    options: [{ optionId: 'a', name: 'A', kind: 'allow_once' }],
  };
  await assert.rejects(agyConn._resolvePermission(req, {}), /question UI closed/);
  assert.equal(agyConn.activeTurn.toolCalls.get('interaction_err').status, 'failed');
});

test('P1-8 & P1-9: null hostAgent does not crash requestAcpApproval/askHuman; configureRuntimeHost serializes multi-owner release', async (t) => {
  // P1-8
  const root = tempDir('acp-null-host-');
  const storeFile = path.join(root, 'agents.json');
  saveAgentsConfig([{ id: 'solo', name: 'Solo', enabled: true, command: process.execPath, models: [{ id: 'default' }] }], storeFile);
  const manager = createAcpAgentsManager({}, { storeFile });
  let capturedApproval, capturedUserInput;
  t.mock.method(AcpSessionConnection.prototype, 'ensureReady', async function () {
    capturedApproval = this.requestApproval;
    capturedUserInput = this.requestUserInput;
    this.api = { getConfigOptions: async () => [], setSessionModel: async () => {} };
  });
  t.mock.method(AcpTurnExecution.prototype, 'beginPrompt', function () {
    this.complete({ stopReason: 'end_turn' });
  });
  try {
    for await (const _c of manager.adapter.stream({
      provider: 'acp:solo', model: 'default', sessionId: 'no-agent-registered',
      messages: [{ id: 'u1', role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      signal: new AbortController().signal,
    })) { /* drain */ }
    const conn = new AcpSessionConnection({ cwd: root, agentConfig: { id: 'solo', name: 'Solo' } });
    const turn = new AcpTurnExecution({ connection: conn, hostAgent: null, signal: new AbortController().signal });
    const ok = await capturedApproval({ entry: { kind: 'execute', name: 'acp_execute', title: 'Run' }, turn, connection: conn }, { toolCall: { kind: 'execute' } });
    assert.equal(ok, false);
    await assert.rejects(capturedUserInput({ turn }, { id: 'q1', question: 'Q?', options: [] }), /live host session/i);
  } finally {
    await manager.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }

  // P1-9: interleaved release of two owners preserves surviving owner and serializes reload
  const releaseA = configureRuntimeHost({ tag: 'A' });
  const releaseB = configureRuntimeHost({ tag: 'B' });
  await releaseB();
  await initAgentRuntime();
  const releaseC = configureRuntimeHost({ tag: 'C' });
  await releaseA();
  await initAgentRuntime();
  await releaseC();
});

test('P1-10 & P1-11: tasks cancel/offer race, idle grandchild workState, diagnostic isolation, followup worktree metadata, and failed delegation cleanup', async (t) => {
  const root = tempDir('acp-tasks-race-');
  const storeFile = path.join(root, 'agents.json');
  try {
    // P1-10: cancel during offer() flush() must keep deliveryState='disposed' and purge parent.inbox
    const flushStarted = deferred();
    const releaseFlush = deferred();
    const history = [];
    const inbox = {
      nextTurn: [],
      nextStep: [],
      remove(id) {
        this.nextTurn = this.nextTurn.filter((m) => m.id !== id);
        this.nextStep = this.nextStep.filter((m) => m.id !== id);
      },
    };
    const parent = {
      id: 'p1', status: 'idle', inbox,
      session: { header: { cwd: root }, snapshotEvents: () => history, append: (type, data) => history.push({ type, data, seq: history.length, time: Date.now() }) },
      followup(msg) { inbox.nextTurn.push(msg); history.push({ type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, removedCount: 0, inserted: [msg] } }); },
      steer(msg) { inbox.nextStep.push(msg); },
    };
    let flushCalls = 0;
    const idleGrandchild = { id: 'grandchild-idle', status: 'idle' };
    const liveChild = { id: 'child-1', status: 'running', cancel() {}, session: { seq: 0 } };
    let listMode = 'idle-grandchild';
    const ctx = {
      agents: new Map([[parent.id, parent], [liveChild.id, liveChild], [idleGrandchild.id, idleGrandchild]]),
      logger: { warn() {} },
      sessionPersistence: {
        flush: async () => {
          flushCalls += 1;
          if (flushCalls === 2) { flushStarted.resolve(); await releaseFlush.promise; }
        },
      },
      sessionQuery: {
        observeSession: async () => ({ events: [], [Symbol.dispose]() {} }),
      },
      subagents: {
        drainChildren: async () => {},
        listDescendants: async () => (listMode === 'diagnostic'
          ? [{ id: 'broken-gc', kind: 'diagnostic', parentId: liveChild.id, depth: 1, reason: 'corrupt' }]
          : [{ id: idleGrandchild.id, kind: 'child', parentId: liveChild.id, depth: 1 }]),
        sendMessage: async () => 'msg-1',
      },
      get(name) { return this[name]; },
    };

    const store = createTaskStore(ctx, storeFile);
    const task = store.begin(parent, { childId: liveChild.id, agentName: 'Worker', model: 'm', delivery: 'caller', repositoryRoot: root, baseCommit: 'abc123' });

    // Idle grandchild must NOT mark workState as waiting_for_children
    const snap1 = await store.snapshot(parent, task.taskId);
    assert.equal(snap1.workState, 'working');

    // Corrupt diagnostic grandchild must NOT crash snapshot()
    listMode = 'diagnostic';
    const snap2 = await store.snapshot(parent, task.taskId);
    assert.equal(snap2.status, 'running');

    // Race cancel() while offer() is suspended in flush()
    const finishing = store.finish(parent, task, { stopReason: 'completed', output: [{ type: 'text', text: 'done' }] });
    await flushStarted.promise;
    await store.cancel(parent, task.taskId);
    releaseFlush.resolve();
    await finishing;
    assert.equal(task.deliveryState, 'disposed', 'offer() must not overwrite disposed after flush()');
    assert.equal(parent.inbox.nextTurn.length, 0, 'cancelled task notice must be removed from inbox');

    // Followup on terminal task inherits repositoryRoot & baseCommit
    await store.followup(parent, liveChild.id, 'continue work', new AbortController().signal);
    const nextTask = store.latest(parent.id, liveChild.id);
    assert.notEqual(nextTask.taskId, task.taskId);
    assert.equal(nextTask.repositoryRoot, root);
    assert.equal(nextTask.baseCommit, 'abc123');

    // P1-11: conn.close() failure still finishes task, and startActivation rejection cleans up unused worktree
    const repo = path.join(root, 'repo');
    fs.mkdirSync(repo);
    const git = (...args) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: repo, encoding: 'utf8', windowsHide: true });
    git('init', '-q');
    fs.writeFileSync(path.join(repo, 'f.txt'), 'v1\n');
    git('add', 'f.txt');
    git('commit', '-q', '-m', 'init');

    saveAgentsConfig([{ id: 'wt-agent', name: 'WT', enabled: true, command: process.execPath, models: [{ id: 'default' }] }], storeFile);
    t.mock.method(AcpSessionConnection.prototype, 'ensureReady', async function () {
      this.api = { getConfigOptions: async () => [], setSessionModel: async () => {} };
    });
    t.mock.method(AcpSessionConnection.prototype, 'close', async () => {
      throw new Error('simulated close error');
    });
    const events = [];
    const wtParent = { id: 'wt-p', status: 'idle', followup() {}, session: { id: 'wt-p', header: { cwd: repo }, snapshotEvents: () => events, append: (type, data) => events.push({ type, data }) } };
    const wtManager = createAcpAgentsManager({
      sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
      approval: { policyOf: () => 'never' },
      subagents: {
        getProvider: () => ({}),
        resolveMaxDepth: () => 2,
        startActivation: async () => { throw new Error('max depth reached'); },
      },
    }, { storeFile });
    try {
      await assert.rejects(
        wtManager.delegate({ agent: 'wt-agent', prompt: 'work', isolation: 'worktree' }, wtParent, new AbortController().signal, 'caller'),
        /max depth reached/,
      );
      assert.equal(events.filter((e) => e.type === 'acp-delegation/end').length, 1, 'task must settle even when conn.close() throws');
      const wtDir = path.join(repo, '.agent-worktrees');
      assert.deepEqual(fs.existsSync(wtDir) ? fs.readdirSync(wtDir) : [], [], 'unused worktree must be removed when startActivation fails');
    } finally {
      await wtManager.dispose();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P2 contracts: writeJsonStore retries transient EBUSY/EPERM, approvalPolicyOf fails closed on unknown object, and team.js validates filter types', async (t) => {
  // writeJsonStore transient Windows rename retry
  const root = tempDir('acp-store-retry-');
  try {
    const file = path.join(root, 'state.json');
    fs.writeFileSync(file, '{"v":0}');
    const origRename = fs.renameSync;
    let attempts = 0;
    const mock = t.mock.method(fs, 'renameSync', (...args) => {
      attempts += 1;
      if (attempts <= 2) {
        const err = new Error('busy');
        err.code = 'EBUSY';
        throw err;
      }
      return origRename(...args);
    });
    writeJsonStore(file, '{"v":1}');
    mock.mock.restore();
    assert.equal(attempts, 3);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { v: 1 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  // approvalPolicyOf: undefined -> 'never' (backward compat), unknown non-null object -> 'ask' (fail-closed)
  assert.equal(approvalPolicyOf(undefined, {}), 'never');
  assert.equal(approvalPolicyOf(null, {}), 'never');
  assert.equal(approvalPolicyOf({ unknownMethod: () => 'never' }, {}), 'ask');

  // team.js filter type validation & null rootOf guard
  const teamCtx = {
    agentTeams: { isEnabled: () => true, listTasks: () => [] },
    subagents: { resolveName: async (_c, n) => n, rootOf: () => null },
    agents: new Map(),
    get(name) { return this[name]; },
  };
  const caller = { id: 'lead' };
  const sig = new AbortController().signal;
  await assert.rejects(executeTeamTool(teamCtx, 'team_task_list', { status: 'bogus' }, caller, sig), /status/);
  await assert.rejects(executeTeamTool(teamCtx, 'team_task_list', { unowned: 'false' }, caller, sig), /unowned/);
  await assert.rejects(executeTeamTool(teamCtx, 'team_task_list', { ready: 'true' }, caller, sig), /ready/);
  await assert.rejects(listTeamMembers(teamCtx, caller, sig), /Unable to resolve team root session/);
});
