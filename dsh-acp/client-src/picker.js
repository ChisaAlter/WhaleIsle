import {
  h,
  createPortal,
  useState,
  useEffect,
  useLayoutEffect,
  useId,
  useMemo,
  useCallback,
  useRef,
  useSyncExternalStore,
  Toast,
  rankByName,
  IconWarningOutlineRegular,
  StateDot,
  IconChevronDownOutlineRegular,
  FlipText,
  usePresence,
} from './primitives.js';
import { editableModelOptions } from './utils.js';
import {
  buildPickerCatalog,
  resolveCurrentCategory,
  filterPickerCategories,
  computeMenuPos,
  buildTriggerLabels,
  handlePickerKeyDown,
} from './picker-data.js';
import { renderPickerPopoverMenu } from './picker-aside.js';

function usePickerEffects({
  available,
  open,
  mounted,
  directory,
  sessionId,
  previewCategory,
  previewModel,
  previewKey,
  editableOptionsCount,
  activeModelIndex,
  effectiveActiveTab,
  query,
  rpc,
  loadRef,
  refreshAcpCatalog,
  rootRef,
  menuRef,
  triggerRef,
  groupsRef,
  itemRefs,
  toastSeq,
  setToast,
  setOpen,
  setOptionState,
  setMenuPos,
}) {
  useEffect(() => {
    if (available) {
      loadRef.current();
      refreshAcpCatalog();
    }
  }, [available, directory, refreshAcpCatalog]);

  useEffect(() => {
    let active = true;
    if (open && sessionId && previewCategory?.acpAgentId && editableOptionsCount > 0) {
      rpc('session/options', { sessionId, agentId: previewCategory.acpAgentId, model: previewModel.id })
        .then((result) => {
          if (active) setOptionState({ key: previewKey, selections: result.selections || [] });
        })
        .catch((error) => {
          if (active) {
            toastSeq.current += 1;
            setToast({ seq: toastSeq.current, text: error.message });
          }
        });
    }
    return () => {
      active = false;
    };
  }, [open, sessionId, previewKey, editableOptionsCount, rpc]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => {
      if (event.target instanceof Element && event.target.closest('[data-dsh-toast]') !== null) return;
      if (rootRef.current?.contains(event.target) === true) return;
      if (menuRef.current?.contains(event.target) === true) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', closeOutside);
    return () => document.removeEventListener('mousedown', closeOutside);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || activeModelIndex < 0) return;
    // scrollIntoView also scrolls ancestors outside this fixed portal.
    // Keyboard/highlight movement only owns the model list's scroll.
    const list = groupsRef.current;
    const item = itemRefs.current[activeModelIndex];
    if (!list || !item) return;
    const bounds = list.getBoundingClientRect();
    const row = item.getBoundingClientRect();
    if (row.top < bounds.top) list.scrollTop += row.top - bounds.top;
    else if (row.bottom > bounds.bottom) list.scrollTop += row.bottom - bounds.bottom;
  }, [open, activeModelIndex, effectiveActiveTab, query]);

  useLayoutEffect(() => {
    if (!available || !mounted) {
      setMenuPos(null);
      return undefined;
    }
    if (!open) return undefined;
    const place = () => setMenuPos((current) => computeMenuPos(triggerRef.current, menuRef.current, current));
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    const menu = menuRef.current;
    const observer = typeof ResizeObserver !== 'undefined' && menu ? new ResizeObserver(place) : null;
    if (menu) observer?.observe(menu);
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [available, mounted, open]);
}

function buildLoadToastText(state, t) {
  return [
    ...(state.error === null || state.error === undefined ? [] : [t('error.action', { message: state.error })]),
    ...(state.failures || []).map((failure) =>
      t('warning.groupLoad', {
        name: failure.id === 'deepseek-account' ? t('provider.account') : failure.name,
        message: failure.message,
      }),
    ),
  ].join('\n');
}

function computeEffortChoices(previewReasoning, t) {
  if (previewReasoning === undefined) return [];
  return [
    ...(previewReasoning.defaultEffort === undefined
      ? [{ key: 'provider-default', effort: undefined, label: t('effort.providerDefault') }]
      : []),
    ...previewReasoning.efforts.map((effort) => ({
      key: `effort:${effort.id}`,
      effort: effort.id,
      label: effort.name,
    })),
  ];
}

