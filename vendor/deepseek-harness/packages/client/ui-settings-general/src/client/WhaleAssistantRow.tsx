/** Desktop-only Built-in features row: toggle the whale assistant plugin mount. */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { Switch, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { desktopShell, type DesktopConfig } from './desktop-shell.ts'
import css from './DshbotRow.module.css'

/** Full Settings-row props. */
export type WhaleAssistantRowProps =
  PropsRuntime<'settings.features.item'>
  & PropsLocale<'settings'>

/**
 * Render the whale assistant enable switch. The Whale section keeps the same
 * switch beside her settings; both read the stored value when shown.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function WhaleAssistantRow({ t }: WhaleAssistantRowProps) {
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null)
  const noticeId = useRef(0)
  const shell = desktopShell()

  useEffect(() => {
    let cancelled = false
    if (shell?.getConfig) setBusy(true)
    void shell?.getConfig?.().then((config: DesktopConfig | null) => {
      if (!cancelled && typeof config?.whaleAssistantEnabled === 'boolean') {
        setEnabled(config.whaleAssistantEnabled)
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
        <div className={css.title}>{t('pet.whaleAssistant')}</div>
        <div className={css.desc}>{t('pet.whaleAssistantDesc')}</div>
      </div>
      <Switch
        label={t('pet.whaleAssistant')}
        checked={enabled}
        disabled={busy}
        loading={busy}
        title={error || undefined}
        onChange={(next: boolean) => {
          if (!shell?.saveConfig) return
          const previous = enabled
          setEnabled(next)
          setBusy(true)
          // A refused restart writes the toggle back; the switch follows it.
          void shell.saveConfig({ whaleAssistantEnabled: next }).then(saved => {
            if (saved.whaleAssistantEnabled !== next) {
              setEnabled(typeof saved.whaleAssistantEnabled === 'boolean' ? saved.whaleAssistantEnabled : previous)
              const text = t(saved.restartCancelled === true ? 'feedback.restartCancelled' : 'feedback.notSaved')
              setError(text)
              setNotice({ id: ++noticeId.current, text })
              return
            }
            setError('')
            setNotice(null)
          }).catch((caught: unknown) => {
            setEnabled(previous)
            const text = t('feedback.saveError', { message: caught instanceof Error ? caught.message : String(caught) })
            setError(text)
            setNotice({ id: ++noticeId.current, text })
          }).finally(() => { setBusy(false) })
        }}
      />
      {notice !== null && <Toast key={notice.id} text={notice.text} onDone={() => { setNotice(null) }} />}
    </div>
  )
}
