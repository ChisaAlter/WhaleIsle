// app/session.js — split from app.js (#442).
import { callUnary } from '../host/rpc.js';
import { hostCall } from '../host/backend.js';
import { heldSessionRow, archivedSessionRows, withHeldLiveRow, liveSessionRows } from '../host/catalog.js';
import { hostHistoryPage, mergeLatestHistory, runningFromHistoryEvents, mergeApprovalPending, pendingFromHistoryEvents, POLL_PAGE_MESSAGES } from '../host/history.js?v=20261028-mobile';
import { applyPermissionSnapshot, applyPermissionProjectionFrame } from '../host/permission.js';
import { settleOutbox } from '../conversation/outbox.js?v=20261028-mobile';
import { foldEvents } from '../conversation/fold.js?v=20261028-mobile';
import { queuedMessages } from '../host/projections.js?v=20261028-mobile';
import { sessionOwner } from '../ui/session-owner.js?v=20260906-interaction';
import { createCatalogRefreshScheduler, catalogRefreshReason } from '../host/catalog-refresh.js';
import { sessionTitle } from '../conversation/title.js';
import { approvalFromMux, approvalResolvedId, muxPayload, muxEventShouldApply, runningFromMux } from '../host/mux.js';
import { hostFrameNeedsCatalogRefresh, applyHostFrame } from '../host/frames.js';
import { titleFromProjection } from '../conversation/live.js';
import { blankGreeting } from '../ui/greeting.js';
import { flattenModels } from '../host/models.js';
import { composerOffline, showBanner } from './chrome.js?v=20261117-app-split';
import { renderComposer } from './composer.js?v=20261117-app-split';
import { HISTORY_POLL_MS, blankEl, blankGreetingEl, blankWorkspaceChip, blankWorkspaceChipLabel, composer, logEl, origin, sendBtn, sheetRoot, state, stopBtn } from './context.js?v=20261117-app-split';
import { renderSessions } from './drawer.js?v=20261117-app-split';
import { currentReadOnlyReason, currentRow, promoteHeldLive, renderHeader } from './header.js?v=20261117-app-split';
import { renderApproval, renderLog } from './log.js?v=20261117-app-split';
import { clearExclusiveDialogs, historyRequest } from './new-session.js?v=20261117-app-split';
import { renderSheet } from './pickers.js?v=20261117-app-split';
import { renderSettings, renderSettingsForSession } from './settings.js?v=20261117-app-split';

let historyPollTimer = 0;

let muxUnsub = null;

// —— 主机 RPC / shell —— //

const LEGACY_HOST_RPC_MSG = '当前为 dshd 配对会话，旧 Host RPC 已退役';

export function assertNotLegacyHostRpc() {
  if (state.transport === 'chisacode') {
    throw new Error(LEGACY_HOST_RPC_MSG);
  }
}

export async function call(method, payload = {}) {
  if (state.transport === 'chisacode' && state.chisacode?.client) {
    const value = await hostCall(state.chisacode.client, method, payload);
    return { ok: true, value };
  }
  assertNotLegacyHostRpc();
  const result = await callUnary({ origin, method, payload });
  if (!result.ok) {
    throw new Error(result.error?.message || method);
  }
  return result;
}

export function stopHistoryPoll() {
  if (historyPollTimer) {
    clearInterval(historyPollTimer);
    historyPollTimer = 0;
  }
}

export function stopMux() {
  try { muxUnsub?.(); } catch { /* ignore */ }
  muxUnsub = null;
}

export function applyHostCatalog({ sessions, workspaces }) {
  state.catalogSessions = sessions;
  state.workspaces = workspaces && typeof workspaces === 'object'
    ? workspaces
    : { items: [], archivedSessionIds: [] };
  state.heldSession = heldSessionRow({
    sessions,
    workspaces: state.workspaces,
    sessionId: state.sessionId,
  });
  state.archivedRows = archivedSessionRows({ sessions, workspaces: state.workspaces });
  state.sessions = withHeldLiveRow(
    liveSessionRows({ sessions, workspaces: state.workspaces }),
    state.heldSession,
  );
  state.sessionsError = '';
}

