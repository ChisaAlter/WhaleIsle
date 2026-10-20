/** Shared composer-edge drag handles for InputBar and ApprovalPanel. */

import { useCallback, useLayoutEffect, useRef, type PointerEvent, type RefObject } from 'react'
import clsx from 'clsx'
import { composerResizeHeight, composerResizeMaxWidth, composerResizeWidth } from './composer-resize.ts'
import type { ComposerResizeWidthEdge } from './composer-resize.ts'
import css from './ComposerResizeHandles.module.css'

const HEIGHT_VAR = '--dsh-composer-resized-height'
const WIDTH_VAR = '--dsh-composer-resized-width'
/** Non-inheriting width for the transcript column and Hero row (ChatView.module.css). */
const FLOW_VAR = '--dsh-composer-flow-width'
const FLOW_SELECTOR = '[data-chat-flow], [data-composer-flow]'

const SEAT_SELECTOR = '[data-composer-seat]'
const SCROLL_SELECTOR = '[data-conversation-scroll]'

function seatOf(node: HTMLElement | null): HTMLElement | null {
  return node?.closest(SEAT_SELECTOR) ?? null
}

/** The conversation column that owns both the transcript and the composer seat. */
function scrollOf(node: HTMLElement | null): HTMLElement | null {
  return node?.closest(SCROLL_SELECTOR) ?? null
}

/**
 * Width publishes on the conversation root (the common ancestor of the
 * composer card and the message column), so the transcript column reads the
 * same `--dsh-composer-resized-width` the dock rows do; the composer seat
 * remains the fallback when no root ancestor exists (standalone bars).
 */
function widthSeatOf(node: HTMLElement | null): HTMLElement | null {
  return node?.closest('[data-conversation-root]') ?? seatOf(node)
}

function applyHeight(scroll: HTMLElement, height: number): void {
  const value = `${height}px`
  const seat = seatOf(scroll)
  const targets = new Set<HTMLElement>([scroll])
  if (seat !== null) {
    for (const el of seat.querySelectorAll<HTMLElement>('[data-input-scroll], [data-approval-scroll]')) {
      targets.add(el)
    }
    seat.style.setProperty(HEIGHT_VAR, value)
    seat.dataset.composerResized = ''
  }
  for (const el of targets) {
    el.style.height = value
    el.dataset.composerResized = ''
  }
}

/**
 * Drag frames restyle only what changes width: the inherited width goes on the
 * composer seat (a small subtree) and the non-inheriting flow width on the
 * transcript column and Hero row. An inherited custom property written on an
 * ancestor of the transcript restyles every message, so the conversation root
 * and the column host receive it only when the size settles (drag end, restore),
 * for columns and Hero rows that mount later.
 */
function applyWidth(card: HTMLElement, width: number, settle: boolean): void {
  const value = `${width}px`
  const root = widthSeatOf(card)
  const seat = seatOf(card)
  const host = scrollOf(seat ?? root)
  const targets = new Set<HTMLElement>([card])
  if (root !== null) {
    for (const el of root.querySelectorAll<HTMLElement>('[data-composer-card]')) {
      targets.add(el)
    }
  }
  for (const el of (host ?? root)?.querySelectorAll<HTMLElement>(FLOW_SELECTOR) ?? []) {
    el.style.setProperty(FLOW_VAR, value)
  }
  if (seat !== null) {
    seat.style.setProperty(WIDTH_VAR, value)
    seat.dataset.composerResizedWidth = ''
  }
  if (settle && root !== null) {
    root.style.setProperty(WIDTH_VAR, value)
    root.dataset.composerResizedWidth = ''
    // The transcript column (ChatView .column) is a sibling of the seat under
    // [data-conversation-scroll]; a column mounted later reads the host value.
    host?.style.setProperty(WIDTH_VAR, value)
  }
  for (const el of targets) {
    el.style.width = value
    el.dataset.composerResizedWidth = ''
  }
}

