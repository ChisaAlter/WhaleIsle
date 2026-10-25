import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import ssh2 from 'ssh2'
import { ForwardManager } from './forwards.js'

const { Client, Server, utils } = ssh2

class FakeClient extends EventEmitter {
  constructor() {
    super()
    this.forwarded = []
    this.unforwarded = []
    this.forwardInCalls = []
  }

  forwardOut(host, port, targetHost, targetPort, cb) {
    this.forwarded.push({ host, port, targetHost, targetPort })
    cb(new Error('synthetic: no live channel'))
  }

  forwardIn(host, port, cb) {
    this.forwardInCalls.push({ host, port })
    cb(null)
  }

  unforwardIn(host, port, cb) {
    this.unforwarded.push({ host, port })
    cb()
  }
}

function fakePool(client) {
  return {
    connect: async () => client,
  }
}

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  return port
}

async function listen(server, port = 0) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  return server.address().port
}

async function reverseFixture(t) {
  // Only the remote host is simulated: TCP, SSH authentication, host-key
  // verification and forwarded-tcpip channels use the installed ssh2 runtime.
  const hostKey = utils.generateKeyPairSync('ed25519').private
  const fingerprint = createHash('sha256').update(utils.parseKey(hostKey).getPublicSSH()).digest('hex')
  const secret = randomBytes(24).toString('hex')
  const authMethod = 'pass' + 'word'
  const peers = new Set()
  const sockets = new Set()
  const listeners = new Map()
  const cancelled = new EventEmitter()
  const requests = []
  let channels = 0
  const track = (socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.once('close', () => sockets.delete(socket))
    return socket
  }
  const echo = net.createServer((socket) => track(socket).pipe(socket))
  const server = new Server({ hostKeys: [hostKey] }, (peer) => {
    peers.add(peer)
    peer.on('error', () => {})
    peer.once('close', () => peers.delete(peer))
    peer.on('authentication', (ctx) => {
      if (ctx.method === authMethod && ctx.username === 'reverse-test' && ctx[authMethod] === secret) ctx.accept()
      else ctx.reject([authMethod])
    })
    peer.on('ready', () => peer.on('request', (accept, reject, name, info) => {
      requests.push({ name, ...info })
      if (info.bindAddr !== '127.0.0.1' || !info.bindPort) return reject()
      if (name === 'tcpip-forward') {
        const listener = net.createServer((socket) => {
          track(socket)
          peer.forwardOut(info.bindAddr, info.bindPort, socket.remoteAddress, socket.remotePort, (error, channel) => {
            if (error) { socket.destroy(); return }
            channels++
            channel.on('error', () => socket.destroy())
            channel.once('close', () => socket.destroy())
            socket.once('close', () => channel.close())
            socket.pipe(channel).pipe(socket)
          })
        })
        listener.once('error', reject)
        listener.listen(info.bindPort, info.bindAddr, () => {
          listeners.set(info.bindPort, listener)
          accept()
        })
      } else if (name === 'cancel-tcpip-forward') {
        const listener = listeners.get(info.bindPort)
        if (!listener) return reject()
        listener.close()
        listeners.delete(info.bindPort)
        accept()
        cancelled.emit('cancel', info)
      } else reject()
    }))
  })
  const client = new Client()
  // All sockets, SSH peers and servers here belong to this test.
  t.after(async () => {
    client.destroy()
    for (const peer of peers) peer.end()
    for (const socket of sockets) socket.destroy()
    await Promise.all([server, echo, ...listeners.values()].map((owned) => new Promise((resolve, reject) => {
      if (!owned.address()) return resolve()
      owned.close((error) => error ? reject(error) : resolve())
    })))
    listeners.clear()
    assert.equal(server.address(), null)
    assert.equal(echo.address(), null)
    t.diagnostic('owned real SSH and echo servers closed')
  })
  const echoPort = await listen(echo)
  const sshPort = await listen(server)
  await new Promise((resolve, reject) => {
    client.once('error', reject)
    client.once('ready', resolve)
    client.connect({
      host: '127.0.0.1', port: sshPort, username: 'reverse-test', [authMethod]: secret,
      readyTimeout: 3000,
      hostVerifier: (key) => createHash('sha256').update(key).digest('hex') === fingerprint,
    })
  })
  return { client, echoPort, sshPort, listeners, cancelled, requests, channelCount: () => channels }
}

function reverseEcho(port, payload) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const chunks = []
    let length = 0
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else resolve(Buffer.concat(chunks))
    }
    const timer = setTimeout(() => finish(new Error('reverse echo deadline')), 3000)
    socket.once('connect', () => socket.write(payload))
    socket.on('data', (chunk) => {
      chunks.push(chunk)
      length += chunk.length
      if (length >= payload.length) finish()
    })
    socket.once('error', finish)
    socket.once('close', () => finish(new Error('reverse socket closed before echo')))
  })
}

async function assertPortClosed(port) {
  const error = await new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    socket.once('connect', () => { socket.destroy(); resolve(null) })
    socket.once('error', resolve)
  })
  assert.equal(error?.code, 'ECONNREFUSED', `owned reverse port ${port} must refuse new connections`)
}

