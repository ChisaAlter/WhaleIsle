// @vitest-environment jsdom
import { useEffect, useState, useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { allowAllAccess } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { en } from '../src/client/locales.ts'
import { createSurfacesStore } from '../src/client/stores.ts'
import { loadPersistedDrafts, SURFACES_PERSIST_PREFIX } from '../src/client/persist.ts'
import type { SurfacesRootProps } from '../src/client/SurfacesRoot.tsx'
import { SurfacesRoot } from '../src/client/SurfacesRoot.tsx'
const panelInfoStub = ((selector: (s: unknown) => unknown) => selector({ activePanelId: null })) as never
const resourceStub = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as never


const t: SurfacesRootProps['t'] = key => (en as Record<string, string>)[key] ?? key
const neverHook = (() => { throw new Error('surfaces must not read this hook') }) as never

function sessions(cwd?: string): SurfacesRootProps['useSessions'] {
  const current = 'session-1' as SessionId
  const state = {
    ids: [current],
    byId: cwd === undefined
      ? {}
      : {
        [current]: {
          id: current,
          displayTitle: 'proj',
          running: false,
          blank: false,
          updatedAt: 1,
          retainedBy: { mainView: 1 },
          cwd,
        },
      },
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    projectionsBySession: {},
  } as SessionListState
  return sel => sel(state)
}

function bindStore(instance: ReturnType<ReturnType<typeof createSurfacesStore>['create']>) {
  return {
    useStore: <S,>(sel: (state: ReturnType<typeof instance.getSnapshot>) => S) => {
      const snap = useSyncExternalStore(
        onStoreChange => instance.subscribe(onStoreChange),
        () => instance.getSnapshot(),
        () => instance.getSnapshot(),
      )
      return sel(snap)
    },
    actions: instance.actions,
  }
}

function mount(opts: {
  store?: ReturnType<ReturnType<typeof createSurfacesStore>['create']>
  cwd?: string
  useSessions?: SurfacesRootProps['useSessions']
  gitStatus?: SurfacesRootProps['gitStatus']
} = {}) {
  const instance = opts.store ?? createSurfacesStore().create()
  const openSurfaces = vi.fn()
  const openOfficeDocument = vi.fn(() => false)
  const renderSlot = vi.fn(() => <div data-occupant="stub" />)
  const gitStatus = opts.gitStatus ?? vi.fn(async () => null)
  render(
    <SurfacesRoot
        SessionProvider={({ children }) => children}
        {...allowAllAccess}
      usePanelInfo={panelInfoStub}
      useResource={resourceStub}
      sessionId={'session-1' as SessionId}
      useSession={neverHook}
      useSessions={opts.useSessions ?? sessions(opts.cwd)}
      useWorkspaces={neverHook}
      useProjection={neverHook}
      useConversation={neverHook}
      useSessionStatus={neverHook}
      useSessionRetainInfo={neverHook}
      useInput={neverHook}
      inputActions={undefined}
      {...bindStore(instance)}
      renderSlot={renderSlot}
      openOfficeDocument={openOfficeDocument}
      openSurfaces={openSurfaces}
      previewAvailable
      gitStatus={gitStatus}
      t={t}
    />,
  )
  return { instance, openSurfaces, openOfficeDocument, renderSlot, gitStatus }
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.useRealTimers()
})

