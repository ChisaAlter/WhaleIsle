// dsh-usage-panel · merge per-session projection values into one Overview.
// Pure functions shared by the projection scan path (tests included).
import type { Buckets, CoverageStats, DayRecord, ModelItem, Overview, PhaseBuckets, ProjectRow, ProviderItem, SessionModelCost, SessionSummary, UsageTotals } from '../shared/contract.ts'
import type { SessionCostPrices } from '../shared/pricing.ts'
import { totalCostCents } from '../shared/cost.ts'
import {
  HEAT_DAYS,
  RECENT_DAYS,
  buildDayWindow,
  dayKeyUTC,
  emptyTotals,
  hasUsage,
  mergeInto,
  sortedModels,
  sumDayBuckets,
  totalsFrom,
  totalsFromModels,
} from '../shared/usage.ts'
import { recentOf, type UsagePanelState } from './projection.ts'
import type { MagpieSource } from './magpie-usage.ts'

export interface SessionAgg {
  id: string
  /** Session working directory (the desktop "project" grouping key). */
  cwd: string | null
  totals: UsageTotals
  lastActive: number
  depth: number
  /** Per-model cost buckets of the session (model → provider via last-wins). */
  models: SessionModelCost[]
}

export interface Aggregate {
  allTimeTotals: UsageTotals
  allTimeByModel: Record<string, Buckets>
  allTimeByProvider: Record<string, Buckets>
  allTimeCost: PhaseBuckets
  allTimeCostByModel: Record<string, PhaseBuckets>
  /** Global last-seen provider per model (first-wins across merged sessions). */
  allTimeModelProviders: Record<string, string>
  byDay: Record<string, Record<string, Buckets>>
  byDayCost: Record<string, Record<string, PhaseBuckets>>
  recentTotals: UsageTotals
  recentByModel: Record<string, Buckets>
  recentCostByModel: Record<string, PhaseBuckets>
  recentSessionCount: number
  allTimeSessionCount: number
  retries: number
  compactionTokens: number
  from: number | null
  to: number | null
  usageSessionsMain: number
  usageSessionsSubagent: number
  sessions: SessionAgg[]
}

const EMPTY_COST: PhaseBuckets = Object.freeze({ peak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, offPeak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })

function emptyCost(): PhaseBuckets {
  return { peak: { ...EMPTY_COST.peak }, offPeak: { ...EMPTY_COST.offPeak } }
}

export function emptyAggregate(): Aggregate {
  return {
    allTimeTotals: emptyTotals(),
    allTimeByModel: {},
    allTimeByProvider: {},
    allTimeCost: emptyCost(),
    allTimeCostByModel: {},
    allTimeModelProviders: {},
    byDay: {},
    byDayCost: {},
    recentTotals: emptyTotals(),
    recentByModel: {},
    recentCostByModel: {},
    recentSessionCount: 0,
    allTimeSessionCount: 0,
    retries: 0,
    compactionTokens: 0,
    from: null,
    to: null,
    usageSessionsMain: 0,
    usageSessionsSubagent: 0,
    sessions: [],
  }
}

