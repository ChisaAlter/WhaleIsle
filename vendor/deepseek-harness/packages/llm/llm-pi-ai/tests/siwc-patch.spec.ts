import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stream as streamOpenAIResponses } from '@earendil-works/pi-ai/api/openai-responses'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import type { AuthEvent } from '@earendil-works/pi-ai'
import { catalogProvider } from '../src/catalog.ts'

const servers: Server[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => {
    server.close(() => { resolve() })
    server.closeAllConnections()
  })))
})

function nonReasoningOpenAIModel() {
  const model = getBuiltinModels('openai').find(candidate => candidate.id === 'gpt-4.1')
  if (model === undefined) throw new Error('gpt-4.1 missing from pi-ai openai catalog')
  return model
}

function responsesCompletedSse(): Response {
  const payload = JSON.stringify({
    type: 'response.completed',
    response: {
      id: 'resp_1',
      status: 'completed',
      output: [{ type: 'message', id: 'msg_1', role: 'assistant', content: [{ type: 'output_text', text: 'ok', annotations: [] }] }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
  })
  return new Response(`data: ${payload}\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function createCaptureFetch(): {
  fetch: typeof globalThis.fetch
  headers: () => Headers | undefined
  body: () => Record<string, unknown> | undefined
} {
  let capturedHeaders: Headers | undefined
  let capturedBody: Record<string, unknown> | undefined
  return {
    headers: () => capturedHeaders,
    body: () => capturedBody,
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      capturedHeaders = request.headers
      capturedBody = JSON.parse(await request.text()) as Record<string, unknown>
      return responsesCompletedSse()
    },
  }
}

describe('pi-ai@1.3.0 SIWC patch hardening', () => {
  it('strips org/project headers and env vars, uses session-id, forces developer role, and strips unsupported params for SIWC', async () => {
    vi.stubEnv('OPENAI_ORG_ID', 'org-from-env')
    vi.stubEnv('OPENAI_PROJECT_ID', 'proj-from-env')

    const capture = createCaptureFetch()
    const model = nonReasoningOpenAIModel()
    expect(model.reasoning).toBe(false)

    const eventStream = streamOpenAIResponses(
      model,
      normalizeContext({
        systemPrompt: 'Follow system instructions.',
        messages: [{ role: 'user', content: 'hi', timestamp: 1 }],
      }),
      {
        apiKey: 'oauth-chatgpt-access-token',
        sessionId: 'sess-siwc-1',
        temperature: 0.7,
        maxTokens: 256,
        samplingParams: { temperature: 0.9, max_output_tokens: 512, top_p: 0.5 },
        headers: { 'openai-organization': 'org-override', 'openai-project': 'proj-override' },
        fetch: capture.fetch,
      },
    )
    for await (const _event of eventStream) { /* drain */ }

    expect(capture.headers()?.has('openai-organization')).toBe(false)
    expect(capture.headers()?.has('openai-project')).toBe(false)
    expect(capture.headers()?.get('session-id')).toBe('sess-siwc-1')
    expect(capture.headers()?.has('session_id')).toBe(false)
    expect(capture.body()).toMatchObject({
      store: false,
      stream: true,
      input: [
        { role: 'developer', content: 'Follow system instructions.' },
        { role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
      ],
    })
    expect(capture.body()).not.toHaveProperty('temperature')
    expect(capture.body()).not.toHaveProperty('max_output_tokens')
    expect(capture.body()).not.toHaveProperty('top_p')
  })

  it('preserves system role and sampling fields for sk- API key authentication', async () => {
    const capture = createCaptureFetch()
    const model = nonReasoningOpenAIModel()
    const eventStream = streamOpenAIResponses(
      model,
      normalizeContext({
        systemPrompt: 'Follow system instructions.',
        messages: [{ role: 'user', content: 'hi', timestamp: 1 }],
      }),
      {
        apiKey: 'sk-platform-key',
        sessionId: 'sess-api-1',
        temperature: 0.3,
        maxTokens: 128,
        fetch: capture.fetch,
      },
    )
    for await (const _event of eventStream) { /* drain */ }

    expect(capture.headers()?.get('session-id')).toBe('sess-api-1')
    expect(capture.body()).toMatchObject({
      temperature: 0.3,
      max_output_tokens: 128,
      input: [
        { role: 'system', content: 'Follow system instructions.' },
        { role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
      ],
    })
  })

  it('appends ChatGPT usage URL on workplace individual usage limit exceeded errors', async () => {
    const mockFetch: typeof globalThis.fetch = () => Promise.resolve(new Response(
      JSON.stringify({
        error: {
          code: 'subscription_sharing_workplace_individual_usage_limit_exceeded',
          message: 'Workspace usage limit reached',
        },
      }),
      { status: 429, headers: { 'content-type': 'application/json' } },
    ))

    const model = nonReasoningOpenAIModel()
    const events: unknown[] = []
    for await (const event of streamOpenAIResponses(
      model,
      normalizeContext({ messages: [{ role: 'user', content: 'hi', timestamp: 1 }] }),
      { apiKey: 'oauth-chatgpt-access-token', maxRetries: 0, fetch: mockFetch },
    )) events.push(event)

    const terminal = events.at(-1) as { type: string; error?: { errorMessage?: string } }
    expect(terminal.type).toBe('error')
    expect(terminal.error?.errorMessage).toContain('subscription_sharing_workplace_individual_usage_limit_exceeded')
    expect(terminal.error?.errorMessage).toContain('https://chatgpt.com/settings/usage')
  })

  it('falls back to an ephemeral loopback port when port 1455 is in use and propagates the dynamic redirect_uri', async () => {
    const blocker = createServer((_req, res) => { res.writeHead(404).end() })
    servers.push(blocker)
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject)
      blocker.listen(1455, '127.0.0.1', resolve)
    }).catch((error: unknown) => {
      // If 1455 is already occupied externally on the machine, port 1455 is still unavailable as desired.
      if (!(error instanceof Error && 'code' in error && error.code === 'EADDRINUSE')) throw error
    })

    const oauth = catalogProvider('openai')?.auth.oauth
    if (oauth === undefined) throw new Error('openai oauth provider missing')

    const controller = new AbortController()
    let seenAuthUrl = ''
    let seenPlaceholder = ''
    let exchangedRedirectUri = ''

    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn((input: string | URL, init?: RequestInit) => {
      if (String(input) === 'https://auth.openai.com/api/accounts/oauth/token') {
        const rawBody = init?.body instanceof URLSearchParams
          ? init.body.toString()
          : typeof init?.body === 'string'
            ? init.body
            : ''
        const params = new URLSearchParams(rawBody)
        exchangedRedirectUri = params.get('redirect_uri') ?? ''
        return Promise.resolve(new Response(JSON.stringify({
          access_token: 'at-123',
          refresh_token: 'rt-123',
          id_token: 'id-123',
          expires_in: 3600,
          scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
        }), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      return originalFetch(input, init)
    }))

    const authUrlReady = Promise.withResolvers<string>()
    const loginPromise = oauth.login(
      {
        signal: controller.signal,
        notify(event: AuthEvent) {
          if (event.type === 'auth_url') {
            seenAuthUrl = event.url
            authUrlReady.resolve(event.url)
          }
        },
        prompt(prompt) {
          seenPlaceholder = prompt.type === 'manual_code' ? (prompt.placeholder ?? '') : ''
          return new Promise<string>((_resolve, reject) => {
            prompt.signal?.addEventListener('abort', () => { reject(new Error('withdrawn')) }, { once: true })
          })
        },
      },
      {
        agentName: 'Whale Isle',
        getDeviceId: () => '11111111-1111-4111-8111-111111111111',
      },
    )

    const authUrl = new URL(await authUrlReady.promise)
    const redirectUri = authUrl.searchParams.get('redirect_uri') ?? ''
    const state = authUrl.searchParams.get('state') ?? ''

    expect(seenAuthUrl).toContain('agent_name_hint=Whale+Isle')
    expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/)
    expect(redirectUri).not.toBe('http://127.0.0.1:1455/auth/callback')
    expect(seenPlaceholder).toBe(redirectUri)

    const callbackResponse = await originalFetch(`${redirectUri}?code=code-abc&state=${encodeURIComponent(state)}&client_id=oaiapp_dynamic`)
    expect(callbackResponse.status).toBe(200)

    const credential = await loginPromise
    expect(exchangedRedirectUri).toBe(redirectUri)
    expect(credential).toMatchObject({
      type: 'oauth',
      access: 'at-123',
      refresh: 'rt-123',
      clientId: 'oaiapp_dynamic',
    })
  })
})
