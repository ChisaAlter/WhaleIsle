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

export const passphraseSecretId = (id) => `${id}.passphrase`
export const proxyPasswordSecretId = (id) => `${id}.proxy-password`

/** Strip secrets before sending a machine to the client. */
export function sanitizeMachine(m) {
  if (!m) return m
  const { password, passphrase, proxy, ...rest } = m
  const out = {
    ...rest,
    passwordSet: !!(m.passwordSet || (password && password.length)),
    passphraseSet: !!(m.passphraseSet || (passphrase && passphrase.length)),
  }
  if (proxy) {
    const { password: proxyPassword, ...proxyRest } = proxy
    out.proxy = {
      ...proxyRest,
      passwordSet: !!(proxy.passwordSet || (proxyPassword && proxyPassword.length)),
    }
  }
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

function hasAnyStoredKeychainSecret(prev) {
  if (!prev || !prev.credentialBackend || prev.credentialBackend === 'plain') return false
  return !!(
    (prev.passwordSet && !prev.password) ||
    (prev.passphraseSet && !prev.passphrase) ||
    (prev.proxy && prev.proxy.passwordSet && !prev.proxy.password)
  )
}

async function persistSecretField({
  rawValue,
  prevValue,
  prevSet,
  secretKey,
  requestedBackend,
  state,
  secretsDir,
  persistPassword,
}) {
  const effectiveRaw = rawValue || (requestedBackend !== 'plain' && prevValue ? prevValue : '')
  if (effectiveRaw) {
    const persisted = await persistPassword({
      backend: state.credentialBackend,
      machineId: secretKey,
      password: effectiveRaw,
      secretsDir,
    })
    if (persisted.stored === 'secret') {
      state.credentialBackend = persisted.credentialBackend
      state.anySecretStored = true
    } else if (!state.anySecretStored) {
      state.credentialBackend = persisted.credentialBackend
    }
    if (persisted.warning && !state.warning) {
      state.warning = persisted.warning
      state.warningDetail = persisted.error
    }
    return { value: persisted.password, isSet: true }
  }
  return { value: prevValue || '', isSet: !!(prevValue || prevSet) }
}

async function persistProxyConfig({ id, proxyBody, prev, requestedBackend, state, secretsDir, persistPassword, deleteSecret }) {
  if (!proxyBody) {
    if (prev && prev.proxy && prev.credentialBackend && prev.credentialBackend !== 'plain') {
      await deleteSecret(proxyPasswordSecretId(id), secretsDir)
    }
    return undefined
  }
  const proxyUser = String(proxyBody.username || '').trim()
  const samePrev = !!(prev && prev.proxy && prev.proxy.host === String(proxyBody.host) && prev.proxy.username === proxyUser)
  const rawProxyPw = proxyBody.password ? String(proxyBody.password) : ''
  const proxyRes = await persistSecretField({
    rawValue: rawProxyPw,
    prevValue: samePrev ? prev.proxy.password : '',
    prevSet: samePrev ? prev.proxy.passwordSet : false,
    secretKey: proxyPasswordSecretId(id),
    requestedBackend,
    state,
    secretsDir,
    persistPassword,
  })
  if (!rawProxyPw && !samePrev && prev && prev.credentialBackend && prev.credentialBackend !== 'plain') {
    await deleteSecret(proxyPasswordSecretId(id), secretsDir)
  }
  return {
    host: String(proxyBody.host),
    port: Number(proxyBody.port) || 22,
    username: proxyUser,
    password: proxyRes.value,
    passwordSet: proxyRes.isSet,
    privateKeyPath: String(proxyBody.privateKeyPath || '').trim(),
  }
}

function formatMachineRecord({ id, host, body, prev, pwRes, ppRes, proxy, credentialBackend }) {
  return {
    id,
    name: String(body.name || '').trim() || host,
    host,
    port: Number(body.port) || 22,
    username: String(body.username || '').trim() || 'root',
    password: pwRes.value,
    passwordSet: pwRes.isSet,
    privateKeyPath: String(body.privateKeyPath || '').trim(),
    passphrase: ppRes.value,
    passphraseSet: ppRes.isSet,
    workspace: String(body.workspace || '').trim(),
    hostKeyMode: body.hostKeyMode || '',
    useAgent: !!body.useAgent,
    keyboardInteractive: !!body.keyboardInteractive,
    proxy,
    credentialBackend,
    recentWorkspaces: prev?.recentWorkspaces || [],
    lastConnectedAt: prev?.lastConnectedAt || null,
    latencyMs: prev?.latencyMs || null,
  }
}

/** Build a machine record from an HTTP add/update payload and persist secrets uniformly. */
export async function buildAndPersistMachine({
  id,
  body,
  prev,
  requestedBackend,
  secretsDir,
  persistPassword,
  deleteSecret,
}) {
  const host = String(body.host || '').trim()
  const proxyBody = body.proxy && body.proxy.host ? body.proxy : null
  const state = {
    credentialBackend: requestedBackend,
    anySecretStored: hasAnyStoredKeychainSecret(prev),
    warning: '',
    warningDetail: '',
  }

  const pwRes = await persistSecretField({
    rawValue: body.password ? String(body.password) : '',
    prevValue: prev?.password || '',
    prevSet: !!prev?.passwordSet,
    secretKey: id,
    requestedBackend,
    state,
    secretsDir,
    persistPassword,
  })
  const ppRes = await persistSecretField({
    rawValue: body.passphrase ? String(body.passphrase) : '',
    prevValue: prev?.passphrase || '',
    prevSet: !!prev?.passphraseSet,
    secretKey: passphraseSecretId(id),
    requestedBackend,
    state,
    secretsDir,
    persistPassword,
  })
  const proxy = await persistProxyConfig({
    id,
    proxyBody,
    prev,
    requestedBackend,
    state,
    secretsDir,
    persistPassword,
    deleteSecret,
  })
  const rec = formatMachineRecord({
    id,
    host,
    body,
    prev,
    pwRes,
    ppRes,
    proxy,
    credentialBackend: state.credentialBackend,
  })
  return { rec, warning: state.warning, warningDetail: state.warningDetail }
}

/** Delete all OS-keychain secrets owned by a machine record. */
export async function deleteMachineSecrets(m, secretsDir, deleteSecret) {
  if (!m || !m.credentialBackend || m.credentialBackend === 'plain') return
  await Promise.all([
    deleteSecret(m.id, secretsDir),
    deleteSecret(passphraseSecretId(m.id), secretsDir),
    deleteSecret(proxyPasswordSecretId(m.id), secretsDir),
  ])
}
