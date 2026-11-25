import {
  BUILTIN_AGENT_PRESETS,
  isSecretEnvKey,
  normalizeAgentRecord,
  resolveCommandBinary,
  resolveProfilesBaseDir,
  saveAgentsConfig,
} from './presets.js';
import {
  modelsFromConfigOptions,
  modelOptionMetadata,
} from './acp-session.js';
import { listStoreIssues } from './store-file.js';

// Secret-shaped env vars: catalog payloads must never broadcast their values to
// the renderer, so they are masked. A mask coming back on save means
// "keep the stored secret" and is never persisted itself (AC-033).
export const ENV_SECRET_MASK = '__DSH_ACP_MASKED_SECRET__';

export function maskEnvSecrets(env) {
  if (!env || typeof env !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    out[key] = isSecretEnvKey(key, value) ? ENV_SECRET_MASK : value;
  }
  return out;
}

export function restoreMaskedEnv(env, existing) {
  if (!env || typeof env !== 'object') return env;
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === ENV_SECRET_MASK) {
      const kept = existing?.[key];
      if (typeof kept === 'string' && kept !== ENV_SECRET_MASK) out[key] = kept;
      continue;
    }
    out[key] = value;
  }
  return out;
}

// sessionConnections keys are `${dshSessionId}::${agentId}`. agentId always
// comes from sanitizeId ([a-z0-9_-] — it can never contain ':'), so
// splitting at the LAST '::' is unambiguous even for session ids that
// themselves contain '::' (AC-038). The on-disk session-store key format is
// unchanged, so no migration is needed.
export function encodeConnKey(sessionId, agentId) {
  return `${String(sessionId)}::${String(agentId)}`;
}

export function decodeConnKey(key) {
  const text = String(key);
  const idx = text.lastIndexOf('::');
  if (idx === -1) return [text, ''];
  return [text.slice(0, idx), text.slice(idx + 2)];
}

/**
 * Everything a probe learned about models, in one deduped list. The registry
 * probe normalizes models into `probe.models` (its `configOptions` are
 * ProviderOptionDescriptors with model choices deliberately stripped); the
 * live-session probe returns raw session configOptions that
 * `modelsFromConfigOptions` reads instead.
 */
export function extractModelsFromProbe(probe) {
  const found = [];
  const seen = new Set();
  const push = (id, name, metadata = {}) => {
    const clean = String(id || '').trim();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    found.push({ ...metadata, id: clean, name: String(name || clean) });
  };
  const descriptors = probe?.configOptionsFormat === 'descriptors';
  const metadata = descriptors ? modelOptionMetadata(probe.configOptions) : {};
  for (const m of probe?.models || []) {
    push(m?.id ?? m?.modelId ?? m?.value, m?.name ?? m?.label, { ...metadata, ...m });
  }
  for (const m of descriptors ? [] : modelsFromConfigOptions(probe?.configOptions)) {
    push(m.id, m.name, m);
  }
  return found;
}

