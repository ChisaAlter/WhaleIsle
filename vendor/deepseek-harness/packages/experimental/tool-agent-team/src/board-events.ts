/**
 * Reactive Team task-board notifications and waiter wakeup coordinator.
 * Bridges durable `ctx.projectTeams` task transitions (`team_task_create` and
 * `team_task_update`) to active `wait_agent` callers, unread member queues,
 * and inactive teammates/Lead so board updates never silently deadlock.
 *
 * @module @deepseek-ai/dsh-experimental-tool-agent-team/board-events
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  TeamId,
  TeamMemberView,
  TeamTaskView,
} from '@deepseek-ai/dsh-experimental-agent-team'

const MAX_UNREAD_EVENTS_PER_MEMBER = 24

/** Supported board mutation kinds observed after durable task transitions. */
export type BoardEventKind =
  | 'task-created'
  | 'task-assigned'
  | 'task-unblocked'
  | 'task-completed'

/** Lightweight record of one board state transition. */
export interface BoardEvent {
  readonly kind: BoardEventKind
  readonly taskId: TeamTaskView['id']
  readonly subject: string
  readonly ownerName?: string | undefined
}

interface BoardWaiter {
  readonly memberId: SessionId
  readonly resolve: () => void
}

interface TeamBoardState {
  readonly waiters: Set<BoardWaiter>
  readonly unreadByMember: Map<SessionId, BoardEvent[]>
}

/** Task update transition verb matching `team_task_update`. */
export type BoardMutationAction =
  | 'create'
  | 'claim'
  | 'release'
  | 'edit'
  | 'set_dependencies'
  | 'complete'
  | 'reopen'
  | 'reassign'
  | 'delete'

/** Snapshot captured around a board mutation to compute transitions accurately. */
export interface BoardMutationContext {
  readonly action: BoardMutationAction
  readonly beforeTasks: readonly TeamTaskView[]
  readonly afterTasks: readonly TeamTaskView[]
  readonly updatedTask: TeamTaskView
  readonly signal: AbortSignal
}

/** Active waiter registration handle for `wait_agent`. */
export interface BoardWaitHandle {
  readonly promise: Promise<void>
  readonly dispose: () => void
}

/** Coordinates per-Team board events, waiter wakeups, and idle peer notifications. */
export class TeamBoardCoordinator {
  private readonly teams = new Map<TeamId, TeamBoardState>()

  constructor(private readonly ctx: Context) {}

  private ensureTeamState(teamId: TeamId): TeamBoardState {
    let state = this.teams.get(teamId)
    if (state === undefined) {
      state = {
        waiters: new Set(),
        unreadByMember: new Map(),
      }
      this.teams.set(teamId, state)
    }
    return state
  }

  /** Clear and return any unread board transitions queued for `memberId`. */
  consumeUnread(teamId: TeamId, memberId: SessionId): BoardEvent[] {
    const state = this.teams.get(teamId)
    if (state === undefined) return []
    const events = state.unreadByMember.get(memberId)
    if (events === undefined || events.length === 0) return []
    state.unreadByMember.delete(memberId)
    return events
  }

  /** Register a single-shot waiter that wakes on the next task-board mutation in `teamId`. */
  registerWaiter(teamId: TeamId, memberId: SessionId): BoardWaitHandle {
    const state = this.ensureTeamState(teamId)
    let settled = false
    let waiter!: BoardWaiter
    const promise = new Promise<void>((resolve) => {
      waiter = {
        memberId,
        resolve: () => {
          if (settled) return
          settled = true
          state.waiters.delete(waiter)
          resolve()
        },
      }
      state.waiters.add(waiter)
    })
    return {
      promise,
      dispose: () => {
        if (settled) return
        settled = true
        state.waiters.delete(waiter)
      },
    }
  }

  /** Dispose all tracked waiter handles when the owning plugin scope unloads. */
  disposeAll(): void {
    for (const state of this.teams.values()) {
      for (const waiter of state.waiters) waiter.resolve()
      state.waiters.clear()
      state.unreadByMember.clear()
    }
    this.teams.clear()
  }

