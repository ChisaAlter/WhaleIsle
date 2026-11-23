/**
 * Backward-compatibility bridge for legacy `/dsh-whale/*` endpoints
 * (Desktop Live2D Pet + `vendor/dsh-im/src/channels/shared/whale-session.mjs`).
 *
 * Delegates pet state, pet chat, model selection, and assistant ensure to the
 * globally bound `petBotId` bot's Home Chat (falling back to the first bot),
 * projects `sessionId` / `imDefault` / `name` / model choice into
 * `$DSH_HOME/data/whale/settings.json`, and keeps `_meta/im-routes.json`
 * synchronized when a routed bot's Home session or status changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { appendPetOutbox, whaleHomeDir } from '../preset.js';
import { botMetaDir, readImRoutes, writeAtomicFile, writeImRoutes } from './fs-home.js';
import { resolveBotLaunchRoute } from './launch-route.js';

/** @param {unknown} value */
function cleanStr(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

/** @param {any} launch */
function extractLegacyModel(launch) {
  const route = resolveBotLaunchRoute(launch);
  if (route) {
    return {
      modelProvider: route.provider,
      modelModel: route.model,
      modelReasoningEffort: route.reasoningEffort ?? '',
    };
  }
  const effort = cleanStr(
    launch?.reasoningEffort
    ?? launch?.effort
    ?? launch?.options?.reasoningEffort
    ?? launch?.options?.effort,
  );
  return { modelProvider: '', modelModel: '', modelReasoningEffort: effort };
}

/** @param {any} modelPatch */
function buildLaunchFromLegacyModelPatch(modelPatch) {
  const route = resolveBotLaunchRoute(modelPatch);
  if (route) {
    return {
      provider: route.provider,
      model: route.model,
      ...(route.reasoningEffort ? { reasoningEffort: route.reasoningEffort } : {}),
      options: {
        provider: route.provider,
        ...(route.reasoningEffort ? { reasoningEffort: route.reasoningEffort } : {}),
      },
    };
  }
  const effort = cleanStr(modelPatch?.reasoningEffort ?? modelPatch?.effort);
  return effort ? { reasoningEffort: effort, options: { reasoningEffort: effort } } : null;
}

/**
 * Create the legacy `/dsh-whale/*` compatibility facade.
 * @param {{
 *   dshHome: string,
 *   botsStore: any,
 *   botsService: any,
 *   sessionRuntime: any,
 * }} deps
 */
export function createLegacyCompat(deps) {
  const { dshHome, botsStore, botsService, sessionRuntime } = deps;

  function resolvePetBot() {
    const petBotId = botsStore.getGlobalConfig().petBotId;
    if (petBotId) {
      const explicit = botsStore.getBot(petBotId);
      if (explicit) return explicit;
    }
    const all = botsStore.listBots();
    return all.find((/** @type {any} */ b) => !b.paused) ?? all[0] ?? null;
  }

  /**
   * Resolve which bot owns a given IM `(channel, accountId)` route using
   * `_meta/im-routes.json`, falling back seamlessly to `resolvePetBot()`.
   * @param {{ channel?: string, accountId?: string }} [options]
   */
  function resolveImBot({ channel = '', accountId = '' } = {}) {
    const normChannel = cleanStr(channel).toLowerCase();
    const normAccount = cleanStr(accountId);
    if (dshHome && normChannel) {
      const doc = readImRoutes(botMetaDir(dshHome));
      const routes = doc.routes && typeof doc.routes === 'object' ? doc.routes : {};
      const keys = normAccount ? [`${normChannel}:${normAccount}`, normChannel] : [normChannel];
      for (const routeKey of keys) {
        const entry = routes[routeKey];
        if (!entry || entry.enabled === false || !entry.botId) continue;
        const matched = botsStore.getBot(entry.botId);
        if (matched && !matched.paused) return matched;
      }
    }
    return resolvePetBot();
  }

  /**
   * Keep `_meta/im-routes.json` entries referencing `bot.id` synchronized with
   * the bot's live `chatSessionId`, `name`, and `paused` state.
   * @param {any} bot
   */
  function syncImRoutesForBot(bot) {
    if (!dshHome || !bot?.id) return false;
    const metaRoot = botMetaDir(dshHome);
    const doc = readImRoutes(metaRoot);
    const routes = doc.routes && typeof doc.routes === 'object' ? { ...doc.routes } : {};
    let changed = false;
    for (const [key, entry] of Object.entries(routes)) {
      if (!entry || entry.botId !== bot.id) continue;
      const nextSessionId = bot.chatSessionId || '';
      const nextEnabled = !bot.paused;
      if (entry.sessionId !== nextSessionId || entry.enabled !== nextEnabled || entry.botName !== bot.name) {
        routes[key] = {
          ...entry,
          botName: bot.name,
          sessionId: nextSessionId,
          enabled: nextEnabled,
          updatedAt: Date.now(),
        };
        changed = true;
      }
    }
    if (!changed) return false;
    writeImRoutes(metaRoot, { version: 1, routes, updatedAt: Date.now() });
    return true;
  }

  /**
   * Project the active pet/IM bot into `$DSH_HOME/data/whale/settings.json`
   * without clobbering unrelated legacy keys, and synchronize any `_meta/im-routes.json`
   * bindings referencing this bot so `dsh-im` resolves both seamlessly.
   * @param {any} bot
   */
  function syncLegacySettingsProjection(bot) {
    if (!dshHome || !bot) return false;
    syncImRoutesForBot(bot);

    const file = path.join(whaleHomeDir(dshHome), 'settings.json');
    /** @type {Record<string, any>} */
    let existing = {};
    if (fs.existsSync(file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (parsed && typeof parsed === 'object') existing = parsed;
      } catch {
        existing = {};
      }
    }
    const modelParts = extractLegacyModel(bot.launch);
    const hasLaunchKey = Object.prototype.hasOwnProperty.call(bot, 'launch');
    const next = {
      ...existing,
      name: bot.name || existing.name || '鲸鱼娘',
      sessionId: bot.chatSessionId || existing.sessionId || '',
      imDefault: bot.imDefault !== undefined ? Boolean(bot.imDefault) : (existing.imDefault !== false),
      ...(hasLaunchKey || modelParts.modelProvider ? { modelProvider: modelParts.modelProvider } : {}),
      ...(hasLaunchKey || modelParts.modelModel ? { modelModel: modelParts.modelModel } : {}),
      ...(hasLaunchKey || modelParts.modelReasoningEffort ? { modelReasoningEffort: modelParts.modelReasoningEffort } : {}),
    };
    if (JSON.stringify(existing) === JSON.stringify(next)) return false;
    writeAtomicFile(file, `${JSON.stringify(next, null, 2)}\n`);
    return true;
  }

  async function ensurePetSession() {
    const bot = resolvePetBot();
    if (!bot) return null;
    const opened = await sessionRuntime.openHomeChat(bot.id);
    const updatedBot = botsStore.getBot(bot.id);
    if (updatedBot) syncLegacySettingsProjection(updatedBot);
    return {
      ok: true,
      botId: bot.id,
      sessionId: opened.sessionId,
      name: updatedBot?.name ?? bot.name,
      created: Boolean(opened.created),
    };
  }

  function getLegacySettings() {
    const bot = resolvePetBot();
    if (!bot) return null;
    const modelParts = extractLegacyModel(bot.launch);
    return {
      botId: bot.id,
      name: bot.name,
      sessionId: bot.chatSessionId ?? '',
      imDefault: bot.imDefault !== false,
      ...modelParts,
      personality: bot.importedFrom?.personality ?? 'natural',
      userTitle: bot.importedFrom?.userTitle ?? '',
      personaText: '',
      bigFishEnabled: botsStore.getGlobalConfig().botsEnabled,
    };
  }

  /** @param {Record<string, any>} [patch] */
  async function updateLegacySettings(patch = {}) {
    const bot = resolvePetBot();
    if (!bot) return null;
    /** @type {Record<string, any>} */
    const botPatch = {};
    if (typeof patch.name === 'string' && patch.name.trim()) botPatch.name = patch.name.trim();
    if (typeof patch.imDefault === 'boolean') botPatch.imDefault = patch.imDefault;

    const changesModel = Boolean(patch.model && typeof patch.model === 'object');
    if (changesModel) {
      botPatch.launch = buildLaunchFromLegacyModelPatch(patch.model);
      if (bot.chatSessionId) {
        await sessionRuntime.applyLaunchModel(null, bot.chatSessionId, botPatch.launch, {
          strict: true,
          fallbackDefault: true,
          requireController: true,
        });
      }
    }

    if (Object.keys(botPatch).length > 0) {
      await botsService.updateBot(bot.id, botPatch, { skipModelApply: changesModel });
    }
    if (typeof patch.bigFishEnabled === 'boolean') {
      botsService.updateGlobalSettings({ botsEnabled: patch.bigFishEnabled });
    }
    const latest = botsStore.getBot(bot.id);
    if (latest) syncLegacySettingsProjection(latest);
    return getLegacySettings();
  }

  /** @param {string} kind @param {string} text @param {any} [extra] */
  function notifyPet(kind, text, extra) {
    if (!dshHome) return;
    appendPetOutbox(dshHome, kind, text, extra);
  }

  return {
    resolvePetBot,
    resolveImBot,
    syncImRoutesForBot,
    syncLegacySettingsProjection,
    ensurePetSession,
    getLegacySettings,
    updateLegacySettings,
    notifyPet,
  };
}
