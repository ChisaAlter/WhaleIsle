/** Settings modal for the running composer beam's bounded visual tuning. */
import { useEffect, useState, type ChangeEvent } from 'react'
import {
  Button, IconCloseOutline16, Input, Modal, SettingsSelect, Toast, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import {
  COMPOSER_BEAM_DIRECTIONS,
  COMPOSER_BEAM_EASINGS,
  COMPOSER_BEAM_MODES,
  COMPOSER_BEAM_PALETTE_COLORS,
  COMPOSER_BEAM_PALETTES,
  DEFAULT_COMPOSER_BEAM_STYLE,
  MAX_COMPOSER_BEAM_BLOOM, MAX_COMPOSER_BEAM_BREATHING_AMPLITUDE,
  MAX_COMPOSER_BEAM_BREATHING_PERIOD, MAX_COMPOSER_BEAM_CUSTOM_COLORS,
  MAX_COMPOSER_BEAM_GLOW_BLUR, MAX_COMPOSER_BEAM_HUE, MAX_COMPOSER_BEAM_HUE_CYCLE_PERIOD,
  MAX_COMPOSER_BEAM_HUE_CYCLE_RANGE, MAX_COMPOSER_BEAM_INTENSITY, MAX_COMPOSER_BEAM_JSON_BYTES,
  MAX_COMPOSER_BEAM_NIGHT_DIM, MAX_COMPOSER_BEAM_PERIOD, MAX_COMPOSER_BEAM_PRESETS,
  MAX_COMPOSER_BEAM_PRESET_NAME_LENGTH,
  MAX_COMPOSER_BEAM_TRACK_WIDTH, MIN_COMPOSER_BEAM_BLOOM, MIN_COMPOSER_BEAM_BREATHING_AMPLITUDE,
  MIN_COMPOSER_BEAM_BREATHING_PERIOD, MIN_COMPOSER_BEAM_CUSTOM_COLORS, MIN_COMPOSER_BEAM_GLOW_BLUR,
  MIN_COMPOSER_BEAM_HUE, MIN_COMPOSER_BEAM_HUE_CYCLE_PERIOD, MIN_COMPOSER_BEAM_HUE_CYCLE_RANGE,
  MIN_COMPOSER_BEAM_INTENSITY, MIN_COMPOSER_BEAM_PERIOD, MIN_COMPOSER_BEAM_TRACK_WIDTH,
  normalizeComposerBeamPresets, normalizeComposerBeamStyle,
  type ComposerBeamEasing, type ComposerBeamMode,
  type ComposerBeamPresets, type ComposerBeamStyle,
} from '../../submission-settings.ts'
import { ComposerBeam } from '../ComposerBeam.tsx'
import type { ConversationKey } from '../locales.ts'
import css from './BeamSettingsModal.module.css'

/** Clipboard envelope identifier for beam configuration exchange. */
export const COMPOSER_BEAM_EXPORT_CORE = 'dsh-composer-beam'

/** Clipboard envelope version. */
export const COMPOSER_BEAM_EXPORT_VERSION = 1 as const

/** Stable JSON shape for active style and user presets. */
export interface ComposerBeamExportPayload {
  core: typeof COMPOSER_BEAM_EXPORT_CORE
  version: typeof COMPOSER_BEAM_EXPORT_VERSION
  style: ComposerBeamStyle
  presets: ComposerBeamPresets
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isHexColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)

function assertImportedStyle(value: unknown): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error('composer-beam style is not an object')
  if (value.direction !== undefined && !COMPOSER_BEAM_DIRECTIONS.includes(value.direction as never)) {
    throw new Error('composer-beam direction is invalid')
  }
  if (value.mode !== undefined && !COMPOSER_BEAM_MODES.includes(value.mode as never)) {
    throw new Error('composer-beam mode is invalid')
  }
  if (value.easing !== undefined && !COMPOSER_BEAM_EASINGS.includes(value.easing as never)) {
    throw new Error('composer-beam easing is invalid')
  }
  for (const field of ['period', 'intensity', 'bloom', 'hue', 'trackWidth', 'glowBlur']) {
    if (value[field] !== undefined && !isFiniteNumber(value[field])) throw new Error(`composer-beam ${field} is invalid`)
  }
  if (value.palette !== undefined) {
    if (!isRecord(value.palette)) throw new Error('composer-beam palette is invalid')
    if (value.palette.kind === 'preset') {
      if (!COMPOSER_BEAM_PALETTES.includes(value.palette.id as never)) throw new Error('composer-beam palette is invalid')
    } else if (value.palette.kind === 'custom') {
      if (!Array.isArray(value.palette.colors)
        || value.palette.colors.length < MIN_COMPOSER_BEAM_CUSTOM_COLORS
        || value.palette.colors.length > MAX_COMPOSER_BEAM_CUSTOM_COLORS
        || !value.palette.colors.every(isHexColor)) {
        throw new Error('composer-beam colors are invalid')
      }
    } else {
      throw new Error('composer-beam palette is invalid')
    }
  }
  const nestedFields = {
    breathing: ['enabled', 'amplitude', 'period'],
    hueCycle: ['enabled', 'range', 'period'],
    night: ['enabled', 'fromMinute', 'toMinute', 'dim'],
  } as const
  for (const [name, fields] of Object.entries(nestedFields)) {
    const nested = value[name]
    if (nested === undefined) continue
    if (!isRecord(nested)) throw new Error(`composer-beam ${name} is invalid`)
    for (const field of fields) {
      const nestedValue = nested[field]
      if (nestedValue === undefined) continue
      if (field === 'enabled') {
        if (typeof nestedValue !== 'boolean') throw new Error(`composer-beam ${name} is invalid`)
      } else if (!isFiniteNumber(nestedValue)) {
        throw new Error(`composer-beam ${name} is invalid`)
      }
    }
  }
}

