/** Pure helpers for line numbering, syntax highlight budgeting, indentation, and in-file find. */
import {
  HIGHLIGHT_MAX_CHARS,
  HIGHLIGHT_MAX_LINES,
  HIGHLIGHT_MAX_LINE_CHARS,
  type HighlightSpan,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { CSSProperties } from 'react'

/** Standard two-space indentation unit inserted and stripped by Tab / Shift+Tab. */
export const CODE_EDITOR_INDENT = '  '

/** Tier 1 synchronous highlight line budget for instant first paint. */
export const HIGHLIGHT_TIER1_MAX_LINES = 200

/** Tier 1 synchronous highlight character budget (16 KiB). */
export const HIGHLIGHT_TIER1_MAX_CHARS = 16 * 1024

/** Highlight execution tier selected for the current document. */
export type HighlightTier = 'immediate' | 'deferred' | 'plain'

/** Result of a Tab / Shift+Tab / Enter auto-indentation transform. */
export interface CodeIndentEdit {
  readonly value: string
  readonly selectionStart: number
  readonly selectionEnd: number
  readonly changed: boolean
}

/** Half-open UTF-16 range `[start, end)` of one find match in the document. */
export interface TextMatchRange {
  readonly start: number
  readonly end: number
}

/** One line-relative slice produced by intersecting syntax spans with find matches. */
export interface LineHighlightSegment {
  readonly text: string
  readonly style: CSSProperties | undefined
  readonly matchIndex: number | null
  readonly active: boolean
}

/**
 * Count logical lines in `text` (`1` minimum, `\n`, `\r\n`, and lone `\r` start new lines).
 * @param text - editor text.
 * @returns total line count `>= 1`.
 */
export function countLines(text: string): number {
  let lines = 1
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code === 10) {
      lines += 1
    } else if (code === 13) {
      lines += 1
      if (text.charCodeAt(index + 1) === 10) index += 1
    }
  }
  return lines
}

/**
 * Resolve the 1-based line number containing UTF-16 `offset` in `text`.
 * @param text - editor text.
 * @param offset - UTF-16 caret or selection offset.
 * @returns 1-based line number.
 */
export function lineNumberAtOffset(text: string, offset: number): number {
  const limit = Math.max(0, Math.min(offset, text.length))
  let line = 1
  for (let index = 0; index < limit; index += 1) {
    const code = text.charCodeAt(index)
    if (code === 10) {
      line += 1
    } else if (code === 13) {
      if (index + 1 < limit || text.charCodeAt(index + 1) !== 10) {
        line += 1
      }
      if (text.charCodeAt(index + 1) === 10) index += 1
    }
  }
  return line
}

/**
 * Check whether `text` fits within the shared Shiki highlight budgets
 * (`HIGHLIGHT_MAX_LINES`, `HIGHLIGHT_MAX_CHARS`, `HIGHLIGHT_MAX_LINE_CHARS`).
 * @param text - source text to evaluate.
 * @returns true when syntax highlighting may run without exceeding budgets.
 */
export function isHighlightWithinBudget(text: string): boolean {
  if (text.length > HIGHLIGHT_MAX_CHARS) return false
  let lines = 1
  let lineStart = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 10) continue
    const lineLength = index - lineStart - (index > 0 && text.charCodeAt(index - 1) === 13 ? 1 : 0)
    if (lineLength > HIGHLIGHT_MAX_LINE_CHARS) return false
    lines += 1
    if (lines > HIGHLIGHT_MAX_LINES) return false
    lineStart = index + 1
  }
  const lastLength = text.length - lineStart - (text.length > lineStart && text.charCodeAt(text.length - 1) === 13 ? 1 : 0)
  return lastLength <= HIGHLIGHT_MAX_LINE_CHARS
}

/**
 * Choose the syntax highlighting tier for `text` and `language`.
 * Unknown languages or texts exceeding budgets degrade immediately to `'plain'`.
 * @param text - source text.
 * @param language - grammar hint resolved from `languageForPath`, or `undefined`.
 * @returns `'immediate'`, `'deferred'`, or `'plain'`.
 */
export function selectHighlightTier(text: string, language: string | undefined): HighlightTier {
  if (language === undefined || !isHighlightWithinBudget(text)) return 'plain'
  if (text.length <= HIGHLIGHT_TIER1_MAX_CHARS && countLines(text) <= HIGHLIGHT_TIER1_MAX_LINES) {
    return 'immediate'
  }
  return 'deferred'
}

interface LineBounds {
  readonly start: number
  readonly end: number
}

function collectLineBounds(text: string): LineBounds[] {
  const bounds: LineBounds[] = []
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 10) continue
    bounds.push({ start, end: index })
    start = index + 1
  }
  bounds.push({ start, end: text.length })
  return bounds
}

function lineIndexForOffset(bounds: readonly LineBounds[], offset: number): number {
  let low = 0
  let high = bounds.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    const line = bounds[mid]
    if (line === undefined) break
    if (offset < line.start) high = mid - 1
    else if (offset > line.end) low = mid + 1
    else return mid
  }
  return Math.max(0, bounds.length - 1)
}

