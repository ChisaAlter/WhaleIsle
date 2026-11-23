/**
 * Native Bot Tools registry for Harness sessions (`dsh-bot` & `whale-girl` presets).
 *
 * Enforces fail-closed desktop confirmation (`confirmModelAction`) for cross-boundary
 * tools registered in `src/shared/model-tool-effects.js`:
 * - `bot_tools_manage` (actions: list[read] / add|update[code] / remove[destructive])
 * - `bot_reply` (action: reply, effect: external)
 *
 * Harness-governed / local bot tools (`bot_work_start`, `bot_send`,
 * `bot_automation_create`, `bot_new_chat`) run under Harness sandbox & approval
 * while keeping the non-owner IM refusal boundary (`isNonOwnerImTurn`).
 */
import crypto from 'node:crypto';
import path from 'node:path';
import {
  BOT_GROUP_MEMBER_SESSION_PREFIX,
  BOT_REPLY_TOOL_SCHEMA,
  validateBotName,
  validateBotReplyArgs,
} from '../../src/shared/index.js';
import { isNonOwnerImTurn } from '../call-origin.js';
import {
  CONFIRM_TOOL_TIMEOUT_MS,
  NON_OWNER_IM_REFUSAL_TEXT,
  confirmModelAction,
  refusalTextFor,
} from '../desktop-confirm.js';
import { genericOutput } from '../shared.js';
import { buildBotItemTools } from './bot-tools-items.js';
import { evaluateLookAroundToolPolicy } from './look-around-service.js';
import { resolveBotForSession } from './prompt-engine.js';
import { BOT_OWNER_WORK } from './session-runtime.js';

let activeBotsRuntimeSource = null;

/** @param {any} runtimeOrGetter */
export function setActiveBotsRuntime(runtimeOrGetter) {
  activeBotsRuntimeSource = runtimeOrGetter;
}

export function getActiveBotsRuntime() {
  return typeof activeBotsRuntimeSource === 'function'
    ? activeBotsRuntimeSource()
    : activeBotsRuntimeSource;
}

const okOut = (detail) => ({ ok: true, detail });
const errOut = (detail) => ({ ok: false, detail });

/** @param {any} runtime @param {string} sessionId @param {any} chat */
function resolveGroupIdForSession(runtime, sessionId, chat) {
  if (chat?.groupId) return String(chat.groupId);
  const sid = String(sessionId ?? '').trim();
  const isGroupLike = (
    chat?.kind === 'group-member'
    || chat?.kind === 'group'
    || chat?.origin === 'group'
    || sid.startsWith(BOT_GROUP_MEMBER_SESSION_PREFIX)
  );
  if (!isGroupLike) return null;
  const groups = runtime?.groupsStore?.listGroups?.() ?? [];
  for (const g of groups) {
    const memberVals = Object.values(g.memberSessionIds ?? {});
    if (memberVals.includes(sid)) return g.id;
    const formerVals = Object.values(g.formerSessionIds ?? {}).flat();
    if (formerVals.includes(sid)) return g.id;
  }
  return 'group';
}

/** @param {any} runtime @param {any} bot @param {string} sessionId @param {any} chat @param {any} exec */
function buildCallerInfo(runtime, bot, sessionId, chat, exec) {
  const resolvedChat = chat ?? runtime.botsStore?.getChat?.(sessionId) ?? null;
  const explicitKind = exec?.caller?.kind ?? exec?.sessionKind ?? null;
  const explicitGroupId = exec?.caller?.groupId ?? exec?.groupId ?? null;
  const kind = explicitKind || resolvedChat?.kind || (bot.chatSessionId === sessionId ? 'home' : 'side');
  const groupId = explicitGroupId || resolveGroupIdForSession(runtime, sessionId, resolvedChat);
  return { bot, sessionId, chat: resolvedChat, kind, groupId };
}

/** @param {any} runtime @param {any} exec */
function resolveCallerBot(runtime, exec) {
  if (!runtime) return null;
  const resolved = resolveBotForSession(runtime, exec);
  if (resolved?.bot) {
    const sessionId = resolved.sessionId || resolved.bot.chatSessionId || 'unknown';
    return buildCallerInfo(runtime, resolved.bot, sessionId, resolved.chat, exec);
  }
  const fallback = runtime.legacyCompat?.resolvePetBot?.() ?? runtime.botsStore?.listBots?.()?.[0] ?? null;
  if (!fallback) return null;
  return buildCallerInfo(runtime, fallback, fallback.chatSessionId || 'unknown', null, exec);
}

