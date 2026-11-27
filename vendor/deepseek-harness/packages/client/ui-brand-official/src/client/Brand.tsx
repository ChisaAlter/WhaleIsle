import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './Brand.module.css'

/**
 * Supply the transparent head to the collapsed sidebar's brand-mark slot.
 */
export function OfficialBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return (
    <>
      <img className={css.railAvatar} src="/whale-isle-head.png" width={size} height={size} alt="" data-whale-isle-brand="mark" data-dsh-mascot="default" />
      <img className={css.railAvatar} src="claude-isle-head.png" width={size} height={size} alt="" data-whale-isle-brand="mark" data-dsh-mascot="claude" />
    </>
  )
}

/**
 * Render the WhaleIsle wordmark with the transparent head and Harness attribution.
 * @returns the WhaleIsle wordmark.
 */
export function OfficialBrandName() {
  return (
    <span className={css.wordmark} data-whale-isle-brand="name">
      <img className={css.avatar} src="/whale-isle-head.png" alt="" data-dsh-mascot="default" />
      <img className={css.avatar} src="claude-isle-head.png" alt="" data-dsh-mascot="claude" />
      <span className={css.nameBlock}>
        <span className={css.titleRow}>
          <span className={css.brandName}>Whale<span className={css.isleWord}>Isle</span></span>
        </span>
        <span className={css.attribution}>BASED ON DEEPSEEK HARNESS</span>
      </span>
    </span>
  )
}
