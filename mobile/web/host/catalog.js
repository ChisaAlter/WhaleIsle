import { isUntitledBlank } from '../conversation/title.js';

function sessionItems(sessions) {
  if (Array.isArray(sessions?.items)) return sessions.items;
  if (Array.isArray(sessions)) return sessions;
  return [];
}

function archivedSet(workspaces) {
  const ids = workspaces?.archivedSessionIds;
  return new Set(Array.isArray(ids) ? ids : []);
}

function archivedIdList(workspaces) {
  return Array.isArray(workspaces?.archivedSessionIds) ? workspaces.archivedSessionIds : [];
}

function workspaceIndex(workspaces) {
  const items = Array.isArray(workspaces?.items) ? workspaces.items : [];
  const bySession = new Map();
  for (const workspace of items) {
    for (const sessionId of workspace.sessionIds || []) {
      bySession.set(sessionId, workspace);
    }
  }
  return { items, bySession };
}

function scratchCwdOf(workspaces) {
  return typeof workspaces?.scratchCwd === 'string' ? workspaces.scratchCwd : '';
}

/**
 * Same listing rule as the desktop sidebar: a Session shows only when a
 * registered Workspace accounts it, or when it is a no-directory task living
 * in the Host scratch cwd. Members of a deleted Workspace registration are
 * listed nowhere until that directory is added again.
 */
function isListed(session, workspace, scratchCwd) {
  if (workspace) return true;
  return Boolean(scratchCwd) && session?.cwd === scratchCwd;
}

function toRow(session, workspace, archived) {
  const sessionId = session.sessionId;
  const path = typeof workspace?.path === 'string' ? workspace.path : '';
  return {
    sessionId,
    cwd: typeof session.cwd === 'string' && session.cwd ? session.cwd : path,
    running: session.running === true,
    parentSessionId: typeof session.parentSessionId === 'string' ? session.parentSessionId : '',
    origin: typeof session.origin === 'string' ? session.origin : '',
    workspaceId: workspace?.workspaceId || '',
    workspaceTitle: workspace?.title || '',
    workspacePath: path,
    projections: session.projections && typeof session.projections === 'object'
      ? session.projections
      : { values: {} },
    lastActivityAt: typeof session.lastActivityAt === 'string' ? session.lastActivityAt
      : typeof session.updatedAt === 'string' ? session.updatedAt
      : typeof session.updatedAt === 'number' && Number.isFinite(session.updatedAt)
        ? new Date(session.updatedAt).toISOString()
        : '',
    archived: archived === true,
    blank: isUntitledBlank(session),
  };
}

function missingArchivedRow(sessionId) {
  return {
    sessionId,
    cwd: '',
    running: false,
    parentSessionId: '',
    origin: '',
    workspaceId: '',
    workspaceTitle: '',
    workspacePath: '',
    projections: { values: { title: '缺失会话' } },
    archived: true,
    blank: false,
  };
}

function liveSessionRows({ sessions, workspaces }) {
  const archived = archivedSet(workspaces);
  const { bySession } = workspaceIndex(workspaces);
  const scratchCwd = scratchCwdOf(workspaces);
  return sessionItems(sessions).flatMap((session) => {
    const sessionId = session?.sessionId;
    if (!sessionId) return [];
    if (isUntitledBlank(session)) return [];
    if (session.origin === 'dshbot') return [];
    if (archived.has(sessionId)) return [];
    const workspace = bySession.get(sessionId);
    if (!isListed(session, workspace, scratchCwd)) return [];
    return [toRow(session, workspace, false)];
  });
}

function archivedSessionRows({ sessions, workspaces }) {
  const { bySession } = workspaceIndex(workspaces);
  const scratchCwd = scratchCwdOf(workspaces);
  const byId = new Map();
  for (const session of sessionItems(sessions)) {
    if (session?.sessionId) byId.set(session.sessionId, session);
  }
  return archivedIdList(workspaces).flatMap((sessionId) => {
    if (!sessionId) return [];
    const session = byId.get(sessionId);
    if (session?.origin === 'dshbot') return [];
    // A summary-less id stays as a placeholder so Delete remains reachable.
    if (!session) return [missingArchivedRow(sessionId)];
    const workspace = bySession.get(sessionId);
    if (!isListed(session, workspace, scratchCwd)) return [];
    return [toRow(session, workspace, true)];
  });
}

function parentDir(path) {
  const raw = String(path || '').replace(/[\\/]+$/, '');
  if (!raw) return '';
  const slash = raw.lastIndexOf('/');
  const back = raw.lastIndexOf('\\');
  const idx = Math.max(slash, back);
  if (idx <= 0) return '';
  const sep = slash > back ? '/' : '\\';
  if (idx === 2 && raw[1] === ':') return raw.slice(0, 3);
  return raw.slice(0, idx) || sep;
}

