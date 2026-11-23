/**
 * Pure protocol translation for the local host: what the server's capabilities allow, and how its
 * `Location`/`LocationLink`/`Hover` payloads normalize into the seam's closed result unions. No I/O
 * or process state — every function here is a pure transform, which the fake-stdio tests pin exactly.
 * @module @deepseek-ai/dsh-lsp-stdio/translate
 */

import type {
  LspDiagnostic,
  LspDiagnosticSeverity,
  LspHover,
  LspLocation,
  LspOperation,
  LspRange,
} from '@deepseek-ai/dsh-lsp'
import { LspError } from '@deepseek-ai/dsh-lsp'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type {
  WireHover,
  WireLocation,
  WireLocationLink,
  WireMarkedString,
  WireProviderCapability,
  WireRange,
  WireServerCapabilities,
  WireTextDocumentSyncKind,
} from './protocol.ts'

/** Maximum diagnostics retained per document from a `textDocument/publishDiagnostics` push. */
export const MAX_DIAGNOSTICS_PER_FILE = 200

/**
 * The `textDocument/*` request or notification method for each LSP operation.
 * @param operation - the LSP operation to map.
 * @returns the LSP method name.
 */
export function requestMethod(operation: LspOperation): string {
  switch (operation) {
    case 'goToDefinition': return 'textDocument/definition'
    case 'findReferences': return 'textDocument/references'
    case 'goToImplementation': return 'textDocument/implementation'
    case 'hover': return 'textDocument/hover'
    case 'diagnostics': return 'textDocument/publishDiagnostics'
    /* v8 ignore next -- exhaustive over the closed LspOperation union; unreachable. */
    default: return assertNever(operation, 'requestMethod')
  }
}

/** The `ServerCapabilities` provider field backing each cursor operation. */
function capabilityValue(
  capabilities: WireServerCapabilities,
  operation: Exclude<LspOperation, 'diagnostics'>,
): WireProviderCapability {
  switch (operation) {
    case 'goToDefinition': return capabilities.definitionProvider
    case 'findReferences': return capabilities.referencesProvider
    case 'goToImplementation': return capabilities.implementationProvider
    case 'hover': return capabilities.hoverProvider
    /* v8 ignore next -- exhaustive over cursor operations; unreachable. */
    default: return assertNever(operation, 'capabilityValue')
  }
}

/** A provider capability is present when the server sent `true` or an options object (not `false`/absent). */
function supportsCapability(value: WireProviderCapability): boolean {
  if (value === undefined) return false
  if (typeof value === 'boolean') return value
  return true
}

/**
 * Whether the server advertises the requested operation. Push-based `diagnostics` relies on
 * document synchronization rather than an explicit pull-diagnostics server capability.
 * @param capabilities - the server's `initialize` capabilities.
 * @param operation - the LSP operation to check.
 * @returns true when the operation is supported.
 */
export function supportsOperation(capabilities: WireServerCapabilities, operation: LspOperation): boolean {
  if (operation === 'diagnostics') return true
  return supportsCapability(capabilityValue(capabilities, operation))
}

/**
 * Whether `textDocumentSync` accepts `textDocument/didChange` full-content updates.
 * @param sync - the server's advertised `textDocumentSync` capability.
 * @returns true when full or incremental change notifications are supported.
 */
export function supportsDocumentChange(sync: WireServerCapabilities['textDocumentSync']): boolean {
  if (sync === undefined) return false
  if (typeof sync === 'number') return isOpenCloseKind(sync)
  return sync.openClose === true && sync.change !== 0
}

/**
 * Whether a `textDocumentSync` value permits the transient `didOpen`/`didClose` this host relies on.
 * The legacy enum form implies open/close for `Full`/`Incremental`; the options form requires an
 * explicit `openClose: true`, because the protocol defaults an omitted `openClose` to false.
 * @param sync - the server's advertised `textDocumentSync` capability.
 * @returns true when transient open/close is supported.
 */
export function supportsTransientOpen(sync: WireServerCapabilities['textDocumentSync']): boolean {
  if (sync === undefined) return false
  if (typeof sync === 'number') return isOpenCloseKind(sync)
  return sync.openClose === true
}

/** Legacy enum: `Full` (1) or `Incremental` (2) imply open/close support; `None` (0) does not. */
function isOpenCloseKind(kind: WireTextDocumentSyncKind): boolean {
  return kind === 1 || kind === 2
}

/**
 * Normalize the negotiated position encoding. An omitted encoding defaults to `utf-16`; any value
 * other than `utf-16` is a protocol error this host does not support.
 * @param encoding - the server's advertised `positionEncoding`, if any.
 * @returns the string `'utf-16'`.
 * @throws LspError `LSP_UNSUPPORTED_ENCODING` for any non-`utf-16` encoding.
 */
