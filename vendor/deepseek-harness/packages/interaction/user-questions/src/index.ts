/**
 * Service Definition for the user-questions capability seam (`ctx.userQuestions`): a UI-backed service for
 * pausing an agent tool call until the human answers a question. The model-
 * facing tool lives in `@deepseek-ai/dsh-tool-ask-user`; UI packages compose
 * answerers on the Agent-scoped Cordis waterfall.
 *
 * @module @deepseek-ai/dsh-user-questions
 */

import { randomUUID } from 'node:crypto'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import { UserQuestionRequestId } from './types.ts'
import type { UserQuestionClaimResult, UserQuestionOutcome, UserQuestionRequestId as UserQuestionRequestIdType } from './types.ts'
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { createUserMessage, HarnessError, type MessageId, type ToolCallId, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-projection'
import z from '@deepseek-ai/schemastery'
import { userQuestionProjectionDefinition } from './projection.ts'
import { TimedQuestionWait } from './timed-wait.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    userQuestions: UserQuestionService
  }
}

import type {
  AskUserQuestionAnswer, AskUserQuestionRequestEvent, PendingUserQuestion,
} from './types.ts'

export type {
  AskUserQuestionAnswer, AskUserQuestionAnswerItem, AskUserQuestionIntent, AskUserQuestionItem,
  AskUserQuestionOption, PendingUserQuestion, SettledUserQuestion, UserQuestionProjectionView,
  UserQuestionState, UserQuestionClaimResult, UserQuestionOutcome, UserQuestionRequestId,
} from './types.ts'
export { isTimedAskUserQuestionSchema, TIMED_WAIT_PARAMETER } from './projection.ts'

/** Request for a human answer. */
export interface AskUserQuestionRequest extends AskUserQuestionRequestEvent {}

/** Timed ask result returned when the foreground answer window closes. */
export type TimedUserQuestionResult = AskUserQuestionAnswer | { pending: true; callId: ToolCallId }

/** Stable error taxonomy for user-questions failures. */
export class UserQuestionError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'UserQuestionError'
  }
}

