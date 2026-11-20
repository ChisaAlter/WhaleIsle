import { randomInt, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { t } from './i18n.mjs';

export const SINGLE_OWNER_CHANNELS = Object.freeze([
  'weixin',
  'whatsapp',
  'telegram',
  'feishu',
  'qq',
  'dingtalk',
  'wecom',
  'slack',
  'discord',
]);

const CHANNEL_SET = new Set(SINGLE_OWNER_CHANNELS);

export const PAIRING_TTL_MS = 60 * 60 * 1000;
export const MAX_PENDING_PAIRINGS = 20;

const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PAIRING_CODE_LENGTH = 6;
const OWNER_KEY_PATTERN = /^im_owner_[a-f0-9]{32}$/;
const REQUEST_ID_PATTERN = /^im_pair_[a-f0-9]{32}$/;

const VALID_ROLES = new Set(['owner', 'guest', 'none']);
const VALID_CHATS = new Set(['private', 'group']);

export const WHALE_RESTRICTED_COMMAND_PATTERN = /^\/(?:workspace|workspacelist|sessionlist|session|preset|presetlist|new)(?=$|\s)/iu;

const EMPTY_DOCUMENT = Object.freeze({ version: 1, bots: Object.freeze({}) });

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function cleanDisplayName(value, fallback = 'IM 用户') {
  const cleaned = cleanString(value);
  return (cleaned ?? t(fallback)).replace(/[\r\n\t]+/g, ' ').slice(0, 80);
}

function assertSupportedChannel(channel) {
  if (typeof channel !== 'string' || !CHANNEL_SET.has(channel)) {
    throw new TypeError(`Unsupported single-owner IM channel: ${String(channel)}`);
  }
}

export function isSingleOwnerChannel(channel) {
  return typeof channel === 'string' && CHANNEL_SET.has(channel);
}

export function deriveOwnerSenderKey() {
  return `im_owner_${randomUUID().replaceAll('-', '')}`;
}

export function derivePairingRequestId() {
  return `im_pair_${randomUUID().replaceAll('-', '')}`;
}

export function generatePairingCode() {
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
    code += PAIRING_CODE_ALPHABET[randomInt(0, PAIRING_CODE_ALPHABET.length)];
  }
  return code;
}

export function isWhaleRestrictedCommand(text) {
  return typeof text === 'string' && WHALE_RESTRICTED_COMMAND_PATTERN.test(text.trim());
}

export function whaleRestrictedCommandReply(text = '') {
  const normalized = typeof text === 'string' ? text.trim().toLowerCase() : '';
  if (/^\/new(?=$|\s)/u.test(normalized)) {
    return t('鲸鱼娘只有一条常驻对话，继续发送消息即可。');
  }
  return t('鲸鱼娘单人私人助理模式下，IM 仅支持直接对话与基础控制，不支持通过斜杠命令切换工作区、会话或预设，请在桌面端设置中调整。');
}

export function createSpeakerMetadata({ role = 'none', chat = 'private' } = {}) {
  const safeRole = VALID_ROLES.has(role) ? role : 'none';
  const safeChat = VALID_CHATS.has(chat) ? chat : 'private';
  return Object.freeze({ role: safeRole, chat: safeChat });
}

export function normalizeSpeakerMetadata(speaker) {
  if (!speaker || typeof speaker !== 'object') return null;
  if (!VALID_ROLES.has(speaker.role) || !VALID_CHATS.has(speaker.chat)) return null;
  return Object.freeze({ role: speaker.role, chat: speaker.chat });
}

const ROLE_RANK = Object.freeze({ none: 0, guest: 1, owner: 2 });

/**
 * Attach irreversible speaker taint metadata to an inbound message or options
 * object. Once stamped, a lower-trust role cannot be upgraded in place.
 */
