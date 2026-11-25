// @vitest-environment jsdom
/** OAuth sign-in, interactive prompts, usage shortcut, sign-out, and Add Provider activation. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import { Context } from '@deepseek-ai/cordis'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  AuthorizationEntry,
  AuthorizationStreamEvent,
  CredentialRecordInfo,
  SettingsNamespaceView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { ModelsSection, type ModelsSectionProps } from '../src/client/ModelsSection.tsx'
import { ProviderEditor } from '../src/client/ProviderEditor.tsx'
import { ProviderOAuthControl } from '../src/client/ProviderOAuthControl.tsx'
import { createModelsOperations, type ModelsOperations } from '../src/client/operations.ts'
import { ModelsSettingsStore } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'
import { settingsSchema } from './settings-schema.client.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const t = (key: keyof typeof en): string => en[key]

const PiAiConfig = Schema.object({
  providers: Schema.dict(Schema.object({
    apiKeyEnv: Schema.string().role('credential-ref'),
    api: Schema.union(['openai-completions', 'openai-responses']),
    baseURL: Schema.string(),
  })),
})

function piAiNamespace(
  providers: Record<string, JsonValue>,
  userProviders: Record<string, JsonValue> = providers,
): SettingsNamespaceView {
  return {
    ns: 'llm-pi-ai',
    schema: JSON.parse(JSON.stringify(PiAiConfig.toJSON())) as JsonValue,
    value: { providers },
    base: { providers: {} },
    user: { providers: userProviders },
    autoGenerate: true,
    applies: 'live',
    secrets: [],
    revision: 5,
  }
}

function oauthFlowFor(provider: string, label = 'Sign in with OAuth'): AuthorizationEntry {
  return {
    key: `llm-pi-ai/${provider}` as AuthorizationEntry['key'],
    label: provider,
    methods: [{ id: 'oauth', label }],
    inFlight: false,
  }
}

function makeControlledStream() {
  const queue: AuthorizationStreamEvent[] = []
  let waiter: (() => void) | undefined
  let ended = false
  let failure: unknown
  let disposed = false

  const push = (event: AuthorizationStreamEvent): void => {
    if (ended) return
    queue.push(event)
    waiter?.()
    waiter = undefined
  }

  const end = (): void => {
    ended = true
    waiter?.()
    waiter = undefined
  }

  const fail = (error: unknown): void => {
    failure = error
    ended = true
    waiter?.()
    waiter = undefined
  }

  const stream = {
    dispose: vi.fn(() => {
      disposed = true
      end()
    }),
    async *[Symbol.asyncIterator](): AsyncIterator<AuthorizationStreamEvent> {
      while (true) {
        while (queue.length > 0) {
          const item = queue.shift()
          if (item !== undefined) yield item
        }
        if (failure !== undefined) throw failure
        if (ended) return
        await new Promise<void>((resolve) => { waiter = resolve })
      }
    },
  }

  return {
    stream,
    push,
    end,
    fail,
    isDisposed: () => disposed,
  }
}

function makeOperations(overrides: Partial<ModelsOperations> = {}): ModelsOperations {
  return {
    storeCredential: vi.fn(async () => undefined),
    removeCredential: vi.fn(async () => undefined),
    writeSettings: vi.fn(async () => ({ kind: 'written' as const, view: piAiNamespace({}) })),
    discoverModels: vi.fn(async () => ({ kind: 'found' as const, models: [] })),
    startAuthorization: vi.fn(async () => {}),
    respondAuthorizationPrompt: vi.fn(async () => undefined),
    cancelAuthorization: vi.fn(async () => undefined),
    removeCredentialRecord: vi.fn(async () => undefined),
    openExternalUrl: vi.fn(),
    ...overrides,
  }
}

describe('createModelsOperations OAuth and external URL helpers', () => {
  it('opens http(s) URLs via shell.openExternal first and falls back to window.open, rejecting unsafe schemes', () => {
    const openExternal = vi.fn(async () => {})
    const winOpen = vi.fn()
    vi.stubGlobal('shell', { openExternal })
    vi.stubGlobal('window', { open: winOpen })

    const ctx = Object.assign(new Context(), {
      remote: {
        credentials: { set: vi.fn(), unset: vi.fn(), deleteRecord: vi.fn() },
        llm: { discoverModels: vi.fn() },
        settings: { mutate: vi.fn() },
      },
    }) as never
    const ops = createModelsOperations(ctx)

    ops.openExternalUrl('https://chatgpt.com/settings/usage')
    expect(openExternal).toHaveBeenCalledWith('https://chatgpt.com/settings/usage')
    expect(winOpen).not.toHaveBeenCalled()

    ops.openExternalUrl('javascript:alert(1)')
    ops.openExternalUrl('file:///etc/passwd')
    expect(openExternal).toHaveBeenCalledTimes(1)

    vi.stubGlobal('shell', undefined)
    ops.openExternalUrl('http://localhost:1455/callback')
    expect(winOpen).toHaveBeenCalledWith('http://localhost:1455/callback', '_blank', 'noopener,noreferrer')
  })

  it('streams authorization events, disposes on abort, responds to prompts, cancels, and deletes records', async () => {
    const controlled = makeControlledStream()
    const start = vi.fn(() => controlled.stream)
    const respondPrompt = vi.fn(async () => ({ ok: true as const, value: undefined }))
    const cancel = vi.fn(async () => ({ ok: true as const, value: undefined }))
    const deleteRecord = vi.fn(async () => ({ ok: true as const, value: undefined }))
    const ctx = Object.assign(new Context(), {
      remote: {
        authorization: { start, respondPrompt, cancel },
        credentials: { set: vi.fn(), unset: vi.fn(), deleteRecord },
        llm: { discoverModels: vi.fn() },
        settings: { mutate: vi.fn() },
      },
    }) as never
    const ops = createModelsOperations(ctx)

    const seen: AuthorizationStreamEvent[] = []
    const ac = new AbortController()
    const pending = ops.startAuthorization('llm-pi-ai/openai', 'oauth', (event) => { seen.push(event) }, ac.signal)
    controlled.push({ type: 'notice', notice: { message: 'Open browser', url: 'https://auth.openai.com/authorize' } })
    await waitFor(() => { expect(seen).toHaveLength(1) })
    ac.abort()
    await pending
    expect(controlled.isDisposed()).toBe(true)

    expect(await ops.respondAuthorizationPrompt('p-1', 'code-123')).toBeUndefined()
    expect(respondPrompt).toHaveBeenCalledWith('p-1', 'code-123')
    expect(await ops.cancelAuthorization('llm-pi-ai/openai')).toBeUndefined()
    expect(cancel).toHaveBeenCalledWith('llm-pi-ai/openai')
    expect(await ops.removeCredentialRecord('llm-pi-ai/openai')).toBeUndefined()
    expect(deleteRecord).toHaveBeenCalledWith('llm-pi-ai/openai')
  })
})

describe('ProviderOAuthControl', () => {
  it('renders Sign in with ChatGPT for openai and the flow label for other OAuth providers', () => {
    const ops = makeOperations()
    const { rerender } = render(
      <ProviderOAuthControl
        provider="openai"
        oauthKey="llm-pi-ai/openai"
        oauthFlow={oauthFlowFor('openai', 'ChatGPT OAuth')}
        operations={ops}
        t={t}
        onAuthorized={vi.fn()}
        onSignedOut={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: en.oauthSignInChatGpt })).toBeTruthy()
    expect(screen.getByText(en.oauthChatGptHint)).toBeTruthy()

    rerender(
      <ProviderOAuthControl
        provider="openai-codex"
        oauthKey="llm-pi-ai/openai-codex"
        oauthFlow={oauthFlowFor('openai-codex', 'ChatGPT Plus/Pro (Codex)')}
        operations={ops}
        t={t}
        onAuthorized={vi.fn()}
        onSignedOut={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'ChatGPT Plus/Pro (Codex)' })).toBeTruthy()
    expect(screen.queryByText(en.oauthChatGptHint)).toBeNull()
  })

  it('auto-opens notice URL once per unique URL, shows code, allows reopen, and cancels cleanly', async () => {
    const controlled = makeControlledStream()
    let capturedOnEvent: ((event: AuthorizationStreamEvent) => void) | undefined
    let capturedSignal: AbortSignal | undefined
    const cancelAuthorization = vi.fn(async () => undefined)
    const openExternalUrl = vi.fn()
    const ops = makeOperations({
      openExternalUrl,
      cancelAuthorization,
      startAuthorization: vi.fn<ModelsOperations['startAuthorization']>((_key, _method, onEvent, signal) => {
        capturedOnEvent = onEvent
        capturedSignal = signal
        return (async () => {
          for await (const event of controlled.stream) {
            if (signal.aborted) break
            onEvent(event)
          }
        })()
      }),
    })

    render(
      <ProviderOAuthControl
        provider="openai"
        oauthKey="llm-pi-ai/openai"
        oauthFlow={oauthFlowFor('openai')}
        operations={ops}
        t={t}
        onAuthorized={vi.fn()}
        onSignedOut={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: en.oauthSignInChatGpt }))
    await waitFor(() => { expect(capturedOnEvent).toBeDefined() })

    await act(async () => {
      controlled.push({
        type: 'notice',
        notice: { message: 'Complete sign-in in browser.', url: 'https://auth.openai.com/a', code: 'ABCD-1234' },
      })
      // Same URL emitted again must not auto-open twice.
      controlled.push({
        type: 'notice',
        notice: { message: 'Still waiting…', url: 'https://auth.openai.com/a', code: 'ABCD-1234' },
      })
    })

    expect(openExternalUrl).toHaveBeenCalledTimes(1)
    expect(openExternalUrl).toHaveBeenCalledWith('https://auth.openai.com/a')
    expect(screen.getByText('ABCD-1234')).toBeTruthy()
    expect(screen.getByText('Still waiting…')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en.oauthOpenBrowser }))
    expect(openExternalUrl).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(capturedSignal?.aborted).toBe(true)
    expect(cancelAuthorization).toHaveBeenCalledWith('llm-pi-ai/openai')
    expect(screen.getByRole('button', { name: en.oauthSignInChatGpt })).toBeTruthy()
  })

  it('handles text, select, prompt-withdrawn, stream error, and cancelled settlement', async () => {
    const controlled = makeControlledStream()
    const respondAuthorizationPrompt = vi.fn(async () => undefined)
    const onAuthorized = vi.fn()
    const ops = makeOperations({
      respondAuthorizationPrompt,
      startAuthorization: vi.fn<ModelsOperations['startAuthorization']>(async (_key, _method, onEvent, signal) => {
        for await (const event of controlled.stream) {
          if (signal.aborted) break
          onEvent(event)
        }
      }),
    })

    render(
      <ProviderOAuthControl
        provider="openai"
        oauthKey="llm-pi-ai/openai"
        oauthFlow={oauthFlowFor('openai')}
        operations={ops}
        t={t}
        onAuthorized={onAuthorized}
        onSignedOut={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: en.oauthSignInChatGpt }))
    await waitFor(() => { expect(screen.getByText(en.oauthSigningIn)).toBeTruthy() })

    await act(async () => {
      controlled.push({
        type: 'prompt',
        promptId: 'prompt-text',
        prompt: { kind: 'text', message: 'Paste redirect URL', placeholder: 'http://localhost:1455/...' },
      })
    })
    fireEvent.change(screen.getByLabelText('Paste redirect URL'), { target: { value: 'http://localhost:1455/cb?code=1' } })
    fireEvent.click(screen.getByRole('button', { name: en.oauthPromptSubmit }))
    await waitFor(() => {
      expect(respondAuthorizationPrompt).toHaveBeenCalledWith('prompt-text', 'http://localhost:1455/cb?code=1')
    })

    // Select prompt and prompt-withdrawn
    await act(async () => {
      controlled.push({
        type: 'prompt',
        promptId: 'prompt-select',
        prompt: {
          kind: 'select',
          message: 'Choose workspace',
          options: [
            { id: 'ws-1', label: 'Personal' },
            { id: 'ws-2', label: 'Team', description: 'Pro' },
          ],
        },
      })
    })
    expect(screen.getByLabelText('Choose workspace')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Choose workspace'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Team — Pro' }))
    fireEvent.click(screen.getByRole('button', { name: en.oauthPromptSubmit }))
    await waitFor(() => {
      expect(respondAuthorizationPrompt).toHaveBeenCalledWith('prompt-select', 'ws-2')
    })

    await act(async () => {
      controlled.push({
        type: 'prompt',
        promptId: 'prompt-race',
        prompt: { kind: 'secret', message: 'One-time code' },
      })
    })
    expect(screen.getByLabelText('One-time code')).toBeTruthy()
    await act(async () => {
      controlled.push({ type: 'prompt-withdrawn', promptId: 'prompt-race' })
    })
    expect(screen.queryByLabelText('One-time code')).toBeNull()

    await act(async () => {
      controlled.push({ type: 'error', code: 'OAUTH_FAILED', message: 'Token exchange failed' })
      controlled.end()
    })
    expect(screen.getByText('Token exchange failed')).toBeTruthy()
    expect(onAuthorized).not.toHaveBeenCalled()
  })

  it('renders connected state with Manage usage, Sign out, and API key precedence warning', async () => {
    const openExternalUrl = vi.fn()
    const removeCredentialRecord = vi.fn(async () => undefined)
    const onSignedOut = vi.fn()
    const ops = makeOperations({ openExternalUrl, removeCredentialRecord })
    const oauthCredential: CredentialRecordInfo = { configured: true, kind: 'grant', writable: true }

    render(
      <ProviderOAuthControl
        provider="openai"
        oauthKey="llm-pi-ai/openai"
        oauthFlow={oauthFlowFor('openai')}
        oauthCredential={oauthCredential}
        hasApiKeyConflict
        operations={ops}
        t={t}
        onAuthorized={vi.fn()}
        onSignedOut={onSignedOut}
      />,
    )

    expect(screen.getByText(en.oauthConnectedChatGpt)).toBeTruthy()
    expect(screen.getByText(en.oauthApiKeyPrecedence)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en.oauthManageUsage }))
    expect(openExternalUrl).toHaveBeenCalledWith('https://chatgpt.com/settings/usage')

    fireEvent.click(screen.getByRole('button', { name: en.oauthSignOut }))
    await waitFor(() => { expect(removeCredentialRecord).toHaveBeenCalledWith('llm-pi-ai/openai') })
    expect(onSignedOut).toHaveBeenCalledTimes(1)
  })
})

describe('ProviderEditor and ModelsSection OAuth integration', () => {
  it('hides API key field for keylessNativeAuth while showing OAuth control', () => {
    const ops = makeOperations()
    render(
      <ProviderEditor
        provider="openai-codex"
        displayName="OpenAI Codex"
        configured
        namespace={piAiNamespace({ 'openai-codex': {} })}
        schema={settingsSchema}
        settingsPath={['providers', 'openai-codex']}
        nativeAuth={{ env: [], oauth: true }}
        oauthKey="llm-pi-ai/openai-codex"
        oauthFlow={oauthFlowFor('openai-codex', 'Sign in with ChatGPT Codex')}
        operations={ops}
        t={t}
        readOnly={false}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Sign in with ChatGPT Codex' })).toBeTruthy()
    expect(screen.queryByLabelText(en.keyInput)).toBeNull()
  })

  it('auto-activates an unconfigured openai provider on Add Provider OAuth success and shows Signed in dot on row', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => null)
    let currentProviders: Record<string, JsonValue> = {}
    let signedIn = false
    const mirrorRef: { current?: SettingsDescribeMirror } = {}
    const mutate = vi.fn(async (_ns: string, ops: unknown) => {
      const list = ops as readonly { op: string; path: readonly string[]; value?: JsonValue }[]
      for (const item of list) {
        if (item.op === 'set' && item.path[0] === 'providers' && item.path[1] === 'openai') {
          currentProviders = { ...currentProviders, openai: item.value ?? {} }
        }
      }
      await mirrorRef.current?.load()
      return { ok: true as const, value: piAiNamespace(currentProviders) }
    })
    const startStream = vi.fn((_key: string, _method: string | undefined) => {
      signedIn = true
      return (async function * () {
        yield { type: 'notice', notice: { message: 'Open browser', url: 'https://auth.openai.com/oauth' } } satisfies AuthorizationStreamEvent
        yield { type: 'done', status: 'authorized' } satisfies AuthorizationStreamEvent
      })()
    })
    const face = {
      llm: {
        listProviders: vi.fn(async () => ({
          ok: true as const,
          value: Object.keys(currentProviders).map(id => ({ id, name: id })),
        })),
        listConfigurableProviders: vi.fn(async () => ({
          ok: true as const,
          value: [{
            provider: 'openai',
            displayName: 'OpenAI',
            settingsNs: 'llm-pi-ai',
            settingsPath: ['providers', 'openai'],
            nativeAuth: { env: ['OPENAI_API_KEY'], oauth: true },
          }],
        })),
        discoverModels: vi.fn(async () => ({ ok: true as const, value: [] })),
      },
      settings: {
        describe: vi.fn(async () => ({
          ok: true as const,
          value: { writable: true, hasDocument: false, namespaces: [piAiNamespace(currentProviders)] },
        })),
        mutate,
      },
      credentials: {
        describe: vi.fn(async (refs: string[]) => ({
          ok: true as const,
          value: Object.fromEntries(refs.map(ref => [ref, { configured: false, writable: true }])),
        })),
        describeRecords: vi.fn(async (keys: string[]) => ({
          ok: true as const,
          value: Object.fromEntries(keys.map(key => [key, { configured: signedIn, kind: 'grant', writable: true }])),
        })),
        set: vi.fn(),
        unset: vi.fn(),
        deleteRecord: vi.fn(async () => {
          signedIn = false
          return { ok: true as const, value: undefined }
        }),
      },
      authorization: {
        list: vi.fn(async () => ({ ok: true as const, value: [oauthFlowFor('openai', 'Sign in with ChatGPT')] })),
        start: startStream,
        respondPrompt: vi.fn(async () => ({ ok: true as const, value: undefined })),
        cancel: vi.fn(async () => ({ ok: true as const, value: undefined })),
      },
      session: {
        modelCatalog: vi.fn(async () => ({ ok: true as const, value: { groups: [] } })),
      },
    }
    const ctx = Object.assign(new Context(), { remote: face }) as never
    const mirror = new SettingsDescribeMirror(ctx)
    mirrorRef.current = mirror
    const controller = new ModelsSettingsStore(ctx, settingsSchema, mirror)
    await controller.load()

    const injected: ModelsSectionProps = {
      controller,
      useSnapshot: bindSnapshotSelector(controller.store),
      operations: createModelsOperations(ctx),
      schema: settingsSchema,
      t,
      renderSlot: () => null,
    }
    render(<ModelsSection {...injected} />)

    fireEvent.click(screen.getByRole('button', { name: en.add }))
    fireEvent.click(screen.getByRole('button', { name: en.oauthSignInChatGpt }))

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith(
        'llm-pi-ai',
        [{ op: 'set', path: ['providers', 'openai'], value: {} }],
        5,
      )
    })

    // Row is now configured without apiKeyEnv, and shows Signed in green dot in row header.
    await waitFor(() => {
      const rowItem = screen.getByText('OpenAI').closest('li')
      expect(rowItem).toBeTruthy()
      expect(within(rowItem!).getByText(en.accountSignedIn)).toBeTruthy()
    })
  })
})