export async function refreshHostCatalog() {
  const paired = state.chisacode;
  const client = paired?.client;
  if (!client) throw new Error('桌面端未启动');
  const [sessions, workspaces] = await Promise.all([
    hostCall(client, 'session.list', {}),
    hostCall(client, 'workspace.list', {}),
  ]);
  if (state.chisacode === paired) applyHostCatalog({ sessions, workspaces });
}

/**
 * Apply one `session.history` page. `merge` keeps the older pages the user
 * already loaded (a live refresh must not drop them); a page that does not
 * connect to the loaded log replaces it.
 */
export function applyHistoryPayload(payload, { merge = false } = {}) {
  const page = hostHistoryPage(payload);
  let merged = merge ? mergeLatestHistory(state.events, page) : null;
  if (!merged?.contiguous) merged = { events: page.events, keptOlder: false, contiguous: true };
  state.events = merged.events;
  if (!merged.keptOlder) state.timelinePage = { hasOlder: page.hasOlder, beforeSeq: page.beforeSeq };
  const row = currentRow();
  if (row && page.projections) {
    row.projections = page.projections;
    if (page.projections.values?.title) {
      row.blank = false;
      if (state.heldSession?.sessionId === row.sessionId) state.heldSession = { ...row };
      promoteHeldLive();
    }
  }
  const running = runningFromHistoryEvents(page.events);
  if (row && running !== null) {
    row.running = running;
  }
  state.permission = applyPermissionSnapshot({
    projections: page.projections,
    events: state.events,
    previous: state.permission,
  });
  state.pendingApprovals = mergeApprovalPending(
    state.pendingApprovals,
    pendingFromHistoryEvents(state.events, state.sessionId),
  );
  syncModelSelection();
  if (state.outbox.length) {
    const now = Date.now();
    state.outbox = settleOutbox(state.outbox, foldEvents(state.events), queuedMessages(state.sessionValues))
      // An idle session that never echoed a confirmed send keeps no ghost bubble.
      .filter((entry) => entry.status === 'sending' || row?.running === true || now - entry.sentAt < 120_000);
  }
  return merged;
}

/**
 * Model, permission, plan, queue and usage live in `session.projections`
 * (history pages do not carry them on current hosts). Older hosts without
 * the method keep the history/mux derived state.
 */
let projectionsInflight = null;

export function refreshProjections() {
  const owner = sessionOwner(state);
  if (!owner.sessionId || !owner.client || composerOffline()) return Promise.resolve();
  if (projectionsInflight?.sessionId === owner.sessionId) return projectionsInflight.promise;
  const promise = hostCall(owner.client, 'session.projections', { sessionId: owner.sessionId })
    .then((projections) => {
      if (!owner.owns()) return;
      const values = projections?.values && typeof projections.values === 'object' ? projections.values : null;
      if (!values) return;
      applySessionValues(values);
    })
    .catch(() => { /* optional on older hosts; history and mux frames still apply */ })
    .finally(() => { if (projectionsInflight?.promise === promise) projectionsInflight = null; });
  projectionsInflight = { sessionId: owner.sessionId, promise };
  return promise;
}

function applySessionValues(values) {
  state.sessionValues = { ...state.sessionValues, ...values };
  const row = currentRow();
  if (row) {
    row.projections = row.projections || { values: {} };
    row.projections.values = { ...row.projections.values, ...values };
    if (state.heldSession?.sessionId === row.sessionId) state.heldSession = { ...row };
  }
  state.permission = applyPermissionSnapshot({
    projections: { values: state.sessionValues },
    events: state.events,
    previous: state.permission,
  });
  syncModelSelection();
  state.outbox = settleOutbox(state.outbox, foldEvents(state.events), queuedMessages(state.sessionValues));
  renderLog();
  renderComposer();
  renderSettingsForSession();
}

