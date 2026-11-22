/**
 * Isolated Git worktree provisioning and settlement for delegated subagents.
 * Creates an exclusive branch and linked worktree from `HEAD`, verifies
 * uncommitted work and commits at settlement, and cleans unchanged worktrees
 * while retaining dirty or committed branches.
 *
 * @module @deepseek-ai/dsh-subagent/worktree
 */

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { SubagentError } from './error.ts'
import type { SubagentWorktreeOutcome, SubagentWorktreeSpec } from './types.ts'

const execFileAsync = promisify(execFile)

const GIT_TIMEOUT_MS = 30_000
const GIT_MAX_BUFFER_BYTES = 4 * 1024 * 1024

/** Options for creating an isolated subagent Git worktree. */
export interface CreateSubagentWorktreeOptions {
  /** Optional hint (e.g. requested subagent name) included in the branch and folder name. */
  readonly nameHint?: string
  /** Optional pool directory overriding `<repoRoot>/.agents/worktrees`. */
  readonly poolDir?: string
  /** Cancellation signal bound to pre-publication setup. */
  readonly signal?: AbortSignal
}

/** Check whether an error represents cancellation from the supplied signal or abort. */
function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'AbortControllerError')
}

/** Extract concise stderr/stdout/message text from a failed Git process invocation. */
function gitFailureDetail(error: unknown): string {
  if (error !== null && typeof error === 'object') {
    const record = error as { stderr?: unknown; stdout?: unknown; message?: unknown }
    if (typeof record.stderr === 'string' && record.stderr.trim().length > 0) {
      return record.stderr.trim()
    }
    if (typeof record.stdout === 'string' && record.stdout.trim().length > 0) {
      return record.stdout.trim()
    }
    if (typeof record.message === 'string' && record.message.trim().length > 0) {
      return record.message.trim()
    }
  }
  return String(error)
}

/** Execute a Git command with fsmonitor disabled and terminal prompts suppressed. */
async function runGit(
  args: readonly string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
  signal?.throwIfAborted()
  const { stdout, stderr } = await execFileAsync(
    'git',
    ['-c', 'core.fsmonitor=false', ...args],
    {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER_BYTES,
      ...(signal === undefined ? {} : { signal }),
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
      },
    },
  )
  return { stdout, stderr }
}

/** Build a safe, unique branch/directory identifier for one isolated worktree. */
function createBranchName(nameHint?: string): string {
  const sanitized = (nameHint ?? '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '')
    .slice(0, 24)
  const suffix = randomUUID().slice(0, 8)
  return sanitized.length > 0 ? `subagent-${sanitized}-${suffix}` : `subagent-${suffix}`
}

/** Ensure the worktree pool root exists and ignores nested worktree checkouts. */
function ensurePoolDirectory(poolDir: string): void {
  mkdirSync(poolDir, { recursive: true })
  const ignorePath = join(poolDir, '.gitignore')
  try {
    writeFileSync(ignorePath, '*\n', { encoding: 'utf8', flag: 'wx' })
  } catch (error: unknown) {
    // Only ignore EEXIST when another worktree already wrote .gitignore.
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      return
    }
    throw error
  }
}

/**
 * Resolve the worktree pool directory anchored at the current repository /
 * checkout root, reusing the enclosing `.agents/worktrees` pool only when
 * delegated from inside an existing `.agents/worktrees/<name>` checkout.
 */
function defaultPoolDir(repoRoot: string): string {
  const parent = dirname(repoRoot)
  if (basename(parent) === 'worktrees' && basename(dirname(parent)) === '.agents') {
    return parent
  }
  return join(repoRoot, '.agents', 'worktrees')
}

/**
 * Create an isolated Git worktree and exclusive branch from `HEAD`.
 * Fails loudly when `baseCwd` is not inside a Git repository or lacks a committed `HEAD`.
 * @param baseCwd - resolved working directory from which isolation is requested.
 * @param options - naming, pool override, and cancellation inputs.
 * @returns specification of the provisioned worktree and branch.
 */
