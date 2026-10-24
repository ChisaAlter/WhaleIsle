/** Interface Settings row for built-in next-prompt suggestions. */
import { useId, type ChangeEvent } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './BeamRow.module.css'

/** Registration-side preference face. */
export interface NextPromptRowInjected {
  hooks: {
    /** Persisted next-prompt preference bound as useNextPrompt. */
    nextPrompt: SnapshotStore<boolean>
    /** Host writability bound as useWritable. */
    writable: SnapshotStore<boolean>
  }
  /** Enable or disable next-prompt suggestions. */
  setNextPrompt: (value: boolean) => void
}

/** Full Settings-row props. */
export type NextPromptRowProps =
  PropsRuntime<'settings.conversation.item'>
  & PropsLocale<'conversation'>
  & InjectFace<NextPromptRowInjected>

/**
 * Render the next-prompt Switch using the existing Interface settings row.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
/* jscpd:ignore-start */
export function NextPromptRow({
  useNextPrompt, useWritable, setNextPrompt, t,
}: NextPromptRowProps) {
  const enabled = useNextPrompt(value => value)
  const writable = useWritable(value => value)
  const titleId = useId()
  const hintId = useId()

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title} id={titleId}>{t('settings.nextPrompt.label')}</div>
        <div className={css.desc} id={hintId}>{t('settings.nextPrompt.hint')}</div>
      </div>
      <Switch
        checked={enabled}
        disabled={!writable}
        aria-labelledby={titleId}
        aria-describedby={hintId}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          setNextPrompt(event.target.checked)
        }}
      />
    </div>
  )
}
/* jscpd:ignore-end */