/** @param {any} caller @param {any} exec */
function isLookAroundContext(caller, exec) {
  return (
    caller?.kind === 'look-around'
    || caller?.chat?.kind === 'look-around'
    || exec?.caller?.kind === 'look-around'
    || exec?.sessionKind === 'look-around'
  );
}

/** @param {any} caller */
function isGroupContext(caller) {
  return Boolean(
    caller?.groupId
    || caller?.kind === 'group'
    || caller?.kind === 'group-member'
    || caller?.chat?.kind === 'group-member'
    || caller?.chat?.origin === 'group',
  );
}

/** @param {any} caller */
function isWorkerContext(caller) {
  return (
    caller?.kind === 'worker'
    || caller?.chat?.kind === 'worker'
    || caller?.chat?.origin === 'work'
  );
}

const IM_SENDER_METHODS = ['sendReply', 'deliverReply', 'sendMessage', 'send', 'reply'];

/** @param {any} svc */
function extractImSender(svc) {
  if (!svc) return null;
  if (typeof svc === 'function') return { send: svc, service: svc };
  for (const method of IM_SENDER_METHODS) {
    if (typeof svc[method] === 'function') {
      return { send: (/** @type {any} */ payload) => svc[method](payload), service: svc };
    }
  }
  return null;
}

/** @param {any} runtime */
function resolveDshImSender(runtime) {
  const ctxGet = typeof runtime?.ctx?.get === 'function' ? (/** @type {string} */ k) => runtime.ctx.get(k) : () => null;
  const candidates = [
    runtime?.imSender,
    runtime?.imService,
    runtime?.dshIm,
    ctxGet('dsh-im'),
    ctxGet('dshIm'),
    ctxGet('imDelivery'),
    ctxGet('imService'),
    ctxGet('im'),
  ];
  for (const svc of candidates) {
    const found = extractImSender(svc);
    if (found) return found;
  }
  return null;
}

/** @param {any} toolDef @param {() => any} getRuntime */
function wrapWithLookAroundPolicy(toolDef, getRuntime) {
  const originalExecute = toolDef.execute;
  return {
    ...toolDef,
    /** @param {any} args @param {any} exec */
    async execute(args, exec) {
      const runtime = getRuntime();
      const caller = runtime ? resolveCallerBot(runtime, exec) : null;
      if (isLookAroundContext(caller, exec)) {
        const policy = evaluateLookAroundToolPolicy(toolDef.name, args);
        if (!policy.allowed) {
          return errOut(`Look Around read-only policy blocked ${toolDef.name}: ${policy.reason}`);
        }
      }
      return originalExecute(args, exec);
    },
  };
}

/** @param {any} payload */
function formatReplyConfirmDetails(payload) {
  return [
    payload.text,
    payload.choices.length ? `[choices: ${payload.choices.join(' | ')}]` : '',
    payload.files.length ? `[files: ${payload.files.join(', ')}]` : '',
    payload.react ? `[react: ${payload.react}]` : '',
  ].filter(Boolean).join(' ').slice(0, 400);
}

/** @param {string} transport @param {string} channel @param {any} payload @param {any} [receipt] */
function formatReplyAck(transport, channel, payload, receipt) {
  return okOut(JSON.stringify({
    ok: true,
    delivered: true,
    transport,
    channel,
    chars: payload.text.length,
    choicesCount: payload.choices.length,
    filesCount: payload.files.length,
    ...(payload.react ? { react: payload.react } : {}),
    ...(receipt !== undefined ? { receipt } : {}),
  }));
}

/** @param {any} imSender @param {any} caller @param {any} payload @param {string | null} targetChannel */
async function deliverViaImSender(imSender, caller, payload, targetChannel) {
  const channel = targetChannel ?? 'im';
  try {
    const receipt = await imSender.send({
      botId: caller.bot.id,
      botName: caller.bot.name,
      sessionId: caller.sessionId,
      channel,
      externalId: caller.chat?.externalId ?? null,
      text: payload.text,
      choices: payload.choices,
      files: payload.files,
      react: payload.react,
    });
    return formatReplyAck('dsh-im', channel, payload, receipt ?? null);
  } catch (error) {
    const errMsg = String(/** @type {any} */ (error)?.message ?? error);
    return errOut(`dsh-im delivery failed on channel "${channel}": ${errMsg}`);
  }
}

