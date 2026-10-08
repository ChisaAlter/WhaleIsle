const test = require('node:test');
const assert = require('node:assert/strict');

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
  const tasks = new Map(state.workstreams.map(work => [work.id, { id: work.id, revision: 1, status: 'in_progress' }]));
  const ctx = { agentTeams: { registerPolicy: () => () => {}, cancelMessages: async () => {}, setCold: async () => {}, getTask: (_root, id) => tasks.get(id), updateTask: async (_root, request) => { const task = tasks.get(request.taskId); task.status = request.action === 'complete' ? 'completed' : 'pending'; task.revision++; return task; } }, agents, get: () => undefined, logger: { warn: (...args) => warnings.push(args) }, subagents: {
    registerContinuationPolicy: () => () => {}, drainContinuableChildren: async () => {},
  } };
  const table = { get: () => state, update: async (_key, change) => { state = change(state); } };
  const service = new ProjectService(ctx, table, { home: '', desktop: async () => ({}) });
  service.recovering = false;
  service.notes = async () => {};
  service.schedule = () => {};
  return { service, parent, agents, warnings, state: () => state };
}

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
  const { service, parent, state } = await fixture();
  let cancelled = false;
  parent.cancel = () => { cancelled = true; };
  service.table.update = async () => { throw new Error('Catalog is unwritable'); };
  await assert.rejects(service.stop('p'), /Catalog is unwritable/);
  assert.equal(cancelled, true);
  await assert.rejects(service.delegate({ role: 'coordinator', agent: parent, project: state().projects[0] }, { scope: 'readonly', brief: 'Late work' }, { callId: 'later-call', signal: new AbortController().signal }), { code: 'stopped' });
  await Promise.allSettled([...service.stops.values()]);
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
