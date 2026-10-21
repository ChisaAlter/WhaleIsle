export declare const RPC_CHANNEL = "/usage-stats";
export declare const RPC_OVERVIEW = "overview";
export declare const RPC_SESSION_COST = "session.cost";
export declare const RPC_BILLING_GET = "billing.get";
export declare const RPC_BILLING_SET = "billing.set";
export declare const RPC_BILLING_MODELS = "billing.models";
export declare const RPC_SESSIONS_MORE = "sessions.more";
export declare const RPC_PROJECTS_MORE = "projects.more";
export declare const RPC_REPAIR_SESSION = "repair.session";
/** Result of `repair.session`: the renumbered event count and the backup path. */
export interface RepairResult {
    repaired: number;
    backup: string;
    bytesBefore: number;
    bytesAfter: number;
}
/** Request/result shapes of the paging endpoints (`sessions.more`, `projects.more`). */
export type PageSort = 'tokens' | 'cost';
export interface PageRequest {
    offset: number;
    /** Rank by: total tokens (default) or estimated cost (host-side, current prices). */
    sort?: PageSort;
}
export interface SessionPage {
    sessions: SessionSummary[];
    hasMore: boolean;
}
/** One project (= session working directory) row, prices applied client-side. */
export interface ProjectRow {
    /** Absolute working directory; null when the session had none. */
    project: string | null;
    /** Basename for display (title carries the full path). */
    name: string;
    totals: UsageTotals;
    models: SessionModelCost[];
}
export interface ProjectPage {
    rows: ProjectRow[];
    hasMore: boolean;
}
/** One provider's priceable model rows (synced from the host llm directory). */
export interface BillingModelOption {
    provider: string;
    providerName: string;
    models: string[];
}
/** Full model-option list served by `billing.models`. */
export interface BillingModelOptions {
    options: BillingModelOption[];
}
/**
 * Durable plugin billing preferences (one JSON record, plugin-owned):
 * user-edited prices plus the global peak/valley pricing switch. Records
 * written by v0.3 also carry `stripVisible`/`peakHintVisible` for the
 * retired composer cost strip; the store tolerates and drops them.
 */
export interface BillingSettings {
    prices: import('./pricing.ts').SessionCostPrices;
    /** Global peak/valley pricing ON; off bills both periods at the peak column. */
    peakValleyEnabled: boolean;
}
export declare const DEFAULT_BILLING_SETTINGS: BillingSettings;
/** Payload of `session.cost`: the current/live session id to price. */
export interface SessionCostRequest {
    sessionId: string;
}
/** One session's price-bearing projection data (prices applied client-side). */
export interface SessionCostData {
    /** False when the session has no projection value yet (empty live session). */
    found: boolean;
    currentModel: string;
    currentProvider: string;
    /** Period-classified four buckets of the whole session. */
    cost: PhaseBuckets;
    /** Per-model cost rows (provider attached). */
    models: SessionModelCost[];
    totals: UsageTotals;
}
/** Machine-readable error codes — the host never returns human prose. */
export type ErrorCode = 'internal' | 'bad-request' | 'scan-failed' | 'service-unavailable';
export interface RpcError {
    code: ErrorCode;
    message: string;
    details: Record<string, unknown>;
}
export type RpcResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: RpcError;
};
/**
 * Four disjoint token buckets, per DSH's TokenUsage contract:
 * `input` is UNCACHED input only; billed input = input + cacheRead + cacheWrite.
 */
export interface Buckets {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
}
/**
 * Period-classified buckets: peak and off-peak (billing windows, Beijing
 * wall time — see README). The shape is the wire form of the projection's
 * cost buckets; the pure cost math in `./cost.ts` imports this type so the
 * domain and the wire never disagree.
 */
export interface PhaseBuckets {
    peak: Buckets;
    offPeak: Buckets;
}
/**
 * Derived totals. `total` is **uncached input + output only** — the headline
 * token count the Magpie gateway reports (`in + out`). Cache read and cache
 * write are separate stats: they stay in their own buckets, are shown on their
 * own (KPI detail / hit-rate card) and are NEVER folded into a total.
 */
