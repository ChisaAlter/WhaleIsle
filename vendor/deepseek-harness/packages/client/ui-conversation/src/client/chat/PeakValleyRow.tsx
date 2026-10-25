/** Composer-dock official peak/valley status row: colored phase indicator,
 * phase name, and a per-second countdown to the next Beijing-time switch, plus
 * the opt-in session cost figure on the same line. The session-cost switch
 * gates the whole row. The figure prices every model route the session billed
 * at that route's own resolved column and reports routes it cannot price
 * instead of guessing one, so a conversation that switched models still totals
 * correctly; pressing it opens the cost card, which reports what each route
 * cost and consumed and folds the delegation tree into one row per route (see
 * SessionCostCard.tsx for the surface choice and subagent-cost.ts for the
 * descendant sources). Mounted on 'conversation.composer.dock' (after the
 * stats entry) so it sticks with the composer in the active conversation
 * scrollport. */

import { memo, useEffect, useMemo, useState } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { BilledUsageBuckets, BilledUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import type {
  GlobalStandardProps, SessionStandardProps, SnapshotSelectorHook,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { ComposerBarProps } from '../contract/slots.ts'
import type { ComposerModelFact } from '../input/model-facts.ts'
import type { SessionCostPrices } from '../../submission-settings.ts'
import {
  billedCostCents, cacheHitRate, compositePriceKey, formatCost, formatTokenCount, mergeBilledUsage,
  priceText, resolveModelPrice,
  type ModelCostRow, type ResolvedModelPrice,
} from '../price-calculator.ts'
import { formatPeakValleyCountdown, isDeepSeekProvider, peakValleyState } from './peak-valley.ts'
import { subagentCostSources, type SubagentCostSource } from './subagent-cost.ts'
import {
  SessionCostCard, useSessionCostCard,
  type SessionCostRoute, type SessionCostSubagents,
} from './SessionCostCard.tsx'
import css from './PeakValleyRow.module.css'

/** Registration-side preference + fact face for the composer-dock entry. */
export interface PeakValleyRowInjected {
  hooks: {
    /** Persisted force-enable preference bound as usePeakValley. */
    peakValley: SnapshotStore<boolean>
    /** The session's current model-route fact bound as useModelProvider. */
    modelProvider: SnapshotStore<ComposerModelFact>
    /** Persisted session-cost preference bound as useSessionCost. */
    sessionCost: SnapshotStore<boolean>
    /** Persisted per-model custom prices bound as useCostPrices. */
    costPrices: SnapshotStore<SessionCostPrices>
  }
}

/**
 * Full component props: the bound hooks, the projection seat, and the owning
 * dock's locale seat. The session-cost seats are optional so a mount without
 * the inject face (tests, hand assembly) keeps both halves off (session cost
 * gates the row); the production registration always binds them.
 */
export interface PeakValleyRowProps {
  /** Persisted official-peak-valley preference (true force-paints the phase half while session cost is on). */
  usePeakValley: SnapshotSelectorHook<boolean>
  /** The session's current model-route fact (null provider = unknown route). */
  useModelProvider: SnapshotSelectorHook<ComposerModelFact>
  /** Optional chat window; seeds the pre-usage stand-in route. */
  useChat?: SnapshotSelectorHook<{
    legacy: { nodes: readonly { kind: string; provenance?: { provider: string; model: string } }[] }
  }>
  /** Persisted session-cost preference (off hides the whole row). */
  useSessionCost?: SnapshotSelectorHook<boolean>
  /** Persisted per-model custom prices backing the cost math. */
  useCostPrices?: SnapshotSelectorHook<SessionCostPrices>
  /** The session projection read seat ('billedUsage'). */
  useProjection?: UseProjection
  /**
   * The current Session identity ('session' scope standard seat). Absent —
   * tests and hand assembly — leaves delegated subagents out of the figure.
   */
  sessionId?: SessionStandardProps['sessionId']
  /**
   * The sessions list standard seat, read for the current Session's delegated
   * descendants. Absent keeps the figure on the current Session alone; the
   * seat carries no subagent-plugin dependency (see subagent-cost.ts).
   */
  useSessions?: GlobalStandardProps['useSessions']
  /** The owning dock's locale seat. */
  t: ComposerBarProps['t']
}

/** Absent-inject-face price record: every model bills at its official/default column. */
const NO_CUSTOM_PRICES: SessionCostPrices = {}

/** Absent-seat descendant list; one stable empty value, so the row keeps its render identity. */
const NO_SUBAGENTS: readonly SubagentCostSource[] = []

/**
 * The session's last-used model selection: the newest settled assistant node's
 * durable provenance, walked back over the loaded window. Pure derivation
 * over the framework snapshot — no second subscription. The provider rides
 * along because two providers may serve the same model id with different
 * user-priced columns.
 */
function lastUsedModel(nodes: readonly { kind: string; provenance?: { provider: string; model: string } }[] | undefined): { provider: string; model: string } | null {
  if (nodes === undefined) return null
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i]
    if (node !== undefined && node.kind === 'assistant' && node.provenance !== undefined) {
      return { provider: node.provenance.provider, model: node.provenance.model }
    }
  }
  return null
}

