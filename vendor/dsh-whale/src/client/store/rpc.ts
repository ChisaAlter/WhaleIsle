// HTTP JSON-RPC client, SSE event subscription, and mascot/avatar asset loaders for WhaleIsle Bots.

import {
  DEFAULT_BOT_AVATAR_COLOR,
  normalizeHexColor,
  tintMascotSvg,
} from '../../shared/bot-avatar-color.js';
import {
  BOT_CHANGE_KINDS,
  BOT_VIEW_KINDS,
  BOT_WORK_KINDS,
  RPC_METHODS as SHARED_RPC_METHODS,
  botChangeBotIds,
  botChangeConcerns,
  readBotChangeScope,
} from '../../shared/bot-rpc-methods.js';

export const RPC_METHODS = Object.freeze({
  ...SHARED_RPC_METHODS,
  GROUPS_ITEMS: SHARED_RPC_METHODS.GROUP_ITEMS_LIST ?? 'bots.groups.items',
  GROUP_ITEMS_LIST: SHARED_RPC_METHODS.GROUP_ITEMS_LIST ?? 'bots.groups.items',
  CHAT_DELETE: SHARED_RPC_METHODS.CHAT_DELETE ?? 'bots.chat.delete',
  WORK_STOP: SHARED_RPC_METHODS.WORK_STOP ?? 'bots.work.stop',
} as const);

export type BotRpcMethodName = (typeof RPC_METHODS)[keyof typeof RPC_METHODS];

export {
  BOT_CHANGE_KINDS,
  BOT_VIEW_KINDS,
  BOT_WORK_KINDS,
  botChangeBotIds,
  botChangeConcerns,
  readBotChangeScope,
};

export type BotDotState =
  | 'idle'
  | 'working'
  | 'monitoring'
  | 'permission'
  | 'failed'
  | 'unconfirmed'
  | 'waiting'
  | 'paused'
  | 'disconnected';

export type BotSidebarSort = 'manual' | 'smart' | 'recent' | 'name';

export interface BotSidebarView {
  sortBy: BotSidebarSort;
  hidePausedBots: boolean;
  hideSleepingWorkers: boolean;
}

export interface BotNotifications {
  needsPermission?: boolean;
  taskComplete?: boolean;
  couldNotFinish?: boolean;
}

export interface BotKickoffScanItem {
  id?: string;
  label: string;
  done: boolean;
  detail?: string;
}

export interface BotKickoffState {
  status?: 'pending' | 'running' | 'ready' | 'failed';
  step?: 'create' | 'start' | 'first-message' | 'done';
  error?: string;
  scanItems?: BotKickoffScanItem[];
}

export interface BotWaitEntry {
  id?: string;
  label: string;
  by?: number;
}

export interface BotUsageLimitInfo {
  place?: string | null;
  text?: string | null;
  at?: number;
}

export interface BotActivityLineObject {
  kind: string;
  text?: string | null;
  host?: string | null;
  place?: { source?: string | null; label: string } | string | null;
  count?: number;
  at?: number | null;
  wait?: BotWaitEntry;
  more?: number;
}

export interface BotWorkerRow {
  id?: string;
  workspaceId?: string;
  sessionId?: string;
  title?: string;
  label?: string;
  state: 'running' | 'working' | 'needs-you' | 'failed' | 'done' | 'sleeping' | 'unreachable';
  startedAt?: number;
  settledAt?: number;
  updatedAt?: number;
  statusText?: string;
}

export interface BotChatRow {
  chatId: string;
  sessionId: string;
  title?: string;
  origin: string;
  closed?: boolean;
  unread?: boolean;
  live?: 'idle' | 'replying' | 'needs-you' | 'usage-limit';
  statusText?: string;
  lastMessageText?: string;
  lastActiveAt?: number;
  createdAt?: number;
  updatedAt?: number;
  running?: BotWorkerRow[];
  runningTotal?: number;
  finished?: BotWorkerRow[];
  finishedTotal?: number;
  failedTotal?: number;
  handedOver?: boolean;
  fromClosedChat?: boolean;
}

