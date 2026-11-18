import { joinArgsText, splitArgsText, unwrapSwitchChecked } from './utils.js';

export function buildDraftForAgent(agent) {
  const methods = agent.account?.availableMethods || [];
  const currentMethod =
    agent.account?.authMethod || agent.authMethod || methods[0]?.id || '';
  const credDraft = {};
  for (const m of methods) {
    for (const f of m.fields || []) {
      credDraft[f.key] = agent.env?.[f.key] || '';
    }
  }
  const envEntries = Object.entries(agent.env || {}).map(([key, value]) => ({
    key,
    value: String(value ?? ''),
  }));
  return {
    activeAuthMethod: currentMethod,
    credDraft,
    envBaseline: Object.keys(agent.env || {}),
    runtimeDraft: {
      name: agent.name || '',
      badge: agent.badge || 'ACP',
      // undefined = field untouched -> keep persisted command; '' = the user
      // blanked it on purpose -> send empty so the preset default takes over.
      command: undefined,
      argsText: joinArgsText(agent.args),
      profileDir: agent.profileDir || '',
      permissionPolicy: agent.permissionPolicy || 'ask',
      envRows: envEntries,
    },
  };
}

export function patchCatalogAgent(setCatalog, agentId, patch) {
  setCatalog((cur) => {
    if (!cur?.agents) return cur;
    return {
      ...cur,
      agents: cur.agents.map((a) => (a.id === agentId ? { ...a, ...patch } : a)),
    };
  });
}

export async function saveAgentPatch({
  selectedAgent,
  patch,
  flashKey,
  rpc,
  setBusyAction,
  setBanner,
  setCatalog,
  setSavedFlash,
  t,
}) {
  if (!selectedAgent) return false;
  setBusyAction('save');
  setBanner(null);
  try {
    const next = await rpc('agent/save', {
      agent: {
        ...patch,
        id: selectedAgent.id,
      },
    });
    setCatalog(next);
    if (flashKey) {
      setSavedFlash(flashKey);
      setTimeout(() => setSavedFlash((cur) => (cur === flashKey ? null : cur)), 1800);
    }
    return true;
  } catch (err) {
    setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
    return false;
  } finally {
    setBusyAction('');
  }
}

export async function toggleAgentEnabled({ agent, nextVal, rpc, setBusyAction, setBanner, setCatalog, t }) {
  const enabled = unwrapSwitchChecked(nextVal, !agent.enabled);
  setBusyAction(`toggle:${agent.id}`);
  setBanner(null);
  try {
    const next = await rpc('agent/toggle', { id: agent.id, enabled });
    setCatalog(next);
    if (enabled) {
      setTimeout(() => {
        void rpc('catalog')
          .then((d) => d && setCatalog(d))
          .catch((error) => {
            console.warn('[dsh-acp/client/client.js] background operation failed', error);
          });
      }, 2200);
    }
  } catch (err) {
    setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
  } finally {
    setBusyAction('');
  }
}

function buildTestBanner(res, agent, t) {
  if (!res?.ok) {
    return {
      error: true,
      text: t('test.failed', { name: agent.name, error: res?.error || t('test.handshakeFailed') }),
    };
  }
  const binary = res.binaryPath || agent.command;
  const text =
    typeof res.modelsFound === 'number'
      ? t('test.okSynced', {
          name: agent.name,
          binary,
          found: String(res.modelsFound),
          added: String(res.modelsAdded ?? 0),
        })
      : t('test.ok', { name: agent.name, binary });
  return { error: false, text };
}

