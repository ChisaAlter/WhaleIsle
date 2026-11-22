/**
 * Bot Connectors (dsh-im channels + local Webhooks) and Who-Can-Ask Access
 * Approval service.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BOT_LIMITS } from '../../src/shared/index.js';

const IM_CHANNEL_KINDS = Object.freeze(['feishu', 'wecom', 'dingtalk', 'telegram', 'discord', 'slack']);

/**
 * Inspect local `dsh-im` configuration files read-only to report active channels.
 * @param {string} dshHome
 */
function inspectLocalImChannels(dshHome) {
  const channels = [];
  const imConfigFile = path.join(dshHome, 'data', 'im', 'config.json');
  let imConfig = null;
  if (fs.existsSync(imConfigFile)) {
    try {
      imConfig = JSON.parse(fs.readFileSync(imConfigFile, 'utf8'));
    } catch {
      imConfig = null;
    }
  }
  for (const kind of IM_CHANNEL_KINDS) {
    const entry = imConfig?.channels?.[kind] ?? imConfig?.[kind] ?? null;
    const configured = Boolean(entry && typeof entry === 'object' && entry.enabled !== false);
    channels.push({
      kind,
      configured,
      enabled: configured,
      label: kind.charAt(0).toUpperCase() + kind.slice(1),
    });
  }
  return channels;
}

/** @param {any} webhooks */
function sanitizeWebhooksForView(webhooks) {
  return (Array.isArray(webhooks) ? webhooks : []).map((w) => ({
    id: String(w.id ?? ''),
    name: String(w.name ?? 'Webhook'),
    enabled: w.enabled !== false,
    path: `/dsh-bots/webhooks/${encodeURIComponent(String(w.id ?? ''))}`,
    hasSecret: Boolean(w.secretHash || w.secret),
    createdAt: w.createdAt ?? null,
  }));
}

/**
 * Create the Bot Connectors & Access Request service.
 * @param {{
 *   dshHome: string,
 *   botsStore: any,
 *   workStore: any,
 *   eventBus: any,
 *   onBotUpdated?: (bot: any) => void,
 * }} deps
 */
export function createConnectorsService(deps) {
  const { dshHome, botsStore, workStore, eventBus } = deps;

  function requireBot(botId) {
    const bot = botsStore.getBot(botId);
    if (!bot) throw Object.assign(new Error(`Bot not found: ${botId}`), { code: 'bot_not_found' });
    return bot;
  }

  function listConnectors(botId) {
    const bot = requireBot(botId);
    const imChannels = inspectLocalImChannels(dshHome);
    const bound = bot.connectors && typeof bot.connectors === 'object' ? bot.connectors : {};
    return {
      botId: bot.id,
      imDefault: bot.imDefault === true,
      imChannels: imChannels.map((ch) => ({
        ...ch,
        bound: Boolean(bound.im?.[ch.kind] ?? (bot.imDefault === true && ch.configured)),
      })),
      webhooks: sanitizeWebhooksForView(bound.webhooks),
    };
  }

  function updateConnectors(botId, patch = {}) {
    const bot = requireBot(botId);
    const prev = bot.connectors && typeof bot.connectors === 'object' ? bot.connectors : {};
    const nextConnectors = {
      ...prev,
      ...(patch.im && typeof patch.im === 'object' ? { im: { ...(prev.im ?? {}), ...patch.im } } : {}),
    };

    if (Array.isArray(patch.webhooks)) {
      nextConnectors.webhooks = patch.webhooks.slice(0, 16).map((w) => ({
        id: String(w.id || crypto.randomUUID().slice(0, 12)),
        name: String(w.name || 'Webhook').trim().slice(0, 80),
        enabled: w.enabled !== false,
        secretHash: w.secret
          ? crypto.createHash('sha256').update(String(w.secret)).digest('hex')
          : (w.secretHash ?? null),
        createdAt: w.createdAt ?? Date.now(),
      }));
    }

    const botPatch = { connectors: nextConnectors };
    if (typeof patch.imDefault === 'boolean') {
      botPatch.imDefault = patch.imDefault;
    }
    const updated = botsStore.updateBot(bot.id, botPatch);
    deps.onBotUpdated?.(updated);
    eventBus.emit({ botIds: [bot.id], kinds: ['bot', 'threads'] });
    return listConnectors(bot.id);
  }

  function listAccessRequests({ botId = null, status = null } = {}) {
    return workStore.listAccessRequests({ botId, status });
  }

  function grantMemberToBot(botId, req) {
    const bot = botsStore.getBot(botId);
    if (!bot) return;
    const members = Array.isArray(bot.members) ? [...bot.members] : [];
    const exists = members.some((m) => m.id === req.requesterId && (m.source ?? null) === (req.source ?? null));
    if (exists || members.length >= BOT_LIMITS.maxMembers) return;
    members.push({
      id: req.requesterId,
      name: req.requesterName || req.requesterId,
      source: req.source,
      ...(req.workspaceId ? { workspaceId: req.workspaceId } : {}),
    });
    const updated = botsStore.updateBot(bot.id, { members });
    deps.onBotUpdated?.(updated);
  }

  function decideAccessRequest({ id, decision, decidedBy = 'owner' }) {
    const decided = workStore.decideAccessRequest(id, { decision, decidedBy });
    if (decision === 'granted') {
      grantMemberToBot(decided.botId, decided);
    }
    eventBus.emit({ botIds: [decided.botId], kinds: ['access', 'bot'] });
    return decided;
  }

  function redeemAccessToken({ token, decision = 'granted', decidedBy = 'owner' }) {
    const decided = workStore.redeemAccessToken(token, { decision, decidedBy });
    if (decision === 'granted') {
      grantMemberToBot(decided.botId, decided);
    }
    eventBus.emit({ botIds: [decided.botId], kinds: ['access', 'bot'] });
    return decided;
  }

  return {
    listConnectors,
    updateConnectors,
    listAccessRequests,
    decideAccessRequest,
    redeemAccessToken,
  };
}
