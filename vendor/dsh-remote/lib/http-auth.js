/**
 * Authentication and CSRF fence for dsh-remote routes registered directly on
 * ctx.webServer. Connection Fetch routes under /api/dsh-remote/* already pass
 * through Connection's /api admission fence and synthetic request bridge.
 */

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function sendAuthError(res, status, error) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ ok: false, error }))
}

function mediaTypeOf(req) {
  const raw = req?.headers?.['content-type']
  const value = Array.isArray(raw) ? raw[0] : raw
  return String(value ?? '').split(';', 1)[0].trim().toLowerCase()
}

function connectionRejection(req, connection, peer) {
  let admittedPeer = peer
  if (admittedPeer === undefined) {
    if (!connection) return 401
    if (typeof connection.admit === 'function') {
      const admission = connection.admit(req)
      if (admission && typeof admission === 'object' && 'rejection' in admission) {
        return admission.rejection
      }
      admittedPeer = admission?.peer
    } else if (typeof connection.requestRejection === 'function') {
      return connection.requestRejection(req)
    } else {
      return 401
    }
  }
  if (!admittedPeer) return 401
  if (admittedPeer.principal?.kind && admittedPeer.principal.kind !== 'owner') {
    return 403
  }
  return undefined
}

export function authorizeWebRequest(req, res, connection, peer) {
  const rejection = connectionRejection(req, connection, peer)
  if (rejection !== undefined) {
    sendAuthError(res, rejection, rejection === 401 ? 'unauthorized' : 'forbidden')
    return false
  }
  const method = String(req?.method || 'GET').toUpperCase()
  if (WRITE_METHODS.has(method) && mediaTypeOf(req) !== 'application/json') {
    sendAuthError(res, 415, 'content-type must be application/json')
    return false
  }
  return true
}

export function protectWebRoute(route, getConnection) {
  return {
    ...route,
    handler: async (req, res, peer) => {
      const connection = typeof getConnection === 'function' ? getConnection() : getConnection
      if (!authorizeWebRequest(req, res, connection, peer)) return
      return route.handler(req, res, peer)
    },
  }
}
