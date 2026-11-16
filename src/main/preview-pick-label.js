'use strict';

/** Distance in CSS pixels between the highlight and the floating label. */
const LABEL_GAP = 4;
/** Minimum padding the label keeps from any viewport edge. */
const VIEWPORT_MARGIN = 4;

/**
 * Clamp/flip math for the floating pick label.
 * @param {{
 *   targetLeft: number,
 *   targetTop: number,
 *   targetBottom: number,
 *   labelWidth: number,
 *   labelHeight: number,
 *   viewportWidth: number,
 *   viewportHeight: number,
 * }} input
 * @returns {{ x: number, y: number }}
 */
function computeLabelPosition(input) {
  const { targetLeft, targetTop, targetBottom, labelWidth, labelHeight } = input;
  const { viewportWidth, viewportHeight } = input;

  let x = targetLeft;
  const maxX = viewportWidth - labelWidth - VIEWPORT_MARGIN;
  if (x > maxX) x = maxX;
  if (x < VIEWPORT_MARGIN) x = VIEWPORT_MARGIN;

  let y = targetTop - labelHeight - LABEL_GAP;
  if (y < VIEWPORT_MARGIN) {
    y = targetBottom + LABEL_GAP;
    if (y + labelHeight > viewportHeight - VIEWPORT_MARGIN) {
      y = Math.max(VIEWPORT_MARGIN, viewportHeight - labelHeight - VIEWPORT_MARGIN);
    }
  }

  return { x, y };
}

module.exports = {
  computeLabelPosition,
};
