/** Theme preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_CODE_FONT_SIZE,
  DEFAULT_FAMILY_ID,
  DEFAULT_GLASS_OPACITY,
  DEFAULT_INTERFACE_FONT_SIZE,
  MAX_CODE_FONT_SIZE,
  MAX_GLASS_OPACITY,
  MAX_INTERFACE_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_GLASS_OPACITY,
  MIN_INTERFACE_FONT_SIZE,
  ThemeFamilySchema,
  type ThemeFamily,
} from './theme-family.ts'
import {
  BACKGROUND_EFFECT_VARIANTS, DEFAULT_BACKGROUND_EFFECT_COUNT,
  DEFAULT_BACKGROUND_EFFECT_SPEED, DEFAULT_BACKGROUND_EFFECT_VARIANT,
  DEFAULT_TERMINAL_OPACITY, DEFAULT_WALLPAPER_EFFECT, MAX_BACKGROUND_EFFECT_COUNT,
  MAX_BACKGROUND_EFFECT_SPEED, MAX_TERMINAL_OPACITY, MAX_WALLPAPER_EFFECT,
  MIN_BACKGROUND_EFFECT_COUNT, MIN_BACKGROUND_EFFECT_SPEED, MIN_TERMINAL_OPACITY,
  MIN_WALLPAPER_EFFECT, sanitizeBackgroundEffectColors,
} from './wallpaper.ts'
import {
  CURSOR_EFFECTS, CURSOR_EFFECT_PRESETS, DEFAULT_CURSOR_EFFECT,
  DEFAULT_CURSOR_EFFECT_SIZE, DEFAULT_CURSOR_EFFECT_SPEED,
  MAX_CURSOR_EFFECT_SIZE, MAX_CURSOR_EFFECT_SPEED,
  MIN_CURSOR_EFFECT_SIZE, MIN_CURSOR_EFFECT_SPEED,
  normalizeCursorEffect, sanitizeCursorEffectColors,
  type CursorEffect, type CursorEffectPreset,
} from './cursor-fx.ts'

/** Built-in preferences accepted at the registry and settings boundaries. */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const

/** Settings namespace owned by the theme plugin. */
export const THEME_SETTINGS_NAMESPACE = 'ui-theme'

/** Field carrying the selected built-in theme preference. */
export const THEME_PREFERENCE_FIELD = 'preference'

/** Field carrying the conversation content font size. */
export const FONT_SIZE_FIELD = 'fontSize'

/** Field carrying the light-half family id. */
export const THEME_LIGHT_FAMILY_FIELD = 'activeLightThemeId'

/** Field carrying the dark-half family id. */
export const THEME_DARK_FAMILY_FIELD = 'activeDarkThemeId'

/** Field carrying user-created families. */
export const THEME_CUSTOM_THEMES_FIELD = 'customThemes'

/** Field carrying glass-surface opacity. */
export const THEME_GLASS_OPACITY_FIELD = 'glassOpacity'

/** Field carrying the terminal pane's own solidity (终端透明度). */
export const THEME_TERMINAL_OPACITY_FIELD = 'terminalOpacity'

/** Field toggling the fully transparent chrome (透明主题). */
export const THEME_TRANSPARENT_FIELD = 'transparentTheme'

/** Field toggling the sidebar mask so the rail shares the canvas fill (隐藏侧栏遮罩). */
export const THEME_SIDEBAR_MASK_FIELD = 'sidebarMaskHidden'

/** Field carrying the wallpaper data URL. */
export const THEME_WALLPAPER_IMAGE_FIELD = 'wallpaperImage'

/** Field carrying wallpaper frosted-glass blur. */
export const THEME_WALLPAPER_BLUR_FIELD = 'wallpaperBlur'

/** Field carrying wallpaper pixelation. */
export const THEME_WALLPAPER_PIXELATE_FIELD = 'wallpaperPixelate'

/** Field toggling the optional Bing wallpaper catalog in the desktop shell. */
export const THEME_WALLPAPER_BING_FIELD = 'wallpaperBingEnabled'

/** Field carrying user-configured HTTPS wallpaper catalogs. */
export const THEME_WALLPAPER_CATALOGS_FIELD = 'wallpaperCatalogUrls'

/** Field carrying the gallery source list. */
export const THEME_WALLPAPER_SOURCES_FIELD = 'wallpaperSources'

