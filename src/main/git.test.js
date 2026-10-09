const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// `git-exec.js` destructures `spawn` when it is first required, so the counting
// hook has to be installed before any production module below is loaded.
// Only the async spawn is wrapped; the synchronous `git()` fixture helper in
// this file still uses the real `spawnSync`.
const childProcess = require('node:child_process');
const { spawnSync } = childProcess;
const realSpawn = childProcess.spawn;
const gitSpawnLog = [];
let countingGitSpawns = false;
childProcess.spawn = function countingSpawn(command, args, options) {
  if (countingGitSpawns && command === 'git') gitSpawnLog.push(args.join(' '));
  return realSpawn.call(this, command, args, options);
};

const { createWorkspaceAuthority } = require('./workspace-authority');
const { setDesktopDshHome, clearDesktopDshHome } = require('../shared/dsh-home');
const { COMMIT_TIMEOUT_MS, FETCH_TIMEOUT_MS, GH_TIMEOUT_MS, commitArgs, gitBranchList, gitCheckLargeFiles, gitChildEnv, gitCommit, gitCreateBranch, gitCreateChangeRequest, gitDiff, gitDiscard, gitFailureMessage, gitFetchForStatus, gitInit, gitPublishRepository, gitPull, gitPush, gitReadPullRequest, gitStage, gitStatus, gitStatusEntries, gitSwitchBranch, gitUnstage, inferHookName, isGitAdviceLine, isNtfsReservedGitPath, matchesBranchHeadContext, normalizeGitRemoteUrl, parseCustomCommitMessage, parseGhPullRequestRow, parseGitHubRepositoryNameWithOwner, parsePorcelainZ, parseUnifiedDiff, providerFromRemoteUrl, readPrTemplate, readRangeContext, rememberLastKnownPr, resetFetchCooldowns, resetGitExecutableProbe, resetLastKnownPrCache, resolveBaseBranchForNoUpstream, resolveBranchHeadContext, resolveLastKnownPr, resolvePrBaseBranch, resolvePreferredHeadSelector, run, sanitizeProgressText, setGhDefaultBranchResolver, setLookupOpenPullRequest, setWorkspaceAuthority, summarizeCommitMessage } = require('./git.js');
const { resetReadContexts } = require('./git-read-context.js');
const { fetchForStatus } = require('./git-fetch.js');
const { parseRepositoryNameWithOwnerFromNormalized } = require('./git-pullrequest');
const { setTextGenerator } = require('./git-generate.js');

// Isolate every git child (direct spawns and module-spawned via gitChildEnv)
// from the developer's global/system config: url.*.insteadOf rewrites,
// init.defaultBranch, or hook templates must not leak into these fixtures.
process.env.GIT_CONFIG_GLOBAL = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-isolation-')), 'gitconfig');
fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL, '');
process.env.GIT_CONFIG_NOSYSTEM = '1';

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-'));
  // Pin the workspace authority so cwd checks pass inside this test root.
  setWorkspaceAuthority(createWorkspaceAuthority({ workspace: dir }));
  return dir;
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

/**
 * A "not a repository" fixture must be hermetic: plain discovery from the
 * temp dir would also find an ancestor repo (e.g. a stray ~/.git on the dev
 * machine). An invalid `.git` file stops that discovery with the same
 * "not a repository" failure these tests exercise.
 * @returns {string} the isolated non-repo directory.
 */
function makeNonRepoDir() {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, '.git'), 'not a repository\n');
  return dir;
}

/** A heads ref whose commit object is corrupt, so `rev-list <ref>..HEAD` fails. */
function writeUnreadableMergeBase(cwd, refName) {
  const orig = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  git(cwd, ['checkout', '--orphan', refName]);
  const marker = path.join(cwd, `unreadable-${refName}.txt`);
  fs.writeFileSync(marker, 'x\n');
  git(cwd, ['add', `unreadable-${refName}.txt`]);
  git(cwd, ['commit', '-m', 'unreadable-base']);
  const sha = git(cwd, ['rev-parse', 'HEAD']).trim();
  git(cwd, ['checkout', '--force', orig]);
  fs.rmSync(marker, { force: true });
  const objectPath = path.join(cwd, '.git', 'objects', sha.slice(0, 2), sha.slice(2));
  fs.chmodSync(objectPath, 0o666);
  fs.writeFileSync(objectPath, 'not-a-git-object\n');
}

test('gitStatus reports isRepo false when the directory is not a git repository', async () => {
  const cwd = makeNonRepoDir();
  try {
    const status = await gitStatus(cwd);
    assert.equal(status.isRepo, false);
    assert.equal(status.refName, null);
    assert.equal(status.hasWorkingTreeChanges, false);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitInit creates a repository the titlebar can commit into', async () => {
  const cwd = makeTempDir();
  try {
    const inited = await gitInit(cwd);
    assert.equal(inited.ok, true);
    const again = await gitInit(cwd);
    assert.equal(again.ok, true);
    const status = await gitStatus(cwd);
    assert.equal(status.isRepo, true);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitStatusEntries falls back to a well-known Git install when PATH cannot spawn git', async () => {
  // Explorer/terminals keep the PATH they started with, so Git installed
  // mid-session is invisible to this process's children. The desktop must
  // probe the standard install dirs before reporting Git as unavailable.
  const standardInstall = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : null,
  ]
    .filter(Boolean)
    .map((dir) => path.join(dir, 'Git', 'cmd', 'git.exe'))
    .find((candidate) => fs.existsSync(candidate));
  const cwd = makeTempDir();
  const pathKeys = Object.keys(process.env).filter((key) => key.toLowerCase() === 'path');
  const saved = pathKeys.map((key) => [key, process.env[key]]);
  try {
    git(cwd, ['init', '-b', 'main']);
    fs.writeFileSync(path.join(cwd, 'a.txt'), 'x');
    for (const [key] of saved) process.env[key] = path.join(os.tmpdir(), 'dshd-empty-path');
    const listed = await gitStatusEntries(cwd);
    if (process.platform === 'win32' && standardInstall) {
      assert.equal(listed.ok, true, JSON.stringify(listed).slice(0, 300));
      assert.ok(listed.entries.some((entry) => entry.path === 'a.txt'));
    } else {
      assert.equal(listed.ok, false);
      assert.match(listed.message, /Git is unavailable/);
      assert.match(listed.message, /git-scm\.com|winget/);
    }
  } finally {
    for (const [key, value] of saved) process.env[key] = value;
    resetGitExecutableProbe();
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitStatus reports workingTree numstat after a committed file is edited', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init']);
    git(cwd, ['config', 'user.email', 'git-test@example.com']);
    git(cwd, ['config', 'user.name', 'Git Test']);
    git(cwd, ['checkout', '-b', 'main']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'Add readme']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\nworld\n');
    const status = await gitStatus(cwd);
    assert.equal(status.hasWorkingTreeChanges, true);
    const file = status.workingTree.files.find((entry) => entry.path === 'README.md');
    assert.ok(file);
    assert.equal(file.insertions, 1);
    assert.equal(file.deletions, 0);
    assert.equal(status.workingTree.insertions, 1);
    assert.equal(status.workingTree.deletions, 0);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitStatus reports hasWorkingTreeChanges after init and an uncommitted file', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init']);
    git(cwd, ['config', 'user.email', 'git-test@example.com']);
    git(cwd, ['config', 'user.name', 'Git Test']);
    git(cwd, ['checkout', '-b', 'main']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    const status = await gitStatus(cwd);
    assert.ok(status);
    assert.equal(status.isRepo, true);
    assert.equal(status.hasWorkingTreeChanges, true);
    assert.equal(status.refName, 'main');
    assert.deepEqual(status.workingTree, {
      files: [{ path: 'README.md', insertions: 0, deletions: 0 }],
      insertions: 0,
      deletions: 0,
    });
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitDiff returns null when the directory is not a git repository', async () => {
  const cwd = makeNonRepoDir();
  try {
    assert.equal(await gitDiff(cwd), null);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitDiff lists a working-tree hunk after a committed file is edited', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init']);
    git(cwd, ['config', 'user.email', 'git-test@example.com']);
    git(cwd, ['config', 'user.name', 'Git Test']);
    git(cwd, ['checkout', '-b', 'main']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'Add readme']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\nworld\n');
    const diff = await gitDiff(cwd);
    assert.ok(diff);
    const file = diff.files.find((entry) => entry.path === 'README.md');
    assert.ok(file);
    assert.equal(file.status, 'modified');
    assert.ok(file.hunks.some((hunk) => hunk.lines.some((line) => line.kind === 'add' && line.text === 'world')));
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitDiff with baseRef returns the three-dot branch range and rejects an unsafe ref', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init']);
    git(cwd, ['config', 'user.email', 'git-test@example.com']);
    git(cwd, ['config', 'user.name', 'Git Test']);
    git(cwd, ['checkout', '-b', 'main']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'Add readme']);
    git(cwd, ['checkout', '-b', 'feature']);
    fs.writeFileSync(path.join(cwd, 'extra.txt'), 'branch\n');
    git(cwd, ['add', 'extra.txt']);
    git(cwd, ['commit', '-m', 'Add extra']);
    const diff = await gitDiff(cwd, { baseRef: 'main' });
    assert.ok(diff);
    assert.equal(diff.baseRef, 'main');
    assert.ok(diff.files.some((entry) => entry.path === 'extra.txt'));
    assert.equal(await gitDiff(cwd, { baseRef: '-evil' }), null);
    assert.equal(await gitDiff(cwd, { baseRef: 'missing-branch' }), null);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('parseUnifiedDiff takes path from diff --git when +++ is absent', () => {
  const files = parseUnifiedDiff([
    'diff --git a/img.png b/img.png',
    'index 111..222 100644',
    'Binary files a/img.png and b/img.png differ',
    'diff --git a/icon.png b/icon.png',
    'index 333..444 100644',
    'Binary files a/icon.png and b/icon.png differ',
    'diff --git a/tool.sh b/tool.sh',
    'old mode 100644',
    'new mode 100755',
  ].join('\n'));
  assert.deepEqual(files.map((file) => file.path), ['img.png', 'icon.png', 'tool.sh']);
  assert.ok(files.every((file) => file.path !== ''));
});