/** @param {any} runtime @param {any} caller @param {any} payload @param {string | null} targetChannel */
async function deliverApprovedBotReply(runtime, caller, payload, targetChannel) {
  const isExplicitPet = targetChannel === 'pet' || targetChannel === 'desktop-pet';
  const imSender = isExplicitPet ? null : resolveDshImSender(runtime);
  if (imSender) return deliverViaImSender(imSender, caller, payload, targetChannel);
  if (isExplicitPet || (!targetChannel && !caller.chat?.externalSource)) {
    const petText = payload.text || payload.react || (payload.files.length ? `Sent ${payload.files.length} file(s)` : '');
    runtime.legacyCompat?.notifyPet('say', petText.slice(0, 240));
    return formatReplyAck('pet', targetChannel ?? 'pet', payload);
  }
  return errOut(
    `dsh-im delivery service is unavailable for external channel "${targetChannel}". Ensure the dsh-im connector plugin is running and connected, then retry.`,
  );
}

/** @param {string} name @param {string} description @param {Record<string, any>} parameters @param {(args: any, exec: any) => Promise<any>} execute @param {number} [timeoutMs] */
function makeTool(name, description, parameters, execute, timeoutMs = 20_000) {
  return {
    name,
    description,
    timeoutMs,
    parameters,
    output: genericOutput,
    presentCall: () => ({ card: 'generic', title: name, kind: 'other', content: [] }),
    execute,
  };
}

/**
 * Build all 22 native bot tool definitions.
 * @param {() => any} getRuntime
 * @param {{ confirmAction?: typeof confirmModelAction }} [options]
 */
