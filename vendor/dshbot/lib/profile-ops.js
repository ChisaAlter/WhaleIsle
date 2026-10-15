import { normalizeAvatar } from './avatar.js';
import { botDisplayName, MAX_BOT_TITLE } from './bot-identity.js';
import { projectCatalog } from './catalog-scope.js';
import {
  DEFAULT_BOT_MEMORY_LIMIT,
  DEFAULT_USER_MEMORY_LIMIT,
  readBotMemory,
  readMemoryTrack,
  replaceBotMemory,
  writeMemoryTrack,
} from './memory.js';
import { eventsToGroupHistory } from './catalog.js';
import { latestWorkNote } from './memory-review.js';
import { goalViewFor } from './objective.js';
import { deleteRoutineNotepad } from './routine-notepad.js';
import {
  createSessionHygiene,
  managedPresentationForItem,
  resolveStableSession,
} from './session-hygiene.js';

const MAX_NAME = 120;
const MAX_SECTION_ID = 200;
const MAX_DESCRIPTION = 12_000;
const MAX_GROUP_MEMBERS = 6;
const MIN_GROUP_MEMBERS = 2;
const TERMINAL_TASKS = new Set(['completed', 'failed', 'cancelled']);

const fail = (message) => { throw new Error(message); };
const string = (value, max, label, required = false) => {
  const text = String(value ?? '').trim();
  if ((required && !text) || text.length > max) fail(`Invalid ${label}.`);
  return text;
};

function normalizeModel(value) {
  const provider = string(value?.provider, 200, 'model provider');
  const model = string(value?.model, 500, 'model');
  if (Boolean(provider) !== Boolean(model)) fail('Model provider and model must be selected together.');
  const reasoningEffort = string(value?.reasoningEffort, 100, 'reasoning effort');
  if (!provider && reasoningEffort) fail('Reasoning effort requires a selected model.');
  return { provider, model, reasoningEffort };
}

function normalizeCapabilities(value) {
  const group = (raw) => {
    const mode = raw?.mode === 'selected' ? 'selected' : 'all';
    const names = [...new Set((Array.isArray(raw?.names) ? raw.names : [])
      .map((name) => string(name, 300, 'capability name')).filter(Boolean))];
    return { mode, names };
  };
  return { tools: group(value?.tools), skills: group(value?.skills), mcp: group(value?.mcp) };
}

function activeBotIds(items) {
  return new Set(items.filter((item) => item.kind !== 'room').map((item) => item.id));
}

