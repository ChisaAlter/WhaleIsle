import type { Context } from '@deepseek-ai/cordis'
import type {
  AssistantBlock, AssistantMessageNode, ConversationLocation, ConversationMatch,
  ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { AssistantChatData } from '../contract/chat-nodes.ts'
import { CHAT_SYNTHETIC_SEQ_OFFSETS, chatNode } from './common.ts'
import {
  emptyAssistantBlock, isTokenDelta, toAssistantBlock, toAssistantBlocks,
} from './event-projection.ts'

declare module '../contract/chat-nodes.ts' {
  interface ChatNodeDataMap {
    /** Streaming, settled, or interrupted Assistant step. */
    'assistant-step': AssistantChatData
  }
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationStepDataMap {
    /** Streaming, settled, or interrupted Assistant material for this Step. */
    'assistant-step': AssistantChatData
  }
}

type StreamTextKind = 'text' | 'reasoning'

interface PendingDelta {
  readonly index: number
  readonly kind: StreamTextKind
  readonly baseText: string
  /** Append-only chunk list; earlier snapshots cap reads via `chunkCount`. */
  readonly chunks: string[]
  readonly chunkCount: number
}

interface AssistantState {
  readonly turn: number
  readonly step: number
  readonly rawBlocks: readonly (AssistantBlock | undefined)[]
  readonly pending: PendingDelta | undefined
  readonly blocks: readonly (AssistantBlock | undefined)[]
  /** Missing indices are invisible; same-kind appends preserve already-visible blocks. */
  readonly visibleByIndex: readonly boolean[]
  readonly visibleBlocks: number
  readonly firstVisibleSeq: number | undefined
  readonly firstVisibleTime: number | undefined
  readonly firstTokenTime: number | undefined
  readonly final: ConversationMatch | undefined
  readonly usage: unknown
}

function materializePending(
  rawBlocks: readonly (AssistantBlock | undefined)[],
  pending: PendingDelta | undefined,
): readonly (AssistantBlock | undefined)[] {
  if (pending === undefined) return rawBlocks
  const tail = pending.chunkCount === 1
    ? (pending.chunks[0] ?? '')
    : (pending.chunkCount === pending.chunks.length
      ? pending.chunks
      : pending.chunks.slice(0, pending.chunkCount)).join('')
  const text = pending.baseText === '' ? tail : pending.baseText + tail
  const next = [...rawBlocks]
  next[pending.index] = pending.kind === 'text'
    ? { kind: 'text', text }
    : { kind: 'reasoning', text }
  return next
}

function makeState(fields: Omit<AssistantState, 'blocks'>): AssistantState {
  let materialized: readonly (AssistantBlock | undefined)[] | undefined
  return {
    turn: fields.turn,
    step: fields.step,
    rawBlocks: fields.rawBlocks,
    pending: fields.pending,
    visibleByIndex: fields.visibleByIndex,
    visibleBlocks: fields.visibleBlocks,
    firstVisibleSeq: fields.firstVisibleSeq,
    firstVisibleTime: fields.firstVisibleTime,
    firstTokenTime: fields.firstTokenTime,
    final: fields.final,
    usage: fields.usage,
    get blocks(): readonly (AssistantBlock | undefined)[] {
      materialized ??= materializePending(fields.rawBlocks, fields.pending)
      return materialized
    },
  }
}

function initialState(turn: number, step: number): AssistantState {
  return makeState({
    turn,
    step,
    rawBlocks: [],
    pending: undefined,
    visibleByIndex: [],
    visibleBlocks: 0,
    firstVisibleSeq: undefined,
    firstVisibleTime: undefined,
    firstTokenTime: undefined,
    final: undefined,
    usage: undefined,
  })
}

function compactBlocks(blocks: readonly (AssistantBlock | undefined)[]): readonly AssistantBlock[] {
  for (let i = 0; i < blocks.length; i += 1) {
    if (blocks[i] === undefined) {
      return blocks.filter((block): block is AssistantBlock => block !== undefined)
    }
  }
  return blocks as readonly AssistantBlock[]
}

function blockIsVisible(block: AssistantBlock | undefined): boolean {
  if (block === undefined || block.kind === 'tool-call') return false
  if (block.kind === 'text' || block.kind === 'reasoning') return block.text.trim() !== ''
  return true
}

function hasVisibleContent(blocks: readonly AssistantBlock[]): boolean {
  return blocks.some(blockIsVisible)
}

function hasInterruptionEvidence(blocks: readonly AssistantBlock[]): boolean {
  return blocks.some((block) => {
    if (block.kind === 'text' || block.kind === 'reasoning') return block.text.trim() !== ''
    return true
  })
}

function resetForRetry(state: AssistantState): AssistantState {
  return makeState({
    turn: state.turn,
    step: state.step,
    rawBlocks: [],
    pending: undefined,
    visibleByIndex: [],
    visibleBlocks: 0,
    firstVisibleSeq: undefined,
    firstVisibleTime: undefined,
    firstTokenTime: state.firstTokenTime,
    final: undefined,
    usage: undefined,
  })
}

function nextVisibility(
  state: AssistantState,
  changedIndex: number,
  previousVisible: boolean,
  nextVisible: boolean,
): { readonly visibleByIndex: readonly boolean[]; readonly visibleBlocks: number } {
  const visibleBlocks = state.visibleBlocks
    - Number(previousVisible)
    + Number(nextVisible)
  if (previousVisible === nextVisible) {
    return { visibleByIndex: state.visibleByIndex, visibleBlocks }
  }
  const visibleByIndex = [...state.visibleByIndex]
  visibleByIndex[changedIndex] = nextVisible
  return { visibleByIndex, visibleBlocks }
}

function appendTextDelta(
  state: AssistantState,
  kind: StreamTextKind,
  index: number,
  text: string,
  seq: number,
  time: number,
): AssistantState {
  const active = state.pending
  if (active !== undefined && active.index === index && active.kind === kind) {
    if (text === '') return state
    let chunks = active.chunks
    if (chunks.length === active.chunkCount) {
      chunks.push(text)
    } else {
      chunks = chunks.slice(0, active.chunkCount)
      chunks.push(text)
    }
    const previousVisible = state.visibleByIndex[index] === true
    const nextVisible = previousVisible || text.trim() !== ''
    const { visibleByIndex, visibleBlocks } = nextVisibility(state, index, previousVisible, nextVisible)
    return makeState({
      turn: state.turn,
      step: state.step,
      rawBlocks: state.rawBlocks,
      pending: {
        index,
        kind,
        baseText: active.baseText,
        chunks,
        chunkCount: active.chunkCount + 1,
      },
      visibleByIndex,
      visibleBlocks,
      firstVisibleSeq: state.firstVisibleSeq ?? (visibleBlocks > 0 ? seq : undefined),
      firstVisibleTime: state.firstVisibleTime ?? (visibleBlocks > 0 ? time : undefined),
      firstTokenTime: state.firstTokenTime ?? time,
      final: state.final,
      usage: state.usage,
    })
  }

  const rawBlocks = active === undefined || active.index === index
    ? state.rawBlocks
    : materializePending(state.rawBlocks, active)
  const previous = active?.index === index ? undefined : rawBlocks[index]
  if (previous?.kind === kind && text === '') return state
  const previousVisible = state.visibleByIndex[index] === true
  const nextVisible = (previous?.kind === kind && previousVisible) || text.trim() !== ''
  const { visibleByIndex, visibleBlocks } = nextVisibility(state, index, previousVisible, nextVisible)
  return makeState({
    turn: state.turn,
    step: state.step,
    rawBlocks,
    pending: {
      index,
      kind,
      baseText: previous?.kind === kind ? previous.text : '',
      chunks: [text],
      chunkCount: 1,
    },
    visibleByIndex,
    visibleBlocks,
    firstVisibleSeq: state.firstVisibleSeq ?? (visibleBlocks > 0 ? seq : undefined),
    firstVisibleTime: state.firstVisibleTime ?? (visibleBlocks > 0 ? time : undefined),
    firstTokenTime: state.firstTokenTime ?? (text !== '' ? time : undefined),
    final: state.final,
    usage: state.usage,
  })
}

function updateChunk(
  state: AssistantState,
  chunk: StreamChunk,
  seq: number,
  time: number,
): AssistantState {
  if (chunk.type === 'text-delta') {
    return appendTextDelta(state, 'text', chunk.index, chunk.text, seq, time)
  }
  if (chunk.type === 'reasoning-delta') {
    return appendTextDelta(state, 'reasoning', chunk.index, chunk.text, seq, time)
  }
  if (chunk.type === 'usage') {
    return makeState({
      turn: state.turn,
      step: state.step,
      rawBlocks: state.rawBlocks,
      pending: state.pending,
      visibleByIndex: state.visibleByIndex,
      visibleBlocks: state.visibleBlocks,
      firstVisibleSeq: state.firstVisibleSeq,
      firstVisibleTime: state.firstVisibleTime,
      firstTokenTime: state.firstTokenTime,
      final: state.final,
      usage: chunk.usage,
    })
  }
  if (chunk.type === 'tool-call-delta') {
    const previous = state.pending?.index === chunk.index ? undefined : state.rawBlocks[chunk.index]
    if (previous?.kind === 'tool-call' && previous.callId !== ''
      && (chunk.name === undefined || chunk.name === previous.name)
      && (state.firstTokenTime !== undefined || !isTokenDelta(chunk))) return state
  }
  if (chunk.type !== 'block-start' && chunk.type !== 'tool-call-delta' && chunk.type !== 'block-end') {
    return state
  }
  const baseBlocks = state.pending === undefined || state.pending.index === chunk.index
    ? state.rawBlocks
    : materializePending(state.rawBlocks, state.pending)
  const blocks = [...baseBlocks]
  const changedIndex = chunk.index
  const previousVisible = state.visibleByIndex[changedIndex] === true
  let nextVisible = false
  switch (chunk.type) {
    case 'block-start':
      blocks[changedIndex] = emptyAssistantBlock(chunk.blockType)
      nextVisible = blockIsVisible(blocks[changedIndex])
      break
    case 'tool-call-delta': {
      const previous = state.pending?.index === changedIndex ? undefined : baseBlocks[changedIndex]
      // Tool Nodes own streamed arguments; Assistant protocol blocks retain identity until full settlement.
      blocks[changedIndex] = {
        kind: 'tool-call',
        callId: (previous?.kind === 'tool-call' ? previous.callId : '') || String(chunk.id),
        name: chunk.name ?? (previous?.kind === 'tool-call' ? previous.name : ''),
        argsRaw: previous?.kind === 'tool-call' ? previous.argsRaw : '',
      }
      break
    }
    case 'block-end':
      blocks[changedIndex] = toAssistantBlock(chunk.block)
      nextVisible = blockIsVisible(blocks[changedIndex])
      break
  }
  const { visibleByIndex, visibleBlocks } = nextVisibility(state, changedIndex, previousVisible, nextVisible)
  return makeState({
    turn: state.turn,
    step: state.step,
    rawBlocks: blocks,
    pending: undefined,
    visibleByIndex,
    visibleBlocks,
    firstVisibleSeq: state.firstVisibleSeq ?? (visibleBlocks > 0 ? seq : undefined),
    firstVisibleTime: state.firstVisibleTime ?? (visibleBlocks > 0 ? time : undefined),
    firstTokenTime: state.firstTokenTime ?? (isTokenDelta(chunk) ? time : undefined),
    final: state.final,
    usage: state.usage,
  })
}

function settleMessage(
  state: AssistantState,
  match: ConversationMatch,
  event: SessionEvent<'assistant/message'>,
): AssistantState {
  const blocks = toAssistantBlocks(event.data.message.content)
  const visibleByIndex = blocks.map(blockIsVisible)
  return makeState({
    turn: state.turn,
    step: state.step,
    rawBlocks: blocks,
    pending: undefined,
    visibleByIndex,
    visibleBlocks: visibleByIndex.reduce((count, visible) => count + Number(visible), 0),
    firstVisibleSeq: state.firstVisibleSeq,
    firstVisibleTime: state.firstVisibleTime,
    firstTokenTime: state.firstTokenTime,
    final: match,
    usage: event.data.usage,
  })
}

function closedBoundary(location: ConversationLocation): { seq: number; time: number } | undefined {
  if (location.kind === 'step' && location.step.status === 'closed' && location.step.end !== undefined) {
    return location.step.end
  }
  if ((location.kind === 'step' || location.kind === 'turn')
    && location.turn.status === 'closed' && location.turn.end !== undefined) {
    return location.turn.end
  }
  return undefined
}

function finalNode(
  state: AssistantState,
  context: ConversationNodeContext<AssistantState>,
): AssistantMessageNode | undefined {
  const final = state.final
  if (final?.event.type === 'assistant/message') {
    const event = final.event
    return {
      kind: 'assistant',
      seq: event.seq,
      messageId: event.data.message.id,
      time: event.time,
      turn: state.turn,
      step: state.step,
      blocks: state.pending === undefined
        ? state.rawBlocks as readonly AssistantBlock[]
        : toAssistantBlocks(event.data.message.content),
      usage: event.data.usage,
      timing: {
        stepStartTime: context.start?.event.time ?? null,
        firstTokenTime: state.firstTokenTime ?? null,
        completedTime: event.time,
      },
      ...event.data.interrupted === true ? { interrupted: true } : {},
    }
  }
  const location = context.start?.location ?? context.matches.at(-1)?.location
  const boundary = location === undefined ? undefined : closedBoundary(location)
  if (boundary === undefined) return undefined
  const blocks = compactBlocks(state.blocks)
  if (!hasInterruptionEvidence(blocks)) return undefined
  return {
    kind: 'assistant',
    seq: boundary.seq + CHAT_SYNTHETIC_SEQ_OFFSETS.interruptedAssistant,
    time: boundary.time,
    turn: state.turn,
    step: state.step,
    blocks,
    interrupted: true,
  }
}

function fallbackState(context: ConversationNodeContext<AssistantState>): AssistantState | undefined {
  let state: AssistantState | undefined
  for (const match of context.matches) {
    if (match.event.type === 'assistant/live-chunk') {
      state ??= initialState(match.event.data.turn, match.event.data.step)
      state = updateChunk(state, match.event.data.chunk, match.event.seq, match.event.time)
      continue
    }
    if (match.event.type === 'assistant/message') {
      state ??= initialState(match.event.data.turn, match.event.data.step)
      state = settleMessage(state, match, match.event)
      continue
    }
    if (match.event.type === 'llm/retry' && state !== undefined) {
      state = resetForRetry(state)
    }
  }
  return state
}

interface AssistantProjection {
  readonly data: AssistantChatData
  readonly anchorSeq: number
  readonly visible: boolean
  readonly settled: AssistantMessageNode | undefined
}

function projectAssistant(context: ConversationNodeContext<AssistantState>): AssistantProjection | undefined {
  const state = context.state ?? fallbackState(context)
  if (state === undefined) return undefined
  const settled = finalNode(state, context)
  const blocks = settled?.blocks ?? compactBlocks(state.blocks)
  const visible = settled === undefined ? state.visibleBlocks > 0 : hasVisibleContent(blocks)
  const status = settled?.interrupted === true
    ? 'interrupted'
    : settled === undefined ? 'running' : 'settled'
  const anchorSeq = (settled?.interrupted === true ? settled.seq : state.firstVisibleSeq ?? settled?.seq)
    ?? context.matches[0]?.event.seq ?? 0
  const time = settled?.time ?? state.firstVisibleTime ?? context.matches[0]?.event.time ?? 0
  return {
    anchorSeq,
    visible,
    settled,
    data: {
      status,
      turn: state.turn,
      step: state.step,
      blocks,
      time,
      ...state.usage === undefined ? {} : { usage: state.usage },
      ...settled === undefined ? {} : { finalNode: settled },
    },
  }
}

function publishedAssistantData(
  context: ConversationNodeContext<AssistantState>,
): Readonly<AssistantChatData> | undefined {
  const location = context.start?.location ?? context.matches.at(-1)?.location
  return location?.kind === 'step' ? location.step.data.get('assistant-step') : undefined
}

/** Per-step Assistant lifecycle; materialized keys survive cleared stream content as hidden Nodes. */
export const assistantDefinition: ConversationNodeDefinition<AssistantState> = {
  kind: 'assistant-step',
  target: 'chat',
  match: (event) => {
    if (event.type === 'step/start') return { id: `${event.data.turn}:${event.data.step}`, role: 'start' }
    if (event.type === 'assistant/live-chunk'
      || (event.type === 'assistant/message' && event.surfaceOp === 'append')) {
      return { id: `${event.data.turn}:${event.data.step}`, role: 'update' }
    }
    if (event.type === 'llm/retry') {
      return { id: `${event.data.turn}:${event.data.step}`, role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'step/start') throw new Error('assistant-step start requires step/start')
    return initialState(match.event.data.turn, match.event.data.step)
  },
  update: (context, match) => {
    if (match.event.type === 'assistant/live-chunk') {
      return updateChunk(context.state, match.event.data.chunk, match.event.seq, match.event.time)
    }
    if (match.event.type === 'assistant/message') return settleMessage(context.state, match, match.event)
    if (match.event.type === 'llm/retry') {
      return resetForRetry(context.state)
    }
    return context.state
  },
  publication: (match) => {
    if (match.event.type === 'step/start') return 'none'
    if (match.event.type !== 'assistant/live-chunk') return 'immediate'
    const type = match.event.data.chunk.type
    return type === 'usage' || type === 'finish' ? 'none' : 'animation-frame'
  },
  buildLocationData: (context, scope) => {
    if (scope !== 'step') return null
    const projected = projectAssistant(context)
    if (projected === undefined) return null
    return {
      kind: 'step',
      turn: projected.data.turn,
      step: projected.data.step,
      key: 'assistant-step',
      value: projected.data,
    }
  },
  buildViewNode: (context) => {
    const current = context.current.get('chat')
    const state = context.state ?? fallbackState(context)
    const data = publishedAssistantData(context)
    if (state === undefined || data === undefined) {
      return current == null ? null : { ...current, visibility: 'hidden' }
    }
    const settled = data.finalNode
    const visible = settled === undefined ? state.visibleBlocks > 0 : hasVisibleContent(data.blocks)
    if (settled === undefined && !visible && current == null) return null
    // A successful message retains its live anchor alongside pending Tool calls.
    const anchorSeq = (settled?.interrupted === true ? settled.seq : state.firstVisibleSeq ?? settled?.seq)
      ?? context.matches[0]?.event.seq ?? 0
    return chatNode(context, 'assistant-step', anchorSeq, data, {
      visibility: settled?.interrupted === true || visible ? 'visible' : 'hidden',
    })
  },
}

/**
 * Register the Assistant lifecycle business contribution.
 * @param ctx - owning UI Conversation context.
 */
export function registerAssistantConversationNode(ctx: Context): void {
  const match = assistantDefinition.match.bind(assistantDefinition)
  ctx.uiConversation.events.register({
    ...assistantDefinition,
    match: {
      'step/start': match,
      'assistant/live-chunk': match,
      'assistant/message': match,
      'llm/retry': match,
    },
  })
}
