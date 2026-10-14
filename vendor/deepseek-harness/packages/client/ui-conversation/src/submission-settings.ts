/** Conversation preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the conversation plugin. */
export const CONVERSATION_SETTINGS_NAMESPACE = 'ui-conversation'

/** Field carrying the delivery mode for plain Enter while an agent is busy. */
export const BUSY_ENTER_FIELD = 'busyEnter'

/** Field carrying whether the composer plays the send/think border beam. */
export const COMPOSER_BEAM_FIELD = 'composerBeam'

/** Field carrying the configurable visual treatment for the composer beam. */
export const COMPOSER_BEAM_STYLE_FIELD = 'composerBeamStyle'

/** Field carrying the user's saved composer-beam visual presets. */
export const COMPOSER_BEAM_PRESETS_FIELD = 'composerBeamPresets'

/** Field carrying whether the composer plays typing echoes and a custom caret. */
export const TYPING_FX_FIELD = 'typingFx'

/** Field carrying the configurable visual treatment for the typing effect. */
export const TYPING_FX_STYLE_FIELD = 'typingFxStyle'

/** Field carrying the user's saved typing-effect visual presets. */
export const TYPING_FX_PRESETS_FIELD = 'typingFxPresets'

/** Field carrying whether the composer text box can be drag-resized. */
export const COMPOSER_RESIZE_FIELD = 'composerResize'

/** Field carrying the last dragged composer scrollport height in CSS pixels. */
export const COMPOSER_RESIZE_HEIGHT_FIELD = 'composerResizeHeight'

/** Field carrying the last dragged composer card width in CSS pixels. */
export const COMPOSER_RESIZE_WIDTH_FIELD = 'composerResizeWidth'

/** Field carrying whether the composer dock paints the session stats strip. */
export const STATS_LINE_FIELD = 'statsLine'

/** Field carrying whether the official peak/valley status row is force-enabled. */
export const OFFICIAL_PEAK_VALLEY_FIELD = 'officialPeakValley'

/** Field carrying whether the composer dock paints the session cost figure. */
export const SESSION_COST_FIELD = 'sessionCost'

/** Field carrying the user's per-model custom peak-hour prices (absent model = use official/default). */
export const SESSION_COST_PRICES_FIELD = 'sessionCostPrices'

/** Field carrying whether the session header paints Chat/Trajectory tabs. */
export const VIEW_TABS_FIELD = 'viewTabs'

/** Field carrying whether the composer suggests the next user prompt. */
export const NEXT_PROMPT_FIELD = 'nextPrompt'

/** Field carrying the user's standing custom instructions sent with every request. */
export const CUSTOM_INSTRUCTIONS_FIELD = 'customInstructions'

/** Character cap on the custom-instructions text. */
export const CUSTOM_INSTRUCTIONS_MAX_LENGTH = 1500

/** Default is no standing instructions. */
export const DEFAULT_CUSTOM_INSTRUCTIONS = ''

/** Busy-Enter behaviors accepted at settings and input boundaries. */
export const BUSY_ENTER_BEHAVIORS = ['queue', 'steer'] as const

/** Configurable meaning of plain Enter while the addressed agent is busy. */
export type BusyEnterBehavior = typeof BUSY_ENTER_BEHAVIORS[number]

/** Default preserves Enter-as-Queue for running conversations. */
export const DEFAULT_BUSY_ENTER_BEHAVIOR: BusyEnterBehavior = 'queue'

/** Default keeps the composer border beam while a turn is in flight. */
export const DEFAULT_COMPOSER_BEAM = true

/** Directions accepted by the running composer beam. */
export const COMPOSER_BEAM_DIRECTIONS = ['clockwise', 'counterclockwise', 'pingPong'] as const

/** Direction of the rotating beam window. */
export type ComposerBeamDirection = typeof COMPOSER_BEAM_DIRECTIONS[number]

/** Named visual profiles; none of these reads Conversation business state. */
export const COMPOSER_BEAM_MODES = ['legacy', 'lounge', 'aurora', 'reactive', 'custom'] as const

/** Visual profile applied to the running beam. */
export type ComposerBeamMode = typeof COMPOSER_BEAM_MODES[number]

/** Built-in palette identifiers exposed by the settings panel. */
export const COMPOSER_BEAM_PALETTES = [
  'legacy', 'warm', 'aurora', 'rose', 'glacier', 'cyber', 'sunset', 'cyan',
] as const

/** Built-in palette identifier. */
export type ComposerBeamPaletteId = typeof COMPOSER_BEAM_PALETTES[number]

