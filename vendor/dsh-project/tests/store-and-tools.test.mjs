import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectService, apply, registerProjectTools, createWorkerScopeGuard } from './harness-runtime.mjs';

function makeTempHome(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-proj-tools-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeMockCtx(overrides = {}) {
  const tools = new Map();
  const toolOptions = new Map();
  const guards = [];
  const events = new Map();
  const provided = new Map();
  const effects = [];
  const sections = [];
  const contexts = [];
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
      context(def) {
        contexts.push(def);
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
      register(def, opts) {
        tools.set(def.name, def);
        toolOptions.set(def.name, opts || {});
        return () => {
          tools.delete(def.name);
          toolOptions.delete(def.name);
        };
      },
      guard(fn) {
        guards.push(fn);
        return () => {
          const idx = guards.indexOf(fn);
          if (idx >= 0) guards.splice(idx, 1);
        };
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

  return { ctx, tools, toolOptions, guards, provided, effects, sections, contexts, registeredPresets, services };
}

test('apply registers exactly the 8 projects_* tools, coordinator system prompt section, and legacy preset aliases', async (t) => {
  const home = makeTempHome(t);
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(() => {
    if (prevHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prevHome;
  });

  const { ctx, tools, provided, sections, contexts, registeredPresets, effects } = makeMockCtx();
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
  assert.equal(sections[0].interpolate, false);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].name, 'projects:coordinator:state');
  assert.equal(contexts[0].order, 700);
  assert.equal(contexts[0].interpolate, false);
  assert.equal(contexts[0].required, true);

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

  // Pause gate blocks dispatch; lock admission before unpausing so we also verify admission lock cleanly
  await tools.get('projects_update').execute({ project_id: projectId, paused: true });
  await service.approveTask(projectId, t1);
  const pauseBlocked = await tools.get('projects_dispatch').execute({ project_id: projectId, task_id: t1 }, exec);
  assert.match(pauseBlocked, /paused/i);

  // Admission lock blocks both auto-schedule on unpause and explicit dispatch
  admissionAllowed = false;
  await tools.get('projects_update').execute({ project_id: projectId, paused: false, concurrency: 2 });
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

  // 8. Resolving t1 automatically unlocked and dispatched dependent t2 with per-task model/effort overrides!
  assert.equal(activations.length, 2);
  assert.deepEqual(activations[1].agentOptions, {
    provider: 'openai',
    model: 'gpt-5',
    reasoningEffort: 'max',
  });
  const alreadyRunningMsg = await tools.get('projects_dispatch').execute({ project_id: projectId, task_id: t2 }, exec);
  assert.match(alreadyRunningMsg, /already running/i);

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

test('auto-dispatch on approveTask, autonomy=auto, paused=false, and schedule() unlock', async (t) => {
  const home = makeTempHome(t);
  const activations = [];
  let seq = 0;
  let admissionOpen = true;
  const coord = { id: 'coord-auto', session: { id: 'coord-auto' } };
  const { ctx } = makeMockCtx({
    agents: new Map([['coord-auto', coord]]),
    subagents: {
      async startActivation(opts) {
        seq += 1;
        activations.push(opts);
        return { childId: `w-auto-${seq}`, name: `w-${seq}` };
      },
    },
    desktopTaskAdmission: {
      check: () => admissionOpen,
      begin: () => () => {},
    },
  });

  const service = new ProjectService(ctx, { home });
  t.after(() => service.dispose());

  const project = await service.createProject({ name: 'AutoFlow', autonomy: 'manual', concurrency: 2 });
  await service.updateProject(project.id, { coordinatorSessionId: 'coord-auto' });

  // 1. approveTask immediately dispatches queued task
  const { task: t1 } = await service.addTask(project.id, { title: 'Approved immediately' });
  const approved = await service.approveTask(project.id, t1.id);
  assert.equal(approved.dispatched, true);
  assert.equal(approved.task.status, 'running');
  assert.equal(activations.length, 1);

  // Settle t1 so concurrency slots free up
  await service.settleWorker({ id: 'w-auto-1', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'done 1' }] });

  // 2. Switching autonomy to 'auto' immediately dispatches unapproved queued task
  const { task: t2 } = await service.addTask(project.id, { title: 'Queued for auto' });
  const switched = await service.updateProject(project.id, { autonomy: 'auto' });
  assert.deepEqual(switched.dispatchedTaskIds, [t2.id]);
  assert.equal(switched.project.tasks.find((item) => item.id === t2.id).status, 'running');
  assert.equal(activations.length, 2);
  await service.settleWorker({ id: 'w-auto-2', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'done 2' }] });

  // 3. Unpausing immediately dispatches queued task
  await service.updateProject(project.id, { paused: true });
  const { task: t3 } = await service.addTask(project.id, { title: 'Queued while paused' });
  const resumed = await service.updateProject(project.id, { paused: false });
  assert.deepEqual(resumed.dispatchedTaskIds, [t3.id]);
  assert.equal(activations.length, 3);
  await service.settleWorker({ id: 'w-auto-3', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'done 3' }] });

  // 4. schedule() wakes queued tasks when admission unlocks
  admissionOpen = false;
  const { task: t4 } = await service.addTask(project.id, { title: 'Waiting for admission' });
  admissionOpen = true;
  service.schedule();
  const scheduleDeadline = Date.now() + 2000;
  let afterSchedule = await service.readProject(project.id);
  while (afterSchedule.tasks.find((item) => item.id === t4.id).status !== 'running' && Date.now() < scheduleDeadline) {
    await new Promise((r) => setTimeout(r, 25));
    afterSchedule = await service.readProject(project.id);
  }
  assert.equal(afterSchedule.tasks.find((item) => item.id === t4.id).status, 'running');
});

