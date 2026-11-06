import { bindingValue, normalizeBindings } from '../shared/session-binding.mjs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const EMPTY_STATE = Object.freeze({ version: 1, sessions: {}, bindings: {}, seenMessageIds: [] });

function normalizeState(value) {
  if (!value || typeof value !== 'object') return structuredClone(EMPTY_STATE);
  const sessions = {};
  if (value.sessions && typeof value.sessions === 'object' && !Array.isArray(value.sessions)) {
    for (const [key, sessionId] of Object.entries(value.sessions)) {
      if (typeof key === 'string' && typeof sessionId === 'string' && sessionId) sessions[key] = sessionId;
    }
  }
  return {
    version: 1,
    sessions,
    bindings: normalizeBindings(value.bindings, sessions),
    seenMessageIds: Array.isArray(value.seenMessageIds)
      ? value.seenMessageIds.filter((id) => typeof id === 'string').slice(-1_000)
      : [],
  };
}

export class WecomStateStore {
  #path;
  #state = structuredClone(EMPTY_STATE);
  #writeQueue = Promise.resolve();

  constructor(path) {
    this.#path = path;
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
    if (this.#state.seenMessageIds.length > 1_000) {
      this.#state.seenMessageIds.splice(0, this.#state.seenMessageIds.length - 1_000);
    }
    await this.#persist();
  }

  async remove() {
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
