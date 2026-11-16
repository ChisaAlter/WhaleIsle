/**
 * ChisaCode agent directory adapters: cursor pagination, subagent grouping,
 * archived history, and session lifecycle actions (archive / delete / rename /
 * regenerate title / unarchive). Pure logic over an injected DaemonClient so
 * app.js stays a thin UI binder. All daemon errors propagate to the caller —
 * no optimistic destruction on failure.
 */

import { agentRows } from './session.js';

/**
 * Extract cursor paging state from a fetch_agents / fetch_agent_history
 * response payload. Missing pageInfo (older daemons) degrades to "no more".
 * @param {{ pageInfo?: { nextCursor?: string | null, hasMore?: boolean } }} payload
 * @returns {{ nextCursor: string | null, hasMore: boolean }}
 */
function agentPageInfo(payload) {
  const info = payload?.pageInfo;
  const nextCursor = typeof info?.nextCursor === 'string' && info.nextCursor ? info.nextCursor : null;
  return {
    nextCursor,
    hasMore: info?.hasMore === true && nextCursor !== null,
  };
}

/**
 * Merge a newly fetched page into the existing rows: rows already present are
 * updated in place (daemon copy wins), new rows are appended in page order.
 * @param {Array<{ sessionId: string }>} existing
 * @param {Array<{ sessionId: string }>} incoming
 */
function mergeAgentRows(existing, incoming) {
  const merged = existing.slice();
  const indexById = new Map(merged.map((row, index) => [row.sessionId, index]));
  for (const row of incoming || []) {
    if (!row?.sessionId) continue;
    const index = indexById.get(row.sessionId);
    if (index === undefined) {
      indexById.set(row.sessionId, merged.length);
      merged.push(row);
    } else {
      merged[index] = row;
    }
  }
  return merged;
}

function relationOf(row) {
  const relation = row?.chisacodeAgent?.relation;
  return relation && typeof relation === 'object' ? relation : null;
}

function parentSessionIdOf(row) {
  const relation = relationOf(row);
  if (relation?.kind === 'subagent' && typeof relation.parentAgentId === 'string') {
    return relation.parentAgentId;
  }
  if (typeof row?.parentSessionId === 'string' && row.parentSessionId) {
    return row.parentSessionId;
  }
  return '';
}

function isSubagentRow(row) {
  return relationOf(row)?.kind === 'subagent' || row?.origin === 'subagent';
}

/**
 * Rows as they appear in the visible directory. Subagent sessions never
 * appear — matching the desktop ui-workspace sidebar, which excludes
 * origin 'subagent' rows entirely. Other derived sessions (forks and other
 * relation kinds: detached / handoff / team-slot) stay top-level.
 * @param {Array<object>} rows
 * @returns {Array<object>}
 */
function visibleSessionRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => (
    row?.sessionId && !isSubagentRow(row)
  ));
}

/**
 * Group directory rows for the drawer: subagents never get a row, but each
 * loaded direct child still counts toward its parent's `subagentCount`
 * hint. Returns [{ row, subagentCount }].
 * @param {Array<object>} rows
 * @returns {Array<{ row: object, subagentCount: number }>}
 */
function groupSessionRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const groups = [];
  const indexById = new Map();
  for (const row of list) {
    if (!row?.sessionId || isSubagentRow(row)) continue;
    indexById.set(row.sessionId, groups.length);
    groups.push({ row, subagentCount: 0 });
  }
  const seen = new Set();
  for (const row of list) {
    if (!row?.sessionId || seen.has(row.sessionId) || !isSubagentRow(row)) continue;
    seen.add(row.sessionId);
    const parentId = parentSessionIdOf(row);
    if (!parentId || parentId === row.sessionId) continue;
    const index = indexById.get(parentId);
    if (index !== undefined) groups[index].subagentCount += 1;
  }
  return groups;
}

/**
 * Direct subagent children of `parentSessionId` among the loaded `rows`,
 * deduplicated by session id and ordered by recency — the desktop header
 * catalog lists only direct children, and the drawer mirrors that scope.
 * @param {Array<object>} rows
 * @param {string} parentSessionId
 * @returns {Array<object>}
 */
function directSubagentRows(rows, parentSessionId) {
  if (!parentSessionId) return [];
  const seen = new Set();
  const children = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.sessionId || seen.has(row.sessionId) || !isSubagentRow(row)) continue;
    if (parentSessionIdOf(row) !== parentSessionId) continue;
    seen.add(row.sessionId);
    children.push(row);
  }
  if (children.some((row) => row.lastActivityAt)) {
    children.sort((a, b) => String(b.lastActivityAt || '').localeCompare(String(a.lastActivityAt || '')));
  }
  return children;
}

