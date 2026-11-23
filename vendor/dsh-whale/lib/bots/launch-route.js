/**
 * Unified model-route resolver for WhaleIsle Bots.
 *
 * Accepts both the flat UI shape (`{ provider, model, reasoningEffort }`) and
 * the legacy nested shape (`{ model: 'provider/model', options: { provider, reasoningEffort, effort } }`).
 * Shared by `session-runtime.js`, `tidy-up-service.js`, and `legacy-compat.js`.
 */

/** @param {unknown} value */
function cleanStr(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Extract reasoning effort from either top-level or legacy nested `options`.
 * @param {any} spec
 * @returns {string}
 */
function readEffort(spec) {
  if (!spec || typeof spec !== 'object') return '';
  return cleanStr(spec.reasoningEffort)
    || cleanStr(spec.effort)
    || cleanStr(spec.options?.reasoningEffort)
    || cleanStr(spec.options?.effort);
}

/**
 * Parse `{ provider, model }` from a flat, nested, or `'provider/model'` spec.
 * @param {any} spec
 * @returns {{ provider: string, model: string } | null}
 */
function parseProviderModel(spec) {
  if (!spec) return null;
  if (typeof spec === 'string') {
    const raw = spec.trim();
    const slash = raw.indexOf('/');
    if (slash <= 0) return null;
    const provider = raw.slice(0, slash).trim();
    const model = raw.slice(slash + 1).trim();
    return provider && model ? { provider, model } : null;
  }
  if (typeof spec !== 'object') return null;

  let provider = cleanStr(spec.provider) || cleanStr(spec.options?.provider);
  let model = cleanStr(spec.model);
  if (!model) return null;

  if (provider && model.startsWith(`${provider}/`)) {
    model = model.slice(provider.length + 1).trim();
  } else if (!provider && model.includes('/')) {
    const slash = model.indexOf('/');
    provider = model.slice(0, slash).trim();
    model = model.slice(slash + 1).trim();
  }
  return provider && model ? { provider, model } : null;
}

/**
 * Resolve a bot launch route (`{ provider, model, reasoningEffort? }`),
 * falling back to `fallbackDefault` when `launch` omits explicit provider/model.
 *
 * @param {any} launch
 * @param {{ provider?: string, model?: string, reasoningEffort?: string, defaultEffort?: string } | string | null} [fallbackDefault]
 * @returns {{ provider: string, model: string, reasoningEffort?: string } | null}
 */
export function resolveBotLaunchRoute(launch, fallbackDefault = null) {
  const direct = parseProviderModel(launch);
  const launchEffort = readEffort(launch);
  if (direct) {
    return launchEffort ? { ...direct, reasoningEffort: launchEffort } : direct;
  }
  const fallback = parseProviderModel(fallbackDefault);
  if (!fallback) return null;
  const fallbackEffort = launchEffort
    || readEffort(fallbackDefault)
    || (fallbackDefault && typeof fallbackDefault === 'object' ? cleanStr(fallbackDefault.defaultEffort) : '');
  return fallbackEffort ? { ...fallback, reasoningEffort: fallbackEffort } : fallback;
}
