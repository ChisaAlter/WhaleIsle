/**
 * Default one-shot summarization and durable checkpoint framing.
 *
 * @module @deepseek-ai/dsh-compaction-basic/summarizer
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  contentHasImage,
  BlockAssembler,
  CONTEXT_WINDOW_EXCEEDED_CODE,
  createUserMessage,
  LlmError,
} from '@deepseek-ai/dsh-llm'
import { estimateContent, estimateMessage, estimateToolsTokens, ROLE_OVERHEAD } from '@deepseek-ai/dsh-token-meter/estimate'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import type {
  ContentBlock, FinishReason, GenerateOptions, Message, RequestMessage, TokenUsage, ToolSchema,
} from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'

const SAFE_SUMMARY_INPUT_RATIO = 0.65
const SAFE_SUMMARY_MIN_HEADROOM = 64

const OVERFLOW_FAILURE_MESSAGE_PATTERN = new RegExp([
  'context[_ -]?window',
  'context[_ -]?length',
  'too many tokens',
  'maximum context',
  'exceeds.*context',
  'prompt is too long',
  'summary is not smaller',
  'summarization truncated',
  'summarization produced no text',
].join('|'), 'i')

/** Detect model/sizing errors that should trigger deterministic overflow eviction rather than retrying the same LLM call. */
export function isOverflowOrSummarySizeFailure(error: unknown): boolean {
  if (error instanceof LlmError && error.code === CONTEXT_WINDOW_EXCEEDED_CODE) return true
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
  if (code === CONTEXT_WINDOW_EXCEEDED_CODE
    || code === 'MAX_TOKENS'
    || code === 'PROMPT_TOO_LONG'
    || code === 'REQUEST_TOO_LARGE'
    || code === 'TOO_MANY_TOKENS') {
    return true
  }
  if (!(error instanceof Error)) return false
  return OVERFLOW_FAILURE_MESSAGE_PATTERN.test(error.message)
}

interface SummaryConfig {
  readonly summarizationProvider: string
  readonly summarizationModel: string
  readonly maxTokens: number
}

/** Tags wrapping the structured summary inside the landed checkpoint node. */
const SUMMARY_OPEN_TAG = '<compacted-summary>'
const SUMMARY_CLOSE_TAG = '</compacted-summary>'

/**
 * The summarization directive, delivered as the FINAL user message after the
 * replayed conversation rather than as a distinct summarizer system prompt.
 * Keeping the conversation's own system prompt, tools, and message prefix in
 * front of it makes the auxiliary call a genuine prefix of the last routed
 * request, so the provider's KV cache is reused instead of invalidated.
 */
const COMPACTION_INSTRUCTION = [
  'You are now acting as a compaction engine for this AI coding assistant. Condense the conversation ABOVE into a structured checkpoint that lets another model resume the work with no loss of essential context.',
  '',
  'Output EXACTLY the Markdown structure below: keep every section, in order. Use terse bullets, not prose paragraphs. Write "(none)" for an empty section — never drop a section.',
  '',
  '## Primary Request and Intent',
  "- [the user's original and evolving goals; quote verbatim where the exact wording matters]",
  '',
  '## Key Technical Concepts',
  '- [technologies, frameworks, patterns, and conventions in play]',
  '',
  '## Files and Code',
  '- [exact path: why it matters, key changes or snippets]',
  '',
  '## Errors and Fixes',
  '- [error: how it was resolved, plus any related user feedback]',
  '',
  '## Pending Jobs',
  '- [explicitly requested work not yet completed]',
  '',
  '## Current Work',
  '- [precisely what was in progress at this checkpoint]',
  '',
  '## Next Step',
  '- [the single next action, directly in line with the most recent request, or "(none)"]',
  '',
  '## Critical Context',
  '- [decisions and their rationale, constraints, user preferences, open questions, data needed to continue]',
  '',
  'Rules:',
  '- Write concise English engineering prose. Preserve exact file paths, commands, error strings, identifiers, numeric values, function signatures, and syntax fragments.',
  '- Capture user feedback and explicit instructions faithfully, especially corrections.',
  '- Do NOT mention this summarization request or that the context was compacted.',
  '- Output only the checkpoint text: do not call any tool or take any other action.',
  `- If the conversation already contains a ${SUMMARY_OPEN_TAG} block, it is a PRIOR checkpoint. Do not copy it forward verbatim: preserve still-true facts, drop stale ones, and merge newer information into a single consolidated summary under the same structure.`,
].join('\n')

