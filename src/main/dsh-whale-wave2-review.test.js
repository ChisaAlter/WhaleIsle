'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
require('../../scripts/lib/harness-peer-hook.cjs');

const root = path.resolve(__dirname, '../..');
const toUrl = (rel) => pathToFileURL(path.join(root, rel)).href;
const harnessRequire = createRequire(toUrl('vendor/deepseek-harness/packages/client/connection/package.json'));

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-wave2-review-'));
  return Promise.resolve().then(() => fn(dir)).finally(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

function makeHttpReq(method, url, body) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { 'content-type': 'application/json' };
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
  req[Symbol.asyncIterator] = async function* () {
    if (payload) yield payload;
  };
  req.destroy = () => {};
  return req;
}

function makeHttpRes() {
  const out = { status: 0, headers: {}, body: '' };
  return {
    writeHead(status, headers = {}) { out.status = status; out.headers = headers; },
    end(chunk = '') { out.body += String(chunk); },
    json() { return JSON.parse(out.body); },
    out,
  };
}

test('dsh-whale RPC memory/replace and memory/clear work end-to-end without ReferenceError and enforce monotonic cap', async () => {
  const { apply } = await import(toUrl('vendor/dsh-whale/lib/index.js'));
  const { memoryIndexPath, INDEX_MAX_LINES } = await import(toUrl('vendor/dsh-whale/lib/memory-store.js'));
  await withTempDir(async (home) => {
    const prevHome = process.env.DSH_HOME;
    process.env.DSH_HOME = home;
    const disposers = [];
    try {
      let webHandler = null;
      const ctx = {
        logger: { warn() {} },
        systemPrompt: { section() {} },
        connection: {},
        webServer: {
          register(route) {
            if (route?.path === '/dsh-whale' || !webHandler) webHandler = route.handler;
            return () => {};
          },
        },
        effect(fn) {
          const dispose = fn();
          if (typeof dispose === 'function') disposers.push(dispose);
          else if (dispose && typeof dispose.then === 'function') {
            disposers.push(async () => {
              const resolved = await dispose;
              if (typeof resolved === 'function') await resolved();
            });
          }
          return () => {};
        },
        on() { return () => {}; },
        get() { return undefined; },
        inject() {},
      };
      apply(ctx);
      assert.equal(typeof webHandler, 'function');

      const rpc = async (endpoint, payload) => {
        const res = makeHttpRes();
        await webHandler(makeHttpReq('POST', `/dsh-whale/${endpoint}`, {
          type: 'client-request',
          rpcId: 'rpc-1',
          method: endpoint,
          payload,
        }), res, { principal: { kind: 'owner' } });
        return res.json();
      };

      const okRes = await rpc('memory/replace', { text: '# 记忆\n- 喜欢喝拿铁\n' });
      assert.equal(okRes.result.ok, true);
      assert.equal(okRes.result.value.ok, true);
      assert.match(fs.readFileSync(memoryIndexPath(home), 'utf8'), /拿铁/);

      const bloated = Array.from({ length: INDEX_MAX_LINES + 15 }, (_, i) => `- row ${i}`).join('\n');
      const blocked = await rpc('memory/replace', { text: bloated });
      assert.equal(blocked.result.ok, false);
      assert.match(blocked.result.error.message, /200 行/);

      fs.writeFileSync(memoryIndexPath(home), bloated, 'utf8');
      const shrunk = Array.from({ length: INDEX_MAX_LINES + 5 }, (_, i) => `- row ${i}`).join('\n');
      const shrinkOk = await rpc('memory/replace', { text: shrunk });
      assert.equal(shrinkOk.result.ok, true);
      assert.equal(shrinkOk.result.value.ok, true);

      const cleared = await rpc('memory/clear', {});
      assert.equal(cleared.result.ok, true);
      assert.equal(cleared.result.value.ok, true);
      assert.match(fs.readFileSync(memoryIndexPath(home), 'utf8'), /还没有记住什么/);
    } finally {
      for (const fn of disposers.splice(0).reverse()) await fn?.();
      if (prevHome === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = prevHome;
    }
  });
});

test('installMemoryToolGuard works on real Harness ToolsService + NativeToolExecutor + ToolExecutionPipeline (exec.arguments, replace_all, apply_patch, dual-dim shrink)', async () => {
  const { Context } = harnessRequire('@deepseek-ai/cordis');
  const { default: SessionProjectionRegistry } = await import(toUrl('vendor/deepseek-harness/packages/session/session-projection/lib/index.js'));
  const { default: SystemPrompt } = await import(toUrl('vendor/deepseek-harness/packages/core/system-prompt/lib/index.js'));
  const { default: ToolsService, defineTool } = await import(toUrl('vendor/deepseek-harness/packages/core/tools/lib/index.js'));
  const NativeToolExecutor = await import(toUrl('vendor/deepseek-harness/packages/core/tool-executor-native/lib/index.js'));
  const { installMemoryToolGuard } = await import(toUrl('vendor/dsh-whale/lib/host-hooks.js'));
  const { memoryDirPath, memoryIndexPath, INDEX_MAX_LINES } = await import(toUrl('vendor/dsh-whale/lib/memory-store.js'));

  await withTempDir(async (home) => {
    fs.mkdirSync(memoryDirPath(home), { recursive: true });
    const indexPath = memoryIndexPath(home);
    fs.writeFileSync(indexPath, '# Memory\n- seed\n', 'utf8');
    const atomPath = path.join(memoryDirPath(home), 'fact-1.md');
    fs.writeFileSync(atomPath, 'body', 'utf8');

    const ctx = new Context();
    await ctx.plugin(SessionProjectionRegistry);
    await ctx.plugin(SystemPrompt);
    await ctx.plugin(ToolsService);
    await ctx.plugin(NativeToolExecutor);
    try {
      const invoked = [];
      for (const name of ['write', 'edit', 'apply_patch']) {
        ctx.tools.register(defineTool({
          name,
          description: name,
          parameters: {
            file_path: { type: 'string' },
            content: { type: 'string' },
            old_string: { type: 'string' },
            new_string: { type: 'string' },
            replace_all: { type: 'boolean' },
            patch: { type: 'string' },
          },
          output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
          async execute(args) { invoked.push({ name, args }); return 'ok'; },
        }));
      }
      installMemoryToolGuard(ctx, home);

      const makeAgent = (sourceKind = 'user') => ({
        id: 'whale-1',
        ctx,
        session: {
          id: 'whale-1',
          snapshotEvents: () => [
            { seq: 1, type: 'turn/start', data: { turn: 1 } },
            { seq: 2, type: 'user/message', data: { source: { kind: sourceKind } } },
          ],
        },
      });
      const call = async (name, args, sourceKind = 'user') => {
        const batch = await ctx.tools.execute({
          agent: makeAgent(sourceKind),
          signal: new AbortController().signal,
          calls: [{ id: `call-${name}-${Math.random()}`, name, arguments: JSON.stringify(args) }],
        });
        return batch.results[0].result;
      };

      const bloated = Array.from({ length: INDEX_MAX_LINES + 10 }, (_, i) => `- line ${i}`).join('\n');
      const r1 = await call('write', { file_path: indexPath, content: bloated });
      assert.equal(r1.isError, true);
      assert.equal(invoked.length, 0);

      fs.writeFileSync(indexPath, Array.from({ length: 50 }, () => 'TOKEN').join('\n'), 'utf8');
      const r2 = await call('edit', {
        file_path: indexPath,
        old_string: 'TOKEN',
        new_string: 'a\nb\nc\nd\ne',
        replace_all: true,
      });
      assert.equal(r2.isError, true);

      const r3 = await call('apply_patch', { patch: `*** Begin Patch\n*** Delete File: ${atomPath}\n*** End Patch` });
      assert.equal(r3.isError, true);

      const addedLines = Array.from({ length: INDEX_MAX_LINES + 5 }, (_, i) => `+row ${i}`).join('\n');
      const r4 = await call('apply_patch', {
        patch: `*** Begin Patch\n*** Update File: ${indexPath}\n@@\n${addedLines}\n*** End Patch`,
      });
      assert.equal(r4.isError, true);

      fs.writeFileSync(indexPath, Array.from({ length: 100 }, () => 'x'.repeat(300)).join('\n'), 'utf8');
      const r5 = await call('write', {
        file_path: indexPath,
        content: Array.from({ length: 110 }, () => 'y'.repeat(235)).join('\n'),
      });
      assert.equal(r5.isError, false);

      const r6 = await call('write', { file_path: atomPath, content: '   \n' }, 'schedule');
      assert.equal(r6.isError, true);
    } finally {
      await ctx.fiber.dispose();
    }
  });
});

test('pre-compaction flush uses real tokenMeter.measure(session, epochHeader), compact-checkpoint reset, and inline agent/pre-step messages', async () => {
  const { maybeTriggerPreCompactionFlush } = await import(toUrl('vendor/dsh-whale/lib/memory-store.js'));
  const { installWhaleMemoryLifecycle } = await import(toUrl('vendor/dsh-whale/lib/host-hooks.js'));

  const measureCalls = [];
  const resolveCalls = [];
  let compactEvents = [{ seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] } }];
  const session = {
    id: 'whale-resident',
    header: { agentPreset: 'whale-girl' },
    requestHeader: () => ({ seq: 1, config: { provider: 'deepseek', model: 'deepseek-chat', maxTokens: 4096 } }),
    snapshotEvents: () => compactEvents,
  };
  const agent = {
    id: 'whale-resident',
    session,
    inbox: { enqueue() { throw new Error('deferInject should not enqueue separately'); } },
  };
  const ctx = {
    get(name) {
      if (name === 'tokenMeter') {
        return {
          measure(s, hdr) {
            measureCalls.push({ s, hdr });
            return { totalTokens: 60000 };
          },
        };
      }
      if (name === 'llm') {
        return {
          resolveModelInfo(p, m) {
            resolveCalls.push(`${p}/${m}`);
            return Promise.resolve({ contextWindow: 100000, defaultMaxTokens: 4096 });
          },
        };
      }
      return undefined;
    },
  };

  const flushed = new Map();
  const res1 = await maybeTriggerPreCompactionFlush(ctx, agent, flushed, { deferInject: true });
  assert.equal(res1.triggered, true);
  assert.equal(resolveCalls[0], 'deepseek/deepseek-chat');
  assert.equal(measureCalls[0].hdr.seq, 1);

  const res2 = await maybeTriggerPreCompactionFlush(ctx, agent, flushed, { deferInject: true });
  assert.equal(res2.triggered, false);

  compactEvents = [
    ...compactEvents,
    { seq: 42, type: 'user/message', data: { source: { kind: 'compact-checkpoint' }, content: [{ type: 'text', text: 'summary' }] } },
  ];
  const res3 = await maybeTriggerPreCompactionFlush(ctx, agent, flushed, { deferInject: true });
  assert.equal(res3.triggered, true);
  assert.equal(res3.epochSeq, 42);

  let preStepHook = null;
  const hookCtx = {
    ...ctx,
    on(event, fn) { if (event === 'agent/pre-step') preStepHook = fn; return () => {}; },
  };
  installWhaleMemoryLifecycle(hookCtx, { get: () => ({ sessionId: 'whale-resident' }) }, 'C:\\fake-home', {
    readSettings: () => ({ sessionId: 'whale-resident' }),
    isWhaleAssistantContext: () => true,
  });
  const decision = await preStepHook({ agent, modelSelection: { provider: 'deepseek', model: 'deepseek-chat' } }, async () => ({
    kind: 'enter',
    messages: [],
  }));
  assert.equal(decision.kind, 'enter');
  assert.equal(decision.messages.length, 1);
  assert.equal(decision.messages[0].source.kind, 'dsh-whale:pre-compaction-flush');
  assert.equal(decision.messages[0].source.form, 'notice');
});

