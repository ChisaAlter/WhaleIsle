import {
  h,
  useState,
  useEffect,
  useId,
  useMemo,
  useCallback,
  useRef,
  Button,
  StateDot,
  Switch,
  IconPlusOutline16,
  IconRefreshOutline16,
} from './primitives.js';
import { BUILTIN_REGISTRY_IDS, copyTextToClipboard, maskEmail, safeHttpsIconUrl } from './utils.js';
import {
  buildDraftForAgent,
  patchCatalogAgent,
  saveAgentPatch,
  toggleAgentEnabled,
  testAndSyncAgent,
  startLoginFlow,
  saveApiKeyCredentials,
  respondLoginFlow,
  reauthLoginFlow,
  logoutAgent,
  saveRuntimeAndEnv,
  createAccountInstance,
} from './settings-actions.js';
import { renderAccountAuthCard } from './settings-auth-card.js';
import { renderOverviewHeaderCard, renderModelsManagerCard, renderRuntimeEnvCard } from './settings-config-cards.js';
import { renderDeleteResetModal, renderAddAgentModal } from './settings-modals.js';

function describeRailAgent(agent, t) {
  const acc = agent.account;
  const dotState = !agent.binaryFound ? 'idle' : acc?.authenticated ? 'done' : 'warning';
  const subParts = [];
  if (!agent.binaryFound) subParts.push(t('status.missing'));
  else if (acc?.authenticated) subParts.push(acc.email ? maskEmail(acc.email) : acc.plan || t('status.authenticated'));
  else subParts.push(t('status.unauthenticated'));
  if (agent.version) subParts.push(`v${agent.version}`);
  if (agent.activeSessionCount > 0) subParts.push(t('status.activeSessions', { count: String(agent.activeSessionCount) }));
  return { dotState, subText: subParts.join(' · ') };
}

function handleRailItemKeyDown(e, { idx, agents, railItemRefs, onSelect }) {
  if (e.target !== e.currentTarget) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    onSelect(agents[idx].id);
    return;
  }
  let nextIdx = -1;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextIdx = (idx + 1) % agents.length;
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') nextIdx = (idx - 1 + agents.length) % agents.length;
  else if (e.key === 'Home') nextIdx = 0;
  else if (e.key === 'End') nextIdx = agents.length - 1;
  if (nextIdx >= 0 && agents[nextIdx]) {
    e.preventDefault();
    onSelect(agents[nextIdx].id);
    railItemRefs.current[nextIdx]?.focus();
  }
}

function renderAgentRailItem({ agent, idx, agents, railItemRefs, isSelected, busyAction, onSelect, onToggle, t }) {
  const { dotState, subText } = describeRailAgent(agent, t);
  return h(
    'div',
    {
      ref: (node) => {
        railItemRefs.current[idx] = node;
      },
      key: agent.id,
      role: 'tab',
      tabIndex: isSelected ? 0 : -1,
      'aria-selected': isSelected,
      'data-selected': isSelected ? 'true' : 'false',
      'data-agent-id': agent.id,
      className: 'dsh-acp-rail-item',
      onClick: () => onSelect(agent.id),
      onKeyDown: (e) => handleRailItemKeyDown(e, { idx, agents, railItemRefs, onSelect }),
    },
    h(
      'div',
      { className: 'dsh-acp-rail-item-main' },
      h(
        'div',
        { className: 'dsh-acp-rail-title-row' },
        h(StateDot, { state: dotState, size: 10 }),
        // First text leaf is agent.name for Settings search indexing
        h('span', { className: 'dsh-acp-rail-name' }, agent.name),
      ),
      h('span', { className: 'dsh-acp-rail-sub' }, subText),
    ),
    h(
      'div',
      {
        onClick: (e) => e.stopPropagation(),
        // Keep Enter/Space on the focused switch from bubbling to the rail card.
        onKeyDown: (e) => e.stopPropagation(),
      },
      h(Switch, {
        'aria-label': agent.name,
        checked: agent.enabled === true,
        disabled: busyAction === `toggle:${agent.id}`,
        loading: busyAction === `toggle:${agent.id}`,
        onChange: (val) => void onToggle(agent, val),
      }),
    ),
  );
}

