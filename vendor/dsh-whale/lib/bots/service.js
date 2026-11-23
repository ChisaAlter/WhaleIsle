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
  initBotHome,
  listHomeFiles,
  readAvatar,
  readBotToolsConfig,
  readDecisionTsv,
  readHomeFile,
  readSoul,
  reserveBotFolder,
  saveAvatar,
  syncLinkedSkills,
  writeBotToolsConfig,
  writeHomeFile,
  writeManagedFiles,
  writeSoul,
} from './fs-home.js';
import { MEMORY_MAX_LOADED_LINES, parseMemoryLine } from './memory-service.js';
import {
  applyBotFieldPatch,
  buildNewBotRecord,
  decodePngBase64,
  provisionPackageAssets,
  provisionTemplateAssets,
  resolveInitialSoul,
  resolveNewBotName,
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

/**
 * Create the core BotsService.
 * @param {any} deps
 */
export function createBotsService(deps) {
  const { dshHome, botsStore, itemsStore, workStore, memoryService, sessionRuntime, eventBus } = deps;
  const botsRoot = botsRootDir(dshHome);
  const metaRoot = botMetaDir(dshHome);
  let queue = Promise.resolve();

  function serialize(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => null);
    return run;
  }

  function requireBot(botId) {
    const bot = botsStore.getBot(botId);
    if (!bot) throw Object.assign(new Error(`Bot not found: ${botId}`), { code: 'bot_not_found' });
    return bot;
  }

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
    /** @type {Record<string, any[]>} */
    const chatsByBot = {};

    const bots = rawBots.map((bot) => {
      chatsByBot[bot.id] = sessionRuntime.listChats(bot.id, { includeClosed: false });
      const waits = workStore.listAutomations({ botId: bot.id, enabledOnly: true }).filter((a) => Boolean(a.once));
      const upNextCount = typeof deps.getLookAroundUpNextCount === 'function' ? deps.getLookAroundUpNextCount(bot.id) : 0;
      return sessionRuntime.computeBotSummary(bot, {
        needsYouCount: needs.counts[bot.id] ?? 0,
        upNextCount,
        waits,
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

  async function createBot(params = {}) {
    return serialize(async () => {
      const dedup = findAcceptedOfferBot(params.fromOffer);
      if (dedup) return { bot: dedup, deduplicated: true };

      const existing = botsStore.listBots();
      const template = params.fromTemplate ? botTemplate(params.fromTemplate.templateId ?? params.fromTemplate) : null;
      const name = resolveNewBotName(params, template, existing);
      const { folder, homeDir } = reserveBotFolder(botsRoot, name, existing.map((b) => b.folder));
      const now = Date.now();
      const botRecord = buildNewBotRecord({ params, name, folder, template, existing, now });

      initBotHome(homeDir, botRecord, { starterSoul: resolveInitialSoul(params, name, template) });
      if (template) {
        provisionTemplateAssets(
          homeDir,
          botRecord,
          template,
          params.fromTemplate?.skills ?? params.selectedSkills ?? null,
          workStore,
        );
      }
      if (params.fromPackage) provisionPackageAssets(homeDir, metaRoot, botRecord, params.fromPackage, workStore);

      const saved = botsStore.insertBot(botRecord, now);
      recordAcceptedOffer(params.fromOffer, saved.id, now);
      if (!getGlobalSettings().petBotId) botsStore.setSetting('petBotId', saved.id, now);

      const opened = await sessionRuntime.openHomeChat(saved.id);
      if (params.skipKickoff !== true) {
        const note = params.fromPackage ? 'You were imported from a shared bot package.' : null;
        void sessionRuntime.sendKickoff(botsStore.getBot(saved.id), { template, note }).catch(() => null);
      }
      const latest = botsStore.getBot(saved.id);
      if (getGlobalSettings().petBotId === latest.id) deps.onPetBotChanged?.(latest);
      eventBus.emit({ botIds: [latest.id], kinds: ['bot', 'chats'] });
      return {
        bot: sessionRuntime.computeBotSummary(latest, { needsYouCount: 0, upNextCount: 0, waits: [] }),
        sessionId: opened.sessionId,
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

  async function deleteBot(botId, { deleteFolder = false } = {}) {
    return serialize(async () => {
      const existing = requireBot(botId);
      const folderPath = homeDirFor(existing);
      deleteBotHome(folderPath, existing.id, { deleteFolder });
      botsStore.deleteBot(existing.id);

      const settings = getGlobalSettings();
      if (settings.petBotId === existing.id) {
        const nextFirst = botsStore.listBots()[0] ?? null;
        botsStore.setSetting('petBotId', nextFirst?.id ?? null);
        if (nextFirst) deps.onPetBotChanged?.(nextFirst);
      }
      eventBus.emit({ botIds: [existing.id], kinds: ['bot', 'chats', 'settings'] });
      return { deleted: true, botId: existing.id, folderPath, folderPreserved: !deleteFolder };
    });
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

  function toolsList(botId) {
    const bot = requireBot(botId);
    return { botId: bot.id, ...readBotToolsConfig(homeDirFor(bot)) };
  }

  function toolsAdd(botId, server) {
    const bot = requireBot(botId);
    const current = readBotToolsConfig(homeDirFor(bot)).servers;
    const saved = writeBotToolsConfig(homeDirFor(bot), metaRoot, bot.id, {
      servers: [...current.filter((s) => s.name !== server?.name), server],
    });
    eventBus.emit({ botIds: [bot.id], kinds: ['bot'] });
    return saved;
  }

  function toolsUpdate(botId, name, patch) {
    const bot = requireBot(botId);
    const current = readBotToolsConfig(homeDirFor(bot)).servers;
    const saved = writeBotToolsConfig(homeDirFor(bot), metaRoot, bot.id, {
      servers: current.map((s) => (s.name === name ? { ...s, ...patch, name: patch?.name ?? s.name } : s)),
    });
    eventBus.emit({ botIds: [bot.id], kinds: ['bot'] });
    return saved;
  }

  function toolsRemove(botId, name) {
    const bot = requireBot(botId);
    const current = readBotToolsConfig(homeDirFor(bot)).servers;
    const saved = writeBotToolsConfig(homeDirFor(bot), metaRoot, bot.id, {
      servers: current.filter((s) => s.name !== name),
    });
    eventBus.emit({ botIds: [bot.id], kinds: ['bot'] });
    return saved;
  }

  function toolsDetails(botId, name) {
    return toolsList(botId).servers.find((s) => s.name === name) ?? null;
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
