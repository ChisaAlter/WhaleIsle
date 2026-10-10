/**
 * Browser theme registry over the `--dsw-*` token stylesheets. The service
 * owns the live color-scheme preference (`light`/`dark`/`system`), the
 * light/dark theme-family halves, and derived alias tokens; it resolves
 * `system` through `prefers-color-scheme` and publishes immutable snapshots.
 * It never touches the DOM — ui-layout's presenter consumes the resolved
 * snapshot. Durable fields live in the Host `ui-theme` settings section.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the ctx.configForms Context merge. Cross-plugin collaboration
// goes through the service, never a value import (client bundle purity gate).
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { AppearanceSectionInjected } from './AppearanceSection.tsx'
import { AppearanceSection } from './AppearanceSection.tsx'
import type { FontSizeRowInjected } from './FontSizeRow.tsx'
import { FontSizeRow } from './FontSizeRow.tsx'
import { applyAppearanceDocumentExtras } from '../appearance-apply.ts'
import { createAppearanceRowStore, createFontSizeRowStore } from './settings-store.ts'
import { installThemeStyles } from './styles.ts'
import { en, zh, type ThemeKey } from './locales.ts'
import { wallpaperShell } from './wallpaper-shell.ts'
import { deriveThemeTokens } from '../derive.ts'
import {
  DEFAULT_FAMILY_ID, SIDEBAR_RAIL_FILL_TOKEN, SIDEBAR_UNMASKED_FILL,
  type ThemeFamily, type ThemeTokens as FamilyTokens,
} from '../theme-family.ts'
import { listThemeFamilies, resolveThemeFamily } from '../builtin-families.ts'
import {
  BACKGROUND_EFFECT_VARIANTS, DEFAULT_BACKGROUND_EFFECT_VARIANT,
  TRANSPARENT_GLASS_SOLIDITY, TRANSPARENT_MIN_BLUR, clampBackgroundEffectCount,
  clampBackgroundEffectSpeed, clampWallpaperEffect, isWallpaperDataUrl,
  mixWallpaperSurfaces, sanitizeBackgroundEffectColors,
} from '../wallpaper.ts'
import {
  CURSOR_EFFECTS, CURSOR_EFFECT_PRESETS, DEFAULT_CURSOR_EFFECT,
  clampCursorEffectSize, clampCursorEffectSpeed, sanitizeCursorEffectColors,
} from '../cursor-fx.ts'
import {
  BACKGROUND_EFFECT_PRESETS, BACKGROUND_EFFECTS,
  DEFAULT_FONT_SIZE, DEFAULT_PREFERENCE, DEFAULT_THEME_SETTINGS, FONT_SIZE_FIELD, FONT_SIZE_MAX,
  FONT_SIZE_MIN, isThemePreference,
  THEME_BACKGROUND_EFFECT_COLORS_FIELD, THEME_BACKGROUND_EFFECT_COUNT_FIELD,
  THEME_BACKGROUND_EFFECT_FIELD,
  THEME_BACKGROUND_EFFECT_PRESET_FIELD, THEME_BACKGROUND_EFFECT_SPEED_FIELD,
  THEME_BACKGROUND_EFFECT_VARIANT_FIELD,
  THEME_CURSOR_EFFECT_COLORS_FIELD, THEME_CURSOR_EFFECT_ENABLED_FIELD,
  THEME_CURSOR_EFFECT_FIELD, THEME_CURSOR_EFFECT_PRESET_FIELD,
  THEME_CURSOR_EFFECT_SIZE_FIELD, THEME_CURSOR_EFFECT_SPEED_FIELD,
  THEME_CUSTOM_THEMES_FIELD, THEME_DARK_FAMILY_FIELD, THEME_GLASS_OPACITY_FIELD,
  THEME_LIGHT_FAMILY_FIELD, THEME_METALLIC_PAINT_FIELD,
  THEME_PREFERENCE_FIELD, THEME_SETTINGS_NAMESPACE, THEME_SIDEBAR_MASK_FIELD,
  THEME_TERMINAL_OPACITY_FIELD, THEME_TRANSPARENT_FIELD,
  THEME_WALLPAPER_BLUR_FIELD, THEME_WALLPAPER_BING_FIELD, THEME_WALLPAPER_CATALOGS_FIELD,
  THEME_WALLPAPER_FAVORITES_FIELD, THEME_WALLPAPER_IMAGE_FIELD, THEME_WALLPAPER_PIXELATE_FIELD,
  THEME_WALLPAPER_SOURCES_FIELD,
  resolveThemeSettings,
  sanitizeWallpaperCatalogUrls,
  sanitizeWallpaperFavorites,
  sanitizeWallpaperSources,
  type BackgroundEffect,
  type ThemePreference, type ThemeSettings, type WallpaperFavorite, type WallpaperSource,
} from '../theme-settings.ts'

export type { AppearanceSectionComponentProps, AppearanceSectionInjected } from './AppearanceSection.tsx'
export type { FontSizeRowComponentProps, FontSizeRowInjected } from './FontSizeRow.tsx'
export type { AppearanceRowState, FontSizeRowState } from './settings-store.ts'
export type { ThemeKey } from './locales.ts'
export type { ThemePreference, ThemeSettings, WallpaperFavorite, WallpaperSource } from '../theme-settings.ts'
export type { ThemeFamily, ThemeSeeds, ThemeTokens as FamilyThemeTokens } from '../theme-family.ts'

/** Namespace owning this feature's settings copy. */
export const SETTINGS_NS = 'settings.theme'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Appearance settings page copy. */
    'settings.theme': ThemeKey
  }
}

/** Theme token dictionary: --dsw-alias-* overrides keyed by variable name. */
export type ThemeTokens = FamilyTokens

/**
 * One override-layer token value: both palette modes are mandatory (repeat
 * the same value when the token is scheme-invariant) so an override never
 * goes illegible when the user switches to the other scheme.
 */
export interface ThemeTokenModes {
  /** Value applied while the light base palette is active. */
  light: string
  /** Value applied while the dark base palette is active. */
  dark: string
}

/** Override-layer dictionary: token names to per-mode value pairs. */
export type ThemeTokenOverrides = Record<string, ThemeTokenModes>

/** One selectable theme: id, dark/light semantics, and alias-token overrides. */
export interface ThemeDefinition {
  /** Theme id (the setTheme argument for concrete themes). */
  id: string
  /**
   * Which base palette this theme builds on. The presenter switches
   * `body[data-ds-dark-theme]` from this field — never from the id.
   */
  colorScheme: 'light' | 'dark'
  /** Alias-layer overrides applied as inline CSS variables over the base palette. */
  tokens: ThemeTokens
}

