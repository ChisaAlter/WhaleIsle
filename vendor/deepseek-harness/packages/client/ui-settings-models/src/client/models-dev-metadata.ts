/**
 * Browser-side models.dev metadata used to fill gaps after endpoint discovery.
 * Discovery often returns only model ids; this catalog supplies capacities and
 * reasoning-effort offers when a record matches. Missing matches and fetch
 * failures leave the candidate unchanged — never invent levels.
 */

import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-api-remotes/client'

/** Canonical pi-ai effort keys the Models page can declare. */
const EFFORTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

type EffortId = (typeof EFFORTS)[number]

/** models.dev root document: provider key → provider record. */
export type ModelsDevMetadata = Record<string, unknown>

/** One provider's model row from models.dev (subset we read). */
interface ModelsDevModelRecord {
  name?: unknown
  limit?: unknown
  reasoning?: unknown
  reasoning_options?: unknown
}

/** A discovered model plus optional fields filled from models.dev. */
export interface EnrichedDiscoveredModel extends LlmDiscoveredModel {
  /**
   * Declared thinking levels, or `false` for a non-reasoning model. Absent when
   * metadata said nothing useful.
   */
  reasoningEfforts?: false | Record<string, string | null>
}

const MODELS_DEV_METADATA_URL = 'https://models.dev/api.json'
const MODELS_DEV_TIMEOUT_MS = 2_000

function isPrivateIPv4Octets(a: number, b: number): boolean {
  if (a === 127 || a === 10 || a === 0) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

function isPrivateOrLocalHost(rawHost: string): boolean {
  const host = rawHost.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '').split('%')[0] ?? ''
  if (host.length === 0) return false
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (ipv4 !== null) {
    const octets = ipv4.slice(1).map(Number)
    const [a = -1, b = -1] = octets
    return octets.every(n => n >= 0 && n <= 255) && isPrivateIPv4Octets(a, b)
  }

  if (host === '::' || host === '::1' || host === '0:0:0:0:0:0:0:0' || host === '0:0:0:0:0:0:0:1') return true
  const mappedDotted = /^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (mappedDotted !== null) {
    const octets = mappedDotted.slice(1).map(Number)
    const [a = -1, b = -1] = octets
    return octets.every(n => n >= 0 && n <= 255) && isPrivateIPv4Octets(a, b)
  }
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host)
  if (mappedHex?.[1] !== undefined) {
    const hi = Number.parseInt(mappedHex[1], 16)
    return isPrivateIPv4Octets(hi >> 8, hi & 0xff)
  }
  const firstHextet = /^([0-9a-f]{1,4}):/.exec(host)
  if (firstHextet?.[1] !== undefined) {
    const first = Number.parseInt(firstHextet[1], 16)
    if ((first & 0xfe00) === 0xfc00) return true // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  }
  return false
}

/**
 * Return `true` when `baseURL` points at loopback or a private network address
 * so local gateways (for example Magpie) do not stall waiting on external models.dev lookups.
 */
export function isPrivateOrLocalBaseUrl(baseURL?: string): boolean {
  if (typeof baseURL !== 'string' || baseURL.trim().length === 0) return false
  try {
    return isPrivateOrLocalHost(new URL(baseURL.trim()).hostname)
  } catch {
    // Unparseable or incomplete draft URLs do not count as a verified local/private gateway.
    return false
  }
}

let modelsDevMetadataPromise: Promise<ModelsDevMetadata> | undefined

/** When true, {@link enrichDiscoveredModelsBestEffort} is a no-op (form specs). */
let enrichmentDisabledForTests = false

/**
 * Drop the in-flight / cached models.dev promise (tests only).
 * @returns nothing.
 */
export function resetModelsDevMetadataCache(): void {
  modelsDevMetadataPromise = undefined
}

/**
 * Disable or re-enable models.dev enrichment for browser form specs.
 * @param disabled - true skips the network catalog.
 * @returns nothing.
 */
export function setModelsDevEnrichmentDisabledForTests(disabled: boolean): void {
  enrichmentDisabledForTests = disabled
  resetModelsDevMetadataCache()
}

/**
 * Load the models.dev catalog once per page lifetime (force-cache).
 * @returns the parsed catalog object.
 */
export function loadModelsDevMetadata(): Promise<ModelsDevMetadata> {
  if (modelsDevMetadataPromise === undefined) {
    modelsDevMetadataPromise = fetch(MODELS_DEV_METADATA_URL, {
      cache: 'force-cache',
      signal: AbortSignal.timeout(MODELS_DEV_TIMEOUT_MS),
    }).then(async (response) => {
      if (!response.ok) throw new Error(`models.dev returned HTTP ${response.status}`)
      return response.json() as Promise<ModelsDevMetadata>
    }).catch((error: unknown) => {
      modelsDevMetadataPromise = undefined
      throw error
    })
  }
  return modelsDevMetadataPromise
}

