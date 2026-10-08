/**
 * Shell frame, registered into the built-in 'root' slot (the web shell renders
 * only 'root'). Owns the sidebar, conversation, and single full-height rightbar
 * tracks; the legacy surfaces track stays at zero. Also owns the conversation
 * titlebar row and the conversation-
 * column terminal drawer, the single 48px caption drag band (columns 1–end,
 * first child so columns paint above it), the titlebar trailing cluster (in
 * that row, ending before the open rightbar), the phone overlay band
 * (portrait below PHONE_MAX), landscape sidebar (rotate keeps the column in
 * the grid), the drag handles (pointer capture + rAF throttle), the concession
 * chain (columns.ts), and the child-slot render decisions: the sidebar slot
 * renders HERE with live parameters from the concession solve, the root-scoped
 * main slot selects the Conversation or a global panel, and the session-aware
 * occupants render in fixed column positions; strict entries gate themselves
 * on current-session availability while session-maybe entries retain identity.
 * Every column occupant owns its Session binding and reports the geometry it
 * needs: the right column is a track, not a box — its occupant draws its panel
 * anchored to the frame's right edge at the resolved normal width and reports
 * shown/track/fullscreen through `ctx.layout`, while fullscreen keeps the
 * reported track but hides the outer resize handle.
 * Pure component: everything arrives through the framework shares — zero
 * cordis or framework imports, zero self-made hooks.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type {
  PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import {
  computeColumns, PHONE_DRAWER, PHONE_MAX, RIGHTBAR_DEFAULT_RATIO,
  SIDEBAR_AUTO_COLLAPSE, SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT, SIDEBAR_MIN,
} from './columns.ts'
import { DocumentTitle } from './DocumentTitle.tsx'
import type { createLayoutStore } from './stores.ts'
import { resolveTitlebarDensity, titlebarConversationReserve } from './titlebar-density.ts'
import css from './AppFrame.module.css'

/** Full composed props: runtime share + child-slot render share + store share. */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'main' | 'rightbar' | 'surfaces' | 'shell.bottom' | 'shell.overlay' | 'shell.titlebar.trailing' | 'shell.terminalDrawer'>
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & PropsLocale<'common'>

/** Center column grid item (session-body building block). */
function CenterColumn(props: { children?: ReactNode }) {
  return <div className={css.centerCol}>{props.children}</div>
}

/** Subscribe to the main key without subscribing the column frame to each panel id. */
function MainPanel({ usePanelInfo, renderSlot }: Pick<PropsRuntime<'root'>, 'usePanelInfo'> & PropsRenderSlots<'main'>) {
  const panelId = usePanelInfo(info => info.activePanelId)
  const entryKey = panelId ?? 'conversation'
  const panel = renderSlot('main', {}, { entryKey })
  // Only the Conversation owns the shared titlebar row through the centerCol
  // subgrid; every other panel gets the content row (see .mainPanel).
  if (entryKey === 'conversation') return panel
  return <div className={css.mainPanel} data-main-panel>{panel}</div>
}

/**
 * Right column grid item; width 0 keeps the subtree mounted (never unmount on
 * close). The column never clips: its occupant anchors a fixed-width panel to
 * the column's right edge, which never moves, so it can hang over the centre
 * when there is no track (AppFrame.module.css `.detailsCol`).
 */
function RightbarColumn(props: { children?: ReactNode }) {
  return <div className={css.detailsCol} data-rightbar-col>{props.children}</div>
}

/** Terminal drawer under the conversation column; height 0 keeps the subtree mounted. */
function TerminalDrawerTrack(props: { children?: ReactNode }) {
  return <div className={css.terminalDrawerCol}>{props.children}</div>
}

/**
 * One drag handle: pointer capture, rAF-throttled dx reports against the drag-start origin.
 * `side` keys the hover-reveal CSS to the owning column.
 */
