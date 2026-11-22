/**
 * Unit coverage for models.dev match / enrich helpers used after discovery.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  enrichDiscoveredModel,
  enrichDiscoveredModels,
  enrichDiscoveredModelsBestEffort,
  isPrivateOrLocalBaseUrl,
  loadModelsDevMetadata,
  reasoningEffortsFromMetadata,
  resetModelsDevMetadataCache,
  selectModelsDevRecord,
} from '../src/client/models-dev-metadata.ts'

afterEach(() => {
  resetModelsDevMetadataCache()
  vi.unstubAllGlobals()
})

const SAMPLE_CATALOG = {
  openai: {
    id: 'openai',
    models: {
      'gpt-4o': {
        name: 'GPT-4o',
        limit: { context: 128_000, output: 16_384 },
        reasoning: false,
      },
      'o3': {
        name: 'o3',
        limit: { context: 200_000, output: 100_000 },
        reasoning_options: [{ type: 'effort', values: ['off', 'low', 'medium', 'high'] }],
      },
    },
  },
  'openrouter': {
    id: 'openrouter',
    models: {
      'gpt-4o': {
        name: 'GPT-4o (router)',
        limit: { context: 64_000, output: 8_192 },
        reasoning: false,
      },
    },
  },
  deepseek: {
    id: 'deepseek',
    models: {
      'deepseek-reasoner': {
        name: 'DeepSeek Reasoner',
        limit: { context: 64_000, output: 8_000 },
        reasoning_options: [{ type: 'effort', values: ['off', 'high', 'max'] }],
      },
    },
  },
}

describe('selectModelsDevRecord', () => {
  it('prefers the official provider when the model id names one', () => {
    const record = selectModelsDevRecord(SAMPLE_CATALOG, 'gpt-4o')
    expect(record).toEqual(SAMPLE_CATALOG.openai.models['gpt-4o'])
  })

  it('matches deepseek ids to the deepseek provider', () => {
    const record = selectModelsDevRecord(SAMPLE_CATALOG, 'deepseek-reasoner')
    expect(record).toEqual(SAMPLE_CATALOG.deepseek.models['deepseek-reasoner'])
  })

  it('returns undefined when nothing matches', () => {
    expect(selectModelsDevRecord(SAMPLE_CATALOG, 'acme-private-1')).toBeUndefined()
  })
})

describe('reasoningEffortsFromMetadata', () => {
  it('returns false for a non-reasoning model', () => {
    expect(reasoningEffortsFromMetadata({ reasoning: false })).toBe(false)
  })

  it('maps effort option values onto a reasoningEfforts dict', () => {
    expect(reasoningEffortsFromMetadata({
      reasoning_options: [{ type: 'effort', values: ['none', 'high', 'max'] }],
    })).toEqual({ off: null, high: 'high', max: 'max' })
  })

  it('ignores an effort list that only offers off', () => {
    expect(reasoningEffortsFromMetadata({
      reasoning_options: [{ type: 'effort', values: ['off'] }],
    })).toBeUndefined()
  })
})

describe('enrichDiscoveredModel', () => {
  it('fills missing capacities and reasoning from metadata', () => {
    expect(enrichDiscoveredModel(
      { id: 'o3' },
      SAMPLE_CATALOG.openai.models.o3,
    )).toEqual({
      id: 'o3',
      name: 'o3',
      contextWindow: 200_000,
      maxTokens: 100_000,
      reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high' },
    })
  })

  it('keeps endpoint-disclosed capacities over metadata', () => {
    expect(enrichDiscoveredModel(
      { id: 'o3', contextWindow: 1_000, maxTokens: 50, name: 'Local o3' },
      SAMPLE_CATALOG.openai.models.o3,
    )).toEqual({
      id: 'o3',
      name: 'Local o3',
      contextWindow: 1_000,
      maxTokens: 50,
      reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high' },
    })
  })

  it('leaves the candidate unchanged without a record', () => {
    expect(enrichDiscoveredModel({ id: 'mystery', contextWindow: 4096 }, undefined))
      .toEqual({ id: 'mystery', contextWindow: 4096 })
  })
})

describe('enrichDiscoveredModelsBestEffort', () => {
  it('enriches against a loaded catalog', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve(SAMPLE_CATALOG),
    })))
    await expect(enrichDiscoveredModelsBestEffort([{ id: 'deepseek-reasoner' }])).resolves.toEqual([
      {
        id: 'deepseek-reasoner',
        name: 'DeepSeek Reasoner',
        contextWindow: 64_000,
        maxTokens: 8_000,
        reasoningEfforts: { off: null, high: 'high', max: 'max' },
      },
    ])
  })

  it('returns the original candidates when models.dev fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    await expect(enrichDiscoveredModelsBestEffort([{ id: 'o3' }]))
      .resolves.toEqual([{ id: 'o3' }])
  })

  it('enriches a whole list in discover order', () => {
    expect(enrichDiscoveredModels(
      [{ id: 'gpt-4o' }, { id: 'unknown' }],
      SAMPLE_CATALOG,
    )).toEqual([
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        contextWindow: 128_000,
        maxTokens: 16_384,
        reasoningEfforts: false,
      },
      { id: 'unknown' },
    ])
  })

  it('skips models.dev fetch for localhost and private gateway baseURLs', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    for (const localUrl of [
      'http://localhost:8080/v1',
      'http://127.0.0.1:8080/v1',
      'http://[::1]:8080/v1',
      'http://10.2.3.4:8080/v1',
      'http://172.16.5.6:8080/v1',
      'http://192.168.1.20:8080/v1',
      'http://magpie.local/v1',
    ]) {
      expect(isPrivateOrLocalBaseUrl(localUrl), localUrl).toBe(true)
      await expect(enrichDiscoveredModelsBestEffort([{ id: 'local-model' }], { baseURL: localUrl }))
        .resolves.toEqual([{ id: 'local-model' }])
    }
    expect(isPrivateOrLocalBaseUrl('https://api.deepseek.com/v1')).toBe(false)
    expect(isPrivateOrLocalBaseUrl('http://172.32.0.1/v1')).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('attaches an AbortSignal with a 2s timeout when fetching models.dev', async () => {
    const controller = new AbortController()
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    let seenSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      seenSignal = init?.signal ?? undefined
      return new Promise((_resolve, reject) => {
        seenSignal?.addEventListener('abort', () => reject(seenSignal?.reason ?? new Error('aborted')))
      })
    }))
    try {
      const pending = loadModelsDevMetadata()
      expect(timeoutSpy).toHaveBeenCalledWith(2_000)
      expect(seenSignal).toBe(controller.signal)
      expect(seenSignal?.aborted).toBe(false)
      controller.abort(new DOMException('Timed out', 'TimeoutError'))
      expect(seenSignal?.aborted).toBe(true)
      await expect(pending).rejects.toThrow()
    } finally {
      timeoutSpy.mockRestore()
    }
  })
})