export interface BotChatTree {
  botId?: string;
  chats: BotChatRow[];
  workspaceChats?: Record<string, string>;
}

export interface BotRecord {
  id: string;
  name: string;
  avatar?: string | null;
  avatarColor?: string | null;
  description?: string | null;
  purpose?: string | null;
  paused?: boolean;
  disconnected?: boolean;
  hostName?: string | null;
  sidebarOrder?: number;
  createdAt?: number;
  updatedAt?: number;
  lastActiveAt?: number;
  agent?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
  homePath?: string | null;
  chatSessionId?: string | null;
  homeSessionId?: string | null;
  chatPaneKey?: string | null;
  activityLine?: string | BotActivityLineObject | null;
  dotState?: BotDotState | null;
  status?: string | null;
  unread?: boolean;
  needsYouCount?: number;
  upNextCount?: number;
  usageLimit?: BotUsageLimitInfo | null;
  notifications?: BotNotifications;
  lookAroundEnabled?: boolean;
  lookAroundInterval?: string;
  tidyUpEnabled?: boolean;
  kickoff?: BotKickoffState | null;
  waits?: BotWaitEntry[];
  workers?: { permission?: number; working?: number; failed?: number };
  links?: Array<{ paneKey: string; sessionId?: string; source: string; place?: string; title?: string; lastTurn?: string }>;
  rows?: Array<Record<string, unknown>>;
}

export interface BotGroupMember {
  botId: string;
  sessionId?: string;
  addedAt?: number;
}

export interface BotGroupThread {
  id: string;
  title?: string;
  createdAt?: number;
  updatedAt?: number;
  members?: BotGroupMember[];
  formerSessionIds?: string[];
}

export type BotGroupReplyMode =
  | { kind: 'all' }
  | { kind: 'mentions' }
  | { kind: 'bot'; botId: string };

export interface BotGroupRecord {
  id: string;
  name: string;
  replyMode?: BotGroupReplyMode | 'bot' | 'all' | 'mentions';
  sidebarOrder?: number;
  createdAt?: number;
  updatedAt?: number;
  lastActiveAt?: number;
  lastMessageText?: string | null;
  lastMessageAuthor?: string | null;
  unread?: boolean;
  members: BotGroupMember[];
  formerSessionIds?: string[];
  threads?: BotGroupThread[];
}

export interface BotItemRecord {
  id: string;
  botId: string;
  title: string;
  status: 'planned' | 'working' | 'needs_you' | 'done' | 'canceled';
  summary?: string;
  doneMeans?: string;
  links?: Array<{ label?: string; url: string }>;
  snoozedUntil?: number | null;
  stale?: boolean;
  openedAt?: number | null;
  createdAt?: number;
  updatedAt?: number;
  comments?: Array<{ id?: string; author: string; text: string; createdAt?: number }>;
}

export interface BotSuggestionRecord {
  id: string;
  botId: string;
  title: string;
  summary?: string;
  prompt?: string;
  createdAt?: number;
}

export interface BotActivitySnapshot {
  botId?: string;
  items?: BotItemRecord[];
  upcoming?: Array<{ id: string; name: string; nextRunAt?: number; kind?: string }>;
  upNext?: BotSuggestionRecord[];
  recent?: Array<{ id?: string; text: string; place?: string | null; at?: number; kind?: string }>;
  needsYou?: BotItemRecord[];
  liveCount?: number;
}

export interface BotModelOption {
  id: string;
  label: string;
  provider?: string;
  agent?: string;
  reasoningEfforts?: string[];
  default?: boolean;
}

export interface BotNeedsYouPayload {
  counts: Record<string, number>;
  at: number;
  staleInMs?: number | null;
}

