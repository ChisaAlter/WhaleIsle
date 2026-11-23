// Core bot domain constants, validation, normalization, dot states, and global settings.

import { normalizeHexColor } from './bot-avatar-color.js';

export * from './bot-rpc-methods.js';

export const BOT_LIMITS = Object.freeze({
  nameMaxLength: 64,
  folderMaxLength: 40,
  handedPairedWorkspacesMax: 50,
  maxMembers: 200,
  maxConnectorWorkspaces: 8,
  maxSkillProjects: 20,
  memoryLoadLimit: 200,
  memoryHistoryDays: 90,
  memoryHistoryMaxRows: 1000,
  groupMaxMembers: 32,
  groupMaxImages: 20,
  groupContextMaxBytes: 24_000,
  chatFoldsMax: 500,
  sidebarMinHeight: 88,
  projectsMinListHeight: 120,
  sidebarMaxStoredHeight: 4000,
  lookAroundFocusMaxLength: 500,
});

export const BOT_HELD_BACK_AGENTS = Object.freeze(['kimi']);

export const BOT_AGENTS = Object.freeze([
  'claude',
  'codex',
  'grok',
  'opencode',
  'omp',
  'pi',
  'antigravity',
  'cursor',
  'hermes',
  'copilot',
  'opencode2',
  'deepseek-harness',
]);

export function isBotAgent(agent) {
  return typeof agent === 'string' && BOT_AGENTS.includes(agent);
}

/** 11 bot/agent dot states. */
export const BOT_DOT_STATES = Object.freeze([
  'working',
  'monitoring',
  'blocked',
  'waiting',
  'interrupted',
  'failed',
  'done',
  'idle',
  'unverifiable',
  'unconfirmed',
  'permission',
]);

export const LIVE_BOT_DOT_STATES = Object.freeze(['working', 'monitoring', 'blocked', 'waiting']);

export function isLiveBotDotState(state) {
  return typeof state === 'string' && LIVE_BOT_DOT_STATES.includes(state);
}

const DIRECT_DOT_STATES = new Set(['blocked', 'waiting', 'done', 'idle', 'unverifiable']);

export function agentRowDotState(state, workingMode) {
  if (state === 'working') {
    return workingMode === 'monitoring' ? 'monitoring' : 'working';
  }
  return DIRECT_DOT_STATES.has(state) ? state : 'idle';
}

export const DEFAULT_BOT_NOTIFICATIONS = Object.freeze({
  needsPermission: true,
  taskComplete: true,
  couldNotFinish: true,
});

export const DEFAULT_LOOK_AROUND = Object.freeze({
  on: true,
  every: 'every-4h',
  weekdaysOnly: true,
  focus: '',
});

export const DEFAULT_TIDY_UP = Object.freeze({
  on: true,
  every: 'night',
});

export const BOT_ITEMS_STALE_CHOICES = Object.freeze([3, 5, 7, 14, 'never']);

export const BOT_CREATED_KICKOFF = '鲸屿：你刚刚加入团队，请完成首次初始化并简短打个招呼。';
export const WHALE_BOT_CREATED_KICKOFF_PREFIX = '鲸屿：你刚刚加入团队';
export const LEGACY_BOT_CREATED_KICKOFF_PREFIX = 'Orca: you were just created';
export const BOT_CREATED_STATUS_LABEL = '正在初始化';

export function isBotCreatedKickoff(prompt) {
  if (typeof prompt !== 'string') {
    return false;
  }
  const trimmed = prompt.trim();
  return trimmed.startsWith(WHALE_BOT_CREATED_KICKOFF_PREFIX)
    || trimmed.startsWith(LEGACY_BOT_CREATED_KICKOFF_PREFIX);
}

export const BOT_RUNTIME_CAPABILITIES = Object.freeze([
  'bots.groups.v1',
  'bots.group-attachments.v1',
  'bots.mobile.v1',
  'bots.create.v1',
  'bots.tools.owned-sign-in.v1',
  'bots.connectors.v1',
  'bots.templates.v2',
  'bots.chat-mentions.v1',
  'bots.items.v1',
  'bots.item-comment-attachments.v1',
  'bots.item-comment-request-id.v1',
  'bots.session-links.v1',
  'bots.avatar-color.v1',
  'bots.home-pin.v1',
]);

export const BOT_ERROR_CODES = Object.freeze([
  'bot_name_taken',
  'bot_not_found',
  'bot_folder_not_owned',
  'bot_avatar_invalid',
  'bot_offer_already_answered',
]);

