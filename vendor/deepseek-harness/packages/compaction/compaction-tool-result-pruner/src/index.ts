/**
 * Replay-safe, model-free tool-result pruning service.
 *
 * @module @deepseek-ai/dsh-compaction-tool-result-pruner
 */

import { createHash, randomUUID } from 'node:crypto'
import { closeSync, lstatSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { freezeMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionSeq, ToolResultMessage } from '@deepseek-ai/dsh-session'
// Type-only: the `compaction/*` SessionEventMap merges (the shadow-price event).
import type {} from '@deepseek-ai/dsh-compaction'
// Type-only: the `ctx.tokenMeter` Context merge for the declared injection.
import type {} from '@deepseek-ai/dsh-token-meter'
import { codePointLength, DEFAULTS, PRUNE_MARKER, resolveConfig } from './config.ts'
import type {
  PrunedEntry,
  PruneResult,
  PruneSessionOptions,
  ResolvedConfig,
  ToolResultPruneConfig,
} from './types.ts'

export { codePointLength, DEFAULTS, PRUNE_MARKER, resolveConfig } from './config.ts'
export type {
  PrunedEntry,
  PruneResult,
  PruneSessionOptions,
  ResolvedConfig,
  ToolResultPruneConfig,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    toolResultPruner: ToolResultPruner
  }
}

interface SnapshotCandidate {
  readonly seq: SessionSeq
  readonly event: SessionEvent<'tool/result'>
}

/** Deterministic head/middle/tail pruning for current tool-result surface nodes. */
export class ToolResultPruner extends Service {
  // The token meter prices each shadowed node for its logged shadow-price
  // event, so pruning genuinely requires the pricing capability.
  static inject = ['tokenMeter']

  static Config: z<ToolResultPruneConfig> = z.object({
    thresholdChars: z.number().step(1).min(1).default(DEFAULTS.thresholdChars),
    headChars: z.number().step(1).min(0).default(DEFAULTS.headChars),
    tailChars: z.number().step(1).min(0).default(DEFAULTS.tailChars),
    protectRecentToolResults: z.number().step(1).min(0).default(DEFAULTS.protectRecentToolResults),
    archiveDir: z.string(),
  })

  /** Resolved and immutable character budgets. */
  readonly config: ResolvedConfig

  constructor(ctx: Context, config: ToolResultPruneConfig = {}) {
    super(ctx, 'toolResultPruner')
    this.config = resolveConfig(config)
  }

  /**
   * Measure text content in Unicode code points; non-text blocks cost zero.
   * @param blocks - tool-result content to measure.
   * @returns total Unicode code points across text blocks.
   */
  measureContent(blocks: readonly ContentBlock[]): number {
    let chars = 0
    for (const block of blocks) {
      if (block.type === 'text') chars += codePointLength(block.text)
    }
    return chars
  }

  /**
   * Replace an over-budget text middle while retaining rich-block order.
   * Text slicing is by Unicode code point, not UTF-16 code unit, so a retained
   * boundary cannot split a surrogate pair. Grapheme clusters may still split.
   * @param blocks - original tool-result content.
   * @returns pruned content, or `null` when the text is within budget.
   */
  pruneContent(blocks: readonly ContentBlock[]): ContentBlock[] | null {
    return this.pruneContentWithBudgets(blocks, this.config.headChars, this.config.tailChars, PRUNE_MARKER)
  }

  private pruneContentWithBudgets(
    blocks: readonly ContentBlock[],
    headChars: number,
    tailChars: number,
    markerText: string,
  ): ContentBlock[] | null {
    const totalChars = this.measureContent(blocks)
    if (totalChars <= this.config.thresholdChars) return null

    const removedStart = headChars
    const removedEnd = totalChars - tailChars
    const pruned: ContentBlock[] = []
    let consumed = 0
    let markerInserted = false

    for (const block of blocks) {
      if (block.type !== 'text') {
        pruned.push(block)
        continue
      }

      const points = Array.from(block.text)
      const blockStart = consumed
      const blockEnd = blockStart + points.length
      const headEnd = Math.min(points.length, Math.max(0, removedStart - blockStart))
      const tailStart = Math.min(points.length, Math.max(0, removedEnd - blockStart))
      const intersectsRemoved = blockStart < removedEnd && blockEnd > removedStart
      const marker = intersectsRemoved && !markerInserted ? markerText : ''
      if (marker.length > 0) markerInserted = true
      const text = points.slice(0, headEnd).join('')
        + marker
        + points.slice(tailStart).join('')
      if (text.length > 0) pruned.push({ ...block, text })
      consumed = blockEnd
    }

    /* v8 ignore next -- totalChars > threshold and valid budgets guarantee a removed text span. */
    if (!markerInserted) throw new Error('tool-result prune: failed to locate the removed text span')
    const charsAfter = this.measureContent(pruned)
    /* v8 ignore next -- config validation fixes the emitted head + marker + tail budget. */
    if (charsAfter > this.config.thresholdChars || charsAfter >= totalChars) {
      throw new Error('tool-result prune: replacement must be smaller and within threshold')
    }
    return pruned
  }

  private resolveArchiveBaseDir(): string {
    if (this.config.archiveDir !== undefined) return resolve(this.config.archiveDir)
    const getService = this.ctx.get.bind(this.ctx) as (key: string) => unknown
    const spill = getService('spillStore') as { root?: unknown } | undefined
    if (typeof spill?.root === 'string' && spill.root.trim().length > 0) {
      return join(resolve(spill.root), 'pruned-results')
    }
    return join(tmpdir(), 'dsh-pruned-results')
  }