export function createCatalogManager({
  storeFile,
  ownedStoreFiles,
  discoveredModels,
  liveModelIds,
  sessionConnections,
  authManager,
  getAgentList,
  setAgentList,
  syncAdapterRoutes,
  appendAcpErrorLog,
}) {
  /**
   * Returns all known models for an agent (configured + discovered), annotated with
   * `favorite` and `hidden`.
   */
  function getAllModelsForAgent(agent) {
    const base = Array.isArray(agent?.models) ? [...agent.models] : [];
    const extra = discoveredModels.get(agent?.id) || [];
    const favSet = new Set(Array.isArray(agent?.favoriteModels) ? agent.favoriteModels : []);
    const hiddenSet = new Set(Array.isArray(agent?.hiddenModels) ? agent.hiddenModels : []);
    const seen = new Set();
    const all = [];
    const live = [...sessionConnections.values()].find((connection) => !connection.closed && connection.capabilitiesKnown && connection.agentConfig.id === agent.id);

    for (const item of [...base, ...extra]) {
      const id = String(item?.id || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      all.push({
        ...item,
        ...extra.find((model) => model.id === id),
        ...(live ? { inputModalities: live.supportsImages ? ['text', 'image'] : ['text'] } : {}),
        ...(live?.currentModel === id && live.activeTurn?.contextUsage?.maxTokens ? { context: { contextWindow: live.activeTurn.contextUsage.maxTokens } } : {}),
        id,
        name: item.name || id,
        favorite: favSet.has(id),
        hidden: hiddenSet.has(id),
        discovered: item.discovered === true || !base.some((b) => b.id === id),
        available: !liveModelIds.has(agent.id) || liveModelIds.get(agent.id).has(id),
      });
    }

    if (all.length === 0) {
      all.push({
        id: 'default',
        name: `${agent?.name || 'ACP'} Default`,
        favorite: false,
        hidden: false,
        discovered: false,
        available: !liveModelIds.has(agent?.id) || liveModelIds.get(agent.id).has('default'),
      });
    }

    // Sort favorites to the top while preserving relative order
    all.sort((a, b) => {
      if (a.favorite && !b.favorite) return -1;
      if (!a.favorite && b.favorite) return 1;
      return 0;
    });

    return all;
  }

  /**
   * Returns enabled (non-hidden) models exposed to the composer ModelSelect.
   * Hiding every model yields an empty list — the user asked for none.
   */
  function getEffectiveModels(agent) {
    return getAllModelsForAgent(agent).filter((m) => !m.hidden && m.available !== false);
  }

  function listDelegationAgents() {
    return getAgentList().filter((agent) => agent.enabled).map((agent) => ({
      id: agent.id,
      name: agent.name,
      provider: agent.providerId,
      models: getEffectiveModels(agent).map((model) => ({ id: model.id, name: model.name || model.id, efforts: model.efforts || [], options: model.options || [] })),
      runtimeModes: ['inherit', 'read-only', 'approval-required'], interactionModes: ['default', 'plan'], isolation: ['shared', 'worktree'],
    }));
  }

  async function buildCatalog({ refreshAccounts = false } = {}) {
    const agentList = getAgentList();
    const activeByAgent = new Map();
    const commandsByAgent = new Map();
    const activeSessions = [];
    for (const [key, conn] of sessionConnections.entries()) {
      if (conn.closed) continue;
      const [sessionId, agentId] = decodeConnKey(key);
      activeByAgent.set(agentId, (activeByAgent.get(agentId) || 0) + 1);
      if (
        !commandsByAgent.has(agentId)
        && Array.isArray(conn.availableCommands)
        && conn.availableCommands.length > 0
      ) {
        commandsByAgent.set(agentId, conn.availableCommands);
      }
      activeSessions.push({
        sessionId,
        agentId,
        acpSessionId: conn.acpSessionId,
        cwd: conn.cwd,
        currentModel: conn.currentModel,
        currentModeId: conn.currentModeId,
        availableModes: conn.availableModes,
        availableCommands: conn.availableCommands,
        contextUsage: conn.activeTurn?.contextUsage || null,
      });
    }

    const accountStatuses = await Promise.all(
      agentList.map((agent) =>
        authManager.getAgentAccountStatus(agent, { forceRefresh: refreshAccounts }).catch(() => null),
      ),
    );

    const agents = agentList.map((agent, idx) => {
      const binaryPath = agent.command ? resolveCommandBinary(agent.command, agent.env) : '';
      const account = accountStatuses[idx] || null;
      const authFlow = authManager.getFlowState(agent.id);
      return {
        ...agent,
        // Never broadcast stored secrets to the renderer — secret-shaped env
        // values are masked; a mask coming back on save keeps the stored
        // value (see restoreMaskedEnv, AC-033).
        env: maskEnvSecrets(agent.env),
        models: getEffectiveModels(agent),
        allModels: getAllModelsForAgent(agent),
        configuredModels: agent.models,
        discoveredModels: discoveredModels.get(agent.id) || [],
        binaryFound: Boolean(binaryPath) || agent.registrySource === 'registry',
        binaryPath: binaryPath || null,
        version: account?.version || null,
        account,
        authFlow,
        // Surface the live session's slash commands at the agent level so the
        // client can render them without joining activeSessions (AC-043).
        availableCommands: commandsByAgent.get(agent.id) || [],
        activeSessionCount: activeByAgent.get(agent.id) || 0,
      };
    });

    return {
      agents,
      activeSessions,
      storeFile,
      profilesBaseDir: resolveProfilesBaseDir(storeFile),
      // Unreadable stores were preserved aside; the settings page reports them.
      storeIssues: listStoreIssues(ownedStoreFiles),
    };
  }

  /**
   * Discovered models merge into the persisted agent record (flagged
   * `discovered`) so they survive restarts and hidden/favorite ids never
   * dangle across sessions. The runtime map mirrors the latest snapshot for
   * the live catalog view.
   */
  function mergeDiscoveredModels(agentId, found) {
    if (!Array.isArray(found) || found.length === 0) return 0;
    if (JSON.stringify(discoveredModels.get(agentId)) === JSON.stringify(found)) return 0;
    discoveredModels.set(agentId, found);
    const agentList = getAgentList();
    const agent = agentList.find((a) => a.id === agentId);
    const existing = Array.isArray(agent?.models) ? agent.models : [];
    const known = new Set(existing.map((m) => String(m?.id || '')));
    const additions = [];
    for (const item of found) {
      const id = String(item?.id || '').trim();
      if (!id || known.has(id)) continue;
      known.add(id);
      additions.push({
        id,
        name: String(item.name || id),
        discovered: true,
      });
    }
    if (!agent) return 0;
    const enriched = existing.map((model) => {
      const metadata = found.find((item) => item.id === model.id);
      return metadata ? { ...model, ...metadata } : model;
    });
    for (const model of additions) Object.assign(model, found.find((item) => item.id === model.id));
    const nextAgents = agentList.map((a) =>
      a.id === agentId ? { ...a, models: [...enriched, ...additions] } : a,
    );
    // Mutate in-memory state only after the write succeeds (AC-030).
    setAgentList(saveAgentsConfig(nextAgents, storeFile));
    syncAdapterRoutes();
    return additions.length;
  }

  // Records that an ACP `authenticate` succeeded for this agent. Probes
  // (model sync, enable toggle) are only allowed to run silent auth once one
  // interactive login has completed — otherwise session/new always fails for
  // auth-required agents and discovery can never recover.
  function markAcpAuthed(agentId) {
    const agentList = getAgentList();
    const agent = agentList.find((a) => a.id === agentId);
    if (!agent) return;
    // Persist the runtime's confirmed-auth marker too — account status reads authState,
    // not acpAuthedAt, so without this the UI reports "未登录" forever and
    // re-prompts sign-in after every successful session authenticate.
    void authManager?.markAuthenticated?.(agent).catch((error) => appendAcpErrorLog('authentication/persist', error, { agentId }));
    if (agent.acpAuthedAt) return;
    const updated = normalizeAgentRecord(
      { ...agent, acpAuthedAt: Date.now() },
      BUILTIN_AGENT_PRESETS.find((p) => p.id === agentId) || null,
    );
    const nextAgents = agentList.map((a) => (a.id === agentId ? updated : a));
    setAgentList(saveAgentsConfig(nextAgents, storeFile));
  }

  return {
    getAllModelsForAgent,
    getEffectiveModels,
    listDelegationAgents,
    buildCatalog,
    mergeDiscoveredModels,
    markAcpAuthed,
  };
}
