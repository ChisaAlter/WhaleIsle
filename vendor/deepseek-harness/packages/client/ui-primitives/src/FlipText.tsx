// Flip a visible label to a new string with the theme `flip` recipe.
// The previous string stays mounted through the outgoing animation, then
// drops. Reduced motion replaces the text immediately.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useMinimalMode } from './reduced-effects.ts'

/** Exit hold in milliseconds; matches `--ds-motion-duration-flip` (400ms). */
export const FLIP_TEXT_MS = 400

/**
 * Whether the user asked the OS to drop non-essential motion.
 * @returns true when `prefers-reduced-motion: reduce` matches.
 */
function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

export interface FlipTextProps {
  /** Visible label. A change plays the flip; the first value does not. */
  text: string
  /** Optional class on the flip root (ellipsis, tone). */
  className?: string | undefined
}

/**
 * Render a label that flips to `text` when that string changes.
 * @param props.text - the current label.
 * @param props.className - optional class on the flip root (ellipsis, tone).
 * @returns the flipping label.
 */
export function FlipText({ text, className }: FlipTextProps) {
  const minimal = useMinimalMode()
  const shownRef = useRef(text)
  const [outgoing, setOutgoing] = useState<string | null>(null)

  useLayoutEffect(() => {
    if (text === shownRef.current) return
    const previous = shownRef.current
    shownRef.current = text
    if (minimal || prefersReducedMotion()) {
      setOutgoing(null)
      return
    }
    setOutgoing(previous)
  }, [text, minimal])

  useEffect(() => {
    if (minimal) { setOutgoing(null); return }
    if (outgoing === null) return
    const timer = setTimeout(() => { setOutgoing(null) }, FLIP_TEXT_MS)
    return () => { clearTimeout(timer) }
  }, [outgoing, minimal])

  return (
    <span className={className} data-dsh-motion="flip">
      {outgoing !== null && (
        <span data-dsh-motion-part="outgoing" aria-hidden>{outgoing}</span>
      )}
      <span data-dsh-motion-part="current">{text}</span>
    </span>
  )
}