/** Merge one session's projection value into the aggregate (pure). */
export function mergeSessionValue(a: Aggregate, value: UsagePanelState, sessionId: string, now: number, depth = 0, cwd: string | null = null): Aggregate {
  const cutoffKey = dayKeyUTC(now - RECENT_DAYS * 24 * 3600 * 1000)
  const recent = recentOf(value, cutoffKey)
  const totals = totalsFrom(value.totals)
  const next: Aggregate = {
    ...a,
    allTimeTotals: {
      input: a.allTimeTotals.input + totals.input,
      output: a.allTimeTotals.output + totals.output,
      cacheRead: a.allTimeTotals.cacheRead + totals.cacheRead,
      cacheWrite: a.allTimeTotals.cacheWrite + totals.cacheWrite,
      total: a.allTimeTotals.total + totals.total,
    },
    recentTotals: {
      input: a.recentTotals.input + recent.totals.input,
      output: a.recentTotals.output + recent.totals.output,
      cacheRead: a.recentTotals.cacheRead + recent.totals.cacheRead,
      cacheWrite: a.recentTotals.cacheWrite + recent.totals.cacheWrite,
      // Same rule as totalsFrom: uncached input + output, cache excluded.
      total: a.recentTotals.total + recent.totals.input + recent.totals.output,
    },
    retries: a.retries + value.retries,
    compactionTokens: a.compactionTokens + value.compactionTokens,
    from: a.from === null ? value.firstTime : value.firstTime === null ? a.from : Math.min(a.from, value.firstTime),
    to: a.to === null ? value.lastTime : value.lastTime === null ? a.to : Math.max(a.to, value.lastTime),
  }
  // Merge nested maps with clone-on-write.
  for (const model of Object.keys(value.byModel)) {
    const b = value.byModel[model]!
    const cur = next.allTimeByModel[model]
    next.allTimeByModel[model] = cur ? mergeB(cur, b) : { ...b }
  }
  for (const model of Object.keys(value.costByModel)) {
    const phase = value.costByModel[model]!
    const cur = next.allTimeCostByModel[model]
    next.allTimeCostByModel[model] = cur ? mergePhase(cur, phase) : { peak: { ...phase.peak }, offPeak: { ...phase.offPeak } }
  }
  for (const model of Object.keys(value.modelProviders)) {
    if (next.allTimeModelProviders[model] === undefined) next.allTimeModelProviders[model] = value.modelProviders[model]!
  }
  for (const provider of Object.keys(value.byProvider)) {
    const b = value.byProvider[provider]!
    const cur = next.allTimeByProvider[provider]
    next.allTimeByProvider[provider] = cur ? mergeB(cur, b) : { ...b }
  }
  for (const day of Object.keys(value.byDay)) {
    const dayMap = value.byDay[day]!
    const target = next.byDay[day] || (next.byDay[day] = {})
    for (const model of Object.keys(dayMap)) {
      const b = dayMap[model]!
      const cur = target[model]
      target[model] = cur ? mergeB(cur, b) : { ...b }
    }
  }
  for (const day of Object.keys(value.costByDay)) {
    const dayMap = value.costByDay[day]!
    const target = next.byDayCost[day] || (next.byDayCost[day] = {})
    for (const model of Object.keys(dayMap)) {
      const phase = dayMap[model]!
      const cur = target[model]
      target[model] = cur ? mergePhase(cur, phase) : { peak: { ...phase.peak }, offPeak: { ...phase.offPeak } }
    }
  }
  for (const model of Object.keys(recent.byModel)) {
    const b = recent.byModel[model]!
    const cur = next.recentByModel[model]
    next.recentByModel[model] = cur ? mergeB(cur, b) : { ...b }
  }
  for (const model of Object.keys(recent.costByModel)) {
    const phase = recent.costByModel[model]!
    const cur = next.recentCostByModel[model]
    next.recentCostByModel[model] = cur ? mergePhase(cur, phase) : { peak: { ...phase.peak }, offPeak: { ...phase.offPeak } }
  }
  if (recent.totals.input + recent.totals.output + recent.totals.cacheRead + recent.totals.cacheWrite > 0) {
    next.recentSessionCount += 1
  }
  // Presence test uses all four buckets: a session whose traffic was cache-only
  // still counts as a session with usage (its `total` is 0 by definition).
  if (hasUsage(totals)) {
    next.allTimeSessionCount += 1
    if (depth > 0) next.usageSessionsSubagent += 1
    else next.usageSessionsMain += 1
    next.sessions.push({
      id: sessionId,
      cwd,
      totals,
      lastActive: value.lastTime ?? 0,
      depth,
      models: sessionModels(value),
    })
  }
  next.allTimeCost = mergePhase(next.allTimeCost, value.costTotals)
  return next
}

/** One session's per-model cost rows (provider via the last-wins mapping). */
export function sessionModels(value: UsagePanelState): SessionModelCost[] {
  return Object.keys(value.costByModel).map((model) => ({
    model,
    provider: value.modelProviders[model] ?? 'unknown',
    cost: value.costByModel[model]!,
  }))
}

function mergePhase(a: PhaseBuckets, b: PhaseBuckets): PhaseBuckets {
  return {
    peak: mergeB(a.peak, b.peak),
    offPeak: mergeB(a.offPeak, b.offPeak),
  }
}

function mergeB(a: Buckets, b: Buckets): Buckets {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  }
}

export function rankSessions(sessions: SessionAgg[], limit: number): SessionAgg[] {
  return [...sessions].sort((a, b) => b.totals.total - a.totals.total).slice(0, limit)
}

/** Rank sessions by the chosen metric; `cost` uses the user's current prices
 *  (null rows trail), `tokens` is the all-time total. */
