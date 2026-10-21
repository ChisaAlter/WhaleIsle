// Locks the cross-session aggregation: recent-30d window, session counts,
// top-session ranking with titles, coverage passthrough, provider rows, and
// the 182-day UTC heatmap window.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { foldEvents } from '../src/host/projection.ts'
import { emptyAggregate, finalizeOverview, mergeSessionValue, pageOf, pathBasename, projectRowsOf, rankSessions, type SessionAgg } from '../src/host/aggregate.ts'
import { costCentsFor, sumCostCents } from '../src/shared/cost.ts'
import { HEAT_DAYS } from '../src/shared/usage.ts'

function ev(type: string, seq: number, time: number, data: unknown): SessionEvent {
  return { type, seq, time, data } as unknown as SessionEvent
}

function usage(input = 0, output = 0, cacheRead = 0, cacheWrite = 0) {
  return { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite }
}

function sessionLog(days: Array<{ month?: number; day: number; input: number; model?: string }>): SessionEvent[] {
  const events: SessionEvent[] = [ev('session/end-seed', 1, 0, {})]
  let seq = 2
  for (const { month, day, input, model } of days) {
    const t = Date.UTC(2026, month ?? 7, day, 12, 0, 0)
    events.push(ev('request/context', seq++, t, { provider: 'p1', model: model || 'm1' }))
    events.push(ev('assistant/message', seq++, t, { turn: 1, step: seq, usage: usage(input, input / 2) }))
    events.push(ev('step/end', seq++, t, { turn: 1, step: seq - 1 }))
  }
  return events
}

const NOW = Date.UTC(2026, 7, 15, 12, 0, 0) // 2026-08-15

test('mergeSessionValue aggregates totals, sessions and providers across sessions', () => {
  let a = emptyAggregate()
  // Session A: 100 input on 08-14 (recent) + 1000 input on 07-01 (old).
  const a1 = foldEvents(sessionLog([{ day: 14, input: 100 }, { month: 6, day: 1, input: 1000 }]))
  a = mergeSessionValue(a, a1, 'sess-a', NOW, 0)
  // Session B: 50 input on 08-15.
  const b1 = foldEvents(sessionLog([{ day: 15, input: 50, model: 'm2' }]))
  a = mergeSessionValue(a, b1, 'sess-b', NOW, 1)

  assert.equal(a.allTimeTotals.input, 1150)
  assert.equal(a.allTimeTotals.total, 1725) // uncached input + output (output = input / 2)
  assert.equal(a.recentTotals.input, 150) // 08-14 + 08-15 only (30-day window)
  assert.equal(a.recentTotals.total, 225)
  assert.equal(a.recentSessionCount, 2)
  assert.equal(a.allTimeSessionCount, 2)
  assert.equal(a.allTimeByModel['m1']?.input, 1100)
  assert.equal(a.allTimeByModel['m2']?.input, 50)
  assert.equal(a.allTimeByProvider['p1']?.input, 1150)
  assert.equal(a.usageSessionsMain, 1) // sess-a is depth 0
  assert.equal(a.usageSessionsSubagent, 1) // sess-b is depth 1
  assert.equal(a.from, Date.UTC(2026, 6, 1, 12, 0, 0))
  assert.equal(a.to, Date.UTC(2026, 7, 15, 12, 0, 0))
})

test('rankSessions orders by all-time total and honors the limit', () => {
  let a = emptyAggregate()
  const big = foldEvents(sessionLog([{ day: 15, input: 500 }]))
  const small = foldEvents(sessionLog([{ day: 15, input: 10 }]))
  a = mergeSessionValue(a, big, 'big', NOW, 0)
  a = mergeSessionValue(a, small, 'small', NOW, 1)
  const top = rankSessions(a.sessions, 1)
  assert.equal(top.length, 1)
  assert.equal(top[0]!.id, 'big')
})

test('a cache-only session still counts as a session with usage (total stays 0)', () => {
  const events: SessionEvent[] = [
    ev('session/end-seed', 1, 0, {}),
    ev('request/context', 2, Date.UTC(2026, 7, 15, 12), { provider: 'p1', model: 'm1' }),
    ev('assistant/message', 3, Date.UTC(2026, 7, 15, 12), {
      turn: 1,
      step: 3,
      usage: usage(0, 0, 4096),
    }),
    ev('step/end', 4, Date.UTC(2026, 7, 15, 12), { turn: 1, step: 3 }),
  ]
  const a = mergeSessionValue(emptyAggregate(), foldEvents(events), 'cache-only', NOW, 0)
  assert.equal(a.allTimeTotals.total, 0) // in + out = 0
  assert.equal(a.allTimeTotals.cacheRead, 4096)
  assert.equal(a.allTimeSessionCount, 1)
  assert.equal(a.usageSessionsMain, 1)
})

