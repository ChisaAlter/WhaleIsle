// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within, act } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { allowAllAccess } from '@deepseek-ai/dsh-client-test-runtime'
import type { GitActionsProps } from '../src/client/GitActionsControl.tsx'
import { GitActionsControl } from '../src/client/GitActionsControl.tsx'
import type { VcsStatus } from '../src/client/git-logic.ts'
import { en } from '../src/client/locales.ts'
const panelInfoStub = ((selector: (s: unknown) => unknown) => selector({ activePanelId: null })) as never
const resourceStub = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as never


const SID = 'session-git' as SessionId
const t: GitActionsProps['t'] = (key, params) => {
  const template = (en as Record<string, string>)[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (
    name in params ? String(params[name]) : match
  ))
}
const neverWorkspaces = (() => { throw new Error('git actions must not read useWorkspaces') }) as never

type RetainedBy = SessionListState['byId'][SessionId]['retainedBy']

function sessionList(cwd: string | undefined, retainedBy: RetainedBy = cwd === undefined ? {} : { mainView: 1 }): SessionListState {
  const current = cwd === undefined ? undefined : SID
  const byId = current === undefined
    ? {}
    : {
      [SID]: {
        id: SID,
        displayTitle: 'proj',
        running: false,
        blank: false,
        updatedAt: 1,
        retainedBy,
        ...(cwd ? { cwd } : {}),
      },
    }
  return {
    ids: current === undefined ? [] : [SID],
    byId,
    phase: 'ready',
    projectionsBySession: {},
  }
}

function useSessionsStub(list: SessionListState): GitActionsProps['useSessions'] {
  return sel => sel(list)
}

function status(overrides: Partial<VcsStatus> = {}): VcsStatus {
  return {
    refName: 'feature/test',
    hasWorkingTreeChanges: false,
    hasUpstream: true,
    aheadCount: 0,
    behindCount: 0,
    pr: null,
    isDefaultRef: false,
    hasPrimaryRemote: true,
    isRepo: true,
    sourceControlProvider: {
      kind: 'github',
      name: 'GitHub',
      baseUrl: 'https://github.com',
    },
    workingTree: { files: [], insertions: 0, deletions: 0 },
    ...overrides,
  }
}

