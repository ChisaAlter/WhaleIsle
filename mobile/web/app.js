import { callUnary, respond } from './host/rpc.js';
import { handshake } from './host/handshake.js';
import { openEventSockets } from './host/events.js';
import { applyHostFrame, hostFrameNeedsCatalogRefresh, hostLabel } from './host/frames.js';
import { textBlock, imageBlock, promptPayload, ALLOWED_IMAGE_TYPES } from './host/prompt.js';
// Keep ESM child modules on the same cache-busting contract as index.html.
// Mobile WebViews cache module URLs independently, so updating app.js alone
// can otherwise combine a new parent with an old fold implementation.
import { foldEvents, groupTurns } from './conversation/fold.js?v=20260902-mobile-ui';
import { lineDiff, toolRowModel } from './conversation/tool-model.js?v=20260902-mobile-ui';
import { isUntitledBlank, sessionTitle } from './conversation/title.js';
import { switchDraft } from './conversation/draft-switch.js';
import { muxPatch, titleFromProjection } from './conversation/live.js';
import { visibleScreen } from './ui/chrome.js';
import { buttonBusy, clearButtonBusy } from './ui/button-busy.js?v=20261021-button-feedback';
import { backTarget, createNavigation } from './ui/navigation.js?v=20260906-interaction';
import { createSurface, createFocusScope } from './ui/surfaces.js?v=20261025-remote-refinement';
import { sessionOwner } from './ui/session-owner.js?v=20260906-interaction';
import { blankGreeting } from './ui/greeting.js';
import { installComposerBehavior } from './ui/composer-behavior.js?v=20260906-interaction';
import {
  channelLabel,
  gitStatusLine,
  schemeIsDark,
  hostSettingsSection,
  settingsGroups,
} from './ui/settings-hub.js';
import { callShell, UnauthorizedError } from './shell/remote-shell.js';
import { parseVcsStatus, parseBranchList } from './git/vcs-parse.js';
import { resolveGitQuick } from './git/quick.js';
import { runStackedGit } from './git/stack.js?v=20260906-interaction';
import { gitCommitPayload, gitTunnelAction } from './git/bridge.js';
import { gitCall, hostCall } from './host/backend.js';
import { deliverApprovalRespond } from './host/approval-respond.js';
import {
  archivedSessionRows,
  browseStartPath,
  heldSessionRow,
  insertSessionMove,
  liveSessionRows,
  presetChoices,
  withHeldLiveRow,
  workspaceChoices,
  workspaceDrawerSections,
  workspaceIdFromCreate,
} from './host/catalog.js';
import { freezePane } from './host/freeze.js';
import { historyQuery, hostHistoryPage, mergeApprovalPending, mergeOlderHistory, pendingFromHistoryEvents, runningFromHistoryEvents } from './host/history.js';
import { effortsFor, flattenModels, isRoutable, modelChipLabel } from './host/models.js';
import { attachmentGuard } from './host/attach-guard.js';
import { approvalFromMux, approvalResolvedId, muxEventShouldApply, muxPayload, runningFromMux } from './host/mux.js';
import { catalogRefreshReason, createCatalogRefreshScheduler } from './host/catalog-refresh.js';
import {
  DEFAULT_PRESETS,
  applyPermissionProjectionFrame,
  applyPermissionSnapshot,
  permissionCommand,
  permissionLabel,
} from './host/permission.js';
import {
  admitCommandResult,
  commandExecutePayload,
  commandListPayload,
  isSlashSubmitLine,
  mapHostSlashList,
} from './host/commands.js';
import { classifyScan, detectScanSupport, scanUnavailableHint } from './pair/scan.js';
import { isNativeAndroidApp, runScanAction } from './pair/native-scan.js';
import {
  clearSecret,
  getMostRecentStickyServerId,
  hasOfferFragment,
  listStickyServerIds,
  loadSecrets,
  pairFromOfferUrl,
  reconnectSticky,
  rotateClientId,
  savedComputerRows,
} from './chisacode/session.js';
import {
  checkForegroundConnection,
  createDraftStore,
  resyncAfterReconnect,
  watchConnection,
} from './chisacode/controller.js';
import {
  isReadOnlyRow,
  sessionRowForest,
} from './chisacode/directory.js?v=20260907-session-fork';
import {
  resolveLogAnchor,
} from './chisacode/timeline.js';
import {
  genericResponse,
  removeApproval,
  responseForAction,
} from './chisacode/approvals.js';
import {
  applySlashCommand,
  filterSlashCommands,
  slashQuery,
} from './chisacode/commands.js';
import { parseMarkdown } from './conversation/markdown.js';
import { isNativeBootstrapEpoch, nativeSessionTitle, projectNativeSnapshot, validateNativeAction } from './native-bridge.js?v=20260929-native-chat-epoch-v2';

/** Lazy-loaded ChisaCode protocol client (DaemonClient + offer v2). */
let chisacodeApi = null;
async function loadChisaCodeApi() {
  if (!chisacodeApi) {
    chisacodeApi = await import('./chisacode/daemon-client.bundle.js');
  }
  return chisacodeApi;
}

const origin = window.location.origin;
const el = (id) => document.getElementById(id);
const phone = el('phone');

/**
 * Android WebView 131 can report a valid `innerHeight` while resolving
 * viewport units (`100vh` / `100dvh`) to 0 inside a Compose-hosted view.
 * Publish the measured viewport as a pixel fallback; it also tracks the
 * keyboard and rotation without changing the desktop browser path.
 */
function syncViewportHeight() {
  const viewport = window.visualViewport;
  const height = Math.round(viewport?.height || window.innerHeight || 0);
  const offset = Math.round(viewport?.offsetTop || 0);
  if (height > 0) phone.style.setProperty('--dsh-viewport-height', `${height}px`);
  phone.style.setProperty('--dsh-viewport-offset', `${offset}px`);
}
window.addEventListener('resize', syncViewportHeight);
window.visualViewport?.addEventListener('resize', syncViewportHeight);
window.visualViewport?.addEventListener('scroll', syncViewportHeight);
syncViewportHeight();

const screenConnect = el('screen-connect');
const screenScan = el('screen-scan');
const screenPermission = el('screen-permission');
const screenChat = el('screen-chat');
const connectError = el('connect-error');
const savedComputersEl = el('saved-computers');
const deviceLine = el('device-line');
const pasteInput = el('paste');
const pastePanel = el('paste-panel');
const pasteToggle = el('paste-toggle');
const scanOpen = el('scan-open');
const scanUnavailable = el('scan-unavailable');
const scanVideo = el('scan-video');
const scanTip = el('scan-tip');
const scanTorch = el('scan-torch');
const chatTitle = el('chat-title');
const hostLine = el('host-line');
const gitPill = el('git-pill');
const gitPillLabel = el('git-pill-label');
const gitPillCount = el('git-pill-count');
const sessionsPage = el('sessions-page');
const drawerStatus = el('drawer-status');
const drawerDirectory = el('drawer-directory');
const navSessionsCount = el('nav-sessions-count');
const drawerAccount = el('drawer-account');
const drawerAvatar = el('drawer-avatar');
const drawerAccountName = el('drawer-account-name');
const blankGreetingEl = el('blank-greeting');
const blankWorkspaceChipLabel = el('blank-workspace-chip-label');
const connBanner = el('conn-banner');
const bannerEl = el('banner');
const logEl = el('log');
const blankEl = el('blank');
const blankWorkspaceChip = el('blank-workspace-chip');
const composer = el('composer');
const draft = el('draft');
const attachRail = el('attach-rail');
const sendBtn = el('send-btn');
const stopBtn = el('stop-btn');
const accessChip = el('access-chip');
const planChip = el('plan-chip');
const modelChip = el('model-chip');
const approval = el('approval');
const approvalTitle = el('approval-title');
const approvalCommand = el('approval-command');
const approvalActions = el('approval-actions');
const slashPop = el('slash-pop');
const readonlyNote = el('readonly-note');
const sessionList = el('session-list');

const search = el('search');
const settings = el('settings');
const settingsBack = el('settings-back');
const settingsTitle = el('settings-title');
const options = el('options');
const backdrop = el('backdrop');
const sheetRoot = el('sheet-root');
const dialogRoot = el('dialog-root');
const toastRoot = el('toast-root');
const lightboxRoot = el('lightbox-root');
const fileCamera = el('file-camera');
const fileGallery = el('file-gallery');

// 手机外观持久化（localStorage，对应 Android DeviceStore 的 scheme/glass/uiFont/gitTitle）。
const PHONE_KEYS = { scheme: 'dsh-phone-scheme', glass: 'dsh-phone-glass', uiFont: 'dsh-phone-ui-font', gitTitle: 'dsh-phone-git-title' };
function readPhoneStore() {
  let scheme = 'system';
  let glass = 80;
  let uiFont = '';
  let gitTitle = true;
  try {
    const rawScheme = localStorage.getItem(PHONE_KEYS.scheme);
    if (rawScheme === 'light' || rawScheme === 'dark' || rawScheme === 'system') scheme = rawScheme;
    const storedGlass = localStorage.getItem(PHONE_KEYS.glass);
    const rawGlass = Number(storedGlass);
    if (storedGlass !== null && Number.isFinite(rawGlass) && rawGlass >= 0 && rawGlass <= 100) glass = rawGlass;
    uiFont = localStorage.getItem(PHONE_KEYS.uiFont) || '';
    if (localStorage.getItem(PHONE_KEYS.gitTitle) === 'false') gitTitle = false;
  } catch { /* storage unavailable → session memory */ }
  return { scheme, glass, uiFont, gitTitle };
}
function persistPhoneStore(key, value) {
  try {
    localStorage.setItem(PHONE_KEYS[key], String(value));
  } catch { /* ignore */ }
}

const store = readPhoneStore();
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const nativeAndroidApp = isNativeAndroidApp(navigator.userAgent);

let nativeSnapshotQueued = false;
let nativeSnapshotSeq = 0;
let nativeSnapshotEpoch = '';
function scheduleNativeSnapshot() {
  if (!nativeAndroidApp || !nativeSnapshotEpoch || nativeSnapshotQueued) return;
  nativeSnapshotQueued = true;
  queueMicrotask(() => {
    nativeSnapshotQueued = false;
    const bridge = window.DshdNativeBridge;
    if (!nativeSnapshotEpoch || typeof bridge?.postMessage !== 'function') return;
    try {
      const rows = groupTurns(foldEvents(state.events), { running: state.running === true ? true : null });
      bridge.postMessage(JSON.stringify(projectNativeSnapshot({
        state, rows, title: currentRow() ? nativeSessionTitle(currentRow()) : '新会话',
        draft: draft.value, model: currentModelState().label,
        permission: currentModeState().currentLabel, readOnly: currentReadOnlyReason(),
        sessionReadOnly: isReadOnlyRow, permissionOptions: DEFAULT_PRESETS,
        seq: ++nativeSnapshotSeq, epoch: nativeSnapshotEpoch,
      })));
    } catch { /* A missing native receiver must never break the E2EE client. */ }
  });
}

const HISTORY_POLL_MS = 1500;

const state = {
  route: 'connect',
  connected: false,
  settingsOpen: false,
  settingsPane: '',
  sessionsOpen: false,
  drawerOpen: false,
  sessionEpoch: 0,
  sendBusy: false,
  modelQuery: '',
  pickerError: '',
  gitError: '',
  gitRetry: null,
  commitFiles: null,
  gitProgress: '',
  gitProgressDismissed: false,
  branchLoading: false,
  branchRequest: 0,
  sessions: [],
  catalogSessions: null,
  heldSession: null,
  sessionsError: '',
  workspaces: { items: [], archivedSessionIds: [] },
  archivedRows: [],
  sessionView: 'grouped',
  searchHits: null,
  searchHasMore: false,
  searchLoading: false,
  sessionId: '',
  events: [],
  pendingApprovals: [],
  timelinePage: { hasOlder: false, beforeSeq: null },
  timelineLoadingOlder: false,
  timelineLoading: false,
  timelineError: '',
  sessionMenu: '',
  sessionConfirm: null,
  sessionRename: null,
  workspaceRename: null,
  folderCreate: null,
  workspaceMenu: '',
  history: null,
  modelPane: null,
  modelBusy: false,
  modelCatalog: { current: null, rows: [], failures: [] },
  modelCatalogRaw: null,
  permission: { current: '', planOn: false },
  slash: { open: false, loading: false, error: '', commands: [] },
  query: '',
  host: null,
  hostName: '已连接',
  cwd: '',
  running: false,
  banner: '',
  attachments: [],
  lightbox: null,
  attachOpen: false,
  connPhase: 'online',
  connLabel: '',
  modeBusy: false,
  newSession: null,
  gitStatus: parseVcsStatus(null),
  gitBusy: false,
  gitPendingRef: '',
  gitAuthError: '',
  gitToast: '',
  toastTone: 'info',
  toastActions: [],
  toastHoldMs: 2400,
  gitDialog: '',
  pickerSheet: '',
  pickerPage: '',
  gitConfirmAction: '',
  gitConfirmExtra: {},
  branches: [],
  branchQuery: '',
  newBranchName: '',
  commitMessage: '',
  commitOnNewBranch: false,
  pendingStacked: '',
  publishName: '',
  publishRemoteUrl: '',
  publishVisibility: 'private',
  expandedWorkspaces: {},
  wsTab: 'changes',
  fileQuery: '',
  fileEntries: [],
  // Phase 2 work loops (chisacode only): Files drill-down, read-only diff,
  // and read-only MCP / skills inventories.
  filesPane: null,
  diffPane: null,
  extPane: { mcp: null, skills: null },
  scanSupport: { supported: false, reason: '' },
  transport: '',
  chisacode: null,
};

let sockets = null;
let draftStore = null;
let scanStream = null;
let scanLoopId = 0;
let lastInvalidScan = '';
let torchOn = false;
let toastTimer = 0;
let historyPollTimer = 0;
let muxUnsub = null;

let navigationQueued = false;
let lastSurfaceKey = '';
const focusScope = createFocusScope(document);
const composerBehavior = installComposerBehavior({ document, composer, input: draft, readingArea: logEl });
let fileSelectionOwner = null;
const settingsScroll = new Map();
const navigation = createNavigation({
  history: window.history,
  listen: (handler) => window.addEventListener('popstate', handler),
  hasSurface: () => backTarget(state) !== 'root',
  getSurfaceKey: () => `${state.sessionEpoch}:${surfaceIdentity()}`,
  canTrack: () => !hasOfferFragment(location.hash),
  isBlocked: navigationBusy,
  onBack: backOneSurface,
});
window.__dshdNavigation = Object.freeze({ back: () => navigation.back() });

function navigationBusy() {
  const target = backTarget(state);
  if (['sessionConfirm', 'workspaceRename', 'folderCreate', 'sessionRename'].includes(target)) return Boolean(state[target]?.busy);
  return (target === 'git' && state.gitBusy) || Boolean(state.newSession?.creating);
}

function backOneSurface() {
  const target = backTarget(state);
  if (target === 'lightbox') state.lightbox = null;
  else if (['sessionConfirm', 'workspaceRename', 'folderCreate', 'sessionRename'].includes(target)) state[target] = null;
  else if (target === 'git') {
    state.gitError = '';
    if (state.gitDialog === 'create-branch') state.gitDialog = state.gitConfirmAction ? 'confirm' : 'branch';
    else {
      state.gitDialog = state.gitDialog === 'menu' ? '' : 'menu';
      state.gitConfirmAction = '';
      state.gitConfirmExtra = {};
    }
  } else if (target === 'directory') updateNewSession({ step: 'workspace', loading: false, error: '' });
  else if (target === 'newSession') state.newSession = null;
  else if (target === 'history') state.history = null;
  else if (target === 'picker') {
    if (state.pickerSheet === 'model' && state.pickerPage) state.pickerPage = '';
    else state.pickerSheet = '';
  }
  else if (target === 'attachment') state.attachOpen = false;
  else if (target === 'settingsPane') state.settingsPane = '';
  else if (target === 'settings') state.settingsOpen = false;
  else if (target === 'drawer') setDrawerOpen(false);
  else if (target === 'scan') { closeScan(); return; }
  else if (target === 'sessionMenu' || target === 'workspaceMenu') state[target] = '';
  else if (target === 'sessions') state.sessionsOpen = false;
  renderSheet(); renderDialog(); renderLightbox(); renderScreen();
  if (state.settingsOpen) renderSettings();
}

function scheduleNavigation() {
  if (navigationQueued) return;
  navigationQueued = true;
  queueMicrotask(() => {
    navigationQueued = false;
    const active = lightboxRoot.firstElementChild || dialogRoot.firstElementChild || sheetRoot.firstElementChild
      || (state.settingsOpen ? settings : state.sessionsOpen ? sessionsPage : state.drawerOpen ? el('drawer') : null);
    for (const child of phone.children) {
      child.inert = Boolean(active && child !== toastRoot && child !== active && !child.contains(active));
    }
    if (active === el('drawer')) backdrop.inert = false;
    if (!state.drawerOpen) el('drawer').inert = true;
    el('attach-toggle').setAttribute('aria-expanded', String(state.attachOpen));
    accessChip.setAttribute('aria-expanded', String(state.pickerSheet === 'mode'));
    modelChip.setAttribute('aria-expanded', String(state.pickerSheet === 'model'));
    const target = backTarget(state);
    if (active?.querySelector('.surface-panel') && lastSurfaceKey === surfaceIdentity()) active.querySelector('.surface-panel').dataset.refreshed = '';
    lastSurfaceKey = active ? surfaceIdentity() : '';
    focusScope.sync(active, active ? surfaceIdentity() : '');
    navigation.sync();
  });
}

function surfaceIdentity() {
  return `${backTarget(state)}:${state.gitDialog}:${state.settingsPane}:${state.pickerSheet}:${state.newSession?.step || ''}`;
}

function preserveSurfaceInput(root) {
  const identity = surfaceIdentity();
  const active = document.activeElement;
  const editing = root.contains(active) && active.matches('input:not([type=checkbox]),textarea');
  const focused = root.contains(active);
  const label = focused ? active.getAttribute('aria-label') : null;
  const text = focused ? active.textContent : '';
  const placeholder = editing ? active.getAttribute('placeholder') : null;
  const selection = editing ? [active.selectionStart, active.selectionEnd] : null;
  const scroll = root.querySelector('.surface-content')?.scrollTop || 0;
  queueMicrotask(() => {
    if (surfaceIdentity() !== identity) return;
    const content = root.querySelector('.surface-content');
    if (content) content.scrollTop = scroll;
    if (!focused || active.isConnected) return;
    const next = editing
      ? [...root.querySelectorAll('input,textarea')].find((node) => node.getAttribute('placeholder') === placeholder)
      : [...(root.querySelector('.surface-panel') || root).querySelectorAll('button,[tabindex]')].find((node) => node.tabIndex >= 0 && !node.disabled && node.getAttribute('aria-label') === label && node.textContent === text) || root.querySelector('.surface-title');
    if (!next || next.disabled || next.closest('[inert]')) return;
    next.focus({ preventScroll: true });
    if (selection && selection[0] !== null) next.setSelectionRange(...selection);
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && backTarget(state) !== 'root') {
    event.preventDefault(); navigation.back();
  }
});

function applyAppearance() {
  const dark = schemeIsDark(store.scheme, darkQuery.matches);
  document.documentElement.toggleAttribute('data-ds-dark-theme', dark);
  document.documentElement.style.setProperty('--dsw-alias-glass-opacity', `${store.glass}%`);
  if (store.uiFont.trim()) {
    document.documentElement.style.setProperty('--dsw-font-family', `${store.uiFont.trim()}, -apple-system, sans-serif`);
  } else {
    document.documentElement.style.removeProperty('--dsw-font-family');
  }
}
darkQuery.addEventListener?.('change', () => {
  if (store.scheme === 'system') applyAppearance();
});

function showError(message) {
  connectError.textContent = '';
  connectError.classList.add('hidden');
  if (message) setToast(message, { tone: 'error', holdMs: 5000 });
}

function surfaceBusy(content, busy) {
  const panel = content.closest('.surface-panel') || content;
  panel.classList.toggle('surface-busy', Boolean(busy));
  panel.setAttribute('aria-busy', String(Boolean(busy)));
}

function operationError(message, retry, actions = []) {
  const owner = sessionOwner(state);
  setToast(message, {
    tone: 'error', holdMs: retry || actions.length ? 6000 : 5000,
    actions: [...(retry ? [{ label: '重试', onClick: async () => {
      if (!owner.owns()) {
        operationError('会话或连接已切换，请从原入口重试');
        return;
      }
      if (state.gitToast === message) setToast('');
      await retry();
    } }] : []), ...actions],
  });
}

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

async function connectSaved(serverId) {
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

function renderSavedComputers() {
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
    tile.append(svgNode('<svg width="16" height="16" viewBox="0 0 20 20" fill="none"><rect x="2.5" y="3.5" width="15" height="10" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M7 16.5h6M10 13.5v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'));
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
    open.append(tile, main, svgNode('<svg width="14" height="14" viewBox="0 0 16 16" fill="none" class="chev"><path d="m6 3.5 4.5 4.5L6 12.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'));
    buttonBusy(open, connectBusy && connectingServerId === entry.serverId, { label: '连接中…' });
    open.addEventListener('click', () => { void connectSaved(entry.serverId); });
    const forget = document.createElement('button');
    forget.type = 'button';
    forget.className = 'saved-forget';
    forget.textContent = '忘记';
    forget.disabled = connectBusy;
    forget.setAttribute('aria-label', `忘记 ${entry.computerName}`);
    forget.addEventListener('click', () => {
      clearSecret(entry.serverId);
      renderSavedComputers();
    });
    row.append(open, forget);
    savedComputersEl.append(row);
  }
}

function showBanner(message) {
  const previous = state.banner;
  state.banner = message || '';
  bannerEl.textContent = '';
  bannerEl.classList.add('hidden');
  if (message) {
    if (!(state.toastTone === 'error' && state.toastActions.length && state.gitToast.includes(message))) operationError(message);
  } else if (previous && state.gitToast === previous) setToast('');
  scheduleNativeSnapshot();
}

function renderConnBanner() {
  const visible = state.transport === 'chisacode' && state.connected && state.connPhase !== 'online';
  connBanner.classList.toggle('hidden', !visible);
  if (visible) {
    connBanner.dataset.phase = state.connPhase;
    connBanner.textContent = state.connLabel;
  } else {
    delete connBanner.dataset.phase;
    connBanner.textContent = '';
  }
  scheduleNativeSnapshot();
}

function composerOffline() {
  return state.transport === 'chisacode' && state.connPhase !== 'online';
}

function connectionLabel() {
  return state.transport === 'chisacode'
    ? 'dshd · 端到端加密'
    : channelLabel(origin);
}

function openPullRequest() {
  try {
    const url = new URL(state.gitStatus.pr?.url || '');
    if (url.protocol !== 'https:') throw new Error('Pull request URL must use HTTPS');
    window.open(url.toString(), '_blank', 'noopener');
  } catch {
    showBanner('拉取请求链接不可用；请在电脑端打开');
  }
}

function renderScreen() {
  scheduleNavigation();
  const name = visibleScreen(state);
  if (name === 'connect') renderSavedComputers();
  screenConnect.classList.toggle('hidden', name !== 'connect');
  screenScan.classList.toggle('hidden', name !== 'scan');
  screenPermission.classList.toggle('hidden', name !== 'permission');
  screenChat.classList.toggle('hidden', name !== 'chat');
  settings.classList.toggle('hidden', !(name === 'chat' && state.settingsOpen));
  sessionsPage.classList.toggle('hidden', !(name === 'chat' && state.sessionsOpen));
  renderBlankHero();
  scheduleNativeSnapshot();
}

function openSessionsPage() {
  if (navigationBusy()) return;
  state.pickerSheet = '';
  state.pickerPage = '';
  state.attachOpen = false;
  state.newSession = null;
  state.history = null;
  state.sessionMenu = '';
  state.workspaceMenu = '';
  state.gitDialog = '';
  clearExclusiveDialogs();
  renderSheet(); renderDialog();
  setDrawerOpen(false);
  state.sessionsOpen = true;
  renderSessions();
  renderScreen();
}

function currentRow() {
  const live = state.sessions.find((row) => row.sessionId === state.sessionId);
  if (live) return live;
  if (state.heldSession?.sessionId === state.sessionId) return state.heldSession;
  return undefined;
}

function promoteHeldLive() {
  state.sessions = withHeldLiveRow(state.sessions, state.heldSession);
}

function syncRunning() {
  state.running = currentRow()?.running === true;
  sendBtn.classList.remove('hidden');
  sendBtn.setAttribute('aria-label', state.running ? '加入队列' : '发送消息');
  stopBtn.classList.toggle('hidden', !state.running);
  // Border beam on the composer capsule while the agent is thinking/streaming
  // (desktop InputBar `cardBeam`).
  composer.classList.toggle('is-running', state.running);
}

function currentModeState() {
  const current = state.permission.current;
  return {
    modes: DEFAULT_PRESETS,
    currentModeId: current || null,
    currentLabel: permissionLabel(current) || '权限',
  };
}

function currentModelState() {
  const { current, rows } = state.modelCatalog;
  // `current` may be replaced by selectModel echoes that omit capability
  // fields; resolve supportsImages from the matching catalog row each time.
  const row = current
    ? (Array.isArray(rows) ? rows : []).find((item) => item.provider === current.provider && item.id === current.model)
    : null;
  return {
    modelId: current?.model || null,
    label: modelChipLabel(current, rows),
    current: current ? { ...current, supportsImages: row ? row.supportsImages : current.supportsImages } : null,
  };
}