test('startup recovery converts orphaned running tasks to blocked (interrupted_by_restart)', async (t) => {
  const home = makeTempHome(t);
  const { ctx } = makeMockCtx();
  const s1 = new ProjectService(ctx, { home });
  const project = await s1.createProject({ name: 'RestartRecovery' });
  const { task } = await s1.addTask(project.id, { title: 'Orphaned task' });
  const raw = await s1.readProject(project.id);
  const row = raw.tasks.find((item) => item.id === task.id);
  row.status = 'running';
  row.childSessionId = 'worker-orphan';
  row.startedAt = Date.now() - 5000;
  delete row.finishedAt;
  await s1.store.writeProject(raw);
  s1.dispose();

  // New ProjectService instance simulates host restart
  const s2 = new ProjectService(ctx, { home });
  t.after(() => s2.dispose());
  const recovered = await s2.readProject(project.id);
  const recoveredTask = recovered.tasks.find((item) => item.id === task.id);
  assert.equal(recoveredTask.status, 'blocked');
  assert.equal(recoveredTask.stopReason, 'interrupted_by_restart');
  assert.ok(recoveredTask.finishedAt > 0);
  assert.equal(s2.inspect().details.length, 0);
});

test('tool scope isolation via when(context), defineTool validation/presentation, and worker scopeCeiling guard', async (t) => {
  const home = makeTempHome(t);
  const coord = {
    id: 'coord-scope',
    session: {
      id: 'coord-scope',
      snapshotEvents: () => [{
        seq: 1,
        type: 'user/message',
        data: {
          id: 'msg-ho',
          source: { plugin: 'dsh-whale:handoff', handoffId: 'ho-docs-1' },
          content: [{ type: 'text', text: '[Whale Assistant Handoff]\nhandoffId: ho-docs-1' }],
        },
      }],
    },
  };
  const { ctx, tools, toolOptions } = makeMockCtx({
    agents: new Map([['coord-scope', coord]]),
    subagents: {
      async startActivation() { return { childId: 'worker-docs-1', name: 'w-docs' }; },
    },
  });

  const service = new ProjectService(ctx, { home });
  t.after(() => service.dispose());
  registerProjectTools(ctx, service);

  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-proj-scope-repo-'));
  t.after(() => fs.rmSync(repoDir, { recursive: true, force: true }));

  const project = await service.createProject({ name: 'ScopeProj', workspace: repoDir, autonomy: 'auto' });
  await service.updateProject(project.id, { coordinatorSessionId: 'coord-scope' });

  // Simulate recorded handoff receipt with docs ceiling
  service.handoffReceipts.set('ho-docs-1', {
    projectId: project.id,
    coordinatorSessionId: 'coord-scope',
    messageId: 'msg-ho',
    scopeCeiling: 'docs',
    writePaths: ['docs/guide.md'],
  });

  // Coordinator attempts to widen scopeCeiling to 'development' -> clamped back to 'docs' & handoff writePaths!
  const addRes = await tools.get('projects_add_task').execute(
    {
      project_id: project.id,
      title: 'Update guide',
      brief: 'Edit docs/guide.md',
      scopeCeiling: 'development',
      writePaths: ['src/index.js'],
    },
    { agent: coord },
  );
  const taskId = /Added task (t-[0-9a-f]{8})/.exec(addRes)[1];
  const savedProject = await service.readProject(project.id);
  const task = savedProject.tasks.find((item) => item.id === taskId);
  assert.equal(task.scopeCeiling, 'docs');
  assert.deepEqual(task.writePaths, ['docs/guide.md']);

  await service.dispatchTask(project.id, taskId, { agent: coord });

  // Verify `when(context)` tool visibility:
  // - Ordinary non-project session: 0 tools
  const ordinaryCtx = { agent: { id: 'ordinary-1', session: { id: 'ordinary-1' } } };
  const visibleOrdinary = [...tools.keys()].filter((name) => toolOptions.get(name).when(ordinaryCtx));
  assert.deepEqual(visibleOrdinary, []);

  // - Worker session: ONLY projects_get and projects_memory
  const workerCtx = { agent: { id: 'worker-docs-1', session: { id: 'worker-docs-1' } } };
  const visibleWorker = [...tools.keys()].filter((name) => toolOptions.get(name).when(workerCtx)).sort();
  assert.deepEqual(visibleWorker, ['projects_get', 'projects_memory']);

  // - Coordinator session: all 8 tools
  const coordCtx = { agent: coord };
  const visibleCoord = [...tools.keys()].filter((name) => toolOptions.get(name).when(coordCtx)).sort();
  assert.equal(visibleCoord.length, 8);

  // Verify defineTool strict validation & presentCall/presentResult
  await assert.rejects(
    () => tools.get('projects_create').execute({}),
    /invalid arguments/i,
  );
  const callView = tools.get('projects_dispatch').presentCall({ project_id: project.id, task_id: taskId, note: 'go' });
  assert.equal(callView.card, 'generic');
  assert.match(callView.title, new RegExp(taskId));

  // Verify worker scopeCeiling guard enforces docs + writePaths at runtime
  const guard = createWorkerScopeGuard(service);
  const workerAgent = { id: 'worker-docs-1', session: { id: 'worker-docs-1', header: { cwd: repoDir } } };
  // Shell denied under docs
  assert.ok(guard({ name: 'bash', arguments: { command: 'rm -rf .' }, agent: workerAgent }));
  // Non-doc file denied
  assert.ok(guard({ name: 'write', arguments: { file_path: 'src/app.js', content: 'x' }, agent: workerAgent }));
  // Doc file outside writePaths denied
  assert.ok(guard({ name: 'write', arguments: { file_path: 'README.md', content: 'x' }, agent: workerAgent }));
  // Allowed doc file inside writePaths permitted
  assert.equal(guard({ name: 'write', arguments: { file_path: 'docs/guide.md', content: '# OK' }, agent: workerAgent }), undefined);
  // apply_patch with disallowed target denied
  assert.ok(guard({
    name: 'apply_patch',
    arguments: { input: '*** Begin Patch\n*** Update File: src/secret.js\n@@\n-a\n+b\n*** End Patch' },
    agent: workerAgent,
  }));
  // Non-worker session unaffected by guard
  assert.equal(guard({ name: 'bash', arguments: { command: 'echo ok' }, agent: { id: 'ordinary-1' } }), undefined);
});