function renderBannerStack({ probeAuthAction, banner, rpc, setProbeAuthAction, setBanner, mountedRef, t }) {
  if (!probeAuthAction && !banner) return null;
  return h(
    'div',
    { className: 'dsh-acp-banner-stack' },
    probeAuthAction
      ? h(
          'div',
          { className: 'dsh-acp-banner', role: 'status' },
          h('span', null, probeAuthAction.message || t('login.waitingBrowser')),
          h(
            Button,
            {
              variant: 'outline',
              size: 'sm',
              onClick: async () => {
                try {
                  await rpc('agent/auth-action/accept', { id: probeAuthAction.agentId, elicitationId: probeAuthAction.elicitationId });
                  if (mountedRef.current) setProbeAuthAction(null);
                } catch (error) {
                  if (mountedRef.current) setBanner({ error: true, text: error?.message || String(error) });
                }
              },
            },
            t('login.openBrowser'),
          ),
        )
      : null,
    banner
      ? h(
          'div',
          {
            className: 'dsh-acp-banner',
            role: banner.error ? 'alert' : 'status',
            'data-error': banner.error ? 'true' : undefined,
          },
          h('span', null, banner.text),
        )
      : null,
  );
}

function deriveFlowMeta(activeFlow) {
  const flowPhase = activeFlow?.phase;
  const flowActive = flowPhase === 'starting' || flowPhase === 'waiting' || flowPhase === 'verifying';
  const flowInteraction = activeFlow?.interaction ?? null;
  const flowUrl =
    flowInteraction?.type === 'browser' || flowInteraction?.type === 'deviceCode'
      ? flowInteraction.url
      : activeFlow?.authorizationUrl ?? null;
  const flowNeedsConsent = flowInteraction?.type === 'browser' && flowInteraction.requiresConsent === true;
  return { flowPhase, flowActive, flowInteraction, flowUrl, flowNeedsConsent };
}

function buildRegistryCards(registryAgents, query) {
  const needle = String(query || '').trim().toLowerCase();
  return (registryAgents || [])
    .filter((a) => a && a.id && !BUILTIN_REGISTRY_IDS.has(a.id))
    .filter((a) => !needle || `${a.id} ${a.name || ''}`.toLowerCase().includes(needle))
    .map((a) => ({ id: `registry:${a.id}`, label: a.name || a.id, icon: safeHttpsIconUrl(a.icon) }));
}

function parseCustomModelEntry(rawInput) {
  const raw = rawInput.trim();
  const pipe = raw.indexOf('|');
  const id = (pipe >= 0 ? raw.slice(0, pipe) : raw).trim();
  const name = (pipe >= 0 ? raw.slice(pipe + 1) : raw).trim() || id;
  return id ? { id, name } : null;
}

function filterAgentModels(allModels, modelQuery) {
  const q = modelQuery.trim().toLowerCase();
  if (!q) return allModels;
  return allModels.filter((m) => String(m.name || '').toLowerCase().includes(q) || String(m.id || '').toLowerCase().includes(q));
}

function buildSettingsPermissions(t) {
  return [
    { id: 'ask', label: t('field.permission.ask') },
    { id: 'auto-allow-read', label: t('field.permission.read') },
    { id: 'auto-allow', label: t('field.permission.all') },
  ];
}