export const BOTS_DISABLED_CODE = 'bots_disabled';
export const BOTS_DISABLED_MESSAGE =
  'Bots are turned off in Settings › Bots. Turn on Enable bots there to create or use a bot.';

export class BotsDisabledError extends Error {
  constructor() {
    super(BOTS_DISABLED_MESSAGE);
    this.name = 'BotsDisabledError';
    this.code = BOTS_DISABLED_CODE;
  }
}

export function isBotsEnabled(settings) {
  return settings?.botsEnabled !== false;
}

export const UNNAMED_BOT_NAME = 'New bot';

const CONTROL_CHAR_RE = /\p{Cc}/u;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com\d|lpt\d)$/;
const FOLDER_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LOOK_AROUND_EVERY_SET = new Set(['every-4h', 'every-2h', 'twice-daily', 'mornings']);
const TIDY_UP_EVERY_SET = new Set(['night', 'week']);

export function validateBotName(name, options = {}) {
  if (typeof name !== 'string') {
    return { ok: false, code: 'missing_name', reason: 'Missing bot name' };
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return options.allowEmpty
      ? { ok: true, name: '' }
      : { ok: false, code: 'missing_name', reason: 'Missing bot name' };
  }
  if (trimmed.length > BOT_LIMITS.nameMaxLength) {
    return { ok: false, code: 'name_too_long', reason: `Bot name must be at most ${BOT_LIMITS.nameMaxLength} characters` };
  }
  if (CONTROL_CHAR_RE.test(trimmed)) {
    return { ok: false, code: 'control_characters', reason: 'Bot names cannot contain control characters' };
  }
  if (hasBotNameConflict(trimmed, options)) {
    return { ok: false, code: 'bot_name_taken', reason: 'A bot with this name already exists' };
  }
  return { ok: true, name: trimmed };
}

function hasBotNameConflict(trimmed, options) {
  if (!Array.isArray(options.existingBots)) {
    return false;
  }
  const lower = trimmed.toLowerCase();
  return options.existingBots.some(
    (bot) => bot && bot.id !== options.ignoreBotId && String(bot.name ?? '').trim().toLowerCase() === lower,
  );
}

export function newBotName(requested, bots = []) {
  if (typeof requested === 'string' && requested.trim()) {
    return requested.trim();
  }
  const used = new Set(bots.map((bot) => String(bot?.name ?? '').toLowerCase()));
  let candidate = UNNAMED_BOT_NAME;
  for (let n = 2; used.has(candidate.toLowerCase()); n += 1) {
    candidate = `${UNNAMED_BOT_NAME} ${n}`;
  }
  return candidate;
}

/**
 * Computes a safe folder slug for every OS, guarding Windows reserved device names
 * (`con`, `prn`, `aux`, `nul`, `com0..9`, `lpt0..9`) with `-bot`, and optionally
 * appending `-2`, `-3`, … when `takenFolders` already holds the base slug.
 */