/**
 * Descendant sources compare equal while no child's identity, name, or usage
 * value moved. The derivation runs on every list notification, so the
 * comparator keeps unrelated list churn (another Session's status or title)
 * from repainting the strip.
 */
function equalSubagentSources(
  left: readonly SubagentCostSource[],
  right: readonly SubagentCostSource[],
): boolean {
  return left.length === right.length && left.every((source, index) => {
    const other = right.at(index)
    return other !== undefined && source.sessionId === other.sessionId
      && source.label === other.label && source.usage === other.usage
  })
}

export const PeakValleyRow = memo(function PeakValleyRow({
  usePeakValley, useModelProvider, useChat, useSessionCost, useCostPrices, useProjection,
  sessionId, useSessions, t,
}: PeakValleyRowProps) {
  const forceEnabled = usePeakValley(value => value)
  const fact = useModelProvider(value => value)
  const settledNodes = useChat?.(s => s.legacy.nodes)
  const costEnabled = useSessionCost?.(value => value) ?? false
  const customPrices = useCostPrices?.(value => value) ?? NO_CUSTOM_PRICES
  // Trigger matrix. Session cost is the row gate: off hides the phase
  // countdown and the figure together. While cost is on, the phase half
  // paints when the Interface Settings switch is on OR a DeepSeek API route
  // is detected. The cost half also needs a live billed-usage projection
  // (absent key = the host unit is not composed, and a made-up ¥0.00 would
  // lie); it paints on every route and even with an unnamed model — a priced
  // or official model shows the figure, and anything else shows the
  // set-price reminder, so the row never fabricates a figure but always
  // names the missing price.
  const deepseek = isDeepSeekProvider(fact.provider)
  const phaseVisible = costEnabled && (forceEnabled || deepseek)
  const usage = useProjection?.('billedUsage')
  // Delegated subagents bill in their own Session, so their samples never
  // reach this Session's projection. The sessions list already carries every
  // listed Session's current projection values, so the descendants' usage
  // arrives through that same store notification (subagent-cost.ts).
  const subagents = useSessions?.(state => subagentCostSources(sessionId, state), equalSubagentSources)
    ?? NO_SUBAGENTS
  const sessionSelection = lastUsedModel(settledNodes)
  const sessionModel = sessionSelection?.model ?? null
  // The last-used message's route prices the session; before the first
  // message the composer's current route fact stands in for it.
  const sessionProvider = sessionSelection?.provider ?? fact.provider ?? null
  const costVisible = costEnabled && usage !== undefined
  // One per-second evaluation of the schedule while the row paints. The timer
  // re-anchors to each wall-clock second, so the countdown increments in
  // lockstep and the phase flip at a boundary lands on the next tick after
  // the boundary with no drift accumulating.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!phaseVisible && !costVisible) return
    setNow(new Date())
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = (): void => {
      timer = setTimeout(() => {
        setNow(new Date())
        schedule()
      }, 1_000 - (Date.now() % 1_000) + 5)
    }
    schedule()
    return () => { clearTimeout(timer) }
  }, [phaseVisible, costVisible])
  // The cost figure rides the durable per-route projection (read above): the
  // host refolds incrementally per usage sample, so a new message repaints
  // the figure within the projection push latency (well under one second)
  // without the client ever re-reading the log. Each route's own buckets bill
  // at its own resolved column, so a conversation that switched models sums
  // the true figure instead of re-rating every token at the newest model.
  //
  // Every source is folded into ONE route table before pricing. Delegated
  // subagents bill in their own Session, so their samples never reach this
  // Session's projection; folding them per (provider, model) keeps the card's
  // rule that a model bills one row no matter how many children ran it, makes
  // the header total exactly the sum of the rows, and keeps the strip's own
  // figure unchanged (the same tokens at the same columns).
  const breakdown = useMemo(() => {
    const sources: BilledUsageProjection[] = []
    if (usage !== undefined) sources.push(usage)
    for (const source of subagents) {
      // A descendant that has not reported usage yet adds nothing; its absence
      // must not read as a priced zero.
      if (source.usage !== undefined) sources.push(source.usage)
    }
    return billedCostCents(mergeBilledUsage(sources), customPrices)
  }, [usage, subagents, customPrices])
  // Before the session has billed anything the projection names no route, so
  // the composer's current route stands in as the one about to be billed:
  // that keeps the set-price reminder visible ahead of the first message.
  const upcoming = useMemo(
    () => resolveModelPrice(sessionProvider, sessionModel, customPrices),
    [sessionProvider, sessionModel, customPrices],
  )
  const billed = breakdown.rows.length > 0
  const priced = billed
    ? breakdown.priced.length > 0
    : upcoming.source !== 'default'
  const partial = billed && breakdown.unpriced.length > 0
  const cost = breakdown.cents
  // Card content: one block per billed route — the route's identity, its own
  // cost or the no-price notice, its peak and off-peak consumption, and its
  // resolved columns (official columns list peak and idle; a user-priced model
  // lists its peak line, plus idle when it prices both periods). Before the
  // first billed sample the single block describes the upcoming route.
  const routes = useMemo<readonly SessionCostRoute[]>(() => billed
    ? breakdown.rows.map(row => routeBlock(row, t))
    : [{
      key: 'upcoming',
      name: routeName(sessionProvider ?? '', sessionModel ?? '', t),
      lines: priceLines(upcoming, t).split('\n'),
    }], [billed, breakdown, sessionProvider, sessionModel, upcoming, t])
  // The delegation tree folds into ONE row: the child count, the children's own
  // priced subtotal, and the tokens they moved in total (one 命中 figure, so one
  // combined rate), expanding to one line per child. A descendant with no
  // usage — or an empty one — has nothing to itemize and stays out, the same
  // rule that keeps it out of the total rather than reporting a guessed zero.
  const subagentRows = useMemo<SessionCostSubagents | null>(() => {
    const rows: { key: string; label: string; detail: string }[] = []
    const totals: BilledUsageBuckets = { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 }
    let subtotal = 0
    let pricedChildren = 0
    let unpricedChildren = 0
    for (const source of subagents) {
      if (source.usage === undefined) continue
      const own = billedCostCents(source.usage, customPrices)
      if (own.rows.length === 0) continue
      const billedChild = own.priced.length > 0
      if (billedChild) {
        subtotal += own.cents
        pricedChildren += 1
      } else {
        unpricedChildren += 1
      }
      const tokens = childTokens(own.rows)
      totals.missInputTokens += tokens.missInputTokens
      totals.cacheReadTokens += tokens.cacheReadTokens
      totals.outputTokens += tokens.outputTokens
      rows.push({
        key: String(source.sessionId),
        label: source.label,
        detail: `${billedChild ? t('sessionCost.costLine', { cost: formatCost(own.cents) }) : t('sessionCost.priceTitle.none')} · ${usageLine(tokens, 'sessionCost.subagent.tokens', t)}`,
      })
    }
    if (rows.length === 0) return null
    // The subtotal names what it can price; when it prices nothing it says so
    // instead of printing a ¥0.00 that would read as "the children were free".
    // A partial subtotal carries the strip's own marker.
    const subtotalText = pricedChildren === 0
      ? t('sessionCost.priceTitle.none')
      : `${t('sessionCost.costLine', { cost: formatCost(subtotal) })}${unpricedChildren > 0 ? t('sessionCost.partialNote') : ''}`
    return {
      // The identifying prefix stays: this row's text is the only thing naming
      // the group, and a line starting at the cost would not say what it costs.
      summary: [
        t('sessionCost.subagent.summary', { count: rows.length }),
        subtotalText,
        usageLine(totals, 'sessionCost.subagent.tokens', t),
      ].join(' · '),
      rows,
    }
  }, [subagents, customPrices, t])
  // The one price editor lives on the usage-stats settings page, not in this
  // row: the card names that path whenever a billed route has no price, which
  // is what the strip's reminder used to say through its hover title.
  const hint = !priced || partial ? t('sessionCost.noPriceHint') : null
  const card = useSessionCostCard()
  if (!phaseVisible && !costVisible) {
    return costEnabled
      ? <div className={`${css.root} ${css.placeholder}`} data-composer-cost-placeholder aria-hidden />
      : null
  }
  const state = peakValleyState(now)
  const peak = state.phase === 'peak'
  const phaseLabel = t(peak ? 'peakValley.peak' : 'peakValley.offPeak')
  const countdownLabel = t('peakValley.countdown', { time: formatPeakValleyCountdown(state.msRemaining) })
  return (
    <div className={css.root} data-phase={state.phase} data-phase-color={forceEnabled || undefined}>
      {phaseVisible && (
        <Tooltip label={`${phaseLabel} ${countdownLabel}`} side="top" delayMs={300}>
          <span className={css.phaseGroup} title={t(peak ? 'peakValley.hint.peak' : 'peakValley.hint.offPeak')}>
            <span className={css.dot} aria-hidden />
            <span className={css.phase}>{phaseLabel}</span>
            <span className={css.countdown}>{countdownLabel}</span>
          </span>
        </Tooltip>
      )}
      {phaseVisible && costVisible && <span className={css.sep} aria-hidden>·</span>}
      {costVisible && (
        // The figure is the card's trigger: a real button, so Enter and Space
        // activate it natively and `aria-expanded` tracks the card. It carries
        // no native title — the card IS the detail surface, so the two
        // mechanisms cannot both fire.
        <button
          type="button"
          ref={card.triggerRef}
          className={css.cost}
          aria-haspopup="dialog"
          aria-expanded={card.open}
          onClick={card.toggle}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            // The browser would also synthesize its own click for these keys;
            // canceling the default keeps keyboard activation to one toggle.
            event.preventDefault()
            card.toggle()
          }}
        >
          {priced
            ? t(partial ? 'sessionCost.labelPartial' : 'sessionCost.label', { cost: formatCost(cost) })
            : t('sessionCost.noPrice')}
        </button>
      )}
      {costVisible && card.mounted && (
        <SessionCostCard
          panelRef={card.panelRef}
          placement={card.placement}
          maxHeight={card.maxHeight}
          state={card.state}
          open={card.open}
          title={t('sessionCost.title')}
          // A total nothing could price says so instead of claiming ¥0.00; a
          // partial total carries the strip's own marker.
          total={priced
            ? `${formatCost(cost)}${partial ? t('sessionCost.partialNote') : ''}`
            : t('sessionCost.priceTitle.none')}
          routes={routes}
          subagents={subagentRows}
          hint={hint}
          t={t}
        />
      )}
    </div>
  )
})

