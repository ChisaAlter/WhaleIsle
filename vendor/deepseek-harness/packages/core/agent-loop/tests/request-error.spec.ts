import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LlmRuntime, { createUserMessage, LlmError, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { LlmFailure, ResolvedRetryPolicy, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse, toolCallResponse } from './mock-adapter.ts'

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

function fail(message: string, code: string): () => never {
  return () => {
    throw LlmError.fromFailure({ message: message, code: code })
  }
}

describe('agent/request-error', () => {
  it('retries malformed completed tool calls before persisting an assistant message', async () => {
    const adapter = new MockAdapter([toolCallResponse('', '', {}), textResponse('recovered')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('malformed-retry'), { provider: 'mock', model: 'mock' })
    const failures: string[] = []
    ctx.on('agent/request-error', async ({ failure }) => {
      failures.push(failure.code)
      return failures.length === 1 ? { kind: 'retry' } : undefined
    })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(failures).toEqual(['MALFORMED_RESPONSE'])
    expect(adapter.requests).toHaveLength(2)
    const events = agent.session.snapshotEvents()
    expect(events.filter(event => event.type === 'assistant/message')).toHaveLength(1)
    expect(events.filter(event => event.type === 'tool/call' || event.type === 'tool/result')).toHaveLength(0)
    await ctx.fiber.dispose()
  })
  it('does not offer middleware failures to request recovery', async () => {
    const adapter = new MockAdapter([textResponse('unused')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('request-error-narrow'), { provider: 'mock', model: 'mock' })
    let recoveries = 0
    ctx.on('agent/request', () => {
      throw LlmError.fromFailure({ message: 'middleware failed', code: 'MIDDLEWARE' })
    })
    ctx.on('agent/request-error', async () => {
      recoveries += 1
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(recoveries).toBe(0)
    expect(adapter.requests).toHaveLength(0)
  })

  it('lets each failed request return a retry action before its turn closes', async () => {
    const adapter = new MockAdapter([
      fail('busy', 'RATE_LIMIT'),
      fail('unavailable', 'SERVICE_UNAVAILABLE'),
      textResponse('ok'),
    ])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('request-error-retry'), { provider: 'mock', model: 'mock' })
    const seen: {
      turn: number
      step: number
      failure: LlmFailure
      retryPolicy: ResolvedRetryPolicy | undefined
    }[] = []
    const statuses: string[] = []
    ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent) statuses.push(status)
    })
    ctx.on('agent/request-error', async ({ agent: subject, turn, step, failure, retryPolicy }) => {
      expect(subject).toBe(agent)
      seen.push({ turn, step, failure, retryPolicy })
      return { kind: 'retry' }
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(seen.map(item => ({
      turn: item.turn,
      step: item.step,
      code: item.failure.code,
    }))).toEqual([
      {
        turn: 1,
        step: 1,
        code: 'RATE_LIMIT',
      },
      {
        turn: 1,
        step: 1,
        code: 'SERVICE_UNAVAILABLE',
      },
    ])
    expect(agent.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(seen.map(item => item.retryPolicy)).toEqual([
      expect.objectContaining({ mode: 'normal' }),
      expect.objectContaining({ mode: 'normal' }),
    ])
    expect(statuses).toEqual(['running', 'idle'])
    expect(agent.session.snapshotEvents().flatMap(event =>
      event.type === 'request/header' ? [event.data.reason] : [])).toEqual(['initial'])
  })

  it('lets cancellation win over a retry action', async () => {
    const adapter = new MockAdapter([fail('busy', 'RATE_LIMIT'), textResponse('unused')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('request-error-cancel'), { provider: 'mock', model: 'mock' })
    ctx.on('agent/request-error', async ({ agent: subject }) => {
      subject.cancel({ kind: 'user' })
      return { kind: 'retry' }
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(agent.session.snapshotEvents().find(event => event.type === 'turn/end')).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'aborted', reason: { kind: 'user' } } },
    })
  })

  it('does not retry when the recovery listener fails before returning its action', async () => {
    const adapter = new MockAdapter([fail('busy', 'RATE_LIMIT'), textResponse('unused')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('request-error-recovery-failed'), {
      provider: 'mock',
      model: 'mock',
    })
    ctx.on('agent/request-error', async () => {
      throw new Error('recovery failed')
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(agent.session.snapshotEvents().find(event => event.type === 'turn/end')).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'error' } },
    })
  })

  it('routes mid-stream LlmError exceptions through agent/request-error and retries without duplicate partial messages', async () => {
    const partialThenThrow: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'half-written' },
    ]
    const adapter = new MockAdapter([partialThenThrow, textResponse('recovered full reply')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('mid-stream-retry'), { provider: 'mock', model: 'mock' })
    let failFirst = true
    ctx.on('llm/stream', async function* (_options, next) {
      for await (const chunk of next()) yield chunk
      if (failFirst) {
        failFirst = false
        throw new LlmError('stream interrupted mid-body', 'TRANSPORT')
      }
    })
    const seenCodes: string[] = []
    ctx.on('agent/request-error', async ({ failure }) => {
      seenCodes.push(failure.code)
      return { kind: 'retry' }
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(seenCodes).toEqual(['TRANSPORT'])
    expect(adapter.requests).toHaveLength(2)
    const events = agent.session.snapshotEvents()
    const messages = events.filter(event => event.type === 'assistant/message')
    expect(messages).toHaveLength(1)
    expect(messages[0]?.type === 'assistant/message' ? messages[0].data.message.content : undefined)
      .toEqual([{ type: 'text', text: 'recovered full reply' }])
    expect(events.filter(event => event.type === 'assistant/attempt')).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
  })

  it('retains visible text/reasoning without orphaned tool-call blocks when mid-stream LlmError is not retried or retries fail', async () => {
    const adapter = new MockAdapter([
      [
        { type: 'block-start', index: 0, blockType: 'reasoning' },
        { type: 'reasoning-delta', index: 0, text: 'thought prefix' },
        { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'thought prefix' } },
        { type: 'block-start', index: 1, blockType: 'text' },
        { type: 'text-delta', index: 1, text: 'visible partial text' },
        { type: 'block-start', index: 2, blockType: 'tool-call' },
        { type: 'tool-call-delta', index: 2, id: ToolCallId('call_orphan'), name: 'read', argumentsDelta: '{"pa' },
      ],
      [
        { type: 'block-start', index: 0, blockType: 'reasoning' },
        { type: 'reasoning-delta', index: 0, text: 'final thought' },
        { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'final thought' } },
        { type: 'block-start', index: 1, blockType: 'text' },
        { type: 'text-delta', index: 1, text: 'final visible text' },
        { type: 'block-start', index: 2, blockType: 'tool-call' },
        {
          type: 'block-end',
          index: 2,
          block: { type: 'tool-call', id: ToolCallId('call_closed_orphan'), name: 'read', arguments: '{}' },
        },
      ],
    ])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('mid-stream-partial-preserve'), { provider: 'mock', model: 'mock' })
    ctx.on('llm/stream', async function* (_options, next) {
      for await (const chunk of next()) yield chunk
      throw new LlmError('upstream timed out mid-stream', 'TIMEOUT')
    })
    let attempts = 0
    ctx.on('agent/request-error', async () => {
      attempts += 1
      return attempts === 1 ? { kind: 'retry' } : undefined
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(attempts).toBe(2)
    const events = agent.session.snapshotEvents()
    // First attempt retried -> settled as assistant/attempt (no duplicate partial message).
    expect(events.filter(event => event.type === 'assistant/attempt')).toHaveLength(1)
    // Second (final) attempt failed -> preserves safe text/reasoning without tool-call blocks.
    const messages = events.filter(event => event.type === 'assistant/message')
    expect(messages).toHaveLength(1)
    const saved = messages[0]!
    expect(saved.type === 'assistant/message' ? saved.data.interrupted : undefined).toBe(true)
    expect(saved.type === 'assistant/message' ? saved.data.message.content : undefined).toEqual([
      { type: 'reasoning', text: 'final thought' },
      { type: 'text', text: 'final visible text' },
    ])
    expect(events.some(event => event.type === 'tool/call')).toBe(false)
    expect(events.at(-1)).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'error', error: { code: 'TIMEOUT' } } },
    })
    expect(() => Session.fromRestore(
      agent.session.id,
      structuredClone([...events]),
      structuredClone(agent.session.header),
      SessionLogOffset(0),
      'detached',
    )).not.toThrow()
  })

  it('settles assistant/attempt when mid-stream LlmError fails before any visible text or reasoning arrives', async () => {
    const adapter = new MockAdapter([[
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: ToolCallId('call_only'), name: 'read', argumentsDelta: '{' },
    ]])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('mid-stream-no-visible'), { provider: 'mock', model: 'mock' })
    ctx.on('llm/stream', async function* (_options, next) {
      for await (const chunk of next()) yield chunk
      throw new LlmError('connection dropped', 'TRANSPORT')
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    const events = agent.session.snapshotEvents()
    expect(events.some(event => event.type === 'assistant/message')).toBe(false)
    expect(events.filter(event => event.type === 'assistant/attempt')).toHaveLength(1)
  })
})
