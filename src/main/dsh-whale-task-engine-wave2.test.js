'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const todoServiceUrl = pathToFileURL(path.join(__dirname, '../../vendor/dsh-whale/lib/todo-service.js')).href;
const taskToolsUrl = pathToFileURL(path.join(__dirname, '../../vendor/dsh-whale/lib/task-tools.js')).href;
const toolsUrl = pathToFileURL(path.join(__dirname, '../../vendor/dsh-whale/lib/tools.js')).href;
const inspectionUrl = pathToFileURL(path.join(__dirname, '../../vendor/dsh-task-control/lib/inspection.js')).href;

function makeTempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function createManagedFixture(t, {
  admissionOpen = true,
  withDirectAgents = true,
  legacyTasks = [],
  taskRootDir,
} = {}) {
  const { mountWhaleTodos, todoSchema } = await import(todoServiceUrl);
  const root = makeTempDir(t, 'whale-wave2-engine-');
  const home = path.join(root, 'dsh-home');
  const workspaceRoot = taskRootDir ?? path.join(root, 'tasks-root');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });

  const orderLog = [];
  const values = new Map();
  const createdDirect = [];
  const restrictedTools = [];
  const delegatedBindings = [];
  const delegatedDisposed = [];
  const jobCalls = [];
  const controllerCalls = [];
  const agents = new Map();
  const ownerAppends = [];
  const sessionEventHandlers = [];
  const toolGuards = [];
  const services = new Map();
  let scopeState = { sessionId: 'resident-whale', taskRootDir: workspaceRoot, autoAdvance: false };

  const ownerAgent = {
    id: 'resident-whale',
    session: {
      id: 'resident-whale',
      header: { id: 'resident-whale', agentPreset: 'whale-girl' },
      append: (type, data) => {
        orderLog.push(`owner.append:${type}`);
        ownerAppends.push({ type, data });
      },
      snapshotEvents: () => ownerAppends.map((entry, idx) => ({ seq: idx + 1, ...entry })),
    },
  };
  agents.set('resident-whale', ownerAgent);

  const runningJobs = new Map();
  const jobsSvc = {
    list: (sessionId) => runningJobs.get(sessionId) ?? [],
    kill: async (jobId, sessionId, reason) => {
      jobCalls.push({ op: 'kill', jobId, sessionId, reason });
      const list = runningJobs.get(sessionId) ?? [];
      for (const item of list) {
        if (item.id === jobId) item.status = 'stopped';
      }
    },
    wait: async (jobId, waitMs, sessionId) => {
      jobCalls.push({ op: 'wait', jobId, waitMs, sessionId });
    },
  };

  const approvalSvc = {
    policyRecord: () => null,
    enableDelegatedRequests: (agent, owner) => {
      delegatedBindings.push({ op: 'enable', childId: agent.id, ownerId: owner.id });
    },
    bindDelegatedRequester: (agent, opts) => {
      delegatedBindings.push({ op: 'bind', childId: agent.id, ownerId: opts.owner.id, label: opts.label, validate: opts.validate });
      return () => { delegatedDisposed.push(agent.id); };
    },
  };

  const agentsSvc = withDirectAgents
    ? {
        get: (id) => agents.get(id) ?? null,
        create: async (opts) => {
          createdDirect.push(opts);
          const sessionEvents = [];
          const agent = {
            id: opts.sessionId,
            session: {
              id: opts.sessionId,
              header: { id: opts.sessionId, ...opts.meta },
              append: (type, data) => sessionEvents.push({ type, data }),
              snapshotEvents: () => sessionEvents,
            },
            cancel: (...args) => controllerCalls.push(['cancel', opts.sessionId, ...args]),
            whenIdle: async () => {},
          };
          const knownRestrictable = new Set(['subagent', 'subagent_fork', 'read', 'write']);
          const agentCtx = {
            tools: {
              view: () => ({ restrictableNames: knownRestrictable }),
              restrict: (spec) => {
                for (const name of spec.deny ?? []) {
                  if (!knownRestrictable.has(name)) {
                    throw new Error(`tools.restrict() names unknown global tool "${name}"`);
                  }
                }
                restrictedTools.push({ sessionId: opts.sessionId, spec });
              },
            },
          };
          if (typeof opts.setup === 'function') await opts.setup(agentCtx, agent);
          agents.set(opts.sessionId, agent);
          return { agent, dispose: async () => { controllerCalls.push(['dispose', opts.sessionId]); } };
        },
      }
    : { get: (id) => agents.get(id) ?? null };

  const agentPresetsSvc = withDirectAgents
    ? {
        resolve: async (id) => ({ id }),
        mount: async () => {},
      }
    : null;

  const domain = {
    table: () => ({
      entries: () => values.entries(),
      get: (id) => values.get(id),
      put: async (id, value) => {
        const parsed = todoSchema.parse(structuredClone(value));
        orderLog.push(`cards.put:${parsed.state}`);
        values.set(id, parsed);
      },
      delete: async (id) => values.delete(id),
    }),
    close: async () => {},
  };

  const sessionController = {
    projections: async () => ({ values: { modelSelection: { next: { provider: 'deepseek', model: 'deepseek-chat' } } } }),
    modelCatalog: async () => ({ default: { provider: 'deepseek', model: 'deepseek-chat' } }),
    create: async (input) => {
      controllerCalls.push(['create', input]);
      const agent = {
        id: input.sessionId,
        session: { id: input.sessionId, header: { id: input.sessionId }, append: () => {}, snapshotEvents: () => [] },
        cancel: (...args) => controllerCalls.push(['cancel', input.sessionId, ...args]),
        whenIdle: async () => {},
      };
      agents.set(input.sessionId, agent);
      return { sessionId: input.sessionId };
    },
    resolveAgent: async (id) => ({ agent: agents.get(id) ?? null, error: agents.has(id) ? null : new Error('missing') }),
    selectModel: async (input) => controllerCalls.push(['selectModel', input]),
    prompt: async (input) => controllerCalls.push(['prompt', input]),
  };

  let admission = admissionOpen;
  services.set('agents', agentsSvc);
  if (agentPresetsSvc) services.set('agentPresets', agentPresetsSvc);
  services.set('approval', approvalSvc);
  services.set('jobs', jobsSvc);
  services.set('desktopTaskAdmission', { check: () => admission });
  services.set('whaleTasks', { available: true, list: () => legacyTasks, inspect: () => [] });

  const ctx = {
    storageDomain: { open: async () => domain },
    sessionController,
    agents: agentsSvc,
    approval: approvalSvc,
    jobs: jobsSvc,
    get: (name) => services.get(name),
    provide: (name, value) => services.set(name, value),
    on: (name, fn) => {
      if (name === 'session/event') sessionEventHandlers.push(fn);
    },
    effect: () => {},
    tools: {
      guard: (fn) => toolGuards.push(fn),
    },
    logger: { warn: () => {}, info: () => {} },
  };

  const scope = {
    get: () => scopeState,
    set: async (next) => { scopeState = next; },
  };

  const service = await mountWhaleTodos(ctx, { home, scope });
  return {
    root,
    home,
    workspaceRoot,
    service,
    ctx,
    scope,
    services,
    orderLog,
    createdDirect,
    restrictedTools,
    delegatedBindings,
    delegatedDisposed,
    runningJobs,
    jobCalls,
    controllerCalls,
    ownerAppends,
    toolGuards,
    setAdmission: (open) => { admission = open; },
    emitSessionEvent: async (sessionId, event) => {
      for (const fn of sessionEventHandlers) await fn({ id: sessionId }, event);
      await service.chain;
    },
  };
}