function normalizeBotDraft(input, current, catalog, now) {
  const id = current?.id ?? (string(input.id, 200, 'bot id') || crypto.randomUUID());
  const kind = current?.kind ?? (input.kind === 'room' ? 'room' : 'bot');
  const name = string(input.name, MAX_NAME, 'name', true);
  if (catalog.items.some((item) => item.id !== current?.id && item.kind === kind
    && item.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
    fail(`A ${kind === 'room' ? 'group' : 'Bot'} named "${name}" already exists.`);
  }
  const sessionId = current?.sessionId ?? (string(input.sessionId, 240, 'session id') || `session-${crypto.randomUUID()}`);
  if (!current && catalog.items.some((item) => item.id === id || item.sessionId === sessionId)) {
    fail('Bot identity already exists.');
  }
  const botIds = activeBotIds(catalog.items);
  const memberBotIds = kind === 'room'
    ? [...new Set((Array.isArray(input.memberBotIds) ? input.memberBotIds : []).map(String))]
    : [];
  if (kind === 'room' && (memberBotIds.length < MIN_GROUP_MEMBERS || memberBotIds.length > MAX_GROUP_MEMBERS
    || memberBotIds.some((memberId) => !botIds.has(memberId)))) {
    fail('Group members must contain 2-6 available Bots.');
  }
  const allowedSenderIds = kind === 'room' ? []
    : [...new Set((Array.isArray(input.allowedSenderIds) ? input.allowedSenderIds : []).map(String))];
  if (allowedSenderIds.some((senderId) => senderId === id || !botIds.has(senderId))) {
    fail('Message and task sources must be available peer Bots.');
  }
  const titleInput = current && !Object.hasOwn(input, 'title') ? current.title : input.title;
  const title = kind === 'room' ? '' : string(titleInput, MAX_BOT_TITLE, 'title');
  const sectionId = string(current?.sectionId ?? input.sectionId, MAX_SECTION_ID, 'section id');
  if (sectionId && !(catalog.sections ?? []).some((section) => section.id === sectionId)) {
    fail('Section is unavailable.');
  }
  const maxRounds = kind === 'room' ? Number(input.maxRounds) : (current?.maxRounds ?? 3);
  const maxSpeaks = kind === 'room' ? Number(input.maxSpeaks) : (current?.maxSpeaks ?? 10);
  if (kind === 'room' && (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 3
    || !Number.isInteger(maxSpeaks) || maxSpeaks < 1 || maxSpeaks > 10)) {
    fail('Group limits are invalid.');
  }
  const objective = kind === 'room' ? ''
    : string(Object.hasOwn(input, 'objective') ? input.objective : current?.objective, 2_000, 'objective');
  const objectiveMaxRounds = kind === 'room' ? 16
    : Number(Object.hasOwn(input, 'objectiveMaxRounds') ? input.objectiveMaxRounds : current?.objectiveMaxRounds ?? 16);
  if (kind !== 'room' && (!Number.isInteger(objectiveMaxRounds)
    || objectiveMaxRounds < 1 || objectiveMaxRounds > 200)) {
    fail('Objective round cap is invalid.');
  }
  const memoryReview = kind === 'room' ? true
    : Object.hasOwn(input, 'memoryReview') ? input.memoryReview !== false : current?.memoryReview !== false;
  const notify = kind === 'room' ? true
    : Object.hasOwn(input, 'notify') ? input.notify !== false : current?.notify !== false;
  return {
    ...(current ?? {}), id, kind,
    sessionId,
    name,
    title,
    sectionId,
    description: string(input.description, MAX_DESCRIPTION, 'description'),
    avatar: normalizeAvatar(input.avatar, id),
    workspaceId: string(input.workspaceId, 2_000, 'workspace id'),
    model: kind === 'room' ? { provider: '', model: '', reasoningEffort: '' } : normalizeModel(input.model),
    pinned: current?.pinned === true,
    hidden: current?.hidden === true,
    pinOrder: Number(current?.pinOrder) || 0,
    allowedSenderIds,
    memberBotIds,
    objective,
    objectiveMaxRounds,
    memoryReview,
    notify,
    capabilities: kind === 'room' ? (current?.capabilities ?? normalizeCapabilities())
      : normalizeCapabilities(input.capabilities),
    maxRounds,
    maxSpeaks,
    inbox: current?.inbox ?? [],
    readInitialized: current ? current.readInitialized === true : true,
    lastSeenSeq: current ? Math.max(0, Number(current.lastSeenSeq) || 0) : 0,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };
}

function presentation(item) {
  return managedPresentationForItem(item);
}

function duplicateName(source, catalog) {
  const names = new Set(catalog.items.filter((item) => item.kind === source.kind)
    .map((item) => item.name.trim().toLocaleLowerCase()));
  for (let number = 2; number < 100; number++) {
    const suffix = `-${number}`;
    const candidate = `${source.name.slice(0, MAX_NAME - suffix.length)}${suffix}`;
    if (!names.has(candidate.toLocaleLowerCase())) return candidate;
  }
  fail('No free name is available for the duplicate.');
}

function contentText(content) {
  const parts = [];
  for (const block of Array.isArray(content) ? content : []) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    if (block?.type === 'tool-result') parts.push(contentText(block.content));
    if ((block?.type === 'image' || block?.type === 'file') && block.attachment) {
      const name = block.attachment.name ? `: ${block.attachment.name}` : '';
      parts.push(block.type === 'image' ? '[Image]' : `[File${name}]`);
    }
  }
  return parts.join('').trim();
}

function compactPreview(value, maximum = 240) {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
  const points = [...text];
  return points.length <= maximum ? text : `${points.slice(0, maximum - 1).join('')}…`;
}

function directPreview(events) {
  const list = events ?? [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const event = list[index];
    if (event?.type === 'assistant/message') {
      const text = contentText(event.data?.message?.content ?? event.data?.content);
      if (text) return text;
    }
    if (event?.type === 'user/message') {
      const source = event.data?.source;
      if (source?.kind !== 'user' && source?.kind !== 'agent-message') continue;
      const text = contentText(event.data?.content);
      if (text) return text;
    }
  }
  return '';
}

/** Turns whose terminal routine run was silent must not surface as activity. */
function silentTurnsFor(item, routines) {
  const turns = new Set();
  if (item.kind === 'room') return turns;
  for (const routine of routines ?? []) {
    if (routine.botId !== item.id) continue;
    for (const run of routine.runHistory ?? []) {
      if (run.silent === true && run.sessionId === item.sessionId && Number.isInteger(run.turn)) {
        turns.add(run.turn);
      }
    }
  }
  return turns;
}

/** An asked approval/question with no recorded decision needs attention. */
function pendingAttention(events) {
  const open = new Set();
  for (const event of events ?? []) {
    const type = event?.type;
    const id = String(event?.data?.id ?? event?.data?.requestId ?? '');
    if (!id) continue;
    if (type === 'approval/asked' || type === 'user-questions/asked') open.add(id);
    else if (type === 'approval/decided' || type === 'user-questions/answered') open.delete(id);
  }
  return open.size > 0;
}