function resolveEffortLabel(reasoning, effectiveEffort, t) {
  if (reasoning === undefined) return undefined;
  if (effectiveEffort === undefined) return t('effort.providerDefault');
  return reasoning.efforts.find((level) => level.id === effectiveEffort)?.name ?? effectiveEffort;
}

function renderPickerTriggerButton({
  triggerRef,
  id,
  open,
  busy,
  waiting,
  selectionFocus,
  setSelectionFocus,
  locked,
  labels,
  state,
  effortLabel,
  reasoning,
  onToggle,
  t,
}) {
  return h(
    'button',
    {
      ref: triggerRef,
      type: 'button',
      className: 'dsh-acp-ms-trigger',
      'aria-label': labels.triggerAria,
      'aria-haspopup': 'menu',
      'aria-expanded': open,
      'aria-controls': open ? `${id}-menu` : undefined,
      title: labels.triggerTitle,
      'aria-busy': busy || waiting,
      'data-selection-focus': selectionFocus ? '' : undefined,
      onBlur: () => setSelectionFocus(false),
      disabled: locked,
      onClick: onToggle,
    },
    labels.isExternalAgent ? h('span', { className: 'dsh-acp-ms-trigger-agent' }, labels.agentDisplayName) : null,
    !state?.current
      ? h(
          'span',
          { className: 'dsh-acp-ms-trigger-label dsh-acp-ms-initial-label' },
          h('span', { className: 'dsh-acp-ms-initial-reserve', 'aria-hidden': true }, t('trigger.fallback')),
          h('span', { className: 'dsh-acp-ms-initial-reserve', 'aria-hidden': true }, t('trigger.loading')),
          h(FlipText, { className: 'dsh-acp-ms-initial-caption', text: labels.modelLabel }),
        )
      : h(FlipText, { className: 'dsh-acp-ms-trigger-label', text: labels.modelLabel }),
    effortLabel !== undefined
      ? h(
          'span',
          { className: 'dsh-acp-ms-trigger-effort' },
          [t('effort.providerDefault'), ...(reasoning?.efforts || []).map((level) => level.name)].map((label, index) =>
            h('span', { key: index, className: 'dsh-acp-ms-effort-reserve', 'aria-hidden': true }, label),
          ),
          h(FlipText, { className: 'dsh-acp-ms-effort-caption', text: effortLabel }),
        )
      : null,
    h(
      'span',
      { className: 'dsh-acp-ms-trigger-status', 'aria-hidden': true },
      busy || waiting
        ? h(StateDot, { state: 'ongoing', size: 16 })
        : h(IconChevronDownOutlineRegular, { className: `dsh-acp-ms-chevron${open ? ' dsh-acp-ms-chevron-open' : ''}` }),
    ),
  );
}

function buildToastActions(toast, failedAction, reload, retryFailed) {
  if (toast?.catalog === true) return [{ label: toast.reloadLabel, onClick: reload }];
  if (failedAction) return [{ label: toast.retryLabel, onClick: retryFailed }];
  return undefined;
}

function derivePickerPreview({ state, allChoices, filteredCategories, highlightedIndex, sessionId, optionState }) {
  const visibleModels = filteredCategories.flatMap((cat) =>
    (cat.models || []).map((model) => ({
      category: cat,
      provider: cat.id,
      model: model.id,
      reasoningEffort: model.reasoning?.defaultEffort,
    })),
  );
  const currentVisibleIndex = visibleModels.findIndex(
    (m) => m.provider === state?.current?.provider && m.model === state?.current?.model,
  );
  const activeModelIndex = Math.min(
    highlightedIndex ?? Math.max(0, currentVisibleIndex),
    Math.max(0, visibleModels.length - 1),
  );
  const candidate = visibleModels[activeModelIndex];
  const previewChoice =
    candidate && allChoices.find((choice) => choice.category.id === candidate.provider && choice.model.id === candidate.model);
  const previewCategory = previewChoice?.category;
  const previewModel = previewChoice?.model;
  const previewIsCurrent = Boolean(
    previewChoice && previewCategory.id === state?.current?.provider && previewModel.id === state?.current?.model,
  );
  const previewKey = JSON.stringify([sessionId, previewCategory?.id, previewModel?.id]);
  const editableOptions = editableModelOptions(previewModel);
  const optionsReady = optionState?.key === previewKey;
  const optionSelections = optionsReady ? optionState.selections : [];
  return {
    visibleModels,
    activeModelIndex,
    previewChoice,
    previewCategory,
    previewModel,
    previewIsCurrent,
    previewKey,
    editableOptions,
    optionsReady,
    optionSelections,
  };
}