/** Field carrying starred gallery items. */
export const THEME_WALLPAPER_FAVORITES_FIELD = 'wallpaperFavorites'

/** Field carrying the no-wallpaper ambient backdrop effect. */
export const THEME_BACKGROUND_EFFECT_FIELD = 'backgroundEffect'

/** Field carrying user color overrides for the ambient backdrop. */
export const THEME_BACKGROUND_EFFECT_COLORS_FIELD = 'backgroundEffectColors'

/** Field carrying the ambient backdrop speed percent. */
export const THEME_BACKGROUND_EFFECT_SPEED_FIELD = 'backgroundEffectSpeed'

/** Field carrying the ambient backdrop bloom count. */
export const THEME_BACKGROUND_EFFECT_COUNT_FIELD = 'backgroundEffectCount'

/** Field naming the selected backdrop scheme (a preset id or `custom`). */
export const THEME_BACKGROUND_EFFECT_PRESET_FIELD = 'backgroundEffectPreset'

/** Field naming the bloom shape variant the gradient paints. */
export const THEME_BACKGROUND_EFFECT_VARIANT_FIELD = 'backgroundEffectVariant'

/** Field toggling the pointer decoration layer (指针特效). */
export const THEME_CURSOR_EFFECT_ENABLED_FIELD = 'cursorEffectEnabled'

/** Field naming the pointer decoration (`trail` or `splash`). */
export const THEME_CURSOR_EFFECT_FIELD = 'cursorEffect'

/** Field carrying user color overrides for the pointer decoration. */
export const THEME_CURSOR_EFFECT_COLORS_FIELD = 'cursorEffectColors'

/** Field carrying the pointer decoration speed percent. */
export const THEME_CURSOR_EFFECT_SPEED_FIELD = 'cursorEffectSpeed'

/** Field carrying the pointer decoration size percent. */
export const THEME_CURSOR_EFFECT_SIZE_FIELD = 'cursorEffectSize'

/** Field naming the selected pointer scheme (a preset id or `custom`). */
export const THEME_CURSOR_EFFECT_PRESET_FIELD = 'cursorEffectPreset'

/** Field toggling the button hover sheen (按钮悬停光泽). */
export const THEME_METALLIC_PAINT_FIELD = 'metallicPaintEnabled'

/** Built-in and user catalog kinds accepted in the gallery source list. */
export type WallpaperSourceKind = 'bing' | 'wallhaven' | 'catalog'

/** One gallery source persisted in the Host theme section. */
export type WallpaperSource = {
  /** Stable selector (`bing`, `wallhaven`, or `catalog-` plus a short id). */
  id: string
  /** Fetch backend used by the gallery. */
  kind: WallpaperSourceKind
  /** Tab label, 1–40 characters after trim. */
  name: string
  /** HTTPS catalog document; catalog rows only. */
  url?: string
}

/** One starred gallery item persisted in the Host theme section. */
export type WallpaperFavorite = {
  /** Gallery item id (for example `bing-2026-08-19`). */
  id: string
  /** Source id the item was starred from. */
  sourceId: string
  /** Card title. */
  title: string
  /** Thumbnail URL. */
  thumbUrl: string
  /** Full-image URL used for download. */
  imageUrl: string
}

/** Built-in sources seeded when Host has never written `wallpaperSources`. */
export const DEFAULT_WALLPAPER_SOURCES: WallpaperSource[] = [
  { id: 'bing', kind: 'bing', name: '必应' },
  { id: 'wallhaven', kind: 'wallhaven', name: 'Wallhaven' },
]

/** Maximum number of custom HTTPS catalog sources persisted in settings. */
export const MAX_WALLPAPER_CATALOG_SOURCES = 5

/** Maximum number of custom wallpaper catalogs persisted in settings. */
export const MAX_WALLPAPER_CATALOG_URLS = MAX_WALLPAPER_CATALOG_SOURCES

/** Maximum number of starred gallery items persisted in settings. */
export const MAX_WALLPAPER_FAVORITES = 100

const MAX_WALLPAPER_SOURCE_NAME_LENGTH = 40
const MAX_WALLPAPER_CATALOG_URL_LENGTH = 500
const CATALOG_ID_PATTERN = /^catalog-[0-9a-z]+$/i

/** Backdrop effects accepted while no wallpaper image is set. */
export const BACKGROUND_EFFECTS = ['none', 'gradient'] as const

