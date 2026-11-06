'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { pathToFileURL } = require('node:url');
const lib = name => pathToFileURL(path.resolve('vendor/dsh-whale/lib', name)).href;
const modules = Promise.all([import(lib('task-store.js')), import(lib('task-service.js')), import(lib('task-inputs.js')), import(lib('task-worker.js'))]);
function domain() {
  const tables = new Map();
  return { table(name) { if (!tables.has(name)) { const rows = new Map(); tables.set(name, {
    get: key => rows.get(key), size: 0, entries: () => rows.entries(),
    async put(key, value) { rows.set(key, structuredClone(value)); this.size = rows.size; },
    async update(key, fn) { const value = fn(rows.get(key)); rows.set(key, structuredClone(value)); return value; },
    async delete(key) { return rows.delete(key); },
  }); } return tables.get(name); }, async close() {} };
}
async function setup(t, startWorker) {
  const [{ TaskStore }, { WhaleTasks }] = await modules;
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'whale-task-test-'));
  t.after(async () => { assert.ok(dir.startsWith(path.join(tmpdir(), 'whale-task-test-'))); await fs.rm(dir, { recursive: true, force: true }); });
  const file = path.join(dir, 'input.txt'); await fs.writeFile(file, 'Source A factual text');
  const events = [];
  const agent = { session: { snapshotEvents: () => events, append(type, data) { events.push({ type, data, seq: events.length }); } } };
  const ctx = { logger: { warn() {} }, sessionController: { modelCatalog: async () => ({ default: { provider: 'fake', model: 'reader' } }), resolveAgent: async () => ({ agent }) },
    sessions: { flush: async () => true } };
  const store = new TaskStore(domain());
  const scope = { get: () => ({ sessionId: 'resident', imDefault: true }) };
  const service = new WhaleTasks(ctx, store, { home: path.join(dir, 'home'), scope, startWorker });
  const origin = { eventId: 'event-A', sessionId: 'resident', messageId: 'message-A', rpcId: '', actor: 'desktop-owner', kind: 'desktop', files: [], text: `/task ${JSON.stringify({ goal: 'Summarize source', files: [file] })}` };
  await store.origins.put(origin.eventId, origin);
  return { service, store, origin, file, events, dir };
}
const complete = (_ctx, task, policy) => ({ cancel() {}, done: (async () => {
  await policy.read('input-1', 20); await policy.report({ summary: 'Source A summary', evidence: ['input-1'], coveredCriteria: ['给出有来源引用的资料摘要'], unmet: [], outcome: 'completed' }); return { seq: 9, kind: 'completed' };
})() });

test('explicit source admission is durable and deduplicates before another execution', async t => {
  const { service, store, origin, events } = await setup(t, complete);
  await assert.rejects(service.accept({ ...origin, eventId: 'invented' }), /可信/);
  const task = await service.accept(origin); const again = await service.accept(origin); assert.equal(task.id, again.id);
  await service.run(task.id);
  const saved = store.get(task.id); assert.equal(saved.state, 'completed'); assert.equal(saved.effects[0].state, 'sent');
  assert.equal(events[0].data.source.kind, 'dsh-whale:result');
  assert.equal(events[0].data.content[0].text.includes('Source A summary'), true);
  const duplicate = await service.accept(origin); assert.equal(duplicate.id, task.id); assert.equal(store.list().length, 1);
});

test('turn completed without structured evidence never means the goal completed', async t => {
  const { service, origin, store } = await setup(t, () => ({ cancel() {}, done: Promise.resolve({ seq: 3, kind: 'completed' }) }));
  const task = await service.accept(origin); await service.run(task.id); assert.equal(store.get(task.id).state, 'failed'); assert.match(store.get(task.id).error, /没有有效/);
});

