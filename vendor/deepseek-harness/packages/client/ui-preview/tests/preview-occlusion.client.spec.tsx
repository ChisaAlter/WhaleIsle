// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PreviewPanelProps } from '../src/client/PreviewPanel.tsx'
import { PreviewPanel, SidebarPreviewPanel } from '../src/client/PreviewPanel.tsx'
import { DshdMiniPlayer } from '../src/client/DshdMiniPlayer.tsx'
import { clearMiniPlayer, openMiniPlayer, readMiniPlayer } from '../src/client/mini-player-state.ts'
import { en } from '../src/client/locales.ts'

const t: PreviewPanelProps['t'] = key => (en as Record<string, string>)[key] ?? key
const neverHook = (() => { throw new Error('preview must not read this hook') }) as never
type SessionState = {
  byId: Record<string, { id: SessionId; retainedBy: { mainView?: number }; cwd?: string }>
}

function stubHostRect(): void {
  const host = document.querySelector('[data-preview-host]') as HTMLElement
  host.getBoundingClientRect = () => ({
    x: 800,
    y: 40,
    width: 400,
    height: 600,
    top: 40,
    left: 800,
    right: 1200,
    bottom: 640,
    toJSON() { return this },
  })
}

function mount(sidebar = false, guestId = 'pv-occluded'): {
  rerender: ReturnType<typeof render>['rerender']
  container: HTMLElement
  previewHide: ReturnType<typeof vi.fn>
  previewShow: ReturnType<typeof vi.fn>
  previewClose: ReturnType<typeof vi.fn>
  props: PreviewPanelProps
} {
  const previewHide = vi.fn(async () => {})
  const previewShow = vi.fn(async () => {})
  const previewClose = vi.fn(async () => {})
  const sessionId = `session-${guestId}` as SessionId
  const props = {
    sessionId,
    useSession: neverHook,
    useSessions: (sel: (s: SessionState) => unknown) =>
      sel({
        byId: {
          [sessionId]: {
            id: sessionId,
            retainedBy: {},
          },
        },
      }),
    useWorkspaces: neverHook,
    useProjection: neverHook,
    active: true,
    occluded: false,
    previewAvailable: true,
    previewOpen: vi.fn(async () => ({
      ok: true,
      id: guestId,
      url: 'http://127.0.0.1:3000',
    })),
    previewNavigate: vi.fn(async () => ({ ok: true, id: 'pv-occluded' })),
    previewBack: vi.fn(async () => ({ ok: true, id: 'pv-occluded' })),
    previewForward: vi.fn(async () => ({ ok: true, id: 'pv-occluded' })),
    previewReload: vi.fn(async () => ({ ok: true, id: 'pv-occluded' })),
    previewState: vi.fn(async () => ({ ok: true, id: 'pv-occluded' })),
    onPreviewStateChange: () => () => {},
    previewOpenDevTools: vi.fn(async () => ({ ok: true, id: 'pv-occluded' })),
    previewDiscover: vi.fn(async () => []),
    openExternal: vi.fn(async () => {}),
    previewResize: vi.fn(async () => {}),
    previewHide,
    previewShow,
    previewClose,
    t,
  } as unknown as PreviewPanelProps
  const view = render(sidebar
    ? <SidebarPreviewPanel {...props} useTabInfo={() => ({ tab: { visible: true } })} />
    : <PreviewPanel {...props} />)
  return { rerender: view.rerender, container: view.container, previewHide, previewShow, previewClose, props }
}

