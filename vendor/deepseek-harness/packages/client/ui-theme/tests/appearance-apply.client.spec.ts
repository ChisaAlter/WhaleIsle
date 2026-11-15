// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
  appearanceFontStack, applyAppearanceDocumentExtras, cssFontFamilies, METALLIC_PAINT_ATTR,
  quoteFontFamilyName,
} from '../src/appearance-apply.ts'
import {
  GRADIENT_ATTR, GRADIENT_LAYER_ID, TRANSPARENT_ATTR, WALLPAPER_ATTR, WALLPAPER_LAYER_ID,
  WINDOW_MATERIAL_ATTR,
} from '../src/wallpaper.ts'
import { WINDOW_MATERIAL_SUPPORTED_ATTR } from '../src/theme-settings.ts'
import { CURSOR_FX_LAYER_ID } from '../src/cursor-fx.ts'

afterEach(() => {
  document.documentElement.style.fontSize = ''
  document.documentElement.removeAttribute(METALLIC_PAINT_ATTR)
  document.documentElement.removeAttribute(WINDOW_MATERIAL_ATTR)
  document.documentElement.removeAttribute(WINDOW_MATERIAL_SUPPORTED_ATTR)
  document.documentElement.style.removeProperty('--dsw-font-family')
  document.documentElement.style.removeProperty('--ds-font-family-code')
  document.documentElement.style.removeProperty('--dsw-font-size-code')
  document.documentElement.style.removeProperty('--dsw-font-family-composer')
  document.documentElement.style.removeProperty('--dsw-font-family-terminal')
})

describe('font stack helpers', () => {
  it('quotes family names that are not CSS idents', () => {
    expect(quoteFontFamilyName('Inter')).toBe('Inter')
    expect(quoteFontFamilyName('Source Han Sans')).toBe('"Source Han Sans"')
    expect(quoteFontFamilyName('"Already"')).toBe('"Already"')
    expect(quoteFontFamilyName('  ')).toBe('')
  })

  it('turns a comma list into a CSS family list or null', () => {
    expect(cssFontFamilies('')).toBeNull()
    expect(cssFontFamilies('Inter, Source Han Sans')).toBe('Inter, "Source Han Sans"')
  })

  it('prepends a custom list to the product default stack', () => {
    expect(appearanceFontStack('', 'Arial')).toBe('Arial')
    expect(appearanceFontStack('Inter', 'Arial')).toBe('Inter, Arial')
  })
})

