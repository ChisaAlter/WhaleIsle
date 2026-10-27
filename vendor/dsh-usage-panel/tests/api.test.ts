// Regression: every RPC call wrapper must pass an explicit payload object —
// the transport's JSON.stringify drops an absent payload key and the host
// envelope schema rejects the request ('invalid client-request message').
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callBillingGet, callBillingModels, callOverview, callSessionCost } from '../src/client/api.ts'
import type { RpcResultLike } from '../src/client/ctx.ts'
import type { Overview } from '../src/shared/contract.ts'
import { createOverviewRequests } from '../src/client/overview-requests.ts'

function capturingRpc(): {
  rpc: { call(channel: string, endpoint: string, payload?: unknown): Promise<RpcResultLike<unknown>> }
  calls: Array<{ channel: string; endpoint: string; payload: unknown }>
} {
  const calls: Array<{ channel: string; endpoint: string; payload: unknown }> = []
  return {
    calls,
    rpc: {
      call(channel: string, endpoint: string, payload?: unknown): Promise<RpcResultLike<unknown>> {
        calls.push({ channel, endpoint, payload })
        return Promise.resolve({ ok: true, value: {} })
      },
    },
  }
}

test('callOverview always sends its force payload', async () => {
  const { rpc, calls } = capturingRpc()
  await callOverview(rpc, false)
  assert.deepEqual(calls[0]?.payload, { force: false })
})

test('callBillingGet always sends an explicit payload object', async () => {
  const { rpc, calls } = capturingRpc()
  await callBillingGet(rpc)
  assert.deepEqual(calls[0]?.payload, {})
})

test('callBillingModels always sends an explicit payload object', async () => {
  const { rpc, calls } = capturingRpc()
  await callBillingModels(rpc)
  assert.deepEqual(calls[0]?.payload, {})
})

test('callSessionCost sends the session id payload', async () => {
  const { rpc, calls } = capturingRpc()
  await callSessionCost(rpc, 's1')
  assert.deepEqual(calls[0]?.payload, { sessionId: 's1' })
})

function deferredRpc(): {
  rpc: { call(channel: string, endpoint: string, payload?: unknown): Promise<RpcResultLike<unknown>> }
  calls: Array<{ channel: string; endpoint: string; payload: unknown }>
  resolve(result: RpcResultLike<unknown>): void
} {
  let resolve!: (result: RpcResultLike<unknown>) => void
  const source = new Promise<RpcResultLike<unknown>>(done => { resolve = done })
  const calls: Array<{ channel: string; endpoint: string; payload: unknown }> = []
  return {
    calls,
    resolve,
    rpc: {
      call(channel, endpoint, payload) {
        calls.push({ channel, endpoint, payload })
        return source
      },
    },
  }
}

function overview(updatedAt = 1): Overview {
  const buckets = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const totals = { ...buckets, total: 0 }
  return {
    days: [], totals, sessionCount: 0, byModel: [],
    allTime: { totals, sessionCount: 0, byModel: [], costTotals: { peak: buckets, offPeak: buckets } },
    coverage: {
      mode: 'projection', timezone: 'UTC', sessionsTotal: 0, sessionsOk: 0,
      sessionsFailed: 0, sessionsPending: 0, eventsCounted: 0, retries: 0,
      compactionTokens: 0, from: null, to: null, usageSessionsMain: 0,
      usageSessionsSubagent: 0, failedSessionIds: [],
    },
    topSessions: [], providers: [], updatedAt,
  }
}

test('overview success is delivered once from one RPC with the force payload', async () => {
  const request = deferredRpc()
  const received: Overview[] = []
  const result = overview()
  const pending = callOverview(request.rpc, true, value => received.push(value))
  request.resolve({ ok: true, value: result })
  assert.equal(await pending, result)
  assert.deepEqual(received, [result])
  assert.deepEqual(request.calls, [{ channel: '/usage-stats', endpoint: 'overview', payload: { force: true } }])
})

test('overview keeps its 60s timeout and delivers the same RPC late success', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const request = deferredRpc()
  const received: Overview[] = []
  const pending = callOverview(request.rpc, false, value => received.push(value))
  const rejected = assert.rejects(pending, /overview timed out/)
  t.mock.timers.tick(59_999)
  await Promise.resolve()
  assert.deepEqual(received, [])
  t.mock.timers.tick(1)
  await rejected
  assert.deepEqual(received, [])
  const result = overview(2)
  request.resolve({ ok: true, value: result })
  await Promise.resolve()
  assert.deepEqual(received, [result])
  assert.deepEqual(request.calls, [{ channel: '/usage-stats', endpoint: 'overview', payload: { force: false } }])
})

test('overview RPC failure preserves its code without publishing a success', async () => {
  const request = deferredRpc()
  let received = 0
  const pending = callOverview(request.rpc, false, () => { received += 1 })
  const rejected = assert.rejects(pending, { message: 'scan failed', code: 'internal' })
  request.resolve({ ok: false, error: { code: 'internal', message: 'scan failed', details: {} } })
  await rejected
  assert.equal(received, 0)
})

test('overview callback errors reject the bounded request', async () => {
  const request = deferredRpc()
  const pending = callOverview(request.rpc, false, () => { throw new Error('consumer failed') })
  const rejected = assert.rejects(pending, /consumer failed/)
  request.resolve({ ok: true, value: overview() })
  await rejected
})

test('a newer overview load excludes a superseded late result and its cache write', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const requests = createOverviewRequests()
  const old = deferredRpc()
  const current = deferredRpc()
  const received: Overview[] = []
  const cached: Overview[] = []
  const isOldCurrent = requests.begin()
  const oldPending = callOverview(old.rpc, true, value => {
    if (!isOldCurrent()) return
    received.push(value)
    cached.push(value)
  })
  const rejected = assert.rejects(oldPending, /overview timed out/)
  t.mock.timers.tick(60_000)
  await rejected
  const isCurrent = requests.begin()
  const currentPending = callOverview(current.rpc, true, value => {
    if (!isCurrent()) return
    received.push(value)
    cached.push(value)
  })
  old.resolve({ ok: true, value: overview(1) })
  await Promise.resolve()
  assert.deepEqual(received, [])
  assert.deepEqual(cached, [])
  assert.equal(isOldCurrent(), false)
  assert.equal(isCurrent(), true)
  const fresh = overview(2)
  current.resolve({ ok: true, value: fresh })
  await currentPending
  assert.deepEqual(received, [fresh])
  assert.deepEqual(cached, [fresh])
  assert.equal(old.calls.length, 1)
  assert.equal(current.calls.length, 1)
})

test('effect disposal excludes late overview results and allows the next effect load', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const requests = createOverviewRequests()
  const request = deferredRpc()
  const isCurrent = requests.begin()
  let writes = 0
  const pending = callOverview(request.rpc, false, () => {
    if (isCurrent()) writes += 1
  })
  const rejected = assert.rejects(pending, /overview timed out/)
  t.mock.timers.tick(60_000)
  await rejected
  requests.invalidate()
  request.resolve({ ok: true, value: overview() })
  await Promise.resolve()
  assert.equal(writes, 0)
  assert.equal(isCurrent(), false)
  assert.equal(requests.begin()(), true)
  assert.equal(request.calls.length, 1)
})