/** Color stops used by the eight built-in beam palettes. */
export const COMPOSER_BEAM_PALETTE_COLORS: Readonly<Record<ComposerBeamPaletteId, readonly string[]>> = {
  legacy: ['#ff3264', '#288cff', '#32c850', '#1eb9aa', '#6446ff', '#ff7828', '#f032b4'],
  warm: ['#ff4d6d', '#ff8c42', '#ffd166', '#ef476f', '#ff4d6d'],
  aurora: ['#42e8c8', '#3f8cff', '#8a5cf6', '#e45bff', '#42e8c8'],
  rose: ['#ff4f81', '#ff79c6', '#c77dff', '#7b61ff', '#ff4f81'],
  glacier: ['#d9f7ff', '#6edff6', '#328bff', '#5b6dff', '#d9f7ff'],
  cyber: ['#00f0ff', '#00ff8f', '#b6ff00', '#ffed00', '#00f0ff'],
  sunset: ['#ff5f6d', '#ffc371', '#ff9a8b', '#ff6a88', '#ff5f6d'],
  cyan: ['#31d7ff', '#1eb9aa', '#64a8ff', '#31d7ff'],
}

/** Palette selected by a beam profile. */
export type ComposerBeamPalette =
  | { kind: 'preset'; id: ComposerBeamPaletteId }
  | { kind: 'custom'; colors: string[] }

/** Independent breathing animation controls. */
export interface ComposerBeamBreathing {
  enabled: boolean
  amplitude: number
  period: number
}

/** Independent hue-cycle animation controls. */
export interface ComposerBeamHueCycle {
  enabled: boolean
  range: number
  period: number
}

/** Local-clock night dimming controls. */
export interface ComposerBeamNight {
  enabled: boolean
  fromMinute: number
  toMinute: number
  dim: number
}

/** Easing choices used by the primary beam motion. */
export const COMPOSER_BEAM_EASINGS = ['linear', 'ease', 'ease-in-out', 'cubic-bezier'] as const

/** Persisted easing identifier. */
export type ComposerBeamEasing = typeof COMPOSER_BEAM_EASINGS[number]

/** User-tunable beam values; the shell, source geometry, and masks stay fixed in CSS. */
export interface ComposerBeamStyle {
  /** Rotation direction for the conic intensity window. */
  direction: ComposerBeamDirection
  /** Seconds for one complete rotation. */
  period: number
  /** Percent scale applied to stroke, inner light, and bloom. */
  intensity: number
  /** Additional percent scale applied only to bloom. */
  bloom: number
  /** Global hue offset in degrees. */
  hue: number
  /** Named visual / motion profile. */
  mode: ComposerBeamMode
  /** Built-in or custom color source shared by all beam layers. */
  palette: ComposerBeamPalette
  /** Stroke track width in CSS pixels. */
  trackWidth: number
  /** Bloom filter blur in CSS pixels. */
  glowBlur: number
  /** Optional opacity breathing profile. */
  breathing: ComposerBeamBreathing
  /** Optional hue-rotation profile. */
  hueCycle: ComposerBeamHueCycle
  /** Optional local-clock dimming window. */
  night: ComposerBeamNight
  /** Primary rotation / ping-pong easing. */
  easing: ComposerBeamEasing
}

export const MIN_COMPOSER_BEAM_PERIOD = 0.8
export const MAX_COMPOSER_BEAM_PERIOD = 60
export const MIN_COMPOSER_BEAM_INTENSITY = 40
export const MAX_COMPOSER_BEAM_INTENSITY = 140
export const MIN_COMPOSER_BEAM_BLOOM = 0
export const MAX_COMPOSER_BEAM_BLOOM = 160
export const MIN_COMPOSER_BEAM_HUE = -180
export const MAX_COMPOSER_BEAM_HUE = 180
export const MIN_COMPOSER_BEAM_TRACK_WIDTH = 0.5
export const MAX_COMPOSER_BEAM_TRACK_WIDTH = 4
export const MIN_COMPOSER_BEAM_GLOW_BLUR = 0
export const MAX_COMPOSER_BEAM_GLOW_BLUR = 12
export const MIN_COMPOSER_BEAM_BREATHING_AMPLITUDE = 0
export const MAX_COMPOSER_BEAM_BREATHING_AMPLITUDE = 0.8
export const MIN_COMPOSER_BEAM_BREATHING_PERIOD = 1
export const MAX_COMPOSER_BEAM_BREATHING_PERIOD = 20
export const MIN_COMPOSER_BEAM_HUE_CYCLE_RANGE = 0
export const MAX_COMPOSER_BEAM_HUE_CYCLE_RANGE = 360
export const MIN_COMPOSER_BEAM_HUE_CYCLE_PERIOD = 1
export const MAX_COMPOSER_BEAM_HUE_CYCLE_PERIOD = 60
export const MIN_COMPOSER_BEAM_NIGHT_MINUTE = 0
export const MAX_COMPOSER_BEAM_NIGHT_MINUTE = 1439
export const MIN_COMPOSER_BEAM_NIGHT_DIM = 0
export const MAX_COMPOSER_BEAM_NIGHT_DIM = 100
export const MIN_COMPOSER_BEAM_CUSTOM_COLORS = 2
export const MAX_COMPOSER_BEAM_CUSTOM_COLORS = 6
export const MAX_COMPOSER_BEAM_PRESETS = 5
export const MAX_COMPOSER_BEAM_PRESET_NAME_LENGTH = 32
export const MAX_COMPOSER_BEAM_JSON_BYTES = 64 * 1024