test('3-layer TaskCard allocates isolated subdir, preserves explicit cwd, enforces dependsOn, and migrates legacy tasks non-destructively', async (t) => {
  const fx = await createManagedFixture(t, {
    legacyTasks: [
      {
        id: 'legacy-brief-1',
        goal: '整理历史周报素材',
        state: 'completed',
        createdAt: 1700000000000,
        updatedAt: 1700000001000,
        result: { summary: '已完成三份文档梳理', evidence: ['doc-1'] },
      },
    ],
  });

  // Non-destructive legacy import mirrors legacy whale_tasks into unified cards.
  const imported = fx.service.list().find((card) => card.legacyTaskId === 'legacy-brief-1');
  assert.ok(imported, 'legacy whale_task must be mirrored into unified TaskCard list');
  assert.equal(imported.mode, 'readonly-brief');
  assert.equal(imported.state, 'review');
  assert.equal(imported.archived, true);
  assert.match(imported.summary, /三份文档/);

  // Omitted cwd allocates a per-task isolated subdirectory under taskRootDir.
  const taskA = await fx.service.create({ title: '准备数据结构', description: '步骤一' });
  assert.equal(taskA.mode, 'workspace-task');
  assert.ok(path.resolve(taskA.cwd).startsWith(path.resolve(fx.workspaceRoot) + path.sep));

  // Explicit cwd is preserved verbatim.
  const explicitDir = path.join(fx.root, 'explicit-repo');
  fs.mkdirSync(explicitDir, { recursive: true });
  const taskB = await fx.service.create({
    title: '下游汇总',
    cwd: explicitDir,
    dependsOn: [taskA.id],
  });
  assert.equal(taskB.cwd, explicitDir);
  assert.deepEqual(taskB.dependsOn, [taskA.id]);

  // Dependency blocks start until taskA reaches completed.
  await assert.rejects(fx.service.start(taskB.id), /前置依赖尚未完成/);
  await fx.service.transition(taskA.id, 'complete');
  const startedB = await fx.service.start(taskB.id);
  assert.equal(startedB.state, 'running');
  assert.equal(startedB.runs.length, 1);
  assert.equal(startedB.runs[0].attempt, 1);
  assert.equal(startedB.runs[0].sessionId, startedB.sessionId);
});

