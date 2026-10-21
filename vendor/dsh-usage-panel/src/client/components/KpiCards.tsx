// dsh-usage-panel · KPI cards (all-time). v0.1.0 kept three cards; the cache
// hit-rate card is the P0-② addition and the cost card is the v0.3 billing
// addition (estimate only — the totals are model-priced client-side).
// The main number is uncached input + output (the Magpie gateway's headline);
// the detail line shows input / output / cache read separately — cache read is
// never folded into the total or into "input".
import type { I18n } from '../locales.ts'
import type { Locale } from '../../shared/format.ts'
import { fmtTokens, pctOf, pctFull } from '../../shared/format.ts'
import { hitRate } from '../../shared/usage.ts'
import { costCentsFor, splitCostCents, sumCostCents } from '../../shared/cost.ts'
import { formatCost, resolveModelPrice } from '../../shared/pricing.ts'
import { useBillingSettings, useCountUp } from '../hooks.ts'
import type { RpcLike } from '../ctx.ts'
import type { Overview } from '../../shared/contract.ts'
import * as React from 'react'
import { useMemo } from 'react'

interface KpiCardsProps {
  overview: Overview
  i18n: I18n
  rpc: RpcLike
}

export function KpiCards({ overview, i18n, rpc }: KpiCardsProps): JSX.Element {
  const t = i18n.t
  const locale: Locale = i18n.locale
  const allTime = overview.allTime || { totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, sessionCount: 0, byModel: [] }
  const totals = allTime.totals || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  // Uncached input + output only; the payload already derives it that way.
  const total = totals.total || 0
  const top = allTime.byModel[0] || null
  const rate = hitRate(totals)
  // The session-count KPI's secondary line carries the coverage counts that
  // used to live on the standalone 统计覆盖度 card (now removed): the grand
  // total of session records (incl. empty/failed/pending) plus the split of
  // sessions that actually produced usage by delegation depth.
  const coverage = overview.coverage

  // Cost KPI: per-model phase buckets × resolved prices (estimate, not a bill).
  const billing = useBillingSettings(rpc)
  const pricedRows = billing === null ? [] : allTime.byModel.map((m) => costCentsFor(m.cost, m.provider, m.model, billing.prices, billing.peakValleyEnabled))
  const costTotal = billing === null ? null : sumCostCents(pricedRows)
  // Peak/off-peak split for the detail line (priced rows only).
  const split = useMemo(() => {
    if (billing === null) return null
    let peak = 0
    let offPeak = 0
    let any = false
    for (const m of allTime.byModel) {
      const price = resolveModelPriceForSplit(m.provider, m.model, billing)
      if (price === null) continue
      any = true
      const parts = splitCostCents(m.cost, price)
      peak += parts.peak
      offPeak += parts.offPeak
    }
    return any ? { peak, offPeak } : null
  }, [billing, allTime.byModel])

  // Hooks must stay unconditional (hook-order invariant).
  const animatedTotal = useCountUp(total, 900)
  const animatedInput = useCountUp(totals.input, 900)
  const animatedOutput = useCountUp(totals.output, 900)
  const animatedCacheRead = useCountUp(totals.cacheRead, 900)
  const animatedSessions = useCountUp(allTime.sessionCount, 900)
  const animatedRate = useCountUp(rate === null ? 0 : rate * 100, 900)
  const animatedCost = useCountUp(costTotal === null ? 0 : costTotal, 900)

  const costValue = costTotal === null ? '—' : formatCost(animatedCost)
  const costDetail = split === null ? t('kpi.cost.none') : t('kpi.cost.detail', { peak: formatCost(split.peak), idle: formatCost(split.offPeak) })

  return (
    <div className="dsw-ust-kpis">
      <div className="dsw-ust-kpi">
        <div className="l">{t('kpi.total')}</div>
        <div className="v">{fmtTokens(animatedTotal, locale)}</div>
        <div className="d">
          {t('kpi.total.detail', {
            input: fmtTokens(animatedInput, locale),
            output: fmtTokens(animatedOutput, locale),
            cacheRead: fmtTokens(animatedCacheRead, locale),
          })}
        </div>
      </div>
      <div className="dsw-ust-kpi">
        <div className="l">{t('kpi.cost')}</div>
        <div className="v v-sm" title={t('strip.estimate')}>{costValue}</div>
        <div className="d">{costDetail}</div>
      </div>
      <div className="dsw-ust-kpi">
        <div className="l">{t('kpi.sessions')}</div>
        <div className="v">{String(Math.round(animatedSessions))}</div>
        <div className="d">
          {t('kpi.sessions.detail', {
            total: coverage.sessionsTotal,
            main: coverage.usageSessionsMain,
            subagent: coverage.usageSessionsSubagent,
          })}
        </div>
      </div>
      <div className="dsw-ust-kpi">
        <div className="l">{t('kpi.topModel')}</div>
        <div className="v v-sm">{top ? top.model : '—'}</div>
        <div className="d">{top ? t('kpi.topModel.detail', { pct: pctOf(top.total, total) }) : ''}</div>
      </div>
      <div className="dsw-ust-kpi">
        <div className="l">{t('kpi.hitRate')}</div>
        <div className="v v-sm">{rate === null ? '—' : pctFull(animatedRate / 100) + '%'}</div>
        <div className="d">
          {rate === null
            ? t('kpi.hitRate.none')
            : t('kpi.hitRate.detail', { read: fmtTokens(totals.cacheRead, locale), write: fmtTokens(totals.cacheWrite, locale) })}
        </div>
      </div>
    </div>
  )
}

function resolveModelPriceForSplit(
  provider: string,
  model: string,
  billing: { prices: import('../../shared/pricing.ts').SessionCostPrices; peakValleyEnabled: boolean },
): import('../../shared/pricing.ts').ResolvedModelPrice | null {
  const price = resolveModelPrice(provider, model, billing.prices)
  if (price === null) return null
  return billing.peakValleyEnabled ? price : { ...price, idle: price.peak }
}
