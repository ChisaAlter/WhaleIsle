// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { stubConfigForm, type StubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  ThemeSettings,
  ThemeSnapshot,
  ThemeTokenOverrides,
} from '@deepseek-ai/dsh-client-ui-theme/client'
import { ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'
import {
  DEFAULT_THEME_SETTINGS,
  DEFAULT_WALLPAPER_SOURCES,
  resolveThemeSettings,
  sanitizeWallpaperFavorites,
  sanitizeWallpaperSources,
  ThemeSettingsSchema,
} from '../src/theme-settings.ts'
import { effectPreset } from '../src/client/effect-presets.ts'

function section(overrides: Partial<ThemeSettings> = {}): ThemeSettings {
  return { ...DEFAULT_THEME_SETTINGS, customThemes: [], ...overrides }
}

const make = (host = stubConfigForm<ThemeSettings>()): {
  ctx: Context
  theme: ThemeRuntime
  events: ThemeSnapshot[]
  host: StubConfigForm<ThemeSettings>
} => {
  const ctx = new Context()
  const events: ThemeSnapshot[] = []
  ctx.on('theme/change', (snapshot) => { events.push(snapshot) })
  return { ctx, theme: new ThemeRuntime(ctx, host.scope), events, host }
}

/**
 * Runtime constructed on a Host section without the backdrop extras, so raw
 * (unmixed) token assertions stay about their own feature.
 */
const makeBare = (): ReturnType<typeof make> => {
  const host = stubConfigForm<ThemeSettings>()
  host.publish({
    status: 'ready',
    value: section({ backgroundEffect: 'none', sidebarMaskHidden: false }),
    revision: 1,
    writable: true,
  })
  const made = make(host)
  // Construction adopts the standing section with one publish; drop it so
  // event counts inside tests reflect only test actions.
  made.events.length = 0
  return made
}

/** Advance past the durable-write debounce so queued scope writes land. */
const flushWrites = (): void => { vi.advanceTimersByTime(300) }

describe('ThemeRuntime', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('defaults to the system preference resolved against prefers-color-scheme', () => {
    const { theme } = make()
    const snapshot = theme.getTheme()
    expect(snapshot.preference).toBe('system')
    expect(snapshot.fontSize).toBe(14)
    // jsdom matchMedia is absent; system resolves to light.
    expect(snapshot.active.id).toBe('deepseek')
    expect(snapshot.active.colorScheme).toBe('light')
    expect(snapshot.active.tokens).toMatchObject({ '--dsw-alias-glass-opacity': '80%' })
    expect(snapshot.activeLightThemeId).toBe('deepseek')
    expect(snapshot.activeDarkThemeId).toBe('deepseek')
    expect(snapshot.themes.map(t => t.id)).toEqual(['light', 'dark'])
    // Shipped backdrop defaults: aurora gradient at 190% and an unmasked rail.
    expect(snapshot.sidebarMaskHidden).toBe(true)
    expect(snapshot.backgroundEffect).toBe('gradient')
    expect(snapshot.backgroundEffectPreset).toBe('aurora')
    expect(snapshot.backgroundEffectColors).toEqual(effectPreset('aurora')!.colors)
    expect(snapshot.backgroundEffectSpeed).toBe(190)
    expect(snapshot.backgroundEffectCount).toBe(5)
    expect(snapshot.backgroundEffectVariant).toBe('orbs')
  })

  it('seeds the initial font size from the boot-script body variable, ignoring junk', () => {
    // The Host boot script writes the durable size on body before any plugin
    // runs; the first snapshot must match it so activation never flashes 14.
    document.body.style.setProperty('--dsh-content-font-size', '22px')
    try {
      expect(make().theme.getTheme().fontSize).toBe(22)
      document.body.style.setProperty('--dsh-content-font-size', '23px')
      expect(make().theme.getTheme().fontSize).toBe(14)
    } finally {
      document.body.style.removeProperty('--dsh-content-font-size')
    }
  })

  it.each([10, 22])('setFontSize(%i) switches, writes through the scope, and republishes; same value is a no-op', (fontSize) => {
    const { theme, events, host } = make()
    theme.setFontSize(fontSize)
    expect(theme.getTheme().fontSize).toBe(fontSize)
    expect(host.set).toHaveBeenCalledWith('fontSize', fontSize)
    expect(events).toHaveLength(1)
    theme.setFontSize(fontSize)
    expect(events).toHaveLength(1)
    expect(host.set).toHaveBeenCalledOnce()
  })

  it('rejects out-of-range and fractional font sizes', () => {
    const { theme, events, host } = make()
    for (const px of [9, 23, 14.5, Number.NaN]) {
      expect(() => { theme.setFontSize(px) }).toThrow('outside 10..22')
    }
    expect(events).toHaveLength(0)
    expect(host.set).not.toHaveBeenCalled()
  })

  it('adopts a published Host font size without writing it back', () => {
    const { theme, events, host } = make()
    host.publish({ status: 'ready', value: section({ preference: 'system', fontSize: 12 }), revision: 1, writable: true })
    expect(theme.getTheme().fontSize).toBe(12)
    expect(events).toHaveLength(1)
    expect(host.set).not.toHaveBeenCalled()
  })

  it('setTheme switches, writes through the scope, republishes, and keeps DOM untouched', () => {
    const { theme, events, host } = make()
    theme.setTheme('dark')
    expect(theme.getTheme().preference).toBe('dark')
    expect(theme.getTheme().active.colorScheme).toBe('dark')
    flushWrites()
    expect(host.set).toHaveBeenCalledWith('preference', 'dark')
    expect(events).toHaveLength(1)
    expect(events[0]).toBe(theme.getTheme())
    // The service never touches presentation state.
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(false)
    // Same-value set is a no-op (no extra event).
    theme.setTheme('dark')
    expect(events).toHaveLength(1)
    flushWrites()
    expect(host.set).toHaveBeenCalledOnce()
  })

  it('adopts a published Host section without writing it back', () => {
    const { theme, events, host } = make()
    host.publish({ status: 'ready', value: section({ preference: 'dark' }), revision: 1, writable: true })
    expect(theme.getTheme().preference).toBe('dark')
    expect(events).toHaveLength(1)
    expect(host.set).not.toHaveBeenCalled()
    host.publish({ value: section({ preference: 'dark' }), revision: 2 })
    expect(events).toHaveLength(1)
  })

  it('adopts a section already standing at construction', () => {
    const host = stubConfigForm<ThemeSettings>()
    host.publish({ status: 'ready', value: section({ preference: 'dark', fontSize: 14 }), revision: 1, writable: true })
    const { theme } = make(host)
    expect(theme.getTheme().preference).toBe('dark')
  })

  it('throws on unknown setTheme ids, duplicate registration, and the system id', () => {
    const { theme } = make()
    expect(() => { theme.setTheme('sepia') }).toThrow('not registered')
    expect(() => theme.register({ id: 'light', colorScheme: 'light', tokens: {} })).toThrow('already registered')
    expect(() => theme.register({ id: 'system', colorScheme: 'light', tokens: {} })).toThrow('preference')
  })

  it('registered themes join the snapshot; disposing the active one resets to default', () => {
    const { theme, events, host } = makeBare()
    const dispose = theme.register({ id: 'sepia', colorScheme: 'light', tokens: { '--dsw-alias-bg-base': 'red' } })
    expect(theme.getTheme().themes.map(t => t.id)).toEqual(['light', 'dark', 'sepia'])
    theme.setTheme('sepia')
    expect(theme.getTheme().active.tokens['--dsw-alias-bg-base']).toBe('red')
    dispose()
    expect(theme.getTheme().preference).toBe('system')
    expect(theme.getTheme().themes.map(t => t.id)).toEqual(['light', 'dark'])
    // Custom ids are in-process extension themes; only the built-in product
    // preferences cross the Host settings schema.
    flushWrites()
    expect(host.set).not.toHaveBeenCalled()
    // register + set + dispose = three publishes; disposer is idempotent.
    expect(events.length).toBe(3)
    dispose()
    expect(events.length).toBe(3)
  })

  it('disposing an inactive theme keeps the active preference', () => {
    const { theme } = make()
    const dispose = theme.register({ id: 'sepia', colorScheme: 'light', tokens: {} })
    theme.setTheme('dark')
    dispose()
    expect(theme.getTheme().preference).toBe('dark')
  })

  it('revision increases monotonically across every publish', () => {
    const { theme, events } = make()
    theme.setTheme('dark')
    theme.setTheme('light')
    const dispose = theme.register({ id: 'sepia', colorScheme: 'dark', tokens: {} })
    dispose()
    expect(events.map(e => e.revision)).toEqual([1, 2, 3, 4])
  })

  it('stacks reversible token overrides in call order and selects the active palette value', () => {
    const { theme } = make()
    const firstTokens: ThemeTokenOverrides = {
      '--shared': { light: 'first-light', dark: 'first-dark' },
      '--first': { light: 'first-only-light', dark: 'first-only-dark' },
    }
    const disposeFirst = theme.overrideTokens('first', firstTokens)
    firstTokens['--shared']!.light = 'mutated-after-call'
    const disposeSecond = theme.overrideTokens('second', {
      '--shared': { light: 'second-light', dark: 'second-dark' },
    })

    expect(theme.getTheme().active.tokens).toMatchObject({
      '--first': 'first-only-light',
      '--shared': 'second-light',
    })
    theme.setTheme('dark')
    expect(theme.getTheme().active.tokens).toMatchObject({
      '--first': 'first-only-dark',
      '--shared': 'second-dark',
    })

    disposeSecond()
    expect(theme.getTheme().active.tokens['--shared']).toBe('first-dark')
    disposeFirst()
    expect(theme.getTheme().active.tokens['--shared']).toBeUndefined()
  })

  it('replacing one source leaves its stale disposer harmless', () => {
    const { theme, events } = makeBare()
    const stale = theme.overrideTokens('package', {
      '--old': { light: 'old-light', dark: 'old-dark' },
    })
    const current = theme.overrideTokens('package', {
      '--new': { light: 'new-light', dark: 'new-dark' },
    })
    stale()
    expect(theme.getTheme().active.tokens).toMatchObject({ '--new': 'new-light' })
    current()
    current()
    expect(theme.getTheme().active.tokens).toEqual({ '--dsw-alias-glass-opacity': '80%' })
    expect(events).toHaveLength(3)
  })

  it('exports sorted built-in, registered, and override-only token descriptions as copies', () => {
    const { theme } = make()
    theme.register({
      id: 'custom',
      colorScheme: 'light',
      tokens: {
        '--dsw-alias-bg-base': 'duplicate-built-in',
        '--registered': 'registered',
      },
    })
    theme.overrideTokens('package', {
      '--registered': { light: 'duplicate-registered', dark: 'duplicate-registered' },
      semanticAccent: { light: 'pink', dark: 'red' },
    })

    const tokens = theme.exportInspectTokens()
    expect(tokens.map(token => token.name)).toEqual([...tokens.map(token => token.name)].sort())
    expect(tokens.find(token => token.name === '--registered')).toMatchObject({
      valueType: 'CSS value',
      cssVariable: '--registered',
    })
    const semantic = tokens.find(token => token.name === 'semanticAccent')
    expect(semantic).toMatchObject({ valueType: 'CSS value' })
    expect(semantic).not.toHaveProperty('cssVariable')
    expect(tokens.filter(token => token.name === '--dsw-alias-bg-base')).toHaveLength(1)

    tokens[0]!.description = 'caller mutation'
    expect(theme.exportInspectTokens()[0]!.description).not.toBe('caller mutation')
  })

  it('rejects every malformed token override value with a teaching error', () => {
    const { theme } = make()
    const override = (value: unknown): void => {
      theme.overrideTokens('package', { '--bad': value } as unknown as ThemeTokenOverrides)
    }
    expect(() => { override('red') }).toThrow(/bare string.*light.*dark/)
    for (const value of [1, null, {}, { light: 1, dark: 'dark' }, { light: 'light' }]) {
      expect(() => { override(value) }).toThrow(/must map to a \{ light, dark \} pair/)
    }
  })

  it('context dispose releases the scope subscription', async () => {
    const { ctx, host } = make()
    expect(host.listenerCount()).toBe(1)
    await ctx.fiber.dispose()
    expect(host.listenerCount()).toBe(0)
  })

  describe('prefers-color-scheme resolution (stubbed matchMedia)', () => {
    type Listener = () => void
    const stubMedia = (initialMatches: boolean) => {
      const listeners = new Set<Listener>()
      const media = {
        matches: initialMatches,
        addEventListener: (_: 'change', fn: Listener) => { listeners.add(fn) },
        removeEventListener: (_: 'change', fn: Listener) => { listeners.delete(fn) },
        flip() {
          this.matches = !this.matches
          for (const fn of listeners) fn()
        },
        listenerCount: () => listeners.size,
      }
      vi.stubGlobal('matchMedia', () => media)
      return media
    }

    afterEach(() => { vi.unstubAllGlobals() })

    it('system resolves against the media query and follows OS flips', () => {
      const media = stubMedia(true)
      const { theme, events } = make()
      expect(theme.getTheme().preference).toBe('system')
      expect(theme.getTheme().active.id).toBe('deepseek')
      expect(theme.getTheme().active.colorScheme).toBe('dark')
      media.flip()
      expect(theme.getTheme().active.colorScheme).toBe('light')
      expect(events).toHaveLength(1)
    })

    it('OS flips do not republish while a concrete preference is set', () => {
      const media = stubMedia(false)
      const { theme, events } = make()
      theme.setTheme('light')
      expect(events).toHaveLength(1)
      media.flip()
      expect(events).toHaveLength(1)
      expect(theme.getTheme().active.colorScheme).toBe('light')
    })

    it('context dispose releases the media listener', async () => {
      const media = stubMedia(false)
      const { ctx } = make()
      expect(media.listenerCount()).toBe(1)
      await ctx.fiber.dispose()
      expect(media.listenerCount()).toBe(0)
    })
  })

  it('setThemeHalf persists one half and derives tokens for non-DeepSeek families', () => {
    const { theme, host } = makeBare()
    theme.setTheme('light')
    theme.setThemeHalf('light', 'celadon')
    expect(theme.getTheme().activeLightThemeId).toBe('celadon')
    expect(theme.getTheme().active.id).toBe('celadon')
    expect(theme.getTheme().active.tokens['--dsw-alias-bg-base']).toBe('#f3faf7')
    flushWrites()
    expect(host.set).toHaveBeenCalledWith('activeLightThemeId', 'celadon')
    theme.setThemeHalf('light', 'celadon')
    flushWrites()
    expect(host.set).toHaveBeenCalledTimes(2)
    expect(() => { theme.setThemeHalf('dark', 'missing') }).toThrow('not registered')
  })

  it('previews a transient family without writing the scope, and clears back', () => {
    const { theme, events, host } = make()
    theme.setTheme('light')
    const before = theme.getTheme()
    const draft = {
      id: 'red-draft',
      name: 'red',
      origin: 'custom' as const,
      light: { accent: '#e60000', background: '#ffffff', foreground: '#0f1115', contrast: 46 },
      dark: { accent: '#ff8080', background: '#151517', foreground: '#f5f5f5', contrast: 41 },
    }
    theme.setPreviewFamily(draft)
    expect(theme.getTheme().active.id).toBe('red-draft')
    expect(theme.getTheme().active.tokens['--dsw-alias-brand-primary']).toBe('#e60000')
    // Durable selection is untouched: no scope write, half ids unchanged.
    expect(theme.getTheme().activeLightThemeId).toBe(before.activeLightThemeId)
    flushWrites()
    expect(host.set).toHaveBeenCalledTimes(1) // only the setTheme('light') write
    // Same reference is a no-op; clearing restores the stored family.
    const published = events.length
    theme.setPreviewFamily(draft)
    expect(events).toHaveLength(published)
    theme.setPreviewFamily(null)
    expect(theme.getTheme().active.id).toBe('deepseek')
  })

  it('adopts half ids from Host and keeps DeepSeek tokens empty besides glass', () => {
    const { theme, host } = make()
    host.publish({
      status: 'ready',
      value: section({
        preference: 'dark',
        activeDarkThemeId: 'violet',
        backgroundEffect: 'none',
        sidebarMaskHidden: false,
      }),
      revision: 1,
      writable: true,
    })
    expect(theme.getTheme().activeDarkThemeId).toBe('violet')
    expect(theme.getTheme().active.tokens['--dsw-alias-bg-base']).toBe('#120e18')
    theme.setTheme('light')
    expect(theme.getTheme().active.tokens['--dsw-alias-bg-base']).toBeUndefined()
  })

  it('stores custom families and falls back to DeepSeek when the active one is removed', () => {
    const { theme, host } = make()
    const custom = {
      id: 'grove',
      name: 'Grove',
      origin: 'custom' as const,
      light: { accent: '#0f766e', background: '#f3faf7', foreground: '#10211c', contrast: 44 },
      dark: { accent: '#3dd6b5', background: '#071411', foreground: '#e7f6f1', contrast: 50 },
    }
    theme.setCustomThemes([custom])
    theme.setThemeHalf('light', 'grove')
    theme.setTheme('light')
    expect(theme.getTheme().active.id).toBe('grove')
    theme.setThemeHalf('dark', 'grove')
    theme.setCustomThemes([])
    expect(theme.getTheme().activeLightThemeId).toBe('deepseek')
    expect(theme.getTheme().activeDarkThemeId).toBe('deepseek')
    flushWrites()
    expect(host.set).toHaveBeenCalledWith('activeLightThemeId', 'deepseek')
    expect(host.set).toHaveBeenCalledWith('activeDarkThemeId', 'deepseek')
  })

  it('resolves a registered extension theme and falls back when the id is unknown', () => {
    const { theme, host } = make()
    theme.register({ id: 'sepia', colorScheme: 'dark', tokens: {} })
    theme.setTheme('sepia')
    expect(theme.getTheme().active.colorScheme).toBe('dark')
    host.publish({
      status: 'ready',
      value: section({ preference: 'ghost' as never }),
      revision: 1,
      writable: true,
    })
    expect(theme.getTheme().active.colorScheme).toBe('light')
  })

  it('persists glass opacity and typography extras', () => {
    const { theme, host } = make()
    theme.setGlassOpacity(60)
    expect(theme.getTheme().active.tokens['--dsw-alias-glass-opacity']).toBe('60%')
    flushWrites()
    expect(host.set).toHaveBeenCalledWith('glassOpacity', 60)
    theme.setGlassOpacity(60)
    theme.setTypography({ fontFamilySans: 'Inter', fontSizeInterface: 18, fontFamilyComposer: 'Georgia' })
    expect(theme.getTheme().fontFamilySans).toBe('Inter')
    expect(theme.getTheme().fontSizeInterface).toBe(18)
    expect(theme.getTheme().fontFamilyComposer).toBe('Georgia')
    flushWrites()
    expect(host.set).toHaveBeenCalledWith('fontFamilySans', 'Inter')
  })

  it('persists a wallpaper and mixes chrome fills so the image can show through', () => {
    const { theme, host } = make()
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    theme.setWallpaper({ wallpaperImage: png, wallpaperBlur: 25, wallpaperPixelate: 40 })
    expect(theme.getTheme().wallpaperImage).toBe(png)
    expect(theme.getTheme().wallpaperBlur).toBe(25)
    expect(theme.getTheme().wallpaperPixelate).toBe(40)
    expect(theme.getTheme().active.tokens['--dsw-alias-bg-base']).toContain('var(--dsw-static-neutral-bluish-00)')
    expect(theme.getTheme().active.tokens['--dsw-alias-terminal-pane']).toContain('var(--dsw-static-neutral-bluish-00)')
    // The pane keeps its own default (75%), not the 80% glass slider.
    expect(theme.getTheme().active.tokens['--dsw-alias-terminal-pane']).toContain('75%')
    theme.setTerminalOpacity(50)
    expect(theme.getTheme().active.tokens['--dsw-alias-terminal-pane']).toContain('50%')
    theme.setTheme('dark')
    expect(theme.getTheme().active.tokens['--dsw-alias-bg-base']).toContain('var(--dsw-static-neutral-bluish-950)')
    expect(theme.getTheme().active.tokens['--dsw-alias-terminal-pane']).toContain('var(--dsw-static-neutral-bluish-950)')
    expect(theme.getTheme().active.tokens['--dsw-alias-terminal-pane']).toContain('50%')
    theme.setTheme('light')
    theme.setThemeHalf('light', 'celadon')
    expect(theme.getTheme().active.tokens['--dsw-alias-bg-base']).toContain('#f3faf7')
    flushWrites()
    expect(host.set).toHaveBeenCalledWith('wallpaperImage', png)
    expect(host.set).toHaveBeenCalledWith('terminalOpacity', 50)
    theme.setWallpaper({ wallpaperImage: png, wallpaperBlur: 25, wallpaperPixelate: 40 })
    theme.setWallpaper({ wallpaperImage: 'javascript:alert(1)' })
    expect(theme.getTheme().wallpaperImage).toBe('')
    theme.setWallpaper({ wallpaperBlur: 250, wallpaperPixelate: -4 })
    expect(theme.getTheme().wallpaperBlur).toBe(100)
    expect(theme.getTheme().wallpaperPixelate).toBe(0)
  })

  it('persists the ambient backdrop effect and mixes chrome fills like a wallpaper', () => {
    const { theme, host } = make()
    // Shipped default: the gradient is already on and the canvas is mixed.
    expect(theme.getTheme().backgroundEffect).toBe('gradient')
    expect(theme.getTheme().active.tokens['--dsw-alias-bg-base']).toContain('color-mix')
    theme.setWallpaper({ backgroundEffect: 'none' })
    expect(theme.getTheme().backgroundEffect).toBe('none')
    expect(theme.getTheme().active.tokens['--dsw-alias-bg-base']).toBeUndefined()
    flushWrites()
    expect(host.set).toHaveBeenCalledWith('backgroundEffect', 'none')
    theme.setWallpaper({ backgroundEffect: 'gradient' })
    expect(theme.getTheme().backgroundEffect).toBe('gradient')
    flushWrites()
    expect(host.set).toHaveBeenCalledWith('backgroundEffect', 'gradient')
    // Unknown values fall back to none.
    theme.setWallpaper({ backgroundEffect: 'fireworks' as never })
    expect(theme.getTheme().backgroundEffect).toBe('none')
    flushWrites()
    expect(host.set).toHaveBeenCalledWith('backgroundEffect', 'none')
    // The stored value survives a wallpaper being set; the image wins the layer.
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    theme.setWallpaper({ backgroundEffect: 'gradient', wallpaperImage: png })
    expect(theme.getTheme().backgroundEffect).toBe('gradient')
    expect(theme.getTheme().wallpaperImage).toBe(png)
  })

  it('persists and sanitizes the ambient effect tunables', () => {
    const { theme, host } = make()
    // The shipped variant is already orbs; move off it so the fallback write lands.
    theme.setWallpaper({ backgroundEffectVariant: 'chaos' })
    theme.setWallpaper({
      backgroundEffectColors: ['#A1B2C3', 'junk', '#102030'],
      backgroundEffectSpeed: 999,
      backgroundEffectCount: 0,
      backgroundEffectPreset: 'bogus' as never,
      backgroundEffectVariant: 'bogus' as never,
    })
    expect(theme.getTheme().backgroundEffectColors).toEqual(['#a1b2c3', '', '#102030'])
    expect(theme.getTheme().backgroundEffectSpeed).toBe(300)
    expect(theme.getTheme().backgroundEffectCount).toBe(1)
    expect(theme.getTheme().backgroundEffectPreset).toBe('custom')
    expect(theme.getTheme().backgroundEffectVariant).toBe('orbs')
    flushWrites()
    expect(host.set).toHaveBeenCalledWith('backgroundEffectColors', ['#a1b2c3', '', '#102030'])
    expect(host.set).toHaveBeenCalledWith('backgroundEffectSpeed', 300)
    expect(host.set).toHaveBeenCalledWith('backgroundEffectCount', 1)
    expect(host.set).toHaveBeenCalledWith('backgroundEffectPreset', 'custom')
    expect(host.set).toHaveBeenCalledWith('backgroundEffectVariant', 'orbs')
  })

  it('persists a named ambient scheme preset', () => {
    const { theme, host } = make()
    // `aurora` is the shipped scheme, so the write starts from another preset.
    theme.setWallpaper({ backgroundEffectPreset: 'sakura', backgroundEffectVariant: 'rays' })
    expect(theme.getTheme().backgroundEffectPreset).toBe('sakura')
    expect(theme.getTheme().backgroundEffectVariant).toBe('rays')
    flushWrites()
    expect(host.set).toHaveBeenCalledWith('backgroundEffectPreset', 'sakura')
    expect(host.set).toHaveBeenCalledWith('backgroundEffectVariant', 'rays')
    theme.setWallpaper({ backgroundEffectPreset: 'aurora' })
    expect(theme.getTheme().backgroundEffectPreset).toBe('aurora')
    flushWrites()
    expect(host.set).toHaveBeenCalledWith('backgroundEffectPreset', 'aurora')
  })

  it('persists the pointer decoration flag and effect, and the toggle keeps the stored look', () => {
    const { theme, host, events } = make()
    expect(theme.getTheme().cursorEffectEnabled).toBe(false)
    expect(theme.getTheme().cursorEffect).toBe('trail')
    theme.setCursorFx({ cursorEffect: 'splash', cursorEffectEnabled: true })
    expect(theme.getTheme().cursorEffectEnabled).toBe(true)
    expect(theme.getTheme().cursorEffect).toBe('splash')
    flushWrites()
    expect(host.set).toHaveBeenCalledWith('cursorEffect', 'splash')
    expect(host.set).toHaveBeenCalledWith('cursorEffectEnabled', true)
    // The toggle only writes the flag; the chosen effect survives while off.
    theme.setCursorFx({ cursorEffectEnabled: false })
    expect(theme.getTheme().cursorEffectEnabled).toBe(false)
    expect(theme.getTheme().cursorEffect).toBe('splash')
    // Unknown values fall back to the default effect.
    theme.setCursorFx({ cursorEffect: 'meteors' as never })
    expect(theme.getTheme().cursorEffect).toBe('trail')
    // Same-value set is a no-op.
    const published = events.length
    theme.setCursorFx({ cursorEffectEnabled: false })
    expect(events.length).toBe(published)
  })

  it('persists and sanitizes the pointer-effect tunables', () => {
    const { theme, host } = make()
    theme.setCursorFx({
      cursorEffectColors: ['#A1B2C3', 'junk', '#102030', '#112233', '#223344', '#334455', '#445566', '#556677'],
      cursorEffectSpeed: 999,
      cursorEffectSize: -4,
      cursorEffectPreset: 'bogus' as never,
    })
    expect(theme.getTheme().cursorEffectColors).toEqual(['#a1b2c3', '#102030', '#112233', '#223344', '#334455', '#445566'])
    expect(theme.getTheme().cursorEffectSpeed).toBe(300)
    expect(theme.getTheme().cursorEffectSize).toBe(25)
    expect(theme.getTheme().cursorEffectPreset).toBe('custom')
    flushWrites()
    expect(host.set).toHaveBeenCalledWith('cursorEffectColors', ['#a1b2c3', '#102030', '#112233', '#223344', '#334455', '#445566'])
    expect(host.set).toHaveBeenCalledWith('cursorEffectSpeed', 300)
    expect(host.set).toHaveBeenCalledWith('cursorEffectSize', 25)
    expect(host.set).toHaveBeenCalledWith('cursorEffectPreset', 'custom')
    theme.setCursorFx({ cursorEffectPreset: 'ocean' })
    expect(theme.getTheme().cursorEffectPreset).toBe('ocean')
    flushWrites()
    expect(host.set).toHaveBeenCalledWith('cursorEffectPreset', 'ocean')
  })

  it('keeps the transparent theme inert under the ambient gradient without a wallpaper', () => {
    const { theme } = make()
    theme.setWallpaper({ backgroundEffect: 'gradient' })
    theme.setTransparentTheme(true)
    expect(theme.getTheme().transparentTheme).toBe(true)
    // The gradient is not a wallpaper: the glass slider stays effective.
    expect(theme.getTheme().active.tokens['--dsw-alias-glass-opacity']).toBe('80%')
    expect(theme.getTheme().active.tokens['--dsw-alias-bg-base']).toContain('color-mix')
  })

  it('transparent theme drops every mixed surface to 0% while a wallpaper is set', () => {
    const { theme, host, events } = make()
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    // Without a wallpaper the flag persists but the glass slider stays effective.
    theme.setTransparentTheme(true)
    expect(theme.getTheme().transparentTheme).toBe(true)
    expect(theme.getTheme().active.tokens['--dsw-alias-glass-opacity']).toBe('80%')
    flushWrites()
    expect(host.set).toHaveBeenCalledWith('transparentTheme', true)
    // With a wallpaper the whole chrome goes fully see-through.
    theme.setWallpaper({ wallpaperImage: png })
    const tokens = theme.getTheme().active.tokens
    expect(tokens['--dsw-alias-glass-opacity']).toBe('0%')
    expect(tokens['--dsw-alias-bg-base']).toContain('0%')
    expect(tokens['--dsw-alias-bg-layer-1']).toContain('0%')
    expect(tokens['--dsw-specific-sidebar-fill']).toContain('0%')
    // The terminal pane keeps its own slider value (default 75%) even while
    // the transparent theme zeroes the other surfaces.
    expect(tokens['--dsw-alias-terminal-pane']).toContain('75%')
    // Turning the flag off restores the glass slider.
    theme.setTransparentTheme(false)
    expect(theme.getTheme().active.tokens['--dsw-alias-glass-opacity']).toBe('80%')
    // Same-value set is a no-op.
    const published = events.length
    theme.setTransparentTheme(false)
    expect(events.length).toBe(published)
  })

  it('hides the sidebar mask by making the rail chrome transparent', () => {
    const { theme, host, events } = make()
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    theme.setWallpaper({ wallpaperImage: png })
    // Shipped default: the rail indirection is already transparent so the
    // frame canvas shows through; the sidebar fill token keeps its mixed
    // value for the surfaces that do not belong to the rail chrome.
    expect(theme.getTheme().active.tokens['--dsh-sidebar-rail-fill']).toBe('transparent')
    expect(theme.getTheme().active.tokens['--dsw-specific-sidebar-fill']).toContain('color-mix')
    // Off restores whatever fill the theme and mix produce.
    theme.setSidebarMask(false)
    expect(theme.getTheme().sidebarMaskHidden).toBe(false)
    expect(theme.getTheme().active.tokens['--dsh-sidebar-rail-fill']).toBeUndefined()
    flushWrites()
    expect(host.set).toHaveBeenCalledWith('sidebarMaskHidden', false)
    // An override layer paints the masked rail; the flag wins again once on.
    theme.overrideTokens('test', {
      '--dsh-sidebar-rail-fill': { light: '#111111', dark: '#222222' },
    })
    expect(theme.getTheme().active.tokens['--dsh-sidebar-rail-fill']).toBe('#111111')
    theme.setSidebarMask(true)
    expect(theme.getTheme().active.tokens['--dsh-sidebar-rail-fill']).toBe('transparent')
    flushWrites()
    expect(host.set).toHaveBeenCalledWith('sidebarMaskHidden', true)
    theme.setWallpaper({ wallpaperImage: '' })
    expect(theme.getTheme().active.tokens['--dsh-sidebar-rail-fill']).toBe('transparent')
    // Same-value set is a no-op.
    const published = events.length
    theme.setSidebarMask(true)
    expect(events.length).toBe(published)
  })

  it('persists the button hover-sheen flag and republishes', () => {
    const { theme, host, events } = make()
    // Shipped default: the sheen is off.
    expect(theme.getTheme().metallicPaintEnabled).toBe(false)
    theme.setMetallicPaint(true)
    expect(theme.getTheme().metallicPaintEnabled).toBe(true)
    flushWrites()
    expect(host.set).toHaveBeenCalledWith('metallicPaintEnabled', true)
    theme.setMetallicPaint(false)
    expect(theme.getTheme().metallicPaintEnabled).toBe(false)
    flushWrites()
    expect(host.set).toHaveBeenCalledWith('metallicPaintEnabled', false)
    // Same-value set is a no-op.
    const published = events.length
    theme.setMetallicPaint(false)
    expect(events.length).toBe(published)
  })

  it('nudges a low frosted-glass blur once when the transparent theme becomes effective', () => {
    const { theme, host } = make()
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    // Path 1: wallpaper already set, flag flips on with blur below the floor.
    theme.setWallpaper({ wallpaperImage: png })
    expect(theme.getTheme().wallpaperBlur).toBe(0)
    theme.setTransparentTheme(true)
    expect(theme.getTheme().wallpaperBlur).toBe(20)
    flushWrites()
    expect(host.set).toHaveBeenCalledWith('wallpaperBlur', 20)
    // One-shot: the user may lower the slider again without being re-clamped.
    theme.setWallpaper({ wallpaperBlur: 5 })
    expect(theme.getTheme().wallpaperBlur).toBe(5)
    // Path 2: flag already on, wallpaper arrives later (gallery / picker).
    theme.setWallpaper({ wallpaperImage: '' })
    theme.setWallpaper({ wallpaperImage: png })
    expect(theme.getTheme().wallpaperBlur).toBe(20)
    flushWrites()
    // Disabling never rewrites the blur back down.
    theme.setTransparentTheme(false)
    expect(theme.getTheme().wallpaperBlur).toBe(20)
  })

  it('leaves a blur at or above the floor untouched when transparency turns on', () => {
    const { theme, host } = make()
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    theme.setWallpaper({ wallpaperImage: png, wallpaperBlur: 60 })
    theme.setTransparentTheme(true)
    expect(theme.getTheme().wallpaperBlur).toBe(60)
    flushWrites()
    expect(host.set).toHaveBeenCalledWith('wallpaperBlur', 60)
    expect(host.set).not.toHaveBeenCalledWith('wallpaperBlur', 20)
    // Without a wallpaper the inert flag does not touch the blur either.
    theme.setTransparentTheme(false)
    theme.setWallpaper({ wallpaperImage: '', wallpaperBlur: 0 })
    theme.setTransparentTheme(true)
    expect(theme.getTheme().wallpaperBlur).toBe(0)
  })

  it('coalesces a drag into one durable write per field', () => {
    const { theme, host } = make()
    theme.setGlassOpacity(45)
    theme.setGlassOpacity(50)
    theme.setGlassOpacity(65)
    expect(host.set).not.toHaveBeenCalled()
    flushWrites()
    expect(host.set).toHaveBeenCalledOnce()
    expect(host.set).toHaveBeenCalledWith('glassOpacity', 65)
  })

  it('ignores durable echoes while local writes are pending, then re-adopts', async () => {
    const { theme, host } = make()
    theme.setGlassOpacity(45)
    // Stale echo mid-drag: must not snap the slider back.
    host.publish({ status: 'ready', value: { glassOpacity: 80 } as ThemeSettings, revision: 1, writable: true })
    expect(theme.getTheme().glassOpacity).toBe(45)
    flushWrites()
    // The scope publishes the accepted write before the set() settlement.
    host.publish({ value: { glassOpacity: 45 } as ThemeSettings, revision: 2 })
    await vi.runAllTimersAsync()
    expect(theme.getTheme().glassOpacity).toBe(45)
    // Once idle, a genuine external change is adopted normally.
    host.publish({ value: { glassOpacity: 90 } as ThemeSettings, revision: 3 })
    expect(theme.getTheme().glassOpacity).toBe(90)
  })

  it('replaces wallpaperSources and queues the new field', () => {
    const { theme, host } = make()
    expect(theme.getTheme().wallpaperSources.map(source => source.id)).toEqual(['bing', 'wallhaven'])
    theme.setWallpaperSources({ wallpaperSources: [] })
    expect(theme.getTheme().wallpaperSources).toEqual([])
    flushWrites()
    expect(host.set).toHaveBeenCalledWith('wallpaperSources', [])
  })

  it('keeps the bing and catalog-url patch on setWallpaperSources', () => {
    const { theme, host } = make()
    theme.setWallpaperSources({
      wallpaperBingEnabled: true,
      wallpaperCatalogUrls: ['https://example.com/a.json'],
    })
    expect(theme.getTheme().wallpaperBingEnabled).toBe(true)
    expect(theme.getTheme().wallpaperCatalogUrls).toEqual(['https://example.com/a.json'])
    flushWrites()
    expect(host.set).toHaveBeenCalledWith('wallpaperBingEnabled', true)
    expect(host.set).toHaveBeenCalledWith('wallpaperCatalogUrls', ['https://example.com/a.json'])
  })

  it('replaces wallpaperFavorites and queues the new field', () => {
    const { theme, host } = make()
    const favorite = {
      id: 'bing-2026-08-19',
      sourceId: 'bing',
      title: 'Lake',
      thumbUrl: 'https://example.com/t.jpg',
      imageUrl: 'https://example.com/i.jpg',
    }
    theme.setWallpaperFavorites({ wallpaperFavorites: [favorite] })
    expect(theme.getTheme().wallpaperFavorites).toEqual([favorite])
    flushWrites()
    expect(host.set).toHaveBeenCalledWith('wallpaperFavorites', [favorite])
  })
})