test('workspace-task decouples from subagent/catalog, wires delegated approval, tracks waiting states & deliverables, persists before receipt, and drains jobs on stop', async (t) => {
  const fx = await createManagedFixture(t);
  const card = await fx.service.create({ title: '生成交付报告', description: '产出 markdown 报告' });
  const running = await fx.service.start(card.id);

  // Uses direct ctx.agents.create with meta.parentSession and NO origin: 'subagent'.
  assert.equal(fx.createdDirect.length, 1);
  const spec = fx.createdDirect[0];
  assert.equal(spec.meta.parentSession, 'resident-whale');
  assert.equal(spec.meta.origin, undefined, 'must NOT tag origin: subagent or pollute subagent/catalog');
  assert.ok(fx.restrictedTools.some((entry) => entry.sessionId === running.sessionId && entry.spec.deny.includes('subagent')));

  // Recursive delegation guard also blocks tool execution from child task session.
  const guardReason = fx.toolGuards.map((fn) => fn({ agent: { id: running.sessionId }, name: 'whale_todo_create' })).find(Boolean);
  assert.match(String(guardReason), /禁止递归派发/);

  // Delegated approval enabled + bound to resident whale-girl session.
  assert.ok(fx.delegatedBindings.some((entry) => entry.op === 'enable' && entry.childId === running.sessionId && entry.ownerId === 'resident-whale'));
  const bound = fx.delegatedBindings.find((entry) => entry.op === 'bind' && entry.childId === running.sessionId);
  assert.ok(bound);
  assert.equal(bound.validate(), true);

  // Approval/question/deliverable events project onto card & run.
  await fx.service.event({ id: running.sessionId }, { type: 'approval/asked', data: {} });
  assert.equal(fx.service.get(card.id).state, 'waiting_approval');
  assert.deepEqual(fx.service.get(card.id).pendingInput, ['approval']);

  // Task-control inspection sees waiting_approval via whaleTodos.
  const { collectInspection } = await import(inspectionUrl);
  const inspected = await collectInspection(fx.ctx, { hostGeneration: 1, lock: null, pending: new Set() });
  assert.equal(inspected.coverage.whaleTodos, 'ok');
  assert.ok(inspected.activeWork.some((item) => item.kind === 'whale-todo' && item.id === card.id && item.detail === 'waiting_approval'));

  await fx.service.event({ id: running.sessionId }, { type: 'approval/decided', data: {} });
  assert.equal(fx.service.get(card.id).state, 'running');

  await fx.service.event({ id: running.sessionId }, { type: 'user-questions/asked', data: {} });
  assert.equal(fx.service.get(card.id).state, 'waiting_input');
  assert.deepEqual(fx.service.get(card.id).pendingInput, ['question']);

  await fx.service.event({ id: running.sessionId }, { type: 'user-questions/answered', data: {} });
  assert.equal(fx.service.get(card.id).state, 'running');

  await fx.service.event({ id: running.sessionId }, {
    type: 'deliverables/presented',
    seq: 9,
    data: { files: [{ path: path.join(running.cwd, 'report.md'), description: '最终分析报告' }] },
  });
  assert.equal(fx.service.get(card.id).deliverables.length, 1);
  assert.equal(fx.service.get(card.id).deliverables[0].description, '最终分析报告');

  await fx.service.event({ id: running.sessionId }, {
    type: 'assistant/message',
    data: { content: [{ type: 'text', text: '报告已生成并验证完成。' }] },
  });
  await fx.service.event({ id: running.sessionId }, {
    type: 'turn/end',
    data: { reason: { kind: 'completed' } },
  });
  // Flush microtasks for async receipt delivery.
  await new Promise((resolve) => setImmediate(resolve));

  const reviewed = fx.service.get(card.id);
  assert.equal(reviewed.state, 'review');
  assert.equal(fx.delegatedDisposed.includes(running.sessionId), true);
  assert.equal(fx.ownerAppends.length, 1);
  assert.equal(fx.ownerAppends[0].data.source.kind, 'dsh-whale:todo-receipt');
  assert.equal(fx.ownerAppends[0].data.source.form, 'notice');
  assert.equal(fx.ownerAppends[0].data.source.cardId, card.id);
  const receiptText = fx.ownerAppends[0].data.content[0].text;
  assert.match(receiptText, /生成交付报告/);
  assert.match(receiptText, /report\.md/);
  // Persist-first ordering: cards.put:review occurred BEFORE owner.append:user/message.
  const persistIdx = fx.orderLog.lastIndexOf('cards.put:review');
  const appendIdx = fx.orderLog.lastIndexOf('owner.append:user/message');
  assert.ok(persistIdx >= 0 && appendIdx > persistIdx, 'card state MUST persist before receipt is appended');

  // Review continuation reuses exact sessionId and adds attempt 2.
  const continued = await fx.service.continue(card.id, '请补充风险章节');
  assert.equal(continued.state, 'running');
  assert.equal(continued.sessionId, running.sessionId, 'continue() must keep original sessionId');
  assert.equal(continued.runs.length, 2);
  assert.equal(continued.runs[1].attempt, 2);
  const lastPrompt = fx.controllerCalls.findLast(([kind]) => kind === 'prompt');
  assert.equal(lastPrompt[1].sessionId, running.sessionId);
  assert.match(lastPrompt[1].content[0].text, /请补充风险章节/);

  // stop() drains Harness jobs owned by the task session.
  fx.runningJobs.set(running.sessionId, [{ id: 'job-bg-1', status: 'running' }]);
  const stopped = await fx.service.stop(card.id);
  assert.equal(stopped.state, 'cancelled');
  assert.ok(fx.jobCalls.some((call) => call.op === 'kill' && call.jobId === 'job-bg-1' && call.sessionId === running.sessionId));
  assert.ok(fx.jobCalls.some((call) => call.op === 'wait' && call.jobId === 'job-bg-1' && call.sessionId === running.sessionId));
});

