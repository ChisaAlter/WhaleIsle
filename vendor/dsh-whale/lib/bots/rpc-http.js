/**
 * `/dsh-bots` HTTP transport layer: mascot asset serving, HMAC-SHA256 webhooks,
 * SSE stream routing, and bounded JSON RPC dispatch.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BotsDisabledError } from '../../src/shared/index.js';

const MAX_RPC_BODY_BYTES = 4 * 1024 * 1024;
const MAX_WEBHOOK_BODY_BYTES = 1 * 1024 * 1024;
const MASCOT_FILE_RE = /^(?:[A-Z][0-9](?:-rim)?\.(?:svg|webp)|manifest\.json)$/;
const ASSETS_MASCOTS_DIR = fileURLToPath(new URL('../../assets/mascots/', import.meta.url));
const WEBHOOKS_PREFIX = '/dsh-bots/webhooks/';

const ALLOWED_WHEN_DISABLED = new Set([
  'bots.list',
  'bots.settings.get',
  'bots.settings.set',
  'bots.settings.update',
  'bots.models',
  'bots.agentChoices',
  'bots.roster',
  'bots.voice.state',
]);

/** @param {string} filename */
function mascotContentType(filename) {
  if (filename.endsWith('.svg')) return 'image/svg+xml; charset=utf-8';
  if (filename.endsWith('.webp')) return 'image/webp';
  return 'application/json; charset=utf-8';
}

/** @param {any} req @param {number} maxBytes */
async function readBoundedBuffer(req, maxBytes) {
  const declared = req.headers?.['content-length'];
  if (declared !== undefined && Number(declared) > maxBytes) {
    throw Object.assign(new Error('payload too large'), { status: 413, code: 'payload_too_large' });
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.byteLength;
    if (total > maxBytes) {
      req.destroy?.();
      throw Object.assign(new Error('payload too large'), { status: 413, code: 'payload_too_large' });
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/** @param {any} req @param {number} maxBytes */
async function readBoundedJson(req, maxBytes) {
  const raw = await readBoundedBuffer(req, maxBytes);
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw Object.assign(new Error('body is not valid JSON'), { status: 400, code: 'invalid_json' });
  }
}

/** @param {any} res @param {number} status @param {any} payload @param {Record<string, string>} [extraHeaders] */
function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...extraHeaders });
  res.end(JSON.stringify(payload));
}

