/** Desktop-only Built-in features row: toggle the built-in dsh-im message-channels mount. */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { Switch, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { desktopShell, type DesktopConfig } from './desktop-shell.ts'
import css from './DshImRow.module.css'

/** Full Settings-row props. */
export type DshImRowProps =
  PropsRuntime<'settings.features.item'>
  & PropsLocale<'settings'>

/**
 * Render the message channels (dsh-im) enable switch; the desktop shell
 * restarts Harness after the write so the overlay composes or drops on the
 * next start. Existing channel data is kept while the plugin is off.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function DshImRow({ t }: DshImRowProps) {
  const [enabled, setEnabled] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null)
  const noticeId = useRef(0)
  const shell = desktopShell()

  useEffect(() => {
    let cancelled = false
    if (shell?.getConfig) setBusy(true)
    void shell?.getConfig?.().then((config: DesktopConfig | null) => {
      if (!cancelled && typeof config?.dshImEnabled === 'boolean') {
        setEnabled(config.dshImEnabled)
      }
    }).catch((caught: unknown) => {
      if (cancelled) return
      const text = t('feedback.readError', { message: caught instanceof Error ? caught.message : String(caught) })
      setError(text)
      setNotice({ id: ++noticeId.current, text })
    }).finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [shell, t])

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('dshIm.title')}</div>
        <div className={css.desc}>{t('dshIm.description')}</div>
        <div className={css.hint}>{t('dshIm.restartHint')}</div>
      </div>
      <Switch
        label={t('dshIm.title')}
        checked={enabled}
        loading={busy}
        title={error || undefined}
        onChange={(next: boolean) => {
          if (!shell?.saveConfig) return
          const previous = enabled
          setEnabled(next)
          setBusy(true)
          void shell.saveConfig({ dshImEnabled: next }).then(saved => {
            if (saved.dshImEnabled !== next) {
              setEnabled(typeof saved.dshImEnabled === 'boolean' ? saved.dshImEnabled : previous)
              const text = t(saved.restartCancelled === true ? 'feedback.restartCancelled' : 'feedback.notSaved')
              setError(text)
              setNotice({ id: ++noticeId.current, text })
              return
            }
            setError('')
            setNotice(null)
          }).catch((error: unknown) => {
            setEnabled(previous)
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
