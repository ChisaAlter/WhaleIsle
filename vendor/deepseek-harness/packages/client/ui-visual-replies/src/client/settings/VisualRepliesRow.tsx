/** General settings switch with immediate feedback and stable row geometry. */
import { useState } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Switch, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { VisualRepliesSettings } from '../../config.ts'
import type {} from '../locale.ts'
import css from './VisualRepliesRow.module.css'

/** Preference source and write operation supplied by the owning plugin. */
export interface VisualRepliesRowInjected {
  hooks: {
    /** Accepted Host settings; a pending change is local to this row. */
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
 * Keep saving feedback in the switch; rejected writes restore the Host value.
 * @param props - accepted settings hook, writer, and locale seat.
 * @returns the visual-replies preference row.
 */
export function VisualRepliesRow({ useSettings, setEnabled, t }: VisualRepliesRowProps) {
  const settings = useSettings(value => value)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const [pending, setPending] = useState<boolean | null>(null)
  const enabled = settings.value?.enabled === true
  const writable = settings.status === 'ready' && settings.writable

  async function save(next: boolean): Promise<void> {
    setSaving(true)
    setFailed(false)
    setPending(next)
    try {
      setFailed(!await setEnabled(next))
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
      setPending(null)
    }
  }

  return <><div className={css.row} aria-busy={saving}>
    <div className={css.text}>
      <div className={css.title}>{t('settings.title')}</div>
      <div className={css.description}>{t('settings.description')}</div>
    </div>
    <Switch
      checked={pending ?? enabled}
      label={t('settings.title')}
      disabled={saving || !writable}
      loading={saving}
      title={!writable ? t('settings.unavailable') : undefined}
      onChange={(next: boolean) => { void save(next) }}
    />
  </div>
    {failed && <Toast text={t('settings.saveFailed')} holdMs={null}
      dismissLabel={t('settings.close')} onDone={() => { setFailed(false) }} />}
  </>
}