function DragHandle(props: { side: 'sidebar' | 'rightbar' | 'surfaces'; left: number; onStart: () => void; onDrag: (dx: number) => void; onEnd: () => void }) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const capture = useRef<{ element: HTMLDivElement; id: number } | null>(null)
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd })
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd }

  const endDrag = useCallback(() => {
    const active = capture.current
    if (active === null) return
    capture.current = null
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    if (active.element.hasPointerCapture(active.id)) active.element.releasePointerCapture(active.id)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])
  useEffect(() => endDrag, [endDrag])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || capture.current !== null) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    capture.current = { element: e.currentTarget, id: e.pointerId }
    origin.current = e.clientX
    latest.current = e.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (capture.current?.id !== e.pointerId) return
    latest.current = e.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (capture.current?.id !== e.pointerId) return
    callbacks.current.onDrag(e.clientX - origin.current)
    endDrag()
  }, [endDrag])
  const onPointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (capture.current?.id === e.pointerId) endDrag()
  }, [endDrag])

  return (
    <div
      className={css.handle}
      style={{ left: props.left }}
      data-side={props.side}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
    />
  )
}

/**
 * Physical screen aspect. A keyboard resizes the layout viewport and can
 * flip CSS `orientation` without rotating the device; `availWidth`/`availHeight`
 * stay put. Returns `undefined` when the screen box is missing or square.
 */
function physicalScreenLandscape(): boolean | undefined {
  const width = window.screen.availWidth
  const height = window.screen.availHeight
  if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) return undefined
  if (width === height) return undefined
  return width > height
}

/**
 * Device rotation, not the viewport's aspect ratio. Prefer
 * `screen.orientation.type`, then the physical screen, then matchMedia.
 * When type and the physical screen disagree, trust the screen: some
 * browsers leave `orientation.type` stale or skip `orientation.change`.
 */
function screenOrientation(): ScreenOrientation | undefined {
  // The DOM lib types screen.orientation as always present, but jsdom and
  // older browsers omit it; the cast mirrors desktop-shell's window.shell probe.
  return (window.screen as Screen & { orientation?: ScreenOrientation }).orientation
}

function readDeviceLandscape(): boolean {
  const type = screenOrientation()?.type
  const fromScreen = physicalScreenLandscape()
  if (typeof type === 'string' && type.length > 0) {
    const fromType = type.startsWith('landscape')
    if (fromScreen !== undefined && fromScreen !== fromType) return fromScreen
    return fromType
  }
  if (fromScreen !== undefined) return fromScreen
  return window.matchMedia('(orientation: landscape)').matches
}

/** EventTarget-shaped target that may be presence-only (e.g. `screen.orientation`). */
interface OptionalEventTarget {
  addEventListener?: (type: string, fn: () => void) => void
  removeEventListener?: (type: string, fn: () => void) => void
}

/** Subscribe only when the target implements EventTarget; a presence-only
 * `screen.orientation` object must not throw and take down the shell. */
function subscribe(
  target: OptionalEventTarget | null | undefined,
  type: string,
  fn: () => void,
): () => void {
  if (target === null || target === undefined) return () => {}
  if (typeof target.addEventListener !== 'function' || typeof target.removeEventListener !== 'function') return () => {}
  target.addEventListener(type, fn)
  // The typeof guards above do not narrow the property access inside this closure.
  return () => { target.removeEventListener?.(type, fn) }
}

