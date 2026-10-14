// dsh-usage-panel · "显示更多" modal for the session / project rankings.
// Same row template as the cards (dsw-ust-table-head + dsw-ust-srow), pages
// through the host ranking inside the dialog with its own 显示更多 button.
import { useState } from 'react'
import { Button, Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ProjectRow, SessionSummary } from '../../shared/contract.ts'
import { fmtTokens } from '../../shared/format.ts'
import { costCentsFor, sumCostCents, totalCostCents } from '../../shared/cost.ts'
import { formatCost } from '../../shared/pricing.ts'
import { callProjectPage, callSessionPage } from '../api.ts'
import { useBillingSettings } from '../hooks.ts'
import type { RpcLike } from '../ctx.ts'
import type { I18n } from '../locales.ts'
import * as React from 'react'

export interface MoreRankModalProps {
  kind: 'sessions' | 'projects'
  i18n: I18n
  rpc: RpcLike
  open: boolean
  onClose: () => void
}

const PAGE = 10

export function MoreRankModal({ kind, i18n, rpc, open, onClose }: MoreRankModalProps): JSX.Element | null {
  const t = i18n.t
  const locale = i18n.locale
  const billing = useBillingSettings(rpc)
  const [sort, setSort] = useState<'tokens' | 'cost'>('tokens')
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [appendError, setAppendError] = useState<{ id: number; text: string } | null>(null)
  const appendErrorId = React.useRef(0)
  const [hasMore, setHasMore] = useState(false)

  const resetAndFetch = (nextSort: 'tokens' | 'cost'): void => {
    setSort(nextSort)
    setLoadError(null)
    setAppendError(null)
    setSessions([])
    setProjects([])
    setHasMore(false)
    fetchPage(0, nextSort, false)
  }

  const fetchPage = (offset: number, nextSort: 'tokens' | 'cost', append: boolean): void => {
    if (append && (loading || loadingMore)) return
    setAppendError(null)
    if (append) setLoadingMore(true)
    else setLoading(true)
    const p = kind === 'sessions' ? callSessionPage(rpc, offset, nextSort) : callProjectPage(rpc, offset, nextSort)
    p.then((page) => {
      if (kind === 'sessions') {
        const result = page as { sessions: SessionSummary[]; hasMore: boolean }
        setSessions((prev) => (append ? [...prev, ...result.sessions] : result.sessions))
        setHasMore(result.hasMore)
      } else {
        const result = page as { rows: ProjectRow[]; hasMore: boolean }
        setProjects((prev) => (append ? [...prev, ...result.rows] : result.rows))
        setHasMore(result.hasMore)
      }
    })
      .catch((err) => {
        const msg = String((err as Error)?.message ?? err)
        if (append) setAppendError({ id: ++appendErrorId.current, text: t('status.error', { msg }) })
        else setLoadError(msg)
      })
      .finally(() => {
        setLoading(false)
        setLoadingMore(false)
      })
  }

  React.useEffect(() => {
    if (!open) return
    resetAndFetch(sort)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const title = kind === 'sessions' ? t('sessions.title') : t('projects.title')

  const body = loadError !== null && (kind === 'sessions' ? sessions.length === 0 : projects.length === 0) ? (
    <div className="dsw-ust-bill-loading">
      <div>{t('billing.loadError', { msg: loadError })}</div>
      <button type="button" className="dsw-ust-bill-cancel" onClick={() => resetAndFetch(sort)}>
        {t('billing.retry')}
      </button>
    </div>
  ) : (
    <div className="dsw-ust-more-modal">
      <div className="dsw-ust-card-head">
        <span className="dsw-ust-card-sub">{t('sessions.sub')}</span>
        <label className="dsw-ust-sort">
          <span>{t('sort.by')}</span>
          <select value={sort} disabled={loading || loadingMore} onChange={(e) => resetAndFetch(e.target.value as 'tokens' | 'cost')}>
            <option value="tokens">{t('sort.tokens')}</option>
            <option value="cost">{t('sort.cost')}</option>
          </select>
        </label>
      </div>
      <div className="dsw-ust-table-head">
        <span className="dsw-ust-th-rank">#</span>
        {kind === 'sessions' ? (
          <>
            <span className="dsw-ust-th-session">{t('sessions.hSession')}</span>
            <span className="dsw-ust-th-type">{t('sessions.hType')}</span>
            <span className="dsw-ust-th-date">{t('sessions.hActive')}</span>
            <span className="dsw-ust-th-cost">{t('sessions.hCost')}</span>
            <span className="dsw-ust-th-tokens">{t('sessions.hTokens')}</span>
          </>
        ) : (
          <>
            <span className="dsw-ust-th-session">{t('projects.hProject')}</span>
            <span className="dsw-ust-th-cost">{t('projects.hCost')}</span>
            <span className="dsw-ust-th-tokens">{t('projects.hTokens')}</span>
          </>
        )}
      </div>
      {loading ? (
        <div className="dsw-ust-empty">{t('projects.loading')}</div>
      ) : kind === 'sessions' ? (
        sessions.map((s, i) => {
          const d = new Date(s.lastActive)
          const date = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0')
          const cents = billing === null
            ? null
            : sumCostCents(s.models.map((m) => costCentsFor(m.cost, m.provider, m.model, billing.prices, billing.peakValleyEnabled)))
          return (
            <div key={s.id} className="dsw-ust-srow">
              <span className="dsw-ust-srank">{i + 1}</span>
              <span className="dsw-ust-sname" title={s.id}>{s.title || t('sessions.untitled')}</span>
              <span className={'dsw-ust-stag' + (s.depth > 0 ? ' sub' : '')}>{s.depth > 0 ? t('sessions.subagent') : t('sessions.main')}</span>
              <span className="dsw-ust-smeta">{date}</span>
              <span className={'dsw-ust-scost' + (cents === null ? ' is-unpriced' : '')} title={cents === null ? t('sessions.cost.none') : t('strip.estimate')}>
                {cents === null ? '—' : formatCost(cents)}
              </span>
              <span className="dsw-ust-stokens">{fmtTokens(s.totals.total, locale)}</span>
            </div>
          )
        })
      ) : (
        projects.map((row, i) => {
          const cents = billing === null ? null : totalCostCents(row.models, billing.prices, billing.peakValleyEnabled)
          return (
            <div key={i} className="dsw-ust-srow">
              <span className="dsw-ust-srank">{i + 1}</span>
              <span className="dsw-ust-sname" title={row.project ?? ''}>{row.name}</span>
              <span className={'dsw-ust-scost' + (cents === null ? ' is-unpriced' : '')} title={cents === null ? t('sessions.cost.none') : t('strip.estimate')}>
                {cents === null ? '—' : formatCost(cents)}
              </span>
              <span className="dsw-ust-stokens">{fmtTokens(row.totals.total, locale)}</span>
            </div>
          )
        })
      )}
      {hasMore && (
        <Button size="sm" className="dsw-ust-more" onClick={() => fetchPage(kind === 'sessions' ? sessions.length : projects.length, sort, true)} disabled={loadingMore} loading={loadingMore}>
          {t('sessions.more')}
        </Button>
      )}
    </div>
  )

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={title}
        closeLabel={t('billing.close')}
        className="dsw-ust-modal"
        contentClassName="dsw-ust-modal-content"
      >
        {body}
      </Modal>
      {open && appendError !== null && (
        <Toast
          key={appendError.id}
          text={appendError.text}
          holdMs={null}
          dismissLabel={t('billing.close')}
          actions={[{ label: t('billing.retry'), onClick: () => fetchPage(kind === 'sessions' ? sessions.length : projects.length, sort, true) }]}
          onDone={() => setAppendError(null)}
        />
      )}
    </>
  )
}