const scheduleCatalogRefresh = createCatalogRefreshScheduler(async () => {
  if (!state.chisacode?.client) return;
  await refreshHostCatalog();
  renderSessions();
  renderHeader();
  if (state.history) {
    state.history.rows = state.archivedRows.slice();
    renderSheet();
  }
});

// Diagnostic ring buffer (opt-in via localStorage 'dshd-debug-mux' = '1').
const muxDebug = (() => {
  try { return localStorage.getItem('dshd-debug-mux') === '1'; } catch { return false; }
})();

if (muxDebug) {
  window.__dshdMux = [];
  // Read-only diagnostics for QA drivers (same opt-in flag): raw host RPC and state snapshot.
  window.__dshdDebug = {
    hostCall: (method, payload) => hostCall(state.chisacode?.client, method, payload),
    workspaces: () => JSON.parse(JSON.stringify(state.workspaces || null)),
    sessions: () => state.sessions.map((row) => ({ sessionId: row.sessionId, workspaceId: row.workspaceId, title: sessionTitle(row) })),
    // Timeline preview for layout QA: paint an event log without a host.
    previewTimeline: (events, { running = false } = {}) => {
      state.events = Array.isArray(events) ? events : [];
      state.timelineError = '';
      state.timelineLoading = false;
      state.running = running;
      composer.classList.toggle('is-running', running);
      stopBtn.classList.toggle('hidden', !running);
      sendBtn.classList.toggle('hidden', running);
      renderLog({ anchor: 'bottom' });
      return logEl.children.length;
    },
    // Sheet preview: seed the picker/git state without a host and open one sheet.
    previewSheet: (kind, seed = {}) => {
      if (seed.sessionId) state.sessionId = seed.sessionId;
      if (seed.permission) state.permission = { ...state.permission, ...seed.permission };
      if (seed.modelCatalog) {
        state.modelCatalog = seed.modelCatalog;
        state.modelPane = { loading: false, error: '', rows: seed.modelCatalog.rows };
      }
      if (seed.gitStatus) state.gitStatus = { ...state.gitStatus, ...seed.gitStatus };
      if (seed.cwd) state.cwd = seed.cwd;
      clearExclusiveDialogs();
      state.pickerSheet = kind === 'mode' || kind === 'model' ? kind : '';
      state.gitDialog = kind === 'git' ? 'menu' : '';
      renderSheet();
      return sheetRoot.children.length;
    },
  };
}

