import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectService } from '../lib/service.js';
import { projectDirectory, safeProjectSubdirectory } from '../lib/files.js';

function setup() {
  const project = { id: 'project', coordinatorSessionId: 'lead', storageRoot: '/project-materials', lifecycle: 'ready', paused: false, diagnostics: [], updatedAt: 0 };
  const state = { revision: 1, projects: [project, { ...project, id: 'other' }], workstreams: [], workers: [] };
  const events = [{ seq: 0, type: 'turn/start', data: { turn: 1 } }];
  const tasks = [], lead = { id: 'lead', status: 'idle', session: { id: 'lead', snapshotEvents: () => events } };
  const teams = { registerPolicy: () => () => {}, listTasks: () => tasks };
  const ctx = { agents: new Map([['lead', lead]]), sessionPersistence: { stat: async () => ({}) }, sessions: { flush: async () => true }, get: () => undefined,
    subagents: { registerContinuationPolicy: () => () => {} }, agentTeams: teams };
  ctx.sessionController = { resolveAgent: async id => ({ agent: ctx.agents.get(id) }) };
  const service = new ProjectService(ctx, { get: () => state, update: async (_key, change) => { Object.assign(state, change(state)); } }, { home: '', desktop: async () => ({}) });
  function add(id, current, updatedAt) {
    const report = { delegationRef: `ref-${id}`, summary: `Full report ${id}`, outcome: 'completed', evidence: [], remainingIssues: [], at: updatedAt, callId: `report-${id}`, artifacts: [{ path: `/original-cwd/result/${id}`, sha256: 'recorded-hash', size: 1, type: 'file' }] };
    const receipt = { ref: `ref-${id}`, phase: current ? 'queued' : 'accepted', scope: 'readonly',
      brief: 'Assignment text '.repeat(1000), source: { sessionId: 'lead', messageId: `human-${id}`, callId: `delegate-${id}`, text: 'Original human text '.repeat(1000) },
      writePaths: [], messageId: `assignment-${id}`, runId: current ? '' : `run-${id}`, error: '', createdAt: updatedAt, ...(current ? {} : { report }) };
    const work = { id, projectId: project.id, title: id, workerSessionId: `session-${id}`, currentDelegationRef: receipt.ref,
      status: current ? 'open' : 'done', brief: receipt.brief, blockedBy: [], blockedReason: '', pendingSummary: false,
      createdAt: 0, updatedAt, delegations: [receipt], settlements: [], ...(current ? {} : { latestReport: report }) };
    const worker = { sessionId: work.workerSessionId, projectId: project.id, workstreamId: id, phase: 'idle', stopped: false,
      cwd: '/original-cwd', role: 'readonly', mode: 'existing', error: '' };
    state.workstreams.push(work); state.workers.push(worker);
    tasks.push({ id, status: current ? 'pending' : 'completed', description: receipt.brief });
    return { work, worker, receipt, report };
  }
  const read = (endpoint, input = {}) => service.command(endpoint, { projectId: project.id, ...input });
  const append = (type, data) => { const event = { seq: events.length, type, data }; events.push(event); return event; };
  const result = (turn, callId, value) => append('tool/result', { turn, step: 0, message: { id: `result-${callId}`, role: 'tool', source: { kind: 'tool', callId },
    toolCallId: callId, isError: false, content: [{ type: 'text', text: JSON.stringify(value) }] } });
  return { service, state, tasks, project, add, read, lead, events, append, result };
}

test('initial detail bounds both work groups, preserves priority and omits report and delegation payloads', async () => {
  const f = setup();
  for (let i = 0; i < 51; i++) f.add(`current-${i}`, true, i);
  for (let i = 0; i < 31; i++) f.add(`history-${i}`, false, i);
  f.state.workstreams[0].status = 'blocked';
  f.state.workers[1].activeRunId = 'live-run';
  const detail = await f.read('detail');
  assert.equal(detail.workstreams.length, 23);
  assert.equal(detail.workstreams[0].id, 'current-0');
  assert.equal(detail.workstreams[1].id, 'current-1');
  assert.deepEqual(detail.workstreams.slice(-3).map(work => work.id), ['history-30', 'history-29', 'history-28']);
  assert.equal(detail.workers.length, 23);
  assert.equal(detail.workPage.currentTotal, 51);
  assert.equal(detail.workPage.historyTotal, 31);
  assert.equal(detail.workPage.currentCursor, null);
  assert.equal(detail.project.activity.running, 1);
  assert.equal(detail.project.activity.queued, 51, 'aggregate is over the entire Project');
  assert.deepEqual(detail.team, { id: 'lead' }, 'native task descriptions are not repeated in the summary');
  assert.doesNotMatch(JSON.stringify(detail), /Full report|Assignment text|Original human text|recorded-hash/);
  assert.deepEqual(await f.read('detail', { since: detail.revision }), { projectId: 'project', revision: detail.revision, unchanged: true });
});

test('artifact locations reflect their registered materials or continuing worker without rewriting saved reports', async () => {
  const f = setup(), existing = f.add('existing', false, 1), branch = f.add('branch', false, 2);
  branch.worker.mode = 'worktree'; branch.worker.cwd = '/owned-branch';
  existing.report.artifacts = [{ path: '/project-materials/docs/existing/report.md', sha256: 'report-hash' }, { path: '/original-cwd/src/app.js', sha256: 'file-hash' }];
  branch.report.artifacts = [{ path: '/owned-branch/src/app.js', sha256: 'branch-hash' }];
  const before = JSON.stringify(f.state);
  const current = await f.read('workstreams/get', { workstreamId: existing.work.id });
  assert.deepEqual(current.workstream.latestReport.artifacts.map(file => file.location), ['materials', 'existing']);
  const historical = await f.read('store/results', { workstreamId: branch.work.id });
  assert.equal(historical.items[0].artifacts[0].location, 'worktree');
  assert.equal(historical.items[0].artifacts[0].path, branch.report.artifacts[0].path);
  assert.equal(JSON.stringify(f.state), before);
});

