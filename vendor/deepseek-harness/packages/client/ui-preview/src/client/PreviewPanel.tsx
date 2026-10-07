import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import {
  Button,
  IconChevronLeftOutline14,
  IconChevronRightOutline14,
  IconEllipsisOutline16,
  IconRefreshOutline14,
  IconRightUpOutline16,
  IconStopFill16,
  Input,
  Menu,
  Tooltip,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { UseSessions } from '@deepseek-ai/dsh-client-ui-session/client'
import { DeviceToolbar } from './DeviceToolbar.tsx'
import { NS } from './locales.ts'
import type { DiscoveredServer, PreviewBounds, PreviewColorScheme, PreviewNavState, PreviewShellInjected } from './shell.ts'
import { readPreviewAnnotationTheme } from './annotationTheme.ts'
import { formatPickedAnnotationMarkdown } from './pickMarkdown.ts'
import { startBrowserRecording, stopBrowserRecording } from './browserRecording.ts'
import { normalizePreviewUrl, PreviewUrlNormalizationError } from './url.ts'
import {
  resolveBrowserDeviceViewportLayout,
  resolvePreviewGuestBounds,
  type PreviewViewportSetting,
} from './viewport.ts'
import { DEFAULT_DEVICE_VIEWPORT } from './viewportPresets.ts'
import css from './PreviewPanel.module.css'
import { closeMiniPlayer, clearMiniPlayer, notifyMiniPlayerLayout, openMiniPlayer, readMiniPlayer, setMiniPlayerLabel, setMiniPlayerRuntime, setMiniPlayerSuspended, useMiniPlayer } from './mini-player-state.ts'
import { miniPlayerLabelFromUrl } from './mini-player-label.ts'

/** Must match ui-user-terminal; client packages cannot share a value export. */
const OPEN_SURFACE_EVENT = 'dshd-open-surface'
/** Must match ui-user-terminal; client packages cannot share a value export. */
const PENDING_PREVIEW_URL_KEY = 'dshd-pending-preview-url'
const PENDING_PREVIEW_PRESENTATION_KEY = 'dshd-pending-preview-presentation'
const PENDING_PREVIEW_SESSION_KEY = 'dshd-pending-preview-session'
const DISCOVER_INTERVAL_MS = 3_000

export type PreviewPanelProps =
  & {
    active: boolean
    occluded?: boolean
    useSessions: UseSessions
    /** Seat session id injected by the slot runtime (session-maybe scopes). */
    sessionId?: string | undefined
  }
  & PropsLocale<typeof NS>
  & InjectFace<PreviewShellInjected>

/** Sidebar tab body props, narrowed to the one tab field this adapter needs. */
export interface SidebarPreviewPanelProps extends Omit<PreviewPanelProps, 'active' | 'occluded'> {
  useTabInfo: () => { readonly tab: { readonly visible: boolean } }
}

/** Adapt the native Sidebar tab lifetime to the desktop Browser guest. */
export function SidebarPreviewPanel({ useTabInfo, ...props }: SidebarPreviewPanelProps): ReactNode {
  const { tab } = useTabInfo()
  return <PreviewPanel {...props} active={tab.visible} />
}

/** Sidebar chip title for the desktop Browser extension. */
export function SidebarPreviewTitle({ t }: Pick<PreviewPanelProps, 't'>): ReactNode {
  return t('title')
}

function currentCwd(useSessions: PreviewPanelProps['useSessions']): string | undefined {
  return useSessions((s) => {
    const id = Object.values(s.byId)
      .find(row => (row.retainedBy.mainView ?? 0) > 0)?.id
    if (id === undefined) return undefined
    const next = s.byId[id]?.cwd
    return next ? next : undefined
  })
}

function readBounds(el: HTMLElement | null): PreviewBounds | undefined {
  /* v8 ignore next -- launch and bounds sync run after the host commits. */
  if (el === null) return undefined
  const box = el.getBoundingClientRect()
  return {
    x: Math.round(box.left),
    y: Math.round(box.top),
    width: Math.round(box.width),
    height: Math.round(box.height),
  }
}

function visibleBounds(bounds: PreviewBounds | undefined): PreviewBounds | undefined {
  if (bounds === undefined || bounds.width <= 0 || bounds.height <= 0) return undefined
  return bounds
}

/** Overlay IPC is best-effort; renderer chrome already reflects local state. */
function ignoreOverlayIpcFailure(): void {}

function guestBoundsForHost(
  host: HTMLElement | null,
  deviceToolbar: boolean,
  setting: PreviewViewportSetting,
  zoomFactor: number,
): PreviewBounds | undefined {
  const occupant = visibleBounds(readBounds(host))
  if (occupant === undefined) return undefined
  return resolvePreviewGuestBounds(
    occupant,
    deviceToolbar ? setting : { _tag: 'fill' },
    zoomFactor,
  )
}

function appearanceScheme(id: string): PreviewColorScheme | undefined {
  if (id === 'appearance-system' || id === 'appearance-light' || id === 'appearance-dark') {
    return id.slice('appearance-'.length) as PreviewColorScheme
  }
  return undefined
}

function ChromeButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}): ReactElement {
  return (
    <Tooltip label={label} side="bottom">
      <button
        type="button"
        className={css.icon}
        disabled={disabled}
        aria-label={label}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  )
}

