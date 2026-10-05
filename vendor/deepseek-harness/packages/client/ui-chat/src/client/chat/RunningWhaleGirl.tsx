/** Whale Isle's running mascot beside the live Turn status. */
import css from './ChatView.module.css'

/**
 * Render the decorative mascot; CSS selects a still frame for reduced motion.
 * @returns A fixed-size seat with the existing whale-girl running animation.
 */
export function RunningWhaleGirl() {
  return (
    <span className={css.runningIcon} aria-hidden="true">
      <span className={css.runningWhaleGirl} />
    </span>
  )
}
