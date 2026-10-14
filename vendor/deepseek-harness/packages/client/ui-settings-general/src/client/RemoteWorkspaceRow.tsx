/** Desktop-only Interface row: toggle the built-in dsh-remote remote-workspace mount. */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { Switch, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { desktopShell, type DesktopConfig } from './desktop-shell.ts'
import css from './RemoteWorkspaceRow.module.css'

/** Full Settings-row props. */
export type RemoteWorkspaceRowProps =
  PropsRuntime<'settings.interface.item'>
  & PropsLocale<'settings'>

/**
 * Render the remote workspace (dsh-remote) enable switch; the desktop shell
 * restarts Harness after the write so the overlay composes or drops on the
 * next start.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function RemoteWorkspaceRow({ t }: RemoteWorkspaceRowProps) {
  const [enabled, setEnabled] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<{ id: number; text: string; success: boolean } | null>(null)
  const noticeId = useRef(0)
  const shell = desktopShell()

  useEffect(() => {
    let cancelled = false
    if (shell?.getConfig) setBusy(true)
    void shell?.getConfig?.().then((config: DesktopConfig | null) => {
      if (!cancelled && typeof config?.remoteWorkspaceEnabled === 'boolean') {
        setEnabled(config.remoteWorkspaceEnabled)
      }
    }).catch((caught: unknown) => {
      if (cancelled) return
      const text = t('feedback.readError', { message: caught instanceof Error ? caught.message : String(caught) })
      setError(text)
      setNotice({ id: ++noticeId.current, text, success: false })
    }).finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [shell, t])

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('remoteWorkspace.title')}</div>
        <div className={css.desc}>{t('remoteWorkspace.description')}</div>
        <div className={css.hint}>{t('remoteWorkspace.restartHint')}</div>
      </div>
      <Switch
        label={t('remoteWorkspace.title')}
        checked={enabled}
        loading={busy}
        title={error || undefined}
        onChange={(next: boolean) => {
          if (!shell?.saveConfig) return
          const previous = enabled
          setEnabled(next)
          setBusy(true)
          void shell.saveConfig({ remoteWorkspaceEnabled: next }).then(saved => {
            if (saved.remoteWorkspaceEnabled !== next) {
              setEnabled(typeof saved.remoteWorkspaceEnabled === 'boolean' ? saved.remoteWorkspaceEnabled : previous)
              setError(t('feedback.notSaved'))
              setNotice({ id: ++noticeId.current, text: t('feedback.notSaved'), success: false })
              return
            }
            setError('')
            setNotice({ id: ++noticeId.current, text: t('feedback.saved'), success: true })
          }).catch((error: unknown) => {
            setEnabled(previous)
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
