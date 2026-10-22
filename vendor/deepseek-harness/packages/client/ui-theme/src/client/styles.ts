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
 * Mount the global theme sheets for exactly the owning plugin lifetime.
 * @param ctx - Owning plugin context.
 */
export function installThemeStyles(ctx: Context): void {
  if (typeof document === 'undefined') return
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
