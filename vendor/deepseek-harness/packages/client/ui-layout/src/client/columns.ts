/**
 * Pure concession-chain column solver for the four-column AppFrame.
 * Chain order is fixed by contract: keep center >= CENTER_MIN by shrinking
 * surfaces, then the rightbar column, then auto-closing surfaces, then
 * auto-closing rightbar (derived zero width — preferred width preferences are
 * never rewritten, so widening the window restores them). The sidebar never
 * concedes: its rendered width is always the drag preference (or the collapsed
 * rail), and center absorbs any remaining deficit as the last resort. Inputs
 * are the layout store's plain width preferences (0 = closed); a closed
 * sidebar resolves to the fixed SIDEBAR_COLLAPSED control rail while a closed
 * rightbar column and closed surfaces resolve to zero width.
 * The SIDEBAR_AUTO_COLLAPSE breakpoint is consumed by AppFrame, which decides
 * the effective sidebar preference before solving; the solver itself stays
 * breakpoint-free.
 */

/** Resolved widths for one frame; center may drop below CENTER_MIN only at the final fallback. */
export interface Columns { sidebar: number; center: number; rightbar: number; surfaces: number }

// Contract-frozen geometry: the four-column concession chain's fixed points.
/** Center column floor; only the final fallback may go below it. */
export const CENTER_MIN = 400
/** Sidebar drag clamp floor. */
export const SIDEBAR_MIN = 264
/** Sidebar drag clamp ceiling. */
export const SIDEBAR_MAX = 420
/** Sidebar width before any user drag. */
export const SIDEBAR_DEFAULT = 280
/** Closed-sidebar rail: a 24px icon column between 16px horizontal paddings. */
export const SIDEBAR_COLLAPSED = 56
/** Frame width below which the sidebar overlays the main content without a rail. */
export const SIDEBAR_DRAWER_BREAKPOINT = 768
/** Viewport width below which the sidebar auto-collapses to the rail in
 * portrait (deepsuite LG breakpoint); a manual toggle below it re-expands
 * over the squeezed center (stores.ts narrowExpanded). Landscape skips this
 * band. Phone overlay (`PHONE_MAX`, portrait only) is a stricter band
 * inside this range and takes the sidebar out of the grid entirely. */
export const SIDEBAR_AUTO_COLLAPSE = 1024
/** Viewport width below which AppFrame uses the phone overlay shell when
 * the device is in portrait: no rail, conversation is full width, sidebar
 * and rightbar paint as drawers. Landscape (device rotation, not a keyboard-
 * shrunk viewport) keeps the sidebar in the grid. */
export const PHONE_MAX = 768
/** Phone sidebar drawer width; clamped to the frame so a 320px panel still
 * leaves a tap strip of backdrop on the right. */
export const PHONE_DRAWER = 320
/** Rightbar drag clamp floor; below it the column auto-closes instead. */
export const RIGHTBAR_MIN = 300
/** Maximum normal rightbar width as a fraction of the frame. */
export const RIGHTBAR_MAX_RATIO = 0.7
/** First-open rightbar preference as a fraction of the frame. */
export const RIGHTBAR_DEFAULT_RATIO = 0.45
/** Surfaces drag clamp floor. */
export const SURFACES_MIN = 360
/** Surfaces store clamp ceiling; high enough that 70vw on a large desktop still fits. */
export const SURFACES_MAX = 1400
/** Surfaces width before any user drag. */
export const SURFACES_DEFAULT = 540
/** Terminal drawer height clamp floor. */
export const TERMINAL_DRAWER_MIN = 180
/** Terminal drawer height before any user drag. */
export const TERMINAL_DRAWER_DEFAULT = 280

/**
 * Clamp a panel width into its contract range.
 * @param px - requested width.
 * @param min - range lower bound.
 * @param max - range upper bound.
 * @returns the clamped width.
 */
export function clampWidth(px: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(px)))
}

