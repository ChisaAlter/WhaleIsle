/** Derive a published page exclusively from its durable tool result. */
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'

export interface VisualReplyModel {
  readonly file: FileAttachmentRef
  readonly title: string
  readonly height: number
}

/** Authoritative result fields consumed by the independent reply projection. */
type PublishedResult = Pick<ToolResultNode,
  'kind' | 'isError' | 'content' | 'meta' | 'call'>

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Nested PTC calls have no presentation metadata; their call arguments survive replay. */
export function visualReplyModel(block: PublishedResult): VisualReplyModel | null {
  if (block.isError) return null
  if (block.content.some(part => part.type !== 'text' && part.type !== 'file')) return null
  const files = block.content.filter(part => part.type === 'file')
  if (files.length !== 1) return null
  const file = files[0]!.attachment
  if (!file || typeof file.attachmentId !== 'string' || file.attachmentId === ''
    || typeof file.name !== 'string' || !file.name.endsWith('.html')
    || !Number.isInteger(file.bytes) || file.bytes <= 0) return null
  const meta = record(block.meta) && record(block.meta.visualReply) ? block.meta.visualReply : null
  let args: Record<string, unknown> | null = null
  if (meta === null && block.call !== null) {
    try {
      const value: unknown = JSON.parse(block.call.argsRaw)
      if (record(value)) args = value
    } catch { /* A malformed call remains a generic tool result. */ }
  }
  if (meta !== null && meta.version !== 1) return null
  const presentation = meta ?? args
  if (presentation === null || typeof presentation.title !== 'string' || presentation.title.trim() === '') return null
  const height = presentation.height ?? 480
  if (typeof height !== 'number' || !Number.isFinite(height) || height < 80 || height > 2000) return null
  return { file, title: presentation.title, height }
}
