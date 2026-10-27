// dsh-usage-panel · RPC wrapper + localStorage SWR cache.
//
// The browser keeps the last successful overview in localStorage (versioned,
// structure-validated) so a page refresh renders instantly; a background
// refresh then updates it. A failed refresh keeps the cached payload and the
// UI shows the fallback state with the last success timestamp (never fakes
// freshness). Version bumps invalidate old caches instead of a hand-maintained
// field whitelist. EVERY wrapper carries its own timeout: a host busy with a
// scan must surface as an error + retry, never an endless spinner.

/**
 * Bound a client RPC with a timeout; the losing side is guarded so its late
 * settlement never goes unhandled.
 */
function withTimeout<T>(source: Promise<T>, ms: number, label: string): Promise<T> {
  source.catch(() => {
    /* guarded: the caller only observes the race result */
  })
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label + ' timed out')), ms)
    source.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

const TIMEOUTS = {
  overview: 60_000,
  billing: 8_000,
  page: 8_000,
  sessionCost: 8_000,
  repair: 30_000,
  models: 8_000,
} as const
import type { RpcResultLike } from './ctx.ts'
import type { Overview } from '../shared/contract.ts'
import {
  OVERVIEW_VERSION,
  RPC_CHANNEL,
  RPC_BILLING_GET,
  RPC_BILLING_MODELS,
  RPC_BILLING_SET,
  RPC_PROJECTS_MORE,
  RPC_REPAIR_SESSION,
  RPC_SESSION_COST,
  RPC_SESSIONS_MORE,
  type BillingModelOptions,
  type BillingSettings,
  type ProjectPage,
  type RepairResult,
  type RpcResult,
  type SessionCostData,
  type SessionPage,
} from '../shared/contract.ts'

const CACHE_KEY = 'dsh-usage-panel:overview:v' + OVERVIEW_VERSION

export interface CachedOverview {
  version: number
  savedAt: number
  payload: Overview
}

export function loadCached(): CachedOverview | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isUsable(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

export function saveCached(payload: Overview): void {
  // Deferred: JSON.stringify of a multi-MB payload is synchronous work and
  // must never join the render path of a fresh update.
  setTimeout(() => {
    try {
      const record: CachedOverview = { version: OVERVIEW_VERSION, savedAt: Date.now(), payload }
      localStorage.setItem(CACHE_KEY, JSON.stringify(record))
    } catch {
      // Storage full/blocked: the panel still works, just without persistence.
    }
  }, 0)
}

export function clearCached(): void {
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    /* ignore */
  }
}

/** Structural validation: version match + every field the UI reads present. */
export function isUsable(value: unknown): value is CachedOverview {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (v.version !== OVERVIEW_VERSION) return false
  const payload = v.payload as Record<string, unknown> | undefined
  if (!payload || typeof payload !== 'object') return false
  if (typeof payload.updatedAt !== 'number') return false
  const totals = payload.totals as Record<string, unknown> | undefined
  if (!totals || typeof totals.input !== 'number' || typeof totals.total !== 'number') return false
  if (!Array.isArray(payload.days) || !Array.isArray(payload.byModel)) return false
  const allTime = payload.allTime as Record<string, unknown> | undefined
  if (!allTime || typeof allTime.sessionCount !== 'number') return false
  const coverage = payload.coverage as Record<string, unknown> | undefined
  if (!coverage || typeof coverage.sessionsTotal !== 'number') return false
  if (typeof coverage.usageSessionsMain !== 'number' || typeof coverage.usageSessionsSubagent !== 'number') return false
  if (!Array.isArray(payload.topSessions) || !Array.isArray(payload.providers)) return false
  return true
}

/**
 * Call overview once; reject after 60s while retaining its eventual success.
 * `onSuccess` receives the same request's successful result even after timeout;
 * its owner must ignore results after disposal or a newer request.
 */
export async function callOverview(
  rpc: { call(channel: string, endpoint: string, payload?: unknown): Promise<RpcResultLike<unknown>> },
  force: boolean,
  onSuccess?: (value: Overview) => void,
): Promise<Overview> {
  const source = rpc.call('/usage-stats', 'overview', { force: !!force }).then((result) => {
    const res = result as RpcResult<Overview>
    if (res && res.ok) {
      onSuccess?.(res.value)
      return res.value
    }
    const code = res && res.error ? res.error.code : 'internal'
    const message = res && res.error ? res.error.message : 'unknown error'
    const err = new Error(message) as Error & { code?: string }
    err.code = code
    throw err
  })
  return withTimeout(source, TIMEOUTS.overview, 'overview')
}

