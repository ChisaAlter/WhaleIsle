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
 * Render the Whale Isle wordmark with the transparent head and Harness attribution.
 * @returns the Whale Isle wordmark.
 */
export function OfficialBrandName() {
  return (
    <span className={css.wordmark} data-whale-isle-brand="name">
      <img className={css.avatar} src="/whale-isle-head.png" alt="" data-dsh-mascot="default" />
      <img className={css.avatar} src="claude-isle-head.png" alt="" data-dsh-mascot="claude" />
      <span className={css.nameBlock}>
        <span className={css.titleRow}>
          <span className={css.chineseName}><span>鲸</span><span className={css.isleGlyph}>屿</span></span>
          <span className={css.englishName}>WHALE <span className={css.isleWord}>ISLE</span></span>
        </span>
        <span className={css.attribution}>BASED ON DEEPSEEK HARNESS</span>
      </span>
    </span>
  )
}