/** Immutable theme state published on every change. */
export interface ThemeSnapshot {
  /** The persisted color-scheme preference (may be `system`). */
  preference: ThemePreference
  /** Conversation content font size in px (integer within FONT_SIZE_MIN..FONT_SIZE_MAX). */
  fontSize: number
  /**
   * The resolved active theme (`system` resolved via prefers-color-scheme)
   * with family tokens and override layers folded in.
   */
  active: ThemeDefinition
  /** Registered extension themes in registration order (includes light/dark). */
  themes: readonly ThemeDefinition[]
  /** Builtin plus custom families in library order. */
  families: readonly ThemeFamily[]
  /** Family painting the light half. */
  activeLightThemeId: string
  /** Family painting the dark half. */
  activeDarkThemeId: string
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
  /** Whether the desktop gallery includes Bing rows. */
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
  /** Monotonic change counter (registry or active changes). */
  revision: number
}

/** One theme token exposed to pre-definition Cordis inspection. */
export interface ThemeTokenInspection {
  /** Token name accepted by {@link ThemeRuntime.overrideTokens}. */
  name: string
  /** Intended visual role. */
  description: string
  /** CSS value category. */
  valueType: string
  /** Whether override layers must supply both palette modes. */
  requiresLightAndDark: boolean
  /** CSS custom property consumed by UI styles. */
  cssVariable?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    theme: ThemeRuntime
  }
  interface Events {
    /**
     * Theme state changed (preference switched, registry updated, or the OS
     * color scheme changed while the preference is `system`).
     * @param snapshot - Current immutable theme snapshot.
     * @mode emit
     */
    'theme/change'(snapshot: ThemeSnapshot): void
  }
}

const BUILTIN_THEMES: readonly ThemeDefinition[] = Object.freeze([
  Object.freeze({ id: 'light', colorScheme: 'light' as const, tokens: Object.freeze({}) }),
  Object.freeze({ id: 'dark', colorScheme: 'dark' as const, tokens: Object.freeze({}) }),
])

const BUILTIN_INSPECT_TOKENS: readonly ThemeTokenInspection[] = Object.freeze([
  { name: '--dsw-alias-bg-base', description: 'Application base background.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-bg-base' },
  { name: '--dsw-alias-bg-layer-1', description: 'Primary raised surface background.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-bg-layer-1' },
  { name: '--dsw-alias-bg-layer-2', description: 'Secondary nested surface background.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-bg-layer-2' },
  { name: '--dsw-alias-bg-overlay', description: 'Overlay and popover background.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-bg-overlay' },
  { name: '--dsw-alias-border-l1', description: 'Primary subtle border.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-border-l1' },
  { name: '--dsw-alias-border-l2', description: 'Secondary stronger border.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-border-l2' },
  { name: '--dsw-alias-brand-primary', description: 'Primary brand accent.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-brand-primary' },
  { name: '--dsw-alias-label-primary', description: 'Primary text color.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-label-primary' },
  { name: '--dsw-alias-label-secondary', description: 'Secondary text color.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-label-secondary' },
  { name: '--dsw-alias-state-error-primary', description: 'Primary error state color.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-state-error-primary' },
  { name: '--dsw-alias-state-idle-primary', description: 'Primary inactive state color.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-state-idle-primary' },
  { name: '--dsw-alias-state-success-primary', description: 'Primary success state color.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-state-success-primary' },
  { name: '--dsw-alias-state-warn-primary', description: 'Primary warning state color.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-alias-state-warn-primary' },
  { name: '--dsw-specific-sidebar-fill', description: 'Sidebar column and title-row background.', valueType: 'CSS color', requiresLightAndDark: true, cssVariable: '--dsw-specific-sidebar-fill' },
  { name: '--dsw-alias-glass-opacity', description: 'Overlay and composer solidity percent.', valueType: 'CSS percentage', requiresLightAndDark: true, cssVariable: '--dsw-alias-glass-opacity' },
])

/**
 * Theme registry and preference owner. `light`/`dark` are built in (the base
 * stylesheets carry both palettes); product families derive alias-layer
 * overrides. Reads go through {@link getTheme}; color-scheme writes through
 * {@link setTheme}; half writes through {@link setThemeHalf}; continuous sync
 * only through the `theme/change` event.
 */
export class ThemeRuntime {
  private readonly ctx: ClientContext
  private readonly host: ConfigForm<ThemeSettings>
  private themes: ThemeDefinition[] = [...BUILTIN_THEMES]
  private settings: ThemeSettings = { ...DEFAULT_THEME_SETTINGS, customThemes: [] }
  private preference: ThemePreference
  private fontSize: number = bootstrapFontSize()
  private revision = 0
  private snapshot: ThemeSnapshot
  private readonly media: MediaQueryList | undefined
  private readonly overrides = new Map<string, { seq: number; tokens: ThemeTokenOverrides }>()
  private overrideSeq = 0
  private readonly pendingWrites = new Map<string, unknown>()
  private writeTimer: ReturnType<typeof setTimeout> | undefined
  private inFlightWrites = 0
  private previewedFamily: ThemeFamily | null = null

  /**
   * @param ctx - owning context (change events are emitted on it; the
   * media-query and scope listeners are released through ctx.effect on dispose).
   * @param host - durable preference scope owned by the same plugin.
   */
  constructor(ctx: ClientContext, host: ConfigForm<ThemeSettings>) {
    this.ctx = ctx
    this.host = host
    this.preference = DEFAULT_PREFERENCE
    this.media = typeof matchMedia === 'undefined' ? undefined : matchMedia('(prefers-color-scheme: dark)')
    this.snapshot = this.buildSnapshot()
    if (this.media !== undefined) {
      const media = this.media
      const onChange = (): void => {
        if (this.preference !== 'system') return
        this.publish()
      }
      ctx.effect(() => {
        media.addEventListener('change', onChange)
        return () => { media.removeEventListener('change', onChange) }
      }, 'ui-theme: prefers-color-scheme listener')
    }
    ctx.effect(() => host.subscribe(() => { this.adopt() }), 'ui-theme: settings scope adoption')
    ctx.effect(() => () => { this.flushWrites() }, 'ui-theme: flush pending settings writes')
    this.adopt()
  }

