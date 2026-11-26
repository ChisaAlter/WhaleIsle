'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GIT_TUNNEL_ACTIONS,
  isAllowedGitAction,
  dispatchGitTunnel,
} = require('./dshd-git-dispatch');

test('git tunnel allowlist matches titlebar set plus hunk-level stage-patch/unstage-patch and excludes full stage/unstage/discard/pty/writeFile', () => {
  assert.equal(isAllowedGitAction('git-status'), true);
  assert.equal(isAllowedGitAction('git-create-branch'), true);
  assert.equal(isAllowedGitAction('git-publish'), true);
  assert.equal(isAllowedGitAction('git-stage-patch'), true);
  assert.equal(isAllowedGitAction('git-unstage-patch'), true);
  assert.equal(isAllowedGitAction('git-stage'), false);
  assert.equal(isAllowedGitAction('git-unstage'), false);
  assert.equal(isAllowedGitAction('git-discard'), false);
  assert.equal(isAllowedGitAction('writeFile'), false);
  assert.equal(isAllowedGitAction('ptySpawn'), false);
  assert.ok(GIT_TUNNEL_ACTIONS.has('git-commit'));
  assert.ok(GIT_TUNNEL_ACTIONS.has('git-stage-patch'));
  assert.ok(GIT_TUNNEL_ACTIONS.has('git-unstage-patch'));
  assert.equal(GIT_TUNNEL_ACTIONS.has('git-stage'), false);
  assert.equal(GIT_TUNNEL_ACTIONS.has('git-unstage'), false);
  assert.equal(GIT_TUNNEL_ACTIONS.has('git-discard'), false);
});

test('dispatchGitTunnel forwards git-stage-patch and git-unstage-patch with patchText', async () => {
  const calls = [];
  const git = {
    gitStagePatch: async (cwd, patchText) => {
      calls.push({ op: 'stage', cwd, patchText });
      return { ok: true };
    },
    gitUnstagePatch: async (cwd, patchText) => {
      calls.push({ op: 'unstage', cwd, patchText });
      return { ok: true };
    },
  };
  const patchText = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n';
  assert.deepEqual(await dispatchGitTunnel({ action: 'git-stage-patch', cwd: 'C:\\proj', payload: { patchText }, git }), { ok: true });
  assert.deepEqual(await dispatchGitTunnel({ action: 'git-unstage-patch', cwd: 'C:\\proj', payload: { patchText }, git }), { ok: true });
  assert.deepEqual(calls, [
    { op: 'stage', cwd: 'C:\\proj', patchText },
    { op: 'unstage', cwd: 'C:\\proj', patchText },
  ]);
});

test('dispatchGitTunnel rejects unknown actions without calling git', async () => {
  let called = 0;
  await assert.rejects(
    () => dispatchGitTunnel({
      action: 'git-stage',
      cwd: '/repo',
      payload: {},
      git: { gitStage: async () => { called += 1; } },
    }),
    /不允许/,
  );
  assert.equal(called, 0);
});

test('dispatchGitTunnel maps stacked commit payload onto gitCommit', async () => {
  const calls = [];
  const git = {
    gitCommit: async (cwd, message, filePaths, onProgress, options) => {
      calls.push({ cwd, message, filePaths, options });
      return { ok: true };
    },
  };
  const result = await dispatchGitTunnel({
    action: 'git-commit',
    cwd: 'C:\\proj',
      payload: { message: 'wip', filePaths: ['a.ts'], options: { featureBranch: 'feat' } },
    git,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls[0], {
    cwd: 'C:\\proj',
    message: 'wip',
    filePaths: ['a.ts'],
    options: { featureBranch: 'feat' },
  });
});