function createPickerActions({
  state,
  busy,
  rpc,
  load,
  select,
  sessionId,
  savingOption,
  previewChoice,
  previewCategory,
  previewModel,
  previewIsCurrent,
  previewEffort,
  previewKey,
  optionsReady,
  currentProviderId,
  filterTabs,
  lastActionRef,
  toastSeq,
  triggerRef,
  searchRef,
  rootRef,
  menuRef,
  setOpen,
  setQuery,
  setHighlightedIndex,
  setSelectionFocus,
  setActiveTab,
  setAcpCatalog,
  setEnablingAgentId,
  setToast,
  setFailedAction,
  setOptionState,
  setSavingOption,
  refreshAcpCatalog,
  t,
}) {
  const reload = () => {
    lastActionRef.current = 'load';
    setToast((current) => (current?.catalog === true ? null : current));
    load();
    refreshAcpCatalog();
  };
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) queueMicrotask(() => triggerRef.current?.focus());
  };
  const closeAfterSelection = () => {
    setSelectionFocus(true);
    close(true);
  };
  const show = () => {
    setSelectionFocus(false);
    triggerRef.current?.focus();
    setQuery('');
    setHighlightedIndex(null);
    setActiveTab(filterTabs.some((tab) => tab.id === currentProviderId) ? currentProviderId : filterTabs[0]?.id ?? 'builtin');
    setOpen(true);
    reload();
    queueMicrotask(() => searchRef.current?.focus());
  };
  const announceFailure = (error) => {
    toastSeq.current += 1;
    const text =
      error?.code === 'session/writer-held'
        ? t('error.sessionInUse')
        : t('error.action', { message: `${error?.code || 'error'}: ${error?.message || String(error)}` });
    setToast({ seq: toastSeq.current, text });
  };
  const enableAcpAgent = async (category) => {
    if (!category?.acpAgentId || typeof rpc !== 'function') return false;
    setEnablingAgentId(category.acpAgentId);
    try {
      const res = await rpc('agent/toggle', { id: category.acpAgentId, enabled: true });
      if (Array.isArray(res?.agents)) setAcpCatalog(res.agents);
      else refreshAcpCatalog();
      await load();
      return true;
    } catch (err) {
      announceFailure(err);
      return false;
    } finally {
      setEnablingAgentId(null);
    }
  };
  const submitSelection = (selection, keepOpen = false, category = null) => {
    if (busy) return;
    lastActionRef.current = 'select';
    setFailedAction(null);
    if (!keepOpen) {
      setSelectionFocus(true);
      triggerRef.current?.focus();
      closeAfterSelection();
    }
    void select(selection).then(
      (result) => {
        if (!result || result.ok) return;
        setFailedAction({ selection, category });
        announceFailure(result.error);
      },
      (err) => {
        setFailedAction({ selection, category });
        announceFailure(err);
      },
    );
  };
  const chooseModel = async (selection, category, keepOpen = true) => {
    const nextSel = category?.isExternal ? { provider: selection.provider, model: selection.model } : selection;
    if (category?.isExternal && !category.enabled && !(await enableAcpAgent(category))) {
      setFailedAction({ selection: nextSel, category });
      return;
    }
    if (state?.current?.provider === nextSel.provider && state?.current?.model === nextSel.model) {
      if (!keepOpen) closeAfterSelection();
      return;
    }
    submitSelection(nextSel, keepOpen, category);
  };
  const chooseEffort = (effort) => {
    if (!previewChoice || (previewIsCurrent && previewEffort === effort)) return;
    submitSelection(
      { provider: previewCategory.id, model: previewModel.id, ...(effort === undefined ? {} : { reasoningEffort: effort }) },
      true,
      previewCategory,
    );
  };
  const chooseOption = async (option, value) => {
    if (busy || !sessionId || savingOption || !previewIsCurrent || !optionsReady) return;
    setSavingOption(option.id);
    try {
      const result = await rpc('session/options', {
        sessionId,
        agentId: previewCategory.acpAgentId,
        model: previewModel.id,
        option: { id: option.id, value },
      });
      setOptionState((current) => (current?.key === previewKey ? { key: previewKey, selections: result.selections || [] } : current));
    } catch (error) {
      announceFailure(error);
    } finally {
      setSavingOption(null);
    }
  };
  const onRootBlur = (event) => {
    if (!event.relatedTarget && menuRef.current?.contains(event.target)) return;
    if (event.relatedTarget instanceof Element && event.relatedTarget.closest('[data-dsh-toast]') !== null) return;
    const inside = rootRef.current?.contains(event.relatedTarget) === true || menuRef.current?.contains(event.relatedTarget) === true;
    if (!event.relatedTarget || !inside) close();
  };
  return { reload, close, show, enableAcpAgent, chooseModel, chooseEffort, chooseOption, onRootBlur };
}