export function attachImmutableSpeaker(target, speaker) {
  if (!target || typeof target !== 'object') return target;
  const next = createSpeakerMetadata(speaker);
  const existing = normalizeSpeakerMetadata(target.speaker);
  if (existing && ROLE_RANK[next.role] > ROLE_RANK[existing.role]) {
    throw new Error(`Refusing to upgrade immutable speaker role from ${existing.role} to ${next.role}`);
  }
  const existingDescriptor = Object.getOwnPropertyDescriptor(target, 'speaker');
  if (existingDescriptor && existingDescriptor.configurable === false) {
    return target;
  }
  Object.defineProperty(target, 'speaker', {
    value: next,
    writable: false,
    configurable: false,
    enumerable: true,
  });
  return target;
}

export function formatSpeakerRpcId(prefix, speaker, uuid = randomUUID()) {
  const safePrefix = cleanString(prefix) ?? 'im';
  const normalized = normalizeSpeakerMetadata(speaker);
  if (!normalized) return `${safePrefix}-${uuid}`;
  return `${safePrefix}-${normalized.role}-${normalized.chat}-${uuid}`;
}

export function parseSpeakerFromRpcId(rpcId) {
  if (typeof rpcId !== 'string' || !rpcId) return null;
  const match = /^[a-z0-9_]+-(owner|guest|none)-(private|group)-[a-f0-9-]+$/i.exec(rpcId.trim());
  if (!match) return null;
  return createSpeakerMetadata({
    role: match[1].toLowerCase(),
    chat: match[2].toLowerCase(),
  });
}

function readWhalePolicy(home = process.env.DSH_HOME) {
  let enabled = true;
  let imDefault = false;
  if (typeof home === 'string' && home) {
    try {
      const cfg = JSON.parse(readFileSync(join(dirname(home), 'config.json'), 'utf8'));
      enabled = cfg?.whaleAssistantEnabled !== false;
    } catch (error) {
      if (error?.code !== 'ENOENT') enabled = true;
    }
    try {
      const settings = JSON.parse(readFileSync(join(home, 'data', 'whale', 'settings.json'), 'utf8'));
      imDefault = settings?.imDefault === true;
    } catch (error) {
      if (error?.code !== 'ENOENT') imDefault = false;
    }
  }
  return { enabled, imDefault };
}

/**
 * Determine whether a bot is subject to Whale single-owner private-assistant
 * enforcement. Bots explicitly bound to a non-whale-girl preset retain their
 * original channel policy.
 */
export function isWhalePolicyEnforced({ preset = null, home = process.env.DSH_HOME } = {}) {
  const normalizedPreset = cleanString(preset);
  if (normalizedPreset && normalizedPreset !== 'whale-girl') return false;
  if (normalizedPreset === 'whale-girl') return true;
  const { enabled, imDefault } = readWhalePolicy(home);
  return enabled && imDefault;
}

export async function isWhaleEnforcedForHarness(harness, { home } = {}) {
  if (typeof harness?.accessGate?.isWhaleEnforced === 'function') {
    return harness.accessGate.isWhaleEnforced(harness);
  }
  let preset = null;
  if (typeof harness?.agentPresetSettings === 'function') {
    try {
      preset = (await harness.agentPresetSettings())?.agentPreset ?? null;
    } catch {
      preset = null;
    }
  }
  return isWhalePolicyEnforced({ preset, home: home ?? process.env.DSH_HOME });
}

function normalizeWhatsappComparableId(value) {
  const cleaned = cleanString(value);
  if (!cleaned) return null;
  if (cleaned === '*') return '*';
  const stripped = cleaned.toLowerCase().replace(/^\+/, '');
  const atIndex = stripped.indexOf('@');
  const local = atIndex >= 0 ? stripped.slice(0, atIndex) : stripped;
  const colonIndex = local.indexOf(':');
  const digits = colonIndex >= 0 ? local.slice(0, colonIndex) : local;
  return digits || stripped;
}

function canonicalSenderId(channel, value) {
  const cleaned = cleanString(value);
  if (!cleaned) return null;
  if (cleaned === '*') return '*';
  if (channel === 'whatsapp') return normalizeWhatsappComparableId(cleaned);
  return cleaned;
}

/**
 * Extract legacy allowlist candidates for smooth single-owner migration.
 * - Exactly 1 explicit non-'*' ID -> smooth auto-upgrade as sole owner.
 * - '*', multiple IDs, or empty -> fail-closed (singleCandidate: null).
 */
