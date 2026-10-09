// @vitest-environment jsdom
/**
 * AppFrame interaction spec under the four-share props form: a real layout
 * store instance (createLayoutStore().create() — the test-sanctioned engine
 * path), a recording renderSlot stub, and explicitly driven browser
 * measurements. Drag sequences (pointer capture + rAF flush), concession
 * response to viewport change, the phone overlay band, the titlebar trailing
 * cluster, surfaces / terminal-drawer tracks, and every column staying mounted
 * at zero size are the preserved behavior assertions. jsdom has no layout
 * engine, so the frame width comes from a mocked getBoundingClientRect and
 * resizes are driven through the ResizeObserver stub.
 */
import type { GlobalStandardProps, RenderOpts } from '@deepseek-ai/dsh-client-ui-slots'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { AppFrame } from '../src/client/AppFrame.tsx'
import type { AppFrameProps } from '../src/client/AppFrame.tsx'
import type { MainPanelId, RightbarOwnerProps, SidebarOwnerProps, TitlebarTrailingOwnerProps } from '../src/client/index.ts'
import { createLayoutStore } from '../src/client/stores.ts'
import { PHONE_DRAWER, PHONE_MAX, SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT } from '../src/client/columns.ts'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as GlobalStandardProps['useResource']
const selectedSession = { current: 's-test' as SessionId | undefined }
const selectedSessionBlank = { current: false }
const selectedSessionTitle = { current: undefined as string | undefined }
const selectedSessionManaged = { current: false }
const workspacesReady = { current: true }
type AttentionSnapshot = Parameters<Parameters<AppFrameProps['useSessionStatus']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionStatus: AppFrameProps['useSessionStatus'] = selector => selector(noAttention)

let observers: ResizeObserverStub[]
class ResizeObserverStub {
  disconnected = false
  constructor(private callback: ResizeObserverCallback) { observers.push(this) }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void { this.disconnected = true }
  fire(): void { this.callback([], this) }
}

let frameWidth: number
let initialWindowWidth: number | undefined
let trailingClusterWidth = 0
let landscape = false
let animationFrames: Map<number, FrameRequestCallback>
let nextFrame: number
let originalTitle: string
const orientationListeners = new Set<(ev: MediaQueryListEvent) => void>()
const restoreProperties: (() => void)[] = []

function replaceProperty<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): void {
  const descriptor = Object.getOwnPropertyDescriptor(target, key)
  restoreProperties.push(() => {
    if (descriptor === undefined) Reflect.deleteProperty(target, key)
    else Object.defineProperty(target, key, descriptor)
  })
  Object.defineProperty(target, key, { configurable: true, writable: true, value })
}

/** Physical screen box used by readDeviceLandscape (keyboard-safe). */
function stubScreenAvail(width: number, height: number): void {
  Object.defineProperty(window.screen, 'availWidth', { configurable: true, value: width })
  Object.defineProperty(window.screen, 'availHeight', { configurable: true, value: height })
}

/** Flush one browser frame without depending on the worker's timer cadence. */
function flushFrames(): void {
  for (const [id, callback] of [...animationFrames]) {
    if (!animationFrames.delete(id)) continue
    callback(0)
  }
}

function resize(width: number): void {
  frameWidth = width
  act(() => {
    for (const observer of observers) if (!observer.disconnected) observer.fire()
    flushFrames()
  })
}

function mountFrame(windowWidth = initialWindowWidth ?? frameWidth) {
  vi.stubGlobal('innerWidth', windowWidth)
  const instance = createLayoutStore().create()
  const slotCalls: { key: string; props: object; options: RenderOpts | undefined }[] = []
  const renderSlot: AppFrameProps['renderSlot'] = (key, owner, options) => {
    slotCalls.push({ key, props: owner, options })
    return <div data-testid={`${key}-content`} data-entry-key={options?.entryKey} />
  }
  const useSessions: AppFrameProps['useSessions'] = sel => sel({
    ids: selectedSession.current === undefined ? [] : [selectedSession.current],
    byId: selectedSession.current === undefined ? {} : {
      [selectedSession.current]: {
        id: selectedSession.current,
        displayTitle: 'Test',
        running: false,
        retainedBy: { mainView: 1 },
        blank: selectedSessionBlank.current,
        updatedAt: 1,
        ...(selectedSessionTitle.current === undefined ? {} : { title: selectedSessionTitle.current }),
        ...(selectedSessionManaged.current
          ? { presentation: { owner: 'plugin', title: 'Managed session', composer: 'managed' as const } }
          : {}),
      },
    },
    phase: 'ready',
    projectionsBySession: {},
  })
  const workspaceState: WorkspaceSnapshot = {
    items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    ...(workspacesReady ? {} : { state: 'loading' as const, phase: 'pending' as const }),
  }
  const useStore = bindSnapshotSelector(instance)
  const usePanelInfo = bindSnapshotSelector({
    getSnapshot: () => instance.getSnapshot().panelInfo,
    subscribe: listener => instance.subscribe(listener),
  })
  const element = () => (
    <AppFrame
      SessionProvider={({ children }) => children}
      useStore={useStore}
      actions={instance.actions}
      renderSlot={renderSlot}
      useSessions={useSessions}
      usePanelInfo={usePanelInfo}
      useSessionStatus={useSessionStatus}
      useSessionRetainInfo={() => undefined}
      useResource={useResource}
      useWorkspaces={sel => sel(workspaceState)}
      t={key => key === 'brand.localBuild' ? 'DSH Local Build' : key}
    />
  )
  const utils = render(element())
  const frame = utils.container.firstElementChild as HTMLElement
  return {
    ...utils, instance, frame, slotCalls,
    rerenderFrame: () => { utils.rerender(element()) },
    rightOwner: () => slotCalls.findLast(c => c.key === 'rightbar')!.props as RightbarOwnerProps,
    sidebarOwner: () => slotCalls.findLast(c => c.key === 'sidebar')!.props as SidebarOwnerProps,
    trailingOwner: () => slotCalls.findLast(c => c.key === 'shell.titlebar.trailing')!.props as TitlebarTrailingOwnerProps,
  }
}

/* jsdom does no layout, so read the three explicit column tracks from the
   four-column grid: [sidebar, rightbar, surfaces]. */