function deriveReasoningState({ state, currentChoice, preview, t }) {
  const reasoning = currentChoice?.model?.reasoning;
  const effectiveEffort = reasoning === undefined ? undefined : state?.current?.reasoningEffort ?? reasoning.defaultEffort;
  const effortLabel = resolveEffortLabel(reasoning, effectiveEffort, t);
  const previewReasoning = preview.previewModel?.reasoning;
  const previewEffort = preview.previewIsCurrent ? effectiveEffort : previewReasoning?.defaultEffort;
  return { reasoning, effortLabel, previewReasoning, previewEffort };
}

function findCurrentChoice(state, allChoices) {
  if (!state?.current) return undefined;
  return allChoices.find((c) => c.selection.provider === state.current?.provider && c.selection.model === state.current?.model);
}

function buildToastElement({ toast, failedAction, setFailedAction, setToast, actions, rootRef, t }) {
  if (!toast) return null;
  const retryFailed = () => {
    const f = failedAction;
    setFailedAction(null);
    setToast(null);
    void actions.chooseModel(f.selection, f.category);
  };
  return h(Toast, {
    key: toast.seq,
    text: toast.text,
    icon: IconWarningOutlineRegular ? h(IconWarningOutlineRegular) : undefined,
    holdMs: toast.catalog === true ? null : undefined,
    dismissLabel: t('modal.close'),
    actions: buildToastActions(
      { ...toast, reloadLabel: t('action.reload'), retryLabel: t('action.retry') },
      failedAction,
      actions.reload,
      retryFailed,
    ),
    anchor: rootRef.current?.closest?.('[data-composer-card]') ?? null,
    onDone: () => setToast(null),
  });
}

/**
 * ACP Composer Agent + Model + Effort Selector (`ProviderModelPicker`).
 * Shadows `conversation.input.model` at priority -10.
 */
