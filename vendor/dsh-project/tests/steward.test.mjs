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
  const { capturedAt, endedAt, deliveryId, ...changes } = state.requests[0].changes;
  assert.ok(capturedAt && endedAt);
  assert.equal(deliveryId, 'delivery-a');
  assert.equal(calls.filter(call => call.action === 'changes').length, 1, 'repeating a delivery cannot absorb the next requirement');
  assert.deepEqual(changes, { isGit: true, baseline: tree, end, fileCount: 2, added: 8, removed: 1,
    files: [{ path: 'src/login.js', status: 'M', added: 3, removed: 1 }, { path: 'src/new.js', status: 'A', added: 5, removed: 0 }] });
  const log = await fs.readFile(join(storageRoot, 'decisions.md'), 'utf8');
  assert.equal(log.match(/decision:delivery-a/g).length, 1, 'a recovered or repeated commit appends once');
  assert.match(log, /Remember me（第 1 版）/); assert.match(log, /完整交付/); assert.match(log, /HttpOnly cookie/);
  assert.match(service.decisionsFor('lead'), /^Recent Project decisions[\s\S]*HttpOnly cookie/);
  const card = service.requirements.card('project', state.requests[0], new Map());
  assert.deepEqual(card.changes, { isGit: true, revertible: true, fileCount: 2, added: 8, removed: 1 });
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

test('requirement changes need a recorded starting point and non-Git directories record no baseline', async t => {
  const { service, state } = await fixture(t, { baseline: () => ({ ok: true, isGit: false }) });
  await assert.rejects(service.requestChanges('project', { requestId: 'request-a' }), error => error.code === 'changes_unavailable');
  await service.captureBaseline('project', 'request-a');
  assert.deepEqual(Object.keys(state.requests[0].changes).sort(), ['capturedAt', 'isGit']); assert.equal(state.requests[0].changes.isGit, false);
  await assert.rejects(service.requestChanges('project', { requestId: 'request-a' }), error => error.code === 'changes_unavailable');
});

test('reverting checks active writers across Projects in the same, parent and child directories', async t => {
  const { service, state, calls } = await fixture(t, { revert: () => ({ ok: true, applied: true }) });
  state.requests[0].changes = { isGit: true, baseline: tree, end, capturedAt: 1 };
  state.projects.push({ ...state.projects[0], id: 'other-project', canonicalWorkingDirectory: '/other-project' });
  state.workers.push({ sessionId: 'other-writer', projectId: 'other-project', workstreamId: 'other-work', mode: 'existing', directoryHeld: true });
  for (const directory of ['/repo', '/', '/repo/child']) {
    state.workers[0].cwd = directory;
    await assert.rejects(service.command('requests/revert', { projectId: 'project', requestId: 'request-a' }), { code: 'busy' });
  }
  assert.equal(calls.filter(call => call.action === 'revert').length, 0, 'a blocked revert never reaches the file writer');
  state.workers[0].cwd = '/repo-neighbour';
  assert.deepEqual(await service.command('requests/revert', { projectId: 'project', requestId: 'request-a' }), { requestId: 'request-a', reverted: true });
});

test('a requirement tracks each actual member directory once and reads and reverts the exact scopes', async t => {
  const { service, state, calls } = await fixture(t, {
    baseline: payload => ({ isGit: true, tree: payload.workingDirectory === '/repo' ? tree : 'c'.repeat(40) }),
    changes: payload => ({ end: payload.workingDirectory === '/repo' ? end : 'd'.repeat(40),
      files: [{ path: 'result.txt', status: 'M', added: 2, removed: 1 }], diff: `diff --git a/result.txt b/result.txt\n-${payload.base}\n+${payload.workingDirectory}\n` }),
    revert: () => ({ ok: true, applied: true }),
  });
  const worker = (workstreamId, cwd, mode) => ({ workstreamId, cwd, mode, workspace: { canonicalPath: cwd, receipt: `${workstreamId}-receipt` } });
  const first = worker('primary-worker', '/repo', 'existing'), isolated = worker('isolated-worker', '/isolated', 'worktree');
  await service.captureBaseline('project', 'request-a', first);
  await service.captureBaseline('project', 'request-a', worker('another-primary-worker', '/repo', 'existing'));
  await service.captureBaseline('project', 'request-a', isolated);
  assert.deepEqual(calls.filter(call => call.action === 'baseline').map(call => call.payload), [
    { projectId: 'project', workingDirectory: '/repo', workstreamId: first.workstreamId, workspace: first.workspace },
    { projectId: 'project', workingDirectory: '/isolated', workstreamId: isolated.workstreamId, workspace: isolated.workspace },
  ]);
  state.deliveries.push({ id: 'multi-delivery', projectId: 'project', requestId: 'request-a', requestRevision: 1, title: 'Remember me', summary: 'Done', outcome: 'completed', status: 'delivered' });
  await service.afterDelivery('multi-delivery');
  assert.equal(state.requests[0].changes.workspaces.length, 2);
  assert.equal(state.requests[0].changes.fileCount, 2);
  assert.equal(service.changesRevertible(state.requests[0]), true);
  const value = await service.command('requests/changes', { projectId: 'project', requestId: 'request-a' });
  assert.deepEqual(value.files.map(file => [file.path, file.workingDirectory]), [['result.txt', '/repo'], ['result.txt', '/isolated']]);
  assert.match(value.diff, /Working directory: \/repo/); assert.match(value.diff, /Working directory: \/isolated/);
  assert.equal(value.final, true);
  await service.command('requests/revert', { projectId: 'project', requestId: 'request-a' });
  assert.deepEqual(calls.filter(call => call.action === 'revert').map(call => [call.payload.workingDirectory, Boolean(call.payload.checkOnly), call.payload.base, call.payload.end]), [
    ['/repo', true, tree, end], ['/isolated', true, 'c'.repeat(40), 'd'.repeat(40)],
    ['/repo', false, tree, end], ['/isolated', false, 'c'.repeat(40), 'd'.repeat(40)],
  ]);
  assert.ok(state.requests[0].changes.revertedAt);
  assert.equal(service.changesRevertible(state.requests[0]), false);
});

