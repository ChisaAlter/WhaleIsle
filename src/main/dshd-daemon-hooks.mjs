/**
 * Installed into the daemon child (`globalThis.__dshdDesktopRpc`) so vendored
 * session handlers can reach loopback `dsh web` and the git tunnel without
 * importing Electron.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { forwardHostRpc, forwardHostRespond, sanitizeHarnessCookie } = require('../shared/dshd-host-tunnel.js');
const { openMuxSse, shouldForwardMuxEnvelope } = require('../shared/dshd-mux-sse.js');

const muxListeners = new Set();
const pendingApprovals = new Map();

function approvalKey(payload) {
  return JSON.stringify([payload.sessionId, payload.approvalId]);
}
let muxAbort = null;
let muxOrigin = '';
let muxCookie = '';
let muxRunning = false;
let harnessCookie = sanitizeHarnessCookie(process.env.DSHD_HARNESS_COOKIE || '');

function currentOrigin() {
  return String(process.env.DSHD_HARNESS_ORIGIN || '').trim();
}

function currentCookie() {
  return harnessCookie;
}

function closeMux() {
  if (muxAbort) {
    try { muxAbort.abort(); } catch { /* ignore */ }
    muxAbort = null;
  }
  muxRunning = false;
  pendingApprovals.clear();
}

function dispatchMux(envelope) {
  if (!shouldForwardMuxEnvelope(envelope)) return;
  const frame = { rpcId: envelope.rpcId, envelope };
  const payload = envelope.payload;
  if (payload?.type === 'approval/requested') pendingApprovals.set(approvalKey(payload), frame);
  else if (payload?.type === 'approval/resolved') pendingApprovals.delete(approvalKey(payload));
  for (const listener of muxListeners) {
    try { listener(frame); } catch { /* ignore */ }
  }
}

function ensureMux() {
  const origin = currentOrigin();
  const cookie = currentCookie();
  if (!origin) {
    closeMux();
    return;
  }
  if (muxRunning && muxOrigin === origin && muxCookie === cookie) return;
  closeMux();
  muxOrigin = origin;
  muxCookie = cookie;
  muxAbort = new AbortController();
  muxRunning = true;
  const signal = muxAbort.signal;
  void openMuxSse({
    origin,
    cookie,
    onEnvelope: (envelope) => { if (!signal.aborted) dispatchMux(envelope); },
    onDisconnect: () => { if (!signal.aborted) pendingApprovals.clear(); },
    signal,
  }).catch(() => {
    if (muxAbort?.signal === signal) {
      muxRunning = false;
      muxAbort = null;
    }
  }).finally(() => {
    if (muxAbort?.signal === signal) {
      muxRunning = false;
      muxAbort = null;
    }
  });
}

async function gitRpc({ action, cwd, payload }) {
  const url = String(process.env.DSHD_GIT_TUNNEL_URL || '').trim();
  const token = String(process.env.DSHD_GIT_TUNNEL_TOKEN || '').trim();
  if (!url || !token) {
    throw new Error('Git 隧道未就绪');
  }
  const response = await fetch(new URL('/git', url).href, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-dshd-git-token': token,
    },
    body: JSON.stringify({ action, cwd, payload }),
  });
  const body = await response.json();
  if (!body || body.ok !== true) {
    throw new Error(body?.error || `git HTTP ${response.status}`);
  }
  return body.value;
}

export function installDesktopRpcHooks() {
  globalThis.__dshdDesktopRpc = {
    async hostRpc({ method, payload }) {
      return forwardHostRpc({ origin: currentOrigin(), cookie: currentCookie(), method, payload });
    },
    async respond({ rpcId, value }) {
      const pending = [...pendingApprovals.values()].find((frame) => frame.rpcId === rpcId);
      const result = await forwardHostRespond({ origin: currentOrigin(), cookie: currentCookie(), rpcId, value });
      if (pending && pendingApprovals.get(approvalKey(pending.envelope.payload)) === pending) {
        const { sessionId, approvalId } = pending.envelope.payload;
        // The Gateway omits cancel for the stream that supplied the decision.
        dispatchMux({ type: 'server-request', rpcId, payload: { type: 'approval/resolved', sessionId, approvalId } });
      }
      return result;
    },
    gitRpc,
    subscribeMux(onFrame) {
      muxListeners.add(onFrame);
      ensureMux();
      for (const frame of pendingApprovals.values()) {
        try { onFrame(frame); } catch { /* isolate a subscriber from the shared stream */ }
      }
      return () => {
        muxListeners.delete(onFrame);
        if (muxListeners.size === 0) closeMux();
      };
    },
  };
}

export function applyDaemonStdinLine(line) {
  if (line === 'stop') return 'stop';
  if (line.startsWith('harness-origin ')) {
    process.env.DSHD_HARNESS_ORIGIN = line.slice('harness-origin '.length).trim();
    ensureMux();
    return 'origin';
  }
  if (line.startsWith('harness-cookie ')) {
    harnessCookie = sanitizeHarnessCookie(line.slice('harness-cookie '.length));
    ensureMux();
    return 'cookie';
  }
  return '';
}
