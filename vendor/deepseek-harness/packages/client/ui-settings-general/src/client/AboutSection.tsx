/** About page inside the official Settings sidebar. */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, SettingsSelect, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { desktopShell, type DownloadRoute, type UpdateInfo } from './desktop-shell.ts'
import css from './AboutSection.module.css'

const HARNESS_URL = 'https://github.com/deepseek-ai/deepseek-harness'
const REPO_URL = 'https://github.com/ChisaAlter/Deepseek-Harness-Desktop'
const RELEASES_URL = `${REPO_URL}/releases`

const ROUTES: readonly { id: DownloadRoute; label: 'about.routeGithub' | 'about.routeCnb' }[] = [
  { id: 'github', label: 'about.routeGithub' },
  { id: 'cnb', label: 'about.routeCnb' },
]

type UpdateStatus = 'idle' | 'checking' | 'none' | 'current' | 'available' | 'error' | 'download' | 'install' | 'manual'

/** Props the Settings renderer binds for this section. */
export type AboutSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'settings'>
  & InjectFace<AboutSectionInjected>

/** The existing Desktop update flow, when the host provides its status carrier. */
export type AboutSectionInjected = {
  openDesktopUpdate?: () => void
}

function statusCopy(
  t: AboutSectionProps['t'],
  status: UpdateStatus,
  info: UpdateInfo | null,
  percent: number,
): string {
  if (status === 'checking') return t('about.updateChecking')
  if (status === 'download') return t('about.updateDownloading', { percent: String(percent) })
  if (status === 'install') return t('about.updateInstalling')
  if (status === 'manual') return t('about.updateManualInstall')
  if (info?.openedPage) return t('about.updateOpenedPage')
  if (status === 'none') return t('about.updateNone')
  if (status === 'current') return t('about.updateCurrent', { latest: info?.latest || info?.current || '' })
  if (status === 'available') return t('about.updateAvailable', { latest: info?.latest || '' })
  if (status === 'error') return t('about.updateError', { message: info?.message || '' })
  return ''
}