/** Ambient backdrop painted when no wallpaper image is set. */
export type BackgroundEffect = typeof BACKGROUND_EFFECTS[number]

/**
 * Named backdrop schemes the Appearance dialog offers. `custom` is the
 * state the stored tunables fall into whenever they no longer match a
 * preset; the preset id list doubles as the schema's accepted values.
 */
export const BACKGROUND_EFFECT_PRESETS = [
  'default', 'aurora', 'sunset', 'ocean', 'sakura', 'custom',
] as const

/** Selected backdrop scheme persisted next to the tunables. */
export type BackgroundEffectPreset = typeof BACKGROUND_EFFECT_PRESETS[number]

/**
 * Install-default backdrop palette: the `aurora` scheme's bloom colors, so a
 * fresh Host paints the named scheme rather than the theme-token baseline.
 * Kept equal to the aurora row in `client/effect-presets.ts` (spec-pinned).
 */
export const DEFAULT_BACKGROUND_EFFECT_COLORS = ['', '', '#34d399', '#22d3ee', '#a78bfa', '#4ade80', '#38bdf8']

/** Install-default backdrop scheme id, matching {@link DEFAULT_BACKGROUND_EFFECT_COLORS}. */
export const DEFAULT_BACKGROUND_EFFECT_PRESET: BackgroundEffectPreset = 'aurora'

/** Bloom shape the ambient gradient paints. */
export type BackgroundEffectVariant = typeof BACKGROUND_EFFECT_VARIANTS[number]

/** Theme preference persisted by the product Appearance page. */
export type ThemePreference = typeof THEME_PREFERENCES[number]

/** Default preference when the user-settings document has no override. */
export const DEFAULT_PREFERENCE: ThemePreference = 'system'

/** Smallest accepted content font size (px). */
export const FONT_SIZE_MIN = 10

/** Largest accepted content font size (px). */
export const FONT_SIZE_MAX = 22

/** Content font size when the user-settings document has no override (px). */
export const DEFAULT_FONT_SIZE = 14

