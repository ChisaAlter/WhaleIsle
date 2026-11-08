import type { Context } from '@deepseek-ai/cordis'
import base from '../styles/base.css?inline'
import motion from '../styles/motion.css?inline'
import cornerShape from '../styles/corner-shape.css?inline'
import designPlatform from '../styles/design-platform.css?inline'
import skins from '../styles/skins.css?inline'
import focus from '../styles/focus.css?inline'
import onboarding from '../styles/onboarding.css?inline'
import wallpaper from '../styles/wallpaper.css?inline'
import scrollbar from '../styles/scrollbar.css?inline'
import gradientShadowText from '../styles/gradient-shadow-text.css?inline'
import metallicPaint from '../styles/metallic-paint.css?inline'
import shiki from '../styles/shiki.css?inline'

const PLUGIN_ID = '@deepseek-ai/dsh-client-ui-theme'
const HAIRLINE_WIDTH = '--dsh-hairline-width'

// motion.css follows base.css (it reads that sheet's duration and easing
// tokens); wallpaper.css follows the token sheets so chrome can mix those
// fills; scrollbar.css follows design-platform.css (it reads its tokens).
const STYLES = [
  ['base.css', base],
  ['motion.css', motion],
  ['corner-shape.css', cornerShape],
  ['design-platform.css', designPlatform],
  ['skins.css', skins],
  ['focus.css', focus],
  ['onboarding.css', onboarding],
  ['wallpaper.css', wallpaper],
  ['scrollbar.css', scrollbar],
  ['gradient-shadow-text.css', gradientShadowText],
  ['metallic-paint.css', metallicPaint],
  ['shiki.css', shiki],
] as const

/**
 * Mount global theme sheets; window-backed documents also publish the DPR-aware stroke width.
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
  for (const [name, css] of STYLES) {
    ctx.effect(() => {
      const tag = document.createElement('style')
      tag.dataset.plugin = PLUGIN_ID
      tag.dataset.pluginCss = `${PLUGIN_ID}/${name}`
      tag.textContent = css
      document.head.appendChild(tag)
      return () => { tag.remove() }
    }, `ui-theme: ${name} stylesheet`)
  }
}
