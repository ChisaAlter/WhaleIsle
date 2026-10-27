// dsh-usage-panel · settings-page orchestrator.
// State machine: loading / fresh / stale (background refresh) / fallback
// (refresh failed, cached payload kept with last success timestamp) / error.
// localStorage SWR cache makes a refresh render instantly (P1-⑨); the header
// keeps the v0.1.0 refresh button and gains the export menu (P1-⑧).
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Overview } from '../shared/contract.ts'
import { formatClock } from '../shared/format.ts'
import { dayKeyUTC, isUsageEmpty } from '../shared/usage.ts'
import { callOverview, callRepairSession, loadCached, saveCached } from './api.ts'
import { createOverviewRequests } from './overview-requests.ts'
import { useBillingSettings, useI18n, useLatest, type Tip } from './hooks.ts'
import type { RpcLike } from './ctx.ts'
import type { I18n } from './locales.ts'
import { Tooltip } from './components/Tooltip.tsx'
import { KpiCards } from './components/KpiCards.tsx'
import { Heatmap } from './components/Heatmap.tsx'
import { BarChart } from './components/BarChart.tsx'
import { SessionsCard } from './components/SessionsCard.tsx'
import { ProjectRankCard } from './components/ProjectRankCard.tsx'
import { ProvidersCard } from './components/ProvidersCard.tsx'
import { ModelDonut } from './components/ModelDonut.tsx'
import { ExportMenu } from './components/ExportMenu.tsx'
import { BillingSettingsModal } from './BillingSettingsModal.tsx'
import { Button, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import * as React from 'react'

export type Freshness = 'loading' | 'fresh' | 'stale' | 'fallback' | 'error'

/**
 * Provenance line under the header: which ledger the token totals came from.
 * The Magpie gateway ledger carries the calls/range the all-time numbers cover;
 * the log path states the fork-deduped in+out rule. `title` carries the file.
 */
function sourceNote(overview: Overview, t: I18n['t']): { text: string; title?: string } {
  const coverage = overview.coverage
  const magpie = coverage ? coverage.magpie : undefined
  if (coverage && coverage.source === 'magpie' && magpie) {
    return {
      text: t('source.magpie', {
        calls: magpie.calls,
        from: magpie.from === null ? '—' : dayKeyUTC(magpie.from),
        to: magpie.to === null ? '—' : dayKeyUTC(magpie.to),
      }),
      title: magpie.file,
    }
  }
  return { text: t('source.logs') }
}

interface StatsSectionProps {
  rpc: RpcLike
  i18n: I18n
  /** Cost display switches other features place above the statistics. */
  settingsRows?: ReactNode
  indexOnly?: boolean
}

export function StatsSection(props: StatsSectionProps): JSX.Element {
  if (props.indexOnly) {
    const t = props.i18n.t
    return <div className="dsw-ust-root">
      {props.settingsRows}
      {['nav.label', 'billing.title', 'heat.title', 'bar.title', 'donut.title', 'sessions.title', 'projects.title', 'providers.title', 'refresh.title'].map(key => (
        <div key={key}><h3>{t(key)}</h3><p>{t('nav.label')}</p></div>
      ))}
    </div>
  }
  return <StatsContent {...props} />
}

function StatsContent({ rpc, i18n: baseI18n, settingsRows }: StatsSectionProps): JSX.Element {
  const i18n = useI18n(baseI18n)
  const t = i18n.t
  const locale = i18n.locale

  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [freshness, setFreshness] = useState<Freshness>('loading')
  const [barTip, setBarTip] = useState<Tip | null>(null)
  const [donutTip, setDonutTip] = useState<Tip | null>(null)
  const [heatTip, setHeatTip] = useState<Tip | null>(null)
  const [billingOpen, setBillingOpen] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [repairFeedback, setRepairFeedback] = useState<{ id: number; text: string; success: boolean } | null>(null)
  const repairFeedbackId = React.useRef(0)
  const billing = useBillingSettings(rpc)
  const dataRef = useLatest(data)
  const [overviewRequests] = useState(createOverviewRequests)

  const repairFirst = () => {
    const targets = data?.coverage.failedSessionIds ?? []
    if (targets.length === 0 || repairing) return
    setRepairing(true)
    setRepairFeedback(null)
    // One click repairs EVERY currently-failed session sequentially, then a
    // single forced rescan refreshes the whole page.
    const chain = targets.reduce<Promise<number>>(
      (acc, id) => acc.then((count) => callRepairSession(rpc, id).then((result) => count + result.repaired)),
      Promise.resolve(0),
    )
    chain
      .then((total) => {
        return load(true).then((fresh) => {
          // A repair can be accepted while its follow-up scan fails. Report
          // both facts instead of leaving the earlier success on screen.
          const success = fresh !== undefined && fresh.coverage.failedSessionIds.length === 0
          const text = fresh === undefined
            ? t('status.repairRefreshFailed', { count: total })
            : success ? t('status.repairDone', { count: total }) : t('status.repairStill')
          setRepairFeedback({ id: ++repairFeedbackId.current, text, success })
        })
      })
      .catch((err) => {
        setRepairFeedback({ id: ++repairFeedbackId.current, text: t('status.repairFailed', { msg: String((err as Error)?.message ?? err) }), success: false })
      })
      .finally(() => setRepairing(false))
  }

  const load = useCallback(
    (force: boolean) => {
      const isCurrent = overviewRequests.begin()
      setLoading(true)
      setError(null)
      return callOverview(rpc, force, (res) => {
        if (!isCurrent()) return
        setData(res)
        setError(null)
        setFreshness(res.stale ? 'stale' : 'fresh')
        setLoading(false)
        saveCached(res)
      })
        .then((res) => isCurrent() ? res : undefined)
        .catch((err) => {
          if (!isCurrent()) return undefined
          const msg = String((err as Error)?.message ?? err)
          setError(msg)
          // Keep the last successful payload visible; never fake freshness.
          setFreshness(dataRef.current ? 'fallback' : 'error')
          return undefined
        })
        .finally(() => {
          if (isCurrent()) setLoading(false)
        })
    },
    [rpc, dataRef, overviewRequests],
  )

  useEffect(() => {
    const cached = loadCached()
    if (cached) {
      setData(cached.payload)
      setFreshness('fresh')
    }
    load(false)
    return () => overviewRequests.invalidate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  const allTime = (data && data.allTime) || { totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, sessionCount: 0, byModel: [] }
  const allTimeTotal = allTime.totals.total || 0
  const recentByModel = (data && data.byModel) || []
  const days = (data && data.days) || []

  // Header subtitle: loading → update time (+ states).
  let subText: string | null = null
  if (!data && !error) subText = t('status.loading')
  else if (data) {
    const time = formatClock(data.updatedAt || Date.now(), locale)
    if (freshness === 'stale') subText = t('status.stale', { time })
    else if (freshness === 'fallback') subText = t('status.fallback', { time })
    else subText = t('status.fresh', { time })
  } else if (error) {
    subText = t('status.error', { msg: error })
  }
  const source = data ? sourceNote(data, t) : null

  let body: JSX.Element
  if (!data && !error) {
    body = (
      <div className="dsw-ust-empty">
        <div className="dsw-ust-empty-title">{t('status.loading')}</div>
        <div>{t('status.loading.hint')}</div>
      </div>
    )
  } else if (error && !data) {
    body = <div className="dsw-ust-empty">{t('status.error', { msg: error })}</div>
  } else if (data && isUsageEmpty(data)) {
    body = (
      <div className="dsw-ust-empty">
        <div className="dsw-ust-empty-title">{t('empty.title')}</div>
        <div>{t('empty.hint')}</div>
      </div>
    )
  } else {
    const overview = data!
    const modelProviders = Object.fromEntries(overview.allTime.byModel.map((m) => [m.model, m.provider]))
    body = (
      <>
        <KpiCards overview={overview} i18n={i18n} rpc={rpc} />
        <Heatmap
          days={days}
          i18n={i18n}
          onTip={setHeatTip}
          prices={billing?.prices}
          peakValley={billing?.peakValleyEnabled !== false}
          modelProviders={modelProviders}
        />
        <BarChart days={days} byModel={recentByModel} i18n={i18n} onTip={setBarTip} />
        <SessionsCard sessions={overview.topSessions} i18n={i18n} rpc={rpc} />
        {!loading && freshness === 'fresh' && <ProjectRankCard key={overview.updatedAt} i18n={i18n} rpc={rpc} />}
        <ProvidersCard providers={overview.providers} i18n={i18n} />
        <ModelDonut byModel={allTime.byModel} total={allTimeTotal} i18n={i18n} onTip={setDonutTip} />
      </>
    )
  }

  return (
    <div className="dsw-ust-root">
      <Tooltip tip={barTip} />
      <Tooltip tip={donutTip} />
      <Tooltip tip={heatTip} />
      <div className="dsw-ust-head">
        <div className="dsw-ust-head-title">
          <svg className="dsw-ust-page-icon" width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true">
            <path d="M3 13V9.5" />
            <path d="M8 13V5.5" />
            <path d="M13 13V3" />
            <path d="M2 13.5h12" />
          </svg>
          <div>
            <h2>{t('nav.label')}</h2>
            {subText ? <div className="dsw-ust-sub">{subText}</div> : null}
            {source ? <div className="dsw-ust-source" title={source.title}>{source.text}</div> : null}
            {data && data.coverage.failedSessionIds.length > 0 && (
              <div className="dsw-ust-repair">
                <div className="dsw-ust-repair-row">
                  <span className="dsw-ust-repair-hint">{t('status.repairHint', { count: data.coverage.failedSessionIds.length })}</span>
                  <Button size="sm" className="dsw-ust-more" onClick={repairFirst} disabled={repairing} loading={repairing}>
                    {t('status.repair')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="dsw-ust-head-actions">
          {data ? <ExportMenu overview={data} i18n={i18n} rpc={rpc} /> : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBillingOpen(true)}
            title={t('billing.title')}
            icon={
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            }
          >
            {t('billing.button')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => load(true)}
            disabled={loading}
            loading={loading}
            title={t('refresh.title')}
            icon={
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <polyline points="21 3 21 9 15 9" />
              </svg>
            }
          >
            {t('refresh.button')}
          </Button>
        </div>
      </div>
      {settingsRows ? <div className="dsw-ust-settings">{settingsRows}</div> : null}
      {body}
      <BillingSettingsModal rpc={rpc} i18n={i18n} open={billingOpen} onClose={() => setBillingOpen(false)} />
      {repairFeedback !== null && (
        <Toast
          key={repairFeedback.id}
          text={repairFeedback.text}
          tone={repairFeedback.success ? 'success' : undefined}
          holdMs={repairFeedback.success ? undefined : null}
          dismissLabel={t('billing.close')}
          onDone={() => setRepairFeedback(null)}
        />
      )}
    </div>
  )
}
