// Granular `bots:changed` scope helpers and complete `bots.*` runtime RPC method catalog.

/** 11 granular `bots:changed` scope kinds. */
export const BOT_CHANGE_KINDS = Object.freeze([
  'bot',
  'chats',
  'status',
  'workers',
  'automations',
  'threads',
  'lookAround',
  'groups',
  'access',
  'settings',
  'items',
]);

export const BOT_WORK_KINDS = Object.freeze([
  'bot',
  'chats',
  'status',
  'workers',
  'automations',
  'threads',
  'lookAround',
]);

export const BOT_VIEW_KINDS = Object.freeze([...BOT_WORK_KINDS, 'settings']);

export function botChangeConcerns(scope, interest) {
  if (!scope) {
    return true;
  }
  const known = new Set(BOT_CHANGE_KINDS);
  const kinds = scope.kinds && scope.kinds.length > 0
    ? scope.kinds.filter((kind) => !known.has(kind) || interest.kinds.includes(kind))
    : null;
  if (kinds?.length === 0) {
    return false;
  }
  const { botId } = interest;
  if (!botId) {
    return true;
  }
  const botsOf = (kind) => (scope.kindBots ? scope.kindBots[kind] : scope.botIds);
  return kinds
    ? kinds.some((kind) => botsOf(kind)?.includes(botId) ?? true)
    : (scope.botIds?.includes(botId) ?? true);
}

export function botChangeBotIds(scope, kinds) {
  if (!scope?.kindBots || !scope.kinds?.length) {
    return scope?.botIds ?? null;
  }
  const known = new Set(BOT_CHANGE_KINDS);
  const ids = new Set();
  for (const kind of scope.kinds) {
    if (known.has(kind) && !kinds.includes(kind)) {
      continue;
    }
    const bots = scope.kindBots[kind];
    if (!bots) {
      return null;
    }
    bots.forEach((id) => ids.add(id));
  }
  return [...ids];
}

const ANY_KIND = '*';

export function addBotChange(pending, scope) {
  const kinds = scope.kinds && scope.kinds.length > 0 ? scope.kinds : [ANY_KIND];
  for (const kind of kinds) {
    const bots = pending.get(kind);
    if (!scope.botIds) {
      pending.set(kind, null);
    } else if (bots === undefined) {
      pending.set(kind, new Set(scope.botIds));
    } else if (bots !== null) {
      scope.botIds.forEach((id) => bots.add(id));
    }
  }
}

export function botChangeNotice(pending) {
  const entries = [...pending];
  const allScoped = entries.every(([, bots]) => bots !== null);
  const botIds = allScoped ? [...new Set(entries.flatMap(([, bots]) => [...(bots ?? [])]))] : null;
  if (pending.has(ANY_KIND)) {
    return botIds ? { botIds } : {};
  }
  const kinds = entries.map(([kind]) => kind).filter((kind) => kind !== ANY_KIND);
  const scoped = entries.flatMap(([kind, bots]) => (kind !== ANY_KIND && bots ? [[kind, [...bots]]] : []));
  const sameBots = allScoped && scoped.every(([, bots]) => bots.length === botIds?.length);
  return {
    ...(botIds ? { botIds } : {}),
    kinds,
    ...(sameBots || scoped.length === 0 ? {} : { kindBots: Object.fromEntries(scoped) }),
  };
}

function readKindBots(value) {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const out = {};
  for (const [kind, bots] of Object.entries(value)) {
    if (Array.isArray(bots)) {
      out[kind] = bots.filter((id) => typeof id === 'string');
    }
  }
  return out;
}

function readNeedsYou(value) {
  if (!value || typeof value !== 'object' || typeof value.at !== 'number' || !value.counts || typeof value.counts !== 'object') {
    return undefined;
  }
  const counts = {};
  for (const [botId, count] of Object.entries(value.counts)) {
    if (typeof count === 'number') {
      counts[botId] = count;
    }
  }
  return {
    counts,
    at: value.at,
    ...(typeof value.staleInMs === 'number' ? { staleInMs: value.staleInMs } : {}),
  };
}

export function readBotChangeScope(event) {
  if (!event || typeof event !== 'object') {
    return undefined;
  }
  const botIds = Array.isArray(event.botIds) ? event.botIds.filter((id) => typeof id === 'string') : undefined;
  const kinds = Array.isArray(event.kinds) ? event.kinds.filter((kind) => typeof kind === 'string') : undefined;
  if (!botIds && !kinds) {
    return undefined;
  }
  const kindBots = readKindBots(event.kindBots);
  const needsYou = readNeedsYou(event.needsYou);
  return {
    ...(botIds ? { botIds } : {}),
    ...(kinds ? { kinds } : {}),
    ...(kindBots ? { kindBots } : {}),
    ...(needsYou ? { needsYou } : {}),
  };
}

