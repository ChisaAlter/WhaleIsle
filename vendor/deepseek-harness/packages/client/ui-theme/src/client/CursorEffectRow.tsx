import { useMinimalMode } from '@deepseek-ai/dsh-client-ui-primitives'
/**
 * Appearance pointer-effect row (指针特效): the switch plus a settings-gear
 * entry that opens the scheme dialog — one of two decorations (fading pixel
 * trail or WebGL fluid splash), preset schemes or a custom scheme, with a
 * live canvas preview. The switch only flips `cursorEffectEnabled`, so the
 * stored effect, palette, and sliders survive while the layer is off.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  Button, IconSettingsOutline16, Modal, Switch, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  CURSOR_EFFECTS, CURSOR_EFFECT_COLOR_SLOTS, DEFAULT_CURSOR_EFFECT,
  DEFAULT_CURSOR_EFFECT_SIZE, DEFAULT_CURSOR_EFFECT_SPEED,
  MAX_CURSOR_EFFECT_SIZE, MAX_CURSOR_EFFECT_SPEED,
  MIN_CURSOR_EFFECT_SIZE, MIN_CURSOR_EFFECT_SPEED,
  mountCursorFx, resolveCursorFxPalette, sanitizeCursorEffectColors,
  type CursorEffect, type CursorFxHandle,
} from '../cursor-fx.ts'
import type { ThemeSettings } from '../theme-settings.ts'
import type { ThemeKey } from './locales.ts'
import { CURSOR_FX_PRESETS, cursorFxPreset, type CursorFxScheme } from './cursor-fx-presets.ts'
import { sliderFillStyle } from './slider.ts'
import css from './AppearanceSection.module.css'

/** Persist the pointer decoration: enabled flag, chosen effect, and tunables. */
export type SetCursorFx = (
  patch: Partial<Pick<ThemeSettings,
    'cursorEffectEnabled' | 'cursorEffect' | 'cursorEffectColors'
    | 'cursorEffectSpeed' | 'cursorEffectSize' | 'cursorEffectPreset'
  >>,
) => void

/** Draft edited inside the dialog: effect, scheme id, and its tunables. */
interface CursorDraft extends CursorFxScheme {
  effect: CursorEffect
  preset: ThemeSettings['cursorEffectPreset']
}

/** Resolve the theme accent to `#rrggbb` for the color input fallback. */
function resolvedAccent(): string {
  let value = getComputedStyle(document.body).getPropertyValue('--dsw-alias-brand-primary').trim()
  for (let hop = 0; hop < 4; hop += 1) {
    const inner = /^var\((--[\w-]+)\)$/.exec(value)?.[1]
    if (inner === undefined) break
    value = getComputedStyle(document.body).getPropertyValue(inner).trim()
  }
  return /^#[0-9a-f]{6}$/i.test(value) ? value : '#808080'
}

/** Mini swatch for a scheme card: hard-stop stripes of the palette. */
function schemeSwatchStyle(colors: readonly string[]): CSSProperties {
  const palette = colors.filter(color => color !== '')
  if (palette.length === 0) return { background: 'var(--dsw-alias-brand-primary)' }
  const step = 100 / palette.length
  const stops = palette
    .map((color, index) => `${color} ${(index * step).toFixed(1)}% ${((index + 1) * step).toFixed(1)}%`)
    .join(', ')
  return { background: `linear-gradient(90deg, ${stops})` }
}

/** Mini swatch hinting at each decoration's look under the draft palette. */
function kindSwatchStyle(effect: CursorEffect, colors: readonly string[]): CSSProperties {
  const palette = resolveCursorFxPalette(colors)
  const a = palette[0]
  const b = palette[1] ?? palette[0]
  if (effect === 'trail') {
    return {
      background: `repeating-conic-gradient(${a} 0% 25%, ${b} 0% 50%) 0 0 / 14px 14px`,
    }
  }
  return {
    background: [
      `radial-gradient(circle at 30% 62%, ${a} 0%, transparent 55%)`,
      `radial-gradient(circle at 68% 34%, ${b} 0%, transparent 55%)`,
      'var(--dsw-alias-bg-layer-2)',
    ].join(', '),
  }
}

/**
 * Scheme dialog: kind cards pick the decoration, preset cards write the
 * whole tunable bundle, and editing any value marks the scheme custom. The
 * preview canvas runs the real engines; save writes one settings patch.
 * @param props - open state, stored values, dialog callbacks, copy.
 * @returns the settings modal.
 */
