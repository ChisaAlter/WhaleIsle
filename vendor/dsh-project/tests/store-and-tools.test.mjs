import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectService, apply } from './harness-runtime.mjs';
import { registerProjectTools } from '../lib/tools.js';

function makeTempHome(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-proj-tools-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeMockCtx(overrides = {}) {
  const tools = new Map();
  const events = new Map();
  const provided = new Map();
  const effects = [];
  const sections = [];
  const registeredPresets = [];
  const services = {
    subagents: overrides.subagents,
    agents: overrides.agents,
    sessionController: overrides.sessionController,
    workspaceRegistry: overrides.workspaceRegistry,
    desktopTaskAdmission: overrides.desktopTaskAdmission,
    systemPrompt: overrides.systemPrompt ?? {
      section(def) {
        sections.push(def);
        return () => {};
      },
    },
    agentPresets: overrides.agentPresets ?? {
      async list() { return registeredPresets.map((p) => ({ id: p.id, hidden: p.hidden })); },
      async register(def) {
        registeredPresets.push(def);
        return () => {};
      },
    },
    llm: overrides.llm,
    webServer: overrides.webServer,
    connection: overrides.connection,
  };

  const ctx = {
    tools: {
      register(def) {
        tools.set(def.name, def);
        return () => tools.delete(def.name);
      },
    },
    get(key) {
      return services[key];
    },
    provide(key, value) {
      provided.set(key, value);
    },
    effect(fn) {
      const cleanup = typeof fn === 'function' ? fn() : null;
      if (typeof cleanup === 'function') effects.push(cleanup);
      return () => {};
    },
    inject(deps, fn) {
      const sub = { ...ctx };
      for (const dep of deps) {
        if (!services[dep]) return;
        sub[dep] = services[dep];
      }
      void fn(sub);
    },
    on(event, handler) {
      if (!events.has(event)) events.set(event, []);
      events.get(event).push(handler);
      return () => {};
    },
    async emit(event, payload) {
      for (const fn of events.get(event) || []) await fn(payload);
    },
  };

  return { ctx, tools, provided, effects, sections, registeredPresets, services };
}

test('apply registers exactly the 8 projects_* tools, coordinator system prompt section, and legacy preset aliases', async (t) => {
  const home = makeTempHome(t);
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(() => {
    if (prevHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prevHome;
  });

  const { ctx, tools, provided, sections, registeredPresets, effects } = makeMockCtx();
  apply(ctx);
  await new Promise((r) => setTimeout(r, 20));
  t.after(() => effects.forEach((fn) => fn()));

  assert.deepEqual(
    [...tools.keys()].sort(),
    [
      'projects_add_task',
      'projects_create',
      'projects_dispatch',
      'projects_get',
      'projects_list',
      'projects_memory',
      'projects_update',
      'projects_update_task',
    ],
  );
  assert.ok(provided.get('projects') instanceof ProjectService);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].name, 'projects:coordinator');
  assert.equal(sections[0].order, 700);

  const aliasIds = registeredPresets.map((p) => p.id).sort();
  assert.deepEqual(aliasIds, [
    'project-coordinator',
    'project-worker',
    'project-worker-development',
    'project-worker-docs',
    'project-worker-readonly',
    'project-worker-research',
  ]);
  assert.ok(registeredPresets.every((p) => p.hidden === true));
});

