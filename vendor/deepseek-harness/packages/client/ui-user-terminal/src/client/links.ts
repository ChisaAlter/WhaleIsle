import { isMacPlatform } from './ghostty/platform.ts'

/** Detect http(s) and workspace-looking paths in one terminal line. */
export interface TerminalLinkMatch {
  kind: 'url' | 'path'
  text: string
  start: number
  end: number
}

const URL_PATTERN = /https?:\/\/[^\s"'`<>]+/g
const FILE_PATH_PATTERN =
  /(?:~\/|\.{1,2}\/|\/|[A-Za-z]:[\\/]|\\\\)[^\s"'`<>]+|[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+(?::\d+){0,2}/g
const TRAILING_PUNCTUATION_PATTERN = /[.,;!?]+$/

function trimClosingDelimiters(value: string): string {
  let output = value.replace(TRAILING_PUNCTUATION_PATTERN, '')
  if (output.length === 0) return output
  const trimUnbalanced = (open: string, close: string): void => {
    while (output.endsWith(close)) {
      const opens = output.split(open).length - 1
      const closes = output.split(close).length - 1
      if (opens >= closes) return
      output = output.slice(0, -1)
    }
  }
  trimUnbalanced('(', ')')
  trimUnbalanced('[', ']')
  trimUnbalanced('{', '}')
  return output
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end
}

function collectMatches(
  line: string,
  kind: TerminalLinkMatch['kind'],
  pattern: RegExp,
  existing: TerminalLinkMatch[],
): TerminalLinkMatch[] {
  const matches: TerminalLinkMatch[] = []
  pattern.lastIndex = 0
  for (const rawMatch of line.matchAll(pattern)) {
    const raw = rawMatch[0]
    const start = rawMatch.index ?? -1
    if (start < 0 || raw.length === 0) continue
    const trimmed = trimClosingDelimiters(raw)
    if (trimmed.length === 0) continue
    if (kind === 'path' && /^https?:\/\//i.test(trimmed)) continue
    const candidate: TerminalLinkMatch = { kind, text: trimmed, start, end: start + trimmed.length }
    if ([...existing, ...matches].some(other => overlaps(candidate, other))) continue
    matches.push(candidate)
  }
  return matches
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || isWindowsAbsolutePath(value)
}

function isWindowsPathStyle(value: string): boolean {
  return isWindowsAbsolutePath(value) || /[A-Za-z]:\\/.test(value)
}

function joinPath(base: string, next: string, separator: '/' | '\\'): string {
  const cleanBase = base.replace(/[\\/]+$/, '')
  if (separator === '\\') return `${cleanBase}\\${next.replaceAll('/', '\\')}`
  return `${cleanBase}/${next.replace(/^\/+/, '')}`
}

function inferHomeFromCwd(cwd: string): string | undefined {
  const posixUser = cwd.match(/^\/Users\/([^/]+)/)
  if (posixUser?.[1]) return `/Users/${posixUser[1]}`
  const posixHome = cwd.match(/^\/home\/([^/]+)/)
  if (posixHome?.[1]) return `/home/${posixHome[1]}`
  const windowsUser = cwd.match(/^([A-Za-z]:\\Users\\[^\\]+)/)
  if (windowsUser?.[1]) return windowsUser[1]
  return undefined
}

/**
 * Split `path:line` / `path:line:column` suffixes used by compiler output.
 * @param value - raw path or path with a position suffix.
 * @returns the path and optional 1-based line/column.
 */
export function splitPathAndPosition(value: string): {
  path: string
  line: string | undefined
  column: string | undefined
} {
  let path = value
  const columnMatch = path.match(/:(\d+)$/)
  if (!columnMatch?.[1]) return { path, line: undefined, column: undefined }
  let column: string | undefined = columnMatch[1]
  path = path.slice(0, -columnMatch[0].length)
  const lineMatch = path.match(/:(\d+)$/)
  if (lineMatch?.[1]) {
    return { path: path.slice(0, -lineMatch[0].length), line: lineMatch[1], column }
  }
  return { path, line: column, column: undefined }
}

/**
 * Find http(s) URLs and workspace-looking paths in one terminal line.
 * @param line - a single buffer line, already unwrapped.
 * @returns matches ordered by start index; URLs win overlaps.
 */
export function extractTerminalLinks(line: string): TerminalLinkMatch[] {
  const urlMatches = collectMatches(line, 'url', URL_PATTERN, [])
  const pathMatches = collectMatches(line, 'path', FILE_PATH_PATTERN, urlMatches)
  return [...urlMatches, ...pathMatches].toSorted((a, b) => a.start - b.start)
}

/**
 * Resolve a path link against the session cwd. Line/column suffixes are
 * split off the filesystem path; callers pass `line` into `openPath`.
 * @param rawPath - path as printed in the terminal.
 * @param cwd - session workspace root.
 * @returns a host-absolute path for `workspaces.openPath`.
 */
export function resolveOpenPath(rawPath: string, cwd: string): string {
  const { path } = splitPathAndPosition(rawPath)
  if (path.startsWith('~/')) {
    const home = inferHomeFromCwd(cwd)
    if (home !== undefined) {
      const separator: '/' | '\\' = isWindowsPathStyle(home) ? '\\' : '/'
      return joinPath(home, path.slice(2), separator)
    }
  }
  if (!isAbsolutePath(path)) {
    const separator: '/' | '\\' = isWindowsPathStyle(cwd) ? '\\' : '/'
    return joinPath(cwd, path, separator)
  }
  return path
}

export function isTerminalLinkActivation(
  event: Pick<MouseEvent, 'metaKey' | 'ctrlKey'>,
  platform = typeof navigator === 'undefined' ? '' : navigator.platform,
): boolean {
  if (platform.length === 0) return false
  return isMacPlatform(platform)
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey
}

/** Callbacks that open a detected terminal target. */
export interface TerminalLinkActions {
  openLocalUrl: (url: string) => void
  openExternal: (url: string) => void
  openWorkspacePath: (absolutePath: string, options?: { line?: number }) => void
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '0.0.0.0'])

/**
 * True when `raw` is http(s) to an exact loopback hostname (any port/path).
 * Rejects prefix spoofs such as `http://127.0.0.1.evil` and userinfo
 * tricks such as `http://127.0.0.1@evil` or `http://evil@127.0.0.1`.
 * @param raw - candidate URL text.
 * @returns true when the URL is loopback http(s).
 */
export function isLoopbackHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    if (parsed.username !== '' || parsed.password !== '') return false
    return LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())
  } catch {
    return false
  }
}

