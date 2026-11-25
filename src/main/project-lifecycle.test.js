'use strict';

const nodeTest = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { gateTests, harnessWorkspace } = require('../../scripts/lib/test-prerequisites.cjs');

// The fixture boots the real ProjectService resolved through the built Harness.
const test = gateTests(nodeTest, harnessWorkspace());

async function createServiceFixture(t) {
  const { ProjectService } = await import('../../vendor/dsh-project/tests/harness-runtime.mjs');
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-project-lifecycle-'));
  const home = path.join(tmpRoot, 'dsh-home');
  const workspace = path.join(tmpRoot, 'repo');
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(workspace, { recursive: true });
  t.after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const events = [];
  const emittedPrompts = [];
  const activations = [];
  let admissionOpen = true;
  let permitCount = 0;

  const coordinator = {
    id: 'coord-session-1',
    session: {
      id: 'coord-session-1',
      snapshotEvents: () => events.slice(),
    },
    async followup(message) {
      emittedPrompts.push(message);
      events.push({
        type: 'user/message',
        data: message,
      });
      return message.id || `msg-${emittedPrompts.length}`;
    },
  };

  const agents = new Map([[coordinator.id, coordinator]]);
  const ctx = {
    agents,
    logger: { warn() {}, info() {}, debug() {} },
    sessionController: {
      async resolveAgent(id) {
        const agent = agents.get(id);
        if (!agent) throw new Error(`missing agent ${id}`);
        return { agent };
      },
    },
    subagents: {
      async startActivation(spec) {
        const childId = `worker-${activations.length + 1}`;
        const record = { spec, childId, disposed: false };
        activations.push(record);
        return {
          childId,
          name: `agent-${activations.length}`,
          messageId: `m-${activations.length}`,
          result: new Promise(() => {}),
          async dispose() { record.disposed = true; },
        };
      },
      async sendMessage() {
        throw new Error('continuation not active in mock');
      },
    },
    get(name) {
      if (name === 'desktopTaskAdmission') {
        return {
          check: () => admissionOpen,
          begin: () => {
            if (!admissionOpen) throw new Error('ADMISSION_LOCKED');
            permitCount += 1;
            return {
              done: () => { permitCount = Math.max(0, permitCount - 1); },
              assertCurrent: () => {},
            };
          },
        };
      }
      return undefined;
    },
  };

  const service = new ProjectService(ctx, { home });
  t.after(() => { service.dispose(); });

  return {
    service,
    ctx,
    home,
    workspace,
    coordinator,
    activations,
    emittedPrompts,
    setAdmissionOpen(value) { admissionOpen = value; },
    getPermitCount() { return permitCount; },
  };
}

test('ProjectService enforces DAG dependencies, manual approval, admission lock, stop/retry, and task-control inspection', async (t) => {
  const f = await createServiceFixture(t);
  const project = await f.service.createProject({
    name: 'Whale Board',
    goal: 'Build v2 project workspace',
    workspace: f.workspace,
    autonomy: 'manual',
    concurrency: 2,
  });
  await f.service.updateProject(project.id, { coordinatorSessionId: f.coordinator.id });

  const { task: taskA } = await f.service.addTask(project.id, { title: 'Task A', brief: 'Implement core store' });
  const { task: taskB } = await f.service.addTask(project.id, {
    title: 'Task B',
    brief: 'Verify integration',
    dependsOn: [taskA.id],
  });
  const { task: taskBad } = await f.service.addTask(project.id, {
    title: 'Task Bad',
    brief: 'Depends on missing task',
    dependsOn: ['t-missing'],
  });

  // Unknown dependency rejects on dispatch.
  await assert.rejects(
    f.service.dispatchTask(project.id, taskBad.id, { agent: f.coordinator }),
    /unknown task|missing/i,
  );

  // Manual mode refuses dispatch until approved.
  const unapprovedMsg = await f.service.dispatchTask(project.id, taskA.id, { agent: f.coordinator });
  assert.match(unapprovedMsg, /needs human approval/i);
  assert.equal(f.activations.length, 0);

  // While admission is locked, approveTask records approval without dispatching,
  // and explicit dispatch rejects cleanly without consuming a permit.
  f.setAdmissionOpen(false);
  const approvedLocked = await f.service.approveTask(project.id, taskA.id);
  assert.equal(approvedLocked.task.approved, true);
  assert.equal(approvedLocked.dispatched, false);
  await assert.rejects(
    f.service.dispatchTask(project.id, taskA.id, { agent: f.coordinator }),
    /admission.*locked/i,
  );
  assert.equal(f.getPermitCount(), 0);
  f.setAdmissionOpen(true);

  // Dispatch launches worker and surfaces active work to dsh-task-control inspect().
  const dispatchMsg = await f.service.dispatchTask(project.id, taskA.id, { agent: f.coordinator });
  assert.match(dispatchMsg, /^Dispatched task\b/);
  assert.equal(f.activations.length, 1);
  assert.equal(f.getPermitCount(), 1);

  const inspection = f.service.inspect();
  assert.equal(inspection.details.length, 1);
  assert.equal(inspection.details[0].projectId, project.id);
  assert.equal(inspection.details[0].id, taskA.id);
  assert.equal(inspection.details[0].kind, 'task');

  // Stopping a running task marks it blocked, clears active work, and releases permit.
  const stopped = await f.service.stopTask(project.id, taskA.id);
  assert.equal(stopped.stopped, true);
  assert.equal(stopped.task.status, 'blocked');
  assert.equal(stopped.task.stopReason, 'stopped_by_user');
  assert.equal(f.service.inspect().details.length, 0);
  assert.equal(f.getPermitCount(), 0);

  // Retrying resets the stopped task and re-dispatches when coordinator is live.
  const retried = await f.service.retryTask(project.id, taskA.id);
  assert.equal(retried.retried, true);
  assert.equal(retried.dispatched, true);
  assert.equal(retried.task.status, 'running');
  assert.equal(f.activations.length, 2);

  // Settlement event writes back output, releases permit, and moves task to review.
  await f.service.settleWorker({
    id: f.activations[1].childId,
    stopReason: 'completed',
    lastAssistantMessage: [{ type: 'text', text: 'All tests passed.' }],
  });
  const afterSettle = await f.service.readProject(project.id);
  const settledA = afterSettle.tasks.find((item) => item.id === taskA.id);
  assert.equal(settledA.status, 'review');
  assert.match(settledA.output, /All tests passed/);
  assert.equal(f.getPermitCount(), 0);

  // Task B remains blocked on dependency until Task A is resolved.
  await f.service.approveTask(project.id, taskB.id);
  const waitingMsg = await f.service.dispatchTask(project.id, taskB.id, { agent: f.coordinator });
  assert.match(waitingMsg, /unresolved dependency/i);

  // Resolving Task A automatically unlocks and dispatches dependent approved Task B.
  const resolvedA = await f.service.resolveTask(project.id, taskA.id, { status: 'resolved' });
  assert.deepEqual(resolvedA.dispatchedTaskIds, [taskB.id]);
  const alreadyRunningB = await f.service.dispatchTask(project.id, taskB.id, { agent: f.coordinator });
  assert.match(alreadyRunningB, /already running/i);
  assert.doesNotThrow(() => f.service.schedule());
});

