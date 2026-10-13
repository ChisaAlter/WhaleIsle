/** Host registration for conversation preferences and next-message suggestions. */
import type {} from '@deepseek-ai/dsh-settings'

import type { Volatile, Context } from '@deepseek-ai/cordis'
import type { ConversationSettings } from './submission-settings.ts'
import z from '@deepseek-ai/schemastery'

import { ConversationSettingsFields } from './submission-settings.ts'
import { applyNextPrompt } from './next-prompt.ts'

export {
  BUSY_ENTER_BEHAVIORS, BUSY_ENTER_FIELD, COMPOSER_BEAM_DIRECTIONS, COMPOSER_BEAM_EASINGS,
  COMPOSER_BEAM_FIELD, COMPOSER_BEAM_MODES, COMPOSER_BEAM_PALETTE_COLORS, COMPOSER_BEAM_PALETTES,
  COMPOSER_BEAM_PRESETS_FIELD, COMPOSER_BEAM_STYLE_FIELD, COMPOSER_RESIZE_FIELD,
  COMPOSER_RESIZE_HEIGHT_FIELD, COMPOSER_RESIZE_WIDTH_FIELD,
  CONVERSATION_SETTINGS_NAMESPACE, CUSTOM_INSTRUCTIONS_FIELD, CUSTOM_INSTRUCTIONS_MAX_LENGTH,
  OFFICIAL_PEAK_VALLEY_FIELD, SESSION_COST_FIELD,
  SESSION_COST_PRICES_FIELD, STATS_LINE_FIELD, VIEW_TABS_FIELD,
  TYPING_FX_CURSORS, TYPING_FX_EFFECTS, TYPING_FX_FIELD, TYPING_FX_PRESETS_FIELD,
  TYPING_FX_STYLE_FIELD,
  DEFAULT_BUSY_ENTER_BEHAVIOR, DEFAULT_COMPOSER_BEAM, DEFAULT_COMPOSER_BEAM_PRESETS,
  DEFAULT_COMPOSER_BEAM_STYLE, DEFAULT_COMPOSER_RESIZE,
  DEFAULT_COMPOSER_RESIZE_HEIGHT, DEFAULT_COMPOSER_RESIZE_WIDTH,
  DEFAULT_CUSTOM_INSTRUCTIONS,
  DEFAULT_NEXT_PROMPT, NEXT_PROMPT_FIELD,
  DEFAULT_OFFICIAL_PEAK_VALLEY, DEFAULT_SESSION_COST, DEFAULT_SESSION_COST_PRICES,
  DEFAULT_STATS_LINE, DEFAULT_TYPING_FX, DEFAULT_TYPING_FX_PRESETS, DEFAULT_TYPING_FX_STYLE,
  DEFAULT_VIEW_TABS,
  type BusyEnterBehavior, type ComposerBeamDirection, type ComposerBeamEasing, type ComposerBeamMode,
  type ComposerBeamPalette, type ComposerBeamPaletteId, type ComposerBeamPresets, type ComposerBeamStyle,
  type ConversationSettings, type SessionCostModelPrice, type SessionCostPrices,
  type TypingFxColors, type TypingFxColorSchemeId, type TypingFxCursor, type TypingFxEffect,
  type TypingFxPresets, type TypingFxStyle,
} from './submission-settings.ts'

/** Every browser-editable preference is a live Host configuration field. */
export type Config = { [K in keyof ConversationSettings]: Volatile<ConversationSettings[K]> }

/** Live preferences projected to the browser. */
export const Config = z.object({
  busyEnter: ConversationSettingsFields.busyEnter.volatile(),
  composerBeam: ConversationSettingsFields.composerBeam.volatile(),
  composerBeamStyle: ConversationSettingsFields.composerBeamStyle.volatile(),
  composerBeamPresets: ConversationSettingsFields.composerBeamPresets.volatile(),
  composerResize: ConversationSettingsFields.composerResize.volatile(),
  composerResizeHeight: ConversationSettingsFields.composerResizeHeight.volatile(),
  composerResizeWidth: ConversationSettingsFields.composerResizeWidth.volatile(),
  statsLine: ConversationSettingsFields.statsLine.volatile(),
  officialPeakValley: ConversationSettingsFields.officialPeakValley.volatile(),
  sessionCost: ConversationSettingsFields.sessionCost.volatile(),
  sessionCostPrices: ConversationSettingsFields.sessionCostPrices.volatile(),
  viewTabs: ConversationSettingsFields.viewTabs.volatile(),
  nextPrompt: ConversationSettingsFields.nextPrompt.volatile(),
  typingFx: ConversationSettingsFields.typingFx.volatile(),
  typingFxStyle: ConversationSettingsFields.typingFxStyle.volatile(),
  typingFxPresets: ConversationSettingsFields.typingFxPresets.volatile(),
  customInstructions: ConversationSettingsFields.customInstructions.volatile(),
})

/** Host preferences are consumed through the configuration form projection.
 * @param ctx Plugin context used for optional settings presentation.
 * @param config Live conversation preferences, including next-message suggestions.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  ctx.inject(['connection', 'llm', 'sessions'], (child) => {
    applyNextPrompt(child, () => config.nextPrompt?.get() !== false)
  })
}