class ResizeObserverStub {
  constructor(_callback: ResizeObserverCallback) {}
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(() => {
  cleanup()
  clearMiniPlayer()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('PreviewPanel native guest occlusion', () => {
  it.each(['surface', 'sidebar', 'mini'] as const)('yields the %s native presentation to a real foreground Modal and restores the same guest', async (kind) => {
    const b = mount(kind !== 'surface')
    stubHostRect()
    fireEvent.change(screen.getByRole('textbox', { name: 'Browser' }), { target: { value: 'http://127.0.0.1:3000' } })
    fireEvent.submit(document.querySelector('[data-preview-toolbar]') as HTMLFormElement)
    await waitFor(() => expect(b.previewShow).toHaveBeenCalled())
    let frame: HTMLElement | undefined
    onTestFinished(() => { frame?.remove() })
    if (kind === 'mini') {
      frame = document.createElement('div')
      frame.dataset.shellOverlay = ''
      const chat = document.createElement('div')
      chat.dataset.conversationScroll = ''
      chat.getBoundingClientRect = () => ({ left: 0, top: 40, width: 800, height: 600, right: 800, bottom: 640 }) as DOMRect
      frame.append(chat)
      document.body.append(frame)
      const original = HTMLElement.prototype.getBoundingClientRect
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        return this.matches('[data-preview-mini-player-viewport]')
          ? ({ left: 480, top: 68, width: 320, height: 172, right: 800, bottom: 240 }) as DOMRect
          : original.call(this)
      })
      act(() => { openMiniPlayer('pv-occluded', 'result.html') })
      render(<DshdMiniPlayer {...({ t } as Parameters<typeof DshdMiniPlayer>[0])} />)
      await waitFor(() => expect(b.previewShow).toHaveBeenLastCalledWith('pv-occluded', { x: 480, y: 68, width: 320, height: 172, radius: 0 }))
    }
    const miniGeometry = readMiniPlayer().geometry
    const modalProps = { title: 'Project results', closeLabel: 'Close', onClose: vi.fn() }
    const overlay = render(<Modal {...modalProps} open={false}>Original results and draft</Modal>)
    const hides = b.previewHide.mock.calls.length
    overlay.rerender(<Modal {...modalProps} open>Original results and draft</Modal>)
    await waitFor(() => expect(b.previewHide.mock.calls.length).toBeGreaterThan(hides))
    expect(b.previewHide).toHaveBeenLastCalledWith('pv-occluded')
    const shows = b.previewShow.mock.calls.length
    fireEvent.resize(window)
    expect(b.previewShow).toHaveBeenCalledTimes(shows)
    expect(b.previewClose).not.toHaveBeenCalled()
    expect(b.props.previewNavigate).not.toHaveBeenCalled()
    if (kind === 'mini') {
      expect(readMiniPlayer()).toMatchObject({ previewId: 'pv-occluded', open: true, suspended: true, geometry: miniGeometry })
    }

    // aria-hidden retires the exit frame immediately; the guest can reclaim
    // its original presenter without closing its tab or changing history.
    overlay.rerender(<Modal {...modalProps} open={false}>Original results and draft</Modal>)
    await waitFor(() => expect(b.previewShow.mock.calls.length).toBeGreaterThan(shows))
    expect(b.previewShow).toHaveBeenLastCalledWith('pv-occluded', expect.anything())
    expect(b.previewClose).not.toHaveBeenCalled()
    expect(b.props.previewNavigate).not.toHaveBeenCalled()
    if (kind === 'mini') expect(readMiniPlayer()).toMatchObject({ previewId: 'pv-occluded', open: true, suspended: false, geometry: miniGeometry })
  })

  it('keeps the current mini guest suspended when a retained panel releases foreground occlusion', async () => {
    const current = mount()
    const retained = mount(false, 'pv-retained')
    // Both panels stay mounted; the retained panel owns an older guest.
    fireEvent.change(retained.container.querySelector('input') as HTMLInputElement, { target: { value: 'http://127.0.0.1:3000/old' } })
    fireEvent.submit(retained.container.querySelector('[data-preview-toolbar]') as HTMLFormElement)
    await waitFor(() => expect(readMiniPlayer().previewId).toBe('pv-retained'))
    stubHostRect()
    fireEvent.change(current.container.querySelector('input') as HTMLInputElement, { target: { value: 'http://127.0.0.1:3000/result' } })
    fireEvent.submit(current.container.querySelector('[data-preview-toolbar]') as HTMLFormElement)
    await waitFor(() => expect(current.previewShow).toHaveBeenCalled())

    const frame = document.createElement('div')
    frame.dataset.shellOverlay = ''
    const chat = document.createElement('div')
    chat.dataset.conversationScroll = ''
    chat.getBoundingClientRect = () => ({ left: 0, top: 40, width: 800, height: 600, right: 800, bottom: 640 }) as DOMRect
    frame.append(chat)
    document.body.append(frame)
    onTestFinished(() => { frame.remove() })
    const original = HTMLElement.prototype.getBoundingClientRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.matches('[data-preview-mini-player-viewport]')
        ? ({ left: 480, top: 68, width: 320, height: 172, right: 800, bottom: 240 }) as DOMRect
        : original.call(this)
    })
    act(() => { openMiniPlayer('pv-occluded', 'result.html') })
    render(<DshdMiniPlayer {...({ t } as Parameters<typeof DshdMiniPlayer>[0])} />)
    await waitFor(() => expect(current.previewShow).toHaveBeenLastCalledWith('pv-occluded', { x: 480, y: 68, width: 320, height: 172, radius: 0 }))
    const hides = current.previewHide.mock.calls.length
    const modalProps = { title: 'Project results', closeLabel: 'Close', onClose: vi.fn() }
    const overlay = render(<Modal {...modalProps} open>Original results</Modal>)
    await waitFor(() => expect(current.previewHide.mock.calls.length).toBeGreaterThan(hides))
    expect(readMiniPlayer()).toMatchObject({ previewId: 'pv-occluded', open: true, suspended: true })
    current.props.occluded = true
    current.rerender(<PreviewPanel {...current.props} />)
    const shows = current.previewShow.mock.calls.length
    await act(async () => {
      overlay.rerender(<Modal {...modalProps} open={false}>Original results</Modal>)
    })
    // Closing the common Modal changes the old panel's false occlusion, while
    // the current guest's own seat remains covered. It must keep ownership.
    expect(readMiniPlayer()).toMatchObject({ previewId: 'pv-occluded', open: true, suspended: true })
    fireEvent.resize(window)
    expect(current.previewShow).toHaveBeenCalledTimes(shows)

    current.props.occluded = false
    current.rerender(<PreviewPanel {...current.props} />)
    await waitFor(() => expect(current.previewShow.mock.calls.length).toBeGreaterThan(shows))
    expect(current.previewShow).toHaveBeenLastCalledWith('pv-occluded', expect.anything())
    expect(readMiniPlayer()).toMatchObject({ previewId: 'pv-occluded', open: true, suspended: false })
    expect(current.previewClose).not.toHaveBeenCalled()
    expect(retained.previewClose).not.toHaveBeenCalled()
    expect(current.props.previewNavigate).not.toHaveBeenCalled()
    expect(retained.props.previewNavigate).not.toHaveBeenCalled()
  })