const DEFAULT_COMPOSER_BEAM_PALETTE: ComposerBeamPalette = Object.freeze({ kind: 'preset', id: 'legacy' })
const DEFAULT_COMPOSER_BEAM_BREATHING: ComposerBeamBreathing = Object.freeze({
  enabled: false,
  amplitude: 0.3,
  period: 6,
})
const DEFAULT_COMPOSER_BEAM_HUE_CYCLE: ComposerBeamHueCycle = Object.freeze({
  enabled: true,
  range: 30,
  period: 12,
})
const DEFAULT_COMPOSER_BEAM_NIGHT: ComposerBeamNight = Object.freeze({
  enabled: false,
  fromMinute: 1320,
  toMinute: 360,
  dim: 40,
})

/** Defaults reproduce the beam that shipped before customization. */
export const DEFAULT_COMPOSER_BEAM_STYLE: ComposerBeamStyle = Object.freeze({
  direction: 'clockwise',
  period: 1.96,
  intensity: 100,
  bloom: 100,
  hue: 0,
  mode: 'legacy',
  palette: DEFAULT_COMPOSER_BEAM_PALETTE,
  trackWidth: 2,
  glowBlur: 8,
  breathing: DEFAULT_COMPOSER_BEAM_BREATHING,
  hueCycle: DEFAULT_COMPOSER_BEAM_HUE_CYCLE,
  night: DEFAULT_COMPOSER_BEAM_NIGHT,
  easing: 'linear',
})

/** Empty by default so adding the feature does not materialize a new user entry. */
export const DEFAULT_COMPOSER_BEAM_PRESETS: ComposerBeamPresets = Object.freeze({})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const clampNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

const isPaletteId = (value: unknown): value is ComposerBeamPaletteId =>
  typeof value === 'string' && COMPOSER_BEAM_PALETTES.includes(value as ComposerBeamPaletteId)

const isHexColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)

const normalizePalette = (value: unknown): ComposerBeamPalette => {
  if (!isRecord(value)) return { ...DEFAULT_COMPOSER_BEAM_PALETTE }
  if (value.kind === 'preset' && isPaletteId(value.id)) return { kind: 'preset', id: value.id }
  if (value.kind === 'custom' && Array.isArray(value.colors)) {
    const colors = value.colors.filter(isHexColor).map(color => color.toLowerCase())
    if (colors.length >= MIN_COMPOSER_BEAM_CUSTOM_COLORS && colors.length <= MAX_COMPOSER_BEAM_CUSTOM_COLORS) {
      return { kind: 'custom', colors }
    }
  }
  return { ...DEFAULT_COMPOSER_BEAM_PALETTE }
}