/** The four-column frame (see module doc). */
export function AppFrame({
  useStore,
  useSessions,
  usePanelInfo,
  actions,
  renderSlot,
  t,
}: AppFrameProps) {
  const layoutInfo = useStore(state => state.layoutInfo)
  const managedSession = useSessions((s) => {
    const current = Object.values(s.byId)
      .find(session => (session.retainedBy.mainView ?? 0) > 0)?.id
    return current !== undefined && s.byId[current]?.presentation?.composer === 'managed'
  })
  const activeSession = useSessions((s) => {
    const current = Object.values(s.byId)
      .find(session => (session.retainedBy.mainView ?? 0) > 0)?.id
    return current !== undefined && s.byId[current]?.blank === false ? current : undefined
  })
  const frameRef = useRef<HTMLDivElement | null>(null)
  const trailingRef = useRef<HTMLDivElement | null>(null)
  const viewport = layoutInfo.viewportWidth
  const [landscape, setLandscape] = useState(() => readDeviceLandscape())
  const [trailingWidth, setTrailingWidth] = useState(0)

  // Session switch on phone/tablet: drop the overlay/re-expanded drawer
  // without rewriting the wide-window width preference.
  const lastSession = useRef(activeSession)
  useLayoutEffect(() => {
    if (activeSession === undefined) return
    if (lastSession.current !== undefined && lastSession.current !== activeSession) {
      actions.closeNarrowSidebar()
    }
    lastSession.current = activeSession
  }, [actions, activeSession])

  // Track the frame box and device rotation together. Cap width to innerWidth
  // so a min-content overflow cannot promote the shell out of the phone/narrow
  // bands. Re-read landscape on resize as well as orientation.change: some
  // mobile browsers skip that event after a rotate.
  useEffect(() => {
    const frameElement = frameRef.current
    /* v8 ignore next -- the ref is always attached by effect time: the frame div renders unconditionally. */
    if (frameElement === null) return
    const el = frameElement
    let disposed = false
    let raf: number | null = null
    let rafFallback: number | null = null
    let zeroWidthRetry: number | null = null
    const scheduleZeroWidthRetry = (): void => {
      if (zeroWidthRetry !== null) return
      zeroWidthRetry = window.setTimeout(() => {
        zeroWidthRetry = null
        apply()
      }, 50)
    }
    function measure(): void {
      if (disposed) return
      if (rafFallback !== null) {
        window.clearTimeout(rafFallback)
        rafFallback = null
      }
      raf = null
      setLandscape(readDeviceLandscape())
      const frameWidth = el.getBoundingClientRect().width
      const windowWidth = window.innerWidth
      const width = frameWidth > 0
        ? Math.min(frameWidth, windowWidth > 0 ? windowWidth : frameWidth)
        : windowWidth
      if (width > 0) actions.setViewportWidth(width)
      else scheduleZeroWidthRetry()
      const trailing = trailingRef.current
      /* v8 ignore next -- the trailing cluster mounts unconditionally with the frame. */
      if (trailing !== null) {
        // Ceil the measured box: rounding down loses subpixel clearance
        // between the conversation utilities and this cluster.
        const inset = Number.parseFloat(window.getComputedStyle(trailing).marginRight) || 0
        setTrailingWidth(Math.max(0, Math.ceil(trailing.getBoundingClientRect().width + inset)))
      }
    }
    function apply(): void {
      if (disposed || raf !== null) return
      raf = requestAnimationFrame(measure)
      rafFallback = window.setTimeout(() => {
        if (raf === null) return
        cancelAnimationFrame(raf)
        measure()
      }, 100)
    }
    // First frame: measure synchronously so the store's window-width bootstrap
    // is replaced by the real frame box before paint; observer reports coalesce
    // through the rAF path below.
    measure()
    const observer = new ResizeObserver(apply)
    observer.observe(el)
    const trailing = trailingRef.current
    /* v8 ignore next -- the trailing cluster mounts unconditionally with the frame. */
    if (trailing !== null) observer.observe(trailing)
    window.addEventListener('resize', apply)
    const stopMedia = subscribe(window.matchMedia('(orientation: landscape)'), 'change', apply)
    const stopOrientation = subscribe(window.screen.orientation, 'change', apply)
    const stopVisual = subscribe(window.visualViewport, 'resize', apply)
    return () => {
      disposed = true
      observer.disconnect()
      window.removeEventListener('resize', apply)
      stopMedia()
      stopOrientation()
      stopVisual()
      if (raf !== null) cancelAnimationFrame(raf)
      if (rafFallback !== null) window.clearTimeout(rafFallback)
      if (zeroWidthRetry !== null) window.clearTimeout(zeroWidthRetry)
    }
  }, [actions])

  useLayoutEffect(() => {
    const trailing = trailingRef.current
    /* v8 ignore next -- the trailing cluster mounts unconditionally with the frame. */
    if (trailing === null) return
    const inset = Number.parseFloat(window.getComputedStyle(trailing).marginRight) || 0
    setTrailingWidth(Math.max(0, Math.ceil(trailing.getBoundingClientRect().width + inset)))
  })

  // Narrow viewports auto-collapse the sidebar; the store mirror keeps
  // toggleSidebar's semantics right (narrow toggles flip the manual
  // re-expand override, stores.ts). Collapsed is decided here, so the
  // solver stays breakpoint-free: a narrow re-expand passes the preference
  // (or the default when the wide preference is closed) and the center
  // absorbs the squeeze.
  // Landscape keeps the sidebar in the grid: a phone rotate must not fall
  // into the 56px rail or the overlay drawer.
  const phone = viewport < PHONE_MAX && !landscape
  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE && !landscape
  // Desktop Git actions keep their seat even when the window is narrow.
  // Browser phone drawers retain their separate navigation chrome.
  const compactHeader = viewport < SIDEBAR_AUTO_COLLAPSE
  const desktop = document.documentElement.hasAttribute('data-windows-titlebar')
    || document.documentElement.dataset.platform === 'darwin'
  const clusterVisible = desktop || viewport >= PHONE_MAX
  useEffect(() => { actions.setNarrow(narrow) }, [actions, narrow])
  const sidebarCollapsed = narrow ? !layoutInfo.narrowExpanded : layoutInfo.sidebar === 0
  const sidebarPreference = sidebarCollapsed
    ? 0
    : layoutInfo.sidebar === 0 ? SIDEBAR_DEFAULT : layoutInfo.sidebar
  const rightbarPreference = layoutInfo.rightbar ?? viewport * RIGHTBAR_DEFAULT_RATIO
  // Desktop reopen controls occupy the macOS session header or Windows caption row.
  const collapsedWidth = document.documentElement.dataset.platform === 'darwin'
    || document.documentElement.hasAttribute('data-windows-titlebar') ? 0 : SIDEBAR_COLLAPSED
  // Opening on a narrow frame collapses the left sidebar. Eligibility must
  // include that space before the occupant's first shown report arrives.
  const normal = computeColumns(
    viewport,
    !layoutInfo.rightbarShown && narrow ? 0 : sidebarPreference,
    rightbarPreference,
    0,
    collapsedWidth,
  )
  const cols = computeColumns(
    viewport,
    sidebarPreference,
    layoutInfo.rightbarTrack ? rightbarPreference : 0,
    0,
    collapsedWidth,
  )
  const colsRef = useRef(cols)
  colsRef.current = cols
  const rightbarWidth = useRef(normal.rightbar)
  rightbarWidth.current = normal.rightbar
  const drawerWidth = Math.min(PHONE_DRAWER, Math.max(SIDEBAR_MIN, viewport - 48))
  const sidebarWidth = phone ? (sidebarCollapsed ? 0 : drawerWidth) : cols.sidebar
  const rightbarTracked = layoutInfo.rightbarTrack && cols.rightbar > 0
  const clusterOverConversation = clusterVisible
  const titlebarDensity = resolveTitlebarDensity(
    rightbarTracked ? Math.min(cols.center, cols.rightbar) : cols.center,
    clusterOverConversation,
  )
  const conversationReserve = titlebarConversationReserve(clusterVisible, trailingWidth, cols.rightbar)

  // The drag base is the rendered width captured at drag start (grabbing a
  // concession-clamped panel must not jump back to the stored preference);
  // it stays frozen for the whole gesture so dx deltas do not compound.
  const sidebarBase = useRef(0)
  const rightbarBase = useRef(0)
  // Track-level transitions pause for the whole gesture: eased tracks would
  // detach the column edge from the pointer (AppFrame.module.css).
  const [dragging, setDragging] = useState(false)
  const onDragEnd = useCallback(() => { setDragging(false) }, [])
  const onSidebarStart = useCallback(() => { sidebarBase.current = colsRef.current.sidebar; setDragging(true) }, [])
  const onRightbarStart = useCallback(() => { rightbarBase.current = rightbarWidth.current; setDragging(true) }, [])
  const onSidebarDrag = useCallback((dx: number) => {
    actions.setSidebar(sidebarBase.current + dx)
  }, [actions])
  const onRightbarDrag = useCallback((dx: number) => {
    actions.setRightbar(rightbarBase.current - dx)
  }, [actions])
  const productTitle = process.env.DSH_CLIENT_TITLE ?? t('brand.localBuild')
  const sidebar = useMemo(() => renderSlot('sidebar', {
    collapsed: sidebarCollapsed,
    width: sidebarWidth,
  }), [renderSlot, sidebarCollapsed, sidebarWidth])
  const main = useMemo(() => (
    <MainPanel usePanelInfo={usePanelInfo} renderSlot={renderSlot} />
  ), [usePanelInfo, renderSlot])
  const overlays = useMemo(() => renderSlot('shell.overlay', {}), [renderSlot])

  return (
    <div
      ref={frameRef}
      className={css.frame}
      style={{
        ...(document.documentElement.hasAttribute('data-windows-titlebar')
          ? { '--dsh-windows-sidebar-width': `${cols.sidebar}px` } : {}),
        gridTemplateColumns: phone
          ? `0px minmax(0, 1fr) ${cols.rightbar}px 0px`
          : `${cols.sidebar}px minmax(0, 1fr) ${cols.rightbar}px 0px`,
        gridTemplateRows: `auto minmax(0, 1fr) ${layoutInfo.terminalDrawer}px auto`,
        '--dshd-titlebar-conversation-reserve': `${conversationReserve}px`,
      } as CSSProperties}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-details-collapsed={rightbarTracked ? undefined : true}
      data-rightbar-collapsed={cols.rightbar === 0 || undefined}
      data-rightbar-fullscreen={layoutInfo.rightbarFullscreen || undefined}
      data-rightbar-instant={layoutInfo.rightbarInstant || undefined}
      data-surfaces-collapsed={cols.surfaces === 0 || undefined}
      data-terminal-drawer-collapsed={layoutInfo.terminalDrawer === 0 || undefined}
      data-phone={phone || undefined}
      data-phone-sidebar={phone && !sidebarCollapsed || undefined}
      data-phone-details={phone && layoutInfo.rightbarShown || undefined}
      data-compact-header={compactHeader || undefined}
      data-titlebar-trailing-hidden={!clusterVisible || undefined}
      data-titlebar-density={titlebarDensity}
      data-titlebar-over-conversation={clusterOverConversation || undefined}
      data-dragging={dragging || undefined}
    >
      <DocumentTitle
        productTitle={productTitle}
        useSessions={useSessions}
        usePanelInfo={usePanelInfo}
      />
      <div className={css.captionDrag} data-dshd-caption="band" aria-hidden="true" />
      {phone && sidebarCollapsed && (
        <button
          type="button"
          className={css.phoneMenu}
          aria-label="Open sidebar"
          onClick={() => { actions.toggleSidebar() }}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M2.5 4h11M2.5 8h11M2.5 12h11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      )}
      {phone && !sidebarCollapsed && (
        <button
          type="button"
          className={css.phoneBackdrop}
          aria-label="Close sidebar"
          onClick={() => { actions.toggleSidebar() }}
        />
      )}
      <div className={css.sidebarCol}>
        {/* Render-site slot call with live concession output: a closed
            sidebar keeps the mounted slot at the compact-rail width, and the
            component sees its rendered state as owner params decided here
            (collapsed follows the resolved rail, so a derived auto-collapse
            renders the rail UI too). Phone mode reports width 0 when the
            drawer is closed — there is no rail. */}
        {sidebar}
      </div>
      <>
        {/* Every column occupant stays at a fixed tree position from first
            paint — no loading gate: a bare status line reads worse than
            the shell's own pending rendering. The conversation is the keyed
            main panel; session-maybe seats own their no-session state. */}
        <CenterColumn>{main}</CenterColumn>
        <TerminalDrawerTrack>{renderSlot('shell.terminalDrawer', {})}</TerminalDrawerTrack>
        <RightbarColumn>
          {renderSlot('rightbar', { width: normal.rightbar, viewportWidth: viewport, canShow: normal.rightbar > 0 })}
        </RightbarColumn>
      </>
      <div className={css.bottomRow} data-shell-bottom>
        {renderSlot('shell.bottom', {})}
      </div>
      <div className={css.overlayLayer} data-shell-overlay>
        {overlays}
      </div>
      <div className={css.titlebarBand} data-titlebar-row />
      <div
        ref={trailingRef}
        className={css.titlebarTrailing}
        data-titlebar-trailing
        data-titlebar-trailing-over-surfaces={!rightbarTracked || undefined}
        id="dshd-shell-titlebar-trailing"
      >
        {renderSlot('shell.titlebar.trailing', {
          surfaces: 0,
          rightbarShown: layoutInfo.rightbarShown,
          terminalDrawer: layoutInfo.terminalDrawer,
          managedSession,
          density: titlebarDensity,
        })}
      </div>
      {/* The collapsed rail is fixed-width: no resize handle while closed.
          Phone drawers are overlays — dragging a column edge does not apply.
          The rightbar handle sits on the track's left edge, which stops short
          of the surfaces column when that one is open. */}
      {!phone && !sidebarCollapsed && <DragHandle side="sidebar" left={cols.sidebar} onStart={onSidebarStart} onDrag={onSidebarDrag} onEnd={onDragEnd} />}
      {!phone && layoutInfo.rightbarShown && !layoutInfo.rightbarFullscreen && normal.rightbar > 0 && (
        <DragHandle side="rightbar" left={viewport - normal.rightbar - cols.surfaces} onStart={onRightbarStart} onDrag={onRightbarDrag} onEnd={onDragEnd} />
      )}
    </div>
  )
}
