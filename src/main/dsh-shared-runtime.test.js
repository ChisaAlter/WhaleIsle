'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '../..');
const pathGuardUrl = pathToFileURL(path.join(ROOT, 'vendor/dsh-shared/lib/path-guard.mjs')).href;
const runtimeUrl = pathToFileURL(path.join(ROOT, 'vendor/dsh-shared/lib/managed-task-runtime.mjs')).href;

function withOwnedTempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

describe('dsh-shared/lib/path-guard.mjs', () => {
  test('comparablePath, samePath, and withinPath handle normalization and escapes', async () => {
    const { comparablePath, samePath, withinPath } = await import(pathGuardUrl);
    assert.equal(comparablePath(''), '');
    assert.equal(comparablePath(null), '');

    const base = path.resolve(ROOT, 'vendor', 'dsh-shared');
    const alt = path.join(ROOT, 'vendor', 'dsh-whale', '..', 'dsh-shared');
    assert.equal(samePath(base, alt), true);
    if (process.platform === 'win32') {
      assert.equal(samePath(base.toUpperCase(), base.toLowerCase()), true);
    }
    assert.equal(samePath('', base), false);
    assert.equal(samePath(base, undefined), false);

    assert.equal(withinPath(base, base), true);
    assert.equal(withinPath(base, path.join(base, 'lib', 'path-guard.mjs')), true);
    assert.equal(withinPath(base, path.join(base, '..', 'dsh-shared-evil')), false);
    assert.equal(withinPath(base, path.dirname(base)), false);
  });

  test('canonicalIfExists and canonicalExistingPath resolve deep existing ancestors', async (t) => {
    const { canonicalExistingPath, canonicalIfExists, samePath } = await import(pathGuardUrl);
    const dir = withOwnedTempDir(t, 'dsh-shared-canon-');
    assert.equal(canonicalIfExists(path.join(dir, 'does-not-exist')), '');
    const realDir = canonicalIfExists(dir);
    assert.ok(realDir);

    const nonExistent = path.join(dir, 'nested', 'leaf');
    const resolved = canonicalExistingPath(nonExistent);
    assert.equal(samePath(resolved, path.join(realDir, 'nested', 'leaf')), true);
  });

  test('renameWithRetry retries transient Windows errors and atomicWriteText cleans temp files', async (t) => {
    const { atomicWriteText, renameWithRetry } = await import(pathGuardUrl);
    const dir = withOwnedTempDir(t, 'dsh-shared-atomic-');
    const target = path.join(dir, 'state.json');

    let attempts = 0;
    await renameWithRetry('from.tmp', 'to.json', {
      platform: 'win32',
      budgetMs: 500,
      sleep: async () => {},
      rename: async () => {
        attempts += 1;
        if (attempts < 3) {
          const err = new Error('busy');
          err.code = attempts === 1 ? 'EPERM' : 'EBUSY';
          throw err;
        }
      },
    });
    assert.equal(attempts, 3);

    await assert.rejects(
      () => renameWithRetry('from.tmp', 'to.json', {
        platform: 'linux',
        budgetMs: 500,
        sleep: async () => {},
        rename: async () => {
          const err = new Error('eperm');
          err.code = 'EPERM';
          throw err;
        },
      }),
      { code: 'EPERM' },
    );

    await atomicWriteText(target, '{"ok":1}', { platform: 'win32', budgetMs: 500, sleep: async () => {} });
    assert.equal(fs.readFileSync(target, 'utf8'), '{"ok":1}');

    await assert.rejects(
      () => atomicWriteText(target, '{"ok":2}', {
        platform: 'linux',
        sleep: async () => {},
        rename: async () => {
          const err = new Error('fail');
          err.code = 'EIO';
          throw err;
        },
      }),
      { code: 'EIO' },
    );
    assert.equal(fs.readFileSync(target, 'utf8'), '{"ok":1}');
    assert.deepEqual(fs.readdirSync(dir), ['state.json']);
  });
});

