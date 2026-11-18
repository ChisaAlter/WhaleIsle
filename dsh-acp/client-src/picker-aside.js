import {
  h,
  Fragment,
  Input,
  MenuSurface,
  StateDot,
  IconCloseFillRegular,
  IconCheckOutlineRegular,
  IconSettingsOutline16,
} from './primitives.js';
import { MEASURE_STYLE, railTabLabel } from './utils.js';

function buildModelSelection(catId, model, selected, current) {
  const defaultEffort = model.reasoning?.defaultEffort;
  if (defaultEffort === undefined) return { provider: catId, model: model.id };
  const reasoningEffort = selected ? current?.reasoningEffort ?? defaultEffort : defaultEffort;
  return { provider: catId, model: model.id, reasoningEffort };
}

function renderPickerModelRow({
  cat,
  model,
  idx,
  id,
  current,
  pending,
  activeModelIndex,
  busy,
  itemRefs,
  setHighlightedIndex,
  chooseModel,
  t,
}) {
  const selected = current?.provider === cat.id && current?.model === model.id;
  const selectingThis = pending?.provider === cat.id && pending?.model === model.id;
  const selection = buildModelSelection(cat.id, model, selected, current);
  let checkNode = null;
  if (selectingThis) checkNode = h(StateDot, { state: 'ongoing', size: 14 });
  else if (selected) checkNode = h(IconCheckOutlineRegular);

  return h(
    'button',
    {
      ref: (node) => {
        itemRefs.current[idx] = node;
      },
      key: `${cat.id}/${model.id}`,
      id: `${id}-model-${idx}`,
      type: 'button',
      role: 'menuitemradio',
      'aria-checked': selected,
      tabIndex: -1,
      'data-active': idx === activeModelIndex ? 'true' : undefined,
      disabled: busy,
      className: 'dsh-acp-ms-option',
      title: cat.enabled ? model.name : `${model.name} (${t('agent.disabledHint')})`,
      onFocus: () => setHighlightedIndex(idx),
      onMouseMove: busy || idx === activeModelIndex ? undefined : () => setHighlightedIndex(idx),
      onClick: () => void chooseModel(selection, cat),
    },
    h(
      'span',
      { className: 'dsh-acp-ms-option-copy' },
      h('span', { className: 'dsh-acp-ms-option-name' }, model.favorite ? `★ ${model.name}` : model.name),
      model.id !== model.name ? h('span', { className: 'dsh-acp-ms-option-sub' }, model.id) : null,
    ),
    h('span', { className: 'dsh-acp-ms-check', 'aria-hidden': true }, checkNode),
    idx < 9 ? h('kbd', { className: 'dsh-acp-ms-kbd', 'aria-hidden': true }, `Ctrl+${idx + 1}`) : null,
  );
}

function renderPickerCategoryGroup({
  cat,
  startIdx,
  id,
  state,
  activeModelIndex,
  busy,
  enablingAgentId,
  enableAcpAgent,
  itemRefs,
  setHighlightedIndex,
  chooseModel,
  t,
}) {
  return h(
    'div',
    {
      key: cat.id,
      className: 'dsh-acp-ms-cat',
      'data-external': cat.isExternal ? 'true' : undefined,
      'data-disabled': !cat.enabled ? 'true' : undefined,
    },
    h(
      'div',
      { className: 'dsh-acp-ms-cat-header' },
      h(
        'div',
        { className: 'dsh-acp-ms-cat-left' },
        h(
          'span',
          { className: 'dsh-acp-ms-cat-kind', 'data-acp': cat.isExternal ? 'true' : undefined },
          cat.isExternal ? 'ACP' : 'API',
        ),
        h('span', { className: 'dsh-acp-ms-cat-title' }, cat.name),
        cat.vendor ? h('span', { className: 'dsh-acp-ms-cat-vendor' }, `· ${cat.vendor}`) : null,
      ),
      h(
        'div',
        { className: 'dsh-acp-ms-cat-right' },
        cat.isExternal
          ? h(
              'span',
              {
                className: 'dsh-acp-ms-cat-enable-slot',
                style: { visibility: cat.enabled ? 'hidden' : 'visible' },
              },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-acp-ms-cat-enable',
                  disabled: busy,
                  title: t('agent.disabledHint'),
                  onClick: (e) => {
                    e.stopPropagation();
                    void enableAcpAgent(cat);
                  },
                },
                enablingAgentId === cat.acpAgentId ? '…' : t('agent.enableBtn'),
              ),
            )
          : null,
        h('span', { className: 'dsh-acp-ms-cat-count' }, String((cat.models || []).length)),
      ),
    ),
    (cat.models || []).map((model, offset) =>
      renderPickerModelRow({
        cat,
        model,
        idx: startIdx + offset,
        id,
        current: state?.current,
        pending: state?.pending,
        activeModelIndex,
        busy,
        itemRefs,
        setHighlightedIndex,
        chooseModel,
        t,
      }),
    ),
  );
}

