/**
 * Bot Connectors (all 9 `dsh-im` channels + multi-bot IM routing + HMAC-SHA256
 * signed Webhooks) and Who-Can-Ask Access Approval service.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  BOT_IM_CHANNELS,
  BOT_LIMITS,
  BOT_WEBHOOK_MAX_SKEW_SEC,
  BOT_WEBHOOK_RATE_LIMIT_PER_MIN,
} from '../../src/shared/index.js';
import {
  botMetaDir,
  readImRoutes,
  readWebhookCredentials,
  writeImRoutes,
  writeWebhookCredentials,
} from './fs-home.js';

/** @type {Readonly<Record<string, string>>} */
const CHANNEL_LABELS = Object.freeze({
  feishu: 'Feishu', wecom: 'WeCom', dingtalk: 'DingTalk',
  telegram: 'Telegram', discord: 'Discord', slack: 'Slack',
  qq: 'QQ', weixin: 'Weixin', whatsapp: 'WhatsApp',
});

const CHANNEL_SET = new Set(BOT_IM_CHANNELS);
const RATE_WINDOW_MS = 60_000;
const HEX_SIG_RE = /^(?:(?:sha256|v1)=)?([0-9a-f]{64})$/iu;

/** @param {unknown} value */
const cleanStr = (value) => (typeof value === 'string' && value.trim() ? value.trim() : '');

/** @param {any} obj @param {string[]} keys */
function firstCleanField(obj, keys) {
  for (const k of keys) {
    const val = cleanStr(obj?.[k]);
    if (val) return val;
  }
  return '';
}

/** @param {string} filePath */
function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** @param {any} item */
function mapAccountEntry(item) {
  if (!item || typeof item !== 'object' || item.deletionPending === true) return null;
  const accountId = firstCleanField(item, ['botId', 'id', 'accountId', 'appId', 'clientId', 'platformId']);
  if (!accountId) return null;
  const label = firstCleanField(item, ['botName', 'name', 'displayName']) || accountId;
  return { accountId, label, enabled: item.enabled !== false };
}

/** @param {any} entry */
function extractAccountsFromChannelDoc(entry) {
  if (!entry || typeof entry !== 'object') return [];
  const rawList = Array.isArray(entry.bots) ? entry.bots : (Array.isArray(entry.accounts) ? entry.accounts : []);
  const accounts = rawList.map(mapAccountEntry).filter(Boolean);
  if (accounts.length > 0) return accounts;
  const fallbackId = firstCleanField(entry, ['id', 'botId', 'accountId', 'appId', 'clientId']);
  if (!fallbackId) return [];
  return [{ accountId: fallbackId, label: firstCleanField(entry, ['botName', 'name']) || fallbackId, enabled: entry.enabled !== false }];
}

/** @param {string} dshHome @param {string} kind */
function probeDirectChannelFiles(dshHome, kind) {
  const candidates = [
    path.join(dshHome, 'integrations', 'dsh-im', kind, 'config.json'),
    path.join(dshHome, 'integrations', 'dsh-im', `${kind}.json`),
    path.join(dshHome, 'integrations', `dsh-${kind}`, 'config.json'),
  ];
  for (const file of candidates) {
    const doc = readJsonSafe(file);
    if (!doc) continue;
    const accounts = extractAccountsFromChannelDoc(doc);
    const hasConfigured = accounts.length > 0 || doc.enabled === true;
    if (hasConfigured || doc.enabled !== undefined) {
      return { configured: hasConfigured && doc.enabled !== false, accounts, source: file };
    }
  }
  return null;
}

/** @param {any} section @param {string} source @param {boolean} requireKeys */
function probeSectionEntry(section, source, requireKeys) {
  if (!section || typeof section !== 'object') return null;
  const accounts = extractAccountsFromChannelDoc(section);
  const nonEmpty = !requireKeys || accounts.length > 0 || Object.keys(section).length > 0;
  return { configured: section.enabled !== false && nonEmpty, accounts, source };
}

