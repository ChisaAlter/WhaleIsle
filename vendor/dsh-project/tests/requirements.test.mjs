import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectService } from '../lib/service.js';

function fixture() {
  const events = [], project = { id: 'project', coordinatorSessionId: 'lead', storageRoot: '/project-materials', lifecycle: 'ready', paused: false, diagnostics: [], updatedAt: 0 };
  const session = { id: 'lead', snapshotEvents: () => events }, lead = { id: 'lead', session }, state = { revision: 0, projects: [project], workstreams: [], workers: [] };
  let persist = true, flushes = 0;
  const ctx = { agents: new Map([['lead', lead]]), get: () => undefined, sessions: { flush: async () => { flushes++; if (persist instanceof Error) throw persist; return persist; } }, subagents: { registerContinuationPolicy: () => () => {} }, agentTeams: { registerPolicy: () => () => {}, listTasks: () => [] } };
  const service = new ProjectService(ctx, { get: () => state, update: async (_key, change) => Object.assign(state, change(state)) }, { home: '', desktop: async () => ({}) });
  service.recovering = false; service.notes = async () => {};
  const actor = service.actor(lead), signal = new AbortController().signal;
  const append = (type, data) => { const event = { seq: events.length, time: Date.now(), type, data }; events.push(event); return event; };
  let turn = 0;
  const human = texts => { turn++; append('turn/start', { turn }); texts.forEach((text, index) => append('user/message', { id: `human-${turn}-${index}`, source: { kind: 'user' }, content: [{ type: 'text', text }] })); };
  const exec = name => { const callId = `call-${events.length}`; append('tool/call', { turn, callId, name }); return { signal, callId }; };
  const accept = args => service.acceptRequest(actor, { goal: 'Repair and validate login', authorization: 'development', criteria: ['Login works'], constraints: ['Preserve user work'], ...args }, exec('project_request'));
  const add = (request, outcome = 'completed') => {
    const id = `work-${state.workstreams.length}`, ref = `ref-${id}`, runId = `run-${id}`, report = { delegationRef: ref, callId: `report-${id}`, outcome, summary: 'Actual worker finding', artifacts: [], evidence: ['Observed result'], remainingIssues: [], at: Date.now() };
    const receipt = { ref, runId, phase: 'accepted', scope: 'readonly', requestId: request.id, requestVersion: request.currentVersion, report, source: {}, writePaths: [] };
    const work = { id, projectId: project.id, workerSessionId: `member-${id}`, currentDelegationRef: ref, delegations: [receipt], settlements: [{ runId, delegationRefs: [ref], stopReason: 'completed', summarizedBy: '' }], pendingSummary: true, latestReport: report };
    state.workstreams.push(work); state.workers.push({ sessionId: work.workerSessionId, workstreamId: id, projectId: project.id, stopped: false, phase: 'idle' });
    service.requirements.bind(state, receipt, id); return { work, receipt, ref: { workstreamId: id, delegationRef: ref, runId, reportId: report.callId } };
  };
  const declare = (request, refs, extra = {}) => service.declareDelivery(actor, { requestId: request.id, requestVersion: request.currentVersion, outcome: 'completed', summary: 'The required result is available.', references: refs, evidence: ['Actual worker evidence; no independent UI claim'], remainingIssues: [], ...extra }, exec('project_deliver'));
  const reply = async (id, interrupted = false) => { const event = append('assistant/message', { turn, interrupted, message: { id, content: [{ type: 'text', text: 'Visible useful result.' }] } }); await service.assistantReply(session, event); };
  const end = async kind => { const event = append('turn/end', { turn, reason: { kind } }); await service.assistantReply(session, event); };
  return { service, state, project, actor, session, events, human, exec, accept, add, declare, reply, end, flushes: () => flushes, persist(value) { persist = value; } };
}

test('all consumed human inputs retain their order; independent goals and revisions preserve source authority', async () => {
  const f = fixture(); f.human(['Investigate and fix login', 'Preserve the existing credentials']);
  const { request } = await f.accept({});
  assert.deepEqual(request.versions[0].inputs.map(row => row.text), ['Investigate and fix login', 'Preserve the existing credentials']);
  const source = f.service.source(f.actor, f.exec('project_delegate'));
  assert.deepEqual(source.inputs.map(row => row.messageId), ['human-1-0', 'human-1-1']);
  f.human(['Also support empty passwords', 'Unrelated: document the API']);
  const revised = (await f.accept({ requestId: request.id, messageIds: ['human-2-0'] })).request;
  const independent = (await f.accept({ goal: 'Document the API', authorization: 'docs', messageIds: ['human-2-1'] })).request;
  assert.equal(revised.currentVersion, 2); assert.equal(revised.versions[0].inputs.length, 2);
  assert.deepEqual(revised.versions[1].inputs.map(row => row.text), ['Investigate and fix login', 'Preserve the existing credentials', 'Also support empty passwords']);
  assert.notEqual(revised.id, independent.id); assert.deepEqual(independent.versions[0].inputs.map(row => row.text), ['Unrelated: document the API']);
  await assert.rejects(f.accept({ messageIds: ['fabricated'] }), { code: 'unauthorized' });
});