export function resolveLegacyOwnerCandidates(channel, botConfig = {}) {
  assertSupportedChannel(channel);
  const config = botConfig && typeof botConfig === 'object' ? botConfig : {};
  const raw = [];
  let hadWildcard = false;

  const pushCandidate = (value) => {
    const id = cleanString(value);
    if (!id) return;
    if (id === '*') {
      hadWildcard = true;
      return;
    }
    raw.push(id);
  };

  if (channel === 'weixin') {
    pushCandidate(config.ownerUserId);
  } else if (channel === 'feishu') {
    const list = Array.isArray(config.ownerOpenIds)
      ? config.ownerOpenIds
      : (config.ownerOpenId ? [config.ownerOpenId] : []);
    for (const entry of list) pushCandidate(entry);
  } else if (channel === 'qq') {
    pushCandidate(config.ownerUserOpenid);
  } else if (channel === 'dingtalk') {
    const entries = Array.isArray(config.approvedSenders)
      ? config.approvedSenders
      : (config.approvedSenders instanceof Set ? [...config.approvedSenders] : []);
    for (const entry of entries) {
      pushCandidate(typeof entry === 'string' ? entry : entry?.staffId);
    }
  } else if (channel === 'telegram') {
    const mode = cleanString(config.accessMode) ?? 'compatible';
    if (mode === 'private-allowlist' && Array.isArray(config.allowedUsers)) {
      for (const entry of config.allowedUsers) pushCandidate(String(entry));
    } else if (mode === 'compatible') {
      hadWildcard = true;
    }
  } else if (channel === 'whatsapp') {
    const mode = cleanString(config.accessMode) ?? 'self-only';
    if (mode === 'open') {
      hadWildcard = true;
    } else if (mode === 'self-only') {
      pushCandidate(config.accountJid);
    } else if (mode === 'private-allowlist' && Array.isArray(config.allowedNumbers)) {
      for (const entry of config.allowedNumbers) pushCandidate(entry);
    }
  } else {
    // wecom, slack, discord have no legacy allowlist unless explicitly provided.
    const explicit = Array.isArray(config.allowedSenders)
      ? config.allowedSenders
      : (config.ownerUserId ? [config.ownerUserId] : []);
    for (const entry of explicit) pushCandidate(entry);
  }

  const deduped = [];
  const seen = new Set();
  for (const id of raw) {
    const comparable = canonicalSenderId(channel, id);
    if (!comparable || comparable === '*') {
      hadWildcard = true;
      continue;
    }
    if (!seen.has(comparable)) {
      seen.add(comparable);
      deduped.push(id);
    }
  }
  const singleCandidate = !hadWildcard && deduped.length === 1 ? deduped[0] : null;
  return Object.freeze({
    candidates: Object.freeze(deduped),
    hadWildcard,
    singleCandidate,
  });
}

function publicOwner(owner) {
  if (!owner) return null;
  return Object.freeze({
    senderKey: owner.senderKey,
    displayName: owner.displayName,
    pairedAt: owner.pairedAt,
    source: owner.source,
  });
}

function publicPending(entry) {
  return Object.freeze({
    requestId: entry.requestId,
    code: entry.code,
    displayName: entry.displayName,
    requestedAt: entry.requestedAt,
    lastSeenAt: entry.lastSeenAt,
    expiresAt: entry.expiresAt,
  });
}

function normalizeStoredOwner(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const senderKey = cleanString(value.senderKey);
  const platformUserId = cleanString(value.platformUserId);
  if (!senderKey || !OWNER_KEY_PATTERN.test(senderKey) || !platformUserId || platformUserId === '*') {
    return null;
  }
  return {
    senderKey,
    platformUserId,
    displayName: cleanDisplayName(value.displayName, '已配对主人'),
    pairedAt: cleanString(value.pairedAt) ?? new Date().toISOString(),
    source: ['migrated', 'paired', 'manual'].includes(value.source) ? value.source : 'paired',
  };
}

