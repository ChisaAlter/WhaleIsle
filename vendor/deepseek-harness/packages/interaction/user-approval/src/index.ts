/**
 * Service Definition for the approval capability seam, covering requests, cancellation, audit, and per-session policy. Missing
 * answerers fail closed; grants apply only to the requested action.
 * @module @deepseek-ai/dsh-user-approval
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'user-approval': { kind: 'user-approval' } & ContextFormed
  }
}

import { scopeTarget } from '@deepseek-ai/dsh-scope'
import type { Session } from '@deepseek-ai/dsh-session'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'

declare module '@deepseek-ai/cordis' {
  interface Context {
    approval: ApprovalService
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The session's approval policy was switched — log-only, durable,
     * replayable, never in the model transcript (the model learns the policy
     * from the runtime-context snapshot and live switch notices). The LAST
     * such event is the session's override.
     * `source: 'delegation'` marks host-owned child policy. Its ask variant
     * requires a live delegated presentation route; an absent source is an
     * explicit runtime switch and cannot be replaced by delegated enablement.
     */
    'approval/policy': {
      policy: ApprovalPolicy
      /** Host-owned child policy, including explicitly continued managed asks. */
      source?: 'delegation'
    }
  }
}

import { ApprovalRequestId } from './types.ts'
import type { ApprovalOutcome, ApprovalRequestEvent } from './types.ts'
import type { ApprovalClaimResult } from './types.ts'

export { ApprovalRequestId } from './types.ts'
export type { ApprovalOutcome } from './types.ts'
export type { ApprovalClaimResult } from './types.ts'

/** Every {@link ApprovalOutcome}, for runtime normalization of answerer returns. */
const OUTCOMES: readonly ApprovalOutcome[] = ['allowed-once', 'rejected', 'cancelled', 'unavailable']

/**
 * A session's approval policy — what happens to an {@link ApprovalService}
 * ask BEFORE any interactive answerer sees it:
 *
 * - `'ask'` (the default) — delegate to the composed answerers; with none
 *   composed the chain falls through to the fail-closed `'unavailable'`.
 * - `'never'` — never prompt anyone: every ask resolves `'rejected'`
 *   deterministically. The strict headless stance (CI, unattended runs) and
 *   the policy whose outcome is knowable without asking.
 */
export type ApprovalPolicy = 'ask' | 'never'

/** Every {@link ApprovalPolicy}, for option advertisement and runtime validation of untrusted policy strings. */
export const APPROVAL_POLICIES: readonly ApprovalPolicy[] = ['ask', 'never']

/** Model-facing statement for the deterministic `'never'` policy. */
const NEVER_SENTENCE = 'Approval prompts are disabled in this session: actions that require approval are rejected automatically — do not request sandbox escalation (do not set `sandbox_permissions`).'
/** Model-facing statement for an interactive policy that may still fail closed. */
const ASK_SENTENCE = 'Approval policy: ask. Operations that require approval may ask through the configured answerers; without an available answerer, the request fails closed.'

/**
 * Whether the log currently sits inside an open turn (a `turn/start` not yet
 * closed by a `turn/end`) — the {@link ApprovalService.request} precondition.
 * The audit pair must be turn-enclosed: the turn is the durable log's
 * commit/replay boundary, so a bare event appended between turns is
 * indistinguishable from a crash tail and silently dropped on reload.
 */
function hasOpenTurn(session: Session): boolean {
  for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const type = session.eventAt(SessionSeq(seq))?.type
    if (type === 'turn/start') return true
    if (type === 'turn/end') return false
  }
  return false
}

/**
 * Append the sole durable representation of a session policy override. Invalid
 * values throw before the log changes; consumers fold the new value on each read.
 * @param session - the session the override belongs to.
 * @param policy - the policy in effect until the next switch.
 */
export function setApprovalPolicy(session: Session, policy: ApprovalPolicy): void {
  if (!APPROVAL_POLICIES.includes(policy)) {
    throw new TypeError('approval policy must be one of "ask" or "never"')
  }
  session.append('approval/policy', { policy })
}

/**
 * Readonly same-process permission question. `callId` links to an already
 * presented tool call, so arguments are not duplicated here.
 */
