/**
 * Helpers for session-tools.js: history formatting, tail-bounded rendering,
 * cross-session search across whale-owned sessions, and queue/idle inspection.
 */
import {
  eventText,
  rowSummary,
  sessionIdFromRow,
  sessionRowsFrom,
  sessionSnapshot,
  trimTo,
} from './shared.js';

const READ_LINE_MAX = 400;
const READ_TOOL_MAX = 600;
export const READ_TOTAL_MAX = 8000;
const WHALE_SEARCH_OWNERS = new Set(['dsh-whale:assistant', 'dsh-whale:todo']);

/** @param {any} source */
function messageSourceLabel(source) {
  const kind = source?.kind;
  if (!kind || kind === 'user') return '用户';
  if (kind === 'plugin') return `${source.plugin || 'plugin'} 代投`;
  return String(kind);
}

/** @param {any} data */
function toolArgumentsSummary(data) {
  const raw = data?.arguments ?? data?.input;
  if (raw === undefined || raw === null || raw === '') return '';
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  return trimTo(text.replace(/\s+/g, ' ').trim(), 240);
}

/**
 * @param {string} tag
 * @param {any} ev
 * @param {boolean} includeToolDetails
 */
function formatToolCall(tag, ev, includeToolDetails) {
  const name = String(ev?.data?.name ?? '?');
  const callId = String(ev?.data?.callId ?? '');
  const idPart = callId ? `(${callId})` : '';
  if (!includeToolDetails) return `${tag} 工具调用 ${name}${idPart}`;
  const args = toolArgumentsSummary(ev?.data);
  return args ? `${tag} 工具调用 ${name}${idPart}: ${args}` : `${tag} 工具调用 ${name}${idPart}`;
}

/**
 * @param {string} tag
 * @param {any} ev
 * @param {boolean} includeToolDetails
 */
function formatToolResult(tag, ev, includeToolDetails) {
  const msg = ev?.data?.message ?? {};
  const err = ev?.data?.error;
  const callId = String(msg.toolCallId ?? msg.source?.callId ?? msg.callId ?? '');
  const isError = msg.isError === true || Boolean(err);
  const status = isError ? 'error' : 'ok';
  const base = `${tag} 工具结果 ${callId}（${status}）`;
  if (!includeToolDetails && !isError) return base;
  const errorText = err
    ? [err.code, err.reason].filter((part) => typeof part === 'string' && part.trim()).join(': ')
    : '';
  const body = trimTo(eventText(ev).trim(), includeToolDetails ? READ_TOOL_MAX : 240);
  const detail = [errorText, body].filter(Boolean).join(' — ');
  return detail ? `${base}: ${trimTo(detail, includeToolDetails ? READ_TOOL_MAX : 300)}` : base;
}

/** @type {Record<string, (tag: string, ev: any, includeToolDetails: boolean) => string>} */
const EVENT_FORMATTERS = {
  'user/message': (tag, ev) => {
    const text = trimTo(eventText(ev).trim(), READ_LINE_MAX);
    return `${tag} ${messageSourceLabel(ev?.data?.source)}: ${text || '(非文本消息)'}`;
  },
  'assistant/message': (tag, ev) => {
    const text = trimTo(eventText(ev).trim(), READ_LINE_MAX);
    return text ? `${tag} 助手: ${text}` : '';
  },
  'tool/call': (tag, ev, includeToolDetails) => formatToolCall(tag, ev, includeToolDetails),
  'tool/result': (tag, ev, includeToolDetails) => formatToolResult(tag, ev, includeToolDetails),
  'turn/start': (tag, ev) => `${tag} ── 回合 #${ev?.data?.turn ?? '?'} 开始`,
  'turn/end': (tag, ev) => `${tag} ── 回合 #${ev?.data?.turn ?? '?'} 结束（${String(ev?.data?.reason?.kind ?? 'unknown')}）`,
  'session/presentation': (tag, ev) => {
    const title = String(ev?.data?.title ?? ev?.data?.presentation?.title ?? '');
    return title ? `${tag} 标题: ${trimTo(title, 120)}` : '';
  },
};

/**
 * @param {any} ev
 * @param {boolean} includeToolDetails
 */
function formatOneEvent(ev, includeToolDetails) {
  const formatter = EVENT_FORMATTERS[String(ev?.type ?? '')];
  if (!formatter) return '';
  return formatter(`[#${Number(ev?.seq) || 0}]`, ev, includeToolDetails);
}

