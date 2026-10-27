// dsh-usage-panel · Host face (web plugin entry).
//
// Data path: inject waits for sessionProjections / sessionQuery /
// sessionProjectionCache, then register() installs a client-visible unit
// (stateSchema + wire). Demand scans read usagePanel from exact shared
// Session observations without cloning or replaying their logs again.
// A missing cell is pending. Registration failure uses the full-scan reducer.
//
// Statistics requests share one exact scan. Completed results are reused for
// ten minutes; stale or forced reads wait for their replacement. Startup and
// settings search do not trigger full-corpus work. Session logs stay read-only.
//
// User PRICES are the one thing this plugin writes, and they are written into
// the harness conversation settings section (`ui-conversation.sessionCostPrices`,
// see prices-source.ts) — the record the composer cost strip reprices from. The
// plugin's own storage domain is retired to a one-time legacy import
// (legacy-billing-import.ts).
import type { Context } from '@deepseek-ai/cordis'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import {
  DEFAULT_BILLING_SETTINGS,
  RPC_BILLING_GET,
  RPC_BILLING_MODELS,
  RPC_BILLING_SET,
  RPC_CHANNEL,
  RPC_OVERVIEW,
  RPC_PROJECTS_MORE,
  RPC_REPAIR_SESSION,
  RPC_SESSION_COST,
  RPC_SESSIONS_MORE,
  type BillingModelOption,
  type BillingModelOptions,
  type BillingSettings,
  type CoverageStats,
  type Overview,
  type PageRequest,
  type ProjectPage,
  type RepairResult,
  type RpcResult,
  type SessionCostData,
  type SessionPage,
} from '../shared/contract.ts'
import { DEEPSEEK_OFFICIAL_PRICES, isDeepSeekProvider } from '../shared/pricing.ts'
import { emptyAggregate, emptyOverview, finalizeOverview, mergeSessionValue, pageOf, projectRowsOf, rankSessions, rankSessionsBy, sessionModels, type SessionAgg } from './aggregate.ts'
import { usagePanelProjectionDefinition } from './projection-unit.ts'
import { USAGE_PANEL_KEY, type UsagePanelState } from './projection.ts'
import { scanFallback } from './scan.ts'
import { loadMagpieSource, resolveMagpieUsageFile, type MagpieSource } from './magpie-usage.ts'
import { BillingStore, openBillingMedium } from './billing-store.ts'
import { createLegacyBillingImport } from './legacy-billing-import.ts'
import { CONVERSATION_SETTINGS_NS, createPricesSource } from './prices-source.ts'
import { createPricesRepair } from './prices-repair.ts'
import { decodeStorageRecord, isRepairableSessionId, repairSessionLog, resolveDshHome } from './session-repair.ts'
import { openStatsCache, statsCacheKey, type StatsCache } from './stats-cache.ts'
import { scanPacer, withTimeout } from './pacing.ts'
import type { HostConnection, HostLlm, HostSessionQuery, HostSettings, HostSettingsEventSource, LlmProviderInfoLike } from './types.ts'

export const name = 'dsh-usage-panel'
export const inject = [
  'timer',
  'connection',
  'sessionProjections',
  'sessionQuery',
  'sessionProjectionCache',
  'settings',
]

/**
 * rc.1 makes client-connection's webServer dependency optional for headless
 * profiles. The usage panel still registers an RPC route through the caller
 * scoped connection handle, so expose the active webServer on that scope when
 * the loader provided it through service lookup.
 */
function channelContext(ctx: Context): Context {
  const webServer = typeof ctx?.get === 'function' ? ctx.get('webServer') : undefined
  if (webServer === undefined || typeof ctx?.extend !== 'function') return ctx
  return ctx.extend({ webServer })
}

/** sessionQuery's typed absence (vendored rc.1): a deleted session, not a damaged artifact. */
function isSessionGone(err: unknown): boolean {
  return (err as { code?: string } | null | undefined)?.code === 'SESSION_QUERY_SESSION_NOT_FOUND'
}

