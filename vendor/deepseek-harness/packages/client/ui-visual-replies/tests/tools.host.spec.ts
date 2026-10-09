import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createVolatile, updateVolatile } from '../../../../vendor/cosmokit/src/volatile.ts'
import * as VisualReplies from '../src/index.ts'
import type { Config } from '../src/config.ts'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

async function setup(enabled?: boolean, imageCapable = true) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-visual-replies-'))
  const ctx = new Context()
  cleanup.push(async () => { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  await ctx.plugin(LocalFileSystem, { cwd: directory })
  await ctx.plugin(LocalAttachmentStore, { dshHome: join(directory, 'home') })
  ctx.provide('llm', {
    resolveModelInfo: () => Promise.resolve({ provider: 'fixture', id: 'model', name: 'Fixture', inputModalities: imageCapable ? ['text', 'image'] : ['text'] }),
  } as never)
  const fiber = await ctx.plugin(VisualReplies, enabled === undefined ? {} : { enabled })
  const config = fiber.config as Config
  const agent = { options: {}, session: { header: { cwd: directory }, requestHeader: () => ({ config: { provider: 'fixture', model: 'model' } }) } }
  let count = 0
  const call = (name: string, args: unknown) => ctx.tools.execute({
    name, arguments: args, callId: ToolCallId(`visual-${++count}`), agent: agent as never, signal: new AbortController().signal,
  })
  const setEnabled = (value: boolean) => {
    updateVolatile(config.enabled, createVolatile(value))
    ctx.emit('settings/document-updated', 'visual-replies' as never, value ? 1 : 2)
  }
  return { ctx, config, directory, call, setEnabled }
}

function stubCapture() {
  vi.stubEnv('DSH_DESKTOP_INSTALL_URL', 'http://127.0.0.1:1')
  vi.stubEnv('DSH_DESKTOP_INSTALL_TOKEN', 'fixture-token')
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    png: PNG.toString('base64'), width: 728, contentHeight: 120, capturedHeight: 120,
    consoleMessages: [{ level: 'warning', text: 'fixture console feedback' }],
  }), { headers: { 'content-type': 'application/json' } }))
}

