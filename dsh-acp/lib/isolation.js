/** Explicit task checkout creation. Never moves the parent's cwd or removes work. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
const run = promisify(execFile);

export async function createTaskCheckout(cwd, taskId, signal) {
  const git = async (directory, args, env) => (await run('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], {
    cwd: directory, signal, windowsHide: true, encoding: 'utf8', env: env || process.env, maxBuffer: 1024 * 1024,
  })).stdout.trim();
  const root = await git(cwd, ['rev-parse', '--show-toplevel']);
  const base = await git(root, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const directory = path.join(root, '.agent-worktrees', taskId);
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  await git(root, ['worktree', 'add', '--detach', '--no-checkout', '--', directory, base]);
  // Match the host worktree plugin: native Git filters must not execute
  // repository-configured programs during task checkout preparation.
  const configured = await run('git', ['config', '--null', '--name-only', '--get-regexp', '^filter\.'], { cwd: root, windowsHide: true, encoding: 'utf8', signal })
    .then((value) => value.stdout, (error) => { if (error.code === 1) return ''; throw error; });
  const filters = new Set(configured.split('\0').map((key) => key.slice(0, key.lastIndexOf('.'))).filter(Boolean));
  const env = { ...process.env, GIT_CONFIG_COUNT: String(filters.size * 4) };
  let index = 0;
  for (const filter of filters) for (const attribute of ['clean', 'smudge', 'process', 'required']) {
    env[`GIT_CONFIG_KEY_${index}`] = `${filter}.${attribute}`;
    env[`GIT_CONFIG_VALUE_${index++}`] = attribute === 'required' ? 'false' : '';
  }
  try { await git(directory, ['reset', '--hard', '--no-recurse-submodules', base], env); }
  catch (error) { throw new Error(`Could not prepare task checkout at ${directory}; it is retained for recovery. ${error.message}`); }
  return { cwd: directory, repositoryRoot: root, baseCommit: base };
}
