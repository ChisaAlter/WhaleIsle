import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Resolve policy separately from persisted chat bindings. No Session is created. */
export async function whaleSessionResolution(harness, { home = process.env.DSH_HOME, state, key } = {}) {
  const preset = (await harness?.agentPresetSettings?.())?.agentPreset || null;
  if (preset && preset !== 'whale-girl') return { preset, residentId: '', sessionId: null };
  const bound = state?.sessionFor(key);
  if (bound && state.bindingFor?.(key)?.kind === 'manual' && typeof harness.sessionPreset === 'function') {
    const boundPreset = await harness.sessionPreset(bound);
    if (boundPreset && boundPreset !== 'whale-girl') return { preset, residentId: '', sessionId: null };
  }
  return currentWhaleSessionResolution(preset, { home });
}

/** Final same-process send admission reads the latest switches without yielding. */
export function currentWhaleSessionResolution(preset, { home = process.env.DSH_HOME } = {}) {
  if (preset && preset !== 'whale-girl') return { preset, residentId: '', sessionId: null };
  const explicit = preset === 'whale-girl';
  let settings = {};
  let enabled = true;
  if (typeof home === 'string' && home) {
    try {
      enabled = JSON.parse(readFileSync(join(dirname(home), 'config.json'), 'utf8')).whaleAssistantEnabled !== false;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try {
      settings = JSON.parse(readFileSync(join(home, 'data', 'whale', 'settings.json'), 'utf8'));
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const residentId = typeof settings.sessionId === 'string' ? settings.sessionId.trim() : '';
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