export interface ApprovalRequest extends ApprovalRequestEvent {
  /**
   * The agent on whose behalf the question is asked. Routes the question (a
   * UI answerer only answers for agents it owns) and receives the audit
   * events on its session log.
   */
  readonly agent: Agent
  /** The tool the question is about (presentation and audit). */
  readonly toolName: string
  /**
   * The exact tool call being decided, when the asker has one — lets a UI
   * attach the prompt to the tool call it already streamed.
   */
  readonly callId?: ToolCallId
  /** The asker's human-readable explanation of WHY it is asking. */
  readonly reason?: string
  /**
   * Aborting withdraws the question: the request settles `'cancelled'`
   * immediately and a late answer from a still-pending answerer is discarded.
   */
  readonly signal?: AbortSignal
}

/** One approval request folded from the durable Session log. */
export interface PendingApprovalRecord {
  readonly id: ApprovalRequestId
  readonly toolName: string
  readonly callId?: ToolCallId
  readonly reason?: string
  readonly outcome?: ApprovalOutcome
}

interface ApprovalWaiter {
  promise: Promise<ApprovalOutcome>
  resolve(outcome: ApprovalOutcome): void
  reject(error: unknown): void
}

/** Host-owned presentation route. The validator captures the current assignment/run. */
export interface DelegatedApprovalRoute {
  readonly owner: Agent
  readonly label: string
  readonly validate: () => boolean
}

/** A captured managed execution lifetime, not a permission grant. */
export interface ApprovalExecutionScope {
  /** Assignment/run revocation; executors combine it with their own cancellation owner. */
  readonly signal: AbortSignal
  readonly assertCurrent: () => void
}

interface BoundApprovalRoute extends DelegatedApprovalRoute {
  readonly lifetime: AbortController
}

function approvalRecords(session: Session): PendingApprovalRecord[] {
  const records = new Map<string, PendingApprovalRecord>()
  for (let seq = 0; seq < session.seq; seq += 1) {
    const event = session.eventAt(SessionSeq(seq))
    if (event === undefined) continue
    if (event.type === 'approval/asked') {
      records.set(String(event.data.id), {
        id: event.data.id,
        toolName: event.data.toolName,
        ...(event.data.callId === undefined ? {} : { callId: event.data.callId }),
        ...(event.data.reason === undefined ? {} : { reason: event.data.reason }),
      })
    } else if (event.type === 'approval/decided') {
      const record = records.get(String(event.data.id))
      if (record !== undefined) records.set(String(event.data.id), { ...record, outcome: event.data.outcome })
    }
  }
  return [...records.values()]
}

/** Plugin config. All optional — `static Config` supplies the defaults. */
export interface Config {
  /**
   * The deployment's default {@link ApprovalPolicy} for sessions without an
   * `approval/policy` override — `'ask'` delegates to the composed answerers
   * (fail-closed with none); `'never'` auto-rejects every ask without
   * prompting (the deterministic CI/unattended stance).
   */
  readonly policy?: ApprovalPolicy
}

/**
 * Approval service that applies session policy before answerers and logs every
 * ask/outcome pair to the requesting session. It exposes deterministic policy
 * changes to the model through the runtime-context snapshot and switch notices.
 */
export class ApprovalService extends Service {
  static Config: z<Config> = z.object({
    policy: z.union(['ask', 'never'] as const).default('ask'),
  })