  it('hides the native guest while renderer chrome is open and restores it afterward', async () => {
    const b = mount()
    stubHostRect()
    fireEvent.change(screen.getByRole('textbox', { name: 'Browser' }), {
      target: { value: 'http://127.0.0.1:3000' },
    })
    fireEvent.submit(document.querySelector('[data-preview-toolbar]') as HTMLFormElement)
    await waitFor(() => {
      expect(b.previewShow).toHaveBeenCalledWith('pv-occluded', expect.objectContaining({ width: 400, height: 600 }))
    })

    const hideCalls = b.previewHide.mock.calls.length
    b.props.occluded = true
    b.rerender(<PreviewPanel {...b.props} />)
    await waitFor(() => {
      expect(b.previewHide.mock.calls.length).toBeGreaterThan(hideCalls)
    })

    const showCalls = b.previewShow.mock.calls.length
    b.props.occluded = false
    b.rerender(<PreviewPanel {...b.props} />)
    await waitFor(() => {
      expect(b.previewShow.mock.calls.length).toBeGreaterThan(showCalls)
    })
  })

  it('hides the native guest while the More menu is open', async () => {
    const b = mount()
    stubHostRect()
    fireEvent.change(screen.getByRole('textbox', { name: 'Browser' }), {
      target: { value: 'http://127.0.0.1:3000' },
    })
    fireEvent.submit(document.querySelector('[data-preview-toolbar]') as HTMLFormElement)
    await waitFor(() => {
      expect(b.previewShow).toHaveBeenCalled()
    })
    const hideCalls = b.previewHide.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    await waitFor(() => {
      expect(b.previewHide.mock.calls.length).toBeGreaterThan(hideCalls)
    })
    expect(screen.getByRole('menuitem', { name: 'Developer tools' })).toBeTruthy()
  })
})