function filesTree(files: Array<{ path: string; insertions: number; deletions: number }>) {
  return {
    files,
    insertions: files.reduce((sum, file) => sum + file.insertions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  }
}

function mount(opts: {
  cwd?: string | undefined
  git?: VcsStatus | null
  gitStatus?: GitActionsProps['gitStatus']
  gitFetchForStatus?: GitActionsProps['gitFetchForStatus']
  gitReadPullRequest?: GitActionsProps['gitReadPullRequest']
  gitInit?: GitActionsProps['gitInit']
  gitCommit?: GitActionsProps['gitCommit']
  gitCheckLargeFiles?: GitActionsProps['gitCheckLargeFiles']
  gitPush?: GitActionsProps['gitPush']
  gitPull?: GitActionsProps['gitPull']
  gitCreateChangeRequest?: GitActionsProps['gitCreateChangeRequest']
  gitPublishRepository?: GitActionsProps['gitPublishRepository']
  gitBranchList?: GitActionsProps['gitBranchList']
  gitSwitchBranch?: GitActionsProps['gitSwitchBranch']
  gitCreateBranch?: GitActionsProps['gitCreateBranch']
  openWorkspacePath?: GitActionsProps['openWorkspacePath']
  onGitProgress?: GitActionsProps['onGitProgress']
  onWorkspacesChanged?: GitActionsProps['onWorkspacesChanged']
  density?: GitActionsProps['density']
  managedSession?: boolean
  titlebarGit?: boolean
  useTitlebarGit?: GitActionsProps['useTitlebarGit']
  sessionState?: SessionListState
} = {}) {
  const gitStatus = opts.gitStatus ?? vi.fn(async () => opts.git ?? null)
  const gitFetchForStatus = opts.gitFetchForStatus ?? vi.fn(async () => opts.git ?? null)
  const gitReadPullRequest = opts.gitReadPullRequest ?? vi.fn(async () => ({
    ok: true,
    pr: (opts.git ?? status()).pr,
  }))
  const gitInit = opts.gitInit ?? vi.fn(async () => ({ ok: true }))
  const gitCommit = opts.gitCommit ?? vi.fn(async () => ({ ok: true }))
  const gitCheckLargeFiles = opts.gitCheckLargeFiles ?? vi.fn(async () => ({ ok: true, files: [] }))
  const gitPush = opts.gitPush ?? vi.fn(async () => ({ ok: true }))
  const gitPull = opts.gitPull ?? vi.fn(async () => ({ ok: true }))
  const gitCreateChangeRequest = opts.gitCreateChangeRequest ?? vi.fn(async () => ({ ok: true }))
  const gitPublishRepository = opts.gitPublishRepository ?? vi.fn(async () => ({ ok: true }))
  const gitBranchList = opts.gitBranchList ?? vi.fn(async () => ({ ok: true, branches: [] }))
  const gitSwitchBranch = opts.gitSwitchBranch ?? vi.fn(async () => ({ ok: true }))
  const gitCreateBranch = opts.gitCreateBranch ?? vi.fn(async () => ({ ok: true }))
  const openWorkspacePath = opts.openWorkspacePath ?? vi.fn(async () => ({ ok: true }))
  const onGitProgress = opts.onGitProgress ?? vi.fn(() => () => {})
  const onWorkspacesChanged = opts.onWorkspacesChanged ?? vi.fn(() => () => {})
  const openExternal = vi.fn(async () => true)
  const view = render(
    <GitActionsControl
      {...allowAllAccess}
      usePanelInfo={panelInfoStub}
      useResource={resourceStub}
      surfaces={0}
      rightbarShown={false}
      terminalDrawer={0}
      managedSession={opts.managedSession ?? false}
      {...(opts.density === undefined ? {} : { density: opts.density })}
      useSessions={useSessionsStub(opts.sessionState ?? sessionList(opts.cwd))}
      useSessionStatus={sel => sel(new Map())}
      useSessionRetainInfo={() => undefined}
      useWorkspaces={neverWorkspaces}
      gitStatus={gitStatus}
      gitFetchForStatus={gitFetchForStatus}
      gitReadPullRequest={gitReadPullRequest}
      gitInit={gitInit}
      gitCommit={gitCommit}
      gitCheckLargeFiles={gitCheckLargeFiles}
      gitPush={gitPush}
      gitPull={gitPull}
      gitCreateChangeRequest={gitCreateChangeRequest}
      gitPublishRepository={gitPublishRepository}
      gitBranchList={gitBranchList}
      gitSwitchBranch={gitSwitchBranch}
      gitCreateBranch={gitCreateBranch}
      onGitProgress={onGitProgress}
      onWorkspacesChanged={onWorkspacesChanged}
      openExternal={openExternal}
      openWorkspacePath={openWorkspacePath}
      useTitlebarGit={opts.useTitlebarGit ?? (sel => sel(opts.titlebarGit !== false))}
      t={t}
    />,
  )
  return {
    gitStatus, gitFetchForStatus, gitReadPullRequest, gitInit, gitCommit, gitCheckLargeFiles, gitPush, gitPull, gitCreateChangeRequest,
    gitPublishRepository, gitBranchList, gitSwitchBranch, gitCreateBranch, openWorkspacePath,
    onGitProgress, onWorkspacesChanged, openExternal, rerender: view.rerender,
  }
}

afterEach(cleanup)

describe('GitActionsControl', () => {
  it('renders no visible UI for managed sessions', () => {
    mount({ cwd: '/work', git: status(), managedSession: true })
    expect(document.body.querySelector('button')).toBeNull()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('keeps the titlebar control for ordinary sessions', async () => {
    mount({ cwd: '/work', git: status(), managedSession: false })
    expect(await screen.findByRole('button', { name: 'Commit' })).toBeTruthy()
  })

  it('hides the entire Git group when the current session has no cwd', () => {
    const b = mount({ cwd: undefined })
    expect(screen.queryByRole('button', { name: 'Commit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Switch branch' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Git actions' })).toBeNull()
    expect(b.gitStatus).not.toHaveBeenCalled()
  })

  it('keeps the Git group hidden until a status read resolves', async () => {
    let resolveStatus!: (value: VcsStatus) => void
    const gitStatus = vi.fn(() => new Promise<VcsStatus>(resolve => { resolveStatus = resolve }))
    mount({ cwd: '/work', gitStatus })
    expect(screen.queryByRole('button', { name: 'Git actions' })).toBeNull()
    await act(async () => { resolveStatus(status()) })
    expect(await screen.findByRole('button', { name: 'Git actions' })).toBeTruthy()
  })

  it('uses the main-view retained cwd when a background session is also retained', async () => {
    const backgroundId = 'session-background' as SessionId
    const state = sessionList('/main')
    state.ids.push(backgroundId)
    state.byId[backgroundId] = {
      id: backgroundId,
      displayTitle: 'background',
      running: true,
      blank: false,
      updatedAt: 2,
      cwd: '/background',
      retainedBy: { gateway: 1 },
    }
    const b = mount({ sessionState: state, git: status() })
    await waitFor(() => { expect(b.gitStatus).toHaveBeenCalledWith('/main') })
    expect(b.gitStatus).not.toHaveBeenCalledWith('/background')
  })

  it('hides the entire Git group when status is null', async () => {
    mount({ cwd: '/work', git: null })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Commit' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Switch branch' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Git actions' })).toBeNull()
    })
  })

  it('treats a rejected status read like a null snapshot instead of rejecting refresh', async () => {
    mount({
      cwd: '/work',
      gitStatus: vi.fn(async () => { throw new Error('status ipc dropped') }),
      gitFetchForStatus: vi.fn(async () => { throw new Error('fetch ipc dropped') }),
      gitReadPullRequest: vi.fn(async () => { throw new Error('pr ipc dropped') }),
    })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Commit' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Switch branch' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Git actions' })).toBeNull()
    })
  })

  it('keeps the local snapshot when the background fetch and PR refresh reject', async () => {
    const gitFetchForStatus = vi.fn(async () => { throw new Error('fetch ipc dropped') })
    const gitReadPullRequest = vi.fn(async () => { throw new Error('pr ipc dropped') })
    mount({
      cwd: '/work',
      git: status({ refName: 'feature/keep' }),
      gitFetchForStatus,
      gitReadPullRequest,
    })
    const trigger = await screen.findByRole('button', { name: 'Switch branch' })
    await waitFor(() => { expect(gitFetchForStatus).toHaveBeenCalled() })
    await waitFor(() => { expect(gitReadPullRequest).toHaveBeenCalled() })
    expect(trigger.textContent).toContain('feature/keep')
    expect(screen.queryByRole('status', { name: 'Action failed' })).toBeNull()
  })

  it('labels the main button Commit & push when the default ref has local changes', async () => {
    mount({
      cwd: '/work',
      git: status({
        refName: 'main',
        hasWorkingTreeChanges: true,
        isDefaultRef: true,
      }),
    })
    expect((await screen.findByRole<HTMLButtonElement>('button', { name: 'Commit & push' })).disabled).toBe(false)
  })

  it('labels the main button Push when the default ref is clean and ahead', async () => {
    mount({
      cwd: '/work',
      git: status({
        refName: 'main',
        aheadCount: 2,
        isDefaultRef: true,
      }),
    })
    expect((await screen.findByRole<HTMLButtonElement>('button', { name: 'Push' })).disabled).toBe(false)
  })

  it('opens a menu with Commit, Push, and Create PR', async () => {
    mount({
      cwd: '/work',
      git: status({ aheadCount: 2 }),
    })
    await screen.findByRole('button', { name: 'Push & create PR' })
    fireEvent.click(screen.getByRole('button', { name: 'Git actions' }))
    expect(await screen.findByRole('menuitem', { name: 'Commit' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Push' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Create PR' })).toBeTruthy()
  })

  it('shows why a disabled menu row is unavailable and a behind-upstream footer', async () => {
    mount({ cwd: '/work', git: status({ behindCount: 1 }) })
    fireEvent.click(await screen.findByRole('button', { name: 'Git actions' }))
    const push = await screen.findByRole('menuitem', { name: 'Push' })
    expect(push).toHaveProperty('disabled', true)
    fireEvent.mouseEnter(push.parentElement!)
    expect((await screen.findByRole('tooltip')).textContent).toBe(
      'Branch is behind upstream. Pull/rebase before pushing.',
    )
    expect(screen.getByText('Behind upstream. Pull/rebase first.')).toBeTruthy()
  })

  it('shows the detached HEAD menu footer', async () => {
    mount({ cwd: '/work', git: status({ refName: null }) })
    fireEvent.click(await screen.findByRole('button', { name: 'Git actions' }))
    expect(await screen.findByText(
      'Detached HEAD: create and checkout a branch to enable push and pull request actions.',
    )).toBeTruthy()
  })

  it('asks for confirmation before pushing on the default ref', async () => {
    const b = mount({
      cwd: '/work',
      git: status({
        refName: 'main',
        aheadCount: 2,
        isDefaultRef: true,
      }),
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Push' }))
    expect(await screen.findByRole('dialog', { name: 'Push to default ref?' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Checkout feature branch & continue' })).toBeNull()
    expect(screen.getByText(
      'This action will push local commits on "main". You can continue on this ref or create a feature ref and run the same action there.',
    )).toBeTruthy()
    expect(b.gitPush).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Push to main' }))
    await waitFor(() => { expect(b.gitPush).toHaveBeenCalledWith('/work', expect.any(Number)) })
  })

  it('keeps a stable hook count and hides stale Git controls when cwd changes', async () => {
    let resolveOther!: (value: VcsStatus) => void
    const gitStatus = vi.fn((target: string) => target === '/other'
      ? new Promise<VcsStatus>(resolve => { resolveOther = resolve })
      : Promise.resolve(status({ aheadCount: 2 })))
    const shared = {
      ...allowAllAccess,
      surfaces: 0,
      terminalDrawer: 0,
      managedSession: false,
      usePanelInfo: panelInfoStub,
      useResource: resourceStub,
      useWorkspaces: neverWorkspaces,
      useSessionStatus: sel => sel(new Map()),
      useSessionRetainInfo: () => undefined,
      gitStatus,
      gitFetchForStatus: vi.fn(async () => status({ aheadCount: 2 })),
      gitReadPullRequest: vi.fn(async () => ({ ok: true, pr: null })),
      gitInit: vi.fn(async () => ({ ok: true })),
      gitCommit: vi.fn(async () => ({ ok: true })),
      gitCheckLargeFiles: vi.fn(async () => ({ ok: true, files: [] })),
      gitPush: vi.fn(async () => ({ ok: true })),
      gitPull: vi.fn(async () => ({ ok: true })),
      gitCreateChangeRequest: vi.fn(async () => ({ ok: true })),
      gitPublishRepository: vi.fn(async () => ({ ok: true })),
      gitBranchList: vi.fn(async () => ({ ok: true, branches: [] })),
      gitSwitchBranch: vi.fn(async () => ({ ok: true })),
      gitCreateBranch: vi.fn(async () => ({ ok: true })),
      onGitProgress: vi.fn(() => () => {}),
      onWorkspacesChanged: vi.fn(() => () => {}),
      rightbarShown: false,
      openExternal: vi.fn(async () => true),
      openWorkspacePath: vi.fn(async () => ({ ok: true })),
      useTitlebarGit: sel => sel(true),
      t,
    } satisfies Omit<GitActionsProps, 'useSessions'>
    const { rerender } = render(
      <GitActionsControl {...shared} useSessions={useSessionsStub(sessionList(undefined))} />,
    )
    expect(screen.queryByRole('button', { name: 'Commit' })).toBeNull()
    expect(gitStatus).not.toHaveBeenCalled()
    rerender(
      <GitActionsControl {...shared} useSessions={useSessionsStub(sessionList('/work'))} />,
    )
    expect(await screen.findByRole('button', { name: 'Push & create PR' })).toBeTruthy()
    rerender(
      <GitActionsControl {...shared} useSessions={useSessionsStub(sessionList('/other'))} />,
    )
    expect(screen.queryByRole('button', { name: 'Git actions' })).toBeNull()
    await act(async () => { resolveOther(status({ refName: 'other' })) })
    expect(await screen.findByRole('button', { name: 'Git actions' })).toBeTruthy()
  })

  it('shows the IPC failure on the same progress toast', async () => {
    const gitPush = vi.fn(async () => ({ ok: false, message: 'origin rejected the push.' }))
    mount({
      cwd: '/work',
      git: status({
        refName: 'main',
        aheadCount: 2,
        isDefaultRef: true,
      }),
      gitPush,
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Push' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Push to main' }))
    expect(await screen.findByRole('status', { name: 'Action failed' })).toBeTruthy()
    expect(screen.getByText('origin rejected the push.')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Action failed' })).toBeNull()
  })

  it('lands a rejected stacked IPC promise on the toast instead of stranding it loading', async () => {
    const gitPush = vi.fn(async () => { throw new Error('ipc channel dropped') })
    mount({
      cwd: '/work',
      git: status({
        refName: 'main',
        aheadCount: 2,
        isDefaultRef: true,
      }),
      gitPush,
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Push' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Push to main' }))
    expect(await screen.findByRole('status', { name: 'Action failed' })).toBeTruthy()
    expect(screen.getByText('ipc channel dropped')).toBeTruthy()
  })

  it('shows a rejected gitInit on the toast', async () => {
    const gitInit = vi.fn(async () => { throw new Error('init ipc dropped') })
    mount({ cwd: '/work', git: status({ isRepo: false }), gitInit })
    fireEvent.click(await screen.findByRole('button', { name: 'Initialize Git' }))
    expect(await screen.findByRole('status', { name: 'Action failed' })).toBeTruthy()
    expect(screen.getByText('init ipc dropped')).toBeTruthy()
  })

  it('shows a rejected gitPull on the toast', async () => {
    const gitPull = vi.fn(async () => { throw new Error('pull ipc dropped') })
    mount({ cwd: '/work', git: status({ behindCount: 2 }), gitPull })
    fireEvent.click(await screen.findByRole('button', { name: 'Pull' }))
    expect(await screen.findByRole('status', { name: 'Action failed' })).toBeTruthy()
    expect(screen.getByText('pull ipc dropped')).toBeTruthy()
  })

  it('reopens the publish dialog when the publish IPC rejects', async () => {
    const gitPublishRepository = vi.fn(async () => { throw new Error('publish ipc dropped') })
    mount({
      cwd: '/work',
      git: status({
        hasUpstream: false,
        hasPrimaryRemote: false,
      }),
      gitPublishRepository,
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Publish repository' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }))
    expect(await screen.findByRole('status', { name: 'Action failed' })).toBeTruthy()
    expect(screen.getByText('publish ipc dropped')).toBeTruthy()
    expect(await screen.findByRole('dialog', { name: 'Publish repository' })).toBeTruthy()
  })

  it('recovers from an unauthorized first status read when the workspace registry signals', async () => {
    let notify: (() => void) | undefined
    const onWorkspacesChanged = vi.fn((handler: () => void) => {
      notify = handler
      return () => { notify = undefined }
    })
    // First read races the harness registry write and comes back null; after
    // the registration lands, the same cwd resolves.
    let registered = false
    const gitStatus = vi.fn(async () => (registered ? status({ refName: 'feature/late' }) : null))
    const gitFetchForStatus = vi.fn(async () => (registered ? status({ refName: 'feature/late' }) : null))
    mount({ cwd: '/work', gitStatus, gitFetchForStatus, onWorkspacesChanged })
    await waitFor(() => { expect(gitStatus).toHaveBeenCalled() })
    expect(screen.queryByRole('button', { name: 'Commit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Switch branch' })?.textContent ?? '').not.toContain('feature/late')
    registered = true
    act(() => { notify?.() })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Switch branch' }).textContent).toContain('feature/late')
    })
  })

  it('unsubscribes from the registry signal when the session cwd goes away', async () => {
    const unsubscribe = vi.fn()
    const onWorkspacesChanged = vi.fn(() => unsubscribe)
    const b = mount({ cwd: '/work', git: status(), onWorkspacesChanged })
    await screen.findByRole('button', { name: 'Switch branch' })
    expect(onWorkspacesChanged).toHaveBeenCalledTimes(1)
    b.rerender(
      <GitActionsControl
        {...allowAllAccess}
        usePanelInfo={panelInfoStub}
        useResource={resourceStub}
        surfaces={0}
        rightbarShown={false}
        terminalDrawer={0}
        managedSession={false}
        useSessions={useSessionsStub(sessionList(undefined))}
        useSessionStatus={sel => sel(new Map())}
        useSessionRetainInfo={() => undefined}
        useWorkspaces={neverWorkspaces}
        gitStatus={b.gitStatus}
        gitFetchForStatus={b.gitFetchForStatus}
        gitReadPullRequest={b.gitReadPullRequest}
        gitInit={b.gitInit}
        gitCommit={b.gitCommit}
        gitCheckLargeFiles={b.gitCheckLargeFiles}
        gitPush={b.gitPush}
        gitPull={b.gitPull}
        gitCreateChangeRequest={b.gitCreateChangeRequest}
        gitPublishRepository={b.gitPublishRepository}
        gitBranchList={b.gitBranchList}
        gitSwitchBranch={b.gitSwitchBranch}
        gitCreateBranch={b.gitCreateBranch}
        onGitProgress={b.onGitProgress}
        onWorkspacesChanged={onWorkspacesChanged}
        openExternal={b.openExternal}
        openWorkspacePath={b.openWorkspacePath}
        useTitlebarGit={sel => sel(true)}
        t={t}
      />,
    )
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('refreshes git status on window focus', async () => {
    const gitStatus = vi.fn(async () => status({ aheadCount: 2 }))
    mount({ cwd: '/work', gitStatus })
    await waitFor(() => { expect(gitStatus).toHaveBeenCalledTimes(1) })
    fireEvent(window, new Event('focus'))
    await waitFor(() => { expect(gitStatus).toHaveBeenCalledTimes(2) }, { timeout: 1000 })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    fireEvent(document, new Event('visibilitychange'))
    await waitFor(() => { expect(gitStatus).toHaveBeenCalledTimes(3) }, { timeout: 1000 })
  })

  it('opens the publish dialog and submits gh repo create', async () => {
    const gitPublishRepository = vi.fn(async () => ({ ok: true, url: 'https://github.com/org/work' }))
    mount({
      cwd: '/work',
      git: status({
        hasUpstream: false,
        hasPrimaryRemote: false,
      }),
      gitPublishRepository,
    })
    const main = await screen.findByRole<HTMLButtonElement>('button', { name: 'Publish repository' })
    expect(main.disabled).toBe(false)
    fireEvent.click(main)
    expect(await screen.findByRole('dialog', { name: 'Publish repository' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect(screen.queryByRole('dialog', { name: 'Publish repository' })).toBeNull()
    await waitFor(() => {
      expect(gitPublishRepository).toHaveBeenCalledWith('/work', {
        name: 'work',
        visibility: 'private',
      }, expect.any(Number))
    })
  })

  it('closes the publish dialog while publishing and reopens it on failure', async () => {
    let finish = (value: { ok: boolean; message?: string }) => { void value }
    const gitPublishRepository = vi.fn(() => new Promise<{ ok: boolean; message?: string }>((resolve) => {
      finish = resolve
    }))
    mount({
      cwd: '/work',
      git: status({
        hasUpstream: false,
        hasPrimaryRemote: false,
      }),
      gitPublishRepository,
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Publish repository' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }))
    expect(screen.queryByRole('dialog', { name: 'Publish repository' })).toBeNull()
    expect(screen.getByRole('status', { name: 'Publishing repository...' })).toBeTruthy()
    finish({ ok: false, message: 'gh is unavailable.' })
    expect(await screen.findByRole('status', { name: 'Action failed' })).toBeTruthy()
    expect(await screen.findByRole('dialog', { name: 'Publish repository' })).toBeTruthy()
  })

  it('offers Publish repository in the menu when there is no origin', async () => {
    mount({
      cwd: '/work',
      git: status({
        hasWorkingTreeChanges: true,
        hasUpstream: false,
        hasPrimaryRemote: false,
      }),
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Git actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Publish repository' }))
    expect(await screen.findByRole('dialog', { name: 'Publish repository' })).toBeTruthy()
  })

  it('keeps a PR failure on the toast after a successful push', async () => {
    const gitCommit = vi.fn(async () => ({ ok: true, commitSha: 'abc', subject: 'Add files' }))
    const gitPush = vi.fn(async () => ({ ok: true, status: 'pushed', branch: 'feature/test' }))
    const gitCreateChangeRequest = vi.fn(async () => ({ ok: false, message: 'gh is unavailable.' }))
    mount({
      cwd: '/work',
      git: status({ hasWorkingTreeChanges: true }),
      gitCommit,
      gitPush,
      gitCreateChangeRequest,
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Commit, push & PR' }))
    expect(await screen.findByRole('status', { name: 'Action failed' })).toBeTruthy()
    expect(screen.getByText('gh is unavailable.')).toBeTruthy()
    expect(gitCreateChangeRequest).toHaveBeenCalledWith('/work', {}, expect.any(Number))
  })

  it('shows Initialize Git when the cwd is not a repository', async () => {
    mount({
      cwd: '/work',
      git: status({
        isRepo: false,
        refName: null,
        hasPrimaryRemote: false,
      }),
    })
    expect(await screen.findByRole('button', { name: 'Initialize Git' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Git actions' })).toBeNull()
  })

  it('hides the branch ref name at compact density', async () => {
    mount({ cwd: '/work', git: status({ refName: 'master' }), density: 'compact' })
    const trigger = await screen.findByRole('button', { name: 'Switch branch' })
    expect(trigger.textContent).not.toContain('master')
    expect(screen.getByRole('button', { name: 'Commit' }).textContent).toContain('Commit')
  })

  it('hides Initialize Git text at compact density', async () => {
    mount({
      cwd: '/work',
      git: status({ isRepo: false, refName: null, hasPrimaryRemote: false }),
      density: 'compact',
    })
    const init = await screen.findByRole('button', { name: 'Initialize Git' })
    expect(init.textContent).not.toContain('Initialize Git')
  })

  it('runs gitInit when Initialize Git is clicked and broadcasts dshd-git-init', async () => {
    const gitInit = vi.fn(async () => ({ ok: true }))
    const gitStatus = vi.fn()
      .mockResolvedValueOnce(status({ isRepo: false, refName: null, hasPrimaryRemote: false }))
      .mockResolvedValue(status({ isRepo: true, hasWorkingTreeChanges: true }))
    const onInitBroadcast = vi.fn()
    window.addEventListener('dshd-git-init', onInitBroadcast)
    mount({ cwd: '/work', gitStatus, gitInit })
    fireEvent.click(await screen.findByRole('button', { name: 'Initialize Git' }))
    await waitFor(() => { expect(gitInit).toHaveBeenCalledWith('/work') })
    await waitFor(() => { expect(gitStatus).toHaveBeenCalledTimes(2) })
    // ui-surfaces listens for this to reopen the Diff gate without a session switch.
    expect(onInitBroadcast).toHaveBeenCalledOnce()
    window.removeEventListener('dshd-git-init', onInitBroadcast)
  })

  it('shows Initializing and the IPC failure when gitInit fails', async () => {
    let finish: (result: { ok: boolean; message: string }) => void = () => {}
    const gitInit = vi.fn(() => new Promise<{ ok: boolean; message: string }>((resolve) => {
      finish = resolve
    }))
    mount({
      cwd: '/work',
      git: status({ isRepo: false, refName: null, hasPrimaryRemote: false }),
      gitInit,
    })
    const onInitBroadcast = vi.fn()
    window.addEventListener('dshd-git-init', onInitBroadcast)
    fireEvent.click(await screen.findByRole('button', { name: 'Initialize Git' }))
    expect(await screen.findByRole('status', { name: 'Initializing...' })).toBeTruthy()
    finish({ ok: false, message: 'cannot init' })
    expect(await screen.findByRole('status', { name: 'Action failed' })).toBeTruthy()
    expect(screen.getByText('cannot init')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Action failed' })).toBeNull()
    expect(onInitBroadcast).not.toHaveBeenCalled()
    window.removeEventListener('dshd-git-init', onInitBroadcast)
  })

  it('labels the main button Pull when the ref is behind', async () => {
    mount({ cwd: '/work', git: status({ behindCount: 1 }) })
    expect((await screen.findByRole<HTMLButtonElement>('button', { name: 'Pull' })).disabled).toBe(false)
  })

  it('labels the main button View PR when an open change request exists', async () => {
    mount({
      cwd: '/work',
      git: status({
        pr: {
          number: 1,
          title: 'x',
          url: 'https://example.com/1',
          baseRef: 'main',
          headRef: 'feature/test',
          state: 'open',
        },
      }),
    })
    expect(await screen.findByRole('button', { name: 'View PR' })).toBeTruthy()
  })

  it('toasts when View PR has no URL from the menu or the main button', async () => {
    const missingUrl = status({
      pr: {
        number: 1,
        title: 'x',
        url: '',
        baseRef: 'main',
        headRef: 'feature/test',
        state: 'open',
      },
    })
    mount({ cwd: '/work', git: missingUrl })
    fireEvent.click(await screen.findByRole('button', { name: 'View PR' }))
    expect(await screen.findByRole('status', { name: 'Action failed' })).toBeTruthy()
    expect(screen.getByText('No open PR URL.')).toBeTruthy()
  })

  it('labels the main button Sync branch when the ref has diverged', async () => {
    mount({ cwd: '/work', git: status({ aheadCount: 1, behindCount: 1 }) })
    const main = await screen.findByRole<HTMLButtonElement>('button', { name: 'Sync branch' })
    expect(main.disabled).toBe(true)
  })

  it('labels the main button Commit, push & PR on a feature ref with local changes', async () => {
    mount({ cwd: '/work', git: status({ hasWorkingTreeChanges: true }) })
    expect(await screen.findByRole('button', { name: 'Commit, push & PR' })).toBeTruthy()
  })

  it('still runs gitCommit for Commit, push & PR when live porcelain looks clean', async () => {
    const preview = status({ hasWorkingTreeChanges: true })
    const live = status({ hasWorkingTreeChanges: false, aheadCount: 1 })
    const gitStatus = vi.fn(async () => live)
    const gitCommit = vi.fn(async () => ({ ok: true, skipped: true, status: 'skipped' }))
    const gitPush = vi.fn(async () => ({ ok: true, status: 'pushed' }))
    const gitCreateChangeRequest = vi.fn(async () => ({
      ok: true,
      status: 'created',
      url: 'https://github.com/acme/demo/pull/1',
    }))
    mount({ cwd: '/work', git: preview, gitStatus, gitCommit, gitPush, gitCreateChangeRequest })
    fireEvent.click(await screen.findByRole('button', { name: 'Commit, push & PR' }))
    await waitFor(() => { expect(gitCommit).toHaveBeenCalled() })
    expect(gitPush).toHaveBeenCalled()
    expect(gitCreateChangeRequest).toHaveBeenCalled()
  })

  it('commit dialog file list follows live status.workingTree while open', async () => {
    let files = [{ path: 'a.ts', insertions: 1, deletions: 0 }]
    const gitStatus = vi.fn(async () => status({
      hasWorkingTreeChanges: true,
      workingTree: filesTree(files),
    }))
    mount({ cwd: '/work', gitStatus })
    fireEvent.click(await screen.findByRole('button', { name: 'Git actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Commit' }))
    expect(await screen.findByRole('dialog', { name: 'Commit changes' })).toBeTruthy()
    expect(screen.getByText('a.ts')).toBeTruthy()
    files = [{ path: 'b.ts', insertions: 2, deletions: 0 }]
    fireEvent(window, new Event('focus'))
    await waitFor(() => {
      expect(screen.getByText('b.ts')).toBeTruthy()
    })
    expect(screen.queryByText('a.ts')).toBeNull()
  })

  it('opens the commit review dialog from status.workingTree files', async () => {
    const gitCommit = vi.fn(async () => ({ ok: true }))
    mount({
      cwd: '/work',
      git: status({
        hasWorkingTreeChanges: true,
        refName: 'large-bird',
        workingTree: {
          files: [{ path: 'src/demo.ts', insertions: 2, deletions: 1 }],
          insertions: 2,
          deletions: 1,
        },
      }),
      gitCommit,
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Git actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Commit' }))
    expect(await screen.findByRole('dialog', { name: 'Commit changes' })).toBeTruthy()
    expect(screen.getAllByText('large-bird').length).toBeGreaterThan(0)
    expect(screen.getByText('src/demo.ts')).toBeTruthy()
    expect(screen.getAllByText('+2').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }))
    await waitFor(() => { expect(gitCommit).toHaveBeenCalledWith('/work', '', undefined, expect.any(Number), undefined) })
  })

  it('creates a feature ref before commit when Commit on new branch is used', async () => {
    const gitBranchList = vi.fn(async () => ({
      ok: true,
      branches: [{ name: 'main', isRemote: false, isCurrent: false }],
    }))
    const gitCreateBranch = vi.fn(async () => ({ ok: true, refName: 'feature/update' }))
    const gitCommit = vi.fn(async () => ({ ok: true }))
    mount({
      cwd: '/work',
      git: status({
        hasWorkingTreeChanges: true,
        refName: 'main',
        isDefaultRef: true,
        workingTree: filesTree([{ path: 'a.ts', insertions: 1, deletions: 0 }]),
      }),
      gitBranchList,
      gitCreateBranch,
      gitCommit,
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Git actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Commit' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Commit on new branch' }))
    await waitFor(() => {
      expect(gitCommit).toHaveBeenCalledWith('/work', '', undefined, expect.any(Number), { featureBranch: true })
    })
    expect(gitCreateBranch).not.toHaveBeenCalled()
  })

  it('opens the commit review dialog from the Commit-only main button', async () => {
    mount({
      cwd: '/work',
      git: status({
        hasWorkingTreeChanges: true,
        hasUpstream: false,
        hasPrimaryRemote: false,
        workingTree: filesTree([{ path: 'only.ts', insertions: 1, deletions: 0 }]),
      }),
    })
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Commit' }).disabled).toBe(false)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }))
    expect(await screen.findByRole('dialog', { name: 'Commit changes' })).toBeTruthy()
    expect(screen.getByText('only.ts')).toBeTruthy()
  })

  it('opens the commit dialog with none when workingTree has no files', async () => {
    mount({
      cwd: '/work',
      git: status({ hasWorkingTreeChanges: true }),
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Git actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Commit' }))
    expect(await screen.findByRole('dialog', { name: 'Commit changes' })).toBeTruthy()
    expect(screen.getByText('none')).toBeTruthy()
  })

  it('commits only the files that remain selected after Edit', async () => {
    const gitCommit = vi.fn(async () => ({ ok: true }))
    mount({
      cwd: '/work',
      git: status({
        hasWorkingTreeChanges: true,
        refName: 'large-bird',
        workingTree: filesTree([
          { path: 'keep.ts', insertions: 1, deletions: 0 },
          { path: 'skip.ts', insertions: 2, deletions: 0 },
        ]),
      }),
      gitCommit,
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Git actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Commit' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Files' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Files' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'skip.ts' }))
    fireEvent.change(screen.getByPlaceholderText('Leave empty to auto-generate'), {
      target: { value: 'keep only' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }))
    await waitFor(() => {
      expect(gitCommit).toHaveBeenCalledWith('/work', 'keep only', ['keep.ts'], expect.any(Number), undefined)
    })
  })

  it('passes featureBranch into gitCommit for Commit on new branch', async () => {
    const gitCommit = vi.fn(async () => ({ ok: false, message: 'cannot create ref.' }))
    mount({
      cwd: '/work',
      git: status({
        hasWorkingTreeChanges: true,
        workingTree: filesTree([{ path: 'a.ts', insertions: 1, deletions: 0 }]),
      }),
      gitCommit,
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Git actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Commit' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Commit on new branch' }))
    expect(await screen.findByRole('status', { name: 'Action failed' })).toBeTruthy()
    expect(screen.getByText('cannot create ref.')).toBeTruthy()
    expect(gitCommit).toHaveBeenCalledWith('/work', '', undefined, expect.any(Number), { featureBranch: true })
  })

  it('shows a live progress toast as soon as Commit, push & PR starts', async () => {
    const initial = status({ hasWorkingTreeChanges: true })
    let resolveLive: (value: VcsStatus | null) => void = () => {}
    let statusCalls = 0
    const gitStatus = vi.fn(() => {
      statusCalls += 1
      if (statusCalls === 1) return Promise.resolve(initial)
      return new Promise<VcsStatus | null>((resolve) => {
        resolveLive = resolve
      })
    })
    const gitCommit = vi.fn(async () => ({ ok: false, message: 'lefthook failed\noxfmt --check' }))
    mount({
      cwd: '/work',
      git: initial,
      gitStatus,
      gitCommit,
    })
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Commit, push & PR' }).disabled).toBe(false)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Commit, push & PR' }))
    expect(await screen.findByRole('status', { name: 'Generating commit message...' })).toBeTruthy()
    expect(screen.getByText('Waiting for Git...')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Action failed' })).toBeNull()
    expect(gitCommit).not.toHaveBeenCalled()
    resolveLive(initial)
    expect(await screen.findByRole('status', { name: 'Action failed' })).toBeTruthy()
    expect(screen.getByText('lefthook failed')).toBeTruthy()
  })

  it('replaces the loading toast with hook output from onGitProgress', async () => {
    let send: ((event: {
      actionId: number
      kind: string
      title?: string
      text?: string
    }) => void) | undefined
    const onGitProgress = vi.fn((handler: (event: {
      actionId: number
      kind: string
      title?: string
      text?: string
    }) => void) => {
      send = handler
      return () => {}
    })
    let finish: (result: { ok: boolean }) => void = () => {}
    const gitCommit = vi.fn((
      _cwd: string,
      _message: string,
      _filePaths: readonly string[] | undefined,
      _actionId: number | undefined,
      _options?: { featureBranch?: boolean } | undefined,
    ) => new Promise<{ ok: boolean }>((resolve) => {
      finish = resolve
    }))
    const gitPush = vi.fn(async () => ({ ok: true }))
    const gitCreateChangeRequest = vi.fn(async () => ({ ok: true }))
    mount({
      cwd: '/work',
      git: status({ hasWorkingTreeChanges: true }),
      gitCommit,
      gitPush,
      gitCreateChangeRequest,
      onGitProgress,
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Commit, push & PR' }))
    await waitFor(() => { expect(gitCommit).toHaveBeenCalled() })
    const actionId = gitCommit.mock.calls[0]?.[3] as number
    send?.({ actionId, kind: 'hook', title: 'Running pre-commit...', text: 'lefthook v2.1.10' })
    expect(await screen.findByText('Running pre-commit...')).toBeTruthy()
    expect(screen.getByText('lefthook v2.1.10')).toBeTruthy()
    send?.({ actionId, kind: 'hook_finished', title: 'Finished pre-commit', text: 'pre-commit finished' })
    expect(await screen.findByText('Generating commit message...')).toBeTruthy()
    expect(screen.queryByText('pre-commit finished')).toBeNull()
    finish({ ok: true })
    expect(await screen.findByRole('status', { name: 'Created PR' })).toBeTruthy()
  })

  it('creates a feature ref from the default-ref confirm when the action includes a commit', async () => {
    let phase: 'before' | 'after' = 'before'
    const before = status({
      refName: 'main',
      hasWorkingTreeChanges: true,
      isDefaultRef: true,
    })
    const after = status({
      refName: 'feature/add-files',
      hasWorkingTreeChanges: false,
      isDefaultRef: false,
      hasUpstream: true,
      aheadCount: 0,
    })
    const gitStatus = vi.fn(async () => (phase === 'before' ? before : after))
    const gitFetchForStatus = vi.fn(async () => (phase === 'before' ? before : after))
    const gitReadPullRequest = vi.fn(async () => ({ ok: true, pr: null }))
    const gitCommit = vi.fn(async () => {
      phase = 'after'
      return { ok: true, commitSha: 'abcdef1', subject: 'Add files' }
    })
    const gitPush = vi.fn(async () => ({
      ok: true,
      status: 'pushed',
      upstreamBranch: 'origin/feature/add-files',
    }))
    mount({
      cwd: '/work',
      gitStatus,
      gitFetchForStatus,
      gitReadPullRequest,
      gitCommit,
      gitPush,
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Commit & push' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Checkout feature branch & continue' }))
    await waitFor(() => {
      expect(gitCommit).toHaveBeenCalledWith('/work', '', undefined, expect.any(Number), { featureBranch: true })
    })
    expect(await screen.findByRole('button', { name: 'Create PR' })).toBeTruthy()
  })

  it('shows a commit-only success toast without waiting for fetch', async () => {
    const gitCommit = vi.fn(async () => ({ ok: true, commitSha: 'abc1234', subject: 'Add files' }))
    const initial = status({
      hasWorkingTreeChanges: true,
      hasUpstream: false,
      hasPrimaryRemote: false,
      workingTree: filesTree([{ path: 'only.ts', insertions: 1, deletions: 0 }]),
    })
    let fetchCalls = 0
    const gitFetchForStatus = vi.fn(async () => {
      fetchCalls += 1
      if (fetchCalls === 1) return initial
      return new Promise<VcsStatus | null>(() => {})
    })
    mount({
      cwd: '/work',
      git: initial,
      gitCommit,
      gitFetchForStatus,
    })
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Commit' }).disabled).toBe(false)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Commit changes' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Commit' }))
    expect(await screen.findByRole('status', { name: 'Committed abc1234' })).toBeTruthy()
  })

  it('shows switch failure on the progress toast', async () => {
    const gitBranchList = vi.fn(async () => ({
      ok: true,
      branches: [
        { name: 'feature/test', isRemote: false, isCurrent: true },
        { name: 'main', isRemote: false, isCurrent: false },
      ],
    }))
    const gitSwitchBranch = vi.fn(async () => ({ ok: false, message: 'checkout failed' }))
    mount({
      cwd: '/work',
      git: status({ hasWorkingTreeChanges: true }),
      gitBranchList,
      gitSwitchBranch,
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Switch branch' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'main' }))
    expect(await screen.findByRole('status', { name: 'Failed to switch branch.' })).toBeTruthy()
    expect(screen.getByText('checkout failed')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Action failed' })).toBeNull()
  })

  it('shows an open-file failure on the progress toast', async () => {
    const openWorkspacePath = vi.fn(async () => ({ ok: false, message: 'no handler' }))
    mount({
      cwd: '/work',
      git: status({
        hasWorkingTreeChanges: true,
        workingTree: filesTree([{ path: 'only.ts', insertions: 1, deletions: 0 }]),
      }),
      openWorkspacePath,
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Git actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Commit' }))
    fireEvent.click(await screen.findByRole('button', { name: 'only.ts' }))
    expect(await screen.findByRole('status', { name: 'Unable to open file' })).toBeTruthy()
    expect(screen.getByText('no handler')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Action failed' })).toBeNull()
  })

  it('shows a rejected open-file IPC promise on the progress toast', async () => {
    const openWorkspacePath = vi.fn(async () => { throw new Error('open ipc dropped') })
    mount({
      cwd: '/work',
      git: status({
        hasWorkingTreeChanges: true,
        workingTree: filesTree([{ path: 'only.ts', insertions: 1, deletions: 0 }]),
      }),
      openWorkspacePath,
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Git actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Commit' }))
    fireEvent.click(await screen.findByRole('button', { name: 'only.ts' }))
    expect(await screen.findByRole('status', { name: 'Unable to open file' })).toBeTruthy()
    expect(screen.getByText('open ipc dropped')).toBeTruthy()
  })

  it('disables the branch picker while a stacked action is running', async () => {
    const pending = Promise.withResolvers<{ ok: boolean }>()
    const gitPush = vi.fn(() => pending.promise)
    mount({
      cwd: '/work',
      git: status({
        refName: 'main',
        aheadCount: 2,
        isDefaultRef: true,
      }),
      gitPush,
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Push' }))
    fireEvent.click(screen.getByRole('button', { name: 'Push to main' }))
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Switch branch' }).disabled).toBe(true)
    })
    pending.resolve({ ok: true })
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Switch branch' }).disabled).toBe(false)
    })
  })

  it('hides and restores the titlebar cluster from the live Interface preference', async () => {
    const titlebarGit = createSnapshotStore(true)
    mount({
      cwd: '/work',
      git: status(),
      useTitlebarGit: sel => useSyncExternalStore(titlebarGit.subscribe, () => sel(titlebarGit.getSnapshot())),
    })
    expect(await screen.findByRole('button', { name: 'Commit' })).toBeTruthy()
    act(() => { titlebarGit.set(false) })
    expect(screen.queryByRole('button', { name: 'Commit' })).toBeNull()
    act(() => { titlebarGit.set(true) })
    expect(screen.getByRole('button', { name: 'Commit' })).toBeTruthy()
  })

  it('keeps the init toast after Interface settings hide the cluster', async () => {
    const titlebarGit = createSnapshotStore(true)
    let finish: (result: { ok: boolean; message: string }) => void = () => {}
    const gitInit = vi.fn(() => new Promise<{ ok: boolean; message: string }>((resolve) => {
      finish = resolve
    }))
    mount({
      cwd: '/work',
      git: status({ isRepo: false, refName: null, hasPrimaryRemote: false }),
      gitInit,
      useTitlebarGit: sel => useSyncExternalStore(titlebarGit.subscribe, () => sel(titlebarGit.getSnapshot())),
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Initialize Git' }))
    expect(await screen.findByRole('status', { name: 'Initializing...' })).toBeTruthy()
    act(() => { titlebarGit.set(false) })
    expect(screen.queryByRole('button', { name: 'Initialize Git' })).toBeNull()
    expect(screen.getByRole('status', { name: 'Initializing...' })).toBeTruthy()
    finish({ ok: false, message: 'cannot init' })
    expect(await screen.findByRole('status', { name: 'Action failed' })).toBeTruthy()
  })

  it('keeps the commit dialog after Interface settings hide the cluster', async () => {
    const titlebarGit = createSnapshotStore(true)
    mount({
      cwd: '/work',
      gitStatus: vi.fn(async () => status({
        hasWorkingTreeChanges: true,
        workingTree: filesTree([{ path: 'a.ts', insertions: 1, deletions: 0 }]),
      })),
      useTitlebarGit: sel => useSyncExternalStore(titlebarGit.subscribe, () => sel(titlebarGit.getSnapshot())),
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Git actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Commit' }))
    expect(await screen.findByRole('dialog', { name: 'Commit changes' })).toBeTruthy()
    act(() => { titlebarGit.set(false) })
    expect(screen.queryByRole('button', { name: 'Git actions' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Commit changes' })).toBeTruthy()
  })

  it('warns about oversized commit candidates when the dialog opens', async () => {
    const b = mount({
      cwd: '/work',
      git: status({
        hasWorkingTreeChanges: true,
        workingTree: filesTree([{ path: 'video.bin', insertions: 0, deletions: 0 }]),
      }),
      gitCheckLargeFiles: vi.fn(async () => ({ ok: true, files: [{ path: 'video.bin', size: 101 * 1024 * 1024 }] })),
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Git actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Commit' }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('video.bin')).toBeTruthy()
    expect(b.gitCheckLargeFiles).toHaveBeenCalledWith('/work')
  })

  it('drops the warning once the user excludes the oversized file from the commit', async () => {
    mount({
      cwd: '/work',
      git: status({
        hasWorkingTreeChanges: true,
        workingTree: filesTree([
          { path: 'video.bin', insertions: 0, deletions: 0 },
          { path: 'small.ts', insertions: 1, deletions: 0 },
        ]),
      }),
      gitCheckLargeFiles: vi.fn(async () => ({ ok: true, files: [{ path: 'video.bin', size: 101 * 1024 * 1024 }] })),
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Git actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Commit' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'video.bin' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('still warns for an oversized file inside a collapsed untracked directory', async () => {
    // `git status` collapses a brand-new directory to `dir/`, so the warning
    // path never equals a dialog row and must match by prefix instead.
    mount({
      cwd: '/work',
      git: status({
        hasWorkingTreeChanges: true,
        workingTree: filesTree([{ path: 'assets/', insertions: 0, deletions: 0 }]),
      }),
      gitCheckLargeFiles: vi.fn(async () => ({
        ok: true,
        files: [{ path: 'assets/video.bin', size: 101 * 1024 * 1024 }],
      })),
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Git actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Commit' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('assets/video.bin')).toBeTruthy()
  })

  it('does not warn about a large file that is not part of the commit', async () => {
    mount({
      cwd: '/work',
      git: status({
        hasWorkingTreeChanges: true,
        workingTree: filesTree([{ path: 'small.ts', insertions: 1, deletions: 0 }]),
      }),
      gitCheckLargeFiles: vi.fn(async () => ({ ok: true, files: [{ path: 'elsewhere.bin', size: 101 * 1024 * 1024 }] })),
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Git actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Commit' }))
    expect(await screen.findByRole('dialog', { name: 'Commit changes' })).toBeTruthy()
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
  })

  it('shows no warning when the large-file scan fails and keeps the dialog usable', async () => {
    const gitCheckLargeFiles = vi.fn(async () => { throw new Error('scan ipc dropped') })
    const gitCommit = vi.fn(async () => ({ ok: true }))
    mount({
      cwd: '/work',
      git: status({
        hasWorkingTreeChanges: true,
        workingTree: filesTree([{ path: 'small.ts', insertions: 1, deletions: 0 }]),
      }),
      gitCheckLargeFiles,
      gitCommit,
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Git actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Commit' }))
    expect(await screen.findByRole('dialog', { name: 'Commit changes' })).toBeTruthy()
    await waitFor(() => { expect(gitCheckLargeFiles).toHaveBeenCalled() })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status', { name: 'Action failed' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }))
    await waitFor(() => { expect(gitCommit).toHaveBeenCalled() })
  })

  it('ignores a scan answer that lands after the dialog was dismissed', async () => {
    let answer: ((value: { ok: boolean, files: Array<{ path: string, size: number }> }) => void) | undefined
    const gitCheckLargeFiles = vi.fn(() => new Promise<{ ok: boolean, files: Array<{ path: string, size: number }> }>(
      (resolve) => { answer = resolve },
    ))
    mount({
      cwd: '/work',
      git: status({
        hasWorkingTreeChanges: true,
        workingTree: filesTree([{ path: 'video.bin', insertions: 0, deletions: 0 }]),
      }),
      gitCheckLargeFiles,
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Git actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Commit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Commit changes' })
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Cancel' })[0]!)
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Commit changes' })).toBeNull() })
    await act(async () => {
      answer?.({ ok: true, files: [{ path: 'video.bin', size: 101 * 1024 * 1024 }] })
    })
    // Reopening must not inherit the stale answer either.
    fireEvent.click(screen.getByRole('button', { name: 'Git actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Commit' }))
    expect(await screen.findByRole('dialog', { name: 'Commit changes' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