function assertImportedPresets(value: unknown): asserts value is Record<string, unknown> | undefined {
  if (value === undefined) return
  if (!isRecord(value) || Object.keys(value).length > MAX_COMPOSER_BEAM_PRESETS) {
    throw new Error('composer-beam presets are invalid')
  }
  for (const [name, style] of Object.entries(value)) {
    if (name.trim() !== name || name.length === 0 || name.length > MAX_COMPOSER_BEAM_PRESET_NAME_LENGTH
      || name === '__proto__' || name === 'constructor' || name === 'prototype') {
      throw new Error('composer-beam preset name is invalid')
    }
    assertImportedStyle(style)
  }
}

/** Serialize only the beam settings owned by this panel. */
export function serializeComposerBeamConfiguration(
  style: ComposerBeamStyle,
  presets: ComposerBeamPresets,
): string {
  const payload: ComposerBeamExportPayload = {
    core: COMPOSER_BEAM_EXPORT_CORE,
    version: COMPOSER_BEAM_EXPORT_VERSION,
    style: normalizeComposerBeamStyle(style),
    presets: normalizeComposerBeamPresets(presets),
  }
  return JSON.stringify(payload, null, 2)
}

/** Parse and normalize a clipboard envelope without accepting unknown cores or versions. */
export function parseComposerBeamConfiguration(text: string): ComposerBeamExportPayload {
  if (new TextEncoder().encode(text).byteLength > MAX_COMPOSER_BEAM_JSON_BYTES) {
    throw new Error('composer-beam JSON exceeds the size limit')
  }
  let raw: unknown
  try {
    raw = JSON.parse(text) as unknown
  } catch {
    throw new Error('composer-beam JSON is invalid')
  }
  if (!isRecord(raw) || raw.core !== COMPOSER_BEAM_EXPORT_CORE || raw.version !== COMPOSER_BEAM_EXPORT_VERSION) {
    throw new Error('composer-beam JSON core or version is unsupported')
  }
  assertImportedStyle(raw.style)
  assertImportedPresets(raw.presets)
  return {
    core: COMPOSER_BEAM_EXPORT_CORE,
    version: COMPOSER_BEAM_EXPORT_VERSION,
    style: normalizeComposerBeamStyle(raw.style),
    presets: normalizeComposerBeamPresets(raw.presets),
  }
}

