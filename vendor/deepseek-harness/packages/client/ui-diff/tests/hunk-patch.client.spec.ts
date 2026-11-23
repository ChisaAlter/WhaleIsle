// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSingleHunkPatch, formatDiffLineComment, isSafePatchPath } from '../src/client/hunk-patch.ts'
import { readDiffShell } from '../src/client/shell.ts'
import { canPatchSingleHunk, isConflictEntry, needsSingleFileFetch } from '../src/client/panel-model.ts'

describe('isSafePatchPath', () => {
  it('accepts normal relative POSIX paths including spaces and UTF-8', () => {
    expect(isSafePatchPath('README.md')).toBe(true)
    expect(isSafePatchPath('src/目录/my file.ts')).toBe(true)
  })

  it('rejects traversal, absolute paths, .git segments, and NTFS reserved names', () => {
    for (const bad of [
      '',
      '../secret.ts',
      'a/../../b.ts',
      '/etc/passwd',
      '\\Windows\\win.ini',
      'C:/repo/file.ts',
      'a\\b.ts',
      '.git/config',
      'sub/.GIT/hooks',
      'CON',
      'dir/nul.txt',
      'lpt1/a.ts',
      'a//b.ts',
      'a\0b.ts',
      'a\nb.ts',
    ]) {
      expect(isSafePatchPath(bad)).toBe(false)
    }
  })
})

describe('buildSingleHunkPatch', () => {
  it('builds a valid patch for modified, added, deleted, and renamed files', () => {
    expect(buildSingleHunkPatch(
      { path: 'src/app.ts', status: 'modified' },
      {
        header: '@@ -10,2 +10,2 @@',
        lines: [
          { kind: 'context', text: 'const x = 1' },
          { kind: 'del', text: 'const y = 2' },
          { kind: 'add', text: 'const y = 3' },
        ],
      },
    )).toBe([
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -10,2 +10,2 @@',
      ' const x = 1',
      '-const y = 2',
      '+const y = 3',
      '',
    ].join('\n'))

    expect(buildSingleHunkPatch(
      { path: 'new file.ts', status: 'added' },
      {
        header: '@@ -0,0 +1,1 @@',
        lines: [{ kind: 'add', text: 'export const ok = true' }],
      },
    )).toBe([
      'diff --git a/new file.ts b/new file.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new file.ts',
      '@@ -0,0 +1,1 @@',
      '+export const ok = true',
      '',
    ].join('\n'))

    expect(buildSingleHunkPatch(
      { path: 'old.ts', status: 'deleted' },
      {
        header: '@@ -1,1 +0,0 @@',
        lines: [{ kind: 'del', text: 'bye' }],
      },
    )).toBe([
      'diff --git a/old.ts b/old.ts',
      'deleted file mode 100644',
      '--- a/old.ts',
      '+++ /dev/null',
      '@@ -1,1 +0,0 @@',
      '-bye',
      '',
    ].join('\n'))

    expect(buildSingleHunkPatch(
      { path: 'src/new name.ts', oldPath: 'src/old b/name.ts', status: 'renamed' },
      {
        header: '@@ -1,1 +1,1 @@',
        lines: [{ kind: 'del', text: 'a' }, { kind: 'add', text: 'b' }],
      },
    )).toBe([
      'diff --git "a/src/old b/name.ts" "b/src/new name.ts"',
      'rename from src/old b/name.ts',
      'rename to src/new name.ts',
      '--- a/src/old b/name.ts',
      '+++ b/src/new name.ts',
      '@@ -1,1 +1,1 @@',
      '-a',
      '+b',
      '',
    ].join('\n'))
  })

  it('accepts ReviewHunk string lines, EOF annotations, and synthesized headers', () => {
    expect(buildSingleHunkPatch(
      { path: 'note.txt', status: 'modified' },
      {
        oldStart: 4,
        newStart: 4,
        lines: ['-old', '+new', '\\ No newline at end of file'],
      },
    )).toBe([
      'diff --git a/note.txt b/note.txt',
      '--- a/note.txt',
      '+++ b/note.txt',
      '@@ -4,1 +4,1 @@',
      '-old',
      '+new',
      '\\ No newline at end of file',
      '',
    ].join('\n'))
  })

  it('rejects unsafe paths, binary/oversized files, truncated/mismatched headers, and malformed lines', () => {
    expect(buildSingleHunkPatch(
      { path: 'img.png', status: 'modified', binary: true },
      { header: '@@ -1,1 +1,1 @@', lines: [{ kind: 'add', text: 'x' }] },
    )).toBeNull()
    expect(buildSingleHunkPatch(
      { path: 'huge.log', status: 'added', tooLarge: true },
      { header: '@@ -0,0 +1,1 @@', lines: [{ kind: 'add', text: 'x' }] },
    )).toBeNull()
    expect(buildSingleHunkPatch(
      { path: 'moved.ts', status: 'renamed' },
      { header: '@@ -1,1 +1,1 @@', lines: [{ kind: 'del', text: 'a' }, { kind: 'add', text: 'b' }] },
    )).toBeNull()
    expect(buildSingleHunkPatch(
      { path: '../bad.ts', status: 'modified' },
      { header: '@@ -1,0 +1,1 @@', lines: [{ kind: 'add', text: 'x' }] },
    )).toBeNull()
    expect(buildSingleHunkPatch(
      { path: 'a.ts', status: 'modified' },
      { header: '@@ -1,5 +1,1 @@', lines: [{ kind: 'del', text: 'a' }, { kind: 'add', text: 'b' }] },
    )).toBeNull()
    expect(buildSingleHunkPatch(
      { path: 'a.ts', status: 'modified' },
      { header: 'bad header', lines: [{ kind: 'add', text: 'b' }] },
    )).toBeNull()
    expect(buildSingleHunkPatch(
      { path: 'a.ts', status: 'modified' },
      { header: '@@ -1,1 +1,1 @@', lines: [{ kind: 'context', text: 'same' }] },
    )).toBeNull()
    expect(buildSingleHunkPatch(
      { path: 'a.ts', status: 'modified' },
      { header: '@@ -1,0 +1,1 @@', lines: [{ kind: 'add', text: 'line1\n+++ a/evil' }] },
    )).toBeNull()
    expect(buildSingleHunkPatch(
      { path: 'a.ts', status: 'modified' },
      { lines: ['+missing starts'] },
    )).toBeNull()
  })
})

