// dsh-usage-panel · OPTIONAL Magpie gateway usage ledger (host half).
//
// Why this exists: the panel's own accounting can only see session logs that
// are still on disk. Magpie (the local LLM gateway in front of every agent)
// keeps its own append-only usage ledger, which covers requests whose session
// logs were rotated away or pruned. Users compare 设置 → 用量统计 with
// `magpie usage`, so when that file exists we fold its rows (agent === 'dsh',
// displayed by the CLI as "DeepSeek Harness") for the top-level token numbers.
//
// Contract:
//  - `in` is UNCACHED input in both ledgers, so the headline total is `in + out`
//    on both sides. `cache_read` / `cache_write` stay separate buckets and are
//    never added into a total (see shared/usage.ts totalsFrom).
//  - The model key is the row's requested route (`req`), NOT the served model
//    (`model`): DSH logs `codex/gpt-6.1-sol`, and the panel's cost/price maps
//    are keyed the same way. Provider attribution is completed by the caller
//    from the log-derived model→provider map (usually `magpie`); this module
//    only records the gateway's upstream provider as a fallback.
//  - Day keys are UTC, like every other day bucket in this plugin. Magpie's own
//    CLI buckets by LOCAL day, so a per-day figure can differ by the timezone
//    offset while the all-time figures match exactly.
//  - Sessions / projects / per-session ranking / cost buckets stay log-derived
//    (a gateway row carries no session identity and no billing phase).
//  - Absent / unreadable / empty file → null, and the caller falls back to the
//    deduped session-log numbers without any special-casing.
//  - The fold is cached by file mtime + size: the ledger is append-only and
//    grows on every request, so a rescan re-reads it only when it changed.
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { Buckets } from '../shared/contract.ts'
import { dayKeyUTC, emptyBuckets } from '../shared/usage.ts'

/** Magpie's agent tag for DeepSeek Harness (`magpie usage` shows "DeepSeek Harness"). */
export const MAGPIE_AGENT = 'dsh'

/** Environment override; useful for tests and non-default installs. */
export const MAGPIE_USAGE_FILE_ENV = 'MAGPIE_USAGE_FILE'

export interface MagpieRow {
  /** Row instant (epoch ms); null when `t` is missing/unparseable. */
  at: number | null
  /**
   * Model id in the PANEL's vocabulary: the gateway's requested route (`req`,
   * e.g. `codex/gpt-6.1-sol`), which is exactly the model id DSH writes into
   * its session logs. The served id (`model`, e.g. `gpt-6.1-sol`) is NOT a
   * panel key — keying on it would break the cost/price join.
   */
  model: string
  /** Gateway's UPSTREAM provider for the route (`codex`, `clinepass`, …). */
  provider: string
  buckets: Buckets
}

/** Folded ledger of one usage file. */
export interface MagpieSource {
  file: string
  /** Folded calls (rows with agent === 'dsh'). */
  calls: number
  totals: Buckets
  /** Panel model id (`req`) → buckets. */
  byModel: Record<string, Buckets>
  /**
   * Panel model id → the gateway's upstream provider (last row wins). This is
   * only a FALLBACK for provider attribution: the caller prefers the
   * log-derived model→provider map (usually `magpie`), because that is the
   * route the panel's prices are scoped to (`magpie/<model>`). Reusing the
   * upstream id where the logs know the model would leave every cost row
   * unpriced.
   */
  upstreamProviders: Record<string, string>
  /** UTC day key → model → buckets (same shape as the log-derived map). */
  byDay: Record<string, Record<string, Buckets>>
  from: number | null
  to: number | null
}

/** `<MAGPIE_USAGE_FILE>` or `~/.config/magpie/usage.jsonl`. */
export function resolveMagpieUsageFile(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const explicit = env[MAGPIE_USAGE_FILE_ENV]
  if (typeof explicit === 'string' && explicit.trim() !== '') return explicit.trim()
  return join(home, '.config', 'magpie', 'usage.jsonl')
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value !== '' ? value : fallback
}

/**
 * Parse one JSONL row. Returns null for anything that is not a usage row of
 * this harness (bad JSON, other agents, partial trailing lines of a live
 * ledger) — the caller skips it.
 */
