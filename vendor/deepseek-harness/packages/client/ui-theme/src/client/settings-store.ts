/**
 * Appearance and font row slot stores: mirrors of the theme service
 * snapshot. The plugin's apply-world change listener is the only writer; the
 * page and rows read via props.useStore.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import { DEFAULT_FAMILY_ID, type ThemeFamily } from '../theme-family.ts'
import {
  DEFAULT_FONT_SIZES, DEFAULT_THEME_SETTINGS, type FontFamilies, type FontSizes, type BackgroundEffect, type ThemePreference,
  type ThemeSettings, type WallpaperFavorite, type WallpaperSource,
} from '../theme-settings.ts'
import { normalizeCursorEffect } from '../cursor-fx.ts'

/** Fields the Appearance page mirrors from a theme snapshot. */
export interface AppearanceSyncSnapshot {
  /** Persisted color-scheme preference. */
  preference: ThemePreference
  /** Resolved active theme; only its color scheme is mirrored. */
  active: { colorScheme: 'light' | 'dark' }
  /** Family painting the light half. */
  activeLightThemeId: string
  /** Family painting the dark half. */
  activeDarkThemeId: string
  /** Builtin plus custom families. */
  families: readonly ThemeFamily[]
  /** User-created families. */
  customThemes: readonly ThemeFamily[]
  /** Overlay solidity percent. */
  glassOpacity: number
  /** Terminal pane solidity percent under a live backdrop. */
  terminalOpacity: number
  /** Transparent theme flag; effective only while a wallpaper is set. */
  transparentTheme: boolean
  /** Sidebar mask flag; the rail paints the canvas fill while on. */
  sidebarMaskHidden: boolean
  /** Wallpaper data URL; empty means no wallpaper. */
  wallpaperImage: string
  /** Frosted-glass blur on the wallpaper, 0–100. */
  wallpaperBlur: number
  /** Pixelation on the wallpaper, 0–100. */
  wallpaperPixelate: number
  /** Whether desktop Bing rows are included in the gallery. */
  wallpaperBingEnabled?: boolean
  /** HTTPS custom wallpaper catalogs. */
  wallpaperCatalogUrls?: readonly string[]
  /** Gallery sources. */
  wallpaperSources?: readonly WallpaperSource[]
  /** Starred gallery items. */
  wallpaperFavorites?: readonly WallpaperFavorite[]
  /** Ambient backdrop effect painted while no wallpaper is set. */
  backgroundEffect?: BackgroundEffect
  /** Ambient backdrop color overrides (theme tokens paint empty slots). */
  backgroundEffectColors?: readonly string[]
  /** Ambient backdrop speed percent. */
  backgroundEffectSpeed?: number
  /** Ambient backdrop bloom count. */
  backgroundEffectCount?: number
  /** Selected backdrop scheme: a preset id or `custom`. */
  backgroundEffectPreset?: ThemeSettings['backgroundEffectPreset']
  /** Bloom shape variant the gradient paints. */
  backgroundEffectVariant?: ThemeSettings['backgroundEffectVariant']
  /** Pointer decoration layer switch (指针特效). */
  cursorEffectEnabled?: boolean
  /** Pointer decoration: `trail` or `splash`. */
  cursorEffect?: ThemeSettings['cursorEffect']
  /** Pointer palette overrides; empty follows the theme accent. */
  cursorEffectColors?: readonly string[]
  /** Pointer decoration speed percent. */
  cursorEffectSpeed?: number
  /** Pointer decoration size percent. */
  cursorEffectSize?: number
  /** Selected pointer scheme: a preset id or `custom`. */
  cursorEffectPreset?: ThemeSettings['cursorEffectPreset']
  /** Button hover sheen switch (按钮悬停光泽). */
  metallicPaintEnabled?: boolean
  /** Interface font preference. */
  fontFamilySans: string
  /** Monospace font preference. */
  fontFamilyCode: string
  /** Root font size in px. */
  fontSizeInterface: number
  /** Code font size in px. */
  fontSizeCode: number
  /** Composer font preference. */
  fontFamilyComposer: string
  /** Terminal font preference. */
  fontFamilyTerminal: string
}