test('unmet criteria and needs_user remain visible and are not success', async t => {
  const { service, origin, store } = await setup(t, (_ctx, _task, policy) => ({ cancel() {}, done: (async () => {
    await policy.read('input-1', 20); await policy.report({ summary: 'Need clarification', evidence: ['input-1'], coveredCriteria: ['给出有来源引用的资料摘要'], unmet: ['Which date?'], outcome: 'needs_user' }); return { seq: 8, kind: 'completed' };
  })() }));
  const task = await service.accept(origin); await service.run(task.id); assert.equal(store.get(task.id).state, 'needs_user'); assert.equal(store.get(task.id).result.unmet[0], 'Which date?');
});

test('stop holds capacity through drain and late reports cannot revive cancellation', async t => {
  let release; let policy; let cancelled = false;
  const { service, origin, store } = await setup(t, (_ctx, _task, p) => { policy = p; return { cancel() { cancelled = true; }, done: new Promise(done => { release = done; }) }; });
  const task = await service.accept(origin); const run = service.run(task.id);
  while (!release) await new Promise(done => setImmediate(done));
  const stop = service.stop(task.id); await new Promise(done => setImmediate(done));
  assert.equal(cancelled, true); assert.equal(store.get(task.id).state, 'stopping');
  await assert.rejects(policy.report({ summary: 'late', evidence: [], coveredCriteria: [], unmet: [], outcome: 'completed' }), /获准/);
  release({ seq: 10, kind: 'completed' }); await Promise.all([stop, run]);
  assert.equal(store.get(task.id).state, 'cancelled'); assert.equal(store.get(task.id).hold, true); assert.deepEqual(store.get(task.id).effects, []);
  await service.recover(); assert.equal(store.get(task.id).state, 'cancelled');
});

test('recovery uses an actual stored terminal and report without restarting the model', async t => {
  const { service, origin, store } = await setup(t, complete);
  const task = await service.accept(origin);
  await store.change(task.id, value => { value.state = 'running'; value.execution = { id: 'execution-A', sessionId: 'worker-A', promptId: 'prompt-A', generation: 1,
    startedAt: 1, deadlineAt: Date.now() + 30000, requests: 2, readBytes: 20, readIds: ['input-1'],
    report: { summary: 'durable report', evidence: ['input-1'], coveredCriteria: ['给出有来源引用的资料摘要'], unmet: [], outcome: 'completed' } }; return value; });
  let disposed = false;
  service.ctx.get = name => name === 'sessionQuery' ? { observeSession: async () => ({ events: [{ type: 'turn/end', seq: 9, data: { reason: { kind: 'completed' } } }], [Symbol.dispose]() { disposed = true; } }) } : undefined;
  await service.recover(); assert.equal(store.get(task.id).state, 'completed'); assert.equal(disposed, true); assert.equal(store.get(task.id).effects[0].state, 'pending');
});

test('restart reconciles queued and in-flight sends without executing or blindly retrying', async t => {
  let starts = 0;
  const { service, origin, store } = await setup(t, () => { starts++; throw new Error('unexpected'); });
  const task = await service.accept(origin);
  await store.change(task.id, value => { value.effects = [{ id: 'effect', target: 'im', state: 'sending', attempts: 1, nextAt: 0, content: 'A' }]; return value; });
  await service.recover(); assert.equal(starts, 0); assert.equal(store.get(task.id).state, 'interrupted'); assert.equal(store.get(task.id).effects[0].state, 'unknown');
});