export async function testAndSyncAgent({ agent, rpc, setBusyAction, setBanner, setProbeAuthAction, setCatalog, t }) {
  setBusyAction(`test:${agent.id}`);
  setBanner(null);
  let active = true;
  let polling = false;
  const poll = async () => {
    if (polling || !active) return;
    polling = true;
    try {
      const action = await rpc('agent/auth-action', { id: agent.id });
      if (active) setProbeAuthAction(action ? { ...action, agentId: agent.id } : null);
    } catch {
      /* The probe result carries errors; this only observes pending consent. */
    } finally {
      polling = false;
    }
  };
  const consentTimer = setInterval(() => {
    void poll();
  }, 1000);
  try {
    const res = await rpc('agent/test', { id: agent.id });
    if (res?.catalog) setCatalog(res.catalog);
    setBanner(buildTestBanner(res, agent, t));
  } catch (err) {
    setBanner({ error: true, text: t('test.failed', { name: agent.name, error: err?.message || String(err) }) });
  } finally {
    active = false;
    clearInterval(consentTimer);
    setProbeAuthAction(null);
    setBusyAction('');
  }
}

export async function startLoginFlow({
  selectedAgent,
  activeAuthMethod,
  forceNewToken = false,
  rpc,
  setBusyAction,
  setBanner,
  setCatalog,
  t,
}) {
  if (!selectedAgent) return;
  setBusyAction('login');
  setBanner(null);
  try {
    const res = await rpc('agent/login', {
      id: selectedAgent.id,
      methodId: activeAuthMethod,
      forceNewToken,
    });
    if (res?.catalog) setCatalog(res.catalog);
    setBanner({ error: false, text: t('login.started') });
  } catch (err) {
    setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
  } finally {
    setBusyAction('');
  }
}

export async function saveApiKeyCredentials({
  selectedAgent,
  activeAuthMethod,
  credDraft,
  rpc,
  setBusyAction,
  setBanner,
  setCatalog,
  setSavedFlash,
  t,
}) {
  if (!selectedAgent) return;
  setBusyAction('save-creds');
  setBanner(null);
  try {
    const res = await rpc('agent/login', {
      id: selectedAgent.id,
      methodId: activeAuthMethod,
      credentials: credDraft,
      onlySaveCredentials: true,
    });
    if (res?.catalog) setCatalog(res.catalog);
    setSavedFlash('save-creds');
    setTimeout(() => setSavedFlash((cur) => (cur === 'save-creds' ? null : cur)), 1800);
  } catch (err) {
    setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
  } finally {
    setBusyAction('');
  }
}

export async function respondLoginFlow({ selectedAgent, response, rpc, setBanner, setCatalog, t }) {
  if (!selectedAgent) return false;
  try {
    const res = await rpc('agent/login/respond', { id: selectedAgent.id, response });
    if (res?.catalog) setCatalog(res.catalog);
    return Boolean(res?.sent);
  } catch (err) {
    setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
    return false;
  }
}

export async function reauthLoginFlow({ selectedAgent, activeAuthMethod, rpc, setBusyAction, setBanner, setCatalog, t }) {
  if (!selectedAgent) return;
  setBusyAction('reauth');
  setBanner(null);
  try {
    const res = await rpc('agent/login/reauth', { id: selectedAgent.id, methodId: activeAuthMethod });
    if (res?.catalog) setCatalog(res.catalog);
    setBanner({ error: false, text: t('login.started') });
  } catch (err) {
    setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
  } finally {
    setBusyAction('');
  }
}

export async function logoutAgent({ selectedAgent, rpc, setBusyAction, setBanner, setCatalog, t }) {
  if (!selectedAgent) return;
  setBusyAction('logout');
  setBanner(null);
  try {
    const next = await rpc('agent/logout', { id: selectedAgent.id, clearApiKeys: true });
    setCatalog(next);
    setBanner(
      next.logoutWarning
        ? { error: true, text: t('logout.partial', { message: next.logoutWarning }) }
        : { error: false, text: t('logout.done', { name: selectedAgent.name }) },
    );
  } catch (err) {
    setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
  } finally {
    setBusyAction('');
  }
}

export function mergeRuntimeEnv({ runtimeDraft, selectedAgent, envBaseline }) {
  const envObj = {};
  for (const row of runtimeDraft.envRows) {
    const k = String(row.key || '').trim();
    if (k) envObj[k] = String(row.value ?? '');
  }
  // Merge over the persisted env instead of replacing it with the stale
  // draft rows: keys added since the draft snapshot survive; removed baseline keys stay removed.
  const userKeys = new Set(Object.keys(envObj));
  const removedKeys = new Set(envBaseline.filter((k) => !userKeys.has(k)));
  const mergedEnv = {};
  for (const [k, v] of Object.entries(selectedAgent.env || {})) {
    if (!removedKeys.has(k)) mergedEnv[k] = v;
  }
  Object.assign(mergedEnv, envObj);
  return mergedEnv;
}

