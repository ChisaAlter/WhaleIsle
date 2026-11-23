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
  RPC_METHODS,
  botChangeBotIds,
  botChangeConcerns,
  readBotChangeScope,
} from '../../shared/bot-rpc-methods.js';

export {
  BOT_CHANGE_KINDS,
  BOT_VIEW_KINDS,
  BOT_WORK_KINDS,
  RPC_METHODS,
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
  | { kind: 'bot'; botId: string }
  | { kind: 'coordinator'; coordinatorBotId?: string };

export interface BotGroupRecord {
  id: string;
  name: string;
  replyMode?: BotGroupReplyMode | 'bot' | 'all' | 'mentions' | 'coordinator';
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

// ---- Wave 1+ Typed RPC Contracts & Defensive Helpers ----

export interface BotPromptToolInfo {
  name: string;
  effect?: string;
  source?: string;
}

export interface BotPromptSnapshotSummary {
  index?: number;
  id?: string;
  at?: number;
  timestamp?: number;
  model?: string | null;
  provider?: string | null;
  tokenEstimate?: number;
  systemChars?: number;
  toolsCount?: number;
  tools?: Array<string | BotPromptToolInfo>;
  skills?: string[];
  linkedSkills?: string[];
  hasCrewMd?: boolean;
  hasPlanMd?: boolean;
  promptPreview?: string;
  systemPrompt?: string;
}

export interface BotPromptInspectResult {
  botId?: string;
  latest?: BotPromptSnapshotSummary | null;
  snapshots?: BotPromptSnapshotSummary[];
  tools?: Array<string | BotPromptToolInfo>;
  linkedSkills?: string[];
  systemPrompt?: string;
  updatedAt?: number;
}

export interface BotPromptDiffResult {
  fromIndex?: number;
  toIndex?: number;
  fromAt?: number;
  toAt?: number;
  addedLines?: string[];
  removedLines?: string[];
  addedTools?: string[];
  removedTools?: string[];
  diffText?: string;
  changed?: boolean;
}

export interface BotBudgetConfig {
  botId?: string;
  dailyLimitUsd?: number | null;
  dailyLimitTokens?: number | null;
  offPeakOnly?: boolean;
  pauseOnExceed?: boolean;
  alertThresholdPct?: number;
  updatedAt?: number;
}

export interface BotBudgetUsageSummary {
  botId?: string;
  dayUtc?: string;
  costUsd?: number;
  peakCostUsd?: number;
  offPeakCostUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  cacheHitRate?: number;
  isOffPeak?: boolean;
  nextPeakSwitchMs?: number | null;
  exceeded?: boolean;
  budget?: BotBudgetConfig | null;
}

export interface BotCrewAdoption {
  sessionId: string;
  botId: string;
  workspaceId?: string | null;
  cwd?: string | null;
  title?: string | null;
  role?: string;
  status?: 'active' | 'released';
  adoptedAt?: number;
  releasedAt?: number | null;
}

export interface BotDecisionRow {
  ts?: string;
  actor?: string;
  phase?: string;
  decision?: string;
  evidence?: string;
  notes?: string;
}

export interface BotDecisionTsvResult {
  path?: string;
  header?: string[];
  rows: BotDecisionRow[];
}

export interface BotToolProblem {
  server?: string;
  name?: string;
  code?: string;
  severity?: 'error' | 'warn';
  message: string;
  at?: number;
}

export interface BotMemorySearchHit {
  entryId?: string;
  scope?: 'bot' | 'team' | 'project';
  scopeId?: string;
  sourceFile?: string;
  factDate?: string | null;
  body: string;
  score?: number;
}

export interface BotSkillRecordDraftResult {
  ok?: boolean;
  reason?: string;
  message?: string;
  name?: string;
  description?: string;
  skillMd?: string;
  markdown?: string;
  framesCaptured?: number;
  redactedCount?: number;
}

export interface PetVoiceState {
  ok?: boolean;
  available?: boolean;
  enabled?: boolean;
  state?: 'idle' | 'listening' | 'thinking' | 'speaking' | 'unavailable';
  reason?: string;
  message?: string;
}

export async function inspectBotPrompt(botId: string): Promise<BotPromptInspectResult | null> {
  const res = await callBotRpc<BotPromptInspectResult | null>(RPC_METHODS.PROMPT_INSPECT, { botId });
  if (!res || typeof res !== 'object') return null;
  return {
    ...res,
    snapshots: Array.isArray(res.snapshots) ? res.snapshots : [],
    tools: Array.isArray(res.tools) ? res.tools : [],
    linkedSkills: Array.isArray(res.linkedSkills) ? res.linkedSkills : [],
  };
}

export async function diffBotPrompt(
  botId: string,
  fromIdx?: number,
  toIdx?: number,
): Promise<BotPromptDiffResult | null> {
  const res = await callBotRpc<BotPromptDiffResult | null>(RPC_METHODS.PROMPT_DIFF, {
    botId,
    ...(fromIdx !== undefined ? { fromIdx } : {}),
    ...(toIdx !== undefined ? { toIdx } : {}),
  });
  if (!res || typeof res !== 'object') return null;
  return {
    ...res,
    addedLines: Array.isArray(res.addedLines) ? res.addedLines : [],
    removedLines: Array.isArray(res.removedLines) ? res.removedLines : [],
    addedTools: Array.isArray(res.addedTools) ? res.addedTools : [],
    removedTools: Array.isArray(res.removedTools) ? res.removedTools : [],
  };
}

export async function getBotBudget(botId: string): Promise<BotBudgetConfig | null> {
  const res = await callBotRpc<BotBudgetConfig | { budget?: BotBudgetConfig | null } | null>(
    RPC_METHODS.BUDGET_GET,
    { botId },
  );
  if (!res || typeof res !== 'object') return null;
  if ('budget' in res) return res.budget ?? null;
  return res as BotBudgetConfig;
}

export async function setBotBudget(
  botId: string,
  patch: Partial<BotBudgetConfig>,
): Promise<BotBudgetConfig | null> {
  const res = await callBotRpc<BotBudgetConfig | { budget?: BotBudgetConfig | null } | null>(
    RPC_METHODS.BUDGET_SET,
    { botId, ...patch },
  );
  if (!res || typeof res !== 'object') return null;
  if ('budget' in res) return res.budget ?? null;
  return res as BotBudgetConfig;
}

export async function getBotBudgetUsage(
  botId: string,
  dayUtc?: string,
): Promise<BotBudgetUsageSummary | null> {
  const res = await callBotRpc<BotBudgetUsageSummary | { usage?: BotBudgetUsageSummary | null } | null>(
    RPC_METHODS.BUDGET_USAGE,
    { botId, ...(dayUtc ? { dayUtc } : {}) },
  );
  if (!res || typeof res !== 'object') return null;
  if ('usage' in res && res.usage && typeof res.usage === 'object') {
    return { ...res, ...res.usage };
  }
  return res as BotBudgetUsageSummary;
}

export async function listBotCrew(
  botId: string,
  status: 'active' | 'released' | 'all' = 'active',
): Promise<BotCrewAdoption[]> {
  const res = await callBotRpc<BotCrewAdoption[] | { crew?: BotCrewAdoption[]; adoptions?: BotCrewAdoption[] } | null>(
    RPC_METHODS.CREW_LIST,
    { botId, status },
  );
  const rows = Array.isArray(res)
    ? res
    : (Array.isArray(res?.crew) ? res.crew : (Array.isArray(res?.adoptions) ? res.adoptions : []));
  return rows.filter((row): row is BotCrewAdoption => Boolean(row && typeof row.sessionId === 'string'));
}

export async function adoptBotCrew(params: {
  botId: string;
  sessionId: string;
  workspaceId?: string;
  cwd?: string;
  title?: string;
  role?: string;
}): Promise<BotCrewAdoption | null> {
  const res = await callBotRpc<BotCrewAdoption | { adoption?: BotCrewAdoption } | null>(
    RPC_METHODS.CREW_ADOPT,
    params,
  );
  if (!res || typeof res !== 'object') return null;
  return 'adoption' in res && res.adoption ? res.adoption : (res as BotCrewAdoption);
}

export async function releaseBotCrew(sessionId: string, botId?: string): Promise<void> {
  await callBotRpc(RPC_METHODS.CREW_RELEASE, {
    sessionId,
    ...(botId ? { botId } : {}),
  });
}

export async function readItemDecisions(botId: string, itemUid: string): Promise<BotDecisionTsvResult> {
  const res = await callBotRpc<BotDecisionTsvResult | BotDecisionRow[] | null>(
    RPC_METHODS.DECISIONS_READ,
    { botId, itemUid },
  );
  if (Array.isArray(res)) {
    return { rows: res };
  }
  if (!res || typeof res !== 'object') {
    return { rows: [] };
  }
  return {
    path: typeof res.path === 'string' ? res.path : undefined,
    header: Array.isArray(res.header) ? res.header : undefined,
    rows: Array.isArray(res.rows) ? res.rows : [],
  };
}

export async function listBotToolProblems(botId: string): Promise<BotToolProblem[]> {
  const res = await callBotRpc<BotToolProblem[] | { problems?: BotToolProblem[] } | null>(
    RPC_METHODS.TOOLS_PROBLEMS,
    { botId },
  );
  const rows = Array.isArray(res) ? res : (Array.isArray(res?.problems) ? res.problems : []);
  return rows.filter((row): row is BotToolProblem => Boolean(row && typeof row.message === 'string'));
}

export async function searchBotMemory(params: {
  botId: string;
  query: string;
  scope?: 'bot' | 'team' | 'project' | 'all';
  limit?: number;
}): Promise<BotMemorySearchHit[]> {
  const res = await callBotRpc<BotMemorySearchHit[] | { hits?: BotMemorySearchHit[]; results?: BotMemorySearchHit[] } | null>(
    RPC_METHODS.MEMORY_SEARCH,
    params,
  );
  const rows = Array.isArray(res)
    ? res
    : (Array.isArray(res?.hits) ? res.hits : (Array.isArray(res?.results) ? res.results : []));
  return rows.filter((row): row is BotMemorySearchHit => Boolean(row && typeof row.body === 'string'));
}

export async function approveGroupPlan(
  groupId: string,
  messageId: string,
  threadId?: string,
): Promise<unknown> {
  return callBotRpc(RPC_METHODS.GROUPS_APPROVE_PLAN, {
    groupId,
    messageId,
    ...(threadId ? { threadId } : {}),
  });
}

export async function setConnectorChannelRoute(params: {
  channel: string;
  accountId?: string;
  botId: string | null;
}): Promise<unknown> {
  return callBotRpc(RPC_METHODS.CONNECTORS_SET_ROUTE, params);
}

export async function recordSkillDraft(
  botId: string,
  params: { goal?: string; maxFrames?: number; durationSec?: number } = {},
): Promise<BotSkillRecordDraftResult> {
  try {
    const res = await callBotRpc<BotSkillRecordDraftResult | null>(RPC_METHODS.SKILL_RECORD_DRAFT, {
      botId,
      ...params,
    });
    return res && typeof res === 'object' ? res : { ok: false, reason: 'capture_unavailable' };
  } catch (err) {
    if (err instanceof BotRpcError && (err.code === 'capture_unavailable' || err.code === 'unknown_method' || err.code === 'not_implemented')) {
      return { ok: false, reason: 'capture_unavailable', message: err.message };
    }
    throw err;
  }
}

export async function saveRecordedSkill(
  botId: string,
  params: { name: string; skillMd: string; description?: string },
): Promise<unknown> {
  return callBotRpc(RPC_METHODS.SKILL_RECORD_SAVE, { botId, ...params });
}

export async function getPetVoiceState(): Promise<PetVoiceState> {
  try {
    const res = await callBotRpc<PetVoiceState | null>(RPC_METHODS.VOICE_STATE);
    return res && typeof res === 'object' ? res : { ok: false, available: false, enabled: false, state: 'unavailable', reason: 'voice_unavailable' };
  } catch (err) {
    if (err instanceof BotRpcError) {
      return { ok: false, available: false, enabled: false, state: 'unavailable', reason: err.code || 'voice_unavailable', message: err.message };
    }
    return { ok: false, available: false, enabled: false, state: 'unavailable', reason: 'voice_unavailable' };
  }
}

export async function togglePetVoice(enabled: boolean): Promise<PetVoiceState> {
  try {
    const res = await callBotRpc<PetVoiceState | null>(RPC_METHODS.VOICE_TOGGLE, { enabled });
    return res && typeof res === 'object' ? res : { ok: false, available: false, enabled: false, state: 'unavailable', reason: 'voice_unavailable' };
  } catch (err) {
    if (err instanceof BotRpcError) {
      return { ok: false, available: false, enabled: false, state: 'unavailable', reason: err.code || 'voice_unavailable', message: err.message };
    }
    return { ok: false, available: false, enabled: false, state: 'unavailable', reason: 'voice_unavailable' };
  }
}