/** Durable theme section shared by the Host schema and the browser scope. */
export interface ThemeSettings {
  /** Selected built-in color-scheme preference. */
  preference: ThemePreference
  /** Conversation content font size in px (integer within {@link FONT_SIZE_MIN}..{@link FONT_SIZE_MAX}). */
  fontSize: number
  /** Family that paints the light half. */
  activeLightThemeId: string
  /** Family that paints the dark half. */
  activeDarkThemeId: string
  /** User-created families persisted across reloads. */
  customThemes: ThemeFamily[]
  /** Overlay / menu / composer solidity, 40–100. */
  glassOpacity: number
  /**
   * Terminal pane solidity under a live backdrop, 40–100; independent of the
   * glass slider so the terminal can stay calmer (or more see-through) than
   * the surrounding chrome. Defaults to the TUI-readability bound (75).
   */
  terminalOpacity: number
  /**
   * Transparent theme (透明主题): with a wallpaper set, every chrome surface
   * drops its fill so the image shows through unmasked. Overrides the glass
   * slider while active; without a wallpaper the flag is stored but inert.
   */
  transparentTheme: boolean
  /**
   * Sidebar mask (隐藏侧栏遮罩): the rail paints the main canvas fill instead
   * of its own mask, so only the divider separates it from the workspace.
   */
  sidebarMaskHidden: boolean
  /** Wallpaper data URL; empty means no wallpaper. */
  wallpaperImage: string
  /** Frosted-glass blur on the wallpaper, 0–100. */
  wallpaperBlur: number
  /** Pixelation on the wallpaper, 0–100. */
  wallpaperPixelate: number
  /** Whether the desktop gallery includes Bing wallpaper rows. */
  wallpaperBingEnabled: boolean
  /** HTTPS JSON catalogs included by the desktop gallery. */
  wallpaperCatalogUrls: string[]
  /** Gallery sources; omit on disk seeds {@link DEFAULT_WALLPAPER_SOURCES}. */
  wallpaperSources: WallpaperSource[]
  /** Starred gallery items, capped at {@link MAX_WALLPAPER_FAVORITES}. */
  wallpaperFavorites: WallpaperFavorite[]
  /**
   * Ambient backdrop effect painted while `wallpaperImage` is empty. The
   * stored value survives a wallpaper being set — the image always wins and
   * the effect resumes when the image is cleared.
   */
  backgroundEffect: BackgroundEffect
  /**
   * Ambient backdrop color overrides: up to seven `#rrggbb` slots — base
   * start, base end, blooms 1–5. An empty or missing slot keeps the
   * theme token.
   */
  backgroundEffectColors: string[]
  /** Ambient backdrop speed percent; 100 keeps the authored durations. */
  backgroundEffectSpeed: number
  /** Ambient backdrop bloom count, 1–5. */
  backgroundEffectCount: number
  /** Selected backdrop scheme: a preset id, or `custom` once the user edits. */
  backgroundEffectPreset: BackgroundEffectPreset
  /** Bloom shape variant: orbs, aurora ribbons, chaos, or rays. */
  backgroundEffectVariant: BackgroundEffectVariant
  /**
   * Pointer decoration layer switch. The chosen effect and tunables survive
   * while the layer is off, so the switch restores the last look.
   */
  cursorEffectEnabled: boolean
  /** Pointer decoration: fading pixel trail or WebGL fluid splash. */
  cursorEffect: CursorEffect
  /**
   * Pointer palette overrides: up to six `#rrggbb` slots shared by both
   * effects. An empty list falls back to the theme accent at paint time.
   */
  cursorEffectColors: string[]
  /** Pointer decoration speed percent; 100 keeps the authored look. */
  cursorEffectSpeed: number
  /** Pointer decoration size percent; scales splat radius / grid cell. */
  cursorEffectSize: number
  /** Selected pointer scheme: a preset id, or `custom` once the user edits. */
  cursorEffectPreset: CursorEffectPreset
  /**
   * Button hover sheen (按钮悬停光泽): while on, hovered native buttons get
   * the metallic-paint sweep on top of their variant hover fill; off leaves
   * the plain hover fill.
   */
  metallicPaintEnabled: boolean
  /** Optional interface font-family override; empty keeps the sheet stack. */
  fontFamilySans: string
  /** Optional monospace font-family override; empty keeps the sheet stack. */
  fontFamilyCode: string
  /** Root interface font size in px. */
  fontSizeInterface: number
  /** Code / diff font size in px. */
  fontSizeCode: number
  /** Optional composer font-family override; empty follows the interface stack. */
  fontFamilyComposer: string
  /** Optional terminal font-family override; empty follows the monospace stack. */
  fontFamilyTerminal: string
}

/** Default durable section used when Host has no override. */
export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  preference: DEFAULT_PREFERENCE,
  fontSize: DEFAULT_FONT_SIZE,
  activeLightThemeId: DEFAULT_FAMILY_ID,
  activeDarkThemeId: DEFAULT_FAMILY_ID,
  customThemes: [],
  glassOpacity: DEFAULT_GLASS_OPACITY,
  terminalOpacity: DEFAULT_TERMINAL_OPACITY,
  transparentTheme: false,
  sidebarMaskHidden: true,
  wallpaperImage: '',
  wallpaperBlur: DEFAULT_WALLPAPER_EFFECT,
  wallpaperPixelate: DEFAULT_WALLPAPER_EFFECT,
  wallpaperBingEnabled: false,
  wallpaperCatalogUrls: [],
  wallpaperSources: DEFAULT_WALLPAPER_SOURCES,
  wallpaperFavorites: [],
  backgroundEffect: 'gradient',
  backgroundEffectColors: [...DEFAULT_BACKGROUND_EFFECT_COLORS],
  backgroundEffectSpeed: DEFAULT_BACKGROUND_EFFECT_SPEED,
  backgroundEffectCount: DEFAULT_BACKGROUND_EFFECT_COUNT,
  backgroundEffectPreset: DEFAULT_BACKGROUND_EFFECT_PRESET,
  backgroundEffectVariant: DEFAULT_BACKGROUND_EFFECT_VARIANT,
  cursorEffectEnabled: false,
  cursorEffect: DEFAULT_CURSOR_EFFECT,
  cursorEffectColors: [],
  cursorEffectSpeed: DEFAULT_CURSOR_EFFECT_SPEED,
  cursorEffectSize: DEFAULT_CURSOR_EFFECT_SIZE,
  cursorEffectPreset: 'default',
  metallicPaintEnabled: false,
  fontFamilySans: '',
  fontFamilyCode: '',
  fontSizeInterface: DEFAULT_INTERFACE_FONT_SIZE,
  fontSizeCode: DEFAULT_CODE_FONT_SIZE,
  fontFamilyComposer: '',
  fontFamilyTerminal: '',
}

