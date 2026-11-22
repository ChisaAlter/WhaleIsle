/**
 * Granular `bots:changed` event bus and SSE endpoint handler (`GET /dsh-bots/events`).
 * Micro-batches rapid state mutations using Orca's `addBotChange` / `botChangeNotice`
 * helpers from `src/shared/bot-rpc-methods.js`.
 */
import { addBotChange, botChangeNotice } from '../../src/shared/bot-rpc-methods.js';

const HEARTBEAT_MS = 25_000;
const COALESCE_MS = 30;

/**
 * Create a micro-batched SSE & in-process change broadcaster for bots.
 * @param {{ getNeedsYou?: () => { counts: Record<string, number>, at: number, staleInMs: number | null } }} [options]
 */
export function createBotsEventBus({ getNeedsYou = null } = {}) {
  /** @type {Set<any>} */
  const sseClients = new Set();
  /** @type {Set<(payload: any) => void>} */
  const listeners = new Set();
  /** @type {Map<string, Set<string> | null>} */
  const pending = new Map();
  let flushTimer = null;
  let seq = 0;
  let closed = false;

  const heartbeat = setInterval(() => {
    for (const res of [...sseClients]) {
      try {
        if (res.writableEnded || res.destroyed) sseClients.delete(res);
        else res.write(`: ping ${Date.now()}\n\n`);
      } catch {
        sseClients.delete(res);
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  function formatFrame(eventName, data) {
    seq += 1;
    return `id: ${seq}\nevent: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  function broadcastSse(eventName, payload) {
    if (sseClients.size === 0) return;
    const frame = formatFrame(eventName, payload);
    for (const res of [...sseClients]) {
      try {
        if (res.writableEnded || res.destroyed) {
          sseClients.delete(res);
          continue;
        }
        res.write(frame);
      } catch {
        sseClients.delete(res);
      }
    }
  }

  function buildPayload(notice) {
    const needsYou = typeof getNeedsYou === 'function' ? getNeedsYou() : undefined;
    return {
      ...notice,
      ...(needsYou ? { needsYou } : {}),
      ts: Date.now(),
    };
  }

  function flushNow() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (closed || pending.size === 0) return null;
    const notice = botChangeNotice(pending);
    pending.clear();
    const payload = buildPayload(notice);
    broadcastSse('bots:changed', payload);
    for (const fn of [...listeners]) {
      try {
        fn(payload);
      } catch {
        // One faulty subscriber must never break remaining listeners.
      }
    }
    return payload;
  }

  function emit(scope = {}) {
    if (closed) return;
    addBotChange(pending, scope);
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flushNow();
      }, COALESCE_MS);
      flushTimer.unref?.();
    }
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }

  function handleStream(req, res) {
    if (closed) {
      res.writeHead(503);
      res.end('bots event bus closed');
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.flushHeaders?.();
    sseClients.add(res);
    try {
      const needsYou = typeof getNeedsYou === 'function' ? getNeedsYou() : undefined;
      res.write(formatFrame('ready', { ok: true, ...(needsYou ? { needsYou } : {}), ts: Date.now() }));
    } catch {
      sseClients.delete(res);
      res.end();
      return;
    }
    const cleanup = () => { sseClients.delete(res); };
    req.on?.('close', cleanup);
    res.on?.('close', cleanup);
  }

  function close() {
    closed = true;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    clearInterval(heartbeat);
    pending.clear();
    listeners.clear();
    for (const res of [...sseClients]) {
      try { res.end(); } catch { /* Best-effort SSE socket teardown. */ }
    }
    sseClients.clear();
  }

  return {
    emit,
    flushNow,
    subscribe,
    handleStream,
    close,
    clientCount: () => sseClients.size,
  };
}
