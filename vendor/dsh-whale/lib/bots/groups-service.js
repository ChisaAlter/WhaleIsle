/**
 * Multi-Bot Group Chat runtime service.
 * Combines `groups-store.js` with shared mention parsing, <=24KB quoted history,
 * attachment image passthrough, and two-phase Coordinator Plan-Gate
 * (`awaiting_approval` -> bounded concurrency <=3, `depth <= 6` & cycle detection -> summary).
 */
import crypto from 'node:crypto';
import {
  BOT_GROUP_LIMITS,
  BOT_GROUP_MEMBER_SESSION_PREFIX,
  BOT_WORKER_MAX_CONCURRENCY,
  buildQuotedRoomHistory,
  isQuietResult,
  parseGroupMentions,
  resolveGroupTargets,
  stripQuietMarker,
  suggestGroupName,
} from '../../src/shared/index.js';
import { isStoppedAt } from './groups-store.js';
import { BOT_OWNER_GROUP_MEMBER } from './session-runtime.js';

export const MAX_PLAN_DEPTH = 6;
export const MAX_PLAN_CONCURRENCY = BOT_WORKER_MAX_CONCURRENCY;
const COORDINATOR_META_KEY = '__replyModeCoordinatorBotId__';

/** @param {unknown} value */
const cleanStr = (value) => (typeof value === 'string' && value.trim() ? value.trim() : '');
/** @param {string} botId @param {string} [threadId] */
const memberSessionKey = (botId, threadId) => (threadId ? `${botId}:${threadId}` : botId);

/** @param {any} raw */
function normalizeSingleImage(raw) {
  if (typeof raw === 'string' && raw.trim()) {
    const p = raw.trim();
    return { path: p, name: p.split(/[\\/]/u).pop() || 'image' };
  }
  if (!raw || typeof raw !== 'object') return null;
  const p = cleanStr(raw.path ?? raw.url);
  const dataUrl = cleanStr(raw.dataUrl);
  if (!p && !dataUrl) return null;
  const name = cleanStr(raw.name ?? raw.alt) || (p ? p.split(/[\\/]/u).pop() : 'image') || 'image';
  const mimeType = cleanStr(raw.mimeType);
  return { name, ...(p ? { path: p } : {}), ...(dataUrl ? { dataUrl } : {}), ...(mimeType ? { mimeType } : {}) };
}

/** @param {any} rawImages */
function normalizeGroupImages(rawImages) {
  if (!Array.isArray(rawImages)) return [];
  return rawImages.slice(0, BOT_GROUP_LIMITS.maxImages).map(normalizeSingleImage).filter(Boolean);
}

/** @param {any} rawReplyMode @param {string[]} botIds */
function parseCoordinatorReplyMode(rawReplyMode, botIds) {
  if (rawReplyMode === 'coordinator') {
    const coordinatorBotId = botIds[0] ?? '';
    if (!coordinatorBotId) throw Object.assign(new Error('Coordinator mode requires at least one bot'), { code: 'invalid_argument' });
    return { kind: 'coordinator', coordinatorBotId };
  }
  if (!rawReplyMode || typeof rawReplyMode !== 'object' || rawReplyMode.kind !== 'coordinator') return null;
  const coordinatorBotId = cleanStr(rawReplyMode.coordinatorBotId ?? rawReplyMode.botId) || (botIds[0] ?? '');
  if (!coordinatorBotId || !botIds.includes(coordinatorBotId)) {
    throw Object.assign(new Error('coordinatorBotId must be a member of the group'), { code: 'invalid_argument' });
  }
  return { kind: 'coordinator', coordinatorBotId };
}

/** @param {any} group */
function resolveStoredCoordinatorId(group) {
  if (!group) return null;
  const ids = group.botIds ?? [];
  if (group.replyMode?.kind === 'coordinator') {
    const id = cleanStr(group.replyMode.coordinatorBotId ?? group.replyMode.botId);
    return id && ids.includes(id) ? id : null;
  }
  const marker = cleanStr(group.memberSessionIds?.[COORDINATOR_META_KEY]);
  return marker && ids.includes(marker) ? marker : null;
}

/** @param {any} group @param {string} [threadId] */
function toSharedGroupShape(group, threadId = '') {
  const sessions = group.memberSessionIds ?? {};
  const members = (group.botIds ?? []).map((/** @type {string} */ botId) => ({
    botId,
    sessionId: sessions[memberSessionKey(botId, threadId)] ?? sessions[botId] ?? null,
  }));
  return { ...group, members };
}

/** @param {Map<string, Set<string>>} adj */
function hasGraphCycle(adj) {
  /** @type {Map<string, number>} */
  const color = new Map();
  /** @type {Set<string>} */
  const nodes = new Set(adj.keys());
  for (const targets of adj.values()) for (const t of targets) nodes.add(t);
  /** @param {string} node @returns {boolean} */
  function visit(node) {
    color.set(node, 1);
    for (const next of adj.get(node) ?? []) {
      const state = color.get(next) ?? 0;
      if (state === 1 || (state === 0 && visit(next))) return true;
    }
    color.set(node, 2);
    return false;
  }
  for (const node of nodes) {
    if ((color.get(node) ?? 0) === 0 && visit(node)) return true;
  }
  return false;
}

/** @param {any} raw @param {string[]} keys */
function firstText(raw, keys) {
  for (const key of keys) {
    const val = cleanStr(raw?.[key]);
    if (val) return val;
  }
  return '';
}

