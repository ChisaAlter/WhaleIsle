'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pathToFileURL } = require('node:url');
const moduleUrl = (name) => pathToFileURL(path.join(__dirname, '../../vendor/dsh-whale/lib', name)).href;

async function host(t, services = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-reliability-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    fs.rmSync(home, { recursive: true, force: true });
  });
  const { createWhaleScope } = await import(moduleUrl('scope.js'));
  const scope = createWhaleScope(home);
  const initial = scope.get();
  await scope.set({ ...initial, sessionId: 'resident' }, initial);
  const listeners = new Set();
  let route;
  const controller = {
    list: async () => ({ sessions: [{ sessionId: 'resident' }] }),
    create: async (request) => ({ sessionId: request.sessionId }),
    follow: async function* () { yield { type: 'snapshot', records: [], projections: { values: { modelSelection: { next: {
      provider: 'chat-provider', model: 'chat-model',
    } } } } }; },
    ...services.sessionController,
  };
  const ctx = {
    systemPrompt: { section() {} },
    connection: { requestRejection: () => undefined },
    webServer: { register: (value) => { route = value; } },
    effect: (fn) => fn(),
    get: (name) => name === 'sessionController' ? controller : services[name],
    on: (_name, listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  const { apply } = await import(moduleUrl('index.js'));
  apply(ctx);
  return {
    home, scope, controller,
    emit: (event) => { for (const listener of [...listeners]) listener({ id: 'resident' }, event); },
    async rpc(method, payload = {}) {
      const req = Readable.from([Buffer.from(JSON.stringify({ type: 'client-request', rpcId: 'test', method, payload }))]);
      req.method = 'POST'; req.url = `/dsh-whale/${method}`; req.headers = { 'content-type': 'application/json' };
      let body;
      await route.handler(req, { writeHead() {}, end(value) { body = JSON.parse(value); } });
      return body.result;
    },
  };
}

test('partial replies retain error or aborted status through the real pet/chat RPC', async (t) => {
  let instance;
  let kind = 'error';
  instance = await host(t, { sessionController: {
    prompt: async (request) => {
      instance.emit({ type: 'user/message', data: { source: { rpcId: request.requestId } } });
      instance.emit({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '已完成第一步' }] } } });
      instance.emit({ type: 'turn/end', data: { reason: { kind } } });
      return { accepted: true };
    },
  } });
  for (kind of ['error', 'aborted', 'completed']) {
    const result = await instance.rpc('pet/chat', { text: '执行任务' });
    assert.equal(result.ok, true);
    assert.equal(result.value.ok, kind === 'completed');
    assert.equal(result.value.reply, '已完成第一步');
    if (kind !== 'completed') assert.equal(result.value.error, `turn-${kind}`);
  }
  assert.equal((await instance.rpc('pet/chat', { text: '甲'.repeat(2001) })).value.error, 'input-too-long');
});

test('default-model edits apply to the resident session and rejected models are not saved', async (t) => {
  const calls = [];
  const instance = await host(t, { sessionController: {
    selectModel: async (request) => {
      calls.push(request);
      if (request.model === 'invalid') throw new Error('model unavailable');
      return { selected: request };
    },
    modelCatalog: async () => ({ default: { provider: 'global', model: 'default' } }),
  } });
  assert.equal((await instance.rpc('settings/update', { model: { provider: 'p', model: 'new', reasoningEffort: 'high' } })).ok, true);
  assert.deepEqual(calls[0], { sessionId: 'resident', provider: 'p', model: 'new', reasoningEffort: 'high', saveAsDefault: false });
  assert.equal((await instance.rpc('settings/update', { model: { provider: 'p', model: 'invalid' } })).ok, false);
  assert.equal(instance.scope.get().modelModel, 'new');
  await instance.rpc('settings/update', { model: { provider: '', model: '' } });
  assert.equal(calls.at(-1).provider, 'global');
  assert.equal(calls.at(-1).model, 'default');
  const { registerProfileTools } = await import(moduleUrl('profile-tools.js'));
  const tools = new Map();
  registerProfileTools({ tools: { register: (tool) => tools.set(tool.name, tool) }, get: () => instance.controller });
  assert.equal((await tools.get('whale_profile_settings').execute({ patch: { model: { provider: 'tool', model: 'choice' } } })).ok, true);
  assert.equal(calls.at(-1).provider, 'tool');
});