/** Normalize an active style at browser, preset, and settings adoption boundaries. */
export function normalizeComposerBeamStyle(value: unknown): ComposerBeamStyle {
  const raw = isRecord(value) ? value : {}
  const breathing = isRecord(raw.breathing) ? raw.breathing : {}
  const hueCycle = isRecord(raw.hueCycle) ? raw.hueCycle : {}
  const night = isRecord(raw.night) ? raw.night : {}
  return {
    direction: COMPOSER_BEAM_DIRECTIONS.includes(raw.direction as ComposerBeamDirection)
      ? raw.direction as ComposerBeamDirection
      : DEFAULT_COMPOSER_BEAM_STYLE.direction,
    period: clampNumber(raw.period, DEFAULT_COMPOSER_BEAM_STYLE.period, MIN_COMPOSER_BEAM_PERIOD, MAX_COMPOSER_BEAM_PERIOD),
    intensity: clampNumber(raw.intensity, DEFAULT_COMPOSER_BEAM_STYLE.intensity, MIN_COMPOSER_BEAM_INTENSITY, MAX_COMPOSER_BEAM_INTENSITY),
    bloom: clampNumber(raw.bloom, DEFAULT_COMPOSER_BEAM_STYLE.bloom, MIN_COMPOSER_BEAM_BLOOM, MAX_COMPOSER_BEAM_BLOOM),
    hue: clampNumber(raw.hue, DEFAULT_COMPOSER_BEAM_STYLE.hue, MIN_COMPOSER_BEAM_HUE, MAX_COMPOSER_BEAM_HUE),
    mode: COMPOSER_BEAM_MODES.includes(raw.mode as ComposerBeamMode)
      ? raw.mode as ComposerBeamMode
      : DEFAULT_COMPOSER_BEAM_STYLE.mode,
    palette: normalizePalette(raw.palette),
    trackWidth: clampNumber(
      raw.trackWidth,
      DEFAULT_COMPOSER_BEAM_STYLE.trackWidth,
      MIN_COMPOSER_BEAM_TRACK_WIDTH,
      MAX_COMPOSER_BEAM_TRACK_WIDTH,
    ),
    glowBlur: clampNumber(
      raw.glowBlur,
      DEFAULT_COMPOSER_BEAM_STYLE.glowBlur,
      MIN_COMPOSER_BEAM_GLOW_BLUR,
      MAX_COMPOSER_BEAM_GLOW_BLUR,
    ),
    breathing: {
      enabled: breathing.enabled === true,
      amplitude: clampNumber(
        breathing.amplitude,
        DEFAULT_COMPOSER_BEAM_STYLE.breathing.amplitude,
        MIN_COMPOSER_BEAM_BREATHING_AMPLITUDE,
        MAX_COMPOSER_BEAM_BREATHING_AMPLITUDE,
      ),
      period: clampNumber(
        breathing.period,
        DEFAULT_COMPOSER_BEAM_STYLE.breathing.period,
        MIN_COMPOSER_BEAM_BREATHING_PERIOD,
        MAX_COMPOSER_BEAM_BREATHING_PERIOD,
      ),
    },
    hueCycle: {
      enabled: hueCycle.enabled !== false,
      range: clampNumber(
        hueCycle.range,
        DEFAULT_COMPOSER_BEAM_STYLE.hueCycle.range,
        MIN_COMPOSER_BEAM_HUE_CYCLE_RANGE,
        MAX_COMPOSER_BEAM_HUE_CYCLE_RANGE,
      ),
      period: clampNumber(
        hueCycle.period,
        DEFAULT_COMPOSER_BEAM_STYLE.hueCycle.period,
        MIN_COMPOSER_BEAM_HUE_CYCLE_PERIOD,
        MAX_COMPOSER_BEAM_HUE_CYCLE_PERIOD,
      ),
    },
    night: {
      enabled: night.enabled === true,
      fromMinute: Math.round(clampNumber(
        night.fromMinute,
        DEFAULT_COMPOSER_BEAM_STYLE.night.fromMinute,
        MIN_COMPOSER_BEAM_NIGHT_MINUTE,
        MAX_COMPOSER_BEAM_NIGHT_MINUTE,
      )),
      toMinute: Math.round(clampNumber(
        night.toMinute,
        DEFAULT_COMPOSER_BEAM_STYLE.night.toMinute,
        MIN_COMPOSER_BEAM_NIGHT_MINUTE,
        MAX_COMPOSER_BEAM_NIGHT_MINUTE,
      )),
      dim: clampNumber(
        night.dim,
        DEFAULT_COMPOSER_BEAM_STYLE.night.dim,
        MIN_COMPOSER_BEAM_NIGHT_DIM,
        MAX_COMPOSER_BEAM_NIGHT_DIM,
      ),
    },
    easing: COMPOSER_BEAM_EASINGS.includes(raw.easing as ComposerBeamEasing)
      ? raw.easing as ComposerBeamEasing
      : DEFAULT_COMPOSER_BEAM_STYLE.easing,
  }
}

/** User presets are a bounded plain record of normalized active styles. */
export type ComposerBeamPresets = Record<string, ComposerBeamStyle>

/** Normalize preset names and cap the durable library at five entries. */
export function normalizeComposerBeamPresets(value: unknown): ComposerBeamPresets {
  if (!isRecord(value)) return {}
  const result: ComposerBeamPresets = {}
  for (const [rawName, rawStyle] of Object.entries(value)) {
    if (Object.keys(result).length >= MAX_COMPOSER_BEAM_PRESETS) break
    const name = rawName.trim().slice(0, MAX_COMPOSER_BEAM_PRESET_NAME_LENGTH)
    if (name === '' || name === '__proto__' || name === 'constructor' || name === 'prototype') continue
    Object.defineProperty(result, name, {
      configurable: true,
      enumerable: true,
      value: normalizeComposerBeamStyle(rawStyle),
      writable: true,
    })
  }
  return result
}

/** Named echo animations; each paints the inserted glyph's ghost, not the real text node. */
export const TYPING_FX_EFFECTS = ['drop', 'rise', 'flash'] as const

/** Echo animation applied to a freshly typed character. */
export type TypingFxEffect = typeof TYPING_FX_EFFECTS[number]

/** Caret treatments; `native` leaves the contenteditable caret untouched. */
export const TYPING_FX_CURSORS = ['native', 'block', 'underline'] as const

/** Caret treatment rendered by the typing-fx overlay. */
export type TypingFxCursor = typeof TYPING_FX_CURSORS[number]

/** Built-in echo/caret color-scheme identifiers exposed by the settings panel. */
export const TYPING_FX_COLOR_SCHEMES = ['ocean', 'sunset', 'candy', 'forest', 'violet', 'ember'] as const

/** Built-in color-scheme identifier. */
export type TypingFxColorSchemeId = typeof TYPING_FX_COLOR_SCHEMES[number]

