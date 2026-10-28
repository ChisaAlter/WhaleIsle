const HISTORY_PAGE_MESSAGES = 50;
/** Live-follow ticks only need the newest messages; a gap falls back to a full page. */
const POLL_PAGE_MESSAGES = 6;

function historyQuery(sessionId, extra = {}) {
  return { sessionId, maxMessages: HISTORY_PAGE_MESSAGES, ...extra };
}

function historyEvents(payload) {
  return Array.isArray(payload?.events) ? payload.events : [];
}

function entrySeq(entry) {
  const seq = entry?.event?.seq ?? entry?.seq;
  return Number.isInteger(seq) ? seq : null;
}

function oldestSeq(events) {
  let min = null;
  for (const entry of events) {
    const seq = entrySeq(entry);
    if (seq === null) continue;
    if (min === null || seq < min) min = seq;
  }
  return min;
}

function hostHistoryPage(payload) {
  const events = historyEvents(payload);
  const seq = oldestSeq(events);
  return {
    events,
    hasOlder: payload?.hasMore === true && seq !== null,
    beforeSeq: seq,
    projections: payload?.projections,
  };
}

/**
 * Newest turn/start or turn/end wins. null = the page has neither, so callers
 * must not clobber session.list running.
 */
function runningFromHistoryEvents(events) {
  const list = Array.isArray(events) ? events : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const type = list[i]?.event?.type || list[i]?.type;
    if (type === 'turn/end') return false;
    if (type === 'turn/start') return true;
  }
  return null;
}

function mergeOlderHistory(olderEvents, current) {
  const existing = new Set();
  for (const entry of current || []) {
    const seq = entrySeq(entry);
    if (seq !== null) existing.add(seq);
  }
  const fresh = (olderEvents || []).filter((entry) => {
    const seq = entrySeq(entry);
    return seq === null || !existing.has(seq);
  });
  return [...fresh, ...(current || [])];
}

function newestSeq(events) {
  let max = null;
  for (const entry of events || []) {
    const seq = entrySeq(entry);
    if (seq !== null && (max === null || seq > max)) max = seq;
  }
  return max;
}

/**
 * Merge a newest-page refresh into the loaded log. Older pages the user has
 * already loaded stay; from the page's oldest seq onward the page is the
 * truth. `contiguous` is false when a partial page does not reach back to the
 * loaded log, so a small poll window may have skipped events in between.
 * @returns {{ events: object[], contiguous: boolean, keptOlder: boolean }}
 */
function mergeLatestHistory(current, page) {
  const list = Array.isArray(current) ? current : [];
  const events = Array.isArray(page?.events) ? page.events : [];
  const oldest = oldestSeq(events);
  if (!page?.hasOlder || oldest === null || !list.length) {
    return { events, contiguous: true, keptOlder: false };
  }
  const loadedNewest = newestSeq(list);
  const contiguous = loadedNewest !== null && loadedNewest >= oldest;
  const kept = list.filter((entry) => {
    const seq = entrySeq(entry);
    return seq !== null && seq < oldest;
  });
  return { events: [...kept, ...events], contiguous, keptOlder: kept.length > 0 };
}

function historyEventType(entry) {
  if (!entry || typeof entry !== 'object') return '';
  if (entry.event && typeof entry.event.type === 'string') return entry.event.type;
  if (typeof entry.type === 'string') return entry.type;
  return '';
}

function historyEventData(entry) {
  if (entry?.event && typeof entry.event.data === 'object' && entry.event.data) return entry.event.data;
  if (entry && typeof entry.data === 'object' && entry.data) return entry.data;
  return {};
}

/** Unanswered `approval/asked` rows in a history page (mux may still supply rpcId). */
function pendingFromHistoryEvents(events, sessionId = '') {
  const open = new Map();
  for (const entry of events || []) {
    const type = historyEventType(entry);
    const data = historyEventData(entry);
    const id = typeof data.id === 'string' ? data.id : '';
    if (!id) continue;
    if (type === 'approval/asked') {
      open.set(id, {
        rpcId: '',
        sessionId,
        approvalId: id,
        title: typeof data.toolName === 'string' && data.toolName ? data.toolName : '需要审批',
        command: typeof data.reason === 'string' ? data.reason : '',
        actions: [
          { id: 'rejected', label: '拒绝', variant: 'ghost', outcome: 'rejected' },
          { id: 'allowed-once', label: '允许一次', variant: 'primary', outcome: 'allowed-once' },
        ],
        host: true,
      });
    } else if (type === 'approval/decided') {
      open.delete(id);
    }
  }
  return [...open.values()];
}

function mergeApprovalPending(existing, fromHistory) {
  const live = (existing || []).filter((item) => item && item.rpcId);
  const asked = Array.isArray(fromHistory) ? fromHistory : [];
  if (!asked.length) return live;
  const byId = new Map(live.map((item) => [item.approvalId, item]));
  return asked.map((item) => byId.get(item.approvalId) || item);
}

export {
  entrySeq,
  historyEvents,
  historyQuery,
  HISTORY_PAGE_MESSAGES,
  hostHistoryPage,
  mergeApprovalPending,
  mergeLatestHistory,
  mergeOlderHistory,
  POLL_PAGE_MESSAGES,
  pendingFromHistoryEvents,
  runningFromHistoryEvents,
};
