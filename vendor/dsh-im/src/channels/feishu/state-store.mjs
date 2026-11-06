import { bindingValue, normalizeBindings } from '../shared/session-binding.mjs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const EMPTY_STATE = Object.freeze({
  version: 1,
  sessions: {}, bindings: {},
  seenMessageIds: [],
  watches: {},
  includeArchivedSessions: false,
});

/** One conversation key may watch at most this many sessions. */
export const MAX_WATCHES_PER_KEY = 20;

/** A persisted watch entry: the watched session plus its delivery target. */
function validWatchEntry(value) {
  return value
    && typeof value === 'object'
    && typeof value.sessionId === 'string' && value.sessionId.length > 0
    && typeof value.chatId === 'string' && value.chatId.length > 0;
}

export class StateStore {
  #path;
  #state = structuredClone(EMPTY_STATE);
  #writeQueue = Promise.resolve();

  constructor(path) {
    this.#path = path;
  }

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.#path, 'utf8'));
      this.#state = {
        version: 1,
        sessions: parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {},
        seenMessageIds: Array.isArray(parsed.seenMessageIds) ? parsed.seenMessageIds.slice(-1000) : [],
        bindings: normalizeBindings(parsed.bindings, parsed.sessions ?? {}),
        watches: parsed.watches && typeof parsed.watches === 'object' ? parsed.watches : {},
        includeArchivedSessions: typeof parsed.includeArchivedSessions === 'boolean'
          ? parsed.includeArchivedSessions
          : false,
      };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await this.#persist();
    }
    return this;
  }

  sessionFor(key) {
    return this.#state.sessions[key] ?? null;
  }

  bindingFor(key) { return this.#state.bindings?.[key] ?? null; }

  async setSession(key, sessionId, options) {
    this.#state.sessions[key] = sessionId;
    this.#state.bindings ??= {};
    this.#state.bindings[key] = bindingValue(sessionId, options);
    await this.#persist();
  }

  async clearSession(key) {
    delete this.#state.sessions[key];
    if (this.#state.bindings) delete this.#state.bindings[key];
    await this.#persist();
  }

  async clearSessions() {
    this.#state.sessions = {};
    this.#state.bindings = {};
    await this.#persist();
  }

  hasSeen(messageId) {
    return this.#state.seenMessageIds.includes(messageId);
  }

  async markSeen(messageId) {
    if (this.hasSeen(messageId)) return;
    this.#state.seenMessageIds.push(messageId);
    if (this.#state.seenMessageIds.length > 1000) {
      this.#state.seenMessageIds.splice(0, this.#state.seenMessageIds.length - 1000);
    }
    await this.#persist();
  }

  snapshot() {
    return structuredClone(this.#state);
  }

  // ── Watches (persisted: surviving restarts) ─────────────────────────────

  watchEntries(key) {
    const list = this.#state.watches[key];
    return Array.isArray(list) ? list.filter(validWatchEntry) : [];
  }

  watchEntry(key, sessionId) {
    return this.watchEntries(key).find((entry) => entry.sessionId === sessionId) ?? null;
  }

  async setWatch(key, entry) {
    const list = this.#state.watches[key] ?? [];
    const index = list.findIndex((existing) => existing.sessionId === entry.sessionId);
    if (index === -1) {
      if (list.length >= MAX_WATCHES_PER_KEY) list.shift();
      list.push(entry);
    } else {
      list[index] = entry;
    }
    this.#state.watches[key] = list;
    await this.#persist();
  }

  async removeWatch(key, sessionId) {
    const list = this.#state.watches[key] ?? [];
    this.#state.watches[key] = list.filter((entry) => entry.sessionId !== sessionId);
    await this.#persist();
  }

  async clearWatches(key) {
    delete this.#state.watches[key];
    await this.#persist();
  }

  /** Every conversation key currently watching the given session. */
  keysWatching(sessionId) {
    return Object.entries(this.#state.watches)
      .filter(([, list]) => Array.isArray(list) && list.some((entry) => validWatchEntry(entry) && entry.sessionId === sessionId))
      .map(([key]) => key);
  }

  /** Unique watched session ids across all keys (restart compensation). */
  watchedSessionIds() {
    const ids = new Set();
    for (const list of Object.values(this.#state.watches)) {
      if (!Array.isArray(list)) continue;
      for (const entry of list) if (validWatchEntry(entry)) ids.add(entry.sessionId);
    }
    return [...ids];
  }

  // ── Session-list archived policy (per bot) ───────────────────

  includesArchivedSessions() {
    return this.#state.includeArchivedSessions === true;
  }

  async setIncludeArchivedSessions(include) {
    this.#state.includeArchivedSessions = include === true;
    await this.#persist();
  }

  async #persist() {
    const snapshot = JSON.stringify(this.#state, null, 2) + '\n';
    this.#writeQueue = this.#writeQueue.then(async () => {
      await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
      const temporary = `${this.#path}.tmp`;
      await writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, this.#path);
    });
    await this.#writeQueue;
  }
}