  /**
   * Queue one durable field write. Continuous controls (sliders, font inputs)
   * fire on every input tick; the local snapshot publishes immediately while
   * the Host write is debounced so a drag does not flood the settings RPC.
   */
  private queueWrite(field: string, value: unknown): void {
    this.pendingWrites.set(field, value)
    if (this.writeTimer !== undefined) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => { this.flushWrites() }, 300)
  }

  /** Send every pending field to the Host scope, preserving queue order. */
  private flushWrites(): void {
    if (this.writeTimer !== undefined) {
      clearTimeout(this.writeTimer)
      this.writeTimer = undefined
    }
    if (this.pendingWrites.size === 0) return
    const writes = [...this.pendingWrites]
    this.pendingWrites.clear()
    for (const [field, value] of writes) {
      this.inFlightWrites += 1
      this.host.set(field, value)
        .catch(() => { /* scope.set already reloads Host state on a failed latest write */ })
        .finally(() => {
          this.inFlightWrites -= 1
          if (this.inFlightWrites === 0 && this.pendingWrites.size === 0) this.adopt()
        })
    }
  }

  /**
   * Read the current immutable theme snapshot.
   * @returns the current snapshot (stable reference until the next change).
   */
  getTheme(): ThemeSnapshot {
    return this.snapshot
  }

  /**
   * Export the current token directory without reading DOM or computed styles.
   * @returns stable JSON-safe token descriptions, including registered and override-only names.
   */
  exportInspectTokens(): ThemeTokenInspection[] {
    const tokens = new Map(BUILTIN_INSPECT_TOKENS.map(token => [token.name, token]))
    for (const theme of this.themes) {
      for (const name of Object.keys(theme.tokens)) {
        if (!tokens.has(name)) tokens.set(name, dynamicToken(name))
      }
    }
    for (const layer of this.overrides.values()) {
      for (const name of Object.keys(layer.tokens)) {
        if (!tokens.has(name)) tokens.set(name, dynamicToken(name))
      }
    }
    return [...tokens.values()].map(token => ({ ...token })).sort((left, right) => left.name.localeCompare(right.name))
  }

  /**
   * Switch the color-scheme preference — or select a registered extension
   * theme id. Built-in preferences are written through the settings scope.
   * @param id - a registered theme id or `system`; unknown ids throw.
   */
  setTheme(id: string): void {
    if (id !== 'system' && !this.themes.some(t => t.id === id)) {
      throw new Error(`theme "${id}" is not registered`)
    }
    if (this.preference === id) return
    this.preference = id as ThemePreference
    if (isThemePreference(id)) {
      this.settings = { ...this.settings, preference: id }
      this.queueWrite(THEME_PREFERENCE_FIELD, id)
    }
    this.publish()
  }

  /**
   * Change the conversation content font size — the only font-size write
   * entry. Accepted values are written through the settings scope and emit
   * `theme/change`.
   * @param px - integer px within FONT_SIZE_MIN..FONT_SIZE_MAX; out-of-range or fractional values throw.
   */
  setFontSize(px: number): void {
    if (!Number.isInteger(px) || px < FONT_SIZE_MIN || px > FONT_SIZE_MAX) {
      throw new Error(`font size ${px} is outside ${FONT_SIZE_MIN}..${FONT_SIZE_MAX}`)
    }
    if (this.fontSize === px) return
    this.fontSize = px
    this.settings = { ...this.settings, fontSize: px }
    void this.host.set(FONT_SIZE_FIELD, px)
    this.publish()
  }

  /**
   * Assign a family to one color-scheme half.
   * @param mode - which half to paint.
   * @param familyId - builtin or custom family id.
   */
  setThemeHalf(mode: 'light' | 'dark', familyId: string): void {
    const family = resolveThemeFamily(familyId, this.settings.customThemes)
    if (family.id !== familyId && familyId !== DEFAULT_FAMILY_ID) {
      throw new Error(`theme family "${familyId}" is not registered`)
    }
    const field = mode === 'dark' ? THEME_DARK_FAMILY_FIELD : THEME_LIGHT_FAMILY_FIELD
    if (this.settings[field] === familyId) return
    this.settings = {
      ...this.settings,
      [field]: familyId,
    }
    this.queueWrite(field, familyId)
    this.publish()
  }

  /**
   * Paint a transient family over the active halves without persisting
   * anything: the theme editor calls this on every draft change so the user
   * sees the colors live. `null` restores the durable selection. The preview
   * never enters the settings scope, so closing the editor (or reloading)
   * always returns to the stored theme.
   * @param family - draft family to preview, or null to clear.
   */
  setPreviewFamily(family: ThemeFamily | null): void {
    if (this.previewedFamily === family) return
    this.previewedFamily = family
    this.publish()
  }

  /**
   * Replace the durable custom-family list.
   * @param customThemes - next custom families.
   */
  setCustomThemes(customThemes: readonly ThemeFamily[]): void {
    const next = customThemes.map(family => ({ ...family, origin: 'custom' as const }))
    this.settings = { ...this.settings, customThemes: next }
    if (this.settings.activeLightThemeId !== DEFAULT_FAMILY_ID
      && !listThemeFamilies(next).some(family => family.id === this.settings.activeLightThemeId)) {
      this.settings = { ...this.settings, activeLightThemeId: DEFAULT_FAMILY_ID }
      this.queueWrite(THEME_LIGHT_FAMILY_FIELD, DEFAULT_FAMILY_ID)
    }
    if (this.settings.activeDarkThemeId !== DEFAULT_FAMILY_ID
      && !listThemeFamilies(next).some(family => family.id === this.settings.activeDarkThemeId)) {
      this.settings = { ...this.settings, activeDarkThemeId: DEFAULT_FAMILY_ID }
      this.queueWrite(THEME_DARK_FAMILY_FIELD, DEFAULT_FAMILY_ID)
    }
    this.queueWrite(THEME_CUSTOM_THEMES_FIELD, next)
    this.publish()
  }

  /**
   * Persist glass-surface opacity.
   * @param glassOpacity - integer percent 40–100.
   */
  setGlassOpacity(glassOpacity: number): void {
    if (this.settings.glassOpacity === glassOpacity) return
    this.settings = { ...this.settings, glassOpacity }
    this.queueWrite(THEME_GLASS_OPACITY_FIELD, glassOpacity)
    this.publish()
  }

  /**
   * Persist the terminal pane's own solidity (终端透明度). The pane does not
   * follow the glass slider: under a live backdrop it keeps this percent of
   * its fill so the terminal can stay calmer (or more see-through) than the
   * surrounding chrome. Below {@link TERMINAL_PANE_MIN_SOLIDITY} the UI hints
   * that bold-plus-color TUI selection may get hard to read.
   * @param terminalOpacity - integer percent 40–100.
   */
  setTerminalOpacity(terminalOpacity: number): void {
    if (this.settings.terminalOpacity === terminalOpacity) return
    this.settings = { ...this.settings, terminalOpacity }
    this.queueWrite(THEME_TERMINAL_OPACITY_FIELD, terminalOpacity)
    this.publish()
  }

  /**
   * Persist the transparent-theme flag (透明主题). While on and a wallpaper
   * is set, every chrome surface drops to a 0% fill and the wallpaper dim
   * mask is removed; the glass slider is bypassed. Without a wallpaper the
   * flag is stored but the glass slider stays effective. Becoming effective
   * runs the one-shot {@link nudgeTransparentBlur} readability nudge.
   * @param transparentTheme - next flag value.
   */
  setTransparentTheme(transparentTheme: boolean): void {
    if (this.settings.transparentTheme === transparentTheme) return
    this.settings = { ...this.settings, transparentTheme }
    this.queueWrite(THEME_TRANSPARENT_FIELD, transparentTheme)
    if (transparentTheme && isWallpaperDataUrl(this.settings.wallpaperImage)) this.nudgeTransparentBlur()
    this.publish()
  }

  /**
   * Persist the sidebar-mask flag (隐藏侧栏遮罩). While on, the sidebar rail
   * paints the same canvas fill the workspace sits on, leaving only the
   * divider between them; the flag applies with or without a backdrop.
   * @param sidebarMaskHidden - next flag value.
   */
  setSidebarMask(sidebarMaskHidden: boolean): void {
    if (this.settings.sidebarMaskHidden === sidebarMaskHidden) return
    this.settings = { ...this.settings, sidebarMaskHidden }
    this.queueWrite(THEME_SIDEBAR_MASK_FIELD, sidebarMaskHidden)
    this.publish()
  }

  /**
   * Persist the button hover-sheen flag (按钮悬停光泽). While off, hovered
   * buttons keep only their variant hover fill — the attribute the
   * `metallic-paint.css` rules key on is dropped from the document root.
   * @param metallicPaintEnabled - next flag value.
   */
  setMetallicPaint(metallicPaintEnabled: boolean): void {
    if (this.settings.metallicPaintEnabled === metallicPaintEnabled) return
    this.settings = { ...this.settings, metallicPaintEnabled }
    this.queueWrite(THEME_METALLIC_PAINT_FIELD, metallicPaintEnabled)
    this.publish()
  }

  /**
   * One-shot readability nudge when the transparent theme becomes effective:
   * with 0% surfaces and no dim mask, text sits directly on the wallpaper,
   * so a blur below {@link TRANSPARENT_MIN_BLUR} is raised to that floor and
   * persisted. Not a continuous clamp — the user may lower the slider again;
   * Appearance shows the low-blur hint instead of re-clamping.
   */
  private nudgeTransparentBlur(): void {
    if (this.settings.wallpaperBlur >= TRANSPARENT_MIN_BLUR) return
    this.settings = { ...this.settings, wallpaperBlur: TRANSPARENT_MIN_BLUR }
    this.queueWrite(THEME_WALLPAPER_BLUR_FIELD, TRANSPARENT_MIN_BLUR)
  }

  /**
   * Persist wallpaper image, the two effect sliders, and/or the ambient
   * backdrop effect painted while no image is set.
   * @param patch - one or more backdrop fields.
   */
  setWallpaper(patch: Partial<Pick<ThemeSettings,
    'wallpaperImage' | 'wallpaperBlur' | 'wallpaperPixelate' | 'backgroundEffect'
    | 'backgroundEffectColors' | 'backgroundEffectSpeed' | 'backgroundEffectCount'
    | 'backgroundEffectPreset' | 'backgroundEffectVariant'
  >>): void {
    const next: Pick<ThemeSettings,
      'wallpaperImage' | 'wallpaperBlur' | 'wallpaperPixelate' | 'backgroundEffect'
      | 'backgroundEffectColors' | 'backgroundEffectSpeed' | 'backgroundEffectCount'
      | 'backgroundEffectPreset' | 'backgroundEffectVariant'
    > = {
      wallpaperImage: this.settings.wallpaperImage,
      wallpaperBlur: this.settings.wallpaperBlur,
      wallpaperPixelate: this.settings.wallpaperPixelate,
      backgroundEffect: this.settings.backgroundEffect,
      backgroundEffectColors: this.settings.backgroundEffectColors,
      backgroundEffectSpeed: this.settings.backgroundEffectSpeed,
      backgroundEffectCount: this.settings.backgroundEffectCount,
      backgroundEffectPreset: this.settings.backgroundEffectPreset,
      backgroundEffectVariant: this.settings.backgroundEffectVariant,
    }
    if (patch.wallpaperImage !== undefined) {
      next.wallpaperImage = patch.wallpaperImage === '' || isWallpaperDataUrl(patch.wallpaperImage)
        ? patch.wallpaperImage
        : ''
    }
    if (patch.wallpaperBlur !== undefined) next.wallpaperBlur = clampWallpaperEffect(patch.wallpaperBlur)
    if (patch.wallpaperPixelate !== undefined) next.wallpaperPixelate = clampWallpaperEffect(patch.wallpaperPixelate)
    if (patch.backgroundEffect !== undefined) {
      next.backgroundEffect = (BACKGROUND_EFFECTS as readonly string[]).includes(patch.backgroundEffect)
        ? patch.backgroundEffect
        : 'none'
    }
    if (patch.backgroundEffectColors !== undefined) {
      next.backgroundEffectColors = sanitizeBackgroundEffectColors(patch.backgroundEffectColors)
    }
    if (patch.backgroundEffectSpeed !== undefined) {
      next.backgroundEffectSpeed = clampBackgroundEffectSpeed(patch.backgroundEffectSpeed)
    }
    if (patch.backgroundEffectCount !== undefined) {
      next.backgroundEffectCount = clampBackgroundEffectCount(patch.backgroundEffectCount)
    }
    if (patch.backgroundEffectPreset !== undefined) {
      next.backgroundEffectPreset = (BACKGROUND_EFFECT_PRESETS as readonly string[]).includes(patch.backgroundEffectPreset)
        ? patch.backgroundEffectPreset
        : 'custom'
    }
    if (patch.backgroundEffectVariant !== undefined) {
      next.backgroundEffectVariant = (BACKGROUND_EFFECT_VARIANTS as readonly string[]).includes(patch.backgroundEffectVariant)
        ? patch.backgroundEffectVariant
        : DEFAULT_BACKGROUND_EFFECT_VARIANT
    }
    if (next.wallpaperImage === this.settings.wallpaperImage
      && next.wallpaperBlur === this.settings.wallpaperBlur
      && next.wallpaperPixelate === this.settings.wallpaperPixelate
      && next.backgroundEffect === this.settings.backgroundEffect
      && JSON.stringify(next.backgroundEffectColors) === JSON.stringify(this.settings.backgroundEffectColors)
      && next.backgroundEffectSpeed === this.settings.backgroundEffectSpeed
      && next.backgroundEffectCount === this.settings.backgroundEffectCount
      && next.backgroundEffectPreset === this.settings.backgroundEffectPreset
      && next.backgroundEffectVariant === this.settings.backgroundEffectVariant) {
      return
    }
    const becameEffective = this.settings.transparentTheme
      && isWallpaperDataUrl(next.wallpaperImage)
      && !isWallpaperDataUrl(this.settings.wallpaperImage)
    this.settings = { ...this.settings, ...next }
    if (patch.wallpaperImage !== undefined) this.queueWrite(THEME_WALLPAPER_IMAGE_FIELD, next.wallpaperImage)
    if (patch.wallpaperBlur !== undefined) this.queueWrite(THEME_WALLPAPER_BLUR_FIELD, next.wallpaperBlur)
    if (patch.wallpaperPixelate !== undefined) this.queueWrite(THEME_WALLPAPER_PIXELATE_FIELD, next.wallpaperPixelate)
    if (patch.backgroundEffect !== undefined) this.queueWrite(THEME_BACKGROUND_EFFECT_FIELD, next.backgroundEffect)
    if (patch.backgroundEffectColors !== undefined) {
      this.queueWrite(THEME_BACKGROUND_EFFECT_COLORS_FIELD, next.backgroundEffectColors)
    }
    if (patch.backgroundEffectSpeed !== undefined) {
      this.queueWrite(THEME_BACKGROUND_EFFECT_SPEED_FIELD, next.backgroundEffectSpeed)
    }
    if (patch.backgroundEffectCount !== undefined) {
      this.queueWrite(THEME_BACKGROUND_EFFECT_COUNT_FIELD, next.backgroundEffectCount)
    }
    if (patch.backgroundEffectPreset !== undefined) {
      this.queueWrite(THEME_BACKGROUND_EFFECT_PRESET_FIELD, next.backgroundEffectPreset)
    }
    if (patch.backgroundEffectVariant !== undefined) {
      this.queueWrite(THEME_BACKGROUND_EFFECT_VARIANT_FIELD, next.backgroundEffectVariant)
    }
    if (becameEffective) this.nudgeTransparentBlur()
    this.publish()
  }

  /**
   * Persist the pointer decoration (指针特效): the enabled flag, the chosen
   * effect, and its tunables. The toggle only writes `cursorEffectEnabled`,
   * so the last effect, palette, and sliders survive while the layer is off.
   * @param patch - one or more pointer-effect fields.
   */
  setCursorFx(patch: Partial<Pick<ThemeSettings,
    'cursorEffectEnabled' | 'cursorEffect' | 'cursorEffectColors'
    | 'cursorEffectSpeed' | 'cursorEffectSize' | 'cursorEffectPreset'
  >>): void {
    const next: Pick<ThemeSettings,
      'cursorEffectEnabled' | 'cursorEffect' | 'cursorEffectColors'
      | 'cursorEffectSpeed' | 'cursorEffectSize' | 'cursorEffectPreset'
    > = {
      cursorEffectEnabled: this.settings.cursorEffectEnabled,
      cursorEffect: this.settings.cursorEffect,
      cursorEffectColors: this.settings.cursorEffectColors,
      cursorEffectSpeed: this.settings.cursorEffectSpeed,
      cursorEffectSize: this.settings.cursorEffectSize,
      cursorEffectPreset: this.settings.cursorEffectPreset,
    }
    if (patch.cursorEffectEnabled !== undefined) next.cursorEffectEnabled = patch.cursorEffectEnabled
    if (patch.cursorEffect !== undefined) {
      next.cursorEffect = (CURSOR_EFFECTS as readonly string[]).includes(patch.cursorEffect)
        ? patch.cursorEffect
        : DEFAULT_CURSOR_EFFECT
    }
    if (patch.cursorEffectColors !== undefined) {
      next.cursorEffectColors = sanitizeCursorEffectColors(patch.cursorEffectColors)
    }
    if (patch.cursorEffectSpeed !== undefined) {
      next.cursorEffectSpeed = clampCursorEffectSpeed(patch.cursorEffectSpeed)
    }
    if (patch.cursorEffectSize !== undefined) {
      next.cursorEffectSize = clampCursorEffectSize(patch.cursorEffectSize)
    }
    if (patch.cursorEffectPreset !== undefined) {
      next.cursorEffectPreset = (CURSOR_EFFECT_PRESETS as readonly string[]).includes(patch.cursorEffectPreset)
        ? patch.cursorEffectPreset
        : 'custom'
    }
    if (next.cursorEffectEnabled === this.settings.cursorEffectEnabled
      && next.cursorEffect === this.settings.cursorEffect
      && JSON.stringify(next.cursorEffectColors) === JSON.stringify(this.settings.cursorEffectColors)
      && next.cursorEffectSpeed === this.settings.cursorEffectSpeed
      && next.cursorEffectSize === this.settings.cursorEffectSize
      && next.cursorEffectPreset === this.settings.cursorEffectPreset) {
      return
    }
    this.settings = { ...this.settings, ...next }
    if (patch.cursorEffectEnabled !== undefined) {
      this.queueWrite(THEME_CURSOR_EFFECT_ENABLED_FIELD, next.cursorEffectEnabled)
    }
    if (patch.cursorEffect !== undefined) this.queueWrite(THEME_CURSOR_EFFECT_FIELD, next.cursorEffect)
    if (patch.cursorEffectColors !== undefined) {
      this.queueWrite(THEME_CURSOR_EFFECT_COLORS_FIELD, next.cursorEffectColors)
    }
    if (patch.cursorEffectSpeed !== undefined) {
      this.queueWrite(THEME_CURSOR_EFFECT_SPEED_FIELD, next.cursorEffectSpeed)
    }
    if (patch.cursorEffectSize !== undefined) {
      this.queueWrite(THEME_CURSOR_EFFECT_SIZE_FIELD, next.cursorEffectSize)
    }
    if (patch.cursorEffectPreset !== undefined) {
      this.queueWrite(THEME_CURSOR_EFFECT_PRESET_FIELD, next.cursorEffectPreset)
    }
    this.publish()
  }

  /**
   * Persist desktop wallpaper catalog preferences without exposing desktop APIs to the web bundle.
   * `{ wallpaperSources }` replaces the sanitized source list. The bing / catalog-url
   * patch remains so Appearance still typechecks.
   * @param patch - source-list replacement or legacy catalog preference changes.
   */
  setWallpaperSources(
    patch: Partial<Pick<ThemeSettings, 'wallpaperBingEnabled' | 'wallpaperCatalogUrls' | 'wallpaperSources'>>,
  ): void {
    if (patch.wallpaperSources !== undefined) {
      const nextSources = sanitizeWallpaperSources(patch.wallpaperSources)
      if (JSON.stringify(nextSources) === JSON.stringify(this.settings.wallpaperSources)) return
      this.settings = { ...this.settings, wallpaperSources: nextSources }
      this.queueWrite(THEME_WALLPAPER_SOURCES_FIELD, nextSources)
      this.publish()
      return
    }
    const nextBing = patch.wallpaperBingEnabled ?? this.settings.wallpaperBingEnabled
    const nextCatalogs = patch.wallpaperCatalogUrls === undefined
      ? this.settings.wallpaperCatalogUrls
      : sanitizeWallpaperCatalogUrls(patch.wallpaperCatalogUrls)
    if (nextBing === this.settings.wallpaperBingEnabled
      && JSON.stringify(nextCatalogs) === JSON.stringify(this.settings.wallpaperCatalogUrls)) return
    this.settings = { ...this.settings, wallpaperBingEnabled: nextBing, wallpaperCatalogUrls: nextCatalogs }
    if (patch.wallpaperBingEnabled !== undefined) this.queueWrite(THEME_WALLPAPER_BING_FIELD, nextBing)
    if (patch.wallpaperCatalogUrls !== undefined) this.queueWrite(THEME_WALLPAPER_CATALOGS_FIELD, nextCatalogs)
    this.publish()
  }

  /**
   * Replace the starred gallery list.
   * @param patch - next favorites; the list is sanitized before persist.
   */
  setWallpaperFavorites(patch: Pick<ThemeSettings, 'wallpaperFavorites'>): void {
    const next = sanitizeWallpaperFavorites(patch.wallpaperFavorites)
    if (JSON.stringify(next) === JSON.stringify(this.settings.wallpaperFavorites)) return
    this.settings = { ...this.settings, wallpaperFavorites: next }
    this.queueWrite(THEME_WALLPAPER_FAVORITES_FIELD, next)
    this.publish()
  }

  /**
   * Persist typography extras.
   * @param patch - one or more font fields.
   */
  setTypography(patch: Partial<Pick<ThemeSettings, 'fontFamilySans' | 'fontFamilyCode' | 'fontSizeInterface' | 'fontSizeCode' | 'fontFamilyComposer' | 'fontFamilyTerminal'>>): void {
    this.settings = { ...this.settings, ...patch }
    for (const [field, value] of Object.entries(patch)) {
      this.queueWrite(field, value)
    }
    this.publish()
  }

  /**
   * Adopt the scope's accepted durable section without writing it back.
   * Skipped while local writes are queued or in flight: mid-drag the durable
   * echo lags the local snapshot, and adopting it would snap the control back.
   */
  private adopt(): void {
    if (this.pendingWrites.size > 0 || this.inFlightWrites > 0) return
    const section = this.host.getSnapshot().value
    if (section === undefined) return
    const next = resolveThemeSettings(section)
    if (sameSettings(this.settings, next) && this.preference === next.preference && this.fontSize === next.fontSize) return
    this.settings = next
    this.preference = next.preference
    this.fontSize = next.fontSize
    this.publish()
  }

  /**
   * Register a theme. Duplicate id throws (single occupant per id; the
   * built-in pair counts; `system` is a preference, not a registrable id).
   * @param definition - theme id, colorScheme, and alias-token overrides.
   * @returns disposer. Disposing the theme backing the active preference
   * resets the preference to the default so the UI never keeps tokens of an
   * unregistered theme.
   */
  register(definition: ThemeDefinition): () => void {
    if (definition.id === 'system') throw new Error('"system" is a preference, not a registrable theme id')
    if (this.themes.some(t => t.id === definition.id)) {
      throw new Error(`theme "${definition.id}" is already registered`)
    }
    this.themes = [...this.themes, definition]
    this.publish()
    return () => {
      if (!this.themes.some(t => t.id === definition.id)) return
      this.themes = this.themes.filter(t => t.id !== definition.id)
      if (this.preference === definition.id) {
        this.preference = DEFAULT_PREFERENCE
        this.settings = { ...this.settings, preference: DEFAULT_PREFERENCE }
      }
      this.publish()
    }
  }

  /**
   * Stack a token override layer on top of the active theme.
   * @param source - layer identity.
   * @param tokens - token-name → `{ light, dark }` value pairs.
   * @returns disposer removing exactly the layer this call created.
   */
  overrideTokens(source: string, tokens: ThemeTokenOverrides): () => void {
    const layer = { seq: this.overrideSeq++, tokens: validateOverrides(source, tokens) }
    this.overrides.set(source, layer)
    this.publish()
    return () => {
      if (this.overrides.get(source) !== layer) return
      this.overrides.delete(source)
      this.publish()
    }
  }

  private resolvedMode(): 'light' | 'dark' {
    if (this.preference === 'system') return this.media?.matches === true ? 'dark' : 'light'
    if (this.preference === 'dark' || this.preference === 'light') return this.preference
    const registered = this.themes.find(t => t.id === this.preference)
    return registered?.colorScheme ?? 'light'
  }

  private buildSnapshot(): ThemeSnapshot {
    const mode = this.resolvedMode()
    const familyId = mode === 'dark' ? this.settings.activeDarkThemeId : this.settings.activeLightThemeId
    const family = this.previewedFamily ?? resolveThemeFamily(familyId, this.settings.customThemes)
    const registered = !isThemePreference(this.preference)
      ? this.themes.find(t => t.id === this.preference)
      : undefined
    const base: ThemeDefinition = registered ?? {
      id: family.id,
      colorScheme: mode,
      tokens: family.id === DEFAULT_FAMILY_ID ? {} : deriveThemeTokens(family[mode]),
    }
    return Object.freeze({
      preference: isThemePreference(this.preference) ? this.preference : this.settings.preference,
      fontSize: this.fontSize,
      active: this.composeActive(base, mode),
      themes: Object.freeze([...this.themes]),
      families: Object.freeze(listThemeFamilies(this.settings.customThemes)),
      activeLightThemeId: this.settings.activeLightThemeId,
      activeDarkThemeId: this.settings.activeDarkThemeId,
      customThemes: Object.freeze([...this.settings.customThemes]),
      glassOpacity: this.settings.glassOpacity,
      terminalOpacity: this.settings.terminalOpacity,
      transparentTheme: this.settings.transparentTheme,
      sidebarMaskHidden: this.settings.sidebarMaskHidden,
      wallpaperImage: this.settings.wallpaperImage,
      wallpaperBlur: this.settings.wallpaperBlur,
      wallpaperPixelate: this.settings.wallpaperPixelate,
      wallpaperBingEnabled: this.settings.wallpaperBingEnabled,
      wallpaperCatalogUrls: Object.freeze([...this.settings.wallpaperCatalogUrls]),
      wallpaperSources: Object.freeze([...this.settings.wallpaperSources]),
      wallpaperFavorites: Object.freeze([...this.settings.wallpaperFavorites]),
      backgroundEffect: this.settings.backgroundEffect,
      backgroundEffectColors: Object.freeze([...this.settings.backgroundEffectColors]),
      backgroundEffectSpeed: this.settings.backgroundEffectSpeed,
      backgroundEffectCount: this.settings.backgroundEffectCount,
      backgroundEffectPreset: this.settings.backgroundEffectPreset,
      backgroundEffectVariant: this.settings.backgroundEffectVariant,
      cursorEffectEnabled: this.settings.cursorEffectEnabled,
      cursorEffect: this.settings.cursorEffect,
      cursorEffectColors: Object.freeze([...this.settings.cursorEffectColors]),
      cursorEffectSpeed: this.settings.cursorEffectSpeed,
      cursorEffectSize: this.settings.cursorEffectSize,
      cursorEffectPreset: this.settings.cursorEffectPreset,
      metallicPaintEnabled: this.settings.metallicPaintEnabled,
      fontFamilySans: this.settings.fontFamilySans,
      fontFamilyCode: this.settings.fontFamilyCode,
      fontSizeInterface: this.settings.fontSizeInterface,
      fontSizeCode: this.settings.fontSizeCode,
      fontFamilyComposer: this.settings.fontFamilyComposer,
      fontFamilyTerminal: this.settings.fontFamilyTerminal,
      revision: this.revision,
    })
  }

  /**
   * Fold family tokens, glass/font extras, and override layers into the
   * active definition.
   */
  private composeActive(active: ThemeDefinition, mode: 'light' | 'dark'): ThemeDefinition {
    const tokens: ThemeTokens = { ...active.tokens }
    const wallpapered = isWallpaperDataUrl(this.settings.wallpaperImage)
    // The ambient gradient is a backdrop too: while it is live (and no image
    // covers it) chrome surfaces mix to the same glass solidity so the blooms
    // show through like a wallpaper does.
    const backdropLive = wallpapered || this.settings.backgroundEffect === 'gradient'
    // 透明主题 needs the wallpaper: fully transparent chrome over an opaque
    // canvas would leave menus and dialogs invisible, so the flag is inert
    // until an image is set.
    const solidity = this.settings.transparentTheme && wallpapered
      ? TRANSPARENT_GLASS_SOLIDITY
      : this.settings.glassOpacity
    tokens['--dsw-alias-glass-opacity'] = `${solidity}%`
    if (backdropLive) {
      Object.assign(tokens, mixWallpaperSurfaces(tokens, mode, solidity, this.settings.terminalOpacity))
    } else {
      // The base sheet mixes DeepSeek's raised fills directly. Custom
      // families supply their own colors, so apply the same glass value here.
      for (const name of ['--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2']) {
        const color = tokens[name]
        if (color !== undefined && solidity < 100) {
          tokens[name] = `color-mix(in srgb, ${color} ${solidity}%, transparent)`
        }
      }
    }
    for (const layer of [...this.overrides.values()].sort((a, b) => a.seq - b.seq)) {
      for (const [name, modes] of Object.entries(layer.tokens)) {
        tokens[name] = modes[mode]
      }
    }
    // 隐藏侧栏遮罩 wins over family, mix, and override layers: the rail
    // chrome goes transparent so the frame's canvas fill shows through,
    // leaving only the divider between rail and workspace.
    if (this.settings.sidebarMaskHidden) {
      tokens[SIDEBAR_RAIL_FILL_TOKEN] = SIDEBAR_UNMASKED_FILL
    }
    return Object.freeze({ ...active, colorScheme: mode, tokens: Object.freeze(tokens) })
  }

  private publish(): void {
    this.revision += 1
    this.snapshot = this.buildSnapshot()
    this.ctx.emit('theme/change', this.snapshot)
  }
}

