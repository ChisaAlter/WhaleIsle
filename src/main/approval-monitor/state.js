'use strict';

/**
 * @typedef {'tool-approval' | 'permission-approval' | 'plan-review'} ApprovalKind
 * @typedef {'allow-once' | 'allow-always' | 'reject' | 'request-changes'} ApprovalAction
 * @typedef {'zh' | 'en'} ApprovalLocale
 * @typedef {'light' | 'dark'} ApprovalScheme
 *
 * @typedef {object} LocalizedText
 * @property {string} fallback
 * @property {Readonly<Record<string, string>>} [byLocale]
 *
 * @typedef {object} ApprovalCapabilities
 * @property {boolean} allowOnce
 * @property {boolean} allowAlways
 * @property {boolean} reject
 * @property {boolean} requestChanges
 *
 * @typedef {object} ApprovalSubject
 * @property {string} name
 * @property {string} [icon]
 *
 * @typedef {object} ApprovalRequester
 * @property {string} sessionId
 * @property {string} label
 *
 * @typedef {object} PendingApprovalItem
 * @property {string} eventId
 * @property {ApprovalKind} kind
 * @property {string} sessionId
 * @property {string | null} sessionTitle
 * @property {LocalizedText} title
 * @property {LocalizedText | null} description
 * @property {string | null} [toolName]
 * @property {string | null} [callId]
 * @property {string | null} [commandPreview]
 * @property {string | null} [planSummary]
 * @property {ApprovalSubject | null} [subject]
 * @property {ApprovalRequester | null} [requester]
 * @property {LocalizedText | null} [approveLabel]
 * @property {ApprovalCapabilities} capabilities
 * @property {number} receivedAt
 * @property {number} connectionEpoch
 *
 * @typedef {object} ApprovalErrorNotice
 * @property {string} eventId
 * @property {string} message
 * @property {number} at
 *
 * @typedef {object} ApprovalState
 * @property {readonly PendingApprovalItem[]} items
 * @property {string | null} selectedEventId
 * @property {ReadonlySet<string>} snoozedEventIds
 * @property {ReadonlyMap<string, ApprovalAction>} inflight
 * @property {ApprovalErrorNotice | null} lastError
 * @property {ReadonlyMap<string, string>} sessionTitles
 * @property {boolean} harnessActive
 * @property {boolean} mainVisible
 * @property {boolean} popupEnabled
 * @property {number} connectionEpoch
 *
 * @typedef {object} PopupThemeView
 * @property {ApprovalScheme} scheme
 * @property {boolean} minimalMode
 *
 * @typedef {object} ProjectedApprovalItem
 * @property {string} eventId
 * @property {ApprovalKind} kind
 * @property {string} sessionId
 * @property {string | null} sessionTitle
 * @property {string} title
 * @property {string | null} description
 * @property {string | null} toolName
 * @property {string | null} commandPreview
 * @property {string | null} planSummary
 * @property {ApprovalSubject | null} subject
 * @property {ApprovalRequester | null} requester
 * @property {string | null} approveLabel
 * @property {ApprovalCapabilities} capabilities
 * @property {ApprovalAction | null} busyAction
 *
 * @typedef {object} PopupView
 * @property {boolean} visible
 * @property {ApprovalLocale} locale
 * @property {PopupThemeView} theme
 * @property {number} total
 * @property {number} selectedIndex
 * @property {ProjectedApprovalItem | null} activeItem
 * @property {readonly { eventId: string, kind: ApprovalKind }[]} items
 * @property {ApprovalErrorNotice | null} error
 *
 * @typedef {
 *   | { type: 'UPSERT', item: PendingApprovalItem }
 *   | { type: 'REMOVE', eventId: string }
 *   | { type: 'SET_COMMAND_PREVIEW', eventId: string, commandPreview: string }
 *   | { type: 'SET_SESSION_TITLES', titles: Readonly<Record<string, string>> | ReadonlyMap<string, string>, replace?: boolean }
 *   | { type: 'SELECT', eventId: string }
 *   | { type: 'SETTLE_START', eventId: string, action: ApprovalAction }
 *   | { type: 'SETTLE_FAILED', eventId: string, message: string, at?: number }
 *   | { type: 'DISMISS_POPUP' }
 *   | { type: 'SET_MAIN_VISIBLE', visible: boolean }
 *   | { type: 'SET_HARNESS_ACTIVE', active: boolean }
 *   | { type: 'SET_POPUP_ENABLED', enabled: boolean }
 *   | { type: 'ADVANCE_EPOCH' }
 *   | { type: 'RECONCILE_EPOCH', activeEpoch: number }
 *   | { type: 'RESET_ALL' }
 * } ApprovalStateAction
 */