export async function createIsolatedSubagentWorktree(
  baseCwd: string,
  options: CreateSubagentWorktreeOptions = {},
): Promise<SubagentWorktreeSpec> {
  const { signal } = options
  signal?.throwIfAborted()

  let cwdStats
  try {
    cwdStats = statSync(baseCwd)
  } catch (error: unknown) {
    throw new SubagentError(
      `isolation "worktree" requires an existing directory (cwd: "${baseCwd}")`,
      'WORKTREE_UNAVAILABLE',
      { cause: error },
    )
  }
  if (!cwdStats.isDirectory()) {
    throw new SubagentError(
      `isolation "worktree" requires a directory path (cwd: "${baseCwd}")`,
      'WORKTREE_UNAVAILABLE',
    )
  }

  let topLevel: string
  let commonDirRaw: string
  try {
    topLevel = (await runGit(['rev-parse', '--show-toplevel'], baseCwd, signal)).stdout.trim()
    commonDirRaw = (await runGit(['rev-parse', '--git-common-dir'], baseCwd, signal)).stdout.trim()
  } catch (error: unknown) {
    if (isAbortError(error, signal)) throw error
    throw new SubagentError(
      `isolation "worktree" requires a Git repository (cwd: "${baseCwd}"): ${gitFailureDetail(error)}`,
      'WORKTREE_NOT_GIT_REPO',
      { cause: error },
    )
  }

  const realBaseCwd = realpathSync(baseCwd)
  const repoRoot = realpathSync(topLevel)
  const gitCommonDir = realpathSync(resolve(realBaseCwd, commonDirRaw))

  let baseCommit: string
  try {
    baseCommit = (await runGit(['rev-parse', '--verify', 'HEAD^{commit}'], realBaseCwd, signal)).stdout.trim()
  } catch (error: unknown) {
    if (isAbortError(error, signal)) throw error
    throw new SubagentError(
      `isolation "worktree" requires a Git repository with at least one commit at HEAD (cwd: "${baseCwd}"): ${gitFailureDetail(error)}`,
      'WORKTREE_UNBORN_HEAD',
      { cause: error },
    )
  }

  const poolDir = options.poolDir ?? defaultPoolDir(repoRoot)
  ensurePoolDirectory(poolDir)

  const branch = createBranchName(options.nameHint)
  const rawWorktreePath = join(poolDir, branch)

  try {
    await runGit(['worktree', 'add', '-b', branch, rawWorktreePath, baseCommit], realBaseCwd, signal)
  } catch (error: unknown) {
    // Clean any partially created checkout before surfacing cancellation or Git failure.
    await cleanupWorktreeAndBranch({
      path: rawWorktreePath,
      branch,
      baseCommit,
      repoRoot,
      gitCommonDir,
    }).catch(() => undefined)
    if (isAbortError(error, signal)) throw error
    throw new SubagentError(
      `failed to create isolated Git worktree "${rawWorktreePath}": ${gitFailureDetail(error)}`,
      'WORKTREE_CREATE_FAILED',
      { cause: error },
    )
  }

  const worktreePath = realpathSync(rawWorktreePath)
  const relSubdir = relative(repoRoot, realBaseCwd)
  const candidateChildCwd = relSubdir.length > 0 && !relSubdir.startsWith('..') && !isAbsolute(relSubdir)
    ? join(worktreePath, relSubdir)
    : worktreePath
  const childCwd = existsSync(candidateChildCwd) ? candidateChildCwd : worktreePath

  const spec: SubagentWorktreeSpec = {
    path: worktreePath,
    branch,
    baseCommit,
    repoRoot,
    gitCommonDir,
    ...childCwd === worktreePath ? {} : { childCwd },
  }

  if (signal?.aborted) {
    await rollbackIsolatedSubagentWorktree(spec)
    signal.throwIfAborted()
  }

  return spec
}

/** Read current commit for `refs/heads/<branch>` if the branch ref still exists. */
async function resolveBranchCommit(gitCommonDir: string, branch: string): Promise<string | undefined> {
  try {
    const { stdout } = await runGit(
      ['--git-dir', gitCommonDir, 'rev-parse', '--verify', `refs/heads/${branch}^{commit}`],
      dirname(gitCommonDir),
    )
    return stdout.trim()
  } catch (_error: unknown) {
    // Missing or deleted branch returns undefined so cleanup treats it as absent.
    return undefined
  }
}

/** Remove an unchanged worktree checkout and its temporary branch atomically where possible. */
async function cleanupWorktreeAndBranch(spec: SubagentWorktreeSpec): Promise<void> {
  const gitParent = dirname(spec.gitCommonDir)
  if (existsSync(spec.path)) {
    await runGit(['--git-dir', spec.gitCommonDir, 'worktree', 'remove', spec.path], gitParent)
    // Remove leftover empty directory only if git worktree remove left an empty shell.
    if (existsSync(spec.path)) {
      rmSync(spec.path, { recursive: true, force: true })
    }
  } else {
    await runGit(['--git-dir', spec.gitCommonDir, 'worktree', 'prune', '--expire', 'now'], gitParent)
  }

  const branchCommit = await resolveBranchCommit(spec.gitCommonDir, spec.branch)
  if (branchCommit === spec.baseCommit) {
    await runGit(['--git-dir', spec.gitCommonDir, 'branch', '-D', spec.branch], gitParent)
  }
}

/**
 * Best-effort idempotent rollback for a worktree whose subagent failed before publication.
 * Removes the untouched worktree and its branch if still at `baseCommit`.
 * @param spec - worktree specification returned by {@link createIsolatedSubagentWorktree}.
 */