test('schedule origin is classified as unattended pulse, pulse wake never spoofs user prompt, and schedule migration handles invalid rows & async activation', async () => {
  const { classifyCallOrigin, isUnattendedPulseTurn } = await import(toUrl('vendor/dsh-whale/lib/call-origin.js'));
  const { createWhalePulseWake } = await import(toUrl('vendor/dsh-whale/lib/host-hooks.js'));
  const { migrateLegacySchedules, installLegacyScheduleMigration } = await import(toUrl('vendor/dsh-whale/lib/schedule-migration.js'));
  const { whaleHomeDir } = await import(toUrl('vendor/dsh-whale/lib/preset.js'));

  const schedExec = {
    agent: {
      session: {
        snapshotEvents: () => [
          { seq: 1, type: 'turn/start', data: { turn: 1 } },
          { seq: 2, type: 'user/message', data: { source: { kind: 'schedule' } } },
        ],
      },
    },
  };
  assert.equal(classifyCallOrigin(schedExec).kind, 'pulse');
  assert.equal(isUnattendedPulseTurn(schedExec), true);

  let promptCalled = false;
  const wake = createWhalePulseWake(
    { get: () => undefined },
    { get: () => undefined, sessionController: { prompt: async () => { promptCalled = true; } } },
    { get: () => ({ sessionId: 'whale-1' }) },
    async () => ({ ok: true, sessionId: 'whale-1' }),
  );
  await assert.rejects(() => wake('定时巡检'), /resident-agent-unavailable-for-pulse/);
  assert.equal(promptCalled, false);

  await withTempDir(async (home) => {
    const dir = whaleHomeDir(home);
    fs.mkdirSync(dir, { recursive: true });
    const now = Date.now();
    fs.writeFileSync(path.join(dir, 'schedules.json'), JSON.stringify([
      { id: 's1', kind: 'interval', everyMinutes: 15, text: '巡检任务一   ', enabled: true },
      { id: 's2', kind: 'once', nextRunAt: now + 60_000, text: '触发边界已过期', enabled: true },
      { id: 's3', kind: 'daily', daily: '09:30', text: '每日汇报', enabled: true },
    ]), 'utf8');

    const created = [];
    const scheduleSvc = {
      async list() { return { items: [] }; },
      async create(req) {
        if (req.prompt === '触发边界已过期') {
          const err = new Error('not future');
          err.code = 'not_future';
          throw err;
        }
        if (req.timing.kind === 'daily' && req.timing.daily.time_zone === 'Bad/Zone') {
          const err = new Error('bad tz');
          err.code = 'invalid_time_zone';
          throw err;
        }
        created.push(req);
        return { id: `sch-${created.length}` };
      },
    };
    const res = await migrateLegacySchedules(
      { get: (k) => (k === 'schedule' ? scheduleSvc : undefined) },
      { home, sessionId: 'whale-1', now, timeZone: 'Bad/Zone' },
    );
    assert.equal(res.skipped, false);
    assert.equal(res.migrated, 2);
    assert.equal(res.skippedInvalid, 1);
    assert.equal(created[1].timing.daily.time_zone, 'UTC');

    fs.writeFileSync(path.join(dir, 'schedules.json'), JSON.stringify([
      { id: 's4', kind: 'interval', everyMinutes: 30, text: '延迟激活迁移', enabled: true },
    ]), 'utf8');
    let schedCb = null;
    const fakeCtx = {
      logger: { warn() {} },
      inject(deps, fn) { if (deps.includes('schedule')) schedCb = fn; },
    };
    const runOnce = installLegacyScheduleMigration(fakeCtx, { get: () => ({}) }, home, async () => ({ ok: true, sessionId: 'whale-1' }));
    const rEarly = await runOnce({ get: () => undefined }, 'whale-1');
    assert.equal(rEarly.reason, 'native-schedule-unavailable');
    assert.equal(fs.existsSync(path.join(dir, 'schedules.json')), true);

    await schedCb({
      sessionController: {},
      get: (k) => (k === 'schedule' ? scheduleSvc : undefined),
      effect: (fn) => fn(),
    });
    assert.equal(fs.existsSync(path.join(dir, 'schedules.json')), false);
    assert.equal(created.some((r) => r.prompt === '延迟激活迁移'), true);
  });
});