function CursorEffectModal({ open, values, onClose, onSave, t }: {
  open: boolean
  values: CursorDraft
  onClose: () => void
  onSave: (draft: CursorDraft) => void
  t: (key: ThemeKey) => string
}) {
  // The row keys this modal by open count, so `useState` re-initializes the
  // draft from the stored values on every open — no reset effect, and a
  // theme publish while the dialog is open can never clobber the draft.
  const [draft, setDraft] = useState<CursorDraft>(values)
  const minimal = useMinimalMode()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<CursorFxHandle | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    /* v8 ignore next -- the canvas ref attaches before the open effect can run */
    if (!open || minimal || canvas === null) return
    const handle = mountCursorFx(canvas, draft.effect, {
      colors: resolveCursorFxPalette(draft.colors),
      speed: draft.speed,
      size: draft.size,
    })
    engineRef.current = handle
    return () => {
      handle.dispose()
      /* v8 ignore next -- the ref holds this handle or nothing while mounted */
      if (engineRef.current === handle) engineRef.current = null
    }
    // Remount only on effect changes; tunables ride the update channel below.
  }, [open, draft.effect, minimal])

  useEffect(() => {
    /* v8 ignore next -- the mount effect above seeds the ref before this runs */
    engineRef.current?.update({
      colors: resolveCursorFxPalette(draft.colors),
      speed: draft.speed,
      size: draft.size,
    })
  }, [draft.colors, draft.speed, draft.size])

  const markCustom = { preset: 'custom' as const }
  const setColor = (index: number, color: string): void => {
    setDraft((current) => {
      const colors = Array.from(
        { length: CURSOR_EFFECT_COLOR_SLOTS },
        (_, slot) => current.colors[slot] ?? '',
      )
      colors[index] = color
      return { ...current, ...markCustom, colors }
    })
  }

  const custom = draft.preset === 'custom' || cursorFxPreset(draft.preset) === undefined
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('cursorFx.title')}
      description={t('cursorFx.dialogDesc')}
      closeLabel={t('effect.close')}
      footer={(
        <div className={css.effectFooter}>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDraft({
                effect: DEFAULT_CURSOR_EFFECT,
                preset: 'default',
                colors: [],
                speed: DEFAULT_CURSOR_EFFECT_SPEED,
                size: DEFAULT_CURSOR_EFFECT_SIZE,
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
        <div className={css.cursorKindGrid} role="radiogroup" aria-label={t('cursorFx.kind')}>
          {CURSOR_EFFECTS.map(effect => (
            <button
              key={effect}
              type="button"
              role="radio"
              aria-checked={draft.effect === effect}
              className={css.schemeCard}
              data-active={draft.effect === effect || undefined}
              onClick={() => { setDraft(current => ({ ...current, effect })) }}
            >
              <span className={css.schemeSwatch} style={kindSwatchStyle(effect, draft.colors)} />
              <span className={css.schemeName}>{t(`cursorFx.kind.${effect}`)}</span>
            </button>
          ))}
        </div>
        <div
          className={css.cursorPreview}
          onPointerMove={(event) => {
            /* v8 ignore next -- strokes can only fire while the engine is mounted */
            engineRef.current?.pointerMove(event.clientX, event.clientY)
          }}
          onPointerDown={(event) => {
            /* v8 ignore next -- strokes can only fire while the engine is mounted */
            engineRef.current?.pointerDown(event.clientX, event.clientY)
          }}
        >
          {/* Fresh canvas per effect: a canvas bound to '2d' can never hand
              out a WebGL context (and vice versa), so reusing one element
              across kind switches leaves the second engine dead. */}
          <canvas key={draft.effect} ref={canvasRef} className={css.cursorCanvas} />
          <span className={css.cursorPreviewHint}>{t('cursorFx.previewHint')}</span>
        </div>
        <div className={css.schemeGrid} role="radiogroup" aria-label={t('effect.scheme')}>
          {CURSOR_FX_PRESETS.map(preset => (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={draft.preset === preset.id}
              className={css.schemeCard}
              data-active={draft.preset === preset.id || undefined}
              onClick={() => {
                setDraft(current => ({
                  ...current,
                  preset: preset.id,
                  colors: [...preset.colors],
                  speed: preset.speed,
                  size: preset.size,
                }))
              }}
            >
              <span className={css.schemeSwatch} style={schemeSwatchStyle(preset.colors)} />
              <span className={css.schemeName}>{t(`cursorFx.preset.${preset.id}`)}</span>
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
            <span className={css.schemeName}>{t('cursorFx.preset.custom')}</span>
          </button>
        </div>
        <div className={css.effectCustom}>
          <div className={css.effectSwatches} role="group" aria-label={t('effect.colors')}>
            {Array.from({ length: CURSOR_EFFECT_COLOR_SLOTS }, (_, index) => (
              <input
                key={index}
                type="color"
                className={css.effectSwatch}
                value={draft.colors[index] || resolvedAccent()}
                title={`${t('cursorFx.color')} ${index + 1}`}
                aria-label={`${t('cursorFx.color')} ${index + 1}`}
                onChange={(event) => { setColor(index, event.currentTarget.value) }}
              />
            ))}
          </div>
          <label className={css.field}>
            <span className={css.rowHead}>
              <span>{t('cursorFx.speed')}</span>
              <span className={css.value}>{draft.speed}%</span>
            </span>
            <input
              type="range"
              className={css.slider}
              min={MIN_CURSOR_EFFECT_SPEED}
              max={MAX_CURSOR_EFFECT_SPEED}
              step={10}
              value={draft.speed}
              style={sliderFillStyle(draft.speed, MIN_CURSOR_EFFECT_SPEED, MAX_CURSOR_EFFECT_SPEED)}
              aria-valuemin={MIN_CURSOR_EFFECT_SPEED}
              aria-valuemax={MAX_CURSOR_EFFECT_SPEED}
              aria-valuenow={draft.speed}
              aria-label={t('cursorFx.speed')}
              onChange={(event) => {
                const speed = Number(event.currentTarget.value)
                setDraft(current => ({ ...current, ...markCustom, speed }))
              }}
            />
          </label>
          <label className={css.field}>
            <span className={css.rowHead}>
              <span>{t('cursorFx.size')}</span>
              <span className={css.value}>{draft.size}%</span>
            </span>
            <input
              type="range"
              className={css.slider}
              min={MIN_CURSOR_EFFECT_SIZE}
              max={MAX_CURSOR_EFFECT_SIZE}
              step={5}
              value={draft.size}
              style={sliderFillStyle(draft.size, MIN_CURSOR_EFFECT_SIZE, MAX_CURSOR_EFFECT_SIZE)}
              aria-valuemin={MIN_CURSOR_EFFECT_SIZE}
              aria-valuemax={MAX_CURSOR_EFFECT_SIZE}
              aria-valuenow={draft.size}
              aria-label={t('cursorFx.size')}
              onChange={(event) => {
                const size = Number(event.currentTarget.value)
                setDraft(current => ({ ...current, ...markCustom, size }))
              }}
            />
          </label>
        </div>
      </div>
    </Modal>
  )
}

/**
 * Render the pointer-effect row: title/description, a settings-gear that
 * opens the scheme dialog, and the enable Switch.
 * @param props - stored effect values, copy, and the write callback.
 * @returns the pointer-effect block.
 */
export function CursorEffectRow({
  cursorEffectEnabled,
  cursorEffect,
  cursorEffectColors,
  cursorEffectSpeed,
  cursorEffectSize,
  cursorEffectPreset,
  t,
  setCursorFx,
}: {
  cursorEffectEnabled: boolean
  cursorEffect: ThemeSettings['cursorEffect']
  cursorEffectColors: readonly string[]
  cursorEffectSpeed: number
  cursorEffectSize: number
  cursorEffectPreset: ThemeSettings['cursorEffectPreset']
  t: (key: ThemeKey) => string
  setCursorFx: SetCursorFx
}) {
  const [open, setOpen] = useState(false)
  // Remount the dialog on every open so its draft re-initializes from the
  // stored values (see CursorEffectModal).
  const [openCount, setOpenCount] = useState(0)
  const values: CursorDraft = {
    effect: cursorEffect,
    preset: cursorEffectPreset,
    colors: sanitizeCursorEffectColors([...cursorEffectColors]),
    speed: cursorEffectSpeed,
    size: cursorEffectSize,
  }
  return (
    <section className={css.block} aria-labelledby="appearance-cursor-fx-heading">
      <div className={css.effectRow}>
        <div className={css.effectText}>
          <h2 id="appearance-cursor-fx-heading" className={css.rowTitle}>{t('cursorFx.title')}</h2>
          <p className={css.hint}>{t('cursorFx.description')}</p>
        </div>
        <div className={css.effectActions}>
          <Tooltip label={t('effect.configure')} side="top" delayMs={500}>
            <button
              type="button"
              className={css.settingsButton}
              aria-label={t('effect.configure')}
              onClick={() => {
                setOpenCount(count => count + 1)
                setOpen(true)
              }}
            >
              <IconSettingsOutline16 size={16} />
            </button>
          </Tooltip>
          <Switch
            checked={cursorEffectEnabled}
            aria-label={t('cursorFx.title')}
            onChange={(event) => {
              setCursorFx({ cursorEffectEnabled: event.currentTarget.checked })
            }}
          />
        </div>
      </div>
      <CursorEffectModal
        key={openCount}
        open={open}
        values={values}
        onClose={() => { setOpen(false) }}
        onSave={(draft) => {
          setCursorFx({
            // Saving the scheme is an explicit "apply": turn the layer on so
            // the previewed effect actually shows on the page.
            cursorEffectEnabled: true,
            cursorEffect: draft.effect,
            cursorEffectPreset: draft.preset,
            cursorEffectColors: [...draft.colors],
            cursorEffectSpeed: draft.speed,
            cursorEffectSize: draft.size,
          })
          setOpen(false)
        }}
        t={t}
      />
    </section>
  )
}
