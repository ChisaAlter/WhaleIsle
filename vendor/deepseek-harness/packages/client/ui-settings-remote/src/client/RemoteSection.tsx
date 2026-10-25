import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, FLIP_TEXT_MS, IconChevronRightOutline14, StateDot, Toast, useModalLayer, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { RemotePatch, RemoteSnapshot } from './desktop-shell.ts'
import { humanizeRelayError, humanizeRemoteError } from './relay-copy.ts'
import { qrSvg } from './qr.ts'
import css from './RemoteSection.module.css'

/** Registration-side desktop callbacks used by the Remote popup. */
export interface RemoteSectionInjected {
  /** Read the current gateway snapshot. */
  getRemote: () => Promise<RemoteSnapshot | null>
  /** Persist a remote config patch and return the new snapshot. */
  saveRemote: (patch: RemotePatch) => Promise<RemoteSnapshot | null>
  /** Re-mint the short-lived pairing offer; sticky devices stay bound. */
  rotateRemoteToken: () => Promise<RemoteSnapshot | null>
  /** Drop one bound device; its cookie stops authorizing. */
  unbindRemoteDevice: (id: string) => Promise<RemoteSnapshot | null>
  /** Overwrite one bound device's display name. */
  renameRemoteDevice: (id: string, name: string) => Promise<RemoteSnapshot | null>
}

/** Full component props assembled by the sidebar footer-action slot. */
export type RemoteSectionProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'settings.remote'>
  & InjectFace<RemoteSectionInjected>
  & { menuMode?: boolean; onClose?: () => void }

/** Account-menu action mounts the same pairing popup without a sidebar row. */
export type RemoteMenuActionProps = PropsRuntime<'settings.launcher.action'>
  & PropsLocale<'settings.remote'> & InjectFace<RemoteSectionInjected>

/** Render the existing Remote popup for a selected account-menu action. */
export function RemoteMenuAction({ close, ...props }: RemoteMenuActionProps): ReactNode {
  return <RemoteSection {...props} wide menuMode onClose={close} />
}

const REFRESH_MS = 2000
type RemoteAction = { kind: 'load' | 'enable' | 'disable' | 'rotate' | 'rename' | 'unbind'; id?: string }
type Notice = { id: number; text: string }

function remoteErrorText(error: string, t: RemoteSectionProps['t']): string {
  const kind = humanizeRemoteError(error)
  return kind === 'portInUse' ? t('errorPortInUse') : kind === 'bindGone' ? t('errorBindGone') : t('statusErrorGeneric')
}

function PhoneIcon({ size }: { size: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="4" y="1.4" width="8" height="13.2" rx="1.8" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="12.1" r="0.75" fill="currentColor" />
    </svg>
  )
}

function formatStamp(value: string, unknown: string): string {
  const stamp = Date.parse(value)
  if (!Number.isFinite(stamp)) return unknown
  return new Date(stamp).toLocaleString()
}

/**
 * Sidebar-foot Remote control: turn on, scan the QR, manage devices.
 * Connection mode and gateway knobs live under Settings → Remote → Gateway.
 * @param props - composed slot props plus the desktop inject face.
 * @returns the trigger and optional popup.
 */
