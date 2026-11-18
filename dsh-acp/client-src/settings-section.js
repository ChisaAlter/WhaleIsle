import { h, useState, useEffect, useMemo, useCallback, useRef, Button, StateDot, Switch, IconPlusOutline16, IconRefreshOutline16 } from './primitives.js';
import { BUILTIN_REGISTRY_IDS, maskEmail } from './utils.js';
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

function renderAgentRailItem({ agent, isSelected, busyAction, onSelect, onToggle, t }) {
  const { dotState, subText } = describeRailAgent(agent, t);
  return h(
    'div',
    {
      key: agent.id,
      role: 'tab',
      tabIndex: 0,
      'aria-selected': isSelected,
      'data-selected': isSelected ? 'true' : 'false',
      'data-agent-id': agent.id,
      className: 'dsh-acp-rail-item',
      onClick: () => onSelect(agent.id),
      onKeyDown: (e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onSelect(agent.id);
        }
      },
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

function renderProbeAuthBanner({ probeAuthAction, rpc, setProbeAuthAction, setBanner, t }) {
  if (!probeAuthAction) return null;
  return h(
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
            setProbeAuthAction(null);
          } catch (error) {
            setBanner({ error: true, text: error.message });
          }
        },
      },
      t('login.openBrowser'),
    ),
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
    .map((a) => ({ id: `registry:${a.id}`, label: a.name || a.id, icon: a.icon || null }));
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
  flowActive,
  setCatalog,
  banner,
  setBanner,
}) {
  useEffect(() => {
    if (!addModal?.showMore || registryAgents !== null) return undefined;
    let cancelled = false;
    rpc('agent/registry-search', { limit: 100 })
      .then((res) => { if (!cancelled) setRegistryAgents(Array.isArray(res?.agents) ? res.agents : []); })
      .catch(() => { if (!cancelled) setRegistryAgents([]); });
    return () => { cancelled = true; };
  }, [addModal?.showMore, registryAgents]);

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
  }, [selectedAgent?.id]);

  useEffect(() => {
    if (!flowActive) return undefined;
    const timer = setInterval(() => {
      void rpc('catalog', { refreshAccounts: false })
        .then((data) => { if (data) setCatalog(data); })
        .catch((error) => { console.warn('[dsh-acp/client/client.js] background operation failed', error); });
    }, 1500);
    return () => clearInterval(timer);
  }, [flowActive, selectedAgent?.id, rpc]);

  useEffect(() => {
    if (!banner || banner.error) return undefined;
    const timer = setTimeout(() => setBanner(null), 4500);
    return () => clearTimeout(timer);
  }, [banner]);
}

