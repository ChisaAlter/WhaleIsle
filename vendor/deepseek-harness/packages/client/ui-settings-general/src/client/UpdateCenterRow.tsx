/** About → app update row when the desktop owns a shared update center. */

import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AboutSectionProps } from './AboutSection.tsx'
import type { DesktopUpdateCenter, UpdateCenterView } from './desktop-shell.ts'
import css from './AboutSection.module.css'

type Primary = { action: 'download' | 'resume' | 'install' | null; label: 'about.center.open' | 'about.center.download' | 'about.center.resume' | 'about.center.install' }

/**
 * One status line from the center snapshot.
 * @param view - update center snapshot.
 * @param t - settings translator.
 * @returns localized status.
 */
export function centerStatus(view: UpdateCenterView, t: AboutSectionProps['t']): string {
  const version = view.target ? `v${view.target.version}` : ''
  const percent = view.progress && view.progress.total > 0
    ? String(Math.floor((view.progress.received / view.progress.total) * 100))
    : '0'
  const current = `v${view.current}`
  switch (view.phase) {
    case 'checking': return t('about.center.checking')
    case 'current': return t('about.center.current', { current })
    case 'available': return t('about.center.available', { version })
    case 'downloading': return t('about.center.downloading', { version, percent })
    case 'paused': return t('about.center.paused', { version, percent })
    case 'verifying': return t('about.center.verifying', { version })
    case 'ready': return t('about.center.ready', { version })
    case 'installing': return t('about.center.installing', { version })
    case 'error': return t('about.center.error', { message: view.error?.message || '' })
    default: return t('about.center.idle', { current })
  }
}

function primaryFor(view: UpdateCenterView): Primary {
  if (view.phase === 'available') return { action: 'download', label: 'about.center.download' }
  if (view.phase === 'paused') return { action: 'resume', label: 'about.center.resume' }
  if (view.phase === 'ready') return { action: 'install', label: 'about.center.install' }
  return { action: null, label: 'about.center.open' }
}

/**
 * Status, check and the contextual next step; everything else (route,
 * progress, notes, errors) lives in the update center overlay.
 * @param props - the shell's update center and the settings translator.
 * @returns the update row.
 */
export function UpdateCenterRow({ center, t }: { center: DesktopUpdateCenter; t: AboutSectionProps['t'] }): ReactNode {
  const [view, setView] = useState<UpdateCenterView | null>(null)
  useEffect(() => {
    let live = true
    void center.state().then((next) => { if (live) setView(next) }, () => {})
    const stop = center.onState((next) => { if (live) setView(next) })
    return () => { live = false; stop() }
  }, [center])
  const run = useCallback(async (action: 'check' | 'download' | 'resume' | 'install' | null) => {
    await center.open()
    if (action) setView(await center.command(action))
  }, [center])
  if (view === null) return null
  const primary = primaryFor(view)
  const busy = view.phase === 'checking' || view.phase === 'verifying' || view.phase === 'installing'
  return (
    <>
      <p className={view.phase === 'error' ? css.status : css.meta} role="status" data-update-phase={view.phase}>
        {centerStatus(view, t)}
      </p>
      <div className={css.actions}>
        <Button variant="outline" size="sm" disabled={busy} loading={view.phase === 'checking'}
          onClick={() => { void run('check') }}>
          {t('about.checkUpdate')}
        </Button>
        <Button variant="primary" size="sm" onClick={() => { void run(primary.action) }}>
          {t(primary.label)}
        </Button>
      </div>
    </>
  )
}