/** Framing that makes the replacement user message established context. */
const CHECKPOINT_PREAMBLE =
  'This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.'

/**
 * The replayed conversation surface the summarizer condenses. Reproducing the
 * last routed request's system prompt, tools, and leading messages verbatim
 * lets the auxiliary call reuse the provider's warm prefix cache; the trailing
 * compaction instruction is then the only novel input.
 */
export interface SummarizationInput {
  /** The conversation's tool schemas, reused for prefix-cache alignment; absent when the request carried none. */
  readonly tools?: readonly ToolSchema[]
  /** The derived system head, when present, followed by the shadowed region in surface order. */
  readonly messages: readonly Message[]
}

/** Safe summary content plus the exact auxiliary call envelope recorded with it. */
export type SummaryResult = {
  summary: ContentBlock[]
  provider: string
  model: string
  maxTokens?: number
  /** Provider-reported usage for this summarization request. */
  usage?: TokenUsage
} & (
  | {
    /** Complete provider output before the text-only summary projection. */
    rawOutput: ContentBlock[]
    /** Identifies exactly one call through this context's `ctx.llm.stream()`. */
    llmStreamCall: true
  }
  | {
    /** Optional complete output from an unmarked template, remote, or other summarizer. */
    rawOutput?: ContentBlock[]
    /** An unmarked result does not identify a call through this context's LLM seam. */
    llmStreamCall?: never
  }
)

/**
 * Run the default cache-reusing `ctx.llm.stream()` summarization call: replay
 * the conversation prefix, then append the compaction instruction as the final
 * user message so the provider's warm prefix cache is reused.
 * @param ctx - context providing the LLM service.
 * @param config - resolved backend configuration.
 * @param input - replayed conversation prefix (system, tools, and leading messages) to condense.
 * @param agent - supplies routed-model history, fallback model, and session id.
 * @param signal - optional cancellation forwarded to the adapter.
 * @returns safe text-only summary blocks and the exact call envelope and output.
 */
function trimText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const half = Math.max(32, Math.floor((maxChars - 40) / 2))
  return `${text.slice(0, half)}\n[... trimmed for compaction ...]\n${text.slice(-half)}`
}

function cloneWithoutImages(message: Message, maxTextChars?: number): Message {
  const nextContent: ContentBlock[] = []
  for (const block of message.content) {
    if (block.type === 'image') {
      nextContent.push({ type: 'text', text: '[image omitted for compaction]' })
    } else if (block.type === 'text' && maxTextChars !== undefined && block.text.length > maxTextChars) {
      nextContent.push({ ...block, text: trimText(block.text, maxTextChars) })
    } else if (block.type === 'reasoning' && maxTextChars !== undefined && block.text.length > maxTextChars) {
      nextContent.push({ ...block, text: trimText(block.text, maxTextChars) })
    } else if (block.type === 'tool-call' && maxTextChars !== undefined && block.arguments.length > maxTextChars) {
      nextContent.push({ ...block, arguments: trimText(block.arguments, maxTextChars) })
    } else {
      nextContent.push(block)
    }
  }
  return { ...message, content: nextContent }
}

function buildInstructionMessage(): RequestMessage {
  return deepFreeze({
    role: 'user',
    content: [{ type: 'text', text: COMPACTION_INSTRUCTION }],
  })
}

function estimateCallTokens(
  input: SummarizationInput,
  target: { provider: string; model: string },
  instructionTokens: number,
): number {
  let total = instructionTokens
  for (const message of input.messages) {
    total += estimateMessage(message)
  }
  if (input.tools !== undefined && input.tools.length > 0) {
    total += estimateToolsTokens({ config: target, tools: [...input.tools] })
  }
  return total
}

