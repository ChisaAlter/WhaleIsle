// @vitest-environment jsdom
/** Custom headers, compatibility overrides, and non-blocking connection test in pi-ai provider forms. */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { ProviderEditor } from '../src/client/ProviderEditor.tsx'
import { CustomProviderCard } from '../src/client/CustomProviderCard.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { ModelsOperations } from '../src/client/operations.ts'
import {
  resetModelsDevMetadataCache,
  setModelsDevEnrichmentDisabledForTests,
} from '../src/client/models-dev-metadata.ts'
import { settingsSchema } from './settings-schema.client.ts'

afterEach(() => {
  cleanup()
  resetModelsDevMetadataCache()
  setModelsDevEnrichmentDisabledForTests(false)
})

beforeEach(() => {
  setModelsDevEnrichmentDisabledForTests(true)
})

const t = (key: keyof typeof en): string => en[key]

const PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'] as const
const MAX_TOKENS_FIELDS = ['max_completion_tokens', 'max_tokens'] as const
const THINKING_FORMATS = ['openai', 'deepseek', 'qwen', 'ant-ling'] as const

const PiAiConfig = Schema.object({
  providers: Schema.dict(Schema.object({
    apiKeyEnv: Schema.string(),
    displayName: Schema.string(),
    api: Schema.union([...PROTOCOLS]),
    baseURL: Schema.string(),
    headers: Schema.dict(Schema.string()),
    compat: Schema.object({
      supportsStore: Schema.boolean(),
      supportsDeveloperRole: Schema.boolean(),
      supportsReasoningEffort: Schema.boolean(),
      requiresReasoningContentOnAssistantMessages: Schema.boolean(),
      maxTokensField: Schema.union([...MAX_TOKENS_FIELDS]),
      thinkingFormat: Schema.union([...THINKING_FORMATS]),
      supportsStrictMode: Schema.boolean(),
      allowEmptySignature: Schema.boolean(),
    }),
    models: Schema.array(Schema.object({
      id: Schema.string().required(),
      name: Schema.string(),
      contextWindow: Schema.number(),
      maxTokens: Schema.number(),
    })),
  })),
})

function piAiView(
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
    revision: 3,
  }
}

function chooseSelect(label: string, optionLabel: string): void {
  fireEvent.click(screen.getByLabelText(label))
  fireEvent.click(screen.getByRole('menuitem', { name: optionLabel }))
}

function makeOperations(overrides: Partial<ModelsOperations> = {}): ModelsOperations {
  return {
    storeCredential: vi.fn(async () => undefined),
    removeCredential: vi.fn(async () => undefined),
    writeSettings: vi.fn(async () => ({
      kind: 'written' as const,
      view: piAiView({}),
    })),
    discoverModels: vi.fn(async () => ({
      kind: 'found' as const,
      models: [{ id: 'gpt-4o' }, { id: 'gpt-4.1' }],
    })),
    startAuthorization: vi.fn(async () => {}),
    respondAuthorizationPrompt: vi.fn(async () => undefined),
    cancelAuthorization: vi.fn(async () => undefined),
    removeCredentialRecord: vi.fn(async () => undefined),
    openExternalUrl: vi.fn(),
    ...overrides,
  }
}

