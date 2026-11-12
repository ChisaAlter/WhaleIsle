/**
 * Vision fallback: a user-designated vision-capable model describes image
 * attachments so a text-only main model can act on them.
 *
 * The Models settings page stores the designated route in the
 * live `llm-vision-fallback` configuration entry. When the agent loop assembles a
 * request for a model whose declared `inputModalities` excludes `'image'`,
 * it asks this service to rewrite the messages: each image block is replaced
 * by a text block carrying a description generated once by the designated
 * vision model. Every generated description is appended to the session log
 * as a `vision/describe` event before the main request dispatches, so the
 * rewritten request stays a pure function of the log and later steps (and
 * replays) reuse the logged description instead of calling the vision model
 * again.
 *
 * @module @deepseek-ai/dsh-llm-vision-fallback
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'
import { BlockAssembler, contentHasImage, createUserMessage, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, ImageBlock, Message } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import { deadline, MAX_TIMER_DELAY_MS, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { finishError } from './finish-error.ts'

declare module '@deepseek-ai/dsh-llm/types' {
  interface LlmRequestPurposeMap {
    'vision-describe': true
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Designated vision-model routing and image-to-text rewriting. */
    visionFallback: VisionFallback
  }
}

/** Exact provenance and text of one vision-model image description. */
export interface VisionDescribeEventData {
  /** Attachment id of the described image, as carried by its {@link ImageBlock}. */
  attachmentId: string
  /** Exact vision-model route that produced the description. */
  route: { provider: string; model: string }
  /** Original attachment display name, when the block carried one. */
  name?: string
  /** Complete description text substituted for the image block. */
  description: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Log-only record of one vision-model image description, appended before
     * the main request that first substitutes it. Request rewriting derives
     * substituted text exclusively from these events, keeping the dispatched
     * request reconstructable from the log.
     */
    'vision/describe': VisionDescribeEventData
  }
}

/** Legacy settings.yaml section key retained for import compatibility. */
export const VISION_FALLBACK_SETTINGS_NAMESPACE = 'vision-fallback'

/** Shape of the legacy section; both fields absent meant disabled. */
export interface VisionFallbackSettings {
  /** Registered provider route. */
  provider?: string
  /** Provider-owned model id. */
  model?: string
}

/** Schema of the legacy vision-fallback section. */
export const VISION_FALLBACK_SETTINGS_SCHEMA: z<VisionFallbackSettings> = z.object({
  provider: z.string(),
  model: z.string(),
})

/** Composition entry: auxiliary-call limits plus live, user-selected route. */
export interface Config {
  /** Vision-call output-token cap. */
  maxOutputTokens: number
  /** End-to-end vision-call deadline in milliseconds. */
  timeoutMs: number
  /** Optional model route selected in the Models settings page. */
  provider: Volatile<string | undefined>
  model: Volatile<string | undefined>
}

/** Capability-owned timeout reason code for auxiliary vision requests. */
export const VISION_DESCRIBE_TIMEOUT_CODE = 'VISION_DESCRIBE_TIMEOUT'

/** Fixed system instruction for the auxiliary describe call. */
const DESCRIBE_SYSTEM = [
  '你是图像识别助手。用户消息包含一张图片，请客观、详尽地描述它的全部内容，供一个无法查看图片的 AI 助手使用。要求：',
  '1. 完整转写图片中出现的所有文字（代码、报错、日志、界面文案等按原样转写，保留换行与缩进）。',
  '2. 描述界面布局、图表结构、颜色和其他显著视觉元素。',
  '3. 只陈述图片中可见的信息，不要推测或评价。',
  '使用与图片中文字相同的语言作答；图片没有文字时使用中文。',
].join('\n')

/** Fixed user instruction accompanying the image in the describe call. */
const DESCRIBE_INSTRUCTION = '请按要求描述这张图片。'

/** Model-facing framing of one substituted description. Images may come from user attachments or tool reads, so the framing never claims a source. */
function substitutionText(name: string | undefined, description: string): string {
  const label = name === undefined || name === '' ? '图片' : `图片「${name}」`
  return `【${label}——此处有一张你无法直接查看的图片；以下是识图模型生成的描述】\n${description}\n【图片描述结束】`
}

/**
 * Owns the designated vision-model route and the image-to-text request
 * rewrite. Mounted dormant: with no stored route the service reports itself
 * unconfigured and rewriting passes messages through untouched.
 */
