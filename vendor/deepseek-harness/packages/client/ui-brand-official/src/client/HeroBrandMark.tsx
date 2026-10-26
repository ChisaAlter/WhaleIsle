import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './Brand.module.css'

/** The hero keeps the default ink mark and a skin-selected color portrait. */
export function OfficialHeroBrandMark({ size, className }: HeroBrandMarkOwnerProps) {
  return (
    <span
      className={className}
      style={{ width: size, height: size }}
      aria-hidden="true"
      data-whale-isle-brand="hero-mark"
    >
      <span className={css.heroMark} style={{ width: size, height: size }} data-dsh-mascot="default" />
      <img src="claude-isle-head.png" width={size} height={size} alt="" data-dsh-mascot="claude" />
    </span>
  )
}