test('stages retain original authority on a native notification; readonly cannot silently become development', async () => {
  const f = fixture(); f.human(['Investigate, fix and verify']); const { request } = await f.accept({});
  f.events.push({ seq: f.events.length, type: 'turn/start', data: { turn: 2 } }, { seq: f.events.length + 1, type: 'user/message', data: { id: 'settlement', source: { kind: 'subagent-settled' }, content: [] } });
  const source = f.service.requirements.source(f.actor, f.exec('project_delegate'), request.id);
  assert.doesNotThrow(() => f.service.requirements.authorize(source, 'readonly', []));
  assert.doesNotThrow(() => f.service.requirements.authorize(source, 'worker', []));
  f.human(['Only investigate this independent error']); const readonly = (await f.accept({ authorization: 'readonly' })).request;
  const restricted = f.service.requirements.source(f.actor, f.exec('project_delegate'), readonly.id);
  assert.throws(() => f.service.requirements.authorize(restricted, 'worker', []), { code: 'unauthorized' });
  await f.service.write(state => { state.projects[0].paused = true; }); assert.throws(() => f.service.requirements.source(f.actor, f.exec('project_delegate'), request.id), { code: 'stopped' });
});

test('reading facts and replying progress never deliver; declaration waits for completed turn and confirmed persistence', async () => {
  const f = fixture(); f.human(['Fix login']); const { request } = await f.accept({}), result = f.add(request);
  f.service.consume('lead', 1, [{ id: result.work.id, reports: [result.receipt.ref], runs: [result.receipt.runId] }]);
  await f.reply('progress'); assert.equal(result.work.pendingSummary, true); assert.equal(f.state.deliveries, undefined);
  await f.declare(request, [result.ref]); await f.reply('final');
  assert.equal(f.state.workstreams[0].pendingSummary, true); assert.equal(f.flushes(), 0);
  await f.end('completed'); assert.equal(f.flushes(), 1);
  const delivery = f.state.deliveries[0]; assert.equal(delivery.messageId, 'final'); assert.ok(delivery.committedAt);
  assert.equal(f.state.workstreams[0].pendingSummary, false); assert.equal(f.state.workstreams[0].latestReport.summarizedBy, 'final');
  await f.service.requirements.reconcile(f.session); assert.equal(f.flushes(), 1); assert.equal(f.state.deliveries.length, 1);
});

test('missing persistence keeps results pending; durable reply reconciliation recovers without worker execution', async () => {
  const f = fixture(); f.human(['Fix login']); const { request } = await f.accept({}), result = f.add(request);
  await f.declare(request, [result.ref]); await f.reply('preserved'); f.persist(false); await f.end('completed');
  assert.equal(f.state.workstreams[0].pendingSummary, true); assert.equal(f.state.deliveries[0].committedAt, undefined); assert.match(f.state.deliveries[0].error, /persistent Session listener/);
  f.persist(true); await f.service.requirements.reconcile(f.session);
  assert.equal(f.state.workstreams[0].pendingSummary, false); assert.equal(f.state.deliveries[0].messageId, 'preserved'); assert.ok(f.state.deliveries[0].committedAt);
  assert.equal(f.state.workstreams.length, 1); assert.equal(f.state.workstreams[0].delegations.length, 1);
});

test('revision, missing required result, unsettled work and interrupted replies cannot create complete delivery', async () => {
  for (const kind of ['revision', 'missing', 'unsettled', 'interrupted']) {
    const f = fixture(); f.human(['Fix login']); const { request } = await f.accept({}), result = f.add(request);
    if (kind === 'missing') { await assert.rejects(f.declare(request, []), { code: 'delivery_incomplete' }); continue; }
    if (kind === 'unsettled') { result.work.settlements = []; await assert.rejects(f.declare(request, [result.ref]), { code: 'delivery_evidence' }); continue; }
    await f.declare(request, [result.ref]);
    if (kind === 'revision') { f.human(['Also verify empty passwords']); await f.accept({ requestId: request.id }); }
    else await f.reply('interrupted-result', true);
    await f.end('completed'); assert.equal(f.state.deliveries[0].committedAt, undefined); assert.equal(f.state.workstreams[0].pendingSummary, true);
  }
});