test('current detail pages are revision-aware and reset only when the live anchor leaves the group', async () => {
  const f = setup();
  for (let i = 0; i < 45; i++) f.add(`work-${i}`, true, i);
  const first = await f.read('detail');
  const second = await f.read('detail', { currentCursor: first.workPage.currentNextCursor, since: first.revision });
  assert.equal(second.workstreams.length, 20);
  assert.notEqual(second.revision, first.revision);
  assert.equal(second.workPage.currentCursor, first.workPage.currentNextCursor);
  const third = await f.read('detail', { currentCursor: second.workPage.currentNextCursor });
  assert.equal(third.workstreams.length, 5);
  assert.equal(third.workPage.currentNextCursor, null);
  assert.equal(new Set([...first.workstreams, ...second.workstreams, ...third.workstreams].map(work => work.id)).size, 45);
  const anchor = f.state.workstreams.find(work => work.id === second.workPage.currentCursor);
  anchor.delegations[0].phase = 'accepted'; anchor.status = 'done';
  f.tasks.find(task => task.id === anchor.id).status = 'completed'; f.state.revision++;
  const changed = await f.read('detail', { currentCursor: second.workPage.currentCursor, since: second.revision });
  assert.equal(changed.workPage.currentCursor, null);
  assert.equal(changed.workPage.currentTotal, 44);
  assert.equal(changed.workstreams[0].id, first.workstreams[0].id);
});

test('history pages stay bounded, reset a continued anchor and reject foreign or unknown cursors', async () => {
  const f = setup();
  f.add('active', true, 0);
  for (let i = 0; i < 31; i++) f.add(`past-${i}`, false, i);
  const stopped = f.add('recent-stopped', false, 100);
  stopped.worker.stopped = true; stopped.work.status = 'open'; f.tasks.at(-1).status = 'in_progress';
  const detail = await f.read('detail');
  assert.equal(detail.workstreams[1].id, 'recent-stopped', 'history uses recency, including unfinished stopped work');
  const page = await f.read('workstreams/list', { kind: 'history', cursor: detail.workPage.historyNextCursor });
  assert.equal(page.workstreams.length, 20); assert.equal(page.workers.length, 20); assert.equal(page.total, 32);
  const last = await f.read('workstreams/list', { kind: 'history', cursor: page.nextCursor });
  assert.equal(last.workstreams.length, 9); assert.equal(last.nextCursor, null); assert.equal(last.hasMore, false);
  const continued = f.state.workstreams.find(work => work.id === page.nextCursor);
  continued.status = 'running'; f.tasks.find(task => task.id === continued.id).status = 'in_progress';
  f.state.workers.find(worker => worker.sessionId === continued.workerSessionId).activeRunId = 'continued-run';
  const reset = await f.read('workstreams/list', { kind: 'history', cursor: page.nextCursor });
  assert.equal(reset.cursor, null); assert.equal(reset.workstreams.length, 20); assert.equal(reset.workstreams[0].id, 'recent-stopped');
  assert.equal(reset.workstreams.some(work => work.id === continued.id), false);
  await assert.rejects(f.read('workstreams/list', { kind: 'history', cursor: 'missing' }), { code: 'work_cursor' });
  await assert.rejects(f.read('workstreams/list', { kind: 'history', projectId: 'other', cursor: 'past-30' }), { code: 'work_cursor' });
  await assert.rejects(f.read('workstreams/list', { kind: 'unknown' }), { code: 'work_kind' });
});

test('explicit details resolve unloaded original member identity and only the current report', async () => {
  const f = setup();
  const { work, worker, report } = f.add('old-work', false, 0);
  for (let i = 0; i < 30; i++) f.add(`newer-${i}`, false, i + 1);
  assert.equal((await f.read('detail')).workstreams.some(row => row.id === work.id), false);
  const detail = await f.read('workstreams/get', { workerSessionId: worker.sessionId });
  assert.equal(detail.workstream.id, work.id); assert.equal(detail.worker.cwd, '/original-cwd');
  const displayed = { ...report, artifacts: [{ ...report.artifacts[0], location: 'existing' }] };
  assert.deepEqual(detail.workstream.latestReport, displayed);
  assert.equal(detail.workstream.delegation.source.text, work.delegations[0].source.text);
  await assert.rejects(f.read('workstreams/get', { workerSessionId: worker.sessionId, projectId: 'other' }), { code: 'missing' });
  await assert.rejects(f.read('workstreams/get', { workstreamId: work.id, workerSessionId: worker.sessionId }), { code: 'work_identity' });
  work.delegations.push({ ref: 'new-request', phase: 'queued', scope: 'readonly', brief: 'Continue the original work', writePaths: [], messageId: '', runId: '', error: '', createdAt: 100,
    source: { sessionId: 'lead', messageId: 'new-human', callId: 'new-delegate', text: 'Continue the original work' } }); work.currentDelegationRef = 'new-request';
  const continued = await f.read('workstreams/get', { workstreamId: work.id });
  assert.equal(continued.workstream.latestReport, undefined, 'a previous report cannot appear as the new assignment result');
  assert.equal(continued.worker.sessionId, worker.sessionId);
  assert.deepEqual((await f.read('store/results', { workstreamId: work.id })).items, [displayed], 'the old report remains available by its original ref');
});