/** @param {any} raw @param {number} idx @param {string} coordinatorBotId @param {Set<string>} memberSet @param {number} baseDepth @param {number} maxDepth */
function normalizeAndCheckStep(raw, idx, coordinatorBotId, memberSet, baseDepth, maxDepth) {
  const stepId = firstText(raw, ['stepId', 'id']) || `step-${idx + 1}`;
  const botId = firstText(raw, ['botId', 'toBotId']);
  const fromBotId = firstText(raw, ['fromBotId']) || coordinatorBotId;
  const task = firstText(raw, ['task', 'prompt', 'text']);
  const depth = Number.isInteger(raw?.depth) ? raw.depth : baseDepth;
  const dependsOn = Array.isArray(raw?.dependsOn) ? raw.dependsOn.map(cleanStr).filter(Boolean) : [];
  if (!botId || !memberSet.has(botId)) {
    throw Object.assign(new Error(`Plan step ${stepId} targets non-member bot: ${botId || 'missing'}`), { code: 'invalid_argument' });
  }
  if (!task) throw Object.assign(new Error(`Plan step ${stepId} is missing a task`), { code: 'invalid_argument' });
  if (depth < 0 || depth > maxDepth) {
    throw Object.assign(new Error(`Plan step ${stepId} depth ${depth} exceeds max depth ${maxDepth}`), {
      code: 'depth_exceeded', data: { stepId, depth, maxDepth },
    });
  }
  return { stepId, fromBotId, botId, task, depth, dependsOn };
}

/** @param {Array<any>} normalized @param {Map<string, any>} byId */
function assertNoPlanCycles(normalized, byId) {
  /** @type {Map<string, Set<string>>} */
  const botAdj = new Map();
  /** @type {Map<string, Set<string>>} */
  const depAdj = new Map();
  for (const step of normalized) {
    if (step.fromBotId && step.fromBotId === step.botId) {
      throw Object.assign(new Error(`Delegation self-loop detected: ${step.fromBotId} -> ${step.botId}`), {
        code: 'loop_detected', data: { fromBotId: step.fromBotId, toBotId: step.botId },
      });
    }
    if (step.fromBotId) {
      const edges = botAdj.get(step.fromBotId) ?? new Set();
      edges.add(step.botId);
      botAdj.set(step.fromBotId, edges);
    }
    const deps = new Set();
    for (const depId of step.dependsOn) {
      if (depId === step.stepId) {
        throw Object.assign(new Error(`Step dependency self-loop detected: ${step.stepId}`), { code: 'loop_detected' });
      }
      if (byId.has(depId)) deps.add(depId);
    }
    depAdj.set(step.stepId, deps);
  }
  if (hasGraphCycle(botAdj)) throw Object.assign(new Error('Bot delegation cycle detected in coordinator plan'), { code: 'loop_detected' });
  if (hasGraphCycle(depAdj)) throw Object.assign(new Error('Step dependency cycle detected in coordinator plan'), { code: 'loop_detected' });
}

/**
 * Validate Coordinator Phase 2 steps against `depth <= maxDepth` (default 6),
 * bot delegation cycles (`fromBotId -> toBotId`), and `dependsOn` DAG cycles.
 * @param {{ coordinatorBotId: string, steps: Array<any>, memberBotIds: string[], baseDepth?: number, maxDepth?: number }} input
 */
export function validatePlanSteps({ coordinatorBotId, steps, memberBotIds, baseDepth = 1, maxDepth = MAX_PLAN_DEPTH }) {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw Object.assign(new Error('Plan must include at least one step'), { code: 'invalid_argument' });
  }
  const memberSet = new Set(memberBotIds ?? []);
  /** @type {Map<string, any>} */
  const byId = new Map();
  const normalized = steps.map((raw, idx) => {
    const item = normalizeAndCheckStep(raw, idx, coordinatorBotId, memberSet, baseDepth, maxDepth);
    byId.set(item.stepId, item);
    return item;
  });
  assertNoPlanCycles(normalized, byId);

  /** @type {Map<string, number>} */
  const depthMemo = new Map();
  /** @param {string} stepId @returns {number} */
  function chainDepth(stepId) {
    const cached = depthMemo.get(stepId);
    if (cached !== undefined) return cached;
    const step = byId.get(stepId);
    const parentDepths = (step?.dependsOn ?? [])
      .filter((/** @type {string} */ d) => byId.has(d))
      .map((/** @type {string} */ d) => chainDepth(d) + 1);
    const eff = Math.max(step?.depth ?? baseDepth, ...parentDepths);
    depthMemo.set(stepId, eff);
    return eff;
  }
  for (const step of normalized) {
    const eff = chainDepth(step.stepId);
    if (eff > maxDepth) {
      throw Object.assign(new Error(`Plan dependency chain depth ${eff} exceeds max depth ${maxDepth}`), {
        code: 'depth_exceeded', data: { stepId: step.stepId, depth: eff, maxDepth },
      });
    }
    step.depth = eff;
  }
  return normalized;
}

/** @param {string} planText */
function extractJsonPlan(planText) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(planText);
  const candidate = (fenced ? fenced[1] : planText).trim();
  if (!candidate.startsWith('{') && !candidate.startsWith('[')) return null;
  try { return JSON.parse(candidate); } catch { return null; }
}

