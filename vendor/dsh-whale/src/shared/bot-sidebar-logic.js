// Sidebar collapsed preview strip, 11-tier activity line resolution,
// sorting/filtering, chat tree ordering, and divider height math.

import { isBotGroupMemberSession } from './bot-groups.js';
import {
  isSidebarEntryPausedBot,
  sidebarEntryNameOf,
} from './bot-sidebar-search.js';

export {
  foldBotSearchText,
  parseBotSearchQuery,
  matchBotSearchText,
  mergeBotSearchRanges,
  splitBotSearchText,
  botPurposeSnippet,
  createBotSidebarSearchIndex,
  searchBots,
} from './bot-sidebar-search.js';

// ---- 1. Collapsed 5-avatar preview strip ----

export function botStatusNeedsAttention(status) {
  return status === 'permission' || status === 'failed' || status === 'unconfirmed';
}

export function rollUpBotStatus(own, workspaces = []) {
  const all = [own, ...workspaces];
  if (all.includes('permission')) {
    return 'permission';
  }
  return all.find((status) => status === 'working' || status === 'monitoring') ?? own;
}

export function countLiveBotWorkspaces(statuses = []) {
  const counts = { permission: 0, working: 0, failed: 0 };
  for (const status of statuses) {
    if (status === 'permission') {
      counts.permission += 1;
    } else if (status === 'working' || status === 'monitoring') {
      counts.working += 1;
    } else if (status === 'failed') {
      counts.failed += 1;
    }
  }
  return counts;
}

export function botFoldLiveStatus(counts) {
  return ['permission', 'working', 'failed'].find((status) => (counts?.[status] ?? 0) > 0) ?? null;
}

export function botPreviewSignal(bot) {
  if (bot?.attention || botStatusNeedsAttention(bot?.status)) {
    return 'attention';
  }
  if (bot?.unread) {
    return 'unread';
  }
  return bot?.status === 'working' || bot?.status === 'monitoring' ? 'working' : null;
}

export function botPreviewFacts(input) {
  return {
    status: rollUpBotStatus(input.own, input.workspaces),
    attention: [input.own, ...(input.workspaces ?? [])].some(botStatusNeedsAttention),
    unread: Boolean(input.homeUnread),
    paused: Boolean(input.paused),
  };
}

export function botPreviewCapacity(width, count) {
  const circles = Math.max(0, Math.floor((width + 4) / 24));
  return Math.max(0, Math.min(5, count > circles ? circles - 1 : circles));
}

const PREVIEW_PRIORITY = { attention: 0, unread: 1, working: 2 };

/** Ranks bots (`attention > unread > working > saved order`), keeping `current` visible. */
export function selectCollapsedPreviewBots(bots, limit = 5, current = null) {
  const list = Array.isArray(bots) ? bots : [];
  const ranked = list
    .map((bot, index) => {
      const signal = botPreviewSignal(bot);
      return { bot, index, priority: signal === null ? 3 : PREVIEW_PRIORITY[signal] };
    })
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map(({ bot }) => bot);

  const cap = Math.max(0, Math.min(5, Math.floor(limit)));
  const shown = ranked.slice(0, cap);
  const hidden = ranked.slice(shown.length);
  const hiddenIndex = current ? hidden.indexOf(current) : -1;
  if (current && shown.length > 0 && hiddenIndex >= 0) {
    hidden.splice(hiddenIndex, 1);
    hidden.unshift(shown.at(-1));
    shown[shown.length - 1] = current;
  }
  return {
    shown,
    hidden,
    hiddenSignal: hidden.length > 0 ? botPreviewSignal(hidden[0]) : null,
    total: list.length,
    attention: list.filter((bot) => botPreviewSignal(bot) === 'attention').length,
    unread: list.filter((bot) => Boolean(bot.unread)).length,
    working: list.filter((bot) => bot.status === 'working' || bot.status === 'monitoring').length,
  };
}

export const collapsedBotPreview = selectCollapsedPreviewBots;

// ---- 2. 11-tier priority bot row activity line ----

const LINEAR_KEY = /^[A-Z][A-Z0-9]*-\d+\b/;
const CONNECTOR_LABELS = {
  slack: 'Slack',
  linear: 'Linear',
  github: 'GitHub',
  discord: 'Discord',
  feishu: 'Feishu',
  telegram: 'Telegram',
  wecom: 'WeCom',
  dingtalk: 'DingTalk',
};