test('multi-directory revert preflights every scope and records partial application before a retry', async t => {
  let conflict = true, failApply = false;
  const { service, state, calls } = await fixture(t, { revert: payload => {
    if (payload.workingDirectory === '/isolated' && conflict) return { conflict: true, message: 'Later isolated edits' };
    if (!payload.checkOnly && payload.workingDirectory === '/isolated' && failApply) throw new Error('Isolated file is locked');
    return { ok: true, applied: !payload.checkOnly };
  } });
  state.requests[0].changes = { isGit: true, capturedAt: 1, workspaces: ['/repo', '/isolated'].map(workingDirectory => ({ workingDirectory, isGit: true, baseline: tree, end, capturedAt: 1 })) };
  await assert.rejects(service.command('requests/revert', { projectId: 'project', requestId: 'request-a' }), { code: 'revert_conflict' });
  assert.ok(calls.every(call => call.payload.checkOnly), 'a conflict in the second scope cannot apply the first scope');
  assert.ok(state.requests[0].changes.workspaces.every(area => !area.revertedAt));
  conflict = false; failApply = true; calls.length = 0;
  await assert.rejects(service.command('requests/revert', { projectId: 'project', requestId: 'request-a' }), error => error.code === 'revert_partial'
    && /Reverted directories:\n\/repo\nNot reverted:\n\/isolated/.test(error.message));
  assert.ok(state.requests[0].changes.workspaces[0].revertedAt);
  assert.equal(state.requests[0].changes.workspaces[1].revertedAt, undefined);
  assert.equal(service.changesRevertible(state.requests[0]), true);
  failApply = false; calls.length = 0;
  await service.command('requests/revert', { projectId: 'project', requestId: 'request-a' });
  assert.deepEqual(calls.map(call => call.payload.workingDirectory), ['/isolated'], 'retry does not reverse an already reverted directory again');
  assert.ok(state.requests[0].changes.revertedAt);
});

test('a failed workspace baseline remains explicit and cannot become a later fabricated starting point', async t => {
  const { service, state, calls } = await fixture(t, { baseline: payload => {
    if (payload.workingDirectory === '/isolated') throw new Error('Snapshot path exceeds authorized directory');
    return { isGit: true, tree };
  } });
  const member = (workstreamId, cwd) => ({ workstreamId, cwd, workspace: { canonicalPath: cwd, receipt: workstreamId } });
  await service.captureBaseline('project', 'request-a', member('primary', '/repo'));
  await service.captureBaseline('project', 'request-a', member('isolated', '/isolated'));
  await service.captureBaseline('project', 'request-a', member('isolated-again', '/isolated'));
  assert.equal(calls.filter(call => call.action === 'baseline').length, 2, 'a baseline is never retried after that directory may already have been written');
  assert.equal(state.requests[0].changes.workspaces[1].error, 'Snapshot path exceeds authorized directory');
  assert.equal(service.changesRevertible(state.requests[0]), false);
  await assert.rejects(service.command('requests/changes', { projectId: 'project', requestId: 'request-a' }), error => error.code === 'changes_unavailable' && /\/isolated: Snapshot path/.test(error.message));
  await assert.rejects(service.command('requests/revert', { projectId: 'project', requestId: 'request-a' }), { code: 'revert_unavailable' });
  assert.equal(calls.filter(call => call.action !== 'baseline').length, 0, 'partial known scopes do not silently replace the whole requirement');
});

test('a legacy main-only snapshot remains usable but cannot stand in for an executed isolated directory', async t => {
  const { service, state, calls } = await fixture(t, { changes: () => ({ end, files: [], diff: '' }) });
  const saved = { isGit: true, baseline: tree, end, capturedAt: 1 };
  state.requests[0].changes = structuredClone(saved);
  await service.command('requests/changes', { projectId: 'project', requestId: 'request-a' });
  assert.equal(service.changesRevertible(state.requests[0]), true, 'valid main-only legacy tracking keeps its contract');
  state.workers.push({ sessionId: 'old-isolated', workstreamId: 'old-work', projectId: 'project', cwd: '/original-isolated', mode: 'worktree' });
  state.workstreams.push({ id: 'old-work', projectId: 'project', workerSessionId: 'old-isolated', delegations: [{ scope: 'worker', runId: 'old-run', source: { requestId: 'request-a' } }] });
  const before = structuredClone(state.requests[0].changes), count = calls.length;
  await assert.rejects(service.command('requests/changes', { projectId: 'project', requestId: 'request-a' }), error => error.code === 'changes_unavailable' && /\/original-isolated/.test(error.message));
  await assert.rejects(service.command('requests/revert', { projectId: 'project', requestId: 'request-a' }), error => error.code === 'revert_unavailable' && /missing starting points/.test(error.message));
  await service.captureBaseline('project', 'request-a', { workstreamId: 'old-work', cwd: '/original-isolated' });
  assert.equal(service.changesRevertible(state.requests[0]), false);
  assert.deepEqual(state.requests[0].changes, before); assert.equal(calls.length, count, 'the original record is preserved, not overwritten by a late snapshot');
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

