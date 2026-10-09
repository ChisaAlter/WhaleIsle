const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function fixture() {
  const { ProjectService } = await import('../../vendor/dsh-project/lib/service.js');
  const events = [
    { seq: 10, type: 'turn/start', data: { turn: 2 } },
    { seq: 11, type: 'user/message', data: { id: 'human-B', source: { kind: 'user' }, content: [{ type: 'text', text: 'Stop the earlier work.' }] } },
    { seq: 12, type: 'tool/call', data: { callId: 'later-call', turn: 2 } },
  ];
  const parent = { id: 'main', cancel() {}, session: { snapshotEvents: () => events } };
  let state = { revision: 0, projects: [{ id: 'p', coordinatorSessionId: 'main', lifecycle: 'ready', paused: false, holdSourceMessageId: '', canonicalWorkingDirectory: '/selected' }],
    workers: ['a', 'b'].map(id => ({ sessionId: id, projectId: 'p', workstreamId: `work-${id}`, cwd: '/selected', role: 'worker', mode: 'existing', phase: 'idle', directoryHeld: false, stopped: false })),
    workstreams: ['a', 'b'].map(id => ({ id: `work-${id}`, projectId: 'p', workerSessionId: id, status: 'open', currentDelegationRef: id, settlements: [],
      delegations: [{ ref: id, source: { messageId: 'human-A' }, scope: 'worker', writePaths: [], phase: 'accepted', runId: '' }] })) };
  const warnings = [], agents = new Map([['main', parent]]);
  const tasks = new Map(state.workstreams.map(work => [work.id, { id: work.id, revision: 1, status: 'in_progress', blockedBy: [] }]));
  const ctx = { agentTeams: { registerPolicy: () => () => {}, cancelMessages: async () => {}, setCold: async () => {}, listTasks: () => [...tasks.values()], getTask: (_root, id) => tasks.get(id), updateTask: async (_root, request) => { const task = tasks.get(request.taskId); task.status = request.action === 'complete' ? 'completed' : 'pending'; task.revision++; return task; } }, agents, get: () => undefined, logger: { warn: (...args) => warnings.push(args) }, subagents: {
    registerContinuationPolicy: () => () => {}, drainContinuableChildren: async () => {},
  } };
  const table = { get: () => state, update: async (_key, change) => { state = change(state); } };
  const service = new ProjectService(ctx, table, { home: '', desktop: async () => ({}) });
  service.recovering = false;
  service.notes = async () => {};
  service.schedule = () => {};
  return { service, parent, agents, warnings, state: () => state };
}

test('writers in overlapping Project directories queue while siblings and readonly work remain independent', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-project-directory-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  await fs.mkdir(path.join(temporary, 'repo', 'src'), { recursive: true });
  await fs.mkdir(path.join(temporary, 'repo', 'src-other'));
  const root = await fs.realpath(path.join(temporary, 'repo'));
  const child = await fs.realpath(path.join(root, 'src'));
  const sibling = await fs.realpath(path.join(root, 'src-other'));
  const { service, state } = await fixture();
  const [holder, waiting] = state().workers;
  state().projects[0].canonicalWorkingDirectory = root;
  state().projects.push({ ...state().projects[0], id: 'nested-project', canonicalWorkingDirectory: child });
  Object.assign(holder, { cwd: root, directoryHeld: true });
  Object.assign(waiting, { projectId: 'nested-project', cwd: child });
  assert.equal(service.directoryAvailable(waiting, 'worker'), false, 'a root writer owns its child directories across Projects');
  Object.assign(holder, { cwd: child }); Object.assign(waiting, { cwd: root });
  assert.equal(service.directoryAvailable(waiting, 'worker'), false, 'a child writer also excludes a parent writer');
  assert.equal(service.directoryAvailable(waiting, 'readonly'), true, 'readonly investigations remain parallel');
  waiting.cwd = sibling;
  assert.equal(service.directoryAvailable(waiting, 'worker'), true, 'a shared path prefix is not directory overlap');
  waiting.cwd = '';
  assert.equal(service.directoryAvailable(waiting, 'worker'), false, 'queued existing-directory work uses its canonical Project root before Session creation');
  waiting.mode = 'worktree';
  assert.equal(service.directoryAvailable(waiting, 'worker'), true, 'an unprepared independent worktree does not reserve its source checkout');
  waiting.mode = 'existing'; holder.directoryHeld = false;
  assert.equal(service.directoryAvailable(waiting, 'worker'), true, 'draining the owner releases the queued writer');
});

