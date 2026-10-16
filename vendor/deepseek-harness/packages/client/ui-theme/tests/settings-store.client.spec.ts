/** Appearance page and font-size row stores: snapshot-mirror actions and revision guards. */
import { describe, expect, it } from 'vitest'
import { createAppearanceRowStore, createFontRowStore } from '../src/client/settings-store.ts'
import type { AppearanceSyncSnapshot } from '../src/client/settings-store.ts'
import { DEFAULT_THEME_SETTINGS } from '../src/theme-settings.ts'

function snap(overrides: Partial<AppearanceSyncSnapshot> = {}): AppearanceSyncSnapshot {
  return {
    preference: DEFAULT_THEME_SETTINGS.preference,
    active: { colorScheme: 'light' },
    activeLightThemeId: 'deepseek',
    activeDarkThemeId: 'deepseek',
    families: [],
    customThemes: [],
    glassOpacity: DEFAULT_THEME_SETTINGS.glassOpacity,
    terminalOpacity: DEFAULT_THEME_SETTINGS.terminalOpacity,
    transparentTheme: false,
    sidebarMaskHidden: DEFAULT_THEME_SETTINGS.sidebarMaskHidden,
    wallpaperImage: '',
    wallpaperBlur: 0,
    wallpaperPixelate: 0,
    fontFamilySans: '',
    fontFamilyCode: '',
    fontSizeInterface: DEFAULT_THEME_SETTINGS.fontSizeInterface,
    fontSizeCode: DEFAULT_THEME_SETTINGS.fontSizeCode,
    fontFamilyComposer: '',
    fontFamilyTerminal: '',
    ...overrides,
  }
}

