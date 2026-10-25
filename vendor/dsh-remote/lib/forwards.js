// dsh-remote — SSH port forwarding manager (local & reverse tunnels).
//
// Local forward: listen on 127.0.0.1:<listenPort> → every connection is
// piped through the SSH channel to <targetHost>:<targetPort> on the remote.
// Reverse forward: ask the remote to listen on 127.0.0.1:<listenPort> and pipe
// incoming connections back to <targetHost>:<targetPort> on the LOCAL side
// (ssh2 `forwardIn` + the client `tcp connection` event; requires AllowTcpForwarding on
// the remote sshd).
//
// Definitions persist in forwards.json; forwards become active only while the
// SSH connection is up (auto-restart on connect when `autoStart: true`), and
// every tunnel is torn down when the pool disconnects — reverse tunnels are
// never auto-restarted (they would re-expose a local port without asking).
import net from 'node:net'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'

export class ForwardManager {
  /** @param {object} pool SshPool (needs .connect() returning the ssh2 client). */
  constructor(pool, { file } = {}) {
    this.pool = pool
    this.file = file || null
    this.defs = this._load()
    this.servers = new Map() // id → { server | remoteListen, sockets:Set, client }
    this.client = null
    this.onTcpip = null
    this.onClose = null
    this.attach = this.attach.bind(this)
  }

  _load() {
    if (!this.file) return []
    try {
      const j = JSON.parse(readFileSync(this.file, 'utf8'))
      if (Array.isArray(j.defs)) return j.defs
    } catch {}
    return []
  }

  _save() {
    if (!this.file) return
    try {
      mkdirSync(path.dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify({ defs: this.defs }, null, 2))
    } catch {}
  }

  /** Called by the pool after a successful connect: restore autoStart tunnels. */
  attach(client) {
    if (this.client === client) return
    this.client = client
    this.onTcpip = (info, accept, reject) => this._handleTcpip(info, accept, reject)
    client.on('tcp connection', this.onTcpip)
    this.onClose = () => this.stopAll()
    client.on('close', this.onClose)
    for (const d of this.defs) {
      if (d.autoStart && d.direction === 'local' && !this.servers.has(d.id)) {
        this.start(d).catch(() => {})
      }
    }
  }

  detach() {
    this.stopAll()
    if (this.client) {
      if (this.onTcpip) this.client.removeListener('tcp connection', this.onTcpip)
      if (this.onClose) this.client.removeListener('close', this.onClose)
    }
    this.client = null
    this.onTcpip = null
    this.onClose = null
  }

  list() {
    return this.defs.map((d) => ({
      id: d.id,
      direction: d.direction,
      listenPort: d.listenPort,
      targetHost: d.targetHost,
      targetPort: d.targetPort,
      machineId: d.machineId || null,
      autoStart: !!d.autoStart,
      active: this.servers.has(d.id),
    }))
  }

  _defId() {
    return 'fwd-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
  }

  /** Create a forward definition (persisted). Does NOT start it. */
  define({ direction = 'local', listenPort, targetHost, targetPort, autoStart = false, machineId } = {}) {
    const d = {
      id: this._defId(),
      direction: direction === 'reverse' ? 'reverse' : 'local',
      listenPort: Number(listenPort),
      targetHost: String(targetHost || '127.0.0.1'),
      targetPort: Number(targetPort),
      autoStart: !!autoStart,
      machineId: machineId || null,
    }
    this.defs.push(d)
    this._save()
    return d
  }

  remove(id) {
    this.stop(id)
    const i = this.defs.findIndex((d) => d.id === id)
    if (i >= 0) { this.defs.splice(i, 1); this._save(); return true }
    return false
  }

  async start(def) {
    const d = this.defs.find((x) => x.id === def.id) || def
    if (this.servers.has(d.id)) return { ok: true, active: true }
    let client = await this.pool.connect()
    if (!this.client) this.attach(client)
    if (this.client !== client) {
      // The pool reconnected while we were connecting — retry on the live client.
      client = this.client
    }
    try {
      if (d.direction === 'reverse') {
        await this._startReverse(d, client)
      } else {
        await this._startLocal(d, client)
      }
      return { ok: true, active: true }
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) }
    }
  }

  _startLocal(d, client) {
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => {
        client.forwardOut('127.0.0.1', 0, d.targetHost, d.targetPort, (err, channel) => {
          if (err) { socket.destroy(); return }
          socket.pipe(channel)
          channel.pipe(socket)
          const kill = () => { try { socket.destroy() } catch {}; try { channel.close() } catch {} }
          socket.on('error', kill)
          channel.on('error', kill)
          socket.on('close', kill)
          channel.on('close', kill)
        })
      })
      server.on('error', (e) => reject(new Error(`本地转发 ${d.listenPort} 启动失败: ${e.message}`)))
      server.listen(d.listenPort, '127.0.0.1', () => {
        this.servers.set(d.id, { kind: 'local', server, sockets: new Set(), client })
        resolve()
      })
    })
  }

  _startReverse(d, client) {
    return new Promise((resolve, reject) => {
      // ssh2 calls the remote TCP listen API `forwardIn` (NOT openssh_forwardIn,
      // which in ssh2 >= 1.16 is stream-local only).
      if (typeof client.forwardIn !== 'function') {
        return reject(new Error('此 ssh2 版本不支持反向转发 (forwardIn)'))
      }
      client.forwardIn('127.0.0.1', d.listenPort, (err) => {
        if (err) return reject(new Error(`远端监听 ${d.listenPort} 失败: ${(err && err.message) || err}`))
        this.servers.set(d.id, { kind: 'reverse', sockets: new Set(), client })
        resolve()
      })
    })
  }

  _handleTcpip(info, accept, reject) {
    for (const entry of this.servers.values()) {
      if (entry.kind === 'reverse' && Number(info.destPort) === Number(this._defFor(entry).listenPort)) {
        const channel = accept()
        const socket = net.connect({ host: this._defFor(entry).targetHost, port: this._defFor(entry).targetPort })
        socket.pipe(channel)
        channel.pipe(socket)
        entry.sockets.add(socket)
        const kill = () => {
          try { socket.destroy() } catch {}
          try { channel.close() } catch {}
          entry.sockets.delete(socket)
        }
        socket.on('error', kill)
        channel.on('error', kill)
        socket.on('close', kill)
        return
      }
    }
    reject()
  }

  _defFor(entry) {
    for (const d of this.defs) {
      if (this.servers.has(d.id) && this.servers.get(d.id) === entry) return d
    }
    return { listenPort: 0, targetHost: '127.0.0.1', targetPort: 0 }
  }

  stop(id) {
    const entry = this.servers.get(id)
    if (!entry) return
    try {
      if (entry.kind === 'local') {
        entry.server.close()
        for (const s of entry.sockets) { try { s.destroy() } catch {} }
      } else if (entry.client && typeof entry.client.unforwardIn === 'function') {
        const d = this._defFor(entry)
        entry.client.unforwardIn('127.0.0.1', d.listenPort, () => {})
      }
    } catch {}
    this.servers.delete(id)
  }

  stopAll() {
    for (const id of [...this.servers.keys()]) this.stop(id)
  }
}
