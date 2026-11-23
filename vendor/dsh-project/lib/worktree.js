/**
 * Opt-in per-task Git worktree isolation, diff inspection, safe merge, and cleanup.
 *
 * Worktrees are created under `$DSH_HOME/project-worktrees/<projectId>/<taskId>`
 * on branch `project/<taskId>`, outside the user's repository so they never
 * pollute `git status` or require `.gitignore` modifications.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { withinPath } from '../../dsh-shared/lib/path-guard.mjs';
import { PROJECT_ID_RE, TASK_ID_RE, httpError, messageOf } from './schema.js';
import { isDirectory, pathExists } from './store.js';

const execFileAsync = promisify(execFile);

export const WORKTREE_BRANCH_PREFIX = 'project/';
const GIT_TIMEOUT_MS = 120_000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;
const MAX_DIFF_BYTES = 512 * 1024;

const GIT_UNSET_KEYS = [
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT',
  'GIT_CEILING_DIRECTORIES', 'GIT_PREFIX', 'GIT_SHALLOW_FILE', 'GIT_GRAFT_FILE',
  'GIT_REPLACE_REF_BASE', 'GIT_ATTR_SOURCE',
];

function gitEnv(extra = {}) {
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_LFS_SKIP_SMUDGE: '1',
    GIT_NO_LAZY_FETCH: '1',
  };
  for (const key of GIT_UNSET_KEYS) delete env[key];
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

function normalizeGitFailure(error, trim) {
  const out = typeof error?.stdout === 'string' ? error.stdout : '';
  const err = typeof error?.stderr === 'string' ? error.stderr : '';
  return {
    ok: false,
    code: typeof error?.code === 'number' ? error.code : null,
    stdout: trim ? out.trim() : out,
    stderr: trim ? err.trim() : err,
    error,
  };
}

export async function runGit(cwd, args, { allowFailure = false, env = {}, trim = true } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      env: gitEnv(env),
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      windowsHide: true,
    });
    const out = String(stdout ?? '');
    const err = String(stderr ?? '');
    return { ok: true, code: 0, stdout: trim ? out.trim() : out, stderr: trim ? err.trim() : err };
  } catch (error) {
    const result = normalizeGitFailure(error, trim);
    if (allowFailure) return result;
    const codeLabel = result.code === null ? '' : ` (exit ${result.code})`;
    throw new Error(`git ${args.join(' ')} failed${codeLabel}: ${result.stderr || result.stdout || messageOf(error)}`);
  }
}

export async function gitRepositoryRoot(directory) {
  const result = await runGit(directory, ['rev-parse', '--show-toplevel'], { allowFailure: true });
  if (result.ok) return result.stdout;
  if (result.code === 128 && /not a git repository/i.test(result.stderr)) return null;
  throw new Error(
    `Could not read the git repository at ${directory}: ${result.stderr || result.stdout || (result.code === null ? 'git is not available' : `exit ${result.code}`)}`,
  );
}

export async function gitMainRepositoryRoot(directory) {
  const result = await runGit(directory, ['worktree', 'list', '--porcelain'], { allowFailure: true });
  if (!result.ok) return null;
  const first = result.stdout.split(/\r?\n/).find((line) => line.startsWith('worktree '));
  return first ? first.slice('worktree '.length).trim() : null;
}

function parseDiffFiles(numstatOut, nameStatusOut) {
  const statuses = new Map();
  for (const line of String(nameStatusOut || '').split(/\r?\n/).filter(Boolean)) {
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const status = line.slice(0, tab).trim().slice(0, 1) || 'M';
    const filePath = line.slice(tab + 1).trim();
    if (filePath) statuses.set(filePath, status);
  }
  const files = [];
  for (const line of String(numstatOut || '').split(/\r?\n/).filter(Boolean)) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const added = parts[0];
    const deleted = parts[1];
    const filePath = parts.slice(2).join('\t').trim();
    if (!filePath) continue;
    const binary = added === '-' || deleted === '-';
    files.push({
      path: filePath,
      status: statuses.get(filePath) || 'M',
      additions: binary ? 0 : Number(added) || 0,
      deletions: binary ? 0 : Number(deleted) || 0,
      ...(binary ? { binary: true } : {}),
    });
  }
  return files;
}

async function computeGitDiff(repoDir, baseRef) {
  const gitIndexRes = await runGit(repoDir, ['rev-parse', '--git-path', 'index'], { allowFailure: true });
  if (!gitIndexRes.ok) {
    throw new Error(`Could not locate git index in ${repoDir}: ${gitIndexRes.stderr}`);
  }
  const realIndexPath = resolve(repoDir, gitIndexRes.stdout);
  const tempIndex = join(tmpdir(), `whale-proj-idx-${randomUUID()}`);
  try {
    if (await pathExists(realIndexPath)) {
      await copyFile(realIndexPath, tempIndex);
    }
    const env = { GIT_INDEX_FILE: tempIndex };
    await runGit(repoDir, ['add', '-A'], { env });
    const [numstat, nameStatus, rawDiff] = await Promise.all([
      runGit(repoDir, ['-c', 'core.quotepath=off', 'diff', '--cached', '--no-renames', '--numstat', baseRef], { env }),
      runGit(repoDir, ['-c', 'core.quotepath=off', 'diff', '--cached', '--no-renames', '--name-status', baseRef], { env }),
      runGit(repoDir, ['-c', 'core.quotepath=off', 'diff', '--cached', '--no-renames', baseRef], { env, trim: false }),
    ]);
    const files = parseDiffFiles(numstat.stdout, nameStatus.stdout);
    const fullDiff = rawDiff.stdout;
    const truncated = Buffer.byteLength(fullDiff, 'utf8') > MAX_DIFF_BYTES;
    const diff = truncated ? fullDiff.slice(0, MAX_DIFF_BYTES) : fullDiff;
    return { files, diff, truncated };
  } finally {
    await rm(tempIndex, { force: true }).catch(() => { /* Temporary git index may already be absent. */ });
  }
}

