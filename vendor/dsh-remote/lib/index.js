// dsh-remote — remote-work assistant for DeepSeek Harness.
//
// Host half. Turns "give me a remote host + login" into a usable REMOTE WORKSPACE:
//   • one persistent SSH/SFTP pool per configured remote (password OR private key,
//     SSH agent, keyboard-interactive, proxy jump),
//   • a "current remote workspace" — a remote directory the agent treats as the
//     active project root (user@host:/path) — injected into every system prompt,
//   • model tools `rw_*` (info/connect/workspace/list/read/write/edit/append/mkdir/
//     remove/move/stat/exec/search/download/upload/sync/push/forward/disconnect),
//   • JSON endpoints the client settings page + sidebar use over the harness
//     `webServer` (machines / ls / read / write / fs / forwards / task / audit /
//     ssh-config / local-pick / …),
//   • local mirror of the remote workspace (three-way conflict-aware SFTP sync),
//   • optional OS-keychain password storage, command audit log, TOFU host keys.
//
// The engine (path guard + shell quoting + ssh pool + exec) keeps the proven
// foundation; `ctx.fs` / the local workspace registry stay untouched — this is a
// REMOTE workspace presented as such to the model and UI.
//
// Plugin Config MUST be a schemastery schema (zod rejects the undefined row config).
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { execFile } from 'node:child_process'
import { readFileSync, mkdirSync, writeFileSync, existsSync, readdirSync, statSync, renameSync, copyFileSync, appendFileSync, watch } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import iconv from 'iconv-lite'

import {
  shq, normalizeRemotePath, joinRemotePath, remoteDirname, mkdirRemoteDirs,
  toShellPath, toDisplayPath, remotePathBase, truncate, shortHash,
} from './paths.js'
import { createHostKeyGuard, isHostKeyKnown as _isHostKeyKnown } from './hostkey.js'
import { compileIgnore, DEFAULT_IGNORE } from './ignore.js'
import { friendlyMessage } from './errors.js'
import { importableEntries, sshConfigPath, readSshConfigText } from './sshconfig.js'
import { getSecret, deleteSecret, platformBackend, persistPassword } from './credential.js'
import { syncTree, pushTree, loadSyncState, saveSyncState, pushOneFile } from './sync.js'
import { searchRemote } from './search.js'
import { resolveMirror, poolKey, lookupSessionCwd, encodeSegmentSafe, readSessionHeaderCwd, requestSessionHint } from './binding.js'
import { TaskManager } from './tasks.js'
import { ForwardManager } from './forwards.js'
import { loadMachines as _loadMachines, saveMachines as _saveMachines, sanitizeMachine as _sanitizeMachine, applyMachine as _applyMachine, machineId as _machineId } from './registry.js'
import { registerHttpTransports } from './http-transport.js'
import { SshPool } from './pool.js'
import { createFsRoutes } from './routes-fs.js'
import { removeRemoteTree } from './remote-fs.js'
import { readBodyLimited } from '../../dsh-shared/lib/secret.mjs'

export const name = 'dsh-remote'

// Web and Desktop share the SSH tools; each optional UI transport is attached
// reactively below, so service startup order does not drop the JSON routes.
export const inject = ['tools', 'systemPrompt']

export const Config = z.object({
  /** Remote SSH host (empty → the plugin starts disconnected). */
  host: z.string().default(''),
  /** Remote SSH port (22 unless the machine uses a custom port). */
  port: z.number().step(1).min(1).max(65535).default(22),
  /** SSH login user. */
  username: z.string().default(''),
  /** Password login (only when the remote has no key. Override the fallback below). */
  password: z.string().default(''),
  /** Explicit SSH private-key path (optional; only used when supplied). Never auto-reads ~/.ssh. */
  privateKeyPath: z.string().default(''),
  /** Key passphrase when the key is encrypted. */
  passphrase: z.string().default(''),
  /** Initial remote workspace path (absolute dir the agent should treat as root). */
  workspace: z.string().default(''),
  /** Remote command terminal strategy. '' = auto-detect (Windows remotes look
   * for Git Bash and pipe every command through `bash -s`); 'git-bash' = prefer
   * Git Bash on Windows; 'native' = never wrap; any other value = explicit
   * bash.exe path (e.g. 'C:\\Program Files\\Git\\bin\\bash.exe'). Git Bash makes
   * a Windows remote behave like a POSIX host (/c/Users/... paths). */
  shell: z.string().default(''),
  /** Per-command timeout. */
  commandTimeoutMs: z.number().step(1).min(1000).default(20000),
  /** SSH connection establishment timeout. */
  connectTimeoutMs: z.number().step(1).min(1000).default(15000),
  /** Hard ceiling on collected remote output per call. */
  maxOutputChars: z.number().step(1).min(1024).default(200000),
  /** Skip mirroring files larger than this many bytes (0 = no cap). */
  maxFileBytes: z.number().step(1).min(0).default(52428800),
  /** Host-key policy: `accept-new` (default) records a host's key on first
   * connect and verifies it afterwards (mirrors ssh's StrictHostKeyChecking
   * accept-new); `verify` also rejects hosts never seen before; `off` skips
   * verification entirely (MITM-unsafe, not recommended). */
  hostKeyMode: z.string().default('accept-new'),
  /** Use the OpenSSH agent (SSH_AUTH_SOCK) when no password/key is configured. */
  useAgent: z.boolean().default(false),
  /** Allow keyboard-interactive auth (OTP/MFA chains) using the configured password. */
  keyboardInteractive: z.boolean().default(false),
  /** Jump host / bastion: connect through this machine first. All fields have
   * defaults so this works on schemastery versions without `.optional()`; an
   * empty `host` means "no jump host". */
  proxy: z.object({
    host: z.string().default(''),
    port: z.number().step(1).min(1).max(65535).default(22),
    username: z.string().default(''),
    password: z.string().default(''),
    privateKeyPath: z.string().default(''),
  }),
  /** Auto-push edited mirror files back to the remote (watcher, debounced). Default off. */
  autoPush: z.boolean().default(false),
  /** Append executed commands to the audit log under the harness home. */
  auditLog: z.boolean().default(true),
  /** Text encoding for remote file reads/writes (utf-8 default; gbk etc.). */
  encoding: z.string().default('utf-8'),
})

// ── shell / path helpers (pure implementations in lib/paths.js) ───────────

/** Harness home: respect `DSH_HOME` when set (the desktop app sets it to its
 * own `userData/harness`), otherwise fall back to `~/.dsh`. */
function dshBase() {
  const env = process.env.DSH_HOME
  if (env && String(env).trim()) return path.resolve(String(env).trim())
  return path.join(homedir(), '.dsh')
}

/** Root holding every remote host's mirrors + the machine registry. */
function remoteWorkspacesRoot() {
  return path.join(dshBase(), 'remote-workspaces')
}

/** Local mirrors of one remote host. */
function mirrorRootFor(host, user, port) {
  const tag = [host, user, port].filter(Boolean).join('-').replace(/[^a-zA-Z0-9._-]/g, '_')
  return path.join(remoteWorkspacesRoot(), tag)
}

/** Local mirror dir for a specific remote path (idempotent → returns same dir). */
function mirrorDirFor(remotePath, host, user, port) {
  const base = remotePathBase(remotePath)
  const root = mirrorRootFor(host, user, port)
  const plain = path.join(root, base)
  const norm = normalizeRemotePath(remotePath)
  // A pre-existing mirror for this exact remote origin → reuse it (idempotent).
  try {
    const meta = JSON.parse(readFileSync(path.join(plain, '.dsh-remote-meta.json'), 'utf8'))
    if (meta.remotePath === norm) return plain
  } catch {
    /* no mirror yet → fall through */
  }
  if (!existsSync(plain)) return plain
  return path.join(root, base + '-' + shortHash(norm))
}

/** Create the local mirror dir + a meta file describing its remote origin. */
function ensureMirror(remotePath, host, user, port) {
  const dir = mirrorDirFor(remotePath, host, user, port)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    path.join(dir, '.dsh-remote-meta.json'),
    JSON.stringify({ host, port, username: user, remotePath: normalizeRemotePath(remotePath), createdAt: new Date().toISOString() }, null, 2),
  )
  return dir
}

/** Recursive directory copy (EXDEV fallback for migrateLegacyData). */
function copyDirSync(from, to) {
  mkdirSync(to, { recursive: true })
  for (const e of readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name)
    const d = path.join(to, e.name)
    if (e.isDirectory()) copyDirSync(s, d)
    else try { copyFileSync(s, d) } catch { /* skip unreadable */ }
  }
}

/** One-time migration of pre-0.6 data (~/.dsh/remote-workspaces) into DSH_HOME.
 * Only runs when the harness is on its DEFAULT home: an explicitly-set DSH_HOME
 * pointing elsewhere means ~/.dsh belongs to another installation — migrating
 * would RENAME that other installation's live data out from under it. */
function migrateLegacyData() {
  const env = process.env.DSH_HOME
  if (env && String(env).trim() && path.resolve(String(env).trim()) !== path.join(homedir(), '.dsh')) return
  const legacy = path.join(homedir(), '.dsh', 'remote-workspaces')
  const target = remoteWorkspacesRoot()
  if (legacy === target || !existsSync(legacy) || existsSync(target)) return
  try {
    mkdirSync(path.dirname(target), { recursive: true })
    try {
      renameSync(legacy, target)
    } catch (err) {
      if (err.code !== 'EXDEV') throw err
      copyDirSync(legacy, target)
    }
  } catch {
    // Migration is best-effort: a fresh registry is created on next save.
  }
}

// ── persistent multi-machine registry ─────────────────────────────────────
// Pure registry logic lives in lib/registry.js (unit-tested): saved machines
// are STANDBY connections; only an explicit "set current" activates one.
// (issue #13 — Saved Connections != Active Remote Context)
const MACHINES_FILE = 'machines.json'
const machinesFile = () => path.join(remoteWorkspacesRoot(), MACHINES_FILE)
const secretsDir = () => path.join(remoteWorkspacesRoot(), '.secrets')
const forwardsFile = () => path.join(remoteWorkspacesRoot(), 'forwards.json')
const auditFile = () => path.join(remoteWorkspacesRoot(), 'audit.log')
const ignoreFile = () => path.join(remoteWorkspacesRoot(), '.dsh-remote-ignore')

const loadMachines = () => _loadMachines(machinesFile())
const saveMachines = (list, currentId, keepCurrentKey) => _saveMachines(machinesFile(), list, currentId, keepCurrentKey)
const sanitizeMachine = _sanitizeMachine
const applyMachine = _applyMachine
const machineId = _machineId

// ── host-key registry (TOFU) ──────────────────────────────────────────────
const KNOWN_HOSTS_FILE = 'known_hosts.json'
const knownHostsFile = () => path.join(remoteWorkspacesRoot(), KNOWN_HOSTS_FILE)
const isHostKeyKnown = (host, port) => _isHostKeyKnown(knownHostsFile(), host, port)

// ── encoding helpers ───────────────────────────────────────────────────────

function decodeBuf(buf, enc) {
  const e = enc && !/^utf-?8$/i.test(String(enc)) ? String(enc).toLowerCase() : null
  return e ? iconv.decode(buf, e) : buf.toString('utf8')
}
function encodeText(s, enc) {
  const e = enc && !/^utf-?8$/i.test(String(enc)) ? String(enc).toLowerCase() : null
  return e ? iconv.encode(String(s), e) : Buffer.from(String(s), 'utf8')
}

// ── apply ─────────────────────────────────────────────────────────────────