test('Project activity accounts for preparing and failed members outside the selected work page', async () => {
  const f = setup();
  const preparing = f.add('preparing', true, 0);
  preparing.receipt.phase = 'preparing'; preparing.worker.phase = 'provisioning';
  let project = (await f.read('list')).projects.find(row => row.id === f.project.id);
  assert.equal(project.activity.provisioning, 1); assert.equal(project.activity.state, 'provisioning');
  preparing.receipt.phase = 'queued';
  project = (await f.read('list')).projects.find(row => row.id === f.project.id);
  assert.equal(project.activity.provisioning, 0); assert.equal(project.activity.state, 'queued', 'capacity waiting is not directory preparation');
  const failure = f.add('failed', true, 1); failure.worker.phase = 'failed'; failure.receipt.phase = 'failed';
  project = (await f.read('list')).projects.find(row => row.id === f.project.id);
  assert.equal(project.activity.blocked, 1); assert.equal(project.activity.state, 'blocked');
  failure.worker.stopped = true;
  preparing.receipt.phase = 'accepted'; preparing.work.status = 'done'; preparing.work.pendingSummary = true;
  project = (await f.read('list')).projects.find(row => row.id === f.project.id);
  assert.equal(project.activity.blocked, 0); assert.equal(project.activity.pendingSummary, 1); assert.equal(project.activity.state, 'pendingDelivery');
});

test('a successful current handover resolves review while the preceding handover keeps its original history', async () => {
  const f = setup(), item = f.add('continued-goal', false, 1);
  const source = { ...item.receipt.source, requestId: 'goal', requestRevision: 1, authorizationCallId: 'accept-goal' };
  item.receipt.source = source;
  f.state.requests = [{ id: 'goal', projectId: f.project.id, title: 'Complete the goal', revision: 1, createdAt: 1, updatedAt: 1,
    versions: [{ revision: 1, title: 'Complete the goal', goal: 'Complete and verify the goal', constraints: [], conditions: ['Verified result'], scope: 'readonly', writePaths: [], source, at: 1 }] }];
  const handover = (id, receipt, at) => ({ id, projectId: f.project.id, requestId: 'goal', requestRevision: 1, title: 'Complete the goal',
    summary: `Verified result ${id}`, outcome: 'completed', evidence: ['Actual verification'], remainingIssues: [],
    reportRefs: [{ workstreamId: item.work.id, delegationRef: receipt.ref, reportId: receipt.report.callId }],
    requiredDelegations: [{ workstreamId: item.work.id, delegationRef: receipt.ref, runId: receipt.runId }],
    declaredCallId: `deliver-${id}`, sessionId: f.lead.id, turn: at, status: 'delivered', replyMessageId: `reply-${id}`, at });
  f.state.deliveries = [handover('preceding', item.receipt, 1)];
  const next = { ...item.receipt, ref: 'continued-result', runId: 'continued-run',
    report: { ...item.report, delegationRef: 'continued-result', callId: 'continued-report', at: 2 } };
  item.work.delegations.push(next); item.work.currentDelegationRef = next.ref; item.work.updatedAt = 2;
  f.project.paused = true;
  let project = (await f.read('list')).projects.find(row => row.id === f.project.id);
  assert.equal(project.activity.needsReview, 1); assert.equal(project.activity.state, 'needsReview', 'a safety hold does not conceal changed delivery evidence');
  f.state.deliveries.push(handover('current', next, 2));
  project = (await f.read('list')).projects.find(row => row.id === f.project.id);
  assert.equal(project.activity.needsReview, 0); assert.equal(project.activity.state, 'done');
  assert.equal(project.paused, true, 'a valid delivered goal stays done while its execution safety hold is retained');
  assert.deepEqual(project.currentRequests, []);
  const { deliveries: history } = await f.read('store/list', { kind: 'deliveries' });
  assert.deepEqual(history.items.map(row => [row.id, row.applicable]), [['current', true], ['preceding', false]]);
  assert.equal(history.items[1].replyMessageId, 'reply-preceding');
  assert.equal(history.items[1].reportRefs[0].delegationRef, item.receipt.ref);
  const failedDraft = { ...handover('failed-after-completed', next, 3), status: 'draft', error: 'The latest handover tool failed.' };
  delete failedDraft.replyMessageId; f.state.deliveries.push(failedDraft);
  project = (await f.read('list')).projects.find(row => row.id === f.project.id);
  assert.equal(project.paused, true); assert.equal(project.activity.state, 'summaryFailed'); assert.equal(project.activity.summaryFailed, 1);
  assert.deepEqual(project.currentRequests.map(row => row.id), ['goal']);
  assert.equal(project.currentRequests[0].handoverError, failedDraft.error, 'an old completed delivery cannot hide a newer failed attempt');
  const unfinishedDraft = { ...failedDraft, id: 'awaiting-current-reply', at: 4 }; delete unfinishedDraft.error;
  f.state.deliveries.push(unfinishedDraft);
  project = (await f.read('list')).projects.find(row => row.id === f.project.id);
  assert.equal(project.activity.state, 'paused', 'an unfinished handover still requires continuation under a hold');
  assert.equal(project.activity.summaryFailed, 0); assert.equal(project.currentRequests.length, 1);
  f.project.diagnostics = ['The original coordinator could not be inspected.'];
  project = (await f.read('list')).projects.find(row => row.id === f.project.id);
  assert.equal(project.activity.state, 'blocked', 'a current recovery diagnostic takes precedence over the safety hold');
});

