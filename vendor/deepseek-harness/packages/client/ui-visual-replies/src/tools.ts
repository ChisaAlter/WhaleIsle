/** Model-facing preview and publish tools; settled content owns attachment refs. */
import type { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { Config } from './config.ts'
import { prepareHtml } from './html.ts'
import type { HtmlPreviewCapture, HtmlPreviewRequest } from './types.ts'

export const VISUAL_REPLY_PAGE_GUIDE = 'Use a complete self-contained HTML page with inline JavaScript and CSS. '
  + 'All external network access is disabled: do not use CDNs, remote URLs, fetch, or external fonts. '
  + 'Use data: images or absolute local PNG/JPEG/GIF/WebP/SVG/AVIF/BMP/ICO paths; readable local images are embedded before capture or publication. '
  + 'WhaleIsle supplies live CSS variables on :root: --bg/--background (conversation background), --surface (panel background), '
  + '--text, --text-secondary, --border, and --accent. Use these variables for page colors; do not redefine them or hard-code a light/dark page background. '
  + 'The page sits inside an existing reply card. Keep html/body and the outer wrapper transparent, use fluid width and modest spacing, and avoid a second outer card or app navigation. '
  + 'Let content determine height; avoid 100vh, viewport-based heights, or height:100% on html/body. Make grids, SVGs, labels, and controls fit a narrow reply column without horizontal clipping. '
  + 'Use labeled keyboard-accessible controls and readable chart labels; a useful interaction must update its visible result. '
  + 'Maximum input is 512 KiB UTF-8, one local image 10 MiB, and the prepared page 25 MiB. '
  + 'Visual replies must be enabled in Settings before creating a new preview or publication.'

const IMAGE_SCHEMA = {
  type: 'object', additionalProperties: false, required: true,
  properties: {
    attachmentId: { type: 'string', required: true },
    mediaType: { type: 'string', required: true, enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] },
    bytes: { type: 'integer', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    name: { type: 'string' },
    originalDimensions: {
      type: 'object', additionalProperties: false,
      properties: { width: { type: 'integer', required: true }, height: { type: 'integer', required: true } },
    },
  },
} as const

function requireEnabled(config: Config): void {
  if (!config.enabled.get()) throw new Error('Visual replies are disabled. Enable Visual replies in Settings to create a preview or publish a page.')
}

async function requireVision(ctx: Context, exec: ToolRunContext): Promise<void> {
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new Error('HTML preview requires a resolved image-capable model route.')
  }
  const info = await llm.resolveModelInfo(provider, model, exec.signal)
  const fallback = ctx.get('visionFallback') as { configured(): boolean } | undefined
  if (!info.inputModalities?.includes('image') && fallback?.configured() !== true) {
    throw new Error(`HTML preview requires image input. Model "${model}" does not declare it; choose an image-capable model or configure the vision fallback.`)
  }
}

async function captureHtml(request: HtmlPreviewRequest, signal: AbortSignal): Promise<HtmlPreviewCapture> {
  const url = process.env.DSH_DESKTOP_INSTALL_URL
  const token = process.env.DSH_DESKTOP_INSTALL_TOKEN
  if (!url || !token) throw new Error('HTML preview is only available while the WhaleIsle desktop rendering service is running.')
  const response = await fetch(new URL('/desktop/html-preview', url), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  })
  const result = await response.json() as HtmlPreviewCapture & { error?: string }
  if (!response.ok) throw new Error(result.error ?? `HTML preview failed: HTTP ${response.status}`)
  if (!result.png || !Number.isInteger(result.width) || !Number.isInteger(result.capturedHeight)
    || !Number.isInteger(result.contentHeight) || !Array.isArray(result.consoleMessages)) {
    throw new Error('The desktop rendering service returned an invalid capture.')
  }
  return result
}

