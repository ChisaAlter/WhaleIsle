/** Desktop-only General row: close button hides to tray or quits the app. */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { SettingsSelect, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { desktopShell } from './desktop-shell.ts'
import type { SettingsKey } from './locales.ts'
import css from './CloseBehaviorRow.module.css'

/** Full Settings-row props. */
export type CloseBehaviorRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings'>

const OPTIONS: readonly { id: 'tray' | 'quit'; label: SettingsKey }[] = [
  { id: 'tray', label: 'closeBehavior.tray' },
  { id: 'quit', label: 'closeBehavior.quit' },
]

/**
 * Render the close-window preference selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function CloseBehaviorRow({ t }: CloseBehaviorRowProps) {
  const [closeToTray, setCloseToTray] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<{ id: number; text: string; success: boolean } | null>(null)
  const noticeId = useRef(0)
  const shell = desktopShell()

  useEffect(() => {
    let cancelled = false
    if (shell?.getConfig) setBusy(true)
    void shell?.getConfig?.().then((config) => {
      if (!cancelled && typeof config?.closeToTray === 'boolean') {
        setCloseToTray(config.closeToTray)
      }
    }).catch((caught: unknown) => {
      if (cancelled) return
      const text = t('feedback.readError', { message: caught instanceof Error ? caught.message : String(caught) })
      setError(text)
      setNotice({ id: ++noticeId.current, text, success: false })
    }).finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [shell, t])

  const selected = closeToTray ? 'tray' : 'quit'
  const selectedLabel = t(closeToTray ? 'closeBehavior.tray' : 'closeBehavior.quit')

  return (
    <div className={css.row} title={error || undefined}>
      <div className={css.rowText}>
        <div className={css.title}>{t('closeBehavior.title')}</div>
        <div className={css.desc}>{t('closeBehavior.description')}</div>
      </div>
      <SettingsSelect
        align="end"
        aria-label={selectedLabel}
        value={selected}
        loading={busy}
        options={OPTIONS.map(option => ({ id: option.id, label: t(option.label) }))}
        onChange={(id) => {
          const next = id === 'tray'
          if (!shell?.saveConfig) return
          const previous = closeToTray
          setCloseToTray(next)
          setBusy(true)
          void shell.saveConfig({ closeToTray: next }).then(saved => {
            if (saved.closeToTray !== next) {
              setCloseToTray(typeof saved.closeToTray === 'boolean' ? saved.closeToTray : previous)
              setError(t('feedback.notSaved'))
              setNotice({ id: ++noticeId.current, text: t('feedback.notSaved'), success: false })
              return
            }
            setError('')
            setNotice({ id: ++noticeId.current, text: t('feedback.saved'), success: true })
          }).catch((error: unknown) => {
            setCloseToTray(previous)
            const text = t('feedback.saveError', { message: error instanceof Error ? error.message : String(error) })
            setError(text)
            setNotice({ id: ++noticeId.current, text, success: false })
          }).finally(() => { setBusy(false) })
        }}
      />
      {notice !== null && <Toast key={notice.id} text={notice.text}
        {...notice.success ? { tone: 'success' as const } : {}}
        holdMs={notice.success ? 3000 : null} dismissLabel={t('close')} onDone={() => { setNotice(null) }} />}
    </div>
  )
}
