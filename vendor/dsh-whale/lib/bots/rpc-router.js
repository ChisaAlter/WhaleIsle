/**
 * Unified `/dsh-bots` HTTP router:
 * - `GET  /dsh-bots/assets/mascots/<filename>` — Whitelisted immutable mascot assets (pre-auth)
 * - `POST /dsh-bots/webhooks/<id>`             — HMAC-SHA256 signed inbound webhooks (pre-auth)
 * - `GET  /dsh-bots/events`                    — Real-time SSE (`event: bots:changed`)
 * - `POST /dsh-bots/rpc`                       — JSON RPC dispatcher (`{ method, params }` -> `{ ok, result | error }`)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BOT_ALL_TEMPLATES,
  BotsDisabledError,
  searchTemplates,
} from '../../src/shared/index.js';
import { diffPromptSnapshots, inspectPrompt } from './prompt-engine.js';
import { scanTextForSecrets } from './share-import-service.js';

const MAX_RPC_BODY_BYTES = 4 * 1024 * 1024;
const MAX_WEBHOOK_BODY_BYTES = 1 * 1024 * 1024;
const MASCOT_FILE_RE = /^(?:[A-Z][0-9](?:-rim)?\.(?:svg|webp)|manifest\.json)$/;
const ASSETS_MASCOTS_DIR = fileURLToPath(new URL('../../assets/mascots/', import.meta.url));
const WEBHOOKS_PREFIX = '/dsh-bots/webhooks/';

const ALLOWED_WHEN_DISABLED = new Set([
  'bots.list',
  'bots.settings.get',
  'bots.settings.set',
  'bots.settings.update',
  'bots.models',
  'bots.agentChoices',
  'bots.roster',
  'bots.voice.state',
]);

/** @param {string} filename */
function mascotContentType(filename) {
  if (filename.endsWith('.svg')) return 'image/svg+xml; charset=utf-8';
  if (filename.endsWith('.webp')) return 'image/webp';
  return 'application/json; charset=utf-8';
}

/** @param {any} req @param {number} maxBytes */
async function readBoundedBuffer(req, maxBytes) {
  const declared = req.headers?.['content-length'];
  if (declared !== undefined && Number(declared) > maxBytes) {
    throw Object.assign(new Error('payload too large'), { status: 413, code: 'payload_too_large' });
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.byteLength;
    if (total > maxBytes) {
      req.destroy?.();
      throw Object.assign(new Error('payload too large'), { status: 413, code: 'payload_too_large' });
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/** @param {any} req @param {number} maxBytes */
async function readBoundedJson(req, maxBytes) {
  const raw = await readBoundedBuffer(req, maxBytes);
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw Object.assign(new Error('body is not valid JSON'), { status: 400, code: 'invalid_json' });
  }
}

/** @param {any} res @param {number} status @param {any} payload @param {Record<string, string>} [extraHeaders] */
function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...extraHeaders });
  res.end(JSON.stringify(payload));
}

/** @param {any} ctx */
function resolveRegisteredWorkspaceDirs(ctx) {
  const reg = ctx?.get?.('workspaceRegistry');
  if (typeof reg?.list !== 'function') return [];
  try {
    return reg.list().map((w) => w?.path).filter((p) => typeof p === 'string' && p.trim());
  } catch {
    return [];
  }
}

/** @param {any} raw */
function formatPromptSnapshotForUi(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const systemPrompt = [raw.identityPrompt, raw.memoryPrompt].filter(Boolean).join('\n\n');
  const tools = Array.isArray(raw.toolsUsed) && raw.toolsUsed.length > 0
    ? raw.toolsUsed
    : (Array.isArray(raw.availableTools) ? raw.availableTools : []);
  return {
    ...raw,
    at: raw.capturedAt ?? raw.at ?? null,
    systemPrompt,
    systemChars: raw.charCount ?? systemPrompt.length,
    tools,
  };
}

/** @param {any} inspected */
function formatPromptInspectResult(inspected) {
  const snapshots = Array.isArray(inspected.snapshots)
    ? inspected.snapshots.map(formatPromptSnapshotForUi).filter(Boolean)
    : [];
  const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  const livePrompt = [inspected.live?.identityPrompt, inspected.live?.memoryPrompt].filter(Boolean).join('\n\n');
  return {
    ...inspected,
    snapshots,
    latestSnapshot: latest,
    latest,
    systemPrompt: latest?.systemPrompt || livePrompt,
    tools: latest?.tools ?? [],
    linkedSkills: latest?.linkedSkills ?? inspected.live?.linkedSkills ?? [],
    updatedAt: latest?.at ?? null,
  };
}