/** @param {string} dshHome @param {string} kind @param {any} unifiedIm @param {any} legacyIm */
function probeChannelConfig(dshHome, kind, unifiedIm, legacyIm) {
  const direct = probeDirectChannelFiles(dshHome, kind);
  if (direct) return direct;
  const fromUnified = probeSectionEntry(
    unifiedIm?.channels?.[kind] ?? unifiedIm?.[kind],
    path.join(dshHome, 'integrations', 'dsh-im', 'config.json'),
    true,
  );
  if (fromUnified) return fromUnified;
  const fromLegacy = probeSectionEntry(
    legacyIm?.channels?.[kind] ?? legacyIm?.[kind],
    path.join(dshHome, 'data', 'im', 'config.json'),
    false,
  );
  return fromLegacy ?? { configured: false, accounts: [], source: null };
}

/**
 * Inspect local `dsh-im` configuration files read-only across all 9 channels.
 * Reads `$DSH_HOME/integrations/dsh-im/` (and per-channel `integrations/dsh-<kind>/`),
 * falling back to legacy `$DSH_HOME/data/im/config.json`.
 * @param {string} dshHome
 */
export function inspectLocalImChannels(dshHome) {
  const unifiedIm = dshHome ? readJsonSafe(path.join(dshHome, 'integrations', 'dsh-im', 'config.json')) : null;
  const legacyIm = dshHome ? readJsonSafe(path.join(dshHome, 'data', 'im', 'config.json')) : null;
  return BOT_IM_CHANNELS.map((kind) => {
    const probed = dshHome ? probeChannelConfig(dshHome, kind, unifiedIm, legacyIm) : { configured: false, accounts: [], source: null };
    return {
      kind,
      configured: probed.configured,
      enabled: probed.configured,
      label: CHANNEL_LABELS[kind] ?? kind,
      accounts: probed.accounts,
      configSource: probed.source,
    };
  });
}

/** @param {any} webhooks */
function sanitizeWebhooksForView(webhooks) {
  return (Array.isArray(webhooks) ? webhooks : []).map((w) => ({
    id: String(w.id ?? ''),
    name: String(w.name ?? 'Webhook'),
    enabled: w.enabled !== false,
    path: `/dsh-bots/webhooks/${encodeURIComponent(String(w.id ?? ''))}`,
    hasSecret: Boolean(w.secretHash || w.secret),
    automationId: w.automationId ?? null,
    createdAt: w.createdAt ?? null,
  }));
}

/**
 * Compute canonical `HMAC-SHA256(secret, `${timestamp}.${rawBody}`)` hex signature.
 * @param {{ secret: string, timestamp: string | number, rawBody: string | Buffer }} input
 */
export function signWebhookPayload({ secret, timestamp, rawBody }) {
  const tsStr = String(timestamp ?? '').trim();
  const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody ?? '');
  return crypto.createHmac('sha256', String(secret)).update(`${tsStr}.${bodyStr}`).digest('hex');
}