/** The locale seat the cost card renders through. */
type CostTitleT = ComposerBarProps['t']

/** The consumption-line keys: one per billing period, plus a child's combined line. */
type UsageLineKey = 'sessionCost.usage.peak' | 'sessionCost.usage.idle' | 'sessionCost.subagent.tokens'

/**
 * The identity line of one route in the cost card. Wire data stays
 * verbatim — the provider id and model id are never localized — and a log
 * that names neither falls back to the unknown-route label.
 * @param provider - provider route id, empty when the log names none.
 * @param model - provider-owned model id, empty when the log names none.
 * @param t - the owning dock's locale seat.
 * @returns the route's display name.
 */
function routeName(provider: string, model: string, t: CostTitleT): string {
  if (provider === '') return model === '' ? t('sessionCost.routeUnknown') : model
  return model === '' ? provider : `${provider}/${model}`
}

/**
 * One billed route's card block: the route's identity, its own cost or the
 * no-price notice, its peak and off-peak consumption, and its resolved price
 * columns when it has any. An unpriced route still prints its tokens — that
 * this model ran and carries no price is what the reader needs to see.
 * @param row - the route's cost row, carrying its own buckets.
 * @param t - the owning dock's locale seat.
 * @returns the block's identity and lines, rendered by the card.
 */
