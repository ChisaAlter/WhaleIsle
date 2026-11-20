/** Desktop-only General row: toggle the minimized bottom-right approval popup. */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { Switch, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { desktopShell, type DesktopConfig } from './desktop-shell.ts'
import css from './CloseBehaviorRow.module.css'

/** Full Settings-row props. */
export type ApprovalPopupRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings'>

/**
 * Render the minimized approval popup toggle; disabling hides the popup while
 * keeping the app icon badge active.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function ApprovalPopupRow({ t }: ApprovalPopupRowProps) {
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
      if (!cancelled && typeof config?.approvalPopupEnabled === 'boolean') {
        setEnabled(config.approvalPopupEnabled)
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
    <div className={css.row} title={error || undefined}>
      <div className={css.rowText}>
        <div className={css.title}>{t('approvalPopup.title')}</div>
        <div className={css.desc}>{t('approvalPopup.description')}</div>
      </div>
      <Switch
        label={t('approvalPopup.title')}
        checked={enabled}
        loading={busy}
        title={error || undefined}
        onChange={(next: boolean) => {
          if (!shell?.saveConfig) return
          const previous = enabled
          setEnabled(next)
          setBusy(true)
          void shell.saveConfig({ approvalPopupEnabled: next }).then((saved) => {
            if (saved.approvalPopupEnabled !== next) {
              setEnabled(typeof saved.approvalPopupEnabled === 'boolean' ? saved.approvalPopupEnabled : previous)
              setError(t('feedback.notSaved'))
              setNotice({ id: ++noticeId.current, text: t('feedback.notSaved') })
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
