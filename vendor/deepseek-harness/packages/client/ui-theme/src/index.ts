/** Host registration for the browser theme preference and pre-plugin palette. */
import type {} from '@deepseek-ai/dsh-settings'

import type { Volatile } from '@deepseek-ai/cordis'
import type { ThemeSettings } from './theme-settings.ts'
import z from '@deepseek-ai/schemastery'

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { bootThemeInjections, buildThemeBootPayload } from './boot-theme.ts'
import {
  ThemeSettingsFields, ThemeSettingsSchema,
} from './theme-settings.ts'

export {
  DEFAULT_FONT_SIZE, DEFAULT_PREFERENCE, DEFAULT_THEME_SETTINGS, FONT_SIZE_FIELD, FONT_SIZE_MAX,
  FONT_SIZE_MIN, THEME_PREFERENCE_FIELD, THEME_PREFERENCES, THEME_SETTINGS_NAMESPACE,
  type ThemePreference, type ThemeSettings,
} from './theme-settings.ts'
export { bootThemeInjection, bootThemeInjections, buildThemeBootPayload, injectBootTheme } from './boot-theme.ts'
export type { ThemeBootPayload } from './boot-theme.ts'

/** Every Appearance preference is editable through the live Host form. */
export type Config = { [K in keyof ThemeSettings]: Volatile<ThemeSettings[K]> }

/** Live preferences projected to the browser, using the durable field schema. */
export const Config = z.object({
  preference: ThemeSettingsFields.preference.volatile(),
  fontSize: ThemeSettingsFields.fontSize.volatile(),
  terminalFontSize: ThemeSettingsFields.terminalFontSize.volatile(),
  activeLightThemeId: ThemeSettingsFields.activeLightThemeId.volatile(),
  activeDarkThemeId: ThemeSettingsFields.activeDarkThemeId.volatile(),
  customThemes: ThemeSettingsFields.customThemes.volatile(),
  glassOpacity: ThemeSettingsFields.glassOpacity.volatile(),
  terminalOpacity: ThemeSettingsFields.terminalOpacity.volatile(),
  transparentTheme: ThemeSettingsFields.transparentTheme.volatile(),
  sidebarMaskHidden: ThemeSettingsFields.sidebarMaskHidden.volatile(),
  wallpaperImage: ThemeSettingsFields.wallpaperImage.volatile(),
  wallpaperBlur: ThemeSettingsFields.wallpaperBlur.volatile(),
  wallpaperPixelate: ThemeSettingsFields.wallpaperPixelate.volatile(),
  wallpaperBingEnabled: ThemeSettingsFields.wallpaperBingEnabled.volatile(),
  wallpaperCatalogUrls: ThemeSettingsFields.wallpaperCatalogUrls.volatile(),
  wallpaperSources: ThemeSettingsFields.wallpaperSources.volatile(),
  wallpaperFavorites: ThemeSettingsFields.wallpaperFavorites.volatile(),
  backgroundEffect: ThemeSettingsFields.backgroundEffect.volatile(),
  backgroundEffectColors: ThemeSettingsFields.backgroundEffectColors.volatile(),
  backgroundEffectSpeed: ThemeSettingsFields.backgroundEffectSpeed.volatile(),
  backgroundEffectCount: ThemeSettingsFields.backgroundEffectCount.volatile(),
  backgroundEffectPreset: ThemeSettingsFields.backgroundEffectPreset.volatile(),
  backgroundEffectVariant: ThemeSettingsFields.backgroundEffectVariant.volatile(),
  cursorEffectEnabled: ThemeSettingsFields.cursorEffectEnabled.volatile(),
  cursorEffect: ThemeSettingsFields.cursorEffect.volatile(),
  cursorEffectColors: ThemeSettingsFields.cursorEffectColors.volatile(),
  cursorEffectSpeed: ThemeSettingsFields.cursorEffectSpeed.volatile(),
  cursorEffectSize: ThemeSettingsFields.cursorEffectSize.volatile(),
  cursorEffectPreset: ThemeSettingsFields.cursorEffectPreset.volatile(),
  metallicPaintEnabled: ThemeSettingsFields.metallicPaintEnabled.volatile(),
  fontFamilySans: ThemeSettingsFields.fontFamilySans.volatile(),
  fontFamilyCode: ThemeSettingsFields.fontFamilyCode.volatile(),
  fontSizeInterface: ThemeSettingsFields.fontSizeInterface.volatile(),
  fontSizeCode: ThemeSettingsFields.fontSizeCode.volatile(),
  fontFamilyComposer: ThemeSettingsFields.fontFamilyComposer.volatile(),
  fontFamilyTerminal: ThemeSettingsFields.fontFamilyTerminal.volatile(),
})

/** Supply the current palette before browser plugins start.
 * @param ctx Host plugin context.
 * @param config Validated live theme preferences.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  ctx.on('webserver/index-inject', (table) => {
    const values = Object.fromEntries(Object.entries(config).map(([field, value]) => [field, value.get()]))
    const section: ThemeSettings = z.resolve(values, ThemeSettingsSchema, {})[0]
    table.push(...bootThemeInjections(buildThemeBootPayload(section)))
  }, { prepend: true })
}
