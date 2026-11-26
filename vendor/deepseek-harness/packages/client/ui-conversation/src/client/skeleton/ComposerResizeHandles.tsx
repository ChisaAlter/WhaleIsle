/** Shared composer-edge drag handles for InputBar and ApprovalPanel. */

import { useCallback, useLayoutEffect, useRef, type PointerEvent, type RefObject } from 'react'
import clsx from 'clsx'
import { composerResizeHeight, composerResizeMaxWidth, composerResizeWidth } from './composer-resize.ts'
import type { ComposerResizeWidthEdge } from './composer-resize.ts'
import css from './ComposerResizeHandles.module.css'

const HEIGHT_VAR = '--dsh-composer-resized-height'
/** Standalone fallback width when no `[data-conversation-content]` width axis exists. */
const WIDTH_VAR = '--dsh-composer-resized-width'
/** Unified `#8858` non-inheriting width axis on `[data-conversation-content]` (ConversationRoot.module.css). */
const USER_WIDTH_VAR = '--dsh-chat-user-width'
/** localStorage key shared with ConversationWidthControls; cleared when the user commits a composer drag. */
const WIDTH_PREF_KEY = 'dsh.conversation.contentWidth'
/** `--dsh-composer-card-max-width` is `calc(var(--dsh-chat-content-width) + 32px)`. */
const CARD_CONTENT_DELTA = 32

const SEAT_SELECTOR = '[data-composer-seat]'
const CONTENT_SELECTOR = '[data-conversation-content]'

function seatOf(node: HTMLElement | null): HTMLElement | null {
  return node?.closest(SEAT_SELECTOR) ?? null
}

/** The Conversation body that owns the unified `--dsh-chat-user-width` width axis. */
function contentOf(node: HTMLElement | null): HTMLElement | null {
  return node?.closest(CONTENT_SELECTOR) ?? null
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
 * Bridge horizontal composer width drags onto the Conversation body's unified
 * `--dsh-chat-user-width` axis (`@property { inherits: false }`), so the
 * transcript column, composer card, dock cards, Hero row, width handles, and
 * `ui-session-panel` end-reserve all compute from one source without dual-track
 * drift. Standalone bars without a `[data-conversation-content]` ancestor fall
 * back to `--dsh-composer-resized-width` on the seat and card.
 */
function applyWidth(card: HTMLElement, width: number, settle: boolean): void {
  const seat = seatOf(card)
  const content = contentOf(card) ?? contentOf(seat)
  if (content !== null) {
    const parent = card.parentElement
    const cs = parent === null ? undefined : getComputedStyle(parent)
    const maxCardWidth = parent !== null && parent.clientWidth > 0
      ? composerResizeMaxWidth(parent, cs?.paddingLeft ?? '0', cs?.paddingRight ?? '0', width)
      : (content.clientWidth > 0 ? Math.max(248 + CARD_CONTENT_DELTA, content.clientWidth) : undefined)
    const contentWidth = Math.max(0, width - CARD_CONTENT_DELTA)
    const clampedContentWidth = maxCardWidth === undefined
      ? contentWidth
      : Math.min(contentWidth, Math.max(248, maxCardWidth - CARD_CONTENT_DELTA))
    content.style.setProperty(USER_WIDTH_VAR, `${clampedContentWidth}px`)
    content.dataset.composerUserWidth = `${contentWidth}`
    if (settle) {
      try { localStorage.removeItem(WIDTH_PREF_KEY) } catch { /* private storage */ }
    }
    const targets = new Set<HTMLElement>([card])
    for (const el of (seat ?? content).querySelectorAll<HTMLElement>('[data-composer-card]')) {
      targets.add(el)
    }
    if (seat !== null) {
      seat.style.removeProperty(WIDTH_VAR)
      delete seat.dataset.composerResizedWidth
    }
    for (const el of targets) {
      el.style.width = ''
      el.style.removeProperty(WIDTH_VAR)
      el.dataset.composerResizedWidth = `${width}`
    }
    return
  }
  const value = `${width}px`
  const targets = new Set<HTMLElement>([card])
  if (seat !== null) {
    for (const el of seat.querySelectorAll<HTMLElement>('[data-composer-card]')) {
      targets.add(el)
    }
    seat.style.setProperty(WIDTH_VAR, value)
    seat.dataset.composerResizedWidth = `${width}`
  }
  for (const el of targets) {
    el.style.width = value
    if (seat === null) el.style.setProperty(WIDTH_VAR, value)
    else el.style.removeProperty(WIDTH_VAR)
    el.dataset.composerResizedWidth = `${width}`
  }
}

function clearSize(scroll: HTMLElement | null, card: HTMLElement | null): void {
  const seat = seatOf(scroll) ?? seatOf(card)
  const content = contentOf(card) ?? contentOf(seat) ?? contentOf(scroll)
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
    el.style.removeProperty(WIDTH_VAR)
    delete el.dataset.composerResizedWidth
  }
  if (seat !== null) {
    seat.style.removeProperty(HEIGHT_VAR)
    seat.style.removeProperty(WIDTH_VAR)
    delete seat.dataset.composerResized
    delete seat.dataset.composerResizedWidth
  }
  if (content !== null && content.dataset.composerUserWidth !== undefined) {
    delete content.dataset.composerUserWidth
    content.style.removeProperty(USER_WIDTH_VAR)
  }
}

function adoptFromSeat(scroll: HTMLElement, card: HTMLElement): void {
  const seat = seatOf(scroll) ?? seatOf(card)
  const content = contentOf(card) ?? contentOf(seat)
  const height = seat?.style.getPropertyValue(HEIGHT_VAR) ?? ''
  if (height !== '') {
    scroll.style.height = height
    scroll.dataset.composerResized = ''
  }
  if (content !== null) {
    const contentWidth = Number.parseFloat(content.dataset.composerUserWidth ?? '')
    if (Number.isFinite(contentWidth)) {
      card.style.width = ''
      card.dataset.composerResizedWidth = `${contentWidth + CARD_CONTENT_DELTA}`
    }
    return
  }
  const width = seat?.style.getPropertyValue(WIDTH_VAR) ?? ''
  if (width !== '') {
    card.style.width = width
    card.dataset.composerResizedWidth = `${Number.parseFloat(width)}`
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
    scale: number
    lastWidth?: number
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
    const seat = seatOf(card)
    const endInset = seat !== null ? Number.parseFloat(getComputedStyle(seat).paddingInlineEnd) : 0
    const scale = Number.isFinite(endInset) && endInset > 0 ? 1 : 2
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
      scale,
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
    const nextWidth = composerResizeWidth(
      drag.originWidth, drag.originX, e.clientX, drag.edge, drag.maxWidth, drag.scale,
    )
    drag.lastWidth = nextWidth
    applyWidth(card, nextWidth, false)
  }, [cardRef, scrollRef])

  const onResizePointerUp = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const drag = resizeDrag.current
    if (drag?.pointerId !== e.pointerId) return
    resizeDrag.current = null
    /* v8 ignore next -- Pointer Capture is missing in jsdom; browsers have it */
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    const scroll = scrollRef.current
    const card = cardRef.current
    const patch: { height?: number; width?: number } = {}
    const height = scroll?.dataset.composerResized !== undefined
      ? Number.parseFloat(scroll.style.height)
      : Number.NaN
    const width = drag.lastWidth ?? (card?.dataset.composerResizedWidth !== undefined
      ? Number.parseFloat(card.dataset.composerResizedWidth || card.style.width)
      : Number.NaN)
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