describe('pi-ai provider extras', () => {
  it('edits, validates, and unsets custom HTTP headers in ProviderEditor', async () => {
    const opsLog: unknown[] = []
    let storedOpenAi: Record<string, JsonValue> = {
      apiKeyEnv: 'OPENAI_API_KEY',
      headers: { 'X-Existing': '1' },
    }
    const writeSettings = vi.fn(async (_ns: string, ops: unknown) => {
      opsLog.push(ops)
      const list = ops as readonly { op: string; path: readonly string[]; value?: JsonValue }[]
      const nextHeaders = { ...((storedOpenAi['headers'] as Record<string, string> | undefined) ?? {}) }
      let hasHeaders = storedOpenAi['headers'] !== undefined
      for (const item of list) {
        if (item.path[2] === 'headers' && item.path.length === 3 && item.op === 'unset') {
          hasHeaders = false
        } else if (item.path[2] === 'headers' && item.path.length === 4) {
          const headerKey = item.path[3]
          if (headerKey !== undefined) {
            if (item.op === 'set' && typeof item.value === 'string') {
              nextHeaders[headerKey] = item.value
              hasHeaders = true
            } else if (item.op === 'unset') {
              const filtered = Object.entries(nextHeaders).filter(([k]) => k !== headerKey)
              hasHeaders = filtered.length > 0
            }
          }
        }
      }
      storedOpenAi = hasHeaders
        ? { apiKeyEnv: 'OPENAI_API_KEY', headers: nextHeaders }
        : { apiKeyEnv: 'OPENAI_API_KEY' }
      return {
        kind: 'written' as const,
        view: piAiView({ openai: storedOpenAi }),
      }
    })
    const operations = makeOperations({ writeSettings })
    const onClose = vi.fn()

    render(
      <ProviderEditor
        provider="openai"
        displayName="OpenAI"
        namespace={piAiView({ openai: storedOpenAi })}
        schema={settingsSchema}
        settingsPath={['providers', 'openai']}
        operations={operations}
        credential={{ configured: true, source: 'file', masked: 'sk-***', writable: true }}
        t={t}
        readOnly={false}
        onClose={onClose}
      />,
    )

    fireEvent.click(screen.getByText(en.customized))
    expect(screen.getByLabelText<HTMLInputElement>(`${en.headerName} 1`).value).toBe('X-Existing')
    expect(screen.getByLabelText<HTMLInputElement>(`${en.headerValue} 1`).value).toBe('1')

    // Adding a blank header disables apply with an inline validation error.
    fireEvent.click(screen.getByRole('button', { name: en.addHeader }))
    expect(screen.getByText(en.headerNameRequired)).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.apply }).disabled).toBe(true)

    // Case-insensitive duplicate HTTP headers are rejected.
    fireEvent.change(screen.getByLabelText(`${en.headerName} 2`), { target: { value: 'x-existing' } })
    expect(screen.getByText(en.headerDuplicate)).toBeTruthy()

    // Invalid header characters are rejected via Fetch Headers validation.
    fireEvent.change(screen.getByLabelText(`${en.headerName} 2`), { target: { value: 'Bad Header' } })
    expect(screen.getByText(en.headerInvalid)).toBeTruthy()

    // Fix row 2 to a valid header and submit.
    fireEvent.change(screen.getByLabelText(`${en.headerName} 2`), { target: { value: 'X-Tenant' } })
    fireEvent.change(screen.getByLabelText(`${en.headerValue} 2`), { target: { value: 'acme' } })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.apply }).disabled).toBe(false)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.apply }))
    })
    expect(opsLog[0]).toEqual([
      { op: 'set', path: ['providers', 'openai', 'headers', 'X-Tenant'], value: 'acme' },
    ])

    // Removing all headers emits unset on the headers dict cleanly.
    fireEvent.click(screen.getByLabelText(`${en.removeHeader} 2`))
    fireEvent.click(screen.getByLabelText(`${en.removeHeader} 1`))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.apply }))
    })
    expect(opsLog[1]).toEqual([
      { op: 'unset', path: ['providers', 'openai', 'headers'] },
    ])
  })

  it('edits all seven key compat switches while preserving unrelated compat keys', async () => {
    const writtenOps: unknown[] = []
    const operations = makeOperations({
      writeSettings: vi.fn(async (_ns, ops) => {
        writtenOps.push(ops)
        return { kind: 'written' as const, view: piAiView({}) }
      }),
    })

    render(
      <ProviderEditor
        provider="openai"
        displayName="OpenAI"
        namespace={piAiView({
          openai: {
            apiKeyEnv: 'OPENAI_API_KEY',
            compat: {
              supportsStore: false,
            },
          },
        })}
        schema={settingsSchema}
        settingsPath={['providers', 'openai']}
        operations={operations}
        credential={{ configured: true, source: 'file', masked: 'sk-***', writable: true }}
        t={t}
        readOnly={false}
        onClose={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText(en.customized))
    // `compat` had an existing key (`supportsStore`), so the compat fold opens immediately.
    chooseSelect(en.compatSupportsDeveloperRole, en.compatDisabled)
    chooseSelect(en.compatSupportsReasoningEffort, en.compatEnabled)
    chooseSelect(en.compatRequiresReasoningContent, en.compatEnabled)
    chooseSelect(en.compatMaxTokensField, 'max_tokens')
    chooseSelect(en.compatThinkingFormat, 'deepseek')
    chooseSelect(en.compatSupportsStrictMode, en.compatDisabled)
    chooseSelect(en.compatAllowEmptySignature, en.compatEnabled)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.apply }))
    })

    expect(writtenOps[0]).toEqual([
      { op: 'set', path: ['providers', 'openai', 'compat', 'supportsDeveloperRole'], value: false },
      { op: 'set', path: ['providers', 'openai', 'compat', 'supportsReasoningEffort'], value: true },
      { op: 'set', path: ['providers', 'openai', 'compat', 'requiresReasoningContentOnAssistantMessages'], value: true },
      { op: 'set', path: ['providers', 'openai', 'compat', 'maxTokensField'], value: 'max_tokens' },
      { op: 'set', path: ['providers', 'openai', 'compat', 'thinkingFormat'], value: 'deepseek' },
      { op: 'set', path: ['providers', 'openai', 'compat', 'supportsStrictMode'], value: false },
      { op: 'set', path: ['providers', 'openai', 'compat', 'allowEmptySignature'], value: true },
    ])
  })

  it('runs Test Connection non-blockingly, displays latency and model count or errors, and keeps saved models intact', async () => {
    let resolveDiscovery: ((outcome: { kind: 'found'; models: { id: string }[] }) => void) | undefined
    const discoverModels = vi.fn(async () => ({
      kind: 'found' as const,
      models: [{ id: 'saved-model' }],
    }))
    const operations = makeOperations({ discoverModels })

    render(
      <ProviderEditor
        provider="openai"
        displayName="OpenAI"
        namespace={piAiView({
          openai: {
            apiKeyEnv: 'OPENAI_API_KEY',
            models: [{ id: 'saved-model', name: 'Saved Model' }],
          },
        })}
        schema={settingsSchema}
        settingsPath={['providers', 'openai']}
        operations={operations}
        credential={{ configured: true, source: 'file', masked: 'sk-***', writable: true }}
        t={t}
        readOnly={false}
        onClose={vi.fn()}
      />,
    )

    // Allow ModelListEditor's initial catalog metadata check to settle, then intercept Test Connection.
    await act(async () => { await Promise.resolve() })
    discoverModels.mockClear()
    discoverModels.mockImplementationOnce(
      () => new Promise<{ kind: 'found'; models: { id: string }[] }>((resolve) => {
        resolveDiscovery = resolve
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: en.testConnection }))
    expect(discoverModels).toHaveBeenCalledOnce()
    // Non-blocking: submit button and key input remain interactive while testing is in flight.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.apply }).disabled).toBe(false)
    expect(screen.getByLabelText<HTMLInputElement>(en.keyInput).disabled).toBe(false)

    await act(async () => {
      resolveDiscovery?.({ kind: 'found', models: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }] })
    })

    const status = await screen.findByRole('status')
    expect(status.textContent).toMatch(/Connected \(\d+ ms, 3 models\)/)

    // Saved models list was never overwritten by Test Connection.
    fireEvent.click(screen.getByText(en.customized))
    expect(screen.getByDisplayValue<HTMLInputElement>('saved-model').value).toBe('saved-model')

    // Refused discovery reports explicit error message inline.
    const refusedOps = makeOperations({
      discoverModels: vi.fn(async () => ({ kind: 'refused' as const, message: 'HTTP 401 unauthorized' })),
    })
    cleanup()
    render(
      <ProviderEditor
        provider="openai"
        displayName="OpenAI"
        namespace={piAiView({ openai: { apiKeyEnv: 'OPENAI_API_KEY' } })}
        schema={settingsSchema}
        settingsPath={['providers', 'openai']}
        operations={refusedOps}
        credential={{ configured: true, source: 'file', masked: 'sk-***', writable: true }}
        t={t}
        readOnly={false}
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: en.testConnection }))
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('Connection failed: HTTP 401 unauthorized')
    })

    // Unexpected transport rejection also surfaces an explicit error without wedging the button.
    const rejectedOps = makeOperations({
      discoverModels: vi.fn(async () => { throw new Error('ECONNREFUSED') }),
    })
    cleanup()
    render(
      <ProviderEditor
        provider="openai"
        displayName="OpenAI"
        namespace={piAiView({ openai: { apiKeyEnv: 'OPENAI_API_KEY' } })}
        schema={settingsSchema}
        settingsPath={['providers', 'openai']}
        operations={rejectedOps}
        credential={{ configured: true, source: 'file', masked: 'sk-***', writable: true }}
        t={t}
        readOnly={false}
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: en.testConnection }))
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('Connection failed: ECONNREFUSED')
    })
  })

  it('persists headers and protocol-filtered compat from CustomProviderCard', async () => {
    const writes: unknown[] = []
    const operations = makeOperations({
      writeSettings: vi.fn(async (_ns, ops) => {
        writes.push(ops)
        return { kind: 'written' as const, view: piAiView({}) }
      }),
    })

    render(
      <CustomProviderCard
        taken={[]}
        protocols={[...PROTOCOLS]}
        reasoningLevels={[]}
        revision={4}
        operations={operations}
        t={t}
        readOnly={false}
        onClose={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText(en.customRoute), { target: { value: 'proxy-gw' } })
    fireEvent.change(screen.getByLabelText(en.baseUrl), { target: { value: 'https://gw.example/v1' } })
    fireEvent.change(screen.getByLabelText(en.keyInput), { target: { value: 'sk-test-key' } })

    fireEvent.click(screen.getByRole('button', { name: en.addHeader }))
    fireEvent.change(screen.getByLabelText(`${en.headerName} 1`), { target: { value: 'X-Proxy' } })
    fireEvent.change(screen.getByLabelText(`${en.headerValue} 1`), { target: { value: 'yes' } })

    fireEvent.click(screen.getByRole('button', { name: en.compatTitle }))
    // Default protocol is openai-completions, so anthropic-only field is hidden and completions fields appear.
    expect(screen.queryByLabelText(en.compatAllowEmptySignature)).toBeNull()
    chooseSelect(en.compatSupportsDeveloperRole, en.compatDisabled)
    chooseSelect(en.compatThinkingFormat, 'deepseek')

    fireEvent.click(screen.getByRole('button', { name: en.addModel }))
    fireEvent.change(screen.getByLabelText(`${en.modelId} 1`), { target: { value: 'deepseek-chat' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.create }))
    })

    expect(writes[0]).toEqual([
      {
        op: 'set',
        path: ['providers', 'proxy-gw'],
        value: {
          apiKeyEnv: 'PROXY_GW_API_KEY',
          api: 'openai-completions',
          baseURL: 'https://gw.example/v1',
          headers: { 'X-Proxy': 'yes' },
          compat: {
            supportsDeveloperRole: false,
            thinkingFormat: 'deepseek',
          },
          models: [{ id: 'deepseek-chat' }],
        },
      },
    ])

    // Verify zh translations are populated for all new UI keys.
    expect(zh.headersTitle).toBe('自定义 HTTP 请求头')
    expect(zh.compatTitle).toBe('兼容性参数')
    expect(zh.testConnection).toBe('检测连接')
  })
})