function clearSize(scroll: HTMLElement | null, card: HTMLElement | null): void {
  const seat = seatOf(scroll) ?? seatOf(card)
  const widthSeat = widthSeatOf(card) ?? seat
  const host = scrollOf(seat) ?? scrollOf(scroll) ?? scrollOf(card)
  const scrolls = seat === null
    ? (scroll === null ? [] : [scroll])
    : [...seat.querySelectorAll<HTMLElement>('[data-input-scroll], [data-approval-scroll]')]
  const cards = seat === null
    ? (card === null ? [] : [card])
    : [...seat.querySelectorAll<HTMLElement>('[data-composer-card]')]
  for (const el of scrolls) {
    el.style.height = ''
    delete el.dataset.composerResized
  }
  for (const el of cards) {
    el.style.width = ''
    delete el.dataset.composerResizedWidth
  }
  if (seat !== null) {
    seat.style.removeProperty(HEIGHT_VAR)
    delete seat.dataset.composerResized
  }
  for (const owner of new Set([seat, widthSeat])) {
    if (owner === null) continue
    owner.style.removeProperty(WIDTH_VAR)
    delete owner.dataset.composerResizedWidth
  }
  for (const el of (host ?? widthSeat)?.querySelectorAll<HTMLElement>(FLOW_SELECTOR) ?? []) {
    el.style.removeProperty(FLOW_VAR)
  }
  host?.style.removeProperty(WIDTH_VAR)
}

function adoptFromSeat(scroll: HTMLElement, card: HTMLElement): void {
  const seat = seatOf(scroll) ?? seatOf(card)
  const widthSeat = widthSeatOf(card)
  if (seat === null && widthSeat === null) return
  const height = seat?.style.getPropertyValue(HEIGHT_VAR) ?? ''
  const width = widthSeat?.style.getPropertyValue(WIDTH_VAR) ?? ''
  if (height !== '') {
    scroll.style.height = height
    scroll.dataset.composerResized = ''
  }
  if (width !== '') {
    card.style.width = width
    card.dataset.composerResizedWidth = ''
  }
}

/**
 * Pointer drag that sets composer scrollport height and card width.
 * When a `[data-composer-seat]` ancestor is present, the size is published
 * there and copied to every InputBar / ApprovalPanel body under that seat.
 * The width is additionally published on the `[data-conversation-scroll]`
 * column host so the transcript column (a sibling of the seat) can follow.
 * @param enabled - Interface Settings `composerResize`.
 * @param cardRef - the composer card (`[data-composer-card]`).
 * @param scrollRef - the draft or approval scrollport.
 * @param persisted - Host-remembered size applied when the seat has none yet.
 * @param onCommit - durable write after a finished drag (pointer up).
 * @returns pointer handlers for the three edge handles.
 */
