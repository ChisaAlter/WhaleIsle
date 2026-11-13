'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const moduleUrl = pathToFileURL(path.join(__dirname, '../../vendor/dsh-whale/lib/todo-service.js')).href;

test('unreadable task storage reports unavailability without replacing established assistant services', async () => {
  const { mountWhaleTodos } = await import(moduleUrl);
  const provided = new Map([['assistant', { sessionId: 'resident' }]]);
  const service = await mountWhaleTodos({ storageDomain: { open: async () => { throw new Error('invalid data'); } },
    provide: (key, value) => provided.set(key, value) }, {});
  assert.equal(service.available, false); assert.match(service.error, /invalid data/);
  assert.equal(provided.get('assistant').sessionId, 'resident');
});

async function fixture() {
  const { WhaleTodos, todoSchema } = await import(moduleUrl);
  const values = new Map(), calls = [], agents = new Map();
  const domain = { table: () => ({ entries: () => values.entries(), get: id => values.get(id),
    put: async (id, value) => values.set(id, todoSchema.parse(structuredClone(value))), delete: async id => values.delete(id) }), close: async () => {} };
  const ctx = { sessionController: {
      projections: async () => ({ values: { modelSelection: { next: { provider: 'scripted', model: 'test' } } } }),
      modelCatalog: async () => ({ default: { provider: 'default', model: 'fallback' } }),
      create: async input => { calls.push(['create', input]); agents.set(input.sessionId, { cancel: (...args) => calls.push(['cancel', input.sessionId, ...args]), whenIdle: async () => {} }); return { sessionId: input.sessionId }; },
      resolveAgent: async id => ({ agent: id === 'resident' ? { id } : agents.get(id) }),
      selectModel: async input => calls.push(['model', input]), prompt: async input => calls.push(['prompt', input]),
    } };
  const service = new WhaleTodos(ctx, domain, { home: 'C:/synthetic-home', scope: { get: () => ({ sessionId: 'resident' }) } });
  return { service, values, calls, ctx };
}

test('task cards persist validated metadata without running; pinning does not schedule work', async () => {
  const { service, calls, values } = await fixture();
  const card = await service.create({ title: '整理清单', description: '保留说明', criteria: '有三项待办' });
  assert.equal(card.state, 'pending'); assert.equal(calls.length, 0);
  await service.update(card.id, { pinned: true });
  assert.equal(values.get(card.id).pinned, true); assert.equal(calls.length, 0);
  await assert.rejects(service.update(card.id, { archived: true }), /先完成或取消/);
  await assert.rejects(service.create({ title: ' ' }), /Too small/);
});

test('task execution uses a distinct session and current model without changing defaults', async () => {
  const { service, calls } = await fixture();
  const card = await service.create({ title: '写摘要', cwd: 'C:/chosen-workspace' });
  const run = await service.start(card.id);
  assert.equal(run.state, 'running'); assert.notEqual(run.sessionId, 'resident');
  assert.equal(calls.find(([kind]) => kind === 'create')[1].cwd, 'C:/chosen-workspace');
  assert.equal(calls.find(([kind]) => kind === 'create')[1].agentPreset, 'standard');
  assert.deepEqual(calls.find(([kind]) => kind === 'model')[1], { sessionId: run.sessionId, provider: 'scripted', model: 'test', saveAsDefault: false });
  assert.match(calls.find(([kind]) => kind === 'prompt')[1].content[0].text, /写摘要/);
  await assert.rejects(service.start(card.id), /未执行/);
  for (const action of ['complete', 'delete', 'reopen']) await assert.rejects(service.transition(card.id, action), /仍在执行/);
  await assert.rejects(service.update(card.id, { archived: true }), /先完成或取消/);
});

test('an unconfirmed stop keeps admission closed and can be explicitly retried', async () => {
  const { service, ctx } = await fixture();
  const card = await service.create({ title: '停止异常' }); const run = await service.start(card.id);
  const agent = (await ctx.sessionController.resolveAgent(run.sessionId)).agent;
  agent.whenIdle = async () => { throw new Error('连接丢失'); };
  await assert.rejects(service.stop(card.id), /连接丢失/);
  assert.equal(service.get(card.id).state, 'stopping');
  await assert.rejects(service.transition(card.id, 'reopen'), /仍在执行/);
  agent.whenIdle = async () => {};
  await service.stop(card.id); assert.equal(service.get(card.id).state, 'cancelled');
});

test('a completed turn means review, not completed goal; results and errors remain on the card', async () => {
  const { service } = await fixture();
  const card = await service.create({ title: '检查任务' }); const run = await service.start(card.id);
  await service.event({ id: run.sessionId }, { type: 'assistant/message', data: { content: [{ type: 'text', text: '结果与仍需人工确认的事项' }] } });
  await service.event({ id: run.sessionId }, { type: 'turn/end', data: { reason: { kind: 'completed' } } });
  assert.equal(service.get(card.id).state, 'review'); assert.match(service.get(card.id).summary, /人工确认/);
  await service.transition(card.id, 'complete'); assert.equal(service.get(card.id).state, 'completed');
  await service.update(card.id, { archived: true }); assert.equal(service.get(card.id).archived, true);
  await service.transition(card.id, 'reopen'); assert.equal(service.get(card.id).archived, false);
});

test('stop waits for the owned run only; a late completed event cannot revive cancellation', async () => {
  const { service, calls, ctx } = await fixture();
  const one = await service.create({ title: '任务 A' }), two = await service.create({ title: '任务 B' });
  const a = await service.start(one.id), b = await service.start(two.id);
  let finish;
  const agent = (await ctx.sessionController.resolveAgent(a.sessionId)).agent;
  agent.whenIdle = () => new Promise(resolve => { finish = resolve; });
  const stopped = service.stop(one.id);
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  assert.equal(service.get(one.id).state, 'stopping');
  assert.equal(service.get(two.id).state, 'running');
  assert.equal(calls.filter(([kind]) => kind === 'cancel').length, 1);
  assert.equal(calls.find(([kind]) => kind === 'cancel')[1], a.sessionId);
  await service.event({ id: a.sessionId }, { type: 'turn/end', data: { reason: { kind: 'aborted' } } });
  assert.equal(service.get(one.id).state, 'stopping', 'a terminal event cannot reopen admission before whenIdle settles');
  finish(); await stopped;
  await service.event({ id: a.sessionId }, { type: 'turn/end', data: { reason: { kind: 'completed' } } });
  assert.equal(service.get(one.id).state, 'cancelled'); assert.equal(service.get(two.id).sessionId, b.sessionId);
});

test('prompt rejection and restart never silently resubmit; deleting a card does not delete a session', async () => {
  const { service, ctx, calls } = await fixture();
  const card = await service.create({ title: '失败任务' });
  ctx.sessionController.prompt = async () => { throw new Error('模型不可用'); };
  await assert.rejects(service.start(card.id), /模型不可用/);
  assert.equal(service.get(card.id).state, 'failed'); assert.match(service.get(card.id).error, /模型不可用/);
  await service.put({ ...service.get(card.id), state: 'running' });
  await service.recover(); assert.equal(service.get(card.id).state, 'interrupted');
  await service.transition(card.id, 'delete'); assert.equal(service.list().length, 0);
  assert.equal(calls.some(([kind]) => kind === 'delete'), false);
});