export function buildBotToolDefinitions(getRuntime = getActiveBotsRuntime, options = {}) {
  const confirmAction = options.confirmAction ?? confirmModelAction;

  async function requireConfirm(req, exec) {
    const decision = await confirmAction(req, exec?.signal, exec);
    if (decision?.ok === true) return null;
    return errOut(refusalTextFor(decision, exec?.signal));
  }

  function refuseNonOwnerIm(exec) {
    if (isNonOwnerImTurn(exec)) {
      return errOut(NON_OWNER_IM_REFUSAL_TEXT);
    }
    return null;
  }

  const basicTools = [
    makeTool(
      'bot_list',
      'List all bots on this machine with their SOUL descriptions, status, and Home Chat session IDs.',
      {},
      async () => {
        const runtime = getRuntime();
        if (!runtime) return errOut('Bots runtime unavailable.');
        return okOut(JSON.stringify(runtime.botsService.roster()));
      },
    ),

    makeTool(
      'bot_chats',
      'List chats for the current bot or a specified botId.',
      {
        botId: { type: 'string', description: 'Optional bot id (defaults to caller bot).' },
        includeClosed: { type: 'boolean', description: 'Include closed chats (default false).' },
      },
      async (args, exec) => {
        const runtime = getRuntime();
        const caller = resolveCallerBot(runtime, exec);
        if (!caller) return errOut('Caller bot context unavailable.');
        const targetId = args.botId ? String(args.botId).trim() : caller.bot.id;
        const chats = runtime.sessionRuntime.listChats(targetId, { includeClosed: args.includeClosed === true });
        return okOut(JSON.stringify(chats));
      },
    ),

    makeTool(
      'bot_memory_forget',
      'The ONLY valid way to remove a fact from MEMORY.md so turn-end guard does not restore it.',
      {
        fact: { type: 'string', description: 'Exact or normalized fact text to forget.', required: true },
      },
      async (args, exec) => {
        const runtime = getRuntime();
        const caller = resolveCallerBot(runtime, exec);
        if (!caller) return errOut('Caller bot context unavailable.');
        const res = runtime.botsService.memoryForget(caller.bot.id, { fact: args.fact, actor: 'bot' });
        if (res.forgottenKeys.length > 0) {
          runtime.recordForgottenMemoryKeys?.(caller.sessionId, res.forgottenKeys);
        }
        return okOut(JSON.stringify(res));
      },
    ),

    makeTool(
      'bot_work_list',
      'List dispatched coding workers and their current status for this bot.',
      { openOnly: { type: 'boolean', description: 'Only return active workers (default false).' } },
      async (args, exec) => {
        const runtime = getRuntime();
        const caller = resolveCallerBot(runtime, exec);
        if (!caller) return errOut('Caller bot context unavailable.');
        const rows = runtime.workStore.listWork({ botId: caller.bot.id, openOnly: args.openOnly === true });
        return okOut(JSON.stringify(rows));
      },
    ),

    makeTool(
      'bot_work_forget',
      'Clear the sticky worker binding for the current chat so a new worker can be dispatched.',
      { source: { type: 'string', description: 'Conversation source (default app).' } },
      async (args, exec) => {
        const runtime = getRuntime();
        const caller = resolveCallerBot(runtime, exec);
        if (!caller) return errOut('Caller bot context unavailable.');
        const res = runtime.workStore.forgetWork(caller.bot.id, args.source || 'app', caller.sessionId);
        runtime.eventBus.emit({ botIds: [caller.bot.id], kinds: ['workers'] });
        return okOut(JSON.stringify(res));
      },
    ),

    makeTool(
      'bot_suggest',
      'Submit an Up Next suggestion (title, why, ask, optional link) during Look Around.',
      {
        title: { type: 'string', description: 'Short suggestion title (<=80 chars).', required: true },
        why: { type: 'string', description: 'Why this matters (<=400 chars).', required: true },
        ask: { type: 'string', description: 'Actionable prompt if owner starts it (<=2000 chars).', required: true },
        link: { type: 'string', description: 'Optional canonical URL.' },
      },
      async (args, exec) => {
        const runtime = getRuntime();
        const caller = resolveCallerBot(runtime, exec);
        if (!caller) return errOut('Caller bot context unavailable.');
        const res = runtime.lookAroundService.addSuggestion(caller.bot.id, args, { runSessionId: caller.sessionId });
        return okOut(JSON.stringify(res));
      },
    ),

    makeTool(
      'bot_look_around_set',
      'Update this bot\'s Look Around schedule or focus when explicitly requested by the owner.',
      {
        on: { type: 'boolean', description: 'Enable or disable Look Around.' },
        every: { type: 'string', description: 'every-4h | every-2h | twice-daily | mornings.' },
        weekdaysOnly: { type: 'boolean', description: 'Run Monday..Friday only.' },
        focus: { type: 'string', description: 'Focus guidance (<=500 chars).' },
      },
      async (args, exec) => {
        const runtime = getRuntime();
        const caller = resolveCallerBot(runtime, exec);
        if (!caller) return errOut('Caller bot context unavailable.');
        const res = runtime.lookAroundService.setConfig(caller.bot.id, args);
        return okOut(JSON.stringify(res));
      },
    ),

    makeTool(
      'bot_create_offer',
      'Propose creating a new specialist bot as an owner-approved card (never creates the bot directly).',
      {
        name: { type: 'string', description: 'Suggested bot name.', required: true },
        purpose: { type: 'string', description: 'One-line purpose.', required: true },
        watches: { type: 'string', description: 'What the bot monitors.' },
        does: { type: 'string', description: 'What the bot does.' },
        reports: { type: 'string', description: 'How/where the bot reports.' },
        templateId: { type: 'string', description: 'Optional template id.' },
      },
      async (args, exec) => {
        const runtime = getRuntime();
        const caller = resolveCallerBot(runtime, exec);
        if (!caller) return errOut('Caller bot context unavailable.');
        if (isGroupContext(caller)) {
          return errOut('bot_create_offer is not allowed inside a multi-bot group chat. Propose creating a new bot in your direct Home Chat with the owner instead.');
        }
        if (isLookAroundContext(caller, exec)) {
          return errOut('bot_create_offer is not allowed during read-only Look Around sweeps.');
        }
        const existingBots = runtime.botsStore.listBots();
        const nameCheck = validateBotName(args.name, { existingBots });
        if (!nameCheck.ok) {
          const dupBot = existingBots.find((/** @type {any} */ b) => b.name.toLowerCase() === String(args.name ?? '').trim().toLowerCase());
          if (dupBot) {
            return errOut(`A bot named "${dupBot.name}" already exists on this machine. Reuse that teammate or pick a distinct name.`);
          }
          return errOut(`Invalid bot name: ${nameCheck.reason}`);
        }
        const purpose = String(args.purpose ?? '').trim();
        if (!purpose) return errOut('purpose is required for bot_create_offer.');
        const offer = {
          offerId: crypto.randomUUID(),
          proposerBotId: caller.bot.id,
          name: nameCheck.name,
          purpose,
          watches: args.watches ?? null,
          does: args.does ?? null,
          reports: args.reports ?? null,
          templateId: args.templateId ?? null,
          createdAt: Date.now(),
        };
        return okOut(JSON.stringify({ kind: 'bot-create-offer', offer }));
      },
    ),
  ];

  const guardedTools = [
    makeTool(
      'bot_work_start',
      'Dispatch a coding worker session in a target project directory (governed by Harness sandbox & approval).',
      {
        cwd: { type: 'string', description: 'Absolute path to target project repository.', required: true },
        prompt: { type: 'string', description: 'Task instructions for the coding worker.', required: true },
        itemUid: { type: 'string', description: 'Optional Work Item uid to link.' },
        title: { type: 'string', description: 'Optional worker title.' },
      },
      async (args, exec) => {
        const blocked = refuseNonOwnerIm(exec);
        if (blocked) return blocked;
        const runtime = getRuntime();
        const caller = resolveCallerBot(runtime, exec);
        if (!caller) return errOut('Caller bot context unavailable.');
        const cwd = String(args.cwd ?? '').trim();
        const prompt = String(args.prompt ?? '').trim();
        if (!cwd || !prompt) return errOut('cwd and prompt are required.');

        const dispatchId = `disp-${crypto.randomUUID().slice(0, 12)}`;
        const taskId = `task-${crypto.randomUUID().slice(0, 12)}`;
        const work = runtime.workStore.startWork({
          botId: caller.bot.id,
          source: 'app',
          externalId: caller.sessionId,
          taskId,
          dispatchId,
        });
        const started = await runtime.sessionRuntime.startSideChat(caller.bot.id, {
          title: args.title || `Worker · ${path.basename(cwd)}`,
          kind: 'worker',
          origin: 'work',
          owner: BOT_OWNER_WORK,
          cwd: path.resolve(cwd),
          dispatchId,
          taskId,
          workId: work.id,
        });
        if (args.itemUid) {
          runtime.itemsStore.linkStartedWorker(args.itemUid, dispatchId, {
            chatId: caller.sessionId,
            botId: caller.bot.id,
          });
        }
        void runtime.sessionRuntime.runSingleTurn(started.sessionId, prompt).catch(() => null);
        runtime.eventBus.emit({ botIds: [caller.bot.id], kinds: ['workers', 'items', 'chats'] });
        return okOut(JSON.stringify({ work, sessionId: started.sessionId, dispatchId }));
      },
    ),

    makeTool(
      'bot_send',
      'Send a handoff, question, or status message to another local bot.',
      {
        toBotId: { type: 'string', description: 'Target bot id or name.', required: true },
        purpose: { type: 'string', description: 'status | handoff | question.', required: true },
        text: { type: 'string', description: 'Message content.', required: true },
        rootKey: { type: 'string', description: 'Optional chain root key for cycle detection.' },
        depth: { type: 'number', description: 'Current nesting depth (default 1).' },
        sendKey: { type: 'string', description: 'Optional idempotency key.' },
      },
      async (args, exec) => {
        const blocked = refuseNonOwnerIm(exec);
        if (blocked) return blocked;
        const runtime = getRuntime();
        const caller = resolveCallerBot(runtime, exec);
        if (!caller) return errOut('Caller bot context unavailable.');
        const purpose = String(args.purpose ?? '').trim();
        if (isWorkerContext(caller) && purpose === 'handoff') {
          return errOut('Coding worker sessions cannot initiate a handoff to another bot directly. Report status back to your owning bot or owner instead (purpose="status").');
        }
        const allBots = runtime.botsStore.listBots();
        const activePeers = allBots.filter((/** @type {any} */ b) => b.id !== caller.bot.id && !b.paused).map((/** @type {any} */ b) => b.name);
        const peerHint = activePeers.length > 0
          ? `Available active bots: ${activePeers.join(', ')}.`
          : 'No other active bots are currently available on this machine.';

        const rawTarget = String(args.toBotId ?? '').trim();
        const target = runtime.botsStore.getBot(rawTarget) ?? runtime.botsStore.getBotByName(rawTarget);
        if (!target) {
          return errOut(`Target bot not found: "${rawTarget}". ${peerHint}`);
        }
        if (target.id === caller.bot.id || (target.chatSessionId && target.chatSessionId === caller.sessionId)) {
          return errOut(`Cannot send a bot_send message to yourself ("${caller.bot.name}") in the same chat. Handle the step directly or choose another bot. ${peerHint}`);
        }
        if (target.paused === true) {
          return errOut(`Bot "${target.name}" is currently paused and cannot accept messages. Ask the owner to resume "${target.name}" or pick another teammate. ${peerHint}`);
        }
        const text = String(args.text ?? '').trim();
        if (!text) return errOut('text is required.');

        const reqRes = runtime.workStore.createRequest({
          rootKey: args.rootKey || `root-${caller.sessionId}`,
          fromBotId: caller.bot.id,
          toBotId: target.id,
          purpose,
          depth: Number.isInteger(args.depth) ? args.depth : 1,
          sendKey: args.sendKey ?? null,
          record: { text, fromName: caller.bot.name },
        });
        if (!reqRes.deduplicated) {
          const home = await runtime.sessionRuntime.openHomeChat(target.id);
          void runtime.sessionRuntime.runSingleTurn(
            home.sessionId,
            `[From bot ${caller.bot.name} (${purpose})]\n${text}`,
          ).catch(() => null);
          runtime.workStore.setRequestOutcome(reqRes.request.messageId, 'posted');
        }
        return okOut(JSON.stringify(reqRes));
      },
    ),

    makeTool(
      'bot_tools_manage',
      'List, add, update, or remove per-bot MCP tool servers (mutations require desktop confirmation).',
      {
        action: { type: 'string', description: 'list | add | update | remove.', required: true },
        name: { type: 'string', description: 'Server name (for update/remove).' },
        expectedVersion: { type: 'string', description: 'Optional optimistic version token from tools list.' },
        server: {
          type: 'object',
          description: 'Server spec (for add/update).',
          additionalProperties: true,
          properties: {
            name: { type: 'string' },
            transport: { type: 'string' },
            url: { type: 'string' },
            command: { type: 'string' },
          },
        },
      },
      async (args, exec) => {
        const runtime = getRuntime();
        const caller = resolveCallerBot(runtime, exec);
        if (!caller) return errOut('Caller bot context unavailable.');
        const action = String(args.action ?? '').trim();
        if (action === 'list') {
          return okOut(JSON.stringify(await runtime.botsService.toolsList(caller.bot.id)));
        }
        if (!['add', 'update', 'remove'].includes(action)) {
          return errOut(`Unknown bot_tools_manage action: ${action}`);
        }
        const effect = action === 'remove' ? 'destructive' : 'code';
        const refused = await requireConfirm({
          tool: 'bot_tools_manage',
          action,
          effect,
          summary: `${caller.bot.name} 请求执行 MCP 工具操作：${action} ${args.name ?? args.server?.name ?? ''}`,
          details: JSON.stringify(args.server ?? { name: args.name }).slice(0, 400),
        }, exec);
        if (refused) return refused;

        const opts = args.expectedVersion ? { expectedVersion: args.expectedVersion } : {};
        if (action === 'add') return okOut(JSON.stringify(await runtime.botsService.toolsAdd(caller.bot.id, args.server, opts)));
        if (action === 'update') return okOut(JSON.stringify(await runtime.botsService.toolsUpdate(caller.bot.id, args.name, args.server, opts)));
        return okOut(JSON.stringify(await runtime.botsService.toolsRemove(caller.bot.id, args.name, opts)));
      },
      CONFIRM_TOOL_TIMEOUT_MS,
    ),

    makeTool(
      'bot_automation_create',
      'Create, update, or delete local scheduled automations or one-shot waits.',
      {
        action: { type: 'string', description: 'create | update | delete (default create).' },
        id: { type: 'string', description: 'Automation id (for update/delete).' },
        name: { type: 'string', description: 'Automation title.' },
        prompt: { type: 'string', description: 'Prompt executed when triggered.' },
        schedule: { type: 'string', description: 'Cron/RRule string.' },
        intervalMinutes: { type: 'number', description: 'Simple interval in minutes.' },
        once: {
          type: 'object',
          description: 'One-shot wait spec { by?: epochMs }.',
          additionalProperties: true,
          properties: { by: { type: 'number' } },
        },
        runsIn: { type: 'string', description: 'chat | new.' },
      },
      async (args, exec) => {
        const blocked = refuseNonOwnerIm(exec);
        if (blocked) return blocked;
        const runtime = getRuntime();
        const caller = resolveCallerBot(runtime, exec);
        if (!caller) return errOut('Caller bot context unavailable.');
        const action = String(args.action || 'create').trim();
        if (!['create', 'update', 'delete'].includes(action)) {
          return errOut(`Invalid automation action: ${action}`);
        }

        if (action === 'delete') return okOut(JSON.stringify(runtime.automationsService.delete(args.id)));
        if (action === 'update') return okOut(JSON.stringify(runtime.automationsService.update(args.id, args)));
        return okOut(JSON.stringify(runtime.automationsService.create({ ...args, botId: caller.bot.id })));
      },
    ),

    makeTool(
      'bot_reply',
      'Send a reply (text, optional quick choices, files, or emoji reaction) to the external IM channel or thread (requires desktop confirmation).',
      BOT_REPLY_TOOL_SCHEMA,
      async (args, exec) => {
        const blocked = refuseNonOwnerIm(exec);
        if (blocked) return blocked;
        const runtime = getRuntime();
        const caller = resolveCallerBot(runtime, exec);
        if (!caller) return errOut('Caller bot context unavailable.');

        const validated = validateBotReplyArgs(args);
        if (!validated.ok) return errOut(`${validated.code}: ${validated.reason}`);
        const payload = validated.data;
        const targetChannel = payload.channel ?? caller.chat?.externalSource ?? null;

        const refused = await requireConfirm({
          tool: 'bot_reply',
          action: 'reply',
          effect: 'external',
          summary: `${caller.bot.name} 请求向外部渠道${targetChannel ? ` (${targetChannel})` : ''}发送回复`,
          details: formatReplyConfirmDetails(payload),
        }, exec);
        if (refused) return refused;
        return deliverApprovedBotReply(runtime, caller, payload, targetChannel);
      },
      CONFIRM_TOOL_TIMEOUT_MS,
    ),

    makeTool(
      'bot_new_chat',
      'Start a new independent side chat session for this bot (governed by Harness sandbox & approval).',
      {
        title: { type: 'string', description: 'Title for the new side chat.' },
        prompt: { type: 'string', description: 'Optional initial prompt.' },
      },
      async (args, exec) => {
        const blocked = refuseNonOwnerIm(exec);
        if (blocked) return blocked;
        const runtime = getRuntime();
        const caller = resolveCallerBot(runtime, exec);
        if (!caller) return errOut('Caller bot context unavailable.');

        const started = await runtime.sessionRuntime.startSideChat(caller.bot.id, { title: args.title });
        if (args.prompt) {
          void runtime.sessionRuntime.runSingleTurn(started.sessionId, String(args.prompt)).catch(() => null);
        }
        return okOut(JSON.stringify({ sessionId: started.sessionId, chat: started.chat }));
      },
    ),
  ];

  return [
    ...basicTools,
    ...buildBotItemTools(getRuntime, resolveCallerBot),
    ...guardedTools,
  ].map((def) => wrapWithLookAroundPolicy(def, getRuntime));
}

/**
 * Register all 22 native bot tools on a Harness `ctx.tools` registry.
 * @param {any} ctx
 * @param {{ defineTool?: (spec: any) => any, getRuntime?: () => any, confirmAction?: typeof confirmModelAction }} [options]
 */
export function registerBotTools(ctx, options = {}) {
  const wrap = typeof options.defineTool === 'function' ? options.defineTool : (spec) => spec;
  const defs = buildBotToolDefinitions(options.getRuntime ?? getActiveBotsRuntime, options);
  const disposers = [];
  for (const def of defs) {
    const off = ctx?.tools?.register?.(wrap(def));
    if (typeof off === 'function') disposers.push(off);
  }
  return () => {
    for (const off of disposers) {
      try { off(); } catch { /* Best-effort tool unregister. */ }
    }
  };
}
