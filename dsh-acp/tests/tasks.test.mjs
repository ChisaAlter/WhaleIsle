import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTaskStore } from '../lib/tasks.js';
import { AcpSessionConnection, modelsFromConfigOptions } from '../lib/acp-session.js';
import { conversationPrompt } from '../lib/index.js';
import { createTaskCheckout } from '../lib/isolation.js';
import { execFileSync } from 'node:child_process';
import { runtimeBundle } from '../lib/agent-runtime.js';
import { acpErrorMessage } from '../lib/errors.js';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-task-contract-'));
  const history = [];
  const children = new Map();
  const inbox = { nextTurn: [], nextStep: [], remove(id) { this.nextTurn = this.nextTurn.filter(item => item.id !== id); this.nextStep = this.nextStep.filter(item => item.id !== id); } };
  const parent = { id: 'parent', status: 'idle', inbox, session: {
    header: { cwd: dir }, snapshotEvents: () => history,
    append(type, data) { history.push({ type, data, seq: history.length, time: Date.now() }); },
  }, followup(message) { inbox.nextTurn.push(message); this.session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 0, inserted: [message] }); }, steer(message) { inbox.nextStep.push(message); } };
  const agents = new Map([[parent.id, parent]]);
  let disposals = 0;
  const ctx = { agents, logger: { warn() {} }, sessionQuery: { observeSession: async id => {
    if (!children.has(id)) throw new Error('session not found');
    return { events: children.get(id), [Symbol.dispose]() {} };
  } }, subagents: { listChildren: async () => [], drainChildren: async () => { disposals++; } } };
  ctx.get = name => ctx[name];
  const storeFile = path.join(dir, 'agents.json');
  return { dir, parent, children, agents, ctx, storeFile, store: createTaskStore(ctx, storeFile), disposals: () => disposals };
}

test('durable request receipts deduplicate concurrent retries and reject changed arguments', async () => {
  const f = fixture();
  try {
    let count = 0;
    const start = async (requestKey, requestArguments) => {
      count++; const task = f.store.begin(f.parent, { childId: 'child', requestKey, requestArguments, agentName: 'Agent', model: 'm' });
      await new Promise(resolve => setImmediate(resolve)); return { taskId: task.taskId, childId: task.childId };
    };
    const [a, b] = await Promise.all([f.store.once(f.parent, 'r1', { prompt: 'work', agent: 'a' }, start), f.store.once(f.parent, 'r1', { agent: 'a', prompt: 'work' }, start)]);
    assert.equal(count, 1); assert.deepEqual(a, b);
    await assert.rejects(f.store.once(f.parent, 'r1', { prompt: 'other' }, start), /different task arguments/);
    const reopened = createTaskStore(f.ctx, f.storeFile);
    const restored = await reopened.once(f.parent, 'r1', { agent: 'a', prompt: 'work' }, start);
    assert.equal(restored.taskId, a.taskId); assert.equal(count, 1);
    assert.equal(f.parent.session.snapshotEvents()[0].data.requestArguments, undefined);
  } finally { fs.rmSync(f.dir, { recursive: true }); }
});

test('queued continuation stays running, old task results remain addressable and cancellation disposes delivery', async () => {
  const f = fixture();
  try {
    const task = f.store.begin(f.parent, { childId: 'child', agentName: 'Agent', model: 'm', delivery: 'caller' });
    f.children.set('child', [
      { seq: 0, type: 'turn/start', data: {} },
      { seq: 1, type: 'turn/end', data: { reason: { kind: 'completed' } } },
      { seq: 2, type: 'agent/inbox/spliced', data: { target: 'next-step', start: 0, inserted: [{ id: 'queued' }] } },
    ]);
    assert.equal((await f.store.snapshot(f.parent, task.taskId)).status, 'running');
    await f.store.cancel(f.parent, task.taskId);
    assert.equal(f.disposals(), 1);
    assert.equal((await f.store.snapshot(f.parent, task.taskId)).status, 'cancelled');
    assert.equal(f.parent.inbox.nextTurn.length, 0);
    await assert.rejects(f.store.snapshot({ id: 'stranger' }, task.taskId), /direct parent/);
  } finally { fs.rmSync(f.dir, { recursive: true }); }
});

test('automatic failure delivery contains the original error and is not duplicated after restart', async () => {
  const f = fixture();
  try {
    const task = f.store.begin(f.parent, { childId: 'child', agentName: 'Agent', model: 'm', delivery: 'caller' });
    f.children.set('child', [{ seq: 0, type: 'turn/end', data: { reason: { kind: 'error', error: { message: 'Account model unavailable' } } } }]);
    const receipt = f.store.attach(f.parent, task, { childId: 'child', result: Promise.resolve({ output: [], stopReason: 'error' }) });
    await receipt.result;
    assert.equal(f.parent.inbox.nextTurn.length, 1);
    assert.match(JSON.stringify(f.parent.inbox.nextTurn[0]), /Account model unavailable/);
    const reopened = createTaskStore(f.ctx, f.storeFile);
    await reopened.recover(f.parent);
    assert.equal(f.parent.inbox.nextTurn.length, 1);
    const abandoned = reopened.begin(f.parent, { childId: 'lost-before-start', agentName: 'Agent', model: 'm', delivery: 'caller' });
    const third = createTaskStore(f.ctx, f.storeFile);
    await third.recover(f.parent);
    assert.match(third.get(f.parent.id, abandoned.taskId).diagnostic, /not replayed/);
    assert.equal(f.parent.inbox.nextTurn.length, 2);
  } finally { fs.rmSync(f.dir, { recursive: true }); }
});