/** Call billing.get (durable preferences); rejects with the machine-readable code. */
export async function callBillingGet(
  rpc: { call(channel: string, endpoint: string, payload?: unknown): Promise<RpcResultLike<unknown>> },
): Promise<BillingSettings> {
  // The transport's JSON.stringify drops an absent payload key and the host
  // envelope schema requires it — always send an object (real trap, see AGENTS).
  const res = (await withTimeout(
    rpc.call(RPC_CHANNEL, RPC_BILLING_GET, {}),
    TIMEOUTS.billing,
    'billing settings',
  )) as RpcResult<BillingSettings>
  if (res && res.ok) return res.value
  const err = new Error(res && res.error ? res.error.message : 'unknown error') as Error & { code?: string }
  if (res && res.error) err.code = res.error.code
  throw err
}

/** Call billing.set (replace-whole); rejects with the machine-readable code. */
export async function callBillingSet(
  rpc: { call(channel: string, endpoint: string, payload?: unknown): Promise<RpcResultLike<unknown>> },
  settings: BillingSettings,
): Promise<BillingSettings> {
  const res = (await withTimeout(
    rpc.call(RPC_CHANNEL, RPC_BILLING_SET, settings),
    TIMEOUTS.billing,
    'billing settings',
  )) as RpcResult<BillingSettings>
  if (res && res.ok) return res.value
  const err = new Error(res && res.error ? res.error.message : 'unknown error') as Error & { code?: string }
  if (res && res.error) err.code = res.error.code
  throw err
}

/** Call billing.models (priceable model list for the settings modal). */
export async function callBillingModels(
  rpc: { call(channel: string, endpoint: string, payload?: unknown): Promise<RpcResultLike<unknown>> },
): Promise<BillingModelOptions> {
  const res = (await withTimeout(
    rpc.call(RPC_CHANNEL, RPC_BILLING_MODELS, {}),
    TIMEOUTS.models,
    'model directory',
  )) as RpcResult<BillingModelOptions>
  if (res && res.ok) return res.value
  const err = new Error(res && res.error ? res.error.message : 'unknown error') as Error & { code?: string }
  if (res && res.error) err.code = res.error.code
  throw err
}

/** Call session.cost for one session id; rejects with the machine-readable code. */
export async function callSessionCost(
  rpc: { call(channel: string, endpoint: string, payload?: unknown): Promise<RpcResultLike<unknown>> },
  sessionId: string,
): Promise<SessionCostData> {
  const res = (await withTimeout(
    rpc.call(RPC_CHANNEL, RPC_SESSION_COST, { sessionId }),
    TIMEOUTS.sessionCost,
    'session cost',
  )) as RpcResult<SessionCostData>
  if (res && res.ok) return res.value
  const err = new Error(res && res.error ? res.error.message : 'unknown error') as Error & { code?: string }
  if (res && res.error) err.code = res.error.code
  throw err
}

/** Call sessions.more (paged session ranking). */
export async function callSessionPage(
  rpc: { call(channel: string, endpoint: string, payload?: unknown): Promise<RpcResultLike<unknown>> },
  offset: number,
  sort: 'tokens' | 'cost',
): Promise<SessionPage> {
  const res = (await withTimeout(
    rpc.call(RPC_CHANNEL, RPC_SESSIONS_MORE, { offset, sort }),
    TIMEOUTS.page,
    'session page',
  )) as RpcResult<SessionPage>
  if (res && res.ok) return res.value
  const err = new Error(res && res.error ? res.error.message : 'unknown error') as Error & { code?: string }
  if (res && res.error) err.code = res.error.code
  throw err
}

/** Call projects.more (paged project ranking). */
export async function callProjectPage(
  rpc: { call(channel: string, endpoint: string, payload?: unknown): Promise<RpcResultLike<unknown>> },
  offset: number,
  sort: 'tokens' | 'cost',
): Promise<ProjectPage> {
  const res = (await withTimeout(
    rpc.call(RPC_CHANNEL, RPC_PROJECTS_MORE, { offset, sort }),
    TIMEOUTS.page,
    'project page',
  )) as RpcResult<ProjectPage>
  if (res && res.ok) return res.value
  const err = new Error(res && res.error ? res.error.message : 'unknown error') as Error & { code?: string }
  if (res && res.error) err.code = res.error.code
  throw err
}

/** Call repair.session (one damaged artifact, desktop-vendored feature). */
export async function callRepairSession(
  rpc: { call(channel: string, endpoint: string, payload?: unknown): Promise<RpcResultLike<unknown>> },
  sessionId: string,
): Promise<RepairResult> {
  const res = (await withTimeout(
    rpc.call(RPC_CHANNEL, RPC_REPAIR_SESSION, { sessionId }),
    TIMEOUTS.repair,
    'session repair',
  )) as RpcResult<RepairResult>
  if (res && res.ok) return res.value
  const err = new Error(res && res.error ? res.error.message : 'unknown error') as Error & { code?: string }
  if (res && res.error) err.code = res.error.code
  throw err
}
