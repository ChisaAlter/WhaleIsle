/**
 * Live titlebar Git stack against real git (not mocked).
 * Exercises the same git.js APIs the desktop titlebar calls.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createWorkspaceAuthority } = require('../src/main/workspace-authority');
const {
  gitChildEnv,
  gitCommit,
  gitCreateChangeRequest,
  gitInit,
  gitPush,
  gitStatus,
  resolvePrBaseBranch,
  setGhDefaultBranchResolver,
  setLookupOpenPullRequest,
  setWorkspaceAuthority,
} = require('../src/main/git');
const { setTextGenerator } = require('../src/main/git-generate');

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

function tempDir(prefix) {
  // eslint-disable-next-line no-restricted-syntax -- 返回的目录由调用方 finally rmSync 回收
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  setWorkspaceAuthority(createWorkspaceAuthority({ workspace: dir }));
  return dir;
}

async function caseCleanInit() {
  const cwd = tempDir('dsh-live-init-');
  try {
    const inited = await gitInit(cwd);
    assert.equal(inited.ok, true);
    const status = await gitStatus(cwd);
    assert.equal(status.isRepo, true);
    console.log('PASS  gitInit + gitStatus on a real empty repo');
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

async function caseCommitPushSkip() {
  const cwd = tempDir('dsh-live-push-');
  // eslint-disable-next-line no-restricted-syntax -- 目录已在 finally 中 rmSync 回收
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-live-bare-'));
  try {
    git(bare, ['init', '--bare']);
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    const committed = await gitCommit(cwd, 'Add readme');
    assert.equal(committed.ok, true, committed.message);
    git(cwd, ['remote', 'add', 'origin', bare]);
    const pushed = await gitPush(cwd);
    assert.equal(pushed.ok, true, pushed.message);
    const again = await gitPush(cwd);
    assert.equal(again.ok, true, again.message);
    assert.equal(again.status, 'skipped');
    console.log('PASS  commit → push → no-delta skip');
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
}

async function caseDirtyCreatePr() {
  const cwd = tempDir('dsh-live-pr-');
  // eslint-disable-next-line no-restricted-syntax -- 目录已在 finally 中 rmSync 回收
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-live-bare-'));
  try {
    git(bare, ['init', '--bare']);
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    git(cwd, ['checkout', '-b', 'feature/live']);
    git(cwd, ['remote', 'add', 'origin', bare]);
    git(cwd, ['push', '-u', 'origin', 'HEAD']);
    git(cwd, ['remote', 'set-url', 'origin', 'https://github.com/acme/demo.git']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\ndirty\n');
    const created = await gitCreateChangeRequest(cwd, {});
    assert.equal(created.ok, false);
    assert.equal(created.message, 'Commit local changes before creating a PR.');
    console.log('PASS  create_pr refuses a dirty work tree');
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
}

async function casePrBaseGhWins() {
  const cwd = tempDir('dsh-live-base-');
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    git(cwd, ['checkout', '-b', 'feature/live']);
    setGhDefaultBranchResolver(async () => 'develop');
    assert.equal(await resolvePrBaseBranch(cwd, 'feature/live', false), 'develop');
    console.log('PASS  resolvePrBaseBranch prefers gh default over local main');
  } finally {
    setGhDefaultBranchResolver(null);
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

async function caseCeilingEnv() {
  process.env.GIT_CEILING_DIRECTORIES = path.join(os.tmpdir(), 'ceiling');
  try {
    const env = gitChildEnv();
    assert.equal(env.GIT_CEILING_DIRECTORIES, undefined);
    console.log('PASS  gitChildEnv strips GIT_CEILING_DIRECTORIES');
  } finally {
    delete process.env.GIT_CEILING_DIRECTORIES;
  }
}

async function caseCreatePrCopy() {
  const cwd = tempDir('dsh-live-copy-');
  // eslint-disable-next-line no-restricted-syntax -- 目录已在 finally 中 rmSync 回收
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-live-bare-'));
  let seen = null;
  setTextGenerator(async (input) => {
    seen = input;
    return { title: 'Generated from range', body: 'range body' };
  });
  setGhDefaultBranchResolver(async () => 'main');
  setLookupOpenPullRequest(async () => ({ pr: null, failed: false }));
  try {
    git(bare, ['init', '--bare']);
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    git(cwd, ['checkout', '-b', 'feature/live']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\nworld\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'Add files']);
    git(cwd, ['remote', 'add', 'origin', bare]);
    git(cwd, ['push', '-u', 'origin', 'HEAD']);
    git(cwd, ['remote', 'set-url', 'origin', 'https://github.com/acme/demo.git']);
    const result = await gitCreateChangeRequest(cwd, { title: 'Add files', body: '' });
    assert.equal(seen.kind, 'pr');
    assert.equal(seen.fallbackTitle, 'feature/live');
    assert.equal(result.ok, false);
    console.log('PASS  create_pr generates range copy then fails closed without live gh');
  } finally {
    setTextGenerator(null);
    setGhDefaultBranchResolver(null);
    setLookupOpenPullRequest(null);
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
}

async function caseReservedNameCommitPush() {
  if (process.platform !== 'win32') {
    console.log('SKIP  reserved-name commit_push (not win32)');
    return;
  }
  const cwd = tempDir('dsh-live-nul-');
  // eslint-disable-next-line no-restricted-syntax -- 目录已在 finally 中 rmSync 回收
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-live-bare-'));
  const reserved = `\\\\?\\${path.resolve(cwd, 'nul')}`;
  try {
    git(bare, ['init', '--bare']);
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    git(cwd, ['remote', 'add', 'origin', bare]);
    git(cwd, ['push', '-u', 'origin', 'main']);
    fs.writeFileSync(path.join(cwd, 'extra.md'), 'change\n');
    fs.writeFileSync(reserved, 'junk\n');

    const first = await gitCommit(cwd, 'Add extra');
    assert.equal(first.ok, true, first.message);
    assert.equal(first.skipped, undefined);
    const tracked = git(cwd, ['ls-files']);
    assert.match(tracked, /extra\.md/);
    assert.doesNotMatch(tracked, /^nul$/m);
    const afterCommit = await gitStatus(cwd);
    assert.equal(afterCommit.hasWorkingTreeChanges, false);

    const pushed = await gitPush(cwd);
    assert.equal(pushed.ok, true, pushed.message);

    const second = await gitCommit(cwd, 'should skip');
    assert.equal(second.ok, true, second.message);
    assert.equal(second.skipped, true);
    const afterSkip = await gitStatus(cwd);
    assert.equal(afterSkip.hasWorkingTreeChanges, false);
    console.log('PASS  commit_push skips leftover Windows reserved name');
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(reserved, { force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
}

async function main() {
  await caseCleanInit();
  await caseCommitPushSkip();
  await caseDirtyCreatePr();
  await casePrBaseGhWins();
  await caseCeilingEnv();
  await caseCreatePrCopy();
  await caseReservedNameCommitPush();
  console.log('LIVE git titlebar: all cases passed');
}

main().catch((error) => {
  console.error('LIVE git titlebar FAILED:', error);
  process.exit(1);
});
