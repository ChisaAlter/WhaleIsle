/**
 * The model-facing `grep` tool: search file contents with a ripgrep regular
 * expression. Execution spawns the packaged ripgrep binary
 * (`@vscode/ripgrep`) directly through the subprocess seam with a plain argv
 * vector using a fixed line-oriented `rg --json` command so file path, line
 * number, and line text parse without colon-splitting ambiguity — this module
 * owns the model-facing schema, argument validation, argv construction,
 * `--json` record parsing, per-line preview retention, match retention,
 * grouping, and formatting; process concerns stay behind `ctx.subprocess`.
 *
 * @module @deepseek-ai/dsh-tool-fs-search/grep
 */

import type { Context } from '@deepseek-ai/cordis'
import { ToolArgsError, defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, SearchResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import type { RetainedItems } from '@deepseek-ai/dsh-output-retention'
import type { SpillRef } from '@deepseek-ai/dsh-spill'
import type { GrepMatch } from './search-core.ts'
import { SearchError, previewLine, retainGrepMatches, runRipgrep, toWorkdirRelative, trySaveFormattedResult } from './search-core.ts'
import { grepSearchMeta, searchViewFromMeta } from './presentation.ts'
import { acceptedDirectCallValue } from './direct-call.ts'

/**
 * Default cap on flat matches retained inline by one `grep` call (the
 * `grepMaxMatches` config), matching Claude Code's default `GrepTool`
 * `head_limit`.
 */
export const GREP_MAX_MATCHES = 250

/**
 * Default cap in bytes on one matched-line preview (the `grepMaxLineBytes`
 * config); the cut preserves UTF-8 boundaries.
 */
export const GREP_MAX_LINE_BYTES = 2000

/** Resolved grep-tool caps — plugin config after defaulting (see `Config` in index.ts). */
export interface GrepToolCaps {
  /** Max flat matches retained inline; later matches go to the formatted spill file. */
  maxMatches: number
  /** Max bytes retained per matched-line preview. */
  maxLineBytes: number
  /** Max bytes of serialized `presentationMeta`; trailing file groups drop past it. */
  maxMetaBytes: number
  /** Cap on the complete raw `rg` stdout the tool will parse. */
  rawOutputMaxBytes: number
  /** Terminate-escalation grace period (ms) for the search process. */
  graceMs: number
  /** Cap on the retained stderr diagnostic tail. */
  stderrMaxBytes: number
  /** Cooperative tool-call budget (ms) attached as `ToolDefinition.timeoutMs`. */
  timeoutMs: number
}

export type GrepOutputMode = 'content' | 'files_with_matches' | 'count'

/** Validated `grep` arguments. */
export interface GrepInput {
  pattern: string
  path?: string
  include?: string
  output_mode?: GrepOutputMode
  case_insensitive?: boolean
  context_lines?: number
  head_limit?: number
}

const VALID_OUTPUT_MODES: readonly GrepOutputMode[] = ['content', 'files_with_matches', 'count']

/**
 * Split and validate an `include` glob string: supports a single glob,
 * brace alternation (`*.{ts,tsx}`), negated exclusions (`!*.test.ts`), and
 * comma-separated lists (`*.ts,!*.spec.ts`) outside `{...}` braces. Rejects
 * control characters, unbalanced braces, empty segments, and bare `!`.
 */
function splitIncludeGlobs(include: string): string[] {
  if (include.trim().length === 0) throw new ToolArgsError(['include must be a non-empty glob when given'])
  if (/[\u0000-\u001F\u007F]/.test(include)) throw new ToolArgsError(['include contains invalid control characters'])

  const tokens: string[] = []
  let braceDepth = 0
  let start = 0
  for (let i = 0; i < include.length; i++) {
    const char = include[i]
    if (char === '{') braceDepth++
    else if (char === '}') {
      if (braceDepth === 0) throw new ToolArgsError(['include has unmatched closing brace "}"'])
      braceDepth--
    } else if (char === ',' && braceDepth === 0) {
      tokens.push(include.slice(start, i))
      start = i + 1
    }
  }
  if (braceDepth !== 0) throw new ToolArgsError(['include has unclosed brace "{"'])
  tokens.push(include.slice(start))

  const normalized: string[] = []
  for (const rawToken of tokens) {
    const token = rawToken.trim()
    if (token.length === 0) throw new ToolArgsError(['include list must not contain empty glob segments'])
    if (token.startsWith('!') && token.slice(1).trim().length === 0) {
      throw new ToolArgsError(['include negated glob ("!…") must specify a pattern after "!"'])
    }
    normalized.push(token)
  }
  return normalized
}

/**
 * Validate value constraints the schema DSL can't express: a non-EMPTY
 * `pattern` (whitespace is a legitimate regex), a non-blank `path` when given,
 * validated `include` globs ({@link GrepInput}), and numeric/enum bounds on
 * `output_mode`, `context_lines`, and `head_limit`.
 *
 * @param args - the schema-validated `grep` arguments.
 * @returns the accepted input with an empty `include` omitted.
 */
export function parseGrepArgs(args: {
  pattern: string
  path?: string
  include?: string
  output_mode?: GrepOutputMode
  case_insensitive?: boolean
  context_lines?: number
  head_limit?: number
}): GrepInput {
  if (args.pattern.length === 0) throw new ToolArgsError(['pattern must be a non-empty string'])
  if (args.path !== undefined && args.path.trim().length === 0) throw new ToolArgsError(['path must be a non-empty string when given'])
  const include = args.include === '' ? undefined : args.include
  if (include !== undefined) splitIncludeGlobs(include)
  if (args.output_mode !== undefined && !VALID_OUTPUT_MODES.includes(args.output_mode)) {
    throw new ToolArgsError([`output_mode must be one of: ${VALID_OUTPUT_MODES.join(', ')}`])
  }
  if (args.context_lines !== undefined && (!Number.isInteger(args.context_lines) || args.context_lines < 0)) {
    throw new ToolArgsError(['context_lines must be a non-negative integer'])
  }
  if (args.head_limit !== undefined && (!Number.isInteger(args.head_limit) || args.head_limit < 1)) {
    throw new ToolArgsError(['head_limit must be a positive integer'])
  }
  return {
    pattern: args.pattern,
    ...args.path !== undefined ? { path: args.path } : {},
    ...include !== undefined ? { include } : {},
    ...args.output_mode !== undefined ? { output_mode: args.output_mode } : {},
    ...args.case_insensitive !== undefined ? { case_insensitive: args.case_insensitive } : {},
    ...args.context_lines !== undefined ? { context_lines: args.context_lines } : {},
    ...args.head_limit !== undefined ? { head_limit: args.head_limit } : {},
  }
}

/**
 * Build the fixed line-oriented `rg --json` argv for one `grep` call. Every
 * model-controlled value ({@link GrepInput.pattern}, {@link GrepInput.path},
 * {@link GrepInput.include}) is a plain argv element — no shell layer exists,
 * so no quoting applies; the pattern and include ride in `--flag=value` form
 * and the target behind `--`, so a leading-dash value can never be parsed as
 * a flag.
 *
 * @param input - the validated arguments.
 * @returns the complete ripgrep argument vector (excluding the binary itself).
 */
export function buildGrepCommand(input: GrepInput): string[] {
  const parts = ['--json', `--regexp=${input.pattern}`]
  if (input.case_insensitive) parts.push('--ignore-case')
  const mode = input.output_mode ?? 'content'
  if (mode === 'content' && input.context_lines !== undefined && input.context_lines > 0) {
    parts.push(`--context=${input.context_lines}`)
  }
  if (mode === 'files_with_matches') parts.push('--max-count=1')
  if (input.include !== undefined) {
    for (const glob of splitIncludeGlobs(input.include)) parts.push(`--glob=${glob}`)
  }
  if (input.path !== undefined) parts.push('--', input.path)
  return parts
}

/**
 * The uniform malformed-output failure: raw `rg --json` is an internal
 * transport, so missing or invalid response fields cause a search failure, not a partial result.
 */
function malformedRecord(detail: string, cause?: unknown): SearchError {
  return new SearchError(`grep received malformed ripgrep --json output (${detail})`, 'SEARCH_FAILED', cause !== undefined ? { cause } : undefined)
}

/**
 * Parse one `rg --json` NDJSON line into a match, `undefined` for the
 * non-match record types (`begin`/`end`/`context`/`summary`). A line that is
 * not JSON, or a `match` record missing its path / line number / line content,
 * throws {@link SearchError} `SEARCH_FAILED`. A match whose line is not valid
 * UTF-8 (ripgrep sends base64 `bytes` instead of `text`) yields a placeholder
 * preview rather than failing the whole search.
 */
function parseRecord(line: string, includeContext = false): GrepMatch | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch (error: unknown) {
    throw malformedRecord('a line is not JSON', error)
  }
  if (typeof parsed !== 'object' || parsed === null) throw malformedRecord('a record is not an object')
  const record = parsed as { type?: unknown; data?: unknown }
  const isContext = record.type === 'context'
  if (record.type !== 'match' && !(includeContext && isContext)) return undefined
  if (typeof record.data !== 'object' || record.data === null) throw malformedRecord('a match record has no data')
  const data = record.data as { path?: unknown; line_number?: unknown; lines?: unknown }
  const pathText = typeof data.path === 'object' && data.path !== null ? (data.path as { text?: unknown }).text : undefined
  if (typeof pathText !== 'string') throw malformedRecord('a match record has no path text')
  if (typeof data.line_number !== 'number') throw malformedRecord('a match record has no line number')
  if (typeof data.lines !== 'object' || data.lines === null) throw malformedRecord('a match record has no line content')
  const lines = data.lines as { text?: unknown; bytes?: unknown }
  let lineText: string
  if (typeof lines.text === 'string') {
    lineText = lines.text.replace(/\r?\n$/, '')
  } else if (typeof lines.bytes === 'string') {
    lineText = '(line is not valid UTF-8)'
  } else {
    throw malformedRecord('a match record has neither line text nor bytes')
  }
  return isContext
    ? { path: pathText, lineNumber: data.line_number, line: lineText, isContext: true }
    : { path: pathText, lineNumber: data.line_number, line: lineText }
}

