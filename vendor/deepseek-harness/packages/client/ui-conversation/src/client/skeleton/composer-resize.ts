/** Floor matching the two-line hero mirror (`min-height: 52px`). */
export const COMPOSER_RESIZE_MIN_PX = 52

/** Floor so the toolbar row still fits on a dragged-narrow card. */
export const COMPOSER_RESIZE_MIN_WIDTH_PX = 280

/** Ceiling as a fraction of the layout viewport so the chat column stays usable. */
export const COMPOSER_RESIZE_MAX_VH = 0.7

/** Horizontal edge that owns a width drag. */
export type ComposerResizeWidthEdge = 'left' | 'right'

/**
 * Map a vertical pointer delta onto a clamped composer scrollport height.
 * Moving the pointer up grows the box (the handle sits on the top edge).
 * @param originHeight - scrollport height at pointer down.
 * @param originY - `clientY` at pointer down.
 * @param clientY - current `clientY`.
 * @param viewportHeight - `window.innerHeight` used as the 70vh ceiling.
 * @returns height in CSS pixels, inclusive of the min and max.
 */
export function composerResizeHeight(
  originHeight: number,
  originY: number,
  clientY: number,
  viewportHeight: number,
): number {
  const next = originHeight + (originY - clientY)
  const max = viewportHeight * COMPOSER_RESIZE_MAX_VH
  return Math.min(max, Math.max(COMPOSER_RESIZE_MIN_PX, next))
}

/**
 * Map a horizontal pointer delta onto a clamped composer card width.
 * Centered capsules move both edges symmetrically when `scale` is 2, so the
 * dragged edge tracks the pointer 1:1; an end-reserved column passes `scale` 1.
 * @param originWidth - card width at pointer down.
 * @param originX - `clientX` at pointer down.
 * @param clientX - current `clientX`.
 * @param edge - which vertical edge is being dragged.
 * @param maxWidth - parent content box; the card must not overflow the column.
 * @param scale - width change per pixel of outward pointer travel (2 centered, 1 end-pinned).
 * @returns width in CSS pixels, inclusive of the min and max.
 */
export function composerResizeWidth(
  originWidth: number,
  originX: number,
  clientX: number,
  edge: ComposerResizeWidthEdge,
  maxWidth: number,
  scale = 2,
): number {
  const delta = (edge === 'right' ? clientX - originX : originX - clientX) * scale
  const next = originWidth + delta
  const min = Math.min(COMPOSER_RESIZE_MIN_WIDTH_PX, maxWidth)
  return Math.min(maxWidth, Math.max(min, next))
}

/**
 * Width ceiling for a horizontal drag: the parent content box, or the card's
 * current width when the parent is missing or reports no inner size.
 * @param parent - the card's offset parent, or null if unmounted mid-gesture.
 * @param paddingLeft - computed `padding-left` of that parent.
 * @param paddingRight - computed `padding-right` of that parent.
 * @param fallback - card width used when the parent box cannot be measured.
 * @returns max width in CSS pixels.
 */
export function composerResizeMaxWidth(
  parent: { readonly clientWidth: number } | null,
  paddingLeft: string,
  paddingRight: string,
  fallback: number,
): number {
  if (parent === null) return fallback
  const pad = Number.parseFloat(paddingLeft) + Number.parseFloat(paddingRight)
  const inner = parent.clientWidth - (Number.isFinite(pad) ? pad : 0)
  return inner > 0 ? inner : fallback
}
