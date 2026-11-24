import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { SshPool, resolveAgentSocket } from './pool.js'

function fakeClientFactory(onConnect) {
  return class FakeClient extends EventEmitter {
    connect(opts) {
      queueMicrotask(() => onConnect(this, opts))
    }
    end() {}
  }
}

test('resolveAgentSocket falls back to the Windows OpenSSH named pipe when SSH_AUTH_SOCK is unset', () => {
  assert.equal(resolveAgentSocket({}, 'win32'), '\\\\.\\pipe\\openssh-ssh-agent')
  assert.equal(resolveAgentSocket({ SSH_AUTH_SOCK: '\\\\.\\pipe\\custom-agent' }, 'win32'), '\\\\.\\pipe\\custom-agent')
  assert.equal(resolveAgentSocket({}, 'linux'), '')
  assert.equal(resolveAgentSocket({ SSH_AUTH_SOCK: '/tmp/ssh.sock' }, 'linux'), '/tmp/ssh.sock')
})

test('SshPool uses Windows OpenSSH named pipe when useAgent is true and SSH_AUTH_SOCK is missing', async () => {
  let seenOpts = null
  const pool = new SshPool(
    { host: 'remote.example', port: 22, username: 'alice', useAgent: true, hostKeyMode: 'off' },
    {
      platform: 'win32',
      env: {},
      Client: fakeClientFactory((client, opts) => {
        seenOpts = opts
        client.emit('ready')
      }),
    },
  )
  await pool.connect()
  assert.equal(seenOpts.agent, '\\\\.\\pipe\\openssh-ssh-agent')
  pool.close()
})

test('SshPool replies to keyboard-interactive prompts with passwordResolver secret when config.password is empty', async () => {
  let responses = null
  const pool = new SshPool(
    { host: 'remote.example', port: 22, username: 'alice', password: '', keyboardInteractive: true, hostKeyMode: 'off' },
    {
      Client: fakeClientFactory((client) => {
        client.emit('keyboard-interactive', 'PAM', '', 'en', [{ prompt: 'Password: ', echo: false }], (ans) => {
          responses = ans
          client.emit('ready')
        })
      }),
    },
  )
  pool.passwordResolver = async () => 'keychain-secret-123'
  await pool.connect()
  assert.deepEqual(responses, ['keychain-secret-123'])
  pool.close()
})

test('SshPool reuses a single healthy SFTP subsystem per connection and clears on end/close/error', async () => {
  let sftpOpens = 0
  const sftpInstances = []
  const pool = new SshPool(
    { host: 'remote.example', port: 22, username: 'alice', password: 'pw', hostKeyMode: 'off', commandTimeoutMs: 5000 },
    {
      Client: fakeClientFactory((client) => {
        client.sftp = (cb) => {
          sftpOpens++
          const inst = new EventEmitter()
          inst.endCalled = 0
          inst.end = () => { inst.endCalled++ }
          inst.readdir = (dir, done) => done(null, [{ filename: dir }])
          sftpInstances.push(inst)
          queueMicrotask(() => cb(null, inst))
        }
        client.emit('ready')
      }),
    },
  )

  const [a, b, c] = await Promise.all([pool.sftp(), pool.sftp(), pool.sftp()])
  assert.equal(sftpOpens, 1)
  assert.equal(a, b)
  assert.equal(b, c)

  const d = await pool.sftp()
  assert.equal(sftpOpens, 1)
  assert.equal(d, a)

  // SFTP subsystem closes -> next sftp() opens a fresh one without opening 20 sessions
  sftpInstances[0].emit('close')
  const e = await pool.sftp()
  assert.equal(sftpOpens, 2)
  assert.notEqual(e, a)

  // Error on SFTP subsystem also invalidates cache
  sftpInstances[1].emit('error', new Error('channel error'))
  const f = await pool.sftp()
  assert.equal(sftpOpens, 3)
  assert.notEqual(f, e)

  pool.close()
  assert.equal(sftpInstances[2].endCalled, 1)
})