const STALE_MS = 10 * 60 * 1000 // cache freshness window

export function apply(ctx: Context): void {
  const tag = '[dsh-usage-panel]'
  const scopedCtx = channelContext(ctx)
  // Structural casts to the vendored rc.1 faces (types.ts): the npm rc.6
  // type packages still describe the retired id-only coldSnapshot contract.
  const sq = ctx.get('sessionQuery') as unknown as HostSessionQuery
  const registry = ctx.get('sessionProjections') as SessionProjectionRegistry
  const connection = scopedCtx.get('connection') as HostConnection | undefined
  const llm = ctx.get('llm') as HostLlm | undefined

  let mode: CoverageStats['mode'] = 'projection'

  console.log(
    tag,
    'boot: mode=' + mode,
    'services: sessionQuery=' + Boolean(sq) + ' sessionProjections=' + Boolean(registry) + ' sessionProjectionCache=' + Boolean(ctx.get('sessionProjectionCache')),
  )

  // Registration is an effect on this fiber: the unit's key disappears when
  // the plugin unloads. Fail-soft: any registration problem drops to scan.
  let disposeUnit: (() => void) | null = null
  try {
    disposeUnit = (ctx as Context & { sessionProjections: SessionProjectionRegistry }).sessionProjections.register(
      // Desktop harness register() reads stateSchema + wire; npm rc.6 d.ts still wants schema + view.
      usagePanelProjectionDefinition as never,
    )
  } catch (err) {
    console.warn(tag, 'projection registration failed; falling back to full scan:', String((err as Error)?.message ?? err))
    disposeUnit = null
    mode = 'scan'
  }

  let providerNames: Record<string, string> = {}
  if (llm && typeof llm.listProviders === 'function') {
    Promise.resolve(llm.listProviders())
      .then((infos) => {
        providerNames = Object.fromEntries((infos || []).map((p) => [p.id, p.name]))
      })
      .catch((err) => console.warn(tag, 'listProviders failed:', String((err as Error)?.message ?? err)))
  }

  let cache: { at: number; payload: Overview } | null = null
  let inflight: Promise<Overview> | null = null
  let disposed = false
  // Full ranked session index (all-time, no title) rebuilt each scan — the
  // "显示更多" paging endpoints slice it on demand.
  let sessionIndex: SessionAgg[] = []
  // Failed-session ids (repair candidates) discovered by the last scan.
  let failedSessionIds: string[] = []
  // Logged once per totals source (path), not on every keep-warm rescan.
  let reportedSource = ''
  // Sessions whose `session.cost` read already failed once (log dedupe).
  const reportedCostFailures = new Set<string>()
  // SQLite aggregate cache (guarded): lets a cold start serve the previous
  // overview instantly and refresh in the background.
  let statsCache: StatsCache | null = null
  openStatsCache(resolveDshHome(), (message) => console.warn(tag, message)).then((cache) => {
    statsCache = cache
  })

  // Prices: the ONE record is the harness conversation settings section
  // `ui-conversation.sessionCostPrices` — the same one the composer cost strip
  // reprices from. The section is registered by the harness conversation plugin
  // and may appear after this one, so reads tolerate an unregistered section
  // (the snapshot re-checks until it exists) while writes reject.
  const settings = ctx.get('settings') as unknown as HostSettings
  const pricesSource = createPricesSource(settings, (message) => console.warn(tag, message))
  // The harness commits section changes through this event; its payload is
  // only `(ns, revision)`, so the committed value is re-read via describe().
  ;(ctx as unknown as HostSettingsEventSource).on('settings/document-updated', (ns) => {
    if (String(ns) === CONVERSATION_SETTINGS_NS) pricesSource.refresh()
  })

  // One-time repair of records written by the retired 峰谷计价-OFF path (a
  // `flat: true` entry with no `idle` column bills the entered price at half
  // off-peak, because the harness reads the top-level triple as the PEAK
  // column). Same gating as the legacy import: it defers while the section is
  // unregistered and the next `billing.get` retries, and it never throws here.
  const pricesRepair = createPricesRepair({
    prices: pricesSource,
    warn: (message) => console.warn(tag, message),
    log: (message) => console.log(tag, message),
  })
  // Startup attempt: usually deferred, because the section is registered by the
  // harness conversation plugin, which may apply after this one.
  void pricesRepair.attempt()

  // The plugin's own price domain is retired: it is read ONCE by the legacy
  // import (see legacy-billing-import.ts) and never written again. Its medium
  // attaches asynchronously; the import refuses to read before that (a
  // memory-phase read caches "no prices" and would complete the import early).
  const legacyStore = new BillingStore(undefined, (message) => console.warn(tag, message))
  const legacyImport = createLegacyBillingImport({
    store: legacyStore,
    prices: pricesSource,
    warn: (message) => console.warn(tag, message),
    log: (message) => console.log(tag, message),
  })
  openBillingMedium(ctx.get('storageDomain') as never, (message) => console.warn(tag, message)).then((medium) => {
    if (medium) legacyStore.attachMedium(medium)
    // Gate attempt: the section may be unregistered here, in which case the
    // import defers and the next billing.get retries it.
    return legacyImport.attempt()
  })

  function logFailure(message: string): void {
    console.warn(tag, message)
  }

  async function scanProjection(now: number, magpie: MagpieSource | null): Promise<Overview> {
    let a = emptyAggregate()
    let sessionsTotal = 0
    let sessionsOk = 0
    let sessionsFailed = 0
    let sessionsPending = 0
    const failures: string[] = []
    const titles = new Map<string, string | null>()
    let sessions: SessionRecord[] = []
    try {
      sessions = await sq.listSessions()
    } catch (err) {
      logFailure('listSessions failed: ' + String((err as Error)?.message ?? err))
      return emptyOverview(now)
    }
    // Cooperative pacing across a large corpus: cold folds (a v2-migration
    // first pass) must not stall the host event loop.
    const pacer = scanPacer((message) => console.log(tag, message))
    const failed: string[] = []
    for (let i = 0; i < sessions.length; i += 1) {
      const rec = sessions[i]
      const header = rec && rec.header
      if (!header) {
        sessionsTotal += 1
        sessionsFailed += 1
        await pacer.beat(i + 1, sessions.length)
        continue
      }
      const id = header.id
      sessionsTotal += 1
      if (!rec.persisted) {
        sessionsPending += 1
        await pacer.beat(i + 1, sessions.length)
        continue
      }
      try {
        // The shared observation validates and prepares one exact Session cut.
        // Its projections already include the checkpoint and unfurled tail.
        using observation = await sq.observeSession(id)
        const value = observation.projections?.values.usagePanel as UsagePanelState | undefined
        const title = observation.projections?.values.title
        if (typeof title === 'string' || title === null) titles.set(id, title)
        if (!value) {
          sessionsPending += 1 // no events / nothing folded yet
          await pacer.beat(i + 1, sessions.length)
          continue
        }
        a = mergeSessionValue(a, value, id, now, 0, observation.header.cwd ?? null)
        sessionsOk += 1
      } catch (err) {
        sessionsFailed += 1
        // A session deleted between list and read is neither usage nor a
        // damaged artifact: counted failed, kept off the repair list.
        if (!isSessionGone(err) && failed.length < 50) failed.push(id)
        if (failures.length < 3) failures.push(String((err as Error)?.message ?? err))
      }
      await pacer.beat(i + 1, sessions.length)
    }
    failedSessionIds = failed
    if (failures.length > 0) {
      logFailure(sessionsFailed + ' session(s) failed to read (first ' + failures.length + '): ' + failures.join(' | '))
    }
    sessionIndex = rankSessions(a.sessions, Number.MAX_SAFE_INTEGER)
    await Promise.all(
      rankSessions(a.sessions, 10).map(async (s) => {
        if (titles.has(s.id)) return
        try {
          const t = await sq.readTitle(s.id)
          titles.set(s.id, t ? t.title : null)
        } catch {
          titles.set(s.id, null)
        }
      }),
    )
    return finalizeOverview({
      aggregate: a,
      now,
      mode: 'projection',
      sessionsTotal,
      sessionsOk,
      sessionsFailed,
      sessionsPending,
      eventsCounted: 0,
      titles,
      providerNames,
      failedSessionIds: failed,
      magpie,
    })
  }

  /**
   * The optional Magpie gateway ledger: when present it supplies the token
   * totals / day buckets / model + provider splits, so the page reports the
   * same headline as `magpie usage` (in + out, cache excluded) even for
   * sessions whose logs are gone. Absent/unreadable → null and the log
   * aggregate is used unchanged.
   */
  async function gatewaySource(): Promise<MagpieSource | null> {
    return loadMagpieSource(undefined, (message) => console.warn(tag, message))
  }

  async function scan(now: number, magpie: MagpieSource | null): Promise<Overview> {
    if (disposed) return cache ? cache.payload : emptyOverview(now)
    if (mode === 'projection') return scanProjection(now, magpie)
    return scanFallback({ sq, providerNames, logFailure, storeIndex: (rows) => { sessionIndex = rows }, storeFailed: (ids) => { failedSessionIds = ids }, magpie }, now)
  }

  /** Watermark of an overview for the SQLite cache (corpus shape). */
  async function watermarkKey(): Promise<string> {
    const sessions = await sq.listSessions()
    let to: number | null = null
    for (const rec of sessions) {
      const created = rec?.header?.createdAt
      if (typeof created === 'number' && (to === null || created > to)) to = created
    }
    return statsCacheKey({ sessionsTotal: sessions.length, to })
  }

  /** Retain the last durable overview while the first demand refresh is in flight. */
  async function hydrateFromCache(): Promise<void> {
    if (cache !== null || statsCache === null) return
    let payload: Overview | null = null
    try {
      payload = await statsCache.get(await watermarkKey())
    } catch {
      payload = null
    }
    if (payload !== null && !disposed) {
      cache = { at: 0, payload }
      console.log(tag, 'stats cache hit — awaiting exact demand refresh')
    }
  }

  function startScan(): Promise<Overview> {
    if (disposed) return Promise.resolve(cache ? cache.payload : emptyOverview(Date.now()))
    if (inflight) return inflight
    const run = (async (): Promise<Overview> => {
      await hydrateFromCache()
      // Optional gateway ledger (mtime+size cached inside). Loading it must not
      // break the scan: loadMagpieSource never throws (null = log-only).
      const magpie = await gatewaySource()
      const magpieKey = magpie === null ? 'logs' : magpie.file
      if (magpieKey !== reportedSource) {
        reportedSource = magpieKey
        if (magpie === null) {
          console.log(tag, 'totals source: session logs (no Magpie usage file at ' + resolveMagpieUsageFile() + ')')
        } else {
          console.log(
            tag,
            'totals source: Magpie gateway ledger (agent=dsh)',
            'calls=' + magpie.calls,
            'range=' + (magpie.from === null ? '-' : new Date(magpie.from).toISOString()) + '..' + (magpie.to === null ? '-' : new Date(magpie.to).toISOString()),
            'file=' + magpie.file,
          )
        }
      }
      // Each projection is a whole-session value, never an additive delta.
      // Rebuild the aggregate from each observation's checkpoint and current tail.
      const payload = await scan(Date.now(), magpie)
      if (payload !== null && !disposed) {
        cache = { at: Date.now(), payload }
        // Cache write off the response path: serialize + SQLite round-trip is
        // synchronous work; defer it so the RPC caller is never delayed by it.
        if (statsCache !== null) {
          setImmediate(() => {
            if (disposed) return
            void (async () => {
              try {
                const key = await watermarkKey()
                await statsCache!.put(key, payload)
              } catch {
                /* fail-soft */
              }
            })()
          })
        }
      }
      return payload
    })()
    inflight = run
    run.catch(() => {}).then(() => {
      if (inflight === run) inflight = null
    })
    return run
  }

  async function overview(args: { force?: boolean } | undefined): Promise<Overview> {
    const force = !!(args && args.force)
    if (inflight !== null) return inflight
    if (!force && cache !== null && Date.now() - cache.at < STALE_MS) return cache.payload
    return startScan()
  }

  const ZERO_TOTALS = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  const ZERO_PHASE = {
    peak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    offPeak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }

  /**
   * Price-bearing projection data of ONE session: the live registry state
   * when the session is open (synchronous, no replay), else the exact observed
   * row. A session with neither (no persisted log / no cell yet) reports
   * `found: false` — the strip shows an empty readout, never an error.
   */
  async function sessionCost(payload: { sessionId?: string }): Promise<SessionCostData> {
    const sessionId = payload.sessionId
    if (!sessionId) throw new Error('missing sessionId')
    const sessions = ctx.get('sessions') as { get(id: string): unknown } | undefined
    let value: UsagePanelState | undefined
    try {
      const live = sessions && sessions.get(sessionId)
      if (live) {
        // Desktop harness registry exposes stateOf (live read); the npm rc.6
        // type face does not — local structural cast, same precedent as the
        // register() cast above.
        const liveRegistry = registry as SessionProjectionRegistry & {
          stateOf(session: unknown, key: string): UsagePanelState | undefined
        }
        value = liveRegistry.stateOf(live, USAGE_PANEL_KEY)
      } else {
        using observation = await sq.observeSession(sessionId)
        value = observation.projections?.values.usagePanel as UsagePanelState | undefined
      }
    } catch (err) {
      // An absent id is a poll for a deleted session, not a damaged artifact:
      // found:false without polluting the repair list.
      if (isSessionGone(err)) {
        return { found: false, currentModel: 'unknown', currentProvider: 'unknown', cost: ZERO_PHASE, models: [], totals: { ...ZERO_TOTALS } }
      }
      // Deduplicate: the strip polls every 2s and an unreadable session must
      // not flood the log — the first failure is reported, later ones are silent.
      if (!reportedCostFailures.has(sessionId)) {
        reportedCostFailures.add(sessionId)
        logFailure('session.cost read failed for ' + sessionId + ': ' + String((err as Error)?.message ?? err))
        logFailure('session.cost will not retry reporting this session until the plugin reloads; open 设置 → 用量统计 and click the 「修复」 button in the page header (backed up to .bak-<ts> before rewriting)')
      }
      // Union into the repair list: the strip may discover a corruption the
      // last scan snapshot predates; the next overview refresh then counts it.
      if (!failedSessionIds.includes(sessionId)) {
        failedSessionIds = [...failedSessionIds, sessionId]
        cache = null
      }
    }
    if (!value) {
      return { found: false, currentModel: 'unknown', currentProvider: 'unknown', cost: ZERO_PHASE, models: [], totals: { ...ZERO_TOTALS } }
    }
    return {
      found: true,
      currentModel: value.currentModel,
      currentProvider: value.currentProvider,
      cost: value.costTotals,
      models: sessionModels(value),
      totals: {
        ...value.totals,
        // Same total rule as every other payload: uncached input + output.
        total: value.totals.input + value.totals.output,
      },
    }
  }

  const PAGE_SIZE = 10

  /**
   * Current billing settings in the wire shape. The record itself is the
   * conversation section's `sessionCostPrices`; peak/valley pricing is a
   * harness-side constant now (the section has no switch for it), so it always
   * reads ON and the client's switch renders as fixed.
   */
  function billingSettings(): BillingSettings {
    return { prices: pricesSource.snapshot(), peakValleyEnabled: true }
  }

  const sortOf = (payload: Partial<PageRequest> | undefined): 'tokens' | 'cost' => payload?.sort ?? 'tokens'

  /** Next page of the ranked session list (titles fetched on demand). */
  async function sessionsMore(payload: Partial<PageRequest> | undefined): Promise<SessionPage> {
    await overview(undefined)
    const offset = Math.max(0, payload?.offset ?? 0)
    const sort = sortOf(payload)
    const ranked = rankSessionsBy(sessionIndex, sort, pricesSource.snapshot(), true)
    const { rows, hasMore } = pageOf(ranked, offset, PAGE_SIZE)
    const titles = new Map<string, string | null>()
    await Promise.all(
      rows.map(async (s) => {
        try {
          const t = await sq.readTitle(s.id)
          titles.set(s.id, t ? t.title : null)
        } catch {
          titles.set(s.id, null)
        }
      }),
    )
    return {
      sessions: rows.map((s) => ({
        id: s.id,
        title: titles.get(s.id) ?? null,
        totals: s.totals,
        lastActive: s.lastActive,
        depth: s.depth,
        models: s.models,
      })),
      hasMore,
    }
  }

  /** Next page of the project (= working directory) ranking. */
  async function projectsMore(payload: Partial<PageRequest> | undefined): Promise<ProjectPage> {
    await overview(undefined)
    const offset = Math.max(0, payload?.offset ?? 0)
    const all = projectRowsOf(sessionIndex, sortOf(payload), pricesSource.snapshot(), true)
    const { rows, hasMore } = pageOf(all, offset, PAGE_SIZE)
    return { rows, hasMore }
  }

  /**
   * Repair ONE damaged session artifact (the exact id the scan reported):
   * decode all rows via the vendored storage-row codec, renumber seqs
   * 0-based, rewrite plain and atomically replace, keeping a timestamped
   * backup. Never automatic; the user triggers it from the stats page.
   */
  async function repairSession(payload: { sessionId?: string }): Promise<RepairResult> {
    const sessionId = payload.sessionId
    if (!isRepairableSessionId(sessionId, failedSessionIds)) {
      throw new Error('invalid session id')
    }
    const outcome = await repairSessionLog(resolveDshHome(), sessionId, decodeStorageRecord)
    // Drop the overview so the next scan reads the repaired artifact.
    failedSessionIds = failedSessionIds.filter((id) => id !== sessionId)
    cache = null
    return outcome
  }

  /**
   * Priceable model option list for the settings modal: every registered
   * provider (llm directory) plus providers seen in saved sessions, each with
   * its adapter-advertised models, the official DeepSeek columns for
   * deepseek-routed providers, and usage-seen model ids. Adapter failures
   * degrade per provider (the provider still lists), never deny the modal.
   */
  async function billingModels(): Promise<BillingModelOptions> {
    const options = new Map<string, BillingModelOption>()
    const ensure = (provider: string, providerName: string): BillingModelOption => {
      let option = options.get(provider)
      if (option === undefined) {
        option = { provider, providerName, models: [] }
        options.set(provider, option)
      }
      return option
    }
    let providers: LlmProviderInfoLike[] = []
    if (llm) {
      try {
        providers = await withTimeout(Promise.resolve(llm.listProviders()), 2000, 'provider directory')
      } catch (err) {
        logFailure('billing.models listProviders failed/slow: ' + String((err as Error)?.message ?? err))
      }
    }
    for (const p of providers) {
      const option = ensure(p.id, p.name || p.id)
      if (isDeepSeekProvider(p.id)) {
        for (const entry of DEEPSEEK_OFFICIAL_PRICES) {
          if (!option.models.includes(entry.model)) option.models.push(entry.model)
        }
      }
    }
    if (llm && typeof llm.listModels === 'function') {
      await Promise.all(
        providers.map(async (p) => {
          try {
            const infos = await withTimeout(Promise.resolve(llm.listModels!(p.id)), 2000, 'adapter models for ' + p.id)
            const option = ensure(p.id, p.name || p.id)
            for (const info of infos) {
              if (info && info.id && !option.models.includes(info.id)) option.models.push(info.id)
            }
          } catch {
            /* the adapter cannot advertise its models (slow/dead); keep the provider row */
          }
        }),
      )
    }
    if (cache) {
      for (const session of cache.payload.topSessions) {
        for (const row of session.models) {
          const provider = row.provider === 'unknown' ? '(unknown)' : row.provider
          const option = ensure(provider, provider)
          if (!option.models.includes(row.model)) option.models.push(row.model)
        }
      }
    }
    return { options: [...options.values()] }
  }

  // RPC channel for the browser half: /usage-stats/overview + billing + session.cost.
  const disposeRpc =
    connection &&
    connection.rpc.handle(
      RPC_CHANNEL,
      (endpoint, payload): Promise<RpcResult<unknown>> => {
        if (endpoint === RPC_OVERVIEW) {
          return overview(payload as { force?: boolean } | undefined).then(
            (value) => ({ ok: true, value }),
            (err) => ({
              ok: false,
              error: {
                code: 'internal',
                message: String((err as Error)?.message ?? err),
                details: {},
              },
            }),
          )
        }
        if (endpoint === RPC_BILLING_GET) {
          // The one-time legacy import rides this call: it is the read the price
          // UI makes, and a deferred precondition must be retried on a later one
          // (the section registers and the domain attaches asynchronously). The
          // flat-record section repair needs the same retry, for the same reason.
          return legacyImport
            .attempt()
            .then(() => pricesRepair.attempt())
            .then(
              () => ({ ok: true, value: billingSettings() }),
              (err) => ({
                ok: false,
                error: {
                  code: 'internal',
                  message: String((err as Error)?.message ?? err),
                  details: {},
                },
              }),
            )
        }
        if (endpoint === RPC_BILLING_SET) {
          // Write-through to the conversation settings section (the plugin's own
          // domain is retired); peak/valley stays a constant in the response.
          const next: BillingSettings = { ...DEFAULT_BILLING_SETTINGS, ...((payload ?? {}) as BillingSettings) }
          return pricesSource.save(next.prices).then(
            () => ({ ok: true, value: billingSettings() }),
            (err) => ({
              ok: false,
              error: {
                code: 'bad-request',
                message: String((err as Error)?.message ?? err),
                details: {},
              },
            }),
          )
        }
        if (endpoint === RPC_BILLING_MODELS) {
          return billingModels().then(
            (value) => ({ ok: true, value }),
            (err) => ({
              ok: false,
              error: {
                code: 'internal',
                message: String((err as Error)?.message ?? err),
                details: {},
              },
            }),
          )
        }
        if (endpoint === RPC_SESSION_COST) {
          return sessionCost((payload ?? {}) as { sessionId?: string }).then(
            (value) => ({ ok: true, value }),
            (err) => ({
              ok: false,
              error: {
                code: 'internal',
                message: String((err as Error)?.message ?? err),
                details: {},
              },
            }),
          )
        }
        if (endpoint === RPC_SESSIONS_MORE) {
          return sessionsMore((payload ?? {}) as PageRequest).then(
            (value) => ({ ok: true, value }),
            (err) => ({
              ok: false,
              error: {
                code: 'internal',
                message: String((err as Error)?.message ?? err),
                details: {},
              },
            }),
          )
        }
        if (endpoint === RPC_PROJECTS_MORE) {
          return projectsMore((payload ?? {}) as PageRequest).then(
            (value) => ({ ok: true, value }),
            (err) => ({
              ok: false,
              error: {
                code: 'internal',
                message: String((err as Error)?.message ?? err),
                details: {},
              },
            }),
          )
        }
        if (endpoint === RPC_REPAIR_SESSION) {
          return repairSession((payload ?? {}) as { sessionId?: string }).then(
            (value) => ({ ok: true, value }),
            (err) => ({
              ok: false,
              error: {
                code: 'internal',
                message: String((err as Error)?.message ?? err),
                details: {},
              },
            }),
          )
        }
        return Promise.resolve({
          ok: false,
          error: { code: 'bad-request', message: 'unknown endpoint: ' + String(endpoint), details: { issues: [] } },
        })
      },
      { authority: 'loopback' },
    )

  ctx.effect(() => () => {
    disposed = true
    if (disposeUnit) disposeUnit()
    if (disposeRpc) disposeRpc()
  })
}
