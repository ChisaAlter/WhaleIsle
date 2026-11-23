/**
 * Pure formatting, coordinate conversion, and post-edit path extraction for the `lsp` tool:
 * one-based↔zero-based UTF-16 cursor conversion, workspace-grouped location and diagnostic
 * rendering with `file:`-URI resolution, complete-result capping, and UI presentation. No I/O — a
 * UI may call the presenter on live streaming and on replay, so it depends only on tool arguments.
 * @module @deepseek-ai/dsh-tool-lsp/render
 */

import { ToolArgsError } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { LspDiagnostic, LspHover, LspLocation, LspOperation, LspPosition } from '@deepseek-ai/dsh-lsp'
import { posix, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The operations the `lsp` tool exposes, as a runtime tuple for schema enum + validation. */
export const LSP_OPERATIONS: readonly LspOperation[] = [
  'goToDefinition',
  'findReferences',
  'goToImplementation',
  'hover',
  'diagnostics',
]

/** Default cap on rendered locations or diagnostics before an omission marker is appended. */
export const DEFAULT_MAX_LOCATIONS = 100

/** Default cap on the complete rendered tool result, including truncation metadata. */
export const DEFAULT_MAX_RESULT_CHARS = 16_000

/** Validated `lsp` arguments after coordinate checks. */
export interface LspToolInput {
  readonly operation: LspOperation
  readonly filePath: string
  /** Zero-based UTF-16 position converted from the one-based model coordinates. */
  readonly position: LspPosition
}

/** The raw, schema-typed argument shape. */
export interface LspToolArgs {
  readonly operation: string
  readonly file_path: string
  readonly line?: number
  readonly character?: number
}

/**
 * Validate and convert model arguments: `operation` must be in {@link LSP_OPERATIONS};
 * `line`/`character` are required positive one-based integers for cursor operations and optional
 * (defaulting to 1, 1) for `'diagnostics'`.
 * @param args - the schema-validated raw arguments.
 * @returns the validated input with a zero-based position.
 * @throws ToolArgsError (`INVALID_ARGS`) when the operation is unknown, `file_path` is blank, or a
 *   required coordinate is missing or not a positive integer.
 */
export function parseLspArgs(args: LspToolArgs): LspToolInput {
  if (!isOperation(args.operation)) {
    throw new ToolArgsError([`operation must be one of ${LSP_OPERATIONS.join(', ')}`])
  }
  if (args.file_path.trim().length === 0) throw new ToolArgsError(['file_path must be a non-empty string'])
  if (args.operation === 'diagnostics') {
    const line = args.line === undefined ? 1 : oneBased(args.line, 'line')
    const character = args.character === undefined ? 1 : oneBased(args.character, 'character')
    return {
      operation: args.operation,
      filePath: args.file_path,
      position: { line: line - 1, character: character - 1 },
    }
  }
  if (args.line === undefined) {
    throw new ToolArgsError(['line must be a positive integer (one-based)'])
  }
  if (args.character === undefined) {
    throw new ToolArgsError(['character must be a positive integer (one-based)'])
  }
  const line = oneBased(args.line, 'line')
  const character = oneBased(args.character, 'character')
  return {
    operation: args.operation,
    filePath: args.file_path,
    // The model counts from 1; the seam (and protocol) count from 0.
    position: { line: line - 1, character: character - 1 },
  }
}

/** Whether a string is one of the supported operations. */
function isOperation(value: string): value is LspOperation {
  return (LSP_OPERATIONS as readonly string[]).includes(value)
}

/** Validate a one-based coordinate is a positive integer. */
function oneBased(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new ToolArgsError([`${name} must be a positive integer (one-based)`])
  }
  return value
}

/**
 * Render a locations result grouped by file, converting each zero-based location back to a one-based
 * `path:line:character` entry. A `file:` URI inside the workspace becomes a workspace-relative path;
 * outside it, a URI-derived absolute path; a non-`file:` URI is kept verbatim. Applies `maxLocations` and
 * appends an omission marker when it truncates by count, then applies the complete result cap.
 * @param locations - the seam's locations (possibly empty).
 * @param workspaceUri - the provider's canonical workspace `file:` URI.
 * @param maxLocations - the cap before truncation.
 * @param maxResultChars - the complete rendered-text cap, including truncation metadata.
 * @returns the rendered text; a distinct no-result line when there are none.
 */
export function formatLocations(
  locations: readonly LspLocation[],
  workspaceUri: string,
  maxLocations: number,
  maxResultChars: number,
): string {
  if (locations.length === 0) return boundResult('No results.', maxResultChars, 'locations')
  const shown = locations.slice(0, maxLocations)
  const omitted = locations.length - shown.length
  const grouped = new Map<string, string[]>()
  for (const location of shown) {
    const path = renderUri(location.uri, workspaceUri)
    const line = location.range.start.line + 1
    const character = location.range.start.character + 1
    const entries = grouped.get(path) ?? []
    entries.push(`${path}:${line}:${character}`)
    grouped.set(path, entries)
  }
  const lines: string[] = []
  for (const entries of grouped.values()) lines.push(...entries)
  if (omitted > 0) {
    lines.push(`… ${omitted} more location${omitted === 1 ? '' : 's'} omitted (limit ${maxLocations}).`)
  }
  return boundResult(lines.join('\n'), maxResultChars, 'locations')
}

