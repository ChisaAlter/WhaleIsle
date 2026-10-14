// @vitest-environment jsdom
/** Exercise the native Sidebar adapters, rather than only their inner viewers. */
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { SidebarFilePreview, type SidebarFilePreviewProps } from '../src/client/FilePreview.tsx'
import { SidebarFilesPanel } from '../src/client/FilesPanel.tsx'
import { DesktopFileState } from '../src/client/desktop-file-state.ts'
import { FileClosePrompt } from '../src/client/FileClosePrompt.tsx'
import { en } from '../src/client/locales.ts'
import type { FilesShellInjected, ReadFileResult } from '../src/client/shell.ts'

const SID = 'owning-session' as SessionId
const FOREGROUND = 'other-session' as SessionId
const ADDRESS = `dsh-resource://file/session/${SID}/src/a.ts`
const t: PropsLocale<'files'>['t'] = key => (en as Record<string, string>)[key] ?? key
const sessions: SessionListState = {
  ids: [SID, FOREGROUND],
  byId: {
    [SID]: { id: SID, displayTitle: 'owning', running: false, blank: false, retainedBy: {}, updatedAt: 1, cwd: '/tmp/owning' },
    [FOREGROUND]: { id: FOREGROUND, displayTitle: 'other', running: false, blank: false, retainedBy: { mainView: 1 }, updatedAt: 1, cwd: '/tmp/other' },
  },
  phase: 'ready', projectionsBySession: {},
}
const useSessions: SidebarFilePreviewProps['useSessions'] = selector => selector(sessions)

function shell(text = 'one\ntwo\nthree'): FilesShellInjected {
  return {
    listDir: async () => ({ ok: true, entries: [{ name: 'page.html', kind: 'file' }, { name: 'report.pdf', kind: 'file' }] }),
    readFile: async () => ({ ok: true, text, binary: false }),
    readFileMedia: async () => ({ ok: false }),
    writeFile: async () => ({ ok: true }),
    mentionFile: vi.fn(),
    appendComposerText: vi.fn(),
  }
}

function fileProps(state: DesktopFileState, injected = shell(), visible = true): SidebarFilePreviewProps {
  return {
    ...injected, t, useSessions, sessionId: SID, openWorkspaceFile: vi.fn(async () => {}),
    useTabInfo: () => ({ tab: { id: 'tab-a' as TabId, contentId: ADDRESS, visible, navigation: { params: undefined, revision: 0 } } }),
    readFileBuffer: address => state.read(address),
    writeFileBuffer: (address, buffer) => { state.write(address, buffer) },
    registerFileSave: (tabId, address, save) => { state.registerSave(tabId, address, save) },
  }
}

function ClosePrompt({ state }: { state: DesktopFileState }) {
  const request = useSyncExternalStore(listener => state.closeRequest.subscribe(listener), () => state.closeRequest.getSnapshot())
  return <FileClosePrompt
    t={t}
    useCloseRequest={selector => selector(request)}
    cancelClose={() => { state.cancelClose() }}
    discardClose={() => { state.discardClose() }}
    saveClose={() => state.saveClose()}
  />
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  localStorage.clear()
})