export function registerVisualReplyTools(ctx: Context, config: Config): () => void {
  const disposePreview = ctx.tools.register(defineTool({
    name: 'html_preview',
    description: 'Render an HTML Visual reply in an isolated hidden browser and return its PNG screenshot, dimensions, console feedback, and missing local images. Inspect the screenshot and fix problems before html_render; console.log can report your page checks. Console line numbers are browser-reported script locations and may not correspond to lines in the original HTML file. capturedHeight is capped at 4000 pixels: if it is smaller than contentHeight, the screenshot does not cover the bottom of the page. Keep the page compact and do not treat a partial screenshot as whole-page verification. Check a narrow width (about 390 pixels), and check both themes when their layout or contrast differs. The current model must support image input or have a vision fallback. ' + VISUAL_REPLY_PAGE_GUIDE,
    timeoutMs: 30_000,
    parameters: {
      html: { type: 'string', required: true, description: 'Self-contained HTML source.' },
      width: { type: 'integer', description: 'Viewport width from 240 to 1600 pixels; defaults to the 728-pixel reply column. Use about 390 to inspect a narrow layout.' },
      appearance: { type: 'string', enum: ['light', 'dark'], description: 'Preview appearance; defaults to dark.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          image: IMAGE_SCHEMA,
          width: { type: 'integer', required: true },
          contentHeight: { type: 'integer', required: true },
          capturedHeight: { type: 'integer', required: true },
          consoleMessages: {
            type: 'array', required: true,
            items: { type: 'object', additionalProperties: false, properties: {
              level: { type: 'string', required: true, enum: ['log', 'info', 'warning', 'error'] },
              text: { type: 'string', required: true },
            } },
          },
          missingImages: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value): ContentBlock[] => [
        { type: 'text', text: JSON.stringify({ width: value.width, contentHeight: value.contentHeight,
          capturedHeight: value.capturedHeight, consoleMessages: value.consoleMessages, missingImages: value.missingImages }) },
        { type: 'image', attachment: { ...value.image, attachmentId: AttachmentId(value.image.attachmentId) } },
      ],
    },
    async execute(args, exec) {
      requireEnabled(config)
      if (exec.agent === undefined) throw new Error('HTML preview requires a calling session.')
      await requireVision(ctx, exec)
      const width = args.width ?? 728
      if (!Number.isInteger(width) || width < 240 || width > 1600) throw new Error('width must be an integer from 240 to 1600')
      const prepared = await prepareHtml(ctx, exec, args.html, true)
      requireEnabled(config)
      const captured = await captureHtml({ html: prepared.html, width, appearance: args.appearance ?? 'dark' }, exec.signal)
      requireEnabled(config)
      exec.signal.throwIfAborted()
      const image = await ctx.attachments.saveImage({ data: Buffer.from(captured.png, 'base64'), mediaType: 'image/png', name: 'visual-reply-preview.png' })
      requireEnabled(config)
      exec.signal.throwIfAborted()
      return {
        image: { ...image }, width: captured.width, contentHeight: captured.contentHeight,
        capturedHeight: captured.capturedHeight, consoleMessages: captured.consoleMessages, missingImages: prepared.missingImages,
      }
    },
    presentCall: () => ({ card: 'generic', title: 'Preview Visual reply', kind: 'other' }),
  }))

  const disposeRender = ctx.tools.register(defineTool({
    name: 'html_render',
    description: 'Publish a self-contained interactive HTML Visual reply inline in this conversation. Call html_preview first and inspect its screenshot and console feedback. Publish before the written reply; add only what the page does not already explain. Unreadable local images prevent publication; correct or remove missing images before publishing. The saved page remains visible after Visual replies are disabled. The inline frame follows content height up to 2000 pixels and scrolls longer content. ' + VISUAL_REPLY_PAGE_GUIDE,
    parameters: {
      html: { type: 'string', required: true, description: 'Self-contained HTML source.' },
      title: { type: 'string', required: true, description: 'Short page title, at most 200 characters.' },
      height: { type: 'integer', description: 'Initial inline height from 80 to 2000 pixels; defaults to 480.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          file: { type: 'object', additionalProperties: false, required: true, properties: {
            attachmentId: { type: 'string', required: true }, name: { type: 'string', required: true }, bytes: { type: 'integer', required: true },
          } },
          title: { type: 'string', required: true }, height: { type: 'integer', required: true },
        },
      },
      render: (_args, value): ContentBlock[] => [
        { type: 'text', text: `Visual reply published: ${value.title}` },
        { type: 'file', attachment: { ...value.file, attachmentId: AttachmentId(value.file.attachmentId) } },
      ],
      presentationMeta: (_args, value) => ({ visualReply: { version: 1, title: value.title, height: value.height } }),
    },
    async execute(args, exec) {
      requireEnabled(config)
      if (exec.agent === undefined) throw new Error('HTML publication requires a calling session.')
      const title = args.title.trim()
      const height = args.height ?? 480
      if (!title || title.length > 200) throw new Error('title must contain 1 to 200 characters')
      if (!Number.isInteger(height) || height < 80 || height > 2000) throw new Error('height must be an integer from 80 to 2000')
      const prepared = await prepareHtml(ctx, exec, args.html, false)
      requireEnabled(config)
      exec.signal.throwIfAborted()
      const file = await ctx.attachments.saveFile({ data: Buffer.from(prepared.html, 'utf8'), name: 'visual-reply.html' })
      requireEnabled(config)
      exec.signal.throwIfAborted()
      return { file: { ...file }, title, height }
    },
    presentCall: args => ({ card: 'generic', title: args.title || 'Publish Visual reply', kind: 'other' }),
  }))
  return () => { disposePreview(); disposeRender() }
}
