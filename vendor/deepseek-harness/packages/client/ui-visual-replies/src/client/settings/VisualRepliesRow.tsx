/** General settings row displaying the Host-accepted visual-reply preference. */
import { useState } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { VisualRepliesSettings } from '../../config.ts'
import type {} from '../locale.ts'
import css from './VisualRepliesRow.module.css'

/** Preference source and write operation supplied by the owning plugin. */
export interface VisualRepliesRowInjected {
  hooks: {
    /** Only confirmed Host settings drive the displayed switch. */
    settings: ObservableSnapshot<ConfigFormSnapshot<VisualRepliesSettings>>
  }
  /** Resolve true only after the Host accepts and persists this value. */
  setEnabled(enabled: boolean): Promise<boolean>
}

/** Derived settings-slot props; components receive no Context or service. */
export type VisualRepliesRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'visual-replies'>
  & InjectFace<VisualRepliesRowInjected>

/**
 * Show the persisted toggle and a failed-write message in the affected row.
 * @param props - accepted settings hook, writer, and locale seat.
 * @returns the visual-replies preference row.
 */
export function VisualRepliesRow({ useSettings, setEnabled, t }: VisualRepliesRowProps) {
  const settings = useSettings(value => value)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const enabled = settings.value?.enabled === true
  const writable = settings.status === 'ready' && settings.writable

  async function save(next: boolean): Promise<void> {
    setSaving(true)
    setFailed(false)
    try {
      setFailed(!await setEnabled(next))
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return <div className={css.row} aria-busy={saving}>
    <div className={css.text}>
      <div className={css.title}>{t('settings.title')}</div>
      <div className={css.description}>{t('settings.description')}</div>
      {saving && <div className={css.status} role="status">{t('settings.saving')}</div>}
      {failed && <div className={css.error} role="alert">{t('settings.saveFailed')}</div>}
    </div>
    <Switch
      checked={enabled}
      label={t('settings.title')}
      disabled={saving || !writable}
      title={!writable ? t('settings.unavailable') : undefined}
      onChange={(next: boolean) => { void save(next) }}
    />
  </div>
}
