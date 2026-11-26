/** Map raw llm-pi-ai provider diagnostic messages to localized copy when recognized. */
import type { ModelsKey } from './locales.ts'

interface ErrorPattern {
  readonly pattern: RegExp
  readonly key: ModelsKey
  readonly vars: (match: RegExpExecArray) => Readonly<Record<string, string>>
}

const PROVIDER_ERROR_PATTERNS: readonly ErrorPattern[] = [
  {
    pattern: /^llm-pi-ai: provider "([^"]+)" model "([^"]+)" needs a baseURL\b/,
    key: 'providerErrorNeedsBaseUrl',
    vars: match => ({ provider: match[1] ?? '', model: match[2] ?? '' }),
  },
  {
    pattern: /^llm-pi-ai: provider "([^"]+)" model "([^"]+)" needs an api\b/,
    key: 'providerErrorNeedsApi',
    vars: match => ({ provider: match[1] ?? '', model: match[2] ?? '' }),
  },
  {
    pattern: /^llm-pi-ai: provider "([^"]+)" resolves no models\b/,
    key: 'providerErrorNoModels',
    vars: match => ({ provider: match[1] ?? '' }),
  },
  {
    pattern: /^llm-pi-ai: provider "([^"]+)" sets modelOverrides for "([^"]+)", but the installed catalog does not describe this route\b/,
    key: 'providerErrorOverrideUnknownRoute',
    vars: match => ({ provider: match[1] ?? '', model: match[2] ?? '' }),
  },
  {
    pattern: /^llm-pi-ai: provider "([^"]+)" sets modelOverrides for "([^"]+)" beside a models list\b/,
    key: 'providerErrorOverrideBesideModels',
    vars: match => ({ provider: match[1] ?? '', model: match[2] ?? '' }),
  },
  {
    pattern: /^llm-pi-ai: provider "([^"]+)" modelOverrides names "([^"]+)", which the installed catalog does not describe\b/,
    key: 'providerErrorOverrideUnknownModel',
    vars: match => ({ provider: match[1] ?? '', model: match[2] ?? '' }),
  },
  {
    pattern: /^llm-pi-ai: provider "([^"]+)" modelOverrides entry "([^"]+)" sets "id"\b/,
    key: 'providerErrorOverrideSetsId',
    vars: match => ({ provider: match[1] ?? '', model: match[2] ?? '' }),
  },
  {
    pattern: /^llm-pi-ai: provider "([^"]+)" has a modelOverrides entry with an empty model id$/,
    key: 'providerErrorEmptyOverrideId',
    vars: match => ({ provider: match[1] ?? '' }),
  },
  {
    pattern: /^llm-pi-ai: provider "([^"]+)" has a model with an empty id$/,
    key: 'providerErrorEmptyModelId',
    vars: match => ({ provider: match[1] ?? '' }),
  },
  {
    pattern: /^llm-pi-ai: provider "([^"]+)" lists model "([^"]+)" more than once$/,
    key: 'providerErrorDuplicateModel',
    vars: match => ({ provider: match[1] ?? '', model: match[2] ?? '' }),
  },
  {
    pattern: /^llm-pi-ai: provider "([^"]+)" model "([^"]+)" (contextWindow|maxTokens|compactionThreshold) must be a positive integer$/,
    key: 'providerErrorPositiveInt',
    vars: match => ({ provider: match[1] ?? '', model: match[2] ?? '', field: match[3] ?? '' }),
  },
  {
    pattern: /^llm-pi-ai: provider "([^"]+)" has an empty baseURL$/,
    key: 'providerErrorEmptyBaseUrl',
    vars: match => ({ provider: match[1] ?? '' }),
  },
  {
    pattern: /^llm-pi-ai: provider "([^"]+)" has an empty displayName$/,
    key: 'providerErrorEmptyDisplayName',
    vars: match => ({ provider: match[1] ?? '' }),
  },
  {
    pattern: /^llm-pi-ai: provider "([^"]+)" model "([^"]+)" sets compat "([^"]+)", but its api is "([^"]+)"\b/,
    key: 'providerErrorModelCompatApi',
    vars: match => ({
      provider: match[1] ?? '',
      model: match[2] ?? '',
      field: match[3] ?? '',
      api: match[4] ?? '',
    }),
  },
  {
    pattern: /^llm-pi-ai: provider "([^"]+)" sets compat "([^"]+)", but no model on the route speaks a protocol that takes it\b/,
    key: 'providerErrorRouteCompatApi',
    vars: match => ({ provider: match[1] ?? '', field: match[2] ?? '' }),
  },
  {
    pattern: /^llm-pi-ai: provider "([^"]+)" model "([^"]+)" (?:has an empty reasoningEfforts|reasoningEfforts)/,
    key: 'providerErrorReasoningEfforts',
    vars: match => ({ provider: match[1] ?? '', model: match[2] ?? '' }),
  },
]

/**
 * Translate a known raw backend provider diagnostic string into the active UI locale.
 * Unknown errors are returned unchanged so unrecognized diagnostics are never hidden.
 */
export function localizeProviderError(error: string, t: (key: ModelsKey) => string): string {
  for (const entry of PROVIDER_ERROR_PATTERNS) {
    const match = entry.pattern.exec(error)
    if (match === null) continue
    let message = t(entry.key)
    for (const [name, value] of Object.entries(entry.vars(match))) {
      message = message.replaceAll(`{${name}}`, value)
    }
    return message
  }
  return error
}
