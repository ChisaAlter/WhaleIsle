import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import test from 'node:test'
import { authorizeWebRequest, protectWebRoute } from './http-auth.js'
import { connectionRoute, registerHttpTransports } from './http-transport.js'

const ALL_22_PATHS = [
  '/dsh-remote/status',
  '/dsh-remote/resolve-mirror',
  '/dsh-remote/connect',
  '/dsh-remote/ls',
  '/dsh-remote/read',
  '/dsh-remote/write',
  '/dsh-remote/fs',
  '/dsh-remote/workspace',
  '/dsh-remote/mirror',
  '/dsh-remote/local-pick',
  '/dsh-remote/local-list',
  '/dsh-remote/local-mkdir',
  '/dsh-remote/machines',
  '/dsh-remote/test-connect',
  '/dsh-remote/current',
  '/dsh-remote/forget-key',
  '/dsh-remote/forwards',
  '/dsh-remote/task',
  '/dsh-remote/tasks',
  '/dsh-remote/audit',
  '/dsh-remote/ssh-config',
  '/dsh-remote/home',
]

function makeRes() {
  const headers = {}
  const res = new EventEmitter()
  res.statusCode = 200
  res.body = ''
  res.writeHead = (status, hdrs = {}) => {
    res.statusCode = status
    Object.assign(headers, hdrs)
  }
  res.setHeader = (key, value) => {
    headers[key.toLowerCase()] = value
  }
  res.end = (chunk = '') => {
    res.body = String(chunk || '')
  }
  Object.defineProperties(res, {
    status: { get: () => res.statusCode },
    headers: { get: () => headers },
    json: { get: () => (res.body ? JSON.parse(res.body) : null) },
  })
  return res
}

function makeFakeCtx({ connection }) {
  const registeredWeb = []
  const registeredFetch = []
  const serviceMap = new Map()
  if (connection !== undefined) serviceMap.set('connection', connection)
  const webServer = {
    register(route) {
      registeredWeb.push(route)
      return () => {}
    },
  }
  serviceMap.set('webServer', webServer)
  const makeScope = () => ({
    get(name) {
      return serviceMap.get(name)
    },
    effect() {},
  })
  return {
    get(name) {
      return serviceMap.get(name)
    },
    inject(deps, fn) {
      if (deps.every((d) => serviceMap.has(d) && serviceMap.get(d) !== undefined)) {
        if (deps.includes('connection')) {
          const conn = serviceMap.get('connection')
          conn.fetch = {
            register(route) {
              registeredFetch.push(route)
              return async () => {}
            },
          }
        }
        fn(makeScope())
      }
    },
    registeredWeb,
    registeredFetch,
  }
}

test('authorizeWebRequest fails closed without connection and honors admit/requestRejection', () => {
  const r1 = makeRes()
  assert.equal(authorizeWebRequest({ method: 'GET', headers: {} }, r1, null), false)
  assert.equal(r1.status, 401)

  const r2 = makeRes()
  assert.equal(authorizeWebRequest({ method: 'GET', headers: {} }, r2, { admit: () => ({ rejection: 403 }) }), false)
  assert.equal(r2.status, 403)

  const r3 = makeRes()
  assert.equal(authorizeWebRequest({ method: 'GET', headers: {} }, r3, { admit: () => ({ peer: { principal: { kind: 'viewer' } } }) }), false)
  assert.equal(r3.status, 403)

  const r4 = makeRes()
  assert.equal(authorizeWebRequest({ method: 'GET', headers: {} }, r4, { requestRejection: () => 401 }), false)
  assert.equal(r4.status, 401)

  const r5 = makeRes()
  assert.equal(authorizeWebRequest({ method: 'GET', headers: {} }, r5, { requestRejection: () => undefined }), true)

  const r6 = makeRes()
  assert.equal(authorizeWebRequest({ method: 'GET', headers: {} }, r6, null, { principal: { kind: 'owner' } }), true)

  const r7 = makeRes()
  assert.equal(authorizeWebRequest({ method: 'GET', headers: {} }, r7, null, { principal: { kind: 'viewer' } }), false)
  assert.equal(r7.status, 403)
})

