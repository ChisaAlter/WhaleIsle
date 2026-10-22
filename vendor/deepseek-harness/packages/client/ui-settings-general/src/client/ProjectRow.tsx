/** Desktop-only Interface row: toggle the built-in Project plugin mount (default off). */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { Button, IconQuestionOutlineRegular, Switch, Toast, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { desktopShell, type DesktopConfig } from './desktop-shell.ts'
import css from './ProjectRow.module.css'

/** Full Settings-row props. */
export type ProjectRowProps =
  PropsRuntime<'settings.interface.item'>
  & PropsLocale<'settings'>

/**
 * Render the Project enable switch with a help tip explaining the feature;
 * the desktop shell restarts Harness after the write so the overlay composes
 * or drops on the next start.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function ProjectRow({ t }: ProjectRowProps) {
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
      if (!cancelled && typeof config?.projectEnabled === 'boolean') {
        setEnabled(config.projectEnabled)
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
        <div className={css.titleRow}>
          <div className={css.title}>{t('project.title')}</div>
          <Tooltip label={t('project.help')} side="right" delayMs={0} focusDelayMs={0} portal openOnClick>
            <Button size="sm" className={css.helpButton} icon={<IconQuestionOutlineRegular size={16} />} aria-label={t('project.helpLabel')} />
          </Tooltip>
        </div>
        <div className={css.desc}>{t('project.description')}</div>
        <div className={css.hint}>{t('project.restartHint')}</div>
      </div>
      <Switch
        label={t('project.title')}
        checked={enabled}
        disabled={busy}
        loading={busy}
        title={error || undefined}
        onChange={(next: boolean) => {
          if (!shell?.saveConfig) return
          const previous = enabled
          setEnabled(next)
          setBusy(true)
          // A failed write reverts the switch so it never misstates the mount.
          void shell.saveConfig({ projectEnabled: next }).then(saved => {
            if (saved.projectEnabled !== next) {
              setEnabled(typeof saved.projectEnabled === 'boolean' ? saved.projectEnabled : previous)
              setError(t('feedback.notSaved'))
              setNotice({ id: ++noticeId.current, text: t('feedback.notSaved') })
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
