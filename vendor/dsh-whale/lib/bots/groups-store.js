/**
 * Bot Groups SQLite store across 6 tables:
 * - `bot_groups`
 * - `bot_group_messages`
 * - `bot_group_operations`
 * - `bot_group_pending`
 * - `bot_group_worker_operations`
 * - `bot_group_sidebar`
 */
import crypto from 'node:crypto';
import { withTransaction } from './db.js';

export const GROUP_LATEST_MAX_CHARS = 500;
export const GROUP_READ_DEFAULT_LIMIT = 40;
export const GROUP_READ_MAX_LIMIT = 200;

export class BotGroupError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, any>} [data]
   */
  constructor(code, message, data = undefined) {
    super(message);
    this.name = 'BotGroupError';
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

/** @param {string} text */
export function compactLatestText(text) {
  return String(text ?? '').replace(/\s+/gu, ' ').trim().slice(0, GROUP_LATEST_MAX_CHARS);
}

/** @param {any} replyMode @param {string[]} botIds */
function normalizeReplyMode(replyMode, botIds) {
  if (!replyMode) {
    return botIds.length > 0 ? { kind: 'bot', botId: botIds[0] } : { kind: 'mentions' };
  }
  if (typeof replyMode === 'string') {
    const shortcut = replyMode.trim();
    if (shortcut === 'all' || shortcut === 'mentions') return { kind: shortcut };
    if (shortcut === 'bot') {
      return botIds.length > 0 ? { kind: 'bot', botId: botIds[0] } : { kind: 'mentions' };
    }
    throw new BotGroupError('invalid_argument', 'Invalid replyMode');
  }
  if (typeof replyMode !== 'object') {
    throw new BotGroupError('invalid_argument', 'Invalid replyMode');
  }
  if (replyMode.kind === 'all' || replyMode.kind === 'mentions') {
    return { kind: replyMode.kind };
  }
  if (replyMode.kind === 'bot' && typeof replyMode.botId === 'string' && replyMode.botId.trim()) {
    if (botIds.includes(replyMode.botId)) {
      return { kind: 'bot', botId: replyMode.botId };
    }
    return { kind: 'mentions' };
  }
  throw new BotGroupError('invalid_argument', 'Invalid replyMode');
}

/** @param {unknown} botIds */
function normalizeBotIds(botIds) {
  if (!Array.isArray(botIds)) {
    throw new BotGroupError('invalid_argument', 'botIds must be an array');
  }
  const unique = [];
  const seen = new Set();
  for (const raw of botIds) {
    const id = String(raw ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  if (unique.length === 0) {
    throw new BotGroupError('invalid_argument', 'A bot group requires at least one botId');
  }
  return unique;
}

/**
 * Check if a bot's response at `sequence` is blocked by the group's stop watermark.
 * @param {any} group
 * @param {string} botId
 * @param {number} sequence
 */
export function isStoppedAt(group, botId, sequence) {
  const map = group?.stoppedThroughSequence;
  if (!map || typeof map !== 'object') return false;
  const allMark = Number(map['*'] ?? 0);
  const botMark = Number(map[botId] ?? 0);
  return Math.max(allMark, botMark) >= sequence;
}

/** @param {any} row */
function mapMessageRow(row) {
  if (!row) return null;
  const record = JSON.parse(row.record);
  return {
    ...record,
    id: row.id,
    groupId: row.group_id,
    sequence: row.sequence,
  };
}

/** @param {any} a @param {any} b */
function compareGroups(a, b) {
  const hasA = typeof a.sidebarOrder === 'number';
  const hasB = typeof b.sidebarOrder === 'number';
  if (hasA && hasB && a.sidebarOrder !== b.sidebarOrder) {
    return a.sidebarOrder - b.sidebarOrder;
  }
  if (hasA !== hasB) return hasA ? -1 : 1;
  const tsA = a.latest?.at ?? a.updatedAt ?? a.createdAt ?? 0;
  const tsB = b.latest?.at ?? b.updatedAt ?? b.createdAt ?? 0;
  return tsB - tsA;
}

/** @param {any} prev @param {number} sequence @param {number} tie */
function isNewerLatest(prev, sequence, tie) {
  if (!prev) return true;
  if (sequence > prev.sequence) return true;
  if (sequence === prev.sequence && tie >= (prev.tie ?? 0)) return true;
  return false;
}

/** @param {any} db @param {string} groupId @param {string[]} removedIds @param {Record<string, any>} frozenItemsByBot */
function revokeRemovedMembersInMessages(db, groupId, removedIds, frozenItemsByBot) {
  const removedSet = new Set(removedIds);
  const rows = db.prepare('SELECT sequence, id, record FROM bot_group_messages WHERE group_id = ?').all(groupId);
  const updateStmt = db.prepare('UPDATE bot_group_messages SET record = ? WHERE sequence = ?');

  for (const row of rows) {
    const rec = JSON.parse(row.record);
    let dirty = false;
    if (rec.authorBotId && removedSet.has(rec.authorBotId)) {
      rec.revoked = true;
      const frozen = resolveFrozenItems(frozenItemsByBot, rec.authorBotId, row.id);
      if (frozen !== undefined) rec.frozenItems = frozen;
      dirty = true;
    }
    if (Array.isArray(rec.turns)) {
      for (const turn of rec.turns) {
        if (!turn?.botId || !removedSet.has(turn.botId)) continue;
        turn.revoked = true;
        const frozen = resolveFrozenItems(frozenItemsByBot, turn.botId, row.id);
        if (frozen !== undefined) turn.frozenItems = frozen;
        dirty = true;
      }
    }
    if (dirty) {
      updateStmt.run(JSON.stringify(rec), row.sequence);
    }
  }
}

/** @param {Record<string, any> | undefined} frozenItemsByBot @param {string} botId @param {string} messageId */
function resolveFrozenItems(frozenItemsByBot, botId, messageId) {
  const bucket = frozenItemsByBot?.[botId];
  if (!bucket) return undefined;
  if (Array.isArray(bucket)) return bucket;
  if (typeof bucket === 'object' && Object.prototype.hasOwnProperty.call(bucket, messageId)) {
    return bucket[messageId];
  }
  return undefined;
}

/** @param {any} db @param {string} groupId @param {string} botId */
function purgePendingForBot(db, groupId, botId) {
  const rows = db.prepare('SELECT operation_id, context FROM bot_group_pending WHERE group_id = ?').all(groupId);
  const delStmt = db.prepare('DELETE FROM bot_group_pending WHERE operation_id = ?');
  const updStmt = db.prepare('UPDATE bot_group_pending SET context = ? WHERE operation_id = ?');

  for (const row of rows) {
    const ctx = JSON.parse(row.context);
    if (ctx.botId === botId) {
      delStmt.run(row.operation_id);
      continue;
    }
    let changed = false;
    if (Array.isArray(ctx.targetBotIds) && ctx.targetBotIds.includes(botId)) {
      ctx.targetBotIds = ctx.targetBotIds.filter((id) => id !== botId);
      changed = true;
    }
    if (ctx.byBot && typeof ctx.byBot === 'object' && Object.prototype.hasOwnProperty.call(ctx.byBot, botId)) {
      delete ctx.byBot[botId];
      changed = true;
    }
    if (!changed) continue;
    const noTargets = Array.isArray(ctx.targetBotIds) && ctx.targetBotIds.length === 0;
    const noByBot = ctx.byBot && Object.keys(ctx.byBot).length === 0;
    if (noTargets || (noByBot && !ctx.targetBotIds?.length)) {
      delStmt.run(row.operation_id);
    } else {
      updStmt.run(JSON.stringify(ctx), row.operation_id);
    }
  }
}

/** @param {any} group @param {string[]} removedIds */
function archiveRemovedMemberSessions(group, removedIds) {
  const memberSessions = { ...(group.memberSessionIds ?? {}) };
  const formerSessions = { ...(group.formerSessionIds ?? {}) };
  for (const botId of removedIds) {
    const current = memberSessions[botId];
    if (current !== undefined) {
      const prev = Array.isArray(formerSessions[botId]) ? formerSessions[botId] : [];
      const entries = Array.isArray(current) ? current : [current];
      formerSessions[botId] = [...prev, ...entries];
      delete memberSessions[botId];
    }
  }
  return { memberSessionIds: memberSessions, formerSessionIds: formerSessions };
}

/** @param {import('node:sqlite').DatabaseSync} db */
export function createGroupsStore(db) {
  const selectGroupStmt = db.prepare('SELECT record FROM bot_groups WHERE id = ?');
  const selectAllGroupsStmt = db.prepare('SELECT record FROM bot_groups');
  const insertGroupStmt = db.prepare('INSERT INTO bot_groups (id, record) VALUES (?, ?)');
  const updateGroupStmt = db.prepare('UPDATE bot_groups SET record = ? WHERE id = ?');
  const selectSidebarStmt = db.prepare('SELECT group_id, sidebar_order, latest FROM bot_group_sidebar WHERE group_id = ?');
  const selectAllSidebarStmt = db.prepare('SELECT group_id, sidebar_order, latest FROM bot_group_sidebar');
  const upsertSidebarStmt = db.prepare(`
    INSERT INTO bot_group_sidebar (group_id, sidebar_order, latest) VALUES (?, ?, ?)
    ON CONFLICT(group_id) DO UPDATE SET
      sidebar_order = excluded.sidebar_order,
      latest = excluded.latest
  `);
  const selectMsgByIdStmt = db.prepare('SELECT * FROM bot_group_messages WHERE id = ?');
  const selectMsgByOpStmt = db.prepare(`
    SELECT m.* FROM bot_group_operations o
    JOIN bot_group_messages m ON m.id = o.message_id
    WHERE o.operation_id = ?
  `);

  function requireGroup(id) {
    const row = selectGroupStmt.get(String(id));
    if (!row) throw new BotGroupError('not_found', `Bot group not found: ${id}`);
    return JSON.parse(row.record);
  }

  function decorateWithSidebar(group, sidebarRow) {
    return {
      ...group,
      sidebarOrder: sidebarRow?.sidebar_order ?? null,
      latest: sidebarRow?.latest ? JSON.parse(sidebarRow.latest) : null,
    };
  }

  function createGroup(input, now = Date.now()) {
    const name = String(input?.name ?? '').trim();
    if (!name || name.length > 64) {
      throw new BotGroupError('invalid_argument', 'Group name must be 1..64 characters');
    }
    const botIds = normalizeBotIds(input?.botIds);
    const id = input?.id ? String(input.id).trim() : crypto.randomUUID();
    const folder = String(input?.folder ?? `group-${id.slice(0, 8)}`).trim();
    const replyMode = normalizeReplyMode(input?.replyMode, botIds);

    return withTransaction(db, () => {
      if (selectGroupStmt.get(id)) {
        throw new BotGroupError('already_exists', `Bot group already exists: ${id}`);
      }
      const record = {
        id,
        name,
        folder,
        botIds,
        replyMode,
        avatar: input?.avatar ?? null,
        avatarColor: input?.avatarColor ?? null,
        revision: 1,
        threads: [{ id: '', title: null, createdAt: now }],
        memberSessionIds: input?.memberSessionIds ? { ...input.memberSessionIds } : {},
        formerSessionIds: {},
        stoppedThroughSequence: {},
        createdAt: now,
        updatedAt: now,
      };
      insertGroupStmt.run(id, JSON.stringify(record));
      upsertSidebarStmt.run(id, input?.sidebarOrder ?? null, null);
      return decorateWithSidebar(record, selectSidebarStmt.get(id));
    });
  }

  function getGroup(id) {
    const row = selectGroupStmt.get(String(id));
    if (!row) return null;
    return decorateWithSidebar(JSON.parse(row.record), selectSidebarStmt.get(String(id)));
  }

  function listGroups() {
    const sidebars = new Map();
    for (const row of selectAllSidebarStmt.all()) {
      sidebars.set(row.group_id, row);
    }
    return selectAllGroupsStmt.all()
      .map((row) => {
        const group = JSON.parse(row.record);
        return decorateWithSidebar(group, sidebars.get(group.id));
      })
      .sort(compareGroups);
  }

  function updateGroup(id, patch = {}, { expectedRevision, frozenItemsByBot, now = Date.now() } = {}) {
    return withTransaction(db, () => {
      const current = requireGroup(id);
      if (expectedRevision !== undefined && expectedRevision !== null && current.revision !== expectedRevision) {
        throw new BotGroupError(
          'revision_conflict',
          `Group revision mismatch: expected ${expectedRevision}, actual ${current.revision}`,
          { expectedRevision, actualRevision: current.revision },
        );
      }

      const nextBotIds = patch.botIds !== undefined ? normalizeBotIds(patch.botIds) : current.botIds;
      const removedIds = current.botIds.filter((botId) => !nextBotIds.includes(botId));
      const nextName = patch.name !== undefined ? String(patch.name).trim() : current.name;
      if (!nextName || nextName.length > 64) {
        throw new BotGroupError('invalid_argument', 'Group name must be 1..64 characters');
      }

      let sessions = {
        memberSessionIds: patch.memberSessionIds
          ? { ...current.memberSessionIds, ...patch.memberSessionIds }
          : { ...current.memberSessionIds },
        formerSessionIds: { ...current.formerSessionIds },
      };

      if (removedIds.length > 0) {
        sessions = archiveRemovedMemberSessions({ ...current, ...sessions }, removedIds);
        revokeRemovedMembersInMessages(db, current.id, removedIds, frozenItemsByBot);
        for (const botId of removedIds) purgePendingForBot(db, current.id, botId);
      }

      const rawReplyMode = patch.replyMode !== undefined ? patch.replyMode : current.replyMode;
      const replyMode = normalizeReplyMode(rawReplyMode, nextBotIds);

      const next = {
        ...current,
        name: nextName,
        botIds: nextBotIds,
        replyMode,
        avatar: patch.avatar !== undefined ? patch.avatar : current.avatar,
        avatarColor: patch.avatarColor !== undefined ? patch.avatarColor : current.avatarColor,
        memberSessionIds: sessions.memberSessionIds,
        formerSessionIds: sessions.formerSessionIds,
        revision: current.revision + 1,
        updatedAt: now,
      };
      updateGroupStmt.run(JSON.stringify(next), current.id);
      return decorateWithSidebar(next, selectSidebarStmt.get(current.id));
    });
  }

  function deleteGroup(id) {
    return withTransaction(db, () => {
      const groupId = String(id);
      const exists = selectGroupStmt.get(groupId);
      if (!exists) return false;
      db.prepare(`
        DELETE FROM bot_group_worker_operations
        WHERE operation_id IN (
          SELECT o.operation_id FROM bot_group_operations o
          JOIN bot_group_messages m ON m.id = o.message_id
          WHERE m.group_id = ?
        )
      `).run(groupId);
      db.prepare(`
        DELETE FROM bot_group_operations
        WHERE message_id IN (SELECT id FROM bot_group_messages WHERE group_id = ?)
      `).run(groupId);
      db.prepare('DELETE FROM bot_group_pending WHERE group_id = ?').run(groupId);
      db.prepare('DELETE FROM bot_group_messages WHERE group_id = ?').run(groupId);
      db.prepare('DELETE FROM bot_group_sidebar WHERE group_id = ?').run(groupId);
      db.prepare('DELETE FROM bot_groups WHERE id = ?').run(groupId);
      return true;
    });
  }

  function reorderGroups(orderedIds) {
    if (!Array.isArray(orderedIds)) {
      throw new BotGroupError('invalid_argument', 'orderedIds must be an array');
    }
    return withTransaction(db, () => {
      orderedIds.forEach((groupId, index) => {
        const row = selectSidebarStmt.get(String(groupId));
        upsertSidebarStmt.run(String(groupId), index, row?.latest ?? null);
      });
      return listGroups();
    });
  }

  function createThread(groupId, { threadId, title = null, now = Date.now() } = {}) {
    return withTransaction(db, () => {
      const current = requireGroup(groupId);
      const tid = threadId ? String(threadId).trim() : crypto.randomUUID();
      if (!tid) throw new BotGroupError('invalid_argument', 'threadId cannot be empty');
      if (current.threads.some((t) => t.id === tid)) {
        throw new BotGroupError('already_exists', `Thread already exists: ${tid}`);
      }
      const thread = { id: tid, title: title ? String(title).trim().slice(0, 120) : null, createdAt: now };
      const next = {
        ...current,
        threads: [...current.threads, thread],
        revision: current.revision + 1,
        updatedAt: now,
      };
      updateGroupStmt.run(JSON.stringify(next), current.id);
      return { group: decorateWithSidebar(next, selectSidebarStmt.get(current.id)), thread };
    });
  }

  function setStoppedThrough(groupId, { botId = null, sequence, now = Date.now() }) {
    if (!Number.isInteger(sequence) || sequence < 0) {
      throw new BotGroupError('invalid_argument', 'sequence must be a non-negative integer');
    }
    return withTransaction(db, () => {
      const current = requireGroup(groupId);
      const key = botId ? String(botId) : '*';
      const prev = Number(current.stoppedThroughSequence?.[key] ?? 0);
      const nextMap = { ...(current.stoppedThroughSequence ?? {}), [key]: Math.max(prev, sequence) };
      const next = {
        ...current,
        stoppedThroughSequence: nextMap,
        revision: current.revision + 1,
        updatedAt: now,
      };
      updateGroupStmt.run(JSON.stringify(next), current.id);
      return decorateWithSidebar(next, selectSidebarStmt.get(current.id));
    });
  }

  function updateSidebarLatest(groupId, { authorName, text, at, sequence, tie = 0 }) {
    const row = selectSidebarStmt.get(String(groupId));
    const prev = row?.latest ? JSON.parse(row.latest) : null;
    if (!isNewerLatest(prev, sequence, tie)) return prev;
    const latest = {
      authorName: String(authorName ?? '').trim().slice(0, 64),
      text: compactLatestText(text),
      at: Number.isFinite(at) ? at : Date.now(),
      sequence,
      tie,
    };
    upsertSidebarStmt.run(String(groupId), row?.sidebar_order ?? null, JSON.stringify(latest));
    return latest;
  }

  function appendMessage(groupId, message, { operationId = null, tie = 0, now = Date.now() } = {}) {
    const msgId = message?.id ? String(message.id).trim() : crypto.randomUUID();
    if (!msgId) throw new BotGroupError('invalid_argument', 'message.id cannot be empty');

    return withTransaction(db, () => {
      requireGroup(groupId);
      const existing = selectMsgByIdStmt.get(msgId);
      if (existing) {
        return { message: mapMessageRow(existing), deduplicated: true };
      }

      const record = {
        ...message,
        threadId: message?.threadId ? String(message.threadId) : '',
        createdAt: Number.isFinite(message?.createdAt) ? message.createdAt : now,
      };
      delete record.id;
      delete record.groupId;
      delete record.sequence;

      const info = db.prepare(
        'INSERT INTO bot_group_messages (id, group_id, record) VALUES (?, ?, ?)',
      ).run(msgId, String(groupId), JSON.stringify(record));
      const sequence = Number(info.lastInsertRowid);

      if (operationId) {
        db.prepare(
          'INSERT OR REPLACE INTO bot_group_operations (operation_id, message_id) VALUES (?, ?)',
        ).run(String(operationId), msgId);
      }

      if (record.text !== undefined || record.preview !== undefined) {
        updateSidebarLatest(groupId, {
          authorName: record.authorName ?? record.author ?? '',
          text: record.preview ?? record.text ?? '',
          at: record.createdAt,
          sequence,
          tie,
        });
      }
      return {
        message: mapMessageRow(selectMsgByIdStmt.get(msgId)),
        deduplicated: false,
      };
    });
  }

  function updateMessage(messageId, updater) {
    return withTransaction(db, () => {
      const row = selectMsgByIdStmt.get(String(messageId));
      if (!row) return null;
      const current = mapMessageRow(row);
      const next = typeof updater === 'function' ? updater(structuredClone(current)) : { ...current, ...updater };
      const record = { ...next };
      delete record.id;
      delete record.groupId;
      delete record.sequence;
      db.prepare('UPDATE bot_group_messages SET record = ? WHERE id = ?')
        .run(JSON.stringify(record), row.id);
      return mapMessageRow(selectMsgByIdStmt.get(row.id));
    });
  }

  function readMessages(groupId, { threadId = '', beforeSequence = null, afterSequence = null, limit = GROUP_READ_DEFAULT_LIMIT } = {}) {
    const safeLimit = Math.min(Math.max(1, Number(limit) || GROUP_READ_DEFAULT_LIMIT), GROUP_READ_MAX_LIMIT);
    const tid = threadId ? String(threadId) : '';

    if (afterSequence !== null && afterSequence !== undefined) {
      const rows = db.prepare(`
        SELECT * FROM bot_group_messages
        WHERE group_id = ? AND coalesce(json_extract(record, '$.threadId'), '') = ? AND sequence > ?
        ORDER BY sequence ASC LIMIT ?
      `).all(String(groupId), tid, Number(afterSequence), safeLimit + 1);
      return {
        messages: rows.slice(0, safeLimit).map(mapMessageRow),
        hasMore: rows.length > safeLimit,
      };
    }

    const rows = beforeSequence !== null && beforeSequence !== undefined
      ? db.prepare(`
          SELECT * FROM bot_group_messages
          WHERE group_id = ? AND coalesce(json_extract(record, '$.threadId'), '') = ? AND sequence < ?
          ORDER BY sequence DESC LIMIT ?
        `).all(String(groupId), tid, Number(beforeSequence), safeLimit + 1)
      : db.prepare(`
          SELECT * FROM bot_group_messages
          WHERE group_id = ? AND coalesce(json_extract(record, '$.threadId'), '') = ?
          ORDER BY sequence DESC LIMIT ?
        `).all(String(groupId), tid, safeLimit + 1);
    return {
      messages: rows.slice(0, safeLimit).reverse().map(mapMessageRow),
      hasMore: rows.length > safeLimit,
    };
  }

  function getMessageByOperation(operationId) {
    return mapMessageRow(selectMsgByOpStmt.get(String(operationId)));
  }

  function enqueuePending(operationId, groupId, context) {
    db.prepare(`
      INSERT INTO bot_group_pending (operation_id, group_id, context) VALUES (?, ?, ?)
      ON CONFLICT(operation_id) DO UPDATE SET group_id = excluded.group_id, context = excluded.context
    `).run(String(operationId), String(groupId), JSON.stringify(context ?? {}));
  }

  function getPending(operationId) {
    const row = db.prepare('SELECT * FROM bot_group_pending WHERE operation_id = ?').get(String(operationId));
    if (!row) return null;
    return { operationId: row.operation_id, groupId: row.group_id, context: JSON.parse(row.context) };
  }

  function listPending(groupId) {
    return db.prepare('SELECT * FROM bot_group_pending WHERE group_id = ?').all(String(groupId))
      .map((row) => ({ operationId: row.operation_id, groupId: row.group_id, context: JSON.parse(row.context) }));
  }

  function deletePending(operationId) {
    const info = db.prepare('DELETE FROM bot_group_pending WHERE operation_id = ?').run(String(operationId));
    return Number(info.changes ?? 0) > 0;
  }

  function clearPendingForBot(groupId, botId) {
    return withTransaction(db, () => {
      purgePendingForBot(db, String(groupId), String(botId));
    });
  }

  function bindWorker(dispatchId, operationId) {
    db.prepare(`
      INSERT INTO bot_group_worker_operations (dispatch_id, operation_id) VALUES (?, ?)
      ON CONFLICT(dispatch_id) DO UPDATE SET operation_id = excluded.operation_id
    `).run(String(dispatchId), String(operationId));
  }

  function getWorkerOperation(dispatchId) {
    const row = db.prepare('SELECT operation_id FROM bot_group_worker_operations WHERE dispatch_id = ?')
      .get(String(dispatchId));
    return row ? row.operation_id : null;
  }

  function listWorkersForOperation(operationId) {
    return db.prepare('SELECT dispatch_id FROM bot_group_worker_operations WHERE operation_id = ?')
      .all(String(operationId))
      .map((r) => r.dispatch_id);
  }

  function unbindWorker(dispatchId) {
    const info = db.prepare('DELETE FROM bot_group_worker_operations WHERE dispatch_id = ?')
      .run(String(dispatchId));
    return Number(info.changes ?? 0) > 0;
  }

  return {
    createGroup,
    getGroup,
    listGroups,
    updateGroup,
    deleteGroup,
    reorderGroups,
    createThread,
    setStoppedThrough,
    updateSidebarLatest,
    appendMessage,
    updateMessage,
    readMessages,
    getMessageByOperation,
    enqueuePending,
    getPending,
    listPending,
    deletePending,
    clearPendingForBot,
    bindWorker,
    getWorkerOperation,
    listWorkersForOperation,
    unbindWorker,
  };
}