export async function saveRuntimeAndEnv(ctx) {
  const { selectedAgent, runtimeDraft, envBaselineRef, setRuntimeDraft } = ctx;
  if (!selectedAgent) return;
  const mergedEnv = mergeRuntimeEnv({
    runtimeDraft,
    selectedAgent,
    envBaseline: envBaselineRef.current,
  });
  const command = runtimeDraft.command === undefined ? selectedAgent.command : runtimeDraft.command.trim();
  const saved = await saveAgentPatch({
    ...ctx,
    flashKey: 'save-runtime',
    patch: {
      name: runtimeDraft.name.trim() || selectedAgent.name,
      badge: runtimeDraft.badge.trim() || selectedAgent.badge,
      command,
      args: splitArgsText(runtimeDraft.argsText),
      profileDir: runtimeDraft.profileDir.trim(),
      permissionPolicy: runtimeDraft.permissionPolicy,
      env: mergedEnv,
    },
  });
  if (saved) {
    // Re-sync to persisted truth so a cleared command shows the preset default.
    setRuntimeDraft((cur) => ({ ...cur, command: undefined }));
    envBaselineRef.current = Object.keys(mergedEnv);
  }
}

async function createRegistryInstance({ addModal, agents, registryAgents, rpc, setCatalog, setSelectedId }) {
  const registryId = addModal.baseAgentId.slice('registry:'.length);
  const regAgent = (registryAgents || []).find((a) => a.id === registryId);
  const baseSlug = registryId.toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'registry-agent';
  const existingIds = new Set(agents.map((a) => a.id));
  let instId = baseSlug;
  let suffix = 2;
  while (existingIds.has(instId)) {
    instId = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
  const next = await rpc('agent/save', {
    agent: {
      id: instId,
      baseAgentId: 'custom',
      name: addModal.name.trim() || regAgent?.name || registryId,
      badge: 'ACP',
      description: regAgent?.description || '',
      registrySource: 'registry',
      registryAgentId: registryId,
      command: '',
      args: [],
      enabled: true,
      permissionPolicy: 'ask',
    },
  });
  setCatalog(next);
  setSelectedId(instId);
}

async function createCustomInstance({ addModal, rpc, setCatalog, setSelectedId }) {
  const customId = addModal.name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || `custom-${Date.now()}`;
  const next = await rpc('agent/save', {
    agent: {
      id: customId,
      baseAgentId: 'custom',
      name: addModal.name.trim() || 'Custom ACP Agent',
      badge: 'ACP',
      command: addModal.command.trim() || 'custom-acp',
      args: ['--acp'],
      enabled: true,
    },
  });
  setCatalog(next);
  setSelectedId(customId);
}

export async function createAccountInstance(ctx) {
  const { addModal, agents, registryAgents, rpc, setBusyAction, setBanner, setCatalog, setSelectedId, setAddModal, t } =
    ctx;
  if (!addModal) return;
  setBusyAction('create-instance');
  try {
    if (addModal.baseAgentId.startsWith('registry:')) {
      await createRegistryInstance({ addModal, agents, registryAgents, rpc, setCatalog, setSelectedId });
    } else if (addModal.baseAgentId === 'custom') {
      await createCustomInstance({ addModal, rpc, setCatalog, setSelectedId });
    } else {
      const res = await rpc('agent/create-account', {
        baseAgentId: addModal.baseAgentId,
        name: addModal.name.trim(),
      });
      if (res?.catalog) setCatalog(res.catalog);
      if (res?.createdId) setSelectedId(res.createdId);
    }
    setAddModal(null);
  } catch (err) {
    setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
  } finally {
    setBusyAction('');
  }
}
