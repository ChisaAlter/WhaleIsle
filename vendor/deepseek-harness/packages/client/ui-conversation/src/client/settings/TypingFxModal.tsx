/** Settings modal for the composer typing effect's bounded visual tuning. */
import { useEffect, useState, type ChangeEvent, type CSSProperties } from 'react'
import {
  Button, IconCloseOutline16, Input, Modal, SettingsSelect, Toast, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import {
  DEFAULT_TYPING_FX_STYLE,
  MAX_TYPING_FX_JSON_BYTES, MAX_TYPING_FX_PRESETS, MAX_TYPING_FX_PRESET_NAME_LENGTH,
  MAX_TYPING_FX_SPEED, MIN_TYPING_FX_SPEED,
  TYPING_FX_COLOR_SCHEME_COLORS, TYPING_FX_COLOR_SCHEMES,
  TYPING_FX_CURSORS, TYPING_FX_EFFECTS,
  normalizeTypingFxPresets, normalizeTypingFxStyle, resolveTypingFxColors,
  type TypingFxColors, type TypingFxCursor, type TypingFxPresets, type TypingFxStyle,
} from '../../submission-settings.ts'
import type { ConversationKey } from '../locales.ts'
import fxCss from '../TypingFxLayer.module.css'
import css from './BeamSettingsModal.module.css'
import previewCss from './TypingFxModal.module.css'

/** Clipboard envelope identifier for typing-effect configuration exchange. */
export const TYPING_FX_EXPORT_CORE = 'dsh-typing-fx'

/** Clipboard envelope version. */
export const TYPING_FX_EXPORT_VERSION = 1 as const

/** Stable JSON shape for active style and user presets. */
export interface TypingFxExportPayload {
  core: typeof TYPING_FX_EXPORT_CORE
  version: typeof TYPING_FX_EXPORT_VERSION
  style: TypingFxStyle
  presets: TypingFxPresets
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isHexColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)

function assertImportedStyle(value: unknown): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error('typing-fx style is not an object')
  if (value.effect !== undefined && !TYPING_FX_EFFECTS.includes(value.effect as never)) {
    throw new Error('typing-fx effect is invalid')
  }
  if (value.cursor !== undefined && !TYPING_FX_CURSORS.includes(value.cursor as never)) {
    throw new Error('typing-fx cursor is invalid')
  }
  if (value.cursorBlink !== undefined && typeof value.cursorBlink !== 'boolean') {
    throw new Error('typing-fx cursorBlink is invalid')
  }
  if (value.speed !== undefined && !isFiniteNumber(value.speed)) {
    throw new Error('typing-fx speed is invalid')
  }
  if (value.colors !== undefined) {
    const colors = value.colors
    const valid = isRecord(colors) && (
      colors.kind === 'theme'
      || (colors.kind === 'preset' && TYPING_FX_COLOR_SCHEMES.includes(colors.id as never))
      || (colors.kind === 'custom' && isHexColor(colors.echo) && isHexColor(colors.caret) && isHexColor(colors.text))
    )
    if (!valid) throw new Error('typing-fx colors are invalid')
  }
}

function assertImportedPresets(value: unknown): asserts value is Record<string, unknown> | undefined {
  if (value === undefined) return
  if (!isRecord(value) || Object.keys(value).length > MAX_TYPING_FX_PRESETS) {
    throw new Error('typing-fx presets are invalid')
  }
  for (const [name, style] of Object.entries(value)) {
    if (name.trim() !== name || name.length === 0 || name.length > MAX_TYPING_FX_PRESET_NAME_LENGTH
      || name === '__proto__' || name === 'constructor' || name === 'prototype') {
      throw new Error('typing-fx preset name is invalid')
    }
    assertImportedStyle(style)
  }
}

/** Serialize only the typing-effect settings owned by this panel. */
export function serializeTypingFxConfiguration(
  style: TypingFxStyle,
  presets: TypingFxPresets,
): string {
  const payload: TypingFxExportPayload = {
    core: TYPING_FX_EXPORT_CORE,
    version: TYPING_FX_EXPORT_VERSION,
    style: normalizeTypingFxStyle(style),
    presets: normalizeTypingFxPresets(presets),
  }
  return JSON.stringify(payload, null, 2)
}