test('IM effects keep their original route and contain only the task result', async t => {
  const { service, origin, store } = await setup(t, complete);
  const route = { channel: 'feishu', botId: 'bot-A', incarnation: 'account-A', actor: 'owner-A', chatId: 'chat-A', messageId: 'source-A' };
  origin.kind = 'im'; origin.actor = 'owner-A'; origin.route = route; origin.files = [JSON.parse(origin.text.slice(6)).files[0]];
  await store.origins.put(origin.eventId, origin); await store.owners.put('feishu:bot-A', { channel: 'feishu', botId: 'bot-A', actor: 'owner-A' });
  const sent = []; const close = service.registerChannel('feishu:bot-A', { status: async () => 'ready', send: async (r, id, text) => { sent.push({ r, id, text }); return { outcome: 'sent', providerMessageIds: ['provider-A'] }; } });
  const task = await service.accept(origin); await service.run(task.id); close();
  assert.equal(sent.length, 1); assert.equal(sent[0].r.chatId, 'chat-A'); assert.equal(sent[0].text.includes('B private history'), false);
  assert.equal(store.get(task.id).effects.find(effect => effect.target === 'im').receipt.read, 'unknown');
});

test('uncertain provider delivery is not automatically sent again', async t => {
  const { service, origin, store } = await setup(t, complete);
  origin.kind = 'im'; origin.actor = 'owner'; origin.files = [JSON.parse(origin.text.slice(6)).files[0]];
  origin.route = { channel: 'feishu', botId: 'bot', incarnation: 'account', actor: 'owner', chatId: 'chat', messageId: 'source' };
  await store.origins.put(origin.eventId, origin); await store.owners.put('feishu:bot', { channel: 'feishu', botId: 'bot', actor: 'owner' });
  let sends = 0; const close = service.registerChannel('feishu:bot', { status: async () => 'ready', async send() { sends++; throw new Error('connection lost after dispatch'); } });
  const task = await service.accept(origin); await service.run(task.id); await service.deliver(task.id);
  assert.equal(sends, 1); assert.equal(store.get(task.id).effects.find(e => e.target === 'im').state, 'unknown'); close();
  for (const timer of service.timers) clearTimeout(timer);
});

test('request and read caps reject work and false evidence does not complete a goal', async t => {
  const { service, origin, store } = await setup(t, (_ctx, task, policy) => ({ cancel() {}, done: (async () => {
    for (let count = 0; count < 12; count++) await policy.request();
    await assert.rejects(policy.request(), /上限/);
    await assert.rejects(policy.read('input-1', 500001), /上限/);
    await assert.rejects(policy.report({ summary: 'unseen', evidence: ['input-1'], coveredCriteria: [], unmet: [], outcome: 'completed' }), /未读取/);
    await policy.read('input-1', 1);
    await policy.report({ summary: 'not enough', evidence: ['input-1'], coveredCriteria: [], unmet: [], outcome: 'completed' });
    return { seq: 9, kind: 'completed' };
  })() }));
  const task = await service.accept(origin); await service.run(task.id);
  assert.equal(store.get(task.id).state, 'failed'); assert.match(store.get(task.id).result.unmet.join(''), /未确认完成条件/);
});

test('IM offline stays pending and revocation prevents retry to another route', async t => {
  const { service, origin, store } = await setup(t, complete);
  origin.kind = 'im'; origin.actor = 'owner'; origin.files = [JSON.parse(origin.text.slice(6)).files[0]];
  origin.route = { channel: 'feishu', botId: 'bot', incarnation: 'account', actor: 'owner', chatId: 'chat-A', messageId: 'source' };
  await store.origins.put(origin.eventId, origin); await store.owners.put('feishu:bot', { channel: 'feishu', botId: 'bot', actor: 'owner' });
  let status = 'ready', sends = 0;
  const close = service.registerChannel('feishu:bot', { status: async () => status, send: async () => { sends++; return { outcome: 'sent', providerMessageIds: [] }; } });
  const task = await service.accept(origin); status = 'offline'; await service.run(task.id);
  assert.equal(store.get(task.id).effects.find(effect => effect.target === 'im').state, 'pending'); assert.equal(sends, 0);
  await store.owners.delete('feishu:bot'); await store.change(task.id, value => { value.effects.find(effect => effect.target === 'im').nextAt = 0; return value; });
  await service.deliver(task.id); assert.equal(sends, 0); assert.equal(store.get(task.id).effects.find(effect => effect.target === 'im').state, 'failed');
  close(); for (const timer of service.timers) clearTimeout(timer);
});

