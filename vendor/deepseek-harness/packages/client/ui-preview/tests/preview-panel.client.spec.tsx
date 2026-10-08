// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PreviewPanelProps } from '../src/client/PreviewPanel.tsx'
import { PreviewPanel } from '../src/client/PreviewPanel.tsx'
import { en, zh } from '../src/client/locales.ts'
import { clearMiniPlayer, closeMiniPlayer, openMiniPlayer, readMiniPlayer } from '../src/client/mini-player-state.ts'
import type { PreviewBounds, PreviewNavState, PreviewPickScreenshot, PreviewResult } from '../src/client/shell.ts'

const t: PreviewPanelProps['t'] = key => (en as Record<string, string>)[key] ?? key
const neverHook = (() => { throw new Error('preview must not read this hook') }) as never
const SID = 'session-preview' as SessionId
const BACKGROUND_SID = 'session-preview-background' as SessionId
type SessionState = {
  byId: Record<string, {
    id: SessionId
    cwd?: string
    retainedBy: { mainView?: number }
  }>
}

function sessionList(cwd?: string, mainView = true): SessionState {
  return {
    byId: {
      [SID]: {
        id: SID,
        retainedBy: mainView ? { mainView: 1 } : {},
        ...(cwd ? { cwd } : {}),
      },
      [BACKGROUND_SID]: {
        id: BACKGROUND_SID,
        retainedBy: {},
        cwd: '/tmp/background',
      },
    },
  }
}

const okNav = async (): Promise<PreviewNavState> => ({
  ok: true, id: 'pv-1', url: 'http://127.0.0.1:3000', canGoBack: true, canGoForward: true,
})

function mount(opts: {
  available?: boolean
  cwd?: string
  t?: PreviewPanelProps['t']
  open?: (input: { url: string; bounds?: unknown; scope?: string }) => Promise<PreviewResult>
  discover?: () => Promise<{ url: string; port: number }[]>
  onPreviewStateChange?: (handler: (state: PreviewNavState) => void) => () => void
  previewPickElement?: PreviewPanelProps['previewPickElement']
  previewSetAnnotationTheme?: PreviewPanelProps['previewSetAnnotationTheme']
  previewCaptureScreenshot?: PreviewPanelProps['previewCaptureScreenshot']
  appendComposerText?: PreviewPanelProps['appendComposerText']
  sessionCurrent?: typeof SID | undefined
} = {}) {
  const previewOpen = vi.fn(opts.open ?? (async () => ({
    ok: true,
    id: 'pv-1',
    url: 'http://127.0.0.1:3000',
    canGoBack: true,
    canGoForward: true,
  })))
  const previewNavigate = vi.fn(async (): Promise<PreviewResult> => ({
    ok: true, id: 'pv-1', url: 'http://127.0.0.1:3000',
  }))
  const previewResize = vi.fn(async (_id: string, _bounds: PreviewBounds) => {})
  const previewHide = vi.fn(async () => {})
  const previewShow = vi.fn(async (_id: string, _bounds?: PreviewBounds) => {})
  const previewDiscover = vi.fn(opts.discover ?? (async () => []))
  const openExternal = vi.fn(async () => {})
  const previewClose = vi.fn(async () => {})
  const previewBack = vi.fn(okNav)
  const previewForward = vi.fn(okNav)
  const previewReload = vi.fn(okNav)
  const previewHardReload = vi.fn(okNav)
  const previewStop = vi.fn(okNav)
  const previewZoomIn = vi.fn(okNav)
  const previewZoomOut = vi.fn(okNav)
  const previewResetZoom = vi.fn(okNav)
  const previewSetColorScheme = vi.fn(okNav)
  const previewClearCookies = vi.fn(async () => ({ ok: true }))
  const previewClearCache = vi.fn(async () => ({ ok: true }))
  const previewCaptureScreenshot = vi.fn(opts.previewCaptureScreenshot ?? (async () => ({
    ok: true,
    path: '/tmp/shot.png',
    pngBase64: '',
  })))
  const previewRevealArtifact = vi.fn(async () => ({ ok: true }))
  const previewOpenPictureInPicture = vi.fn(async () => ({ ok: true }))
  const previewClosePictureInPicture = vi.fn(async () => ({ ok: true }))
  const previewPickElement = vi.fn(opts.previewPickElement ?? (async () => ({ ok: true })))
  const previewSetAnnotationTheme = vi.fn(opts.previewSetAnnotationTheme ?? (async () => ({ ok: true })))
  const previewCancelPick = vi.fn(async () => ({ ok: true }))
  let recordingFrameHandler: ((frame: {
    id: string
    data: string
    width: number
    height: number
  }) => void) | null = null
  const onPreviewRecordingFrame = vi.fn((handler: (frame: {
    id: string
    data: string
    width: number
    height: number
  }) => void) => {
    recordingFrameHandler = handler
    return () => {
      if (recordingFrameHandler === handler) recordingFrameHandler = null
    }
  })
  const previewSaveRecording = vi.fn(async () => ({ ok: true, path: '/tmp/rec.webm' }))
  const previewStartRecording = vi.fn(async (id: string) => {
    recordingFrameHandler?.({ id, data: 'frame', width: 800, height: 600 })
    return { ok: true }
  })
  const previewStopRecording = vi.fn(async () => ({ ok: true }))
  const previewOpenDevTools = vi.fn(async () => ({ ok: true, id: 'pv-1' }))
  render(
    <PreviewPanel {...({
      sessionId: SID,
      useSession: neverHook,
      useSessions: (sel: (s: SessionState) => unknown) => sel(sessionList(
        opts.cwd,
        Object.prototype.hasOwnProperty.call(opts, 'sessionCurrent') ? opts.sessionCurrent !== undefined : true,
      )),
      useWorkspaces: neverHook,
      useProjection: neverHook,
      active: true,
      previewAvailable: opts.available ?? true,
      previewOpen,
      previewNavigate,
      previewResize,
      previewHide,
      previewShow,
      previewClose,
      previewBack,
      previewForward,
      previewReload,
      previewHardReload,
      previewStop,
      previewZoomIn,
      previewZoomOut,
      previewResetZoom,
      previewSetColorScheme,
      previewClearCookies,
      previewClearCache,
      previewCaptureScreenshot,
      previewRevealArtifact,
      previewOpenPictureInPicture,
      previewClosePictureInPicture,
      previewPickElement,
      previewSetAnnotationTheme,
      previewCancelPick,
      appendComposerText: opts.appendComposerText,
      previewStartRecording,
      previewStopRecording,
      onPreviewRecordingFrame,
      previewSaveRecording,
      previewState: vi.fn(async () => ({ ok: true, id: 'pv-1', url: 'http://127.0.0.1:3000' })),
      onPreviewStateChange: opts.onPreviewStateChange ?? (() => () => {}),
      previewOpenDevTools,
      previewDiscover,
      openExternal,
      t: opts.t ?? t,
    } as unknown as PreviewPanelProps)} />,
  )
  return {
    previewOpen,
    previewNavigate,
    previewResize,
    previewHide,
    previewShow,
    previewClose,
    previewBack,
    previewForward,
    previewReload,
    previewHardReload,
    previewStop,
    previewZoomIn,
    previewZoomOut,
    previewResetZoom,
    previewSetColorScheme,
    previewClearCookies,
    previewClearCache,
    previewCaptureScreenshot,
    previewRevealArtifact,
    previewOpenPictureInPicture,
    previewClosePictureInPicture,
    previewPickElement,
    previewSetAnnotationTheme,
    previewCancelPick,
    previewStartRecording,
    previewStopRecording,
    onPreviewRecordingFrame,
    previewSaveRecording,
    previewOpenDevTools,
    previewDiscover,
    openExternal,
  }
}

