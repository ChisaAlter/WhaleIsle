import type { AssistantBlock } from '../contract/snapshot.ts'

const BOT_QUIET_MARKER = 'NO_REPLY'
const QUIET_ENDING = new RegExp(`(?:^|\\s)[\`*_]*${BOT_QUIET_MARKER}[\`*_.!]*\\s*$`)
const TRAILING_BACKTICK_MARKER = new RegExp(`\`+${BOT_QUIET_MARKER}\`+[.!]*\\s*$`)
const HAS_WORD_CHAR = /[\p{L}\p{N}]/u
const MARKER_DRESSING = /^[`*_]*/
const MARKER_TRAILING_DRESSING = /^[`*_.!]*$/

export function isBotOwnerSession(owner: unknown): boolean {
  return typeof owner === 'string' && (owner.startsWith('dsh-bots:') || owner === 'dsh-whale:assistant')
}

function insideOpenCodeFence(prefix: string): boolean {
  let count = 0
  const re = /(^|\n)\s*```/g
  while (re.exec(prefix) !== null) count += 1
  return count % 2 === 1
}

function hasInlineProseBeforeBacktick(prefixBeforeToken: string): boolean {
  const lastNewline = prefixBeforeToken.lastIndexOf('\n')
  const sameLineBefore = prefixBeforeToken.slice(lastNewline + 1)
  return HAS_WORD_CHAR.test(sameLineBefore)
}

function withoutGrowingMarker(words: string): string {
  const trimmed = words.trimEnd()
  const wordStart = Math.max(
    trimmed.lastIndexOf(' '),
    trimmed.lastIndexOf('\n'),
    trimmed.lastIndexOf('\t'),
  ) + 1
  const word = trimmed.slice(wordStart)
  const bare = word.replace(MARKER_DRESSING, '')
  const growing = bare.length > 0 && (
    BOT_QUIET_MARKER.startsWith(bare)
    || (bare.startsWith(BOT_QUIET_MARKER)
      && MARKER_TRAILING_DRESSING.test(bare.slice(BOT_QUIET_MARKER.length)))
  )
  if (!growing) return words
  const prefix = trimmed.slice(0, wordStart)
  if (insideOpenCodeFence(prefix)) return words
  if (word.startsWith('`') && hasInlineProseBeforeBacktick(prefix)) return words
  return prefix.trimEnd()
}

function stripSettledQuietMarker(words: string): string {
  let current = words.trimEnd()
  while (QUIET_ENDING.test(current)) {
    const match = QUIET_ENDING.exec(current)
    if (!match) break
    const matchText = match[0]
    const leadingWsLen = matchText.length - matchText.trimStart().length
    const beforeToken = current.slice(0, match.index + leadingWsLen)
    if (insideOpenCodeFence(beforeToken)) break
    if (TRAILING_BACKTICK_MARKER.test(matchText.trim()) && hasInlineProseBeforeBacktick(beforeToken)) {
      break
    }
    const next = current.slice(0, match.index).trimEnd()
    if (next === current) break
    current = next
  }
  return current
}

/**
 * Strip or hold back trailing `NO_REPLY` quiet markers on the closing text
 * block of a Bot teammate's assistant step without touching inline prose or
 * fenced code examples.
 */
export function stripBotQuietBlocks(
  blocks: readonly AssistantBlock[],
  streaming: boolean,
): readonly AssistantBlock[] {
  let lastTextIndex = -1
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    if (blocks[i]?.kind === 'text') {
      lastTextIndex = i
      break
    }
  }
  if (lastTextIndex === -1) return blocks
  const target = blocks[lastTextIndex]
  if (target === undefined || target.kind !== 'text') return blocks
  const nextText = streaming
    ? withoutGrowingMarker(target.text)
    : stripSettledQuietMarker(target.text)
  if (nextText === target.text) return blocks
  const out: AssistantBlock[] = []
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]
    if (block === undefined) continue
    if (i !== lastTextIndex) {
      out.push(block)
      continue
    }
    if (nextText !== '' || streaming) {
      out.push({ kind: 'text', text: nextText })
    }
  }
  return out
}
