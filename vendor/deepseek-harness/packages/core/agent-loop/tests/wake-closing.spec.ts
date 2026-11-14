/** A wake that arrives while the initiator scope is closing must not strand its driver reservation. */

import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { MockAdapter, textResponse } from './mock-adapter.ts'

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

describe('wake while the initiator scope closes', () => {
  it('leaves the agent idle and its activity settled instead of holding teardown open', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(NativeToolExecutor)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('never requested')]))
    const agent = await ctx.agentLoop.create(SessionId('closing-wake'), { provider: 'mock', model: 'mock' })
    const statuses: string[] = []
    ctx.on('agent/status', ({ agent: subject, status }) => { if (subject === agent) statuses.push(status) })

    // Teardown closes the scope before it disposes the agents; a member or
    // timer may still wake the Lead in between.
    ;(ctx.agents as unknown as { closeInitiators(): void }).closeInitiators()
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'late wake' }], source: { kind: 'user' } }))

    expect(agent.status).toBe('idle')
    await expect(Promise.race([
      agent.whenIdle().then(() => 'settled'),
      new Promise((resolve) => { setTimeout(() => { resolve('stuck') }, 2000) }),
    ])).resolves.toBe('settled')
    expect(statuses).toEqual(['running', 'idle'])
  })
})