/** The bot's latest routine run across its catalog routines, or null. */
function lastRoutineRun(item, routines) {
  if (item.kind === 'room') return null;
  let latest = null;
  for (const routine of routines ?? []) {
    if (routine.botId !== item.id) continue;
    for (const run of routine.runHistory ?? []) {
      const endedAt = Number(run.endedAt) || Number(run.startedAt) || Number(run.createdAt) || 0;
      if (latest && endedAt <= latest.endedAt) continue;
      latest = {
        routineId: String(routine.id ?? ''),
        runId: String(run.runId ?? ''),
        name: String(routine.name ?? ''),
        status: String(run.status ?? ''),
        silent: run.silent === true,
        endedAt,
      };
    }
  }
  return latest;
}

function activityFor(item, events, items, goal = null, routines = []) {
  const silentTurns = silentTurnsFor(item, routines);
  const list = silentTurns.size
    ? (events ?? []).filter((event) => !silentTurns.has(Number(event?.data?.turn)))
    : (events ?? []);
  const activity = [...list].reverse().find((event) => event?.type === 'turn/end'
    || event?.type === 'assistant/message' || event?.type === 'user/message' || event?.type === 'tool/result');
  const latest = item.kind === 'room' ? eventsToGroupHistory(list, items).at(-1) : undefined;
  const preview = item.kind === 'room'
    ? latest ? `${latest.speaker.kind === 'member' ? `${latest.speaker.name}: ` : ''}${latest.content}` : ''
    : directPreview(list);
  const lastRun = lastRoutineRun(item, routines);
  return {
    botId: item.id,
    sessionId: item.sessionId,
    activitySeq: Number.isInteger(activity?.seq) ? activity.seq : 0,
    activityAt: Number(activity?.time) || 0,
    preview: compactPreview(preview),
    readInitialized: item.readInitialized === true,
    lastSeenSeq: Number(item.lastSeenSeq) || 0,
    goal,
    attention: pendingAttention(list),
    lastRun,
    // The B-5 work ring is freshest but process-local; the durable latest run
    // covers restarts and quiet bots.
    workSummary: latestWorkNote(item.id)
      || (lastRun && lastRun.silent !== true ? `${lastRun.name}: ${lastRun.status}` : ''),
  };
}

/** Goal row for bot/activity; cold agents keep goal state out of the report. */
function goalActivity(ctx, item) {
  if (item.kind === 'room') return null;
  const agent = ctx.agents?.get?.(item.sessionId);
  if (!agent) return null;
  const goal = goalViewFor(ctx, agent);
  if (!goal) return null;
  return {
    phase: String(goal.phase ?? ''),
    activation: String(goal.activation ?? ''),
    roundsStarted: Number(goal.roundsStarted) || 0,
    maxGoalRounds: Number(goal.maxGoalRounds) || 0,
    blocker: goal.blockedReason
      ? { code: String(goal.blockedReason.code ?? ''), message: String(goal.blockedReason.message ?? '') }
      : null,
  };
}

function createRequest(item, input) {
  return {
    sessionId: item.sessionId,
    ...(item.kind === 'room' ? { agentPreset: 'dshbot-room' } : {}),
    ...(item.workspaceId ? { workspaceId: item.workspaceId }
      : { cwd: string(input.scratchCwd, 2_000, 'scratch directory', true) }),
    presentation: presentation(item),
  };
}

async function validateModel(ctx, item) {
  if (item.kind === 'room') return;
  const selected = item.model.provider
    ? item.model
    : ctx.get?.('agentDefaultModel')?.currentSelection?.();
  if (!selected?.provider || !selected?.model) {
    fail('No application default model is configured for this Bot. Select a Bot model first.');
  }
  await ctx.llm.resolveCallConfig({
    provider: selected.provider,
    model: selected.model,
    ...(selected.reasoningEffort ? { reasoningEffort: selected.reasoningEffort } : {}),
  });
}

async function validateCapabilities(discover, item) {
  if (item.kind === 'room') return;
  const selectedGroups = ['tools', 'skills', 'mcp'].filter((group) => item.capabilities[group].mode === 'selected');
  if (!selectedGroups.length) return;
  const available = await discover(item.id);
  for (const group of selectedGroups) {
    if (group === 'skills' && available.skillsAvailable === false && item.capabilities.skills.names.length) {
      fail('Skills are unavailable, so selected Skills cannot be saved.');
    }
    const names = new Set((available[group] ?? []).map((entry) => entry.name));
    const missing = item.capabilities[group].names.filter((name) => !names.has(name));
    if (missing.length) fail(`Unknown ${group}: ${missing.join(', ')}`);
  }
}

function dependencies(catalog, item) {
  const groups = catalog.items.filter((candidate) => candidate.kind === 'room'
    && candidate.memberBotIds?.includes(item.id));
  const routines = (catalog.routines ?? []).filter((routine) => routine.botId === item.id);
  const tasks = (catalog.tasks ?? []).filter((task) =>
    !TERMINAL_TASKS.has(task.status) && (task.fromId === item.id || task.toId === item.id));
  const sources = catalog.items.filter((candidate) => candidate.kind !== 'room'
    && candidate.allowedSenderIds?.includes(item.id));
  return { groups, routines, tasks, sources };
}

