/** Display-only release marking; the catalog and selected route remain unchanged. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { FlipText, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './DeepSeekModelLabel.module.css'

const MODEL_NAME = 'DeepSeek-V4.1-Flash'

/**
 * Render the fixed 1017 release label for recognized official Flash entries.
 * @param props - Provider and model identity plus the badge dictionary.
 * @returns The base name with a badge, or the untouched catalog name.
 */
export function DeepSeekModelLabel({ provider, model, placement, t }:
  PropsRuntime<'conversation.input.model.label'> & PropsLocale<'deepseek-model-label-1017'>,
) {
  const official = provider.id === 'deepseek-account' || provider.id === 'deepseek-official'
  const name = placement === 'trigger' ? <FlipText className={css.name} text={model.name} /> : model.name
  const marked = official && model.id === 'deepseek-flash' && model.name === MODEL_NAME
  return <span className={css.label}>
    <span className={css.name}>{name}</span>{marked && <>{' '}<Tag tone="info">{t('badge.label')}</Tag></>}
  </span>
}