/** Parse and normalize a clipboard envelope without accepting unknown cores or versions. */
export function parseTypingFxConfiguration(text: string): TypingFxExportPayload {
  if (new TextEncoder().encode(text).byteLength > MAX_TYPING_FX_JSON_BYTES) {
    throw new Error('typing-fx JSON exceeds the size limit')
  }
  let raw: unknown
  try {
    raw = JSON.parse(text) as unknown
  } catch {
    throw new Error('typing-fx JSON is invalid')
  }
  if (!isRecord(raw) || raw.core !== TYPING_FX_EXPORT_CORE || raw.version !== TYPING_FX_EXPORT_VERSION) {
    throw new Error('typing-fx JSON core or version is unsupported')
  }
  assertImportedStyle(raw.style)
  assertImportedPresets(raw.presets)
  return {
    core: TYPING_FX_EXPORT_CORE,
    version: TYPING_FX_EXPORT_VERSION,
    style: normalizeTypingFxStyle(raw.style),
    presets: normalizeTypingFxPresets(raw.presets),
  }
}

/** Neutral seed for the custom triplet when neither a preset nor custom colors are active. */
const CUSTOM_SEED = { echo: '#e2e8f0', caret: '#60a5fa', text: '#64748b' } as const

/** The triplet the custom editor opens with: the active scheme's stops, else the neutral seed. */
function customSeed(colors: TypingFxColors): { echo: string; caret: string; text: string } {
  if (colors.kind === 'preset') return TYPING_FX_COLOR_SCHEME_COLORS[colors.id]
  if (colors.kind === 'custom') return { echo: colors.echo, caret: colors.caret, text: colors.text }
  return CUSTOM_SEED
}

const PREVIEW_TYPE_MS = 150

/**
 * Live preview: types the sample text one character at a time; every mounted
 * character carries its fading ghost on top, mirroring the composer's
 * real-text-plus-echo structure. Reduced motion skips the loop and shows the
 * settled line.
 */
function TypingFxPreview({ draft, text }: { draft: TypingFxStyle; text: string }) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    setCount(0)
    if (typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setCount(text.length)
      return
    }
    const timer = window.setInterval(() => {
      setCount(current => (current >= text.length ? 0 : current + 1))
    }, PREVIEW_TYPE_MS)
    return () => { window.clearInterval(timer) }
  }, [text])
  const shown = text.slice(0, count)
  const colors = resolveTypingFxColors(draft.colors)
  return (
    <div
      className={previewCss.previewLine}
      data-typing-fx-root
      data-effect={draft.effect}
      data-blink={draft.cursorBlink || undefined}
      style={{
        '--dsh-typing-fx-speed': String(draft.speed),
        '--dsh-typing-fx-echo-color': colors.echo ?? undefined,
        '--dsh-typing-fx-caret-color': colors.caret ?? undefined,
        '--dsh-typing-fx-text-color': colors.text ?? undefined,
      } as CSSProperties}
    >
      {shown.split('').map((char, index) => (
        <span key={index} className={previewCss.previewChar}>
          <span className={`${fxCss.echoGlyph} ${previewCss.previewGhost}`} aria-hidden>{char}</span>
          {char}
        </span>
      ))}
      {draft.cursor !== 'native' && (
        <span className={previewCss.previewCaret} data-typing-fx-caret={draft.cursor} aria-hidden />
      )}
    </div>
  )
}

