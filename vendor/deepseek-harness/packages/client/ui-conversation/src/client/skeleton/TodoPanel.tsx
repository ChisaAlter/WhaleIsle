import { useEffect, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// The domain's client-namespace pure-type outlet: one import edge delivers
// the `todos` projection-key merge (single source, no consumer-side restated
// declare) and the payload type. Type-only by construction — the outlet is
// free of host value imports, so no host Context merge enters this program.
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo/client'
import {
  TaskDock, StateDot,
  type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { NS } from '../locales.ts'
import css from './TodoPanel.module.css'

export interface TodoPanelProps {
  /** The session's current plan (empty renders nothing) — selected by the dock adapter. */
  todos: readonly TodoItem[]
  /** The dock entry's locale seat, passed down as a plain prop. */
  t: TodoDockProps['t']
}

/** Local exhaustiveness helper — client packages do not depend on `dsh-llm`. */
/* v8 ignore next 3 -- closed-union backstop; only reached if status is forged */
function assertNever(value: never): never {
  throw new Error(`unreachable todo status: ${String(value)}`)
}

/** Map Todo lifecycle state onto the shared compact status language. */
function statusDotState(status: TodoItem['status']): StateDotState {
  switch (status) {
    case 'completed': return 'done'
    case 'in_progress': return 'ongoing'
    case 'pending': return 'idle'
    /* v8 ignore next -- closed TodoItem status union */
    default: return assertNever(status)
  }
}

/** Return the localized status announced beside one decorative marker. */
function statusLabel(status: TodoItem['status'], t: TodoPanelProps['t']): string {
  switch (status) {
    case 'completed': return t('todo.status.completed')
    case 'in_progress': return t('todo.status.inProgress')
    case 'pending': return t('todo.status.pending')
    /* v8 ignore next -- closed TodoItem status union */
    default: return assertNever(status)
  }
}

/** Header summary: "·"-joined per-status counts; zero-count segments are omitted as noise (a non-empty list keeps at least one). */
function progressLabel(todos: readonly TodoItem[], t: TodoPanelProps['t']): string {
  const done = todos.filter(item => item.status === 'completed').length
  const active = todos.filter(item => item.status === 'in_progress').length
  const pending = todos.length - done - active
  // En spaces (U+2002): HTML collapses runs of ASCII spaces, so widening the
  // separator breathing room needs a literal wide space.
  return [
    ...done > 0 ? [t('todo.progress.done', { done })] : [],
    ...active > 0 ? [t('todo.progress.active', { active })] : [],
    ...pending > 0 ? [t('todo.progress.pending', { pending })] : [],
  ].join('\u2002·\u2002')
}

export function TodoPanel({ todos, t }: TodoPanelProps) {
  const retained = useRef(todos)
  const open = todos.length > 0
  if (open) retained.current = todos
  const displayed = open ? todos : retained.current

  return (
    <TaskDock open={open} title={t('todo.title')} summary={progressLabel(displayed, t)} testId="todo-panel">
      <ul className={css.list}>
        {displayed.map(item => (
          <li key={item.content} className={css.item} data-status={item.status}>
            <span className={css.glyph} role="img" aria-label={statusLabel(item.status, t)}>
              <StateDot state={statusDotState(item.status)} />
            </span>
            <span className={css.content}>{item.content}</span>
          </li>
        ))}
      </ul>
    </TaskDock>
  )
}

/** Longest a send keeps the plan on its way out before the plan is shown again. */
const SEND_EXIT_MAX_MS = 8000
/** How long the plan stays on its way out once the echo is gone, waiting for the turn start to clear it. */
const SEND_EXIT_GRACE_MS = 1000

/**
 * Start the plan's exit with the send itself. The Host clears the plan when the turn starts,
 * a round trip after the click (130 ms and up, much more while a long transcript is busy), so
 * waiting for it starts the exit late and on the busiest frames. The composer registers a
 * submission echo on the click's own frame; a new echo that lands on a standing plan starts the
 * exit there. If the turn never starts (a command that runs none, a rejected prompt) the plan
 * comes back. A plan written after the echo is never held back.
 * @param planned - whether the projection holds a plan.
 * @param sending - whether an idle send's echo is on the transcript.
 * @returns whether the plan should already be leaving.
 */
function usePlanLeavingOnSend(planned: boolean, sending: boolean): boolean {
  const leaving = useRef(false)
  const wasSending = useRef(false)
  const [, release] = useState(0)
  if (sending && !wasSending.current && planned) leaving.current = true
  wasSending.current = sending
  if (!planned) leaving.current = false
  useEffect(() => {
    if (!leaving.current) return
    const timer = setTimeout(() => {
      leaving.current = false
      release(count => count + 1)
    }, sending ? SEND_EXIT_MAX_MS : SEND_EXIT_GRACE_MS)
    return () => { clearTimeout(timer) }
  }, [sending])
  return leaving.current
}

/** Session metadata and projected plan read by the native todo dock. */
export type TodoDockProps = Pick<PropsRuntime<'conversation.input.dock'>,
  'sessionId' | 'useSession' | 'useSessions' | 'useProjection'> & PropsLocale<'conversation'>

/** Project Leads expose the same plan in their requirement details instead of above the input. */
export function TodoDock({ sessionId, useSession, useSessions, useProjection, t }: TodoDockProps) {
  const projectLead = useSessions((value) => {
    const presentation = value.byId[sessionId]?.presentation
    return presentation?.owner === 'project' && presentation.composer !== 'managed'
  })
  const todos = useProjection('todos') ?? []
  const sending = useSession(session => session.pendingSubmissions.some(submission => submission.placement === 'transcript'))
  const leaving = usePlanLeavingOnSend(todos.length > 0, sending)
  return projectLead ? null : <TodoPanel todos={leaving ? [] : todos} t={t} />
}

/** Registers the projected todo dock. */
export const todoDockEntry = {
  name: 'conversation-todo-dock',
  inject: ['slots'],
  apply(ctx: Context): void {
    ctx.slots.inject('conversation.input.dock', () =>
      ctx.slots.register({ name: 'conversation.input.dock', id: 'todo', order: 0, locale: NS }, TodoDock))
  },
}
