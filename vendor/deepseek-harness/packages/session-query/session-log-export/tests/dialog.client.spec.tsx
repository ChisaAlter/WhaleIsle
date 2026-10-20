// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SessionLogDownloadController } from '../src/client/controller.ts'
import { SessionLogDownloadDialog } from '../src/client/Dialog.tsx'
import type { SessionLogDownloadDialogProps } from '../src/client/Dialog.tsx'
import { en } from '../src/client/locales.ts'

const SID = 'session-export-dialog' as SessionId

function bench(
  controller = new SessionLogDownloadController(
    async () => new Response('zip', { status: 200 }), vi.fn(),
  ),
) {
  const dismiss = vi.fn((sessionId: SessionId) => { controller.dismiss(sessionId) })
  function useSessionLogDownload<T>(selector: (state: ReturnType<typeof controller.store.getSnapshot>) => T): T {
    return useSyncExternalStore(
      listener => controller.store.subscribe(listener),
      () => selector(controller.store.getSnapshot()),
    )
  }
  const t = (key: keyof typeof en): string => en[key]
  const props = { sessionId: SID, useSessionLogDownload, dismiss, t } as unknown as SessionLogDownloadDialogProps & { sessionId: SessionId }
  const view = render(<SessionLogDownloadDialog {...props} />)
  return { controller, dismiss, view }
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }) })
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('SessionLogDownloadDialog', () => {
  it('shows a controller failure and dismisses it after fading without reading Session history', async () => {
    const b = bench()
    act(() => {
      b.controller.store.set({
        bySession: { [SID]: { open: true, status: 'error', error: 'toolbar failed' } },
      })
    })
    expect(b.view.getByRole('alert').textContent).toBe('toolbar failed')
    expect(b.view.queryByRole('button', { name: 'Close' })).toBeNull()
    expect(b.dismiss).not.toHaveBeenCalled()
    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    expect(b.dismiss).toHaveBeenCalledExactlyOnceWith(SID)
    expect(b.view.queryByRole('alert')).toBeNull()
  })

  it('renders the in-flight state and the settled browser download state', async () => {
    let release!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { release = resolve })
    const fetcher = vi.fn(() => pending)
    const save = vi.fn()
    const controller = new SessionLogDownloadController(fetcher, save)
    const b = bench(controller)

    let download!: Promise<void>
    act(() => { download = controller.download(SID) })
    expect(b.view.getByRole('alert').textContent).toBe('Preparing a ZIP containing this Session, its sub-Sessions, and attachments.')
    await act(async () => {
      release(new Response('zip', { status: 200 }))
      await download
    })
    expect(b.view.getAllByRole('alert')).toHaveLength(1)
    expect(b.view.getByRole('alert').textContent).toBe('Session download started')
    expect(fetcher).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledOnce()
    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    expect(b.dismiss).toHaveBeenCalledExactlyOnceWith(SID)
    expect(b.view.queryByRole('alert')).toBeNull()
  })

  it('uses fallback copy when a failure has no detail', async () => {
    const b = bench()
    act(() => {
      b.controller.store.set({
        bySession: { [SID]: { open: true, status: 'error', error: '' } },
      })
    })
    expect(b.view.getByRole('alert').textContent).toBe('Could not start the Session export.')
    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    expect(b.dismiss).toHaveBeenCalledExactlyOnceWith(SID)
    expect(b.view.queryByRole('alert')).toBeNull()
  })
})
