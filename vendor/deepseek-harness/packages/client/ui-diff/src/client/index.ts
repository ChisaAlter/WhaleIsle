/** Browser plugin owning the Diff workspace-change surface. */

export { apply, DIFF_ID, DIFF_KIND, inject } from './apply.ts'
export type {
  DiffFile, DiffHunk, DiffKey, DiffLine, DiffPanelInjected, DiffPanelProps, DiffShellInjected, GitDiffOptions,
  GitDiffResult, GitStatusEntriesResult, GitStatusEntry,
} from './apply.ts'