const WallpaperSourceSchema = z.object({
  id: z.string(),
  kind: z.string(),
  name: z.string(),
  url: z.string(),
})

const WallpaperFavoriteSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  title: z.string(),
  thumbUrl: z.string(),
  imageUrl: z.string(),
})

/** Array field that does not inherit schemastery's implicit `[]` default. */
function arrayWithoutDefault(inner: z): z {
  const schema = z.array(inner)
  delete schema.meta.default
  return schema
}

/** Shared field definitions for durable theme settings and live Host config. */
export const ThemeSettingsFields = {
  [THEME_PREFERENCE_FIELD]: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE),
  [FONT_SIZE_FIELD]: z.number().step(1).min(FONT_SIZE_MIN).max(FONT_SIZE_MAX).default(DEFAULT_FONT_SIZE),
  [THEME_LIGHT_FAMILY_FIELD]: z.string().default(DEFAULT_FAMILY_ID),
  [THEME_DARK_FAMILY_FIELD]: z.string().default(DEFAULT_FAMILY_ID),
  [THEME_CUSTOM_THEMES_FIELD]: z.array(ThemeFamilySchema).default([]),
  [THEME_GLASS_OPACITY_FIELD]: z.number().min(MIN_GLASS_OPACITY).max(MAX_GLASS_OPACITY)
    .default(DEFAULT_GLASS_OPACITY),
  [THEME_TERMINAL_OPACITY_FIELD]: z.number().min(MIN_TERMINAL_OPACITY).max(MAX_TERMINAL_OPACITY)
    .default(DEFAULT_TERMINAL_OPACITY),
  [THEME_TRANSPARENT_FIELD]: z.boolean().default(false),
  [THEME_SIDEBAR_MASK_FIELD]: z.boolean().default(true),
  [THEME_WALLPAPER_IMAGE_FIELD]: z.string().default(''),
  [THEME_WALLPAPER_BLUR_FIELD]: z.number().min(MIN_WALLPAPER_EFFECT).max(MAX_WALLPAPER_EFFECT)
    .default(DEFAULT_WALLPAPER_EFFECT),
  [THEME_WALLPAPER_PIXELATE_FIELD]: z.number().min(MIN_WALLPAPER_EFFECT).max(MAX_WALLPAPER_EFFECT)
    .default(DEFAULT_WALLPAPER_EFFECT),
  [THEME_WALLPAPER_BING_FIELD]: z.boolean().default(false),
  [THEME_WALLPAPER_CATALOGS_FIELD]: z.array(z.string()).default([]),
  [THEME_WALLPAPER_SOURCES_FIELD]: arrayWithoutDefault(WallpaperSourceSchema),
  [THEME_WALLPAPER_FAVORITES_FIELD]: z.array(WallpaperFavoriteSchema).default([]),
  [THEME_BACKGROUND_EFFECT_FIELD]: z.union([...BACKGROUND_EFFECTS]).default('gradient'),
  [THEME_BACKGROUND_EFFECT_COLORS_FIELD]: z.array(z.string()).default(DEFAULT_BACKGROUND_EFFECT_COLORS),
  [THEME_BACKGROUND_EFFECT_SPEED_FIELD]: z.number()
    .min(MIN_BACKGROUND_EFFECT_SPEED).max(MAX_BACKGROUND_EFFECT_SPEED)
    .default(DEFAULT_BACKGROUND_EFFECT_SPEED),
  [THEME_BACKGROUND_EFFECT_COUNT_FIELD]: z.number().step(1)
    .min(MIN_BACKGROUND_EFFECT_COUNT).max(MAX_BACKGROUND_EFFECT_COUNT)
    .default(DEFAULT_BACKGROUND_EFFECT_COUNT),
  [THEME_BACKGROUND_EFFECT_PRESET_FIELD]: z.union([...BACKGROUND_EFFECT_PRESETS])
    .default(DEFAULT_BACKGROUND_EFFECT_PRESET),
  [THEME_BACKGROUND_EFFECT_VARIANT_FIELD]: z.union([...BACKGROUND_EFFECT_VARIANTS])
    .default(DEFAULT_BACKGROUND_EFFECT_VARIANT),
  [THEME_CURSOR_EFFECT_ENABLED_FIELD]: z.boolean().default(false),
  [THEME_CURSOR_EFFECT_FIELD]: z.union([...CURSOR_EFFECTS]).default(DEFAULT_CURSOR_EFFECT),
  [THEME_CURSOR_EFFECT_COLORS_FIELD]: z.array(z.string()).default([]),
  [THEME_CURSOR_EFFECT_SPEED_FIELD]: z.number()
    .min(MIN_CURSOR_EFFECT_SPEED).max(MAX_CURSOR_EFFECT_SPEED)
    .default(DEFAULT_CURSOR_EFFECT_SPEED),
  [THEME_CURSOR_EFFECT_SIZE_FIELD]: z.number()
    .min(MIN_CURSOR_EFFECT_SIZE).max(MAX_CURSOR_EFFECT_SIZE)
    .default(DEFAULT_CURSOR_EFFECT_SIZE),
  [THEME_CURSOR_EFFECT_PRESET_FIELD]: z.union([...CURSOR_EFFECT_PRESETS]).default('default'),
  [THEME_METALLIC_PAINT_FIELD]: z.boolean().default(false),
  fontFamilySans: z.string().default(''),
  fontFamilyCode: z.string().default(''),
  fontSizeInterface: z.number().min(MIN_INTERFACE_FONT_SIZE).max(MAX_INTERFACE_FONT_SIZE)
    .default(DEFAULT_INTERFACE_FONT_SIZE),
  fontSizeCode: z.number().min(MIN_CODE_FONT_SIZE).max(MAX_CODE_FONT_SIZE)
    .default(DEFAULT_CODE_FONT_SIZE),
  fontFamilyComposer: z.string().default(''),
  fontFamilyTerminal: z.string().default(''),
}

