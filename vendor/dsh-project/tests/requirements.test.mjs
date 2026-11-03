import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectService } from './harness-runtime.mjs';

function fixture() {
  const events = [], followups = [], project = { id: 'project', coordinatorSessionId: 'lead', storageRoot: '/project-materials', lifecycle: 'ready', paused: false, diagnostics: [], updatedAt: 0 };
  const session = { id: 'lead', snapshotEvents: () => events }, lead = { id: 'lead', session, status: 'idle', cancel() {}, followup: message => followups.push(message) }, state = { revision: 0, projects: [project], workstreams: [], workers: [] };
  let persist = true, flushes = 0, durableEvents = [];
  const ctx = { agents: new Map([['lead', lead]]), logger: { warn() {} }, get: () => undefined, sessions: { flush: async () => { flushes++; if (persist instanceof Error) throw persist; if (persist) durableEvents = structuredClone(events); return persist; } }, sessionPersistence: { stat: async () => ({}), open: async () => ({ read: async () => ({ events: durableEvents }), close: async () => {} }) }, subagents: { registerContinuationPolicy: () => () => {}, drainChildren: async () => {} }, agentTeams: { registerPolicy: () => () => {}, listTasks: () => [] } };
  ctx.sessionController = { resolveAgent: async id => ({ agent: ctx.agents.get(id) }) };
  const service = new ProjectService(ctx, { get: () => state, update: async (_key, change) => Object.assign(state, change(state)) }, { home: '', desktop: async () => ({}) });
  service.recovering = false; service.notes = async () => {};
  service.teams.cancelMessages = async () => {}; service.teams.setCold = async () => {};
  const actor = service.actor(lead), signal = new AbortController().signal;
  const append = (type, data) => { const event = { seq: events.length, time: Date.now(), type, data }; events.push(event); return event; };
  let turn = 0;
  const human = texts => { turn++; lead.status = 'running'; append('turn/start', { turn }); texts.forEach((text, index) => append('user/message', { id: `human-${turn}-${index}`, source: { kind: 'user' }, content: [{ type: 'text', text }] })); if (texts.length) service.userTurns.set(lead.id, { agent: lead, turn }); };
  const activate = message => { human([]); append('user/message', message); };
  const exec = name => { const callId = `call-${events.length}`; append('tool/call', { turn, callId, name }); return { signal, callId }; };
  const result = (execution, value) => append('tool/result', { turn, message: { toolCallId: execution.callId, isError: false, content: [{ type: 'text', text: JSON.stringify(value) }] } });
  const publish = ({ nested = false, title = 'Evidence diagram', failed = false, name = 'html_render' } = {}) => {
    const execution = exec(nested ? 'run_code' : name), callId = nested ? `${execution.callId}:ptc:1` : execution.callId;
    const file = { attachmentId: `sha256:${callId}`, name: 'visual-reply.html', bytes: 120 }, height = nested ? 480 : 320;
    const content = [{ type: 'text', text: 'Visual reply published' }, { type: 'file', attachment: file }];
    if (nested) append('tool/ptc-dispatch', { rootCallId: execution.callId, parentCallId: execution.callId, subCallId: callId,
      name, arguments: { html: '<!doctype html><html></html>', title }, isError: failed, content });
    else append('tool/result', { turn, message: { toolCallId: callId, isError: failed, content }, meta: { visualReply: { version: 1, title, height } } });
    return { sessionId: session.id, callId, file, title, height };
  };
  const accept = async args => { const execution = exec('project_request'); const value = await service.acceptRequest(actor, { goal: 'Repair and validate login', scopeCeiling: 'development', conditions: ['Login works'], constraints: ['Preserve user work'], ...args }, execution); result(execution, value); return { request: state.requests.find(row => row.id === value.id) }; };
  const add = (request, outcome = 'completed') => {
    const id = `work-${state.workstreams.length}`, ref = `ref-${id}`, runId = `run-${id}`, report = { delegationRef: ref, callId: `report-${id}`, outcome, summary: 'Actual worker finding', artifacts: [], evidence: ['Observed result'], remainingIssues: [], at: Date.now() };
    const receipt = { ref, runId, phase: 'accepted', scope: 'readonly', report, source: { ...service.requirements.version(request).source }, writePaths: [] };
    const work = { id, title: id, status: 'done', updatedAt: Date.now(), projectId: project.id, workerSessionId: `member-${id}`, currentDelegationRef: ref, delegations: [receipt], settlements: [{ runId, delegationRefs: [ref], stopReason: 'completed', summarizedBy: '' }], pendingSummary: true, latestReport: report };
    state.workstreams.push(work); state.workers.push({ sessionId: work.workerSessionId, workstreamId: id, projectId: project.id, stopped: false, phase: 'idle' });
    return { get work() { return state.workstreams.find(row => row.id === id); }, get receipt() { return this.work.delegations.find(row => row.ref === ref); }, ref: { workstreamId: id, delegationRef: ref, runId, reportId: report.callId } };
  };
  const declare = async (request, refs, extra = {}) => { const execution = exec('project_deliver'); const value = await service.deliver(actor, { requestId: request.id, requestRevision: request.revision, outcome: 'completed', summary: 'The required result is available.', reportRefs: refs.filter(row => row.reportId).map(({ workstreamId, delegationRef, reportId }) => ({ workstreamId, delegationRef, reportId })), terminalRefs: refs.map(({ workstreamId, delegationRef, runId }) => ({ workstreamId, delegationRef, runId })), evidence: ['Actual worker evidence; no independent UI claim'], remainingIssues: [], ...extra }, execution); result(execution, value); return value; };
  const reply = async (id, interrupted = false) => { const event = append('assistant/message', { turn, interrupted, message: { id, content: [{ type: 'text', text: 'Visible useful result.' }] } }); await service.assistantReply(session, event); };
  const end = async kind => { const event = append('turn/end', { turn, reason: { kind } }); try { await service.assistantReply(session, event); } finally { lead.status = 'idle'; } };
  const queue = (request, action, extra = {}) => service.command('requests/queue', { projectId: project.id, requestId: request.id, requestRevision: request.revision, action, ...extra });
  return { service, state, project, actor, session, events, followups, human, activate, exec, result, publish, accept, add, declare, reply, end, queue, flushes: () => flushes, persist(value) { persist = value; }, checkpoint() { durableEvents = structuredClone(events); } };
}

test('an empty optional request identity creates a stable nonempty requirement and retries remain idempotent', async () => {
  const f = fixture(); f.human(['Implement the original goal']);
  const execution = f.exec('project_request'), args = { requestId: '', goal: 'Original goal', title: 'Original goal', conditions: ['Original result'], scopeCeiling: 'development' };
  const first = await f.service.acceptRequest(f.actor, args, execution), retry = await f.service.acceptRequest(f.actor, args, execution);
  assert.match(first.id, /^request-[a-f0-9]{64}$/); assert.equal(retry.id, first.id);
  assert.equal(f.state.requests.length, 1); assert.equal(f.state.requests[0].versions.length, 1);
  assert.equal(f.state.requests[0].versions[0].source.requestId, first.id);
  f.human(['A separate user goal']); const { request: separate } = await f.accept({ requestId: '' });
  assert.notEqual(separate.id, first.id, 'a later blank optional ID cannot silently revise the earlier goal');
  f.human(['Revise the original goal']); await f.accept({ requestId: first.id, goal: 'Revised original goal' });
  assert.equal(f.service.requirements.get(f.project.id, first.id).revision, 2);
  assert.equal(f.state.requests.length, 2);
});

test('optional identity validation rejects malformed values before any requirement is persisted', async () => {
  for (const requestId of ['   ', 0, false, {}, 'x'.repeat(201)]) {
    const f = fixture(); f.human(['A real user request']);
    await assert.rejects(f.accept({ requestId }), error => error.code === 'invalid_request');
    assert.equal(f.state.requests, undefined);
  }
});

test('a blank delegation identity retains the existing direct-human assignment contract', async () => {
  const f = fixture(); f.human(['Investigate the original goal']); const { request } = await f.accept({});
  const execution = f.exec('project_delegate');
  const assignment = await f.service.requirements.assignment(f.actor, { requestId: '', requestRevision: 1, scope: 'readonly' }, execution);
  assert.equal(assignment.request.id, request.id); assert.equal(assignment.source.requestId, request.id);
  assert.equal(assignment.source.authorizationCallId, request.versions[0].source.authorizationCallId);
  assert.equal(assignment.source.callId, execution.callId); assert.equal(f.state.requests.length, 1);
  await assert.rejects(f.service.requirements.assignment(f.actor, { requestId: '   ', scope: 'readonly' }, execution), error => error.code === 'invalid_request');
});

test('delivery end trees finish before public enqueue can activate the next requirement', async () => {
  const f = fixture(); f.human(['Implement A']);
  const { request: a } = await f.accept({ title: 'A' }), work = f.add(a);
  const { request: b } = await f.accept({ title: 'B', disposition: 'discussing' });
  f.state.requests.find(row => row.id === a.id).changes = { isGit: true, baseline: 'a'.repeat(40), capturedAt: 1 };
  let release, startedResolve, captures = 0;
  const started = new Promise(resolve => { startedResolve = resolve; });
  f.service.desktop = async action => {
    assert.equal(action, 'changes'); captures++; startedResolve();
    return new Promise(resolve => { release = resolve; });
  };
  await f.declare(a, [work.ref]); await f.reply('A reply');
  const finishing = f.end('completed'); await started;
  const enqueuing = f.queue(b, 'enqueue');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.state.deliveries[0].status, 'draft', 'completion is not exposed before its end tree');
  assert.equal(f.state.requests.find(row => row.id === a.id).queue.released, undefined);
  assert.equal(f.service.queue.active(f.project.id)?.id, a.id);
  assert.equal(f.followups.length, 0, 'the native queue cannot start B while the A capture awaits disk I/O');
  release({ end: 'b'.repeat(40), files: [{ path: 'A.txt', status: 'A', added: 1, removed: 0 }] });
  await Promise.all([finishing, enqueuing]);
  assert.equal(f.state.requests.find(row => row.id === a.id).changes.end, 'b'.repeat(40));
  assert.equal(f.service.queue.active(f.project.id)?.id, b.id);
  assert.equal(f.followups.length, 1);
  await f.service.afterDelivery(f.state.deliveries[0].id);
  assert.equal(captures, 1, 'later delivery callbacks cannot recapture B writes into A');
});

