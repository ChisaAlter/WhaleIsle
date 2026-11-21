import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gateTests, harnessWorkspace } from '../../../scripts/lib/test-prerequisites.cjs';
import { comparablePath, safeReadStoreFileSync, samePath } from '../lib/files.js';

const HARNESS = harnessWorkspace();
const test = gateTests(nodeTest, HARNESS);
const { ProjectService } = HARNESS.ok ? await import('./harness-runtime.mjs') : {};
const { classifyExecutionError, detectHotspotConflicts, probeReportEvidence } = HARNESS.ok ? await import('../lib/evidence.js') : {};
const { handleProjectReview } = HARNESS.ok ? await import('../lib/review.js') : {};
const { clearMatchedAsks, guardToolExecution, handlePreStep, researchHosts } = HARNESS.ok ? await import('../lib/runtime-guard.js') : {};
const { CatalogStore } = HARNESS.ok ? await import('../lib/catalog-store.js') : {};
const { ALL_WORKER_PRESETS, presetForScope, registerProjectPresets } = HARNESS.ok ? await import('../lib/presets.js') : {};
const { ProjectApprovals } = HARNESS.ok ? await import('../lib/approvals.js') : {};
const { recordFailureAndEscalate, releaseHistoricalNativeTasks, sweepOrphans } = HARNESS.ok ? await import('../lib/workstream-ops.js') : {};
const { revertRequestChanges } = HARNESS.ok ? await import('../lib/changes.js') : {};
const { validateDependenciesFor } = HARNESS.ok ? await import('../lib/launch.js') : {};
const { projectDomain } = HARNESS.ok ? await import('../lib/domain.js') : {};

async function makeTempDir(t, prefix) {
  const dir = await fs.mkdtemp(join(tmpdir(), prefix));
  t.after(async () => {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir())));
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

function makeServiceFixture({ admissionOpen = true, desktop = async () => ({ ok: true }) } = {}) {
  const project = {
    id: 'p1', title: 'Project One', coordinatorSessionId: 'lead-1', storageRoot: '',
    canonicalWorkingDirectory: 'C:/workspace/proj', lifecycle: 'ready', paused: false,
    diagnostics: [], createdAt: 1, updatedAt: 1,
  };
  const state = { version: 2, revision: 1, projects: [project], workstreams: [], workers: [], requests: [], deliveries: [] };
  const tasks = [];
  const deletedTasks = [];
  const leadEvents = [
    { seq: 0, type: 'turn/start', data: { turn: 1 } },
    { seq: 1, type: 'user/message', data: { id: 'human-1', source: { kind: 'user' }, content: [{ type: 'text', text: 'Build feature' }] } },
    { seq: 2, type: 'tool/call', data: { turn: 1, callId: 'auth-call-1', name: 'project_request', arguments: '{}' } },
    { seq: 3, type: 'tool/result', data: { turn: 1, step: 0, message: { id: 'res-1', role: 'tool', toolCallId: 'auth-call-1', isError: false, content: [{ type: 'text', text: '{}' }] } } },
    { seq: 4, type: 'tool/call', data: { turn: 1, callId: 'deliver-call-1', name: 'project_deliver', arguments: '{}' } },
  ];
  const lead = { id: 'lead-1', status: 'idle', session: { id: 'lead-1', snapshotEvents: () => leadEvents }, ctx: {} };
  let resolveAgentCalls = 0;
  let openFlag = admissionOpen;
  const agents = new Map([['lead-1', lead]]);
  const ctx = {
    agents,
    sessionPersistence: { stat: async () => ({}) },
    sessions: { flush: async () => true },
    subagents: { registerContinuationPolicy: () => () => {} },
    agentTeams: {
      registerPolicy: () => () => {},
      listTasks: () => tasks,
      updateTask: (_agent, input) => {
        if (input?.action === 'delete') {
          deletedTasks.push(input.taskId);
          const idx = tasks.findIndex(item => item.id === input.taskId);
          if (idx >= 0) tasks.splice(idx, 1);
        }
      },
      deleteTask: (_agent, id) => {
        deletedTasks.push(id);
        const idx = tasks.findIndex(item => item.id === id);
        if (idx >= 0) tasks.splice(idx, 1);
      },
    },
    get: key => {
      if (key === 'desktopTaskAdmission') return { check: () => openFlag };
      if (key === 'approval') return { policyOf: () => 'ask', enableDelegatedRequests: () => {}, bindDelegatedRequester: () => () => {} };
      return undefined;
    },
    sessionController: {
      resolveAgent: async id => { resolveAgentCalls += 1; return { agent: agents.get(id) }; },
    },
  };
  const service = new ProjectService(ctx, {
    get: () => state,
    update: async (_key, change) => { Object.assign(state, change(state)); },
  }, { home: '', desktop, orphanSweepIntervalMs: 0 });
  service.recovering = false;
  return {
    service, state, project, lead, agents, tasks, deletedTasks, ctx,
    setAdmission: value => { openFlag = value; },
    getResolveCalls: () => resolveAgentCalls,
  };
}

