// Machine-registry pure logic for dsh-remote.
//
// Issue #13: a SAVED machine is only a standby connection — it must never
// silently become the "active remote context" of every session. The registry
// therefore keeps `currentId` as an EXPLICIT user choice:
//   • loadMachines never falls back to the first saved machine,
//   • a stale currentId (machine deleted meanwhile) resolves to null,
//   • add/update never auto-activate; only an explicit "set current" does,
//   • deleting the current machine leaves NO current (no auto-promotion).
// Keeping this logic in one module makes the guarantee unit-testable and
// shared between the HTTP routes and the tools (rw_connect).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

/** Load { list, currentId, explicitNone } from the registry file. */
export function loadMachines(file) {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'))
    if (Array.isArray(j.list)) {
      const list = j.list
      // Explicit choice only — no fallback to the first machine, no activation
      // of a stale/deleted id (issue #13).
      const currentId = j.currentId && list.some((m) => m.id === j.currentId) ? j.currentId : null
      // A persisted `currentId: null` is a deliberate "active remote = none"
      // (the user cleared the current machine). It must survive restarts so a
      // config-level default host cannot silently reactivate a context the user
      // explicitly turned off. `explicitNone` is true when the file carries an
      // explicit null (vs. a fresh file where currentId is simply absent).
      const explicitNone = Object.prototype.hasOwnProperty.call(j, 'currentId') && j.currentId == null
      return { list, currentId, explicitNone }
    }
  } catch (error) { if (error?.code !== 'ENOENT') console.warn('[dsh-remote/registry] 读取 SSH 主机配置失败；请检查文件权限与 JSON 格式。', error); }
  return { list: [], currentId: null, explicitNone: false }
}

/** Persist { list, currentId }. `currentId` may be null → active remote = none.
 *  Pass `keepCurrentKey: false` (add/update a machine without touching the
 *  current selection) to PRESERVE whatever `currentId` the file already holds
 *  — so merely saving a machine never flips a fresh registry into "explicit
 *  none", nor clears an explicit choice. When no previous file exists the
 *  `currentId` key is omitted entirely (fresh registry = "no choice yet"). */
export function saveMachines(file, list, currentId, keepCurrentKey = true) {
  try { mkdirSync(path.dirname(file), { recursive: true }) } catch { /* The following write reports a directory or permission failure to the caller. */ }
  let stored = currentId
  let hasStored = keepCurrentKey
  if (!keepCurrentKey) {
    try {
      const prev = JSON.parse(readFileSync(file, 'utf8'))
      if (prev && Object.prototype.hasOwnProperty.call(prev, 'currentId')) {
        stored = prev.currentId
        hasStored = true
      }
    } catch { /* no previous file → omit the key */ }
  }
  const payload = { list }
  if (hasStored) payload.currentId = stored
  writeFileSync(file, JSON.stringify(payload, null, 2))
}

/** Strip secrets before sending a machine to the client. */
export function sanitizeMachine(m) {
  if (!m) return m
  const { password, proxy, ...rest } = m
  const out = { ...rest, passwordSet: !!(m.password && m.password.length) }
  if (proxy) out.proxy = { ...proxy, password: proxy.password ? '' : undefined, passwordSet: !!(proxy.password && proxy.password.length) }
  return out
}

/** Apply a machine's fields onto the live config object (pool + tools read it). */
export function applyMachine(config, m) {
  if (!m) return
  config.host = m.host
  config.port = Number(m.port) || 22
  config.username = m.username || ''
  config.password = m.password || ''
  config.privateKeyPath = m.privateKeyPath || ''
  config.passphrase = m.passphrase || ''
  config.workspace = m.workspace || (config.workspace || '')
  if (m.hostKeyMode) config.hostKeyMode = m.hostKeyMode
  if (typeof m.useAgent === 'boolean') config.useAgent = m.useAgent
  if (typeof m.keyboardInteractive === 'boolean') config.keyboardInteractive = m.keyboardInteractive
  config.proxy = m.proxy && m.proxy.host ? m.proxy : undefined
}

/** Mint a fresh machine id. */
export function machineId() {
  return 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
}
