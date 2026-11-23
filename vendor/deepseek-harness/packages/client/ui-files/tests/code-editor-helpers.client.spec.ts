import { describe, expect, it } from 'vitest'
import {
  HIGHLIGHT_MAX_CHARS,
  HIGHLIGHT_MAX_LINES,
  HIGHLIGHT_MAX_LINE_CHARS,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  CODE_EDITOR_INDENT,
  HIGHLIGHT_TIER1_MAX_CHARS,
  HIGHLIGHT_TIER1_MAX_LINES,
  applyEnterIndent,
  applyTabIndent,
  countLines,
  findAllMatches,
  isHighlightWithinBudget,
  lineNumberAtOffset,
  selectHighlightTier,
  splitLineSpansWithMatches,
} from '../src/client/codeEditorHelpers.ts'

describe('codeEditorHelpers line metrics', () => {
  it('counts logical lines across LF, CRLF, and lone CR breaks', () => {
    expect(countLines('')).toBe(1)
    expect(countLines('single')).toBe(1)
    expect(countLines('a\nb\nc')).toBe(3)
    expect(countLines('a\r\nb\r\n')).toBe(3)
    expect(countLines('a\rb\rc')).toBe(3)
  })

  it('resolves 1-based line numbers for clamped UTF-16 offsets', () => {
    const text = 'one\ntwo\r\nthree'
    expect(lineNumberAtOffset(text, -5)).toBe(1)
    expect(lineNumberAtOffset(text, 0)).toBe(1)
    expect(lineNumberAtOffset(text, 3)).toBe(1)
    expect(lineNumberAtOffset(text, 4)).toBe(2)
    expect(lineNumberAtOffset(text, 7)).toBe(2)
    expect(lineNumberAtOffset(text, 9)).toBe(3)
    expect(lineNumberAtOffset(text, 999)).toBe(3)
  })
})

describe('codeEditorHelpers highlight budgets', () => {
  it('enforces max lines, max total chars, and max line chars budgets', () => {
    const withinLines = Array.from({ length: HIGHLIGHT_MAX_LINES }, () => 'x').join('\n')
    const overLines = Array.from({ length: HIGHLIGHT_MAX_LINES + 1 }, () => 'x').join('\n')
    expect(isHighlightWithinBudget(withinLines)).toBe(true)
    expect(isHighlightWithinBudget(overLines)).toBe(false)

    const withinChars = 'a'.repeat(8000) + '\n' + 'b'.repeat(HIGHLIGHT_MAX_CHARS - 8001)
    const overChars = 'a'.repeat(HIGHLIGHT_MAX_CHARS + 1)
    expect(withinChars.length).toBe(HIGHLIGHT_MAX_CHARS)
    expect(isHighlightWithinBudget(withinChars)).toBe(false) // exceeds single line check unless split
    const manyValidLines = Array.from({ length: 128 }, () => 'a'.repeat(4095)).join('\n')
    expect(manyValidLines.length).toBe(512 * 1024 - 1)
    expect(isHighlightWithinBudget(manyValidLines)).toBe(true)
    expect(isHighlightWithinBudget(overChars)).toBe(false)

    expect(isHighlightWithinBudget('x'.repeat(HIGHLIGHT_MAX_LINE_CHARS))).toBe(true)
    expect(isHighlightWithinBudget(`${'x'.repeat(HIGHLIGHT_MAX_LINE_CHARS)}\r\ny`)).toBe(true)
    expect(isHighlightWithinBudget('x'.repeat(HIGHLIGHT_MAX_LINE_CHARS + 1))).toBe(false)
    expect(isHighlightWithinBudget(`ok\n${'x'.repeat(HIGHLIGHT_MAX_LINE_CHARS + 1)}\nok`)).toBe(false)
  })

  it('selects immediate, deferred, or plain highlight tiers', () => {
    expect(selectHighlightTier('const x = 1', undefined)).toBe('plain')
    expect(selectHighlightTier('const x = 1', 'typescript')).toBe('immediate')

    const overTier1Lines = Array.from({ length: HIGHLIGHT_TIER1_MAX_LINES + 1 }, () => 'const a = 1').join('\n')
    expect(selectHighlightTier(overTier1Lines, 'typescript')).toBe('deferred')

    const overTier1Chars = Array.from({ length: 10 }, () => 'a'.repeat(2000)).join('\n')
    expect(overTier1Chars.length).toBeGreaterThan(HIGHLIGHT_TIER1_MAX_CHARS)
    expect(selectHighlightTier(overTier1Chars, 'typescript')).toBe('deferred')

    const overMaxLines = Array.from({ length: HIGHLIGHT_MAX_LINES + 1 }, () => 'a').join('\n')
    expect(selectHighlightTier(overMaxLines, 'typescript')).toBe('plain')
  })
})

