/**
 * Image offload executor for the compaction seam.
 *
 * - Passive recovery: when an image-capable route fails a request with
 *   `IMAGE_OFFLOAD_REQUIRED`, records one `image/offload` decision selecting the
 *   oldest retained input occurrences and retries.
 * - Proactive hysteresis eviction: on `agent/pre-step`, when retained input
 *   images breach a high watermark (count or byte budget), offloads the oldest
 *   retained occurrences on the surface back down to the low watermark in a
 *   single `image/offload` batch.
 *
 * @module @deepseek-ai/dsh-compaction-image-offload
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-compaction'
import type { PreStepDecision, RequestErrorAction } from '@deepseek-ai/dsh-agent'
import { IMAGE_OFFLOAD_REQUIRED_CODE, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session, SessionSeq } from '@deepseek-ai/dsh-session'
import { offloadOldestImages } from './image-offload.ts'
import { imageOffloadProjection } from './projection.ts'

export const name = 'compaction-image-offload'
export const inject = ['agents', 'sessions']

/** Default retained image count that triggers proactive eviction. */
export const DEFAULT_HIGH_WATERMARK_IMAGES = 20
/** Default target retained image count after proactive eviction. */
export const DEFAULT_LOW_WATERMARK_IMAGES = 10
/** Default total retained image byte budget (25 MiB) that triggers proactive eviction. */
export const DEFAULT_HIGH_WATERMARK_BYTES = 25 * 1024 * 1024
/** Default target total retained image byte budget (12 MiB) after proactive eviction. */
export const DEFAULT_LOW_WATERMARK_BYTES = 12 * 1024 * 1024

/** Optional hysteresis thresholds for proactive pre-step image eviction. */
export interface Config {
  /** Retained image count that triggers proactive eviction (default `20`). */
  highWatermarkImages?: number
  /** Target retained image count to evict down to (default `10`). */
  lowWatermarkImages?: number
  /** Total retained image byte budget that triggers proactive eviction (default `25 MiB`). */
  highWatermarkBytes?: number
  /** Target total retained image byte budget to evict down to (default `12 MiB`). */
  lowWatermarkBytes?: number
}

/** Validated and resolved hysteresis thresholds. */
export interface ResolvedConfig {
  readonly highWatermarkImages: number
  readonly lowWatermarkImages: number
  readonly highWatermarkBytes: number
  readonly lowWatermarkBytes: number
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name}: ${label} must be a positive safe integer`)
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name}: ${label} must be a non-negative safe integer`)
  }
}

/**
 * Resolve and validate optional hysteresis eviction thresholds while remaining
 * 100% compatible with `{}` or omitted configuration.
 */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  const highWatermarkImages = config.highWatermarkImages ?? DEFAULT_HIGH_WATERMARK_IMAGES
  assertPositiveInteger(highWatermarkImages, 'highWatermarkImages')
  const lowWatermarkImages = config.lowWatermarkImages ?? Math.min(DEFAULT_LOW_WATERMARK_IMAGES, highWatermarkImages)
  assertNonNegativeInteger(lowWatermarkImages, 'lowWatermarkImages')
  if (lowWatermarkImages > highWatermarkImages) {
    throw new RangeError(`${name}: lowWatermarkImages (${lowWatermarkImages}) must not exceed highWatermarkImages (${highWatermarkImages})`)
  }

  const highWatermarkBytes = config.highWatermarkBytes ?? DEFAULT_HIGH_WATERMARK_BYTES
  assertPositiveInteger(highWatermarkBytes, 'highWatermarkBytes')
  const lowWatermarkBytes = config.lowWatermarkBytes ?? Math.min(DEFAULT_LOW_WATERMARK_BYTES, highWatermarkBytes)
  assertNonNegativeInteger(lowWatermarkBytes, 'lowWatermarkBytes')
  if (lowWatermarkBytes > highWatermarkBytes) {
    throw new RangeError(`${name}: lowWatermarkBytes (${lowWatermarkBytes}) must not exceed highWatermarkBytes (${highWatermarkBytes})`)
  }

  return {
    highWatermarkImages,
    lowWatermarkImages,
    highWatermarkBytes,
    lowWatermarkBytes,
  }
}