function leadingStripCount(text: string, lineStart: number, lineEnd: number): number {
  if (lineStart >= lineEnd) return 0
  const first = text.charCodeAt(lineStart)
  if (first === 9) return 1
  if (first !== 32) return 0
  return lineStart + 1 < lineEnd && text.charCodeAt(lineStart + 1) === 32 ? 2 : 1
}

/**
 * Apply `Tab` or `Shift+Tab` indentation over the caret or selected lines,
 * preserving the selection span across single-line and multi-line edits.
 * @param text - current editor value.
 * @param selectionStart - selection start offset.
 * @param selectionEnd - selection end offset.
 * @param shiftKey - true for outdent (`Shift+Tab`), false for indent (`Tab`).
 * @returns updated text, restored selection offsets, and whether text changed.
 */
export function applyTabIndent(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  shiftKey: boolean,
): CodeIndentEdit {
  const from = Math.max(0, Math.min(selectionStart, selectionEnd, text.length))
  const to = Math.max(0, Math.min(Math.max(selectionStart, selectionEnd), text.length))

  if (from === to && !shiftKey) {
    return {
      value: `${text.slice(0, from)}${CODE_EDITOR_INDENT}${text.slice(to)}`,
      selectionStart: from + CODE_EDITOR_INDENT.length,
      selectionEnd: from + CODE_EDITOR_INDENT.length,
      changed: true,
    }
  }

  const bounds = collectLineBounds(text)
  const startLine = lineIndexForOffset(bounds, from)
  const endOffset = to > from ? to - 1 : to
  const endLine = Math.max(startLine, lineIndexForOffset(bounds, endOffset))
  const firstBounds = bounds[startLine]
  const lastBounds = bounds[endLine]
  if (firstBounds === undefined || lastBounds === undefined) {
    return { value: text, selectionStart: from, selectionEnd: to, changed: false }
  }

  const chunks: string[] = [text.slice(0, firstBounds.start)]
  let totalDelta = 0
  let firstDelta = 0
  let lastDelta = 0
  let deltaBeforeLastLine = 0

  for (let lineIdx = startLine; lineIdx <= endLine; lineIdx += 1) {
    const line = bounds[lineIdx]
    if (line === undefined) continue
    if (lineIdx > startLine) chunks.push('\n')
    const lineText = text.slice(line.start, line.end)
    if (shiftKey) {
      const removed = leadingStripCount(text, line.start, line.end)
      chunks.push(lineText.slice(removed))
      if (lineIdx === startLine) firstDelta = -removed
      if (lineIdx < endLine) deltaBeforeLastLine -= removed
      if (lineIdx === endLine) lastDelta = -removed
      totalDelta -= removed
    } else {
      chunks.push(`${CODE_EDITOR_INDENT}${lineText}`)
      if (lineIdx === startLine) firstDelta = CODE_EDITOR_INDENT.length
      if (lineIdx < endLine) deltaBeforeLastLine += CODE_EDITOR_INDENT.length
      if (lineIdx === endLine) lastDelta = CODE_EDITOR_INDENT.length
      totalDelta += CODE_EDITOR_INDENT.length
    }
  }
  chunks.push(text.slice(lastBounds.end))

  if (totalDelta === 0) {
    return { value: text, selectionStart: from, selectionEnd: to, changed: false }
  }

  const nextStart = from === firstBounds.start && from < to
    ? firstBounds.start
    : firstBounds.start + Math.max(0, from - firstBounds.start + firstDelta)

  let nextEnd: number
  if (from === to) {
    nextEnd = nextStart
  } else if (shiftKey) {
    const newLastLineStart = lastBounds.start + deltaBeforeLastLine
    nextEnd = newLastLineStart + Math.max(0, to - lastBounds.start + lastDelta)
  } else {
    nextEnd = to + totalDelta
  }

  return {
    value: chunks.join(''),
    selectionStart: nextStart,
    selectionEnd: Math.max(nextStart, nextEnd),
    changed: true,
  }
}

/**
 * Inherit leading indentation spaces/tabs on `Enter` when the current line
 * carries leading whitespace before the caret. Returns `null` when there is
 * no leading whitespace so native `<textarea>` newline handling can proceed.
 * @param text - current editor value.
 * @param selectionStart - selection start offset.
 * @param selectionEnd - selection end offset.
 * @returns updated text and caret offsets, or `null` if no indentation applies.
 */