test('early subagent/end race, stopTask single-SSE & interrupt, embedded worker follow-up settle, and project default model change', async (t) => {
  const home = makeTempHome(t);
  let seq = 0;
  const interrupted = [];
  const activations = [];
  const sseEvents = [];

  const coord = { id: 'coord-race', session: { id: 'coord-race' } };
  let service;
  const { ctx } = makeMockCtx({
    agents: new Map([['coord-race', coord]]),
    subagents: {
      async startActivation(opts) {
        seq += 1;
        const childId = `w-race-${seq}`;
        activations.push({ childId, opts });
        if (seq === 1) {
          // Simulate ultra-fast synchronous settlement BEFORE startActivation even finishes persisting!
          await service.settleWorker({
            id: childId,
            stopReason: 'error',
            error: 'instant crash',
            lastAssistantMessage: [{ type: 'text', text: 'Crash before persist' }],
          });
        }
        return { childId, name: `w-${seq}` };
      },
      async interrupt(childId, opts) {
        interrupted.push({ childId, opts });
      },
      async sendMessage() { return 'm-1'; },
    },
  });

  service = new ProjectService(ctx, { home });
  t.after(() => service.dispose());
  service.subscribeEvents((ev) => sseEvents.push(ev));

  const project = await service.createProject({
    name: 'RaceProj',
    goal: 'Handle {{handlebars}} safely without interpolation crash.',
    autonomy: 'auto',
    model: 'deepseek/deepseek-chat',
  });
  await service.updateProject(project.id, { coordinatorSessionId: 'coord-race' });

  // Coordinator static section stays stable (Prompt Cache friendly, includes {{...}} safely);
  // volatile board snapshot & MEMORY.md index live in dynamic runtime context!
  await service.memory.writeMemoryFile(project.id, { name: 'notes', description: 'Key finding', text: 'Important' });
  const sectionTextBefore = service.runner.coordinatorSectionFor({ agent: coord });
  assert.match(sectionTextBefore, /Handle \{\{handlebars\}\} safely/);
  assert.doesNotMatch(sectionTextBefore, /notes/);
  const dynamicContextText = service.runner.coordinatorDynamicContextFor({ agent: coord });
  assert.match(dynamicContextText, /notes/);

  // 1. Ultra-fast early settlement buffered & applied cleanly right after spawnFreshWorker persists
  const { task: t1 } = await service.addTask(project.id, { title: 'Fast fail' });
  await service.dispatchTask(project.id, t1.id, { agent: coord });
  const afterFastFail = (await service.readProject(project.id)).tasks.find((item) => item.id === t1.id);
  assert.equal(afterFastFail.status, 'failed');
  assert.equal(afterFastFail.stopReason, 'error');
  assert.match(afterFastFail.output, /Crash before persist/);
  assert.equal(service.inspect().details.length, 0);

  // 2. Embedded worker manual follow-up (after finishedAt already set) refreshes output and transitions failed -> review
  await service.settleWorker({
    id: 'w-race-1',
    stopReason: 'completed',
    lastAssistantMessage: [{ type: 'text', text: 'Fixed after manual follow-up in right panel' }],
  });
  const afterFollowUp = (await service.readProject(project.id)).tasks.find((item) => item.id === t1.id);
  assert.equal(afterFollowUp.status, 'review');
  assert.equal(afterFollowUp.output, 'Fixed after manual follow-up in right panel');

  // 3. Changing project default model forces fresh worker session on next dispatch (not continuation!)
  await service.updateProject(project.id, { model: 'deepseek/deepseek-reasoner' });
  const freshMsg = await service.dispatchTask(project.id, t1.id, { agent: coord });
  assert.match(freshMsg, /fresh session/);
  assert.equal(activations.length, 2);
  assert.equal(activations[1].opts.agentOptions.model, 'deepseek-reasoner');

  // 4. stopTask suppresses duplicate settleWorker SSE and uses subagents.interrupt when activeRun is absent
  sseEvents.length = 0;
  const stopResult = await service.stopTask(project.id, t1.id);
  assert.equal(stopResult.stopped, true);
  // Late subagent/end right after stopTask must not overwrite stopReason or emit extra task.settled
  await service.settleWorker({ id: 'w-race-2', stopReason: 'aborted' });
  const afterStop = (await service.readProject(project.id)).tasks.find((item) => item.id === t1.id);
  assert.equal(afterStop.stopReason, 'stopped_by_user');
  assert.equal(sseEvents.filter((ev) => ev.type === 'task.settled').length, 0);

  // Simulate post-restart stopTask where activeRun map is empty but task is running on disk
  const diskProj = await service.readProject(project.id);
  const diskRow = diskProj.tasks.find((item) => item.id === t1.id);
  diskRow.status = 'running';
  delete diskRow.finishedAt;
  await service.store.writeProject(diskProj);
  await service.stopTask(project.id, t1.id);
  assert.equal(interrupted.length, 1);
  assert.equal(interrupted[0].childId, 'w-race-2');
});