/** Subagent and archived sessions open read-only; the composer is hidden. */
function currentReadOnlyReason() {
  const row = currentRow();
  if (!row || !isReadOnlyRow(row)) return '';
  if (row.archived === true) {
    return '已归档会话（只读）。可在「已归档会话」里取消归档。';
  }
  return '子智能体会话（只读）。由父会话驱动，不能直接发消息。';
}

function renderComposer({ nativeSnapshot = true } = {}) {
  composerBehavior.refresh();
  const canSend = Boolean(draft.value.trim()) || state.attachments.length > 0;
  sendBtn.disabled = !canSend || composerOffline() || state.sendBusy;
  buttonBusy(sendBtn, state.sendBusy, { iconOnly: true, label: '正在发送消息…' });
  const choiceDisabled = !state.sessionId || composerOffline() || Boolean(currentReadOnlyReason());
  accessChip.disabled = choiceDisabled;
  modelChip.disabled = choiceDisabled;
  const choiceHint = !state.sessionId ? '先打开或新建一个会话' : composerOffline() ? '等待连接恢复' : currentReadOnlyReason();
  const accessLabel = currentModeState().currentLabel || '权限';
  // #access-chip's first child is a whitespace text node; the visually-hidden
  // .chip-label span is the label slot (the shield icon stays visible alone).
  accessChip.querySelector('.chip-label').textContent = accessLabel;
  accessChip.title = choiceDisabled ? choiceHint : `权限：${accessLabel}`;
  accessChip.setAttribute('aria-label', `权限：${accessLabel}`);
  const modelLabel = currentModelState().label || '模型';
  // The label span (not a bare text node) is what lets the chip ellipsize
  // "model · effort" on a narrow phone instead of wrapping the tool row.
  modelChip.querySelector('.chip-label').textContent = modelLabel;
  modelChip.title = choiceDisabled ? choiceHint : modelLabel;
  modelChip.setAttribute('aria-label', choiceDisabled ? `模型：${choiceHint}` : `模型：${modelLabel}`);
  planChip.classList.toggle('hidden', !state.permission.planOn || Boolean(currentReadOnlyReason()));
  attachRail.classList.toggle('hidden', state.attachments.length === 0);
  attachRail.replaceChildren(...state.attachments.map((image, index) => {
    const wrap = document.createElement('div');
    wrap.className = 'attach-thumb';
    const img = document.createElement('img');
    img.src = `data:${image.mediaType};base64,${image.data}`;
    img.alt = '附件图片';
    img.addEventListener('click', () => {
      state.lightbox = image;
      renderLightbox();
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'attach-remove';
    remove.setAttribute('aria-label', '移除附件');
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      state.attachments.splice(index, 1);
      draftStore?.saveAttachments(state.sessionId, state.attachments);
      if (state.lightbox && !state.attachments.includes(state.lightbox)) {
        state.lightbox = null;
        renderLightbox();
      }
      renderComposer();
    });
    wrap.append(img, remove);
    return wrap;
  }));
  if (nativeSnapshot) scheduleNativeSnapshot();
}

function headerHostLabel() {
  const row = currentRow();
  if (row?.workspaceTitle) return row.workspaceTitle;
  if (row?.cwd) return row.cwd;
  const chip = blankWorkspaceChip?.textContent?.trim();
  if (chip && chip !== '工作区') return chip;
  const first = state.workspaces?.items?.find((item) => item?.title);
  if (first?.title) return first.title;
  return '已连接';
}

function renderHeader() {
  const row = currentRow();
  chatTitle.textContent = row ? sessionTitle(row) : '新会话';
  hostLine.textContent = headerHostLabel();
  phone.dataset.sessionId = row?.sessionId || '';
  const showPill = store.gitTitle && (state.gitStatus.refName != null || state.gitStatus.isRepo === false);
  gitPill.classList.toggle('hidden', !showPill);
  // The center slot is either the Git pill or the session title, never both.
  chatTitle.classList.toggle('hidden', showPill);
  if (showPill) {
    const hasRef = state.gitStatus.refName != null;
    gitPillLabel.textContent = hasRef ? state.gitStatus.refName : 'Initialize Git';
    gitPillCount.textContent = hasRef && state.gitStatus.aheadCount > 0 ? `↑${state.gitStatus.aheadCount}` : '';
  }
  syncRunning();
  scheduleNativeSnapshot();
}