describe('dsh-shared/lib/managed-task-runtime.mjs', () => {
  test('classifyRuntimeError separates retryRequired failures from transient errors', async () => {
    const { classifyRuntimeError } = await import(runtimeUrl);
    assert.deepEqual(classifyRuntimeError({ code: '401', message: 'Unauthorized' }), {
      category: 'auth',
      retryable: false,
      retryRequired: true,
    });
    assert.deepEqual(classifyRuntimeError({ message: 'quota_exceeded on billing' }), {
      category: 'quota',
      retryable: false,
      retryRequired: true,
    });
    assert.deepEqual(classifyRuntimeError({ message: 'model_not_found' }), {
      category: 'config',
      retryable: false,
      retryRequired: true,
    });
    assert.deepEqual(classifyRuntimeError({ code: 'ENOENT', message: 'no such file' }), {
      category: 'environment',
      retryable: false,
      retryRequired: true,
    });
    assert.deepEqual(classifyRuntimeError({ code: '429', message: 'rate limit' }), {
      category: 'transient',
      retryable: true,
      retryRequired: false,
    });
    assert.deepEqual(classifyRuntimeError(new Error('misc hiccup')), {
      category: 'unknown',
      retryable: true,
      retryRequired: false,
    });
  });

  test('createSerialQueue runs strictly in order and isolates individual errors', async () => {
    const { createSerialQueue } = await import(runtimeUrl);
    const queue = createSerialQueue();
    const trace = [];
    const first = queue.run(async () => {
      trace.push('1-start');
      await new Promise((r) => setTimeout(r, 15));
      trace.push('1-end');
      return 'one';
    });
    const failing = queue.run(async () => {
      trace.push('2-fail');
      throw new Error('boom');
    });
    const third = queue.run(async () => {
      trace.push('3-ok');
      return 'three';
    });

    assert.equal(await first, 'one');
    await assert.rejects(() => failing, /boom/);
    assert.equal(await third, 'three');
    await queue.tail;
    assert.deepEqual(trace, ['1-start', '1-end', '2-fail', '3-ok']);
  });

  test('beginDesktopAdmission handles unlocked, locked, requireService, function and done permits', async () => {
    const { beginDesktopAdmission } = await import(runtimeUrl);
    const noSvc = beginDesktopAdmission({}, 'check');
    assert.equal(noSvc.isOpen(), true);
    noSvc.release();

    assert.throws(
      () => beginDesktopAdmission({}, 'check', { requireService: true, unavailableMessage: 'missing-svc' }),
      /missing-svc/,
    );

    let doneCalls = 0;
    const ctxOpen = {
      get: (k) => (k === 'desktopTaskAdmission' ? {
        check: () => true,
        begin: () => ({ done: () => { doneCalls += 1; } }),
      } : null),
    };
    const lease = beginDesktopAdmission(ctxOpen, 'job-1');
    assert.equal(lease.isOpen(), true);
    lease.release();
    assert.equal(doneCalls, 1);

    const ctxLocked = {
      get: (k) => (k === 'desktopTaskAdmission' ? { check: () => false } : null),
    };
    assert.throws(
      () => beginDesktopAdmission(ctxLocked, 'job-2', { lockedMessage: 'locked-now' }),
      /locked-now/,
    );
  });

  test('hasSubtreeWork, drainAgentAndJobs, and createDelegatedApprovalRouter coordinate runtime cleanup', async () => {
    const {
      hasSubtreeWork,
      drainAgentAndJobs,
      createDelegatedApprovalRouter,
    } = await import(runtimeUrl);

    const killed = [];
    const waited = [];
    let cancelledReason = null;
    let drainedArgs = null;
    let idleAwaited = false;
    let agentStatus = 'running';

    const agent = {
      id: 'worker-1',
      get status() { return agentStatus; },
      session: { appended: [], append(type, data) { this.appended.push({ type, data }); } },
      cancel(reason) { cancelledReason = reason; agentStatus = 'idle'; },
      async whenIdle() { idleAwaited = true; },
    };

    const jobsList = [
      { id: 'job-run', owner: 'worker-1', status: 'running' },
      { id: 'job-other', owner: 'other-session', status: 'running' },
      { id: 'job-done', owner: 'worker-1', status: 'settled' },
    ];
    const ctx = {
      agents: new Map([['worker-1', agent], ['owner-1', { id: 'owner-1' }]]),
      jobs: {
        list: () => jobsList,
        kill: async (jobId, sessionId, reason) => { killed.push({ jobId, sessionId, reason }); },
        wait: async (jobId) => { waited.push(jobId); return { status: 'settled' }; },
      },
      subagents: {
        drainChildren: async (parent, ids) => { drainedArgs = { parentId: parent.id, ids }; },
      },
    };

    assert.equal(hasSubtreeWork(ctx, 'worker-1'), true);
    assert.equal(hasSubtreeWork(ctx, 'missing', () => true), true);
    assert.equal(hasSubtreeWork(ctx, 'missing'), false);

    const drained = await drainAgentAndJobs(ctx, 'worker-1', {
      killReason: 'stop-test',
      parent: { id: 'owner-1' },
      cancelReason: { kind: 'user' },
      swallowWaitErrors: false,
    });
    assert.equal(drained.killed, 1);
    assert.deepEqual(killed, [{ jobId: 'job-run', sessionId: 'worker-1', reason: 'stop-test' }]);
    assert.deepEqual(waited, ['job-run']);
    assert.deepEqual(cancelledReason, { kind: 'user' });
    assert.deepEqual(drainedArgs, { parentId: 'owner-1', ids: ['worker-1'] });
    assert.equal(idleAwaited, true);

    const boundCalls = [];
    const approvalCtx = {
      get: (k) => (k === 'approval' ? {
        policyRecord: () => ({ source: 'default' }),
        enableDelegatedRequests: (a, o) => boundCalls.push(['enable', a.id, o.id]),
        bindDelegatedRequester: (a, opts) => { boundCalls.push(['bind', a.id, opts.owner.id, opts.label]); return () => 'disposed'; },
      } : null),
    };
    const disposer = createDelegatedApprovalRouter({
      ctx: approvalCtx,
      agent,
      owner: { id: 'owner-1' },
      label: 'Test Label',
    });
    assert.equal(typeof disposer, 'function');
    assert.equal(agent.session.appended.some((ev) => ev.type === 'approval/policy' && ev.data?.source === 'delegation'), true);
    assert.deepEqual(boundCalls, [
      ['enable', 'worker-1', 'owner-1'],
      ['bind', 'worker-1', 'owner-1', 'Test Label'],
    ]);
  });
});