/**
 * Open the first URL or path in `text`. Loopback http(s) goes to the Browser
 * surface; other http(s) uses the system browser; paths go through
 * `workspaces.openPath` (desktop intercepts into Files).
 * @param text - selection or link text.
 * @param cwd - session workspace root; required for relative paths.
 * @param actions - open callbacks.
 * @returns which kind opened, or null when nothing matched.
 */
export function activateTerminalTarget(
  text: string,
  cwd: string | undefined,
  actions: TerminalLinkActions,
): TerminalLinkMatch['kind'] | null {
  const matches = extractTerminalLinks(text.trim())
  const first = matches[0]
  if (first === undefined) return null
  if (first.kind === 'url') {
    if (isLoopbackHttpUrl(first.text)) actions.openLocalUrl(first.text)
    else actions.openExternal(first.text)
    return 'url'
  }
  if (cwd === undefined || cwd.length === 0) return null
  const { line } = splitPathAndPosition(first.text)
  const absolutePath = resolveOpenPath(first.text, cwd)
  if (line === undefined) actions.openWorkspacePath(absolutePath)
  else actions.openWorkspacePath(absolutePath, { line: Number.parseInt(line, 10) })
  return 'path'
}

/** One xterm buffer line used to rejoin wrapped output. */
export interface TerminalBufferLineLike {
  readonly isWrapped?: boolean
  translateToString: (trimRight?: boolean) => string
}

/** One physical row inside a wrapped logical line. */
export interface WrappedTerminalLinkLineSegment {
  bufferLineNumber: number
  text: string
  startIndex: number
  endIndex: number
}

/** A logical terminal line spanning wrapped buffer rows. */
export interface WrappedTerminalLinkLine {
  text: string
  segments: ReadonlyArray<WrappedTerminalLinkLineSegment>
}

/** One xterm buffer cell (1-based column and row). */
export interface TerminalLinkBufferPosition {
  x: number
  y: number
}

/** Inclusive start/end cells of a wrapped terminal link. */
export interface TerminalLinkBufferRange {
  start: TerminalLinkBufferPosition
  end: TerminalLinkBufferPosition
}

