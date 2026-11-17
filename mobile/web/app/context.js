// app/context.js — split from app.js (#442).
import { createKeyedList } from '../ui/keyed-list.js?v=20261028-mobile';
import { isNativeAndroidApp } from '../pair/native-scan.js';
import { parseVcsStatus } from '../git/vcs-parse.js';
import { createFocusScope, createMenuPositioner } from '../ui/surfaces.js?v=20261025-anchored-menus';
import { installComposerBehavior } from '../ui/composer-behavior.js?v=20260906-interaction';

export const origin = window.location.origin;

export const el = (id) => document.getElementById(id);

export const phone = el('phone');

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

export const screenConnect = el('screen-connect');

export const screenScan = el('screen-scan');

export const screenPermission = el('screen-permission');

export const screenChat = el('screen-chat');

export const connectError = el('connect-error');

export const savedComputersEl = el('saved-computers');

export const deviceLine = el('device-line');

export const pasteInput = el('paste');

export const pastePanel = el('paste-panel');

export const pasteToggle = el('paste-toggle');

export const scanOpen = el('scan-open');

export const scanUnavailable = el('scan-unavailable');

export const scanVideo = el('scan-video');

export const scanTip = el('scan-tip');

export const scanTorch = el('scan-torch');

export const chatTitle = el('chat-title');

export const hostLine = el('host-line');

export const gitPill = el('git-pill');

export const gitPillLabel = el('git-pill-label');

export const gitPillCount = el('git-pill-count');

export const subagentsBtn = el('subagents-btn');

export const sessionsPage = el('sessions-page');

export const drawerStatus = el('drawer-status');

export const drawerDirectory = el('drawer-directory');

export const navSessionsCount = el('nav-sessions-count');

export const drawerAccount = el('drawer-account');

export const drawerAvatar = el('drawer-avatar');

export const drawerAccountName = el('drawer-account-name');

export const blankGreetingEl = el('blank-greeting');

export const blankWorkspaceChipLabel = el('blank-workspace-chip-label');

export const connBanner = el('conn-banner');

export const bannerEl = el('banner');

export const logEl = el('log');

export const blankEl = el('blank');

export const blankWorkspaceChip = el('blank-workspace-chip');

export const composer = el('composer');

export const draft = el('draft');

export const attachRail = el('attach-rail');

export const sendBtn = el('send-btn');

export const stopBtn = el('stop-btn');

export const accessChip = el('access-chip');

export const planChip = el('plan-chip');

export const modelChip = el('model-chip');

export const approval = el('approval');

export const approvalTitle = el('approval-title');

export const approvalCommand = el('approval-command');

export const approvalActions = el('approval-actions');

export const slashPop = el('slash-pop');

export const readonlyNote = el('readonly-note');

export const sessionList = el('session-list');

export const search = el('search');

export const settings = el('settings');

export const settingsBack = el('settings-back');

export const settingsTitle = el('settings-title');

export const options = el('options');

export const backdrop = el('backdrop');

export const sheetRoot = el('sheet-root');

export const dialogRoot = el('dialog-root');

export const toastRoot = el('toast-root');

export const lightboxRoot = el('lightbox-root');

export const fileCamera = el('file-camera');

export const fileGallery = el('file-gallery');

export const jumpBottom = el('jump-bottom');

export const BASE_TITLE = document.title;

/** Keyed reuse of conversation rows; reset whenever the open session changes. */
export const logList = createKeyedList();

/** In-flight or settled `session.attachment` reads of the open session. */
export const attachmentReads = new Map();

// 手机外观与阅读偏好持久化（localStorage，对应 Android MobilePreferences）。只存手机，不写回电脑。
const PHONE_KEYS = {
  scheme: 'dsh-phone-scheme', glass: 'dsh-phone-glass', uiFont: 'dsh-phone-ui-font', gitTitle: 'dsh-phone-git-title',
  enterSend: 'dsh-phone-enter-send', messageScale: 'dsh-phone-message-scale', showReasoning: 'dsh-phone-show-reasoning',
  expandTools: 'dsh-phone-expand-tools', runningSend: 'dsh-phone-running-send',
};

const MESSAGE_SCALES = [0.875, 1, 1.125, 1.25];

function readPhoneStore() {
  let scheme = 'system';
  let glass = 80;
  let uiFont = '';
  let gitTitle = true;
  let enterSend = false;
  let messageScale = 1;
  let showReasoning = true;
  let expandTools = false;
  let runningSend = 'queue';
  try {
    const rawScheme = localStorage.getItem(PHONE_KEYS.scheme);
    if (rawScheme === 'light' || rawScheme === 'dark' || rawScheme === 'system') scheme = rawScheme;
    const storedGlass = localStorage.getItem(PHONE_KEYS.glass);
    const rawGlass = Number(storedGlass);
    if (storedGlass !== null && Number.isFinite(rawGlass) && rawGlass >= 0 && rawGlass <= 100) glass = rawGlass;
    uiFont = localStorage.getItem(PHONE_KEYS.uiFont) || '';
    if (localStorage.getItem(PHONE_KEYS.gitTitle) === 'false') gitTitle = false;
    enterSend = localStorage.getItem(PHONE_KEYS.enterSend) === 'true';
    const rawScale = Number(localStorage.getItem(PHONE_KEYS.messageScale));
    if (MESSAGE_SCALES.includes(rawScale)) messageScale = rawScale;
    if (localStorage.getItem(PHONE_KEYS.showReasoning) === 'false') showReasoning = false;
    expandTools = localStorage.getItem(PHONE_KEYS.expandTools) === 'true';
    if (localStorage.getItem(PHONE_KEYS.runningSend) === 'steer') runningSend = 'steer';
  } catch { /* storage unavailable → session memory */ }
  return { scheme, glass, uiFont, gitTitle, enterSend, messageScale, showReasoning, expandTools, runningSend };
}

export function persistPhoneStore(key, value) {
  try {
    localStorage.setItem(PHONE_KEYS[key], String(value));
  } catch { /* ignore */ }
}

export const store = readPhoneStore();

export const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

export const nativeAndroidApp = isNativeAndroidApp(navigator.userAgent);

export const HISTORY_POLL_MS = 1500;

export const state = {
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
  subagentRow: null,
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
  subagentSheet: false,
  subagentCatalog: null,
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
  extPane: { mcp: null, skills: null, plugins: null },
  // Latest `session.projections` values of the open session (queue, usage,
  // permissions, plan, model) merged with live projection frames.
  sessionValues: {},
  outbox: [],
  promptIdentity: null,
  queueBusy: '',
  queueEdit: null,
  confirmAction: null,
  scanSupport: { supported: false, reason: '' },
  transport: '',
  chisacode: null,
};

export const focusScope = createFocusScope(document);

export const menuPositioner = createMenuPositioner(document, phone);

export const composerBehavior = installComposerBehavior({ document, composer, input: draft, readingArea: logEl });

export const settingsScroll = new Map();