function sessionRowNode(row, { child = false, subagentTag = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = `session-row${child ? ' session-child' : ''}`;
  if (row.sessionId) wrap.dataset.sessionId = row.sessionId;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `session${row.sessionId === state.sessionId ? ' active' : ''}`;
  const title = document.createElement('b');
  title.textContent = sessionTitle(row);
  const meta = document.createElement('span');
  meta.className = 'session-meta';
  meta.textContent = [
    child || subagentTag ? '子智能体' : '',
    row.running ? '运行中' : '',
    row.searchSnippet || '',
  ].filter(Boolean).join(' · ');
  const status = row.sessionId === state.sessionId && state.pendingApprovals.length
    ? 'wait' : row.running ? 'run' : '';
  wrap.dataset.state = status;
  const dot = document.createElement('span');
  dot.className = 'session-state';
  dot.setAttribute('aria-hidden', 'true');
  button.append(dot, title);
  if (meta.textContent) button.append(meta);
  button.setAttribute('aria-label', [sessionTitle(row), meta.textContent, status === 'wait' ? '等待审批' : ''].filter(Boolean).join(' · '));
  button.addEventListener('click', () => {
    if (row.archived) return;
    openSession(row.sessionId).catch((error) => showBanner(error.message));
  });
  wrap.append(button);
  if (state.transport === 'chisacode') {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'session-more';
    more.setAttribute('aria-label', '会话操作');
    more.textContent = '⋯';
    more.addEventListener('click', (event) => {
      event.stopPropagation();
      clearExclusiveDialogs();
      state.sessionMenu = row.sessionId;
      renderSheet();
      renderDialog();
    });
    wrap.append(more);
  }
  return wrap;
}

const FOLDER_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3.1a1 1 0 0 1 .7.3l1 1a1 1 0 0 0 .7.3h3.5A1.5 1.5 0 0 1 14 6.1v5.4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
const CHEVRON_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M4.5 2.5 8 6l-3.5 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function svgNode(markup) {
  const template = document.createElement('template');
  template.innerHTML = markup;
  return template.content.firstElementChild;
}

function workspaceHeadNode(workspace, { count = 0 } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'session-row workspace-head';
  if (workspace.workspaceId) wrap.dataset.workspaceId = workspace.workspaceId;
  const expanded = state.expandedWorkspaces[workspace.workspaceId] !== false;
  wrap.dataset.expanded = expanded ? 'true' : 'false';
  const expand = document.createElement('button');
  expand.type = 'button';
  expand.className = 'session workspace-toggle';
  expand.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  expand.setAttribute('aria-label', `${expanded ? '折叠' : '展开'}工作区 ${workspace.title || workspace.path || ''}`.trim());
  const lead = document.createElement('span');
  lead.className = 'workspace-lead';
  const chevron = svgNode(CHEVRON_ICON_SVG);
  chevron.classList.add('workspace-chevron');
  const folder = svgNode(FOLDER_ICON_SVG);
  folder.classList.add('workspace-folder');
  lead.append(chevron, folder);
  const text = document.createElement('span');
  text.className = 'workspace-text';
  const title = document.createElement('b');
  title.textContent = workspace.title || workspace.path || workspace.workspaceId;
  const path = document.createElement('span');
  path.className = 'workspace-path';
  path.textContent = workspace.path || '无工作区文件夹';
  path.title = workspace.path || '无工作区文件夹';
  text.append(title, path);
  expand.append(lead, text);
  if (count > 0) {
    const badge = document.createElement('span');
    badge.className = 'workspace-count';
    badge.textContent = String(count);
    expand.append(badge);
  }
  expand.addEventListener('click', () => {
    state.expandedWorkspaces[workspace.workspaceId] = !expanded;
    renderSessions();
  });
  wrap.append(expand);
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'session-more';
  add.setAttribute('aria-label', '在此工作区新建会话');
  add.textContent = '+';
  add.addEventListener('click', (event) => {
    event.stopPropagation();
    void createWorkspaceSession(workspace.workspaceId);
  });
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'session-more';
  more.setAttribute('aria-label', '工作区操作');
  more.textContent = '⋯';
  more.addEventListener('click', (event) => {
    event.stopPropagation();
    clearExclusiveDialogs();
    state.workspaceMenu = workspace.workspaceId;
    renderSheet();
    renderDialog();
  });
  wrap.append(add, more);
  return wrap;
}

function drawerFootButton(label, { disabled = false, onClick }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'session-list-action';
  button.disabled = disabled;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function appendGroupedRows(nodes, rows, { inWorkspace = false } = {}) {
  const walk = (node, { child = false } = {}) => {
    const rowNode = sessionRowNode(node.row, { child, subagentTag: node.orphanSubagent });
    if (inWorkspace) rowNode.classList.add('in-workspace');
    nodes.push(rowNode);
    for (const kid of node.children || []) walk(kid, { child: true });
  };
  for (const node of sessionRowForest(rows)) walk(node);
}

function renderSessions() {
  const query = state.query.trim();
  // Blank rows may enter state.sessions live via host/session-added; the
  // desktop reuses blank as New Session, so the drawer hides them until a
  // title or first turn lands (LIST-006).
  const rows = state.sessions.filter((row) => !row.archived && !isUntitledBlank(row));
  const nodes = [];
  sessionList.classList.toggle('surface-busy', state.searchLoading);
  sessionList.setAttribute('aria-busy', String(state.searchLoading));
  // On the full-screen sessions page each group's rows live inside one card;
  // the group head stays outside on the canvas.
  const cardOfRows = (rowNodes) => {
    const card = document.createElement('div');
    card.className = 'card list-card';
    card.append(...rowNodes);
    return card;
  };
  const collectRows = (rows, options) => {
    const sink = [];
    appendGroupedRows(sink, rows, options);
    return sink;
  };
  if (query) {
    const hits = Array.isArray(state.searchHits) ? state.searchHits : [];
    if (!state.searchLoading && !hits.length) {
      nodes.push(descNode('没有匹配的会话'));
    } else if (!state.searchLoading) {
      nodes.push(cardOfRows(hits.map((hit) => sessionRowNode(hit, { subagentTag: isReadOnlyRow(hit) }))));
      if (state.searchHasMore) {
        nodes.push(descNode('还有更多结果，请改用更精确的词'));
      }
    }
  } else if (state.sessionView === 'grouped') {
    const { sections, ungrouped } = workspaceDrawerSections(rows, state.workspaces);
    for (const section of sections) {
      const group = document.createElement('div');
      group.className = 'ws-group';
      group.append(workspaceHeadNode(section.workspace, { count: section.rows.length }));
      if (state.expandedWorkspaces[section.workspace.workspaceId] !== false) {
        group.append(cardOfRows(collectRows(section.rows, { inWorkspace: true })));
      }
      nodes.push(group);
    }
    if (ungrouped.length) {
      const group = document.createElement('div');
      group.className = 'ws-group';
      if (sections.length) group.append(descNode('无工作区文件夹', 'row-desc session-section-label'));
      group.append(cardOfRows(collectRows(ungrouped)));
      nodes.push(group);
    }
  } else {
    nodes.push(cardOfRows(collectRows(rows)));
  }
  if (state.transport === 'chisacode' && !query) {
    nodes.push(drawerFootButton(
      state.sessionView === 'grouped' ? '一个列表' : '按工作区分组',
      {
        onClick: () => {
          state.sessionView = state.sessionView === 'grouped' ? 'flat' : 'grouped';
          renderSessions();
        },
      },
    ));
    nodes.push(drawerFootButton('已归档会话', { onClick: () => openHistorySheet() }));
  }
  sessionList.replaceChildren(...nodes);
  renderDrawer(rows);
  scheduleNativeSnapshot();
}

/** The sidebar mirrors the desktop workspace tree and keeps every row action. */
function renderDrawer(visibleRows) {
  const rows = Array.isArray(visibleRows)
    ? visibleRows
    : state.sessions.filter((row) => !row.archived && !isUntitledBlank(row));
  navSessionsCount.textContent = String(rows.length);
  const host = (state.hostName || '我的电脑').trim() || '我的电脑';
  drawerAvatar.textContent = host.charAt(0);
  drawerAccountName.textContent = host;
  drawerAccount.title = `${host} · 连接详情`;
  drawerStatus.replaceChildren();
  const busy = state.catalogBusy === true;
  drawerDirectory.classList.toggle('surface-busy', busy);
  drawerDirectory.setAttribute('aria-busy', String(busy));
  const nodes = [];
  const { sections, ungrouped } = workspaceDrawerSections(rows, state.workspaces);
  for (const section of sections) {
    const group = document.createElement('div');
    group.className = 'drawer-workspace';
    group.append(workspaceHeadNode(section.workspace, { count: section.rows.length }));
    if (state.expandedWorkspaces[section.workspace.workspaceId] !== false) {
      const children = [];
      appendGroupedRows(children, section.rows, { inWorkspace: true });
      if (children.length) group.append(...children);
      else group.append(descNode('暂无会话', 'row-desc drawer-empty'));
    }
    nodes.push(group);
  }
  if (ungrouped.length) {
    nodes.push(descNode('无工作区文件夹', 'row-desc session-section-label'));
    appendGroupedRows(nodes, ungrouped);
  }
  if (!busy && !sections.length && !ungrouped.length && !state.sessionsError) {
    nodes.push(descNode('还没有会话，选择工作区或开始新会话。', 'row-desc drawer-empty'));
  }
  if (state.sessionsError) {
    const retry = drawerFootButton('重试加载会话', { disabled: busy, onClick: () => runReconnectResync() });
    retry.title = state.sessionsError;
    nodes.push(retry);
  }
  if (state.transport === 'chisacode') {
    nodes.push(drawerFootButton('已归档会话', { onClick: () => openHistorySheet() }));
  }
  const scroll = drawerDirectory.scrollTop;
  drawerDirectory.replaceChildren(...nodes);
  drawerDirectory.scrollTop = scroll;
}

async function runSessionSearch(query) {
  const paired = state.chisacode;
  if (!paired || !query) {
    state.searchHits = null;
    state.searchHasMore = false;
    state.searchLoading = false;
    renderSessions();
    return;
  }
  state.searchLoading = true;
  renderSessions();
  try {
    const result = await hostCall(paired.client, 'session.search', { query, limit: 20 });
    if (state.chisacode !== paired || state.query.trim() !== query) return;
    const byId = new Map(state.sessions.map((row) => [row.sessionId, row]));
    const items = Array.isArray(result.items) ? result.items : [];
    state.searchHits = items.slice(0, 20).map((item) => ({
      ...(byId.get(item.sessionId) || { sessionId: item.sessionId, projections: { values: {} } }),
      searchSnippet: item.snippet || '',
    }));
    state.searchHasMore = result.hasMore === true || items.length > 20;
    state.searchLoading = false;
    renderSessions();
  } catch (error) {
    if (state.chisacode !== paired) return;
    state.searchLoading = false;
    state.searchHits = [];
    state.searchHasMore = false;
    state.banner = `搜索失败：${error?.message || '电脑没有响应'}`;
    operationError(state.banner, () => runSessionSearch(state.query.trim()));
    renderSessions();
  }
}

// —— 安全 Markdown 渲染：结构化 block/span → createElement/textContent —— //

function markdownSpanNodes(spans) {
  return (spans || []).map((span) => {
    if (span.kind === 'code') {
      const code = document.createElement('code');
      code.textContent = span.text;
      return code;
    }
    if (span.kind === 'strong') {
      const strong = document.createElement('strong');
      strong.textContent = span.text;
      return strong;
    }
    if (span.kind === 'em') {
      const em = document.createElement('em');
      em.textContent = span.text;
      return em;
    }
    if (span.kind === 'link') {
      const link = document.createElement('a');
      link.textContent = span.text;
      link.href = span.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      return link;
    }
    return document.createTextNode(span.text);
  });
}

function renderMarkdownInto(node, text) {
  for (const block of parseMarkdown(text)) {
    if (block.kind === 'code') {
      const pre = document.createElement('pre');
      pre.className = 'md-code';
      const code = document.createElement('code');
      code.textContent = block.text;
      pre.append(code);
      node.append(pre);
      continue;
    }
    if (block.kind === 'heading') {
      const heading = document.createElement(`h${Math.min(block.level + 3, 6)}`);
      heading.className = 'md-heading';
      heading.append(...markdownSpanNodes(block.spans));
      node.append(heading);
      continue;
    }
    if (block.kind === 'list') {
      const list = document.createElement(block.ordered ? 'ol' : 'ul');
      list.className = 'md-list';
      for (const item of block.items) {
        const li = document.createElement('li');
        li.append(...markdownSpanNodes(item));
        list.append(li);
      }
      node.append(list);
      continue;
    }
    if (block.kind === 'quote') {
      const quote = document.createElement('blockquote');
      quote.className = 'md-quote';
      quote.append(...markdownSpanNodes(block.spans));
      node.append(quote);
      continue;
    }
    const paragraph = document.createElement('p');
    paragraph.append(...markdownSpanNodes(block.spans));
    node.append(paragraph);
  }
}

// —— 流程行（对应桌面 ui-tool ToolRow / ui-chat ReasoningRow / TurnProcessNodeView） —— //

const FLOW_ICONS = {
  think: '<svg viewBox="0 0 16 16" fill="none"><path d="M8 1.75a4.25 4.25 0 0 1 2.4 7.76c-.4.28-.65.7-.65 1.17V11H6.25v-.32c0-.47-.25-.9-.65-1.17A4.25 4.25 0 0 1 8 1.75Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M6.5 13h3M7 14.5h2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  search: '<svg viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.25" stroke="currentColor" stroke-width="1.2"/><path d="m10.2 10.2 3.3 3.3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  read: '<svg viewBox="0 0 16 16" fill="none"><path d="M4 1.75h5.2L13 5.55V13.25a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.75a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M9 1.75V5.5h4M5.5 8.5h5M5.5 11h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  bash: '<svg viewBox="0 0 16 16" fill="none"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="m4.5 6 2 2-2 2M8 10h3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  write: '<svg viewBox="0 0 16 16" fill="none"><path d="M4 1.75h5.2L13 5.55V13.25a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.75a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M8 7v5M5.5 9.5h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  edit: '<svg viewBox="0 0 16 16" fill="none"><path d="m10.6 2.4 3 3-7.7 7.7-3.6.6.6-3.6 7.7-7.7Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="m9.2 3.8 3 3" stroke="currentColor" stroke-width="1.2"/></svg>',
  code: '<svg viewBox="0 0 16 16" fill="none"><path d="m5 4.5-3.5 3.5L5 11.5M11 4.5l3.5 3.5-3.5 3.5M9.3 2.5 6.7 13.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  others: '<svg viewBox="0 0 16 16" fill="none"><path d="M9.3 2.2a3.4 3.4 0 0 0 4.2 4.3l-6.9 6.9a1.6 1.6 0 1 1-2.3-2.3l6.9-6.9Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  subagent: '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5" r="2.5" stroke="currentColor" stroke-width="1.2"/><path d="M3.5 13.5a4.5 4.5 0 0 1 9 0" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  chevron: '<svg viewBox="0 0 16 16" fill="none"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

/** Which rows / disclosures the user has opened, keyed by row id. */
const flowOpen = new Set();

function flowIcon(kind) {
  const node = svgNode(FLOW_ICONS[kind] || FLOW_ICONS.others);
  node.setAttribute('width', '14');
  node.setAttribute('height', '14');
  node.setAttribute('aria-hidden', 'true');
  node.classList.add('flow-icon');
  return node;
}

function firstLineOf(text) {
  const value = String(text || '');
  const nl = value.indexOf('\n');
  return nl === -1 ? value : value.slice(0, nl);
}

function latestLineOf(text) {
  const value = String(text || '').trimEnd();
  const nl = value.lastIndexOf('\n');
  return nl === -1 ? value : value.slice(nl + 1);
}

/**
 * Shared disclosure chrome: [state dot] [icon] title · summary ▾, expanding
 * to `body`. `state` is running / ok / error / stopped (desktop StateDot).
 */
function flowRowNode({ id, icon, title, summary, state, body, variant = '', extraClass = '', defaultOpen = false }) {
  const node = document.createElement('div');
  node.className = `flow-row ${extraClass}`.trim();
  node.dataset.state = state;
  if (variant) node.dataset.variant = variant;
  const open = flowOpen.has(id) || (defaultOpen && !flowOpen.has(`closed:${id}`));
  node.dataset.open = open ? 'true' : 'false';
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'flow-head';
  head.setAttribute('aria-expanded', open ? 'true' : 'false');
  const lead = document.createElement('span');
  lead.className = 'flow-lead';
  const dot = document.createElement('span');
  dot.className = 'state-dot';
  dot.dataset.state = state;
  lead.append(dot, flowIcon(icon));
  const titleNode = document.createElement('span');
  titleNode.className = 'flow-title';
  titleNode.textContent = title;
  head.append(lead, titleNode);
  if (summary) {
    const sep = document.createElement('span');
    sep.className = 'flow-sep';
    const summaryNode = document.createElement('span');
    summaryNode.className = 'flow-summary';
    summaryNode.textContent = summary;
    if (state === 'running' && icon === 'think') summaryNode.dataset.followEnd = 'true';
    head.append(sep, summaryNode);
  }
  if (body) {
    const chevron = flowIcon('chevron');
    chevron.classList.add('flow-chevron');
    head.append(chevron);
    head.addEventListener('click', () => {
      const next = node.dataset.open !== 'true';
      if (next) {
        flowOpen.add(id);
        flowOpen.delete(`closed:${id}`);
      } else {
        flowOpen.delete(id);
        flowOpen.add(`closed:${id}`);
      }
      node.dataset.open = next ? 'true' : 'false';
      head.setAttribute('aria-expanded', next ? 'true' : 'false');
      body.classList.toggle('hidden', !next);
    });
  } else {
    head.classList.add('is-static');
  }
  node.append(head);
  if (body) {
    body.classList.add('flow-body');
    body.classList.toggle('hidden', !open);
    node.append(body);
  }
  // The running summary follows its tail like the desktop Think row.
  if (state === 'running' && icon === 'think') {
    requestAnimationFrame(() => {
      const summaryNode = head.querySelector('.flow-summary');
      if (summaryNode) summaryNode.scrollLeft = summaryNode.scrollWidth;
    });
  }
  return node;
}

function codeBlockNode(text, { className = '', maxLines = 0 } = {}) {
  const pre = document.createElement('pre');
  pre.className = `flow-code ${className}`.trim();
  const lines = String(text ?? '').split('\n');
  if (maxLines > 0 && lines.length > maxLines) {
    pre.textContent = lines.slice(0, maxLines).join('\n');
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'flow-more';
    more.textContent = `还有 ${lines.length - maxLines} 行`;
    more.addEventListener('click', () => {
      pre.textContent = lines.join('\n');
      more.remove();
    });
    const wrap = document.createElement('div');
    wrap.className = 'flow-code-wrap';
    wrap.append(pre, more);
    return wrap;
  }
  pre.textContent = lines.join('\n');
  return pre;
}

function labeledBlock(label, child) {
  const wrap = document.createElement('div');
  wrap.className = 'flow-section';
  const head = document.createElement('p');
  head.className = 'flow-section-label';
  head.textContent = label;
  wrap.append(head, child);
  return wrap;
}

/** Terminal card: prompt row + output (desktop TerminalBlock, simplified). */
function terminalCardNode(command, output, state) {
  const card = document.createElement('div');
  card.className = 'term-card';
  const prompt = document.createElement('div');
  prompt.className = 'term-prompt';
  const sign = document.createElement('span');
  sign.className = 'term-sign';
  sign.textContent = '$';
  const cmd = document.createElement('code');
  cmd.textContent = command || '';
  prompt.append(sign, cmd);
  card.append(prompt);
  if (output) {
    card.append(codeBlockNode(output, { className: 'term-output', maxLines: 12 }));
  } else if (state === 'running') {
    const wait = document.createElement('p');
    wait.className = 'term-wait';
    wait.textContent = '正在运行…';
    card.append(wait);
  }
  return card;
}

/** Diff card: removed / added lines from the intended mutation (desktop DiffBlock, simplified). */
function diffCardNode(diff) {
  const card = document.createElement('div');
  card.className = 'diff-card';
  const path = document.createElement('p');
  path.className = 'diff-path';
  path.textContent = diff.path;
  card.append(path);
  const lines = lineDiff(diff.oldText, diff.newText);
  const body = document.createElement('div');
  body.className = 'diff-body';
  const MAX = 24;
  const shown = lines.slice(0, MAX);
  for (const line of shown) {
    const row = document.createElement('div');
    row.className = `diff-line ${line.kind}`;
    const sign = document.createElement('span');
    sign.className = 'diff-sign';
    sign.textContent = line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' ';
    const text = document.createElement('span');
    text.className = 'diff-text';
    text.textContent = line.text;
    row.append(sign, text);
    body.append(row);
  }
  card.append(body);
  if (lines.length > MAX) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'flow-more';
    more.textContent = `还有 ${lines.length - MAX} 行`;
    more.addEventListener('click', () => {
      for (const line of lines.slice(MAX)) {
        const row = document.createElement('div');
        row.className = `diff-line ${line.kind}`;
        const sign = document.createElement('span');
        sign.className = 'diff-sign';
        sign.textContent = line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' ';
        const text = document.createElement('span');
        text.className = 'diff-text';
        text.textContent = line.text;
        row.append(sign, text);
        body.append(row);
      }
      more.remove();
    });
    card.append(more);
  }
  const adds = lines.filter((l) => l.kind === 'add').length;
  const dels = lines.filter((l) => l.kind === 'del').length;
  const stat = document.createElement('span');
  stat.className = 'diff-stat';
  stat.textContent = `+${adds} −${dels}`;
  path.append(stat);
  return card;
}

function toolRowNode(row) {
  // ChisaCode projected items carry a pre-digested `detail`; raw dsh events carry `call`.
  if (!row.call) return legacyToolRowNode(row);
  const model = toolRowModel(row.call, { cwd: state.cwd });
  const body = document.createElement('div');
  if (model.variant === 'bash') {
    body.append(terminalCardNode(model.body || model.summary, model.output, model.state));
  } else if (model.diff && (model.variant === 'edit' || model.variant === 'write')) {
    body.append(diffCardNode(model.diff));
    if (model.state === 'error' && model.output) body.append(labeledBlock('结果', codeBlockNode(model.output, { maxLines: 12 })));
  } else {
    if (model.body) body.append(labeledBlock('输入', codeBlockNode(model.body, { maxLines: 12 })));
    if (model.output) body.append(labeledBlock(model.state === 'error' ? '错误' : '结果', codeBlockNode(model.output, { maxLines: 16 })));
  }
  const hasBody = body.childNodes.length > 0;
  return flowRowNode({
    id: `tool:${row.id}`,
    icon: model.subagent ? 'subagent' : model.variant,
    title: model.subagent ? '子智能体' : model.title,
    summary: model.state === 'error' && model.errorSummary ? model.errorSummary : model.summary,
    state: model.state,
    variant: model.variant,
    extraClass: 'tool-row',
    body: hasBody ? body : null,
  });
}

/** ChisaCode projected `tool_call` items (Android parity path). */
function legacyToolRowNode(row) {
  const state = row.status === 'failed' ? 'error' : row.status === 'running' ? 'running' : row.status === 'canceled' ? 'stopped' : 'ok';
  const detail = row.detail;
  let body = null;
  if (detail?.body) {
    body = document.createElement('div');
    if (detail.bodyKind === 'markdown') renderMarkdownInto(body, detail.body);
    else body.append(codeBlockNode(detail.body, { maxLines: 16 }));
  }
  return flowRowNode({
    id: `tool:${row.id}`,
    icon: 'others',
    title: row.text || '工具调用',
    summary: detail?.summary || row.card || '',
    state,
    extraClass: 'tool-row',
    body,
  });
}

function reasoningRowNode(row) {
  const running = row.running === true;
  const body = document.createElement('div');
  const text = document.createElement('div');
  text.className = 'think-body';
  text.textContent = row.text;
  body.append(text);
  return flowRowNode({
    id: `think:${row.id}`,
    icon: 'think',
    title: '思考',
    summary: running ? latestLineOf(row.text) : firstLineOf(row.text),
    state: running ? 'running' : 'ok',
    extraClass: 'think-row',
    body: row.text ? body : null,
  });
}

function turnProcessNode(group) {
  const labels = [];
  if (group.toolCalls > 0) labels.push(`${group.toolCalls} 次工具调用`);
  if (group.messages > 0) labels.push(`${group.messages} 条消息`);
  if (group.subagents > 0) labels.push(`${group.subagents} 个 subagent`);
  const label = labels.length ? labels.join(' · ') : '已思考';
  const node = document.createElement('div');
  node.className = 'turn-process';
  const open = flowOpen.has(group.id);
  node.dataset.open = open ? 'true' : 'false';
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'turn-process-head';
  head.setAttribute('aria-expanded', open ? 'true' : 'false');
  const text = document.createElement('span');
  text.className = 'turn-process-label';
  text.textContent = label;
  const chevron = flowIcon('chevron');
  chevron.classList.add('flow-chevron');
  head.append(text, chevron);
  const body = document.createElement('div');
  body.className = 'turn-process-body';
  body.classList.toggle('hidden', !open);
  for (const row of group.rows) body.append(logRowNode(row));
  head.addEventListener('click', () => {
    const next = node.dataset.open !== 'true';
    if (next) flowOpen.add(group.id);
    else flowOpen.delete(group.id);
    node.dataset.open = next ? 'true' : 'false';
    head.setAttribute('aria-expanded', next ? 'true' : 'false');
    body.classList.toggle('hidden', !next);
  });
  node.append(head, body);
  return node;
}

function logRowNode(row) {
  if (row.role === 'tool') {
    return toolRowNode(row);
  }
  if (row.role === 'turn-process') {
    return turnProcessNode(row);
  }
  if (row.role === 'reasoning') {
    return reasoningRowNode(row);
  }
  const node = document.createElement('div');
  if (row.role === 'user') {
    node.className = 'user';
    if (row.images?.length) {
      const gallery = document.createElement('div');
      gallery.className = 'bubble-images';
      for (const image of row.images) {
        const img = document.createElement('img');
        img.className = row.images.length === 1 ? 'solo' : 'multi';
        img.src = `data:${image.mediaType};base64,${image.data}`;
        img.alt = '消息图片';
        img.addEventListener('click', () => {
          state.lightbox = image;
          renderLightbox();
        });
        gallery.append(img);
      }
      node.append(gallery);
    }
    if (row.text) {
      const text = document.createElement('span');
      text.textContent = row.text;
      node.append(text);
    }
    return node;
  }
  if (row.role === 'error') {
    node.className = 'turn-error';
    const dot = document.createElement('span');
    dot.className = 'state-dot';
    dot.dataset.state = 'error';
    const main = document.createElement('span');
    main.className = 'turn-error-main';
    if (row.title) {
      const title = document.createElement('b');
      title.textContent = row.title;
      main.append(title, document.createTextNode(' '));
    }
    main.append(document.createTextNode(row.text));
    if (row.code) {
      const code = document.createElement('code');
      code.className = 'turn-error-code';
      code.textContent = row.code;
      main.append(document.createTextNode(' '), code);
    }
    node.append(dot, main);
    return node;
  }
  if (row.role === 'todo') {
    node.className = 'todo-card';
    const heading = document.createElement('p');
    heading.className = 'todo-title';
    heading.textContent = '待办';
    node.append(heading);
    for (const item of row.items || []) {
      const line = document.createElement('p');
      line.className = `todo-item${item.completed ? ' done' : ''}`;
      line.textContent = `${item.completed ? '✓' : '○'} ${item.text}`;
      node.append(line);
    }
    return node;
  }
  if (row.role === 'changes') {
    node.className = 'changes-card';
    const heading = document.createElement('p');
    heading.className = 'todo-title';
    heading.textContent = row.text || '本轮改动';
    node.append(heading);
    for (const file of row.files || []) {
      const line = document.createElement('p');
      line.className = 'changes-file';
      const counts = [
        Number.isInteger(file.additions) ? `+${file.additions}` : '',
        Number.isInteger(file.deletions) ? `-${file.deletions}` : '',
      ].filter(Boolean).join(' ');
      line.textContent = counts ? `${file.path} · ${counts}` : file.path;
      node.append(line);
    }
    return node;
  }
  if (row.role === 'meta') {
    node.className = 'meta-row';
    node.textContent = row.text;
    return node;
  }
  node.className = 'assistant';
  if (row.running) node.dataset.streaming = 'true';
  renderMarkdownInto(node, row.text || '');
  return node;
}

/**
 * @param {{ anchor?: 'auto' | 'bottom' | 'preserve' | 'hold' }} options
 * 'preserve' keeps the visual scroll position across a prepend (load-older),
 * 'bottom' follows the newest message, 'hold' keeps scrollTop as-is across an
 * append, and 'auto' (default) resolves to 'bottom' only when the viewport
 * was already at the bottom — stream events must not pull a user reading
 * history back down.
 */
function renderLog({ anchor = 'auto' } = {}) {
  // The session row's live `running` beats the event log while a turn is
  // streaming (mux status frames land before the closing history pull).
  const rows = groupTurns(foldEvents(state.events), { running: state.running === true ? true : null });
  const placeholder = Boolean(state.timelineError) || state.timelineLoading;
  blankEl.classList.toggle('hidden', rows.length > 0 || placeholder);
  logEl.classList.toggle('hidden', rows.length === 0 && !placeholder);
  const prevHeight = logEl.scrollHeight;
  const prevTop = logEl.scrollTop;
  const resolved = resolveLogAnchor({
    anchor,
    scrollTop: prevTop,
    scrollHeight: prevHeight,
    clientHeight: logEl.clientHeight,
  });
  const nodes = [];
  logEl.classList.toggle('surface-busy', state.timelineLoading && !rows.length);
  logEl.setAttribute('aria-busy', String(state.timelineLoading));
  if (!state.timelineError && state.transport === 'chisacode' && state.timelinePage.hasOlder) {
    const older = document.createElement('button');
    older.type = 'button';
    older.className = 'load-older';
    older.disabled = state.timelineLoadingOlder;
    older.textContent = '加载更早消息';
    buttonBusy(older, state.timelineLoadingOlder, { label: '加载中…' });
    older.addEventListener('click', () => loadOlderMessages());
    nodes.push(older);
  }
  if (!state.timelineError) {
    nodes.push(...rows.map(logRowNode));
  }
  clearButtonBusy(logEl);
  logEl.replaceChildren(...nodes);
  renderBlankHero();
  scheduleNativeSnapshot();
  if (!rows.length) return;
  if (resolved === 'preserve') {
    logEl.scrollTop = prevTop + (logEl.scrollHeight - prevHeight);
  } else if (resolved === 'hold') {
    logEl.scrollTop = prevTop;
  } else {
    logEl.scrollTop = logEl.scrollHeight;
  }
}

async function loadOlderMessages() {
  const paired = state.chisacode;
  const sessionId = state.sessionId;
  const page = state.timelinePage;
  if (!paired || !sessionId || !page.hasOlder || state.timelineLoadingOlder) return;
  state.timelineLoadingOlder = true;
  renderLog({ anchor: 'preserve' });
  try {
    const payload = await hostCall(paired.client, 'session.history', historyQuery(sessionId, {
      beforeSeq: page.beforeSeq,
    }));
    if (state.chisacode !== paired || state.sessionId !== sessionId) return;
    const older = hostHistoryPage(payload);
    state.events = mergeOlderHistory(older.events, state.events);
    state.timelinePage = { hasOlder: older.hasOlder, beforeSeq: older.beforeSeq };
    state.timelineLoadingOlder = false;
    renderLog({ anchor: 'preserve' });
  } catch (error) {
    if (state.chisacode !== paired || state.sessionId !== sessionId) return;
    state.timelineLoadingOlder = false;
    renderLog({ anchor: 'preserve' });
    state.banner = `无法加载更早消息：${error?.message || '电脑没有响应'}`;
    operationError(state.banner, loadOlderMessages);
  }
}

function approvalActionButton(label, className, onClick, actionId) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.dataset.approvalAction = actionId;
  button.addEventListener('click', onClick);
  return button;
}

/**
 * The composer area is one of: read-only note (subagent/archived), the first
 * pending daemon approval (with the daemon's own action list), or the
 * composer form.
 */
function renderApproval() {
  const readOnly = currentReadOnlyReason();
  const pending = readOnly ? null : state.pendingApprovals[0] || null;
  readonlyNote.textContent = readOnly;
  readonlyNote.classList.toggle('hidden', !readOnly);
  composer.classList.toggle('hidden', Boolean(pending) || Boolean(readOnly));
  approval.classList.toggle('hidden', !pending);
  // Always re-render the slash popup: it must hide itself when an approval
  // arrives mid-typing and may return once the approval resolves.
  renderSlashPop();
  scheduleNativeSnapshot();
  if (!pending) return;
  approvalTitle.textContent = pending.title || '需要审批';
  approvalCommand.textContent = pending.command || '';
  el('approval-error').textContent = '';
  el('approval-error').classList.add('hidden');
  const buttons = [];
  if (pending.legacy) {
    buttons.push(
      approvalActionButton('拒绝', 'ghost-btn', () => {
        answerLegacyApproval('rejected', pending).catch((error) => showBanner(error.message));
      }, 'rejected'),
      approvalActionButton('允许一次', 'primary-btn', () => {
        answerLegacyApproval('allowed-once', pending).catch((error) => showBanner(error.message));
      }, 'allowed-once'),
    );
  } else if (pending.actions.length) {
    // Render exactly the daemon's action list — labels, order, and variants.
    for (const action of pending.actions) {
      const className = action.variant === 'primary'
        ? 'primary-btn'
        : action.variant === 'danger' ? 'danger-btn' : 'ghost-btn';
      buttons.push(approvalActionButton(action.label, className, () => {
        respondToPendingApproval(pending, responseForAction(action))
          .catch((error) => showBanner(error.message));
      }, action.id));
    }
  } else {
    buttons.push(
      approvalActionButton('拒绝', 'ghost-btn', () => {
        respondToPendingApproval(pending, genericResponse('deny'))
          .catch((error) => showBanner(error.message));
      }, 'deny'),
      approvalActionButton('允许一次', 'primary-btn', () => {
        respondToPendingApproval(pending, genericResponse('allow'))
          .catch((error) => showBanner(error.message));
      }, 'allow'),
    );
  }
  for (const button of buttons) {
    button.disabled = Boolean(pending.responding);
    buttonBusy(button, pending.responding && button.dataset.approvalAction === pending.respondingAction);
  }
  clearButtonBusy(approvalActions);
  approvalActions.replaceChildren(...buttons);
  renderDrawer();
}

// —— 主机 RPC / shell —— //

const LEGACY_HOST_RPC_MSG = '当前为 dshd 配对会话，旧 Host RPC 已退役';

function assertNotLegacyHostRpc() {
  if (state.transport === 'chisacode') {
    throw new Error(LEGACY_HOST_RPC_MSG);
  }
}

async function call(method, payload = {}) {
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

function stopHistoryPoll() {
  if (historyPollTimer) {
    clearInterval(historyPollTimer);
    historyPollTimer = 0;
  }
}

function stopMux() {
  try { muxUnsub?.(); } catch { /* ignore */ }
  muxUnsub = null;
}

function applyHostCatalog({ sessions, workspaces }) {
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

async function refreshHostCatalog() {
  const paired = state.chisacode;
  const client = paired?.client;
  if (!client) throw new Error('桌面端未启动');
  const [sessions, workspaces] = await Promise.all([
    hostCall(client, 'session.list', {}),
    hostCall(client, 'workspace.list', {}),
  ]);
  if (state.chisacode === paired) applyHostCatalog({ sessions, workspaces });
}

function applyHistoryPayload(payload) {
  const page = hostHistoryPage(payload);
  state.events = page.events;
  state.timelinePage = { hasOlder: page.hasOlder, beforeSeq: page.beforeSeq };
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
    events: page.events,
    previous: state.permission,
  });
  state.pendingApprovals = mergeApprovalPending(
    state.pendingApprovals,
    pendingFromHistoryEvents(page.events, state.sessionId),
  );
  syncModelSelection();
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
      // The closing assistant message can commit just after the idle status.
      setTimeout(() => { if (state.sessionId === idleFor) void pullCurrentHistory(); }, 1500);
    }
  }
  if (payload?.type === 'session/projection' && payload.sessionId === state.sessionId) {
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
    renderSettings();
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

function startLiveFollow() {
  stopHistoryPoll();
  stopMux();
  const client = state.chisacode?.client;
  if (!client) return;
  if (typeof client.subscribeHostMux === 'function') {
    muxUnsub = client.subscribeHostMux((frame) => handleMuxFrame(frame));
  }
  historyPollTimer = setInterval(() => {
    if (!state.sessionId || !state.chisacode?.client) return;
    const row = currentRow();
    if (row?.running !== true && !state.pendingApprovals.length) return;
    void pullCurrentHistory();
  }, HISTORY_POLL_MS);
}

/** One `session.history` refresh of the open session (poll tick or final catch-up). */
let historyPullInflight = null;
function pullCurrentHistory() {
  const sessionId = state.sessionId;
  const client = state.chisacode?.client;
  if (!sessionId || !client) return Promise.resolve();
  if (historyPullInflight) return historyPullInflight;
  historyPullInflight = hostCall(client, 'session.history', historyQuery(sessionId))
    .then((payload) => {
      if (state.sessionId !== sessionId) return;
      applyHistoryPayload(payload);
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

function forceLogout(message, { forget = true } = {}) {
  const serverId = state.chisacode?.serverId;
  try {
    state.chisacode?.dispose?.();
    const closing = state.chisacode?.client?.close?.();
    if (closing && typeof closing.catch === 'function') {
      void closing.catch(() => {});
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
  state.chisacode = null;
  state.route = 'connect';
  state.sessions = [];
  state.sessionId = '';
  state.events = [];
  state.pendingApprovals = [];
  state.timelinePage = { hasOlder: false, beforeSeq: null };
  state.timelineLoadingOlder = false;
  state.timelineLoading = false;
  state.timelineError = '';
  state.sessionMenu = '';
  state.sessionConfirm = null;
  state.sessionRename = null;
  state.workspaceMenu = '';
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
  state.extPane = { mcp: null, skills: null };
  showBanner('');
  setToast('');
  renderConnBanner();
  renderSheet();
  renderDialog();
  renderLightbox();
  renderScreen();
  showError(message || '');
}

async function shell(name, payload = {}) {
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

function clearApproval(requestId) {
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

async function runReconnectResync() {
  const paired = state.chisacode;
  if (state.transport !== 'chisacode' || !paired || paired.resyncing) return;
  paired.resyncing = true;
  state.catalogBusy = true;
  const sessionId = state.sessionId;
  renderSessions();
  try {
    const { sessions, workspaces, history } = await resyncAfterReconnect(paired.client, {
      sessionId,
    });
    if (state.chisacode !== paired) return;
    applyHostCatalog({ sessions, workspaces });
    if (history && state.sessionId === sessionId) {
      applyHistoryPayload(history);
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

async function resumeRemoteConnection() {
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

async function finishChisaCodeConnect(paired, reconnected, signal) {
  if (signal?.aborted) {
    await paired.client.close();
    return;
  }
  state.chisacode = paired;
  const closeOnAbort = () => { void paired.client.close().catch(() => {}); };
  signal?.addEventListener('abort', closeOnAbort, { once: true });
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
  paired.dispose = () => {
    disposeEvents();
    disposeWatch();
    stopHistoryPoll();
    stopMux();
  };
  draftStore = createDraftStore(localStorage, paired.serverId);
  state.chisacode = paired;
  state.transport = 'chisacode';
  state.connected = true;
  state.route = 'chat';
  state.host = { protocol: 'chisacode-v2', serverId: paired.serverId };
  state.cwd = '';
  resetWorkPanes();
  state.extPane = { mcp: null, skills: null };
  state.hostName = paired.computerName;
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
  deviceLine.replaceChildren();
  deviceLine.append(document.createTextNode(`${reconnected ? '已重连' : '已配对'} ${paired.computerName}`));
  showBanner(loadError);
  if (loadError) operationError(loadError, runReconnectResync);
  renderSessions();
  renderHeader();
  renderScreen();
  // The drawer must track desktop-side catalog changes even before a session
  // is opened (DEF-SYNC-REVERSE); openSession re-arms the same follow.
  if (!loadError) startLiveFollow();
}

async function connect(offerUrl) {
  return runInitialConnect(async (signal) => {
    if (!hasOfferFragment(offerUrl)) {
      throw new Error('请使用桌面端扫码配对二维码（dshd offer）');
    }
    const api = await loadChisaCodeApi();
    await finishChisaCodeConnect(await pairFromOfferUrl(api, offerUrl, { signal }), false, signal);
  }, { replace: true });
}

async function openSession(sessionId) {
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
  state.timelineError = '';
  state.timelineLoading = true;
  renderComposer();
  renderSlashPop();
  renderLog({ anchor: 'bottom' });
  renderApproval();
  renderHeader();
  let history;
  try {
    history = await call('session.history', historyQuery(sessionId));
  } catch (error) {
    if (state.sessionId !== sessionId) return;
    state.timelineLoading = false;
    state.timelineError = error?.message || '电脑没有响应';
    operationError(`载入会话失败：${state.timelineError}`, () => openSession(sessionId));
    renderLog({ anchor: 'bottom' });
    throw error;
  }
  if (state.sessionId !== sessionId) return;
  state.timelineLoading = false;
  const previousCwd = state.cwd;
  applyHistoryPayload(history.value || history);
  state.cwd = currentRow()?.cwd || '';
  if (state.cwd !== previousCwd) resetWorkPanes();
  renderBlankHero();
  startLiveFollow();
  void loadSessionModels();
  void refreshGit();
  renderHeader();
  renderSessions();
  renderLog({ anchor: 'bottom' });
  renderApproval();
  renderComposer();
}

function renderBlankHero() {
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

async function loadSessionModels() {
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
function currentModelSelectionProjection() {
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

// —— 新会话：已有工作区 / 无目录 / 浏览本机目录 —— //

function updateNewSession(patch) {
  if (!state.newSession) return;
  Object.assign(state.newSession, patch);
  if (patch.error) {
    const task = state.newSession;
    const retry = task.createdSessionId ? retryCreatedSession : task.retry;
    operationError(patch.error, retry ? () => {
      state.newSession = task;
      renderSheet();
      return retry();
    } : null);
  }
  renderSheet();
}

function startNewSessionChooser() {
  state.pickerSheet = '';
  state.pickerPage = '';
  state.history = null;
  state.sessionMenu = '';
  state.workspaceMenu = '';
  state.attachOpen = false;
  state.gitDialog = '';
  setDrawerOpen(false);
  const { choices, noFolder } = workspaceChoices(state.workspaces);
  state.newSession = {
    step: 'workspace',
    loading: false,
    error: '',
    workspaces: [
      noFolder,
      ...choices,
      { id: '__browse__', name: '浏览本机目录…', cwd: '', browse: true },
    ],
    browse: null,
    presets: [],
    workspace: null,
  };
  renderSheet();
  const client = state.chisacode?.client;
  const session = state.newSession;
  if (!client) return;
  void hostCall(client, 'agentPreset.list', {}).then((listed) => {
    if (state.newSession !== session) return;
    updateNewSession({ presets: presetChoices(listed) });
  }).catch(() => {
    if (state.newSession !== session) return;
    updateNewSession({ presets: [] });
  });
}

async function createWorkspaceSession(workspaceId, extra = {}) {
  const client = state.chisacode?.client;
  if (!client) return;
  try {
    const created = await hostCall(client, 'session.create', {
      ...(workspaceId ? { workspaceId } : {}),
      ...extra,
    });
    const sessionId = created.sessionId;
    await refreshHostCatalog();
    renderSessions();
    if (sessionId) await openSession(sessionId);
  } catch (error) {
    showBanner(`无法创建会话：${error?.message || '电脑没有响应'}`);
  }
}

async function finishNewSession(owner, task, created) {
  if (!owner.owns() || state.newSession !== task) return;
  task.createdSessionId = created.sessionId;
  await refreshHostCatalog();
  if (!owner.owns() || state.newSession !== task) return;
  state.newSession = null;
  renderSheet(); renderSessions();
  if (task.createdSessionId) await openSession(task.createdSessionId);
}

async function retryCreatedSession() {
  const owner = sessionOwner(state);
  const task = state.newSession;
  if (!task?.createdSessionId || task.creating) return;
  updateNewSession({ creating: true, loading: true, error: '' });
  try { await finishNewSession(owner, task, { sessionId: task.createdSessionId }); }
  catch (error) {
    if (owner.owns() && state.newSession === task) updateNewSession({ creating: false, loading: false, error: error.message });
  }
}

async function chooseNewSessionWorkspace(workspace, options = {}) {
  if (workspace?.browse) {
    await openDirectoryBrowse();
    return;
  }
  if (state.newSession?.creating) return;
  const owner = sessionOwner(state);
  state.newSession.retry = () => chooseNewSessionWorkspace(workspace, options);
  updateNewSession({ creating: true, loading: true, error: '' });
  const task = state.newSession;
  const extra = !workspace?.id && workspace?.cwd ? { cwd: workspace.cwd } : {};
  try {
    const created = await hostCall(owner.client, 'session.create', { ...(workspace?.id ? { workspaceId: workspace.id } : {}), ...extra, ...options });
    await finishNewSession(owner, task, created);
  } catch (error) {
    if (!owner.owns() || state.newSession !== task) return;
    updateNewSession({ creating: false, loading: false, error: error?.message || '无法创建会话' });
  }
}

async function openDirectoryBrowse() {
  const client = state.chisacode?.client;
  if (!client) return;
  state.newSession.retry = openDirectoryBrowse;
  if (state.newSession?.browse) {
    updateNewSession({ step: 'browse', loading: false, error: '' });
    return;
  }
  updateNewSession({ step: 'browse', loading: true, error: '', browse: null });
  const session = state.newSession;
  const start = browseStartPath(state.workspaces);
  try {
    const listed = await hostCall(client, 'host.listDirectory', start ? { path: start } : {});
    if (state.newSession !== session) return;
    updateNewSession({ loading: false, browse: listed });
  } catch (error) {
    if (state.newSession !== session) return;
    updateNewSession({ loading: false, error: error?.message || '电脑没有响应' });
  }
}

async function browseDirectory(path) {
  const client = state.chisacode?.client;
  if (!client || !state.newSession) return;
  state.newSession.retry = () => browseDirectory(path);
  updateNewSession({ loading: true, error: '' });
  const session = state.newSession;
  const request = session.browseRequest = (session.browseRequest || 0) + 1;
  try {
    const listed = await hostCall(client, 'host.listDirectory', { path });
    if (state.newSession !== session || session.browseRequest !== request) return;
    updateNewSession({ loading: false, browse: listed });
  } catch (error) {
    if (state.newSession !== session || session.browseRequest !== request) return;
    updateNewSession({ loading: false, error: error?.message || '电脑没有响应' });
  }
}

async function createBrowsedWorkspace() {
  const client = state.chisacode?.client;
  const path = state.newSession?.browse?.path;
  if (!client || !path || state.newSession.creating) return;
  const owner = sessionOwner(state);
  state.newSession.retry = createBrowsedWorkspace;
  updateNewSession({ loading: true, creating: true, error: '' });
  const active = state.newSession;
  try {
    const cachedWorkspaceId = active.createdWorkspacePath === path ? active.createdWorkspaceId : null;
    const created = cachedWorkspaceId ? null : await hostCall(client, 'workspace.create', { path });
    if (!owner.owns() || state.newSession !== active) return;
    const workspaceId = cachedWorkspaceId || workspaceIdFromCreate(created);
    if (!workspaceId) throw new Error('工作区创建失败');
    active.createdWorkspaceId = workspaceId;
    active.createdWorkspacePath = path;
    const session = await hostCall(client, 'session.create', { workspaceId });
    await finishNewSession(owner, active, session);
  } catch (error) {
    if (state.newSession !== active) return;
    updateNewSession({ loading: false, creating: false, error: error?.message || '电脑没有响应' });
  }
}

function clearExclusiveDialogs() {
  state.workspaceRename = null;
  state.folderCreate = null;
  state.sessionRename = null;
  state.sessionConfirm = null;
}

function startFolderCreate() {
  if (!state.newSession?.browse?.path) return;
  clearExclusiveDialogs();
  state.folderCreate = { value: '', busy: false, error: '' };
  renderDialog();
}

async function submitFolderCreate() {
  const create = state.folderCreate;
  const client = state.chisacode?.client;
  const path = state.newSession?.browse?.path;
  const task = state.newSession;
  if (!create || create.busy || !client || !path) return;
  const name = create.value.trim();
  if (!name) return;
  create.busy = true;
  create.error = '';
  renderDialog();
  try {
    const created = await hostCall(client, 'host.createDirectory', { path, name });
    if (state.folderCreate !== create) return;
    state.folderCreate = null;
    renderDialog();
    await browseDirectory(created.path || path);
  } catch (error) {
    if (state.folderCreate !== create) return;
    create.busy = false;
    create.error = error?.message || '无法创建文件夹';
    operationError(create.error, () => {
      state.newSession = task;
      state.folderCreate = create;
      renderSheet();
      renderDialog();
      return submitFolderCreate();
    });
    renderDialog();
  }
}

// —— 会话操作（重命名 / 重新生成标题 / 归档 / 删除）与已归档历史 —— //

function sessionRowById(sessionId) {
  return state.sessions.find((row) => row.sessionId === sessionId);
}

function clearSessionView(sessionId) {
  if (state.sessionId !== sessionId) return;
  state.sessionId = '';
  state.events = [];
  state.pendingApprovals = [];
  state.timelinePage = { startCursor: null, hasOlder: false };
  state.timelineError = '';
  state.timelineLoading = false;
  renderLog();
  renderApproval();
  renderComposer();
  renderHeader();
}

function startWorkspaceRename(workspace) {
  state.workspaceMenu = '';
  clearExclusiveDialogs();
  state.workspaceRename = {
    workspaceId: workspace.workspaceId,
    value: workspace.title || '',
    busy: false,
    error: '',
  };
  renderSheet();
  renderDialog();
}

async function submitWorkspaceRename() {
  const rename = state.workspaceRename;
  const paired = state.chisacode;
  if (!rename || rename.busy || !paired) return;
  const title = rename.value.trim();
  if (!title) return;
  rename.busy = true;
  rename.error = '';
  renderDialog();
  try {
    await hostCall(paired.client, 'workspace.rename', {
      workspaceId: rename.workspaceId,
      title,
    });
    if (state.workspaceRename !== rename) return;
    state.workspaceRename = null;
    renderDialog();
    try { await refreshHostCatalog(); }
    catch (error) {
      operationError(`工作区已重命名；同步失败：${error?.message || '电脑没有响应'}`, runReconnectResync);
      return;
    }
    renderSessions();
    setToast('已重命名工作区', { tone: 'success' });
  } catch (error) {
    if (state.workspaceRename !== rename) return;
    rename.busy = false;
    rename.error = error?.message || '电脑没有响应';
    operationError(rename.error, () => {
      state.workspaceRename = rename;
      renderDialog();
      return submitWorkspaceRename();
    });
    renderDialog();
  }
}

function startSessionRename(row) {
  state.sessionMenu = '';
  clearExclusiveDialogs();
  state.sessionRename = {
    sessionId: row.sessionId,
    value: sessionTitle(row),
    busy: false,
    error: '',
  };
  renderSheet();
  renderDialog();
}

async function submitSessionRename() {
  const rename = state.sessionRename;
  const paired = state.chisacode;
  if (!rename || rename.busy || !paired) return;
  rename.busy = true;
  rename.error = '';
  renderDialog();
  try {
    await hostCall(paired.client, 'session.rename', {
      sessionId: rename.sessionId,
      title: rename.value,
    });
    if (state.sessionRename !== rename) return;
    // The daemon accepted; reflect the confirmed name locally right away
    // (the authoritative agent_update upsert follows).
    const row = sessionRowById(rename.sessionId);
    if (row) {
      row.projections = row.projections || { values: {} };
      row.projections.values = { ...row.projections.values, title: rename.value.trim() };
      row.title = rename.value.trim();
    }
    state.sessionRename = null;
    renderDialog();
    renderSessions();
    renderHeader();
    setToast('已重命名', { tone: 'success' });
  } catch (error) {
    if (state.sessionRename !== rename) return;
    rename.busy = false;
    rename.error = error?.message || '电脑没有响应';
    operationError(rename.error, () => {
      state.sessionRename = rename;
      renderDialog();
      return submitSessionRename();
    });
    renderDialog();
  }
}

async function forkSession(row) {
  state.sessionMenu = '';
  renderSheet();
  try {
    const created = await hostCall(state.chisacode.client, 'session.fork', {
      sessionId: row.sessionId,
    });
    await refreshHostCatalog();
    renderSessions();
    if (created.sessionId) await openSession(created.sessionId);
  } catch (error) {
    showBanner(`Fork 失败：${error?.message || '电脑没有响应'}`);
  }
}

async function moveSession(row, direction) {
  const client = state.chisacode?.client;
  const payload = insertSessionMove(row, direction, state.workspaces, state.sessions);
  if (!client || !payload) return;
  state.sessionMenu = '';
  renderSheet();
  try {
    await hostCall(client, 'workspace.insertSessionBefore', payload);
    await refreshHostCatalog();
    renderSessions();
  } catch (error) {
    showBanner(`排序失败：${error?.message || '电脑没有响应'}`);
  }
}

async function regenerateSessionTitle(row) {
  state.sessionMenu = '';
  renderSheet();
  try {
    await hostCall(state.chisacode.client, 'session.prompt', {
      sessionId: row.sessionId,
      ...promptPayload([textBlock('/rename')]),
    });
    setToast('已请求重新生成标题', { tone: 'info' });
  } catch (error) {
    showBanner(`重新生成标题失败：${error?.message || '电脑没有响应'}`);
  }
}

function startSessionConfirm(kind, row) {
  state.sessionMenu = '';
  state.workspaceMenu = '';
  clearExclusiveDialogs();
  state.sessionConfirm = {
    kind,
    sessionId: row.sessionId,
    title: sessionTitle(row),
    busy: false,
    error: '',
  };
  renderSheet();
  renderDialog();
}

async function runSessionConfirm() {
  const confirm = state.sessionConfirm;
  const paired = state.chisacode;
  if (!confirm || confirm.busy || !paired) return;
  confirm.busy = true;
  confirm.error = '';
  renderDialog();
  try {
    if (confirm.kind === 'archive') {
      await hostCall(paired.client, 'workspace.archiveSession', { sessionId: confirm.sessionId });
    } else if (confirm.kind === 'delete') {
      await hostCall(paired.client, 'session.delete', { sessionId: confirm.sessionId });
    } else if (confirm.kind === 'workspace-delete') {
      await hostCall(paired.client, 'workspace.delete', { workspaceId: confirm.sessionId });
    }
    if (state.sessionConfirm !== confirm) return;
    await refreshHostCatalog();
    clearSessionView(confirm.sessionId);
    state.sessionConfirm = null;
    renderDialog();
    renderSessions();
    setToast(confirm.kind === 'archive' ? '已归档' : confirm.kind === 'workspace-delete' ? '已从列表移除' : '已删除', { tone: 'success' });
  } catch (error) {
    if (state.sessionConfirm !== confirm) return;
    confirm.busy = false;
    confirm.error = error?.message || '电脑没有响应';
    operationError(confirm.error, () => {
      state.sessionConfirm = confirm;
      renderDialog();
      return runSessionConfirm();
    });
    renderDialog();
  }
}

function openHistorySheet() {
  setDrawerOpen(false);
  state.history = {
    rows: state.archivedRows.slice(),
    nextCursor: null,
    hasMore: false,
    loading: false,
    error: '',
    busyId: '',
  };
  renderSheet();
}

async function loadHistoryPage() {
  return;
}

async function unarchiveFromHistory(row) {
  const view = state.history;
  const paired = state.chisacode;
  if (!view || !paired || view.busyId) return;
  view.busyId = row.sessionId;
  view.error = '';
  renderSheet();
  try {
    await hostCall(paired.client, 'workspace.unarchiveSession', { sessionId: row.sessionId });
    await refreshHostCatalog();
    if (state.history !== view) return;
    view.rows = state.archivedRows.slice();
    view.busyId = '';
    renderSheet();
    renderSessions();
    setToast('已取消归档', { tone: 'success' });
  } catch (error) {
    if (state.history !== view) return;
    view.busyId = '';
    view.error = `取消归档失败：${error?.message || '电脑没有响应'}`;
    operationError(view.error, () => {
      state.history = view;
      renderSheet();
      return unarchiveFromHistory(row);
    });
    renderSheet();
  }
}

async function createSession() {
  if (state.transport === 'chisacode') {
    startNewSessionChooser();
    return;
  }
  const created = await call('session.create', {});
  const sessionId = created.value?.sessionId;
  if (!sessionId) return;
  state.sessions = applyHostFrame(state.sessions, {
    type: 'host/session-added',
    sessionId,
    blank: true,
  });
  await openSession(sessionId);
}

async function runHostCommand(line, images = []) {
  const owner = sessionOwner(state);
  const value = await hostCall(
    owner.client,
    'commands/execute',
    commandExecutePayload(owner.sessionId, line, images),
  );
  admitCommandResult(value, line);
  if (!owner.owns()) return;
  const history = await hostCall(owner.client, 'session.history', historyQuery(owner.sessionId));
  if (!owner.owns()) return;
  applyHistoryPayload(history);
  renderLog();
  renderComposer();
  renderSettings();
}

async function sendPrompt() {
  if (state.sendBusy) return;
  const owner = sessionOwner(state);
  const submittedText = draft.value;
  const text = draft.value.trim();
  const images = state.attachments.slice();
  if (!state.sessionId || (!text && !images.length)) return;
  if (state.pendingApprovals.length) return;
  if (currentReadOnlyReason()) {
    showBanner('只读会话不能发送消息');
    return;
  }
  if (composerOffline()) {
    showBanner('连接已断开，消息未发送；草稿已保留，恢复连接后再发');
    return;
  }
  if (isSlashSubmitLine(text)) {
    state.sendBusy = true;
    renderComposer();
    try {
      await runHostCommand(text, images);
      if (owner.owns()) finishSubmittedDraft(submittedText, images);
    } finally {
      if (owner.owns()) { state.sendBusy = false; renderComposer(); }
    }
    return;
  }
  const guard = attachmentGuard({ current: currentModelState().current, attachments: images });
  if (!guard.ok) {
    showBanner(guard.message);
    return;
  }
  const blocks = [];
  if (text) blocks.push(textBlock(text));
  for (const image of images) {
    blocks.push({ type: 'image', mediaType: image.mediaType, data: image.data });
  }
  state.sendBusy = true;
  renderComposer();
  try {
    await call('session.prompt', { sessionId: owner.sessionId, ...promptPayload(blocks) });
  } finally {
    if (owner.owns()) { state.sendBusy = false; renderComposer(); }
  }
  if (!owner.owns()) return;
  finishSubmittedDraft(submittedText, images);
  const row = currentRow();
  if (row) {
    row.running = true;
    row.blank = false;
    if (state.heldSession?.sessionId === row.sessionId) {
      state.heldSession = { ...row, blank: false };
    }
    promoteHeldLive();
    renderSessions();
  }
  renderComposer();
  renderSlashPop();
  renderHeader();
}

function finishSubmittedDraft(submittedText, images) {
  if (draft.value === submittedText) draft.value = '';
  state.attachments = state.attachments.filter((image) => !images.includes(image));
  draftStore?.save(state.sessionId, draft.value);
  draftStore?.saveAttachments(state.sessionId, state.attachments);
  renderComposer(); renderSlashPop(); renderHeader();
}

async function cancelRun() {
  if (!state.sessionId) return;
  if (stopBtn.disabled) return;
  stopBtn.disabled = true;
  buttonBusy(stopBtn, true, { iconOnly: true, label: '正在停止运行…' });
  try {
    await call('session.cancel', { sessionId: state.sessionId });
  } catch (error) {
    showBanner(error.message || '无法停止');
  } finally {
    stopBtn.disabled = false;
    buttonBusy(stopBtn, false);
  }
}

async function respondToPendingApproval(pending, response) {
  const pendingId = pending.approvalId || pending.rpcId || pending.requestId;
  const active = state.pendingApprovals.find((item) => (item.approvalId || item.rpcId || item.requestId) === pendingId);
  if (!active) {
    operationError('审批已结束，请查看当前会话');
    return;
  }
  pending = active;
  if (pending.responding) return;
  const owner = sessionOwner(state);
  pending.responding = true;
  pending.respondingAction = response?.selectedActionId || response?.behavior || '';
  if (pending.error && state.gitToast === pending.error) setToast('');
  pending.error = '';
  renderApproval();
  const outcome = response?.selectedActionId === 'rejected'
    || response?.behavior === 'deny'
    ? 'rejected'
    : (pending.actions?.find((action) => action.id === response?.selectedActionId)?.outcome || 'allowed-once');
  const client = owner.client;
  try {
    const result = await deliverApprovalRespond({
    hostCall,
    client,
    pending: {
      ...pending,
      sessionId: pending.sessionId || owner.sessionId,
    },
    outcome,
    loadHistory: (sessionId) => hostCall(client, 'session.history', historyQuery(sessionId)),
    });
    if (!owner.owns()) return;
    if (result.ok) {
      clearApproval(pending.rpcId); clearApproval(pending.approvalId);
    } else {
      pending.error = result.error?.message || '审批未能送达电脑';
      operationError(pending.error, () => respondToPendingApproval(pending, response));
    }
  } catch (error) {
    if (owner.owns()) {
      pending.error = error?.message || '审批未能送达电脑';
      operationError(pending.error, () => respondToPendingApproval(pending, response));
    }
  } finally {
    pending.responding = false;
    pending.respondingAction = '';
    if (owner.owns()) renderApproval();
  }
}

async function answerLegacyApproval(outcome, expected = state.pendingApprovals[0]) {
  const pending = state.pendingApprovals[0];
  if (!pending || (pending.approvalId || pending.rpcId || pending.requestId) !== (expected?.approvalId || expected?.rpcId || expected?.requestId)) {
    operationError('审批已结束，请查看当前会话');
    return;
  }
  if (!pending || !pending.legacy || pending.responding) return;
  const owner = sessionOwner(state);
  pending.responding = true;
  pending.respondingAction = outcome;
  if (pending.error && state.gitToast === pending.error) setToast('');
  pending.error = '';
  renderApproval();
  try {
    assertNotLegacyHostRpc();
    await respond({
      origin,
      rpcId: pending.rpcId,
      value: { sessionId: pending.sessionId, approvalId: pending.approvalId, outcome },
    });
    if (owner.owns()) state.pendingApprovals = state.pendingApprovals.filter((item) => item !== pending);
  } catch (error) {
    if (owner.owns()) {
      pending.error = error?.message || '审批未能送达电脑';
      operationError(pending.error, () => answerLegacyApproval(outcome, pending));
    }
  } finally {
    pending.responding = false;
    pending.respondingAction = '';
    if (owner.owns()) renderApproval();
  }
}

// —— Slash 命令 popup（`/` 触发，host commands/list，按会话缓存）—— //

function renderSlashPop() {
  const slash = state.slash;
  const visible = slash.open && !currentReadOnlyReason() && !state.pendingApprovals.length;
  slashPop.classList.toggle('hidden', !visible);
  if (!visible) return;
  const nodes = [];
  if (slash.loading) {
    slashPop.classList.add('surface-busy');
  } else if (slash.error) {
    slashPop.classList.remove('surface-busy');
  } else {
    slashPop.classList.remove('surface-busy');
    const rows = filterSlashCommands(slash.commands, slashQuery(draft.value) || '');
    if (!rows.length) {
      const note = document.createElement('p');
      note.className = 'slash-note';
      note.textContent = '没有匹配的命令';
      nodes.push(note);
    }
    for (const command of rows.slice(0, 8)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'slash-item';
      const name = document.createElement('b');
      name.textContent = `/${command.name}${command.argumentHint ? ` ${command.argumentHint}` : ''}`;
      button.append(name);
      if (command.description) {
        const desc = document.createElement('span');
        desc.textContent = command.description;
        button.append(desc);
      }
      button.addEventListener('click', () => {
        draft.value = applySlashCommand(command.name);
        if (state.sessionId) draftStore?.save(state.sessionId, draft.value);
        state.slash = { ...state.slash, open: false };
        renderSlashPop();
        renderComposer();
        draft.focus();
      });
      nodes.push(button);
    }
  }
  slashPop.replaceChildren(...nodes);
  slashPop.setAttribute('aria-busy', String(slash.loading));
}

function updateSlashPopup() {
  const paired = state.chisacode;
  const sessionId = state.sessionId;
  const query = slashQuery(draft.value);
  const usable = state.transport === 'chisacode' && paired && sessionId
    && query !== null && !currentReadOnlyReason();
  if (!usable) {
    if (state.slash.open) {
      state.slash = { ...state.slash, open: false };
      renderSlashPop();
    }
    return;
  }
  paired.slashCommandsCache ??= new Map();
  paired.slashCommandsInflight ??= new Set();
  const cached = paired.slashCommandsCache.get(sessionId);
  if (cached) {
    state.slash = { open: true, loading: false, error: '', commands: cached };
    renderSlashPop();
    return;
  }
  if (paired.slashCommandsInflight.has(sessionId)) {
    if (!state.slash.open) {
      state.slash = { open: true, loading: true, error: '', commands: [] };
      renderSlashPop();
    }
    return;
  }
  paired.slashCommandsInflight.add(sessionId);
  state.slash = { open: true, loading: true, error: '', commands: [] };
  renderSlashPop();
  hostCall(paired.client, 'commands/list', commandListPayload(sessionId))
    .then((listed) => {
      const mapped = mapHostSlashList(listed);
      paired.slashCommandsCache.set(sessionId, mapped);
      if (state.sessionId !== sessionId || slashQuery(draft.value) === null) return;
      state.slash = { open: true, loading: false, error: '', commands: mapped };
      renderSlashPop();
    })
    .catch((error) => {
      if (state.sessionId !== sessionId) return;
      state.slash = {
        open: true,
        loading: false,
        error: error.message || '无法读取命令',
        commands: [],
      };
      operationError(state.slash.error, () => updateSlashPopup());
      renderSlashPop();
    })
    .finally(() => {
      paired.slashCommandsInflight.delete(sessionId);
    });
}

// —— 扫码（M2）—— //

async function initScanButton() {
  if (nativeAndroidApp) {
    state.scanSupport = { supported: true, native: true };
    scanOpen.classList.remove('hidden');
    scanUnavailable.classList.add('hidden');
    scanUnavailable.textContent = '';
    return;
  }
  state.scanSupport = await detectScanSupport({
    isSecureContext: window.isSecureContext,
    mediaDevices: navigator.mediaDevices,
    BarcodeDetector: window.BarcodeDetector,
  });
  scanOpen.classList.toggle('hidden', !state.scanSupport.supported);
  const hint = scanUnavailableHint(state.scanSupport.reason);
  scanUnavailable.textContent = hint;
  scanUnavailable.classList.toggle('hidden', !hint);
}

function stopScan() {
  scanLoopId += 1;
  for (const track of scanStream?.getTracks?.() || []) {
    track.stop();
  }
  scanStream = null;
  scanVideo.srcObject = null;
  torchOn = false;
  scanTorch.classList.remove('is-on');
}

function closeScan() {
  stopScan();
  state.route = 'connect';
  renderScreen();
}

function handleScanHit(raw) {
  const outcome = classifyScan(raw, origin);
  if (outcome.kind === 'invalid') {
    if (raw !== lastInvalidScan) {
      lastInvalidScan = raw;
      operationError('二维码里没有配对密钥，请扫桌面远程弹窗里的二维码');
    }
    return false;
  }
  stopScan();
  if (outcome.kind === 'navigate') {
    window.location.replace(outcome.url);
    return true;
  }
  state.route = 'connect';
  renderScreen();
  connect(outcome.offerUrl).catch((error) => {
    showError(error.message || '连接失败');
  });
  return true;
}

async function startScan() {
  if (!state.scanSupport.supported) return;
  state.route = 'scan';
  lastInvalidScan = '';
  scanTip.textContent = '将二维码完整放入取景框';
  scanTorch.classList.add('hidden');
  renderScreen();
  let detector;
  try {
    detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
  } catch (error) {
    stopScan();
    if (error?.name === 'NotAllowedError') {
      state.route = 'permission';
    } else {
      state.route = 'connect';
      showError(error?.message || '无法打开相机');
    }
    renderScreen();
    return;
  }
  scanVideo.srcObject = scanStream;
  try {
    await scanVideo.play();
  } catch { /* autoplay policy — video attr covers it */ }
  const track = scanStream.getVideoTracks()[0];
  if (track?.getCapabilities?.().torch) {
    scanTorch.classList.remove('hidden');
    scanTorch.textContent = '手电筒';
  }
  const loop = scanLoopId += 1;
  let lastDetect = 0;
  const step = async (now) => {
    if (loop !== scanLoopId) return;
    if (now - lastDetect >= 200 && scanVideo.readyState >= 2) {
      lastDetect = now;
      try {
        const codes = await detector.detect(scanVideo);
        if (loop !== scanLoopId) return;
        const raw = codes.find((code) => code.rawValue)?.rawValue;
        if (raw && handleScanHit(raw)) return;
      } catch { /* 单帧解码失败继续扫 */ }
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

async function toggleTorch() {
  const track = scanStream?.getVideoTracks?.()[0];
  if (!track) return;
  if (scanTorch.disabled) return;
  scanTorch.disabled = true;
  buttonBusy(scanTorch, true, { label: '切换中…' });
  try {
    torchOn = !torchOn;
    await track.applyConstraints({ advanced: [{ torch: torchOn }] });
    scanTorch.classList.toggle('is-on', torchOn);
  } catch {
    torchOn = false;
    scanTorch.classList.remove('is-on');
    scanTorch.classList.add('hidden');
  } finally {
    scanTorch.disabled = false;
    buttonBusy(scanTorch, false);
    scanTorch.textContent = torchOn ? '关闭手电' : '手电筒';
  }
}

// —— 附件（M3）—— //

function base64FromDataUrl(dataUrl) {
  const index = dataUrl.indexOf(',');
  return index >= 0 ? dataUrl.slice(index + 1) : '';
}

const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

async function compressImage(file) {
  // 与 Android TakePicturePreview→JPEG 88% 同量级：大图经 canvas 转 JPEG。
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return { mediaType: 'image/jpeg', data: base64FromDataUrl(canvas.toDataURL('image/jpeg', 0.88)) };
}

async function attachmentFromFile(file) {
  if (ALLOWED_IMAGE_TYPES.includes(file.type) && file.size <= MAX_IMAGE_BYTES) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const block = imageBlock(file.type, bytes);
    return { mediaType: block.mediaType, data: block.data };
  }
  // 非白名单类型（如 HEIC）或大图统一经 canvas 转 JPEG。
  return compressImage(file);
}

async function addFiles(fileList, owner = sessionOwner(state)) {
  if (!owner.owns()) return;
  for (const file of Array.from(fileList || [])) {
    try {
      const attachment = await attachmentFromFile(file);
      if (!owner.owns()) return;
      state.attachments.push(attachment);
    } catch (error) {
      if (!owner.owns()) return;
      showBanner(error.message || '无法读取图片');
    }
  }
  draftStore?.saveAttachments(state.sessionId, state.attachments);
  renderComposer();
}

// —— Git / 工作区（M5）—— //

function currentQuick() {
  if (state.gitAuthError) {
    return { label: 'Git', disabled: true, kind: 'show_hint', action: null, hint: state.gitAuthError };
  }
  if (state.gitStatus.isRepo === false) {
    return { label: 'Initialize Git', disabled: state.gitBusy, kind: 'run_init', action: null, hint: '' };
  }
  // Keep the resting caption while pending so feedback cannot resize it.
  return resolveGitQuick(state.gitStatus, false);
}

function gitBusyLabel() {
  const labels = {
    commit: '提交中…', push: '推送中…', pull: '拉取中…', init: '初始化中…',
    'create-branch': '创建分支中…', 'switch-branch': '切换分支中…',
    publish: '发布中…', 'create-change-request': '创建 PR 中…',
  };
  return labels[state.gitProgress] || 'Git 操作进行中…';
}

function refreshGitButtonFeedback() {
  for (const button of phone.querySelectorAll('[data-git-feedback]')) {
    buttonBusy(button, state.gitBusy, { label: gitBusyLabel() });
  }
}

async function refreshGit() {
  if (!state.cwd) return;
  state.gitAuthError = '';
  try {
    const status = await gitCall(state.chisacode.client, 'git-status', state.cwd, {});
    if (!status) {
      state.gitAuthError = 'Git 未授权该目录';
      state.gitStatus = parseVcsStatus({ isRepo: false, refName: null });
    } else {
      state.gitStatus = parseVcsStatus(status);
      try {
        const pr = await gitCall(state.chisacode.client, 'git-pull-request', state.cwd, {});
        if (pr && typeof pr === 'object' && (pr.url || pr.state)) {
          state.gitStatus.pr = {
            state: pr.state || null,
            number: pr.number ?? null,
            url: pr.url || null,
          };
        }
      } catch (error) {
        showBanner(`Git 状态已加载；拉取请求状态不可用：${error?.message || '电脑没有响应'}`);
      }
    }
  } catch (error) {
    const message = error.message || 'Git 状态不可用';
    if (/unavailable|授权|workspace/i.test(message)) {
      state.gitAuthError = message;
      state.gitStatus = parseVcsStatus({ isRepo: false, refName: null });
    } else {
      operationError(message, refreshGit);
    }
  }
  renderHeader();
  if (state.settingsOpen) renderSettings();
}

function setToast(message, { tone = 'info', holdMs = 4000, actions = [] } = {}) {
  state.gitToast = message || '';
  state.toastTone = tone;
  state.toastHoldMs = holdMs;
  state.toastActions = actions;
  renderToast();
  clearTimeout(toastTimer);
  if (state.gitToast && !state.gitBusy && holdMs !== null) {
    toastTimer = setTimeout(() => {
      state.gitToast = '';
      renderToast();
    }, holdMs);
  }
}

async function gitAction(name, extra = {}) {
  if (!state.cwd || state.gitBusy) return false;
  const owner = sessionOwner(state);
  const cwd = state.cwd;
  const retry = extra.retry === true ? state.gitRetry : null;
  if (retry && (retry.cwd !== cwd || retry.client !== owner.client)) return;
  state.gitBusy = true;
  state.gitProgress = gitTunnelAction(name).replace('git-', '');
  state.gitPendingRef = name === 'gitSwitchBranch' ? extra.ref || '' : '';
  state.gitProgressDismissed = false;
  state.gitToast = '';
  clearTimeout(toastTimer);
  state.gitError = '';
  renderToast();
  renderSettings();
  renderSheet();
  renderDialog();
  let stacked = '';
  let payload;
  let succeeded = false;
  try {
    const action = gitTunnelAction(name);
    stacked = retry?.action || extra.stacked || (action === 'git-commit' ? state.pendingStacked || 'commit' : '');
    payload = retry?.payload || (action === 'git-commit'
      ? gitCommitPayload({
        message: extra.message || state.commitMessage,
        filePaths: extra.filePaths || (state.commitFiles?.entries.length ? [...state.commitFiles.selected] : undefined),
        featureBranch: extra.featureBranch === true || state.commitOnNewBranch,
      })
      : extra);
    if (stacked && stacked !== 'commit') {
      await runStackedGit(
        (step, body) => gitCall(
          owner.client,
          step,
          cwd,
          step === 'git-commit' ? payload : step === 'git-create-branch' ? { name: payload.name } : body || {},
        ),
        stacked,
        {},
        { completed: retry?.completed || [], onProgress: (step) => {
          if (owner.owns()) {
            state.gitProgress = step.replace('git-', '');
            refreshGitButtonFeedback();
            renderToast();
          }
        } },
      );
    } else {
      await gitCall(owner.client, action, cwd, payload);
    }
    if (!owner.owns()) return;
    state.pendingStacked = '';
    state.gitRetry = null;
    state.gitProgress = '';
    state.commitFiles = null;
    state.gitDialog = '';
    state.gitConfirmAction = '';
    state.gitConfirmExtra = {};
    state.commitOnNewBranch = false;
    renderSheet();
    renderDialog();
    state.gitBusy = false;
    setToast('完成', { tone: 'success' });
    succeeded = true;
    await refreshGit();
  } catch (error) {
    if (!owner.owns()) return;
    state.gitBusy = false;
    state.gitProgress = '';
    state.gitError = error.message || 'Git 失败';
    if (error.completedSteps?.length) {
      state.gitRetry = { action: stacked, completed: error.completedSteps, payload, cwd, client: owner.client };
      state.gitError = `已完成 ${error.completedSteps.map((step) => step.replace('git-', '')).join('、')}；${state.gitError}`;
    }
    const errorText = state.gitError;
    operationError(errorText, () => gitAction(name, state.gitRetry ? { retry: true } : extra), [{ label: '复制错误', onClick: () => copyGitError(errorText) }]);
  }
  if (!owner.owns()) return;
  renderSheet(); renderDialog();
  renderToast();
  renderSettings();
  return succeeded;
}

function maybeConfirm(name, extra = {}) {
  if (name === 'gitCreateChangeRequest') extra = { stacked: 'create_pr', ...extra };
  if (state.gitStatus.isDefaultRef && (name === 'gitPush' || name === 'gitCreateChangeRequest')) {
    state.gitConfirmAction = name;
    state.gitConfirmExtra = extra;
    state.gitDialog = 'confirm';
    renderSheet();
    renderDialog();
  } else {
    gitAction(name, extra);
  }
}

function runGitPrimary() {
  const quick = currentQuick();
  if (state.gitBusy) return;
  if (quick.disabled) {
    setToast(quick.hint);
    return;
  }
  if (quick.kind === 'run_init') {
    gitAction('gitInit');
    return;
  }
  if (quick.kind === 'run_pull') {
    gitAction('gitPull');
    return;
  }
  if (quick.action === 'commit' || quick.action === 'commit_push' || quick.action === 'commit_push_pr') {
    state.pendingStacked = quick.action;
    state.gitDialog = 'commit';
    renderDialog();
    return;
  }
  if (quick.action === 'push') {
    maybeConfirm('gitPush');
    return;
  }
  if (quick.action === 'create_pr') {
    maybeConfirm('gitCreateChangeRequest', { stacked: 'create_pr' });
    return;
  }
  if (quick.kind === 'open_publish') {
    state.gitDialog = 'publish';
    renderSheet();
    renderDialog();
    return;
  }
  if (quick.kind === 'open_pr') {
    openPullRequest();
    return;
  }
  setToast(quick.hint);
}

async function loadBranches() {
  if (!state.cwd) return;
  const owner = sessionOwner(state);
  const request = ++state.branchRequest;
  state.gitDialog = 'branch';
  state.branchLoading = true;
  state.gitError = '';
  renderSheet();
  try {
    const result = await gitCall(owner.client, 'git-branch-list', state.cwd, {});
    if (!owner.owns() || request !== state.branchRequest || state.gitDialog !== 'branch') return;
    state.branches = parseBranchList(result);
    state.branchLoading = false;
    renderSheet();
  } catch (error) {
    if (!owner.owns() || request !== state.branchRequest || state.gitDialog !== 'branch') return;
    state.branchLoading = false;
    state.gitError = error.message || '无法列出分支';
    const errorText = state.gitError;
    operationError(errorText, loadBranches, [{ label: '复制错误', onClick: () => copyGitError(errorText) }]);
    renderSheet();
  }
}

function switchBranch(ref) {
  gitAction('gitSwitchBranch', { ref });
}

async function createBranch() {
  if (state.gitRetry?.action.startsWith('create_branch_')) {
    await gitAction('gitCreateBranch', { retry: true });
    return;
  }
  const name = state.newBranchName.trim();
  if (!name) return;
  const continuation = state.gitConfirmAction;
  const stacked = continuation === 'gitCreateChangeRequest' ? 'create_branch_pr' : continuation === 'gitPush' ? 'create_branch_push' : '';
  await gitAction('gitCreateBranch', { name, ...(stacked ? { stacked } : {}) });
}

async function loadCommitFiles() {
  const owner = sessionOwner(state);
  const files = { entries: [], selected: new Set(), loading: true, error: '' };
  state.commitFiles = files;
  try {
    const result = await gitCall(owner.client, 'git-status-entries', state.cwd, {});
    if (!owner.owns() || state.commitFiles !== files) return;
    files.entries = result?.entries || [];
    files.selected = new Set(files.entries.map((entry) => entry.path));
  } catch (error) {
    if (!owner.owns() || state.commitFiles !== files) return;
    files.error = error.message || '读取更改失败';
    operationError(files.error, () => {
      const loading = loadCommitFiles();
      renderDialog();
      return loading;
    });
  }
  files.loading = false;
  if (state.gitDialog === 'commit') renderDialog();
}

/** Legacy HTTP-host flat root listing. The chisacode path uses the Files work loop. */
async function loadFiles() {
  if (!state.cwd || state.transport === 'chisacode') return;
  try {
    const result = await shell('listDir', { cwd: state.cwd, relativePath: '' });
    const entries = Array.isArray(result?.entries) ? result.entries : [];
    state.fileEntries = entries
      .map((entry) => {
        const name = typeof entry?.name === 'string' ? entry.name : '';
        if (!name) return '';
        return entry?.kind === 'directory' ? `${name}/` : name;
      })
      .filter(Boolean);
  } catch (error) {
    showBanner(error.message || '无法列出文件');
  }
  if (state.settingsOpen) renderSettings();
}

// —— Phase 2：Files / Diff / MCP / Skills 工作环（chisacode 只读）—— //

/** Drop cwd-bound work-loop state (session switch, logout). Revokes preview blob URLs. */
function resetWorkPanes() {
  if (state.filesPane?.preview?.blobUrl) {
    URL.revokeObjectURL(state.filesPane.preview.blobUrl);
  }
  state.filesPane = null;
  state.diffPane = null;
  filesBodyHook = null;
}

function ensureFilesPane() {
  if (!state.filesPane) {
    state.filesPane = {
      path: '',
      entries: [],
      loading: false,
      loaded: false,
      error: '',
      loadSeq: 0,
      preview: null,
      search: { query: '', loading: false, error: '', results: [], ran: false },
      scrollTops: {},
      pendingScroll: null,
    };
  }
  return state.filesPane;
}

/** Re-render only the files body (keeps the search input node and its focus). */
let filesBodyHook = null;
function refreshFilesBody() {
  if (filesBodyHook?.node?.isConnected) {
    filesBodyHook.render();
    return;
  }
  if (state.settingsOpen
    && (state.settingsPane === '文件' || (state.settingsPane === '工作区' && state.wsTab === 'files'))) {
    renderSettings();
  }
}

function closeFilePreview() {
  const pane = state.filesPane;
  if (!pane?.preview) return;
  if (pane.preview.blobUrl) URL.revokeObjectURL(pane.preview.blobUrl);
  pane.preview = null;
  pane.pendingScroll = pane.scrollTops[pane.path] ?? 0;
}

/** Navigate the drill-down browser to a relative directory path. Frozen this round. */
async function loadFilesPath() {
  return;
}

async function _unusedLoadFilesPath(path) {
  const pane = ensureFilesPane();
  if (!state.cwd || state.transport !== 'chisacode') return;
  if (pane.preview) {
    closeFilePreview();
  } else if (!pane.search.query.trim()) {
    // Only record listing scroll when the listing itself is on screen.
    pane.scrollTops[pane.path] = options.scrollTop;
  }
  const seq = pane.loadSeq + 1;
  pane.loadSeq = seq;
  pane.loading = true;
  pane.error = '';
  refreshFilesBody();
  try {
    const view = await listDirectoryView(state.chisacode.client, state.cwd, path);
    if (state.filesPane !== pane || pane.loadSeq !== seq) return;
    pane.path = view.path;
    pane.entries = view.entries;
    pane.loaded = true;
    pane.pendingScroll = pane.scrollTops[view.path] ?? 0;
  } catch (error) {
    if (state.filesPane !== pane || pane.loadSeq !== seq) return;
    pane.error = error?.message || '无法读取目录';
  }
  pane.loading = false;
  refreshFilesBody();
}

/** Open the read-only preview for one file entry ({ path, name?, size? }). */
async function openFilePreview(entry) {
  const pane = ensureFilesPane();
  if (!state.cwd || state.transport !== 'chisacode') return;
  if (!pane.preview && !pane.search.query.trim()) {
    pane.scrollTops[pane.path] = options.scrollTop;
  }
  if (pane.preview?.blobUrl) URL.revokeObjectURL(pane.preview.blobUrl);
  const preview = {
    path: entry.path,
    name: entry.name || entry.path.split('/').pop() || entry.path,
    size: Number.isFinite(entry.size) ? entry.size : null,
    loading: false,
    error: '',
    data: null,
    blobUrl: '',
  };
  pane.preview = preview;
  // Known-oversized files are never fetched — honest state without the cost.
  if (previewSizeGate(entry.size)) {
    preview.data = { kind: 'too-large', size: entry.size };
    refreshFilesBody();
    return;
  }
  preview.loading = true;
  refreshFilesBody();
  try {
    const data = await readFilePreview(state.chisacode.client, state.cwd, entry.path);
    if (state.filesPane !== pane || pane.preview !== preview) return;
    preview.data = data;
    preview.size = data.size;
    if (data.kind === 'image') {
      preview.blobUrl = URL.createObjectURL(new Blob([data.bytes], { type: data.mime || 'image/*' }));
    }
  } catch (error) {
    if (state.filesPane !== pane || pane.preview !== preview) return;
    preview.error = error?.message || '无法读取文件';
  }
  preview.loading = false;
  refreshFilesBody();
}

let fileSearchTimer = 0;
async function runFileSearch(query) {
  const pane = ensureFilesPane();
  if (!state.cwd || state.transport !== 'chisacode') return;
  pane.search.loading = true;
  pane.search.error = '';
  refreshFilesBody();
  try {
    const results = await searchWorkspacePaths(state.chisacode.client, state.cwd, query, { limit: 30 });
    if (state.filesPane !== pane || pane.search.query.trim() !== query) return;
    pane.search.results = results;
    pane.search.ran = true;
  } catch (error) {
    if (state.filesPane !== pane || pane.search.query.trim() !== query) return;
    pane.search.error = error?.message || '路径搜索失败';
    pane.search.ran = true;
  }
  pane.search.loading = false;
  refreshFilesBody();
}

/** Signed DEFER: Files tab is a freeze bar; do not call ACP listDirectory. */
function openFilesPane() {
  if (state.transport !== 'chisacode') {
    loadFiles();
  }
}

function ensureDiffPane() {
  if (!state.diffPane) {
    state.diffPane = {
      scope: 'uncommitted',
      loading: false,
      error: '',
      view: null,
      open: {},
      loadSeq: 0,
    };
  }
  return state.diffPane;
}

function refreshDiffBody() {
  if (state.settingsOpen && state.settingsPane === '工作区' && state.wsTab === 'changes') {
    renderSettings();
  }
}

/** Load the read-only diff. Frozen this round — freeze bar only. */
async function loadDiff() {
  return;
}

async function _unusedLoadDiff() {
  const pane = ensureDiffPane();
  if (!state.cwd || state.transport !== 'chisacode') return;
  const seq = pane.loadSeq + 1;
  pane.loadSeq = seq;
  pane.loading = true;
  pane.error = '';
  refreshDiffBody();
  try {
    const view = await fetchMobileDiff(state.chisacode.client, state.cwd, pane.scope);
    if (state.diffPane !== pane || pane.loadSeq !== seq) return;
    pane.view = view;
  } catch (error) {
    if (state.diffPane !== pane || pane.loadSeq !== seq) return;
    pane.error = error?.message || '读取改动失败';
    pane.view = null;
  }
  pane.loading = false;
  refreshDiffBody();
}

function openChangesTab() {
  return;
}

function ensureExtPane(kind) {
  if (!state.extPane[kind]) {
    state.extPane[kind] = { loading: false, loaded: false, error: '', rows: [], notes: [] };
  }
  return state.extPane[kind];
}

/** MCP / skills inventory. Frozen this round — freeze bar only. */
async function loadExtensions() {
  return;
}

async function _unusedLoadExtensions(kind, force = false) {
  if (state.transport !== 'chisacode') return;
  const pane = ensureExtPane(kind);
  if (pane.loading || (pane.loaded && !force)) return;
  pane.loading = true;
  pane.error = '';
  renderExtIfVisible(kind);
  try {
    const result = kind === 'mcp'
      ? await listMobileMcpServers(state.chisacode.client)
      : await listMobileSkills(state.chisacode.client);
    if (state.extPane[kind] !== pane) return;
    pane.rows = result.rows;
    pane.notes = result.errors;
    pane.loaded = true;
  } catch (error) {
    if (state.extPane[kind] !== pane) return;
    pane.error = error?.message || '无法读取清单';
  }
  pane.loading = false;
  renderExtIfVisible(kind);
}

function renderExtIfVisible(kind) {
  const paneName = kind === 'mcp' ? 'MCP' : '技能';
  if (state.settingsOpen && state.settingsPane === paneName) renderSettings();
}

function insertMention(path) {
  draft.value = draft.value ? `${draft.value.trimEnd()} @${path} ` : `@${path} `;
  closeSettings();
  renderComposer();
  draft.focus();
}

async function requestHost(name, payload = {}) {
  if (state.transport === 'chisacode') {
    showBanner('dshd 远程不能控制电脑窗口；请在电脑端操作');
    return;
  }
  try {
    await shell(name, payload);
    setToast(name === 'openGallery'
      ? '已请求电脑打开外观。请在电脑上点浏览图库。'
      : name === 'openSettings' ? '已请求在电脑打开设置' : '已发送到电脑', { tone: 'info' });
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) {
      showBanner(error.message || '电脑没有响应');
    }
  }
}

async function logoutDevice() {
  if (state.transport === 'chisacode') {
    forceLogout('');
    return;
  }
  try {
    await fetch(`${origin}/__remote__/logout`, { credentials: 'include', redirect: 'manual' });
  } catch { /* 网络失败也照样清态回连接页 */ }
  forceLogout('');
}

// —— 设置 overlay（M4 Hub 钻取 + M5 工作区/文件 pane）—— //

function openSettings(pane = '') {
  if (navigationBusy()) return;
  state.pickerSheet = '';
  state.pickerPage = '';
  state.attachOpen = false;
  state.newSession = null;
  state.history = null;
  state.sessionMenu = '';
  state.workspaceMenu = '';
  state.gitDialog = '';
  clearExclusiveDialogs();
  renderSheet(); renderDialog();
  state.settingsOpen = true;
  state.settingsPane = pane;
  state.sessionsOpen = false;
  if (pane === '模型') state.modelPane = null;
  setDrawerOpen(false);
  renderSettings();
  renderScreen();
}

function closeSettings() {
  state.settingsOpen = false;
  state.settingsPane = '';
  renderScreen();
}

function noticeNode(text) {
  const notice = document.createElement('p');
  notice.className = 'notice';
  notice.textContent = text;
  return notice;
}

function paneTitleNode(text) {
  const node = document.createElement('h3');
  node.className = 'pane-title';
  node.textContent = text;
  return node;
}

/**
 * Settings section: a small header (title + optional description) above its
 * controls. Every pane composes from these so the vertical rhythm is one
 * rule (24px between sections, 8px inside) instead of every element getting
 * the same gap regardless of what it is.
 */
function sectionNode(title, desc, ...children) {
  const section = document.createElement('section');
  section.className = 'set-section';
  if (title || desc) {
    const head = document.createElement('div');
    head.className = 'set-section-head';
    if (title) {
      const heading = document.createElement('h3');
      heading.className = 'set-section-title';
      heading.textContent = title;
      head.append(heading);
    }
    if (desc) head.append(descNode(desc, 'set-section-desc'));
    section.append(head);
  }
  for (const child of children) {
    if (child) section.append(child);
  }
  return section;
}

/** Right-aligned read-only value for a hair row. */
function valueNode(text) {
  const node = document.createElement('span');
  node.className = 'hair-value';
  node.textContent = text;
  node.title = text;
  return node;
}

/** Grouped card holding rows (hair rows, list items, inputs). */
function groupNode(...children) {
  const group = document.createElement('div');
  group.className = 'group';
  for (const child of children) {
    if (child) group.append(child);
  }
  return group;
}

function descNode(text, cls = 'row-desc') {
  const node = document.createElement('p');
  node.className = cls;
  node.textContent = text;
  return node;
}

function ghostButton(label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ghost-btn';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function primaryButton(label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'primary-btn';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function fieldInput(value, placeholder, onInput) {
  const input = document.createElement('input');
  input.className = 'paste';
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  input.addEventListener('input', () => onInput(input.value));
  return input;
}

function hairRow(title, desc, trailing) {
  const row = document.createElement('div');
  row.className = 'hair';
  const grow = document.createElement('div');
  grow.className = 'grow';
  const titleNode = document.createElement('div');
  titleNode.className = 'hair-title';
  titleNode.textContent = title;
  grow.append(titleNode);
  if (desc) grow.append(descNode(desc));
  row.append(grow);
  if (trailing) row.append(trailing);
  return row;
}

function switchNode(on, onToggle) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'switch';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-pressed', String(on));
  button.addEventListener('click', onToggle);
  return button;
}

const SETTINGS_ROW_ICONS = {
  '通用设置': '<path d="M4 14.5 3 17l3.2-1.1A7 7 0 1 0 4 14.5Z"/>',
  '权限': '<path d="M10 2.5 4 5v4.5c0 3.6 2.6 6.6 6 8 3.4-1.4 6-4.4 6-8V5l-6-2.5Z"/>',
  '模型': '<path d="M10 2.5v4M10 13.5v4M2.5 10h4M13.5 10h4M4.7 4.7l2.8 2.8M12.5 12.5l2.8 2.8M15.3 4.7l-2.8 2.8M7.5 12.5l-2.8 2.8"/>',
  '文件': '<path d="M5 2.5h6.5L15 6v11.5H5v-15Z"/><path d="M11 2.5V6.5h4"/>',
  '外观': '<path d="M16 12.5A6.5 6.5 0 0 1 7.5 4a6.5 6.5 0 1 0 8.5 8.5Z"/>',
  '电脑外观': '<rect x="2.5" y="3.5" width="15" height="10" rx="1.5"/><path d="M7 16.5h6M10 13.5v3"/>',
  '界面设置': '<path d="M4 6.5h12M4 13.5h12"/><circle cx="8" cy="6.5" r="2"/><circle cx="13" cy="13.5" r="2"/>',
  'MCP': '<path d="M7 3v4M13 3v4M5 7h10v3a5 5 0 0 1-10 0V7ZM10 15v2.5"/>',
  '技能': '<path d="M4 3.5h9.5A2.5 2.5 0 0 1 16 6v10.5H6.5A2.5 2.5 0 0 1 4 14V3.5Z"/><path d="M4 14a2.5 2.5 0 0 1 2.5-2.5H16"/>',
  '插件': '<path d="M8 3.5v3M8 13.5v3M3.5 8h3M13.5 8h3"/><path d="M5.5 5.5h9v9h-9z"/>',
  '市场': '<path d="M4 7h12l-1 9.5H5L4 7Z"/><path d="M7.5 9.5a2.5 2.5 0 0 0 5 0"/>',
  '关于': '<circle cx="10" cy="10" r="7"/><path d="M10 9v4.5M10 6.5v.01"/>',
};

function settingsRowIcon(pane) {
  const path = SETTINGS_ROW_ICONS[pane] || SETTINGS_ROW_ICONS['关于'];
  return `<svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><g stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${path}</g></svg>`;
}

function openSettingsRow(pane) {
  if (pane === '模型' || pane === '权限') {
    state.settingsOpen = false;
    state.settingsPane = '';
    renderScreen();
    openPicker(pane === '模型' ? 'model' : 'mode');
    return;
  }
  state.settingsPane = pane;
  if (pane === '工作区') {
    refreshGit();
    if (state.wsTab === 'files') openFilesPane();
    else openChangesTab();
  }
  if (pane === '文件') openFilesPane();
  if (pane === '模型') state.modelPane = null;
  if (pane === 'MCP') void loadExtensions('mcp');
  if (pane === '技能') void loadExtensions('skills');
  renderSettings();
}

function renderSettingsHub() {
  // Computer card: this phone's connected host + a 「已连接」tag.
  const computer = document.createElement('button');
  computer.type = 'button';
  computer.className = 'group acct';
  const host = document.createElement('b');
  host.textContent = state.hostName;
  const tag = document.createElement('span');
  tag.className = 'acct-tag';
  tag.textContent = '已连接';
  computer.append(host, tag);
  computer.addEventListener('click', () => openSettingsRow('连接详情'));
  options.append(computer);

  // Current workspace card (only when a workspace/title is known).
  const row = currentRow();
  const wsTitle = row?.workspaceTitle
    || state.workspaces?.items?.find((item) => item?.title)?.title || '';
  if (wsTitle) {
    const card = document.createElement('div');
    card.className = 'group promo';
    const h = document.createElement('h3');
    h.textContent = wsTitle;
    const p = document.createElement('p');
    p.textContent = gitStatusLine(state.gitStatus);
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'primary-btn promo-btn';
    open.textContent = '打开工作区';
    open.addEventListener('click', () => openSettingsRow('工作区'));
    card.append(h, p, open);
    options.append(card);
  }

  // One card per settings group, no group labels; rows already represented
  // elsewhere (连接详情 / 工作区 / logout) are skipped.
  const groups = settingsGroups({
    channel: connectionLabel(),
    accessMode: currentModeState().currentLabel,
    gitLine: gitStatusLine(state.gitStatus),
    scheme: store.scheme,
    remoteReadOnly: state.transport === 'chisacode',
  });
  for (const group of groups) {
    const rows = group.rows.filter((item) => (
      !item.danger && item.action !== 'logout' && item.pane !== '连接详情' && item.pane !== '工作区'
    ));
    if (!rows.length) continue;
    const body = document.createElement('div');
    body.className = 'group';
    for (const item of rows) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'link-row';
      button.append(svgNode(settingsRowIcon(item.pane)));
      const main = document.createElement('span');
      main.className = 'link-main';
      const title = document.createElement('span');
      title.className = 'link-title';
      title.textContent = item.pane;
      const desc = document.createElement('span');
      desc.className = 'link-desc';
      desc.textContent = item.desc;
      main.append(title, desc);
      const chev = document.createElement('span');
      chev.className = 'chev';
      chev.textContent = '›';
      button.append(main, chev);
      button.addEventListener('click', () => openSettingsRow(item.pane));
      body.append(button);
    }
    options.append(body);
  }

  // Danger card at the bottom, then the notice as a bare caption.
  const danger = document.createElement('div');
  danger.className = 'group';
  const dangerRow = document.createElement('button');
  dangerRow.type = 'button';
  dangerRow.className = 'link-row danger';
  dangerRow.append(svgNode('<svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M8 3.5H4.5v13H8M12 6.5 15.5 10 12 13.5M15.5 10H7.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'));
  const dangerMain = document.createElement('span');
  dangerMain.className = 'link-main';
  const dangerTitle = document.createElement('span');
  dangerTitle.className = 'link-title';
  dangerTitle.textContent = '断开这台设备';
  dangerMain.append(dangerTitle);
  dangerRow.append(dangerMain);
  dangerRow.addEventListener('click', () => logoutDevice());
  danger.append(dangerRow);
  options.append(danger);

  const notice = descNode(state.transport === 'chisacode'
    ? '手机外观和会话选项只留在本机；电脑窗口设置请在电脑端操作。'
    : '远程页上的改动只留在这次连接，不会写回电脑上的 settings.yaml。标了「电脑」的项会改 Host 窗口。',
    'row-desc settings-note');
  options.append(notice);
}

function renderPhoneAppearance() {
  options.append(noticeNode('只改这台手机。电脑窗口的色制和背景图在「电脑外观」。'));

  const tiles = document.createElement('div');
  tiles.className = 'tiles';
  for (const [id, label] of [['light', '浅色'], ['dark', '深色'], ['system', '跟随系统']]) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'tile';
    tile.textContent = label;
    tile.setAttribute('aria-pressed', String(store.scheme === id));
    tile.addEventListener('click', () => {
      store.scheme = id;
      persistPhoneStore('scheme', id);
      applyAppearance();
      renderSettings();
    });
    tiles.append(tile);
  }
  options.append(sectionNode('色制', '这台手机用浅色、深色，还是跟随系统。', tiles));

  const sliderRow = document.createElement('div');
  sliderRow.className = 'slider-row';
  const sliderValue = document.createElement('span');
  sliderValue.className = 'slider-value';
  sliderValue.textContent = `${store.glass}%`;
  const slider = document.createElement('input');
  slider.className = 'slider';
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.value = String(store.glass);
  slider.setAttribute('aria-label', '玻璃透明度');
  slider.style.setProperty('--fill', `${store.glass}%`);
  slider.addEventListener('input', () => {
    store.glass = Number(slider.value);
    slider.style.setProperty('--fill', `${store.glass}%`);
    sliderValue.textContent = `${store.glass}%`;
    persistPhoneStore('glass', store.glass);
    applyAppearance();
  });
  sliderRow.append(slider, sliderValue);
  options.append(sectionNode('玻璃透明度', '这台手机的毛玻璃。数值越低越通透。不改电脑窗口。', groupNode(sliderRow)));

  const fontInput = fieldInput(store.uiFont, '系统默认', (value) => {
    store.uiFont = value;
    persistPhoneStore('uiFont', value);
    applyAppearance();
  });
  fontInput.setAttribute('aria-label', '界面字体');
  options.append(sectionNode(
    '字体',
    '留空则用系统默认。只作用于这台手机。',
    groupNode(hairRow('界面字体', '', fontInput)),
  ));
}

function gitCapsuleNode() {
  const quick = currentQuick();
  const capsule = document.createElement('div');
  capsule.className = 'git-capsule';
  const branch = document.createElement('button');
  branch.type = 'button';
  branch.className = 'cap-branch';
  branch.disabled = state.gitBusy;
  const branchLabel = document.createElement('span');
  branchLabel.textContent = state.gitStatus.refName ?? '—';
  branch.append(branchLabel, document.createTextNode(' ▾'));
  branch.addEventListener('click', () => loadBranches());
  const primary = document.createElement('button');
  primary.type = 'button';
  primary.className = 'cap-primary';
  primary.disabled = quick.disabled || state.gitBusy;
  const primaryLabel = document.createElement('span');
  primaryLabel.textContent = quick.label;
  primary.append(primaryLabel);
  primary.dataset.gitFeedback = '';
  buttonBusy(primary, state.gitBusy, { label: gitBusyLabel() });
  primary.addEventListener('click', () => runGitPrimary());
  const menu = document.createElement('button');
  menu.type = 'button';
  menu.className = 'cap-menu';
  menu.disabled = state.gitBusy;
  menu.setAttribute('aria-label', 'Git 操作');
  menu.textContent = '▾';
  menu.addEventListener('click', () => {
    state.gitDialog = 'menu';
    renderSheet();
  });
  const dividerA = document.createElement('span');
  dividerA.className = 'divider';
  const dividerB = document.createElement('span');
  dividerB.className = 'divider';
  capsule.append(branch, dividerA, primary, dividerB, menu);
  return capsule;
}

function renderLegacyFilesInto(target) {
  const list = document.createElement('div');
  const renderRows = () => {
    const query = state.fileQuery.trim();
    const rows = state.fileEntries.filter((path) => !query || path.includes(query));
    if (!rows.length) {
      list.replaceChildren(descNode('没有匹配的文件'));
      return;
    }
    list.replaceChildren(...rows.map((path) => {
      const clean = path.replace(/\/$/, '');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'file-row';
      const main = document.createElement('span');
      main.className = 'file-main';
      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = clean.split('/').pop() || path;
      const full = document.createElement('span');
      full.className = 'file-path';
      full.textContent = path;
      main.append(name, full);
      button.append(main);
      button.addEventListener('click', () => insertMention(clean));
      return button;
    }));
  };
  target.append(fieldInput(state.fileQuery, '搜索文件', (value) => {
    state.fileQuery = value;
    renderRows();
  }), list);
  renderRows();
}

function mentionButton(path) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'file-insert';
  button.textContent = '@';
  button.setAttribute('aria-label', `把 ${path} 插入输入框`);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    insertMention(path);
  });
  return button;
}

function fileEntryRow(entry, { onOpen, showPath = false } = {}) {
  const row = document.createElement('div');
  row.className = 'file-row';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'file-open';
  const main = document.createElement('span');
  main.className = 'file-main';
  const name = document.createElement('span');
  name.className = 'file-name';
  const baseName = entry.name || entry.path.split('/').pop() || entry.path;
  name.textContent = entry.kind === 'directory' ? `${baseName}/` : baseName;
  main.append(name);
  if (showPath) {
    const full = document.createElement('span');
    full.className = 'file-path';
    full.textContent = entry.path;
    main.append(full);
  } else if (entry.kind === 'file') {
    const meta = document.createElement('span');
    meta.className = 'file-path';
    meta.textContent = fileSizeLabel(entry.size);
    main.append(meta);
  }
  button.append(main);
  button.addEventListener('click', () => onOpen(entry));
  row.append(button, mentionButton(entry.path));
  return row;
}

function filePreviewNodes(pane) {
  const preview = pane.preview;
  const nodes = [];
  const bar = document.createElement('div');
  bar.className = 'preview-bar';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'preview-back';
  back.textContent = '‹ 返回';
  back.addEventListener('click', () => {
    closeFilePreview();
    refreshFilesBody();
  });
  const title = document.createElement('span');
  title.className = 'preview-title';
  title.textContent = preview.path;
  bar.append(back, title);
  nodes.push(bar);
  const meta = [];
  if (Number.isFinite(preview.size)) meta.push(fileSizeLabel(preview.size));
  meta.push('只读预览');
  nodes.push(descNode(meta.join(' · ')));
  nodes.push(primaryButton('插入 @路径 到输入框', () => insertMention(preview.path)));
  if (preview.loading) {
    nodes.push(descNode('正在读取文件…'));
    return nodes;
  }
  if (preview.error) {
    nodes.push(descNode(`读取失败：${preview.error}`));
    nodes.push(ghostButton('重试', () => {
      void openFilePreview({ path: preview.path, name: preview.name, size: null });
    }));
    return nodes;
  }
  const data = preview.data;
  if (!data) return nodes;
  if (data.kind === 'too-large') {
    nodes.push(descNode(`文件过大（${fileSizeLabel(data.size)}），手机端不预览超过 2 MB 的文件。请在电脑端打开。`));
    return nodes;
  }
  if (data.kind === 'binary') {
    nodes.push(descNode(`二进制文件（${data.mime || '未知类型'}），手机端不预览。请在电脑端打开。`));
    return nodes;
  }
  if (data.kind === 'image') {
    const img = document.createElement('img');
    img.className = 'preview-image';
    img.alt = preview.path;
    img.src = preview.blobUrl;
    nodes.push(img);
    return nodes;
  }
  if (data.truncated) {
    nodes.push(descNode('文件较长，仅显示前 200 KB。'));
  }
  const pre = document.createElement('pre');
  pre.className = 'preview-text';
  pre.textContent = data.text;
  nodes.push(pre);
  return nodes;
}

function fileSearchNodes(pane) {
  const nodes = [descNode('按路径匹配（daemon 模糊建议），不是内容全文搜索。')];
  if (pane.search.loading) {
    nodes.push(descNode('正在搜索…'));
    return nodes;
  }
  if (pane.search.error) {
    nodes.push(descNode(`搜索失败：${pane.search.error}`));
    return nodes;
  }
  if (!pane.search.ran) return nodes;
  if (!pane.search.results.length) {
    nodes.push(descNode('没有匹配的路径'));
    return nodes;
  }
  for (const entry of pane.search.results) {
    nodes.push(fileEntryRow(entry, {
      showPath: true,
      onOpen: (hit) => {
        pane.search.query = '';
        pane.search.results = [];
        pane.search.ran = false;
        if (hit.kind === 'directory') {
          void loadFilesPath(hit.path);
        } else {
          void openFilePreview({ path: hit.path, size: null });
          refreshFilesBody();
        }
        renderSettings();
      },
    }));
  }
  return nodes;
}

function fileBrowserNodes(pane) {
  const nodes = [];
  const crumbs = document.createElement('div');
  crumbs.className = 'crumbs';
  const segments = breadcrumbSegments(pane.path);
  segments.forEach((segment, index) => {
    if (index > 0) {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '/';
      crumbs.append(sep);
    }
    const crumb = document.createElement('button');
    crumb.type = 'button';
    crumb.className = 'crumb';
    crumb.textContent = segment.label;
    crumb.disabled = index === segments.length - 1;
    crumb.addEventListener('click', () => {
      void loadFilesPath(segment.path);
    });
    crumbs.append(crumb);
  });
  nodes.push(crumbs);
  if (pane.loading) {
    nodes.push(descNode('正在读取目录…'));
    return nodes;
  }
  if (pane.error) {
    nodes.push(descNode(`读取目录失败：${pane.error}`));
    nodes.push(ghostButton('重试', () => { void loadFilesPath(pane.path); }));
    return nodes;
  }
  if (!pane.entries.length) {
    nodes.push(descNode('这个目录是空的'));
    return nodes;
  }
  for (const entry of pane.entries) {
    nodes.push(fileEntryRow(entry, {
      onOpen: (hit) => {
        if (hit.kind === 'directory') {
          void loadFilesPath(hit.path);
        } else {
          void openFilePreview(hit);
        }
      },
    }));
  }
  return nodes;
}

function renderFrozenPane(target, kind) {
  const pane = freezePane(kind);
  target.append(noticeNode(pane.body));
}

/** Files / Diff / MCP / Skills: signed DEFER freeze — never an empty list. */
function renderFilesInto(target) {
  renderFrozenPane(target, 'files');
}

function renderDiffInto(target) {
  renderFrozenPane(target, 'diff');
}

function renderExtensionsPane(kind) {
  renderFrozenPane(options, kind);
}

async function changeAgentMode(modeId) {
  if (!state.sessionId || state.modeBusy) return;
  const owner = sessionOwner(state);
  state.pickerError = '';
  const before = state.permission.current;
  if (before === modeId) return;
  state.modeBusy = true;
  state.permission = { ...state.permission, current: modeId, planOn: modeId === 'plan' };
  renderComposer();
  renderSettings();
  if (state.pickerSheet) renderSheet();
  try {
    await runHostCommand(permissionCommand(modeId));
    if (!owner.owns()) return;
    showBanner('');
  } catch (error) {
    if (!owner.owns()) return;
    state.permission = { ...state.permission, current: before, planOn: before === 'plan' };
    state.pickerError = error?.message || '切换权限失败';
    showBanner(`切换权限模式失败：${error?.message || '电脑没有响应'}`);
    operationError(`切换权限模式失败：${error?.message || '电脑没有响应'}`, () => changeAgentMode(modeId));
  } finally {
    if (!owner.owns()) return;
    state.modeBusy = false;
    renderComposer();
    renderSettings();
    if (state.pickerSheet === 'mode') renderSheet();
  }
}

function renderModePane() {
  if (!state.sessionId) {
    options.append(descNode('先打开一个会话。权限预设来自正在跑的 dsh web。'));
    return;
  }
  const group = document.createElement('div');
  group.className = 'group';
  for (const mode of DEFAULT_PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sheet-item mode-row';
    button.disabled = state.modeBusy;
    button.setAttribute('aria-pressed', String(mode.id === state.permission.current));
    const main = document.createElement('span');
    main.className = 'sheet-item-main';
    const title = document.createElement('span');
    title.textContent = mode.label;
    main.append(title);
    button.append(main);
    if (mode.id === state.permission.current) {
      const mark = document.createElement('span');
      mark.className = 'mode-current';
      mark.textContent = '当前';
      button.append(mark);
    }
    buttonBusy(button, state.modeBusy && mode.id === state.permission.current, { label: '切换中…' });
    button.addEventListener('click', () => changeAgentMode(mode.id));
    group.append(button);
  }
  options.append(sectionNode('权限预设', '切换会发送 /permission <id>，失败会回滚。', group));
}

async function changeAgentModel(provider, model, reasoningEffort) {
  if (!state.sessionId || state.modelBusy) return;
  const owner = sessionOwner(state);
  state.pickerError = '';
  const before = state.modelCatalog.current;
  state.modelBusy = true;
  state.modelCatalog = {
    ...state.modelCatalog,
    current: { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) },
  };
  renderComposer();
  renderSettings();
  if (state.pickerSheet === 'model') renderSheet();
  try {
    const selected = await hostCall(owner.client, 'session.selectModel', {
      sessionId: owner.sessionId,
      provider,
      model,
      ...(reasoningEffort ? { reasoningEffort } : {}),
    });
    if (!owner.owns()) return;
    state.modelCatalog = {
      ...state.modelCatalog,
      current: selected?.selected || { provider, model, reasoningEffort },
    };
    showBanner('');
  } catch (error) {
    if (!owner.owns()) return;
    state.modelCatalog = { ...state.modelCatalog, current: before };
    state.pickerError = error?.message || '切换模型失败';
    showBanner(`切换模型失败：${error?.message || '电脑没有响应'}`);
    operationError(`切换模型失败：${error?.message || '电脑没有响应'}`, () => changeAgentModel(provider, model, reasoningEffort));
  } finally {
    if (!owner.owns()) return;
    state.modelBusy = false;
    renderComposer();
    renderSettings();
    if (state.pickerSheet === 'model') renderSheet();
  }
}

function loadModelPane() {
  if (!state.sessionId) return;
  const owner = sessionOwner(state);
  const pane = { loading: true, error: '', rows: [] };
  state.modelPane = pane;
  hostCall(state.chisacode.client, 'session.models', { sessionId: state.sessionId })
    .then((catalog) => {
      if (state.modelPane !== pane || !owner.owns()) return;
      state.modelCatalogRaw = catalog;
      state.modelCatalog = flattenModels(catalog, currentModelSelectionProjection());
      state.modelPane = { loading: false, error: '', rows: state.modelCatalog.rows };
      renderSettings();
      if (state.pickerSheet === 'model') renderSheet();
    })
    .catch((error) => {
      if (state.modelPane !== pane || !owner.owns()) return;
      state.modelPane = { loading: false, error: error?.message || '电脑没有响应', rows: [] };
      operationError(`读取模型失败：${state.modelPane.error}`, () => { loadModelPane(); renderSettings(); renderSheet(); });
      renderSettings();
      if (state.pickerSheet === 'model') renderSheet();
    });
}

function renderModelPane() {
  if (!state.sessionId) {
    options.append(descNode('先打开一个会话。模型来自 session.models。'));
    return;
  }
  if (!state.modelPane) loadModelPane();
  const pane = state.modelPane;
  const { current, rows } = state.modelCatalog;
  options.append(sectionNode(
    null,
    null,
    groupNode(hairRow('当前模型', modelChipLabel(current, rows))),
  ));
  if (pane?.loading) {
    surfaceBusy(options, true);
    return;
  }
  surfaceBusy(options, false);
  if (pane?.error) {
    return;
  }
  const group = document.createElement('div');
  group.className = 'group';
  for (const row of rows) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sheet-item mode-row';
    const routable = isRoutable(row);
    button.disabled = state.modelBusy || !routable;
    button.setAttribute('aria-pressed', String(current?.provider === row.provider && current?.model === row.id));
    const main = document.createElement('span');
    main.className = 'sheet-item-main';
    const title = document.createElement('span');
    title.textContent = row.name;
    main.append(title);
    const hint = document.createElement('span');
    hint.className = 'sheet-hint';
    hint.textContent = [
      row.providerName,
      !routable ? '未配置 API Key' : (row.reasoning ? '含思考档' : ''),
    ].filter(Boolean).join(' · ');
    main.append(hint);
    button.append(main);
    buttonBusy(button, state.modelBusy && current?.provider === row.provider && current?.model === row.id, { label: '切换中…' });
    if (routable) button.addEventListener('click', () => changeAgentModel(row.provider, row.id));
    group.append(button);
  }
  options.append(sectionNode('可选模型', '模型清单来自正在跑的 dsh web；切换会立即写回这个会话。', group));
  const efforts = effortsFor(current, rows);
  if (efforts.length) {
    const effortGroup = document.createElement('div');
    effortGroup.className = 'group';
    for (const effort of efforts) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sheet-item mode-row';
      button.setAttribute('aria-pressed', String(current?.reasoningEffort === effort.id));
      button.disabled = state.modelBusy;
      const main = document.createElement('span');
      main.className = 'sheet-item-main';
      main.textContent = effort.name || effort.id;
      button.append(main);
      if (current?.reasoningEffort === effort.id) {
        const mark = document.createElement('span');
        mark.className = 'mode-current';
        mark.textContent = '当前';
        button.append(mark);
      }
      buttonBusy(button, state.modelBusy && current?.reasoningEffort === effort.id, { label: '切换中…' });
      button.addEventListener('click', () => {
        if (current) changeAgentModel(current.provider, current.model, effort.id);
      });
      effortGroup.append(button);
    }
    options.append(sectionNode('思考强度', '只对当前模型生效。', effortGroup));
  }
}

function renderWorkspacePane() {
  const gitBlock = document.createElement('div');
  gitBlock.className = 'git-block';
  gitBlock.append(gitCapsuleNode(), descNode(gitStatusLine(state.gitStatus), 'row-desc git-status-line'));
  options.append(gitBlock);
  const tabs = document.createElement('div');
  tabs.className = 'ws-tabs';
  for (const [id, label] of [['changes', '更改'], ['files', '文件']]) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'ws-tab';
    tab.setAttribute('aria-selected', String(state.wsTab === id));
    tab.textContent = label;
    tab.addEventListener('click', () => {
      state.wsTab = id;
      if (id === 'files') openFilesPane();
      if (id === 'changes') openChangesTab();
      renderSettings();
    });
    tabs.append(tab);
  }
  options.append(tabs);
  if (state.wsTab === 'files') {
    renderFilesInto(options);
  } else if (state.transport === 'chisacode') {
    renderDiffInto(options);
  } else {
    options.append(descNode(state.gitStatus.hasWorkingTreeChanges
      ? '有未提交更改。用顶部胶囊提交，或到文件 Tab 插入路径。'
      : '工作区是干净的。'));
  }
}

function renderHostRequestPane(pane) {
  if (state.transport === 'chisacode') {
    const unavailable = primaryButton(`请在电脑端打开${pane}`, () => {});
    unavailable.disabled = true;
    options.append(sectionNode(null, 'dshd 远程不控制电脑窗口。请在电脑端打开对应设置。', unavailable));
    return;
  }
  const section = hostSettingsSection(pane);
  if (section) {
    options.append(sectionNode(
      null,
      '这些项在电脑 Host 上。手机只发送打开请求，不画假清单。',
      primaryButton(`在电脑上打开${pane}`, () => requestHost('openSettings', { sectionId: section })),
    ));
    return;
  }
  options.append(sectionNode(
    null,
    '会话内选项只留在这次连接。电脑窗口关闭行为请在电脑设置里改。',
    ghostButton('在电脑上打开设置', () => requestHost('openSettings')),
  ));
}


function renderSettings() {
  scheduleNavigation();
  const savedScroll = settingsScroll.get(state.settingsPane) || 0;
  queueMicrotask(() => { options.scrollTop = savedScroll; });
  if (!state.settingsOpen) return;
  const pane = state.settingsPane;
  settings.toggleAttribute('data-task', pane === '工作区' || pane === '文件');
  settingsTitle.textContent = pane || '设置';
  settingsBack.classList.toggle('hidden', !pane);
  el('close-settings').classList.remove('hidden');
  clearButtonBusy(options);
  options.replaceChildren();
  surfaceBusy(options, false);
  if (!pane) {
    renderSettingsHub();
    return;
  }
  if (pane === '外观') {
    renderPhoneAppearance();
    return;
  }
  if (pane === '工作区') {
    renderWorkspacePane();
    return;
  }
  if (pane === '文件') {
    renderFilesInto(options);
    return;
  }
  if (pane === '电脑外观') {
    if (state.transport === 'chisacode') {
      renderHostRequestPane('电脑外观');
      return;
    }
    options.append(noticeNode('图库窗口在电脑上。这里可以请电脑打开外观。'));
    const actions = document.createElement('div');
    actions.className = 'set-actions';
    actions.append(
      ghostButton('在电脑上打开图库', () => requestHost('openGallery')),
      ghostButton('在电脑上打开外观', () => requestHost('openSettings', { sectionId: 'appearance' })),
    );
    options.append(sectionNode('背景图', null, actions));
    return;
  }
  if (pane === '界面设置') {
    options.append(sectionNode(
      '手机',
      null,
      groupNode(hairRow(
        '标题栏 Git 操作',
        '电脑宽屏标题栏和手机对话页头显示分支胶囊。工作区顶部的 Git 操作始终可用。',
        switchNode(store.gitTitle, () => {
          store.gitTitle = !store.gitTitle;
          persistPhoneStore('gitTitle', store.gitTitle);
          renderHeader();
          renderSettings();
        }),
      )),
    ));
    const hostSettings = ghostButton(
      state.transport === 'chisacode' ? '请在电脑端打开界面设置' : '在电脑上打开界面设置',
      () => requestHost('openSettings'),
    );
    hostSettings.disabled = state.transport === 'chisacode';
    options.append(sectionNode(
      '电脑',
      state.transport === 'chisacode' ? '标题栏 Git、分栏、日志等窗口设置只能在电脑端修改。' : null,
      hostSettings,
    ));
    return;
  }
  if (pane === '连接详情') {
    options.append(noticeNode('远程页上的改动只留在这次连接，不会写回电脑上的 settings.yaml。'));
    options.append(sectionNode(
      null,
      null,
      groupNode(
        hairRow('主机', '', valueNode(state.hostName)),
        hairRow('通道', '', valueNode(connectionLabel())),
      ),
    ));
    const danger = document.createElement('button');
    danger.type = 'button';
    danger.className = 'danger-btn';
    danger.textContent = '断开这台设备';
    danger.addEventListener('click', () => logoutDevice());
    options.append(sectionNode(null, null, danger));
    return;
  }
  if (pane === '权限') {
    renderModePane();
    return;
  }
  if (pane === '模型') {
    renderModelPane();
    return;
  }
  if ((pane === 'MCP' || pane === '技能') && state.transport === 'chisacode') {
    renderExtensionsPane(pane === 'MCP' ? 'mcp' : 'skills');
    return;
  }
  renderHostRequestPane(pane);
}

// —— sheet / dialog / toast / lightbox —— //

function sheetItem({ label, hint = '', enabled = true, onClick }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sheet-item';
  button.disabled = !enabled;
  const main = document.createElement('span');
  main.className = 'sheet-item-main';
  const title = document.createElement('span');
  title.textContent = label;
  main.append(title);
  if (hint) {
    const hintNode = document.createElement('span');
    hintNode.className = 'sheet-hint';
    hintNode.textContent = hint;
    main.append(hintNode);
  }
  button.append(main);
  if (enabled) button.addEventListener('click', onClick);
  return button;
}

function sheetLayer(title, closeSheet) {
  const task = Boolean(state.newSession?.step === 'browse' || state.history || state.gitDialog === 'branch');
  const modal = !task && Boolean(state.newSession || state.pickerSheet === 'model');
  const anchor = state.pickerSheet || state.attachOpen ? 'composer' : state.gitDialog === 'menu' ? 'header' : 'viewport';
  const result = createSurface(document, {
    title, task, variant: task ? 'task' : modal ? 'modal' : 'menu', anchor,
    onClose: () => { if (!navigationBusy()) closeSheet(); },
    onBack: (task || (modal && state.pickerSheet === 'model' && state.pickerPage))
      ? () => navigation.back()
      : null,
  });
  result.panel.setAttribute('aria-label', title);
  if (!task && !modal) {
    const trigger = state.attachOpen ? el('attach-toggle') : state.pickerSheet === 'mode' ? accessChip
      : state.gitDialog === 'menu' ? gitPill
      : state.sessionMenu ? [...el('drawer').querySelectorAll('.session-row')].find((node) => node.dataset.sessionId === state.sessionMenu)?.querySelector('.session-more')
      : state.workspaceMenu ? [...el('drawer').querySelectorAll('.workspace-head')].find((node) => node.dataset.workspaceId === state.workspaceMenu)?.querySelector('.session-more:last-child')
      : null;
    const bounds = trigger?.getBoundingClientRect?.();
    const frame = phone.getBoundingClientRect();
    if (bounds) {
      const above = anchor === 'composer' || frame.bottom - bounds.bottom < Math.min(240, frame.height / 2);
      result.layer.dataset.placement = above ? 'above' : 'below';
      result.layer.style.setProperty('--menu-x', `${Math.max(12, Math.min(bounds.left - frame.left, frame.width - 292))}px`);
      result.layer.style.setProperty('--menu-y', `${Math.max(12, bounds.bottom - frame.top + 8)}px`);
      result.layer.style.setProperty('--menu-bottom', `${Math.max(12, frame.bottom - bounds.top + 8)}px`);
      result.layer.style.setProperty('--menu-height', `${Math.max(80, above ? bounds.top - frame.top - 20 : frame.bottom - bounds.bottom - 20)}px`);
    }
  }
  return { layer: result.layer, sheet: result.content };
}

function closeGitLayer() {
  if (state.gitBusy) return;
  state.gitDialog = '';
  state.gitConfirmAction = '';
  state.gitConfirmExtra = {};
  renderSheet();
  renderDialog();
}

function newSessionStepTitle(step) {
  if (step === 'browse') return '新会话 · 浏览本机目录';
  return '新会话 · 选择工作区';
}

function renderNewSessionSheet() {
  const session = state.newSession;
  const { layer, sheet } = sheetLayer(newSessionStepTitle(session.step), () => {
    state.newSession = null;
    renderSheet();
  });
  surfaceBusy(sheet, session.loading);
  if (session.createdSessionId) {
    sheet.append(primaryButton('打开已创建会话', retryCreatedSession));
    sheetRoot.append(layer);
    return;
  }
  if (session.step === 'workspace') {
    for (const preset of session.presets || []) {
      sheet.append(sheetItem({
        label: `预设 · ${preset.name}`,
        hint: '用此智能体预设开新会话',
        enabled: !session.loading,
        onClick: () => chooseNewSessionWorkspace(null, { agentPreset: preset.id }),
      }));
    }
    for (const workspace of session.workspaces) {
      sheet.append(sheetItem({
        label: workspace.name,
        hint: workspace.cwd || '',
        enabled: !session.loading,
        onClick: () => chooseNewSessionWorkspace(workspace),
      }));
    }
  } else if (session.step === 'browse' && session.browse) {
    const browse = session.browse;
    sheet.append(descNode(browse.path || ''));
    const crumbs = Array.isArray(browse.crumbs) ? browse.crumbs : [];
    if (crumbs.length > 1) {
      const parent = crumbs[crumbs.length - 2];
      sheet.append(sheetItem({
        label: '上层目录',
        hint: parent.path,
        enabled: !session.loading,
        onClick: () => browseDirectory(parent.path),
      }));
    }
    for (const entry of browse.entries || []) {
      sheet.append(sheetItem({
        label: entry.name,
        hint: entry.path,
        enabled: !session.loading,
        onClick: () => browseDirectory(entry.path),
      }));
    }
    const actions = document.createElement('footer');
    actions.className = 'task-actions';
    const createFolder = ghostButton('新建文件夹', startFolderCreate);
    const useDirectory = buttonBusy(primaryButton('使用此目录作为工作区', createBrowsedWorkspace), session.creating, { label: '创建中…' });
    createFolder.disabled = session.loading;
    useDirectory.disabled = session.loading;
    actions.append(createFolder, useDirectory);
    sheet.parentElement.append(actions);
  }
  sheetRoot.append(layer);
}

function renderSessionMenuSheet() {
  const row = sessionRowById(state.sessionMenu);
  if (!row) {
    state.sessionMenu = '';
    return;
  }
  const { layer, sheet } = sheetLayer(sessionTitle(row), () => {
    state.sessionMenu = '';
    renderSheet();
  });
  const items = [
    sheetItem({ label: '重命名', onClick: () => startSessionRename(row) }),
    sheetItem({ label: 'Fork', hint: '复制为新会话', onClick: () => forkSession(row) }),
  ];
  if (insertSessionMove(row, 'up', state.workspaces, state.sessions)) {
    items.push(sheetItem({ label: '上移', onClick: () => moveSession(row, 'up') }));
  }
  if (insertSessionMove(row, 'down', state.workspaces, state.sessions)) {
    items.push(sheetItem({ label: '下移', onClick: () => moveSession(row, 'down') }));
  }
  items.push(sheetItem({
    label: '归档',
    hint: '移入「已归档会话」，可取消归档',
    onClick: () => startSessionConfirm('archive', row),
  }));
  sheet.append(...items);
  sheetRoot.append(layer);
}

function renderHistorySheet() {
  const view = state.history;
  const { layer, sheet } = sheetLayer('已归档会话', () => {
    state.history = null;
    renderSheet();
  });
  const note = document.createElement('p');
  note.className = 'sheet-note';
  note.textContent = '取消归档会让电脑端重新载入这个会话；这不会恢复正在运行的任务。';
  sheet.append(note);
  for (const row of view.rows) {
    const busy = view.busyId === row.sessionId;
    sheet.append(buttonBusy(sheetItem({
      label: sessionTitle(row),
      hint: '点按取消归档',
      enabled: !view.busyId && !view.loading,
      onClick: () => unarchiveFromHistory(row),
    }), busy, { label: '取消归档中…' }));
    sheet.append(sheetItem({
      label: `删除「${sessionTitle(row)}」`,
      hint: '仅已归档会话可删除',
      enabled: !view.busyId && !view.loading,
      onClick: () => startSessionConfirm('delete', row),
    }));
  }
  surfaceBusy(sheet, view.loading);
  if (!view.loading && !view.rows.length && !view.error) {
    const empty = document.createElement('p');
    empty.className = 'sheet-note';
    empty.textContent = '没有已归档的会话。';
    sheet.append(empty);
  }
  if (view.hasMore && !view.loading) {
    sheet.append(sheetItem({
      label: '加载更多',
      enabled: !view.busyId,
      onClick: () => loadHistoryPage(false),
    }));
  }
  sheetRoot.append(layer);
}

/** Row inside a picker sheet: label (+ hint) with the current choice marked. */
function pickerRow({ label, hint = '', current = false, enabled = true, busy = false, onClick }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sheet-item mode-row';
  button.disabled = !enabled;
  button.setAttribute('aria-pressed', String(current));
  const main = document.createElement('span');
  main.className = 'sheet-item-main';
  const title = document.createElement('span');
  title.textContent = label;
  main.append(title);
  if (hint) {
    const hintNode = document.createElement('span');
    hintNode.className = 'sheet-hint';
    hintNode.textContent = hint;
    main.append(hintNode);
  }
  button.append(main);
  if (current) {
    const mark = document.createElement('span');
    mark.className = 'mode-current';
    mark.textContent = '✓';
    button.append(mark);
  }
  buttonBusy(button, busy, { label: '切换中…' });
  if (enabled) button.addEventListener('click', onClick);
  return button;
}

function closePicker() {
  state.pickerSheet = '';
  state.pickerPage = '';
  renderSheet();
}

function modePickerCard() {
  const { modes, currentModeId } = currentModeState();
  const card = document.createElement('div');
  card.className = 'card';
  for (const mode of modes) {
    card.append(pickerRow({
      label: mode.label,
      hint: mode.desc || '',
      current: mode.id === currentModeId,
      enabled: !state.modeBusy,
      busy: state.modeBusy && mode.id === currentModeId,
      onClick: () => {
        changeAgentMode(mode.id);
      },
    }));
  }
  return card;
}

/** 权限 picker: the composer chip's sheet (desktop PermissionSelect menu). */
function renderModePickerSheet() {
  const { layer, sheet } = sheetLayer('权限', closePicker);
  sheet.append(modePickerCard());
  sheetRoot.append(layer);
}

const DRILL_ICONS = {
  effort: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.4"/><path d="M10 6v4l2.5 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  mode: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 2.5 4 5v4.5c0 3.6 2.6 6.6 6 8 3.4-1.4 6-4.4 6-8V5l-6-2.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  more: '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><circle cx="4.5" cy="10" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="15.5" cy="10" r="1.5"/></svg>',
};
const DRILL_CHEVRON = '<svg class="chev" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function drillRow({ icon, title, value, accent = false, enabled = true, onClick }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'drill';
  button.disabled = !enabled;
  const round = document.createElement('span');
  round.className = 'drill-icon';
  round.append(svgNode(icon));
  const main = document.createElement('span');
  main.className = 'drill-main';
  const t = document.createElement('span');
  t.className = 'drill-title';
  t.textContent = title;
  main.append(t);
  if (value) {
    const v = document.createElement('span');
    v.className = `drill-value${accent ? ' accent' : ''}`;
    v.textContent = value;
    main.append(v);
  }
  button.append(round, main, svgNode(DRILL_CHEVRON));
  if (enabled) button.addEventListener('click', onClick);
  return button;
}

function modelRowButton(row, current) {
  const routable = isRoutable(row);
  return pickerRow({
    label: row.name,
    hint: !routable ? '尚未配置，请在电脑端配置此模型' : (row.reasoning ? '可调整思考强度' : ''),
    current: current?.provider === row.provider && current?.model === row.id,
    enabled: !state.modelBusy && routable,
    busy: state.modelBusy && current?.provider === row.provider && current?.model === row.id,
    onClick: () => changeAgentModel(row.provider, row.id),
  });
}

function setPickerPage(page) {
  state.pickerPage = page;
  renderSheet();
}

/** 模型 picker root page: current provider's models + 思考强度/权限/更多模型 drills. */
function renderModelPickerRoot(sheet, { current, rows }) {
  const efforts = effortsFor(current, rows);
  const provider = current?.provider || rows[0]?.provider;
  const providerRows = rows.filter((row) => row.provider === provider);
  const card = document.createElement('div');
  card.className = 'card';
  for (const row of providerRows) card.append(modelRowButton(row, current));
  if (!providerRows.length) card.append(descNode('没有可用模型', 'sheet-note'));
  sheet.append(card);
  if (efforts.length) {
    const effortName = efforts.find((effort) => effort.id === current?.reasoningEffort)?.name
      || current?.reasoningEffort || '';
    const drillCard = document.createElement('div');
    drillCard.className = 'card';
    drillCard.append(drillRow({
      icon: DRILL_ICONS.effort,
      title: '思考强度',
      value: effortName,
      accent: true,
      onClick: () => setPickerPage('effort'),
    }));
    sheet.append(drillCard);
  }
  const modeCard = document.createElement('div');
  modeCard.className = 'card';
  modeCard.append(drillRow({
    icon: DRILL_ICONS.mode,
    title: '权限',
    value: currentModeState().currentLabel,
    onClick: () => setPickerPage('mode'),
  }));
  sheet.append(modeCard);
  const routableCount = rows.filter(isRoutable).length;
  const moreCard = document.createElement('div');
  moreCard.className = 'card';
  moreCard.append(drillRow({
    icon: DRILL_ICONS.more,
    title: '更多模型',
    value: `按提供方浏览 · ${routableCount} 个`,
    onClick: () => setPickerPage('more'),
  }));
  sheet.append(moreCard);
}

/** 模型 picker「思考强度」page: effort rows with a trailing check. */
function renderModelPickerEffort(sheet, { current, rows }) {
  const card = document.createElement('div');
  card.className = 'card';
  for (const effort of effortsFor(current, rows)) {
    card.append(pickerRow({
      label: effort.name || effort.id,
      current: current?.reasoningEffort === effort.id,
      enabled: !state.modelBusy,
      busy: state.modelBusy && current?.reasoningEffort === effort.id,
      onClick: () => {
        if (current) changeAgentModel(current.provider, current.model, effort.id);
      },
    }));
  }
  sheet.append(card);
}

/** 模型 picker「更多模型」page: search field + provider-grouped full list. */
function renderModelPickerMore(sheet, { current, rows, pane }) {
  const searchInput = fieldInput(state.modelQuery, '搜索模型或提供方', (value) => {
    state.modelQuery = value;
    renderRows();
  });
  searchInput.setAttribute('aria-label', '搜索模型');
  searchInput.classList.add('model-search');
  sheet.append(searchInput);
  const list = document.createElement('div');
  list.className = 'card model-results';
  function renderRows() {
    clearButtonBusy(list);
    list.replaceChildren();
    const query = state.modelQuery.trim().toLocaleLowerCase();
    const matches = rows.filter((row) => !query || `${row.name} ${row.id} ${row.providerName}`.toLocaleLowerCase().includes(query));
    let provider = null;
    for (const row of matches) {
      if (row.providerName !== provider) {
        provider = row.providerName;
        list.append(descNode(provider || '模型', 'sheet-title sheet-group'));
      }
      list.append(modelRowButton(row, current));
    }
    if (!matches.length && !pane?.loading) list.append(descNode('没有匹配的模型', 'sheet-note'));
  }
  renderRows();
  sheet.append(list);
}

/** 模型 picker: provider models on the root page, drills switch pages in place. */
function renderModelPickerSheet() {
  const pageTitles = { effort: '思考强度', mode: '权限', more: '更多模型' };
  const { layer, sheet } = sheetLayer(pageTitles[state.pickerPage] || '选择模型', closePicker);
  if (!state.modelPane) loadModelPane();
  const pane = state.modelPane;
  const { current, rows } = state.modelCatalog;
  if (pane?.loading && !rows.length) {
    surfaceBusy(sheet, true);
  } else if (pane?.error) {
    // The persistent feedback retains retry; cached model choices stay usable.
    renderModelPickerRoot(sheet, { current, rows });
  } else if (state.pickerPage === 'effort') {
    renderModelPickerEffort(sheet, { current, rows });
  } else if (state.pickerPage === 'mode') {
    sheet.append(modePickerCard());
  } else if (state.pickerPage === 'more') {
    renderModelPickerMore(sheet, { current, rows, pane });
  } else {
    renderModelPickerRoot(sheet, { current, rows });
  }
  sheetRoot.append(layer);
}

function openPicker(kind) {
  if (!state.sessionId) {
    showBanner('先打开一个会话，再选择权限或模型。');
    return;
  }
  if (currentReadOnlyReason()) return;
  if (navigationBusy()) return;
  state.newSession = null;
  state.history = null;
  state.sessionMenu = '';
  state.workspaceMenu = '';
  state.pickerError = '';
  state.modelQuery = '';
  state.pickerPage = '';
  setDrawerOpen(false);
  clearExclusiveDialogs();
  state.attachOpen = false;
  state.gitDialog = '';
  state.pickerSheet = kind;
  renderSheet();
}

function renderSheet() {
  scheduleNavigation();
  preserveSurfaceInput(sheetRoot);
  clearButtonBusy(sheetRoot);
  sheetRoot.replaceChildren();
  if (state.newSession) {
    renderNewSessionSheet();
    return;
  }
  if (state.history) {
    renderHistorySheet();
    return;
  }
  if (state.sessionMenu) {
    renderSessionMenuSheet();
    if (state.sessionMenu) return;
  }
  if (state.workspaceMenu) {
    const workspace = (state.workspaces.items || []).find((item) => item.workspaceId === state.workspaceMenu);
    if (!workspace) {
      state.workspaceMenu = '';
    } else {
      const { layer, sheet } = sheetLayer(workspace.title || workspace.path, () => {
        state.workspaceMenu = '';
        renderSheet();
      });
      sheet.append(
        sheetItem({
          label: '重命名工作区',
          onClick: () => startWorkspaceRename(workspace),
        }),
        sheetItem({
          label: '从列表移除',
          hint: '不删除磁盘上的文件夹',
          onClick: () => {
            state.workspaceMenu = '';
            startSessionConfirm('workspace-delete', {
              sessionId: workspace.workspaceId,
              projections: { values: { title: workspace.title || workspace.path } },
            });
          },
        }),
      );
      sheetRoot.append(layer);
      return;
    }
  }
  if (state.attachOpen) {
    const { layer, sheet } = sheetLayer('添加附件', () => {
      state.attachOpen = false;
      renderSheet();
    });
    const card = document.createElement('div');
    card.className = 'card';
    card.append(
      sheetItem({ label: '拍照', onClick: () => { state.attachOpen = false; renderSheet(); fileCamera.click(); } }),
      sheetItem({ label: '从相册选择', onClick: () => { state.attachOpen = false; renderSheet(); fileGallery.click(); } }),
      sheetItem({ label: '从工作区选文件', onClick: () => { state.attachOpen = false; renderSheet(); openSettings('文件'); openFilesPane(); } }),
    );
    sheet.append(card);
    sheetRoot.append(layer);
    return;
  }
  if (state.pickerSheet === 'mode') {
    renderModePickerSheet();
    return;
  }
  if (state.pickerSheet === 'model') {
    renderModelPickerSheet();
    return;
  }
  if (state.gitDialog === 'menu') {
    const { layer, sheet } = sheetLayer('Git', closeGitLayer);
    const quick = currentQuick();
    const hasOpenPr = state.gitStatus.pr?.state === 'open';
    const status = state.gitStatus;
    // Branch head: the current ref with its sync line, tapping opens the
    // branch switcher (desktop title-bar branch menu).
    if (status.isRepo !== false) {
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'sheet-item git-sheet-head';
      head.disabled = state.gitBusy;
      const main = document.createElement('span');
      main.className = 'sheet-item-main';
      const ref = document.createElement('span');
      ref.className = 'git-sheet-ref';
      ref.append(svgNode('<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm0 7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm6-7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM5 6v4m6-4c0 2-1.5 3-3.5 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>'));
      const refName = document.createElement('b');
      refName.textContent = status.refName ?? '—';
      ref.append(refName);
      const line = document.createElement('span');
      line.className = 'sheet-hint';
      line.textContent = gitStatusLine(status).replace(/^[^·]*· /, '');
      main.append(ref, line);
      const chev = document.createElement('span');
      chev.className = 'chev';
      chev.textContent = '切换 ›';
      head.append(main, chev);
      head.addEventListener('click', () => loadBranches());
      sheet.append(head);
      const divider = document.createElement('div');
      divider.className = 'sheet-divider';
      sheet.append(divider);
    }
    const primary = sheetItem({ label: state.gitRetry ? '继续未完成操作' : quick.label, enabled: !state.gitBusy && (!quick.disabled || Boolean(state.gitRetry)), onClick: () => state.gitRetry ? gitAction('gitCommit', { retry: true }) : runGitPrimary() });
    primary.dataset.gitFeedback = '';
    buttonBusy(primary, state.gitBusy, { label: gitBusyLabel() });
    sheet.append(
      primary,
      sheetItem({ label: 'Pull', enabled: !state.gitBusy, onClick: () => gitAction('gitPull') }),
      sheetItem({
        label: 'Commit',
        enabled: !state.gitBusy && status.hasWorkingTreeChanges,
        hint: status.hasWorkingTreeChanges ? '' : '工作区是干净的。请先改文件再提交。',
        onClick: () => { state.pendingStacked = 'commit'; state.gitDialog = 'commit'; renderSheet(); renderDialog(); },
      }),
      sheetItem({
        label: 'Push',
        enabled: !state.gitBusy && status.aheadCount > 0 && !status.hasWorkingTreeChanges && status.behindCount === 0,
        hint: status.hasWorkingTreeChanges ? '请先提交或贮藏本地改动再推送。' : '',
        onClick: () => maybeConfirm('gitPush'),
      }),
      sheetItem({
        label: hasOpenPr ? 'View PR' : 'Create PR',
        enabled: !state.gitBusy && (hasOpenPr || (status.aheadCount > 0 && !status.hasWorkingTreeChanges)),
        onClick: () => {
          if (hasOpenPr) {
            closeGitLayer();
            openPullRequest();
          } else {
            maybeConfirm('gitCreateChangeRequest');
          }
        },
      }),
    );
    if (quick.kind === 'run_init') {
      sheet.append(sheetItem({
        label: 'Initialize Git',
        hint: '在当前工作区初始化仓库',
        enabled: !state.gitBusy,
        onClick: () => runGitPrimary(),
      }));
    }
    if (quick.kind === 'show_hint' && quick.hint) {
      const note = document.createElement('p');
      note.className = 'sheet-note';
      note.textContent = quick.hint;
      sheet.append(note);
    }
    sheet.append(sheetItem({
      label: '更改与文件',
      hint: '查看本轮改动、浏览工作区文件',
      onClick: () => {
        closeGitLayer();
        openSettings('工作区');
        refreshGit();
      },
    }));
    sheetRoot.append(layer);
    return;
  }
  if (state.gitDialog === 'branch') {
    const { layer, sheet } = sheetLayer('切换分支', closeGitLayer);
    surfaceBusy(sheet, state.branchLoading);
    const list = document.createElement('div');
    const renderRows = () => {
      const query = state.branchQuery.trim();
      const rows = state.branches.filter((branch) => !query || branch.name.toLowerCase().includes(query.toLowerCase()));
      const nodes = [];
      if (!rows.length && !state.branchLoading && !state.gitError) {
        const note = document.createElement('p');
        note.className = 'sheet-note';
        note.textContent = '没有匹配的分支';
        nodes.push(note);
      }
      for (const branch of rows) {
        const current = branch.isCurrent && !branch.isRemote;
        const switchable = branch.switchable !== false;
        const button = sheetItem({
          label: branch.name,
          enabled: !state.gitBusy && !state.branchLoading && !current && switchable,
          hint: !switchable
            ? '名称含桌面无法安全传给 git 的字符'
            : (branch.isRemote ? '远程' : current ? '当前' : ''),
          onClick: () => switchBranch(branch.isRemote ? branch.name.replace(/^origin\//, '') : branch.name),
        });
        const switching = state.gitBusy && state.gitProgress === 'switch-branch' && state.gitPendingRef === (branch.isRemote ? branch.name.replace(/^origin\//, '') : branch.name);
        if (switching) button.dataset.gitFeedback = '';
        buttonBusy(button, switching, { label: gitBusyLabel() });
        nodes.push(button);
      }
      const canCreate = Boolean(query) && !state.branches.some((branch) => branch.name === query && !branch.isRemote);
      nodes.push(sheetItem({
        label: canCreate ? `创建并检出分支「${query}」` : '创建并检出新分支…',
        enabled: !state.gitBusy && !state.branchLoading,
        onClick: () => {
          if (canCreate) state.newBranchName = query;
          state.gitDialog = 'create-branch';
          renderSheet();
          renderDialog();
        },
      }));
      clearButtonBusy(list);
      list.replaceChildren(...nodes);
    };
    sheet.append(fieldInput(state.branchQuery, '搜索分支…', (value) => {
      state.branchQuery = value;
      renderRows();
    }), list);
    renderRows();
    sheetRoot.append(layer);
    return;
  }
  renderDialog();
}

function dialogLayer(compact, onClose = closeGitLayer) {
  const task = !compact;
  const result = createSurface(document, {
    task, variant: task ? 'task' : 'modal', family: 'dialog',
    onClose: () => { if (!navigationBusy()) onClose(); },
    onBack: task ? () => navigation.back() : null,
  });
  return { layer: result.layer, dialog: result.content };
}

function dialogHead(dialog, title, lead) {
  dialog.parentElement.querySelector('.surface-title').textContent = title;
  dialog.parentElement.setAttribute('aria-label', title);
  if (lead) dialog.append(descNode(lead, 'lead'));
}

async function copyGitError(errorText = state.gitError) {
  const text = typeof errorText === 'string' ? errorText : state.gitError;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const field = document.createElement('textarea');
      field.value = text;
      field.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
      field.tabIndex = -1;
      field.setAttribute('aria-hidden', 'true');
      const parent = dialogRoot.querySelector('.surface-content') || sheetRoot.querySelector('.surface-content') || phone;
      parent.append(field); field.select();
      const copied = document.execCommand('copy'); field.remove();
      if (!copied) throw new Error('请选择错误文字复制');
    }
    setToast('已复制', { tone: 'success' });
  } catch { operationError('无法访问剪贴板，请选择错误文字复制', () => copyGitError(text)); }
}

function dialogFoot(dialog, buttons) {
  const foot = document.createElement('div');
  foot.className = 'dialog-foot';
  foot.append(...buttons);
  dialog.parentElement.append(foot);
}

function renderNamedDialog({ title, hint, field, placeholder, saveLabel, busy, onClose, onSave }) {
  const close = () => {
    if (busy) return;
    onClose();
  };
  const { layer, dialog } = dialogLayer(true, close);
  dialogHead(dialog, title, hint);
  const body = document.createElement('div');
  body.className = 'dialog-body';
  body.append(fieldInput(field, placeholder, (value) => {
    saveBtn.disabled = busy || !value.trim();
    onSave.draft(value);
  }));
  dialog.append(body);
  const saveBtn = buttonBusy(primaryButton(saveLabel, () => onSave.submit()), busy, { label: saveLabel === '创建' ? '创建中…' : '保存中…' });
  saveBtn.disabled = busy || !String(field || '').trim();
  const cancelBtn = ghostButton('取消', close);
  cancelBtn.disabled = busy;
  dialogFoot(dialog, [cancelBtn, saveBtn]);
  dialogRoot.append(layer);
}

function renderWorkspaceRenameDialog() {
  const rename = state.workspaceRename;
  renderNamedDialog({
    title: '重命名工作区',
    hint: '名字写回电脑端，两边同步显示。',
    field: rename.value,
    placeholder: '工作区名称',
    saveLabel: '保存',
    busy: rename.busy,
    onClose: () => {
      state.workspaceRename = null;
      renderDialog();
    },
    onSave: {
      draft: (value) => { rename.value = value; },
      submit: () => submitWorkspaceRename(),
    },
  });
}

function renderFolderCreateDialog() {
  const create = state.folderCreate;
  renderNamedDialog({
    title: '新建文件夹',
    hint: '在当前浏览目录下创建一个子文件夹。',
    field: create.value,
    placeholder: '文件夹名称',
    saveLabel: '创建',
    busy: create.busy,
    onClose: () => {
      state.folderCreate = null;
      renderDialog();
    },
    onSave: {
      draft: (value) => { create.value = value; },
      submit: () => submitFolderCreate(),
    },
  });
}

function renderSessionRenameDialog() {
  const rename = state.sessionRename;
  const close = () => {
    if (state.sessionRename?.busy) return;
    state.sessionRename = null;
    renderDialog();
  };
  const { layer, dialog } = dialogLayer(true, close);
  dialogHead(dialog, '重命名会话', '名字写回电脑端，两边同步显示。');
  const body = document.createElement('div');
  body.className = 'dialog-body';
  body.append(fieldInput(rename.value, '会话名称', (value) => {
    rename.value = value;
    saveBtn.disabled = rename.busy || !value.trim();
  }));
  dialog.append(body);
  const saveBtn = buttonBusy(primaryButton('保存', () => submitSessionRename()), rename.busy, { label: '保存中…' });
  saveBtn.disabled = rename.busy || !rename.value.trim();
  const cancelBtn = ghostButton('取消', close);
  cancelBtn.disabled = rename.busy;
  dialogFoot(dialog, [cancelBtn, saveBtn]);
  dialogRoot.append(layer);
}

function renderSessionConfirmDialog() {
  const confirm = state.sessionConfirm;
  const close = () => {
    if (state.sessionConfirm?.busy) return;
    state.sessionConfirm = null;
    renderDialog();
  };
  const { layer, dialog } = dialogLayer(true, close);
  const isDelete = confirm.kind === 'delete';
  const isWorkspace = confirm.kind === 'workspace-delete';
  dialogHead(
    dialog,
    isWorkspace ? `移除工作区「${confirm.title}」？` : isDelete ? `删除「${confirm.title}」？` : `归档「${confirm.title}」？`,
    isWorkspace
      ? '只从侧栏列表移除，不会删除磁盘上的文件夹。'
      : isDelete
        ? '会从电脑端永久删除这个已归档会话，不可恢复。'
        : '会话会移入「已归档会话」，之后可以取消归档。',
  );
  const cancelBtn = ghostButton('取消', close);
  cancelBtn.disabled = confirm.busy;
  const okBtn = document.createElement('button');
  okBtn.type = 'button';
  okBtn.className = isDelete || isWorkspace ? 'danger-btn' : 'primary-btn';
  okBtn.textContent = isWorkspace ? '移除' : isDelete ? '删除' : '归档';
  buttonBusy(okBtn, confirm.busy, { label: isWorkspace ? '移除中…' : isDelete ? '删除中…' : '归档中…' });
  okBtn.disabled = confirm.busy;
  okBtn.addEventListener('click', () => runSessionConfirm());
  dialogFoot(dialog, [cancelBtn, okBtn]);
  dialogRoot.append(layer);
}

function renderDialog() {
  scheduleNavigation();
  preserveSurfaceInput(dialogRoot);
  clearButtonBusy(dialogRoot);
  dialogRoot.replaceChildren();
  if (state.sessionConfirm) {
    renderSessionConfirmDialog();
    return;
  }
  if (state.workspaceRename) {
    renderWorkspaceRenameDialog();
    return;
  }
  if (state.folderCreate) {
    renderFolderCreateDialog();
    return;
  }
  if (state.sessionRename) {
    renderSessionRenameDialog();
    return;
  }
  const kind = state.gitDialog;
  if (kind !== 'commit' && kind !== 'create-branch' && kind !== 'confirm' && kind !== 'publish') return;
  if (kind === 'commit') {
    if (!state.commitFiles) void loadCommitFiles();
    const { layer, dialog } = dialogLayer(false);
    dialogHead(dialog, '提交更改', '确认本次提交内容。提交信息留空将自动生成。');
    const body = document.createElement('div');
    body.className = 'dialog-body';
    const card = document.createElement('div');
    card.className = 'commit-card';
    const refRow = document.createElement('div');
    refRow.className = 'ref-row';
    const refLabel = document.createElement('span');
    refLabel.className = 'row-desc';
    refLabel.textContent = '分支';
    const refName = document.createElement('b');
    refName.textContent = state.gitStatus.refName ?? '—';
    refRow.append(refLabel, refName);
    if (state.gitStatus.isDefaultRef) {
      const warn = document.createElement('span');
      warn.className = 'warn';
      warn.textContent = '警告：目标为默认分支';
      refRow.append(warn);
    }
    card.append(refRow, descNode(state.gitStatus.hasWorkingTreeChanges ? '有未提交更改' : '无'));
    body.append(card);
    body.append(descNode('提交信息（可选）', 'field-label'));
    const messageInput = fieldInput(state.commitMessage, '留空则自动生成', (value) => {
      state.commitMessage = value;
    });
    messageInput.disabled = state.gitBusy || Boolean(state.gitRetry);
    body.append(messageInput);
    const onBranch = document.createElement('label');
    onBranch.className = 'row-desc';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = state.commitOnNewBranch;
    check.disabled = state.gitBusy || Boolean(state.gitRetry);
    check.addEventListener('change', () => {
      state.commitOnNewBranch = check.checked;
    });
    onBranch.append(check, document.createTextNode(' Commit on new branch'));
    body.append(onBranch);
    const files = state.commitFiles;
    const submit = primaryButton(state.pendingStacked === 'commit_push_pr' ? 'Commit, push & PR' : state.pendingStacked === 'commit_push' ? 'Commit & push' : '提交',
      () => gitAction('gitCommit', state.gitRetry ? { retry: true } : { message: state.commitMessage }));
    submit.dataset.gitFeedback = '';
    buttonBusy(submit, state.gitBusy || files?.loading, { label: state.gitBusy ? gitBusyLabel() : '加载中…' });
    const updateSubmit = () => {
      submit.disabled = state.gitBusy || Boolean(!state.gitRetry && (files?.loading || files?.error || (files?.entries.length && !files.selected.size)));
    };
    if (files?.entries.length) {
      body.append(descNode('包含的文件', 'field-label'));
      for (const entry of files.entries) {
        const label = document.createElement('label'); label.className = 'file-choice';
        const input = document.createElement('input'); input.type = 'checkbox';
        input.checked = files.selected.has(entry.path); input.disabled = state.gitBusy || Boolean(state.gitRetry);
        input.addEventListener('change', () => { if (input.checked) files.selected.add(entry.path); else files.selected.delete(entry.path); updateSubmit(); });
        label.append(input, document.createTextNode(entry.path)); body.append(label);
      }
    }
    updateSubmit();
    dialog.append(body);
    dialogFoot(dialog, [
      ghostButton('取消', closeGitLayer),
      submit,
    ]);
    dialogRoot.append(layer);
    return;
  }
  if (kind === 'create-branch') {
    const { layer, dialog } = dialogLayer(true);
    dialogHead(dialog, '创建并检出新分支', '基于当前 HEAD 创建一个新的本地分支，并在创建成功后立即切换过去。');
    const body = document.createElement('div');
    body.className = 'dialog-body';
    body.append(descNode('分支名', 'field-label'));
    const input = fieldInput(state.newBranchName, '例如 feature/git-branch-switcher', (value) => {
      state.newBranchName = value;
      createBtn.disabled = !value.trim();
    });
    input.disabled = state.gitBusy || Boolean(state.gitRetry);
    body.append(input);
    dialog.append(body);
    const createBtn = buttonBusy(primaryButton('Create branch', () => createBranch()), state.gitBusy, { label: gitBusyLabel() });
    createBtn.dataset.gitFeedback = '';
    createBtn.disabled = state.gitBusy || !state.newBranchName.trim();
    dialogFoot(dialog, [ghostButton('取消', closeGitLayer), createBtn]);
    dialogRoot.append(layer);
    return;
  }
  if (kind === 'publish') {
    const { layer, dialog } = dialogLayer(false);
    dialogHead(dialog, 'Publish repository', '在没有 origin 时把仓库发布到 GitHub（gh）或添加已有远程 URL。');
    const body = document.createElement('div');
    body.className = 'dialog-body';
    body.append(descNode('仓库名', 'field-label'));
    body.append(fieldInput(state.publishName, '留空则用目录名', (value) => {
      state.publishName = value;
    }));
    body.append(descNode('已有远程地址（可选）', 'field-label'));
    body.append(fieldInput(state.publishRemoteUrl, 'https://… 或 git@…', (value) => { state.publishRemoteUrl = value; }));
    const visibility = document.createElement('div'); visibility.className = 'effort-segment';
    for (const [value, label] of [['private', 'Private'], ['public', 'Public']]) {
      const choice = ghostButton(label, () => {
        state.publishVisibility = value;
        for (const button of visibility.children) button.setAttribute('aria-pressed', String(button.dataset.value === value));
      });
      choice.dataset.value = value; choice.setAttribute('aria-pressed', String(state.publishVisibility === value));
      visibility.append(choice);
    }
    body.append(visibility);
    dialog.append(body);
    const publish = primaryButton('Publish repository', () => {
      gitAction('gitPublishRepository', { input: { name: state.publishName, visibility: state.publishVisibility, remoteUrl: state.publishRemoteUrl } });
    });
    publish.disabled = state.gitBusy;
    publish.dataset.gitFeedback = '';
    buttonBusy(publish, state.gitBusy, { label: gitBusyLabel() });
    dialogFoot(dialog, [
      ghostButton('取消', closeGitLayer),
      publish,
    ]);
    dialogRoot.append(layer);
    return;
  }
  const { layer, dialog } = dialogLayer(true);
  const isPr = state.gitConfirmAction === 'gitCreateChangeRequest';
  dialogHead(
    dialog,
    isPr ? '从默认分支推送并创建 pull request？' : '推送到默认分支？',
    `此操作会作用在“${state.gitStatus.refName ?? ''}”。你可以继续在此引用上操作，或新建功能引用后再执行同一操作。`,
  );
  dialogFoot(dialog, [
    ghostButton('取消', closeGitLayer),
    ghostButton('新建功能分支', () => {
      state.gitDialog = 'create-branch';
      renderDialog();
    }),
    primaryButton(isPr ? '推送并创建 pull request' : `推送到 ${state.gitStatus.refName ?? ''}`, () => {
      const name = state.gitConfirmAction;
      const extra = state.gitConfirmExtra;
      state.gitConfirmAction = '';
      state.gitConfirmExtra = {};
      state.gitDialog = 'menu';
      renderDialog();
      if (name) gitAction(name, extra);
    }),
  ]);
  dialogRoot.append(layer);
}

function renderToast() {
  clearButtonBusy(toastRoot);
  toastRoot.replaceChildren();
  // Running Git operations already report progress on their locked controls.
  if (state.gitBusy || !state.gitToast) return;
  const layer = document.createElement('div');
  layer.className = 'toast-layer';
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.dataset.tone = state.toastTone;
  toast.setAttribute('role', state.toastTone === 'error' ? 'alert' : 'status');
  toast.setAttribute('aria-atomic', 'true');
  {
    const bad = state.toastTone === 'error';
    const mark = document.createElement('span');
    mark.className = `mark ${bad ? 'bad' : state.toastTone === 'success' ? 'ok' : ''}`;
    mark.setAttribute('aria-hidden', 'true');
    // The standalone SPA uses the same SVG artwork as the shared Toast.
    mark.append(svgNode(bad
      ? '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 14.5C11.5899 14.5 14.5 11.5899 14.5 8C14.5 4.41015 11.5899 1.5 8 1.5C4.41015 1.5 1.5 4.41015 1.5 8C1.5 11.5899 4.41015 14.5 8 14.5Z" stroke="currentColor"/><path d="M8 4.29199V9.79199M8 10.708V11.708" stroke="currentColor"/></svg>'
      : state.toastTone === 'success'
        ? '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M12.5303 6.53027L8.80273 10.2578C8.54967 10.5109 8.31796 10.7439 8.10645 10.9141C7.88375 11.0932 7.616 11.2602 7.27344 11.3145C7.09229 11.3431 6.90771 11.3431 6.72656 11.3145C6.384 11.2602 6.11625 11.0932 5.89355 10.9141C5.68204 10.7439 5.45033 10.5109 5.19727 10.2578L3.46973 8.53027L4.53027 7.46973L6.25781 9.19727C6.53457 9.47402 6.70036 9.63859 6.83398 9.74609C6.95637 9.84453 6.98241 9.83644 6.96094 9.83301C6.98679 9.83709 7.01321 9.83709 7.03906 9.83301C7.01759 9.83644 7.04363 9.84453 7.16602 9.74609C7.29964 9.63859 7.46543 9.47402 7.74219 9.19727L11.4697 5.46973L12.5303 6.53027Z" fill="currentColor"/><path d="M14.5996 8C14.5996 4.35492 11.6451 1.40039 8 1.40039C4.35492 1.40039 1.40039 4.35492 1.40039 8C1.40039 11.6451 4.35492 14.5996 8 14.5996C11.6451 14.5996 14.5996 11.6451 14.5996 8ZM15.9004 8C15.9004 12.363 12.363 15.9004 8 15.9004C3.63695 15.9004 0.0996094 12.363 0.0996094 8C0.0996094 3.63695 3.63695 0.0996094 8 0.0996094C12.363 0.0996094 15.9004 3.63695 15.9004 8Z" fill="currentColor"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M12.5757 7.00012C12.5757 3.92085 10.0794 1.42463 7.00012 1.42456C3.9208 1.42456 1.42456 3.9208 1.42456 7.00012C1.42463 10.0794 3.92085 12.5757 7.00012 12.5757C10.0793 12.5756 12.5756 10.0793 12.5757 7.00012ZM13.8002 7.00012C13.8001 10.7559 10.7559 13.8001 7.00012 13.8002C3.2443 13.8002 0.199291 10.7559 0.199219 7.00012C0.199219 3.24426 3.24426 0.199219 7.00012 0.199219C10.7559 0.199291 13.8002 3.2443 13.8002 7.00012Z" fill="currentColor"/><path d="M7.6127 3.18921V4.55986H6.38735V3.18921H7.6127ZM7.6127 5.68921V10.8109H6.38735V5.68921H7.6127Z" fill="currentColor"/></svg>'));
    toast.append(mark);
  }
  const main = document.createElement('span');
  main.className = 'toast-main';
  const title = document.createElement('b');
  title.textContent = state.gitToast;
  main.append(title);
  if (state.toastActions.length) {
    const actions = document.createElement('div');
    actions.className = 'toast-actions';
    for (const action of state.toastActions) {
      const button = ghostButton(action.label, async () => {
        button.disabled = true;
        buttonBusy(button, true);
        try { await action.onClick(); }
        catch (error) { operationError(error?.message || '电脑没有响应', action.onClick); }
        finally { button.disabled = false; buttonBusy(button, false); }
      });
      actions.append(button);
    }
    main.append(actions);
  }
  toast.append(main);
  layer.append(toast);
  toastRoot.append(layer);
}

function renderLightbox() {
  scheduleNavigation();
  lightboxRoot.replaceChildren();
  if (!state.lightbox) return;
  const layer = document.createElement('div');
  layer.className = 'lightbox-layer';
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-modal', 'true');
  layer.setAttribute('aria-label', '图片预览');
  layer.tabIndex = -1;
  const mask = document.createElement('button');
  mask.type = 'button';
  mask.className = 'lightbox-mask';
  mask.setAttribute('aria-label', '关闭');
  const img = document.createElement('img');
  img.src = `data:${state.lightbox.mediaType};base64,${state.lightbox.data}`;
  img.alt = '图片预览';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'lightbox-close';
  close.setAttribute('aria-label', '关闭');
  close.textContent = '×';
  const dismiss = () => {
    state.lightbox = null;
    renderLightbox();
  };
  mask.addEventListener('click', dismiss);
  close.addEventListener('click', dismiss);
  layer.append(mask, img, close);
  lightboxRoot.append(layer);
}

// —— 事件接线 —— //

scanOpen.addEventListener('click', () => {
  runScanAction({
    userAgent: navigator.userAgent,
    navigate: (url) => window.location.assign(url),
    startBrowserScan: startScan,
  });
});
el('scan-cancel').addEventListener('click', () => closeScan());
scanTorch.addEventListener('click', () => toggleTorch());
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
// The drawer owns its close control and shares the normal Back hierarchy.
function setDrawerOpen(open) {
  state.drawerOpen = open;
  phone.toggleAttribute('data-drawer', open);
  backdrop.classList.toggle('hidden', !open);
  el('menu').setAttribute('aria-expanded', open ? 'true' : 'false');
  scheduleNavigation();
}
el('menu').addEventListener('click', () => {
  setDrawerOpen(!phone.hasAttribute('data-drawer'));
});
backdrop.addEventListener('click', () => setDrawerOpen(false));
el('drawer-close').addEventListener('click', () => setDrawerOpen(false));
el('drawer-add-workspace').addEventListener('click', () => {
  startNewSessionChooser();
  void openDirectoryBrowse();
});
function openWorkspacePane() {
  openSettings('工作区');
  refreshGit();
  if (state.wsTab === 'files') openFilesPane();
  else openChangesTab();
}
el('new-session').addEventListener('click', () => {
  createSession().catch((error) => showBanner(error.message));
});
el('new-chat-top').addEventListener('click', () => {
  createSession().catch((error) => showBanner(error.message));
});
el('nav-sessions').addEventListener('click', () => openSessionsPage());
el('nav-workspace').addEventListener('click', () => openWorkspacePane());
el('nav-settings').addEventListener('click', () => openSettings(''));
el('drawer-account').addEventListener('click', () => openSettings('连接详情'));
el('sessions-back').addEventListener('click', () => {
  navigation.back();
});
el('sessions-new').addEventListener('click', () => {
  createSession().catch((error) => showBanner(error.message));
});
settingsBack.addEventListener('click', () => {
  navigation.back();
});
el('close-settings').addEventListener('click', () => closeSettings());
el('settings-mask').addEventListener('click', () => closeSettings());
let searchTimer = 0;
search.addEventListener('input', () => {
  state.query = search.value;
  // Switch the drawer into search mode immediately so the full list never
  // shows (or gets re-painted by live frames) during the debounce window.
  state.searchLoading = Boolean(state.query.trim());
  if (!state.searchLoading) {
    state.searchHits = null;
    state.searchHasMore = false;
  }
  renderSessions();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    void runSessionSearch(state.query.trim());
  }, 200);
});
draft.addEventListener('input', () => {
  // Only persist for the session the textarea is bound to; a late input event
  // during a switch must not land under the new id.
  if (state.transport === 'chisacode' && state.sessionId && draft.dataset.draftSession === state.sessionId) {
    draftStore?.save(state.sessionId, draft.value);
  }
  renderComposer();
  updateSlashPopup();
});
composer.addEventListener('submit', (event) => {
  event.preventDefault();
  sendPrompt().catch((error) => showBanner(error.message || '发送失败'));
});
stopBtn.addEventListener('click', () => cancelRun());
el('attach-toggle').addEventListener('click', () => {
  if (navigationBusy()) return;
  state.pickerSheet = '';
  state.pickerPage = '';
  state.newSession = null;
  state.attachOpen = !state.attachOpen;
  state.gitDialog = '';
  renderSheet();
});
accessChip.addEventListener('click', () => openPicker('mode'));
planChip.addEventListener('click', () => {
  if (!state.sessionId || planChip.disabled) return;
  planChip.disabled = true;
  buttonBusy(planChip, true, { label: '关闭中…' });
  runHostCommand('/plan off').then(() => {
    renderComposer();
  }).catch((error) => showBanner(error.message || '无法关闭计划')).finally(() => {
    planChip.disabled = false;
    buttonBusy(planChip, false);
  });
});
el('model-chip').addEventListener('click', () => openPicker('model'));
blankWorkspaceChip?.addEventListener('click', () => startNewSessionChooser());
fileCamera.addEventListener('change', () => {
  addFiles(fileCamera.files, fileSelectionOwner || sessionOwner(state));
  fileSelectionOwner = null;
  fileCamera.value = '';
});
fileGallery.addEventListener('change', () => {
  addFiles(fileGallery.files, fileSelectionOwner || sessionOwner(state));
  fileSelectionOwner = null;
  fileGallery.value = '';
});
gitPill.addEventListener('click', () => {
  // Desktop title-bar parity: the branch pill opens the Git action sheet
  // (branch switch + fetch / pull / commit / push / PR) in place.
  clearExclusiveDialogs();
  state.pickerSheet = '';
  state.pickerPage = '';
  state.attachOpen = false;
  state.gitDialog = 'menu';
  renderSheet();
  refreshGit().then(() => {
    if (state.gitDialog === 'menu') renderSheet();
  }).catch(() => {});
});

// —— 启动 —— //

window.addEventListener('hashchange', () => {
  if (hasOfferFragment(location.hash)) void connect(location.href);
});

if (nativeAndroidApp) {
  let nativeCreateBusy = false;
  window.__dshdNativeBootstrap = (epoch) => {
    if (!isNativeBootstrapEpoch(epoch)) return false;
    if (nativeSnapshotEpoch !== epoch) nativeSnapshotSeq = 0;
    nativeSnapshotEpoch = epoch;
    scheduleNativeSnapshot();
    return true;
  };
  // This entry point exists only in the packaged Android client. Android
  // verifies the calling frame's asset origin before exposing its receiver;
  // the browser path neither publishes this function nor emits snapshots.
  window.__dshdNativeAction = (raw) => {
    if (!nativeSnapshotEpoch) return false;
    const pending = state.pendingApprovals[0] || null;
    const action = validateNativeAction(raw, {
      connected: state.connected, offline: composerOffline(),
      sessions: state.heldSession ? [...state.sessions, state.heldSession] : state.sessions,
      sessionId: state.sessionId, readOnly: Boolean(currentReadOnlyReason()),
      running: currentRow()?.running === true, sendBusy: state.sendBusy,
      pending: Boolean(pending), approval: pending,
      hasOlder: state.timelinePage.hasOlder, olderLoading: state.timelineLoadingOlder,
      error: state.timelineError,
      modelOptions: state.modelCatalog.rows, permissionOptions: DEFAULT_PRESETS,
      modelBusy: state.modelBusy, modeBusy: state.modeBusy, planOn: state.permission.planOn,
    });
    if (!action) return false;
    const execute = async () => {
      switch (action.type) {
        case 'open': await openSession(action.sessionId); break;
        case 'new':
          if (nativeCreateBusy) return;
          nativeCreateBusy = true;
          try { await createWorkspaceSession(null); } finally { nativeCreateBusy = false; }
          break;
        case 'draft':
          draft.value = action.text;
          draft.dataset.draftSession = action.sessionId;
          draftStore?.save(action.sessionId, action.text);
          renderComposer({ nativeSnapshot: false });
          break;
        case 'send':
          draft.value = action.text;
          draft.dataset.draftSession = action.sessionId;
          draftStore?.save(action.sessionId, action.text);
          await sendPrompt();
          break;
        case 'cancel': await cancelRun(); break;
        case 'model': await changeAgentModel(action.provider, action.model, action.reasoningEffort); break;
        case 'permission': await changeAgentMode(action.id); break;
        case 'planOff': await runHostCommand('/plan off'); break;
        case 'slash': await runHostCommand(action.line.trim()); break;
        case 'approve': {
          const selected = pending.actions?.find((item) => item.id === action.actionId);
          if (pending.legacy) await answerLegacyApproval(action.actionId);
          else await respondToPendingApproval(pending, selected
            ? (selected.behavior ? responseForAction(selected) : { selectedActionId: selected.id })
            : genericResponse(action.actionId));
          break;
        }
        case 'older': await loadOlderMessages(); break;
        case 'retry': await openSession(action.sessionId); break;
        case 'refresh':
          if (state.connected && composerOffline()) await resumeRemoteConnection();
          else if (state.connected) await runReconnectResync();
          else if (listStickyServerIds().length) await connectSaved(getMostRecentStickyServerId());
          break;
      }
    };
    void execute().catch((error) => showBanner(error?.message || '电脑没有响应'));
    if (action.type !== 'draft') scheduleNativeSnapshot();
    return true;
  };
}

for (const input of [fileCamera, fileGallery]) {
  input.addEventListener('click', () => { fileSelectionOwner = sessionOwner(state); });
  input.addEventListener('cancel', () => { fileSelectionOwner = null; });
}
options.addEventListener('scroll', () => { settingsScroll.set(state.settingsPane, options.scrollTop); });
window.addEventListener('online', () => { void resumeRemoteConnection(); });
window.addEventListener('dshd-resume', () => { void resumeRemoteConnection(); });
window.addEventListener('pageshow', (event) => {
  if (event.persisted) void resumeRemoteConnection();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void resumeRemoteConnection();
});

applyAppearance();
renderComposer();
renderScreen();
initScanButton();

if (hasOfferFragment(window.location.hash)) {
  connect(window.location.href).catch((error) => showError(error.message || '配对链接无效'));
} else if (listStickyServerIds().length) {
  // Auto-reconnect targets the most recent computer; the connect screen's
  // saved-computer rows stay disabled until this attempt settles.
  void connectSaved(getMostRecentStickyServerId());
}
