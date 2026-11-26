/**
 * Core BotsService: serialized lifecycle CRUD, global settings, templates &
 * packages provisioning, avatar/SOUL/files/memory/MCP tools & linked skills.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  botTemplate,
  botTemplateKickoff,
  soulDescription,
  validateBotName,
} from '../../src/shared/index.js';
import {
  appendDecisionTsv,
  botMetaDir,
  botsRootDir,
  deleteBotHome,
  listHomeFiles,
  readAvatar,
  readBotToolsConfig,
  readDecisionTsv,
  readHomeFile,
  readSoul,
  saveAvatar,
  syncLinkedSkills,
  writeAtomicFile,
  writeBotToolsConfig,
  writeHomeFile,
  writeManagedFiles,
  writeSoul,
} from './fs-home.js';
import { MEMORY_MAX_LOADED_LINES, parseMemoryLine } from './memory-service.js';
import {
  applyBotFieldPatch,
  createBotFromTemplateWithRollback,
  decodePngBase64,
  scanProjectSkillDirs,
} from './service-helpers.js';

const GLOBAL_SETTING_KEYS = Object.freeze([
  'botsEnabled',
  'skipNewHomeChatConfirm',
  'hideBotCreatedWorkspaces',
  'botSidebarView',
  'sidebarBotsHeight',
  'sidebarProjectsFirst',
  'petBotId',
]);

/** @param {any} botsStore */
function readGlobalSettingsMap(botsStore) {
  const all = botsStore.getAllSettings();
  return {
    botsEnabled: all.botsEnabled !== false,
    skipNewHomeChatConfirm: all.skipNewHomeChatConfirm === true,
    hideBotCreatedWorkspaces: all.hideBotCreatedWorkspaces !== false,
    botSidebarView: all.botSidebarView ?? null,
    sidebarBotsHeight: typeof all.sidebarBotsHeight === 'number' ? all.sidebarBotsHeight : null,
    sidebarProjectsFirst: all.sidebarProjectsFirst === true,
    petBotId: all.petBotId ?? null,
  };
}

/** @param {string} root @param {string} target */
function isStrictChildPath(root, target) {
  const r = path.resolve(root);
  const t = path.resolve(target);
  const a = process.platform === 'win32' ? r.toLowerCase() : r;
  const b = process.platform === 'win32' ? t.toLowerCase() : t;
  if (a === b) return false;
  const prefix = a.endsWith(path.sep) ? a : `${a}${path.sep}`;
  return b.startsWith(prefix);
}

/**
 * Safely remove a directory tree owned inside `metaRoot`, unlinking symlinks/junctions
 * without ever following external targets.
 * @param {string} metaRoot
 * @param {string} targetPath
 */
function safeRemoveMetaEntry(metaRoot, targetPath) {
  if (!isStrictChildPath(metaRoot, targetPath)) return false;
  if (!fs.existsSync(targetPath)) {
    try {
      const lstat = fs.lstatSync(targetPath);
      if (lstat.isSymbolicLink()) {
        fs.unlinkSync(targetPath);
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }
  const stat = fs.lstatSync(targetPath);
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(targetPath);
    return true;
  }
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(targetPath)) {
      safeRemoveMetaEntry(metaRoot, path.join(targetPath, entry));
    }
    fs.rmdirSync(targetPath);
    return true;
  }
  fs.unlinkSync(targetPath);
  return true;
}