function shrinkInputForWindow(
  input: SummarizationInput,
  target: { provider: string; model: string },
  safeInputTokens: number,
  instructionTokens: number,
): SummarizationInput {
  const withoutImages: SummarizationInput = {
    ...input,
    messages: input.messages.map(m => cloneWithoutImages(m)),
  }
  if (estimateCallTokens(withoutImages, target, instructionTokens) <= safeInputTokens) {
    return withoutImages
  }

  // Pass 1: progressively trim oversized tool results while keeping tool schemas / prefix cache intact.
  for (const cap of [1200, 400, 160]) {
    const trimmedTools = withoutImages.messages.map(m =>
      m.role === 'tool' ? cloneWithoutImages(m, cap) : m)
    const candidate: SummarizationInput = { ...withoutImages, messages: trimmedTools }
    if (estimateCallTokens(candidate, target, instructionTokens) <= safeInputTokens) {
      return candidate
    }
  }

  // Pass 2: trim large non-system messages and drop optional tool schemas from auxiliary summary input.
  for (const cap of [1600, 600, 240]) {
    const trimmedAll = withoutImages.messages.map(m =>
      m.role === 'system' ? m : cloneWithoutImages(m, cap))
    const withTools: SummarizationInput = { ...withoutImages, messages: trimmedAll }
    if (estimateCallTokens(withTools, target, instructionTokens) <= safeInputTokens) {
      return withTools
    }
    const withoutToolSchemas: SummarizationInput = { messages: trimmedAll }
    if (estimateCallTokens(withoutToolSchemas, target, instructionTokens) <= safeInputTokens) {
      return withoutToolSchemas
    }
  }

  return {
    messages: withoutImages.messages.map(m => (m.role === 'system' ? m : cloneWithoutImages(m, 240))),
  }
}

/** Group assistant tool-call turns with their immediately following tool-result messages so chunks never break pairing. */
function groupAtomicUnits(messages: readonly Message[]): Message[][] {
  const units: Message[][] = []
  let i = 0
  while (i < messages.length) {
    const msg = messages[i]
    if (msg === undefined) break
    if (msg.role === 'assistant' && msg.content.some(b => b.type === 'tool-call')) {
      const group: Message[] = [msg]
      i += 1
      while (i < messages.length) {
        const nextMsg = messages[i]
        if (nextMsg?.role !== 'tool') break
        group.push(nextMsg)
        i += 1
      }
      units.push(group)
      continue
    }
    units.push([msg])
    i += 1
  }
  return units
}

function clampSingleUnit(unit: readonly Message[], budgetTokens: number): Message[] {
  const currentTokens = unit.reduce((sum, msg) => sum + estimateMessage(msg), 0)
  if (currentTokens <= budgetTokens) return [...unit]
  const perMessageBudget = Math.max(48, Math.floor((budgetTokens - unit.length * 16) / unit.length))
  // Start conservatively for high-density scripts (e.g. CJK at ~1.2 tokens/char) and halve until within budget.
  let maxChars = Math.max(40, Math.floor(perMessageBudget * 0.75))
  let clamped = unit.map(msg => cloneWithoutImages(msg, maxChars))
  while (clamped.reduce((sum, msg) => sum + estimateMessage(msg), 0) > budgetTokens && maxChars > 40) {
    maxChars = Math.max(40, Math.floor(maxChars / 2))
    clamped = unit.map(msg => cloneWithoutImages(msg, maxChars))
  }
  return clamped
}

