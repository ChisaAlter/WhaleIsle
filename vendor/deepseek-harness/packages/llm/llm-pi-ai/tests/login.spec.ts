import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import type { AuthorizationInteraction, AuthorizationNotice, AuthorizationPrompt } from '@deepseek-ai/dsh-authorization'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials'
import type { AuthEvent, AuthInteraction, AuthPrompt, AuthType, Credential, LoginOptions } from '@earendil-works/pi-ai'

const login = vi.hoisted(() => vi.fn())

// The whole of what this module does with pi-ai is run one provider's login
// against a collection built with the harness store, so the collection is the
// boundary worth observing; a real login would open a browser.
vi.mock('../src/models.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/models.ts')>(),
  createModels: () => ({ setProvider: () => {}, login }),
}))

const { credentialStoreFrom, authContextFrom, DEVICE_ID_KEY, recordKeyFor } = await import('../src/auth.ts')
const { catalogProvider } = await import('../src/catalog.ts')
const { registerPiAiFlows } = await import('../src/login.ts')

const CODEX = recordKeyFor('openai-codex')
const dirs: string[] = []

/** A context with the record store, the seam, and every pi-ai login flow. */
async function harness(): Promise<Context> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pi-login-'))
  dirs.push(dir)
  const ctx = new Context()
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  await ctx.plugin(AuthorizationService)
  registerPiAiFlows(ctx, { credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) })
  return ctx
}

/** An interaction recording everything a flow says, answering every question. */
function surface(answer = 'typed'): AuthorizationInteraction & {
  notices: AuthorizationNotice[]
  prompts: AuthorizationPrompt[]
} {
  const notices: AuthorizationNotice[] = []
  const prompts: AuthorizationPrompt[] = []
  return {
    notices,
    prompts,
    notify: (notice) => { notices.push(notice) },
    prompt: (prompt) => {
      prompts.push(prompt)
      return Promise.resolve(answer)
    },
  }
}