function sameSettings(left: ThemeSettings, right: ThemeSettings): boolean {
  return left.preference === right.preference
    && left.fontSize === right.fontSize
    && left.activeLightThemeId === right.activeLightThemeId
    && left.activeDarkThemeId === right.activeDarkThemeId
    && left.glassOpacity === right.glassOpacity
    && left.terminalOpacity === right.terminalOpacity
    && left.transparentTheme === right.transparentTheme
    && left.sidebarMaskHidden === right.sidebarMaskHidden
    && left.wallpaperImage === right.wallpaperImage
    && left.wallpaperBlur === right.wallpaperBlur
    && left.wallpaperPixelate === right.wallpaperPixelate
    && left.wallpaperBingEnabled === right.wallpaperBingEnabled
    && JSON.stringify(left.wallpaperCatalogUrls) === JSON.stringify(right.wallpaperCatalogUrls)
    && JSON.stringify(left.wallpaperSources) === JSON.stringify(right.wallpaperSources)
    && JSON.stringify(left.wallpaperFavorites) === JSON.stringify(right.wallpaperFavorites)
    && left.backgroundEffect === right.backgroundEffect
    && JSON.stringify(left.backgroundEffectColors) === JSON.stringify(right.backgroundEffectColors)
    && left.backgroundEffectSpeed === right.backgroundEffectSpeed
    && left.backgroundEffectCount === right.backgroundEffectCount
    && left.backgroundEffectPreset === right.backgroundEffectPreset
    && left.backgroundEffectVariant === right.backgroundEffectVariant
    && left.cursorEffectEnabled === right.cursorEffectEnabled
    && left.cursorEffect === right.cursorEffect
    && JSON.stringify(left.cursorEffectColors) === JSON.stringify(right.cursorEffectColors)
    && left.cursorEffectSpeed === right.cursorEffectSpeed
    && left.cursorEffectSize === right.cursorEffectSize
    && left.cursorEffectPreset === right.cursorEffectPreset
    && left.metallicPaintEnabled === right.metallicPaintEnabled
    && left.fontFamilySans === right.fontFamilySans
    && left.fontFamilyCode === right.fontFamilyCode
    && left.fontSizeInterface === right.fontSizeInterface
    && left.fontSizeCode === right.fontSizeCode
    && left.fontFamilyComposer === right.fontFamilyComposer
    && left.fontFamilyTerminal === right.fontFamilyTerminal
    && JSON.stringify(left.customThemes) === JSON.stringify(right.customThemes)
}

