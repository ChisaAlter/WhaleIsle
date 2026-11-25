/** Theme CSS is compiled into module resources; DPR presentation follows the plugin lifetime. */
import type { Context } from '@deepseek-ai/cordis'
// motion.css follows base.css (it reads that sheet's duration and easing
// tokens); wallpaper.css follows the token sheets so chrome can mix those
// fills; scrollbar.css follows design-platform.css (it reads its tokens).
import '../styles/base.css'
import '../styles/motion.css'
import '../styles/corner-shape.css'
import '../styles/design-platform.css'
import '../styles/skins.css'
import '../styles/focus.css'
import '../styles/onboarding.css'
import '../styles/wallpaper.css'
import '../styles/scrollbar.css'
import '../styles/gradient-shadow-text.css'
import '../styles/metallic-paint.css'
import '../styles/shiki.css'
import '../styles/minimal.css'

const HAIRLINE_WIDTH = '--dsh-hairline-width'
/**
 * Publish the current document's DPR-aware stroke width for the theme plugin lifetime.
 * @param ctx - Owning plugin context.
 */
export function installThemeStyles(ctx: Context): void {
  if (typeof document === 'undefined') return
  const view = document.defaultView
  if (view !== null) ctx.effect(() => {
    const root = document.documentElement
    const previousWidth = root.style.getPropertyValue(HAIRLINE_WIDTH)
    const previousPriority = root.style.getPropertyPriority(HAIRLINE_WIDTH)
    const matchMedia = typeof view.matchMedia === 'function' ? view.matchMedia.bind(view) : undefined
    let resolution: MediaQueryList | undefined
    const updateStroke = (): void => {
      // Positive borders round down to whole device pixels, with a one-pixel minimum.
      const dpr = view.devicePixelRatio
      const width = Math.max(1, Math.floor(0.5 * dpr)) / dpr
      root.style.setProperty(HAIRLINE_WIDTH, `${width}px`)
      resolution?.removeEventListener('change', updateStroke)
      resolution = matchMedia?.(`(resolution: ${dpr}dppx)`)
      resolution?.addEventListener('change', updateStroke)
    }
    updateStroke()
    return () => {
      resolution?.removeEventListener('change', updateStroke)
      if (previousWidth === '') root.style.removeProperty(HAIRLINE_WIDTH)
      else root.style.setProperty(HAIRLINE_WIDTH, previousWidth, previousPriority)
    }
  }, 'ui-theme: DPR-aware hairline width')
}
