import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'

import type { Api, Model, SimpleStreamOptions, TranscriptContext } from '@earendil-works/pi-ai'

const streamSimple = vi.hoisted(() => vi.fn())

// A hand-declared route is built by `createProvider` over the protocol table in
// `src/provider.ts`, so the table's lazy api module is the SDK boundary this
// test can observe. A catalog route dispatches through pi-ai's own provider and
// would not see this mock.
vi.mock('@earendil-works/pi-ai/api/openai-completions.lazy', () => ({
  openAICompletionsApi: () => ({ stream: streamSimple, streamSimple }),
}))

import { PiAiAdapter } from '../src/adapter.ts'
import { DEFAULT_TOTAL_REQUEST_TIMEOUT_MS, resolveProfiles } from '../src/config.ts'
import { memoryAuth } from './auth-double.ts'

afterEach(() => {
  vi.useRealTimers()
  streamSimple.mockReset()
})

/** A hand-declared OpenAI-compatible route with one fully described model. */
function gatewayAdapter(timeoutMs?: number, modelId = 'local-model'): PiAiAdapter {
  return new PiAiAdapter({
    profiles: () => resolveProfiles({
      'local-gateway': {
        api: 'openai-completions',
        baseURL: 'http://127.0.0.1:9/v1',
        ...timeoutMs === undefined ? {} : { timeoutMs },
        models: [{ id: modelId, contextWindow: 8192, maxTokens: 1024 }],
      },
    }),
    resolveApiKey: () => Promise.resolve('test-key'),
    auth: memoryAuth(),
  })
}

async function drain(adapter: PiAiAdapter, model = 'local-model'): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of adapter.stream({
    provider: 'local-gateway',
    model,
    messages: [],
  })) chunks.push(chunk)
  return chunks
}