/**
 * Read the font size the Host boot script wrote on `body` before any plugin
 * ran, so the initial snapshot matches first paint and ui-layout's presenter
 * does not flash the schema default while the settings read is in flight.
 * Non-browser runs and mounts without the boot script fall back to the
 * schema default; the durable settings adoption still lands afterwards.
 */
function bootstrapFontSize(): number {
  /* v8 ignore next -- needs a documentless run (node e2e booting the client tree), not constructible under jsdom */
  if (typeof document === 'undefined') return DEFAULT_FONT_SIZE
  const raw = document.body.style.getPropertyValue('--dsh-content-font-size')
  const parsed = Number.parseInt(raw, 10)
  return Number.isInteger(parsed) && parsed >= FONT_SIZE_MIN && parsed <= FONT_SIZE_MAX
    ? parsed
    : DEFAULT_FONT_SIZE
}

function validateOverrides(source: string, tokens: ThemeTokenOverrides): ThemeTokenOverrides {
  const validated: ThemeTokenOverrides = {}
  for (const [name, value] of Object.entries<unknown>(tokens)) {
    if (typeof value === 'string') {
      throw new TypeError(
        `theme override "${name}" from "${source}" is a bare string — pass { light: ${JSON.stringify(value)}, dark: ${JSON.stringify(value)} } `
        + '(repeat the value when it is the same in both palettes); a single value goes illegible when the user switches color scheme',
      )
    }
    if (typeof value !== 'object' || value === null
      || typeof (value as { light?: unknown }).light !== 'string'
      || typeof (value as { dark?: unknown }).dark !== 'string') {
      throw new TypeError(
        `theme override "${name}" from "${source}" must map to a { light, dark } pair of strings — one value per color scheme`,
      )
    }
    const modes = value as ThemeTokenModes
    validated[name] = { light: modes.light, dark: modes.dark }
  }
  return validated
}

