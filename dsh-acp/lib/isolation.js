/** Explicit task checkout creation. Never moves the parent's cwd or removes work. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
const run = promisify(execFile);
const WORKTREE_DIR = '.agent-worktrees';

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
  const git = async (directory, args, env) => (await run('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], {
    cwd: directory, signal, windowsHide: true, encoding: 'utf8', env: env || process.env, maxBuffer: 1024 * 1024,
  })).stdout.trim();
  const root = await git(cwd, ['rev-parse', '--show-toplevel']);
  const base = await git(root, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const directory = path.join(root, WORKTREE_DIR, taskId);
  fs.mkdirSync(path.dirname(directory), { recursive: true });
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
 * Only operates on directories strictly inside `<repositoryRoot>/.agent-worktrees/`.
 */
export async function removeTaskCheckout(repositoryRoot, directory) {
  if (!repositoryRoot || !directory) return false;
  const worktreesRoot = path.resolve(repositoryRoot, WORKTREE_DIR);
  const resolvedDir = path.resolve(directory);
  const rel = path.relative(worktreesRoot, resolvedDir);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return false;
  try {
    await run('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', 'worktree', 'remove', '--force', '--', resolvedDir], {
      cwd: repositoryRoot, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024,
    });
    return true;
  } catch {
    try {
      fs.rmSync(resolvedDir, { recursive: true, force: true });
      await run('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', 'worktree', 'prune'], {
        cwd: repositoryRoot, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024,
      }).catch(() => { /* Best-effort metadata prune after forced worktree directory removal. */ });
      return !fs.existsSync(resolvedDir);
    } catch {
      return false;
    }
  }
}
