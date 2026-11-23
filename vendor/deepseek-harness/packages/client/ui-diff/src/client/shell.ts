/** Desktop git diff the Electron preload exposes on `window.shell`. */

/** One unified-diff line; `eof` is the `\` end-of-file annotation. */
export interface DiffLine {
  kind: 'context' | 'add' | 'del' | 'eof'
  text: string
}

/** One hunk inside a changed file. */
export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

/** One changed path in the working tree. */
export interface DiffFile {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  oldPath?: string
  binary?: boolean
  tooLarge?: boolean
  hunks: DiffHunk[]
}

/** gitDiff IPC result; null when the cwd is not a git repository. */
export interface GitDiffResult {
  files: DiffFile[]
  truncated?: boolean
}

/** One porcelain v1 status row. */
export interface GitStatusEntry {
  path: string
  xy: string
}

/** gitStatusEntries IPC result. */
export interface GitStatusEntriesResult {
  ok: boolean
  message?: string
  entries?: GitStatusEntry[]
}

/** One ref from `gitBranchList`. */
export interface DiffBranchRef {
  name: string
  isRemote?: boolean
  isCurrent?: boolean
  isDefault?: boolean
}

/** gitBranchList IPC result. */
export interface GitBranchListResult {
  ok: boolean
  message?: string
  branches?: DiffBranchRef[]
  defaultRef?: string | null
}

/** Optional range or single-file filter parameters for `gitDiff`. */
export interface GitDiffOptions {
  baseRef?: string
  path?: string | undefined
  staged?: boolean | undefined
}

/** Injected git probes. */
export interface DiffShellInjected {
  gitStatus: (cwd: string) => Promise<unknown>
  gitDiff: (cwd: string, options?: GitDiffOptions) => Promise<GitDiffResult | null>
  gitStatusEntries: (cwd: string) => Promise<GitStatusEntriesResult | null>
  gitStage: (cwd: string, relativePath: string) => Promise<{ ok: boolean; message?: string }>
  gitUnstage: (cwd: string, relativePath: string) => Promise<{ ok: boolean; message?: string }>
  gitDiscard: (cwd: string, relativePath: string) => Promise<{ ok: boolean; message?: string }>
  gitBranchList: (cwd: string) => Promise<GitBranchListResult | null>
  gitStagePatch?: ((cwd: string, patchText: string) => Promise<{ ok: boolean; message?: string }>) | undefined
  gitUnstagePatch?: ((cwd: string, patchText: string) => Promise<{ ok: boolean; message?: string }>) | undefined
  appendComposerText?: ((sessionId: string, text: string) => void) | undefined
}

interface DiffShell {
  gitStatus?: (cwd: string) => Promise<unknown>
  gitDiff?: (cwd: string, options?: GitDiffOptions) => Promise<GitDiffResult | null>
  gitStatusEntries?: (cwd: string) => Promise<GitStatusEntriesResult | null>
  gitStage?: (cwd: string, relativePath: string) => Promise<{ ok: boolean; message?: string }>
  gitUnstage?: (cwd: string, relativePath: string) => Promise<{ ok: boolean; message?: string }>
  gitDiscard?: (cwd: string, relativePath: string) => Promise<{ ok: boolean; message?: string }>
  gitBranchList?: (cwd: string) => Promise<GitBranchListResult | null>
  gitStagePatch?: (cwd: string, patchText: string) => Promise<{ ok: boolean; message?: string }>
  gitUnstagePatch?: (cwd: string, patchText: string) => Promise<{ ok: boolean; message?: string }>
}

function missingOp(): Promise<{ ok: boolean; message?: string }> {
  return Promise.resolve({ ok: false, message: 'Git status is unavailable.' })
}

/**
 * Bind desktop git IPC when `window.shell` is present.
 * @returns injected git callbacks; each call resolves null outside the desktop app.
 */
export function readDiffShell(): DiffShellInjected {
  /* v8 ignore next -- browser-only module; Node coverage never sees a missing window. */
  const shell = typeof window === 'undefined'
    ? undefined
    : (window as Window & { shell?: DiffShell }).shell
  const stagePatch = shell?.gitStagePatch
  const unstagePatch = shell?.gitUnstagePatch
  return {
    gitStatus: cwd => shell?.gitStatus?.(cwd) ?? Promise.resolve(null),
    gitDiff: (cwd, options) => shell?.gitDiff?.(cwd, options) ?? Promise.resolve(null),
    gitStatusEntries: cwd => shell?.gitStatusEntries?.(cwd) ?? Promise.resolve(null),
    gitBranchList: cwd => shell?.gitBranchList?.(cwd) ?? Promise.resolve(null),
    gitStage: (cwd, relativePath) => shell?.gitStage?.(cwd, relativePath) ?? missingOp(),
    gitUnstage: (cwd, relativePath) => shell?.gitUnstage?.(cwd, relativePath) ?? missingOp(),
    gitDiscard: (cwd, relativePath) => shell?.gitDiscard?.(cwd, relativePath) ?? missingOp(),
    ...(stagePatch === undefined ? {} : {
      gitStagePatch: (cwd, patchText) => stagePatch.call(shell, cwd, patchText),
    }),
    ...(unstagePatch === undefined ? {} : {
      gitUnstagePatch: (cwd, patchText) => unstagePatch.call(shell, cwd, patchText),
    }),
  }
}

/**
 * Index (X) has a staged change.
 * @param xy - two-character porcelain status.
 * @returns true when the index column is a staged status letter.
 */
export function isStaged(xy: string): boolean {
  const x = xy[0]
  return x !== undefined && x !== ' ' && x !== '?' && x !== '!'
}

/**
 * Worktree (Y) has an unstaged change.
 * @param xy - two-character porcelain status.
 * @returns true when the worktree column is an unstaged status letter.
 */
export function isUnstaged(xy: string): boolean {
  const y = xy[1]
  return y !== undefined && y !== ' '
}