export function createWorktreeManager(store) {
  function worktreePlan(project, task) {
    const projectId = typeof project?.id === 'string' ? project.id : '';
    const taskId = typeof task?.id === 'string' ? task.id : '';
    if (!PROJECT_ID_RE.test(projectId)) {
      throw new Error(`Project id ${JSON.stringify(projectId)} cannot be used as a worktree directory.`);
    }
    if (!TASK_ID_RE.test(taskId)) {
      throw new Error(`Task id ${JSON.stringify(taskId)} cannot be used as a worktree name.`);
    }
    const poolRoot = resolve(store.worktreesRootDir());
    const projectPool = resolve(poolRoot, projectId);
    const targetPath = resolve(projectPool, taskId);
    if (!withinPath(poolRoot, targetPath) || dirname(targetPath) !== projectPool || basename(targetPath) !== taskId) {
      throw new Error(`Worktree path for ${projectId}/${taskId} escapes ${poolRoot}.`);
    }
    return {
      projectId,
      taskId,
      poolRoot,
      projectPool,
      path: targetPath,
      branch: `${WORKTREE_BRANCH_PREFIX}${taskId}`,
    };
  }

  function isManagedWorktreePath(project, task, candidatePath) {
    if (!candidatePath) return false;
    try {
      const plan = worktreePlan(project, task);
      return resolve(candidatePath) === plan.path && withinPath(plan.poolRoot, candidatePath);
    } catch {
      return false;
    }
  }

  async function cleanupFailedWorktree(repoRoot, plan, branchExistedBefore) {
    try {
      await runGit(repoRoot, ['worktree', 'remove', '--force', '--', plan.path], { allowFailure: true });
      await runGit(repoRoot, ['worktree', 'prune'], { allowFailure: true });
      if (!branchExistedBefore) {
        const ref = await runGit(repoRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${plan.branch}`], { allowFailure: true });
        if (ref.ok) await runGit(repoRoot, ['branch', '-D', '--', plan.branch], { allowFailure: true });
      }
      if (await pathExists(plan.path)) {
        await rm(plan.path, { recursive: true, force: true });
      }
    } catch {
      // Preserve original error.
    }
  }

  async function createTaskWorktree(project, task) {
    const workspace = typeof project?.workspace === 'string' ? project.workspace.trim() : '';
    if (!workspace) {
      return {
        degraded: 'workspace_missing',
        note: 'Worktree isolation is on, but the project has no workspace; the worker ran in the coordinator directory.',
      };
    }
    if (!(await isDirectory(workspace))) {
      return {
        degraded: 'workspace_missing',
        note: `Worktree isolation is on, but workspace ${workspace} is not a directory; the worker ran in the shared workspace.`,
      };
    }
    const repoRoot = await gitRepositoryRoot(workspace);
    if (!repoRoot) {
      return {
        degraded: 'not_a_git_repository',
        note: `Worktree isolation is on, but ${workspace} is not inside a git repository; the worker ran in the shared workspace.`,
      };
    }
    const headRev = await runGit(repoRoot, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
    if (!headRev.ok || !headRev.stdout) {
      return {
        degraded: 'no_commits',
        note: `Worktree isolation is on, but the git repository at ${repoRoot} has no commits yet; the worker ran in the shared workspace.`,
      };
    }
    const baseCommit = headRev.stdout;
    const plan = worktreePlan(project, task);
    const refCheck = await runGit(repoRoot, ['check-ref-format', `refs/heads/${plan.branch}`], { allowFailure: true });
    if (!refCheck.ok) {
      throw new Error(`"${plan.branch}" is not a valid git branch name for task ${task.id}.`);
    }

    const existsOnDisk = await pathExists(plan.path);
    const branchExists = (
      await runGit(repoRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${plan.branch}`], { allowFailure: true })
    ).ok;

    if (existsOnDisk) {
      const head = await runGit(plan.path, ['rev-parse', '--abbrev-ref', 'HEAD'], { allowFailure: true });
      if (!head.ok || head.stdout !== plan.branch) {
        throw new Error(
          `Worktree path ${plan.path} already exists and is not a checkout of ${plan.branch}. Clean it up before dispatching task ${task.id}.`,
        );
      }
      return {
        path: plan.path,
        branch: plan.branch,
        repoRoot,
        baseCommit: task.baseCommit || baseCommit,
        reused: true,
      };
    }

    await mkdir(plan.projectPool, { recursive: true });
    try {
      if (branchExists) {
        await runGit(repoRoot, [
          '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'submodule.recurse=false',
          'worktree', 'add', '--', plan.path, plan.branch,
        ]);
      } else {
        await runGit(repoRoot, [
          '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'submodule.recurse=false',
          'worktree', 'add', '-b', plan.branch, '--', plan.path, 'HEAD',
        ]);
      }
      const head = await runGit(plan.path, ['rev-parse', '--abbrev-ref', 'HEAD'], { allowFailure: true });
      if (!head.ok || head.stdout !== plan.branch) {
        throw new Error(`the new checkout is not on ${plan.branch} (git reported ${head.stdout || head.stderr || 'no branch'})`);
      }
    } catch (error) {
      await cleanupFailedWorktree(repoRoot, plan, branchExists);
      throw new Error(`Could not create git worktree for task ${task.id}: ${messageOf(error)}`);
    }

    return { path: plan.path, branch: plan.branch, repoRoot, baseCommit, reused: false };
  }

  async function resolveWorktreeBaseRef(wtPath, baseCommit) {
    if (baseCommit) {
      const valid = await runGit(wtPath, ['rev-parse', '--verify', `${baseCommit}^{commit}`], { allowFailure: true });
      if (valid.ok) return valid.stdout;
    }
    const mainRoot = await gitMainRepositoryRoot(wtPath);
    if (mainRoot && (await isDirectory(mainRoot))) {
      const mainHead = await runGit(mainRoot, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
      if (mainHead.ok && mainHead.stdout) {
        const mb = await runGit(wtPath, ['merge-base', mainHead.stdout, 'HEAD'], { allowFailure: true });
        if (mb.ok && mb.stdout) return mb.stdout;
      }
    }
    const head = await runGit(wtPath, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
    return head.ok ? head.stdout : 'HEAD';
  }

  async function diffSharedWorkspace(workspace) {
    if (!workspace || !(await isDirectory(workspace))) return null;
    const repoRoot = await gitRepositoryRoot(workspace).catch(() => null);
    if (!repoRoot) return null;
    const head = await runGit(repoRoot, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
    if (!head.ok || !head.stdout) return null;
    const curBranchRes = await runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'], { allowFailure: true });
    const { files, diff, truncated } = await computeGitDiff(repoRoot, head.stdout);
    return {
      available: true,
      branch: curBranchRes.ok ? curBranchRes.stdout : '',
      worktreePath: '',
      baseRef: head.stdout,
      files,
      diff,
      truncated,
      note: 'Task has no isolated worktree; showing uncommitted changes in the shared workspace.',
    };
  }

  async function getTaskDiff(project, task) {
    const wtPath = typeof task?.worktreePath === 'string' ? task.worktreePath.trim() : '';
    const branch = typeof task?.branch === 'string' ? task.branch.trim() : '';

    if (wtPath && (await isDirectory(wtPath))) {
      const wtRepo = await gitRepositoryRoot(wtPath).catch(() => null);
      if (wtRepo) {
        const baseRef = await resolveWorktreeBaseRef(wtPath, task.baseCommit);
        const { files, diff, truncated } = await computeGitDiff(wtPath, baseRef);
        return { available: true, branch, worktreePath: wtPath, baseRef, files, diff, truncated, note: '' };
      }
    }

    const shared = await diffSharedWorkspace(typeof project?.workspace === 'string' ? project.workspace.trim() : '');
    if (shared) return shared;

    return {
      available: false,
      branch,
      worktreePath: wtPath,
      baseRef: '',
      files: [],
      diff: '',
      truncated: false,
      note: 'No git repository or worktree is available for this task.',
    };
  }

  async function assertCleanForMerge(mainRoot, wtPath, taskId, branch) {
    if (wtPath && (await isDirectory(wtPath))) {
      const wtStatus = await runGit(wtPath, ['status', '--porcelain'], { allowFailure: true });
      if (wtStatus.ok && wtStatus.stdout.length > 0) {
        throw httpError(
          409,
          `Worktree for task ${taskId} has uncommitted changes. Commit or discard them before merging ${branch}.`,
          { dirtyWorktree: true },
        );
      }
    }
    const mainStatus = await runGit(mainRoot, ['status', '--porcelain'], { allowFailure: true });
    if (mainStatus.ok && mainStatus.stdout.length > 0) {
      throw httpError(
        409,
        'Main workspace has uncommitted changes. Commit or stash them before merging this task branch.',
        { dirtyWorkspace: true },
      );
    }
  }

  async function mergeTaskWorktree(project, task) {
    const branch = typeof task?.branch === 'string' ? task.branch.trim() : '';
    const wtPath = typeof task?.worktreePath === 'string' ? task.worktreePath.trim() : '';
    if (!branch) throw httpError(400, 'This task has no isolated worktree branch to merge.');
    const workspace = typeof project?.workspace === 'string' ? project.workspace.trim() : '';
    if (!workspace || !(await isDirectory(workspace))) {
      throw httpError(400, 'Project workspace is missing; cannot merge worktree branch.');
    }
    const mainRoot = await gitMainRepositoryRoot(workspace);
    if (!mainRoot) throw httpError(400, 'Project workspace is not a git repository.');
    const branchRef = await runGit(mainRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { allowFailure: true });
    if (!branchRef.ok) throw httpError(404, `Branch "${branch}" no longer exists in the repository.`);

    await assertCleanForMerge(mainRoot, wtPath, task.id, branch);

    const targetBranchRes = await runGit(mainRoot, ['rev-parse', '--abbrev-ref', 'HEAD'], { allowFailure: true });
    const targetBranch = targetBranchRes.ok ? targetBranchRes.stdout : 'HEAD';
    const already = await runGit(mainRoot, ['merge-base', '--is-ancestor', branch, 'HEAD'], { allowFailure: true });
    if (already.ok) {
      const head = await runGit(mainRoot, ['rev-parse', 'HEAD']);
      return { merged: true, alreadyMerged: true, branch, targetBranch, commit: head.stdout };
    }

    const mergeRes = await runGit(
      mainRoot,
      ['-c', 'core.hooksPath=/dev/null', 'merge', '--no-edit', '--', branch],
      { allowFailure: true },
    );
    if (!mergeRes.ok) {
      await runGit(mainRoot, ['merge', '--abort'], { allowFailure: true });
      throw httpError(
        409,
        `Merging "${branch}" into "${targetBranch}" hit conflicts and was aborted cleanly: ${mergeRes.stderr || mergeRes.stdout}`,
        { conflict: true },
      );
    }

    const newHead = await runGit(mainRoot, ['rev-parse', 'HEAD']);
    return { merged: true, alreadyMerged: false, branch, targetBranch, commit: newHead.stdout };
  }

  async function removeWorktreeCheckout(repoRoot, project, task, wtPath) {
    if (!wtPath || !(await pathExists(wtPath))) return false;
    const result = await runGit(repoRoot, ['worktree', 'remove', '--force', '--', wtPath], { allowFailure: true });
    if (!result.ok) {
      if (!isManagedWorktreePath(project, task, wtPath)) {
        throw new Error(`Could not remove worktree ${wtPath}: ${result.stderr || result.stdout || `exit ${result.code}`}`);
      }
      await rm(wtPath, { recursive: true, force: true });
    }
    return true;
  }

  async function deleteBranchIfPresent(repoRoot, branch) {
    if (!branch) return false;
    const exists = await runGit(repoRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { allowFailure: true });
    if (!exists.ok) return false;
    const deleted = await runGit(repoRoot, ['branch', '-D', '--', branch], { allowFailure: true });
    if (!deleted.ok) {
      throw new Error(`Could not delete branch ${branch}: ${deleted.stderr || deleted.stdout || `exit ${deleted.code}`}`);
    }
    return true;
  }

  async function cleanupTaskWorktree(project, task) {
    const wtPath = typeof task?.worktreePath === 'string' ? task.worktreePath.trim() : '';
    const branch = typeof task?.branch === 'string' ? task.branch.trim() : '';
    if (!wtPath && !branch) return null;

    const start = wtPath && (await isDirectory(wtPath)) ? wtPath : project?.workspace;
    const repoRoot = start && (await isDirectory(start)) ? await gitMainRepositoryRoot(start) : null;
    if (!repoRoot) {
      if (wtPath && (await pathExists(wtPath))) {
        if (isManagedWorktreePath(project, task, wtPath)) {
          await rm(wtPath, { recursive: true, force: true });
          return { removed: true, branchDeleted: false, note: 'removed orphaned managed worktree directory' };
        }
        throw new Error(`Could not find the git repository for worktree ${wtPath}; remove it manually.`);
      }
      return { removed: false, branchDeleted: false, note: 'worktree and repository are already gone' };
    }

    const removed = await removeWorktreeCheckout(repoRoot, project, task, wtPath);
    await runGit(repoRoot, ['worktree', 'prune'], { allowFailure: true });
    const branchDeleted = await deleteBranchIfPresent(repoRoot, branch);
    return { removed, branchDeleted };
  }

  async function removeProjectWorktrees(project) {
    const removed = [];
    const failed = [];
    for (const task of project.tasks || []) {
      if (!task.worktreePath && !task.branch) continue;
      try {
        const result = await cleanupTaskWorktree(project, task);
        removed.push({ taskId: task.id, ...(result || {}) });
        delete task.worktreePath;
        delete task.branch;
        delete task.baseCommit;
        delete task.worktreeDegraded;
        delete task.worktreeNote;
      } catch (error) {
        failed.push({ taskId: task.id, error: messageOf(error) });
        task.worktreeNote = `Worktree cleanup failed while archiving: ${messageOf(error)}`;
      }
    }
    return { removed, failed };
  }

  return {
    worktreePlan,
    createTaskWorktree,
    getTaskDiff,
    mergeTaskWorktree,
    cleanupTaskWorktree,
    removeProjectWorktrees,
  };
}
