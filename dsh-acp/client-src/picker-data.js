import { ACP_PREFIX, acpModelReasoning } from './utils.js';

function mapConfiguredAcpAgent(agent, liveGroup, externalBadge) {
  const providerId = agent.providerId || `${ACP_PREFIX}${agent.id}`;
  // The plugin catalog owns visibility and current discovered models.
  // Host directory entries contribute metadata, never resurrect hidden IDs.
  const hiddenIds = new Set(agent.hiddenModels || []);
  const liveModels = liveGroup?.models || [];
  const rawModels = (agent.models || [])
    .filter((m) => !m.hidden && !hiddenIds.has(m.id))
    .map((m) => ({ ...liveModels.find((entry) => entry.id === m.id), ...m }));
  // liveGroup models come from the host model directory which strips `favorite`
  // — re-derive it from the agent's persisted favoriteModels so star pinning
  // does not depend on server annotation.
  const favoriteIds = new Set(Array.isArray(agent.favoriteModels) ? agent.favoriteModels : []);
  const mappedModels = rawModels.map((m) => ({
    id: m.id,
    name: m.name || m.id,
    favorite: Boolean(m.favorite) || favoriteIds.has(m.id),
    options: m.options || [],
    reasoning: acpModelReasoning(m, agent.models?.find((item) => item.id === m.id)),
  }));
  // ACP runtime pins favorites to the top of the provider list.
  mappedModels.sort((a, b) => (a.favorite === b.favorite ? 0 : a.favorite ? -1 : 1));
  return {
    id: providerId,
    tabId: providerId,
    acpAgentId: agent.id,
    name: agent.name || liveGroup?.name || providerId,
    vendor: agent.badge || externalBadge,
    isExternal: true,
    enabled: true,
    models: mappedModels,
  };
}

export function buildPickerCatalog({ groups, acpCatalog, accountProviderName, t }) {
  const stateGroupMap = new Map();
  const builtinCategories = [];
  const defaultBadge = t('agent.defaultBadge');
  const externalBadge = t('agent.externalBadge');

  for (const group of groups || []) {
    if (typeof group.id === 'string' && group.id.startsWith(ACP_PREFIX)) {
      stateGroupMap.set(group.id, group);
      continue;
    }
    builtinCategories.push({
      id: group.id,
      tabId: 'builtin',
      acpAgentId: null,
      name: group.id === 'deepseek-account' ? accountProviderName : group.name,
      vendor: defaultBadge,
      isExternal: false,
      enabled: true,
      models: (group.models || []).map((m) => ({ ...m, reasoning: m.reasoning })),
    });
  }

  const acpCategories = [];
  const seenProviders = new Set();
  for (const agent of acpCatalog || []) {
    const providerId = agent.providerId || `${ACP_PREFIX}${agent.id}`;
    seenProviders.add(providerId);
    // Configuration owns availability; stale directory models must not
    // bring a disabled agent back into the picker or its search results.
    if (!agent.enabled) continue;
    acpCategories.push(mapConfiguredAcpAgent(agent, stateGroupMap.get(providerId), externalBadge));
  }

  for (const [providerId, liveGroup] of stateGroupMap.entries()) {
    if (seenProviders.has(providerId)) continue;
    acpCategories.push({
      id: providerId,
      tabId: providerId,
      acpAgentId: providerId.slice(ACP_PREFIX.length),
      name: liveGroup.name || providerId,
      vendor: externalBadge,
      isExternal: true,
      enabled: true,
      models: (liveGroup.models || []).map((m) => ({ ...m, reasoning: acpModelReasoning(m) })),
    });
  }

  const categories = [...builtinCategories, ...acpCategories];
  const filterTabs = [
    ...(builtinCategories.length > 0
      ? [{ id: 'builtin', label: t('agent.defaultName'), isExternal: false, enabled: true }]
      : []),
    ...acpCategories.map((cat) => ({
      id: cat.id,
      label: cat.name,
      vendor: cat.vendor,
      isExternal: true,
      enabled: cat.enabled,
    })),
  ];

  const allChoices = categories.flatMap((cat) =>
    (cat.models || []).map((model) => ({
      category: cat,
      model,
      selection: {
        provider: cat.id,
        model: model.id,
        ...(cat.isExternal || model.reasoning?.defaultEffort === undefined
          ? {}
          : { reasoningEffort: model.reasoning.defaultEffort }),
      },
    })),
  );
  return { categories, filterTabs, allChoices };
}

