import type { Overview } from '../shared/contract.ts';
import { type SessionAgg } from './aggregate.ts';
import type { MagpieSource } from './magpie-usage.ts';
import type { HostSessionQuery } from './types.ts';
export interface ScanFallbackDeps {
    sq: HostSessionQuery;
    providerNames: Record<string, string>;
    logFailure: (message: string) => void;
    /** Receive the full ranked session index for the paging endpoints. */
    storeIndex: (sessions: SessionAgg[]) => void;
    /** Receive the failed-session ids (repair candidates). */
    storeFailed: (ids: string[]) => void;
    /** Optional Magpie gateway ledger (token totals/days/models source). */
    magpie?: MagpieSource | null;
}
export declare function scanFallback(deps: ScanFallbackDeps, now: number): Promise<Overview>;
