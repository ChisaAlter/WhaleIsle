import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { saveSecret } from './credential.js'

function makeHome(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-remote-cred-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function recorder(result = '') {
  const calls = []
  const run = async (bin, args, input) => {
    calls.push({ bin, args, input })
    return result
  }
  return { calls, run }
}

function assertPasswordOffArgv(calls, password) {
  for (const call of calls) {
    assert.ok(!String(call.bin).includes(password), `bin must not carry the password: ${call.bin}`)
    for (const arg of call.args || []) {
      assert.ok(!String(arg).includes(password), `argv must not carry the password: ${arg}`)
    }
  }
}

test('macOS stores the password through the security -i command stream, never argv', async (t) => {
  const password = "p@ss word'\"with$chars"
  const { calls, run } = recorder()
  const res = await saveSecret('machine-1', password, makeHome(t), { run, platform: 'darwin' })
  assert.equal(res.ok, true)
  assert.equal(res.backend, 'keychain')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].bin, 'security')
  assert.deepEqual(calls[0].args, ['-i'])
  assertPasswordOffArgv(calls, password)
  // The command rides stdin with the password as one quoted token after -w.
  assert.match(calls[0].input, /^add-generic-password -U -s 'dsh-remote' -a 'machine-1' -w /)
  assert.ok(calls[0].input.includes(`p@ss word'"'"'"with$chars`), 'password stays on the stdin command line')
})

test('a newline password cannot ride the security -i stream and falls back cleanly', async (t) => {
  const { calls, run } = recorder()
  const res = await saveSecret('machine-1', 'two\nlines', makeHome(t), { run, platform: 'darwin' })
  assert.equal(res.ok, false)
  assert.equal(calls.length, 0)
  assert.ok(!String(res.error).includes('two\nlines'), 'error must not contain the password')
})

test('Windows DPAPI keeps the password on stdin, not in the powershell command line', async (t) => {
  const password = 'sec ret"pw'
  const home = makeHome(t)
  const { calls, run } = recorder('QzFwaGVy')
  const res = await saveSecret('machine-9', password, home, { run, platform: 'win32' })
  assert.equal(res.ok, true)
  assert.equal(res.backend, 'windows')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].bin, 'powershell')
  assertPasswordOffArgv(calls, password)
  // Fixed script in argv; the password is the stdin payload.
  const command = calls[0].args[calls[0].args.indexOf('-Command') + 1]
  assert.match(command, /ProtectedData.*Protect|Add-Type -AssemblyName System\.Security/)
  assert.ok(!command.includes(password))
  assert.equal(calls[0].input, password)
  assert.equal(readFileSync(path.join(home, 'machine-9.bin'), 'utf8'), 'QzFwaGVy')
})

test('Linux keeps passing the password to secret-tool over stdin (regression)', async (t) => {
  const password = 'lnx-secret'
  const { calls, run } = recorder()
  const res = await saveSecret('machine-2', password, makeHome(t), { run, platform: 'linux' })
  assert.equal(res.ok, true)
  assert.equal(res.backend, 'secret')
  assertPasswordOffArgv(calls, password)
  assert.equal(calls[0].bin, 'secret-tool')
  assert.equal(calls[0].input, `${password}\n`)
})
