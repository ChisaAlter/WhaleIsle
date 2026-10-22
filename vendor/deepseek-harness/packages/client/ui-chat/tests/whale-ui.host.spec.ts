import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Chat from '../src/index.ts'
import { OPENUI_GUIDE } from '../src/openui-guide.ts'

const HOST = fileURLToPath(new URL('../../../../../../src/renderer/whale-ui/host.cjs', import.meta.url))
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  vi.unstubAllEnvs()
})

async function setup(enabled: boolean) {
  vi.stubEnv('DSHD_WHALE_UI_ENABLED', enabled ? '1' : undefined)
  vi.stubEnv('DSHD_WHALE_UI_HOST', HOST)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  const fiber = await ctx.plugin(Chat)
  let callId = 0
  const execute = (args: unknown) => ctx.tools.execute({ name: 'render_ui', arguments: args,
    callId: ToolCallId(`whale-ui-host-${++callId}`), signal: new AbortController().signal })
  return { ctx, fiber, execute }
}

describe('Whale UI host opt-in and result projection', () => {
  it('registers the real built validator and guide, projects replayable metadata, and removes both on reload', async () => {
    const h = await setup(true)
    const assembly = await h.ctx.systemPrompt.assemble()
    expect(h.ctx.tools.schemas().map(tool => tool.name)).toEqual(['render_ui'])
    expect(assembly.tools.map(tool => tool.name)).toEqual(['render_ui'])
    expect(assembly.sections.filter(section => section.name === 'whale-ui')).toEqual([
      expect.objectContaining({ text: OPENUI_GUIDE }),
    ])
    const program = 'root = Col([Text("Working interface")])'
    const result = await h.execute({ program })
    const value = { version: 1, language: 'whale-ui', program }
    expect(result).toEqual({ isError: false, value, meta: { whaleUi: value },
      content: [{ type: 'text', text: 'The interactive interface is ready in this conversation. Finish now with at most one short sentence; the page already contains the results. Do not render it again or repeat its figures and instructions in prose.' }] })
    const spec = { title: 'Restored panel', panel: true, items: [{ type: 'text', text: 'A saved result' }] }
    expect(await h.execute({ spec })).toMatchObject({ isError: false,
      value: { version: 1, language: 'dsh-ui', program: JSON.stringify(spec) },
      meta: { whaleUi: { version: 1, language: 'dsh-ui', program: JSON.stringify(spec) } },
    })

    await h.fiber.dispose()
    expect(h.ctx.tools.schemas()).toEqual([])
    expect((await h.ctx.systemPrompt.assemble()).sections.some(section => section.name === 'whale-ui')).toBe(false)
    expect((await h.execute({ program })).isError).toBe(true)

    const reloaded = await h.ctx.plugin(Chat)
    expect(h.ctx.tools.schemas().filter(tool => tool.name === 'render_ui')).toHaveLength(1)
    const replay = await h.ctx.systemPrompt.assemble()
    expect(replay.tools.filter(tool => tool.name === 'render_ui')).toHaveLength(1)
    expect(replay.sections.filter(section => section.name === 'whale-ui')).toHaveLength(1)
    expect((await h.execute({ program })).isError).toBe(false)
    await reloaded.dispose()
    expect(h.ctx.tools.schemas()).toEqual([])
    expect((await h.ctx.systemPrompt.assemble()).sections.some(section => section.name === 'whale-ui')).toBe(false)
  })

  it('rejects invalid complete programs before publishing successful metadata', async () => {
    const h = await setup(true)
    const failed = await h.execute({ program: 'root = Col([Text("valid prefix"), MissingComponent("tail")])' })
    expect(failed.isError).toBe(true)
    expect(failed.meta).toBeUndefined()
    expect(failed.content.map(block => block.type === 'text' ? block.text : '').join('\n')).toMatch(/incomplete|invalid|MissingComponent/)
    const ambiguous = await h.execute({ program: 'root = Col([])', spec: { items: [] } })
    expect(ambiguous.isError).toBe(true)
    expect(ambiguous.meta).toBeUndefined()
  })

  it('keeps ordinary headless composition free of the renderer tool and prompt section', async () => {
    const h = await setup(false)
    const prompt = await h.ctx.systemPrompt.assemble()
    expect(h.ctx.tools.schemas()).toEqual([])
    expect(prompt.tools).toEqual([])
    expect(prompt.sections.some(section => section.name === 'whale-ui')).toBe(false)
    const failed = await h.execute({ program: 'root = Col([])' })
    expect(failed.isError).toBe(true)
    expect(failed.meta).toBeUndefined()
  })
})