export function applyEnterIndent(
  text: string,
  selectionStart: number,
  selectionEnd: number,
): CodeIndentEdit | null {
  const from = Math.max(0, Math.min(selectionStart, selectionEnd, text.length))
  const to = Math.max(0, Math.min(Math.max(selectionStart, selectionEnd), text.length))
  const lineStart = text.lastIndexOf('\n', from - 1) + 1
  const match = /^[ \t]+/.exec(text.slice(lineStart, from))
  if (match === null) return null
  const indent = match[0]
  const caret = from + 1 + indent.length
  return {
    value: `${text.slice(0, from)}\n${indent}${text.slice(to)}`,
    selectionStart: caret,
    selectionEnd: caret,
    changed: true,
  }
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Find all non-overlapping literal occurrences of `query` in `text`.
 * @param text - document text to search.
 * @param query - search term; empty string yields an empty list.
 * @param caseSensitive - whether matching is case-sensitive (defaults to false).
 * @returns ordered array of `{ start, end }` UTF-16 ranges.
 */
export function findAllMatches(
  text: string,
  query: string,
  caseSensitive = false,
): TextMatchRange[] {
  if (query === '' || text === '') return []
  const matches: TextMatchRange[] = []

  if (caseSensitive) {
    let offset = 0
    while (offset <= text.length - query.length) {
      const index = text.indexOf(query, offset)
      if (index === -1) break
      matches.push({ start: index, end: index + query.length })
      offset = index + query.length
    }
    return matches
  }

  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  if (lowerText.length === text.length && lowerQuery.length === query.length) {
    let offset = 0
    while (offset <= lowerText.length - lowerQuery.length) {
      const index = lowerText.indexOf(lowerQuery, offset)
      if (index === -1) break
      matches.push({ start: index, end: index + lowerQuery.length })
      offset = index + lowerQuery.length
    }
    return matches
  }

  const pattern = new RegExp(escapeRegExp(query), 'giu')
  let found = pattern.exec(text)
  while (found !== null) {
    if (found[0].length === 0) break
    matches.push({ start: found.index, end: found.index + found[0].length })
    found = pattern.exec(text)
  }
  return matches
}

/**
 * Intersect one line's syntax highlight spans (or plain line text) with
 * find matches overlapping that line so `<mark>` elements preserve token colors.
 * @param lineText - raw text of the single line (excluding trailing `\n`).
 * @param lineStartOffset - UTF-16 start offset of this line within the full document.
 * @param spans - optional Shiki token spans for this line.
 * @param matches - ordered global find matches across the document.
 * @param startMatchCursor - index in `matches` where scanning should begin.
 * @param activeMatchIndex - index of the currently selected match, or `-1`.
 * @returns line highlight segments plus the updated cursor for the next line.
 */
export function splitLineSpansWithMatches(
  lineText: string,
  lineStartOffset: number,
  spans: readonly HighlightSpan[] | undefined,
  matches: readonly TextMatchRange[],
  startMatchCursor: number,
  activeMatchIndex: number,
): { readonly segments: LineHighlightSegment[]; readonly nextMatchCursor: number } {
  const lineEndOffset = lineStartOffset + lineText.length
  const effectiveSpans: readonly { readonly text: string; readonly style?: CSSProperties | undefined }[] =
    spans !== undefined && (spans.length > 0 || lineText.length === 0)
      ? spans
      : [{ text: lineText, style: undefined }]

  let cursor = startMatchCursor
  while (cursor < matches.length) {
    const candidate = matches[cursor]
    if (candidate === undefined || candidate.end > lineStartOffset) break
    cursor += 1
  }

  const firstOverlap = matches[cursor]
  if (lineText.length === 0) {
    return { segments: [], nextMatchCursor: cursor }
  }
  if (firstOverlap === undefined || firstOverlap.start >= lineEndOffset) {
    const segments: LineHighlightSegment[] = effectiveSpans.map(span => ({
      text: span.text,
      style: span.style,
      matchIndex: null,
      active: false,
    }))
    return { segments, nextMatchCursor: cursor }
  }

  const segments: LineHighlightSegment[] = []
  let spanOffset = 0
  let matchCursor = cursor

  for (const span of effectiveSpans) {
    const spanStart = spanOffset
    const spanEnd = spanStart + span.text.length
    spanOffset = spanEnd
    if (span.text.length === 0) continue

    let pos = spanStart
    while (pos < spanEnd && matchCursor < matches.length) {
      const match = matches[matchCursor]
      if (match === undefined) break
      const relStart = Math.max(0, match.start - lineStartOffset)
      const relEnd = Math.min(lineText.length, match.end - lineStartOffset)
      if (relEnd <= pos) {
        matchCursor += 1
        continue
      }
      if (relStart >= spanEnd) break

      if (relStart > pos) {
        segments.push({
          text: span.text.slice(pos - spanStart, relStart - spanStart),
          style: span.style,
          matchIndex: null,
          active: false,
        })
        pos = relStart
      }

      const sliceEnd = Math.min(spanEnd, relEnd)
      if (sliceEnd > pos) {
        segments.push({
          text: span.text.slice(pos - spanStart, sliceEnd - spanStart),
          style: span.style,
          matchIndex: matchCursor,
          active: matchCursor === activeMatchIndex,
        })
        pos = sliceEnd
      }

      if (relEnd <= spanEnd) {
        matchCursor += 1
      } else {
        break
      }
    }

    if (pos < spanEnd) {
      segments.push({
        text: span.text.slice(pos - spanStart),
        style: span.style,
        matchIndex: null,
        active: false,
      })
    }
  }

  while (cursor < matches.length) {
    const candidate = matches[cursor]
    if (candidate === undefined || candidate.end > lineEndOffset + 1) break
    cursor += 1
  }

  return { segments, nextMatchCursor: cursor }
}