export interface BotChangeScope {
  botIds?: string[];
  kinds?: string[];
  kindBots?: Record<string, string[]>;
  needsYou?: BotNeedsYouPayload;
  ts?: number;
}

export interface BotGlobalSettings {
  botsEnabled: boolean;
  skipNewHomeChatConfirm: boolean;
  hideBotCreatedWorkspaces: boolean;
  botSidebarView: BotSidebarView;
  sidebarBotsHeight: number | null;
  sidebarProjectsFirst: boolean;
  petBotId: string | null;
}

export interface BotListPayload extends Partial<BotGlobalSettings> {
  bots?: BotRecord[];
  groups?: BotGroupRecord[];
  chatsByBot?: Record<string, BotChatTree | BotChatRow[]>;
  models?: BotModelOption[];
  needsYou?: Record<string, number> | BotNeedsYouPayload;
  needsYouAt?: number;
  needsYouStaleInMs?: number | null;
}

export interface BotImportSource {
  id: string;
  source?: string;
  sourceKind?: string;
  name: string;
  description?: string;
  path: string;
  avatar?: string | null;
  avatarColor?: string | null;
  avatarDataUrl?: string | null;
  memoryCount?: number;
  skillCount?: number;
  imported?: boolean;
}

export interface BotSharePrepareResult {
  manifest: Record<string, unknown>;
  files?: Record<string, string>;
  soul?: string;
  avatarDataUrl?: string | null;
  packageJson?: string;
  redactedCount?: number;
  redactions?: number;
  warnings?: string[];
}

export interface BotItemAttachmentImage {
  name?: string;
  mimeType: string;
  dataUrl: string;
  bytes?: number;
}

export interface BotItemAttachmentFile {
  name: string;
  mimeType?: string;
  bytes?: number;
  path?: string;
  text?: string;
  textContent?: string;
  dataUrl?: string;
}

export interface BotItemOwnerCommentParams {
  botId: string;
  uid: string;
  text: string;
  requestId?: string;
  questionEventId?: number | string | null;
  plain?: boolean;
  askedInConversation?: string | null;
  files?: BotItemAttachmentFile[];
  images?: BotItemAttachmentImage[];
}

export interface BotItemOwnerStatusParams {
  botId: string;
  uid?: string;
  uids?: string[];
  status: BotItemRecord['status'];
  reason?: string;
  note?: string;
}

export interface BotItemOwnerSnoozeItem {
  uid: string;
  othersLastEventId?: number;
}

export interface BotItemOwnerSnoozeParams {
  botId: string;
  uid?: string;
  uids?: string[];
  items?: BotItemOwnerSnoozeItem[];
  until?: number | null;
  preset?: string | null;
  clear?: boolean;
  othersLastEventId?: number;
}

export interface BotUpNextSeenParams {
  botId: string;
  id?: string;
  suggestionId?: string;
  ids?: string[];
}

export interface BotTakeOverParams {
  botId: string;
  cwd: string;
  title?: string;
  chat?: 'home' | 'new';
  prompt?: string | null;
}

export interface BotTakeOverResult {
  ok?: boolean;
  botId?: string;
  sessionId?: string;
  cwd?: string;
}

export interface BotGroupItemsParams {
  groupId: string;
  scope?: 'group' | 'all';
  botId?: string;
  onlyNeedsYou?: boolean;
  threadId?: string;
  openOnly?: boolean;
  closedOnly?: boolean;
  closedCursor?: string | null;
  limit?: number;
}

export interface BotGroupStopParams {
  groupId: string;
  threadId?: string;
  turnId?: string;
  botId?: string;
  sequence?: number;
}

export interface BotChatDeleteParams {
  botId: string;
  sessionId: string;
  chatId?: string;
}

export interface BotWorkStopParams {
  botId: string;
  workId: string;
  sessionId?: string;
}

export interface BotRpcOptions {
  signal?: AbortSignal;
}

export class BotRpcError extends Error {
  readonly code: string;
  readonly method: string;
  readonly details?: unknown;