function renderPickerEffortSection({ effortChoices, previewEffort, busy, chooseEffort, t }) {
  if (effortChoices.length === 0) return null;
  return h(
    Fragment,
    null,
    h('div', { className: 'dsh-acp-ms-aside-divider' }),
    h('div', { className: 'dsh-acp-ms-aside-title' }, t('menu.effort')),
    h(
      'div',
      { className: 'dsh-acp-ms-aside-list', role: 'group', 'aria-label': t('menu.effort') },
      effortChoices.map((choice) => {
        const active = previewEffort === choice.effort;
        return h(
          'button',
          {
            key: choice.key,
            type: 'button',
            disabled: busy,
            'data-active': active ? 'true' : undefined,
            className: 'dsh-acp-ms-aside-option',
            onClick: () => chooseEffort(choice.effort),
          },
          h('span', null, choice.label),
          h(
            'span',
            { className: 'dsh-acp-ms-aside-option-check', 'aria-hidden': true },
            active ? h(IconCheckOutlineRegular) : null,
          ),
        );
      }),
    ),
  );
}

function renderPickerEditableOptions({
  editableOptions,
  optionSelections,
  optionsReady,
  previewIsCurrent,
  sessionId,
  busy,
  savingOption,
  chooseOption,
  t,
}) {
  if (editableOptions.length === 0) return null;
  const controlDisabled = !sessionId || busy || savingOption !== null || !previewIsCurrent || !optionsReady;
  return h(
    Fragment,
    null,
    !sessionId ? h('div', { className: 'dsh-acp-ms-aside-meta' }, t('options.needsSession')) : null,
    sessionId && !previewIsCurrent
      ? h('div', { className: 'dsh-acp-ms-aside-meta' }, t('options.selectModelFirst'))
      : null,
    editableOptions.map((option) => {
      const value = optionSelections.find((entry) => entry.id === option.id)?.value ?? option.currentValue;
      const cls = `dsh-acp-ms-aside-list${option.type === 'boolean' ? ' dsh-acp-ms-boolean-option' : ''}`;
      return h(
        'label',
        { key: option.id, className: cls, title: option.description || '' },
        h('span', { className: 'dsh-acp-ms-aside-title' }, option.name || option.label || option.id),
        option.type === 'boolean'
          ? h('input', {
              type: 'checkbox',
              checked: value === true,
              disabled: controlDisabled,
              onChange: (event) => void chooseOption(option, event.target.checked),
            })
          : h(
              'select',
              {
                className: 'dsh-acp-settings-select',
                value: value ?? '',
                disabled: controlDisabled,
                onChange: (event) => void chooseOption(option, event.target.value),
              },
              value === undefined ? h('option', { value: '', disabled: true }, t('effort.providerDefault')) : null,
              (option.options || []).map((choice) =>
                h('option', { key: choice.id, value: choice.id }, choice.name || choice.label || choice.id),
              ),
            ),
      );
    }),
  );
}

function renderPickerAside(props) {
  const {
    previewIsCurrent,
    previewModel,
    previewCategory,
    locked,
    busy,
    close,
    triggerRef,
    renderHostOptions,
    onManageAgents,
    reportHostOptionFailure,
    t,
  } = props;
  return h(
    'div',
    { className: 'dsh-acp-ms-aside' },
    h('div', { className: 'dsh-acp-ms-aside-title' }, t(previewIsCurrent ? 'aside.current' : 'aside.preview')),
    h(
      'div',
      { className: 'dsh-acp-ms-aside-model', title: previewModel?.name },
      previewModel?.name || t('aside.noSelection'),
    ),
    h(
      'div',
      { className: 'dsh-acp-ms-aside-meta' },
      previewCategory ? h('span', null, `${previewCategory.isExternal ? 'ACP' : 'API'} · ${previewCategory.name}`) : null,
      previewCategory?.vendor ? h('span', null, previewCategory.vendor) : null,
      previewCategory?.isExternal
        ? h('span', null, previewCategory.enabled ? t('agent.enabledBadge') : t('agent.disabledBadge'))
        : null,
    ),
    h(
      'div',
      { className: 'dsh-acp-ms-session-options' },
      renderHostOptions({
        locked: locked || busy,
        dismiss: () => {
          close();
          triggerRef.current?.focus();
        },
        reportFailure: reportHostOptionFailure,
      }),
    ),
    renderPickerEffortSection(props),
    renderPickerEditableOptions(props),
    h(
      'div',
      { className: 'dsh-acp-ms-aside-foot' },
      h(
        'button',
        { type: 'button', className: 'dsh-acp-ms-manage-btn', disabled: locked, onClick: onManageAgents },
        h(IconSettingsOutline16, { size: 13 }),
        h('span', null, t('menu.manageAgents')),
      ),
    ),
  );
}