export function resolveCurrentCategory(categories, currentProviderId, t) {
  const found = categories.find((c) => c.id === currentProviderId);
  if (found) return found;
  if (currentProviderId.startsWith(ACP_PREFIX)) {
    return {
      id: currentProviderId,
      name: currentProviderId.slice(ACP_PREFIX.length),
      vendor: 'ACP',
      isExternal: true,
      enabled: true,
    };
  }
  return {
    id: currentProviderId,
    name: t('agent.defaultName'),
    vendor: t('agent.defaultBadge'),
    isExternal: false,
    enabled: true,
  };
}

export function filterPickerCategories(categories, effectiveActiveTab, query, rankByName) {
  const trimmed = query.trim();
  const needle = trimmed.toLowerCase();
  return categories
    .filter((cat) => (effectiveActiveTab === 'builtin' ? !cat.isExternal : cat.id === effectiveActiveTab))
    .map((cat) => {
      if (!trimmed) return cat;
      const catMatch =
        cat.name.toLowerCase().includes(needle)
        || (cat.vendor && cat.vendor.toLowerCase().includes(needle));
      const matchedModels = catMatch ? cat.models || [] : rankByName(cat.models || [], trimmed);
      return { ...cat, models: matchedModels };
    })
    .filter((cat) => (cat.models || []).length > 0);
}

export function computeMenuPos(triggerEl, menuEl, current) {
  const rect = triggerEl?.getBoundingClientRect();
  if (!rect) return current;
  const MARGIN = 12;
  const lw = menuEl?.offsetWidth ?? 0;
  const lh = menuEl?.offsetHeight ?? 0;
  let x = rect.left;
  let y = rect.top - 8 - lh;
  if (lw > 0) x = Math.min(Math.max(x, MARGIN), window.innerWidth - lw - MARGIN);
  if (lh > 0) y = Math.min(Math.max(y, MARGIN), window.innerHeight - lh - MARGIN);
  return current?.left === x && current?.top === y ? current : { left: x, top: y };
}

export function buildTriggerLabels({ state, currentChoice, currentCategory, effortLabel, waiting, t }) {
  const modelLabel = waiting
    ? t('trigger.loading')
    : currentChoice?.model?.name
      ?? (state?.current === null || state?.current === undefined ? t('trigger.fallback') : state.current.model);
  const isExternalAgent = Boolean(currentCategory?.isExternal);
  const agentDisplayName = currentCategory?.name || t('agent.defaultName');
  const effortSuffix = effortLabel ? ` · ${effortLabel}` : '';
  const triggerTitle = isExternalAgent
    ? `${agentDisplayName} · ${modelLabel}${effortSuffix}`
    : `${modelLabel}${effortSuffix}`;

  let triggerAria;
  if (waiting) triggerAria = t('trigger.loading');
  else if (!state?.current) triggerAria = t('trigger.selectAria');
  else if (isExternalAgent) {
    triggerAria =
      effortLabel === undefined
        ? t('trigger.ariaAgent', { agent: agentDisplayName, model: modelLabel })
        : t('trigger.ariaAgentEffort', { agent: agentDisplayName, model: modelLabel, effort: effortLabel });
  } else {
    triggerAria =
      effortLabel === undefined
        ? t('trigger.aria', { model: modelLabel })
        : t('trigger.ariaEffort', { model: modelLabel, effort: effortLabel });
  }
  return { modelLabel, isExternalAgent, agentDisplayName, triggerTitle, triggerAria };
}

function handleRailHorizontalKey(event, railBtn, menuEl, searchEl) {
  if (railBtn && event.key === 'ArrowRight') {
    event.preventDefault();
    searchEl?.focus();
    return;
  }
  if (event.key !== 'ArrowLeft') return;
  const btns = Array.from(menuEl?.querySelectorAll('.dsh-acp-ms-rail-btn') || []);
  if (railBtn) {
    event.preventDefault();
    const idx = btns.indexOf(railBtn);
    btns[(idx - 1 + btns.length) % btns.length]?.focus();
  } else if (btns.length > 0) {
    event.preventDefault();
    const active = menuEl?.querySelector('.dsh-acp-ms-rail-btn[data-active="true"]') || btns[0];
    active?.focus();
  }
}

