/**
 * Native `bot_item_*` tool definitions (8 tools) for WhaleIsle Bots.
 * Composed into `bot-tools-registry.js`.
 */
import { genericOutput } from '../shared.js';
import { botItemAskAdvice } from '../../src/shared/bot-item-ask-advice.js';
import { BOT_ITEM_TOOL_SCHEMAS } from '../../src/shared/bot-tools-schema.js';

/** @param {string} detail */
const okOut = (detail) => ({ ok: true, detail });
/** @param {string} detail */
const errOut = (detail) => ({ ok: false, detail });

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
 * Filter incoming links to drop `dispatch` links whose worker follow-up chain is already
 * represented on the item (or earlier in the same batch).
 *
 * @param {Array<{ kind: string, ref: string, latest?: string }>} incomingLinks
 * @param {Array<{ kind: string, ref: string, latest?: string }>} existingLinks
 * @param {(dispatchRef: string) => string} resolveChainKey
 */
export function linksOutsideLinkedChains(incomingLinks, existingLinks, resolveChainKey) {
  const linkedChains = new Set();
  for (const existing of existingLinks ?? []) {
    if (existing?.kind !== 'dispatch') continue;
    const key = existing.latest ?? resolveChainKey(existing.ref);
    if (key) linkedChains.add(key);
  }
  /** @type {Array<{ kind: string, ref: string }>} */
  const kept = [];
  /** @type {Array<{ kind: string, ref: string, chainKey: string }>} */
  const skipped = [];
  for (const entry of incomingLinks ?? []) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.kind !== 'dispatch') {
      kept.push({ kind: entry.kind, ref: entry.ref });
      continue;
    }
    const chainKey = entry.latest ?? resolveChainKey(entry.ref);
    if (chainKey && linkedChains.has(chainKey)) {
      skipped.push({ kind: entry.kind, ref: entry.ref, chainKey });
      continue;
    }
    if (chainKey) linkedChains.add(chainKey);
    kept.push({ kind: entry.kind, ref: entry.ref });
  }
  return { kept, skipped };
}

/** @param {any} runtime */
function makeDispatchChainResolver(runtime) {
  return (/** @type {string} */ dispatchRef) => {
    const ref = String(dispatchRef ?? '').trim();
    if (!ref) return '';
    const work = runtime?.workStore?.getWorkByDispatch?.(ref);
    if (work) {
      return `${work.botId}\0${work.source}\0${work.externalId}`;
    }
    return ref;
  };
}

