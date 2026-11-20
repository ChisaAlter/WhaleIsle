import {
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import {
  normalizeAgentPresetCatalog,
  validateAgentPresetId,
} from './agent-preset.mjs';
import { CONNECTION_TEST_STATE_IDENTITY } from './connection-test.mjs';
import { WORKSPACE_SESSION_STALE } from './workspace-session.mjs';

const EMPTY_DOCUMENT = Object.freeze({ version: 1, workspaces: Object.freeze({}) });

function workspaceSessionStale(message) {
  const error = new Error(message);
  error.code = WORKSPACE_SESSION_STALE;
  return error;
}

async function canonicalWorkspacePath(value) {
  return resolve(await realpath(value));
}

async function sameWorkspacePath(left, right) {
  if (left === right) return true;
  try {
    return await canonicalWorkspacePath(left) === await canonicalWorkspacePath(right);
  } catch {
    return false;
  }
}

function botIdOf(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new TypeError('Invalid bot id');
  }
  return value;
}

function normalizeDocument(value) {
  if (!value || value.version !== 1 || !value.workspaces
    || typeof value.workspaces !== 'object' || Array.isArray(value.workspaces)) return null;
  const workspaces = {};
  for (const [botId, workspace] of Object.entries(value.workspaces)) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(botId)
      || typeof workspace !== 'string' || !isAbsolute(workspace)) return null;
    workspaces[botId] = resolve(workspace);
  }
  let agentPresets = {};
  if (value.agentPresets !== undefined) {
    if (!value.agentPresets || typeof value.agentPresets !== 'object'
      || Array.isArray(value.agentPresets)) return null;
    for (const [botId, agentPreset] of Object.entries(value.agentPresets)) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(botId)) return null;
      try {
        const normalized = validateAgentPresetId(agentPreset);
        if (!normalized) return null;
        agentPresets[botId] = normalized;
      } catch {
        return null;
      }
    }
  }
  return { version: 1, workspaces, agentPresets };
}

export async function validateWorkspacePath(value) {
  if (typeof value !== 'string' || !value.trim() || !isAbsolute(value.trim())) {
    const error = new Error('工作区必须是绝对路径。');
    error.code = 'workspace-not-absolute';
    throw error;
  }
  const workspace = resolve(value.trim());
  let info;
  try {
    info = await stat(workspace);
  } catch (cause) {
    const error = new Error('工作区路径不存在。', { cause });
    error.code = 'workspace-not-found';
    throw error;
  }
  if (!info.isDirectory()) {
    const error = new Error('工作区路径必须指向一个目录。');
    error.code = 'workspace-not-directory';
    throw error;
  }
  return workspace;
}

export class BotWorkspaceStore {
  #path;
  #defaultWorkspace;
  #workspaces = {};
  #agentPresets = {};
  #generations = new Map();
  #nextGeneration = 1;
  #incarnations = new Map();
  #nextIncarnation = 1;
  #removals = new Map();
  #removalDetails = new WeakMap();
  #dirtyRemovals = new Set();
  #writeQueue = Promise.resolve();
  #botQueues = new Map();

  constructor(path, { defaultWorkspace = process.cwd() } = {}) {
    if (typeof path !== 'string' || !path) throw new TypeError('workspace store path is required');
    this.#path = path;
    this.#defaultWorkspace = resolve(defaultWorkspace);
  }

