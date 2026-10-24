/** General Settings block for the standing custom-instructions preference. */
import type { ChangeEvent } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { CUSTOM_INSTRUCTIONS_MAX_LENGTH } from '../../submission-settings.ts'
import type { ConversationKey } from '../locales.ts'
import css from './CustomInstructionsRow.module.css'

/** Registration-side preference face. */
export interface CustomInstructionsRowInjected {
  hooks: {
    /** Persisted instructions text bound as useCustomInstructions. */
    customInstructions: SnapshotStore<string>
    /** Host writability bound as useWritable. */
    writable: SnapshotStore<boolean>
  }
  /** Replace the standing instructions text. */
  setCustomInstructions: (text: string) => void
}

/** Full Settings-row props. */
export type CustomInstructionsRowProps =
  PropsRuntime<'settings.conversation.item'>
  & PropsLocale<'conversation'>
  & InjectFace<CustomInstructionsRowInjected>

/**
 * Render the custom-instructions editor with its character counter.
 * @param props - composed Settings slot props.
 * @returns the preference block.
 */
export function CustomInstructionsRow({
  useCustomInstructions, useWritable, setCustomInstructions, t,
}: CustomInstructionsRowProps) {
  const text = useCustomInstructions(value => value)
  const writable = useWritable(value => value)
  const title: ConversationKey = 'settings.customInstructions.title'

  return (
    <div className={css.block}>
      <div className={css.blockText}>
        <div className={css.title}>{t(title)}</div>
        <div className={css.desc}>{t('settings.customInstructions.description')}</div>
      </div>
      <textarea
        className={css.textarea}
        aria-label={t(title)}
        placeholder={t('settings.customInstructions.placeholder')}
        value={text}
        maxLength={CUSTOM_INSTRUCTIONS_MAX_LENGTH}
        disabled={!writable}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
          setCustomInstructions(event.target.value)
        }}
      />
      <div className={css.counter}>
        {t('settings.customInstructions.counter', { count: text.length, max: CUSTOM_INSTRUCTIONS_MAX_LENGTH })}
      </div>
    </div>
  )
}