/**
 * Viewport-relative surfaces ceiling: 70% of the frame, inside SURFACES_MIN..SURFACES_MAX.
 * @param viewport - available frame width in px.
 * @returns the clamp ceiling for an open surfaces preference at this viewport.
 */
export function surfacesMaxForViewport(viewport: number): number {
  return Math.max(SURFACES_MIN, Math.min(SURFACES_MAX, Math.floor(viewport * 0.7)))
}

/**
 * Solve the four column widths for one viewport frame. Pure: no hysteresis —
 * the output is a function of (viewport, preferences) only, so recovery on
 * re-widening is automatic. Preferences re-clamp here because they cross the
 * store boundary and callers may still supply stale ranges.
 * An open surfaces preference clamps to 70% of the viewport
 * (`surfacesMaxForViewport`); an open rightbar preference clamps to
 * RIGHTBAR_MAX_RATIO of it. Only the final fallback may let center drop below
 * CENTER_MIN, and only after both right columns have been derived closed.
  * @param viewport - available frame width in px.
  * @param sidebar - sidebar width preference in px (0 = closed).
  * @param rightbar - rightbar width preference in px (0 = closed).
  * @param surfaces - surfaces width preference in px (0 = closed).
 * @param collapsedWidth - track width of the closed sidebar; the default keeps
 *   the icon rail, while 0 hides the column for native caption controls.
  * @param centeredSidebar - place an expanded sidebar's edge at the frame midpoint.
 * @returns resolved widths; a closed sidebar keeps its compact rail while
  *   closed rightbar and surfaces resolve to zero width (never unmounted).
 */
export function computeColumns(
  viewport: number,
  sidebar: number,
  rightbar: number,
  surfaces = 0,
  collapsedWidth = SIDEBAR_COLLAPSED,
  centeredSidebar = false,
): Columns {
  // The sidebar is fixed at its preference (or the rail) — it never concedes.
  const s = sidebar === 0 ? collapsedWidth : centeredSidebar ? viewport / 2 : clampWidth(sidebar, SIDEBAR_MIN, SIDEBAR_MAX)
  const r0 = rightbar === 0
    ? 0
    : clampWidth(rightbar, RIGHTBAR_MIN, Math.max(RIGHTBAR_MIN, viewport * RIGHTBAR_MAX_RATIO))
  const surf0 = surfaces === 0 ? 0 : clampWidth(surfaces, SURFACES_MIN, surfacesMaxForViewport(viewport))

  // Step 1: everything fits at preferred widths.
  if (s + r0 + surf0 + CENTER_MIN <= viewport) {
    return { sidebar: s, center: viewport - s - r0 - surf0, rightbar: r0, surfaces: surf0 }
  }

  // Step 2: shrink surfaces toward its minimum.
  const surf1 = surf0 === 0 ? 0 : Math.max(SURFACES_MIN, viewport - s - r0 - CENTER_MIN)
  if (s + r0 + surf1 + CENTER_MIN <= viewport) {
    return { sidebar: s, center: CENTER_MIN, rightbar: r0, surfaces: surf1 }
  }

  // Step 3: shrink the rightbar column toward its minimum (surfaces already at
  // its minimum or closed).
  const r1 = r0 === 0 ? 0 : Math.max(RIGHTBAR_MIN, viewport - s - surf1 - CENTER_MIN)
  if (s + r1 + surf1 + CENTER_MIN <= viewport) {
    return { sidebar: s, center: CENTER_MIN, rightbar: r1, surfaces: surf1 }
  }

  // Step 4: auto-close surfaces (derived — preferences untouched).
  if (s + r1 + CENTER_MIN <= viewport) {
    return { sidebar: s, center: viewport - s - r1, rightbar: r1, surfaces: 0 }
  }

  // Step 5: auto-close rightbar (derived — preferences untouched); center
  // absorbs any remaining deficit (may drop below CENTER_MIN).
  return { sidebar: s, center: Math.max(0, viewport - s), rightbar: 0, surfaces: 0 }
}