test('concurrent settlement paths retain a single terminal record and completion notice', async () => {
  const f = fixture();
  try {
    const task = f.store.begin(f.parent, { childId: 'child', agentName: 'Agent', model: 'm', delivery: 'caller' });
    f.children.set('child', [{ seq: 0, type: 'turn/end', data: { reason: { kind: 'error', error: { message: 'Original failure' } } } }]);
    await Promise.all([f.store.finish(f.parent, task, { output: [], stopReason: 'error' }), f.store.finish(f.parent, task, { output: [], stopReason: 'aborted' })]);
    assert.equal(f.parent.session.snapshotEvents().filter(event => event.type === 'acp-delegation/end').length, 1);
    assert.equal(f.parent.inbox.nextTurn.length, 1);
    assert.equal(task.stopReason, 'error');
  } finally { fs.rmSync(f.dir, { recursive: true }); }
});

test('image handoff retains actual attachment references and discovered settings preserve available values', async () => {
  const image = { type: 'image', attachment: { attachmentId: 'test', mediaType: 'image/png', name: 'design.png' } };
  const blocks = conversationPrompt([{ id: '1', role: 'user', content: [image] }], {});
  assert.deepEqual(blocks, [image]);
  const models = modelsFromConfigOptions([{ type: 'select', id: 'model', options: [{ value: 'm', name: 'Model' }] }, { type: 'select', id: 'effort', category: 'reasoning_effort', options: [{ value: 'max', name: 'Maximum' }] }]);
  assert.equal(models[0].efforts[0].id, 'max');
  const conn = new AcpSessionConnection({ agentConfig: { name: 'Test' } });
  conn.ensureReady = async () => {};
  conn.api = { getConfigOptions: async () => [] };
  await assert.rejects(conn.syncModelAndEffort(undefined, 'high'), /does not advertise/);
});

test('Antigravity multiple-choice input returns the selected native option instead of cancelling it', async () => {
  const conn = new AcpSessionConnection({ agentConfig: { name: 'Antigravity' }, requestUserInput: async (_context, question) => ({ answers: [{ id: question.id, selected: [question.options[1].label] }] }) });
  conn.wiring = { isAntigravity: true };
  conn.activeTurn = { toolCalls: new Map(), registerToolCall(fields) { this.toolCalls.set(fields.toolCallId, { ...fields, waiters: [] }); } };
  const request = { sessionId: 's', toolCall: { toolCallId: 'interaction_choose', title: 'Pick a target', kind: 'other' }, options: [
    { optionId: 'one', name: 'First target', kind: 'allow_once' }, { optionId: 'two', name: 'Second target', kind: 'allow_once' },
  ] };
  const response = await conn._resolvePermission(request, {});
  assert.deepEqual(response, { outcome: { outcome: 'selected', optionId: 'two' } });
  assert.equal(conn.activeTurn.toolCalls.get('interaction_choose').status, 'completed');
});

test('Antigravity account validation rejects configured-but-unadvertised ids without selecting a model', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-model-policy-'));
  const bundle = runtimeBundle();
  await bundle.initAgentRuntime({ cacheDir: path.join(dir, 'cache'), toolsDir: path.join(dir, 'tools'), paths: { cwd: dir, baseDir: dir, stateDir: dir, attachmentsDir: path.join(dir, 'attachments') } });
  try {
  const config = [{ type: 'select', id: 'model', currentValue: 'flash-low', options: [{ value: 'flash-low', name: 'Flash Low' }, { value: 'flash-high', name: 'Flash High' }] }];
  const conn = new AcpSessionConnection({ agentConfig: { name: 'Antigravity', models: [{ id: 'flash' }] } });
  conn.ensureReady = async () => {};
  conn.api = { getConfigOptions: async () => config };
  conn.wiring = { isAntigravity: true };
  let selected = 0;
  const { Effect } = runtimeBundle().effect;
  conn.handle = { service: { getConfigOptions: Effect.succeed(config), setModel: () => Effect.sync(() => { selected++; }) } };
  await assert.rejects(conn.syncModelAndEffort('flash', undefined), /unavailable for this Google account/);
  assert.equal(selected, 0);
  await conn.syncModelAndEffort('flash-high', undefined);
  assert.equal(selected, 1);
  } finally { await bundle.disposeAgentRuntime(); fs.rmSync(dir, { recursive: true }); }
});

test('model-facing diagnostics retain OAuth proxy details while redacting credentials', () => {
  const error = Object.assign(new Error('Internal error'), { data: { details: 'OAuth ProxyError https://user:private@proxy.invalid/token?access_token=private-token' } });
  const message = acpErrorMessage(error);
  assert.match(message, /OAuth ProxyError/);
  assert.doesNotMatch(message, /user:private|private-token/);
});

test('native worktree checkout isolates edits without moving or cleaning the source', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-checkout-'));
  const git = args => execFileSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git(['init']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid']);
    fs.writeFileSync(path.join(root, 'file.txt'), 'committed'); git(['add', '.']); git(['commit', '-m', 'base']);
    fs.writeFileSync(path.join(root, 'file.txt'), 'uncommitted');
    const checkout = await createTaskCheckout(root, 'owned-task', new AbortController().signal);
    assert.equal(fs.readFileSync(path.join(checkout.cwd, 'file.txt'), 'utf8'), 'committed');
    assert.equal(fs.readFileSync(path.join(root, 'file.txt'), 'utf8'), 'uncommitted');
    fs.writeFileSync(path.join(checkout.cwd, 'file.txt'), 'child edit');
    assert.equal(fs.readFileSync(path.join(root, 'file.txt'), 'utf8'), 'uncommitted');
  } finally { fs.rmSync(root, { recursive: true }); }
});
