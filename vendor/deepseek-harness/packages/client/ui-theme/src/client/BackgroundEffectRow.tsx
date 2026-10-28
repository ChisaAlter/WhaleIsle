/**
 * Appearance background-effect row: the ambient "flowing gradient" switch
 * plus a settings-gear entry that opens the scheme dialog (preset schemes
 * or a custom scheme). The stored values survive a wallpaper being set —
 * the image always wins — and the effect resumes when the image is cleared.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  Button, IconSettingsOutline16, Modal, SettingsSelect, Switch, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  BACKGROUND_EFFECT_COLOR_SLOTS, BACKGROUND_EFFECT_VARIANTS,
  MAX_BACKGROUND_EFFECT_COUNT,
  MAX_BACKGROUND_EFFECT_SPEED, MIN_BACKGROUND_EFFECT_COUNT,
  MIN_BACKGROUND_EFFECT_SPEED, sanitizeBackgroundEffectColors,
} from '../wallpaper.ts'
import { DEFAULT_THEME_SETTINGS, lowPowerGpu, type ThemeSettings } from '../theme-settings.ts'
import type { ThemeKey } from './locales.ts'
import { EFFECT_PRESETS, effectPreset, type EffectScheme } from './effect-presets.ts'
import { sliderFillStyle } from './slider.ts'
import type { SetWallpaper } from './WallpaperRow.tsx'
import css from './AppearanceSection.module.css'

/** Theme tokens backing the seven color slots, in slot order. */
const SLOT_TOKENS = [
  '--dsw-specific-gradient-start',
  '--dsw-specific-gradient-end',
  '--dsw-specific-gradient-1',
  '--dsw-specific-gradient-2',
  '--dsw-specific-gradient-3',
  '--dsw-specific-gradient-4',
  '--dsw-specific-gradient-5',
] as const

/** Inline override variables the same slots write (mirrors wallpaper.css). */
const SLOT_VARS = [
  '--dsh-gradient-start',
  '--dsh-gradient-end',
  '--dsh-gradient-1',
  '--dsh-gradient-2',
  '--dsh-gradient-3',
  '--dsh-gradient-4',
  '--dsh-gradient-5',
] as const

/** Draft edited inside the dialog: scheme id plus its tunables. */
interface SchemeDraft extends EffectScheme {
  preset: ThemeSettings['backgroundEffectPreset']
}

/**
 * Resolve a theme token to a `#rrggbb` for the color input: the alias chain
 * ends at a static hex token, so chase var() hops until a literal lands.
 * @param name - custom-property name on `body`.
 * @returns a hex color, or a neutral fallback off-DOM.
 */
function resolvedTokenColor(name: string): string {
  if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') return '#808080'
  let value = getComputedStyle(document.body).getPropertyValue(name).trim()
  for (let hop = 0; hop < 4; hop += 1) {
    const inner = /^var\((--[\w-]+)\)$/.exec(value)?.[1]
    if (inner === undefined) break
    value = getComputedStyle(document.body).getPropertyValue(inner).trim()
  }
  return /^#[0-9a-f]{6}$/i.test(value) ? value : '#808080'
}

/** Inline `--dsh-gradient-*` variables a color-slot list writes. */
function overrideVars(colors: readonly string[]): CSSProperties {
  return Object.fromEntries(
    colors
      .map((color, index) => [SLOT_VARS[index] ?? '', color] as const)
      .filter(([name, color]) => name.length > 0 && color.length > 0),
  )
}

/**
 * Mini gradient strip for a scheme card: two bloom radials plus the base
 * wash, mixing preset hexes with theme-token var() references.
 */
function schemeSwatchStyle(colors: readonly string[]): CSSProperties {
  const slot = (index: number, token: string): string => {
    const color = colors[index] ?? ''
    return color !== '' ? color : `var(${token})`
  }
  return {
    background: [
      `radial-gradient(circle at 25% 70%, ${slot(2, '--dsw-specific-gradient-1')} 0%, transparent 45%)`,
      `radial-gradient(circle at 75% 30%, ${slot(4, '--dsw-specific-gradient-3')} 0%, transparent 45%)`,
      `linear-gradient(40deg, ${slot(0, '--dsw-specific-gradient-start')}, ${slot(1, '--dsw-specific-gradient-end')})`,
    ].join(', '),
  }
}

/**
 * Scheme dialog: preset cards carry color bundles only — speed, count, and
 * the bloom variant stay user-adjustable for every scheme. Editing a color
 * slot or tunable marks the scheme custom. Save writes the draft as one settings patch.
 * @param props - open state, stored values, dialog callbacks, copy.
 * @returns the settings modal.
 */