test('authorizeWebRequest enforces application/json on write methods and allows charset parameter', () => {
  const owner = { admit: () => ({ peer: { principal: { kind: 'owner' } } }) }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const badType of [undefined, 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
      const res = makeRes()
      const ok = authorizeWebRequest({ method, headers: badType ? { 'content-type': badType } : {} }, res, owner)
      assert.equal(ok, false, `${method} with ${badType} must be rejected`)
      assert.equal(res.status, 415)
    }
    for (const goodType of ['application/json', 'application/json; charset=utf-8']) {
      const res = makeRes()
      const ok = authorizeWebRequest({ method, headers: { 'content-type': goodType } }, res, owner)
      assert.equal(ok, true, `${method} with ${goodType} must pass`)
    }
  }
})

test('registerHttpTransports wraps all 22 /dsh-remote/* webServer routes while preserving /api/dsh-remote/* channel', async () => {
  let called = 0
  const routes = ALL_22_PATHS.map((p) => ({
    kind: 'exact',
    path: p,
    handler: async (_req, res) => {
      called += 1
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, path: p }))
    },
  }))
  let admitResult = { rejection: 401 }
  const ctx = makeFakeCtx({
    connection: {
      admit: () => admitResult,
    },
  })

  registerHttpTransports(ctx, routes)
  assert.equal(ctx.registeredWeb.length, 22)
  assert.equal(ctx.registeredFetch.length, 22)

  // Every webServer route must block unauthenticated requests and non-JSON writes.
  for (const route of ctx.registeredWeb) {
    const before = called
    admitResult = { rejection: 401 }
    const unauthRes = makeRes()
    await route.handler({ method: 'POST', url: route.path, headers: { 'content-type': 'application/json' } }, unauthRes)
    assert.equal(unauthRes.status, 401)
    assert.equal(called, before)

    admitResult = { rejection: 403 }
    const csrfRes = makeRes()
    await route.handler({ method: 'GET', url: route.path, headers: { origin: 'https://evil.example' } }, csrfRes)
    assert.equal(csrfRes.status, 403)
    assert.equal(called, before)

    admitResult = { peer: { principal: { kind: 'owner' } } }
    const textPlainRes = makeRes()
    await route.handler({ method: 'POST', url: route.path, headers: { 'content-type': 'text/plain' } }, textPlainRes)
    assert.equal(textPlainRes.status, 415)
    assert.equal(called, before)

    const validRes = makeRes()
    await route.handler({ method: 'POST', url: route.path, headers: { 'content-type': 'application/json' } }, validRes)
    assert.equal(validRes.status, 200)
    assert.equal(validRes.json.path, route.path)
    assert.equal(called, before + 1)
  }
  assert.equal(called, 22)

  // The /api/dsh-remote/* connection Fetch channel must still serve bodyless POSTs without synthetic header errors.
  const homeFetch = ctx.registeredFetch.find((r) => r.path === '/api/dsh-remote/home')
  assert.ok(homeFetch)
  const controller = new AbortController()
  const apiRes = await homeFetch.fetch(new Request('http://127.0.0.1:3080/api/dsh-remote/home', {
    method: 'POST',
    signal: controller.signal,
  }))
  assert.equal(apiRes.status, 200)
  assert.deepEqual(await apiRes.json(), { ok: true, path: '/dsh-remote/home' })
})

test('protectWebRoute handles dynamic connection arriving after route registration', async () => {
  let conn = null
  let hits = 0
  const wrapped = protectWebRoute({
    kind: 'exact',
    path: '/dsh-remote/status',
    handler: async (_req, res) => {
      hits += 1
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
    },
  }, () => conn)

  const beforeRes = makeRes()
  await wrapped.handler({ method: 'GET', headers: {} }, beforeRes)
  assert.equal(beforeRes.status, 401)
  assert.equal(hits, 0)

  conn = { admit: () => ({ peer: { principal: { kind: 'owner' } } }) }
  const afterRes = makeRes()
  await wrapped.handler({ method: 'GET', headers: {} }, afterRes)
  assert.equal(afterRes.status, 200)
  assert.equal(hits, 1)

  // Verify connectionRoute still rejects non-/dsh-remote/ paths.
  assert.throws(() => connectionRoute({ path: '/other', handler: () => {} }), /\/dsh-remote\//)
  const req = Readable.from([])
  assert.ok(req)
})