const modeStyle = (style: ComposerBeamStyle, mode: ComposerBeamMode): ComposerBeamStyle => {
  const base = normalizeComposerBeamStyle(style)
  switch (mode) {
    case 'legacy':
      return normalizeComposerBeamStyle({ ...DEFAULT_COMPOSER_BEAM_STYLE, mode: 'legacy' })
    case 'lounge':
      return {
        ...base,
        mode,
        palette: { kind: 'preset', id: 'legacy' },
        period: 10,
        intensity: 70,
        bloom: 70,
        breathing: { ...base.breathing, enabled: false },
        hueCycle: { ...base.hueCycle, enabled: false },
        easing: 'ease-in-out',
      }
    case 'aurora':
      return {
        ...base,
        mode,
        palette: { kind: 'preset', id: 'aurora' },
        period: 10,
        hueCycle: { enabled: true, range: 90, period: 16 },
        breathing: { ...base.breathing, enabled: true, amplitude: 0.18, period: 8 },
        easing: 'cubic-bezier',
      }
    case 'reactive':
      return {
        ...base,
        mode,
        palette: { kind: 'preset', id: 'cyber' },
        period: 22,
        hueCycle: { ...base.hueCycle, enabled: false },
        breathing: { enabled: true, amplitude: 0.3, period: 6 },
        easing: 'ease-in-out',
      }
    case 'custom':
      return { ...base, mode }
  }
}

const minuteToTime = (minute: number): string => {
  const hours = Math.floor(minute / 60).toString().padStart(2, '0')
  const minutes = Math.round(minute % 60).toString().padStart(2, '0')
  return `${hours}:${minutes}`
}

const timeToMinute = (value: string): number => {
  const parts = value.split(':')
  const hours = Number(parts[0] ?? '')
  const minutes = Number(parts[1] ?? '')
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0
  return Math.min(1439, Math.max(0, hours * 60 + minutes))
}

const paletteColors = (style: ComposerBeamStyle): readonly string[] =>
  style.palette.kind === 'custom'
    ? style.palette.colors
    : COMPOSER_BEAM_PALETTE_COLORS[style.palette.id]

type NumericField =
  | 'period' | 'intensity' | 'bloom' | 'hue' | 'trackWidth' | 'glowBlur'

interface SliderProps {
  label: string
  value: number
  valueText: string
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}

function Slider({ label, value, valueText, min, max, step, onChange }: SliderProps) {
  return (
    <label className={css.controlRow}>
      <span className={css.controlLabel}>{label}</span>
      <input
        className={css.slider}
        type="range"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event: ChangeEvent<HTMLInputElement>) => { onChange(Number(event.target.value)) }}
      />
      <span className={css.value}>{valueText}</span>
    </label>
  )
}