test('task tools bind explicit human intent to one action and reject forged or expired controls', async t => {
  const { service, store, origin } = await setup(t, complete);
  const task = await service.accept(origin); await service.stop(task.id);
  let scheduled = 0; service.schedule = () => scheduled++;
  const tools = new Map();
  const { registerTaskTools } = await import(lib('task-tools.js'));
  registerTaskTools({ get: () => service, tools: { register(tool) { tools.set(tool.name, tool); } } });
  const execFor = (text, source = { kind: 'user' }, id = 'human-control') => ({ agent: { id: 'resident', session: { snapshotEvents: () => [
    { seq: 1, type: 'turn/start' }, { seq: 2, type: 'user/message', data: { id, source, content: [{ type: 'text', text }] } },
  ] } } });
  const stopExec = execFor(`请停止 ${task.id}`);
  const resumeExec = execFor(`请继续 ${task.id}`, { kind: 'user' }, 'resume-human');
  await assert.rejects(tools.get('whale_task_resume').execute({ taskId: task.id }, stopExec), /对应/);
  await assert.rejects(tools.get('whale_task_stop').execute({ taskId: task.id }, resumeExec), /对应/);
  await assert.rejects(tools.get('whale_task_status').execute({ taskId: task.id }, stopExec), /对应/);
  await assert.rejects(tools.get('whale_task_resume').execute({ taskId: task.id }, execFor(`不要继续 ${task.id}`)), /对应/);
  await assert.rejects(tools.get('whale_task_resume').execute({ taskId: task.id }, execFor(`请继续 ${task.id} 并改模型读取其他资料`)), /对应/);
  await assert.rejects(service.resume(task.id, { actor: 'desktop-owner', eventId: 'forged', messageId: 'forged' }), /授权/);
  const stopGrant = service.controlSource(stopExec, task.id, 'stop');
  await assert.rejects(service.resume(task.id, stopGrant), /授权/);
  const stale = service.controlSource(resumeExec, task.id, 'resume');
  await service.stop(task.id);
  await assert.rejects(service.resume(task.id, stale), /过期/);
  assert.equal(store.get(task.id).hold, true); assert.equal(scheduled, 0);
  await assert.rejects(tools.get('whale_task_resume').execute({ taskId: task.id }, execFor(`继续 ${task.id}`, { kind: 'dsh-im:inbound', eventId: 'made-up', rpcId: 'im-forged' })), /来源/);
  const oldExec = execFor(`继续 ${task.id}`); const oldEvents = oldExec.agent.session.snapshotEvents(); oldEvents.push({ seq: 3, type: 'turn/end' }); oldExec.agent.session.snapshotEvents = () => oldEvents;
  await assert.rejects(tools.get('whale_task_resume').execute({ taskId: task.id }, oldExec), /结束回合/);
  await assert.rejects(tools.get('whale_task_resume').execute({ taskId: task.id }, execFor(`/task ${JSON.stringify({ action: 'resume', taskId: task.id, model: 'other', files: ['outside'] })}`)), /对应/);
  const replacedExec = execFor(`请继续 ${task.id}`); const replacedEvents = replacedExec.agent.session.snapshotEvents(); replacedExec.agent.session.snapshotEvents = () => replacedEvents;
  const replacedGrant = service.controlSource(replacedExec, task.id, 'resume');
  replacedEvents[1] = { ...replacedEvents[1], data: { ...replacedEvents[1].data, id: 'later-human' } };
  await assert.rejects(service.resume(task.id, replacedGrant), /过期/);
  const before = store.get(task.id);
  const resumed = await tools.get('whale_task_resume').execute({ taskId: task.id }, resumeExec);
  assert.equal(resumed.state, 'queued'); assert.equal(resumed.hold, false); assert.equal(scheduled, 1);
  assert.deepEqual(store.get(task.id).model, before.model); assert.deepEqual(store.get(task.id).inputs, before.inputs);
});