test('finalizeOverview takes totals/days/models from the Magpie ledger and keeps panel providers', () => {
  let a = emptyAggregate()
  // The log side keeps one session (and its cost buckets) at 12:00 UTC = off-peak.
  // Its model id is the same `provider/route` shape the gateway records as `req`.
  a = mergeSessionValue(a, foldEvents(sessionLog([{ day: 15, input: 100, model: 'p1/m1' }])), 'sess-a', NOW, 0)
  const overview = finalizeOverview({
    aggregate: a,
    now: NOW,
    mode: 'projection',
    sessionsTotal: 1,
    sessionsOk: 1,
    sessionsFailed: 0,
    sessionsPending: 0,
    eventsCounted: 0,
    titles: new Map<string, string | null>([['sess-a', 'Only session']]),
    providerNames: { p1: 'Provider one', p2: 'Provider two' },
    magpie: {
      file: 'C:/Users/x/.config/magpie/usage.jsonl',
      calls: 3,
      totals: { input: 1000, output: 200, cacheRead: 9000, cacheWrite: 50 },
      byModel: {
        'p1/m1': { input: 400, output: 100, cacheRead: 5000, cacheWrite: 0 },
        'p2/m2': { input: 600, output: 100, cacheRead: 4000, cacheWrite: 50 },
      },
      // The gateway's upstream ids must NOT win for a model the logs know.
      upstreamProviders: { 'p1/m1': 'codex', 'p2/m2': 'factory' },
      byDay: {
        '2026-08-14': { 'p1/m1': { input: 400, output: 100, cacheRead: 5000, cacheWrite: 0 } },
        '2026-08-15': { 'p2/m2': { input: 600, output: 100, cacheRead: 4000, cacheWrite: 50 } },
      },
      from: Date.UTC(2026, 7, 14),
      to: Date.UTC(2026, 7, 15),
    },
  })
  // Ledger totals: in + out only, cache kept as its own bucket.
  assert.equal(overview.allTime.totals.total, 1200)
  assert.equal(overview.allTime.totals.cacheRead, 9000)
  assert.equal(overview.allTime.totals.cacheWrite, 50)
  // Recent window is the same ledger (both days fall inside the 30-day window).
  assert.equal(overview.totals.total, 1200)
  assert.deepEqual(overview.allTime.byModel.map((m) => m.model), ['p2/m2', 'p1/m1'])
  assert.equal(overview.allTime.byModel[0]!.total, 700)
  // Log attribution wins for a model the logs know; upstream is only a fallback.
  assert.equal(overview.allTime.byModel[1]!.provider, 'p1')
  assert.equal(overview.allTime.byModel[0]!.provider, 'factory')
  // Cost buckets stay log-derived and JOIN by the model key: m1's logged 100
  // input bills off-peak, so the KPI cost card still has a priced row.
  assert.equal(overview.allTime.byModel[1]!.cost.offPeak.input, 100)
  const costRows = overview.allTime.byModel.map((m) =>
    costCentsFor(m.cost, m.provider, m.model, { 'p1/p1/m1': { inputCacheHit: 1, inputCacheMiss: 2, output: 3 } }, true),
  )
  assert.notEqual(sumCostCents(costRows), null)
  // Every byModel key resolves in the log-derived cost map that exists for it.
  const logCostKeys = Object.keys(a.allTimeCostByModel)
  assert.deepEqual(logCostKeys, ['p1/m1'])
  assert.equal(overview.allTime.byModel.filter((m) => logCostKeys.includes(m.model)).length, 1)
  // Day cells: ledger buckets, UTC keys.
  assert.equal(overview.days.find((d) => d.date === '2026-08-15')!.total, 700)
  assert.equal(overview.days.find((d) => d.date === '2026-08-14')!.total, 500)
  // Provider rows regroup the same model buckets → they add up to the total.
  assert.deepEqual(overview.providers.map((p) => p.id), ['factory', 'p1'])
  assert.equal(overview.providers[0]!.name, 'factory')
  assert.equal(overview.providers[1]!.name, 'Provider one')
  const providerSum = overview.providers.reduce((sum, p) => sum + p.totals.total, 0)
  assert.equal(providerSum, overview.allTime.totals.total)
  assert.equal(overview.allTime.sessionCount, 1)
  assert.equal(overview.topSessions[0]!.id, 'sess-a')
  assert.equal(overview.topSessions[0]!.totals.total, 150)
  // Source marker.
  assert.equal(overview.coverage.source, 'magpie')
  assert.deepEqual(overview.coverage.magpie, {
    file: 'C:/Users/x/.config/magpie/usage.jsonl',
    calls: 3,
    from: Date.UTC(2026, 7, 14),
    to: Date.UTC(2026, 7, 15),
  })
})