function tracks(frame: HTMLElement): number[] {
  const match = /^([\d.]+)px minmax\(0, 1fr\) ([\d.]+)px ([\d.]+)px$/.exec(frame.style.gridTemplateColumns)
  if (match === null) throw new Error(`unexpected template: ${frame.style.gridTemplateColumns}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function drawerTrack(frame: HTMLElement): number {
  const match = /^auto minmax\(0, 1fr\) (\d+)px auto$/.exec(frame.style.gridTemplateRows)
  if (match === null) throw new Error(`unexpected rows: ${frame.style.gridTemplateRows}`)
  return Number(match[1])
}

function handleFor(frame: HTMLElement, side: 'sidebar' | 'rightbar' | 'surfaces'): HTMLElement {
  const handle = frame.querySelector<HTMLElement>(`[data-side="${side}"]`)
  if (handle === null) throw new Error(`missing ${side} resize handle`)
  return handle
}

function pointer(handle: Element, type: string, clientX: number, pointerId = 1, button = 0): void {
  act(() => { handle.dispatchEvent(new PointerEvent(type, { pointerId, clientX, button, bubbles: true })) })
}

function drag(handle: Element, fromX: number, toX: number): void {
  pointer(handle, 'pointerdown', fromX)
  pointer(handle, 'pointermove', toX)
  act(flushFrames)
  pointer(handle, 'pointerup', toX)
}

beforeEach(() => {
  localStorage.clear()
  originalTitle = document.title
  frameWidth = 1920
  initialWindowWidth = undefined
  trailingClusterWidth = 0
  landscape = false
  selectedSession.current = 's-test' as SessionId
  selectedSessionBlank.current = false
  selectedSessionTitle.current = undefined
  selectedSessionManaged.current = false
  workspacesReady.current = true
  observers = []
  animationFrames = new Map()
  nextFrame = 1
  orientationListeners.clear()
  vi.stubEnv('DSH_CLIENT_TITLE', undefined)
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrame++
    animationFrames.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { animationFrames.delete(id) })
  stubScreenAvail(390, 844)
  window.matchMedia = ((query: string) => ({
    get matches() {
      if (query.includes('landscape')) return landscape
      if (query.includes('portrait')) return !landscape
      return false
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: EventListener) => {
      if (query.includes('landscape')) orientationListeners.add(listener as (ev: MediaQueryListEvent) => void)
    },
    removeEventListener: (_type: string, listener: EventListener) => {
      orientationListeners.delete(listener as (ev: MediaQueryListEvent) => void)
    },
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia
  replaceProperty(Element.prototype, 'getBoundingClientRect', function (this: Element) {
    if (this instanceof HTMLElement && this.id === 'dshd-shell-titlebar-trailing') {
      return {
        width: trailingClusterWidth, height: 27, top: 12, left: 0,
        right: trailingClusterWidth, bottom: 39, x: 0, y: 12, toJSON: () => ({}),
      }
    }
    return { width: frameWidth, height: 1080, top: 0, left: 0, right: frameWidth, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }
  })
  // jsdom has no pointer capture. Each element retains the actual pointer id,
  // and teardown restores absent methods as well as existing descriptors.
  const captured = new WeakMap<Element, number>()
  replaceProperty(Element.prototype, 'setPointerCapture', function (this: Element, id: number) { captured.set(this, id) })
  replaceProperty(Element.prototype, 'releasePointerCapture', function (this: Element) { captured.delete(this) })
  replaceProperty(Element.prototype, 'hasPointerCapture', function (this: Element, id: number) { return captured.get(this) === id })
})

afterEach(() => {
  try {
    cleanup()
  } finally {
    delete document.documentElement.dataset.platform
    document.documentElement.removeAttribute('data-windows-titlebar')
    for (const restore of restoreProperties.splice(0).reverse()) restore()
    document.title = originalTitle
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    Reflect.deleteProperty(window.screen, 'orientation')
  }
})

describe('AppFrame', () => {
  it('localizes the product title without a configured build title', () => {
    mountFrame()
    expect(document.title).toBe('DSH Local Build')
  })

  it('follows the selected durable Session title', () => {
    vi.stubEnv('DSH_CLIENT_TITLE', 'Product')
    selectedSessionTitle.current = 'First'
    const { rerenderFrame } = mountFrame()
    expect(document.title).toBe('First — Product')
    selectedSessionTitle.current = 'Revised'
    act(() => { rerenderFrame() })
    expect(document.title).toBe('Revised — Product')
    selectedSession.current = undefined
    act(() => { rerenderFrame() })
    expect(document.title).toBe('Product')
  })

  it('renders owner props for the default sidebar and prospective right panel', () => {
    const { frame, rightOwner, sidebarOwner, slotCalls } = mountFrame()
    expect(tracks(frame)).toEqual([280, 0, 0])
    expect(sidebarOwner()).toEqual({ collapsed: false, width: 280 })
    expect(rightOwner()).toEqual({ width: 864, viewportWidth: 1920, canShow: true })
    expect(slotCalls.find(c => c.key === 'main')).toEqual({ key: 'main', props: {}, options: { entryKey: 'conversation' } })
  })

  it('renders the main, sidebar, and root-scoped rightbar outlets without a current Session', () => {
    selectedSession.current = undefined
    const { frame, getByTestId } = mountFrame()
    expect(getByTestId('main-content').getAttribute('data-entry-key')).toBe('conversation')
    expect(getByTestId('sidebar-content')).toBeTruthy()
    expect(getByTestId('rightbar-content')).toBeTruthy()
    expect(getByTestId('shell.bottom-content').parentElement?.hasAttribute('data-shell-bottom')).toBe(true)
    expect(tracks(frame)).toEqual([280, 0, 0])
  })

  it('keeps the rightbar column mounted at zero width and records the collapsed chrome state', () => {
    const { frame, getByTestId } = mountFrame()
    expect(tracks(frame)).toEqual([280, 0, 0])
    expect(getByTestId('rightbar-content')).toBeTruthy()
    expect(frame.hasAttribute('data-details-collapsed')).toBe(true)
  })

  it('renders every column occupant before workspace baselines settle (no loading gate)', () => {
    workspacesReady.current = false
    const { frame, getByTestId } = mountFrame()
    expect(getByTestId('main-content').getAttribute('data-entry-key')).toBe('conversation')
    expect(getByTestId('rightbar-content')).toBeTruthy()
    expect(frame.querySelector('[data-testid="surfaces-content"]')).toBeNull()
  })

  it('keeps Windows caption controls mounted with a zero-width collapsed column', () => {
    document.documentElement.setAttribute('data-windows-titlebar', '')
    try {
      const { frame, instance, sidebarOwner, getByTestId, queryByTestId } = mountFrame()
      act(() => { instance.actions.toggleSidebar() })
      expect(tracks(frame)[0]).toBe(0)
      expect(sidebarOwner()).toMatchObject({ collapsed: true, width: 0 })
      expect(getByTestId('sidebar-content')).toBeTruthy()
      // The caption row keeps the reopen controls; the darwin-only
      // shell.leading seat must not mount a duplicate set.
      expect(queryByTestId('shell.leading-content')).toBeNull()
    } finally {
      document.documentElement.removeAttribute('data-windows-titlebar')
    }
  })

  it('keeps the closed sidebar mounted at its 56px rail without a handle', () => {
    const { frame, instance, sidebarOwner, getByTestId, queryByTestId } = mountFrame()
    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)).toEqual([56, 0, 0])
    expect(sidebarOwner()).toEqual({ collapsed: true, width: 56 })
    expect(getByTestId('sidebar-content')).toBeTruthy()
    expect(frame.querySelector('[data-side="sidebar"]')).toBeNull()
    // The rail keeps the window chrome housed: no shell.leading seat.
    expect(queryByTestId('shell.leading-content')).toBeNull()
    expect(frame.querySelector('[data-shell-leading-band]')).toBeNull()
  })

  it('keeps the caption drag band when the darwin sidebar collapses', () => {
    document.documentElement.dataset.platform = 'darwin'
    const { frame, instance, sidebarOwner, queryByTestId } = mountFrame()
    // The caption drag band sits before column content so later no-drag
    // controls subtract their hit regions from it.
    expect(frame.querySelector('[data-dshd-caption="band"]')).not.toBeNull()
    expect(queryByTestId('shell.leading-content')).toBeNull()
    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)).toEqual([0, 0, 0])
    expect(sidebarOwner()).toEqual({ collapsed: true, width: 0 })
    expect(frame.querySelector('[data-dshd-caption="band"]')).not.toBeNull()
    expect(queryByTestId('shell.leading-content')).toBeNull()
    act(() => { instance.actions.toggleSidebar() })
    expect(queryByTestId('shell.leading-content')).toBeNull()
  })

  it('switches only the keyed main outlet when the active panel changes', () => {
    selectedSessionTitle.current = 'Session title'
    const { instance, frame, slotCalls, getByTestId } = mountFrame()
    const sessionId = selectedSession.current
    const layoutInfo = instance.getSnapshot().layoutInfo
    for (const panelId of ['panel-a' as MainPanelId, 'panel-b' as MainPanelId, null]) {
      slotCalls.length = 0
      act(() => { instance.actions.selectPanel(panelId) })
      expect(slotCalls).toEqual([{ key: 'main', props: {}, options: { entryKey: panelId ?? 'conversation' } }])
      expect(getByTestId('main-content').getAttribute('data-entry-key')).toBe(panelId ?? 'conversation')
      expect(instance.getSnapshot().panelInfo).toEqual({ activePanelId: panelId })
      expect(frame.querySelector('[data-dshd-caption="band"]')).not.toBeNull()
      expect(instance.getSnapshot().layoutInfo).toBe(layoutInfo)
      expect(tracks(frame)).toEqual([280, 0, 0])
      expect(selectedSession.current).toBe(sessionId)
      expect(document.title).toBe(panelId === null ? 'Session title — DSH Local Build' : 'DSH Local Build')
    }
  })

  it('seats a non-conversation main panel in the content row only', () => {
    const { instance, getByTestId } = mountFrame()
    expect(getByTestId('main-content').closest('[data-main-panel]')).toBeNull()
    act(() => { instance.actions.selectPanel('plugins' as MainPanelId) })
    expect(getByTestId('main-content').closest('[data-main-panel]')).not.toBeNull()
    act(() => { instance.actions.selectPanel(null) })
    expect(getByTestId('main-content').closest('[data-main-panel]')).toBeNull()
  })

  it('closes the overlay drawer when the current Session changes', () => {
    frameWidth = 390
    const { frame, instance, rerenderFrame } = mountFrame()
    act(() => { instance.actions.toggleSidebar() })
    expect(frame.hasAttribute('data-phone-sidebar')).toBe(true)
    selectedSession.current = 's-other' as SessionId
    act(() => { rerenderFrame() })
    expect(instance.getSnapshot().layoutInfo.narrowExpanded).toBe(false)
    expect(frame.hasAttribute('data-phone-sidebar')).toBe(false)
  })
})

describe('AppFrame normal width concessions', () => {
  it('measures the frame, not the window, before choosing the first-open preference', () => {
    frameWidth = 1000
    const { instance, rightOwner } = mountFrame(1920)
    expect(instance.getSnapshot().layoutInfo.viewportWidth).toBe(1000)
    expect(rightOwner()).toEqual({ width: 450, viewportWidth: 1000, canShow: true })
    act(() => { instance.actions.openRightbar(true, false) })
    expect(instance.getSnapshot().layoutInfo.rightbar).toBe(450)
    resize(1920)
    expect(rightOwner().width).toBe(450)
  })

  it('shrinks the right panel to 300px, drops its track, and only then squeezes center', () => {
    const { frame, instance, rightOwner } = mountFrame()
    act(() => { instance.actions.setSidebar(420); instance.actions.openRightbar(true, false) })
    resize(1200)
    // The grid now carries the resolved rightbar width directly.
    expect(tracks(frame)).toEqual([420, 380, 0])
    expect(rightOwner()).toEqual({ width: 380, viewportWidth: 1200, canShow: true })
    resize(1120)
    expect(tracks(frame)).toEqual([420, 300, 0])
    resize(1119)
    expect(tracks(frame)).toEqual([420, 0, 0])
    expect(rightOwner()).toEqual({ width: 0, viewportWidth: 1119, canShow: false })
    expect(frame.querySelector('[data-side="rightbar"]')).toBeNull()
    expect(instance.getSnapshot().layoutInfo).toMatchObject({ rightbarShown: true, rightbar: 864 })
    act(() => { instance.actions.closeRightbar() })
    // The spec runs portrait (the phone-drawer tests need it), so the
    // narrow-band rail check must stay above PHONE_MAX: 800px is
    // narrow-but-not-phone and keeps the 56px rail meaningful.
    resize(800)
    expect(tracks(frame)).toEqual([56, 0, 0])
    resize(1920)
    expect(tracks(frame)).toEqual([420, 0, 0])
  })

  it('uses the post-collapse left rail to permit a narrow first opening', () => {
    frameWidth = 800
    const { frame, instance, rightOwner } = mountFrame()
    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)).toEqual([280, 0, 0])
    expect(rightOwner()).toEqual({ width: 344, viewportWidth: 800, canShow: true })
    act(() => { instance.actions.openRightbar(true, false) })
    expect(tracks(frame)).toEqual([56, 344, 0])
    expect(instance.getSnapshot().layoutInfo).toMatchObject({ narrowExpanded: false, rightbar: 360 })
    expect(rightOwner().canShow).toBe(true)
  })

  it.each([
    ['win32', false, 56], ['win32', true, 0], ['darwin', false, 0], ['linux', false, 56],
  ] as const)('opens a narrow desktop right panel on a landscape monitor (%s, native caption: %s)', (platform, caption, rail) => {
    document.documentElement.dataset.platform = platform
    if (caption) document.documentElement.setAttribute('data-windows-titlebar', '')
    landscape = true
    stubScreenAvail(1920, 1080)
    frameWidth = 960
    const { frame, instance, rightOwner } = mountFrame()
    expect(tracks(frame)).toEqual([rail, 0, 0])
    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)[0]).toBe(280)
    expect(rightOwner()).toEqual({ width: 432, viewportWidth: 960, canShow: true })
    act(() => { instance.actions.openRightbar(true, false) })
    expect(tracks(frame)).toEqual([rail, 432, 0])
    expect(instance.getSnapshot().layoutInfo.narrowExpanded).toBe(false)
    vi.stubGlobal('innerWidth', 1440)
    resize(1440)
    expect(tracks(frame)[0]).toBe(280)
    vi.stubGlobal('innerWidth', 960)
    resize(960)
    expect(tracks(frame)).toEqual([rail, 432, 0])
    expect(rightOwner().canShow).toBe(true)
  })

  it.each([[756, 300, true], [755, 0, false]] as const)('reports eligibility at %ipx', (width, rightbar, canShow) => {
    frameWidth = width
    const { instance, rightOwner } = mountFrame()
    act(() => { instance.actions.toggleSidebar() })
    expect(rightOwner()).toEqual({ width: rightbar, viewportWidth: width, canShow })
  })

  it('does not anticipate another left collapse after the right panel is already shown', () => {
    frameWidth = 800
    const { instance, rightOwner } = mountFrame()
    act(() => { instance.actions.openRightbar(true, false); instance.actions.toggleSidebar() })
    expect(rightOwner().canShow).toBe(false)
  })

  it('auto-collapses only below 1024px and preserves the wide sidebar preference', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.setSidebar(400) })
    resize(1024)
    expect(tracks(frame)[0]).toBe(400)
    resize(1023)
    expect(tracks(frame)[0]).toBe(56)
    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)[0]).toBe(400)
    resize(980)
    expect(tracks(frame)[0]).toBe(400)
    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)[0]).toBe(56)
    resize(1920)
    expect(tracks(frame)[0]).toBe(400)
  })

  it('re-expands a wide-closed sidebar at the default width while narrow', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.toggleSidebar() })
    resize(980)
    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)[0]).toBe(280)
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(0)
  })
})

describe('AppFrame right panel presentation', () => {
  it('releases the fullscreen track with the instant marker while clearing fullscreen', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openRightbar(true, true) })
    expect(tracks(frame)).toEqual([280, 864, 0])
    act(() => { instance.actions.closeRightbar() })
    expect(tracks(frame)).toEqual([280, 0, 0])
    expect(frame.dataset.rightbarFullscreen).toBeUndefined()
    expect(frame.dataset.rightbarInstant).toBe('true')
    expect(frame.querySelector('[data-side="rightbar"]')).toBeNull()
    act(() => { instance.actions.closeRightbar() })
    expect(frame.dataset.rightbarInstant).toBe('true')
  })

  it('marks restoration instant without suppressing the following normal close', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openRightbar(true, true) })
    act(() => { instance.actions.openRightbar(true, false) })
    expect(tracks(frame)).toEqual([280, 864, 0])
    expect(frame.dataset.rightbarFullscreen).toBeUndefined()
    expect(frame.dataset.rightbarInstant).toBe('true')
    act(() => { instance.actions.closeRightbar() })
    expect(tracks(frame)).toEqual([280, 0, 0])
    expect(frame.dataset.rightbarFullscreen).toBeUndefined()
    expect(frame.dataset.rightbarInstant).toBeUndefined()
  })

  it.each(['setSidebar', 'toggleSidebar', 'setRightbar', 'viewport', 'open'] as const)('reenables normal transitions after %s', (action) => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openRightbar(true, true); instance.actions.closeRightbar() })
    expect(frame.dataset.rightbarInstant).toBe('true')
    act(() => {
      if (action === 'viewport') resize(1800)
      else if (action === 'open') instance.actions.openRightbar(true, false)
      else if (action === 'toggleSidebar') instance.actions.toggleSidebar()
      else instance.actions[action](350)
    })
    expect(frame.dataset.rightbarInstant).toBeUndefined()
    expect(frame.dataset.rightbarFullscreen).toBeUndefined()
  })

  it('updates the sidebar track on resize and toggle without stale animation state', () => {
    const { frame, instance } = mountFrame()
    expect(frame.dataset.animating).toBeUndefined()
    resize(1600)
    expect(tracks(frame)).toEqual([280, 0, 0])
    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)[0]).toBeLessThan(280)
    expect(frame.dataset.animating).toBeUndefined()
  })

  it('auto-collapses at the breakpoint and still accepts a user toggle', () => {
    const { frame, instance } = mountFrame()
    resize(900)
    expect(frame.dataset.sidebarCollapsed).toBe('true')
    expect(tracks(frame)[0]).toBe(SIDEBAR_COLLAPSED)
    act(() => { instance.actions.toggleSidebar() })
    expect(frame.dataset.sidebarCollapsed).toBeUndefined()
    expect(tracks(frame)[0]).toBe(SIDEBAR_DEFAULT)
  })

  it('keeps the opened rightbar track stable across elapsed time', () => {
    vi.useFakeTimers()
    try {
      const { frame, instance } = mountFrame()
      act(() => { instance.actions.openRightbar(true, false) })
      const openTracks = tracks(frame)
      expect(openTracks[1]).toBeGreaterThan(0)
      act(() => { vi.advanceTimersByTime(600) })
      expect(tracks(frame)).toEqual(openTracks)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps fullscreen suppression independent from resetting the instant marker', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openRightbar(true, true) })
    act(() => { instance.actions.setSidebar(350) })
    expect(frame.dataset.rightbarInstant).toBeUndefined()
    expect(frame.dataset.rightbarFullscreen).toBe('true')
  })

  it('preserves normal tracks through fullscreen and hides the outer resize handle', () => {
    const { frame, instance, rightOwner } = mountFrame()
    act(() => { instance.actions.openRightbar(true, false) })
    expect(tracks(frame)).toEqual([280, 864, 0])
    expect(handleFor(frame, 'rightbar').style.left).toBe('1056px')
    act(() => { instance.actions.openRightbar(true, true) })
    expect(tracks(frame)).toEqual([280, 864, 0])
    expect(rightOwner().width).toBe(864)
    expect(frame.dataset.rightbarFullscreen).toBe('true')
    expect(frame.querySelector('[data-side="rightbar"]')).toBeNull()
    act(() => { instance.actions.openRightbar(true, false) })
    expect(tracks(frame)).toEqual([280, 864, 0])
    expect(handleFor(frame, 'rightbar').style.left).toBe('1056px')
    expect(frame.dataset.rightbarFullscreen).toBeUndefined()
    act(() => { instance.actions.closeRightbar() })
    expect(tracks(frame)).toEqual([280, 0, 0])
    expect(frame.querySelector('[data-side="rightbar"]')).toBeNull()
    expect(frame.dataset.rightbarFullscreen).toBeUndefined()
  })

  it('inserts a fullscreen track and its transition-suppression marker in the same render', () => {
    const { frame, instance } = mountFrame()
    expect(tracks(frame)).toEqual([280, 0, 0])
    expect(frame.dataset.rightbarFullscreen).toBeUndefined()
    act(() => { instance.actions.openRightbar(true, true) })
    expect(tracks(frame)).toEqual([280, 864, 0])
    expect(frame.dataset.rightbarFullscreen).toBe('true')
    expect(frame.querySelector('[data-side="rightbar"]')).toBeNull()
    act(() => { instance.actions.openRightbar(true, false) })
    expect(tracks(frame)).toEqual([280, 864, 0])
    expect(frame.dataset.rightbarFullscreen).toBeUndefined()
  })

  it('retains fullscreen without a track when normal columns cannot fit', () => {
    // Upstream runs this at 700px against its narrow rail; this fork's
    // portrait phone band (PHONE_MAX 768) replaces the rail with the hidden
    // drawer there, so the tracks assert the phone layout while the scenario
    // under test — fullscreen retention without a track — still holds.
    frameWidth = 700
    const { frame, instance, rightOwner } = mountFrame()
    act(() => { instance.actions.openRightbar(false, true) })
    expect(tracks(frame)).toEqual([0, 0, 0])
    expect(rightOwner()).toEqual({ width: 0, viewportWidth: 700, canShow: false })
    expect(instance.getSnapshot().layoutInfo.rightbarShown).toBe(true)
    expect(frame.querySelector('[data-side="rightbar"]')).toBeNull()
  })

  it('keeps resolved panel width independent of the requested track', () => {
    const { frame, instance, rightOwner } = mountFrame()
    act(() => { instance.actions.openRightbar(false, false) })
    resize(1100)
    expect(tracks(frame)).toEqual([280, 0, 0])
    expect(rightOwner().width).toBe(420)
    drag(handleFor(frame, 'rightbar'), 680, 690)
    expect(instance.getSnapshot().layoutInfo.rightbar).toBe(410)
    expect(rightOwner().width).toBe(410)
    expect(tracks(frame)[1]).toBe(0)
  })
})

describe('AppFrame pointer resizing', () => {
  it('updates columns during the gesture and freezes the drag-start width', () => {
    const { frame, instance } = mountFrame()
    const handle = handleFor(frame, 'sidebar')
    pointer(handle, 'pointerdown', 280)
    expect(frame.dataset.dragging).toBe('true')
    pointer(handle, 'pointermove', 320)
    pointer(handle, 'pointermove', 340)
    expect(animationFrames.size).toBe(1)
    act(flushFrames)
    expect(tracks(frame)[0]).toBe(340)
    pointer(handle, 'pointermove', 360)
    act(flushFrames)
    expect(tracks(frame)[0]).toBe(360)
    pointer(handle, 'pointerup', 360)
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(360)
    expect(frame.dataset.dragging).toBeUndefined()
    expect(handle.hasPointerCapture(1)).toBe(false)
  })

  it('starts a conceded right drag at its actual width, shared by panel and track', () => {
    const { frame, instance, rightOwner } = mountFrame()
    act(() => { instance.actions.openRightbar(true, false) })
    resize(1100)
    const handle = handleFor(frame, 'rightbar')
    expect(rightOwner().width).toBe(420)
    expect(tracks(frame)[1]).toBe(420)
    expect(handle.style.left).toBe('680px')
    drag(handle, 680, 690)
    expect(instance.getSnapshot().layoutInfo.rightbar).toBe(410)
    expect(rightOwner().width).toBe(410)
    expect(tracks(frame)[1]).toBe(410)
    expect(handle.style.left).toBe('690px')
  })

  it('widens to the 70% limit and shrinks to 300px through pointer input', () => {
    frameWidth = 3000
    const { frame, instance, rightOwner } = mountFrame()
    act(() => { instance.actions.toggleSidebar(); instance.actions.openRightbar(true, false) })
    drag(handleFor(frame, 'rightbar'), 1650, 0)
    expect(rightOwner().width).toBe(2100)
    expect(tracks(frame)[1]).toBe(2100)
    drag(handleFor(frame, 'rightbar'), 900, 3000)
    expect(rightOwner().width).toBe(300)
    expect(tracks(frame)[1]).toBe(300)
  })

  it('commits the pointerup coordinate and cancels its pending animation frame', () => {
    const { frame, instance } = mountFrame()
    const handle = handleFor(frame, 'sidebar')
    pointer(handle, 'pointerdown', 280)
    pointer(handle, 'pointermove', 320)
    pointer(handle, 'pointerup', 360)
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(360)
    expect(animationFrames.size).toBe(0)
    act(flushFrames)
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(360)
  })

  it('ignores uncaptured motion, secondary buttons, and a second pointer', () => {
    const { frame, instance } = mountFrame()
    const handle = handleFor(frame, 'sidebar')
    pointer(handle, 'pointermove', 500, 9)
    pointer(handle, 'pointerup', 500, 9)
    pointer(handle, 'pointercancel', 500, 9)
    pointer(handle, 'pointerdown', 500, 9, 2)
    expect(frame.dataset.dragging).toBeUndefined()
    pointer(handle, 'pointerdown', 280)
    pointer(handle, 'pointerdown', 500, 9)
    pointer(handle, 'pointermove', 500, 9)
    pointer(handle, 'pointerup', 500, 9)
    expect(animationFrames.size).toBe(0)
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(280)
    pointer(handle, 'pointerup', 300)
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(300)
  })

  it.each(['pointercancel', 'lostpointercapture'])('ends %s without committing queued motion', (event) => {
    const { frame, instance } = mountFrame()
    const handle = handleFor(frame, 'sidebar')
    pointer(handle, 'pointerdown', 280)
    pointer(handle, 'pointermove', 340)
    if (event === 'lostpointercapture') handle.releasePointerCapture(1)
    pointer(handle, event, 340)
    act(flushFrames)
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(280)
    expect(animationFrames.size).toBe(0)
    expect(frame.dataset.dragging).toBeUndefined()
    expect(handle.hasPointerCapture(1)).toBe(false)
  })

  it.each(['fullscreen', 'close', 'unmount'])('cancels a pending drag on %s', (change) => {
    const { frame, instance, unmount } = mountFrame()
    act(() => { instance.actions.openRightbar(true, false) })
    const handle = handleFor(frame, 'rightbar')
    pointer(handle, 'pointerdown', 1056)
    pointer(handle, 'pointermove', 1000)
    act(() => {
      if (change === 'fullscreen') instance.actions.openRightbar(true, true)
      else if (change === 'close') instance.actions.closeRightbar()
      else unmount()
    })
    const settled = instance.getSnapshot()
    act(flushFrames)
    expect(instance.getSnapshot()).toBe(settled)
    expect(instance.getSnapshot().layoutInfo.rightbar).toBe(864)
    expect(animationFrames.size).toBe(0)
    expect(handle.hasPointerCapture(1)).toBe(false)
    if (change !== 'unmount') expect(frame.dataset.dragging).toBeUndefined()
  })
})

describe('AppFrame frame measurement lifecycle', () => {
  it('coalesces observer reports and publishes the latest frame measurement', () => {
    const { instance, rightOwner } = mountFrame()
    const observer = observers.at(-1)!
    act(() => {
      frameWidth = 900
      observer.fire()
      frameWidth = 1200
      observer.fire()
    })
    expect(animationFrames.size).toBe(1)
    expect(instance.getSnapshot().layoutInfo.viewportWidth).toBe(1920)
    act(flushFrames)
    expect(instance.getSnapshot().layoutInfo.viewportWidth).toBe(1200)
    expect(rightOwner().viewportWidth).toBe(1200)
    expect(instance.getSnapshot().layoutInfo.rightbar).toBeNull()
  })

  it('retains the last positive measurement while the frame is hidden', () => {
    const { instance, rightOwner } = mountFrame()
    resize(0)
    expect(instance.getSnapshot().layoutInfo.viewportWidth).toBe(1920)
    expect(rightOwner().viewportWidth).toBe(1920)
  })

  it('recovers a zero first-render window width from the measured frame', () => {
    initialWindowWidth = 0
    const { frame, instance } = mountFrame()
    act(flushFrames)
    expect(instance.getSnapshot().layoutInfo.viewportWidth).toBe(1920)
    act(() => { instance.actions.openRightbar(true, false) })
    expect(tracks(frame)[1]).toBe(864)
  })

  it('disconnects the observer and prevents queued or late reports after unmount', () => {
    const { instance, unmount } = mountFrame()
    const observer = observers.at(-1)!
    frameWidth = 800
    act(() => { observer.fire() })
    expect(animationFrames.size).toBe(1)
    unmount()
    expect(observer.disconnected).toBe(true)
    expect(animationFrames.size).toBe(0)
    act(() => { observer.fire(); flushFrames() })
    expect(instance.getSnapshot().layoutInfo.viewportWidth).toBe(1920)
    expect(animationFrames.size).toBe(0)
  })
})

describe('AppFrame — surfaces column and terminal drawer', () => {
  it('renders the surfaces column, terminal drawer track, and titlebar trailing slot', () => {
    const { frame, getByTestId, slotCalls, trailingOwner } = mountFrame()
    expect(frame.querySelector('[data-testid="surfaces-content"]')).toBeNull()
    expect(getByTestId('shell.terminalDrawer-content')).toBeTruthy()
    expect(getByTestId('shell.titlebar.trailing-content')).toBeTruthy()
    expect(slotCalls.map(c => c.key)).toEqual(expect.arrayContaining([
      'rightbar', 'shell.terminalDrawer', 'shell.titlebar.trailing',
    ]))
    expect(tracks(frame)[2]).toBe(0)
    expect(drawerTrack(frame)).toBe(0)
    expect(frame.querySelector('[data-titlebar-trailing]')).toBeTruthy()
    expect(frame.querySelector('[data-titlebar-row]')).toBeTruthy()
    expect(frame.querySelector('#dshd-shell-titlebar-trailing')).toBeTruthy()
    expect(trailingOwner()).toEqual({
      surfaces: 0, rightbarShown: false, terminalDrawer: 0, managedSession: false, density: 'full',
    })
  })

  it('passes managed presentation state to the titlebar trailing slot', () => {
    selectedSessionManaged.current = true
    const { trailingOwner } = mountFrame()
    expect(trailingOwner()).toEqual({
      surfaces: 0, rightbarShown: false, terminalDrawer: 0, managedSession: true, density: 'full',
    })
  })

  it('open surfaces and terminal drawer write their contract default tracks', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openRightbar(true, false) })
    expect(tracks(frame)[1]).toBe(864)
    expect(frame.hasAttribute('data-rightbar-collapsed')).toBe(false)
    expect(frame.querySelectorAll('[class*="handle"]')).toHaveLength(2)
    act(() => { instance.actions.toggleTerminalDrawer() })
    expect(drawerTrack(frame)).toBe(280)
    expect(frame.hasAttribute('data-terminal-drawer-collapsed')).toBe(false)
  })

  it('keeps an open surfaces column full height with shared caption tools', () => {
    const { frame, instance } = mountFrame()
    expect(frame.style.gridTemplateRows.startsWith('auto minmax(0, 1fr)')).toBe(true)
    expect(frame.querySelector('[data-titlebar-row]')).toBeTruthy()
    expect(frame.firstElementChild?.getAttribute('data-dshd-caption')).toBe('band')
    const trailing = frame.querySelector('[data-titlebar-trailing]')!
    expect(trailing.hasAttribute('data-titlebar-trailing-over-surfaces')).toBe(true)
    act(() => { instance.actions.openRightbar(true, false) })
    expect(frame.hasAttribute('data-rightbar-collapsed')).toBe(false)
    expect(frame.querySelector('[data-dshd-caption="band"]')).toBeTruthy()
    expect(trailing.hasAttribute('data-titlebar-trailing-over-surfaces')).toBe(false)
    act(() => { instance.actions.closeRightbar() })
    expect(frame.hasAttribute('data-surfaces-collapsed')).toBe(true)
    expect(trailing.hasAttribute('data-titlebar-trailing-over-surfaces')).toBe(true)
  })

  it('ignores stale legacy column widths and exposes only one right resize handle', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openSurfaces(); instance.actions.openRightbar(true, false) })
    expect(tracks(frame)[2]).toBe(0)
    expect(frame.querySelectorAll('[data-side="rightbar"]')).toHaveLength(1)
    expect(frame.querySelector('[data-side="surfaces"]')).toBeNull()
    drag(handleFor(frame, 'rightbar'), 1056, 996)
    expect(tracks(frame)[1]).toBe(924)
  })

  it('keeps surfaces and the terminal drawer mounted at zero size when closed', () => {
    const { frame, getByTestId } = mountFrame()
    expect(tracks(frame)[2]).toBe(0)
    expect(drawerTrack(frame)).toBe(0)
    expect(frame.querySelector('[data-testid="surfaces-content"]')).toBeNull()
    expect(getByTestId('shell.terminalDrawer-content')).toBeTruthy()
    expect(frame.hasAttribute('data-surfaces-collapsed')).toBe(true)
    expect(frame.hasAttribute('data-terminal-drawer-collapsed')).toBe(true)
  })
})

describe('AppFrame — titlebar density and conversation reserve', () => {
  it('reserves the measured trailing width in the conversation column when the rightbar is closed', () => {
    trailingClusterWidth = 400
    const { frame } = mountFrame()
    act(() => { resize(frameWidth) })
    expect(frame.getAttribute('data-titlebar-density')).toBe('full')
    expect(frame.hasAttribute('data-titlebar-over-conversation')).toBe(true)
    expect(frame.style.getPropertyValue('--dshd-titlebar-conversation-reserve')).toBe('400px')
  })

  it('rounds fractional trailing width up so the 8px clearance is never short', () => {
    trailingClusterWidth = 459.27
    const { frame } = mountFrame()
    act(() => { resize(frameWidth) })
    expect(frame.style.getPropertyValue('--dshd-titlebar-conversation-reserve')).toBe('460px')
  })

  it('does not reserve conversation space when the global caption tools fit above the right column', () => {
    trailingClusterWidth = 300
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openRightbar(true, false) })
    act(() => { resize(frameWidth) })
    expect(frame.hasAttribute('data-titlebar-over-conversation')).toBe(true)
    expect(frame.getAttribute('data-titlebar-density')).toBe('cozy')
    expect(tracks(frame)[1]).toBeGreaterThan(trailingClusterWidth)
    expect(frame.style.getPropertyValue('--dshd-titlebar-conversation-reserve')).toBe('0px')
  })

  it.each([
    { clusterWidth: 160, extent: 240, overlap: 0 },
    { clusterWidth: 480, extent: 560, overlap: 60 },
  ])('reserves only $overlap px over a 400px Windows conversation for a $extent px tool extent', ({ clusterWidth, extent, overlap }) => {
    document.documentElement.setAttribute('data-windows-titlebar', '')
    frameWidth = 900
    trailingClusterWidth = clusterWidth
    const { frame, instance } = mountFrame()
    const trailing = frame.querySelector<HTMLElement>('[data-titlebar-trailing]')!
    trailing.style.marginRight = '80px'
    act(() => {
      instance.actions.openRightbar(true, false)
      instance.actions.setRightbar(500)
      resize(frameWidth)
    })
    const [sidebar, rightbar] = tracks(frame)
    expect(frameWidth - sidebar! - rightbar!).toBe(400)
    expect(rightbar).toBe(500)
    expect(frame.hasAttribute('data-titlebar-trailing-hidden')).toBe(false)
    expect(frame.style.getPropertyValue('--dshd-titlebar-conversation-reserve')).toBe(`${overlap}px`)

    act(() => { instance.actions.closeRightbar() })
    expect(frame.style.getPropertyValue('--dshd-titlebar-conversation-reserve')).toBe(`${extent}px`)
  })

  it.each([
    { width: 1280, center: 700, closedDensity: 'full' },
    { width: 700, center: 400, closedDensity: 'compact' },
  ])('uses compact Git controls in a 300px rightbar at $width px and restores $closedDensity when closed', ({ width, center, closedDensity }) => {
    document.documentElement.setAttribute('data-windows-titlebar', '')
    frameWidth = width
    const { frame, instance, trailingOwner } = mountFrame()
    act(() => {
      instance.actions.openRightbar(true, false)
      instance.actions.setRightbar(300)
    })
    const [sidebar, rightbar] = tracks(frame)
    expect(rightbar).toBe(300)
    expect(frameWidth - sidebar! - rightbar!).toBe(center)
    expect(frame.getAttribute('data-titlebar-density')).toBe('compact')
    expect(trailingOwner()).toEqual({
      surfaces: 0, rightbarShown: true, terminalDrawer: 0, managedSession: false, density: 'compact',
    })
    act(() => { instance.actions.closeRightbar() })
    expect(frame.getAttribute('data-titlebar-density')).toBe(closedDensity)
    expect(trailingOwner()).toMatchObject({ rightbarShown: false, density: closedDensity })
  })

  it('keeps the trailing tools and reserve on a narrow browser header above phone width', () => {
    frameWidth = 980
    trailingClusterWidth = 160
    const { frame } = mountFrame()
    expect(frame.hasAttribute('data-compact-header')).toBe(true)
    expect(frame.hasAttribute('data-titlebar-trailing-hidden')).toBe(false)
    expect(frame.hasAttribute('data-titlebar-over-conversation')).toBe(true)
    expect(frame.getAttribute('data-titlebar-density')).toBe('full')
    expect(frame.style.getPropertyValue('--dshd-titlebar-conversation-reserve')).toBe('160px')
  })

  it.each([900, 700])('keeps the Windows Git tools and their reserve at %ipx', width => {
    document.documentElement.setAttribute('data-windows-titlebar', '')
    frameWidth = width
    trailingClusterWidth = 160
    const { frame, getByTestId } = mountFrame()
    expect(frame.hasAttribute('data-compact-header')).toBe(true)
    expect(frame.hasAttribute('data-titlebar-trailing-hidden')).toBe(false)
    expect(frame.hasAttribute('data-titlebar-over-conversation')).toBe(true)
    expect(getByTestId('shell.titlebar.trailing-content')).toBeTruthy()
    expect(frame.style.getPropertyValue('--dshd-titlebar-conversation-reserve')).toBe('160px')
  })

  it('hides the browser phone tools and releases their conversation reserve', () => {
    frameWidth = 700
    trailingClusterWidth = 160
    const { frame } = mountFrame()
    expect(frame.hasAttribute('data-titlebar-trailing-hidden')).toBe(true)
    expect(frame.hasAttribute('data-titlebar-over-conversation')).toBe(false)
    expect(frame.getAttribute('data-titlebar-density')).toBe('full')
    expect(frame.style.getPropertyValue('--dshd-titlebar-conversation-reserve')).toBe('0px')
  })
})

describe('AppFrame — narrow-viewport auto-collapse', () => {
  it('mounts collapsed below the breakpoint with no sidebar handle', () => {
    frameWidth = 980
    const { frame, sidebarOwner } = mountFrame()
    expect(tracks(frame)).toEqual([SIDEBAR_COLLAPSED, 0, 0])
    expect(frame.hasAttribute('data-sidebar-collapsed')).toBe(true)
    expect(frame.hasAttribute('data-compact-header')).toBe(true)
    expect(sidebarOwner()).toEqual({ collapsed: true, width: SIDEBAR_COLLAPSED })
    expect(frame.querySelectorAll('[class*="handle"]')).toHaveLength(0)
  })

  it('keeps the shared titlebar row with the tools on a compact browser header', () => {
    frameWidth = 980
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openRightbar(true, false) })
    expect(frame.hasAttribute('data-compact-header')).toBe(true)
    expect(frame.hasAttribute('data-titlebar-trailing-hidden')).toBe(false)
    expect(frame.querySelector('[data-titlebar-row]')).toBeTruthy()
    expect(frame.style.gridTemplateRows.startsWith('auto minmax(0, 1fr)')).toBe(true)
  })

  it('narrow toggle re-expands over the squeezed center and back', () => {
    frameWidth = 980
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)).toEqual([280, 0, 0])
    expect(frame.hasAttribute('data-sidebar-collapsed')).toBe(false)
    expect(frame.querySelectorAll('[class*="handle"]')).toHaveLength(1)
    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)).toEqual([SIDEBAR_COLLAPSED, 0, 0])
  })

  it('a wide-closed preference re-expands at the contract default while narrow', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.toggleSidebar() }) // close while wide: preference 0
    frameWidth = 980
    act(() => { resize(frameWidth) })
    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)).toEqual([280, 0, 0])
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(0) // preference untouched
  })

  it('shrinking across the breakpoint auto-collapses; re-widening restores the drag width', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.setSidebar(400) })
    frameWidth = 980
    act(() => { resize(frameWidth) })
    expect(tracks(frame)).toEqual([SIDEBAR_COLLAPSED, 0, 0])
    frameWidth = 1920
    act(() => { resize(frameWidth) })
    expect(tracks(frame)).toEqual([400, 0, 0])
  })
})

describe('AppFrame — phone overlay shell', () => {
  it('drops every grid track and shows a menu instead of the rail', () => {
    frameWidth = 390
    const { frame, sidebarOwner, getByRole } = mountFrame()
    expect(tracks(frame)).toEqual([0, 0, 0])
    expect(frame.hasAttribute('data-phone')).toBe(true)
    expect(frame.hasAttribute('data-sidebar-collapsed')).toBe(true)
    expect(frame.hasAttribute('data-phone-sidebar')).toBe(false)
    expect(sidebarOwner()).toEqual({ collapsed: true, width: 0 })
    expect(frame.querySelectorAll('[class*="handle"]')).toHaveLength(0)
    expect(getByRole('button', { name: 'Open sidebar' })).toBeTruthy()
    expect(frame.querySelector('#dshd-shell-titlebar-trailing')).toBeTruthy()
    expect(frame.hasAttribute('data-compact-header')).toBe(true)
  })

  it('toggle opens the drawer over the conversation and closes from the backdrop', () => {
    frameWidth = 390
    const { frame, instance, sidebarOwner, getByRole, queryByRole } = mountFrame()
    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)).toEqual([0, 0, 0])
    expect(frame.hasAttribute('data-phone-sidebar')).toBe(true)
    expect(frame.hasAttribute('data-sidebar-collapsed')).toBe(false)
    expect(sidebarOwner()).toEqual({ collapsed: false, width: PHONE_DRAWER })
    expect(queryByRole('button', { name: 'Open sidebar' })).toBeNull()
    expect(getByRole('button', { name: 'Close sidebar' })).toBeTruthy()
    expect(frame.querySelectorAll('[class*="handle"]')).toHaveLength(0)
    act(() => { getByRole('button', { name: 'Close sidebar' }).click() })
    expect(frame.hasAttribute('data-phone-sidebar')).toBe(false)
    expect(getByRole('button', { name: 'Open sidebar' })).toBeTruthy()
  })

  it('a shown rightbar paints as a full-frame overlay with no drag handles', () => {
    frameWidth = 390
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openRightbar(true, true) })
    expect(tracks(frame)).toEqual([0, 0, 0])
    expect(frame.hasAttribute('data-phone-details')).toBe(true)
    expect(frame.querySelectorAll('[class*="handle"]')).toHaveLength(0)
  })

  it('keeps the overlay when matchMedia is landscape but the device is portrait', () => {
    frameWidth = 390
    landscape = true
    Object.defineProperty(window.screen, 'orientation', {
      configurable: true,
      value: {
        type: 'portrait-primary',
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    })
    const { frame, getByRole } = mountFrame()
    expect(frame.hasAttribute('data-phone')).toBe(true)
    expect(getByRole('button', { name: 'Open sidebar' })).toBeTruthy()
  })

  it('does not leave the overlay when the frame box is wider than the window', () => {
    frameWidth = 390
    const { frame, getByRole } = mountFrame()
    frameWidth = 1200
    act(() => { resize(frameWidth) })
    expect(frame.hasAttribute('data-phone')).toBe(true)
    expect(getByRole('button', { name: 'Open sidebar' })).toBeTruthy()
  })

  it('tracks device rotation through screen.orientation', () => {
    frameWidth = 390
    let type = 'portrait-primary'
    const listeners = new Set<() => void>()
    Object.defineProperty(window.screen, 'orientation', {
      configurable: true,
      value: {
        get type() { return type },
        addEventListener: (_name: string, fn: () => void) => { listeners.add(fn) },
        removeEventListener: (_name: string, fn: () => void) => { listeners.delete(fn) },
      },
    })
    const { frame, queryByRole } = mountFrame()
    expect(frame.hasAttribute('data-phone')).toBe(true)
    type = 'landscape-primary'
    landscape = true
    stubScreenAvail(844, 390)
    frameWidth = 844
    act(() => {
      for (const listener of listeners) listener()
      flushFrames()
    })
    expect(frame.hasAttribute('data-phone')).toBe(false)
    expect(queryByRole('button', { name: 'Open sidebar' })).toBeNull()
  })

  it('trusts the physical screen when orientation.type stays portrait after rotate', () => {
    frameWidth = 390
    Object.defineProperty(window.screen, 'orientation', {
      configurable: true,
      value: {
        type: 'portrait-primary',
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    })
    const { frame, queryByRole } = mountFrame()
    expect(frame.hasAttribute('data-phone')).toBe(true)
    stubScreenAvail(844, 390)
    frameWidth = 844
    act(() => {
      window.dispatchEvent(new Event('resize'))
      flushFrames()
    })
    expect(frame.hasAttribute('data-phone')).toBe(false)
    expect(queryByRole('button', { name: 'Open sidebar' })).toBeNull()
  })

  it('falls through to matchMedia when the physical screen box is unusable', () => {
    frameWidth = 390
    stubScreenAvail(0, 0)
    const { frame, getByRole } = mountFrame()
    expect(frame.hasAttribute('data-phone')).toBe(true)
    expect(getByRole('button', { name: 'Open sidebar' })).toBeTruthy()
    stubScreenAvail(400, 400)
    act(() => {
      window.dispatchEvent(new Event('resize'))
      flushFrames()
    })
    expect(frame.hasAttribute('data-phone')).toBe(true)
    Object.defineProperty(window.screen, 'availWidth', { configurable: true, value: undefined })
    act(() => {
      window.dispatchEvent(new Event('resize'))
      flushFrames()
    })
    expect(frame.hasAttribute('data-phone')).toBe(true)
    stubScreenAvail(400, 400)
    Object.defineProperty(window.screen, 'availHeight', { configurable: true, value: undefined })
    act(() => {
      window.dispatchEvent(new Event('resize'))
      flushFrames()
    })
    expect(frame.hasAttribute('data-phone')).toBe(true)
  })

  it('does not throw when screen.orientation lacks EventTarget methods', () => {
    frameWidth = 390
    Object.defineProperty(window.screen, 'orientation', {
      configurable: true,
      value: { type: 'portrait-primary' },
    })
    const { frame, getByRole } = mountFrame()
    expect(frame.hasAttribute('data-phone')).toBe(true)
    expect(getByRole('button', { name: 'Open sidebar' })).toBeTruthy()
  })
})

describe('AppFrame — landscape sidebar', () => {
  it('keeps the left sidebar control effective after a desktop landscape resize', () => {
    frameWidth = 1441
    landscape = true
    stubScreenAvail(1920, 1080)
    Object.defineProperty(window.screen, 'orientation', {
      configurable: true,
      value: {
        type: 'landscape-primary',
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    })
    document.documentElement.setAttribute('data-windows-titlebar', '')
    const { frame, instance, sidebarOwner, rightOwner } = mountFrame()
    expect(tracks(frame)[0]).toBe(SIDEBAR_DEFAULT)

    vi.stubGlobal('innerWidth', 962)
    resize(962)
    expect(sidebarOwner()).toEqual({ collapsed: false, width: SIDEBAR_DEFAULT })
    expect(rightOwner().canShow).toBe(false)

    // SidebarRoot's button invokes this public layout action.
    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)[0]).toBe(0)
    expect(sidebarOwner()).toEqual({ collapsed: true, width: 0 })
    expect(rightOwner().canShow).toBe(true)

    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)[0]).toBe(SIDEBAR_DEFAULT)
    expect(sidebarOwner()).toEqual({ collapsed: false, width: SIDEBAR_DEFAULT })
    expect(rightOwner().canShow).toBe(false)

    vi.stubGlobal('innerWidth', 1441)
    resize(1441)
    expect(tracks(frame)[0]).toBe(SIDEBAR_DEFAULT)
    expect(rightOwner().canShow).toBe(true)
  })

  it('keeps the sidebar in the grid on a phone-width landscape frame', () => {
    frameWidth = 844
    landscape = true
    stubScreenAvail(844, 390)
    const { frame, sidebarOwner, queryByRole } = mountFrame()
    expect(tracks(frame)).toEqual([SIDEBAR_DEFAULT, 0, 0])
    expect(frame.hasAttribute('data-phone')).toBe(false)
    expect(frame.hasAttribute('data-sidebar-collapsed')).toBe(false)
    expect(sidebarOwner()).toEqual({ collapsed: false, width: SIDEBAR_DEFAULT })
    expect(queryByRole('button', { name: 'Open sidebar' })).toBeNull()
    expect(frame.hasAttribute('data-compact-header')).toBe(true)
    expect(frame.querySelectorAll('[class*="handle"]')).toHaveLength(1)
  })

  it('hides the trailing cluster below browser phone width even in landscape', () => {
    frameWidth = 700
    landscape = true
    stubScreenAvail(844, 390)
    const { frame, rerenderFrame } = mountFrame()
    expect(frame.hasAttribute('data-compact-header')).toBe(true)
    expect(frame.hasAttribute('data-titlebar-trailing-hidden')).toBe(true)
    frameWidth = PHONE_MAX
    vi.stubGlobal('innerWidth', PHONE_MAX)
    act(() => {
      resize(frameWidth)
      rerenderFrame()
    })
    expect(frame.hasAttribute('data-titlebar-trailing-hidden')).toBe(false)
  })

  it('rotating from portrait overlay to landscape puts the sidebar in the grid', () => {
    frameWidth = 390
    const { frame, getByRole } = mountFrame()
    expect(frame.hasAttribute('data-phone')).toBe(true)
    expect(getByRole('button', { name: 'Open sidebar' })).toBeTruthy()
    landscape = true
    stubScreenAvail(844, 390)
    frameWidth = 844
    vi.stubGlobal('innerWidth', 844)
    act(() => {
      for (const listener of orientationListeners) listener({ matches: true } as MediaQueryListEvent)
      flushFrames()
    })
    expect(frame.hasAttribute('data-phone')).toBe(false)
    expect(tracks(frame)).toEqual([SIDEBAR_DEFAULT, 0, 0])
  })

  it('re-reads rotation from a window resize when orientation.change does not fire', () => {
    frameWidth = 390
    stubScreenAvail(390, 844)
    const { frame, queryByRole } = mountFrame()
    expect(frame.hasAttribute('data-phone')).toBe(true)
    landscape = true
    stubScreenAvail(844, 390)
    frameWidth = 844
    act(() => {
      window.dispatchEvent(new Event('resize'))
      flushFrames()
    })
    expect(frame.hasAttribute('data-phone')).toBe(false)
    expect(queryByRole('button', { name: 'Open sidebar' })).toBeNull()
  })

  it('re-reads rotation from visualViewport resize', () => {
    frameWidth = 390
    const listeners = new Set<() => void>()
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        addEventListener: (_name: string, fn: () => void) => { listeners.add(fn) },
        removeEventListener: (_name: string, fn: () => void) => { listeners.delete(fn) },
      },
    })
    const { frame, queryByRole } = mountFrame()
    expect(listeners.size).toBe(1)
    landscape = true
    stubScreenAvail(844, 390)
    frameWidth = 844
    act(() => {
      for (const listener of listeners) listener()
      flushFrames()
    })
    expect(frame.hasAttribute('data-phone')).toBe(false)
    expect(queryByRole('button', { name: 'Open sidebar' })).toBeNull()
    Reflect.deleteProperty(window, 'visualViewport')
  })
})

describe('AppFrame — guard branches', () => {
  it('pointer moves without capture are ignored (no width write)', () => {
    const { frame, instance } = mountFrame()
    const handle = handleFor(frame, 'sidebar')
    const before = instance.getSnapshot().layoutInfo.sidebar
    act(() => {
      handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 9, clientX: 500, bubbles: true }))
      flushFrames()
      handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, clientX: 500, bubbles: true }))
    })
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(before)
  })

  it('two moves inside one frame coalesce through the pending rAF', () => {
    const { frame, instance } = mountFrame()
    const handle = handleFor(frame, 'sidebar')
    pointer(handle, 'pointerdown', 280)
    act(() => {
      handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 320, bubbles: true }))
      handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 340, bubbles: true }))
      flushFrames()
    })
    pointer(handle, 'pointerup', 340)
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(340)
  })

  it('zero-width resize reports are ignored (display:none window)', () => {
    const { frame } = mountFrame()
    frameWidth = 0
    act(() => { resize(frameWidth) })
    expect(tracks(frame)).toEqual([280, 0, 0])
  })

  it('double resize inside one frame rides the pending rAF (??= guard)', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openRightbar(true, false) })
    frameWidth = 1200
    act(() => {
      for (const observer of observers) if (!observer.disconnected) observer.fire()
      for (const observer of observers) if (!observer.disconnected) observer.fire()
      flushFrames()
    })
    expect(tracks(frame)[2]).toBe(0)
  })
})

describe('AppFrame — unmount with an in-flight resize frame', () => {
  it('cancels the pending rAF on unmount (no post-unmount setState)', () => {
    const { unmount } = mountFrame()
    frameWidth = 800
    act(() => {
      for (const observer of observers) if (!observer.disconnected) observer.fire()
    })
    expect(animationFrames.size).toBe(1)
    unmount()
    expect(animationFrames.size).toBe(0)
    expect(() => { flushFrames() }).not.toThrow()
  })
})