test('P0 guards block plugin/dsh-whale sources, reported/idle worker tool execution, send_message to reported worker, and empty settlements', async t => {
  const dir = await makeTempDir(t, 'whale-w3-p0-');
  const f = makeServiceFixture();
  f.project.storageRoot = dir;
  const req = {
    id: 'req-1', projectId: 'p1', title: 'Feature', goal: 'Build', revision: 1,
    scope: 'development', writePaths: ['src'], status: 'running', createdAt: 1, updatedAt: 1,
    versions: [{
      revision: 1, title: 'Feature', goal: 'Build', constraints: [], conditions: [],
      scope: 'development', writePaths: ['src'], at: 1,
      source: { sessionId: 'lead-1', messageId: 'human-1', messageIds: ['human-1'], callId: 'auth-call-1', authorizationCallId: 'auth-call-1', text: 'Build' },
    }],
    queue: { state: 'active', position: 0, suspended: false, released: false },
  };
  const work = {
    id: 'ws-1', projectId: 'p1', title: 'Implement', workerSessionId: 'worker-1',
    currentDelegationRef: 'del-1', status: 'done', brief: 'Do work', blockedBy: [],
    blockedReason: '', pendingSummary: false, createdAt: 1, updatedAt: 1,
    delegations: [{
      ref: 'del-1', phase: 'done', scope: 'development', brief: 'Do work', writePaths: ['src'],
      source: { sessionId: 'lead-1', messageId: 'human-1', callId: 'del-call-1', authorizationCallId: 'auth-call-1', text: 'Build', requestId: 'req-1', requestRevision: 1 },
      messageId: 'msg-1', runId: 'run-1', error: '', createdAt: 1,
      report: { delegationRef: 'del-1', outcome: 'completed', summary: 'Done', evidence: [], remainingIssues: [], artifacts: [], at: 2, callId: 'rep-1' },
    }],
    settlements: [],
  };
  const worker = {
    sessionId: 'worker-1', projectId: 'p1', workstreamId: 'ws-1', phase: 'idle',
    stopped: false, cwd: dir, role: 'development', mode: 'existing', error: '',
    activeRunId: '', consumedDelegationRef: 'del-1',
  };
  f.state.requests.push(req);
  f.state.workstreams.push(work);
  f.state.workers.push(worker);
  const workerAgent = { id: 'worker-1', session: { id: 'worker-1', snapshotEvents: () => [] } };
  f.agents.set('worker-1', workerAgent);

  // 1. Worker preStep blocks unauthorized plugin / dsh-whale:* and agent-message after report
  let nextCalled = false;
  const pluginDecision = await handlePreStep(
    f.service,
    { agent: workerAgent, messages: [{ id: 'pm-1', source: { kind: 'plugin', pluginId: 'dsh-whale:external' }, content: [{ type: 'text', text: 'hijack' }] }] },
    async () => { nextCalled = true; return { kind: 'enter' }; },
  );
  assert.deepEqual(pluginDecision, { kind: 'reject' });
  assert.equal(nextCalled, false);
  const reportedMsgDecision = await handlePreStep(
    f.service,
    { agent: workerAgent, messages: [{ id: 'am-1', source: { kind: 'agent-message', senderSessionId: 'lead-1' }, content: [{ type: 'text', text: 'wake' }] }] },
    async () => { nextCalled = true; return { kind: 'enter' }; },
  );
  assert.deepEqual(reportedMsgDecision, { kind: 'reject' });

  // 2. guard(exec) blocks reported worker & idle worker (no activeRunId)
  worker.role = 'worker';
  work.delegations[0].scope = 'worker';
  assert.match(guardToolExecution(f.service, { agent: workerAgent, name: 'pwsh', arguments: { command: 'echo hi' } }), /already reported/i);
  delete work.delegations[0].report;
  assert.match(guardToolExecution(f.service, { agent: workerAgent, name: 'pwsh', arguments: { command: 'echo hi' } }), /no active run/i);

  // 3. guard(exec) blocks send_message to reported worker and team_task_update(delete/complete)
  work.delegations[0].report = { delegationRef: 'del-1', outcome: 'completed', summary: 'Done', evidence: [], remainingIssues: [], artifacts: [], at: 2, callId: 'rep-1' };
  assert.match(guardToolExecution(f.service, { agent: f.lead, name: 'send_message', arguments: { agent: 'worker-1', message: 'ping' } }), /reported|stopped/i);
  assert.match(guardToolExecution(f.service, { agent: f.lead, name: 'team_task_update', arguments: { taskId: 'ws-1', action: 'complete' } }), /project_review|native task/i);
  assert.match(guardToolExecution(f.service, { agent: f.lead, name: 'team_task_update', arguments: { taskId: 'ws-1', action: 'delete' } }), /project_review|native task/i);

  // 4. Readonly worker glob/grep boundary check blocks outside paths and .git
  const roDir = join(dir, 'work');
  const outside = join(dir, 'outside');
  await fs.mkdir(roDir, { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  delete work.delegations[0].report;
  work.delegations[0].scope = 'readonly';
  worker.role = 'readonly';
  worker.cwd = roDir;
  worker.activeRunId = 'run-live';
  assert.match(guardToolExecution(f.service, { agent: workerAgent, name: 'glob', arguments: { path: outside } }), /escapes|outside|working directory/i);
  assert.match(guardToolExecution(f.service, { agent: workerAgent, name: 'grep', arguments: { path: join(roDir, '.git') } }), /\.git/i);
  assert.equal(guardToolExecution(f.service, { agent: workerAgent, name: 'glob', arguments: { path: roDir } }), undefined);

  // 5. runEnded ignores empty settlement refs so pendingSummary never gets stuck true
  work.pendingSummary = false;
  work.delegations[0].runId = 'other-run';
  await f.service.runEnded('worker-1', { runId: 'stray-run', reason: { kind: 'completed' } });
  assert.equal(work.settlements.length, 0);
  assert.equal(work.pendingSummary, false);
});

test('dsh-task-control inspection reports active project items and locked admission pauses dispatch without polluting state', async () => {
  const f = makeServiceFixture({ admissionOpen: false });
  f.state.workstreams.push({
    id: 'ws-queued', projectId: 'p1', title: 'Queued task', workerSessionId: 'w-q',
    currentDelegationRef: 'd-q', status: 'open', brief: 'work', blockedBy: [], blockedReason: '',
    pendingSummary: false, createdAt: 1, updatedAt: 1,
    delegations: [{ ref: 'd-q', phase: 'queued', scope: 'readonly', brief: 'work', writePaths: [], source: { sessionId: 'lead-1', messageId: 'human-1', callId: 'c1', text: 't' }, messageId: '', runId: '', error: '', createdAt: 1 }],
    settlements: [],
  });
  f.state.workers.push({ sessionId: 'w-q', projectId: 'p1', workstreamId: 'ws-queued', phase: 'queued', stopped: false, cwd: 'C:/workspace/proj', role: 'readonly', mode: 'existing', error: '', activeRunId: '' });

  const report = f.service.inspect();
  assert.equal(report.activeCount >= 1, true);
  assert.ok(report.details.some(item => item.id === 'ws-queued' && item.kind === 'work-queued'));
  assert.equal(f.service.admissionOpen(), false);

  f.service.schedule();
  await f.service.tail;
  assert.equal(f.state.workstreams[0].delegations[0].phase, 'queued', 'locked admission does not mark queued work as blocked or failed');
  assert.equal(f.state.workstreams[0].status, 'open');
  assert.equal(f.getResolveCalls(), 0, 'workRows and locked schedule never cold-wake agents');
  f.service.workRows('p1');
  assert.equal(f.getResolveCalls(), 0);
});

test('depth >= 2 nested members resolve root coordinator approval, cross-level dependency cycles, workPreview parentSessionId, and direct-child delivery', async () => {
  const f = makeServiceFixture();
  const req = {
    id: 'req-nested', projectId: 'p1', title: 'Nested Goal', goal: 'Coordinate nested work', revision: 1,
    scope: 'development', writePaths: ['src'], status: 'running', createdAt: 1, updatedAt: 1,
    versions: [{
      revision: 1, title: 'Nested Goal', goal: 'Coordinate nested work', constraints: [], conditions: [],
      scope: 'development', writePaths: ['src'], at: 1,
      source: { sessionId: 'lead-1', messageId: 'human-1', messageIds: ['human-1'], callId: 'auth-call-1', authorizationCallId: 'auth-call-1', text: 'Build feature' },
    }],
    queue: { state: 'active', position: 0, suspended: false, released: false },
  };
  const parentWork = {
    id: 'ws-parent', projectId: 'p1', title: 'Parent', workerSessionId: 'child-1', parentSessionId: 'lead-1',
    currentDelegationRef: 'del-p', status: 'done', brief: 'Parent work', blockedBy: [], blockedReason: '',
    pendingSummary: false, createdAt: 1, updatedAt: 2,
    delegations: [{
      ref: 'del-p', phase: 'accepted', scope: 'development', brief: 'Parent work', writePaths: ['src'],
      source: { sessionId: 'lead-1', messageId: 'human-1', callId: 'c-p', authorizationCallId: 'auth-call-1', text: 'Build feature', requestId: 'req-nested', requestRevision: 1 },
      messageId: 'm-p', runId: 'r-p', error: '', createdAt: 1,
      report: { delegationRef: 'del-p', outcome: 'completed', summary: 'Parent summary', evidence: ['ok'], remainingIssues: [], artifacts: [], at: 2, callId: 'rep-p' },
      review: { reportId: 'rep-p', decision: 'accepted', reason: 'good', evidence: ['ok'], at: 2 },
    }],
    settlements: [{ runId: 'r-p', stopReason: 'completed', delegationRefs: ['del-p'], at: 2 }],
    latestReport: { delegationRef: 'del-p', outcome: 'completed', summary: 'Parent summary', evidence: ['ok'], remainingIssues: [], artifacts: [], at: 2, callId: 'rep-p' },
  };
  const grandWork = {
    id: 'ws-grand', projectId: 'p1', title: 'Grandchild', workerSessionId: 'grand-1', parentSessionId: 'child-1',
    currentDelegationRef: 'del-g', status: 'done', brief: 'Grand work', blockedBy: ['ws-parent'], blockedReason: '',
    pendingSummary: false, createdAt: 2, updatedAt: 3,
    delegations: [{
      ref: 'del-g', phase: 'done', scope: 'readonly', brief: 'Grand work', writePaths: [],
      source: { sessionId: 'child-1', messageId: 'm-p', callId: 'c-g', authorizationCallId: 'auth-call-1', text: 'Subtask', requestId: 'req-nested', requestRevision: 1 },
      messageId: 'm-g', runId: 'r-g', error: '', createdAt: 2,
      report: { delegationRef: 'del-g', outcome: 'completed', summary: 'Grand summary', evidence: ['ok'], remainingIssues: [], artifacts: [], at: 3, callId: 'rep-g' },
    }],
    settlements: [{ runId: 'r-g', stopReason: 'completed', delegationRefs: ['del-g'], at: 3 }],
  };
  f.state.requests.push(req);
  f.state.workstreams.push(parentWork, grandWork);
  f.state.workers.push(
    { sessionId: 'child-1', projectId: 'p1', workstreamId: 'ws-parent', parentSessionId: 'lead-1', phase: 'idle', stopped: false, cwd: 'C:/workspace/proj', role: 'worker', mode: 'existing', error: '', activeRunId: '' },
    { sessionId: 'grand-1', projectId: 'p1', workstreamId: 'ws-grand', parentSessionId: 'child-1', phase: 'running', stopped: false, cwd: 'C:/workspace/proj', role: 'worker', mode: 'existing', error: '', activeRunId: 'r-g' },
  );

  // 1. Approvals ancestor traversal grants delegated approval to grandchild
  const approvals = new ProjectApprovals(f.service);
  const grandchildActor = { project: f.project, role: 'worker', agent: { id: 'grand-1' } };
  const nestedSource = { sessionId: 'child-1', messageId: 'human-1', callId: 'c-g', authorizationCallId: 'auth-call-1', text: 'Build feature' };
  assert.equal(approvals.requested(grandchildActor, nestedSource, 'worker'), true, 'grandchild inherits root coordinator ask-mode authorization');

  // 2. Cycle validation uses root coordinator tasks across namespaces
  f.tasks.push({ id: 'ws-parent', blockedBy: [] }, { id: 'ws-grand', blockedBy: ['ws-parent'] });
  assert.throws(() => validateDependenciesFor(f.service, 'p1', 'ws-parent', ['ws-grand']), /cycle/i);

  // 3. workPreview exposes parentSessionId and memberRole
  const card = f.service.requirements.card('p1', req, new Map());
  const grandPreview = card.workPreview.find(item => item.workstreamId === 'ws-grand');
  assert.equal(grandPreview.parentSessionId, 'child-1');
  assert.equal(grandPreview.memberRole, 'worker');

  // 4. Nested member runEnded does NOT trigger coordinator settlementCheck timer
  grandWork.delegations[0].runId = 'r-g';
  await f.service.runEnded('grand-1', { runId: 'r-g', reason: { kind: 'completed' } });
  assert.equal(f.service.settlementCheckTimers.has('p1'), false, 'nested member settlement must not arm coordinator settlement timer');

  // 5. Top-level deliver accepts direct-child summary without enumerating grandchild reportRefs, and auto-binds reportRefs when omitted
  f.state.workers.find(w => w.sessionId === 'grand-1').activeRunId = '';
  f.state.workers.find(w => w.sessionId === 'grand-1').phase = 'idle';
  const coordActor = { role: 'coordinator', project: f.project, agent: f.lead };
  const result = await f.service.requirements.declare(coordActor, {
    requestId: 'req-nested',
    requestRevision: 1,
    outcome: 'completed',
    summary: 'Delivered feature via parent workflow.',
    evidence: ['Parent verified grandchild output'],
    remainingIssues: [],
  }, { callId: 'deliver-call-1', signal: new AbortController().signal });
  const draft = f.state.deliveries.find(d => d.id === result.deliveryId);
  assert.ok(draft.reportRefs.some(ref => ref.workstreamId === 'ws-parent' && ref.delegationRef === 'del-p'));
  assert.equal(draft.reportRefs.some(ref => ref.workstreamId === 'ws-grand'), false, 'grandchild reportRef need not be manually enumerated');
});

test('explicit bugs: requestRevision & concurrent revert conflict, targeted project_ask clearing, research-hosts symlink rejection, Windows path comparison, and removed resume command', async t => {
  const dir = await makeTempDir(t, 'whale-w3-bugs-');
  const f = makeServiceFixture();
  f.project.storageRoot = dir;

  // 1. Windows case-insensitive path comparison vs POSIX case-sensitive
  assert.equal(samePath('C:\\Repo\\App\\', 'c:/repo/app'), true);
  assert.equal(comparablePath('C:\\Repo\\App\\'), comparablePath('c:/repo/app'));
  if (process.platform !== 'win32') assert.equal(samePath('/srv/App', '/srv/app'), false);

  // 2. research-hosts.txt symlink escape rejected fail-closed
  const outsideFile = join(dir, 'secret.txt');
  const storeDir = join(dir, 'store');
  await fs.mkdir(storeDir, { recursive: true });
  await fs.writeFile(outsideFile, 'evil.example.com\n', 'utf8');
  f.project.storageRoot = storeDir;
  let symlinkCreated = false;
  try {
    await fs.symlink(outsideFile, join(storeDir, 'research-hosts.txt'));
    symlinkCreated = true;
  } catch {
    // Windows without Developer Mode may forbid file symlinks; skip symlink sub-assertion only if OS denies creation.
  }
  if (symlinkCreated) {
    assert.throws(() => safeReadStoreFileSync(storeDir, 'research-hosts.txt'), /symbolic link|outside/i);
    assert.throws(() => researchHosts(f.project), /symbolic link|outside/i);
  }
  await fs.writeFile(join(storeDir, 'allowed-hosts.txt'), 'example.com\n', 'utf8');
  assert.equal(safeReadStoreFileSync(storeDir, 'allowed-hosts.txt').trim(), 'example.com');

  // 3. project_ask clearing only clears matched requirement when multiple requests run in parallel
  const askState = {
    requests: [
      { id: 'r1', projectId: 'p1', title: 'Auth API', ask: { id: 'a1', question: 'Use JWT or session?', options: ['JWT', 'Session'] } },
      { id: 'r2', projectId: 'p1', title: 'Billing UI', ask: { id: 'a2', question: 'Currency default?', options: ['USD', 'CNY'] } },
    ],
  };
  clearMatchedAsks(askState, 'p1', 'Use JWT or session?\nJWT');
  assert.equal(askState.requests[0].ask, undefined, 'matched request ask is cleared');
  assert.equal(askState.requests[1].ask?.id, 'a2', 'unrelated parallel request ask is preserved');

  // 4. revertRequestChanges enforces requestRevision and concurrent overlapping writer conflict
  const rA = {
    id: 'rA', projectId: 'p1', title: 'Req A', goal: 'A', revision: 2, status: 'completed',
    createdAt: 1, updatedAt: 10, versions: [], queue: { state: 'active', position: 0, suspended: false, released: true },
    changes: { workspaces: [{ workingDirectory: 'C:/workspace/proj', repoIdentity: 'repo-1', isGit: true, baseline: 't0', end: 't1', capturedAt: 1, endedAt: 10, fileCount: 1, added: 1, removed: 0 }] },
  };
  const rB = {
    id: 'rB', projectId: 'p1', title: 'Req B', goal: 'B', revision: 1, status: 'completed',
    createdAt: 5, updatedAt: 12, versions: [], queue: { state: 'active', position: 1, suspended: false, released: true },
    changes: { workspaces: [{ workingDirectory: 'c:\\workspace\\proj', repoIdentity: 'repo-1', isGit: true, baseline: 't0', end: 't2', capturedAt: 5, endedAt: 12, fileCount: 1, added: 1, removed: 0 }] },
  };
  f.state.requests.push(rA, rB);
  await assert.rejects(f.service.command('requests/revert', { projectId: 'p1', requestId: 'rA', requestRevision: 1 }), { code: 'stale_revision' });
  await assert.rejects(f.service.command('requests/revert', { projectId: 'p1', requestId: 'rA', requestRevision: 2 }), { code: 'revert_conflict' });

  // 5. Legacy command('resume') removed
  await assert.rejects(f.service.command('resume', { projectId: 'p1' }), { code: 'unknown_command' });
});

test('CatalogStore splits state per projectId with hot/history separation, legacy migration, and fail-closed corruption handling', async t => {
  const dir = await makeTempDir(t, 'whale-w3-catalog-');
  const tables = new Map();
  const makeTable = name => {
    const store = new Map();
    const writes = [];
    const api = {
      name,
      store,
      writes,
      get(key) { return store.has(key) ? structuredClone(store.get(key)) : undefined; },
      entries() { return [...store.entries()].map(([key, value]) => [key, structuredClone(value)]); },
      async put(key, value) { writes.push(key); store.set(key, structuredClone(value)); },
      async set(key, value) { writes.push(key); store.set(key, structuredClone(value)); },
      async delete(key) { store.delete(key); },
    };
    tables.set(name, api);
    return api;
  };
  const fakeCtx = {
    storageDomain: {
      async open(spec) {
        assert.equal(spec.layout, 'per-record');
        assert.equal(spec.name, projectDomain.name);
        return { table: name => tables.get(name) ?? makeTable(name), async close() {} };
      },
    },
  };

  // Write a valid legacy single-file catalog first
  const legacyDir = join(dir, 'storages');
  await fs.mkdir(legacyDir, { recursive: true });
  const legacyCatalog = {
    version: 2, revision: 3,
    projects: [
      { id: 'proj-a', title: 'A', coordinatorSessionId: 'lead-a', storageRoot: join(dir, 'a'), canonicalWorkingDirectory: join(dir, 'wa'), directoryIdentity: 'id-a', holdSourceMessageId: '', creationRequestId: 'cr-a', lifecycle: 'ready', paused: false, diagnostics: [], createdAt: 1, updatedAt: 1 },
      { id: 'proj-b', title: 'B', coordinatorSessionId: 'lead-b', storageRoot: join(dir, 'b'), canonicalWorkingDirectory: join(dir, 'wb'), directoryIdentity: 'id-b', holdSourceMessageId: '', creationRequestId: 'cr-b', lifecycle: 'ready', paused: false, diagnostics: [], createdAt: 1, updatedAt: 1 },
    ],
    workstreams: [{
      id: 'ws-a', projectId: 'proj-a', title: 'Work A', workerSessionId: 'w-a', currentDelegationRef: 'd2',
      status: 'done', brief: 'b', blockedBy: [], blockedReason: '', pendingSummary: false, archived: false, createdAt: 1, updatedAt: 2,
      delegations: [
        { ref: 'd1', phase: 'accepted', scope: 'readonly', brief: 'old', writePaths: [], source: { sessionId: 'lead-a', messageId: 'm1', callId: 'c1', text: 't' }, messageId: 'm1', runId: 'r1', error: '', createdAt: 1, report: { delegationRef: 'd1', outcome: 'completed', summary: 'HISTORICAL_REPORT_BODY', evidence: [], remainingIssues: [], artifacts: [], at: 1, callId: 'rc1' } },
        { ref: 'd2', phase: 'accepted', scope: 'readonly', brief: 'cur', writePaths: [], source: { sessionId: 'lead-a', messageId: 'm2', callId: 'c2', text: 't' }, messageId: 'm2', runId: 'r2', error: '', createdAt: 2, report: { delegationRef: 'd2', outcome: 'completed', summary: 'CURRENT_REPORT_BODY', evidence: [], remainingIssues: [], artifacts: [], at: 2, callId: 'rc2' } },
      ],
      settlements: [],
    }],
    workers: [],
    requests: [],
    deliveries: [],
  };
  await fs.writeFile(join(legacyDir, 'whale_project_local.json'), JSON.stringify({ unit: { name: projectDomain.name, version: 1 }, tables: { state: { catalog: legacyCatalog } } }), 'utf8');

  const store = await CatalogStore.open(fakeCtx, dir, { open: async () => { throw new Error('unused'); } });
  assert.equal(store.get().projects.length, 2);
  // Historical delegation d1 report is split into history table, hot table drops its heavy report body
  const hotA = tables.get('hot').get('proj-a');
  const histA = tables.get('history').get('proj-a');
  assert.equal(hotA.workstreams[0].delegations[0].reportStoredInHistory, true);
  assert.equal(hotA.workstreams[0].delegations[0].report, undefined);
  assert.equal(histA.reports.find(r => r.workstreamId === 'ws-a' && r.delegationRef === 'd1').report.summary, 'HISTORICAL_REPORT_BODY');

  // Dirty write to proj-a does not rewrite proj-b
  tables.get('projects').writes.length = 0;
  tables.get('hot').writes.length = 0;
  await store.update('catalog', state => ({
    ...state,
    projects: state.projects.map(p => p.id === 'proj-a' ? { ...p, title: 'A Updated' } : p),
  }));
  assert.deepEqual(tables.get('projects').writes, ['proj-a']);
  assert.equal(tables.get('hot').writes.includes('proj-b'), false);

  // Re-opening reconstructs historical report losslessly
  const reopened = await CatalogStore.open(fakeCtx, dir, { open: async () => { throw new Error('unused'); } });
  assert.equal(reopened.get().workstreams[0].delegations[0].report.summary, 'HISTORICAL_REPORT_BODY');

  // Corrupt legacy file fails closed with zero per-record writes
  const badDir = await makeTempDir(t, 'whale-w3-badcat-');
  await fs.mkdir(join(badDir, 'storages'), { recursive: true });
  await fs.writeFile(join(badDir, 'storages', 'whale_project_local.json'), '{not-valid-json', 'utf8');
  const cleanTables = new Map();
  const badCtx = {
    storageDomain: {
      open: async () => ({ table: name => { if (!cleanTables.has(name)) cleanTables.set(name, makeTable(name)); return cleanTables.get(name); }, async close() {} }),
    },
  };
  await assert.rejects(CatalogStore.open(badCtx, badDir, {}), /SyntaxError|JSON|catalog/i);
  for (const tbl of cleanTables.values()) assert.equal(tbl.writes.length, 0, 'corrupt legacy catalog performs zero writes');
});

test('256 native task slot release, 4 scoped worker presets, independent reviewer + finding verification, evidence probes, hotspot conflicts, error classification, escalation and orphan sweep', async t => {
  const dir = await makeTempDir(t, 'whale-w3-arch-');

  // 1. 4 scoped presets and trimmed coordinator surface
  assert.equal(presetForScope('readonly'), 'project-worker-readonly');
  assert.equal(presetForScope('research'), 'project-worker-research');
  assert.equal(presetForScope('docs'), 'project-worker-docs');
  assert.equal(presetForScope('development'), 'project-worker-development');
  assert.ok(ALL_WORKER_PRESETS.has('project-worker'));
  const registered = new Map();
  await registerProjectPresets({
    agentPresets: { register: preset => { registered.set(preset.id, preset); return () => {}; } },
    effect: fn => fn(),
  });
  const coordPlugins = registered.get('project-coordinator').plugins.map(p => typeof p === 'string' ? p : p.name ?? p.id ?? String(p));
  assert.equal(coordPlugins.some(p => p.includes('subagent-fork')), false, 'coordinator does not mount subagent-fork');
  const roPlugins = registered.get('project-worker-readonly').plugins.map(p => typeof p === 'string' ? p : p.name ?? p.id ?? String(p));
  assert.equal(roPlugins.some(p => p.includes('pwsh') || p.includes('bash') || p.includes('tool-fs-edit') || p.includes('tool-web')), false);

  // 2. 256 native slot release preserves Project work history while reclaiming native task board slot
  const f = makeServiceFixture();
  f.project.storageRoot = dir;
  f.state.requests.push({
    id: 'req-done', projectId: 'p1', title: 'Done', goal: 'Done', revision: 1, status: 'completed',
    archivedAt: 100, createdAt: 1, updatedAt: 10, versions: [], queue: { state: 'active', position: 0, suspended: false, released: true },
  });
  f.state.workstreams.push({
    id: 'ws-hist', projectId: 'p1', title: 'Hist', workerSessionId: 'w-hist', nativeTaskId: 'ws-hist',
    currentDelegationRef: 'd-hist', status: 'done', brief: 'b', blockedBy: [], blockedReason: '',
    pendingSummary: false, createdAt: 1, updatedAt: 2,
    delegations: [{ ref: 'd-hist', phase: 'accepted', scope: 'readonly', brief: 'b', writePaths: [], source: { sessionId: 'lead-1', messageId: 'human-1', callId: 'c1', text: 't', requestId: 'req-done', requestRevision: 1 }, messageId: 'm1', runId: 'r1', error: '', createdAt: 1 }],
    settlements: [],
  });
  f.state.workers.push({ sessionId: 'w-hist', projectId: 'p1', workstreamId: 'ws-hist', phase: 'idle', stopped: false, cwd: dir, role: 'readonly', mode: 'existing', error: '', activeRunId: '' });
  f.tasks.push({ id: 'ws-hist', status: 'completed', blockedBy: [] });
  const releasedCount = await releaseHistoricalNativeTasks(f.service, 'p1', { requestId: 'req-done' });
  assert.equal(releasedCount, 1);
  assert.equal(f.state.workstreams[0].nativeTaskId, undefined);
  assert.equal(f.state.workstreams[0].archivedNativeTaskId, 'ws-hist');
  assert.ok(f.deletedTasks.includes('ws-hist'));

  // 3. Deterministic live evidence probe verifies artifact hash & detects tampering
  const artifactFile = join(dir, 'output.txt');
  await fs.writeFile(artifactFile, 'expected-content', 'utf8');
  const expectedHash = createHash('sha256').update('expected-content').digest('hex');
  const okProbe = await probeReportEvidence({
    report: { delegationRef: 'd1', outcome: 'completed', summary: 'ok', evidence: ['output.txt verified'], artifacts: [{ path: artifactFile, sha256: expectedHash, size: 16, type: 'file' }], remainingIssues: [], at: 1, callId: 'c' },
    worker: { cwd: dir, sessionId: 'w1' },
    project: f.project,
    events: [],
  });
  assert.equal(okProbe.probeSummary.verified, true);
  await fs.writeFile(artifactFile, 'tampered-content', 'utf8');
  const badProbe = await probeReportEvidence({
    report: { delegationRef: 'd1', outcome: 'completed', summary: 'ok', evidence: [], artifacts: [{ path: artifactFile, sha256: expectedHash, size: 16, type: 'file' }], remainingIssues: [], at: 1, callId: 'c' },
    worker: { cwd: dir, sessionId: 'w1' },
    project: f.project,
    events: [],
  });
  assert.equal(badProbe.probeSummary.verified, false);
  assert.ok(badProbe.probeSummary.issues.some(issue => /hash|mismatch|changed/i.test(issue)));

  // 4. Hotspot static conflict detection identifies holder on overlap & shared hotspot files, allows disjoint writes
  const conflictCatalog = {
    workstreams: [{
      id: 'ws-holder', projectId: 'p1', title: 'Update API schema', workerSessionId: 'w-holder', currentDelegationRef: 'd-h',
      status: 'running', delegations: [{ ref: 'd-h', phase: 'running', scope: 'worker', writePaths: ['src/api', 'package.json'] }],
    }],
    workers: [{ sessionId: 'w-holder', projectId: 'p1', workstreamId: 'ws-holder', phase: 'active', stopped: false, cwd: dir, activeRunId: 'run-h' }],
  };
  const overlap = detectHotspotConflicts(conflictCatalog, f.project, { scope: 'worker', cwd: dir, writePaths: ['src/api/routes.js'] });
  assert.equal(overlap.conflicts.length >= 1, true);
  assert.equal(overlap.conflicts[0].holderWorkstreamId, 'ws-holder');
  const hotspot = detectHotspotConflicts(conflictCatalog, f.project, { scope: 'worker', cwd: dir, writePaths: ['package.json'] });
  assert.equal(hotspot.conflicts.length >= 1, true);
  assert.ok(hotspot.conflicts.some(item => item.kind === 'hotspot' || item.kind === 'write_overlap'));
  const disjoint = detectHotspotConflicts(conflictCatalog, f.project, { scope: 'docs', cwd: dir, writePaths: ['docs/readme.md'] });
  assert.equal(disjoint.conflicts.length, 0);

  // 5. Error classification: config/auth non-retryable vs transient retryable
  const authErr = classifyExecutionError({ code: 'MISSING_CREDENTIAL', message: 'API key missing' });
  assert.equal(authErr.retryable, false);
  assert.equal(authErr.retryRequired, true);
  assert.equal(authErr.category, 'auth');
  const transientErr = classifyExecutionError({ code: 'RATE_LIMITED', message: 'HTTP 429 rate limit exceeded' });
  assert.equal(transientErr.retryable, true);
  assert.equal(transientErr.retryRequired, false);

  // 6. project_review: unverified findings hold in pending_verification; verify_findings confirms rework or accepts when all rejected
  const revWork = {
    id: 'ws-rev', projectId: 'p1', title: 'Impl', workerSessionId: 'w-rev', currentDelegationRef: 'd-rev',
    status: 'done', brief: 'b', blockedBy: [], blockedReason: '', pendingSummary: false, createdAt: 1, updatedAt: 1,
    delegations: [{
      ref: 'd-rev', phase: 'done', scope: 'worker', brief: 'b', writePaths: ['src'],
      source: { sessionId: 'lead-1', messageId: 'human-1', callId: 'c-rev', text: 't', requestId: 'req-done', requestRevision: 1 },
      messageId: 'm-rev', runId: 'r-rev', error: '', createdAt: 1,
      report: { delegationRef: 'd-rev', outcome: 'completed', summary: 'Implemented', evidence: ['tests ran'], remainingIssues: [], artifacts: [], at: 1, callId: 'rc-rev' },
    }],
    settlements: [{ runId: 'r-rev', stopReason: 'completed', delegationRefs: ['d-rev'], at: 2 }],
  };
  f.state.workstreams.push(revWork);
  f.state.workers.push({ sessionId: 'w-rev', projectId: 'p1', workstreamId: 'ws-rev', phase: 'idle', stopped: false, cwd: dir, role: 'worker', mode: 'existing', error: '', activeRunId: '' });
  const coordActor = { role: 'coordinator', project: f.project, agent: f.lead };
  const pendingRes = await handleProjectReview(f.service, coordActor, {
    workstreamId: 'ws-rev', delegationRef: 'd-rev', reportId: 'rc-rev',
    findings: [{ id: 'f1', summary: 'Null deref in auth.js', severity: 'high' }],
    reason: 'Independent review found potential null deref',
    evidence: ['Reviewed auth.js'],
  }, { callId: 'rev-0' });
  assert.equal(pendingRes.decision, 'pending_verification');
  const confirmedRes = await handleProjectReview(f.service, coordActor, {
    workstreamId: 'ws-rev', delegationRef: 'd-rev', reportId: 'rc-rev', mode: 'verify_findings',
    findingVerifications: [{ id: 'f1', status: 'confirmed', note: 'Reproduced with empty header' }],
    reason: 'Fix confirmed defect',
  }, { callId: 'rev-1' });
  assert.equal(confirmedRes.decision, 'returned');
  assert.equal(confirmedRes.confirmedFindings.length, 1);
  assert.equal(confirmedRes.reworkReady, true);
  const rejectedRes = await handleProjectReview(f.service, coordActor, {
    workstreamId: 'ws-rev', delegationRef: 'd-rev', reportId: 'rc-rev', mode: 'verify_findings',
    findings: [{ id: 'f2', summary: 'False positive lint note', severity: 'low' }],
    findingVerifications: [{ id: 'f2', status: 'rejected', note: 'Line is unreachable guard' }],
    reason: 'All findings independently disproved',
  }, { callId: 'rev-2' });
  assert.equal(rejectedRes.decision, 'accepted');
  assert.equal(rejectedRes.rejectedFindings.length, 1);

  // 7. Consecutive failure escalation & periodic orphan sweep
  const escReq = { id: 'req-esc', projectId: 'p1', title: 'Escalate Me', goal: 'G', revision: 1, status: 'running', createdAt: 1, updatedAt: 1, versions: [], queue: { state: 'active', position: 0, suspended: false, released: false } };
  const escWork = {
    id: 'ws-esc', projectId: 'p1', title: 'Flaky', workerSessionId: 'w-esc', currentDelegationRef: 'd-esc',
    status: 'running', brief: 'b', blockedBy: [], blockedReason: '', pendingSummary: false, createdAt: 1, updatedAt: 1,
    delegations: [{ ref: 'd-esc', phase: 'running', scope: 'development', brief: 'b', writePaths: [], source: { sessionId: 'lead-1', messageId: 'human-1', callId: 'c', text: 't', requestId: 'req-esc', requestRevision: 1 }, messageId: 'm', runId: 'r-esc', error: '', createdAt: 1 }],
    settlements: [],
  };
  f.state.requests.push(escReq);
  f.state.workstreams.push(escWork);
  f.state.workers.push({ sessionId: 'w-esc', projectId: 'p1', workstreamId: 'ws-esc', phase: 'running', stopped: false, cwd: dir, role: 'development', mode: 'existing', error: '', activeRunId: 'r-esc' });

  await recordFailureAndEscalate(f.service, 'ws-esc', { reason: 'Auth key missing', category: 'auth', retryRequired: true });
  const updatedEscWork = f.service.state().workstreams.find(w => w.id === 'ws-esc');
  const updatedEscReq = f.service.state().requests.find(r => r.id === 'req-esc');
  assert.ok(updatedEscWork.escalatedAt, 'non-retryable error immediately escalates');
  assert.ok(updatedEscReq.ask, 'escalation raises human ask on requirement');

  // Orphan sweep reclaims missing worker session stuck in running/preparing
  await f.service.write(state => {
    const w = state.workstreams.find(item => item.id === 'ws-esc');
    const m = state.workers.find(item => item.sessionId === 'w-esc');
    w.delegations[0].phase = 'running';
    m.activeRunId = 'ghost-run';
    m.phase = 'active';
  });
  const swept = await sweepOrphans(f.service);
  assert.ok(swept >= 1);
  assert.equal(f.service.state().workers.find(w => w.sessionId === 'w-esc').activeRunId, '');
});