/** @param {any} diff */
function formatPromptDiffResult(diff) {
  const addedLines = Array.isArray(diff.addedLines) ? diff.addedLines : [];
  const removedLines = Array.isArray(diff.removedLines) ? diff.removedLines : [];
  const addedTools = Array.isArray(diff.toolsAdded) ? diff.toolsAdded : [];
  const removedTools = Array.isArray(diff.toolsRemoved) ? diff.toolsRemoved : [];
  const changed = addedLines.length > 0 || removedLines.length > 0 || addedTools.length > 0 || removedTools.length > 0;
  return {
    ...diff,
    addedTools,
    removedTools,
    changed,
  };
}

/** @param {any} summary */
function formatBudgetUsageResult(summary) {
  return {
    ...summary,
    ...(summary.today ?? {}),
    isOffPeak: summary.peakValley?.isOffPeak,
    nextPeakSwitchMs: summary.peakValley?.msRemaining ?? null,
    nextPeakSwitchAt: summary.peakValley?.nextSwitchMs ?? null,
  };
}

/** @param {any} connectorsService @param {string} botId */
function formatConnectorsListResult(connectorsService, botId) {
  const base = connectorsService.listConnectors(botId);
  const allRoutes = connectorsService.listChannelBotRoutes?.()?.routes ?? {};
  /** @type {Record<string, string>} */
  const routes = {};
  for (const [key, entry] of Object.entries(allRoutes)) {
    if (entry && typeof entry.botId === 'string' && entry.botId) {
      routes[key] = entry.botId;
    }
  }
  const imChannels = Array.isArray(base.imChannels)
    ? base.imChannels.map((/** @type {any} */ ch) => ({
      ...ch,
      routeBotId: routes[ch.kind] ?? (ch.routes?.[0]?.botId ?? null),
    }))
    : [];
  return { ...base, routes, imChannels };
}

/** @param {unknown} rawName */
function sanitizeRecordedSkillSlug(rawName) {
  const cleaned = String(rawName ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 64);
  return cleaned || 'recorded-skill';
}

/** @param {any} runtime @param {any} p */
function saveRecordedSkillToBot(runtime, p) {
  const botId = p?.botId ?? p?.id;
  const skillMd = String(p?.skillMd ?? p?.markdown ?? p?.content ?? '').trim();
  if (!skillMd) {
    throw Object.assign(new Error('skillMd content is required'), { code: 'invalid_argument' });
  }
  const findings = scanTextForSecrets(skillMd, 'SKILL.md');
  if (findings.length > 0) {
    throw Object.assign(
      new Error('Plaintext secret detected in recorded skill draft; redact before saving'),
      { code: 'secret_detected', data: { findings } },
    );
  }
  const slug = sanitizeRecordedSkillSlug(p?.name);
  const relPath = `skills/${slug}/SKILL.md`;
  runtime.botsService.filesWrite(botId, relPath, `${skillMd}\n`);
  runtime.eventBus?.emit({ botIds: [String(botId)], kinds: ['bot'] });
  return { ok: true, botId: String(botId), name: slug, path: relPath };
}

/** @param {any} runtime @param {string} trigger */
function scheduleOwedMailReconcile(runtime, trigger) {
  const reconciler = runtime.mailReconciler;
  if (!reconciler || typeof reconciler.reconcileOwedMail !== 'function') return;
  /** @param {unknown} error @param {Record<string, any>} [extra] */
  const reportErr = (error, extra = {}) => {
    if (typeof runtime.onError === 'function') {
      runtime.onError(error, { phase: 'mail_reconciler', trigger, ...extra });
      return;
    }
    console.error('[dsh-bots:mail-reconciler]', trigger, error instanceof Error ? error.message : String(error), extra);
  };
  void Promise.resolve()
    .then(() => {
      if (runtime.isClosed?.()) return null;
      return reconciler.reconcileOwedMail();
    })
    .then((outcome) => {
      if (outcome && outcome.ok === false && outcome.failedGroups > 0) {
        reportErr(new Error(`owedMail reconcile had ${outcome.failedGroups} failed group(s)`), {
          errors: outcome.errors,
        });
      }
    })
    .catch((error) => {
      reportErr(error);
    });
}

/**
 * @param {any} runtime
 * @param {any} ownerActor
 * @returns {Record<string, (p: any) => any>}
 */