function openMore(name = 'More'): void {
  fireEvent.click(screen.getByRole('button', { name }))
}

function openAppearanceSubmenu(name = 'Appearance'): void {
  const appearance = screen.getByRole('menuitem', { name })
  fireEvent.focus(appearance)
  fireEvent.mouseEnter(appearance.parentElement as HTMLElement)
}

function submitBar(): void {
  fireEvent.submit(document.querySelector('[data-preview-toolbar]') as HTMLFormElement)
}

function typeUrl(value: string): void {
  fireEvent.change(screen.getByRole('textbox', { name: 'Browser' }), { target: { value } })
}

function stubHostRect(rect: { x: number; y: number; width: number; height: number }): HTMLElement {
  const host = document.querySelector('[data-preview-host]') as HTMLElement
  host.getBoundingClientRect = () => ({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.y,
    left: rect.x,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    toJSON() { return this },
  })
  return host
}

function guestRectsAfter(
  b: ReturnType<typeof mount>,
  showBefore: number,
  resizeBefore: number,
): Array<{ x: number; y: number; width: number; height: number }> {
  return [
    ...b.previewShow.mock.calls.slice(showBefore).map(call => call[1]),
    ...b.previewResize.mock.calls.slice(resizeBefore).map(call => call[1]),
  ].filter((rect): rect is { x: number; y: number; width: number; height: number } =>
    rect !== undefined && typeof rect.width === 'number' && typeof rect.height === 'number')
}

async function openGuest(b: ReturnType<typeof mount>): Promise<void> {
  stubHostRect({ x: 800, y: 40, width: 400, height: 600 })
  typeUrl('http://127.0.0.1:3000')
  submitBar()
  await waitFor(() => {
    expect(b.previewOpen).toHaveBeenCalled()
  })
  await waitFor(() => {
    expect(b.previewShow).toHaveBeenCalledWith('pv-1', expect.objectContaining({
      x: 800, y: 40, width: 400, height: 600,
    }))
  })
}

class ResizeObserverStub {
  constructor(_callback: ResizeObserverCallback) {}
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}

class FakeMediaRecorder {
  static isTypeSupported(): boolean {
    return true
  }

  state: RecordingState = 'inactive'
  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  start(): void {
    this.state = 'recording'
  }

  stop(): void {
    this.state = 'inactive'
    for (const listener of this.listeners.get('stop') ?? []) {
      if (typeof listener === 'function') listener(new Event('stop'))
      else listener.handleEvent(new Event('stop'))
    }
  }
}

class ImmediateImage {
  private loadListener: EventListenerOrEventListenerObject | undefined

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'load') this.loadListener = listener
  }

  set src(_value: string) {
    const event = new Event('load')
    if (typeof this.loadListener === 'function') this.loadListener(event)
    else this.loadListener?.handleEvent(event)
  }
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder as unknown as typeof MediaRecorder)
  vi.stubGlobal('Image', ImmediateImage as unknown as typeof Image)
  const nativeCreateElement = Document.prototype.createElement
  const htmlDocument: { createElement(tag: string, options?: ElementCreationOptions): HTMLElement } = document
  vi.spyOn(htmlDocument, 'createElement').mockImplementation(function createElement(
    this: Document,
    tag: string,
    options?: ElementCreationOptions,
  ) {
    if (tag === 'canvas') {
      return {
        width: 0,
        height: 0,
        captureStream: () => ({}),
        getContext: () => ({ drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '' }),
      } as unknown as HTMLCanvasElement
    }
    return Reflect.apply(nativeCreateElement, this, [tag, options]) as HTMLElement
  })
})

afterEach(() => {
  cleanup()
  clearMiniPlayer()
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  try {
    sessionStorage.clear()
  } catch {
    // jsdom sessionStorage may throw when locked in other tests.
  }
})

