'use strict';

const http = require('http');
const https = require('https');
const tls = require('tls');

// Node's https and global fetch connect directly and ignore the OS proxy that
// Chromium honors. Where GitHub release hosts are reachable only through that
// proxy, full-installer downloads reset or timed out while the differential
// path (electron-updater on Electron net) worked. Update traffic follows the
// same proxy decision as Chromium. Outside a ready Electron app (unit tests,
// source tools) everything stays direct. A proxy that cannot be reached or
// refuses the tunnel (left enabled after its app quit) falls back to direct.

// Below the download's 20 s connection budget, so a stalled proxy is blamed on the proxy.
const CONNECT_TIMEOUT_MS = 15_000;
const NET_ERROR_CODES = {
  ERR_CONNECTION_RESET: 'ECONNRESET',
  ERR_CONNECTION_CLOSED: 'ECONNRESET',
  ERR_CONNECTION_ABORTED: 'ECONNRESET',
  ERR_EMPTY_RESPONSE: 'ECONNRESET',
  ERR_HTTP2_PROTOCOL_ERROR: 'ECONNRESET',
  ERR_TIMED_OUT: 'ETIMEDOUT',
  ERR_CONNECTION_TIMED_OUT: 'ETIMEDOUT',
  ERR_CONNECTION_REFUSED: 'ECONNREFUSED',
  ERR_PROXY_CONNECTION_FAILED: 'ECONNREFUSED',
  ERR_TUNNEL_CONNECTION_FAILED: 'ERR_PROXY_TUNNEL',
  ERR_NAME_NOT_RESOLVED: 'ENOTFOUND',
  ERR_NAME_RESOLUTION_FAILED: 'ENOTFOUND',
  ERR_INTERNET_DISCONNECTED: 'ENETUNREACH',
  ERR_NETWORK_CHANGED: 'ENETUNREACH',
  ERR_ADDRESS_UNREACHABLE: 'EHOSTUNREACH',
};

const PROXY_NET_ERROR = /net::ERR_(PROXY_CONNECTION_FAILED|TUNNEL_CONNECTION_FAILED|PROXY_AUTH_UNSUPPORTED|PROXY_AUTH_REQUESTED|MANDATORY_PROXY_CONFIGURATION_FAILED|PROXY_CERTIFICATE_INVALID)\b/;

function readyElectron() {
  try {
    const electron = require('electron');
    return typeof electron === 'object' && electron?.app?.isReady?.() ? electron : null;
  } catch {
    return null;
  }
}

/**
 * First entry of a Chromium proxy rule ("PROXY host:port; DIRECT"). Only
 * plain HTTP proxies are tunnelled; DIRECT, SOCKS and HTTPS proxies yield null.
 */
function parseProxyRule(rule) {
  const first = String(rule || '').split(';')[0].trim();
  const match = /^(?:PROXY|HTTP)\s+(\S+)$/i.exec(first);
  if (!match) return null;
  try {
    const parsed = new URL(`http://${match[1]}`);
    return { host: parsed.hostname.replace(/^\[|\]$/g, ''), port: Number(parsed.port) || 80 };
  } catch {
    return null;
  }
}

async function resolveProxy(url) {
  const session = readyElectron()?.session?.defaultSession;
  if (!session?.resolveProxy) return null;
  try {
    return parseProxyRule(await session.resolveProxy(url));
  } catch {
    return null;
  }
}

/** https.Agent whose sockets are TLS over an HTTP CONNECT tunnel. */
class TunnelAgent extends https.Agent {
  constructor(proxy) {
    super({ keepAlive: false });
    this.proxy = proxy;
  }

  createConnection(options, callback) {
    const host = options.host || options.hostname;
    const authority = `${host.includes(':') ? `[${host}]` : host}:${options.port || 443}`;
    let settled = false;
    const finish = (error, socket) => {
      if (settled) {
        socket?.destroy();
        return;
      }
      settled = true;
      // Failures before the tunnel exists belong to the proxy, not the target.
      if (error) error.proxyFailure = true;
      callback(error, socket);
    };
    const connect = http.request({
      host: this.proxy.host,
      port: this.proxy.port,
      method: 'CONNECT',
      path: authority,
      headers: { Host: authority },
      agent: false,
    });
    connect.setTimeout(CONNECT_TIMEOUT_MS, () => {
      connect.destroy(Object.assign(new Error('代理连接超时'), { code: 'ETIMEDOUT' }));
    });
    connect.once('connect', (response, socket) => {
      connect.setTimeout(0);
      if (response.statusCode !== 200) {
        socket.destroy();
        finish(Object.assign(new Error(`代理拒绝建立连接（HTTP ${response.statusCode}）`), {
          code: response.statusCode === 407 ? 'ERR_PROXY_AUTH' : 'ERR_PROXY_TUNNEL',
        }));
        return;
      }
      finish(null, tls.connect({ ...options, socket, servername: options.servername || host, ALPNProtocols: ['http/1.1'] }));
    });
    connect.once('error', (error) => finish(error));
    connect.end();
  }
}

const agents = new Map();

/** Agent for https.get toward `url`, or null to connect directly. */
async function agentFor(url) {
  if (!/^https:/i.test(String(url))) return null;
  const proxy = await resolveProxy(url);
  if (!proxy) return null;
  const key = `${proxy.host}:${proxy.port}`;
  if (!agents.has(key)) agents.set(key, new TunnelAgent(proxy));
  return agents.get(key);
}

/** Chromium "net::ERR_*" failures carry no Node code; map the transient ones. */
function withNetworkCode(error) {
  const name = /net::(ERR_[A-Z0-9_]+)/.exec(String(error?.message || ''))?.[1];
  if (name && error && typeof error === 'object' && !error.code) {
    try { error.code = NET_ERROR_CODES[name] || name; } catch { /* frozen error */ }
  }
  return error;
}

/** fetch() that follows the system proxy inside a ready Electron app. */
async function systemFetch(url, init = {}) {
  const net = readyElectron()?.net;
  if (typeof net?.fetch !== 'function') return fetch(url, init);
  try {
    return await net.fetch(url, { cache: 'no-store', ...init });
  } catch (error) {
    if (PROXY_NET_ERROR.test(String(error?.message || '')) && !init.signal?.aborted) return fetch(url, init);
    throw withNetworkCode(error);
  }
}

module.exports = { agentFor, systemFetch, parseProxyRule, withNetworkCode, TunnelAgent };