function buildItemRpcHandlers(runtime, ownerActor) {
  const { itemsStore, botsStore, eventBus } = runtime;

  /** @param {any} p */
  const ownerShow = (p) => {
    const uid = String(p?.uid ?? p?.id ?? '');
    const item = itemsStore.get(uid);
    if (!item) throw Object.assign(new Error(`Item not found: ${uid}`), { code: 'not_found' });
    return {
      item,
      links: itemsStore.links(uid),
      ...itemsStore.events(uid, { after: p?.after ?? 0, limit: p?.limit }),
    };
  };

  /** @param {any} p */
  const ownerStatus = (p) => {
    const uids = p?.uids ?? (p?.uid ? [p.uid] : []);
    const res = itemsStore.ownerStatus(uids, { status: p?.status, reason: p?.reason, note: p?.note }, ownerActor);
    const affected = [...new Set(res.updated.map((/** @type {any} */ i) => i.ownerBotId))];
    if (affected.length) eventBus.emit({ botIds: affected, kinds: ['items'] });
    scheduleOwedMailReconcile(runtime, 'ownerStatus');
    return res;
  };

  /** @param {any} p */
  const ownerSnooze = (p) => {
    const res = itemsStore.ownerSnooze({ items: p?.items ?? [], until: p?.until ?? null }, ownerActor);
    const affected = [...new Set(res.items.map((/** @type {any} */ i) => i.ownerBotId))];
    if (affected.length) eventBus.emit({ botIds: affected, kinds: ['items'] });
    scheduleOwedMailReconcile(runtime, 'ownerSnooze');
    return res;
  };

  /** @param {any} p */
  const ownerComment = (p) => {
    const res = itemsStore.ownerComment(p?.uid ?? p?.id, {
      text: p?.text,
      images: p?.images,
      files: p?.files,
      requestId: p?.requestId,
    }, ownerActor);
    eventBus.emit({ botIds: [res.item.ownerBotId], kinds: ['items'] });
    scheduleOwedMailReconcile(runtime, 'ownerComment');
    return res;
  };

  return {
    'bots.items.owner.list': (p) => ({
      items: itemsStore.viewRows({
        ownerBotId: p?.botId ?? p?.ownerBotId,
        includeClosed: p?.includeClosed === true,
      }),
      latestEventId: itemsStore.latestEventId(p?.botId ?? p?.ownerBotId ?? null),
    }),
    'bots.items.owner.show': ownerShow,
    'bots.items.detail': ownerShow,
    'bots.items.owner.opened': (p) => {
      const botId = String(p?.botId ?? p?.id ?? '');
      const seen = Number.isInteger(p?.eventId) ? p.eventId : itemsStore.latestEventId(botId);
      botsStore.updateBot(botId, { itemsSeen: seen });
      eventBus.emit({ botIds: [botId], kinds: ['items'] });
      return { ok: true, botId, itemsSeen: seen };
    },
    'bots.items.owner.status': ownerStatus,
    'bots.items.ownerStatus': ownerStatus,
    'bots.items.owner.snooze': ownerSnooze,
    'bots.items.ownerSnooze': ownerSnooze,
    'bots.items.owner.comment': ownerComment,
    'bots.items.ownerComment': ownerComment,
    'bots.items.add': (p) => {
      const res = itemsStore.add(p, p?.actor ?? ownerActor);
      eventBus.emit({ botIds: [res.item.ownerBotId], kinds: ['items'] });
      return res;
    },
    'bots.items.set': (p) => {
      const res = itemsStore.set(p?.uid ?? p?.id, p, p?.actor ?? ownerActor);
      eventBus.emit({ botIds: [res.item.ownerBotId], kinds: ['items'] });
      return res;
    },
    'bots.items.comment': (p) => {
      const res = itemsStore.comment(p?.uid ?? p?.id, p, p?.actor ?? ownerActor);
      eventBus.emit({ botIds: [res.item.ownerBotId], kinds: ['items'] });
      return res;
    },
    'bots.items.done': (p) => {
      const res = itemsStore.close(p?.uid ?? p?.id, { status: 'done', note: p?.note }, p?.actor ?? ownerActor);
      eventBus.emit({ botIds: [res.item.ownerBotId], kinds: ['items'] });
      return res;
    },
    'bots.items.cancel': (p) => {
      const res = itemsStore.close(p?.uid ?? p?.id, { status: 'canceled', reason: p?.reason }, p?.actor ?? ownerActor);
      eventBus.emit({ botIds: [res.item.ownerBotId], kinds: ['items'] });
      return res;
    },
    'bots.items.link': (p) => {
      const res = itemsStore.link(p?.uid ?? p?.id, p?.links ?? [], p?.actor ?? ownerActor);
      eventBus.emit({ botIds: [res.item.ownerBotId], kinds: ['items'] });
      return res;
    },
    'bots.items.list': (p) => itemsStore.list(p),
    'bots.items.show': (p) => {
      const uid = String(p?.uid ?? p?.id ?? '');
      const item = itemsStore.get(uid);
      if (!item) throw Object.assign(new Error(`Item not found: ${uid}`), { code: 'not_found' });
      return { item, links: itemsStore.links(uid), ...itemsStore.events(uid, { after: p?.after ?? 0 }) };
    },
  };
}