describe('pi-ai SDK retry boundary', () => {
  it('pins one SDK attempt even when the installed provider currently defaults to zero retries', async () => {
    streamSimple.mockImplementation(() => { throw new Error('mock SDK boundary') })

    const chunks = await drain(gatewayAdapter())

    expect(streamSimple).toHaveBeenCalledOnce()
    expect(streamSimple.mock.calls[0]?.[2]).toMatchObject({ maxRetries: 0, apiKey: 'test-key' })
    // pi-ai reports a setup failure as a terminal in-stream error rather than
    // throwing, which the converter turns into the harness error finish.
    expect(chunks.at(-1)).toMatchObject({
      type: 'finish',
      reason: { kind: 'error', failure: { message: 'mock SDK boundary' } },
    })
  })

  it('dispatches a hand-declared route to the endpoint and model its configuration describes', async () => {
    streamSimple.mockImplementation(() => { throw new Error('mock SDK boundary') })

    await drain(gatewayAdapter())

    expect(streamSimple.mock.calls[0]?.[0]).toMatchObject({
      id: 'local-model',
      provider: 'local-gateway',
      api: 'openai-completions',
      baseUrl: 'http://127.0.0.1:9/v1',
      contextWindow: 8192,
      maxTokens: 1024,
    })
  })

  it('extracts Retry-After passed through pi-ai onResponse hook onto error finish chunks', async () => {
    const impl = (model: Model<Api>, _context: TranscriptContext, options?: SimpleStreamOptions) => (async function * () {
      await options?.onResponse?.({ status: 429, headers: { 'retry-after': '12' } }, model)
      yield {
        type: 'error' as const,
        reason: 'error' as const,
        error: {
          role: 'assistant' as const,
          content: [],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'error' as const,
          errorMessage: '429 rate limited',
          timestamp: 0,
        },
      }
    })()
    streamSimple.mockImplementation(impl)

    const chunks = await drain(gatewayAdapter())

    expect(chunks.at(-1)).toMatchObject({
      type: 'finish',
      reason: {
        kind: 'error',
        failure: {
          code: 'RATE_LIMIT',
          providerRetryAfterMs: 12_000,
        },
      },
    })
  })

  it('defaults total request timeout to DEFAULT_TOTAL_REQUEST_TIMEOUT_MS, supports overrides, and allows disabling with 0', async () => {
    const okEvents = (model: Model<Api>) => (async function * () {
      yield {
        type: 'done' as const,
        reason: 'stop' as const,
        message: {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: 'ok' }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'stop' as const,
          timestamp: 0,
        },
      }
    })()

    streamSimple.mockImplementation(okEvents)
    await drain(gatewayAdapter())
    expect(DEFAULT_TOTAL_REQUEST_TIMEOUT_MS).toBe(600_000)
    expect(streamSimple.mock.calls[0]?.[2]).toMatchObject({ timeoutMs: 600_000 })

    streamSimple.mockReset()
    streamSimple.mockImplementation(okEvents)
    await drain(gatewayAdapter(1234))
    expect(streamSimple.mock.calls[0]?.[2]).toMatchObject({ timeoutMs: 1234 })

    streamSimple.mockReset()
    streamSimple.mockImplementation(okEvents)
    await drain(gatewayAdapter(0))
    expect(streamSimple.mock.calls[0]?.[2]).not.toHaveProperty('timeoutMs')
  })

  it('enforces the wall-clock total request timeout even when a stream ignores abort or trickles chunks, and disables it when timeoutMs is 0', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    streamSimple.mockImplementation(() => (async function * () {
      await new Promise(() => {
        // Intentionally never resolves and ignores options.signal.
      })
      yield * []
    })())

    const timedOut = expect(drain(gatewayAdapter(250))).rejects.toMatchObject({
      name: 'LlmError',
      code: 'TIMEOUT',
    })
    await vi.advanceTimersByTimeAsync(250)
    await timedOut

    const tricklingResponse = (model: Model<Api>) => (async function * () {
      const partialMessage = {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: '' }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop' as const,
        timestamp: 0,
      }
      yield { type: 'start' as const, partial: partialMessage }
      yield { type: 'text_start' as const, contentIndex: 0, partial: partialMessage }
      for (const piece of ['a', 'b', 'c']) {
        await new Promise(resolve => setTimeout(resolve, 210_000))
        yield { type: 'text_delta' as const, contentIndex: 0, delta: piece, partial: partialMessage }
      }
      yield { type: 'text_end' as const, contentIndex: 0, content: 'abc', partial: partialMessage }
      yield { type: 'done' as const, reason: 'stop' as const, message: { ...partialMessage, content: [{ type: 'text' as const, text: 'abc' }] } }
    })()

    // Even with chunks arriving inside streamIdleTimeoutMs (210s < 300s), default total timeout cuts off at 600s.
    streamSimple.mockReset()
    streamSimple.mockImplementation(tricklingResponse)
    const defaultTimedOut = expect(drain(gatewayAdapter())).rejects.toMatchObject({
      name: 'LlmError',
      code: 'TIMEOUT',
      message: `pi-ai request timed out after ${DEFAULT_TOTAL_REQUEST_TIMEOUT_MS}ms`,
    })
    await vi.advanceTimersByTimeAsync(600_000)
    await defaultTimedOut

    // Explicit timeoutMs: 0 disables the total wall-clock cap while keeping the stream active within idle bounds.
    streamSimple.mockReset()
    streamSimple.mockImplementation(tricklingResponse)
    const completed = expect(drain(gatewayAdapter(0))).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'finish', reason: { kind: 'stop' } }),
    ]))
    await vi.advanceTimersByTimeAsync(630_000)
    await completed
  })

  it('passes safe DeepSeek compat defaults to streamSimple on third-party gateways', async () => {
    streamSimple.mockImplementation(() => { throw new Error('mock SDK boundary') })
    await drain(gatewayAdapter(undefined, 'deepseek-v4-pro'), 'deepseek-v4-pro')
    expect(streamSimple.mock.calls[0]?.[0]).toMatchObject({
      id: 'deepseek-v4-pro',
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        requiresReasoningContentOnAssistantMessages: true,
      },
    })
  })
})
