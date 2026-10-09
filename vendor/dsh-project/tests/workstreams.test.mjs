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
  const tasks = [], lead = { id: 'lead', status: 'idle', session: { id: 'lead', snapshotEvents: () => [{ type: 'turn/start', data: { turn: 1 } }] } };
  const teams = { registerPolicy: () => () => {}, listTasks: () => tasks };
  const ctx = { agents: new Map([['lead', lead]]), sessionPersistence: { stat: async () => ({}) }, get: () => undefined,
    subagents: { registerContinuationPolicy: () => () => {} }, agentTeams: teams };
  const service = new ProjectService(ctx, { get: () => state, update: async (_key, change) => { Object.assign(state, change(state)); } }, { home: '', desktop: async () => ({}) });
  function add(id, current, updatedAt) {
    const report = { delegationRef: `ref-${id}`, summary: `Full report ${id}`, outcome: 'completed', evidence: [], remainingIssues: [], artifacts: [{ path: `/original-cwd/result/${id}`, sha256: 'recorded-hash' }] };
    const receipt = { ref: `ref-${id}`, phase: current ? 'queued' : 'accepted', scope: 'readonly',
      brief: 'Assignment text '.repeat(1000), source: { text: 'Original human text '.repeat(1000) }, ...(current ? {} : { report }) };
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
  return { service, state, tasks, project, add, read, lead };
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
  work.delegations.push({ ref: 'new-request', phase: 'queued', scope: 'readonly' }); work.currentDelegationRef = 'new-request';
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
  assert.equal(project.activity.blocked, 0); assert.equal(project.activity.pendingSummary, 1); assert.equal(project.activity.state, 'pendingSummary');
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

test('notes and progress replies preserve pending results; historical results remain bounded and reachable', async t => {
  const f = setup(), home = await fs.mkdtemp(join(tmpdir(), 'whale-project-consumed-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  f.service.home = home; f.project.storageRoot = await projectDirectory(home, f.project.id);
  await safeProjectSubdirectory(home, f.project.id, 'docs');
  const item = f.add('continued', true, 0), initial = item.receipt;
  item.work.pendingSummary = true;
  for (let i = 0; i < 12; i++) {
    const ref = `past-ref-${i}`, runId = `past-run-${i}`;
    item.work.delegations.unshift({ ...initial, ref, runId, phase: 'accepted', report: { ...item.report, delegationRef: ref, summary: `Actual past report ${i}` } });
    item.work.settlements.push({ runId, delegationRefs: [ref], summary: `Actual past terminal ${i}`, summarizedBy: '' });
  }
  item.work.settlements.push({ runId: 'no-report-run', delegationRefs: ['no-report-ref'], summarizedBy: '', summary: 'No report was supplied' });
  await f.service.notes(f.project.id);
  const actor = { role: 'coordinator', project: f.project, agent: f.lead };
  const reply = id => f.service.assistantReply(f.lead.session, { type: 'assistant/message', data: { turn: 1, interrupted: false, message: { id, content: [{ type: 'text', text: 'Visible summary of the facts just read.' }] } } });
  const emptyCurrent = await f.service.readStoreTool(actor, { path: 'notes.md' });
  assert.equal(emptyCurrent.work[0].report, undefined); await reply('continued-acknowledgement');
  assert.ok(f.service.stream(item.work.id).settlements.every(terminal => !terminal.summarizedBy), 'a current empty report cannot consume older outcomes');
  const first = await f.service.readStoreTool(actor, { path: 'notes.md', workstreamId: item.work.id });
  assert.equal(first.history.items.length, 10); assert.ok(first.nextCursor);
  for (const row of first.history.items) assert.ok(row.terminal.delegationRefs.includes(row.report.delegationRef));
  await reply('first-history-summary');
  assert.equal(f.service.stream(item.work.id).settlements.filter(terminal => terminal.summarizedBy).length, 0);
  assert.equal(f.service.stream(item.work.id).pendingSummary, true);
  const last = await f.service.readStoreTool(actor, { path: 'notes.md', workstreamId: item.work.id, cursor: first.nextCursor });
  assert.equal(last.history.items.length, 2); assert.equal(last.nextCursor, 'terminal:'); await reply('last-history-summary');
  const current = f.service.stream(item.work.id);
  assert.ok(current.delegations.filter(receipt => receipt.report).every(receipt => !receipt.report.summarizedBy));
  assert.equal(current.settlements.at(-1).summarizedBy, '', 'a terminal omitted from the actual tool response remains unconsumed');
  assert.equal(current.pendingSummary, true);
  const terminalPage = await f.service.readStoreTool(actor, { path: 'notes.md', workstreamId: item.work.id, cursor: last.nextCursor });
  assert.equal(terminalPage.history.items.length, 1); assert.equal(terminalPage.history.items[0].terminal.summary, 'No report was supplied');
  assert.equal(terminalPage.nextCursor, null); await reply('actual-terminal-summary');
  assert.equal(f.service.stream(item.work.id).pendingSummary, true, 'reading a terminal and replying cannot replace explicit delivery');
});

test('materials results page by original report identity without losing previous reports or documents', async t => {
  const f = setup(), home = await fs.mkdtemp(join(tmpdir(), 'whale-project-results-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  f.service.home = home; f.project.storageRoot = await projectDirectory(home, f.project.id);
  const docs = await safeProjectSubdirectory(home, f.project.id, 'docs');
  await fs.writeFile(join(docs, 'proof.md'), 'preserved');
  for (let i = 0; i < 25; i++) f.add(`result-${i}`, false, i).report.at = i;
  f.state.requests = [{ id: 'request-one', projectId: f.project.id, currentVersion: 1, versions: [{ version: 1, goal: 'Delivered work' }] }];
  f.state.deliveries = Array.from({ length: 12 }, (_, index) => ({ id: `delivery-${index}`, projectId: f.project.id, requestId: 'request-one', requestVersion: 1, committedAt: index + 1, references: [], requiredWork: [], evidence: [], remainingIssues: [] }));
  const first = await f.read('store/list');
  assert.equal(first.results.length, 10); assert.equal(first.resultsTotal, 25); assert.equal(first.resultsCursor, null);
  assert.equal(first.deliveries.length, 10); assert.equal(first.deliveriesTotal, 12);
  assert.deepEqual(first.docs, [{ path: 'docs/proof.md', size: 9 }]);
  const second = await f.read('store/list', { resultsCursor: first.nextResultsCursor });
  const third = await f.read('store/list', { resultsCursor: second.nextResultsCursor });
  assert.equal(second.results.length, 10); assert.equal(third.results.length, 5); assert.equal(third.nextResultsCursor, null);
  assert.equal(new Set([...first.results, ...second.results, ...third.results].map(row => row.report.delegationRef)).size, 25);
  assert.equal(second.resultsCursor, first.nextResultsCursor);
  assert.deepEqual(second.deliveries, first.deliveries, 'member report pages do not advance deliveries');
  const deliveryPage = await f.read('store/list', { resultsCursor: first.nextResultsCursor, deliveryCursor: first.nextDeliveryCursor });
  assert.equal(deliveryPage.deliveries.length, 2); assert.deepEqual(deliveryPage.results, second.results, 'delivery pages do not reset member report position');
  await assert.rejects(f.read('store/list', { deliveryCursor: 'foreign-delivery' }), { code: 'result_cursor' });
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

test('historical process navigation returns the original native assignment anchor, not the latest receipt', async () => {
  const f = setup(), item = f.add('continued-work', false, 1);
  item.receipt.runId = 'original-run'; item.receipt.messageId = 'actual-native-assignment-input';
  item.work.delegations.push({ ref: 'next-assignment', runId: 'new-run', phase: 'accepted', scope: 'readonly' }); item.work.currentDelegationRef = 'next-assignment';
  const value = await f.read('workstreams/get', { workstreamId: item.work.id, delegationRef: item.receipt.ref, runId: 'original-run' });
  assert.equal(value.workstream.processAnchor.messageId, 'actual-native-assignment-input');
  assert.equal(value.workstream.processAnchor.runId, 'original-run'); assert.equal(value.workstream.delegation.ref, 'next-assignment');
  await assert.rejects(f.read('workstreams/get', { workstreamId: item.work.id, delegationRef: item.receipt.ref, runId: 'new-run' }), { code: 'result_identity' });
  await assert.rejects(f.read('workstreams/get', { workstreamId: item.work.id, delegationRef: 'foreign-assignment' }), { code: 'result_identity' });
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
  const actor = { role: 'worker', agent: { id: dependent.worker.sessionId }, project: f.project };
  await f.service.report(actor, { delegationRef: dependent.receipt.ref, outcome: 'completed', summary: 'Implemented against the received API contract',
    prerequisites: [{ workstreamId: 'forged', title: 'Model claim', delegationRef: 'not-consumed' }] }, { callId: 'dependent-report' });
  await f.service.write(state => { const work = state.workstreams.find(row => row.id === dependent.work.id); work.status = 'done'; });
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
