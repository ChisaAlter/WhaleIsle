/**
 * Timeline upward pagination for the phone conversation log. The daemon
 * serves seq-cursored windows (`direction:'before'` + `{epoch,seq}` cursor);
 * this module tracks the older edge and merges pages with seq dedup so the
 * log never shows duplicate rows.
 */

/**
 * Extract the upward-paging state from a fetch_agent_timeline payload.
 * @param {{ startCursor?: { epoch: string, seq: number } | null, hasOlder?: boolean }} payload
 * @returns {{ startCursor: { epoch: string, seq: number } | null, hasOlder: boolean }}
 */
function timelinePageInfo(payload) {
  const cursor = payload?.startCursor;
  const startCursor = cursor && typeof cursor.epoch === 'string'
    && Number.isInteger(cursor.seq) && cursor.seq >= 0
    ? { epoch: cursor.epoch, seq: cursor.seq }
    : null;
  return {
    startCursor,
    hasOlder: payload?.hasOlder === true && startCursor !== null,
  };
}

/**
 * Fetch the page of timeline entries strictly older than `cursor`.
 * A daemon error string in the payload is a visible failure, never an
 * empty page.
 * @param {object} client DaemonClient
 * @param {string} agentId
 * @param {{ epoch: string, seq: number }} cursor current older edge (startCursor)
 * @param {{ limit?: number }} options
 */
async function fetchOlderTimeline(client, agentId, cursor, { limit = 200 } = {}) {
  if (!cursor || typeof cursor.epoch !== 'string' || !Number.isInteger(cursor.seq)) {
    throw new Error('没有可用的历史游标');
  }
  const payload = await client.fetchAgentTimeline(agentId, {
    direction: 'before',
    cursor,
    limit,
    projection: 'projected',
  });
  if (typeof payload?.error === 'string' && payload.error) {
    throw new Error(payload.error);
  }
  return payload;
}

function entrySeqKey(entry) {
  const start = entry?.seqStart;
  const end = entry?.seqEnd;
  if (Number.isInteger(start)) {
    return `${start}:${Number.isInteger(end) ? end : start}`;
  }
  return null;
}

/**
 * Prepend an older page onto the current entries with seq dedup: entries
 * whose seq range already exists in `current` are dropped from the older
 * page (the newer projection wins). Keyless entries (no seqStart) in the
 * older page are kept — dropping them silently would hide rows.
 * @param {Array<object>} older entries from the `before` page (oldest→newest)
 * @param {Array<object>} current entries already rendered
 * @returns {Array<object>}
 */
function mergeOlderEntries(older, current) {
  const existing = new Set();
  for (const entry of current || []) {
    const key = entrySeqKey(entry);
    if (key) existing.add(key);
  }
  const fresh = (older || []).filter((entry) => {
    const key = entrySeqKey(entry);
    return !key || !existing.has(key);
  });
  return [...fresh, ...(current || [])];
}

/**
 * Decide the scroll anchor for a log re-render. Explicit anchors pass
 * through unchanged; 'auto' sticks to the bottom only when the viewport was
 * already at (or near) the newest row before the render, so stream events
 * appended while the user is reading history hold the current position
 * instead of yanking the log back down.
 * @param {object} options
 * @param {'auto'|'bottom'|'preserve'|'hold'} [options.anchor]
 * @param {number} [options.scrollTop] pre-render scrollTop
 * @param {number} [options.scrollHeight] pre-render scrollHeight
 * @param {number} [options.clientHeight] viewport height
 * @param {number} [options.threshold] px slack still counted as "at bottom"
 * @returns {'bottom'|'preserve'|'hold'}
 */
function resolveLogAnchor({
  anchor = 'auto', scrollTop = 0, scrollHeight = 0, clientHeight = 0, threshold = 48,
} = {}) {
  if (anchor === 'bottom' || anchor === 'preserve' || anchor === 'hold') {
    return anchor;
  }
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
  return distanceFromBottom <= threshold ? 'bottom' : 'hold';
}

export {
  fetchOlderTimeline,
  mergeOlderEntries,
  resolveLogAnchor,
  timelinePageInfo,
};