/** @param {any[]} records */
export function formatRecords(records, { includeToolDetails = false } = {}) {
  const lines = [];
  for (const rec of records ?? []) {
    const line = formatOneEvent(rec?.event ?? rec, includeToolDetails);
    if (line) lines.push(line);
  }
  return lines;
}

/** @param {string[]} lines */
export function renderTailBounded(lines) {
  const full = lines.join('\n');
  if (full.length <= READ_TOTAL_MAX) return full;
  const omitted = full.length - READ_TOTAL_MAX;
  return `…前部已截断（省略 ${omitted} 字符，仅保留最新回复；可缩小 maxMessages 或用 beforeSeq 翻看前文）\n${full.slice(-READ_TOTAL_MAX)}`;
}

/** @param {any} content */
export function contentBlocksText(content) {
  return trimTo(
    (Array.isArray(content) ? content : [])
      .map((b) => (b?.type === 'text' ? String(b.text ?? '') : ''))
      .join(' ')
      .trim(),
    160,
  );
}

/**
 * @param {string} text
 * @param {string} needle
 */
function snippetAround(text, needle) {
  const idx = text.toLowerCase().indexOf(needle);
  if (idx < 0) return '';
  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, idx + needle.length + 140);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

/**
 * @param {any} ctx
 * @param {any} controller
 * @param {(() => string) | undefined} getSelfId
 */
export async function collectWhaleOwnedSessionIds(ctx, controller, getSelfId) {
  /** @type {Set<string>} */
  const ids = new Set();
  const selfId = String(getSelfId?.() ?? '').trim();
  if (selfId) ids.add(selfId);
  try {
    const todos = ctx.get?.('whaleTodos');
    if (todos?.available && typeof todos.list === 'function') {
      for (const card of todos.list()) {
        if (card?.sessionId) ids.add(String(card.sessionId));
      }
    }
  } catch { /* whaleTodos is optional during isolated tests. */ }
  if (typeof controller?.list === 'function') {
    try {
      const rows = sessionRowsFrom(await controller.list({}, AbortSignal.timeout(8_000)));
      for (const row of rows) {
        const summary = rowSummary(row);
        if (summary.sessionId && WHALE_SEARCH_OWNERS.has(summary.owner)) ids.add(summary.sessionId);
      }
    } catch { /* Preserve already-discovered ids if list fails. */ }
  }
  return ids;
}

const MAX_WHALE_SEARCH_PAGES = 10;

/**
 * @param {any[]} items
 * @param {Set<string>} ownedIds
 * @param {Set<string>} seen
 * @param {Array<{ sessionId: string, snippet: string }>} hits
 */
function collectOwnedPageHits(items, ownedIds, seen, hits) {
  for (const hit of items) {
    const sid = String(hit?.header?.id ?? '');
    if (!sid || !ownedIds.has(sid) || seen.has(sid)) continue;
    seen.add(sid);
    hits.push({ sessionId: sid, snippet: trimTo(hit?.bestMatch?.snippet ?? '', 240) });
  }
}

/**
 * @param {any} ctx
 * @param {string} query
 * @param {Set<string>} ownedIds
 * @param {Set<string>} seen
 * @param {AbortSignal} signal
 */
async function searchWhaleOwnedViaQuery(ctx, query, ownedIds, seen, signal) {
  const querySvc = ctx.get?.('sessionQuery');
  if (typeof querySvc?.searchSessions !== 'function') return null;
  try {
    /** @type {Array<{ sessionId: string, snippet: string }>} */
    const hits = [];
    const seenCursors = new Set();
    /** @type {any} */
    let cursor;
    let complete = false;
    for (let pageNo = 0; pageNo < MAX_WHALE_SEARCH_PAGES; pageNo += 1) {
      /** @type {any} */
      const page = await querySvc.searchSessions({
        query,
        eventFilters: [
          { kind: 'type', values: ['user/message', 'assistant/message'] },
          { kind: 'surface', values: ['current'] },
        ],
        limit: 20,
        ...(cursor === undefined ? {} : { cursor }),
      }, { signal });
      collectOwnedPageHits(page?.items ?? [], ownedIds, seen, hits);
      const remaining = [...ownedIds].some((sid) => !seen.has(sid));
      const next = page?.nextCursor;
      if (!remaining || next === undefined || seenCursors.has(next)) {
        complete = !remaining || next === undefined;
        break;
      }
      seenCursors.add(next);
      cursor = next;
    }
    return { hits, complete };
  } catch {
    return null;
  }
}

/**
 * @param {any} ctx
 * @param {any} controller
 * @param {string} sid
 */
