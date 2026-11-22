/**
 * Backward-compatibility bridge for legacy `/dsh-whale/*` endpoints
 * (Desktop Live2D Pet + `vendor/dsh-im/src/channels/shared/whale-session.mjs`).
 *
 * Delegates pet state, pet chat, model selection, and assistant ensure to the
 * globally bound `petBotId` bot's Home Chat (falling back to the first bot),
 * and projects `sessionId` / `imDefault` / `name` / model choice into
 * `$DSH_HOME/data/whale/settings.json` so `dsh-im` continues to work with zero
 * code changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { appendPetOutbox, whaleHomeDir } from '../preset.js';
import { writeAtomicFile } from './fs-home.js';
import { parseLaunchModel } from './session-runtime.js';

/** @param {any} launch */
function extractLegacyModel(launch) {
  const parsed = parseLaunchModel(launch);
  if (parsed) {
    return {
      modelProvider: parsed.provider,
      modelModel: parsed.model,
      modelReasoningEffort: parsed.reasoningEffort ?? '',
    };
  }
  const effort = String(launch?.options?.reasoningEffort ?? launch?.options?.effort ?? '').trim();
  return { modelProvider: '', modelModel: '', modelReasoningEffort: effort };
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
    return all.find((b) => !b.paused) ?? all[0] ?? null;
  }

  /**
   * Project the active pet/IM bot into `$DSH_HOME/data/whale/settings.json`
   * without clobbering unrelated legacy keys so `dsh-im` resolves it seamlessly.
   * @param {any} bot
   */
  function syncLegacySettingsProjection(bot) {
    if (!dshHome || !bot) return false;
    const file = path.join(whaleHomeDir(dshHome), 'settings.json');
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

  async function updateLegacySettings(patch = {}) {
    const bot = resolvePetBot();
    if (!bot) return null;
    const botPatch = {};
    if (typeof patch.name === 'string' && patch.name.trim()) botPatch.name = patch.name.trim();
    if (typeof patch.imDefault === 'boolean') botPatch.imDefault = patch.imDefault;

    const changesModel = Boolean(patch.model && typeof patch.model === 'object');
    if (changesModel) {
      const provider = String(patch.model.provider ?? '').trim();
      const model = String(patch.model.model ?? '').trim();
      const reasoningEffort = String(patch.model.reasoningEffort ?? '').trim();
      botPatch.launch = provider && model
        ? {
          model,
          options: { provider, ...(reasoningEffort ? { reasoningEffort } : {}) },
        }
        : (reasoningEffort ? { options: { reasoningEffort } } : null);
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

  function notifyPet(kind, text, extra) {
    if (!dshHome) return;
    appendPetOutbox(dshHome, kind, text, extra);
  }

  return {
    resolvePetBot,
    syncLegacySettingsProjection,
    ensurePetSession,
    getLegacySettings,
    updateLegacySettings,
    notifyPet,
  };
}