function threadPlace(link) {
  const key = link.source === 'linear' ? LINEAR_KEY.exec(link.title ?? '')?.[0] : undefined;
  return {
    source: link.source,
    label: link.place ?? key ?? CONNECTOR_LABELS[link.source] ?? link.source,
  };
}

function newestActivity(rows, updatedAt) {
  return rows.reduce((best, row) => (!best || updatedAt(row) > updatedAt(best) ? row : best), null);
}

const DEFAULT_ROW_READER = {
  subagent: (row) => row.subagent === true,
  paneKey: (row) => row.paneKey ?? row.sessionId ?? '',
  needsYou: (row) => row.needsYou === true || row.state === 'blocked' || row.state === 'waiting' || row.state === 'permission',
  live: (row) => row.live === true || row.state === 'working' || row.state === 'monitoring',
  updatedAt: (row) => row.updatedAt ?? row.at ?? 0,
  status: (row) => row.statusText ?? row.text ?? null,
  at: (row) => row.at ?? row.updatedAt ?? null,
};

function partitionCandidateRows(input, read) {
  const chatPaneKey = input.chatPaneKey ?? (input.chatSessionId ? `session:${input.chatSessionId}` : null);
  const linkByPaneKey = new Map((input.links ?? []).map((link) => [link.paneKey, link]));
  const sideChatByPaneKey = new Map((input.chats ?? []).map((chat) => [chat.paneKey, chat]));
  const candidates = [];
  const others = [];
  for (const row of input.rows ?? []) {
    if (read.subagent(row)) {
      continue;
    }
    const paneKey = read.paneKey(row);
    const link = linkByPaneKey.get(paneKey);
    const sideChat = sideChatByPaneKey.get(paneKey);
    if (paneKey === chatPaneKey || (input.chatSessionId && paneKey === input.chatSessionId)) {
      candidates.unshift({ row, place: null });
    } else if (link) {
      candidates.push({ row, place: link.lastTurn === 'conversation' ? threadPlace(link) : null });
    } else if (sideChat) {
      candidates.push({ row, place: { source: null, label: sideChat.title } });
    } else {
      others.push(row);
    }
  }
  return { candidates, others };
}

function formatCandidateLine(pick, read, now) {
  const text = read.status(pick.row, now);
  return text
    ? { kind: 'activity', place: pick.place, text, at: read.at(pick.row) }
    : { kind: 'replying', place: pick.place };
}

function isStartingSession(input) {
  const starting = input.startingSessionIds;
  if (!starting || starting.size === 0) {
    return false;
  }
  if (input.chatSessionId && starting.has(input.chatSessionId)) {
    return true;
  }
  return (input.links ?? []).some((link) => starting.has(link.sessionId));
}

function resolveBusyRowLine(input, read, candidates, others, now) {
  const newestOf = (pred) => newestActivity(candidates.filter(({ row }) => pred(row)), ({ row }) => read.updatedAt(row));
  const asking = newestOf(read.needsYou);
  if (asking) {
    return formatCandidateLine(asking, read, now);
  }
  const needYouElsewhere = input.needsYou
    ?? others.filter(read.needsYou).length + (input.workers?.permission ?? 0) + (input.itemsNeedingYou ?? 0);
  if (needYouElsewhere > 0) {
    return { kind: 'needYouElsewhere', count: needYouElsewhere };
  }
  if (isStartingSession(input)) {
    return { kind: 'reading' };
  }
  const working = newestOf(read.live);
  if (working) {
    return formatCandidateLine(working, read, now);
  }
  const workingElsewhere = others.filter((row) => read.live(row) && !read.needsYou(row)).length
    + (input.workers?.working ?? 0);
  return workingElsewhere > 0 ? { kind: 'workingElsewhere', count: workingElsewhere } : null;
}

function resolveIdleRowLine(input, read, candidates, now) {
  if (input.usageLimit) {
    return { kind: 'usageLimit', place: input.usageLimit.place ?? null, text: input.usageLimit.text ?? null };
  }
  const said = newestActivity(
    candidates.filter(({ row }) => read.status(row, now) !== null),
    ({ row }) => read.updatedAt(row),
  );
  if (said) {
    return formatCandidateLine(said, read, now);
  }
  const [wait, ...moreWaits] = (input.waits ?? []).filter((w) => w.by === undefined || w.by > now);
  if (wait) {
    return { kind: 'wait', wait, more: moreWaits.length };
  }
  return input.description ? { kind: 'description', text: input.description } : null;
}

