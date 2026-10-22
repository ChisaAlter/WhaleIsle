import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { usagePanelProjectionDefinition as unit } from '../src/host/projection-unit.ts'
import { scanFallback } from '../src/host/scan.ts'
import type { HostSessionQuery } from '../src/host/types.ts'

const now = Date.UTC(2026, 8, 29, 11, 29)
const event = (type: string, seq: number, data: unknown): SessionEvent =>
  ({ type, seq, time: now, data }) as SessionEvent
const usage = { inputTokens: 13601, outputTokens: 171, cacheReadTokens: 512, cacheWriteTokens: 0 }
// The current host can append an end-seed marker after a restored, billed turn.
const events = [
  event('request/context', 0, { model: 'deepseek-v4.1-flash', provider: 'deepseek' }),
  event('assistant/message', 1, { turn: 1, step: 1, usage }),
  event('step/end', 2, { turn: 1, step: 1 }),
  event('session/end-seed', 3, {}),
]

// Call exactly as the vendored registry does, including the inherited prefix.
const initialize = unit.init as (header: unknown, inheritedEventCount: number) => ReturnType<typeof unit.init>

test('host projection counts a fresh session before a late end-seed marker', () => {
  let state = initialize({ isSeeded: false }, 0)
  for (const e of events) state = unit.apply(state, e)
  assert.deepEqual(state.totals, { input: 13601, output: 171, cacheRead: 512, cacheWrite: 0 })
})

test('host projection counts markerless usage and excludes the exact inherited prefix', () => {
  const fork = [
    ...events.slice(0, 3),
    event('assistant/message', 3, { turn: 1, step: 1, usage: { inputTokens: 7, outputTokens: 2 } }),
    event('step/end', 4, { turn: 1, step: 1 }),
    event('session/end-seed', 5, {}),
    event('assistant/message', 6, { turn: 2, step: 1, usage: { inputTokens: 3, outputTokens: 1 } }),
    event('step/end', 7, { turn: 2, step: 1 }),
  ]
  let state = initialize({ isSeeded: true }, 3)
  for (const e of fork) state = unit.apply(state, e)
  assert.deepEqual(state.totals, { input: 10, output: 3, cacheRead: 0, cacheWrite: 0 })
  assert.equal(state.byModel['deepseek-v4.1-flash']?.input, 10)
})

test('fallback scan uses the read snapshot boundary, not the last marker', async () => {
  const header = { id: 'session-test', createdAt: now, isSeeded: false }
  const sq = {
    listSessions: async () => [{ header, persisted: true }],
    readSession: async () => ({ session: header, inheritedEventCount: 0, events }),
    readTitle: async () => undefined,
  } as unknown as HostSessionQuery
  const result = await scanFallback({
    sq, providerNames: {}, logFailure: assert.fail, storeIndex: () => {}, storeFailed: () => {},
  }, now)
  // Total = uncached input + output (cache read 512 stays its own bucket).
  assert.equal(result.allTime.totals.total, 13772)
  assert.equal(result.coverage.sessionsOk, 1)
  assert.equal(result.coverage.eventsCounted, 1)
})