/** ACP Provider & Account Settings Panel (`Settings -> Agent`). */
export function AgentsSettingsSection({ rpc, t }) {
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
  const [flowCredDraft, setFlowCredDraft] = useState({});
  const [callbackDraft, setCallbackDraft] = useState('');
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

  const loadCatalog = useCallback(async (refreshAccounts = false) => {
    try {
      setLoading(true);
      setCatalog(await rpc('catalog', { refreshAccounts }));
    } catch (err) {
      setBanner({ error: true, text: t('loadFailed', { message: err?.message || String(err) }) });
    } finally {
      setLoading(false);
    }
  }, [rpc, t]);

  const agents = catalog?.agents || [];
  const selectedAgent = useMemo(() => agents.find((a) => a.id === selectedId) || agents[0] || null, [agents, selectedId]);
  const activeFlow = selectedAgent?.authFlow;
  const flowMeta = deriveFlowMeta(activeFlow);

  useSettingsEffects({
    addModal, registryAgents, setRegistryAgents, rpc, loadCatalog, selectedAgent, setActiveAuthMethod, setCredDraft,
    envBaselineRef, setRuntimeDraft, setTerminalDraft, setConfirmDelete, setModelQuery, setNewModelInput,
    flowActive: flowMeta.flowActive, setCatalog, banner, setBanner,
  });

  const actionCtx = { selectedAgent, activeAuthMethod, credDraft, rpc, setBusyAction, setBanner, setCatalog, setSavedFlash, t };
  const savePatch = (patch, flashKey) => saveAgentPatch({ ...actionCtx, patch, flashKey });
  const toggleWithRollback = async (key, prevVal, nextVal) => {
    patchCatalogAgent(setCatalog, selectedAgent.id, { [key]: nextVal });
    if (!(await savePatch({ [key]: nextVal }))) patchCatalogAgent(setCatalog, selectedAgent.id, { [key]: prevVal });
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
      setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
    }
  };
  const copyLoginUrl = async () => {
    if (!flowMeta.flowUrl) return;
    try { await navigator.clipboard?.writeText?.(flowMeta.flowUrl); }
    catch (err) { setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) }); return; }
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 1800);
    if (flowMeta.flowNeedsConsent) await respondLoginFlow({ ...actionCtx, response: { type: 'browser', action: 'accept' } });
  };
  const deleteOrResetAgent = async () => {
    if (!selectedAgent) return;
    setBusyAction('delete');
    try {
      const next = await rpc('agent/delete', { id: selectedAgent.id });
      setCatalog(next);
      if (!selectedAgent.builtin && next?.agents?.[0]) setSelectedId(next.agents[0].id);
    } catch (err) {
      setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
    } finally {
      setBusyAction('');
      setConfirmDelete(false);
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
    renderProbeAuthBanner({ probeAuthAction, rpc, setProbeAuthAction, setBanner, t }),
    h(
      'div',
      { className: 'dsh-acp-header' },
      h('div', { className: 'dsh-acp-header-copy' }, h('h3', { className: 'dsh-acp-title' }, t('page.title')), h('p', { className: 'dsh-acp-subtitle' }, t('page.subtitle'))),
      h(
        'div',
        { className: 'dsh-acp-header-actions' },
        h(Button, { variant: 'outline', size: 'sm', icon: h(IconRefreshOutline16, { size: 14 }), disabled: loading, onClick: () => void loadCatalog(true) }, t('page.refresh')),
        h(Button, { variant: 'primary', size: 'sm', icon: h(IconPlusOutline16, { size: 14 }), onClick: () => setAddModal({ baseAgentId: selectedAgent?.baseAgentId || 'claude-code', name: '', command: '', showMore: false, registryQuery: '' }) }, t('page.addInstance')),
      ),
    ),
    banner ? h('div', { className: 'dsh-acp-banner', 'data-error': banner.error ? 'true' : undefined }, banner.text) : null,
    ...(catalog?.storeIssues || []).map((issue) =>
      h('div', { key: `store-issue:${issue.preservedAs}`, className: 'dsh-acp-store-issue', role: 'alert' }, t('storeIssue', { file: issue.file, reason: issue.reason, preservedAs: issue.preservedAs })),
    ),
    h(
      'div',
      { className: 'dsh-acp-workspace' },
      h(
        'div',
        { className: 'dsh-acp-rail', role: 'tablist', 'aria-label': t('menu.agent') },
        agents.map((agent) =>
          renderAgentRailItem({
            agent, isSelected: agent.id === selectedAgent?.id, busyAction, onSelect: setSelectedId, t,
            onToggle: (target, val) => toggleAgentEnabled({ agent: target, nextVal: val, rpc, setBusyAction, setBanner, setCatalog, t }),
          }),
        ),
      ),
      selectedAgent
        ? h(
            'div',
            { className: 'dsh-acp-detail' },
            renderOverviewHeaderCard({
              selectedAgent, account, busyAction, t,
              onTestAndSync: (agent) => testAndSyncAgent({ agent, rpc, setBusyAction, setBanner, setProbeAuthAction, setCatalog, t }),
              onAddAccount: () => setAddModal({ baseAgentId: selectedAgent.baseAgentId, name: `${selectedAgent.name} #2`, command: selectedAgent.command, showMore: false, registryQuery: '' }),
              onOpenConfirmDelete: () => setConfirmDelete(true),
            }),
            renderAccountAuthCard({
              selectedAgent, account, availableMethods, activeAuthMethod, setActiveAuthMethod, currentMethodDef,
              revealEmail, setRevealEmail, busyAction, activeFlow, ...flowMeta, copiedUrl, terminalDraft, setTerminalDraft,
              flowCredDraft, setFlowCredDraft, callbackDraft, setCallbackDraft, credDraft, setCredDraft, savedFlash, t,
              onStartLogin: (forceNewToken) => startLoginFlow({ ...actionCtx, forceNewToken }),
              onReauth: () => reauthLoginFlow(actionCtx),
              onLogout: () => logoutAgent(actionCtx),
              onCancelFlow: () => rpc('agent/login/cancel', { id: selectedAgent.id }).then(setCatalog).catch((err) => setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) })),
              onOpenLoginUrl: openLoginUrl,
              onCopyLoginUrl: copyLoginUrl,
              onRespondFlow: (response) => respondLoginFlow({ ...actionCtx, response }),
              onCompleteFlow: (callbackUrl) => callbackUrl && rpc('agent/login/complete', { id: selectedAgent.id, callbackUrl }).then((res) => res?.catalog && setCatalog(res.catalog)).catch((err) => setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) })),
              onSaveCredentials: () => saveApiKeyCredentials(actionCtx),
            }),
            renderModelsManagerCard({
              selectedAgent, allModels, filteredModels, enabledCount, modelQuery, setModelQuery, newModelInput, setNewModelInput,
              busyAction, onSetAllHidden: (hiddenIds) => toggleWithRollback('hiddenModels', selectedAgent.hiddenModels || [], hiddenIds),
              onTestAndSync: (agent) => testAndSyncAgent({ agent, rpc, setBusyAction, setBanner, setProbeAuthAction, setCatalog, t }),
              onAddCustomModel: addCustomModel, onToggleFavorite: toggleModelFavorite, onToggleVisible: toggleModelVisible, t,
            }),
            renderRuntimeEnvCard({
              selectedAgent, runtimeDraft, setRuntimeDraft, permissionOptions, savedFlash, busyAction, t,
              onSaveRuntimeAndEnv: () => saveRuntimeAndEnv({ ...actionCtx, runtimeDraft, envBaselineRef, setRuntimeDraft }),
            }),
          )
        : null,
    ),
    renderDeleteResetModal({ confirmDelete, selectedAgent, busyAction, onClose: () => setConfirmDelete(false), onConfirm: deleteOrResetAgent, t }),
    renderAddAgentModal({
      addModal, setAddModal, registryAgents, registryCards, busyAction, t,
      onCreate: () => createAccountInstance({ addModal, agents, registryAgents, rpc, setBusyAction, setBanner, setCatalog, setSelectedId, setAddModal, t }),
    }),
  );
}
