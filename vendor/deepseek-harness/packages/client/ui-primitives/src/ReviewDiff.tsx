/**
 * Shared file-comparison presentation: numbered unified/split rows, wrap and
 * scroll-synced columns, and cancellable chunked highlighting. Takes plain
 * hunk data and localized strings — no host queries, git actions, or feature
 * locales — so any comparison surface can render it.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode, UIEvent } from 'react'
import {
  grammarLoadCount, highlighterWarmed, StreamingHighlightSession, subscribeGrammarLoaded, warmHighlighter,
} from './markdown/highlight.ts'
import { dispatchHighlightJobs } from './markdown/highlight-jobs.ts'
import type { HighlightSpan } from './code-highlighting.ts'
import css from './ReviewDiff.module.css'

/** Maximum rendered lines per comparison; further hunk content truncates with a note. */
export const MAX_RENDERED_LINES = 5000

/** Default per-chunk line budget when progressive expansion is enabled. */
export const DEFAULT_PROGRESSIVE_CHUNK_LINES = 400

/**
 * A unified-diff hunk in the shape every comparison surface can produce:
 * a display header and prefixed body lines. Line numbers start from
 * `oldStart`/`newStart` when present; a hunk without starts renders rows
 * without numbers rather than invented ones.
 */
export interface ReviewHunk {
  /** The `@@` line drawn verbatim above the body; synthesized from the starts when absent. */
  header?: string | undefined
  /** First line of the hunk on the old side, 1-based. */
  oldStart?: number | undefined
  /** Lines of the hunk taken from the old side (header synthesis only). */
  oldLines?: number | undefined
  /** First line of the hunk on the new side, 1-based. */
  newStart?: number | undefined
  /** Lines of the hunk taken from the new side (header synthesis only). */
  newLines?: number | undefined
  /** Body lines in order, each prefixed `+`, `-`, ` `, or `\` (end-of-file annotation). */
  lines: readonly string[]
}

/** One drawn line of a hunk with its line numbers on each side. */
export interface DiffRow {
  kind: 'add' | 'del' | 'context' | 'eof'
  old: number | undefined
  new: number | undefined
  text: string
}

/** One side-by-side row: the old side, the new side, both, or an end-of-file annotation. */
export interface SplitRow {
  left?: { no: number | undefined; text: string; kind: 'del' | 'context' }
  right?: { no: number | undefined; text: string; kind: 'add' | 'context' }
  /** A `\` annotation line drawn full-width; it annotates the row above. */
  eof?: string
}

/** Per-hunk token runs keyed by side line number; `undefined` entries render plain text. */
export interface HunkHighlights {
  old: ReadonlyMap<number, readonly HighlightSpan[]> | undefined
  new: ReadonlyMap<number, readonly HighlightSpan[]> | undefined
}

/**
 * Number a hunk's lines: context lines count on both sides, deletions on the
 * old side, additions on the new side. `\` annotation lines carry no number.
 * @param hunk - a served hunk.
 * @returns the rows in order.
 */
export function hunkRows(hunk: ReviewHunk): DiffRow[] {
  let oldNo = hunk.oldStart
  let newNo = hunk.newStart
  const rows: DiffRow[] = []
  for (const line of hunk.lines) {
    const text = line.slice(1)
    switch (line[0]) {
      case '+': rows.push({ kind: 'add', old: undefined, new: newNo === undefined ? undefined : newNo++, text }); break
      case '-': rows.push({ kind: 'del', old: oldNo === undefined ? undefined : oldNo++, new: undefined, text }); break
      case '\\': rows.push({ kind: 'eof', old: undefined, new: undefined, text: text.trim() }); break
      default: rows.push({ kind: 'context', old: oldNo === undefined ? undefined : oldNo++, new: newNo === undefined ? undefined : newNo++, text }); break
    }
  }
  return rows
}

/**
 * Pair a hunk's lines for the side-by-side view: each run of deletions is
 * aligned with the run of additions that follows it, row by row, and context
 * lines sit on both sides. `\` annotations become full-width marker rows.
 * @param hunk - a served hunk.
 * @returns the rows in order.
 */