test('autoAdvance starts next unblocked pending card while keeping finished card in review, and admission lock blocks start/continue', async (t) => {
  const fx = await createManagedFixture(t);
  const c1 = await fx.service.create({ title: '任务 1' });
  const c2 = await fx.service.create({ title: '任务 2' });
  const c3 = await fx.service.create({ title: '依赖任务 3', dependsOn: [c1.id] });

  // Admission lock blocks start.
  fx.setAdmission(false);
  await assert.rejects(fx.service.start(c1.id), /准入已锁定/);
  fx.setAdmission(true);

  const started1 = await fx.service.start(c1.id);
  await fx.service.setAutoAdvance(true);
  assert.equal(fx.service.autoAdvanceEnabled(), true);

  // Complete turn for c1 -> c1 stays in `review` for human confirmation, c2 auto-starts, c3 stays blocked on c1.
  await fx.service.event({ id: started1.sessionId }, { type: 'turn/end', data: { reason: { kind: 'completed' } } });
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(fx.service.get(c1.id).state, 'review', 'finished card must remain in review for human sign-off');
  assert.equal(fx.service.get(c2.id).state, 'running', 'next unblocked pending card auto-started');
  assert.equal(fx.service.get(c3.id).state, 'pending', 'dependent card must stay pending until c1 is completed');
});