/** Drive one attempt, letting the mocked login talk back through `converse`. */
async function attempt(
  ctx: Context,
  converse: (interaction: AuthInteraction) => Promise<void>,
  request: { key?: CredentialKey; method?: string } = {},
): Promise<ReturnType<typeof surface>> {
  const ui = surface()
  login.mockImplementation(async (providerId: string, _type: AuthType, interaction: AuthInteraction) => {
    await converse(interaction)
    const granted: Credential = { type: 'oauth', access: 'at', refresh: 'rt', expires: 1 }
    await credentialStoreFrom(ctx).modify(providerId, () => Promise.resolve(granted))
    return granted
  })
  await expect(ctx.authorization.begin({
    key: request.key ?? CODEX,
    interaction: ui,
    ...request.method === undefined ? {} : { method: request.method },
  })).resolves.toEqual({ status: 'authorized' })
  return ui
}

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  login.mockReset()
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('pi-ai login flows', () => {
  it('offers one flow per installed provider, with the methods that provider ships', async () => {
    const ctx = await harness()
    const offered = ctx.authorization.list()

    // The OAuth-only provider is exactly the case this exists for: nothing
    // else could ever configure it.
    expect(offered.find(entry => entry.key === CODEX)?.methods)
      .toEqual([{ id: 'oauth', label: expect.stringContaining('ChatGPT') as string }])
    // A provider offering both keeps both, the subscription login first.
    expect(offered.find(entry => entry.key === recordKeyFor('anthropic'))?.methods.map(one => one.id))
      .toEqual(['oauth', 'api-key'])
    // A key-only provider still gets a flow, because pi-ai collects the key
    // through its own prompt rather than leaving it to the settings form.
    expect(offered.find(entry => entry.key === recordKeyFor('deepseek'))?.methods.map(one => one.id))
      .toEqual(['api-key'])
    // pi-ai ships Sign in with ChatGPT for `openai` first, followed by API key.
    expect(catalogProvider('openai')?.auth.oauth?.loginLabel).toBe('Sign in with ChatGPT')
    expect(offered.find(entry => entry.key === recordKeyFor('openai'))?.methods)
      .toEqual([
        { id: 'oauth', label: 'Sign in with ChatGPT' },
        { id: 'api-key', label: expect.any(String) as string },
      ])
  })

  it('runs the pi-ai auth type the chosen method names', async () => {
    const ctx = await harness()

    await attempt(ctx, () => Promise.resolve())
    expect(login).toHaveBeenLastCalledWith(
      'openai-codex',
      'oauth',
      expect.anything(),
      expect.objectContaining({ agentName: 'WhaleIsle' }),
    )

    await attempt(ctx, () => Promise.resolve(), { key: recordKeyFor('anthropic'), method: 'api-key' })
    expect(login).toHaveBeenLastCalledWith(
      'anthropic',
      'api_key',
      expect.anything(),
      expect.objectContaining({ agentName: 'WhaleIsle' }),
    )
  })

  it('commits what the login produced, where the adapter reads it back', async () => {
    const ctx = await harness()

    await attempt(ctx, () => Promise.resolve())

    await expect(ctx.credentials.readRecord(CODEX)).resolves.toEqual({
      kind: 'grant',
      payload: { type: 'oauth', access: 'at', refresh: 'rt', expires: 1 },
    })
  })

  it('restates every pi-ai login event in the neutral vocabulary', async () => {
    const ctx = await harness()
    const events: AuthEvent[] = [
      { type: 'info', message: 'Read this first', links: [{ url: 'https://help.example' }] },
      { type: 'info', message: 'Nothing to open' },
      { type: 'auth_url', url: 'https://auth.example/start', instructions: 'Approve in the tab' },
      { type: 'auth_url', url: 'https://auth.example/plain' },
      { type: 'device_code', userCode: 'WXYZ-1234', verificationUri: 'https://device.example' },
      { type: 'progress', message: 'Exchanging the code' },
      // pi-ai's event union is open; an unrecognised member must still show
      // the human that something is happening.
      { type: 'quantum-handshake' } as unknown as AuthEvent,
    ]

    const ui = await attempt(ctx, (interaction) => {
      for (const event of events) interaction.notify(event)
      return Promise.resolve()
    })

    expect(ui.notices).toEqual([
      { message: 'Read this first', url: 'https://help.example' },
      { message: 'Nothing to open' },
      { message: 'Approve in the tab', url: 'https://auth.example/start' },
      { message: 'Open this page to continue signing in.', url: 'https://auth.example/plain' },
      {
        message: 'Enter this code on the verification page to finish signing in.',
        url: 'https://device.example',
        code: 'WXYZ-1234',
      },
      { message: 'Exchanging the code' },
      { message: 'Signing in…' },
    ])
  })

  it('restates every pi-ai prompt, carrying the per-prompt withdrawal signal', async () => {
    const ctx = await harness()
    const withdraw = new AbortController()
    const prompts: AuthPrompt[] = [
      { type: 'text', message: 'Your workspace', placeholder: 'acme' },
      { type: 'secret', message: 'Paste the key' },
      { type: 'secret', message: 'Paste the token', placeholder: 'sk-…' },
      { type: 'select', message: 'Which account?', options: [{ id: 'a', label: 'Work' }] },
      // The manual-code question a browser callback can win the race against.
      { type: 'manual_code', message: 'Paste the code', signal: withdraw.signal },
    ]

    const ui = await attempt(ctx, async (interaction) => {
      for (const prompt of prompts) await interaction.prompt(prompt)
    })

    expect(ui.prompts).toEqual([
      { kind: 'text', message: 'Your workspace', placeholder: 'acme' },
      { kind: 'secret', message: 'Paste the key' },
      { kind: 'secret', message: 'Paste the token', placeholder: 'sk-…' },
      { kind: 'select', message: 'Which account?', options: [{ id: 'a', label: 'Work' }] },
      { kind: 'text', message: 'Paste the code', signal: withdraw.signal },
    ])
  })

  it('hands the flow the attempt-wide cancellation signal', async () => {
    const ctx = await harness()
    let seen: AbortSignal | undefined
    const controller = new AbortController()
    login.mockImplementation((_id: string, _type: AuthType, interaction: AuthInteraction) => {
      seen = interaction.signal
      controller.abort()
      return new Promise(() => {})
    })

    await expect(ctx.authorization.begin({
      key: CODEX,
      interaction: surface(),
      signal: controller.signal,
    })).resolves.toEqual({ status: 'cancelled' })
    expect(seen?.aborted).toBe(true)
  })

  it('passes WhaleIsle agentName and a persistent isolated deviceId for openai OAuth login', async () => {
    const ctx = await harness()
    const OPENAI = recordKeyFor('openai')
    const seenIds: string[] = []
    login.mockImplementation(async (
      providerId: string,
      _type: AuthType,
      _interaction: AuthInteraction,
      options?: LoginOptions,
    ) => {
      expect(options?.agentName).toBe('WhaleIsle')
      const id = options?.getDeviceId?.()
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      if (id !== undefined) seenIds.push(id)
      const granted: Credential = { type: 'oauth', access: 'at', refresh: 'rt', expires: 1, clientId: 'oaiapp_123' }
      await credentialStoreFrom(ctx).modify(providerId, () => Promise.resolve(granted))
      return granted
    })

    await expect(ctx.authorization.begin({ key: OPENAI, method: 'oauth', interaction: surface() }))
      .resolves.toEqual({ status: 'authorized' })
    await expect(ctx.authorization.begin({ key: OPENAI, method: 'oauth', interaction: surface() }))
      .resolves.toEqual({ status: 'authorized' })

    expect(seenIds).toHaveLength(2)
    expect(seenIds[0]).toBe(seenIds[1])
    await expect(ctx.credentials.readRecord(DEVICE_ID_KEY)).resolves.toEqual({
      kind: 'grant',
      payload: { deviceId: seenIds[0] },
    })
    // Device ID is stored under its own meta scope so it is never listed as a provider credential.
    await expect(credentialStoreFrom(ctx).list()).resolves.toEqual([
      { providerId: 'openai', type: 'oauth' },
    ])
  })

  it('revokes openai OAuth refresh token on sign-out and ignores revocation failures', async () => {
    const ctx = await harness()
    const OPENAI = recordKeyFor('openai')
    const fetchCalls: { url: string; body: string; contentType: string | null }[] = []
    vi.stubGlobal('fetch', vi.fn((url: string | URL, init?: RequestInit) => {
      const body = init?.body instanceof URLSearchParams
        ? init.body.toString()
        : typeof init?.body === 'string'
          ? init.body
          : ''
      fetchCalls.push({
        url: String(url),
        body,
        contentType: new Headers(init?.headers).get('content-type'),
      })
      return Promise.resolve(new Response(null, { status: 200 }))
    }))

    await ctx.credentials.modifyRecord(OPENAI, () => Promise.resolve({
      kind: 'grant',
      payload: { type: 'oauth', access: 'at', refresh: 'rt-secret', expires: 1, clientId: 'oaiapp_xyz' },
    }))
    await ctx.authorization.revoke(OPENAI)

    expect(fetchCalls).toEqual([{
      url: 'https://auth.openai.com/api/accounts/oauth/revoke',
      body: 'token=rt-secret&token_type_hint=refresh_token&client_id=oaiapp_xyz',
      contentType: 'application/x-www-form-urlencoded',
    }])
    await expect(ctx.credentials.readRecord(OPENAI)).resolves.toBeUndefined()

    // Best-effort: network errors must warn and still remove the local credential.
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    await ctx.credentials.modifyRecord(OPENAI, () => Promise.resolve({
      kind: 'grant',
      payload: { type: 'oauth', access: 'at', refresh: 'rt-2', expires: 1, clientId: 'oaiapp_xyz' },
    }))

    await expect(ctx.authorization.revoke(OPENAI)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    await expect(ctx.credentials.readRecord(OPENAI)).resolves.toBeUndefined()
  })
})