test('generated notes keep active work and preserve a full UTF-8 user body beside oversized legacy summaries', async t => {
  const f = setup(), home = await fs.mkdtemp(join(tmpdir(), 'whale-project-notes-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  f.service.home = home; f.project.storageRoot = await projectDirectory(home, f.project.id);
  await safeProjectSubdirectory(home, f.project.id, 'docs');
  const blocked = f.add('old-blocked', true, 0); blocked.work.status = 'blocked';
  const active = f.add('old-active', true, 1); active.worker.activeRunId = 'actual-run';
  for (let i = 0; i < 30; i++) {
    const item = f.add(`recent-done-${i}`, false, i + 10);
    item.report.summary = '鲸'.repeat(2000); item.report.evidence = ['鲸'.repeat(2000)]; item.report.remainingIssues = ['鲸'.repeat(2000)]; item.work.brief = '鲸'.repeat(2000);
  }
  const marker = '<!-- whale-project:user-notes -->', user = '鲸'.repeat(85333) + 'A';
  assert.equal(Buffer.byteLength(user), 256000);
  const path = join(f.project.storageRoot, 'notes.md');
  await fs.writeFile(path, '旧'.repeat(300000) + marker + '\n' + user);
  const legacy = await f.read('store/read', { path: 'notes.md' });
  assert.equal(legacy.userText, user); assert.ok(Buffer.byteLength(legacy.text) <= 512000);
  await f.service.notes(f.project.id);
  const fresh = await f.read('store/read', { path: 'notes.md' });
  assert.equal(fresh.userText, user); assert.ok(Buffer.byteLength(fresh.text) <= 512000);
  assert.ok(Buffer.byteLength(fresh.generatedText + marker) <= 256000); assert.doesNotMatch(fresh.text, /\uFFFD/);
  assert.match(fresh.generatedText, /old-blocked/); assert.match(fresh.generatedText, /old-active/);
  assert.ok(fresh.generatedText.indexOf('old-active') < fresh.generatedText.indexOf('recent-done-29'));
  assert.equal((await fs.readFile(path, 'utf8')).split(marker)[1], '\n' + user, 'generated refresh preserves the entire user suffix');
  const saved = await f.read('store/write', { path: 'notes.md', text: user });
  assert.equal(saved.userText, user); assert.ok((await fs.stat(path)).size <= 512000);
});

test('reading and progress replies preserve outcomes; explicit handovers consume only exact reports and native terminals', async t => {
  const f = setup(), home = await fs.mkdtemp(join(tmpdir(), 'whale-project-consumed-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  f.service.home = home; f.project.storageRoot = await projectDirectory(home, f.project.id);
  await safeProjectSubdirectory(home, f.project.id, 'docs');
  const item = f.add('continued', true, 0), initial = item.receipt;
  item.work.pendingSummary = true;
  for (let i = 0; i < 12; i++) {
    const ref = `past-ref-${i}`, runId = `past-run-${i}`;
    item.work.delegations.unshift({ ...initial, ref, runId, phase: 'accepted', report: { ...item.report, delegationRef: ref, callId: `past-report-${i}`, summary: `Actual past report ${i}` } });
    item.work.settlements.push({ runId, delegationRefs: [ref], stopReason: 'completed', summary: `Actual past terminal ${i}`, summarizedBy: '' });
  }
  item.work.delegations.unshift({ ...initial, ref: 'no-report-ref', runId: 'no-report-run', phase: 'accepted' });
  item.work.settlements.push({ runId: 'no-report-run', delegationRefs: ['no-report-ref'], stopReason: 'error', summarizedBy: '', summary: 'No report was supplied' });
  await f.service.notes(f.project.id);
  const actor = { role: 'coordinator', project: f.project, agent: f.lead };
  let turn = 1;
  const start = id => {
    f.append('turn/start', { turn: ++turn });
    f.append('user/message', { id, source: { kind: 'user' }, content: [{ type: 'text', text: 'Summarize these stored outcomes; do not restart the work.' }] });
  };
  const reply = async id => {
    await f.service.assistantReply(f.lead.session, f.append('assistant/message', { turn, message: { id, content: [{ type: 'text', text: 'Visible summary of the stated recorded facts.' }] } }));
    await f.service.assistantReply(f.lead.session, f.append('turn/end', { turn, reason: { kind: 'completed' } }));
  };
  const emptyCurrent = await f.service.readStoreTool(actor, { path: 'notes.md' });
  assert.equal(emptyCurrent.work[0].report, undefined); await reply('continued-acknowledgement');
  assert.ok(f.service.stream(item.work.id).settlements.every(terminal => !terminal.summarizedBy), 'a current empty report cannot consume older outcomes');
  start('summary-goal-human');
  const goal = { title: 'Review unfinished work', goal: 'Summarize recorded reports and preserve unfinished work', scopeCeiling: 'readonly', conditions: ['Explain the exact results and unresolved work'] };
  f.append('tool/call', { turn, step: 0, callId: 'accept-summary', name: 'project_request', arguments: JSON.stringify(goal) });
  const request = await f.service.acceptRequest(actor, goal, { callId: 'accept-summary', signal: new AbortController().signal });
  f.result(turn, 'accept-summary', request);
  const handover = async (id, reports, terminalRefs = []) => {
    start(`human-${id}`);
    const args = { requestId: request.id, requestRevision: request.revision, summary: 'Review of exact stored outcomes', outcome: 'partial', evidence: ['Read the referenced records'],
      remainingIssues: ['The original work has unresolved outcomes'], reportRefs: reports.map(report => ({ workstreamId: item.work.id, delegationRef: report.delegationRef, reportId: report.callId })), terminalRefs };
    f.append('tool/call', { turn, step: 0, callId: id, name: 'project_deliver', arguments: JSON.stringify(args) });
    const result = await f.service.deliver(actor, args, { callId: id, signal: new AbortController().signal });
    f.result(turn, id, result);
    await reply(`reply-${id}`);
    assert.equal(f.state.deliveries.find(row => row.id === result.deliveryId).status, 'delivered');
  };
  const first = await f.service.readStoreTool(actor, { path: 'notes.md', workstreamId: item.work.id });
  assert.equal(first.history.items.length, 10); assert.ok(first.nextCursor);
  for (const row of first.history.items) assert.ok(row.terminal.delegationRefs.includes(row.report.delegationRef));
  await reply('first-history-progress');
  assert.ok(f.service.stream(item.work.id).settlements.every(terminal => !terminal.summarizedBy), 'reading historical reports and replying does not declare a handover');
  await handover('first-history-handover', first.history.items.map(row => row.report));
  assert.equal(f.service.stream(item.work.id).settlements.filter(terminal => terminal.summarizedBy).length, 10);
  assert.equal(f.service.stream(item.work.id).pendingSummary, true);
  start('read-last-history');
  const last = await f.service.readStoreTool(actor, { path: 'notes.md', workstreamId: item.work.id, cursor: first.nextCursor });
  assert.equal(last.history.items.length, 2); assert.equal(last.nextCursor, 'terminal:'); await reply('last-history-progress');
  assert.equal(f.service.stream(item.work.id).settlements.filter(terminal => terminal.summarizedBy).length, 10, 'later ordinary replies do not consume unread delivery references');
  await handover('last-history-handover', last.history.items.map(row => row.report));
  const current = f.service.stream(item.work.id);
  assert.ok(current.delegations.filter(receipt => receipt.report).every(receipt => receipt.report.summarizedBy));
  assert.equal(current.settlements.at(-1).summarizedBy, '', 'a terminal omitted from the actual tool response remains unconsumed');
  assert.equal(current.pendingSummary, true);
  start('read-terminal');
  const terminalPage = await f.service.readStoreTool(actor, { path: 'notes.md', workstreamId: item.work.id, cursor: last.nextCursor });
  assert.equal(terminalPage.history.items.length, 1); assert.equal(terminalPage.history.items[0].terminal.summary, 'No report was supplied');
  assert.equal(terminalPage.nextCursor, null); await reply('terminal-progress');
  assert.equal(f.service.stream(item.work.id).pendingSummary, true, 'reading the actual no-report terminal does not consume it');
  await handover('terminal-handover', [], [{ workstreamId: item.work.id, delegationRef: 'no-report-ref', runId: 'no-report-run' }]);
  assert.equal(f.service.stream(item.work.id).pendingSummary, false, 'only its explicit completed handover consumes the exact no-report terminal');
  assert.equal(f.service.stream(item.work.id).settlements.at(-1).summarizedBy, 'reply-terminal-handover');
});

test('materials results page by original report identity without losing previous reports or documents', async t => {
  const f = setup(), home = await fs.mkdtemp(join(tmpdir(), 'whale-project-results-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  f.service.home = home; f.project.storageRoot = await projectDirectory(home, f.project.id);
  const docs = await safeProjectSubdirectory(home, f.project.id, 'docs');
  await fs.writeFile(join(docs, 'proof.md'), 'preserved');
  for (let i = 0; i < 25; i++) f.add(`result-${i}`, false, i).report.at = i;
  const first = await f.read('store/list');
  assert.equal(first.results.length, 10); assert.equal(first.resultsTotal, 25); assert.equal(first.resultsCursor, null);
  assert.deepEqual(first.docs, [{ path: 'docs/proof.md', size: 9 }]);
  const second = await f.read('store/list', { resultsCursor: first.nextResultsCursor });
  const third = await f.read('store/list', { resultsCursor: second.nextResultsCursor });
  assert.equal(second.results.length, 10); assert.equal(third.results.length, 5); assert.equal(third.nextResultsCursor, null);
  assert.equal(new Set([...first.results, ...second.results, ...third.results].map(row => row.report.delegationRef)).size, 25);
  assert.equal(second.resultsCursor, first.nextResultsCursor);
  const continuing = f.state.workstreams.find(work => work.id === second.results[0].workstreamId);
  continuing.delegations.push({ ref: 'continued-ref', phase: 'queued', scope: 'readonly' });
  continuing.currentDelegationRef = 'continued-ref'; delete continuing.latestReport;
  const continued = await f.read('store/list', { resultsCursor: first.nextResultsCursor });
  assert.equal(continued.results[0].current, false); assert.deepEqual(continued.results[0].report, second.results[0].report);
  await assert.rejects(f.read('store/list', { resultsCursor: 'unknown-ref' }), { code: 'result_cursor' });
  const anchor = f.state.workstreams.find(work => work.delegations.some(receipt => receipt.ref === first.nextResultsCursor));
  anchor.delegations.push({ ref: 'replaced-result', report: { delegationRef: 'replaced-result', at: 100, summary: 'New report', artifacts: [] } });
  await assert.rejects(f.read('store/list', { resultsCursor: first.nextResultsCursor }), { code: 'result_cursor' });
  assert.equal((await f.read('store/results', { workstreamId: anchor.id })).items.at(-1).delegationRef, first.nextResultsCursor);
});

test('queued summaries expose the dependency, occupied directory and native capacity actually encountered', async () => {
  const f = setup(), dependency = f.add('Prepare API contract', true, 0), waiting = f.add('Implement client', true, 1);
  waiting.work.blockedBy = [dependency.work.id];
  f.service.ensureTask = async () => ({ id: waiting.work.id, status: 'pending', ready: false, blockedBy: [dependency.work.id] });
  await f.service.doLaunch(waiting.work.id, new AbortController().signal);
  assert.deepEqual((await f.read('workstreams/get', { workstreamId: waiting.work.id })).workstream.delegation.waitingReason,
    { kind: 'dependencies', workTitles: ['Prepare API contract'] });
  await f.service.write(state => {
    const member = state.workers.find(row => row.sessionId === dependency.worker.sessionId); member.directoryHeld = true;
    const work = state.workstreams.find(row => row.id === waiting.work.id); work.blockedBy = []; work.delegations[0].scope = 'worker';
  });
  Object.assign(f.tasks.find(task => task.id === waiting.work.id), { ready: true, blockedBy: [] });
  f.service.ensureTask = async () => ({ id: waiting.work.id, status: 'pending', ready: true, blockedBy: [] });
  await f.service.doLaunch(waiting.work.id, new AbortController().signal);
  assert.deepEqual((await f.read('detail')).workstreams.find(row => row.id === waiting.work.id).delegation.waitingReason,
    { kind: 'directory', workTitles: ['Prepare API contract'] });
  f.service.ensureTask = async () => { const error = new Error('Team task capacity'); error.code = 'TEAM_TASK_LIMIT'; throw error; };
  await f.service.doLaunch(waiting.work.id, new AbortController().signal);
  assert.deepEqual((await f.read('workstreams/get', { workstreamId: waiting.work.id })).workstream.delegation.waitingReason,
    { kind: 'capacity', workTitles: [], code: 'TEAM_TASK_LIMIT' });
});

test('reports preserve host-consumed prerequisite identity and expose later changes without rerunning completed work', async t => {
  const f = setup(), home = await fs.mkdtemp(join(tmpdir(), 'whale-project-prerequisites-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  f.service.home = home; f.project.storageRoot = await projectDirectory(home, f.project.id);
  await safeProjectSubdirectory(home, f.project.id, 'docs');
  const upstream = f.add('API contract', false, 0), dependent = f.add('Client integration', true, 1), legacy = f.add('Legacy result', false, 2);
  upstream.report.callId = 'upstream-report';
  const references = [{ workstreamId: upstream.work.id, title: upstream.work.title, delegationRef: upstream.work.currentDelegationRef, reportId: 'upstream-report' }];
  dependent.receipt.prerequisites = references; dependent.worker.consumedDelegationRef = dependent.receipt.ref;
  dependent.receipt.runId = 'dependent-native-run'; dependent.worker.activeRunId = dependent.receipt.runId;
  const actor = { role: 'worker', agent: { id: dependent.worker.sessionId }, project: f.project };
  await f.service.report(actor, { delegationRef: dependent.receipt.ref, outcome: 'completed', summary: 'Implemented against the received API contract',
    prerequisites: [{ workstreamId: 'forged', title: 'Model claim', delegationRef: 'not-consumed' }] }, { callId: 'dependent-report' });
  await f.service.write(state => { const work = state.workstreams.find(row => row.id === dependent.work.id); work.status = 'done'; delete state.workers.find(row => row.sessionId === dependent.worker.sessionId).activeRunId; });
  f.tasks.find(task => task.id === dependent.work.id).status = 'completed';
  let detail = await f.read('workstreams/get', { workstreamId: dependent.work.id });
  assert.deepEqual(detail.workstream.latestReport.prerequisites, references); assert.equal(detail.workstream.latestReport.prerequisitesChanged, false);
  const versionless = f.add('Versionless snapshot', false, 3);
  versionless.report.prerequisites = [{ workstreamId: upstream.work.id, title: upstream.work.title, delegationRef: upstream.work.currentDelegationRef }];
  await f.service.write(state => {
    const work = state.workstreams.find(row => row.id === upstream.work.id);
    work.delegations.at(-1).report.callId = 'replacement-report-same-assignment';
    work.latestReport.callId = 'replacement-report-same-assignment';
  });
  detail = await f.read('workstreams/get', { workstreamId: dependent.work.id });
  assert.equal(detail.workstream.latestReport.prerequisitesChanged, true, 'replacing a report in the same assignment changes its exact consumed result identity');
  assert.equal((await f.read('workstreams/get', { workstreamId: versionless.work.id })).workstream.latestReport.prerequisitesChanged, false, 'older snapshots without report IDs retain assignment-level semantics');
  await f.service.write(state => {
    const work = state.workstreams.find(row => row.id === upstream.work.id), { report, ...previous } = work.delegations.at(-1);
    work.delegations.push({ ...previous, ref: 'new-user-request', phase: 'queued' });
    work.currentDelegationRef = 'new-user-request'; work.status = 'open'; delete work.latestReport;
  });
  f.tasks.find(task => task.id === upstream.work.id).status = 'pending';
  detail = await f.read('workstreams/get', { workstreamId: dependent.work.id });
  assert.equal(detail.workstream.status, 'done'); assert.equal(detail.workstream.latestReport.prerequisitesChanged, true);
  assert.equal(f.service.stream(dependent.work.id).delegations.length, 1); assert.equal(f.service.worker(dependent.worker.sessionId).activeRunId, undefined);
  assert.equal((await f.read('detail')).workstreams.find(row => row.id === dependent.work.id).prerequisitesChanged, true);
  assert.equal((await f.read('store/list')).results.find(row => row.workstreamId === dependent.work.id).report.prerequisitesChanged, true);
  assert.deepEqual((await f.read('store/results', { workstreamId: dependent.work.id })).items[0].prerequisites, references);
  assert.equal((await f.read('workstreams/get', { workstreamId: legacy.work.id })).workstream.latestReport.prerequisitesChanged, undefined);
  assert.equal(f.service.stream(dependent.work.id).latestReport.prerequisitesChanged, undefined, 'derived warnings never rewrite the saved report');
});

test('a later accepted assignment supersedes every unconsumed queued and preparing receipt without changing member identity', async () => {
  const f = setup(), current = f.add('Continuing work', true, 1), first = current.receipt;
  current.work.delegations.unshift({ ...first, ref: 'older-preparation', phase: 'preparing' }, { ...first, ref: 'older-queued', phase: 'queued' });
  f.append('user/message', { id: 'fresh-human', source: { kind: 'user' }, content: [{ type: 'text', text: 'Continue this investigation with the new requirement.' }] });
  f.append('tool/call', { turn: 1, callId: 'continue-call', name: 'project_delegate' });
  f.service.notes = async () => {}; f.service.launch = async () => {};
  const accepted = await f.service.delegate(f.service.actor(f.lead), { workstreamId: current.work.id, brief: 'Investigate the new requirement', scope: 'readonly' }, { callId: 'continue-call', signal: new AbortController().signal });
  const work = f.service.stream(current.work.id), worker = f.service.worker(current.worker.sessionId);
  assert.equal(work.workerSessionId, current.worker.sessionId); assert.equal(worker.cwd, '/original-cwd');
  assert.equal(work.currentDelegationRef, accepted.delegationRef); assert.equal(work.delegations.length, 4);
  assert.ok(work.delegations.slice(0, 3).every(receipt => receipt.phase === 'stopped' && receipt.supersededBy === accepted.delegationRef && /before consumption/.test(receipt.error)));
  assert.equal(work.delegations.at(-1).phase, 'queued'); assert.equal(worker.activeRunId, undefined);
});

test('the actual consumed native run may report its prior receipt while a later assignment remains queued', async () => {
  const f = setup(), item = f.add('Continuing worker', false, 1), original = item.receipt;
  item.worker.consumedDelegationRef = original.ref; item.worker.activeRunId = original.runId;
  const next = { ...original, ref: 'queued-next', phase: 'queued', runId: '', report: undefined };
  item.work.delegations.push(next); item.work.currentDelegationRef = next.ref; delete item.work.latestReport;
  f.service.notes = async () => {};
  const actor = { role: 'worker', agent: { id: item.worker.sessionId }, project: f.project };
  await f.service.report(actor, { delegationRef: original.ref, outcome: 'completed', summary: 'The actual consumed assignment finished.', artifacts: [], evidence: ['Exact active native run'], remainingIssues: [] }, { callId: 'actual-old-report' });
  const saved = f.service.stream(item.work.id);
  assert.equal(saved.delegations[0].report.callId, 'actual-old-report'); assert.equal(saved.delegations[1].phase, 'queued');
  assert.equal(saved.delegations[1].report, undefined); assert.equal(saved.latestReport, undefined); assert.equal(saved.currentDelegationRef, next.ref);
  await assert.rejects(f.service.report(actor, { delegationRef: next.ref, outcome: 'completed', summary: 'Never consumed' }, { callId: 'forged-next-report' }), { code: 'obsolete_result' });
});

test('peer messages retain their consumed assignment and reject a replacement before binding or native send', async () => {
  const f = setup(), item = f.add('Continuing sender', true, 1), scopes = new Map(), bound = [], delivered = [];
  const agent = { id: item.worker.sessionId };
  f.service.ctx.agents.set(agent.id, agent); f.service.recovering = false;
  item.worker.consumedDelegationRef = item.receipt.ref;
  const next = { ...item.receipt, ref: 'next-assignment', phase: 'preparing', messageId: '', runId: '' };
  item.work.delegations.push(next); item.work.currentDelegationRef = next.ref;
  const teams = f.service.teams;
  teams.listMembers = () => [{ id: f.lead.id, name: 'lead' }];
  teams.messageContext = (_root, id) => scopes.get(id);
  let bindingEntered, releaseBinding;
  teams.bindMessage = async (_root, id, senderAssignment, targetAssignment) => {
    bound.push(id); scopes.set(id, { senderAssignment, targetAssignment });
    if (bindingEntered) { bindingEntered(); await new Promise(resolve => { releaseBinding = resolve; }); }
  };
  teams.sendMessage = async (caller, request) => {
    await f.service.teamAdmission(f.lead, 'send', { caller, request });
    const message = { id: request.messageId, senderId: caller.id, targetId: f.lead.id };
    await f.service.teamAdmission(f.lead, 'deliver', message);
    delivered.push(message); return message;
  };
  const send = callId => f.service.teamSend(f.service.actor(agent), { target: 'lead', message: 'Result from the consumed work' },
    { callId, signal: new AbortController().signal });
  await assert.rejects(send('old-round'), { code: 'team_source' });
  assert.equal(bound.length, 0, 'an unconsumed replacement cannot acquire peer-message context');
  assert.equal(delivered.length, 0);
  const input = { agent, turn: 1, messages: [{ id: 'consume-next', source: { kind: 'user' },
    content: [{ type: 'text', text: `DelegationRef: ${next.ref}` }] }] };
  assert.equal((await f.service.preStep(input, async () => ({ kind: 'enter', messages: input.messages }))).kind, 'enter');
  assert.equal(f.service.worker(agent.id).consumedDelegationRef, next.ref);
  const message = await send('consumed-round');
  assert.equal(scopes.get(message.id).senderAssignment, next.ref);
  assert.equal(delivered.length, 1);
  const binding = new Promise(resolve => { bindingEntered = resolve; });
  const racing = send('replaced-during-bind');
  await binding;
  await f.service.write(state => {
    const work = state.workstreams.find(row => row.id === item.work.id);
    work.delegations.push({ ...next, ref: 'later-assignment', phase: 'queued' }); work.currentDelegationRef = 'later-assignment';
  });
  releaseBinding();
  await assert.rejects(racing, { code: 'team_source' });
  assert.equal(bound.length, 2); assert.equal(delivered.length, 1, 'native send admission rejects an assignment changed during binding');
  await assert.rejects(f.service.teamAdmission(f.lead, 'deliver', message), { code: 'obsolete_message' }, 'a previously sent message also becomes obsolete at delivery');
});

test('archive waits only for its own Project drain and preserves a failed stopping worker', async t => {
  const configure = f => {
    f.service.notes = async () => {}; f.service.schedule = () => {};
    f.service.ctx.logger = { warn() {} };
    f.service.teams.cancelMessages = async () => {}; f.service.teams.setCold = async () => {};
    f.lead.cancel = () => {}; f.lead.whenIdle = async () => {};
  };
  const f = setup(); configure(f);
  f.state.projects[1].coordinatorSessionId = 'other-lead';
  f.service.ctx.agents.set('other-lead', { ...f.lead, id: 'other-lead' });
  const own = f.add('Own worker', true, 1), other = f.add('Other worker', true, 2);
  other.work.projectId = 'other'; other.worker.projectId = 'other';
  for (const item of [own, other]) f.service.ctx.agents.set(item.worker.sessionId,
    { id: item.worker.sessionId, status: 'running', cancel() {}, whenIdle: async () => {} });
  let releaseOwn, releaseOther, ownEntered;
  const ownDrain = new Promise(resolve => { releaseOwn = resolve; }), otherDrain = new Promise(resolve => { releaseOther = resolve; });
  const drainingOwn = new Promise(resolve => { ownEntered = resolve; });
  t.after(() => { releaseOwn(); releaseOther(); });
  f.service.ctx.subagents.drainContinuableChildren = async (_parent, ids) => {
    if (ids.includes(own.worker.sessionId)) { ownEntered(); await ownDrain; }
    if (ids.includes(other.worker.sessionId)) await otherDrain;
  };
  await f.service.stop('other');
  const otherStop = f.service.stops.get(other.worker.sessionId);
  assert.ok(otherStop);
  let archived = false;
  const archive = f.read('archive').then(result => { archived = true; return result; });
  await drainingOwn;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(archived, false, 'the Project cannot archive before its own drain finishes');
  assert.equal(f.service.project(f.project.id).lifecycle, 'ready');
  releaseOwn();
  const outcome = await Promise.race([archive.then(() => 'archived'), new Promise(resolve => setImmediate(() => resolve('still-waiting')))]);
  assert.equal(outcome, 'archived', 'an unrelated Project stop must not hold archive open');
  assert.equal(f.service.worker(own.worker.sessionId).phase, 'idle');
  assert.equal(f.service.worker(other.worker.sessionId).phase, 'stopping');
  assert.equal(f.service.project(f.project.id).lifecycle, 'archived');
  releaseOther(); await otherStop;

  const failed = setup(); configure(failed);
  const stuck = failed.add('Failed drain', true, 1);
  failed.service.ctx.agents.set(stuck.worker.sessionId, { id: stuck.worker.sessionId, status: 'running', cancel() {}, whenIdle: async () => {} });
  failed.service.ctx.subagents.drainContinuableChildren = async () => { throw new Error('Native worker drain failed'); };
  await assert.rejects(failed.read('archive'), { code: 'stopping' });
  assert.equal(failed.service.project(failed.project.id).lifecycle, 'ready');
  assert.equal(failed.service.worker(stuck.worker.sessionId).phase, 'stopping');
  assert.equal(failed.service.worker(stuck.worker.sessionId).error, 'Native worker drain failed');
  assert.equal(failed.service.archiving.has(failed.project.id), false);
});

test('the native launch boundary cannot execute discussed, queued or superseded requirement revisions', async () => {
  for (const kind of ['discussing', 'queued', 'superseded', 'queued-readonly']) {
    const f = setup(); f.service.recovering = false; f.service.notes = async () => {};
    const actor = f.service.actor(f.lead);
    const accept = async (title, extra = {}) => {
      const callId = `accept-${f.events.length}`;
      f.append('user/message', { id: `human-${callId}`, source: { kind: 'user' }, content: [{ type: 'text', text: title }] });
      f.append('tool/call', { turn: 1, callId, name: 'project_request' });
      return f.service.acceptRequest(actor, { title, goal: title, scopeCeiling: 'readonly', ...extra }, { callId, signal: new AbortController().signal });
    };
    if (kind.startsWith('queued')) await accept('A is still developing');
    const request = await accept('B', { disposition: kind === 'discussing' ? 'discussing' : 'queued' });
    const work = f.add(`work-${kind}`, true, 1);
    work.receipt.source = { ...f.service.requirements.version(f.service.requirements.get(f.project.id, request.id)).source };
    if (kind === 'queued') work.receipt.scope = 'worker';
    if (kind === 'superseded') await accept('B revised before launch', { requestId: request.id });
    f.service.ensureTask = async () => ({ id: work.work.id, status: 'pending', ready: true });
    f.tasks.find(task => task.id === work.work.id).ready = true;
    let workspaceCalls = 0;
    f.service.desktop = async () => { workspaceCalls++; throw new Error('An ineligible requirement reached workspace preparation'); };
    if (kind === 'queued-readonly') {
      f.service.teams.setCold = async () => {}; f.service.teams.cancelMessages = async () => {};
      await f.service.doLaunch(work.work.id, new AbortController().signal).catch(() => {});
      // Passing the requirement gate reserves the work; this fixture's materials root then stops it before preparation.
      assert.notEqual(f.service.stream(work.work.id).delegations[0].phase, 'queued', 'an authorized queued requirement may start read-only preparation');
      continue;
    }
    await f.service.doLaunch(work.work.id, new AbortController().signal);
    assert.equal(workspaceCalls, 0, `${kind} requirements never prepare or start worker work`);
    const saved = f.service.stream(work.work.id), worker = f.service.worker(work.worker.sessionId);
    assert.equal(saved.delegations[0].phase, 'queued'); assert.equal(worker.reservationRef, undefined); assert.equal(worker.activeRunId, undefined);
  }
});