export interface UsageTotals extends Buckets {
    total: number;
}
/** One model's aggregate (v0.1.0 wire shape preserved; cost/provider added in v4). */
export interface ModelItem {
    model: string;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
    /** Provider route the model was last attributed to (first-wins across sessions). */
    provider: string;
    /** All-time/window period-classified buckets of the model (prices client-side). */
    cost: PhaseBuckets;
}
/** Per-day per-model buckets, keyed by UTC day key. */
export type DayModels = Record<string, UsageTotals>;
/** One heatmap day (v0.1.0 wire shape preserved; cost added in v4). */
export interface DayRecord {
    date: string;
    total: number;
    models: DayModels;
    /** The day's period-classified buckets summed across models (prices client-side). */
    cost: PhaseBuckets;
    /** Per-model period-classified buckets of the day (per-model pricing for exports). */
    modelCosts: Record<string, PhaseBuckets>;
}
export type AggregationMode = 'projection' | 'scan' | 'none';
/** Which ledger the token totals came from. */
export type UsageSource = 'logs' | 'magpie';
/**
 * Provenance of the totals when the local Magpie gateway ledger supplied them
 * (see `host/magpie-usage.ts`). Rows with `agent === 'dsh'` are the ones the
 * gateway's own `magpie usage` reports as "DeepSeek Harness".
 */
export interface MagpieCoverage {
    /** Absolute path of the folded usage file. */
    file: string;
    /** Folded gateway calls (rows with agent === 'dsh'). */
    calls: number;
    /** Earliest/latest folded call instant (epoch ms), null for an empty file. */
    from: number | null;
    to: number | null;
}
/**
 * Honest coverage diagnostics: the overview never claims to be a complete
 * bill when part of the corpus could not be scanned. `sessionsPending` =
 * sessions with no persisted log yet (live, mid-turn). `from`/`to` bound the
 * earliest/latest counted event time; `mode` says which data path produced
 * the payload.
 */
export interface CoverageStats {
    mode: AggregationMode;
    timezone: 'UTC';
    sessionsTotal: number;
    sessionsOk: number;
    sessionsFailed: number;
    sessionsPending: number;
    eventsCounted: number;
    retries: number;
    compactionTokens: number;
    from: number | null;
    to: number | null;
    /** Sessions with counted usage, split by delegation depth: 0 = main/root
     *  session, >=1 = subagent session (each subagent session counts as one). */
    usageSessionsMain: number;
    usageSessionsSubagent: number;
    /** Ids of sessions whose log read failed (repairable in place on desktop). */
    failedSessionIds: string[];
    /** Provenance of the token totals: session logs, or the Magpie gateway
     *  ledger when it is present. Absent on v4 cached payloads = 'logs'. */
    source?: UsageSource;
    /** Present when `source === 'magpie'`. */
    magpie?: MagpieCoverage;
}
/** One session in the drill-down ranking (top-N by all-time total). */
export interface SessionSummary {
    id: string;
    title: string | null;
    totals: UsageTotals;
    lastActive: number;
    /** Delegation depth from the session header: 0 = main, >=1 = subagent. */
    depth: number;
    /** Per-model cost buckets of the session (prices are applied client-side). */
    models: SessionModelCost[];
}
/** One model row inside a session: its provider and period-classified buckets. */
export interface SessionModelCost {
    model: string;
    provider: string;
    cost: PhaseBuckets;
}
/** One provider route seen in the logs (name resolved via llm.listProviders). */
export interface ProviderItem {
    id: string;
    name: string;
    totals: UsageTotals;
}
/** Full overview payload served by RPC /usage-stats → overview. */
export interface Overview {
    /** 182 UTC days ending today; per-day per-model totals (heatmap window). */
    days: DayRecord[];
    /** Recent-30d totals (v0.1.0 semantic). */
    totals: UsageTotals;
    /** Distinct sessions with usage in the recent-30d window (v0.1.0 semantic). */
    sessionCount: number;
    /** Recent-30d per-model ranking, sorted by total desc (v0.1.0 semantic). */
    byModel: ModelItem[];
    allTime: {
        totals: UsageTotals;
        sessionCount: number;
        byModel: ModelItem[];
        /** All-time period-classified buckets (prices applied client-side). */
        costTotals: PhaseBuckets;
    };
    coverage: CoverageStats;
    /** Top-N sessions by all-time total, with folded titles. */
    topSessions: SessionSummary[];
    /** Provider routes seen in the logs (plus configured routes), by total desc. */
    providers: ProviderItem[];
    updatedAt: number;
    /** Set when the payload came from a stale cache while a rescan runs. */
    stale?: boolean;
}
export declare const OVERVIEW_VERSION = 5;
