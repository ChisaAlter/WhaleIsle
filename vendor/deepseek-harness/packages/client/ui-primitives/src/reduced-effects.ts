import { useEffect, useState } from 'react'

/** Document rendering policy shared by motion and decorative primitives. */
export function minimalModeActive(): boolean {
  return typeof document !== 'undefined' && document.documentElement.hasAttribute('data-dsh-minimal')
}

/** Follow live document policy changes without polling or a per-frame subscription. */
export function useMinimalMode(): boolean {
  const [minimal, setMinimal] = useState(minimalModeActive)
  useEffect(() => {
    const update = (): void => { setMinimal(minimalModeActive()) }
    document.addEventListener('dsh:render-mode', update)
    update()
    return () => { document.removeEventListener('dsh:render-mode', update) }
  }, [])
  return minimal
}
