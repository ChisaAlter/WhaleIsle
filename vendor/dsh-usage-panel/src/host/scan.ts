// dsh-usage-panel · fallback scan path (v0.1.0 logic ported to TS).
//
// Used when the sessionProjections / sessionProjectionCache services are
// unavailable: replays every session log through the SAME pure reducer as the
// projection path (single accounting core), using the read snapshot's exact
// inherited prefix. Marker/seedLength fallback is only for legacy snapshots.
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
// Type-only imports that load the event-map augmentations for merged types.
import type { SessionTitleEventData } from '@deepseek-ai/dsh-session-title'
import type { LlmRetryEventData } from '@deepseek-ai/dsh-llm-retry'
import type { CompactionId } from '@deepseek-ai/dsh-compaction'
import type { Overview } from '../shared/contract.ts'
import { emptyAggregate, finalizeOverview, mergeSessionValue, rankSessions, type Aggregate, type SessionAgg } from './aggregate.ts'
import { applyEvent, initState, type UsagePanelState } from './projection.ts'
import type { MagpieSource } from './magpie-usage.ts'
import { scanPacer } from './pacing.ts'
import type { HostSessionQuery } from './types.ts'

export interface ScanFallbackDeps {
  sq: HostSessionQuery
  providerNames: Record<string, string>
  logFailure: (message: string) => void
  /** Receive the full ranked session index for the paging endpoints. */
  storeIndex: (sessions: SessionAgg[]) => void
  /** Receive the failed-session ids (repair candidates). */
  storeFailed: (ids: string[]) => void
  /** Optional Magpie gateway ledger (token totals/days/models source). */
  magpie?: MagpieSource | null
}

/** True for events the reducer will count (post-seed usage / retry). */
function isCountedEvent(state: { seedEnd: number | null }, event: SessionEvent): boolean {
  if (state.seedEnd === null || event.seq < state.seedEnd) return false
  switch (event.type) {
    case 'assistant/message':
      return !!event.data.usage
    case 'assistant/chunk':
      return !!event.data.chunk && event.data.chunk.type === 'usage' && !!event.data.chunk.usage
    case 'compaction/summary':
      return !!event.data.usage
    case 'llm/retry':
      return true
    default:
      return false
  }
}

export async function scanFallback(deps: ScanFallbackDeps, now: number): Promise<Overview> {
  const { sq, providerNames, logFailure } = deps
  let a: Aggregate = emptyAggregate()
  const titles = new Map<string, string | null>()
  const failed: string[] = []
  let sessionsTotal = 0
  let sessionsOk = 0
  let sessionsFailed = 0
  let sessionsPending = 0
  let eventsCounted = 0

  let sessions: SessionRecord[] = []
  try {
    sessions = await sq.listSessions()
  } catch (err) {
    logFailure('listSessions failed: ' + String((err as Error)?.message ?? err))
    return finalizeOverview({
      aggregate: a,
      now,
      mode: 'scan',
      sessionsTotal: 0,
      sessionsOk: 0,
      sessionsFailed: 0,
      sessionsPending: 0,
      eventsCounted: 0,
      titles,
      providerNames,
      magpie: deps.magpie,
    })
  }

  // Cooperative pacing: the fallback replays full logs per session and a huge
  // corpus must not stall the host event loop.
  const pacer = scanPacer((message) => console.log('[dsh-usage-panel]', message))
  let index = 0
  for (const rec of sessions) {
    index += 1
    const header = rec && rec.header
    if (!header) {
      sessionsTotal += 1
      sessionsFailed += 1
      await pacer.beat(index, sessions.length)
      continue
    }
    const sessionId = header.id
    sessionsTotal += 1
    if (!rec.persisted) {
      sessionsPending += 1
      await pacer.beat(index, sessions.length)
      continue
    }
    let snapshot: { events?: SessionEvent[]; inheritedEventCount?: number } | null = null
    try {
      snapshot = await sq.readSession(header.id)
    } catch (err) {
      sessionsFailed += 1
      if (failed.length < 50) failed.push(sessionId)
      logFailure('readSession ' + sessionId + ' failed: ' + String((err as Error)?.message ?? err))
      await pacer.beat(index, sessions.length)
      continue
    }
    const events = snapshot && snapshot.events
    if (!events || !events.length) {
      sessionsOk += 1
      await pacer.beat(index, sessions.length)
      continue
    }

    const seedLength = Number((header as { seedLength?: unknown }).seedLength) || 0
    // Fork boundary, v0.1.0 semantics: seed events occupy seq 1..seedLength.
    // The last session/end-seed marker is authoritative when present; the
    // seedLength-derived boundary covers older logs without a marker; a log
    // with neither counts everything (fresh session).
    let seedEnd = 0
    for (const event of events) {
      if (event.type === 'session/end-seed') seedEnd = event.seq
    }
    if (seedEnd === 0 && seedLength > 0) seedEnd = seedLength + 1
    let state: UsagePanelState = snapshot?.inheritedEventCount !== undefined
      ? initState(header, snapshot.inheritedEventCount)
      : { ...initState(), seedEnd }

    let title: string | null = null
    for (const event of events) {
      if (event.type === 'session/title') {
        title = event.data.title
        // Fall through to the reducer (uninterested → same reference).
      }
      if (isCountedEvent(state, event)) eventsCounted += 1
      state = applyEvent(state, event)
    }
    titles.set(sessionId, title)
    // mergeSessionValue is pure — the returned aggregate replaces the old one.
    const depth = Number((header as { delegationDepth?: unknown }).delegationDepth) || 0
    const cwd = (header as { cwd?: unknown }).cwd || null
    a = mergeSessionValue(a, state, sessionId, now, depth, typeof cwd === 'string' ? cwd : null)
    sessionsOk += 1
    await pacer.beat(index, sessions.length)
  }

  deps.storeIndex(rankSessions(a.sessions, Number.MAX_SAFE_INTEGER))
  deps.storeFailed(failed)
  return finalizeOverview({
    aggregate: a,
    now,
    mode: 'scan',
    sessionsTotal,
    sessionsOk,
    sessionsFailed,
    sessionsPending,
    eventsCounted,
    titles,
    providerNames,
    failedSessionIds: failed,
    magpie: deps.magpie,
  })
}