/** @param {any} entry @param {number} index @param {Array<any>} memberBots @param {string} coordinatorBotId */
function mapParsedPlanStep(entry, index, memberBots, coordinatorBotId) {
  if (!entry || typeof entry !== 'object') return null;
  const rawTarget = cleanStr(entry.botId ?? entry.toBotId ?? entry.bot ?? entry.botName);
  const target = memberBots.find((b) => b.id === rawTarget)
    ?? memberBots.find((b) => b.name.toLowerCase() === rawTarget.toLowerCase());
  const task = cleanStr(entry.task ?? entry.prompt ?? entry.instruction ?? entry.text);
  if (!target || !task) return null;
  return {
    stepId: cleanStr(entry.stepId ?? entry.id) || `step-${index + 1}`,
    fromBotId: cleanStr(entry.fromBotId) || coordinatorBotId,
    botId: target.id,
    botName: target.name,
    task,
    depth: Number.isInteger(entry.depth) ? entry.depth : 1,
    dependsOn: Array.isArray(entry.dependsOn) ? entry.dependsOn.map(cleanStr).filter(Boolean) : [],
    status: 'pending',
    reply: null,
    error: null,
  };
}

/** @param {string} planText @param {Array<any>} allMemberBots @param {string} coordinatorBotId */
function parseCoordinatorPlanSteps(planText, allMemberBots, coordinatorBotId) {
  const parsed = extractJsonPlan(planText);
  const rawSteps = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.steps) ? parsed.steps : null);
  if (rawSteps?.length) {
    const mapped = rawSteps.map((/** @type {any} */ e, /** @type {number} */ i) => mapParsedPlanStep(e, i, allMemberBots, coordinatorBotId)).filter(Boolean);
    if (mapped.length > 0) return mapped;
  }
  const nonCoords = allMemberBots.filter((b) => b.id !== coordinatorBotId && !b.paused);
  const targets = nonCoords.length > 0 ? nonCoords : allMemberBots.filter((b) => !b.paused);
  return targets.map((bot, idx) => ({
    stepId: `step-${idx + 1}`,
    fromBotId: coordinatorBotId,
    botId: bot.id,
    botName: bot.name,
    task: planText || 'Execute your part of the coordinator plan.',
    depth: 1,
    dependsOn: [],
    status: 'pending',
    reply: null,
    error: null,
  }));
}

/** @param {Array<any>} images */
function formatImageLines(images) {
  if (!Array.isArray(images) || images.length === 0) return '';
  return `[Attachments: ${images.map((img) => (img.path ? `${img.name} (${img.path})` : img.name)).join(', ')}]`;
}

/** @param {Array<any>} stepPlans @param {number} maxConcurrency @param {(plan: any) => Promise<void>} runStep */
async function runDagBounded(stepPlans, maxConcurrency, runStep) {
  const completedIds = new Set();
  const pendingQueue = [...stepPlans];
  const active = new Set();
  while (pendingQueue.length > 0 || active.size > 0) {
    while (active.size < maxConcurrency) {
      const readyIdx = pendingQueue.findIndex((p) => p.dependsOn.every((/** @type {string} */ depId) => completedIds.has(depId)));
      if (readyIdx === -1) break;
      const [nextPlan] = pendingQueue.splice(readyIdx, 1);
      const job = runStep(nextPlan).then(() => { completedIds.add(nextPlan.stepId); }).finally(() => { active.delete(job); });
      active.add(job);
    }
    if (active.size > 0) await Promise.race(active);
    else break;
  }
}

/**
 * Create the multi-bot groups runtime service.
 * @param {{ botsStore: any, groupsStore: any, sessionRuntime: any, eventBus: any, logger?: any }} deps
 */