function BackgroundEffectModal({ open, values, onClose, onSave, t }: {
  open: boolean
  values: SchemeDraft
  onClose: () => void
  onSave: (draft: SchemeDraft) => void
  t: (key: ThemeKey) => string
}) {
  const [draft, setDraft] = useState<SchemeDraft>(values)
  const latestValues = useRef(values)
  latestValues.current = values

  // A theme publish may rerender the parent while the dialog is open. Only a
  // new open replaces unsaved edits with the latest stored values.
  useEffect(() => {
    if (open) setDraft(latestValues.current)
  }, [open])

  const markCustom = { preset: 'custom' as const }
  const setColor = (index: number, color: string): void => {
    setDraft((current) => {
      const colors = Array.from(
        { length: BACKGROUND_EFFECT_COLOR_SLOTS },
        (_, slot) => current.colors[slot] ?? '',
      )
      colors[index] = color
      return { ...current, ...markCustom, colors }
    })
  }
  const slotLabel = (index: number): string => {
    if (index === 0) return t('effect.colorStart')
    if (index === 1) return t('effect.colorEnd')
    return `${t('effect.colorBloom')} ${index - 1}`
  }

  const custom = draft.preset === 'custom' || effectPreset(draft.preset) === undefined
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('effect.title')}
      description={t('effect.dialogDesc')}
      closeLabel={t('effect.close')}
      footer={(
        <div className={css.effectFooter}>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDraft({
                preset: DEFAULT_THEME_SETTINGS.backgroundEffectPreset,
                colors: [...DEFAULT_THEME_SETTINGS.backgroundEffectColors],
                speed: DEFAULT_THEME_SETTINGS.backgroundEffectSpeed,
                count: DEFAULT_THEME_SETTINGS.backgroundEffectCount,
                variant: DEFAULT_THEME_SETTINGS.backgroundEffectVariant,
              })
            }}
          >
            {t('reset')}
          </Button>
          <span className={css.effectFooterSpacer} />
          <Button type="button" variant="outline" onClick={onClose}>{t('effect.cancel')}</Button>
          <Button type="button" variant="primary" onClick={() => { onSave(draft) }}>{t('effect.save')}</Button>
        </div>
      )}
    >
      <div className={css.effectDialog}>
        <div
          id="dsh-gradient-preview"
          className={css.effectPreview}
          data-variant={draft.variant}
          style={{
            ...overrideVars(draft.colors),
            '--dsh-gradient-speed': `${draft.speed / 100}`,
          } as CSSProperties}
          role="img"
          aria-label={t('effect.gradient')}
        >
          <div id="dsh-gradient-preview-blobs">
            {Array.from({ length: MAX_BACKGROUND_EFFECT_COUNT }, (_, index) => (
              <i key={index} data-blob={index + 1} hidden={index >= draft.count} />
            ))}
          </div>
        </div>
        <div className={css.schemeGrid} role="radiogroup" aria-label={t('effect.scheme')}>
          {EFFECT_PRESETS.map(preset => (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={draft.preset === preset.id}
              className={css.schemeCard}
              data-active={draft.preset === preset.id || undefined}
              onClick={() => {
                setDraft(current => ({ ...current, preset: preset.id, colors: [...preset.colors] }))
              }}
            >
              <span className={css.schemeSwatch} style={schemeSwatchStyle(preset.colors)} />
              <span className={css.schemeName}>{t(`effect.preset.${preset.id}`)}</span>
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={custom}
            className={css.schemeCard}
            data-active={custom || undefined}
            onClick={() => { setDraft(current => ({ ...current, preset: 'custom' })) }}
          >
            <span className={css.schemeSwatch} style={schemeSwatchStyle(draft.colors)} />
            <span className={css.schemeName}>{t('effect.preset.custom')}</span>
          </button>
        </div>
        <div className={css.effectCustom}>
          <div className={css.effectSwatches} role="group" aria-label={t('effect.colors')}>
            {SLOT_TOKENS.map((token, index) => (
              <input
                key={token}
                type="color"
                className={css.effectSwatch}
                value={draft.colors[index] || resolvedTokenColor(token)}
                title={slotLabel(index)}
                aria-label={slotLabel(index)}
                onChange={(event) => { setColor(index, event.currentTarget.value) }}
              />
            ))}
          </div>
          <label className={css.field}>
            <span className={css.rowHead}>
              <span>{t('effect.speed')}</span>
              <span className={css.value}>{draft.speed}%</span>
            </span>
            <input
              type="range"
              className={css.slider}
              min={MIN_BACKGROUND_EFFECT_SPEED}
              max={MAX_BACKGROUND_EFFECT_SPEED}
              step={10}
              value={draft.speed}
              style={sliderFillStyle(draft.speed, MIN_BACKGROUND_EFFECT_SPEED, MAX_BACKGROUND_EFFECT_SPEED)}
              aria-valuemin={MIN_BACKGROUND_EFFECT_SPEED}
              aria-valuemax={MAX_BACKGROUND_EFFECT_SPEED}
              aria-valuenow={draft.speed}
              aria-label={t('effect.speed')}
              onChange={(event) => {
                const speed = Number(event.currentTarget.value)
                setDraft(current => ({ ...current, ...markCustom, speed }))
              }}
            />
          </label>
          <label className={css.field}>
            <span className={css.rowHead}>
              <span>{t('effect.count')}</span>
              <span className={css.value}>{draft.count}</span>
            </span>
            <input
              type="range"
              className={css.slider}
              min={MIN_BACKGROUND_EFFECT_COUNT}
              max={MAX_BACKGROUND_EFFECT_COUNT}
              step={1}
              value={draft.count}
              style={sliderFillStyle(draft.count, MIN_BACKGROUND_EFFECT_COUNT, MAX_BACKGROUND_EFFECT_COUNT)}
              aria-valuemin={MIN_BACKGROUND_EFFECT_COUNT}
              aria-valuemax={MAX_BACKGROUND_EFFECT_COUNT}
              aria-valuenow={draft.count}
              aria-label={t('effect.count')}
              onChange={(event) => {
                const count = Number(event.currentTarget.value)
                setDraft(current => ({ ...current, ...markCustom, count }))
              }}
            />
          </label>
          <label className={css.field}>
            {t('effect.variant')}
            <SettingsSelect
              variant="block"
              aria-label={t('effect.variant')}
              value={draft.variant}
              options={BACKGROUND_EFFECT_VARIANTS.map(variant => ({
                id: variant,
                label: t(`effect.variant.${variant}`),
              }))}
              onChange={(id) => {
                const variant = id as ThemeSettings['backgroundEffectVariant']
                setDraft(current => ({ ...current, ...markCustom, variant }))
              }}
            />
          </label>
        </div>
      </div>
    </Modal>
  )
}

/**
 * Render the background-effect row: title/description, a settings-gear that
 * opens the scheme dialog, and the enable Switch.
 * @param props - stored effect values, whether a wallpaper currently covers
 *   the effect, copy, and the backdrop write callback.
 * @returns the background-effect block.
 */
export function BackgroundEffectRow({
  backgroundEffect,
  backgroundEffectColors,
  backgroundEffectSpeed,
  backgroundEffectCount,
  backgroundEffectPreset,
  backgroundEffectVariant,
  wallpaperSet,
  t,
  setWallpaper,
}: {
  backgroundEffect: ThemeSettings['backgroundEffect']
  backgroundEffectColors: readonly string[]
  backgroundEffectSpeed: number
  backgroundEffectCount: number
  backgroundEffectPreset: ThemeSettings['backgroundEffectPreset']
  backgroundEffectVariant: ThemeSettings['backgroundEffectVariant']
  wallpaperSet: boolean
  t: (key: ThemeKey) => string
  setWallpaper: SetWallpaper
}) {
  const gradient = backgroundEffect === 'gradient'
  const [open, setOpen] = useState(false)
  const values: SchemeDraft = {
    preset: backgroundEffectPreset,
    colors: sanitizeBackgroundEffectColors(backgroundEffectColors),
    speed: backgroundEffectSpeed,
    count: backgroundEffectCount,
    variant: backgroundEffectVariant,
  }
  return (
    <section className={css.block} aria-labelledby="appearance-effect-heading">
      <div className={css.effectRow}>
        <div className={css.effectText}>
          <h2 id="appearance-effect-heading" className={css.rowTitle}>{t('effect.title')}</h2>
          <p className={css.hint}>{t('effect.description')}</p>
          {wallpaperSet && gradient ? (
            <p className={css.hint}>{t('effect.pausedByWallpaper')}</p>
          ) : null}
          {lowPowerGpu() ? <p className={css.hint}>{t('effect.lowPowerGpu')}</p> : null}
        </div>
        <div className={css.effectActions}>
          <Tooltip label={t('effect.configure')} side="top" delayMs={500}>
            <button
              type="button"
              className={css.settingsButton}
              aria-label={t('effect.configure')}
              onClick={() => { setOpen(true) }}
            >
              <IconSettingsOutline16 size={16} />
            </button>
          </Tooltip>
          <Switch
            checked={gradient}
            aria-label={t('effect.gradient')}
            onChange={(event) => {
              setWallpaper({ backgroundEffect: event.currentTarget.checked ? 'gradient' : 'none' })
            }}
          />
        </div>
      </div>
      <BackgroundEffectModal
        open={open}
        values={values}
        onClose={() => { setOpen(false) }}
        onSave={(draft) => {
          setWallpaper({
            backgroundEffectPreset: draft.preset,
            backgroundEffectColors: [...draft.colors],
            backgroundEffectSpeed: draft.speed,
            backgroundEffectCount: draft.count,
            backgroundEffectVariant: draft.variant,
          })
          setOpen(false)
        }}
        t={t}
      />
    </section>
  )
}
