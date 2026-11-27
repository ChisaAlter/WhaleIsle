import test from 'node:test';
import assert from 'node:assert/strict';
import './harness-runtime.mjs';

const { createRunner } = await import('../lib/runner.js');

function makeRunnerWithReads(reads) {
  let readIndex = 0;
  const store = {
    async readProject() {
      const idx = Math.min(readIndex, reads.length - 1);
      readIndex += 1;
      return structuredClone(reads[idx]);
    },
    async withProjectLock(_projectId, fn) {
      return await fn();
    },
    async writeProject() {},
    emitChange() {},
  };
  const memory = { memoryDir: () => '' };
  const worktree = {};
  const ctx = { get: () => undefined };
  return createRunner({ ctx, store, memory, worktree, notifyBatchMs: 0 });
}

test('stopTask raises 404/409 httpError across missing task, idle task, and lock-race removal', async () => {
  // 1) stopTask: missing task on initial read (404 task_not_found)
  const runnerMissing = makeRunnerWithReads([{ id: 'p1', tasks: [] }]);
  await assert.rejects(
    () => runnerMissing.stopTask('p1', 't1'),
    (error) => error instanceof Error && !(error instanceof ReferenceError) && error.status === 404 && error.message === 'task_not_found',
  );

  // 2) stopTask: task exists but is not live (409 task_not_running)
  const runnerIdle = makeRunnerWithReads([
    { id: 'p1', tasks: [{ id: 't1', status: 'queued', dependsOn: [] }] },
  ]);
  await assert.rejects(
    () => runnerIdle.stopTask('p1', 't1'),
    (error) => error instanceof Error && !(error instanceof ReferenceError) && error.status === 409 && error.message === 'task_not_running',
  );

  // 3) stopTask: task disappears before locked write (404 task_not_found inside withProjectLock)
  const runnerLockRace = makeRunnerWithReads([
    { id: 'p1', tasks: [{ id: 't1', status: 'running', childSessionId: 'child-1', dependsOn: [] }] },
    { id: 'p1', tasks: [] },
  ]);
  await assert.rejects(
    () => runnerLockRace.stopTask('p1', 't1'),
    (error) => error instanceof Error && !(error instanceof ReferenceError) && error.status === 404 && error.message === 'task_not_found',
  );
});

test('retryTask raises 404/409/400 httpError across missing, running, and resolved tasks', async () => {
  // 4) retryTask: missing task (404 task_not_found)
  const runnerMissing = makeRunnerWithReads([{ id: 'p1', tasks: [] }]);
  await assert.rejects(
    () => runnerMissing.retryTask('p1', 't1'),
    (error) => error instanceof Error && !(error instanceof ReferenceError) && error.status === 404 && error.message === 'task_not_found',
  );

  // 5) retryTask: running task (409 task_already_running)
  const runnerRunning = makeRunnerWithReads([
    { id: 'p1', tasks: [{ id: 't1', status: 'running', dependsOn: [] }] },
  ]);
  await assert.rejects(
    () => runnerRunning.retryTask('p1', 't1'),
    (error) => error instanceof Error && !(error instanceof ReferenceError) && error.status === 409 && error.message === 'task_already_running',
  );

  // 6) retryTask: resolved task (400 task_already_resolved)
  const runnerResolved = makeRunnerWithReads([
    { id: 'p1', tasks: [{ id: 't1', status: 'resolved', dependsOn: [] }] },
  ]);
  await assert.rejects(
    () => runnerResolved.retryTask('p1', 't1'),
    (error) => error instanceof Error && !(error instanceof ReferenceError) && error.status === 400 && error.message === 'task_already_resolved',
  );
});