export function renderPickerPopoverMenu(props) {
  const {
    menuRef,
    id,
    menuPos,
    state,
    busy,
    motionState,
    open,
    filterTabs,
    effectiveActiveTab,
    setActiveTab,
    setHighlightedIndex,
    searchRef,
    query,
    setQuery,
    activeModelIndex,
    groupsRef,
    filteredCategories,
    allChoices,
    t,
  } = props;

  let nextIdx = 0;
  const groupsWithOffsets = filteredCategories.map((cat) => {
    const startIdx = nextIdx;
    nextIdx += (cat.models || []).length;
    return { cat, startIdx };
  });

  return h(
    MenuSurface,
    {
      ref: menuRef,
      id: `${id}-menu`,
      className: 'dsh-acp-ms-menu',
      style: menuPos ?? MEASURE_STYLE,
      role: 'dialog',
      'aria-label': t('menu.aria'),
      'aria-busy': state?.status === 'loading' || busy,
      'data-dsh-motion': 'popover',
      'data-state': motionState,
      'aria-hidden': open ? undefined : true,
      ...(open ? {} : { inert: '' }),
    },
    h(
      'div',
      { className: 'dsh-acp-ms-rail', role: 'tablist', 'aria-label': t('menu.agent') },
      filterTabs.map((tab) =>
        h(
          'button',
          {
            key: tab.id,
            type: 'button',
            role: 'tab',
            'aria-selected': effectiveActiveTab === tab.id,
            'aria-label': tab.label,
            title: tab.label,
            'data-active': effectiveActiveTab === tab.id ? 'true' : undefined,
            'data-enabled': tab.enabled === false ? 'false' : undefined,
            className: 'dsh-acp-ms-rail-btn',
            onClick: () => {
              setActiveTab(tab.id);
              setHighlightedIndex(0);
            },
          },
          tab.isExternal
            ? h('span', { className: 'dsh-acp-ms-rail-dot', 'data-enabled': tab.enabled ? 'true' : undefined })
            : null,
          h('span', { className: 'dsh-acp-ms-rail-label' }, railTabLabel(tab)),
        ),
      ),
    ),
    h(
      'div',
      { className: 'dsh-acp-ms-main' },
      h(
        'div',
        { className: 'dsh-acp-ms-search-row' },
        h(Input, {
          ref: searchRef,
          className: `dsh-acp-ms-search${query !== '' ? ' dsh-acp-ms-search-with-query' : ''}`,
          type: 'text',
          role: 'searchbox',
          'aria-label': t('search.placeholder'),
          'aria-controls': `${id}-models`,
          'aria-activedescendant': activeModelIndex < 0 ? undefined : `${id}-model-${activeModelIndex}`,
          placeholder: t('search.placeholder'),
          value: query,
          readOnly: busy,
          onChange: (e) => {
            setQuery(e.target.value);
            setHighlightedIndex(0);
          },
        }),
        query !== ''
          ? h(
              'button',
              {
                type: 'button',
                className: 'dsh-acp-ms-search-clear',
                'aria-label': t('search.clear'),
                disabled: busy,
                onClick: () => {
                  setQuery('');
                  setHighlightedIndex(0);
                  searchRef.current?.focus();
                },
              },
              h(IconCloseFillRegular),
            )
          : null,
      ),
      h(
        'div',
        {
          ref: groupsRef,
          id: `${id}-models`,
          className: 'dsh-acp-ms-groups scrollable',
          role: 'menu',
          'aria-label': t('menu.model'),
          hidden: filteredCategories.length === 0,
        },
        groupsWithOffsets.map(({ cat, startIdx }) =>
          renderPickerCategoryGroup({ ...props, cat, startIdx }),
        ),
      ),
      filteredCategories.length === 0
        ? h(
            'div',
            { className: 'dsh-acp-ms-empty', role: 'status' },
            t(allChoices.length === 0 ? 'empty.models' : 'search.empty'),
          )
        : null,
    ),
    renderPickerAside(props),
  );
}