/** Store state mirrored from the theme snapshot. */
export interface AppearanceRowState {
  /** Persisted color-scheme preference. */
  preference: ThemePreference
  /** Which half is currently painting (`system` resolved). */
  resolvedMode: 'light' | 'dark'
  /** Family painting the light half. */
  activeLightThemeId: string
  /** Family painting the dark half. */
  activeDarkThemeId: string
  /** Builtin plus custom families. */
  families: readonly ThemeFamily[]
  /** User-created families. */
  customThemes: readonly ThemeFamily[]
  /** Overlay solidity percent. */
  glassOpacity: number
  /** Terminal pane solidity percent under a live backdrop. */
  terminalOpacity: number
  /** Transparent theme flag; effective only while a wallpaper is set. */
  transparentTheme: boolean
  /** Sidebar mask flag; the rail paints the canvas fill while on. */
  sidebarMaskHidden: boolean
  /** Wallpaper data URL; empty means no wallpaper. */
  wallpaperImage: string
  /** Frosted-glass blur on the wallpaper, 0–100. */
  wallpaperBlur: number
  /** Pixelation on the wallpaper, 0–100. */
  wallpaperPixelate: number
  /** Whether desktop Bing rows are included in the gallery. */
  wallpaperBingEnabled: boolean
  /** HTTPS custom wallpaper catalogs. */
  wallpaperCatalogUrls: readonly string[]
  /** Gallery sources. */
  wallpaperSources: readonly WallpaperSource[]
  /** Starred gallery items. */
  wallpaperFavorites: readonly WallpaperFavorite[]
  /** Ambient backdrop effect painted while no wallpaper is set. */
  backgroundEffect: BackgroundEffect
  /** Ambient backdrop color overrides (theme tokens paint empty slots). */
  backgroundEffectColors: readonly string[]
  /** Ambient backdrop speed percent. */
  backgroundEffectSpeed: number
  /** Ambient backdrop bloom count. */
  backgroundEffectCount: number
  /** Selected backdrop scheme: a preset id or `custom`. */
  backgroundEffectPreset: ThemeSettings['backgroundEffectPreset']
  /** Bloom shape variant the gradient paints. */
  backgroundEffectVariant: ThemeSettings['backgroundEffectVariant']
  /** Pointer decoration layer switch (指针特效). */
  cursorEffectEnabled: boolean
  /** Pointer decoration: `trail` or `splash`. */
  cursorEffect: ThemeSettings['cursorEffect']
  /** Pointer palette overrides; empty follows the theme accent. */
  cursorEffectColors: readonly string[]
  /** Pointer decoration speed percent. */
  cursorEffectSpeed: number
  /** Pointer decoration size percent. */
  cursorEffectSize: number
  /** Selected pointer scheme: a preset id or `custom`. */
  cursorEffectPreset: ThemeSettings['cursorEffectPreset']
  /** Button hover sheen switch (按钮悬停光泽). */
  metallicPaintEnabled: boolean
  /** Interface font preference. */
  fontFamilySans: string
  /** Monospace font preference. */
  fontFamilyCode: string
  /** Root font size in px. */
  fontSizeInterface: number
  /** Code font size in px. */
  fontSizeCode: number
  /** Composer font preference. */
  fontFamilyComposer: string
  /** Terminal font preference. */
  fontFamilyTerminal: string
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type AppearanceRowActions = {
  sync: (draft: AppearanceRowState, snapshot: AppearanceSyncSnapshot, revision: number) => void
}

const EMPTY: Omit<AppearanceRowState, 'revision'> = {
  preference: DEFAULT_THEME_SETTINGS.preference,
  resolvedMode: 'light',
  activeLightThemeId: DEFAULT_FAMILY_ID,
  activeDarkThemeId: DEFAULT_FAMILY_ID,
  families: [],
  customThemes: [],
  glassOpacity: DEFAULT_THEME_SETTINGS.glassOpacity,
  terminalOpacity: DEFAULT_THEME_SETTINGS.terminalOpacity,
  transparentTheme: DEFAULT_THEME_SETTINGS.transparentTheme,
  sidebarMaskHidden: DEFAULT_THEME_SETTINGS.sidebarMaskHidden,
  wallpaperImage: '',
  wallpaperBlur: DEFAULT_THEME_SETTINGS.wallpaperBlur,
  wallpaperPixelate: DEFAULT_THEME_SETTINGS.wallpaperPixelate,
  wallpaperBingEnabled: false,
  wallpaperCatalogUrls: [],
  wallpaperSources: DEFAULT_THEME_SETTINGS.wallpaperSources,
  wallpaperFavorites: [],
  backgroundEffect: DEFAULT_THEME_SETTINGS.backgroundEffect,
  backgroundEffectColors: DEFAULT_THEME_SETTINGS.backgroundEffectColors,
  backgroundEffectSpeed: DEFAULT_THEME_SETTINGS.backgroundEffectSpeed,
  backgroundEffectCount: DEFAULT_THEME_SETTINGS.backgroundEffectCount,
  backgroundEffectPreset: DEFAULT_THEME_SETTINGS.backgroundEffectPreset,
  backgroundEffectVariant: DEFAULT_THEME_SETTINGS.backgroundEffectVariant,
  cursorEffectEnabled: DEFAULT_THEME_SETTINGS.cursorEffectEnabled,
  cursorEffect: DEFAULT_THEME_SETTINGS.cursorEffect,
  cursorEffectColors: DEFAULT_THEME_SETTINGS.cursorEffectColors,
  cursorEffectSpeed: DEFAULT_THEME_SETTINGS.cursorEffectSpeed,
  cursorEffectSize: DEFAULT_THEME_SETTINGS.cursorEffectSize,
  cursorEffectPreset: DEFAULT_THEME_SETTINGS.cursorEffectPreset,
  metallicPaintEnabled: DEFAULT_THEME_SETTINGS.metallicPaintEnabled,
  fontFamilySans: '',
  fontFamilyCode: '',
  fontSizeInterface: DEFAULT_THEME_SETTINGS.fontSizeInterface,
  fontSizeCode: DEFAULT_THEME_SETTINGS.fontSizeCode,
  fontFamilyComposer: '',
  fontFamilyTerminal: '',
}

/**
 * Declares the Appearance page state and write surface.
 * @returns the store handle.
 */
export function createAppearanceRowStore(): EngineStoreHandle<AppearanceRowState, AppearanceRowActions> {
  return defineStore({
    init: (): AppearanceRowState => ({ ...EMPTY, families: [], customThemes: [], revision: -1 }),
    actions: {
      sync: (d, snapshot: AppearanceSyncSnapshot, revision: number) => {
        if (revision <= d.revision) return
        d.preference = snapshot.preference
        d.resolvedMode = snapshot.active.colorScheme
        d.activeLightThemeId = snapshot.activeLightThemeId
        d.activeDarkThemeId = snapshot.activeDarkThemeId
        d.families = snapshot.families
        d.customThemes = snapshot.customThemes
        d.glassOpacity = snapshot.glassOpacity
        d.terminalOpacity = snapshot.terminalOpacity
        d.transparentTheme = snapshot.transparentTheme
        d.sidebarMaskHidden = snapshot.sidebarMaskHidden
        d.wallpaperImage = snapshot.wallpaperImage
        d.wallpaperBlur = snapshot.wallpaperBlur
        d.wallpaperPixelate = snapshot.wallpaperPixelate
        d.wallpaperBingEnabled = snapshot.wallpaperBingEnabled ?? false
        d.wallpaperCatalogUrls = snapshot.wallpaperCatalogUrls ?? []
        d.wallpaperSources = snapshot.wallpaperSources ?? DEFAULT_THEME_SETTINGS.wallpaperSources
        d.wallpaperFavorites = snapshot.wallpaperFavorites ?? []
        d.backgroundEffect = snapshot.backgroundEffect ?? DEFAULT_THEME_SETTINGS.backgroundEffect
        d.backgroundEffectColors = snapshot.backgroundEffectColors ?? DEFAULT_THEME_SETTINGS.backgroundEffectColors
        d.backgroundEffectSpeed = snapshot.backgroundEffectSpeed ?? DEFAULT_THEME_SETTINGS.backgroundEffectSpeed
        d.backgroundEffectCount = snapshot.backgroundEffectCount ?? DEFAULT_THEME_SETTINGS.backgroundEffectCount
        d.backgroundEffectPreset = snapshot.backgroundEffectPreset ?? DEFAULT_THEME_SETTINGS.backgroundEffectPreset
        d.backgroundEffectVariant = snapshot.backgroundEffectVariant ?? DEFAULT_THEME_SETTINGS.backgroundEffectVariant
        d.cursorEffectEnabled = snapshot.cursorEffectEnabled ?? DEFAULT_THEME_SETTINGS.cursorEffectEnabled
        d.cursorEffect = normalizeCursorEffect(snapshot.cursorEffect)
        d.cursorEffectColors = snapshot.cursorEffectColors ?? DEFAULT_THEME_SETTINGS.cursorEffectColors
        d.cursorEffectSpeed = snapshot.cursorEffectSpeed ?? DEFAULT_THEME_SETTINGS.cursorEffectSpeed
        d.cursorEffectSize = snapshot.cursorEffectSize ?? DEFAULT_THEME_SETTINGS.cursorEffectSize
        d.cursorEffectPreset = snapshot.cursorEffectPreset ?? DEFAULT_THEME_SETTINGS.cursorEffectPreset
        d.metallicPaintEnabled = snapshot.metallicPaintEnabled ?? DEFAULT_THEME_SETTINGS.metallicPaintEnabled
        d.fontFamilySans = snapshot.fontFamilySans
        d.fontFamilyCode = snapshot.fontFamilyCode
        d.fontSizeInterface = snapshot.fontSizeInterface
        d.fontSizeCode = snapshot.fontSizeCode
        d.fontFamilyComposer = snapshot.fontFamilyComposer
        d.fontFamilyTerminal = snapshot.fontFamilyTerminal
        d.revision = revision
      },
    },
  })
}

/** Store state mirrored from the theme snapshot's fonts (shared by the font-size row and the font settings group). */
export interface FontRowState {
  /** Persisted font sizes in px by role. */
  fontSizes: FontSizes
  /** Persisted normalized font lists by role. */
  fontFamilies: FontFamilies
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type FontRowActions = {
  sync: (draft: FontRowState, fontSizes: FontSizes, fontFamilies: FontFamilies, revision: number) => void
}

/**
 * Declares the font rows' state and write surface.
 * @returns the store handle.
 */
export function createFontRowStore(): EngineStoreHandle<FontRowState, FontRowActions> {
  return defineStore({
    init: (): FontRowState => ({ fontSizes: DEFAULT_FONT_SIZES, fontFamilies: { text: '', code: '', terminal: '' }, revision: -1 }),
    actions: {
      sync: (d, fontSizes: FontSizes, fontFamilies: FontFamilies, revision: number) => {
        if (revision <= d.revision) return
        d.fontSizes = fontSizes
        d.fontFamilies = fontFamilies
        d.revision = revision
      },
    },
  })
}

export type { ThemeSettings }
