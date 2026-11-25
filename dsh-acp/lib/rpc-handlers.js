import path from 'node:path';
import {
  BUILTIN_AGENT_PRESETS,
  isSecretEnvKey,
  normalizeAgentRecord,
  normalizeEnvRecord,
  resolveProfilesBaseDir,
  saveSessionStore,
  sanitizeId,
  saveAgentsConfig,
} from './presets.js';
import { probeAcpAgent } from './acp-session.js';
import { openExternalUrl } from './agent-auth.js';
import { initAgentRuntime, runtimeBundle, agentRuntimeIdentity } from './agent-runtime.js';
import { acpErrorMessage } from './errors.js';
import { safeGetService } from './host-contract.js';
import {
  encodeConnKey,
  decodeConnKey,
  restoreMaskedEnv,
  extractModelsFromProbe,
} from './catalog-models.js';

export const MAX_RPC_BODY_BYTES = 2 * 1024 * 1024;
const FORBIDDEN_OPTION_KEY_RE = /mode|permission|approval|sandbox|trust|yolo|auto[-_]?approve|bypass|danger/i;

export function isLoopbackHostHeader(hostHeader) {
  if (!hostHeader) return true;
  const raw = String(hostHeader).trim().toLowerCase();
  if (!raw) return false;
  try {
    const parsed = new URL(`http://${raw}`);
    const host = parsed.hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

export function isLoopbackOriginHeader(originHeader) {
  if (!originHeader) return true;
  const raw = String(originHeader).trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

export async function readBoundedJson(req, maxBytes) {
  const declared = req.headers['content-length'];
  if (declared !== undefined && Number(declared) > maxBytes) {
    const error = new Error('payload too large');
    error.status = 413;
    req.destroy();
    throw error;
  }
  const chunks = [];
  let received = 0;
  for await (const chunk of req) {
    received += chunk.byteLength;
    if (received > maxBytes) {
      const error = new Error('payload too large');
      error.status = 413;
      req.destroy();
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('body is not JSON');
    error.status = 400;
    throw error;
  }
}

export function createRpcHandler({
  ctx,
  storeFile,
  tasks,
  authManager,
  discoveredModels,
  sessionConnections,
  getAgentList,
  setAgentList,
  getSessionStore,
  setSessionStore,
  getAgentById,
  getAllModelsForAgent,
  buildCatalog,
  mergeDiscoveredModels,
  markAcpAuthed,
  syncAdapterRoutes,
  closeAgentConnections,
  closeAllConnections,
  stopCredentialSessions,
  purgePendingToolsForConn,
  releaseConnMcpToken,
}) {
  function updateSessionOptionSelection(descriptors, selections, rawOption, key, modelId) {
    if (!rawOption || typeof rawOption !== 'object' || Array.isArray(rawOption)) throw new Error('Option must be a plain object with id and value.');
    const option = descriptors.find((item) => item.id === rawOption.id);
    if (!option || FORBIDDEN_OPTION_KEY_RE.test(`${option.id} ${option.category || ''}`)) throw new Error('This setting is not an editable model option.');
    const valid = option.type === 'boolean' ? typeof rawOption.value === 'boolean' : option.type === 'select' && option.options.some((choice) => choice.id === rawOption.value);
    if (!valid) throw new Error('The selected value was not advertised by this agent.');
    const updated = [...selections.filter((item) => item.id !== option.id), { id: option.id, value: rawOption.value }];
    const sessionStore = getSessionStore();
    sessionStore[key] = { ...sessionStore[key], modelOptions: { ...sessionStore[key]?.modelOptions, [modelId]: updated } };
    saveSessionStore(sessionStore, storeFile);
    return updated;
  }

  async function handleRpc(endpoint, input = {}) {
    switch (endpoint) {
      case 'delegation-status': {
        const task = tasks.tasks.get(input.runId);
        if (task) {
          if (task.parentId !== input.parentSessionId || task.childId !== input.childId) throw new Error('Delegation does not belong to this conversation.');
          const parentAgent = safeGetService(ctx, 'agents')?.get(task.parentId);
          if (parentAgent) return tasks.snapshot(parentAgent, task.taskId);
          return { ...task, requestKey: undefined, requestArguments: undefined };
        }
        const query = safeGetService(ctx, 'sessionQuery');
        const parent = await query.observeSession(input.parentSessionId);
        let start;
        try {
          start = parent.events.find((event) => event.type === 'acp-delegation/start' && event.data.runId === input.runId && event.data.childId === input.childId);
          if (!start) throw new Error('Delegation does not belong to this conversation.');
          const recorded = parent.events.find((event) => event.type === 'acp-delegation/end' && event.data.runId === input.runId);
          if (recorded) return recorded.data;
        } finally { parent[Symbol.dispose](); }
        // Earlier plugin versions could lose the result observer. The child
        // log remains authoritative; recovering its state does not restart it.
        const child = await query.observeSession(input.childId);
        try {
          const end = child.events.find((event) => event.type === 'turn/end' && event.time >= start.data.startedAt);
          if (!end) return null;
          const kind = end.data.reason.kind;
          return {
            endedAt: end.time,
            stopReason: kind === 'completed' ? 'completed' : ['aborted', 'interrupted'].includes(kind) ? 'aborted' : 'error',
            ...(end.data.reason.error?.message ? { diagnostic: end.data.reason.error.message } : {}),
          };
        } finally { child[Symbol.dispose](); }
      }
      case 'catalog': {
        return buildCatalog({ refreshAccounts: Boolean(input?.refreshAccounts) });
      }
      case 'session/options': {
        const sessionId = String(input?.sessionId || '');
        const agent = getAgentById(input?.agentId);
        const model = agent && getAllModelsForAgent(agent).find((item) => item.id === input?.model);
        if (!sessionId || !agent || !model) throw new Error('A conversation, configured agent and known model are required.');
        const key = encodeConnKey(sessionId, agent.id);
        const selections = getSessionStore()[key]?.modelOptions?.[model.id] || [];
        return { selections: input.option !== undefined ? updateSessionOptionSelection(model.options || [], selections, input.option, key, model.id) : selections };
      }
      case 'agent/auth-action': {
        const agent = getAgentById(input?.id);
        if (!agent) throw new Error('Unknown ACP agent.');
        await initAgentRuntime();
        return runtimeBundle().registryAuthAction.get(`dsh-${agent.id}`);
      }
      case 'agent/auth-action/accept': {
        const agent = getAgentById(input?.id);
        if (!agent) throw new Error('Unknown ACP agent.');
        await initAgentRuntime();
        const actions = runtimeBundle().registryAuthAction;
        const action = await actions.get(`dsh-${agent.id}`);
        if (!action || action.elicitationId !== input.elicitationId) throw new Error('This authorization request has expired.');
        if (!openExternalUrl(action.url)) throw new Error('The authorization URL could not be opened.');
        return { accepted: await actions.accept(`dsh-${agent.id}`, action.elicitationId) };
      }
      case 'agent/registry-search': {
        // Mirrors ACP runtime Settings → Providers → Add provider → "Show more":
        // list every installable agent from the official ACP registry.
        await initAgentRuntime();
        const { catalog } = runtimeBundle();
        const query = String(input?.query || '').trim();
        const limit = Math.max(1, Math.min(200, Number(input?.limit) || 100));
        const res = await catalog.search({ query, limit });
        const agents = (Array.isArray(res?.agents) ? res.agents : [])
          .map((a) => ({
            id: String(a?.id || ''),
            name: String(a?.name || a?.id || ''),
            description: String(a?.description || ''),
            version: String(a?.version || ''),
            icon: a?.icon ?? null,
          }))
          .filter((a) => a.id);
        return { agents };
      }
      case 'agent/toggle': {
        const id = sanitizeId(input?.id);
        const target = getAgentById(id);
        if (!target) throw new Error(`Unknown agent "${id}"`);
        const enabled = Boolean(input?.enabled);
        const nextAgents = getAgentList().map((a) => (a.id === id ? { ...a, enabled } : a));
        setAgentList(saveAgentsConfig(nextAgents, storeFile));
        syncAdapterRoutes();
        if (!enabled) {
          await closeAgentConnections(id);
        } else if (!discoveredModels.has(id)) {
          const updatedTarget = getAgentById(id);
          if (updatedTarget) {
            void probeAcpAgent(ctx, updatedTarget, process.cwd())
              .then((probe) => {
                if (probe?.ok) {
                  mergeDiscoveredModels(id, extractModelsFromProbe(probe));
                }
              })
              .catch((error) => { console.warn('[dsh-acp-agents] background agent probe failed:', acpErrorMessage(error)); });
          }
        }
        return buildCatalog();
      }
      case 'agent/save': {
        const raw = input?.agent || input;
        const id = sanitizeId(raw?.id || raw?.name);
        if (!id) throw new Error('Agent ID or name is required');
        const preset = BUILTIN_AGENT_PRESETS.find((p) => p.id === id) || null;
        const existing = getAgentById(id);
        const mergedInput = {
          ...(existing || preset || {}),
          ...raw,
          id,
        };
        if (raw?.driverKind === undefined) {
          delete mergedInput.driverKind;
        }
        // Catalog payloads mask secret env values; a mask round-tripping
        // back means "keep the stored secret" — never persist it (AC-033).
        if (raw?.env !== undefined) {
          mergedInput.env = restoreMaskedEnv(raw.env, existing?.env);
        }
        const record = normalizeAgentRecord(mergedInput, preset);
        if (!record) throw new Error('Invalid agent configuration');
        const agentList = getAgentList();
        const exists = agentList.some((a) => a.id === id);
        const nextAgents = exists
          ? agentList.map((a) => (a.id === id ? record : a))
          : [...agentList, record];
        // Mutate in-memory state only after the write succeeds (AC-030).
        setAgentList(saveAgentsConfig(nextAgents, storeFile));
        // Only tear down live sessions when connection- or auth-relevant
        // fields actually changed; cosmetic saves (model lists, favorites,
        // visibility, display text) must not kill running agent processes.
        const connChanged = !existing || agentRuntimeIdentity(existing) !== agentRuntimeIdentity(record);
        if (connChanged) {
          await authManager.invalidate(id);
          await closeAgentConnections(id);
        }
        syncAdapterRoutes();
        return buildCatalog({ refreshAccounts: Boolean(input?.refreshAccounts) });
      }
      case 'agent/create-account': {
        const baseAgentId = String(input?.baseAgentId || 'claude-code').trim();
        const basePreset = BUILTIN_AGENT_PRESETS.find((p) => p.id === baseAgentId) || null;
        const label = String(input?.name || '').trim();
        let index = 2;
        while (getAgentById(`${baseAgentId}-${index}`)) {
          index += 1;
        }
        const id = sanitizeId(input?.id || `${baseAgentId}-${index}`);
        if (!id) throw new Error('Agent ID or name is required');
        if (getAgentById(id)) {
          throw new Error(`Agent ID "${id}" already exists`);
        }
        const profilesBase = resolveProfilesBaseDir(storeFile);
        const explicitProfileDir = String(input?.profileDir || '').trim();
        const profileDir = explicitProfileDir || path.join(profilesBase, id);
        const name = label || `${basePreset?.name || baseAgentId} #${index}`;
        const record = normalizeAgentRecord(
          {
            ...(basePreset || {}),
            id,
            baseAgentId,
            builtin: false,
            name,
            profileDir,
            enabled: true,
            ...(input?.command ? { command: input.command } : {}),
            ...(input?.args ? { args: input.args } : {}),
            ...(input?.env ? { env: restoreMaskedEnv(input.env, null) } : {}),
          },
          null,
        );
        if (!record) throw new Error('Invalid agent configuration');
        setAgentList(saveAgentsConfig([...getAgentList(), record], storeFile));
        syncAdapterRoutes();
        return {
          createdId: record.id,
          catalog: await buildCatalog({ refreshAccounts: true }),
        };
      }
      case 'agent/delete': {
        const id = sanitizeId(input?.id);
        if (!id) throw new Error('Agent ID is required');
        const preset = BUILTIN_AGENT_PRESETS.find((p) => p.id === id) || null;
        await authManager.cancelLogin(id);
        await authManager.invalidate(id);
        await closeAgentConnections(id);
        discoveredModels.delete(id);
        const sessionStore = getSessionStore();
        let sessionsModified = false;
        for (const key of Object.keys(sessionStore)) {
          if (decodeConnKey(key)[1] === id) {
            delete sessionStore[key];
            sessionsModified = true;
          }
        }
        if (sessionsModified) saveSessionStore(sessionStore, storeFile);
        const agentList = getAgentList();
        const nextAgents = preset
          ? agentList.map((a) => (a.id === id ? normalizeAgentRecord(preset, preset) : a))
          : agentList.filter((a) => a.id !== id);
        setAgentList(saveAgentsConfig(nextAgents, storeFile));
        syncAdapterRoutes();
        return buildCatalog({ refreshAccounts: Boolean(input?.refreshAccounts) });
      }
      case 'agent/test': {
        const id = sanitizeId(input?.id);
        const target = input?.agent
          ? normalizeAgentRecord(
              {
                ...input.agent,
                // Renderer-supplied env may carry masked secrets — restore
                // them against the stored record before probing (AC-033).
                ...(input.agent.env !== undefined
                  ? { env: restoreMaskedEnv(input.agent.env, getAgentById(id)?.env) }
                  : {}),
              },
              BUILTIN_AGENT_PRESETS.find((p) => p.id === id) || null,
            )
          : getAgentById(id);
        if (!target) throw new Error(`Unknown agent "${id}"`);
        // Explicit user action: Antigravity may boot its managed runtime once
        // (liveSession) — the model list exists only on a live session.
        const probe = await probeAcpAgent(ctx, target, input?.cwd || process.cwd(), {
          liveSession: true,
        });
        let modelsFound = null;
        let modelsAdded = null;
        if (probe.ok) {
          const found = extractModelsFromProbe(probe);
          modelsFound = found.length;
          modelsAdded = mergeDiscoveredModels(target.id, found);
          if (probe.acpAuthenticated) markAcpAuthed(target.id);
        }
        return {
          ...probe,
          modelsFound,
          modelsAdded,
          catalog: await buildCatalog({ refreshAccounts: Boolean(input?.refreshAccounts) }),
        };
      }
      case 'agent/login': {
        const id = sanitizeId(input?.id);
        const target = getAgentById(id);
        if (!target) throw new Error(`Unknown agent "${id}"`);
        const explicitMethodId = typeof input?.methodId === 'string' ? input.methodId.trim() : '';
        const methodId = explicitMethodId || target.authMethod || '';

        // If credentials (API keys / custom base URL) were provided, save them into agent.env
        if (input?.credentials && typeof input.credentials === 'object') {
          // Credential fields round-trip through the masked catalog — a mask
          // keeps the stored secret, never the mask itself (AC-033).
          const submitted = restoreMaskedEnv(input.credentials, target.env);
          await stopCredentialSessions(target);
          const nextEnv = normalizeEnvRecord({
            ...(target.env || {}),
            ...submitted,
          });
          // Remove empty keys
          for (const [k, v] of Object.entries(submitted)) {
            if (v === '' || v === null) delete nextEnv[k];
          }
          const updated = normalizeAgentRecord(
            {
              ...target,
              authMethod: methodId || target.authMethod,
              acpAuthMethodId: explicitMethodId || target.acpAuthMethodId,
              env: nextEnv,
            },
            BUILTIN_AGENT_PRESETS.find((p) => p.id === id) || null,
          );
          const nextAgents = getAgentList().map((a) => (a.id === id ? updated : a));
          setAgentList(saveAgentsConfig(nextAgents, storeFile));
          await authManager.invalidate(id);
          await closeAgentConnections(id);
          if (input?.onlySaveCredentials) {
            return {
              flow: null,
              catalog: await buildCatalog({ refreshAccounts: true }),
            };
          }
        } else if (explicitMethodId && (explicitMethodId !== target.authMethod || explicitMethodId !== target.acpAuthMethodId)) {
          const updated = normalizeAgentRecord(
            { ...target, authMethod: explicitMethodId, acpAuthMethodId: explicitMethodId },
            BUILTIN_AGENT_PRESETS.find((p) => p.id === id) || null,
          );
          const nextAgents = getAgentList().map((a) => (a.id === id ? updated : a));
          setAgentList(saveAgentsConfig(nextAgents, storeFile));
        }

        const freshTarget = getAgentById(id);
        // "使用新凭据重新登录" must not reuse a cached flow/token — drop the
        // cached entry (in-flight flow + fingerprint + status cache) so
        // startLogin builds a genuinely fresh flow. The flag is forwarded as
        // well for the auth manager's own handling (AC-006).
        if (input?.forceNewToken) {
          await authManager.cancelLogin(id);
          await authManager.invalidate(id);
        }
        const flow = await authManager.startLogin(freshTarget, {
          methodId,
          forceNewToken: Boolean(input?.forceNewToken),
        });
        return {
          flow,
          catalog: await buildCatalog({ refreshAccounts: false }),
        };
      }
      case 'agent/login/cancel': {
        const id = sanitizeId(input?.id);
        await authManager.cancelLogin(id);
        return buildCatalog({ refreshAccounts: false });
      }
      case 'agent/login/respond': {
        const id = sanitizeId(input?.id);
        const sent = await authManager.respondToInteraction(id, input?.response);
        return { sent, catalog: await buildCatalog({ refreshAccounts: false }) };
      }
      case 'agent/login/complete': {
        const id = sanitizeId(input?.id);
        const sent = await authManager.completeLogin(id, input?.callbackUrl);
        return { sent, catalog: await buildCatalog({ refreshAccounts: false }) };
      }
      case 'agent/login/reauth': {
        // Clears stale CLI credentials then restarts the OAuth flow — the
        // one-click path out of "already logged in" early exits. Env-configured
        // API keys are intentionally preserved (logoutAgent only runs the CLI).
        const id = sanitizeId(input?.id);
        const target = getAgentById(id);
        if (!target) throw new Error(`Unknown agent "${id}"`);
        await closeAgentConnections(id);
        await authManager.logoutAgent(target);
        // The credentials were just destroyed: the persisted ACP-auth marker
        // is stale until the new login completes (same fix as AC-014), and a
        // cached flow/token must not be reused — drop the cached entry so
        // startLogin creates a genuinely fresh flow.
        if (target.acpAuthedAt != null) {
          const updated = normalizeAgentRecord(
            { ...target, acpAuthedAt: null },
            BUILTIN_AGENT_PRESETS.find((p) => p.id === id) || null,
          );
          const nextAgents = getAgentList().map((a) => (a.id === id ? updated : a));
          setAgentList(saveAgentsConfig(nextAgents, storeFile));
        }
        await authManager.invalidate(id);
        const flow = await authManager.startLogin(getAgentById(id), {
          methodId: String(input?.methodId || target.authMethod || ''),
          forceNewToken: input?.forceNewToken !== false,
        });
        return {
          flow,
          catalog: await buildCatalog({ refreshAccounts: false }),
        };
      }
      case 'agent/logout': {
        const id = sanitizeId(input?.id);
        const target = getAgentById(id);
        if (!target) throw new Error(`Unknown agent "${id}"`);
        let logoutWarning;
        try {
          await authManager.logoutAgent(target);
        } catch (error) {
          if (!input?.clearApiKeys) throw error;
          // Removing locally configured credentials does not depend on the
          // provider implementing logout. Keep its failure visible, however.
          logoutWarning = error?.message || String(error);
        }
        if (input?.clearApiKeys) await closeAgentConnections(id);
        let env = target.env;
        // Also clear API key env vars if logging out from API key mode.
        // Credential-shaped rows are identified by name, not a fixed vendor
        // list — custom KEY/TOKEN/SECRET entries are credentials too
        // (AC-031). Same key test the renderer uses for password inputs.
        if (input?.clearApiKeys) {
          env = {};
          for (const [k, v] of Object.entries(target.env || {})) {
            if (!isSecretEnvKey(k, v)) env[k] = v;
          }
        }
        // Logout must also clear the persisted ACP-auth marker — otherwise
        // the UI shows "未登录" and "ACP 会话已认证" at once, and silent-auth
        // probes may re-fire (AC-014). authManager.logoutAgent clears the
        // ACP runtime-side authState marker; invalidate clears the 60s status cache so
        // the refreshed catalog reports the post-logout state immediately.
        if (input?.clearApiKeys || target.acpAuthedAt != null) {
          const updated = normalizeAgentRecord(
            { ...target, env, acpAuthedAt: logoutWarning ? target.acpAuthedAt : null },
            BUILTIN_AGENT_PRESETS.find((p) => p.id === id) || null,
          );
          const nextAgents = getAgentList().map((a) => (a.id === id ? updated : a));
          setAgentList(saveAgentsConfig(nextAgents, storeFile));
        }
        await authManager.invalidate(id);
        const catalog = await buildCatalog({ refreshAccounts: true });
        return { ...catalog, ...(logoutWarning ? { logoutWarning } : {}) };
      }
      case 'agent/open-url': {
        const url = String(input?.url || '').trim();
        return { opened: Boolean(openExternalUrl(url)) };
      }
      case 'sessions/stop': {
        const agentId = input?.agentId ? sanitizeId(input.agentId) : null;
        const sessionId = input?.sessionId ? String(input.sessionId) : null;
        if (agentId && sessionId) {
          const key = encodeConnKey(sessionId, agentId);
          const conn = sessionConnections.get(key);
          if (conn) {
            sessionConnections.delete(key);
            purgePendingToolsForConn(conn);
            releaseConnMcpToken(conn);
            await conn.close().catch(() => { /* Continue deleting the agent configuration after its connection is already closed. */ });
          }
          delete getSessionStore()[key];
        } else if (agentId) {
          await closeAgentConnections(agentId);
          const sessionStore = getSessionStore();
          for (const key of Object.keys(sessionStore)) {
            if (decodeConnKey(key)[1] === agentId) delete sessionStore[key];
          }
        } else {
          await closeAllConnections();
          setSessionStore({});
        }
        saveSessionStore(getSessionStore(), storeFile);
        return buildCatalog();
      }
      default:
        throw new Error(`Unknown dsh-acp-agents endpoint: ${String(endpoint)}`);
    }
  }

  return {
    handleRpc,
    updateSessionOptionSelection,
  };
}

export function createHttpHandler(ctx, manager) {
  return async function handler(req, res) {
    const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname;
    const endpoint = pathname.startsWith('/dsh-acp-agents/')
      ? pathname.slice('/dsh-acp-agents/'.length)
      : '';
    // Non-MCP routes require the host connection layer's cookie/auth guard;
    // fail-closed (503) if the guard is unavailable.
    if (endpoint !== 'mcp') {
      if (typeof ctx.connection?.requestRejection !== 'function') {
        res.writeHead(503);
        res.end('service unavailable');
        return;
      }
      const rejection = ctx.connection.requestRejection(req);
      if (rejection !== undefined) {
        res.writeHead(rejection);
        res.end(rejection === 401 ? 'unauthorized' : 'forbidden');
        return;
      }
    }
    const badEndpoint =
      !endpoint
      || endpoint
        .split('/')
        .some((seg) => !seg || seg === '.' || seg === '..' || !/^[A-Za-z0-9_$.-]+$/.test(seg));
    if (req.method !== 'POST' || badEndpoint) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const contentType = String(req.headers['content-type'] ?? '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (contentType !== 'application/json') {
      res.writeHead(415);
      res.end('content type must be application/json');
      return;
    }
    // Authenticate /mcp requests (loopback Host/Origin + per-session Bearer
    // token) BEFORE reading the request body.
    let mcpSession = null;
    if (endpoint === 'mcp') {
      if (!isLoopbackHostHeader(req.headers['host']) || !isLoopbackOriginHeader(req.headers['origin'])) {
        res.writeHead(403);
        res.end('forbidden');
        return;
      }
      const auth = String(req.headers['authorization'] || '');
      mcpSession = auth.startsWith('Bearer ') ? manager.whaleisleMcp.sessionFor(auth.slice(7)) : null;
      if (!mcpSession) {
        res.writeHead(401);
        res.end('unauthorized');
        return;
      }
    }
    const reply = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const fail = (rpcId, message) =>
      reply(200, {
        type: 'server-response',
        rpcId: typeof rpcId === 'string' ? rpcId : 'invalid',
        result: { ok: false, error: { code: 'dsh-acp-agents/rejected', message, details: {} } },
      });
    let body;
    try {
      body = await readBoundedJson(req, MAX_RPC_BODY_BYTES);
    } catch (error) {
      res.writeHead(error?.status ?? 400);
      res.end(error?.message ?? 'bad request body');
      return;
    }
    if (endpoint === 'mcp') {
      const out = await manager.whaleisleMcp.dispatch(body, mcpSession);
      res.writeHead(out.status, { 'content-type': 'application/json' });
      res.end(out.body === undefined ? '' : JSON.stringify(out.body));
      return;
    }
    if (
      !body
      || typeof body !== 'object'
      || Array.isArray(body)
      || body.type !== 'client-request'
      || typeof body.rpcId !== 'string'
      || body.method !== endpoint
    ) {
      fail(body?.rpcId, `invalid client-request message for ${JSON.stringify(endpoint)}`);
      return;
    }
    try {
      const value = await manager.handleRpc(endpoint, body.payload ?? body.input ?? {});
      reply(200, {
        type: 'server-response',
        rpcId: body.rpcId,
        result: { ok: true, value },
      });
    } catch (error) {
      fail(body.rpcId, error instanceof Error ? error.message : String(error));
    }
  };
}
