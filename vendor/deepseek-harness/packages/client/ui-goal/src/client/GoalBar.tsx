/**
 * GoalBar: the goal indicator docked above the message composer (input dock
 * strip). A present goal shows a goal glyph, a phase label, the truncated
 * objective, and icon actions — resume when active-disarmed or paused, edit
 * (inline form in the same strip), and clear. Goal creation lives on the
 * `/goal` command, not here: loading (undefined), no goal (null), and complete
 * goals render nothing. Durable state arrives as the projected whole snapshot;
 * process-local activation arrives through the injected activation hook.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { GoalActivation, GoalSnapshot } from '@deepseek-ai/dsh-goal/client'
import {
  IconCheckOutlineRegular, IconCloseOutlineRegular, IconEditOutlineRegular, IconGoalOutlineRegular,
  Button, IconPauseOutlineRegular, IconPlayOutlineRegular, IconTrashOutlineRegular, InlineEditor, Tooltip, usePresence,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { GoalActionResult, GoalBarActions, GoalBarInjected } from './slots.ts'
import type { GoalKey } from './locales.ts'
import css from './GoalBar.module.css'

export interface GoalBarProps extends GoalBarActions {
  /** Current goal snapshot; undefined = capability absent or loading, null = no goal set. */
  goal: GoalSnapshot | null | undefined
  /** Process-local continuation activation; absent while the live read is pending. */
  activation?: GoalActivation
}

/** Strip label keys per visible phase; complete goals render nothing. */
const PHASE_LABELS = {
  active: 'phase.active',
  paused: 'phase.paused',
  blocked: 'phase.blocked',
} as const satisfies Record<string, GoalKey>

/** Strip label for an active goal using its process-local activation. */
function activeLabel(activation: GoalActivation | undefined, t: TranslateNS<'goal'>): string {
  if (activation === 'disarmed') return t('phase.active.disarmed')
  return t(PHASE_LABELS.active)
}