/** Durable theme schema; also the wire envelope the browser form validates against. */
export const ThemeSettingsSchema: z<ThemeSettings> = z.object(ThemeSettingsFields)

/**
 * Narrow one wire or registry value to a persistable preference.
 * @param value - value crossing the settings or registry boundary.
 * @returns whether the value is a built-in preference.
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some(preference => preference === value)
}

/**
 * Fill missing fields on a partial Host section with product defaults.
 * @param section - accepted Host value, or undefined before the first read.
 * @returns a complete settings object.
 */
export function resolveThemeSettings(section: ThemeSettings | undefined): ThemeSettings {
  if (section === undefined) return { ...DEFAULT_THEME_SETTINGS, customThemes: [] }
  const wallpaperSources = Array.isArray(section.wallpaperSources)
    ? sanitizeWallpaperSources(section.wallpaperSources)
    : [
        ...DEFAULT_WALLPAPER_SOURCES,
        ...migrateCatalogSources(section.wallpaperCatalogUrls),
      ]
  return {
    ...DEFAULT_THEME_SETTINGS,
    ...section,
    customThemes: section.customThemes ?? [],
    wallpaperCatalogUrls: sanitizeWallpaperCatalogUrls(section.wallpaperCatalogUrls),
    wallpaperSources,
    wallpaperFavorites: sanitizeWallpaperFavorites(section.wallpaperFavorites),
    backgroundEffectColors: sanitizeBackgroundEffectColors(section.backgroundEffectColors),
    cursorEffect: normalizeCursorEffect(section.cursorEffect),
    cursorEffectColors: sanitizeCursorEffectColors(section.cursorEffectColors),
  }
}

/** Keep only bounded HTTPS catalog URLs, preserving first-seen order. */
export function sanitizeWallpaperCatalogUrls(values: readonly unknown[] | undefined): string[] {
  const result: string[] = []
  for (const value of values ?? []) {
    if (typeof value !== 'string') continue
    const candidate = value.trim()
    try {
      const url = new URL(candidate)
      if (url.protocol !== 'https:' || result.includes(url.href)) continue
      result.push(url.href)
      if (result.length >= MAX_WALLPAPER_CATALOG_URLS) break
    } catch {
      // Invalid user input is ignored at the settings boundary.
    }
  }
  return result
}

/**
 * Keep only well-formed gallery sources: one bing, one wallhaven, at most
 * {@link MAX_WALLPAPER_CATALOG_SOURCES} HTTPS catalogs, first-seen order.
 * @param values - wire or writer input; non-arrays yield an empty list.
 * @returns a persistable source list. Empty input stays empty.
 */
