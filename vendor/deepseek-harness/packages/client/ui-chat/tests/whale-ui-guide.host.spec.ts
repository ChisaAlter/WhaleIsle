import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Chat from '../src/index.ts'
import { OPENUI_GUIDE } from '../src/openui-guide.ts'
import { WHALE_UI_COMPACT_GUIDE, filterOpenUiGuide } from '../src/whale-ui-guide.ts'

const HOST = fileURLToPath(new URL('../../../../../../src/renderer/whale-ui/host.cjs', import.meta.url))
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  vi.unstubAllEnvs()
})

async function executeGuideTool(args: Record<string, unknown>) {
  vi.stubEnv('DSHD_WHALE_UI_ENABLED', '1')
  vi.stubEnv('DSHD_WHALE_UI_HOST', HOST)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(Chat)
  const response = await ctx.tools.execute({
    calls: [{
      type: 'tool-call',
      id: ToolCallId('whale-ui-guide-call'),
      name: 'whale_ui_guide',
      arguments: JSON.stringify(args),
    }],
    signal: new AbortController().signal,
  })
  return { ctx, result: response.results[0]!.result }
}

describe('Whale UI compact prompt and on-demand guide tool', () => {
  it('keeps the injected system prompt under 1500 chars while referencing render_ui, openui fences, categories, and whale_ui_guide', async () => {
    expect(WHALE_UI_COMPACT_GUIDE.length).toBeLessThanOrEqual(1500)
    expect(WHALE_UI_COMPACT_GUIDE.length).toBeLessThanOrEqual(1800)
    expect(OPENUI_GUIDE.length).toBeGreaterThan(40000)
    expect(WHALE_UI_COMPACT_GUIDE).toContain('openui')
    expect(WHALE_UI_COMPACT_GUIDE).toContain('render_ui')
    expect(WHALE_UI_COMPACT_GUIDE).toContain('whale_ui_guide')
    for (const category of ['Layout', 'Text', 'Inputs', 'Media and data', 'Play', 'Drawing', 'Other']) {
      expect(WHALE_UI_COMPACT_GUIDE).toContain(category)
    }

    const { ctx } = await executeGuideTool({})
    const assembly = await ctx.systemPrompt.assemble()
    const section = assembly.sections.find(item => item.name === 'whale-ui')
    expect(section).toBeDefined()
    expect(section!.text).toBe(WHALE_UI_COMPACT_GUIDE)
    expect(section!.text.length).toBeLessThanOrEqual(1800)
  })

  it('returns verbatim OPENUI_GUIDE when called without filters', async () => {
    const { result } = await executeGuideTool({})
    expect(result.isError).toBe(false)
    expect(result.content).toEqual([{ type: 'text', text: OPENUI_GUIDE }])
    expect(result.value).toMatchObject({
      guide: OPENUI_GUIDE,
      totalLength: OPENUI_GUIDE.length,
      filtered: false,
    })
  })

  it('supports section and query filtering without duplicating subsections', async () => {
    const layout = await executeGuideTool({ section: 'Layout' })
    expect(layout.result.isError).toBe(false)
    const layoutValue = layout.result.value as { guide: string; filtered: boolean; matchedSections: string[] }
    expect(layoutValue.filtered).toBe(true)
    expect(layoutValue.matchedSections).toEqual(['Layout'])
    expect(layoutValue.guide).toContain('### Layout')
    expect(layoutValue.guide).toContain('Grid(')
    expect(layoutValue.guide.length).toBeLessThan(OPENUI_GUIDE.length / 5)

    const queryOnly = await executeGuideTool({ query: 'EChart' })
    expect(queryOnly.result.isError).toBe(false)
    const queryValue = queryOnly.result.value as { guide: string; filtered: boolean; matchedSections: string[] }
    expect(queryValue.filtered).toBe(true)
    expect(queryValue.guide).toContain('EChart(')
    expect(queryValue.guide.length).toBeLessThan(OPENUI_GUIDE.length / 4)

    const missing = filterOpenUiGuide({ section: 'NonexistentSection' })
    expect(missing.filtered).toBe(true)
    expect(missing.matchedSections).toEqual([])
    expect(missing.guide).toContain('Available sections:')
  })

  it('rejects malformed non-object or unknown arguments rather than returning the full 43 KB guide', async () => {
    vi.stubEnv('DSHD_WHALE_UI_ENABLED', '1')
    vi.stubEnv('DSHD_WHALE_UI_HOST', HOST)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(NativeToolExecutor)
    await ctx.plugin(Chat)

    const tool = ctx.tools.get('whale_ui_guide')!
    const exec = {
      callId: ToolCallId('bad-args'),
      rootCallId: ToolCallId('bad-args'),
      name: 'whale_ui_guide',
      arguments: {},
      token: Symbol('bad-args') as never,
      signal: new AbortController().signal,
      deferContext() {},
      concludeTurn() {},
    }
    await expect(tool.execute('{"section":', exec)).rejects.toThrow(/expects a JSON object/)
    await expect(tool.execute({ bogus: 'Layout' }, exec)).rejects.toThrow(/unknown argument "bogus"/)
    await expect(tool.execute({ section: 123 }, exec)).rejects.toThrow(/must be a string/)
  })
})