describe('applyTabIndent', () => {
  it('inserts 2 spaces at a collapsed caret on Tab', () => {
    expect(CODE_EDITOR_INDENT).toBe('  ')
    expect(applyTabIndent('const a = 1', 0, 0, false)).toEqual({
      value: '  const a = 1',
      selectionStart: 2,
      selectionEnd: 2,
      changed: true,
    })
    expect(applyTabIndent('const a = 1', 5, 5, false)).toEqual({
      value: 'const   a = 1',
      selectionStart: 7,
      selectionEnd: 7,
      changed: true,
    })
  })

  it('strips leading 2 spaces, 1 space, or 1 tab on single-line Shift+Tab', () => {
    expect(applyTabIndent('  const a = 1', 5, 5, true)).toEqual({
      value: 'const a = 1',
      selectionStart: 3,
      selectionEnd: 3,
      changed: true,
    })
    expect(applyTabIndent('  const a = 1', 1, 1, true)).toEqual({
      value: 'const a = 1',
      selectionStart: 0,
      selectionEnd: 0,
      changed: true,
    })
    expect(applyTabIndent(' const a = 1', 3, 3, true)).toEqual({
      value: 'const a = 1',
      selectionStart: 2,
      selectionEnd: 2,
      changed: true,
    })
    expect(applyTabIndent('\tconst a = 1', 3, 3, true)).toEqual({
      value: 'const a = 1',
      selectionStart: 2,
      selectionEnd: 2,
      changed: true,
    })
    expect(applyTabIndent('const a = 1', 2, 2, true)).toEqual({
      value: 'const a = 1',
      selectionStart: 2,
      selectionEnd: 2,
      changed: false,
    })
  })

  it('batch indents and outdents multi-line selections while keeping selection bounds intact', () => {
    const source = 'one\ntwo\nthree'
    const indented = applyTabIndent(source, 0, 7, false)
    expect(indented).toEqual({
      value: '  one\n  two\nthree',
      selectionStart: 0,
      selectionEnd: 11,
      changed: true,
    })
    expect(applyTabIndent(indented.value, indented.selectionStart, indented.selectionEnd, true)).toEqual({
      value: source,
      selectionStart: 0,
      selectionEnd: 7,
      changed: true,
    })

    // Mid-line selection excludes a trailing line whose column 0 is selectionEnd.
    const midIndented = applyTabIndent(source, 1, 8, false)
    expect(midIndented).toEqual({
      value: '  one\n  two\nthree',
      selectionStart: 3,
      selectionEnd: 12,
      changed: true,
    })

    // Outdent clamps end offset cleanly within the last touched line.
    expect(applyTabIndent('  one\n  two', 3, 7, true)).toEqual({
      value: 'one\ntwo',
      selectionStart: 1,
      selectionEnd: 4,
      changed: true,
    })

    // Handles reversed selection offsets.
    expect(applyTabIndent('one\ntwo', 7, 0, false)).toEqual({
      value: '  one\n  two',
      selectionStart: 0,
      selectionEnd: 11,
      changed: true,
    })
  })
})

describe('applyEnterIndent', () => {
  it('inherits leading spaces or tabs only when leading whitespace precedes the caret', () => {
    expect(applyEnterIndent('plain', 5, 5)).toBeNull()
    expect(applyEnterIndent('  indented', 0, 0)).toBeNull()
    expect(applyEnterIndent('foo\n  bar', 4, 4)).toBeNull()

    expect(applyEnterIndent('  const x = 1', 13, 13)).toEqual({
      value: '  const x = 1\n  ',
      selectionStart: 16,
      selectionEnd: 16,
      changed: true,
    })
    expect(applyEnterIndent('\t\treturn 1', 10, 10)).toEqual({
      value: '\t\treturn 1\n\t\t',
      selectionStart: 13,
      selectionEnd: 13,
      changed: true,
    })
    expect(applyEnterIndent('    body', 2, 2)).toEqual({
      value: '  \n    body',
      selectionStart: 5,
      selectionEnd: 5,
      changed: true,
    })
    expect(applyEnterIndent('  abcdef', 4, 7)).toEqual({
      value: '  ab\n  f',
      selectionStart: 7,
      selectionEnd: 7,
      changed: true,
    })
  })
})

describe('findAllMatches and splitLineSpansWithMatches', () => {
  it('finds non-overlapping literal matches with case sensitivity options', () => {
    expect(findAllMatches('', 'a')).toEqual([])
    expect(findAllMatches('abc', '')).toEqual([])
    expect(findAllMatches('Foo bar foo FOO', 'foo')).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 11 },
      { start: 12, end: 15 },
    ])
    expect(findAllMatches('Foo bar foo FOO', 'foo', true)).toEqual([
      { start: 8, end: 11 },
    ])
    expect(findAllMatches('aaa', 'aa')).toEqual([{ start: 0, end: 2 }])
    expect(findAllMatches('a.b+c a.b+c', 'a.b+c')).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 11 },
    ])
    // Exercises Unicode case-folding fallback where toLowerCase changes string length.
    expect(findAllMatches('İxİ', 'İ')).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 3 },
    ])
  })

  it('splits syntax spans across overlapping matches and marks active match', () => {
    const spans = [
      { text: 'const', style: { color: 'var(--shiki-token-keyword)' } },
      { text: ' foo = foo', style: { color: 'var(--shiki-foreground)' } },
    ]
    const matches = findAllMatches('const foo = foo', 't f')
    const line1 = splitLineSpansWithMatches('const foo = foo', 0, spans, matches, 0, 0)
    expect(line1.segments).toEqual([
      { text: 'cons', style: { color: 'var(--shiki-token-keyword)' }, matchIndex: null, active: false },
      { text: 't', style: { color: 'var(--shiki-token-keyword)' }, matchIndex: 0, active: true },
      { text: ' f', style: { color: 'var(--shiki-foreground)' }, matchIndex: 0, active: true },
      { text: 'oo = foo', style: { color: 'var(--shiki-foreground)' }, matchIndex: null, active: false },
    ])
    expect(line1.nextMatchCursor).toBe(1)

    const emptyLine = splitLineSpansWithMatches('', 16, undefined, matches, 0, 0)
    expect(emptyLine.segments).toEqual([])
  })
})
