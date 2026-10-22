// Locks the aggregation semantics shared by the host scan path (v0.1.0
// behavior) and the projection path: disjoint buckets, UTC day keys, model
// ranking, hit rate, day window.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDayWindow,
  dayKeyUTC,
  emptyBuckets,
  emptyTotals,
  graphMonthLabels,
  graphWeeks,
  hitRate,
  listMonthKeys,
  mergeInto,
  monthKeyUTC,
  parseDayKeyUTC,
  sortedModels,
  sumDayBuckets,
  totalsFrom,
  totalsFromModels,
  isUsageEmpty,
  hasUsage,
  HEAT_DAYS,
} from '../src/shared/usage.ts'
import type { CoverageStats, DayRecord, Overview } from '../src/shared/contract.ts'

test('dayKeyUTC buckets by UTC calendar day', () => {
  // 2026-08-15T23:59:00 UTC+8 is 2026-08-15T15:59:00Z — same UTC day, but a
  // different LOCAL day for UTC+8. The key must follow UTC.
  const ts = Date.UTC(2026, 7, 15, 15, 59, 0) // 15:59Z = 23:59 UTC+8
  assert.equal(dayKeyUTC(ts), '2026-08-15')
  assert.equal(dayKeyUTC(Date.UTC(2026, 7, 15, 16, 0, 0)), '2026-08-15')
  assert.equal(dayKeyUTC(Date.UTC(2026, 7, 16, 0, 0, 0)), '2026-08-16')
  assert.equal(dayKeyUTC(Date.UTC(2026, 0, 2, 3, 4, 5)), '2026-01-02')
})

test('parseDayKeyUTC round-trips through UTC midnight', () => {
  const d = parseDayKeyUTC('2026-08-15')
  assert.equal(d.getUTCFullYear(), 2026)
  assert.equal(d.getUTCMonth(), 7)
  assert.equal(d.getUTCDate(), 15)
  assert.equal(d.getUTCHours(), 0)
})

test('totalsFrom sets total = uncached input + output (cache excluded)', () => {
  // DSH TokenUsage buckets are disjoint: input is uncached only. The displayed
  // total is the Magpie gateway's headline `in + out` — cache read/write are
  // separate stats and must never be folded in.
  const t = totalsFrom({ input: 10, output: 20, cacheRead: 30, cacheWrite: 5 })
  assert.deepEqual(t, { input: 10, output: 20, cacheRead: 30, cacheWrite: 5, total: 30 })
})

test('hasUsage counts cache-only buckets as usage', () => {
  assert.equal(hasUsage({ input: 1, output: 0, cacheRead: 0, cacheWrite: 0 }), true)
  assert.equal(hasUsage({ input: 0, output: 0, cacheRead: 900, cacheWrite: 0 }), true)
  assert.equal(hasUsage({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }), false)
})

test('sumDayBuckets sums only days at or after the cutoff key', () => {
  const byDay = {
    '2026-08-01': { a: { input: 1, output: 1, cacheRead: 1, cacheWrite: 0 } },
    '2026-08-14': { a: { input: 10, output: 5, cacheRead: 100, cacheWrite: 0 }, b: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0 } },
    '2026-08-15': { b: { input: 4, output: 0, cacheRead: 0, cacheWrite: 1 } },
  }
  const recent = sumDayBuckets(byDay, '2026-08-02')
  assert.deepEqual(recent.totals, { input: 16, output: 8, cacheRead: 100, cacheWrite: 1 })
  assert.deepEqual(recent.byModel['a'], { input: 10, output: 5, cacheRead: 100, cacheWrite: 0 })
  assert.deepEqual(recent.byModel['b'], { input: 6, output: 3, cacheRead: 0, cacheWrite: 1 })
  assert.deepEqual(sumDayBuckets(byDay, '2026-08-16'), { totals: emptyBuckets(), byModel: {} })
})

test('emptyTotals and mergeInto are additive and idempotent', () => {
  const a = emptyTotals()
  const b = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }
  mergeInto(a, b)
  mergeInto(a, b)
  assert.deepEqual(a, { input: 2, output: 4, cacheRead: 6, cacheWrite: 8, total: 0 })
})