export function createGroupsService(deps) {
  const { botsStore, groupsStore, sessionRuntime, eventBus, logger = console } = deps;

  /** @param {any} group */
  function enrichGroup(group) {
    if (!group) return null;
    const coordId = resolveStoredCoordinatorId(group);
    const cleanedSessions = { ...(group.memberSessionIds ?? {}) };
    delete cleanedSessions[COORDINATOR_META_KEY];
    const members = (group.botIds ?? []).map((/** @type {string} */ botId) => {
      const bot = botsStore.getBot(botId);
      return {
        botId,
        name: bot?.name ?? botId,
        avatar: bot?.avatar ?? null,
        avatarColor: bot?.avatarColor ?? null,
        paused: Boolean(bot?.paused),
        sessionId: cleanedSessions[botId] ?? null,
      };
    });
    const replyMode = coordId ? { kind: 'coordinator', coordinatorBotId: coordId } : group.replyMode;
    return { ...group, replyMode, memberSessionIds: cleanedSessions, members };
  }

  const list = () => groupsStore.listGroups().map(enrichGroup);

  /** @param {Record<string, any>} [params] */
  function create(params = {}) {
    const botIds = Array.isArray(params.botIds) ? params.botIds : [];
    const memberBots = botIds.map((/** @type {string} */ id) => botsStore.getBot(id)).filter(Boolean);
    if (memberBots.length < 2) throw Object.assign(new Error('A group requires at least 2 existing bots'), { code: 'invalid_argument' });
    const validIds = memberBots.map((/** @type {any} */ b) => b.id);
    const coordMode = parseCoordinatorReplyMode(params.replyMode, validIds);
    const name = String(params.name ?? '').trim() || suggestGroupName(memberBots.map((/** @type {any} */ b) => b.name)) || 'Bot Group';
    const created = groupsStore.createGroup({
      id: params.id,
      name,
      botIds: validIds,
      replyMode: coordMode ? { kind: 'bot', botId: coordMode.coordinatorBotId } : params.replyMode,
      avatar: params.avatar ?? null,
      avatarColor: params.avatarColor ?? null,
      ...(coordMode ? { memberSessionIds: { [COORDINATOR_META_KEY]: coordMode.coordinatorBotId } } : {}),
    });
    eventBus.emit({ kinds: ['groups'] });
    return enrichGroup(created);
  }

  /** @param {Record<string, any>} [params] */
  function update(params = {}) {
    const id = String(params.groupId ?? params.id ?? '').trim();
    if (!id) throw Object.assign(new Error('groupId is required'), { code: 'invalid_argument' });
    const existing = groupsStore.getGroup(id);
    if (!existing) throw Object.assign(new Error(`Group not found: ${id}`), { code: 'not_found' });
    const nextBotIds = Array.isArray(params.botIds) ? params.botIds : existing.botIds;
    /** @type {Record<string, any>} */
    const patch = {};
    for (const key of ['name', 'botIds', 'avatar', 'avatarColor']) {
      if (params[key] !== undefined) patch[key] = params[key];
    }
    if (params.replyMode !== undefined) {
      const coordMode = parseCoordinatorReplyMode(params.replyMode, nextBotIds);
      patch.replyMode = coordMode ? { kind: 'bot', botId: coordMode.coordinatorBotId } : params.replyMode;
      patch.memberSessionIds = { [COORDINATOR_META_KEY]: coordMode ? coordMode.coordinatorBotId : null };
    }
    const updated = groupsStore.updateGroup(id, patch, {
      expectedRevision: params.expectedRevision ?? params.revision,
      frozenItemsByBot: params.frozenItemsByBot,
    });
    eventBus.emit({ kinds: ['groups'] });
    return enrichGroup(updated);
  }

  /** @param {string | Record<string, any>} [params] */
  function remove(params = {}) {
    const id = typeof params === 'string' ? params : String(params?.groupId ?? params?.id ?? '');
    const deleted = groupsStore.deleteGroup(id);
    if (deleted) eventBus.emit({ kinds: ['groups'] });
    return { deleted };
  }

  /** @param {string[]} orderedIds */
  function reorder(orderedIds) {
    const listRes = groupsStore.reorderGroups(orderedIds).map(enrichGroup);
    eventBus.emit({ kinds: ['groups'] });
    return listRes;
  }

  /** @param {Record<string, any>} [params] */
  function read(params = {}) {
    const groupId = String(params.groupId ?? params.id ?? '').trim();
    const group = groupsStore.getGroup(groupId);
    if (!group) throw Object.assign(new Error(`Group not found: ${groupId}`), { code: 'not_found' });
    const page = groupsStore.readMessages(groupId, {
      threadId: params.threadId ?? '',
      beforeSequence: params.beforeSequence ?? null,
      afterSequence: params.afterSequence ?? null,
      limit: params.limit ?? 40,
    });
    return { group: enrichGroup(group), ...page };
  }

  /** @param {Record<string, any>} [params] */
  function newThread(params = {}) {
    const groupId = String(params.groupId ?? params.id ?? '').trim();
    const res = groupsStore.createThread(groupId, { threadId: params.threadId, title: params.title ?? null });
    eventBus.emit({ kinds: ['groups'] });
    return { group: enrichGroup(res.group), thread: res.thread };
  }

  /** @param {any} group @param {any} bot @param {string} threadId */
  async function ensureMemberSession(group, bot, threadId) {
    const key = memberSessionKey(bot.id, threadId);
    let sessionId = group.memberSessionIds?.[key];
    if (!sessionId) {
      sessionId = `${BOT_GROUP_MEMBER_SESSION_PREFIX}${crypto.randomUUID()}`;
      const started = await sessionRuntime.startSideChat(bot.id, {
        sessionId, title: `${group.name} · ${bot.name}`, kind: 'group-member', origin: 'group', owner: BOT_OWNER_GROUP_MEMBER,
      });
      sessionId = started.sessionId;
      groupsStore.updateGroup(group.id, { memberSessionIds: { [key]: sessionId } });
    }
    return sessionId;
  }

  /** @param {string} messageId @param {string} operationId @param {Record<string, any>} patch */
  function updateTurnRecord(messageId, operationId, patch) {
    groupsStore.updateMessage(messageId, (/** @type {any} */ msg) => ({
      ...msg,
      turns: (msg.turns ?? []).map((/** @type {any} */ t) => (t.operationId === operationId ? { ...t, ...patch } : t)),
    }));
  }

  /** @param {string} groupId @param {any} ownerMessage @param {string} quotedHistory @param {Array<any>} images */
  function buildMemberPrompt(groupId, ownerMessage, quotedHistory, images) {
    const groupName = groupsStore.getGroup(groupId)?.name ?? groupId;
    const imgLine = formatImageLines(images);
    return [
      `[WhaleIsle: Group "${groupName}" message]`,
      quotedHistory,
      '',
      `${ownerMessage.authorName || 'Owner'}: ${ownerMessage.text}`,
      ...(imgLine ? [imgLine] : []),
    ].join('\n');
  }

  /** @param {{ groupId: string, ownerMessage: any, bot: any, operationId: string, turn: any }} input @returns {{ botId: string, status: string, reply?: string, stopped?: boolean, error?: string }} */
  function finalizeMemberTurn({ groupId, ownerMessage, bot, operationId, turn }) {
    const latestGroup = groupsStore.getGroup(groupId);
    if (!latestGroup || isStoppedAt(latestGroup, bot.id, ownerMessage.sequence)) {
      updateTurnRecord(ownerMessage.id, operationId, { status: 'stopped', finishedAt: Date.now() });
      eventBus.emit({ kinds: ['groups'] });
      return { botId: bot.id, status: 'stopped', stopped: true };
    }
    const rawReply = String(turn?.reply ?? '').trim();
    const cleanReply = isQuietResult(rawReply) ? stripQuietMarker(rawReply).trim() : rawReply;
    const ok = Boolean(turn?.ok);
    const status = ok ? (cleanReply ? 'done' : 'quiet') : 'error';
    updateTurnRecord(ownerMessage.id, operationId, {
      status, reply: cleanReply, error: ok ? null : (turn?.error || 'failed'), finishedAt: Date.now(),
    });
    if (cleanReply) {
      groupsStore.updateSidebarLatest(groupId, {
        authorName: bot.name, text: cleanReply, at: Date.now(), sequence: ownerMessage.sequence, tie: 1,
      });
    }
    eventBus.emit({ kinds: ['groups'] });
    return { botId: bot.id, status, reply: cleanReply };
  }

  /** @param {{ groupId: string, ownerMessage: any, bot: any, sessionId: string, operationId: string, quotedHistory: string, customPrompt?: string | null }} input @returns {Promise<{ botId: string, status: string, reply?: string, stopped?: boolean, error?: string }>} */
  async function driveMemberReply({ groupId, ownerMessage, bot, sessionId, operationId, quotedHistory, customPrompt = null }) {
    const images = normalizeGroupImages(ownerMessage.images);
    const prompt = customPrompt ?? buildMemberPrompt(groupId, ownerMessage, quotedHistory, images);
    try {
      const turnOpts = images.length > 0 ? { timeoutMs: 120_000, images } : { timeoutMs: 120_000 };
      const turn = await sessionRuntime.runSingleTurn(sessionId, prompt, turnOpts);
      groupsStore.deletePending(operationId);
      return finalizeMemberTurn({ groupId, ownerMessage, bot, operationId, turn });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error || 'failed');
      groupsStore.deletePending(operationId);
      updateTurnRecord(ownerMessage.id, operationId, { status: 'error', error: errMsg, finishedAt: Date.now() });
      eventBus.emit({ kinds: ['groups'] });
      logger?.warn?.(`[dsh-bots:groups] turn ${operationId} failed:`, errMsg);
      return { botId: bot.id, status: 'error', error: errMsg };
    }
  }

  /** @param {string} groupId @param {string} messageId @param {string | null} [preferredThreadId] */
  function findGroupMessage(groupId, messageId, preferredThreadId = null) {
    const group = groupsStore.getGroup(groupId);
    if (!group) throw Object.assign(new Error(`Group not found: ${groupId}`), { code: 'not_found' });
    const threadIds = preferredThreadId !== null && preferredThreadId !== undefined
      ? [String(preferredThreadId)]
      : (group.threads ?? [{ id: '' }]).map((/** @type {any} */ t) => String(t.id ?? ''));
    for (const tid of threadIds) {
      const found = groupsStore.readMessages(groupId, { threadId: tid, limit: 200 }).messages.find((/** @type {any} */ m) => m.id === messageId);
      if (found) return { group: enrichGroup(group), message: found, threadId: tid };
    }
    throw Object.assign(new Error(`Group message not found: ${messageId}`), { code: 'not_found' });
  }

  /** @param {{ group: any, ownerMessage: any, coordinatorBot: any, sessionId: string, operationId: string, quotedHistory: string }} input */
  async function driveCoordinatorPhase1({ group, ownerMessage, coordinatorBot, sessionId, operationId, quotedHistory }) {
    const memberBots = (group.botIds ?? []).map((/** @type {string} */ id) => botsStore.getBot(id)).filter(Boolean);
    const rosterLines = memberBots.map((/** @type {any} */ b) => `- ${b.name} (botId: ${b.id})${b.paused ? ' [paused]' : ''}`).join('\n');
    const imgLine = formatImageLines(ownerMessage.images);
    const planPrompt = [
      `[WhaleIsle: Group "${group.name}" · Coordinator Plan Phase 1]`,
      quotedHistory,
      '',
      'Available group members:',
      rosterLines,
      '',
      `${ownerMessage.authorName || 'Owner'}: ${ownerMessage.text}`,
      ...(imgLine ? [imgLine] : []),
      '',
      'Produce an execution plan JSON block: {"summary":"...","steps":[{"stepId":"step-1","botId":"...","task":"...","dependsOn":[]}]}',
    ].join('\n');

    const res = await driveMemberReply({
      groupId: group.id, ownerMessage, bot: coordinatorBot, sessionId, operationId, quotedHistory, customPrompt: planPrompt,
    });
    if (res.stopped || res.status === 'error') {
      const nextStatus = res.stopped ? 'stopped' : 'failed';
      groupsStore.updateMessage(ownerMessage.id, (/** @type {any} */ msg) => ({
        ...msg, planGate: { ...(msg.planGate ?? {}), status: nextStatus, error: res.error ?? null, updatedAt: Date.now() },
      }));
      eventBus.emit({ kinds: ['groups'] });
      return res;
    }
    const steps = parseCoordinatorPlanSteps(res.reply || '', memberBots, coordinatorBot.id);
    groupsStore.updateMessage(ownerMessage.id, (/** @type {any} */ msg) => ({
      ...msg,
      planGate: { ...(msg.planGate ?? {}), status: 'awaiting_approval', coordinatorBotId: coordinatorBot.id, planText: res.reply || '', steps, updatedAt: Date.now() },
    }));
    eventBus.emit({ kinds: ['groups'] });
    return { ...res, planStatus: 'awaiting_approval', steps };
  }

  /** @param {{ group: any, message: any, threadId: string, coordinatorBot: any, results: Array<any> }} input */
  async function runCoordinatorSummary({ group, message, threadId, coordinatorBot, results }) {
    const summaryOpId = `gop-summary-${crypto.randomUUID()}`;
    const coordSessionId = await ensureMemberSession(groupsStore.getGroup(group.id), coordinatorBot, threadId);
    groupsStore.updateMessage(message.id, (/** @type {any} */ msg) => ({
      ...msg,
      turns: [...(msg.turns ?? []), {
        operationId: summaryOpId, botId: coordinatorBot.id, botName: coordinatorBot.name,
        sessionId: coordSessionId, phase: 'summary', status: 'running', reply: null,
      }],
    }));
    groupsStore.enqueuePending(summaryOpId, group.id, { botId: coordinatorBot.id, threadId, phase: 'summary' });
    const memberReport = results.map((/** @type {any} */ r) => `- [${r.stepId}] ${r.botName} (${r.status}): ${r.reply || r.error || '(no output)'}`).join('\n');
    const summaryPrompt = [
      `[WhaleIsle: Group "${group.name}" · Coordinator Phase 2 Summary]`,
      `Original request: ${message.text}`,
      '',
      'Member execution results:',
      memberReport,
      '',
      'Provide a concise final summary for the owner.',
    ].join('\n');
    return driveMemberReply({
      groupId: group.id, ownerMessage: message, bot: coordinatorBot,
      sessionId: coordSessionId, operationId: summaryOpId, quotedHistory: '', customPrompt: summaryPrompt,
    });
  }

  /** @param {string} groupId @param {string} threadId @param {Array<any>} validatedSteps */
  async function prepareApprovedStepPlans(groupId, threadId, validatedSteps) {
    const historyBefore = groupsStore.readMessages(groupId, { threadId, limit: 40 }).messages;
    const stepPlans = [];
    for (const step of validatedSteps) {
      const bot = botsStore.getBot(step.botId);
      if (!bot || bot.paused) continue;
      const sessionId = await ensureMemberSession(groupsStore.getGroup(groupId), bot, threadId);
      const operationId = `gop-plan-${crypto.randomUUID()}`;
      const quotedHistory = buildQuotedRoomHistory(historyBefore, null, { botId: bot.id, sessionId });
      stepPlans.push({ ...step, bot, sessionId, operationId, quotedHistory });
    }
    return stepPlans;
  }

  /** @param {string} groupId @param {string} threadId @param {string} messageId @param {Array<any>} stepPlans @param {number} maxConcurrency */
  function persistExecutingPlan(groupId, threadId, messageId, stepPlans, maxConcurrency) {
    groupsStore.updateMessage(messageId, (/** @type {any} */ msg) => ({
      ...msg,
      turns: [...(msg.turns ?? []), ...stepPlans.map((/** @type {any} */ p) => ({
        operationId: p.operationId, botId: p.bot.id, botName: p.bot.name, sessionId: p.sessionId,
        phase: 'execute', stepId: p.stepId, depth: p.depth, status: 'running', reply: null,
      }))],
      planGate: {
        ...msg.planGate,
        status: 'executing',
        approvedAt: Date.now(),
        maxConcurrency,
        steps: stepPlans.map((/** @type {any} */ p) => ({
          stepId: p.stepId, fromBotId: p.fromBotId, botId: p.bot.id, botName: p.bot.name,
          task: p.task, depth: p.depth, dependsOn: p.dependsOn, operationId: p.operationId,
          status: 'pending', reply: null, error: null,
        })),
      },
    }));
    for (const p of stepPlans) {
      groupsStore.enqueuePending(p.operationId, groupId, { botId: p.bot.id, threadId, phase: 'execute', stepId: p.stepId });
    }
    eventBus.emit({ kinds: ['groups'] });
  }

  /** @param {string} messageId @param {string} stepId @param {any} res */
  function recordPlanStepResult(messageId, stepId, res) {
    groupsStore.updateMessage(messageId, (/** @type {any} */ msg) => ({
      ...msg,
      planGate: {
        ...msg.planGate,
        steps: (msg.planGate?.steps ?? []).map((/** @type {any} */ s) => (
          s.stepId === stepId ? { ...s, status: res.status ?? 'done', reply: res.reply ?? null, error: res.error ?? null } : s
        )),
      },
    }));
  }

  /** @param {string | Record<string, any>} groupIdOrParams @param {string} [maybeMessageId] @param {Record<string, any>} [maybeOptions] */
  async function approveGroupPlan(groupIdOrParams, maybeMessageId = undefined, maybeOptions = {}) {
    /** @type {Record<string, any>} */
    const params = typeof groupIdOrParams === 'object' && groupIdOrParams !== null
      ? groupIdOrParams
      : { groupId: groupIdOrParams, messageId: maybeMessageId, ...(maybeOptions ?? {}) };
    const groupId = firstText(params, ['groupId', 'id']);
    const messageId = cleanStr(params.messageId);
    if (!groupId || !messageId) throw Object.assign(new Error('groupId and messageId are required'), { code: 'invalid_argument' });

    const { group, message, threadId } = findGroupMessage(groupId, messageId, params.threadId);
    const gate = message.planGate;
    if (!gate || gate.status !== 'awaiting_approval') {
      throw Object.assign(new Error(`Plan for message ${messageId} is not awaiting approval`), { code: 'invalid_state' });
    }
    const coordinatorBotId = cleanStr(gate.coordinatorBotId || group.replyMode?.coordinatorBotId);
    const coordinatorBot = botsStore.getBot(coordinatorBotId);
    if (!coordinatorBot) throw Object.assign(new Error(`Coordinator bot not found: ${coordinatorBotId}`), { code: 'not_found' });

    const validatedSteps = validatePlanSteps({
      coordinatorBotId,
      steps: Array.isArray(params.steps) ? params.steps : gate.steps,
      memberBotIds: group.botIds,
      baseDepth: Number.isInteger(gate.depth) ? gate.depth : 1,
      maxDepth: MAX_PLAN_DEPTH,
    });
    const maxConcurrency = Math.max(1, Math.min(Number(params.maxConcurrency) || MAX_PLAN_CONCURRENCY, MAX_PLAN_CONCURRENCY));
    const stepPlans = await prepareApprovedStepPlans(groupId, threadId, validatedSteps);
    persistExecutingPlan(groupId, threadId, messageId, stepPlans, maxConcurrency);

    /** @type {Array<any>} */
    const results = [];
    const imgLine = formatImageLines(message.images);
    await runDagBounded(stepPlans, maxConcurrency, async (plan) => {
      const stepPrompt = [
        `[WhaleIsle: Group "${group.name}" · Coordinator Plan Step ${plan.stepId} (depth ${plan.depth}/${MAX_PLAN_DEPTH})]`,
        plan.quotedHistory, '', `Coordinator plan:\n${gate.planText}`, '', `Your assigned task:\n${plan.task}`,
        ...(imgLine ? [imgLine] : []),
      ].join('\n');
      const res = await driveMemberReply({
        groupId, ownerMessage: message, bot: plan.bot, sessionId: plan.sessionId,
        operationId: plan.operationId, quotedHistory: plan.quotedHistory, customPrompt: stepPrompt,
      });
      results.push({ ...res, stepId: plan.stepId, botName: plan.bot.name });
      recordPlanStepResult(messageId, plan.stepId, res);
    });

    const summaryRes = await runCoordinatorSummary({ group, message, threadId, coordinatorBot, results });
    const allFailed = results.length > 0 && results.every((r) => r.status === 'error');
    const finalStatus = summaryRes.stopped ? 'stopped' : (allFailed ? 'failed' : 'completed');
    groupsStore.updateMessage(messageId, (/** @type {any} */ msg) => ({
      ...msg,
      planGate: { ...msg.planGate, status: finalStatus, summary: summaryRes.reply ?? null, completedAt: Date.now() },
    }));
    eventBus.emit({ kinds: ['groups'] });

    const refreshed = findGroupMessage(groupId, messageId, threadId).message;
    return { message: refreshed, planGate: refreshed.planGate, summary: summaryRes.reply ?? '', results };
  }

  /** @param {{ group: any, groupId: string, threadId: string, text: string, images: Array<any>, params: Record<string, any> }} input */
  async function sendCoordinatorMessage({ group, groupId, threadId, text, images, params }) {
    const coordinatorBot = botsStore.getBot(group.replyMode.coordinatorBotId);
    if (!coordinatorBot || coordinatorBot.paused) {
      throw Object.assign(new Error('Coordinator bot is unavailable or paused'), { code: 'invalid_state' });
    }
    const historyBefore = groupsStore.readMessages(groupId, { threadId, limit: 40 }).messages;
    const sessionId = await ensureMemberSession(groupsStore.getGroup(groupId), coordinatorBot, threadId);
    const opId = `gop-plan-p1-${crypto.randomUUID()}`;
    const quotedHistory = buildQuotedRoomHistory(historyBefore, null, { botId: coordinatorBot.id, sessionId });
    const appended = groupsStore.appendMessage(groupId, {
      id: params.messageId || crypto.randomUUID(),
      threadId,
      author: { kind: 'owner' },
      authorName: String(params.authorName ?? '你'),
      text,
      images,
      targetBotIds: [coordinatorBot.id],
      turns: [{ operationId: opId, botId: coordinatorBot.id, botName: coordinatorBot.name, sessionId, phase: 'plan', status: 'running', reply: null }],
      planGate: {
        status: 'planning', coordinatorBotId: coordinatorBot.id, planText: null, steps: [],
        depth: 1, maxDepth: MAX_PLAN_DEPTH, createdAt: Date.now(), approvedAt: null, completedAt: null, summary: null,
      },
    }, { operationId: opId });

    if (appended.deduplicated) return { message: appended.message, deduplicated: true, targetBotIds: [coordinatorBot.id] };
    groupsStore.enqueuePending(opId, groupId, { botId: coordinatorBot.id, threadId, phase: 'plan', quotedHistory });
    eventBus.emit({ kinds: ['groups'] });

    const job = driveCoordinatorPhase1({ group, ownerMessage: appended.message, coordinatorBot, sessionId, operationId: opId, quotedHistory });
    if (params.waitForReplies === true) {
      await job;
      return { message: findGroupMessage(groupId, appended.message.id, threadId).message, deduplicated: false, targetBotIds: [coordinatorBot.id] };
    }
    return { message: appended.message, deduplicated: false, targetBotIds: [coordinatorBot.id] };
  }

  /** @param {string} groupId @param {string} threadId @param {Array<any>} activeTargets */
  async function buildDirectDispatchPlans(groupId, threadId, activeTargets) {
    const historyBefore = groupsStore.readMessages(groupId, { threadId, limit: 40 }).messages;
    const turnsMeta = [];
    const dispatchPlans = [];
    for (const bot of activeTargets) {
      const sessionId = await ensureMemberSession(groupsStore.getGroup(groupId), bot, threadId);
      const opId = `gop-${crypto.randomUUID()}`;
      const quotedHistory = buildQuotedRoomHistory(historyBefore, null, { botId: bot.id, sessionId });
      turnsMeta.push({ operationId: opId, botId: bot.id, botName: bot.name, sessionId, status: 'running', reply: null });
      dispatchPlans.push({ bot, sessionId, operationId: opId, quotedHistory });
    }
    return { turnsMeta, dispatchPlans };
  }

  /** @param {Record<string, any>} [params] */
  async function send(params = {}) {
    const groupId = firstText(params, ['groupId', 'id']);
    const threadId = cleanStr(params.threadId);
    const text = cleanStr(params.text);
    const images = normalizeGroupImages(params.images);
    if (!text && images.length === 0) throw Object.assign(new Error('Message text or images are required'), { code: 'invalid_argument' });
    const rawGroup = groupsStore.getGroup(groupId);
    if (!rawGroup) throw Object.assign(new Error(`Group not found: ${groupId}`), { code: 'not_found' });
    const group = enrichGroup(rawGroup);

    const memberBots = (group.botIds ?? []).map((/** @type {string} */ id) => botsStore.getBot(id)).filter(Boolean);
    const explicitMentions = parseGroupMentions(text, memberBots, group.botIds ?? []).flatMap((m) => m.ids);
    if (group.replyMode?.kind === 'coordinator' && explicitMentions.length === 0) {
      return sendCoordinatorMessage({ group, groupId, threadId, text, images, params });
    }

    const targetBotIds = resolveGroupTargets(text, toSharedGroupShape(group, threadId), botsStore.listBots());
    const activeTargets = targetBotIds.map((/** @type {string} */ id) => botsStore.getBot(id)).filter((/** @type {any} */ bot) => bot && !bot.paused);
    const { turnsMeta, dispatchPlans } = await buildDirectDispatchPlans(groupId, threadId, activeTargets);

    const appended = groupsStore.appendMessage(groupId, {
      id: params.messageId || crypto.randomUUID(),
      threadId,
      author: { kind: 'owner' },
      authorName: String(params.authorName ?? '你'),
      text,
      images,
      targetBotIds: activeTargets.map((/** @type {any} */ b) => b.id),
      turns: turnsMeta,
    }, { operationId: dispatchPlans[0]?.operationId ?? null });
    if (appended.deduplicated) return { message: appended.message, deduplicated: true, targetBotIds: activeTargets.map((/** @type {any} */ b) => b.id) };

    for (const plan of dispatchPlans) {
      groupsStore.enqueuePending(plan.operationId, groupId, { botId: plan.bot.id, threadId, quotedHistory: plan.quotedHistory });
    }
    eventBus.emit({ kinds: ['groups'] });

    const jobs = dispatchPlans.map((plan) => driveMemberReply({
      groupId, ownerMessage: appended.message, bot: plan.bot,
      sessionId: plan.sessionId, operationId: plan.operationId, quotedHistory: plan.quotedHistory,
    }));
    if (params.waitForReplies === true) {
      await Promise.all(jobs);
      const refreshed = groupsStore.readMessages(groupId, { threadId, limit: 40 }).messages
        .find((/** @type {any} */ m) => m.id === appended.message.id) ?? appended.message;
      return { message: refreshed, deduplicated: false, targetBotIds: activeTargets.map((/** @type {any} */ b) => b.id) };
    }
    return { message: appended.message, deduplicated: false, targetBotIds: activeTargets.map((/** @type {any} */ b) => b.id) };
  }

  /** @param {Record<string, any>} [params] */
  function stop(params = {}) {
    const groupId = String(params.groupId ?? params.id ?? '').trim();
    const botId = params.botId ? String(params.botId).trim() : null;
    const latestMsgs = groupsStore.readMessages(groupId, { threadId: params.threadId ?? '', limit: 1 }).messages;
    const seq = Number.isInteger(params.sequence) ? params.sequence : (latestMsgs.at(-1)?.sequence ?? 0);
    const updated = groupsStore.setStoppedThrough(groupId, { botId, sequence: seq });
    if (botId) groupsStore.clearPendingForBot(groupId, botId);
    else for (const p of groupsStore.listPending(groupId)) groupsStore.deletePending(p.operationId);
    eventBus.emit({ kinds: ['groups'] });
    return { ok: true, group: enrichGroup(updated), stoppedThrough: seq };
  }

  return {
    list, create, update, delete: remove, reorder, read, newThread, send,
    approveGroupPlan, approvePlan: approveGroupPlan, stop,
  };
}