test('default autonomy is auto, slot-freed settle auto-relays queued tasks, human acceptance boundary enforced, and 1.5s batched coordinator report-back is idempotent', async (t) => {
  const home = makeTempHome(t);
  let seq = 0;
  const activations = [];
  const coordinatorPrompts = [];
  const sseEvents = [];

  const coord = { id: 'coord-relay', session: { id: 'coord-relay' } };
  const { ctx, tools } = makeMockCtx({
    agents: new Map([['coord-relay', coord]]),
    sessionController: {
      async prompt(req) {
        coordinatorPrompts.push(req);
        return { ok: true };
      },
    },
    subagents: {
      async startActivation(opts) {
        seq += 1;
        activations.push({ childId: `w-relay-${seq}`, opts });
        return { childId: `w-relay-${seq}`, name: `w-${seq}` };
      },
    },
  });

  // Use short batch window (180ms) for fast deterministic testing (production default is 1500ms)
  const service = new ProjectService(ctx, { home, notifyBatchMs: 180 });
  t.after(() => service.dispose());
  registerProjectTools(ctx, service);
  service.subscribeEvents((ev) => sseEvents.push(ev));

  // 1. Default autonomy is 'auto' when omitted
  const project = await service.createProject({ name: 'RelayProj', concurrency: 1 });
  assert.equal(project.autonomy, 'auto');
  await service.updateProject(project.id, { coordinatorSessionId: 'coord-relay' });

  // 2. Human acceptance boundary: projects_update_task refuses status "resolved"
  const { task: t1 } = await service.addTask(project.id, { title: 'First parallel slice' });
  const { task: t2 } = await service.addTask(project.id, { title: 'Second queued slice' });
  await assert.rejects(
    () => tools.get('projects_update_task').execute({ project_id: project.id, task_id: t1.id, status: 'resolved' }),
    /human user.*resolved/i,
  );

  // Dispatch t1 (fills concurrency=1); t2 stays queued
  await service.dispatchTask(project.id, t1.id, { agent: coord });
  assert.equal(activations.length, 1);

  // Verify Prompt Cache stability: adding/dispatching tasks does NOT change coordinatorSectionFor
  const staticBefore = service.runner.coordinatorSectionFor({ agent: coord });

  // Settle t1 -> frees concurrency slot -> auto-dispatches t2 immediately!
  await service.settleWorker({
    id: 'w-relay-1',
    stopReason: 'completed',
    lastAssistantMessage: [{ type: 'text', text: 'First slice finished cleanly.' }],
  });
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(activations.length, 2, 'settling t1 should auto-relay queued t2');

  // Settle t2 within the same batching window -> both t1 and t2 coalesce into ONE report-back!
  await service.settleWorker({
    id: 'w-relay-2',
    stopReason: 'error',
    lastAssistantMessage: [{ type: 'text', text: 'Second slice hit a lint error.' }],
  });
  await new Promise((r) => setTimeout(r, 260));

  assert.equal(coordinatorPrompts.length, 1, 'concurrent settlements should coalesce into one batched receipt');
  const receiptText = coordinatorPrompts[0].content[0].text;
  assert.match(receiptText, /First parallel slice/);
  assert.match(receiptText, /Second queued slice/);
  assert.match(receiptText, /全部活跃任务已收尾/);
  const notifiedEv = sseEvents.find((ev) => ev.type === 'coordinator.notified');
  assert.ok(notifiedEv);
  assert.equal(notifiedEv.allSettled, true);
  assert.deepEqual(notifiedEv.taskIds.sort(), [t1.id, t2.id].sort());

  // Prompt Cache prefix remained byte-identical across all task transitions!
  assert.equal(service.runner.coordinatorSectionFor({ agent: coord }), staticBefore);
});
