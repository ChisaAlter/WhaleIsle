/**
 * Unified `/dsh-bots` HTTP router:
 * - `POST /dsh-bots/rpc`        — JSON RPC dispatcher (`{ method, params }` -> `{ ok, result | error }`)
 * - `GET  /dsh-bots/events`     — Real-time SSE (`event: bots:changed`)
 * - `GET  /dsh-bots/assets/mascots/<filename>` — Whitelisted immutable mascot assets
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BOT_TEMPLATES,
  BotsDisabledError,
  searchTemplates,
} from '../../src/shared/index.js';

const MAX_RPC_BODY_BYTES = 4 * 1024 * 1024;
const MASCOT_FILE_RE = /^(?:[A-Z][0-9](?:-rim)?\.(?:svg|webp)|manifest\.json)$/;
const ASSETS_MASCOTS_DIR = fileURLToPath(new URL('../../assets/mascots/', import.meta.url));

const ALLOWED_WHEN_DISABLED = new Set([
  'bots.list',
  'bots.settings.get',
  'bots.settings.set',
  'bots.settings.update',
  'bots.models',
  'bots.agentChoices',
  'bots.roster',
]);

/** @param {string} filename */
function mascotContentType(filename) {
  if (filename.endsWith('.svg')) return 'image/svg+xml; charset=utf-8';
  if (filename.endsWith('.webp')) return 'image/webp';
  return 'application/json; charset=utf-8';
}

/** @param {any} req @param {number} maxBytes */
async function readBoundedJson(req, maxBytes) {
  const declared = req.headers?.['content-length'];
  if (declared !== undefined && Number(declared) > maxBytes) {
    throw Object.assign(new Error('payload too large'), { status: 413, code: 'payload_too_large' });
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      req.destroy?.();
      throw Object.assign(new Error('payload too large'), { status: 413, code: 'payload_too_large' });
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('body is not valid JSON'), { status: 400, code: 'invalid_json' });
  }
}

/** @param {any} res @param {number} status @param {any} payload */
function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
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

/**
 * Build the complete method dispatch table mapping every `bots.*` RPC method
 * to the runtime services.
 * @param {any} runtime
 */
