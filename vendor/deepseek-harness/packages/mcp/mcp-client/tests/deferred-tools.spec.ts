/**
 * Tests for deferred MCP tool loading (`toolDiscoveryMode`, `inlineToolThreshold`),
 * `mcp__<serverName>__search_tools` / `mcp__<serverName>__call_tool`,
 * parameter validation, timeout/cancellation/redaction/structuredContent forwarding,
 * 64-char public name limit, disconnect/reconnect unregistration, and optional
 * disk schema cache integration.
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Transport } from '@modelcontextprotocol/client'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { TestCredentials } from './credential-fixture.ts'
import type { Config } from '@deepseek-ai/dsh-mcp-client'

const {
  mockConnect,
  mockClose,
  mockListTools,
  mockCallTool,
  mockSetNotificationHandler,
  MockClient,
  instances,
} = vi.hoisted(() => {
  const mockConnect = vi.fn<() => Promise<void>>()
  const mockClose = vi.fn<() => Promise<void>>()
  const mockListTools = vi.fn<(_params?: Record<string, unknown>, _options?: unknown) => Promise<unknown>>()
  const mockCallTool = vi.fn<(_params?: Record<string, unknown>, _options?: unknown) => Promise<unknown>>()
  const mockSetNotificationHandler = vi.fn()
  class MockClient {
    transport: Transport | undefined
    onclose: (() => void) | undefined
    async connect(transport: Transport): Promise<void> {
      this.transport = transport
      const onclose = transport.onclose
      transport.onclose = () => { onclose?.(); this.onclose?.() }
      await transport.start()
      await mockConnect.call(this)
    }
    close = mockClose
    getServerCapabilities = (): object => ({ tools: {} })
    getServerVersion = (): { name: string; version: string } => ({ name: 'mock-mcp', version: '1.0.0' })
    getInstructions(): string | undefined { return undefined }
    listResources = async () => ({ resources: [] })
    listTools = mockListTools
    callTool = mockCallTool
    constructor(_info: unknown, options: { listChanged: { tools: { onChanged: () => void } } }) {
      instances.push(this)
      mockSetNotificationHandler('notifications/tools/list_changed', options.listChanged.tools.onChanged)
    }
  }
  const instances: MockClient[] = []
  return { mockConnect, mockClose, mockListTools, mockCallTool, mockSetNotificationHandler, MockClient, instances }
})

vi.mock('@modelcontextprotocol/client', async importOriginal => ({
  ...await importOriginal<typeof import('@modelcontextprotocol/client')>(),
  Client: MockClient,
}))

vi.mock('@modelcontextprotocol/client/stdio', () => ({
  StdioClientTransport: vi.fn(function () {
    return {
      onclose: undefined as (() => void) | undefined,
      start: () => Promise.resolve(),
      send: () => Promise.resolve(),
      close() { this.onclose?.(); return Promise.resolve() },
    }
  }),
}))

import { Config as ConfigSchema, apply } from '../src/index.ts'
import { syncTools } from '../src/tools.ts'
import {
  DEFAULT_INLINE_TOOL_THRESHOLD,
  resolveToolDiscoveryStrategy,
  searchDeferredTools,
} from '../src/deferred-tools.ts'
import type { McpListedTool } from '../src/schema-cache.ts'

async function mountRegistry(): Promise<Context> {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  return ctx
}

function makeTools(count: number): McpListedTool[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `tool_${index + 1}`,
    description: `Synthetic tool number ${index + 1}`,
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        query: { type: 'string' },
        count: { type: 'integer' },
        format: { type: 'string', enum: ['json', 'text'] },
      },
      required: ['query'],
      additionalProperties: false,
    },
  }))
}

function stdioConfig(overrides: Partial<Config> = {}): Config {
  return ConfigSchema({
    transport: 'stdio',
    serverName: 'srv',
    command: 'echo',
    args: [],
    env: {},
    cwd: '',
    toolCallTimeoutMs: 5_000,
    startupTimeoutMs: 10_000,
    failOnStartupError: false,
    ...overrides,
  } as never)
}

async function runTool(ctx: Context, name: string, args: Record<string, unknown>, signal?: AbortSignal) {
  return await executeToolFixture(ctx, {
    callId: ToolCallId(`call-${name}`),
    name,
    arguments: args,
    signal: signal ?? new AbortController().signal,
  })
}

describe('deferred MCP tool discovery and execution', () => {
  let ctx: Context
  let cacheTempDirs: string[]

  beforeEach(async () => {
    instances.length = 0
    mockConnect.mockReset().mockResolvedValue(undefined)
    mockClose.mockReset().mockImplementation(function (this: { transport?: Transport }) {
      this.transport?.onclose?.()
      return Promise.resolve()
    })
    mockListTools.mockReset().mockResolvedValue({ tools: makeTools(DEFAULT_INLINE_TOOL_THRESHOLD + 1) })
    mockCallTool.mockReset().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })
    mockSetNotificationHandler.mockReset()
    cacheTempDirs = []
    ctx = await mountRegistry()
  })

  afterEach(() => {
    for (const dir of cacheTempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function newTempCacheDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-deferred-cache-'))
    cacheTempDirs.push(dir)
    return dir
  }

  it('registers individual tools eagerly when tool count <= inlineToolThreshold (16) under auto mode', async () => {
    mockListTools.mockResolvedValue({ tools: makeTools(DEFAULT_INLINE_TOOL_THRESHOLD) })
    await apply(ctx, stdioConfig())

    const registered = [...ctx.tools.definitions()].map(def => def.name)
    expect(registered).toHaveLength(DEFAULT_INLINE_TOOL_THRESHOLD)
    expect(registered).toContain('mcp__srv__tool_1')
    expect(registered).toContain(`mcp__srv__tool_${DEFAULT_INLINE_TOOL_THRESHOLD}`)
    expect(ctx.tools.get('mcp__srv__search_tools')).toBeUndefined()
    expect(ctx.tools.get('mcp__srv__call_tool')).toBeUndefined()
  })

  it('switches to deferred meta-tools when tool count exceeds inlineToolThreshold under auto mode', async () => {
    mockListTools.mockResolvedValue({ tools: makeTools(DEFAULT_INLINE_TOOL_THRESHOLD + 1) })
    await apply(ctx, stdioConfig())

    const registered = [...ctx.tools.definitions()].map(def => def.name)
    expect(registered).toEqual(['mcp__srv__search_tools', 'mcp__srv__call_tool'])
  })

  it('honors custom inlineToolThreshold, explicit eager, and explicit deferred modes', async () => {
    expect(resolveToolDiscoveryStrategy(4, 'auto', 4)).toBe('eager')
    expect(resolveToolDiscoveryStrategy(5, 'auto', 4)).toBe('deferred')
    expect(resolveToolDiscoveryStrategy(100, 'eager', 1)).toBe('eager')
    expect(resolveToolDiscoveryStrategy(1, 'deferred', 100)).toBe('deferred')

    mockListTools.mockResolvedValue({ tools: makeTools(20) })
    const eagerCtx = await mountRegistry()
    await apply(eagerCtx, stdioConfig({ serverName: 'eager-srv', toolDiscoveryMode: 'eager' }))
    expect(eagerCtx.tools.get('mcp__eager-srv__tool_20')).toBeDefined()
    expect(eagerCtx.tools.get('mcp__eager-srv__search_tools')).toBeUndefined()

    mockListTools.mockResolvedValue({ tools: makeTools(2) })
    const deferredCtx = await mountRegistry()
    await apply(deferredCtx, stdioConfig({ serverName: 'def-srv', toolDiscoveryMode: 'deferred' }))
    expect(deferredCtx.tools.get('mcp__def-srv__search_tools')).toBeDefined()
    expect(deferredCtx.tools.get('mcp__def-srv__call_tool')).toBeDefined()
    expect(deferredCtx.tools.get('mcp__def-srv__tool_1')).toBeUndefined()
  })

  it('searches remote tools by keyword and limit, returning raw name, description, and inputSchema', async () => {
    const tools: McpListedTool[] = [
      {
        name: 'read_issue',
        description: 'Read one issue by identifier',
        inputSchema: { type: 'object', properties: { issueId: { type: 'string' } }, required: ['issueId'] },
      },
      {
        name: 'search_issues',
        description: 'Search issues across projects',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
      },
      {
        name: 'create_comment',
        description: 'Create issue comment on thread',
        inputSchema: { type: 'object', properties: { body: { type: 'string' } }, required: ['body'] },
      },
      {
        name: 'delete_repo',
        description: 'Delete repository permanently',
        inputSchema: { type: 'object', properties: { repo: { type: 'string' } }, required: ['repo'] },
      },
    ]
    mockListTools.mockResolvedValue({ tools })
    await apply(ctx, stdioConfig({ toolDiscoveryMode: 'deferred' }))

    const outcome = await runTool(ctx, 'mcp__srv__search_tools', { query: 'issue', limit: 2 })
    expect(outcome.isError).toBe(false)
    expect(outcome.value).toMatchObject({
      serverName: 'srv',
      totalTools: 4,
      matchedCount: 3,
    })
    const value = outcome.value as { tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> }
    expect(value.tools).toHaveLength(2)
    expect(value.tools[0]).toEqual({
      name: 'read_issue',
      description: 'Read one issue by identifier',
      inputSchema: tools[0]!.inputSchema,
    })

    // Exact/prefix name match ranks first.
    const ranked = searchDeferredTools(tools, 'search_issues', 10)
    expect(ranked.tools[0]?.name).toBe('search_issues')

    // Native rendered output includes raw name, description, and schema.
    const renderedText = outcome.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    expect(renderedText).toContain('read_issue')
    expect(renderedText).toContain('issueId')

    // Rejects invalid non-positive limit.
    const invalidLimit = await runTool(ctx, 'mcp__srv__search_tools', { limit: 0 })
    expect(invalidLimit.isError).toBe(true)
    expect(invalidLimit.error?.message).toContain('"limit" must be a positive integer')
  })

  it('validates target tool name and remote inputSchema before invoking callTool', async () => {
    const tools: McpListedTool[] = [
      ...makeTools(1),
      {
        name: 'task_only',
        description: 'Requires unsupported task execution',
        inputSchema: { type: 'object' },
        execution: { taskSupport: 'required' },
      },
    ]
    mockListTools.mockResolvedValue({ tools })
    await apply(ctx, stdioConfig({ toolDiscoveryMode: 'deferred' }))

    const unknownTool = await runTool(ctx, 'mcp__srv__call_tool', { name: 'does_not_exist', arguments: {} })
    expect(unknownTool.isError).toBe(true)
    expect(unknownTool.error?.message).toContain('Unknown tool "does_not_exist"')

    const taskTool = await runTool(ctx, 'mcp__srv__call_tool', { name: 'task_only', arguments: {} })
    expect(taskTool.isError).toBe(true)
    expect(taskTool.error?.message).toContain('task-based execution')

    const missingRequired = await runTool(ctx, 'mcp__srv__call_tool', { name: 'tool_1', arguments: { count: 2 } })
    expect(missingRequired.isError).toBe(true)
    expect(missingRequired.error?.message).toContain('missing required property "arguments.query"')

    const badType = await runTool(ctx, 'mcp__srv__call_tool', { name: 'tool_1', arguments: { query: 'hi', count: 1.5 } })
    expect(badType.isError).toBe(true)
    expect(badType.error?.message).toContain('"arguments.count" must be of type integer')

    const badEnum = await runTool(ctx, 'mcp__srv__call_tool', { name: 'tool_1', arguments: { query: 'hi', format: 'yaml' } })
    expect(badEnum.isError).toBe(true)
    expect(badEnum.error?.message).toContain('"arguments.format" must be one of')

    const extraProp = await runTool(ctx, 'mcp__srv__call_tool', { name: 'tool_1', arguments: { query: 'hi', extra: true } })
    expect(extraProp.isError).toBe(true)
    expect(extraProp.error?.message).toContain('additionalProperties: false')

    expect(mockCallTool).not.toHaveBeenCalled()
  })

  it('forwards timeout, cancellation, credential redaction, and structuredContent through mcp__<serverName>__call_tool', async () => {
    const token = 'secret-deferred-token-123'
    await ctx.plugin(TestCredentials)
    ;(ctx.credentials as TestCredentials).values.set('MCP_TOKEN', token)
    mockListTools.mockResolvedValue({ tools: makeTools(1) })
    mockCallTool.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'item created' }],
      structuredContent: { id: 42, status: 'created' },
    })

    const cfg = ConfigSchema({
      transport: 'stdio',
      serverName: 'srv',
      command: 'echo',
      env: { API_TOKEN: '${credential:MCP_TOKEN}' },
      expandTemplates: true,
      toolCallTimeoutMs: 4_321,
      toolDiscoveryMode: 'deferred',
    } as never)
    await apply(ctx, cfg)

    const ok = await runTool(ctx, 'mcp__srv__call_tool', {
      name: 'tool_1',
      arguments: { query: 'hello', count: 3 },
    })
    expect(ok.isError).toBe(false)
    expect(ok.value).toEqual({
      content: [{ type: 'text', text: 'item created' }],
      structuredContent: { id: 42, status: 'created' },
    })
    expect(mockCallTool).toHaveBeenCalledTimes(1)
    const callOptions = mockCallTool.mock.calls[0]![1] as { timeout: number; signal: AbortSignal }
    expect(callOptions.timeout).toBe(4_321)
    expect(callOptions.signal).toBeInstanceOf(AbortSignal)

    // MCP isError response gets secret redacted.
    mockCallTool.mockResolvedValueOnce({
      isError: true,
      content: [{ type: 'text', text: `upstream failed using Bearer ${token}` }],
    })
    const errResp = await runTool(ctx, 'mcp__srv__call_tool', {
      name: 'tool_1',
      arguments: { query: 'hello' },
    })
    expect(errResp.isError).toBe(true)
    expect(errResp.error?.message).toBe('upstream failed using Bearer [redacted]')
    expect(errResp.error?.message).not.toContain(token)

    // Thrown wire error gets secret redacted.
    mockCallTool.mockRejectedValueOnce(new Error(`auth header ${token} rejected`))
    const thrownResp = await runTool(ctx, 'mcp__srv__call_tool', {
      name: 'tool_1',
      arguments: { query: 'hello' },
    })
    expect(thrownResp.isError).toBe(true)
    expect(thrownResp.error?.message).toContain('[redacted]')
    expect(thrownResp.error?.message).not.toContain(token)

    // Cancellation propagates through AbortSignal.
    const abortCtrl = new AbortController()
    const pendingGate: PromiseWithResolvers<unknown> = Promise.withResolvers()
    mockCallTool.mockImplementationOnce((_params, options) => {
      const sig = (options as { signal: AbortSignal }).signal
      sig.addEventListener('abort', () => {
        pendingGate.reject(new DOMException('Aborted', 'AbortError'))
      }, { once: true })
      return pendingGate.promise
    })
    const callPromise = runTool(ctx, 'mcp__srv__call_tool', {
      name: 'tool_1',
      arguments: { query: 'wait' },
    }, abortCtrl.signal)
    abortCtrl.abort(new Error('user canceled'))
    const canceled = await callPromise
    expect(canceled.isError).toBe(true)
  })

  it('enforces the 64-character public name limit even for long programmatic serverName', async () => {
    const longServerName = 's'.repeat(60)
    const client = new MockClient(undefined, { listChanged: { tools: { onChanged: () => {} } } })
    mockListTools.mockResolvedValue({ tools: makeTools(2) })

    const disposers = await syncTools(client as never, ctx, {
      serverName: longServerName,
      toolCallTimeoutMs: 5_000,
      signal: new AbortController().signal,
      toolDiscoveryMode: 'deferred',
    }, new Map())

    const names = [...disposers.keys()]
    expect(names).toHaveLength(2)
    for (const name of names) {
      expect(name.length).toBeLessThanOrEqual(64)
      expect(name).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
    }
    expect(new Set(names).size).toBe(2)

    for (const dispose of disposers.values()) dispose()
  })

  it('unregisters meta-tools on disconnect/reconnect and swaps cleanly across list_changed mode transitions', async () => {
    mockListTools.mockResolvedValue({ tools: makeTools(18) })
    await apply(ctx, stdioConfig({ reconnect: { initialDelayMs: 500, maxDelayMs: 500, maxAttempts: 2 } }))

    expect(ctx.tools.get('mcp__srv__search_tools')).toBeDefined()
    expect(ctx.tools.get('mcp__srv__call_tool')).toBeDefined()

    // Shrink below threshold via list_changed -> swaps meta-tools out for inline tools.
    mockListTools.mockResolvedValue({ tools: makeTools(2) })
    const notifyChanged = mockSetNotificationHandler.mock.calls[0]![1] as () => void
    notifyChanged()
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__srv__tool_1')).toBeDefined() })
    expect(ctx.tools.get('mcp__srv__search_tools')).toBeUndefined()
    expect(ctx.tools.get('mcp__srv__call_tool')).toBeUndefined()

    // Grow above threshold again -> swaps back to deferred meta-tools.
    mockListTools.mockResolvedValue({ tools: makeTools(17) })
    notifyChanged()
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__srv__search_tools')).toBeDefined() })
    expect(ctx.tools.get('mcp__srv__tool_1')).toBeUndefined()

    // Disconnect clears both meta-tools completely.
    instances[0]!.transport?.onclose?.()
    await vi.waitFor(() => { expect(ctx.tools.get('mcp__srv__search_tools')).toBeUndefined() })
    expect(ctx.tools.get('mcp__srv__call_tool')).toBeUndefined()
  })

  it('integrates optional disk schema cache on connect and refreshes on list_changed', async () => {
    const cacheDir = newTempCacheDir()
    const cfg1 = stdioConfig({
      serverName: 'cached',
      toolDiscoveryMode: 'deferred',
      schemaCacheDir: cacheDir,
      schemaCacheTtlMs: 60_000,
    })

    mockListTools.mockResolvedValueOnce({ tools: makeTools(2) })
    const c1 = await mountRegistry()
    await apply(c1, cfg1)
    expect(mockListTools).toHaveBeenCalledTimes(1)
    expect(readdirSync(cacheDir)).toHaveLength(1)
    await c1.fiber.dispose()

    // Second instance with same config hits disk schema cache without calling listTools.
    const c2 = await mountRegistry()
    await apply(c2, cfg1)
    expect(mockListTools).toHaveBeenCalledTimes(1)
    const searchRes = await runTool(c2, 'mcp__cached__search_tools', { query: 'tool_2' })
    expect(searchRes.isError).toBe(false)
    expect((searchRes.value as { tools: Array<{ name: string }> }).tools[0]?.name).toBe('tool_2')

    // list_changed bypasses read cache and persists updated list to disk.
    mockListTools.mockResolvedValueOnce({ tools: makeTools(3) })
    const notify = mockSetNotificationHandler.mock.calls.at(-1)![1] as () => void
    notify()
    await vi.waitFor(async () => {
      const updated = await runTool(c2, 'mcp__cached__search_tools', {})
      expect((updated.value as { totalTools: number }).totalTools).toBe(3)
    })
  })
})