/**
 * @param {any} runtime
 * @returns {Record<string, (p: any) => any>}
 */
function buildMemoryAndGovernanceRpcHandlers(runtime) {
  const { botsService, memoryService, tidyUpService, budgetService, mcpManager } = runtime;
  /** @param {any} p */
  const readTeam = (p) => memoryService.readTeamMemory(p?.groupId ?? p?.id);
  /** @param {any} p */
  const writeTeam = (p) => memoryService.writeTeamMemory(p?.groupId ?? p?.id, p?.content ?? '');

  return /** @type {Record<string, (p: any) => any>} */ ({
    // Prompt inspector & diff
    'bots.prompt.inspect': (p) => formatPromptInspectResult(inspectPrompt(runtime, p?.botId ?? p?.id)),
    'bots.prompt.diff': (p) => formatPromptDiffResult(
      diffPromptSnapshots(runtime, p?.botId ?? p?.id, p?.fromIdx, p?.toIdx),
    ),

    // Budget & peak/off-peak usage
    'bots.budget.get': (p) => budgetService.getBudget(p?.botId ?? p?.id),
    'bots.budget.set': (p) => budgetService.setBudget(p?.botId ?? p?.id, p?.patch ?? p),
    'bots.budget.usage': (p) => formatBudgetUsageResult(
      budgetService.getBudgetSummary(p?.botId ?? p?.id, { dayUtc: p?.dayUtc, days: p?.days }),
    ),

    // Crew adoption & Decisions TSV
    'bots.crew.list': (p) => botsService.listCrewAdoptions({
      botId: p?.botId ?? p?.id ?? null,
      status: p?.status ?? 'active',
    }),
    'bots.crew.adopt': (p) => botsService.adoptSession(p?.botId ?? p?.id, p),
    'bots.crew.release': (p) => botsService.releaseCrewSession(p?.sessionId ?? p?.id),
    'bots.decisions.read': (p) => botsService.decisionsRead(p?.botId ?? p?.id, p?.itemUid ?? p?.uid ?? p?.itemId),
    'bots.decisions.append': (p) => botsService.decisionsAppend(
      p?.botId ?? p?.id,
      p?.itemUid ?? p?.uid ?? p?.itemId,
      p?.row ?? p,
    ),

    // Memory & Tidy-up
    'bots.memory.list': (p) => botsService.memoryList(p?.botId ?? p?.id),
    'bots.memory.read': (p) => botsService.memoryList(p?.botId ?? p?.id),
    'bots.memory.add': (p) => botsService.memoryAdd(p?.botId ?? p?.id, p),
    'bots.memory.edit': (p) => botsService.memoryEdit(p?.botId ?? p?.id, p),
    'bots.memory.forget': (p) => botsService.memoryForget(p?.botId ?? p?.id, p),
    'bots.memory.history': (p) => botsService.memoryHistory(p?.botId ?? p?.id, p),
    'bots.memory.undo': (p) => botsService.memoryUndo(p?.botId ?? p?.id, p),
    'bots.memory.search': (p) => {
      const rawScope = typeof p?.scope === 'string' ? p.scope.trim().toLowerCase() : '';
      const scope = !rawScope || rawScope === 'all' ? null : rawScope;
      const results = memoryService.searchMemory({
        botId: p?.botId ?? p?.id ?? null,
        query: p?.query ?? '',
        scope,
        groupId: p?.groupId ?? null,
        projectId: p?.projectId ?? null,
        limit: p?.limit ?? 20,
      });
      return { results, hits: results };
    },
    'bots.memory.teamRead': readTeam,
    'bots.memory.team.read': readTeam,
    'bots.memory.teamWrite': writeTeam,
    'bots.memory.team.write': writeTeam,
    'bots.tidyUp.get': (p) => tidyUpService.getStatus(p?.botId ?? p?.id),
    'bots.tidyUp.now': (p) => tidyUpService.runNow(p?.botId ?? p?.id),
    'bots.tidyUp.undo': (p) => tidyUpService.undoLast(p?.botId ?? p?.id, p?.changeId ?? null),

    // Per-Bot MCP tools problems
    'bots.tools.problems': (p) => mcpManager.listBotToolsProblems(p?.botId ?? p?.id ?? null),
  });
}

