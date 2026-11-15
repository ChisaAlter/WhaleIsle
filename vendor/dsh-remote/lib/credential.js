// dsh-remote — optional OS-keychain password storage.
// Machines keep their password in the OS credential store instead of the
// plaintext machines.json when the user enables "加密保存密码" per machine.
// Every backend is best-effort: any failure resolves to {ok:false} and the
// caller (persistPassword) falls back to plaintext + a user-visible warning
// (the feature must never block connecting, and must never silently drop the
// credential — issue #30).
//
// Backends:
//   darwin  → `security` (login keychain, generic password)
//   win32   → DPAPI via PowerShell (CurrentUser scope), files under
//             $DSH_HOME/remote-workspaces/.secrets/
//   linux   → `secret-tool` (libsecret / gnome-keyring), optional
//   else    → unsupported (plain)
import { execFile } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import { join as joinPath } from 'node:path'

const SERVICE = 'dsh-remote'
const TIMEOUT = 8000

// Windows PowerShell 5.1 does not preload System.Security, so
// [System.Security.Cryptography.ProtectedData] is "not found" until the assembly
// is added (issue #30: without this the whole DPAPI call failed and the caller
// silently lost the password). `-ErrorAction SilentlyContinue` keeps the line
// harmless on PowerShell 7, where the type is already available.
const PS_SECURITY_ASSEMBLY = 'Add-Type -AssemblyName System.Security -ErrorAction SilentlyContinue;'

// The DPAPI protect script reads the plaintext password from stdin as UTF-8.
// Keeping it out of argv keeps it out of the Windows process list (issue #30
// fix for credential.js).
const PS_PROTECT_STDIN_SCRIPT = PS_SECURITY_ASSEMBLY +
  '$p=(New-Object IO.StreamReader([Console]::OpenStandardInput(),[Text.Encoding]::UTF8)).ReadToEnd();' +
  '$s=[System.Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($p),$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);' +
  '[Convert]::ToBase64String($s)'

function run(bin, args, input) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: TIMEOUT, maxBuffer: 1 << 20, ...(input != null ? { input } : {}) }, (err, stdout, stderr) => {
      if (err) return reject(err)
      resolve(String(stdout || '').trim())
    })
  })
}

export function platformBackend() {
  if (process.platform === 'darwin') return 'keychain'
  if (process.platform === 'win32') return 'windows'
  return 'secret' // linux (secret-tool may be absent → falls back)
}

function account(machineId) {
  // Only machine ids are stored; sanitize just in case.
  return String(machineId || '').replace(/[^a-zA-Z0-9._-]/g, '_')
}

/** Redact a failed command's diagnostics: execFile puts the FULL command line
 * (which carries the password as an argv) into `err.message`, and this string is
 * shown in the settings UI — so the secret must never survive it. */
function safeReason(err, password) {
  const raw = [err && err.stderr, err && err.message, err && err.code]
    .filter(Boolean).map(String).join(' ')
  const secret = String(password == null ? '' : password)
  const scrubbed = secret ? raw.split(secret).join('***') : raw
  return scrubbed.replace(/\s+/g, ' ').trim().slice(0, 300)
}

/** PowerShell one-liner that reverses DPAPI protect (CurrentUser scope). The
 *  base64 ciphertext is argv-visible but is the on-disk value anyway; only the
 *  plaintext password must stay off the process list. */
export function dpapiUnprotectScript(b64) {
  return PS_SECURITY_ASSEMBLY +
    `$s=[Convert]::FromBase64String('${String(b64).replace(/'/g, "''")}');` +
    `[Text.Encoding]::UTF8.GetString([System.Security.Cryptography.ProtectedData]::Unprotect($s,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser))`
}

/** One token on the `security -i` stdin command stream: the plaintext password
 *  travels inside the command, never on argv. Single quotes carry literal
 *  bytes; an embedded quote splices a '"'"' segment. Newlines cannot ride one
 *  command line, so they fail out to the plaintext fallback. */
function securityInteractiveArg(value) {
  const text = String(value)
  if (/[\r\n]/.test(text)) {
    throw new Error('secret contains a newline the security interactive command stream cannot carry')
  }
  return `'${text.replace(/'/g, `'"'"'`)}'`
}

/** Save a password to the OS store. Resolves {ok, backend, error} — ok:false on
 * any failure (caller falls back to plaintext). `error` is a password-free
 * diagnostic for the UI. The plaintext password never appears on argv:
 * macOS gets `security -i` with the command on stdin, Windows a fixed
 * PowerShell script that reads the password from stdin, Linux secret-tool
 * stdin (unchanged).
 * `io` injects { run, platform } for tests. */