test('an end-tree failure keeps delivery pending and does not release the next writer', async () => {
  const f = fixture(); f.human(['Implement A']);
  const { request: a } = await f.accept({ title: 'A' }), work = f.add(a);
  const { request: b } = await f.accept({ title: 'B' });
  f.state.requests.find(row => row.id === a.id).changes = { isGit: true, baseline: 'a'.repeat(40), capturedAt: 1 };
  f.service.desktop = async () => { throw new Error('End tree capture failed'); };
  await f.declare(a, [work.ref]); await f.reply('A reply');
  await assert.rejects(f.end('completed'), /End tree capture failed/);
  await f.service.queue.pump(f.project.id);
  assert.equal(f.state.deliveries[0].status, 'draft');
  assert.match(f.state.deliveries[0].error, /End tree capture failed/);
  assert.equal(f.service.queue.active(f.project.id)?.id, a.id);
  assert.equal(f.service.requirements.get(f.project.id, b.id).queue.state, 'queued');
  assert.equal(f.followups.length, 0);
});

test('empty Project history still supplies the authoritative bound repository in notes and Lead context', async () => {
  const f = fixture();
  Object.assign(f.project, { title: 'Existing repository', canonicalWorkingDirectory: '/existing-repository' });
  f.service.workRows = async () => [];
  f.service.readStore = async () => ({ userText: '' });
  const notes = await f.service.readStoreTool(f.actor, { path: 'notes.md' });
  assert.equal(notes.project.title, 'Existing repository');
  assert.equal(notes.project.canonicalWorkingDirectory, '/existing-repository');
  assert.equal(notes.project.storageRoot, '/project-materials');
  assert.equal(notes.project.lifecycle, 'ready');
  assert.equal(notes.project.activity.state, 'idle');
  assert.deepEqual(notes.requests, []); assert.deepEqual(notes.work, []); assert.equal(notes.userNotes, '');
  const context = f.service.contextFor(f.actor.agent.id);
  const facts = JSON.parse(context.split('\n')[1]);
  assert.deepEqual(facts, notes.project);
  assert.equal(f.service.contextFor('unrelated-session'), '');
  f.actor.agent.status = 'running';
  assert.equal(JSON.parse(f.service.contextFor(f.actor.agent.id).split('\n')[1]).activity.state, 'running', 'context reflects the current host facts');
  assert.equal(notes.project.activity.state, 'idle', 'tool replies retain their own snapshot');
});

test('authority requirements page their original goals by Project without mutating authorization', async () => {
  const f = fixture();
  for (let i = 0; i < 25; i++) {
    const id = `saved-${String(i).padStart(2, '0')}`; f.human([`Original human goal ${i}`]);
    const { request } = await f.accept({ title: `Saved goal ${i}`, goal: `Original full goal ${i}` });
    Object.assign(request, { id, updatedAt: Math.floor(i / 2) }); f.service.requirements.version(request).authorityError = `Original input missing ${i}`;
  }
  f.human(['Verified normal request']); const { request: normal } = await f.accept({}); Object.assign(normal, { id: 'verified-normal', updatedAt: 1000 });
  f.state.requests.push({ ...structuredClone(f.state.requests[0]), id: 'foreign-goal', projectId: 'other-project', updatedAt: 2000 });
  const before = structuredClone(f.state), read = cursor => f.service.command('store/list', { projectId: f.project.id, kind: 'requests', ...(cursor ? { cursor } : {}) });
  const first = (await read()).requests, second = (await read(first.nextCursor)).requests, third = (await read(second.nextCursor)).requests;
  assert.equal(first.total, 25); assert.deepEqual([first.items.length, second.items.length, third.items.length], [10, 10, 5]); assert.equal(third.nextCursor, null);
  const expected = ['saved-24', ...Array.from({ length: 12 }, (_, i) => [String(22 - i * 2).padStart(2, '0'), String(23 - i * 2).padStart(2, '0')]).flat().map(id => `saved-${id}`)];
  const all = [...first.items, ...second.items, ...third.items]; assert.deepEqual(all.map(row => row.id), expected);
  assert.equal(all[0].goal, 'Original full goal 24'); assert.equal(all[0].authorityError, 'Original input missing 24');
  await assert.rejects(read('foreign-goal'), { code: 'request_cursor' }); await assert.rejects(read(normal.id), { code: 'request_cursor' });
  assert.deepEqual(f.state, before, 'Reading original requirements cannot restore authority, revise requests or start work');
});

test('an empty requestId records a new requirement with a durable identity', async () => {
  const f = fixture(); f.human(['Fix login']);
  const { request } = await f.accept({ requestId: '' });
  assert.ok(request.id.startsWith('request-'), 'an empty identity is never persisted');
  assert.equal(request.versions[0].source.requestId, request.id);
});

test('all consumed human inputs retain their order; independent goals and revisions preserve source authority', async () => {
  const f = fixture(); f.human(['Investigate and fix login', 'Preserve the existing credentials']);
  const { request } = await f.accept({});
  assert.deepEqual(request.versions[0].source.messageIds, ['human-1-0', 'human-1-1']);
  assert.equal(request.versions[0].source.text, 'Investigate and fix login\n\nPreserve the existing credentials');
  const source = f.service.source(f.actor, f.exec('project_delegate'));
  assert.deepEqual(source.messageIds, ['human-1-0', 'human-1-1']);
  f.human(['Also support empty passwords']);
  const revised = (await f.accept({ requestId: request.id })).request;
  f.human(['Unrelated: document the API']);
  const independent = (await f.accept({ goal: 'Document the API', scopeCeiling: 'docs' })).request;
  assert.equal(revised.revision, 2); assert.equal(revised.versions[0].source.messageIds.length, 2);
  assert.equal(revised.versions[1].source.text, 'Also support empty passwords');
  assert.notEqual(revised.id, independent.id); assert.equal(independent.versions[0].source.text, 'Unrelated: document the API');
  f.human([]);
  await assert.rejects(f.accept({}), { code: 'unauthorized' });
});

test('a stop while implicit acceptance is queued cannot save a request or delegate work', async () => {
  const f = fixture(); f.human(['Inspect the repository']);
  f.actor.agent.cancel = () => {};
  f.service.teams.cancelMessages = async () => {};
  let release, announce;
  const gate = new Promise(done => { release = done; }), queued = new Promise(done => { announce = done; });
  const serial = f.service.serial.bind(f.service); let calls = 0;
  f.service.serial = work => {
    if (++calls === 1) { serial(() => gate); announce(); } // Immediately before implicit acceptance's authoritative transaction.
    return serial(work);
  };
  const delegation = f.service.delegate(f.actor, { scope: 'readonly', brief: 'Inspect only' }, f.exec('project_delegate'));
  const rejection = assert.rejects(delegation, { code: 'stopped' });
  await queued;
  const stopping = f.service.stop(f.project.id); release();
  await Promise.all([rejection, stopping]);
  assert.equal(f.state.requests, undefined);
  assert.equal(f.state.revision, 1, 'only the durable pause writes; stopped acceptance does not revise the catalog');
  assert.equal(f.state.workstreams.length, 0); assert.equal(f.state.workers.length, 0);
  f.human(['Explicitly continue the inspection']);
  assert.equal((await f.accept({ scopeCeiling: 'readonly' })).request.revision, 1, 'a fresh actual human input can still accept work');
});

test('queued request revisions recheck cancellation while held existing acceptance remains an idempotent replay', async () => {
  const f = fixture(); f.human(['Inspect the repository']);
  const args = { goal: 'Inspect', scopeCeiling: 'readonly' }, originalExec = f.exec('project_request');
  const request = await f.service.acceptRequest(f.actor, args, originalExec);
  f.service.projectHolds.set(f.project.id, f.state.requests[0].versions[0].source.messageId);
  const revision = f.state.revision;
  assert.deepEqual(await f.service.acceptRequest(f.actor, args, originalExec), request);
  assert.equal(f.state.revision, revision, 'replaying a saved call after a stop does not rewrite it');
  f.human(['Continue with an additional finding']);
  let release; const gate = new Promise(done => { release = done; });
  const blocking = f.service.serial(() => gate), controller = new AbortController();
  const exec = { ...f.exec('project_request'), signal: controller.signal };
  const acceptance = f.service.acceptRequest(f.actor, { ...args, requestId: request.id }, exec);
  const rejected = assert.rejects(acceptance, { name: 'AbortError' });
  controller.abort(); release(); await Promise.all([blocking, rejected]);
  assert.equal(f.state.requests.length, 1); assert.equal(f.state.requests[0].revision, 1);
  assert.equal(f.state.revision, revision, 'a cancelled queued acceptance cannot save a requirement revision');
  const continued = (await f.accept({ ...args, requestId: request.id })).request;
  assert.equal(continued.revision, 2);
  assert.equal(continued.versions[0].source.text, 'Inspect the repository');
  assert.equal(continued.versions[1].source.text, 'Continue with an additional finding');
});

