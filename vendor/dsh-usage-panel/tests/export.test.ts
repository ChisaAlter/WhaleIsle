// Locks the CSV/JSON export builders: formula-injection guard (=, +, -, @),
// RFC 4180 quoting, UTF-8 BOM, stable column shapes (P1-⑧), and the v0.3
// cost columns (per-model priced estimates, empty when unpriced).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDailyCsv, buildModelCsv, buildJson, csvCell } from '../src/client/export.ts'
import type { DayRecord, ModelItem, Overview } from '../src/shared/contract.ts'

const ZERO = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

test('csvCell guards formula injection with a leading apostrophe', () => {
  assert.equal(csvCell('=SUM(A1:A9)'), "'=SUM(A1:A9)")
  assert.equal(csvCell('+123'), "'+123")
  assert.equal(csvCell('-1+1'), "'-1+1")
  assert.equal(csvCell('@cmd'), "'@cmd")
  assert.equal(csvCell('normal'), 'normal')
  assert.equal(csvCell(42), '42')
})

test('csvCell quotes per RFC 4180', () => {
  assert.equal(csvCell('a,b'), '"a,b"')
  assert.equal(csvCell('a"b'), '"a""b"')
  assert.equal(csvCell('line\nbreak'), '"line\nbreak"')
  assert.equal(csvCell('safe'), 'safe')
})

test('buildDailyCsv has BOM, header and per-day rows', () => {
  const days: DayRecord[] = [
    { date: '2026-08-15', total: 0, models: {}, cost: { peak: { ...ZERO }, offPeak: { ...ZERO } }, modelCosts: {} },
    {
      date: '2026-08-14',
      total: 25,
      models: {
        'model-a': { input: 10, output: 5, cacheRead: 3, cacheWrite: 2, total: 15 },
        'model-b': { input: 10, output: 0, cacheRead: 0, cacheWrite: 0, total: 10 },
      },
      cost: { peak: { ...ZERO }, offPeak: { ...ZERO } },
      modelCosts: {},
    },
  ]
  const csv = buildDailyCsv(days)
  assert.ok(csv.startsWith('\uFEFF'), 'must start with BOM')
  const lines = csv.slice(1).split('\n')
  assert.equal(lines[0], 'date,total,input,output,cacheRead,cacheWrite,costPeakCents,costOffPeakCents,costTotalCents')
  // total = input + output (20 + 5); cache read/write stay in their own columns.
  assert.equal(lines[1], '2026-08-14,25,20,5,3,2,,,')
  assert.equal(lines.length, 2, 'day without any token activity is skipped')
})

test('buildDailyCsv keeps a cache-only day (its in+out total is 0)', () => {
  const days: DayRecord[] = [
    {
      date: '2026-08-13',
      total: 0,
      models: { 'model-a': { input: 0, output: 0, cacheRead: 4096, cacheWrite: 0, total: 0 } },
      cost: { peak: { ...ZERO }, offPeak: { ...ZERO } },
      modelCosts: {},
    },
  ]
  const lines = buildDailyCsv(days).slice(1).split('\n')
  assert.equal(lines[1], '2026-08-13,0,0,0,4096,0,,,')
})

test('buildDailyCsv prices per model: flash peak 1M + pro idle 500k with custom prices', () => {
  const days: DayRecord[] = [
    {
      date: '2026-08-14',
      total: 30,
      models: {
        'flash': { input: 20, output: 0, cacheRead: 0, cacheWrite: 0, total: 20 },
        'pro': { input: 10, output: 0, cacheRead: 0, cacheWrite: 0, total: 10 },
      },
      cost: { peak: { ...ZERO }, offPeak: { ...ZERO } },
      modelCosts: {
        flash: { peak: { input: 2_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }, offPeak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
        pro: { peak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, offPeak: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 } },
      },
    },
  ]
  const csv = buildDailyCsv(days, {
    'deepseek-official/flash': { inputCacheHit: 1, inputCacheMiss: 2, output: 3 },
    'deepseek-official/pro': { inputCacheHit: 1, inputCacheMiss: 8, output: 1 },
  }, false, { flash: 'deepseek-official', pro: 'deepseek-official' })
  const lines = csv.slice(1).split('\n')
  // flash 2M(peak)×2 = 400; pro 1M(off-peak)×8 = 800 → columns: 400 / 800 / 1200.
  assert.equal(lines[1], '2026-08-14,30,30,0,0,0,400,800,1200')
})

test('buildModelCsv rows are formula-guarded, ordered as given, cost columns priced', () => {
  const byModel: ModelItem[] = [
    { model: 'deepseek-v4-flash', provider: 'deepseek-official', total: 10, input: 1, output: 0, cacheRead: 0, cacheWrite: 0, cost: { peak: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }, offPeak: { ...ZERO } } },
    { model: '=EVIL', provider: 'p1', total: 10, input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: { peak: { ...ZERO }, offPeak: { ...ZERO } } },
  ]
  const csv = buildModelCsv(byModel)
  assert.ok(csv.startsWith('\uFEFF'))
  const lines = csv.slice(1).split('\n')
  assert.equal(lines[0], 'model,provider,total,input,output,cacheRead,cacheWrite,costPeakCents,costOffPeakCents,costTotalCents')
  // official flash: 1M peak × 3.0 = 300 cents peak; no off-peak usage → idle col 0.
  // total column = input + output (1 + 0), never including cache read/write.
  assert.equal(lines[1], 'deepseek-v4-flash,deepseek-official,1,1,0,0,0,300,0,300')
  assert.equal(lines[2], "'=EVIL,p1,3,1,2,3,4,,,")
  // '=EVIL' provider resolves nothing → unpriced columns are empty, never 0.
})

test('buildJson round-trips the overview payload', () => {
  const overview: Overview = {
    days: [],
    totals: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 3 },
    sessionCount: 1,
    byModel: [],
    allTime: { totals: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 3 }, sessionCount: 1, byModel: [], costTotals: { peak: { ...ZERO }, offPeak: { ...ZERO } } },
    coverage: {
      mode: 'scan',
      timezone: 'UTC',
      sessionsTotal: 1,
      sessionsOk: 1,
      sessionsFailed: 0,
      sessionsPending: 0,
      eventsCounted: 3,
      retries: 0,
      compactionTokens: 0,
      from: 1,
      to: 2,
    },
    topSessions: [],
    providers: [],
    updatedAt: 123,
  }
  const parsed = JSON.parse(buildJson(overview)) as Overview
  assert.equal(parsed.totals.total, 3)
  assert.equal(parsed.coverage.sessionsTotal, 1)
})