/** Render the About column: this desktop app, version check, and official Harness. */
export function AboutSection({ t, openDesktopUpdate }: AboutSectionProps): ReactNode {
  const [version, setVersion] = useState('')
  const [homePath, setHomePath] = useState('')
  const [homeError, setHomeError] = useState('')
  const [homeBusy, setHomeBusy] = useState(false)
  const [readError, setReadError] = useState('')
  const [credentialStorage, setCredentialStorage] = useState<'encrypted' | 'plaintext' | ''>('')
  const [busy, setBusy] = useState(false)
  const [percent, setPercent] = useState(0)
  const [status, setStatus] = useState<UpdateStatus>('idle')
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [route, setRoute] = useState<DownloadRoute>('github')
  const [routeBusy, setRouteBusy] = useState(false)
  const [notice, setNotice] = useState<{ id: number; text: string; success: boolean } | null>(null)
  const noticeId = useRef(0)
  const shell = desktopShell()

  const applyInfo = useCallback((next: UpdateInfo) => {
    setInfo(next)
    if (next.current) setVersion(next.current)
    const nextStatus = next.status
    if (nextStatus === 'none' || nextStatus === 'current' || nextStatus === 'available' || nextStatus === 'error') {
      setStatus(nextStatus)
    }
  }, [])

  const check = useCallback(async () => {
    if (!shell?.checkUpdate) return
    setBusy(true)
    setStatus('checking')
    try {
      const next = await shell.checkUpdate()
      applyInfo(next)
      const nextStatus = next.status
      if (nextStatus === 'none' || nextStatus === 'current' || nextStatus === 'available' || nextStatus === 'error') {
        setNotice({ id: ++noticeId.current, text: statusCopy(t, nextStatus, next, 0), success: nextStatus !== 'error' })
      }
    } catch (error) {
      const next = { status: 'error', message: error instanceof Error ? error.message : String(error) }
      applyInfo(next)
      setNotice({ id: ++noticeId.current, text: statusCopy(t, 'error', next, 0), success: false })
    } finally {
      setBusy(false)
    }
  }, [applyInfo, shell, t])

  const install = useCallback(async () => {
    if (status === 'available' && openDesktopUpdate !== undefined) {
      openDesktopUpdate()
      return
    }
    if (!shell?.installUpdate) return
    setBusy(true)
    setPercent(0)
    setStatus('download')
    setNotice(null)
    try {
      const next = await shell.installUpdate()
      applyInfo(next)
      if (next.cancelled === true) {
        setNotice({ id: ++noticeId.current, text: t('about.updateCancelled'), success: false })
      } else if (next.manualInstall) {
        setStatus('manual')
        setNotice({ id: ++noticeId.current, text: t('about.updateManualInstall'), success: true })
      } else if (next.launched) {
        setStatus('install')
        setNotice({ id: ++noticeId.current, text: t('about.updateInstalling'), success: true })
      } else if (next.openedPage) {
        setNotice({ id: ++noticeId.current, text: t('about.updateOpenedPage'), success: false })
      } else {
        const failed = { ...next, status: 'error', message: next.message || next.code || next.status || '' }
        applyInfo(failed)
        setNotice({ id: ++noticeId.current, text: statusCopy(t, 'error', failed, 0), success: false })
      }
    } catch (error) {
      const next = { status: 'error', message: error instanceof Error ? error.message : String(error) }
      applyInfo(next)
      setNotice({ id: ++noticeId.current, text: statusCopy(t, 'error', next, 0), success: false })
    } finally {
      setBusy(false)
    }
  }, [applyInfo, openDesktopUpdate, shell, status, t])

  const openHome = useCallback(async () => {
    if (!shell?.openDshHome) return
    setHomeError('')
    setHomeBusy(true)
    try {
      const result = await shell.openDshHome()
      if (!result.ok) {
        const message = result.error || 'failed'
        setHomeError(message)
        setNotice({ id: ++noticeId.current, text: t('about.openHomeError', { message }), success: false })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setHomeError(message)
      setNotice({ id: ++noticeId.current, text: t('about.openHomeError', { message }), success: false })
    } finally {
      setHomeBusy(false)
    }
  }, [shell, t])

  // Updates download through the same route the launcher offers; unpicked means GitHub.
  const pickRoute = useCallback(async (next: DownloadRoute) => {
    if (!shell?.saveConfig || next === route) return
    const previous = route
    setRoute(next)
    setRouteBusy(true)
    try {
      const saved = await shell.saveConfig({ downloadRoute: next })
      if (saved.downloadRoute !== next) {
        setRoute(previous)
        setNotice({ id: ++noticeId.current, text: t('feedback.notSaved'), success: false })
        return
      }
    } catch (error) {
      setRoute(previous)
      const message = error instanceof Error ? error.message : String(error)
      setNotice({ id: ++noticeId.current, text: t('feedback.saveError', { message }), success: false })
      return
    } finally {
      setRouteBusy(false)
    }
    void check()
  }, [check, route, shell, t])

  useEffect(() => {
    if (!shell) return undefined
    let cancelled = false
    void shell.getConfig?.().then((config) => {
      if (!cancelled && config.downloadRoute === 'cnb') setRoute('cnb')
      if (!cancelled && config.appVersion) setVersion(config.appVersion)
      if (!cancelled && typeof config.dshHome === 'string') setHomePath(config.dshHome)
      if (!cancelled && (config.credentialStorage === 'encrypted' || config.credentialStorage === 'plaintext')) {
        setCredentialStorage(config.credentialStorage)
      }
      if (!cancelled) setReadError('')
    }).catch((caught: unknown) => {
      if (cancelled) return
      const message = caught instanceof Error ? caught.message : String(caught)
      setReadError(message)
      setNotice({ id: ++noticeId.current, text: t('feedback.readError', { message }), success: false })
    })
    void check()
    const stop = shell.onUpdateProgress?.((payload) => {
      if (payload.phase === 'download') {
        setStatus('download')
        setPercent(Number(payload.percent) || 0)
      }
      if (payload.phase === 'install') {
        setStatus('install')
        setPercent(100)
      }
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [check, shell, t])

  const canInstall = Boolean(shell?.installUpdate || (status === 'available' && openDesktopUpdate)) && !busy && (
    Boolean(info?.assetUrl) || status === 'none' || status === 'available' || status === 'current'
  )

  return (
    <div className={css.section} title={readError ? t('feedback.readError', { message: readError }) : undefined}>
      <h2 className={css.heading}>{t('about.nav')}</h2>
      <p className={css.intro}>{t('about.intro')}</p>
      <ul className={css.list}>
        <li>
          <div className={css.name}>{t('about.app')}</div>
          <p className={css.meta}>{t('about.version', { version: version || '—' })}</p>
          <p className={css.meta}>{t('about.appMeta')}</p>
          {shell ? (
            <>
              {shell.saveConfig ? (
                <div className={css.route}>
                  <span className={css.routeLabel}>{t('about.route')}</span>
                  <SettingsSelect
                    aria-label={t('about.route')}
                    value={route}
                    loading={routeBusy}
                    disabled={busy}
                    options={ROUTES.map(option => ({ id: option.id, label: t(option.label) }))}
                    onChange={(id) => { void pickRoute(id === 'cnb' ? 'cnb' : 'github') }}
                  />
                </div>
              ) : null}
              <div className={css.actions}>
                <Button variant="outline" size="sm" disabled={busy} loading={busy && status === 'checking'}
                  title={status === 'error' ? statusCopy(t, status, info, percent) : undefined}
                  onClick={() => { void check() }}>
                  {t('about.checkUpdate')}
                </Button>
                <Button variant="primary" size="sm" disabled={!canInstall} loading={status === 'download' || (busy && status !== 'checking')}
                  feedback={status === 'download' ? `${String(percent)}%` : undefined}
                  title={status === 'error' ? statusCopy(t, status, info, percent) : undefined}
                  onClick={() => { void install() }}>
                  {t('about.installUpdate')}
                </Button>
              </div>
            </>
          ) : (
            <p className={css.meta}>{t('about.desktopOnly')}</p>
          )}
          {credentialStorage ? (
            <p
              className={credentialStorage === 'plaintext' ? css.status : css.meta}
              role={credentialStorage === 'plaintext' ? 'status' : undefined}
              data-dsh-credential-storage={credentialStorage}
            >
              {credentialStorage === 'encrypted' ? t('about.credEncrypted') : t('about.credPlaintext')}
            </p>
          ) : null}
          {shell?.openDshHome ? (
            <>
              {homePath ? <p className={css.meta}>{t('about.homePath', { path: homePath })}</p> : null}
              <div className={css.actions}>
                <Button variant="outline" size="sm" loading={homeBusy}
                  title={homeError ? t('about.openHomeError', { message: homeError }) : undefined}
                  onClick={() => { void openHome() }}>
                  {t('about.openHome')}
                </Button>
              </div>
            </>
          ) : null}
          <a className={css.link} href={info?.releasesUrl || RELEASES_URL} target="_blank" rel="noreferrer noopener">
            {t('about.releases')}
          </a>
        </li>
        <li>
          <a className={css.link} href={HARNESS_URL} target="_blank" rel="noreferrer noopener">
            {t('about.harness')}
          </a>
        </li>
      </ul>
      {notice !== null && <Toast key={notice.id} text={notice.text}
        {...notice.success ? { tone: 'success' as const } : {}}
        holdMs={notice.success ? 3000 : null} dismissLabel={t('close')} onDone={() => { setNotice(null) }} />}
    </div>
  )
}

export { REPO_URL, RELEASES_URL }
