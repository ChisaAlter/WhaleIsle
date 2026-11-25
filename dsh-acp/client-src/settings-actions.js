import { deriveUniqueAgentId, joinArgsText, splitArgsText, unwrapSwitchChecked } from './utils.js';

let envRowSeq = 0;
export function createEnvRow(key = '', value = '') {
  envRowSeq += 1;
  return { _rowId: `env-${envRowSeq}`, key, value };
}

function isMounted(mountedRef) {
  return !mountedRef || mountedRef.current !== false;
}

function commitCatalog(applyCatalog, setCatalog, next, expectedSeq) {
  if (typeof applyCatalog === 'function') return applyCatalog(next, expectedSeq);
  if (next !== undefined) setCatalog?.(next);
  return undefined;
}

function runTimeout(scheduleTimeout, fn, delayMs) {
  return typeof scheduleTimeout === 'function' ? scheduleTimeout(fn, delayMs) : setTimeout(fn, delayMs);
}

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
  const envEntries = Object.entries(agent.env || {}).map(([key, value]) =>
    createEnvRow(key, String(value ?? '')),
  );
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
  applyCatalog,
  setCatalog,
  scheduleTimeout,
  mountedRef,
  setSavedFlash,
  t,
}) {
  if (!selectedAgent) return false;
  setBusyAction?.('save');
  setBanner?.(null);
  try {
    const next = await rpc('agent/save', {
      agent: {
        ...patch,
        id: selectedAgent.id,
      },
    });
    if (!isMounted(mountedRef)) return true;
    commitCatalog(applyCatalog, setCatalog, next);
    if (flashKey) {
      setSavedFlash?.(flashKey);
      runTimeout(scheduleTimeout, () => setSavedFlash?.((cur) => (cur === flashKey ? null : cur)), 1800);
    }
    return true;
  } catch (err) {
    if (isMounted(mountedRef)) {
      setBanner?.({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
    }
    return false;
  } finally {
    if (isMounted(mountedRef)) setBusyAction?.('');
  }
}

export async function toggleAgentEnabled({
  agent,
  nextVal,
  rpc,
  setBusyAction,
  setBanner,
  applyCatalog,
  setCatalog,
  catalogSeqRef,
  scheduleTimeout,
  mountedRef,
  t,
}) {
  const enabled = unwrapSwitchChecked(nextVal, !agent.enabled);
  setBusyAction?.(`toggle:${agent.id}`);
  setBanner?.(null);
  try {
    const next = await rpc('agent/toggle', { id: agent.id, enabled });
    if (!isMounted(mountedRef)) return;
    const seqAfterToggle = commitCatalog(applyCatalog, setCatalog, next);
    if (enabled) {
      runTimeout(
        scheduleTimeout,
        () => {
          if (!isMounted(mountedRef)) return;
          if (catalogSeqRef && seqAfterToggle !== undefined && catalogSeqRef.current !== seqAfterToggle) return;
          void rpc('catalog')
            .then((d) => {
              if (!d || !isMounted(mountedRef)) return;
              if (catalogSeqRef && seqAfterToggle !== undefined && catalogSeqRef.current !== seqAfterToggle) return;
              commitCatalog(applyCatalog, setCatalog, d, seqAfterToggle);
            })
            .catch((error) => {
              console.warn('[dsh-acp-agents] background operation failed', error);
            });
        },
        2200,
      );
    }
  } catch (err) {
    if (isMounted(mountedRef)) {
      setBanner?.({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
    }
  } finally {
    if (isMounted(mountedRef)) setBusyAction?.('');
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

export async function testAndSyncAgent({
  agent,
  rpc,
  setBusyAction,
  setBanner,
  setProbeAuthAction,
  applyCatalog,
  setCatalog,
  registerCleanup,
  mountedRef,
  t,
}) {
  setBusyAction?.(`test:${agent.id}`);
  setBanner?.(null);
  let active = true;
  let polling = false;
  const poll = async () => {
    if (polling || !active || !isMounted(mountedRef)) return;
    polling = true;
    try {
      const action = await rpc('agent/auth-action', { id: agent.id });
      if (active && isMounted(mountedRef)) setProbeAuthAction?.(action ? { ...action, agentId: agent.id } : null);
    } catch {
      /* The probe result carries errors; this only observes pending consent. */
    } finally {
      polling = false;
    }
  };
  const consentTimer = setInterval(() => {
    void poll();
  }, 1000);
  const stopPolling = () => {
    active = false;
    clearInterval(consentTimer);
  };
  const unregister = typeof registerCleanup === 'function' ? registerCleanup(stopPolling) : () => {};
  try {
    const res = await rpc('agent/test', { id: agent.id });
    if (!isMounted(mountedRef)) return;
    if (res?.catalog) commitCatalog(applyCatalog, setCatalog, res.catalog);
    setBanner?.(buildTestBanner(res, agent, t));
  } catch (err) {
    if (isMounted(mountedRef)) {
      setBanner?.({ error: true, text: t('test.failed', { name: agent.name, error: err?.message || String(err) }) });
    }
  } finally {
    unregister?.();
    stopPolling();
    if (isMounted(mountedRef)) {
      setProbeAuthAction?.(null);
      setBusyAction?.('');
    }
  }
}

export async function startLoginFlow({
  selectedAgent,
  activeAuthMethod,
  forceNewToken = false,
  rpc,
  setBusyAction,
  setBanner,
  applyCatalog,
  setCatalog,
  mountedRef,
  t,
}) {
  if (!selectedAgent) return;
  setBusyAction?.('login');
  setBanner?.(null);
  try {
    const res = await rpc('agent/login', {
      id: selectedAgent.id,
      methodId: activeAuthMethod,
      forceNewToken,
    });
    if (!isMounted(mountedRef)) return;
    if (res?.catalog) commitCatalog(applyCatalog, setCatalog, res.catalog);
    setBanner?.({ error: false, text: t('login.started') });
  } catch (err) {
    if (isMounted(mountedRef)) {
      setBanner?.({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
    }
  } finally {
    if (isMounted(mountedRef)) setBusyAction?.('');
  }
}

export async function saveApiKeyCredentials({
  selectedAgent,
  activeAuthMethod,
  credDraft,
  rpc,
  setBusyAction,
  setBanner,
  applyCatalog,
  setCatalog,
  scheduleTimeout,
  mountedRef,
  setSavedFlash,
  t,
}) {
  if (!selectedAgent) return;
  setBusyAction?.('save-creds');
  setBanner?.(null);
  try {
    const res = await rpc('agent/login', {
      id: selectedAgent.id,
      methodId: activeAuthMethod,
      credentials: credDraft,
      onlySaveCredentials: true,
    });
    if (!isMounted(mountedRef)) return;
    if (res?.catalog) commitCatalog(applyCatalog, setCatalog, res.catalog);
    setSavedFlash?.('save-creds');
    runTimeout(scheduleTimeout, () => setSavedFlash?.((cur) => (cur === 'save-creds' ? null : cur)), 1800);
  } catch (err) {
    if (isMounted(mountedRef)) {
      setBanner?.({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
    }
  } finally {
    if (isMounted(mountedRef)) setBusyAction?.('');
  }
}

export async function respondLoginFlow({
  selectedAgent,
  response,
  rpc,
  setBanner,
  applyCatalog,
  setCatalog,
  mountedRef,
  t,
}) {
  if (!selectedAgent) return false;
  try {
    const res = await rpc('agent/login/respond', { id: selectedAgent.id, response });
    if (isMounted(mountedRef) && res?.catalog) commitCatalog(applyCatalog, setCatalog, res.catalog);
    return Boolean(res?.sent);
  } catch (err) {
    if (isMounted(mountedRef)) {
      setBanner?.({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
    }
    return false;
  }
}

export async function reauthLoginFlow({
  selectedAgent,
  activeAuthMethod,
  rpc,
  setBusyAction,
  setBanner,
  applyCatalog,
  setCatalog,
  mountedRef,
  t,
}) {
  if (!selectedAgent) return;
  setBusyAction?.('reauth');
  setBanner?.(null);
  try {
    const res = await rpc('agent/login/reauth', { id: selectedAgent.id, methodId: activeAuthMethod });
    if (!isMounted(mountedRef)) return;
    if (res?.catalog) commitCatalog(applyCatalog, setCatalog, res.catalog);
    setBanner?.({ error: false, text: t('login.started') });
  } catch (err) {
    if (isMounted(mountedRef)) {
      setBanner?.({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
    }
  } finally {
    if (isMounted(mountedRef)) setBusyAction?.('');
  }
}

export async function logoutAgent({
  selectedAgent,
  rpc,
  setBusyAction,
  setBanner,
  applyCatalog,
  setCatalog,
  mountedRef,
  t,
}) {
  if (!selectedAgent) return;
  setBusyAction?.('logout');
  setBanner?.(null);
  try {
    const next = await rpc('agent/logout', { id: selectedAgent.id, clearApiKeys: true });
    if (!isMounted(mountedRef)) return;
    commitCatalog(applyCatalog, setCatalog, next);
    setBanner?.(
      next.logoutWarning
        ? { error: true, text: t('logout.partial', { message: next.logoutWarning }) }
        : { error: false, text: t('logout.done', { name: selectedAgent.name }) },
    );
  } catch (err) {
    if (isMounted(mountedRef)) {
      setBanner?.({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
    }
  } finally {
    if (isMounted(mountedRef)) setBusyAction?.('');
  }
}

function mergeRuntimeEnv({ runtimeDraft, selectedAgent, envBaseline }) {
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
  const { selectedAgent, runtimeDraft, envBaselineRef, setRuntimeDraft, mountedRef } = ctx;
  if (!selectedAgent) return;
  const mergedEnv = mergeRuntimeEnv({
    runtimeDraft,
    selectedAgent,
    envBaseline: envBaselineRef?.current || [],
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
  if (saved && isMounted(mountedRef)) {
    // Re-sync to persisted truth so a cleared command shows the preset default.
    setRuntimeDraft?.((cur) => ({ ...cur, command: undefined }));
    if (envBaselineRef) envBaselineRef.current = Object.keys(mergedEnv);
  }
}

async function createRegistryInstance({
  addModal,
  agents,
  registryAgents,
  rpc,
  applyCatalog,
  setCatalog,
  setSelectedId,
  mountedRef,
}) {
  const registryId = addModal.baseAgentId.slice('registry:'.length);
  const regAgent = (registryAgents || []).find((a) => a.id === registryId);
  const existingIds = new Set((agents || []).map((a) => a.id));
  const instId = deriveUniqueAgentId(registryId, existingIds, 'registry-agent');
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
  if (!isMounted(mountedRef)) return;
  commitCatalog(applyCatalog, setCatalog, next);
  setSelectedId?.(instId);
}

async function createCustomInstance({
  addModal,
  agents,
  rpc,
  applyCatalog,
  setCatalog,
  setSelectedId,
  mountedRef,
  t,
}) {
  const existingIds = new Set((agents || []).map((a) => a.id));
  const customId = deriveUniqueAgentId(addModal.name, existingIds, 'custom');
  const next = await rpc('agent/save', {
    agent: {
      id: customId,
      baseAgentId: 'custom',
      name: addModal.name.trim() || t('modal.customCard'),
      badge: 'ACP',
      command: addModal.command.trim() || 'custom-acp',
      args: ['--acp'],
      enabled: true,
    },
  });
  if (!isMounted(mountedRef)) return;
  commitCatalog(applyCatalog, setCatalog, next);
  setSelectedId?.(customId);
}

export async function createAccountInstance(ctx) {
  const {
    addModal,
    agents,
    registryAgents,
    rpc,
    setBusyAction,
    setBanner,
    applyCatalog,
    setCatalog,
    setSelectedId,
    setAddModal,
    mountedRef,
    t,
  } = ctx;
  if (!addModal) return;
  setBusyAction?.('create-instance');
  setAddModal?.((cur) => (cur ? { ...cur, error: null } : cur));
  try {
    if (addModal.baseAgentId.startsWith('registry:')) {
      await createRegistryInstance({ addModal, agents, registryAgents, rpc, applyCatalog, setCatalog, setSelectedId, mountedRef });
    } else if (addModal.baseAgentId === 'custom') {
      await createCustomInstance({ addModal, agents, rpc, applyCatalog, setCatalog, setSelectedId, mountedRef, t });
    } else {
      const res = await rpc('agent/create-account', {
        baseAgentId: addModal.baseAgentId,
        name: addModal.name.trim(),
      });
      if (!isMounted(mountedRef)) return;
      if (res?.catalog) commitCatalog(applyCatalog, setCatalog, res.catalog);
      if (res?.createdId) setSelectedId?.(res.createdId);
    }
    if (isMounted(mountedRef)) setAddModal?.(null);
  } catch (err) {
    if (isMounted(mountedRef)) {
      const text = t('saveFailed', { message: err?.message || String(err) });
      setAddModal?.((cur) => (cur ? { ...cur, error: text } : cur));
      setBanner?.({ error: true, text });
    }
  } finally {
    if (isMounted(mountedRef)) setBusyAction?.('');
  }
}