test('a capable chat route and configured vision fallback cannot override the requested look provider', async (t) => {
  const calls = [];
  const instance = await host(t, {
    visionFallback: { configured: () => true },
    sessionController: { prompt: async () => { throw new Error('must not admit screenshot to chat route'); } },
    attachments: { saveImages: async () => [{ id: 'image' }] },
    llm: {
      resolveModelInfo: async (provider, model) => { calls.push(['resolve', provider, model]); return { inputModalities: ['image'] }; },
      stream: async function* (request) {
        calls.push(['stream', request.provider, request.model]);
        yield { type: 'text-delta', index: 0, text: '所选视觉模型的回复' };
        yield { type: 'finish', reason: { kind: 'stop' } };
      },
    },
  });
  const result = await instance.rpc('pet/look', { provider: 'look-provider', model: 'look-model', image: 'aGk=' });
  assert.equal(result.value.ok, true);
  assert.equal(result.value.reply, '所选视觉模型的回复');
  assert.ok(calls.some((row) => row[0] === 'stream' && row[1] === 'look-provider' && row[2] === 'look-model'));
  assert.ok(calls.every((row) => row[1] === 'look-provider'));
  calls.length = 0;
  instance.controller.follow = async function* () { yield { type: 'snapshot', records: [], projections: { values: { modelSelection: { next: {
    provider: 'look-provider', model: 'look-model',
  } } } } }; };
  instance.controller.prompt = async (request) => {
    assert.equal(request.content[0].type, 'image');
    instance.emit({ type: 'user/message', data: { source: { rpcId: request.requestId } } });
    instance.emit({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '常驻会话的视觉回复' }] } } });
    instance.emit({ type: 'turn/end', data: { reason: { kind: 'completed' } } });
    return { accepted: true };
  };
  const sameRoute = await instance.rpc('pet/look', { provider: 'look-provider', model: 'look-model', image: 'aGk=' });
  assert.equal(sameRoute.value.reply, '常驻会话的视觉回复');
  assert.equal(calls.some((row) => row[0] === 'stream'), false, 'same-route screenshot retains a real session turn');
});

test('failed pulse admissions stay durable and can be delivered after host restart without duplicate concurrent attempts', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-delivery-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let eventHandler;
  let cleanup;
  const ctx = { on: (_name, handler) => { eventHandler = handler; }, effect: (fn) => { cleanup = fn(); } };
  const observe = await import(`${moduleUrl('observe.js')}?reliability`);
  let accept = false;
  let attempts = 0;
  const wake = async () => { attempts += 1; if (!accept) throw new Error('admission unavailable'); return { accepted: true }; };
  observe.startPulse(ctx, { home: dir, wake });
  t.after(() => cleanup?.());
  const schedule = observe.addSchedule({ text: '提醒休息', inMinutes: 1 }).schedule;
  observe.addWatch({ sessionId: 'target', once: true });
  eventHandler({ id: 'target' }, { type: 'turn/end', data: { reason: { kind: 'completed' } } });
  await new Promise((resolve) => setImmediate(resolve));
  await observe.tick(schedule.nextRunAt);
  assert.equal(observe.listSchedules()[0].runCount, 0);
  assert.equal(observe.listSchedules()[0].enabled, true);
  assert.match(observe.listSchedules()[0].lastError, /admission unavailable/);
  assert.equal(observe.listWatches()[0].pending.length, 1);
  cleanup();
  const restarted = await import(`${moduleUrl('observe.js')}?restarted`);
  accept = true;
  restarted.startPulse(ctx, { home: dir, wake: async (text) => { await new Promise((resolve) => setImmediate(resolve)); return wake(text); } });
  const before = attempts;
  await Promise.all([restarted.tick(schedule.nextRunAt), restarted.tick(schedule.nextRunAt)]);
  assert.equal(attempts - before, 2, 'one watch and one schedule receipt');
  assert.equal(restarted.listWatches().length, 0);
  assert.equal(restarted.listSchedules()[0].runCount, 1);
  assert.equal(restarted.listSchedules()[0].enabled, false);
});

test('usage tool rejects an earlier day and accepts the current local day', async (t) => {
  const instance = await host(t);
  const tools = new Map();
  const { apply } = await import(moduleUrl('tools.js'));
  apply({ tools: { register: (tool) => tools.set(tool.name, tool) } });
  const usage = tools.get('whale_usage_today');
  const file = path.join(instance.home, 'data/whale/usage-today.json');
  fs.writeFileSync(file, JSON.stringify({ day: '2020-01-01', used: 123 }));
  assert.equal((await usage.execute({})).ok, false);
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  fs.writeFileSync(file, JSON.stringify({ day, used: 123, activeMsToday: 60000 }));
  assert.deepEqual(await usage.execute({}), { ok: true, used: 123, activeMinutes: 1, detail: `Today (${day}): 123 tokens, ~1 min active.` });
});

test('sticker markdown preserves drives and escaped path characters without emitting network URLs', async () => {
  const { markdownPathFor } = await import(moduleUrl('sticker-tools.js'));
  for (const file of ['D:\\Whale Isle\\happy(1)#.webp', 'C:\\Users\\me\\鲸鱼娘.png', '/tmp/a b.webp']) {
    const authored = markdownPathFor(file);
    assert.equal(decodeURIComponent(authored), file.replaceAll('\\', '/'));
    assert.doesNotMatch(authored, /[ ()#]/);
  }
  assert.throws(() => markdownPathFor('\\\\server\\share\\a b.webp'), /UNC/);
});
