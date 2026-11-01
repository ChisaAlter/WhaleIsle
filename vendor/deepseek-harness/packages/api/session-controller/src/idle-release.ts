/**
 * Release resident Agents of Sessions nobody is watching or using. Opening a
 * Session resumes its whole log into the Host; without release every opened
 * Session stays resident until the Host restarts, and a long-lived desktop
 * Host slows down under the resulting heap.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { hasApiSessionSubagentOwner } from './agent.ts'
import type { SessionLifecycle } from './lifecycle.ts'

/** Idle-release policy after config defaults have been applied. */
export interface IdleReleasePolicy {
  /** Milliseconds a Session stays unwatched and idle before release; `0` disables release. */
  readonly idleMs: number
  /** Most recently active idle Sessions kept resident regardless of age. */
  readonly keep: number
  /** Clock override for tests. */
  readonly now?: () => number
}

/** Minimal views of optional peer services this package does not depend on. */
interface OptionalServices {
  jobs?: {
    list(caller?: SessionId): readonly { readonly owner?: SessionId; readonly status: string }[]
  }
  goals?: {
    get(agent: Agent): { readonly phase: string; readonly activation?: string } | undefined
  }
}

/** Watches Session activity and releases Agents that stay idle and unwatched. */
export class IdleSessionRelease {
  private readonly watchers = new Map<SessionId, number>()
  private readonly activeAt = new Map<SessionId, number>()
  private readonly now: () => number
  private sweeping: Promise<void> | undefined

  /**
   * @param ctx - Host context carrying the Agent registry and Session services.
   * @param lifecycle - retained Agent handles and the release/delete markers.
   * @param policy - idle threshold and resident allowance.
   */
  constructor(
    private readonly ctx: Context,
    private readonly lifecycle: SessionLifecycle,
    private readonly policy: IdleReleasePolicy,
  ) {
    this.now = policy.now ?? Date.now
    if (policy.idleMs <= 0) return
    ctx.on('agent/created', ({ agent }) => { this.touch(agent.id) })
    ctx.on('agent/status', ({ agent }) => { this.touch(agent.id) })
    ctx.on('agent/disposed', ({ agent }) => { this.activeAt.delete(agent.id) })
    ctx.on('session/event', (session) => { this.touch(session.id) }, { global: true })
    ctx.effect(() => {
      const timer = setInterval(() => { void this.sweep() }, Math.min(60_000, Math.max(1_000, Math.floor(policy.idleMs / 2))))
      timer.unref()
      return () => { clearInterval(timer) }
    }, 'session-controller.idle-release')
  }

  /**
   * Mark one Session as watched by a client stream.
   * @param sessionId - followed Session identity.
   * @returns the single-shot release of this watch.
   */
  watch(sessionId: SessionId): () => void {
    this.watchers.set(sessionId, (this.watchers.get(sessionId) ?? 0) + 1)
    this.touch(sessionId)
    let open = true
    return () => {
      if (!open) return
      open = false
      const count = (this.watchers.get(sessionId) ?? 1) - 1
      if (count > 0) this.watchers.set(sessionId, count)
      else this.watchers.delete(sessionId)
      this.touch(sessionId)
    }
  }

  /**
   * Release every idle, unwatched Session beyond the resident allowance.
   * @returns once this sweep's releases have settled.
   */
  sweep(): Promise<void> {
    this.sweeping ??= this.runSweep().finally(() => { this.sweeping = undefined })
    return this.sweeping
  }

  private async runSweep(): Promise<void> {
    if (this.policy.idleMs <= 0) return
    const now = this.now()
    const idle: { id: SessionId; handle: AgentHandle; since: number }[] = []
    for (const [id, handle] of this.lifecycle.retained()) {
      if (!this.releasable(id, handle.agent)) continue
      idle.push({ id, handle, since: this.activeAt.get(id) ?? this.touch(id) })
    }
    idle.sort((left, right) => right.since - left.since)
    for (const { id, handle, since } of idle.slice(this.policy.keep)) {
      if (now - since < this.policy.idleMs) continue
      // Recheck after earlier awaited releases: a client may have opened it meanwhile.
      if (!this.releasable(id, handle.agent)) continue
      await this.release(id, handle)
    }
  }

  private async release(id: SessionId, handle: AgentHandle): Promise<void> {
    this.lifecycle.releasingIds.add(id)
    try {
      await handle.dispose()
      this.ctx.logger.info(`session-controller: released idle session "${id}"`)
    } catch (error: unknown) {
      this.ctx.logger.warn(`session-controller: idle release of "${id}" failed: ${String(error)}`)
    } finally {
      this.lifecycle.releasingIds.delete(id)
    }
  }

  /** Whether the exact retained Agent is an ordinary, quiescent, unwatched Session. */
  private releasable(id: SessionId, agent: Agent): boolean {
    if (this.ctx.agents.get(id) !== agent) return false
    if ((this.watchers.get(id) ?? 0) > 0) return false
    if (this.lifecycle.deletingIds.has(id) || this.lifecycle.releasingIds.has(id)) return false
    if (agent.status !== 'idle') return false
    if (agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0) return false
    // Subagents belong to their parent; a parent with live children keeps them reachable.
    if (hasApiSessionSubagentOwner(this.ctx, agent.session, agent)) return false
    if (this.ctx.agents.list().some(other => other !== agent && this.ctx.agents.isOwnedBy(other.id, agent))) return false
    try {
      // Background jobs are owned by the Agent and would be killed with it.
      const jobs = optionalService(this.ctx, 'jobs')?.list(id) ?? []
      if (jobs.some(job => job.owner === id && (job.status === 'running' || job.status === 'stopping'))) return false
      // An armed goal's continuation authority is process-local; a resumed goal starts disarmed.
      const goal = optionalService(this.ctx, 'goals')?.get(agent)
      if (goal?.phase === 'active' && goal.activation === 'armed') return false
      // Plugin-owned conversations (Projects) expect their exact live Agent.
      if (this.ctx.sessionProjections.stateOf(agent.session, 'sessionListMetadata')?.presentation !== undefined) return false
    } catch {
      return false
    }
    return true
  }

  private touch(sessionId: SessionId): number {
    const now = this.now()
    this.activeAt.set(sessionId, now)
    return now
  }
}

/**
 * Read an optional peer service by name without a package dependency on it.
 * @param ctx - context that may carry the service.
 * @param name - service name.
 * @returns the service, or `undefined` when it is not mounted.
 */
function optionalService<K extends keyof OptionalServices>(ctx: Context, name: K): OptionalServices[K] {
  return (ctx as unknown as { get(name: K): OptionalServices[K] }).get(name)
}
