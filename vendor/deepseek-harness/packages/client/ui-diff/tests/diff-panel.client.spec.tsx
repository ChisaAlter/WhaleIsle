// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { DiffPanelProps } from '../src/client/DiffPanel.tsx'
import { DiffPanel, pickBranchBase } from '../src/client/DiffPanel.tsx'
import { en } from '../src/client/locales.ts'
import { isStaged, isUnstaged, type GitBranchListResult, type GitDiffOptions, type GitDiffResult } from '../src/client/shell.ts'

const t: DiffPanelProps['t'] = key => (en as Record<string, string>)[key] ?? key
const neverHook = (() => { throw new Error('diff must not read this hook') }) as never
const SID = 'session-diff' as SessionId
const BACKGROUND_SID = 'session-diff-background' as SessionId

function sessionList(cwd: string | undefined, mainView = true): SessionListState {
  const byId = {
    ...(cwd === undefined
      ? {}
      : {
      [SID]: {
        id: SID,
        displayTitle: 'proj',
        running: false,
        blank: false,
        retainedBy: mainView ? { mainView: 1 } : {},
        updatedAt: 1,
        ...(cwd ? { cwd } : {}),
      },
      }),
    [BACKGROUND_SID]: {
      id: BACKGROUND_SID,
      displayTitle: 'background',
      running: false,
      blank: false,
      retainedBy: {},
      updatedAt: 1,
      cwd: '/tmp/background',
    },
  }
  return {
    ids: Object.keys(byId) as SessionId[],
    byId,
    phase: 'ready',
    projectionsBySession: {},
  }
}

const SAMPLE: GitDiffResult = {
  files: [{
    path: 'README.md',
    status: 'modified',
    hunks: [{
      header: '@@ -1,1 +1,2 @@',
      lines: [
        { kind: 'context', text: 'hello' },
        { kind: 'del', text: 'old' },
        { kind: 'add', text: 'world' },
      ],
    }],
  }],
}

function mount(opts: {
  cwd?: string | undefined
  status?: unknown
  diff?: GitDiffResult | null
  entries?: { ok: boolean; entries?: { path: string; xy: string }[] } | null
}) {
  const gitStatus = vi.fn(async () => opts.status ?? null)
  const gitDiff = vi.fn(async (_cwd: string, _options?: GitDiffOptions): Promise<GitDiffResult | null> => opts.diff ?? null)
  const gitStatusEntries = vi.fn(async () => opts.entries ?? null)
  const gitStage = vi.fn(async (): Promise<{ ok: boolean; message?: string }> => ({ ok: true }))
  const gitUnstage = vi.fn(async (): Promise<{ ok: boolean; message?: string }> => ({ ok: true }))
  const gitDiscard = vi.fn(async (): Promise<{ ok: boolean; message?: string }> => ({ ok: true }))
  const gitBranchList = vi.fn(async (): Promise<GitBranchListResult | null> => ({
    ok: true,
    defaultRef: 'origin/main',
    branches: [{ name: 'main', isCurrent: true }, { name: 'origin/main', isRemote: true, isDefault: true }],
  }))
  const openFile = vi.fn()
  render(
    <DiffPanel {...({
      sessionId: SID,
      useSession: neverHook,
      useSessions: (sel: (s: SessionListState) => unknown) => sel(sessionList(opts.cwd)),
      useWorkspaces: neverHook,
      useProjection: neverHook,
      openFile,
      gitStatus,
      gitDiff,
      gitStatusEntries,
      gitStage,
      gitUnstage,
      gitDiscard,
      gitBranchList,
      t,
    } as unknown as DiffPanelProps)} />,
  )
  return { gitStatus, gitDiff, gitStage, gitUnstage, gitDiscard, gitBranchList, openFile }
}

afterEach(cleanup)

describe('porcelain helpers', () => {
  it('classifies staged and unstaged XY codes', () => {
    expect(isStaged('M ')).toBe(true)
    expect(isStaged(' M')).toBe(false)
    expect(isUnstaged(' M')).toBe(true)
    expect(isUnstaged('M ')).toBe(false)
  })
})

