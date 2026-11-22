/**
 * Build single-hunk unified diff patches safe for `git apply --cached` and
 * format line-level review comments for composer injection.
 */
import type { ReviewHunk, ReviewLineCommentTarget } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DiffFile, DiffHunk, DiffLine } from './shell.ts'

const NTFS_RESERVED_STEM = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/

function hasControlChars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/**
 * Validate a relative diff path against traversal, absolute paths, `.git`, and
 * Windows NTFS reserved device names.
 * @param relativePath - repository-relative POSIX path.
 * @returns whether the path is safe to embed in a unified patch.
 */
export function isSafePatchPath(relativePath: string): boolean {
  if (relativePath.length === 0 || hasControlChars(relativePath)) return false
  if (relativePath.startsWith('/') || relativePath.startsWith('\\')) return false
  if (/^[A-Za-z]:/.test(relativePath) || relativePath.includes('\\')) return false
  const segments = relativePath.split('/')
  for (const segment of segments) {
    if (segment.length === 0 || segment === '.' || segment === '..') return false
    if (segment.toLowerCase() === '.git') return false
    const stem = segment.replace(/[. ]+$/g, '').split('.')[0] ?? ''
    if (NTFS_RESERVED_STEM.test(stem)) return false
  }
  return true
}

function quoteGitPath(pathText: string): string {
  return `"${pathText.replaceAll('"', '\\"')}"`
}

function formatDiffGitPair(
  oldPath: string,
  newPath: string,
  status: DiffFile['status'],
): string {
  const mustQuote = oldPath.includes('"')
    || newPath.includes('"')
    || (status === 'renamed' && (oldPath.includes(' b/') || newPath.includes(' b/')))
  const left = `a/${oldPath}`
  const right = `b/${newPath}`
  return mustQuote ? `diff --git ${quoteGitPath(left)} ${quoteGitPath(right)}` : `diff --git ${left} ${right}`
}

function formatHeaderPath(prefix: 'a/' | 'b/', relativePath: string): string {
  const full = `${prefix}${relativePath}`
  return relativePath.includes('"') ? quoteGitPath(full) : full
}

function formatRenamePath(relativePath: string): string {
  return relativePath.includes('"') ? quoteGitPath(relativePath) : relativePath
}

interface NormalizedBody {
  rawLines: string[]
  oldCount: number
  newCount: number
  hasChanges: boolean
}

function normalizeBodyLines(lines: readonly (DiffLine | string)[]): NormalizedBody | null {
  const rawLines: string[] = []
  let oldCount = 0
  let newCount = 0
  let hasChanges = false
  for (const entry of lines) {
    let kind: DiffLine['kind']
    let text: string
    if (typeof entry === 'string') {
      if (entry.length === 0) {
        kind = 'context'
        text = ''
      } else {
        const prefix = entry[0]
        text = entry.slice(1)
        if (prefix === '+') kind = 'add'
        else if (prefix === '-') kind = 'del'
        else if (prefix === ' ') kind = 'context'
        else if (prefix === '\\') kind = 'eof'
        else return null
      }
    } else {
      kind = entry.kind
      text = entry.text
    }
    if (text.includes('\r') || text.includes('\n') || text.includes('\0')) return null
    switch (kind) {
      case 'add':
        rawLines.push(`+${text}`)
        newCount += 1
        hasChanges = true
        break
      case 'del':
        rawLines.push(`-${text}`)
        oldCount += 1
        hasChanges = true
        break
      case 'context':
        rawLines.push(` ${text}`)
        oldCount += 1
        newCount += 1
        break
      case 'eof':
        rawLines.push(text.startsWith(' ') ? `\\${text}` : `\\ ${text}`)
        break
    }
  }
  if (rawLines.length === 0 || !hasChanges) return null
  return { rawLines, oldCount, newCount, hasChanges }
}