test('sortedModels ranks by total desc and preserves buckets', () => {
  const map = {
    'model-b': { input: 5, output: 5, cacheRead: 5, cacheWrite: 5 },
    'model-a': { input: 100, output: 0, cacheRead: 0, cacheWrite: 0 },
    unknown: emptyBuckets(),
  }
  const rows = sortedModels(map)
  assert.deepEqual(
    rows.map((r) => r.model),
    ['model-a', 'model-b', 'unknown'],
  )
  assert.equal(rows[0]!.total, 100)
  assert.equal(rows[1]!.total, 10) // 5 in + 5 out; cache read/write excluded
  assert.equal(rows[2]!.total, 0)
})

test('totalsFromModels aggregates a ranking back into totals', () => {
  const rows = sortedModels({
    a: { input: 10, output: 10, cacheRead: 10, cacheWrite: 10 },
    b: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
  })
  assert.equal(totalsFromModels(rows).total, 22)
  assert.equal(totalsFromModels(rows).input, 11)
  assert.equal(totalsFromModels(rows).cacheRead, 11)
})

test('hitRate = read / (uncached + read + write); null when nothing billed', () => {
  assert.equal(hitRate({ input: 80, output: 0, cacheRead: 20, cacheWrite: 0 }), 0.2)
  assert.equal(hitRate({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }), null)
  assert.equal(hitRate({ input: 0, output: 100, cacheRead: 0, cacheWrite: 10 }), 0)
  assert.equal(hitRate({ input: 100, output: 0, cacheRead: 900, cacheWrite: 0 }), 0.9)
})

test('buildDayWindow produces HEAT_DAYS zero-filled records ending today (UTC)', () => {
  const now = Date.UTC(2026, 7, 15, 12, 0, 0)
  const days = buildDayWindow({}, now)
  assert.equal(days.length, HEAT_DAYS)
  assert.equal(days[HEAT_DAYS - 1]!.date, '2026-08-15')
  assert.equal(days[HEAT_DAYS - 2]!.date, '2026-08-14')
  assert.equal(days[0]!.date, '2026-02-15')
  for (const d of days) {
    assert.equal(d.total, 0)
    assert.deepEqual(d.models, {})
  }
})

test('buildDayWindow merges per-model buckets into the right day', () => {
  const byDay = {
    '2026-08-14': { 'model-a': { input: 3, output: 4, cacheRead: 5, cacheWrite: 6 } },
    '2026-07-01': { 'model-a': { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 } },
  }
  const now = Date.UTC(2026, 7, 15, 12, 0, 0)
  const days = buildDayWindow(byDay, now)
  const d14 = days.find((d) => d.date === '2026-08-14')!
  assert.equal(d14.total, 7) // 3 in + 4 out; cache 5/6 excluded
  assert.deepEqual(d14.models['model-a'], { input: 3, output: 4, cacheRead: 5, cacheWrite: 6, total: 7 })
  const d1 = days.find((d) => d.date === '2026-07-01')!
  assert.equal(d1.total, 1)
})

test('monthKeyUTC and listMonthKeys walk the heatmap window', () => {
  assert.equal(monthKeyUTC('2026-08-15'), '2026-08')
  const now = Date.UTC(2026, 7, 15, 12, 0, 0)
  const days = buildDayWindow({}, now)
  const months = listMonthKeys(days)
  assert.equal(months[0], '2026-02')
  assert.equal(months[months.length - 1], '2026-08')
  assert.ok(months.includes('2026-05'))
})

test('graphWeeks groups the window into Monday-first columns with null pads', () => {
  const now = Date.UTC(2026, 8, 25, 12, 0, 0)
  const days = buildDayWindow({}, now)
  const weeks = graphWeeks(days)
  // Every column is a full 7-slot Mon→Sun frame.
  for (const week of weeks) assert.equal(week.length, 7)
  // Column-major flattening reproduces the day order (pads excluded).
  const flat = weeks.flat().filter((cell) => cell !== null)
  assert.equal(flat.length, days.length)
  assert.equal(flat[0]!.date, days[0]!.date)
  assert.equal(flat[flat.length - 1]!.date, days[days.length - 1]!.date)
  // Each record sits on its true weekday row (Mon=0 … Sun=6), the first
  // column pads lead, the last pads trail.
  const rowOf = (date: string) => (parseDayKeyUTC(date).getUTCDay() + 6) % 7
  for (const week of weeks) {
    for (let r = 0; r < 7; r++) {
      const cell = week[r]
      if (cell !== null) assert.equal(rowOf(cell.date), r)
    }
  }
  const firstWeek = weeks[0]!
  const leadRow = rowOf(days[0]!.date)
  for (let r = 0; r < leadRow; r++) assert.equal(firstWeek[r], null)
  assert.equal(firstWeek[leadRow]!.date, days[0]!.date)
  const lastWeek = weeks[weeks.length - 1]!
  const tailRow = rowOf(days[days.length - 1]!.date)
  for (let r = tailRow + 1; r < 7; r++) assert.equal(lastWeek[r], null)
})