/** @param {string} filePath @param {string} botId */
function removeBotKeyFromMetaJson(filePath, botId) {
  if (!fs.existsSync(filePath)) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !Object.prototype.hasOwnProperty.call(parsed, botId)) {
      return false;
    }
    delete parsed[botId];
    writeAtomicFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`);
    return true;
  } catch {
    return false;
  }
}

/** @param {any} deps @param {any} sessionRuntime @param {any} saved */
function triggerUnpauseOwedMail(deps, sessionRuntime, saved) {
  let wakePromise;
  if (typeof deps.triggerOwedMail === 'function') {
    wakePromise = deps.triggerOwedMail('unpause', saved);
  } else if (deps.hasCustomWakeBot) {
    wakePromise = deps.mailReconciler?.reconcileOwedMail?.();
  } else {
    wakePromise = sessionRuntime.triggerOwedMail?.() ?? sessionRuntime.sendOwedMail?.();
  }
  void Promise.resolve(wakePromise).catch(() => {
    /* Best-effort owed mail trigger on unpause. */
  });
}

/**
 * Create the core BotsService.
 * @param {any} deps
 */
export function createBotsService(deps) {
  const { dshHome, db, botsStore, itemsStore, groupsStore, workStore, memoryService, sessionRuntime, eventBus, onToolsChanged } = deps;
  const botsRoot = botsRootDir(dshHome);
  const metaRoot = botMetaDir(dshHome);
  /** @type {Promise<any>} */
  let queue = Promise.resolve();

  /** @template T @param {() => T | Promise<T>} fn @returns {Promise<T>} */
  function serialize(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => null);
    return run;
  }

  /** @param {string} botId */
  function requireBot(botId) {
    const bot = botsStore.getBot(botId);
    if (!bot) throw Object.assign(new Error(`Bot not found: ${botId}`), { code: 'bot_not_found' });
    return bot;
  }

  /** @param {any} bot */
  function homeDirFor(bot) {
    return path.join(botsRoot, bot.folder);
  }

  function getGlobalSettings() {
    return readGlobalSettingsMap(botsStore);
  }

  function updateGlobalSettings(patch = {}) {
    const now = Date.now();
    for (const key of GLOBAL_SETTING_KEYS) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        botsStore.setSetting(key, patch[key], now);
      }
    }
    const settings = getGlobalSettings();
    if (Object.prototype.hasOwnProperty.call(patch, 'petBotId') && settings.petBotId) {
      const petBot = botsStore.getBot(settings.petBotId);
      if (petBot) deps.onPetBotChanged?.(petBot);
    }
    eventBus.emit({ kinds: ['settings'] });
    return settings;
  }

  async function listBotsView() {
    const settings = getGlobalSettings();
    const rawBots = botsStore.listBots();
    const needs = itemsStore.needsYouCounts(rawBots, Date.now());
    const models = await sessionRuntime.listModels();
    const botIds = rawBots.map((b) => b.id);
    const workersByBot = typeof workStore.listChatWorkersByBots === 'function'
      ? workStore.listChatWorkersByBots(botIds)
      : new Map();
    const waitsByBot = new Map();
    for (const auto of workStore.listAutomations({ enabledOnly: true })) {
      if (!auto?.once) continue;
      const list = waitsByBot.get(auto.botId) ?? [];
      list.push(auto);
      waitsByBot.set(auto.botId, list);
    }

    /** @type {Record<string, any[]>} */
    const chatsByBot = {};

    const bots = rawBots.map((bot) => {
      const chats = sessionRuntime.listChats(bot.id, {
        includeClosed: false,
        preloadedWorkersByChat: workersByBot.get(bot.id) ?? new Map(),
      });
      chatsByBot[bot.id] = chats;
      const waits = waitsByBot.get(bot.id) ?? [];
      const upNextCount = typeof deps.getLookAroundUpNextCount === 'function' ? deps.getLookAroundUpNextCount(bot.id) : 0;
      return sessionRuntime.computeBotSummary(bot, {
        needsYouCount: needs.counts[bot.id] ?? 0,
        upNextCount,
        waits,
        chats,
      });
    });

    const groups = typeof deps.getGroupsList === 'function' ? deps.getGroupsList() : [];
    return {
      bots,
      groups,
      ...settings,
      needsYou: needs.counts,
      needsYouAt: needs.at,
      needsYouStaleInMs: needs.staleInMs,
      models,
      chatsByBot,
    };
  }

  function findAcceptedOfferBot(fromOffer) {
    if (!fromOffer?.proposerBotId || !fromOffer?.offerId) return null;
    const proposer = botsStore.getBot(fromOffer.proposerBotId);
    const dup = proposer?.acceptedOffers?.find((o) => o.offerId === fromOffer.offerId);
    return dup ? botsStore.getBot(dup.botId) : null;
  }

  function recordAcceptedOffer(fromOffer, createdBotId, now) {
    if (!fromOffer?.proposerBotId || !fromOffer?.offerId) return;
    botsStore.updateBot(fromOffer.proposerBotId, (proposer) => ({
      ...proposer,
      acceptedOffers: [...(proposer.acceptedOffers ?? []), { offerId: fromOffer.offerId, botId: createdBotId }],
    }), now);
  }

  /** @param {any} [params] */
  async function createBot(params = {}) {
    return serialize(async () => {
      const dedup = findAcceptedOfferBot(params.fromOffer);
      if (dedup) return { bot: dedup, deduplicated: true };

      const now = Date.now();
      const rawTemplateRef = params.fromTemplate ?? params.templateId ?? null;
      const templateId = typeof rawTemplateRef === 'string'
        ? rawTemplateRef
        : (rawTemplateRef?.templateId ?? null);
      const template = templateId ? botTemplate(templateId) : null;
      const prevPetBotId = getGlobalSettings().petBotId;
      /** @type {string | null} */
      let petBotAssignedTo = null;

      let provisioned;
      try {
        provisioned = await createBotFromTemplateWithRollback({
          botsRoot,
          metaRoot,
          botsStore,
          workStore,
          sessionRuntime,
          now,
          onBeforeCommit: typeof params._onBeforeCommit === 'function' ? params._onBeforeCommit : undefined,
          onAfterInsert: ({ bot }) => {
            recordAcceptedOffer(params.fromOffer, bot.id, now);
            if (!prevPetBotId) {
              botsStore.setSetting('petBotId', bot.id, now);
              petBotAssignedTo = bot.id;
            }
          },
        }, params);
      } catch (error) {
        if (petBotAssignedTo && getGlobalSettings().petBotId === petBotAssignedTo) {
          try { botsStore.setSetting('petBotId', prevPetBotId ?? null, Date.now()); } catch { /* Best-effort restore. */ }
        }
        throw error;
      }

      const savedId = provisioned.bot.id;
      if (params.skipKickoff !== true) {
        const note = params.fromPackage ? 'You were imported from a shared bot package.' : null;
        void sessionRuntime.sendKickoff(botsStore.getBot(savedId), { template, note }).catch(() => null);
      }
      const latest = botsStore.getBot(savedId);
      if (getGlobalSettings().petBotId === latest.id) deps.onPetBotChanged?.(latest);
      eventBus.emit({ botIds: [latest.id], kinds: ['bot', 'chats'] });
      return {
        bot: sessionRuntime.computeBotSummary(latest, { needsYouCount: 0, upNextCount: 0, waits: [] }),
        sessionId: provisioned.sessionId,
        setup: provisioned.setup ?? null,
        kickoffHint: template ? botTemplateKickoff(template) : null,
      };
    });
  }

  async function updateBot(botId, patch = {}, options = {}) {
    return serialize(async () => {
      const existing = requireBot(botId);
      const now = Date.now();
      let name = existing.name;
      if (patch.name !== undefined && String(patch.name).trim() !== existing.name) {
        const check = validateBotName(patch.name, { existingBots: botsStore.listBots(), ignoreBotId: existing.id });
        if (!check.ok) throw Object.assign(new Error(check.reason), { code: check.code });
        name = check.name;
      }

      const next = applyBotFieldPatch({ ...existing, name }, patch, now);
      const hasLaunchPatch = Object.prototype.hasOwnProperty.call(patch, 'launch');
      if (hasLaunchPatch && options.skipModelApply !== true && existing.chatSessionId) {
        await sessionRuntime.applyLaunchModel(null, existing.chatSessionId, next.launch, {
          strict: true,
          fallbackDefault: !next.launch,
        });
      }

      const saved = botsStore.updateBot(existing.id, next, now);
      writeManagedFiles(homeDirFor(saved), saved);

      if (Array.isArray(patch.skillProjects)) {
        const skillSources = saved.skillProjects.flatMap((proj) => scanProjectSkillDirs(proj));
        syncLinkedSkills(metaRoot, saved.id, skillSources);
      }
      if (existing.paused && saved.paused === false) {
        eventBus.emit({ botIds: [saved.id], kinds: ['status', 'items'] });
        if (!options?.skipUnpauseMail) {
          triggerUnpauseOwedMail(deps, sessionRuntime, saved);
        }
      }
      if (getGlobalSettings().petBotId === saved.id || patch.imDefault !== undefined) {
        deps.onPetBotChanged?.(saved);
      }
      eventBus.emit({ botIds: [saved.id], kinds: ['bot'] });
      return sessionRuntime.computeBotSummary(saved, {
        needsYouCount: itemsStore.needsYou({ ownerBotId: saved.id }).length,
      });
    });
  }

  /** @param {string} botId */
  async function cleanupBotGroupMemberships(botId) {
    let updatedGroups = 0;
    let deletedGroups = 0;
    if (!groupsStore || typeof groupsStore.listGroups !== 'function') {
      return { updatedGroups, deletedGroups };
    }
    const groupsSvc = typeof deps.getGroupsService === 'function' ? deps.getGroupsService() : null;
    for (const group of groupsStore.listGroups()) {
      if (!Array.isArray(group.botIds) || !group.botIds.includes(botId)) continue;
      const remaining = group.botIds.filter((/** @type {string} */ id) => id !== botId);
      if (remaining.length === 0) {
        if (typeof groupsSvc?.delete === 'function') await groupsSvc.delete({ groupId: group.id });
        else groupsStore.deleteGroup(group.id);
        deletedGroups += 1;
      } else {
        groupsStore.updateGroup(group.id, { botIds: remaining });
        updatedGroups += 1;
      }
    }
    return { updatedGroups, deletedGroups };
  }

  /** @param {string} botId @param {any[]} chats */
  function cleanupBotStorageAndMeta(botId, chats) {
    const safeId = encodeURIComponent(botId);
    for (const chat of chats) {
      try { workStore.deleteActsFor?.(chat.sessionId); } catch { /* Best-effort acts_for cleanup. */ }
    }
    if (db) {
      try { db.prepare('DELETE FROM bot_work WHERE bot_id = ?').run(botId); } catch { /* Best-effort cleanup. */ }
      try { db.prepare('DELETE FROM bot_access_requests WHERE bot_id = ?').run(botId); } catch { /* Best-effort cleanup. */ }
      try { db.prepare('DELETE FROM bot_requests WHERE from_bot_id = ? OR to_bot_id = ?').run(botId, botId); } catch { /* Best-effort cleanup. */ }
    }
    removeBotKeyFromMetaJson(path.join(metaRoot, 'bot-look-around.json'), botId);
    removeBotKeyFromMetaJson(path.join(metaRoot, 'bot-tidy-up-state.json'), botId);
    safeRemoveMetaEntry(metaRoot, path.join(metaRoot, 'bot-memory-history', `${safeId}.json`));
    safeRemoveMetaEntry(metaRoot, path.join(metaRoot, 'bot-credentials', `${safeId}.json`));
    safeRemoveMetaEntry(metaRoot, path.join(metaRoot, 'bot-linked-skills', safeId));
    for (const chat of chats) {
      botsStore.deleteChat(chat.sessionId);
    }
  }

  /** @param {string} botId @param {{ deleteFolder?: boolean }} [opts] */
  async function deleteBot(botId, { deleteFolder = false } = {}) {
    return serialize(async () => {
      const existing = requireBot(botId);
      const folderPath = homeDirFor(existing);

      const chats = botsStore.listChats(existing.id, { includeClosed: true });
      for (const chat of chats) {
        await sessionRuntime.cancelSession?.(chat.sessionId).catch(() => null);
      }

      let deletedAutomations = 0;
      for (const auto of workStore.listAutomations({ botId: existing.id })) {
        if (workStore.deleteAutomation(auto.id)) deletedAutomations += 1;
      }

      const { updatedGroups, deletedGroups } = await cleanupBotGroupMemberships(existing.id);
      cleanupBotStorageAndMeta(existing.id, chats);
      deleteBotHome(folderPath, existing.id, { deleteFolder });
      botsStore.deleteBot(existing.id);

      if (getGlobalSettings().petBotId === existing.id) {
        const nextFirst = botsStore.listBots()[0] ?? null;
        botsStore.setSetting('petBotId', nextFirst?.id ?? null);
        if (nextFirst) deps.onPetBotChanged?.(nextFirst);
      }
      eventBus.emit({
        botIds: [existing.id],
        kinds: ['bot', 'chats', 'workers', 'automations', 'groups', 'lookAround', 'settings'],
      });
      return {
        deleted: true,
        botId: existing.id,
        folderPath,
        folderPreserved: !deleteFolder,
        cleaned: {
          chats: chats.length,
          automations: deletedAutomations,
          updatedGroups,
          deletedGroups,
        },
      };
    });
  }

  /** @param {string} botId @param {string} sessionId */
  async function deleteChat(botId, sessionId) {
    return serialize(() => sessionRuntime.deleteChat(botId, sessionId));
  }

  /** @param {string} botId @param {string} workId @param {{ sessionId?: string | null }} [options] */
  async function stopWork(botId, workId, options = {}) {
    return sessionRuntime.stopWork(botId, workId, options);
  }

  function roster() {
    return botsStore.listBots().map((bot) => {
      const homeDir = homeDirFor(bot);
      return {
        id: bot.id,
        name: bot.name,
        avatar: bot.avatar ?? null,
        avatarColor: bot.avatarColor ?? null,
        paused: Boolean(bot.paused),
        description: soulDescription(readSoul(homeDir).text),
        chatSessionId: bot.chatSessionId ?? null,
        homePath: homeDir,
      };
    });
  }

  function avatarRead(botId) {
    const bot = requireBot(botId);
    const data = readAvatar(homeDirFor(bot));
    return { botId: bot.id, dataUrl: data?.dataUrl ?? null, sha256: data?.sha256 ?? null };
  }

  async function avatarUpload(botId, base64Png) {
    const bot = requireBot(botId);
    const saved = saveAvatar(homeDirFor(bot), decodePngBase64(base64Png), { botId: bot.id });
    await updateBot(bot.id, { avatar: saved.avatar });
    return { botId: bot.id, ...saved };
  }

  function soulRead(botId) {
    const bot = requireBot(botId);
    const homeDir = homeDirFor(bot);
    const res = readSoul(homeDir);
    return {
      botId: bot.id,
      content: res.text,
      signature: res.signature,
      description: soulDescription(res.text),
      path: path.join(homeDir, 'SOUL.md'),
    };
  }

  function soulWrite(botId, { content, expectedSignature = undefined }) {
    const bot = requireBot(botId);
    const homeDir = homeDirFor(bot);
    try {
      const written = writeSoul(homeDir, content, { expectedSignature, botId: bot.id });
      eventBus.emit({ botIds: [bot.id], kinds: ['bot'] });
      return {
        botId: bot.id,
        content: written.text,
        signature: written.signature,
        description: soulDescription(written.text),
      };
    } catch (error) {
      if (error?.code === 'changed-on-disk') {
        const disk = readSoul(homeDir);
        throw Object.assign(new Error(error.message), {
          code: 'changed-on-disk',
          data: { diskContent: disk.text, diskSignature: disk.signature },
        });
      }
      throw error;
    }
  }

  function filesList(botId, subDir = '') {
    const bot = requireBot(botId);
    return { botId: bot.id, root: homeDirFor(bot), entries: listHomeFiles(homeDirFor(bot), subDir) };
  }

  function filesRead(botId, relPath) {
    const bot = requireBot(botId);
    return { botId: bot.id, path: relPath, content: readHomeFile(homeDirFor(bot), relPath) };
  }

  function filesWrite(botId, relPath, content) {
    const bot = requireBot(botId);
    const res = writeHomeFile(homeDirFor(bot), relPath, content, { botId: bot.id });
    eventBus.emit({ botIds: [bot.id], kinds: ['bot'] });
    return { botId: bot.id, path: relPath, bytes: res.bytes };
  }

  function memoryList(botId) {
    const bot = requireBot(botId);
    const homeDir = homeDirFor(bot);
    const memPath = path.join(homeDir, 'MEMORY.md');
    const raw = fs.existsSync(memPath) ? fs.readFileSync(memPath, 'utf8') : '';
    const lines = raw ? raw.replace(/\r\n/gu, '\n').split('\n') : [];
    const facts = lines.map((line, index) => ({ ...parseMemoryLine(line), lineNumber: index + 1 })).filter((f) => f.isFact);
    const memDir = path.join(homeDir, 'memory');
    const topicFiles = fs.existsSync(memDir)
      ? fs.readdirSync(memDir).filter((n) => n.endsWith('.md') && n !== 'archive.md').sort()
      : [];
    return {
      botId: bot.id,
      facts,
      loadedLimit: MEMORY_MAX_LOADED_LINES,
      totalLines: lines.length,
      truncatedCount: Math.max(0, lines.length - MEMORY_MAX_LOADED_LINES),
      topicFiles,
      archiveExists: fs.existsSync(path.join(memDir, 'archive.md')),
    };
  }

  function memoryAdd(botId, { text, date = null, sourceLabel = null }) {
    const bot = requireBot(botId);
    const res = memoryService.addFact({ botId: bot.id, homeDir: homeDirFor(bot), text, date, sourceLabel, actor: 'owner' });
    eventBus.emit({ botIds: [bot.id], kinds: ['bot'] });
    return res;
  }

  function memoryEdit(botId, { match, nextText, date = null }) {
    const bot = requireBot(botId);
    const res = memoryService.editFact({ botId: bot.id, homeDir: homeDirFor(bot), match, nextText, date, actor: 'owner' });
    eventBus.emit({ botIds: [bot.id], kinds: ['bot'] });
    return res;
  }

  function memoryForget(botId, { fact, actor = 'owner' }) {
    const bot = requireBot(botId);
    const res = memoryService.forgetFact({ botId: bot.id, homeDir: homeDirFor(bot), fact, actor });
    eventBus.emit({ botIds: [bot.id], kinds: ['bot'] });
    return res;
  }

  function memoryHistory(botId, { limit = 100 } = {}) {
    const bot = requireBot(botId);
    return { botId: bot.id, entries: memoryService.listHistory(bot.id, { limit }) };
  }

  function memoryUndo(botId, { changeId }) {
    const bot = requireBot(botId);
    const res = memoryService.undoChange({ botId: bot.id, homeDir: homeDirFor(bot), changeId });
    eventBus.emit({ botIds: [bot.id], kinds: ['bot'] });
    return res;
  }

  /** @param {string} botId */
  function toolsList(botId) {
    return serialize(() => {
      const bot = requireBot(botId);
      return { botId: bot.id, ...readBotToolsConfig(homeDirFor(bot), metaRoot, bot.id) };
    });
  }

  /** @param {string} botId @param {any} server @param {{ expectedVersion?: string }} [options] */
  function toolsAdd(botId, server, options = {}) {
    return serialize(async () => {
      const bot = requireBot(botId);
      const homeDir = homeDirFor(bot);
      const expectedVersion = options?.expectedVersion ?? server?.expectedVersion;
      const cleanServer = server && typeof server === 'object' ? { ...server } : server;
      if (cleanServer && typeof cleanServer === 'object') delete cleanServer.expectedVersion;
      const current = readBotToolsConfig(homeDir, metaRoot, bot.id).servers;
      const saved = writeBotToolsConfig(homeDir, metaRoot, bot.id, {
        servers: [...current.filter((/** @type {any} */ s) => s.name !== cleanServer?.name), cleanServer],
      }, { expectedVersion });
      if (typeof onToolsChanged === 'function') await onToolsChanged(bot.id).catch(() => null);
      eventBus.emit({ botIds: [bot.id], kinds: ['bot'] });
      return saved;
    });
  }

  /** @param {string} botId @param {string} name @param {any} patch @param {{ expectedVersion?: string }} [options] */
  function toolsUpdate(botId, name, patch, options = {}) {
    return serialize(async () => {
      const bot = requireBot(botId);
      const homeDir = homeDirFor(bot);
      const expectedVersion = options?.expectedVersion ?? patch?.expectedVersion;
      const cleanPatch = patch && typeof patch === 'object' ? { ...patch } : patch;
      if (cleanPatch && typeof cleanPatch === 'object') delete cleanPatch.expectedVersion;
      const current = readBotToolsConfig(homeDir, metaRoot, bot.id).servers;
      const saved = writeBotToolsConfig(homeDir, metaRoot, bot.id, {
        servers: current.map((/** @type {any} */ s) => (s.name === name ? { ...s, ...cleanPatch, name: cleanPatch?.name ?? s.name } : s)),
      }, { expectedVersion });
      if (typeof onToolsChanged === 'function') await onToolsChanged(bot.id).catch(() => null);
      eventBus.emit({ botIds: [bot.id], kinds: ['bot'] });
      return saved;
    });
  }

  /** @param {string} botId @param {string} name @param {{ expectedVersion?: string }} [options] */
  function toolsRemove(botId, name, options = {}) {
    return serialize(async () => {
      const bot = requireBot(botId);
      const homeDir = homeDirFor(bot);
      const expectedVersion = options?.expectedVersion;
      const current = readBotToolsConfig(homeDir, metaRoot, bot.id).servers;
      const saved = writeBotToolsConfig(homeDir, metaRoot, bot.id, {
        servers: current.filter((/** @type {any} */ s) => s.name !== name),
      }, { expectedVersion });
      if (typeof onToolsChanged === 'function') await onToolsChanged(bot.id).catch(() => null);
      eventBus.emit({ botIds: [bot.id], kinds: ['bot'] });
      return saved;
    });
  }

  /** @param {string} botId @param {string} name */
  async function toolsDetails(botId, name) {
    const list = await toolsList(botId);
    return list.servers.find((/** @type {any} */ s) => s.name === name) ?? null;
  }

  function scanSkillProjects(workspaceDirs = []) {
    const results = [];
    for (const dir of Array.isArray(workspaceDirs) ? workspaceDirs : []) {
      if (typeof dir !== 'string' || !dir.trim()) continue;
      const resolved = path.resolve(dir);
      const skills = scanProjectSkillDirs(resolved);
      if (skills.length > 0) {
        results.push({ path: resolved, name: path.basename(resolved), skills: skills.map((s) => s.name) });
      }
    }
    return results;
  }

  /** @param {string} botId @param {{ sessionId?: string, workspaceId?: string | null, cwd?: string | null, title?: string | null, role?: string }} [options] */
  function adoptSession(botId, { sessionId = '', workspaceId = null, cwd = null, title = null, role = 'crew' } = {}) {
    const bot = requireBot(botId);
    const adoption = workStore.adoptCrewSession({
      botId: bot.id,
      sessionId,
      workspaceId,
      cwd,
      title,
      role,
    });
    eventBus.emit({ botIds: [bot.id], kinds: ['chats', 'workers', 'bot'] });
    return { ok: true, adoption };
  }

  /** @param {string} sessionId */
  function releaseCrewSession(sessionId) {
    const existing = workStore.getCrewAdoption(sessionId);
    const released = workStore.releaseCrewSession(sessionId);
    if (existing?.botId) {
      eventBus.emit({ botIds: [existing.botId], kinds: ['chats', 'workers', 'bot'] });
    }
    return { ok: Boolean(released), adoption: released };
  }

  /** @param {{ botId?: string | null, status?: string }} [options] */
  function listCrewAdoptions({ botId = null, status = 'active' } = {}) {
    if (botId) requireBot(botId);
    return {
      botId: botId || null,
      adoptions: workStore.listCrewAdoptions({ botId: botId || null, status }),
    };
  }

  /** @param {string} botId @param {string} itemUid */
  function decisionsRead(botId, itemUid) {
    const bot = requireBot(botId);
    const res = readDecisionTsv(homeDirFor(bot), itemUid);
    return { botId: bot.id, itemUid: String(itemUid), ...res };
  }

  /** @param {string} botId @param {string} itemUid @param {any} row */
  function decisionsAppend(botId, itemUid, row) {
    const bot = requireBot(botId);
    const res = appendDecisionTsv(homeDirFor(bot), itemUid, row, { botId: bot.id });
    eventBus.emit({ botIds: [bot.id], kinds: ['items', 'bot'] });
    return { botId: bot.id, itemUid: String(itemUid), ...res };
  }

  return {
    getGlobalSettings,
    updateGlobalSettings,
    listBotsView,
    createBot,
    updateBot,
    deleteBot,
    deleteChat,
    stopWork,
    roster,
    avatarRead,
    avatarUpload,
    soulRead,
    soulWrite,
    filesList,
    filesRead,
    filesWrite,
    memoryList,
    memoryAdd,
    memoryEdit,
    memoryForget,
    memoryHistory,
    memoryUndo,
    toolsList,
    toolsAdd,
    toolsUpdate,
    toolsRemove,
    toolsDetails,
    scanSkillProjects,
    adoptSession,
    releaseCrewSession,
    listCrewAdoptions,
    decisionsRead,
    decisionsAppend,
  };
}