function routeBlock(row: ModelCostRow, t: CostTitleT): SessionCostRoute {
  const lines: string[] = []
  lines.push(row.price === null
    ? t('sessionCost.priceTitle.none')
    : t('sessionCost.costLine', { cost: formatCost(row.cents) }))
  lines.push(usageLine(row.peak, 'sessionCost.usage.peak', t))
  lines.push(usageLine(row.offPeak, 'sessionCost.usage.idle', t))
  // One row per price line: the block is a row list, so a route's peak and
  // idle columns are two rows, not one row holding a line break.
  if (row.price !== null) lines.push(...priceLines(row.price, t).split('\n'))
  return {
    key: compositePriceKey(row.provider, row.model),
    name: routeName(row.provider, row.model, t),
    lines,
  }
}

/**
 * One child's tokens across both billing periods, summed into the peak shape
 * the shared consumption line reads: the disclosure names what the child moved
 * in total rather than splitting its lines by period, so twelve children stay
 * twelve rows.
 * @param rows - the child's own billed routes.
 * @returns the child's total tokens per bucket.
 */
function childTokens(rows: readonly ModelCostRow[]): BilledUsageBuckets {
  const total: BilledUsageBuckets = { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 }
  for (const row of rows) {
    total.missInputTokens += row.peak.missInputTokens + row.offPeak.missInputTokens
    total.cacheReadTokens += row.peak.cacheReadTokens + row.offPeak.cacheReadTokens
    total.outputTokens += row.peak.outputTokens + row.offPeak.outputTokens
  }
  return total
}