test('irreversible taint blocks all whale tools and whale_list_workspaces reads real Workspace.title', async () => {
  const { registerTaskTools } = await import(toUrl('vendor/dsh-whale/lib/task-tools.js'));
  const { registerDiscoveryTools } = await import(toUrl('vendor/dsh-whale/lib/discovery-tools.js'));
  const { registerSessionTools } = await import(toUrl('vendor/dsh-whale/lib/session-tools.js'));
  const { apply: applyTools } = await import(toUrl('vendor/dsh-whale/lib/tools.js'));
  const { formatSpeakerRpcId } = await import(toUrl('vendor/dsh-im/src/channels/shared/single-owner-gate.mjs'));

  const registered = new Map();
  const ctx = {
    tools: { register(tool) { registered.set(tool.name, tool); } },
    get(name) {
      if (name === 'workspaceRegistry') {
        return { list: () => [{ id: 'ws-1', title: '我的主项目', path: 'C:\\Work\\Proj' }] };
      }
      if (name === 'whaleTodos') {
        return { available: true, list: () => [], create: async () => ({ id: 't1' }) };
      }
      return undefined;
    },
  };
  applyTools(ctx);
  registerTaskTools(ctx);
  registerDiscoveryTools(ctx);
  registerSessionTools(ctx, { getSelfId: () => 'whale-1' });

  const ownerExec = {
    agent: {
      id: 'whale-1',
      session: {
        snapshotEvents: () => [
          { seq: 1, type: 'turn/start', data: { turn: 1 } },
          { seq: 2, type: 'user/message', data: { source: { kind: 'user' } } },
        ],
      },
    },
  };
  const ws = await registered.get('whale_list_workspaces').execute({}, ownerExec);
  assert.equal(ws.ok, true);
  assert.equal(ws.workspaces[0].name, '我的主项目');

  const guestRpcId = formatSpeakerRpcId('feishu', { role: 'guest', chat: 'private' });
  const taintedExec = {
    agent: {
      id: 'whale-guest',
      session: {
        snapshotEvents: () => [
          { seq: 1, type: 'turn/start', data: { turn: 1 } },
          { seq: 2, type: 'user/message', data: { source: { kind: 'user', rpcId: guestRpcId } } },
          { seq: 3, type: 'turn/end', data: { reason: { kind: 'completed' } } },
          { seq: 4, type: 'turn/start', data: { turn: 2 } },
          { seq: 5, type: 'user/message', data: { source: { kind: 'user' } } },
        ],
      },
    },
  };
  for (const [toolName, args] of [
    ['whale_todo_list', {}],
    ['whale_todo_create', { title: 'x', description: 'y' }],
  ]) {
    await assert.rejects(() => registered.get(toolName).execute(args, taintedExec), /永久隔离/);
  }
  for (const [toolName, args] of [
    ['whale_recent_events', {}],
    ['whale_send_to_session', { sessionId: 'other', text: 'hi' }],
    ['whale_new_session', { cwd: 'C:\\Work\\Proj' }],
    ['whale_watch', { action: 'list' }],
    ['whale_schedule', { action: 'list' }],
    ['whale_cancel_session', { sessionId: 'other' }],
    ['whale_rename_session', { sessionId: 'other', title: 't' }],
    ['whale_fork_session', { sessionId: 'other' }],
    ['whale_delete_session', { sessionId: 'other' }],
    ['whale_select_model', { sessionId: 'other', provider: 'p', model: 'm' }],
    ['whale_update_queue', { sessionId: 'other', itemId: 'q1', action: 'remove' }],
  ]) {
    const res = await registered.get(toolName).execute(args, taintedExec);
    assert.equal(res.ok, false, `${toolName} must reject tainted sessions`);
    assert.match(res.detail, /永久隔离/);
  }
});