test('gitDiff keeps a real path for a committed then modified binary', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init']);
    git(cwd, ['config', 'user.email', 'git-test@example.com']);
    git(cwd, ['config', 'user.name', 'Git Test']);
    git(cwd, ['checkout', '-b', 'main']);
    fs.writeFileSync(path.join(cwd, 'img.bin'), Buffer.from([0, 1, 2, 3]));
    fs.writeFileSync(path.join(cwd, 'icon.bin'), Buffer.from([9, 8, 7]));
    git(cwd, ['add', 'img.bin', 'icon.bin']);
    git(cwd, ['commit', '-m', 'Add binaries']);
    fs.writeFileSync(path.join(cwd, 'img.bin'), Buffer.from([0, 1, 2, 4]));
    fs.writeFileSync(path.join(cwd, 'icon.bin'), Buffer.from([9, 8, 6]));
    const diff = await gitDiff(cwd);
    assert.ok(diff);
    const paths = diff.files.map((file) => file.path).sort();
    assert.deepEqual(paths, ['icon.bin', 'img.bin']);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('parseUnifiedDiff keeps +++ and --- hunk lines as content', () => {
  const files = parseUnifiedDiff([
    'diff --git a/foo.c b/foo.c',
    '--- a/foo.c',
    '+++ b/foo.c',
    '@@ -1,2 +1,2 @@',
    '- -- sql',
    '+ ++ op',
  ].join('\n'));
  assert.equal(files.length, 1);
  assert.equal(files[0].path, 'foo.c');
  assert.deepEqual(files[0].hunks[0].lines, [
    { kind: 'del', text: ' -- sql' },
    { kind: 'add', text: ' ++ op' },
  ]);
});

test('parseUnifiedDiff keeps the no-newline marker as an eof line', () => {
  const files = parseUnifiedDiff([
    'diff --git a/foo.c b/foo.c',
    '--- a/foo.c',
    '+++ b/foo.c',
    '@@ -1,1 +1,1 @@',
    '-old',
    '+new',
    '\\ No newline at end of file',
    ' tail',
  ].join('\n'));
  assert.equal(files.length, 1);
  assert.deepEqual(files[0].hunks[0].lines, [
    { kind: 'del', text: 'old' },
    { kind: 'add', text: 'new' },
    { kind: 'eof', text: 'No newline at end of file' },
    { kind: 'context', text: 'tail' },
  ]);
});

test('run kills a hung child after the timeout', async () => {
  const result = await run(
    process.execPath,
    ['-e', 'setTimeout(() => {}, 30000)'],
    os.tmpdir(),
    { timeoutMs: 80 },
  );
  assert.equal(result.timedOut, true);
  assert.equal(result.code, -1);
});

test('run caps stdout and sets truncated', async () => {
  const result = await run(
    process.execPath,
    ['-e', "process.stdout.write('x'.repeat(64))"],
    os.tmpdir(),
    { maxBytes: 8 },
  );
  assert.equal(result.truncated, true);
  assert.ok(result.stdout.length <= 8);
});

test('run caps stderr and sets truncated', async () => {
  const result = await run(
    process.execPath,
    ['-e', "process.stderr.write('y'.repeat(64))"],
    os.tmpdir(),
    { maxBytes: 8 },
  );
  assert.equal(result.truncated, true);
  assert.ok(result.stderr.length <= 8);
});

test('run joins stdout chunks split mid-multibyte without replacement characters', async () => {
  const result = await run(
    process.execPath,
    ['-e', "process.stdout.write('深'); setTimeout(() => { process.stdout.write('询\\n') }, 20)"],
    os.tmpdir(),
    { timeoutMs: 10_000 },
  );
  assert.equal(result.code, 0);
  assert.equal(result.stdout, '深询\n');
});

test('gitCommit records a message and clears working-tree changes', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init']);
    git(cwd, ['config', 'user.email', 'git-test@example.com']);
    git(cwd, ['config', 'user.name', 'Git Test']);
    git(cwd, ['checkout', '-b', 'main']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    const result = await gitCommit(cwd, 'Add readme');
    assert.equal(result.ok, true);
    assert.equal(result.subject, 'Add readme');
    assert.match(result.commitSha || '', /^[0-9a-f]{40}$/);
    const status = await gitStatus(cwd);
    assert.ok(status);
    assert.equal(status.hasWorkingTreeChanges, false);
    assert.equal(status.refName, 'main');
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitStatus workingTree lists a modified file and an untracked path', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\nworld\n');
    fs.writeFileSync(path.join(cwd, 'extra.txt'), 'a\nb\n');
    const listed = await gitStatus(cwd);
    const byPath = Object.fromEntries(listed.workingTree.files.map(file => [file.path, file]));
    assert.equal(byPath['README.md'].insertions, 1);
    assert.ok(byPath['extra.txt']);
    assert.equal(byPath['extra.txt'].deletions, 0);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('summarizeCommitMessage names the first path and a remainder count', () => {
  assert.equal(summarizeCommitMessage([]), 'Update project files');
  assert.equal(summarizeCommitMessage([{ path: 'README.md' }]), 'Update README.md');
  assert.equal(summarizeCommitMessage([{ path: 'a.ts' }, { path: 'b.ts' }]), 'Update a.ts and 1 other files');
});

test('gitCommit with an empty message uses the staged name-status heuristic', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    const result = await gitCommit(cwd, '');
    assert.equal(result.ok, true, result.message);
    assert.equal(result.subject, 'Add README.md');
    assert.match(result.commitSha || '', /^[0-9a-f]{40}$/);
    const log = git(cwd, ['log', '-1', '--pretty=%s']);
    assert.equal(log.trim(), 'Add README.md');
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitCommit with filePaths stages only those paths', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'keep.md'), 'keep\n');
    fs.writeFileSync(path.join(cwd, 'skip.md'), 'skip\n');
    git(cwd, ['add', 'keep.md', 'skip.md']);
    git(cwd, ['commit', '-m', 'base']);
    fs.writeFileSync(path.join(cwd, 'keep.md'), 'keep\nchanged\n');
    fs.writeFileSync(path.join(cwd, 'skip.md'), 'skip\nchanged\n');
    const result = await gitCommit(cwd, 'only keep', ['keep.md']);
    assert.equal(result.ok, true, result.message);
    const leftover = await gitStatus(cwd);
    assert.deepEqual(leftover.workingTree.files.map(file => file.path), ['skip.md']);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

function win32LiteralPath(dir, name) {
  return `\\\\?\\${path.resolve(dir, name)}`;
}

test('isNtfsReservedGitPath matches Git-for-Windows device names', () => {
  assert.equal(isNtfsReservedGitPath('nul'), true);
  assert.equal(isNtfsReservedGitPath('NUL.txt'), true);
  assert.equal(isNtfsReservedGitPath('foo/aux'), true);
  assert.equal(isNtfsReservedGitPath('COM1'), true);
  assert.equal(isNtfsReservedGitPath('README.md'), false);
  assert.equal(isNtfsReservedGitPath('null'), false);
  assert.equal(isNtfsReservedGitPath('com10'), false);
});

test('gitCommit stages real files when a Windows reserved-name path cannot be indexed', {
  skip: process.platform !== 'win32',
}, async () => {
  const cwd = makeTempDir();
  const reserved = win32LiteralPath(cwd, 'nul');
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    fs.writeFileSync(reserved, 'junk\n');
    const result = await gitCommit(cwd, 'Add readme');
    assert.equal(result.ok, true, result.message);
    const tracked = git(cwd, ['ls-files']);
    assert.equal(tracked.trim(), 'README.md');
    const status = await gitStatus(cwd);
    assert.equal(status.hasWorkingTreeChanges, false);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(reserved, { force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitCommit skips when the only untracked path is a Windows reserved-name', {
  skip: process.platform !== 'win32',
}, async () => {
  const cwd = makeTempDir();
  const reserved = win32LiteralPath(cwd, 'nul');
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    fs.writeFileSync(reserved, 'junk\n');
    const result = await gitCommit(cwd, 'should skip');
    assert.equal(result.ok, true, result.message);
    assert.equal(result.skipped, true);
    const log = git(cwd, ['log', '-1', '--pretty=%s']);
    assert.equal(log.trim(), 'base');
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(reserved, { force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitStatus ignores a Windows reserved-name untracked file as working-tree changes', {
  skip: process.platform !== 'win32',
}, async () => {
  const cwd = makeTempDir();
  const reserved = win32LiteralPath(cwd, 'nul');
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    fs.writeFileSync(reserved, 'junk\n');
    const clean = await gitStatus(cwd);
    assert.equal(clean.hasWorkingTreeChanges, false);
    assert.deepEqual(clean.workingTree, { files: [], insertions: 0, deletions: 0 });
    fs.writeFileSync(path.join(cwd, 'extra.md'), 'x\n');
    const dirty = await gitStatus(cwd);
    assert.equal(dirty.hasWorkingTreeChanges, true);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(reserved, { force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitCommit featureBranch creates a ref from the commit subject', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\nworld\n');
    const result = await gitCommit(cwd, 'Add world line', undefined, undefined, { featureBranch: true });
    assert.equal(result.ok, true, result.message);
    const status = await gitStatus(cwd);
    assert.equal(status.refName, 'feature/add-world-line');
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('parsePorcelainZ skips rename origin fields', () => {
  const entries = parsePorcelainZ('R  old.txt\0new.txt\0 M src/a.ts\0?? extra.md\0');
  assert.deepEqual(entries, [
    { path: 'new.txt', xy: 'R ' },
    { path: 'src/a.ts', xy: ' M' },
    { path: 'extra.md', xy: '??' },
  ]);
});

test('gitStatus accepts a second authorized git root and ignores an outsider repo', async () => {
  const boot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-boot-'));
  const extra = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-extra-'));
  const outsider = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-out-'));
  setWorkspaceAuthority(createWorkspaceAuthority({
    workspace: boot,
    extraWorkspaces: [extra],
  }));
  try {
    git(extra, ['init']);
    git(extra, ['config', 'user.email', 'git-test@example.com']);
    git(extra, ['config', 'user.name', 'Git Test']);
    git(extra, ['checkout', '-b', 'main']);
    git(outsider, ['init']);
    const status = await gitStatus(extra);
    assert.ok(status);
    assert.equal(status.refName, 'main');
    assert.equal(await gitStatus(outsider), null);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(boot, { recursive: true, force: true });
    fs.rmSync(extra, { recursive: true, force: true });
    fs.rmSync(outsider, { recursive: true, force: true });
  }
});

// Automated stand-in for the packaged QA pair TC-WS-006 + TC-GIT-001's key
// assertion (`qa:packaged` step `packaged.git.branchList`): a repository
// registered in the harness `workspace.json` — a *sibling* of the boot
// workspace, not its subdirectory — must resolve through the full
// registration chain (readHarnessRegisteredWorkspacePaths →
// filterRegisteredWorkspaceRoots → authority) and list its real branches.
// This is a rehearsal, not the installed-package QA table itself.
test('gitBranchList lists branches of a workspace.json-registered sibling repository', async () => {
  const { readHarnessRegisteredWorkspacePaths, filterRegisteredWorkspaceRoots } = require('./workspace-authority');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-home-'));
  const boot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-boot-'));
  const sibling = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-sibling-'));
  fs.mkdirSync(path.join(home, 'storages'), { recursive: true });
  fs.writeFileSync(path.join(home, 'storages', 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace' },
    tables: { workspaces: { w1: { path: sibling } } },
  }));
  setWorkspaceAuthority(createWorkspaceAuthority({
    workspace: boot,
    listRegisteredWorkspaces: () => filterRegisteredWorkspaceRoots(
      readHarnessRegisteredWorkspacePaths(home),
    ),
  }));
  try {
    git(sibling, ['init']);
    git(sibling, ['config', 'user.email', 'git-test@example.com']);
    git(sibling, ['config', 'user.name', 'Git Test']);
    git(sibling, ['checkout', '-b', 'master']);
    fs.writeFileSync(path.join(sibling, 'README.md'), 'sibling\n');
    git(sibling, ['add', 'README.md']);
    git(sibling, ['commit', '-m', 'init']);
    git(sibling, ['branch', 'feature/qa']);
    const listed = await gitBranchList(sibling);
    assert.equal(listed.ok, true);
    const current = listed.branches.find((row) => row.isCurrent);
    assert.ok(current, 'the registered sibling must expose its current branch');
    assert.equal(current.name, 'master');
    assert.ok(listed.branches.some((row) => row.name === 'feature/qa'));
    // The registration is the only trust root that admits the sibling: the
    // same list without it is the authorization failure, not an empty repo.
    setWorkspaceAuthority(createWorkspaceAuthority({ workspace: boot }));
    const unauthorized = await gitBranchList(sibling);
    assert.equal(unauthorized.ok, false);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(boot, { recursive: true, force: true });
    fs.rmSync(sibling, { recursive: true, force: true });
  }
});

test('gitStage rejects a path outside the workspace', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init']);
    const escaped = await gitStage(cwd, path.join('..', 'outside.txt'));
    assert.equal(escaped.ok, false);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitStage stages real names that merely begin with two dots', async () => {
  // `resolveGitPath` used to treat any `rel.startsWith('..')` as an escape, so
  // files named `..notes` (and `sub/..cache`) could not be staged even though
  // they are ordinary children of the workspace.
  const cwd = makeTempDir();
  try {
    git(cwd, ['init']);
    git(cwd, ['config', 'user.email', 'git-test@example.com']);
    git(cwd, ['config', 'user.name', 'Git Test']);
    fs.writeFileSync(path.join(cwd, '..notes'), 'a\n');
    fs.mkdirSync(path.join(cwd, 'sub'));
    fs.writeFileSync(path.join(cwd, 'sub', '..cache'), 'b\n');

    assert.equal((await gitStage(cwd, '..notes')).ok, true, '..notes 必须可暂存');
    assert.equal((await gitStage(cwd, path.join('sub', '..cache'))).ok, true, 'sub/..cache 必须可暂存');
    const staged = git(cwd, ['diff', '--cached', '--name-only']);
    assert.match(staged, /\.\.notes/);

    // Real traversal is still refused.
    assert.equal((await gitStage(cwd, path.join('..', 'outside.txt'))).ok, false);
    assert.equal((await gitStage(cwd, path.join('sub', '..', '..', 'outside.txt'))).ok, false);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitStage, gitUnstage, and gitDiscard operate on a tracked file', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init']);
    git(cwd, ['config', 'user.email', 'git-test@example.com']);
    git(cwd, ['config', 'user.name', 'Git Test']);
    git(cwd, ['checkout', '-b', 'main']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'Add readme']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\nworld\n');
    const staged = await gitStage(cwd, 'README.md');
    assert.equal(staged.ok, true);
    const entries = await gitStatusEntries(cwd);
    assert.equal(entries.ok, true);
    const row = entries.entries.find((item) => item.path === 'README.md');
    assert.ok(row);
    assert.equal(row.xy[0], 'M');
    const unstaged = await gitUnstage(cwd, 'README.md');
    assert.equal(unstaged.ok, true);
    const discarded = await gitDiscard(cwd, 'README.md');
    assert.equal(discarded.ok, true);
    assert.equal(fs.readFileSync(path.join(cwd, 'README.md'), 'utf8').replace(/\r\n/g, '\n'), 'hello\n');
    fs.writeFileSync(path.join(cwd, 'scratch.txt'), 'tmp\n');
    fs.mkdirSync(path.join(cwd, 'scratch-dir'));
    fs.writeFileSync(path.join(cwd, 'scratch-dir', 'a.txt'), 'a\n');
    const discardedFile = await gitDiscard(cwd, 'scratch.txt');
    assert.equal(discardedFile.ok, true);
    assert.equal(fs.existsSync(path.join(cwd, 'scratch.txt')), false);
    const discardedDir = await gitDiscard(cwd, 'scratch-dir');
    assert.equal(discardedDir.ok, true);
    assert.equal(fs.existsSync(path.join(cwd, 'scratch-dir')), false);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitBranchList marks the current branch and gitSwitchBranch/gitCreateBranch round-trip', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'x\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);

    const listed = await gitBranchList(cwd);
    assert.equal(listed.ok, true);
    assert.equal(listed.branches.length, 1);
    assert.equal(listed.branches[0].name, 'main');
    assert.equal(listed.branches[0].isCurrent, true);
    assert.equal(listed.branches[0].isRemote, false);

    const created = await gitCreateBranch(cwd, 'feature/qa');
    assert.equal(created.ok, true, created.message);
    assert.equal(created.refName, 'feature/qa');

    const back = await gitSwitchBranch(cwd, 'main');
    assert.equal(back.ok, true, back.message);
    assert.equal(back.refName, 'main');
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitBranchList flags names outside the switch whitelist instead of hiding them', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'x\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    // Git accepts a leading underscore; safeRefName does not.
    git(cwd, ['branch', '_wip']);

    const listed = await gitBranchList(cwd);
    assert.equal(listed.ok, true, listed.message);
    const flagged = listed.branches.find((item) => item.name === '_wip');
    assert.ok(flagged, 'the unsupported branch stays listed');
    assert.equal(flagged.switchable, false);
    const main = listed.branches.find((item) => item.name === 'main');
    assert.equal('switchable' in main, false, 'supported names carry no switchable key');

    const switched = await gitSwitchBranch(cwd, '_wip');
    assert.equal(switched.ok, false);
    assert.match(switched.message, /characters the desktop cannot pass to git safely/);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitSwitchBranch checks out a branch already used by another worktree', async () => {
  const cwd = makeTempDir();
  const linked = path.join(cwd, 'linked');
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'x\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    git(cwd, ['checkout', '-b', 'large-bird']);
    git(cwd, ['checkout', 'main']);
    git(cwd, ['worktree', 'add', linked, 'large-bird']);

    const blocked = spawnSync('git', ['checkout', 'large-bird'], { cwd, encoding: 'utf8', windowsHide: true });
    assert.notEqual(blocked.status, 0);
    assert.match(`${blocked.stderr}\n${blocked.stdout}`, /already used by worktree/i);

    const switched = await gitSwitchBranch(cwd, 'large-bird');
    assert.equal(switched.ok, true, switched.message);
    assert.equal(switched.refName, 'large-bird');
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', linked], { cwd, windowsHide: true });
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitSwitchBranch on a remote-tracking ref creates the local branch instead of detaching HEAD', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'x\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    git(cwd, ['init', '--bare', 'remote.git']);
    git(cwd, ['remote', 'add', 'origin', path.join(cwd, 'remote.git')]);
    git(cwd, ['checkout', '-b', 'feature-x']);
    git(cwd, ['push', 'origin', 'feature-x']);
    git(cwd, ['checkout', 'main']);
    git(cwd, ['branch', '-D', 'feature-x']);

    const switched = await gitSwitchBranch(cwd, 'origin/feature-x');
    assert.equal(switched.ok, true, switched.message);
    assert.equal(switched.refName, 'feature-x');
    const head = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8', windowsHide: true });
    assert.equal(head.stdout.trim(), 'feature-x');
    const upstream = spawnSync('git', ['rev-parse', '--abbrev-ref', 'feature-x@{upstream}'], { cwd, encoding: 'utf8', windowsHide: true });
    assert.equal(upstream.stdout.trim(), 'origin/feature-x');
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitSwitchBranch and gitCreateBranch reject unsafe ref names', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init', '-b', 'main']);
    for (const bad of ['../evil', '-b', 'x..y', 'a/.lock', '']) {
      const switched = await gitSwitchBranch(cwd, bad);
      assert.equal(switched.ok, false, bad);
      assert.match(switched.message, /characters the desktop cannot pass to git safely/, bad);
      const created = await gitCreateBranch(cwd, bad);
      assert.equal(created.ok, false, bad);
      assert.match(created.message, /characters the desktop cannot pass to git safely/, bad);
    }
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('sanitizeProgressText strips ANSI and inferHookName maps hook lines', () => {
  assert.equal(sanitizeProgressText('\u001B[1mpre-commit\u001B[m'), 'pre-commit');
  assert.equal(inferHookName('lefthook v2.1.10'), 'pre-commit');
  assert.equal(inferHookName('pre-push (skip)'), 'pre-push');
  assert.equal(inferHookName('oxfmt --check'), null);
});

test('commitArgs splits subject and body', () => {
  assert.deepEqual(commitArgs('Fix toast'), ['commit', '-m', 'Fix toast']);
  assert.deepEqual(commitArgs('Fix toast\nMore detail'), ['commit', '-m', 'Fix toast', '-m', 'More detail']);
  assert.deepEqual(commitArgs('Fix toast\n\nMore detail'), ['commit', '-m', 'Fix toast', '-m', 'More detail']);
});

test('parseCustomCommitMessage keeps a single-newline body', () => {
  assert.deepEqual(parseCustomCommitMessage('Fix toast\nMore detail'), {
    subject: 'Fix toast',
    body: 'More detail',
  });
  assert.equal(parseCustomCommitMessage(''), null);
});

test('gitCommit keeps a custom subject verbatim (no sanitize)', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\nworld\n');
    const long = `Fix ${'x'.repeat(80)}.`;
    const result = await gitCommit(cwd, long);
    assert.equal(result.ok, true);
    assert.equal(result.subject, long.trim());
    const subject = git(cwd, ['log', '-1', '--pretty=%s']).trim();
    assert.equal(subject, long.trim());
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitCommit fails when git add fails and status listing also fails', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\nworld\n');
    fs.rmSync(path.join(cwd, '.git'), { recursive: true, force: true });
    fs.writeFileSync(path.join(cwd, '.git'), 'not a repository\n');
    const result = await gitCommit(cwd, 'should fail');
    assert.equal(result.ok, false, result.message);
    assert.notEqual(result.skipped, true);
    assert.match(String(result.message || ''), /add failed|not a git repository|invalid gitfile format|git add failed/i);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitCommit fails when git add cannot lock the index', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\nworld\n');
    fs.writeFileSync(path.join(cwd, '.git', 'index.lock'), '');
    const result = await gitCommit(cwd, 'should fail');
    assert.equal(result.ok, false, result.message);
    assert.notEqual(result.skipped, true);
    assert.match(String(result.message || ''), /add failed|index\.lock|Unable to create|locked|another git process/i);
    const log = git(cwd, ['log', '-1', '--pretty=%s']);
    assert.equal(log.trim(), 'base');
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitCommit skips when the worktree is clean', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    const result = await gitCommit(cwd, 'unused');
    assert.equal(result.ok, true, result.message);
    assert.equal(result.skipped, true);
    const log = git(cwd, ['log', '-1', '--pretty=%s']);
    assert.equal(log.trim(), 'base');
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitCommit featureBranch fails closed when there is nothing to commit', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    const result = await gitCommit(cwd, 'unused', undefined, undefined, { featureBranch: true });
    assert.equal(result.ok, false);
    assert.equal(result.message, 'Cannot create a feature branch because there are no changes to commit.');
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('commit timeout and git child env', () => {
  assert.equal(COMMIT_TIMEOUT_MS, 10 * 60_000);
  assert.equal(GH_TIMEOUT_MS, 30_000);
  const previousNpm = process.env.npm_config_electron_skip_binary_download;
  const previousCeiling = process.env.GIT_CEILING_DIRECTORIES;
  process.env.npm_config_electron_skip_binary_download = 'true';
  process.env.GIT_CEILING_DIRECTORIES = '/tmp/ceiling';
  try {
    const env = gitChildEnv();
    assert.equal(env.npm_config_electron_skip_binary_download, undefined);
    assert.equal(env.GIT_CEILING_DIRECTORIES, undefined);
    assert.equal(env.GIT_TERMINAL_PROMPT, '0');
    assert.equal(env.LC_ALL, 'C');
  } finally {
    if (previousNpm === undefined) delete process.env.npm_config_electron_skip_binary_download;
    else process.env.npm_config_electron_skip_binary_download = previousNpm;
    if (previousCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = previousCeiling;
  }
});

test('CRLF autocrlf warnings are not treated as the git failure', () => {
  const warning = "warning: in the working copy of 'src/a.ts' LF will be replaced by CRLF the next time Git touches it";
  assert.equal(isGitAdviceLine(warning), true);
  assert.equal(sanitizeProgressText(warning), '');
  assert.equal(gitFailureMessage({
    stderr: `${warning}\nhusky - pre-commit script failed (code 1)`,
    stdout: '',
  }, 'git commit failed.'), 'husky - pre-commit script failed (code 1)');
});

test('gitFailureMessage keeps the full dump including hint lines', () => {
  const dump = gitFailureMessage({
    stderr: [
      'To https://github.com/example/repo.git',
      ' ! [rejected]        main -> main (non-fast-forward)',
      "error: failed to push some refs to 'https://github.com/example/repo.git'",
      'hint: Updates were rejected because the tip of your current branch is behind',
    ].join('\n'),
    stdout: '',
  }, 'git push failed.');
  assert.match(dump, /non-fast-forward/);
  assert.match(dump, /failed to push some refs/);
  assert.match(dump, /hint: Updates were rejected/);
});

test('readPrTemplate prefers .github/PULL_REQUEST_TEMPLATE.md from the committed tree', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.mkdirSync(path.join(cwd, '.github'));
    fs.writeFileSync(path.join(cwd, '.github', 'PULL_REQUEST_TEMPLATE.md'), '## Why\n');
    git(cwd, ['add', '.github/PULL_REQUEST_TEMPLATE.md']);
    git(cwd, ['commit', '-m', 'template']);
    fs.writeFileSync(path.join(cwd, '.github', 'PULL_REQUEST_TEMPLATE.md'), '## Dirty\n');
    assert.equal(await readPrTemplate(cwd, 'HEAD'), '## Why');
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('readPrTemplate skips an ambiguous template directory', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.mkdirSync(path.join(cwd, '.github', 'PULL_REQUEST_TEMPLATE'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.github', 'PULL_REQUEST_TEMPLATE', 'a.md'), 'A\n');
    fs.writeFileSync(path.join(cwd, '.github', 'PULL_REQUEST_TEMPLATE', 'b.md'), 'B\n');
    git(cwd, ['add', '.github']);
    git(cwd, ['commit', '-m', 'templates']);
    assert.equal(await readPrTemplate(cwd, 'HEAD'), '');
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitStatus leaves pr null so the titlebar can load the change request separately', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init', '-b', 'main']);
    const status = await gitStatus(cwd);
    assert.equal(status.pr, null);
    const pr = await gitReadPullRequest(cwd);
    assert.equal(pr.ok, true);
    assert.equal(pr.pr, null);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('git.js and git-pullrequest.js do not spawn git status -sb', () => {
  const gitJs = fs.readFileSync(require.resolve('./git.js'), 'utf8');
  const prJs = fs.readFileSync(require.resolve('./git-pullrequest'), 'utf8');
  assert.doesNotMatch(gitJs, /status',\s*'-sb'/);
  assert.doesNotMatch(prJs, /status',\s*'-sb'/);
});

test('gitReadPullRequest returns null pr on detached HEAD without short-status', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    git(cwd, ['checkout', '--detach', 'HEAD']);
    const pr = await gitReadPullRequest(cwd);
    assert.equal(pr.ok, true, pr.message);
    assert.equal(pr.pr, null);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitCommit fail-closes when commit message generation returns an error', async () => {
  const cwd = makeTempDir();
  setTextGenerator(async () => ({ error: 'Commit message generation failed.' }));
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    const result = await gitCommit(cwd, '');
    assert.equal(result.ok, false);
    assert.equal(result.message, 'Commit message generation failed.');
  } finally {
    setTextGenerator(null);
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitCommit featureBranch generates under Preparing and uses the model branch', async () => {
  const cwd = makeTempDir();
  const phases = [];
  setTextGenerator(async (input) => {
    assert.equal(input.includeBranch, true);
    return { subject: 'Add stacked actions', body: '', branch: 'feature/implement-stacked-git-actions' };
  });
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\nworld\n');
    const result = await gitCommit(cwd, '', undefined, (event) => {
      if (event.kind === 'phase') phases.push(event.title);
    }, { featureBranch: true });
    assert.equal(result.ok, true, result.message);
    assert.equal(phases[0], 'Preparing feature ref...');
    assert.equal(phases.includes('Generating commit message...'), false);
    const status = await gitStatus(cwd);
    assert.equal(status.refName, 'feature/implement-stacked-git-actions');
  } finally {
    setTextGenerator(null);
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('readRangeContext falls back to the local default when origin/HEAD is missing', async () => {
  const cwd = makeTempDir();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-bare-'));
  try {
    git(bare, ['init', '--bare']);
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    git(cwd, ['checkout', '-b', 'feature/demo']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\nworld\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'Add world']);
    git(cwd, ['remote', 'add', 'origin', bare]);
    const range = await readRangeContext(cwd);
    assert.match(range.commitSummary, /Add world/);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('gitCreateChangeRequest generates PR copy and ignores a client-supplied commit subject', async () => {
  const cwd = makeTempDir();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-bare-'));
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
    git(cwd, ['checkout', '-b', 'feature/demo']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\nworld\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'Add files']);
    git(cwd, ['remote', 'add', 'origin', bare]);
    git(cwd, ['push', '-u', 'origin', 'HEAD']);
    // Provider gate requires a GitHub-shaped URL; keep tracking from the bare push.
    git(cwd, ['remote', 'set-url', 'origin', 'https://github.com/acme/demo.git']);
    const result = await gitCreateChangeRequest(cwd, { title: 'Add files', body: '' });
    assert.equal(seen.kind, 'pr');
    assert.notEqual(seen.fallbackTitle, 'Add files');
    assert.equal(seen.fallbackTitle, 'feature/demo');
    assert.equal(result.ok, false);
  } finally {
    setTextGenerator(null);
    setGhDefaultBranchResolver(null);
    setLookupOpenPullRequest(null);
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('gitCreateChangeRequest refuses a dirty work tree', async () => {
  const cwd = makeTempDir();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-bare-'));
  try {
    git(bare, ['init', '--bare']);
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    git(cwd, ['checkout', '-b', 'feature/demo']);
    git(cwd, ['remote', 'add', 'origin', bare]);
    git(cwd, ['push', '-u', 'origin', 'HEAD']);
    git(cwd, ['remote', 'set-url', 'origin', 'https://github.com/acme/demo.git']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\ndirty\n');
    const result = await gitCreateChangeRequest(cwd, {});
    assert.equal(result.ok, false);
    assert.equal(result.message, 'Commit local changes before creating a PR.');
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('gitStatus counts no-upstream ahead against the default ref', async () => {
  const cwd = makeTempDir();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-bare-'));
  try {
    git(bare, ['init', '--bare']);
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    git(cwd, ['remote', 'add', 'origin', bare]);
    git(cwd, ['push', '-u', 'origin', 'HEAD']);
    git(cwd, ['checkout', '-b', 'feature/ahead']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\nnext\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'next']);
    const status = await gitStatus(cwd);
    assert.equal(status.hasUpstream, false);
    assert.equal(status.aheadCount, 1);
    assert.equal(status.aheadOfDefaultCount, 1);
    assert.equal(status.isDefaultRef, false);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('gitStatus zeros aheadOfDefaultCount on the default ref', async () => {
  const cwd = makeTempDir();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-bare-'));
  try {
    git(bare, ['init', '--bare']);
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    git(cwd, ['remote', 'add', 'origin', bare]);
    git(cwd, ['push', '-u', 'origin', 'HEAD']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\nnext\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'next']);
    const status = await gitStatus(cwd);
    assert.equal(status.refName, 'main');
    assert.equal(status.isDefaultRef, true);
    assert.equal(status.hasUpstream, true);
    assert.equal(status.aheadCount, 1);
    assert.equal(status.aheadOfDefaultCount, 0);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('aheadCount without upstream uses branch.<name>.gh-merge-base', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    git(cwd, ['checkout', '-b', 'develop']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\ndevelop\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'develop']);
    git(cwd, ['checkout', '-b', 'feature/topic']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\ndevelop\ntopic\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'topic']);
    git(cwd, ['config', 'branch.feature/topic.gh-merge-base', 'develop']);
    assert.equal(await resolveBaseBranchForNoUpstream(cwd, 'feature/topic'), 'develop');
    const status = await gitStatus(cwd);
    assert.equal(status.hasUpstream, false);
    assert.equal(status.aheadCount, 1);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitStatus marks aheadUnreliable when rev-list against the merge-base fails', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    git(cwd, ['checkout', '-b', 'feature/topic']);
    writeUnreadableMergeBase(cwd, 'broken');
    git(cwd, ['config', 'branch.feature/topic.gh-merge-base', 'broken']);
    const status = await gitStatus(cwd);
    assert.equal(status.hasUpstream, false);
    assert.equal(status.aheadCount, 0);
    assert.equal(status.aheadUnreliable, true);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('resolvePrBaseBranch prefers branch.<name>.gh-merge-base', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    git(cwd, ['checkout', '-b', 'develop']);
    git(cwd, ['checkout', '-b', 'feature/topic']);
    git(cwd, ['config', 'branch.feature/topic.gh-merge-base', 'develop']);
    assert.equal(await resolvePrBaseBranch(cwd, 'feature/topic', false), 'develop');
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('resolvePrBaseBranch uses upstream branch when it differs from the local ref', async () => {
  const cwd = makeTempDir();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-bare-'));
  try {
    git(bare, ['init', '--bare']);
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    git(cwd, ['remote', 'add', 'origin', bare]);
    git(cwd, ['push', '-u', 'origin', 'HEAD']);
    git(cwd, ['checkout', '-b', 'feat-a']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\na\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'a']);
    git(cwd, ['push', '-u', 'origin', 'HEAD']);
    git(cwd, ['checkout', '-b', 'feat-b']);
    git(cwd, ['branch', '--set-upstream-to=origin/feat-a']);
    assert.equal(await resolvePrBaseBranch(cwd, 'feat-b', true), 'feat-a');
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('resolvePrBaseBranch uses an unparseable non-origin upstream name as --base', async () => {
  const cwd = makeTempDir();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-bare-'));
  try {
    git(bare, ['init', '--bare']);
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    git(cwd, ['remote', 'add', 'origin', 'https://github.com/org/app.git']);
    git(cwd, ['remote', 'add', 'fork', bare]);
    git(cwd, ['push', '-u', 'fork', 'HEAD']);
    git(cwd, ['checkout', '-b', 'feat-a']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\na\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'a']);
    git(cwd, ['push', '-u', 'fork', 'HEAD']);
    git(cwd, ['checkout', '-b', 'feat-b']);
    git(cwd, ['branch', '--set-upstream-to=fork/feat-a']);
    setGhDefaultBranchResolver(async () => 'develop');
    assert.equal(await resolvePrBaseBranch(cwd, 'feat-b', true), 'feat-a');
  } finally {
    setGhDefaultBranchResolver(null);
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('resolvePrBaseBranch prefers gh defaultBranchRef over local main', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    git(cwd, ['checkout', '-b', 'feature/topic']);
    setGhDefaultBranchResolver(async () => 'develop');
    assert.equal(await resolvePrBaseBranch(cwd, 'feature/topic', false), 'develop');
  } finally {
    setGhDefaultBranchResolver(null);
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('resolvePrBaseBranch falls back to git default when gh is unavailable', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    git(cwd, ['checkout', '-b', 'feature/topic']);
    setGhDefaultBranchResolver(async () => null);
    assert.equal(await resolvePrBaseBranch(cwd, 'feature/topic', false), 'main');
  } finally {
    setGhDefaultBranchResolver(null);
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('parseGitHubRepositoryNameWithOwner and preferred head for forks', () => {
  assert.equal(
    parseGitHubRepositoryNameWithOwner('git@github.com:acme/demo.git'),
    'acme/demo',
  );
  assert.equal(
    parseGitHubRepositoryNameWithOwner('https://github.com/acme/demo.git'),
    'acme/demo',
  );
});

test('parseRepositoryNameWithOwnerFromNormalized ignores filesystem remotes', () => {
  assert.equal(
    parseRepositoryNameWithOwnerFromNormalized('/var/folders/df/tmp/T/dsh-git-bare-x'),
    null,
  );
  assert.equal(
    parseRepositoryNameWithOwnerFromNormalized('C:\\Users\\me\\AppData\\Local\\Temp\\dsh-git-bare-x'),
    null,
  );
  assert.equal(
    parseRepositoryNameWithOwnerFromNormalized('https://github.com/upstream/app.git'),
    'upstream/app',
  );
});

test('resolveLastKnownPr keeps the badge when head identity still matches', () => {
  resetLastKnownPrCache();
  const key = 'C:\\repo\u0000feature';
  const pr = { number: 7, title: 'Fix', url: 'https://example/pr/7', state: 'open' };
  rememberLastKnownPr(key, {
    pr,
    headBranch: 'feature',
    upstreamRef: 'origin/feature',
    remoteName: 'origin',
    headRemoteUrlKey: 'owner/repo',
  });
  assert.deepEqual(
    resolveLastKnownPr(key, {
      headBranch: 'feature',
      upstreamRef: 'origin/feature',
      remoteName: 'origin',
      headRemoteUrlKey: 'owner/repo',
    }),
    pr,
  );
  assert.equal(
    resolveLastKnownPr(key, {
      headBranch: 'other',
      upstreamRef: 'origin/feature',
      remoteName: 'origin',
      headRemoteUrlKey: 'owner/repo',
    }),
    null,
  );
  resetLastKnownPrCache();
});

test('resolveBranchHeadContext lists owner:branch for cross-repo upstreams', async () => {
  const cwd = makeTempDir();
  const bareOrigin = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-bare-o-'));
  const bareFork = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-bare-f-'));
  try {
    git(bareOrigin, ['init', '--bare']);
    git(bareFork, ['init', '--bare']);
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    git(cwd, ['remote', 'add', 'origin', bareOrigin]);
    git(cwd, ['remote', 'add', 'fork', bareFork]);
    git(cwd, ['push', '-u', 'fork', 'HEAD']);
    // Simulate GitHub URL shapes so owner:branch selectors appear.
    git(cwd, ['remote', 'set-url', 'origin', 'https://github.com/upstream/app.git']);
    git(cwd, ['remote', 'set-url', 'fork', 'https://github.com/me/app.git']);
    const ctx = await resolveBranchHeadContext(cwd, 'main');
    assert.equal(ctx.isCrossRepository, true);
    assert.equal(ctx.preferredHeadSelector, 'me:main');
    assert.ok(ctx.headSelectors.includes('me:main'));
    assert.ok(ctx.headSelectors.includes('main'));
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(bareOrigin, { recursive: true, force: true });
    fs.rmSync(bareFork, { recursive: true, force: true });
  }
});

test('resolveBranchHeadContext keeps branch.*.remote after upstream is unset', async () => {
  const cwd = makeTempDir();
  const bareFork = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-bare-f2-'));
  try {
    git(bareFork, ['init', '--bare']);
    git(cwd, ['init', '-b', 'feature']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    git(cwd, ['remote', 'add', 'origin', 'https://github.com/upstream/app.git']);
    git(cwd, ['remote', 'add', 'fork', bareFork]);
    git(cwd, ['push', '-u', 'fork', 'HEAD']);
    git(cwd, ['remote', 'set-url', 'fork', 'https://github.com/me/app.git']);
    git(cwd, ['branch', '--unset-upstream']);
    // Remote can remain configured before the next `push -u` (reads branch.*.remote).
    git(cwd, ['config', 'branch.feature.remote', 'fork']);
    const ctx = await resolveBranchHeadContext(cwd, 'feature');
    assert.equal(ctx.remoteName, 'fork');
    assert.equal(ctx.isCrossRepository, true);
    assert.ok(ctx.headSelectors.includes('me:feature'));
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(bareFork, { recursive: true, force: true });
  }
});

test('matchesBranchHeadContext rejects a same-branch PR from the wrong repo', () => {
  const headContext = {
    headBranch: 'feature',
    headRepositoryNameWithOwner: 'me/app',
    headRepositoryOwnerLogin: 'me',
    isCrossRepository: true,
  };
  assert.equal(
    matchesBranchHeadContext({
      headRef: 'feature',
      isCrossRepository: true,
      headRepositoryNameWithOwner: 'me/app',
      headRepositoryOwnerLogin: 'me',
    }, headContext),
    true,
  );
  assert.equal(
    matchesBranchHeadContext({
      headRef: 'feature',
      isCrossRepository: false,
      headRepositoryNameWithOwner: 'upstream/app',
      headRepositoryOwnerLogin: 'upstream',
    }, headContext),
    false,
  );
});

test('parseGhPullRequestRow synthesizes cross-repo head identity from the PR URL', () => {
  const row = parseGhPullRequestRow({
    number: 12,
    title: 'Fork PR',
    url: 'https://github.com/upstream/app/pull/12',
    baseRefName: 'main',
    headRefName: 'feature',
    state: 'OPEN',
    isCrossRepository: true,
    headRepositoryOwner: { login: 'me' },
  });
  assert.equal(row.headRepositoryNameWithOwner, 'me/app');
  assert.equal(row.headRepositoryOwnerLogin, 'me');
  assert.equal(
    matchesBranchHeadContext(row, {
      headBranch: 'feature',
      isCrossRepository: true,
      headRepositoryNameWithOwner: 'me/app',
      headRepositoryOwnerLogin: 'me',
    }),
    true,
  );
});

test('providerFromRemoteUrl recognizes GitHub self-hosted hosts', () => {
  assert.equal(providerFromRemoteUrl('https://github.mycompany.com/org/repo.git')?.kind, 'github');
  assert.equal(providerFromRemoteUrl('git@github-work:org/repo.git')?.kind, 'github');
  assert.equal(providerFromRemoteUrl('https://bitbucket.company.com/scm/proj/repo.git')?.kind, 'bitbucket');
});

test('normalizeGitRemoteUrl matches scp and https forms', () => {
  assert.equal(
    normalizeGitRemoteUrl('git@github.com:acme/demo.git'),
    normalizeGitRemoteUrl('https://github.com/acme/demo.git'),
  );
});

test('gitPush skips when there is no local delta and the remote branch already exists', async () => {
  const cwd = makeTempDir();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-bare-'));
  try {
    resetFetchCooldowns();
    git(bare, ['init', '--bare']);
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    git(cwd, ['remote', 'add', 'origin', bare]);
    git(cwd, ['push', '-u', 'origin', 'HEAD']);
    git(cwd, ['checkout', '-b', 'feature/same']);
    git(cwd, ['push', '-u', 'origin', 'HEAD']);
    git(cwd, ['branch', '--unset-upstream']);
    const pushed = await gitPush(cwd);
    assert.equal(pushed.ok, true);
    assert.equal(pushed.status, 'skipped');
  } finally {
    resetFetchCooldowns();
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('gitPush no-upstream skip uses gh-merge-base when defaultRefName is missing', async () => {
  const cwd = makeTempDir();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-bare-'));
  try {
    resetFetchCooldowns();
    git(bare, ['init', '--bare']);
    git(cwd, ['init', '-b', 'develop']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    git(cwd, ['remote', 'add', 'origin', bare]);
    git(cwd, ['push', '-u', 'origin', 'HEAD']);
    git(cwd, ['checkout', '-b', 'feature/topic']);
    git(cwd, ['push', '-u', 'origin', 'HEAD']);
    git(cwd, ['branch', '--unset-upstream']);
    git(cwd, ['config', 'branch.feature/topic.gh-merge-base', 'develop']);
    assert.equal(await resolveBaseBranchForNoUpstream(cwd, 'feature/topic'), 'origin/develop');
    const pushed = await gitPush(cwd);
    assert.equal(pushed.ok, true);
    assert.equal(pushed.status, 'skipped');
  } finally {
    resetFetchCooldowns();
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('gitPush does not skip when no-upstream aheadCount is unreliable', async () => {
  const cwd = makeTempDir();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-bare-'));
  try {
    resetFetchCooldowns();
    git(bare, ['init', '--bare']);
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    git(cwd, ['remote', 'add', 'origin', bare]);
    git(cwd, ['push', '-u', 'origin', 'HEAD']);
    git(cwd, ['checkout', '-b', 'feature/unreliable']);
    writeUnreadableMergeBase(cwd, 'broken');
    git(cwd, ['config', 'branch.feature/unreliable.gh-merge-base', 'broken']);
    const status = await gitStatus(cwd);
    assert.equal(status.aheadUnreliable, true);
    const pushed = await gitPush(cwd);
    assert.equal(pushed.ok, true);
    assert.notEqual(pushed.status, 'skipped');
  } finally {
    resetFetchCooldowns();
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('FETCH_TIMEOUT_MS is the status-fetch timeout', () => {
  assert.equal(FETCH_TIMEOUT_MS, 5_000);
});

test('gitCommit marks a truncated staged patch for the generator', async () => {
  const cwd = makeTempDir();
  let seen = null;
  setTextGenerator(async (input) => {
    seen = input;
    return { subject: 'Add blob', body: '' };
  });
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    fs.writeFileSync(path.join(cwd, 'big.txt'), `${'x'.repeat(80_000)}\n`);
    const result = await gitCommit(cwd, '');
    assert.equal(result.ok, true, result.message);
    assert.equal(seen.kind, 'commit');
    assert.match(seen.stagedPatch, /\[truncated\]/);
  } finally {
    setTextGenerator(null);
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('resolvePrBaseBranch uses primary-remote HEAD when origin is absent', async () => {
  const cwd = makeTempDir();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-bare-'));
  try {
    git(bare, ['init', '--bare']);
    git(cwd, ['init', '-b', 'develop']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    git(cwd, ['remote', 'add', 'upstream', bare]);
    git(cwd, ['push', '-u', 'upstream', 'HEAD']);
    git(cwd, ['symbolic-ref', 'refs/remotes/upstream/HEAD', 'refs/remotes/upstream/develop']);
    git(cwd, ['checkout', '-b', 'feature/topic']);
    setGhDefaultBranchResolver(async () => null);
    assert.equal(await resolvePrBaseBranch(cwd, 'feature/topic', true), 'develop');
  } finally {
    setGhDefaultBranchResolver(null);
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('gitPull fast-forwards then reports up_to_date', async () => {
  const originCwd = makeTempDir();
  const cloneCwd = makeTempDir();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-bare-'));
  try {
    resetFetchCooldowns();
    git(bare, ['init', '--bare']);
    git(originCwd, ['init', '-b', 'main']);
    git(originCwd, ['config', 'user.email', 't@local']);
    git(originCwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(originCwd, 'README.md'), 'hello\n');
    git(originCwd, ['add', 'README.md']);
    git(originCwd, ['commit', '-m', 'base']);
    git(originCwd, ['remote', 'add', 'origin', bare]);
    git(originCwd, ['push', '-u', 'origin', 'HEAD']);
    git(bare, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    git(cloneCwd, ['clone', '--branch', 'main', bare, '.']);
    git(cloneCwd, ['config', 'user.email', 't@local']);
    git(cloneCwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(originCwd, 'README.md'), 'hello\nworld\n');
    git(originCwd, ['add', 'README.md']);
    git(originCwd, ['commit', '-m', 'ahead']);
    git(originCwd, ['push']);
    setWorkspaceAuthority(createWorkspaceAuthority({ workspace: cloneCwd }));
    const pulled = await gitPull(cloneCwd);
    assert.equal(pulled.ok, true, pulled.message);
    assert.equal(pulled.status, 'pulled');
    const again = await gitPull(cloneCwd);
    assert.equal(again.ok, true, again.message);
    assert.equal(again.status, 'up_to_date');
  } finally {
    resetFetchCooldowns();
    setWorkspaceAuthority(null);
    fs.rmSync(originCwd, { recursive: true, force: true });
    fs.rmSync(cloneCwd, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('gitPull refuses detached HEAD and a branch with no upstream', async () => {
  const cwd = makeTempDir();
  try {
    resetFetchCooldowns();
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    const noUpstream = await gitPull(cwd);
    assert.equal(noUpstream.ok, false);
    assert.match(noUpstream.message, /no upstream/);
    git(cwd, ['checkout', '--detach']);
    const detached = await gitPull(cwd);
    assert.equal(detached.ok, false);
    assert.match(detached.message, /detached HEAD/);
  } finally {
    resetFetchCooldowns();
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitPublishRepository adds a pasted origin without pushing an empty repo', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init', '-b', 'main']);
    const published = await gitPublishRepository(cwd, {
      remoteUrl: 'https://github.com/acme/empty.git',
      visibility: 'public',
    });
    assert.equal(published.ok, true, published.message);
    assert.equal(published.status, 'remote_added');
    assert.equal(published.url, 'https://github.com/acme/empty.git');
    const remotes = git(cwd, ['remote', '-v']);
    assert.match(remotes, /origin\s+https:\/\/github.com\/acme\/empty.git/);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitPush sets origin/HEAD so a first-published non-main branch is the default ref', async () => {
  const cwd = makeTempDir();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-bare-'));
  try {
    resetFetchCooldowns();
    git(bare, ['init', '--bare']);
    git(cwd, ['init', '-b', 'dshd-qa-s09']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    git(cwd, ['remote', 'add', 'origin', bare]);
    const pushed = await gitPush(cwd);
    assert.equal(pushed.ok, true, pushed.message);
    assert.equal(pushed.status, 'pushed');
    const head = spawnSync('git', ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(head.status, 0, head.stderr || head.stdout);
    assert.match(head.stdout.trim(), /refs\/remotes\/origin\/dshd-qa-s09$/);
    const status = await gitStatus(cwd);
    assert.equal(status.refName, 'dshd-qa-s09');
    assert.equal(status.isDefaultRef, true);
    assert.equal(status.hasPrimaryRemote, true);
  } finally {
    resetFetchCooldowns();
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('gitPush skip still fills a missing origin/HEAD from the current branch', async () => {
  const cwd = makeTempDir();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-bare-'));
  try {
    resetFetchCooldowns();
    git(bare, ['init', '--bare']);
    git(cwd, ['init', '-b', 'topic']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    git(cwd, ['remote', 'add', 'origin', bare]);
    git(cwd, ['push', '-u', 'origin', 'HEAD']);
    const missing = spawnSync('git', ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.notEqual(missing.status, 0);
    const pushed = await gitPush(cwd);
    assert.equal(pushed.ok, true, pushed.message);
    assert.equal(pushed.status, 'skipped');
    const status = await gitStatus(cwd);
    assert.equal(status.refName, 'topic');
    assert.equal(status.isDefaultRef, true);
  } finally {
    resetFetchCooldowns();
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('gitPublishRepository pushes an existing history to a pasted origin', async () => {
  const cwd = makeTempDir();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-bare-'));
  try {
    resetFetchCooldowns();
    git(bare, ['init', '--bare']);
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    const published = await gitPublishRepository(cwd, { remoteUrl: bare });
    assert.equal(published.ok, true, published.message);
    assert.notEqual(published.status, 'remote_added');
    assert.equal(published.url, bare);
    git(bare, ['rev-parse', '--verify', 'refs/heads/main']);
  } finally {
    resetFetchCooldowns();
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('gitPublishRepository refuses a second origin', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['remote', 'add', 'origin', 'https://github.com/acme/already.git']);
    const published = await gitPublishRepository(cwd, {
      remoteUrl: 'https://github.com/acme/other.git',
    });
    assert.equal(published.ok, false);
    assert.match(published.message, /already has an origin/);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitCreateChangeRequest returns opened_existing for an open PR', async () => {
  const cwd = makeTempDir();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-bare-'));
  setLookupOpenPullRequest(async () => ({
    pr: {
      number: 7,
      title: 'Existing',
      url: 'https://github.com/acme/demo/pull/7',
      state: 'open',
    },
    failed: false,
  }));
  try {
    git(bare, ['init', '--bare']);
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    git(cwd, ['checkout', '-b', 'feature/demo']);
    git(cwd, ['remote', 'add', 'origin', bare]);
    git(cwd, ['push', '-u', 'origin', 'HEAD']);
    git(cwd, ['remote', 'set-url', 'origin', 'https://github.com/acme/demo.git']);
    const result = await gitCreateChangeRequest(cwd, {});
    assert.equal(result.ok, true, result.message);
    assert.equal(result.status, 'opened_existing');
    assert.equal(result.url, 'https://github.com/acme/demo/pull/7');
    assert.equal(result.number, 7);
    assert.equal(result.skipped, true);
  } finally {
    setLookupOpenPullRequest(null);
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('gitStatus and gitPush treat a deleted upstream as unpublished', async () => {
  const cwd = makeTempDir();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-bare-'));
  try {
    resetFetchCooldowns();
    git(bare, ['init', '--bare']);
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    git(cwd, ['remote', 'add', 'origin', bare]);
    git(cwd, ['push', '-u', 'origin', 'HEAD']);
    git(cwd, ['checkout', '-b', 'feature/gone']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\nfeature\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'feature']);
    git(cwd, ['push', '-u', 'origin', 'HEAD']);
    git(cwd, ['push', 'origin', '--delete', 'feature/gone']);
    git(cwd, ['fetch', '--prune', 'origin']);
    const header = git(cwd, ['status', '-sb']).split(/\r?\n/)[0];
    assert.match(header, /\[gone\]/);
    const status = await gitStatus(cwd);
    assert.equal(status.hasUpstream, false);
    assert.ok(status.aheadCount > 0);
    const pushed = await gitPush(cwd);
    assert.equal(pushed.ok, true, pushed.message);
    assert.notEqual(pushed.status, 'skipped');
    git(bare, ['rev-parse', '--verify', 'refs/heads/feature/gone']);
  } finally {
    resetFetchCooldowns();
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('resolveBranchHeadContext does not treat an unparseable non-origin remote as a fork', async () => {
  const cwd = makeTempDir();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-bare-'));
  try {
    git(bare, ['init', '--bare']);
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);
    git(cwd, ['remote', 'add', 'origin', 'https://github.com/upstream/app.git']);
    git(cwd, ['remote', 'add', 'fork', bare]);
    git(cwd, ['push', '-u', 'fork', 'HEAD']);
    const ctx = await resolveBranchHeadContext(cwd, 'main');
    assert.equal(ctx.remoteName, 'fork');
    assert.equal(ctx.isCrossRepository, false);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('gitBranchList lists branches for a harness-registered sibling of the boot workspace', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-home-'));
  const boot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-boot-'));
  const sibling = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-sib-'));
  const previousConfig = require.cache[require.resolve('./config')];
  try {
    git(sibling, ['init', '-b', 'master']);
    git(sibling, ['config', 'user.email', 't@local']);
    git(sibling, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(sibling, 'README.md'), 'x\n');
    git(sibling, ['add', 'README.md']);
    git(sibling, ['commit', '-m', 'base']);
    fs.mkdirSync(path.join(home, 'storages'));
    fs.writeFileSync(path.join(home, 'storages', 'workspace.json'), `${JSON.stringify({
      unit: { name: 'workspace', version: 2 },
      tables: {
        workspaces: {
          'ws-sibling': { path: sibling, title: 'ChisaTerminal' },
        },
      },
    })}\n`, 'utf8');
    require.cache[require.resolve('./config')] = {
      id: require.resolve('./config'),
      filename: require.resolve('./config'),
      loaded: true,
      exports: { loadConfig: () => ({ workspace: boot }) },
    };
    setDesktopDshHome(home);
    setWorkspaceAuthority(null);
    const listed = await gitBranchList(sibling);
    assert.equal(listed.ok, true, listed.message);
    assert.equal(listed.branches.some((item) => item.name === 'master' && item.isCurrent), true);
    const status = await gitStatus(sibling);
    assert.equal(status?.isRepo, true);
    assert.equal(status?.refName, 'master');
  } finally {
    if (previousConfig) require.cache[require.resolve('./config')] = previousConfig;
    else delete require.cache[require.resolve('./config')];
    clearDesktopDshHome();
    setWorkspaceAuthority(null);
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(boot, { recursive: true, force: true });
    fs.rmSync(sibling, { recursive: true, force: true });
  }
});

/**
 * One titlebar refresh is `gitStatus` + `gitFetchForStatus` + `gitReadPullRequest`.
 * The read context has to collapse the three status walks into one, so the
 * spawn counts below are asserted against the exact commands, not just totals.
 */
test('one titlebar refresh runs a single status walk and a single numstat', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-refresh-'));
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-refresh-bare-'));
  try {
    git(bare, ['init', '--bare']);
    git(root, ['init', '-b', 'main']);
    git(root, ['config', 'user.email', 't@local']);
    git(root, ['config', 'user.name', 'T']);
    for (let i = 0; i < 40; i += 1) {
      fs.writeFileSync(path.join(root, `file-${i}.txt`), `line ${i}\n`);
    }
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'base']);
    git(root, ['remote', 'add', 'origin', bare]);
    git(root, ['push', '-u', 'origin', 'main']);
    for (let i = 0; i < 10; i += 1) {
      fs.appendFileSync(path.join(root, `file-${i}.txt`), `dirty ${i}\n`);
    }
    setWorkspaceAuthority(createWorkspaceAuthority({ workspace: root }));
    // Warm the fetch cooldown first: the target is a *steady-state* refresh,
    // where the fetch is skipped and the status must come from the read
    // context. The first pass legitimately pays one real fetch + re-read.
    await gitStatus(root);
    await gitFetchForStatus(root);

    gitSpawnLog.length = 0;
    countingGitSpawns = true;
    try {
      const [status, fetched, pr] = await Promise.all([
        gitStatus(root),
        gitFetchForStatus(root),
        gitReadPullRequest(root),
      ]);
      assert.equal(status?.isRepo, true);
      assert.equal(fetched?.isRepo, true);
      assert.equal(pr.ok, true);
    } finally {
      countingGitSpawns = false;
    }

    const porcelain = gitSpawnLog.filter((line) => line.startsWith('status --porcelain=v2')).length;
    const numstat = gitSpawnLog.filter((line) => line === 'diff HEAD --numstat').length;
    assert.equal(porcelain, 1, gitSpawnLog.join('\n'));
    assert.equal(numstat, 1, gitSpawnLog.join('\n'));
    assert.ok(
      gitSpawnLog.length <= 11,
      `expected the warm refresh to stay within 11 local git children, saw ${gitSpawnLog.length}:\n${gitSpawnLog.join('\n')}`,
    );

    // The refresh leaves the status memo armed for its 2s handoff window; a
    // real window blur/quit would expire it, but a test that deletes the temp
    // repo must not leave `git.js` holding a context for a directory that is
    // about to disappear.
    resetReadContexts();
  } finally {
    resetFetchCooldowns();
    setWorkspaceAuthority(null);
    // Windows can still hold the pack/index handles opened by the background
    // fetch for a beat after the child exits.
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    fs.rmSync(bare, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function initStatusFetchFixture(root) {
  const seed = path.join(root, 'seed');
  const bare = path.join(root, 'remote.git');
  const cwd = path.join(root, 'repo');
  const linked = path.join(root, 'linked');
  fs.mkdirSync(seed);
  git(seed, ['init', '-b', 'main']);
  git(seed, ['config', 'user.email', 't@local']);
  git(seed, ['config', 'user.name', 'T']);
  fs.writeFileSync(path.join(seed, 'file.txt'), 'base\n');
  git(seed, ['add', 'file.txt']);
  git(seed, ['commit', '-m', 'fixture base']);
  git(root, ['clone', '--bare', seed, bare]);
  git(root, ['clone', bare, cwd]);
  git(cwd, ['worktree', 'add', '-b', 'linked', linked]);
  git(linked, ['branch', '--set-upstream-to=origin/main', 'linked']);
  return { seed, bare, cwd, linked };
}

function cleanStatusFetchFixture(root) {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('dsh-git-'));
  resetFetchCooldowns();
  resetReadContexts();
  setWorkspaceAuthority(null);
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

test('concurrent status fetch shares linked-worktree refs and refreshes every owner', async () => {
  const root = makeTempDir();
  try {
    resetFetchCooldowns();
    const { seed, bare, cwd, linked } = initStatusFetchFixture(root);
    fs.appendFileSync(path.join(cwd, 'file.txt'), 'main dirty\n');
    fs.appendFileSync(path.join(linked, 'file.txt'), 'linked dirty\n');
    const initial = await Promise.all([gitStatus(cwd, 'main-owner'), gitStatus(linked, 'linked-owner')]);
    assert.deepEqual(initial.map(status => status.behindCount), [0, 0]);
    fs.appendFileSync(path.join(seed, 'file.txt'), 'remote update\n');
    git(seed, ['commit', '-am', 'fixture remote update']);
    git(bare, ['fetch', seed, 'main:main']);
    gitSpawnLog.length = 0;
    countingGitSpawns = true;
    try {
      const statuses = await Promise.all([
        gitFetchForStatus(cwd, 'main-owner'),
        gitFetchForStatus(linked, 'linked-owner'),
      ]);
      for (const status of statuses) {
        assert.equal(status.behindCount, 1);
        assert.equal(status.hasWorkingTreeChanges, true);
        assert.equal(status.workingTree.files.find(file => file.path === 'file.txt').insertions, 1);
      }
      assert.equal(gitSpawnLog.filter(line => line.startsWith('fetch ')).length, 1, gitSpawnLog.join('\n'));
      // A new local refresh must still observe external edits during fetch TTL.
      fs.writeFileSync(path.join(cwd, 'external.txt'), 'external edit\n');
      const fresh = await gitStatus(cwd, 'main-owner');
      assert.ok(fresh.workingTree.files.some(file => file.path === 'external.txt'));
      const cooled = await gitFetchForStatus(cwd, 'main-owner');
      assert.ok(cooled.workingTree.files.some(file => file.path === 'external.txt'));
      assert.equal(gitSpawnLog.filter(line => line.startsWith('fetch ')).length, 1);
    } finally {
      countingGitSpawns = false;
    }
  } finally {
    cleanStatusFetchFixture(root);
  }
});

test('concurrent status fetch keeps different remote and common-directory identities separate', async () => {
  const root = makeTempDir();
  try {
    resetFetchCooldowns();
    const { seed, bare, cwd, linked } = initStatusFetchFixture(root);
    const backup = path.join(root, 'backup.git');
    const independent = path.join(root, 'independent');
    git(root, ['clone', '--bare', seed, backup]);
    git(cwd, ['remote', 'add', 'backup', backup]);
    git(cwd, ['fetch', 'backup']);
    git(linked, ['branch', '--set-upstream-to=backup/main', 'linked']);
    git(root, ['clone', bare, independent]);
    gitSpawnLog.length = 0;
    countingGitSpawns = true;
    try {
      const results = await Promise.all([fetchForStatus(cwd), fetchForStatus(linked), fetchForStatus(independent)]);
      assert.deepEqual(results, Array.from({ length: 3 }, () => ({ fetched: true, ok: true })));
      const fetches = gitSpawnLog.filter(line => line.startsWith('fetch '));
      assert.equal(fetches.length, 3, gitSpawnLog.join('\n'));
      assert.equal(fetches.filter(line => line.endsWith(' origin')).length, 2);
      assert.equal(fetches.filter(line => line.endsWith(' backup')).length, 1);
    } finally {
      countingGitSpawns = false;
    }
  } finally {
    cleanStatusFetchFixture(root);
  }
});

test('shared status fetch releases failures and preserves backoff and success TTL boundaries', async () => {
  const root = makeTempDir();
  const realNow = Date.now;
  let now = 1_000_000;
  try {
    resetFetchCooldowns();
    const { bare, cwd, linked } = initStatusFetchFixture(root);
    git(cwd, ['remote', 'set-url', 'origin', path.join(root, 'missing.git')]);
    fs.appendFileSync(path.join(cwd, 'file.txt'), 'local edit despite remote failure\n');
    Date.now = () => now;
    gitSpawnLog.length = 0;
    countingGitSpawns = true;
    try {
      const delays = [30_000, 60_000, 120_000, 240_000, 480_000, 900_000, 900_000];
      for (let index = 0; index < delays.length; index++) {
        const results = index === 0
          ? await Promise.all([fetchForStatus(cwd), fetchForStatus(linked)])
          : [await fetchForStatus(cwd)];
        assert.deepEqual(results, results.map(() => ({ fetched: true, ok: false })));
        assert.equal(gitSpawnLog.filter(line => line.startsWith('fetch ')).length, index + 1);
        if (index === 0) {
          const localStatus = await gitFetchForStatus(cwd, 'failed-fetch-owner');
          assert.equal(localStatus.isRepo, true);
          assert.equal(localStatus.hasWorkingTreeChanges, true);
          assert.equal(localStatus.workingTree.files.find(file => file.path === 'file.txt').insertions, 1);
        }
        now += delays[index] - 1;
        assert.deepEqual(await fetchForStatus(cwd), { fetched: false, ok: false });
        now += 1;
      }
      git(cwd, ['remote', 'set-url', 'origin', bare]);
      assert.deepEqual(await fetchForStatus(cwd), { fetched: true, ok: true });
      now += 14_999;
      assert.deepEqual(await fetchForStatus(linked), { fetched: false, ok: false });
      now += 1;
      assert.deepEqual(await fetchForStatus(linked), { fetched: true, ok: true });
      assert.equal(gitSpawnLog.filter(line => line.startsWith('fetch ')).length, delays.length + 2);
    } finally {
      countingGitSpawns = false;
    }
  } finally {
    Date.now = realNow;
    cleanStatusFetchFixture(root);
  }
});

test('a git write invalidates the read context so status cannot answer from pre-write memory', async () => {
  const cwd = makeTempDir();
  try {
    git(cwd, ['init', '-b', 'main']);
    git(cwd, ['config', 'user.email', 't@local']);
    git(cwd, ['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello\n');
    git(cwd, ['add', 'README.md']);
    git(cwd, ['commit', '-m', 'base']);

    const before = await gitStatus(cwd);
    assert.equal(before.hasWorkingTreeChanges, false);
    assert.equal(before.workingTree.files.length, 0);

    // Claim the staged change right after the status above published a memo for
    // this worktree; the write must drop it or the next status reports a clean
    // tree from the pre-stage answer.
    fs.writeFileSync(path.join(cwd, 'README.md'), 'hello staged\n');
    const staged = await gitStage(cwd, 'README.md');
    assert.equal(staged.ok, true, staged.message);

    const after = await gitStatus(cwd);
    assert.equal(after.hasWorkingTreeChanges, true, 'status must see the staged change');
    const entry = after.workingTree.files.find((item) => item.path === 'README.md');
    assert.ok(entry, JSON.stringify(after.workingTree.files));
    assert.equal(entry.insertions, 1);
    assert.equal(entry.deletions, 1);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

const MIB = 1024 * 1024;

/**
 * Create a sparse file of `bytes` without writing the payload.
 * @param {string} target - absolute path.
 * @param {number} bytes - resulting size.
 */
function makeSparseFile(target, bytes) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const fd = fs.openSync(target, 'w');
  fs.ftruncateSync(fd, bytes);
  fs.closeSync(fd);
}

/**
 * Initialize a repository with one commit so `git status` has a baseline.
 * @param {string} cwd - repo root.
 */
function initRepoWithBase(cwd) {
  git(cwd, ['init', '-b', 'main']);
  git(cwd, ['config', 'user.email', 't@local']);
  git(cwd, ['config', 'user.name', 'T']);
  fs.writeFileSync(path.join(cwd, 'README.md'), 'base\n');
  git(cwd, ['add', 'README.md']);
  git(cwd, ['commit', '-m', 'base']);
}

test('gitCheckLargeFiles flags only files strictly over 100 MB', async () => {
  const cwd = makeTempDir();
  try {
    initRepoWithBase(cwd);
    makeSparseFile(path.join(cwd, 'at-limit.bin'), 100 * MIB);
    makeSparseFile(path.join(cwd, 'over-limit.bin'), 100 * MIB + 1);
    const result = await gitCheckLargeFiles(cwd);
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(result.files, [{ path: 'over-limit.bin', size: 100 * MIB + 1 }]);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitCheckLargeFiles reports spaces and non-ASCII paths verbatim', async () => {
  const cwd = makeTempDir();
  try {
    initRepoWithBase(cwd);
    makeSparseFile(path.join(cwd, 'a dir', 'ünï code.bin'), 101 * MIB);
    const result = await gitCheckLargeFiles(cwd);
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(result.files, [{ path: 'a dir/ünï code.bin', size: 101 * MIB }]);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitCheckLargeFiles skips ignored paths', async () => {
  const cwd = makeTempDir();
  try {
    initRepoWithBase(cwd);
    fs.writeFileSync(path.join(cwd, '.gitignore'), 'ignored.bin\nignored-dir/\n');
    makeSparseFile(path.join(cwd, 'ignored.bin'), 120 * MIB);
    makeSparseFile(path.join(cwd, 'ignored-dir', 'nested.bin'), 120 * MIB);
    const result = await gitCheckLargeFiles(cwd);
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(result.files, []);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitCheckLargeFiles does not follow symlinks and never stages', async () => {
  const cwd = makeTempDir();
  try {
    initRepoWithBase(cwd);
    makeSparseFile(path.join(cwd, 'real.bin'), 101 * MIB);
    let linked = true;
    try {
      fs.symlinkSync(path.join(cwd, 'real.bin'), path.join(cwd, 'link.bin'));
    } catch {
      // Windows may require Developer Mode for symlinks; the size rule below
      // is still pinned by the real file.
      linked = false;
    }
    const result = await gitCheckLargeFiles(cwd);
    assert.equal(result.ok, true, result.message);
    // A link is skipped by lstat even when it points at an oversized target.
    assert.deepEqual(result.files, [{ path: 'real.bin', size: 101 * MIB }]);
    assert.equal(linked, true, 'symlink fixture unavailable on this host');
    const staged = git(cwd, ['diff', '--cached', '--name-only']).trim();
    assert.equal(staged, '');
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitCheckLargeFiles covers the whole repo when the cwd is an authorized subdirectory', async () => {
  const cwd = makeTempDir();
  try {
    initRepoWithBase(cwd);
    const sub = path.join(cwd, 'sub');
    makeSparseFile(path.join(sub, 'big.bin'), 101 * MIB);
    // `git add -A` from `sub` stages the whole tree, so an oversized file
    // above the cwd is still a commit candidate.
    makeSparseFile(path.join(cwd, 'root-big.bin'), 101 * MIB);
    const result = await gitCheckLargeFiles(sub);
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(result.files, [
      { path: 'root-big.bin', size: 101 * MIB },
      { path: 'sub/big.bin', size: 101 * MIB },
    ]);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitCheckLargeFiles stays inside the authorized root when it is a subdirectory', async () => {
  const boot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-lf-boot-'));
  const sub = path.join(boot, 'sub');
  try {
    initRepoWithBase(boot);
    makeSparseFile(path.join(boot, 'root-big.bin'), 101 * MIB);
    makeSparseFile(path.join(sub, 'sub-big.bin'), 101 * MIB);
    // Only the subdirectory is registered: the repository root above it is
    // outside the workspace, so its candidate must not be reported.
    setWorkspaceAuthority(createWorkspaceAuthority({ workspace: sub }));
    const result = await gitCheckLargeFiles(sub);
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(result.files, [{ path: 'sub/sub-big.bin', size: 101 * MIB }]);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(boot, { recursive: true, force: true });
  }
});

test('gitCheckLargeFiles skips a listed path that is gone from disk', async () => {
  const cwd = makeTempDir();
  try {
    initRepoWithBase(cwd);
    fs.writeFileSync(path.join(cwd, 'tracked-then-deleted.txt'), 'gone\n');
    git(cwd, ['add', 'tracked-then-deleted.txt']);
    git(cwd, ['commit', '-m', 'add file']);
    // `git status` still lists the deletion, but lstat now fails.
    fs.rmSync(path.join(cwd, 'tracked-then-deleted.txt'));
    const result = await gitCheckLargeFiles(cwd);
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(result.files, []);
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('gitCheckLargeFiles refuses an unauthorized cwd', async () => {
  const boot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-lf-boot-'));
  const outsider = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-lf-out-'));
  try {
    initRepoWithBase(outsider);
    makeSparseFile(path.join(outsider, 'big.bin'), 101 * MIB);
    setWorkspaceAuthority(createWorkspaceAuthority({ workspace: boot }));
    const result = await gitCheckLargeFiles(outsider);
    assert.equal(result.ok, false);
    assert.equal(result.message, 'Git status is unavailable.');
  } finally {
    setWorkspaceAuthority(null);
    fs.rmSync(boot, { recursive: true, force: true });
    fs.rmSync(outsider, { recursive: true, force: true });
  }
});
