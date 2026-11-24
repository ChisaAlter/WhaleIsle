/**
 * Script-aware heuristic token pricing shared by the meter service and the
 * pure context-breakdown projection, so both surfaces price identical content
 * to identical numbers.
 *
 * @module @deepseek-ai/dsh-token-meter/estimate
 */

import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import type { EpochHeader } from '@deepseek-ai/dsh-session'

/** Common integer denominator avoiding floating-point drift across mixed scripts. */
const WEIGHT_DENOMINATOR = 20

/** 0.25 tokens per ASCII character (4 chars/token). */
const ASCII_WEIGHT = 5

/** 1.2 tokens per CJK / fullwidth character or CJK punctuation code point. */
const CJK_WEIGHT = 24

/** 1.0 token per non-ASCII BMP character outside CJK ranges. */
const OTHER_NON_ASCII_WEIGHT = 20

/** 1.5 tokens per astral non-CJK code point (e.g. multi-byte emoji). */
const ASTRAL_NON_CJK_WEIGHT = 30

/** Per-block structural overhead for JSON framing and type tags. */
const BLOCK_OVERHEAD = 4

/** Role-field framing overhead added to every priced message. */
export const ROLE_OVERHEAD = 4

function isCjkCodePoint(codePoint: number): boolean {
  return (codePoint >= 0x2e80 && codePoint <= 0x2fdf)
    || (codePoint >= 0x3000 && codePoint <= 0x4dbf)
    || (codePoint >= 0x4e00 && codePoint <= 0x9fff)
    || (codePoint >= 0xac00 && codePoint <= 0xd7af)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe4f)
    || (codePoint >= 0xff00 && codePoint <= 0xffef)
    || (codePoint >= 0x20000 && codePoint <= 0x2fa1f)
}

function accumulateTextWeight(text: string): number {
  let weight = 0
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code <= 0x7f) {
      weight += ASCII_WEIGHT
      continue
    }
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1)
      if (low >= 0xdc00 && low <= 0xdfff) {
        const codePoint = ((code - 0xd800) << 10) + (low - 0xdc00) + 0x10000
        i += 1
        weight += isCjkCodePoint(codePoint) ? CJK_WEIGHT : ASTRAL_NON_CJK_WEIGHT
        continue
      }
    }
    weight += isCjkCodePoint(code) ? CJK_WEIGHT : OTHER_NON_ASCII_WEIGHT
  }
  return weight
}

/**
 * Script-weighted text token estimate: ASCII at 0.25 tokens/char, CJK at 1.2
 * tokens/char, other non-ASCII BMP at 1.0 token/char, and astral non-CJK at 1.5.
 * @param text - plain text to price without mutation.
 * @returns rounded-up heuristic token count (0 for empty strings).
 */
export function estimateTextTokens(text: string): number {
  if (text.length === 0) return 0
  return Math.floor((accumulateTextWeight(text) + WEIGHT_DENOMINATOR - 1) / WEIGHT_DENOMINATOR)
}

/**
 * Structural JSON price of one block outside the typed pricing arms: the
 * fixed heuristic for merge-extended blocks and for image references, whose
 * request price is route-owned rather than fixed. Image offload marks do not
 * change this reference-only heuristic; route pricing owns their placeholders.
 * @param block - block to price without mutation.
 * @returns heuristic tokens for the block's JSON structure.
 */
export function estimateStructuralBlock(block: ContentBlock): number {
  if (block.type === 'image') {
    const { offloaded: _offloaded, ...reference } = block
    return BLOCK_OVERHEAD + estimateTextTokens(JSON.stringify(reference))
  }
  return BLOCK_OVERHEAD + estimateTextTokens(JSON.stringify(block))
}

/**
 * Price content blocks recursively under the script-aware density heuristic.
 * @param blocks - content blocks to price without mutation.
 * @returns heuristic tokens including per-block structural overhead.
 */
export function estimateContent(blocks: readonly ContentBlock[]): number {
  let tokens = 0
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        tokens += estimateTextTokens(block.text) + BLOCK_OVERHEAD
        break
      case 'tool-call':
        tokens += estimateTextTokens(block.name)
          + estimateTextTokens(block.arguments)
          + BLOCK_OVERHEAD
        break
      default:
        // ContentBlockMap is merge-extensible; unknown blocks (and image
        // references, whose request price is route-owned) retain a
        // conservative structural JSON price under the heuristic.
        tokens += estimateStructuralBlock(block)
    }
  }
  return tokens
}

/**
 * Price the rendered system prompt: the `system/message` surface node's text.
 * Adapters serialize the prompt as a plain string — a system-role message or
 * the request's system field — not as a typed content block, so the price is
 * text density plus blank-line separators and role framing with no per-block overhead.
 * @param message - system-role message to price without mutation.
 * @returns heuristic system-prompt tokens; 0 for empty content ("no system prompt").
 */
export function estimateSystemMessage(message: Message): number {
  let weight = 0
  for (const block of message.content) {
    const text = block.type === 'text' ? block.text.trim() : JSON.stringify(block)
    if (text.length === 0) continue
    if (weight > 0) weight += 2 * ASCII_WEIGHT
    weight += accumulateTextWeight(text)
  }
  return weight === 0 ? 0 : Math.floor((weight + WEIGHT_DENOMINATOR - 1) / WEIGHT_DENOMINATOR) + ROLE_OVERHEAD
}

/**
 * Heuristically price one model-visible message.
 * @param message - message to price without mutation.
 * @returns content and role-framing tokens under the script-aware heuristic; a
 *   system-role message prices as {@link estimateSystemMessage}.
 */
export function estimateMessage(message: Message): number {
  if (message.role === 'system') return estimateSystemMessage(message)
  return estimateContent(message.content) + ROLE_OVERHEAD
}

/**
 * Price the tool-schema part of a canonical request envelope — the envelope's
 * only priced field, since the system prompt is a surface node.
 * @param header - canonical envelope, or undefined before any request.
 * @returns heuristic tool-schema tokens; 0 when absent or empty.
 */
export function estimateToolsTokens(header: EpochHeader | undefined): number {
  if (header?.tools === undefined || header.tools.length === 0) return 0
  return estimateTextTokens(JSON.stringify(header.tools)) + BLOCK_OVERHEAD
}