function useSettingsEffects({
  addModal,
  registryAgents,
  setRegistryAgents,
  rpc,
  loadCatalog,
  selectedAgent,
  setActiveAuthMethod,
  setCredDraft,
  envBaselineRef,
  setRuntimeDraft,
  setTerminalDraft,
  setConfirmDelete,
  setModelQuery,
  setNewModelInput,
  setRevealEmail,
  setCopiedUrl,
  setSavedFlash,
  flowActive,
  applyCatalog,
  catalogSeqRef,
  mountedRef,
  banner,
  setBanner,
}) {
  useEffect(() => {
    if (!addModal?.showMore || registryAgents !== null) return undefined;
    let cancelled = false;
    rpc('agent/registry-search', { limit: 100 })
      .then((res) => { if (!cancelled && mountedRef.current) setRegistryAgents(Array.isArray(res?.agents) ? res.agents : []); })
      .catch(() => { if (!cancelled && mountedRef.current) setRegistryAgents([]); });
    return () => { cancelled = true; };
  }, [addModal?.showMore, registryAgents, rpc]);

  useEffect(() => { void loadCatalog(true); }, [loadCatalog]);

  useEffect(() => {
    if (!selectedAgent) return;
    const draft = buildDraftForAgent(selectedAgent);
    setActiveAuthMethod(draft.activeAuthMethod);
    setCredDraft(draft.credDraft);
    envBaselineRef.current = draft.envBaseline;
    setRuntimeDraft(draft.runtimeDraft);
    setTerminalDraft('');
    setConfirmDelete(false);
    setModelQuery('');
    setNewModelInput('');
    setRevealEmail(false);
    setCopiedUrl(false);
    setSavedFlash(null);
  }, [selectedAgent?.id]);

  useEffect(() => {
    if (!flowActive) return undefined;
    let cancelled = false;
    let timerId = null;
    const scheduleNext = () => {
      if (cancelled || !mountedRef.current) return;
      timerId = setTimeout(async () => {
        if (cancelled || !mountedRef.current) return;
        const reqSeq = catalogSeqRef.current;
        try {
          const data = await rpc('catalog', { refreshAccounts: false });
          if (!cancelled && mountedRef.current && data && catalogSeqRef.current === reqSeq) {
            applyCatalog(data, reqSeq);
          }
        } catch (error) {
          console.warn('[dsh-acp-agents] background operation failed', error);
        } finally {
          scheduleNext();
        }
      }, 1500);
    };
    scheduleNext();
    return () => {
      cancelled = true;
      if (timerId !== null) clearTimeout(timerId);
    };
  }, [flowActive, selectedAgent?.id, rpc, applyCatalog]);

  useEffect(() => {
    if (!banner || banner.error) return undefined;
    const timer = setTimeout(() => setBanner(null), 4500);
    return () => clearTimeout(timer);
  }, [banner]);
}

