import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

function cleanStr(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function readJsonOptional(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Look up a per-channel or per-account multi-bot route in
 * `$DSH_HOME/data/bots/_meta/im-routes.json`.
 * Returns `null` on miss, disabled route, or missing/invalid file so callers
 * seamlessly fall back to legacy `data/whale/settings.json`.
 */
export function resolveImBotRoute({ home = process.env.DSH_HOME, channel, accountId } = {}) {
  if (typeof home !== 'string' || !home) return null;
  const normChannel = cleanStr(channel).toLowerCase();
  if (!normChannel) return null;
  const normAccount = cleanStr(accountId);
  let doc;
  try {
    doc = readJsonOptional(join(home, 'data', 'bots', '_meta', 'im-routes.json'));
  } catch {
    return null;
  }
  const routes = doc && typeof doc === 'object' && doc.routes && typeof doc.routes === 'object'
    ? doc.routes
    : null;
  if (!routes) return null;

  const candidates = normAccount ? [`${normChannel}:${normAccount}`, normChannel] : [normChannel];
  for (const routeKey of candidates) {
    const entry = routes[routeKey];
    if (!entry || typeof entry !== 'object') continue;
    if (entry.enabled === false || entry.paused === true) continue;
    const sessionId = cleanStr(entry.sessionId);
    if (!sessionId) continue;
    return {
      routeKey,
      channel: normChannel,
      accountId: normAccount || null,
      botId: cleanStr(entry.botId) || null,
      sessionId,
    };
  }
  return null;
}

function isWhalePresetCompatible(preset, hasMultiBotRoute) {
  if (!preset || preset === 'whale-girl') return true;
  return hasMultiBotRoute && preset === 'dsh-bot';
}

/** Resolve policy separately from persisted chat bindings. No Session is created. */
export async function whaleSessionResolution(
  harness,
  { home = process.env.DSH_HOME, state, key, channel, accountId } = {},
) {
  const preset = (await harness?.agentPresetSettings?.())?.agentPreset || null;
  const hasChannel = Boolean(cleanStr(channel));
  if (!isWhalePresetCompatible(preset, hasChannel)) {
    return { preset, residentId: '', sessionId: null };
  }
  const bound = state?.sessionFor(key);
  if (bound && state.bindingFor?.(key)?.kind === 'manual' && typeof harness.sessionPreset === 'function') {
    const boundPreset = await harness.sessionPreset(bound);
    if (!isWhalePresetCompatible(boundPreset, hasChannel)) {
      return { preset, residentId: '', sessionId: null };
    }
  }
  return currentWhaleSessionResolution(preset, { home, channel, accountId });
}

/** Final same-process send admission reads the latest switches without yielding. */
export function currentWhaleSessionResolution(
  preset,
  { home = process.env.DSH_HOME, channel, accountId } = {},
) {
  let enabled = true;
  if (typeof home === 'string' && home) {
    const config = readJsonOptional(join(dirname(home), 'config.json'));
    if (config && typeof config === 'object') {
      enabled = config.whaleAssistantEnabled !== false;
    }
  }

  const route = enabled ? resolveImBotRoute({ home, channel, accountId }) : null;
  if (route && isWhalePresetCompatible(preset, true)) {
    return {
      preset,
      residentId: route.sessionId,
      sessionId: route.sessionId,
      botId: route.botId,
      routeKey: route.routeKey,
    };
  }

  if (preset && preset !== 'whale-girl') return { preset, residentId: '', sessionId: null };
  const explicit = preset === 'whale-girl';
  let settings = {};
  if (typeof home === 'string' && home) {
    const parsed = readJsonOptional(join(home, 'data', 'whale', 'settings.json'));
    if (parsed && typeof parsed === 'object') settings = parsed;
  }
  const residentId = cleanStr(settings.sessionId);
  const available = enabled && settings.imDefault === true && Boolean(residentId);
  if (explicit && !available) {
    throw Object.assign(new Error('The resident whale assistant is unavailable for IM.'),
      { code: enabled && residentId ? 'whale-im-disabled' : 'whale-session-unavailable' });
  }
  return { preset, residentId, sessionId: available && (!preset || explicit) ? residentId : null };
}

/** The shared default never creates a second whale conversation. */
export async function sharedWhaleSessionId(harness, options) {
  return (await whaleSessionResolution(harness, options)).sessionId;
}