/**
 * Build the complete method dispatch table mapping every `bots.*` RPC method
 * to the runtime services.
 * @param {any} runtime
 * @returns {Record<string, (p: any) => any>}
 */
export function buildRpcDispatchTable(runtime) {
  const {
    ctx,
    botsService,
    sessionRuntime,
    lookAroundService,
    groupsService,
    automationsService,
    connectorsService,
    shareImportService,
    workStore,
  } = runtime;

  const ownerActor = { kind: 'owner' };

  /** @type {Record<string, (p: any) => any>} */
  const table = {
    // Global & list
    'bots.list': () => botsService.listBotsView(),
    'bots.settings.get': () => botsService.getGlobalSettings(),
    'bots.settings.set': (p) => botsService.updateGlobalSettings(p),
    'bots.settings.update': (p) => botsService.updateGlobalSettings(p),
    'bots.roster': () => botsService.roster(),
    'bots.models': () => sessionRuntime.listModels(),
    'bots.agentChoices': () => sessionRuntime.listModels(),
    'bots.templates.suggest': (p) => searchTemplates(p?.query ?? '', p?.category ?? 'all'),
    'bots.templates.list': () => BOT_ALL_TEMPLATES,

    // Bot lifecycle
    'bots.create': (p) => botsService.createBot(p),
    'bots.update': (p) => botsService.updateBot(p?.botId ?? p?.id, p?.patch ?? p),
    'bots.delete': (p) => botsService.deleteBot(p?.botId ?? p?.id, { deleteFolder: p?.deleteFolder === true }),
    'bots.kickoff.retry': (p) => sessionRuntime.retryKickoff(p?.botId ?? p?.id),
    'bots.takeOver': (p) => sessionRuntime.takeOverWorkspace(p?.botId ?? p?.id, p),
    'bots.createOffer': (p) => botsService.createBot({
      ...p,
      ...(p?.purpose && !p?.description ? { description: p.purpose } : {}),
      fromOffer: p?.fromOffer ?? (p?.fromBotId
        ? { proposerBotId: p.fromBotId, purpose: p.purpose, offerId: p.offerId }
        : p),
    }),

    // Avatar
    'bots.avatar.read': (p) => botsService.avatarRead(p?.botId ?? p?.id),
    'bots.avatar.upload': (p) => botsService.avatarUpload(p?.botId ?? p?.id, p?.base64Png ?? p?.dataUrl ?? p?.image),

    // Chats & activity
    'bots.chat.open': (p) => sessionRuntime.openHomeChat(p?.botId ?? p?.id, p),
    'bots.chat.reset': (p) => sessionRuntime.resetHomeChat(p?.botId ?? p?.id),
    'bots.session.start': (p) => sessionRuntime.startSideChat(p?.botId ?? p?.id, p),
    'bots.chats': (p) => sessionRuntime.listChats(p?.botId ?? p?.id, p),
    'bots.chats.own': (p) => sessionRuntime.listChats(p?.botId ?? p?.id, { includeClosed: false }),
    'bots.chats.search': (p) => sessionRuntime.searchChats(p),
    'bots.chats.seen': (p) => sessionRuntime.markSeen(p?.sessionId ?? p?.chatId),
    'bots.chats.unseen': (p) => sessionRuntime.markUnseen(p?.sessionId ?? p?.chatId),
    'bots.chatTree': (p) => sessionRuntime.buildChatTree(p?.botId ?? p?.id),
    'bots.activity': (p) => sessionRuntime.buildActivity(p?.botId ?? p?.id),
    'bots.request.outcome': (p) => workStore.getRequestOutcome(p?.messageId),

    // SOUL & files
    'bots.soul.read': (p) => botsService.soulRead(p?.botId ?? p?.id),
    'bots.soul.write': (p) => botsService.soulWrite(p?.botId ?? p?.id, {
      content: p?.content ?? p?.text,
      expectedSignature: p?.expectedSignature,
    }),
    'bots.files.list': (p) => botsService.filesList(p?.botId ?? p?.id, p?.subDir ?? p?.path ?? ''),
    'bots.files.read': (p) => botsService.filesRead(p?.botId ?? p?.id, p?.path ?? p?.relPath),
    'bots.files.write': (p) => botsService.filesWrite(p?.botId ?? p?.id, p?.path ?? p?.relPath, p?.content),

    ...buildMemoryAndGovernanceRpcHandlers(runtime),
    ...buildItemRpcHandlers(runtime, ownerActor),

    // Look Around & Up Next
    'bots.lookAround.lookNow': (p) => lookAroundService.lookNow(p?.botId ?? p?.id),
    'bots.lookAround.set': (p) => lookAroundService.setConfig(p?.botId ?? p?.id, p?.patch ?? p),
    'bots.upNext.list': (p) => lookAroundService.getState(p?.botId ?? p?.id),
    'bots.upNext.seen': (p) => lookAroundService.markSeen(p?.botId ?? p?.id),
    'bots.upNext.unseen': (p) => lookAroundService.markUnseen(p?.botId ?? p?.id),
    'bots.suggest': (p) => lookAroundService.addSuggestion(p?.botId ?? p?.id, p),
    'bots.suggestions.start': (p) => lookAroundService.startSuggestion(p?.botId, p?.suggestionId ?? p?.id, p),
    'bots.suggestions.dismiss': (p) => lookAroundService.dismissSuggestion(p?.botId, p?.suggestionId ?? p?.id),

    // Multi-bot Groups
    'bots.groups.list': () => groupsService.list(),
    'bots.groups.create': (p) => groupsService.create(p),
    'bots.groups.update': (p) => groupsService.update(p),
    'bots.groups.delete': (p) => groupsService.delete(p),
    'bots.groups.reorder': (p) => groupsService.reorder(p?.orderedIds ?? p?.ids ?? []),
    'bots.groups.read': (p) => groupsService.read(p),
    'bots.groups.messages': (p) => groupsService.read(p),
    'bots.groups.send': (p) => groupsService.send(p),
    'bots.groups.approvePlan': (p) => groupsService.approveGroupPlan(p),
    'bots.groups.stop': (p) => groupsService.stop(p),
    'bots.groups.newThread': (p) => groupsService.newThread(p),

    // Per-Bot MCP Tools, Skill Projects & Work
    'bots.tools.list': (p) => botsService.toolsList(p?.botId ?? p?.id),
    'bots.tools.add': (p) => botsService.toolsAdd(p?.botId ?? p?.id, p?.server ?? p),
    'bots.tools.update': (p) => botsService.toolsUpdate(p?.botId ?? p?.id, p?.name, p?.patch ?? p?.server ?? p),
    'bots.tools.remove': (p) => botsService.toolsRemove(p?.botId ?? p?.id, p?.name),
    'bots.tools.details': (p) => botsService.toolsDetails(p?.botId ?? p?.id, p?.name),
    'bots.skillProjects.scan': (p) => botsService.scanSkillProjects(
      Array.isArray(p?.dirs) ? p.dirs : resolveRegisteredWorkspaceDirs(ctx),
    ),
    'bots.work.list': (p) => workStore.listWork({ botId: p?.botId, openOnly: p?.openOnly === true }),
    'bots.work.forget': (p) => workStore.forgetWork(p?.botId, p?.source ?? 'app', p?.externalId ?? p?.sessionId),

    // Automations & Waits
    'bots.automations.list': (p) => automationsService.list(p),
    'bots.automations.create': (p) => automationsService.create(p),
    'bots.automations.update': (p) => automationsService.update(p?.id, p?.patch ?? p),
    'bots.automations.delete': (p) => automationsService.delete(p?.id),
    'bots.automations.runNow': (p) => automationsService.runNow(p?.id),
    'bots.automations.cancelWait': (p) => automationsService.cancelWait(p?.botId, p?.waitId ?? p?.id),
    'bots.automations.claims': (p) => ({ claims: automationsService.listClaims(p) }),
    'bots.sendRunAgain': (p) => automationsService.sendRunAgain(p),

    // Connectors, Routes, Webhooks & Access
    'bots.connectors': (p) => formatConnectorsListResult(connectorsService, p?.botId ?? p?.id),
    'bots.connectors.list': (p) => formatConnectorsListResult(connectorsService, p?.botId ?? p?.id),
    'bots.connectors.update': (p) => connectorsService.updateConnectors(p?.botId ?? p?.id, p?.patch ?? p),
    'bots.connectors.setRoute': (p) => connectorsService.setChannelBotRoute(p),
    'bots.connectors.routes': () => connectorsService.listChannelBotRoutes(),
    'bots.connectors.webhooks.list': (p) => ({ webhooks: connectorsService.listWebhooks(p?.botId ?? p?.id) }),
    'bots.connectors.webhooks.create': (p) => connectorsService.createWebhook(p?.botId ?? p?.id, p),
    'bots.connectors.webhooks.delete': (p) => connectorsService.deleteWebhook(
      p?.botId ?? p?.id,
      p?.webhookId ?? p?.id,
    ),
    'bots.access.list': (p) => connectorsService.listAccessRequests(p),
    'bots.access.decide': (p) => connectorsService.decideAccessRequest(p),
    'bots.access.redeem': (p) => connectorsService.redeemAccessToken(p),

    // Skill Recorder & Desktop Pet Voice bridges
    'bots.skill.recordDraft': (p) => runtime.recordSkillDraft(p),
    'bots.skill.recordSave': (p) => saveRecordedSkillToBot(runtime, p),
    'bots.voice.state': () => runtime.voiceState(),
    'bots.voice.toggle': (p) => runtime.voiceToggle(p?.enabled),

    // Sharing & Import
    'bots.share.prepare': (p) => shareImportService.prepareShare(p?.botId ?? p?.id, p),
    'bots.share.export': (p) => shareImportService.prepareShare(p?.botId ?? p?.id, p),
    'bots.share.review': (p) => shareImportService.reviewPackage(p?.packageJson ?? p?.manifest ?? p),
    'bots.share.import': (p) => shareImportService.executeImport(p),
    'bots.import.sources': () => shareImportService.scanImportSources(),
    'bots.import.execute': (p) => shareImportService.executeImport(p),
  };
  return table;
}

