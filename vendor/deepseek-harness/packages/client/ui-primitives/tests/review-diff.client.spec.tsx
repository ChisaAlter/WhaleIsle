// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import {
  DEFAULT_PROGRESSIVE_CHUNK_LINES, hunkLineCount, hunkRows, MAX_RENDERED_LINES, renderedHunks, ReviewDiff, splitRows,
} from '../src/ReviewDiff.tsx'
import type { ReviewHunk, ReviewLineCommentTarget } from '../src/ReviewDiff.tsx'

afterEach(cleanup)

const HUNK: ReviewHunk = {
  oldStart: 10,
  oldLines: 4,
  newStart: 10,
  newLines: 5,
  lines: [
    ' ctx one',
    '-old line',
    '+new line',
    '+extra line',
    ' ctx two',
    '\\ No newline at end of file',
  ],
}

describe('hunkRows', () => {
  it('numbers context on both sides, deletions old-side, additions new-side', () => {
    expect(hunkRows(HUNK)).toEqual([
      { kind: 'context', old: 10, new: 10, text: 'ctx one' },
      { kind: 'del', old: 11, new: undefined, text: 'old line' },
      { kind: 'add', old: undefined, new: 11, text: 'new line' },
      { kind: 'add', old: undefined, new: 12, text: 'extra line' },
      { kind: 'context', old: 12, new: 13, text: 'ctx two' },
      { kind: 'eof', old: undefined, new: undefined, text: 'No newline at end of file' },
    ])
  })

  it('keeps rows numberless when the hunk carries no starts', () => {
    const rows = hunkRows({ lines: ['-a', '+b'] })
    expect(rows.map(row => row.old)).toEqual([undefined, undefined])
    expect(rows.map(row => row.new)).toEqual([undefined, undefined])
    expect(rows.map(row => row.kind)).toEqual(['del', 'add'])
  })
})

describe('splitRows', () => {
  it('pairs deletion runs with the additions that follow them', () => {
    const rows = splitRows(HUNK)
    expect(rows[0]).toEqual({
      left: { no: 10, text: 'ctx one', kind: 'context' },
      right: { no: 10, text: 'ctx one', kind: 'context' },
    })
    expect(rows[1]).toEqual({ left: { no: 11, text: 'old line', kind: 'del' }, right: { no: 11, text: 'new line', kind: 'add' } })
    expect(rows[2]).toEqual({ right: { no: 12, text: 'extra line', kind: 'add' } })
    expect(rows[3]?.left?.kind).toBe('context')
    expect(rows[4]).toEqual({ eof: 'No newline at end of file' })
  })
})

describe('renderedHunks', () => {
  const twoHunks: ReviewHunk[] = [
    { oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [' a', '-b', '+c'] },
    { oldStart: 20, oldLines: 4, newStart: 20, newLines: 4, lines: [' x', '-y', '+z', ' w'] },
  ]

  it('keeps every hunk under the default budget', () => {
    expect(renderedHunks(twoHunks)).toEqual({ hunks: twoHunks, truncated: false })
  })

  it('shortens the last affordable hunk and reports truncation', () => {
    const { hunks, truncated } = renderedHunks(twoHunks, 5)
    expect(truncated).toBe(true)
    expect(hunks[0]?.lines).toHaveLength(3)
    expect(hunks[1]?.lines).toHaveLength(2)
  })

  it('drops hunks once the budget is gone', () => {
    const { hunks, truncated } = renderedHunks(twoHunks, 3)
    expect(truncated).toBe(true)
    expect(hunks).toHaveLength(1)
  })

  it('counts body lines for panel budgets', () => {
    expect(hunkLineCount(twoHunks[1]!)).toBe(4)
  })
})

const SAMPLE: ReviewHunk[] = [{
  oldStart: 1,
  oldLines: 3,
  newStart: 1,
  newLines: 4,
  lines: [' const a = 1', '-const b = 2', '+const b = 3', '+const c = 4', ' const d = 5'],
}]