export async function saveSecret(machineId, password, secretsDir, io = {}) {
  const runCmd = io.run || run
  const platform = io.platform || process.platform
  const acc = account(machineId)
  try {
    if (platform === 'darwin') {
      const command = 'add-generic-password -U' +
        ` -s ${securityInteractiveArg(SERVICE)}` +
        ` -a ${securityInteractiveArg(acc)}` +
        ` -w ${securityInteractiveArg(String(password))}\n`
      await runCmd('security', ['-i'], command)
      return { ok: true, backend: 'keychain', error: '' }
    }
    if (platform === 'win32') {
      // DPAPI-encrypt and store under the harness home.
      const b64 = await runCmd('powershell', ['-NoProfile', '-STA', '-Command', PS_PROTECT_STDIN_SCRIPT], String(password))
      if (!b64) return { ok: false, backend: 'windows', error: 'DPAPI returned no ciphertext' }
      mkdirSync(secretsDir || '.', { recursive: true })
      writeFileSync(joinPath(secretsDir || '.', acc + '.bin'), b64, 'utf8')
      return { ok: true, backend: 'windows', error: '' }
    }
    if (platform === 'linux') {
      await runCmd('secret-tool', ['store', '--label=' + SERVICE, 'service', SERVICE, 'account', acc], String(password) + '\n')
      return { ok: true, backend: 'secret', error: '' }
    }
  } catch (err) {
    return { ok: false, backend: platformBackend(), error: safeReason(err, password) || 'secret store write failed' }
  }
  return { ok: false, backend: platformBackend(), error: `unsupported platform: ${platform}` }
}

/** Decide where a machine password is persisted (issue #30).
 *
 * The contract the settings UI relies on: a password is NEVER dropped. When the
 * requested OS store fails (missing DPAPI assembly, locked keychain, absent
 * secret-tool), this falls back to plaintext in machines.json and reports
 * `warning: 'secret-store-failed'` so the caller can tell the user instead of
 * silently saving a credential-less machine.
 *
 * `save` is injectable so the fallback is unit-testable on any platform.
 *
 * @returns {Promise<{stored:'secret'|'plain'|'none', credentialBackend:string, password:string, warning:string, error:string}>}
 */
export async function persistPassword({ backend, machineId, password, secretsDir, save = saveSecret }) {
  const pw = password == null ? '' : String(password)
  const want = backend && backend !== 'plain' ? backend : 'plain'
  if (!pw) return { stored: 'none', credentialBackend: want, password: '', warning: '', error: '' }
  if (want === 'plain') return { stored: 'plain', credentialBackend: 'plain', password: pw, warning: '', error: '' }
  let res
  try {
    res = await save(machineId, pw, secretsDir)
  } catch (err) {
    res = { ok: false, error: safeReason(err, pw) }
  }
  if (res && res.ok) {
    return { stored: 'secret', credentialBackend: res.backend || want, password: '', warning: '', error: '' }
  }
  return {
    stored: 'plain',
    credentialBackend: 'plain',
    password: pw,
    warning: 'secret-store-failed',
    error: String((res && res.error) || '') || 'secret store write failed',
  }
}

/** Fetch a stored password. Resolves string|null. */
export async function getSecret(machineId, secretsDir) {
  const acc = account(machineId)
  try {
    if (process.platform === 'darwin') {
      return await run('security', ['find-generic-password', '-s', SERVICE, '-a', acc, '-w'])
    }
    if (process.platform === 'win32') {
      const b64 = readFileSync(joinPath(secretsDir || '.', acc + '.bin'), 'utf8').trim()
      if (!b64) return null
      const script = dpapiUnprotectScript(b64)
      return await run('powershell', ['-NoProfile', '-STA', '-Command', script])
    }
    if (process.platform === 'linux') {
      return await run('secret-tool', ['lookup', 'service', SERVICE, 'account', acc])
    }
  } catch { /* fall through */ }
  return null
}

/** Delete a stored password (idempotent). */
export async function deleteSecret(machineId, secretsDir) {
  const acc = account(machineId)
  try {
    if (process.platform === 'darwin') {
      await run('security', ['delete-generic-password', '-s', SERVICE, '-a', acc]).catch(() => {})
      return
    }
    if (process.platform === 'win32') {
      try { unlinkSync(joinPath(secretsDir || '.', acc + '.bin')) } catch { /* absent */ }
      return
    }
    if (process.platform === 'linux') {
      await run('secret-tool', ['clear', 'service', SERVICE, 'account', acc]).catch(() => {})
    }
  } catch { /* best effort */ }
}
