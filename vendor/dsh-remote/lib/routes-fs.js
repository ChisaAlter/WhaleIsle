// Sidebar file routes: /ls /read /write /fs.
//
// Machine-scoped callers (workspace picker, settings) omit sessionId and use
// the active-machine pool. Session-scoped callers (explorer / file tab) MUST
// pass sessionId (or local=mirror cwd); those requests resolve through the
// same mirror binding as rw_* tools and never fall back to the active machine.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import {
  normalizeRemotePath, joinRemotePath, remoteDirname, mkdirRemoteDirs, toDisplayPath,
} from './paths.js'
import { requestSessionHint } from './binding.js'
import { listDirStructured, listRemoteDrives, removeRemoteTree, previewRemoteFile } from './remote-fs.js'

export function createFsRoutes({
  sendJson,
  readBody,
  resolveRequestBinding,
  decodeBuf,
  encodeText,
  audit,
  config,
  mirrorDirFor,
}) {
  const bindOrReply = async (req, res, body = {}) => {
    try {
      return await resolveRequestBinding(req, body)
    } catch (err) {
      sendJson(res, (err && err.httpStatus) || 500, { ok: false, error: String((err && err.message) || err) })
      return null
    }
  }

  return [
    {
      kind: 'exact',
      path: '/dsh-remote/ls',
      handler: async (req, res) => {
        try {
          const hint = requestSessionHint(req)
          const b = await bindOrReply(req, res, hint)
          if (!b) return
          await b.pool.detect()
          const q = new URL(req.url, 'http://localhost').searchParams
          const raw = q.get('path') ? decodeURIComponent(q.get('path')) : (b.ws || '')
          const canon = normalizeRemotePath(raw)
          const win = b.pool.platform === 'windows'
          if (canon === '/' || raw === '' || raw === '/') {
            if (win || b.pool.platform !== 'posix') {
              const drives = await listRemoteDrives(b.pool)
              if (drives.length) return sendJson(res, 200, { path: '', platform: 'windows', items: drives, bound: b.bound })
            }
            if (win) return sendJson(res, 200, { path: '', platform: 'windows', items: [], bound: b.bound })
          }
          const sftp = await b.pool.sftp()
          const out = await listDirStructured(sftp, canon)
          const items = out.items.map((it) => ({
            ...it,
            path: toDisplayPath(joinRemotePath(canon, it.name), b.pool.platform),
          }))
          return sendJson(res, 200, {
            path: toDisplayPath(out.path, b.pool.platform),
            platform: win ? 'windows' : 'posix',
            items,
            missing: !!out.missing,
            bound: b.bound,
          })
        } catch (err) {
          return sendJson(res, 500, { error: String((err && err.message) || err) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/dsh-remote/read',
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
        try {
          const q = new URL(req.url, 'http://localhost').searchParams
          let p = q.get('path') ? decodeURIComponent(q.get('path')) : ''
          let encoding = ''
          let maxBytes = 256 * 1024
          let body = {}
          if (req.method === 'POST') {
            body = JSON.parse((await readBody(req, res)) || '{}')
            if (!p) p = String(body.path || '')
            if (body.encoding) encoding = String(body.encoding)
            if (body.maxBytes) maxBytes = Number(body.maxBytes)
          }
          if (q.get('maxBytes')) maxBytes = Number(q.get('maxBytes'))
          if (!p) return sendJson(res, 400, { ok: false, error: 'path is required' })
          const b = await bindOrReply(req, res, body)
          if (!b) return
          const target = normalizeRemotePath(p)
          let sftp
          try {
            sftp = await b.pool.sftp()
          } catch (err) {
            return sendJson(res, 500, { ok: false, error: 'sftp unavailable: ' + ((err && err.message) || err) })
          }
          try {
            const preview = await previewRemoteFile(sftp, target, {
              maxBytes,
              encoding: encoding || config.encoding,
              decodeBuf,
            })
            return sendJson(res, 200, preview)
          } catch (err) {
            return sendJson(res, 500, { ok: false, error: 'read failed: ' + ((err && err.message) || err) })
          }
        } catch (err) {
          return sendJson(res, 500, { ok: false, error: String((err && err.message) || err) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/dsh-remote/write',
      handler: async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
        try {
          const body = JSON.parse((await readBody(req, res)) || '{}')
          const p = normalizeRemotePath(String(body.path || ''))
          if (!p || p === '/') return sendJson(res, 400, { ok: false, error: 'path is required' })
          const b = await bindOrReply(req, res, body)
          if (!b) return
          const sftp = await b.pool.sftp()
          let st = null
          try { st = await sftp.stat(p) } catch { /* new file */ }
          if (body.expectedMtime != null && st && st.mtime !== Number(body.expectedMtime)) {
            return sendJson(res, 409, { ok: false, error: `远端文件已变化（mtime ${st.mtime} ≠ ${body.expectedMtime}），已放弃保存——请重新读取后再编辑` })
          }
          const buf = encodeText(String(body.content ?? ''), body.encoding || config.encoding)
          if (!st) await mkdirRemoteDirs(sftp, remoteDirname(p))
          await sftp.writeFile(p, buf)
          audit('write', `write ${p}`, 0, b)
          const st2 = await sftp.stat(p).catch(() => null)
          return sendJson(res, 200, { ok: true, bytes: buf.byteLength, mtime: st2 ? st2.mtime : Math.floor(Date.now() / 1000) })
        } catch (err) {
          return sendJson(res, 500, { ok: false, error: String((err && err.message) || err) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/dsh-remote/fs',
      handler: async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
        try {
          const body = JSON.parse((await readBody(req, res)) || '{}')
          const op = String(body.op || '')
          const b = await bindOrReply(req, res, body)
          if (!b) return
          const sftp = await b.pool.sftp()
          if (op === 'mkdir') {
            const p = normalizeRemotePath(String(body.path || ''))
            if (!p || p === '/') return sendJson(res, 400, { ok: false, error: 'path required' })
            await mkdirRemoteDirs(sftp, p)
            audit('mkdir', `mkdir ${p}`, 0, b)
            return sendJson(res, 200, { ok: true })
          }
          if (op === 'rename') {
            const p = normalizeRemotePath(String(body.path || ''))
            const d = normalizeRemotePath(String(body.dest || ''))
            if (!p || !d) return sendJson(res, 400, { ok: false, error: 'path and dest required' })
            await sftp.rename(p, d)
            audit('move', `move ${p} → ${d}`, 0, b)
            return sendJson(res, 200, { ok: true })
          }
          if (op === 'remove') {
            const p = normalizeRemotePath(String(body.path || ''))
            if (!p || p === '/') return sendJson(res, 400, { ok: false, error: 'path required' })
            const st = await sftp.stat(p).catch(() => null)
            if (!st) return sendJson(res, 404, { ok: false, error: 'not found' })
            if (st.isDirectory && st.isDirectory()) {
              await removeRemoteTree(sftp, p)
            } else {
              await sftp.unlink(p)
            }
            audit('remove', `remove ${p}`, 0, b)
            return sendJson(res, 200, { ok: true })
          }
          if (op === 'write' || op === 'append') {
            const p = normalizeRemotePath(String(body.path || ''))
            if (!p || p === '/') return sendJson(res, 400, { ok: false, error: 'path required' })
            let content = ''
            if (op === 'append') {
              try { content = decodeBuf(await sftp.readFile(p), body.encoding || config.encoding) } catch { /* new */ }
            }
            const buf = encodeText(content + String(body.content ?? ''), body.encoding || config.encoding)
            if (op === 'write' && !(await sftp.stat(p).catch(() => null))) await mkdirRemoteDirs(sftp, remoteDirname(p))
            await sftp.writeFile(p, buf)
            audit(op, `${op} ${p}`, 0, b)
            return sendJson(res, 200, { ok: true, bytes: buf.byteLength })
          }
          if (op === 'download') {
            const p = normalizeRemotePath(String(body.path || ''))
            const ws = b.ws
            if (!p || p === '/') return sendJson(res, 400, { ok: false, error: 'path required' })
            if (!ws) return sendJson(res, 400, { ok: false, error: 'no remote workspace set' })
            const st = await sftp.stat(p).catch(() => null)
            if (!st) return sendJson(res, 404, { ok: false, error: 'not found' })
            if (config.maxFileBytes > 0 && st.size > config.maxFileBytes) {
              return sendJson(res, 400, { ok: false, error: `file is ${st.size} bytes (over ${config.maxFileBytes} cap)` })
            }
            const base = b.mirrorDir || mirrorDirFor(ws, b.host, b.username, b.port)
            const rel = p.startsWith(ws) ? p.slice(ws.length).replace(/^\/+/, '') : p.slice(1)
            const local = path.join(base, rel)
            mkdirSync(path.dirname(local), { recursive: true })
            await sftp.fastGet(p, local)
            audit('download', `download ${p}`, 0, b)
            return sendJson(res, 200, { ok: true, bytes: st.size, local })
          }
          return sendJson(res, 400, { ok: false, error: 'unknown op' })
        } catch (err) {
          return sendJson(res, 500, { ok: false, error: String((err && err.message) || err) })
        }
      },
    },
  ]
}