describe('PreviewPanel', () => {
  it('shows Chinese unavailable copy when preview IPC is absent', () => {
    const zhT: PreviewPanelProps['t'] = key => {
      const zh = {
        title: '\u6d4f\u89c8\u5668',
        unavailable: '\u6d4f\u89c8\u5668\u9884\u89c8\u4ec5\u5728\u684c\u9762\u5e94\u7528\u4e2d\u53ef\u7528\u3002',
      } as Record<string, string>
      return zh[key] ?? key
    }
    render(
      <PreviewPanel {...({
        sessionId: SID,
        useSession: neverHook,
        useSessions: (sel: (s: SessionState) => unknown) => sel(sessionList()),
        useWorkspaces: neverHook,
        useProjection: neverHook,
        active: true,
        previewAvailable: false,
        previewOpen: async () => ({ ok: false }),
        previewNavigate: async () => ({ ok: false }),
        previewResize: async () => {},
        previewHide: async () => {},
        previewShow: async () => {},
        previewClose: async () => {},
        t: zhT,
      } as unknown as PreviewPanelProps)} />,
    )
    expect(screen.getByText('\u6d4f\u89c8\u5668\u9884\u89c8\u4ec5\u5728\u684c\u9762\u5e94\u7528\u4e2d\u53ef\u7528\u3002')).toBeTruthy()
  })

  it('shows the disabled reason when preview IPC is unavailable', () => {
    mount({ available: false })
    expect(screen.getByText('Browser previews are only available in the desktop app.')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Browser' })).toBeNull()
  })

  it('catches a thrown previewOpen and shows the rejected copy', async () => {
    mount({
      open: async () => { throw new Error('unknown preview id') },
    })
    typeUrl('http://127.0.0.1:3000')
    submitBar()
    expect(await screen.findByText('Invalid URL or unsupported protocol.')).toBeTruthy()
  })

  it('opens http://127.0.0.1 through previewOpen with shared scope', async () => {
    const b = mount()
    typeUrl('http://127.0.0.1:4173')
    submitBar()
    await waitFor(() => {
      expect(b.previewOpen).toHaveBeenCalledWith(expect.objectContaining({
        url: 'http://127.0.0.1:4173/',
        scope: 'shared',
      }))
    })
  })

  it('updates the address bar from guest navigation', async () => {
    let send: (state: PreviewNavState) => void = () => {}
    const b = mount({
      onPreviewStateChange: (handler) => {
        send = handler
        return () => {}
      },
    })
    await openGuest(b)
    send({
      ok: true,
      id: 'other',
      url: 'http://127.0.0.1:9',
      canGoBack: true,
      canGoForward: false,
    })
    expect((screen.getByRole('textbox', { name: 'Browser' }) as HTMLInputElement).value).toBe('http://127.0.0.1:3000')
    act(() => {
      send({
        ok: true,
        id: 'pv-1',
        url: 'http://127.0.0.1:3000/app',
        canGoBack: true,
        canGoForward: false,
      })
    })
    expect((screen.getByRole('textbox', { name: 'Browser' }) as HTMLInputElement).value).toBe('http://127.0.0.1:3000/app')
    expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(false)
  })
  it('opens https://example.com through previewOpen', async () => {
    const b = mount()
    typeUrl('https://example.com')
    submitBar()
    await waitFor(() => {
      expect(b.previewOpen).toHaveBeenCalledWith(expect.objectContaining({
        url: 'https://example.com/',
        scope: 'shared',
      }))
    })
  })

  it('normalizes a bare public host then opens it', async () => {
    const b = mount()
    typeUrl('example.com')
    expect((screen.getByRole('textbox', { name: 'Browser' }) as HTMLInputElement).value).toBe('example.com')
    submitBar()
    await waitFor(() => {
      expect(b.previewOpen).toHaveBeenCalledWith(expect.objectContaining({
        url: 'https://example.com/',
        scope: 'shared',
      }))
    })
  })

  it('passes session cwd as previewOpen scope', async () => {
    const b = mount({ cwd: '/tmp/proj' })
    typeUrl('https://example.com')
    submitBar()
    await waitFor(() => {
      expect(b.previewOpen).toHaveBeenCalledWith(expect.objectContaining({
        url: 'https://example.com/',
        scope: '/tmp/proj',
      }))
    })
  })

  it('shows rejected copy when the typed URL cannot be normalized', async () => {
    const b = mount()
    typeUrl('ftp://example.com')
    submitBar()
    expect(await screen.findByText('Invalid URL or unsupported protocol.')).toBeTruthy()
    expect(b.previewOpen).not.toHaveBeenCalled()
  })

  it('hides the guest when the host rect is empty and shows it when the host is non-zero again', async () => {
    const b = mount()
    await openGuest(b)

    stubHostRect({ x: 800, y: 40, width: 0, height: 600 })
    fireEvent(window, new Event('resize'))
    await waitFor(() => {
      expect(b.previewHide).toHaveBeenCalledWith('pv-1')
    })

    stubHostRect({ x: 800, y: 40, width: 400, height: 600 })
    fireEvent(window, new Event('resize'))
    await waitFor(() => {
      expect(b.previewShow).toHaveBeenCalledTimes(2)
      expect(b.previewShow).toHaveBeenLastCalledWith('pv-1', expect.objectContaining({
        x: 800, y: 40, width: 400, height: 600,
      }))
    })
  })

  it('hands the guest to chat float and back without a stale surface hide', async () => {
    const b = mount()
    await openGuest(b)
    const hides = b.previewHide.mock.calls.length
    act(() => { openMiniPlayer('pv-1') })
    expect(b.previewHide).toHaveBeenCalledTimes(hides)
    const shows = b.previewShow.mock.calls.length
    act(() => { closeMiniPlayer() })
    await waitFor(() => {
      expect(b.previewShow.mock.calls.length).toBeGreaterThan(shows)
      expect(b.previewShow).toHaveBeenLastCalledWith('pv-1', expect.objectContaining({
        x: 800, y: 40, width: 400, height: 600,
      }))
    })
  })

  it('syncs final dock bounds after the slide when returning a chat float', async () => {
    const b = mount()
    await openGuest(b)
    act(() => { openMiniPlayer('pv-1') })
    const host = stubHostRect({ x: 1442, y: 98, width: 539, height: 822 })
    act(() => { closeMiniPlayer() })
    await waitFor(() => {
      expect(b.previewShow).toHaveBeenLastCalledWith('pv-1', { x: 1442, y: 98, width: 539, height: 822 })
    })
    // The dock's ancestor finishes translating while the host keeps its size.
    stubHostRect({ x: 902, y: 98, width: 539, height: 822 })
    fireEvent.transitionEnd(host.parentElement as HTMLElement, { propertyName: 'transform' })
    await waitFor(() => {
      expect(b.previewResize).toHaveBeenLastCalledWith('pv-1', { x: 902, y: 98, width: 539, height: 822 })
    })
  })

  it('hides the guest when a collapsed right panel closes the float', async () => {
    const b = mount()
    await openGuest(b)
    act(() => { openMiniPlayer('pv-1') })
    // The surfaces column is closed: the panel host has no box to present.
    stubHostRect({ x: 0, y: 0, width: 0, height: 0 })
    const hides = b.previewHide.mock.calls.length
    act(() => { closeMiniPlayer() })
    await waitFor(() => {
      expect(b.previewHide.mock.calls.length).toBeGreaterThan(hides)
      expect(b.previewHide).toHaveBeenLastCalledWith('pv-1')
    })
  })

  it('pushes a new origin through previewResize when the window resizes', async () => {
    const b = mount()
    await openGuest(b)

    fireEvent(window, new Event('resize'))
    stubHostRect({ x: 520, y: 40, width: 400, height: 600 })
    fireEvent(window, new Event('resize'))
    await waitFor(() => {
      expect(b.previewResize).toHaveBeenCalledWith('pv-1', expect.objectContaining({
        x: 520, y: 40, width: 400, height: 600,
      }))
    })
  })

  it('opens a pending URL from sessionStorage and a later dshd-open-surface event', async () => {
    sessionStorage.setItem('dshd-pending-preview-url', 'http://127.0.0.1:4173')
    const b = mount()
    stubHostRect({ x: 800, y: 40, width: 400, height: 600 })
    await waitFor(() => {
      expect(b.previewOpen).toHaveBeenCalledWith(expect.objectContaining({
        url: 'http://127.0.0.1:4173/',
      }))
    })
    expect(sessionStorage.getItem('dshd-pending-preview-url')).toBeNull()
    window.dispatchEvent(new CustomEvent('dshd-open-surface', { detail: { kind: 'preview' } }))
    window.dispatchEvent(new CustomEvent('dshd-open-surface', { detail: { url: 'http://127.0.0.1:3000' } }))
    await waitFor(() => {
      expect(b.previewNavigate).toHaveBeenCalledWith('pv-1', 'http://127.0.0.1:3000/')
    })
  })

  it('ignores a dshd-open-surface event tagged for another session', async () => {
    const b = mount()
    window.dispatchEvent(new CustomEvent('dshd-open-surface', {
      detail: { url: 'http://127.0.0.1:4000', sessionId: BACKGROUND_SID },
    }))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(b.previewOpen).not.toHaveBeenCalled()
    window.dispatchEvent(new CustomEvent('dshd-open-surface', {
      detail: { url: 'http://127.0.0.1:4000', sessionId: SID },
    }))
    await waitFor(() => {
      expect(b.previewOpen).toHaveBeenCalledWith(expect.objectContaining({
        url: 'http://127.0.0.1:4000/',
      }))
    })
  })

  it('leaves a pending URL tagged for another session for that seat', async () => {
    sessionStorage.setItem('dshd-pending-preview-url', 'http://127.0.0.1:4173')
    sessionStorage.setItem('dshd-pending-preview-session', BACKGROUND_SID)
    const b = mount()
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(b.previewOpen).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('dshd-pending-preview-url')).toBe('http://127.0.0.1:4173')
    expect(sessionStorage.getItem('dshd-pending-preview-session')).toBe(BACKGROUND_SID)
  })

  it('opens a pending URL tagged for this session and clears the session tag', async () => {
    sessionStorage.setItem('dshd-pending-preview-url', 'http://127.0.0.1:4173')
    sessionStorage.setItem('dshd-pending-preview-session', SID)
    const b = mount()
    stubHostRect({ x: 800, y: 40, width: 400, height: 600 })
    await waitFor(() => {
      expect(b.previewOpen).toHaveBeenCalledWith(expect.objectContaining({
        url: 'http://127.0.0.1:4173/',
      }))
    })
    expect(sessionStorage.getItem('dshd-pending-preview-session')).toBeNull()
  })

  it('opens a pending delivered document in the mini player before opening the right panel', async () => {
    sessionStorage.setItem('dshd-pending-preview-url', 'http://127.0.0.1:4173/site/index.html')
    sessionStorage.setItem('dshd-pending-preview-presentation', 'mini')
    const b = mount()
    await waitFor(() => {
      expect(b.previewOpen).toHaveBeenCalledWith(expect.objectContaining({
        url: 'http://127.0.0.1:4173/site/index.html',
      }))
      expect(readMiniPlayer()).toMatchObject({ open: true, previewId: 'pv-1', label: 'index.html' })
    })
    expect(sessionStorage.getItem('dshd-pending-preview-presentation')).toBeNull()
  })

  it('survives a locked sessionStorage when reading the pending URL', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('locked')
    })
    const b = mount()
    getItem.mockRestore()
    expect(b.previewOpen).not.toHaveBeenCalled()
  })

  it('opens a discovered server and keeps the chips after the guest mounts', async () => {
    const b = mount({
      discover: async () => [{ url: 'http://127.0.0.1:5173', port: 5173 }],
    })
    const chip = await screen.findByRole('button', { name: 'http://127.0.0.1:5173' })
    stubHostRect({ x: 800, y: 40, width: 400, height: 600 })
    fireEvent.click(chip)
    await waitFor(() => {
      expect(b.previewOpen).toHaveBeenCalledWith(expect.objectContaining({
        url: 'http://127.0.0.1:5173/',
      }))
    })
    expect(screen.getByRole('button', { name: 'http://127.0.0.1:5173' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'http://127.0.0.1:5173' }))
    await waitFor(() => {
      expect(b.previewNavigate).toHaveBeenCalledWith('pv-1', 'http://127.0.0.1:5173/')
    })
  })

  it('opens the typed URL in the system browser before a guest exists', () => {
    const b = mount()
    expect((screen.getByRole('button', { name: 'Open in system browser' }) as HTMLButtonElement).disabled).toBe(true)
    typeUrl('http://127.0.0.1:3000')
    fireEvent.click(screen.getByRole('button', { name: 'Open in system browser' }))
    expect(b.openExternal).toHaveBeenCalledWith('http://127.0.0.1:3000/')
    typeUrl('   ')
    expect((screen.getByRole('button', { name: 'Open in system browser' }) as HTMLButtonElement).disabled).toBe(true)
    submitBar()
    expect(b.previewOpen).not.toHaveBeenCalled()
  })

  it('rescans loopback ports on an interval while the panel is mounted', async () => {
    vi.useFakeTimers()
    const b = mount({
      discover: async () => [{ url: 'http://127.0.0.1:4173', port: 4173 }],
    })
    await Promise.resolve()
    expect(b.previewDiscover).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(b.previewDiscover.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('clears discovered chips when the scan rejects', async () => {
    const b = mount({
      discover: async () => { throw new Error('offline') },
    })
    await waitFor(() => {
      expect(b.previewDiscover).toHaveBeenCalled()
    })
    expect(screen.queryByText('Discovered local servers')).toBeNull()
  })

  it('drives back, forward, reload, and DevTools after a guest is open', async () => {
    const b = mount()
    await openGuest(b)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => {
      expect(b.previewBack).toHaveBeenCalledWith('pv-1')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }))
    await waitFor(() => {
      expect(b.previewForward).toHaveBeenCalledWith('pv-1')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => {
      expect(b.previewReload).toHaveBeenCalledWith('pv-1')
    })
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Developer tools' }))
    await waitFor(() => {
      expect(b.previewOpenDevTools).toHaveBeenCalledWith('pv-1')
    })
  })

  it('hides the guest when inactive and closes it only on unmount', async () => {
    const previewHide = vi.fn(async () => {})
    const previewShow = vi.fn(async () => {})
    const previewClose = vi.fn(async () => {})
    const previewOpen = vi.fn(async () => ({
      ok: true, id: 'pv-1', url: 'http://127.0.0.1:3000', canGoBack: true, canGoForward: true,
    }))
    const base = {
      sessionId: SID,
      useSession: neverHook,
      useSessions: (sel: (s: SessionState) => unknown) => sel(sessionList()),
      useWorkspaces: neverHook,
      useProjection: neverHook,
      previewAvailable: true,
      previewOpen,
      previewNavigate: vi.fn(async () => ({ ok: true, id: 'pv-1', url: 'http://127.0.0.1:3000' })),
      previewResize: vi.fn(async () => {}),
      previewHide,
      previewShow,
      previewClose,
      previewBack: vi.fn(async () => ({ ok: true })),
      previewForward: vi.fn(async () => ({ ok: true })),
      previewReload: vi.fn(async () => ({ ok: true })),
      previewState: vi.fn(async () => ({ ok: true })),
      previewOpenDevTools: vi.fn(async () => ({ ok: true })),
      previewDiscover: vi.fn(async () => []),
      openExternal: vi.fn(async () => {}),
      t,
    }
    const { rerender, unmount } = render(
      <PreviewPanel {...({ ...base, active: true } as unknown as PreviewPanelProps)} />,
    )
    stubHostRect({ x: 800, y: 40, width: 400, height: 600 })
    typeUrl('http://127.0.0.1:3000')
    submitBar()
    await waitFor(() => {
      expect(previewShow).toHaveBeenCalled()
    })
    const hideCalls = previewHide.mock.calls.length
    rerender(<PreviewPanel {...({ ...base, active: false } as unknown as PreviewPanelProps)} />)
    await waitFor(() => {
      expect(previewHide.mock.calls.length).toBeGreaterThan(hideCalls)
    })
    expect(previewClose).not.toHaveBeenCalled()
    unmount()
    await waitFor(() => {
      expect(previewClose).toHaveBeenCalledWith('pv-1')
    })
  })

  it('uses icon chrome, a search-or-URL placeholder, and Enter instead of an Open button', () => {
    mount()
    const input = screen.getByRole('textbox', { name: 'Browser' }) as HTMLInputElement
    expect(input.placeholder).toBe('Search or enter URL')
    expect(input.value).toBe('')
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Forward' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect((screen.getByRole('menuitem', { name: 'Developer tools' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('restores the committed URL on Escape and hides the guest while More is open', async () => {
    const b = mount()
    await openGuest(b)
    const input = screen.getByRole('textbox', { name: 'Browser' }) as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'a' })
    typeUrl('http://127.0.0.1:9')
    expect(input.value).toBe('http://127.0.0.1:9')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('http://127.0.0.1:3000')
    fireEvent.blur(input)
    const hideCalls = b.previewHide.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    await waitFor(() => {
      expect(b.previewHide.mock.calls.length).toBeGreaterThan(hideCalls)
    })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menuitem', { name: 'Developer tools' })).toBeNull()
  })

  it('keeps a focused draft when the guest navigates', async () => {
    let send: (state: PreviewNavState) => void = () => {}
    const b = mount({
      onPreviewStateChange: (handler) => {
        send = handler
        return () => {}
      },
    })
    await openGuest(b)
    const input = screen.getByRole('textbox', { name: 'Browser' }) as HTMLInputElement
    fireEvent.focus(input)
    typeUrl('http://127.0.0.1:9')
    act(() => {
      send({
        ok: true,
        id: 'pv-1',
        url: 'http://127.0.0.1:3000/app',
        canGoBack: true,
        canGoForward: false,
      })
    })
    expect(input.value).toBe('http://127.0.0.1:9')
  })

  it('lists Hard reload, Appearance Dark, Clear cache, and later-task More actions', () => {
    mount()
    openMore()
    expect(screen.getByRole('menuitem', { name: 'Hard reload' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Clear cache' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Screenshot' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Open separate preview window' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Show device toolbar' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Pick element' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Start recording' })).toBeTruthy()
    openAppearanceSubmenu()
    expect(screen.getByRole('menuitem', { name: 'Dark' })).toBeTruthy()
  })

  it('lists Chinese More labels for pip, device toolbar, pick, and record', () => {
    const zhT: PreviewPanelProps['t'] = key => (zh as Record<string, string>)[key] ?? key
    mount({ t: zhT })
    openMore('更多')
    expect(screen.getByRole('menuitem', { name: '强制刷新' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '打开独立预览窗口' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '显示设备工具栏' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '选取元素' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '开始录制' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '截图' })).toBeTruthy()
  })

  it('hard reload calls previewHardReload', async () => {
    const b = mount()
    await openGuest(b)
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hard reload' }))
    await waitFor(() => {
      expect(b.previewHardReload).toHaveBeenCalledWith('pv-1')
    })
  })

  it('appearance Dark calls previewSetColorScheme with dark', async () => {
    const b = mount()
    await openGuest(b)
    openMore()
    openAppearanceSubmenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Dark' }))
    await waitFor(() => {
      expect(b.previewSetColorScheme).toHaveBeenCalledWith('pv-1', 'dark')
    })
  })

  it('screenshot waits for capture then reveals the artifact', async () => {
    const b = mount()
    await openGuest(b)
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Screenshot' }))
    await waitFor(() => {
      expect(b.previewCaptureScreenshot).toHaveBeenCalledWith('pv-1')
      expect(b.previewRevealArtifact).toHaveBeenCalledWith('/tmp/shot.png')
    })
  })

  it('screenshot failure sets the message strip', async () => {
    const b = mount({
      previewCaptureScreenshot: async () => ({ ok: false, message: 'capture failed' }),
    })
    await openGuest(b)
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Screenshot' }))
    await waitFor(() => {
      expect(screen.getByText('capture failed')).toBeTruthy()
    })
    expect(b.previewRevealArtifact).not.toHaveBeenCalled()
  })

  it('screenshot failure without a message uses rejected copy', async () => {
    const b = mount({
      previewCaptureScreenshot: async () => ({ ok: false }),
    })
    await openGuest(b)
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Screenshot' }))
    await waitFor(() => {
      expect(screen.getByText('Invalid URL or unsupported protocol.')).toBeTruthy()
    })
  })

  it('shows Stop while loading and calls previewStop', async () => {
    let send: (state: PreviewNavState) => void = () => {}
    const b = mount({
      onPreviewStateChange: (handler) => {
        send = handler
        return () => {}
      },
    })
    await openGuest(b)
    act(() => {
      send({ ok: true, id: 'pv-1', loading: true })
    })
    const stop = screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement
    expect(stop.disabled).toBe(false)
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
    fireEvent.click(stop)
    await waitFor(() => {
      expect(b.previewStop).toHaveBeenCalledWith('pv-1')
    })
  })

  it('shows unreachable copy from a did-fail-load snapshot', async () => {
    let send: (state: PreviewNavState) => void = () => {}
    const b = mount({
      onPreviewStateChange: (handler) => {
        send = handler
        return () => {}
      },
    })
    await openGuest(b)
    act(() => {
      send({ ok: true, id: 'pv-1', unreachable: true })
    })
    expect(screen.getByText("This site can't be reached.")).toBeTruthy()
  })

  it('disables reload and stop when no guest is open', () => {
    mount()
    expect((screen.getByRole('button', { name: 'Reload' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps the guest hidden after PiP opens and More closes, then shows after PiP close', async () => {
    const b = mount()
    await openGuest(b)
    const showAfterGuest = b.previewShow.mock.calls.length
    const hideAfterGuest = b.previewHide.mock.calls.length
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open separate preview window' }))
    await waitFor(() => {
      expect(b.previewOpenPictureInPicture).toHaveBeenCalledWith('pv-1')
    })
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByRole('menuitem', { name: 'Close separate preview window' })).toBeNull()
    await waitFor(() => {
      expect(b.previewHide.mock.calls.length).toBeGreaterThan(hideAfterGuest)
    })
    expect(b.previewShow.mock.calls.length).toBe(showAfterGuest)
    const showWhilePip = b.previewShow.mock.calls.length
    fireEvent(window, new Event('resize'))
    await act(async () => { await Promise.resolve() })
    expect(b.previewShow.mock.calls.length).toBe(showWhilePip)
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close separate preview window' }))
    await waitFor(() => {
      expect(b.previewClosePictureInPicture).toHaveBeenCalled()
    })
    await act(async () => { await Promise.resolve() })
    await waitFor(() => {
      expect(b.previewShow.mock.calls.length).toBeGreaterThan(showAfterGuest)
    })
  })

  it('restores the guest when a state snapshot reports picture-in-picture closed', async () => {
    let send: (state: PreviewNavState) => void = () => {}
    const b = mount({
      onPreviewStateChange: (handler) => {
        send = handler
        return () => {}
      },
    })
    await openGuest(b)
    const showAfterGuest = b.previewShow.mock.calls.length
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open separate preview window' }))
    await waitFor(() => {
      expect(b.previewOpenPictureInPicture).toHaveBeenCalledWith('pv-1')
    })
    await act(async () => { await Promise.resolve() })
    expect(b.previewShow.mock.calls.length).toBe(showAfterGuest)
    act(() => {
      send({
        ok: true,
        id: 'pv-1',
        url: 'http://127.0.0.1:3000',
        pictureInPicture: false,
      })
    })
    await waitFor(() => {
      expect(b.previewShow.mock.calls.length).toBeGreaterThan(showAfterGuest)
    })
    openMore()
    expect(screen.getByRole('menuitem', { name: 'Open separate preview window' })).toBeTruthy()
  })

  it('flips pip and record labels after successful stubs', async () => {
    const b = mount()
    await openGuest(b)
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open separate preview window' }))
    await waitFor(() => {
      expect(b.previewOpenPictureInPicture).toHaveBeenCalledWith('pv-1')
    })
    await act(async () => { await Promise.resolve() })
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close separate preview window' }))
    await waitFor(() => {
      expect(b.previewClosePictureInPicture).toHaveBeenCalled()
    })
    await act(async () => { await Promise.resolve() })
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Start recording' }))
    await waitFor(() => {
      expect(b.previewStartRecording).toHaveBeenCalledWith('pv-1')
    })
    await act(async () => { await Promise.resolve() })
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stop recording' }))
    await waitFor(() => {
      expect(b.previewStopRecording).toHaveBeenCalled()
    })
  })

  it('toggles the device toolbar label locally', async () => {
    const b = mount()
    await openGuest(b)
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show device toolbar' }))
    openMore()
    expect(screen.getByRole('menuitem', { name: 'Hide device toolbar' })).toBeTruthy()
    expect(b.previewOpen).toHaveBeenCalled()
  })

  it('zoom cluster calls zoom injects', async () => {
    const b = mount()
    await openGuest(b)
    openMore()
    expect(screen.getByText('100%')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Zoom out' }))
    await waitFor(() => {
      expect(b.previewZoomOut).toHaveBeenCalledWith('pv-1')
    })
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Zoom in' }))
    await waitFor(() => {
      expect(b.previewZoomIn).toHaveBeenCalledWith('pv-1')
    })
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset' }))
    await waitFor(() => {
      expect(b.previewResetZoom).toHaveBeenCalledWith('pv-1')
    })
  })

  it('clear cache calls previewClearCache', async () => {
    const b = mount()
    await openGuest(b)
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear cache' }))
    await waitFor(() => {
      expect(b.previewClearCache).toHaveBeenCalled()
    })
  })

  it('clear cookies and pick call their injects', async () => {
    const b = mount()
    await openGuest(b)
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear cookies' }))
    await waitFor(() => {
      expect(b.previewClearCookies).toHaveBeenCalled()
    })
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pick element' }))
    await waitFor(() => {
      expect(b.previewPickElement).toHaveBeenCalledWith('pv-1')
    })
    expect(b.previewSetAnnotationTheme).toHaveBeenCalledWith('pv-1', expect.objectContaining({
      primary: expect.any(String),
    }))
    expect(JSON.stringify(b.previewSetAnnotationTheme.mock.calls[0]?.[1])).not.toMatch(
      new RegExp(`--${['t', '3'].join('')}-`),
    )
  })

  it('appends pick markdown to the composer when appendComposerText and a session exist', async () => {
    const appendComposerText = vi.fn()
    const b = mount({
      appendComposerText,
      previewPickElement: async () => ({
        ok: true,
        annotation: {
          comment: 'nudge',
          elements: [{ element: { selector: '#save' } }],
        },
        screenshot: {
          dataUrl: 'data:image/png;base64,abc',
          width: 1,
          height: 1,
          cropRect: { x: 0, y: 0, width: 1, height: 1 },
        } satisfies PreviewPickScreenshot,
      }),
    })
    await openGuest(b)
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pick element' }))
    await waitFor(() => {
      expect(appendComposerText).toHaveBeenCalledWith(
        SID,
        expect.stringContaining('data:image/png;base64,abc'),
      )
    })
    expect(appendComposerText.mock.calls[0]?.[1]).toContain('#save')
    expect(screen.queryByRole('button', { name: /confirm/i })).toBeNull()
  })

  it('shows the selector on the message strip when appendComposerText is omitted', async () => {
    const b = mount({
      previewPickElement: async () => ({
        ok: true,
        annotation: {
          comment: '',
          elements: [{ element: { selector: '#save' } }],
        },
        screenshot: {
          dataUrl: 'data:image/png;base64,abc',
          width: 1,
          height: 1,
          cropRect: { x: 0, y: 0, width: 1, height: 1 },
        } satisfies PreviewPickScreenshot,
      }),
    })
    await openGuest(b)
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pick element' }))
    await waitFor(() => {
      expect(screen.getByText('#save')).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: /confirm/i })).toBeNull()
  })

  it('shows markdown on the message strip when the selector is empty', async () => {
    const b = mount({
      previewPickElement: async () => ({
        ok: true,
        annotation: { comment: 'nudge', elements: [{ element: { selector: '' } }] },
        screenshot: {
          dataUrl: 'data:image/png;base64,abc',
          width: 1,
          height: 1,
          cropRect: { x: 0, y: 0, width: 1, height: 1 },
        } satisfies PreviewPickScreenshot,
      }),
    })
    await openGuest(b)
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pick element' }))
    await waitFor(() => {
      expect(screen.getByText(/nudge/)).toBeTruthy()
    })
    expect(screen.getByText(/data:image\/png;base64,abc/)).toBeTruthy()
  })

  it('falls back to the message strip when appendComposerText reports no write', async () => {
    const appendComposerText = vi.fn(() => false)
    const b = mount({
      appendComposerText,
      previewPickElement: async () => ({
        ok: true,
        annotation: { elements: [{ element: { selector: '#save' } }] },
      }),
    })
    await openGuest(b)
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pick element' }))
    await waitFor(() => {
      expect(screen.getByText('#save')).toBeTruthy()
    })
    expect(appendComposerText).toHaveBeenCalled()
  })

  it('ignores a cancelled pick without changing the message strip', async () => {
    const appendComposerText = vi.fn()
    const b = mount({
      appendComposerText,
      previewPickElement: async () => ({ ok: false, message: 'cancelled' }),
    })
    await openGuest(b)
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pick element' }))
    await waitFor(() => {
      expect(b.previewPickElement).toHaveBeenCalledWith('pv-1')
    })
    expect(appendComposerText).not.toHaveBeenCalled()
    expect(screen.queryByText('cancelled')).toBeNull()
  })

  it('passes session cwd as the preview scope and swallows overlay IPC failures', async () => {
    const b = mount({ cwd: 'C:\\ws' })
    b.previewShow.mockRejectedValue(new Error('show'))
    b.previewHide.mockRejectedValue(new Error('hide'))
    b.previewResize.mockRejectedValue(new Error('resize'))
    b.previewClose.mockRejectedValue(new Error('close'))
    stubHostRect({ x: 800, y: 40, width: 400, height: 600 })
    typeUrl('http://127.0.0.1:3000')
    submitBar()
    await waitFor(() => {
      expect(b.previewOpen).toHaveBeenCalledWith(expect.objectContaining({ scope: 'C:\\ws' }))
    })
    await waitFor(() => {
      expect(b.previewShow).toHaveBeenCalled()
    })
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show device toolbar' }))
  })

  it('uses rejected copy when a nav snapshot omits a message', async () => {
    let send: (state: PreviewNavState) => void = () => {}
    const b = mount({
      onPreviewStateChange: (handler) => {
        send = handler
        return () => {}
      },
    })
    await openGuest(b)
    act(() => {
      send({ ok: false, id: 'pv-1' })
    })
    expect(screen.getByText('Invalid URL or unsupported protocol.')).toBeTruthy()
    act(() => {
      send({ ok: false, id: 'pv-1', message: 'blocked' })
    })
    expect(screen.getByText('blocked')).toBeTruthy()
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(b.previewShow).toHaveBeenCalled()
  })

  it('shrinks previewResize below the occupant when the device toolbar is on', async () => {
    const occupant = { x: 0, y: 0, width: 800, height: 600 }
    const b = mount()
    stubHostRect(occupant)
    typeUrl('http://127.0.0.1:3000')
    submitBar()
    await waitFor(() => {
      expect(b.previewShow).toHaveBeenCalledWith('pv-1', expect.objectContaining(occupant))
    })
    const showBefore = b.previewShow.mock.calls.length
    const resizeBefore = b.previewResize.mock.calls.length
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show device toolbar' }))
    await waitFor(() => {
      const rects = guestRectsAfter(b, showBefore, resizeBefore)
      expect(rects.length).toBeGreaterThan(0)
      const last = rects[rects.length - 1]!
      expect(last.width).toBeLessThan(800)
      expect(last.height).toBeLessThan(600)
    })
    expect(screen.getByRole('toolbar', { name: 'Device toolbar' })).toBeTruthy()
    expect((screen.getByRole('spinbutton', { name: 'Viewport width' }) as HTMLInputElement).value).toBe('375')
    expect((screen.getByRole('spinbutton', { name: 'Viewport height' }) as HTMLInputElement).value).toBe('667')
    expect(screen.getByText('iPhone SE')).toBeTruthy()
    expect(document.querySelector('[data-preset-id="iphone-se"]')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Rotate viewport' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Resize viewport from the right edge' })).toBeTruthy()
  })

  it('hides the guest while the device preset catalog is open and restores the inset bounds when it closes', async () => {
    const occupant = { x: 0, y: 0, width: 800, height: 600 }
    const b = mount()
    stubHostRect(occupant)
    typeUrl('http://127.0.0.1:3000')
    submitBar()
    await waitFor(() => {
      expect(b.previewShow).toHaveBeenCalledWith('pv-1', expect.objectContaining(occupant))
    })
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show device toolbar' }))
    await waitFor(() => {
      expect(screen.getByRole('toolbar', { name: 'Device toolbar' })).toBeTruthy()
    })
    const hideBefore = b.previewHide.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Device preset' }))
    await waitFor(() => {
      expect(b.previewHide.mock.calls.length).toBeGreaterThan(hideBefore)
    })
    expect(screen.getByRole('button', { name: 'Device preset' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('menuitem', { name: 'iPad Air 820 × 1180', hidden: true })).toBeTruthy()
    const showBefore = b.previewShow.mock.calls.length
    const resizeBefore = b.previewResize.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Device preset' }))
    await waitFor(() => {
      const rects = guestRectsAfter(b, showBefore, resizeBefore)
      expect(rects.length).toBeGreaterThan(0)
      const last = rects[rects.length - 1]!
      expect(last.width).toBeLessThan(800)
      expect(last.height).toBeLessThan(600)
    })
  })

  it('restores the full occupant rectangle when the device toolbar is hidden', async () => {
    const occupant = { x: 0, y: 0, width: 800, height: 600 }
    const b = mount()
    stubHostRect(occupant)
    typeUrl('http://127.0.0.1:3000')
    submitBar()
    await waitFor(() => {
      expect(b.previewShow).toHaveBeenCalledWith('pv-1', expect.objectContaining(occupant))
    })
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show device toolbar' }))
    await waitFor(() => {
      expect(screen.getByRole('toolbar', { name: 'Device toolbar' })).toBeTruthy()
    })
    const showBefore = b.previewShow.mock.calls.length
    const resizeBefore = b.previewResize.mock.calls.length
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hide device toolbar' }))
    await waitFor(() => {
      const rects = guestRectsAfter(b, showBefore, resizeBefore)
      expect(rects.length).toBeGreaterThan(0)
      expect(rects[rects.length - 1]).toEqual(expect.objectContaining(occupant))
    })
    expect(screen.queryByRole('toolbar', { name: 'Device toolbar' })).toBeNull()
  })

  it('shows Chinese device-toolbar aria, width, height, and rotate copy', async () => {
    const zhT: PreviewPanelProps['t'] = key => (zh as Record<string, string>)[key] ?? key
    const occupant = { x: 0, y: 0, width: 800, height: 600 }
    const b = mount({ t: zhT })
    stubHostRect(occupant)
    fireEvent.change(screen.getByRole('textbox', { name: '浏览器' }), {
      target: { value: 'http://127.0.0.1:3000' },
    })
    submitBar()
    await waitFor(() => {
      expect(b.previewShow).toHaveBeenCalled()
    })
    openMore('更多')
    fireEvent.click(screen.getByRole('menuitem', { name: '显示设备工具栏' }))
    await waitFor(() => {
      expect(screen.getByRole('toolbar', { name: '设备工具栏' })).toBeTruthy()
    })
    expect(screen.getByRole('spinbutton', { name: '视口宽度' })).toBeTruthy()
    expect(screen.getByRole('spinbutton', { name: '视口高度' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '旋转视口' })).toBeTruthy()
    expect(screen.getByText('iPhone SE')).toBeTruthy()
  })

  it('re-syncs guest bounds when zoomFactor changes while the device toolbar is on', async () => {
    let send: (state: PreviewNavState) => void = () => {}
    const occupant = { x: 0, y: 0, width: 800, height: 600 }
    const b = mount({
      onPreviewStateChange: (handler) => {
        send = handler
        return () => {}
      },
    })
    stubHostRect(occupant)
    typeUrl('http://127.0.0.1:3000')
    submitBar()
    await waitFor(() => {
      expect(b.previewShow).toHaveBeenCalled()
    })
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show device toolbar' }))
    await waitFor(() => {
      expect(screen.getByRole('toolbar', { name: 'Device toolbar' })).toBeTruthy()
    })
    const resizeBefore = b.previewResize.mock.calls.length
    act(() => {
      send({ ok: true, id: 'pv-1', zoomFactor: 2 })
    })
    await waitFor(() => {
      expect(b.previewResize.mock.calls.length).toBeGreaterThan(resizeBefore)
    })
    const last = b.previewResize.mock.calls[b.previewResize.mock.calls.length - 1]![1] as {
      width: number
      height: number
    }
    expect(last.width).toBeLessThan(800)
    expect(last.height).toBeLessThan(600)
  })

  it('keeps pip and record labels when the overlay stubs fail', async () => {
    const b = mount()
    b.previewOpenPictureInPicture.mockResolvedValue({ ok: false })
    b.previewStartRecording.mockResolvedValue({ ok: false })
    b.previewSetColorScheme.mockResolvedValue({ ok: false, id: 'pv-1' })
    await openGuest(b)
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open separate preview window' }))
    await waitFor(() => {
      expect(b.previewOpenPictureInPicture).toHaveBeenCalled()
    })
    openMore()
    expect(screen.getByRole('menuitem', { name: 'Open separate preview window' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Start recording' }))
    await waitFor(() => {
      expect(b.previewStartRecording).toHaveBeenCalled()
    })
    openMore()
    expect(screen.getByRole('menuitem', { name: 'Start recording' })).toBeTruthy()
    openAppearanceSubmenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Dark' }))
    await waitFor(() => {
      expect(b.previewSetColorScheme).toHaveBeenCalledWith('pv-1', 'dark')
    })
    openMore()
    openAppearanceSubmenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Dark' }))
    await waitFor(() => {
      expect(b.previewSetColorScheme).toHaveBeenCalledWith('pv-1', 'dark')
    })
  })

  it('still shows the guest when ResizeObserver is missing', async () => {
    vi.stubGlobal('ResizeObserver', undefined)
    const b = mount()
    await openGuest(b)
    expect(b.previewShow).toHaveBeenCalled()
  })

  it('skips device-toolbar resize when the occupant is empty', async () => {
    const b = mount()
    await openGuest(b)
    stubHostRect({ x: 0, y: 0, width: 0, height: 0 })
    const resizeBefore = b.previewResize.mock.calls.length
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show device toolbar' }))
    openMore()
    expect(screen.getByRole('menuitem', { name: 'Hide device toolbar' })).toBeTruthy()
    expect(b.previewResize.mock.calls.length).toBe(resizeBefore)
  })

  it('keeps the guest id when a nav snapshot omits id', async () => {
    const b = mount()
    b.previewNavigate.mockResolvedValue({ ok: true, url: 'http://127.0.0.1:3000/next' })
    await openGuest(b)
    typeUrl('http://127.0.0.1:3000/next')
    submitBar()
    await waitFor(() => {
      expect(b.previewNavigate).toHaveBeenCalled()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => {
      expect(b.previewReload).toHaveBeenCalledWith('pv-1')
    })
  })
})
