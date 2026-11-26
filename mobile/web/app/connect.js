// app/connect.js — split from app.js (#442).
import { reconnectSticky, savedComputerRows, loadSecrets, clearSecret, rotateClientId, hasOfferFragment, pairFromOfferUrl } from '../chisacode/session.js';
import { buttonBusy, clearButtonBusy } from '../ui/button-busy.js?v=20261021-button-feedback';
import { h } from '../ui/dom.js';
import { callShell, UnauthorizedError } from '../shell/remote-shell.js';
import { muxPatch } from '../conversation/live.js';
import { applyHostFrame } from '../host/frames.js';
import { removeApproval } from '../chisacode/approvals.js';
import { resyncAfterReconnect, checkForegroundConnection, watchConnection, watchTransportMode, createDraftStore } from '../chisacode/controller.js';
import { switchDraft } from '../conversation/draft-switch.js';
import { classifyScan } from '../pair/scan.js';
import { composerOffline, operationError, renderConnBanner, setToast, showBanner, showError } from './chrome.js?v=20261117-app-split';
import { renderComposer, renderSlashPop } from './composer.js?v=20261117-app-split';
import { attachmentReads, composerBehavior, deviceLine, draft, el, logList, origin, pasteInput, pastePanel, pasteToggle, savedComputersEl, state } from './context.js?v=20261117-app-split';
import { renderDialog, renderLightbox } from './dialogs.js?v=20261117-app-split';
import { loadSubagentCatalog, renderSessions, subagentHistoryAddress } from './drawer.js?v=20261117-app-split';
import { resetWorkPanes } from './files.js?v=20261117-app-split';
import { refreshGit } from './git.js?v=20261117-app-split';
import { currentRow, promoteHeldLive, renderHeader } from './header.js?v=20261117-app-split';
import { renderApproval, renderLog } from './log.js?v=20261117-app-split';
import { clearExclusiveDialogs, historyRequest } from './new-session.js?v=20261117-app-split';
import { renderSheet } from './pickers.js?v=20261117-app-split';
import { renderScreen, setDrawerOpen } from './screens.js?v=20261117-app-split';
import { applyHistoryPayload, applyHostCatalog, assertNotLegacyHostRpc, call, loadSessionModels, pullCurrentHistory, refreshHostCatalog, refreshProjections, renderBlankHero, startLiveFollow, stopHistoryPoll, stopMux } from './session.js?v=20261117-app-split';
import { renderSettings } from './settings.js?v=20261117-app-split';
import { resetWhaleUiCards } from './whale-ui.js?v=20261117-app-split';

/** Lazy-loaded ChisaCode protocol client (DaemonClient + offer v2). */
let chisacodeApi = null;

async function loadChisaCodeApi() {
  if (!chisacodeApi) {
    chisacodeApi = await import('../chisacode/daemon-client.bundle.js');
  }
  return chisacodeApi;
}

let sockets = null;

export let draftStore = null;

function setPasteExpanded(expanded, { focus = false } = {}) {
  pastePanel.classList.toggle('hidden', !expanded);
  pasteToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  pasteToggle.textContent = expanded ? '收起配对链接' : '粘贴配对链接';
  if (expanded && focus) requestAnimationFrame(() => pasteInput.focus());
}

// —— 已保存的电脑（多台 sticky 选择，纯本地状态） —— //

let connectBusy = false;

let connectingServerId = '';

let pendingConnect = null;

let forgetConfirmId = '';
/** @type {ReturnType<typeof setTimeout> | null} */
let forgetConfirmTimer = null;

export async function connectSaved(serverId) {
  return runInitialConnect(async (signal) => {
    const api = await loadChisaCodeApi();
    await finishChisaCodeConnect(await reconnectSticky(api, serverId, { signal }), true, signal);
  }, { serverId });
}