/** Echo/caret/text triplet of one built-in scheme: the lighter stop ghosts, the accent drives the caret, the deep stop paints composer text. */
export const TYPING_FX_COLOR_SCHEME_COLORS: Readonly<Record<TypingFxColorSchemeId, { echo: string; caret: string; text: string }>> = {
  ocean: { echo: '#7dd3fc', caret: '#38bdf8', text: '#0284c7' },
  sunset: { echo: '#fdba74', caret: '#fb923c', text: '#ea580c' },
  candy: { echo: '#f9a8d4', caret: '#ec4899', text: '#db2777' },
  forest: { echo: '#86efac', caret: '#34d399', text: '#059669' },
  violet: { echo: '#c4b5fd', caret: '#8b5cf6', text: '#7c3aed' },
  ember: { echo: '#fcd34d', caret: '#f59e0b', text: '#d97706' },
}

/** Echo/caret/text color source: theme tokens, a named scheme, or an explicit triplet. */
export type TypingFxColors =
  | { kind: 'theme' }
  | { kind: 'preset'; id: TypingFxColorSchemeId }
  | { kind: 'custom'; echo: string; caret: string; text: string }

/** Concrete paint values; null means the CSS token fallback applies. */
export interface TypingFxResolvedColors {
  readonly echo: string | null
  readonly caret: string | null
  readonly text: string | null
}

/** Resolve the active color source to hex stops (or null = theme token). */
export function resolveTypingFxColors(colors: TypingFxColors): TypingFxResolvedColors {
  if (colors.kind === 'theme') return { echo: null, caret: null, text: null }
  if (colors.kind === 'preset') return TYPING_FX_COLOR_SCHEME_COLORS[colors.id]
  return { echo: colors.echo, caret: colors.caret, text: colors.text }
}

/** User-tunable typing-effect values; geometry stays fixed in CSS. */
export interface TypingFxStyle {
  /** Echo animation played on each inserted character. */
  effect: TypingFxEffect
  /** Caret replacement drawn over the editor. */
  cursor: TypingFxCursor
  /** Whether a custom caret blinks; `native` ignores this. */
  cursorBlink: boolean
  /** Percent speed scale applied to the echo lifetime (higher = shorter). */
  speed: number
  /** Echo/caret color source. */
  colors: TypingFxColors
}

export const MIN_TYPING_FX_SPEED = 40
export const MAX_TYPING_FX_SPEED = 240
export const MAX_TYPING_FX_PRESETS = 5
export const MAX_TYPING_FX_PRESET_NAME_LENGTH = 32
export const MAX_TYPING_FX_JSON_BYTES = 32 * 1024

/** Default keeps the feature opt-in: a new document carries no typing effect. */
export const DEFAULT_TYPING_FX = false

/** Defaults give the mildest treatment so opting in never surprises. */
export const DEFAULT_TYPING_FX_STYLE: TypingFxStyle = Object.freeze({
  effect: 'drop',
  cursor: 'native',
  cursorBlink: true,
  speed: 100,
  colors: Object.freeze({ kind: 'theme' as const }),
})

/** User presets are a bounded plain record of normalized styles. */
export type TypingFxPresets = Record<string, TypingFxStyle>

/** Empty by default so adding the feature does not materialize a new user entry. */
export const DEFAULT_TYPING_FX_PRESETS: TypingFxPresets = Object.freeze({})

const isTypingFxEffect = (value: unknown): value is TypingFxEffect =>
  typeof value === 'string' && TYPING_FX_EFFECTS.includes(value as TypingFxEffect)

const isTypingFxCursor = (value: unknown): value is TypingFxCursor =>
  typeof value === 'string' && TYPING_FX_CURSORS.includes(value as TypingFxCursor)

const isTypingFxColorScheme = (value: unknown): value is TypingFxColorSchemeId =>
  typeof value === 'string' && TYPING_FX_COLOR_SCHEMES.includes(value as TypingFxColorSchemeId)

/** Normalize the color source; anything unrecognized follows the theme tokens. */
export function normalizeTypingFxColors(value: unknown): TypingFxColors {
  if (!isRecord(value)) return { kind: 'theme' }
  if (value.kind === 'preset' && isTypingFxColorScheme(value.id)) return { kind: 'preset', id: value.id }
  if (value.kind === 'custom' && isHexColor(value.echo) && isHexColor(value.caret) && isHexColor(value.text)) {
    return {
      kind: 'custom',
      echo: value.echo.toLowerCase(),
      caret: value.caret.toLowerCase(),
      text: value.text.toLowerCase(),
    }
  }
  return { kind: 'theme' }
}