  async load() {
    try {
      const normalized = normalizeDocument(JSON.parse(await readFile(this.#path, 'utf8')));
      if (!normalized) throw new Error('dsh-im workspace config is invalid');
      this.#workspaces = normalized.workspaces;
      this.#agentPresets = normalized.agentPresets;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      this.#workspaces = {};
      this.#agentPresets = {};
    }
    this.#generations.clear();
    this.#nextGeneration = 1;
    this.#incarnations.clear();
    this.#nextIncarnation = 1;
    this.#removals.clear();
    this.#dirtyRemovals.clear();
    for (const botId of Object.keys(this.#workspaces)) {
      this.#generations.set(botId, this.#freshGeneration());
      this.#incarnations.set(botId, this.#freshIncarnation());
    }
    return this;
  }

  has(botId) {
    const id = botIdOf(botId);
    return Object.hasOwn(this.#workspaces, id) && !this.#removals.has(id);
  }

  incarnationFor(botId) {
    return this.#incarnations.get(botIdOf(botId)) ?? null;
  }

  workspaceFor(botId) {
    return this.#workspaces[botIdOf(botId)] ?? this.#defaultWorkspace;
  }

  agentPresetFor(botId) {
    return this.#agentPresets[botIdOf(botId)] ?? null;
  }

  generationFor(botId) {
    return this.#generations.get(botIdOf(botId)) ?? null;
  }

  async whenIdle() {
    await this.#writeQueue;
  }

  async whenBotIdle(botId) {
    const id = botIdOf(botId);
    while (true) {
      const pending = this.#botQueues.get(id);
      if (!pending) return;
      await pending;
      if (this.#botQueues.get(id) === pending) return;
    }
  }

  async ensure(botId, { workspace = this.#defaultWorkspace, defaultAgentPreset } = {}) {
    const id = botIdOf(botId);
    const initialWorkspace = resolve(workspace);
    return this.#enqueue(id, async () => {
      if (!this.#workspaces[id]) {
        const agentPreset = validateAgentPresetId(defaultAgentPreset);
        const hadAgentPreset = Object.hasOwn(this.#agentPresets, id);
        const previousAgentPreset = this.#agentPresets[id];
        this.#workspaces[id] = initialWorkspace;
        if (agentPreset) this.#agentPresets[id] = agentPreset;
        this.#generations.set(id, this.#freshGeneration());
        this.#incarnations.set(id, this.#freshIncarnation());
        try {
          await this.#persist();
        } catch (error) {
          delete this.#workspaces[id];
          if (hadAgentPreset) this.#agentPresets[id] = previousAgentPreset;
          else delete this.#agentPresets[id];
          this.#generations.delete(id);
          this.#incarnations.delete(id);
          throw error;
        }
      } else if (!this.#generations.has(id)) {
        this.#generations.set(id, this.#freshGeneration());
      }
      return this.#workspaces[id];
    });
  }

  async setWorkspace(botId, value, { clearSessions, incarnation } = {}) {
    const id = botIdOf(botId);
    if (!this.has(id)
      || (incarnation !== undefined && incarnation !== this.incarnationFor(id))) {
      const error = new Error('找不到要修改的机器人。');
      error.code = 'workspace-bot-not-found';
      throw error;
    }
    const workspace = await validateWorkspacePath(value);
    return this.#enqueue(id, async () => {
      if (!this.has(id)
        || (incarnation !== undefined && incarnation !== this.incarnationFor(id))) {
        const error = new Error('找不到要修改的机器人。');
        error.code = 'workspace-bot-not-found';
        throw error;
      }
      if (workspace === this.workspaceFor(id)) return workspace;
      const previous = this.#workspaces[id];
      // Advance first so a session creation that started before this queued
      // transition can never be written back after the clear.
      this.#generations.set(id, this.#freshGeneration());
      // Clear the old session mapping before publishing the new workspace.
      // A crash can then lose conversation continuity, but can never pair the
      // new workspace with sessions created in the old one.
      await clearSessions?.();
      this.#workspaces[id] = workspace;
      try {
        await this.#persist();
      } catch (error) {
        this.#workspaces[id] = previous;
        throw error;
      }
      return workspace;
    });
  }

  async setAgentPreset(botId, value, { incarnation } = {}) {
    const id = botIdOf(botId);
    if (!this.has(id)
      || (incarnation !== undefined && incarnation !== this.incarnationFor(id))) {
      const error = new Error('找不到要修改的机器人。');
      error.code = 'workspace-bot-not-found';
      throw error;
    }
    const agentPreset = validateAgentPresetId(value);
    return this.#enqueue(id, async () => {
      if (!this.has(id)
        || (incarnation !== undefined && incarnation !== this.incarnationFor(id))) {
        const error = new Error('找不到要修改的机器人。');
        error.code = 'workspace-bot-not-found';
        throw error;
      }
      const previous = this.#agentPresets[id] ?? null;
      if (previous === agentPreset) return agentPreset;
      if (agentPreset) this.#agentPresets[id] = agentPreset;
      else delete this.#agentPresets[id];
      try {
        await this.#persist();
      } catch (error) {
        if (previous) this.#agentPresets[id] = previous;
        else delete this.#agentPresets[id];
        throw error;
      }
      return agentPreset;
    });
  }

  async bindWorkspaceSession(botId, value, {
    conversationKey,
    sessionId,
    clearSessions,
    setSession,
    incarnation,
    expectedGeneration,
  } = {}) {
    const id = botIdOf(botId);
    if (typeof conversationKey !== 'string' || !conversationKey
      || typeof sessionId !== 'string' || !sessionId) {
      throw new TypeError('conversationKey and sessionId are required');
    }
    if (typeof clearSessions !== 'function' || typeof setSession !== 'function') {
      throw new TypeError('session state callbacks are required');
    }
    if (!this.has(id)
      || (incarnation !== undefined && incarnation !== this.incarnationFor(id))) {
      const error = new Error('找不到要修改的机器人。');
      error.code = 'workspace-bot-not-found';
      throw error;
    }
    const workspace = await canonicalWorkspacePath(await validateWorkspacePath(value));
    return this.#enqueue(id, async () => {
      if (!this.has(id)
        || (incarnation !== undefined && incarnation !== this.incarnationFor(id))) {
        const error = new Error('找不到要修改的机器人。');
        error.code = 'workspace-bot-not-found';
        throw error;
      }
      if (expectedGeneration !== undefined
        && expectedGeneration !== this.generationFor(id)) {
        throw workspaceSessionStale(
          'The bot workspace changed before the session binding could be committed.',
        );
      }

      if (!(await sameWorkspacePath(workspace, this.workspaceFor(id)))) {
        const previous = this.#workspaces[id];
        // Fence every session resolved before this transition, then remove
        // the old workspace mappings before publishing the new workspace.
        this.#generations.set(id, this.#freshGeneration());
        await clearSessions();
        this.#workspaces[id] = workspace;
        try {
          await this.#persist();
        } catch (error) {
          // Session mappings stay cleared and the advanced generation stays
          // fenced. Restoring either could pair an old session with a state
          // transition whose durable outcome is unknown.
          this.#workspaces[id] = previous;
          throw error;
        }
      }

      // This write remains inside the same bot transition as the workspace
      // mutation, so another switch or bind cannot interleave between them.
      await setSession(conversationKey, sessionId);
      return {
        workspace,
        sessionId,
        generation: this.#generations.get(id),
      };
    });
  }

