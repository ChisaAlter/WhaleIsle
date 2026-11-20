'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createInitialState,
  resolveLocalizedText,
  selectBadgeCount,
  selectPopupVisible,
  reduceApprovalState,
  projectPopupView,
} = require('./state');

function makeItem(overrides = {}) {
  const eventId = overrides.eventId || 'evt-1';
  return {
    eventId,
    kind: 'tool-approval',
    sessionId: 'sess-1',
    sessionTitle: null,
    title: { fallback: 'bash' },
    description: { fallback: 'Run command', byLocale: { zh: '运行命令', en: 'Run command' } },
    toolName: 'bash',
    callId: 'call-1',
    commandPreview: null,
    planSummary: null,
    subject: null,
    requester: null,
    approveLabel: null,
    capabilities: { allowOnce: true, allowAlways: false, reject: true, requestChanges: false },
    receivedAt: 1000,
    connectionEpoch: 1,
    ...overrides,
  };
}

test('visibility requires harness active, popup enabled, main hidden, and an unsnoozed item', () => {
  let state = createInitialState({ harnessActive: false, mainVisible: false, popupEnabled: true });
  state = reduceApprovalState(state, { type: 'UPSERT', item: makeItem() });
  assert.equal(selectBadgeCount(state), 0, 'badge stays zero while harness is inactive');
  assert.equal(selectPopupVisible(state), false, 'popup stays hidden while harness is inactive');

  state = reduceApprovalState(state, { type: 'SET_HARNESS_ACTIVE', active: true });
  assert.equal(selectBadgeCount(state), 1);
  assert.equal(selectPopupVisible(state), true);

  state = reduceApprovalState(state, { type: 'SET_POPUP_ENABLED', enabled: false });
  assert.equal(selectBadgeCount(state), 1, 'disabling popup keeps icon badge count accurate');
  assert.equal(selectPopupVisible(state), false);

  state = reduceApprovalState(state, { type: 'SET_POPUP_ENABLED', enabled: true });
  state = reduceApprovalState(state, { type: 'SET_MAIN_VISIBLE', visible: true });
  assert.equal(selectPopupVisible(state), false, 'visible main window hides popup');
  assert.equal(selectBadgeCount(state), 0, 'visible main window clears badge count');

  state = reduceApprovalState(state, { type: 'SET_MAIN_VISIBLE', visible: false });
  assert.equal(selectBadgeCount(state), 1, 'minimizing again restores badge count');
});

test('dismiss snoozes current items without rejecting, wakes on new item, and clears snooze when main becomes visible', () => {
  let state = createInitialState({ harnessActive: true, mainVisible: false, popupEnabled: true });
  state = reduceApprovalState(state, { type: 'UPSERT', item: makeItem({ eventId: 'evt-1' }) });
  assert.equal(selectPopupVisible(state), true);

  state = reduceApprovalState(state, { type: 'DISMISS_POPUP' });
  assert.equal(selectPopupVisible(state), false, 'dismiss hides popup');
  assert.equal(selectBadgeCount(state), 1, 'dismiss preserves pending item and badge count');

  state = reduceApprovalState(state, { type: 'UPSERT', item: makeItem({ eventId: 'evt-2', title: { fallback: 'write' } }) });
  assert.equal(selectPopupVisible(state), true, 'new unsnoozed event re-opens popup');
  assert.equal(state.selectedEventId, 'evt-2', 'waking from snooze focuses the newly arrived item');

  state = reduceApprovalState(state, { type: 'UPSERT', item: makeItem({ eventId: 'evt-3' }) });
  assert.equal(state.selectedEventId, 'evt-2', 'background arrival does not yank focus while popup is already visible');

  state = reduceApprovalState(state, { type: 'DISMISS_POPUP' });
  assert.equal(selectPopupVisible(state), false);
  state = reduceApprovalState(state, { type: 'SET_MAIN_VISIBLE', visible: true });
  assert.equal(state.snoozedEventIds.size, 0, 'restoring main window clears snoozed ids');
  state = reduceApprovalState(state, { type: 'SET_MAIN_VISIBLE', visible: false });
  assert.equal(selectPopupVisible(state), true, 're-minimizing with unresolved approvals shows popup again');
});