function normalizeStoredPending(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const requestId = cleanString(value.requestId);
  const code = cleanString(value.code)?.toUpperCase();
  const platformUserId = cleanString(value.platformUserId);
  const requestedAt = cleanString(value.requestedAt);
  const lastSeenAt = cleanString(value.lastSeenAt) ?? requestedAt;
  const expiresAt = cleanString(value.expiresAt);
  if (!requestId || !REQUEST_ID_PATTERN.test(requestId) || !code
    || !platformUserId || platformUserId === '*' || !requestedAt || !expiresAt) {
    return null;
  }
  return {
    requestId,
    code,
    platformUserId,
    displayName: cleanDisplayName(value.displayName),
    requestedAt,
    lastSeenAt,
    expiresAt,
  };
}

function normalizeDocument(value) {
  if (!value || value.version !== 1 || !value.bots || typeof value.bots !== 'object' || Array.isArray(value.bots)) {
    return structuredClone(EMPTY_DOCUMENT);
  }
  const bots = {};
  for (const [key, entry] of Object.entries(value.bots)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const channel = cleanString(entry.channel);
    const botId = cleanString(entry.botId);
    if (!channel || !CHANNEL_SET.has(channel) || !botId) continue;
    const owner = normalizeStoredOwner(entry.owner);
    const pending = Array.isArray(entry.pending)
      ? entry.pending.map(normalizeStoredPending).filter(Boolean).slice(0, MAX_PENDING_PAIRINGS)
      : [];
    bots[key] = {
      channel,
      botId,
      owner,
      revoked: entry.revoked === true,
      pending,
    };
  }
  return { version: 1, bots };
}

function pairingGuideText(code) {
  return t(
    '此机器人已启用单人私人助理模式，尚未绑定唯一主人。请在桌面端「IM机器人」设置中核对并确认配对码 {code}（1 小时内有效）。',
    { code },
  );
}

/**
 * Centralized single-owner private-assistant access gate and cross-channel
 * pending-pairing store for all 9 IM channels (excluding AI Office Connector).
 */
export class SingleOwnerAccessGate {
  #path;
  #ttlMs;
  #maxPending;
  #clock;
  #defaultHome;
  #state = structuredClone(EMPTY_DOCUMENT);
  #writeQueue = Promise.resolve();
  #ownerListeners = new Set();

  constructor({
    path = null,
    ttlMs = PAIRING_TTL_MS,
    maxPending = MAX_PENDING_PAIRINGS,
    clock = () => Date.now(),
    home,
  } = {}) {
    this.#path = cleanString(path);
    this.#ttlMs = Number.isFinite(ttlMs) && ttlMs > 0 ? Math.floor(ttlMs) : PAIRING_TTL_MS;
    this.#maxPending = Number.isInteger(maxPending) && maxPending > 0
      ? maxPending
      : MAX_PENDING_PAIRINGS;
    this.#clock = typeof clock === 'function' ? clock : () => Date.now();
    this.#defaultHome = home;
  }

  onOwnerChange(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    this.#ownerListeners.add(listener);
    return () => this.#ownerListeners.delete(listener);
  }

