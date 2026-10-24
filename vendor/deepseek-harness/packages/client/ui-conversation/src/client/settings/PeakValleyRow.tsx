/** Interface Settings row for the composer-dock official peak/valley status row. */
import { useId, type ChangeEvent } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationKey } from '../locales.ts'
import css from './BeamRow.module.css'

/** Registration-side preference face. */
export interface PeakValleySettingsRowInjected {
  hooks: {
    /** Persisted force-enable preference bound as usePeakValley. */
    peakValley: SnapshotStore<boolean>
    /** Host writability bound as useWritable. */
    writable: SnapshotStore<boolean>
  }
  /** Change whether the official peak/valley status row is force-enabled. */
  setPeakValley: (value: boolean) => void
}

/** Full Settings-row props. */
export type PeakValleySettingsRowProps =
  PropsRuntime<'settings.usage.item'>
  & PropsLocale<'conversation'>
  & InjectFace<PeakValleySettingsRowInjected>

/**
 * Render the official peak/valley Switch.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
/* jscpd:ignore-start */
export function PeakValleySettingsRow({
  usePeakValley, useWritable, setPeakValley, t,
}: PeakValleySettingsRowProps) {
  const enabled = usePeakValley(value => value)
  const writable = useWritable(value => value)
  const titleId = useId()
  const title: ConversationKey = 'settings.peakValley.title'
  const description: ConversationKey = 'settings.peakValley.description'

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
          setPeakValley(event.target.checked)
        }}
      />
    </div>
  )
}
/* jscpd:ignore-end */