async function readEventsForSearch(ctx, controller, sid) {
  const live = ctx.get?.('agents')?.get?.(sid) ?? ctx.agents?.get?.(sid);
  if (typeof live?.session?.snapshotEvents === 'function') return live.session.snapshotEvents();
  if (typeof controller?.follow !== 'function') return null;
  const snap = await sessionSnapshot(controller, sid, 80);
  return (snap?.records ?? []).map((/** @type {any} */ rec) => rec?.event ?? rec);
}

/**
 * @param {any[]} events
 * @param {string} needle
 */
function findMatchingSnippet(events, needle) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (ev?.type !== 'user/message' && ev?.type !== 'assistant/message') continue;
    const snippet = snippetAround(eventText(ev), needle);
    if (snippet) return trimTo(snippet, 240);
  }
  return '';
}

/**
 * @param {any} ctx
 * @param {any} controller
 * @param {string} query
 * @param {Set<string>} ownedIds
 * @param {Set<string>} seen
 * @param {AbortSignal} signal
 */
export async function searchWhaleOwnedSessions(ctx, controller, query, ownedIds, seen, signal) {
  if (!ownedIds.size) return [];
  const viaQuery = await searchWhaleOwnedViaQuery(ctx, query, ownedIds, seen, signal);
  const hits = viaQuery ? [...viaQuery.hits] : [];
  if (viaQuery?.complete) return hits;
  const needle = query.toLowerCase();
  for (const sid of ownedIds) {
    if (seen.has(sid)) continue;
    const events = await readEventsForSearch(ctx, controller, sid);
    if (!Array.isArray(events)) continue;
    const snippet = findMatchingSnippet(events, needle);
    if (snippet) {
      seen.add(sid);
      hits.push({ sessionId: sid, snippet });
    }
  }
  return hits;
}

/**
 * @param {any} ctx
 * @param {any} controller
 * @param {string} wanted
 */
export async function collectQueueSessionIds(ctx, controller, wanted) {
  if (wanted) return [wanted];
  /** @type {Set<string>} */
  const ids = new Set();
  const agents = ctx.get?.('agents') ?? ctx.agents;
  if (typeof agents?.list === 'function') {
    for (const agent of agents.list()) {
      if (agent?.id) ids.add(String(agent.id));
    }
    return [...ids];
  }
  if (typeof controller?.list === 'function') {
    const rows = sessionRowsFrom(await controller.list({}, AbortSignal.timeout(10_000)));
    for (const row of rows) {
      const sid = sessionIdFromRow(row);
      if (sid) ids.add(sid);
    }
  }
  return [...ids];
}

/**
 * @param {any} ctx
 * @param {string} sessionId
 */
export function readJobsForSession(ctx, sessionId) {
  try {
    const jobsSvc = ctx.get?.('jobs');
    if (typeof jobsSvc?.list !== 'function') return [];
    return (jobsSvc.list(sessionId) ?? []).map((/** @type {any} */ job) =>
      `${job?.kind ?? job?.label ?? job?.id ?? 'job'} ${job?.status ?? ''}`.trim());
  } catch {
    return [];
  }
}

/**
 * @param {any} ctx
 * @param {any} controller
 * @param {string} sessionId
 * @param {boolean} watchAlreadyIdle
 */
export async function detectAlreadyIdle(ctx, controller, sessionId, watchAlreadyIdle) {
  if (watchAlreadyIdle) return true;
  if (typeof controller?.state !== 'function') return false;
  try {
    const st = await controller.state({ sessionId }, AbortSignal.timeout(5_000));
    if (!st) return false;
    const queued = Array.isArray(st.queue) ? st.queue.length : 0;
    const agent = ctx.get?.('agents')?.get?.(sessionId) ?? ctx.agents?.get?.(sessionId);
    const treeBusy = Boolean(agent && ctx.get?.('subagents')?.hasTreeWork?.(agent) === true);
    return !st.running && queued === 0 && !treeBusy;
  } catch {
    return false;
  }
}

/** @param {unknown} at */
export function formatEventTime(at) {
  const ms = Number(at);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : 'unknown-time';
}

/**
 * @param {string} action
 * @param {unknown} rawText
 */
export function buildQueueAction(action, rawText) {
  if (action === 'remove') return { queueAction: { kind: 'remove' } };
  if (action === 'steer') return { queueAction: { kind: 'steer' } };
  if (action === 'edit') {
    const text = String(rawText ?? '').trim();
    if (!text) return { error: 'edit needs a non-empty text.' };
    return { queueAction: { kind: 'edit', content: [{ type: 'text', text }] } };
  }
  return { error: 'action must be edit | remove | steer.' };
}