/** @param {string} expectedHex @param {string} providedHeader */
function verifyHmacSignature(expectedHex, providedHeader) {
  const match = HEX_SIG_RE.exec(cleanStr(providedHeader));
  if (!match) return false;
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const providedBuf = Buffer.from(match[1].toLowerCase(), 'hex');
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

/** @param {string | number} rawTimestamp */
function parseTimestampSeconds(rawTimestamp) {
  const raw = String(rawTimestamp ?? '').trim();
  if (!raw || !/^\d+(?:\.\d+)?$/u.test(raw)) return null;
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return null;
  const seconds = num > 1e12 ? Math.floor(num / 1000) : Math.trunc(num);
  return { raw, seconds };
}

/** @param {string} channel @param {string | null | undefined} accountId */
function buildRouteKey(channel, accountId) {
  const normChannel = cleanStr(channel).toLowerCase();
  if (!CHANNEL_SET.has(normChannel)) {
    throw Object.assign(new Error(`Unsupported IM channel: ${String(channel ?? '')}`), { code: 'invalid_argument' });
  }
  const normAccount = cleanStr(accountId);
  return {
    channel: normChannel,
    accountId: normAccount || null,
    routeKey: normAccount ? `${normChannel}:${normAccount}` : normChannel,
  };
}

/** @param {string} routeKey @param {any} entry @param {any} botsStore @param {number} fallbackUpdatedAt */
function hydrateRouteEntry(routeKey, entry, botsStore, fallbackUpdatedAt) {
  const colonIdx = routeKey.indexOf(':');
  const liveBot = entry.botId ? botsStore.getBot(entry.botId) : null;
  return {
    routeKey,
    channel: entry.channel ?? (colonIdx >= 0 ? routeKey.slice(0, colonIdx) : routeKey),
    accountId: entry.accountId ?? (colonIdx >= 0 ? routeKey.slice(colonIdx + 1) : null),
    botId: entry.botId ?? null,
    botName: liveBot?.name ?? entry.botName ?? null,
    sessionId: liveBot?.chatSessionId ?? entry.sessionId ?? '',
    enabled: liveBot ? !liveBot.paused : (entry.enabled !== false),
    updatedAt: entry.updatedAt ?? fallbackUpdatedAt,
  };
}

/**
 * @param {any} rawInput
 * @returns {{ ok: true, webhookId: string, eventId: string, signature: string, rawBody: any } | { ok: false, rejection: Record<string, any> }}
 */
function validateWebhookEnvelope(rawInput) {
  const webhookId = cleanStr(rawInput?.webhookId);
  const eventId = cleanStr(rawInput?.eventId);
  const signature = cleanStr(rawInput?.signature);
  const rawBody = rawInput?.rawBody;
  if (!webhookId || !eventId || !signature || rawBody === undefined || rawBody === null) {
    return {
      ok: false,
      rejection: { ok: false, status: 400, code: 'invalid_webhook_headers', error: 'Missing required webhook headers or body' },
    };
  }
  return { ok: true, webhookId, eventId, signature, rawBody };
}

/**
 * Create the Bot Connectors, IM Multi-Bot Routing, Signed Webhook, and Access Request service.
 * @param {{
 *   dshHome: string,
 *   botsStore: any,
 *   workStore: any,
 *   eventBus: any,
 *   onBotUpdated?: (bot: any) => void,
 *   webhookMaxSkewSec?: number,
 *   webhookRateLimitPerMin?: number,
 * }} deps
 */
export function createConnectorsService(deps) {
  const { dshHome, botsStore, workStore, eventBus } = deps;
  const metaRoot = botMetaDir(dshHome);
  const maxSkewSec = typeof deps.webhookMaxSkewSec === 'number' && Number.isFinite(deps.webhookMaxSkewSec)
    ? deps.webhookMaxSkewSec
    : BOT_WEBHOOK_MAX_SKEW_SEC;
  const rateLimitPerMin = typeof deps.webhookRateLimitPerMin === 'number' && Number.isFinite(deps.webhookRateLimitPerMin)
    ? deps.webhookRateLimitPerMin
    : BOT_WEBHOOK_RATE_LIMIT_PER_MIN;
  /** @type {Map<string, number[]>} */
  const rateBuckets = new Map();

  /** @param {string} botId */
  function requireBot(botId) {
    const bot = botsStore.getBot(botId);
    if (!bot) throw Object.assign(new Error(`Bot not found: ${botId}`), { code: 'bot_not_found' });
    return bot;
  }

  function listChannelBotRoutes() {
    const doc = readImRoutes(metaRoot);
    const rawRoutes = doc.routes && typeof doc.routes === 'object' ? doc.routes : {};
    const fallbackTs = doc.updatedAt ?? 0;
    /** @type {Record<string, any>} */
    const hydrated = {};
    /** @type {Array<any>} */
    const items = [];
    for (const [routeKey, entry] of Object.entries(rawRoutes)) {
      if (!entry || typeof entry !== 'object') continue;
      const resolved = hydrateRouteEntry(routeKey, entry, botsStore, fallbackTs);
      hydrated[routeKey] = resolved;
      items.push(resolved);
    }
    return { version: doc.version ?? 1, updatedAt: fallbackTs, routes: hydrated, items };
  }

  /** @param {{ channel?: string, accountId?: string | null, botId?: string | null }} [params] @param {number} [now] */
  function setChannelBotRoute(params = {}, now = Date.now()) {
    const { channel = '', accountId = null, botId = null } = params;
    const { channel: normChannel, accountId: normAccount, routeKey } = buildRouteKey(channel, accountId);
    const doc = readImRoutes(metaRoot);
    const routes = doc.routes && typeof doc.routes === 'object' ? { ...doc.routes } : {};
    const cleanBotId = cleanStr(botId);

    if (!cleanBotId) {
      const prev = routes[routeKey] ?? null;
      delete routes[routeKey];
      writeImRoutes(metaRoot, { version: 1, routes, updatedAt: now });
      eventBus.emit({ ...(prev?.botId ? { botIds: [prev.botId] } : {}), kinds: ['bot', 'threads'] });
      return { routeKey, channel: normChannel, accountId: normAccount, botId: null, removed: Boolean(prev), routes };
    }

    const bot = requireBot(cleanBotId);
    const entry = {
      channel: normChannel,
      accountId: normAccount,
      botId: bot.id,
      botName: bot.name,
      sessionId: bot.chatSessionId ?? '',
      enabled: !bot.paused,
      updatedAt: now,
    };
    routes[routeKey] = entry;
    writeImRoutes(metaRoot, { version: 1, routes, updatedAt: now });
    eventBus.emit({ botIds: [bot.id], kinds: ['bot', 'threads'] });
    return { routeKey, route: entry, routes };
  }

  /** @param {any} bot @param {number} [now] */
  function syncBotImRoutes(bot, now = Date.now()) {
    if (!bot?.id) return false;
    const doc = readImRoutes(metaRoot);
    const routes = doc.routes && typeof doc.routes === 'object' ? { ...doc.routes } : {};
    let changed = false;
    for (const [key, entry] of Object.entries(routes)) {
      if (!entry || entry.botId !== bot.id) continue;
      const nextSession = bot.chatSessionId ?? '';
      const nextEnabled = !bot.paused;
      if (entry.sessionId !== nextSession || entry.enabled !== nextEnabled || entry.botName !== bot.name) {
        routes[key] = { ...entry, botName: bot.name, sessionId: nextSession, enabled: nextEnabled, updatedAt: now };
        changed = true;
      }
    }
    if (!changed) return false;
    writeImRoutes(metaRoot, { version: 1, routes, updatedAt: now });
    return true;
  }

  /** @param {string} botId */
  function listConnectors(botId) {
    const bot = requireBot(botId);
    const imChannels = inspectLocalImChannels(dshHome);
    const bound = bot.connectors && typeof bot.connectors === 'object' ? bot.connectors : {};
    const botRoutes = listChannelBotRoutes().items.filter((r) => r.botId === bot.id);
    return {
      botId: bot.id,
      imDefault: bot.imDefault === true,
      imChannels: imChannels.map((ch) => {
        const channelRoutes = botRoutes.filter((r) => r.channel === ch.kind);
        return {
          ...ch,
          bound: Boolean(channelRoutes.length > 0 || bound.im?.[ch.kind] || (bot.imDefault === true && ch.configured)),
          routes: channelRoutes,
        };
      }),
      imRoutes: botRoutes,
      webhooks: sanitizeWebhooksForView(bound.webhooks),
    };
  }

  /** @param {string} botId */
  function listWebhooks(botId) {
    const bot = requireBot(botId);
    const bound = bot.connectors && typeof bot.connectors === 'object' ? bot.connectors : {};
    return sanitizeWebhooksForView(bound.webhooks);
  }

  /** @param {string} botId @param {Record<string, any>} [params] @param {number} [now] */
  function createWebhook(botId, params = {}, now = Date.now()) {
    const bot = requireBot(botId);
    const prev = bot.connectors && typeof bot.connectors === 'object' ? bot.connectors : {};
    const existing = Array.isArray(prev.webhooks) ? [...prev.webhooks] : [];
    if (existing.length >= 16) {
      throw Object.assign(new Error('Maximum 16 webhooks per bot exceeded'), { code: 'invalid_argument' });
    }
    const id = cleanStr(params.id) || `wh_${crypto.randomBytes(6).toString('hex')}`;
    if (existing.some((w) => w.id === id)) {
      throw Object.assign(new Error(`Webhook already exists: ${id}`), { code: 'already_exists' });
    }
    const secret = cleanStr(params.secret) || crypto.randomBytes(32).toString('hex');
    const creds = readWebhookCredentials(metaRoot);
    creds[id] = { botId: bot.id, secret, createdAt: now, updatedAt: now };
    writeWebhookCredentials(metaRoot, creds);

    const record = {
      id,
      name: String(params.name || 'Webhook').trim().slice(0, 80) || 'Webhook',
      enabled: params.enabled !== false,
      secretHash: crypto.createHash('sha256').update(secret).digest('hex'),
      automationId: cleanStr(params.automationId) || null,
      createdAt: now,
    };
    const updated = botsStore.updateBot(bot.id, { connectors: { ...prev, webhooks: [...existing, record] } });
    deps.onBotUpdated?.(updated);
    eventBus.emit({ botIds: [bot.id], kinds: ['bot', 'threads'] });
    return { webhook: sanitizeWebhooksForView([record])[0], secret };
  }

  /** @param {string} botId @param {string} webhookId */
  function deleteWebhook(botId, webhookId) {
    const bot = requireBot(botId);
    const cleanId = cleanStr(webhookId);
    if (!cleanId) throw Object.assign(new Error('webhookId is required'), { code: 'invalid_argument' });
    const prev = bot.connectors && typeof bot.connectors === 'object' ? bot.connectors : {};
    const existing = Array.isArray(prev.webhooks) ? prev.webhooks : [];
    const nextWebhooks = existing.filter((/** @type {any} */ w) => w.id !== cleanId);
    const deleted = nextWebhooks.length !== existing.length;

    const creds = readWebhookCredentials(metaRoot);
    if (creds[cleanId] && creds[cleanId].botId === bot.id) {
      delete creds[cleanId];
      writeWebhookCredentials(metaRoot, creds);
    }
    if (deleted) {
      const updated = botsStore.updateBot(bot.id, { connectors: { ...prev, webhooks: nextWebhooks } });
      deps.onBotUpdated?.(updated);
      eventBus.emit({ botIds: [bot.id], kinds: ['bot', 'threads'] });
    }
    return { deleted, webhookId: cleanId };
  }

  /** @param {string} botId @param {Array<any>} rawWebhooks */
  function syncWebhooksPatch(botId, rawWebhooks) {
    const creds = readWebhookCredentials(metaRoot);
    const keepIds = new Set();
    let credsDirty = false;
    const sanitized = rawWebhooks.slice(0, 16).map((/** @type {any} */ w) => {
      const id = cleanStr(w.id) || `wh_${crypto.randomBytes(6).toString('hex')}`;
      keepIds.add(id);
      let secretHash = w.secretHash ?? null;
      const rawSecret = cleanStr(w.secret);
      if (rawSecret) {
        creds[id] = { botId, secret: rawSecret, createdAt: w.createdAt ?? Date.now(), updatedAt: Date.now() };
        secretHash = crypto.createHash('sha256').update(rawSecret).digest('hex');
        credsDirty = true;
      }
      return {
        id,
        name: String(w.name || 'Webhook').trim().slice(0, 80) || 'Webhook',
        enabled: w.enabled !== false,
        secretHash,
        automationId: cleanStr(w.automationId) || null,
        createdAt: w.createdAt ?? Date.now(),
      };
    });
    for (const [credId, entry] of Object.entries(creds)) {
      if (entry?.botId === botId && !keepIds.has(credId)) {
        delete creds[credId];
        credsDirty = true;
      }
    }
    if (credsDirty) writeWebhookCredentials(metaRoot, creds);
    return sanitized;
  }

  /** @param {string} botId @param {Record<string, any>} [patch] */
  function updateConnectors(botId, patch = {}) {
    const bot = requireBot(botId);
    const prev = bot.connectors && typeof bot.connectors === 'object' ? bot.connectors : {};
    const nextConnectors = {
      ...prev,
      ...(patch.im && typeof patch.im === 'object' ? { im: { ...(prev.im ?? {}), ...patch.im } } : {}),
    };
    if (Array.isArray(patch.webhooks)) {
      nextConnectors.webhooks = syncWebhooksPatch(bot.id, patch.webhooks);
    }
    /** @type {Record<string, any>} */
    const botPatch = { connectors: nextConnectors };
    if (typeof patch.imDefault === 'boolean') botPatch.imDefault = patch.imDefault;
    const updated = botsStore.updateBot(bot.id, botPatch);
    deps.onBotUpdated?.(updated);
    eventBus.emit({ botIds: [bot.id], kinds: ['bot', 'threads'] });
    return listConnectors(bot.id);
  }

  /** @param {string} webhookId @param {number} now */
  function checkWebhookRateLimit(webhookId, now) {
    const cutoff = now - RATE_WINDOW_MS;
    const active = (rateBuckets.get(webhookId) ?? []).filter((ts) => ts > cutoff);
    if (active.length >= rateLimitPerMin) {
      rateBuckets.set(webhookId, active);
      return { allowed: false, retryAfterSec: Math.ceil(Math.max(1000, active[0] + RATE_WINDOW_MS - now) / 1000) };
    }
    active.push(now);
    rateBuckets.set(webhookId, active);
    return { allowed: true, retryAfterSec: 0 };
  }

  /** @param {string} webhookId */
  function resolveWebhookConfig(webhookId) {
    const cred = readWebhookCredentials(metaRoot)[webhookId];
    if (!cred || typeof cred !== 'object' || !cleanStr(cred.secret) || !cleanStr(cred.botId)) return null;
    const bot = botsStore.getBot(cred.botId);
    if (!bot) return null;
    const hooks = Array.isArray(bot.connectors?.webhooks) ? bot.connectors.webhooks : [];
    return { bot, cred, meta: hooks.find((/** @type {any} */ w) => w.id === webhookId) ?? null };
  }

  /**
   * @param {any} timestamp
   * @param {number} now
   * @returns {{ ok: true, parsedTs: { raw: string, seconds: number } } | { ok: false, rejection: Record<string, any> }}
   */
  function checkWebhookTimestamp(timestamp, now) {
    const parsedTs = parseTimestampSeconds(timestamp);
    if (!parsedTs) {
      return { ok: false, rejection: { ok: false, status: 401, code: 'invalid_timestamp', error: 'Invalid x-whale-timestamp header' } };
    }
    const skewSec = Math.abs(Math.floor(now / 1000) - parsedTs.seconds);
    if (skewSec > maxSkewSec) {
      return {
        ok: false,
        rejection: { ok: false, status: 401, code: 'timestamp_out_of_window', skewSec, error: `Webhook timestamp skew (${skewSec}s) exceeds ±${maxSkewSec}s` },
      };
    }
    return { ok: true, parsedTs };
  }

  /**
   * Verify an inbound signed webhook request:
   * - Per-hook 30 req/min sliding window rate limit
   * - Timestamp window check (±300s)
   * - Constant-time HMAC-SHA256 verification (`HMAC-SHA256(secret, `${ts}.${rawBody}`)`)
   * - Replay/idempotency ledger via `workStore.recordWebhookEvent`
   * @param {Record<string, any>} [input]
   */
  function verifyInboundWebhook(input = {}) {
    const now = typeof input?.now === 'number' && Number.isFinite(input.now) ? input.now : Date.now();
    const env = validateWebhookEnvelope(input);
    if (!env.ok) return env.rejection;

    const rate = checkWebhookRateLimit(env.webhookId, now);
    if (!rate.allowed) {
      return { ok: false, status: 429, code: 'rate_limited', retryAfterSec: rate.retryAfterSec, error: `Webhook rate limit exceeded (${rateLimitPerMin} req/min)` };
    }
    const tsCheck = checkWebhookTimestamp(input.timestamp, now);
    if (!tsCheck.ok) return tsCheck.rejection;

    const resolved = resolveWebhookConfig(env.webhookId);
    if (!resolved) return { ok: false, status: 404, code: 'webhook_not_found', error: `Unknown webhook: ${env.webhookId}` };
    if (resolved.meta?.enabled === false) {
      return { ok: false, status: 403, code: 'webhook_disabled', error: `Webhook is disabled: ${env.webhookId}` };
    }

    const rawBodyBuf = Buffer.isBuffer(env.rawBody) ? env.rawBody : Buffer.from(String(env.rawBody), 'utf8');
    const expectedHex = signWebhookPayload({ secret: resolved.cred.secret, timestamp: tsCheck.parsedTs.raw, rawBody: rawBodyBuf });
    if (!verifyHmacSignature(expectedHex, env.signature)) {
      return { ok: false, status: 401, code: 'invalid_signature', error: 'Invalid webhook HMAC-SHA256 signature' };
    }

    const payloadSha256 = crypto.createHash('sha256').update(rawBodyBuf).digest('hex');
    const recorded = workStore.recordWebhookEvent({
      botId: resolved.bot.id,
      webhookId: env.webhookId,
      eventId: env.eventId,
      signatureTs: tsCheck.parsedTs.seconds,
      status: 'accepted',
      automationId: resolved.meta?.automationId ?? null,
      payloadSha256,
    }, now);

    if (recorded.duplicate) {
      return { ok: false, status: 409, code: 'duplicate_event', duplicate: true, event: recorded.event, error: `Duplicate webhook event: ${env.eventId}` };
    }
    return {
      ok: true,
      status: 200,
      botId: resolved.bot.id,
      webhookId: env.webhookId,
      eventId: env.eventId,
      automationId: resolved.meta?.automationId ?? null,
      payloadSha256,
      event: recorded.event,
    };
  }

  function listAccessRequests({ botId = null, status = null } = {}) {
    return workStore.listAccessRequests({ botId, status });
  }

  /** @param {string} botId @param {any} req */
  function grantMemberToBot(botId, req) {
    const bot = botsStore.getBot(botId);
    if (!bot) return;
    const members = Array.isArray(bot.members) ? [...bot.members] : [];
    const exists = members.some((m) => m.id === req.requesterId && (m.source ?? null) === (req.source ?? null));
    if (exists || members.length >= BOT_LIMITS.maxMembers) return;
    members.push({
      id: req.requesterId,
      name: req.requesterName || req.requesterId,
      source: req.source,
      ...(req.workspaceId ? { workspaceId: req.workspaceId } : {}),
    });
    const updated = botsStore.updateBot(bot.id, { members });
    deps.onBotUpdated?.(updated);
  }

  /** @param {{ id: string, decision: string, decidedBy?: string }} params */
  function decideAccessRequest({ id, decision, decidedBy = 'owner' }) {
    const decided = workStore.decideAccessRequest(id, { decision, decidedBy });
    if (decided.status === 'granted') grantMemberToBot(decided.botId, decided);
    eventBus.emit({ botIds: [decided.botId], kinds: ['access', 'bot'] });
    return decided;
  }

  /** @param {{ token: string, decision?: string, decidedBy?: string }} params */
  function redeemAccessToken({ token, decision = 'granted', decidedBy = 'owner' }) {
    const decided = workStore.redeemAccessToken(token, { decision, decidedBy });
    if (decided.status === 'granted') grantMemberToBot(decided.botId, decided);
    eventBus.emit({ botIds: [decided.botId], kinds: ['access', 'bot'] });
    return decided;
  }

  return {
    listConnectors,
    updateConnectors,
    setChannelBotRoute,
    listChannelBotRoutes,
    syncBotImRoutes,
    listWebhooks,
    createWebhook,
    deleteWebhook,
    verifyInboundWebhook,
    listAccessRequests,
    decideAccessRequest,
    redeemAccessToken,
  };
}