function handleMuxFrame(frame) {
  if (muxDebug) {
    const { payload: dbg } = muxPayload(frame);
    window.__dshdMux.push({ at: Date.now(), type: dbg?.type || '', event: dbg?.event?.type || '', sessionId: dbg?.sessionId || '', key: dbg?.key || '' });
    if (window.__dshdMux.length > 400) window.__dshdMux.shift();
  }
  const pending = approvalFromMux(frame);
  if (pending && pending.sessionId === state.sessionId) {
    if (!state.pendingApprovals.some((item) => item.rpcId === pending.rpcId)) {
      state.pendingApprovals = [...state.pendingApprovals, pending];
      renderApproval();
    }
  }
  const resolved = approvalResolvedId(frame);
  if (resolved) {
    state.pendingApprovals = state.pendingApprovals.filter((item) => item.approvalId !== resolved);
    renderApproval();
  }
  const { payload } = muxPayload(frame);
  // Desktop-side title / first-turn frames for *other* sessions promote the
  // blank rows announced by host/session-added (DEF-SYNC-REVERSE).
  if (
    (payload?.type === 'session/projection' && (payload.key === 'title' || payload.key === 'sessionListMetadata'))
    || (payload?.type === 'session/event' && payload.event?.type === 'turn/start')
  ) {
    if (hostFrameNeedsCatalogRefresh(state.sessions, payload)) {
      scheduleCatalogRefresh('projection');
    } else {
      state.sessions = applyHostFrame(state.sessions, payload);
      renderSessions();
    }
  }
  const refreshReason = catalogRefreshReason(payload);
  if (refreshReason) scheduleCatalogRefresh(refreshReason);
  if (
    payload?.type === 'host/session-status'
    || payload?.type === 'host/session-added'
    || payload?.type === 'host/session-removed'
  ) {
    state.sessions = applyHostFrame(state.sessions, payload);
    if (state.heldSession?.sessionId === payload.sessionId && typeof payload.running === 'boolean') {
      state.heldSession = { ...state.heldSession, running: payload.running };
      state.sessions = withHeldLiveRow(state.sessions, state.heldSession);
    }
    renderHeader();
    renderSessions();
    renderComposer();
  } else {
    const running = runningFromMux(frame);
    const sid = payload?.sessionId || state.sessionId;
    if (running !== null && sid) {
      if (state.heldSession?.sessionId === sid) {
        state.heldSession = { ...state.heldSession, running };
      }
      state.sessions = withHeldLiveRow(
        state.sessions.map((row) => (
          row.sessionId === sid ? { ...row, running } : row
        )),
        state.heldSession,
      );
      renderHeader();
      renderSessions();
      renderComposer();
    }
  }
  // The running→idle status frame can beat the last history tick (and a
  // catalog refresh may have already overwritten row.running), so on any
  // idle frame for the open session fetch the closing assistant turn.
  {
    const idleFor = runningFromMux(frame) === false ? (payload?.sessionId || state.sessionId) : '';
    if (idleFor && idleFor === state.sessionId) {
      void pullCurrentHistory();
      void refreshProjections();
      // The closing assistant message can commit just after the idle status.
      setTimeout(() => { if (state.sessionId === idleFor) void pullCurrentHistory(); }, 1500);
    }
  }
  if (payload?.type === 'session/projection' && payload.sessionId === state.sessionId) {
    if (typeof payload.key === 'string' && payload.key) {
      state.sessionValues = { ...state.sessionValues, [payload.key]: payload.value };
      if (payload.key === 'inbox') {
        state.outbox = settleOutbox(state.outbox, foldEvents(state.events), queuedMessages(state.sessionValues));
        renderLog();
      }
    }
    state.permission = applyPermissionProjectionFrame(state.permission, payload);
    if (payload.key === 'modelSelection') {
      const target = currentRow();
      if (target) {
        target.projections = target.projections || { values: {} };
        target.projections.values = { ...target.projections.values, modelSelection: payload.value };
        syncModelSelection();
      }
    }
    const title = payload.key === 'title' ? titleFromProjection(payload.value) : '';
    const row = currentRow();
    if (row && title) {
      row.projections = row.projections || { values: {} };
      row.projections.values = { ...row.projections.values, title };
      row.blank = false;
      if (state.heldSession?.sessionId === row.sessionId) state.heldSession = { ...row };
      promoteHeldLive();
      renderHeader();
      renderSessions();
    }
    renderComposer();
    renderSettingsForSession();
  }
  if (muxEventShouldApply(payload) && payload.sessionId === state.sessionId && payload.event) {
    const seq = payload.event.seq;
    const duplicate = Number.isInteger(seq)
      && state.events.some((entry) => (entry?.event?.seq ?? entry?.seq) === seq);
    if (!duplicate) {
      state.events = [...state.events, { event: payload.event }];
      const running = runningFromHistoryEvents(state.events);
      const row = currentRow();
      if (row && running !== null) row.running = running;
      renderLog();
      renderHeader();
      renderSessions();
      renderComposer();
    }
  }
}

export function startLiveFollow() {
  stopHistoryPoll();
  stopMux();
  const client = state.chisacode?.client;
  if (!client) return;
  if (typeof client.subscribeHostMux === 'function') {
    muxUnsub = client.subscribeHostMux((frame) => handleMuxFrame(frame));
  }
  historyPollTimer = setInterval(() => {
    if (!state.sessionId || !state.chisacode?.client) return;
    // A hidden tab does not need streaming ticks; visibility resumes them.
    if (document.visibilityState === 'hidden') return;
    const row = currentRow();
    if (row?.running !== true && !state.pendingApprovals.length && !state.outbox.length) return;
    void pullCurrentHistory();
  }, HISTORY_POLL_MS);
}

