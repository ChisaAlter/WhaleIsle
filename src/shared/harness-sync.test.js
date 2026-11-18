'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { readPin, writePin } = require('./harness-upstream');
const { parseSyncArgs, syncHarness, BACKUP_REF, STATE_RELATIVE } = require('./harness-sync');

// Keep git fixtures hermetic: no global insteadOf rewrites or system config.
process.env.GIT_CONFIG_GLOBAL = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-isolation-')), 'gitconfig');
fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL, '');
// 模块级隔离目录由文件级钩子回收（#478）。
test.after(() => fs.rmSync(path.dirname(process.env.GIT_CONFIG_GLOBAL), { recursive: true, force: true }));
process.env.GIT_CONFIG_NOSYSTEM = '1';

function git(cwd, args, options = {}) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', shell: false, ...options });
}

function initRepo(dir) {
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'test']);
  git(dir, ['config', 'core.autocrlf', 'false']);
}

function writeFile(dir, rel, content) {
  const full = path.join(dir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function commitAll(dir, message) {
  git(dir, ['add', '-A']);
  const committed = git(dir, ['commit', '-m', message]);
  if (committed.status !== 0) {
    throw new Error(committed.stderr || committed.stdout);
  }
  return git(dir, ['rev-parse', 'HEAD']).stdout.trim();
}

function makeUpstream(t) {
  const upstream = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-up-'));
  t.after(() => fs.rmSync(upstream, { recursive: true, force: true }));
  initRepo(upstream);
  writeFile(upstream, 'keep.txt', 'base\n');
  writeFile(upstream, 'stale.txt', 'deleted upstream in B\n');
  writeFile(upstream, 'apps/cli/package.json', `${JSON.stringify({ version: '0.1.0-rc.5' })}\n`);
  const shaA = commitAll(upstream, 'A');
  git(upstream, ['rm', 'stale.txt']);
  writeFile(upstream, 'keep.txt', 'theirs\n');
  writeFile(upstream, 'new.txt', 'added\n');
  writeFile(upstream, 'snapshots/web/说明.txt', 'non-ascii\n');
  writeFile(upstream, 'apps/cli/package.json', `${JSON.stringify({ version: '0.1.0-rc.7' })}\n`);
  const shaB = commitAll(upstream, 'B');
  return { upstream, shaA, shaB };
}

function makeDesktop(t, upstream, shaA, keep) {
  const desktop = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-desk-'));
  t.after(() => fs.rmSync(desktop, { recursive: true, force: true }));
  initRepo(desktop);
  writeFile(desktop, 'untouched.txt', 'root\n');
  writeFile(desktop, 'vendor/deepseek-harness/keep.txt', keep);
  writeFile(desktop, 'vendor/deepseek-harness/desktop-only.txt', 'local\n');
  writeFile(desktop, 'vendor/deepseek-harness/stale.txt', 'deleted upstream in B\n');
  writeFile(desktop, 'vendor/deepseek-harness/apps/cli/package.json', `${JSON.stringify({ version: '0.1.0-rc.5' })}\n`);
  writePin(desktop, {
    repo: 'https://github.com/deepseek-ai/deepseek-harness.git',
    ref: shaA,
    sha: shaA,
    npm: '0.1.0-rc.5',
  });
  commitAll(desktop, 'desktop');
  git(desktop, ['remote', 'add', 'upstream-harness', upstream]);
  return desktop;
}

test('parseSyncArgs requires --ref and --sha and treats modes as exclusive', () => {
  const sha = '99f6f02fecdb7dff40c3fbc9470f5907c29f74ca';
  assert.deepEqual(
    parseSyncArgs(['--ref', 'dsh-v0.1.0-rc.7', '--sha', sha]),
    { mode: 'sync', ref: 'dsh-v0.1.0-rc.7', sha, dryRun: false },
  );
  assert.deepEqual(
    parseSyncArgs(['--dry-run', '--ref', 'dsh-v0.1.0-rc.7', '--sha', sha]),
    { mode: 'sync', ref: 'dsh-v0.1.0-rc.7', sha, dryRun: true },
  );
  assert.deepEqual(parseSyncArgs(['--continue']), { mode: 'continue', dryRun: false });
  assert.deepEqual(parseSyncArgs(['--abort']), { mode: 'abort', dryRun: false });
  assert.throws(() => parseSyncArgs(['--ref', 'dsh-v0.1.0-rc.7']), /--sha/);
  assert.throws(() => parseSyncArgs([]), /--ref/);
  assert.throws(() => parseSyncArgs(['--continue', '--abort']), /exclusive|abort|continue/i);
});

test('happy path updates only the vendor prefix and pin', (t) => {
  const { upstream, shaA, shaB } = makeUpstream(t);
  const desktop = makeDesktop(t, upstream, shaA, 'base\n');
  const result = syncHarness({
    root: desktop,
    args: { mode: 'sync', ref: shaB, sha: shaB, dryRun: false },
  });
  assert.equal(result.status, 'applied');
  const pin = readPin(desktop);
  assert.equal(pin.sha, shaB);
  assert.equal(pin.npm, '0.1.0-rc.7');
  assert.equal(fs.readFileSync(path.join(desktop, 'vendor', 'deepseek-harness', 'keep.txt'), 'utf8'), 'theirs\n');
  assert.equal(fs.readFileSync(path.join(desktop, 'vendor', 'deepseek-harness', 'new.txt'), 'utf8'), 'added\n');
  assert.equal(
    fs.readFileSync(path.join(desktop, 'vendor', 'deepseek-harness', 'snapshots', 'web', '说明.txt'), 'utf8'),
    'non-ascii\n',
  );
  assert.equal(fs.existsSync(path.join(desktop, 'vendor', 'deepseek-harness', 'stale.txt')), false);
  assert.equal(git(desktop, ['ls-files', '--', 'vendor/deepseek-harness/stale.txt']).stdout.trim(), '');
  assert.equal(fs.readFileSync(path.join(desktop, 'vendor', 'deepseek-harness', 'desktop-only.txt'), 'utf8'), 'local\n');
  assert.equal(fs.readFileSync(path.join(desktop, 'untouched.txt'), 'utf8'), 'root\n');
  assert.equal(git(desktop, ['rev-parse', BACKUP_REF]).status, 0);
});

test('conflict leaves the main tree and pin untouched', (t) => {
  const { upstream, shaA, shaB } = makeUpstream(t);
  const desktop = makeDesktop(t, upstream, shaA, 'ours\n');
  const before = readPin(desktop);
  const result = syncHarness({
    root: desktop,
    args: { mode: 'sync', ref: shaB, sha: shaB, dryRun: false },
  });
  assert.equal(result.status, 'conflict');
  assert.ok(result.worktree);
  assert.ok(result.conflicts && result.conflicts.includes('keep.txt'));
  assert.deepEqual(readPin(desktop), before);
  assert.equal(git(desktop, ['status', '--porcelain']).stdout.trim(), '');
  const gitDir = git(desktop, ['rev-parse', '--git-dir']).stdout.trim();
  const statePath = path.join(path.resolve(desktop, gitDir), STATE_RELATIVE);
  assert.equal(fs.existsSync(statePath), true);
  assert.equal(fs.existsSync(result.worktree), true);
});

test('continue after resolving keep.txt updates the pin', (t) => {
  const { upstream, shaA, shaB } = makeUpstream(t);
  const desktop = makeDesktop(t, upstream, shaA, 'ours\n');
  const paused = syncHarness({
    root: desktop,
    args: { mode: 'sync', ref: shaB, sha: shaB, dryRun: false },
  });
  assert.equal(paused.status, 'conflict');
  fs.writeFileSync(path.join(paused.worktree, 'keep.txt'), 'merged\n');
  git(paused.worktree, ['add', 'keep.txt']);
  const result = syncHarness({
    root: desktop,
    args: { mode: 'continue', dryRun: false },
  });
  assert.equal(result.status, 'applied');
  assert.equal(readPin(desktop).sha, shaB);
  assert.equal(fs.readFileSync(path.join(desktop, 'vendor', 'deepseek-harness', 'keep.txt'), 'utf8'), 'merged\n');
  assert.equal(fs.readFileSync(path.join(desktop, 'vendor', 'deepseek-harness', 'desktop-only.txt'), 'utf8'), 'local\n');
});

test('abort after conflict restores the pre-sync main state', (t) => {
  const { upstream, shaA, shaB } = makeUpstream(t);
  const desktop = makeDesktop(t, upstream, shaA, 'ours\n');
  const before = readPin(desktop);
  const paused = syncHarness({
    root: desktop,
    args: { mode: 'sync', ref: shaB, sha: shaB, dryRun: false },
  });
  assert.equal(paused.status, 'conflict');
  const result = syncHarness({
    root: desktop,
    args: { mode: 'abort', dryRun: false },
  });
  assert.equal(result.status, 'aborted');
  assert.deepEqual(readPin(desktop), before);
  assert.equal(git(desktop, ['status', '--porcelain']).stdout.trim(), '');
  assert.equal(git(desktop, ['rev-parse', BACKUP_REF]).status !== 0, true);
  const gitDir = git(desktop, ['rev-parse', '--git-dir']).stdout.trim();
  assert.equal(fs.existsSync(path.join(path.resolve(desktop, gitDir), STATE_RELATIVE)), false);
});

test('dry-run does not change pin or the main tree', (t) => {
  const { upstream, shaA, shaB } = makeUpstream(t);
  const desktop = makeDesktop(t, upstream, shaA, 'base\n');
  const before = readPin(desktop);
  const result = syncHarness({
    root: desktop,
    args: { mode: 'sync', ref: shaB, sha: shaB, dryRun: true },
  });
  assert.equal(result.status, 'dry-run');
  assert.deepEqual(readPin(desktop), before);
  assert.equal(git(desktop, ['status', '--porcelain']).stdout.trim(), '');
  assert.equal(fs.readFileSync(path.join(desktop, 'vendor', 'deepseek-harness', 'keep.txt'), 'utf8'), 'base\n');
});

test('sync without --sha throws and does not fetch', () => {
  assert.throws(() => parseSyncArgs(['--ref', 'dsh-v0.1.0-rc.7']), /--sha/);
});

test('dirty main throws before creating a worktree', (t) => {
  const { upstream, shaA, shaB } = makeUpstream(t);
  const desktop = makeDesktop(t, upstream, shaA, 'base\n');
  fs.writeFileSync(path.join(desktop, 'dirty.txt'), 'nope\n');
  assert.throws(() => syncHarness({
    root: desktop,
    args: { mode: 'sync', ref: shaB, sha: shaB, dryRun: false },
  }), /clean|uncommitted|dirty|porcelain/i);
  const gitDir = git(desktop, ['rev-parse', '--git-dir']).stdout.trim();
  assert.equal(fs.existsSync(path.join(path.resolve(desktop, gitDir), 'dsh-harness-sync-worktree')), false);
});