/** @param {any} err */
function formatToolError(err) {
  const code = err?.code ? `${err.code}: ` : '';
  return errOut(`${code}${err?.message ?? String(err)}`);
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
      BOT_ITEM_TOOL_SCHEMAS.bot_item_add,
      async (args, exec) => {
        const runtime = getRuntime();
        const caller = resolveCaller(runtime, exec);
        if (!caller) return errOut('Bot runtime or caller bot context unavailable.');
        const ownerBotId = args.targetBotId ? String(args.targetBotId).trim() : caller.bot.id;
        const ownerBot = runtime.botsStore.getBot(ownerBotId) ?? runtime.botsStore.getBotByName?.(ownerBotId);
        if (!ownerBot) return errOut(`Target bot not found: ${ownerBotId}`);
        try {
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
            files: args.files,
            links: args.links,
          }, actorOf(caller));
          runtime.eventBus.emit({ botIds: [ownerBot.id], kinds: ['items'] });
          const tip = res.item.status === 'needs_you'
            ? botItemAskAdvice({ comment: args.comment, ask: args.ask })
            : null;
          return okOut(JSON.stringify({
            uid: res.item.uid,
            number: res.item.number,
            status: res.item.status,
            ...(tip ? { tip } : {}),
          }));
        } catch (err) {
          return formatToolError(err);
        }
      },
    ),

    makeTool(
      'bot_item_set',
      'Update fields, status, or structured needs_you question on an existing Work Item.',
      BOT_ITEM_TOOL_SCHEMAS.bot_item_set,
      async (args, exec) => {
        const runtime = getRuntime();
        const caller = resolveCaller(runtime, exec);
        if (!caller) return errOut('Bot runtime or caller bot context unavailable.');
        const uid = resolveItemUid(runtime.itemsStore, args.id);
        try {
          const res = runtime.itemsStore.set(uid, {
            title: args.title,
            description: args.description,
            doneMeans: args.doneMeans,
            status: args.status,
            comment: args.comment,
            ask: args.ask,
            files: args.files,
            reason: args.reason,
            note: args.note,
          }, actorOf(caller));
          runtime.eventBus.emit({ botIds: [res.item.ownerBotId], kinds: ['items'] });
          const tip = res.item.status === 'needs_you' && (args.status === 'needs_you' || args.comment || args.ask)
            ? botItemAskAdvice({ comment: args.comment, ask: args.ask })
            : null;
          return okOut(JSON.stringify({
            uid: res.item.uid,
            number: res.item.number,
            status: res.item.status,
            ...(tip ? { tip } : {}),
          }));
        } catch (err) {
          return formatToolError(err);
        }
      },
    ),

    makeTool(
      'bot_item_comment',
      'Post a progress comment, file attachment, or worker summary on a Work Item.',
      BOT_ITEM_TOOL_SCHEMAS.bot_item_comment,
      async (args, exec) => {
        const runtime = getRuntime();
        const caller = resolveCaller(runtime, exec);
        if (!caller) return errOut('Bot runtime or caller bot context unavailable.');
        const uid = resolveItemUid(runtime.itemsStore, args.id);
        try {
          const res = runtime.itemsStore.comment(
            uid,
            { text: args.text, ask: args.ask, files: args.files },
            actorOf(caller),
          );
          runtime.eventBus.emit({ botIds: [res.item.ownerBotId], kinds: ['items'] });
          const tip = res.item.status === 'needs_you' && (args.ask || args.text)
            ? botItemAskAdvice({ text: args.text, ask: args.ask })
            : null;
          return okOut(JSON.stringify({
            uid: res.item.uid,
            eventId: res.event?.eventId ?? null,
            ...(tip ? { tip } : {}),
          }));
        } catch (err) {
          return formatToolError(err);
        }
      },
    ),

    makeTool(
      'bot_item_done',
      'Mark a Work Item as done with an optional closing note.',
      BOT_ITEM_TOOL_SCHEMAS.bot_item_done,
      async (args, exec) => {
        const runtime = getRuntime();
        const caller = resolveCaller(runtime, exec);
        if (!caller) return errOut('Bot runtime or caller bot context unavailable.');
        const uid = resolveItemUid(runtime.itemsStore, args.id);
        try {
          const res = runtime.itemsStore.close(uid, { status: 'done', note: args.note }, actorOf(caller));
          runtime.eventBus.emit({ botIds: [res.item.ownerBotId], kinds: ['items'] });
          return okOut(JSON.stringify({ uid: res.item.uid, status: res.item.status }));
        } catch (err) {
          return formatToolError(err);
        }
      },
    ),

    makeTool(
      'bot_item_cancel',
      'Cancel a Work Item with a required reason.',
      BOT_ITEM_TOOL_SCHEMAS.bot_item_cancel,
      async (args, exec) => {
        const runtime = getRuntime();
        const caller = resolveCaller(runtime, exec);
        if (!caller) return errOut('Bot runtime or caller bot context unavailable.');
        const uid = resolveItemUid(runtime.itemsStore, args.id);
        try {
          const res = runtime.itemsStore.close(uid, { status: 'canceled', reason: args.reason }, actorOf(caller));
          runtime.eventBus.emit({ botIds: [res.item.ownerBotId], kinds: ['items'] });
          return okOut(JSON.stringify({ uid: res.item.uid, status: res.item.status }));
        } catch (err) {
          return formatToolError(err);
        }
      },
    ),

    makeTool(
      'bot_item_link',
      'Attach dispatch, PR, URL, or file links to a Work Item (supports cross-bot attachment on open items with follow-up chain deduplication).',
      BOT_ITEM_TOOL_SCHEMAS.bot_item_link,
      async (args, exec) => {
        const runtime = getRuntime();
        const caller = resolveCaller(runtime, exec);
        if (!caller) return errOut('Bot runtime or caller bot context unavailable.');
        const uid = resolveItemUid(runtime.itemsStore, args.id);
        try {
          const existing = runtime.itemsStore.get(uid);
          if (!existing) return errOut(`not_found: Item not found: ${args.id}`);
          const existingLinks = runtime.itemsStore.links(uid);
          const rawLinks = Array.isArray(args.links) ? args.links : [];
          const { kept, skipped } = linksOutsideLinkedChains(
            rawLinks,
            existingLinks,
            makeDispatchChainResolver(runtime),
          );
          if (kept.length === 0) {
            return okOut(JSON.stringify({
              uid: existing.uid,
              added: [],
              ...(skipped.length > 0 ? { skippedChainDuplicates: skipped.map((s) => s.ref) } : {}),
            }));
          }
          const res = runtime.itemsStore.link(uid, kept, actorOf(caller));
          runtime.eventBus.emit({ botIds: [res.item.ownerBotId], kinds: ['items'] });
          return okOut(JSON.stringify({
            uid: res.item.uid,
            added: res.added,
            ...(skipped.length > 0 ? { skippedChainDuplicates: skipped.map((s) => s.ref) } : {}),
          }));
        } catch (err) {
          return formatToolError(err);
        }
      },
    ),

    makeTool(
      'bot_item_list',
      'List Work Items (filterable by botId, all, here, chat, link, status, openOnly, cursor, limit).',
      BOT_ITEM_TOOL_SCHEMAS.bot_item_list,
      async (args, exec) => {
        const runtime = getRuntime();
        const caller = resolveCaller(runtime, exec);
        if (!caller) return errOut('Bot runtime or caller bot context unavailable.');
        let ownerBotId = caller.bot.id;
        if (args.botId !== undefined && args.botId !== null && String(args.botId).trim() !== '') {
          const requested = String(args.botId).trim();
          const target = runtime.botsStore.getBot(requested) ?? runtime.botsStore.getBotByName?.(requested);
          if (!target) return errOut(`Target bot not found: ${requested}`);
          ownerBotId = target.id;
        }
        const chatId = args.chat
          ? String(args.chat).trim()
          : (args.here === true ? caller.sessionId : undefined);
        const includeClosed = args.all === true || args.openOnly === false || Boolean(args.statuses);
        try {
          const res = runtime.itemsStore.list({
            ownerBotId,
            ...(chatId ? { chatId } : {}),
            ...(args.link ? { link: args.link } : {}),
            ...(args.cursor ? { cursor: args.cursor } : {}),
            openOnly: !includeClosed,
            statuses: args.statuses,
            limit: args.limit,
          });
          return okOut(JSON.stringify(res));
        } catch (err) {
          return formatToolError(err);
        }
      },
    ),

    makeTool(
      'bot_item_show',
      'Show full Work Item metadata, links, and incremental events.',
      BOT_ITEM_TOOL_SCHEMAS.bot_item_show,
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