test('local settlement removal clears item immediately even without a gateway cancel frame', () => {
  let state = createInitialState({ harnessActive: true, mainVisible: false, popupEnabled: true });
  state = reduceApprovalState(state, { type: 'UPSERT', item: makeItem({ eventId: 'evt-1' }) });
  state = reduceApprovalState(state, { type: 'UPSERT', item: makeItem({ eventId: 'evt-2' }) });
  state = reduceApprovalState(state, { type: 'SETTLE_START', eventId: 'evt-1', action: 'allow-once' });
  assert.equal(state.inflight.get('evt-1'), 'allow-once');

  state = reduceApprovalState(state, { type: 'REMOVE', eventId: 'evt-1' });
  assert.equal(selectBadgeCount(state), 1);
  assert.equal(state.selectedEventId, 'evt-2', 'selection moves to next pending item');
  assert.equal(state.inflight.has('evt-1'), false);

  state = reduceApprovalState(state, { type: 'REMOVE', eventId: 'evt-1' });
  assert.equal(selectBadgeCount(state), 1, 'duplicate remove is an idempotent no-op');
});

test('settlement failure unlocks buttons and exposes scoped error without resizing queue', () => {
  let state = createInitialState({ harnessActive: true, mainVisible: false, popupEnabled: true });
  state = reduceApprovalState(state, { type: 'UPSERT', item: makeItem({ eventId: 'evt-1' }) });
  state = reduceApprovalState(state, { type: 'SETTLE_START', eventId: 'evt-1', action: 'reject' });
  state = reduceApprovalState(state, { type: 'SETTLE_FAILED', eventId: 'evt-1', message: 'network timeout', at: 5000 });

  assert.equal(state.inflight.has('evt-1'), false);
  const view = projectPopupView(state, { locale: 'en', theme: { scheme: 'dark', minimalMode: true } });
  assert.equal(view.activeItem?.busyAction, null);
  assert.deepEqual(view.error, { eventId: 'evt-1', message: 'network timeout', at: 5000 });
  assert.deepEqual(view.theme, { scheme: 'dark', minimalMode: true });
});

test('reconnect epoch reconciliation keeps replayed items with preserved preview and prunes ghosts', () => {
  let state = createInitialState({ harnessActive: true, mainVisible: false, popupEnabled: true });
  state = reduceApprovalState(state, { type: 'UPSERT', item: makeItem({ eventId: 'evt-keep', connectionEpoch: 1 }) });
  state = reduceApprovalState(state, { type: 'UPSERT', item: makeItem({ eventId: 'evt-ghost', connectionEpoch: 1 }) });
  state = reduceApprovalState(state, { type: 'SET_COMMAND_PREVIEW', eventId: 'evt-keep', commandPreview: 'rm -rf dist' });
  state = reduceApprovalState(state, { type: 'DISMISS_POPUP' });

  state = reduceApprovalState(state, { type: 'ADVANCE_EPOCH' });
  assert.equal(state.connectionEpoch, 1);
  state = reduceApprovalState(state, {
    type: 'UPSERT',
    item: makeItem({ eventId: 'evt-keep', connectionEpoch: 2, commandPreview: null }),
  });
  state = reduceApprovalState(state, { type: 'RECONCILE_EPOCH', activeEpoch: 2 });

  assert.deepEqual(state.items.map((item) => item.eventId), ['evt-keep']);
  assert.equal(state.items[0].commandPreview, 'rm -rf dist', 'replayed item preserves enriched command preview');
  assert.equal(state.snoozedEventIds.has('evt-keep'), true, 'replayed item preserves snooze state');
  assert.equal(state.snoozedEventIds.has('evt-ghost'), false, 'ghost item snooze is pruned');
});

test('runtime locale projection resolves LocalizedText dynamically and updates session titles', () => {
  let state = createInitialState({ harnessActive: true, mainVisible: false, popupEnabled: true });
  state = reduceApprovalState(state, {
    type: 'SET_SESSION_TITLES',
    titles: { 'sess-1': '修复构建脚本' },
  });
  state = reduceApprovalState(state, { type: 'UPSERT', item: makeItem({ eventId: 'evt-1', sessionId: 'sess-1' }) });

  const zhView = projectPopupView(state, { locale: 'zh', theme: { scheme: 'light', minimalMode: false } });
  const enView = projectPopupView(state, { locale: 'en', theme: { scheme: 'light', minimalMode: false } });
  assert.equal(zhView.activeItem?.sessionTitle, '修复构建脚本');
  assert.equal(zhView.activeItem?.description, '运行命令');
  assert.equal(enView.activeItem?.description, 'Run command');
  assert.equal(resolveLocalizedText({ fallback: 'fb', byLocale: { zh: '中文' } }, 'zh-CN'), '中文');
});

test('disabling harness clears pending items and badges immediately', () => {
  let state = createInitialState({ harnessActive: true, mainVisible: false, popupEnabled: true });
  state = reduceApprovalState(state, { type: 'UPSERT', item: makeItem() });
  state = reduceApprovalState(state, { type: 'SET_HARNESS_ACTIVE', active: false });
  assert.equal(state.items.length, 0);
  assert.equal(selectBadgeCount(state), 0);
  assert.equal(selectPopupVisible(state), false);
});
