/** Theme-family documents: seed colors, durable ids, and import helpers. */

import z from '@deepseek-ai/schemastery'

/** Alias-layer token dictionary keyed by CSS custom-property name. */
export type ThemeTokens = Record<string, string>

/** Default built-in family; empty derived tokens keep the CSS sheets. */
export const DEFAULT_FAMILY_ID = 'deepseek'

/** Presentation skins a family may carry; `default` keeps the product chrome. */
export const THEME_SKINS = ['default', 'claude', 'codex'] as const

/** One presentation skin id. */
export type ThemeSkinId = typeof THEME_SKINS[number]

/** Skin used by every family that does not name one. */
export const DEFAULT_THEME_SKIN: ThemeSkinId = 'default'

/** Contrast slider default, matching a mid-range mix. */
export const DEFAULT_CONTRAST = 46

/** Lowest glass opacity the settings slider accepts (percent). */
export const MIN_GLASS_OPACITY = 40
/** Highest glass opacity the settings slider accepts (percent). */
export const MAX_GLASS_OPACITY = 100
/** Default glass opacity (percent). */
export const DEFAULT_GLASS_OPACITY = 80
/** Glass opacity slider step (percent). */
export const GLASS_OPACITY_STEP = 5

/**
 * Indirection token the rail chrome (layout column, sidebar root, phone
 * drawer, session-list fade) resolves through; it falls back to
 * `--dsw-specific-sidebar-fill` until the theme rebinds it, like the
 * `--dsh-scrollbar-*` pair.
 */
export const SIDEBAR_RAIL_FILL_TOKEN = '--dsh-sidebar-rail-fill'

/**
 * Rail fill written while the sidebar mask is hidden. The rail chrome paints
 * the sidebar fill twice by design, so a translucent canvas value would
 * still darken the rail; `transparent` lets the frame's own
 * `--dsw-alias-bg-base` show through for an exact workspace match.
 */
export const SIDEBAR_UNMASKED_FILL = 'transparent'

/** Smallest interface font size the settings slider accepts (px). */
export const MIN_INTERFACE_FONT_SIZE = 12
/** Largest interface font size the settings slider accepts (px). */
export const MAX_INTERFACE_FONT_SIZE = 22
/** Default interface font size (px). */
export const DEFAULT_INTERFACE_FONT_SIZE = 16
/** Smallest code font size the settings slider accepts (px). */
export const MIN_CODE_FONT_SIZE = 10
/** Largest code font size the settings slider accepts (px). */
export const MAX_CODE_FONT_SIZE = 20
/** Default code font size (px). */
export const DEFAULT_CODE_FONT_SIZE = 13

const HEX_COLOR = /^#(?:[0-9a-fA-F]{6})$/

/** One palette half: three seed colors plus optional alias overrides. */
export interface ThemeSeeds {
  /** Primary brand / action color. */
  accent: string
  /** Canvas background. */
  background: string
  /** Primary text drawn over the background. */
  foreground: string
  /** Mix-strength modifier from 0 to 100. */
  contrast: number
  /** Exact `--dsw-alias-*` replacements applied after derivation. */
  overrides?: Record<string, string>
}

/** One dual-mode theme card: light and dark halves share an id. */
export interface ThemeFamily {
  /** Stable selector id (`setThemeHalf` argument). */
  id: string
  /** Human-readable label. */
  name: string
  /** Whether the family ships with the product or was created by the user. */
  origin: 'builtin' | 'custom'
  /** Presentation skin this family paints; absent means the product default. */
  skin?: ThemeSkinId
  /** Optional family wallpaper data URL, used while the user has no image. */
  wallpaper?: string
  /** Seeds for the light half. */
  light: ThemeSeeds
  /** Seeds for the dark half. */
  dark: ThemeSeeds
}

const ThemeSeedsSchema: z<ThemeSeeds> = z.object({
  accent: z.string().required(),
  background: z.string().required(),
  foreground: z.string().required(),
  contrast: z.number().min(0).max(100).default(DEFAULT_CONTRAST),
  overrides: z.dict(z.string()),
})

/** Wire schema for one family document (Host settings and JSON import). */
export const ThemeFamilySchema: z<ThemeFamily> = z.object({
  id: z.string().required(),
  name: z.string().required(),
  origin: z.union(['builtin', 'custom'] as const).default('custom'),
  skin: z.union([...THEME_SKINS]).default(DEFAULT_THEME_SKIN),
  wallpaper: z.string().max(1_800_000).default(''),
  light: ThemeSeedsSchema,
  dark: ThemeSeedsSchema,
})

