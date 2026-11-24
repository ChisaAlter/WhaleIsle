import assert from 'node:assert/strict'
import test from 'node:test'
import { persistPassword } from './credential.js'
import {
  buildAndPersistMachine,
  deleteMachineSecrets,
  passphraseSecretId,
  proxyPasswordSecretId,
  sanitizeMachine,
} from './registry.js'

test('sanitizeMachine strips password, passphrase, and proxy.password while preserving set flags', () => {
  const sanitized = sanitizeMachine({
    id: 'm-1',
    host: 'example.com',
    port: 22,
    username: 'alice',
    password: 'pw-plain',
    passphrase: 'key-passphrase-secret',
    credentialBackend: 'plain',
    proxy: {
      host: 'jump.example.com',
      port: 22,
      username: 'bastion',
      password: 'proxy-secret',
      privateKeyPath: '',
    },
  })

  assert.equal('password' in sanitized, false)
  assert.equal('passphrase' in sanitized, false)
  assert.equal(sanitized.passwordSet, true)
  assert.equal(sanitized.passphraseSet, true)
  assert.ok(sanitized.proxy)
  assert.equal('password' in sanitized.proxy, false)
  assert.equal(sanitized.proxy.passwordSet, true)
  assert.equal(sanitized.proxy.host, 'jump.example.com')
})

test('sanitizeMachine honors persisted *Set flags when secrets are stored in OS keychain', () => {
  const sanitized = sanitizeMachine({
    id: 'm-2',
    host: 'example.com',
    password: '',
    passwordSet: true,
    passphrase: '',
    passphraseSet: true,
    credentialBackend: 'windows',
    proxy: {
      host: 'jump.example.com',
      password: '',
      passwordSet: true,
    },
  })

  assert.equal(sanitized.passwordSet, true)
  assert.equal(sanitized.passphraseSet, true)
  assert.equal(sanitized.proxy.passwordSet, true)
})

test('passphraseSecretId and proxyPasswordSecretId produce distinct account-safe keys', () => {
  assert.equal(passphraseSecretId('m-123'), 'm-123.passphrase')
  assert.equal(proxyPasswordSecretId('m-123'), 'm-123.proxy-password')
  assert.notEqual(passphraseSecretId('m-123'), 'm-123')
  assert.notEqual(proxyPasswordSecretId('m-123'), 'm-123')
  assert.notEqual(passphraseSecretId('m-123'), proxyPasswordSecretId('m-123'))
})

test('buildAndPersistMachine encrypts password, passphrase, and proxy.password and deleteMachineSecrets removes all three', async () => {
  const store = new Map()
  const save = async (key, secret) => {
    store.set(key, secret)
    return { ok: true, backend: 'windows', error: '' }
  }
  const del = async (key) => { store.delete(key) }

  const { rec, warning } = await buildAndPersistMachine({
    id: 'm-enc',
    body: {
      host: 'prod.example.com',
      password: 'ssh-password',
      passphrase: 'key-passphrase',
      proxy: { host: 'jump.example.com', username: 'jump', password: 'jump-password' },
    },
    prev: null,
    requestedBackend: 'windows',
    secretsDir: '.',
    persistPassword: (opts) => persistPassword({ ...opts, save }),
    deleteSecret: del,
  })

  assert.equal(warning, '')
  assert.equal(rec.credentialBackend, 'windows')
  assert.equal(rec.password, '')
  assert.equal(rec.passwordSet, true)
  assert.equal(rec.passphrase, '')
  assert.equal(rec.passphraseSet, true)
  assert.equal(rec.proxy.password, '')
  assert.equal(rec.proxy.passwordSet, true)
  assert.equal(store.get('m-enc'), 'ssh-password')
  assert.equal(store.get('m-enc.passphrase'), 'key-passphrase')
  assert.equal(store.get('m-enc.proxy-password'), 'jump-password')

  // Subsequent update with blank secret fields preserves flags and OS store entries
  const { rec: updated } = await buildAndPersistMachine({
    id: 'm-enc',
    body: {
      host: 'prod.example.com',
      proxy: { host: 'jump.example.com', username: 'jump', password: '' },
    },
    prev: rec,
    requestedBackend: 'windows',
    secretsDir: '.',
    persistPassword: (opts) => persistPassword({ ...opts, save }),
    deleteSecret: del,
  })
  assert.equal(updated.passwordSet, true)
  assert.equal(updated.passphraseSet, true)
  assert.equal(updated.proxy.passwordSet, true)
  assert.equal(store.size, 3)

  await deleteMachineSecrets(updated, '.', del)
  assert.equal(store.size, 0)
})
