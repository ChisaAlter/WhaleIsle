/**
 * Schedules one assistant step's tool calls. Exclusive calls form barriers;
 * parallel calls use a bounded rolling pool and are reclassified before start.
 * Dispatch may overlap, while policy, results, and result context remain
 * model-ordered. Abort or an internal scheduler failure stops replenishment
 * and drains started calls.
 *
 * Abort records synthetic error results for skipped calls so replay stays
 * valid. A terminal scheduler failure rejects after draining; the owning step
 * records conservative recovery results before closing.
 * @module dsh-tools/batch
 */

import { ToolBatchExecutionError } from './executor.ts'
import { TOOL_ABORTED, TOOL_ABORTED_BEFORE_DISPATCH } from './contracts.ts'
import type { ToolBatchInput, ToolBatchResult, ToolCallResult } from './executor.ts'
import { createToolResultMessage, type ToolCallBlock } from '@deepseek-ai/dsh-llm'
import type { SessionSeq, UserMessage } from '@deepseek-ai/dsh-session'
import type { ToolExecutionInput, ToolExecutionMode, ToolExecutionResult, ToolRunContext } from './contracts.ts'
import type { ScheduledToolDispatch, ToolExecutionPipeline } from './pipeline.ts'
import { assertNever } from '@deepseek-ai/dsh-util-values'

/** Default bound in milliseconds for draining started tool dispatches after abort. */
export const DEFAULT_ABORT_DRAIN_TIMEOUT_MS = 5_000

const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Scheduler overrides for executing a batch of tool calls. */
export interface ExecuteToolBatchOptions {
  /**
   * Maximum milliseconds to wait for already-dispatched tool bodies to settle
   * once `signal` aborts. Unsettled calls are detached and recorded with
   * {@link TOOL_ABORTED}. Defaults to {@link DEFAULT_ABORT_DRAIN_TIMEOUT_MS}.
   */
  readonly abortDrainTimeoutMs?: number
}

/** One tool call after argument parsing, ready to schedule. */
interface PlannedCall {
  block: ToolCallBlock
  exec: ToolExecutionInput
}

/** Settled dispatch awaiting model-order finalization. */
type Slot = ScheduledToolDispatch & { exec: ToolRunContext }

/** One scheduler group outcome, including a drained cancellation. */
interface GroupOutcome {
  consumed: number
  aborted: boolean
  /** Whether any committed result carried {@link ToolExecutionResult.concludesTurn}. */
  concluded: boolean
}

/**
 * Execute raw calls with ordered policy and results around overlapping tool bodies.
 * Abort drains started calls and synthesizes results for skipped calls. Internal
 * failures drain before rejecting with the already committed results and context.
 * @param input - raw calls, optional concurrency override, and optional Session owner.
 * @param pipeline - executor-owned invocation implementation.
 * @param maxParallel - reads the executor's current validated limit when input has no override.
 * @param options - optional scheduler overrides such as {@link ExecuteToolBatchOptions.abortDrainTimeoutMs}.
 * @returns model-ordered outcomes after every started body has settled, or after
 *   {@link ExecuteToolBatchOptions.abortDrainTimeoutMs} detaches hung calls on abort.
 * @throws RangeError when the explicit concurrency override or abort drain timeout is invalid.
 */