export function AgentModelSelect(props) {
  const { locked, available, directory, load, select, rpc, openAgentSettings, t, sessionId, renderHostOptions } = props;
  const state = useSyncExternalStore((fn) => directory.subscribe(fn), () => directory.getSnapshot());
  const [open, setOpen] = useState(false);
  const { mounted, state: motionState } = usePresence(open);
  const [activeTab, setActiveTab] = useState('builtin');
  const [acpCatalog, setAcpCatalog] = useState([]);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(null);
  const [selectionFocus, setSelectionFocus] = useState(false);
  const [enablingAgentId, setEnablingAgentId] = useState(null);
  const lastActionRef = useRef('load');
  const [toast, setToast] = useState(null);
  const toastSeq = useRef(0);
  const [failedAction, setFailedAction] = useState(null);
  const [optionState, setOptionState] = useState(null);
  const [savingOption, setSavingOption] = useState(null);

  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const searchRef = useRef(null);
  const menuRef = useRef(null);
  const groupsRef = useRef(null);
  const itemRefs = useRef([]);
  const [menuPos, setMenuPos] = useState(null);
  const id = useId();
  const loadRef = useRef(load);
  loadRef.current = load;

  const refreshAcpCatalog = useCallback(() => {
    if (typeof rpc !== 'function') return;
    rpc('catalog')
      .then((res) => { if (Array.isArray(res?.agents)) setAcpCatalog(res.agents); })
      .catch((error) => { console.warn('[dsh-acp/client/client.js] background operation failed', error); });
  }, [rpc]);

  useEffect(() => {
    if (!open || lastActionRef.current !== 'load') return;
    const text = buildLoadToastText(state, t);
    if (text !== '') {
      toastSeq.current += 1;
      setToast({ seq: toastSeq.current, text, catalog: true });
    } else {
      setToast((current) => (current?.catalog === true ? null : current));
    }
  }, [open, state.error, state.failures, t]);

  const accountProviderName = t('provider.account');
  const { categories, filterTabs, allChoices } = useMemo(
    () => buildPickerCatalog({ groups: state?.groups, acpCatalog, accountProviderName, t }),
    [state?.groups, acpCatalog, accountProviderName, t],
  );
  const currentProviderId = state?.current?.provider || '';
  const currentCategory = resolveCurrentCategory(categories, currentProviderId, t);
  const currentChoice = useMemo(() => findCurrentChoice(state, allChoices), [allChoices, state?.current]);
  const effectiveActiveTab = filterTabs.some((tab) => tab.id === activeTab) ? activeTab : filterTabs[0]?.id ?? 'builtin';
  const filteredCategories = useMemo(
    () => filterPickerCategories(categories, effectiveActiveTab, query, rankByName),
    [categories, effectiveActiveTab, query],
  );
  const preview = useMemo(
    () => derivePickerPreview({ state, allChoices, filteredCategories, highlightedIndex, sessionId, optionState }),
    [state, allChoices, filteredCategories, highlightedIndex, sessionId, optionState],
  );

  const { reasoning, effortLabel, previewReasoning, previewEffort } = deriveReasoningState({
    state, currentChoice, preview, t,
  });
  const effortChoices = useMemo(() => computeEffortChoices(previewReasoning, t), [previewReasoning, t]);

  usePickerEffects({
    available, open, mounted, directory, sessionId, previewCategory: preview.previewCategory,
    previewModel: preview.previewModel, previewKey: preview.previewKey, editableOptionsCount: preview.editableOptions.length,
    activeModelIndex: preview.activeModelIndex, effectiveActiveTab, query, rpc, loadRef, refreshAcpCatalog,
    rootRef, menuRef, triggerRef, groupsRef, itemRefs, toastSeq, setToast, setOpen, setOptionState, setMenuPos,
  });

  if (!available) return null;

  const busy = Boolean(locked || state?.pending) || enablingAgentId !== null;
  const actions = createPickerActions({
    state, busy, rpc, load, select, sessionId, savingOption, ...preview, previewEffort, currentProviderId, filterTabs,
    lastActionRef, toastSeq, triggerRef, searchRef, rootRef, menuRef, setOpen, setQuery, setHighlightedIndex,
    setSelectionFocus, setActiveTab, setAcpCatalog, setEnablingAgentId, setToast, setFailedAction, setOptionState,
    setSavingOption, refreshAcpCatalog, t,
  });
  const waiting = state?.current === null && state?.status === 'loading';
  const labels = buildTriggerLabels({ state, currentChoice, currentCategory, effortLabel, waiting, t });
  const pushToast = (text) => { setFailedAction(null); toastSeq.current += 1; setToast({ seq: toastSeq.current, text }); };

  return h(
    'div',
    {
      ref: rootRef,
      className: 'dsh-acp-ms-root',
      onBlur: actions.onRootBlur,
      onKeyDown: (event) => handlePickerKeyDown(event, {
        open, close: actions.close, busy, visibleModels: preview.visibleModels, activeModelIndex: preview.activeModelIndex,
        setHighlightedIndex, filterTabs, effectiveActiveTab, setActiveTab, chooseModel: actions.chooseModel,
        searchEl: searchRef.current, menuEl: menuRef.current,
      }),
      onMouseDown: (event) => {
        if (event.target instanceof Element && event.target.closest('button') !== null) event.preventDefault();
      },
    },
    renderPickerTriggerButton({
      triggerRef, id, open, busy, waiting, selectionFocus, setSelectionFocus, locked, labels, state, effortLabel, reasoning,
      onToggle: () => { if (open) actions.close(true); else actions.show(); }, t,
    }),
    mounted
      ? createPortal(
          renderPickerPopoverMenu({
            menuRef, id, menuPos, state, busy, motionState, open, filterTabs, effectiveActiveTab, setActiveTab,
            setHighlightedIndex, searchRef, query, setQuery, groupsRef, filteredCategories, allChoices, enablingAgentId,
            itemRefs, locked, close: actions.close, triggerRef, renderHostOptions, effortChoices, previewEffort,
            ...preview, enableAcpAgent: actions.enableAcpAgent, chooseModel: actions.chooseModel,
            chooseEffort: actions.chooseEffort, chooseOption: actions.chooseOption, savingOption, t,
            reportHostOptionFailure: pushToast,
            onManageAgents: () => { actions.close(false); if (openAgentSettings?.() === false) pushToast(t('error.settingsNav')); },
          }),
          document.body,
        )
      : null,
    buildToastElement({ toast, failedAction, setFailedAction, setToast, actions, rootRef, t }),
  );
}