export function rankSessionsBy(
  sessions: SessionAgg[],
  sort: 'tokens' | 'cost',
  prices: SessionCostPrices,
  peakValley: boolean,
): SessionAgg[] {
  if (sort === 'cost') {
    return [...sessions].sort((a, b) => {
      const ac = totalCostCents(a.models, prices, peakValley)
      const bc = totalCostCents(b.models, prices, peakValley)
      if (ac === null && bc === null) return b.totals.total - a.totals.total
      if (ac === null) return 1
      if (bc === null) return -1
      return bc - ac
    })
  }
  return [...sessions].sort((a, b) => b.totals.total - a.totals.total)
}

/** Basename of an absolute path for display (Windows and POSIX separators). */
export function pathBasename(dir: string | null): string {
  if (dir === null || dir === '') return ''
  const sep = dir.includes('\\') ? '\\' : '/'
  const parts = dir.split(sep).filter((p) => p !== '')
  return parts[parts.length - 1] ?? dir
}

/**
 * Group sessions by working directory (the desktop "project") into rows with
 * their estimated cost attached, sorted by `sort` (tokens default).
 */
export function projectRowsOf(
  sessions: readonly SessionAgg[],
  sort: 'tokens' | 'cost' = 'tokens',
  prices: SessionCostPrices = {},
  peakValley = true,
): ProjectRow[] {
  const byProject = new Map<string, ProjectRow>()
  for (const session of sessions) {
    const key = session.cwd ?? '(unknown)'
    let row = byProject.get(key)
    if (row === undefined) {
      row = { project: session.cwd, name: pathBasename(session.cwd) || '(unknown)', totals: emptyTotals(), models: [] }
      byProject.set(key, row)
    }
    const totals = row.totals
    totals.input += session.totals.input
    totals.output += session.totals.output
    totals.cacheRead += session.totals.cacheRead
    totals.cacheWrite += session.totals.cacheWrite
    totals.total += session.totals.total
    const index = new Map<string, number>()
    row.models.forEach((m, i) => index.set(m.model + '\0' + m.provider, i))
    for (const m of session.models) {
      const idx = index.get(m.model + '\0' + m.provider)
      if (idx !== undefined) {
        const cur = row.models[idx]!
        cur.cost = { peak: mergeB(cur.cost.peak, m.cost.peak), offPeak: mergeB(cur.cost.offPeak, m.cost.offPeak) }
      } else {
        index.set(m.model + '\0' + m.provider, row.models.length)
        row.models.push({ model: m.model, provider: m.provider, cost: { peak: { ...m.cost.peak }, offPeak: { ...m.cost.offPeak } } })
      }
    }
  }
  const rows = [...byProject.values()]
  if (sort === 'cost') {
    rows.sort((a, b) => {
      const ac = totalCostCents(a.models, prices, peakValley)
      const bc = totalCostCents(b.models, prices, peakValley)
      if (ac === null && bc === null) return b.totals.total - a.totals.total
      if (ac === null) return 1
      if (bc === null) return -1
      return bc - ac
    })
  } else {
    rows.sort((a, b) => b.totals.total - a.totals.total)
  }
  return rows
}

/** One size-T page slice with the hasMore flag (shared by sessions/projects). */
export function pageOf<T>(rows: readonly T[], offset: number, limit: number): { rows: T[]; hasMore: boolean } {
  const start = Math.max(0, offset)
  return {
    rows: rows.slice(start, start + limit),
    hasMore: start + limit < rows.length,
  }
}

export interface FinalizeInput {
  aggregate: Aggregate
  now: number
  mode: CoverageStats['mode']
  sessionsTotal: number
  sessionsOk: number
  sessionsFailed: number
  sessionsPending: number
  eventsCounted: number
  titles: Map<string, string | null>
  providerNames: Record<string, string>
  /** Ids of sessions whose log read failed (repair candidates, capped). */
  failedSessionIds?: string[]
  /**
   * Folded Magpie gateway ledger, when the local file exists. It then supplies
   * the token totals / days / model + provider splits (the gateway sees every
   * request, including logs that are already rotated away). Sessions,
   * projects, per-session ranking and the cost buckets stay log-derived.
   */
  magpie?: MagpieSource | null
}

