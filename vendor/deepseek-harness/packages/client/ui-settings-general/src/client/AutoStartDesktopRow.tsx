/** Desktop-only General row: cold start opens the desktop directly or the launcher first. */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { SettingsSelect, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { desktopShell } from './desktop-shell.ts'
import type { SettingsKey } from './locales.ts'
import css from './CloseBehaviorRow.module.css'

/** Full Settings-row props. */
export type AutoStartDesktopRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings'>

const OPTIONS: readonly { id: 'direct' | 'launcher'; label: SettingsKey }[] = [
  { id: 'direct', label: 'autoStartDesktop.direct' },
  { id: 'launcher', label: 'autoStartDesktop.launcher' },
]

/**
 * Render the cold-start preference selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function AutoStartDesktopRow({ t }: AutoStartDesktopRowProps) {
  const [autoStartDesktop, setAutoStartDesktop] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null)
  const noticeId = useRef(0)
  const shell = desktopShell()

  useEffect(() => {
    let cancelled = false
    if (shell?.getConfig) setBusy(true)
    void shell?.getConfig?.().then((config) => {
      if (!cancelled && typeof config?.autoStartDesktop === 'boolean') {
        setAutoStartDesktop(config.autoStartDesktop)
      }
    }).catch((caught: unknown) => {
      if (cancelled) return
      const text = t('feedback.readError', { message: caught instanceof Error ? caught.message : String(caught) })
      setError(text)
      setNotice({ id: ++noticeId.current, text })
    }).finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [shell, t])

  const selected = autoStartDesktop ? 'direct' : 'launcher'
  const selectedLabel = t(autoStartDesktop ? 'autoStartDesktop.direct' : 'autoStartDesktop.launcher')

  return (
    <div className={css.row} title={error || undefined}>
      <div className={css.rowText}>
        <div className={css.title}>{t('autoStartDesktop.title')}</div>
        <div className={css.desc}>{t('autoStartDesktop.description')}</div>
      </div>
      <SettingsSelect
        align="end"
        aria-label={selectedLabel}
        value={selected}
        loading={busy}
        options={OPTIONS.map(option => ({ id: option.id, label: t(option.label) }))}
        onChange={(id) => {
          const next = id === 'direct'
          if (!shell?.saveConfig) return
          const previous = autoStartDesktop
          setAutoStartDesktop(next)
          setBusy(true)
          void shell.saveConfig({ autoStartDesktop: next }).then(saved => {
            if (saved.autoStartDesktop !== next) {
              setAutoStartDesktop(typeof saved.autoStartDesktop === 'boolean' ? saved.autoStartDesktop : previous)
              setError(t('feedback.notSaved'))
              setNotice({ id: ++noticeId.current, text: t('feedback.notSaved') })
              return
            }
            setError('')
            setNotice(null)
          }).catch((error: unknown) => {
            setAutoStartDesktop(previous)
            const text = t('feedback.saveError', { message: error instanceof Error ? error.message : String(error) })
            setError(text)
            setNotice({ id: ++noticeId.current, text })
          }).finally(() => { setBusy(false) })
        }}
      />
      {notice !== null && <Toast key={notice.id} text={notice.text} onDone={() => { setNotice(null) }} />}
    </div>
  )
}
