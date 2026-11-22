/**
 * Pure row grouping, render-budget slicing, and per-hunk eligibility helpers for DiffPanel.
 */
import { MAX_RENDERED_LINES, renderedHunks } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReviewHunk } from '@deepseek-ai/dsh-client-ui-primitives'
import { toReviewHunk } from './review-hunks.ts'
import { isStaged, isUnstaged, type DiffFile, type GitStatusEntry } from './shell.ts'

/** The mounted-row ceiling across the whole panel; collapsed files never consume it. */
export const PANEL_RENDER_BUDGET = MAX_RENDERED_LINES

/** The number of rows above which files start collapsed so large diffs expand on demand. */
export const COLLAPSE_FILE_THRESHOLD = 8

/** Which list section owns a displayed file row. */
export type DiffSection = 'staged' | 'unstaged' | 'combined'

/** Display row metadata used across staged, unstaged, and branch views. */
export interface VisibleDiffRow {
  key: string
  section: DiffSection
  path: string
  entry: GitStatusEntry | null
}

/** One open file's sliced hunks, budget flags, and original hunk lengths. */
export interface FileView {
  hunks: ReviewHunk[]
  truncated: boolean
  omitted: boolean
  sourceHunkLines: readonly number[]
}

/** Build a section-isolated row key so `MM` staged and unstaged entries never collide. */
export function rowKey(section: DiffSection, relativePath: string): string {
  return `${section}:${relativePath}`
}

/**
 * Resolve displayed rows in order across worktree (staged + unstaged) or combined/branch modes.
 * @param scope - active diff scope.
 * @param entries - porcelain entries, or `null` when unavailable.
 * @param staged - filtered staged porcelain entries.
 * @param unstaged - filtered unstaged porcelain entries.
 * @param files - top-level diff files.
 * @returns ordered row descriptors.
 */
export function buildVisibleRows(
  scope: 'worktree' | 'branch',
  entries: readonly GitStatusEntry[] | null,
  staged: readonly GitStatusEntry[],
  unstaged: readonly GitStatusEntry[],
  files: readonly DiffFile[],
): VisibleDiffRow[] {
  if (scope === 'worktree' && entries !== null) {
    return [
      ...staged.map(entry => ({
        key: rowKey('staged', entry.path),
        section: 'staged' as const,
        path: entry.path,
        entry,
      })),
      ...unstaged.map(entry => ({
        key: rowKey('unstaged', entry.path),
        section: 'unstaged' as const,
        path: entry.path,
        entry,
      })),
    ]
  }
  return files.map(file => ({
    key: rowKey('combined', file.path),
    section: 'combined' as const,
    path: file.path,
    entry: null,
  }))
}

/**
 * Look up the active `DiffFile` for a row, preferring section-specific on-demand fetches.
 * @param key - section row key (`staged:path` etc.).
 * @param relativePath - file path.
 * @param initialFiles - top-level diff response files.
 * @param sectionFiles - per-row cached single-file responses.
 * @returns resolved file metadata, or `undefined` when not yet loaded.
 */
export function resolveRowFile(
  key: string,
  relativePath: string,
  initialFiles: readonly DiffFile[],
  sectionFiles: Readonly<Record<string, DiffFile>>,
): DiffFile | undefined {
  return sectionFiles[key] ?? initialFiles.find(file => file.path === relativePath)
}

/**
 * Allocate the panel row budget across open rows in display order.
 * @param rows - displayed rows in order.
 * @param openKeys - currently expanded row keys.
 * @param initialFiles - top-level diff files.
 * @param sectionFiles - per-row cached single-file responses.
 * @returns map from row key to renderable `FileView`.
 */
export function buildFileViews(
  rows: readonly VisibleDiffRow[],
  openKeys: ReadonlySet<string>,
  initialFiles: readonly DiffFile[],
  sectionFiles: Readonly<Record<string, DiffFile>>,
): Map<string, FileView> {
  const views = new Map<string, FileView>()
  let remaining = PANEL_RENDER_BUDGET
  for (const row of rows) {
    if (!openKeys.has(row.key)) continue
    const file = resolveRowFile(row.key, row.path, initialFiles, sectionFiles)
    if (file === undefined) continue
    const sourceHunkLines = file.hunks.map(hunk => hunk.lines.length)
    if (remaining === 0) {
      views.set(row.key, { hunks: [], truncated: false, omitted: true, sourceHunkLines })
      continue
    }
    const review = file.hunks.map(toReviewHunk)
    const sliced = renderedHunks(review, remaining)
    remaining -= sliced.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0)
    views.set(row.key, {
      hunks: sliced.hunks,
      truncated: sliced.truncated,
      omitted: false,
      sourceHunkLines,
    })
  }
  return views
}

/** Return true for unmerged Git porcelain states where index patching is unsafe. */
export function isConflictEntry(xy: string): boolean {
  return xy.includes('U') || xy === 'AA' || xy === 'DD'
}

/**
 * Determine whether expanding `row` requires an on-demand single-file `gitDiff` fetch.
 * @param row - target displayed row.
 * @param initialFile - matching file from the initial bulk diff, if any.
 * @param truncated - whether the bulk diff was truncated by size limit.
 * @param totalFiles - file count returned by the initial bulk diff.
 * @param scope - active diff scope.
 */
export function needsSingleFileFetch(
  row: VisibleDiffRow,
  initialFile: DiffFile | undefined,
  truncated: boolean,
  totalFiles: number,
  scope: 'worktree' | 'branch',
): boolean {
  if (scope === 'worktree' && row.section !== 'combined' && row.entry !== null) {
    if (isStaged(row.entry.xy) && isUnstaged(row.entry.xy)) return true
  }
  return truncated || totalFiles > COLLAPSE_FILE_THRESHOLD || initialFile === undefined
}

/**
 * Check whether a single hunk can be safely staged/unstaged with `git apply --cached`.
 * Rejects branch diffs, missing IPC ops, truncated/binary/oversized files, unmerged conflicts,
 * untracked (`??`) placeholders, and staged/unstaged `added`/`deleted` status mismatches.
 */
export function canPatchSingleHunk(options: {
  scope: 'worktree' | 'branch'
  section: DiffSection
  entry: GitStatusEntry | null
  file: DiffFile
  view: FileView
  hunkIndex: number
  renderedHunk: ReviewHunk
  hasStagePatch: boolean
  hasUnstagePatch: boolean
  hasSectionFile: boolean
}): boolean {
  const { scope, section, entry, file, view, hunkIndex, renderedHunk, hasStagePatch, hasUnstagePatch, hasSectionFile } = options
  if (scope !== 'worktree' || entry === null || section === 'combined') return false
  if (section === 'staged' && !hasUnstagePatch) return false
  if (section === 'unstaged' && !hasStagePatch) return false
  if (view.truncated || view.omitted) return false
  if (file.binary === true || file.tooLarge === true) return false
  if (view.sourceHunkLines[hunkIndex] !== renderedHunk.lines.length) return false
  if (isConflictEntry(entry.xy)) return false
  if (entry.xy === '??') return false
  if (isStaged(entry.xy) && isUnstaged(entry.xy) && !hasSectionFile) return false
  if (section === 'unstaged' && (file.status === 'added' || entry.xy === 'AD' || entry.xy === 'RD')) return false
  if (section === 'staged' && file.status === 'deleted' && isUnstaged(entry.xy)) return false
  return true
}