  /**
   * Diff task state around a board mutation, wake waiting callers immediately,
   * record unread events for other idle peers, and send waking messages to
   * relevant inactive teammates or Lead.
   */
  async onBoardMutation(caller: Agent, mutation: BoardMutationContext): Promise<void> {
    const membership = this.ctx.projectTeams.membership(caller)
    const teamId = membership.id
    const state = this.ensureTeamState(teamId)
    const { action, beforeTasks, afterTasks, updatedTask, signal } = mutation

    const previousById = new Map(beforeTasks.map(task => [task.id, task]))
    const events: BoardEvent[] = []

    if (action === 'create' && updatedTask.ready) {
      events.push({
        kind: 'task-created',
        taskId: updatedTask.id,
        subject: updatedTask.subject,
        ownerName: updatedTask.ownerName,
      })
    }

    if (action === 'reassign' && updatedTask.ownerName !== undefined) {
      events.push({
        kind: 'task-assigned',
        taskId: updatedTask.id,
        subject: updatedTask.subject,
        ownerName: updatedTask.ownerName,
      })
    }

    if (action === 'complete') {
      const prev = previousById.get(updatedTask.id)
      if (prev?.status !== 'completed') {
        events.push({
          kind: 'task-completed',
          taskId: updatedTask.id,
          subject: updatedTask.subject,
          ownerName: updatedTask.ownerName,
        })
      }
    }

    for (const nextTask of afterTasks) {
      const prevTask = previousById.get(nextTask.id)
      if (prevTask !== undefined && !prevTask.ready && nextTask.ready) {
        events.push({
          kind: 'task-unblocked',
          taskId: nextTask.id,
          subject: nextTask.subject,
          ownerName: nextTask.ownerName,
        })
      }
    }

    // Resolve all currently waiting `wait_agent` callers in this team before sending
    // follow-up wakes so waiting members are not additionally steered via inbox.
    const wokenWaiterIds = new Set<SessionId>()
    for (const waiter of [...state.waiters]) {
      wokenWaiterIds.add(waiter.memberId)
      waiter.resolve()
    }

    const members = this.ctx.projectTeams.listMembers(caller)
    const wakeMessages = collectWakeMessages(caller, membership.name, membership.role, members, wokenWaiterIds, events)
    const deliveredTargetIds = new Set<SessionId>()
    if (wakeMessages.size > 0 && !signal.aborted) {
      const idByName = new Map(members.map(member => [member.name, member.id]))
      await Promise.all([...wakeMessages.entries()].map(async ([target, lines]) => {
        try {
          await this.ctx.projectTeams.sendMessage(caller, {
            target,
            content: [{ type: 'text', text: lines.join('\n') }],
            signal,
          })
          const targetId = idByName.get(target)
          if (targetId !== undefined) deliveredTargetIds.add(targetId)
        } catch (_error: unknown) {
          // Best-effort wakeup: target may have started stopping, failed, or caller aborted meanwhile.
        }
      }))
    }

    if (events.length > 0) {
      for (const member of members) {
        if (member.id === caller.id || wokenWaiterIds.has(member.id) || deliveredTargetIds.has(member.id)) continue
        const existing = state.unreadByMember.get(member.id) ?? []
        const combined = [...existing, ...events]
        state.unreadByMember.set(
          member.id,
          combined.length > MAX_UNREAD_EVENTS_PER_MEMBER
            ? combined.slice(combined.length - MAX_UNREAD_EVENTS_PER_MEMBER)
            : combined,
        )
      }
    }
  }
}

function collectWakeMessages(
  caller: Agent,
  callerName: string,
  callerRole: TeamMemberView['role'],
  members: readonly TeamMemberView[],
  wokenWaiterIds: ReadonlySet<SessionId>,
  events: readonly BoardEvent[],
): Map<string, string[]> {
  const byName = new Map(members.map(member => [member.name, member]))
  const targets = new Map<string, string[]>()

  const addMessage = (member: TeamMemberView | undefined, line: string): void => {
    if (member === undefined) return
    if (member.id === caller.id || member.status !== 'inactive' || wokenWaiterIds.has(member.id)) return
    const lines = targets.get(member.name)
    if (lines === undefined) targets.set(member.name, [line])
    else lines.push(line)
  }

  for (const event of events) {
    switch (event.kind) {
      case 'task-assigned': {
        if (event.ownerName !== undefined) {
          addMessage(
            byName.get(event.ownerName),
            `Task board notification: task ${event.taskId} ("${event.subject}") was assigned to you by ${callerName}. Use team_task_list / team_task_get to review and execute it.`,
          )
        }
        break
      }
      case 'task-created': {
        for (const member of members) {
          if (member.role === 'teammate') {
            addMessage(
              member,
              `Task board notification: new ready task ${event.taskId} ("${event.subject}") is available. Use team_task_list to inspect and claim available work.`,
            )
          }
        }
        break
      }
      case 'task-unblocked': {
        if (event.ownerName !== undefined) {
          addMessage(
            byName.get(event.ownerName),
            `Task board notification: your task ${event.taskId} ("${event.subject}") is now unblocked and ready to execute.`,
          )
        } else {
          for (const member of members) {
            if (member.role === 'teammate') {
              addMessage(
                member,
                `Task board notification: task ${event.taskId} ("${event.subject}") is now unblocked and ready to claim.`,
              )
            }
          }
        }
        break
      }
      case 'task-completed': {
        if (callerRole !== 'lead') {
          const lead = members.find(member => member.role === 'lead')
          addMessage(
            lead,
            `Task board notification: ${callerName} completed task ${event.taskId} ("${event.subject}").`,
          )
        }
        break
      }
    }
  }

  return targets
}
