import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { WhaleTasks } from '../dsh-whale/lib/task-service.js';
import { TaskStore } from '../dsh-whale/lib/task-store.js';
import { createFeishuTaskBinding } from './plugin-src/host/channels/feishu/whale-tasks.mjs';
import { extractInboundMessage } from './src/channels/feishu/message-utils.mjs';
import { FeishuHarnessBridge } from './src/channels/feishu/bridge.mjs';
import { StateStore } from './src/channels/feishu/state-store.mjs';

test('authenticated Feishu ingress retains source and asynchronous delivery never uses the latest sender', async t => {
  const base = await mkdtemp(join(tmpdir(), 'feishu-task-')); const home = join(base, 'home');
  await mkdir(join(home, 'data/whale'), { recursive: true }); await writeFile(join(home, 'data/whale/settings.json'), JSON.stringify({ sessionId: 'resident', imDefault: true }));
  const previous = process.env.DSH_HOME; process.env.DSH_HOME = home;
  t.after(async () => { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous; await rm(base, { recursive: true, force: true }); });
  const botConfig = { id: 'bot', appId: 'public-app', createdAt: 'born', connectedAt: 'login', ownerOpenIds: ['owner'] };
  const adapters = new Map(), origins = [], sent = [];
  const service = { available: true, scope: { get: () => ({ sessionId: 'resident' }) },
    assertImRoute(route) { assert.equal(this.store.owners.get('feishu:bot')?.actor, route.actor); },
    store: { owners: { get: () => ({ actor: 'owner' }) }, tasks: { get: () => null } },
    registerChannel(key, adapter) { adapters.set(key, adapter); return () => adapters.delete(key); },
    async recordInbound(origin) { origins.push(structuredClone(origin)); },
    async accept(origin) { assert.equal(origin.route.chatId, 'chat-A'); return { id: 'task-A' }; }, schedule() {},
  };
  const client = { im: { message: { get: async () => ({ code: 0, data: { items: [{ message_id: 'file-message', chat_id: 'chat-A', sender: { id: 'owner' }, msg_type: 'file', body: { content: JSON.stringify({ file_key: 'file-key', file_name: 'source.txt' }) } }] } }),
    create: async request => { sent.push(request); return { code: 0, data: { message_id: 'delivery-A' } }; } },
    v1: { messageResource: { get: async () => ({ getReadableStream: () => Readable.from([Buffer.from('A-only input')]) }) } } } };
  const abort = new AbortController();
  const binding = createFeishuTaskBinding({ get: () => service, on: () => () => {} }, { botId: 'bot', botConfig, configStore: { list: () => [botConfig] }, workspaces: { has: () => true, agentPresetFor: () => null } });
  const adapter = binding.attach({ client, signal: abort.signal, allowedSenderOpenIds: new Set(['owner']) });
  t.after(() => abort.abort());
  const event = { sender: { sender_id: { open_id: 'owner' } }, message: { message_id: 'human-A', chat_id: 'chat-A', parent_id: 'file-message' } };
  const reply = await adapter.handle(event, { content: '/task {"goal":"summarize","files":["source.txt"]}', files: [] }, { agentPresetSettings: async () => ({ agentPreset: null }) });
  assert.match(reply, /已接纳 task-A/); assert.equal(origins.length, 1); assert.equal(origins[0].actor, 'owner');
  const channel = adapters.get('feishu:bot');
  await channel.send(origins[0].route, 'effect-A', 'A summary only', () => service.assertImRoute(origins[0].route));
  assert.equal(sent[0].data.receive_id, 'chat-A'); assert.equal(sent[0].data.content.includes('A summary only'), true);
  assert.equal(sent[0].data.content.includes('B_PRIVATE_MEMORY'), false); assert.ok(sent[0].data.uuid);
  botConfig.ownerOpenIds = []; assert.equal(await channel.status(origins[0].route), 'revoked');
  await assert.rejects(channel.send(origins[0].route, 'effect-B', 'not sent'), /不可用/); assert.equal(sent.length, 1);
});