test('WhaleTodos rejects indirect dependency cycles, prevents concurrent auto-advance double-start, preserves waiting_approval phase, and uses baseSeq on continue crash recovery', async () => {
  const { mountWhaleTodos } = await import(toUrl('vendor/dsh-whale/lib/todo-service.js'));
  const { buildWorkbenchSnapshot } = await import(toUrl('vendor/dsh-whale/lib/sse-hub.js'));

  await withTempDir(async (home) => {
    const table = new Map();
    const listeners = new Map();
    const createdAgents = [];
    const controller = {
      list: async () => [],
      create: async () => ({}),
      selectModel: async () => ({}),
      prompt: async () => ({ accepted: true }),
      cancel: async () => {},
    };
    const agentsMap = new Map();
    let observeEvents = [];
    const agentsSvc = {
      get: (id) => agentsMap.get(id),
      create: async (opts) => {
        const sid = opts.sessionId;
        const session = { id: sid, seq: 10, snapshotEvents: () => [] };
        const agent = {
          id: sid,
          session,
          status: 'running',
          inbox: { enqueue() { return { accepted: true }; } },
          cancel: async () => {},
        };
        agentsMap.set(sid, agent);
        createdAgents.push(sid);
        return { agent, dispose: async () => {} };
      },
    };
    const presetsSvc = { mount: async () => () => {}, list: async () => [{ id: 'standard' }] };
    const ctx = {
      logger: { warn() {} },
      on(ev, fn) {
        if (!listeners.has(ev)) listeners.set(ev, []);
        listeners.get(ev).push(fn);
        return () => {};
      },
      emit(ev, ...args) { for (const fn of listeners.get(ev) ?? []) fn(...args); },
      provide() {},
      effect(fn) { return fn(); },
      get(name) {
        if (name === 'sessionController') return controller;
        if (name === 'agents') return agentsSvc;
        if (name === 'agentPresets') return presetsSvc;
        if (name === 'whaleTodos') return service;
        if (name === 'sessionQuery') return { observeSession: async () => ({ events: observeEvents }) };
        if (name === 'typertGateway') {
          return { getPendingRemoteEvents: () => [{ agentId: 'whale-resident', event: 'approval/request' }] };
        }
        return undefined;
      },
      storageDomain: {
        open: async () => ({
          table: () => ({
            entries: () => table.entries(),
            get: (k) => table.get(k),
            put: async (k, v) => { table.set(k, v); },
            delete: async (k) => { table.delete(k); },
          }),
          close: async () => {},
        }),
      },
      sessionController: controller,
      agents: agentsSvc,
    };
    const scope = {
      get: () => ({
        sessionId: 'whale-resident',
        autoAdvance: true,
        taskRootDir: path.join(home, 'tasks'),
        modelProvider: 'deepseek',
        modelModel: 'deepseek-chat',
      }),
    };
    const service = await mountWhaleTodos(ctx, { home, scope });

    const a = await service.create({ title: 'A', description: 'do A' });
    const b = await service.create({ title: 'B', description: 'do B', dependsOn: [a.id] });
    const c = await service.create({ title: 'C', description: 'do C', dependsOn: [b.id] });
    await assert.rejects(() => service.update(a.id, { dependsOn: [c.id] }), /循环/);

    const d = await service.create({ title: 'D', description: 'do D' });
    await Promise.all([service.maybeAutoAdvance('test'), service.start(d.id)]);
    assert.equal(createdAgents.length, 1);

    const runningCard = service.list().find((item) => item.state === 'running');
    service.delegationDisposers.set(runningCard.id, () => {});
    ctx.emit('session/event', { id: runningCard.sessionId }, { type: 'approval/asked', data: {} });
    ctx.emit('session/event', { id: runningCard.sessionId }, { type: 'tool/call', data: { name: 'read' } });
    await new Promise((r) => setTimeout(r, 20));
    const afterWait = service.get(runningCard.id);
    assert.equal(afterWait.state, 'waiting_approval');
    assert.equal(afterWait.phase, '等待审批');

    const snap = buildWorkbenchSnapshot(ctx, scope);
    const snapCard = snap.cards.find((item) => item.id === runningCard.id);
    assert.equal(snapCard.actionSessionId, 'whale-resident');
    assert.equal(snap.resident.pendingInput.includes('approval'), true);
    assert.equal(snap.needsYou.length, 1);
    assert.equal(snap.needsYou[0].state, 'waiting_approval');
    assert.equal(snap.needsYou[0].actionSessionId, 'whale-resident');

    ctx.emit('session/event', { id: runningCard.sessionId }, { type: 'turn/end', data: { reason: { kind: 'completed' } } });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(service.get(runningCard.id).state, 'review');

    await service.continue(runningCard.id, '再改一下第二段');
    assert.equal(service.get(runningCard.id).runs.at(-1).baseSeq, 10);

    observeEvents = [
      { seq: 1, type: 'turn/start', data: {} },
      { seq: 8, type: 'turn/end', data: { reason: { kind: 'completed' } } },
    ];
    const recoveredService = await mountWhaleTodos(ctx, { home, scope });
    assert.equal(recoveredService.get(runningCard.id).state, 'interrupted');
  });
});