/**
 * Desktop-only http(s) occupant of `surfaces.browser`. The guest paints in
 * a main-process BrowserView over `host`; the renderer never loads Node.
 * Inactive tabs keep the guest alive (`previewHide`); only unmount closes it.
 * Chrome is icon Back/Forward/Reload-or-Stop, an Input that submits on Enter,
 * a system-browser icon, and a More menu (hard reload, DevTools, PiP, device
 * toolbar, pick, record, screenshot, appearance, zoom, cookies, cache).
 * Device toolbar mode insets the guest BrowserView (`previewResize` / `setBounds`)
 * and paints chrome on the leftover `.host` letterbox; it does not use CDP
 * `Emulation.setDeviceMetricsOverride`. More and the portaled device-preset catalog
 * `previewHide` the guest until they close (BrowserView stacks above renderer chrome).
 * Picture-in-picture occupancy is the same hide condition (`overlayOpen || pipOpen`)
 * so closing More cannot `previewShow` the in-panel view under the PiP window.
 * @param props - session-maybe seats, preview IPC, guest visibility flags, and copy.
 * @returns the browser surface.
 */
export function PreviewPanel({
  active,
  occluded,
  previewAvailable,
  previewOpen,
  previewNavigate,
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
  previewStartRecording,
  previewStopRecording,
  onPreviewRecordingFrame,
  previewSaveRecording,
  appendComposerText,
  // oxlint-disable-next-line typescript/no-useless-default-assignment -- browser-only callers may omit the optional shell callback.
  onPreviewStateChange = () => () => {},
  previewOpenDevTools,
  previewDiscover,
  openExternal,
  previewResize,
  previewHide,
  previewShow,
  previewClose,
  useSessions,
  sessionId: seatSessionId,
  t,
}: PreviewPanelProps): ReactNode {
  const hostRef = useRef<HTMLDivElement>(null)
  const cwd = currentCwd(useSessions)
  const mainViewSessionId = useSessions(s => Object.values(s.byId)
    .find(row => (row.retainedBy.mainView ?? 0) > 0)?.id)
  // The seat's own session owns this panel's events; a detached (non-seat)
  // mount falls back to the main view it visually belongs to.
  const sessionId = seatSessionId ?? mainViewSessionId
  const [url, setUrl] = useState('')
  const [draft, setDraft] = useState('')
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [loading, setLoading] = useState(false)
  const [unreachable, setUnreachable] = useState(false)
  const [zoomFactor, setZoomFactor] = useState(1)
  const [colorScheme, setColorScheme] = useState<PreviewColorScheme>('system')
  const [pipOpen, setPipOpen] = useState(false)
  const [deviceToolbar, setDeviceToolbar] = useState(false)
  const [viewportSetting, setViewportSetting] = useState<PreviewViewportSetting>({ _tag: 'fill' })
  const [aspectRatio, setAspectRatio] = useState<number | null>(null)
  const [hostSize, setHostSize] = useState<{ width: number; height: number } | null>(null)
  const [recording, setRecording] = useState(false)
  const [servers, setServers] = useState<DiscoveredServer[]>([])
  const [moreOpen, setMoreOpen] = useState(false)
  const [presetMenuOpen, setPresetMenuOpen] = useState(false)
  const miniPlayer = useMiniPlayer()
  const overlayOpen = moreOpen || presetMenuOpen
  /**
   * Whether the chat float owned the native guest. Dropping the float's React
   * node does not unpaint the `BrowserView`, so when the float closes and this
   * panel has no usable host (collapsed column) the guest must be hidden
   * explicitly or it stays painted over the chat at the float's bounds.
   */
  const floatOwnedGuestRef = useRef(false)
  const focusedRef = useRef(false)
  const deviceToolbarRef = useRef(deviceToolbar)
  deviceToolbarRef.current = deviceToolbar
  const viewportSettingRef = useRef(viewportSetting)
  viewportSettingRef.current = viewportSetting
  const zoomFactorRef = useRef(zoomFactor)
  zoomFactorRef.current = zoomFactor

  const rememberHostSize = (occupant: PreviewBounds): void => {
    setHostSize(prev => {
      if (prev !== null && prev.width === occupant.width && prev.height === occupant.height) return prev
      return { width: occupant.width, height: occupant.height }
    })
  }

  useEffect(() => {
    if (!previewAvailable) return
    let cancelled = false
    const load = (): void => {
      void previewDiscover().then((found) => {
        /* v8 ignore next -- unmount sets cancelled before a late discover resolves. */
        if (cancelled) return
        setServers(found)
      }).catch(() => {
        /* v8 ignore next -- unmount sets cancelled before a late discover rejects. */
        if (cancelled) return
        setServers([])
      })
    }
    load()
    const timer = window.setInterval(load, DISCOVER_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [previewAvailable, previewDiscover])

  useEffect(() => {
    if (previewId === null) return
    if (miniPlayer.open) {
      // The float paints this guest at its own bounds. Remember it so the next
      // run — the float closing — can reclaim or release the same view.
      if (miniPlayer.previewId === previewId) floatOwnedGuestRef.current = true
      return
    }
    if (!active || occluded || overlayOpen || pipOpen) {
      floatOwnedGuestRef.current = false
      void previewHide(previewId).catch(ignoreOverlayIpcFailure)
      return
    }
    // A float that just closed leaves the native view painted at its last
    // bounds; this panel is now its only owner. Claim it once so the sync
    // below either re-shows it here or hides it when no host can present it.
    let visible = false
    let reclaimFloatGuest = floatOwnedGuestRef.current
    floatOwnedGuestRef.current = false
    const sync = (): void => {
      const occupant = visibleBounds(readBounds(hostRef.current))
      if (occupant === undefined) {
        if (visible || reclaimFloatGuest) {
          visible = false
          reclaimFloatGuest = false
          void previewHide(previewId).catch(ignoreOverlayIpcFailure)
        }
        return
      }
      rememberHostSize(occupant)
      const bounds = resolvePreviewGuestBounds(
        occupant,
        deviceToolbarRef.current ? viewportSettingRef.current : { _tag: 'fill' },
        zoomFactorRef.current,
      )
      if (!visible || reclaimFloatGuest) {
        visible = true
        reclaimFloatGuest = false
        void previewShow(previewId, bounds).catch(ignoreOverlayIpcFailure)
        return
      }
      void previewResize(previewId, bounds).catch(ignoreOverlayIpcFailure)
    }
    sync()
    const host = hostRef.current
    let observer: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(sync)
      /* v8 ignore next -- the host node is committed before previewId is set. */
      if (host !== null) observer.observe(host)
    }
    // Opening the dock slides an ancestor without resizing this host. The
    // native guest must also receive the host's final window coordinates.
    const onTransition = (event: TransitionEvent): void => {
      if (host !== null && event.target instanceof Element && event.target.contains(host)) sync()
    }
    window.addEventListener('transitionend', onTransition, true)
    window.addEventListener('transitioncancel', onTransition, true)
    window.addEventListener('resize', sync)
    return () => {
      observer?.disconnect()
      window.removeEventListener('transitionend', onTransition, true)
      window.removeEventListener('transitioncancel', onTransition, true)
      window.removeEventListener('resize', sync)
      const current = readMiniPlayer()
      if (!current.open || current.previewId !== previewId) {
        floatOwnedGuestRef.current = false
        void previewHide(previewId).catch(ignoreOverlayIpcFailure)
      }
    }
  }, [previewId, active, occluded, overlayOpen, pipOpen, miniPlayer.open, previewHide, previewResize, previewShow])

  useEffect(() => {
    if (previewId === null || !active || occluded || overlayOpen || pipOpen || miniPlayer.open) return
    const bounds = guestBoundsForHost(
      hostRef.current,
      deviceToolbar,
      viewportSetting,
      zoomFactor,
    )
    if (bounds === undefined) return
    void previewResize(previewId, bounds).catch(ignoreOverlayIpcFailure)
  }, [deviceToolbar, viewportSetting, zoomFactor, previewId, active, occluded, overlayOpen, pipOpen, miniPlayer.open, previewResize])

  useEffect(() => {
    setMiniPlayerSuspended(occluded || overlayOpen || pipOpen)
    if (miniPlayer.open) notifyMiniPlayerLayout()
  }, [occluded, overlayOpen, pipOpen, miniPlayer.open])

  useEffect(() => {
    if (previewId === null) {
      clearMiniPlayer()
      return
    }
    setMiniPlayerRuntime(previewId, {
      previewShow,
      previewResize,
      previewHide,
      restore: () => {
        window.dispatchEvent(new CustomEvent(OPEN_SURFACE_EVENT, { detail: { kind: 'preview' } }))
      },
    })
    return () => { clearMiniPlayer(previewId) }
  }, [previewId, previewShow, previewResize, previewHide])

  useEffect(() => () => {
    if (previewId !== null) {
      clearMiniPlayer(previewId)
      void previewClose(previewId).catch(ignoreOverlayIpcFailure)
    }
  }, [previewId, previewClose])

  const applyNav = (result: PreviewNavState): void => {
    if (!result.ok) {
      setMessage(result.message ?? t('rejected'))
      return
    }
    setMessage(null)
    if (result.id !== undefined) setPreviewId(result.id)
    if (result.url !== undefined) {
      setUrl(result.url)
      const current = readMiniPlayer()
      if (current.open && current.previewId !== null) setMiniPlayerLabel(current.previewId, miniPlayerLabelFromUrl(result.url))
      if (!focusedRef.current) setDraft(result.url)
    }
    setCanGoBack(result.canGoBack === true)
    setCanGoForward(result.canGoForward === true)
    setLoading(result.loading === true)
    setUnreachable(result.unreachable === true)
    if (typeof result.zoomFactor === 'number') setZoomFactor(result.zoomFactor)
    if (typeof result.pictureInPicture === 'boolean') setPipOpen(result.pictureInPicture)
  }

  const applyNavRef = useRef(applyNav)
  applyNavRef.current = applyNav
  const previewIdRef = useRef(previewId)
  previewIdRef.current = previewId

  useEffect(() => {
    return onPreviewStateChange((state) => {
      if (previewIdRef.current !== null && state.id === previewIdRef.current) {
        applyNavRef.current(state)
      }
    })
  }, [onPreviewStateChange])

  const launch = (next: string, presentation?: 'mini'): void => {
    let trimmed: string
    try {
      trimmed = normalizePreviewUrl(next)
    } catch (error) {
      if (error instanceof PreviewUrlNormalizationError && error.reason === 'empty') return
      setMessage(t('rejected'))
      return
    }
    const bounds = guestBoundsForHost(
      hostRef.current,
      deviceToolbarRef.current,
      viewportSettingRef.current,
      zoomFactorRef.current,
    )
    const currentId = previewIdRef.current
    const opened = currentId === null
      ? previewOpen(bounds === undefined
        ? { url: trimmed, scope: cwd ?? 'shared' }
        : { url: trimmed, bounds, scope: cwd ?? 'shared' })
      : previewNavigate(currentId, trimmed)
    void opened.then((result) => {
      applyNavRef.current(result)
      if (result.ok && presentation === 'mini') {
        const id = result.id ?? currentId
        if (id !== null && id !== undefined) openMiniPlayer(id, miniPlayerLabelFromUrl(trimmed))
      }
    }).catch(() => { setMessage(t('rejected')) })
  }

  useEffect(() => {
    try {
      const pendingSession = sessionStorage.getItem(PENDING_PREVIEW_SESSION_KEY)
      // A pending preview tagged for another session belongs to that seat.
      const pending = pendingSession !== null && pendingSession !== sessionId
        ? null
        : sessionStorage.getItem(PENDING_PREVIEW_URL_KEY)
      if (pending !== null && pending.length > 0) {
        const presentation = sessionStorage.getItem(PENDING_PREVIEW_PRESENTATION_KEY) === 'mini' ? 'mini' : undefined
        sessionStorage.removeItem(PENDING_PREVIEW_URL_KEY)
        sessionStorage.removeItem(PENDING_PREVIEW_PRESENTATION_KEY)
        sessionStorage.removeItem(PENDING_PREVIEW_SESSION_KEY)
        launch(pending, presentation)
      }
    } catch {
      // sessionStorage can throw in a locked browser profile.
    }
    const onOpen = (event: Event): void => {
      const detail = (event as CustomEvent<{ url?: string; presentation?: 'mini'; sessionId?: string } | undefined>).detail
      // A preview tagged for another session is for that seat's surfaces.
      if (detail?.sessionId !== undefined && detail.sessionId !== sessionId) return
      const next = detail?.url
      if (typeof next !== 'string' || next.length === 0) return
      try {
        sessionStorage.removeItem(PENDING_PREVIEW_URL_KEY)
        sessionStorage.removeItem(PENDING_PREVIEW_PRESENTATION_KEY)
        sessionStorage.removeItem(PENDING_PREVIEW_SESSION_KEY)
      } catch {
        // sessionStorage can throw in a locked browser profile.
      }
      launch(next, detail?.presentation)
    }
    window.addEventListener(OPEN_SURFACE_EVENT, onOpen)
    return () => { window.removeEventListener(OPEN_SURFACE_EVENT, onOpen) }
  }, [previewOpen, previewNavigate, cwd, sessionId, t])

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    launch(draft)
  }

  const onUrlKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    setDraft(url)
    event.currentTarget.blur()
  }

  let barUrl = ''
  try {
    barUrl = normalizePreviewUrl(draft)
  } catch {
    // Empty or invalid draft: disable Open in system browser.
    barUrl = ''
  }

  const noGuest = previewId === null
  const moreItems: MenuEntry[] = [
    { id: 'hardReload', label: t('hardReload'), disabled: noGuest },
    { id: 'devtools', label: t('devtools'), disabled: noGuest },
    { id: 'pip', label: pipOpen ? t('pipClose') : t('pipOpen'), disabled: noGuest },
    { id: 'deviceToolbar', label: deviceToolbar ? t('deviceToolbarHide') : t('deviceToolbarShow'), disabled: noGuest },
    { id: 'pick', label: t('pick'), disabled: noGuest },
    { id: 'record', label: recording ? t('recordStop') : t('recordStart'), disabled: noGuest },
    { id: 'screenshot', label: t('screenshot'), disabled: noGuest },
    {
      id: 'appearance',
      label: t('appearance'),
      disabled: noGuest,
      submenu: [
        { id: 'appearance-system', label: t('appearanceSystem'), disabled: noGuest },
        { id: 'appearance-light', label: t('appearanceLight'), disabled: noGuest },
        { id: 'appearance-dark', label: t('appearanceDark'), disabled: noGuest },
      ],
    },
    { type: 'separator', id: 'zoom-sep' },
    { id: 'zoom-out', label: t('zoomOut'), disabled: noGuest },
    { type: 'label', id: 'zoom-percent', text: `${Math.round(zoomFactor * 100)}%` },
    { id: 'zoom-in', label: t('zoomIn'), disabled: noGuest },
    { id: 'zoom-reset', label: t('zoomReset'), disabled: noGuest },
    { type: 'separator', id: 'storage-sep' },
    { id: 'clearCookies', label: t('clearCookies') },
    { id: 'clearCache', label: t('clearCache') },
  ]

  const onMoreSelect = (id: string): void => {
    setMoreOpen(false)
    if (id === 'clearCookies') {
      void previewClearCookies()
      return
    }
    if (id === 'clearCache') {
      void previewClearCache()
      return
    }
    /* v8 ignore next -- More disables guest actions while no preview is open. */
    if (previewId === null) return
    if (id === 'hardReload') {
      void previewHardReload(previewId).then(applyNav)
      return
    }
    if (id === 'devtools') {
      void previewOpenDevTools(previewId)
      return
    }
    if (id === 'pip') {
      if (pipOpen) {
        void previewClosePictureInPicture().then((result) => {
          if (result.ok) setPipOpen(false)
        })
      } else {
        setPipOpen(true)
        void previewOpenPictureInPicture(previewId).then((result) => {
          if (!result.ok) setPipOpen(false)
        })
      }
      return
    }
    if (id === 'deviceToolbar') {
      if (deviceToolbar) {
        setDeviceToolbar(false)
        setViewportSetting({ _tag: 'fill' })
        setAspectRatio(null)
        setPresetMenuOpen(false)
      } else {
        setDeviceToolbar(true)
        setViewportSetting(DEFAULT_DEVICE_VIEWPORT)
        setAspectRatio(null)
      }
      return
    }
    if (id === 'pick') {
      const theme = readPreviewAnnotationTheme()
      void previewSetAnnotationTheme?.(previewId, theme)
      void previewPickElement(previewId).then((result) => {
        if (!result.ok) return
        const markdown = formatPickedAnnotationMarkdown(result)
        if (appendComposerText !== undefined && sessionId !== undefined) {
          const wrote = appendComposerText(sessionId, markdown)
          if (wrote !== false) return
        }
        const selector = result.annotation?.elements?.[0]?.element?.selector
        setMessage(selector !== undefined && selector.length > 0 ? selector : markdown)
      })
      return
    }
    if (id === 'record') {
      const bridge = {
        previewStartRecording,
        previewStopRecording,
        onPreviewRecordingFrame,
        previewSaveRecording,
      }
      void (recording ? stopBrowserRecording(previewId) : startBrowserRecording(previewId, bridge))
        .then((result) => { if (result.ok) setRecording(on => !on) })
        .catch(() => {})
      return
    }
    if (id === 'screenshot') {
      void previewCaptureScreenshot(previewId).then((result) => {
        if (!result.ok) {
          setMessage(result.message ?? t('rejected'))
          return
        }
        /* v8 ignore next -- persist always returns path on ok. */
        if (typeof result.path !== 'string') return
        void previewRevealArtifact(result.path)
      })
      return
    }
    const scheme = appearanceScheme(id)
    if (scheme !== undefined) {
      void previewSetColorScheme(previewId, scheme).then((result) => {
        applyNav(result)
        if (result.ok) setColorScheme(scheme)
      })
      return
    }
    if (id === 'zoom-out') {
      void previewZoomOut(previewId).then(applyNav)
      return
    }
    if (id === 'zoom-in') {
      void previewZoomIn(previewId).then(applyNav)
      return
    }
    void previewResetZoom(previewId).then(applyNav)
  }

  return (
    <div className={css.root} data-preview-panel>
      {!previewAvailable ? (
        <p className={css.message} data-preview-unavailable>{t('unavailable')}</p>
      ) : (
        <>
          <form className={css.toolbar} data-preview-toolbar onSubmit={submit}>
            <div className={css.nav} role="group" aria-label={t('navigation')}>
              <ChromeButton
                label={t('back')}
                disabled={previewId === null || !canGoBack}
                onClick={() => {
                  /* v8 ignore next -- the control is disabled while no guest is open or cannot go back. */
                  if (previewId !== null) void previewBack(previewId).then(applyNav)
                }}
              >
                <IconChevronLeftOutline14 size={14} />
              </ChromeButton>
              <ChromeButton
                label={t('forward')}
                disabled={previewId === null || !canGoForward}
                onClick={() => {
                  /* v8 ignore next -- the control is disabled while no guest is open or cannot go forward. */
                  if (previewId !== null) void previewForward(previewId).then(applyNav)
                }}
              >
                <IconChevronRightOutline14 size={14} />
              </ChromeButton>
              <ChromeButton
                label={loading ? t('stop') : t('reload')}
                disabled={previewId === null}
                onClick={() => {
                  /* v8 ignore next -- the control is disabled while no guest is open. */
                  if (previewId === null) return
                  void (loading ? previewStop(previewId) : previewReload(previewId)).then(applyNav)
                }}
              >
                {loading
                  ? <IconStopFill16 size={14} />
                  : <IconRefreshOutline14 size={14} />}
              </ChromeButton>
            </div>
            <Input
              className={css.url}
              value={draft}
              placeholder={t('placeholder')}
              aria-label={t('title')}
              spellCheck={false}
              data-preview-url-input
              onChange={(event) => { setDraft(event.target.value) }}
              onFocus={(event) => {
                focusedRef.current = true
                const node = event.currentTarget
                queueMicrotask(() => { node.select() })
              }}
              onBlur={() => { focusedRef.current = false }}
              onKeyDown={onUrlKeyDown}
            />
            <ChromeButton
              label={t('external')}
              disabled={barUrl.length === 0}
              onClick={() => { void openExternal(barUrl) }}
            >
              <IconRightUpOutline16 size={14} />
            </ChromeButton>
            <ChromeButton
              label={miniPlayer.open ? t('miniRestore') : t('miniOpen')}
              disabled={previewId === null}
              onClick={() => {
                if (previewId === null) return
                if (miniPlayer.open) closeMiniPlayer()
                else openMiniPlayer(previewId, miniPlayerLabelFromUrl(url))
              }}
            >
              <IconRightUpOutline16 size={14} />
            </ChromeButton>
            <Menu
              compact
              portal
              align="end"
              open={moreOpen}
              items={moreItems}
              selectedIds={[`appearance-${colorScheme}`]}
              onSelect={onMoreSelect}
              onClose={() => { setMoreOpen(false) }}
              anchor={(
                <Tooltip label={t('more')} side="bottom">
                  <button
                    type="button"
                    className={css.icon}
                    aria-label={t('more')}
                    aria-expanded={moreOpen}
                    onClick={() => { setMoreOpen(open => !open) }}
                  >
                    <IconEllipsisOutline16 size={14} />
                  </button>
                </Tooltip>
              )}
            />
          </form>
          {unreachable ? (
            <p className={css.unreachable} data-preview-unreachable>{t('unreachable')}</p>
          ) : null}
          {message !== null || previewId === null ? (
            <p className={css.message}>{message ?? t('empty')}</p>
          ) : null}
          {servers.length > 0 ? (
            <div className={css.discovered}>
              <p className={css.discoveredTitle}>{t('discovered')}</p>
              {servers.map(server => (
                <Button
                  key={server.url}
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDraft(server.url)
                    launch(server.url)
                  }}
                >
                  {server.url}
                </Button>
              ))}
            </div>
          ) : null}
          <div ref={hostRef} className={css.host} data-preview-host>
            {deviceToolbar && viewportSetting._tag !== 'fill' && hostSize !== null ? (
              <DeviceToolbar
                setting={viewportSetting}
                layout={resolveBrowserDeviceViewportLayout(hostSize, viewportSetting, zoomFactor)}
                zoomFactor={zoomFactor}
                aspectRatio={aspectRatio}
                t={t}
                onAspectRatioChange={setAspectRatio}
                onChange={setViewportSetting}
                onPresetOpenChange={setPresetMenuOpen}
              />
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
