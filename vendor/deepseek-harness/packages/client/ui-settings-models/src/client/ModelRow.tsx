/** Shared model fields and actions for both adapter catalog editors. */

import { useId, type ReactNode } from 'react'
import {
  Button, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconTrashOutlineRegular,
  Input, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { DeepSeekModelDraft, DeepSeekModelsValidationFailure } from './DeepSeekModelsEditor.tsx'
import type { ModelsKey } from './locales.ts'
import { ModelInputTypes } from './ModelInputTypes.tsx'
import { ModelReasoningEfforts } from './ModelReasoningEfforts.tsx'
import type { ReasoningEffortsFailure } from './ModelReasoningEfforts.tsx'
import styles from './ModelsSection.module.css'

/** A capacity's editable text and adapter-specific inherited hint. */
interface CapacityInput {
  value: string
  placeholder: string
  onChange: (value: string) => void
  onBlur?: () => void
}

/** Adapter-owned data and actions for one model row. */
interface ModelRowProps {
  model: DeepSeekModelDraft
  position: number
  inputField: 'inputModalities' | 'input'
  inputFallback?: readonly string[] | undefined
  inputLoading?: boolean
  /** Levels the row's `reasoningEfforts` may declare; absent or empty shows no reasoning control. */
  reasoningLevels?: readonly string[] | undefined
  expanded: boolean
  disabled: boolean
  validation?: DeepSeekModelsValidationFailure | ReasoningEffortsFailure | undefined
  t: (key: ModelsKey) => string
  contextWindow: CapacityInput
  maxTokens: CapacityInput
  onFieldChange: (field: 'id' | 'name', value: string | undefined) => void
  onIdBlur?: (value: string) => void
  onChange: (model: DeepSeekModelDraft) => void
  /** Optional adapter-specific controls that remain visible beside shared fields. */
  extra?: ReactNode
  onToggle: () => void
  onRemove: () => void
}

/**
 * Render consistent model identity, capacity, and input-type controls.
 * @param props - drafted fields and their owning editor's actions.
 * @returns one expandable model entry.
 */
export function ModelRow(props: ModelRowProps): ReactNode {
  const { model, position, t, disabled } = props
  const errorId = useId()
  const optionsId = useId()
  const validation = props.validation?.index === position - 1 ? props.validation : undefined
  const invalidField = validation === undefined ? undefined
    : validation.key === 'modelIdRequired' || validation.key === 'modelIdDuplicate' ? 'id'
      : validation.key === 'modelNameInvalid' ? 'name'
        : validation.key === 'modelContextInvalid' ? 'contextWindow'
          : validation.key === 'modelMaxTokensInvalid' ? 'maxTokens' : 'reasoningEfforts'
  const error = validation === undefined ? '' : `${t('model')} ${String(position)}: ${t(validation.key)}`
  return (
    <div className={styles['modelEntry']}>
      {validation === undefined ? null : <span className={styles['visuallyHidden']} id={errorId}>{error}</span>}
      <div className={styles['modelRow']}>
        {(['id', 'name'] as const).map(field => (
          <Tooltip key={field} label={error} disabled={invalidField !== field} portal side="bottom">
            <Input variant="form"
              className={styles['input']}
              type="text"
              value={typeof model[field] === 'string' ? model[field] : ''}
              placeholder={t(field === 'id' ? 'modelId' : 'modelName')}
              aria-label={`${t(field === 'id' ? 'modelId' : 'modelName')} ${String(position)}`}
              aria-invalid={invalidField === field}
              aria-describedby={invalidField === field ? errorId : undefined}
              disabled={disabled}
              onChange={(event) => {
                const value = event.target.value
                props.onFieldChange(field, field === 'name' && value === '' ? undefined : value)
              }}
              onBlur={field === 'id' ? event => props.onIdBlur?.(event.target.value) : undefined}
            />
          </Tooltip>
        ))}
        <Tooltip label={invalidField === 'contextWindow' || invalidField === 'maxTokens' ? error : t('modelAdvanced')} portal>
          <Button size="sm" className={styles['iconButton']}
            icon={props.expanded ? <IconChevronDownOutlineRegular size={16} /> : <IconChevronRightOutlineRegular size={16} />}
            aria-label={`${t('modelAdvanced')} ${String(position)}`}
            aria-expanded={props.expanded} aria-controls={optionsId}
            aria-describedby={invalidField === 'contextWindow' || invalidField === 'maxTokens' ? errorId : undefined}
            onClick={props.onToggle}
          />
        </Tooltip>
        <Tooltip label={t('removeModel')} portal>
          <Button size="sm" className={`${styles['iconButton']} ${styles['iconButtonDanger']}`}
            icon={<IconTrashOutlineRegular size={16} />}
            aria-label={`${t('removeModel')} ${String(position)}`}
            disabled={disabled} onClick={props.onRemove}
          />
        </Tooltip>
      </div>
      {props.expanded
        ? (
          <div className={styles['modelAdvanced']} id={optionsId}>
            {(['contextWindow', 'maxTokens'] as const).map(field => (
              <label className={styles['modelField']} key={field}>
                <span className={styles['modelFieldLabel']}>{t(field)}</span>
                <Tooltip label={error} disabled={invalidField !== field} portal side="bottom">
                  <Input variant="form"
                    className={styles['input']}
                    type="text"
                    inputMode="numeric"
                    value={props[field].value}
                    placeholder={props[field].placeholder}
                    aria-label={`${t(field)} ${String(position)}`}
                    aria-invalid={invalidField === field}
                    aria-describedby={invalidField === field ? errorId : undefined}
                    disabled={disabled}
                    onChange={(event) => { props[field].onChange(event.target.value) }}
                    onBlur={props[field].onBlur}
                  />
                </Tooltip>
              </label>
            ))}
            <ModelInputTypes
              model={model} field={props.inputField} position={position}
              fallback={props.inputFallback} disabled={disabled || props.inputLoading === true} t={t} onChange={props.onChange}
            />
            {props.reasoningLevels !== undefined && props.reasoningLevels.length > 0
              ? (
                <ModelReasoningEfforts
                  model={model} levels={props.reasoningLevels} position={position} disabled={disabled} t={t} onChange={props.onChange}
                />
              )
              : null}
          </div>
        )
        : null}
      {props.extra}
    </div>
  )
}
