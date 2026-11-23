/**
 * Granular `bots:changed` event bus and SSE endpoint handler (`GET /dsh-bots/events`).
 * Micro-batches rapid state mutations using Orca's `addBotChange` / `botChangeNotice`
 * helpers from `src/shared/bot-rpc-methods.js`, tracks active desktop SSE clients
 * plus foreground presence to suppress duplicate external IM/push notifications, and
 * uses leading-edge `setTimeout(0)` + 500ms trailing coalesce window with serialized
 * dispatch so frames never arrive out of order (querying `needsYou` only when `items` changed).
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

/** @type {any} */
let activeEventBus = null;

/**
 * Parse client metadata (`clientKind` and initial `focused` flag) from an SSE request.
 * @param {any} req
 */
function parseSseClientMeta(req) {
  const headers = req?.headers ?? {};
  let clientKind = typeof headers['x-whale-client'] === 'string' ? headers['x-whale-client'].trim().toLowerCase() : '';
  let focusedHeader = typeof headers['x-whale-focused'] === 'string' ? headers['x-whale-focused'].trim().toLowerCase() : '';

  if (typeof req?.url === 'string' && req.url.includes('?')) {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (!clientKind) clientKind = (url.searchParams.get('client') ?? '').trim().toLowerCase();
      if (!focusedHeader) focusedHeader = (url.searchParams.get('focused') ?? '').trim().toLowerCase();
    } catch {
      // Malformed query string falls back to default desktop metadata.
    }
  }

  const normalizedKind = clientKind === 'mobile' || clientKind === 'external' ? clientKind : 'desktop';
  const focused = focusedHeader === '0' || focusedHeader === 'false' ? false : true;
  return {
    clientKind: normalizedKind,
    focused,
    connectedAt: Date.now(),
    lastSeenAt: Date.now(),
  };
}

/**
 * Check whether a bus (or the latest active bus) currently has a live desktop SSE client.
 * @param {any} [bus]
 */
export function hasActiveDesktopClient(bus = activeEventBus) {
  return typeof bus?.hasActiveDesktopClient === 'function' ? bus.hasActiveDesktopClient() : false;
}

/**
 * Decide whether external IM/push notifications should be suppressed because
 * the desktop client is actively connected and in the foreground.
 * @param {any} [busOrOptions]
 * @param {Record<string, any>} [options]
 */
export function shouldSuppressExternalPush(busOrOptions = activeEventBus, options = undefined) {
  if (busOrOptions && typeof busOrOptions.shouldSuppressExternalPush === 'function') {
    return busOrOptions.shouldSuppressExternalPush(options);
  }
  if (typeof activeEventBus?.shouldSuppressExternalPush === 'function') {
    const opts = busOrOptions && typeof busOrOptions === 'object' ? busOrOptions : options;
    return activeEventBus.shouldSuppressExternalPush(opts);
  }
  return false;
}

/**
 * Create a micro-batched SSE & in-process change broadcaster for bots.
 * @param {{
 *   getNeedsYou?: (() => any) | null,
 *   coalesceMs?: number,
 * }} [options]
 */
export function createBotsEventBus({ getNeedsYou = null, coalesceMs = TAIL_COALESCE_MS } = {}) {
  /** @type {Map<any, { clientKind: string, focused: boolean, connectedAt: number, lastSeenAt: number }>} */
  const sseClients = new Map();
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
  /** @type {boolean | null} */
  let desktopForegroundOverride = null;
  let foregroundUpdatedAt = 0;

  function pruneDeadClients() {
    for (const [res] of [...sseClients]) {
      if (res.writableEnded || res.destroyed) {
        sseClients.delete(res);
      }
    }
  }

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const [res, meta] of [...sseClients]) {
      try {
        if (res.writableEnded || res.destroyed) {
          sseClients.delete(res);
        } else {
          res.write(`: ping ${now}\n\n`);
          meta.lastSeenAt = now;
        }
      } catch {
        sseClients.delete(res);
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  /** @param {string} eventName @param {any} data */
  function formatFrame(eventName, data) {
    seq += 1;
    return `id: ${seq}\nevent: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  /** @param {string} eventName @param {any} payload */
  function broadcastSse(eventName, payload) {
    if (sseClients.size === 0) return;
    const frame = formatFrame(eventName, payload);
    const now = Date.now();
    for (const [res, meta] of [...sseClients]) {
      try {
        if (res.writableEnded || res.destroyed) {
          sseClients.delete(res);
          continue;
        }
        res.write(frame);
        meta.lastSeenAt = now;
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

  /** @param {(payload: any) => void} fn */
  function subscribe(fn) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }

  /** @param {any} req @param {any} res */
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
    const meta = parseSseClientMeta(req);
    sseClients.set(res, meta);
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

  function activeDesktopClientsCount() {
    if (closed) return 0;
    pruneDeadClients();
    let count = 0;
    for (const meta of sseClients.values()) {
      if (meta.clientKind === 'desktop') count += 1;
    }
    return count;
  }

  function hasDesktopClient() {
    return activeDesktopClientsCount() > 0;
  }

  function isDesktopFocused() {
    if (desktopForegroundOverride !== null) return desktopForegroundOverride;
    for (const meta of sseClients.values()) {
      if (meta.clientKind === 'desktop' && meta.focused) return true;
    }
    return false;
  }

  /** @param {boolean | null} focused @param {{ now?: number }} [opts] */
  function setDesktopForeground(focused, { now = Date.now() } = {}) {
    desktopForegroundOverride = focused === null ? null : Boolean(focused);
    foregroundUpdatedAt = now;
    return getDesktopPresence();
  }

  function suppressExternalPush({ forceExternal = false, urgency = 'normal' } = {}) {
    if (forceExternal === true || urgency === 'critical') return false;
    return hasDesktopClient() && isDesktopFocused();
  }

  function getDesktopPresence() {
    const desktopClients = activeDesktopClientsCount();
    const focused = desktopClients > 0 && isDesktopFocused();
    return {
      activeClients: sseClients.size,
      desktopClients,
      focused,
      hasActiveDesktopClient: desktopClients > 0,
      suppressExternalPush: desktopClients > 0 && focused,
      updatedAt: foregroundUpdatedAt,
    };
  }

  function close() {
    closed = true;
    if (activeEventBus === bus) activeEventBus = null;
    if (flushTimer) clearTimeout(flushTimer);
    if (cooldownTimer) clearTimeout(cooldownTimer);
    flushTimer = null;
    cooldownTimer = null;
    clearInterval(heartbeat);
    pending.clear();
    listeners.clear();
    for (const [res] of [...sseClients]) {
      try { res.end(); } catch { /* Best-effort SSE socket teardown. */ }
    }
    sseClients.clear();
  }

  const bus = {
    emit,
    flushNow,
    subscribe,
    handleStream,
    close,
    clientCount: () => {
      pruneDeadClients();
      return sseClients.size;
    },
    hasActiveDesktopClient: hasDesktopClient,
    shouldSuppressExternalPush: suppressExternalPush,
    setDesktopForeground,
    getDesktopPresence,
  };

  activeEventBus = bus;
  return bus;
}