/** Build the wire Overview from an aggregate (both scan modes converge here). */
export function finalizeOverview(input: FinalizeInput): Overview {
  const { aggregate: a, now, mode, sessionsTotal, sessionsOk, sessionsFailed, sessionsPending, eventsCounted, titles, providerNames, magpie } = input
  // The gateway ledger wins for the top-level token numbers when present: same
  // `in + out` definition, complete history.
  const gateway = magpie ?? null
  // Provider attribution stays the PANEL's: the log-derived model→provider map
  // (usually `magpie`, the route the user's prices are scoped to) wins; the
  // gateway's upstream id is only a fallback for models the logs never saw.
  // Using the upstream id for a logged model would leave its cost row unpriced.
  const modelProviders = gateway === null ? a.allTimeModelProviders : { ...gateway.upstreamProviders, ...a.allTimeModelProviders }
  const recent = gateway === null ? null : sumDayBuckets(gateway.byDay, recentCutoffKey(now))
  const recentByModel = sortedModels(
    recent === null ? a.recentByModel : recent.byModel,
    a.recentCostByModel,
    modelProviders,
  )
  const allTimeByModel = sortedModels(
    gateway === null ? a.allTimeByModel : gateway.byModel,
    a.allTimeCostByModel,
    modelProviders,
  )
  // Provider rows are the same model buckets regrouped by that attribution, so
  // the card adds up to the same all-time total instead of reporting a second,
  // gateway-side provider dimension.
  const allTimeByProvider = gateway === null ? a.allTimeByProvider : providerGroups(gateway.byModel, modelProviders)
  const recentTotals = recent === null ? totalsFromModels(recentByModel) : totalsFrom(recent.totals)
  const allTimeTotals = gateway === null ? totalsFromModels(allTimeByModel) : totalsFrom(gateway.totals)
  const providerRows: ProviderItem[] = Object.keys(allTimeByProvider)
    .map((id) => {
      const b = allTimeByProvider[id]!
      return { id, name: providerNames[id] || id, totals: totalsFrom(b) }
    })
    .sort((x, y) => y.totals.total - x.totals.total)
  const top = rankSessions(a.sessions, 10)
  const topSessions: SessionSummary[] = top.map((s) => ({
    id: s.id,
    title: titles.has(s.id) ? titles.get(s.id)! : null,
    totals: s.totals,
    lastActive: s.lastActive,
    depth: s.depth,
    models: s.models,
  }))
  const coverage: CoverageStats = {
    mode,
    timezone: 'UTC',
    sessionsTotal,
    sessionsOk,
    sessionsFailed,
    sessionsPending,
    eventsCounted,
    retries: a.retries,
    compactionTokens: a.compactionTokens,
    from: a.from,
    to: a.to,
    usageSessionsMain: a.usageSessionsMain,
    usageSessionsSubagent: a.usageSessionsSubagent,
    failedSessionIds: input.failedSessionIds ?? [],
    source: gateway === null ? 'logs' : 'magpie',
    ...(gateway === null
      ? {}
      : { magpie: { file: gateway.file, calls: gateway.calls, from: gateway.from, to: gateway.to } }),
  }
  return {
    // Day cells stay UTC (declared contract) and keep the log-derived cost
    // buckets: a gateway row has no billing phase.
    days: buildDayWindow(gateway === null ? a.byDay : gateway.byDay, now, a.byDayCost),
    totals: recentTotals,
    sessionCount: a.recentSessionCount,
    byModel: recentByModel,
    allTime: {
      totals: allTimeTotals,
      sessionCount: a.allTimeSessionCount,
      byModel: allTimeByModel,
      costTotals: a.allTimeCost,
    },
    coverage,
    topSessions,
    providers: providerRows,
    updatedAt: now,
  }
}

/** First UTC day key inside the rolling recent window (same rule as the logs). */
function recentCutoffKey(now: number): string {
  return dayKeyUTC(now - RECENT_DAYS * 24 * 3600 * 1000)
}

/** Regroup model buckets by provider route (unknown when unattributed). */
function providerGroups(
  byModel: Readonly<Record<string, Buckets>>,
  providers: Readonly<Record<string, string>>,
): Record<string, Buckets> {
  const out: Record<string, Buckets> = {}
  for (const model of Object.keys(byModel)) {
    const provider = providers[model] ?? 'unknown'
    const cur = out[provider]
    out[provider] = cur ? mergeB(cur, byModel[model]!) : { ...byModel[model]! }
  }
  return out
}

export function emptyOverview(now: number): Overview {
  return finalizeOverview({
    aggregate: emptyAggregate(),
    now,
    mode: 'none',
    sessionsTotal: 0,
    sessionsOk: 0,
    sessionsFailed: 0,
    sessionsPending: 0,
    eventsCounted: 0,
    titles: new Map(),
    providerNames: {},
  })
}

export const HEAT_DAYS_UTC = HEAT_DAYS

export type { DayRecord }