describe('applyAppearanceDocumentExtras', () => {
  it('writes size and family extras onto the document root', () => {
    applyAppearanceDocumentExtras({
      fontFamilySans: 'Inter',
      fontFamilyCode: 'JetBrains Mono',
      fontSizeInterface: 18,
      fontSizeCode: 14,
      fontFamilyComposer: 'Georgia',
      fontFamilyTerminal: 'IBM Plex Mono',
    })
    expect(document.documentElement.style.fontSize).toBe('18px')
    expect(document.documentElement.style.getPropertyValue('--dsw-font-family')).toContain('Inter')
    expect(document.documentElement.style.getPropertyValue('--ds-font-family-code')).toContain('JetBrains Mono')
    expect(document.documentElement.style.getPropertyValue('--dsw-font-size-code')).toBe('14px')
    expect(document.documentElement.style.getPropertyValue('--dsw-font-family-composer')).toContain('Georgia')
    expect(document.documentElement.style.getPropertyValue('--dsw-font-family-terminal')).toContain('IBM Plex Mono')
  })

  it('falls back to product defaults when sizes are zero', () => {
    applyAppearanceDocumentExtras({
      fontFamilySans: '',
      fontFamilyCode: '',
      fontSizeInterface: 0,
      fontSizeCode: 0,
    })
    expect(document.documentElement.style.fontSize).toBe('16px')
    expect(document.documentElement.style.getPropertyValue('--dsw-font-size-code')).toBe('13px')
  })

  it('paints and clears the wallpaper layer from appearance extras', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    applyAppearanceDocumentExtras({
      fontFamilySans: '',
      fontFamilyCode: '',
      fontSizeInterface: 16,
      fontSizeCode: 13,
      wallpaperImage: png,
      wallpaperBlur: 50,
      wallpaperPixelate: 25,
    })
    expect(document.documentElement.hasAttribute(WALLPAPER_ATTR)).toBe(true)
    expect(document.getElementById(WALLPAPER_LAYER_ID)).not.toBeNull()
    expect(document.documentElement.style.getPropertyValue('--dsh-wallpaper-blur')).toBe('20px')
    applyAppearanceDocumentExtras({
      fontFamilySans: '',
      fontFamilyCode: '',
      fontSizeInterface: 16,
      fontSizeCode: 13,
    })
    expect(document.documentElement.hasAttribute(WALLPAPER_ATTR)).toBe(false)
    expect(document.getElementById(WALLPAPER_LAYER_ID)).toBeNull()
  })

  it('paints the ambient gradient only while no wallpaper is set', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const base = { fontFamilySans: '', fontFamilyCode: '', fontSizeInterface: 16, fontSizeCode: 13 }
    applyAppearanceDocumentExtras({ ...base, backgroundEffect: 'gradient' })
    expect(document.documentElement.hasAttribute(GRADIENT_ATTR)).toBe(true)
    expect(document.getElementById(GRADIENT_LAYER_ID)).not.toBeNull()
    applyAppearanceDocumentExtras({ ...base, backgroundEffect: 'gradient', wallpaperImage: png })
    expect(document.documentElement.hasAttribute(GRADIENT_ATTR)).toBe(false)
    expect(document.documentElement.hasAttribute(WALLPAPER_ATTR)).toBe(true)
    applyAppearanceDocumentExtras(base)
    expect(document.documentElement.hasAttribute(GRADIENT_ATTR)).toBe(false)
    expect(document.getElementById(WALLPAPER_LAYER_ID)).toBeNull()
  })

  it('accepts pointer-effect extras and fails closed without canvas support', () => {
    const base = { fontFamilySans: '', fontFamilyCode: '', fontSizeInterface: 16, fontSizeCode: 13 }
    applyAppearanceDocumentExtras({
      ...base,
      cursorEffectEnabled: true,
      cursorEffect: 'trail',
      cursorEffectColors: ['#112233'],
      cursorEffectSpeed: 100,
      cursorEffectSize: 100,
    })
    // jsdom has no canvas 2D: the engine fails closed and leaves no residue.
    expect(document.getElementById(CURSOR_FX_LAYER_ID)).toBeNull()
  })

  it('flips the transparent-theme attribute only while a wallpaper is live', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const base = { fontFamilySans: '', fontFamilyCode: '', fontSizeInterface: 16, fontSizeCode: 13 }
    // Flag on without a wallpaper: the attribute stays off.
    applyAppearanceDocumentExtras({ ...base, transparentTheme: true })
    expect(document.documentElement.hasAttribute(TRANSPARENT_ATTR)).toBe(false)
    // Flag plus wallpaper: the attribute lands.
    applyAppearanceDocumentExtras({ ...base, transparentTheme: true, wallpaperImage: png })
    expect(document.documentElement.hasAttribute(TRANSPARENT_ATTR)).toBe(true)
    // Flag off clears it again.
    applyAppearanceDocumentExtras({ ...base, transparentTheme: false, wallpaperImage: png })
    expect(document.documentElement.hasAttribute(TRANSPARENT_ATTR)).toBe(false)
    applyAppearanceDocumentExtras(base)
  })

  it('marks the window material and suppresses painted backdrops while acrylic is effective', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const base = { fontFamilySans: '', fontFamilyCode: '', fontSizeInterface: 16, fontSizeCode: 13 }
    document.documentElement.setAttribute(WINDOW_MATERIAL_SUPPORTED_ATTR, '')
    // Flag on with support: the material attribute lands and a stored
    // wallpaper stops painting so it cannot cover the native blur.
    applyAppearanceDocumentExtras({ ...base, windowAcrylic: true, wallpaperImage: png })
    expect(document.documentElement.getAttribute(WINDOW_MATERIAL_ATTR)).toBe('acrylic')
    expect(document.documentElement.hasAttribute(WALLPAPER_ATTR)).toBe(false)
    expect(document.getElementById(WALLPAPER_LAYER_ID)).toBeNull()
    // Flag off: the stored wallpaper paints again.
    applyAppearanceDocumentExtras({ ...base, windowAcrylic: false, wallpaperImage: png })
    expect(document.documentElement.hasAttribute(WINDOW_MATERIAL_ATTR)).toBe(false)
    expect(document.documentElement.hasAttribute(WALLPAPER_ATTR)).toBe(true)
    expect(document.getElementById(WALLPAPER_LAYER_ID)).not.toBeNull()
    applyAppearanceDocumentExtras(base)
    expect(document.getElementById(WALLPAPER_LAYER_ID)).toBeNull()
  })

  it('keeps the material attribute inert without shell support or under minimal mode', () => {
    const base = { fontFamilySans: '', fontFamilyCode: '', fontSizeInterface: 16, fontSizeCode: 13 }
    // No support mark: the flag stays inert and the gradient still paints.
    applyAppearanceDocumentExtras({ ...base, windowAcrylic: true, backgroundEffect: 'gradient' })
    expect(document.documentElement.hasAttribute(WINDOW_MATERIAL_ATTR)).toBe(false)
    expect(document.documentElement.hasAttribute(GRADIENT_ATTR)).toBe(true)
    // Supported but minimal mode: the material attribute stays off.
    document.documentElement.setAttribute(WINDOW_MATERIAL_SUPPORTED_ATTR, '')
    applyAppearanceDocumentExtras({ ...base, windowAcrylic: true, minimalMode: true })
    expect(document.documentElement.hasAttribute(WINDOW_MATERIAL_ATTR)).toBe(false)
    expect(document.documentElement.hasAttribute(GRADIENT_ATTR)).toBe(false)
    applyAppearanceDocumentExtras(base)
  })

  it('pauses the transparent theme while acrylic suppresses its wallpaper', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const base = { fontFamilySans: '', fontFamilyCode: '', fontSizeInterface: 16, fontSizeCode: 13 }
    document.documentElement.setAttribute(WINDOW_MATERIAL_SUPPORTED_ATTR, '')
    // Acrylic suppresses the painted wallpaper, so the transparent theme
    // that needs it pauses too.
    applyAppearanceDocumentExtras({ ...base, windowAcrylic: true, transparentTheme: true, wallpaperImage: png })
    expect(document.documentElement.getAttribute(WINDOW_MATERIAL_ATTR)).toBe('acrylic')
    expect(document.documentElement.hasAttribute(TRANSPARENT_ATTR)).toBe(false)
    expect(document.getElementById(WALLPAPER_LAYER_ID)).toBeNull()
    // Flag off: the stored wallpaper returns and the transparent theme resumes.
    applyAppearanceDocumentExtras({ ...base, windowAcrylic: false, transparentTheme: true, wallpaperImage: png })
    expect(document.documentElement.hasAttribute(WINDOW_MATERIAL_ATTR)).toBe(false)
    expect(document.documentElement.hasAttribute(TRANSPARENT_ATTR)).toBe(true)
    applyAppearanceDocumentExtras(base)
  })

  it('flips the metallic-paint attribute from the button-sheen flag', () => {
    const base = { fontFamilySans: '', fontFamilyCode: '', fontSizeInterface: 16, fontSizeCode: 13 }
    // Absent flag matches the shipped default: the sheen stays off.
    applyAppearanceDocumentExtras(base)
    expect(document.documentElement.hasAttribute(METALLIC_PAINT_ATTR)).toBe(false)
    applyAppearanceDocumentExtras({ ...base, metallicPaintEnabled: false })
    expect(document.documentElement.hasAttribute(METALLIC_PAINT_ATTR)).toBe(false)
    // On sets the attribute the CSS rule keys on.
    applyAppearanceDocumentExtras({ ...base, metallicPaintEnabled: true })
    expect(document.documentElement.hasAttribute(METALLIC_PAINT_ATTR)).toBe(true)
    applyAppearanceDocumentExtras({ ...base, metallicPaintEnabled: false })
    expect(document.documentElement.hasAttribute(METALLIC_PAINT_ATTR)).toBe(false)
  })
})