export function sanitizeWallpaperSources(values: unknown): WallpaperSource[] {
  if (!Array.isArray(values)) return []
  const result: WallpaperSource[] = []
  const usedIds = new Set<string>()
  const usedUrls = new Set<string>()
  let catalogCount = 0
  for (const raw of values) {
    if (typeof raw !== 'object' || raw === null) continue
    const row = raw as Record<string, unknown>
    if (row.kind === 'bing') {
      if (usedIds.has('bing')) continue
      const name = trimSourceName(row.name) ?? '必应'
      result.push({ id: 'bing', kind: 'bing', name })
      usedIds.add('bing')
      continue
    }
    if (row.kind === 'wallhaven') {
      if (usedIds.has('wallhaven')) continue
      const name = trimSourceName(row.name) ?? 'Wallhaven'
      result.push({ id: 'wallhaven', kind: 'wallhaven', name })
      usedIds.add('wallhaven')
      continue
    }
    if (row.kind !== 'catalog') continue
    const url = catalogHref(row.url)
    if (url === undefined || usedUrls.has(url) || catalogCount >= MAX_WALLPAPER_CATALOG_SOURCES) continue
    const name = trimSourceName(row.name) ?? hostnameName(url)
    if (name === undefined) continue
    const id = catalogSourceId(row.id, url, usedIds)
    result.push({ id, kind: 'catalog', name, url })
    usedIds.add(id)
    usedUrls.add(url)
    catalogCount += 1
  }
  return result
}

/**
 * Keep at most {@link MAX_WALLPAPER_FAVORITES} starred items with non-empty
 * fields, preserving first-seen ids.
 * @param values - wire or writer input; non-arrays yield an empty list.
 * @returns a persistable favorite list.
 */
export function sanitizeWallpaperFavorites(values: unknown): WallpaperFavorite[] {
  if (!Array.isArray(values)) return []
  const result: WallpaperFavorite[] = []
  const usedIds = new Set<string>()
  for (const raw of values) {
    if (typeof raw !== 'object' || raw === null) continue
    const row = raw as Record<string, unknown>
    const id = trimNonEmpty(row.id)
    const sourceId = trimNonEmpty(row.sourceId)
    const title = trimNonEmpty(row.title)
    const thumbUrl = trimNonEmpty(row.thumbUrl)
    const imageUrl = trimNonEmpty(row.imageUrl)
    if (id === undefined || sourceId === undefined || title === undefined
      || thumbUrl === undefined || imageUrl === undefined || usedIds.has(id)) continue
    result.push({ id, sourceId, title, thumbUrl, imageUrl })
    usedIds.add(id)
    if (result.length >= MAX_WALLPAPER_FAVORITES) break
  }
  return result
}

function migrateCatalogSources(values: readonly unknown[] | undefined): WallpaperSource[] {
  return sanitizeWallpaperSources(
    (values ?? []).map(url => ({ kind: 'catalog' as const, url })),
  )
}

function trimNonEmpty(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function trimSourceName(value: unknown): string | undefined {
  const trimmed = trimNonEmpty(value)?.slice(0, MAX_WALLPAPER_SOURCE_NAME_LENGTH)
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined
}

function catalogHref(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const candidate = value.trim()
  if (candidate.length === 0 || candidate.length > MAX_WALLPAPER_CATALOG_URL_LENGTH) return undefined
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:') return undefined
    return url.href
  } catch {
    // Invalid user input is ignored at the settings boundary.
    return undefined
  }
}

function hostnameName(href: string): string | undefined {
  return trimSourceName(new URL(href).hostname)
}

function catalogIdFromUrl(href: string): string {
  let hash = 2166136261
  for (let i = 0; i < href.length; i += 1) {
    hash ^= href.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `catalog-${(hash >>> 0).toString(36)}`
}

function catalogSourceId(id: unknown, href: string, usedIds: Set<string>): string {
  if (typeof id === 'string') {
    const trimmed = id.trim()
    if (CATALOG_ID_PATTERN.test(trimmed) && !usedIds.has(trimmed)) return trimmed
  }
  const generated = catalogIdFromUrl(href)
  if (!usedIds.has(generated)) return generated
  let suffix = 2
  while (usedIds.has(`${generated}-${suffix}`)) suffix += 1
  return `${generated}-${suffix}`
}