test('a hold established immediately after accepted authority blocks delegation before dependency or work preparation', async () => {
  const f = fixture(); f.human(['Inspect the repository']);
  const assignment = f.service.requirements.assignment.bind(f.service.requirements);
  f.service.requirements.assignment = async (...args) => { const accepted = await assignment(...args); f.service.projectHolds.set(f.project.id, accepted.source.messageId); return accepted; };
  let preparation = 0; f.service.desktop = async () => { preparation++; return {}; };
  const execution = f.exec('project_delegate');
  await assert.rejects(f.service.delegate(f.actor, { title: 'Inspect', brief: 'Inspect only', scope: 'readonly' }, execution), { code: 'stopped' });
  assert.equal(f.state.requests.length, 1, 'already accepted authority remains saved');
  assert.equal(f.state.workstreams.length, 0); assert.equal(f.state.workers.length, 0); assert.equal(preparation, 0);
});

test('stages retain original authority on a native notification; readonly cannot silently become development', async () => {
  const f = fixture(); f.human(['Investigate, fix and verify']); const { request } = await f.accept({});
  const result = f.add(request); f.human([]);
  f.events.push({ seq: f.events.length, type: 'user/message', data: { id: 'settlement', source: { kind: 'subagent-settled', senderSessionId: result.work.workerSessionId, runId: result.receipt.runId }, content: [] } });
  const assignment = args => f.service.requirements.assignment(f.actor, { requestId: request.id, requestRevision: request.revision, ...args }, f.exec('project_delegate'));
  assert.equal((await assignment({ scope: 'readonly' })).source.authorizationCallId, request.versions[0].source.authorizationCallId);
  assert.equal((await assignment({ scope: 'development' })).source.authorizationCallId, request.versions[0].source.authorizationCallId);
  await f.service.write(state => { state.projects[0].paused = true; }); await assert.rejects(assignment({ scope: 'development' }), { code: 'unauthorized' });
  f.state.projects[0].paused = false;
  await f.declare(request, [result.ref]); await f.reply('investigation-delivered'); await f.end('completed');
  f.human(['Only investigate this independent error']); const readonly = (await f.accept({ scopeCeiling: 'readonly' })).request;
  await assert.rejects(f.service.requirements.assignment(f.actor, { requestId: readonly.id, requestRevision: readonly.revision, scope: 'development' }, f.exec('project_delegate')), { code: 'unauthorized' });
});

test('reading facts and replying progress never deliver; declaration waits for completed turn and confirmed persistence', async () => {
  const f = fixture(); f.human(['Fix login']); const { request } = await f.accept({}), result = f.add(request);
  f.service.consume('lead', 1, [{ id: result.work.id, reports: [result.receipt.ref], runs: [result.receipt.runId] }]);
  await f.reply('progress'); assert.equal(result.work.pendingSummary, true); assert.deepEqual(f.state.deliveries, []);
  await f.declare(request, [result.ref]); await f.reply('final');
  assert.equal(f.state.workstreams[0].pendingSummary, true); assert.equal(f.flushes(), 0);
  await f.end('completed'); assert.equal(f.flushes(), 1);
  const delivery = f.state.deliveries[0]; assert.equal(delivery.replyMessageId, 'final'); assert.equal(delivery.status, 'delivered');
  assert.equal(f.state.workstreams[0].pendingSummary, false); assert.equal(f.state.workstreams[0].latestReport.summarizedBy, 'final');
  await f.service.requirements.reconcile(f.project); assert.equal(f.flushes(), 1); assert.equal(f.state.deliveries.length, 1);
});

test('missing persistence keeps results pending; durable reply reconciliation recovers without worker execution', async () => {
  const f = fixture(); f.human(['Fix login']); const { request } = await f.accept({}), result = f.add(request);
  await f.declare(request, [result.ref]); await f.reply('preserved'); f.persist(false); await assert.rejects(f.end('completed'), /No native Session persistence/);
  assert.equal(f.state.workstreams[0].pendingSummary, true); assert.equal(f.state.deliveries[0].status, 'draft'); assert.match(f.state.deliveries[0].error, /No native Session persistence/);
  await f.service.requirements.reconcile(f.project);
  assert.equal(f.state.deliveries[0].status, 'draft', 'an attached reply absent from the durable prefix cannot recover a delivery');
  f.persist(true); f.checkpoint(); await f.service.requirements.reconcile(f.project);
  assert.equal(f.state.workstreams[0].pendingSummary, false); assert.equal(f.state.deliveries[0].replyMessageId, 'preserved'); assert.equal(f.state.deliveries[0].status, 'delivered');
  assert.equal(f.state.workstreams.length, 1); assert.equal(f.state.workstreams[0].delegations.length, 1);
  f.state.deliveries.push({ ...f.state.deliveries[0], id: 'later-unproven-history', at: Date.now() + 1, status: 'historical', error: 'The later saved declaration has no native acceptance.' });
  const projected = await f.service.command('detail', { projectId: f.project.id });
  assert.equal(projected.project.activity.state, 'summaryFailed', 'an older successful delivery cannot hide the latest unproven handover');
  assert.equal(projected.project.currentRequests[0].handoverError, f.state.deliveries.at(-1).error);
  assert.equal(f.service.requirements.deliveries(f.project.id).items[0].status, 'historical');
});

test('handover pages use only successful native and PTC publications from this exact Lead turn', async () => {
  const f = fixture(); f.human(['Explain an earlier result']); f.publish({ title: 'Older unrelated diagram' }); await f.end('completed');
  assert.equal((f.state.deliveries ?? []).length, 0, 'publishing a page alone never declares a handover');
  f.human(['Repair login']); const { request } = await f.accept({}), work = f.add(request);
  const native = f.publish({ title: 'Native evidence' }), nested = f.publish({ nested: true, title: 'PTC evidence' });
  f.publish({ failed: true }); f.publish({ nested: true, failed: true });
  f.publish({ name: 'other_tool' }); f.publish({ nested: true, name: 'other_tool' });
  await f.declare(request, [work.ref], { pages: [{ sessionId: 'guessed-session', file: { attachmentId: 'guessed-id' } }] });
  await f.reply('actual-final'); await f.end('completed');
  const delivery = f.state.deliveries[0];
  assert.deepEqual(delivery.pages, [native, nested]);
  assert.deepEqual((await f.service.command('requests/get', { projectId: f.project.id, requestId: request.id })).card.delivery.pages, [native, nested]);
  assert.deepEqual((await f.service.command('store/list', { projectId: f.project.id, kind: 'deliveries' })).deliveries.items[0].pages, [native, nested]);
});

test('pages published after the declaration are not attached to an earlier handover', async () => {
  const f = fixture(); f.human(['Repair login']); const { request } = await f.accept({}), work = f.add(request);
  await f.declare(request, [work.ref]);
  f.publish({ title: 'Published after the declared handover' }); f.publish({ nested: true });
  await f.reply('actual-final'); await f.end('completed');
  assert.equal(f.state.deliveries[0].status, 'delivered');
  assert.deepEqual(f.state.deliveries[0].pages, []);
});

test('same-turn revised handovers retain their own publication identities without reusing already claimed pages', async () => {
  const f = fixture(); f.human(['Explain the first result']);
  const first = (await f.accept({ goal: 'Explain first result' })).request;
  const firstPage = f.publish({ title: 'First result' }); await f.declare(first, []);
  f.events.push({ seq: f.events.length, type: 'user/message', data: { id: 'same-turn-revision', source: { kind: 'user' }, content: [{ type: 'text', text: 'Also explain the second result' }] } });
  const second = (await f.accept({ requestId: first.id, goal: 'Explain both results' })).request;
  const secondPage = f.publish({ nested: true, title: 'Second result' }); await f.declare(second, []);
  await f.reply('two-results'); await f.end('completed');
  assert.deepEqual(f.state.deliveries.find(item => item.requestRevision === 1).pages, [firstPage]);
  assert.deepEqual(f.state.deliveries.find(item => item.requestRevision === 2).pages, [secondPage]);
  assert.equal(f.state.deliveries[0].status, 'obsolete'); assert.equal(f.state.deliveries[1].status, 'delivered');
});

test('durable reconciliation retains actual publications and cannot manufacture a page from an undurable reply', async () => {
  const f = fixture(); f.human(['Repair login']); const { request } = await f.accept({}), work = f.add(request);
  const page = f.publish({ title: 'Persisted evidence' }), nested = f.publish({ nested: true });
  await f.declare(request, [work.ref]); await f.reply('durable-final'); f.persist(false);
  await assert.rejects(f.end('completed'), /No native Session persistence/);
  await f.service.requirements.reconcile(f.project);
  assert.equal(f.state.deliveries[0].status, 'draft');
  f.persist(true); f.checkpoint(); await f.service.requirements.reconcile(f.project);
  assert.equal(f.state.deliveries[0].status, 'delivered');
  assert.deepEqual(f.state.deliveries[0].pages, [page, nested]);
  assert.equal(f.state.deliveries[0].replyMessageId, 'durable-final');
});

test('revision, missing required result, unsettled work and interrupted replies cannot create complete delivery', async () => {
  for (const kind of ['revision', 'missing', 'unsettled', 'interrupted']) {
    const f = fixture(); f.human(['Fix login']); const { request } = await f.accept({}), result = f.add(request);
    if (kind === 'missing') { await assert.rejects(f.declare(request, []), { code: 'result_missing' }); continue; }
    if (kind === 'unsettled') { result.work.settlements = []; await assert.rejects(f.declare(request, [result.ref]), { code: 'result_unsettled' }); continue; }
    await f.declare(request, [result.ref]);
    if (kind === 'revision') { f.human(['Also verify empty passwords']); await f.accept({ requestId: request.id }); }
    else await f.reply('interrupted-result', true);
    await f.end('completed'); assert.notEqual(f.state.deliveries[0].status, 'delivered'); assert.equal(f.state.workstreams[0].pendingSummary, true);
  }
});