export function splitRows(hunk: ReviewHunk): SplitRow[] {
  const rows: SplitRow[] = []
  let dels: NonNullable<SplitRow['left']>[] = []
  let adds: NonNullable<SplitRow['right']>[] = []
  const flush = (): void => {
    for (let at = 0; at < Math.max(dels.length, adds.length); at += 1) {
      const left = dels[at]
      const right = adds[at]
      rows.push({ ...left === undefined ? {} : { left }, ...right === undefined ? {} : { right } })
    }
    dels = []
    adds = []
  }
  for (const row of hunkRows(hunk)) {
    if (row.kind === 'eof') {
      flush()
      rows.push({ eof: row.text })
      continue
    }
    if (row.kind === 'del') dels.push({ no: row.old, text: row.text, kind: 'del' })
    else if (row.kind === 'add') adds.push({ no: row.new, text: row.text, kind: 'add' })
    else {
      flush()
      rows.push({ left: { no: row.old, text: row.text, kind: 'context' }, right: { no: row.new, text: row.text, kind: 'context' } })
    }
  }
  flush()
  return rows
}

/**
 * The hunks to draw, cut at `budget` lines in total.
 * @param hunks - served hunks.
 * @param budget - total body lines allowed; defaults to {@link MAX_RENDERED_LINES}.
 * @returns the hunks with the last one shortened as needed, and whether anything was cut.
 */
export function renderedHunks(hunks: readonly ReviewHunk[], budget = MAX_RENDERED_LINES): { hunks: ReviewHunk[]; truncated: boolean } {
  let left = budget
  const kept: ReviewHunk[] = []
  for (const hunk of hunks) {
    if (left === 0) return { hunks: kept, truncated: true }
    kept.push(hunk.lines.length <= left ? hunk : { ...hunk, lines: hunk.lines.slice(0, left) })
    left -= Math.min(left, hunk.lines.length)
  }
  return { hunks: kept, truncated: hunks.some((hunk, at) => kept[at] !== hunk) }
}

/** Total body lines a hunk would mount, for caller-side budgets across multiple files. */
export function hunkLineCount(hunk: ReviewHunk): number {
  return hunk.lines.length
}

function hunkHeader(hunk: ReviewHunk): string {
  if (hunk.header !== undefined) return hunk.header
  if (hunk.oldStart === undefined || hunk.newStart === undefined) return ''
  return `@@ -${hunk.oldStart},${hunk.oldLines ?? 0} +${hunk.newStart},${hunk.newLines ?? 0} @@`
}

/** The kind a paired row carries: a deletion or addition on either side, otherwise context. */
function splitRowKind(row: SplitRow): DiffRow['kind'] {
  if (row.eof !== undefined) return 'eof'
  return row.left?.kind === 'del' ? 'del' : row.right?.kind === 'add' ? 'add' : 'context'
}

/** Per-task main-thread budget for one highlighting slice, under the 50 ms design rule. */
export const HIGHLIGHT_SLICE_MS = 15
/**
 * Upper bound on source lines one task tick tokenizes. The effective chunk
 * shrinks adaptively: each job tracks its measured per-line cost and the next
 * chunk is sized to fit the remaining {@link HIGHLIGHT_SLICE_MS} budget, so
 * one slice overshoots by at most one line's tokenize — a side never becomes
 * one long task.
 */
export const HIGHLIGHT_CHUNK_LINES = 100
/** A hunk side beyond either bound skips highlighting and stays plain text. */
export const HIGHLIGHT_MAX_LINES = 2000
export const HIGHLIGHT_MAX_CHARS = 512 * 1024
/** A side containing one line this long skips highlighting: tokenizing it would be one unbounded task. */
export const HIGHLIGHT_MAX_LINE_CHARS = 8 * 1024

/** Performance-observer mark for queued highlight jobs dropped by newer input; `detail` is the job count. */
const DISCARD_MARK = 'dsh.reviewDiff.discard'
/** Performance-observer measure for one highlighting slice's main-thread task span. */
const SLICE_MEASURE = 'dsh.reviewDiff.slice'
/** Performance-observer mark carrying a worker-side tokenize duration; `detail.workMs`, evidence only. */
const WORKER_MARK = 'dsh.reviewDiff.worker'

