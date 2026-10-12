/** Host policies and durable cold storage for managed Teams. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { TeamJournal } from './journal.ts'
import type { TeamMessageSnapshot, TeamTaskId, TeamMessageId } from './types.ts'
import { TeamId } from './types.ts'
import { TeamError } from './error.ts'
import { teamControlEventSchema } from './control.ts'

/** Runtime authorization is selected by a durable Lead-log binding. */
export interface TeamPolicy {
  /** Check a mutation or delivery before it enters the native runtime. */
  admit(root: Agent, operation: string, value: unknown): Promise<void>
}

/** Owns policy bindings, inactive capacity and mailbox cancellation. */
export class TeamManagement {
  private readonly policies = new Map<string, TeamPolicy>()
  constructor(private readonly journal: TeamJournal, private readonly maxMembers: number, private readonly maxTasks: number) {}

  /** Register the host implementation selected by persisted policy id. */
  register(id: string, policy: TeamPolicy): () => void {
    if (this.policies.has(id)) throw new TeamError('Team policy already registered', 'TEAM_POLICY_EXISTS')
    this.policies.set(id, policy)
    return () => { if (this.policies.get(id) === policy) this.policies.delete(id) }
  }

  /** Read management facts from the exact Lead, excluding inherited events. */
  state(root: Agent): { policy?: string; coldMembers: Set<SessionId>; coldTasks: Set<TeamTaskId>; cancelled: Set<TeamMessageId>; contexts: Map<TeamMessageId, { senderAssignment: string; targetAssignment: string }> } {
    const value: ReturnType<TeamManagement['state']> = { coldMembers: new Set(), coldTasks: new Set(), cancelled: new Set(), contexts: new Map() }
    // oxlint-disable-next-line typescript/no-deprecated -- Host management reads its own append-only suffix.
    for (const event of root.session.snapshotEvents(root.session.inheritedEventCount)) {
      if (event.type !== 'team/control' || event.data.teamId !== TeamId(root.id)) continue
      if (event.data.version !== 1) throw new TeamError('Unsupported Team control version', 'TEAM_CONTROL_VERSION')
      const control = teamControlEventSchema.parse(event.data).control
      if (control.kind === 'policy') {
        if (value.policy !== undefined && value.policy !== control.policy) throw new TeamError('Team policy changed', 'TEAM_POLICY_CONFLICT')
        value.policy = control.policy
      } else if (control.kind === 'cold') {
        if (control.cold) { value.coldMembers.add(control.memberId); value.coldTasks.add(control.taskId) }
        else { value.coldMembers.delete(control.memberId); value.coldTasks.delete(control.taskId) }
      } else if (control.kind === 'cancel') value.cancelled.add(control.messageId)
      else if (control.kind === 'message-context') value.contexts.set(control.messageId, { senderAssignment: control.senderAssignment, targetAssignment: control.targetAssignment })
      else if (control.kind !== 'retry-member') throw new TeamError('Invalid Team control', 'TEAM_CONTROL_INVALID')
    }
    return value
  }

  /** Persist an immutable policy before any managed member or queued message. */
  async bind(root: Agent, policy: string): Promise<void> {
    await this.journal.transact(root.id, async () => {
      const current = this.state(root).policy
      if (current === policy) return
      if (current !== undefined || !this.policies.has(policy)) throw new TeamError('Team policy unavailable or conflicting', 'TEAM_POLICY_CONFLICT')
      await this.journal.appendAndFlush(root, 'team/control', { version: 1, teamId: TeamId(root.id), control: { kind: 'policy', policy } })
    })
  }

  /** Missing managed policy denies execution while preserving read access. */
  async admit(root: Agent, operation: string, value: unknown): Promise<void> {
    const binding = this.state(root).policy
    if (binding === undefined) return
    const policy = this.policies.get(binding)
    if (policy === undefined) throw new TeamError('Managed Team host is unavailable', 'TEAM_POLICY_UNAVAILABLE')
    await policy.admit(root, operation, value)
  }

  /** Cold records retain identities and task status but release active capacity. */
  async setCold(root: Agent, memberId: SessionId, taskId: TeamTaskId, cold: boolean): Promise<void> {
    await this.admit(root, 'cold', { memberId, taskId, cold })
    await this.journal.transact(root.id, async () => {
      const state = this.state(root)
      const team = this.journal.state(root)
      if (!cold && state.coldMembers.has(memberId) && team.members.filter(member => !state.coldMembers.has(member.id)).length >= this.maxMembers) throw new TeamError('Active Team member capacity reached', 'TEAM_MEMBER_LIMIT')
      if (!cold && state.coldTasks.has(taskId) && team.tasks.filter(task => task.status !== 'deleted' && !state.coldTasks.has(task.id)).length >= this.maxTasks) throw new TeamError('Active Team task capacity reached', 'TEAM_TASK_LIMIT')
      if (state.coldMembers.has(memberId) === cold && state.coldTasks.has(taskId) === cold) return
      await this.journal.appendAndFlush(root, 'team/control', { version: 1, teamId: TeamId(root.id), control: { kind: 'cold', memberId, taskId, cold } })
    })
  }

  /** Commit a host-verified assignment association before queueing a peer message. */
  async bindMessage(root: Agent, messageId: TeamMessageId, senderAssignment: string, targetAssignment: string): Promise<void> {
    await this.journal.transact(root.id, async () => {
      const prior = this.state(root).contexts.get(messageId)
      if (prior !== undefined) {
        if (prior.senderAssignment !== senderAssignment || prior.targetAssignment !== targetAssignment) throw new TeamError('Message assignment changed', 'TEAM_MESSAGE_CONFLICT')
        return
      }
      await this.journal.appendAndFlush(root, 'team/control', { version: 1, teamId: TeamId(root.id), control: { kind: 'message-context', messageId, senderAssignment, targetAssignment } })
    })
  }

  /** Cancel queued work without claiming that the receiver consumed it. */
  async cancel(root: Agent, message: TeamMessageSnapshot): Promise<void> {
    await this.journal.transact(root.id, async () => {
      if (this.state(root).cancelled.has(message.id)) return
      await this.journal.appendAndFlush(root, 'team/control', { version: 1, teamId: TeamId(root.id), control: { kind: 'cancel', messageId: message.id } })
    })
  }
}
