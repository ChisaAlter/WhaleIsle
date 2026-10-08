// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { SessionLogDownloadController } from '../src/client/controller.ts'
import { SessionLogDownloadHeaderAction, SessionLogDownloadTitlebarAction } from '../src/client/HeaderAction.tsx'
import type { SessionLogDownloadHeaderProps } from '../src/client/HeaderAction.tsx'
import type { SessionLogDownloadDialogProps } from '../src/client/Dialog.tsx'
import { en } from '../src/client/locales.ts'

const SID = 'session-export-header' as SessionId
const BACKGROUND_SID = 'session-export-background' as SessionId

function sessionList(mainViewId: SessionId | undefined, managed = false): SessionListState {
  return {
    ids: [SID, BACKGROUND_SID],
    byId: {
      [SID]: {
        id: SID,
        displayTitle: 'main',
        running: false,
        blank: false,
        retainedBy: mainViewId === SID ? { mainView: 1 } : {},
        updatedAt: 1,
        ...(managed ? { presentation: { owner: 'plugin', title: 'Managed room', composer: 'managed' as const } } : {}),
      },
      [BACKGROUND_SID]: {
        id: BACKGROUND_SID,
        displayTitle: 'background',
        running: false,
        blank: false,
        retainedBy: mainViewId === BACKGROUND_SID ? { mainView: 1 } : {},
        updatedAt: 1,
      },
    },
    phase: 'ready',
    projectionsBySession: {},
  }
}

function bindSnapshot<State>(store: ObservableSnapshot<State>) {
  return function useSnapshot<T>(selector: (state: State) => T): T {
    return useSyncExternalStore(
      listener => store.subscribe(listener),
      () => selector(store.getSnapshot()),
    )
  }
}

function bench(options: {
  feedbackAvailable?: boolean
  sessionId?: SessionId | undefined
  mainViewId?: SessionId | undefined
  managed?: boolean
  controller?: SessionLogDownloadController
} = {}) {
  const controller = options.controller ?? new SessionLogDownloadController(async () => new Response('zip'), vi.fn())
  const request = vi.fn((sessionId: SessionId) => controller.download(sessionId))
  const dismiss = vi.fn((sessionId: SessionId) => { controller.dismiss(sessionId) })
  const openFeedback = vi.fn()
  const feedback = createSnapshotStore(options.feedbackAvailable ?? false)
  const sessionId = 'sessionId' in options ? options.sessionId : SID
  const mainViewId = 'mainViewId' in options ? options.mainViewId : sessionId
  const sessions = createSnapshotStore(sessionList(mainViewId, options.managed))
  const shared = {
    sessionId,
    useSessions: bindSnapshot(sessions),
    useSessionLogDownload: bindSnapshot(controller.store),
    request,
    dismiss,
    t: (key: keyof typeof en): string => en[key],
  }
  const menuProps = {
    ...shared,
    useFeedbackAvailable: bindSnapshot(feedback),
    openFeedback,
  } as unknown as SessionLogDownloadHeaderProps
  const titlebarProps = {
    ...shared,
  } as unknown as SessionLogDownloadDialogProps
  const view = render(<>
    {sessionId !== undefined && <SessionLogDownloadHeaderAction {...menuProps} />}
    <SessionLogDownloadTitlebarAction {...titlebarProps} />
  </>)
  return { controller, request, openFeedback, feedback, sessions, menuProps, titlebarProps, view }
}

afterEach(cleanup)