export function parseMagpieRow(line: string): MagpieRow | null {
  if (line.trim() === '') return null
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return null
  }
  if (raw === null || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  if (row.agent !== MAGPIE_AGENT) return null
  const at = typeof row.t === 'string' ? Date.parse(row.t) : Number.NaN
  return {
    at: Number.isFinite(at) ? at : null,
    // `req` is the composite route the harness also logs as its model id
    // (`codex/gpt-6.1-sol`, `clinepass/cline-pass/deepseek-v4.1-flash-1017`).
    // `model` (the served id) is a different vocabulary and must not become a
    // panel key; it is only the fallback for rows without `req`.
    model: text(row.req, text(row.model, 'unknown')),
    provider: text(row.provider, 'unknown'),
    buckets: {
      input: count(row.in),
      output: count(row.out),
      cacheRead: count(row.cache_read),
      cacheWrite: count(row.cache_write),
    },
  }
}

function addInto(target: Record<string, Buckets>, key: string, b: Buckets): void {
  const cur = target[key]
  if (cur === undefined) {
    target[key] = { ...b }
    return
  }
  cur.input += b.input
  cur.output += b.output
  cur.cacheRead += b.cacheRead
  cur.cacheWrite += b.cacheWrite
}

/** Incremental folder: one ledger row at a time, no buffered line array. */
export interface MagpieFolder {
  push(line: string): void
  result(): MagpieSource
}

/** Start an incremental fold of one file's lines. */
export function createMagpieFolder(file = ''): MagpieFolder {
  const source: MagpieSource = {
    file,
    calls: 0,
    totals: emptyBuckets(),
    byModel: {},
    upstreamProviders: {},
    byDay: {},
    from: null,
    to: null,
  }
  return {
    push(line: string): void {
      const row = parseMagpieRow(line)
      if (row === null) return
      source.calls += 1
      const b = row.buckets
      source.totals.input += b.input
      source.totals.output += b.output
      source.totals.cacheRead += b.cacheRead
      source.totals.cacheWrite += b.cacheWrite
      addInto(source.byModel, row.model, b)
      source.upstreamProviders[row.model] = row.provider
      if (row.at === null) return
      if (source.from === null || row.at < source.from) source.from = row.at
      if (source.to === null || row.at > source.to) source.to = row.at
      const day = dayKeyUTC(row.at)
      const dayMap = source.byDay[day] ?? (source.byDay[day] = {})
      addInto(dayMap, row.model, b)
    },
    result(): MagpieSource {
      return source
    },
  }
}

/** Fold raw JSONL lines (pure; unparseable / foreign-agent lines are skipped). */
export function foldMagpieLines(lines: Iterable<string>, file = ''): MagpieSource {
  const folder = createMagpieFolder(file)
  for (const line of lines) folder.push(line)
  return folder.result()
}

interface CachedFold {
  mtimeMs: number
  size: number
  value: MagpieSource
}

let cachedFold: CachedFold | null = null

/** Drop the mtime+size cache (tests switch files in the same process). */
export function resetMagpieCache(): void {
  cachedFold = null
}

/**
 * Load and fold the ledger, or return null when it cannot be used.
 * Never throws: every failure degrades to the log-derived path.
 */
export async function loadMagpieSource(
  file: string = resolveMagpieUsageFile(),
  warn?: (message: string) => void,
): Promise<MagpieSource | null> {
  let mtimeMs = 0
  let size = 0
  try {
    const info = await stat(file)
    if (!info.isFile()) return null
    mtimeMs = info.mtimeMs
    size = info.size
  } catch {
    // ENOENT / EACCES / anything: no usable ledger, fall back silently.
    return null
  }
  if (cachedFold !== null && cachedFold.mtimeMs === mtimeMs && cachedFold.size === size) {
    return cachedFold.value
  }
  try {
    // Streamed line by line: the ledger is append-only and can be tens of MB,
    // and a row must never be buffered as one big string.
    const folder = createMagpieFolder(file)
    const reader = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity })
    for await (const line of reader) folder.push(line)
    const source = folder.result()
    if (source.calls === 0) {
      warn?.('magpie usage file has no agent=dsh rows; using session logs: ' + file)
      return null
    }
    cachedFold = { mtimeMs, size, value: source }
    return source
  } catch (err) {
    warn?.('magpie usage file unreadable; using session logs: ' + String((err as Error)?.message ?? err))
    return null
  }
}
