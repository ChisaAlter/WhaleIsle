import { bindingValue, normalizeBindings } from '../shared/session-binding.mjs';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { t } from '../shared/i18n.mjs';

const EMPTY_STATE = Object.freeze({
  version: 1,
  sessions: {}, bindings: {},
  seenMessageIds: [],
  pendingSenders: {},
});

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function displayName(value) {
  return (nonEmptyString(value) ?? t('钉钉用户')).slice(0, 100);
}

function normalizePendingSender(value, fallbackRequestId) {
  if (!value || typeof value !== 'object') return null;
  const requestId = nonEmptyString(value.requestId) ?? nonEmptyString(fallbackRequestId);
  const staffId = nonEmptyString(value.staffId);
  const requestedAt = nonEmptyString(value.requestedAt) ?? nonEmptyString(value.lastSeenAt);
  const lastSeenAt = nonEmptyString(value.lastSeenAt) ?? requestedAt;
  if (!requestId || !staffId || !requestedAt || !lastSeenAt) return null;
  return {
    requestId,
    staffId,
    displayName: displayName(value.displayName ?? value.nick),
    requestedAt,
    lastSeenAt,
  };
}

function normalizeState(value) {
  if (!value || typeof value !== 'object') return structuredClone(EMPTY_STATE);
  const sessions = {};
  if (value.sessions && typeof value.sessions === 'object' && !Array.isArray(value.sessions)) {
    for (const [key, sessionId] of Object.entries(value.sessions)) {
      const normalizedKey = nonEmptyString(key);
      const normalizedSession = nonEmptyString(sessionId);
      if (normalizedKey && normalizedSession) sessions[normalizedKey] = normalizedSession;
    }
  }

  const pendingSenders = {};
  const entries = Array.isArray(value.pendingSenders)
    ? value.pendingSenders.map((entry) => [entry?.requestId, entry])
    : Object.entries(value.pendingSenders && typeof value.pendingSenders === 'object'
      ? value.pendingSenders
      : {});
  for (const [key, candidate] of entries) {
    const pending = normalizePendingSender(candidate, key);
    if (!pending) continue;
    const duplicate = Object.values(pendingSenders).find((entry) => entry.staffId === pending.staffId);
    if (!duplicate || duplicate.lastSeenAt < pending.lastSeenAt) {
      if (duplicate) delete pendingSenders[duplicate.requestId];
      pendingSenders[pending.requestId] = pending;
    }
  }

  return {
    version: 1,
    sessions,
    bindings: normalizeBindings(value.bindings, sessions),
    seenMessageIds: Array.isArray(value.seenMessageIds)
      ? [...new Set(value.seenMessageIds.map(nonEmptyString).filter(Boolean))].slice(-1_000)
      : [],
    pendingSenders,
  };
}

export class DingtalkStateStore {
  #path;
  #state = structuredClone(EMPTY_STATE);
  #writeQueue = Promise.resolve();
  #idFactory;
  #now;

  constructor(path, { idFactory = randomUUID, now = () => new Date().toISOString() } = {}) {
    if (!nonEmptyString(path)) throw new TypeError('state path is required');
    if (typeof idFactory !== 'function' || typeof now !== 'function') {
      throw new TypeError('idFactory and now must be functions');
    }
    this.#path = path;
    this.#idFactory = idFactory;
    this.#now = now;
  }

  async load() {
    try {
      this.#state = normalizeState(JSON.parse(await readFile(this.#path, 'utf8')));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      this.#state = structuredClone(EMPTY_STATE);
      await this.#persist();
    }
    return this;
  }

  sessionFor(key) {
    return this.#state.sessions[key] ?? null;
  }