/**
 * Parse complete `rg --json` stdout into flat matches (and optionally context
 * lines when `includeContext` is true), in output order.
 *
 * @param stdout - the complete raw `rg --json` stdout.
 * @param includeContext - when true, also parses `context` records emitted by `--context`.
 * @returns the flat matches; empty for output with no match records.
 */
export function parseGrepMatches(stdout: string, includeContext = false): GrepMatch[] {
  const matches: GrepMatch[] = []
  for (const line of stdout.split('\n')) {
    if (line.length === 0) continue
    const match = parseRecord(line, includeContext)
    if (match !== undefined) matches.push(match)
  }
  return matches
}

/** `match` / `matches` for a count. */
function matchNoun(count: number): string {
  return count === 1 ? 'match' : 'matches'
}

/**
 * Group flat matches by file (first-seen order) into the model-facing body:
 * each file's display path, then one `Line N: <text>` row per match.
 *
 * @param matches - the flat matches to render.
 * @returns the grouped body text.
 */
export function formatGrepMatches(matches: GrepMatch[]): string {
  const byFile = new Map<string, GrepMatch[]>()
  for (const match of matches) {
    const group = byFile.get(match.path)
    if (group !== undefined) group.push(match)
    else byFile.set(match.path, [match])
  }
  const sections: string[] = []
  for (const [path, group] of byFile) {
    sections.push(`${path}\n${group.map(m => m.isContext ? `Line ${m.lineNumber} (context): ${m.line}` : `Line ${m.lineNumber}: ${m.line}`).join('\n')}`)
  }
  return sections.join('\n\n')
}