test('recovery clears only resolved directory diagnostics and reconciles the original Project without running work', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-project-recover-directory-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const storage = path.join(temporary, 'storage'), selected = path.join(temporary, 'selected');
  await fs.mkdir(storage);
  const { service, state } = await fixture();
  state().workers = []; state().workstreams = [];
  Object.assign(state().projects[0], { storageRoot: await fs.realpath(storage), canonicalWorkingDirectory: selected,
    diagnostics: ['Unresolved settlement accounting failure'] });
  const inspected = [], reconciled = [];
  service.ctx.sessionController = { inspect: async id => { inspected.push(id); } };
  service.ctx.sessionPersistence = { stat: async () => ({}) };
  service.teams.bindPolicy = async root => { reconciled.push(root.id); };
  await service.recover();
  assert.equal(state().projects[0].diagnostics.length, 2, 'a missing directory does not overwrite another recorded fault');
  assert.match(state().projects[0].diagnostics[1], /Project directory check/);
  assert.equal(inspected.length, 0);
  await fs.mkdir(selected);
  await service.recover();
  assert.deepEqual(state().projects[0].diagnostics, ['Unresolved settlement accounting failure']);
  assert.deepEqual(inspected, ['main']);
  assert.deepEqual(reconciled, [], 'an unrelated unresolved fault is not declared repaired');
  state().projects[0].diagnostics = [`ENOENT: no such file or directory, realpath '${selected}'`];
  await service.recover();
  assert.deepEqual(state().projects[0].diagnostics, [], 'previous raw missing-path diagnostics are resolved by the same successful check');
  assert.deepEqual(reconciled, ['main'], 'the original Team is reconciled after its directory returns');
  assert.equal(state().projects[0].coordinatorSessionId, 'main');
  assert.equal(state().projects[0].paused, true, 'successful recovery still requires new user input');
  assert.equal(service.projectView(state().projects[0]).activity.state, 'idle');
});

test('a newly queued request is not assigned to the native run of the previously submitted brief', async () => {
  const { service, state } = await fixture();
  const work = state().workstreams[0], member = state().workers[0];
  work.delegations[0].phase = 'preparing'; member.reservationRef = 'a';
  work.delegations.push({ ref: 'followup', scope: 'worker', phase: 'queued', runId: '', writePaths: [] }); work.currentDelegationRef = 'followup';
  await service.runStarted({ id: 'a', runId: 'first-run' });
  assert.equal(state().workstreams[0].delegations[0].runId, 'first-run');
  assert.equal(state().workstreams[0].delegations[1].runId, '');
  await service.runEnded({ id: 'a', runId: 'first-run', stopReason: 'refusal' });
  state().workers[0].reservationRef = 'followup'; state().workstreams[0].delegations[1].phase = 'preparing';
  await service.runStarted({ id: 'a', runId: 'followup-run' });
  state().workstreams[0].delegations[1].report = { outcome: 'completed', summary: 'Followup finished' };
  await service.runEnded({ id: 'a', runId: 'followup-run', stopReason: 'completed' });
  assert.equal(state().workstreams[0].status, 'done');
  assert.deepEqual(state().workstreams[0].settlements[1].delegationRefs, ['followup']);
});

test('explicit continuation after finding the original directory removes only its resolved blocker without restarting the app', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-project-live-directory-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const { projectDirectory } = await import('../../vendor/dsh-project/lib/files.js');
  const selected = path.join(temporary, 'selected'), home = path.join(temporary, 'home');
  const storage = await projectDirectory(home, 'p');
  const { service, state, parent } = await fixture();
  service.home = home;
  Object.assign(state().projects[0], { storageRoot: storage, canonicalWorkingDirectory: selected,
    diagnostics: [`Project directory check (${selected}): ENOENT`, 'Unresolved settlement accounting failure'] });
  const work = state().workstreams[0], member = state().workers[0];
  Object.assign(work, { title: 'Continue original work', brief: 'Inspect the restored directory', blockedBy: [] });
  Object.assign(member, { cwd: selected, workspace: { canonicalPath: selected }, materialized: true });
  work.delegations[0].phase = 'queued';
  service.ensureTask = async () => ({ ready: true, status: 'pending', blockedBy: [] });
  service.ctx.sessionPersistence = { stat: async () => ({}) };
  service.preferencesFor = () => '';
  const resumed = [];
  service.teams.bindPolicy = async () => {};
  service.teams.adoptMember = async (_parent, request) => resumed.push(request.childId);
  service.assignTask = async () => {};
  service.teams.sendMessage = async (_parent, request) => ({ messageId: request.messageId });
  await assert.rejects(service.doLaunch(work.id, new AbortController().signal), { code: 'ENOENT' });
  assert.equal(state().workstreams[0].status, 'blocked');
  assert.equal(resumed.length, 0);
  assert.equal(state().projects[0].diagnostics.length, 2);
  await fs.mkdir(selected);
  await service.delegate({ role: 'coordinator', agent: parent, project: state().projects[0] },
    { workstreamId: work.id, scope: 'development', brief: 'Explicitly continue after restoring the original directory.' },
    { callId: 'later-call', signal: new AbortController().signal });
  await Promise.all([...service.launches.values()]);
  assert.deepEqual(state().projects[0].diagnostics, ['Unresolved settlement accounting failure']);
  assert.deepEqual(resumed, ['a']);
  assert.equal(state().workers[0].cwd, selected);
  assert.equal(state().workstreams[0].status, 'running');
  assert.equal(state().workstreams[0].workerSessionId, 'a');
});