async function streamSummaryCall(
  ctx: Context,
  config: SummaryConfig,
  target: { provider: string; model: string },
  input: SummarizationInput,
  agent: Agent,
  instructionMessage: RequestMessage,
  signal?: AbortSignal,
): Promise<SummaryResult> {
  const assembler = new BlockAssembler()
  const messages: RequestMessage[] = [
    ...input.messages,
    instructionMessage,
  ]
  const options: GenerateOptions = {
    provider: target.provider,
    model: target.model,
    messages,
    toolHistory: agent.session.toolHistory(),
    ...input.tools === undefined ? {} : { tools: [...input.tools] },
    maxTokens: config.maxTokens,
    sessionId: agent.session.id,
    purpose: 'compaction',
    ...signal === undefined ? {} : { signal },
  }
  for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk)
  const error = finishError(assembler.finish)
  if (error !== undefined) throw error

  const rawOutput = assembler.blocks()
  const summary = summaryText(rawOutput)
  if (!summary.some(block => block.text.trim().length > 0)) {
    throw new Error('summarization produced no text summary content')
  }
  return {
    summary,
    rawOutput,
    llmStreamCall: true,
    provider: options.provider,
    model: options.model,
    maxTokens: config.maxTokens,
    ...(assembler.usage === undefined ? {} : { usage: assembler.usage }),
  }
}

async function summarizeInChunks(
  ctx: Context,
  config: SummaryConfig,
  target: { provider: string; model: string },
  input: SummarizationInput,
  agent: Agent,
  safeInputTokens: number,
  instructionMessage: RequestMessage,
  instructionTokens: number,
  signal?: AbortSignal,
): Promise<SummaryResult> {
  const first = input.messages[0]
  const systemMsg = first?.role === 'system' ? first : undefined
  const systemTokens = systemMsg === undefined ? 0 : estimateMessage(systemMsg)
  const includeSystem = systemMsg !== undefined
    && systemTokens + instructionTokens + SAFE_SUMMARY_MIN_HEADROOM <= safeInputTokens
  const baseSystem = includeSystem ? [systemMsg] : []
  const chunkBudget = Math.max(64, safeInputTokens - instructionTokens - (includeSystem ? systemTokens : 0))

  const body = (systemMsg === undefined ? input.messages : input.messages.slice(1))
    .map(m => cloneWithoutImages(m, 1200))
  const units = groupAtomicUnits(body).map(unit => clampSingleUnit(unit, chunkBudget))

  const chunks: Message[][] = []
  let current: Message[] = []
  let currentTokens = 0
  for (const unit of units) {
    const unitTokens = unit.reduce((sum, msg) => sum + estimateMessage(msg), 0)
    if (current.length > 0 && currentTokens + unitTokens > chunkBudget) {
      chunks.push(current)
      current = []
      currentTokens = 0
    }
    current.push(...unit)
    currentTokens += unitTokens
  }
  if (current.length > 0) chunks.push(current)

  if (chunks.length <= 1) {
    const singleInput: SummarizationInput = {
      messages: [...baseSystem, ...(chunks[0] ?? [])],
    }
    return streamSummaryCall(ctx, config, target, singleInput, agent, instructionMessage, signal)
  }

  const chunkTexts: string[] = []
  let lastResult: SummaryResult | undefined
  for (const chunk of chunks) {
    signal?.throwIfAborted()
    const chunkResult = await streamSummaryCall(
      ctx,
      config,
      target,
      { messages: [...baseSystem, ...chunk] },
      agent,
      instructionMessage,
      signal,
    )
    lastResult = chunkResult
    chunkTexts.push(chunkResult.summary.map(b => (b.type === 'text' ? b.text : '')).join('\n').trim())
  }

  const mergedContent = chunkTexts
    .map((text, idx) => `### Segment ${idx + 1}\n${text}`)
    .join('\n\n')
  const mergedInput: SummarizationInput = {
    messages: [
      ...baseSystem,
      createUserMessage({
        content: [{ type: 'text', text: mergedContent }],
        source: { kind: 'user' },
      }),
    ],
  }
  if (estimateCallTokens(mergedInput, target, instructionTokens) <= safeInputTokens) {
    try {
      return await streamSummaryCall(ctx, config, target, mergedInput, agent, instructionMessage, signal)
    } catch (error: unknown) {
      if (signal?.aborted === true) throw error
      // Preserve already-completed chunk summaries when final consolidation fails non-fatally.
    }
  }
  return {
    summary: [{ type: 'text', text: mergedContent }],
    provider: lastResult?.provider ?? target.provider,
    model: lastResult?.model ?? target.model,
    maxTokens: config.maxTokens,
  }
}

