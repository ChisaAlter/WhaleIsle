'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  readPin,
  writePin,
  assertFullSha,
  peelToCommit,
  readNpmVersion,
  assertRc5Witness,
  DEFAULT_REPO,
} = require('./harness-upstream');

const PREFIX = 'vendor/deepseek-harness';
const STATE_RELATIVE = 'dsh-harness-sync.json';
const BACKUP_REF = 'refs/backup/harness-pre-sync';
const WORKTREE_NAME = 'dsh-harness-sync-worktree';
const UPSTREAM_REMOTE = 'upstream-harness';

/**
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [options]
 */
function realGit(args, options = {}) {
  return spawnSync('git', args, {
    encoding: 'utf8',
    shell: false,
    cwd: options.cwd,
    env: options.env || process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * @param {string[]} argv
 */
function parseSyncArgs(argv) {
  /** @type {{ mode: 'sync'|'continue'|'abort', ref?: string, sha?: string, dryRun: boolean }} */
  const parsed = { mode: 'sync', dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--continue' || token === '--abort') {
      if (parsed.mode !== 'sync' || parsed.dryRun || parsed.ref || parsed.sha) {
        throw new Error('--continue and --abort are exclusive and take no --ref/--sha/--dry-run');
      }
      parsed.mode = token.slice(2);
      continue;
    }
    if (token === '--dry-run') {
      if (parsed.mode !== 'sync') {
        throw new Error('--dry-run cannot be combined with --continue or --abort');
      }
      parsed.dryRun = true;
      continue;
    }
    if (token === '--ref') {
      if (parsed.mode !== 'sync') {
        throw new Error('--ref cannot be combined with --continue or --abort');
      }
      parsed.ref = argv[i + 1];
      i += 1;
      if (!parsed.ref) {
        throw new Error('--ref requires a value');
      }
      continue;
    }
    if (token === '--sha') {
      if (parsed.mode !== 'sync') {
        throw new Error('--sha cannot be combined with --continue or --abort');
      }
      parsed.sha = assertFullSha(argv[i + 1]);
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  if (parsed.mode === 'sync' && (!parsed.ref || !parsed.sha)) {
    throw new Error('sync requires --ref and --sha');
  }
  return parsed;
}

/**
 * @param {(args: string[], options?: object) => { status: number, stdout: string, stderr: string }} git
 * @param {string[]} args
 * @param {object} [options]
 */
function gitOk(git, args, options, message) {
  const result = git(args, options);
  if (result.status !== 0) {
    throw new Error(message || `git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result;
}

function resolveGitDir(git, root) {
  const gitDir = gitOk(git, ['rev-parse', '--git-dir'], { cwd: root }).stdout.trim();
  return path.resolve(root, gitDir);
}

function assertClean(git, root) {
  const status = gitOk(git, ['status', '--porcelain'], { cwd: root }).stdout;
  if (status.trim() !== '') {
    throw new Error(`working tree is dirty; commit or stash before sync:\n${status}`);
  }
}

function bindGit(git, root) {
  return (args, options = {}) => git(args, { cwd: options.cwd || root, env: options.env, ...options });
}

function readState(gitDir, io) {
  const statePath = path.join(gitDir, STATE_RELATIVE);
  if (!io.existsSync(statePath)) {
    throw new Error(`no sync state at ${statePath}; nothing to continue or abort`);
  }
  return { statePath, state: JSON.parse(io.readFileSync(statePath, 'utf8')) };
}

function writeState(gitDir, state, io) {
  io.writeFileSync(path.join(gitDir, STATE_RELATIVE), `${JSON.stringify(state, null, 2)}\n`);
}

function removeWorktree(git, root, worktree) {
  const removed = git(['worktree', 'remove', '--force', worktree], { cwd: root });
  if (removed.status !== 0 && fs.existsSync(worktree)) {
    fs.rmSync(worktree, { recursive: true, force: true });
    git(['worktree', 'prune'], { cwd: root });
  }
}

function unmergedPaths(git, worktree) {
  const listed = git(['diff', '--name-only', '--diff-filter=U'], { cwd: worktree });
  return listed.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function fetchTarget(git, root, pin, ref, sha) {
  const remotes = gitOk(git, ['remote'], { cwd: root }).stdout.split(/\r?\n/).map((line) => line.trim());
  const source = remotes.includes(UPSTREAM_REMOTE) ? UPSTREAM_REMOTE : (pin.repo || DEFAULT_REPO);
  const fetched = git(['fetch', source, ref], { cwd: root });
  if (fetched.status !== 0) {
    throw new Error(`git fetch ${source} ${ref} failed: ${(fetched.stderr || fetched.stdout).trim()}`);
  }
  const bound = bindGit(git, root);
  let peeled;
  try {
    peeled = peelToCommit(bound, ref);
  } catch {
    peeled = peelToCommit(bound, 'FETCH_HEAD');
  }
  if (peeled !== sha) {
    throw new Error(`peeled ${ref} is ${peeled}, expected ${sha}`);
  }
  return peeled;
}

function buildCandidate(git, root, mergedTree) {
  const indexFile = path.join(os.tmpdir(), `dsh-harness-index-${process.pid}-${Date.now()}`);
  const env = { ...process.env, GIT_INDEX_FILE: indexFile };
  try {
    gitOk(git, ['read-tree', 'HEAD'], { cwd: root, env });
    gitOk(git, ['rm', '-r', '-q', '--cached', '--ignore-unmatch', PREFIX], { cwd: root, env });
    gitOk(git, ['read-tree', `--prefix=${PREFIX}/`, mergedTree], { cwd: root, env });
    return gitOk(git, ['write-tree'], { cwd: root, env }).stdout.trim();
  } finally {
    fs.rmSync(indexFile, { force: true });
  }
}

function assertPrefixOnly(git, root, candidate) {
  // -z emits raw NUL-separated paths: core.quotepath C-quotes non-ASCII names
  // (upstream ships e.g. snapshots/说明.txt) and the quoted form fails the
  // prefix check below.
  const names = gitOk(git, ['diff-tree', '-z', '--name-only', '-r', 'HEAD', candidate], { cwd: root })
    .stdout.split('\0').map((line) => line.trim()).filter(Boolean);
  const leaked = names.filter((name) => name !== PREFIX && !name.startsWith(`${PREFIX}/`));
  if (leaked.length > 0) {
    throw new Error(`candidate tree touches paths outside ${PREFIX}: ${leaked.join(', ')}`);
  }
  console.log(gitOk(git, ['-c', 'core.quotepath=false', 'diff-tree', '--name-status', '-r', 'HEAD', candidate], { cwd: root }).stdout);
  return names;
}

function printBaseNameStatus(git, root, pinSha) {
  const diff = git(['diff-tree', '--name-status', '-r', `${pinSha}^{tree}`, `HEAD:${PREFIX}`], { cwd: root });
  if (diff.stdout.trim()) {
    console.log(diff.stdout);
  }
}

function applyMergedTree(git, root, pin, ref, sha, mergedTree, io) {
  const candidate = buildCandidate(git, root, mergedTree);
  assertPrefixOnly(git, root, candidate);
  assertClean(git, root);
  // checkout <tree> -- <path> only overwrites paths the tree still has; drop
  // the prefix first so paths the merge deleted (upstream renames/reorgs)
  // leave the index and worktree instead of lingering as pre-merge content.
  gitOk(git, ['rm', '-r', '-q', '--ignore-unmatch', '--', PREFIX], { cwd: root });
  gitOk(git, ['checkout', candidate, '--', PREFIX], { cwd: root });
  const npm = readNpmVersion(bindGit(git, root), sha);
  const next = { repo: pin.repo, ref, sha, npm };
  writePin(root, next, io);
  return next;
}

function writeTree(git, worktree) {
  const leftover = unmergedPaths(git, worktree);
  if (leftover.length > 0) {
    throw new Error(`worktree still has unresolved conflicts: ${leftover.join(', ')}`);
  }
  return gitOk(git, ['write-tree'], { cwd: worktree }).stdout.trim();
}

function abortSync(git, root, io) {
  const gitDir = resolveGitDir(git, root);
  let worktree;
  try {
    const { state, statePath } = readState(gitDir, io);
    worktree = state.worktree;
    if (worktree) {
      removeWorktree(git, root, worktree);
    }
    io.rmSync(statePath, { force: true });
  } catch (error) {
    const leftover = path.join(gitDir, WORKTREE_NAME);
    if (io.existsSync(leftover)) {
      removeWorktree(git, root, leftover);
    }
    io.rmSync(path.join(gitDir, STATE_RELATIVE), { force: true });
    if (!String(error.message || error).includes('no sync state')) {
      throw error;
    }
  }
  git(['update-ref', '-d', BACKUP_REF], { cwd: root });
  return { status: 'aborted', worktree };
}

function continueSync(git, root, io) {
  const gitDir = resolveGitDir(git, root);
  const { state } = readState(gitDir, io);
  const mergedTree = writeTree(git, state.worktree);
  const next = applyMergedTree(git, root, state.pinBefore, state.targetRef, state.targetSha, mergedTree, io);
  return { status: 'applied', pin: next, worktree: state.worktree };
}

function startSync(git, root, args, io) {
  assertClean(git, root);
  const pin = readPin(root, io);
  const gitDir = resolveGitDir(git, root);
  gitOk(git, ['update-ref', BACKUP_REF, 'HEAD'], { cwd: root });
  const targetSha = fetchTarget(git, root, pin, args.ref, args.sha);
  assertRc5Witness(bindGit(git, root), pin);
  const oursTree = gitOk(git, ['rev-parse', `HEAD:${PREFIX}`], { cwd: root }).stdout.trim();
  const synthetic = gitOk(
    git,
    ['commit-tree', oursTree, '-p', pin.sha, '-m', 'dsh-harness-sync synthetic ours'],
    { cwd: root },
  ).stdout.trim();
  const worktree = path.join(gitDir, WORKTREE_NAME);
  if (io.existsSync(worktree)) {
    throw new Error(`sync worktree already exists at ${worktree}; run --abort first`);
  }
  gitOk(git, ['worktree', 'add', '--detach', worktree, synthetic], { cwd: root });
  const merge = git(['merge', '--no-commit', '--no-ff', targetSha], { cwd: worktree });
  const conflicts = unmergedPaths(git, worktree);
  printBaseNameStatus(git, root, pin.sha);
  if (merge.status !== 0 || conflicts.length > 0) {
    if (args.dryRun) {
      removeWorktree(git, root, worktree);
      git(['update-ref', '-d', BACKUP_REF], { cwd: root });
      console.log(`conflicts:\n${conflicts.join('\n')}`);
      return { status: 'dry-run', conflicts, worktree };
    }
    writeState(gitDir, {
      worktree,
      backupRef: BACKUP_REF,
      targetRef: args.ref,
      targetSha,
      syntheticOurs: synthetic,
      pinBefore: pin,
    }, io);
    console.log(`conflict in isolated worktree: ${worktree}`);
    console.log('resolve, git add, then: npm run sync:harness -- --continue');
    return { status: 'conflict', worktree, conflicts, pin };
  }
  const mergedTree = writeTree(git, worktree);
  if (args.dryRun) {
    const candidate = buildCandidate(git, root, mergedTree);
    assertPrefixOnly(git, root, candidate);
    removeWorktree(git, root, worktree);
    git(['update-ref', '-d', BACKUP_REF], { cwd: root });
    return { status: 'dry-run', worktree };
  }
  const next = applyMergedTree(git, root, pin, args.ref, targetSha, mergedTree, io);
  return { status: 'applied', pin: next, worktree };
}

/**
 * @param {{ root: string, args: { mode: string, ref?: string, sha?: string, dryRun?: boolean }, git?: Function, io?: typeof fs }} options
 */
function syncHarness(options) {
  const git = options.git || realGit;
  const io = options.io || fs;
  const { root, args } = options;
  if (args.mode === 'abort') {
    return abortSync(git, root, io);
  }
  if (args.mode === 'continue') {
    return continueSync(git, root, io);
  }
  if (args.mode !== 'sync') {
    throw new Error(`unknown sync mode: ${args.mode}`);
  }
  if (!args.ref || !args.sha) {
    throw new Error('sync requires --ref and --sha');
  }
  return startSync(git, root, { ...args, sha: assertFullSha(args.sha) }, io);
}

module.exports = {
  STATE_RELATIVE,
  BACKUP_REF,
  parseSyncArgs,
  syncHarness,
};
