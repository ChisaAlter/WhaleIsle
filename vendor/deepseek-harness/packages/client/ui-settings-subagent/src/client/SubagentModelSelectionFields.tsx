/** User control for model-selectable subagent delegation in new sessions. */

import { useEffect, useState } from 'react'
import { Switch, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  SubagentModelCandidate,
  SubagentModelSelectionCardFace,
  SubagentModelSelectionCardState,
} from './subagent-model-selection-card-controller.ts'
import css from './SubagentModelSelectionFields.module.css'

/** Plain model state and callbacks supplied by the owning Subagent card. */
export type SubagentModelSelectionFieldsProps = PropsLocale<'settings.subagent'>
  & Pick<SubagentModelSelectionCardFace, 'toggleEnabled' | 'toggleModel' | 'retryCatalog' | 'discard'>
  & { state: SubagentModelSelectionCardState }

/**
 * Render the default-off preference and its exact adapter-route choices.
 * @param props - locale copy, the card snapshot, and its toggle action.
 * @returns the model permission and route choices inside the shared card.
 */
export function SubagentModelSelectionFields(props: SubagentModelSelectionFieldsProps) {
  const { t, state } = props
  const catalogFailed = state.enabled && state.catalogStatus === 'error'
  const notice = [
    catalogFailed ? t('subagentModelSelectionLoadFailed') : '',
    state.enabled && state.catalogPartial ? t('subagentModelSelectionPartial') : '',
    state.enabled && state.catalogStatus === 'ready' && state.candidates.length === 0
      ? t('subagentModelSelectionEmpty') : '',
    state.enabled && state.invalid ? t('subagentModelSelectionRequired') : '',
    state.conflicted ? t('subagentModelSelectionConflict') : '',
  ].filter(Boolean).join(' ')
  const [dismissedNotice, setDismissedNotice] = useState('')
  useEffect(() => { setDismissedNotice('') }, [notice])
  const availableGroups = new Map<string, {
    providerName: string
    candidates: SubagentModelCandidate[]
  }>()
  const unavailable: SubagentModelCandidate[] = []
  for (const candidate of state.candidates) {
    if (!candidate.available) {
      unavailable.push(candidate)
      continue
    }
    const group = availableGroups.get(candidate.provider)
    if (group === undefined) {
      availableGroups.set(candidate.provider, {
        providerName: candidate.providerName,
        candidates: [candidate],
      })
    } else {
      group.candidates.push(candidate)
    }
  }
  const renderCandidate = (candidate: SubagentModelCandidate) => (
    <label key={candidate.key} className={css.model}>
      <input
        type="checkbox"
        checked={candidate.selected}
        disabled={!state.writable || state.saving}
        onChange={() => { props.toggleModel(candidate.key) }}
      />
      <span>
        <span className={css.modelName}>{candidate.modelName}</span>
        <span className={css.route}>{`${candidate.providerName} · ${candidate.provider}/${candidate.model}`}</span>
      </span>
      {!candidate.available
        ? <span className={css.unavailable}>{t('subagentModelSelectionUnavailable')}</span>
        : null}
    </label>
  )
  return (
    <>
      <div className={css.permission}>
        <div className={css.toggleRow}>
          <span className={css.toggleLabel}>{t('subagentModelSelectionToggle')}</span>
          <Switch
            checked={state.enabled}
            label={t('subagentModelSelectionToggle')}
            disabled={!state.writable || state.saving}
            loading={state.saving || state.catalogStatus === 'loading'}
            onChange={props.toggleEnabled}
          />
        </div>
        <p className={css.hint}>
          {t(state.enabled ? 'subagentModelSelectionChoose' : 'subagentModelSelectionOff')}
        </p>
      </div>
      {state.enabled
        ? (
          <div className={css.selection}>
            {state.candidates.length > 0
              ? (
                <fieldset className={css.models}>
                  <legend>{t('subagentModelSelectionAllowed')}</legend>
                  {[...availableGroups].map(([provider, group]) => (
                    <div key={provider} className={css.modelGroup}>
                      <div className={css.providerName}>{group.providerName}</div>
                      {group.candidates.map(renderCandidate)}
                    </div>
                  ))}
                  {unavailable.length > 0
                    ? (
                      <div className={css.modelGroup}>
                        <div className={css.providerName}>{t('subagentModelSelectionUnavailableGroup')}</div>
                        {unavailable.map(renderCandidate)}
                      </div>
                    )
                    : null}
                </fieldset>
              )
              : null}
          </div>
        )
        : null}
      {notice && notice !== dismissedNotice ? <Toast key={notice} text={notice} holdMs={null}
        {...catalogFailed ? {} : { dismissLabel: t('dismissFeedback') }}
        actions={[
          ...catalogFailed ? [{ label: t('subagentModelSelectionRetry'), onClick: () => {
            if (!state.saving) props.retryCatalog()
          } }] : [],
          ...state.conflicted ? [{ label: t('discardDraft'), onClick: props.discard }] : [],
        ]}
        onDone={() => { setDismissedNotice(notice) }} /> : null}
    </>
  )
}