/**
 * Render normalized document diagnostics as compact `file:line:col [severity] (source/code) message`
 * lines with one-based coordinates, capped by item count and total characters.
 * @param diagnostics - normalized diagnostics for `uri`.
 * @param uri - the target document URI.
 * @param workspaceUri - the provider's canonical workspace `file:` URI.
 * @param maxItems - maximum rendered diagnostic entries before an omission marker.
 * @param maxResultChars - maximum rendered characters, including truncation metadata.
 * @returns the formatted diagnostics or `'No diagnostics.'` when empty.
 */
export function formatDiagnostics(
  diagnostics: readonly LspDiagnostic[],
  uri: string,
  workspaceUri: string,
  maxItems: number,
  maxResultChars: number,
): string {
  if (diagnostics.length === 0) return boundResult('No diagnostics.', maxResultChars, 'diagnostics')
  const file = renderUri(uri, workspaceUri)
  const shown = diagnostics.slice(0, maxItems)
  const omitted = diagnostics.length - shown.length
  const lines = shown.map((diagnostic) => {
    const line = diagnostic.range.start.line + 1
    const col = diagnostic.range.start.character + 1
    const tag = formatDiagnosticTag(diagnostic.source, diagnostic.code)
    return `${file}:${line}:${col} [${diagnostic.severity}]${tag} ${diagnostic.message}`
  })
  if (omitted > 0) {
    lines.push(`… ${omitted} more diagnostic${omitted === 1 ? '' : 's'} omitted (limit ${maxItems}).`)
  }
  return boundResult(lines.join('\n'), maxResultChars, 'diagnostics')
}

/** Format optional `(source/code)` metadata for a diagnostic line. */
function formatDiagnosticTag(source: string | undefined, code: string | number | undefined): string {
  const hasSource = source !== undefined && source.length > 0
  if (hasSource && code !== undefined) return ` (${source}/${code})`
  if (hasSource) return ` (${source})`
  if (code !== undefined) return ` (${code})`
  return ''
}

/**
 * Render a hover result, applying `maxResultChars` last and keeping its marker within the cap.
 * @param hover - the normalized hover, or `null` for no hover.
 * @param maxResultChars - the complete rendered-text cap, including truncation metadata.
 * @returns the rendered hover text; a distinct no-result line for `null`.
 */
export function formatHover(hover: LspHover | null, maxResultChars: number): string {
  const text = hover === null ? 'No hover information.' : hover.contents
  return boundResult(text, maxResultChars, 'hover')
}

/** Bound a complete rendered result, including the truncation notice itself. */
function boundResult(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) return text
  const notice = `\n… ${label} truncated (limit ${maxChars} characters).`
  if (notice.length >= maxChars) return notice.slice(0, maxChars)
  return `${text.slice(0, maxChars - notice.length)}${notice}`
}

/**
 * Extract deduplicated written/edited file paths from a completed file-mutation tool call.
 * Read-only subcommands (such as `str_replace_editor` with `command: 'view'`) and deleted paths
 * are excluded.
 * @param toolName - invoked tool name (`edit`, `write`, `apply_patch`, `str_replace_editor`).
 * @param args - parsed tool arguments.
 * @param resultValue - canonical result value returned by the tool, if any.
 * @returns unique non-empty file paths in execution order.
 */
export function extractEditedFilePaths(toolName: string, args: unknown, resultValue: unknown): string[] {
  const paths: string[] = []
  const add = (candidate: unknown): void => {
    if (typeof candidate === 'string' && candidate.trim().length > 0 && !paths.includes(candidate)) {
      paths.push(candidate)
    }
  }
  const argRecord = isRecord(args) ? args : undefined
  const valRecord = isRecord(resultValue) ? resultValue : undefined

  if (toolName === 'edit' || toolName === 'write') {
    if (typeof valRecord?.path === 'string' && valRecord.path.trim().length > 0) {
      add(valRecord.path)
    } else {
      add(argRecord?.file_path)
    }
    return paths
  }

  if (toolName === 'str_replace_editor') {
    const command = argRecord?.command
    if (command === 'create' || command === 'str_replace' || command === 'insert') {
      add(argRecord?.path)
    }
    return paths
  }

  if (toolName === 'apply_patch') {
    if (Array.isArray(valRecord?.operations)) {
      for (const rawOp of valRecord.operations) {
        if (!isRecord(rawOp)) continue
        if (rawOp.status !== 'completed' || rawOp.kind === 'delete') continue
        if (rawOp.kind === 'move' && typeof rawOp.destination === 'string') {
          add(rawOp.destination)
        } else {
          add(rawOp.path)
        }
      }
      return paths
    }
    if (typeof argRecord?.input === 'string') {
      for (const extracted of extractPatchHeaderPaths(argRecord.input)) {
        add(extracted)
      }
    }
  }

  return paths
}

