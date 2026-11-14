import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { LlmAdapter, contentHasImage, createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, ImageBlock, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import VisionFallback from '@deepseek-ai/dsh-llm-vision-fallback'
import SessionStore, { KNOWN_SESSION_EVENT_TYPES, Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { textResponse } from './mock-adapter.ts'

class Adapter extends LlmAdapter {
  requests: GenerateOptions[] = []
  failVision = false
  hangVision = false
  onRequest?: (options: GenerateOptions) => void
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: model === 'text' ? ['text'] : ['text', 'image'] })
  }
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    this.onRequest?.(options)
    if (options.model === 'vision' && this.hangVision) {
      await new Promise<void>(resolve => {
        if (options.signal?.aborted) resolve()
        else options.signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      return
    }
    if (options.model === 'vision' && this.failVision) {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: 'vision auth refused', code: 'AUTH' } } }
      return
    }
    yield* textResponse(options.model === 'vision' ? 'Visible text: example' : 'main reply')
  }
}

const image: ImageBlock = {
  type: 'image',
  attachment: { attachmentId: `sha256:${'a'.repeat(64)}` as never, mediaType: 'image/png', bytes: 1, width: 1, height: 1 },
}
const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function setup(model = 'text', timeoutMs = 1000) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(VisionFallback, { maxOutputTokens: 128, timeoutMs, provider: 'mock', model: 'vision' })
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new Adapter()
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = await ctx.agentLoop.create(SessionId('vision-integration'), { provider: 'mock', model })
  return { ctx, adapter, agent }
}

describe('vision fallback request integration', () => {
  it('consumes the configured route, logs descriptions before dispatch, and reuses them after reload', async () => {
    const { ctx, adapter, agent } = await setup()
    adapter.onRequest = options => {
      if (options.model === 'text') {
        expect(agent.session.snapshotEvents().filter(event => event.type === 'vision/describe')).toHaveLength(1)
      }
    }
    expect(KNOWN_SESSION_EVENT_TYPES.has('vision/describe')).toBe(true)
    agent.followup(createUserMessage({ content: [image], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')?.data).toEqual({ turn: 1, reason: { kind: 'completed' } })
    expect(adapter.requests.map(request => request.model)).toEqual(['vision', 'text'])
    expect(adapter.requests[0]?.purpose).toBe('vision-describe')
    expect(adapter.requests[1]?.messages.some(message => contentHasImage(message.content))).toBe(false)
    expect(JSON.stringify(adapter.requests[1]?.messages)).toContain('Visible text: example')
    expect(agent.session.snapshotEvents().filter(event => event.type === 'vision/describe')).toHaveLength(1)
    expect(agent.session.deriveMessages().some(message => contentHasImage(message.content))).toBe(true)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(adapter.requests.map(request => request.model)).toEqual(['vision', 'text', 'text'])
    const reloaded = Session.create(agent.id, agent.session.snapshotEvents())
    const replay = await ctx.visionFallback.replayMessages(reloaded, { provider: 'mock', model: 'text' }, reloaded.deriveMessages(), new AbortController().signal)
    expect(JSON.stringify(replay)).toContain('Visible text: example')
    expect(adapter.requests).toHaveLength(3)
  })

  it('leaves native vision requests on the primary route', async () => {
    const { adapter, agent } = await setup('native')
    agent.followup(createUserMessage({ content: [image], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(adapter.requests.map(request => request.model)).toEqual(['native'])
    expect(adapter.requests[0]?.messages.some(message => contentHasImage(message.content))).toBe(true)
  })

  it('refuses replay without a logged description instead of calling the vision model', async () => {
    const { ctx, adapter, agent } = await setup()
    const messages = [createUserMessage({ content: [image], source: { kind: 'user' } })]
    await expect(ctx.visionFallback.replayMessages(agent.session, { provider: 'mock', model: 'text' }, messages, new AbortController().signal))
      .rejects.toThrow(/missing logged description/)
    expect(adapter.requests).toHaveLength(0)
  })

  it('does not log a description when cancelled during the auxiliary request', async () => {
    const { ctx, adapter, agent } = await setup()
    const controller = new AbortController()
    adapter.onRequest = () => controller.abort(new Error('cancelled vision'))
    const messages = [createUserMessage({ content: [image], source: { kind: 'user' } })]
    await expect(ctx.visionFallback.rewriteMessages(agent.session, { provider: 'mock', model: 'text' }, messages, controller.signal))
      .rejects.toThrow('cancelled vision')
    expect(agent.session.snapshotEvents().filter(event => event.type === 'vision/describe')).toHaveLength(0)
    expect(adapter.requests.map(request => request.model)).toEqual(['vision'])
  })

  it('does not dispatch the primary model after the auxiliary deadline expires', async () => {
    const { adapter, agent } = await setup('text', 10)
    adapter.hangVision = true
    agent.followup(createUserMessage({ content: [image], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(adapter.requests.map(request => request.model)).toEqual(['vision'])
    expect(agent.session.snapshotEvents().filter(event => event.type === 'vision/describe')).toHaveLength(0)
    expect(agent.session.snapshotEvents().findLast(event => event.type === 'turn/end'))
      .toMatchObject({ data: { reason: { kind: 'error', error: { code: 'VISION_DESCRIBE_TIMEOUT' } } } })
  })

  it('rewrites tool-result images without mutating the original result', async () => {
    const { ctx, adapter, agent } = await setup()
    const messages = [createToolResultMessage({ callId: ToolCallId('read-1'), content: [image], isError: false })]
    const original = JSON.stringify(messages)
    const rewritten = await ctx.visionFallback.rewriteMessages(agent.session, { provider: 'mock', model: 'text' }, messages, new AbortController().signal)
    expect(rewritten.some(message => contentHasImage(message.content))).toBe(false)
    expect(JSON.stringify(rewritten)).toContain('Visible text: example')
    expect(JSON.stringify(messages)).toBe(original)
    expect(adapter.requests.map(request => request.model)).toEqual(['vision'])
  })

  it('does not dispatch the primary model or log a description after a failed vision call', async () => {
    const { adapter, agent } = await setup()
    adapter.failVision = true
    agent.followup(createUserMessage({ content: [image], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(adapter.requests.map(request => request.model)).toEqual(['vision'])
    expect(agent.session.snapshotEvents().filter(event => event.type === 'vision/describe')).toHaveLength(0)
    expect(agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')).toMatchObject({ data: { reason: { kind: 'error', error: { code: 'AUTH' } } } })
  })
})