/**
 * Mark/measure the slice and discard events when the Performance API exposes
 * entry buffers; a runtime without them renders identically, just unobserved.
 */
function observeHighlight(label: 'mark' | 'measure', name: string, options?: object): void {
  try {
    if (label === 'mark') performance.mark(name, options)
    else performance.measure(name, options as { start: number; end: number })
  } catch {
    // Non-buffered performance implementations (older jsdom) skip observability only.
  }
}

/** The numbered source lines one side of one hunk contributes, or `undefined` when the side is empty. */
function sideSource(hunk: ReviewHunk, side: 'old' | 'new'): { no: number; text: string }[] | undefined {
  const source = hunkRows(hunk).flatMap((row) => {
    const no = row[side]
    return no === undefined ? [] : [{ no, text: row.text }]
  })
  return source.length === 0 ? undefined : source
}

function sideWithinBudget(source: readonly { text: string }[]): boolean {
  if (source.length > HIGHLIGHT_MAX_LINES) return false
  let chars = 0
  for (const line of source) {
    if (line.text.length > HIGHLIGHT_MAX_LINE_CHARS) return false
    chars += line.text.length + 1
    if (chars > HIGHLIGHT_MAX_CHARS) return false
  }
  return true
}

/**
 * One hunk side's highlight work: the joined source text plus the line
 * numbers its token runs map back onto. Shared by the Worker dispatch and the
 * inline fallback; only the fallback grows a session cursor onto it.
 */
interface SideWork {
  /** Index into the surrounding `works` array — the `job` id the worker replies with. */
  index: number
  hunk: number
  side: 'old' | 'new'
  code: string
  lineNos: readonly number[]
}

/**
 * A resumable inline tokenize job. `StreamingHighlightSession` resumes from
 * the grammar state after the consumed prefix, so each tick tokenizes only
 * its own slice — a side never becomes one long task.
 */
interface SideJob extends SideWork {
  session: StreamingHighlightSession
  ends: readonly number[]
  cursor: number
  /** EMA of measured tokenize milliseconds per line; starts pessimistic so JIT-cold first chunks stay bounded. */
  perLine: number
}

/** Offset just past each line's terminator (or the code end for the last line). */
function lineEnds(code: string, count: number): number[] {
  const ends: number[] = []
  let from = 0
  while (ends.length < count && from <= code.length) {
    const newline = code.indexOf('\n', from)
    if (newline === -1) { ends.push(code.length); break }
    ends.push(newline + 1)
    from = newline + 1
  }
  return ends
}

function sideWork(index: number, hunkAt: number, side: 'old' | 'new', source: readonly { no: number; text: string }[]): SideWork {
  return {
    index,
    hunk: hunkAt,
    side,
    code: source.map(line => line.text).join('\n'),
    lineNos: source.map(line => line.no),
  }
}

/** Grow an inline job onto shared work data; the worker path never builds these. */
function sideJob(work: SideWork): SideJob {
  return {
    ...work,
    session: new StreamingHighlightSession(),
    ends: lineEnds(work.code, work.lineNos.length),
    cursor: 0,
    perLine: 1.5,
  }
}

/**
 * Background-priority scheduling, falling back to a macrotask where the
 * Scheduler API is unavailable. Slice work must not outrank the platform's
 * own warmup tasks: a user-visible timer could run before them and pay the
 * one-time grammar scanner build inside a measured slice.
 */
function scheduleSlice(run: () => void): void {
  const scheduler = (globalThis as {
    scheduler?: { postTask?: (cb: () => void, opts?: { priority?: string }) => unknown }
  }).scheduler
  if (typeof scheduler?.postTask === 'function') {
    try {
      scheduler.postTask(run, { priority: 'background' })
      return
    } catch {
      // Fall through to the timer arm.
    }
  }
  setTimeout(run, 0)
}