/**
 * Narrow a hex string to `#rrggbb`.
 * @param value - candidate color.
 * @returns the lowercased hex, or undefined when the value is not a 6-digit hex.
 */
export function normalizeHexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!HEX_COLOR.test(trimmed)) return undefined
  return trimmed.toLowerCase()
}

/**
 * Build a kebab-case family id from a display name or imported id.
 * @param value - raw name or id.
 * @returns a non-empty kebab id.
 */
export function slugifyThemeId(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'custom-theme'
}

/**
 * Guarantee `baseId` is unused, appending `-2`, `-3`, … as needed.
 * @param baseId - preferred id.
 * @param existingIds - already taken ids.
 * @returns a unique id.
 */
export function ensureUniqueThemeId(baseId: string, existingIds: ReadonlySet<string>): string {
  if (!existingIds.has(baseId)) return baseId
  let index = 2
  while (existingIds.has(`${baseId}-${index}`)) index += 1
  return `${baseId}-${index}`
}

/**
 * Copy a family into a custom document with a unique id and name.
 * @param family - source family (builtin or custom).
 * @param existingIds - reserved plus current custom ids.
 * @returns the duplicated custom family.
 */
export function duplicateThemeFamily(
  family: ThemeFamily,
  existingIds: ReadonlySet<string>,
): ThemeFamily {
  const nextId = ensureUniqueThemeId(slugifyThemeId(`${family.id}-copy`), existingIds)
  const suffix = nextId === `${slugifyThemeId(family.id)}-copy` ? ' Copy' : ` Copy ${nextId.split('-').at(-1)}`
  return canonicalizeThemeFamily({
    ...family,
    id: nextId,
    name: `${family.name}${suffix}`,
    origin: 'custom',
  }, 'custom')
}

/**
 * Normalize imported JSON into a custom family with a unique id.
 * @param family - decoded document.
 * @param existingIds - reserved plus current custom ids.
 * @returns the imported custom family.
 */
export function normalizeImportedThemeFamily(
  family: ThemeFamily,
  existingIds: ReadonlySet<string>,
): ThemeFamily {
  const uniqueId = ensureUniqueThemeId(slugifyThemeId(family.id || family.name), existingIds)
  return canonicalizeThemeFamily({ ...family, id: uniqueId, origin: 'custom' }, 'custom')
}

/**
 * Replace or append one custom family in the durable list.
 * @param customThemes - current custom families.
 * @param nextTheme - family to upsert.
 * @returns a new array with `nextTheme` as the sole occupant of its id.
 */
export function replaceCustomTheme(
  customThemes: ReadonlyArray<ThemeFamily>,
  nextTheme: ThemeFamily,
): ThemeFamily[] {
  const canonical = canonicalizeThemeFamily(nextTheme, 'custom')
  return [...customThemes.filter(theme => theme.id !== canonical.id), canonical]
}

/**
 * Drop empty override maps and pin origin.
 * @param family - family to normalize.
 * @param origin - forced origin.
 * @returns a plain JSON-safe family.
 */
export function canonicalizeThemeFamily(
  family: ThemeFamily,
  origin: ThemeFamily['origin'] = family.origin,
): ThemeFamily {
  return {
    id: family.id,
    name: family.name,
    origin,
    ...(family.skin !== undefined && family.skin !== DEFAULT_THEME_SKIN ? { skin: family.skin } : {}),
    ...(family.wallpaper !== undefined && family.wallpaper !== '' ? { wallpaper: family.wallpaper } : {}),
    light: canonicalizeSeeds(family.light),
    dark: canonicalizeSeeds(family.dark),
  }
}

/**
 * Serialize one family as pretty JSON plus a trailing newline.
 * @param family - family to export.
 * @returns JSON text.
 */
export function serializeThemeFamily(family: ThemeFamily): string {
  return `${JSON.stringify(canonicalizeThemeFamily(family), null, 2)}\n`
}

/**
 * Decode a JSON family document.
 * @param raw - file or clipboard text.
 * @returns the decoded family.
 */
export function parseThemeFamilyJson(raw: string): ThemeFamily {
  return ThemeFamilySchema(JSON.parse(raw))
}

function canonicalizeSeeds(seeds: ThemeSeeds): ThemeSeeds {
  const overrides = seeds.overrides
    ? Object.fromEntries(Object.entries(seeds.overrides).filter(([, value]) => value !== ''))
    : undefined
  return {
    accent: seeds.accent,
    background: seeds.background,
    foreground: seeds.foreground,
    contrast: seeds.contrast,
    ...(overrides && Object.keys(overrides).length > 0 ? { overrides } : {}),
  }
}