/**
 * Rejoin wrapped xterm rows so a URL or path split across lines is one match.
 * @param bufferLineNumber - 1-based row the provider was asked about.
 * @param getLine - 0-based buffer reader.
 * @returns the logical line, or null when that row does not exist.
 */
export function collectWrappedTerminalLinkLine(
  bufferLineNumber: number,
  getLine: (bufferLineIndex: number) => TerminalBufferLineLike | null | undefined,
): WrappedTerminalLinkLine | null {
  const anchorLine = getLine(bufferLineNumber - 1)
  if (!anchorLine) return null
  let startBufferLineNumber = bufferLineNumber
  let startLine = anchorLine
  while (startBufferLineNumber > 1 && startLine.isWrapped) {
    const previousLine = getLine(startBufferLineNumber - 2)
    if (!previousLine) return null
    startBufferLineNumber -= 1
    startLine = previousLine
  }
  const segments: WrappedTerminalLinkLineSegment[] = []
  let nextStartIndex = 0
  let currentBufferLineNumber = startBufferLineNumber
  while (true) {
    const currentLine = getLine(currentBufferLineNumber - 1)
    if (!currentLine) break
    const nextLine = getLine(currentBufferLineNumber)
    const hasWrappedContinuation = nextLine?.isWrapped === true
    const text = currentLine.translateToString(!hasWrappedContinuation)
    segments.push({
      bufferLineNumber: currentBufferLineNumber,
      text,
      startIndex: nextStartIndex,
      endIndex: nextStartIndex + text.length,
    })
    nextStartIndex += text.length
    if (!hasWrappedContinuation) break
    currentBufferLineNumber += 1
  }
  return { text: segments.map(segment => segment.text).join(''), segments }
}

function resolveCharacterPosition(
  segments: ReadonlyArray<WrappedTerminalLinkLineSegment>,
  characterIndex: number,
): TerminalLinkBufferPosition {
  for (const segment of segments) {
    if (characterIndex < segment.endIndex) {
      return { x: characterIndex - segment.startIndex + 1, y: segment.bufferLineNumber }
    }
  }
  const lastSegment = segments[segments.length - 1]
  return {
    x: Math.max(lastSegment?.text.length ?? 0, 1),
    y: lastSegment?.bufferLineNumber ?? 1,
  }
}

/**
 * Map a character-range match onto 1-based xterm buffer cells.
 * @param wrappedLine - rejoined line and its physical segments.
 * @param match - start/end in the logical string.
 * @returns the inclusive xterm cell range.
 */
export function resolveWrappedTerminalLinkRange(
  wrappedLine: WrappedTerminalLinkLine,
  match: Pick<TerminalLinkMatch, 'start' | 'end'>,
): TerminalLinkBufferRange {
  return {
    start: resolveCharacterPosition(wrappedLine.segments, match.start),
    end: resolveCharacterPosition(wrappedLine.segments, match.end - 1),
  }
}

/**
 * True when a wrapped match paints on this 1-based buffer row.
 * @param range - xterm cell range.
 * @param bufferLineNumber - row being queried.
 * @returns true when the range covers that buffer row.
 */
export function wrappedTerminalLinkRangeIntersectsBufferLine(
  range: TerminalLinkBufferRange,
  bufferLineNumber: number,
): boolean {
  return range.start.y <= bufferLineNumber && bufferLineNumber <= range.end.y
}

/**
 * Links on one buffer row after rejoining wraps.
 * @param bufferLineNumber - 1-based row.
 * @param getLine - 0-based buffer reader.
 * @returns matches whose wrapped range intersects this row.
 */
export function linksOnBufferLine(
  bufferLineNumber: number,
  getLine: (bufferLineIndex: number) => TerminalBufferLineLike | null | undefined,
): Array<TerminalLinkMatch & { range: TerminalLinkBufferRange }> {
  const wrapped = collectWrappedTerminalLinkLine(bufferLineNumber, getLine)
  if (wrapped === null) return []
  return extractTerminalLinks(wrapped.text)
    .map(match => ({ ...match, range: resolveWrappedTerminalLinkRange(wrapped, match) }))
    .filter(match => wrappedTerminalLinkRangeIntersectsBufferLine(match.range, bufferLineNumber))
}