/**
 * Highlight hunks on a cancellable schedule: rows mount as plain text first,
 * then token runs land progressively so no single main-thread task owns the
 * comparison. Each side of a hunk is one job. With a `Worker` available the
 * jobs run off-thread (`./markdown/highlight-jobs.ts` — the per-rule scanner
 * build inside a first tokenize is one indivisible ~50-200 ms call that no
 * inline slicing can interrupt, so the shipped path goes through the worker);
 * without one, an inline fallback resumes a `StreamingHighlightSession` per
 * side in {@link HIGHLIGHT_SLICE_MS} slices. A side over
 * {@link HIGHLIGHT_MAX_LINES} / {@link HIGHLIGHT_MAX_CHARS} /
 * {@link HIGHLIGHT_MAX_LINE_CHARS} stays plain and sets `skipped`. A new
 * `hunks`/`language`/loaded-grammar input discards stale work — the returned
 * array is always aligned with the current hunks (missing entries render
 * unhighlighted).
 * @param hunks - the rendered hunks.
 * @param language - grammar hint for the shared highlighter.
 * @returns per-hunk highlights plus whether any hunk side exceeded the highlight budget.
 */
export function useReviewHighlights(hunks: readonly ReviewHunk[], language: string | undefined): {
  highlights: readonly (HunkHighlights | undefined)[]
  skipped: boolean
} {
  const loaded = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount, grammarLoadCount)
  const cache = useRef<{ source: readonly ReviewHunk[]; results: readonly (HunkHighlights | undefined)[]; skipped: boolean }>()
  const [, bump] = useState(0)
  useEffect(() => {
    const results: (HunkHighlights | undefined)[] = new Array(hunks.length)
    const works: SideWork[] = []
    let skipped = false
    if (language !== undefined) {
      hunks.forEach((hunk, hunkAt) => {
        for (const side of ['old', 'new'] as const) {
          const source = sideSource(hunk, side)
          if (source === undefined) continue
          if (!sideWithinBudget(source)) { skipped = true; continue }
          works.push(sideWork(works.length, hunkAt, side, source))
        }
      })
    }
    let cancelled = false
    /** Work indexes whose apply already landed; the failure fallback runs the rest inline. */
    const applied = new Set<number>()
    const commit = (): void => {
      cache.current = { source: hunks, results: results.slice(), skipped }
      bump(n => n + 1)
    }
    const applySpans = (workIndex: number, spans: readonly HighlightSpan[][] | undefined): void => {
      const work = works[workIndex]
      if (work === undefined) return
      applied.add(workIndex)
      const entry: HunkHighlights = results[work.hunk] ?? { old: undefined, new: undefined }
      entry[work.side] = spans === undefined ? undefined : new Map(work.lineNos.map((no, index) => {
        // Shiki omits one terminal empty token row; retain an aligned empty run for that source line.
        return [no, spans[index] ?? []] as const
      }))
      results[work.hunk] = entry
      commit()
    }
    const startInline = (pending: readonly number[]): void => {
      const jobs = pending.map(workIndex => sideJob(works[workIndex]!))
      const step = (): void => {
        if (cancelled) return
        const started = performance.now()
        while (jobs.length > 0 && performance.now() - started < HIGHLIGHT_SLICE_MS) {
          const job = jobs[0]!
          const fit = Math.floor((HIGHLIGHT_SLICE_MS - (performance.now() - started)) / job.perLine)
          const take = Math.max(1, Math.min(fit, HIGHLIGHT_CHUNK_LINES, job.ends.length - job.cursor))
          const target = job.cursor + take
          const end = job.ends[target - 1] ?? job.code.length
          const chunkAt = performance.now()
          job.session.updateFrame(job.code.slice(0, end), language)
          job.cursor = target
          job.perLine = Math.min(20, Math.max(0.05, job.perLine * 0.5 + ((performance.now() - chunkAt) / take) * 0.5))
          if (job.cursor < job.ends.length) continue
          applySpans(job.index, job.session.update(job.code, language))
          jobs.shift()
        }
        if (cancelled) return
        observeHighlight('measure', SLICE_MEASURE, { start: started, end: performance.now() })
        if (jobs.length > 0) scheduleSlice(step)
      }
      // The shared engine's one-time grammar construction belongs to the
      // platform's own warmup tasks, not to a slice the reader is measured by.
      warmHighlighter()
      void highlighterWarmed().then(() => { if (!cancelled) scheduleSlice(step) })
    }
    if (works.length === 0) {
      commit()
      return () => { cancelled = true }
    }
    const pendingIndexes = (): number[] =>
      works.map(work => work.index).filter(index => !applied.has(index))
    const run = dispatchHighlightJobs(
      works.map(work => ({ code: work.code, ...(language === undefined ? {} : { lang: language }) })), {
      cancelled: () => cancelled,
      apply: (job, spans, workMs) => {
        if (cancelled) return
        const started = performance.now()
        applySpans(job, spans)
        observeHighlight('measure', SLICE_MEASURE, { start: started, end: performance.now() })
        observeHighlight('mark', WORKER_MARK, { detail: { workMs } })
      },
      failed: () => { if (!cancelled) startInline(pendingIndexes()) },
    })
    if (run === undefined) startInline(pendingIndexes())
    return () => {
      cancelled = true
      run?.cancel()
      const pending = pendingIndexes().length
      if (pending > 0) observeHighlight('mark', DISCARD_MARK, { detail: pending })
    }
  }, [hunks, language, loaded])
  const current = cache.current !== undefined && cache.current.source === hunks ? cache.current : undefined
  return { highlights: current?.results ?? EMPTY_HIGHLIGHTS, skipped: current?.skipped ?? false }
}