test('a new requirement reuses saved evidence without a worker, and changed execution identities require review', async () => {
  const f = fixture(); f.human(['Fix login']); const { request: original } = await f.accept({}), result = f.add(original);
  f.human(['Explain the saved login repair']); const { request: explanation } = await f.accept({ goal: 'Explain the saved repair', authorization: 'readonly' });
  await f.declare(explanation, [result.ref]); await f.reply('explanation'); await f.end('completed');
  const delivery = f.state.deliveries[0];
  assert.deepEqual(delivery.requiredWork, []); assert.equal(f.state.workstreams.length, 1);
  assert.equal(f.service.requirements.deliveryView(delivery).needsReview, false);
  for (const change of ['delegation', 'run', 'report']) {
    const work = f.state.workstreams[0], receipt = work.delegations[0];
    const saved = { current: work.currentDelegationRef, run: receipt.runId, report: receipt.report.callId };
    if (change === 'delegation') work.currentDelegationRef = 'next-assignment';
    if (change === 'run') receipt.runId = 'next-run';
    if (change === 'report') receipt.report.callId = 'replacement-report';
    const view = f.service.requirements.deliveryView(delivery);
    assert.equal(view.current, true, 'the historical delivery retains its own requirement version');
    assert.equal(view.needsReview, true, `${change} changes invalidate reused evidence applicability`);
    work.currentDelegationRef = saved.current; receipt.runId = saved.run; receipt.report.callId = saved.report;
  }
  assert.equal(f.service.requirements.views('project').find(row => row.id === original.id).delivery, null, 'the second requirement does not complete the first');
});

test('duplicate declaration and failed flush preserve a single delivery for exact reply recovery', async () => {
  const f = fixture(); f.human(['Explain existing facts']); const { request } = await f.accept({ authorization: 'readonly' });
  const exec = f.exec('project_deliver'), args = { requestId: request.id, requestVersion: 1, outcome: 'completed', summary: 'Existing facts explained', references: [], evidence: [], remainingIssues: [] };
  await f.service.declareDelivery(f.actor, args, exec); await f.service.declareDelivery(f.actor, args, exec);
  assert.equal(f.state.deliveries.length, 1); await f.reply('exact-reply'); f.persist(new Error('disk persistence failed')); await f.end('completed');
  assert.equal(f.state.deliveries[0].committedAt, undefined); assert.match(f.state.deliveries[0].error, /disk persistence/);
  f.persist(true); await f.service.requirements.reconcile(f.session); await f.service.requirements.reconcile(f.session);
  assert.equal(f.state.deliveries.length, 1); assert.equal(f.state.deliveries[0].messageId, 'exact-reply'); assert.ok(f.state.deliveries[0].committedAt);
});

test('one requirement delivers its investigation, repair and verification together; later head changes require review', async () => {
  const f = fixture(); f.human(['Investigate, repair and verify the same objective']); const { request } = await f.accept({}), first = f.add(request), refs = [first.ref];
  for (const stage of ['repair', 'verification']) {
    const receipt = { ...first.receipt, ref: stage, runId: `run-${stage}`, scope: stage === 'repair' ? 'docs' : 'readonly', report: { ...first.receipt.report, delegationRef: stage, callId: `report-${stage}` } };
    first.work.delegations.push(receipt); first.work.settlements.push({ runId: receipt.runId, delegationRefs: [stage], stopReason: 'completed', summarizedBy: '' });
    first.work.currentDelegationRef = stage; first.work.latestReport = receipt.report; f.service.requirements.bind(f.state, receipt, first.work.id);
    refs.push({ workstreamId: first.work.id, delegationRef: stage, runId: receipt.runId, reportId: receipt.report.callId });
  }
  await f.declare(request, refs); await f.reply('all-stages-delivered'); await f.end('completed');
  const delivery = f.state.deliveries[0]; assert.ok(delivery.committedAt); assert.equal(delivery.references.length, 3);
  assert.equal(f.service.requirements.deliveryView(delivery).needsReview, false); assert.equal(f.state.workstreams[0].pendingSummary, false);
  assert.equal(f.state.workstreams[0].delegations.every(row => row.report.summarizedBy === 'all-stages-delivered'), true);
  f.state.workstreams[0].currentDelegationRef = 'later-execution';
  assert.equal(f.service.requirements.deliveryView(delivery).needsReview, true);
});

test('evidence obsolete before a no-worker delivery remains reviewable, and a change during reply cannot commit', async () => {
  const f = fixture(); f.human(['Repair login']); const { request: original } = await f.accept({}), result = f.add(original);
  const next = { ...result.receipt, ref: 'new-assignment', runId: 'new-run', report: { ...result.receipt.report, delegationRef: 'new-assignment', callId: 'new-report' } };
  result.work.delegations.push(next); result.work.currentDelegationRef = next.ref;
  f.human(['Explain the prior saved finding']); const { request: explanation } = await f.accept({ authorization: 'readonly' });
  await f.declare(explanation, [result.ref]); await f.reply('prior-finding'); await f.end('completed');
  const delivery = f.state.deliveries[0]; assert.ok(delivery.committedAt); assert.deepEqual(delivery.requiredWork, []);
  assert.equal(f.service.requirements.deliveryView(delivery).needsReview, true); assert.equal(f.state.workers.length, 1);
  f.human(['Explain again']); const { request: again } = await f.accept({ authorization: 'readonly' });
  await f.declare(again, [result.ref]); await f.reply('changed-before-flush'); f.state.workstreams[0].currentDelegationRef = 'third-assignment'; await f.end('completed');
  assert.equal(f.state.deliveries[1].committedAt, undefined); assert.match(f.state.deliveries[1].error, /execution changed/);
});
