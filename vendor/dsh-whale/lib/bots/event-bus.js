/**
 * Granular `bots:changed` event bus and SSE endpoint handler (`GET /dsh-bots/events`).
 * Uses leading-edge `setTimeout(0)` delivery for the first change, followed by a
 * 500ms trailing coalesce window with serialized dispatch so frames never arrive
 * out of order. Queries `needsYouCounts` ONLY when the batch includes `items`.
 */
import { addBotChange, botChangeNotice } from '../../src/shared/bot-rpc-methods.js';

const HEARTBEAT_MS = 25_000;
export const TAIL_COALESCE_MS = 500;

/**
 * Only query `needsYouCounts` when the merged notice covers `items` (or is a wildcard).
 * @param {any} notice
 */
function noticeIncludesItems(notice) {
  return !Array.isArray(notice?.kinds) || notice.kinds.includes('items');
}

/**
 * Create a micro-batched SSE & in-process change broadcaster for bots.
 * @param {{
 *   getNeedsYou?: (() => any) | null,
 *   coalesceMs?: number,
 * }} [options]
 */
export function createBotsEventBus({ getNeedsYou = null, coalesceMs = TAIL_COALESCE_MS } = {}) {
  /** @type {Set<any>} */
  const sseClients = new Set();
  /** @type {Set<(payload: any) => void>} */
  const listeners = new Set();
  /** @type {Map<string, Set<string> | null>} */
  const pending = new Map();
  const tailWindowMs = Number.isFinite(coalesceMs) && coalesceMs >= 0 ? coalesceMs : TAIL_COALESCE_MS;

  /** @type {ReturnType<typeof setTimeout> | null} */
  let flushTimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let cooldownTimer = null;
  let dispatching = false;
  let pendingAsyncCount = 0;
  let asyncChain = Promise.resolve();
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

  /** @param {string} eventName @param {any} payload */
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

  /** @param {any} payload */
  function deliverPayload(payload) {
    if (closed) return;
    broadcastSse('bots:changed', payload);
    for (const fn of [...listeners]) {
      try {
        fn(payload);
      } catch {
        // One faulty subscriber must never break remaining listeners.
      }
    }
  }

  function startCooldown() {
    if (closed || cooldownTimer) return;
    cooldownTimer = setTimeout(() => {
      cooldownTimer = null;
      if (closed || pending.size === 0) return;
      dispatchBatch({ openCooldown: true });
    }, tailWindowMs);
    cooldownTimer.unref?.();
  }

  /** @param {{ openCooldown: boolean }} opts */
  function dispatchBatch({ openCooldown }) {
    if (closed || pending.size === 0) return null;
    if (dispatching) return null;

    const notice = botChangeNotice(pending);
    pending.clear();
    const shouldQueryNeedsYou = typeof getNeedsYou === 'function' && noticeIncludesItems(notice);

    dispatching = true;
    try {
      const maybeNeedsYou = shouldQueryNeedsYou ? getNeedsYou() : undefined;
      if (maybeNeedsYou && typeof maybeNeedsYou.then === 'function') {
        pendingAsyncCount += 1;
        asyncChain = asyncChain
          .then(() => maybeNeedsYou)
          .then((needsYou) => {
            if (closed) return;
            const payload = {
              ...notice,
              ...(needsYou ? { needsYou } : {}),
              ts: Date.now(),
            };
            deliverPayload(payload);
          })
          .catch(() => {
            // Swallow faulty async needsYou provider without breaking the serial chain.
          })
          .finally(() => {
            pendingAsyncCount = Math.max(0, pendingAsyncCount - 1);
          });
        if (openCooldown) startCooldown();
        return null;
      }

      const payload = {
        ...notice,
        ...(maybeNeedsYou ? { needsYou: maybeNeedsYou } : {}),
        ts: Date.now(),
      };
      if (pendingAsyncCount > 0) {
        pendingAsyncCount += 1;
        asyncChain = asyncChain
          .then(() => { deliverPayload(payload); })
          .finally(() => { pendingAsyncCount = Math.max(0, pendingAsyncCount - 1); });
      } else {
        deliverPayload(payload);
      }
      if (openCooldown) startCooldown();
      return payload;
    } finally {
      dispatching = false;
      if (!closed && pending.size > 0 && !flushTimer && !cooldownTimer) {
        if (openCooldown) {
          startCooldown();
        } else {
          flushTimer = setTimeout(() => {
            flushTimer = null;
            dispatchBatch({ openCooldown: true });
          }, 0);
          flushTimer.unref?.();
        }
      }
    }
  }

  function flushNow() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (cooldownTimer) {
      clearTimeout(cooldownTimer);
      cooldownTimer = null;
    }
    if (closed || pending.size === 0) return null;
    return dispatchBatch({ openCooldown: false });
  }

  function emit(scope = {}) {
    if (closed) return;
    addBotChange(pending, scope);
    if (flushTimer || cooldownTimer || dispatching) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      dispatchBatch({ openCooldown: true });
    }, 0);
    flushTimer.unref?.();
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
      if (needsYou && typeof needsYou.then === 'function') {
        void Promise.resolve(needsYou).then((resolved) => {
          if (closed || res.writableEnded || res.destroyed) return;
          try {
            res.write(formatFrame('ready', { ok: true, ...(resolved ? { needsYou: resolved } : {}), ts: Date.now() }));
          } catch {
            sseClients.delete(res);
          }
        });
      } else {
        res.write(formatFrame('ready', { ok: true, ...(needsYou ? { needsYou } : {}), ts: Date.now() }));
      }
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
    if (cooldownTimer) clearTimeout(cooldownTimer);
    flushTimer = null;
    cooldownTimer = null;
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