/** Draft-on-open modal: Save publishes once, while Cancel drops every edit. */
export function BeamSettingsModal({ open, value, presets, onClose, onSave, t }: {
  open: boolean
  value: ComposerBeamStyle
  presets: ComposerBeamPresets
  onClose: () => void
  onSave: (value: ComposerBeamStyle, presets: ComposerBeamPresets) => Promise<void> | void
  t: Translate<ConversationKey>
}) {
  const [draft, setDraft] = useState<ComposerBeamStyle>(() => normalizeComposerBeamStyle(value))
  const [draftPresets, setDraftPresets] = useState<ComposerBeamPresets>(() => normalizeComposerBeamPresets(presets))
  const [selectedPreset, setSelectedPreset] = useState('')
  const [presetName, setPresetName] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)
  const [exchangePending, setExchangePending] = useState<'export' | 'import'>()

  useEffect(() => {
    if (!open) return
    setDraft(normalizeComposerBeamStyle(value))
    setDraftPresets(normalizeComposerBeamPresets(presets))
    setSelectedPreset('')
    setPresetName('')
    setError(undefined)
  }, [open, presets, value])

  const setNumber = (field: NumericField) => (next: number): void => {
    setDraft(current => ({ ...current, [field]: next, mode: 'custom' }))
  }

  const currentColors = paletteColors(draft).slice(0, MAX_COMPOSER_BEAM_CUSTOM_COLORS)
  const setPaletteColor = (index: number, color: string): void => {
    const colors = [...currentColors]
    while (colors.length < MIN_COMPOSER_BEAM_CUSTOM_COLORS) colors.push('#ffffff')
    if (index >= colors.length) return
    colors[index] = color
    setDraft(current => ({ ...current, mode: 'custom', palette: { kind: 'custom', colors } }))
  }

  const addColor = (): void => {
    if (currentColors.length >= MAX_COMPOSER_BEAM_CUSTOM_COLORS) return
    setDraft(current => ({
      ...current,
      mode: 'custom',
      palette: { kind: 'custom', colors: [...currentColors, '#ffffff'] },
    }))
  }

  const removeColor = (index: number): void => {
    if (currentColors.length <= MIN_COMPOSER_BEAM_CUSTOM_COLORS) return
    setDraft(current => ({
      ...current,
      mode: 'custom',
      palette: { kind: 'custom', colors: currentColors.filter((_color, colorIndex) => colorIndex !== index) },
    }))
  }

  const savePreset = (): void => {
    const name = presetName.trim().slice(0, 32)
    if (name === '') {
      setError(t('settings.beam.panel.presetNameRequired'))
      return
    }
    if (draftPresets[name] === undefined && Object.keys(draftPresets).length >= MAX_COMPOSER_BEAM_PRESETS) {
      setError(t('settings.beam.panel.presetLimit'))
      return
    }
    setDraftPresets(current => ({ ...current, [name]: normalizeComposerBeamStyle(draft) }))
    setSelectedPreset(name)
    setPresetName('')
    setError(undefined)
  }

  const deletePreset = (): void => {
    if (selectedPreset === '') return
    setDraftPresets((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([name]) => name !== selectedPreset),
      )
      return next
    })
    setSelectedPreset('')
  }

  const exportJson = async (): Promise<void> => {
    if (exchangePending !== undefined) return
    setExchangePending('export')
    try {
      const accepted = await writeClipboard(serializeComposerBeamConfiguration(draft, draftPresets))
      if (!accepted) setError(t('settings.beam.panel.clipboardWriteFailed'))
      else setError(undefined)
    } finally {
      setExchangePending(undefined)
    }
  }

  const importJson = async (): Promise<void> => {
    if (exchangePending !== undefined) return
    setExchangePending('import')
    try {
      const payload = parseComposerBeamConfiguration(await navigator.clipboard.readText())
      setDraft(payload.style)
      setDraftPresets(payload.presets)
      setSelectedPreset('')
      setError(undefined)
    } catch {
      setError(t('settings.beam.panel.clipboardReadFailed'))
    } finally {
      setExchangePending(undefined)
    }
  }

  const save = async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    setError(undefined)
    try {
      const result = onSave(normalizeComposerBeamStyle(draft), normalizeComposerBeamPresets(draftPresets))
      if (result !== undefined) await result
      onClose()
    } catch {
      setError(t('settings.beam.panel.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('settings.beam.panel.title')}
      description={t('settings.beam.panel.description')}
      closeLabel={t('settings.beam.panel.close')}
      className={css.dialog}
      contentClassName={css.contentScroll}
      footer={(
        <div className={css.footer}>
          <Button variant="outline" disabled={saving} onClick={() => {
            setDraft(normalizeComposerBeamStyle(DEFAULT_COMPOSER_BEAM_STYLE))
            setSelectedPreset('')
            setError(undefined)
          }}>
            {t('settings.beam.panel.reset')}
          </Button>
          <span className={css.footerSpacer} />
          <Button variant="outline" disabled={saving} onClick={onClose}>{t('settings.beam.panel.cancel')}</Button>
          <Button variant="primary" disabled={saving} loading={saving} onClick={() => { void save() }}>
            {t('settings.beam.panel.save')}
          </Button>
        </div>
      )}
    >
      {error !== undefined && <Toast text={error} holdMs={null} dismissLabel={t('settings.beam.panel.close')} onDone={() => { setError(undefined) }} />}
      <div className={css.body}>
        <div className={css.previewStage} aria-label={t('settings.beam.panel.preview')}>
          <div className={css.previewCard}>
            <ComposerBeam active appearance={draft} />
            <span className={css.previewText}>{t('settings.beam.panel.previewStatus')}</span>
          </div>
        </div>

        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('settings.beam.panel.motion')}</h3>
          <div className={css.selectRow}>
            <span className={css.controlLabel}>{t('settings.beam.panel.direction')}</span>
            <SettingsSelect
              className={css.directionSelect}
              variant="block"
              aria-label={t('settings.beam.panel.direction')}
              value={draft.direction}
              options={[
                { id: 'clockwise', label: t('settings.beam.panel.clockwise') },
                { id: 'counterclockwise', label: t('settings.beam.panel.counterclockwise') },
                { id: 'pingPong', label: t('settings.beam.panel.pingPong') },
              ]}
              onChange={(direction) => {
                setDraft(current => ({ ...current, direction: direction as ComposerBeamStyle['direction'], mode: 'custom' }))
              }}
            />
          </div>
          <Slider
            label={t('settings.beam.panel.period')}
            value={draft.period}
            valueText={t('settings.beam.panel.seconds', { value: draft.period.toFixed(2) })}
            min={MIN_COMPOSER_BEAM_PERIOD}
            max={MAX_COMPOSER_BEAM_PERIOD}
            step={0.01}
            onChange={setNumber('period')}
          />
          <div className={css.selectRow}>
            <span className={css.controlLabel}>{t('settings.beam.panel.mode')}</span>
            <SettingsSelect
              className={css.directionSelect}
              variant="block"
              aria-label={t('settings.beam.panel.mode')}
              value={draft.mode}
              options={COMPOSER_BEAM_MODES.map(mode => ({
                id: mode,
                label: t(`settings.beam.panel.mode.${mode}`),
              }))}
              onChange={(mode) => { setDraft(current => modeStyle(current, mode as ComposerBeamMode)) }}
            />
          </div>
          <div className={css.selectRow}>
            <span className={css.controlLabel}>{t('settings.beam.panel.easing')}</span>
            <SettingsSelect
              className={css.directionSelect}
              variant="block"
              aria-label={t('settings.beam.panel.easing')}
              value={draft.easing}
              options={COMPOSER_BEAM_EASINGS.map(easing => ({
                id: easing,
                label: t(`settings.beam.panel.easing.${easing}`),
              }))}
              onChange={(easing) => { setDraft(current => ({ ...current, easing: easing as ComposerBeamEasing, mode: 'custom' })) }}
            />
          </div>
        </section>

        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('settings.beam.panel.appearance')}</h3>
          <Slider
            label={t('settings.beam.panel.intensity')}
            value={draft.intensity}
            valueText={`${draft.intensity}%`}
            min={MIN_COMPOSER_BEAM_INTENSITY}
            max={MAX_COMPOSER_BEAM_INTENSITY}
            step={5}
            onChange={setNumber('intensity')}
          />
          <Slider
            label={t('settings.beam.panel.bloom')}
            value={draft.bloom}
            valueText={`${draft.bloom}%`}
            min={MIN_COMPOSER_BEAM_BLOOM}
            max={MAX_COMPOSER_BEAM_BLOOM}
            step={5}
            onChange={setNumber('bloom')}
          />
          <Slider
            label={t('settings.beam.panel.hue')}
            value={draft.hue}
            valueText={t('settings.beam.panel.degrees', { value: draft.hue })}
            min={MIN_COMPOSER_BEAM_HUE}
            max={MAX_COMPOSER_BEAM_HUE}
            step={5}
            onChange={setNumber('hue')}
          />
          <Slider
            label={t('settings.beam.panel.trackWidth')}
            value={draft.trackWidth}
            valueText={t('settings.beam.panel.pixels', { value: draft.trackWidth.toFixed(1) })}
            min={MIN_COMPOSER_BEAM_TRACK_WIDTH}
            max={MAX_COMPOSER_BEAM_TRACK_WIDTH}
            step={0.1}
            onChange={setNumber('trackWidth')}
          />
          <Slider
            label={t('settings.beam.panel.glowBlur')}
            value={draft.glowBlur}
            valueText={t('settings.beam.panel.pixels', { value: draft.glowBlur.toFixed(1) })}
            min={MIN_COMPOSER_BEAM_GLOW_BLUR}
            max={MAX_COMPOSER_BEAM_GLOW_BLUR}
            step={0.5}
            onChange={setNumber('glowBlur')}
          />
        </section>

        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('settings.beam.panel.palette')}</h3>
          <div className={css.paletteGrid}>
            {COMPOSER_BEAM_PALETTES.map(id => (
              <button
                key={id}
                type="button"
                className={css.paletteChip}
                aria-label={t(`settings.beam.panel.palette.${id}`)}
                aria-pressed={draft.palette.kind === 'preset' && draft.palette.id === id}
                onClick={() => { setDraft(current => ({ ...current, mode: 'custom', palette: { kind: 'preset', id } })) }}
              >
                <span
                  className={css.paletteSwatch}
                  style={{
                    background: `linear-gradient(90deg, ${COMPOSER_BEAM_PALETTE_COLORS[id].join(', ')})`,
                    filter: `hue-rotate(${draft.hue}deg)`,
                  }}
                />
                <span>{t(`settings.beam.panel.palette.${id}`)}</span>
              </button>
            ))}
          </div>
          <div className={css.colorList}>
            {currentColors.map((color, index) => (
              <label className={css.colorRow} key={`${index}-${color}`}>
                <input
                  className={css.colorInput}
                  type="color"
                  value={color}
                  aria-label={t('settings.beam.panel.color', { value: index + 1 })}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => { setPaletteColor(index, event.target.value) }}
                />
                <span className={css.colorValue}>{color.toUpperCase()}</span>
                <button
                  type="button"
                  className={css.iconButton}
                  aria-label={t('settings.beam.panel.removeColor', { value: index + 1 })}
                  disabled={currentColors.length <= MIN_COMPOSER_BEAM_CUSTOM_COLORS}
                  onClick={() => { removeColor(index) }}
                >
                  <IconCloseOutline16 size={14} />
                </button>
              </label>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={currentColors.length >= MAX_COMPOSER_BEAM_CUSTOM_COLORS}
            onClick={addColor}
          >
            {t('settings.beam.panel.addColor')}
          </Button>
        </section>

        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('settings.beam.panel.effects')}</h3>
          <label className={css.checkboxRow}>
            <input
              type="checkbox"
              checked={draft.breathing.enabled}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                setDraft(current => ({ ...current, mode: 'custom', breathing: { ...current.breathing, enabled: event.target.checked } }))
              }}
            />
            <span>{t('settings.beam.panel.breathing')}</span>
          </label>
          <Slider
            label={t('settings.beam.panel.breathingAmplitude')}
            value={draft.breathing.amplitude}
            valueText={`${Math.round(draft.breathing.amplitude * 100)}%`}
            min={MIN_COMPOSER_BEAM_BREATHING_AMPLITUDE}
            max={MAX_COMPOSER_BEAM_BREATHING_AMPLITUDE}
            step={0.05}
            onChange={(value) => { setDraft(current => ({ ...current, mode: 'custom', breathing: { ...current.breathing, amplitude: value } })) }}
          />
          <Slider
            label={t('settings.beam.panel.breathingPeriod')}
            value={draft.breathing.period}
            valueText={t('settings.beam.panel.seconds', { value: draft.breathing.period.toFixed(1) })}
            min={MIN_COMPOSER_BEAM_BREATHING_PERIOD}
            max={MAX_COMPOSER_BEAM_BREATHING_PERIOD}
            step={0.5}
            onChange={(value) => { setDraft(current => ({ ...current, mode: 'custom', breathing: { ...current.breathing, period: value } })) }}
          />
          <label className={css.checkboxRow}>
            <input
              type="checkbox"
              checked={draft.hueCycle.enabled}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                setDraft(current => ({ ...current, mode: 'custom', hueCycle: { ...current.hueCycle, enabled: event.target.checked } }))
              }}
            />
            <span>{t('settings.beam.panel.hueCycle')}</span>
          </label>
          <Slider
            label={t('settings.beam.panel.hueCycleRange')}
            value={draft.hueCycle.range}
            valueText={t('settings.beam.panel.degrees', { value: draft.hueCycle.range })}
            min={MIN_COMPOSER_BEAM_HUE_CYCLE_RANGE}
            max={MAX_COMPOSER_BEAM_HUE_CYCLE_RANGE}
            step={5}
            onChange={(value) => { setDraft(current => ({ ...current, mode: 'custom', hueCycle: { ...current.hueCycle, range: value } })) }}
          />
          <Slider
            label={t('settings.beam.panel.hueCyclePeriod')}
            value={draft.hueCycle.period}
            valueText={t('settings.beam.panel.seconds', { value: draft.hueCycle.period.toFixed(1) })}
            min={MIN_COMPOSER_BEAM_HUE_CYCLE_PERIOD}
            max={MAX_COMPOSER_BEAM_HUE_CYCLE_PERIOD}
            step={0.5}
            onChange={(value) => { setDraft(current => ({ ...current, mode: 'custom', hueCycle: { ...current.hueCycle, period: value } })) }}
          />
        </section>

        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('settings.beam.panel.night')}</h3>
          <label className={css.checkboxRow}>
            <input
              type="checkbox"
              checked={draft.night.enabled}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                setDraft(current => ({ ...current, mode: 'custom', night: { ...current.night, enabled: event.target.checked } }))
              }}
            />
            <span>{t('settings.beam.panel.nightEnabled')}</span>
          </label>
          <div className={css.timeRow}>
            <label className={css.timeField}>
              <span className={css.controlLabel}>{t('settings.beam.panel.nightFrom')}</span>
              <input
                type="time"
                step={60}
                value={minuteToTime(draft.night.fromMinute)}
                aria-label={t('settings.beam.panel.nightFrom')}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  setDraft(current => ({ ...current, mode: 'custom', night: { ...current.night, fromMinute: timeToMinute(event.target.value) } }))
                }}
              />
            </label>
            <label className={css.timeField}>
              <span className={css.controlLabel}>{t('settings.beam.panel.nightTo')}</span>
              <input
                type="time"
                step={60}
                value={minuteToTime(draft.night.toMinute)}
                aria-label={t('settings.beam.panel.nightTo')}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  setDraft(current => ({ ...current, mode: 'custom', night: { ...current.night, toMinute: timeToMinute(event.target.value) } }))
                }}
              />
            </label>
          </div>
          <Slider
            label={t('settings.beam.panel.nightDim')}
            value={draft.night.dim}
            valueText={`${draft.night.dim}%`}
            min={0}
            max={MAX_COMPOSER_BEAM_NIGHT_DIM}
            step={5}
            onChange={(value) => { setDraft(current => ({ ...current, mode: 'custom', night: { ...current.night, dim: value } })) }}
          />
        </section>

        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('settings.beam.panel.presets')}</h3>
          <div className={css.presetRow}>
            <SettingsSelect
              className={css.presetSelect}
              variant="block"
              aria-label={t('settings.beam.panel.presetSelect')}
              value={selectedPreset}
              placeholder={t('settings.beam.panel.presetSelect')}
              options={Object.keys(draftPresets).map(name => ({ id: name, label: name }))}
              onChange={(name) => {
                setSelectedPreset(name)
                const next = draftPresets[name]
                if (next !== undefined) setDraft(normalizeComposerBeamStyle(next))
              }}
            />
            <button
              type="button"
              className={css.iconButton}
              aria-label={t('settings.beam.panel.deletePreset')}
              disabled={selectedPreset === ''}
              onClick={deletePreset}
            >
              <IconCloseOutline16 size={14} />
            </button>
          </div>
          <div className={css.presetSaveRow}>
            <Input
              aria-label={t('settings.beam.panel.presetName')}
              placeholder={t('settings.beam.panel.presetName')}
              value={presetName}
              maxLength={32}
              onChange={(event: ChangeEvent<HTMLInputElement>) => { setPresetName(event.target.value) }}
            />
            <Button variant="outline" size="sm" onClick={savePreset}>{t('settings.beam.panel.savePreset')}</Button>
          </div>
        </section>

        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('settings.beam.panel.exchange')}</h3>
          <div className={css.exchangeRow}>
            <Button variant="outline" size="sm" disabled={exchangePending !== undefined} loading={exchangePending === 'export'} onClick={() => { void exportJson() }}>
              {t('settings.beam.panel.exportJson')}
            </Button>
            <Button variant="outline" size="sm" disabled={exchangePending !== undefined} loading={exchangePending === 'import'} onClick={() => { void importJson() }}>
              {t('settings.beam.panel.importJson')}
            </Button>
          </div>
          <span className={css.hint}>{t('settings.beam.panel.jsonLimit', { value: Math.round(MAX_COMPOSER_BEAM_JSON_BYTES / 1024) })}</span>
        </section>
      </div>
    </Modal>
  )
}