describe('DiffPanel', () => {
  it('reads the cwd from the tab session instead of the retained main-view session', async () => {
    const gitDiff = vi.fn(async () => SAMPLE)
    render(
      <DiffPanel {...({
        sessionId: SID,
        useSession: neverHook,
        useSessions: (sel: (s: SessionListState) => unknown) => sel(sessionList('/tmp/main', false)),
        useWorkspaces: neverHook,
        useProjection: neverHook,
        openFile: vi.fn(),
        gitStatus: vi.fn(async () => ({ refName: 'main' })),
        gitDiff,
        gitStatusEntries: vi.fn(async () => null),
        gitStage: vi.fn(async () => ({ ok: true })),
        gitUnstage: vi.fn(async () => ({ ok: true })),
        gitDiscard: vi.fn(async () => ({ ok: true })),
        gitBranchList: vi.fn(async () => null),
        t,
      } as unknown as DiffPanelProps)} />,
    )
    await waitFor(() => {
      expect(gitDiff).toHaveBeenCalledWith('/tmp/main', undefined)
    })
    expect(screen.getByText('README.md')).toBeTruthy()
  })

  it('shows the disabled reason when the workspace is not a git repository', async () => {
    mount({ cwd: '/tmp/plain', status: null, diff: null })
    await waitFor(() => {
      expect(screen.getByText('Diff is only available in Git repositories.')).toBeTruthy()
    })
    expect(screen.queryByText('README.md')).toBeNull()
  })

  it('renders the change list and hunks when gitStatus and gitDiff succeed', async () => {
    const b = mount({ cwd: '/tmp/repo', status: { refName: 'main' }, diff: SAMPLE })
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })
    expect(screen.getByText('@@ -1,1 +1,2 @@')).toBeTruthy()
    expect(screen.getByText('world')).toBeTruthy()
    fireEvent.click(screen.getByText('README.md'))
    expect(b.openFile).toHaveBeenCalledWith('README.md')
  })

  it('stages an unstaged porcelain row', async () => {
    const b = mount({
      cwd: '/tmp/repo',
      status: { refName: 'main' },
      diff: SAMPLE,
      entries: { ok: true, entries: [{ path: 'README.md', xy: ' M' }] },
    })
    await waitFor(() => {
      expect(screen.getByText('Unstaged')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Stage' }))
    await waitFor(() => {
      expect(b.gitStage).toHaveBeenCalledWith('/tmp/repo', 'README.md')
    })
  })

  it('unstages a staged porcelain row', async () => {
    const b = mount({
      cwd: '/tmp/repo',
      status: { refName: 'main' },
      diff: SAMPLE,
      entries: { ok: true, entries: [{ path: 'README.md', xy: 'M ' }] },
    })
    await waitFor(() => {
      expect(screen.getByText('Staged')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Unstage' }))
    await waitFor(() => {
      expect(b.gitUnstage).toHaveBeenCalledWith('/tmp/repo', 'README.md')
    })
  })

  it('confirms discard before calling gitDiscard', async () => {
    const b = mount({
      cwd: '/tmp/repo',
      status: { refName: 'main' },
      diff: SAMPLE,
      entries: { ok: true, entries: [{ path: 'README.md', xy: ' M' }] },
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Discard' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    const confirms = screen.getAllByRole('button', { name: 'Discard' })
    fireEvent.click(confirms[confirms.length - 1]!)
    await waitFor(() => {
      expect(b.gitDiscard).toHaveBeenCalledWith('/tmp/repo', 'README.md')
    })
  })

  it('cancels discard without calling gitDiscard', async () => {
    const b = mount({
      cwd: '/tmp/repo',
      status: { refName: 'main' },
      diff: SAMPLE,
      entries: { ok: true, entries: [{ path: 'README.md', xy: ' M' }] },
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Discard' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    const cancels = screen.getAllByRole('button', { name: 'Cancel' })
    fireEvent.click(cancels[cancels.length - 1]!)
    expect(b.gitDiscard).not.toHaveBeenCalled()
  })

  it('shows empty porcelain and empty-cwd messages', async () => {
    mount({
      cwd: '/tmp/repo',
      status: { refName: 'main' },
      diff: { files: [] },
      entries: { ok: true, entries: [] },
    })
    expect(await screen.findByText('No net changes in this selection.')).toBeTruthy()
    cleanup()
    mount({ cwd: undefined, status: { refName: 'main' }, diff: SAMPLE })
    expect(screen.getByText('A workspace is required to review diffs.')).toBeTruthy()
  })

  it('renders unified hunks without porcelain and surfaces a stage failure', async () => {
    const gitStage = vi.fn(async () => ({ ok: false, message: 'index locked' }))
    const gitStatus = vi.fn(async () => ({ refName: 'main' }))
    const gitDiff = vi.fn(async () => ({ ...SAMPLE, truncated: true }))
    const gitStatusEntries = vi.fn(async () => null)
    const gitUnstage = vi.fn(async () => ({ ok: true }))
    const gitDiscard = vi.fn(async () => ({ ok: true }))
    render(
      <DiffPanel {...({
        sessionId: SID,
        useSession: neverHook,
        useSessions: (sel: (s: SessionListState) => unknown) => sel(sessionList('/tmp/repo')),
        useWorkspaces: neverHook,
        useProjection: neverHook,
        openFile: vi.fn(),
        gitStatus,
        gitDiff,
        gitStatusEntries,
        gitStage,
        gitUnstage,
        gitDiscard,
        gitBranchList: async () => null,
        t,
      } as unknown as DiffPanelProps)} />,
    )
    expect(await screen.findByText('Diff is too large; showing the beginning.')).toBeTruthy()
    expect(screen.getByText('README.md')).toBeTruthy()
    cleanup()
    const failing = mount({
      cwd: '/tmp/repo',
      status: { refName: 'main' },
      diff: SAMPLE,
      entries: { ok: true, entries: [{ path: 'README.md', xy: ' M' }] },
    })
    failing.gitStage.mockResolvedValueOnce({ ok: false, message: 'index locked' })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Stage' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Stage' }))
    expect(await screen.findByText('index locked')).toBeTruthy()
    expect(screen.getByText('README.md')).toBeTruthy()
  })

  it('shows the load error when gitStatus rejects', async () => {
    render(
      <DiffPanel {...({
        sessionId: SID,
        useSession: neverHook,
        useSessions: (sel: (s: SessionListState) => unknown) => sel(sessionList('/tmp/repo')),
        useWorkspaces: neverHook,
        useProjection: neverHook,
        openFile: vi.fn(),
        gitStatus: async () => { throw new Error('boom') },
        gitDiff: async () => SAMPLE,
        gitStatusEntries: async () => null,
        gitStage: async () => ({ ok: true }),
        gitUnstage: async () => ({ ok: true }),
        gitDiscard: async () => ({ ok: true }),
        gitBranchList: async () => null,
        t,
      } as unknown as DiffPanelProps)} />,
    )
    expect(await screen.findByText('Could not load the diff.')).toBeTruthy()
  })

  it('reloads on refresh and window focus, and toggles a hunk', async () => {
    const b = mount({ cwd: '/tmp/repo', status: { refName: 'main' }, diff: SAMPLE })
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: 'Working tree' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => {
      expect(b.gitDiff.mock.calls.length).toBeGreaterThan(1)
    })
    window.dispatchEvent(new Event('focus'))
    const title = screen.getByText('README.md')
    fireEvent.click(title)
    expect(b.openFile).toHaveBeenCalledWith('README.md')
    fireEvent.click(screen.getByRole('button', { expanded: true }))
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    fireEvent.click(screen.getByText('hello'))
    expect(b.openFile).toHaveBeenCalledTimes(1)
  })

  it('shows empty unified changes when porcelain is absent', async () => {
    mount({
      cwd: '/tmp/repo',
      status: { refName: 'main' },
      diff: { files: [] },
      entries: null,
    })
    expect(await screen.findByText('No net changes in this selection.')).toBeTruthy()
  })

  it('unmounts a pending load, confirms modal close, and shows truncated porcelain', async () => {
    let finish!: (value: unknown) => void
    const pending = new Promise((resolve) => { finish = resolve })
    const { unmount } = render(
      <DiffPanel {...({
        sessionId: SID,
        useSession: neverHook,
        useSessions: (sel: (s: SessionListState) => unknown) => sel(sessionList('/tmp/repo')),
        useWorkspaces: neverHook,
        useProjection: neverHook,
        openFile: vi.fn(),
        gitStatus: () => pending,
        gitDiff: async () => SAMPLE,
        gitStatusEntries: async () => ({ ok: true }),
        gitStage: async () => ({ ok: false }),
        gitUnstage: async () => ({ ok: true }),
        gitDiscard: async () => ({ ok: true }),
        gitBranchList: async () => null,
        t,
      } as unknown as DiffPanelProps)} />,
    )
    unmount()
    finish({ refName: 'main' })
    const b = mount({
      cwd: '/tmp/repo',
      status: { refName: 'main' },
      diff: { ...SAMPLE, truncated: true },
      entries: { ok: true, entries: [{ path: 'README.md', xy: ' M' }] },
    })
    expect(await screen.findByText('Diff is too large; showing the beginning.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]!)
    expect(b.gitDiscard).not.toHaveBeenCalled()
    b.gitStage.mockResolvedValueOnce({ ok: false })
    fireEvent.click(screen.getByRole('button', { name: 'Stage' }))
    expect(await screen.findByText('Could not load the diff.')).toBeTruthy()
    expect(screen.getByText('README.md')).toBeTruthy()
  })

  it('treats ok porcelain without entries as empty and ignores a late reject', async () => {
    let fail!: (error: Error) => void
    const pending = new Promise<never>((_, reject) => { fail = reject })
    const { unmount } = render(
      <DiffPanel {...({
        sessionId: SID,
        useSession: neverHook,
        useSessions: (sel: (s: SessionListState) => unknown) => sel(sessionList('/tmp/repo')),
        useWorkspaces: neverHook,
        useProjection: neverHook,
        openFile: vi.fn(),
        gitStatus: () => pending,
        gitDiff: async () => SAMPLE,
        gitStatusEntries: async () => ({ ok: true }),
        gitStage: async () => ({ ok: true }),
        gitUnstage: async () => ({ ok: true }),
        gitDiscard: async () => ({ ok: true }),
        gitBranchList: async () => null,
        t,
      } as unknown as DiffPanelProps)} />,
    )
    unmount()
    fail(new Error('late'))
    mount({
      cwd: '/tmp/repo',
      status: { refName: 'main' },
      diff: SAMPLE,
      entries: { ok: true },
    })
    expect(await screen.findByText('No net changes in this selection.')).toBeTruthy()
    expect(screen.queryByText('README.md')).toBeNull()
  })

  it('renders an empty hunk list for a porcelain path absent from the unified diff', async () => {
    mount({
      cwd: '/tmp/repo',
      status: { refName: 'main' },
      diff: SAMPLE,
      entries: { ok: true, entries: [{ path: 'ghost.ts', xy: ' M' }] },
    })
    expect(await screen.findByText('ghost.ts')).toBeTruthy()
    expect(screen.queryByText('@@ -1,1 +1,2 @@')).toBeNull()
  })

  it('loads a three-dot branch range and hides stage actions', async () => {
    const b = mount({ cwd: '/tmp/repo', status: { refName: 'main' }, diff: SAMPLE })
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Working tree' }))
    await waitFor(() => {
      expect(b.gitBranchList).toHaveBeenCalledWith('/tmp/repo')
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'origin/main' }))
    await waitFor(() => {
      expect(b.gitDiff).toHaveBeenCalledWith('/tmp/repo', { baseRef: 'origin/main' })
    })
    expect(screen.getByRole('button', { name: /Branch/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Stage' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    fireEvent.click(screen.getByRole('button', { name: /Branch/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Working tree' }))
    await waitFor(() => {
      expect(b.gitDiff.mock.calls.some(call => call[1] === undefined)).toBe(true)
    })
  })

  it('shows a load error when the repo is valid but gitDiff returns null', async () => {
    mount({
      cwd: '/tmp/repo',
      status: { refName: 'main' },
      diff: null,
    })
    expect(await screen.findByText('Could not load the diff.')).toBeTruthy()
    expect(screen.queryByText('Diff is only available in Git repositories.')).toBeNull()
  })

  it('clears the branch list when gitBranchList is not ok', async () => {
    const b = mount({ cwd: '/tmp/repo', status: { refName: 'main' }, diff: SAMPLE })
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })
    b.gitBranchList.mockResolvedValueOnce({ ok: false, message: 'no git' })
    fireEvent.click(screen.getByRole('button', { name: 'Working tree' }))
    await waitFor(() => {
      expect(b.gitBranchList).toHaveBeenCalled()
    })
    expect(screen.queryByRole('menuitem', { name: 'origin/main' })).toBeNull()
  })

  it('filters branch refs and lists beyond fifty names', async () => {
    const extra = Array.from({ length: 51 }, (_, index) => ({
      name: `topic-${String(index + 1).padStart(2, '0')}`,
    }))
    const b = mount({ cwd: '/tmp/repo', status: { refName: 'main' }, diff: SAMPLE })
    b.gitBranchList.mockResolvedValueOnce({
      ok: true,
      defaultRef: 'origin/main',
      branches: [
        { name: 'main', isCurrent: true },
        { name: 'origin/main', isRemote: true, isDefault: true },
        ...extra,
      ],
    })
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Working tree' }))
    expect(await screen.findByRole('menuitem', { name: 'topic-51' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search branches…'), { target: { value: 'topic-51' } })
    expect(screen.getByRole('menuitem', { name: 'topic-51' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'origin/main' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Working tree' })).toBeTruthy()
  })

  it('draws numbered rows from the shared renderer and toggles split/wrap', async () => {
    mount({ cwd: '/tmp/repo', status: { refName: 'main' }, diff: SAMPLE })
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })
    const view = document.querySelector('[data-review-view]')
    expect(view?.getAttribute('data-review-view')).toBe('unified')
    const rows = [...document.querySelectorAll('[data-diff-line]')]
    expect(rows.map(row => row.getAttribute('data-diff-line'))).toEqual(['context', 'del', 'add'])
    expect(rows[0]?.querySelectorAll('[class*="_number_"]')[0]?.textContent).toBe('1')
    fireEvent.click(screen.getByLabelText('Toggle unified/split view'))
    expect(document.querySelector('[data-review-view]')?.getAttribute('data-review-view')).toBe('split')
    fireEvent.click(screen.getByLabelText('Toggle line wrapping'))
    expect(document.querySelector('[data-review-view]')?.hasAttribute('data-review-wrap')).toBe(true)
  })

  it('renders an end-of-file annotation row without a line number', async () => {
    mount({
      cwd: '/tmp/repo',
      status: { refName: 'main' },
      diff: {
        files: [{
          path: 'a.txt',
          status: 'modified',
          hunks: [{
            header: '@@ -1,2 +1,2 @@',
            lines: [
              { kind: 'del', text: 'old' },
              { kind: 'add', text: 'new' },
              { kind: 'eof', text: 'No newline at end of file' },
            ],
          }],
        }],
      },
    })
    await waitFor(() => {
      expect(screen.getByText('No newline at end of file')).toBeTruthy()
    })
    expect(document.querySelector('[data-diff-line="eof"]')).not.toBeNull()
  })

  it('notes a rename and a hunk-less binary file instead of inventing rows', async () => {
    mount({
      cwd: '/tmp/repo',
      status: { refName: 'main' },
      diff: {
        files: [
          { path: 'new-name.ts', status: 'renamed', oldPath: 'old-name.ts', hunks: SAMPLE.files[0]!.hunks },
          { path: 'logo.png', status: 'added', binary: true, hunks: [] },
          { path: 'huge.log', status: 'added', tooLarge: true, hunks: [] },
        ],
      },
    })
    await waitFor(() => {
      // The spec's `t` stub does not interpolate; assert the note exists and carries the old path's dict slot.
      expect(document.querySelector('[data-diff-note="renamed"]')?.textContent).toContain('Renamed from')
    })
    expect(screen.getByText('Binary or oversized file; no line diff')).toBeTruthy()
    expect(document.querySelector('[data-diff-note="too-large"]')?.textContent)
      .toBe('Untracked text file exceeds size limit; line diff omitted')
  })

  it('collapses every file when the diff is large, expanding on demand', async () => {
    const files = Array.from({ length: 10 }, (_v, index) => ({
      path: `file-${index}.ts`,
      status: 'modified' as const,
      hunks: SAMPLE.files[0]!.hunks,
    }))
    mount({ cwd: '/tmp/repo', status: { refName: 'main' }, diff: { files } })
    await waitFor(() => {
      expect(screen.getByText('file-9.ts')).toBeTruthy()
    })
    expect(document.querySelectorAll('[data-diff-line]')).toHaveLength(0)
    fireEvent.click(screen.getAllByRole('button', { expanded: false })[0]!)
    await waitFor(() => {
      expect(document.querySelectorAll('[data-diff-line]').length).toBeGreaterThan(0)
    })
  })
})

describe('pickBranchBase', () => {
  it('prefers defaultRef, then isDefault, then main, then the first local branch', () => {
    expect(pickBranchBase([], 'origin/main')).toBe('origin/main')
    expect(pickBranchBase([{ name: 'topic', isDefault: true }], null)).toBe('topic')
    expect(pickBranchBase([{ name: 'main' }], undefined)).toBe('main')
    expect(pickBranchBase([{ name: 'topic', isRemote: true }, { name: 'feat' }], null)).toBe('feat')
    expect(pickBranchBase([{ name: 'origin/main' }], null)).toBe('origin/main')
    expect(pickBranchBase([], null)).toBe('main')
    expect(pickBranchBase([], '')).toBe('main')
  })
})