export function useComposerResizeDrag(
  enabled: boolean,
  cardRef: RefObject<HTMLDivElement | null>,
  scrollRef: RefObject<HTMLDivElement | null>,
  persisted: { height: number | null; width: number | null } = { height: null, width: null },
  onCommit?: (size: Partial<{ height: number; width: number }>) => void,
): {
  onResizePointerDown: (event: PointerEvent<HTMLDivElement>) => void
  onResizePointerMove: (event: PointerEvent<HTMLDivElement>) => void
  onResizePointerUp: (event: PointerEvent<HTMLDivElement>) => void
} {
  const resizeDrag = useRef<{
    pointerId: number
    edge: 'top' | ComposerResizeWidthEdge
    originX: number
    originY: number
    originWidth: number
    originHeight: number
    maxWidth: number
  } | null>(null)
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit

  useLayoutEffect(() => {
    const scroll = scrollRef.current
    const card = cardRef.current
    if (!enabled) {
      clearSize(scroll, card)
      return
    }
    if (scroll === null || card === null) return
    adoptFromSeat(scroll, card)
    if (scroll.dataset.composerResized === undefined && persisted.height !== null) {
      applyHeight(scroll, persisted.height)
    }
    if (card.dataset.composerResizedWidth === undefined && persisted.width !== null) {
      applyWidth(card, persisted.width, true)
    }
  }, [enabled, cardRef, scrollRef, persisted.height, persisted.width])

  const onResizePointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const edge = e.currentTarget.dataset.composerResizeEdge
    /* v8 ignore next -- handles always set top | left | right */
    if (edge !== 'top' && edge !== 'left' && edge !== 'right') return
    const scroll = scrollRef.current
    const card = cardRef.current
    /* v8 ignore next -- the handle only renders while the scrollport and card are mounted */
    if (scroll === null || card === null) return
    e.preventDefault()
    e.stopPropagation()
    const parent = card.parentElement
    const cs = parent === null ? undefined : getComputedStyle(parent)
    resizeDrag.current = {
      pointerId: e.pointerId,
      edge,
      originX: e.clientX,
      originY: e.clientY,
      originWidth: card.getBoundingClientRect().width,
      originHeight: scroll.getBoundingClientRect().height,
      maxWidth: composerResizeMaxWidth(
        parent,
        cs?.paddingLeft ?? '0',
        cs?.paddingRight ?? '0',
        card.getBoundingClientRect().width,
      ),
    }
    /* v8 ignore next -- Pointer Capture is missing in jsdom; browsers have it */
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }, [cardRef, scrollRef])

  const onResizePointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const drag = resizeDrag.current
    if (drag === null || drag.pointerId !== e.pointerId) return
    const scroll = scrollRef.current
    const card = cardRef.current
    /* v8 ignore next -- the handle only renders while the scrollport and card are mounted */
    if (scroll === null || card === null) return
    if (drag.edge === 'top') {
      applyHeight(scroll, composerResizeHeight(
        drag.originHeight, drag.originY, e.clientY, window.innerHeight,
      ))
      return
    }
    applyWidth(card, composerResizeWidth(
      drag.originWidth, drag.originX, e.clientX, drag.edge, drag.maxWidth,
    ), false)
  }, [cardRef, scrollRef])

  const onResizePointerUp = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (resizeDrag.current?.pointerId !== e.pointerId) return
    resizeDrag.current = null
    /* v8 ignore next -- Pointer Capture is missing in jsdom; browsers have it */
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    const scroll = scrollRef.current
    const card = cardRef.current
    const patch: { height?: number; width?: number } = {}
    const height = scroll?.dataset.composerResized !== undefined
      ? Number.parseFloat(scroll.style.height)
      : Number.NaN
    const width = card?.dataset.composerResizedWidth !== undefined
      ? Number.parseFloat(card.style.width)
      : Number.NaN
    if (Number.isFinite(height)) patch.height = height
    if (Number.isFinite(width)) {
      patch.width = width
      if (card !== null) applyWidth(card, width, true)
    }
    if (patch.height !== undefined || patch.width !== undefined) {
      onCommitRef.current?.(patch)
    }
  }, [cardRef, scrollRef])

  return { onResizePointerDown, onResizePointerMove, onResizePointerUp }
}

/** Locale keys the edge handles advertise to assistive tech. */
export interface ComposerResizeHandleLabels {
  (key: 'composer.resize' | 'composer.resizeWidth'): string
}

/**
 * Top / left / right edge hit strips. The parent decides whether they mount.
 * @param props - locale seat plus the drag handlers from {@link useComposerResizeDrag}.
 * @returns the three handle elements.
 */
export function ComposerResizeHandles({
  t, onPointerDown, onPointerMove, onPointerUp,
}: {
  t: ComposerResizeHandleLabels
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void
}) {
  return (
    <>
      <div
        className={css.resizeHandle}
        data-composer-resize-handle=""
        data-composer-resize-edge="top"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('composer.resize')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div
        className={clsx(css.resizeHandle, css.resizeHandleWest)}
        data-composer-resize-handle=""
        data-composer-resize-edge="left"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('composer.resizeWidth')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div
        className={clsx(css.resizeHandle, css.resizeHandleEast)}
        data-composer-resize-handle=""
        data-composer-resize-edge="right"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('composer.resizeWidth')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </>
  )
}