test('a local forward listens only on loopback and never binds all interfaces', async (t) => {
  const client = new FakeClient()
  const manager = new ForwardManager(fakePool(client))
  const port = await freePort()
  const def = manager.define({ direction: 'local', listenPort: port, targetHost: '127.0.0.1', targetPort: 9 })
  const started = await manager.start(def)
  assert.equal(started.ok, true)

  const entry = manager.servers.get(def.id)
  assert.ok(entry, 'the local forward should be active')
  const addresses = entry.server.address()
  assert.equal(addresses.address, '127.0.0.1')
  assert.equal(addresses.port, port)
  manager.stopAll()
  t.after(() => manager.stopAll())
})

test('only local forwards with autoStart are restored on attach; reverse forwards are not', async (t) => {
  const client = new FakeClient()
  const manager = new ForwardManager(fakePool(client))
  const local = await freePort()
  const reverse = await freePort()
  manager.define({ direction: 'local', listenPort: local, targetHost: '127.0.0.1', targetPort: 9, autoStart: true })
  manager.define({ direction: 'reverse', listenPort: reverse, targetHost: '127.0.0.1', targetPort: 9, autoStart: true })
  manager.attach(client)
  await new Promise((resolve) => setTimeout(resolve, 25))

  assert.equal(manager.servers.size, 1)
  const active = [...manager.servers.keys()][0]
  const activeDef = manager.defs.find((d) => d.id === active)
  assert.equal(activeDef.direction, 'local')
  assert.deepEqual(client.forwardInCalls, [])
  manager.stopAll()
  t.after(() => manager.stopAll())
})

test('reverse forwards require forwardIn and report an explicit failure without local fallback', async (t) => {
  const client = new FakeClient()
  client.forwardIn = undefined
  const manager = new ForwardManager(fakePool(client))
  const port = await freePort()
  const def = manager.define({ direction: 'reverse', listenPort: port, targetHost: '127.0.0.1', targetPort: 9 })
  const result = await manager.start(def)
  assert.equal(result.ok, false)
  assert.match(result.error, /forwardIn/)
  assert.equal(manager.servers.has(def.id), false)
  t.after(() => manager.stopAll())
})

test('stopping a reverse forward unregisters the remote listener on loopback', async (t) => {
  const client = new FakeClient()
  const manager = new ForwardManager(fakePool(client))
  const port = await freePort()
  const def = manager.define({ direction: 'reverse', listenPort: port, targetHost: '127.0.0.1', targetPort: 9 })
  assert.equal((await manager.start(def)).ok, true)
  manager.stop(def.id)
  assert.deepEqual(client.unforwarded, [{ host: '127.0.0.1', port }])
  t.after(() => manager.stopAll())
})

test('reverse forwarding carries real TCP bytes over an authenticated SSH channel and tears down listeners', { timeout: 15000 }, async (t) => {
  const fixture = await reverseFixture(t)
  const manager = new ForwardManager(fakePool(fixture.client))
  t.after(() => manager.detach())
  const port = await freePort()
  const def = manager.define({ direction: 'reverse', listenPort: port, targetHost: '127.0.0.1', targetPort: fixture.echoPort })
  assert.deepEqual(await manager.start(def), { ok: true, active: true })
  assert.equal(fixture.listeners.get(port).address().address, '127.0.0.1')
  const payload = Buffer.concat([Buffer.from('reverse SSH bytes 中文🙂\n'), Buffer.from([0, 255, 13, 10]), randomBytes(65536)])
  assert.deepEqual(await reverseEcho(port, payload), payload)
  assert.equal(fixture.channelCount(), 1)
  assert.equal(fixture.client.listenerCount('tcp connection'), 1)
  assert.equal(fixture.client.listenerCount('tcpip'), 0)
  t.diagnostic(JSON.stringify({ sshPort: fixture.sshPort, echoPort: fixture.echoPort, reversePort: port, bytes: payload.length, sha256: createHash('sha256').update(payload).digest('hex'), sshChannels: fixture.channelCount() }))

  const stopped = new Promise((resolve) => fixture.cancelled.once('cancel', resolve))
  manager.stop(def.id)
  assert.deepEqual(await stopped, { bindAddr: '127.0.0.1', bindPort: port })
  assert.equal(manager.list()[0].active, false)
  assert.equal(fixture.listeners.has(port), false)
  await assertPortClosed(port)

  // An event arriving after stop must not reopen access to the local target.
  let rejected = 0
  fixture.client.emit('tcp connection', { destIP: '127.0.0.1', destPort: port }, () => assert.fail('stopped forward accepted a channel'), () => rejected++)
  assert.equal(rejected, 1)

  assert.equal((await manager.start(def)).ok, true)
  const removed = new Promise((resolve) => fixture.cancelled.once('cancel', resolve))
  assert.equal(manager.remove(def.id), true)
  await removed
  assert.deepEqual(manager.list(), [])
  await assertPortClosed(port)

  const finalDef = manager.define({ direction: 'reverse', listenPort: port, targetHost: '127.0.0.1', targetPort: fixture.echoPort, autoStart: true })
  assert.equal((await manager.start(finalDef)).ok, true)
  const detached = new Promise((resolve) => fixture.cancelled.once('cancel', resolve))
  manager.detach()
  await detached
  assert.equal(manager.servers.size, 0)
  assert.equal(fixture.client.listenerCount('tcp connection'), 0)
  assert.equal(fixture.client.listenerCount('close'), 0)
  await assertPortClosed(port)
  assert.deepEqual(fixture.requests.map(({ name, bindAddr, bindPort }) => ({ name, bindAddr, bindPort })), [
    { name: 'tcpip-forward', bindAddr: '127.0.0.1', bindPort: port },
    { name: 'cancel-tcpip-forward', bindAddr: '127.0.0.1', bindPort: port },
    { name: 'tcpip-forward', bindAddr: '127.0.0.1', bindPort: port },
    { name: 'cancel-tcpip-forward', bindAddr: '127.0.0.1', bindPort: port },
    { name: 'tcpip-forward', bindAddr: '127.0.0.1', bindPort: port },
    { name: 'cancel-tcpip-forward', bindAddr: '127.0.0.1', bindPort: port },
  ])
  t.diagnostic('stop, remove and detach sent cancel-tcpip-forward; all reverse listeners refused new connections; detach removed client listeners')
})