/**
 * One `session.history` refresh of the open session (poll tick or final
 * catch-up). Live ticks fetch only the newest messages and merge them into
 * the loaded log; a window that does not reach the loaded log falls back to
 * a full page so nothing in between is skipped.
 */
let historyPullInflight = null;

export function pullCurrentHistory() {
  const sessionId = state.sessionId;
  const client = state.chisacode?.client;
  if (!sessionId || !client) return Promise.resolve();
  if (historyPullInflight) return historyPullInflight;
  const fetchPage = (extra) => hostCall(client, 'session.history', historyRequest(sessionId, extra));
  historyPullInflight = fetchPage(state.events.length ? { maxMessages: POLL_PAGE_MESSAGES } : {})
    .then(async (payload) => {
      if (state.sessionId !== sessionId) return;
      if (!mergeLatestHistory(state.events, hostHistoryPage(payload)).contiguous) {
        payload = await fetchPage({});
        if (state.sessionId !== sessionId) return;
      }
      applyHistoryPayload(payload, { merge: true });
      renderLog();
      renderHeader();
      renderSessions();
      renderComposer();
      renderApproval();
    })
    .catch(() => {})
    .finally(() => { historyPullInflight = null; });
  return historyPullInflight;
}

export function renderBlankHero() {
  const empty = foldEvents(state.events).length === 0 && !state.timelineError && !state.timelineLoading;
  const row = currentRow();
  const canChange = empty && row && !row.archived && !currentReadOnlyReason();
  // Keep the greeting fresh whenever the hero is (re)painted — including the
  // initial no-session blank, where renderLog may not have run yet.
  if (blankGreetingEl) blankGreetingEl.textContent = blankGreeting();
  // While the hero is shown the (empty) log must not claim its flex:1 share,
  // or the hero centers in only the lower half of the screen. Un-hiding the
  // log stays renderLog's job, driven by real timeline rows.
  if (!blankEl.classList.contains('hidden')) logEl.classList.add('hidden');
  if (!blankWorkspaceChip) return;
  blankWorkspaceChip.classList.toggle('hidden', !canChange);
  if (canChange) {
    // A no-directory task never shows the scratch directory path (desktop parity).
    const scratch = state.workspaces?.scratchCwd;
    const noDirectory = !row.workspaceTitle && (!row.cwd || (scratch && row.cwd === scratch));
    (blankWorkspaceChipLabel || blankWorkspaceChip).textContent = noDirectory ? '无工作区文件夹' : (row.workspaceTitle || row.cwd);
  }
}

export async function loadSessionModels() {
  if (!state.sessionId || !state.chisacode?.client) return;
  const owner = sessionOwner(state);
  try {
    const catalog = await hostCall(state.chisacode.client, 'session.models', {
      sessionId: state.sessionId,
    });
    if (!owner.owns()) return;
    state.modelCatalogRaw = catalog;
    state.modelCatalog = flattenModels(catalog, currentModelSelectionProjection());
    renderComposer();
    if (state.settingsOpen && state.settingsPane === '模型') renderSettings();
    if (state.pickerSheet === 'model') renderSheet();
  } catch (error) {
    if (!owner.owns()) return;
    showBanner(`读取模型失败：${error?.message || '电脑没有响应'}`);
  }
}

/** The open session's `modelSelection` projection value (from history / mux). */
export function currentModelSelectionProjection() {
  const values = currentRow()?.projections?.values;
  return values && typeof values === 'object' ? values.modelSelection : undefined;
}

/** Re-derive the current model from the projection without refetching the catalog. */
function syncModelSelection() {
  if (!state.modelCatalogRaw) return;
  const next = flattenModels(state.modelCatalogRaw, currentModelSelectionProjection());
  const before = state.modelCatalog.current;
  state.modelCatalog = { ...state.modelCatalog, current: next.current };
  if (JSON.stringify(before) !== JSON.stringify(next.current)) {
    renderComposer();
    if (state.pickerSheet === 'model') renderSheet();
  }
}