export function negotiatePositionEncoding(encoding: string | undefined): 'utf-16' {
  if (encoding === undefined || encoding === 'utf-16') return 'utf-16'
  throw new LspError(
    `server negotiated unsupported position encoding "${encoding}"; this host requires utf-16`,
    'LSP_UNSUPPORTED_ENCODING',
  )
}

/**
 * Read the server capabilities from an untrusted `initialize` result.
 * @param result - the raw `initialize` response result.
 * @returns the advertised capabilities object.
 * @throws LspError `LSP_MALFORMED_RESPONSE` when the result or its `capabilities` is not an object.
 */
export function initializeCapabilities(result: unknown): WireServerCapabilities {
  if (result === null || typeof result !== 'object') {
    throw malformedResponse('LSP initialize result was not an object')
  }
  const capabilities = (result as Record<string, unknown>).capabilities
  if (capabilities === null || typeof capabilities !== 'object') {
    throw malformedResponse('LSP initialize result had no capabilities object')
  }
  return capabilities
}

/** Convert a wire range to the seam's range (structurally identical, but re-shaped as `readonly`). */
function toRange(range: WireRange): LspRange {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  }
}

/** Whether a record is a `LocationLink` (has `targetUri` + `targetSelectionRange`). */
function isLocationLink(value: Record<string, unknown>): boolean {
  return typeof value.targetUri === 'string' && isRange(value.targetSelectionRange)
}

/** Whether a record is a `Location` (has string `uri` + a range). */
function isLocation(value: Record<string, unknown>): boolean {
  return typeof value.uri === 'string' && isRange(value.range)
}

/** Structural range guard used by both location shapes. */
function isRange(value: unknown): value is WireRange {
  if (value === null || typeof value !== 'object') return false
  const range = value as Record<string, unknown>
  return isPosition(range.start) && isPosition(range.end)
}

/** Structural position guard. */
function isPosition(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  const position = value as Record<string, unknown>
  return isProtocolCoordinate(position.line) && isProtocolCoordinate(position.character)
}

/** Whether a wire coordinate is a valid nonnegative integer. */
function isProtocolCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/**
 * Normalize a navigation result (`Location`, `Location[]`, `LocationLink[]`, or `null`) to the seam's
 * locations. `Location` maps directly; `LocationLink` maps `targetUri` + `targetSelectionRange`.
 * @param payload - the raw `textDocument/definition|references|implementation` result.
 * @returns the normalized locations (empty for `null`/`[]`).
 * @throws LspError `LSP_MALFORMED_RESPONSE` when the result is missing or an element is neither a
 *   `Location` nor a `LocationLink`.
 */
export function normalizeLocations(payload: unknown): LspLocation[] {
  if (payload === null) return []
  if (payload === undefined) throw malformedResponse('LSP navigation result was missing')
  const elements = Array.isArray(payload) ? payload : [payload]
  const locations: LspLocation[] = []
  for (const element of elements) {
    if (element === null || typeof element !== 'object') {
      throw malformedResponse('LSP navigation result contained a non-object entry')
    }
    const record = element as Record<string, unknown>
    if (isLocationLink(record)) {
      const link = record as unknown as WireLocationLink
      locations.push({ uri: link.targetUri, range: toRange(link.targetSelectionRange) })
    } else if (isLocation(record)) {
      const location = record as unknown as WireLocation
      locations.push({ uri: location.uri, range: toRange(location.range) })
    } else {
      throw malformedResponse('LSP navigation result contained neither a Location nor a LocationLink')
    }
  }
  return locations
}

/** Render one `MarkedString` (string form verbatim; object form as a language-tagged fenced block). */
function renderMarkedString(value: WireMarkedString): string {
  if (typeof value === 'string') return value
  return `\`\`\`${value.language}\n${value.value}\n\`\`\``
}

/**
 * Normalize a `Hover` (or `null`) to the seam's hover. `MarkupContent` uses its `value`; a string
 * `MarkedString` is verbatim; a language-tagged `MarkedString` becomes a fenced code block; an array
 * joins its rendered parts with one blank line. The model-facing tool owns the complete result cap.
 * @param payload - the raw `textDocument/hover` result.
 * @returns the normalized hover, or `null` when there is no content.
 * @throws LspError `LSP_MALFORMED_RESPONSE` when the payload is a non-null, non-object, or
 *   structurally invalid hover.
 */
export function normalizeHover(payload: unknown): LspHover | null {
  if (payload === null) return null
  if (payload === undefined) throw malformedResponse('LSP hover result was missing')
  if (typeof payload !== 'object') throw malformedResponse('LSP hover result was not an object')
  const hover = payload as WireHover
  const contents = renderHoverContents(hover.contents)
  if (contents === '') return null
  const range = hover.range
  if (range === undefined) return { contents }
  if (!isRange(range)) throw malformedResponse('LSP hover result contained a malformed range')
  return { contents, range: toRange(range) }
}