function graphDay(date: string): DayRecord {
  return { date, total: 0, models: {}, cost: { peak: emptyBuckets(), offPeak: emptyBuckets() }, modelCosts: {} }
}

test('graphMonthLabels marks month boundaries and skips colliding labels', () => {
  const now = Date.UTC(2026, 8, 25, 12, 0, 0)
  const days = buildDayWindow({}, now)
  const weeks = graphWeeks(days)
  const labels = graphMonthLabels(weeks)
  // Every label sits at a week whose leading real day enters that month, and
  // months never repeat.
  const seen = new Set<string>()
  for (const label of labels) {
    assert.ok(!seen.has(label.monthKey))
    seen.add(label.monthKey)
    const first = weeks[label.week]!.find((cell) => cell !== null)!
    assert.equal(monthKeyUTC(first.date), label.monthKey)
  }
  // The window's final month is always labeled; months stay in order.
  assert.equal(labels[labels.length - 1]!.monthKey, monthKeyUTC(days[days.length - 1]!.date))
  for (let i = 1; i < labels.length; i++) {
    assert.ok(labels[i]!.monthKey > labels[i - 1]!.monthKey)
    assert.ok(labels[i]!.week > labels[i - 1]!.week)
  }
})

test('graphMonthLabels drops the leading label when the second crowds it', () => {
  // A window starting Mon 2026-03-30 puts 'Mar' at week 0 and 'Apr' at week 1
  // — one column apart — so the partial-month label yields.
  const days = ['2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04', '2026-04-05', '2026-04-06']
    .map(graphDay)
  const labels = graphMonthLabels(graphWeeks(days))
  assert.deepEqual(labels, [{ week: 1, monthKey: '2026-04' }])
  // With a wider gap the leading label stays: a window starting Fri 2026-03-27
  // puts 'Mar' at week 0 and 'Apr' at week 2 (the first week starting in April).
  const wider = ['2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31',
    '2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04', '2026-04-05', '2026-04-06'].map(graphDay)
  const widerLabels = graphMonthLabels(graphWeeks(wider))
  assert.deepEqual(widerLabels, [{ week: 0, monthKey: '2026-03' }, { week: 2, monthKey: '2026-04' }])
})

test('mergeInto handles zero buckets without NaN', () => {
  const t = emptyTotals()
  mergeInto(t, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
  assert.equal(t.total, 0)
  assert.ok(Number.isFinite(t.input))
})

function overviewForEmpty(sessionCount: number, sessionsFailed: number, sessionsTotal = sessionCount): Pick<Overview, 'allTime' | 'coverage'> {
  const coverage: CoverageStats = {
    mode: 'projection',
    timezone: 'UTC',
    sessionsTotal,
    sessionsOk: 0,
    sessionsFailed,
    sessionsPending: 0,
    eventsCounted: 0,
    retries: 0,
    compactionTokens: 0,
    from: null,
    to: null,
    usageSessionsMain: sessionCount,
    usageSessionsSubagent: 0,
  }
  return {
    allTime: { totals: emptyTotals(), sessionCount, byModel: [] },
    coverage,
  }
}

test('isUsageEmpty is true when there is no billed usage and no scan failure', () => {
  assert.equal(isUsageEmpty(overviewForEmpty(0, 0, 0)), true)
  assert.equal(isUsageEmpty(overviewForEmpty(0, 0, 3)), true)
})

test('isUsageEmpty is false when billed-usage sessions exist', () => {
  assert.equal(isUsageEmpty(overviewForEmpty(1, 0, 1)), false)
})

test('isUsageEmpty is false when the scan failed even with zero billed usage', () => {
  assert.equal(isUsageEmpty(overviewForEmpty(0, 1, 1)), false)
})