function abortedQuestion(cause?: unknown): UserQuestionError {
  return new UserQuestionError(
    'ask_user_question was aborted before the user answered',
    'ASK_ABORTED',
    cause === undefined ? undefined : { cause },
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function restoreUserQuestionError(reason: unknown): unknown {
  if (reason instanceof UserQuestionError) return reason
  if (isRecord(reason)
    && reason.name === 'UserQuestionError'
    && typeof reason.message === 'string'
    && typeof reason.code === 'string') {
    return new UserQuestionError(reason.message, reason.code, { cause: reason })
  }
  return reason
}

type QuestionSession = Agent['session']

interface PendingQuestionRecord {
  id: UserQuestionRequestIdType
  callId: NonNullable<AskUserQuestionRequestEvent['callId']>
  questions: AskUserQuestionRequestEvent['questions']
  terminal?: {
    outcome: UserQuestionOutcome
    answer?: AskUserQuestionAnswer
    error?: { name: string; code: string; message: string }
  }
}

interface QuestionWaiter {
  promise: Promise<AskUserQuestionAnswer>
  resolve(answer: AskUserQuestionAnswer): void
  reject(error: unknown): void
}

function hasOpenTurn(session: QuestionSession): boolean {
  for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
    const type = String(session.eventAt(SessionSeq(seq))?.type)
    if (type === 'turn/start') return true
    if (type === 'turn/end') return false
  }
  return false
}

function questionRecords(session: QuestionSession): PendingQuestionRecord[] {
  const records = new Map<string, PendingQuestionRecord>()
  for (let seq = 0; seq < session.seq; seq += 1) {
    const event = session.eventAt(SessionSeq(seq))
    if (event === undefined) continue
    const type = String(event.type)
    const data = event.data as unknown as Record<string, unknown>
    if (type === 'user-questions/asked') {
      records.set(String(data.id), {
        id: UserQuestionRequestId(String(data.id)),
        callId: data.callId as PendingQuestionRecord['callId'],
        questions: structuredClone(data.questions) as PendingQuestionRecord['questions'],
      })
    } else if (type === 'user-questions/answered') {
      const record = records.get(String(data.id))
      if (record !== undefined) {
        record.terminal = {
          outcome: String(data.outcome) as UserQuestionOutcome,
          ...(data.answer === undefined ? {} : { answer: structuredClone(data.answer) as AskUserQuestionAnswer }),
          ...(data.error === undefined ? {} : {
            error: structuredClone(data.error) as { name: string; code: string; message: string },
          }),
        }
      }
    }
  }
  return [...records.values()]
}

function terminalQuestionError(record: PendingQuestionRecord): UserQuestionError {
  const stored = record.terminal?.error
  return new UserQuestionError(
    stored?.message ?? (record.terminal?.outcome === 'cancelled'
      ? 'the user cancelled ask_user_question'
      : 'no user-questions answerer accepted the request'),
    stored?.code ?? (record.terminal?.outcome === 'cancelled' ? 'ASK_CANCELLED' : 'NO_PROVIDER'),
  )
}


type QueuedReply = { messageId: MessageId; claimedTurn?: number }

/** `ctx.userQuestions`: validation plus the scoped answerer waterfall. */
export class UserQuestionService extends TypertRemoteService {
  static Config = z.object({})
  private readonly waiters = new Map<string, QuestionWaiter>()
  private readonly waits = new Map<Agent, Map<ToolCallId, TimedQuestionWait>>()
  private readonly queuedReplies = new WeakMap<Session, Map<ToolCallId, QueuedReply>>()

  constructor(ctx: Context) {
    super(ctx, 'userQuestions')
    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.sessionProjections.register(userQuestionProjectionDefinition)
    })
    ctx.effect(() => () => {
      for (const calls of this.waits.values()) {
        for (const wait of calls.values()) wait.close(abortedQuestion())
      }
      this.waits.clear()
    }, 'userQuestions: foreground waits')
    ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
      const source = message.source
      if (source.kind !== 'user-question-reply') return
      const calls = this.queuedReplies.get(agent.session) ?? new Map<ToolCallId, QueuedReply>()
      const reply = calls.get(source.callId)
      if (reply === undefined) {
        calls.set(source.callId, { messageId: message.id, claimedTurn: turn })
        this.queuedReplies.set(agent.session, calls)
      } else if (reply.messageId === message.id) {
        reply.claimedTurn = turn
      }
    }, { global: true })
    ctx.on('agent/inbox/discarded', ({ agent, message }) => {
      const source = message.source
      if (source.kind === 'user-question-reply') this.releaseReply(agent.session, source.callId, message.id)
    }, { global: true })
    ctx.on('session/event', (session, event) => {
      if (event.type === 'user/message') {
        const source = event.data.source
        if (source.kind === 'user-question-reply') this.releaseReply(session, source.callId, event.data.id)
      } else if (event.type === 'turn/end') {
        const calls = this.queuedReplies.get(session)
        if (calls === undefined) return
        for (const [callId, reply] of calls) {
          if (reply.claimedTurn === event.data.turn) calls.delete(callId)
        }
      }
    }, { global: true })
  }

  private releaseReply(session: Session, callId: ToolCallId, messageId: MessageId): void {
    const calls = this.queuedReplies.get(session)
    if (calls?.get(callId)?.messageId !== messageId) return
    calls.delete(callId)
  }

  private assertLiveRoot(agent: Agent): void {
    const agents = this.ctx.get('agents')
    if (agents === undefined || agents.get(agent.id) !== agent) {
      throw new UserQuestionError(
        'human interaction requires the exact live calling agent when an agent is supplied',
        'CALLER_NOT_LIVE')
    }
    if (!agents.roots().includes(agent)) {
      throw new UserQuestionError(
        'human interaction is unavailable while the calling agent is owned by another live agent; '
        + "include the unresolved question or decision in the child agent's final result",
        'DELEGATED_CALLER')
    }
  }

  private continued(agent: Agent): readonly PendingUserQuestion[] {
    const state = this.ctx.get('sessionProjections')?.stateOf(agent.session, 'userQuestions')
    return (state?.questions.active ?? []).filter(question => question.state === 'continued')
  }

  /**
   * Answer a continued question. The reply is steered into the agent as a
   * user message whose source names the call; that message is also the
   * record that closes the question in the projection.
   * @param agent - Live root agent for the owning Session.
   * @param callId - Continued question identity.
   * @param answer - Complete structured answer batch, one item per question of the call.
   * @returns Whether the question is still continued; an accepted reply stays
   *   queued until the agent admits its user message.
   * @throws {UserQuestionError} `BAD_ANSWER` when the batch does not name each
   *   question of the call exactly once, or `REPLY_QUEUED` when a reply is
   *   already waiting for admission.
   */
  @Remote
  answer(agent: Agent, callId: ToolCallId, answer: AskUserQuestionAnswer): boolean {
    this.assertLiveRoot(agent)
    const question = this.continued(agent).find(item => item.callId === callId)
    if (question === undefined) return false
    const queued = this.queuedReplies.get(agent.session)
    const matches = (message: UserMessage): boolean =>
      message.source.kind === 'user-question-reply' && message.source.callId === callId
    if (queued?.has(callId) || agent.inbox.nextTurn.some(matches) || agent.inbox.nextStep.some(matches)) {
      throw new UserQuestionError('a reply is already queued for this question', 'REPLY_QUEUED')
    }
    // The gateway validated the batch's shape from the type; the model-facing
    // contract also promises one item per question, which only this owner of
    // the asked questions can check before the batch reaches the model.
    const answered = new Set(answer.answers.map(item => item.id))
    if (answered.size !== answer.answers.length
      || question.questions.length !== answer.answers.length
      || !question.questions.every(item => answered.has(item.id))) {
      throw new UserQuestionError(
        `the answer batch for ${callId} must name each of its ${String(question.questions.length)} questions exactly once`,
        'BAD_ANSWER')
    }
    const message = createUserMessage({
      source: { kind: 'user-question-reply', callId, outcome: 'answered' },
      content: [{
        type: 'text',
        text: JSON.stringify({
          kind: 'answer_to_pending_question', tool: 'ask_user_question', callId,
          questions: question.questions, answers: answer.answers,
        }),
      }],
    })
    const calls = queued ?? new Map<ToolCallId, QueuedReply>()
    calls.set(callId, { messageId: message.id })
    this.queuedReplies.set(agent.session, calls)
    try {
      agent.steer(message)
    } catch (error: unknown) {
      this.releaseReply(agent.session, callId, message.id)
      throw error
    }
    return true
  }

  /**
   * Let one answer UI hold a live timed wait. Closing the stream releases its claim.
   * @param agent - Live root agent owning the question.
   * @param callId - Foreground tool call to attach to.
   * @param signal - Remote stream cancellation, including Client disconnect.
   * @returns One Host-computed remaining duration, or no frames once the wait ended.
   */
  @Remote({ mode: 'stream' })
  async *attachWait(agent: Agent, callId: ToolCallId, signal: AbortSignal): AsyncIterable<{ remainingMs: number }> {
    this.assertLiveRoot(agent)
    const wait = this.waits.get(agent)?.get(callId)
    if (wait !== undefined) yield* wait.attach(signal)
  }

  /**
   * Foreground wait whose first settlement the Client decides: the Client
   * rejects with `ASK_TIMED_OUT` when its countdown ends, and this method maps
   * that code to the pending result.
   * @param request - Questions, live owner agent, and abort signal.
   * @param callId - Tool call identity the Client card is keyed by.
   * @param timeoutMs - Positive foreground wait in milliseconds.
   * @returns The answer when it arrives inside the window, otherwise a pending
   *   result, also when no connected Client claimed the request by the deadline.
   * @throws {UserQuestionError} `BAD_TIMEOUT` for a non-integer, non-positive,
   *   or oversized wait.
   */
  async askTimed(
    request: AskUserQuestionRequest & { agent: Agent },
    callId: ToolCallId,
    timeoutMs: number,
  ): Promise<TimedUserQuestionResult> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
      throw new UserQuestionError('timeout must fit a positive platform timer', 'BAD_TIMEOUT')
    }
    this.assertLiveRoot(request.agent)
    const calls = this.waits.get(request.agent) ?? new Map<ToolCallId, TimedQuestionWait>()
    if (calls.has(callId)) throw new UserQuestionError('the question call already has a foreground wait', 'DUPLICATE_WAIT')
    const wait = new TimedQuestionWait(Date.now() + timeoutMs, request.signal,
      new UserQuestionError('ask_user_question timed out before the user answered', 'ASK_TIMED_OUT'))
    calls.set(callId, wait)
    this.waits.set(request.agent, calls)
    try {
      try {
        return await this.ask({ ...request, signal: wait.signal, wait: { callId, timed: true } })
      } catch (error) {
        if (wait.signal.aborted) throw wait.signal.reason
        if (error instanceof UserQuestionError && error.code === 'NO_PROVIDER') {
          await wait.done
          throw wait.signal.reason
        }
        throw error
      }
    } catch (error) {
      if (error instanceof UserQuestionError && error.code === 'ASK_TIMED_OUT') return { pending: true, callId }
      if (wait.signal.aborted) throw abortedQuestion(error)
      throw error
    } finally {
      wait.close(abortedQuestion())
      calls.delete(callId)
      if (calls.size === 0) this.waits.delete(request.agent)
    }
  }

  /**
   * Ask the scoped answerer waterfall and wait for the user's answer.
   *
   * When a caller supplies an agent, human interaction is valid only for the
   * exact live runtime root. Runtime ownership, not durable session lineage,
   * decides this boundary: an owned child has no human answerer and would
   * block forever, while a lineage-bearing session resumed as a new runtime
   * root may ask normally.
   *
   * @param request Questions, owner agent, and abort signal.
   * @returns The answer chosen or typed by the human.
   * @throws {UserQuestionError} code `ASK_ABORTED` when the supplied signal
   *   is already or becomes aborted, `CALLER_NOT_LIVE` when a supplied agent
   *   is not the registry's exact live instance, or `DELEGATED_CALLER` when
   *   that live agent is owned by another agent.
   */
  async ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
    if (request.signal?.aborted) {
      throw abortedQuestion()
    }
    if (request.questions.length === 0) {
      throw new UserQuestionError('ask_user_question requires at least one question', 'EMPTY_QUESTIONS')
    }
    const agent = request.agent
    if (agent !== undefined) this.assertLiveRoot(agent)
    // A presentation intent asserts two things the types cannot: that the
    // named approve label is one of this question's own options, and that a
    // plan-review carries the plan it is a review of. A UI honouring the
    // intent answers with that label, and shows that detail as the plan, so
    // either gap would put a choice the asker never offered — or an approval of
    // something invisible — in front of the user. Caught at the asker, where
    // the mistake is, rather than in each UI.
    for (const question of request.questions) {
      const intent = question.intent
      if (intent === undefined) continue
      if (!(question.options ?? []).some(option => option.label === intent.approve)) {
        throw new UserQuestionError(
          `question ${question.id} declares intent ${intent.kind} whose approve label `
          + `${JSON.stringify(intent.approve)} names none of its options`,
          'BAD_INTENT')
      }
      if (question.detail === undefined) {
        throw new UserQuestionError(
          `question ${question.id} declares intent ${intent.kind} without the detail it reviews`,
          'BAD_INTENT')
      }
    }
    if (agent !== undefined && request.callId !== undefined && request.wait === undefined) {
      return this.askDurable(agent, request)
    }
    const noAnswerer = () => Promise.reject(new UserQuestionError(
      'no user-questions answerer accepted the request',
      'NO_PROVIDER',
    ))
    try {
      return await (agent === undefined
        ? this.ctx.waterfall('user-questions/request', request, noAnswerer)
        : this.ctx.waterfall(
          scopeTarget(agent, agent),
          'user-questions/request',
          { ...request, agent },
          noAnswerer,
        ))
    } catch (error) {
      const restored = restoreUserQuestionError(error)
      if (restored instanceof UserQuestionError) throw restored
      if (request.signal?.aborted) {
        throw abortedQuestion(error)
      }
      throw restored
    }
  }
  /**
   * Return unresolved durable questions from one Session log.
   * @param session - the session whose log supplies the questions.
   * @returns every asked question that has no terminal answer yet.
   */
  pending(session: QuestionSession): readonly PendingQuestionRecord[] {
    return questionRecords(session)
      .filter(record => record.terminal === undefined)
      .map(record => structuredClone(record))
  }

  /**
   * Idempotently commit one human answer before releasing a live tool call.
   * @param agent - the agent whose session owns the question.
   * @param requestId - the pending question identifier.
   * @param answer - the human's chosen or typed answer.
   * @returns the claim result: accepted, already-resolved, or not-pending.
   */
  respond(agent: Agent, requestId: UserQuestionRequestIdType, answer: AskUserQuestionAnswer): UserQuestionClaimResult {
    const record = questionRecords(agent.session).find(entry => entry.id === requestId)
    if (record === undefined) return { status: 'not-pending' }
    if (record.terminal !== undefined) {
      return {
        status: 'already-resolved',
        outcome: record.terminal.outcome,
        ...(record.terminal.answer === undefined ? {} : { answer: record.terminal.answer }),
      }
    }
    agent.session.append('user-questions/answered', { id: requestId, outcome: 'answered', answer })
    this.waiters.get(this.waiterKey(agent, requestId))?.resolve(answer)
    return { status: 'accepted', outcome: 'answered', answer }
  }

  /**
   * Idempotently cancel one pending durable question.
   * @param agent - the agent whose session owns the question.
   * @param requestId - the pending question identifier.
   * @returns the claim result: accepted, already-resolved, or not-pending.
   */
  cancel(agent: Agent, requestId: UserQuestionRequestIdType): UserQuestionClaimResult {
    return this.rejectPending(agent, requestId, 'cancelled', new UserQuestionError(
      'the user cancelled ask_user_question', 'ASK_CANCELLED'))
  }

  private rejectPending(
    agent: Agent,
    requestId: UserQuestionRequestIdType,
    outcome: Exclude<UserQuestionOutcome, 'answered'>,
    error: UserQuestionError,
  ): UserQuestionClaimResult {
    const record = questionRecords(agent.session).find(entry => entry.id === requestId)
    if (record === undefined) return { status: 'not-pending' }
    if (record.terminal !== undefined) {
      return { status: 'already-resolved', outcome: record.terminal.outcome,
        ...(record.terminal.answer === undefined ? {} : { answer: record.terminal.answer }) }
    }
    agent.session.append('user-questions/answered', {
      id: requestId,
      outcome,
      error: { name: error.name, code: error.code, message: error.message },
    })
    this.waiters.get(this.waiterKey(agent, requestId))?.reject(error)
    return { status: 'accepted', outcome }
  }

  private waiterKey(agent: Agent, requestId: UserQuestionRequestIdType): string {
    return `${String(agent.session.id)}\0${String(requestId)}`
  }

  private async askDurable(agent: Agent, request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
    if (!hasOpenTurn(agent.session)) {
      throw new UserQuestionError('ask_user_question durable request requires an open turn', 'OUTSIDE_TURN')
    }
    const callId = request.callId as NonNullable<AskUserQuestionRequestEvent['callId']>
    let record = questionRecords(agent.session).find(entry => entry.callId === callId)
    if (record?.terminal?.outcome === 'answered' && record.terminal.answer !== undefined) {
      return record.terminal.answer
    }
    if (record?.terminal !== undefined) throw terminalQuestionError(record)
    if (record === undefined) {
      const id = UserQuestionRequestId(randomUUID())
      agent.session.append('user-questions/asked', {
        id,
        callId,
        questions: structuredClone(request.questions),
      })
      record = { id, callId, questions: structuredClone(request.questions) }
    }
    const key = this.waiterKey(agent, record.id)
    const existing = this.waiters.get(key)
    if (existing !== undefined) return existing.promise
    const completion = Promise.withResolvers<AskUserQuestionAnswer>()
    const waiter: QuestionWaiter = {
      promise: completion.promise.finally(() => { this.waiters.delete(key) }),
      resolve: completion.resolve,
      reject: completion.reject,
    }
    this.waiters.set(key, waiter)
    const durableRequest: AskUserQuestionRequest = {
      ...request,
      questions: structuredClone(record.questions),
      requestId: record.id,
      callId,
      agent,
    }
    const noAnswerer = () => Promise.reject(new UserQuestionError(
      'no user-questions answerer accepted the request', 'NO_PROVIDER'))
    void Promise.resolve().then(() => this.ctx.waterfall(
      scopeTarget(agent, agent), 'user-questions/request', durableRequest, noAnswerer,
    )).then(
      (answer) => {
        try {
          this.respond(agent, record.id, answer)
        } catch (error: unknown) {
          waiter.reject(error)
        }
      },
      (reason: unknown) => {
        const error = restoreUserQuestionError(reason)
        try {
          if (request.signal?.aborted || error instanceof UserQuestionError && error.code === 'ASK_ABORTED') {
            this.rejectPending(agent, record.id, 'cancelled', abortedQuestion(reason))
          } else if (error instanceof UserQuestionError && error.code === 'ASK_CANCELLED') {
            this.rejectPending(agent, record.id, 'cancelled', error)
          } else if (error instanceof UserQuestionError && error.code === 'NO_PROVIDER') {
            this.rejectPending(agent, record.id, 'unavailable', error)
          }
        } catch (appendError: unknown) {
          waiter.reject(appendError)
        }
        // Other transport failures leave the durable request pending so a
        // reconnected Client or a resumed Host can answer the same id.
      },
    )
    if (request.signal !== undefined) {
      const abort = (): void => {
        this.rejectPending(agent, record.id, 'cancelled', abortedQuestion(request.signal?.reason))
      }
      request.signal.addEventListener('abort', abort, { once: true })
      void waiter.promise.finally(() => { request.signal?.removeEventListener('abort', abort) }).catch(() => {})
      if (request.signal.aborted) abort()
    }
    return waiter.promise
  }
}

export default UserQuestionService