/** Normalize an active style at browser, preset, and settings adoption boundaries. */
export function normalizeTypingFxStyle(value: unknown): TypingFxStyle {
  const raw = isRecord(value) ? value : {}
  return {
    effect: isTypingFxEffect(raw.effect) ? raw.effect : DEFAULT_TYPING_FX_STYLE.effect,
    cursor: isTypingFxCursor(raw.cursor) ? raw.cursor : DEFAULT_TYPING_FX_STYLE.cursor,
    cursorBlink: typeof raw.cursorBlink === 'boolean' ? raw.cursorBlink : DEFAULT_TYPING_FX_STYLE.cursorBlink,
    speed: clampNumber(raw.speed, DEFAULT_TYPING_FX_STYLE.speed, MIN_TYPING_FX_SPEED, MAX_TYPING_FX_SPEED),
    colors: normalizeTypingFxColors(raw.colors),
  }
}

/** Normalize preset names and cap the durable library at five entries. */
export function normalizeTypingFxPresets(value: unknown): TypingFxPresets {
  if (!isRecord(value)) return {}
  const result: TypingFxPresets = {}
  for (const [rawName, rawStyle] of Object.entries(value)) {
    if (Object.keys(result).length >= MAX_TYPING_FX_PRESETS) break
    const name = rawName.trim().slice(0, MAX_TYPING_FX_PRESET_NAME_LENGTH)
    if (name === '' || name === '__proto__' || name === 'constructor' || name === 'prototype') continue
    Object.defineProperty(result, name, {
      configurable: true,
      enumerable: true,
      value: normalizeTypingFxStyle(rawStyle),
      writable: true,
    })
  }
  return result
}

/** Default keeps auto-grow only; drag-resize is an explicit opt-in. */
export const DEFAULT_COMPOSER_RESIZE = false

/** Default means no remembered scrollport height (auto-grow). */
export const DEFAULT_COMPOSER_RESIZE_HEIGHT: number | null = null

/** Default means no remembered card width (column width). */
export const DEFAULT_COMPOSER_RESIZE_WIDTH: number | null = null

/** Default keeps the composer-dock session stats strip. */
export const DEFAULT_STATS_LINE = true

/** Default means the peak/valley row shows only while a DeepSeek API route is detected. */
export const DEFAULT_OFFICIAL_PEAK_VALLEY = false

/** Default hides the session cost figure until the user opts in. */
export const DEFAULT_SESSION_COST = false

/** Default means every model bills at its official (or first-column) price. */
export const DEFAULT_SESSION_COST_PRICES: SessionCostPrices = {}

/**
 * Prices for one model, in CNY per million tokens. The base fields describe
 * the peak column; off-peak billing reads the official idle column for an
 * official model, the explicit {@link SessionCostModelPrice.idle} column when
 * the user prices both periods, or the idle figure implied by the peaks for a
 * single-priced model the official table does not name.
 */
export interface SessionCostModelPrice {
  /** Cache-hit prompt input during peak hours. */
  inputCacheHit: number
  /** Cache-miss prompt input (cache writes included) during peak hours. */
  inputCacheMiss: number
  /** Response output during peak hours. */
  output: number
  /**
   * Explicit off-peak column (peak/valley pricing mode): both periods billed
   * as entered. Absent for single-priced models — the idle figure derives
   * from the peaks.
   */
  idle?: {
    /** Cache-hit prompt input during off-peak hours. */
    inputCacheHit: number
    /** Cache-miss prompt input (cache writes included) during off-peak hours. */
    inputCacheMiss: number
    /** Response output during off-peak hours. */
    output: number
  }
}

/**
 * User-edited peak-hour prices keyed by `provider/model` (two providers may
 * serve the same model id with different real-world prices, so each keeps its
 * own slot). A bare model id remains accepted as a legacy key, billing it for
 * any provider serving that model until the panel re-saves per provider. A
 * model absent from the record bills at its official table column, or the
 * table's first column when the official table does not name it.
 */
export type SessionCostPrices = Record<string, SessionCostModelPrice>

/** Default keeps the Chat/Trajectory header tablist when more than one view exists. */
export const DEFAULT_VIEW_TABS = true

/** Default enables next-prompt suggestions without submitting them. */
export const DEFAULT_NEXT_PROMPT = true