async function taskFixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'feishu-task-race-')); const home = join(base, 'home');
  await mkdir(join(home, 'data/whale'), { recursive: true });
  const settings = join(home, 'data/whale/settings.json');
  await writeFile(settings, JSON.stringify({ sessionId: 'resident', imDefault: true }));
  const previous = process.env.DSH_HOME; process.env.DSH_HOME = home;
  const tables = new Map();
  const store = new TaskStore({ table(name) { if (!tables.has(name)) { const rows = new Map(); tables.set(name, {
    get: key => rows.get(key), entries: () => rows.entries(), get size() { return rows.size; },
    async put(key, value) { rows.set(key, structuredClone(value)); }, async delete(key) { rows.delete(key); },
    async update(key, fn) { const value = fn(structuredClone(rows.get(key))); rows.set(key, value); return value; },
  }); } return tables.get(name); }, async close() {} });
  let imDefault = true; let preset = null; let configRead = () => {};
  const service = new WhaleTasks({ logger: { warn() {} } }, store, { home, scope: { get: () => ({ sessionId: 'resident', imDefault }) } });
  const botConfig = { id: 'bot', appId: 'public-app', createdAt: 'born', connectedAt: 'login', ownerOpenIds: ['owner'] };
  const incarnation = crypto.createHash('sha256').update(JSON.stringify(['bot', 'public-app', 'born', 'login'])).digest('hex');
  const route = { channel: 'feishu', botId: 'bot', actor: 'owner', chatId: 'chat-A', messageId: 'source-A', incarnation };
  const task = { id: 'task-A', revision: 1, generation: 1, origin: { eventId: 'origin-A', sessionId: 'resident', messageId: 'message-A', rpcId: '', actor: 'owner', kind: 'im', route, text: '/task {}', files: [] },
    goal: 'A-only goal', criteria: [], inputs: [{ id: 'input-1', name: 'a.txt', path: 'a.txt', hash: 'hash', bytes: 1, text: 'A' }], model: { provider: 'fake', model: 'reader' }, state: 'needs_user', hold: false, createdAt: 1, updatedAt: 1, error: '',
    result: { id: 'result-A', summary: 'ONLY_TASK_PRIVATE_RESULT', evidence: ['input-1'], coveredCriteria: [], unmet: ['date?'], outcome: 'needs_user' }, effects: [] };
  await store.put(task); await service.setOwner('bot', 'owner'); service.schedule = () => {};
  // Registration is real; defer startup outbox work until the fixture has been prepared.
  service.deliverAll = async () => {};
  const sent = []; let dispatch = async () => ({ code: 0, data: { message_id: 'fake-provider' } });
  const client = { im: { message: { create(request) { sent.push(request); return dispatch(request); } } } };
  const abort = new AbortController();
  const adapter = createFeishuTaskBinding({ get: () => service, on: () => () => {} }, { botId: 'bot', botConfig,
    configStore: { list() { configRead(); return [botConfig]; } }, workspaces: { has: () => true, agentPresetFor: () => preset } })
    .attach({ client, signal: abort.signal, allowedSenderOpenIds: new Set(['owner']) });
  t.after(async () => { abort.abort(); await service.close(); if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous;
    assert.ok(base.startsWith(join(tmpdir(), 'feishu-task-race-'))); await rm(base, { recursive: true, force: true }); });
  let sequence = 0;
  const command = (action, { actor = 'owner', chatId = 'chat-A', messageId = `control-${++sequence}`, extra = {} } = {}) => adapter.command(
    { sender: { sender_id: { open_id: actor } }, message: { message_id: messageId, chat_id: chatId } },
    { content: '/task ' + JSON.stringify({ action, taskId: task.id, ...extra }) });
  return { service, store, task, route, botConfig, sent, command, settings, base, adapter, client, signal: abort.signal, setPreset: value => { preset = value; }, setImDefault: value => { imDefault = value; },
    onConfigRead: fn => { configRead = fn; }, onDispatch: fn => { dispatch = fn; } };
}

