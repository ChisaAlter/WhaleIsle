import { describe, expect, it } from 'vitest'
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
import {
  appendDiagnosticsContent,
  DEFAULT_MAX_LOCATIONS,
  DEFAULT_MAX_RESULT_CHARS,
  extractEditedFilePaths,
  formatDiagnostics,
  formatHover,
  formatLocations,
  LSP_OPERATIONS,
  parseLspArgs,
  presentLspCall,
  renderUri,
} from '@deepseek-ai/dsh-tool-lsp'
import type { LspDiagnostic, LspLocation } from '@deepseek-ai/dsh-lsp'

const WS = resolve('/home/u/proj')
const WS_URI = pathToFileURL(WS).href

function loc(uri: string, line: number, character = 0): LspLocation {
  return { uri, range: { start: { line, character }, end: { line, character: character + 1 } } }
}

describe('parseLspArgs', () => {
  it('accepts all operations and converts one-based to zero-based', () => {
    for (const operation of LSP_OPERATIONS) {
      const input = parseLspArgs({ operation, file_path: 'a.ts', line: 3, character: 5 })
      expect(input.operation).toBe(operation)
      expect(input.position).toEqual({ line: 2, character: 4 })
    }
  })

  it('allows diagnostics without line/character and defaults to zero-based 0:0', () => {
    const input = parseLspArgs({ operation: 'diagnostics', file_path: 'src/a.ts' })
    expect(input).toEqual({
      operation: 'diagnostics',
      filePath: 'src/a.ts',
      position: { line: 0, character: 0 },
    })
  })

  it('requires line and character for cursor-based operations', () => {
    expect(() => parseLspArgs({ operation: 'goToDefinition', file_path: 'a.ts' }))
      .toThrow(expect.objectContaining({ name: 'ToolArgsError', code: 'INVALID_ARGS', message: expect.stringMatching(/line must be/) as string }))
    expect(() => parseLspArgs({ operation: 'hover', file_path: 'a.ts', line: 1 }))
      .toThrow(expect.objectContaining({ name: 'ToolArgsError', code: 'INVALID_ARGS', message: expect.stringMatching(/character must be/) as string }))
  })

  it('rejects an unknown operation', () => {
    expect(() => parseLspArgs({ operation: 'rename', file_path: 'a.ts', line: 1, character: 1 }))
      .toThrow(expect.objectContaining({ name: 'ToolArgsError', code: 'INVALID_ARGS', message: expect.stringMatching(/operation must be one of/) as string }))
  })

  it('rejects a blank file_path', () => {
    expect(() => parseLspArgs({ operation: 'hover', file_path: '   ', line: 1, character: 1 }))
      .toThrow(expect.objectContaining({ name: 'ToolArgsError', code: 'INVALID_ARGS', message: 'invalid arguments: file_path must be a non-empty string' }))
  })

  it('rejects non-positive or non-integer coordinates', () => {
    expect(() => parseLspArgs({ operation: 'hover', file_path: 'a.ts', line: 0, character: 1 })).toThrow(expect.objectContaining({ name: 'ToolArgsError', code: 'INVALID_ARGS', message: expect.stringMatching(/line must be a positive integer/) as string }))
    expect(() => parseLspArgs({ operation: 'hover', file_path: 'a.ts', line: 1, character: 0 })).toThrow(expect.objectContaining({ name: 'ToolArgsError', code: 'INVALID_ARGS', message: expect.stringMatching(/character must be a positive integer/) as string }))
    expect(() => parseLspArgs({ operation: 'hover', file_path: 'a.ts', line: 1.5, character: 1 })).toThrow(expect.objectContaining({ name: 'ToolArgsError', code: 'INVALID_ARGS', message: expect.stringMatching(/line must be a positive integer/) as string }))
  })
})