describe('SurfacesRoot', () => {
  it('shows empty cards when the session has no surfaces', () => {
    mount()
    expect(screen.getByText('Open a surface')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Files/ })).toBeTruthy()
    expect(document.querySelector('[data-surfaces-tabs]')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open a surface' })).toBeNull()
    expect(screen.queryByText('Close Files')).toBeNull()
  })

  it('opens files and the column when the Files card is clicked', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: /Files/ }))
    expect(b.openSurfaces).toHaveBeenCalledOnce()
    expect(b.instance.getSnapshot().bySession['session-1']?.surfaces).toEqual([
      { id: 'files', kind: 'files' },
    ])
    expect(screen.getByRole('button', { name: 'Close Files' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open a surface' })).toBeTruthy()
    expect(b.renderSlot).toHaveBeenCalledWith('surfaces.files', expect.objectContaining({
      openFile: expect.any(Function) as unknown as (relativePath: string) => void,
    }))
  })

  it('openFile from the files occupant opens a file: surface', async () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: /Files/ }))
    const owner = (b.renderSlot.mock.calls as unknown as Array<[string, { openFile: (relativePath: string) => void }]>)
      .find(call => call[0] === 'surfaces.files')![1]
    act(() => { owner.openFile('src/app.ts') })
    expect(b.instance.getSnapshot().bySession['session-1']?.surfaces).toEqual([
      { id: 'files', kind: 'files' },
      { id: 'file:src/app.ts', kind: 'file', relativePath: 'src/app.ts' },
    ])
    await waitFor(() => {
      expect(b.renderSlot).toHaveBeenCalledWith('surfaces.file', expect.objectContaining({
        relativePath: 'src/app.ts',
        active: true,
        onDirtyChange: expect.any(Function) as unknown as (dirty: boolean) => void,
        readBuffer: expect.any(Function) as unknown as () => undefined,
        writeBuffer: expect.any(Function) as unknown as (buffer: null) => void,
        registerSave: expect.any(Function) as unknown as (save: null) => void,
      }))
    })
  })

  it('passes revealLine and revealRequestId into surfaces.file', async () => {
    const instance = createSurfacesStore().create()
    instance.actions.openFile('session-1', 'a.ts', { revealLine: 12 })
    const b = mount({ store: instance })
    await waitFor(() => {
      expect(b.renderSlot).toHaveBeenCalledWith('surfaces.file', expect.objectContaining({
        relativePath: 'a.ts',
        revealLine: 12,
        revealRequestId: 1,
      }))
    })
  })

  it('keeps the open surface when the column is opened again (titlebar toggle does not clear the store)', () => {
    const instance = createSurfacesStore().create()
    instance.actions.open('session-1', 'files')
    const b = mount({ store: instance })
    expect(screen.getByRole('button', { name: 'Close Files' })).toBeTruthy()
    expect(screen.queryByText('Open a surface')).toBeNull()
    expect(b.renderSlot).toHaveBeenCalledWith('surfaces.files', expect.objectContaining({
      openFile: expect.any(Function) as unknown as (relativePath: string) => void,
    }))

    b.openSurfaces()
    expect(instance.getSnapshot().bySession['session-1']?.surfaces).toEqual([
      { id: 'files', kind: 'files' },
    ])
  })

  it('closing the last tab returns to the empty cards', () => {
    const instance = createSurfacesStore().create()
    instance.actions.open('session-1', 'files')
    mount({ store: instance })
    fireEvent.click(screen.getByRole('button', { name: 'Close Files' }))
    expect(instance.getSnapshot()).toEqual({ bySession: {} })
    expect(screen.getByText('Open a surface')).toBeTruthy()
    expect(document.querySelector('[data-surfaces-tabs]')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open a surface' })).toBeNull()
  })

  it('disables Browser when preview IPC is absent', () => {
    const instance = createSurfacesStore().create()
    const openSurfaces = vi.fn()
    render(
      <SurfacesRoot
        SessionProvider={({ children }) => children}
        {...allowAllAccess}
        usePanelInfo={panelInfoStub}
        useResource={resourceStub}
        sessionId={'session-1' as SessionId}
        useSession={neverHook}
        useSessions={sessions('/tmp/proj')}
        useWorkspaces={neverHook}
        useProjection={neverHook}
      useConversation={neverHook}
      useSessionStatus={neverHook}
      useSessionRetainInfo={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        {...bindStore(instance)}
        renderSlot={vi.fn(() => null)}
        openOfficeDocument={() => false}
        openSurfaces={openSurfaces}
        previewAvailable={false}
        gitStatus={vi.fn(async () => null)}
        t={t}
      />,
    )
    const browser = screen.getByRole('button', { name: /Browser/ })
    expect(browser).toHaveProperty('disabled', true)
    fireEvent.click(browser)
    expect(openSurfaces).not.toHaveBeenCalled()
    expect(browser.getAttribute('title')).toBe('Browser previews are only available in the desktop app.')
  })

  it('enables Diff when the session cwd is a git repository', async () => {
    mount()
    expect(screen.getByRole('button', { name: /Diff/ })).toHaveProperty('disabled', true)

    cleanup()
    const present = mount({
      cwd: '/tmp/plain',
      gitStatus: vi.fn(async () => ({ refName: 'main' })),
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Diff/ })).toHaveProperty('disabled', false)
    })
    fireEvent.click(screen.getByRole('button', { name: /Diff/ }))
    expect(present.instance.getSnapshot().bySession['session-1']?.surfaces).toEqual([
      { id: 'diff', kind: 'diff' },
    ])
  })

  it('probes Git with the main-view cwd when a background session is retained', async () => {
    const main = 'session-main' as SessionId
    const background = 'session-background' as SessionId
    const state = {
      ids: [main, background],
      byId: {
        [main]: {
          id: main,
          displayTitle: 'main',
          running: false,
          blank: false,
          updatedAt: 1,
          retainedBy: { mainView: 1 },
          cwd: '/tmp/main',
        },
        [background]: {
          id: background,
          displayTitle: 'background',
          running: true,
          blank: false,
          updatedAt: 2,
          retainedBy: { gateway: 1 },
          cwd: '/tmp/background',
        },
      },
      phase: 'ready' as const,
      subagentsByParent: {},
      jobsBySession: {},
      projectionsBySession: {},
    } as SessionListState
    const gitStatus = vi.fn(async () => ({ refName: 'main' }))
    mount({ useSessions: sel => sel(state), gitStatus })
    await waitFor(() => { expect(gitStatus).toHaveBeenCalledWith('/tmp/main') })
    expect(gitStatus).not.toHaveBeenCalledWith('/tmp/background')
  })

  it('re-probes the Diff gate when ui-git broadcasts a successful init', async () => {
    let repo: { refName: string } | null = null
    const gitStatus = vi.fn(async () => repo)
    mount({ cwd: '/tmp/plain', gitStatus })
    await waitFor(() => { expect(gitStatus).toHaveBeenCalled() })
    expect(screen.getByRole('button', { name: /Diff/ })).toHaveProperty('disabled', true)

    repo = { refName: 'main' }
    await act(async () => {
      window.dispatchEvent(new CustomEvent('dshd-git-init'))
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Diff/ })).toHaveProperty('disabled', false)
    })
  })

  it('persists the open files tab for the session', async () => {
    vi.useFakeTimers()
    mount({ cwd: '/tmp/proj' })
    fireEvent.click(screen.getByRole('button', { name: /Files/ }))
    await act(async () => {
      vi.advanceTimersByTime(80)
    })
    expect(localStorage.getItem('dsh-surfaces:v1:session-1')).toContain('files')
    vi.useRealTimers()
  })

  it('opens terminal, agents, and preview occupants and honors tab chrome', async () => {
    const b = mount({
      cwd: '/tmp/proj',
      gitStatus: vi.fn(async () => ({ refName: 'main' })),
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Diff/ })).toHaveProperty('disabled', false)
    })
    fireEvent.click(screen.getByRole('button', { name: /Terminal/ }))
    expect(b.renderSlot).toHaveBeenCalledWith('surfaces.terminal', {})
    fireEvent.click(screen.getByRole('button', { name: 'Open a surface' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Agents' }))
    expect(b.renderSlot).toHaveBeenCalledWith('surfaces.agents', {})
    fireEvent.click(screen.getByRole('button', { name: 'Open a surface' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Browser' }))
    expect(b.renderSlot).toHaveBeenCalledWith('surfaces.browser', { active: true })
    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }))
    expect(b.renderSlot).toHaveBeenCalledWith('surfaces.browser', { active: false })
    expect(document.querySelectorAll('[data-surfaces-occupant]')).toHaveLength(3)
    expect(document.querySelector('[data-surfaces-occupant="idle"]')).toBeTruthy()
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Terminal' }).parentElement!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close others' }))
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Terminal' }).parentElement!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close to the right' }))
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Terminal' }).parentElement!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close all' }))
    expect(b.instance.getSnapshot()).toEqual({ bySession: {} })
  })

  it('keeps Files occupant state when switching to another surface tab', async () => {
    const instance = createSurfacesStore().create()
    const openSurfaces = vi.fn()
    const Occupant = ({ label }: { label: string }) => {
      const [draft, setDraft] = useState('initial')
      return (
        <div data-occupant={label}>
          <input
            aria-label={`${label} draft`}
            value={draft}
            onChange={(event) => { setDraft(event.target.value) }}
          />
        </div>
      )
    }
    const renderSlot: SurfacesRootProps['renderSlot'] = (name) => {
      if (name === 'surfaces.files') return <Occupant label="files" />
      if (name === 'surfaces.terminal') return <Occupant label="terminal" />
      return <div data-occupant="stub" />
    }
    render(
      <SurfacesRoot
        SessionProvider={({ children }) => children}
        {...allowAllAccess}
        usePanelInfo={panelInfoStub}
        useResource={resourceStub}
        sessionId={'session-1' as SessionId}
        useSession={neverHook}
        useSessions={sessions('/tmp/proj')}
        useWorkspaces={neverHook}
        useProjection={neverHook}
      useConversation={neverHook}
      useSessionStatus={neverHook}
      useSessionRetainInfo={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        {...bindStore(instance)}
        renderSlot={renderSlot}
        openOfficeDocument={() => false}
        openSurfaces={openSurfaces}
        previewAvailable
        gitStatus={async () => null}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Files/ }))
    const filesDraft = await screen.findByLabelText('files draft')
    fireEvent.change(filesDraft, { target: { value: 'unsaved edit' } })
    expect((screen.getByLabelText('files draft') as HTMLInputElement).value).toBe('unsaved edit')
    fireEvent.click(screen.getByRole('button', { name: 'Open a surface' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Terminal' }))
    expect(document.querySelector('[data-surfaces-occupant="idle"]')).toBeTruthy()
    expect((document.querySelector('[data-occupant="files"] input') as HTMLInputElement).value).toBe('unsaved edit')
    fireEvent.click(screen.getByRole('button', { name: 'Files' }))
    expect((screen.getByLabelText('files draft') as HTMLInputElement).value).toBe('unsaved edit')
  })

  it('passes active to Browser and only closes the guest when that tab closes', async () => {
    const previewHide = vi.fn()
    const previewClose = vi.fn()
    const FakeBrowser = ({ active }: { active: boolean }) => {
      useEffect(() => {
        if (!active) previewHide()
      }, [active])
      useEffect(() => () => { previewClose() }, [])
      return <div data-fake-browser={active ? 'active' : 'idle'} />
    }
    const instance = createSurfacesStore().create()
    const renderSlot: SurfacesRootProps['renderSlot'] = (name, owner) => {
      if (name === 'surfaces.browser') {
        return <FakeBrowser active={(owner as unknown as { active: boolean }).active} />
      }
      return <div data-occupant="stub" />
    }
    render(
      <SurfacesRoot
        SessionProvider={({ children }) => children}
        {...allowAllAccess}
        usePanelInfo={panelInfoStub}
        useResource={resourceStub}
        sessionId={'session-1' as SessionId}
        useSession={neverHook}
        useSessions={sessions('/tmp/proj')}
        useWorkspaces={neverHook}
        useProjection={neverHook}
      useConversation={neverHook}
      useSessionStatus={neverHook}
      useSessionRetainInfo={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        {...bindStore(instance)}
        renderSlot={renderSlot}
        openOfficeDocument={() => false}
        openSurfaces={vi.fn()}
        previewAvailable
        gitStatus={async () => null}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Browser/ }))
    expect(document.querySelector('[data-fake-browser="active"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open a surface' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Files' }))
    await waitFor(() => {
      expect(previewHide).toHaveBeenCalled()
    })
    expect(previewClose).not.toHaveBeenCalled()
    expect(document.querySelector('[data-fake-browser="idle"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Browser' }))
    expect(document.querySelector('[data-fake-browser="active"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close Browser' }))
    await waitFor(() => {
      expect(previewClose).toHaveBeenCalled()
    })
  })

  it('confirms before closing a dirty file tab', async () => {
    const instance = createSurfacesStore().create()
    const FakeFile = ({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) => {
      useEffect(() => {
        onDirtyChange(true)
        return () => { onDirtyChange(false) }
      }, [onDirtyChange])
      return <div data-fake-file>dirty</div>
    }
    const renderSlot: SurfacesRootProps['renderSlot'] = (name, owner) => {
      if (name === 'surfaces.files') {
        return (
          <button type="button" onClick={() => { (owner as unknown as { openFile: (path: string) => void }).openFile('a.ts') }}>
            open-file
          </button>
        )
      }
      if (name === 'surfaces.file') {
        return <FakeFile onDirtyChange={(owner as unknown as { onDirtyChange: (dirty: boolean) => void }).onDirtyChange} />
      }
      return <div data-occupant="stub" />
    }
    render(
      <SurfacesRoot
        SessionProvider={({ children }) => children}
        {...allowAllAccess}
        usePanelInfo={panelInfoStub}
        useResource={resourceStub}
        sessionId={'session-1' as SessionId}
        useSession={neverHook}
        useSessions={sessions('/tmp/proj')}
        useWorkspaces={neverHook}
        useProjection={neverHook}
      useConversation={neverHook}
      useSessionStatus={neverHook}
      useSessionRetainInfo={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        {...bindStore(instance)}
        renderSlot={renderSlot}
        openOfficeDocument={() => false}
        openSurfaces={vi.fn()}
        previewAvailable
        gitStatus={async () => null}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Files/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'open-file' }))
    expect(await screen.findByText('dirty')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close a.ts' }))
    expect(await screen.findByRole('dialog', { name: 'Discard unsaved changes?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(instance.getSnapshot().bySession['session-1']?.surfaces.some(s => s.id === 'file:a.ts')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Close a.ts' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))
    expect(instance.getSnapshot().bySession['session-1']?.surfaces.some(s => s.id === 'file:a.ts')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => {
      expect(instance.getSnapshot().bySession['session-1']?.surfaces.some(s => s.id === 'file:a.ts')).toBe(false)
    })
  })

  it('restores an unsaved file buffer after switching sessions and back', async () => {
    const instance = createSurfacesStore().create()
    const FakeFile = ({
      onDirtyChange,
      readBuffer,
      writeBuffer,
    }: {
      onDirtyChange: (dirty: boolean) => void
      readBuffer: () => { text: string; draft: string } | undefined
      writeBuffer: (buffer: { text: string; draft: string } | null) => void
    }) => {
      const remembered = readBuffer()
      const [draft, setDraft] = useState(remembered?.draft ?? 'disk')
      useEffect(() => {
        writeBuffer({ text: 'disk', draft })
        onDirtyChange(draft !== 'disk')
      }, [draft, onDirtyChange, writeBuffer])
      return (
        <textarea
          aria-label="file draft"
          value={draft}
          onChange={(event) => { setDraft(event.target.value) }}
        />
      )
    }
    const renderSlot: SurfacesRootProps['renderSlot'] = (name, owner) => {
      if (name === 'surfaces.files') {
        return (
          <button type="button" onClick={() => { (owner as unknown as { openFile: (path: string) => void }).openFile('a.ts') }}>
            open-file
          </button>
        )
      }
      if (name === 'surfaces.file') {
        const file = owner as unknown as {
          onDirtyChange: (dirty: boolean) => void
          readBuffer: () => { text: string; draft: string } | undefined
          writeBuffer: (buffer: { text: string; draft: string } | null) => void
        }
        return (
          <FakeFile
            onDirtyChange={file.onDirtyChange}
            readBuffer={file.readBuffer}
            writeBuffer={file.writeBuffer}
          />
        )
      }
      return <div data-occupant="stub" />
    }
    const current = 'session-1' as SessionId
    const other = 'session-2' as SessionId
    const listFor = (id: SessionId): SurfacesRootProps['useSessions'] => {
      const state = {
        ids: [current, other],
        byId: {
          [current]: {
            id: current,
            displayTitle: 'proj',
            running: false,
            blank: false,
            updatedAt: 1,
            retainedBy: id === current ? { mainView: 1 } : {},
            cwd: '/tmp/proj',
          },
          [other]: {
            id: other,
            displayTitle: 'other',
            running: false,
            blank: false,
            updatedAt: 1,
            retainedBy: id === other ? { mainView: 1 } : {},
            cwd: '/tmp/other',
          },
        },
        phase: 'ready',
        subagentsByParent: {},
        jobsBySession: {},
        projectionsBySession: {},
      } as SessionListState
      return sel => sel(state)
    }
    const view = render(
      <SurfacesRoot
        SessionProvider={({ children }) => children}
        {...allowAllAccess}
        usePanelInfo={panelInfoStub}
        useResource={resourceStub}
        sessionId={current}
        useSession={neverHook}
        useSessions={listFor(current)}
        useWorkspaces={neverHook}
        useProjection={neverHook}
      useConversation={neverHook}
      useSessionStatus={neverHook}
      useSessionRetainInfo={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        {...bindStore(instance)}
        renderSlot={renderSlot}
        openOfficeDocument={() => false}
        openSurfaces={vi.fn()}
        previewAvailable
        gitStatus={async () => null}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Files/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'open-file' }))
    fireEvent.change(await screen.findByLabelText('file draft'), { target: { value: 'unsaved edit' } })
    expect((screen.getByLabelText('file draft') as HTMLTextAreaElement).value).toBe('unsaved edit')
    view.rerender(
      <SurfacesRoot
        SessionProvider={({ children }) => children}
        {...allowAllAccess}
        usePanelInfo={panelInfoStub}
        useResource={resourceStub}
        sessionId={other}
        useSession={neverHook}
        useSessions={listFor(other)}
        useWorkspaces={neverHook}
        useProjection={neverHook}
      useConversation={neverHook}
      useSessionStatus={neverHook}
      useSessionRetainInfo={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        {...bindStore(instance)}
        renderSlot={renderSlot}
        openOfficeDocument={() => false}
        openSurfaces={vi.fn()}
        previewAvailable
        gitStatus={async () => null}
        t={t}
      />,
    )
    expect(screen.queryByLabelText('file draft')).toBeNull()
    view.rerender(
      <SurfacesRoot
        SessionProvider={({ children }) => children}
        {...allowAllAccess}
        usePanelInfo={panelInfoStub}
        useResource={resourceStub}
        sessionId={current}
        useSession={neverHook}
        useSessions={listFor(current)}
        useWorkspaces={neverHook}
        useProjection={neverHook}
      useConversation={neverHook}
      useSessionStatus={neverHook}
      useSessionRetainInfo={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        {...bindStore(instance)}
        renderSlot={renderSlot}
        openOfficeDocument={() => false}
        openSurfaces={vi.fn()}
        previewAvailable
        gitStatus={async () => null}
        t={t}
      />,
    )
    expect(await screen.findByLabelText('file draft')).toBeTruthy()
    expect((screen.getByLabelText('file draft') as HTMLTextAreaElement).value).toBe('unsaved edit')
    fireEvent.click(screen.getByRole('button', { name: 'Close a.ts' }))
    expect(await screen.findByRole('dialog', { name: 'Discard unsaved changes?' })).toBeTruthy()
  })

  it('opens a preview surface from dshd-open-surface without a session id', async () => {
    const instance = createSurfacesStore().create()
    const openSurfaces = vi.fn()
    const renderSlot = vi.fn(() => <div data-occupant="stub" />)
    render(
      <SurfacesRoot
        SessionProvider={({ children }) => children}
        {...allowAllAccess}
        usePanelInfo={panelInfoStub}
        useResource={resourceStub}
        sessionId={undefined}
        useSession={neverHook}
        useSessions={sessions()}
        useWorkspaces={neverHook}
        useProjection={neverHook}
      useConversation={neverHook}
      useSessionStatus={neverHook}
      useSessionRetainInfo={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        {...bindStore(instance)}
        renderSlot={renderSlot}
        openOfficeDocument={() => false}
        openSurfaces={openSurfaces}
        previewAvailable
        gitStatus={async () => null}
        t={t}
      />,
    )
    await act(async () => {
      window.dispatchEvent(new CustomEvent('dshd-open-surface', { detail: { kind: 'preview' } }))
    })
    expect(openSurfaces).toHaveBeenCalled()
    expect(instance.getSnapshot().bySession['']?.surfaces.some(s => s.kind === 'preview')).toBe(true)
  })

  it('skips persist when the surfaces slot has no session', () => {
    const instance = createSurfacesStore().create()
    render(
      <SurfacesRoot
        SessionProvider={({ children }) => children}
        {...allowAllAccess}
        usePanelInfo={panelInfoStub}
        useResource={resourceStub}
        sessionId={undefined}
        useSession={neverHook}
        useSessions={sessions('/tmp/proj')}
        useWorkspaces={neverHook}
        useProjection={neverHook}
      useConversation={neverHook}
      useSessionStatus={neverHook}
      useSessionRetainInfo={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        {...bindStore(instance)}
        renderSlot={vi.fn(() => null)}
        openOfficeDocument={() => false}
        openSurfaces={vi.fn()}
        previewAvailable
        gitStatus={vi.fn(async () => null)}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Files/ }))
    expect(instance.getSnapshot().bySession['']).toBeDefined()
  })

  it('treats an empty cwd as missing', () => {
    const current = 'session-1' as SessionId
    const emptyCwd = {
      current,
      ids: [current],
      byId: {
        [current]: {
          id: current,
          displayTitle: 'proj',
          running: false,
          blank: false,
          updatedAt: 1,
          retainedBy: { mainView: 1 },
          cwd: '',
        },
      },
      phase: 'ready',
      subagentsByParent: {},
      jobsBySession: {},
      projectionsBySession: {},
    } as SessionListState
    render(
      <SurfacesRoot
        SessionProvider={({ children }) => children}
        {...allowAllAccess}
        usePanelInfo={panelInfoStub}
        useResource={resourceStub}
        sessionId={current}
        useSession={neverHook}
        useSessions={sel => sel(emptyCwd)}
        useWorkspaces={neverHook}
        useProjection={neverHook}
      useConversation={neverHook}
      useSessionStatus={neverHook}
      useSessionRetainInfo={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        {...bindStore(createSurfacesStore().create())}
        renderSlot={vi.fn(() => null)}
        openOfficeDocument={() => false}
        openSurfaces={vi.fn()}
        previewAvailable
        gitStatus={vi.fn(async () => ({ refName: 'main' }))}
        t={t}
      />,
    )
    expect(screen.getByRole('button', { name: /Diff/ })).toHaveProperty('disabled', true)
  })

  it('treats a session list without a main-view retain as having no cwd', () => {
    const state = {
      ids: ['background' as SessionId],
      byId: {
        ['background' as SessionId]: {
          id: 'background' as SessionId,
          displayTitle: 'background',
          running: true,
          blank: false,
          updatedAt: 1,
          retainedBy: { gateway: 1 },
          cwd: '/tmp/background',
        },
      },
      phase: 'ready',
      subagentsByParent: {},
      jobsBySession: {},
      projectionsBySession: {},
    } as SessionListState
    render(
      <SurfacesRoot
        SessionProvider={({ children }) => children}
        {...allowAllAccess}
        usePanelInfo={panelInfoStub}
        useResource={resourceStub}
        sessionId={'session-1' as SessionId}
        useSession={neverHook}
        useSessions={sel => sel(state)}
        useWorkspaces={neverHook}
        useProjection={neverHook}
      useConversation={neverHook}
      useSessionStatus={neverHook}
      useSessionRetainInfo={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        {...bindStore(createSurfacesStore().create())}
        renderSlot={vi.fn(() => null)}
        openOfficeDocument={() => false}
        openSurfaces={vi.fn()}
        previewAvailable
        gitStatus={vi.fn(async () => ({ refName: 'main' }))}
        t={t}
      />,
    )
    expect(screen.getByRole('button', { name: /Diff/ })).toHaveProperty('disabled', true)
  })

  it('closes tabs to the right from the tab strip', async () => {
    const instance = createSurfacesStore().create()
    instance.actions.open('session-1', 'files')
    instance.actions.open('session-1', 'diff')
    instance.actions.open('session-1', 'agents')
    mount({ store: instance, cwd: '/tmp/proj' })
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Files' }).parentElement!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close to the right' }))
    expect(instance.getSnapshot().bySession['session-1']?.surfaces.map(surface => surface.id)).toEqual(['files'])
  })

  it('opens the preview surface from dshd-open-surface', () => {
    const b = mount()
    act(() => {
      window.dispatchEvent(new CustomEvent('dshd-open-surface', { detail: { kind: 'nope' } }))
      window.dispatchEvent(new CustomEvent('dshd-open-surface', { detail: { kind: 'preview' } }))
    })
    expect(b.openSurfaces).toHaveBeenCalledOnce()
    expect(b.instance.getSnapshot().bySession['session-1']?.surfaces.some(surface => surface.kind === 'preview')).toBe(true)
  })

  it('keeps separate drafts when two sessions have the same file path open', async () => {
    const instance = createSurfacesStore().create()
    const FakeFile = ({
      onDirtyChange,
      readBuffer,
      writeBuffer,
    }: {
      onDirtyChange: (dirty: boolean) => void
      readBuffer: () => { text: string; draft: string } | undefined
      writeBuffer: (buffer: { text: string; draft: string } | null) => void
    }) => {
      const remembered = readBuffer()
      const [draft, setDraft] = useState(remembered?.draft ?? 'disk')
      useEffect(() => {
        writeBuffer({ text: 'disk', draft })
        onDirtyChange(draft !== 'disk')
      }, [draft, onDirtyChange, writeBuffer])
      return (
        <textarea
          aria-label="file draft"
          value={draft}
          onChange={(event) => { setDraft(event.target.value) }}
        />
      )
    }
    const renderSlot: SurfacesRootProps['renderSlot'] = (name, owner) => {
      if (name === 'surfaces.files') {
        return (
          <button type="button" onClick={() => { (owner as unknown as { openFile: (path: string) => void }).openFile('a.ts') }}>
            open-file
          </button>
        )
      }
      if (name === 'surfaces.file') {
        const file = owner as unknown as {
          onDirtyChange: (dirty: boolean) => void
          readBuffer: () => { text: string; draft: string } | undefined
          writeBuffer: (buffer: { text: string; draft: string } | null) => void
        }
        return (
          <FakeFile
            onDirtyChange={file.onDirtyChange}
            readBuffer={file.readBuffer}
            writeBuffer={file.writeBuffer}
          />
        )
      }
      return <div data-occupant="stub" />
    }
    const current = 'session-1' as SessionId
    const other = 'session-2' as SessionId
    const listFor = (id: SessionId): SurfacesRootProps['useSessions'] => {
      const state = {
        ids: [current, other],
        byId: {
          [current]: {
            id: current,
            displayTitle: 'proj',
            running: false,
            blank: false,
            updatedAt: 1,
            retainedBy: id === current ? { mainView: 1 } : {},
            cwd: '/tmp/proj',
          },
          [other]: {
            id: other,
            displayTitle: 'other',
            running: false,
            blank: false,
            updatedAt: 1,
            retainedBy: id === other ? { mainView: 1 } : {},
            cwd: '/tmp/other',
          },
        },
        phase: 'ready',
        subagentsByParent: {},
        jobsBySession: {},
        projectionsBySession: {},
      } as SessionListState
      return sel => sel(state)
    }
    const view = render(
      <SurfacesRoot
        SessionProvider={({ children }) => children}
        {...allowAllAccess}
        usePanelInfo={panelInfoStub}
        useResource={resourceStub}
        sessionId={current}
        useSession={neverHook}
        useSessions={listFor(current)}
        useWorkspaces={neverHook}
        useProjection={neverHook}
      useConversation={neverHook}
      useSessionStatus={neverHook}
      useSessionRetainInfo={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        {...bindStore(instance)}
        renderSlot={renderSlot}
        openOfficeDocument={() => false}
        openSurfaces={vi.fn()}
        previewAvailable
        gitStatus={async () => null}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Files/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'open-file' }))
    fireEvent.change(await screen.findByLabelText('file draft'), { target: { value: 'session-one' } })
    view.rerender(
      <SurfacesRoot
        SessionProvider={({ children }) => children}
        {...allowAllAccess}
        usePanelInfo={panelInfoStub}
        useResource={resourceStub}
        sessionId={other}
        useSession={neverHook}
        useSessions={listFor(other)}
        useWorkspaces={neverHook}
        useProjection={neverHook}
      useConversation={neverHook}
      useSessionStatus={neverHook}
      useSessionRetainInfo={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        {...bindStore(instance)}
        renderSlot={renderSlot}
        openOfficeDocument={() => false}
        openSurfaces={vi.fn()}
        previewAvailable
        gitStatus={async () => null}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Files/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'open-file' }))
    fireEvent.change(await screen.findByLabelText('file draft'), { target: { value: 'session-two' } })
    view.rerender(
      <SurfacesRoot
        SessionProvider={({ children }) => children}
        {...allowAllAccess}
        usePanelInfo={panelInfoStub}
        useResource={resourceStub}
        sessionId={current}
        useSession={neverHook}
        useSessions={listFor(current)}
        useWorkspaces={neverHook}
        useProjection={neverHook}
      useConversation={neverHook}
      useSessionStatus={neverHook}
      useSessionRetainInfo={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        {...bindStore(instance)}
        renderSlot={renderSlot}
        openOfficeDocument={() => false}
        openSurfaces={vi.fn()}
        previewAvailable
        gitStatus={async () => null}
        t={t}
      />,
    )
    expect((await screen.findByLabelText('file draft') as HTMLTextAreaElement).value).toBe('session-one')
    view.rerender(
      <SurfacesRoot
        SessionProvider={({ children }) => children}
        {...allowAllAccess}
        usePanelInfo={panelInfoStub}
        useResource={resourceStub}
        sessionId={other}
        useSession={neverHook}
        useSessions={listFor(other)}
        useWorkspaces={neverHook}
        useProjection={neverHook}
      useConversation={neverHook}
      useSessionStatus={neverHook}
      useSessionRetainInfo={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        {...bindStore(instance)}
        renderSlot={renderSlot}
        openOfficeDocument={() => false}
        openSurfaces={vi.fn()}
        previewAvailable
        gitStatus={async () => null}
        t={t}
      />,
    )
    expect((await screen.findByLabelText('file draft') as HTMLTextAreaElement).value).toBe('session-two')
  })

  it('saves then closes a dirty file tab from the confirm dialog', async () => {
    const instance = createSurfacesStore().create()
    const FakeFile = ({
      onDirtyChange,
      writeBuffer,
      registerSave,
    }: {
      onDirtyChange: (dirty: boolean) => void
      writeBuffer: (buffer: { text: string; draft: string } | null) => void
      registerSave: (save: (() => Promise<boolean>) | null) => void
    }) => {
      useEffect(() => {
        onDirtyChange(true)
        writeBuffer({ text: 'disk', draft: 'edited' })
        registerSave(async () => {
          writeBuffer({ text: 'edited', draft: 'edited' })
          onDirtyChange(false)
          return true
        })
        return () => {
          onDirtyChange(false)
          registerSave(null)
        }
      }, [onDirtyChange, writeBuffer, registerSave])
      return <div data-fake-file>dirty</div>
    }
    const renderSlot: SurfacesRootProps['renderSlot'] = (name, owner) => {
      if (name === 'surfaces.files') {
        return (
          <button type="button" onClick={() => { (owner as unknown as { openFile: (path: string) => void }).openFile('a.ts') }}>
            open-file
          </button>
        )
      }
      if (name === 'surfaces.file') {
        const file = owner as unknown as {
          onDirtyChange: (dirty: boolean) => void
          writeBuffer: (buffer: { text: string; draft: string } | null) => void
          registerSave: (save: (() => Promise<boolean>) | null) => void
        }
        return (
          <FakeFile
            onDirtyChange={file.onDirtyChange}
            writeBuffer={file.writeBuffer}
            registerSave={file.registerSave}
          />
        )
      }
      return <div data-occupant="stub" />
    }
    render(
      <SurfacesRoot
        SessionProvider={({ children }) => children}
        {...allowAllAccess}
        usePanelInfo={panelInfoStub}
        useResource={resourceStub}
        sessionId={'session-1' as SessionId}
        useSession={neverHook}
        useSessions={sessions('/tmp/proj')}
        useWorkspaces={neverHook}
        useProjection={neverHook}
      useConversation={neverHook}
      useSessionStatus={neverHook}
      useSessionRetainInfo={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        {...bindStore(instance)}
        renderSlot={renderSlot}
        openOfficeDocument={() => false}
        openSurfaces={vi.fn()}
        previewAvailable
        gitStatus={async () => null}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Files/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'open-file' }))
    expect(await screen.findByText('dirty')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close a.ts' }))
    expect(await screen.findByRole('dialog', { name: 'Discard unsaved changes?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(instance.getSnapshot().bySession['session-1']?.surfaces.some(s => s.id === 'file:a.ts')).toBe(false)
    })
  })

  it('keeps a dirty file tab when confirm Save reports failure', async () => {
    const instance = createSurfacesStore().create()
    const FakeFile = ({
      onDirtyChange,
      registerSave,
    }: {
      onDirtyChange: (dirty: boolean) => void
      registerSave: (save: (() => Promise<boolean>) | null) => void
    }) => {
      useEffect(() => {
        onDirtyChange(true)
        registerSave(async () => false)
        return () => {
          onDirtyChange(false)
          registerSave(null)
        }
      }, [onDirtyChange, registerSave])
      return <div data-fake-file>dirty</div>
    }
    const renderSlot: SurfacesRootProps['renderSlot'] = (name, owner) => {
      if (name === 'surfaces.files') {
        return (
          <button type="button" onClick={() => { (owner as unknown as { openFile: (path: string) => void }).openFile('a.ts') }}>
            open-file
          </button>
        )
      }
      if (name === 'surfaces.file') {
        const file = owner as unknown as {
          onDirtyChange: (dirty: boolean) => void
          registerSave: (save: (() => Promise<boolean>) | null) => void
        }
        return <FakeFile onDirtyChange={file.onDirtyChange} registerSave={file.registerSave} />
      }
      return <div data-occupant="stub" />
    }
    render(
      <SurfacesRoot
        SessionProvider={({ children }) => children}
        {...allowAllAccess}
        usePanelInfo={panelInfoStub}
        useResource={resourceStub}
        sessionId={'session-1' as SessionId}
        useSession={neverHook}
        useSessions={sessions('/tmp/proj')}
        useWorkspaces={neverHook}
        useProjection={neverHook}
      useConversation={neverHook}
      useSessionStatus={neverHook}
      useSessionRetainInfo={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        {...bindStore(instance)}
        renderSlot={renderSlot}
        openOfficeDocument={() => false}
        openSurfaces={vi.fn()}
        previewAvailable
        gitStatus={async () => null}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Files/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'open-file' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Close a.ts' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))
    expect(instance.getSnapshot().bySession['session-1']?.surfaces.some(s => s.id === 'file:a.ts')).toBe(true)
    expect(screen.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeTruthy()
  })

  it('persists dirty file drafts on pagehide and restores them after remount', async () => {
    const FakeFile = ({
      readBuffer,
      writeBuffer,
      onDirtyChange,
    }: {
      readBuffer: () => { text: string; draft: string } | undefined
      writeBuffer: (buffer: { text: string; draft: string } | null) => void
      onDirtyChange: (dirty: boolean) => void
    }) => {
      const remembered = readBuffer()
      const [draft, setDraft] = useState(remembered?.draft ?? 'disk')
      useEffect(() => {
        writeBuffer({ text: 'disk', draft })
        onDirtyChange(draft !== 'disk')
      }, [draft, onDirtyChange, writeBuffer])
      return (
        <textarea
          aria-label="file draft"
          value={draft}
          onChange={(event) => { setDraft(event.target.value) }}
        />
      )
    }
    const renderSlot: SurfacesRootProps['renderSlot'] = (name, owner) => {
      if (name === 'surfaces.files') {
        return (
          <button type="button" onClick={() => { (owner as unknown as { openFile: (path: string) => void }).openFile('a.ts') }}>
            open-file
          </button>
        )
      }
      if (name === 'surfaces.file') {
        const file = owner as unknown as {
          onDirtyChange: (dirty: boolean) => void
          readBuffer: () => { text: string; draft: string } | undefined
          writeBuffer: (buffer: { text: string; draft: string } | null) => void
        }
        return (
          <FakeFile
            onDirtyChange={file.onDirtyChange}
            readBuffer={file.readBuffer}
            writeBuffer={file.writeBuffer}
          />
        )
      }
      return <div data-occupant="stub" />
    }
    const instance = createSurfacesStore().create()
    render(
      <SurfacesRoot
        SessionProvider={({ children }) => children}
        {...allowAllAccess}
        usePanelInfo={panelInfoStub}
        useResource={resourceStub}
        sessionId={'session-1' as SessionId}
        useSession={neverHook}
        useSessions={sessions('/tmp/proj')}
        useWorkspaces={neverHook}
        useProjection={neverHook}
      useConversation={neverHook}
      useSessionStatus={neverHook}
      useSessionRetainInfo={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        {...bindStore(instance)}
        renderSlot={renderSlot}
        openOfficeDocument={() => false}
        openSurfaces={vi.fn()}
        previewAvailable
        gitStatus={async () => null}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Files/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'open-file' }))
    fireEvent.change(await screen.findByLabelText('file draft'), { target: { value: 'unsaved edit' } })
    await waitFor(() => {
      expect((screen.getByLabelText('file draft') as HTMLTextAreaElement).value).toBe('unsaved edit')
    })
    fireEvent(window, new Event('pagehide'))
    expect(loadPersistedDrafts().get('session-1:file:a.ts')).toEqual({ text: 'disk', draft: 'unsaved edit' })
    cleanup()
    const restored = createSurfacesStore().create()
    render(
      <SurfacesRoot
        SessionProvider={({ children }) => children}
        {...allowAllAccess}
        usePanelInfo={panelInfoStub}
        useResource={resourceStub}
        sessionId={'session-1' as SessionId}
        useSession={neverHook}
        useSessions={sessions('/tmp/proj')}
        useWorkspaces={neverHook}
        useProjection={neverHook}
      useConversation={neverHook}
      useSessionStatus={neverHook}
      useSessionRetainInfo={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        {...bindStore(restored)}
        renderSlot={renderSlot}
        openOfficeDocument={() => false}
        openSurfaces={vi.fn()}
        previewAvailable
        gitStatus={async () => null}
        t={t}
      />,
    )
    expect(await screen.findByLabelText('file draft')).toBeTruthy()
    expect((screen.getByLabelText('file draft') as HTMLTextAreaElement).value).toBe('unsaved edit')
  })

  it('does not restore a discarded dirty file after the persist debounce', async () => {
    const FakeFile = ({
      writeBuffer,
      onDirtyChange,
    }: {
      writeBuffer: (buffer: { text: string; draft: string } | null) => void
      onDirtyChange: (dirty: boolean) => void
    }) => {
      useEffect(() => {
        writeBuffer({ text: 'disk', draft: 'edited' })
        onDirtyChange(true)
      }, [onDirtyChange, writeBuffer])
      return <div data-fake-file>dirty</div>
    }
    const instance = createSurfacesStore().create()
    const renderSlot: SurfacesRootProps['renderSlot'] = (name, owner) => {
      if (name === 'surfaces.files') {
        return (
          <button type="button" onClick={() => { (owner as unknown as { openFile: (path: string) => void }).openFile('a.ts') }}>
            open-file
          </button>
        )
      }
      if (name === 'surfaces.file') {
        const file = owner as unknown as {
          onDirtyChange: (dirty: boolean) => void
          writeBuffer: (buffer: { text: string; draft: string } | null) => void
        }
        return <FakeFile onDirtyChange={file.onDirtyChange} writeBuffer={file.writeBuffer} />
      }
      return <div data-occupant="stub" />
    }
    render(
      <SurfacesRoot
        SessionProvider={({ children }) => children}
        {...allowAllAccess}
        usePanelInfo={panelInfoStub}
        useResource={resourceStub}
        sessionId={'session-1' as SessionId}
        useSession={neverHook}
        useSessions={sessions('/tmp/proj')}
        useWorkspaces={neverHook}
        useProjection={neverHook}
      useConversation={neverHook}
      useSessionStatus={neverHook}
      useSessionRetainInfo={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        {...bindStore(instance)}
        renderSlot={renderSlot}
        openOfficeDocument={() => false}
        openSurfaces={vi.fn()}
        previewAvailable
        gitStatus={async () => null}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Files/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'open-file' }))
    expect(await screen.findByText('dirty')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close a.ts' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }))
    await waitFor(() => {
      expect(instance.getSnapshot().bySession['session-1']?.surfaces.some(s => s.id === 'file:a.ts')).toBe(false)
    })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 120)) })
    expect(loadPersistedDrafts().has('session-1:file:a.ts')).toBe(false)
    const raw = localStorage.getItem(`${SURFACES_PERSIST_PREFIX}session-1`)
    if (raw !== null) {
      expect(JSON.parse(raw).surfaces.some((surface: { id: string }) => surface.id === 'file:a.ts')).toBe(false)
    }
  })

  it('hands Office binaries to the native document preview instead of a file surface', () => {
    const b = mount()
    b.openOfficeDocument.mockImplementation(() => true)
    fireEvent.click(screen.getByRole('button', { name: /Files/ }))
    const owner = (b.renderSlot.mock.calls as unknown as Array<[string, { openFile: (relativePath: string) => void }]>)
      .find(call => call[0] === 'surfaces.files')![1]
    act(() => { owner.openFile('docs/spec.docx') })
    expect(b.openOfficeDocument).toHaveBeenCalledWith('docs/spec.docx')
    expect(b.instance.getSnapshot().bySession['session-1']?.surfaces.some(s => s.id === 'file:docs/spec.docx')).toBe(false)
  })

  it('ignores a dshd-open-surface addressed to another session', () => {
    const b = mount()
    act(() => {
      window.dispatchEvent(new CustomEvent('dshd-open-surface', {
        detail: { kind: 'terminal', sessionId: 'session-2' },
      }))
    })
    expect(b.instance.getSnapshot().bySession['session-1']).toBeUndefined()
    expect(b.instance.getSnapshot().bySession['session-2']).toBeUndefined()
    expect(b.openSurfaces).not.toHaveBeenCalled()
  })

  it('opens on this seat when the event sessionId matches it', () => {
    const b = mount()
    act(() => {
      window.dispatchEvent(new CustomEvent('dshd-open-surface', {
        detail: { kind: 'terminal', sessionId: 'session-1' },
      }))
    })
    expect(b.instance.getSnapshot().bySession['session-1']?.surfaces).toEqual([
      { id: 'terminal:new', kind: 'terminal' },
    ])
    expect(b.openSurfaces).toHaveBeenCalledOnce()
  })

  it('opens the surface without raising the column for a mini presentation', () => {
    const b = mount()
    act(() => {
      window.dispatchEvent(new CustomEvent('dshd-open-surface', {
        detail: { kind: 'preview', presentation: 'mini' },
      }))
    })
    expect(b.instance.getSnapshot().bySession['session-1']?.surfaces.some(s => s.kind === 'preview')).toBe(true)
    expect(b.openSurfaces).not.toHaveBeenCalled()
  })
})
