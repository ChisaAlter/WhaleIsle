import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './Brand.module.css'

/** The existing Whale Isle head rendered in the hero's theme-aware ink. */
export function OfficialHeroBrandMark({ size, className }: HeroBrandMarkOwnerProps) {
  return (
    <span
      className={[css.heroMark, className].filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
      aria-hidden="true"
      data-whale-isle-brand="hero-mark"
    />
  )
}
