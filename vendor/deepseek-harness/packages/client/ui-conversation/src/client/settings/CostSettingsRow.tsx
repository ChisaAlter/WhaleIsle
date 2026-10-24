/** Interface Settings row for the composer-dock session-cost switch: it sits
 * directly below the session-stats switch and gates the whole peak/valley
 * dock row (phase + figure). The row edits nothing itself — model prices are
 * edited by the usage-stats 计费设置 window, the only price editor. */
import { useId, type ChangeEvent } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationKey } from '../locales.ts'
import css from './BeamRow.module.css'

/** Registration-side preference face. */
export interface CostSettingsRowInjected {
  hooks: {
    /** Persisted session-cost preference bound as useSessionCost. */
    sessionCost: SnapshotStore<boolean>
    /** Host writability bound as useWritable. */
    writable: SnapshotStore<boolean>
  }
  /** Change whether the dock paints the session cost figure. */
  setSessionCost: (value: boolean) => void
}

/** Full Settings-row props. */
export type CostSettingsRowProps =
  PropsRuntime<'settings.usage.item'>
  & PropsLocale<'conversation'>
  & InjectFace<CostSettingsRowInjected>

/**
 * Render the session-cost Switch.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
/* jscpd:ignore-start */
export function CostSettingsRow({
  useSessionCost, useWritable, setSessionCost, t,
}: CostSettingsRowProps) {
  const enabled = useSessionCost(value => value)
  const writable = useWritable(value => value)
  const titleId = useId()
  const title: ConversationKey = 'settings.sessionCost.title'
  const description: ConversationKey = 'settings.sessionCost.description'

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title} id={titleId}>{t(title)}</div>
        <div className={css.desc}>{t(description)}</div>
      </div>
      <Switch
        checked={enabled}
        disabled={!writable}
        aria-labelledby={titleId}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          setSessionCost(event.target.checked)
        }}
      />
    </div>
  )
}
/* jscpd:ignore-end */