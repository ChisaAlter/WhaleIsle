import type { Buckets, DayRecord, ModelItem, Overview, PhaseBuckets, UsageTotals } from './contract.ts';
export declare const HEAT_DAYS = 182;
export declare const RECENT_DAYS = 30;
export declare function emptyBuckets(): Buckets;
export declare function emptyTotals(): UsageTotals;
/** Add a raw (possibly partial/null) TokenUsage-like value into a bucket set. */
export declare function addBuckets(target: Buckets, usage: Partial<Buckets> | null | undefined): void;
/** Merge one bucket set into another (values already normalized). */
export declare function mergeInto(target: Buckets, src: Buckets): void;
/**
 * Derived totals. `total` is **uncached input + output only** — the headline
 * the Magpie gateway reports for this agent (`in + out`, cache excluded).
 * Cache read/write stay their own buckets; adding them in would inflate the
 * total by the cache-read magnitude (10.7B vs 0.22B on a real ledger).
 */
export declare function totalsFrom(b: Buckets): UsageTotals;
/** Any token activity at all, cache included (session/usage presence test). */
export declare function hasUsage(b: Buckets): boolean;
/** Sorted model ranking, most usage first (v0.1.0 semantic; cost/provider added). */
export declare function sortedModels(map: Record<string, Buckets>, costs?: Record<string, PhaseBuckets>, providers?: Record<string, string>): ModelItem[];
export declare function totalsFromModels(models: ModelItem[]): UsageTotals;
/** UTC day key for a timestamp: YYYY-MM-DD (explicit timezone declaration). */
export declare function dayKeyUTC(ts: number): string;
/** Parse a UTC YYYY-MM-DD key into a Date at UTC midnight (never local). */
export declare function parseDayKeyUTC(key: string): Date;
/** Format a Date's UTC calendar day as a day key. */
export declare function keyOfDateUTC(d: Date): string;
export declare function todayKeyUTC(now: number): string;
/** UTC calendar month key (YYYY-MM) from a day key. */
export declare function monthKeyUTC(dayKey: string): string;
/**
 * Distinct UTC months covered by a day window, in ascending order.
 * Used by the client heatmap month picker (still bounded by HEAT_DAYS).
 */
export declare function listMonthKeys(days: ReadonlyArray<{
    date: string;
}>): string[];
/**
 * One week column of the contribution graph: seven Monday-first weekday
 * slots; `null` pads slots outside the day window (leading pad in the first
 * column, trailing pad in the last).
 */
export type GraphWeek = readonly (DayRecord | null)[];
/**
 * Group the contiguous day window into Monday-first week columns — the
 * GitHub contribution-graph layout. `days` must be the contiguous,
 * zero-filled window produced by {@link buildDayWindow}: each record lands on
 * its real weekday row, so gaps simply leave null slots.
 */
export declare function graphWeeks(days: readonly DayRecord[]): GraphWeek[];
export interface GraphMonthLabel {
    /** Week column index where the label sits. */
    week: number;
    /** YYYY-MM month key. */
    monthKey: string;
}
/**
 * GitHub-style month labels: a label sits at the first week column whose
 * leading day falls in a new month. Only the leading label can collide —
 * months in the window are otherwise ~4 columns apart — so the first label
 * is dropped when the second would crowd it (react-activity-calendar's rule:
 * a partial first month yields its space rather than overlapping text).
 */
export declare function graphMonthLabels(weeks: readonly GraphWeek[], minGap?: number): GraphMonthLabel[];
/**
 * Build the 182-day heatmap window ending today (UTC). Days with no usage get
 * zero-filled records, preserving the v0.1.0 grid shape (fixed-length array).
 * @param byDay - per-day per-model token buckets.
 * @param now - the window's end instant.
 * @param costByDay - per-day per-model period buckets, optional (zero-filled when absent).
 */
export declare function buildDayWindow(byDay: Record<string, Record<string, Buckets>>, now: number, costByDay?: Record<string, Record<string, PhaseBuckets>>): DayRecord[];
/**
 * Sum a `day → model → buckets` map over the days at or after `cutoffKey`
 * (the rolling recent window). Shared by the log-derived recent slice
 * (`recentOf`) and the Magpie-derived recent slice, so both use one rule.
 */
export declare function sumDayBuckets(byDay: Readonly<Record<string, Readonly<Record<string, Buckets>>>>, cutoffKey: string): {
    totals: Buckets;
    byModel: Record<string, Buckets>;
};
/** Cache hit rate over the four disjoint buckets: read / (uncached + read + write). */
export declare function hitRate(b: Buckets): number | null;
/**
 * Billed input (uncached + cache read + cache write) — the v0.1.0 "输入"
 * number. This is NOT the displayed total: totals are in + out only.
 */
export declare function billedInput(b: Buckets): number;
/** Empty UI only when no billed-usage sessions and the scan did not fail. */
export declare function isUsageEmpty(overview: Pick<Overview, 'allTime' | 'coverage'>): boolean;