/** Render the three `Hover.contents` encodings into one string (input is untrusted wire data). */
function renderHoverContents(contents: unknown): string {
  if (contents === null || contents === undefined) {
    throw malformedResponse('LSP hover result had no contents')
  }
  if (typeof contents === 'string') return contents
  if (Array.isArray(contents)) {
    return contents.map((value) => {
      if (isMarkedString(value)) return renderMarkedString(value)
      throw malformedResponse('LSP hover contents contained a malformed MarkedString')
    }).join('\n\n')
  }
  if (typeof contents !== 'object') {
    throw malformedResponse('LSP hover contents were not MarkupContent, MarkedString, or an array')
  }
  const record = contents as Record<string, unknown>
  if (record.kind === 'markdown' || record.kind === 'plaintext') {
    if (typeof record.value !== 'string') {
      throw malformedResponse('LSP hover MarkupContent value was not a string')
    }
    return record.value
  }
  if (typeof record.language === 'string' && typeof record.value === 'string') {
    return renderMarkedString({ language: record.language, value: record.value })
  }
  throw malformedResponse('LSP hover contents were not MarkupContent, MarkedString, or an array')
}

/** Whether an untrusted value is either form of `MarkedString`. */
function isMarkedString(value: unknown): value is WireMarkedString {
  if (typeof value === 'string') return true
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.language === 'string' && typeof record.value === 'string'
}

/** Create the stable structured error used for malformed server result payloads. */
function malformedResponse(message: string): LspError {
  return new LspError(message, 'LSP_MALFORMED_RESPONSE')
}

/**
 * Canonicalize a document URI for in-memory caching so servers emitting percent-encoded or
 * lowercase Windows drive letters (`file:///c%3A/...`) match `pathToFileURL()` (`file:///C:/...`).
 * @param uri - raw document URI.
 * @returns normalized cache-key URI.
 */
export function normalizeDocumentUri(uri: string): string {
  if (!uri.startsWith('file:')) return uri
  try {
    const parsed = new URL(uri)
    parsed.pathname = parsed.pathname.replace(/^\/([a-zA-Z])(?:%3A|:)/, (_, drive: string) => `/${drive.toLowerCase()}:`)
    if (parsed.hostname.length > 0) parsed.hostname = parsed.hostname.toLowerCase()
    return parsed.href
  } catch {
    // Keep malformed URIs verbatim so they can still be matched literally.
    return uri
  }
}

/** Normalized `publishDiagnostics` notification payload. */
export interface NormalizedPublishDiagnostics {
  readonly uri: string
  readonly version?: number
  readonly diagnostics: readonly LspDiagnostic[]
}

/**
 * Parse and bound an untrusted `textDocument/publishDiagnostics` notification payload.
 * Malformed notifications return `undefined` so a noisy server does not tear down the stream;
 * valid entries are capped at `maxDiagnosticsPerFile` (default 200).
 * @param params - raw JSON-RPC notification `params`.
 * @param maxDiagnosticsPerFile - maximum entries retained per push.
 * @returns normalized diagnostics or `undefined` when the payload lacks a valid URI/array.
 */
export function normalizePublishDiagnostics(
  params: unknown,
  maxDiagnosticsPerFile = MAX_DIAGNOSTICS_PER_FILE,
): NormalizedPublishDiagnostics | undefined {
  if (params === null || typeof params !== 'object') return undefined
  const record = params as Record<string, unknown>
  if (typeof record.uri !== 'string' || !Array.isArray(record.diagnostics)) return undefined
  const version = typeof record.version === 'number' && Number.isInteger(record.version)
    ? record.version
    : undefined
  const diagnostics: LspDiagnostic[] = []
  for (const raw of record.diagnostics) {
    if (diagnostics.length >= maxDiagnosticsPerFile) break
    const normalized = normalizeDiagnostic(raw)
    if (normalized !== undefined) diagnostics.push(normalized)
  }
  return {
    uri: record.uri,
    ...version !== undefined ? { version } : {},
    diagnostics,
  }
}

/** Normalize one wire Diagnostic entry, skipping malformed objects. */
function normalizeDiagnostic(raw: unknown): LspDiagnostic | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const item = raw as Record<string, unknown>
  if (!isRange(item.range) || typeof item.message !== 'string') return undefined
  const code = typeof item.code === 'string' || typeof item.code === 'number' ? item.code : undefined
  const source = typeof item.source === 'string' && item.source.length > 0 ? item.source : undefined
  return {
    range: toRange(item.range),
    severity: mapDiagnosticSeverity(item.severity),
    message: item.message,
    ...code !== undefined ? { code } : {},
    ...source !== undefined ? { source } : {},
  }
}

/** Map numeric LSP DiagnosticSeverity (1..4) to normalized labels, defaulting omitted severity to error. */
function mapDiagnosticSeverity(severity: unknown): LspDiagnosticSeverity {
  switch (severity) {
    case 2: return 'warning'
    case 3: return 'information'
    case 4: return 'hint'
    case 1:
    default:
      return 'error'
  }
}