async function runInitialConnect(attempt, { replace = false, serverId = '' } = {}) {
  if (connectBusy && !replace) return;
  pendingConnect?.abort(new Error('连接已被新的配对替换'));
  const controller = new AbortController();
  pendingConnect = controller;
  if (state.chisacode) forceLogout('', { forget: false });
  connectBusy = true;
  connectingServerId = serverId;
  renderSavedComputers();
  el('paste-enter').disabled = true;
  el('scan-open').disabled = true;
  buttonBusy(el('paste-enter'), true, { label: '连接中…' });
  buttonBusy(el('scan-open'), true, { label: '连接中…' });
  deviceLine.textContent = '正在连接电脑…';
  showError('');
  try {
    await attempt(controller.signal);
  } catch (error) {
    if (pendingConnect !== controller) return;
    if (state.chisacode) forceLogout('', { forget: false });
    deviceLine.textContent = '连接失败';
    const reason = /timed? out/i.test(error?.message || '') ? '连接超时' : (error?.message || '电脑没有响应');
    operationError(`${reason}。请确认电脑端远程已开启。`, () => runInitialConnect(attempt, { replace: true, serverId }));
  } finally {
    if (pendingConnect === controller) {
      pendingConnect = null;
      connectBusy = false;
      connectingServerId = '';
      el('paste-enter').disabled = false;
      el('scan-open').disabled = false;
      buttonBusy(el('paste-enter'), false);
      buttonBusy(el('scan-open'), false);
      renderSavedComputers();
    }
  }
}