describe('ReviewDiff', () => {
  it('draws unified numbered rows with the hunk header', () => {
    const { container } = render(<ReviewDiff hunks={SAMPLE} split={false} wrap={false} />)
    expect(container.querySelector('[data-review-view]')?.getAttribute('data-review-view')).toBe('unified')
    expect(container.querySelector('[data-diff-hunk-header]')?.textContent).toBe('@@ -1,3 +1,4 @@')
    const rows = [...container.querySelectorAll('[data-diff-line]')]
    expect(rows.map(row => row.getAttribute('data-diff-line'))).toEqual(['context', 'del', 'add', 'add', 'context'])
    expect(rows[0]?.textContent).toContain('const a = 1')
    expect(rows[1]?.querySelectorAll('[class*="_number_"]')[0]?.textContent).toBe('2')
  })

  it('draws paired columns for split without wrap', () => {
    const { container } = render(<ReviewDiff hunks={SAMPLE} split wrap={false} />)
    expect(container.querySelector('[data-review-view]')?.getAttribute('data-review-view')).toBe('split')
    expect(container.querySelectorAll('[data-diff-side]')).toHaveLength(2)
  })

  it('draws paired cells for split with wrap', () => {
    const { container } = render(<ReviewDiff hunks={SAMPLE} split wrap />)
    expect(container.querySelector('[data-review-view]')?.hasAttribute('data-review-wrap')).toBe(true)
    expect(container.querySelectorAll('[data-diff-side]')).toHaveLength(0)
    const rows = [...container.querySelectorAll('[data-diff-line]')]
    expect(rows.map(row => row.getAttribute('data-diff-line'))).toEqual(['context', 'del', 'add', 'context'])
  })

  it('keeps a one-sided comparison unified even when split is requested', () => {
    const added: ReviewHunk[] = [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: ['+a', '+b'] }]
    const { container } = render(<ReviewDiff hunks={added} split wrap={false} />)
    expect(container.querySelector('[data-review-view]')?.getAttribute('data-review-view')).toBe('unified')
  })

  it('renders notes, truncation, and skipped-highlight notices', () => {
    const big: ReviewHunk[] = [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: Array.from({ length: MAX_RENDERED_LINES + 2 }, (_v, i) => `+line ${i}`) }]
    const { container } = render(
      <ReviewDiff
        hunks={big}
        split={false}
        wrap={false}
        notes={[{ text: 'Created file', attrs: { 'data-diff-note': 'metadata' } }]}
        truncatedNote="Showing first lines"
        skippedNote="No highlight"
      />,
    )
    expect(container.querySelector('[data-diff-note="metadata"]')?.textContent).toBe('Created file')
    expect(container.querySelector('[data-diff-truncated]')?.textContent).toBe('Showing first lines')
    const rows = container.querySelectorAll('[data-diff-line]')
    expect(rows.length).toBe(MAX_RENDERED_LINES)
  })

  it('paints plain text first, then lands token spans asynchronously', async () => {
    const { container } = render(<ReviewDiff hunks={SAMPLE} language="typescript" split={false} wrap={false} />)
    expect(container.querySelector('[data-diff-line]')).not.toBeNull()
    // The first highlight waits on the shared engine warmup; allow that
    // one-time cost so suite scheduling cannot flake the assertion.
    await waitFor(() => {
      expect(container.querySelector('[data-diff-code]')).not.toBeNull()
    }, { timeout: 10_000 })
    const spans = container.querySelectorAll('[data-diff-code] span[style]')
    expect(spans.length).toBeGreaterThan(0)
  })

  it('drops stale highlights when the hunks change', async () => {
    const first: ReviewHunk[] = [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-const a = 1', '+const a = 2'] }]
    const second: ReviewHunk[] = [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-let x = 1', '+let x = 2'] }]
    const { container, rerender } = render(<ReviewDiff hunks={first} language="typescript" split={false} wrap={false} />)
    await waitFor(() => { expect(container.querySelector('[data-diff-code]')).not.toBeNull() }, { timeout: 10_000 })
    rerender(<ReviewDiff hunks={second} language="typescript" split={false} wrap={false} />)
    // Stale spans must not dress the new rows: either freshly highlighted new
    // text or plain text is acceptable, never the old line's spans.
    const texts = [...container.querySelectorAll('[data-diff-line]')].map(row => row.textContent)
    expect(texts.some(text => text?.includes('let x = 2'))).toBe(true)
    await waitFor(() => { expect(container.querySelector('[data-diff-code]')).not.toBeNull() }, { timeout: 10_000 })
  })

  it('renders hunk actions in both unified and split views', () => {
    const hunks: ReviewHunk[] = [
      HUNK,
      { oldStart: 30, oldLines: 1, newStart: 31, newLines: 1, lines: ['-foo', '+bar'] },
    ]
    const onHunkAction = vi.fn<(oldStart?: number, index?: number) => void>()
    const renderActions = (hunk: ReviewHunk, index: number) => (
      <button type="button" data-hunk-action={index} onClick={() => { onHunkAction(hunk.oldStart, index) }}>
        Stage #{index}
      </button>
    )

    const { container, rerender } = render(
      <ReviewDiff hunks={hunks} split={false} wrap={false} renderHunkActions={renderActions} />,
    )
    const unifiedButtons = container.querySelectorAll('[data-diff-hunk-actions] button')
    expect(unifiedButtons.length).toBe(2)
    fireEvent.click(unifiedButtons[1]!)
    expect(onHunkAction).toHaveBeenCalledWith(30, 1)

    rerender(<ReviewDiff hunks={hunks} split wrap={false} renderHunkActions={renderActions} />)
    const splitButtons = container.querySelectorAll('[data-diff-hunk-actions] button')
    expect(splitButtons.length).toBe(2)
    fireEvent.click(splitButtons[0]!)
    expect(onHunkAction).toHaveBeenCalledWith(10, 0)

    rerender(<ReviewDiff hunks={hunks} split wrap renderHunkActions={renderActions} />)
    const wrapSplitButtons = container.querySelectorAll('[data-diff-hunk-actions] button')
    expect(wrapSplitButtons.length).toBe(2)
    fireEvent.click(wrapSplitButtons[1]!)
    expect(onHunkAction).toHaveBeenCalledWith(30, 1)
  })

  it('triggers onLineComment with accurate line metadata in unified and split views', () => {
    const targets: ReviewLineCommentTarget[] = []
    const hunk: ReviewHunk = {
      oldStart: 5,
      oldLines: 3,
      newStart: 5,
      newLines: 3,
      lines: [' ctx', '-removed', '+added', '\\ No newline at end of file'],
    }
    const { container, rerender } = render(
      <ReviewDiff
        hunks={[hunk]}
        split={false}
        wrap={false}
        lineCommentLabel="Comment line"
        onLineComment={(target) => { targets.push(target) }}
      />,
    )
    const unifiedBtns = container.querySelectorAll<HTMLButtonElement>('[data-diff-line-comment]')
    // 3 real lines (context, del, add); EOF row must not expose a comment button
    expect(unifiedBtns.length).toBe(3)
    expect(unifiedBtns[0]?.getAttribute('aria-label')).toBe('Comment line')
    fireEvent.click(unifiedBtns[0]!)
    fireEvent.click(unifiedBtns[1]!)
    fireEvent.click(unifiedBtns[2]!)
    expect(targets).toEqual([
      { lineNumber: 5, side: 'new', kind: 'context', text: 'ctx', hunk },
      { lineNumber: 6, side: 'old', kind: 'del', text: 'removed', hunk },
      { lineNumber: 6, side: 'new', kind: 'add', text: 'added', hunk },
    ])

    targets.length = 0
    rerender(
      <ReviewDiff
        hunks={[hunk]}
        split
        wrap={false}
        lineCommentLabel="Comment line"
        onLineComment={(target) => { targets.push(target) }}
      />,
    )
    const leftDelBtn = container.querySelector<HTMLButtonElement>('[data-diff-side="left"] [data-diff-line="del"] [data-diff-line-comment]')
    const rightAddBtn = container.querySelector<HTMLButtonElement>('[data-diff-side="right"] [data-diff-line="del"] [data-diff-line-comment]')
    expect(leftDelBtn).not.toBeNull()
    expect(rightAddBtn).not.toBeNull()
    fireEvent.click(leftDelBtn!)
    fireEvent.click(rightAddBtn!)
    expect(targets).toEqual([
      { lineNumber: 6, side: 'old', kind: 'del', text: 'removed', hunk },
      { lineNumber: 6, side: 'new', kind: 'add', text: 'added', hunk },
    ])
  })

  it('progressively reveals large diffs in chunks while keeping MAX_RENDERED_LINES intact', () => {
    expect(DEFAULT_PROGRESSIVE_CHUNK_LINES).toBe(400)
    const lines = Array.from({ length: 10 }, (_v, i) => `+line ${i + 1}`)
    const hunks: ReviewHunk[] = [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 10, lines }]
    const { container, rerender } = render(
      <ReviewDiff
        hunks={hunks}
        split={false}
        wrap={false}
        progressiveChunkLines={4}
        showMoreLabel={(remaining, next) => `More ${next}/${remaining}`}
        expandRemainingLabel={remaining => `All ${remaining}`}
      />,
    )
    expect(container.querySelectorAll('[data-diff-line]').length).toBe(4)
    expect(container.querySelector('[data-diff-show-more]')?.textContent).toBe('More 4/6')
    expect(container.querySelector('[data-diff-expand-remaining]')?.textContent).toBe('All 6')

    fireEvent.click(container.querySelector('[data-diff-show-more]')!)
    expect(container.querySelectorAll('[data-diff-line]').length).toBe(8)
    expect(container.querySelector('[data-diff-show-more]')?.textContent).toBe('More 2/2')
    // When remaining <= chunkSize, only show-more is needed
    expect(container.querySelector('[data-diff-expand-remaining]')).toBeNull()

    // Reset back cleanly on new hunks and test expand-remaining
    const hunks2: ReviewHunk[] = [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 10, lines }]
    rerender(
      <ReviewDiff
        hunks={hunks2}
        split={false}
        wrap={false}
        progressiveChunkLines={4}
        showMoreLabel={(remaining, next) => `More ${next}/${remaining}`}
        expandRemainingLabel={remaining => `All ${remaining}`}
      />,
    )
    expect(container.querySelectorAll('[data-diff-line]').length).toBe(4)
    fireEvent.click(container.querySelector('[data-diff-expand-remaining]')!)
    expect(container.querySelectorAll('[data-diff-line]').length).toBe(10)
    expect(container.querySelector('[data-diff-progressive]')).toBeNull()
  })
})