/**
 * @param {Partial<Pick<ApprovalState, 'harnessActive' | 'mainVisible' | 'popupEnabled'>>} [initial]
 * @returns {ApprovalState}
 */
function createInitialState(initial = {}) {
  return {
    items: [],
    selectedEventId: null,
    snoozedEventIds: new Set(),
    inflight: new Map(),
    lastError: null,
    sessionTitles: new Map(),
    harnessActive: initial.harnessActive === true,
    mainVisible: initial.mainVisible !== false,
    popupEnabled: initial.popupEnabled !== false,
    connectionEpoch: 0,
  };
}

/**
 * @param {LocalizedText | null | undefined} text
 * @param {string} locale
 * @returns {string}
 */
function resolveLocalizedText(text, locale) {
  if (!text) return '';
  const map = text.byLocale;
  if (map) {
    const exact = map[locale];
    if (typeof exact === 'string' && exact.trim() !== '') return exact;
    const prefix = locale.split(/[-_]/)[0];
    if (prefix && typeof map[prefix] === 'string' && map[prefix].trim() !== '') {
      return map[prefix];
    }
    if (typeof map.en === 'string' && map.en.trim() !== '') return map.en;
  }
  return text.fallback || '';
}

/**
 * @param {ApprovalState} state
 * @returns {boolean}
 */
function hasUnsnoozedItem(state) {
  return state.items.some((item) => !state.snoozedEventIds.has(item.eventId));
}

/**
 * @param {ApprovalState} state
 * @returns {number}
 */
function selectBadgeCount(state) {
  return state.harnessActive ? state.items.length : 0;
}

/**
 * @param {ApprovalState} state
 * @returns {boolean}
 */
function selectPopupVisible(state) {
  return state.harnessActive
    && state.popupEnabled
    && !state.mainVisible
    && state.items.length > 0
    && hasUnsnoozedItem(state);
}

/**
 * @param {readonly PendingApprovalItem[]} items
 * @param {string | null} currentSelected
 * @param {number} removedIndex
 * @returns {string | null}
 */
function pickSelectedAfterRemoval(items, currentSelected, removedIndex) {
  if (items.length === 0) return null;
  if (currentSelected && items.some((item) => item.eventId === currentSelected)) {
    return currentSelected;
  }
  const nextIndex = Math.min(Math.max(0, removedIndex), items.length - 1);
  return items[nextIndex].eventId;
}

/**
 * @param {ApprovalState} state
 * @param {PendingApprovalItem} incoming
 * @returns {ApprovalState}
 */
function reduceUpsert(state, incoming) {
  const cachedTitle = state.sessionTitles.get(incoming.sessionId) ?? null;
  const existingIndex = state.items.findIndex((item) => item.eventId === incoming.eventId);
  if (existingIndex >= 0) {
    const existing = state.items[existingIndex];
    /** @type {PendingApprovalItem} */
    const merged = {
      ...existing,
      ...incoming,
      sessionTitle: incoming.sessionTitle ?? existing.sessionTitle ?? cachedTitle,
      commandPreview: incoming.commandPreview ?? existing.commandPreview ?? null,
      receivedAt: existing.receivedAt,
    };
    const nextItems = state.items.slice();
    nextItems[existingIndex] = merged;
    return { ...state, items: nextItems };
  }

  const wasShowing = selectPopupVisible(state);
  /** @type {PendingApprovalItem} */
  const normalized = {
    ...incoming,
    sessionTitle: incoming.sessionTitle ?? cachedTitle,
  };
  const nextItems = [...state.items, normalized];
  const keepCurrent = wasShowing
    && state.selectedEventId !== null
    && state.items.some((item) => item.eventId === state.selectedEventId);
  const selectedEventId = keepCurrent ? state.selectedEventId : normalized.eventId;
  return {
    ...state,
    items: nextItems,
    selectedEventId,
  };
}

/**
 * @param {ApprovalState} state
 * @param {string} eventId
 * @returns {ApprovalState}
 */
function reduceRemove(state, eventId) {
  const index = state.items.findIndex((item) => item.eventId === eventId);
  if (index < 0 && !state.snoozedEventIds.has(eventId) && !state.inflight.has(eventId)) {
    return state;
  }
  const nextItems = index >= 0
    ? [...state.items.slice(0, index), ...state.items.slice(index + 1)]
    : state.items;
  const nextSnoozed = new Set(state.snoozedEventIds);
  nextSnoozed.delete(eventId);
  const nextInflight = new Map(state.inflight);
  nextInflight.delete(eventId);
  const nextError = state.lastError && state.lastError.eventId === eventId ? null : state.lastError;
  const selectedEventId = pickSelectedAfterRemoval(
    nextItems,
    state.selectedEventId === eventId ? null : state.selectedEventId,
    index < 0 ? 0 : index,
  );
  return {
    ...state,
    items: nextItems,
    selectedEventId,
    snoozedEventIds: nextSnoozed,
    inflight: nextInflight,
    lastError: nextError,
  };
}