/** Fallback parser for mock `apply_patch` inputs lacking canonical `operations` output. */
function extractPatchHeaderPaths(patchText: string): string[] {
  const result: string[] = []
  let lastActionIndex = -1
  for (const rawLine of patchText.split(/\r?\n/)) {
    if (rawLine.startsWith('*** Add File: ')) {
      result.push(rawLine.slice('*** Add File: '.length).trim())
      lastActionIndex = result.length - 1
    } else if (rawLine.startsWith('*** Update File: ')) {
      result.push(rawLine.slice('*** Update File: '.length).trim())
      lastActionIndex = result.length - 1
    } else if (rawLine.startsWith('*** Move to: ')) {
      const dest = rawLine.slice('*** Move to: '.length).trim()
      if (lastActionIndex >= 0) {
        result[lastActionIndex] = dest
      } else {
        result.push(dest)
      }
    } else if (rawLine.startsWith('*** Delete File: ')) {
      lastActionIndex = -1
    }
  }
  return result
}

/**
 * Append diagnostic feedback text to an existing tool-result content array without mutating it.
 * @param content - existing content blocks from the tool result.
 * @param note - compact formatted diagnostics notice to append.
 * @returns new content-block array carrying the appended diagnostics.
 */
export function appendDiagnosticsContent(content: readonly ContentBlock[], note: string): ContentBlock[] {
  const last = content.at(-1)
  if (last !== undefined && last.type === 'text') {
    return [
      ...content.slice(0, -1),
      {
        ...last,
        text: last.text.length > 0 ? `${last.text}\n\n${note}` : note,
      },
    ]
  }
  return [...content, { type: 'text', text: note }]
}

/** Narrow an unknown value to a non-null plain record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

/**
 * Resolve a location URI without applying the harness host's path rules. A valid `file:` URI becomes
 * workspace-relative when it is under the provider's canonical workspace URI, or a URI-derived
 * absolute path otherwise; malformed and non-`file:` URIs remain verbatim.
 * @param uri - the target URI from the seam.
 * @param workspaceUri - the provider's canonical workspace `file:` URI.
 * @returns the display path or the verbatim URI.
 */
export function renderUri(uri: string, workspaceUri: string): string {
  if (!uri.startsWith('file:')) return uri
  let target: URL
  let workspace: URL
  try {
    target = new URL(uri)
    workspace = new URL(workspaceUri)
  } catch {
    return uri
  }
  if (workspace.protocol !== 'file:') return uri
  // A `file:` URI does not carry its world's OS, so a leading `/X:` segment is
  // read as a Windows drive. A POSIX workspace literally rooted at `/c:/...`
  // would mis-render (display only; edits and reads use the exact URI).
  const drivePath = /^\/[a-z](?::|%3A)/iu
  const windowsWorld = workspace.hostname.length > 0 || drivePath.test(workspace.pathname)
  const targetWindowsWorld = windowsWorld && (target.hostname.length > 0 || drivePath.test(target.pathname))
  const workspacePath = filePath(workspace, windowsWorld)
  const targetPath = filePath(target, targetWindowsWorld)
  if (workspacePath === undefined || targetPath === undefined) return uri
  if (windowsWorld !== targetWindowsWorld) return targetPath
  const path = windowsWorld ? win32 : posix
  const relative = path.relative(workspacePath, targetPath)
  const outside = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
  const rendered = relative === '' ? '.' : outside ? targetPath : relative
  return windowsWorld ? rendered.replaceAll('\\', '/') : rendered
}

/** Decode a file URL for its execution world while containing malformed URL failures. */
function filePath(url: URL, windows: boolean): string | undefined {
  try {
    const path = fileURLToPath(url, { windows })
    return path.includes('\0') ? undefined : path
  } catch {
    // `fileURLToPath` rejects malformed escapes, authorities, and encoded path separators.
    return undefined
  }
}

/**
 * UI presentation for a pending `lsp` call. Uses a generic search card; the title carries the
 * operation and one-based cursor (when present), and `locations` focuses the queried line.
 * @param args - the raw tool arguments.
 * @returns the generic call view.
 */
export function presentLspCall(args: LspToolArgs): GenericCallView {
  const hasCursor = args.line !== undefined && args.character !== undefined
  return {
    card: 'generic',
    kind: 'search',
    title: hasCursor
      ? `LSP ${args.operation} ${args.file_path}:${args.line}:${args.character}`
      : `LSP ${args.operation} ${args.file_path}`,
    locations: [{ path: args.file_path, ...args.line !== undefined ? { line: args.line } : {} }],
  }
}