describe('native Files adapters', () => {
  it('appends the selected lines verbatim to their owning Session', async () => {
    const state = new DesktopFileState()
    const injected = shell()
    render(<SidebarFilePreview {...fileProps(state, injected)} />)
    const editor = await screen.findByLabelText('src/a.ts') as HTMLTextAreaElement
    editor.focus()
    editor.setSelectionRange(0, 8)
    fireEvent.select(editor)
    const add = screen.getByRole('button', { name: 'Add to chat' })
    fireEvent.mouseDown(add)
    fireEvent.click(add)
    expect(injected.appendComposerText).toHaveBeenCalledExactlyOnceWith(SID, 'L1 to L2 `src/a.ts`\n\n```text\none\ntwo\n```')
    expect(injected.mentionFile).not.toHaveBeenCalled()
  })

  it('keeps the debounce save alive while the file tab is hidden', async () => {
    const state = new DesktopFileState()
    let disk = 'disk'
    const injected = shell()
    injected.readFile = async () => ({ ok: true, text: disk, binary: false })
    injected.writeFile = vi.fn<FilesShellInjected['writeFile']>(async (_cwd, _path, text) => { disk = text; return { ok: true } })
    const view = render(<SidebarFilePreview {...fileProps(state, injected)} />)
    const editor = await screen.findByLabelText('src/a.ts')
    vi.useFakeTimers()
    fireEvent.change(editor, { target: { value: 'edited before switching' } })
    expect(new DesktopFileState().read(ADDRESS)?.draft).toBe('edited before switching')
    view.rerender(<SidebarFilePreview {...fileProps(state, injected, false)} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(injected.writeFile).toHaveBeenCalledExactlyOnceWith('/tmp/owning', 'src/a.ts', 'edited before switching')
    expect(state.read(ADDRESS)).toEqual({ text: disk, draft: disk })
  })

  it('preserves a missing-workspace draft without reading or writing another Session cwd', async () => {
    const state = new DesktopFileState()
    state.write(ADDRESS, { text: 'disk', draft: 'edited' })
    const absentSessions: SessionListState = {
      ...sessions, ids: [FOREGROUND], byId: { [FOREGROUND]: sessions.byId[FOREGROUND]! },
    }
    const injected = shell()
    injected.readFile = vi.fn(async () => ({ ok: true, text: 'other Session disk' }))
    injected.writeFile = vi.fn(async () => ({ ok: true }))
    render(<SidebarFilePreview {...fileProps(state, injected)} useSessions={selector => selector(absentSessions)} />)
    await screen.findByLabelText('src/a.ts')
    const proceed = vi.fn(() => true)
    state.requestClose('tab-a', ADDRESS, 'src/a.ts', proceed)
    await act(async () => { await state.saveClose() })
    expect(injected.readFile).not.toHaveBeenCalled()
    expect(injected.writeFile).not.toHaveBeenCalled()
    expect(proceed).not.toHaveBeenCalled()
    expect(state.read(ADDRESS)?.draft).toBe('edited')
  })

  it('retains a failed-save tab and draft, then closes after a successful retry', async () => {
    const state = new DesktopFileState()
    let disk = 'disk'
    let fail = true
    const injected = shell()
    injected.readFile = async () => ({ ok: true, text: disk, binary: false })
    injected.writeFile = vi.fn<FilesShellInjected['writeFile']>(async (_cwd, _path, text) => {
      if (fail) return { ok: false, message: 'disk unavailable' }
      disk = text
      return { ok: true }
    })
    const proceed = vi.fn(() => true)
    render(<><SidebarFilePreview {...fileProps(state, injected)} /><ClosePrompt state={state} /></>)
    const editor = await screen.findByLabelText('src/a.ts')
    fireEvent.change(editor, { target: { value: 'edited' } })
    act(() => { expect(state.requestClose('tab-a', ADDRESS, 'src/a.ts', proceed)).toBe(false) })
    const dialog = screen.getByRole('dialog', { name: 'Unsaved changes' })
    const saveAndClose = within(dialog).getByRole('button', { name: 'Save and close' })
    fireEvent.click(saveAndClose)
    await screen.findByRole('alert')
    expect(proceed).not.toHaveBeenCalled()
    expect(new DesktopFileState().read(ADDRESS)?.draft).toBe('edited')
    expect(screen.getByLabelText('src/a.ts')).toBe(editor)
    expect(within(dialog).getByRole('button', { name: 'Could not save the file.' })).toBe(saveAndClose)
    fail = false
    fireEvent.click(saveAndClose)
    await waitFor(() => { expect(proceed).toHaveBeenCalledOnce() })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(new DesktopFileState().read(ADDRESS)).toBeUndefined()
    expect(disk).toBe('edited')
  })

  it('does not resurrect a discarded draft after an in-flight write completes', async () => {
    const state = new DesktopFileState()
    const injected = shell('disk')
    let complete: (() => void) | undefined
    injected.writeFile = vi.fn(async () => {
      await new Promise<void>((resolve) => { complete = resolve })
      return { ok: true }
    })
    const view = render(<SidebarFilePreview {...fileProps(state, injected)} />)
    const editor = await screen.findByLabelText('src/a.ts')
    vi.useFakeTimers()
    fireEvent.change(editor, { target: { value: 'edited' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(injected.writeFile).toHaveBeenCalledOnce()
    const proceed = vi.fn(() => { view.unmount(); return true })
    state.requestClose('tab-a', ADDRESS, 'src/a.ts', proceed)
    act(() => { state.discardClose() })
    await act(async () => { complete?.(); await Promise.resolve() })
    expect(state.read(ADDRESS)).toBeUndefined()
    expect(new DesktopFileState().read(ADDRESS)).toBeUndefined()
  })

  it('routes tree and search browser documents through the originating Session', async () => {
    const openWorkspaceFile = vi.fn(async () => {})
    render(<SidebarFilesPanel {...shell()} t={t} useSessions={useSessions} sessionId={SID} openWorkspaceFile={openWorkspaceFile} />)
    fireEvent.click(await screen.findByRole('button', { name: /page.html/ }))
    expect(openWorkspaceFile).toHaveBeenCalledWith(SID, '/tmp/owning', 'page.html')
    fireEvent.change(screen.getByRole('textbox', { name: 'Search files' }), { target: { value: 'pdf' } })
    fireEvent.click(await screen.findByRole('button', { name: /report.pdf/ }))
    expect(openWorkspaceFile).toHaveBeenCalledWith(SID, '/tmp/owning', 'report.pdf')
  })

  it('does not restore a discarded buffer when a delayed conflict reread settles', async () => {
    const state = new DesktopFileState()
    const injected = shell('disk')
    const view = render(<SidebarFilePreview {...fileProps(state, injected)} />)
    const editor = await screen.findByLabelText('src/a.ts')
    let complete: ((result: ReadFileResult) => void) | undefined
    injected.readFile = vi.fn(async () => new Promise<ReadFileResult>((resolve) => { complete = resolve }))
    injected.writeFile = vi.fn(async () => ({ ok: true }))
    view.rerender(<SidebarFilePreview {...fileProps(state, injected, false)} />)
    vi.useFakeTimers()
    fireEvent.change(editor, { target: { value: 'edited' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(injected.readFile).toHaveBeenCalledOnce()
    state.requestClose('tab-a', ADDRESS, 'src/a.ts', () => { view.unmount(); return true })
    act(() => { state.discardClose() })
    await act(async () => { complete?.({ ok: true, text: 'external change' }); await Promise.resolve() })
    expect(injected.writeFile).not.toHaveBeenCalled()
    expect(new DesktopFileState().read(ADDRESS)).toBeUndefined()
  })
})