  bindingFor(key) { return this.#state.bindings?.[key] ?? null; }

  async setSession(key, sessionId, options) {
    const normalizedKey = nonEmptyString(key);
    const normalizedSession = nonEmptyString(sessionId);
    if (!normalizedKey || !normalizedSession) throw new TypeError('key and sessionId are required');
    this.#state.sessions[normalizedKey] = normalizedSession;
    this.#state.bindings ??= {};
    this.#state.bindings[normalizedKey] = bindingValue(normalizedSession, options);
    await this.#persist();
  }

  async clearSession(key) {
    const normalizedKey = nonEmptyString(key);
    if (!normalizedKey || !(normalizedKey in this.#state.sessions)) return;
    delete this.#state.sessions[normalizedKey];
    if (this.#state.bindings) delete this.#state.bindings[normalizedKey];
    await this.#persist();
  }

  async clearSessions() {
    this.#state.sessions = {};
    this.#state.bindings = {};
    await this.#persist();
  }

  hasSeen(messageId) {
    const id = nonEmptyString(messageId);
    return Boolean(id && this.#state.seenMessageIds.includes(id));
  }

  async markSeen(messageId) {
    const id = nonEmptyString(messageId);
    if (!id) throw new TypeError('messageId is required');
    if (this.hasSeen(id)) return;
    this.#state.seenMessageIds.push(id);
    if (this.#state.seenMessageIds.length > 1_000) {
      this.#state.seenMessageIds.splice(0, this.#state.seenMessageIds.length - 1_000);
    }
    await this.#persist();
  }

  pendingSenders() {
    return Object.values(this.#state.pendingSenders)
      .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt))
      .map((entry) => structuredClone(entry));
  }

  pendingSender(requestId) {
    const id = nonEmptyString(requestId);
    const entry = id ? this.#state.pendingSenders[id] : null;
    return entry ? structuredClone(entry) : null;
  }

  async recordPendingSender(staffIdOrEntry, name, seenAt) {
    const input = staffIdOrEntry && typeof staffIdOrEntry === 'object'
      ? staffIdOrEntry
      : { staffId: staffIdOrEntry, displayName: name, lastSeenAt: seenAt };
    const staffId = nonEmptyString(input.staffId);
    if (!staffId) throw new TypeError('staffId is required');
    const timestamp = nonEmptyString(input.lastSeenAt) ?? nonEmptyString(input.requestedAt) ?? this.#now();
    const existing = Object.values(this.#state.pendingSenders)
      .find((entry) => entry.staffId === staffId);
    const entry = {
      requestId: existing?.requestId ?? `ding_sender_${this.#idFactory()}`,
      staffId,
      displayName: displayName(input.displayName ?? input.nick ?? name),
      requestedAt: existing?.requestedAt ?? timestamp,
      lastSeenAt: timestamp,
    };
    this.#state.pendingSenders[entry.requestId] = entry;
    await this.#persist();
    return structuredClone(entry);
  }

  async removePendingSender(requestId) {
    const id = nonEmptyString(requestId);
    if (!id || !this.#state.pendingSenders[id]) return false;
    delete this.#state.pendingSenders[id];
    await this.#persist();
    return true;
  }

  async removePendingSenderByStaffId(staffId) {
    const id = nonEmptyString(staffId);
    const pending = id
      ? Object.values(this.#state.pendingSenders).find((entry) => entry.staffId === id)
      : null;
    return pending ? this.removePendingSender(pending.requestId) : false;
  }

  snapshot() {
    return structuredClone(this.#state);
  }

  async remove() {
    await this.#writeQueue;
    try {
      await unlink(this.#path);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    this.#state = structuredClone(EMPTY_STATE);
  }

  async #persist() {
    const snapshot = `${JSON.stringify(this.#state, null, 2)}\n`;
    const operation = this.#writeQueue.then(async () => {
      await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
      const temporary = `${this.#path}.tmp`;
      await writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, this.#path);
    });
    this.#writeQueue = operation.then(() => undefined, () => undefined);
    await operation;
  }
}

export const DingTalkStateStore = DingtalkStateStore;