/**
 * @param {ApprovalState} state
 * @param {Readonly<Record<string, string>> | ReadonlyMap<string, string>} titles
 * @param {boolean} replace
 * @returns {ApprovalState}
 */
function reduceSessionTitles(state, titles, replace) {
  const nextTitles = replace ? new Map() : new Map(state.sessionTitles);
  const entries = titles instanceof Map ? titles.entries() : Object.entries(titles);
  for (const [sessionId, title] of entries) {
    if (typeof sessionId === 'string' && typeof title === 'string' && title.trim() !== '') {
      nextTitles.set(sessionId, title.trim());
    }
  }
  let changed = false;
  const nextItems = state.items.map((item) => {
    const resolved = nextTitles.get(item.sessionId) ?? null;
    if (resolved && resolved !== item.sessionTitle) {
      changed = true;
      return { ...item, sessionTitle: resolved };
    }
    return item;
  });
  return {
    ...state,
    sessionTitles: nextTitles,
    items: changed ? nextItems : state.items,
  };
}

/**
 * @param {ApprovalState} state
 * @param {number} activeEpoch
 * @returns {ApprovalState}
 */
function reduceReconcileEpoch(state, activeEpoch) {
  const nextItems = state.items.filter((item) => item.connectionEpoch >= activeEpoch);
  if (nextItems.length === state.items.length) return state;
  const liveIds = new Set(nextItems.map((item) => item.eventId));
  const nextSnoozed = new Set([...state.snoozedEventIds].filter((id) => liveIds.has(id)));
  const nextInflight = new Map([...state.inflight.entries()].filter(([id]) => liveIds.has(id)));
  const nextError = state.lastError && liveIds.has(state.lastError.eventId) ? state.lastError : null;
  const selectedEventId = pickSelectedAfterRemoval(nextItems, state.selectedEventId, 0);
  return {
    ...state,
    items: nextItems,
    selectedEventId,
    snoozedEventIds: nextSnoozed,
    inflight: nextInflight,
    lastError: nextError,
  };
}

/**
 * @param {ApprovalState} state
 * @returns {ApprovalState}
 */
function clearQueue(state) {
  return {
    ...state,
    items: [],
    selectedEventId: null,
    snoozedEventIds: new Set(),
    inflight: new Map(),
    lastError: null,
    sessionTitles: new Map(),
  };
}

/**
 * @param {ApprovalState} state
 * @param {string} eventId
 * @param {string} commandPreview
 * @returns {ApprovalState}
 */
function reduceSetCommandPreview(state, eventId, commandPreview) {
  const index = state.items.findIndex((item) => item.eventId === eventId);
  if (index < 0 || !commandPreview) return state;
  const nextItems = state.items.slice();
  nextItems[index] = { ...nextItems[index], commandPreview };
  return { ...state, items: nextItems };
}

/**
 * @param {ApprovalState} state
 * @param {string} eventId
 * @returns {ApprovalState}
 */
function reduceSelect(state, eventId) {
  if (!state.items.some((item) => item.eventId === eventId)) return state;
  const nextError = state.lastError && state.lastError.eventId !== eventId ? null : state.lastError;
  return { ...state, selectedEventId: eventId, lastError: nextError };
}

/**
 * @param {ApprovalState} state
 * @param {string} eventId
 * @param {ApprovalAction} action
 * @returns {ApprovalState}
 */
function reduceSettleStart(state, eventId, action) {
  if (!state.items.some((item) => item.eventId === eventId) || state.inflight.has(eventId)) {
    return state;
  }
  const nextInflight = new Map(state.inflight);
  nextInflight.set(eventId, action);
  const nextError = state.lastError && state.lastError.eventId === eventId ? null : state.lastError;
  return { ...state, inflight: nextInflight, lastError: nextError };
}

/**
 * @param {ApprovalState} state
 * @param {string} eventId
 * @param {string} message
 * @param {number | undefined} at
 * @returns {ApprovalState}
 */
function reduceSettleFailed(state, eventId, message, at) {
  const nextInflight = new Map(state.inflight);
  nextInflight.delete(eventId);
  const stillPresent = state.items.some((item) => item.eventId === eventId);
  return {
    ...state,
    inflight: nextInflight,
    lastError: stillPresent ? { eventId, message, at: at ?? Date.now() } : state.lastError,
  };
}

/**
 * @param {ApprovalState} state
 * @param {boolean} visible
 * @returns {ApprovalState}
 */
function reduceMainVisible(state, visible) {
  if (visible === state.mainVisible && (!visible || state.snoozedEventIds.size === 0)) {
    return state;
  }
  return {
    ...state,
    mainVisible: visible,
    snoozedEventIds: visible ? new Set() : state.snoozedEventIds,
  };
}