/** @param {Buffer} rawBody */
function parseWebhookPayload(rawBody) {
  const text = rawBody.toString('utf8');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * @param {string} rawSegment
 * @returns {{ ok: true, webhookId: string } | { ok: false, status: number, code: string, message: string }}
 */
function parseInboundWebhookId(rawSegment) {
  try {
    const id = decodeURIComponent(rawSegment).trim();
    if (!id || id.includes('/')) return { ok: false, status: 404, code: 'webhook_not_found', message: 'Webhook not found' };
    return { ok: true, webhookId: id };
  } catch {
    return { ok: false, status: 400, code: 'invalid_webhook_id', message: 'Malformed webhook id' };
  }
}

/** @param {any} res @param {string} webhookId @param {any} req @param {any} ver */
function sendWebhookVerificationRejection(res, webhookId, req, ver) {
  if (ver.duplicate === true || ver.code === 'duplicate_event') {
    sendJson(res, 200, {
      ok: true,
      duplicate: true,
      deduplicated: true,
      webhookId,
      eventId: req.headers?.['x-whale-event-id'] ?? null,
      event: ver.event ?? null,
    });
    return;
  }
  /** @type {Record<string, string>} */
  const extraHeaders = ver.retryAfterSec ? { 'retry-after': String(ver.retryAfterSec) } : {};
  sendJson(res, ver.status ?? 401, {
    ok: false,
    error: { code: ver.code ?? 'unauthorized', message: ver.error ?? 'Webhook verification failed' },
  }, extraHeaders);
}

/** @param {any} runtime @param {any} ver @param {Buffer} rawBody @param {any} res */
async function dispatchVerifiedWebhook(runtime, ver, rawBody, res) {
  try {
    const dispatchRes = await runtime.automationsService.triggerWebhook({
      automationId: ver.automationId,
      botId: ver.botId,
      webhookId: ver.webhookId,
      eventId: ver.eventId,
      payload: parseWebhookPayload(rawBody),
    });
    if (ver.event?.id) {
      runtime.workStore.updateWebhookEventStatus?.(ver.event.id, 'dispatched', { automationId: ver.automationId });
    }
    sendJson(res, 200, {
      ok: true,
      duplicate: false,
      webhookId: ver.webhookId,
      eventId: ver.eventId,
      botId: ver.botId,
      matched: dispatchRes.matched,
      dispatches: dispatchRes.dispatches,
    });
  } catch (error) {
    const err = /** @type {any} */ (error);
    if (ver.event?.id) {
      runtime.workStore.updateWebhookEventStatus?.(ver.event.id, 'failed', { automationId: ver.automationId });
    }
    sendJson(res, 500, {
      ok: false,
      error: { code: 'webhook_dispatch_failed', message: String(err?.message ?? err) },
    });
  }
}

/** @param {any} runtime @param {string} rawSegment @param {any} req @param {any} res */
async function handleInboundWebhookPost(runtime, rawSegment, req, res) {
  const parsedId = parseInboundWebhookId(rawSegment);
  if (!parsedId.ok) {
    sendJson(res, parsedId.status, { ok: false, error: { code: parsedId.code, message: parsedId.message } });
    return;
  }
  if (!runtime.botsService.getGlobalSettings().botsEnabled) {
    sendJson(res, 503, { ok: false, error: { code: 'bots_disabled', message: 'Bots are disabled' } });
    return;
  }

  let rawBody;
  try {
    rawBody = await readBoundedBuffer(req, MAX_WEBHOOK_BODY_BYTES);
  } catch (error) {
    const err = /** @type {any} */ (error);
    sendJson(res, err?.status ?? 400, {
      ok: false,
      error: { code: err?.code ?? 'bad_request', message: String(err?.message ?? err) },
    });
    return;
  }

  const ver = runtime.connectorsService.verifyInboundWebhook({
    webhookId: parsedId.webhookId,
    timestamp: req.headers?.['x-whale-timestamp'],
    signature: req.headers?.['x-whale-signature'],
    eventId: req.headers?.['x-whale-event-id'],
    rawBody,
  });

  if (!ver.ok) {
    sendWebhookVerificationRejection(res, parsedId.webhookId, req, ver);
    return;
  }
  await dispatchVerifiedWebhook(runtime, ver, rawBody, res);
}

/**
 * Create the `/dsh-bots` HTTP request handler (usable both in Harness `webServer`
 * and directly in Node HTTP integration tests).
 * @param {any} runtime
 * @param {{ mascotsDir?: string, requestRejection?: (req: any) => number | undefined }} [options]
 */
export function createBotsHttpHandler(runtime, options = {}) {
  const table = buildRpcDispatchTable(runtime);
  const mascotsDir = path.resolve(options.mascotsDir || ASSETS_MASCOTS_DIR);
  const checkAuth = options.requestRejection
    ?? ((req) => runtime.ctx?.connection?.requestRejection?.(req));

  async function invokeRpc(method, params) {
    if (typeof method !== 'string' || !Object.prototype.hasOwnProperty.call(table, method)) {
      throw Object.assign(new Error(`Unknown RPC method: ${String(method)}`), { code: 'unknown_method' });
    }
    const enabled = runtime.botsService.getGlobalSettings().botsEnabled;
    if (!enabled && !ALLOWED_WHEN_DISABLED.has(method)) {
      throw new BotsDisabledError();
    }
    return table[method](params ?? {});
  }

  function serveMascotAsset(filename, res) {
    if (!MASCOT_FILE_RE.test(filename)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const target = path.resolve(mascotsDir, filename);
    if (!target.startsWith(mascotsDir + path.sep) || !fs.existsSync(target)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const data = fs.readFileSync(target);
    res.writeHead(200, {
      'content-type': mascotContentType(filename),
      'cache-control': 'public, max-age=86400, immutable',
      'content-length': data.byteLength,
    });
    res.end(data);
  }

  async function handleRpcPost(req, res) {
    const contentType = String(req.headers?.['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
    if (contentType !== 'application/json') {
      sendJson(res, 415, { ok: false, error: { code: 'unsupported_media_type', message: 'content type must be application/json' } });
      return;
    }
    let body;
    try {
      body = await readBoundedJson(req, MAX_RPC_BODY_BYTES);
    } catch (error) {
      sendJson(res, error?.status ?? 400, {
        ok: false,
        error: { code: error?.code ?? 'bad_request', message: String(error?.message ?? error) },
      });
      return;
    }
    try {
      const result = await invokeRpc(body?.method, body?.params);
      sendJson(res, 200, { ok: true, result });
    } catch (error) {
      sendJson(res, 200, {
        ok: false,
        error: {
          code: String(error?.code ?? 'internal_error'),
          message: String(error?.message ?? error),
          ...(error?.data !== undefined ? { data: error.data } : {}),
        },
      });
    }
  }

  async function handler(req, res) {
    const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname;
    if (req.method === 'GET' && pathname.startsWith('/dsh-bots/assets/mascots/')) {
      serveMascotAsset(pathname.slice('/dsh-bots/assets/mascots/'.length), res);
      return;
    }
    if (req.method === 'POST' && pathname.startsWith(WEBHOOKS_PREFIX)) {
      await handleInboundWebhookPost(runtime, pathname.slice(WEBHOOKS_PREFIX.length), req, res);
      return;
    }
    const rejection = checkAuth(req);
    if (rejection !== undefined) {
      res.writeHead(rejection);
      res.end(rejection === 401 ? 'unauthorized' : 'forbidden');
      return;
    }
    if (req.method === 'GET' && pathname === '/dsh-bots/events') {
      runtime.eventBus.handleStream(req, res);
      return;
    }
    if (req.method !== 'POST' || pathname !== '/dsh-bots/rpc') {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    await handleRpcPost(req, res);
  }

  return { handler, invokeRpc };
}
