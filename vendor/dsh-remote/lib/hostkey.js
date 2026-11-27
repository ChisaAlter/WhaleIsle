// dsh-remote — host-key fingerprint helpers (TOFU). Pure functions split out
// of lib/index.js so the ssh2 hostVerifier contract (raw Buffer blob since
// ssh2 v1.17) is unit-tested against the REAL wire shape — the v0.6.7 bug
// class ("mock object hid a contract drift") must not regress.
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import path from 'node:path'

/**
 * Extract the SSH host-key algorithm name from a raw SSH host-key blob
 * (SSH wire format: `uint32 len` + algorithm string + key data).
 */
export function blobAlgorithm(blob) {
  if (!Buffer.isBuffer(blob) || blob.length < 4) return ''
  try {
    const len = blob.readUInt32BE(0)
    return blob.toString('utf8', 4, 4 + len)
  } catch {
    return ''
  }
}

/**
 * SHA-256 fingerprint (base64) of an ssh2 host-key blob, like `SHA256:…`
 * in a known_hosts file (without the `SHA256:` prefix).
 *
 * ssh2 v1.17 passes hostVerifier the RAW host-key blob Buffer (the SSH
 * wire-format `string(algo) string(keydata)`), NOT the old `{ algo, hash }`
 * object. Fingerprinting `key.hash` on a raw Buffer crashed with "The 'data'
 * argument must be of type string or an instance of Buffer…" on EVERY connect
 * (v0.6.6 bug). Accept both shapes defensively.
 */
export function keyFingerprint(key) {
  const blob = Buffer.isBuffer(key) ? key : (key && key.hash)
  if (!blob) throw new Error('host key missing (hostVerifier received no key blob)')
  return createHash('sha256').update(blob).digest('base64')
}

export function loadKnownHosts(file) {
  if (!file) return {}
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'))
    if (j && typeof j === 'object' && !Array.isArray(j)) return j
  } catch { /* Unreadable or malformed records are untrusted; the existing host-key policy still verifies the peer. */ }
  return {}
}

export function isHostKeyKnown(file, host, port) {
  return Object.prototype.hasOwnProperty.call(loadKnownHosts(file), `${host}:${port}`)
}

/** Build an ssh2 `hostVerifier` bound to the current config + known_hosts file. */
export function createHostKeyGuard(config, knownHostsFile) {
  const id = () => `${config.host}:${config.port}`
  const mode = config.hostKeyMode === 'verify' || config.hostKeyMode === 'off'
    ? config.hostKeyMode
    : 'accept-new'
  const read = () => loadKnownHosts(knownHostsFile)
  const write = (kh) => {
    if (!knownHostsFile) return
    try { mkdirSync(path.dirname(knownHostsFile), { recursive: true, mode: 0o700 }) } catch { /* The following write reports a directory or permission failure to the caller. */ }
    const tmp = `${knownHostsFile}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify(kh, null, 2), { encoding: 'utf8', mode: 0o600 })
      renameSync(tmp, knownHostsFile)
    } catch (err) {
      try { unlinkSync(tmp) } catch { /* ignore */ }
      throw err
    }
  }
  const guard = {
    mode,
    lastError: null,
    knownHosts: read,
    forgetHost() {
      const kh = read()
      delete kh[id()]
      write(kh)
    },
    verifier(key) {
      if (mode === 'off') return true
      const fp = keyFingerprint(key)
      const kh = read()
      const stored = kh[id()]
      if (stored) {
        if (stored.fingerprint === fp) return true
        guard.lastError =
          `host key for ${id()} CHANGED (stored ${stored.fingerprint}, received ${fp}) — ` +
          'possible man-in-the-middle; run /remote-forget-key to re-trust if this is expected'
        return false
      }
      if (mode === 'verify') {
        guard.lastError = `unknown host key for ${id()} (hostKeyMode=verify) — trust it first with accept-new`
        return false
      }
      kh[id()] = { algo: blobAlgorithm(key) || (key && key.algo) || 'unknown', fingerprint: fp, firstSeen: new Date().toISOString() }
      write(kh)
      return true
    },
  }
  return guard
}

/** Build a fake-but-wire-shaped host-key blob for tests:
 * `string(algo) string(32 bytes)`. */
export function makeKeyBlob(algo, seed) {
  const algoBuf = Buffer.from(algo, 'utf8')
  const data = Buffer.alloc(32, seed || 1)
  const blob = Buffer.alloc(4 + algoBuf.length + 4 + data.length)
  blob.writeUInt32BE(algoBuf.length, 0)
  algoBuf.copy(blob, 4)
  blob.writeUInt32BE(data.length, 4 + algoBuf.length)
  data.copy(blob, 8 + algoBuf.length)
  return blob
}
