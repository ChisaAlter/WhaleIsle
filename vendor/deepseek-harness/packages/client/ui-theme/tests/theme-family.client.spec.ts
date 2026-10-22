import { describe, expect, it } from 'vitest'
import {
  canonicalizeThemeFamily, duplicateThemeFamily, ensureUniqueThemeId,
  normalizeHexColor, normalizeImportedThemeFamily, parseThemeFamilyJson,
  replaceCustomTheme, serializeThemeFamily, slugifyThemeId,
} from '../src/theme-family.ts'
import {
  BUILTIN_THEME_FAMILIES, getBuiltinFamily, getReservedThemeIds,
  isBuiltinFamilyId, listThemeFamilies, resolveThemeFamily,
} from '../src/builtin-families.ts'

const SAMPLE = {
  id: 'grove',
  name: 'Grove',
  origin: 'custom' as const,
  light: { accent: '#0f766e', background: '#f3faf7', foreground: '#10211c', contrast: 44 },
  dark: { accent: '#3dd6b5', background: '#071411', foreground: '#e7f6f1', contrast: 50 },
}

describe('theme-family helpers', () => {
  it('normalizes hex colors and rejects short or invalid values', () => {
    expect(normalizeHexColor('#AABBCC')).toBe('#aabbcc')
    expect(normalizeHexColor('  #00ff00  ')).toBe('#00ff00')
    expect(normalizeHexColor('#fff')).toBeUndefined()
    expect(normalizeHexColor('blue')).toBeUndefined()
    expect(normalizeHexColor(1)).toBeUndefined()
  })

  it('slugifies names and guarantees unique ids', () => {
    expect(slugifyThemeId('My Theme!!')).toBe('my-theme')
    expect(slugifyThemeId('***')).toBe('custom-theme')
    const taken = new Set(['grove', 'grove-2'])
    expect(ensureUniqueThemeId('grove', taken)).toBe('grove-3')
    expect(ensureUniqueThemeId('ocean', taken)).toBe('ocean')
  })

  it('duplicates a family with a unique custom id and name', () => {
    const copy = duplicateThemeFamily(SAMPLE, new Set(['grove', 'grove-copy']))
    expect(copy.origin).toBe('custom')
    expect(copy.id).toBe('grove-copy-2')
    expect(copy.name).toMatch(/Copy/)
    expect(copy.light.accent).toBe(SAMPLE.light.accent)
  })

  it('imports JSON, rewrites colliding ids, and drops empty overrides', () => {
    const imported = normalizeImportedThemeFamily({
      ...SAMPLE,
      id: 'deepseek',
      light: { ...SAMPLE.light, overrides: { '--dsw-alias-bg-base': '', '--keep': '#111111' } },
    }, getReservedThemeIds())
    expect(normalizeImportedThemeFamily({ ...SAMPLE, id: '' }, new Set()).id).toBe('grove')
    expect(imported.id).toBe('deepseek-2')
    expect(imported.origin).toBe('custom')
    expect(imported.light.overrides).toEqual({ '--keep': '#111111' })
  })

  it('serializes and parses a family document', () => {
    const raw = serializeThemeFamily(SAMPLE)
    expect(raw.endsWith('\n')).toBe(true)
    expect(parseThemeFamilyJson(raw)).toMatchObject({ id: 'grove', name: 'Grove' })
  })

  it('replaces or appends a custom family by id', () => {
    const next = { ...SAMPLE, name: 'Grove 2' }
    expect(replaceCustomTheme([SAMPLE], next)).toEqual([next])
    expect(replaceCustomTheme([], SAMPLE)).toEqual([SAMPLE])
  })

  it('canonicalizes origin and omits empty override maps', () => {
    const canonical = canonicalizeThemeFamily({
      ...SAMPLE,
      origin: 'builtin',
      light: { ...SAMPLE.light, overrides: {} },
    }, 'custom')
    expect(canonical.origin).toBe('custom')
    expect(canonical.light.overrides).toBeUndefined()
  })

  it('round-trips a non-default skin and omits the default one', () => {
    const codex = canonicalizeThemeFamily({ ...SAMPLE, skin: 'codex' }, 'custom')
    expect(codex.skin).toBe('codex')
    expect(parseThemeFamilyJson(serializeThemeFamily(codex)).skin).toBe('codex')
    expect(canonicalizeThemeFamily(SAMPLE, 'custom').skin).toBeUndefined()
    expect(parseThemeFamilyJson(serializeThemeFamily(SAMPLE)).skin).toBe('default')
    const wallpapered = canonicalizeThemeFamily({ ...SAMPLE, wallpaper: 'data:image/png;base64,AA==' }, 'custom')
    expect(wallpapered.wallpaper).toBe('data:image/png;base64,AA==')
    expect(canonicalizeThemeFamily(SAMPLE, 'custom').wallpaper).toBeUndefined()
  })
})

describe('builtin families', () => {
  it('ships DeepSeek plus the desktop palettes', () => {
    expect(BUILTIN_THEME_FAMILIES.map(family => family.id)).toEqual([
      'deepseek', 'codex', 'claude', 'midnight', 'celadon', 'violet', 'amber', 'paper', 'contrast',
    ])
    expect(isBuiltinFamilyId('celadon')).toBe(true)
    expect(getBuiltinFamily('missing')).toBeUndefined()
    expect(getBuiltinFamily('codex')?.skin).toBe('codex')
    expect(getBuiltinFamily('claude')?.skin).toBe('claude')
    expect(getReservedThemeIds().has('paper')).toBe(true)
    expect(getReservedThemeIds().has('codex')).toBe(true)
    expect(getReservedThemeIds().has('claude')).toBe(true)
  })

  it('resolves unknown ids to DeepSeek and lists custom families after builtins', () => {
    expect(resolveThemeFamily('missing', [SAMPLE]).id).toBe('deepseek')
    expect(resolveThemeFamily('grove', [SAMPLE])).toBe(SAMPLE)
    expect(listThemeFamilies([SAMPLE]).at(-1)).toBe(SAMPLE)
  })
})