const EMPTY_HIGHLIGHTS: readonly (HunkHighlights | undefined)[] = []

function DiffText({ text, spans }: { text: string; spans: readonly HighlightSpan[] | undefined }): ReactNode {
  return <span className={css.text} data-diff-code={spans === undefined ? undefined : ''}>
    {spans === undefined ? text : spans.map((span, index) => <span key={index} style={span.style}>{span.text}</span>)}
  </span>
}

/** A localized note paragraph above the comparison body. */
export interface ReviewNote {
  /** Text drawn in the note style. */
  text: string
  /** Extra attributes on the paragraph (`data-*` markers tests and consumers rely on). */
  attrs?: Record<string, string>
}

/** Target metadata passed when triggering a line-level comment action on a diff row. */
export interface ReviewLineCommentTarget {
  /** 1-based line number on the target side (`new` for add/context, `old` for del). */
  lineNumber: number
  /** Which file side owns `lineNumber`. */
  side: 'old' | 'new'
  /** Unified diff line kind. */
  kind: 'add' | 'del' | 'context'
  /** Line content without the leading diff prefix. */
  text: string
  /** Complete enclosing hunk. */
  hunk: ReviewHunk
}

/** Props accepted by {@link ReviewDiff}. */
export interface ReviewDiffProps {
  /** Served hunks; each keeps its own header or gets one synthesized. */
  hunks: readonly ReviewHunk[]
  /** Grammar hint for highlighting; unknown or loading grammars render plain text. */
  language?: string | undefined
  /** Requested side-by-side layout; one-sided comparisons always draw unified. */
  split: boolean
  /** Wrap long lines instead of clipping them behind synced columns. */
  wrap: boolean
  /** Localized note paragraphs above the hunks (created/deleted/unchanged/coarse and the like). */
  notes?: readonly ReviewNote[] | undefined
  /** Localized line shown when the body hit {@link MAX_RENDERED_LINES}. */
  truncatedNote?: string | undefined
  /** Localized line shown when any hunk skipped highlighting over the budget. */
  skippedNote?: string | undefined
  /** Optional hunk header action slot rendered in both unified and split views. */
  renderHunkActions?: ((hunk: ReviewHunk, index: number) => ReactNode) | undefined
  /** Optional callback triggered by the hover/focus line comment button. */
  onLineComment?: ((target: ReviewLineCommentTarget) => void) | undefined
  /** Accessible label for the line comment button. */
  lineCommentLabel?: string | undefined
  /** Optional chunk size for progressive rendering; defaults to rendering all kept lines. */
  progressiveChunkLines?: number | undefined
  /** Label or formatter for revealing the next progressive chunk. */
  showMoreLabel?: string | ((remaining: number, nextCount: number) => string) | undefined
  /** Label or formatter for expanding all remaining kept lines at once. */
  expandRemainingLabel?: string | ((remaining: number) => string) | undefined
}

