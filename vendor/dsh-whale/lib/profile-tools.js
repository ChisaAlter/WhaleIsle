import { defineTool } from '@deepseek-ai/dsh-tools';
import { createWhaleScope, updateWhaleSettings } from './scope.js';
import { controllerFrom, genericOutput, trimTo } from './shared.js';

const FIELDS = new Set(['name', 'userTitle', 'personaText', 'model']);

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
    async execute(args) {
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
      const patch = args.patch;
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)
        || Object.keys(patch).some((key) => !FIELDS.has(key))) {
        return { ok: false, detail: 'Unknown whale profile setting.' };
      }
      const next = { ...before };
      if ('name' in patch) next.name = trimTo(patch.name, 64).trim() || '鲸鱼娘';
      if ('userTitle' in patch) next.userTitle = trimTo(patch.userTitle, 64).trim();
      if ('personaText' in patch) next.personaText = trimTo(patch.personaText, 4000);
      if ('model' in patch) {
        const model = patch.model;
        if (!model || typeof model !== 'object' || Array.isArray(model)) {
          return { ok: false, detail: 'model must be an object.' };
        }
        next.modelProvider = trimTo(model.provider, 128);
        next.modelModel = trimTo(model.model, 128);
        next.modelReasoningEffort = trimTo(model.reasoningEffort, 32);
      }
      try {
        const changes = Object.fromEntries(Object.keys(next)
          .filter((key) => next[key] !== before[key]).map((key) => [key, next[key]]));
        await updateWhaleSettings(scope, changes, controllerFrom(ctx));
      } catch (error) {
        return { ok: false, detail: String(error?.message ?? error) };
      }
      if (next.name !== before.name && next.sessionId) {
        await controllerFrom(ctx)?.setPresentation?.({
          sessionId: next.sessionId,
          presentation: { owner: 'dsh-whale:assistant', title: next.name },
        }).catch(() => {});
      }
      return { ok: true, detail: `Whale profile updated: ${Object.keys(patch).join(', ')}.` };
    },
  }));
}