export function GoalBar({ goal, activation, onEdit, onPause, onResume, onClear, t }: GoalBarProps & PropsLocale<'goal'>) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [pendingAction, setPendingAction] = useState<'save' | 'clear' | 'pause' | 'resume'>()
  const [actionError, setActionError] = useState<string | null>(null)
  const [clearedGoalId, setClearedGoalId] = useState<GoalSnapshot['id'] | null>(null)
  const pendingRef = useRef(false)

  // A new goal identity (cleared/completed/replaced externally) invalidates the local edit
  // state: without the reset a surviving draft's Enter would write over the NEW goal.
  const goalId = goal?.id
  useEffect(() => {
    setEditing(false)
    setActionError(null)
    setClearedGoalId(null)
  }, [goalId])

  // React state disables the controls on the next render; the ref closes the
  // same-render window so rapid clicks cannot submit the same CAS twice.
  const runAction = useCallback(async (kind: 'save' | 'clear' | 'pause' | 'resume', action: () => Promise<GoalActionResult>): Promise<GoalActionResult | undefined> => {
    if (pendingRef.current) return undefined
    pendingRef.current = true
    setPending(true)
    setPendingAction(kind)
    setActionError(null)
    const result = await action()
    pendingRef.current = false
    setPending(false)
    setPendingAction(undefined)
    if (!result.ok) setActionError(`${result.error.message} (${result.error.code})`)
    return result
  }, [])

  const handleEdit = useCallback(async () => {
    const trimmed = draft.trim()
    if (trimmed === '') return
    const result = await runAction('save', () => onEdit(trimmed))
    if (result?.ok) setEditing(false)
  }, [draft, onEdit, runAction])

  const handleClear = useCallback(async (clearedId: GoalSnapshot['id']) => {
    const result = await runAction('clear', onClear)
    if (result?.ok) setClearedGoalId(clearedId)
  }, [onClear, runAction])

  const open = goal !== undefined && goal !== null && goal.phase !== 'complete' && goal.id !== clearedGoalId
  const presence = usePresence(open)
  const retained = useRef<{ goal: GoalSnapshot; label: string; showResume: boolean; activation: GoalActivation | undefined } | null>(null)
  const current = open ? {
    goal,
    label: goal.phase === 'active' ? activeLabel(activation, t) : t(PHASE_LABELS[goal.phase]),
    showResume: goal.phase === 'paused' || (goal.phase === 'active' && activation === 'disarmed'),
    activation,
  } : null
  if (current !== null) retained.current = current
  const displayed = current ?? retained.current
  if (!presence.mounted || displayed === null) return null
  const visibleGoal = displayed.goal

  return (
    <div className={css.dock} data-goal-bar data-state={presence.state} aria-hidden={open ? undefined : true} {...open ? {} : { inert: '' }}>
      <div className={css.clip}>
        <div className={css.surface} data-state={presence.state}>
          {editing && open ? (
            <div className={`${css.bar} ${css.editBar}`}>
              <div className={css.content}>
                <InlineEditor
                  value={draft}
                  label={t('objective.aria')}
                  onChange={setDraft}
                  onSave={() => { void handleEdit() }}
                  onCancel={() => { setEditing(false) }}
                />
                {actionError !== null && <span className={css.error} role="alert">{actionError}</span>}
                <div className={css.actions}>
                  <Tooltip portal label={t('action.save')} side="bottom" delayMs={500}>
                    <Button
                      type="button"
                      className={css.iconBtn}
                      onClick={() => { void handleEdit() }}
                      disabled={pending || draft.trim() === ''}
                      loading={pendingAction === 'save'}
                      aria-label={t('action.save')}
                    >
                      <IconCheckOutlineRegular size={14} />
                    </Button>
                  </Tooltip>
                  <Tooltip portal label={t('action.cancel')} side="bottom" delayMs={500}>
                    <button
                      type="button"
                      className={css.iconBtn}
                      onClick={() => { setEditing(false) }}
                      disabled={pending}
                      aria-label={t('action.cancel')}
                    >
                      <IconCloseOutlineRegular size={14} />
                    </button>
                  </Tooltip>
                </div>
              </div>
            </div>
          ) : (
            <div className={css.bar} title={visibleGoal.phase === 'blocked' ? visibleGoal.blockedReason?.message : undefined}>
              <div className={css.content}>
                <span className={css.goalGlyph}><IconGoalOutlineRegular size={14} /></span>
                <span className={css.label}>{displayed.label}</span>
                <span className={css.objective}>{visibleGoal.objective}</span>
                {actionError !== null && <span className={css.error} role="alert">{actionError}</span>}
                <div className={css.actions}>
                  {visibleGoal.phase === 'active' && displayed.activation === 'armed' && (
                    <Tooltip portal label={t('action.pause')} side="bottom" delayMs={500}>
                      <Button type="button" className={css.iconBtn} disabled={pending} loading={pendingAction === 'pause'} onClick={() => { void runAction('pause', onPause) }} aria-label={t('action.pause')}>
                        <IconPauseOutlineRegular size={14} />
                      </Button>
                    </Tooltip>
                  )}
                  {displayed.showResume && (
                    <Tooltip portal label={t('action.resume')} side="bottom" delayMs={500}>
                      <Button type="button" className={css.iconBtn} disabled={pending} loading={pendingAction === 'resume'} onClick={() => { void runAction('resume', onResume) }} aria-label={t('action.resume')}>
                        <IconPlayOutlineRegular size={14} />
                      </Button>
                    </Tooltip>
                  )}
                  <Tooltip portal label={t('action.edit')} side="bottom" delayMs={500}>
                    <button
                      type="button"
                      className={css.iconBtn}
                      disabled={pending}
                      onClick={() => { setDraft(visibleGoal.objective); setEditing(true) }}
                      aria-label={t('action.edit')}
                    >
                      <IconEditOutlineRegular size={14} />
                    </button>
                  </Tooltip>
                  <Tooltip portal label={t('action.clear')} side="bottom" delayMs={500}>
                    <Button type="button" className={css.iconBtn} disabled={pending} loading={pendingAction === 'clear'} onClick={() => { void handleClear(visibleGoal.id) }} aria-label={t('action.clear')}>
                      <IconTrashOutlineRegular size={14} />
                    </Button>
                  </Tooltip>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Full props of the dock entry: InputZone owner share + injected verbs/activation hook + the locale seat. */
export type GoalDockProps =
  import('@deepseek-ai/dsh-client-ui-slots').PropsRuntime<'conversation.input.dock'>
  & InjectFace<GoalBarInjected>
  & PropsLocale<'goal'>

/** Dock adapter: overlays process-local activation on the durable goal projection. */
export function GoalDock({
  useProjection, useGoalActivation, onEdit, onPause, onResume, onClear, t,
}: GoalDockProps) {
  const projection = useProjection('goal')
  const goal = projection === undefined || projection === null ? projection : projection.goal
  const goalId = goal?.id
  const revision = goal?.revision
  const activation = useGoalActivation(next => (
    next.id === goalId && next.revision === revision ? next.activation : undefined
  ))

  return (
    <GoalBar
      goal={goal}
      {...activation === undefined ? {} : { activation }}
      onEdit={onEdit}
      onPause={onPause}
      onResume={onResume}
      onClear={onClear}
      t={t}
    />
  )
}