/** Complete catalog of `bots.*` runtime RPC methods matching Orca's protocol. */
export const RPC_METHODS = Object.freeze({
  LIST: 'bots.list',
  CREATE: 'bots.create',
  UPDATE: 'bots.update',
  DELETE: 'bots.delete',
  ROSTER: 'bots.roster',
  AGENT_CHOICES: 'bots.agentChoices',
  AVATAR_UPLOAD: 'bots.avatar.upload',
  AVATAR_READ: 'bots.avatar.read',
  SKILL_PROJECTS_SCAN: 'bots.skillProjects.scan',
  CREATE_OFFER: 'bots.createOffer',
  TEMPLATES_SUGGEST: 'bots.templates.suggest',
  SETTINGS_GET: 'bots.settings.get',
  SETTINGS_SET: 'bots.settings.set',
  SOUL_READ: 'bots.soul.read',
  SOUL_WRITE: 'bots.soul.write',
  FILES_LIST: 'bots.files.list',
  FILES_READ: 'bots.files.read',
  FILES_WRITE: 'bots.files.write',
  CHAT_OPEN: 'bots.chat.open',
  CHAT_RESET: 'bots.chat.reset',
  CHAT_DELETE: 'bots.chat.delete',
  KICKOFF_RETRY: 'bots.kickoff.retry',
  SESSION_START: 'bots.session.start',
  CHATS_LIST: 'bots.chats',
  CHATS_OWN: 'bots.chats.own',
  CHATS_SEARCH: 'bots.chats.search',
  CHATS_SEEN: 'bots.chats.seen',
  CHATS_UNSEEN: 'bots.chats.unseen',
  ACTIVITY: 'bots.activity',
  CHAT_TREE: 'bots.chatTree',
  TAKE_OVER: 'bots.takeOver',
  SEND_RUN_AGAIN: 'bots.sendRunAgain',
  REQUEST_OUTCOME: 'bots.request.outcome',
  MEMORY_READ: 'bots.memory.read',
  MEMORY_FORGET: 'bots.memory.forget',
  MEMORY_EDIT: 'bots.memory.edit',
  MEMORY_HISTORY: 'bots.memory.history',
  MEMORY_UNDO: 'bots.memory.undo',
  TIDY_UP_GET: 'bots.tidyUp.get',
  TIDY_UP_NOW: 'bots.tidyUp.now',
  TIDY_UP_UNDO: 'bots.tidyUp.undo',
  ITEMS_ADD: 'bots.items.add',
  ITEMS_SET: 'bots.items.set',
  ITEMS_COMMENT: 'bots.items.comment',
  ITEMS_DONE: 'bots.items.done',
  ITEMS_CANCEL: 'bots.items.cancel',
  ITEMS_LINK: 'bots.items.link',
  ITEMS_LIST: 'bots.items.list',
  ITEMS_SHOW: 'bots.items.show',
  ITEMS_OWNER_LIST: 'bots.items.owner.list',
  ITEMS_OWNER_SHOW: 'bots.items.owner.show',
  ITEMS_OWNER_COMMENT: 'bots.items.owner.comment',
  ITEMS_OWNER_STATUS: 'bots.items.owner.status',
  ITEMS_OWNER_SNOOZE: 'bots.items.owner.snooze',
  ITEMS_OWNER_OPENED: 'bots.items.owner.opened',
  GROUPS_LIST: 'bots.groups.list',
  GROUPS_CREATE: 'bots.groups.create',
  GROUPS_UPDATE: 'bots.groups.update',
  GROUPS_DELETE: 'bots.groups.delete',
  GROUPS_REORDER: 'bots.groups.reorder',
  GROUPS_READ: 'bots.groups.read',
  GROUPS_SEND: 'bots.groups.send',
  GROUPS_STOP: 'bots.groups.stop',
  GROUPS_NEW_THREAD: 'bots.groups.newThread',
  GROUP_ITEMS_LIST: 'bots.groups.items',
  LOOK_AROUND_NOW: 'bots.lookAround.lookNow',
  LOOK_AROUND_SET: 'bots.lookAround.set',
  SUGGEST: 'bots.suggest',
  SUGGESTIONS_START: 'bots.suggestions.start',
  SUGGESTIONS_DISMISS: 'bots.suggestions.dismiss',
  UP_NEXT_SEEN: 'bots.upNext.seen',
  UP_NEXT_UNSEEN: 'bots.upNext.unseen',
  TOOLS_LIST: 'bots.tools.list',
  TOOLS_ADD: 'bots.tools.add',
  TOOLS_UPDATE: 'bots.tools.update',
  TOOLS_REMOVE: 'bots.tools.remove',
  TOOLS_DETAILS: 'bots.tools.details',
  TOOLS_PROBLEMS: 'bots.tools.problems',
  WORK_LIST: 'bots.work.list',
  WORK_FORGET: 'bots.work.forget',
  WORK_STOP: 'bots.work.stop',
  ACCESS_LIST: 'bots.access.list',
  ACCESS_DECIDE: 'bots.access.decide',
  ACCESS_REDEEM: 'bots.access.redeem',
  CONNECTORS_LIST: 'bots.connectors',
  SHARE_PREPARE: 'bots.share.prepare',
  SHARE_EXPORT: 'bots.share.export',
  SHARE_IMPORT: 'bots.share.import',
  IMPORT_SOURCES: 'bots.import.sources',
});