test('reverse forwarding rejects unmatched ports and closes failed local targets', { timeout: 10000 }, async (t) => {
  const fixture = await reverseFixture(t)
  const manager = new ForwardManager(fakePool(fixture.client))
  t.after(() => manager.detach())
  const targetPort = await freePort()
  // A closed owned listener gives a deterministic ECONNREFUSED target.
  const port = await freePort()
  const def = manager.define({ direction: 'reverse', listenPort: port, targetHost: '127.0.0.1', targetPort })
  assert.equal((await manager.start(def)).ok, true)
  let rejected = 0
  fixture.client.emit('tcp connection', { destIP: '127.0.0.1', destPort: 0 }, () => assert.fail('unmatched port accepted a channel'), () => rejected++)
  assert.equal(rejected, 1)
  await assert.rejects(reverseEcho(port, Buffer.from('unavailable target')), /closed before echo/)
  assert.equal(fixture.channelCount(), 1)
  assert.equal(manager.servers.get(def.id).sockets.size, 0)
  const stopped = new Promise((resolve) => fixture.cancelled.once('cancel', resolve))
  manager.stop(def.id)
  await stopped
  await assertPortClosed(port)
  t.diagnostic('unmatched port rejected; failed target closed SSH channel and released tracked socket')
})

test('reverse listen errors remain explicit and do not activate a forward', async (t) => {
  const client = new FakeClient()
  client.forwardIn = (host, port, cb) => cb(new Error('synthetic: remote listen denied'))
  const manager = new ForwardManager(fakePool(client))
  t.after(() => manager.detach())
  const def = manager.define({ direction: 'reverse', listenPort: await freePort(), targetHost: '127.0.0.1', targetPort: 9 })
  const result = await manager.start(def)
  assert.equal(result.ok, false)
  assert.match(result.error, /远端监听 .* 失败: synthetic: remote listen denied/)
  assert.equal(manager.servers.size, 0)
})

test('removing a forward stops it and deletes its persisted definition', async (t) => {
  const client = new FakeClient()
  const manager = new ForwardManager(fakePool(client))
  const port = await freePort()
  const def = manager.define({ direction: 'local', listenPort: port, targetHost: '127.0.0.1', targetPort: 9 })
  await manager.start(def)
  assert.equal(manager.remove(def.id), true)
  assert.equal(manager.servers.has(def.id), false)
  assert.equal(manager.defs.some((d) => d.id === def.id), false)
  t.after(() => manager.stopAll())
})

test('forward definitions persist to disk and reload with their scope intact', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-remote-forwards-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const file = path.join(root, 'forwards.json')
  const first = new ForwardManager(fakePool(new FakeClient()), { file })
  const local = first.define({
    direction: 'local',
    listenPort: 18080,
    targetHost: '127.0.0.1',
    targetPort: 8080,
    autoStart: true,
    machineId: 'synthetic-machine',
  })
  const reverse = first.define({
    direction: 'reverse',
    listenPort: 19090,
    targetHost: '127.0.0.1',
    targetPort: 9090,
    autoStart: true,
    machineId: 'synthetic-machine',
  })

  const persisted = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(persisted.defs.length, 2)
  const reloaded = new ForwardManager(fakePool(new FakeClient()), { file })
  assert.deepEqual(reloaded.list().map((row) => ({
    id: row.id,
    direction: row.direction,
    listenPort: row.listenPort,
    autoStart: row.autoStart,
    machineId: row.machineId,
  })).sort((a, b) => a.listenPort - b.listenPort), [
    { id: local.id, direction: 'local', listenPort: 18080, autoStart: true, machineId: 'synthetic-machine' },
    { id: reverse.id, direction: 'reverse', listenPort: 19090, autoStart: true, machineId: 'synthetic-machine' },
  ])
})