/** Durable conversation section shared by the Host schema and the browser scope. */
export interface ConversationSettings {
  /** Delivery mode for plain Enter while the addressed agent is busy. */
  busyEnter: BusyEnterBehavior
  /** Whether InputBar paints `.cardBeam` while a turn is sending or thinking. */
  composerBeam: boolean
  /** Optional visual tuning for the same running beam. */
  composerBeamStyle?: ComposerBeamStyle
  /** Optional user-named visual presets for the same running beam. */
  composerBeamPresets?: ComposerBeamPresets
  /** Whether InputBar shows a top-edge handle that sets the draft scrollport height. */
  composerResize: boolean
  /** Last drag-committed scrollport height in CSS pixels; absent/undefined restores auto-grow height. */
  composerResizeHeight?: number | null
  /** Last drag-committed card width in CSS pixels; absent/undefined restores column width. */
  composerResizeWidth?: number | null
  /** Whether StatsLine paints session-stats figures in the composer-dock row. */
  statsLine: boolean
  /** Whether the composer dock force-paints the official peak/valley status row. */
  officialPeakValley: boolean
  /** Whether the composer dock paints the session cost figure; absent/undefined reads as off. */
  sessionCost?: boolean
  /** User-edited per-model peak-hour prices; absent keys bill at official/default prices. */
  sessionCostPrices?: SessionCostPrices
  /** Whether ConversationSessionHeader paints the Chat/Trajectory tablist. */
  viewTabs: boolean
  /** Whether the composer suggests the next user prompt; absent/undefined reads as on. */
  nextPrompt?: boolean
  /** Whether the composer paints typing echoes and a custom caret; absent/undefined reads as off. */
  typingFx?: boolean
  /** Optional visual tuning for the typing effect. */
  typingFxStyle?: TypingFxStyle
  /** Optional user-named visual presets for the typing effect. */
  typingFxPresets?: TypingFxPresets
  /** Standing user instructions appended to the system prompt of every request. */
  customInstructions: string
}