test('bidirectional whale_todo_* tools enforce single-owner IM boundaries and readonly-brief blocks $DSH_HOME reads', async (t) => {
  const fx = await createManagedFixture(t);
  const { registerTaskTools } = await import(taskToolsUrl);
  const registered = new Map();
  const toolCtx = {
    ...fx.ctx,
    tools: {
      register: (def) => registered.set(def.name, def),
    },
  };
  registerTaskTools(toolCtx, fx.scope, fx.home);

  for (const name of [
    'whale_todo_create',
    'whale_todo_list',
    'whale_todo_inspect',
    'whale_todo_update',
    'whale_todo_start',
    'whale_todo_stop',
    'whale_todo_continue',
  ]) {
    assert.ok(registered.has(name), `expected tool ${name} to be registered`);
  }

  // Paired single-owner IM (`im-owner`) can create/list/inspect readonly-brief, but cannot create workspace-task.
  const imOwnerExec = {
    agent: {
      id: 'resident-whale',
      session: {
        snapshotEvents: () => [
          { seq: 1, type: 'turn/start', data: {} },
          { seq: 2, type: 'user/message', data: { id: 'm-1', source: { kind: 'user', rpcId: 'feishu-owner-private-a1b2c3d4' } } },
        ],
      },
    },
  };
  await assert.rejects(
    registered.get('whale_todo_create').execute({ title: '越权改代码', mode: 'workspace-task' }, imOwnerExec),
    /readonly-brief/,
  );

  // Secret inside $DSH_HOME must be blocked by readonly-brief forbiddenRoot guard.
  const secretFile = path.join(fx.home, 'secret.txt');
  fs.writeFileSync(secretFile, 'top-secret', 'utf8');
  const createdBrief = await registered.get('whale_todo_create').execute({
    title: '整理敏感目录',
    mode: 'readonly-brief',
    files: [secretFile],
  }, imOwnerExec);
  assert.equal(createdBrief.mode, 'readonly-brief');

  await assert.rejects(
    registered.get('whale_todo_start').execute({ id: createdBrief.id }, imOwnerExec),
    /私密资料或应用凭据/,
  );

  // List & inspect work for paired single-owner IM.
  const listed = await registered.get('whale_todo_list').execute({}, imOwnerExec);
  assert.ok(listed.cards.some((card) => card.id === createdBrief.id));
  const inspectedCard = await registered.get('whale_todo_inspect').execute({ id: createdBrief.id }, imOwnerExec);
  assert.equal(inspectedCard.card.id, createdBrief.id);

  // Non-owner / guest tainted session is refused for all task tools.
  const taintedExec = {
    agent: {
      id: 'resident-whale',
      session: {
        snapshotEvents: () => [
          { seq: 1, type: 'turn/start', data: {} },
          { seq: 2, type: 'user/message', data: { source: { kind: 'user', rpcId: 'feishu-guest-group-a1b2c3d4' } } },
        ],
      },
    },
  };
  await assert.rejects(
    registered.get('whale_todo_list').execute({}, taintedExec),
    /非主人 IM/,
  );
});

test('whale_send_to_session precheck uses read-only metadata so declining confirmation never hydrates dormant sessions', async (t) => {
  const { apply: applyWhaleTools } = await import(toolsUrl);
  const registered = new Map();
  let resolveAgentCalls = 0;
  let observeCalls = 0;
  const ctx = {
    get: (name) => {
      if (name === 'sessionQuery') {
        return {
          observeSession: async (id, opts) => {
            observeCalls += 1;
            assert.equal(opts.projectionMode, 'none');
            return {
              header: { id, title: '休眠会话', cwd: 'C:/repo', agentPreset: 'standard' },
              [Symbol.dispose]: () => {},
            };
          },
        };
      }
      return undefined;
    },
    sessionController: {
      resolveAgent: async () => {
        resolveAgentCalls += 1;
        throw new Error('must not hydrate dormant session before confirmation');
      },
    },
    tools: {
      register: (def) => registered.set(def.name, def),
    },
  };
  const home = makeTempDir(t, 'whale-relay-precheck-');
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(() => {
    if (prevHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prevHome;
  });
  applyWhaleTools(ctx);

  const sendTool = registered.get('whale_send_to_session');
  assert.ok(sendTool);
  const result = await sendTool.execute(
    { sessionId: 'dormant-session-1', text: '你好' },
    {
      agent: { id: 'resident-whale', session: { snapshotEvents: () => [] } },
      confirm: async () => false,
    },
  );
  assert.equal(result.ok, false);
  assert.equal(observeCalls, 1, 'must precheck via read-only sessionQuery');
  assert.equal(resolveAgentCalls, 0, 'declining confirmation must NEVER hydrate dormant session');
});