  async invalidateSessions(botId, { clearSessions } = {}) {
    const id = botIdOf(botId);
    return this.#enqueue(id, async () => {
      this.#generations.set(id, this.#freshGeneration());
      await clearSessions?.();
    });
  }

  /** Fence one lifecycle and return the opaque token required to abort/finish it. */
  async beginRemoval(botId, { clearSessions } = {}) {
    const id = botIdOf(botId);
    return this.#enqueue(id, async () => {
      const existing = this.#removals.get(id);
      if (existing) return existing;
      const transaction = Object.freeze({});
      this.#removals.set(id, transaction);
      this.#removalDetails.set(transaction, {
        botId: id,
        incarnation: this.incarnationFor(id),
      });
      this.#generations.set(id, this.#freshGeneration());
      try {
        await clearSessions?.();
      } catch (error) {
        if (this.#removals.get(id) === transaction) this.#removals.delete(id);
        throw error;
      }
      return transaction;
    });
  }

  /** Re-open only the lifecycle represented by transaction; stale tokens are no-ops. */
  async abortRemoval(transaction) {
    const { botId: id } = this.#removalDetailsFor(transaction);
    return this.#enqueue(id, async () => {
      if (this.#removals.get(id) !== transaction) return false;
      this.#removals.delete(id);
      if (Object.hasOwn(this.#workspaces, id)) {
        this.#generations.set(id, this.#freshGeneration());
        if (!this.#incarnations.has(id)) {
          this.#incarnations.set(id, this.#freshIncarnation());
        }
      }
      return true;
    });
  }

  /** Retire only the lifecycle represented by transaction; stale tokens are no-ops. */
  async finishRemoval(transaction) {
    const { botId: id, incarnation } = this.#removalDetailsFor(transaction);
    return this.#enqueue(id, async () => {
      if (this.#removals.get(id) !== transaction) {
        return { removed: false, persisted: true, error: null, stale: true };
      }
      if (this.incarnationFor(id) !== incarnation) {
        this.#removals.delete(id);
        return { removed: false, persisted: true, error: null, stale: true };
      }
      this.#removals.delete(id);
      return this.#retireCurrentIncarnation(id);
    });
  }

  /** Commit the workspace lifecycle after the config store durably removed a bot. */
  async retireAfterConfigCommit(botId) {
    const id = botIdOf(botId);
    return this.#enqueue(id, async () => {
      this.#removals.delete(id);
      return this.#retireCurrentIncarnation(id);
    });
  }

  async remove(botId) {
    const result = await this.retireAfterConfigCommit(botId);
    if (result.error) throw result.error;
    return result.removed;
  }

  async reconcile(activeBotIds) {
    const active = new Set([...activeBotIds].map(botIdOf));
    const candidates = new Set([
      ...Object.keys(this.#workspaces),
      ...Object.keys(this.#agentPresets),
      ...this.#dirtyRemovals,
    ]);
    for (const botId of candidates) {
      if (!active.has(botId)) await this.remove(botId);
    }
  }

  decorateStatus(status) {
    if (!status || typeof status !== 'object' || !Array.isArray(status.bots)) return status;
    return {
      ...status,
      bots: status.bots.map((bot) => bot?.botId
        ? {
          ...bot,
          workspace: this.workspaceFor(bot.botId),
          agentPreset: this.agentPresetFor(bot.botId),
        }
        : bot),
    };
  }

  #freshGeneration() {
    const generation = this.#nextGeneration;
    this.#nextGeneration += 1;
    return generation;
  }

  #freshIncarnation() {
    const incarnation = this.#nextIncarnation;
    this.#nextIncarnation += 1;
    return incarnation;
  }

  #removalDetailsFor(transaction) {
    if (!transaction || typeof transaction !== 'object') {
      throw new TypeError('Invalid workspace removal transaction');
    }
    const details = this.#removalDetails.get(transaction);
    if (!details) throw new TypeError('Invalid workspace removal transaction');
    return details;
  }

  async #retireCurrentIncarnation(id) {
    const hadWorkspace = Object.hasOwn(this.#workspaces, id);
    const hadPreset = Object.hasOwn(this.#agentPresets, id);
    const needsCleanup = hadWorkspace || hadPreset || this.#dirtyRemovals.has(id);
    delete this.#workspaces[id];
    delete this.#agentPresets[id];
    this.#generations.delete(id);
    this.#incarnations.delete(id);
    if (!needsCleanup) return {
      removed: false, persisted: true, error: null, stale: false,
    };
    try {
      await this.#persistCurrentDocument();
      return {
        removed: hadWorkspace, persisted: true, error: null, stale: false,
      };
    } catch (error) {
      this.#dirtyRemovals.add(id);
      return {
        removed: hadWorkspace, persisted: false, error, stale: false,
      };
    }
  }

  async #enqueue(botId, operation) {
    const queued = this.#writeQueue.then(operation, operation);
    const settled = queued.then(() => undefined, () => undefined);
    this.#writeQueue = settled;
    this.#botQueues.set(botId, settled);
    void settled.finally(() => {
      if (this.#botQueues.get(botId) === settled) this.#botQueues.delete(botId);
    });
    return queued;
  }

  async #persist() {
    const document = { version: 1, workspaces: this.#workspaces };
    if (Object.keys(this.#agentPresets).length > 0) {
      document.agentPresets = this.#agentPresets;
    }
    await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
    const temporary = `${this.#path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporary, this.#path);
    this.#dirtyRemovals.clear();
  }

  async #persistCurrentDocument() {
    if (Object.keys(this.#workspaces).length > 0
      || Object.keys(this.#agentPresets).length > 0) {
      await this.#persist();
      return;
    }
    try {
      await unlink(this.#path);
      this.#dirtyRemovals.clear();
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      this.#dirtyRemovals.clear();
    }
  }
}

function resolveAgentPresetCatalog(catalog) {
  if (!catalog) return null;
  const value = typeof catalog === 'function' ? catalog() : catalog;
  return value && typeof value.then === 'function'
    ? value.then(normalizeAgentPresetCatalog)
    : normalizeAgentPresetCatalog(value);
}

function unavailableAgentPreset() {
  const error = new Error('Agent Preset 不存在或不可用。');
  error.code = 'agent-preset-unavailable';
  return error;
}

function assertCurrentBotScope(isCurrentScope) {
  if (isCurrentScope()) return;
  const error = new Error('找不到要修改的机器人。');
  error.code = 'workspace-bot-not-found';
  throw error;
}

function decorateResult(workspaces, result, catalog, singleOwnerOptions = null) {
  const applySingleOwner = (value) => {
    if (!singleOwnerOptions?.gate || !singleOwnerOptions?.channel || !value || typeof value !== 'object') {
      return value;
    }
    if (!Array.isArray(value.bots)) return value;
    const configById = new Map();
    if (typeof singleOwnerOptions.listBotConfigs === 'function') {
      for (const row of singleOwnerOptions.listBotConfigs() ?? []) {
        const id = row?.botId ?? row?.id;
        if (id) configById.set(id, row);
      }
    }
    return {
      ...value,
      bots: value.bots.map((bot) => {
        const id = bot?.botId ?? bot?.id;
        if (!id) return bot;
        return {
          ...bot,
          singleOwner: singleOwnerOptions.gate.publicStatus({
            channel: singleOwnerOptions.channel,
            botId: id,
            botConfig: configById.get(id),
          }),
        };
      }),
    };
  };
  const decorate = (value) => {
    const decorated = applySingleOwner(workspaces.decorateStatus(value));
    if (!catalog || !decorated || typeof decorated !== 'object') return decorated;
    const attachCatalog = (agentPresetCatalog) => (
      agentPresetCatalog ? { ...decorated, agentPresetCatalog } : decorated
    );
    const agentPresetCatalog = resolveAgentPresetCatalog(catalog);
    return agentPresetCatalog && typeof agentPresetCatalog.then === 'function'
      ? agentPresetCatalog.then(attachCatalog)
      : attachCatalog(agentPresetCatalog);
  };
  return result && typeof result.then === 'function'
    ? result.then(decorate)
    : decorate(result);
}

function targetStatus(controller) {
  return Promise.resolve(controller.status());
}

/** Observe the config store's durable removal commit without changing its API. */
export function observeBotWorkspaceRemovals(
  configStore,
  { workspaces, method = 'remove', botIdFromRemoved = (removed) => removed?.botId },
) {
  if (!configStore || !workspaces || typeof configStore[method] !== 'function') {
    throw new TypeError('configStore removal observer dependencies are required');
  }
  return new Proxy(configStore, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property === method) {
        return async (...args) => {
          const removed = await value.apply(target, args);
          const botId = removed ? botIdFromRemoved(removed, args) : null;
          if (botId) await workspaces.retireAfterConfigCommit(botId);
          return removed;
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export function createBotWorkspaceScope(
  harness,
  { botId, workspaces, state, agentPresetCatalog, accessGate = null } = {},
) {
  if (!harness || !workspaces || !state) throw new TypeError('harness, workspaces, and state are required');
  const incarnation = workspaces.incarnationFor(botId);
  const isCurrentScope = () => workspaces.has(botId)
    && workspaces.incarnationFor(botId) === incarnation;
  const presetSettings = async (catalog = agentPresetCatalog) => {
    let normalizedCatalog;
    try {
      normalizedCatalog = await resolveAgentPresetCatalog(catalog)
        ?? normalizeAgentPresetCatalog(null);
    } catch (error) {
      assertCurrentBotScope(isCurrentScope);
      throw error;
    }
    assertCurrentBotScope(isCurrentScope);
    return {
      agentPreset: workspaces.agentPresetFor(botId),
      agentPresetCatalog: normalizedCatalog,
    };
  };
  const sessionGenerations = new Map();
  const scopedHarness = new Proxy(harness, {
    get(target, property) {
      if (property === 'agentPresetSettings') {
        return async (options = {}) => {
          options?.signal?.throwIfAborted();
          assertCurrentBotScope(isCurrentScope);
          const settings = await presetSettings();
          options?.signal?.throwIfAborted();
          return settings;
        };
      }
      if (property === 'updateAgentPreset') {
        return async (value, options = {}) => {
          options?.signal?.throwIfAborted();
          assertCurrentBotScope(isCurrentScope);
          const agentPreset = value === '--default' ? null : validateAgentPresetId(value);
          let catalog = null;
          if (agentPreset) {
            ({ agentPresetCatalog: catalog } = await presetSettings());
            options?.signal?.throwIfAborted();
            if (!catalog.items.some((item) => item.id === agentPreset)) {
              throw unavailableAgentPreset();
            }
          }
          await workspaces.setAgentPreset(botId, agentPreset, { incarnation });
          assertCurrentBotScope(isCurrentScope);
          if (catalog) {
            return {
              agentPreset: workspaces.agentPresetFor(botId),
              agentPresetCatalog: catalog,
            };
          }
          try {
            return await presetSettings();
          } catch (error) {
            if (error?.code === 'workspace-bot-not-found') throw error;
            assertCurrentBotScope(isCurrentScope);
            return {
              agentPreset: workspaces.agentPresetFor(botId),
              agentPresetCatalog: normalizeAgentPresetCatalog(null),
            };
          }
        };
      }
      if (property === 'currentWorkspace') {
        return () => {
          if (!isCurrentScope()) {
            const error = new Error('找不到要修改的机器人。');
            error.code = 'workspace-bot-not-found';
            throw error;
          }
          return workspaces.workspaceFor(botId);
        };
      }
      if (property === 'assertWorkspaceScope') {
        return () => {
          if (!isCurrentScope()) {
            const error = new Error('找不到要修改的机器人。');
            error.code = 'workspace-bot-not-found';
            throw error;
          }
        };
      }
      if ((property === 'listWorkspaces'
        || property === 'listWorkspaceSessions'
        || property === 'listModels')
        && typeof target[property] === 'function') {
        return async (...args) => {
          if (!isCurrentScope()) {
            const error = new Error('找不到要修改的机器人。');
            error.code = 'workspace-bot-not-found';
            throw error;
          }
          const result = await target[property](...args);
          if (!isCurrentScope()) {
            const error = new Error('找不到要修改的机器人。');
            error.code = 'workspace-bot-not-found';
            throw error;
          }
          return result;
        };
      }
      if (property === 'switchWorkspace') {
        return (workspace) => {
          if (!isCurrentScope()) {
            const error = new Error('找不到要修改的机器人。');
            error.code = 'workspace-bot-not-found';
            return Promise.reject(error);
          }
          return workspaces.setWorkspace(botId, workspace, {
            clearSessions: () => state.clearSessions(),
            incarnation,
          });
        };
      }
      if (property === 'bindWorkspaceSession') {
        return async (conversationKey, sessionId) => {
          if (typeof conversationKey !== 'string' || !conversationKey
            || typeof sessionId !== 'string' || !sessionId) {
            throw new TypeError('conversationKey and sessionId are required');
          }
          if (!isCurrentScope()) {
            const error = new Error('找不到要修改的机器人。');
            error.code = 'workspace-bot-not-found';
            throw error;
          }
          if (typeof target.adoptWorkspaceSession !== 'function') {
            throw new TypeError('Harness does not support adopting workspace sessions');
          }
          const expectedGeneration = workspaces.generationFor(botId);
          const adopted = await target.adoptWorkspaceSession(sessionId);
          if (!isCurrentScope()) {
            const error = new Error('找不到要修改的机器人。');
            error.code = 'workspace-bot-not-found';
            throw error;
          }
          if (expectedGeneration !== workspaces.generationFor(botId)) {
            throw workspaceSessionStale(
              'The bot workspace changed while the session was being adopted.',
            );
          }
          if (!adopted || typeof adopted !== 'object'
            || adopted.sessionId !== sessionId || typeof adopted.workspace !== 'string') {
            throw new TypeError('Harness returned an invalid adopted workspace session');
          }
          const bound = await workspaces.bindWorkspaceSession(botId, adopted.workspace, {
            conversationKey,
            sessionId,
            clearSessions: () => state.clearSessions(),
            setSession: (key, selectedSessionId) => state.setSession(key, selectedSessionId),
            incarnation,
            expectedGeneration,
          });
          if (!isCurrentScope()) {
            const error = new Error('找不到要修改的机器人。');
            error.code = 'workspace-bot-not-found';
            throw error;
          }
          if (bound.generation !== workspaces.generationFor(botId)) {
            throw workspaceSessionStale(
              'The bot workspace changed before the session binding completed.',
            );
          }
          sessionGenerations.set(sessionId, bound.generation);
          return {
            ...adopted,
            workspace: bound.workspace,
            sessionId: bound.sessionId,
          };
        };
      }
      if (property === 'createSession') {
        return async (options = {}) => {
          await workspaces.whenBotIdle(botId);
          if (!isCurrentScope()) {
            const error = new Error('找不到要修改的机器人。');
            error.code = 'workspace-bot-not-found';
            throw error;
          }
          const generation = workspaces.generationFor(botId);
          const agentPreset = workspaces.agentPresetFor(botId);
          const sessionId = await target.createSession({
            ...options,
            workspace: workspaces.workspaceFor(botId),
            ...(agentPreset == null ? {} : { agentPreset }),
          });
          sessionGenerations.set(sessionId, generation);
          return sessionId;
        };
      }
      if (property === 'workspaceSession') {
        return (sessionId) => {
          if (typeof sessionId !== 'string' || !sessionId) {
            throw new TypeError('sessionId is required');
          }
          const generation = sessionGenerations.get(sessionId)
            ?? workspaces.generationFor(botId);
          // Transfer the mutable provenance entry into this immutable handle.
          // A later handle for the same id captures its own generation instead
          // of sharing deletion or rebinding state with this call.
          sessionGenerations.delete(sessionId);
          const isCurrentSession = () => isCurrentScope()
            && generation === workspaces.generationFor(botId);
          const invokeCurrentSession = async (method, args, action) => {
            if (!isCurrentSession()) {
              throw workspaceSessionStale(
                `The bot workspace changed before this ${action} started.`,
              );
            }
            const result = await target[method](sessionId, ...args);
            if (!isCurrentSession()) {
              throw workspaceSessionStale(
                `The bot workspace changed while this ${action} was running.`,
              );
            }
            return result;
          };
          const invokeStartedSessionMutation = async (method, args, action) => {
            if (!isCurrentSession()) {
              throw workspaceSessionStale(
                `The bot workspace changed before this ${action} started.`,
              );
            }
            // Once an irreversible control mutation has started, preserve its
            // actual outcome even if a workspace switch commits concurrently.
            return target[method](sessionId, ...args);
          };
          return Object.freeze({
            sessionId,
            async sessionExists(...args) {
              if (!isCurrentSession()) return false;
              const exists = await target.sessionExists(sessionId, ...args);
              return isCurrentSession() && exists;
            },
            models(...args) {
              return invokeCurrentSession('getSessionModels', args, 'model listing');
            },
            selectModel(...args) {
              return invokeCurrentSession('selectSessionModel', args, 'model selection');
            },
            isRunning(...args) {
              return invokeCurrentSession('isSessionRunning', args, 'run-state check');
            },
            hasActiveTurn(...args) {
              return invokeCurrentSession('hasActiveTurn', args, 'turn ownership check');
            },
            stopActiveTurn(...args) {
              return invokeStartedSessionMutation('stopActiveTurn', args, 'turn stop');
            },
            steerActiveTurn(...args) {
              return invokeStartedSessionMutation('steerActiveTurn', args, 'turn steering');
            },
            ask(...args) {
              if (!isCurrentSession()) {
                throw workspaceSessionStale(
                  'The bot workspace changed before this prompt started.',
                );
              }
              return target.ask(sessionId, ...args);
            },
          });
        };
      }
      if (property === 'sessionExists') {
        return (sessionId, ...args) => {
          if (!isCurrentScope()) return false;
          const generation = sessionGenerations.get(sessionId);
          if (generation !== undefined && generation !== workspaces.generationFor(botId)) {
            sessionGenerations.delete(sessionId);
            return false;
          }
          return target.sessionExists(sessionId, ...args);
        };
      }
      if (property === 'ask') {
        return (sessionId, ...args) => {
          const generation = sessionGenerations.get(sessionId);
          sessionGenerations.delete(sessionId);
          if (!isCurrentScope()
            || (generation !== undefined && generation !== workspaces.generationFor(botId))) {
            const error = new Error('The bot workspace changed before this prompt started.');
            error.code = WORKSPACE_SESSION_STALE;
            throw error;
          }
          return target.ask(sessionId, ...args);
        };
      }
      if (property === 'executeCommand' && typeof target.executeCommand === 'function') {
        return (sessionId, ...args) => {
          const generation = sessionGenerations.get(sessionId);
          sessionGenerations.delete(sessionId);
          if (!isCurrentScope()
            || (generation !== undefined && generation !== workspaces.generationFor(botId))) {
            const error = new Error('The bot workspace changed before this command started.');
            error.code = WORKSPACE_SESSION_STALE;
            throw error;
          }
          return target.executeCommand(sessionId, ...args);
        };
      }
      if (property === 'accessGate') {
        return accessGate;
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const scopedState = new Proxy(state, {
    get(target, property) {
      if (property === CONNECTION_TEST_STATE_IDENTITY) return target;
      if (property === 'sessionFor') {
        return (key, ...args) => {
          if (!isCurrentScope()) return null;
          const sessionId = target.sessionFor(key, ...args);
          if (sessionId && !sessionGenerations.has(sessionId)) {
            sessionGenerations.set(sessionId, workspaces.generationFor(botId));
          }
          return sessionId;
        };
      }
      if (property === 'setSession') {
        return (key, sessionId, ...args) => {
          const generation = sessionGenerations.get(sessionId);
          if (!isCurrentScope()
            || (generation !== undefined && generation !== workspaces.generationFor(botId))) {
            sessionGenerations.delete(sessionId);
            return false;
          }
          return target.setSession(key, sessionId, ...args);
        };
      }
      if (property === 'accessGate') {
        return accessGate;
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return Object.freeze({ harness: scopedHarness, state: scopedState });
}

export function createBotScopedHarness(harness, options) {
  return createBotWorkspaceScope(harness, options).harness;
}

export function createWorkspaceAwareController(controller, {
  workspaces,
  stateFor,
  agentPresetCatalog,
  singleOwnerGate = null,
  channel = null,
  listBotConfigs = null,
} = {}) {
  if (!controller || !workspaces || typeof stateFor !== 'function') {
    throw new TypeError('controller, workspaces, and stateFor are required');
  }
  const singleOwnerOptions = singleOwnerGate && channel
    ? { gate: singleOwnerGate, channel, listBotConfigs }
    : null;
  const transitions = new Map();
  const withBotTransition = (botId, operation) => {
    const previous = transitions.get(botId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    transitions.set(botId, current);
    return current.finally(() => {
      if (transitions.get(botId) === current) transitions.delete(botId);
    });
  };
  const decorate = (value) => decorateResult(workspaces, value, agentPresetCatalog, singleOwnerOptions);
  const updateWorkspace = (botId, workspace) => {
    // Capture at API invocation, before even waiting for an older outer
    // transition. A queued request still belongs to the incarnation that the
    // caller observed, not a deterministic same-id rebind that appears later.
    const incarnation = workspaces.incarnationFor(botId);
    return withBotTransition(botId, async () => {
      const snapshot = await controller.status();
      if (!snapshot?.bots?.some((bot) => bot?.botId === botId)) {
        const error = new Error('找不到要修改的机器人。');
        error.code = 'workspace-bot-not-found';
        throw error;
      }
      const state = await stateFor(botId);
      await workspaces.setWorkspace(botId, workspace, {
        clearSessions: () => state.clearSessions(),
        incarnation,
      });
      return decorate(await controller.status());
    });
  };
  const updateAgentPreset = (botId, agentPreset) => {
    const incarnation = workspaces.incarnationFor(botId);
    const normalizedAgentPreset = validateAgentPresetId(agentPreset);
    return withBotTransition(botId, async () => {
      const snapshot = await controller.status();
      if (!snapshot?.bots?.some((bot) => bot?.botId === botId)) {
        const error = new Error('找不到要修改的机器人。');
        error.code = 'workspace-bot-not-found';
        throw error;
      }
      const catalog = normalizedAgentPreset && agentPresetCatalog
        ? await resolveAgentPresetCatalog(agentPresetCatalog)
        : null;
      if (normalizedAgentPreset && agentPresetCatalog
        && !catalog?.items.some((item) => item.id === normalizedAgentPreset)) {
        throw unavailableAgentPreset();
      }
      await workspaces.setAgentPreset(botId, normalizedAgentPreset, { incarnation });
      return decorateResult(
        workspaces,
        await controller.status(),
        catalog ?? agentPresetCatalog,
        singleOwnerOptions,
      );
    });
  };
  const deleteWithWorkspace = (botId, invokeDelete) => withBotTransition(botId, async () => {
    // Fence the old runtime without changing the durable mapping. A crash
    // before the controller removes its config therefore keeps the bot's
    // workspace, while a crash after that commit is healed by startup
    // reconciliation.
    const removal = await workspaces.beginRemoval(botId, {
      clearSessions: async () => {
        try {
          const state = await stateFor(botId);
          if (!state || typeof state.clearSessions !== 'function') {
            throw new TypeError('bot state does not support session cleanup');
          }
          await state.clearSessions();
        } catch (error) {
          console.warn(
            `[dsh-im] ignored session cleanup failure while deleting bot ${botId}:`,
            error?.message ?? error,
          );
        }
      },
    });
    try {
      const result = await invokeDelete();
      await workspaces.finishRemoval(removal);
      return decorate(result);
    } catch (error) {
      const after = await targetStatus(controller).catch(() => null);
      const knownAbsent = Array.isArray(after?.bots)
        && !after.bots.some((bot) => bot?.botId === botId);
      if (knownAbsent) await workspaces.finishRemoval(removal);
      else await workspaces.abortRemoval(removal);
      throw error;
    }
  });

  return new Proxy(controller, {
    get(target, property) {
      if (property === 'updateWorkspace') return updateWorkspace;
      if (property === 'updateAgentPreset') return updateAgentPreset;
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      if (property === 'deleteBot') {
        return (botId, ...args) => deleteWithWorkspace(
          botId,
          () => value.call(target, botId, ...args),
        );
      }
      if (property === 'disconnect') {
        return async (...args) => {
          const before = await target.status();
          const botId = before?.bots?.[0]?.botId;
          if (!botId) return decorate(value.apply(target, args));
          return deleteWithWorkspace(botId, () => value.apply(target, args));
        };
      }
      return (...args) => decorate(value.apply(target, args));
    },
  });
}