test('CRUD, coordinator system prompt isolation, DAG dependencies, approval/pause/concurrency gates, routing, continuation, stop, retry, and settle', async (t) => {
  const home = makeTempHome(t);
  const activations = [];
  const sentMessages = [];
  let childSeq = 0;

  let admissionAllowed = true;
  const permitReleases = [];

  const subagents = {
    async startActivation(opts) {
      childSeq += 1;
      activations.push(opts);
      return { childId: `worker-${childSeq}`, name: `w-${childSeq}` };
    },
    async sendMessage(parent, childId, blocks, opts) {
      if (childId === 'worker-broken') throw new Error('session archived');
      sentMessages.push({ parent, childId, blocks, opts });
      return `msg-${sentMessages.length}`;
    },
  };

  const liveAgents = new Map();
  const { ctx, tools } = makeMockCtx({
    subagents,
    agents: liveAgents,
    desktopTaskAdmission: {
      check: () => admissionAllowed,
      begin: (label) => () => permitReleases.push(label),
    },
  });

  const service = new ProjectService(ctx, { home });
  t.after(() => service.dispose());
  registerProjectTools(ctx, service);

  const coordAgent = { id: 'coord-1', session: { id: 'coord-1' } };
  liveAgents.set('coord-1', coordAgent);
  const exec = { agent: coordAgent };

  // 1. Create and list project
  const createdText = await tools.get('projects_create').execute({
    name: 'Alpha',
    goal: '构建新版项目看板',
    autonomy: 'manual',
    concurrency: 99, // clamped to 8
    model: 'deepseek/deepseek-reasoner',
    reasoningEffort: 'high',
  });
  const match = /Created project (p-[0-9a-f]{8})/.exec(createdText);
  assert.ok(match);
  const projectId = match[1];

  const listed = await tools.get('projects_list').execute({});
  assert.match(listed, new RegExp(projectId));
  assert.match(listed, /concurrency=8/);

  // Bind coordinator session & verify dynamic systemPrompt section
  await service.updateProject(projectId, { coordinatorSessionId: 'coord-1' });
  const coordSection = service.runner.coordinatorSectionFor({ agent: { session: { id: 'coord-1' } } });
  assert.match(coordSection, /Alpha/);
  assert.match(coordSection, /Autonomy is manual/);
  assert.equal(service.runner.coordinatorSectionFor({ agent: { session: { id: 'other-session' } } }), '');

  // Verify load-time priming on a fresh ProjectService instance
  const freshService = new ProjectService(ctx, { home });
  assert.match(freshService.runner.coordinatorSectionFor({ agent: { session: { id: 'coord-1' } } }), /Alpha/);
  freshService.dispose();

  // 2. Add tasks with dependency chain: t1 -> t2, plus cycle check
  const add1 = await tools.get('projects_add_task').execute({
    project_id: projectId,
    title: 'Step 1',
    brief: '完成第一步',
  });
  const t1 = /Added task (t-[0-9a-f]{8})/.exec(add1)[1];

  const add2 = await tools.get('projects_add_task').execute({
    project_id: projectId,
    title: 'Step 2',
    brief: '完成第二步',
    depends_on: [t1],
    approved: true,
    model: 'openai/gpt-5',
    reasoningEffort: 'max',
  });
  const t2 = /Added task (t-[0-9a-f]{8})/.exec(add2)[1];

  // Manual gate blocks unapproved t1
  const manualBlocked = await tools.get('projects_dispatch').execute({ project_id: projectId, task_id: t1 }, exec);
  assert.match(manualBlocked, /needs human approval/i);

  // Dependency gate blocks t2 until t1 is resolved
  const depBlocked = await tools.get('projects_dispatch').execute({ project_id: projectId, task_id: t2 }, exec);
  assert.match(depBlocked, /unresolved dependency/i);

  // Unknown dependency rejected
  const addBadDep = await tools.get('projects_add_task').execute({
    project_id: projectId,
    title: 'Bad dep',
    depends_on: ['t-00000000'],
    approved: true,
  });
  const tBadDep = /Added task (t-[0-9a-f]{8})/.exec(addBadDep)[1];
  await assert.rejects(
    () => tools.get('projects_dispatch').execute({ project_id: projectId, task_id: tBadDep }, exec),
    /unknown task/i,
  );

  // Pause gate blocks dispatch
  await tools.get('projects_update').execute({ project_id: projectId, paused: true });
  await service.approveTask(projectId, t1);
  const pauseBlocked = await tools.get('projects_dispatch').execute({ project_id: projectId, task_id: t1 }, exec);
  assert.match(pauseBlocked, /paused/i);
  await tools.get('projects_update').execute({ project_id: projectId, paused: false, concurrency: 2 });

  // Admission lock blocks dispatch
  admissionAllowed = false;
  await assert.rejects(
    () => tools.get('projects_dispatch').execute({ project_id: projectId, task_id: t1 }, exec),
    /admission/i,
  );
  admissionAllowed = true;

  // 3. Dispatch t1 -> inherits project model/effort, language rule detects Chinese
  const disp1 = await tools.get('projects_dispatch').execute({ project_id: projectId, task_id: t1 }, exec);
  assert.match(disp1, /Dispatched task/);
  assert.equal(activations.length, 1);
  assert.deepEqual(activations[0].agentOptions, {
    provider: 'deepseek',
    model: 'deepseek-reasoner',
    reasoningEffort: 'high',
  });
  assert.match(activations[0].prompt[0].text, /Chinese \(中文\)/);

  // inspect() reports the active task for dsh-task-control
  const inspection = service.inspect();
  assert.equal(inspection.details.length, 1);
  assert.deepEqual(inspection.details[0], { projectId, id: t1, kind: 'task' });

  // 4. Single-task stop -> aborts controller, releases permit, transitions to blocked
  const stopped = await service.stopTask(projectId, t1);
  assert.equal(stopped.stopped, true);
  assert.equal(stopped.task.status, 'blocked');
  assert.equal(stopped.task.stopReason, 'stopped_by_user');
  assert.equal(activations[0].signal.aborted, true);
  assert.equal(permitReleases.length, 1);
  assert.equal(service.inspect().details.length, 0);

  // 5. Single-task retry -> resets to queued and auto-dispatches via continuation (live coordinator!)
  const retried = await service.retryTask(projectId, t1);
  assert.equal(retried.retried, true);
  assert.equal(retried.dispatched, true);
  assert.equal(retried.task.status, 'running');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].childId, 'worker-1');

  // 6. Settle t1 -> output preserves last 4000 chars, moves to review
  const longText = `${'A'.repeat(2000)}${'Z'.repeat(3000)}`;
  await service.settleWorker({
    id: 'worker-1',
    stopReason: 'completed',
    lastAssistantMessage: [{ type: 'text', text: longText }],
  });
  let proj = await service.readProject(projectId);
  let row1 = proj.tasks.find((x) => x.id === t1);
  assert.equal(row1.status, 'review');
  assert.equal(row1.output.length, 4000);
  assert.ok(row1.output.endsWith('Z'.repeat(3000)));

  // 7. append_brief + dispatch continues worker with only the appended note
  await tools.get('projects_update_task').execute({
    project_id: projectId,
    task_id: t1,
    append_brief: '请补充边界测试',
  });
  const contRes = await tools.get('projects_dispatch').execute(
    { project_id: projectId, task_id: t1, note: '顺便检查性能' },
    exec,
  );
  assert.match(contRes, /Continued task/);
  assert.equal(sentMessages.length, 2);
  assert.match(sentMessages[1].blocks[0].text, /请补充边界测试/);
  assert.match(sentMessages[1].blocks[0].text, /顺便检查性能/);

  // Human resolves t1 while running -> settle preserves resolved status AND records output!
  await service.resolveTask(projectId, t1, { status: 'resolved' });
  await service.settleWorker({
    id: 'worker-1',
    stopReason: 'completed',
    lastAssistantMessage: [{ type: 'text', text: 'Final verified output' }],
  });
  proj = await service.readProject(projectId);
  row1 = proj.tasks.find((x) => x.id === t1);
  assert.equal(row1.status, 'resolved');
  assert.equal(row1.output, 'Final verified output');

  // projects_get hides resolved tasks by default, shows with include_resolved: true
  const getDefault = await tools.get('projects_get').execute({ project_id: projectId });
  assert.match(getDefault, /1 resolved task\(s\) hidden/);
  const getAll = await tools.get('projects_get').execute({ project_id: projectId, include_resolved: true });
  assert.match(getAll, /Final verified output/);

  // 8. Now t2 dependency is satisfied -> dispatch t2 uses per-task model/effort overrides!
  const disp2 = await tools.get('projects_dispatch').execute({ project_id: projectId, task_id: t2 }, exec);
  assert.match(disp2, /Dispatched task/);
  assert.equal(activations.length, 2);
  assert.deepEqual(activations[1].agentOptions, {
    provider: 'openai',
    model: 'gpt-5',
    reasoningEffort: 'max',
  });

  // Settle t2, then change task model -> next dispatch starts a fresh session instead of continuing
  await service.settleWorker({ id: 'worker-2', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'ok' }] });
  await tools.get('projects_update_task').execute({
    project_id: projectId,
    task_id: t2,
    model: 'anthropic/claude-opus',
  });
  const disp2Fresh = await tools.get('projects_dispatch').execute({ project_id: projectId, task_id: t2 }, exec);
  assert.match(disp2Fresh, /fresh session/);
  assert.equal(activations.length, 3);
  assert.equal(activations[2].agentOptions.model, 'claude-opus');
});