/**
 * 11-tier priority resolver for a bot row's second line:
 * 1. disconnected -> 2. paused -> 3. needsYou (own chats/threads, Home wins ties) ->
 * 4. needYouElsewhere -> 5. reading (starting session) -> 6. working (own chats/threads) ->
 * 7. workingElsewhere -> 8. usageLimit -> 9. newest completed activity (Home wins ties) ->
 * 10. passive wait -> 11. SOUL.md description fallback.
 */
export function resolveBotRowActivityLine(input, read = DEFAULT_ROW_READER) {
  if (input.disconnected) {
    return { kind: 'disconnected', host: input.hostName ?? null };
  }
  if (input.paused) {
    return { kind: 'paused' };
  }
  const now = input.now ?? Date.now();
  const { candidates, others } = partitionCandidateRows(input, read);
  return resolveBusyRowLine(input, read, candidates, others, now)
    ?? resolveIdleRowLine(input, read, candidates, now);
}

export const selectBotRowLine = resolveBotRowActivityLine;

const DAY_MS = 24 * 60 * 60 * 1000;

export function botWaitTimeFormat(at, now = Date.now()) {
  const time = new Date(at).getMinutes() === 0 ? { hour: 'numeric' } : { hour: 'numeric', minute: '2-digit' };
  if (new Date(at).toDateString() === new Date(now).toDateString()) {
    return time;
  }
  return Math.abs(at - now) < 6 * DAY_MS
    ? { weekday: 'short', ...time }
    : { month: 'short', day: 'numeric', ...time };
}

export function botRowReplyingAt(t, place, label = place.label) {
  return place.source === null || place.source === 'slack' || place.source === 'discord'
    ? t('bots.row.replyingIn', 'Replying in {{place}}', { place: label })
    : t('bots.row.replyingOn', 'Replying on {{place}}', { place: label });
}

function formatWaitLine(line, t, waitTime) {
  if (line.more > 0) {
    return t('bots.row.waitingCount', 'Waiting on {{count}} events', { count: line.more + 1 });
  }
  const { label, by } = line.wait;
  return by === undefined
    ? t('bots.row.waitingFor', 'Waiting for {{label}}', { label })
    : t('bots.row.waitingForUntil', 'Waiting for {{label}} · until {{time}}', { label, time: waitTime(by) });
}

export function botRowLineText(line, t, waitTime = (ts) => String(ts)) {
  if (!line) {
    return '';
  }
  switch (line.kind) {
    case 'disconnected':
      return line.host
        ? t('bots.row.hostDisconnected', '{{host}} disconnected', { host: line.host })
        : t('bots.row.disconnected', 'Disconnected');
    case 'paused':
      return t('bots.row.paused', 'Paused');
    case 'reading':
      return t('bots.row.reading', 'Reading your message');
    case 'replying':
      return line.place ? botRowReplyingAt(t, line.place) : t('bots.row.replying', 'Replying');
    case 'activity':
      return line.place ? `${line.place.label} · ${line.text}` : line.text;
    case 'needYouElsewhere':
      return t('bots.panel.needYou', '{{count}} need you', { count: line.count });
    case 'workingElsewhere':
      return t('bots.panel.working', '{{count}} working', { count: line.count });
    case 'usageLimit':
      return line.place
        ? `${line.place} · ${line.text ?? t('bots.usageLimit.hit', 'Usage limit reached')}`
        : (line.text ?? t('bots.usageLimit.hit', 'Usage limit reached'));
    case 'wait':
      return formatWaitLine(line, t, waitTime);
    case 'description':
      return line.text ?? '';
    default:
      return '';
  }
}

// ---- 3. Sort & Filter options ----

export const BOT_SIDEBAR_SORT_CHOICES = Object.freeze([
  { id: 'manual', label: 'Manual', description: 'Drag bots to arrange them. New bots go on top.' },
  { id: 'smart', label: 'Agent Activity', description: 'Bots that need you, then most recent activity.' },
  { id: 'recent', label: 'Recent' },
  { id: 'name', label: 'Name' },
]);

export const DEFAULT_BOT_SIDEBAR_VIEW = Object.freeze({
  sortBy: 'manual',
  hidePausedBots: false,
  hideSleepingWorkers: false,
});