/** @param {Buffer} rawBody */
function parseWebhookPayload(rawBody) {
  const text = rawBody.toString('utf8');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * @param {string} rawSegment
 * @returns {{ ok: true, webhookId: string } | { ok: false, status: number, code: string, message: string }}
 */
function parseInboundWebhookId(rawSegment) {
  try {
    const id = decodeURIComponent(rawSegment).trim();
    if (!id || id.includes('/')) return { ok: false, status: 404, code: 'webhook_not_found', message: 'Webhook not found' };
    return { ok: true, webhookId: id };
  } catch {
    return { ok: false, status: 400, code: 'invalid_webhook_id', message: 'Malformed webhook id' };
  }
}

/** @param {any} res @param {string} webhookId @param {any} req @param {any} ver */
function sendWebhookVerificationRejection(res, webhookId, req, ver) {
  if (ver.duplicate === true || ver.code === 'duplicate_event') {
    sendJson(res, 200, {
      ok: true,
      duplicate: true,
      deduplicated: true,
      webhookId,
      eventId: req.headers?.['x-whale-event-id'] ?? null,
      event: ver.event ?? null,
    });
    return;
  }
  /** @type {Record<string, string>} */
  const extraHeaders = ver.retryAfterSec ? { 'retry-after': String(ver.retryAfterSec) } : {};
  sendJson(res, ver.status ?? 401, {
    ok: false,
    error: { code: ver.code ?? 'unauthorized', message: ver.error ?? 'Webhook verification failed' },
  }, extraHeaders);
}

/** @param {any} runtime @param {any} ver @param {Buffer} rawBody @param {any} res */
async function dispatchVerifiedWebhook(runtime, ver, rawBody, res) {
  try {
    const dispatchRes = await runtime.automationsService.triggerWebhook({
      automationId: ver.automationId,
      botId: ver.botId,
      webhookId: ver.webhookId,
      eventId: ver.eventId,
      payload: parseWebhookPayload(rawBody),
    });
    if (ver.event?.id) {
      runtime.workStore.updateWebhookEventStatus?.(ver.event.id, 'dispatched', { automationId: ver.automationId });
    }
    sendJson(res, 200, {
      ok: true,
      duplicate: false,
      webhookId: ver.webhookId,
      eventId: ver.eventId,
      botId: ver.botId,
      matched: dispatchRes.matched,
      dispatches: dispatchRes.dispatches,
    });
  } catch (error) {
    const err = /** @type {any} */ (error);
    if (ver.event?.id) {
      runtime.workStore.updateWebhookEventStatus?.(ver.event.id, 'failed', { automationId: ver.automationId });
    }
    sendJson(res, 500, {
      ok: false,
      error: { code: 'webhook_dispatch_failed', message: String(err?.message ?? err) },
    });
  }
}

/** @param {any} runtime @param {string} rawSegment @param {any} req @param {any} res */
async function handleInboundWebhookPost(runtime, rawSegment, req, res) {
  const parsedId = parseInboundWebhookId(rawSegment);
  if (!parsedId.ok) {
    sendJson(res, parsedId.status, { ok: false, error: { code: parsedId.code, message: parsedId.message } });
    return;
  }
  if (!runtime.botsService.getGlobalSettings().botsEnabled) {
    sendJson(res, 503, { ok: false, error: { code: 'bots_disabled', message: 'Bots are disabled' } });
    return;
  }

  let rawBody;
  try {
    rawBody = await readBoundedBuffer(req, MAX_WEBHOOK_BODY_BYTES);
  } catch (error) {
    const err = /** @type {any} */ (error);
    sendJson(res, err?.status ?? 400, {
      ok: false,
      error: { code: err?.code ?? 'bad_request', message: String(err?.message ?? err) },
    });
    return;
  }

  const ver = runtime.connectorsService.verifyInboundWebhook({
    webhookId: parsedId.webhookId,
    timestamp: req.headers?.['x-whale-timestamp'],
    signature: req.headers?.['x-whale-signature'],
    eventId: req.headers?.['x-whale-event-id'],
    rawBody,
  });

  if (!ver.ok) {
    sendWebhookVerificationRejection(res, parsedId.webhookId, req, ver);
    return;
  }
  await dispatchVerifiedWebhook(runtime, ver, rawBody, res);
}

/**
 * Create the `/dsh-bots` HTTP request handler (usable both in Harness `webServer`
 * and directly in Node HTTP integration tests).
 * @param {any} runtime
 * @param {Record<string, (p: any) => any>} table
 * @param {{ mascotsDir?: string, requestRejection?: (req: any, peer?: any) => number | undefined }} [options]
 */
export function buildBotsHttpHandler(runtime, table, options = {}) {
  const mascotsDir = path.resolve(options.mascotsDir || ASSETS_MASCOTS_DIR);
  /** @param {any} req @param {any} [peer] */
  const checkAuth = (req, peer) => {
    if (typeof options.requestRejection === 'function') {
      return options.requestRejection(req, peer);
    }
    let admittedPeer = peer;
    if (admittedPeer === undefined) {
      const connection = runtime.ctx?.get?.('connection') ?? runtime.ctx?.connection;
      if (connection && typeof connection.admit === 'function') {
        const admission = connection.admit(req);
        if (admission && typeof admission === 'object' && 'rejection' in admission) {
          return admission.rejection;
        }
        admittedPeer = admission?.peer;
      }
    }
    if (!admittedPeer) return 401;
    if (admittedPeer.principal?.kind !== 'owner') return 403;
    return undefined;
  };

  /** @param {any} method @param {any} params */
  async function invokeRpc(method, params) {
    if (typeof method !== 'string' || !Object.prototype.hasOwnProperty.call(table, method)) {
      throw Object.assign(new Error(`Unknown RPC method: ${String(method)}`), { code: 'unknown_method' });
    }
    const enabled = runtime.botsService.getGlobalSettings().botsEnabled;
    if (!enabled && !ALLOWED_WHEN_DISABLED.has(method)) {
      throw new BotsDisabledError();
    }
    return table[method](params ?? {});
  }

  /** @param {string} filename @param {any} res */
  function serveMascotAsset(filename, res) {
    if (!MASCOT_FILE_RE.test(filename)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const target = path.resolve(mascotsDir, filename);
    if (!target.startsWith(mascotsDir + path.sep) || !fs.existsSync(target)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const data = fs.readFileSync(target);
    res.writeHead(200, {
      'content-type': mascotContentType(filename),
      'cache-control': 'public, max-age=86400, immutable',
      'content-length': data.byteLength,
    });
    res.end(data);
  }

  /** @param {any} req @param {any} res */
  async function handleRpcPost(req, res) {
    const contentType = String(req.headers?.['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
    if (contentType !== 'application/json') {
      sendJson(res, 415, { ok: false, error: { code: 'unsupported_media_type', message: 'content type must be application/json' } });
      return;
    }
    let body;
    try {
      body = await readBoundedJson(req, MAX_RPC_BODY_BYTES);
    } catch (error) {
      const err = /** @type {any} */ (error);
      sendJson(res, err?.status ?? 400, {
        ok: false,
        error: { code: err?.code ?? 'bad_request', message: String(err?.message ?? err) },
      });
      return;
    }
    try {
      const result = await invokeRpc(body?.method, body?.params);
      sendJson(res, 200, { ok: true, result });
    } catch (error) {
      const err = /** @type {any} */ (error);
      sendJson(res, 200, {
        ok: false,
        error: {
          code: String(err?.code ?? 'internal_error'),
          message: String(err?.message ?? error),
          ...(err?.data !== undefined ? { data: err.data } : {}),
        },
      });
    }
  }

  /** @param {any} req @param {any} res @param {any} [peer] */
  async function handler(req, res, peer) {
    const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname;
    if (req.method === 'GET' && pathname.startsWith('/dsh-bots/assets/mascots/')) {
      serveMascotAsset(pathname.slice('/dsh-bots/assets/mascots/'.length), res);
      return;
    }
    if (req.method === 'POST' && pathname.startsWith(WEBHOOKS_PREFIX)) {
      await handleInboundWebhookPost(runtime, pathname.slice(WEBHOOKS_PREFIX.length), req, res);
      return;
    }
    const rejection = checkAuth(req, peer);
    if (rejection !== undefined) {
      res.writeHead(rejection);
      res.end(rejection === 401 ? 'unauthorized' : 'forbidden');
      return;
    }
    if (req.method === 'GET' && pathname === '/dsh-bots/events') {
      runtime.eventBus.handleStream(req, res);
      return;
    }
    if (req.method !== 'POST' || pathname !== '/dsh-bots/rpc') {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    await handleRpcPost(req, res);
  }

  return { handler, invokeRpc };
}
