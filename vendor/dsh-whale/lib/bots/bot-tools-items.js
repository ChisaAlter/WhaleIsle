/**
 * Native `bot_item_*` tool definitions (8 tools) for WhaleIsle Bots.
 * Composed into `bot-tools-registry.js`.
 */
import { genericOutput } from '../shared.js';

/** @param {string} detail */
const okOut = (detail) => ({ ok: true, detail });
/** @param {string} detail */
const errOut = (detail) => ({ ok: false, detail });

const LINK_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true },
    ref: { type: 'string', required: true },
  },
};

const ASK_PARAM_SCHEMA = {
  type: 'object',
  description: 'Structured ask payload ({ questions: [...] }) for needs_you.',
  additionalProperties: true,
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          prompt: { type: 'string' },
          recommended: { type: 'number' },
          multi: { type: 'boolean' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                label: { type: 'string' },
                detail: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
};

/** @param {string} name @param {string} description @param {Record<string, any>} parameters @param {(args: any, exec: any) => Promise<any>} execute */
function makeTool(name, description, parameters, execute) {
  return {
    name,
    description,
    timeoutMs: 20_000,
    parameters,
    output: genericOutput,
    presentCall: () => ({ card: 'generic', title: name, kind: 'other', content: [] }),
    execute,
  };
}

/**
 * Resolve item uid by uid or numeric `#number`.
 * @param {any} itemsStore
 * @param {string | number} ref
 */
function resolveItemUid(itemsStore, ref) {
  const raw = String(ref ?? '').trim();
  const numMatch = /^#?(\d+)$/.exec(raw);
  if (numMatch) {
    const found = itemsStore.byNumber(Number(numMatch[1]));
    if (found) return found.uid;
  }
  return raw;
}

/**
 * Build the 8 `bot_item_*` native tools.
 * @param {() => any} getRuntime
 * @param {(runtime: any, exec: any, explicitBotId?: string) => { bot: any, sessionId: string } | null} resolveCaller
 */
export function buildBotItemTools(getRuntime, resolveCaller) {
  const actorOf = (caller) => ({ kind: 'bot', botId: caller.bot.id, chatId: caller.sessionId });

  return [
    makeTool(
      'bot_item_add',
      'Create a new Work Item (deliverable or decision) owned by this bot or another bot via targetBotId.',
      {
        title: { type: 'string', description: 'Short item title (<=200 chars).', required: true },
        description: { type: 'string', description: 'Optional markdown description.' },
        doneMeans: { type: 'string', description: 'Optional acceptance criteria.' },
        status: { type: 'string', description: 'Initial status: planned | working | needs_you.' },
        comment: { type: 'string', description: 'Optional initial question/note (for needs_you).' },
        ask: ASK_PARAM_SCHEMA,
        links: { type: 'array', description: 'Optional array of { kind: dispatch|pr|url|file, ref }.', items: LINK_ITEM_SCHEMA },
        targetBotId: { type: 'string', description: 'Optional target bot id when filing on behalf of another bot.' },
      },
      async (args, exec) => {
        const runtime = getRuntime();
        const caller = resolveCaller(runtime, exec);
        if (!caller) return errOut('Bot runtime or caller bot context unavailable.');
        const ownerBotId = args.targetBotId ? String(args.targetBotId).trim() : caller.bot.id;
        const ownerBot = runtime.botsStore.getBot(ownerBotId);
        if (!ownerBot) return errOut(`Target bot not found: ${ownerBotId}`);
        const res = runtime.itemsStore.add({
          ownerBotId: ownerBot.id,
          chatId: ownerBot.id === caller.bot.id ? caller.sessionId : (ownerBot.chatSessionId || caller.sessionId),
          source: { kind: caller.bot.chatSessionId === caller.sessionId ? 'home' : 'chat', title: null },
          madeBy: ownerBot.id !== caller.bot.id ? { botId: caller.bot.id, chatId: caller.sessionId } : null,
          title: args.title,
          description: args.description,
          doneMeans: args.doneMeans,
          status: args.status,
          comment: args.comment,
          ask: args.ask,
          links: args.links,
        }, actorOf(caller));
        runtime.eventBus.emit({ botIds: [ownerBot.id], kinds: ['items'] });
        return okOut(JSON.stringify({ uid: res.item.uid, number: res.item.number, status: res.item.status }));
      },
    ),

    makeTool(
      'bot_item_set',
      'Update fields, status, or structured needs_you question on an existing Work Item.',
      {
        id: { type: 'string', description: 'Item uid or #number.', required: true },
        title: { type: 'string', description: 'Updated title.' },
        description: { type: 'string', description: 'Updated description (empty string clears).' },
        doneMeans: { type: 'string', description: 'Updated acceptance criteria.' },
        status: { type: 'string', description: 'planned | working | needs_you | done | canceled.' },
        comment: { type: 'string', description: 'Comment attached to a status change.' },
        ask: ASK_PARAM_SCHEMA,
        reason: { type: 'string', description: 'Required reason when status=canceled.' },
        note: { type: 'string', description: 'Optional closing note when status=done.' },
      },
      async (args, exec) => {
        const runtime = getRuntime();
        const caller = resolveCaller(runtime, exec);
        if (!caller) return errOut('Bot runtime or caller bot context unavailable.');
        const uid = resolveItemUid(runtime.itemsStore, args.id);
        const res = runtime.itemsStore.set(uid, args, actorOf(caller));
        runtime.eventBus.emit({ botIds: [res.item.ownerBotId], kinds: ['items'] });
        return okOut(JSON.stringify({ uid: res.item.uid, number: res.item.number, status: res.item.status }));
      },
    ),

    makeTool(
      'bot_item_comment',
      'Post a progress comment or worker summary on a Work Item.',
      {
        id: { type: 'string', description: 'Item uid or #number.', required: true },
        text: { type: 'string', description: 'Comment body.', required: true },
        ask: ASK_PARAM_SCHEMA,
      },
      async (args, exec) => {
        const runtime = getRuntime();
        const caller = resolveCaller(runtime, exec);
        if (!caller) return errOut('Bot runtime or caller bot context unavailable.');
        const uid = resolveItemUid(runtime.itemsStore, args.id);
        const res = runtime.itemsStore.comment(uid, { text: args.text, ask: args.ask }, actorOf(caller));
        runtime.eventBus.emit({ botIds: [res.item.ownerBotId], kinds: ['items'] });
        return okOut(JSON.stringify({ uid: res.item.uid, eventId: res.event?.eventId ?? null }));
      },
    ),

    makeTool(
      'bot_item_done',
      'Mark a Work Item as done with an optional closing note.',
      {
        id: { type: 'string', description: 'Item uid or #number.', required: true },
        note: { type: 'string', description: 'Optional completion note.' },
      },
      async (args, exec) => {
        const runtime = getRuntime();
        const caller = resolveCaller(runtime, exec);
        if (!caller) return errOut('Bot runtime or caller bot context unavailable.');
        const uid = resolveItemUid(runtime.itemsStore, args.id);
        const res = runtime.itemsStore.close(uid, { status: 'done', note: args.note }, actorOf(caller));
        runtime.eventBus.emit({ botIds: [res.item.ownerBotId], kinds: ['items'] });
        return okOut(JSON.stringify({ uid: res.item.uid, status: res.item.status }));
      },
    ),

    makeTool(
      'bot_item_cancel',
      'Cancel a Work Item with a required reason.',
      {
        id: { type: 'string', description: 'Item uid or #number.', required: true },
        reason: { type: 'string', description: 'Reason for canceling.', required: true },
      },
      async (args, exec) => {
        const runtime = getRuntime();
        const caller = resolveCaller(runtime, exec);
        if (!caller) return errOut('Bot runtime or caller bot context unavailable.');
        const uid = resolveItemUid(runtime.itemsStore, args.id);
        const res = runtime.itemsStore.close(uid, { status: 'canceled', reason: args.reason }, actorOf(caller));
        runtime.eventBus.emit({ botIds: [res.item.ownerBotId], kinds: ['items'] });
        return okOut(JSON.stringify({ uid: res.item.uid, status: res.item.status }));
      },
    ),

    makeTool(
      'bot_item_link',
      'Attach dispatch, PR, URL, or file links to a Work Item.',
      {
        id: { type: 'string', description: 'Item uid or #number.', required: true },
        links: { type: 'array', description: 'Array of { kind: dispatch|pr|url|file, ref }.', required: true, items: LINK_ITEM_SCHEMA },
      },
      async (args, exec) => {
        const runtime = getRuntime();
        const caller = resolveCaller(runtime, exec);
        if (!caller) return errOut('Bot runtime or caller bot context unavailable.');
        const uid = resolveItemUid(runtime.itemsStore, args.id);
        const res = runtime.itemsStore.link(uid, args.links, actorOf(caller));
        runtime.eventBus.emit({ botIds: [res.item.ownerBotId], kinds: ['items'] });
        return okOut(JSON.stringify({ uid: res.item.uid, added: res.added }));
      },
    ),

    makeTool(
      'bot_item_list',
      'List Work Items for the current bot (filterable by status or openOnly).',
      {
        openOnly: { type: 'boolean', description: 'Only return open items (default true).' },
        statuses: { type: 'array', description: 'Optional status filter array.', items: { type: 'string' } },
        limit: { type: 'number', description: 'Max items (1..100, default 50).' },
      },
      async (args, exec) => {
        const runtime = getRuntime();
        const caller = resolveCaller(runtime, exec);
        if (!caller) return errOut('Bot runtime or caller bot context unavailable.');
        const res = runtime.itemsStore.list({
          ownerBotId: caller.bot.id,
          openOnly: args.statuses ? false : (args.openOnly !== false),
          statuses: args.statuses,
          limit: args.limit,
        });
        return okOut(JSON.stringify(res));
      },
    ),

    makeTool(
      'bot_item_show',
      'Show full Work Item metadata, links, and incremental events.',
      {
        id: { type: 'string', description: 'Item uid or #number.', required: true },
        after: { type: 'string', description: 'Optional event cursor like e12.' },
      },
      async (args, exec) => {
        const runtime = getRuntime();
        const caller = resolveCaller(runtime, exec);
        if (!caller) return errOut('Bot runtime or caller bot context unavailable.');
        const uid = resolveItemUid(runtime.itemsStore, args.id);
        const item = runtime.itemsStore.get(uid);
        if (!item) return errOut(`Item not found: ${args.id}`);
        const links = runtime.itemsStore.links(uid);
        const evs = runtime.itemsStore.events(uid, { after: args.after ?? 0 });
        return okOut(JSON.stringify({ item, links, ...evs }));
      },
    ),
  ];
}