export async function apply(ctx, config) {
  const pool = new SshPool(config, { knownHostsFile })
  ctx.effect(() => () => pool.close(), 'dsh-remote.close')

  migrateLegacyData()

  // ── machine registry (multi-host) ─────────────────────────────────────────
  const store = loadMachines()
  const machines = store.list
  const machineIndex = (id) => machines.findIndex((m) => m.id === id)

  /** The machine the pool is currently bound to: an ephemeral tool connection
   * (rw_connect save:false) wins, then the stored current, then config default. */
  let ephemeral = null
  const activeMachine = () => {
    if (ephemeral) return ephemeral
    if (store.currentId) {
      const i = machineIndex(store.currentId)
      if (i >= 0) return machines[i]
    }
    if (config.host) return { id: machineId(), name: config.host, host: config.host, port: config.port, username: config.username, password: config.password, privateKeyPath: config.privateKeyPath, passphrase: config.passphrase }
    return null
  }
  const currentMachine = activeMachine

  /** Resolve a machine's effective password (keychain backend support). */
  const machinePassword = async (m) => {
    if (m && m.password) return m.password
    if (m && m.credentialBackend && m.credentialBackend !== 'plain') {
      const p = await getSecret(m.id, secretsDir())
      if (p) return p
    }
    return ''
  }

  // The pool resolves keychain-stored passwords lazily at connect time.
  pool.passwordResolver = async () => {
    const m = activeMachine()
    return machinePassword(m)
  }

  const applyActiveMachine = async () => {
    const m = activeMachine()
    if (!m || !m.host) return
    const pw = await machinePassword(m)
    applyMachine(config, { ...m, password: pw || m.password || '' })
    pool.setTarget({
      host: config.host, port: config.port, username: config.username,
      password: config.password, privateKeyPath: config.privateKeyPath,
      passphrase: config.passphrase, workspace: config.workspace,
      useAgent: config.useAgent, keyboardInteractive: config.keyboardInteractive,
      proxy: config.proxy, hostKeyMode: config.hostKeyMode,
    })
  }

  // ── per-machine SSH pools (session-bound) ─────────────────────────────────
  // The `pool` above stays the ACTIVE-machine pool: it backs the settings page,
  // the workspace picker routes, and `rw_connect`, whose semantics are "switch
  // the active machine". Session-bound tool calls must not go through it —
  // `setTarget()` rewrites the shared `config` identity and closes the live
  // connection, so two sessions on different machines would take the pool from
  // each other and commands would land on the wrong host (issue #25).
  //
  // Instead each machine gets its own pool, keyed by its stable identity. A
  // session resolves its machine from its own workspace mirror, so concurrent
  // sessions on different hosts never share a connection. Sessions on the SAME
  // machine still share one, preserving the single-connection + keepalive model.

  /** Deployment-varying tunables shared by every pool, owned by the live plugin
   *  Config so a settings change reaches existing pools. Identity, credential,
   *  and per-machine policy fields (`hostKeyMode`, `shell`, `proxy`) are
   *  deliberately excluded — those are pinned per pool from the machine record,
   *  and re-copying them from the shared config is exactly the bug this
   *  registry fixes. */
  const TUNABLE_KEYS = [
    'connectTimeoutMs', 'commandTimeoutMs', 'maxOutputChars', 'maxFileBytes', 'encoding',
  ]
  const syncTunables = (target) => {
    for (const k of TUNABLE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(config, k)) target[k] = config[k]
    }
    return target
  }

  const machinePools = new Map()
  ctx.effect(() => () => {
    for (const p of machinePools.values()) {
      try { p.close() } catch { /* a pool already torn down by its own error path */ }
    }
    machinePools.clear()
  }, 'dsh-remote.machine-pools')

  /** Registry record for a resolved mirror origin, so a session-bound pool gets
   *  the machine's real credentials (key path, passphrase, agent, proxy) rather
   *  than only the host/user/port the mirror meta records.
   *
   *  An EPHEMERAL connection (rw_connect save:false) is not in the registry but
   *  is still a legitimate credential source for a pool the same process later
   *  resolves for that identity: without it a mirror picked on a temporary
   *  connection would resolve to an empty-credential pool and fail to connect. */
  const machineRecordFor = ({ host, port, username }) =>
    (ephemeral && ephemeral.host === host && Number(ephemeral.port) === Number(port) && (ephemeral.username || '') === (username || '')
      ? ephemeral
      : null)
    || machines.find((m) => m.host === host && Number(m.port) === Number(port) && (m.username || '') === (username || ''))
    || null

  /**
   * Get (or lazily create) the dedicated pool for one remote identity.
   * @param {{host: string, port: number, username: string}} target - the mirror-recorded origin.
   * @returns {SshPool} the pool pinned to that identity; never the active-machine pool.
   */
  const poolForMachine = (target) => {
    const key = poolKey(target)
    const rec = machineRecordFor(target)
    const existing = machinePools.get(key)
    if (existing) {
      syncTunables(existing.config)
      // Re-read credentials and per-machine policy from the registry: editing a
      // machine in the settings page must reach a pool created earlier, and a
      // pool holding a stale password would keep failing to reconnect.
      if (rec) {
        existing.config.password = rec.password || ''
        existing.config.privateKeyPath = rec.privateKeyPath || ''
        existing.config.passphrase = rec.passphrase || ''
        existing.config.useAgent = !!rec.useAgent
        existing.config.keyboardInteractive = !!rec.keyboardInteractive
        existing.config.proxy = rec.proxy || undefined
        existing.config.hostKeyMode = rec.hostKeyMode || config.hostKeyMode
      }
      return existing
    }
    const poolConfig = syncTunables({
      ...config,
      host: target.host,
      port: Number(target.port) || 22,
      username: target.username || (rec && rec.username) || 'root',
      password: (rec && rec.password) || '',
      privateKeyPath: (rec && rec.privateKeyPath) || '',
      passphrase: (rec && rec.passphrase) || '',
      useAgent: rec ? !!rec.useAgent : !!config.useAgent,
      keyboardInteractive: rec ? !!rec.keyboardInteractive : !!config.keyboardInteractive,
      proxy: (rec && rec.proxy) || undefined,
      hostKeyMode: (rec && rec.hostKeyMode) || config.hostKeyMode,
      // Identity-pinned pools never carry the shared active workspace: a
      // session passes its own mirror-resolved remote path explicitly.
      workspace: '',
    })
    const created = new SshPool(poolConfig, { knownHostsFile })
    // Keychain-backed passwords resolve against THIS pool's machine record.
    created.passwordResolver = async () => machinePassword(rec || { id: '', password: poolConfig.password })
    machinePools.set(key, created)
    return created
  }

  const setCurrent = async (id) => {
    if (!id) {
      // Explicit "active remote = none": saved machines stay in the registry
      // (issue #13) but nothing is bound to the pool anymore.
      store.currentId = null
      ephemeral = null
      saveMachines(machines, null)
      await clearActiveMachine()
      return true
    }
    const i = machineIndex(id)
    if (i < 0) return false
    store.currentId = id
    ephemeral = null
    saveMachines(machines, id)
    await applyActiveMachine()
    return true
  }

  /** Unbind the pool + live config from any machine: the plugin starts in a
   * pure "no remote context" state (issue #13). The host stays configured for
   * tool fallback, but no machine workspace leaks into this session. */
  const clearActiveMachine = async () => {
    ephemeral = null
    if (!config.host) return
    // Clear host + workspace directly (applyMachine keeps the old workspace
    // when the incoming value is empty — it must not be used for a full reset).
    config.host = ''
    config.port = 22
    config.username = ''
    config.password = ''
    config.workspace = ''
    pool.setTarget({ host: '', port: 22, username: '', workspace: '' })
    // Also stop any auto-push watcher bound to the old machine workspace.
    // (autoPushWatchers is declared later; read it lazily to avoid TDZ.)
    if (typeof autoPushWatchers !== 'undefined' && autoPushWatchers) {
      for (const [, entry] of autoPushWatchers) {
        if (!entry) continue
        try { entry.watcher && entry.watcher.close() } catch { /* Continue releasing the remaining file watchers after an individual close fails. */ }
        if (entry.timer) clearTimeout(entry.timer)
      }
      autoPushWatchers.clear()
    }
  }

  // If no stored current, adopt a CLI-provided default as the active machine —
  // UNLESS the user explicitly cleared the current machine (currentId: null in
  // the registry = "active remote = none", issue #13). A registry that exists
  // with currentId null must stay inert; only a fresh/absent registry lets the
  // config host serve as the bootstrap default.
  {
    const cur = currentMachine()
    const registryExplicitNone = store.explicitNone
    if (cur && cur.host && !store.currentId && !registryExplicitNone) applyMachine(config, cur)
  }

  // ── auto-restore the last active machine (best-effort) ───────────────────
  // When the harness (re)starts, bring back the machine that was "current"
  // last time: apply its config to the pool and probe a real SSH connection so
  // the sidebar shows connected instead of a disconnected 500-spamming state.
  // Failures are swallowed — an unreachable host must never break plugin boot
  // (the sidebar will show「未连接」and the user can reconnect or set current).
  if (store.currentId) {
    const i = machineIndex(store.currentId)
    if (i >= 0 && machines[i] && machines[i].host) {
      setImmediate(async () => {
        try {
          await applyActiveMachine()
          await pool.exec('echo dsh-remote-restore', { timeoutMs: Math.min(config.commandTimeoutMs || 20000, 15000) })
        } catch {
          // Offline / bad credentials: leave pool unconnected; UI falls back
          // to the "未连接" state and the user can reconnect manually.
        }
      })
    }
  }

  /** Persist the active workspace on the machine the pool is actually bound to
   * (fixes the old bug where a tool-connected machine saved its workspace onto
   * the registry's current machine instead). */
  const persistWorkspace = (p) => {
    config.workspace = p
    const m = activeMachine()
    if (m) {
      if (store.currentId && m.id === store.currentId && machineIndex(m.id) >= 0) {
        const rec = machines[machineIndex(m.id)]
        rec.workspace = p
        rec.recentWorkspaces = [p, ...(rec.recentWorkspaces || []).filter((x) => x !== p)].slice(0, 8)
        saveMachines(machines, store.currentId)
      } else if (ephemeral) {
        ephemeral.workspace = p
      }
    }
  }

  // ── audit log ─────────────────────────────────────────────────────────────
  /**
   * Append one audit line. `target` names the machine the operation really ran
   * on and must be passed by every session-bound caller: the shared `config`
   * identity belongs to the ACTIVE machine, which can be a different host than
   * the session that issued the command, so defaulting to it would
   * misattribute the operation.
   * @param {string} op - operation name.
   * @param {string} cmd - command text or path detail.
   * @param {number|null} code - exit code, or null when not applicable.
   * @param {{host?: string, username?: string, port?: number}} [target] - machine acted on; defaults to the active machine.
   */
  const audit = (op, cmd, code, target) => {
    if (!config.auditLog) return
    const host = (target && target.host) || config.host
    const user = (target && target.username) || config.username
    const port = (target && target.port) || config.port
    try {
      const line = [new Date().toISOString(), `${user || '?'}@${host || '?'}:${port}`, op, code == null ? '-' : String(code), String(cmd || '').replace(/\s+/g, ' ').slice(0, 400)].join(' | ') + '\n'
      appendFileSync(auditFile(), line, 'utf8')
    } catch (error) { ctx.logger.warn('写入 SSH 审计日志失败；请检查应用数据目录的写入权限。', error); }
  }
  const readAudit = (limit) => {
    try {
      const text = readFileSync(auditFile(), 'utf8')
      const lines = text.split('\n').filter(Boolean)
      return lines.slice(-Math.max(1, Math.min(Number(limit) || 50, 500)))
    } catch {
      return []
    }
  }

  // ── ignore rules (defaults + user file) ───────────────────────────────────
  const ignoreMatcher = () => {
    try {
      const fromFile = readFileSync(ignoreFile(), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
      return compileIgnore(DEFAULT_IGNORE.concat(fromFile))
    } catch {
      return compileIgnore(DEFAULT_IGNORE)
    }
  }

  // ── task + forward managers ───────────────────────────────────────────────
  const tasks = new TaskManager()
  const forwards = new ForwardManager(pool, { file: forwardsFile() })
  pool.onReady = (client) => forwards.attach(client)
  pool.onCloseHook = () => forwards.detach()

  // ── auto-push watcher (config.autoPush, default off) ──────────────────────
  // Watches the local mirror; local edits are pushed back to the remote after a
  // 3s debounce, honoring ignore rules + the three-way conflict guard (a remote
  // change is never clobbered — it is recorded as a conflict in the audit log).
  const autoPushWatchers = new Map() // localDir → { watcher, pending:Set, timer }
  const flushAutoPush = async (localDir) => {
    const entry = autoPushWatchers.get(localDir)
    if (!entry || !entry.pending.size) return
    const rels = [...entry.pending]
    entry.pending.clear()
    // Resolve the destination from the WATCHED MIRROR, not from the active
    // machine: a watcher outlives any one session, so gating on the active
    // machine made it silently stop pushing (and, before per-machine pools,
    // risked pushing one host's mirror through another host's connection).
    const { remotePath: ws, machine } = resolveMirrorForLocal(localDir)
    if (!ws || !machine) return
    const target = poolForMachine(machine)
    let sftp
    try { sftp = await target.sftp() } catch { return }
    const matcher = ignoreMatcher()
    const state = loadSyncState(localDir)
    const next = { ...state }
    if (rels.includes('*')) {
      const r = await pushTree(sftp, localDir, ws, { maxFiles: 2000, maxFileBytes: config.maxFileBytes, isIgnored: matcher, state: next })
      Object.assign(next, r.nextState)
      for (const c of r.stats.conflicts) audit('auto-push-conflict', `push ${c.path}`, 1, machine)
    } else {
      for (const rel of rels) {
        const r = await pushOneFile(sftp, localDir, ws, rel, { maxFileBytes: config.maxFileBytes, isIgnored: matcher, state: next })
        if (r.status === 'pushed' && r.state) Object.assign(next, r.state)
        else if (r.status === 'conflict') audit('auto-push-conflict', `push ${rel}`, 1, machine)
      }
    }
    saveSyncState(localDir, next)
  }
  const startAutoPush = (localDir) => {
    if (!config.autoPush || autoPushWatchers.has(localDir)) return
    const entry = { pending: new Set(), timer: null, watcher: null }
    const schedule = () => {
      if (entry.timer) clearTimeout(entry.timer)
      entry.timer = setTimeout(() => flushAutoPush(localDir), 3000)
    }
    const onEvent = (eventType, filename) => {
      if (!filename) { entry.pending.add('*'); return schedule() }
      const rel = String(filename).replace(/\\/g, '/')
      if (rel === '.dsh-remote-meta.json' || rel === '.dsh-remote-sync-state.json' || rel.startsWith('.dsh-remote-sync-state.json.tmp')) return
      entry.pending.add(rel)
      schedule()
    }
    try {
      entry.watcher = watch(localDir, { recursive: true }, onEvent)
    } catch {
      try { entry.watcher = watch(localDir, onEvent) } catch { return }
    }
    autoPushWatchers.set(localDir, entry)
  }
  ctx.effect(() => () => {
    for (const e of autoPushWatchers.values()) {
      if (e.timer) clearTimeout(e.timer)
      try { e.watcher && e.watcher.close() } catch { /* Continue releasing the remaining file watchers after an individual close fails. */ }
    }
    autoPushWatchers.clear()
  }, 'dsh-remote.autopush')

  // Helpers shared by session-bound tools and the machine-scoped web routes take
  // the pool explicitly (`p`), defaulting to the active-machine pool so route
  // callers — which are machine-scoped by design — stay unchanged.
  const run = async (cmd, opts = {}, p = pool) => {
    const res = await p.exec(cmd, opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {})
    const parts = []
    if (res.stdout) parts.push(res.stdout.replace(/\s+$/, ''))
    if (res.stderr) parts.push('-- stderr --\n' + res.stderr.replace(/\s+$/, ''))
    if (!parts.length) parts.push('(no output)')
    let text = parts.join('\n')
    if (res.signal === 'TIMEOUT') text += `\n[command timed out after ${opts.timeoutMs ?? config.commandTimeoutMs}ms]`
    else if (res.code !== 0) text += `\n[exit code: ${res.code}]`
    return text
  }

  const isRemoteDir = async (p, sshPool = pool) => {
    const target = normalizeRemotePath(p)
    try {
      const sftp = await sshPool.sftp()
      const st = await sftp.stat(target)
      return !!(st && st.isDirectory && st.isDirectory())
    } catch {
      return false
    }
  }

  // ── remote workspace state ────────────────────────────────────────────────
  const wsPath = () => (config.workspace || '').trim()
  /** Map a LOCAL path to the remote path its mirror represents ('' when the
   *  path is not inside any dsh-remote mirror). Shared by the resolve-mirror
   *  route, the session-aware system-prompt injection, and status().
   *
   *  `machine` carries the mirror's recorded origin (`host`/`port`/`username`
   *  from `.dsh-remote-meta.json`), or null when the path is not inside a
   *  mirror. That origin is what makes a session's remote target authoritative
   *  without consulting the mutable active-machine state, so a concurrent
   *  session switching machines cannot redirect this session's commands. */
  const resolveMirrorForLocal = (local) => resolveMirror(local, remoteWorkspacesRoot())
  if (config.autoPush && wsPath()) {
    startAutoPush(mirrorDirFor(wsPath(), config.host, config.username, config.port))
  }
  /** The remote path one agent session is bound to, or '' when that session is
   *  a plain local one. Walks the mirror registry (host side copy of the
   *  resolve-mirror logic) so status / prompt / sidebar agree.
   *
   *  `sessionId` narrows to one session. WITHOUT it the first live session's cwd
   *  is used, which is only meaningful for the machine-scoped settings view:
   *  with several live sessions the "first" one is arbitrary and may belong to
   *  another machine. Tool calls must never route through this — they resolve
   *  their own session through `bindingFor()`, which is authoritative. */
  const sessionsSvc = () => (ctx && typeof ctx.get === 'function' ? ctx.get('sessions') : null)
  const sessionCwd = (sessionId) => {
    const sessions = sessionsSvc()
    if (sessionId) return lookupSessionCwd(sessionId, { sessions, dshHome: dshBase() })
    try {
      if (sessions && typeof sessions.list === 'function') {
        const s = sessions.list()[0]
        if (s && s.header && s.header.cwd) return String(s.header.cwd)
      }
    } catch { /* sessions service unavailable */ }
    return ''
  }
  const sessionRemotePath = (sessionId) => {
    const cwd = sessionCwd(sessionId)
    if (!cwd) return ''
    return resolveMirrorForLocal(cwd).remotePath
  }

  /**
   * HTTP binding for sidebar file routes. A sessionId/local hint is authoritative:
   * a local (non-mirror) session is refused rather than falling back to the
   * active machine. Requests with no hint keep the picker/settings active pool.
   */
  const resolveRequestBinding = async (req, body = {}) => {
    const hint = requestSessionHint(req, body)
    let cwd = hint.local
    if (!cwd && hint.sessionId) cwd = lookupSessionCwd(hint.sessionId, { sessions: sessionsSvc(), dshHome: dshBase() })
    if (cwd) {
      const { remotePath, machine, mirrorDir } = resolveMirrorForLocal(cwd)
      if (remotePath && machine) {
        return {
          pool: poolForMachine(machine),
          ws: remotePath,
          host: machine.host,
          username: machine.username,
          port: machine.port,
          mirrorDir,
          bound: true,
          local: false,
        }
      }
      const err = new Error(
        'this session is LOCAL — its workspace is not a remote mirror, so there is no remote host to act on. '
        + 'Refusing rather than falling back to the active machine.',
      )
      err.httpStatus = 403
      throw err
    }
    return {
      pool,
      ws: wsPath(),
      host: config.host,
      username: config.username,
      port: config.port,
      mirrorDir: wsPath() ? mirrorDirFor(wsPath(), config.host, config.username, config.port) : null,
      bound: false,
      local: false,
    }
  }

  // ── session-bound remote binding (the authoritative tool path) ─────────────

  /**
   * Resolve the remote binding a tool call must act on, from the calling
   * session's own workspace cwd.
   *
   * This is what keeps concurrent sessions independent: the machine and the
   * workspace root both come from the session's mirror `.dsh-remote-meta.json`,
   * never from the mutable active-machine state, so another session switching
   * machines cannot redirect this call. Sessions on the same machine resolve to
   * the same key and share one pool.
   *
   * @param {object} [exec] - the tool's `ToolRunContext`; `exec.agent.session.header.cwd` identifies the caller.
   * @returns {{pool: SshPool, ws: string, host: string, username: string, port: number, mirrorDir: string|null, bound: boolean, local: boolean}}
   *   `bound` is true only for a session whose cwd resolves to a mirror. A
   *   caller with a cwd that is NOT a mirror is a local session: `local` is
   *   true and the active-machine values are returned for machine-scoped
   *   reporting (`rw_info`) — session-scoped tools must refuse it instead,
   *   which is what {@link requireBinding} enforces.
   */
  const bindingFor = (exec) => {
    const cwd = exec?.agent?.session?.header?.cwd
    if (cwd) {
      const { remotePath, machine, mirrorDir } = resolveMirrorForLocal(String(cwd))
      if (remotePath && machine) {
        return {
          pool: poolForMachine(machine),
          ws: remotePath,
          host: machine.host,
          username: machine.username,
          port: machine.port,
          mirrorDir,
          bound: true,
          local: false,
        }
      }
    }
    return {
      pool,
      ws: wsPath(),
      host: config.host,
      username: config.username,
      port: config.port,
      mirrorDir: wsPath() ? mirrorDirFor(wsPath(), config.host, config.username, config.port) : null,
      bound: false,
      // A caller that identified itself with a cwd, yet resolved to no mirror,
      // is definitively a LOCAL session. Distinguish it from "no caller
      // context at all", where the active machine is still the right answer.
      local: !!cwd,
    }
  }

  /**
   * Binding for a tool that requires a remote workspace, with a diagnostic
   * refusal when none is resolvable. Failing loud here is the point: silently
   * falling back to the active machine is how a command reached the wrong host.
   * @param {object} exec - the tool's `ToolRunContext`.
   * @param {string} tool - tool name, used in the error message.
   * @returns {ReturnType<typeof bindingFor>} a binding with `bound: true`.
   */
  const requireBinding = (exec, tool) => {
    const b = bindingFor(exec)
    // A LOCAL session must be refused even when an active machine happens to
    // have a workspace: inheriting it is precisely how a command reaches a host
    // the caller never asked for. Checking only `!b.ws` missed this, because
    // the active machine's workspace is usually non-empty.
    if (b.local) {
      throw new Error(
        `${tool}: this session is LOCAL — its workspace is not a remote mirror, `
        + 'so there is no remote host to act on. Refusing rather than falling back to the active machine '
        + `(${config.username || '?'}@${config.host || '?'}), which belongs to a different session. `
        + 'Use rw_connect + rw_pick_workspace to bind a remote workspace, then open a session in its local mirror.',
      )
    }
    if (!b.ws) {
      throw new Error(
        `${tool}: no remote workspace set — call rw_connect then rw_pick_workspace first.`,
      )
    }
    if (!b.host) throw new Error(`${tool}: no remote host resolved for this session — run rw_connect first.`)
    return b
  }

  /**
   * Binding for a tool that takes an explicit absolute remote path: it needs a
   * resolvable MACHINE but not a workspace root. A local session is refused for
   * the same reason as {@link requireBinding} — the active machine belongs to
   * whoever set it, not to this caller.
   * @param {object} exec - the tool's `ToolRunContext`.
   * @param {string} tool - tool name, used in the error message.
   * @returns {ReturnType<typeof bindingFor>} a binding whose `host` is non-empty.
   */
  const requireMachine = (exec, tool) => {
    const b = bindingFor(exec)
    if (b.local) {
      throw new Error(
        `${tool}: this session is LOCAL — its workspace is not a remote mirror, `
        + 'so there is no remote host to act on. Refusing rather than falling back to the active machine '
        + `(${config.username || '?'}@${config.host || '?'}), which belongs to a different session.`,
      )
    }
    if (!b.host) throw new Error(`${tool}: no remote host for this session — run rw_connect first`)
    return b
  }
  const status = () => ({
    host: config.host,
    port: config.port,
    username: config.username,
    connected: !!pool.client,
    workspace: toDisplayPath(wsPath(), pool.platform),
    localMirror: wsPath() ? mirrorDirFor(wsPath(), config.host, config.username, config.port) : '',
    currentId: store.currentId || null,
    activeSource: ephemeral ? 'ephemeral' : (store.currentId ? 'machine' : (config.host ? 'config' : 'none')),
    // Issue #13: whether THIS session is in remote mode (cwd inside a mirror).
    // `none`/`local` means the plugin is present but no remote context is
    // active — saved machines stay standby-only.
    sessionMode: sessionRemotePath() ? 'remote' : (store.currentId ? 'standby' : 'local'),
    sessionRemotePath: sessionRemotePath(),
    machines: machines.map(sanitizeMachine),
    hostKeyMode: config.hostKeyMode === 'verify' || config.hostKeyMode === 'off' ? config.hostKeyMode : 'accept-new',
    hostKeyKnown: config.host ? isHostKeyKnown(config.host, config.port) : false,
    forwards: forwards.list(),
    auditEnabled: !!config.auditLog,
    backend: platformBackend(),
    platform: pool.platform,
    shell: pool.shellMode,
    gitBash: pool.gitBashPath || '',
  })

  // ── tools ─────────────────────────────────────────────────────────────────

  const textOut = {
    schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
    render: (_a, v) => [{ type: 'text', text: v.text }],
  }
  const okOut = {
    schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, bytes: { type: 'integer' }, text: { type: 'string' } } },
    render: (_a, a) => [{ type: 'text', text: a.text || (a.ok ? 'ok' : 'failed') }],
  }

  const tools = [
    defineTool({
      name: 'rw_info',
      description:
        'Show the remote environment: host/user/port, connection health, current remote workspace path, active port forwards. Call this first to orient, or when an rw_* call fails to check connectivity. Note: remote context is session-scoped — a saved machine only becomes active when you explicitly rw_connect to it (issue #13).',
      parameters: {},
      output: textOut,
      async execute(_args, exec) {
        // Report THIS session's binding, not the globally active machine: the
        // two differ whenever another session is working on another host, and
        // reporting the active machine is what made this tool contradict itself.
        const b = bindingFor(exec)
        // rw_info is the orientation tool, so resolve the real platform rather
        // than reporting "detecting…" for a pool this session has not used yet.
        if (b.host) {
          try { await b.pool.detect() } catch { /* unreachable host → the ping below reports it */ }
        }
        const s = status()
        const lines = b.bound
          ? [
              `Remote host: ${b.username || '<user>'}@${b.host}:${b.port} (bound to this session's workspace)`,
              `Current remote workspace: ${toDisplayPath(b.ws, b.pool.platform)}`,
              `Local mirror: ${b.mirrorDir || '(none)'}`,
              `Connected: ${b.pool.client ? 'yes' : 'no'}`,
              `Remote shell: ${b.pool.platform === 'windows' ? (b.pool.gitBashPath ? 'Git Bash (' + b.pool.gitBashPath + ')' : 'Windows (Git Bash not found — set config.shell to a bash.exe path)') : (b.pool.platform === 'posix' ? 'native POSIX' : 'detecting…')}`,
              `Active forwards: ${s.forwards.filter((f) => f.active).length} / ${s.forwards.length} (forwards are machine-scoped)`,
              `Host key: ${isHostKeyKnown(b.host, b.port) ? 'trusted' : 'not yet trusted'} (mode=${s.hostKeyMode})`,
              '',
            ]
          : [
              `Remote host: ${s.username || '<user>'}@${s.host || '<host>'}:${s.port}${s.activeSource !== 'machine' ? ` (source: ${s.activeSource})` : ''}`,
              'Session remote context: (this session is LOCAL — no remote workspace bound)',
              `Active machine workspace: ${s.workspace || '(none — call rw_connect then rw_pick_workspace to set one)'}`,
              `Connected: ${s.connected ? 'yes' : 'no'}`,
              `Host key: ${s.hostKeyKnown ? 'trusted' : 'not yet trusted'} (mode=${s.hostKeyMode})`,
              '',
            ]
        if (b.host && b.ws) {
          try {
            const res = await b.pool.exec('echo ok', { timeoutMs: Math.min(config.commandTimeoutMs, 8000) })
            if (res.signal === 'TIMEOUT') lines.push('Ping: timeout')
            else if (res.code === 0) lines.push('Ping: OK — ' + res.stdout.replace(/\s+/g, ' ').trim())
            else lines.push('Ping: FAILED — ' + (res.stderr || res.stdout || `exit ${res.code}`).trim())
          } catch (err) {
            lines.push('Ping: FAILED — ' + friendlyMessage(err, { host: b.host, port: b.port }))
          }
        } else {
          lines.push('No host + workspace configured — call rw_connect with a host to get started.')
        }
        return { text: lines.join('\n') }
      },
    }),

    defineTool({
      name: 'rw_connect',
      description:
        'Connect SSH to a remote host for remote workspace work. Provide host (required), user, optional password or privateKeyPath/port. Defaults to saving the machine to the registry (save=false keeps it as a temporary connection). Once connected, call rw_pick_workspace to pick the workspace directory this session should work in.',
      parameters: {
        host: { type: 'string', required: true, description: 'Remote host IP or hostname' },
        username: { type: 'string', description: 'SSH user (default from config or root)' },
        port: { type: 'integer', description: 'SSH port (default 22)' },
        password: { type: 'string', description: 'SSH password (prefer SSH key when possible)' },
        privateKeyPath: { type: 'string', description: 'Absolute private-key path' },
        save: { type: 'boolean', description: 'Save this machine to the registry and make it current (default true)' },
      },
      output: textOut,
      async execute(args) {
        const host = String(args.host || '').trim()
        if (!host) throw new Error('rw_connect: host is required')
        const user = args.username || config.username || 'root'
        const port = Number(args.port) || undefined
        const rec = {
          host,
          port: port || 22,
          username: user,
          password: args.password !== undefined ? String(args.password) : '',
          privateKeyPath: args.privateKeyPath || '',
        }
        if (args.save !== false) {
          // Upsert into the registry and make it the current machine so the
          // settings UI and the tools always agree on who is active.
          const i = machines.findIndex((m) => m.host === rec.host && m.username === rec.username && Number(m.port) === rec.port)
          if (i >= 0) {
            machines[i] = { ...machines[i], ...rec, id: machines[i].id, password: rec.password || machines[i].password || '' }
            store.currentId = machines[i].id
            saveMachines(machines, store.currentId)
          } else {
            const id = machineId()
            machines.push({ id, name: host, ...rec })
            store.currentId = id
            saveMachines(machines, store.currentId)
          }
          ephemeral = null
          await applyActiveMachine()
        } else {
          ephemeral = { id: machineId(), name: host, ...rec }
          pool.setTarget({
            host, port: port || 22, username: user,
            password: rec.password, privateKeyPath: rec.privateKeyPath,
            workspace: config.workspace,
          })
        }
        try {
          const res = await pool.exec('echo ok', { timeoutMs: 8000 })
          if (res.code !== 0 && !res.stdout) {
            audit('connect', `connect ${user}@${host}:${port || 22}`, res.code)
            return { text: 'connect failed: ' + (res.stderr || 'exit ' + res.code) }
          }
          audit('connect', `connect ${user}@${host}:${port || 22}`, 0)
          return { text: `Connected to ${host} as ${config.username}.\n\npick a workspace with rw_pick_workspace (path=<abs>).` }
        } catch (err) {
          throw new Error(friendlyMessage(err, { host, port }))
        }
      },
    }),

    defineTool({
      name: 'rw_pick_workspace',
      description:
        'Set the remote workspace directory this session should treat as its working root on the connected remote. Verifies it exists (a directory). Use rw_list_dir to browse first if unsure. Accepts POSIX (/home/dev/project) or Windows (C:\\Users\\dev\\project) paths.',
      parameters: {
        path: { type: 'string', required: true, description: 'Absolute remote directory path, e.g. /home/dev/code/project or C:\\Users\\dev\\project' },
      },
      output: textOut,
      async execute(args, exec) {
        const p = normalizeRemotePath(String(args.path || ''))
        if (!p || p === '/') throw new Error('rw_pick_workspace: path must be an absolute directory')
        // Picking a workspace targets the machine this session is already bound
        // to when it has one. A LOCAL session deliberately falls back to the
        // active machine here: this is the setup flow that runs right after
        // rw_connect, before any mirror exists to bind to. It creates a mirror
        // rather than reading or writing remote data, so the refusal that
        // guards the other tools would make binding a first workspace
        // impossible.
        const b = bindingFor(exec)
        if (!b.host) throw new Error('rw_pick_workspace: no remote host — call rw_connect first')
        const ok = await isRemoteDir(p, b.pool)
        const shown = toDisplayPath(p, b.pool.platform)
        if (!ok) return { text: `not a directory (or missing) on ${shown}` }
        // A bound session's workspace lives in its own mirror meta, so the
        // shared active-machine workspace is only updated for the unbound flow.
        if (!b.bound) persistWorkspace(p)
        const local = ensureMirror(p, b.host, b.username, b.port)
        startAutoPush(local)
        return {
          text: `Remote workspace set to ${shown} on ${b.username}@${b.host}.\nLocal mirror (native workspace path): ${local}\n\nRun rw_sync to download its files into the local mirror.`,
        }
      },
    }),

    defineTool({
      name: 'rw_sync',
      description:
        'Download the current remote workspace into its local mirror directory over SFTP (bounded, three-way conflict-aware). Makes the remote files visible/editable locally so the DSH native workspace / fs tools can operate on them. Conflicts (both sides modified) are reported and never overwritten; use force=true to override.',
      parameters: {
        depth: { type: 'integer', description: 'Max directory depth to mirror (default 8)' },
        maxFiles: { type: 'integer', description: 'Max files to download (default 2000)' },
        dryRun: { type: 'boolean', description: 'Compute the plan without downloading (default false)' },
        force: { type: 'boolean', description: 'Overwrite conflicting files (default false)' },
        async: { type: 'boolean', description: 'Run in the background and return a task id (default false)' },
      },
      output: textOut,
      async execute(args, exec) {
        const b = requireBinding(exec, 'rw_sync')
        const p = b.ws
        const local = b.mirrorDir || mirrorDirFor(p, b.host, b.username, b.port)
        mkdirSync(local, { recursive: true })
        const depth = Math.min(Math.max(Number(args.depth) || 8, 1), 16)
        const maxFiles = Math.min(Math.max(Number(args.maxFiles) || 2000, 1), 20000)
        const isIgnored = ignoreMatcher()
        const body = { depth, maxFiles, dryRun: !!args.dryRun, force: !!args.force, isIgnored }
        const runSync = async () => {
          let sftp
          try {
            sftp = await b.pool.sftp()
          } catch (err) {
            throw new Error('sftp unavailable: ' + ((err && err.message) || err))
          }
          const state = loadSyncState(local)
          const { stats, nextState } = await syncTree(sftp, p, local, { ...body, state, maxFileBytes: config.maxFileBytes })
          if (!args.dryRun) saveSyncState(local, nextState)
          let text = `${args.dryRun ? 'WOULD download' : 'Downloaded'} ${stats.files} file(s) from ${p} → ${local}.`
          if (stats.truncated || stats.files >= maxFiles) text += ` TRUNCATED (hit depth=${depth} or maxFiles=${maxFiles} cap; raise maxFiles/depth and re-run).`
          if (stats.skippedUnchanged) text += ` ${stats.skippedUnchanged} unchanged.`
          if (stats.skippedLarge) text += ` ${stats.skippedLarge} too large (over ${config.maxFileBytes} bytes).`
          if (stats.staleRemote) text += ` ${stats.staleRemote} remote entries gone (kept locally; use rw_push to mirror deletions).`
          if (stats.conflicts.length) {
            text += `\n⚠ ${stats.conflicts.length} conflict(s), NOT overwritten:`
            for (const c of stats.conflicts.slice(0, 10)) text += `\n  ${c.path} — ${c.reason}`
            if (stats.conflicts.length > 10) text += `\n  … and ${stats.conflicts.length - 10} more`
            text += '\n(use force=true to override)'
          }
          return { text }
        }
        if (args.async) {
          const t = tasks.start('sync', `sync ${p}`, runSync)
          return { text: `sync started in background: taskId=${t.id} (GET /dsh-remote/task?id=${t.id} for progress)` }
        }
        return runSync()
      },
    }),

    defineTool({
      name: 'rw_push',
      description:
        'Upload the local mirror of the current remote workspace back to the remote host over SFTP (bounded, three-way conflict-aware). Use after editing files in the local mirror so the remote reflects your changes. Conflicts (both sides modified) are reported and never overwritten; use force=true to override.',
      parameters: {
        maxFiles: { type: 'integer', description: 'Max files to upload (default 2000)' },
        dryRun: { type: 'boolean', description: 'Compute the plan without uploading (default false)' },
        force: { type: 'boolean', description: 'Overwrite conflicting files (default false)' },
        async: { type: 'boolean', description: 'Run in the background and return a task id (default false)' },
      },
      output: textOut,
      async execute(args, exec) {
        const b = requireBinding(exec, 'rw_push')
        const p = b.ws
        const local = b.mirrorDir || mirrorDirFor(p, b.host, b.username, b.port)
        if (!existsSync(local)) throw new Error(`rw_push: local mirror does not exist — run rw_sync first (${local})`)
        const maxFiles = Math.min(Math.max(Number(args.maxFiles) || 2000, 1), 20000)
        const isIgnored = ignoreMatcher()
        const body = { maxFiles, dryRun: !!args.dryRun, force: !!args.force, isIgnored }
        const runPush = async () => {
          let sftp
          try {
            sftp = await b.pool.sftp()
          } catch (err) {
            throw new Error('sftp unavailable: ' + ((err && err.message) || err))
          }
          const state = loadSyncState(local)
          const { stats, nextState } = await pushTree(sftp, local, p, { ...body, state, maxFileBytes: config.maxFileBytes })
          if (!args.dryRun) saveSyncState(local, nextState)
          let text = `${args.dryRun ? 'WOULD upload' : 'Uploaded'} ${stats.files} file(s) from ${local} → ${p}.`
          if (stats.truncated || stats.files >= maxFiles) text += ` TRUNCATED (hit maxFiles=${maxFiles} cap; raise maxFiles and re-run).`
          if (stats.skippedUnchanged) text += ` ${stats.skippedUnchanged} unchanged.`
          if (stats.skippedLarge) text += ` ${stats.skippedLarge} too large (over ${config.maxFileBytes} bytes).`
          if (stats.staleLocal) text += ` ${stats.staleLocal} local entries gone remotely (kept remotely; use rw_remove to mirror deletions).`
          if (stats.conflicts.length) {
            text += `\n⚠ ${stats.conflicts.length} conflict(s), NOT overwritten:`
            for (const c of stats.conflicts.slice(0, 10)) text += `\n  ${c.path} — ${c.reason}`
            if (stats.conflicts.length > 10) text += `\n  … and ${stats.conflicts.length - 10} more`
            text += '\n(use force=true to override)'
          }
          return { text }
        }
        if (args.async) {
          const t = tasks.start('push', `push ${p}`, runPush)
          return { text: `push started in background: taskId=${t.id} (GET /dsh-remote/task?id=${t.id} for progress)` }
        }
        return runPush()
      },
    }),

    defineTool({
      name: 'rw_list_dir',
      description:
        'List a remote directory (or a single file) via SSH. Path is absolute; accepts Windows paths like C:\\Users\\dev\\project on Git Bash remotes. If omitted, lists the current remote workspace. Shows type, size, mtime.',
      parameters: {
        path: { type: 'string', description: 'Absolute remote path (default: current remote workspace)' },
      },
      output: textOut,
      async execute(args, exec) {
        const b = requireBinding(exec, 'rw_list_dir')
        const p = args.path ? normalizeRemotePath(String(args.path)) : b.ws
        if (!p) throw new Error('rw_list_dir: no path and no remote workspace set')
        let list
        try {
          const sftp = await b.pool.sftp()
          list = await sftp.readdir(p)
        } catch (err) {
          throw new Error('rw_list_dir: ' + ((err && err.message) || err))
        }
        const fmtMtime = (t) => {
          if (!t) return '?'
          const d = new Date(t * 1000)
          const pad = (n) => String(n).padStart(2, '0')
          return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
        }
        const lines = list
          .filter((e) => String(e.filename) !== '.' && String(e.filename) !== '..')
          .map((e) => {
            const a = e.attrs || {}
            const type = a.isDirectory && a.isDirectory() ? 'd' : (a.isSymbolicLink && a.isSymbolicLink() ? 'l' : '-')
            const size = typeof a.size === 'number' ? String(a.size) : '?'
            return `${type} ${size.padStart(10)} ${fmtMtime(a.mtime).padEnd(17)} ${String(e.filename)}`
          })
        return { text: lines.length ? lines.join('\n') : '(empty directory)' }
      },
    }),

    defineTool({
      name: 'rw_stat',
      description:
        'Show detailed stat of a remote file or directory: type, size, mtime, mode (SFTP attrs). Use to verify a remote path exists or to compare files.',
      parameters: {
        path: { type: 'string', required: true, description: 'Absolute remote path' },
      },
      output: textOut,
      async execute(args, exec) {
        const b = requireMachine(exec, 'rw_stat')
        const p = normalizeRemotePath(String(args.path || ''))
        if (!p) throw new Error('rw_stat: path is required')
        const sftp = await b.pool.sftp()
        let st
        try {
          st = await sftp.stat(p)
        } catch (err) {
          throw new Error('rw_stat: not found or unreadable: ' + ((err && err.message) || err))
        }
        const type = st.isDirectory && st.isDirectory() ? 'directory' : (st.isSymbolicLink && st.isSymbolicLink() ? 'symlink' : 'file')
        const lines = [
          `path: ${p}`,
          `type: ${type}`,
          `size: ${st.size} bytes`,
          `mtime: ${new Date(st.mtime * 1000).toISOString()}`,
          `mode: ${typeof st.mode === 'number' ? st.mode.toString(8) : '?'}`,
        ]
        return { text: lines.join('\n') }
      },
    }),

    defineTool({
      name: 'rw_read_file',
      description:
        'Read a text file on the remote host with line numbers. Supports paging with startLine/endLine and an encoding param (utf-8 default, gbk etc). Path is absolute.',
      parameters: {
        path: { type: 'string', required: true, description: 'Absolute remote file path' },
        startLine: { type: 'integer', description: '1-based first line (default 1)' },
        endLine: { type: 'integer', description: '1-based last line (inclusive)' },
        maxLines: { type: 'integer', description: 'Max lines (default 2000)' },
        encoding: { type: 'string', description: 'Text encoding, e.g. utf-8 (default) or gbk' },
      },
      output: textOut,
      async execute(args, exec) {
        const b = requireMachine(exec, 'rw_read_file')
        const p = normalizeRemotePath(String(args.path || ''))
        if (!p) throw new Error('rw_read_file: path is required')
        const maxLines = Math.min(Math.max(Number(args.maxLines) || 2000, 1), 10000)
        let from = Math.max(Number(args.startLine) || 1, 1)
        let to = Number(args.endLine) || 0
        if (!to || to - from + 1 > maxLines) to = from + maxLines - 1
        const sftp = await b.pool.sftp()
        let st
        try { st = await sftp.stat(p) } catch (err) { throw new Error('rw_read_file: ' + ((err && err.message) || err)) }
        if (config.maxFileBytes > 0 && st.size > config.maxFileBytes) {
          throw new Error(`rw_read_file: file is ${st.size} bytes (over ${config.maxFileBytes} cap); use rw_download or rw_exec to read it`)
        }
        let buf
        try {
          buf = await sftp.readFile(p)
        } catch (err) {
          throw new Error('rw_read_file: ' + ((err && err.message) || err))
        }
        const content = decodeBuf(buf, args.encoding || config.encoding).replace(/\r\n/g, '\n')
        const allLines = content.split('\n')
        const page = allLines.slice(from - 1, to)
        const numbered = page.map((l, i) => `${String(from + i).padStart(6)}\t${l}`).join('\n').replace(/\s+$/, '')
        let text = numbered === '' ? '(empty or out of range)' : numbered
        if (!args.endLine) text += '\n(shown up to ' + maxLines + ' lines; use startLine/endLine to page)'
        return { text }
      },
    }),

    defineTool({
      name: 'rw_write_file',
      description:
        'Write text to a file on the remote host (creating parent directories if needed). Path is absolute. Use this to create or overwrite a remote file directly, instead of round-tripping through a local mirror.',
      parameters: {
        path: { type: 'string', required: true, description: 'Absolute remote file path' },
        content: { type: 'string', required: true, description: 'File content to write (overwrites existing file)' },
        mkdir: { type: 'boolean', description: 'Create missing parent directories (default true)' },
        encoding: { type: 'string', description: 'Text encoding, e.g. utf-8 (default) or gbk' },
      },
      output: okOut,
      async execute(args, exec) {
        const b = requireMachine(exec, 'rw_write_file')
        const p = normalizeRemotePath(String(args.path || ''))
        if (!p || p === '/') throw new Error('rw_write_file: a file path is required')
        const content = String(args.content == null ? '' : args.content)
        const sftp = await b.pool.sftp()
        if (args.mkdir !== false) await mkdirRemoteDirs(sftp, remoteDirname(p))
        const buf = encodeText(content, args.encoding || config.encoding)
        await sftp.writeFile(p, buf)
        const bytes = buf.byteLength
        audit('write_file', `write ${p} (${bytes}B)`, 0, b)
        return { ok: true, bytes, text: `wrote ${bytes} bytes to ${p}` }
      },
    }),

    defineTool({
      name: 'rw_edit',
      description:
        'Edit a remote text file by replacing literal text (read-modify-write with an mtime optimistic lock: aborts if the file changed on the remote between read and write). Path is absolute.',
      parameters: {
        path: { type: 'string', required: true, description: 'Absolute remote file path' },
        old: { type: 'string', required: true, description: 'Literal text to replace (must appear exactly once unless count is given)' },
        new: { type: 'string', required: true, description: 'Replacement text' },
        count: { type: 'integer', description: 'How many occurrences to replace (default: error if the text appears more than once)' },
        encoding: { type: 'string', description: 'Text encoding, e.g. utf-8 (default) or gbk' },
      },
      output: okOut,
      async execute(args, exec) {
        const b = requireMachine(exec, 'rw_edit')
        const p = normalizeRemotePath(String(args.path || ''))
        if (!p || p === '/') throw new Error('rw_edit: a file path is required')
        const oldS = String(args.old ?? '')
        const newS = String(args.new ?? '')
        if (oldS === '') throw new Error('rw_edit: old text must not be empty')
        const sftp = await b.pool.sftp()
        const st0 = await sftp.stat(p)
        const buf = await sftp.readFile(p)
        const content = decodeBuf(buf, args.encoding || config.encoding)
        const count = args.count == null ? 0 : Math.max(Number(args.count) || 1, 1)
        const idxs = []
        let from = 0
        let hit
        while ((hit = content.indexOf(oldS, from)) !== -1) { idxs.push(hit); from = hit + oldS.length }
        if (!idxs.length) throw new Error(`rw_edit: old text not found in ${p}`)
        if (count === 0 && idxs.length > 1) {
          throw new Error(`rw_edit: "old" appears ${idxs.length} times in ${p} — pass count=<n> to pick how many to replace`)
        }
        const n = count === 0 ? 1 : Math.min(count, idxs.length)
        let out = content
        for (let i = n - 1; i >= 0; i--) {
          out = out.slice(0, idxs[i]) + newS + out.slice(idxs[i] + oldS.length)
        }
        // Optimistic lock: the remote must not have changed since we read it.
        const st1 = await sftp.stat(p)
        if (st1.size !== st0.size || st1.mtime !== st0.mtime) {
          throw new Error(`rw_edit: ${p} changed on the remote while editing (conflict) — re-read and retry`)
        }
        await sftp.writeFile(p, encodeText(out, args.encoding || config.encoding))
        audit('edit', `edit ${p} (${n} occurrence(s))`, 0, b)
        return { ok: true, bytes: Buffer.byteLength(out), text: `edited ${p}: replaced ${n} occurrence(s)` }
      },
    }),

    defineTool({
      name: 'rw_append',
      description:
        'Append text to a remote file (creates it when missing). Path is absolute.',
      parameters: {
        path: { type: 'string', required: true, description: 'Absolute remote file path' },
        content: { type: 'string', required: true, description: 'Text to append' },
        encoding: { type: 'string', description: 'Text encoding, e.g. utf-8 (default) or gbk' },
      },
      output: okOut,
      async execute(args, exec) {
        const b = requireMachine(exec, 'rw_append')
        const p = normalizeRemotePath(String(args.path || ''))
        if (!p || p === '/') throw new Error('rw_append: a file path is required')
        const sftp = await b.pool.sftp()
        let existing = ''
        try { existing = decodeBuf(await sftp.readFile(p), args.encoding || config.encoding) } catch { /* new file */ }
        const content = existing + String(args.content ?? '')
        await sftp.writeFile(p, encodeText(content, args.encoding || config.encoding))
        const bytes = Buffer.byteLength(content)
        audit('append', `append ${p}`, 0, b)
        return { ok: true, bytes, text: `appended to ${p} (now ${bytes} bytes)` }
      },
    }),

    defineTool({
      name: 'rw_mkdir',
      description:
        'Create a remote directory (mkdir -p semantics, all levels). Path is absolute.',
      parameters: {
        path: { type: 'string', required: true, description: 'Absolute remote directory path' },
      },
      output: textOut,
      async execute(args, exec) {
        const b = requireMachine(exec, 'rw_mkdir')
        const p = normalizeRemotePath(String(args.path || ''))
        if (!p || p === '/') throw new Error('rw_mkdir: a directory path is required')
        const sftp = await b.pool.sftp()
        await mkdirRemoteDirs(sftp, p)
        audit('mkdir', `mkdir ${p}`, 0, b)
        return { text: `created ${p}` }
      },
    }),

    defineTool({
      name: 'rw_remove',
      description:
        'Delete a remote file (or an empty directory). recursive=true removes a directory tree (bounded). Path is absolute. This is destructive — the agent should confirm intent before calling.',
      parameters: {
        path: { type: 'string', required: true, description: 'Absolute remote path to delete' },
        recursive: { type: 'boolean', description: 'Recursively delete a directory (default false)' },
      },
      output: okOut,
      async execute(args, exec) {
        const b = requireMachine(exec, 'rw_remove')
        const p = normalizeRemotePath(String(args.path || ''))
        if (!p || p === '/') throw new Error('rw_remove: a path is required')
        const sftp = await b.pool.sftp()
        const st = await sftp.stat(p).catch(() => null)
        if (!st) return { ok: false, text: `not found: ${p}` }
        if (st.isDirectory && st.isDirectory()) {
          if (!args.recursive) throw new Error(`rw_remove: ${p} is a directory — pass recursive=true to delete its tree`)
          const removed = await removeRemoteTree(sftp, p)
          audit('remove', `remove -r ${p}`, 0, b)
          return { ok: true, text: `removed ${removed} entries under ${p}` }
        }
        await sftp.unlink(p)
        audit('remove', `remove ${p}`, 0, b)
        return { ok: true, text: `removed ${p}` }
      },
    }),

    defineTool({
      name: 'rw_move',
      description:
        'Rename or move a remote file/directory (SFTP rename, same filesystem). Paths are absolute.',
      parameters: {
        path: { type: 'string', required: true, description: 'Current absolute remote path' },
        dest: { type: 'string', required: true, description: 'Destination absolute remote path' },
      },
      output: textOut,
      async execute(args, exec) {
        const b = requireMachine(exec, 'rw_move')
        const p = normalizeRemotePath(String(args.path || ''))
        const d = normalizeRemotePath(String(args.dest || ''))
        if (!p || !d || p === '/') throw new Error('rw_move: both path and dest are required')
        const sftp = await b.pool.sftp()
        await mkdirRemoteDirs(sftp, remoteDirname(d))
        await sftp.rename(p, d)
        audit('move', `move ${p} → ${d}`, 0, b)
        return { text: `moved ${p} → ${d}` }
      },
    }),

    defineTool({
      name: 'rw_exec',
      description:
        'Run a shell command on the remote host. Use for anything that is not reading a file (build, test, grep, etc). Output is capped. Runs in the current remote workspace by default; pass cwd to run elsewhere. pty=true helps interactive commands (sudo prompts, REPLs); env sets environment variables.',
      parameters: {
        command: { type: 'string', required: true, description: 'Shell command (run on the remote host)' },
        cwd: { type: 'string', description: 'Working directory for the command (default: the current remote workspace)' },
        pty: { type: 'boolean', description: 'Allocate a pseudo-terminal (interactive commands, default false)' },
        env: { type: 'object', additionalProperties: true, description: 'Extra environment variables (string values)' },
      },
      output: textOut,
      async execute(args, exec) {
        const b = requireBinding(exec, 'rw_exec')
        const cmd = String(args.command || '')
        if (!cmd) throw new Error('rw_exec: command is required')
        const ws = b.ws
        const cwd = args.cwd ? normalizeRemotePath(String(args.cwd)) : (ws || '')
        let full = cmd
        if (cwd) {
          // Detect before choosing the cwd form: a per-machine pool starts
          // undetected, and reading `platform` first would skip the Git Bash
          // mount-path rewrite on the first command sent to a Windows host.
          // detect() is cached and idempotent, so this costs one probe per pool.
          try { await b.pool.detect() } catch { /* probe failed → fall through to the POSIX form */ }
          if (b.pool.platform === 'windows' && b.pool.gitBashPath) {
            // Git Bash terminal: cd in the /c/Users/… mount form
            full = `cd ${shq(toShellPath(cwd))} && ${cmd}`
          } else if (!cwd.includes('\\')) {
            full = `cd ${shq(cwd)} && ${cmd}`
          }
        }
        try {
          const res = await b.pool.exec(full, { timeoutMs: config.commandTimeoutMs, pty: !!args.pty, env: args.env })
          audit('exec', cmd, res.code, b)
          const parts = []
          if (res.stdout) parts.push(res.stdout.replace(/\s+$/, ''))
          if (res.stderr) parts.push('-- stderr --\n' + res.stderr.replace(/\s+$/, ''))
          if (!parts.length) parts.push('(no output)')
          let text = parts.join('\n')
          if (res.signal === 'TIMEOUT') text += `\n[command timed out after ${config.commandTimeoutMs}ms]`
          else if (res.code !== 0) text += `\n[exit code: ${res.code}]`
          return { text }
        } catch (err) {
          throw new Error(friendlyMessage(err, { host: b.host, port: b.port }))
        }
      },
    }),

    defineTool({
      name: 'rw_search',
      description:
        'Search remote files for a pattern. POSIX remotes try `rg` then `grep -R` first; Windows and fallbacks use a portable SFTP walk. Honors ignore rules. Returns matching file:line rows; output is capped.',
      parameters: {
        pattern: { type: 'string', required: true, description: 'Pattern to search for (extended regex)' },
        path: { type: 'string', description: 'Directory to search (default: current remote workspace)' },
        glob: { type: 'string', description: 'Only files whose NAME matches this glob, e.g. *.ts (optional)' },
        ignoreCase: { type: 'boolean', description: 'Case-insensitive search (default true)' },
        contextLines: { type: 'integer', description: 'Lines of context around each match (default 0)' },
        maxMatches: { type: 'integer', description: 'Max matches to return (default 500)' },
      },
      output: textOut,
      async execute(args, exec) {
        const b = requireBinding(exec, 'rw_search')
        const pattern = String(args.pattern || '')
        if (!pattern) throw new Error('rw_search: pattern is required')
        const ws = b.ws
        const dir = args.path ? normalizeRemotePath(String(args.path)) : (ws || '')
        if (!dir) throw new Error('rw_search: no path and no remote workspace set')
        let regex
        try {
          regex = new RegExp(pattern, args.ignoreCase === false ? '' : 'i')
        } catch (err) {
          throw new Error('rw_search: bad pattern: ' + ((err && err.message) || err))
        }
        const maxMatches = Math.min(Math.max(Number(args.maxMatches) || 500, 1), 2000)
        const matcher = ignoreMatcher()
        const { matches, scanned, truncated } = await searchRemote(b.pool, dir, {
          pattern,
          regex,
          glob: args.glob,
          ignoreCase: args.ignoreCase !== false,
          contextLines: Math.min(Math.max(Number(args.contextLines) || 0, 0), 10),
          maxMatches,
          maxScanBytes: Math.min(config.maxFileBytes || 1024 * 1024, 1024 * 1024),
          isIgnored: (name, isDir) => matcher(name, isDir),
          timeoutMs: config.commandTimeoutMs,
        })
        if (!matches.length) return { text: `no matches for /${pattern}/ in ${dir} (${scanned} files scanned)` }
        let text = matches.map((m) => `${m.path}:${m.line}: ${m.text}`).join('\n')
        text += `\n(${matches.length} match(es), ${scanned} files scanned${truncated ? ', TRUNCATED' : ''})`
        return { text: truncate(text, config.maxOutputChars) }
      },
    }),

    defineTool({
      name: 'rw_download',
      description:
        'Download a single remote file over SFTP into the local mirror of the current workspace (or to an explicit local path). Use when you need the actual file content locally, not just its text. Streams to disk (fastGet).',
      parameters: {
        path: { type: 'string', required: true, description: 'Absolute remote file path' },
        localPath: { type: 'string', description: 'Local destination (default: the workspace mirror, preserving the relative path)' },
      },
      output: okOut,
      async execute(args, exec) {
        const b = requireMachine(exec, 'rw_download')
        const p = normalizeRemotePath(String(args.path || ''))
        if (!p || p === '/') throw new Error('rw_download: a remote file path is required')
        const sftp = await b.pool.sftp()
        let local
        if (args.localPath) {
          local = path.resolve(String(args.localPath))
        } else {
          const ws = b.ws
          if (!ws) throw new Error('rw_download: no remote workspace set — pass localPath explicitly')
          const base = mirrorDirFor(ws, b.host, b.username, b.port)
          const rel = p.startsWith(ws) ? p.slice(ws.length).replace(/^\/+/, '') : p.slice(1)
          local = path.join(base, rel)
        }
        mkdirSync(path.dirname(local), { recursive: true })
        const st = await sftp.stat(p).catch(() => null)
        if (config.maxFileBytes > 0 && st && st.size > config.maxFileBytes) {
          throw new Error(`rw_download: file is ${st.size} bytes (over ${config.maxFileBytes} cap)`)
        }
        await sftp.fastGet(p, local)
        const bytes = existsSync(local) ? statSync(local).size : 0
        return { ok: true, bytes, text: `downloaded ${bytes} bytes from ${p} → ${local}` }
      },
    }),

    defineTool({
      name: 'rw_upload',
      description:
        'Upload a local file over SFTP to a path on the remote host (creating parent directories if needed). Use to push a local file directly, without a full rw_push of the whole mirror.',
      parameters: {
        localPath: { type: 'string', required: true, description: 'Absolute local file path' },
        path: { type: 'string', required: true, description: 'Absolute remote destination path' },
      },
      output: okOut,
      async execute(args, exec) {
        const b = requireMachine(exec, 'rw_upload')
        const rp = normalizeRemotePath(String(args.path || ''))
        const lp = String(args.localPath || '')
        if (!rp || rp === '/' || !lp) throw new Error('rw_upload: both localPath and a remote path are required')
        if (!existsSync(lp)) throw new Error(`rw_upload: local file not found: ${lp}`)
        const sftp = await b.pool.sftp()
        await mkdirRemoteDirs(sftp, remoteDirname(rp))
        const st = statSync(lp)
        await sftp.fastPut(lp, rp)
        audit('upload', `upload ${lp} → ${rp}`, 0, b)
        return { ok: true, bytes: st.size, text: `uploaded ${st.size} bytes from ${lp} → ${rp}` }
      },
    }),

    defineTool({
      name: 'rw_forward',
      description:
        'Manage SSH port forwards. Direction "local" listens on 127.0.0.1:<listenPort> on THIS machine and forwards connections through SSH to <targetHost>:<targetPort> on the remote. Direction "reverse" asks the REMOTE to listen on 127.0.0.1:<listenPort> and pipes connections back to <targetHost>:<targetPort> on this machine. Call with a listenPort to create+start; with remove=true to delete.',
      parameters: {
        listenPort: { type: 'integer', required: true, description: 'Port to listen on (local for direction=local, remote for direction=reverse)' },
        targetHost: { type: 'string', description: 'Forward target host (default 127.0.0.1)' },
        targetPort: { type: 'integer', description: 'Forward target port (default: same as listenPort)' },
        direction: { type: 'string', description: 'local (default) or reverse' },
        autoStart: { type: 'boolean', description: 'Restart this forward automatically on future connects (default false)' },
        remove: { type: 'boolean', description: 'Remove an existing forward by listenPort (default false)' },
      },
      output: textOut,
      async execute(args) {
        const port = Number(args.listenPort)
        if (!port || port < 1 || port > 65535) throw new Error('rw_forward: a valid listenPort is required')
        const dir = args.direction === 'reverse' ? 'reverse' : 'local'
        const existing = forwards.list().find((f) => Number(f.listenPort) === port && f.direction === dir)
        if (args.remove) {
          if (!existing) return { text: `no forward on port ${port} to remove` }
          forwards.remove(existing.id)
          return { text: `removed ${existing.direction} forward on port ${port}` }
        }
        if (existing && existing.active) return { text: `already active: ${existing.direction} forward 127.0.0.1:${port} → ${existing.targetHost}:${existing.targetPort}` }
        const d = existing || forwards.define({
          direction: dir,
          listenPort: port,
          targetHost: args.targetHost || '127.0.0.1',
          targetPort: Number(args.targetPort) || port,
          autoStart: !!args.autoStart,
          machineId: store.currentId,
        })
        const r = await forwards.start(d)
        audit('forward', `${d.direction} forward ${port} → ${d.targetHost}:${d.targetPort}`, r.ok ? 0 : 1)
        if (!r.ok) throw new Error(r.error)
        return { text: `${d.direction} forward active: 127.0.0.1:${port} → ${d.targetHost}:${d.targetPort} (id=${d.id})` }
      },
    }),

    defineTool({
      name: 'rw_disconnect',
      description:
        "Close this session's SSH connection to its remote host, releasing the persistent pool. Useful to rotate a connection or after a long idle. Sessions bound to other machines keep their own connections.",
      parameters: {},
      output: okOut,
      async execute(_args, exec) {
        // Close the connection THIS session actually uses: closing the
        // active-machine pool instead would look like a no-op to a bound
        // session while disconnecting whichever machine happened to be active.
        const b = bindingFor(exec)
        b.pool.close()
        if (!b.bound) return { ok: true, text: 'disconnected the active machine (forwards stopped)' }
        return { ok: true, text: `disconnected ${b.username}@${b.host}:${b.port} for this session` }
      },
    }),
  ]

  for (const t of tools) {
    ctx.tools.register(t)
  }

  // ── system-prompt injection: session-aware remote workspace ──────────────
  // Issue #13: remote context must be SESSION-scoped, not machine-global.
  // The section text is evaluated per assembly with the current agent's
  // session; it is injected ONLY when that session's cwd actually maps to a
  // dsh-remote mirror (i.e. the user picked a remote workspace as the session
  // workspace). A plain local session gets no remote section — saved machines
  // never leak their workspace into an unrelated local session's prompt.
  // (resolveMirrorForLocal is defined above, next to wsPath.)
  ctx.systemPrompt.section({
    name: 'dsh-remote',
    order: 88,
    text: (promptContext) => {
      const agent = promptContext && promptContext.agent
      const session = agent && agent.session
      const cwd = session && session.header && session.header.cwd
      if (!cwd) return '' // no session cwd → nothing to map → stay quiet
      const { remotePath, machine } = resolveMirrorForLocal(cwd)
      if (!remotePath) return '' // this session is NOT a remote session (issue #13)
      // Name the machine the MIRROR records, not the active one: pairing this
      // session's remote path with whichever machine happens to be active
      // states a host/path combination that may not exist (issue #25).
      const who = machine
        ? `${machine.username || 'user'}@${machine.host}`
        : `${config.username || 'user'}@${config.host}`
      const platform = machine ? poolForMachine(machine).platform : pool.platform
      const fwd = forwards.list().filter((f) => f.active).map((f) => `${f.direction}:127.0.0.1:${f.listenPort}→${f.targetHost}:${f.targetPort}`)
      let extra = ''
      if (fwd.length) extra = `\nActive port forwards: ${fwd.join(', ')}`
      return (
        '## Remote workspace\n' +
        `Current remote workspace: ${who}:${toDisplayPath(remotePath, platform)}\n` +
        'Use the rw_* tools (rw_list_dir / rw_read_file / rw_write_file / rw_edit / rw_exec / rw_search / rw_sync / rw_push) to inspect and act on files on the remote host. Treat this directory as the working root for this task.' +
        extra
      )
    },
  })

  // ── slash commands ─────────────────────────────────────────────────────────
  const commands = ctx.get('commands')
  if (commands !== undefined) {
    commands.register({
      name: 'remote',
      description: 'Show the current remote workspace / connection status, active forwards, and how to use remote tools.',
      handler: (invocation) => {
        const s = status()
        const fwd = s.forwards.filter((f) => f.active)
        return {
          kind: 'success',
          text:
            `Remote host: ${s.username}@${s.host || '<none>'} (connected: ${s.connected}, source: ${s.activeSource})\n` +
            `Remote workspace: ${s.workspace || '(none)'}\n` +
            `Host key: ${s.hostKeyKnown ? 'trusted ✓' : 'not yet trusted'} (mode=${s.hostKeyMode})\n` +
            (s.hostKeyKnown ? `  — if the key changed / was mistrusted, run /remote-forget-key\n` : '') +
            (fwd.length ? `Active forwards:\n${fwd.map((f) => `  ${f.direction} 127.0.0.1:${f.listenPort} → ${f.targetHost}:${f.targetPort}`).join('\n')}\n` : '') +
            `\nUse tools: rw_list_dir / rw_read_file / rw_edit / rw_exec / rw_search / rw_forward.` +
            (s.workspace ? `\nCurrently working in ${s.workspace}.` : ''),
        }
      },
    })
    commands.register({
      name: 'remote-forget-key',
      description: 'Drop the trusted host-key record for the current machine so the next connect re-records it.',
      handler: () => {
        createHostKeyGuard(config, knownHostsFile()).forgetHost()
        return { kind: 'success', text: `forgot host key for ${config.host || '<none>'}:${config.port} — the next connect will re-record it.` }
      },
    })
    commands.register({
      name: 'remote-ignore',
      description: 'Show the mirror ignore rules file location and the current default patterns (gitignore syntax).',
      handler: () => {
        return {
          kind: 'success',
          text:
            `Ignore file: ${ignoreFile()}\n(defaults merged with the file; gitignore syntax, '#' comments)\n\nDefault patterns:\n${DEFAULT_IGNORE.map((p) => '  ' + p).join('\n')}`,
        }
      },
    })
  }

  // ── JSON endpoints for settings UI ─────────────────────────────────────────
  const sendJson = (res, status, body) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(body))
  }
  const MAX_BODY_BYTES = 1024 * 1024
  const readBody = async (req, res) => {
    try {
      return await readBodyLimited(req, MAX_BODY_BYTES, { res })
    } catch {
      // Oversized or truncated bodies keep the old behavior: routes see '{}' and
      // answer their own 400/JSON errors instead of a rejected handler.
      return '{}'
    }
  }

  /** Parse a JSON *object* request body.
   *
   * Throws an Error carrying `httpStatus: 400` when the body is not valid JSON
   * or not an object, so a route can answer `400 + {ok:false, error}` instead of
   * rejecting the handler — a rejected handler makes dsh-host-webserver reply
   * with an empty 400 that carries neither Content-Type nor a reason, which is
   * exactly the "everything is just HTTP 400" symptom of issue #30. */
  const parseJsonObject = (raw) => {
    let parsed
    try {
      parsed = JSON.parse(raw || '{}')
    } catch (e) {
      const err = new Error(`请求体不是合法 JSON：${String((e && e.message) || e)}`)
      err.httpStatus = 400
      throw err
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const err = new Error('请求体必须是一个 JSON 对象')
      err.httpStatus = 400
      throw err
    }
    return parsed
  }

  // ── 本机目录选择器：DSH directoryPicker 服务优先，缺位/非原生则自持兜底 ──
  const PICK_TIMEOUT_MS = 120000
  const runPick = (bin, args) =>
    new Promise((resolve, reject) => {
      execFile(bin, args, { timeout: PICK_TIMEOUT_MS, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
        if (err) {
          const code = err.code
          const msg = String(stderr || '')
          if (code === 1 && /(?:user canceled|-128)/i.test(msg)) return resolve({ cancelled: true })
          if (err.signal || err.killed) return reject(new Error('目录选择已超时，请重试或直接在输入框填本地路径'))
          if (code === 'ENOENT') return reject(Object.assign(new Error('未找到目录选择器程序 ' + bin), { code }))
          return reject(new Error((msg.trim() || (err && err.message) || '无法打开系统文件夹选择器').split('\n')[0]))
        }
        const p = String(stdout || '').replace(/[\r\n]+$/, '').trim()
        resolve(p === 'CANCELED' ? { cancelled: true } : (p ? { path: p } : { cancelled: true }))
      })
    })
  const pickLocalNative = async () => {
    const platform = process.platform
    if (platform === 'darwin') {
      return runPick('osascript', ['-e', 'set selectedFolder to choose folder with prompt "Select Workspace Directory"', '-e', 'POSIX path of selectedFolder'])
    }
    if (platform === 'linux') {
      try {
        return await runPick('zenity', ['--file-selection', '--directory', '--title=Select Workspace Directory'])
      } catch (err) {
        if (err && err.code === 'ENOENT') return runPick('kdialog', ['--getexistingdirectory', '.', '--title', 'Select Workspace Directory'])
        throw err
      }
    }
    if (platform === 'win32') {
      const script =
        `Add-Type -AssemblyName System.Windows.Forms;` +
        `$f = New-Object System.Windows.Forms.FolderBrowserDialog;` +
        `$f.Description = 'Select Workspace Directory';` +
        `if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $f.SelectedPath } else { 'CANCELED' }`
      return runPick('powershell', ['-NoProfile', '-STA', '-Command', script])
    }
    throw new Error('当前系统不支持自动打开目录选择器，请在输入框直接填本地路径')
  }

  /** The ctx.directoryPicker capability object, or null when the service is
   * absent/unusable. Never throws — callers fall through to pickLocalNative. */
  const localPickCapability = async () => {
    const dp = (ctx && typeof ctx.get === 'function') ? (ctx.get('directoryPicker') || null) : null
    if (!dp || typeof dp.capability !== 'function') return null
    try {
      return await Promise.resolve(dp.capability())
    } catch {
      return null
    }
  }

  /** Windows has no single filesystem root — enumerate fixed/mapped drive
   * letters so the in-app browser can switch between them (the browse
   * backend's crumbs stop at the current drive's root). Empty on POSIX. */
  const listLocalDrives = () => {
    if (process.platform !== 'win32') return []
    const out = []
    for (let i = 67; i <= 90; i++) { // C..Z (A/B are legacy floppy — skip)
      const root = String.fromCharCode(i) + ':\\'
      try {
        statSync(root)
        out.push({ name: root.slice(0, -1), path: root })
      } catch { /* Absent or inaccessible drive letters are omitted from the drive picker. */ }
    }
    return out
  }

  // ── route helpers ─────────────────────────────────────────────────────────
  const routes = [
    {
      kind: 'exact',
      path: '/dsh-remote/status',
      handler: async (req, res) => {
        if (req.method === 'GET') {
          const q = new URL(req.url, 'http://localhost').searchParams
          const sessionId = q.get('sessionId') ? decodeURIComponent(q.get('sessionId')) : ''
          // Per-session remote context (issue #13): when a sessionId is given,
          // sessionMode reflects THAT session's cwd, not the machine default.
          if (!sessionId) return sendJson(res, 200, status())
          const cwd = sessionCwd(sessionId)
          const resolved = cwd ? resolveMirrorForLocal(cwd) : { remotePath: '', machine: null }
          const extra = {
            sessionMode: resolved.remotePath ? 'remote' : 'local',
            sessionRemotePath: resolved.remotePath || '',
            sessionBound: !!(resolved.machine && resolved.remotePath),
          }
          if (resolved.machine && resolved.remotePath) {
            const p = poolForMachine(resolved.machine)
            extra.host = resolved.machine.host
            extra.username = resolved.machine.username
            extra.port = resolved.machine.port
            extra.workspace = toDisplayPath(resolved.remotePath, p.platform)
            // Bound sessions are allowed to list/read even if this process has
            // not yet opened a socket — /ls connects on demand.
            extra.connected = true
          }
          return sendJson(res, 200, { ...status(), ...extra })
        }
        sendJson(res, 405, { error: 'method not allowed' })
      },
    },
    {
      // Map a LOCAL path (typically a session cwd that sits inside a remote
      // mirror dir) to the remote path it mirrors, by reading each mirror
      // dir's .dsh-remote-meta.json. NO machine-workspace fallback (issue #13):
      // a session whose cwd is not inside any mirror is a pure LOCAL session —
      // the sidebar must show "no remote workspace", never another machine's
      // remembered default.
      // Accepts either ?local=<abs path> or ?sessionId=<id> (resolved via
      // the host sessions service header.cwd).
      kind: 'exact',
      path: '/dsh-remote/resolve-mirror',
      handler: async (req, res) => {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
        try {
          const q = new URL(req.url, 'http://localhost').searchParams
          let local = q.get('local') ? decodeURIComponent(q.get('local')) : ''
          const sessionId = q.get('sessionId') ? decodeURIComponent(q.get('sessionId')) : ''
          let resolvedVia = 'query'
          if (!local && sessionId) {
            // 1) Live in-memory session header (active sessions only).
            try {
              const sessions = ctx && typeof ctx.get === 'function' ? ctx.get('sessions') : null
              const session = sessions && typeof sessions.get === 'function' ? sessions.get(sessionId) : null
              const header = session && session.header ? session.header : null
              if (header && header.cwd) {
                local = String(header.cwd)
                resolvedVia = 'session'
              }
            } catch { /* sessions service unavailable */ }
            // 2) Durable session log header (works for historical sessions too):
            //    walk $DSH_HOME/sessions/<projectKey>/<sessionId>/session.jsonl.zstd
            //    and read the header line (first zstd frame) for cwd.
            if (!local) {
              try {
                const sessionsRoot = path.join(dshBase(), 'sessions')
                if (existsSync(sessionsRoot)) {
                  const targetDir = encodeSegmentSafe(sessionId)
                  for (const projDir of readdirSync(sessionsRoot)) {
                    const projPath = path.join(sessionsRoot, projDir)
                    if (!statSync(projPath, { throwIfNoEntry: false })?.isDirectory?.()) continue
                    const sessDir = path.join(projPath, targetDir)
                    if (!statSync(sessDir, { throwIfNoEntry: false })?.isDirectory?.()) continue
                    const logFile = ['session.jsonl.zstd', 'session.jsonl', 'session.jsonl.gz'].map((n) => path.join(sessDir, n)).find((p) => existsSync(p))
                    if (!logFile) continue
                    const cwd = readSessionHeaderCwd(logFile)
                    if (cwd) {
                      local = cwd
                      resolvedVia = 'session-log'
                      break
                    }
                  }
                }
              } catch { /* session log scan failed */ }
            }
          }
          const root = remoteWorkspacesRoot()
          const norm = (p) => path.resolve(String(p || '')).replace(/[\\/]+$/, '') || ''
          let matched = ''
          let matchedRemote = ''
          if (local && existsSync(root)) {
            const base = norm(local)
            for (const hostDir of readdirSync(root)) {
              const hostPath = path.join(root, hostDir)
              if (!statSync(hostPath, { throwIfNoEntry: false })?.isDirectory?.()) continue
              for (const mirrorDir of readdirSync(hostPath)) {
                const metaPath = path.join(hostPath, mirrorDir, '.dsh-remote-meta.json')
                if (!existsSync(metaPath)) continue
                try {
                  const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
                  const mirrorAbs = norm(path.join(hostPath, mirrorDir))
                  // Exact mirror dir match, or the local path is inside the mirror dir.
                  if (mirrorAbs === base || base.startsWith(mirrorAbs + path.sep) || base.startsWith(mirrorAbs + '/')) {
                    if (mirrorAbs.length > matched.length) {
                      matched = mirrorAbs
                      matchedRemote = String(meta.remotePath || '')
                    }
                  }
                } catch { /* skip unparsable meta */ }
              }
            }
          }
          // Issue #13: a non-mirror session is LOCAL — remotePath stays empty.
          const remotePath = matchedRemote || ''
          return sendJson(res, 200, {
            local, remotePath, mirrorDir: matched || null,
            // `fallback:true` now means "this session is NOT a remote session"
            // (used to mean "fell back to machine workspace").
            fallback: !matchedRemote,
            mode: matchedRemote ? 'remote' : 'local',
            resolvedVia,
          })
        } catch (err) {
          return sendJson(res, 500, { error: String((err && err.message) || err) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/dsh-remote/connect',
      handler: async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
        // Issue #30: `payload` is declared OUTSIDE the try block on purpose.
        // A `const payload` inside `try` is scoped to that block, so the catch
        // below used to throw `ReferenceError: payload is not defined` BEFORE
        // it could send anything — the webserver then turned the rejected
        // handler into an empty HTTP 400 and the real reason never reached the
        // UI. Hoisting it (and defaulting to {}) makes the failure path total:
        // this handler now always answers with JSON.
        let payload = {}
        try {
          payload = parseJsonObject(await readBody(req, res))
          pool.setTarget({
            host: payload.host,
            port: payload.port,
            username: payload.username,
            password: payload.password !== undefined && payload.password !== '' ? payload.password : undefined,
            privateKeyPath: payload.privateKeyPath,
            workspace: payload.workspace,
          })
          await pool.exec('echo ok', { timeoutMs: Math.min(config.commandTimeoutMs, 8000) })
          return sendJson(res, 200, { ok: true, ...status() })
        } catch (err) {
          return sendJson(res, (err && err.httpStatus) || 500, { ok: false, error: friendlyMessage(err, { host: payload.host, port: payload.port }) })
        }
      },
    },
    ...createFsRoutes({
      sendJson, readBody, resolveRequestBinding, decodeBuf, encodeText, audit, config, mirrorDirFor,
    }),

    {
      kind: 'exact',
      path: '/dsh-remote/workspace',
      handler: async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
        try {
          const payload = JSON.parse((await readBody(req, res)) || '{}')
          const p = normalizeRemotePath(String(payload.path || ''))
          if (!p || p === '/') return sendJson(res, 400, { error: 'path must be an absolute directory' })
          const okDir = await isRemoteDir(p)
          if (!okDir) return sendJson(res, 400, { ok: false, error: `not a directory: ${p}` })
          persistWorkspace(p)
          const local = ensureMirror(p, config.host, config.username, config.port)
          startAutoPush(local)
          return sendJson(res, 200, { ok: true, workspace: p, localMirror: local, ...status() })
        } catch (err) {
          return sendJson(res, 500, { ok: false, error: String((err && err.message) || err) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/dsh-remote/mirror',
      handler: async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
        try {
          const payload = JSON.parse((await readBody(req, res)) || '{}')
          const p = normalizeRemotePath(String(payload.path || ''))
          if (!p || p === '/') return sendJson(res, 400, { ok: false, error: 'path must be an absolute directory' })
          if (!config.host) return sendJson(res, 400, { ok: false, error: 'no remote host configured/connected — connect first' })
          const okDir = await isRemoteDir(p)
          if (!okDir) return sendJson(res, 400, { ok: false, error: `not a directory (or unreachable): ${p}` })
          const local = ensureMirror(p, config.host, config.username, config.port)
          persistWorkspace(p)
          startAutoPush(local)
          return sendJson(res, 200, { ok: true, path: p, localMirror: local, ...status() })
        } catch (err) {
          return sendJson(res, 500, { ok: false, error: String((err && err.message) || err) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/dsh-remote/local-pick',
      handler: async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
        try {
          let outcome = null
          let via = 'service'
          const cap = await localPickCapability()
          if (cap && cap.kind === 'native' && typeof cap.pick === 'function') {
            try {
              const pickAbort = new AbortController()
              const p = await Promise.resolve(cap.pick(pickAbort.signal || null))
              pickAbort.abort()
              outcome = (typeof p === 'string' && p) ? { path: p } : { cancelled: true }
            } catch (err) {
              outcome = null
            }
          }
          // Prefer a REAL OS dialog over the browse backend: operators expect
          // an Explorer-style chooser, and the own spawn (PowerShell
          // FolderBrowserDialog / osascript / zenity-kdialog) works even where
          // the host mounted browse — DSH Desktop (Electron) deliberately
          // mounts browse on win32 because the native backend's koffi dialog
          // worker cannot run under Electron, but a plain child process can.
          if (!outcome) {
            via = 'own'
            try {
              outcome = await pickLocalNative()
            } catch (err) {
              // No usable OS dialog (headless host, missing chooser binary):
              // fall back to the host's browse capability — fs-only, works
              // display-less — served as an in-app browser by the client
              // (backed by /dsh-remote/local-list + /dsh-remote/local-mkdir).
              if (cap && cap.kind === 'browse' && typeof cap.list === 'function') {
                return sendJson(res, 200, { ok: true, kind: 'browse', via: 'browse' })
              }
              return sendJson(res, 500, { ok: false, error: String((err && err.message) || err) + ' — 可直接在输入框填本地路径' })
            }
          }
          if (outcome.cancelled) return sendJson(res, 200, { ok: true, cancelled: true, via })
          return sendJson(res, 200, { ok: true, path: outcome.path, via })
        } catch (err) {
          return sendJson(res, 500, { ok: false, error: String((err && err.message) || err) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/dsh-remote/local-list',
      handler: async (req, res) => {
        if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
        try {
          const cap = await localPickCapability()
          if (!cap || cap.kind !== 'browse' || typeof cap.list !== 'function') return sendJson(res, 400, { ok: false, error: '当前目录选择器不是浏览后端，无法列出本机目录' })
          const m = (req.url || '').match(/path=([^&]*)/)
          const raw = m ? decodeURIComponent(m[1]) : ''
          // No path → the browse backend lists the host home directory.
          try {
            const out = await Promise.resolve(cap.list(raw ? raw : undefined))
            return sendJson(res, 200, { ok: true, ...out, drives: listLocalDrives() })
          } catch (listErr) {
            return sendJson(res, 400, { ok: false, error: String((listErr && listErr.message) || listErr), code: (listErr && listErr.code) || 'directory-unreadable' })
          }
        } catch (err) {
          return sendJson(res, 500, { ok: false, error: String((err && err.message) || err) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/dsh-remote/local-mkdir',
      handler: async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
        try {
          const cap = await localPickCapability()
          if (!cap || cap.kind !== 'browse' || typeof cap.createDirectory !== 'function') return sendJson(res, 400, { ok: false, error: '当前目录选择器不是浏览后端，无法新建文件夹' })
          const payload = JSON.parse((await readBody(req, res)) || '{}')
          const p = String(payload.path || '')
          const name = String(payload.name || '')
          if (!p.trim() || !name.trim()) return sendJson(res, 400, { ok: false, error: 'path and name required' })
          try {
            const created = await Promise.resolve(cap.createDirectory(p, name))
            return sendJson(res, 200, { ok: true, path: created })
          } catch (mkErr) {
            return sendJson(res, 400, { ok: false, error: String((mkErr && mkErr.message) || mkErr), code: (mkErr && mkErr.code) || 'directory-create-failed' })
          }
        } catch (err) {
          return sendJson(res, 500, { ok: false, error: String((err && err.message) || err) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/dsh-remote/machines',
      handler: async (req, res) => {
        if (req.method === 'GET') {
          return sendJson(res, 200, { machines: machines.map(sanitizeMachine), currentId: store.currentId })
        }
        if (req.method === 'POST') {
          try {
            const body = JSON.parse((await readBody(req, res)) || '{}')
            const action = body.action || 'add'
            let warning = ''
            let warningDetail = ''
            if (action === 'add' || action === 'update') {
              const host = String(body.host || '').trim()
              if (!host) return sendJson(res, 400, { ok: false, error: 'host required' })
              const id = body.id || machineId()
              const i = machineIndex(id)
              const prev = i >= 0 ? machines[i] : null
              const credBackend = body.credentialBackend === 'plain' ? 'plain'
                : (body.encryptPassword ? platformBackend() : (prev && prev.credentialBackend ? prev.credentialBackend : 'plain'))
              const rec = {
                id,
                name: String(body.name || '').trim() || host,
                host,
                port: Number(body.port) || 22,
                username: String(body.username || '').trim() || 'root',
                password: '',
                privateKeyPath: String(body.privateKeyPath || '').trim(),
                passphrase: body.passphrase || '',
                workspace: String(body.workspace || '').trim(),
                hostKeyMode: body.hostKeyMode || '',
                useAgent: !!body.useAgent,
                keyboardInteractive: !!body.keyboardInteractive,
                proxy: body.proxy && body.proxy.host ? {
                  host: String(body.proxy.host),
                  port: Number(body.proxy.port) || 22,
                  username: String(body.proxy.username || '').trim(),
                  // Blank means "keep the stored secret" (same rule as the
                  // main password below): sanitizeMachine strips proxy
                  // passwords, so an edit-form save would otherwise wipe them.
                  password: String(body.proxy.password || '')
                    || (prev && prev.proxy && prev.proxy.host === String(body.proxy.host)
                      && prev.proxy.username === String(body.proxy.username || '').trim()
                      ? prev.proxy.password || '' : ''),
                  privateKeyPath: String(body.proxy.privateKeyPath || '').trim(),
                } : undefined,
                credentialBackend: credBackend,
                recentWorkspaces: prev && prev.recentWorkspaces ? prev.recentWorkspaces : [],
                lastConnectedAt: prev && prev.lastConnectedAt ? prev.lastConnectedAt : null,
                latencyMs: prev && prev.latencyMs ? prev.latencyMs : null,
              }
              if (body.password) {
                // Issue #30: `saveSecret()` is best-effort — the old code threw
                // its result away and kept `password: ''`, so on Windows (DPAPI
                // missing the System.Security assembly) the machine was saved
                // WITHOUT any credential and every later connect failed with no
                // visible reason. Now a failed OS-store write falls back to
                // plaintext and is reported to the UI.
                const persisted = await persistPassword({
                  backend: credBackend,
                  machineId: id,
                  password: body.password,
                  secretsDir: secretsDir(),
                })
                rec.credentialBackend = persisted.credentialBackend
                rec.password = persisted.password
                if (persisted.warning) {
                  warning = persisted.warning
                  warningDetail = persisted.error
                }
              } else if (prev && prev.password) {
                rec.password = prev.password
              }
              if (i >= 0) machines[i] = rec; else machines.push(rec)
              // Issue #13: saving a machine must NOT make it the active
              // remote context. `currentId` stays untouched on add/update —
              // only an explicit "设为当前" (or rw_connect) activates one.
              // keepCurrentKey:false leaves the stored `currentId` byte-for-byte
              // alone, so a fresh registry stays "no choice yet" (not an
              // explicit none) and a previously-cleared registry stays cleared.
              saveMachines(machines, store.currentId, false)
              return sendJson(res, 200, {
                ok: true,
                machine: sanitizeMachine(rec),
                machines: machines.map(sanitizeMachine),
                currentId: store.currentId,
                ...(warning ? { warning, warningDetail } : {}),
              })
            }
            if (action === 'delete') {
              const i = machineIndex(String(body.id || ''))
              if (i < 0) return sendJson(res, 404, { ok: false, error: 'machine not found' })
              const m = machines[i]
              if (m.credentialBackend && m.credentialBackend !== 'plain') {
                await deleteSecret(m.id, secretsDir())
              }
              machines.splice(i, 1)
              const wasCurrent = store.currentId === m.id
              if (wasCurrent) {
                // Issue #13: deleting the current machine leaves NO active
                // remote context (never auto-promote a sibling — that would
                // make an unrelated machine leak into the session again).
                store.currentId = null
                saveMachines(machines, null)
                await clearActiveMachine()
              } else {
                saveMachines(machines, store.currentId)
              }
              return sendJson(res, 200, { ok: true, machines: machines.map(sanitizeMachine), currentId: store.currentId })
            }
            return sendJson(res, 400, { ok: false, error: 'unknown action' })
          } catch (err) {
            return sendJson(res, 500, { ok: false, error: String((err && err.message) || err) })
          }
        }
        return sendJson(res, 405, { ok: false, error: 'method not allowed' })
      },
    },
    {
      kind: 'exact',
      path: '/dsh-remote/test-connect',
      handler: async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
        // Issue #30: `body` lives OUTSIDE the try — a try-scoped `const` is
        // invisible in catch, so the old catch threw `ReferenceError: body is
        // not defined` and the probe result never reached the UI (the webserver
        // answered with an empty 400 for every kind of failure). This route is a
        // probe: every outcome is a 200 carrying {ok:false, error}.
        let body = {}
        try {
          body = parseJsonObject(await readBody(req, res))
          // `machineId` pins the probe to a saved machine: secrets never leave
          // the host, so a test of a password-auth machine must read its stored
          // credential here instead of demanding the client resend it.
          const saved = body.machineId ? machines.find((m) => m.id === String(body.machineId)) : null
          const probe = new SshPool({
            ...config,
            host: String(body.host || (saved && saved.host) || config.host),
            port: Number(body.port) || (saved && saved.port) || config.port,
            username: String(body.username || (saved && saved.username) || config.username),
            password: String(body.password || (saved && saved.password) || ''),
            privateKeyPath: String(body.privateKeyPath || (saved && saved.privateKeyPath) || config.privateKeyPath),
            passphrase: String(body.passphrase || (saved && saved.passphrase) || ''),
            hostKeyMode: body.hostKeyMode || (saved && saved.hostKeyMode) || config.hostKeyMode,
            useAgent: body.useAgent !== undefined ? !!body.useAgent : (saved ? !!saved.useAgent : config.useAgent),
            keyboardInteractive: body.keyboardInteractive !== undefined
              ? !!body.keyboardInteractive : (saved ? !!saved.keyboardInteractive : config.keyboardInteractive),
            proxy: body.proxy && body.proxy.host ? {
              host: String(body.proxy.host),
              port: Number(body.proxy.port) || 22,
              username: String(body.proxy.username || ''),
              password: String(body.proxy.password || '')
                || (saved && saved.proxy && saved.proxy.host === String(body.proxy.host)
                  ? saved.proxy.password || '' : ''),
              privateKeyPath: String(body.proxy.privateKeyPath || ''),
            } : (saved && saved.proxy ? saved.proxy : undefined),
            connectTimeoutMs: Math.min(Math.max(Number(body.connectTimeoutMs) || config.connectTimeoutMs, 2000), 30000),
            commandTimeoutMs: 10000,
          }, { knownHostsFile })
          const started = Date.now()
          await probe.connect()
          await probe.exec('true', { timeoutMs: 10000 })
          probe.close()
          const latencyMs = Date.now() - started
          const mi = machines.findIndex((m) => m.host === probe.config.host && m.username === probe.config.username && Number(m.port) === probe.config.port)
          if (mi >= 0) {
            machines[mi].lastConnectedAt = new Date().toISOString()
            machines[mi].latencyMs = latencyMs
            saveMachines(machines, store.currentId)
          }
          return sendJson(res, 200, { ok: true, host: probe.config.host, user: probe.config.username, latencyMs, lastConnectedAt: new Date().toISOString(), platform: probe.platform, shell: probe.shellMode, gitBash: probe.gitBashPath || '' })
        } catch (err) {
          return sendJson(res, 200, { ok: false, error: friendlyMessage(err, { host: body.host, port: body.port }) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/dsh-remote/current',
      handler: async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
        try {
          const body = JSON.parse((await readBody(req, res)) || '{}')
          const id = String(body.id || '').trim()
          // Issue #13: an empty id is an explicit "active remote = none" —
          // saved machines stay in the registry but nothing is current.
          if (!id) {
            await setCurrent('')
            return sendJson(res, 200, { ok: true, currentId: null, ...status() })
          }
          const okSet = await setCurrent(id)
          if (!okSet) return sendJson(res, 404, { ok: false, error: 'machine not found' })
          return sendJson(res, 200, { ok: true, ...status() })
        } catch (err) {
          return sendJson(res, 500, { ok: false, error: String((err && err.message) || err) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/dsh-remote/forget-key',
      handler: async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
        createHostKeyGuard(config, knownHostsFile()).forgetHost()
        return sendJson(res, 200, { ok: true, ...status() })
      },
    },
    {
      kind: 'exact',
      path: '/dsh-remote/forwards',
      handler: async (req, res) => {
        if (req.method === 'GET') return sendJson(res, 200, { forwards: forwards.list() })
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
        try {
          const body = JSON.parse((await readBody(req, res)) || '{}')
          const action = String(body.action || '')
          if (action === 'define') {
            const d = forwards.define({
              direction: body.direction === 'reverse' ? 'reverse' : 'local',
              listenPort: Number(body.listenPort),
              targetHost: body.targetHost || '127.0.0.1',
              targetPort: Number(body.targetPort) || Number(body.listenPort),
              autoStart: !!body.autoStart,
              machineId: store.currentId,
            })
            return sendJson(res, 200, { ok: true, forward: d, forwards: forwards.list() })
          }
          if (action === 'start' || action === 'stop') {
            const d = forwards.list().find((f) => f.id === body.id)
            if (!d) return sendJson(res, 404, { ok: false, error: 'forward not found' })
            if (action === 'start') {
              const r = await forwards.start(d)
              if (!r.ok) return sendJson(res, 500, { ok: false, error: r.error })
            } else {
              forwards.stop(d.id)
            }
            return sendJson(res, 200, { ok: true, forwards: forwards.list() })
          }
          if (action === 'remove') {
            forwards.remove(String(body.id || ''))
            return sendJson(res, 200, { ok: true, forwards: forwards.list() })
          }
          return sendJson(res, 400, { ok: false, error: 'unknown action' })
        } catch (err) {
          return sendJson(res, 500, { ok: false, error: String((err && err.message) || err) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/dsh-remote/task',
      handler: async (req, res) => {
        if (req.method === 'GET') {
          const q = new URL(req.url, 'http://localhost').searchParams
          const id = q.get('id') || ''
          const t = tasks.get(id)
          if (!t) return sendJson(res, 404, { ok: false, error: 'task not found' })
          return sendJson(res, 200, { ok: true, task: t })
        }
        if (req.method === 'POST') {
          try {
            const body = JSON.parse((await readBody(req, res)) || '{}')
            const id = String(body.id || '')
            if (body.action === 'cancel') {
              const ok = tasks.cancel(id)
              return sendJson(res, 200, { ok, task: tasks.get(id) })
            }
            return sendJson(res, 400, { ok: false, error: 'unknown action' })
          } catch (err) {
            return sendJson(res, 500, { ok: false, error: String((err && err.message) || err) })
          }
        }
        return sendJson(res, 405, { ok: false, error: 'method not allowed' })
      },
    },
    {
      kind: 'exact',
      path: '/dsh-remote/tasks',
      handler: async (req, res) => {
        if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
        return sendJson(res, 200, { ok: true, tasks: tasks.list() })
      },
    },
    {
      kind: 'exact',
      path: '/dsh-remote/audit',
      handler: async (req, res) => {
        if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
        const q = new URL(req.url, 'http://localhost').searchParams
        return sendJson(res, 200, { ok: true, auditEnabled: !!config.auditLog, file: auditFile(), lines: readAudit(q.get('limit')) })
      },
    },
    {
      kind: 'exact',
      path: '/dsh-remote/ssh-config',
      handler: async (req, res) => {
        if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
        try {
          const text = readSshConfigText()
          return sendJson(res, 200, { ok: true, file: sshConfigPath(), present: !!text, entries: importableEntries(text) })
        } catch (err) {
          return sendJson(res, 500, { ok: false, error: String((err && err.message) || err) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/dsh-remote/home',
      handler: async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
        try {
          const out = await pool.exec('echo ~', { timeoutMs: Math.min(config.commandTimeoutMs, 5000) })
          const home = String(out.stdout || '').replace(/\s+/g, '').trim()
          if (!home) return sendJson(res, 200, { ok: true, home: null, hint: 'Windows 远程暂不支持 ~ 解析，请直接输入绝对路径' })
          return sendJson(res, 200, { ok: true, home })
        } catch (err) {
          return sendJson(res, 200, { ok: true, home: null, error: String((err && err.message) || err) })
        }
      },
    },
  ]

  registerHttpTransports(ctx, routes)
}