describe('Visual reply tool lifecycle and durable output', () => {
  it('defaults off, refuses real execution, and updates the advertised catalog live', async () => {
    const fixture = await setup()
    expect(fixture.config.enabled.get()).toBe(false)
    expect(fixture.ctx.tools.schemas().map(tool => tool.name)).not.toContain('html_render')
    const save = vi.spyOn(fixture.ctx.attachments, 'saveFile')
    const result = await fixture.call('html_render', { html: '<button>Hi</button>', title: 'Hi' })
    expect(result.isError).toBe(true)
    expect(save).not.toHaveBeenCalled()
    fixture.setEnabled(true)
    expect(fixture.ctx.tools.schemas().map(tool => tool.name)).toEqual(expect.arrayContaining(['html_preview', 'html_render']))
    fixture.setEnabled(false)
    expect(fixture.ctx.tools.schemas().map(tool => tool.name)).not.toContain('html_preview')
  })

  it('publishes an interactive page as one file block with replayable presentation metadata', async () => {
    const fixture = await setup(true)
    const result = await fixture.call('html_render', {
      html: '<button id="counter" onclick="this.textContent=String(Number(this.textContent)+1)">0</button>', title: 'Counter', height: 140,
    })
    expect(result.isError).toBe(false)
    const file = result.content.find(block => block.type === 'file')
    if (file?.type !== 'file') throw new Error('missing published file block')
    expect(result.meta).toEqual({ visualReply: { version: 1, title: 'Counter', height: 140 } })
    expect(JSON.stringify(result.meta)).not.toContain(file.attachment.attachmentId)
    const chunks: Uint8Array[] = []
    for await (const chunk of fixture.ctx.attachments.readFileStream(file.attachment)) chunks.push(chunk)
    const html = Buffer.concat(chunks).toString('utf8')
    expect(html).toContain('onclick="this.textContent=String(Number(this.textContent)+1)"')
    expect(html).toContain("connect-src 'none'")
    expect(html).toContain('whale-visual-reply-size')
    expect(html).toContain('--bg:Canvas')
    expect(html).toContain('--surface:Canvas')
    expect(html).toContain('--accent:LinkText')
    expect(html).toContain('--background:Canvas')
  })

  it('embeds actual local image bytes and retains them after the source image is gone', async () => {
    const fixture = await setup(true)
    const imagePath = join(fixture.directory, 'red.png')
    await writeFile(imagePath, PNG)
    const result = await fixture.call('html_render', { html: `<img src="${imagePath}">`, title: 'Image' })
    expect(result.isError).toBe(false)
    const file = result.content.find(block => block.type === 'file')
    if (file?.type !== 'file') throw new Error('missing published file block')
    await rm(imagePath)
    const chunks: Uint8Array[] = []
    for await (const chunk of fixture.ctx.attachments.readFileStream(file.attachment)) chunks.push(chunk)
    const html = Buffer.concat(chunks).toString('utf8')
    expect(html).toContain(`data:image/png;base64,${PNG.toString('base64')}`)
    expect(html).not.toContain(imagePath)
  })

  it('returns a durable screenshot and console feedback, tolerates preview missing images, and refuses publication', async () => {
    const fixture = await setup(true)
    const capture = stubCapture()
    const missing = join(fixture.directory, 'missing.png')
    const args = { html: `<img src="${missing}"><button onclick="this.textContent='clicked'">Try</button>`, title: 'Missing image' }
    const preview = await fixture.call('html_preview', { html: args.html })
    expect(preview.isError).toBe(false)
    expect(capture).toHaveBeenCalledOnce()
    expect(preview.content.find(block => block.type === 'image')).toBeDefined()
    const image = preview.content.find(block => block.type === 'image')
    if (image?.type !== 'image') throw new Error('missing screenshot image block')
    expect((await fixture.ctx.attachments.readImage(image.attachment)).data.byteLength).toBeGreaterThan(0)
    expect(preview.content.filter(block => block.type === 'text').map(block => block.text).join('')).toContain('fixture console feedback')
    expect(preview.content.filter(block => block.type === 'text').map(block => block.text).join('')).toContain('missing.png')
    const save = vi.spyOn(fixture.ctx.attachments, 'saveFile')
    const publication = await fixture.call('html_render', args)
    expect(publication.isError).toBe(true)
    expect(save).not.toHaveBeenCalled()
  })

  it.each(['html_render', 'html_preview'])('does not commit a successful %s result after the setting changes during persistence', async name => {
    const fixture = await setup(true)
    if (name === 'html_preview') stubCapture()
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    if (name === 'html_render') {
      const save = fixture.ctx.attachments.saveFile.bind(fixture.ctx.attachments)
      vi.spyOn(fixture.ctx.attachments, 'saveFile').mockImplementationOnce(async input => {
        started.resolve(); await release.promise; return save(input)
      })
    } else {
      const save = fixture.ctx.attachments.saveImage.bind(fixture.ctx.attachments)
      vi.spyOn(fixture.ctx.attachments, 'saveImage').mockImplementationOnce(async input => {
        started.resolve(); await release.promise; return save(input)
      })
    }
    const pending = fixture.call(name, { html: '<button>Keep interactive</button>', ...name === 'html_render' ? { title: 'Pending' } : {} })
    await started.promise
    fixture.setEnabled(false)
    release.resolve()
    const result = await pending
    expect(result.isError).toBe(true)
    expect(result.content.some(block => block.type === 'image' || block.type === 'file')).toBe(false)
  })

  it('rejects a text-only preview before reading local images or requesting a capture', async () => {
    const fixture = await setup(true, false)
    const capture = stubCapture()
    const read = vi.spyOn(fixture.ctx.fs, 'readBytes')
    const result = await fixture.call('html_preview', { html: `<img src="${join(fixture.directory, 'red.png')}">` })
    expect(result.isError).toBe(true)
    expect(read).not.toHaveBeenCalled()
    expect(capture).not.toHaveBeenCalled()
  })

  it('reports a real byte-read capacity failure as an oversized image when stat omits size', async () => {
    const fixture = await setup(true)
    const capture = stubCapture()
    const imagePath = join(fixture.directory, 'oversized.png')
    const bytes = Buffer.alloc(10 * 1024 * 1024 + 1)
    PNG.copy(bytes)
    await writeFile(imagePath, bytes)
    const stat = fixture.ctx.fs.stat.bind(fixture.ctx.fs)
    vi.spyOn(fixture.ctx.fs, 'stat').mockImplementation(async (...args) => {
      const observed = await stat(...args)
      if (!observed) return observed
      const withoutSize = { ...observed }
      delete withoutSize.size
      return withoutSize
    })
    const result = await fixture.call('html_preview', { html: `<img src="${imagePath}">` })
    expect(result.isError).toBe(true)
    expect(result.content.filter(block => block.type === 'text').map(block => block.text).join('')).toContain('oversized.png exceeds 10 MiB')
    expect(capture).not.toHaveBeenCalled()
    expect(result.content.some(block => block.type === 'image')).toBe(false)
  })

  it('runs the existing tool guard before any embedded-image filesystem read', async () => {
    const fixture = await setup(true)
    const read = vi.spyOn(fixture.ctx.fs, 'readBytes')
    fixture.ctx.tools.guard(exec => exec.name === 'html_render' ? 'fixture policy denies publication' : undefined)
    const result = await fixture.call('html_render', { html: `<img src="${join(fixture.directory, 'red.png')}">`, title: 'Blocked' })
    expect(result.isError).toBe(true)
    expect(read).not.toHaveBeenCalled()
    expect(result.content.filter(block => block.type === 'text').map(block => block.text).join('')).toContain('fixture policy denies publication')
  })
})
