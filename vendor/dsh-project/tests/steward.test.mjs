import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { ProjectService } from './harness-runtime.mjs';
import { projectDirectory, safeProjectSubdirectory } from '../lib/files.js';

const tree = 'a'.repeat(40), end = 'b'.repeat(40);

async function fixture(t, handlers = {}) {
  const home = await fs.mkdtemp(join(os.tmpdir(), 'whale-steward-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const storageRoot = await projectDirectory(home, 'project');
  await safeProjectSubdirectory(home, 'project', 'docs'); // created with every real Project
  const project = { id: 'project', title: 'Steward', canonicalWorkingDirectory: '/repo', coordinatorSessionId: 'lead', storageRoot, lifecycle: 'ready', paused: false, diagnostics: [], holdSourceMessageId: '', updatedAt: 0 };
  const request = { id: 'request-a', projectId: 'project', title: 'Remember me', revision: 1, queue: { state: 'active' }, createdAt: 1, updatedAt: 1,
    versions: [{ revision: 1, goal: 'Add remember me', constraints: [], conditions: ['Works'], scope: 'worker', writePaths: [], at: 1 }] };
  const state = { revision: 0, projects: [project], workstreams: [], workers: [], requests: [request], deliveries: [] }, calls = [];
  const desktop = async (action, payload) => { calls.push({ action, payload }); if (!handlers[action]) throw new Error(`unexpected desktop ${action}`); return handlers[action](payload); };
  const ctx = { agents: new Map(), logger: { warn() {} }, get: () => undefined, sessions: { flush: async () => true }, sessionPersistence: { stat: async () => ({}) },
    subagents: { registerContinuationPolicy: () => () => {}, drainChildren: async () => {} }, agentTeams: { registerPolicy: () => () => {}, listTasks: () => [] } };
  const service = new ProjectService(ctx, { get: () => state, update: async (_key, change) => Object.assign(state, change(state)) }, { home, desktop });
  service.recovering = false; service.notes = async () => {};
  return { service, state, calls, storageRoot };
}

test('a requirement records one baseline, its delivered changes and an idempotent decision log entry', async t => {
  const { service, state, calls, storageRoot } = await fixture(t, {
    baseline: () => ({ ok: true, isGit: true, tree }),
    changes: payload => { assert.equal(payload.base, tree); assert.equal(payload.workingDirectory, '/repo');
      return { ok: true, end, files: [{ path: 'src/login.js', status: 'M', added: 3, removed: 1 }, { path: 'src/new.js', status: 'A', added: 5, removed: 0 }] }; },
  });
  await service.captureBaseline('project', 'request-a'); await service.captureBaseline('project', 'request-a');
  assert.equal(calls.filter(call => call.action === 'baseline').length, 1, 'later delegations keep the original starting point');
  assert.equal(state.requests[0].changes.baseline, tree);
  state.deliveries.push({ id: 'delivery-a', projectId: 'project', requestId: 'request-a', requestRevision: 1, title: 'Remember me', summary: '## Done\nAdded remember me.',
    outcome: 'completed', status: 'delivered', decision: 'Store the token in an HttpOnly cookie because the API is same-origin.',
    evidence: [], remainingIssues: [], reportRefs: [], terminalRefs: [], requiredDelegations: [], at: 3 });
  await service.afterDelivery('delivery-a'); await service.afterDelivery('delivery-a');
  const { capturedAt, endedAt, ...changes } = state.requests[0].changes;
  assert.ok(capturedAt && endedAt);
  assert.deepEqual(changes, { isGit: true, baseline: tree, end, fileCount: 2, added: 8, removed: 1,
    files: [{ path: 'src/login.js', status: 'M', added: 3, removed: 1 }, { path: 'src/new.js', status: 'A', added: 5, removed: 0 }] });
  const log = await fs.readFile(join(storageRoot, 'decisions.md'), 'utf8');
  assert.equal(log.match(/decision:delivery-a/g).length, 1, 'a recovered or repeated commit appends once');
  assert.match(log, /Remember me（第 1 版）/); assert.match(log, /完整交付/); assert.match(log, /HttpOnly cookie/);
  assert.match(service.decisionsFor('lead'), /^Recent Project decisions[\s\S]*HttpOnly cookie/);
  const card = service.requirements.card('project', state.requests[0], new Map());
  assert.deepEqual(card.changes, { isGit: true, revertible: true, fileCount: 2, added: 8, removed: 1 });
});

test('unloading waits for in-flight delivery accounting before releasing Project files', async t => {
  let releaseChanges;
  const changesGate = new Promise(done => { releaseChanges = done; });
  const { service, state, storageRoot } = await fixture(t, {
    baseline: () => ({ ok: true, isGit: true, tree }),
    changes: async () => { await changesGate; return { ok: true, end, files: [] }; },
  });
  await service.captureBaseline('project', 'request-a');
  state.deliveries.push({ id: 'delivery-c', projectId: 'project', requestId: 'request-a', requestRevision: 1, title: 'Remember me', summary: 'Done.',
    outcome: 'completed', status: 'delivered', decision: 'Late decision', evidence: [], remainingIssues: [], reportRefs: [], terminalRefs: [], requiredDelegations: [], at: 3 });
  service.track(service.afterDelivery('delivery-c'), 'Project summary accounting failed');
  let disposed = false;
  const disposal = service.dispose({ persist: false }).then(() => { disposed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposed, false, 'disposal waits while the decision is still being recorded');
  releaseChanges(); await disposal;
  assert.match(await fs.readFile(join(storageRoot, 'decisions.md'), 'utf8'), /decision:delivery-c/, 'the decision lands before the writer is released');
});

test('a delivery without a decision falls back to its first summary line', async t => {
  const { service, state, storageRoot } = await fixture(t);
  state.deliveries.push({ id: 'delivery-b', projectId: 'project', requestId: 'request-a', requestRevision: 1, title: 'Remember me', summary: '# Result\n\n- Added the checkbox and tests.', outcome: 'partial', status: 'delivered' });
  await service.afterDelivery('delivery-b');
  const log = await fs.readFile(join(storageRoot, 'decisions.md'), 'utf8');
  assert.match(log, /部分交付/); assert.match(log, /决策：Result/);
});

test('reverting refuses busy directories and conflicts, then records one revert and a fresh baseline for later work', async t => {
  let conflict = true, baselines = 0;
  const { service, state, storageRoot } = await fixture(t, {
    revert: payload => { assert.deepEqual([payload.base, payload.end], [tree, end]);
      return conflict ? { ok: true, applied: false, conflict: true, message: 'error: patch failed: src/login.js:1' } : { ok: true, applied: true }; },
    baseline: () => { baselines++; return { ok: true, isGit: true, tree: 'c'.repeat(40) }; },
  });
  state.requests[0].changes = { isGit: true, baseline: tree, end, capturedAt: 1, endedAt: 2, fileCount: 1, added: 1, removed: 0, files: [] };
  service.queue.busy = () => true;
  await assert.rejects(service.revertRequest('project', { requestId: 'request-a' }), error => error.code === 'busy');
  service.queue.busy = () => false;
  await assert.rejects(service.revertRequest('project', { requestId: 'request-a' }), error => error.code === 'revert_conflict' && /patch failed/.test(error.message));
  assert.equal(state.requests[0].changes.revertedAt, undefined, 'a conflicting revert records nothing');
  conflict = false;
  assert.deepEqual(await service.revertRequest('project', { requestId: 'request-a' }), { requestId: 'request-a', reverted: true });
  assert.ok(state.requests[0].changes.revertedAt);
  assert.equal(service.requirements.card('project', state.requests[0], new Map()).changes.revertible, false);
  await assert.rejects(service.revertRequest('project', { requestId: 'request-a' }), error => error.code === 'revert_unavailable');
  assert.match(await fs.readFile(join(storageRoot, 'decisions.md'), 'utf8'), /已撤销改动/);
  await service.captureBaseline('project', 'request-a');
  assert.equal(baselines, 1); assert.equal(state.requests[0].changes.baseline, 'c'.repeat(40)); assert.equal(state.requests[0].changes.revertedAt, undefined);
});

test('reverting waits for overlapping writers in any Project and never records a revert that changed nothing', async t => {
  let reverts = 0, applied = false;
  const { service, state } = await fixture(t, { revert: () => { reverts++; return { ok: true, applied }; } });
  state.requests[0].changes = { isGit: true, baseline: tree, end, capturedAt: 1, endedAt: 2, fileCount: 1, added: 1, removed: 0, files: [] };
  // Another Project bound to a subdirectory is still running in place.
  state.projects.push({ ...state.projects[0], id: 'other', title: 'Other', canonicalWorkingDirectory: join('/repo', 'packages', 'api'), coordinatorSessionId: 'other-lead' });
  state.workers.push({ sessionId: 'other-worker', projectId: 'other', workstreamId: 'other-work', cwd: '', role: 'worker', mode: 'existing', phase: 'active', directoryHeld: true, stopped: false, materialized: true, activeRunId: 'run-1', reservationRef: '' });
  await assert.rejects(service.revertRequest('project', { requestId: 'request-a' }), error => error.code === 'busy');
  assert.equal(reverts, 0, 'no patch is applied while the overlapping directory is in use');
  Object.assign(state.workers[0], { phase: 'idle', directoryHeld: false, activeRunId: '' });
  await assert.rejects(service.revertRequest('project', { requestId: 'request-a' }), error => error.code === 'revert_unavailable');
  assert.equal(reverts, 1); assert.equal(state.requests[0].changes.revertedAt, undefined, 'an empty patch is not reported as reverted');
  applied = true;
  assert.deepEqual(await service.revertRequest('project', { requestId: 'request-a' }), { requestId: 'request-a', reverted: true });
});

test('requirement work in an isolated worktree is marked, shown honestly and not reverted from the Project directory', async t => {
  let reverts = 0;
  const { service, state } = await fixture(t, {
    baseline: () => ({ ok: true, isGit: true, tree }),
    changes: () => ({ ok: true, end: tree, files: [] }),
    revert: () => { reverts++; return { ok: true, applied: true }; },
  });
  await service.captureBaseline('project', 'request-a');
  state.workstreams.push({ id: 'work-a', projectId: 'project', title: 'Isolated', workerSessionId: 'worker-a', delegations: [{ ref: 'ref-a', scope: 'worker', source: { requestId: 'request-a', requestRevision: 1 } }] });
  state.workers.push({ sessionId: 'worker-a', projectId: 'project', workstreamId: 'work-a', cwd: '/worktrees/work-a', role: 'worker', mode: 'worktree', phase: 'idle', directoryHeld: false, stopped: false, materialized: true, activeRunId: '', reservationRef: '' });
  state.deliveries.push({ id: 'delivery-i', projectId: 'project', requestId: 'request-a', requestRevision: 1, title: 'Remember me', summary: 'Done.',
    outcome: 'completed', status: 'delivered', evidence: [], remainingIssues: [], reportRefs: [], terminalRefs: [], requiredDelegations: [], at: 3 });
  await service.afterDelivery('delivery-i');
  assert.equal(state.requests[0].changes.isolated, true);
  state.workstreams.length = 0; // the marker is durable; the card no longer needs the member rows
  const card = service.requirements.card('project', state.requests[0], new Map());
  assert.equal(card.changes.revertible, false); assert.equal(card.changes.isolated, true);
  await assert.rejects(service.revertRequest('project', { requestId: 'request-a' }), error => error.code === 'revert_unavailable');
  assert.equal(reverts, 0); assert.equal(state.requests[0].changes.revertedAt, undefined);
});

test('requirement changes need a recorded starting point and non-Git directories record no baseline', async t => {
  const { service, state } = await fixture(t, { baseline: () => ({ ok: true, isGit: false }) });
  await assert.rejects(service.requestChanges('project', { requestId: 'request-a' }), error => error.code === 'changes_unavailable');
  await service.captureBaseline('project', 'request-a');
  assert.deepEqual(Object.keys(state.requests[0].changes).sort(), ['capturedAt', 'isGit']); assert.equal(state.requests[0].changes.isGit, false);
  await assert.rejects(service.requestChanges('project', { requestId: 'request-a' }), error => error.code === 'changes_unavailable');
});

test('a queued requirement may start read-only preparation while every write waits for activation', async t => {
  const { service, state } = await fixture(t);
  const row = (id, queue, revision = 1) => ({ ...structuredClone(state.requests[0]), id, title: id, revision, queue });
  state.requests = [row('active', { state: 'active' }), row('queued', { state: 'queued', order: 1 }), row('discussing', { state: 'discussing' }), row('cancelled', { state: 'cancelled' })];
  const get = id => state.requests.find(item => item.id === id), queue = service.queue;
  for (const scope of ['readonly', 'worker', 'docs']) assert.equal(queue.acceptsWork(get('active'), 1, scope), true, `active accepts ${scope}`);
  assert.equal(queue.acceptsWork(get('queued'), 1, 'readonly'), true);
  for (const scope of ['worker', 'docs', 'write']) assert.equal(queue.acceptsWork(get('queued'), 1, scope), false, `queued refuses ${scope}`);
  assert.equal(queue.acceptsWork(get('queued'), 2, 'readonly'), false, 'a stale revision cannot run');
  for (const id of ['discussing', 'cancelled']) assert.equal(queue.acceptsWork(get(id), 1, 'readonly'), false, `${id} cannot run even read-only work`);
  assert.throws(() => queue.assertWork(get('queued'), 1, 'worker'), error => error.code === 'request_queued' && /may only run read-only preparation/.test(error.message));
  assert.throws(() => queue.assertWork(get('discussing'), 1, 'readonly'), error => error.code === 'request_queued');
  state.deliveries.push({ id: 'done', projectId: 'project', requestId: 'queued', requestRevision: 1, title: 'queued', summary: 'Done', outcome: 'completed', status: 'delivered',
    evidence: [], remainingIssues: [], reportRefs: [], terminalRefs: [], requiredDelegations: [], at: 1 });
  assert.equal(queue.acceptsWork(get('queued'), 1, 'readonly'), false, 'a completed requirement needs a new revision before more work');
});