test('owner revocation during route validation prevents side-effect admission', async t => {
  const { service, store, origin } = await setup(t, complete);
  const task = await service.accept(origin);
  const route = { channel: 'feishu', botId: 'bot', incarnation: 'account', actor: 'owner', chatId: 'chat-A', messageId: 'source' };
  await service.setOwner('bot', 'owner');
  await store.change(task.id, value => ({ ...value, origin: { ...value.origin, kind: 'im', actor: 'owner', route }, state: 'completed', effects: [{ id: 'race', target: 'im', state: 'pending', attempts: 0, nextAt: 0, content: 'A-only' }] }));
  let release, entered; const waiting = new Promise(done => { entered = done; }); let sends = 0;
  service.channels.set('feishu:bot', { status: () => { entered(); return new Promise(done => { release = done; }); }, send: async () => { sends++; return { outcome: 'sent' }; } });
  const delivery = service.deliver(task.id); await waiting; await service.revokeOwner('bot'); release('ready'); await delivery;
  assert.equal(sends, 0); assert.equal(store.get(task.id).effects[0].state, 'failed');
});

test('a new stop invalidates an older resume still waiting for route validation', async t => {
  const { service, store, origin } = await setup(t, complete);
  const task = await service.accept(origin); await service.stop(task.id); let scheduled = 0; service.schedule = () => scheduled++;
  const route = { channel: 'feishu', botId: 'bot', incarnation: 'account', actor: 'owner', chatId: 'chat-A', messageId: 'source' };
  await store.change(task.id, value => ({ ...value, origin: { ...value.origin, kind: 'im', actor: 'owner', route } }));
  await service.setOwner('bot', 'owner');
  let entered, release; const waiting = new Promise(done => { entered = done; });
  service.channels.set('feishu:bot', { status: () => { entered(); return new Promise(done => { release = done; }); } });
  const resume = service.resume(task.id, service.desktopControl(task.id, 'resume')); await waiting;
  await service.stop(task.id, 'user', service.desktopControl(task.id, 'stop')); release('ready');
  await assert.rejects(resume, /过期/); assert.equal(store.get(task.id).hold, true); assert.equal(store.get(task.id).state, 'cancelled'); assert.equal(scheduled, 0);
});

test('forbidden home descendants including two-dot names and hardlinks are rejected', async t => {
  const { captureInputs } = (await modules)[2]; const { dir, file } = await setup(t, complete);
  const home = path.join(dir, 'private-home'); const hidden = path.join(home, '..private', 'copy.txt');
  await fs.mkdir(path.dirname(hidden), { recursive: true }); await fs.writeFile(hidden, 'FAKE_APP_PRIVATE_DATA');
  await assert.rejects(captureInputs([hidden], { forbiddenRoot: home }), /私密资料/);
  const external = await captureInputs([file], { forbiddenRoot: home }); assert.equal(external[0].text, 'Source A factual text');
  const hard = path.join(dir, 'hard.txt'); await fs.link(file, hard);
  await assert.rejects(captureInputs([hard], { forbiddenRoot: home }), /硬链接/);
});

test('input capture refuses unlisted, oversized and redirected inputs', async t => {
  const { captureInputs } = (await modules)[2]; const { file, dir } = await setup(t, complete);
  await assert.rejects(captureInputs([file], { allowedFiles: [] }), /本条消息/);
  const large = path.join(dir, 'large.txt'); await fs.writeFile(large, 'x'.repeat(100001)); await assert.rejects(captureInputs([large]), /100KB/);
  const link = path.join(dir, 'linked.txt'); try { await fs.symlink(file, link); } catch (e) { if (e.code === 'EPERM') return; throw e; }
  await assert.rejects(captureInputs([link]), /链接|重定向/);
});