describe('renderUri', () => {
  it('relativizes a file: URI inside the workspace with forward slashes', () => {
    const uri = pathToFileURL(join(WS, 'src', 'a.ts')).href
    expect(renderUri(uri, WS_URI)).toBe('src/a.ts')
  })

  it('returns an absolute path for a file: URI outside the workspace', () => {
    const outside = resolve(WS, '..', 'other', 'lib', 'b.ts')
    const uri = pathToFileURL(outside).href
    expect(renderUri(uri, WS_URI)).toBe(outside.replaceAll('\\', '/'))
  })

  it('renders the workspace root itself as "."', () => {
    expect(renderUri(WS_URI, WS_URI)).toBe('.')
  })

  it('keeps an in-workspace path whose first segment starts with dots relative', () => {
    // `..generated` is a real in-workspace dir, not a parent escape; only a `..` segment is external.
    const uri = pathToFileURL(join(WS, '..generated', 'a.ts')).href
    expect(renderUri(uri, WS_URI)).toBe('..generated/a.ts')
  })

  it('relativizes Windows execution-world URIs on a non-Windows host', () => {
    expect(renderUri('file:///C:/WORKSPACE/src/a.ts', 'file:///c:/workspace')).toBe('src/a.ts')
    expect(renderUri('file:///D:/lib/b.ts', 'file:///C:/workspace')).toBe('D:/lib/b.ts')
  })

  it('renders remote file authorities without host path conversion', () => {
    expect(renderUri('file://server/share/workspace/a.ts', 'file://server/share/workspace')).toBe('a.ts')
    expect(renderUri('file://SERVER/share/workspace/src/A.ts', 'file://server/Share/Workspace')).toBe('src/A.ts')
    expect(renderUri('file://other/share/b.ts', 'file://server/share/workspace')).toBe('//other/share/b.ts')
    expect(renderUri('file:///D:/lib/a.ts', 'file://server/share/workspace')).toBe('D:/lib/a.ts')
    expect(renderUri('file:///a.ts', 'file://server/')).toBe('/a.ts')
    expect(renderUri('file:///a.ts', 'file:///')).toBe('a.ts')
  })

  it('preserves backslashes as ordinary POSIX filename characters', () => {
    expect(renderUri('file:///home/u/proj/dir%5Cname/a.ts', 'file:///home/u/proj')).toBe('dir\\name/a.ts')
  })

  it('keeps malformed or mismatched URI coordinates verbatim', () => {
    expect(renderUri('file://[', WS_URI)).toBe('file://[')
    expect(renderUri('file:///a.ts', 'https://example.com/workspace')).toBe('file:///a.ts')
    expect(renderUri('file:///a.ts', 'file:///bad%ZZ')).toBe('file:///a.ts')
    expect(renderUri('file:///C:/workspace/bad%5Cpath', 'file:///C:/workspace')).toBe('file:///C:/workspace/bad%5Cpath')
    expect(renderUri('file:///short', 'file:///short/deeper')).toBe('/short')
    expect(renderUri('file:///', 'file:///C:/workspace')).toBe('/')
  })

  it('keeps a non-file URI verbatim', () => {
    expect(renderUri('untitled:Untitled-1', WS_URI)).toBe('untitled:Untitled-1')
    expect(renderUri('jdt://contents/Foo.class', WS_URI)).toBe('jdt://contents/Foo.class')
  })

  it('keeps a malformed file: URI verbatim when it cannot be parsed to a path', () => {
    // An encoded path separator is invalid on every platform and must remain verbatim.
    expect(renderUri('file:///bad%2Fpath', WS_URI)).toBe('file:///bad%2Fpath')
    expect(renderUri('file:///bad%00path', WS_URI)).toBe('file:///bad%00path')
  })
})