test('closing an old run cannot admit another writer while its worker has reserved a continuation', async () => {
  const { service, parent, state } = await fixture();
  Object.assign(state().workers[0], { activeRunId: 'old-run', reservationRef: 'new', directoryHeld: true });
  const work = state().workstreams[0]; work.delegations[0].runId = 'old-run';
  work.delegations.push({ ref: 'new', phase: 'preparing', scope: 'worker', runId: '' }); work.currentDelegationRef = 'new';
  await service.runEnded({ id: 'a', runId: 'old-run', stopReason: 'completed' });
  await assert.rejects(service.admit({ parent, childId: 'b', reason: 'message' }), { code: 'directory_busy' });
  await service.runStarted({ id: 'a', runId: 'new-run' });
  await assert.rejects(service.admit({ parent, childId: 'b', reason: 'message' }), { code: 'directory_busy' });
});

test('single-work stop rejects another delegate from the same user turn', async () => {
  const { service, parent, state } = await fixture();
  await service.stop('p', 'work-a'); await Promise.all([...service.stops.values()]);
  await assert.rejects(service.delegate({ role: 'coordinator', agent: parent, project: state().projects[0] },
    { workstreamId: 'work-a', scope: 'development', brief: 'Continue' }, { callId: 'later-call', signal: new AbortController().signal }), { code: 'stopped' });
  assert.equal(state().workers[0].stopped, true);
});

test('unwritable generated notes do not prevent cancellation and native draining', async () => {
  const { service, agents, state, warnings } = await fixture();
  let cancelled = 0, drained = 0;
  agents.set('a', { status: 'running', cancel() { cancelled++; }, async whenIdle() {} });
  service.ctx.subagents.drainContinuableChildren = async () => { drained++; };
  service.notes = async () => { throw new Error('Disk write failed'); };
  await service.sessionStop('main'); await Promise.all([...service.stops.values()]);
  assert.equal(cancelled, 2); assert.equal(drained, 2);
  assert.equal(state().projects[0].paused, true); assert.equal(state().workers[0].directoryHeld, false);
  assert.ok(warnings.some(args => args.includes('Disk write failed')));
});


test('a failed stop write still cancels the Lead and denies delegation from that user message', async () => {
  const { service, parent, state, warnings } = await fixture();
  let cancelled = false;
  const drained = [];
  parent.cancel = () => { cancelled = true; };
  service.ctx.subagents.drainContinuableChildren = async (_parent, ids) => { drained.push(...ids); };
  service.table.update = async () => { throw new Error('Catalog is unwritable'); };
  await assert.rejects(service.stop('p'), /Catalog is unwritable/);
  assert.equal(cancelled, true);
  await assert.rejects(service.delegate({ role: 'coordinator', agent: parent, project: state().projects[0] }, { scope: 'readonly', brief: 'Late work' }, { callId: 'later-call', signal: new AbortController().signal }), { code: 'stopped' });
  await Promise.allSettled([...service.stops.values()]);
  assert.deepEqual(drained.sort(), ['a', 'b'], 'both original workers drain despite the failed catalog and diagnostic writes');
  assert.ok(warnings.some(args => args[0] === 'Project stop needs attention: %s' && args[1] === 'Catalog is unwritable'));
  assert.ok(warnings.some(args => args[0] === 'Project stop diagnostic could not be saved: %s' && args[1] === 'Catalog is unwritable'));
});

test('the last owned Job completes its native Team task after the model has settled', async () => {
  const { service, parent, state } = await fixture();
  const work = state().workstreams[0], receipt = work.delegations[0];
  receipt.report = { outcome: 'completed' }; receipt.runId = 'run-a';
  work.settlements = [{ runId: 'run-a', delegationRefs: ['a'], stopReason: 'completed' }];
  state().workers[0].directoryHeld = true;
  await service.jobChanged({ type: 'settled', job: { owner: 'a' } });
  assert.equal(service.teams.getTask(parent, work.id).status, 'completed');
  assert.equal(state().workers[0].directoryHeld, false);
});