function dynamicToken(name: string): ThemeTokenInspection {
  return {
    name,
    description: 'Theme token registered by the current Client composition.',
    valueType: 'CSS value',
    requiresLightAndDark: true,
    ...(name.startsWith('--') ? { cssVariable: name } : {}),
  }
}

/**
 * Required services: settings transport plus slots/locale for the Appearance
 * row. `remote` carries the forwarded settings invalidation that
 * `ctx.configForms.get(entryId)` subscribes to on this context.
 */
export const inject = ['slots', 'locale', 'remote', 'configForms']

/**
 * Client plugin body: provide the theme service and register the
 * feature-owned Appearance settings section.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  installThemeStyles(ctx)
  const host = ctx.configForms.get<ThemeSettings>(THEME_SETTINGS_NAMESPACE)
  const theme = new ThemeRuntime(ctx, host)
  ctx.provide('theme', theme)

  ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), 'ui-theme: settings page dictionaries')

  const extras = (snapshot: ThemeSnapshot): void => {
    applyAppearanceDocumentExtras({
      fontFamilySans: snapshot.fontFamilySans,
      fontFamilyCode: snapshot.fontFamilyCode,
      fontSizeInterface: snapshot.fontSizeInterface,
      fontSizeCode: snapshot.fontSizeCode,
      fontFamilyComposer: snapshot.fontFamilyComposer,
      fontFamilyTerminal: snapshot.fontFamilyTerminal,
      wallpaperImage: snapshot.wallpaperImage,
      wallpaperBlur: snapshot.wallpaperBlur,
      wallpaperPixelate: snapshot.wallpaperPixelate,
      backgroundEffect: snapshot.backgroundEffect,
      backgroundEffectColors: snapshot.backgroundEffectColors,
      backgroundEffectSpeed: snapshot.backgroundEffectSpeed,
      backgroundEffectCount: snapshot.backgroundEffectCount,
      backgroundEffectVariant: snapshot.backgroundEffectVariant,
      cursorEffectEnabled: snapshot.cursorEffectEnabled,
      cursorEffect: snapshot.cursorEffect,
      cursorEffectColors: snapshot.cursorEffectColors,
      cursorEffectSpeed: snapshot.cursorEffectSpeed,
      cursorEffectSize: snapshot.cursorEffectSize,
      transparentTheme: snapshot.transparentTheme,
      metallicPaintEnabled: snapshot.metallicPaintEnabled,
    })
  }
  extras(theme.getTheme())
  ctx.on('theme/change', extras)

  const store = createAppearanceRowStore()
  let bound: BoundActions<typeof store> | undefined
  const fontSizeStore = createFontSizeRowStore()
  let fontSizeBound: BoundActions<typeof fontSizeStore> | undefined
  const sync = (snapshot: ThemeSnapshot): void => {
    bound?.sync(snapshot, snapshot.revision)
    fontSizeBound?.sync(snapshot.fontSize, snapshot.revision)
  }
  ctx.on('theme/change', sync)
  const t = ctx.locale.bind(SETTINGS_NS)
  const injected = (actions: BoundActions<typeof store>): AppearanceSectionInjected => {
    bound = actions
    sync(theme.getTheme())
    const desktopWallpaper = wallpaperShell() !== null
    return {
      setTheme: (id) => { theme.setTheme(id) },
      setThemeHalf: (mode, id) => { theme.setThemeHalf(mode, id) },
      setCustomThemes: (families) => { theme.setCustomThemes(families) },
      previewTheme: (family) => { theme.setPreviewFamily(family) },
      setGlassOpacity: (value) => { theme.setGlassOpacity(value) },
      setTerminalOpacity: (value) => { theme.setTerminalOpacity(value) },
      setTransparentTheme: (value) => { theme.setTransparentTheme(value) },
      setSidebarMask: (value) => { theme.setSidebarMask(value) },
      setWallpaper: (patch) => { theme.setWallpaper(patch) },
      setCursorFx: (patch) => { theme.setCursorFx(patch) },
      setMetallicPaint: (value) => { theme.setMetallicPaint(value) },
      ...(desktopWallpaper ? {
        setWallpaperSources: (patch: Partial<Pick<ThemeSettings, 'wallpaperBingEnabled' | 'wallpaperCatalogUrls' | 'wallpaperSources'>>) => {
          theme.setWallpaperSources(patch)
        },
        setWallpaperFavorites: (patch: Pick<ThemeSettings, 'wallpaperFavorites'>) => {
          theme.setWallpaperFavorites(patch)
        },
      } : {}),
      setTypography: (patch) => { theme.setTypography(patch) },
    }
  }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'appearance',
    order: 5,
    label: () => t('nav'),
    children: { 'settings.appearance.item': { kind: 'list', scope: 'root' } },
    store,
    locale: SETTINGS_NS,
    inject: injected,
  }, AppearanceSection))

  const fontSizeInjected = (actions: BoundActions<typeof fontSizeStore>): FontSizeRowInjected => {
    fontSizeBound = actions
    sync(theme.getTheme())
    return {
      setFontSize: (px) => { theme.setFontSize(px) },
    }
  }
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'font-size',
    order: 11,
    store: fontSizeStore,
    locale: SETTINGS_NS,
    inject: fontSizeInjected,
  }, FontSizeRow))
}