export async function rollbackIsolatedSubagentWorktree(spec: SubagentWorktreeSpec): Promise<void> {
  try {
    await cleanupWorktreeAndBranch(spec)
  } catch (_error: unknown) {
    // Rollback must remain idempotent and never mask the startup failure that triggered it.
  }
}

/**
 * Inspect an isolated subagent worktree after child execution finishes and either
 * reclaim an untouched worktree/branch or retain dirty / committed work.
 * @param spec - worktree specification bound to the settled subagent activation.
 * @returns settlement disposition reporting cleanup or retention details.
 */
export async function finalizeIsolatedSubagentWorktree(
  spec: SubagentWorktreeSpec,
): Promise<SubagentWorktreeOutcome> {
  const gitParent = dirname(spec.gitCommonDir)

  if (!existsSync(spec.path)) {
    const branchCommit = await resolveBranchCommit(spec.gitCommonDir, spec.branch)
    if (branchCommit !== undefined && branchCommit !== spec.baseCommit) {
      return {
        worktreePath: spec.path,
        branch: spec.branch,
        status: 'retained',
        reason: 'new-commits',
      }
    }
    try {
      await cleanupWorktreeAndBranch(spec)
      return {
        worktreePath: spec.path,
        branch: spec.branch,
        status: 'cleaned',
      }
    } catch (error: unknown) {
      return {
        worktreePath: spec.path,
        branch: spec.branch,
        status: 'retained',
        reason: 'cleanup-failed',
        detail: gitFailureDetail(error),
      }
    }
  }

  try {
    const { stdout: statusOut } = await runGit(
      ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none'],
      spec.path,
    )
    if (statusOut.length > 0) {
      return {
        worktreePath: spec.path,
        branch: spec.branch,
        status: 'retained',
        reason: 'uncommitted-changes',
      }
    }

    const headCommit = (await runGit(['rev-parse', '--verify', 'HEAD^{commit}'], spec.path)).stdout.trim()
    const branchCommit = await resolveBranchCommit(spec.gitCommonDir, spec.branch)
    if (headCommit !== spec.baseCommit || (branchCommit !== undefined && branchCommit !== spec.baseCommit)) {
      return {
        worktreePath: spec.path,
        branch: spec.branch,
        status: 'retained',
        reason: 'new-commits',
      }
    }

    // Also inspect switched-branch checkouts where branchCommit equals baseCommit but HEAD moved or detached oddly.
    let headRef: string | undefined
    try {
      headRef = (await runGit(['symbolic-ref', '--quiet', 'HEAD'], spec.path)).stdout.trim()
    } catch (_error: unknown) {
      // Detached HEAD is still allowed to clean up when clean and pointing at baseCommit.
      headRef = undefined
    }
    if (headRef !== undefined && headRef !== `refs/heads/${spec.branch}`) {
      const checkedOutCommit = (await runGit(['--git-dir', spec.gitCommonDir, 'rev-parse', '--verify', `${headRef}^{commit}`], gitParent)).stdout.trim()
      if (checkedOutCommit !== spec.baseCommit) {
        return {
          worktreePath: spec.path,
          branch: spec.branch,
          status: 'retained',
          reason: 'new-commits',
        }
      }
    }

    await cleanupWorktreeAndBranch(spec)
    return {
      worktreePath: spec.path,
      branch: spec.branch,
      status: 'cleaned',
    }
  } catch (error: unknown) {
    return {
      worktreePath: spec.path,
      branch: spec.branch,
      status: 'retained',
      reason: 'cleanup-failed',
      detail: gitFailureDetail(error),
    }
  }
}

/**
 * Format a concise human- and model-readable notice describing what became of
 * an isolated subagent worktree after teardown.
 */
export function formatWorktreeOutcomeNotice(outcome: SubagentWorktreeOutcome): string {
  if (outcome.status === 'cleaned') {
    return `Isolated worktree at "${outcome.worktreePath}" (branch "${outcome.branch}") had no uncommitted changes or new commits and was cleaned up.`
  }
  switch (outcome.reason) {
    case 'uncommitted-changes':
      return `Isolated worktree retained with uncommitted changes at "${outcome.worktreePath}" on branch "${outcome.branch}".`
    case 'new-commits':
      return `Isolated worktree retained with new commits at "${outcome.worktreePath}" on branch "${outcome.branch}".`
    case 'cleanup-failed':
      return `Isolated worktree retained at "${outcome.worktreePath}" on branch "${outcome.branch}" because cleanup failed${outcome.detail ? `: ${outcome.detail}` : '.'}`
    default:
      return `Isolated worktree retained at "${outcome.worktreePath}" on branch "${outcome.branch}".`
  }
}