export interface GrepFileCount {
  path: string
  count: number
}

export interface GrepValue {
  matches: GrepMatch[]
  mode?: GrepOutputMode
  files?: string[]
  counts?: GrepFileCount[]
  totalBeforeHeadLimit?: number
  rawTruncated?: boolean
}

function rawTruncatedFooter(caps: GrepToolCaps): string {
  return `(Raw ripgrep output reached the ${caps.rawOutputMaxBytes}-byte cap and was stopped early; returning captured prefix results. Narrow pattern, path, or include to see complete results.)`
}

function formatGrepListResult(
  items: readonly string[],
  maxItems: number,
  total: number,
  unit: 'file' | 'files',
  spillRef: SpillRef | undefined,
  headerOverride?: string,
  rawSuffix = '',
): string {
  const capped = items.slice(0, maxItems)
  const truncated = items.length > maxItems || total > items.length
  const plural = (n: number): string => n === 1 ? 'file' : unit
  const header = headerOverride ?? (
    truncated
      ? `Found ${capped.length} of ${total} matching ${plural(total)}`
      : `Found ${capped.length} matching ${plural(capped.length)}`
  )
  const spillNote = items.length > maxItems
    ? `\n\n(${spillRef !== undefined ? `Full grep result stored at: ${spillRef.locator}. ${spillRef.retrievalHint}` : 'The complete result could not be saved; narrow pattern, path, or include to see more.'})`
    : ''
  return `${header}\n\n${capped.join('\n')}${spillNote}${rawSuffix}`
}

