// Keep a tree mounted through its CSS exit transition. Overlay, popover, and
// fade recipes in ui-theme motion.css read `data-state` from this hook; the
// caller still owns `open` and unmounts only after `mounted` falls.
// Mounting is a layout effect so focus and measure see the tree before paint;
// `data-state="open"` still waits two animation frames so the enter recipe runs.

import { useEffect, useLayoutEffect, useState } from 'react'
import { useMinimalMode } from './reduced-effects.ts'

/** Exit hold in milliseconds; matches `--ds-motion-duration-overlay` (200ms). */
export const PRESENCE_EXIT_MS = 200

/** Visibility written onto `data-state` for the shared motion recipes. */
export type PresenceState = 'open' | 'closed'

/**
 * Whether the user asked the OS to drop non-essential motion.
 * @returns true when `prefers-reduced-motion: reduce` matches.
 */
function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

/**
 * Keep a tree mounted through its CSS exit transition.
 * @param open - whether the caller wants the tree shown.
 * @param durationMs - exit hold before unmount; default matches the overlay token (200).
 * @returns `mounted` (whether to render) and `state` (`open` | `closed`) for `data-state`.
 */
export function usePresence(open: boolean, durationMs: number = PRESENCE_EXIT_MS): {
  mounted: boolean
  state: PresenceState
} {
  const minimal = useMinimalMode()
  const [mounted, setMounted] = useState(open)
  const [state, setState] = useState<PresenceState>(open && prefersReducedMotion() ? 'open' : 'closed')

  useLayoutEffect(() => {
    if (open) {
      setMounted(true)
      if (minimal || prefersReducedMotion()) {
        setState('open')
        return
      }
      let inner = 0
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => { setState('open') })
      })
      return () => {
        cancelAnimationFrame(outer)
        cancelAnimationFrame(inner)
      }
    }
    setState('closed')
  }, [open, minimal])

  useEffect(() => {
    if (open || !mounted) return
    if (minimal || prefersReducedMotion()) {
      setMounted(false)
      return
    }
    const timer = setTimeout(() => { setMounted(false) }, durationMs)
    return () => { clearTimeout(timer) }
  }, [open, mounted, durationMs, minimal])

  // Mount in the opening render itself: consumer focus/placement effects run
  // in that commit and must see the new refs, even before this hook's state update.
  return { mounted: open || mounted, state }
}
