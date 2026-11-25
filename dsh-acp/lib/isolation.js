/** Explicit task checkout creation. Never moves the parent's cwd or removes work. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { checkForbiddenDelegateRoot } from './delegate-cwd.js';

const run = promisify(execFile);
const WORKTREE_DIR = '.agent-worktrees';
const TASK_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

const identity = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);

function isStrictlyInside(root, target) {
  const rel = path.relative(identity(root), identity(target));
  return Boolean(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/** Ensure `<repo>/.agent-worktrees` is not a symbolic link or directory junction. */
function verifyWorktreesRoot(worktreesRoot, { mustExist = false } = {}) {
  let stat;
  try {
    stat = fs.lstatSync(worktreesRoot);
  } catch (error) {
    if (error?.code === 'ENOENT' && !mustExist) return null;
    return false;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) return false;
  try {
    const real = fs.realpathSync.native(worktreesRoot);
    return identity(real) === identity(worktreesRoot) ? real : false;
  } catch {
    return false;
  }
}

/** Keep retained task checkouts out of the parent's status and `git add -A`. */
function excludeWorktreeDir(commonDir) {
  const file = path.join(commonDir, 'info', 'exclude');
  const entry = `/${WORKTREE_DIR}/`;
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (current.split(/\r?\n/).some((line) => line.trim() === entry)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${current && !current.endsWith('\n') ? '\n' : ''}${entry}\n`);
}

export async function createTaskCheckout(cwd, taskId, signal) {
  if (typeof taskId !== 'string' || !TASK_ID_RE.test(taskId)) {
    throw new Error('Invalid taskId for isolated worktree checkout.');
  }
  const git = async (directory, args, env) => (await run('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], {
    cwd: directory, signal, windowsHide: true, encoding: 'utf8', env: env || process.env, maxBuffer: 1024 * 1024,
  })).stdout.trim();
  const rawRoot = await git(cwd, ['rev-parse', '--show-toplevel']);
  const root = fs.realpathSync.native(path.resolve(rawRoot));
  const forbidden = checkForbiddenDelegateRoot(root);
  if (forbidden) {
    throw new Error(`Refusing to create worktree in restricted repository root: ${forbidden}`);
  }
  const base = await git(root, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const worktreesRoot = path.join(root, WORKTREE_DIR);
  if (verifyWorktreesRoot(worktreesRoot, { mustExist: false }) === false) {
    throw new Error(`Refusing to use symlinked or non-directory worktrees root: ${worktreesRoot}`);
  }
  fs.mkdirSync(worktreesRoot, { recursive: true });
  const realWorktreesRoot = verifyWorktreesRoot(worktreesRoot, { mustExist: true });
  if (!realWorktreesRoot) {
    throw new Error(`Worktrees root failed containment verification: ${worktreesRoot}`);
  }
  const directory = path.join(realWorktreesRoot, taskId);
  if (!isStrictlyInside(realWorktreesRoot, directory)) {
    throw new Error(`Refusing to create worktree outside ${realWorktreesRoot}.`);
  }
  try {
    if (fs.lstatSync(directory).isSymbolicLink()) {
      throw new Error(`Refusing to overwrite symlinked worktree target: ${directory}`);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  excludeWorktreeDir(path.resolve(root, await git(root, ['rev-parse', '--git-common-dir'])));
  await git(root, ['worktree', 'add', '--detach', '--no-checkout', '--', directory, base]);
  // Match the host worktree plugin: native Git filters must not execute
  // repository-configured programs during task checkout preparation.
  const configured = await run('git', ['config', '--null', '--name-only', '--get-regexp', '^filter\\.'], { cwd: root, windowsHide: true, encoding: 'utf8', signal })
    .then((value) => value.stdout, (error) => { if (error.code === 1) return ''; throw error; });
  const filters = new Set(configured.split('\0').map((key) => key.slice(0, key.lastIndexOf('.'))).filter(Boolean));
  // Append after any GIT_CONFIG_* overrides already present in the environment.
  const inherited = Number.parseInt(process.env.GIT_CONFIG_COUNT || '0', 10);
  let index = Number.isInteger(inherited) && inherited > 0 ? inherited : 0;
  const env = { ...process.env, GIT_CONFIG_COUNT: String(index + filters.size * 4) };
  for (const filter of filters) for (const attribute of ['clean', 'smudge', 'process', 'required']) {
    env[`GIT_CONFIG_KEY_${index}`] = `${filter}.${attribute}`;
    env[`GIT_CONFIG_VALUE_${index++}`] = attribute === 'required' ? 'false' : '';
  }
  try { await git(directory, ['reset', '--hard', '--no-recurse-submodules', base], env); }
  catch (error) { throw new Error(`Could not prepare task checkout at ${directory}; it is retained for recovery. ${error.message}`); }
  return { cwd: directory, repositoryRoot: root, baseCommit: base };
}

/**
 * Remove an orphaned task worktree created during a failed pre-admission preparation.
 * Only operates on non-symlink directories strictly inside `<repositoryRoot>/.agent-worktrees/`.
 */
export async function removeTaskCheckout(repositoryRoot, directory) {
  if (!repositoryRoot || !directory) return false;
  let realRepo;
  try {
    realRepo = fs.realpathSync.native(path.resolve(repositoryRoot));
  } catch {
    return false;
  }
  const worktreesRoot = path.join(realRepo, WORKTREE_DIR);
  const realWorktreesRoot = verifyWorktreesRoot(worktreesRoot, { mustExist: true });
  if (!realWorktreesRoot) return false;

  const resolvedDir = path.resolve(directory);
  if (!isStrictlyInside(realWorktreesRoot, resolvedDir)) return false;

  let dirStat;
  try {
    dirStat = fs.lstatSync(resolvedDir);
  } catch {
    return false;
  }
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) return false;

  let realDir;
  try {
    realDir = fs.realpathSync.native(resolvedDir);
  } catch {
    return false;
  }
  if (!isStrictlyInside(realWorktreesRoot, realDir)) return false;

  try {
    await run('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', 'worktree', 'remove', '--force', '--', realDir], {
      cwd: realRepo, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024,
    });
    return true;
  } catch {
    try {
      // Re-verify right before recursive delete to shrink TOCTOU window.
      if (!verifyWorktreesRoot(worktreesRoot, { mustExist: true })) return false;
      const recheck = fs.lstatSync(realDir);
      if (recheck.isSymbolicLink() || !recheck.isDirectory()) return false;
      if (!isStrictlyInside(realWorktreesRoot, fs.realpathSync.native(realDir))) return false;
      fs.rmSync(realDir, { recursive: true, force: true });
      await run('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', 'worktree', 'prune'], {
        cwd: realRepo, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024,
      }).catch(() => { /* Best-effort metadata prune after forced worktree directory removal. */ });
      return !fs.existsSync(realDir);
    } catch {
      return false;
    }
  }
}
