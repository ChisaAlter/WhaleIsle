import { describe, expect, it } from 'vitest'
import {
  MAX_DIAGNOSTICS_PER_FILE,
  negotiatePositionEncoding,
  normalizeDocumentUri,
  normalizeHover,
  normalizeLocations,
  normalizePublishDiagnostics,
  requestMethod,
  supportsDocumentChange,
  supportsOperation,
  supportsTransientOpen,
} from '../src/translate.ts'
import { CLIENT_CAPABILITIES } from '../src/protocol.ts'
import type { WireServerCapabilities } from '@deepseek-ai/dsh-lsp-stdio/src/protocol.ts'

const RANGE = { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } }

describe('requestMethod', () => {
  it('maps each operation to its textDocument request or notification method', () => {
    expect(requestMethod('goToDefinition')).toBe('textDocument/definition')
    expect(requestMethod('findReferences')).toBe('textDocument/references')
    expect(requestMethod('goToImplementation')).toBe('textDocument/implementation')
    expect(requestMethod('hover')).toBe('textDocument/hover')
    expect(requestMethod('diagnostics')).toBe('textDocument/publishDiagnostics')
  })
})

describe('supportsOperation', () => {
  it('reads the provider slot for cursor operations and always allows push diagnostics', () => {
    const caps: WireServerCapabilities = {
      definitionProvider: true,
      referencesProvider: { workDoneProgress: true },
      implementationProvider: false,
    }
    expect(supportsOperation(caps, 'goToDefinition')).toBe(true)
    expect(supportsOperation(caps, 'findReferences')).toBe(true)
    expect(supportsOperation(caps, 'goToImplementation')).toBe(false)
    expect(supportsOperation(caps, 'hover')).toBe(false)
    expect(supportsOperation(caps, 'diagnostics')).toBe(true)
  })
})

describe('supportsDocumentChange', () => {
  it('accepts full/incremental sync and rejects None/absent/change:0', () => {
    expect(supportsDocumentChange(1)).toBe(true)
    expect(supportsDocumentChange(2)).toBe(true)
    expect(supportsDocumentChange({ openClose: true })).toBe(true)
    expect(supportsDocumentChange({ openClose: true, change: 1 })).toBe(true)
    expect(supportsDocumentChange({ openClose: true, change: 2 })).toBe(true)
    expect(supportsDocumentChange({ openClose: true, change: 0 })).toBe(false)
    expect(supportsDocumentChange({ openClose: false, change: 1 })).toBe(false)
    expect(supportsDocumentChange(0)).toBe(false)
    expect(supportsDocumentChange(undefined)).toBe(false)
  })
})

describe('CLIENT_CAPABILITIES', () => {
  it('advertises textDocument.publishDiagnostics support', () => {
    expect(CLIENT_CAPABILITIES.textDocument.publishDiagnostics).toEqual({
      relatedInformation: true,
      versionSupport: true,
    })
  })
})

describe('supportsTransientOpen', () => {
  it('accepts legacy Full and Incremental enums, rejects None and absent', () => {
    expect(supportsTransientOpen(1)).toBe(true)
    expect(supportsTransientOpen(2)).toBe(true)
    expect(supportsTransientOpen(0)).toBe(false)
    expect(supportsTransientOpen(undefined)).toBe(false)
  })

  it('accepts options with openClose:true and rejects openClose:false', () => {
    expect(supportsTransientOpen({ openClose: true })).toBe(true)
    expect(supportsTransientOpen({ openClose: false, change: 2 })).toBe(false)
  })

  it('requires an explicit openClose for the options form (no change-enum fallback)', () => {
    expect(supportsTransientOpen({ change: 1 })).toBe(false)
    expect(supportsTransientOpen({ change: 2 })).toBe(false)
    expect(supportsTransientOpen({})).toBe(false)
  })
})

describe('negotiatePositionEncoding', () => {
  it('defaults an omitted encoding to utf-16', () => {
    expect(negotiatePositionEncoding(undefined)).toBe('utf-16')
    expect(negotiatePositionEncoding('utf-16')).toBe('utf-16')
  })

  it('rejects any other encoding', () => {
    expect(() => negotiatePositionEncoding('utf-8')).toThrow(expect.objectContaining({
      name: 'LspError',
      code: 'LSP_UNSUPPORTED_ENCODING',
      message: expect.stringMatching(/unsupported position encoding "utf-8"/) as string,
    }))
  })
})