/** Draft-on-open modal: Save publishes once, while Cancel drops every edit. */
export function TypingFxModal({ open, value, presets, onClose, onSave, t }: {
  open: boolean
  value: TypingFxStyle
  presets: TypingFxPresets
  onClose: () => void
  onSave: (value: TypingFxStyle, presets: TypingFxPresets) => Promise<void> | void
  t: Translate<ConversationKey>
}) {
  const [draft, setDraft] = useState<TypingFxStyle>(() => normalizeTypingFxStyle(value))
  // The custom chip is an independent slot holding the remembered triplet:
  // selecting a preset never repaints or overwrites it, and clicking the
  // chip adopts the remembered triplet verbatim.
  const [customPair, setCustomPair] = useState(() => customSeed(normalizeTypingFxStyle(value).colors))
  const [draftPresets, setDraftPresets] = useState<TypingFxPresets>(() => normalizeTypingFxPresets(presets))
  const [selectedPreset, setSelectedPreset] = useState('')
  const [presetName, setPresetName] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)
  const [exchangePending, setExchangePending] = useState<'export' | 'import'>()

  useEffect(() => {
    if (!open) return
    setDraft(normalizeTypingFxStyle(value))
    setCustomPair(customSeed(normalizeTypingFxStyle(value).colors))
    setDraftPresets(normalizeTypingFxPresets(presets))
    setSelectedPreset('')
    setPresetName('')
    setError(undefined)
  }, [open, presets, value])

  const savePreset = (): void => {
    const name = presetName.trim().slice(0, MAX_TYPING_FX_PRESET_NAME_LENGTH)
    if (name === '') {
      setError(t('settings.typingFx.panel.presetNameRequired'))
      return
    }
    if (draftPresets[name] === undefined && Object.keys(draftPresets).length >= MAX_TYPING_FX_PRESETS) {
      setError(t('settings.typingFx.panel.presetLimit'))
      return
    }
    setDraftPresets(current => ({ ...current, [name]: normalizeTypingFxStyle(draft) }))
    setSelectedPreset(name)
    setPresetName('')
    setError(undefined)
  }

  const deletePreset = (): void => {
    if (selectedPreset === '') return
    setDraftPresets(current => Object.fromEntries(
      Object.entries(current).filter(([name]) => name !== selectedPreset),
    ))
    setSelectedPreset('')
  }

  const exportJson = async (): Promise<void> => {
    if (exchangePending !== undefined) return
    setExchangePending('export')
    try {
      const accepted = await writeClipboard(serializeTypingFxConfiguration(draft, draftPresets))
      if (!accepted) setError(t('settings.typingFx.panel.clipboardWriteFailed'))
      else setError(undefined)
    } finally {
      setExchangePending(undefined)
    }
  }

  const importJson = async (): Promise<void> => {
    if (exchangePending !== undefined) return
    setExchangePending('import')
    try {
      const payload = parseTypingFxConfiguration(await navigator.clipboard.readText())
      setDraft(payload.style)
      setCustomPair(customSeed(payload.style.colors))
      setDraftPresets(payload.presets)
      setSelectedPreset('')
      setError(undefined)
    } catch {
      setError(t('settings.typingFx.panel.clipboardReadFailed'))
    } finally {
      setExchangePending(undefined)
    }
  }

  const save = async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    setError(undefined)
    try {
      const result = onSave(normalizeTypingFxStyle(draft), normalizeTypingFxPresets(draftPresets))
      if (result !== undefined) await result
      onClose()
    } catch {
      setError(t('settings.typingFx.panel.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('settings.typingFx.panel.title')}
      description={t('settings.typingFx.panel.description')}
      closeLabel={t('settings.typingFx.panel.close')}
      className={css.dialog}
      contentClassName={css.contentScroll}
      footer={(
        <div className={css.footer}>
          <Button variant="outline" disabled={saving} onClick={() => {
            setDraft(normalizeTypingFxStyle(DEFAULT_TYPING_FX_STYLE))
            setSelectedPreset('')
            setError(undefined)
          }}>
            {t('settings.typingFx.panel.reset')}
          </Button>
          <span className={css.footerSpacer} />
          <Button variant="outline" disabled={saving} onClick={onClose}>{t('settings.typingFx.panel.cancel')}</Button>
          <Button variant="primary" disabled={saving} loading={saving} onClick={() => { void save() }}>
            {t('settings.typingFx.panel.save')}
          </Button>
        </div>
      )}
    >
      {error !== undefined && <Toast text={error} holdMs={null} dismissLabel={t('settings.typingFx.panel.close')} onDone={() => { setError(undefined) }} />}
      <div className={css.body}>
        <div className={css.previewStage} aria-label={t('settings.typingFx.panel.preview')}>
          <div className={css.previewCard}>
            <TypingFxPreview draft={draft} text={t('settings.typingFx.panel.previewText')} />
          </div>
        </div>

        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('settings.typingFx.panel.effect')}</h3>
          <div className={css.selectRow}>
            <span className={css.controlLabel}>{t('settings.typingFx.panel.effect')}</span>
            <SettingsSelect
              className={css.directionSelect}
              variant="block"
              aria-label={t('settings.typingFx.panel.effect')}
              value={draft.effect}
              options={TYPING_FX_EFFECTS.map(effect => ({
                id: effect,
                label: t(`settings.typingFx.panel.effect.${effect}`),
              }))}
              onChange={(effect) => {
                setDraft(current => ({ ...current, effect: effect as TypingFxStyle['effect'] }))
              }}
            />
          </div>
          <label className={css.controlRow}>
            <span className={css.controlLabel}>{t('settings.typingFx.panel.speed')}</span>
            <input
              className={css.slider}
              type="range"
              aria-label={t('settings.typingFx.panel.speed')}
              value={draft.speed}
              min={MIN_TYPING_FX_SPEED}
              max={MAX_TYPING_FX_SPEED}
              step={10}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                setDraft(current => ({ ...current, speed: Number(event.target.value) }))
              }}
            />
            <span className={css.value}>{`${draft.speed}%`}</span>
          </label>
        </section>

        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('settings.typingFx.panel.cursor')}</h3>
          <div className={css.selectRow}>
            <span className={css.controlLabel}>{t('settings.typingFx.panel.cursor')}</span>
            <SettingsSelect
              className={css.directionSelect}
              variant="block"
              aria-label={t('settings.typingFx.panel.cursor')}
              value={draft.cursor}
              options={TYPING_FX_CURSORS.map(cursor => ({
                id: cursor,
                label: t(`settings.typingFx.panel.cursor.${cursor}`),
              }))}
              onChange={(cursor) => {
                setDraft(current => ({ ...current, cursor: cursor as TypingFxCursor }))
              }}
            />
          </div>
          <label className={css.checkboxRow}>
            <input
              type="checkbox"
              checked={draft.cursorBlink}
              disabled={draft.cursor === 'native'}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                setDraft(current => ({ ...current, cursorBlink: event.target.checked }))
              }}
            />
            <span>{t('settings.typingFx.panel.blink')}</span>
          </label>
        </section>

        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('settings.typingFx.panel.colors')}</h3>
          <div className={css.paletteGrid}>
            <button
              type="button"
              className={css.paletteChip}
              aria-label={t('settings.typingFx.panel.colors.theme')}
              aria-pressed={draft.colors.kind === 'theme'}
              onClick={() => { setDraft(current => ({ ...current, colors: { kind: 'theme' } })) }}
            >
              <span
                className={css.paletteSwatch}
                style={{ background: 'linear-gradient(90deg, var(--dsw-alias-label-primary) 33%, var(--dsw-alias-state-business-primary) 33% 67%, var(--dsw-alias-label-primary) 67%)' }}
              />
              <span>{t('settings.typingFx.panel.colors.theme')}</span>
            </button>
            {TYPING_FX_COLOR_SCHEMES.map(id => (
              <button
                key={id}
                type="button"
                className={css.paletteChip}
                aria-label={t(`settings.typingFx.panel.colors.${id}`)}
                aria-pressed={draft.colors.kind === 'preset' && draft.colors.id === id}
                onClick={() => { setDraft(current => ({ ...current, colors: { kind: 'preset', id } })) }}
              >
                <span
                  className={css.paletteSwatch}
                  style={{ background: `linear-gradient(90deg, ${TYPING_FX_COLOR_SCHEME_COLORS[id].echo} 33%, ${TYPING_FX_COLOR_SCHEME_COLORS[id].caret} 33% 67%, ${TYPING_FX_COLOR_SCHEME_COLORS[id].text} 67%)` }}
                />
                <span>{t(`settings.typingFx.panel.colors.${id}`)}</span>
              </button>
            ))}
            <button
              type="button"
              className={css.paletteChip}
              aria-label={t('settings.typingFx.panel.colors.custom')}
              aria-pressed={draft.colors.kind === 'custom'}
              onClick={() => {
                setDraft(current => ({ ...current, colors: { kind: 'custom', ...customPair } }))
              }}
            >
              <span
                className={css.paletteSwatch}
                style={{ background: `linear-gradient(90deg, ${customPair.echo} 33%, ${customPair.caret} 33% 67%, ${customPair.text} 67%)` }}
              />
              <span>{t('settings.typingFx.panel.colors.custom')}</span>
            </button>
          </div>
          {draft.colors.kind === 'custom' && (
            <div className={css.colorList}>
              {(['echo', 'caret', 'text'] as const).map(channel => {
                const colors: { echo: string; caret: string; text: string } = customSeed(draft.colors)
                return (
                  <label className={css.colorRow} key={channel}>
                    <span className={css.controlLabel}>{t(`settings.typingFx.panel.colors.${channel}`)}</span>
                    <input
                      className={css.colorInput}
                      type="color"
                      value={colors[channel]}
                      aria-label={t(`settings.typingFx.panel.colors.${channel}`)}
                      onChange={(event: ChangeEvent<HTMLInputElement>) => {
                        const next = event.target.value
                        setCustomPair(current => ({ ...current, [channel]: next }))
                        setDraft(current => current.colors.kind === 'custom'
                          ? { ...current, colors: { ...current.colors, [channel]: next } }
                          : current)
                      }}
                    />
                    <span className={css.colorValue}>{colors[channel].toUpperCase()}</span>
                  </label>
                )
              })}
            </div>
          )}
        </section>

        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('settings.typingFx.panel.presets')}</h3>
          <div className={css.presetRow}>
            <SettingsSelect
              className={css.presetSelect}
              variant="block"
              aria-label={t('settings.typingFx.panel.presetSelect')}
              value={selectedPreset}
              placeholder={t('settings.typingFx.panel.presetSelect')}
              options={Object.keys(draftPresets).map(name => ({ id: name, label: name }))}
              onChange={(name) => {
                setSelectedPreset(name)
                const next = draftPresets[name]
                if (next !== undefined) setDraft(normalizeTypingFxStyle(next))
              }}
            />
            <button
              type="button"
              className={css.iconButton}
              aria-label={t('settings.typingFx.panel.deletePreset')}
              disabled={selectedPreset === ''}
              onClick={deletePreset}
            >
              <IconCloseOutline16 size={14} />
            </button>
          </div>
          <div className={css.presetSaveRow}>
            <Input
              aria-label={t('settings.typingFx.panel.presetName')}
              placeholder={t('settings.typingFx.panel.presetName')}
              value={presetName}
              maxLength={MAX_TYPING_FX_PRESET_NAME_LENGTH}
              onChange={(event: ChangeEvent<HTMLInputElement>) => { setPresetName(event.target.value) }}
            />
            <Button variant="outline" size="sm" onClick={savePreset}>{t('settings.typingFx.panel.savePreset')}</Button>
          </div>
        </section>

        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('settings.typingFx.panel.exchange')}</h3>
          <div className={css.exchangeRow}>
            <Button variant="outline" size="sm" disabled={exchangePending !== undefined} loading={exchangePending === 'export'} onClick={() => { void exportJson() }}>
              {t('settings.typingFx.panel.exportJson')}
            </Button>
            <Button variant="outline" size="sm" disabled={exchangePending !== undefined} loading={exchangePending === 'import'} onClick={() => { void importJson() }}>
              {t('settings.typingFx.panel.importJson')}
            </Button>
          </div>
          <span className={css.hint}>{t('settings.typingFx.panel.jsonLimit', { value: Math.round(MAX_TYPING_FX_JSON_BYTES / 1024) })}</span>
        </section>
      </div>
    </Modal>
  )
}