test('a new requirement reuses saved evidence without a worker, and changed execution identities require review', async () => {
  const f = fixture(); f.human(['Fix login']); const { request: original } = await f.accept({}), result = f.add(original);
  f.human(['Explain the saved login repair']); const { request: explanation } = await f.accept({ goal: 'Explain the saved repair', scopeCeiling: 'readonly' });
  await f.queue(original, 'cancel');
  await f.declare(explanation, [result.ref]); await f.reply('explanation'); await f.end('completed');
  const delivery = f.state.deliveries[0];
  assert.deepEqual(delivery.requiredDelegations, []); assert.equal(f.state.workstreams.length, 1);
  assert.equal(f.service.requirements.applicable(delivery), true);
  for (const change of ['run', 'report']) {
    const work = f.state.workstreams[0], receipt = work.delegations[0];
    const saved = { current: work.currentDelegationRef, run: receipt.runId, report: receipt.report.callId };
    if (change === 'delegation') work.currentDelegationRef = 'next-assignment';
    if (change === 'run') receipt.runId = 'next-run';
    if (change === 'report') receipt.report.callId = 'replacement-report';
    assert.equal(delivery.requestRevision, explanation.revision, 'the historical delivery retains its own requirement revision');
    assert.equal(f.service.requirements.applicable(delivery), false, `${change} changes invalidate exact reused evidence applicability`);
    work.currentDelegationRef = saved.current; receipt.runId = saved.run; receipt.report.callId = saved.report;
  }
  assert.equal(f.service.requirements.handover(f.service.requirements.get(f.project.id, original.id)).completed, false, 'the second requirement does not complete the cancelled first goal');
  assert.deepEqual((await f.service.command('requests/list', { projectId: f.project.id, kind: 'cancelled' })).items.map(row => row.id), [original.id]);
});

test('duplicate declaration and failed flush preserve a single delivery for exact reply recovery', async () => {
  const f = fixture(); f.human(['Explain existing facts']); const { request } = await f.accept({ scopeCeiling: 'readonly' });
  const exec = f.exec('project_deliver'), args = { requestId: request.id, requestRevision: 1, outcome: 'completed', summary: 'Existing facts explained', reportRefs: [], evidence: [], remainingIssues: [] };
  const value = await f.service.deliver(f.actor, args, exec); await f.service.deliver(f.actor, args, exec); f.result(exec, value);
  assert.equal(f.state.deliveries.length, 1); await f.reply('exact-reply'); f.persist(new Error('disk persistence failed')); await assert.rejects(f.end('completed'), /disk persistence failed/);
  assert.equal(f.state.deliveries[0].status, 'draft'); assert.match(f.state.deliveries[0].error, /disk persistence/);
  f.persist(true); f.checkpoint(); await f.service.requirements.reconcile(f.project); await f.service.requirements.reconcile(f.project);
  assert.equal(f.state.deliveries.length, 1); assert.equal(f.state.deliveries[0].replyMessageId, 'exact-reply'); assert.equal(f.state.deliveries[0].status, 'delivered');
});

test('one requirement delivers its investigation, repair and verification together; later head changes require review', async () => {
  const f = fixture(); f.human(['Investigate, repair and verify the same objective']); const { request } = await f.accept({}), first = f.add(request), refs = [first.ref];
  for (const stage of ['repair', 'verification']) {
    const receipt = { ...first.receipt, ref: stage, runId: `run-${stage}`, scope: stage === 'repair' ? 'docs' : 'readonly', report: { ...first.receipt.report, delegationRef: stage, callId: `report-${stage}` } };
    first.work.delegations.push(receipt); first.work.settlements.push({ runId: receipt.runId, delegationRefs: [stage], stopReason: 'completed', summarizedBy: '' });
    first.work.currentDelegationRef = stage; first.work.latestReport = receipt.report;
    refs.push({ workstreamId: first.work.id, delegationRef: stage, runId: receipt.runId, reportId: receipt.report.callId });
  }
  await f.declare(request, refs); await f.reply('all-stages-delivered'); await f.end('completed');
  const delivery = f.state.deliveries[0]; assert.equal(delivery.status, 'delivered'); assert.equal(delivery.reportRefs.length, 3);
  assert.equal(f.service.requirements.applicable(delivery), true); assert.equal(f.state.workstreams[0].pendingSummary, false);
  assert.equal(f.state.workstreams[0].delegations.every(row => row.report.summarizedBy === 'all-stages-delivered'), true);
  first.work.delegations.push({ ...first.receipt, ref: 'later-execution', runId: '', phase: 'queued', report: undefined });
  f.state.workstreams[0].currentDelegationRef = 'later-execution';
  assert.equal(f.service.requirements.applicable(delivery), false);
});

test('an explicit no-worker explanation preserves prior evidence while new required work during reply prevents commit', async () => {
  const f = fixture(); f.human(['Repair login']); const { request: original } = await f.accept({}), result = f.add(original);
  const next = { ...result.receipt, ref: 'new-assignment', runId: 'new-run', report: { ...result.receipt.report, delegationRef: 'new-assignment', callId: 'new-report' } };
  result.work.delegations.push(next); result.work.currentDelegationRef = next.ref;
  f.human(['Explain the prior saved finding']); const { request: explanation } = await f.accept({ scopeCeiling: 'readonly' });
  await f.queue(original, 'cancel');
  await f.declare(explanation, [result.ref]); await f.reply('prior-finding'); await f.end('completed');
  const delivery = f.state.deliveries[0]; assert.equal(delivery.status, 'delivered'); assert.deepEqual(delivery.requiredDelegations, []);
  assert.equal(f.service.requirements.applicable(delivery), true, 'an explicit explanation may use an unchanged prior receipt without recreating work'); assert.equal(f.state.workers.length, 1);
  f.human(['Continue the same repair']); const { request: again } = await f.accept({ requestId: original.id });
  await f.queue(again, 'enqueue');
  next.report = { ...next.report, outcome: 'completed' }; result.work.settlements.push({ runId: next.runId, delegationRefs: [next.ref], stopReason: 'completed', summarizedBy: '' });
  await f.declare(again, [{ workstreamId: result.work.id, delegationRef: next.ref, runId: next.runId, reportId: next.report.callId }]); await f.reply('changed-before-flush');
  result.work.delegations.push({ ...next, source: { ...again.versions.at(-1).source }, ref: 'third-assignment', runId: '', phase: 'queued', report: undefined }); result.work.currentDelegationRef = 'third-assignment'; await f.end('completed');
  assert.equal(f.state.deliveries[1].status, 'obsolete'); assert.match(f.state.deliveries[1].error, /Required work changed/);
});

test('Project activity and request work expose only owned live Jobs after the member turn stops', async () => {
  const f = fixture(); f.human(['Keep tracking the background verification']);
  const { request } = await f.accept(), result = f.add(request), worker = f.state.workers[0];
  f.service.ctx.agents.get('lead').status = 'idle';
  const jobs = [{ owner: worker.sessionId, status: 'running' }, { owner: worker.sessionId, status: 'stopping' },
    { owner: 'another-member', status: 'running' }, { owner: worker.sessionId, status: 'completed' }];
  f.service.ctx.get = name => name === 'jobs' ? { list: () => jobs } : undefined;
  let project = f.service.projectView(f.project);
  assert.equal(project.activity.running, 1, 'two Jobs count as one working member');
  assert.deepEqual(project.activity.runningJobSessionIds, [worker.sessionId]);
  let card = (await f.service.command('requests/get', { projectId: f.project.id, requestId: request.id })).card;
  assert.equal(card.work[0].runningJob, true); assert.equal(card.work[0].status, 'running');
  jobs[0].status = 'completed'; jobs[1].status = 'completed';
  project = f.service.projectView(f.project);
  assert.equal(project.activity.running, 0); assert.deepEqual(project.activity.runningJobSessionIds, []);
  card = (await f.service.command('requests/get', { projectId: f.project.id, requestId: request.id })).card;
  assert.equal(card.work[0].runningJob, false);
  assert.equal(card.status, 'pendingDelivery', 'a drained member report still awaits a durable whole-request delivery');
});

test('task cards group an actual request, team work and delivery; archive only changes their presentation', async () => {
  const f = fixture(); f.human(['Repair login and verify it']);
  const { request } = await f.accept({ title: 'Repair login' }), result = f.add(request);
  const current = await f.service.command('requests/list', { projectId: f.project.id, kind: 'current' });
  assert.equal(current.total, 1); assert.equal(current.items[0].id, request.id);
  assert.equal(current.items[0].workPreview[0].workstreamId, result.ref.workstreamId);
  assert.equal(current.items[0].workPreview[0].delegationRef, result.ref.delegationRef);
  assert.equal(current.items[0].workPreview[0].workerSessionId, result.work.workerSessionId);
  assert.equal(current.items[0].status, 'pendingDelivery', 'a completed member report does not deliver the whole request');
  assert.equal(current.items[0].members[0].status, 'completed', 'member status describes this request work, not global worker phase');
  const worker = f.state.workers[0];
  worker.phase = 'active'; worker.activeRunId = result.ref.runId;
  assert.equal((await f.service.command('requests/get', { projectId: f.project.id, requestId: request.id })).card.work[0].status, 'running', 'live execution is shown before an old completed receipt');
  worker.phase = 'stopping';
  assert.equal((await f.service.command('requests/get', { projectId: f.project.id, requestId: request.id })).card.work[0].status, 'stopping');
  worker.phase = 'idle'; delete worker.activeRunId;
  const report = result.receipt.report; result.receipt.report = undefined;
  assert.equal((await f.service.command('requests/get', { projectId: f.project.id, requestId: request.id })).card.work[0].status, 'blocked', 'a terminal without its report is not a pending delivery');
  result.receipt.report = report;
  assert.equal((await f.service.command('requests/get', { projectId: f.project.id, requestId: request.id })).card.versions[0].goal, request.versions[0].goal);
  await assert.rejects(f.service.command('requests/archive', { projectId: f.project.id, requestId: request.id }), { code: 'request_active' });

  await f.declare(request, [result.ref]); await f.reply('visible-result'); await f.end('completed');
  assert.equal((await f.service.command('requests/list', { projectId: f.project.id, kind: 'current' })).total, 0);
  const completed = (await f.service.command('requests/list', { projectId: f.project.id, kind: 'completed' })).items[0];
  assert.equal(completed.status, 'completed'); assert.equal(completed.delivery.applicable, true);
  const exact = (await f.service.command('requests/get', { projectId: f.project.id, requestId: request.id })).card;
  assert.equal(exact.delivery.reportRefs[0].reportId, result.ref.reportId);
  assert.equal(exact.work[0].reportAt, result.receipt.report.at);
  assert.equal(exact.work[0].terminalStopReason, 'completed');
  const before = structuredClone({ workstreams: f.state.workstreams, workers: f.state.workers, deliveries: f.state.deliveries });
  const archived = await f.service.command('requests/archive', { projectId: f.project.id, requestId: request.id });
  assert.equal(typeof archived.archivedAt, 'number');
  assert.equal((await f.service.command('requests/list', { projectId: f.project.id, kind: 'completed' })).total, 0);
  assert.equal((await f.service.command('requests/list', { projectId: f.project.id, kind: 'archived' })).items[0].id, request.id);
  assert.deepEqual({ workstreams: f.state.workstreams, workers: f.state.workers, deliveries: f.state.deliveries }, before);
  await f.service.command('requests/restore', { projectId: f.project.id, requestId: request.id });
  assert.equal((await f.service.command('requests/list', { projectId: f.project.id, kind: 'completed' })).total, 1);
  await f.service.command('requests/archive', { projectId: f.project.id, requestId: request.id });
  f.human(['Also verify empty passwords']); await f.accept({ requestId: request.id });
  assert.equal(f.state.requests[0].archivedAt, undefined, 'a new real human revision returns the same task card to the active list');
  assert.equal((await f.service.command('requests/list', { projectId: f.project.id, kind: 'current' })).items[0].revision, 2);
});