test('dsh-im single-owner RPC works through REAL Harness HostConnectionService + serverResponseSchema and exposes internal owner ID without leaking publicly', async () => {
  const { Context } = harnessRequire('@deepseek-ai/cordis');
  const { ConnectionAuthentication, HostConnectionService, serverResponseSchema } = await import(toUrl('vendor/deepseek-harness/packages/client/connection/lib/index.js'));
  const { installSingleOwnerRpc, SINGLE_OWNER_RPC_CHANNEL } = await import(toUrl('vendor/dsh-im/plugin-src/host/channels/shared/single-owner-rpc.mjs'));
  const { SingleOwnerAccessGate } = await import(toUrl('vendor/dsh-im/src/channels/shared/single-owner-gate.mjs'));

  await withTempDir(async (dir) => {
    const gate = new SingleOwnerAccessGate({ path: path.join(dir, 'owner.json'), home: dir });
    await gate.load();
    const botGate = gate.createBotGate({ channel: 'feishu', botId: 'bot-1' });
    const pending = await botGate.evaluateInbound({
      senderId: 'ou_secret_owner_42',
      displayName: '张三',
      chatType: 'private',
      preset: 'whale-girl',
    });
    assert.equal(pending.allowed, false);
    assert.equal(pending.reason, 'pairing-required');
    assert.equal(Boolean(pending.pairing?.code), true);

    const ctx = new Context();
    let mountedPrefix = null;
    ctx.provide('webServer', {
      register(route) {
        mountedPrefix = route;
        return () => {};
      },
    });
    new ConnectionAuthentication(ctx);
    const connection = new HostConnectionService(ctx, []);

    const dispose = installSingleOwnerRpc({ connection }, gate);
    const server = http.createServer((req, res) => { void mountedPrefix.handler(req, res, connection.browserPeer); });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
      assert.equal(SINGLE_OWNER_RPC_CHANNEL, '/dsh-im');
      assert.equal(mountedPrefix?.path, '/dsh-im');

      const callHttpRpc = async (endpoint, payload = {}) => {
        const resp = await fetch(`http://127.0.0.1:${port}/dsh-im/${endpoint}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'client-request', rpcId: 'r1', method: endpoint, payload }),
        });
        assert.equal(resp.status, 200);
        return serverResponseSchema.parse(await resp.json());
      };

      const statusResp = await callHttpRpc('access/status', { channel: 'feishu', botId: 'bot-1' });
      assert.equal(statusResp.result.ok, true);
      assert.equal(JSON.stringify(statusResp).includes('ou_secret_owner_42'), false);

      const badCodeResp = await callHttpRpc('access/approve', { channel: 'feishu', botId: 'bot-1', code: 'INVALID', confirm: true });
      assert.equal(badCodeResp.result.ok, false);
      assert.deepEqual(badCodeResp.result.error.details, {});

      const okApprove = await callHttpRpc('access/approve', {
        channel: 'feishu',
        botId: 'bot-1',
        code: pending.pairing.code,
        confirm: true,
      });
      assert.equal(okApprove.result.ok, true);
      assert.equal(botGate.getOwnerPlatformUserId(), 'ou_secret_owner_42');
      assert.equal(JSON.stringify(botGate.publicStatus()).includes('ou_secret_owner_42'), false);
    } finally {
      server.close();
      dispose();
      await ctx.fiber.dispose();
    }
  });
});

test('dsh-acp acp_delegate validates whale-girl cwd BEFORE desktop confirmation (0 confirm calls on missing or whale-home cwd)', async () => {
  const { registerDelegation } = await import(toUrl('dsh-acp/lib/delegation.js'));
  await withTempDir(async (home) => {
    let confirmHits = 0;
    const server = http.createServer((_req, res) => {
      confirmHits += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const prevHome = process.env.DSH_HOME;
    const prevUrl = process.env.DSH_DESKTOP_INSTALL_URL;
    process.env.DSH_HOME = home;
    process.env.DSH_DESKTOP_INSTALL_URL = `http://127.0.0.1:${port}`;
    try {
      const tools = new Map();
      const ctx = {
        effect(fn) { return fn(); },
        subagents: { registerProvider: () => () => {} },
        tools: { register(tool) { tools.set(tool.name, tool); return () => {}; } },
      };
      registerDelegation(ctx, { listDelegationAgents: () => [], delegate: async () => { throw new Error('should not delegate'); } });
      const delegateTool = tools.get('acp_delegate');
      const whaleAgent = { id: 'whale-1', session: { header: { agentPreset: 'whale-girl', cwd: path.join(home, 'data', 'whale') } } };

      await assert.rejects(
        () => delegateTool.execute({ agent: 'codex', prompt: 'fix bug' }, { agent: whaleAgent }),
        /cwd/i,
      );
      assert.equal(confirmHits, 0);

      const whaleData = path.join(home, 'data', 'whale');
      fs.mkdirSync(whaleData, { recursive: true });
      await assert.rejects(
        () => delegateTool.execute({ agent: 'codex', prompt: 'fix bug', cwd: whaleData }, { agent: whaleAgent }),
        /data\/whale|DSH_HOME|目录/,
      );
      assert.equal(confirmHits, 0);
    } finally {
      server.close();
      if (prevHome === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = prevHome;
      if (prevUrl === undefined) delete process.env.DSH_DESKTOP_INSTALL_URL;
      else process.env.DSH_DESKTOP_INSTALL_URL = prevUrl;
    }
  });
});
