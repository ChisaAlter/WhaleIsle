import { randomUUID } from 'node:crypto'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
/** Agent Teams service façade over roster, messaging, task, and runtime lifecycle owners. */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { TeamManagement } from './management.ts'
import type { TeamPolicy } from './management.ts'
export type { TeamPolicy } from './management.ts'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { steerHostSubagentPrompt } from '@deepseek-ai/dsh-subagent/internal'
import { TeamActivity } from './activity.ts'
import { errorMessage, TeamError } from './error.ts'
import { TeamJournal } from './journal.ts'
import { readPersistedSession } from './persisted.ts'
import { TeamRuntimeLifecycle } from './lifecycle.ts'
import { teamProjectionDefinition } from './projection.ts'
import { resolveActiveMember, TeamRoster } from './roster.ts'
import type { TeamMembership } from './roster.ts'
import { TeamTaskBoard } from './task-board.ts'
import { TeamId, TeamTaskId, TeamMessageId } from './types.ts'
import type {
  Config,
  CreateTeamTaskRequest,
  SendTeamMessageRequest,
  SendTeamMessageResult,
  SpawnTeammateRequest,
  SpawnTeammateResult,
  TeamMemberView,
  TeamTaskView,
  TeamWaitResult,
  UpdateTeamTaskRequest,
} from './types.ts'

export type * from './types.ts'
export type { TeamMembership } from './roster.ts'
export { TeamId, TeamMessageId, TeamTaskId } from './types.ts'
export { TeamError } from './error.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentTeams: TeamService
  }
}

const DEFAULT_MAX_MEMBERS = 16
const DEFAULT_MAX_TASKS = 256
const DEFAULT_MAX_MESSAGE_BYTES = 65_536
const DEFAULT_DISPOSAL_TIMEOUT_MS = 5_000

/** Validate one positive safe-integer deployment limit. */
function positiveLimit(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TeamError(`${name} must be a positive safe integer`, 'TEAM_INVALID_CONFIG')
  }
  return value
}

/** Agent Teams service backed by the exact live Lead Session log. */
export class TeamService extends Service {
  static inject = ['agents', 'sessions', 'sessionPersistence', 'sessionProjections', 'subagents']