function positiveMetadataLimit(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

interface MetadataCandidate {
  providerId: string
  model: ModelsDevModelRecord
}

function metadataRecordCandidates(metadata: ModelsDevMetadata, id: string): MetadataCandidate[] {
  const matches: MetadataCandidate[] = []
  for (const [providerKey, provider] of Object.entries(metadata)) {
    if (provider === null || typeof provider !== 'object') continue
    const providerRecord = provider as Record<string, unknown>
    const models = providerRecord.models
    const model = models !== null && typeof models === 'object' && !Array.isArray(models)
      ? (models as Record<string, unknown>)[id]
      : undefined
    if (model !== null && typeof model === 'object' && !Array.isArray(model)) {
      const providerId = typeof providerRecord.id === 'string' && providerRecord.id !== ''
        ? providerRecord.id
        : providerKey
      matches.push({ providerId, model: model as ModelsDevModelRecord })
    }
  }
  return matches
}

const OFFICIAL_PROVIDER_RULES: readonly [string, RegExp][] = [
  ['deepseek', /^deepseek(?:[-/.]|$)/],
  ['openai', /^(?:gpt(?:[-/.]|$)|o[134](?:[-/.]|$)|codex(?:[-/.]|$))/],
  ['xai', /^(?:grok|x-ai\/grok|xai\/grok)(?:[-/.]|$)/],
  ['anthropic', /^claude(?:[-/.]|$)/],
  ['google', /^gemini(?:[-/.]|$)/],
  ['mistral', /^mistral(?:[-/.]|$)/],
  ['cohere', /^command(?:[-/.]|$)/],
  ['nvidia', /^nemotron(?:[-/.]|$)/],
  ['meta', /^llama(?:[-/.]|$)/],
  ['xiaomi', /^mimo(?:[-/.]|$)/],
  ['alibaba', /^qwen(?:[-/.]|$)/],
]

function officialMetadataProviderForModel(id: string): string | undefined {
  const normalized = id.toLowerCase()
  const bare = normalized.includes('/') ? normalized.slice(normalized.lastIndexOf('/') + 1) : normalized
  return OFFICIAL_PROVIDER_RULES.find(([, rule]) => rule.test(normalized) || rule.test(bare))?.[0]
}

function metadataModelIdVariants(id: string): string[] {
  const variants = [id]
  if (id.includes('/')) variants.push(id.slice(id.lastIndexOf('/') + 1))
  return [...new Set(variants)]
}

function metadataProviderModel(
  metadata: ModelsDevMetadata,
  providerId: string,
  id: string,
): MetadataCandidate | undefined {
  for (const [providerKey, provider] of Object.entries(metadata)) {
    if (provider === null || typeof provider !== 'object') continue
    const providerRecord = provider as Record<string, unknown>
    const currentProviderId = typeof providerRecord.id === 'string' && providerRecord.id !== ''
      ? providerRecord.id
      : providerKey
    if (currentProviderId !== providerId) continue
    const models = providerRecord.models
    if (models === null || typeof models !== 'object' || Array.isArray(models)) return undefined
    const modelMap = models as Record<string, unknown>
    for (const variant of metadataModelIdVariants(id)) {
      const key = Object.keys(modelMap).find(
        modelId => modelId === variant || modelId.toLowerCase() === variant.toLowerCase(),
      )
      const model = key === undefined ? undefined : modelMap[key]
      if (model !== null && typeof model === 'object' && !Array.isArray(model)) {
        return { providerId, model: model as ModelsDevModelRecord }
      }
    }
    return undefined
  }
  return undefined
}

function metadataLimit(model: ModelsDevModelRecord, field: 'context' | 'output'): number | undefined {
  const limit = model.limit !== null && typeof model.limit === 'object' && !Array.isArray(model.limit)
    ? model.limit as Record<string, unknown>
    : {}
  return positiveMetadataLimit(limit[field])
}

function compareMetadataLimits(
  left: ModelsDevModelRecord,
  right: ModelsDevModelRecord,
  field: 'context' | 'output',
): number {
  const leftValue = metadataLimit(left, field)
  const rightValue = metadataLimit(right, field)
  if (leftValue === undefined && rightValue === undefined) return 0
  if (leftValue === undefined) return 1
  if (rightValue === undefined) return -1
  return leftValue - rightValue
}

/** Prefer the smallest known capacities, then provider id — never mix records. */
function defaultMetadataCandidate(candidates: readonly MetadataCandidate[]): MetadataCandidate | undefined {
  return [...candidates].sort((left, right) => {
    const context = compareMetadataLimits(left.model, right.model, 'context')
    if (context !== 0) return context
    const output = compareMetadataLimits(left.model, right.model, 'output')
    if (output !== 0) return output
    return left.providerId.localeCompare(right.providerId)
  })[0]
}

/**
 * Pick one models.dev model record for an endpoint model id.
 * Official-provider name wins; else unique match; else lowest-capacity default.
 * @param metadata - the models.dev catalog.
 * @param id - discovered model id.
 * @returns the chosen record, or undefined when nothing matches.
 */
export function selectModelsDevRecord(
  metadata: ModelsDevMetadata,
  id: string,
): ModelsDevModelRecord | undefined {
  const exactCandidates = metadataRecordCandidates(metadata, id)
  const officialProvider = officialMetadataProviderForModel(id)
  const official = officialProvider === undefined
    ? undefined
    : metadataProviderModel(metadata, officialProvider, id)
  const exactOfficial = officialProvider === undefined
    ? undefined
    : exactCandidates.find(candidate => candidate.providerId === officialProvider)
  const officialCandidate = exactOfficial ?? official
  if (officialCandidate !== undefined) return officialCandidate.model

  if (exactCandidates.length === 0) return undefined
  if (exactCandidates.length === 1) return exactCandidates[0]?.model
  return defaultMetadataCandidate(exactCandidates)?.model
}

/**
 * Translate models.dev reasoning fields into a pi-ai `reasoningEfforts` value.
 * @param model - one models.dev model record.
 * @returns false, a level dict, or undefined when metadata is silent.
 */
export function reasoningEffortsFromMetadata(
  model: ModelsDevModelRecord,
): false | Record<string, string | null> | undefined {
  if (model.reasoning === false) return false
  const options = Array.isArray(model.reasoning_options) ? model.reasoning_options : []
  const effort = options.find(
    option => option !== null && typeof option === 'object' && !Array.isArray(option)
      && (option as { type?: unknown }).type === 'effort',
  ) as { values?: unknown } | undefined
  if (effort === undefined || !Array.isArray(effort.values)) return undefined
  const result: Record<string, string | null> = {}
  for (const value of effort.values) {
    if (value === 'none' || value === 'off') result.off = null
    else if (typeof value === 'string' && (EFFORTS as readonly string[]).includes(value)) {
      result[value as EffortId] = value
    }
  }
  return Object.keys(result).some(level => level !== 'off') ? result : undefined
}

/**
 * Fill missing capacities and reasoning offers from one models.dev record.
 * Endpoint-disclosed capacities win; name is filled only when discovery omitted it.
 * @param candidate - one discoverModels row.
 * @param record - matched models.dev model, or undefined.
 * @returns the candidate, optionally enriched.
 */
export function enrichDiscoveredModel(
  candidate: LlmDiscoveredModel,
  record: ModelsDevModelRecord | undefined,
): EnrichedDiscoveredModel {
  if (record === undefined) return { ...candidate }
  const limit = record.limit !== null && typeof record.limit === 'object' && !Array.isArray(record.limit)
    ? record.limit as Record<string, unknown>
    : {}
  const reasoningEfforts = reasoningEffortsFromMetadata(record)
  const contextLimit = positiveMetadataLimit(limit.context)
  const outputLimit = positiveMetadataLimit(limit.output)
  return {
    ...candidate,
    ...candidate.name === undefined && typeof record.name === 'string' ? { name: record.name } : {},
    ...candidate.contextWindow === undefined && contextLimit !== undefined
      ? { contextWindow: contextLimit }
      : {},
    ...candidate.maxTokens === undefined && outputLimit !== undefined
      ? { maxTokens: outputLimit }
      : {},
    ...reasoningEfforts === undefined ? {} : { reasoningEfforts },
  }
}

/**
 * Enrich every discovered model against a models.dev catalog.
 * @param candidates - discoverModels rows.
 * @param metadata - the models.dev catalog.
 * @returns enriched rows in the same order.
 */
export function enrichDiscoveredModels(
  candidates: readonly LlmDiscoveredModel[],
  metadata: ModelsDevMetadata,
): EnrichedDiscoveredModel[] {
  return candidates.map(candidate => enrichDiscoveredModel(candidate, selectModelsDevRecord(metadata, candidate.id)))
}

/**
 * Best-effort enrich: load models.dev and fill gaps; on any failure return the
 * original candidates unchanged.
 * @param candidates - discoverModels rows.
 * @returns enriched or original rows.
 */
export async function enrichDiscoveredModelsBestEffort(
  candidates: readonly LlmDiscoveredModel[],
  options?: { baseURL?: string | undefined },
): Promise<EnrichedDiscoveredModel[]> {
  if (enrichmentDisabledForTests || isPrivateOrLocalBaseUrl(options?.baseURL)) {
    return candidates.map(candidate => ({ ...candidate }))
  }
  try {
    const metadata = await loadModelsDevMetadata()
    return enrichDiscoveredModels(candidates, metadata)
  } catch {
    // Metadata enrichment is best-effort; return discovered rows unchanged on network/timeout/parse failure.
    return candidates.map(candidate => ({ ...candidate }))
  }
}
