// dsh-usage-panel · SQLite aggregate-stats cache (desktop-vendored, guarded).
//
// The session projection cache (framework-owned) already removes the per-session
// refold cost; what still repeats on every start is the CROSS-SESSION merge
// (list + coldSnapshot per session + finalize). This cache stores the last
// finished Overview in a tiny SQLite table keyed by a watermark (state versions
// + corpus shape), so a cold start serves the previous aggregate instantly and
// refreshes in the background — no per-boot recompute wait.
//
// Node's built-in `node:sqlite` is used (Node 22.13+/23.4+); when unavailable
// (older runtime / dynamic-import failure) the cache degrades to memory-only
// and the plugin behaves exactly as before. Writes are fail-soft: a cache
// failure never blocks a scan result.
import { join } from 'node:path'
import type { Overview } from '../shared/contract.ts'
import { OVERVIEW_VERSION } from '../shared/contract.ts'
import { PROJECTION_STATE_VERSION } from './projection-unit.ts'

export interface StatsWatermark {
  /** Corpus shape: session-record count + latest event time (coverage fields). */
  sessionsTotal: number
  to: number | null
}

export function statsCacheKey(watermark: StatsWatermark): string {
  return 'v' + OVERVIEW_VERSION + ':s' + PROJECTION_STATE_VERSION + ':n' + watermark.sessionsTotal + ':t' + (watermark.to ?? 0)
}

export interface StatsCache {
  get(key: string): Promise<Overview | null>
  put(key: string, payload: Overview): Promise<void>
  /** Session watermark ledger (persistent delta baseline). */
  ledgerGet(sessionId: string): Promise<number | null>
  ledgerPut(sessionId: string, asOfSeq: number): Promise<void>
  ledgerDelete(sessionId: string): Promise<void>
  ledgerClear(): Promise<void>
  ledgerCount(): Promise<number>
  close(): void
}

interface SqliteLike {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void
    prepare(sql: string): {
      get(...args: unknown[]): { payload?: string; savedAt?: number } | undefined
      run(...args: unknown[]): unknown
    }
  }
}

export interface StatsCache {
  get(key: string): Promise<Overview | null>
  put(key: string, payload: Overview): Promise<void>
  /** Session watermark ledger (persistent delta baseline). */
  ledgerGet(sessionId: string): Promise<number | null>
  ledgerPut(sessionId: string, asOfSeq: number): Promise<void>
  ledgerDelete(sessionId: string): Promise<void>
  ledgerClear(): Promise<void>
  ledgerCount(): Promise<number>
  close(): void
}

/**
 * Open the stats cache. `home` is the harness root; the db lands directly
 * under `<home>/dsh-usage-panel.sqlite` (the DSH home, per requirement).
 * Returns null when node:sqlite is unavailable — callers fall back to a
 * memory-only session.
 */
export async function openStatsCache(home: string, warn: (message: string) => void): Promise<StatsCache | null> {
  let sqlite: SqliteLike | null = null
  try {
    sqlite = (await import('node:sqlite')) as unknown as SqliteLike
  } catch (err) {
    warn('node:sqlite unavailable — stats cache is memory-only: ' + String((err as Error)?.message ?? err))
    return null
  }
  try {
    const db = new sqlite.DatabaseSync(join(home, 'dsh-usage-panel.sqlite'))
    db.exec(
      'PRAGMA journal_mode = WAL', // concurrent reads with the write path + crash recovery
    )
    db.exec(
      'PRAGMA busy_timeout = 5000',
    )
    db.exec(
      'PRAGMA synchronous = NORMAL', // WAL's standard durability/perf pairing
    )
    db.exec(
      'CREATE TABLE IF NOT EXISTS stats ('
      + 'key TEXT PRIMARY KEY, '
      + 'payload TEXT NOT NULL, '
      + 'savedAt INTEGER NOT NULL)',
    )
    db.exec(
      'CREATE TABLE IF NOT EXISTS ledger ('
      + 'sessionId TEXT PRIMARY KEY, '
      + 'asOfSeq INTEGER NOT NULL, '
      + 'savedAt INTEGER NOT NULL)',
    )
    const getStmt = db.prepare('SELECT payload FROM stats WHERE key = ?')
    const putStmt = db.prepare('INSERT OR REPLACE INTO stats (key, payload, savedAt) VALUES (?, ?, ?)')
    const ledgerGetStmt = db.prepare('SELECT asOfSeq FROM ledger WHERE sessionId = ?')
    const ledgerPutStmt = db.prepare('INSERT OR REPLACE INTO ledger (sessionId, asOfSeq, savedAt) VALUES (?, ?, ?)')
    const ledgerDeleteStmt = db.prepare('DELETE FROM ledger WHERE sessionId = ?')
    const ledgerClearStmt = db.prepare('DELETE FROM ledger')
    const ledgerCountStmt = db.prepare('SELECT COUNT(*) AS n FROM ledger')
    return {
      async get(key: string): Promise<Overview | null> {
        try {
          const row = getStmt.get(key)
          if (row === undefined || row.payload === undefined) return null
          const parsed: unknown = JSON.parse(row.payload)
          if (typeof parsed !== 'object' || parsed === null) return null
          return parsed as Overview
        } catch {
          return null
        }
      },
      async put(key: string, payload: Overview): Promise<void> {
        try {
          putStmt.run(key, JSON.stringify(payload), Date.now())
        } catch {
          /* fail-soft: a cache write failure never breaks a scan result */
        }
      },
      async ledgerGet(sessionId: string): Promise<number | null> {
        try {
          const row = ledgerGetStmt.get(sessionId) as { asOfSeq?: number } | undefined
          return typeof row?.asOfSeq === 'number' ? row.asOfSeq : null
        } catch {
          return null
        }
      },
      async ledgerPut(sessionId: string, asOfSeq: number): Promise<void> {
        try {
          ledgerPutStmt.run(sessionId, asOfSeq, Date.now())
        } catch {
          /* fail-soft */
        }
      },
      async ledgerDelete(sessionId: string): Promise<void> {
        try {
          ledgerDeleteStmt.run(sessionId)
        } catch {
          /* fail-soft */
        }
      },
      async ledgerClear(): Promise<void> {
        try {
          ledgerClearStmt.run()
        } catch {
          /* fail-soft */
        }
      },
      async ledgerCount(): Promise<number> {
        try {
          const row = ledgerCountStmt.get() as { n?: number } | undefined
          return typeof row?.n === 'number' ? row.n : 0
        } catch {
          return 0
        }
      },
      close(): void {
        try {
          db.exec('PRAGMA optimize')
        } catch {
          /* ignore */
        }
        try {
          (db as { close?: () => void }).close?.()
        } catch {
          /* ignore */
        }
      },
    }
  } catch (err) {
    warn('stats cache open failed — memory-only: ' + String((err as Error)?.message ?? err))
    return null
  }
}
