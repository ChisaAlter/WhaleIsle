import type { Buckets } from '../shared/contract.ts';
/** Magpie's agent tag for DeepSeek Harness (`magpie usage` shows "DeepSeek Harness"). */
export declare const MAGPIE_AGENT = "dsh";
/** Environment override; useful for tests and non-default installs. */
export declare const MAGPIE_USAGE_FILE_ENV = "MAGPIE_USAGE_FILE";
export interface MagpieRow {
    /** Row instant (epoch ms); null when `t` is missing/unparseable. */
    at: number | null;
    /**
     * Model id in the PANEL's vocabulary: the gateway's requested route (`req`,
     * e.g. `codex/gpt-6.1-sol`), which is exactly the model id DSH writes into
     * its session logs. The served id (`model`, e.g. `gpt-6.1-sol`) is NOT a
     * panel key — keying on it would break the cost/price join.
     */
    model: string;
    /** Gateway's UPSTREAM provider for the route (`codex`, `clinepass`, …). */
    provider: string;
    buckets: Buckets;
}
/** Folded ledger of one usage file. */
export interface MagpieSource {
    file: string;
    /** Folded calls (rows with agent === 'dsh'). */
    calls: number;
    totals: Buckets;
    /** Panel model id (`req`) → buckets. */
    byModel: Record<string, Buckets>;
    /**
     * Panel model id → the gateway's upstream provider (last row wins). This is
     * only a FALLBACK for provider attribution: the caller prefers the
     * log-derived model→provider map (usually `magpie`), because that is the
     * route the panel's prices are scoped to (`magpie/<model>`). Reusing the
     * upstream id where the logs know the model would leave every cost row
     * unpriced.
     */
    upstreamProviders: Record<string, string>;
    /** UTC day key → model → buckets (same shape as the log-derived map). */
    byDay: Record<string, Record<string, Buckets>>;
    from: number | null;
    to: number | null;
}
/** `<MAGPIE_USAGE_FILE>` or `~/.config/magpie/usage.jsonl`. */
export declare function resolveMagpieUsageFile(env?: NodeJS.ProcessEnv, home?: string): string;
/**
 * Parse one JSONL row. Returns null for anything that is not a usage row of
 * this harness (bad JSON, other agents, partial trailing lines of a live
 * ledger) — the caller skips it.
 */
export declare function parseMagpieRow(line: string): MagpieRow | null;
/** Incremental folder: one ledger row at a time, no buffered line array. */
export interface MagpieFolder {
    push(line: string): void;
    result(): MagpieSource;
}
/** Start an incremental fold of one file's lines. */
export declare function createMagpieFolder(file?: string): MagpieFolder;
/** Fold raw JSONL lines (pure; unparseable / foreign-agent lines are skipped). */
export declare function foldMagpieLines(lines: Iterable<string>, file?: string): MagpieSource;
/** Drop the mtime+size cache (tests switch files in the same process). */
export declare function resetMagpieCache(): void;
/**
 * Load and fold the ledger, or return null when it cannot be used.
 * Never throws: every failure degrades to the log-derived path.
 */
export declare function loadMagpieSource(file?: string, warn?: (message: string) => void): Promise<MagpieSource | null>;