export function normalizeBotSidebarView(value) {
  const saved = typeof value === 'object' && value !== null ? value : {};
  const sortBy = BOT_SIDEBAR_SORT_CHOICES.find((choice) => choice.id === saved.sortBy)?.id;
  return {
    sortBy: sortBy ?? DEFAULT_BOT_SIDEBAR_VIEW.sortBy,
    hidePausedBots: saved.hidePausedBots === true,
    hideSleepingWorkers: saved.hideSleepingWorkers === true,
  };
}

export function countActiveBotSidebarFilters(view) {
  return Number(Boolean(view?.hidePausedBots)) + Number(Boolean(view?.hideSleepingWorkers));
}

export function botSidebarEntryRecency(entry, activityAt = 0) {
  const createdAt = entry.kind === 'group' ? entry.group?.createdAt : (entry.bot?.createdAt ?? entry.createdAt);
  return typeof createdAt === 'number' && createdAt > activityAt ? createdAt : activityAt;
}

export function sortBotsBySidebarOrder(bots) {
  const placedOrder = (bot) => (typeof bot.sidebarOrder === 'number' ? bot.sidebarOrder : Number.NEGATIVE_INFINITY);
  const createdAt = (bot) => (typeof bot.createdAt === 'number' ? bot.createdAt : Number.NEGATIVE_INFINITY);
  const byKey = (a, b) => (a === b ? 0 : a < b ? -1 : 1);
  return [...bots]
    .map((bot, index) => ({ bot, index }))
    .sort((left, right) => (
      byKey(placedOrder(left.bot), placedOrder(right.bot))
      || byKey(createdAt(right.bot), createdAt(left.bot))
      || left.index - right.index
    ))
    .map(({ bot }) => bot);
}

export function sortAndFilterBots(entries, view = DEFAULT_BOT_SIDEBAR_VIEW, activityOf = () => ({ needsYou: false, activityAt: 0 })) {
  const normalized = normalizeBotSidebarView(view);
  const shown = normalized.hidePausedBots
    ? entries.filter((entry) => !isSidebarEntryPausedBot(entry))
    : [...entries];
  if (normalized.sortBy === 'manual') {
    return shown;
  }
  if (normalized.sortBy === 'name') {
    const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
    return shown
      .map((entry, index) => ({ entry, index }))
      .sort((left, right) => collator.compare(sidebarEntryNameOf(left.entry), sidebarEntryNameOf(right.entry)) || left.index - right.index)
      .map(({ entry }) => entry);
  }
  const ranked = shown.map((entry, index) => {
    const { needsYou = false, activityAt = 0 } = activityOf(entry) ?? {};
    return { entry, index, needsYou, activityAt: botSidebarEntryRecency(entry, activityAt) };
  });
  return ranked
    .sort((left, right) => (
      (normalized.sortBy === 'smart' ? Number(right.needsYou) - Number(left.needsYou) : 0)
      || right.activityAt - left.activityAt
      || left.index - right.index
    ))
    .map(({ entry }) => entry);
}

export const arrangeBotSidebarEntries = sortAndFilterBots;

// ---- 4. Chat tree ordering, fold caps & divider height ----

export const CHAT_TREE_CAPS = Object.freeze({
  runningShown: 5,
  finishedShown: 2,
  step: 8,
});

export const BOT_CHAT_FOLDS_MAX = 500;
export const SIDEBAR_BOTS_MIN_HEIGHT = 88;
export const SIDEBAR_PROJECTS_MIN_LIST_HEIGHT = 120;
const SIDEBAR_BOTS_MAX_STORED_HEIGHT = 4000;

function waitsOnOwner(chat) {
  return chat.live === 'needs-you' || (chat.running ?? []).some((worker) => worker.state === 'needs-you');
}

function chatOrderRank(chat) {
  if (chat.origin === 'home' && !chat.closed) {
    return 0;
  }
  if (chat.closed) {
    return 4;
  }
  if (waitsOnOwner(chat)) {
    return 1;
  }
  if (chat.live === 'replying') {
    return 2;
  }
  return 3;
}

export function orderBotChats(chats) {
  return [...(chats ?? [])].sort(
    (a, b) => chatOrderRank(a) - chatOrderRank(b) || (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0),
  );
}

export function chatIsGoing(chat) {
  return chat.live !== 'idle' || (chat.runningTotal ?? 0) > 0;
}

export function chatWaitingCount(chat) {
  return (chat.running ?? []).filter((worker) => worker.state === 'needs-you').length;
}

export function chatRunningCount(chat) {
  const notRunning = (chat.running ?? []).filter(
    (worker) => worker.state === 'needs-you' || worker.state === 'unreachable',
  ).length;
  return Math.max(0, (chat.runningTotal ?? 0) - notRunning);
}