describe('createAppearanceRowStore', () => {
  it('init shape: system preference with revision at -1', () => {
    const store = createAppearanceRowStore().create()
    expect(store.getSnapshot()).toMatchObject({ preference: 'system', revision: -1, glassOpacity: 80 })
  })

  it('sync mirrors the snapshot and advances the revision', () => {
    const store = createAppearanceRowStore().create()
    store.actions.sync(snap({ preference: 'dark', active: { colorScheme: 'dark' }, glassOpacity: 60, wallpaperBlur: 15 }), 0)
    expect(store.getSnapshot()).toMatchObject({
      preference: 'dark', resolvedMode: 'dark', glassOpacity: 60, wallpaperBlur: 15, revision: 0,
    })
    store.actions.sync(snap({ preference: 'light' }), 2)
    expect(store.getSnapshot().preference).toBe('light')
    expect(store.getSnapshot().revision).toBe(2)
  })

  it('revision guard drops stale and duplicate writes', () => {
    const store = createAppearanceRowStore().create()
    store.actions.sync(snap({ preference: 'dark' }), 3)
    store.actions.sync(snap({ preference: 'system' }), 2)
    store.actions.sync(snap({ preference: 'system' }), 3)
    expect(store.getSnapshot().preference).toBe('dark')
    expect(store.getSnapshot().revision).toBe(3)
  })

  it('mirrors the transparent-theme flag', () => {
    const store = createAppearanceRowStore().create()
    expect(store.getSnapshot().transparentTheme).toBe(false)
    store.actions.sync(snap({ transparentTheme: true }), 0)
    expect(store.getSnapshot().transparentTheme).toBe(true)
  })

  it('mirrors the sidebar-mask flag', () => {
    const store = createAppearanceRowStore().create()
    expect(store.getSnapshot().sidebarMaskHidden).toBe(true)
    store.actions.sync(snap({ sidebarMaskHidden: false }), 0)
    expect(store.getSnapshot().sidebarMaskHidden).toBe(false)
  })

  it('mirrors the ambient backdrop effect', () => {
    const store = createAppearanceRowStore().create()
    expect(store.getSnapshot().backgroundEffect).toBe('gradient')
    store.actions.sync(snap({ backgroundEffect: 'none' }), 0)
    expect(store.getSnapshot().backgroundEffect).toBe('none')
  })

  it('mirrors the ambient effect tunables', () => {
    const store = createAppearanceRowStore().create()
    store.actions.sync(snap({
      backgroundEffectColors: ['#102030'],
      backgroundEffectSpeed: 160,
      backgroundEffectCount: 3,
      backgroundEffectPreset: 'sakura',
      backgroundEffectVariant: 'rays',
    }), 0)
    expect(store.getSnapshot()).toMatchObject({
      backgroundEffectColors: ['#102030'],
      backgroundEffectSpeed: 160,
      backgroundEffectCount: 3,
      backgroundEffectPreset: 'sakura',
      backgroundEffectVariant: 'rays',
    })
  })

  it('mirrors the pointer-effect flag, effect, and tunables', () => {
    const store = createAppearanceRowStore().create()
    expect(store.getSnapshot().cursorEffectEnabled).toBe(false)
    expect(store.getSnapshot().cursorEffect).toBe('trail')
    store.actions.sync(snap({
      cursorEffectEnabled: true,
      cursorEffect: 'splash',
      cursorEffectColors: ['#102030'],
      cursorEffectSpeed: 160,
      cursorEffectSize: 120,
      cursorEffectPreset: 'ocean',
    }), 0)
    expect(store.getSnapshot()).toMatchObject({
      cursorEffectEnabled: true,
      cursorEffect: 'splash',
      cursorEffectColors: ['#102030'],
      cursorEffectSpeed: 160,
      cursorEffectSize: 120,
      cursorEffectPreset: 'ocean',
    })
    store.actions.sync(snap({ cursorEffect: 'pixel-trail' as unknown as NonNullable<AppearanceSyncSnapshot['cursorEffect']> }), 1)
    expect(store.getSnapshot().cursorEffect).toBe('trail')
    store.actions.sync(snap({ cursorEffect: 'splash-cursor' as unknown as NonNullable<AppearanceSyncSnapshot['cursorEffect']> }), 2)
    expect(store.getSnapshot().cursorEffect).toBe('splash')
  })

  it('mirrors the button-sheen flag', () => {
    const store = createAppearanceRowStore().create()
    expect(store.getSnapshot().metallicPaintEnabled).toBe(false)
    store.actions.sync(snap({ metallicPaintEnabled: true }), 0)
    expect(store.getSnapshot().metallicPaintEnabled).toBe(true)
    store.actions.sync(snap({ metallicPaintEnabled: false }), 1)
    expect(store.getSnapshot().metallicPaintEnabled).toBe(false)
  })

  it('mirrors wallpaperSources and wallpaperFavorites', () => {
    const store = createAppearanceRowStore().create()
    const favorite = {
      id: 'bing-1',
      sourceId: 'bing',
      title: 'Lake',
      thumbUrl: 'https://example.com/t.jpg',
      imageUrl: 'https://example.com/i.jpg',
    }
    store.actions.sync(snap({ wallpaperSources: [], wallpaperFavorites: [favorite] }), 0)
    expect(store.getSnapshot().wallpaperSources).toEqual([])
    expect(store.getSnapshot().wallpaperFavorites).toEqual([favorite])
  })
})

describe('createFontRowStore', () => {
  it('init shape: default size with revision at -1', () => {
    const store = createFontRowStore().create()
    expect(store.getSnapshot()).toEqual({ fontSizes: { text: 14, code: 13, terminal: 13 }, fontFamilies: { text: '', code: '', terminal: '' }, revision: -1 })
  })

  it('sync mirrors the size; the revision guard drops stale and duplicate writes', () => {
    const store = createFontRowStore().create()
    const sizes = { text: 16, code: 12, terminal: 14 }
    const fonts = { text: '"Inter"', code: '', terminal: '' }
    store.actions.sync(sizes, { ...fonts }, 3)
    expect(store.getSnapshot()).toEqual({ fontSizes: sizes, fontFamilies: fonts, revision: 3 })
    store.actions.sync({ ...sizes, text: 12 }, fonts, 2)
    store.actions.sync({ ...sizes, text: 12 }, fonts, 3)
    expect(store.getSnapshot().fontSizes.text).toBe(16)
    expect(store.getSnapshot().revision).toBe(3)
  })
})