/** ACP Provider & Account Settings Panel (`Settings -> Agent`). */
export function AgentsSettingsSection({ rpc, t }) {
  // Keep indices 0, 1, 2 stable for host compatibility test state injection.
  const [catalog, setCatalog] = useState(null);
  const [selectedId, setSelectedId] = useState('claude-code');
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState('');
  const [banner, setBanner] = useState(null);
  const [probeAuthAction, setProbeAuthAction] = useState(null);
  const [savedFlash, setSavedFlash] = useState(null);
  const [revealEmail, setRevealEmail] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const [activeAuthMethod, setActiveAuthMethod] = useState('');
  const [credDraft, setCredDraft] = useState({});
  const [flowCredState, setFlowCredState] = useState({ key: '', values: {} });
  const [callbackState, setCallbackState] = useState({ key: '', value: '' });
  const [modelQuery, setModelQuery] = useState('');
  const [newModelInput, setNewModelInput] = useState('');
  const [runtimeDraft, setRuntimeDraft] = useState({
    name: '', badge: '', command: undefined, argsText: '', profileDir: '', permissionPolicy: 'ask', envRows: [],
  });
  const envBaselineRef = useRef([]);
  const [terminalDraft, setTerminalDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addModal, setAddModal] = useState(null);
  const [registryAgents, setRegistryAgents] = useState(null);

  const idPrefix = useId();
  const railItemRefs = useRef([]);
  const mountedRef = useRef(true);
  const catalogSeqRef = useRef(0);
  const timersRef = useRef(new Set());
  const cleanupsRef = useRef(new Set());
  const copiedTimerRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const id of timersRef.current) clearTimeout(id);
      timersRef.current.clear();
      if (copiedTimerRef.current !== null) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
      for (const cleanup of cleanupsRef.current) cleanup();
      cleanupsRef.current.clear();
    };
  }, []);

  const scheduleTimeout = useCallback((fn, delayMs) => {
    const id = setTimeout(() => {
      timersRef.current.delete(id);
      if (mountedRef.current) fn();
    }, delayMs);
    timersRef.current.add(id);
    return id;
  }, []);

  const registerCleanup = useCallback((cleanup) => {
    cleanupsRef.current.add(cleanup);
    return () => cleanupsRef.current.delete(cleanup);
  }, []);

  const applyCatalog = useCallback((next, expectedSeq) => {
    if (!mountedRef.current || !next) return catalogSeqRef.current;
    if (expectedSeq !== undefined && catalogSeqRef.current !== expectedSeq) return catalogSeqRef.current;
    catalogSeqRef.current += 1;
    setCatalog(next);
    return catalogSeqRef.current;
  }, []);

  const loadCatalog = useCallback(async (refreshAccounts = false) => {
    const reqSeq = ++catalogSeqRef.current;
    try {
      if (mountedRef.current) setLoading(true);
      const next = await rpc('catalog', { refreshAccounts });
      if (mountedRef.current && reqSeq === catalogSeqRef.current) {
        setCatalog(next);
      }
    } catch (err) {
      if (mountedRef.current && reqSeq === catalogSeqRef.current) {
        setBanner({ error: true, text: t('loadFailed', { message: err?.message || String(err) }) });
      }
    } finally {
      if (mountedRef.current && reqSeq === catalogSeqRef.current) setLoading(false);
    }
  }, [rpc, t]);

  const agents = catalog?.agents || [];
  const selectedAgent = useMemo(() => agents.find((a) => a.id === selectedId) || agents[0] || null, [agents, selectedId]);
  const activeFlow = selectedAgent?.authFlow;
  const flowMeta = deriveFlowMeta(activeFlow);
  const flowDraftKey = `${selectedAgent?.id || ''}:${activeFlow?.flowId || activeFlow?.phase || ''}:${flowMeta.flowInteraction?.id || flowMeta.flowInteraction?.type || ''}`;
  const flowCredDraft = flowCredState.key === flowDraftKey ? flowCredState.values : {};
  const setFlowCredDraft = useCallback(
    (updater) => {
      setFlowCredState((cur) => {
        const prev = cur.key === flowDraftKey ? cur.values : {};
        const next = typeof updater === 'function' ? updater(prev) : updater;
        return { key: flowDraftKey, values: next };
      });
    },
    [flowDraftKey],
  );
  const callbackDraft = callbackState.key === flowDraftKey ? callbackState.value : '';
  const setCallbackDraft = useCallback(
    (val) => setCallbackState({ key: flowDraftKey, value: val }),
    [flowDraftKey],
  );

  useSettingsEffects({
    addModal, registryAgents, setRegistryAgents, rpc, loadCatalog, selectedAgent, setActiveAuthMethod, setCredDraft,
    envBaselineRef, setRuntimeDraft, setTerminalDraft, setConfirmDelete, setModelQuery, setNewModelInput,
    setRevealEmail, setCopiedUrl, setSavedFlash, flowActive: flowMeta.flowActive, applyCatalog, catalogSeqRef,
    mountedRef, banner, setBanner,
  });

  const actionCtx = {
    selectedAgent, activeAuthMethod, credDraft, rpc, setBusyAction, setBanner, applyCatalog,
    catalogSeqRef, scheduleTimeout, registerCleanup, mountedRef, setSavedFlash, t,
  };
  const savePatch = (patch, flashKey) => saveAgentPatch({ ...actionCtx, patch, flashKey });
  const toggleWithRollback = async (key, prevVal, nextVal) => {
    patchCatalogAgent(setCatalog, selectedAgent.id, { [key]: nextVal });
    if (!(await savePatch({ [key]: nextVal })) && mountedRef.current) {
      patchCatalogAgent(setCatalog, selectedAgent.id, { [key]: prevVal });
    }
  };
  const toggleModelFavorite = async (modelId) => {
    if (!selectedAgent) return;
    const prev = selectedAgent.favoriteModels || [];
    const favs = new Set(prev);
    if (favs.has(modelId)) favs.delete(modelId);
    else favs.add(modelId);
    await toggleWithRollback('favoriteModels', prev, Array.from(favs));
  };
  const toggleModelVisible = async (modelId, visible) => {
    if (!selectedAgent) return;
    const prev = selectedAgent.hiddenModels || [];
    const hidden = new Set(prev);
    if (visible) hidden.delete(modelId);
    else hidden.add(modelId);
    await toggleWithRollback('hiddenModels', prev, Array.from(hidden));
  };
  const addCustomModel = async () => {
    const parsed = selectedAgent && newModelInput.trim() ? parseCustomModelEntry(newModelInput) : null;
    if (!parsed) return;
    const baseModels = [...(selectedAgent.configuredModels || selectedAgent.models || [])];
    if (!baseModels.some((m) => m.id === parsed.id)) baseModels.unshift({ ...parsed, defaultEffort: 'medium' });
    setNewModelInput('');
    await savePatch({ models: baseModels, hiddenModels: (selectedAgent.hiddenModels || []).filter((hId) => hId !== parsed.id) });
  };
  const openLoginUrl = async () => {
    if (!flowMeta.flowUrl) return;
    try {
      if (flowMeta.flowNeedsConsent && !(await respondLoginFlow({ ...actionCtx, response: { type: 'browser', action: 'accept' } }))) return;
      await rpc('agent/open-url', { url: flowMeta.flowUrl });
    } catch (err) {
      if (mountedRef.current) setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
    }
  };
  const copyLoginUrl = async () => {
    if (!flowMeta.flowUrl) return;
    try {
      await copyTextToClipboard(flowMeta.flowUrl);
    } catch {
      if (mountedRef.current) setBanner({ error: true, text: t('error.clipboard') });
      return;
    }
    if (!mountedRef.current) return;
    setCopiedUrl(true);
    if (copiedTimerRef.current !== null) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => {
      copiedTimerRef.current = null;
      if (mountedRef.current) setCopiedUrl(false);
    }, 1800);
    if (flowMeta.flowNeedsConsent) await respondLoginFlow({ ...actionCtx, response: { type: 'browser', action: 'accept' } });
  };
  const cancelLoginFlow = async () => {
    if (!selectedAgent || busyAction === 'cancel-flow') return;
    setBusyAction('cancel-flow');
    try {
      const next = await rpc('agent/login/cancel', { id: selectedAgent.id });
      if (mountedRef.current) applyCatalog(next);
    } catch (err) {
      if (mountedRef.current) setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
    } finally {
      if (mountedRef.current) setBusyAction('');
    }
  };
  const completeLoginFlow = async (callbackUrl) => {
    if (!selectedAgent || !callbackUrl || busyAction === 'complete-flow') return;
    setBusyAction('complete-flow');
    try {
      const res = await rpc('agent/login/complete', { id: selectedAgent.id, callbackUrl });
      if (!mountedRef.current) return;
      if (res?.catalog) applyCatalog(res.catalog);
      setCallbackDraft('');
    } catch (err) {
      if (mountedRef.current) setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
    } finally {
      if (mountedRef.current) setBusyAction('');
    }
  };
  const deleteOrResetAgent = async () => {
    if (!selectedAgent) return;
    setBusyAction('delete');
    try {
      const next = await rpc('agent/delete', { id: selectedAgent.id });
      if (!mountedRef.current) return;
      applyCatalog(next);
      if (!selectedAgent.builtin && next?.agents?.[0]) setSelectedId(next.agents[0].id);
    } catch (err) {
      if (mountedRef.current) setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
    } finally {
      if (mountedRef.current) {
        setBusyAction('');
        setConfirmDelete(false);
      }
    }
  };

  const permissionOptions = useMemo(() => buildSettingsPermissions(t), [t]);
  const account = selectedAgent?.account;
  const availableMethods = account?.availableMethods || [];
  const currentMethodDef = availableMethods.find((m) => m.id === activeAuthMethod) || availableMethods[0] || null;
  const allModels = selectedAgent?.allModels || selectedAgent?.models || [];
  const enabledCount = allModels.filter((m) => !m.hidden).length;
  const filteredModels = useMemo(() => filterAgentModels(allModels, modelQuery), [allModels, modelQuery]);
  const registryCards = buildRegistryCards(registryAgents, addModal?.registryQuery);

  return h(
    'div',
    { className: 'dsh-acp-settings' },
    renderBannerStack({ probeAuthAction, banner, rpc, setProbeAuthAction, setBanner, mountedRef, t }),
    h(
      'div',
      { className: 'dsh-acp-header' },
      h('div', { className: 'dsh-acp-header-copy' }, h('h3', { className: 'dsh-acp-title' }, t('page.title')), h('p', { className: 'dsh-acp-subtitle' }, t('page.subtitle'))),
      h(
        'div',
        { className: 'dsh-acp-header-actions' },
        h(Button, { variant: 'outline', size: 'sm', icon: h(IconRefreshOutline16, { size: 14 }), disabled: loading, onClick: () => void loadCatalog(true) }, t('page.refresh')),
        h(Button, { variant: 'primary', size: 'sm', icon: h(IconPlusOutline16, { size: 14 }), onClick: () => setAddModal({ baseAgentId: selectedAgent?.baseAgentId || 'claude-code', name: '', command: '', showMore: false, registryQuery: '', error: null }) }, t('page.addInstance')),
      ),
    ),
    ...(catalog?.storeIssues || []).map((issue) =>
      h('div', { key: `store-issue:${issue.preservedAs}`, className: 'dsh-acp-store-issue', role: 'alert' }, t('storeIssue', { file: issue.file, reason: issue.reason, preservedAs: issue.preservedAs })),
    ),
    h(
      'div',
      { className: 'dsh-acp-workspace' },
      h(
        'div',
        { className: 'dsh-acp-rail', role: 'tablist', 'aria-label': t('menu.agent') },
        agents.map((agent, idx) =>
          renderAgentRailItem({
            agent, idx, agents, railItemRefs, isSelected: agent.id === selectedAgent?.id, busyAction, onSelect: setSelectedId, t,
            onToggle: (target, val) => toggleAgentEnabled({
              agent: target, nextVal: val, rpc, setBusyAction, setBanner, applyCatalog, catalogSeqRef, scheduleTimeout, mountedRef, t,
            }),
          }),
        ),
      ),
      selectedAgent
        ? h(
            'div',
            { className: 'dsh-acp-detail', role: 'tabpanel' },
            renderOverviewHeaderCard({
              selectedAgent, account, busyAction, t,
              onTestAndSync: (agent) => testAndSyncAgent({
                agent, rpc, setBusyAction, setBanner, setProbeAuthAction, applyCatalog, registerCleanup, mountedRef, t,
              }),
              onAddAccount: () => setAddModal({ baseAgentId: selectedAgent.baseAgentId, name: `${selectedAgent.name} #2`, command: selectedAgent.command, showMore: false, registryQuery: '', error: null }),
              onOpenConfirmDelete: () => setConfirmDelete(true),
            }),
            renderAccountAuthCard({
              selectedAgent, account, availableMethods, activeAuthMethod, setActiveAuthMethod, currentMethodDef,
              revealEmail, setRevealEmail, busyAction, activeFlow, ...flowMeta, copiedUrl, terminalDraft, setTerminalDraft,
              flowCredDraft, setFlowCredDraft, callbackDraft, setCallbackDraft, credDraft, setCredDraft, savedFlash, idPrefix, t,
              onStartLogin: (forceNewToken) => startLoginFlow({ ...actionCtx, forceNewToken }),
              onReauth: () => reauthLoginFlow(actionCtx),
              onLogout: () => logoutAgent(actionCtx),
              onCancelFlow: cancelLoginFlow,
              onOpenLoginUrl: openLoginUrl,
              onCopyLoginUrl: copyLoginUrl,
              onRespondFlow: (response) => respondLoginFlow({ ...actionCtx, response }),
              onCompleteFlow: completeLoginFlow,
              onSaveCredentials: () => saveApiKeyCredentials(actionCtx),
            }),
            renderModelsManagerCard({
              selectedAgent, allModels, filteredModels, enabledCount, modelQuery, setModelQuery, newModelInput, setNewModelInput,
              busyAction, onSetAllHidden: (hiddenIds) => toggleWithRollback('hiddenModels', selectedAgent.hiddenModels || [], hiddenIds),
              onTestAndSync: (agent) => testAndSyncAgent({
                agent, rpc, setBusyAction, setBanner, setProbeAuthAction, applyCatalog, registerCleanup, mountedRef, t,
              }),
              onAddCustomModel: addCustomModel, onToggleFavorite: toggleModelFavorite, onToggleVisible: toggleModelVisible, t,
            }),
            renderRuntimeEnvCard({
              selectedAgent, runtimeDraft, setRuntimeDraft, permissionOptions, savedFlash, busyAction, idPrefix, t,
              onSaveRuntimeAndEnv: () => saveRuntimeAndEnv({ ...actionCtx, runtimeDraft, envBaselineRef, setRuntimeDraft }),
            }),
          )
        : null,
    ),
    renderDeleteResetModal({ confirmDelete, selectedAgent, busyAction, onClose: () => setConfirmDelete(false), onConfirm: deleteOrResetAgent, t }),
    renderAddAgentModal({
      addModal, setAddModal, registryAgents, registryCards, busyAction, idPrefix, t,
      onCreate: () => createAccountInstance({
        addModal, agents, registryAgents, rpc, setBusyAction, setBanner, applyCatalog, setSelectedId, setAddModal, mountedRef, t,
      }),
    }),
  );
}