test('per-project serial write queue prevents lost updates under 15 concurrent mutations', async (t) => {
  const home = makeTempHome(t);
  const { ctx } = makeMockCtx();
  const service = new ProjectService(ctx, { home });
  t.after(() => service.dispose());

  const project = await service.createProject({ name: 'ConcurrentBoard' });

  // Add 15 tasks in parallel
  const added = await Promise.all(
    Array.from({ length: 15 }, (_, idx) =>
      service.addTask(project.id, { title: `Task ${idx + 1}`, brief: `Brief ${idx + 1}` }),
    ),
  );
  assert.equal(added.length, 15);

  // Concurrently mutate all 15 tasks
  await Promise.all(
    added.map(({ task }, idx) =>
      service.updateTask(project.id, task.id, { output: `Result ${idx + 1}`, status: 'review' }),
    ),
  );

  const finalProject = await service.readProject(project.id);
  assert.equal(finalProject.tasks.length, 15);
  for (let i = 0; i < 15; i += 1) {
    const found = finalProject.tasks.find((item) => item.title === `Task ${i + 1}`);
    assert.ok(found, `Task ${i + 1} survived concurrent writes`);
    assert.equal(found.status, 'review');
    assert.equal(found.output, `Result ${i + 1}`);
  }
});

test('dependency cycle detection rejects multi-node cycles', async (t) => {
  const home = makeTempHome(t);
  const { ctx } = makeMockCtx({
    subagents: {
      async startActivation() { return { childId: 'c1', name: 'w1' }; },
    },
  });
  const service = new ProjectService(ctx, { home });
  t.after(() => service.dispose());

  const project = await service.createProject({ name: 'CycleTest', autonomy: 'auto' });
  const { task: a } = await service.addTask(project.id, { title: 'A' });
  const { task: b } = await service.addTask(project.id, { title: 'B', dependsOn: [a.id] });
  // Wire A -> B directly on disk to form a cycle A -> B -> A
  const raw = await service.readProject(project.id);
  raw.tasks.find((item) => item.id === a.id).dependsOn = [b.id];
  await service.store.writeProject(raw);

  await assert.rejects(
    () => service.dispatchTask(project.id, a.id, { agent: { id: 'coord' } }),
    /dependency cycle/i,
  );
});