test('without a Magpie ledger the totals fall back to deduped logs (in + out)', () => {
  let a = emptyAggregate()
  a = mergeSessionValue(a, foldEvents(sessionLog([{ day: 15, input: 100 }])), 'sess-a', NOW, 0)
  const overview = finalizeOverview({
    aggregate: a,
    now: NOW,
    mode: 'projection',
    sessionsTotal: 1,
    sessionsOk: 1,
    sessionsFailed: 0,
    sessionsPending: 0,
    eventsCounted: 0,
    titles: new Map(),
    providerNames: {},
    magpie: null,
  })
  assert.equal(overview.coverage.source, 'logs')
  assert.equal(overview.coverage.magpie, undefined)
  assert.equal(overview.allTime.totals.total, 150) // 100 in + 50 out
  assert.equal(overview.allTime.totals.cacheWrite, 0)
})

test('finalizeOverview builds the wire payload with coverage, titles and providers', () => {
  let a = emptyAggregate()
  a = mergeSessionValue(a, foldEvents(sessionLog([{ day: 14, input: 100 }])), 'sess-a', NOW, 0)
  a = mergeSessionValue(a, foldEvents(sessionLog([{ day: 15, input: 50, model: 'm2' }])), 'sess-b', NOW, 1)
  const titles = new Map<string, string | null>([
    ['sess-a', 'Expensive run'],
    ['sess-b', null],
  ])
  const overview = finalizeOverview({
    aggregate: a,
    now: NOW,
    mode: 'projection',
    sessionsTotal: 3,
    sessionsOk: 2,
    sessionsFailed: 1,
    sessionsPending: 0,
    eventsCounted: 0,
    titles,
    providerNames: { p1: 'DeepSeek' },
  })

  assert.equal(overview.days.length, HEAT_DAYS)
  assert.equal(overview.days[HEAT_DAYS - 1]!.date, '2026-08-15')
  assert.equal(overview.totals.input, 150)
  assert.equal(overview.sessionCount, 2)
  assert.equal(overview.allTime.sessionCount, 2)
  assert.deepEqual(
    overview.byModel.map((m) => m.model),
    ['m1', 'm2'],
  )
  assert.equal(overview.coverage.mode, 'projection')
  assert.equal(overview.coverage.timezone, 'UTC')
  assert.equal(overview.coverage.sessionsTotal, 3)
  assert.equal(overview.coverage.sessionsFailed, 1)
  assert.equal(overview.coverage.usageSessionsMain, 1)
  assert.equal(overview.coverage.usageSessionsSubagent, 1)
  assert.equal(overview.topSessions.length, 2)
  assert.equal(overview.topSessions[0]!.id, 'sess-a')
  assert.equal(overview.topSessions[0]!.depth, 0)
  assert.equal(overview.topSessions[1]!.depth, 1)
  assert.equal(overview.topSessions[0]!.title, 'Expensive run')
  assert.equal(overview.topSessions[1]!.title, null)
  assert.equal(overview.providers.length, 1)
  assert.equal(overview.providers[0]!.name, 'DeepSeek')
  assert.equal(overview.updatedAt, NOW)
})

test('finalizeOverview on an empty aggregate yields a zero overview (mode none)', () => {
  const overview = finalizeOverview({
    aggregate: emptyAggregate(),
    now: NOW,
    mode: 'none',
    sessionsTotal: 0,
    sessionsOk: 0,
    sessionsFailed: 0,
    sessionsPending: 0,
    eventsCounted: 0,
    titles: new Map(),
    providerNames: {},
  })
  assert.equal(overview.totals.total, 0)
  assert.equal(overview.topSessions.length, 0)
  assert.equal(overview.providers.length, 0)
  assert.equal(overview.coverage.mode, 'none')
  assert.equal(overview.allTime.costTotals.peak.input, 0)
  assert.equal(overview.allTime.costTotals.offPeak.input, 0)
})