export class VisionFallback extends Service {
  static Config = z.object({
    maxOutputTokens: z.number().step(1).min(1).required(),
    timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).required(),
    provider: z.string().volatile(),
    model: z.string().volatile(),
  })

  static inject = ['llm']

  constructor(ctx: Context, private config: Config) {
    super(ctx, 'visionFallback')
  }

  /**
   * The stored vision-model route.
   * @returns the designated route, or undefined while unset (disabled).
   */
  selection(): { provider: string; model: string } | undefined {
    const provider = this.config.provider.get()
    const model = this.config.model.get()
    if (provider === undefined || provider === '' || model === undefined || model === '') return undefined
    return { provider, model }
  }

  /**
   * Whether a vision-model route is currently designated. Admission gates
   * consult this to admit image prompts for text-only main models.
   * @returns whether rewriting can substitute image blocks.
   */
  configured(): boolean {
    return this.selection() !== undefined
  }

  /**
   * Rewrite one request's messages for a target model: when the target
   * declares it does not accept images and a vision route is designated,
   * every image block is replaced by its logged (or newly generated and
   * logged) description text. Any other case returns the input untouched.
   * @param session - owning session; descriptions are read from and appended to its log.
   * @param route - exact main-request route about to be dispatched.
   * @param messages - derived request messages (never mutated).
   * @param signal - main-request cancellation.
   * @returns the original array, or a new array with image blocks substituted.
   */
  async rewriteMessages(
    session: Session,
    route: { provider: string; model: string },
    messages: Message[],
    signal: AbortSignal,
  ): Promise<Message[]> {
    return this.transformMessages(session, route, messages, signal, true)
  }

  /**
   * Rebuild a dispatched request using logged descriptions only; never calls a model.
   * @param session - log whose descriptions are replayed.
   * @param route - primary request route.
   * @param messages - original derived history.
   * @param signal - cancellation of the model-info read.
   * @returns the reconstructed request messages.
   */
  async replayMessages(
    session: Session,
    route: { provider: string; model: string },
    messages: Message[],
    signal: AbortSignal,
  ): Promise<Message[]> {
    return this.transformMessages(session, route, messages, signal, false)
  }

  private async transformMessages(
    session: Session,
    route: { provider: string; model: string },
    messages: Message[],
    signal: AbortSignal,
    generate: boolean,
  ): Promise<Message[]> {
    if (!messages.some(message => contentHasImage(message.content))) return messages
    const target = this.selection()
    if (target === undefined) return messages
    const info = await this.ctx.llm.resolveModelInfo(route.provider, route.model, signal)
    if (info.inputModalities === undefined || info.inputModalities.includes('image')) return messages

    const described = new Map<string, string>()
    for (const event of session.snapshotEvents()) {
      if (event.type === 'vision/describe') described.set(event.data.attachmentId, event.data.description)
    }

    const out: Message[] = []
    for (const message of messages) {
      if (!contentHasImage(message.content)) {
        out.push(message)
        continue
      }
      out.push({ ...message, content: await this.substituteBlocks(session, target, message.content, described, signal, generate) })
    }
    return out
  }

  /**
   * Replace every image block in one content array with its description text,
   * recursing into tool-result blocks so tool-read images (e.g. `read_image`)
   * are substituted the same way as user attachments.
   */
  private async substituteBlocks(
    session: Session,
    target: { provider: string; model: string },
    content: readonly ContentBlock[],
    described: Map<string, string>,
    signal: AbortSignal,
    generate: boolean,
  ): Promise<ContentBlock[]> {
    const blocks: ContentBlock[] = []
    for (const block of content) {
      if (block.type !== 'image') {
        blocks.push(block)
        continue
      }
      signal.throwIfAborted()
      const attachmentId = String(block.attachment.attachmentId)
      let description = described.get(attachmentId)
      if (description === undefined) {
        if (!generate) throw new LlmError(`vision-fallback: missing logged description for ${attachmentId}`, 'INVALID_REQUEST')
        description = await this.describe(session, target, block, signal)
        described.set(attachmentId, description)
      }
      blocks.push({ type: 'text', text: substitutionText(this.attachmentName(block), description) })
    }
    return blocks
  }

  /** Display name of the attachment, when its ref carries one. */
  private attachmentName(block: ImageBlock): string | undefined {
    const name = (block.attachment as { name?: unknown }).name
    return typeof name === 'string' && name !== '' ? name : undefined
  }

  /** Generate one description through the designated route and log it. */
  private async describe(
    session: Session,
    target: { provider: string; model: string },
    block: ImageBlock,
    signal: AbortSignal,
  ): Promise<string> {
    using callDeadline = deadline(signal, this.config.timeoutMs, VISION_DESCRIBE_TIMEOUT_CODE)
    const messages: Message[] = [createUserMessage({
      content: [block, { type: 'text', text: DESCRIBE_INSTRUCTION }],
      source: { kind: 'user' },
    })]
    const options: GenerateOptions = deepFreeze({
      provider: target.provider,
      model: target.model,
      messages,
      system: DESCRIBE_SYSTEM,
      maxTokens: this.config.maxOutputTokens,
      sessionId: session.id,
      purpose: 'vision-describe',
      signal: callDeadline.signal,
    })
    const assembler = new BlockAssembler()
    try {
      for await (const chunk of this.ctx.llm.stream(options)) {
        callDeadline.signal.throwIfAborted()
        assembler.push(chunk)
      }
      callDeadline.signal.throwIfAborted()
    } catch (error: unknown) {
      signal.throwIfAborted()
      const timeout = timeoutOf(callDeadline.signal, VISION_DESCRIBE_TIMEOUT_CODE)
      if (timeout !== undefined) throw new LlmError(timeout.message, timeout.code)
      throw error
    }
    const terminalError = finishError(assembler.finish)
    if (terminalError !== undefined) throw terminalError
    const text = assembler.blocks()
      .filter((candidate): candidate is Extract<ContentBlock, { type: 'text' }> => candidate.type === 'text')
      .map(candidate => candidate.text)
      .join('\n')
      .trim()
    if (text.length === 0) {
      throw new LlmError('vision-fallback: the vision model produced no description text', 'INVALID_REQUEST')
    }
    const name = this.attachmentName(block)
    session.append('vision/describe', {
      attachmentId: String(block.attachment.attachmentId),
      route: { ...target },
      ...name === undefined ? {} : { name },
      description: text,
    })
    return text
  }
}

export default VisionFallback
