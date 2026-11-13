// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyAppearanceDocumentExtras } from '../src/appearance-apply.ts'
import { ThemeRuntime } from '../src/client/index.ts'
import { DEFAULT_THEME_SETTINGS, ThemeSettingsSchema, type ThemeSettings } from '../src/theme-settings.ts'
import { buildThemeBootPayload, injectBootTheme } from '../src/boot-theme.ts'
import z from '@deepseek-ai/schemastery'
import { WALLPAPER_LAYER_ID } from '../src/wallpaper.ts'
import { CURSOR_FX_LAYER_ID } from '../src/cursor-fx.ts'

afterEach(() => {
  document.documentElement.removeAttribute('data-dsh-minimal')
  applyAppearanceDocumentExtras({ fontFamilySans: '', fontFamilyCode: '', fontSizeCode: 13, fontSizeInterface: 16 })
  vi.useRealTimers()
})

describe('Minimal mode', () => {
  it('has backward-compatible defaults at the durable boundary', () => {
    const accepted = z.resolve({}, ThemeSettingsSchema, {})[0]
    expect(accepted).toMatchObject({ minimalMode: false, minimalModeSuggestions: true, minimalModeSnoozedUntil: 0 })
  })

  it('keeps all saved effects and restores their effective theme after switching off', () => {
    vi.useFakeTimers()
    const host = stubConfigForm<ThemeSettings>()
    host.publish({ status: 'ready', writable: true, revision: 1, value: {
      ...DEFAULT_THEME_SETTINGS, glassOpacity: 55, cursorEffectEnabled: true, metallicPaintEnabled: true,
    } })
    const ctx = new Context()
    const theme = new ThemeRuntime(ctx, host.scope)
    const original = theme.getTheme()
    theme.setMinimalMode(true)
    expect(theme.getTheme()).toMatchObject({ minimalMode: true, glassOpacity: 55, cursorEffectEnabled: true, metallicPaintEnabled: true })
    expect(theme.getTheme().active.tokens['--dsw-alias-glass-opacity']).toBe('100%')
    vi.advanceTimersByTime(300)
    expect(host.set).toHaveBeenCalledWith('minimalMode', true)
    expect(host.set).toHaveBeenCalledTimes(1)
    theme.setMinimalMode(false)
    expect(theme.getTheme().active).toEqual(original.active)
    vi.advanceTimersByTime(300)
  })

  it('removes existing decorative layers instead of only hiding them and restores on disable', () => {
    const extras = { fontFamilySans: '', fontFamilyCode: '', fontSizeCode: 13, fontSizeInterface: 16,
      backgroundEffect: 'gradient' as const, cursorEffectEnabled: true, metallicPaintEnabled: true }
    applyAppearanceDocumentExtras(extras)
    expect(document.querySelector('[data-dsh-gradient]')).not.toBeNull()
    applyAppearanceDocumentExtras({ ...extras, minimalMode: true })
    expect(document.documentElement.hasAttribute('data-dsh-minimal')).toBe(true)
    expect(document.documentElement.hasAttribute('data-dsh-metallic-paint')).toBe(false)
    expect(document.getElementById(WALLPAPER_LAYER_ID)).toBeNull()
    expect(document.getElementById(CURSOR_FX_LAYER_ID)).toBeNull()
    applyAppearanceDocumentExtras(extras)
    expect(document.documentElement.hasAttribute('data-dsh-minimal')).toBe(false)
    expect(document.documentElement.hasAttribute('data-dsh-metallic-paint')).toBe(true)
  })

  it('bootstraps the durable mode before client activation', () => {
    const payload = buildThemeBootPayload({ ...DEFAULT_THEME_SETTINGS, minimalMode: true })
    expect(payload).toMatchObject({ minimalMode: true, glassOpacity: 100 })
    const html = injectBootTheme('<body><div id="app"></div></body>', payload)
    expect(html).toContain("toggleAttribute('data-dsh-minimal', true)")
  })

  it('persists later/never decisions and enables through the same setting path', () => {
    vi.useFakeTimers()
    const host = stubConfigForm<ThemeSettings>()
    const theme = new ThemeRuntime(new Context(), host.scope)
    theme.minimalSuggestion.set(true)
    theme.decideMinimalSuggestion('later')
    expect(theme.minimalSuggestion.getSnapshot()).toBe(false)
    expect(theme.getTheme().minimalModeSnoozedUntil).toBe(Date.now() + 7 * 86400_000)
    theme.decideMinimalSuggestion('never')
    expect(theme.getTheme().minimalModeSuggestions).toBe(false)
    theme.decideMinimalSuggestion('enable')
    expect(theme.getTheme().minimalMode).toBe(true)
    vi.advanceTimersByTime(300)
    expect(host.set).toHaveBeenCalledWith('minimalModeSuggestions', false)
    expect(host.set).toHaveBeenCalledWith('minimalMode', true)
  })
})