describe('formatLocations', () => {
  it('renders a no-result line for an empty list', () => {
    expect(formatLocations([], WS_URI, DEFAULT_MAX_LOCATIONS, DEFAULT_MAX_RESULT_CHARS)).toBe('No results.')
  })

  it('renders one-based path:line:character grouped by file', () => {
    const a = pathToFileURL(join(WS, 'a.ts')).href
    const text = formatLocations([loc(a, 0, 0), loc(a, 4, 2)], WS_URI, DEFAULT_MAX_LOCATIONS, DEFAULT_MAX_RESULT_CHARS)
    expect(text).toBe('a.ts:1:1\na.ts:5:3')
  })

  it('caps at maxLocations and marks the omission', () => {
    const a = pathToFileURL(join(WS, 'a.ts')).href
    const many = Array.from({ length: 5 }, (_, i) => loc(a, i))
    const text = formatLocations(many, WS_URI, 2, DEFAULT_MAX_RESULT_CHARS)
    expect(text).toContain('a.ts:1:1')
    expect(text).toContain('3 more locations omitted (limit 2).')
  })

  it('uses the singular omission marker for exactly one extra', () => {
    const a = pathToFileURL(join(WS, 'a.ts')).href
    const text = formatLocations([loc(a, 0), loc(a, 1)], WS_URI, 1, DEFAULT_MAX_RESULT_CHARS)
    expect(text).toContain('1 more location omitted (limit 1).')
  })

  it('caps the complete location text even when one URI is enormous', () => {
    const maxResultChars = 80
    const text = formatLocations([loc(`custom:${'x'.repeat(1_000_000)}`, 0)], WS_URI, 1, maxResultChars)
    expect(text).toHaveLength(maxResultChars)
    expect(text).toContain('locations truncated')
  })
})

describe('formatHover', () => {
  it('renders a no-result line for null', () => {
    expect(formatHover(null, DEFAULT_MAX_RESULT_CHARS)).toBe('No hover information.')
  })

  it('returns short hover verbatim', () => {
    expect(formatHover({ contents: '```ts\nx: number\n```' }, DEFAULT_MAX_RESULT_CHARS)).toBe('```ts\nx: number\n```')
  })

  it('caps the complete hover text including its truncation marker', () => {
    const text = formatHover({ contents: 'a'.repeat(100) }, 60)
    expect(text).toHaveLength(60)
    expect(text).toContain('hover truncated (limit 60 characters).')
  })

  it('still honors a cap smaller than the truncation marker', () => {
    expect(formatHover({ contents: 'a'.repeat(100) }, 10)).toHaveLength(10)
  })
})

describe('presentLspCall', () => {
  it('is a generic search card with an operation/cursor title and a line location', () => {
    expect(presentLspCall({ operation: 'findReferences', file_path: 'a.ts', line: 3, character: 7 })).toEqual({
      card: 'generic',
      kind: 'search',
      title: 'LSP findReferences a.ts:3:7',
      locations: [{ path: 'a.ts', line: 3 }],
    })
  })

  it('renders a positionless call title for diagnostics without coordinates', () => {
    expect(presentLspCall({ operation: 'diagnostics', file_path: 'a.ts' })).toEqual({
      card: 'generic',
      kind: 'search',
      title: 'LSP diagnostics a.ts',
      locations: [{ path: 'a.ts' }],
    })
  })
})

