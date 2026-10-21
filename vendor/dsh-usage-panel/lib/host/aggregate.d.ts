import type { Buckets, CoverageStats, DayRecord, Overview, PhaseBuckets, ProjectRow, SessionModelCost, UsageTotals } from '../shared/contract.ts';
import type { SessionCostPrices } from '../shared/pricing.ts';
import { type UsagePanelState } from './projection.ts';
import type { MagpieSource } from './magpie-usage.ts';
export interface SessionAgg {
    id: string;
    /** Session working directory (the desktop "project" grouping key). */
    cwd: string | null;
    totals: UsageTotals;
    lastActive: number;
    depth: number;
    /** Per-model cost buckets of the session (model → provider via last-wins). */
    models: SessionModelCost[];
}
export interface Aggregate {
    allTimeTotals: UsageTotals;
    allTimeByModel: Record<string, Buckets>;
    allTimeByProvider: Record<string, Buckets>;
    allTimeCost: PhaseBuckets;
    allTimeCostByModel: Record<string, PhaseBuckets>;
    /** Global last-seen provider per model (first-wins across merged sessions). */
    allTimeModelProviders: Record<string, string>;
    byDay: Record<string, Record<string, Buckets>>;
    byDayCost: Record<string, Record<string, PhaseBuckets>>;
    recentTotals: UsageTotals;
    recentByModel: Record<string, Buckets>;
    recentCostByModel: Record<string, PhaseBuckets>;
    recentSessionCount: number;
    allTimeSessionCount: number;
    retries: number;
    compactionTokens: number;
    from: number | null;
    to: number | null;
    usageSessionsMain: number;
    usageSessionsSubagent: number;
    sessions: SessionAgg[];
}
export declare function emptyAggregate(): Aggregate;
/** Merge one session's projection value into the aggregate (pure). */
export declare function mergeSessionValue(a: Aggregate, value: UsagePanelState, sessionId: string, now: number, depth?: number, cwd?: string | null): Aggregate;
/** One session's per-model cost rows (provider via the last-wins mapping). */
export declare function sessionModels(value: UsagePanelState): SessionModelCost[];
export declare function rankSessions(sessions: SessionAgg[], limit: number): SessionAgg[];
/** Rank sessions by the chosen metric; `cost` uses the user's current prices
 *  (null rows trail), `tokens` is the all-time total. */
export declare function rankSessionsBy(sessions: SessionAgg[], sort: 'tokens' | 'cost', prices: SessionCostPrices, peakValley: boolean): SessionAgg[];
/** Basename of an absolute path for display (Windows and POSIX separators). */
export declare function pathBasename(dir: string | null): string;
/**
 * Group sessions by working directory (the desktop "project") into rows with
 * their estimated cost attached, sorted by `sort` (tokens default).
 */
export declare function projectRowsOf(sessions: readonly SessionAgg[], sort?: 'tokens' | 'cost', prices?: SessionCostPrices, peakValley?: boolean): ProjectRow[];
/** One size-T page slice with the hasMore flag (shared by sessions/projects). */
export declare function pageOf<T>(rows: readonly T[], offset: number, limit: number): {
    rows: T[];
    hasMore: boolean;
};
export interface FinalizeInput {
    aggregate: Aggregate;
    now: number;
    mode: CoverageStats['mode'];
    sessionsTotal: number;
    sessionsOk: number;
    sessionsFailed: number;
    sessionsPending: number;
    eventsCounted: number;
    titles: Map<string, string | null>;
    providerNames: Record<string, string>;
    /** Ids of sessions whose log read failed (repair candidates, capped). */
    failedSessionIds?: string[];
    /**
     * Folded Magpie gateway ledger, when the local file exists. It then supplies
     * the token totals / days / model + provider splits (the gateway sees every
     * request, including logs that are already rotated away). Sessions,
     * projects, per-session ranking and the cost buckets stay log-derived.
     */
    magpie?: MagpieSource | null;
}
/** Build the wire Overview from an aggregate (both scan modes converge here). */
export declare function finalizeOverview(input: FinalizeInput): Overview;
export declare function emptyOverview(now: number): Overview;
export declare const HEAT_DAYS_UTC = 182;
export type { DayRecord };