test('dsh-whale cross-project bridge tools operate end-to-end against v2 ProjectService', async (t) => {
  const f = await createServiceFixture(t);
  const project = await f.service.createProject({
    name: 'Bridge Target',
    goal: 'Maintain backend API',
    workspace: f.workspace,
  });
  await f.service.updateProject(project.id, { coordinatorSessionId: f.coordinator.id });
  await f.service.addTask(project.id, { title: 'Audit endpoints', brief: 'Check auth guards' });

  // Register real whale bridge tools against a context exposing the v2 ProjectService.
  const whaleBridgeUrl = pathToFileURL(path.join(__dirname, '../../vendor/dsh-whale/lib/project-bridge-tools.js')).href;
  const { registerProjectBridgeTools } = await import(whaleBridgeUrl);
  const registeredTools = new Map();
  const whaleCtx = {
    projects: f.service,
    get(key) { return key === 'projects' ? f.service : undefined; },
    tools: {
      register(tool) { registeredTools.set(tool.name, tool); return () => registeredTools.delete(tool.name); },
    },
  };
  registerProjectBridgeTools(whaleCtx, { getSelfId: () => 'whale-self' });

  assert.ok(registeredTools.has('whale_list_projects'));
  assert.ok(registeredTools.has('whale_inspect_project'));
  assert.ok(registeredTools.has('whale_handoff_to_project'));

  const exec = {
    agent: {
      id: 'whale-self',
      session: {
        header: {},
        snapshotEvents: () => [
          { type: 'turn/start', seq: 1, data: { turn: 1 } },
          { type: 'user/message', seq: 2, data: { id: 'u1', source: { kind: 'user', rpcId: 'web-1' }, content: [{ type: 'text', text: 'check' }] } },
        ],
      },
    },
    signal: new AbortController().signal,
  };
  const listed = await registeredTools.get('whale_list_projects').execute({}, exec);
  assert.equal(listed.ok, true);
  assert.equal(listed.available, true);
  assert.equal(listed.projects.length, 1);
  assert.equal(listed.projects[0].projectId, project.id);
  assert.equal(listed.projects[0].title, 'Bridge Target');

  const inspected = await registeredTools.get('whale_inspect_project').execute({ cwd: f.workspace }, exec);
  assert.equal(inspected.ok, true);
  assert.equal(inspected.found, true);
  assert.equal(inspected.project.coordinatorSessionId, f.coordinator.id);
  assert.equal(inspected.project.tasks.length, 1);

  // Authorized handoff delivers to coordinator and deduplicates by handoffId.
  const first = await f.service.acceptAuthorizedHandoff({
    projectId: project.id,
    cwd: f.workspace,
    title: 'Fix pagination',
    goal: 'Fix cursor offset bug in API',
    scopeCeiling: 'development',
    confirmedByDesktop: true,
    handoffId: 'handoff-1',
    sourceSessionId: 'whale-self',
  });
  assert.equal(first.accepted, true);
  assert.equal(first.deduplicated, false);
  assert.equal(first.coordinatorSessionId, f.coordinator.id);
  assert.equal(f.emittedPrompts.length, 1);

  const duplicate = await f.service.acceptAuthorizedHandoff({
    projectId: project.id,
    cwd: f.workspace,
    title: 'Fix pagination',
    goal: 'Fix cursor offset bug in API',
    scopeCeiling: 'development',
    confirmedByDesktop: true,
    handoffId: 'handoff-1',
    sourceSessionId: 'whale-self',
  });
  assert.equal(duplicate.accepted, true);
  assert.equal(duplicate.deduplicated, true);
  assert.equal(f.emittedPrompts.length, 1);
});