export async function executeToolBatch(
  input: ToolBatchInput,
  pipeline: ToolExecutionPipeline,
  maxParallel: () => number,
  options?: ExecuteToolBatchOptions,
): Promise<ToolBatchResult> {
  const { calls: toolCalls, signal, agent, toolSet, maxParallelToolCalls } = input
  if (maxParallelToolCalls !== undefined && (!Number.isInteger(maxParallelToolCalls) || maxParallelToolCalls < 1)) {
    throw new RangeError('maxParallelToolCalls must be a positive integer')
  }
  const abortDrainTimeoutMs = options?.abortDrainTimeoutMs ?? DEFAULT_ABORT_DRAIN_TIMEOUT_MS
  if (!Number.isFinite(abortDrainTimeoutMs) || abortDrainTimeoutMs < 0 || abortDrainTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new RangeError(`abortDrainTimeoutMs must be a non-negative finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  const settlement = new BatchSettlement(input)
  try {
    // Inputs are distinct because tools/execute wrappers may replace `exec.signal`.
    const planned: PlannedCall[] = toolCalls.map(block => ({
      block,
      exec: {
        callId: block.id,
        name: block.name,
        arguments: parseArguments(block.arguments),
        ...agent === undefined ? {} : { agent },
        ...toolSet === undefined ? {} : { toolSet },
        signal,
      },
    }))

    let next = 0
    let concluded = false
    while (next < planned.length) {
      // Commit before classifying again so registry changes affect unstarted calls.
      // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded by the loop condition
      const first = planned[next]!
      const mode = pipeline.executionMode(first.exec).kind
      const group = mode === 'parallel' ? planned.slice(next) : [first]
      const outcome = await runGroup(
        pipeline, settlement, maxParallelToolCalls ?? maxParallel(), group, mode, signal, abortDrainTimeoutMs,
      )
      next += outcome.consumed
      concluded ||= outcome.concluded
      if (outcome.aborted) {
        for (const call of planned.slice(next)) settlement.skip(call.block)
        return settlement.result(concluded)
      }
    }
    return settlement.result(concluded)
  } catch (error: unknown) {
    throw new ToolBatchExecutionError(error, settlement.result())
  }
}

const VALID_JSON_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't'])

function isControlCharacter(char: string): boolean {
  const codePoint = char.codePointAt(0)
  return codePoint !== undefined && codePoint >= 0x00 && codePoint <= 0x1f
}

function escapeControlCharacter(char: string): string {
  switch (char) {
    case '\b': return '\\b'
    case '\f': return '\\f'
    case '\n': return '\\n'
    case '\r': return '\\r'
    case '\t': return '\\t'
    default: return `\\u${(char.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}`
  }
}

/** Conservatively repair control characters, invalid string escapes, and trailing commas in JSON arguments. */
function repairJsonArguments(raw: string): string {
  let repaired = ''
  let inString = false
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]
    if (char === undefined) continue
    if (!inString) {
      if (char === '"') {
        inString = true
        repaired += char
        continue
      }
      if (char === ',') {
        let lookahead = index + 1
        while (lookahead < raw.length && (raw[lookahead] === ' ' || raw[lookahead] === '\t' || raw[lookahead] === '\n' || raw[lookahead] === '\r')) {
          lookahead++
        }
        const next = raw[lookahead]
        if (next === '}' || next === ']') continue
      }
      repaired += char
      continue
    }
    if (char === '"') {
      inString = false
      repaired += char
      continue
    }
    if (char === '\\') {
      const nextChar = raw[index + 1]
      if (nextChar === undefined) {
        repaired += '\\\\'
        continue
      }
      if (nextChar === 'u') {
        const unicodeDigits = raw.slice(index + 2, index + 6)
        if (/^[0-9a-fA-F]{4}$/.test(unicodeDigits)) {
          repaired += `\\u${unicodeDigits}`
          index += 5
          continue
        }
      }
      if (VALID_JSON_ESCAPES.has(nextChar)) {
        repaired += `\\${nextChar}`
        index += 1
        continue
      }
      repaired += '\\\\'
      continue
    }
    repaired += isControlCharacter(char) ? escapeControlCharacter(char) : char
  }
  return repaired
}

/** Parse model arguments, repairing mild syntax flaws and preserving unrecoverable or string-literal input as text. */
function parseArguments(raw: string): unknown {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'string' ? raw : parsed
  } catch {
    const repaired = repairJsonArguments(raw)
    if (repaired !== raw) {
      try {
        const parsed: unknown = JSON.parse(repaired)
        return typeof parsed === 'string' ? raw : parsed
      } catch {
        // Fall through and preserve raw malformed input for tool-owned diagnostics.
      }
    }
    // Preserve malformed model input for tool-owned argument diagnostics.
    return raw
  }
}

/**
 * Run one exclusive barrier or parallel pool. Later calls are reclassified
 * before start; an exclusive reclassification waits for the current pool to
 * drain and remains for the caller's next barrier. Results and contexts commit
 * in model order. Abort stops starts, drains and commits started calls, accepts
 * their contexts into the owning batch, records results for skipped calls, and
 * returns an aborted outcome. Scheduler failure drains dispatches and rejects
 * for the owning step to record recovery results.
 */
function abortedStartedToolResult(): ToolExecutionResult {
  return {
    content: [{ type: 'text', text: 'Error: tool call aborted' }],
    isError: true,
    error: {
      message: 'tool call aborted',
      info: { name: 'AbortError', code: TOOL_ABORTED },
    },
  }
}

async function runGroup(
  pipeline: ToolExecutionPipeline,
  settlement: BatchSettlement,
  maxParallelToolCalls: number,
  group: PlannedCall[],
  mode: ToolExecutionMode['kind'],
  signal: AbortSignal,
  abortDrainTimeoutMs: number,
): Promise<GroupOutcome> {
  const slots: (Slot | undefined)[] = group.map(() => undefined)
  // Started slots retain their `tool/call` seq so the result can cite it.
  const callSeqs: Array<SessionSeq | undefined> = group.map(() => undefined)
  let nextToStart = 0
  let committed = 0
  let started = 0
  let aborted: boolean = signal.aborted
  let concluded = false
  let schedulerFailure: { error: unknown } | undefined
  let drainTimedOut = false
  let drainArmed = false
  let drainTimer: ReturnType<typeof setTimeout> | undefined
  const { promise: drainExpired, resolve: resolveDrainExpired } = Promise.withResolvers<'drain-timeout'>()
  const armDrainTimer = (): void => {
    if (drainArmed) return
    drainArmed = true
    if (abortDrainTimeoutMs <= 0) {
      drainTimedOut = true
      resolveDrainExpired('drain-timeout')
      return
    }
    drainTimer = setTimeout(() => {
      drainTimedOut = true
      resolveDrainExpired('drain-timeout')
    }, abortDrainTimeoutMs)
  }
  const onAbort = (): void => {
    aborted = true
    armDrainTimer()
  }
  if (signal.aborted) {
    armDrainTimer()
  } else {
    signal.addEventListener('abort', onAbort, { once: true })
  }
  const throwSchedulerFailure = (): void => {
    if (schedulerFailure !== undefined) throw schedulerFailure.error
  }

  // `committed` advances only across contiguous model-order slots.
  const commitReady = async (): Promise<void> => {
    while (committed < group.length) {
      const slot = slots[committed]
      if (slot === undefined) break
      const call = group[committed]
      const result = await pipeline.complete(slot.exec, slot)
      // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded index
      settlement.commit(call!.block, result, callSeqs[committed])
      concluded ||= result.concludesTurn === true
      committed++
    }
  }

  const inFlight = new Map<number, Promise<number>>()
  const detachInFlight = (): void => {
    for (const promise of inFlight.values()) {
      promise.catch(() => {
        // Detached after abort drain timeout; suppress unhandled late rejections.
      })
    }
  }

  const startCall = async (index: number): Promise<void> => {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded index
    const call = group[index]!
    callSeqs[index] = settlement.start(call.block)
    started++
    const prepared = await pipeline.prepare(call.exec)
    throwSchedulerFailure()
    switch (prepared.kind) {
      case 'dispatch': {
        const promise = pipeline.dispatch(prepared.exec).then(
          (outcome) => {
            if (drainTimedOut) return index
            slots[index] = { ...outcome, exec: prepared.exec }
            return index
          },
          (error: unknown) => {
            if (drainTimedOut) return index
            schedulerFailure ??= { error }
            return index
          },
        )
        inFlight.set(index, promise)
        break
      }
      case 'post-result':
      case 'final-result':
        slots[index] = prepared
        break
      /* v8 ignore next -- closed-union exhaustiveness guard */
      default:
        assertNever(prepared, 'tool-call scheduler prepare result')
    }
  }

  const fillPool = async (): Promise<void> => {
    while (!aborted && nextToStart < group.length && inFlight.size < maxParallelToolCalls) {
      // Re-read later modes after ordered commits so registry changes can create a barrier.
      // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded by the loop condition
      const nextCall = group[nextToStart]!
      if (nextToStart > 0 && mode === 'parallel'
        && pipeline.executionMode(nextCall.exec).kind !== 'parallel') break
      await startCall(nextToStart)
      nextToStart++
      throwSchedulerFailure()
      await commitReady()
      throwSchedulerFailure()
      // Abort may arrive while pre-execute awaits.
      if (signal.aborted) {
        aborted = true
        armDrainTimer()
      }
    }
  }

  // Ordered pre-execute may await; only dispatch/body overlaps. A scheduler
  // failure stops new dispatches and reaches the turn boundary after every
  // already-started dispatch settles (or after abortDrainTimeoutMs on abort).
  try {
    try {
      await fillPool()
      while (inFlight.size > 0) {
        const raceOutcome = await Promise.race([Promise.race(inFlight.values()), drainExpired])
        if (raceOutcome === 'drain-timeout') {
          aborted = true
          drainTimedOut = true
          detachInFlight()
          break
        }
        inFlight.delete(raceOutcome)
        throwSchedulerFailure()
        await commitReady()
        throwSchedulerFailure()
        // Abort may arrive while a tool or ordered commit awaits.
        if (signal.aborted) {
          aborted = true
          armDrainTimer()
        }
        await fillPool()
      }
      if (drainTimedOut) {
        // Commit already-finished slots and synthesize TOOL_ABORTED for timed-out started calls in model order.
        while (committed < started) {
          const slot = slots[committed]
          // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded index
          const call = group[committed]!
          if (slot !== undefined) {
            const result = await pipeline.complete(slot.exec, slot)
            settlement.commit(call.block, result, callSeqs[committed])
            concluded ||= result.concludesTurn === true
          } else {
            settlement.commit(call.block, abortedStartedToolResult(), callSeqs[committed])
          }
          inFlight.delete(committed)
          committed++
        }
      }
    } catch (error: unknown) {
      schedulerFailure ??= { error }
      if (!drainTimedOut && inFlight.size > 0) {
        if (signal.aborted) {
          aborted = true
          armDrainTimer()
        }
        const allSettled = Promise.allSettled(inFlight.values()).then(() => 'settled' as const)
        const outcome = await Promise.race([allSettled, drainExpired])
        if (outcome === 'drain-timeout') {
          drainTimedOut = true
          detachInFlight()
        }
      }
      throw schedulerFailure.error
    }
  } finally {
    signal.removeEventListener('abort', onAbort)
    if (drainTimer !== undefined) clearTimeout(drainTimer)
  }

  if (aborted) {
    // Started calls and accepted context settle first; every remaining model
    // call then receives an ordered synthetic result before the turn aborts.
    for (const call of group.slice(started)) settlement.skip(call.block)
    return { consumed: group.length, aborted: true, concluded }
  }
  /* v8 ignore next -- unreachable: a non-aborted group commits every started call */
  if (committed !== started) throw new Error('tool-call scheduler: uncommitted settled calls')
  return { consumed: started, aborted: false, concluded }
}

/** Collect committed results and optionally append their durable Session events. */
class BatchSettlement {
  private readonly results: ToolCallResult[] = []
  private readonly contexts: UserMessage[] = []

  constructor(private readonly input: ToolBatchInput) {}

  start(block: ToolCallBlock): SessionSeq | undefined {
    if (this.input.log === undefined) return undefined
    const recorded = this.input.recordedCalls?.get(block.id)
    if (recorded !== undefined) return recorded
    const { agent, log: { turn, step } } = this.input
    // oxlint-disable-next-line typescript/no-non-null-assertion -- ToolBatchInput requires agent whenever log is provided
    return agent!.session.append('tool/call', {
      turn, step, callId: block.id, name: block.name, arguments: block.arguments,
    }).seq
  }

  commit(block: ToolCallBlock, result: ToolExecutionResult, callSeq: SessionSeq | undefined): void {
    if (this.input.log !== undefined) {
      const { agent, log: { turn, step } } = this.input
      // oxlint-disable-next-line typescript/no-non-null-assertion -- ToolBatchInput requires agent whenever log is provided
      agent!.session.append('tool/result', {
        turn, step,
        message: createToolResultMessage({ callId: block.id, content: result.content, isError: result.isError }),
        ...result.error?.info ? { error: result.error.info } : {},
        ...result.meta !== undefined ? { meta: result.meta } : {},
      }, {
        surfaceOp: 'append',
        // oxlint-disable-next-line typescript/no-non-null-assertion -- start records a call seq whenever this batch logs results
        sourceEventSeqs: [callSeq!],
      })
    }
    this.results.push({ callId: block.id, result })
    this.contexts.push(...result.additionalContexts ?? [])
  }

  skip(block: ToolCallBlock): void {
    this.commit(block, {
      content: [{ type: 'text', text: 'Error: tool call aborted before dispatch' }],
      isError: true,
      error: {
        message: 'tool call aborted before dispatch',
        info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH },
      },
    }, this.start(block))
  }

  result(concluded = this.results.some(({ result }) => result.concludesTurn === true)): ToolBatchResult {
    return { results: this.results, additionalContexts: this.contexts, concluded }
  }
}
