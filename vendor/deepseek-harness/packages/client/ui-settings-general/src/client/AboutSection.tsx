/** About page inside the official Settings sidebar. */

import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { desktopShell, type UpdateInfo } from './desktop-shell.ts'
import css from './AboutSection.module.css'

const HARNESS_URL = 'https://github.com/deepseek-ai/deepseek-harness'
const REPO_URL = 'https://github.com/ChisaAlter/Deepseek-Harness-Desktop'
const RELEASES_URL = `${REPO_URL}/releases`

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
  const [credentialStorage, setCredentialStorage] = useState<'encrypted' | 'plaintext' | ''>('')
  const [busy, setBusy] = useState(false)
  const [percent, setPercent] = useState(0)
  const [status, setStatus] = useState<UpdateStatus>('idle')
  const [info, setInfo] = useState<UpdateInfo | null>(null)
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
      applyInfo(await shell.checkUpdate())
    } catch (error) {
      applyInfo({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }, [applyInfo, shell])

  const install = useCallback(async () => {
    if (status === 'available' && openDesktopUpdate !== undefined) {
      openDesktopUpdate()
      return
    }
    if (!shell?.installUpdate) return
    setBusy(true)
    setPercent(0)
    setStatus('download')
    try {
      const next = await shell.installUpdate()
      applyInfo(next)
      if (next.manualInstall) setStatus('manual')
      else if (next.launched) setStatus('install')
    } catch (error) {
      applyInfo({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }, [applyInfo, openDesktopUpdate, shell, status])

  const openHome = useCallback(async () => {
    if (!shell?.openDshHome) return
    setHomeError('')
    try {
      const result = await shell.openDshHome()
      if (!result.ok) setHomeError(result.error || 'failed')
    } catch (error) {
      setHomeError(error instanceof Error ? error.message : String(error))
    }
  }, [shell])

  useEffect(() => {
    if (!shell) return undefined
    let cancelled = false
    void shell.getConfig?.().then((config) => {
      if (!cancelled && config.appVersion) setVersion(config.appVersion)
      if (!cancelled && typeof config.dshHome === 'string') setHomePath(config.dshHome)
      if (!cancelled && (config.credentialStorage === 'encrypted' || config.credentialStorage === 'plaintext')) {
        setCredentialStorage(config.credentialStorage)
      }
    }).catch(() => {})
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
  }, [check, shell])

  const canInstall = Boolean(shell?.installUpdate || (status === 'available' && openDesktopUpdate)) && !busy && (
    Boolean(info?.assetUrl) || status === 'none' || status === 'available' || status === 'current'
  )
  const message = statusCopy(t, status, info, percent)

  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('about.nav')}</h2>
      <p className={css.intro}>{t('about.intro')}</p>
      <ul className={css.list}>
        <li>
          <div className={css.name}>{t('about.app')}</div>
          <p className={css.meta}>{t('about.version', { version: version || '—' })}</p>
          <p className={css.meta}>{t('about.appMeta')}</p>
          {shell ? (
            <>
              {message ? <p className={css.status} role="status">{message}</p> : null}
              <div className={css.actions}>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => { void check() }}>
                  {t('about.checkUpdate')}
                </Button>
                <Button variant="primary" size="sm" disabled={!canInstall} onClick={() => { void install() }}>
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
              {homeError ? <p className={css.status} role="status">{t('about.openHomeError', { message: homeError })}</p> : null}
              <div className={css.actions}>
                <Button variant="outline" size="sm" onClick={() => { void openHome() }}>
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
    </div>
  )
}

export { REPO_URL, RELEASES_URL }