export function chatFoldCounts(chat) {
  const waiting = chatWaitingCount(chat);
  const running = chatRunningCount(chat);
  return waiting > 0 || running > 0 ? { waiting, running } : null;
}

export function chatFoldSummary(t, counts) {
  if (!counts) {
    return '';
  }
  return [
    counts.waiting > 0 ? t('bots.chats.waitingCount', '{{count}} waiting', { count: counts.waiting }) : null,
    counts.running > 0 ? t('bots.chats.runningCount', '{{count}} running', { count: counts.running }) : null,
  ].filter(Boolean).join(' · ');
}

export function botChatFoldKey(hostId, botId, chatId) {
  return `${hostId}\u0000${botId}\u0000${chatId}`;
}

export function withBotChatFold(folds, key, fold) {
  const next = Object.entries(folds ?? {}).filter(([existing]) => existing !== key);
  if (fold === 'open' || fold === 'folded') {
    next.push([key, fold]);
  }
  return Object.fromEntries(next.slice(-BOT_CHAT_FOLDS_MAX));
}

export function normalizeBotChatFolds(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const entries = Object.entries(value).filter(([, state]) => state === 'open' || state === 'folded');
  return Object.fromEntries(entries.slice(-BOT_CHAT_FOLDS_MAX));
}

/** @param {any} chat */
const chatKeyOf = (chat) => chat?.chatId ?? chat?.sessionId ?? chat?.id;

export function botOwnChatTree(tree) {
  const rooms = (tree.chats ?? []).filter((chat) => isBotGroupMemberSession(chatKeyOf(chat)));
  const home = (tree.chats ?? []).find((chat) => chat.origin === 'home' && !chat.closed);
  if (rooms.length === 0 || !home) {
    return tree;
  }
  const roomIds = new Set(rooms.map((chat) => chatKeyOf(chat)));
  const homeKey = chatKeyOf(home);
  const movedFinished = rooms.flatMap((chat) => chat.finished ?? []);
  const merged = {
    ...home,
    running: [...(home.running ?? []), ...rooms.flatMap((chat) => chat.running ?? [])]
      .sort((a, b) => Number(b.state === 'needs-you') - Number(a.state === 'needs-you')),
    runningTotal: rooms.reduce((sum, chat) => sum + (chat.runningTotal ?? 0), home.runningTotal ?? 0),
    finished: [...(home.finished ?? []), ...movedFinished]
      .sort((a, b) => (b.settledAt ?? b.startedAt ?? 0) - (a.settledAt ?? a.startedAt ?? 0)),
    finishedTotal: (home.finishedTotal ?? 0) + movedFinished.length,
    failedTotal: (home.failedTotal ?? 0) + movedFinished.filter((w) => w.state === 'failed').length,
  };
  const workspaceChats = Object.fromEntries(
    Object.entries(tree.workspaceChats ?? {}).map(([workspace, chatId]) => [
      workspace,
      roomIds.has(chatId) ? homeKey : chatId,
    ]),
  );
  return {
    ...tree,
    chats: tree.chats.flatMap((chat) => (roomIds.has(chatKeyOf(chat)) ? [] : chat === home ? [merged] : [chat])),
    workspaceChats,
  };
}

/** Return true when a bot owns side/automation/connector chats or visible worker rows. */
export function botHasSubChats(chatTree, hideSleepingWorkers = true) {
  if (!chatTree || !Array.isArray(chatTree.chats)) {
    return false;
  }
  const owned = botOwnChatTree(chatTree);
  const chats = (owned?.chats ?? []).filter((chat) => !chat.closed);
  if (chats.some((chat) => chat.origin !== 'home')) {
    return true;
  }
  return chats.some((chat) => {
    const running = (chat.running ?? []).filter((w) => !hideSleepingWorkers || w.state !== 'sleeping');
    const finished = (chat.finished ?? []).filter((w) => !hideSleepingWorkers || w.state !== 'sleeping');
    return running.length > 0 || finished.length > 0;
  });
}

export function normalizeSidebarBotsHeight(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.min(SIDEBAR_BOTS_MAX_STORED_HEIGHT, Math.max(SIDEBAR_BOTS_MIN_HEIGHT, Math.round(value)));
}

