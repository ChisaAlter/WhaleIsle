// dsh-usage-panel · CSV/JSON export builders + download helper.
// CSV cells follow RFC 4180 and are guarded against spreadsheet formula
// injection (=, +, -, @ prefixes get a leading '), and files carry a UTF-8 BOM
// so Excel detects UTF-8. Dates are the UTC day keys from the payload.
// Cost columns are ESTIMATES: integer cents; per-model priced (daily rows sum
// their models), empty when a row's model is unpriced — never a guessed 0.
import type { DayRecord, ModelItem, Overview, PhaseBuckets } from '../shared/contract.ts'
import type { SessionCostPrices } from '../shared/pricing.ts'
import { billedBucketsOf, computeBilledCost } from '../shared/cost.ts'
import { resolveModelPrice, type ResolvedModelPrice } from '../shared/pricing.ts'

/** Guard + quote one CSV cell (RFC 4180, formula-injection-safe). */
export function csvCell(value: string | number): string {
  let text = String(value)
  if (/^[=+\-@]/.test(text)) text = "'" + text
  if (/[",\n\r]/.test(text)) text = '"' + text.replace(/"/g, '""') + '"'
  return text
}

function phaseCost(row: PhaseBuckets, price: ResolvedModelPrice, phase: 'peak' | 'offPeak'): number {
  const usage = phase === 'peak'
    ? { peak: billedBucketsOf(row.peak), offPeak: { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 } }
    : { peak: { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 }, offPeak: billedBucketsOf(row.offPeak) }
  return computeBilledCost(usage, price)
}

/** One row's three cost figures, or nulls when the model is unpriced. */
function rowCost(
  phase: PhaseBuckets,
  provider: string | null,
  model: string,
  prices: SessionCostPrices,
  peakValley: boolean,
): { peak: number | null; idle: number | null; total: number | null } {
  const price = resolveModelPrice(provider, model, prices)
  if (price === null) return { peak: null, idle: null, total: null }
  const effective = peakValley ? price : { ...price, idle: price.peak }
  return {
    peak: phaseCost(phase, effective, 'peak'),
    idle: phaseCost(phase, effective, 'offPeak'),
    total: phaseCost(phase, effective, 'peak') + phaseCost(phase, effective, 'offPeak'),
  }
}

export function buildDailyCsv(
  days: DayRecord[],
  prices: SessionCostPrices = {},
  peakValley = true,
  modelProviders: Record<string, string> = {},
): string {
  const rows = ['date,total,input,output,cacheRead,cacheWrite,costPeakCents,costOffPeakCents,costTotalCents']
  for (const d of days) {
    if (d.total <= 0) continue
    let input = 0
    let output = 0
    let cacheRead = 0
    let cacheWrite = 0
    let peak: number | null = null
    let idle: number | null = null
    let total: number | null = null
    for (const model of Object.keys(d.models)) {
      const m = d.models[model]!
      input += m.input
      output += m.output
      cacheRead += m.cacheRead
      cacheWrite += m.cacheWrite
      const phase = d.modelCosts[model]
      if (phase === undefined) continue
      const row = rowCost(phase, modelProviders[model] ?? null, model, prices, peakValley)
      if (row.total === null) continue
      peak = (peak ?? 0) + row.peak!
      idle = (idle ?? 0) + row.idle!
      total = (total ?? 0) + row.total
    }
    rows.push(
      [
        csvCell(d.date),
        csvCell(d.total),
        csvCell(input),
        csvCell(output),
        csvCell(cacheRead),
        csvCell(cacheWrite),
        csvCell(peak === null ? '' : peak),
        csvCell(idle === null ? '' : idle),
        csvCell(total === null ? '' : total),
      ].join(','),
    )
  }
  return '\uFEFF' + rows.join('\n')
}

export function buildModelCsv(byModel: ModelItem[], prices: SessionCostPrices = {}, peakValley = true): string {
  const rows = ['model,provider,total,input,output,cacheRead,cacheWrite,costPeakCents,costOffPeakCents,costTotalCents']
  for (const m of byModel) {
    const cost = rowCost(m.cost, m.provider, m.model, prices, peakValley)
    rows.push(
      [
        csvCell(m.model),
        csvCell(m.provider),
        csvCell(m.total),
        csvCell(m.input),
        csvCell(m.output),
        csvCell(m.cacheRead),
        csvCell(m.cacheWrite),
        csvCell(cost.peak === null ? '' : cost.peak),
        csvCell(cost.idle === null ? '' : cost.idle),
        csvCell(cost.total === null ? '' : cost.total),
      ].join(','),
    )
  }
  return '\uFEFF' + rows.join('\n')
}

export function buildJson(overview: Overview): string {
  return JSON.stringify(overview, null, 2)
}

export function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.hidden = true
  document.body.appendChild(a)
  try {
    a.click()
  } finally {
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