function browseStartPath(workspaces) {
  const items = Array.isArray(workspaces?.items) ? workspaces.items : [];
  const first = items.find((item) => typeof item?.path === 'string' && item.path);
  return first ? parentDir(first.path) : '';
}

function insertSessionMove(row, direction, workspaces, liveRows) {
  const workspaceId = row?.workspaceId;
  const sessionId = row?.sessionId;
  if (!workspaceId || !sessionId) return null;
  const workspace = (Array.isArray(workspaces?.items) ? workspaces.items : [])
    .find((item) => item?.workspaceId === workspaceId);
  if (!workspace) return null;
  const visible = new Set(
    (Array.isArray(liveRows) ? liveRows : [])
      .filter((item) => item?.workspaceId === workspaceId && item?.sessionId)
      .map((item) => item.sessionId),
  );
  const ids = (workspace.sessionIds || []).filter((id) => visible.has(id));
  const index = ids.indexOf(sessionId);
  if (index < 0) return null;
  if (direction === 'up') {
    if (index === 0) return null;
    return { workspaceId, sessionId, beforeSessionId: ids[index - 1] };
  }
  if (direction === 'down') {
    if (index >= ids.length - 1) return null;
    return { workspaceId, sessionId: ids[index + 1], beforeSessionId: sessionId };
  }
  return null;
}

function workspaceDrawerSections(liveRows, workspaces) {
  const items = Array.isArray(workspaces?.items) ? workspaces.items : [];
  const rows = Array.isArray(liveRows) ? liveRows : [];
  const byId = new Map(rows.filter((row) => row?.sessionId).map((row) => [row.sessionId, row]));
  const used = new Set();
  const sections = items.map((workspace) => {
    const grouped = [];
    for (const sessionId of workspace.sessionIds || []) {
      const row = byId.get(sessionId);
      if (!row) continue;
      grouped.push(row);
      used.add(sessionId);
    }
    return { workspace, rows: grouped };
  });
  return {
    sections,
    ungrouped: rows.filter((row) => !used.has(row.sessionId)),
  };
}

function workspaceChoices(workspaces, hostDescribe = {}) {
  const items = Array.isArray(workspaces?.items) ? workspaces.items : [];
  const choices = items.map((workspace) => ({
    id: workspace.workspaceId,
    name: workspace.title || workspace.path || workspace.workspaceId,
    cwd: workspace.path || '',
  }));
  // The scratch cwd rides the Workspace baseline (workspace.list); an explicit
  // host describe value stays accepted for older tunnels.
  const scratchCwd = scratchCwdOf(workspaces)
    || (typeof hostDescribe.scratchCwd === 'string' ? hostDescribe.scratchCwd : '');
  return {
    choices,
    home: typeof hostDescribe.home === 'string' ? hostDescribe.home : '',
    scratchCwd,
    // Creating here must land in the scratch cwd, or the desktop would not
    // list the Session (it is neither a member nor a no-directory task).
    noFolder: { id: '', name: '无工作区文件夹', cwd: scratchCwd },
  };
}

function heldSessionRow({ sessions, workspaces, sessionId }) {
  if (!sessionId) return null;
  const archived = archivedSet(workspaces);
  if (archived.has(sessionId)) return null;
  const session = sessionItems(sessions).find((item) => item?.sessionId === sessionId);
  if (!session || session.origin === 'dshbot') return null;
  const { bySession } = workspaceIndex(workspaces);
  return toRow(session, bySession.get(sessionId), false);
}

function withHeldLiveRow(liveRows, held) {
  const rows = Array.isArray(liveRows) ? liveRows : [];
  if (!held || held.blank === true) return rows;
  if (rows.some((row) => row.sessionId === held.sessionId)) return rows;
  return [held, ...rows];
}

function presetChoices(value) {
  const items = Array.isArray(value?.presets) ? value.presets : [];
  return items.flatMap((item) => {
    if (item?.broken === true) return [];
    const id = typeof item?.id === 'string' ? item.id : (typeof item?.agentPreset === 'string' ? item.agentPreset : '');
    if (!id) return [];
    const name = typeof item?.name === 'string' && item.name.trim()
      ? item.name.trim()
      : (typeof item?.title === 'string' && item.title.trim() ? item.title.trim() : id);
    return [{ id, name }];
  });
}

function workspaceIdFromCreate(value) {
  const nested = value && typeof value === 'object' && value.workspace && typeof value.workspace === 'object'
    ? value.workspace
    : value;
  if (!nested || typeof nested !== 'object') return '';
  if (typeof nested.workspaceId === 'string' && nested.workspaceId) return nested.workspaceId;
  return typeof nested.id === 'string' && nested.id ? nested.id : '';
}

export {
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
};