export function renderSavedComputers() {
  const rows = savedComputerRows(loadSecrets());
  savedComputersEl.classList.toggle('hidden', rows.length === 0);
  clearButtonBusy(savedComputersEl);
  savedComputersEl.replaceChildren();
  if (!rows.length) return;
  const heading = document.createElement('p');
  heading.className = 'saved-title';
  heading.textContent = '已保存的电脑';
  savedComputersEl.append(heading);
  for (const [index, entry] of rows.entries()) {
    const row = document.createElement('div');
    row.className = 'saved-row';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'saved-open';
    open.disabled = connectBusy;
    const tile = document.createElement('span');
    tile.className = 'saved-tile';
    tile.setAttribute('aria-hidden', 'true');
    tile.append(h('svg', { width: '16', height: '16', viewBox: '0 0 20 20', fill: 'none' },
      h('rect', { x: '2.5', y: '3.5', width: '15', height: '10', rx: '1.5', stroke: 'currentColor', 'stroke-width': '1.4' }),
      h('path', { d: 'M7 16.5h6M10 13.5v3', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linecap': 'round' })));
    const main = document.createElement('span');
    main.className = 'saved-main';
    const name = document.createElement('b');
    name.textContent = entry.computerName;
    const desc = document.createElement('span');
    desc.className = 'saved-desc';
    const sameName = rows.filter((item) => item.computerName === entry.computerName).length > 1;
    desc.textContent = [
      sameName ? `连接 ${index + 1}` : '',
      entry.relayEndpoint,
      entry.savedAt ? new Date(entry.savedAt).toLocaleDateString('zh-CN') : '',
    ].filter(Boolean).join(' · ');
    open.setAttribute('aria-label', `${entry.computerName} · ${desc.textContent}`);
    main.append(name, desc);
    open.append(tile, main, h('svg', { width: '14', height: '14', viewBox: '0 0 16 16', fill: 'none', class: 'chev' },
      h('path', { d: 'm6 3.5 4.5 4.5L6 12.5', stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })));
    buttonBusy(open, connectBusy && connectingServerId === entry.serverId, { label: '连接中…' });
    open.addEventListener('click', () => { void connectSaved(entry.serverId); });
    const forget = document.createElement('button');
    forget.type = 'button';
    forget.className = 'saved-forget';
    const armed = forgetConfirmId === entry.serverId;
    forget.textContent = armed ? '确认忘记' : '忘记';
    forget.disabled = connectBusy;
    forget.setAttribute('aria-label', armed ? `确认忘记 ${entry.computerName}` : `忘记 ${entry.computerName}`);
    forget.addEventListener('click', () => {
      if (forgetConfirmId !== entry.serverId) {
        forgetConfirmId = entry.serverId;
        if (forgetConfirmTimer !== null) clearTimeout(forgetConfirmTimer);
        forgetConfirmTimer = setTimeout(() => {
          if (forgetConfirmId === entry.serverId) {
            forgetConfirmId = '';
            renderSavedComputers();
          }
        }, 4000);
        renderSavedComputers();
        return;
      }
      if (forgetConfirmTimer !== null) clearTimeout(forgetConfirmTimer);
      forgetConfirmTimer = null;
      forgetConfirmId = '';
      clearSecret(entry.serverId);
      renderSavedComputers();
    });
    row.append(open, forget);
    savedComputersEl.append(row);
  }
}

export function forceLogout(message, { forget = true } = {}) {
  const serverId = state.chisacode?.serverId;
  try {
    state.chisacode?.dispose?.();
    const closing = state.chisacode?.client?.close?.();
    if (closing && typeof closing.catch === 'function') {
      void closing.catch(() => { /* The old paired client may already have disconnected; continue replacing it. */ });
    }
  } catch { /* ignore */ }
  if (state.transport === 'chisacode' && serverId) {
    if (forget) {
      clearSecret(serverId);
      draftStore?.clearAll();
    }
    // The relay keeps the old registration briefly; a fresh id lets the next
    // pairing in this tab handshake instead of stalling (DEF-REPAIR-INTAB).
    rotateClientId();
  }
  draftStore = null;
  sockets?.close();
  sockets = null;
  state.connected = false;
  state.sessionEpoch++;
  state.sendBusy = false;
  state.gitBusy = false;
  state.gitRetry = null;
  state.commitFiles = null;
  state.pickerSheet = '';
  state.pickerPage = '';
  state.attachOpen = false;
  state.lightbox = null;
  clearExclusiveDialogs();
  setDrawerOpen(false);
  state.sessionsOpen = false;
  state.settingsOpen = false;
  state.transport = '';
  state.transportMode = '';
  state.chisacode = null;
  state.route = 'connect';
  state.sessions = [];
  state.sessionId = '';
  state.events = [];
  state.pendingApprovals = [];
  state.sessionValues = {};
  state.outbox = [];
  state.promptIdentity = null;
  state.queueBusy = '';
  logList.reset();
  resetWhaleUiCards();
  attachmentReads.clear();
  state.timelinePage = { hasOlder: false, beforeSeq: null };
  state.timelineLoadingOlder = false;
  state.timelineLoading = false;
  state.timelineError = '';
  state.sessionMenu = '';
  state.sessionConfirm = null;
  state.sessionRename = null;
  state.workspaceMenu = '';
  state.subagentSheet = false;
  state.subagentCatalog = null;
  state.subagentRow = null;
  state.history = null;
  state.modelPane = null;
  state.modelBusy = false;
  state.workspaces = { items: [], archivedSessionIds: [] };
  state.sessionsError = '';
  state.searchHits = null;
  state.searchHasMore = false;
  stopHistoryPoll();
  stopMux();
  state.slash = { open: false, loading: false, error: '', commands: [] };
  state.settingsOpen = false;
  state.settingsPane = '';
  state.gitDialog = '';
  state.connPhase = 'online';
  state.connLabel = '';
  state.newSession = null;
  resetWorkPanes();
  state.extPane = { mcp: null, skills: null, plugins: null };
  showBanner('');
  setToast('');
  renderConnBanner();
  renderSheet();
  renderDialog();
  renderLightbox();
  renderScreen();
  showError(message || '');
}

export async function shell(name, payload = {}) {
  assertNotLegacyHostRpc();
  try {
    return await callShell({ origin, name, payload });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      forceLogout('登录已失效');
    }
    throw error;
  }
}

// —— 事件流 —— //

function applyMux(frame) {
  const patch = muxPatch(frame, state.sessionId);
  if (!patch) return;
  if (patch.type === 'event') {
    state.events.push(patch.entry);
    renderLog();
    return;
  }
  if (patch.type === 'approval') {
    state.pendingApprovals = [{ ...patch.pending, legacy: true, actions: [] }];
    renderApproval();
    return;
  }
  if (patch.type === 'approval-clear') {
    state.pendingApprovals = [];
    renderApproval();
    return;
  }
  if (patch.type === 'title') {
    const row = currentRow();
    if (row) {
      row.projections = row.projections || { values: {} };
      row.projections.values = { ...row.projections.values, title: patch.value };
      row.blank = false;
      if (state.heldSession?.sessionId === row.sessionId) state.heldSession = { ...row };
      promoteHeldLive();
    }
    renderHeader();
    renderSessions();
  }
}

function applyHost(frame) {
  state.sessions = applyHostFrame(state.sessions, frame?.payload);
  renderSessions();
  renderHeader();
}

function sessionItems(value) {
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.sessions)) return value.sessions;
  return [];
}

function updateHostSession(session) {
  if (!session?.sessionId) return;
  const index = state.sessions.findIndex((row) => row.sessionId === session.sessionId);
  const next = {
    ...(index >= 0 ? state.sessions[index] : { projections: { values: {} } }),
    sessionId: session.sessionId,
    cwd: session.cwd || (index >= 0 ? state.sessions[index].cwd : ''),
    running: session.running === true,
    parentSessionId: session.parentSessionId || '',
    origin: session.origin || '',
    projections: session.projections || (index >= 0 ? state.sessions[index].projections : { values: {} }),
  };
  if (index >= 0) state.sessions[index] = next;
  else state.sessions.unshift(next);
  if (state.sessionId === next.sessionId) {
    state.cwd = next.cwd;
    renderComposer();
    renderApproval();
  }
  renderSessions();
  renderHeader();
}

export function clearApproval(requestId) {
  const before = state.pendingApprovals.length;
  state.pendingApprovals = removeApproval(state.pendingApprovals, requestId)
    .filter((item) => item.rpcId !== requestId && item.approvalId !== requestId);
  if (state.pendingApprovals.length !== before) {
    renderApproval();
  }
}

function bindChisaCodeEvents(paired) {
  return () => {};
}

export async function runReconnectResync() {
  const paired = state.chisacode;
  if (state.transport !== 'chisacode' || !paired || paired.resyncing) return;
  paired.resyncing = true;
  state.catalogBusy = true;
  const sessionId = state.sessionId;
  renderSessions();
  try {
    const { sessions, workspaces, history } = await resyncAfterReconnect(paired.client, {
      sessionId,
      address: subagentHistoryAddress(sessionId),
    });
    if (state.chisacode !== paired) return;
    applyHostCatalog({ sessions, workspaces });
    if (history && state.sessionId === sessionId) {
      applyHistoryPayload(history, { merge: true });
      state.timelineError = '';
      state.timelineLoading = false;
      state.cwd = currentRow()?.cwd || state.cwd;
    }
    renderSessions();
    renderHeader();
    renderLog({ anchor: 'bottom' });
    renderApproval();
    renderComposer();
    showBanner('');
    startLiveFollow();
    void refreshProjections();
    void loadSubagentCatalog(state.sessionId);
    setToast('已重新连接并同步', { tone: 'success' });
  } catch (error) {
    if (state.chisacode !== paired) return;
    state.sessionsError = `同步失败：${error?.message || '电脑没有响应'}`;
    state.banner = state.sessionsError;
    operationError(state.sessionsError, runReconnectResync);
  } finally {
    paired.resyncing = false;
    if (state.chisacode === paired) {
      state.catalogBusy = false;
      renderSessions();
    }
  }
}

export async function resumeRemoteConnection() {
  const paired = state.chisacode;
  if (!paired || !state.connected || connectBusy || paired.checkingForeground || paired.getAuthError?.()) return;
  paired.checkingForeground = true;
  try {
    if (await checkForegroundConnection(paired.client)) {
      if (state.chisacode === paired) await runReconnectResync();
    }
  } catch {
    if (state.chisacode === paired) renderConnBanner();
  } finally {
    paired.checkingForeground = false;
  }
}

/** @param {any} paired */
function attachChisaCodeSubscriptions(paired) {
  const disposeEvents = bindChisaCodeEvents(paired);
  const disposeWatch = watchConnection(paired.client, {
    onStatus: (phase) => {
      if (state.chisacode !== paired) return;
      state.connPhase = phase.phase;
      state.connLabel = paired.getAuthError?.()?.message || phase.label;
      if (phase.phase !== 'online') {
        stopHistoryPoll();
        stopMux();
      }
      renderConnBanner();
      renderComposer();
    },
    onReconnected: () => {
      paired.computerName = paired.refreshComputerName?.() || paired.computerName;
      state.hostName = paired.computerName;
      if (state.settingsOpen) renderSettings();
      void runReconnectResync();
    },
  });
  const disposeTransportMode = watchTransportMode(paired.client, (mode) => {
    if (state.chisacode !== paired) return;
    state.transportMode = mode || '';
    if (state.settingsOpen) renderSettings();
  });
  paired.dispose = () => {
    disposeEvents();
    disposeWatch();
    disposeTransportMode();
    stopHistoryPoll();
    stopMux();
  };
}

/** @param {any} paired */
function applyChisaCodeConnectedState(paired) {
  draftStore = createDraftStore(localStorage, paired.serverId);
  state.chisacode = paired;
  state.transport = 'chisacode';
  state.transportMode = paired.getTransportMode?.() || paired.transportMode || state.transportMode || '';
  state.connected = true;
  state.route = 'chat';
  state.host = { protocol: 'chisacode-v2', serverId: paired.serverId };
  state.cwd = '';
  resetWorkPanes();
  state.extPane = { mcp: null, skills: null, plugins: null };
  state.hostName = paired.computerName;
}

async function finishChisaCodeConnect(paired, reconnected, signal) {
  if (signal?.aborted) {
    await paired.client.close();
    return;
  }
  state.chisacode = paired;
  const closeOnAbort = () => { void paired.client.close().catch(() => { /* The pairing abort owns the outcome; the client may already be closed. */ }); };
  signal?.addEventListener('abort', closeOnAbort, { once: true });
  attachChisaCodeSubscriptions(paired);
  applyChisaCodeConnectedState(paired);
  let loadError = '';
  deviceLine.textContent = '已连接，正在同步会话…';
  try {
    await refreshHostCatalog();
  } catch (error) {
    if (signal?.aborted || state.chisacode !== paired) return;
    state.sessions = [];
    state.workspaces = { items: [], archivedSessionIds: [] };
    loadError = error?.message?.includes('桌面端未启动')
      ? '桌面端未启动'
      : `无法加载会话：${error?.message || '电脑没有响应'}`;
    state.sessionsError = loadError;
  } finally {
    signal?.removeEventListener('abort', closeOnAbort);
  }
  if (signal?.aborted || state.chisacode !== paired) return;
  if (hasOfferFragment(location.hash)) {
    window.history.replaceState(null, '', `${location.pathname}${location.search}`);
  }
  deviceLine.replaceChildren(
    h('span', { class: 'live', 'aria-hidden': 'true' }),
    document.createTextNode(`${reconnected ? '已重连' : '已配对'} ${paired.computerName}`),
  );
  showBanner(loadError);
  if (loadError) operationError(loadError, runReconnectResync);
  renderSessions();
  renderHeader();
  renderScreen();
  // The drawer must track desktop-side catalog changes even before a session
  // is opened (DEF-SYNC-REVERSE); openSession re-arms the same follow.
  if (!loadError) startLiveFollow();
}

export async function connect(offerUrl) {
  return runInitialConnect(async (signal) => {
    if (!hasOfferFragment(offerUrl)) {
      throw new Error('请使用桌面端扫码配对二维码（dshd offer）');
    }
    const api = await loadChisaCodeApi();
    await finishChisaCodeConnect(await pairFromOfferUrl(api, offerUrl, { signal }), false, signal);
  }, { replace: true });
}

export async function openSession(sessionId, options = {}) {
  state.sessionEpoch++;
  state.sendBusy = false;
  state.modelBusy = false;
  state.gitRetry = null;
  state.commitFiles = null;
  state.gitError = '';
  state.modeBusy = false;
  state.modelPane = null;
  state.modelCatalogRaw = null;
  state.modelCatalog = { current: null, rows: [], failures: [] };
  state.pickerSheet = '';
  state.pickerPage = '';
  state.attachOpen = false;
  state.subagentSheet = false;
  clearExclusiveDialogs();
  renderSheet(); renderDialog();
  const previousSessionId = state.sessionId;
  const restored = state.transport === 'chisacode'
    ? switchDraft({
      store: draftStore,
      fromId: previousSessionId,
      toId: sessionId,
      currentText: draft.value,
      currentAttachments: state.attachments,
    })
    : { text: '', attachments: [] };
  state.sessionId = sessionId;
  draft.dataset.draftSession = sessionId;
  if (state.catalogSessions) {
    applyHostCatalog({ sessions: state.catalogSessions, workspaces: state.workspaces });
  }
  // `subagentRow` remembers the open address (parent + mode) for paging, and
  // doubles as the row for a catalog child absent from session.list so the
  // view stays read-only and titled like any other subagent.
  state.subagentRow = options.subagent
    ? {
      sessionId,
      origin: 'subagent',
      parentSessionId: options.subagent.parentSessionId || '',
      subagentMode: options.subagent.mode || 'unknown',
      running: false,
      archived: false,
      blank: false,
      cwd: '',
      projections: { values: { title: options.subagent.label || '' } },
    }
    : null;
  state.sessionsOpen = false;
  setDrawerOpen(false);
  renderScreen();
  draft.value = restored.text;
  composerBehavior.reset();
  state.attachments = restored.attachments;
  state.timelinePage = { hasOlder: false, beforeSeq: null };
  state.timelineLoadingOlder = false;
  state.events = [];
  state.pendingApprovals = [];
  state.sessionValues = {};
  state.outbox = [];
  state.promptIdentity = null;
  state.queueBusy = '';
  logList.reset();
  resetWhaleUiCards();
  attachmentReads.clear();
  state.timelineError = '';
  state.timelineLoading = true;
  renderComposer();
  renderSlashPop();
  renderLog({ anchor: 'bottom' });
  renderApproval();
  renderHeader();
  let history;
  try {
    history = await call('session.history', historyRequest(sessionId));
  } catch (error) {
    if (state.sessionId !== sessionId) return;
    state.timelineLoading = false;
    state.timelineError = error?.message || '电脑没有响应';
    operationError(`载入会话失败：${state.timelineError}`, () => openSession(sessionId, options));
    renderLog({ anchor: 'bottom' });
    throw error;
  }
  if (state.sessionId !== sessionId) return;
  state.timelineLoading = false;
  if (state.toastTone === 'error' && state.gitToast.startsWith('载入会话失败：')) setToast('');
  const previousCwd = state.cwd;
  applyHistoryPayload(history.value || history);
  state.cwd = currentRow()?.cwd || '';
  if (state.cwd !== previousCwd) resetWorkPanes();
  renderBlankHero();
  startLiveFollow();
  void refreshProjections();
  void loadSessionModels();
  void loadSubagentCatalog(sessionId);
  void refreshGit();
  renderHeader();
  renderSessions();
  renderLog({ anchor: 'bottom' });
  renderApproval();
  renderComposer();
}

el('permission-paste').addEventListener('click', () => {
  state.route = 'connect';
  renderScreen();
  setPasteExpanded(true, { focus: true });
});

pasteToggle.addEventListener('click', () => {
  setPasteExpanded(pastePanel.classList.contains('hidden'), { focus: true });
});

el('paste-enter').addEventListener('click', () => {
  const outcome = classifyScan(pasteInput.value, origin);
  if (outcome.kind === 'invalid') {
    showError('链接无效');
    return;
  }
  if (outcome.kind === 'navigate') {
    window.location.replace(outcome.url);
    return;
  }
  connect(outcome.offerUrl).catch((error) => showError(error.message || '连接失败'));
});

window.addEventListener('online', () => { void resumeRemoteConnection(); });

window.addEventListener('dshd-resume', () => { void resumeRemoteConnection(); });

window.addEventListener('pageshow', (event) => {
  if (event.persisted) void resumeRemoteConnection();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  void resumeRemoteConnection();
  // Polling pauses while hidden; catch up once when the tab returns.
  if (state.connected && !composerOffline() && (currentRow()?.running || state.outbox.length)) void pullCurrentHistory();
});