/** Format the model-facing `grep` result across `content`, `files_with_matches`, and `count` modes. */
function renderGrepValue(value: GrepValue, caps: GrepToolCaps, spillRef?: SpillRef): string {
  const rawSuffix = value.rawTruncated ? `\n\n${rawTruncatedFooter(caps)}` : ''
  const mode = value.mode ?? 'content'
  if (mode === 'files_with_matches') {
    const files = value.files ?? []
    if (files.length === 0) return value.rawTruncated ? rawTruncatedFooter(caps) : 'No matches found'
    return formatGrepListResult(files, caps.maxMatches, value.totalBeforeHeadLimit ?? files.length, 'files', spillRef, undefined, rawSuffix)
  }
  if (mode === 'count') {
    const counts = value.counts ?? []
    if (counts.length === 0) return value.rawTruncated ? rawTruncatedFooter(caps) : 'No matches found'
    const totalMatches = counts.reduce((sum, item) => sum + item.count, 0)
    const totalFiles = value.totalBeforeHeadLimit ?? counts.length
    const truncated = counts.length > caps.maxMatches || totalFiles > counts.length
    const header = truncated
      ? undefined
      : `Found ${totalMatches} ${matchNoun(totalMatches)} across ${counts.length} ${counts.length === 1 ? 'file' : 'files'}`
    return formatGrepListResult(
      counts.map(item => `${item.path}: ${item.count}`),
      caps.maxMatches,
      totalFiles,
      'files',
      spillRef,
      header,
      rawSuffix,
    )
  }

  const retained = retainGrepMatches(value.matches, caps.maxMatches, caps.maxLineBytes)
  if (retained.seen === 0) {
    return value.rawTruncated ? rawTruncatedFooter(caps) : 'No matches found'
  }
  if (!retained.truncated && value.totalBeforeHeadLimit !== undefined && value.totalBeforeHeadLimit > retained.seen) {
    const body = formatGrepMatches(retained.items)
    return `Found ${retained.seen} of ${value.totalBeforeHeadLimit} ${matchNoun(value.totalBeforeHeadLimit)}\n\n${body}${rawSuffix}`
  }
  return `${formatGrepOutput(retained, spillRef)}${rawSuffix}`
}

/**
 * Format the model-facing `grep` result: a found-count header, the retained
 * matches grouped by file, then — when the result was capped — a footer
 * carrying either the formatted-spill recovery locator or the could-not-save
 * explanation. The omitted count is a budget fact: the search itself completed.
 *
 * @param retained - the retention outcome over every parsed match.
 * @param spillRef - the saved complete-result reference, or `undefined` when unsaved.
 * @returns the model-facing text.
 */
export function formatGrepOutput(retained: RetainedItems<GrepMatch>, spillRef: SpillRef | undefined): string {
  const header = retained.truncated
    ? `Found ${retained.kept} of ${retained.seen} matches`
    : `Found ${retained.seen} ${matchNoun(retained.seen)}`
  const body = formatGrepMatches(retained.items)
  if (!retained.truncated) return `${header}\n\n${body}`
  const recovery = spillRef !== undefined
    ? `Full grep result stored at: ${spillRef.locator}. ${spillRef.retrievalHint}`
    : 'The complete result could not be saved; narrow pattern, path, or include to see more.'
  return `${header}\n\n${body}\n\n(${recovery})`
}

/**
 * Pending-call presentation: a search card titled by the pattern (and target /
 * include filter). An exact empty include contributes no filter suffix.
 *
 * @param args - the raw tool arguments; `pattern`, `path`, and `include` feed the title.
 * @returns the generic card view (`kind: 'search'`) shown while the call runs.
 */
export function presentGrepCall(args: { pattern: string; path?: string; include?: string }): GenericCallView {
  const where = args.path !== undefined ? ` in ${args.path}` : ''
  const filter = args.include !== undefined && args.include !== '' ? ` (${args.include})` : ''
  return { card: 'generic', title: `Grep ${args.pattern}${where}${filter}`, kind: 'search', rawInput: args.pattern }
}

/**
 * Completed-call presentation: the search card projected from the result's
 * `presentationMeta` (matches grouped by file, with the truncation signal). A UI
 * without a search card falls back to the raw `tool/result` content, so the view
 * carries no result text of its own. Malformed or absent metadata (an obsolete or
 * hand-edited replayed log) falls back to the generic card.
 *
 * @param _args - the raw tool arguments; unused, the view derives from the result.
 * @param result - the final model-facing tool result carrying the projected metadata.
 * @returns the search card view, or `undefined` for the generic fallback.
 */