function unifiedCommentTarget(row: DiffRow, hunk: ReviewHunk): ReviewLineCommentTarget | undefined {
  switch (row.kind) {
    case 'add':
      return row.new === undefined ? undefined : { lineNumber: row.new, side: 'new', kind: 'add', text: row.text, hunk }
    case 'del':
      return row.old === undefined ? undefined : { lineNumber: row.old, side: 'old', kind: 'del', text: row.text, hunk }
    case 'context': {
      const side = row.new !== undefined ? 'new' : 'old'
      const lineNumber = side === 'new' ? row.new : row.old
      return lineNumber === undefined ? undefined : { lineNumber, side, kind: 'context', text: row.text, hunk }
    }
    case 'eof':
      return undefined
  }
}

function splitCellCommentTarget(
  cell: NonNullable<SplitRow['left']> | NonNullable<SplitRow['right']> | undefined,
  side: 'old' | 'new',
  hunk: ReviewHunk,
): ReviewLineCommentTarget | undefined {
  if (cell === undefined || cell.no === undefined) return undefined
  return { lineNumber: cell.no, side, kind: cell.kind, text: cell.text, hunk }
}

function LineCommentTrigger({
  label,
  target,
  onComment,
}: {
  label: string
  target: ReviewLineCommentTarget | undefined
  onComment: ((target: ReviewLineCommentTarget) => void) | undefined
}): ReactNode {
  if (onComment === undefined || target === undefined) return null
  return (
    <button
      type="button"
      className={css.lineCommentBtn}
      data-diff-line-comment
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation()
        onComment(target)
      }}
    >
      +
    </button>
  )
}

/**
 * The side-by-side view without wrapping: two columns that clip their long
 * lines and scroll together on both axes, so a long line on one side never
 * runs under the other and both sides show the same rows and columns of text.
 * Every line is one fixed-height row, which keeps the sides aligned.
 * The columns suppress elastic overscroll while retaining native in-range scrolling.
 */