test('actual Feishu sender rechecks task owner after its final asynchronous route validation', async t => {
  const f = await taskFixture(t);
  await f.store.change(f.task.id, value => ({ ...value, state: 'completed', effects: [{ id: 'race', target: 'im', state: 'pending', attempts: 0, nextAt: 0, content: 'A-only result' }] }));
  const channel = f.service.channels.get('feishu:bot'); const send = channel.send;
  let entered; const waiting = new Promise(done => { entered = done; }); let reads = 0;
  channel.send = (...args) => { reads = 0; f.onConfigRead(() => { if (++reads === 1) entered(); }); return send(...args); };
  const delivery = f.service.deliver(f.task.id); await waiting;
  await f.service.revokeOwner('bot'); await delivery;
  assert.equal(f.sent.length, 0); assert.equal(f.store.get(f.task.id).effects[0].state, 'failed');
});

test('final SDK admission rejects changed sharing, preset and account after asynchronous checks', async t => {
  const f = await taskFixture(t); const channel = f.service.channels.get('feishu:bot'); const send = channel.send;
  for (const restriction of ['imDefault', 'preset', 'incarnation']) {
    await f.store.change(f.task.id, value => ({ ...value, state: 'completed', effects: [{ id: restriction, target: 'im', state: 'pending', attempts: 0, nextAt: 0, content: 'A-only result' }] }));
    let entered; const waiting = new Promise(done => { entered = done; }); let reads = 0;
    channel.send = (...args) => { f.onConfigRead(() => { if (++reads === 1) entered(); }); return send(...args); };
    const delivery = f.service.deliver(f.task.id); await waiting;
    if (restriction === 'imDefault') writeFileSync(f.settings, JSON.stringify({ sessionId: 'resident', imDefault: false }));
    if (restriction === 'preset') f.setPreset('standard');
    if (restriction === 'incarnation') f.botConfig.connectedAt = 'new-login';
    await delivery; assert.equal(f.sent.length, 0); assert.equal(f.store.get(f.task.id).effects[0].state, 'failed');
    f.onConfigRead(() => {}); f.setPreset(null); f.botConfig.connectedAt = 'login';
    await writeFile(f.settings, JSON.stringify({ sessionId: 'resident', imDefault: true }));
  }
});

test('a provider call admitted before revocation is recorded truthfully and unknown is never retried', async t => {
  const f = await taskFixture(t);
  await f.store.change(f.task.id, value => ({ ...value, state: 'completed', effects: [{ id: 'in-flight', target: 'im', state: 'pending', attempts: 0, nextAt: 0, content: 'A-only result' }] }));
  let entered, release; const waiting = new Promise(done => { entered = done; });
  f.onDispatch(() => { entered(); return new Promise(done => { release = done; }); });
  const delivery = f.service.deliver(f.task.id); await waiting; await f.service.revokeOwner('bot');
  release({ code: 0, data: {} }); await delivery;
  assert.equal(f.sent.length, 1); assert.equal(f.store.get(f.task.id).effects[0].state, 'unknown');
  await f.service.setOwner('bot', 'owner'); await f.service.deliver(f.task.id); assert.equal(f.sent.length, 1);
});