describe('resolveThemeSettings wallpaper sources', () => {
  it('seeds bing and wallhaven when wallpaperSources is omitted', () => {
    const parsed = ThemeSettingsSchema({} as never)
    expect(parsed.wallpaperSources).toBeUndefined()
    const resolved = resolveThemeSettings({
      ...DEFAULT_THEME_SETTINGS,
      wallpaperSources: undefined as never,
    } as ThemeSettings)
    expect(resolved.wallpaperSources.map(source => source.id)).toEqual(['bing', 'wallhaven'])
    expect(resolved.wallpaperSources[0]).toMatchObject({ kind: 'bing', name: '必应' })
    expect(resolved.wallpaperSources[1]).toMatchObject({ kind: 'wallhaven', name: 'Wallhaven' })
    expect(resolveThemeSettings(undefined).wallpaperSources).toEqual(DEFAULT_WALLPAPER_SOURCES)
  })

  it('keeps an empty wallpaperSources array without re-seeding', () => {
    const parsed = ThemeSettingsSchema({ wallpaperSources: [] } as never)
    expect(resolveThemeSettings(parsed as ThemeSettings).wallpaperSources).toEqual([])
    expect(resolveThemeSettings({
      ...DEFAULT_THEME_SETTINGS,
      wallpaperSources: [],
    }).wallpaperSources).toEqual([])
  })

  it('migrates old catalog URLs when wallpaperSources is omitted', () => {
    const resolved = resolveThemeSettings({
      ...DEFAULT_THEME_SETTINGS,
      wallpaperSources: undefined as never,
      wallpaperCatalogUrls: ['https://example.com/a.json'],
    } as ThemeSettings)
    expect(resolved.wallpaperSources).toHaveLength(3)
    expect(resolved.wallpaperSources[2]).toMatchObject({
      kind: 'catalog',
      url: 'https://example.com/a.json',
      name: 'example.com',
    })
    expect(resolved.wallpaperSources[2]!.id.startsWith('catalog-')).toBe(true)
  })

  it('does not migrate a catalog URL longer than 500 characters', () => {
    const longUrl = `https://example.com/${'a'.repeat(480)}.json`
    expect(longUrl.length).toBeGreaterThan(500)
    const resolved = resolveThemeSettings({
      ...DEFAULT_THEME_SETTINGS,
      wallpaperSources: undefined as never,
      wallpaperCatalogUrls: [longUrl],
    } as ThemeSettings)
    expect(resolved.wallpaperSources.map(source => source.id)).toEqual(['bing', 'wallhaven'])
    expect(resolved.wallpaperSources.some(source => source.kind === 'catalog')).toBe(false)
  })

  it('keeps one bing row when two bing rows are present', () => {
    expect(sanitizeWallpaperSources([
      { id: 'bing', kind: 'bing', name: '必应' },
      { id: 'bing', kind: 'bing', name: 'Bing 2' },
    ]).map(source => source.id)).toEqual(['bing'])
  })

  it('drops a sixth catalog source', () => {
    const catalogs = Array.from({ length: 6 }, (_, index) => ({
      kind: 'catalog' as const,
      name: `Catalog ${index}`,
      url: `https://example.com/${index}.json`,
    }))
    expect(
      sanitizeWallpaperSources([...DEFAULT_WALLPAPER_SOURCES, ...catalogs])
        .filter(source => source.kind === 'catalog'),
    ).toHaveLength(5)
  })

  it('caps favorites at 100', () => {
    const favorites = Array.from({ length: 101 }, (_, index) => ({
      id: `item-${index}`,
      sourceId: 'bing',
      title: `Title ${index}`,
      thumbUrl: `https://example.com/t${index}.jpg`,
      imageUrl: `https://example.com/i${index}.jpg`,
    }))
    expect(sanitizeWallpaperFavorites(favorites)).toHaveLength(100)
  })

  it('drops a catalog without an https url', () => {
    expect(sanitizeWallpaperSources([
      { kind: 'catalog', name: 'Http', url: 'http://example.com/a.json' },
      { kind: 'catalog', name: 'Missing' },
    ])).toEqual([])
  })

  it('reuses a stable catalog id for the same URL', () => {
    const row = { kind: 'catalog' as const, name: 'A', url: 'https://example.com/a.json' }
    const first = sanitizeWallpaperSources([row])
    const second = sanitizeWallpaperSources([row])
    expect(first[0]?.id).toBe(second[0]?.id)
    expect(first[0]?.id.startsWith('catalog-')).toBe(true)
  })

  it('returns an empty list when wallpaper sources are not an array', () => {
    expect(sanitizeWallpaperSources(undefined)).toEqual([])
    expect(sanitizeWallpaperSources({ kind: 'bing' })).toEqual([])
  })

  it('returns an empty list when wallpaper favorites are not an array', () => {
    expect(sanitizeWallpaperFavorites(undefined)).toEqual([])
    expect(sanitizeWallpaperFavorites({ id: 'x' })).toEqual([])
  })

  it('drops a catalog URL longer than 500 characters', () => {
    const longUrl = `https://example.com/${'a'.repeat(480)}.json`
    expect(longUrl.length).toBeGreaterThan(500)
    expect(sanitizeWallpaperSources([
      { kind: 'catalog', name: 'Long', url: longUrl },
    ])).toEqual([])
  })

  it('drops a catalog with an invalid URL', () => {
    expect(sanitizeWallpaperSources([
      { kind: 'catalog', name: 'Broken', url: 'not-a-url' },
    ])).toEqual([])
  })

  it('keeps the first of two catalogs with the same URL', () => {
    expect(sanitizeWallpaperSources([
      { kind: 'catalog', name: 'First', url: 'https://example.com/a.json' },
      { kind: 'catalog', name: 'Second', url: 'https://example.com/a.json' },
    ])).toEqual([
      expect.objectContaining({ name: 'First', url: 'https://example.com/a.json' }),
    ])
  })

  it('keeps an existing catalog-[0-9a-z]+ id', () => {
    expect(sanitizeWallpaperSources([
      {
        id: 'catalog-abc123',
        kind: 'catalog',
        name: 'Mine',
        url: 'https://example.com/a.json',
      },
    ])[0]?.id).toBe('catalog-abc123')
  })

  it('suffixes a generated catalog id when that id is already used', () => {
    const url = 'https://b.example/catalog.json'
    const occupied = sanitizeWallpaperSources([
      { kind: 'catalog', name: 'Probe', url },
    ])[0]!.id
    const result = sanitizeWallpaperSources([
      { kind: 'catalog', id: occupied, name: 'A', url: 'https://a.example/a.json' },
      { kind: 'catalog', name: 'B', url },
    ])
    expect(result.map(source => source.id)).toEqual([occupied, `${occupied}-2`])
    expect(result[1]).toMatchObject({ name: 'B', url })
  })

  it('names a catalog from its hostname when the name is missing', () => {
    expect(sanitizeWallpaperSources([
      { kind: 'catalog', url: 'https://gallery.example/feed.json' },
    ])[0]).toMatchObject({
      name: 'gallery.example',
      url: 'https://gallery.example/feed.json',
    })
  })
})