/**
 * @param {ApprovalState} state
 * @returns {ApprovalState}
 */
function reduceDismissPopup(state) {
  const nextSnoozed = new Set(state.snoozedEventIds);
  for (const item of state.items) nextSnoozed.add(item.eventId);
  return { ...state, snoozedEventIds: nextSnoozed };
}

/**
 * @param {ApprovalState} state
 * @param {ApprovalStateAction} action
 * @returns {ApprovalState}
 */
function reduceApprovalState(state, action) {
  switch (action.type) {
    case 'UPSERT': return reduceUpsert(state, action.item);
    case 'REMOVE': return reduceRemove(state, action.eventId);
    case 'SET_COMMAND_PREVIEW': return reduceSetCommandPreview(state, action.eventId, action.commandPreview);
    case 'SET_SESSION_TITLES': return reduceSessionTitles(state, action.titles, action.replace === true);
    case 'SELECT': return reduceSelect(state, action.eventId);
    case 'SETTLE_START': return reduceSettleStart(state, action.eventId, action.action);
    case 'SETTLE_FAILED': return reduceSettleFailed(state, action.eventId, action.message, action.at);
    case 'DISMISS_POPUP': return reduceDismissPopup(state);
    case 'SET_MAIN_VISIBLE': return reduceMainVisible(state, Boolean(action.visible));
    case 'SET_HARNESS_ACTIVE':
      return action.active ? (state.harnessActive ? state : { ...state, harnessActive: true }) : { ...clearQueue(state), harnessActive: false };
    case 'SET_POPUP_ENABLED':
      return Boolean(action.enabled) === state.popupEnabled ? state : { ...state, popupEnabled: Boolean(action.enabled) };
    case 'ADVANCE_EPOCH': return { ...state, connectionEpoch: state.connectionEpoch + 1 };
    case 'RECONCILE_EPOCH': return reduceReconcileEpoch(state, action.activeEpoch);
    case 'RESET_ALL': return clearQueue(state);
    default: return state;
  }
}

/**
 * @param {PendingApprovalItem} item
 * @param {ApprovalLocale} locale
 * @param {ApprovalAction | null} busyAction
 * @returns {ProjectedApprovalItem}
 */
function projectApprovalItem(item, locale, busyAction) {
  const subject = item.subject
    ? { name: item.subject.name, ...(item.subject.icon ? { icon: item.subject.icon } : {}) }
    : null;
  const requester = item.requester
    ? { sessionId: item.requester.sessionId, label: item.requester.label }
    : null;
  return {
    eventId: item.eventId,
    kind: item.kind,
    sessionId: item.sessionId,
    sessionTitle: item.sessionTitle,
    title: resolveLocalizedText(item.title, locale),
    description: item.description ? resolveLocalizedText(item.description, locale) : null,
    toolName: item.toolName ?? null,
    commandPreview: item.commandPreview ?? null,
    planSummary: item.planSummary ?? null,
    subject,
    requester,
    approveLabel: item.approveLabel ? resolveLocalizedText(item.approveLabel, locale) : null,
    capabilities: { ...item.capabilities },
    busyAction,
  };
}

/**
 * @param {ApprovalState} state
 * @param {{ locale?: ApprovalLocale, theme?: Partial<PopupThemeView> }} [options]
 * @returns {PopupView}
 */
function projectPopupView(state, options = {}) {
  const locale = options.locale === 'en' ? 'en' : 'zh';
  /** @type {PopupThemeView} */
  const theme = {
    scheme: options.theme?.scheme === 'dark' ? 'dark' : 'light',
    minimalMode: options.theme?.minimalMode === true,
  };
  const total = state.items.length;
  let selectedIndex = state.selectedEventId
    ? state.items.findIndex((item) => item.eventId === state.selectedEventId)
    : -1;
  if (selectedIndex < 0 && total > 0) selectedIndex = 0;

  const current = selectedIndex >= 0 ? state.items[selectedIndex] : null;
  const activeItem = current
    ? projectApprovalItem(current, locale, state.inflight.get(current.eventId) ?? null)
    : null;
  const error = state.lastError && current && state.lastError.eventId === current.eventId
    ? { ...state.lastError }
    : null;

  return {
    visible: selectPopupVisible(state),
    locale,
    theme,
    total,
    selectedIndex,
    activeItem,
    items: state.items.map((item) => ({ eventId: item.eventId, kind: item.kind })),
    error,
  };
}

module.exports = {
  createInitialState,
  resolveLocalizedText,
  hasUnsnoozedItem,
  selectBadgeCount,
  selectPopupVisible,
  reduceApprovalState,
  projectPopupView,
};