function handleRailVerticalKey(event, railBtn, menuEl) {
  event.preventDefault();
  const btns = Array.from(menuEl?.querySelectorAll('.dsh-acp-ms-rail-btn') || []);
  const idx = btns.indexOf(railBtn);
  if (idx < 0 || btns.length === 0) return;
  const dir = event.key === 'ArrowDown' ? 1 : -1;
  const next = btns[(idx + dir + btns.length) % btns.length];
  next?.focus();
  next?.click();
}

function cycleProviderTab(event, { filterTabs, effectiveActiveTab, setActiveTab, setHighlightedIndex }) {
  event.preventDefault();
  if (filterTabs.length <= 1) return;
  const idx = Math.max(0, filterTabs.findIndex((tab) => tab.id === effectiveActiveTab));
  const dir = event.key === 'ArrowDown' ? 1 : -1;
  const next = filterTabs[(idx + dir + filterTabs.length) % filterTabs.length];
  if (next) {
    setActiveTab(next.id);
    setHighlightedIndex(0);
  }
}

function selectionPayloadFor(choice) {
  return {
    provider: choice.provider,
    model: choice.model,
    ...(choice.reasoningEffort === undefined ? {} : { reasoningEffort: choice.reasoningEffort }),
  };
}

function routePrintableToSearch(event, searchEl) {
  const isEditable =
    event.target instanceof Element && event.target.closest('input, textarea, [contenteditable="true"]');
  if (
    event.key.length === 1
    && !event.ctrlKey
    && !event.metaKey
    && !event.altKey
    && searchEl
    && event.target !== searchEl
    && !isEditable
  ) {
    searchEl.focus();
  }
}

function handleDigitShortcut(event, { busy, visibleModels, chooseModel }) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return false;
  const digit = Number(event.key);
  if (!(digit >= 1 && digit <= 9)) return false;
  const target = visibleModels[digit - 1];
  if (!busy && target) {
    event.preventDefault();
    void chooseModel(selectionPayloadFor(target), target.category);
  }
  return true;
}

function handleShortcutOrRouteKey(event, deps) {
  const { railBtn, busy, visibleModels, activeModelIndex, chooseModel, searchEl } = deps;
  if (handleDigitShortcut(event, deps)) return;
  if (event.key === 'Enter') {
    if (railBtn) return;
    const highlighted = visibleModels[activeModelIndex];
    if (!busy && highlighted) {
      event.preventDefault();
      void chooseModel(selectionPayloadFor(highlighted), highlighted.category, true);
    }
    return;
  }
  routePrintableToSearch(event, searchEl);
}

function isOptionControlTarget(event, searchEl) {
  return (
    event.target instanceof Element
    && event.target !== searchEl
    && Boolean(event.target.closest('input, select, textarea, .dsh-acp-ms-session-options'))
  );
}

function handleListMoveKey(event, { busy, visibleModels, activeModelIndex, setHighlightedIndex }) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!busy && visibleModels.length > 0) {
      const dir = event.key === 'ArrowDown' ? 1 : -1;
      setHighlightedIndex((activeModelIndex + dir + visibleModels.length) % visibleModels.length);
    }
    return true;
  }
  if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    if (!busy && visibleModels.length > 0) {
      setHighlightedIndex(event.key === 'Home' ? 0 : visibleModels.length - 1);
    }
    return true;
  }
  return false;
}

export function handlePickerKeyDown(event, deps) {
  const { open, close, searchEl, menuEl } = deps;
  if (event.nativeEvent?.isComposing) return;
  if (event.key === 'Escape' && open) {
    event.preventDefault();
    close(true);
    return;
  }
  if (!open || isOptionControlTarget(event, searchEl)) return;
  const railBtn = event.target instanceof Element ? event.target.closest('.dsh-acp-ms-rail-btn') : null;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    handleRailHorizontalKey(event, railBtn, menuEl, searchEl);
    return;
  }
  if (railBtn && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    handleRailVerticalKey(event, railBtn, menuEl);
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey
    && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    cycleProviderTab(event, deps);
    return;
  }
  if (handleListMoveKey(event, deps)) return;
  handleShortcutOrRouteKey(event, { ...deps, railBtn });
}