test('request card pages have stable identities and never archive an unproven result', async () => {
  const f = fixture();
  for (let index = 0; index < 12; index++) {
    f.human([`Goal ${index}`]); const { request } = await f.accept({ title: `Goal ${index}` });
    request.updatedAt = index;
  }
  const oldest = f.service.requirements.rows(f.project.id)[0];
  await f.declare(oldest, []); await f.reply('oldest-completed'); await f.end('completed');
  const first = await f.service.command('requests/list', { projectId: f.project.id, kind: 'current' });
  const second = await f.service.command('requests/list', { projectId: f.project.id, kind: 'current', cursor: first.nextCursor });
  assert.equal(first.total, 11); assert.deepEqual([first.items.length, second.items.length], [10, 1]);
  assert.equal(first.items[0].title, 'Goal 1'); assert.equal(second.nextCursor, null);
  const completed = await f.service.command('requests/list', { projectId: f.project.id, kind: 'completed' });
  assert.equal(completed.total, 1); assert.equal(completed.items[0].id, oldest.id);
  await assert.rejects(f.service.command('requests/list', { projectId: f.project.id, kind: 'archived', cursor: first.nextCursor }), { code: 'request_cursor' });
  await assert.rejects(f.service.command('requests/archive', { projectId: f.project.id, requestId: first.items[0].id }), { code: 'request_active' });
  assert.equal(f.state.requests.some(row => row.archivedAt !== undefined), false);
});

test('an archived delivery returns to current when its actual prerequisite changes', async () => {
  const f = fixture(); f.human(['Establish the runtime baseline']); const { request: baseline } = await f.accept({ title: 'Runtime baseline' }), prerequisite = f.add(baseline);
  await f.declare(baseline, [prerequisite.ref]); await f.reply('baseline-delivered'); await f.end('completed');
  f.human(['Repair login']); const { request: repair } = await f.accept({ title: 'Repair login' }), result = f.add(repair);
  result.receipt.report.prerequisites = [{ workstreamId: prerequisite.ref.workstreamId,
    delegationRef: prerequisite.ref.delegationRef, reportId: prerequisite.ref.reportId }];
  await f.declare(repair, [result.ref]); await f.reply('repair-delivered'); await f.end('completed');
  await f.service.command('requests/archive', { projectId: f.project.id, requestId: repair.id });
  assert.equal((await f.service.command('requests/list', { projectId: f.project.id, kind: 'archived' })).total, 1);

  const next = { ...prerequisite.receipt, ref: 'runtime-follow-up', runId: 'run-runtime-follow-up', phase: 'queued', report: undefined };
  prerequisite.work.delegations.push(next); prerequisite.work.currentDelegationRef = next.ref;
  const current = await f.service.command('requests/list', { projectId: f.project.id, kind: 'current' });
  assert.equal(current.items.find(card => card.id === repair.id)?.status, 'needsReview');
  assert.equal(typeof current.items.find(card => card.id === repair.id)?.archivedAt, 'number', 'the current card still offers restore for its persisted archive marker');
  assert.equal((await f.service.command('requests/list', { projectId: f.project.id, kind: 'archived' })).total, 0);
  assert.equal(typeof (await f.service.command('requests/get', { projectId: f.project.id, requestId: repair.id })).card.archivedAt, 'number');
  await assert.rejects(f.service.command('requests/archive', { projectId: f.project.id, requestId: repair.id }), { code: 'request_active' });
  await f.service.command('requests/restore', { projectId: f.project.id, requestId: repair.id });
  assert.equal(f.state.requests.find(row => row.id === repair.id).archivedAt, undefined);
  prerequisite.work.delegations.pop(); prerequisite.work.currentDelegationRef = prerequisite.ref.delegationRef;
  assert.equal((await f.service.command('requests/list', { projectId: f.project.id, kind: 'completed' })).items.find(card => card.id === repair.id)?.status, 'completed');
  assert.equal((await f.service.command('requests/list', { projectId: f.project.id, kind: 'archived' })).total, 0);
});

test('a later completed goal cannot hide an older delivery whose prerequisite changed', async () => {
  const f = fixture();
  f.human(['Establish runtime baseline']); const { request: baseline } = await f.accept({ title: 'Runtime baseline' }), upstream = f.add(baseline);
  await f.declare(baseline, [upstream.ref]); await f.reply('baseline-v1'); await f.end('completed');
  f.human(['Repair login using the baseline']); const { request: repair } = await f.accept({ title: 'Repair login' }), downstream = f.add(repair);
  downstream.receipt.report.prerequisites = [{ workstreamId: upstream.work.id, delegationRef: upstream.ref.delegationRef, reportId: upstream.ref.reportId }];
  await f.declare(repair, [downstream.ref]); await f.reply('repair-v1'); await f.end('completed');
  assert.equal(f.service.projectView(f.project).activity.state, 'done');

  f.human(['Update the runtime baseline']); const { request: revised } = await f.accept({ requestId: baseline.id });
  const next = { ...upstream.receipt, ref: 'baseline-v2', runId: 'run-baseline-v2', source: { ...revised.versions.at(-1).source },
    report: { ...upstream.receipt.report, delegationRef: 'baseline-v2', callId: 'report-baseline-v2' } };
  upstream.work.delegations.push(next); upstream.work.currentDelegationRef = next.ref;
  upstream.work.settlements.push({ runId: next.runId, delegationRefs: [next.ref], stopReason: 'completed', summarizedBy: '' });
  await f.declare(revised, [{ workstreamId: upstream.work.id, delegationRef: next.ref, runId: next.runId, reportId: next.report.callId }]);
  await f.reply('baseline-v2'); await f.end('completed');
  f.state.requests.find(row => row.id === baseline.id).updatedAt = repair.updatedAt + 1;

  assert.deepEqual(f.service.requirements.current(f.project.id).map(row => row.id), [repair.id]);
  const view = f.service.projectView(f.project);
  assert.equal(view.activity.state, 'needsReview'); assert.equal(view.activity.needsReview, 1);
  const current = await f.service.command('requests/list', { projectId: f.project.id, kind: 'current' });
  assert.equal(current.items.find(card => card.id === repair.id)?.status, 'needsReview');
  assert.equal(f.state.deliveries.find(row => row.requestId === repair.id).status, 'delivered', 'the historical handover is retained');
});

test('requirement history returns each full goal, restrictions and completion conditions without revising it', async () => {
  const f = fixture();
  const original = { title: 'Repair login', goal: 'Investigate the original login failure and preserve all saved credentials.',
    constraints: ['Do not rewrite stored credentials', 'Keep the original workspace'], conditions: ['Login succeeds', 'Saved credentials remain identical'] };
  f.human([original.goal]); const { request } = await f.accept(original);
  const revision = { requestId: request.id, title: original.title, goal: 'Also support empty passwords without changing saved credentials.',
    constraints: [...original.constraints, 'Do not change the authentication provider'], conditions: [...original.conditions, 'Empty passwords receive a useful error'] };
  f.human([revision.goal]); await f.accept(revision);
  f.service.workRows = async () => [];
  const before = structuredClone(f.state);
  const { card } = await f.service.command('requests/get', { projectId: f.project.id, requestId: request.id });
  assert.deepEqual(card.versions.map(({ title, goal, constraints, conditions }) => ({ title, goal, constraints, conditions })),
    [original, { title: revision.title, goal: revision.goal, constraints: revision.constraints, conditions: revision.conditions }]);
  assert.equal(card.revision, 2); assert.equal(card.goal, revision.goal);
  assert.deepEqual(f.state, before, 'opening requirement history is read-only');
});