function resolveHunkHeader(
  file: Pick<DiffFile, 'status'>,
  hunk: DiffHunk | ReviewHunk,
  oldCount: number,
  newCount: number,
): string | null {
  if (hunk.header !== undefined) {
    if (hasControlChars(hunk.header)) return null
    const match = HUNK_HEADER_RE.exec(hunk.header)
    if (match === null) return null
    const headerOld = match[2] === undefined ? 1 : Number(match[2])
    const headerNew = match[4] === undefined ? 1 : Number(match[4])
    if (headerOld !== oldCount || headerNew !== newCount) return null
    return hunk.header
  }
  if (!('oldStart' in hunk)) return null
  if (hunk.oldStart === undefined && hunk.newStart === undefined) return null
  const oldStart = hunk.oldStart ?? (file.status === 'added' ? 0 : 1)
  const newStart = hunk.newStart ?? (file.status === 'deleted' ? 0 : 1)
  return `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`
}

/**
 * Construct a valid single-hunk unified diff patch for `git apply --cached --unidiff-zero -`
 * (or `-R -` when unstaging). Returns `null` when the file/hunk is binary, oversized,
 * truncated, unsafe, or malformed.
 * @param file - diff file metadata.
 * @param hunk - complete single hunk (`DiffHunk` or `ReviewHunk`).
 * @returns standard unified patch string ending with a newline, or `null`.
 */
export function buildSingleHunkPatch(
  file: Pick<DiffFile, 'path' | 'status' | 'oldPath' | 'binary' | 'tooLarge'>,
  hunk: DiffHunk | ReviewHunk,
): string | null {
  if (file.binary === true || file.tooLarge === true) return null
  if (!isSafePatchPath(file.path)) return null

  const body = normalizeBodyLines(hunk.lines)
  if (body === null) return null

  const header = resolveHunkHeader(file, hunk, body.oldCount, body.newCount)
  if (header === null) return null

  const lines: string[] = []
  switch (file.status) {
    case 'modified':
      lines.push(
        formatDiffGitPair(file.path, file.path, 'modified'),
        `--- ${formatHeaderPath('a/', file.path)}`,
        `+++ ${formatHeaderPath('b/', file.path)}`,
      )
      break
    case 'added':
      lines.push(
        formatDiffGitPair(file.path, file.path, 'added'),
        'new file mode 100644',
        '--- /dev/null',
        `+++ ${formatHeaderPath('b/', file.path)}`,
      )
      break
    case 'deleted':
      lines.push(
        formatDiffGitPair(file.path, file.path, 'deleted'),
        'deleted file mode 100644',
        `--- ${formatHeaderPath('a/', file.path)}`,
        '+++ /dev/null',
      )
      break
    case 'renamed': {
      if (file.oldPath === undefined || !isSafePatchPath(file.oldPath)) return null
      lines.push(
        formatDiffGitPair(file.oldPath, file.path, 'renamed'),
        `rename from ${formatRenamePath(file.oldPath)}`,
        `rename to ${formatRenamePath(file.path)}`,
        `--- ${formatHeaderPath('a/', file.oldPath)}`,
        `+++ ${formatHeaderPath('b/', file.path)}`,
      )
      break
    }
  }

  lines.push(header, ...body.rawLines)
  return `${lines.join('\n')}\n`
}

function safeBacktickFence(text: string): string {
  let maxRun = 2
  let currentRun = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '`') {
      currentRun += 1
      if (currentRun > maxRun) maxRun = currentRun
    } else {
      currentRun = 0
    }
  }
  return '`'.repeat(maxRun + 1)
}

/**
 * Format a line-level review reference and code snippet for appending to the
 * session composer draft.
 * @param relativePath - file path relative to workspace root.
 * @param target - selected line metadata from `ReviewDiff`.
 * @returns markdown reference + fenced diff line block.
 */
export function formatDiffLineComment(relativePath: string, target: ReviewLineCommentTarget): string {
  const prefix = target.kind === 'add' ? '+' : target.kind === 'del' ? '-' : ' '
  const fence = safeBacktickFence(target.text)
  const cleanPath = relativePath.replaceAll('`', '\\`')
  return `L${target.lineNumber} \`${cleanPath}\`\n\n${fence}diff\n${prefix}${target.text}\n${fence}`
}