export function computeSidebarBotsMaxHeight(botsHeight, projectsListHeight) {
  if (!Number.isFinite(botsHeight) || !Number.isFinite(projectsListHeight)) {
    return SIDEBAR_BOTS_MAX_STORED_HEIGHT;
  }
  return Math.max(SIDEBAR_BOTS_MIN_HEIGHT, botsHeight + projectsListHeight - SIDEBAR_PROJECTS_MIN_LIST_HEIGHT);
}

/**
 * Check whether any worker in a chat row's running or finished lists owns `sessionId`.
 * @param {{ running?: Array<{ sessionId?: unknown }>, finished?: Array<{ sessionId?: unknown }> }} chat
 * @param {string} sessionId
 * @returns {boolean}
 */
function chatWorkersOwnSession(chat, sessionId) {
  const lists = [chat?.running, chat?.finished];
  for (const list of lists) {
    if (!Array.isArray(list)) {
      continue;
    }
    if (list.some((worker) => worker?.sessionId === sessionId)) {
      return true;
    }
  }
  return false;
}

/**
 * Find the bot that owns a conversation session (home, side, automation, or worker).
 * @param {Array<{ id: string, chatSessionId?: string | null, homeSessionId?: string | null }>} bots
 * @param {Record<string, { chats?: Array<{ sessionId?: string | null, chatId?: string | null, running?: Array<{ sessionId?: string | null }>, finished?: Array<{ sessionId?: string | null }> }> } | undefined> | null | undefined} chatsByBot
 * @param {string | null | undefined} sessionId
 * @returns {{ id: string, chatSessionId?: string | null, homeSessionId?: string | null } | null}
 */
export function findBotBySessionId(bots, chatsByBot, sessionId) {
  const sid = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!sid || !Array.isArray(bots)) {
    return null;
  }
  for (const bot of bots) {
    if (!bot || typeof bot.id !== 'string') {
      continue;
    }
    if (bot.chatSessionId === sid || bot.homeSessionId === sid) {
      return bot;
    }
    const tree = chatsByBot?.[bot.id];
    const chats = Array.isArray(tree?.chats) ? tree.chats : [];
    for (const chat of chats) {
      if (chat?.sessionId === sid || chat?.chatId === sid || chatWorkersOwnSession(chat, sid)) {
        return bot;
      }
    }
  }
  return null;
}

/**
 * Derive authoritative sidebar selection (`botId`, `groupId`, `sessionId`) from layout panel + main session.
 * Switching to a non-bot session, blank session, or non-bot global panel explicitly clears `botId`/`groupId`.
 * @param {{
 *   activePanelId?: string | null,
 *   mainSessionId?: string | null,
 *   bots?: Array<{ id: string, chatSessionId?: string | null, homeSessionId?: string | null }>,
 *   chatsByBot?: Record<string, { chats?: Array<{ sessionId?: string | null, chatId?: string | null, running?: Array<{ sessionId?: string | null }>, finished?: Array<{ sessionId?: string | null }> }> } | undefined>,
 *   prevActiveGroupId?: string | null,
 *   prevActiveBotId?: string | null,
 *   settingsRouteBotId?: string | null,
 * }} input
 * @returns {{ botId: string | null, groupId: string | null, sessionId: string | null, closePageSettings: boolean }}
 */
export function resolveActiveBotSelection(input) {
  const panelId = typeof input?.activePanelId === 'string' && input.activePanelId.trim().length > 0
    ? input.activePanelId.trim()
    : null;
  const mainSessionId = typeof input?.mainSessionId === 'string' && input.mainSessionId.trim().length > 0
    ? input.mainSessionId.trim()
    : null;

  if (panelId === 'dsh-bots:group') {
    return {
      botId: null,
      groupId: input?.prevActiveGroupId ?? null,
      sessionId: null,
      closePageSettings: false,
    };
  }
  if (panelId === 'dsh-bots:settings') {
    return {
      botId: input?.settingsRouteBotId ?? input?.prevActiveBotId ?? null,
      groupId: null,
      sessionId: mainSessionId,
      closePageSettings: false,
    };
  }
  if (panelId !== null) {
    return {
      botId: null,
      groupId: null,
      sessionId: null,
      closePageSettings: true,
    };
  }

  if (!mainSessionId) {
    return {
      botId: null,
      groupId: null,
      sessionId: null,
      closePageSettings: false,
    };
  }
  const matched = findBotBySessionId(input?.bots ?? [], input?.chatsByBot, mainSessionId);
  return {
    botId: matched ? matched.id : null,
    groupId: null,
    sessionId: mainSessionId,
    closePageSettings: false,
  };
}
