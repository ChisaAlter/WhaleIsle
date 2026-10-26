/** Whale Isle's running mascot beside the live Turn status. */
import css from './ChatView.module.css'

/**
 * Render the decorative mascot; CSS selects a still frame for reduced motion.
 * @returns A fixed-size seat for the running whale or skin-selected reading portrait.
 */
export function RunningWhaleGirl() {
  return (
    <span className={css.runningIcon} aria-hidden="true">
      <span className={css.runningWhaleGirl} data-dsh-mascot="default" />
      <img src="claude-isle-reading.png" width={24} height={24} alt="" data-dsh-mascot="claude" />
    </span>
  )
}