export function buildRpcDispatchTable(runtime) {
  const {
    ctx,
    botsService,
    sessionRuntime,
    itemsStore,
    lookAroundService,
    tidyUpService,
    groupsService,
    automationsService,
    connectorsService,
    shareImportService,
    workStore,
    botsStore,
    eventBus,
  } = runtime;

  const ownerActor = { kind: 'owner' };

  /** @type {Record<string, (p: any) => any>} */
  return {
    // Global & list
    'bots.list': () => botsService.listBotsView(),
    'bots.settings.get': () => botsService.getGlobalSettings(),
    'bots.settings.set': (p) => botsService.updateGlobalSettings(p),
    'bots.settings.update': (p) => botsService.updateGlobalSettings(p),
    'bots.roster': () => botsService.roster(),
    'bots.models': () => sessionRuntime.listModels(),
    'bots.agentChoices': () => sessionRuntime.listModels(),
    'bots.templates.suggest': (p) => searchTemplates(p?.query ?? '', p?.category ?? 'all'),
    'bots.templates.list': () => BOT_TEMPLATES,

    // Bot lifecycle
    'bots.create': (p) => botsService.createBot(p),
    'bots.update': (p) => botsService.updateBot(p?.botId ?? p?.id, p?.patch ?? p),
    'bots.delete': (p) => botsService.deleteBot(p?.botId ?? p?.id, { deleteFolder: p?.deleteFolder === true }),
    'bots.kickoff.retry': (p) => sessionRuntime.retryKickoff(p?.botId ?? p?.id),
    'bots.takeOver': (p) => sessionRuntime.takeOverWorkspace(p?.botId ?? p?.id, p),
    'bots.createOffer': (p) => botsService.createBot({ ...p, fromOffer: p?.fromOffer ?? p }),

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

    // Memory & Tidy-up
    'bots.memory.list': (p) => botsService.memoryList(p?.botId ?? p?.id),
    'bots.memory.read': (p) => botsService.memoryList(p?.botId ?? p?.id),
    'bots.memory.add': (p) => botsService.memoryAdd(p?.botId ?? p?.id, p),
    'bots.memory.edit': (p) => botsService.memoryEdit(p?.botId ?? p?.id, p),
    'bots.memory.forget': (p) => botsService.memoryForget(p?.botId ?? p?.id, p),
    'bots.memory.history': (p) => botsService.memoryHistory(p?.botId ?? p?.id, p),
    'bots.memory.undo': (p) => botsService.memoryUndo(p?.botId ?? p?.id, p),
    'bots.tidyUp.get': (p) => tidyUpService.getStatus(p?.botId ?? p?.id),
    'bots.tidyUp.now': (p) => tidyUpService.runNow(p?.botId ?? p?.id),
    'bots.tidyUp.undo': (p) => tidyUpService.undoLast(p?.botId ?? p?.id, p?.changeId ?? null),

    // Work Items (Owner + Bot)
    'bots.items.owner.list': (p) => ({
      items: itemsStore.viewRows({
        ownerBotId: p?.botId ?? p?.ownerBotId,
        includeClosed: p?.includeClosed === true,
      }),
      latestEventId: itemsStore.latestEventId(p?.botId ?? p?.ownerBotId ?? null),
    }),
    'bots.items.owner.show': (p) => {
      const uid = String(p?.uid ?? p?.id ?? '');
      const item = itemsStore.get(uid);
      if (!item) throw Object.assign(new Error(`Item not found: ${uid}`), { code: 'not_found' });
      return {
        item,
        links: itemsStore.links(uid),
        ...itemsStore.events(uid, { after: p?.after ?? 0, limit: p?.limit }),
      };
    },
    'bots.items.owner.opened': (p) => {
      const botId = String(p?.botId ?? p?.id ?? '');
      const seen = Number.isInteger(p?.eventId) ? p.eventId : itemsStore.latestEventId(botId);
      botsStore.updateBot(botId, { itemsSeen: seen });
      eventBus.emit({ botIds: [botId], kinds: ['items'] });
      return { ok: true, botId, itemsSeen: seen };
    },
    'bots.items.owner.status': (p) => {
      const uids = p?.uids ?? (p?.uid ? [p.uid] : []);
      const res = itemsStore.ownerStatus(uids, { status: p?.status, reason: p?.reason, note: p?.note }, ownerActor);
      const affected = [...new Set(res.updated.map((i) => i.ownerBotId))];
      if (affected.length) eventBus.emit({ botIds: affected, kinds: ['items'] });
      return res;
    },
    'bots.items.owner.snooze': (p) => {
      const res = itemsStore.ownerSnooze({ items: p?.items ?? [], until: p?.until ?? null }, ownerActor);
      const affected = [...new Set(res.items.map((i) => i.ownerBotId))];
      if (affected.length) eventBus.emit({ botIds: affected, kinds: ['items'] });
      return res;
    },
    'bots.items.owner.comment': (p) => {
      const res = itemsStore.ownerComment(p?.uid ?? p?.id, {
        text: p?.text,
        images: p?.images,
        files: p?.files,
        requestId: p?.requestId,
      }, ownerActor);
      eventBus.emit({ botIds: [res.item.ownerBotId], kinds: ['items'] });
      return res;
    },
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
    'bots.groups.send': (p) => groupsService.send(p),
    'bots.groups.stop': (p) => groupsService.stop(p),
    'bots.groups.newThread': (p) => groupsService.newThread(p),

    // Per-Bot MCP Tools, Skill Projects & Work
    'bots.tools.list': (p) => botsService.toolsList(p?.botId ?? p?.id),
    'bots.tools.add': (p) => botsService.toolsAdd(p?.botId ?? p?.id, p?.server ?? p),
    'bots.tools.update': (p) => botsService.toolsUpdate(p?.botId ?? p?.id, p?.name, p?.patch ?? p?.server ?? p),
    'bots.tools.remove': (p) => botsService.toolsRemove(p?.botId ?? p?.id, p?.name),
    'bots.tools.details': (p) => botsService.toolsDetails(p?.botId ?? p?.id, p?.name),
    'bots.tools.problems': () => ({ problems: [] }),
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
    'bots.sendRunAgain': (p) => automationsService.sendRunAgain(p),

    // Connectors & Access
    'bots.connectors': (p) => connectorsService.listConnectors(p?.botId ?? p?.id),
    'bots.connectors.list': (p) => connectorsService.listConnectors(p?.botId ?? p?.id),
    'bots.connectors.update': (p) => connectorsService.updateConnectors(p?.botId ?? p?.id, p?.patch ?? p),
    'bots.access.list': (p) => connectorsService.listAccessRequests(p),
    'bots.access.decide': (p) => connectorsService.decideAccessRequest(p),
    'bots.access.redeem': (p) => connectorsService.redeemAccessToken(p),

    // Sharing & Import
    'bots.share.prepare': (p) => shareImportService.prepareShare(p?.botId ?? p?.id, p),
    'bots.share.export': (p) => shareImportService.prepareShare(p?.botId ?? p?.id, p),
    'bots.share.review': (p) => shareImportService.reviewPackage(p?.packageJson ?? p?.manifest ?? p),
    'bots.share.import': (p) => shareImportService.executeImport(p),
    'bots.import.sources': () => shareImportService.scanImportSources(),
    'bots.import.execute': (p) => shareImportService.executeImport(p),
  };
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