/**
 * Merge loaded direct children with `subagent.list` catalog entries into
 * sheet items. Catalog order is authoritative for catalog children;
 * loaded-only children follow in recency order; diagnostic entries
 * (unreadable children) come last so the caller can disable them.
 * Returns [{ sessionId, row, entry, diagnostic, mode, hasChildren,
 *           running, activityAt }].
 * @param {Array<object>} rows
 * @param {string} parentSessionId
 * @param {Array<object>} catalogEntries
 */
function subagentSheetItems(rows, parentSessionId, catalogEntries) {
  const loaded = directSubagentRows(rows, parentSessionId);
  const byId = new Map(loaded.map((row) => [row.sessionId, row]));
  const used = new Set();
  const children = [];
  const diagnostics = [];
  for (const entry of Array.isArray(catalogEntries) ? catalogEntries : []) {
    const id = typeof entry?.id === 'string' ? entry.id : '';
    if (!id || used.has(id)) continue;
    const row = byId.get(id) || null;
    used.add(id);
    if (entry.kind === 'diagnostic') {
      diagnostics.push({
        sessionId: id,
        row,
        entry: null,
        diagnostic: entry.reason || 'unavailable',
        mode: '',
        hasChildren: false,
        running: row?.running === true,
        activityAt: row?.lastActivityAt || '',
      });
      continue;
    }
    children.push({
      sessionId: id,
      row,
      entry,
      diagnostic: '',
      mode: typeof entry.mode === 'string' ? entry.mode : '',
      hasChildren: entry.hasChildren === true,
      running: entry.activity === 'running' || row?.running === true,
      activityAt: row?.lastActivityAt || '',
    });
  }
  for (const row of loaded) {
    if (used.has(row.sessionId)) continue;
    children.push({
      sessionId: row.sessionId,
      row,
      entry: null,
      diagnostic: '',
      mode: '',
      hasChildren: false,
      running: row.running === true,
      activityAt: row.lastActivityAt || '',
    });
  }
  return [...children, ...diagnostics];
}

/** True when this row must open read-only (subagent track or archived). */
function isReadOnlyRow(row) {
  if (row?.archived === true) return true;
  if (isSubagentRow(row)) return true;
  const agent = row?.chisacodeAgent;
  if (!agent) return false;
  return typeof agent.archivedAt === 'string' && agent.archivedAt.length > 0;
}

/**
 * List archived / historical agents, most recently updated first.
 * Mirrors the official app: sort updated_at desc + includeArchived.
 * @param {object} client DaemonClient
 * @param {{ cursor?: string | null, limit?: number }} options
 * @returns {Promise<{ rows: Array<object>, nextCursor: string | null, hasMore: boolean }>}
 */
async function listArchivedAgents(client, { cursor = null, limit = 50 } = {}) {
  const payload = await client.fetchAgentHistory({
    sort: [{ key: 'updated_at', direction: 'desc' }],
    filter: { includeArchived: true },
    page: cursor ? { limit, cursor } : { limit },
  });
  const rows = agentRows(payload).filter(
    (row) => typeof row.chisacodeAgent?.archivedAt === 'string' && row.chisacodeAgent.archivedAt,
  );
  const page = agentPageInfo(payload);
  return { rows, nextCursor: page.nextCursor, hasMore: page.hasMore };
}

function requireAgentId(agentId) {
  if (typeof agentId !== 'string' || !agentId) {
    throw new Error('缺少会话 ID');
  }
  return agentId;
}

/** Archive one agent. Daemon cascades to subagents; errors propagate. */
async function archiveMobileAgent(client, agentId) {
  return client.archiveAgent(requireAgentId(agentId));
}

/** Permanently delete one agent. Caller must have confirmed with the user. */
async function deleteMobileAgent(client, agentId) {
  return client.deleteAgent(requireAgentId(agentId));
}

/** Rename one agent. Empty names are rejected locally before hitting the daemon. */
async function renameMobileAgent(client, agentId, name) {
  requireAgentId(agentId);
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) {
    throw new Error('会话名称不能为空');
  }
  return client.updateAgent(agentId, { name: trimmed });
}

/** Ask the daemon to regenerate the title from the first user message. */
async function regenerateMobileTitle(client, agentId) {
  return client.updateAgent(requireAgentId(agentId), { regenerateTitle: true });
}

/**
 * Unarchive one agent. Same path as the official ChisaCode app's 取消归档
 * button: refresh_agent_request clears archivedAt server-side and reloads the
 * session from persistence. This is NOT dsh unarchive and NOT
 * resumeAgent(handle) — do not relabel it as「恢复」.
 */
async function unarchiveMobileAgent(client, agentId) {
  return client.refreshAgent(requireAgentId(agentId));
}

export {
  agentPageInfo,
  archiveMobileAgent,
  deleteMobileAgent,
  directSubagentRows,
  groupSessionRows,
  isReadOnlyRow,
  isSubagentRow,
  listArchivedAgents,
  mergeAgentRows,
  parentSessionIdOf,
  regenerateMobileTitle,
  renameMobileAgent,
  subagentSheetItems,
  unarchiveMobileAgent,
  visibleSessionRows,
};