  constructor(code: string, message: string, method: string, details?: unknown) {
    super(message || code);
    this.name = 'BotRpcError';
    this.code = code;
    this.method = method;
    this.details = details;
  }
}

interface RpcEnvelope<T> {
  ok: boolean;
  result?: T;
  error?: { code?: string; message?: string; details?: unknown };
}

export function getBotsApiBase(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  const custom = (window as unknown as { __DSH_BOTS_API_BASE__?: string }).__DSH_BOTS_API_BASE__;
  return typeof custom === 'string' ? custom.replace(/\/+$/, '') : '';
}

export async function callBotRpc<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  options: BotRpcOptions = {},
): Promise<T> {
  const url = `${getBotsApiBase()}/dsh-bots/rpc`;
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, params }),
    signal: options.signal,
  });

  let payload: RpcEnvelope<T> | null = null;
  try {
    payload = (await response.json()) as RpcEnvelope<T>;
  } catch (parseErr) {
    if (!response.ok) {
      throw new BotRpcError(`http_${response.status}`, response.statusText || 'RPC request failed', method, parseErr);
    }
    throw new BotRpcError('invalid_json', 'Malformed JSON response from bots RPC', method, parseErr);
  }

  if (!response.ok || !payload || payload.ok !== true) {
    const code = payload?.error?.code ?? `http_${response.status}`;
    const message = payload?.error?.message ?? response.statusText ?? 'RPC failed';
    throw new BotRpcError(code, message, method, payload?.error?.details);
  }
  return payload.result as T;
}

export interface BotEventsHandlers {
  onChanged: (scope: BotChangeScope) => void;
  onReady?: () => void;
  onReconnect?: () => void;
  onError?: (error: unknown) => void;
}

const SSE_MIN_DELAY_MS = 1000;
const SSE_MAX_DELAY_MS = 30_000;

function parseEventData(raw: string): BotChangeScope {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const scope = readBotChangeScope(parsed) as BotChangeScope | undefined;
    const ts = typeof parsed.ts === 'number' ? parsed.ts : Date.now();
    return scope ? { ...scope, ts } : { ts };
  } catch (err) {
    console.warn('[dsh-bots] Failed to parse SSE bots:changed payload', err);
    return { ts: Date.now() };
  }
}

