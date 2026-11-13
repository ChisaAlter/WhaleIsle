/** Document extras the presenter does not own: root font-size and family stacks. */

import {
  DEFAULT_CODE_FONT_SIZE,
  DEFAULT_INTERFACE_FONT_SIZE,
} from './theme-family.ts'
import { TRANSPARENT_ATTR, applyWallpaperLayer, isWallpaperDataUrl } from './wallpaper.ts'
import { applyCursorFxLayer } from './cursor-fx.ts'
import type { BackgroundEffect } from './theme-settings.ts'

const DEFAULT_SANS_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif"
const DEFAULT_CODE_STACK = "'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, Courier, 'PingFang SC', 'Microsoft YaHei'"

/** Root attribute gating the button hover sheen in `metallic-paint.css`. */
export const METALLIC_PAINT_ATTR = 'data-dsh-metallic-paint'

/**
 * Quote a user-entered family name when it is not a bare CSS ident.
 * @param name - one family token.
 * @returns a safe CSS family token.
 */
export function quoteFontFamilyName(name: string): string {
  const bare = name.trim()
  if (bare.length === 0) return ''
  if (/^(['"]).*\1$/.test(bare)) return bare
  if (/^[a-zA-Z][a-zA-Z0-9-]*$/.test(bare)) return bare
  return `"${bare.replaceAll('"', '')}"`
}

/**
 * Turn a user font preference into a CSS font-family list, or null when empty.
 * @param input - one name or a comma-separated list.
 * @returns a CSS list, or null.
 */
export function cssFontFamilies(input: string): string | null {
  const families = input.split(',').map(quoteFontFamilyName).filter(name => name.length > 0)
  return families.length > 0 ? families.join(', ') : null
}

/**
 * Prepend a custom family list to the product default stack.
 * @param custom - user preference.
 * @param defaultStack - sheet default.
 * @returns the resolved stack.
 */
export function appearanceFontStack(custom: string, defaultStack: string): string {
  const families = cssFontFamilies(custom)
  return families === null ? defaultStack : `${families}, ${defaultStack}`
}

/** Font and size extras applied on the document root. */
export interface AppearanceDocumentExtras {
  /** Suspend decorative layers; saved values remain unchanged. */
  minimalMode?: boolean
  /** Interface font preference. */
  fontFamilySans: string
  /** Monospace font preference. */
  fontFamilyCode: string
  /** Root font size in px. */
  fontSizeInterface: number
  /** Code font size in px (published as a custom property). */
  fontSizeCode: number
  /** Composer font preference. */
  fontFamilyComposer?: string
  /** Terminal font preference. */
  fontFamilyTerminal?: string
  /** Wallpaper data URL; empty clears the layer. */
  wallpaperImage?: string
  /** Frosted-glass blur percent. */
  wallpaperBlur?: number
  /** Pixelation percent. */
  wallpaperPixelate?: number
  /** Ambient backdrop effect; paints only while no wallpaper is set. */
  backgroundEffect?: BackgroundEffect
  /** Ambient backdrop color overrides (theme tokens paint empty slots). */
  backgroundEffectColors?: readonly string[]
  /** Ambient backdrop speed percent. */
  backgroundEffectSpeed?: number
  /** Ambient backdrop bloom count. */
  backgroundEffectCount?: number
  /** Bloom shape variant the gradient paints. */
  backgroundEffectVariant?: string
  /** Pointer decoration layer switch (指针特效). */
  cursorEffectEnabled?: boolean
  /** Pointer decoration: `trail` or `splash`. */
  cursorEffect?: string
  /** Pointer palette overrides; empty follows the theme accent. */
  cursorEffectColors?: readonly string[]
  /** Pointer decoration speed percent. */
  cursorEffectSpeed?: number
  /** Pointer decoration size percent. */
  cursorEffectSize?: number
  /** Transparent theme flag; effective only while a wallpaper is live. */
  transparentTheme?: boolean
  /** Button hover sheen switch (按钮悬停光泽); absent means off. */
  metallicPaintEnabled?: boolean
}

/**
 * Write typography extras onto `documentElement`. Safe in non-browser tests.
 * @param extras - current appearance extras.
 */
export function applyAppearanceDocumentExtras(extras: AppearanceDocumentExtras): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const minimal = extras.minimalMode === true
  if (root.hasAttribute('data-dsh-minimal') !== minimal) {
    root.toggleAttribute('data-dsh-minimal', minimal)
    document.dispatchEvent(new Event('dsh:render-mode'))
  }
  root.style.fontSize = `${extras.fontSizeInterface || DEFAULT_INTERFACE_FONT_SIZE}px`
  const sans = appearanceFontStack(extras.fontFamilySans, DEFAULT_SANS_STACK)
  const code = appearanceFontStack(extras.fontFamilyCode, DEFAULT_CODE_STACK)
  root.style.setProperty('--dsw-font-family', sans)
  root.style.setProperty('--ds-font-family-code', code)
  root.style.setProperty('--dsw-font-size-code', `${extras.fontSizeCode || DEFAULT_CODE_FONT_SIZE}px`)
  root.style.setProperty(
    '--dsw-font-family-composer',
    appearanceFontStack(extras.fontFamilyComposer ?? '', sans),
  )
  root.style.setProperty(
    '--dsw-font-family-terminal',
    appearanceFontStack(extras.fontFamilyTerminal ?? '', code),
  )
  const wallpaperImage = minimal ? '' : extras.wallpaperImage ?? ''
  applyWallpaperLayer({
    wallpaperImage,
    wallpaperBlur: extras.wallpaperBlur ?? 0,
    wallpaperPixelate: extras.wallpaperPixelate ?? 0,
    backgroundEffect: minimal ? 'none' : extras.backgroundEffect ?? 'none',
    backgroundEffectColors: extras.backgroundEffectColors ?? [],
    backgroundEffectSpeed: extras.backgroundEffectSpeed,
    backgroundEffectCount: extras.backgroundEffectCount,
    backgroundEffectVariant: extras.backgroundEffectVariant,
  })
  applyCursorFxLayer({
    cursorEffectEnabled: !minimal && extras.cursorEffectEnabled === true,
    cursorEffect: extras.cursorEffect,
    cursorEffectColors: extras.cursorEffectColors ?? [],
    cursorEffectSpeed: extras.cursorEffectSpeed,
    cursorEffectSize: extras.cursorEffectSize,
  })
  root.toggleAttribute(
    TRANSPARENT_ATTR,
    !minimal && extras.transparentTheme === true && isWallpaperDataUrl(wallpaperImage),
  )
  root.toggleAttribute(METALLIC_PAINT_ATTR, !minimal && extras.metallicPaintEnabled === true)
}