  private archiveOriginalText(sessionId: string, seq: SessionSeq, callId: string, blocks: readonly ContentBlock[]): string | null {
    const textParts: string[] = []
    for (const block of blocks) {
      if (block.type === 'text') textParts.push(block.text)
    }
    const fullText = textParts.join('\n')
    const baseDir = this.resolveArchiveBaseDir()
    const sessionHash = createHash('sha256').update(sessionId).digest('hex').slice(0, 16)
    const sessionDir = join(baseDir, `session-${sessionHash}`)
    const safeCall = callId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 32) || 'call'
    const filePath = join(sessionDir, `seq-${seq}-${safeCall}-${randomUUID().slice(0, 8)}.txt`)

    let fd: number | undefined
    try {
      mkdirSync(baseDir, { recursive: true, mode: 0o700 })
      if (!lstatSync(baseDir).isDirectory()) throw new Error('archive base directory is not a directory')
      mkdirSync(sessionDir, { recursive: true, mode: 0o700 })
      if (!lstatSync(sessionDir).isDirectory()) throw new Error('archive session directory is not a directory')
      fd = openSync(filePath, 'wx', 0o600)
      const data = Buffer.from(fullText, 'utf8')
      let offset = 0
      while (offset < data.length) {
        offset += writeSync(fd, data, offset, data.length - offset)
      }
      return filePath
    } catch (error: unknown) {
      this.ctx.logger.warn(
        'compaction-tool-result-pruner: failed to archive full output for seq %d (%o); keeping original text',
        seq,
        error,
      )
      return null
    } finally {
      if (fd !== undefined) {
        try {
          closeSync(fd)
        } catch {
          // Ignore close errors during cleanup.
        }
      }
    }
  }

  private buildArchivedPrunedContent(originalBlocks: readonly ContentBlock[], archivePath: string): ContentBlock[] | null {
    const note = `[Full tool output archived: ${archivePath} — use read to inspect if needed]\n`
    const markerWithNote = `${PRUNE_MARKER}${note}`
    const overhead = codePointLength(markerWithNote)
    if (overhead <= this.config.thresholdChars) {
      const remaining = this.config.thresholdChars - overhead
      const headChars = Math.min(this.config.headChars, remaining)
      const tailChars = Math.min(this.config.tailChars, remaining - headChars)
      return this.pruneContentWithBudgets(originalBlocks, headChars, tailChars, markerWithNote)
    }
    // When thresholdChars is smaller than marker + archive path (e.g. tight synthetic test budgets),
    // stay strictly <= thresholdChars in the message text while exposing archivePath on PrunedEntry.
    return this.pruneContent(originalBlocks)
  }

  /**
   * Prune over-budget tool results from one stable current-surface snapshot
   * outside the protected hot tail (`protectRecentToolResults`).
   * Full original text is safely archived to disk before replacing; if
   * archival fails, the original tool result is kept unmodified.
   * @param session - session whose current surface is rewritten.
   * @param options - optional per-call overrides (e.g. emergency overflow recovery).
   * @returns landed replacements and aggregate Unicode-code-point savings.
   * @throws when the session rejects a replacement; replacements committed
   * earlier in the pass remain durable.
   */
  pruneSession(session: Session, options?: PruneSessionOptions): PruneResult {
    const protectRecent = options?.protectRecentToolResults ?? this.config.protectRecentToolResults
    if (!Number.isInteger(protectRecent) || protectRecent < 0) {
      throw new Error(`ToolResultPruner: protectRecentToolResults (${protectRecent}) must be a non-negative integer`)
    }

    const candidates: SnapshotCandidate[] = []
    for (const seq of [...session.surface.nodes]) {
      // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
      const event = session.eventAt(seq)
      /* v8 ignore next -- surface seqs are validated contiguous log references. */
      if (event?.type === 'tool/result') candidates.push({ seq, event })
    }

    const eligibleCount = Math.max(0, candidates.length - protectRecent)
    const eligible = candidates.slice(0, eligibleCount)

    const pruned: PrunedEntry[] = []
    let charsRemoved = 0
    for (const { seq, event } of eligible) {
      const original = session.deriveEventMessage(event) as ToolResultMessage
      const charsBefore = this.measureContent(original.content)
      if (charsBefore <= this.config.thresholdChars) continue

      const callId = event.data.message.source.callId
      const archivePath = this.archiveOriginalText(session.id, seq, String(callId), original.content)
      if (archivePath === null) continue

      const content = this.buildArchivedPrunedContent(original.content, archivePath)
      if (content === null) continue
      const charsAfter = this.measureContent(content)
      const message = freezeMessage<ToolResultMessage>({
        ...original,
        content,
      })
      // Shadow-price protocol: the metering event and its replacement are
      // appended synchronously adjacent, so pure consumers subtract the
      // shadowed node's heuristic price without retaining per-node state.
      session.append('compaction/prune', {
        shadowedRange: { start: seq, end: seq },
        shadowedSeqs: [seq],
        shadowedTokenCount: this.ctx.tokenMeter.estimateMessage(original),
      })
      const replacement = session.append('tool/result', {
        ...event.data,
        message,
      }, {
        surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq },
        sourceEventSeqs: [seq],
      })
      pruned.push({
        originalSeq: seq,
        replacementSeq: replacement.seq,
        callId,
        charsBefore,
        charsAfter,
        archivePath,
      })
      charsRemoved += charsBefore - charsAfter
    }
    return { pruned, charsRemoved }
  }
}

export default ToolResultPruner
