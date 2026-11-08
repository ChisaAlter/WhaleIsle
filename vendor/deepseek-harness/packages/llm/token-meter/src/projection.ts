/**
 * Pure client-safe token-projection vocabulary.
 *
 * @module @deepseek-ai/dsh-token-meter/projection
 */

import type { SessionProjectionSummaryExcluded } from '@deepseek-ai/dsh-session-projection/types'

/**
 * Durable cumulative provider usage for a complete session log.
 *
 * The four buckets are disjoint. In particular, reasoning tokens are already
 * included in `outputTokens` and are not accumulated again.
 */
export interface TokenUsageProjection {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/**
 * Approximate context occupancy for a status display.
 *
 * The fields, when present, are deliberately NOT one atomic request
 * observation: each is a last-wins record of a different moment. Switching
 * models can therefore pair a fresh capacity with the previous route's
 * pressure until the next request reports usage. This is an intentional trade
 * — the value is a user-facing reference, not a billing or gating input. See
 * the token-meter README for the full rationale.
 */
export interface ContextPressureProjection {
  /**
   * Provider-reported prompt size of the most recent request: uncached input
   * plus cache reads and writes. Response output is excluded, so this does not
   * grow as the current turn streams. Absent until a provider reports usage.
   */
  pressureTokens?: number
  /**
   * What the NEXT request's prompt would cost: {@link pressureTokens} plus the
   * heuristic repricing of everything the surface gained or lost since that
   * sample. Only the delta is estimated, so the figure stays anchored to the
   * provider while still reacting the moment a compaction shadows a span —
   * which `pressureTokens` alone cannot do, since compaction reports no usage
   * of its own. Absent until a provider reports usage.
   */
  projectedTokens?: number
  /** Newest recorded route capacity; absent when no adapter advertised one. */
  contextWindow?: number
}

/**
 * Heuristic composition of the next request's context: what the prompt is
 * made of, not what it costs. All three figures use the meter's fixed
 * density estimate, so they will not sum to the provider-anchored
 * `projectedTokens`: the estimator systematically underprices CJK text and
 * JSON schemas, which is exactly the error the anchoring in
 * {@link ContextPressureProjection.projectedTokens} keeps out of the occupancy
 * figure. Present these as approximations of composition, never as a total.
 */
export interface ContextBreakdownProjection {
  /** Heuristic tokens of the last nonempty surviving system prompt in surface order; 0 when none exists. */
  systemTokens: number
  /** Heuristic tokens of the newest request envelope's tool schemas; 0 before any request. */
  toolsTokens: number
  /** Heuristic tokens of every other visible surface node, including superseded system prompts. */
  messageTokens: number
}

/**
 * Price-independent usage buckets for one billing phase. `missInputTokens`
 * carries uncached prompt input plus cache writes; `cacheReadTokens` the
 * cache-hit prompt input; `outputTokens` the response output.
 */
export interface BilledUsageBuckets {
  /** Uncached prompt input including cache writes, billed at the miss rate. */
  missInputTokens: number
  /** Cache-hit prompt input, billed at the cache-hit rate. */
  cacheReadTokens: number
  /** Response output. */
  outputTokens: number
}

/**
 * One model route's billable usage over the whole log. Two providers may
 * serve the same model id at different real-world prices, so the route — not
 * the bare model id — is the attribution unit, matching the price record's
 * own `provider/model` key.
 */
export interface ModelBilledUsage {
  /** Provider route id the samples were dispatched through; empty when the log names none. */
  provider: string
  /** Provider-owned model id; empty when the log names none. */
  model: string
  /** This route's samples billed inside Beijing weekday peak windows. */
  peak: BilledUsageBuckets
  /** This route's samples billed outside every peak window. */
  offPeak: BilledUsageBuckets
}

/**
 * Whole-log billable usage split by the official peak/valley schedule, both
 * in total and per model route. The buckets are price-independent: applying a
 * price table is the read side's job, so user-edited prices never require a
 * refold. Absent usage reports leave the totals at zero.
 *
 * Per-route rows exist because one conversation may switch models: pricing
 * the whole log at a single route's column would bill every token of every
 * other model at the wrong rate.
 */
export interface BilledUsageProjection {
  /** Every route's samples billed inside Beijing weekday peak windows. */
  peak: BilledUsageBuckets
  /** Every route's samples billed outside every peak window, at the official idle column. */
  offPeak: BilledUsageBuckets
  /** One row per route that reported usage, in first-seen order. */
  models: ModelBilledUsage[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Provider-reported usage accumulated across the complete durable log. */
    tokenUsage: TokenUsageProjection
    /** Newest request pressure paired with the newest known route capacity. */
    contextPressure: SessionProjectionSummaryExcluded<ContextPressureProjection>
    /** Heuristic system/tools/message composition of the next request. */
      contextBreakdown: SessionProjectionSummaryExcluded<ContextBreakdownProjection>
      /** Whole-log usage split by the official peak/valley billing windows, per model route. */
      billedUsage: BilledUsageProjection
  }
}
