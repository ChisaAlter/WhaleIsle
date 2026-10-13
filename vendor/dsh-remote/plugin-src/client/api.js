// Transport for the dsh-remote host routes. The host registers every route on
// the Connection Fetch registry, which the /api prefix serves on BOTH carriers
// (HTTP webServer and the portless Desktop channel) — /api is the only prefix
// guaranteed everywhere, so it is unconditional here.

/** Append the session binding query the fs routes resolve through. */
export function withSessionQuery(path, sessionId) {
  if (!sessionId) return path
  return path + (path.includes('?') ? '&' : '?') + 'sessionId=' + encodeURIComponent(sessionId)
}

/** Same binding for POST bodies. */
export function withSessionBody(body, sessionId) {
  if (!sessionId) return { ...(body || {}) }
  return Object.assign({}, body || {}, { sessionId })
}

async function apiRaw(method, path, body) {
  const opts = { method, headers: {} }
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  const res = await fetch('/api' + path, opts)
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

async function api(method, path, body) {
  const { status, data } = await apiRaw(method, path, body)
  if (status >= 400) throw new Error((data && (data.error || data.message)) || 'HTTP ' + status)
  return data
}

export const remoteApi = {
  raw: apiRaw,
  status: (sessionId) => api('GET', withSessionQuery('/dsh-remote/status', sessionId)),
  machines: () => api('GET', '/dsh-remote/machines'),
  saveMachine: (payload) => api('POST', '/dsh-remote/machines', payload),
  deleteMachine: (id) => api('POST', '/dsh-remote/machines', { action: 'delete', id }),
  setCurrent: (id) => api('POST', '/dsh-remote/current', { id }),
  testConnect: (payload) => api('POST', '/dsh-remote/test-connect', payload),
  connect: (payload = {}) => api('POST', '/dsh-remote/connect', payload),
  pickWorkspace: (path) => api('POST', '/dsh-remote/mirror', { path }),
  resolveMirror: (local, sessionId) => {
    if (local) return api('GET', '/dsh-remote/resolve-mirror?local=' + encodeURIComponent(local))
    if (sessionId) return api('GET', '/dsh-remote/resolve-mirror?sessionId=' + encodeURIComponent(sessionId))
    return Promise.resolve({ remotePath: '' })
  },
  remoteHome: () => api('POST', '/dsh-remote/home'),
  ls: (path, sessionId) => api('GET', withSessionQuery('/dsh-remote/ls?path=' + encodeURIComponent(path || ''), sessionId)),
  read: (path, maxBytes, sessionId) => api('POST', '/dsh-remote/read', withSessionBody({ path, maxBytes }, sessionId)),
  write: (path, content, expectedMtime, sessionId) =>
    apiRaw('POST', '/dsh-remote/write', withSessionBody({ path, content, expectedMtime }, sessionId)),
  fs: (op, payload, sessionId) => api('POST', '/dsh-remote/fs', withSessionBody({ op, ...payload }, sessionId)),
  forwards: () => api('GET', '/dsh-remote/forwards'),
  forwardAction: (payload) => api('POST', '/dsh-remote/forwards', payload),
  audit: (limit) => api('GET', '/dsh-remote/audit?limit=' + encodeURIComponent(limit || 100)),
  sshConfig: () => api('GET', '/dsh-remote/ssh-config'),
  forgetKey: () => api('POST', '/dsh-remote/forget-key'),
}

const RESOURCE_PREFIX = 'dsh-resource://dsh-remote/'

/** Address a remote file tab claims through openResource — session-scoped. */
export function remoteFileAddress(sessionId, path) {
  return RESOURCE_PREFIX + encodeURIComponent(sessionId) + '/' + encodeURIComponent(path)
}

/** Recover (sessionId, path) from a remote resource address. */
export function remoteFileTarget(address) {
  const url = new URL(address)
  if (url.protocol !== 'dsh-resource:' || url.hostname !== 'dsh-remote') {
    throw new Error('invalid remote resource address')
  }
  const parts = url.pathname.split('/').filter(Boolean)
  return {
    sessionId: decodeURIComponent(parts[0] || ''),
    path: decodeURIComponent(parts.slice(1).join('/')),
  }
}

/** Display-path helpers shared by the picker and the explorer. */
export function joinRemotePath(base, name) {
  const b = String(base || '')
  const n = String(name || '')
  if (!b || b === '/') return '/' + n
  const sep = /^[a-zA-Z]:/.test(b) || b.includes('\\') ? '\\' : '/'
  return b.replace(/[\\/]+$/, '') + sep + n
}

export function parentRemotePath(p) {
  const t = String(p || '')
  if (!t || t === '/') return null
  const win = /^[a-zA-Z]:/.test(t)
  if (win && /^[a-zA-Z]:\\?$/.test(t)) return null
  const sep = win ? '\\' : '/'
  const idx = t.lastIndexOf(sep)
  if (idx <= 0) return null
  const par = t.slice(0, idx)
  if (win && /^[a-zA-Z]:$/.test(par)) return par + '\\'
  return par || '/'
}

/** Path segments for a crumb bar, display-form (POSIX and Windows). */
export function remoteCrumbs(p) {
  const t = String(p || '')
  if (!t) return []
  const win = /^[a-zA-Z]:/.test(t)
  const sep = win ? '\\' : '/'
  const parts = t.split(/[\\/]+/).filter(Boolean)
  const out = []
  for (let i = 0; i < parts.length; i++) {
    if (win) {
      out.push({ name: parts[i], path: i === 0 ? parts[0] + '\\' : parts.slice(0, i + 1).join('\\') })
    } else {
      out.push({ name: parts[i], path: '/' + parts.slice(0, i + 1).join('/') })
    }
  }
  return { sep, parts: out, windows: win }
}
