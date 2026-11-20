import { defineTool } from '@deepseek-ai/dsh-tools';
import { createWhaleScope, updateWhaleSettings } from './scope.js';
import { controllerFrom, genericOutput, trimTo } from './shared.js';
import { ABORTED_TEXT } from './call-origin.js';

const FIELDS = new Set(['name', 'userTitle', 'personaText', 'model']);

/**
 * @param {Record<string, any>} before
 * @param {Record<string, any>} patch
 */
function applyProfilePatch(before, patch) {
  /** @type {Record<string, any>} */
  const next = { ...before };
  if ('name' in patch) next.name = trimTo(patch.name, 64).trim() || '鲸鱼娘';
  if ('userTitle' in patch) next.userTitle = trimTo(patch.userTitle, 64).trim();
  if ('personaText' in patch) next.personaText = trimTo(patch.personaText, 4000);
  if ('model' in patch) {
    const model = patch.model;
    if (!model || typeof model !== 'object' || Array.isArray(model)) {
      return { error: 'model must be an object.' };
    }
    next.modelProvider = trimTo(model.provider, 128);
    next.modelModel = trimTo(model.model, 128);
    next.modelReasoningEffort = trimTo(model.reasoningEffort, 32);
  }
  return { next };
}

export function registerProfileTools(ctx) {
  ctx.tools.register(defineTool({
    name: 'whale_profile_settings',
    description:
      'Read or update your own whale assistant profile settings: name, how you address the user, '
      + 'extra persona instructions, and default model selection. With no patch, read current values. '
      + 'Use whale_pet_settings for appearance, behavior and personality.',
    timeoutMs: 10_000,
    parameters: {
      patch: { type: 'object', additionalProperties: true, description: 'Optional patch with name, userTitle, personaText, or model {provider,model,reasoningEffort}.' },
    },
    output: genericOutput,
    presentCall: (args) => ({
      card: 'generic', title: 'Whale profile', kind: 'other',
      content: [{ type: 'text', text: JSON.stringify(args.patch ?? {}) }],
    }),
    async execute(args, exec) {
      const home = process.env.DSH_HOME;
      if (!home) return { ok: false, detail: 'Whale home is unavailable.' };
      const scope = createWhaleScope(home);
      const before = scope.get();
      if (args.patch === undefined) {
        return { ok: true, detail: JSON.stringify({
          name: before.name, userTitle: before.userTitle, personaText: before.personaText,
          model: { provider: before.modelProvider, model: before.modelModel, reasoningEffort: before.modelReasoningEffort },
        }) };
      }
      if (exec?.signal?.aborted) return { ok: false, detail: ABORTED_TEXT };
      const patch = args.patch;
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)
        || Object.keys(patch).some((key) => !FIELDS.has(key))) {
        return { ok: false, detail: 'Unknown whale profile setting.' };
      }
      const patched = applyProfilePatch(before, patch);
      if (patched.error || !patched.next) return { ok: false, detail: patched.error || 'Invalid patch.' };
      const next = patched.next;
      /** @type {Record<string, any>} */
      const beforeRecord = before;
      try {
        const changes = Object.fromEntries(Object.keys(next)
          .filter((key) => next[key] !== beforeRecord[key]).map((key) => [key, next[key]]));
        if (exec?.signal?.aborted) return { ok: false, detail: ABORTED_TEXT };
        await updateWhaleSettings(scope, changes, controllerFrom(ctx));
      } catch (/** @type {any} */ error) {
        return { ok: false, detail: String(error?.message ?? error) };
      }
      if (next.name !== before.name && next.sessionId) {
        await controllerFrom(ctx)?.setPresentation?.({
          sessionId: next.sessionId,
          presentation: { owner: 'dsh-whale:assistant', title: next.name },
        }).catch((/** @type {unknown} */ error) => { console.warn('[vendor/dsh-whale/lib/profile-tools.js] background operation failed', error); });
      }
      return { ok: true, detail: `Whale profile updated: ${Object.keys(patch).join(', ')}.` };
    },
  }));
}