describe('normalizeLocations', () => {
  it('returns empty only for the protocol no-result value null', () => {
    expect(normalizeLocations(null)).toEqual([])
    expect(() => normalizeLocations(undefined)).toThrow(expect.objectContaining({ code: 'LSP_MALFORMED_RESPONSE' }))
  })

  it('maps a single Location', () => {
    expect(normalizeLocations({ uri: 'file:///a', range: RANGE })).toEqual([{ uri: 'file:///a', range: RANGE }])
  })

  it('maps an array of Locations', () => {
    const result = normalizeLocations([{ uri: 'file:///a', range: RANGE }, { uri: 'file:///b', range: RANGE }])
    expect(result.map(l => l.uri)).toEqual(['file:///a', 'file:///b'])
  })

  it('maps a LocationLink from targetUri + targetSelectionRange', () => {
    const link = { targetUri: 'file:///c', targetSelectionRange: RANGE, targetRange: RANGE }
    expect(normalizeLocations([link])).toEqual([{ uri: 'file:///c', range: RANGE }])
  })

  it('rejects a non-object entry', () => {
    expect(() => normalizeLocations([42])).toThrow(/non-object/)
  })

  it('rejects an entry that is neither a Location nor a LocationLink', () => {
    expect(() => normalizeLocations([{ nope: true }])).toThrow(/neither a Location nor a LocationLink/)
  })

  it('rejects a Location whose range is not an object', () => {
    expect(() => normalizeLocations([{ uri: 'file:///a', range: 'nope' }])).toThrow(/neither a Location/)
  })

  it('rejects a Location whose range positions are malformed', () => {
    expect(() => normalizeLocations([{ uri: 'file:///a', range: { start: null, end: null } }])).toThrow(/neither a Location/)
  })

  it('rejects negative and fractional position coordinates', () => {
    expect(() => normalizeLocations([{ uri: 'file:///a', range: { start: { line: -1, character: 0 }, end: RANGE.end } }]))
      .toThrow(expect.objectContaining({ code: 'LSP_MALFORMED_RESPONSE' }))
    expect(() => normalizeLocations([{ uri: 'file:///a', range: { start: RANGE.start, end: { line: 1.5, character: 5 } } }]))
      .toThrow(expect.objectContaining({ code: 'LSP_MALFORMED_RESPONSE' }))
  })
})

describe('normalizeHover', () => {
  it('returns null for null', () => {
    expect(normalizeHover(null)).toBeNull()
  })

  it('rejects a missing hover result', () => {
    expect(() => normalizeHover(undefined)).toThrow(expect.objectContaining({ code: 'LSP_MALFORMED_RESPONSE' }))
  })

  it('reads MarkupContent value and keeps a range', () => {
    expect(normalizeHover({ contents: { kind: 'markdown', value: '# H' }, range: RANGE }))
      .toEqual({ contents: '# H', range: RANGE })
  })

  it('keeps a bare string MarkedString verbatim', () => {
    expect(normalizeHover({ contents: 'plain text' })).toEqual({ contents: 'plain text' })
  })

  it('renders a language-tagged MarkedString object as a fenced code block', () => {
    expect(normalizeHover({ contents: { language: 'ts', value: 'const x = 1' } }))
      .toEqual({ contents: '```ts\nconst x = 1\n```' })
  })

  it('joins a MarkedString array with one blank line', () => {
    expect(normalizeHover({ contents: ['a', { language: 'ts', value: 'b' }] }))
      .toEqual({ contents: 'a\n\n```ts\nb\n```' })
  })

  it('drops an empty-contents hover to null', () => {
    expect(normalizeHover({ contents: { kind: 'plaintext', value: '' } })).toBeNull()
  })

  it('rejects a MarkupContent with a non-string value', () => {
    expect(() => normalizeHover({ contents: { kind: 'markdown', value: 42 } }))
      .toThrow(expect.objectContaining({ code: 'LSP_MALFORMED_RESPONSE' }))
  })

  it('rejects a non-object payload', () => {
    expect(() => normalizeHover(42)).toThrow(/was not an object/)
  })

  it('rejects malformed contents', () => {
    expect(() => normalizeHover({ contents: { weird: true } })).toThrow(/were not MarkupContent/)
    expect(() => normalizeHover({ contents: 42 })).toThrow(/were not MarkupContent/)
  })

  it('rejects a malformed MarkedString array member', () => {
    expect(() => normalizeHover({ contents: ['ok', { language: 'ts', value: 42 }] }))
      .toThrow(expect.objectContaining({ code: 'LSP_MALFORMED_RESPONSE' }))
    expect(() => normalizeHover({ contents: [null] }))
      .toThrow(expect.objectContaining({ code: 'LSP_MALFORMED_RESPONSE' }))
  })

  it('rejects a hover with no contents field', () => {
    expect(() => normalizeHover({ range: RANGE })).toThrow(/no contents/)
  })

  it('rejects a malformed range instead of silently dropping it', () => {
    expect(() => normalizeHover({ contents: 'x', range: { start: { line: 1 } } }))
      .toThrow(expect.objectContaining({ code: 'LSP_MALFORMED_RESPONSE' }))
  })
})