export function presentGrepResult(
  _args: { pattern: string; path?: string; include?: string },
  result: ToolResult,
): SearchResultView | undefined {
  if (result.isError) return undefined
  const view = searchViewFromMeta(result.meta)
  if (view === undefined || view.shape !== 'matches') return undefined
  return view
}

/**
 * Register the `grep` tool and its scope-aware system-prompt guidance.
 *
 * @param ctx - the plugin context; registrations are effects scoped to it, and
 *   execution uses its `subprocess` service.
 * @param caps - the deployment's resolved grep caps (plugin config after defaulting).
 */
export function applyGrepTool(ctx: Context, caps: GrepToolCaps): void {
  ctx.systemPrompt.section({
    name: 'tool:grep',
    order: ctx.systemPrompt.getSectionOrder('TOOL_GREP'),
    text: ({ scope }) => ctx.tools.get('grep', scope) === undefined
      ? ''
      : 'Use the grep tool — not shell grep or rg — to search file contents.'
        + (ctx.tools.get('read', scope) === undefined ? '' : ' Use read on a matched file when you need surrounding context.'),
    retirement: 'The grep tool is no longer available. Its guidance no longer applies.',
  })

  const tool = defineTool({
    name: 'grep',
    description: 'Search file contents with a ripgrep regular expression. Supports content lines (with optional context_lines), files_with_matches, count, case_insensitive, head_limit, and glob lists/exclusions in include. '
      + `Returns up to ${caps.maxMatches} matches; a larger result reports where the complete match list was saved.`,
    parameters: {
      pattern: { type: 'string', required: true, description: 'Regular expression to search for (ripgrep syntax).' },
      path: { type: 'string', description: 'File or directory to search. Defaults to the session workspace; a relative path resolves against it.' },
      include: { type: 'string', description: 'Glob filter(s) for which files to search, supporting brace alternation, comma-separated globs, and "!" exclusions (e.g. "*.ts,!*.test.ts").' },
      output_mode: { type: 'string', enum: ['content', 'files_with_matches', 'count'], description: 'Output mode: "content" (matching lines, default), "files_with_matches" (file paths only), or "count" (match counts per file).' },
      case_insensitive: { type: 'boolean', description: 'Enable case-insensitive matching (-i).' },
      context_lines: { type: 'integer', description: 'Number of leading and trailing context lines around each match (-C) in content mode.' },
      head_limit: { type: 'integer', description: 'Limit output to the first N matches (content mode) or N files (files_with_matches/count modes).' },
    },
    timeoutMs: caps.timeoutMs,
    // Matches record no file observation; over-cap spilling runs in model-ordered post-execute.
    isConcurrencySafe: () => true,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          matches: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                lineNumber: { type: 'integer', required: true },
                line: { type: 'string', required: true },
                isContext: { type: 'boolean' },
              },
            },
          },
          mode: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          counts: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                count: { type: 'integer', required: true },
              },
            },
          },
          totalBeforeHeadLimit: { type: 'integer' },
          rawTruncated: { type: 'boolean' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderGrepValue(value as GrepValue, caps) }],
      presentationMeta: (_args, value) => {
        const retained = retainGrepMatches(value.matches, caps.maxMatches, caps.maxLineBytes)
        return grepSearchMeta(
          value.rawTruncated ? { ...retained, truncated: true } : retained,
          caps.maxMetaBytes,
        )
      },
    },
    async execute(args, exec) {
      const input = parseGrepArgs(args)
      const mode = input.output_mode ?? 'content'
      const includeContext = mode === 'content' && (input.context_lines ?? 0) > 0
      const run = await runRipgrep(ctx, exec, 'grep', buildGrepCommand(input), caps.rawOutputMaxBytes, caps.graceMs, caps.stderrMaxBytes)
      if (run.noMatches) {
        if (mode === 'files_with_matches') return { matches: [], mode, files: [] }
        if (mode === 'count') return { matches: [], mode, counts: [] }
        return { matches: [] }
      }

      const all: GrepMatch[] = []
      for (const raw of parseGrepMatches(run.stdout, includeContext)) {
        const match: GrepMatch = {
          path: toWorkdirRelative(raw.path, run.workdir),
          lineNumber: raw.lineNumber,
          line: raw.line,
          ...raw.isContext ? { isContext: true } : {},
        }
        all.push(match)
      }

      if (mode === 'files_with_matches') {
        const byFile = new Map<string, GrepMatch>()
        for (const m of all) {
          if (!byFile.has(m.path)) byFile.set(m.path, m)
        }
        const allMatches = [...byFile.values()]
        const matches = input.head_limit !== undefined ? allMatches.slice(0, input.head_limit) : allMatches
        const files = matches.map(m => m.path)
        return {
          matches,
          mode,
          files,
          ...allMatches.length > files.length ? { totalBeforeHeadLimit: allMatches.length } : {},
          ...run.rawTruncated ? { rawTruncated: true } : {},
        }
      }

      if (mode === 'count') {
        const countsByFile = new Map<string, number>()
        const repMatch = new Map<string, GrepMatch>()
        for (const m of all) {
          if (m.isContext) continue
          countsByFile.set(m.path, (countsByFile.get(m.path) ?? 0) + 1)
          if (!repMatch.has(m.path)) repMatch.set(m.path, m)
        }
        const allCounts: GrepFileCount[] = Array.from(countsByFile, ([path, count]) => ({ path, count }))
        const counts = input.head_limit !== undefined ? allCounts.slice(0, input.head_limit) : allCounts
        const allowed = new Set(counts.map(item => item.path))
        const matches = all.filter(m => allowed.has(m.path))
        return {
          matches,
          mode,
          counts,
          ...allCounts.length > counts.length ? { totalBeforeHeadLimit: allCounts.length } : {},
          ...run.rawTruncated ? { rawTruncated: true } : {},
        }
      }

      const limited = input.head_limit !== undefined ? all.slice(0, input.head_limit) : all
      return {
        matches: limited,
        ...all.length > limited.length ? { totalBeforeHeadLimit: all.length } : {},
        ...run.rawTruncated ? { rawTruncated: true } : {},
      }
    },
    presentCall: presentGrepCall,
    presentResult: presentGrepResult,
  })
  ctx.tools.register(tool)

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    const value = acceptedDirectCallValue(ctx, tool, exec, result, decision) as GrepValue | undefined
    if (value === undefined) return decision
    const mode = value.mode ?? 'content'
    if (mode === 'files_with_matches') {
      const files = value.files ?? []
      if (files.length <= caps.maxMatches) return decision
      const spillRef = await trySaveFormattedResult(
        ctx,
        exec,
        'grep-results.txt',
        `Found ${files.length} matching ${files.length === 1 ? 'file' : 'files'}\n\n${files.join('\n')}`,
      )
      return {
        kind: 'accept',
        content: [{ type: 'text', text: renderGrepValue(value, caps, spillRef) }],
        ...decision.additionalContexts !== undefined ? { additionalContexts: decision.additionalContexts } : {},
      }
    }
    if (mode === 'count') {
      const counts = value.counts ?? []
      if (counts.length <= caps.maxMatches) return decision
      const total = counts.reduce((sum, item) => sum + item.count, 0)
      const spillRef = await trySaveFormattedResult(
        ctx,
        exec,
        'grep-results.txt',
        `Found ${total} ${matchNoun(total)} across ${counts.length} ${counts.length === 1 ? 'file' : 'files'}\n\n${counts.map(item => `${item.path}: ${item.count}`).join('\n')}`,
      )
      return {
        kind: 'accept',
        content: [{ type: 'text', text: renderGrepValue(value, caps, spillRef) }],
        ...decision.additionalContexts !== undefined ? { additionalContexts: decision.additionalContexts } : {},
      }
    }
    const matches = value.matches
    if (matches.length <= caps.maxMatches) return decision
    // The spill artifact holds the COMPLETE result: preview each line, but keep
    // every match (no inline cap), so the recovery file is the full search.
    const previewedAll = matches.map(match => ({ ...match, line: previewLine(match.line, caps.maxLineBytes) }))
    const spillRef = await trySaveFormattedResult(
      ctx,
      exec,
      'grep-results.txt',
      `Found ${matches.length} ${matchNoun(matches.length)}\n\n${formatGrepMatches(previewedAll)}`,
    )
    return {
      kind: 'accept',
      content: [{
        type: 'text',
        text: renderGrepValue(value, caps, spillRef),
      }],
      ...decision.additionalContexts !== undefined ? { additionalContexts: decision.additionalContexts } : {},
    }
  })
}
