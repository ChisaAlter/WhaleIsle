/**
 * Titlebar trailing-cluster density and conversation-column reserve.
 * Density keys off the conversation column width, not the cluster's current
 * width, so shrinking labels cannot oscillate the density.
 */

/** How titlebar labels collapse when the trailing cluster shares the conversation column. */
export type TitlebarDensity = 'full' | 'cozy' | 'compact'

/** Center width below which Session log is icon-only. */
export const TITLEBAR_DENSITY_COZY = 720

/** Center width below which the branch trigger hides its ref name. */
export const TITLEBAR_DENSITY_COMPACT = 560

/**
 * Resolve titlebar label density from the conversation column width.
 * @param center - solved conversation column width in px.
 * @param clusterOverConversation - true while the visible cluster sits in that column (details closed).
 * @returns full labels, or cozy/compact collapse.
 */
export function resolveTitlebarDensity(
  center: number,
  clusterOverConversation: boolean,
): TitlebarDensity {
  if (!clusterOverConversation) return 'full'
  if (center < TITLEBAR_DENSITY_COMPACT) return 'compact'
  if (center < TITLEBAR_DENSITY_COZY) return 'cozy'
  return 'full'
}

/**
 * Pixels of the trailing cluster that occupy the conversation column.
 * Details sits to the right of conversation in the same titlebar span; a
 * closed details column contributes 0.
 * @param clusterVisible - false on phone and compact-header frames (cluster is `display: none`).
 * @param trailingWidth - measured `#dshd-shell-titlebar-trailing` width in px.
 * @param detailsWidth - solved details column width in px (0 when closed).
 * @returns the conversation header reserve, never negative.
 */
export function titlebarConversationReserve(
  clusterVisible: boolean,
  trailingWidth: number,
  detailsWidth: number,
): number {
  if (!clusterVisible) return 0
  return Math.max(0, trailingWidth - detailsWidth)
}