function collectRetainedImageBytes(blocks: readonly ContentBlock[]): number[] {
  const bytes: number[] = []
  for (const block of blocks) {
    if (block.type === 'image' && block.offloaded !== true) {
      bytes.push(block.attachment.bytes)
    }
  }
  return bytes
}

function collectSurfaceRetainedImageBytes(session: Session, sourceEventSeqs: readonly SessionSeq[]): number[] {
  const retained: number[] = []
  for (const seq of sourceEventSeqs) {
    // Current surface nodes index durable session events; deriveEventMessage applies prior image/offload projections.
    // oxlint-disable-next-line typescript/no-non-null-assertion, typescript/no-deprecated
    const event = session.eventAt(seq)!
    if (event.type !== 'user/message' && event.type !== 'tool/result') continue
    // oxlint-disable-next-line typescript/no-non-null-assertion -- both input node types produce a message
    const message = session.deriveEventMessage(event)!
    retained.push(...collectRetainedImageBytes(message.content))
  }
  return retained
}

function countProactiveEvictions(
  surfaceImageBytes: readonly number[],
  incomingImageBytes: readonly number[],
  thresholds: ResolvedConfig,
): number {
  const totalImages = surfaceImageBytes.length + incomingImageBytes.length
  let totalBytes = 0
  for (const bytes of surfaceImageBytes) totalBytes += bytes
  for (const bytes of incomingImageBytes) totalBytes += bytes

  const breachedCount = totalImages > thresholds.highWatermarkImages
  const breachedBytes = totalBytes > thresholds.highWatermarkBytes
  if (!breachedCount && !breachedBytes) return 0

  let remainingImages = totalImages
  let remainingBytes = totalBytes
  let evictCount = 0
  while (evictCount < surfaceImageBytes.length) {
    const needsCount = breachedCount && remainingImages > thresholds.lowWatermarkImages
    const needsBytes = breachedBytes && remainingBytes > thresholds.lowWatermarkBytes
    if (!needsCount && !needsBytes) break
    // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded by loop condition
    const oldestBytes = surfaceImageBytes[evictCount]!
    remainingImages -= 1
    remainingBytes -= oldestBytes
    evictCount += 1
  }
  return evictCount
}

/**
 * Mount agent and summary recovery listeners plus optional proactive hysteresis
 * eviction on `agent/pre-step`.
 * @param ctx - the plugin context.
 * @param config - optional watermark thresholds (empty `{}` uses safe defaults).
 */
export function apply(ctx: Context, config: Config = {}): void {
  const thresholds = resolveConfig(config)
  ctx.sessions.registerMessageProjection(imageOffloadProjection)
  ctx.on('agent/pre-step', async ({ agent, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind !== 'enter' || signal.aborted) return decision
    const surfaceImageBytes = collectSurfaceRetainedImageBytes(agent.session, agent.session.surface.nodes)
    if (surfaceImageBytes.length === 0) return decision
    const incomingImageBytes: number[] = []
    for (const message of decision.messages) {
      incomingImageBytes.push(...collectRetainedImageBytes(message.content))
    }
    const evictCount = countProactiveEvictions(surfaceImageBytes, incomingImageBytes, thresholds)
    if (evictCount > 0) {
      offloadOldestImages(agent.session, agent.session.surface.nodes, evictCount)
    }
    return decision
  })
  ctx.on('agent/request-error', ({ agent, failure, signal }, next): Promise<RequestErrorAction> => {
    if (failure.code !== IMAGE_OFFLOAD_REQUIRED_CODE || failure.offloadImages === undefined || signal.aborted) return next()
    // A durable surface repair, not a provider retry: it spends no retry budget and logs no retry event.
    if (!offloadOldestImages(agent.session, agent.session.surface.nodes, failure.offloadImages)) return next()
    return Promise.resolve<RequestErrorAction>({ kind: 'retry' })
  })
  ctx.on('compaction/summary-error', ({ session, sourceEventSeqs, error, signal }, next) => {
    if (!(error instanceof LlmError)
      || error.code !== IMAGE_OFFLOAD_REQUIRED_CODE
      || error.failure.offloadImages === undefined) return next()
    signal?.throwIfAborted()
    if (!offloadOldestImages(session, sourceEventSeqs, error.failure.offloadImages)) return next()
    return true
  })
}