function cascadeDelete(catalog, item, at) {
  const removedRooms = new Set();
  const removedRoutineIds = new Set((catalog.routines ?? [])
    .filter((routine) => routine.botId === item.id).map((routine) => routine.id));
  const cancelledTaskIds = new Set((catalog.tasks ?? [])
    .filter((task) => !TERMINAL_TASKS.has(task.status) && (task.fromId === item.id || task.toId === item.id))
    .map((task) => task.id));
  const items = catalog.items.flatMap((candidate) => {
    if (candidate.id === item.id) return [];
    if (candidate.kind === 'room' && candidate.memberBotIds?.includes(item.id)) {
      const memberBotIds = candidate.memberBotIds.filter((id) => id !== item.id);
      if (memberBotIds.length < MIN_GROUP_MEMBERS) {
        removedRooms.add(candidate.id);
        return [];
      }
      return [{ ...candidate, memberBotIds, updatedAt: at,
        inbox: candidate.inbox.filter((mail) => !cancelledTaskIds.has(mail.taskId)
          && !removedRoutineIds.has(mail.routineId)) }];
    }
    if (candidate.kind !== 'room' && candidate.allowedSenderIds?.includes(item.id)) {
      return [{ ...candidate, allowedSenderIds: candidate.allowedSenderIds.filter((id) => id !== item.id), updatedAt: at,
        inbox: candidate.inbox.filter((mail) => !cancelledTaskIds.has(mail.taskId)
          && !removedRoutineIds.has(mail.routineId)) }];
    }
    return [{ ...candidate, inbox: candidate.inbox.filter((mail) => !cancelledTaskIds.has(mail.taskId)
      && !removedRoutineIds.has(mail.routineId)) }];
  });
  const tasks = (catalog.tasks ?? []).map((task) => {
    if (TERMINAL_TASKS.has(task.status) || (task.fromId !== item.id && task.toId !== item.id)) return task;
    return { ...task, status: 'cancelled', error: 'Bot profile was removed.', updatedAt: at,
      events: [...task.events, { type: 'cancelled', actorId: 'user', detail: 'Bot profile removed', at }] };
  });
  return {
    ...catalog,
    items,
    tasks,
    routines: (catalog.routines ?? []).filter((routine) => routine.botId !== item.id),
    audit: [...(catalog.audit ?? []), { id: crypto.randomUUID(), type: 'bot.deleted', taskId: '',
      fromId: 'user', toId: item.id, detail: `Removed ${botDisplayName(item)}; preserved Session history.`, at }].slice(-200),
    removedRooms,
  };
}