export async function summarizeWithLlm(
  ctx: Context,
  config: SummaryConfig,
  input: SummarizationInput,
  agent: Agent,
  signal?: AbortSignal,
): Promise<SummaryResult> {
  const latest = agent.session.requestHeader()?.config
  const configured = config.summarizationProvider.length === 0
    ? undefined
    : { provider: config.summarizationProvider, model: config.summarizationModel }
  const agentTarget = agent.options.provider !== undefined
    && agent.options.provider.length > 0
    && agent.options.model !== undefined
    && agent.options.model.length > 0
    ? { provider: agent.options.provider, model: agent.options.model }
    : undefined
  const target = configured ?? latest ?? agentTarget
  if (target === undefined) {
    throw new Error(
      'no provider/model available for summarization: set both BasicCompactionConfig summarization fields, route one request, or set both AgentOptions fields',
    )
  }

  const instructionMessage = buildInstructionMessage()
  const instructionTokens = estimateContent([{ type: 'text', text: COMPACTION_INSTRUCTION }]) + ROLE_OVERHEAD
  let contextWindow: number | undefined
  if (ctx.llm.listProviders().some(provider => provider.id === target.provider)) {
    const info = await ctx.llm.resolveModelInfo(target.provider, target.model, signal)
    contextWindow = info.context?.contextWindow
  }

  const safeInputTokens = contextWindow !== undefined && contextWindow > 0
    ? Math.floor(contextWindow * SAFE_SUMMARY_INPUT_RATIO)
    : undefined
  const canPreflight = safeInputTokens !== undefined
    && safeInputTokens > instructionTokens + SAFE_SUMMARY_MIN_HEADROOM

  if (!canPreflight) {
    return streamSummaryCall(ctx, config, target, input, agent, instructionMessage, signal)
  }

  const estimated = estimateCallTokens(input, target, instructionTokens)
  if (estimated <= safeInputTokens) {
    try {
      return await streamSummaryCall(ctx, config, target, input, agent, instructionMessage, signal)
    } catch (error: unknown) {
      if (signal?.aborted === true || !isOverflowOrSummarySizeFailure(error)) throw error
      // Fallback if provider reported overflow despite passing heuristic sizing.
      return summarizeInChunks(ctx, config, target, input, agent, safeInputTokens, instructionMessage, instructionTokens, signal)
    }
  }

  const fitted = shrinkInputForWindow(input, target, safeInputTokens, instructionTokens)
  if (estimateCallTokens(fitted, target, instructionTokens) <= safeInputTokens) {
    try {
      return await streamSummaryCall(ctx, config, target, fitted, agent, instructionMessage, signal)
    } catch (error: unknown) {
      if (signal?.aborted === true || !isOverflowOrSummarySizeFailure(error)) throw error
    }
  }

  return summarizeInChunks(ctx, config, target, input, agent, safeInputTokens, instructionMessage, instructionTokens, signal)
}

/**
 * Wrap raw summary blocks in the durable checkpoint framing.
 * @param summary - safe text-only model output.
 * @returns content for the synthesized replacement user message.
 */
export function frameSummary(summary: readonly ContentBlock[]): ContentBlock[] {
  return [
    { type: 'text', text: `${CHECKPOINT_PREAMBLE}\n\n${SUMMARY_OPEN_TAG}` },
    ...summary,
    { type: 'text', text: SUMMARY_CLOSE_TAG },
  ]
}

/** Map a terminal summarization finish to its fail-closed error. */
function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'error':
    case 'aborted': {
      return LlmError.fromFailure(finish.failure)
    }
    case 'max-tokens': {
      const error = new Error('summarization truncated at the token cap (incomplete checkpoint)') as Error & { code?: string }
      error.code = 'MAX_TOKENS'
      return error
    }
    default:
      return undefined
  }
}

/** Reject visual output and keep only text before synthesizing a user message. */
function summaryText(
  blocks: readonly ContentBlock[],
): Array<Extract<ContentBlock, { type: 'text' }>> {
  if (contentHasImage(blocks)) {
    throw new LlmError('compaction summary cannot contain image output', 'UNSUPPORTED_CONTENT')
  }
  return blocks.filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
}