const ComposerBeamPaletteSchema = z.union([
  z.object({
    kind: z.union(['preset'] as const),
    id: z.union([...COMPOSER_BEAM_PALETTES]),
  }),
  z.object({
    kind: z.union(['custom'] as const),
    colors: z.array(z.string().pattern(/^#[0-9a-f]{6}$/i)).min(MIN_COMPOSER_BEAM_CUSTOM_COLORS).max(MAX_COMPOSER_BEAM_CUSTOM_COLORS),
  }),
])

const ComposerBeamStyleSchema: z<ComposerBeamStyle> = z.object({
  direction: z.union([...COMPOSER_BEAM_DIRECTIONS]).default(DEFAULT_COMPOSER_BEAM_STYLE.direction),
  period: z.number().min(MIN_COMPOSER_BEAM_PERIOD).max(MAX_COMPOSER_BEAM_PERIOD).default(DEFAULT_COMPOSER_BEAM_STYLE.period),
  intensity: z.number().min(MIN_COMPOSER_BEAM_INTENSITY).max(MAX_COMPOSER_BEAM_INTENSITY).default(DEFAULT_COMPOSER_BEAM_STYLE.intensity),
  bloom: z.number().min(MIN_COMPOSER_BEAM_BLOOM).max(MAX_COMPOSER_BEAM_BLOOM).default(DEFAULT_COMPOSER_BEAM_STYLE.bloom),
  hue: z.number().min(MIN_COMPOSER_BEAM_HUE).max(MAX_COMPOSER_BEAM_HUE).default(DEFAULT_COMPOSER_BEAM_STYLE.hue),
  mode: z.union([...COMPOSER_BEAM_MODES]).default(DEFAULT_COMPOSER_BEAM_STYLE.mode),
  palette: ComposerBeamPaletteSchema.default(DEFAULT_COMPOSER_BEAM_STYLE.palette),
  trackWidth: z.number()
    .min(MIN_COMPOSER_BEAM_TRACK_WIDTH)
    .max(MAX_COMPOSER_BEAM_TRACK_WIDTH)
    .default(DEFAULT_COMPOSER_BEAM_STYLE.trackWidth),
  glowBlur: z.number()
    .min(MIN_COMPOSER_BEAM_GLOW_BLUR)
    .max(MAX_COMPOSER_BEAM_GLOW_BLUR)
    .default(DEFAULT_COMPOSER_BEAM_STYLE.glowBlur),
  breathing: z.object({
    enabled: z.boolean().default(DEFAULT_COMPOSER_BEAM_STYLE.breathing.enabled),
    amplitude: z.number()
      .min(MIN_COMPOSER_BEAM_BREATHING_AMPLITUDE)
      .max(MAX_COMPOSER_BEAM_BREATHING_AMPLITUDE)
      .default(DEFAULT_COMPOSER_BEAM_STYLE.breathing.amplitude),
    period: z.number()
      .min(MIN_COMPOSER_BEAM_BREATHING_PERIOD)
      .max(MAX_COMPOSER_BEAM_BREATHING_PERIOD)
      .default(DEFAULT_COMPOSER_BEAM_STYLE.breathing.period),
  }).default(DEFAULT_COMPOSER_BEAM_STYLE.breathing),
  hueCycle: z.object({
    enabled: z.boolean().default(DEFAULT_COMPOSER_BEAM_STYLE.hueCycle.enabled),
    range: z.number()
      .min(MIN_COMPOSER_BEAM_HUE_CYCLE_RANGE)
      .max(MAX_COMPOSER_BEAM_HUE_CYCLE_RANGE)
      .default(DEFAULT_COMPOSER_BEAM_STYLE.hueCycle.range),
    period: z.number()
      .min(MIN_COMPOSER_BEAM_HUE_CYCLE_PERIOD)
      .max(MAX_COMPOSER_BEAM_HUE_CYCLE_PERIOD)
      .default(DEFAULT_COMPOSER_BEAM_STYLE.hueCycle.period),
  }).default(DEFAULT_COMPOSER_BEAM_STYLE.hueCycle),
  night: z.object({
    enabled: z.boolean().default(DEFAULT_COMPOSER_BEAM_STYLE.night.enabled),
    fromMinute: z.number()
      .min(MIN_COMPOSER_BEAM_NIGHT_MINUTE)
      .max(MAX_COMPOSER_BEAM_NIGHT_MINUTE)
      .default(DEFAULT_COMPOSER_BEAM_STYLE.night.fromMinute),
    toMinute: z.number()
      .min(MIN_COMPOSER_BEAM_NIGHT_MINUTE)
      .max(MAX_COMPOSER_BEAM_NIGHT_MINUTE)
      .default(DEFAULT_COMPOSER_BEAM_STYLE.night.toMinute),
    dim: z.number()
      .min(MIN_COMPOSER_BEAM_NIGHT_DIM)
      .max(MAX_COMPOSER_BEAM_NIGHT_DIM)
      .default(DEFAULT_COMPOSER_BEAM_STYLE.night.dim),
  }).default(DEFAULT_COMPOSER_BEAM_STYLE.night),
  easing: z.union([...COMPOSER_BEAM_EASINGS]).default(DEFAULT_COMPOSER_BEAM_STYLE.easing),
})

const TypingFxColorsSchema = z.union([
  z.object({ kind: z.union(['theme'] as const) }),
  z.object({
    kind: z.union(['preset'] as const),
    id: z.union([...TYPING_FX_COLOR_SCHEMES]),
  }),
  z.object({
    kind: z.union(['custom'] as const),
    echo: z.string().pattern(/^#[0-9a-f]{6}$/i),
    caret: z.string().pattern(/^#[0-9a-f]{6}$/i),
    text: z.string().pattern(/^#[0-9a-f]{6}$/i),
  }),
])

const TypingFxStyleSchema: z<TypingFxStyle> = z.object({
  effect: z.union([...TYPING_FX_EFFECTS]).default(DEFAULT_TYPING_FX_STYLE.effect),
  cursor: z.union([...TYPING_FX_CURSORS]).default(DEFAULT_TYPING_FX_STYLE.cursor),
  cursorBlink: z.boolean().default(DEFAULT_TYPING_FX_STYLE.cursorBlink),
  speed: z.number().min(MIN_TYPING_FX_SPEED).max(MAX_TYPING_FX_SPEED).default(DEFAULT_TYPING_FX_STYLE.speed),
  colors: TypingFxColorsSchema.default(DEFAULT_TYPING_FX_STYLE.colors),
})

/** Durable conversation schema; also the wire envelope the browser scope validates against. */
export const ConversationSettingsFields = {
  [BUSY_ENTER_FIELD]: z.union([...BUSY_ENTER_BEHAVIORS]).default(DEFAULT_BUSY_ENTER_BEHAVIOR),
  [COMPOSER_BEAM_FIELD]: z.boolean().default(DEFAULT_COMPOSER_BEAM),
  [COMPOSER_BEAM_STYLE_FIELD]: ComposerBeamStyleSchema.default(DEFAULT_COMPOSER_BEAM_STYLE),
  [COMPOSER_BEAM_PRESETS_FIELD]: z.dict(ComposerBeamStyleSchema).required(false),
  [COMPOSER_RESIZE_FIELD]: z.boolean().default(DEFAULT_COMPOSER_RESIZE),
  [COMPOSER_RESIZE_HEIGHT_FIELD]: z.number().min(1).required(false),
  [COMPOSER_RESIZE_WIDTH_FIELD]: z.number().min(1).required(false),
  [STATS_LINE_FIELD]: z.boolean().default(DEFAULT_STATS_LINE),
  [OFFICIAL_PEAK_VALLEY_FIELD]: z.boolean().default(DEFAULT_OFFICIAL_PEAK_VALLEY),
  [SESSION_COST_FIELD]: z.boolean().required(false),
  [SESSION_COST_PRICES_FIELD]: z.any().required(false),
  [VIEW_TABS_FIELD]: z.boolean().default(DEFAULT_VIEW_TABS),
  [NEXT_PROMPT_FIELD]: z.boolean().default(DEFAULT_NEXT_PROMPT),
  [TYPING_FX_FIELD]: z.boolean().required(false),
  [TYPING_FX_STYLE_FIELD]: TypingFxStyleSchema.required(false),
  [TYPING_FX_PRESETS_FIELD]: z.dict(TypingFxStyleSchema).required(false),
  [CUSTOM_INSTRUCTIONS_FIELD]: z.string().max(CUSTOM_INSTRUCTIONS_MAX_LENGTH).default(DEFAULT_CUSTOM_INSTRUCTIONS),
}

/** Schema for shared configuration values. */
export const ConversationSettingsSchema = z.object(ConversationSettingsFields)