/**
 * One consumption line: the tokens a route or a child actually moved, as
 * compact locale-owned counts, with that same line's own cache-hit rate in
 * parentheses right after its `命中` figure. A period line rates that period's
 * buckets alone; a child's line rates the child's combined totals.
 * @param buckets - the buckets for the period, or a child's combined totals.
 * @param key - the peak, off-peak, or combined child line key.
 * @param t - the owning dock's locale seat.
 * @returns the localized line.
 */
function usageLine(buckets: BilledUsageBuckets, key: UsageLineKey, t: CostTitleT): string {
  return t(key, {
    hit: formatTokenCount(buckets.cacheReadTokens, t),
    rate: cacheHitRate([buckets], t),
    miss: formatTokenCount(buckets.missInputTokens, t),
    output: formatTokenCount(buckets.outputTokens, t),
  })
}

/**
 * The price lines of one resolved route: official columns list peak and idle;
 * a user-priced model lists its peak line, plus idle when it prices both
 * periods; a single-priced model lists one plain line; an unpriced route
 * shows the no-price notice.
 * @param price - the route's resolved columns, or null when it has no price.
 * @param t - the owning dock's locale seat.
 * @returns the card block's price lines, one or two.
 */
function priceLines(price: ResolvedModelPrice | null, t: CostTitleT): string {
  if (price === null || price.source === 'default') return t('sessionCost.priceTitle.none')
  const listIdle = price.source === 'official' || price.idleExplicit
  const peakLabel = listIdle ? 'sessionCost.priceTitle.peak' : 'sessionCost.priceTitle.plain'
  const peak = t(peakLabel, {
    hit: priceText(price.peak.inputCacheHit),
    miss: priceText(price.peak.inputCacheMiss),
    output: priceText(price.peak.output),
  })
  if (!listIdle) return peak
  const idle = t('sessionCost.priceTitle.idle', {
    hit: priceText(price.idle.inputCacheHit),
    miss: priceText(price.idle.inputCacheMiss),
    output: priceText(price.idle.output),
  })
  return `${peak}\n${idle}`
}