export function botFolderName(botName, takenFolders = null) {
  const raw = typeof botName === 'string' ? botName : '';
  const slug = raw
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, BOT_LIMITS.folderMaxLength)
    .replace(/-+$/, '');
  const base = !slug ? 'bot' : WINDOWS_RESERVED_NAME.test(slug) ? `${slug}-bot` : slug;
  if (!takenFolders) {
    return base;
  }
  const taken = new Set(Array.from(takenFolders, (entry) => String(entry).toLowerCase()));
  if (!taken.has(base)) {
    return base;
  }
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const trimmedBase = base.slice(0, Math.max(1, BOT_LIMITS.folderMaxLength - suffix.length)).replace(/-+$/, '');
    const candidate = `${trimmedBase || 'bot'}${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

export function botSlackApps(bot) {
  return bot?.slackApps ?? (bot?.slack ? [bot.slack] : []);
}

export function botLinearWorkspaces(bot) {
  return bot?.linearWorkspaces ?? (bot?.linear ? [bot.linear] : []);
}

export function botHasConnector(bot) {
  return botSlackApps(bot).length > 0 || botLinearWorkspaces(bot).length > 0 || (bot?.github ?? null) !== null;
}

export function botMemberSource(member) {
  return member?.source ?? 'slack';
}

export function botMembersFrom(members, source) {
  return (Array.isArray(members) ? members : []).filter((member) => botMemberSource(member) === source);
}

export function withSlackMembersTagged(bot) {
  const first = botSlackApps(bot)[0]?.teamId;
  if (first === undefined || !Array.isArray(bot?.members)) {
    return bot;
  }
  if (!bot.members.some((member) => botMemberSource(member) === 'slack' && !member.workspaceId)) {
    return bot;
  }
  return {
    ...bot,
    members: bot.members.map((member) => (
      botMemberSource(member) === 'slack' && !member.workspaceId
        ? { ...member, source: 'slack', workspaceId: first }
        : member
    )),
  };
}

export function slackMembersOf(bot, teamId) {
  const first = botSlackApps(bot)[0]?.teamId;
  return botMembersFrom(bot.members, 'slack').filter((member) => (
    member.workspaceId === undefined ? teamId === first : member.workspaceId === teamId
  ));
}

export function linearMembersOf(members, workspaceId) {
  return botMembersFrom(members, 'linear').filter((member) => member.workspaceId === workspaceId);
}

export function gitHubMembersOf(members, installationId) {
  return botMembersFrom(members, 'github').filter(
    (member) => member.workspaceId === undefined || member.workspaceId === installationId,
  );
}

export function withoutBotMember(members, key) {
  return (Array.isArray(members) ? members : []).filter((member) => (
    member.id !== key.id
    || botMemberSource(member) !== key.source
    || (key.workspaceId !== undefined && member.workspaceId !== key.workspaceId)
  ));
}

function normalizeNotifications(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_BOT_NOTIFICATIONS };
  }
  return {
    needsPermission: typeof raw.needsPermission === 'boolean' ? raw.needsPermission : true,
    taskComplete: typeof raw.taskComplete === 'boolean' ? raw.taskComplete : true,
    couldNotFinish: typeof raw.couldNotFinish === 'boolean' ? raw.couldNotFinish : true,
  };
}

function normalizeLookAroundField(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.on !== 'boolean') {
    return undefined;
  }
  const every = LOOK_AROUND_EVERY_SET.has(raw.every) ? raw.every : DEFAULT_LOOK_AROUND.every;
  const weekdaysOnly = typeof raw.weekdaysOnly === 'boolean' ? raw.weekdaysOnly : DEFAULT_LOOK_AROUND.weekdaysOnly;
  const focus = typeof raw.focus === 'string'
    ? raw.focus.slice(0, BOT_LIMITS.lookAroundFocusMaxLength)
    : DEFAULT_LOOK_AROUND.focus;
  return {
    on: raw.on,
    every,
    weekdaysOnly,
    focus,
    ...(typeof raw.since === 'number' && Number.isFinite(raw.since) ? { since: raw.since } : {}),
  };
}

function normalizeTidyUpField(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.on !== 'boolean') {
    return undefined;
  }
  const every = TIDY_UP_EVERY_SET.has(raw.every) ? raw.every : DEFAULT_TIDY_UP.every;
  return {
    on: raw.on,
    every,
    ...(typeof raw.since === 'number' && Number.isFinite(raw.since) ? { since: raw.since } : {}),
  };
}

function normalizeMembersField(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !entry.id) {
      continue;
    }
    out.push({
      id: entry.id,
      name: typeof entry.name === 'string' ? entry.name : '',
      ...(typeof entry.source === 'string' && entry.source ? { source: entry.source } : {}),
      ...(typeof entry.workspaceId === 'string' && entry.workspaceId ? { workspaceId: entry.workspaceId } : {}),
      ...(typeof entry.avatarUrl === 'string' && entry.avatarUrl ? { avatarUrl: entry.avatarUrl } : {}),
    });
    if (out.length >= BOT_LIMITS.maxMembers) {
      break;
    }
  }
  return out;
}

function isNonNegInt(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function normalizeConnectorFields(raw) {
  return {
    slack: raw.slack && typeof raw.slack === 'object' ? raw.slack : null,
    ...(Array.isArray(raw.slackApps) ? { slackApps: raw.slackApps.slice(0, BOT_LIMITS.maxConnectorWorkspaces) } : {}),
    linear: raw.linear && typeof raw.linear === 'object' ? raw.linear : null,
    ...(Array.isArray(raw.linearWorkspaces)
      ? { linearWorkspaces: raw.linearWorkspaces.slice(0, BOT_LIMITS.maxConnectorWorkspaces) }
      : {}),
    github: raw.github && typeof raw.github === 'object' ? raw.github : null,
    ...(typeof raw.slackMirror === 'boolean' ? { slackMirror: raw.slackMirror } : {}),
    ...(typeof raw.google === 'boolean' ? { google: raw.google } : {}),
  };
}

function normalizeDisplayOptionals(raw) {
  const out = {};
  const avatarColor = raw.avatarColor === null ? null : normalizeHexColor(raw.avatarColor);
  if (avatarColor !== null || raw.avatarColor === null) {
    out.avatarColor = avatarColor;
  }
  if (isNonNegInt(raw.sidebarOrder)) {
    out.sidebarOrder = raw.sidebarOrder;
  }
  if (BOT_ITEMS_STALE_CHOICES.includes(raw.itemsStale)) {
    out.itemsStale = raw.itemsStale;
  }
  if (isNonNegInt(raw.itemsSeen)) {
    out.itemsSeen = raw.itemsSeen;
  }
  if (raw.firstRun === true) {
    out.firstRun = true;
  }
  if (typeof raw.templateId === 'string' && raw.templateId.length <= 64) {
    out.templateId = raw.templateId;
  }
  return out;
}

function normalizeRuntimeOptionals(raw) {
  const out = {};
  const lookAround = normalizeLookAroundField(raw.lookAround);
  if (lookAround) {
    out.lookAround = lookAround;
  }
  const tidyUp = normalizeTidyUpField(raw.tidyUp);
  if (tidyUp) {
    out.tidyUp = tidyUp;
  }
  if (Array.isArray(raw.skillProjects)) {
    out.skillProjects = raw.skillProjects
      .filter((id) => typeof id === 'string' && id.length > 0)
      .slice(0, BOT_LIMITS.maxSkillProjects);
  }
  if (raw.launch && typeof raw.launch === 'object' && !Array.isArray(raw.launch)) {
    out.launch = raw.launch;
  }
  if (typeof raw.permissionMode === 'string' && raw.permissionMode.length > 0) {
    out.permissionMode = raw.permissionMode;
  }
  return out;
}

function finiteTime(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Validates and normalizes a raw persisted bot record; returns `null` if core identity is invalid. */
export function normalizeBotRecord(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const nameCheck = validateBotName(raw.name);
  if (!id || !nameCheck.ok) {
    return null;
  }
  const folder = typeof raw.folder === 'string' && FOLDER_SLUG_RE.test(raw.folder)
    ? raw.folder
    : botFolderName(nameCheck.name);
  const createdAt = finiteTime(raw.createdAt, now);
  const record = {
    id,
    name: nameCheck.name,
    hostId: 'local',
    folder,
    folderWorkspaceId: typeof raw.folderWorkspaceId === 'string' && raw.folderWorkspaceId
      ? raw.folderWorkspaceId
      : `bot-ws:${id}`,
    agent: isBotAgent(raw.agent) ? raw.agent : 'deepseek-harness',
    avatar: typeof raw.avatar === 'string' ? raw.avatar : null,
    paused: raw.paused === true,
    notifications: normalizeNotifications(raw.notifications),
    members: normalizeMembersField(raw.members),
    chatSessionId: typeof raw.chatSessionId === 'string' && raw.chatSessionId ? raw.chatSessionId : null,
    ...normalizeConnectorFields(raw),
    ...normalizeDisplayOptionals(raw),
    ...normalizeRuntimeOptionals(raw),
    createdAt,
    updatedAt: finiteTime(raw.updatedAt, createdAt),
  };
  return withSlackMembersTagged(record);
}

/** Drops malformed or duplicate-ID records rather than failing the whole profile load. */
export function normalizePersistedBots(value, now = Date.now()) {
  if (!Array.isArray(value)) {
    return [];
  }
  const bots = [];
  const seen = new Set();
  for (const candidate of value) {
    const normalized = normalizeBotRecord(candidate, now);
    if (normalized && !seen.has(normalized.id)) {
      seen.add(normalized.id);
      bots.push(normalized);
    }
  }
  return bots;
}

export function createDefaultGlobalSettings() {
  return {
    botsEnabled: true,
    hideBotCreatedWorkspaces: true,
    skipNewHomeChatConfirm: false,
    botSidebarView: {
      sortBy: 'manual',
      hidePausedBots: false,
      hideSleepingWorkers: false,
    },
    sidebarBotsHeight: null,
    sidebarProjectsFirst: false,
    petBotId: null,
  };
}

export function botNotificationFor(news) {
  if (news?.agentState === 'blocked') {
    return 'needsPermission';
  }
  return news?.outcome === 'success' ? 'taskComplete' : 'couldNotFinish';
}

export function isBotAttentionSilenced(bots, workspaceId, news) {
  const bot = (Array.isArray(bots) ? bots : []).find(
    (candidate) => candidate.folderWorkspaceId === workspaceId || `folder:${candidate.folderWorkspaceId}` === workspaceId,
  );
  return bot !== undefined && !bot.notifications[botNotificationFor(news)];
}