describe('normalizeDocumentUri', () => {
  it('normalizes Windows drive encoding/case while leaving POSIX and non-file URIs intact', () => {
    expect(normalizeDocumentUri('file:///c%3A/Repo/src/A.ts')).toBe('file:///c:/Repo/src/A.ts')
    expect(normalizeDocumentUri('file:///C:/Repo/src/A.ts')).toBe('file:///c:/Repo/src/A.ts')
    expect(normalizeDocumentUri('file:///home/user/src/A.ts')).toBe('file:///home/user/src/A.ts')
    expect(normalizeDocumentUri('untitled:Untitled-1')).toBe('untitled:Untitled-1')
    expect(normalizeDocumentUri('file://[')).toBe('file://[')
  })
})

describe('normalizePublishDiagnostics', () => {
  it('parses valid diagnostics with severity mapping and optional source/code/version', () => {
    const parsed = normalizePublishDiagnostics({
      uri: 'file:///ws/a.ts',
      version: 3,
      diagnostics: [
        { range: RANGE, severity: 1, source: 'ts', code: 2322, message: 'type mismatch' },
        { range: RANGE, severity: 2, code: 'unused', message: 'unused var' },
        { range: RANGE, severity: 3, message: 'info' },
        { range: RANGE, severity: 4, message: 'hint' },
        { range: RANGE, message: 'default severity' },
      ],
    })
    expect(parsed).toEqual({
      uri: 'file:///ws/a.ts',
      version: 3,
      diagnostics: [
        { range: RANGE, severity: 'error', source: 'ts', code: 2322, message: 'type mismatch' },
        { range: RANGE, severity: 'warning', code: 'unused', message: 'unused var' },
        { range: RANGE, severity: 'information', message: 'info' },
        { range: RANGE, severity: 'hint', message: 'hint' },
        { range: RANGE, severity: 'error', message: 'default severity' },
      ],
    })
  })

  it('ignores malformed payloads/entries and caps per-file diagnostics at MAX_DIAGNOSTICS_PER_FILE', () => {
    expect(normalizePublishDiagnostics(null)).toBeUndefined()
    expect(normalizePublishDiagnostics({ uri: 123, diagnostics: [] })).toBeUndefined()
    expect(normalizePublishDiagnostics({ uri: 'file:///ws/a.ts', diagnostics: 'nope' })).toBeUndefined()

    const raw = Array.from({ length: MAX_DIAGNOSTICS_PER_FILE + 25 }, (_, i) => ({
      range: RANGE,
      severity: 1,
      message: `err-${i}`,
    }))
    const parsed = normalizePublishDiagnostics({
      uri: 'file:///ws/a.ts',
      diagnostics: [null, { range: { start: { line: -1, character: 0 }, end: RANGE.end }, message: 'bad' }, ...raw],
    })
    expect(parsed?.diagnostics).toHaveLength(MAX_DIAGNOSTICS_PER_FILE)
    expect(parsed?.diagnostics[0]?.message).toBe('err-0')
    expect(parsed?.diagnostics[MAX_DIAGNOSTICS_PER_FILE - 1]?.message).toBe(`err-${MAX_DIAGNOSTICS_PER_FILE - 1}`)
  })
})