  static Config: z<Config> = z.object({
    maxMembers: z.number().step(1).min(1).default(DEFAULT_MAX_MEMBERS),
    maxTasks: z.number().step(1).min(1).default(DEFAULT_MAX_TASKS),
    maxMessageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_MESSAGE_BYTES),
    disposalTimeoutMs: z.number().step(1).min(1).default(DEFAULT_DISPOSAL_TIMEOUT_MS),
  })

  /** Validated deployment limits used by every Team operation. */
  private readonly config: Required<Config>

  private readonly managedSends = new Map<TeamMessageId, Promise<SendTeamMessageResult>>()
  private readonly management: TeamManagement
  private readonly activity: TeamActivity
  private readonly lifecycle: TeamRuntimeLifecycle
  private readonly journal: TeamJournal
  private readonly roster: TeamRoster
  private readonly tasks: TeamTaskBoard

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'agentTeams')
    this.config = {
      maxMembers: positiveLimit('maxMembers', config.maxMembers ?? DEFAULT_MAX_MEMBERS),
      maxTasks: positiveLimit('maxTasks', config.maxTasks ?? DEFAULT_MAX_TASKS),
      maxMessageBytes: positiveLimit('maxMessageBytes', config.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES),
      disposalTimeoutMs: positiveLimit(
        'disposalTimeoutMs',
        config.disposalTimeoutMs ?? DEFAULT_DISPOSAL_TIMEOUT_MS,
      ),
    }

    this.activity = new TeamActivity()
    this.lifecycle = new TeamRuntimeLifecycle(this.config.disposalTimeoutMs)
    this.journal = new TeamJournal(ctx, (root) => { this.activity.notify(TeamId(root.id)) })
    this.management = new TeamManagement(this.journal, this.config.maxMembers, this.config.maxTasks)
    this.roster = new TeamRoster(ctx, this.journal, this.lifecycle, this.config.maxMembers, this.management)
    this.tasks = new TeamTaskBoard(this.journal, this.config.maxTasks, this.management)

    ctx.on('agent/created', ({ agent }) => { this.scheduleRecovery(agent) })
    ctx.on('agent/status', ({ agent }) => {
      const membership = this.roster.tryMembership(agent)
      if (membership !== undefined) this.activity.notify(membership.id)
    })
    ctx.effect(() => {
      const disposeProjection = ctx.root.sessionProjections.register(teamProjectionDefinition)
      return async () => {
        try {
          await this.disposeRuntime()
        } finally {
          disposeProjection()
        }
      }
    }, 'agentTeams.runtimeLifecycle()')
    for (const agent of ctx.agents.list()) this.scheduleRecovery(agent)
  }

  /**
   * Resolve one exact live Agent's Team role.
   * @param agent - exact live Agent used as the authority credential.
   * @returns its root, Team identity, role, and model-facing name.
   */
  membership(agent: Agent): TeamMembership {
    return this.roster.membership(agent)
  }

  /**
   * List the runtime-enriched roster visible to one Team member.
   * @param agent - exact live Team member.
   * @returns Lead and teammate rows in creation order.
   */
  listMembers(agent: Agent): TeamMemberView[] {
    return this.roster.list(this.roster.membership(agent))
  }

  /**
   * Create one named, continuable direct child of the Team Lead.
   * @param caller - exact live Lead Agent.
   * @param request - immutable name, description, prompt, context mode, provider, and cancellation.
   * @returns the active roster row.
   */
  async spawnTeammate(caller: Agent, request: SpawnTeammateRequest): Promise<SpawnTeammateResult> {
    await this.management.admit(this.roster.membership(caller).root, 'spawn', { caller, request })
    return await this.roster.spawn(caller, request)
  }

  /**
   * Steer one peer message into the target inbox or reject the attempt.
   * @param caller - exact live sending Team member.
   * @param request - target name, content, and cancellation before acceptance.
   * @returns accepted inbox identity; acceptance follows normal Agent persistence and does not await model processing.
   */
  async sendMessage(caller: Agent, request: SendTeamMessageRequest): Promise<SendTeamMessageResult> {
    if (this.lifecycle.disposed) throw new TeamError('Agent Teams service is disposing', 'TEAM_DISPOSED')
    return await this.lifecycle.track(this.sendAdmitted(caller, {
      ...request,
      signal: AbortSignal.any([request.signal, this.lifecycle.signal]),
    }))
  }

  /**
   * Create one unowned pending task in the Team Lead log.
   * @param caller - exact live Team member creating the task.
   * @param request - task text, blockers, and advisory write scopes.
   * @returns the revision-one task view.
   */
  async createTask(caller: Agent, request: CreateTeamTaskRequest): Promise<TeamTaskView> {
    return await this.tasks.create(this.roster.membership(caller), request)
  }

  /**
   * Return one task, including a deleted tombstone.
   * @param caller - exact live Team member reading the task.
   * @param id - Team-local task identity.
   * @returns the latest task value and derived readiness diagnostics.
   */
  getTask(caller: Agent, id: TeamTaskId): TeamTaskView {
    return this.tasks.get(this.roster.membership(caller), id)
  }

  /**
   * List current non-deleted tasks in numeric creation order.
   * @param caller - exact live Team member reading the board.
   * @returns detached current task views.
   */
  listTasks(caller: Agent): TeamTaskView[] {
    return this.tasks.list(this.roster.membership(caller))
  }

  /**
   * Compare-and-set one authorized task transition.
   * @param caller - exact live Team member authorizing the mutation.
   * @param request - task identity, expected revision, action, and action fields.
   * @returns the committed next task revision.
   */
  async updateTask(caller: Agent, request: UpdateTeamTaskRequest): Promise<TeamTaskView> {
    await this.management.admit(this.roster.membership(caller).root, 'task', { caller, request })
    return await this.tasks.update(caller, this.roster.membership(caller), request)
  }

  /**
   * Wait for the next Team-domain or member-status change.
   * @param caller - exact live Team member waiting for activity.
   * @param timeoutMs - bounded wait duration from ten seconds through one hour.
   * @param signal - caller cancellation for the wait only.
   * @returns one observed change or a timeout result.
   */
  async waitForChange(caller: Agent, timeoutMs: number, signal: AbortSignal): Promise<TeamWaitResult> {
    const membership = this.roster.membership(caller)
    return await this.activity.wait(membership.id, timeoutMs, signal)
  }

  /**
   * Interrupt one live teammate turn without clearing its pending inbox.
   * @param caller - exact live Lead Agent.
   * @param targetName - durable teammate name.
   * @returns the target status sampled before cancellation.
   */
  interrupt(caller: Agent, targetName: string): { previousStatus: 'running' | 'inactive' } {
    return this.roster.interrupt(caller, targetName)
  }

  /**
   * Resolve a caller without throwing, used by scoped-tool installation and observers.
   * @param agent - candidate exact live Agent.
   * @returns Team membership, or undefined for non-Team subagents and stale identities.
   */
  tryMembership(agent: Agent): TeamMembership | undefined {
    return this.roster.tryMembership(agent)
  }

  /** Register a managed Team host; the disposer leaves durable bindings fail-closed. */
  registerPolicy(id: string, policy: TeamPolicy): () => void { return this.management.register(id, policy) }

  /** Bind a root before creating its managed members. */
  async bindPolicy(root: Agent, id: string): Promise<void> { await this.management.bind(this.roster.membership(root).root, id) }

  /** Release or reclaim capacity without deleting history. */
  async setCold(root: Agent, memberId: import('@deepseek-ai/dsh-session').SessionId, taskId: import('./types.ts').TeamTaskId, cold: boolean): Promise<void> {
    await this.management.setCold(this.roster.membership(root).root, memberId, taskId, cold)
  }

  /** Read the original durable peer input, including cancelled history. */
  message(root: Agent, id: import('./types.ts').TeamMessageId): import('./types.ts').TeamMessageSnapshot | undefined {
    return this.journal.state(this.roster.membership(root).root).messages.find(message => message.id === id)
  }

  /** Revoke a stopped target's pending and accepted-but-unconsumed mailbox items. */
  async cancelMessages(root: Agent, targets: readonly import('@deepseek-ai/dsh-session').SessionId[]): Promise<void> {
    for (const message of this.journal.state(root).messages) if (targets.includes(message.targetId) || targets.includes(message.senderId)) await this.management.cancel(root, message)
  }

  /** Test cancellation at the receiver's final execution boundary. */
  messageCancelled(root: Agent, id: import('./types.ts').TeamMessageId): boolean { return this.management.state(root).cancelled.has(id) }

  /** Persist peer input scope before enqueueing. */
  async bindMessage(root: Agent, messageId: import('./types.ts').TeamMessageId, senderAssignment: string, targetAssignment: string): Promise<void> { await this.management.bindMessage(root, messageId, senderAssignment, targetAssignment) }

  /** Read the immutable scope attached by the managed host. */
  messageContext(root: Agent, id: import('./types.ts').TeamMessageId): { senderAssignment: string; targetAssignment: string } | undefined { return this.management.state(root).contexts.get(id) }

  /** Adopt only an existing continuation verified against its durable descriptor. */
  async adoptMember(root: Agent, request: SpawnTeammateRequest): Promise<void> { await this.roster.adopt(root, request) }

  /** Deliver an admitted send using the Lead's authority and the actual sender's identity. */
  private async sendAdmitted(caller: Agent, request: SendTeamMessageRequest): Promise<SendTeamMessageResult> {
    const membership = this.roster.membership(caller)
    request.signal.throwIfAborted()
    const { root } = membership
    if (this.management.state(root).policy !== undefined) {
      await this.management.admit(root, 'send', { caller, request })
      const id = request.messageId ?? TeamMessageId(`team-message-${randomUUID()}`)
      const pending = this.managedSends.get(id)
      const send = (): Promise<SendTeamMessageResult> => this.sendManaged(caller, { ...request, messageId: id })
      const operation = pending === undefined ? send() : pending.then(send, send)
      this.managedSends.set(id, operation)
      try { return await operation } finally { if (this.managedSends.get(id) === operation) this.managedSends.delete(id) }
    }
    const target = resolveActiveMember(root, this.journal.state(root), request.target)
    if (target.id === caller.id) throw new TeamError('a Team member cannot message itself', 'TEAM_SELF_MESSAGE')
    const content = [
      { type: 'text' as const, text: `Team message from ${membership.name}:` },
      ...structuredClone(request.content),
    ]
    if (Buffer.byteLength(JSON.stringify(content), 'utf8') > this.config.maxMessageBytes) {
      throw new TeamError(`team message exceeds ${this.config.maxMessageBytes} bytes`, 'TEAM_MESSAGE_TOO_LARGE')
    }
    const source = { kind: 'agent-message' as const, form: 'relay' as const, senderSessionId: caller.id }
    let messageId
    if (target.id === root.id) {
      const input = createUserMessage({ content, source })
      root.steer(input)
      messageId = input.id
    } else {
      messageId = await steerHostSubagentPrompt(this.ctx.subagents, root, target.id, content, source, request.signal)
    }
    this.activity.notify(membership.id)
    return { messageId }
  }

  /** Managed Hosts retain assignment facts, but delivery is one direct Inbox attempt with no outbox replay. */
  private async sendManaged(caller: Agent, request: SendTeamMessageRequest & { messageId: TeamMessageId }): Promise<SendTeamMessageResult> {
    const { root, name } = this.roster.membership(caller)
    const target = resolveActiveMember(root, this.journal.state(root), request.target)
    if (target.id === caller.id) throw new TeamError('a Team member cannot message itself', 'TEAM_SELF_MESSAGE')
    const message = await this.journal.transact(root.id, async () => {
      request.signal.throwIfAborted()
      const prior = this.journal.state(root).messages.find(item => item.id === request.messageId)
      if (prior !== undefined) {
        if (prior.senderId !== caller.id || prior.targetId !== target.id || JSON.stringify(prior.content) !== JSON.stringify(request.content)) throw new TeamError('Message identity reused with different content', 'TEAM_MESSAGE_CONFLICT')
        return prior
      }
      const message = { id: request.messageId, senderId: caller.id, senderName: name, targetId: target.id, content: structuredClone(request.content) }
      if (Buffer.byteLength(JSON.stringify(this.managedContent(message)), 'utf8') > this.config.maxMessageBytes) throw new TeamError(`team message exceeds ${this.config.maxMessageBytes} bytes`, 'TEAM_MESSAGE_TOO_LARGE')
      await this.journal.appendAndFlush(root, 'team/message/queued', { version: 2, teamId: TeamId(root.id), message })
      return message
    })
    if (this.management.state(root).cancelled.has(message.id)) throw new TeamError('Managed message was cancelled', 'TEAM_MESSAGE_CANCELLED')
    await this.management.admit(root, 'deliver', message)
    request.signal.throwIfAborted()
    const live = target.id === root.id ? root : this.ctx.agents.get(target.id)
    let accepted: MessageId | undefined
    if (live !== undefined) accepted = this.acceptedManagedMessage(live.session.snapshotEvents(live.session.inheritedEventCount), message.id)
    else {
      const observed = await readPersistedSession(this.ctx.sessionPersistence, target.id, request.signal)
      accepted = this.acceptedManagedMessage(observed.events.slice(observed.inheritedEventCount), message.id)
    }
    if (accepted === undefined) {
      const source = { kind: 'team-message' as const, teamId: TeamId(root.id), messageId: message.id, senderId: caller.id, senderName: name }
      if (target.id === root.id) {
        const input = createUserMessage({ content: this.managedContent(message), source })
        root.steer(input)
        accepted = input.id
      } else accepted = await steerHostSubagentPrompt(this.ctx.subagents, root, target.id, this.managedContent(message), source, request.signal)
    }
    const receiver = this.ctx.agents.get(target.id)
    if (receiver !== undefined) await this.ctx.sessions.flush(receiver.session)
    await this.journal.transact(root.id, async () => {
      if (!this.journal.state(root).delivered.includes(message.id)) await this.journal.appendAndFlush(root, 'team/message/delivered', { version: 2, teamId: TeamId(root.id), messageId: message.id, targetId: target.id })
    })
    return { messageId: accepted }
  }

  private managedContent(message: import('./types.ts').TeamMessageSnapshot): import('@deepseek-ai/dsh-llm').ContentBlock[] {
    return [{ type: 'text', text: `Team message ${message.id} from ${message.senderName}:` }, ...structuredClone(message.content)]
  }

  private acceptedManagedMessage(events: readonly SessionEvent[], id: TeamMessageId): MessageId | undefined {
    for (const event of events) {
      const messages = event.type === 'user/message' ? [event.data] : event.type === 'agent/inbox/spliced' ? event.data.inserted : []
      const found = messages.find(item => item.source.kind === 'team-message' && item.source.messageId === id)
      if (found !== undefined) return found.id
    }
  }

  /** Queue one contained provisioning reconciliation after publication has unwound. */
  private scheduleRecovery(agent: Agent): void {
    queueMicrotask(() => {
      if (this.lifecycle.disposed) return
      void this.roster.recoverFor(agent, this.lifecycle.signal).catch((error: unknown) => {
        if (this.lifecycle.disposed) return
        this.ctx.logger.warn(`Agent Teams recovery for "${agent.id}" failed: ${errorMessage(error)}`)
      })
    })
  }

  /** Stop Team-owned live branches and release every waiter before service disposal completes. */
  private async disposeRuntime(): Promise<void> {
    this.lifecycle.close()
    this.activity.close()

    const failures: unknown[] = []
    await this.lifecycle.settle(this.lifecycle.pending(), failures)
    for (const [root, childIds] of this.roster.liveChildrenByRoot()) {
      try {
        await this.roster.stopTeammates(root, childIds)
      } catch (error: unknown) {
        failures.push(error)
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Agent Teams runtime disposal failed')
  }
}

export default TeamService