describe('Session export Header action', () => {
  it('opens Session feedback and closes the menu without starting a download', () => {
    const b = bench({ feedbackAvailable: true })
    fireEvent.click(b.view.getByRole('button', { name: 'More actions' }))
    fireEvent.click(b.view.getByRole('menuitem', { name: 'Feedback' }))
    expect(b.openFeedback).toHaveBeenCalledWith(SID)
    expect(b.request).not.toHaveBeenCalled()
    expect(b.view.queryByRole('menu')).toBeNull()
  })

  it('keeps export in More when feedback is unavailable without a duplicate toolbar button', () => {
    const b = bench()
    expect(b.view.queryByRole('button', { name: 'Download session log' })).toBeNull()
    fireEvent.click(b.view.getByRole('button', { name: 'More actions' }))
    expect(b.view.queryByRole('menuitem', { name: 'Feedback' })).toBeNull()
    expect(b.view.getByRole('menuitem', { name: 'Download session log' })).toBeTruthy()
  })

  it('updates the open menu when feedback becomes available, unloads, and reloads', () => {
    const b = bench()
    fireEvent.click(b.view.getByRole('button', { name: 'More actions' }))
    expect(b.view.queryByRole('menuitem', { name: 'Feedback' })).toBeNull()
    act(() => { b.feedback.set(true) })
    expect(b.view.getByRole('menuitem', { name: 'Feedback' })).toBeTruthy()
    act(() => { b.feedback.set(false) })
    expect(b.view.queryByRole('menuitem', { name: 'Feedback' })).toBeNull()
    expect(b.view.getByRole('menuitem', { name: 'Download session log' })).toBeTruthy()
    act(() => { b.feedback.set(true) })
    fireEvent.click(b.view.getByRole('menuitem', { name: 'Feedback' }))
    expect(b.openFeedback).toHaveBeenCalledWith(SID)
    expect(b.request).not.toHaveBeenCalled()
  })

  it('downloads through More with one modal even if an old titlebar hook still returns true', async () => {
    const b = bench()
    const legacyProps = { useTitlebarAction: vi.fn(() => true) }
    b.view.rerender(<>
      <SessionLogDownloadHeaderAction {...b.menuProps} />
      <SessionLogDownloadTitlebarAction {...b.titlebarProps} {...legacyProps} />
    </>)
    expect(legacyProps.useTitlebarAction).not.toHaveBeenCalled()
    expect(b.view.queryByRole('button', { name: 'Download session log' })).toBeNull()
    const button = b.view.getByRole('button', { name: 'More actions' })
    expect(button.querySelector('svg')).not.toBeNull()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(b.view.getByRole('menuitem', { name: 'Download session log' }))
    await waitFor(() => { expect(b.request).toHaveBeenCalledWith(SID) })
    expect(await b.view.findAllByRole('dialog', { name: 'Session download started' })).toHaveLength(1)
  })

  it('closes the menu on Escape without downloading', () => {
    const b = bench()
    fireEvent.click(b.view.getByRole('button', { name: 'More actions' }))
    expect(b.view.getByRole('menuitem', { name: 'Download session log' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(b.view.queryByRole('menuitem', { name: 'Download session log' })).toBeNull()
    expect(b.request).not.toHaveBeenCalled()
  })

  it('disables download while either entry path downloads this Session, leaving feedback available', async () => {
    let release!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { release = resolve })
    const controller = new SessionLogDownloadController(() => pending, vi.fn())
    const b = bench({ feedbackAvailable: true, controller })
    let download!: Promise<void>
    act(() => { download = controller.download(SID) })
    const button = b.view.getByRole('button', { name: 'More actions' })
    await waitFor(() => { expect(button.getAttribute('aria-busy')).toBe('true') })
    expect(b.view.queryByRole('button', { name: 'Download session log' })).toBeNull()
    fireEvent.click(button)
    expect(b.view.getByRole('menuitem', { name: 'Download session log' })).toHaveProperty('disabled', true)
    expect(b.view.getByRole('menuitem', { name: 'Feedback' })).toHaveProperty('disabled', false)
    await act(async () => { release(new Response('zip')); await download })
    await waitFor(() => { expect(button.getAttribute('aria-busy')).toBe('false') })
  })

  it('shows a command-triggered download result once its Session becomes the main view', async () => {
    const b = bench({ sessionId: undefined, mainViewId: undefined })
    await act(async () => { await b.controller.download(SID) })
    expect(b.view.queryByRole('dialog')).toBeNull()
    act(() => { b.sessions.set(sessionList(SID)) })
    expect(await b.view.findAllByRole('dialog', { name: 'Session download started' })).toHaveLength(1)
    expect(b.view.queryByRole('button', { name: 'Download session log' })).toBeNull()
  })

  it('keeps both entries and the download dialog absent for managed sessions', () => {
    const b = bench({ managed: true, feedbackAvailable: true })
    act(() => { b.controller.store.set({ bySession: { [SID]: { open: true, status: 'success', error: null } } }) })
    expect(b.view.queryByRole('button', { name: 'More actions' })).toBeNull()
    expect(b.view.queryByRole('button', { name: 'Download session log' })).toBeNull()
    expect(b.view.queryByRole('dialog')).toBeNull()
  })
})