  private readonly waiters = new Map<string, ApprovalWaiter>()
  private readonly delegated = new Map<Agent, BoundApprovalRoute>()

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'approval')
    ctx.effect(() => () => {
      for (const route of this.delegated.values()) route.lifetime.abort()
      this.delegated.clear()
    }, 'approval: delegated request lifetimes')

    const effective = (agent: Agent): ApprovalPolicy => this.policyOf(agent.session)

    // The complete current value travels after retained history, so switching
    // policy does not rewrite the stable system-prompt cache prefix.
    ctx.inject(['systemPrompt'], (scope: Context) => {
      scope.systemPrompt.context({
        name: 'approval:policy',
        order: scope.systemPrompt.getContextOrder('APPROVAL_POLICY'),
        text: (context) => {
          const agent = context.agent
          // A bare assemble() (tests, diagnostics) has no session to state.
          if (agent === undefined) return ''
          const policy = effective(agent)
          return policy === 'never' ? NEVER_SENTENCE : ASK_SENTENCE
        },
      })
    })
  }

  /**
   * Switch one live agent's policy and queue the transition for its next model
   * step. Session initialization uses {@link setApprovalPolicy} directly
   * because there is no previously visible policy to change.
   * @param agent - the live agent whose policy is changing.
   * @param policy - the new effective policy.
   */
  setPolicy(agent: Agent, policy: ApprovalPolicy): void {
    const previous = this.policyOf(agent.session)
    if (previous === policy && this.policyRecord(agent.session)?.source !== 'delegation') return
    setApprovalPolicy(agent.session, policy)
    if (policy === 'never') {
      for (const [requester, route] of this.delegated) {
        if (requester === agent || route.owner === agent) route.lifetime.abort()
      }
    }
    if (previous === policy) return
    agent.inject(createUserMessage({
      content: [{
        type: 'text',
        text: `The approval policy changed from "${previous}" to "${policy}" (changed by the user).`,
      }],
      source: { kind: 'user-approval' },
    }))
  }

  /**
   * Enable asking only for a host-pinned delegated child, after its host has
   * accepted a new human continuation. This grants no operation or sandbox mode.
   * An explicit user policy, including never, is never replaced.
   */
  enableDelegatedRequests(agent: Agent, owner: Agent): boolean {
    if (agent.session.header.parentSession !== owner.id || this.policyOf(owner.session) !== 'ask') return false
    const policy = this.policyRecord(agent.session)
    if (policy?.source !== 'delegation') return false
    if (policy.policy !== 'ask') agent.session.append('approval/policy', { policy: 'ask', source: 'delegation' })
    return true
  }

  /**
   * Present an executing child's requests in its direct parent's conversation.
   * Execution and audit remain on the child. Disposal withdraws pending UI and
   * invalidates late answers; the host must rebind after each assignment/run.
   */
  bindDelegatedRequester(agent: Agent, route: DelegatedApprovalRoute): () => void {
    if (agent.session.header.parentSession !== route.owner.id) throw new Error('approval owner must be the direct parent')
    this.delegated.get(agent)?.lifetime.abort()
    const bound: BoundApprovalRoute = { ...route, lifetime: new AbortController() }
    this.delegated.set(agent, bound)
    return () => {
      bound.lifetime.abort()
      if (this.delegated.get(agent) === bound) this.delegated.delete(agent)
    }
  }

  /** Capture before asking, then check at the executor's actual start boundary. */
  captureExecution(agent: Agent, signal: AbortSignal): ApprovalExecutionScope | undefined {
    const route = this.delegated.get(agent)
    if (route === undefined) {
      const policy = this.policyRecord(agent.session)
      if (policy?.source === 'delegation' && policy.policy === 'ask') throw new Error('managed approval route is unavailable')
      return undefined
    }
    return { signal: route.lifetime.signal, assertCurrent: () => {
      signal.throwIfAborted()
      if (!this.validDelegatedRoute(agent, route)) throw new Error('the approved assignment is no longer active')
    } }
  }

  /**
   * Ask the composed answerers to decide one readonly same-process request.
   * The service borrows the request, agent, session, and live signal directly.
   * The request requires an open turn because the audit pair must be enclosed
   * by the durable log's commit/replay boundary; an idle ask rejects before
   * appending anything. The answerer phase always produces an outcome: an
   * aborted signal yields `'cancelled'`, a missing or throwing answerer yields
   * `'unavailable'` (fail closed), and a rogue non-vocabulary return value is
   * normalized to `'unavailable'`. A failure that prevents either audit append
   * from committing still rejects because returning an unlogged decision would
   * violate the pair. Session contains post-commit observer failures, so an
   * authoritative append cannot reject the request or suppress its matching
   * audit event.
   * @param req - the pending decision (agent, tool identity, reason, signal).
   * @returns the closed outcome; `'allowed-once'` is the only grant.
   * @throws when no turn is open or either audit event fails before the session
   *   append commit point.
   */
  async request(req: ApprovalRequest): Promise<ApprovalOutcome> {
    const session = req.agent.session
    if (!hasOpenTurn(session)) {
      throw new Error(
        'approval.request() outside an open turn: the approval/asked + approval/decided audit pair '
        + 'must be turn-enclosed (a bare event between turns is crash-tail garbage on reload). '
        + 'Ask from inside the turn that needs the decision.',
      )
    }
    let record = req.callId === undefined
      ? undefined
      : approvalRecords(session).find(candidate => candidate.callId === req.callId)
    if (record?.outcome !== undefined) {
      if (record.outcome === 'allowed-once' && this.policyRecord(session)?.source === 'delegation'
        && !this.validDelegatedRoute(req.agent, this.delegated.get(req.agent))) return 'cancelled'
      return record.outcome
    }
    if (record === undefined) {
      const id = ApprovalRequestId(randomUUID())
      session.append('approval/asked', {
        id,
        toolName: req.toolName,
        ...req.callId !== undefined ? { callId: req.callId } : {},
        ...req.reason !== undefined ? { reason: req.reason } : {},
      })
      record = {
        id,
        toolName: req.toolName,
        ...(req.callId === undefined ? {} : { callId: req.callId }),
        ...(req.reason === undefined ? {} : { reason: req.reason }),
      }
    }
    const key = this.waiterKey(req.agent, record.id)
    const existing = this.waiters.get(key)
    if (existing !== undefined) return existing.promise
    const completion = Promise.withResolvers<ApprovalOutcome>()
    const waiter: ApprovalWaiter = {
      promise: completion.promise.finally(() => { this.waiters.delete(key) }),
      resolve: completion.resolve,
      reject: completion.reject,
    }
    this.waiters.set(key, waiter)
    const request = { ...req, requestId: record.id }
    void this.decide(request, session).then(
      (outcome) => {
        try {
          this.respond(req.agent, record.id, outcome)
        } catch (error: unknown) {
          waiter.reject(error)
        }
      },
      waiter.reject,
    )
    return waiter.promise
  }

  /**
   * Return unresolved approval requests from one Session log.
   * @param session - the session whose log supplies the requests.
   * @returns every asked approval that has no recorded outcome yet.
   */
  pending(session: Session): readonly PendingApprovalRecord[] {
    return approvalRecords(session).filter(record => record.outcome === undefined)
  }

  /**
   * Commit one approval decision at most once, then release its live waiter.
   * @param agent - the agent whose session owns the request.
   * @param requestId - the pending approval identifier.
   * @param outcome - the decision to record.
   * @returns the claim result: accepted, already-resolved, or not-pending.
   */
  respond(agent: Agent, requestId: ApprovalRequestId, outcome: ApprovalOutcome): ApprovalClaimResult {
    const record = approvalRecords(agent.session).find(candidate => candidate.id === requestId)
    if (record === undefined) return { status: 'not-pending' }
    if (record.outcome !== undefined) return { status: 'already-resolved', outcome: record.outcome }
    if (outcome === 'allowed-once' && this.policyRecord(agent.session)?.source === 'delegation'
      && !this.validDelegatedRoute(agent, this.delegated.get(agent))) outcome = 'cancelled'
    agent.session.append('approval/decided', { id: requestId, outcome })
    this.waiters.get(this.waiterKey(agent, requestId))?.resolve(outcome)
    return { status: 'accepted', outcome }
  }

  private waiterKey(agent: Agent, requestId: ApprovalRequestId): string {
    return `${String(agent.session.id)}\0${String(requestId)}`
  }

  private validDelegatedRoute(agent: Agent, route: BoundApprovalRoute | undefined): boolean {
    try {
      return route !== undefined && this.delegated.get(agent) === route && !route.lifetime.signal.aborted
        && this.policyOf(agent.session) === 'ask' && this.policyOf(route.owner.session) === 'ask' && route.validate()
    } catch { return false }
  }

  /**
   * The session's effective policy: its own `approval/policy` fold, else the
   * configured default (the schema already defaulted an omitted policy to
   * `'ask'`; the `??` only narrows the optional-input TYPE).
   * @param session - the exact accepted session whose policy applies.
   * @returns the policy every ask for this session resolves under right now.
   */
  policyOf(session: Session): ApprovalPolicy {
    return this.overrideOf(session) ?? this.config.policy ?? 'ask'
  }

  /**
   * Read the session override without applying the configured default.
   * @param session - session whose log supplies the override.
   * @returns the last logged policy, or `undefined` without one.
   */
  overrideOf(session: Session): ApprovalPolicy | undefined {
    return this.policyRecord(session)?.policy
  }

  private policyRecord(session: Session): { policy: ApprovalPolicy; source?: 'delegation' } | undefined {
    for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
      // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
      const event = session.eventAt(SessionSeq(seq))
      if (event?.type === 'approval/policy') return event.data
    }
    return undefined
  }

  /**
   * Dispatch the waterfall, contained and raced against the request signal.
   * @param req - the borrowed public request.
   * @param session - the request agent's session used for policy lookup.
   * @returns the normalized closed outcome.
   */
  private async decide(req: ApprovalRequest, session: Session): Promise<ApprovalOutcome> {
    const route = this.delegated.get(req.agent)
    const signal = route === undefined ? req.signal : AbortSignal.any([route.lifetime.signal, ...req.signal === undefined ? [] : [req.signal]])
    if (signal?.aborted) return 'cancelled'
    // The 'never' policy is decided HERE, before any dispatch: a listener
    // registered with `prepend: true` after this service mounts would sit
    // ahead of any gate LISTENER, so a listener-shaped gate cannot keep the
    // documented promise that 'never' rejects deterministically regardless
    // of registration order — only the service's own request path can.
    if (this.policyOf(session) === 'never') return 'rejected'
    // A managed ask survives in the log, but its host-owned routing authority
    // does not. Missing composition after restart must fail closed.
    if (route === undefined && this.policyRecord(session)?.source === 'delegation') return 'unavailable'
    const valid = (): boolean => route === undefined || this.validDelegatedRoute(req.agent, route)
    if (!valid()) return 'cancelled'
    let presented: ApprovalRequestEvent = req
    if (route !== undefined) {
      let call: ReturnType<Session['eventAt']>
      for (let seq = session.seq - 1; req.callId !== undefined && seq >= 0; seq -= 1) {
        const event = session.eventAt(SessionSeq(seq))
        if (event?.type === 'turn/start') break
        if (event?.type === 'tool/call' && event.data.callId === req.callId) { call = event; break }
      }
      if (call?.type !== 'tool/call' || call.data.name !== req.toolName) return 'unavailable'
      presented = { ...req, agent: route.owner, ...signal === undefined ? {} : { signal }, requester: {
        sessionId: session.id, label: route.label,
        ...session.header.cwd === undefined ? {} : { cwd: session.header.cwd },
        call: { callId: call.data.callId, name: call.data.name, arguments: call.data.arguments },
      } }
    }
    // Enter the promise chain BEFORE dispatching: a listener that throws
    // SYNCHRONOUSLY (before its first await) must land in the same rejection
    // path as an async one — `Promise.resolve(call())` would let it escape
    // the containment into the caller.
    const answer: Promise<ApprovalOutcome> = Promise.resolve().then(
      () => this.ctx.waterfall(
        scopeTarget(presented.agent, presented.agent), 'approval/request', presented,
        () => Promise.resolve<ApprovalOutcome>('unavailable'),
      ),
    ).then(
      // Normalize a rogue (non-vocabulary) answerer return to the fail-closed
      // outcome instead of leaking it into callers' closed-union switches.
      outcome => this.policyOf(session) === 'never' || !valid() ? 'cancelled' : OUTCOMES.includes(outcome) ? outcome : 'unavailable',
      // A throwing answerer must fail the QUESTION closed, not the caller's
      // tool call open — the seam contains its callbacks.
      () => 'unavailable',
    )
    if (signal === undefined) return answer
    return await new Promise<ApprovalOutcome>((resolve) => {
      const onAbort = () => {
        signal.removeEventListener('abort', onAbort)
        resolve('cancelled')
      }
      signal.addEventListener('abort', onAbort, { once: true })
      void answer.then((outcome) => {
        signal.removeEventListener('abort', onAbort)
        // After an abort won the race this resolve is a settled-promise no-op:
        // the late answer is discarded by construction.
        resolve(outcome)
      })
    })
  }
}

export default ApprovalService
