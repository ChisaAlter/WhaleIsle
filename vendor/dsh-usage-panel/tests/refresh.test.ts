import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/host/index.ts'
import { initState, applyEvent } from '../src/host/projection.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Overview, RpcResult } from '../src/shared/contract.ts'

test('overview refresh replaces session totals, observes new usage and removes deleted sessions', async () => {
  const previousHome = process.env.DSH_HOME
  const previousMagpie = process.env.MAGPIE_USAGE_FILE
  const home = mkdtempSync(join(tmpdir(), 'usage-refresh-'))
  process.env.DSH_HOME = home
  // Pin the optional Magpie source to a file that does not exist: this suite
  // locks the log-derived totals, and must never read the developer's ledger.
  process.env.MAGPIE_USAGE_FILE = join(home, 'no-magpie-usage.jsonl')
  const cleanups: Array<() => void> = []
  let handler!: (endpoint: string, payload: unknown) => Promise<RpcResult<Overview>>
  let tokens = 10
  let deleted = false
  let listed = 0
  let observed = 0
  let released = 0
  const header = { id: 'session-test', createdAt: 1, isSeeded: false }
  const services: Record<string, unknown> = {
    settings: { describe: () => [{ ns: 'ui-conversation', value: {} }] },
    sessionProjections: { register: () => () => {} },
    sessionQuery: {
      listSessions: async () => { listed += 1; return deleted ? [] : [{ header, persisted: true }] },
      observeSession: async () => {
        observed += 1
        const events: SessionEvent[] = [
          { type: 'assistant/message', seq: 0, time: Date.now(), data: { turn: 1, step: 1, usage: { inputTokens: tokens } } },
          { type: 'step/end', seq: 1, time: Date.now(), data: { turn: 1, step: 1 } },
        ]
        return {
          header,
          projections: { asOfSeq: 1, values: { usagePanel: events.reduce(applyEvent, initState(undefined, 0)) } },
          get events() { throw new Error('projection reads must not materialize the complete log') },
          [Symbol.dispose]: () => { released += 1 },
        }
      },
      readSession: async () => { throw new Error('statistics must use the shared observation') },
      readTitle: async () => ({ title: 'test' }),
    },
    sessionProjectionCache: {
      // A cache miss is legitimate for live sessions / unavailable storage.
      cachedSnapshot: () => undefined,
      coldSnapshot: (_header: unknown, inherited: number, events: SessionEvent[]) => ({
        asOfSeq: 1,
        values: { usagePanel: events.reduce(applyEvent, initState(undefined, inherited)) },
      }),
    },
    connection: { rpc: { handle: (_channel: string, next: typeof handler) => { handler = next; return () => {} } } },
  }
  const ctx = {
    get: (name: string) => services[name],
    sessionProjections: services.sessionProjections,
    on: () => () => {},
    interval: () => () => {},
    effect: (effect: () => () => void) => cleanups.push(effect()),
  } as unknown as Context
  try {
    apply(ctx)
    // A full event-loop turn lets any boot microtasks run before the first request.
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(listed, 0)
    assert.equal(observed, 0)
    const read = async () => {
      const result = await handler('overview', { force: true })
      assert.equal(result.ok, true)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    }
    assert.equal((await read()).allTime.totals.total, 10)
    const second = await read()
    assert.equal(second.allTime.totals.total, 10)
    assert.equal(second.topSessions.length, 1)
    tokens = 17
    assert.equal((await read()).allTime.totals.total, 17)
    deleted = true
    assert.equal((await read()).allTime.totals.total, 0)
    assert.equal(observed, 3)
    assert.equal(released, observed)
  } finally {
    for (const cleanup of cleanups) cleanup()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    if (previousMagpie === undefined) delete process.env.MAGPIE_USAGE_FILE
    else process.env.MAGPIE_USAGE_FILE = previousMagpie
  }
})