test('discussion, approval, reordering and cancellation preserve one whole-goal queue until durable delivery', async () => {
  const f = fixture();
  f.human(['Develop A and verify the result']); const { request: a } = await f.accept({ title: 'A' }), work = f.add(a);
  f.human(['Discuss B, but do not develop it yet']);
  const { request: draft } = await f.accept({ title: 'B', goal: 'Export the project report', disposition: 'discussing', constraints: ['Keep existing exports'], conditions: ['CSV includes all rows'] });
  const assignment = (request, scope = 'readonly') => f.service.requirements.assignment(f.actor, { requestId: request.id, requestRevision: request.revision, scope }, f.exec('project_delegate'));
  await assert.rejects(assignment(draft), { code: 'request_queued' });
  await f.service.queue.pump(f.project.id);
  assert.equal(f.followups.length, 0); assert.equal(f.service.projectView(f.project).queue.discussingCount, 1);

  f.human(['B should also preserve Unicode']);
  const { request: b } = await f.accept({ requestId: draft.id, title: 'B', goal: 'Export the project report', constraints: ['Keep existing exports', 'Preserve Unicode'], conditions: ['CSV includes all rows', 'Unicode survives export'] });
  assert.equal(b.queue.state, 'discussing', 'refining a discussion does not approve development');
  await assert.rejects(f.queue(draft, 'enqueue'), { code: 'request_changed' });
  await f.queue(b, 'enqueue');
  f.human(['Develop C after A']); const { request: c } = await f.accept({ title: 'C', goal: 'Add report sorting' });
  await f.queue(c, 'move', { beforeRequestId: b.id });
  assert.deepEqual(f.service.projectView(f.project).queue.queued.map(row => [row.id, row.position]), [[c.id, 1], [b.id, 2]]);
  await f.queue(c, 'cancel');
  assert.deepEqual(f.service.projectView(f.project).queue.queued.map(row => [row.id, row.position]), [[b.id, 1]]);
  assert.equal((await f.service.command('requests/list', { projectId: f.project.id, kind: 'cancelled' })).items[0].id, c.id);
  await assert.rejects(assignment(b, 'development'), { code: 'request_queued' }, 'a queued requirement cannot start writing');
  await assert.rejects(assignment(b, 'docs'), { code: 'request_queued' });
  await assignment(b); // an authorized queued requirement may already investigate read-only

  f.human(['Report what remains for A']);
  await f.declare(a, [work.ref], { outcome: 'partial', remainingIssues: ['A still needs final acceptance'] });
  await f.reply('a-partial'); await f.end('completed');
  assert.equal(f.service.projectView(f.project).queue.active.id, a.id);
  assert.equal(f.followups.length, 0, 'worker completion and a partial delivery cannot activate B');

  f.human(['A is fully verified; deliver it']);
  await f.declare(a, [work.ref]); await f.reply('a-completed');
  assert.equal(f.service.projectView(f.project).queue.active.id, a.id, 'a visible reply without durable turn completion does not advance the queue');
  await f.end('completed');
  assert.equal(f.service.projectView(f.project).queue.active.id, b.id);
  assert.equal(f.followups.length, 1);
  f.activate(f.followups[0]);
  const accepted = await assignment(b);
  assert.equal(accepted.source.requestId, b.id); assert.equal(accepted.source.requestRevision, 2);
  assert.deepEqual(accepted.request.versions.at(-1).constraints, ['Keep existing exports', 'Preserve Unicode']);
  await assert.rejects(f.service.queueRequest(f.actor, { requestId: b.id, requestRevision: b.revision, action: 'cancel' }, f.exec('project_queue')), { code: 'unauthorized' }, 'host activation cannot invent queue authorization');
  await f.service.queue.pump(f.project.id); await f.service.queue.pump(f.project.id);
  assert.equal(f.followups.length, 1, 'the accepted activation is not reissued by later schedule passes');
});

test('cancelled requirements reject late results and retain their full saved requirement for explicit re-enqueue', async () => {
  const f = fixture(); f.human(['Develop A']); const { request: a } = await f.accept({ title: 'A' }), work = f.add(a);
  f.human(['Develop B after A']); const { request: b } = await f.accept({ title: 'B', constraints: ['Preserve user data'], conditions: ['B works'] });
  await f.queue(b, 'cancel');
  const cancelled = (await f.service.command('requests/get', { projectId: f.project.id, requestId: b.id })).card;
  assert.deepEqual(cancelled.constraints, ['Preserve user data']); assert.deepEqual(cancelled.conditions, ['B works']);
  await assert.rejects(f.service.requirements.assignment(f.actor, { requestId: b.id, requestRevision: b.revision, scope: 'readonly' }, f.exec('project_delegate')), { code: 'request_queued' });
  await f.queue(b, 'enqueue');
  assert.equal(f.service.projectView(f.project).queue.active.id, a.id); assert.equal(f.service.projectView(f.project).queue.queued[0].id, b.id);
  await f.queue(a, 'cancel');
  assert.equal(f.service.projectView(f.project).queue.active.id, b.id);
  const actor = { role: 'worker', agent: { id: work.work.workerSessionId }, project: f.project };
  await assert.rejects(f.service.report(actor, { delegationRef: work.ref.delegationRef, outcome: 'completed', summary: 'Late A result' }, { callId: 'late-a' }), { code: 'obsolete_result' });
  assert.equal(f.service.requirements.get(f.project.id, a.id).queue.state, 'cancelled');
});

test('reordering waiting requirements never resumes a stopped Project; explicit resume uses a new native activation', async () => {
  const f = fixture(); f.human(['Develop A']); const { request: a } = await f.accept({ title: 'A' });
  f.human(['Develop B and C afterwards']); const { request: b } = await f.accept({ title: 'B' }), { request: c } = await f.accept({ title: 'C' });
  await f.service.stop(f.project.id);
  const held = f.service.project(f.project.id).holdSourceMessageId;
  await f.queue(c, 'move', { beforeRequestId: b.id }); await f.service.queue.pump(f.project.id);
  assert.equal(f.service.project(f.project.id).paused, true); assert.equal(f.service.project(f.project.id).holdSourceMessageId, held);
  assert.equal(f.followups.length, 0);
  assert.deepEqual(f.service.projectView(f.project).queue.queued.map(row => row.id), [c.id, b.id]);
  await f.queue(b, 'cancel');
  const beforeRejectedResume = structuredClone(f.state);
  await assert.rejects(f.queue(b, 'resume'), { code: 'request_not_active' }, 'continuing cancelled B cannot resume the stopped active A');
  assert.deepEqual(f.state, beforeRejectedResume); assert.equal(f.followups.length, 0);
  await f.queue(b, 'enqueue');
  assert.equal(f.service.project(f.project.id).paused, true); assert.equal(f.service.project(f.project.id).holdSourceMessageId, held);
  assert.equal(f.service.projectView(f.project).queue.active.id, a.id); assert.equal(f.followups.length, 0);
  await f.queue(a, 'resume');
  assert.equal(f.service.project(f.project.id).paused, false); assert.equal(f.followups.length, 1);
  f.activate(f.followups[0]);
  const assignment = await f.service.requirements.assignment(f.actor, { requestId: a.id, requestRevision: a.revision, scope: 'readonly' }, f.exec('project_delegate'));
  assert.equal(assignment.source.continuationMessageId, f.followups[0].id);
  await f.service.stop(f.project.id); await f.queue(a, 'cancel');
  assert.equal(f.service.project(f.project.id).paused, true); assert.equal(f.service.projectView(f.project).queue.active, null);
  await f.queue(c, 'resume');
  assert.equal(f.service.project(f.project.id).paused, false); assert.equal(f.service.projectView(f.project).queue.active.id, c.id);
  assert.deepEqual(f.service.projectView(f.project).queue.queued.map(row => row.id), [b.id], 'explicitly continuing the waiting head resumes only that requirement');
});

test('failed cancellation drain keeps the next requirement waiting and exposes the actual stopping error', async () => {
  const f = fixture(); f.human(['Develop A']); const { request: a } = await f.accept({ title: 'A' }), work = f.add(a);
  f.human(['Develop B next']); const { request: b } = await f.accept({ title: 'B' });
  const workerId = work.work.workerSessionId;
  f.service.ctx.agents.set(workerId, { id: workerId, status: 'running', cancel() {}, whenIdle: async () => {} });
  f.service.ctx.subagents.drainChildren = async () => { throw new Error('Native child could not stop'); };
  await f.queue(a, 'cancel'); await f.service.queue.pump(f.project.id);
  assert.equal(f.service.requirements.get(f.project.id, a.id).queue.state, 'cancelled');
  assert.equal(f.service.worker(workerId).phase, 'stopping'); assert.equal(f.service.worker(workerId).error, 'Native child could not stop');
  assert.equal(f.service.projectView(f.project).queue.active, null);
  assert.equal(f.service.projectView(f.project).queue.queued[0].id, b.id); assert.equal(f.followups.length, 0);
  assert.equal(f.service.projectView(f.project).activity.state, 'stopping');
});

test('an invalidated prior delivery stays reviewable without preempting the next active requirement', async () => {
  const f = fixture(); f.human(['Develop A']); const { request: a } = await f.accept({ title: 'A' }), work = f.add(a);
  await f.declare(a, [work.ref]); await f.reply('a-delivered'); await f.end('completed');
  f.human(['Develop B']); const { request: b } = await f.accept({ title: 'B' }); await f.end('completed');
  work.receipt.report.callId = 'replacement-evidence';
  const detail = await f.service.command('detail', { projectId: f.project.id });
  assert.equal(detail.project.queue.active.id, b.id); assert.equal(detail.project.activity.state, 'pendingDelivery');
  assert.equal((await f.service.command('requests/get', { projectId: f.project.id, requestId: a.id })).card.status, 'needsReview');
  await f.service.queue.pump(f.project.id);
  assert.equal(f.service.projectView(f.project).queue.active.id, b.id);
  assert.equal(f.followups.every(message => message.content[0].text.includes(b.id)), true, 'the old requirement never reacquires execution authority');
  const original = (await f.service.command('requests/get', { projectId: f.project.id, requestId: a.id })).card;
  assert.equal(original.queue.released, true);
  await f.service.stop(f.project.id);
  const beforeRejectedResume = structuredClone(f.state), notices = f.followups.length;
  await assert.rejects(f.queue(a, 'resume'), { code: 'request_not_active' }, 'a released historical A cannot resume paused B');
  assert.deepEqual(f.state, beforeRejectedResume); assert.equal(f.followups.length, notices);
  await f.queue(a, 'enqueue');
  const rejoined = (await f.service.command('requests/get', { projectId: f.project.id, requestId: a.id })).card;
  assert.equal(rejoined.queue.state, 'queued'); assert.notEqual(rejoined.queue.released, true);
  assert.equal(rejoined.goal, original.goal); assert.equal(rejoined.revision, original.revision);
  assert.deepEqual(rejoined.constraints, original.constraints); assert.deepEqual(rejoined.conditions, original.conditions);
  assert.equal(f.service.project(f.project.id).paused, true); assert.equal(f.service.projectView(f.project).queue.active.id, b.id);
  assert.deepEqual(f.service.projectView(f.project).queue.queued.map(row => row.id), [a.id]); assert.equal(f.followups.length, notices);
});

