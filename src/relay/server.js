#!/usr/bin/env node
const http = require('http');
const https = require('https');
const fs = require('fs');
const { encodeFrame, attachFrameReader } = require('../shared/relay-frames');
const { readBodyLimited } = require('../shared/secret');
const { normalizeRelayHostToken, relayHostAuthorized } = require('../shared/relay-auth');

const DEFAULT_PORT = 8787;
const MAX_BODY_BYTES = 1024 * 1024;

function isLoopbackBindHost(host) {
  const value = String(host || '').toLowerCase();
  return value === '127.0.0.1' || value === 'localhost' || value === '::1';
}

class RelayServer {
  constructor(options = {}) {
    this.server = null;
    this.host = null;
    this.nextId = 1;
    this.pending = new Map();
    this.upgrades = new Map();
    this.hostToken = normalizeRelayHostToken(options.hostToken);
    this.tls = options.tls && options.tls.key && options.tls.cert ? options.tls : null;
    this.allowInsecureHttp = options.allowInsecureHttp === true;
  }

  listen(port = DEFAULT_PORT, host = '0.0.0.0') {
    if (!this.hostToken) {
      return Promise.reject(new Error('relay host token is required'));
    }
    if (!this.tls && !(this.allowInsecureHttp && isLoopbackBindHost(host))) {
      return Promise.reject(new Error('relay TLS key and certificate are required'));
    }
    return new Promise((resolve, reject) => {
      const handler = (req, res) => {
        this.handleHttp(req, res);
      };
      const server = this.tls
        ? https.createServer(this.tls, handler)
        : http.createServer(handler);
      server.on('upgrade', (req, socket, head) => {
        this.handleUpgrade(req, socket, head);
      });
      server.on('error', reject);
      server.listen(port, host, () => {
        this.server = server;
        resolve(server.address().port);
      });
    });
  }

  async close() {
    const host = this.host;
    this.host = null;
    if (host) {
      host.destroy();
    }
    this.closeForwardedConnections();
    const server = this.server;
    this.server = null;
    if (!server) {
      return;
    }
    await new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
      setTimeout(resolve, 400);
    });
  }

  closeForwardedConnections() {
    for (const pending of this.pending.values()) {
      if (!pending.res.headersSent) {
        pending.res.writeHead(502);
      }
      pending.res.end('desktop disconnected');
    }
    this.pending.clear();
    for (const client of this.upgrades.values()) {
      client.destroy();
    }
    this.upgrades.clear();
  }

  send(header, body) {
    if (!this.host || this.host.destroyed) {
      return false;
    }
    this.host.write(encodeFrame(header, body));
    return true;
  }

  attachHost(socket) {
    if (this.host && !this.host.destroyed) {
      return false;
    }
    this.host = socket;
    socket.setNoDelay(true);
    attachFrameReader(socket, (header, body) => {
      this.handleHostFrame(header, body);
    });
    const detach = () => {
      if (this.host === socket) {
        this.host = null;
        this.closeForwardedConnections();
      }
    };
    socket.once('end', detach);
    socket.once('close', detach);
    socket.once('error', detach);
    return true;
  }

  handleHostFrame(header, body) {
    if (!header || typeof header !== 'object') {
      return;
    }
    if (header.type === 'http-head') {
      const pending = this.pending.get(header.id);
      if (pending && !pending.res.headersSent) {
        pending.res.writeHead(header.status || 502, header.headers || {});
      }
      return;
    }
    if (header.type === 'http-data') {
      const pending = this.pending.get(header.id);
      if (pending) {
        pending.res.write(body);
      }
      return;
    }
    if (header.type === 'http-end') {
      const pending = this.pending.get(header.id);
      if (pending) {
        pending.res.end();
        this.pending.delete(header.id);
      }
      return;
    }
    if (header.type === 'up-data') {
      const client = this.upgrades.get(header.id);
      if (client && !client.destroyed) {
        client.write(body);
      }
      return;
    }
    if (header.type === 'up-end') {
      const client = this.upgrades.get(header.id);
      if (client) {
        client.end();
        this.upgrades.delete(header.id);
      }
    }
  }

  async handleHttp(req, res) {
    if (!this.host) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('桌面还没连上中继，请稍后再扫');
      return;
    }
    let body = Buffer.alloc(0);
    try {
      body = await readBodyLimited(req, MAX_BODY_BYTES, { buffer: true, res });
    } catch {
      res.writeHead(413);
      res.end('request too large');
      return;
    }
    const id = this.nextId++;
    this.pending.set(id, { res });
    const ok = this.send({
      type: 'http',
      id,
      method: req.method,
      path: req.url,
      headers: req.headers,
    }, body);
    if (!ok) {
      this.pending.delete(id);
      res.writeHead(502);
      res.end('桌面还没连上中继，请稍后再扫');
    }
  }

  handleUpgrade(req, socket, head) {
    if ((req.url || '').startsWith('/__dsh__/host') && String(req.headers.upgrade || '').toLowerCase() === 'dsh-relay') {
      if (!relayHostAuthorized(req.headers, this.hostToken)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      if (this.host && !this.host.destroyed) {
        socket.write('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: dsh-relay\r\nConnection: Upgrade\r\n\r\n');
      if (head && head.length) {
        socket.unshift(head);
      }
      this.attachHost(socket);
      return;
    }
    if (!this.host) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const id = this.nextId++;
    this.upgrades.set(id, socket);
    socket.resume();
    socket.on('data', (chunk) => {
      this.send({ type: 'up-data', id }, chunk);
    });
    const end = () => {
      if (this.upgrades.get(id) === socket) {
        this.upgrades.delete(id);
        this.send({ type: 'up-end', id });
      }
    };
    socket.on('end', end);
    socket.on('close', end);
    socket.on('error', () => {
      socket.destroy();
      end();
    });
    this.send({
      type: 'upgrade',
      id,
      method: req.method,
      path: req.url,
      headers: req.headers,
    }, head && head.length ? head : Buffer.alloc(0));
  }
}

async function main(argv = process.argv.slice(2)) {
  const portFlag = argv.findIndex((item) => item === '--port');
  const port = portFlag >= 0 ? Number(argv[portFlag + 1]) : DEFAULT_PORT;
  const certFlag = argv.findIndex((item) => item === '--cert');
  const keyFlag = argv.findIndex((item) => item === '--key');
  const tokenFlag = argv.findIndex((item) => item === '--host-token');
  const certPath = certFlag >= 0 ? argv[certFlag + 1] : process.env.DSH_RELAY_TLS_CERT;
  const keyPath = keyFlag >= 0 ? argv[keyFlag + 1] : process.env.DSH_RELAY_TLS_KEY;
  const hostToken = tokenFlag >= 0 ? argv[tokenFlag + 1] : process.env.DSH_RELAY_HOST_TOKEN;
  if (!certPath || !keyPath) {
    throw new Error('relay requires --cert and --key (or DSH_RELAY_TLS_CERT/DSH_RELAY_TLS_KEY)');
  }
  const server = new RelayServer({
    hostToken,
    tls: {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
    },
  });
  const bound = await server.listen(Number.isInteger(port) ? port : DEFAULT_PORT);
  process.stdout.write(`dsh relay listening on ${bound}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  RelayServer,
  DEFAULT_PORT,
  main,
};