export function RemoteSection({
  wide,
  t,
  getRemote,
  saveRemote,
  rotateRemoteToken,
  unbindRemoteDevice,
  renameRemoteDevice,
  menuMode = false,
  onClose,
}: RemoteSectionProps): ReactNode {
  const [snap, setSnap] = useState<RemoteSnapshot | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<RemoteAction | null>(null)
  const requestRef = useRef<{ action: RemoteAction | null; version: number; reading: boolean }>({ action: null, version: 0, reading: false })
  const [open, setOpen] = useState(menuMode)
  const [devicesOpen, setDevicesOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copying, setCopying] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [healFired, setHealFired] = useState(false)
  const healAttemptedRef = useRef(false)
  const noticeId = useRef(0)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [statusNotice, setStatusNotice] = useState<string | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)
  const popupOwnerRef = useRef<HTMLSpanElement | null>(null)
  const devicesRef = useRef<HTMLDivElement | null>(null)
  const devicesOwnerRef = useRef<HTMLSpanElement | null>(null)
  const busy = pending !== null
  const closePopup = useCallback((): void => { setOpen(false); onClose?.() }, [onClose])
  const closeDevices = useCallback((): void => { setDevicesOpen(false) }, [])
  useModalLayer(popupRef, open, closePopup, popupOwnerRef)
  useModalLayer(devicesRef, open && devicesOpen, closeDevices, devicesOwnerRef)

  const showNotice = useCallback((text: string) => {
    noticeId.current += 1
    setNotice({ id: noticeId.current, text })
  }, [])

  const applySnap = useCallback((next: RemoteSnapshot | null) => {
    if (next === null || next.available === false) {
      setSnap(null)
      setError(t('error'))
      return false
    }
    if (next.starting) {
      healAttemptedRef.current = true
      setHealFired(true)
    }
    setSnap(next)
    setError('')
    return true
  }, [t])

  const beginAction = useCallback((action: RemoteAction) => {
    if (requestRef.current.action !== null) return false
    requestRef.current.action = action
    requestRef.current.version += 1
    requestRef.current.reading = false
    setPending(action)
    setError('')
    return true
  }, [])

  const finishAction = useCallback((action: RemoteAction) => {
    if (requestRef.current.action !== action) return
    requestRef.current.action = null
    setPending(null)
  }, [])

  const load = useCallback(async () => {
    const action: RemoteAction = { kind: 'load' }
    if (!beginAction(action)) return
    try {
      applySnap(await getRemote())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      finishAction(action)
    }
  }, [applySnap, beginAction, finishAction, getRemote])

  const refresh = useCallback(async () => {
    if (requestRef.current.action !== null || requestRef.current.reading) return
    const version = ++requestRef.current.version
    requestRef.current.reading = true
    try {
      const next = await getRemote()
      if (version === requestRef.current.version) applySnap(next)
    } catch (caught) {
      if (version === requestRef.current.version) setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      if (version === requestRef.current.version) requestRef.current.reading = false
    }
  }, [applySnap, getRemote])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!open) {
      setDevicesOpen(false)
      healAttemptedRef.current = false
      setHealFired(false)
      setCopied(false)
      setRenamingId(null)
      setNotice(null)
      setStatusNotice(null)
      return
    }
    void refresh()
    const id = window.setInterval(() => { void refresh() }, REFRESH_MS)
    return () => { window.clearInterval(id) }
  }, [open, refresh])

  const save = useCallback(async (patch: RemotePatch) => {
    const action: RemoteAction = { kind: patch.remoteEnabled ? 'enable' : 'disable' }
    if (!beginAction(action)) return
    if (patch.remoteEnabled) {
      healAttemptedRef.current = true
      setHealFired(true)
    }
    setNotice(null)
    try {
      if (!applySnap(await saveRemote(patch))) showNotice(t('error'))
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      setError(message)
      showNotice(remoteErrorText(message, t))
    } finally {
      finishAction(action)
    }
  }, [applySnap, beginAction, finishAction, saveRemote, showNotice, t])

  const rotate = useCallback(async () => {
    const action: RemoteAction = { kind: 'rotate' }
    if (!beginAction(action)) return
    setNotice(null)
    try {
      if (!applySnap(await rotateRemoteToken())) showNotice(t('error'))
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      setError(message)
      showNotice(remoteErrorText(message, t))
    } finally {
      finishAction(action)
    }
  }, [applySnap, beginAction, finishAction, rotateRemoteToken, showNotice, t])

  const unbind = useCallback(async (id: string) => {
    const action: RemoteAction = { kind: 'unbind', id }
    if (!beginAction(action)) return
    setNotice(null)
    try {
      if (!applySnap(await unbindRemoteDevice(id))) showNotice(t('error'))
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      setError(message)
      showNotice(remoteErrorText(message, t))
    } finally {
      finishAction(action)
    }
  }, [applySnap, beginAction, finishAction, unbindRemoteDevice, showNotice, t])

  const rename = useCallback(async (id: string, name: string) => {
    if (!name.trim()) return
    const action: RemoteAction = { kind: 'rename', id }
    if (!beginAction(action)) return
    setNotice(null)
    try {
      if (applySnap(await renameRemoteDevice(id, name))) setRenamingId(null)
      else showNotice(t('error'))
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      setError(message)
      showNotice(remoteErrorText(message, t))
    } finally {
      finishAction(action)
    }
  }, [applySnap, beginAction, finishAction, renameRemoteDevice, showNotice, t])

  const pairingUrl = snap?.urls?.[0]?.pairingUrl || ''
  const qr = useMemo(() => qrSvg(pairingUrl), [pairingUrl])
  const enabling = pending?.kind === 'enable'
  const daemonStarting = Boolean(snap?.starting)
  const enabled = Boolean(snap?.enabled) || enabling || daemonStarting
  const listening = Boolean(snap?.listening)
  const devices = snap?.devices ?? []
  const relayConnected = Boolean(snap?.relayConnected)
  const relayError = typeof snap?.relayError === 'string' ? snap.relayError : ''
  const healEligible = open && Boolean(snap?.enabled) && !busy && !daemonStarting
    && !error && !relayError && !healFired && (!listening || !pairingUrl)
  const startupPending = enabling || daemonStarting || healEligible
  const snapshotError = snap?.error || ''
  const qrLoadingText = error ? null
    : startupPending ? t(listening && !enabling && !daemonStarting ? 'mintingHint' : 'startingHint')
      : enabled && listening && !snapshotError && !relayConnected && !relayError ? t('relayConnectingHint') : null
  const pairingReady = enabled && !qrLoadingText && !error && !snapshotError && listening && relayConnected && Boolean(qr)

  useEffect(() => {
    if (!healEligible || healAttemptedRef.current) return
    void save({ remoteEnabled: true })
  }, [healEligible, save])

  let statusText: string | null = null
  if (!snap) {
    statusText = error ? t('error') : null
  } else if (error) {
    statusText = remoteErrorText(error, t)
  } else if (!startupPending) {
    if (snapshotError) statusText = remoteErrorText(snapshotError, t)
    else if (enabled && !listening) statusText = t('notListening')
    else if (enabled && !relayConnected && relayError) {
      const relayKind = humanizeRelayError(relayError)
      if (relayKind === 'disconnected') statusText = t('relayDownDisconnected')
      else if (relayKind === 'unavailable') statusText = t('relayUnavailable')
      else statusText = t('relayDown')
    } else if (enabled && relayConnected && !qr) statusText = t('noQr')
  }
  const visibleStatusNotice = statusNotice === statusText ? statusNotice : null

  useEffect(() => {
    setStatusNotice(open ? statusText : null)
  }, [open, statusText])

  return (
    <div className={wide ? css.layer : `${css.layer} ${css.rail}`}>
      <span ref={popupOwnerRef} hidden data-dsh-modal-owner="" />
      <span ref={devicesOwnerRef} hidden data-dsh-modal-owner="" />
      {open && (notice || visibleStatusNotice) ? (
        <Toast key={notice ? `notice-${String(notice.id)}` : `status-${visibleStatusNotice}`}
          text={notice?.text ?? visibleStatusNotice ?? ''} holdMs={null} dismissLabel={t('dismiss')}
          onDone={() => { setNotice(null); setStatusNotice(null) }} />
      ) : null}
      {!menuMode && <button
        type="button"
        className={css.trigger}
        data-dsh-remote-trigger=""
        data-on={enabled || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('trigger')}
        onClick={() => { setOpen(value => !value) }}
      >
        <PhoneIcon size={wide ? 16 : 18} />
        {wide && <span className={css.triggerLabel}>{t('trigger')}</span>}
      </button>}
      {open ? (
        <div className={css.overlay} role="presentation">
          <div className={css.mask} aria-hidden="true" onClick={closePopup} />
          <div
            ref={popupRef}
            className={css.panel}
            role="dialog"
            aria-modal="true"
            aria-label={t('heading')}
            tabIndex={-1}
            data-dsh-remote-panel=""
          >
            <h2 className={css.heading} data-dsh-modal-header="">{t('heading')}</h2>
            {!snap ? (
              <Button size="sm" className={css.retry} disabled={busy} loading={pending?.kind === 'load'} onClick={() => { void load() }}>{t('retry')}</Button>
            ) : (
              <>
                <div className={css.modes} role="radiogroup" aria-label={t('enable')}>
                  <Button
                    size="sm"
                    variant={enabled ? 'primary' : 'ghost'}
                    className={css.modeButton}
                    role="radio"
                    aria-checked={enabled}
                    disabled={busy}
                    loading={enabling || (daemonStarting && !error)}
                    onClick={() => {
                      if (!pairingReady) void save({ remoteEnabled: true })
                    }}
                  >
                    {t('enabledOn')}
                  </Button>
                  <Button
                    size="sm"
                    variant={enabled ? 'ghost' : 'primary'}
                    className={css.modeButton}
                    role="radio"
                    aria-checked={!enabled}
                    disabled={busy}
                    loading={pending?.kind === 'disable'}
                    onClick={() => { if (enabled) void save({ remoteEnabled: false }) }}
                  >
                    {t('enabledOff')}
                  </Button>
                </div>
                <button
                  type="button"
                  className={css.devices}
                  onClick={() => { setDevicesOpen(true) }}
                >
                  <span>{t('devices')} {devices.length}</span>
                  <span className={css.devicesChevron} aria-hidden="true">
                    <IconChevronRightOutline14 />
                  </span>
                </button>
                {qrLoadingText ? (
                  <div
                    className={`${css.qr} ${css.qrLoading}`}
                    role="status"
                    aria-live="polite"
                    aria-busy="true"
                    aria-label={qrLoadingText}
                    data-dsh-remote-qr-loading=""
                  >
                    <StateDot state="ongoing" size={24} />
                    <span className={css.hint}>{qrLoadingText}</span>
                  </div>
                ) : pairingReady ? (
                  <>
                    <div
                      className={css.qr}
                      role="img"
                      aria-label={t('qr')}
                      data-dsh-remote-qr=""
                      dangerouslySetInnerHTML={{ __html: qr }}
                    />
                    <div className={css.footer} data-dsh-modal-footer="">
                      <Button
                        size="sm"
                        variant="ghost"
                        className={css.footerButton}
                        data-dsh-remote-copy-link=""
                        loading={copying}
                        {...copied ? { feedback: t('copiedLink') } : {}}
                        onClick={() => {
                          if (copying) return
                          setCopying(true)
                          void writeClipboard(pairingUrl).then((ok) => {
                            if (!ok) { showNotice(t('copyFailed')); return }
                            setCopied(true)
                            window.setTimeout(() => { setCopied(false) }, FLIP_TEXT_MS)
                          }).finally(() => { setCopying(false) })
                        }}
                      >
                        {t('copyLink')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className={css.footerButton}
                        data-dsh-remote-rotate=""
                        disabled={busy}
                        loading={pending?.kind === 'rotate'}
                        onClick={() => { void rotate() }}
                      >
                        {t('rotateToken')}
                      </Button>
                    </div>
                  </>
                ) : !enabled ? (
                  <p className={css.hint}>{t('offHint')}</p>
                ) : null}
              </>
            )}
          </div>
          {devicesOpen ? (
            <div className={css.deviceLayer} role="presentation">
              <div className={css.mask} aria-hidden="true" onClick={closeDevices} />
              <div ref={devicesRef} className={css.devicePanel} role="dialog" aria-modal="true" aria-label={t('devicesManage')} tabIndex={-1}>
                <h2 className={css.heading} data-dsh-modal-header="">{t('devicesManage')}</h2>
                {devices.length === 0 ? (
                  <p className={css.hint}>{t('devicesEmpty')}</p>
                ) : (
                  <ul className={css.deviceList}>
                    {devices.map(device => (
                      <li key={device.id} className={css.deviceRow}>
                        <div className={css.deviceMeta}>
                          {renamingId === device.id ? (
                            <form
                              className={css.renameForm}
                              onSubmit={(event) => {
                                event.preventDefault()
                                void rename(device.id, renameDraft)
                              }}
                            >
                              <input
                                className={css.renameInput}
                                value={renameDraft}
                                maxLength={120}
                                disabled={busy}
                                autoFocus
                                aria-label={t('renameLabel')}
                                onChange={(event) => { setRenameDraft(event.target.value) }}
                              />
                              <div className={css.renameButtons}>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className={css.renameButton}
                                  type="submit"
                                  disabled={busy || !renameDraft.trim()}
                                  loading={pending?.kind === 'rename' && pending.id === device.id}
                                >
                                  {t('save')}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className={css.renameButton}
                                  type="button"
                                  disabled={busy}
                                  onClick={() => { setRenamingId(null) }}
                                >
                                  {t('renameCancel')}
                                </Button>
                              </div>
                            </form>
                          ) : (
                            <span className={css.deviceName}>
                              {device.name}
                              {device.online ? <span className={css.online}>{t('devicesOnline')}</span> : null}
                            </span>
                          )}
                          {device.detail ? <span className={css.deviceDetail}>{device.detail}</span> : null}
                          {device.shortId ? <span className={css.deviceSeen}>{t('devicesId', { id: device.shortId })}</span> : null}
                          {device.createdAt ? (
                            <span className={css.deviceSeen}>
                              {t('devicesBound', { time: formatStamp(device.createdAt, t('devicesSeenUnknown')) })}
                            </span>
                          ) : null}
                          <span className={css.deviceSeen}>
                            {device.lastSeenAt
                              ? t('devicesSeen', { time: formatStamp(device.lastSeenAt, t('devicesSeenUnknown')) })
                              : t('devicesSeenUnknown')}
                          </span>
                        </div>
                        <div className={css.deviceActions}>
                          {renamingId !== device.id ? (
                            <button
                              type="button"
                              className={css.unbind}
                              disabled={busy}
                              onClick={() => {
                                setRenameDraft(device.name)
                                setRenamingId(device.id)
                              }}
                            >
                              {t('rename')}
                            </button>
                          ) : null}
                          <Button
                            type="button"
                            size="sm"
                            className={css.unbind}
                            disabled={busy}
                            loading={pending?.kind === 'unbind' && pending.id === device.id}
                            onClick={() => { void unbind(device.id) }}
                          >
                            {t('unbind')}
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