describe('formatDiagnostics', () => {
  function diag(
    line: number,
    character: number,
    severity: LspDiagnostic['severity'],
    message: string,
    extra: Partial<Pick<LspDiagnostic, 'source' | 'code'>> = {},
  ): LspDiagnostic {
    return {
      range: { start: { line, character }, end: { line, character: character + 1 } },
      severity,
      message,
      ...extra,
    }
  }

  it('renders a distinct no-diagnostics line when empty', () => {
    const uri = pathToFileURL(join(WS, 'a.ts')).href
    expect(formatDiagnostics([], uri, WS_URI, DEFAULT_MAX_LOCATIONS, DEFAULT_MAX_RESULT_CHARS)).toBe('No diagnostics.')
  })

  it('formats file:line:col [severity] (source/code) message with optional source/code combinations', () => {
    const uri = pathToFileURL(join(WS, 'src', 'a.ts')).href
    const rendered = formatDiagnostics([
      diag(2, 4, 'error', 'Type mismatch', { source: 'ts', code: 2322 }),
      diag(4, 0, 'warning', 'Unused symbol', { source: 'eslint' }),
      diag(5, 1, 'information', 'Info note', { code: 'I100' }),
      diag(6, 2, 'hint', 'Consider const'),
    ], uri, WS_URI, DEFAULT_MAX_LOCATIONS, DEFAULT_MAX_RESULT_CHARS)

    expect(rendered).toBe([
      'src/a.ts:3:5 [error] (ts/2322) Type mismatch',
      'src/a.ts:5:1 [warning] (eslint) Unused symbol',
      'src/a.ts:6:2 [information] (I100) Info note',
      'src/a.ts:7:3 [hint] Consider const',
    ].join('\n'))
  })

  it('caps items and characters cleanly', () => {
    const uri = pathToFileURL(join(WS, 'a.ts')).href
    const items = [diag(0, 0, 'error', 'first'), diag(1, 0, 'warning', 'second'), diag(2, 0, 'error', 'third')]
    const limited = formatDiagnostics(items, uri, WS_URI, 1, DEFAULT_MAX_RESULT_CHARS)
    expect(limited).toBe('a.ts:1:1 [error] first\n… 2 more diagnostics omitted (limit 1).')

    const charCapped = formatDiagnostics(items, uri, WS_URI, 10, 50)
    expect(charCapped).toHaveLength(50)
    expect(charCapped).toContain('diagnostics truncated')
  })
})

describe('extractEditedFilePaths & appendDiagnosticsContent', () => {
  it('extracts edited paths for edit, write, str_replace_editor, and apply_patch while ignoring view/delete', () => {
    expect(extractEditedFilePaths('edit', { file_path: 'a.ts' }, { path: '/ws/a.ts' })).toEqual(['/ws/a.ts'])
    expect(extractEditedFilePaths('write', { file_path: 'b.ts' }, undefined)).toEqual(['b.ts'])
    expect(extractEditedFilePaths('str_replace_editor', { command: 'view', path: '/ws/a.ts' }, undefined)).toEqual([])
    expect(extractEditedFilePaths('str_replace_editor', { command: 'str_replace', path: '/ws/a.ts' }, undefined)).toEqual(['/ws/a.ts'])
    expect(extractEditedFilePaths('str_replace_editor', { command: 'create', path: '/ws/c.ts' }, undefined)).toEqual(['/ws/c.ts'])
    expect(extractEditedFilePaths('str_replace_editor', { command: 'insert', path: '/ws/d.ts' }, undefined)).toEqual(['/ws/d.ts'])
    expect(extractEditedFilePaths('apply_patch', {}, {
      operations: [
        { kind: 'add', path: 'added.ts', status: 'completed' },
        { kind: 'update', path: 'updated.ts', status: 'completed' },
        { kind: 'move', path: 'old.ts', destination: 'moved.ts', status: 'completed' },
        { kind: 'delete', path: 'deleted.ts', status: 'completed' },
        { kind: 'update', path: 'skipped.ts', status: 'skipped' },
      ],
    })).toEqual(['added.ts', 'updated.ts', 'moved.ts'])
    expect(extractEditedFilePaths('apply_patch', {
      input: '*** Begin Patch\n*** Update File: old.ts\n*** Move to: new.ts\n*** Delete File: gone.ts\n*** Add File: fresh.ts\n*** End Patch',
    }, undefined)).toEqual(['new.ts', 'fresh.ts'])
    expect(extractEditedFilePaths('read', { file_path: 'a.ts' }, undefined)).toEqual([])
  })

  it('appends diagnostics text without mutating existing content blocks', () => {
    const original = [{ type: 'text' as const, text: 'Edited file.' }]
    const updated = appendDiagnosticsContent(original, 'LSP diagnostics:\na.ts:1:1 [error] bad')
    expect(original[0]?.text).toBe('Edited file.')
    expect(updated).toEqual([{ type: 'text', text: 'Edited file.\n\nLSP diagnostics:\na.ts:1:1 [error] bad' }])
    expect(appendDiagnosticsContent([], 'LSP diagnostics:\nx')).toEqual([{ type: 'text', text: 'LSP diagnostics:\nx' }])
  })
})