test('all Feishu task management rejects revoked owners, disabled sharing, changed presets and account incarnations', async t => {
  const f = await taskFixture(t);
  for (const restriction of ['owner', 'imDefault', 'preset', 'incarnation']) {
    if (restriction === 'owner') await f.service.revokeOwner('bot');
    if (restriction === 'imDefault') { f.setImDefault(false); await writeFile(f.settings, JSON.stringify({ sessionId: 'resident', imDefault: false })); }
    if (restriction === 'preset') f.setPreset('standard');
    if (restriction === 'incarnation') f.botConfig.connectedAt = 'new-login';
    const before = f.store.get(f.task.id);
    for (const action of ['status', 'stop', 'resume']) {
      const reply = await f.command(action); assert.equal(typeof reply, 'string'); assert.match(reply, /不可用/); assert.equal(reply.includes('ONLY_TASK_PRIVATE_RESULT'), false);
    }
    assert.deepEqual(f.store.get(f.task.id), before); assert.equal(f.sent.length, 0);
    await f.service.setOwner('bot', 'owner'); f.setImDefault(true); f.setPreset(null); f.botConfig.connectedAt = 'login';
    await writeFile(f.settings, JSON.stringify({ sessionId: 'resident', imDefault: true }));
  }
  for (const args of [{ actor: 'other' }, { chatId: 'chat-B' }]) assert.match(await f.command('status', args), /不可用/);
  assert.deepEqual(await f.command('status'), { taskReplySent: true });
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].data.receive_id, 'chat-A'); assert.match(f.sent[0].data.content, /ONLY_TASK_PRIVATE_RESULT/);
  assert.match(await f.command('stop', { messageId: 'stop-event' }), /已停止/);
  assert.equal(f.store.get(f.task.id).hold, true);
  assert.match(await f.command('resume', { messageId: 'stop-event' }), /不可用/);
  assert.equal(f.store.get(f.task.id).hold, true);
  assert.match(await f.command('resume', { extra: { model: 'other' } }), /不接受/);
  assert.match(await f.command('resume'), /已明确继续/);
  assert.equal(f.store.get(f.task.id).hold, false); assert.equal(f.store.get(f.task.id).state, 'queued');
});

test('a status transport failure after dispatch reports uncertainty without retrying task content', async t => {
  const f = await taskFixture(t); f.onDispatch(async () => { throw new Error('transport lost after dispatch'); });
  const reply = await f.command('status'); assert.match(reply, /未确认/); assert.equal(reply.includes('未返回任务内容'), false); assert.equal(reply.includes('ONLY_TASK_PRIVATE_RESULT'), false);
  assert.equal(f.sent.length, 1);
});

test('the real Feishu bridge consumes guarded status replies and never asks the model after denial', async t => {
  const f = await taskFixture(t); const ordinary = []; let asks = 0;
  f.client.im.v1 = { message: { create: async request => { ordinary.push(request); return { code: 0, data: { message_id: 'ordinary' } }; } } };
  const state = await new StateStore(join(f.base, 'bridge-state.json')).load();
  const bridge = new FeishuHarnessBridge({ client: f.client, taskAdapter: f.adapter, harness: { ask: async () => { asks++; throw new Error('must not ask'); } },
    state, status: {}, allowedSenderOpenIds: new Set(['owner']), botId: 'bot', appId: 'public-app', signal: f.signal, logger: { info() {}, warn() {}, error() {} } });
  const event = id => ({ sender: { sender_id: { open_id: 'owner' }, sender_type: 'user' }, message: { message_id: id, chat_id: 'chat-A', chat_type: 'p2p', message_type: 'text', content: JSON.stringify({ text: '/task ' + JSON.stringify({ action: 'status', taskId: f.task.id }) }) } });
  await bridge.accept(event('valid-status'));
  assert.equal(asks, 0); assert.equal(f.sent.length, 1); assert.equal(ordinary.length, 0);
  assert.match(f.sent[0].data.content, /ONLY_TASK_PRIVATE_RESULT/);
  await f.service.revokeOwner('bot'); await bridge.accept(event('denied-status'));
  assert.equal(asks, 0); assert.equal(f.sent.length, 1); assert.equal(ordinary.length, 1);
  assert.equal(ordinary[0].data.content.includes('ONLY_TASK_PRIVATE_RESULT'), false); assert.match(ordinary[0].data.content, /未返回任务内容/);
});

test('rich-text file blocks are exposed as real sources alongside the task instruction', () => {
  const event = { message: { message_type: 'post', message_id: 'm', content: JSON.stringify({ content: [[{ tag: 'text', text: '/task {"goal":"summary","files":["a.txt"]}' }, { tag: 'file', file_key: 'fk', file_name: 'a.txt' }]] }) } };
  const result = extractInboundMessage(event, {}); assert.match(result.content, /^\/task/); assert.equal(result.files[0].name, 'a.txt');
});