test('a saved queue activation cannot execute a revised or cancelled requirement', async () => {
  const f = fixture(); f.human(['Develop A']); const { request: a } = await f.accept({ title: 'A' });
  f.human(['Develop B next']); const { request: b } = await f.accept({ title: 'B' });
  await f.declare(a, []); await f.reply('a-completed'); await f.end('completed');
  const oldNotice = f.followups[0]; assert.ok(oldNotice);
  f.human(['B must also preserve the existing shortcut']);
  const { request: revised } = await f.accept({ requestId: b.id, title: 'B', constraints: ['Preserve the existing shortcut'] });
  await f.end('completed');
  const admit = message => f.service.preStep({ agent: f.actor.agent, turn: 99, messages: [message] }, async () => ({ kind: 'enter', messages: [message] }));
  assert.equal((await admit(oldNotice)).kind, 'reject', 'a notice bound to revision 1 cannot consume revision 2');
  await f.service.queue.pump(f.project.id);
  const currentNotice = f.followups[1]; assert.ok(currentNotice); assert.notEqual(currentNotice.id, oldNotice.id);
  f.activate(currentNotice);
  const assigned = await f.service.requirements.assignment(f.actor, { requestId: revised.id, requestRevision: revised.revision, scope: 'readonly' }, f.exec('project_delegate'));
  assert.equal(assigned.source.requestRevision, 2);
  assert.deepEqual(assigned.request.versions.at(-1).constraints, ['Preserve the existing shortcut']);
  await f.queue(revised, 'cancel');
  assert.equal((await admit(currentNotice)).kind, 'reject', 'cancelled saved activation cannot revive its requirement');
});

test('the Lead\'s notes list handovers as one line each and give a requirement\'s full text only when it is named', async () => {
  const f = fixture();
  const hand = async (goal, summary) => {
    f.human([goal]); const { request } = await f.accept({ goal }), work = f.add(request);
    await f.declare(request, [work.ref], { summary }); await f.reply(`reply-${goal}`); await f.end('completed'); return request;
  };
  const first = await hand('First goal', 'A'.repeat(900)), second = await hand('Second goal', 'Short result');
  const brief = f.service.requirements.deliveriesForLead(f.project.id);
  assert.equal(brief.brief, true); assert.equal(brief.items.length, 2); assert.match(brief.hint, /requestId/);
  for (const item of brief.items) {
    assert.deepEqual(Object.keys(item).toSorted(), ['applicable', 'artifactCount', 'at', 'id', 'outcome', 'remainingIssueCount', 'requestId', 'requestRevision', 'status', 'summary', 'title']);
  }
  assert.equal(brief.items.find(item => item.requestId === first.id).summary.length, 241, 'a long summary is cut to a preview');
  assert.equal(brief.items.find(item => item.requestId === second.id).summary, 'Short result');
  const full = f.service.requirements.deliveriesForLead(f.project.id, first.id);
  assert.equal(full.brief, undefined); assert.equal(full.items.length, 1);
  assert.equal(full.items[0].summary.length, 900); assert.ok(full.items[0].reportRefs.length && full.items[0].evidence.length, 'the named requirement keeps its complete handover');
  assert.equal(f.service.requirements.deliveries(f.project.id).items.length, 2, 'the Project UI still reads complete handovers');
  assert.equal(f.service.requirements.deliveries(f.project.id).items[0].reportRefs.length > 0, true);
});

test('the Lead\'s notes cap long user notes and give them whole on request', async () => {
  const f = fixture(); f.human(['Read the notes']);
  f.service.readStore = async () => ({ userText: 'N'.repeat(6000) });
  const execution = f.exec('project_read_store');
  const capped = await f.service.readStoreTool(f.actor, { path: 'notes.md' }, execution);
  assert.equal(capped.userNotes.length, 4001); assert.equal(capped.userNotesChars, 6000); assert.match(capped.userNotesHint, /fullNotes/);
  const whole = await f.service.readStoreTool(f.actor, { path: 'notes.md', fullNotes: true }, execution);
  assert.equal(whole.userNotes.length, 6000); assert.equal(whole.userNotesChars, undefined);
  f.service.readStore = async () => ({ userText: 'short' });
  const small = await f.service.readStoreTool(f.actor, { path: 'notes.md' }, execution);
  assert.equal(small.userNotes, 'short'); assert.equal(small.userNotesChars, undefined);
});

const workerActor = (f, item) => ({ role: 'worker', agent: { id: f.state.workers.find(worker => worker.workstreamId === item.work.id).sessionId }, project: f.project });
const attentionOf = async f => (await f.service.command('requests/attention', { projectId: f.project.id }));
const stageOf = async (f, request) => (await f.service.command('requests/get', { projectId: f.project.id, requestId: request.id })).card.stage;

test('one pending question per requirement: repeated is reused, a different one replaces it, limits hold and clearing is explicit', async () => {
  const f = fixture(); f.human(['Pick the storage layer']); const { request } = await f.accept({ disposition: 'discussing' });
  const ask = args => f.service.askHuman(f.actor, { requestId: request.id, ...args }, f.exec('project_ask'));
  const first = await ask({ question: 'Postgres or SQLite?', options: ['Postgres', 'SQLite'], ifUnanswered: 'I start with SQLite' });
  assert.deepEqual(first, { requestId: request.id, asked: true, reused: false });
  const row = () => f.service.requirements.get(f.project.id, request.id), id = row().ask.id;
  assert.equal((await ask({ question: '  postgres   OR sqlite?  ' })).reused, true);
  assert.equal(row().ask.id, id, 'the same question keeps its identity, options and default');
  assert.deepEqual(row().ask.options, ['Postgres', 'SQLite']);
  assert.equal((await ask({ question: 'Which port should it listen on?' })).reused, false);
  assert.notEqual(row().ask.id, id); assert.equal(row().ask.question, 'Which port should it listen on?'); assert.equal(row().ask.by, 'coordinator');
  await assert.rejects(ask({ question: '   ' }), { code: 'invalid_request' });
  await assert.rejects(ask({ question: 'Pick one', options: ['1', '2', '3', '4', '5', '6', '7'] }), { code: 'invalid_request' });
  await assert.rejects(f.service.askHuman(f.actor, { requestId: 'nope', question: 'Anyone?' }, f.exec('project_ask')), { code: 'request_changed' });
  await assert.rejects(f.service.askHuman({ role: 'worker' }, { requestId: request.id, question: 'Mine' }, f.exec('project_ask')), { code: 'unauthorized' });
  assert.deepEqual(await ask({ clear: true }), { requestId: request.id, cleared: true }); assert.equal(row().ask, undefined);
  assert.equal((await ask({ clear: true })).cleared, false);
  await ask({ question: 'Still relevant?' }); await f.queue(request, 'cancel');
  assert.equal(row().ask, undefined, 'a cancelled requirement waits on no one');
  await assert.rejects(ask({ question: 'Too late?' }), { code: 'request_closed' });
});

test('revising a requirement withdraws its question', async () => {
  const f = fixture(); f.human(['Pick the storage layer']); const { request } = await f.accept({ disposition: 'discussing' });
  await f.service.askHuman(f.actor, { requestId: request.id, question: 'Postgres or SQLite?' }, f.exec('project_ask'));
  f.human(['Use SQLite, and keep the schema small']); await f.accept({ requestId: request.id, goal: 'Store data in SQLite', disposition: 'discussing' });
  assert.equal(f.service.requirements.get(f.project.id, request.id).ask, undefined);
});

test('the user\'s next message answers a pending question; progress alone does not', async () => {
  const f = fixture(); f.human(['Pick the storage layer']); const { request } = await f.accept({ disposition: 'discussing' });
  await f.service.askHuman(f.actor, { requestId: request.id, question: 'Postgres or SQLite?' }, f.exec('project_ask'));
  const settled = { id: 'notice-1', role: 'user', source: { kind: 'subagent-settled', senderSessionId: 'nobody', runId: 'none' }, content: [{ type: 'text', text: 'A member finished.' }] };
  await f.service.preStep({ agent: f.actor.agent, turn: 8, messages: [settled] }, async () => ({ kind: 'enter', messages: [settled] }));
  assert.ok(f.service.requirements.get(f.project.id, request.id).ask, 'a settlement notice is progress, not an answer');
  const answer = { id: 'human-answer', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'SQLite' }] };
  await f.service.preStep({ agent: f.actor.agent, turn: 9, messages: [answer] }, async () => ({ kind: 'enter', messages: [answer] }));
  assert.equal(f.service.requirements.get(f.project.id, request.id).ask, undefined);
  assert.equal((await attentionOf(f)).total, 0);
});

