// The routes in index.js are bounded JSON handlers, not arbitrary HTTP proxy
// handlers. Keep their implementation shared with legacy Web hosts while using
// Connection's authenticated, carrier-neutral channel on portless Desktop.
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'

const MAX_BODY_BYTES = 1024 * 1024

export function connectionRoute(route) {
  // Only the prefix is a real invariant here. `kind`/`exact` belongs to
  // dsh-host-webserver's registry (WebRouteKind); Connection's
  // ConnectionFetchRoute has no `kind` field and assertFetchRoute never reads
  // one, so requiring it would let a future route that omits it silently lose
  // itself and every route registered after it.
  if (!route.path.startsWith('/dsh-remote/')) {
    throw new Error('dsh-remote: expected a plugin route under /dsh-remote/')
  }
  return {
    path: '/api' + route.path,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    async fetch(request) {
      const chunks = []
      let size = 0
      // Desktop's IPC carrier need not impose the Web carrier's JSON cap.
      // Enforce our own cap before dispatch: oversized input must never become
      // an empty object that could accidentally trigger a default operation.
      const reader = request.body?.getReader()
      try {
        if (reader) {
          while (true) {
            request.signal.throwIfAborted()
            const { done, value } = await reader.read()
            if (done) break
            size += value.byteLength
            if (size > MAX_BODY_BYTES) {
              await reader.cancel()
              return Response.json({ ok: false, error: 'request body too large' }, { status: 413 })
            }
            chunks.push(Buffer.from(value))
          }
        }
      } finally {
        reader?.releaseLock()
      }
      request.signal.throwIfAborted()
      const url = new URL(request.url)
      // The legacy JSON reader joins chunks as strings. Supply one bounded
      // buffer so UTF-8 characters split by the IPC stream remain intact.
      const req = Readable.from(size ? [Buffer.concat(chunks, size)] : [])
      req.method = request.method
      req.url = route.path + url.search
      const headers = new Headers()
      let response
      const res = Object.assign(new EventEmitter(), {
        statusCode: 200,
        headersSent: false,
        writableEnded: false,
        setHeader(key, value) { headers.set(key, value) },
        writeHead(status, values = {}) {
          this.statusCode = status
          for (const [key, value] of Object.entries(values)) this.setHeader(key, value)
          this.headersSent = true
        },
        end(body) {
          response = new Response(body, { status: this.statusCode, headers })
          this.headersSent = true
          this.writableEnded = true
          this.emit('finish')
        },
      })
      const abort = () => { res.emit('close'); req.destroy() }
      request.signal.addEventListener('abort', abort, { once: true })
      try {
        await route.handler(req, res)
        if (!response) throw new Error('JSON handler did not finish its response')
        return response
      } finally {
        request.signal.removeEventListener('abort', abort)
        res.emit('close')
        req.destroy()
      }
    },
  }
}

export function registerHttpTransports(ctx, routes) {
  // Reactive injection matters: either service can arrive after the plugin.
  // Neither optional transport is a hard prerequisite for the SSH tools.
  ctx.inject(['webServer'], (inner) => {
    const disposers = routes.map((route) => inner.get('webServer').register(route))
    inner.effect(() => () => disposers.forEach((dispose) => dispose()), 'dsh-remote.web-routes')
  })
  ctx.inject(['connection'], (inner) => {
    const connection = inner.get('connection')
    // Older Web compositions may have Connection without exact Fetch routes.
    // dsh < 0.1.2-rc.1 is such a composition: the Desktop transport is simply
    // absent there, and the legacy /dsh-remote/* routes above still serve.
    if (typeof connection.fetch?.register !== 'function') return
    // Register one route at a time. A single failing route must not abort the
    // rest of the list (which would silently drop every later route) nor leak
    // the routes already registered, because this callback is a ctx.inject
    // child fiber: its throw is caught and logged by the loader, so the parent
    // plugin stays ACTIVE and the failure is easy to miss.
    const disposers = []
    const failed = []
    for (const route of routes) {
      try {
        disposers.push(connection.fetch.register(connectionRoute(route)))
      } catch (err) {
        failed.push(route.path + ': ' + String((err && err.message) || err))
      }
    }
    inner.effect(() => () => Promise.all(disposers.map((dispose) => dispose())), 'dsh-remote.fetch-routes')
    if (failed.length) {
      // Surface a partial registration instead of swallowing it; the Web
      // transport is unaffected, so this is a warning rather than a failure.
      console.warn('[dsh-remote] some Connection Fetch routes did not register:', failed.join('; '))
    }
  })
}
