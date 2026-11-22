/** Observable contiguous Session event window consumed by domain assemblers. */
import { notifySubscribers, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { LlmAttemptId, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

/** Client-only live chunk presentation; `seq` orders the transient row between durable Session seqs. */
export interface AssistantLiveChunkEvent {
  readonly type: 'assistant/live-chunk'
  readonly seq: number
  readonly time: number
  readonly data: {
    readonly attemptId: LlmAttemptId
    readonly turn: number
    readonly step: number
    readonly chunk: StreamChunk
  }
}

/** Current durable Session event or one client-only live chunk presentation. */
export type SessionEventLike = SessionEvent | AssistantLiveChunkEvent

/** Client history entry retaining its coarse transport discriminator. */
export type SessionEventLikeEntry =
  | { readonly type: 'event'; readonly event: SessionEvent }
  | { readonly type: 'transient'; readonly event: AssistantLiveChunkEvent }

/** Scalar live entry accepted by append-only Client paths. */
export type SessionLiveEventEntry = Extract<SessionEventLikeEntry, { readonly type: 'event' }>
/** Durable Assistant event that atomically supersedes one attempt's transient rows. */
export interface SessionAssistantSettlementEntry {
  readonly type: 'event'
  readonly event: SessionEvent<'assistant/message'> | SessionEvent<'assistant/attempt'>
}
/** Client-only Assistant frame admitted outside durable cursor algebra. */
export type SessionTransientEventEntry = Extract<SessionEventLikeEntry, { readonly type: 'transient' }>

const APPEND_SEGMENT_SIZE = 256

interface EventWindowBuffer {
  readonly segments: readonly (readonly SessionEventLikeEntry[])[]
  readonly tail: SessionEventLikeEntry[]
  readonly tailLength: number
  readonly length: number
}

function fromEntries(entries: readonly SessionEventLikeEntry[]): EventWindowBuffer {
  return {
    segments: [entries],
    tail: [],
    tailLength: 0,
    length: entries.length,
  }
}

function sealTail(buffer: EventWindowBuffer): readonly SessionEventLikeEntry[] | undefined {
  if (buffer.tailLength === 0) return undefined
  return buffer.tailLength === buffer.tail.length
    ? buffer.tail
    : buffer.tail.slice(0, buffer.tailLength)
}

function appendEntry(buffer: EventWindowBuffer, entry: SessionEventLikeEntry): EventWindowBuffer {
  const tail = buffer.tail
  if (buffer.tailLength === tail.length && tail.length < APPEND_SEGMENT_SIZE) {
    tail.push(entry)
    return {
      segments: buffer.segments,
      tail,
      tailLength: tail.length,
      length: buffer.length + 1,
    }
  }
  const sealed = sealTail(buffer)
  const segments = sealed === undefined ? buffer.segments : [...buffer.segments, sealed]
  return {
    segments,
    tail: [entry],
    tailLength: 1,
    length: buffer.length + 1,
  }
}

function prependEntries(
  buffer: EventWindowBuffer,
  entries: readonly SessionEventLikeEntry[],
): EventWindowBuffer {
  if (entries.length === 0) return buffer
  const segments: (readonly SessionEventLikeEntry[])[] = [entries]
  for (const segment of buffer.segments) {
    if (segment.length > 0) segments.push(segment)
  }
  const sealed = sealTail(buffer)
  if (sealed !== undefined) segments.push(sealed)
  return {
    segments,
    tail: [],
    tailLength: 0,
    length: buffer.length + entries.length,
  }
}

function materialize(buffer: EventWindowBuffer): readonly SessionEventLikeEntry[] {
  if (buffer.tailLength === 0 && buffer.segments.length === 1) {
    return buffer.segments[0] as readonly SessionEventLikeEntry[]
  }
  const entries = new Array<SessionEventLikeEntry>(buffer.length)
  let index = 0
  for (const segment of buffer.segments) {
    for (const entry of segment) {
      entries[index] = entry
      index += 1
    }
  }
  for (let i = 0; i < buffer.tailLength; i += 1) {
    entries[index] = buffer.tail[i] as SessionEventLikeEntry
    index += 1
  }
  return entries
}

function windowSnapshot(
  buffer: EventWindowBuffer,
  hasMore: boolean,
  revision: number,
  change: SessionEventChange,
): SessionEventWindow {
  let entries: readonly SessionEventLikeEntry[] | undefined
  return {
    get entries() {
      entries ??= materialize(buffer)
      return entries
    },
    hasMore,
    revision,
    change,
  }
}

/** Exact delta that produced the latest event-window revision. */
export type SessionEventChange =
  | { readonly kind: 'replace'; readonly entries: readonly SessionEventLikeEntry[] }
  | { readonly kind: 'prepend'; readonly entries: readonly SessionEventLikeEntry[] }
  | { readonly kind: 'append'; readonly entries: readonly SessionEventLikeEntry[] }
  | {
    readonly kind: 'settle-assistant'
    readonly attemptId: LlmAttemptId
    readonly entry?: SessionAssistantSettlementEntry
  }

/** Current contiguous event window and its latest synchronous delta. */
export interface SessionEventWindow {
  readonly entries: readonly SessionEventLikeEntry[]
  readonly hasMore: boolean
  readonly revision: number
  readonly change: SessionEventChange
}

/** Conversation-facing event source exposed by one Session binding. */
export type SessionEventSource = ObservableSnapshot<SessionEventWindow>

/** Session-owned event feed; every accepted window mutation publishes synchronously. */
export class MutableSessionEventSource implements SessionEventSource {
  private readonly listeners = new Set<() => void>()
  private window: EventWindowBuffer = fromEntries([])
  private snapshot: SessionEventWindow = windowSnapshot(
    this.window,
    false,
    0,
    { kind: 'replace', entries: [] },
  )

  /** @returns the cached event-window snapshot. */
  getSnapshot(): SessionEventWindow { return this.snapshot }

  /**
   * Subscribe to synchronous window publication.
   * @param listener - invalidation callback.
   * @returns unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Replace the complete contiguous window.
   * @param entries - complete window.
   * @param hasMore - whether older history remains.
   */
  replace(entries: readonly SessionEventLikeEntry[], hasMore: boolean): void {
    this.window = fromEntries(entries)
    this.publish(hasMore, { kind: 'replace', entries })
  }

  /**
   * Prepend one older contiguous page.
   * @param entries - newly loaded older entries.
   * @param hasMore - whether still older history remains.
   */
  prepend(entries: readonly SessionEventLikeEntry[], hasMore: boolean): void {
    this.window = prependEntries(this.window, entries)
    this.publish(hasMore, { kind: 'prepend', entries })
  }

  /**
   * Append one contiguous live entry.
   * @param entry - live tail entry.
   */
  append(entry: SessionEventLikeEntry): void {
    this.window = appendEntry(this.window, entry)
    this.publish(this.snapshot.hasMore, {
      kind: 'append',
      entries: [entry],
    })
  }

  /**
   * Replace one attempt's transient rows with its committed durable settlement.
   * @param attemptId - process-local attempt whose live rows are now redundant.
   * @param entry - durable settlement committed for that attempt.
   */
  settleAssistant(attemptId: LlmAttemptId, entry?: SessionAssistantSettlementEntry): void {
    const entries = materialize(this.window).filter(candidate => (
      candidate.type !== 'transient' || candidate.event.data.attemptId !== attemptId
    ))
    if (entry !== undefined) {
      const index = entries.findIndex(candidate => candidate.event.seq > entry.event.seq)
      if (index < 0) entries.push(entry)
      else entries.splice(index, 0, entry)
    }
    this.window = fromEntries(entries)
    this.publish(this.snapshot.hasMore, {
      kind: 'settle-assistant',
      attemptId,
      ...(entry === undefined ? {} : { entry }),
    })
  }

  private publish(
    hasMore: boolean,
    change: SessionEventChange,
  ): void {
    this.snapshot = windowSnapshot(this.window, hasMore, this.snapshot.revision + 1, change)
    notifySubscribers(this.listeners, '[session-controller] event feed')
  }
}