test('cost buckets aggregate per session and per model, with providers attached', () => {
  // 12:00 UTC = 20:00 Beijing → off-peak; no step/start in these logs, so the
  // message instant classifies.
  let a = emptyAggregate()
  const a1 = foldEvents(sessionLog([{ day: 14, input: 100, model: 'm1' }]))
  a = mergeSessionValue(a, a1, 'sess-a', NOW, 0)
  const b1 = foldEvents(sessionLog([{ day: 15, input: 50, model: 'm2' }]))
  a = mergeSessionValue(a, b1, 'sess-b', NOW, 1)

  assert.equal(a.allTimeCost.offPeak.input, 150)
  assert.equal(a.allTimeCost.peak.input, 0)
  const overview = finalizeOverview({
    aggregate: a,
    now: NOW,
    mode: 'projection',
    sessionsTotal: 2,
    sessionsOk: 2,
    sessionsFailed: 0,
    sessionsPending: 0,
    eventsCounted: 0,
    titles: new Map(),
    providerNames: { p1: 'DeepSeek' },
  })
  assert.equal(overview.allTime.costTotals.offPeak.input, 150)
  assert.equal(overview.topSessions[0]!.models.length, 1)
  const m1 = overview.topSessions[0]!.models.find((m) => m.model === 'm1')!
  assert.equal(m1.provider, 'p1')
  assert.equal(m1.cost.offPeak.input, 100)
  const m2 = overview.topSessions[1]!.models.find((m) => m.model === 'm2')!
  assert.equal(m2.cost.offPeak.input, 50)
})

test('projectRowsOf groups by cwd, sums models, and sorts by tokens or cost', () => {
  const EMPTY_PHASE = { peak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, offPeak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }
  const phase = (input: number) => ({ peak: { input, output: 0, cacheRead: 0, cacheWrite: 0 }, offPeak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })
  const sessions: SessionAgg[] = [
    { id: 'a', cwd: 'C:\\proj-a', totals: { input: 100, output: 0, cacheRead: 0, cacheWrite: 0, total: 100 }, lastActive: 1, depth: 0, models: [{ model: 'flash', provider: 'deepseek-official', cost: phase(1_000_000) }] },
    { id: 'b', cwd: 'C:\\proj-a', totals: { input: 50, output: 0, cacheRead: 0, cacheWrite: 0, total: 50 }, lastActive: 2, depth: 0, models: [{ model: 'flash', provider: 'deepseek-official', cost: phase(500_000) }] },
    { id: 'c', cwd: '/work/proj-b', totals: { input: 400, output: 0, cacheRead: 0, cacheWrite: 0, total: 400 }, lastActive: 3, depth: 0, models: [{ model: 'flash', provider: 'deepseek-official', cost: phase(4_000_000) }] },
    { id: 'd', cwd: null, totals: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0, total: 10 }, lastActive: 4, depth: 0, models: [] },
  ]
  const tokens = projectRowsOf(sessions, 'tokens')
  assert.deepEqual(tokens.map((r) => r.name), ['proj-b', 'proj-a', '(unknown)'])
  assert.equal(tokens[0]!.totals.total, 400)
  assert.equal(tokens[1]!.totals.total, 150)
  assert.equal(tokens[0]!.models[0]!.cost.peak.input, 4_000_000)
  assert.equal(tokens[1]!.models[0]!.cost.peak.input, 1_500_000) // merged across sessions
  const cost = projectRowsOf(sessions, 'cost', {
    'deepseek-official/flash': { inputCacheHit: 0.1, inputCacheMiss: 2, output: 4.5 },
  }, true)
  // 4M×2=800c, 1.5M×2=300c, unknown 0 → cost order: proj-b, proj-a, (unknown).
  assert.deepEqual(cost.map((r) => r.name), ['proj-b', 'proj-a', '(unknown)'])
})

test('pathBasename handles POSIX and Windows separators', () => {
  assert.equal(pathBasename('/work/proj-b'), 'proj-b')
  assert.equal(pathBasename('C:\\proj-a'), 'proj-a')
  assert.equal(pathBasename(null), '')
  assert.equal(pathBasename(''), '')
})

test('pageOf slices and reports hasMore', () => {
  assert.deepEqual(pageOf([1, 2, 3, 4, 5], 0, 2), { rows: [1, 2], hasMore: true })
  assert.deepEqual(pageOf([1, 2, 3, 4, 5], 4, 2), { rows: [5], hasMore: false })
  assert.deepEqual(pageOf([1, 2, 3, 4, 5], 99, 2), { rows: [], hasMore: false })
})