export function subscribeBotEvents(handlers: BotEventsHandlers): () => void {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
    return () => {
      // No-op in non-browser contexts.
    };
  }

  let source: EventSource | null = null;
  let retryTimer: number | null = null;
  let retryDelay = SSE_MIN_DELAY_MS;
  let hasConnectedOnce = false;
  let closed = false;

  const clearRetry = () => {
    if (retryTimer !== null) {
      window.clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const closeSource = () => {
    if (source) {
      source.close();
      source = null;
    }
  };

  const scheduleReconnect = () => {
    if (closed || retryTimer !== null) {
      return;
    }
    const delay = retryDelay;
    retryDelay = Math.min(SSE_MAX_DELAY_MS, Math.round(retryDelay * 1.8));
    retryTimer = window.setTimeout(() => {
      retryTimer = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (closed) {
      return;
    }
    closeSource();
    const url = `${getBotsApiBase()}/dsh-bots/events`;
    const es = new EventSource(url, { withCredentials: true });
    source = es;

    const handleReady = () => {
      const reconnected = hasConnectedOnce;
      hasConnectedOnce = true;
      retryDelay = SSE_MIN_DELAY_MS;
      handlers.onReady?.();
      if (reconnected) {
        handlers.onReconnect?.();
      }
    };

    es.addEventListener('ready', handleReady);
    es.addEventListener('open', () => {
      retryDelay = SSE_MIN_DELAY_MS;
    });
    es.addEventListener('bots:changed', (event) => {
      const msg = event as MessageEvent<string>;
      handlers.onChanged(parseEventData(msg.data));
    });
    es.onerror = (err) => {
      handlers.onError?.(err);
      closeSource();
      scheduleReconnect();
    };
  };

  const handleVisibility = () => {
    if (document.visibilityState === 'visible' && !source && !closed) {
      clearRetry();
      retryDelay = SSE_MIN_DELAY_MS;
      connect();
    }
  };

  document.addEventListener('visibilitychange', handleVisibility);
  connect();

  return () => {
    closed = true;
    clearRetry();
    closeSource();
    document.removeEventListener('visibilitychange', handleVisibility);
  };
}

// ---- Mascot SVG/WebP asset URLs and upload avatar cache ----

export type MascotAssetKind = 'svg' | 'webp' | 'rim';

export function mascotAssetUrl(mascotId: string, kind: MascotAssetKind = 'svg'): string {
  const base = `${getBotsApiBase()}/dsh-bots/assets/mascots`;
  if (kind === 'webp') {
    return `${base}/${mascotId}.webp`;
  }
  if (kind === 'rim') {
    return `${base}/${mascotId}-rim.webp`;
  }
  return `${base}/${mascotId}.svg`;
}

const rawSvgCache = new Map<string, Promise<string | null>>();
const tintedDataUrlCache = new Map<string, string>();
const uploadAvatarCache = new Map<string, Promise<string | null>>();

const MAX_TINTED_CACHE = 240;

export function loadMascotSvgText(mascotId: string): Promise<string | null> {
  const existing = rawSvgCache.get(mascotId);
  if (existing) {
    return existing;
  }
  const task = fetch(mascotAssetUrl(mascotId, 'svg'), { credentials: 'include' })
    .then((res) => (res.ok ? res.text() : null))
    .catch((err) => {
      console.warn(`[dsh-bots] Failed to load mascot SVG ${mascotId}`, err);
      rawSvgCache.delete(mascotId);
      return null;
    });
  rawSvgCache.set(mascotId, task);
  return task;
}

export async function getTintedMascotDataUrl(
  mascotId: string,
  color?: string | null,
): Promise<string | null> {
  const hex = normalizeHexColor(color) ?? DEFAULT_BOT_AVATAR_COLOR;
  if (hex === DEFAULT_BOT_AVATAR_COLOR) {
    return mascotAssetUrl(mascotId, 'svg');
  }
  const key = `${mascotId}|${hex}`;
  const cached = tintedDataUrlCache.get(key);
  if (cached) {
    return cached;
  }
  const svgText = await loadMascotSvgText(mascotId);
  if (!svgText) {
    return null;
  }
  const tinted = tintMascotSvg(svgText, hex);
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(tinted)}`;
  if (tintedDataUrlCache.size >= MAX_TINTED_CACHE) {
    const oldest = tintedDataUrlCache.keys().next().value;
    if (oldest !== undefined) {
      tintedDataUrlCache.delete(oldest);
    }
  }
  tintedDataUrlCache.set(key, dataUrl);
  return dataUrl;
}

export function readUploadedAvatarDataUrl(
  botId: string,
  version: string,
): Promise<string | null> {
  const key = `${botId}|${version}`;
  const existing = uploadAvatarCache.get(key);
  if (existing) {
    return existing;
  }
  const task = callBotRpc<{ dataUrl?: string | null }>(RPC_METHODS.AVATAR_READ, { botId, version })
    .then((res) => (typeof res?.dataUrl === 'string' && res.dataUrl ? res.dataUrl : null))
    .catch((err) => {
      console.warn(`[dsh-bots] Failed to read uploaded avatar for ${botId}`, err);
      uploadAvatarCache.delete(key);
      return null;
    });
  uploadAvatarCache.set(key, task);
  return task;
}

export function invalidateUploadedAvatarCache(botId: string): void {
  const prefix = `${botId}|`;
  for (const key of uploadAvatarCache.keys()) {
    if (key.startsWith(prefix)) {
      uploadAvatarCache.delete(key);
    }
  }
}