  async load() {
    if (!this.#path) return this;
    try {
      const raw = JSON.parse(await readFile(this.#path, 'utf8'));
      this.#state = normalizeDocument(raw);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      this.#state = structuredClone(EMPTY_DOCUMENT);
    }
    return this;
  }

  botKey(channel, botId) {
    assertSupportedChannel(channel);
    const id = cleanString(botId);
    if (!id) throw new TypeError('botId is required');
    return `${channel}:${id}`;
  }

  isWhaleEnforced({ preset = null, home = this.#defaultHome ?? process.env.DSH_HOME } = {}) {
    return isWhalePolicyEnforced({ preset, home });
  }

  #ensureRecord(channel, botId) {
    const key = this.botKey(channel, botId);
    if (!this.#state.bots[key]) {
      this.#state.bots[key] = {
        channel,
        botId: cleanString(botId),
        owner: null,
        revoked: false,
        pending: [],
      };
    }
    return this.#state.bots[key];
  }

  #pruneExpired(record, nowMs) {
    const before = record.pending.length;
    record.pending = record.pending.filter((entry) => {
      const exp = Date.parse(entry.expiresAt);
      return Number.isFinite(exp) && exp > nowMs;
    });
    return record.pending.length !== before;
  }

  #syncMigratedOwner(record, channel, botConfig, nowMs) {
    // Explicit paired/manual owners or explicit revocations are authoritative
    // and never overwritten by legacy config.
    if (record.revoked) return false;
    if (record.owner && record.owner.source !== 'migrated') return false;
    if (!botConfig || typeof botConfig !== 'object') return false;

    const legacy = resolveLegacyOwnerCandidates(channel, botConfig);
    if (!legacy.singleCandidate) {
      if (record.owner?.source === 'migrated') {
        record.owner = null;
        return true;
      }
      return false;
    }
    const existingComparable = record.owner
      ? canonicalSenderId(channel, record.owner.platformUserId)
      : null;
    const candidateComparable = canonicalSenderId(channel, legacy.singleCandidate);
    if (existingComparable && existingComparable === candidateComparable) return false;

    record.owner = {
      senderKey: record.owner?.senderKey ?? deriveOwnerSenderKey(),
      platformUserId: legacy.singleCandidate,
      displayName: cleanDisplayName(botConfig.ownerDisplayName, '已迁移主人'),
      pairedAt: new Date(nowMs).toISOString(),
      source: 'migrated',
    };
    record.pending = [];
    return true;
  }