test('the stage table names who is waited on, the first match wins, and the header count is the length of the pinned list', async () => {
  const f = fixture(); f.human(['Fix login']); const { request: login } = await f.accept({ title: 'Fix login' });
  f.human(['Maybe add SSO']); const { request: sso } = await f.accept({ title: 'Maybe add SSO', disposition: 'discussing' });
  f.human(['Speed up search']); const { request: search } = await f.accept({ title: 'Speed up search' });
  const stages = async () => Object.fromEntries(await Promise.all([login, sso, search].map(async request => [request.title, (await stageOf(f, request)).id])));
  const count = async () => ({ list: (await attentionOf(f)).total, header: f.service.projectView(f.project).activity.needsYou,
    cards: (await f.service.command('requests/list', { projectId: f.project.id, kind: 'current' })).items.filter(card => card.stage.needsYou).length });
  const first = await stages();
  assert.equal(first['Maybe add SSO'], 'discussing'); assert.equal(first['Speed up search'], 'queued');
  assert.deepEqual(await count(), { list: 0, header: 0, cards: 0 }, 'healthy and waiting states take no space');

  const item = f.add(login);
  assert.equal((await stageOf(f, login)).id, 'running');
  item.work.pendingSummary = false; item.receipt.report.outcome = 'blocked'; item.receipt.report.summary = 'The login page URL needs a staging account I cannot create.';
  const blocked = await stageOf(f, login);
  assert.deepEqual([blocked.id, blocked.waitingOn, blocked.needsYou, blocked.reason], ['blocked', 'you', true, 'work']);
  assert.match(blocked.detail, /staging account/);

  await f.service.askHuman(f.actor, { requestId: sso.id, question: 'Which identity provider?' }, f.exec('project_ask'));
  await f.service.askHuman(f.actor, { requestId: login.id, question: 'Can you share a staging account?', ifUnanswered: 'I will test against mocks' }, f.exec('project_ask'));
  assert.equal((await stageOf(f, login)).id, 'awaitingAnswer', 'a question outranks the blocked work it explains');
  assert.equal((await stageOf(f, sso)).id, 'awaitingAnswer', 'a question outranks being merely discussed');
  const pinned = await attentionOf(f);
  assert.deepEqual(pinned.items.map(card => card.title).toSorted(), ['Fix login', 'Maybe add SSO']);
  assert.deepEqual(await count(), { list: 2, header: 2, cards: 2 });
  assert.equal(pinned.items.find(card => card.id === login.id).stage.ask.ifUnanswered, 'I will test against mocks');

  await f.service.askHuman(f.actor, { requestId: sso.id, clear: true }, f.exec('project_ask'));
  await f.service.askHuman(f.actor, { requestId: login.id, clear: true }, f.exec('project_ask'));
  assert.equal((await stageOf(f, login)).id, 'blocked'); assert.equal((await stageOf(f, sso)).id, 'discussing');
  assert.deepEqual(await count(), { list: 1, header: 1, cards: 1 });
});

test('a member\'s blocked report carries its one question onto its requirement; a completed report cannot ask', async () => {
  const f = fixture(); f.human(['Research the integration']); const { request } = await f.accept({});
  const item = f.add(request), worker = f.state.workers.at(-1);
  delete item.receipt.report; delete item.work.latestReport; item.work.status = 'open'; worker.consumedDelegationRef = item.ref.delegationRef; worker.activeRunId = item.ref.runId;
  const actor = workerActor(f, item), report = args => f.service.report(actor, { delegationRef: item.ref.delegationRef, summary: 'Needs the link.', artifacts: [], evidence: [], remainingIssues: [], ...args }, { callId: 'report-call' });
  await assert.rejects(report({ outcome: 'completed', humanAction: { question: 'Which link?' } }), { code: 'invalid_result' });
  await assert.rejects(report({ outcome: 'blocked', humanAction: { question: '' } }), { code: 'invalid_request' });
  assert.equal(f.service.requirements.get(f.project.id, request.id).ask, undefined, 'a rejected report leaves no question behind');
  await report({ outcome: 'blocked', humanAction: { question: 'Which repository link should I read?', options: ['The public one', 'The private fork'], ifUnanswered: 'I keep the other stages ready' } });
  const ask = f.service.requirements.get(f.project.id, request.id).ask;
  assert.deepEqual([ask.by, ask.question, ask.workstreamId, ask.delegationRef], ['member', 'Which repository link should I read?', item.ref.workstreamId, item.ref.delegationRef]);
  assert.deepEqual(ask.options, ['The public one', 'The private fork']);
  assert.equal((await stageOf(f, request)).ask.by, 'member');
});

test('a temporary summary failure the host will retry is not waiting on the user; an exhausted or permanent one is', async () => {
  const f = fixture(); f.human(['Fix login']); const { request } = await f.accept({}); const item = f.add(request);
  const failure = (code, autoRetries) => { item.work.summaryFailure = { turn: 1, at: 1, delegationRef: item.ref.delegationRef, runId: item.ref.runId, error: { code, message: 'x' }, ...(autoRetries ? { autoRetries } : {}) }; };
  const waiting = setTimeout(() => {}, 1e6); waiting.unref(); f.service.summaryRetryTimers.set(f.project.id, waiting);
  try {
    failure('SERVER', 1);
    const retrying = await stageOf(f, request);
    assert.deepEqual([retrying.id, retrying.needsYou, retrying.retry], ['running', false, { attempt: 2, of: 3 }]);
    assert.deepEqual(f.service.autoRetry(item.work), { attempt: 2, of: 3 });
    failure('SERVER', 3); assert.deepEqual([(await stageOf(f, request)).id, (await stageOf(f, request)).reason], ['awaitingDecision', 'summaryFailed']);
    failure('AUTH', 0); assert.equal((await stageOf(f, request)).id, 'awaitingDecision', 'a permanent error needs the user');
    failure('SERVER', 0); f.service.summaryRetryTimers.delete(f.project.id); f.service.ctx.agents.get('lead').status = 'idle';
    assert.equal((await stageOf(f, request)).id, 'awaitingDecision', 'no retry is waiting or running, for example after a restart');
    f.service.ctx.agents.get('lead').status = 'running';
    assert.equal((await stageOf(f, request)).id, 'running', 'a retry turn in flight is still the host working');
  } finally { clearTimeout(waiting); }
});

test('a delivered requirement that needs review, or only partly delivered, waits on the user\'s decision', async () => {
  const f = fixture(); f.human(['Fix login']); const { request } = await f.accept({}); const item = f.add(request);
  f.human(['Deliver']); await f.declare(request, [item.ref], { outcome: 'partial', remainingIssues: ['SSO is not covered'] });
  await f.reply('reply-partial'); await f.end('completed');
  const stage = await stageOf(f, request);
  assert.deepEqual([stage.id, stage.waitingOn, stage.reason], ['awaitingDecision', 'you', 'partial']);
  assert.equal((await attentionOf(f)).total, 1);
});

test('a turn a host notice started may end silently only while nothing needs saying; every reason to speak is enforced by the host', async () => {
  const notice = { id: 'notice-1', role: 'user', source: { kind: 'subagent-settled', summary: 'A member finished.' }, content: [{ type: 'text', text: 'A member finished.' }] };
  const f = fresh();
  function fresh() { const g = fixture(); return g; }
  const quiet = (g, message = notice) => { g.activate(message); return g.service.standby(g.actor, { note: 'stage delegated' }, g.exec('project_standby')); };

  // Something is still running: the panel shows it, the Lead need not.
  f.human(['Fix login']); const { request } = await f.accept({}); const item = f.add(request);
  delete item.receipt.report; delete item.work.latestReport; item.work.status = 'open'; item.work.pendingSummary = false; item.work.settlements = [];
  const worker = f.state.workers.at(-1); worker.activeRunId = item.ref.runId; worker.phase = 'active';
  assert.deepEqual(await quiet(f), { standby: true });

  // The user wrote in the turn: answer them.
  const g = fixture(); g.human(['Fix login']); await g.accept({});
  await assert.rejects(g.service.standby(g.actor, {}, g.exec('project_standby')), { code: 'speak_required' });

  // The user is waited on: say it once, briefly.
  const h = fixture(); h.human(['Pick a database']); const { request: ask } = await h.accept({ disposition: 'discussing' });
  await h.service.askHuman(h.actor, { requestId: ask.id, question: 'Postgres or SQLite?' }, h.exec('project_ask'));
  await assert.rejects(quiet(h), error => error.code === 'speak_required' && /waits on the user/.test(error.message));

  // Nothing is running or queued for the active requirement: deliver it, or arrange the next stage.
  const i = fixture(); i.human(['Fix login']); await i.accept({});
  await assert.rejects(quiet(i), error => error.code === 'speak_required' && /nothing running or queued/.test(error.message));
  const j = fixture(); j.human(['Fix login']); const { request: done } = await j.accept({}); j.add(done);
  await assert.rejects(quiet(j), error => error.code === 'speak_required' && /deliver it with project_deliver/.test(error.message));

  // A handover declared in this turn needs its reply.
  const k = fixture(); k.human(['Fix login']); const { request: handed } = await k.accept({}); const work = k.add(handed);
  k.activate(notice); await k.declare(handed, [work.ref]);
  await assert.rejects(k.service.standby(k.actor, {}, k.exec('project_standby')), error => error.code === 'speak_required' && /declared a handover/.test(error.message));

  // A temporary summary failure the host is retrying is the host working, not a reason to speak.
  const l = fixture(); l.human(['Fix login']); const { request: retrying } = await l.accept({}); const failing = l.add(retrying);
  failing.work.summaryFailure = { turn: 1, at: 1, delegationRef: failing.ref.delegationRef, runId: failing.ref.runId, error: { code: 'SERVER', message: 'x' }, autoRetries: 1 };
  const timer = setTimeout(() => {}, 1e6); timer.unref(); l.service.summaryRetryTimers.set(l.project.id, timer);
  try { assert.deepEqual(await quiet(l), { standby: true }); } finally { clearTimeout(timer); }
});