function SplitColumns({
  hunks,
  fullHunks,
  highlights,
  renderHunkActions,
  onLineComment,
  commentLabel,
}: {
  hunks: readonly ReviewHunk[]
  fullHunks: readonly ReviewHunk[]
  highlights: readonly (HunkHighlights | undefined)[]
  renderHunkActions?: ((hunk: ReviewHunk, index: number) => ReactNode) | undefined
  onLineComment?: ((target: ReviewLineCommentTarget) => void) | undefined
  commentLabel: string
}): ReactNode {
  const paired = useMemo(() => hunks.map(hunk => ({ header: hunkHeader(hunk), rows: splitRows(hunk) })), [hunks])
  const columns = useRef<Record<'left' | 'right', HTMLDivElement | null>>({ left: null, right: null })
  const offsets = useRef({ left: { scrollLeft: 0, scrollTop: 0 }, right: { scrollLeft: 0, scrollTop: 0 } })
  const follow = (side: 'left' | 'right') => (event: UIEvent<HTMLDivElement>): void => {
    const peer = side === 'left' ? 'right' : 'left'
    const other = columns.current[peer]
    /* v8 ignore next -- Both column refs are attached before browser scroll events can run. */
    if (other === null) return
    for (const axis of ['scrollLeft', 'scrollTop'] as const) {
      const value = event.currentTarget[axis]
      if (offsets.current[side][axis] === value) continue
      offsets.current[side][axis] = value
      other[axis] = value
      // Record the browser-clamped offset so its scroll event cannot pull the source back.
      offsets.current[peer][axis] = other[axis]
    }
  }
  return (
    <div className={css.columns}>
      {(['left', 'right'] as const).map(side => (
        <div key={side} className={css.column} data-diff-side={side}
          ref={(element) => { columns.current[side] = element }} onScroll={follow(side)}>
          {paired.map((hunk, position) => {
            const fullHunk = fullHunks[position] ?? hunks[position]
            const targetSide = side === 'left' ? 'old' : 'new'
            return (
              <section key={position} className={css.hunk} data-diff-hunk>
                <div className={css.hunkHeader} data-diff-hunk-header>
                  <span className={css.hunkHeaderText}>{hunk.header}</span>
                  {side === 'right' && renderHunkActions !== undefined && fullHunk !== undefined && (
                    <span className={css.hunkActions} data-diff-hunk-actions>
                      {renderHunkActions(fullHunk, position)}
                    </span>
                  )}
                </div>
                {hunk.rows.map((row, at) => {
                  if (row.eof !== undefined) {
                    return <div key={at} className={`${css.sideLine} ${css.eof}`} data-diff-line="eof"><span className={css.number} /><DiffText text={row.eof} spans={undefined} /></div>
                  }
                  const cell = row[side]
                  const spans = cell === undefined || cell.no === undefined ? undefined : highlights[position]?.[targetSide]?.get(cell.no)
                  const target = fullHunk === undefined ? undefined : splitCellCommentTarget(cell, targetSide, fullHunk)
                  return (
                    <div key={at} className={`${css.sideLine} ${cell === undefined ? css.empty : css[cell.kind]}`} data-diff-line={splitRowKind(row)}>
                      <LineCommentTrigger label={commentLabel} target={target} onComment={onLineComment} />
                      <span className={css.number}>{cell?.no ?? ''}</span>
                      <DiffText text={cell?.text ?? ''} spans={spans} />
                    </div>
                  )
                })}
              </section>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/**
 * Render one file's hunks with line numbers, unified or side by side.
 * Addition-only and deletion-only comparisons use one column without changing
 * the requested layout. Plain text paints first; token highlighting lands in
 * cancellable slices, and comparisons over budget stay readable as text.
 * @param props - hunks, layout choices, optional actions, and localized notes.
 * @returns the comparison body.
 */
export function ReviewDiff({
  hunks,
  language,
  split,
  wrap,
  notes,
  truncatedNote,
  skippedNote,
  renderHunkActions,
  onLineComment,
  lineCommentLabel,
  progressiveChunkLines,
  showMoreLabel,
  expandRemainingLabel,
}: ReviewDiffProps): ReactNode {
  const { hunks: kept, truncated } = useMemo(() => renderedHunks(hunks), [hunks])
  const chunkSize = progressiveChunkLines !== undefined && progressiveChunkLines > 0
    ? Math.floor(progressiveChunkLines)
    : undefined
  const [visibleLimit, setVisibleLimit] = useState<number>(() => chunkSize ?? Number.POSITIVE_INFINITY)
  useEffect(() => {
    setVisibleLimit(chunkSize ?? Number.POSITIVE_INFINITY)
  }, [hunks, chunkSize])
  const totalKeptLines = useMemo(() => kept.reduce((sum, hunk) => sum + hunk.lines.length, 0), [kept])
  const isChunked = chunkSize !== undefined && visibleLimit < totalKeptLines
  const visibleHunks = useMemo(
    () => (isChunked ? renderedHunks(kept, visibleLimit).hunks : kept),
    [isChunked, kept, visibleLimit],
  )
  const visibleCount = useMemo(() => visibleHunks.reduce((sum, hunk) => sum + hunk.lines.length, 0), [visibleHunks])
  const remainingLines = Math.max(0, totalKeptLines - visibleCount)
  const nextChunkCount = chunkSize === undefined ? remainingLines : Math.min(chunkSize, remainingLines)
  const { highlights, skipped } = useReviewHighlights(visibleHunks, language)
  const hasAdditions = kept.some(hunk => hunk.lines.some(line => line.startsWith('+')))
  const hasDeletions = kept.some(hunk => hunk.lines.some(line => line.startsWith('-')))
  const effectiveSplit = split && !(hasAdditions !== hasDeletions)
  const commentLabel = lineCommentLabel ?? 'Add to chat'
  const showMoreText = typeof showMoreLabel === 'function'
    ? showMoreLabel(remainingLines, nextChunkCount)
    : showMoreLabel ?? `Show ${nextChunkCount} more lines (${remainingLines} remaining)`
  const expandRemainingText = typeof expandRemainingLabel === 'function'
    ? expandRemainingLabel(remainingLines)
    : expandRemainingLabel ?? `Expand remaining (${remainingLines} lines)`
  return (
    <div className={css.body} data-review-view={effectiveSplit ? 'split' : 'unified'} data-review-wrap={wrap || undefined}>
      {notes?.map((note, index) => <p key={index} className={css.note} {...note.attrs}>{note.text}</p>)}
      {truncated && truncatedNote !== undefined && <p className={css.note} data-diff-truncated>{truncatedNote}</p>}
      {skipped && skippedNote !== undefined && <p className={css.note} data-diff-highlight-skipped>{skippedNote}</p>}
      {effectiveSplit && !wrap ? (
        <SplitColumns
          hunks={visibleHunks}
          fullHunks={kept}
          highlights={highlights}
          renderHunkActions={renderHunkActions}
          onLineComment={onLineComment}
          commentLabel={commentLabel}
        />
      ) : visibleHunks.map((hunk, position) => {
        const highlighted = highlights[position]
        const fullHunk = kept[position] ?? hunk
        return <section key={position} className={css.hunk} data-diff-hunk>
          <div className={css.hunkHeader} data-diff-hunk-header>
            <span className={css.hunkHeaderText}>{hunkHeader(hunk)}</span>
            {renderHunkActions !== undefined && (
              <span className={css.hunkActions} data-diff-hunk-actions>
                {renderHunkActions(fullHunk, position)}
              </span>
            )}
          </div>
          {effectiveSplit ? splitRows(hunk).map((row, at) => (
            row.eof !== undefined
              ? <div key={at} className={css.splitLine} data-diff-line="eof"><span className={`${css.cell} ${css.eof}`}><span className={css.number} /><DiffText text={row.eof} spans={undefined} /></span></div>
              : <div key={at} className={css.splitLine} data-diff-line={splitRowKind(row)}>
                <span className={`${css.cell} ${row.left === undefined ? css.empty : css[row.left.kind]}`}>
                  <LineCommentTrigger
                    label={commentLabel}
                    target={splitCellCommentTarget(row.left, 'old', fullHunk)}
                    onComment={onLineComment}
                  />
                  <span className={css.number}>{row.left?.no ?? ''}</span>
                  <DiffText text={row.left?.text ?? ''} spans={row.left?.no === undefined ? undefined : highlighted?.old?.get(row.left.no)} />
                </span>
                <span className={`${css.cell} ${row.right === undefined ? css.empty : css[row.right.kind]}`}>
                  <LineCommentTrigger
                    label={commentLabel}
                    target={splitCellCommentTarget(row.right, 'new', fullHunk)}
                    onComment={onLineComment}
                  />
                  <span className={css.number}>{row.right?.no ?? ''}</span>
                  <DiffText text={row.right?.text ?? ''} spans={row.right?.no === undefined ? undefined : highlighted?.new?.get(row.right.no)} />
                </span>
              </div>
          )) : hunkRows(hunk).map((row, at) => (
            <div key={at} className={`${css.line} ${css[row.kind]}`} data-diff-line={row.kind}>
              <LineCommentTrigger
                label={commentLabel}
                target={unifiedCommentTarget(row, fullHunk)}
                onComment={onLineComment}
              />
              <span className={css.number}>{row.old ?? ''}</span>
              <span className={css.number}>{row.new ?? ''}</span>
              <span className={css.sign}>{row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '}</span>
              <DiffText text={row.text} spans={row.kind === 'add'
                ? (row.new === undefined ? undefined : highlighted?.new?.get(row.new))
                : (row.old === undefined ? undefined : highlighted?.old?.get(row.old))} />
            </div>
          ))}
        </section>
      })}
      {remainingLines > 0 && (
        <div className={css.progressiveBar} data-diff-progressive>
          <button
            type="button"
            className={css.progressiveBtn}
            data-diff-show-more
            onClick={() => { setVisibleLimit(current => Math.min(totalKeptLines, current + (chunkSize ?? totalKeptLines))) }}
          >
            {showMoreText}
          </button>
          {remainingLines > nextChunkCount && (
            <button
              type="button"
              className={css.progressiveBtn}
              data-diff-expand-remaining
              onClick={() => { setVisibleLimit(totalKeptLines) }}
            >
              {expandRemainingText}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