  #matchesOwner(channel, owner, senderId) {
    if (!owner || !owner.platformUserId || owner.platformUserId === '*') return false;
    const ownerComparable = canonicalSenderId(channel, owner.platformUserId);
    const senderComparable = canonicalSenderId(channel, senderId);
    if (!ownerComparable || !senderComparable || ownerComparable === '*' || senderComparable === '*') {
      return false;
    }
    return ownerComparable === senderComparable;
  }

  /** Fast check of whether senderId is the sole owner of this bot. Never allows '*'. */
  isOwner({ channel, botId, botConfig, senderId, now = this.#clock() } = {}) {
    assertSupportedChannel(channel);
    const normalizedSender = cleanString(senderId);
    if (!normalizedSender || normalizedSender === '*') return false;
    const key = this.botKey(channel, botId);
    const record = this.#state.bots[key]
      ?? { channel, botId: cleanString(botId), owner: null, revoked: false, pending: [] };
    if (record.revoked) return false;
    if (record.owner && record.owner.source !== 'migrated') {
      return this.#matchesOwner(channel, record.owner, normalizedSender);
    }
    if (botConfig && typeof botConfig === 'object') {
      const legacy = resolveLegacyOwnerCandidates(channel, botConfig);
      if (!legacy.singleCandidate) return false;
      return this.#matchesOwner(channel, { platformUserId: legacy.singleCandidate }, normalizedSender);
    }
    return this.#matchesOwner(channel, record.owner, normalizedSender);
  }

  async evaluateInbound({
    channel,
    botId,
    botConfig,
    senderId,
    senderAlternateIds = [],
    displayName,
    chatType = 'private',
    preset = null,
    home = this.#defaultHome ?? process.env.DSH_HOME,
    now = this.#clock(),
  }) {
    assertSupportedChannel(channel);
    const chat = chatType === 'group' ? 'group' : 'private';
    const enforced = this.isWhaleEnforced({ preset, home });
    if (!enforced) {
      return Object.freeze({
        enforced: false,
        allowed: true,
        reason: 'legacy-policy',
        speaker: createSpeakerMetadata({ role: 'guest', chat }),
        replyText: null,
      });
    }

    const normalizedSender = cleanString(senderId);
    if (!normalizedSender || normalizedSender === '*') {
      return Object.freeze({
        enforced: true,
        allowed: false,
        reason: 'invalid-sender',
        speaker: createSpeakerMetadata({ role: 'none', chat }),
        replyText: null,
      });
    }

    const record = this.#ensureRecord(channel, botId);
    let dirty = this.#pruneExpired(record, now);
    if (this.#syncMigratedOwner(record, channel, botConfig, now)) dirty = true;

    const candidateSenderIds = [
      normalizedSender,
      ...(Array.isArray(senderAlternateIds) ? senderAlternateIds.map(cleanString).filter(Boolean) : []),
    ];
    const matchedOwner = candidateSenderIds.some(
      (candidate) => candidate !== '*' && this.#matchesOwner(channel, record.owner, candidate),
    );

    // Whale private-assistant mode is strictly P2P private DM only.
    if (chat === 'group') {
      if (dirty) await this.#persist();
      return Object.freeze({
        enforced: true,
        allowed: false,
        reason: 'group-forbidden',
        speaker: createSpeakerMetadata({ role: matchedOwner ? 'owner' : 'none', chat: 'group' }),
        replyText: null,
      });
    }

    if (matchedOwner) {
      if (dirty) await this.#persist();
      return Object.freeze({
        enforced: true,
        allowed: true,
        reason: 'owner',
        speaker: createSpeakerMetadata({ role: 'owner', chat: 'private' }),
        owner: publicOwner(record.owner),
        replyText: null,
      });
    }

    // Strict single-owner: once an owner is bound, reject all other senders silently.
    if (record.owner) {
      if (dirty) await this.#persist();
      return Object.freeze({
        enforced: true,
        allowed: false,
        reason: 'not-owner',
        speaker: createSpeakerMetadata({ role: 'none', chat: 'private' }),
        replyText: null,
      });
    }

    // Fail-closed with first-DM pending pairing (short code + 1h TTL + maxPending cap).
    const senderComparable = canonicalSenderId(channel, normalizedSender);
    const isoNow = new Date(now).toISOString();
    const isoExpires = new Date(now + this.#ttlMs).toISOString();
    let entry = record.pending.find(
      (item) => canonicalSenderId(channel, item.platformUserId) === senderComparable,
    );
    if (entry) {
      entry.lastSeenAt = isoNow;
      entry.expiresAt = isoExpires;
      if (cleanString(displayName)) entry.displayName = cleanDisplayName(displayName);
      dirty = true;
    } else {
      if (record.pending.length >= this.#maxPending) {
        if (dirty) await this.#persist();
        return Object.freeze({
          enforced: true,
          allowed: false,
          reason: 'pairing-flood-limit',
          speaker: createSpeakerMetadata({ role: 'none', chat: 'private' }),
          replyText: null,
        });
      }
      const usedCodes = new Set(record.pending.map((item) => item.code));
      let code = generatePairingCode();
      for (let attempt = 0; attempt < 8 && usedCodes.has(code); attempt += 1) {
        code = generatePairingCode();
      }
      entry = {
        requestId: derivePairingRequestId(),
        code,
        platformUserId: normalizedSender,
        displayName: cleanDisplayName(displayName),
        requestedAt: isoNow,
        lastSeenAt: isoNow,
        expiresAt: isoExpires,
      };
      record.pending.push(entry);
      dirty = true;
    }
    if (dirty) await this.#persist();
    return Object.freeze({
      enforced: true,
      allowed: false,
      reason: 'pairing-required',
      speaker: createSpeakerMetadata({ role: 'none', chat: 'private' }),
      pairing: publicPending(entry),
      replyText: pairingGuideText(entry.code),
    });
  }

  async approvePairing({
    channel,
    botId,
    requestId,
    code,
    now = this.#clock(),
  }) {
    const record = this.#ensureRecord(channel, botId);
    this.#pruneExpired(record, now);
    const reqId = cleanString(requestId);
    const normCode = cleanString(code)?.toUpperCase() ?? null;
    if (!reqId && !normCode) {
      throw Object.assign(new Error('Pairing requestId or code is required.'), { code: 'bad-request' });
    }
    const match = record.pending.find((entry) => (
      (reqId && entry.requestId === reqId)
      || (normCode && entry.code === normCode)
    ));
    if (!match) {
      throw Object.assign(
        new Error('配对请求不存在或已过期，请重新私聊机器人获取配对码。'),
        { code: 'pairing-not-found' },
      );
    }
    const owner = {
      senderKey: deriveOwnerSenderKey(),
      platformUserId: match.platformUserId,
      displayName: match.displayName,
      pairedAt: new Date(now).toISOString(),
      source: 'paired',
    };
    record.owner = owner;
    record.revoked = false;
    record.pending = [];
    await this.#persist();
    await this.#notifyOwnerChange({
      action: 'approve',
      channel,
      botId: record.botId,
      platformUserId: owner.platformUserId,
      senderKey: owner.senderKey,
    });
    return this.publicStatus({ channel, botId, now });
  }

  async rejectPairing({ channel, botId, requestId, now = this.#clock() }) {
    const record = this.#ensureRecord(channel, botId);
    this.#pruneExpired(record, now);
    const reqId = cleanString(requestId);
    if (!reqId) {
      throw Object.assign(new Error('requestId is required.'), { code: 'bad-request' });
    }
    const before = record.pending.length;
    record.pending = record.pending.filter((entry) => entry.requestId !== reqId);
    if (record.pending.length === before) {
      throw Object.assign(new Error('配对请求不存在或已过期。'), { code: 'pairing-not-found' });
    }
    await this.#persist();
    return this.publicStatus({ channel, botId, now });
  }

  async revokeOwner({ channel, botId, senderKey, now = this.#clock() }) {
    const record = this.#ensureRecord(channel, botId);
    this.#pruneExpired(record, now);
    const key = cleanString(senderKey);
    if (key && record.owner && record.owner.senderKey !== key) {
      throw Object.assign(new Error('已配对主人标识不匹配。'), { code: 'owner-mismatch' });
    }
    const previousKey = record.owner?.senderKey ?? null;
    record.owner = null;
    record.revoked = true;
    await this.#persist();
    await this.#notifyOwnerChange({
      action: 'revoke',
      channel,
      botId: record.botId,
      senderKey: previousKey,
    });
    return this.publicStatus({ channel, botId, now });
  }

  async setOwner({
    channel,
    botId,
    platformUserId,
    displayName,
    source = 'manual',
    now = this.#clock(),
  }) {
    const userId = cleanString(platformUserId);
    if (!userId || userId === '*') {
      throw Object.assign(new Error('Owner user id cannot be empty or wildcard (*).'), { code: 'invalid-owner' });
    }
    const record = this.#ensureRecord(channel, botId);
    const owner = {
      senderKey: deriveOwnerSenderKey(),
      platformUserId: userId,
      displayName: cleanDisplayName(displayName, '已配对主人'),
      pairedAt: new Date(now).toISOString(),
      source: ['migrated', 'paired', 'manual'].includes(source) ? source : 'manual',
    };
    record.owner = owner;
    record.revoked = false;
    record.pending = [];
    await this.#persist();
    await this.#notifyOwnerChange({
      action: 'approve',
      channel,
      botId: record.botId,
      platformUserId: owner.platformUserId,
      senderKey: owner.senderKey,
    });
    return this.publicStatus({ channel, botId, now });
  }

  publicStatus({ channel, botId, botConfig, now = this.#clock() }) {
    const key = this.botKey(channel, botId);
    const record = this.#state.bots[key]
      ? this.#state.bots[key]
      : { channel, botId: cleanString(botId), owner: null, revoked: false, pending: [] };
    const clone = {
      ...record,
      pending: record.pending.filter((entry) => {
        const exp = Date.parse(entry.expiresAt);
        return Number.isFinite(exp) && exp > now;
      }),
    };
    if (!clone.revoked && (!clone.owner || clone.owner.source === 'migrated') && botConfig) {
      const legacy = resolveLegacyOwnerCandidates(channel, botConfig);
      if (legacy.singleCandidate) {
        clone.owner = clone.owner && this.#matchesOwner(channel, clone.owner, legacy.singleCandidate)
          ? clone.owner
          : {
              senderKey: clone.owner?.senderKey ?? deriveOwnerSenderKey(),
              platformUserId: legacy.singleCandidate,
              displayName: cleanDisplayName(botConfig.ownerDisplayName, '已迁移主人'),
              pairedAt: new Date(now).toISOString(),
              source: 'migrated',
            };
      } else if (clone.owner?.source === 'migrated') {
        clone.owner = null;
      }
    }
    return Object.freeze({
      channel,
      botId: cleanString(botId),
      mode: 'single-owner',
      owner: publicOwner(clone.owner),
      pending: Object.freeze(clone.pending.map(publicPending)),
      ttlMs: this.#ttlMs,
      maxPending: this.#maxPending,
    });
  }

  listPublicStatuses({ now = this.#clock() } = {}) {
    return Object.values(this.#state.bots).map((record) => this.publicStatus({
      channel: record.channel,
      botId: record.botId,
      now,
    }));
  }

  /**
   * Bind a lightweight per-bot gate facade for bridges, runtimes, and slash
   * command guards.
   */
  createBotGate({
    channel,
    botId,
    botConfig,
    getBotConfig,
    getPreset,
    home = this.#defaultHome,
  }) {
    assertSupportedChannel(channel);
    const id = cleanString(botId);
    if (!id) throw new TypeError('botId is required');
    const resolveConfig = () => (typeof getBotConfig === 'function' ? getBotConfig() : botConfig);
    const resolvePreset = async (harness) => {
      if (typeof getPreset === 'function') return getPreset();
      if (typeof harness?.agentPresetSettings === 'function') {
        return (await harness.agentPresetSettings())?.agentPreset ?? null;
      }
      return null;
    };
    return Object.freeze({
      channel,
      botId: id,
      gate: this,
      isWhaleEnforcedSync: (preset = null) => this.isWhaleEnforced({
        preset: preset ?? (typeof getPreset === 'function' ? getPreset() : null),
        home: home ?? process.env.DSH_HOME,
      }),
      isWhaleEnforced: async (harness) => this.isWhaleEnforced({
        preset: await resolvePreset(harness),
        home: home ?? process.env.DSH_HOME,
      }),
      isOwner: (senderId) => this.isOwner({
        channel,
        botId: id,
        botConfig: resolveConfig(),
        senderId,
      }),
      evaluateInbound: async ({ senderId, senderAlternateIds, displayName, chatType, harness, preset } = {}) => {
        const effectivePreset = preset !== undefined ? preset : await resolvePreset(harness);
        return this.evaluateInbound({
          channel,
          botId: id,
          botConfig: resolveConfig(),
          senderId,
          senderAlternateIds,
          displayName,
          chatType,
          preset: effectivePreset,
          home: home ?? process.env.DSH_HOME,
        });
      },
      publicStatus: () => this.publicStatus({
        channel,
        botId: id,
        botConfig: resolveConfig(),
      }),
    });
  }

  async #notifyOwnerChange(event) {
    for (const listener of [...this.#ownerListeners]) {
      try {
        await listener(event);
      } catch {
        // Listener failures must not revert committed owner persistence.
      }
    }
  }

  async #persist() {
    if (!this.#path) return;
    const snapshot = JSON.stringify(this.#state, null, 2) + '\n';
    const operation = this.#writeQueue.then(async () => {
      await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
      const tempPath = `${this.#path}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(tempPath, snapshot, { encoding: 'utf8', mode: 0o600 });
      await rename(tempPath, this.#path);
    });
    this.#writeQueue = operation.then(() => undefined, () => undefined);
    await operation;
  }
}

const SHARED_GATES = new Map();

export async function sharedSingleOwnerGate(dshHome = process.env.DSH_HOME) {
  const root = cleanString(dshHome) ? resolve(dshHome) : null;
  const key = root ?? '__memory__';
  if (!SHARED_GATES.has(key)) {
    const filePath = root ? join(root, 'integrations', 'dsh-im', 'single-owner-access.json') : null;
    const gate = new SingleOwnerAccessGate({ path: filePath, home: root ?? undefined });
    const loading = gate.load().then(() => gate, (error) => {
      SHARED_GATES.delete(key);
      throw error;
    });
    SHARED_GATES.set(key, loading);
  }
  return SHARED_GATES.get(key);
}
