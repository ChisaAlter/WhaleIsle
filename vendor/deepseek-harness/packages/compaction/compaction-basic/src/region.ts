/**
 * Surface retention selection and the shared log-recorded compaction
 * transaction for automatic open-turn and manual idle-session compaction.
 *
 * @module @deepseek-ai/dsh-compaction-basic/region
 */

import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import {
  CompactionId,
  ManualCompactionError,
  compactCheckpointSource,
  toolPairingBalancedAfter,
  toolPairingBalancedBefore,
} from '@deepseek-ai/dsh-compaction'
import type { CompactionResult } from '@deepseek-ai/dsh-compaction'
import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
import { createUserMessage, errorChain } from '@deepseek-ai/dsh-llm'
import type { Message, UserMessage } from '@deepseek-ai/dsh-llm'
import type { TokenMeasurement, TokenMeter } from '@deepseek-ai/dsh-token-meter'
import { SessionSeq, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { frameSummary, isOverflowOrSummarySizeFailure } from './summarizer.ts'
import type { SummarizationInput, SummaryResult } from './summarizer.ts'
interface RegionDependencies {
  readonly meter: TokenMeter
  summarize(input: SummarizationInput, agent: Agent, signal?: AbortSignal): Promise<SummaryResult>
  recover(error: unknown, agent: Agent, sourceEventSeqs: readonly SessionSeq[], signal?: AbortSignal): boolean
}

/** One validated inclusive span of current surface positions. */
interface SurfaceSelection {
  readonly start: SessionSeq
  readonly end: SessionSeq
  readonly startIdx: number
  readonly endIdx: number
  readonly shadowedSeqs: readonly SessionSeq[]
}

/** A selection with its priced snapshot and the replay input built from it. */
interface PreparedCompaction extends SurfaceSelection {
  readonly measurement: TokenMeasurement
  readonly selectedNodes: TokenMeasurement['nodes']
  readonly shadowedTokenCount: number
  /** Route-priced total of the selected span; the shrink comparison's unit. */
  readonly shadowedRouteTokenCount: number
  readonly input: SummarizationInput
}

type SummarizedCompaction = PreparedCompaction & SummaryResult & {
  readonly checkpointMessage: UserMessage
}

interface CompactionTransactionOptions {
  /** `current-turn` derives a numbered owner; `null` writes a standalone bracket. */
  readonly owner: 'current-turn' | null
  /** Surface relationship that must survive asynchronous summarization. */
  readonly stability: 'whole-surface' | 'selected-span'
  /** Optional durability checkpoint after a successfully closed bracket. */
  readonly flush?: () => Promise<void>
  /** Manual command that initiated this transaction, when present. */
  readonly sourceCommandId?: CommandId
  /** Enable zero-LLM sliding-window eviction if summarization fails on overflow/sizing. */
  readonly overflowFallback?: boolean
}

interface CompactionEntryState {
  readonly openTurn: number | null
  readonly unmatchedCompactionStart: SessionEvent<'compaction/start'> | undefined
  readonly latestEndSeedSeq: SessionSeq | undefined
}

/**
 * Rejects a summary whose replacement boundaries are no longer the ones it was
 * built from, distinguished from summarizer and shrink failures so a manual
 * caller can report the two causes differently.
 */
class SurfaceChangedError extends Error {}

/** Whether the summary may still replace the span it was built from. */
type StabilityCheck = (
  dependencies: RegionDependencies,
  session: Session,
  prepared: PreparedCompaction,
) => void

/** Failure captured after `compaction/start` has committed. */
interface TransactionFailure {
  readonly error: unknown
  readonly stage: 'summary' | 'commit'
}

/**
 * The `system/message` holding surface node 0, or `undefined` when another
 * message-producing event starts the surface.
 * @param session - session supplying the log behind the current surface.
 * @param headSeq - seq at surface node 0 of a non-empty surface.
 * @returns the system head event, or `undefined` without one.
 */
function systemHead(session: Session, headSeq: SessionSeq): SessionEvent<'system/message'> | undefined {
  // Surface nodes are current log seqs, so the event exists.
  // Existing Session history read; migration deferred.
  // oxlint-disable-next-line typescript/no-non-null-assertion, typescript/no-deprecated
  const head = session.eventAt(headSeq)!
  return head.type === 'system/message' ? head : undefined
}

const PROTECTED_BASELINE_SOURCE_KINDS: ReadonlySet<string> = new Set([
  'agent-instructions',
  'skill-catalog',
])

function isProtectedBaselineNode(session: Session, seq: SessionSeq): boolean {
  // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
  const event = session.eventAt(seq)
  if (event?.type !== 'user/message') return false
  const source = event.data.source
  if (PROTECTED_BASELINE_SOURCE_KINDS.has(source.kind)) return true
  if (source.kind !== 'user' && source.kind !== 'compact-checkpoint') {
    for (const block of event.data.content) {
      if (block.type === 'text' && block.text.includes('<available_skills>')) return true
    }
  }
  return false
}

/**
 * Resolve the next range starting at the first non-system surface node while
 * retaining a priced recent tail, protecting baseline instruction/skill-catalog
 * injections, and never splitting an assistant tool-call/result pair.
 * @param session - session supplying authoritative current surface positions.
 * @param measurement - unified pressure and surface measurement from the conversation meter.
 * @param retainTokens - minimum recent tail budget retained verbatim.
 * @returns the inclusive positional seq range to compact, or `null`.
 */
export function selectCompactableRange(
  session: Session,
  measurement: TokenMeasurement,
  retainTokens: number,
): { start: SessionSeq; end: SessionSeq } | null {
  const pricedNodes = measurement.nodes
  if (pricedNodes.length === 0) return null

  const surfaceNodes = session.surface.nodes
  if (surfaceNodes.length !== pricedNodes.length
    || surfaceNodes.some((seq, index) => seq !== pricedNodes[index]?.seq)) {
    throw new Error('compaction: token-meter surface does not match the current session surface')
  }
  // oxlint-disable-next-line typescript/no-non-null-assertion
  const firstIdx = systemHead(session, surfaceNodes[0]!) === undefined ? 0 : 1

  let accumulated = 0
  let keepFromIdx = pricedNodes.length
  for (let index = pricedNodes.length - 1; index >= 0; index -= 1) {
    // oxlint-disable-next-line typescript/no-non-null-assertion
    accumulated += pricedNodes[index]!.tokens
    keepFromIdx = index
    if (accumulated >= retainTokens) break
  }
  if (keepFromIdx <= firstIdx) return null

  while (keepFromIdx > firstIdx) {
    // oxlint-disable-next-line typescript/no-non-null-assertion
    if (toolPairingBalancedBefore(session, surfaceNodes[keepFromIdx]!)) break
    keepFromIdx -= 1
  }
  if (keepFromIdx <= firstIdx) return null

  let best: { startIdx: number; endIdx: number; tokens: number } | null = null
  let idx = firstIdx
  while (idx < keepFromIdx) {
    const idxSeq = surfaceNodes[idx]
    if (idxSeq === undefined || isProtectedBaselineNode(session, idxSeq)) {
      idx += 1
      continue
    }
    const runStart = idx
    while (idx < keepFromIdx) {
      const candidateSeq = surfaceNodes[idx]
      if (candidateSeq === undefined || isProtectedBaselineNode(session, candidateSeq)) break
      idx += 1
    }
    let s = runStart
    let e = idx - 1
    while (s <= e) {
      const startCandidate = surfaceNodes[s]
      if (startCandidate !== undefined && toolPairingBalancedBefore(session, startCandidate)) break
      s += 1
    }
    while (e >= s) {
      const endCandidate = surfaceNodes[e]
      if (endCandidate !== undefined && toolPairingBalancedAfter(session, endCandidate)) break
      e -= 1
    }
    const startSeq = surfaceNodes[s]
    const endSeq = surfaceNodes[e]
    if (s <= e
      && startSeq !== undefined
      && endSeq !== undefined
      && toolPairingBalancedBefore(session, startSeq)
      && toolPairingBalancedAfter(session, endSeq)) {
      let tokens = 0
      for (let k = s; k <= e; k += 1) tokens += pricedNodes[k]?.tokens ?? 0
      if (best === null || tokens > best.tokens) {
        best = { startIdx: s, endIdx: e, tokens }
      }
    }
  }

  if (best === null) return null
  const bestStart = surfaceNodes[best.startIdx]
  const bestEnd = surfaceNodes[best.endIdx]
  return bestStart !== undefined && bestEnd !== undefined ? { start: bestStart, end: bestEnd } : null
}

/**
 * Run the single compaction transaction over one selected positional span.
 * Selection and validation are read-only. Idle/log validation and
 * `compaction/start` are synchronously adjacent, so the durable opening marker is
 * the compaction lock before summarization yields. Every later failure makes
 * exactly one `compaction/end` attempt; a failed close deliberately leaves the
 * unmatched start detectable.
 * @param dependencies - conversation meter and dynamically dispatched summarizer hook.
 * @param session - session whose surface is mutated.
 * @param start - inclusive first surface-node seq.
 * @param end - inclusive last surface-node seq.
 * @param agent - agent used by the summarizer.
 * @param options - bracket owner, stability rule, and optional durability checkpoint.
 * @param signal - optional summarization cancellation signal.
 * @returns the successful durable compaction result.
 */
export async function compactSurfaceRegion(
  dependencies: RegionDependencies,
  session: Session,
  start: SessionSeq,
  end: SessionSeq,
  agent: Agent,
  options: CompactionTransactionOptions,
  signal?: AbortSignal,
): Promise<CompactionResult> {
  if (options.owner === null) signal?.throwIfAborted()
  const selection = validateSurfaceRegion(session, start, end)
  const entryState = inspectCompactionEntryState(session)
  assertCompactionInactive(
    entryState.unmatchedCompactionStart,
    entryState.latestEndSeedSeq,
    'compaction',
  )

  let owner: number | null
  if (options.owner === null) {
    if (entryState.openTurn !== null) {
      throw new ManualCompactionError('busy', 'manual compaction: the session already has an open turn')
    }
    owner = null
  } else {
    if (entryState.openTurn === null) {
      throw new Error('compactRegion: no open turn — automatic compaction events must be enclosed in a turn')
    }
    owner = entryState.openTurn
  }

  const compactionId = CompactionId(randomUUID())
  const lifecycle = {
    compactionId,
    ...options.sourceCommandId === undefined ? {} : { sourceCommandId: options.sourceCommandId },
    turn: owner,
  }
  const startEvent = session.append('compaction/start', lifecycle)
  const assertStable: StabilityCheck = options.stability === 'whole-surface'
    ? assertWholeSurfaceUnchanged
    : assertSelectedSpanStable
  let failure: TransactionFailure | undefined
  let flushFailure: unknown
  let result: CompactionResult | undefined
  let closed = false
  let closing = false
  let stage: TransactionFailure['stage'] = 'summary'

  try {
    const prepared = prepareCompaction(dependencies, session, selection)
    const summarized = await summarizeCompaction(
      dependencies,
      prepared,
      agent,
      compactionId,
      options.sourceCommandId,
      assertStable,
      options.overflowFallback ?? false,
      signal,
    )
    if (options.owner === null) signal?.throwIfAborted()
    assertStable(dependencies, session, summarized)
    stage = 'commit'
    const pending = commitCompactionBody(session, startEvent, summarized)
    closing = true
    const endEvent = session.append('compaction/end', lifecycle)
    closed = true
    result = completeCompaction(pending, endEvent)
  } catch (error: unknown) {
    failure = { error, stage: closing ? 'commit' : stage }
    if (!closing) {
      closing = true
      try {
        session.append('compaction/end', { ...lifecycle, error: errorChain(error) })
        closed = true
      } catch (closeError: unknown) {
        failure = { error: closeError, stage: 'commit' }
      }
    }
  }

  if (closed && options.flush !== undefined) {
    try {
      await options.flush()
    } catch (error: unknown) {
      flushFailure = error
    }
  }

  if (options.owner === null) signal?.throwIfAborted()
  if (failure !== undefined) {
    if (options.owner === null) throwManualFailure(failure)
    throw failure.error
  }
  if (flushFailure !== undefined) {
    throw new ManualCompactionError(
      'persistence',
      'manual compaction durability checkpoint failed',
      { cause: flushFailure },
    )
  }
  /* v8 ignore next -- every path without a result records and throws a failure above. */
  if (result === undefined) throw new Error('compaction committed without a result')
  return result
}

/** Classify one closed manual attempt without weakening cancellation precedence. */
function throwManualFailure(failure: TransactionFailure): never {
  if (failure.stage === 'commit') {
    throw new ManualCompactionError(
      'commit',
      'manual compaction did not commit cleanly',
      { cause: failure.error },
    )
  }
  if (failure.error instanceof SurfaceChangedError) {
    throw new ManualCompactionError(
      'changed',
      'the compacted history changed during manual compaction',
      { cause: failure.error },
    )
  }
  throw new ManualCompactionError(
    'summary',
    'manual compaction could not produce a smaller summary',
    { cause: failure.error },
  )
}

/**
 * Reject a durable unmatched compaction marker unless a later constructor-seed
 * boundary proves that its owner belongs to an earlier session lifecycle.
 * @param unmatchedCompactionStart - latest unmatched opening marker, if any.
 * @param latestEndSeedSeq - newest constructor-seed boundary, if any.
 * @param stage - operation label included in the busy diagnostic.
 */
function assertCompactionInactive(
  unmatchedCompactionStart: SessionEvent<'compaction/start'> | undefined,
  latestEndSeedSeq: SessionSeq | undefined,
  stage: string,
): void {
  if (unmatchedCompactionStart === undefined
    || (latestEndSeedSeq !== undefined
      && latestEndSeedSeq > unmatchedCompactionStart.seq)) return
  throw new ManualCompactionError(
    'busy',
    `${stage}: compaction already in progress; the session compaction lock is already active`,
  )
}

/**
 * Recheck the durable compaction lock after an asynchronous policy decision.
 * @param session - session whose latest marker state is inspected.
 * @param stage - operation label included in the busy diagnostic.
 */
export function assertNoActiveCompaction(session: Session, stage: string): void {
  const entryState = inspectCompactionEntryState(session)
  assertCompactionInactive(
    entryState.unmatchedCompactionStart,
    entryState.latestEndSeedSeq,
    stage,
  )
}

/** Validate one requested surface-position span before asynchronous work begins. */
function validateSurfaceRegion(session: Session, start: SessionSeq, end: SessionSeq): SurfaceSelection {
  const nodes = session.surface.nodes
  const startIdx = nodes.indexOf(start)
  const endIdx = nodes.indexOf(end)
  if (startIdx === -1) throw new Error(`compactRegion: start seq ${start} not found in surface`)
  if (endIdx === -1) throw new Error(`compactRegion: end seq ${end} not found in surface`)
  if (startIdx > endIdx) {
    throw new Error(
      `compactRegion: start seq ${start} (position ${startIdx}) is after end seq ${end} (position ${endIdx}) on the surface`,
    )
  }
  // oxlint-disable-next-line typescript/no-non-null-assertion
  if (!toolPairingBalancedBefore(session, nodes[startIdx]!)) {
    throw new Error(`compactRegion: start seq ${start} is not a balanced boundary (would split a step's tool-call/result pair)`)
  }
  // oxlint-disable-next-line typescript/no-non-null-assertion
  if (!toolPairingBalancedAfter(session, nodes[endIdx]!)) {
    throw new Error(`compactRegion: end seq ${end} is not a balanced boundary (would split a step, or the step is still open)`)
  }

  return { start, end, startIdx, endIdx, shadowedSeqs: nodes.slice(startIdx, endIdx + 1) }
}

/** Snapshot pricing and replay input for a validated surface range. */
function prepareCompaction(
  dependencies: RegionDependencies,
  session: Session,
  selection: SurfaceSelection,
): PreparedCompaction {
  const measurement = dependencies.meter.measure(session)
  const selectedNodes = measurement.nodes.slice(selection.startIdx, selection.endIdx + 1)
  if (selectedNodes.length !== selection.shadowedSeqs.length
    || selectedNodes.some((node, index) => node.seq !== selection.shadowedSeqs[index])) {
    throw new SurfaceChangedError('compaction: selected surface changed before summarization began')
  }
  return {
    ...selection,
    measurement,
    selectedNodes,
    // The shadow-price protocol prices replacements with the fixed heuristic
    // so the O(1) projection fold stays in agreement with its own appends;
    // retention, range selection, and the shrink comparison read the
    // route-priced `tokens` instead.
    shadowedTokenCount: selectedNodes.reduce((total, node) => total + node.heuristicTokens, 0),
    shadowedRouteTokenCount: selectedNodes.reduce((total, node) => total + node.tokens, 0),
    input: buildSummarizationInput(session, selection.shadowedSeqs),
  }
}

function buildOmissionPlaceholder(
  session: Session,
  prepared: PreparedCompaction,
): Extract<Message['content'][number], { type: 'text' }>[] {
  const counts = { user: 0, assistant: 0, tool: 0, other: 0 }
  for (const seq of prepared.shadowedSeqs) {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const event = session.eventAt(seq)
    if (event?.type === 'user/message') counts.user += 1
    else if (event?.type === 'assistant/message') counts.assistant += 1
    else if (event?.type === 'tool/result') counts.tool += 1
    else counts.other += 1
  }
  const breakdown = [
    counts.user > 0 ? `${counts.user} user` : '',
    counts.assistant > 0 ? `${counts.assistant} assistant` : '',
    counts.tool > 0 ? `${counts.tool} tool_result` : '',
    counts.other > 0 ? `${counts.other} other` : '',
  ].filter(Boolean).join(', ')
  return [{
    type: 'text',
    text: `[Deterministic context-overflow fallback: omitted ${prepared.shadowedSeqs.length} oldest compactable nodes (${breakdown}; ~${prepared.shadowedRouteTokenCount} tokens; seqs ${prepared.start}..${prepared.end}) while preserving tool_call/tool_result pairing.]`,
  }]
}

function buildDeterministicOverflowFallback(
  dependencies: RegionDependencies,
  session: Session,
  prepared: PreparedCompaction,
  compactionId: CompactionResult['compactionId'],
  sourceCommandId: CommandId | undefined,
): SummarizedCompaction | null {
  const surfaceNodes = session.surface.nodes
  const halfTarget = Math.max(1, Math.ceil(prepared.shadowedRouteTokenCount * 0.5))
  let windowTokens = 0

  for (let idx = prepared.startIdx; idx <= prepared.endIdx; idx += 1) {
    windowTokens += prepared.measurement.nodes[idx]?.tokens ?? 0
    const isLast = idx === prepared.endIdx
    if (!isLast && windowTokens < halfTarget) continue
    const endSeq = surfaceNodes[idx]
    if (endSeq === undefined || !toolPairingBalancedAfter(session, endSeq)) continue

    const sliceSelection = validateSurfaceRegion(session, prepared.start, endSeq)
    const slicePrepared = idx === prepared.endIdx
      ? prepared
      : prepareCompaction(dependencies, session, sliceSelection)
    const detailedBlocks = buildOmissionPlaceholder(session, slicePrepared)
    const compactBlocks = [{
      type: 'text' as const,
      text: `[Omitted ${slicePrepared.shadowedSeqs.length} older nodes (${slicePrepared.shadowedRouteTokenCount} tokens) due to context overflow]`,
    }]

    const candidates: Array<{ summary: typeof detailedBlocks; content: typeof detailedBlocks }> = [
      { summary: detailedBlocks, content: frameSummary(detailedBlocks) as typeof detailedBlocks },
      { summary: detailedBlocks, content: detailedBlocks },
      { summary: compactBlocks, content: compactBlocks },
    ]
    for (const candidate of candidates) {
      const checkpointMessage = createUserMessage({
        content: candidate.content,
        source: compactCheckpointSource(compactionId, sourceCommandId),
      })
      if (dependencies.meter.estimateMessage(checkpointMessage) < slicePrepared.shadowedRouteTokenCount) {
        return {
          ...slicePrepared,
          summary: candidate.summary,
          provider: 'deterministic-fallback',
          model: 'sliding-window-eviction',
          checkpointMessage,
        }
      }
    }
  }
  return null
}

/** Run the summarizer and frame its replacement checkpoint. */
async function summarizeCompaction(
  dependencies: RegionDependencies,
  prepared: PreparedCompaction,
  agent: Agent,
  compactionId: CompactionResult['compactionId'],
  sourceCommandId: CommandId | undefined,
  assertStable: StabilityCheck,
  overflowFallback: boolean,
  signal?: AbortSignal,
): Promise<SummarizedCompaction> {
  try {
    let summaryResult: SummaryResult
    for (;;) {
      signal?.throwIfAborted()
      try {
        summaryResult = await dependencies.summarize(prepared.input, agent, signal)
        break
      } catch (error: unknown) {
        if (signal?.aborted === true) throw error
        assertStable(dependencies, agent.session, prepared)
        if (!dependencies.recover(error, agent, prepared.shadowedSeqs, signal)) throw error
        prepared = prepareCompaction(dependencies, agent.session,
          validateSurfaceRegion(agent.session, prepared.start, prepared.end))
      }
    }
    const checkpointMessage = createUserMessage({
      content: frameSummary(summaryResult.summary),
      source: compactCheckpointSource(compactionId, sourceCommandId),
    })
    // The checkpoint is text-only, so its fixed-heuristic price IS its route
    // price; comparing it against the span's route price asks the real
    // question — does the replacement lower the next request's pressure.
    const framedSummaryTokenCount = dependencies.meter.estimateMessage(checkpointMessage)
    if (framedSummaryTokenCount >= prepared.shadowedRouteTokenCount) {
      throw new Error(
        `summary is not smaller than the shadowed content (${framedSummaryTokenCount} estimated framed tokens >= ${prepared.shadowedRouteTokenCount})`,
      )
    }
    return {
      ...prepared,
      ...summaryResult,
      checkpointMessage,
    }
  } catch (error: unknown) {
    if (signal?.aborted === true || !overflowFallback || !isOverflowOrSummarySizeFailure(error)) {
      throw error
    }
    assertStable(dependencies, agent.session, prepared)
    const fallback = buildDeterministicOverflowFallback(
      dependencies,
      agent.session,
      prepared,
      compactionId,
      sourceCommandId,
    )
    if (fallback === null) throw error
    return fallback
  }
}

/** Reject a summary prepared against any earlier surface generation. */
function assertWholeSurfaceUnchanged(
  dependencies: RegionDependencies,
  session: Session,
  prepared: PreparedCompaction,
): void {
  const current = dependencies.meter.measure(session)
  if (!isDeepStrictEqual(current.nodes, prepared.measurement.nodes)) {
    throw new SurfaceChangedError('compaction: session surface changed during summarization')
  }
}

/**
 * Require only that the selected span remain the same present, contiguous,
 * equally priced, balanced replacement target. Nodes added outside it remain
 * visible and do not invalidate the summary.
 */
function assertSelectedSpanStable(
  dependencies: RegionDependencies,
  session: Session,
  prepared: PreparedCompaction,
): void {
  let current: SurfaceSelection
  try {
    current = validateSurfaceRegion(session, prepared.start, prepared.end)
  } catch (error: unknown) {
    throw new SurfaceChangedError(
      'compaction: the selected span is no longer a valid replacement target',
      { cause: error },
    )
  }
  if (!isDeepStrictEqual([...current.shadowedSeqs], [...prepared.shadowedSeqs])) {
    throw new SurfaceChangedError('compaction: the selected span changed during summarization')
  }
  const measured = dependencies.meter.measure(session).nodes.slice(current.startIdx, current.endIdx + 1)
  if (!isDeepStrictEqual(measured, prepared.selectedNodes)) {
    throw new SurfaceChangedError('compaction: the selected span was rewritten during summarization')
  }
}

/** Append one completed summary record and replacement body without yielding. */
function commitCompactionBody(
  session: Session,
  startEvent: SessionEvent<'compaction/start'>,
  summarized: SummarizedCompaction,
): Omit<CompactionResult, 'endSeq'> {
  const {
    start,
    end,
    shadowedSeqs,
    shadowedTokenCount,
    summary,
    provider,
    model,
    maxTokens,
    usage,
    checkpointMessage,
  } = summarized
  const callRecord = summarized.llmStreamCall === true
    ? { rawOutput: summarized.rawOutput, llmStreamCall: true as const }
    : summarized.rawOutput === undefined ? {} : { rawOutput: summarized.rawOutput }
  const summaryEvent = session.append('compaction/summary', {
    compactionId: startEvent.data.compactionId,
    ...startEvent.data.sourceCommandId === undefined
      ? {}
      : { sourceCommandId: startEvent.data.sourceCommandId },
    summary,
    ...callRecord,
    shadowedRange: { start, end },
    shadowedSeqs: [...shadowedSeqs],
    shadowedTokenCount,
    provider,
    model,
    ...maxTokens === undefined ? {} : { maxTokens },
    ...usage === undefined ? {} : { usage },
  })
  session.append('user/message', checkpointMessage, {
    surfaceOp: { op: 'replace', startSeq: start, endSeq: end },
    sourceEventSeqs: [startEvent.seq, summaryEvent.seq, ...shadowedSeqs],
  })
  return {
    compactionId: startEvent.data.compactionId,
    ...startEvent.data.sourceCommandId === undefined
      ? {}
      : { sourceCommandId: startEvent.data.sourceCommandId },
    startSeq: startEvent.seq,
    summarySeq: summaryEvent.seq,
    summary,
    shadowedRange: { start, end },
    shadowedSeqs: [...shadowedSeqs],
    shadowedTokenCount,
  }
}

/** Attach the successfully appended close event to a pending result. */
function completeCompaction(
  pending: Omit<CompactionResult, 'endSeq'>,
  endEvent: SessionEvent<'compaction/end'>,
): CompactionResult {
  return { ...pending, endSeq: endEvent.seq }
}

/**
 * Reconstruct the last routed request's cacheable prefix for the shadowed
 * region: the system prompt held by the `system/message` at surface node 0,
 * the header's tool schemas, then the region's own derived messages in surface
 * order. The summarizer appends only the compaction instruction after this, so
 * the call is a genuine prefix of the conversation and reuses the provider's
 * KV cache. A surface without a system head, or whose head projects to no
 * message, contributes no leading system message.
 * @param session - session supplying the surface head, request header, and per-node projection.
 * @param shadowedSeqs - the surface-node seqs, in order, being compacted.
 * @returns the replayed conversation prefix to condense.
 */
function buildSummarizationInput(
  session: Session,
  shadowedSeqs: readonly SessionSeq[],
): SummarizationInput {
  const header = session.requestHeader()
  // shadowedSeqs are current surface seqs, so the surface has a node 0.
  // oxlint-disable-next-line typescript/no-non-null-assertion
  const head = systemHead(session, session.surface.nodes[0]!)
  const system = head === undefined ? null : session.deriveEventMessage(head)
  const regionMessages = shadowedSeqs
    // shadowedSeqs are current surface seqs, so each is a valid log index.
    // Existing Session history read; migration deferred.
    // oxlint-disable-next-line typescript/no-non-null-assertion, typescript/no-deprecated
    .map(seq => session.deriveEventMessage(session.eventAt(seq)!))
    .filter((message): message is Message => message !== null)
  return {
    ...header?.tools === undefined ? {} : { tools: header.tools },
    messages: system === null ? regionMessages : [system, ...regionMessages],
  }
}

/** Inspect open-turn, unmatched-compaction, and latest seed-boundary state independently. */
function inspectCompactionEntryState(session: Session): CompactionEntryState {
  let openTurn: number | null = null
  let openTurnStateKnown = false
  let unmatchedCompactionStart: SessionEvent<'compaction/start'> | undefined
  let compactionEntryStateKnown = false
  let latestEndSeedSeq: SessionSeq | undefined
  for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
    // Existing Session history read; migration deferred.
    // oxlint-disable-next-line typescript/no-non-null-assertion, typescript/no-deprecated
    const event = session.eventAt(SessionSeq(seq))!
    if (latestEndSeedSeq === undefined && event.type === 'session/end-seed') {
      latestEndSeedSeq = event.seq
    }
    if (!compactionEntryStateKnown) {
      if (event.type === 'compaction/start') {
        unmatchedCompactionStart = event
        compactionEntryStateKnown = true
      } else if (event.type === 'compaction/end') {
        compactionEntryStateKnown = true
      }
    }
    if (!openTurnStateKnown) {
      if (event.type === 'turn/start') {
        openTurn = event.data.turn
        openTurnStateKnown = true
      } else if (event.type === 'turn/end') {
        openTurnStateKnown = true
      }
    }
    if (openTurnStateKnown
      && compactionEntryStateKnown
      && latestEndSeedSeq !== undefined) break
  }
  return { openTurn, unmatchedCompactionStart, latestEndSeedSeq }
}