describe('formatDiffLineComment', () => {
  it('formats line references with safe markdown fences', () => {
    const hunk = { lines: ['+const a = 1'] }
    expect(formatDiffLineComment('src/main.ts', {
      lineNumber: 42,
      side: 'new',
      kind: 'add',
      text: 'const a = 1',
      hunk,
    })).toBe('L42 `src/main.ts`\n\n```diff\n+const a = 1\n```')

    expect(formatDiffLineComment('README.md', {
      lineNumber: 7,
      side: 'old',
      kind: 'del',
      text: '```ts',
      hunk,
    })).toBe('L7 `README.md`\n\n````diff\n-```ts\n````')
  })
})

describe('readDiffShell patch bindings and panel-model helpers', () => {
  afterEach(() => {
    delete (window as { shell?: unknown }).shell
  })

  it('omits hunk patch callbacks when missing on window.shell and binds when present', async () => {
    ;(window as { shell?: unknown }).shell = {}
    expect(readDiffShell().gitStagePatch).toBeUndefined()
    expect(readDiffShell().gitUnstagePatch).toBeUndefined()

    const gitStagePatch = vi.fn(async () => ({ ok: true }))
    const gitUnstagePatch = vi.fn(async () => ({ ok: true }))
    ;(window as { shell?: unknown }).shell = { gitStagePatch, gitUnstagePatch }
    const bound = readDiffShell()
    expect(await bound.gitStagePatch?.('/repo', 'patch')).toEqual({ ok: true })
    expect(await bound.gitUnstagePatch?.('/repo', 'patch')).toEqual({ ok: true })
    expect(gitStagePatch).toHaveBeenCalledWith('/repo', 'patch')
    expect(gitUnstagePatch).toHaveBeenCalledWith('/repo', 'patch')
  })

  it('guards conflict, untracked, truncated, and branch cases cleanly', () => {
    expect(isConflictEntry('UU')).toBe(true)
    expect(isConflictEntry('AA')).toBe(true)
    expect(isConflictEntry(' M')).toBe(false)
    expect(needsSingleFileFetch(
      { key: 'staged:a.ts', section: 'staged', path: 'a.ts', entry: { path: 'a.ts', xy: 'MM' } },
      { path: 'a.ts', status: 'modified', hunks: [] },
      false,
      1,
      'worktree',
    )).toBe(true)

    const view = { hunks: [{ lines: ['+a'] }], truncated: false, omitted: false, sourceHunkLines: [1] }
    const file = { path: 'a.ts', status: 'modified' as const, hunks: [] }
    expect(canPatchSingleHunk({
      scope: 'worktree',
      section: 'unstaged',
      entry: { path: 'a.ts', xy: '??' },
      file: { ...file, status: 'added' },
      view,
      hunkIndex: 0,
      renderedHunk: view.hunks[0]!,
      hasStagePatch: true,
      hasUnstagePatch: true,
      hasSectionFile: true,
    })).toBe(false)
    expect(canPatchSingleHunk({
      scope: 'worktree',
      section: 'unstaged',
      entry: { path: 'a.ts', xy: 'UU' },
      file,
      view,
      hunkIndex: 0,
      renderedHunk: view.hunks[0]!,
      hasStagePatch: true,
      hasUnstagePatch: true,
      hasSectionFile: true,
    })).toBe(false)
    expect(canPatchSingleHunk({
      scope: 'branch',
      section: 'staged',
      entry: { path: 'a.ts', xy: 'M ' },
      file,
      view,
      hunkIndex: 0,
      renderedHunk: view.hunks[0]!,
      hasStagePatch: true,
      hasUnstagePatch: true,
      hasSectionFile: true,
    })).toBe(false)
  })
})
