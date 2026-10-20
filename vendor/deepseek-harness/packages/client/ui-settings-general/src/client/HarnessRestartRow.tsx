/**
 * Desktop-only General-settings row for the Harness auto-recovery policy:
 * whether a crashed Harness process restarts itself, and the bounded retry
 * schedule (max attempts, base delay). The row is registered only when the
 * desktop bridge exposes both `getConfig` and `saveConfig`, so this component
 * assumes both exist; it stays inert (loading) if the bridge ever disappears
 * after registration.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { SettingsSelect, Switch, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  desktopShell,
  HARNESS_RESTART_BASE_DELAYS_MS,
  HARNESS_RESTART_MAX_ATTEMPTS,
  normalizeHarnessRestart,
  type HarnessRestartConfig,
} from './desktop-shell.ts'
import css from './HarnessRestartRow.module.css'

/** Full component props: the empty item owner share plus the settings locale seat. */
export type HarnessRestartRowProps = PropsRuntime<'settings.general.item'> & PropsLocale<'settings'>

/** Row lifecycle: reading the persisted policy, settled, or failed. */
type RowPhase = 'loading' | 'ready' | 'error'

/**
 * Render the Harness auto-restart preference row.
 * @param props - composed slot props (the section supplies no owner data).
 * @returns the row element tree.
 */
export function HarnessRestartRow({ t }: HarnessRestartRowProps) {
  const shell = desktopShell()
  const [config, setConfig] = useState<HarnessRestartConfig | null>(null)
  const [phase, setPhase] = useState<RowPhase>('loading')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null)
  const noticeId = useRef(0)
  const saveGen = useRef(0)
  const current = config ?? normalizeHarnessRestart(undefined)

  useEffect(() => {
    const load = shell?.getConfig
    if (load === undefined) return undefined
    let cancelled = false
    void load().then((next) => {
      if (cancelled) return
      setConfig(normalizeHarnessRestart(next))
      setPhase('ready')
    }).catch((caught: unknown) => {
      if (cancelled) return
      const message = caught instanceof Error ? caught.message : String(caught)
      setError(message)
      setPhase('error')
      setNotice({ id: ++noticeId.current, text: t('harnessRestart.error', { message }) })
    })
    return () => { cancelled = true }
  }, [shell, t])

  const save = useCallback(async (patch: Partial<HarnessRestartConfig>) => {
    if (!shell?.saveConfig) return
    const previous = config ?? normalizeHarnessRestart(undefined)
    const next = normalizeHarnessRestart({ ...previous, ...patch })
    const gen = ++saveGen.current
    setSaving(true)
    setConfig(next)
    setError('')
    setPhase('ready')
    try {
      const saved = await shell.saveConfig(patch)
      if (gen !== saveGen.current) return
      const accepted = (patch.harnessAutoRestart === undefined || saved.harnessAutoRestart === next.harnessAutoRestart)
        && (patch.harnessRestartMaxAttempts === undefined || saved.harnessRestartMaxAttempts === next.harnessRestartMaxAttempts)
        && (patch.harnessRestartBaseDelayMs === undefined || saved.harnessRestartBaseDelayMs === next.harnessRestartBaseDelayMs)
      if (!accepted) {
        setConfig(normalizeHarnessRestart(saved))
        setError(t('feedback.notSaved'))
        setPhase('error')
        setNotice({ id: ++noticeId.current, text: t('feedback.notSaved') })
        return
      }
      setConfig(normalizeHarnessRestart({ ...next, ...saved }))
      setNotice(null)
    } catch (caught) {
      if (gen !== saveGen.current) return
      setConfig(previous)
      const message = caught instanceof Error ? caught.message : String(caught)
      setError(message)
      setPhase('error')
      setNotice({ id: ++noticeId.current, text: t('harnessRestart.error', { message }) })
    } finally {
      if (gen === saveGen.current) setSaving(false)
    }
  }, [config, shell, t])

  const loading = phase === 'loading' || saving

  return (
    <div className={css.row} title={phase === 'error' ? t('harnessRestart.error', { message: error }) : undefined}>
      <div className={css.rowText}>
        <div className={css.title}>{t('harnessRestart.title')}</div>
        <div className={css.desc}>{t('harnessRestart.description')}</div>
      </div>
      <div className={css.controls}>
        <Switch
          checked={current.harnessAutoRestart}
          disabled={loading}
          loading={loading}
          aria-label={t('harnessRestart.enable')}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            void save({ harnessAutoRestart: event.target.checked })
          }}
        />
        <div className={css.pickers}>
          <div className={css.picker}>
            <span className={css.pickerLabel}>{t('harnessRestart.maxAttempts')}</span>
            <SettingsSelect
              align="end"
              aria-label={t('harnessRestart.maxAttempts')}
              disabled={loading}
              loading={loading}
              value={String(current.harnessRestartMaxAttempts)}
              options={HARNESS_RESTART_MAX_ATTEMPTS.map(attempts => ({
                id: String(attempts),
                label: String(attempts),
              }))}
              onChange={(id) => {
                void save({ harnessRestartMaxAttempts: Number(id) })
              }}
            />
          </div>
          <div className={css.picker}>
            <span className={css.pickerLabel}>{t('harnessRestart.baseDelay')}</span>
            <SettingsSelect
              align="end"
              aria-label={t('harnessRestart.baseDelay')}
              disabled={loading}
              loading={loading}
              value={String(current.harnessRestartBaseDelayMs)}
              options={HARNESS_RESTART_BASE_DELAYS_MS.map(ms => ({
                id: String(ms),
                label: t('harnessRestart.delay', { count: String(ms / 1000) }),
              }))}
              onChange={(id) => {
                void save({ harnessRestartBaseDelayMs: Number(id) })
              }}
            />
          </div>
        </div>
      </div>
      {notice !== null && <Toast key={notice.id} text={notice.text} onDone={() => { setNotice(null) }} />}
    </div>
  )
}