/** Host-owned Bot profile lifecycle; settings and Session identity change as one command. */
export function createProfileOperations(ctx, scope, {
  now = Date.now,
  capabilities = async () => ({ tools: [], skills: [], mcp: [], skillsAvailable: false }),
  stop = async () => {},
  sessionHygiene = null,
  memoryLimits,
  objective = null,
} = {}) {
  const hygiene = sessionHygiene ?? createSessionHygiene(ctx);
  const controller = () => {
    try {
      const service = ctx.get?.('sessionController') ?? ctx.sessionController;
      if (service) return service;
    } catch {
      // Normalize optional Cordis service lookup failures below.
    }
    return fail('Session Controller is unavailable.');
  };
  const memoryLimit = (track) => {
    const configured = Number(memoryLimits?.[track]);
    if (Number.isFinite(configured) && configured > 0) return Math.floor(configured);
    return track === 'user' ? DEFAULT_USER_MEMORY_LIMIT : DEFAULT_BOT_MEMORY_LIMIT;
  };
  const checkRevision = (revision) => {
    if (ctx.settings.writable === false) fail('Bot catalog is read-only.');
    const descriptor = ctx.settings.describe().find((entry) => entry.ns === 'dsh-bot');
    if (!Number.isInteger(revision) || descriptor?.revision !== revision) fail('Bot catalog changed. Refresh and try again.');
  };
  const currentView = () => {
    const descriptor = ctx.settings.describe().find((entry) => entry.ns === 'dsh-bot') ?? fail('Bot catalog is unavailable.');
    return { ns: 'dsh-bot', revision: descriptor.revision, value: descriptor.value,
      autoGenerate: descriptor.autoGenerate ?? false,
      schema: descriptor.schema ?? {}, applies: descriptor.applies ?? 'live', secrets: [] };
  };

  // session.create now means a new conversation, not adoption of a non-blank
  // identity. Restore existing Bot bindings explicitly so their history and
  // composition stay on the Session the caller selected.
  const ensureProfileSession = async (item, input) => {
    const service = controller();
    const request = createRequest(item, input);
    const resolved = await service.resolveAgent(item.sessionId);
    if (resolved.error) {
      if (resolved.error.code !== 'session/not-found') throw resolved.error;
      return service.create(request);
    }
    const workspace = request.workspaceId
      ? (ctx.get?.('workspaceRegistry') ?? ctx.workspaceRegistry)?.get(request.workspaceId)
      : undefined;
    if (request.workspaceId && !workspace) fail(`Workspace is unavailable: ${request.workspaceId}`);
    const cwd = workspace?.path ?? request.cwd;
    if (resolved.agent.session.header.cwd !== cwd) {
      fail(`Session "${item.sessionId}" belongs to "${resolved.agent.session.header.cwd}", not "${cwd}".`);
    }
    if (request.agentPreset !== undefined) {
      const projections = ctx.get?.('sessionProjections') ?? ctx.sessionProjections;
      const existingPreset = projections.stateOf(resolved.agent.session, 'agentPreset');
      if (existingPreset !== request.agentPreset) {
        fail(`Session "${item.sessionId}" does not run agent preset "${request.agentPreset}".`);
      }
    }
    if (workspace) await workspace.attachSession(item.sessionId);
    await service.setPresentation({ sessionId: item.sessionId, presentation: request.presentation });
    return { sessionId: item.sessionId };
  };

  const bindCreatedSession = async (item, result) => {
    const sessionId = string(result.sessionId, 240, 'created session id', true);
    if (sessionId === item.sessionId) return item;
    const bound = { ...item, sessionId };
    await projectCatalog(scope, (latest) => ({ ...latest,
      items: latest.items.map((candidate) => candidate.id === item.id && candidate.sessionId === item.sessionId
        ? { ...candidate, sessionId } : candidate),
    }));
    return bound;
  };

  const sectionById = (catalog, id) => (catalog.sections ?? []).find((section) => section.id === id);
  const sectionNameKey = (name) => String(name ?? '').trim().toLocaleLowerCase();
  const ensureSectionNameAvailable = (catalog, name, exceptId = '') => {
    const key = sectionNameKey(name);
    if ((catalog.sections ?? []).some((section) => section.id !== exceptId
      && sectionNameKey(section.name) === key)) {
      fail(`A section named "${name}" already exists.`);
    }
  };
  const sectionSnapshot = (catalog, section, index) => ({
    section: structuredClone(section),
    index,
    memberIds: catalog.items
      .filter((item) => item.sectionId === section.id)
      .map((item) => item.id),
  });

  const sectionCreate = async (input) => {
    checkRevision(input.revision);
    const previous = scope.get();
    const name = string(input.name, MAX_NAME, 'section name', true);
    ensureSectionNameAvailable(previous, name);
    const id = string(input.id, MAX_SECTION_ID, 'section id') || `section-${crypto.randomUUID()}`;
    if (sectionById(previous, id)) {
      fail('Section identity already exists.');
    }
    const at = now();
    const section = { id, name, createdAt: at, updatedAt: at };
    await scope.set({ ...previous, sections: [...(previous.sections ?? []), section] }, previous);
    return { view: currentView(), section };
  };

  const sectionRename = async (input) => {
    checkRevision(input.revision);
    const previous = scope.get();
    const id = string(input.id, MAX_SECTION_ID, 'section id', true);
    const current = sectionById(previous, id) ?? fail('Section is unavailable.');
    const name = string(input.name, MAX_NAME, 'section name', true);
    ensureSectionNameAvailable(previous, name, current.id);
    const section = { ...current, name, updatedAt: now() };
    await scope.set({ ...previous,
      sections: previous.sections.map((entry) => entry.id === current.id ? section : entry),
    }, previous);
    return { view: currentView(), section };
  };

  const sectionMove = async (input) => {
    checkRevision(input.revision);
    const previous = scope.get();
    const id = string(input.id, MAX_SECTION_ID, 'section id', true);
    const delta = Number(input.delta);
    if (![-1, 1].includes(delta)) fail('Section move delta must be -1 or +1.');
    const sections = [...(previous.sections ?? [])];
    const index = sections.findIndex((section) => section.id === id);
    if (index < 0) fail('Section is unavailable.');
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= sections.length) {
      return { view: currentView(), section: sections[index], index };
    }
    const [section] = sections.splice(index, 1);
    const moved = { ...section, updatedAt: now() };
    sections.splice(targetIndex, 0, moved);
    await scope.set({ ...previous, sections }, previous);
    return { view: currentView(), section: moved, index: targetIndex };
  };

  const sectionAssign = async (input) => {
    checkRevision(input.revision);
    const previous = scope.get();
    const itemId = string(input.itemId, 200, 'item id', true);
    const sectionId = string(input.sectionId, MAX_SECTION_ID, 'section id');
    const current = previous.items.find((item) => item.id === itemId) ?? fail('Item is unavailable.');
    if (sectionId && !sectionById(previous, sectionId)) fail('Section is unavailable.');
    if ((current.sectionId ?? '') === sectionId) return { view: currentView(), item: current };
    const item = { ...current, sectionId, updatedAt: now() };
    await scope.set({ ...previous,
      items: previous.items.map((entry) => entry.id === item.id ? item : entry),
    }, previous);
    return { view: currentView(), item };
  };

  const sectionDelete = async (input) => {
    checkRevision(input.revision);
    const previous = scope.get();
    const id = string(input.id, MAX_SECTION_ID, 'section id', true);
    const index = (previous.sections ?? []).findIndex((section) => section.id === id);
    if (index < 0) fail('Section is unavailable.');
    const section = previous.sections[index];
    const snapshot = sectionSnapshot(previous, section, index);
    const at = now();
    const items = previous.items.map((item) => item.sectionId === id
      ? { ...item, sectionId: '', updatedAt: at }
      : item);
    await scope.set({ ...previous,
      sections: previous.sections.filter((entry) => entry.id !== id),
      items,
    }, previous);
    return { view: currentView(), snapshot };
  };

  const sectionRestore = async (input) => {
    checkRevision(input.revision);
    const previous = scope.get();
    const snapshot = input.snapshot;
    const section = snapshot?.section;
    const id = string(section?.id, MAX_SECTION_ID, 'section id', true);
    const name = string(section?.name, MAX_NAME, 'section name', true);
    if (sectionById(previous, id)) {
      fail('Section identity already exists.');
    }
    ensureSectionNameAvailable(previous, name);
    if (!Number.isFinite(Number(section.createdAt)) || !Number.isFinite(Number(section.updatedAt))) {
      fail('Section snapshot is invalid.');
    }
    if (!Number.isInteger(snapshot?.index) || snapshot.index < 0) {
      fail('Section snapshot position is invalid.');
    }
    if (!Array.isArray(snapshot?.memberIds)) fail('Section snapshot is invalid.');
    const memberIds = [...new Set(snapshot.memberIds.map(String).filter(Boolean))];
    const restoredSection = {
      id,
      name,
      createdAt: Number(section.createdAt),
      updatedAt: Number(section.updatedAt),
    };
    const sections = [...(previous.sections ?? [])];
    sections.splice(Math.min(snapshot.index, sections.length), 0, restoredSection);
    const members = new Set(memberIds);
    const at = now();
    const items = previous.items.map((item) => members.has(item.id)
      ? { ...item, sectionId: id, updatedAt: at }
      : item);
    await scope.set({ ...previous, sections, items }, previous);
    return {
      view: currentView(),
      section: restoredSection,
      restoredMemberIds: previous.items.filter((item) => members.has(item.id)).map((item) => item.id),
    };
  };

  const create = async (input) => {
      checkRevision(input.revision);
      const previous = scope.get();
      let item = normalizeBotDraft(input, undefined, previous, now());
      await validateCapabilities(capabilities, item);
      await validateModel(ctx, item);
      const auditId = crypto.randomUUID();
      const audit = [...(previous.audit ?? []), { id: auditId, type: 'bot.created', taskId: '',
        fromId: 'user', toId: item.id, detail: `Created ${botDisplayName(item)}.`, at: item.updatedAt }].slice(-200);
      await scope.set({ ...previous, items: [...previous.items, item], audit }, previous);
      try {
        item = await bindCreatedSession(item, await ensureProfileSession(item, input));
      } catch (error) {
        try {
          await projectCatalog(scope, (latest) => ({ ...latest,
            items: latest.items.filter((candidate) => !(candidate.id === item.id && candidate.sessionId === item.sessionId)),
            audit: (latest.audit ?? []).filter((entry) => entry.id !== auditId),
          }));
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError],
            `Bot Session creation failed and catalog rollback also failed: ${String(error.message ?? error)}`);
        }
        throw error;
      }
      if (item.kind !== 'room') objective?.requestSync?.(item);
      return { view: currentView(), item, sessionId: item.sessionId };
  };

  return {
    create,
    sectionCreate,
    sectionRename,
    sectionMove,
    sectionAssign,
    sectionDelete,
    sectionRestore,

    async open(input) {
      const catalog = scope.get();
      const id = string(input.id, 200, 'bot id', true);
      const item = catalog.items.find((candidate) => candidate.id === id)
        ?? fail('Bot profile is unavailable.');
      const presentation = managedPresentationForItem(item);
      const result = await resolveStableSession({
        sessionId: item.sessionId,
        presentation,
        lookup: () => controller().list({}),
        create: () => ensureProfileSession(item, input),
      });
      await controller().setPresentation({ sessionId: item.sessionId, presentation });
      return {
        item,
        sessionId: item.sessionId,
        created: result.action === 'created',
      };
    },

    async update(input) {
      checkRevision(input.revision);
      const previous = scope.get();
      const current = previous.items.find((item) => item.id === input.id) ?? fail('Bot profile is unavailable.');
      let next = normalizeBotDraft(input, current, previous, now());
      await validateCapabilities(capabilities, next);
      await validateModel(ctx, next);
      if ((current.workspaceId || '') !== (next.workspaceId || '')) {
        const inspection = typeof controller().inspect === 'function'
          ? await controller().inspect(current.sessionId)
          : await controller().resolveAgent(current.sessionId).then((result) => {
            if (result.error) throw result.error;
            return { events: result.agent.session.snapshotEvents() };
          });
        if ((inspection.events ?? []).some((event) => event.type === 'user/message')) {
          fail('A Bot with conversation history cannot change workspace. Duplicate it instead.');
        }
        next.sessionId = `session-${crypto.randomUUID()}`;
      }
      const nextCatalog = { ...previous,
        items: previous.items.map((item) => item.id === next.id ? next : item),
        audit: [...(previous.audit ?? []), { id: crypto.randomUUID(), type: 'bot.updated', taskId: '',
          fromId: 'user', toId: next.id, detail: `Updated ${botDisplayName(next)}.`, at: next.updatedAt }].slice(-200) };
      const oldPresentation = presentation(current);
      const warnings = [];
      if (next.sessionId === current.sessionId) {
        await controller().setPresentation({ sessionId: current.sessionId, presentation: presentation(next) });
        try {
          await scope.set(nextCatalog, previous);
        } catch (error) {
          try {
            await controller().setPresentation({ sessionId: current.sessionId, presentation: oldPresentation });
          } catch (rollbackError) {
            throw new AggregateError([error, rollbackError],
              `Bot update failed and Session presentation rollback also failed: ${String(error.message ?? error)}`);
          }
          throw error;
        }
      } else {
        await scope.set(nextCatalog, previous);
        try {
          next = await bindCreatedSession(next, await ensureProfileSession(next, input));
        } catch (error) {
          await projectCatalog(scope, (latest) => ({ ...latest, items: latest.items.map((item) =>
            item.id === next.id && item.sessionId === next.sessionId ? { ...current, inbox: item.inbox } : item) }));
          throw error;
        }
        try {
          await controller().setPresentation({ sessionId: current.sessionId, presentation: null });
        } catch (error) {
          warnings.push(`The old Session remains visible until cleanup succeeds: ${String(error.message ?? error)}`);
        }
      }
      try {
        await controller().rename?.({ sessionId: next.sessionId, title: botDisplayName(next) });
      } catch (error) {
        warnings.push(`Bot profile was saved, but the Session title could not be renamed: ${String(error.message ?? error)}`);
      }
      // The catalog stays authoritative: live bots sync now, cold bots sync on
      // their next live idle — this path never resolves a cold agent.
      if (next.kind !== 'room') objective?.requestSync?.(next);
      return { view: currentView(), item: next, sessionId: next.sessionId, warnings };
    },

    async duplicate(input) {
      checkRevision(input.revision);
      const catalog = scope.get();
      const source = catalog.items.find((item) => item.id === input.id) ?? fail('Bot profile is unavailable.');
      const result = await create({
        ...source,
        revision: input.revision,
        id: crypto.randomUUID(),
        sessionId: `session-${crypto.randomUUID()}`,
        name: string(input.name || duplicateName(source, catalog), MAX_NAME, 'name', true),
        scratchCwd: input.scratchCwd,
        inbox: [],
      });
      if (source.kind !== 'room') {
        const home = process.env.DSH_HOME || process.env.DSHD_HOME || '';
        const memory = readBotMemory(home, source.id);
        if (memory) {
          try { replaceBotMemory(home, result.item.id, memory); }
          catch (error) {
            result.warnings = [`Bot was duplicated, but memory copy failed: ${String(error.message ?? error)}`];
          }
        }
      }
      return result;
    },

    previewDelete(input) {
      const catalog = scope.get();
      const item = catalog.items.find((candidate) => candidate.id === input.id) ?? fail('Bot profile is unavailable.');
      const found = dependencies(catalog, item);
      return { item: { id: item.id, name: botDisplayName(item), kind: item.kind }, dependencies: {
        groups: found.groups.map((group) => ({ id: group.id, name: botDisplayName(group),
          removed: group.memberBotIds.length <= MIN_GROUP_MEMBERS })),
        routines: found.routines.map((routine) => ({ id: routine.id, name: routine.name })),
        tasks: found.tasks.map((task) => ({ id: task.id, status: task.status })),
        sources: found.sources.map((bot) => ({ id: bot.id, name: botDisplayName(bot) })),
      }, preserves: ['conversation-history', 'memory'] };
    },

    async delete(input) {
      checkRevision(input.revision);
      if (input.confirmCascade !== true) fail('Delete requires an explicit dependency confirmation.');
      const previous = scope.get();
      const item = previous.items.find((candidate) => candidate.id === input.id) ?? fail('Bot profile is unavailable.');
      const next = cascadeDelete(previous, item, now());
      const removed = [item, ...[...next.removedRooms].map((roomId) =>
        previous.items.find((candidate) => candidate.id === roomId)).filter(Boolean)];
      delete next.removedRooms;
      const deletionEntries = hygiene.deletionEntries({
        deletedItem: item,
        catalogItems: previous.items,
        removedItems: removed,
      });
      const warnings = [];
      for (const target of removed) {
        try { await stop(target); } catch (error) {
          warnings.push(`Could not stop ${botDisplayName(target)}: ${String(error.message ?? error)}`);
        }
      }
      const released = await hygiene.releasePresentations(deletionEntries);
      for (const failure of released.failures) {
        warnings.push(`Could not release ${failure.entry.role ?? 'managed'} Session ${failure.entry.sessionId}: ${String(failure.error?.message ?? failure.error)}`);
      }
      try {
        await scope.set(next, previous);
      } catch (error) {
        const restored = await hygiene.restorePresentations(released.released);
        if (restored.failures.length) {
          throw new AggregateError([error, ...restored.failures.map((failure) => failure.error)],
            `Bot deletion failed and Session presentation rollback also failed: ${String(error.message ?? error)}`);
        }
        throw error;
      }
      const home = process.env.DSH_HOME || process.env.DSHD_HOME || '';
      for (const routine of (previous.routines ?? []).filter((row) => row.botId === item.id)) {
        try {
          deleteRoutineNotepad(home, routine.id);
        } catch (error) {
          warnings.push(`Could not remove routine notepad ${routine.id}: ${String(error.message ?? error)}`);
        }
      }
      return { view: currentView(), removed: item.id, preservedHistory: true, preservedMemory: true, warnings };
    },

    async activity(input = {}) {
      const catalog = scope.get();
      const requested = Array.isArray(input.ids) ? [...new Set(input.ids.map(String))] : [];
      if (requested.length > 200) fail('Too many Bot activity rows requested.');
      const items = requested.length > 0
        ? requested.map((id) => catalog.items.find((item) => item.id === id) ?? fail(`Bot is unavailable: ${id}`))
        : catalog.items;
      const entries = await Promise.all(items.map(async (item) => {
        const goal = goalActivity(ctx, item);
        try {
          const inspection = await controller().inspect(item.sessionId);
          return activityFor(item, inspection.events ?? [], catalog.items, goal, catalog.routines);
        } catch (error) {
          return { ...activityFor(item, [], catalog.items, goal, catalog.routines), error: String(error.message ?? error) };
        }
      }));
      return { entries };
    },

    async markRead(input = {}) {
      const marks = Array.isArray(input.marks) ? input.marks : [];
      if (marks.length === 0 || marks.length > 200) fail('Read markers are invalid.');
      const byId = new Map(marks.map((mark) => {
        const id = String(mark?.id ?? '');
        const throughSeq = Number(mark?.throughSeq);
        if (!id || !Number.isInteger(throughSeq) || throughSeq < 0) fail('Read marker is invalid.');
        return [id, throughSeq];
      }));
      await projectCatalog(scope, (catalog) => {
        let changed = false;
        const items = catalog.items.map((item) => {
          const throughSeq = byId.get(item.id);
          if (throughSeq === undefined) return item;
          const lastSeenSeq = Math.max(Number(item.lastSeenSeq) || 0, throughSeq);
          if (item.readInitialized === true && lastSeenSeq === item.lastSeenSeq) return item;
          changed = true;
          return { ...item, readInitialized: true, lastSeenSeq };
        });
        for (const id of byId.keys()) {
          if (!catalog.items.some((item) => item.id === id)) fail(`Bot is unavailable: ${id}`);
        }
        return changed ? { ...catalog, items } : catalog;
      });
      return { view: currentView() };
    },

    memoryGet(input) {
      const catalog = scope.get();
      const item = catalog.items.find((candidate) => candidate.id === input.id && candidate.kind !== 'room')
        ?? fail('Bot profile is unavailable.');
      const home = process.env.DSH_HOME || process.env.DSHD_HOME || '';
      return {
        botId: item.id,
        bot: readMemoryTrack(home, item.id, 'bot'),
        user: readMemoryTrack(home, item.id, 'user'),
        limits: { bot: memoryLimit('bot'), user: memoryLimit('user') },
      };
    },

    memoryReplace(input) {
      const catalog = scope.get();
      const item = catalog.items.find((candidate) => candidate.id === input.id && candidate.kind !== 'room')
        ?? fail('Bot profile is unavailable.');
      const track = input.track === 'user' ? 'user' : 'bot';
      const text = String(input.text ?? '');
      if (typeof input.memoryRevision !== 'string' || !input.memoryRevision) {
        fail('Bot memory revision is required. Refresh and try again.');
      }
      const state = writeMemoryTrack(
        process.env.DSH_HOME || process.env.DSHD_HOME || '', item.id, track, text,
        { expectedRevision: input.memoryRevision, limits: { [track]: memoryLimit(track) } },
      );
      return { view: currentView(), botId: item.id, track, ...state, memoryRevision: state.revision };
    },
  };
}
