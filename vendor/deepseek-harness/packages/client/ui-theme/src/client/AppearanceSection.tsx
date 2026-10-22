/**
 * Appearance settings section: color scheme, theme library, wallpaper, glass, typography.
 * Registered as `settings.section` id `appearance` by this package.
 */
import { useEffect, useState } from 'react'
import { Button, Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ThemeFamily } from '../theme-family.ts'
import {
  DEFAULT_CODE_FONT_SIZE,
  DEFAULT_GLASS_OPACITY,
  DEFAULT_INTERFACE_FONT_SIZE,
  GLASS_OPACITY_STEP,
  MAX_CODE_FONT_SIZE,
  MAX_GLASS_OPACITY,
  MAX_INTERFACE_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_GLASS_OPACITY,
  MIN_INTERFACE_FONT_SIZE,
} from '../theme-family.ts'
import type { ThemePreference, ThemeSettings } from '../theme-settings.ts'
import {
  MAX_TERMINAL_OPACITY, MIN_TERMINAL_OPACITY, TERMINAL_PANE_MIN_SOLIDITY,
  TRANSPARENT_MIN_BLUR,
} from '../wallpaper.ts'
import type { createAppearanceRowStore } from './settings-store.ts'
import { ColorSchemeTiles } from './ColorSchemeTiles.tsx'
import { ThemeLibrary } from './ThemeLibrary.tsx'
import { BackgroundEffectRow } from './BackgroundEffectRow.tsx'
import { CursorEffectRow } from './CursorEffectRow.tsx'
import { MetallicPaintRow } from './MetallicPaintRow.tsx'
import { WallpaperRow } from './WallpaperRow.tsx'
import { sliderFillStyle } from './slider.ts'
import css from './AppearanceSection.module.css'

const TYPOGRAPHY_ADVANCED_KEY = 'dsh:typography-advanced'

function readTypographyAdvanced(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(TYPOGRAPHY_ADVANCED_KEY) === '1'
  } catch {
    return false
  }
}

function writeTypographyAdvanced(open: boolean): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(TYPOGRAPHY_ADVANCED_KEY, open ? '1' : '0')
  } catch {
    /* ignore quota / private mode */
  }
}

/** Injected business face for the Appearance page. */
export interface AppearanceSectionInjected {
  /** Switch the color-scheme preference. */
  setTheme: (id: ThemePreference) => void
  /** Assign a family to one color-scheme half. */
  setThemeHalf: (mode: 'light' | 'dark', id: string) => void
  /** Replace the durable custom-family list. */
  setCustomThemes: (families: ThemeFamily[]) => void
  /** Paint a transient draft family for live preview; null restores the stored theme. */
  previewTheme: (family: ThemeFamily | null) => void
  /** Persist glass-surface opacity. */
  setGlassOpacity: (value: number) => void
  /** Persist the terminal pane's own solidity (终端透明度). */
  setTerminalOpacity: (value: number) => void
  /** Persist the transparent-theme flag (透明主题). */
  setTransparentTheme: (value: boolean) => void
  /** Persist the sidebar-mask flag (隐藏侧栏遮罩). */
  setSidebarMask: (value: boolean) => void
  /** Persist wallpaper image, the two effect sliders, and/or the backdrop effect and its tunables. */
  setWallpaper: (
    patch: Partial<Pick<ThemeSettings,
      'wallpaperImage' | 'wallpaperBlur' | 'wallpaperPixelate' | 'backgroundEffect'
      | 'backgroundEffectColors' | 'backgroundEffectSpeed' | 'backgroundEffectCount'
      | 'backgroundEffectPreset' | 'backgroundEffectVariant' | 'skinWallpaperEnabled'
    >>,
  ) => void
  /** Persist the pointer decoration: enabled flag, chosen effect, and tunables. */
  setCursorFx: (
    patch: Partial<Pick<ThemeSettings,
      'cursorEffectEnabled' | 'cursorEffect' | 'cursorEffectColors'
      | 'cursorEffectSpeed' | 'cursorEffectSize' | 'cursorEffectPreset'
    >>,
  ) => void
  /** Persist the button hover-sheen flag (按钮悬停光泽). */
  setMetallicPaint: (value: boolean) => void
  /** Persist desktop wallpaper source preferences. */
  setWallpaperSources?: (
    patch: Partial<Pick<ThemeSettings, 'wallpaperBingEnabled' | 'wallpaperCatalogUrls' | 'wallpaperSources'>>,
  ) => void
  /** Persist starred gallery items. */
  setWallpaperFavorites?: (patch: Pick<ThemeSettings, 'wallpaperFavorites'>) => void
  /** Persist typography extras. */
  setTypography: (
    patch: Partial<Pick<ThemeSettings,
      'fontFamilySans' | 'fontFamilyCode' | 'fontSizeInterface' | 'fontSizeCode'
      | 'fontFamilyComposer' | 'fontFamilyTerminal'>>,
  ) => void
}

/** Full component props: runtime share + item render share + store share + locale seat + injected face. */
export type AppearanceSectionComponentProps =
  PropsRuntime<'settings.section'> & PropsRenderSlots<'settings.appearance.item'>
  & PropsStore<ReturnType<typeof createAppearanceRowStore>>
  & PropsLocale<'settings.theme'> & AppearanceSectionInjected

/**
 * Render the Appearance settings page.
 * @param props - composed slot props.
 * @returns the page tree.
 */
export function AppearanceSection({
  t,
  renderSlot,
  useStore,
  setTheme,
  setThemeHalf,
  setCustomThemes,
  previewTheme,
  setGlassOpacity,
  setTerminalOpacity,
  setTransparentTheme,
  setSidebarMask,
  setWallpaper,
  setCursorFx,
  setMetallicPaint,
  setWallpaperSources,
  setWallpaperFavorites,
  setTypography,
}: AppearanceSectionComponentProps) {
  const preference = useStore(s => s.preference)
  const resolvedMode = useStore(s => s.resolvedMode)
  const families = useStore(s => s.families)
  const customThemes = useStore(s => s.customThemes)
  const activeLightThemeId = useStore(s => s.activeLightThemeId)
  const activeDarkThemeId = useStore(s => s.activeDarkThemeId)
  const glassOpacity = useStore(s => s.glassOpacity)
  const terminalOpacity = useStore(s => s.terminalOpacity)
  const transparentTheme = useStore(s => s.transparentTheme)
  const sidebarMaskHidden = useStore(s => s.sidebarMaskHidden)
  const wallpaperImage = useStore(s => s.wallpaperImage)
  const effectiveWallpaperImage = useStore(s => s.effectiveWallpaperImage) ?? ''
  const skinWallpaperImage = useStore(s => s.skinWallpaperImage) ?? ''
  const skinWallpaperEnabled = useStore(s => s.skinWallpaperEnabled) ?? true
  const wallpaperBlur = useStore(s => s.wallpaperBlur)
  const wallpaperPixelate = useStore(s => s.wallpaperPixelate)
  const wallpaperSources = useStore(s => s.wallpaperSources)
  const wallpaperFavorites = useStore(s => s.wallpaperFavorites)
  const backgroundEffect = useStore(s => s.backgroundEffect)
  const backgroundEffectColors = useStore(s => s.backgroundEffectColors)
  const backgroundEffectSpeed = useStore(s => s.backgroundEffectSpeed)
  const backgroundEffectCount = useStore(s => s.backgroundEffectCount)
  const backgroundEffectPreset = useStore(s => s.backgroundEffectPreset)
  const backgroundEffectVariant = useStore(s => s.backgroundEffectVariant)
  const cursorEffectEnabled = useStore(s => s.cursorEffectEnabled)
  const cursorEffect = useStore(s => s.cursorEffect)
  const cursorEffectColors = useStore(s => s.cursorEffectColors)
  const cursorEffectSpeed = useStore(s => s.cursorEffectSpeed)
  const cursorEffectSize = useStore(s => s.cursorEffectSize)
  const cursorEffectPreset = useStore(s => s.cursorEffectPreset)
  const metallicPaintEnabled = useStore(s => s.metallicPaintEnabled)
  const fontFamilySans = useStore(s => s.fontFamilySans)
  const fontFamilyCode = useStore(s => s.fontFamilyCode)
  const fontSizeInterface = useStore(s => s.fontSizeInterface)
  const fontSizeCode = useStore(s => s.fontSizeCode)
  const fontFamilyComposer = useStore(s => s.fontFamilyComposer)
  const fontFamilyTerminal = useStore(s => s.fontFamilyTerminal)
  const [advanced, setAdvanced] = useState(readTypographyAdvanced)

  useEffect(() => {
    writeTypographyAdvanced(advanced)
  }, [advanced])

  return (
    <div className={css.page}>
      <section className={css.block} aria-labelledby="appearance-scheme-heading">
        <h2 id="appearance-scheme-heading" className={css.heading}>{t('scheme.title')}</h2>
        <p className={css.hint}>{t('scheme.description')}</p>
        <ColorSchemeTiles preference={preference} t={t} setTheme={setTheme} />
      </section>

      <section className={css.block} aria-labelledby="appearance-library-heading">
        <ThemeLibrary
          families={families}
          customThemes={customThemes}
          activeLightThemeId={activeLightThemeId}
          activeDarkThemeId={activeDarkThemeId}
          resolvedMode={resolvedMode}
          t={t}
          setThemeHalf={setThemeHalf}
          setCustomThemes={setCustomThemes}
          previewTheme={previewTheme}
        />
      </section>

      <WallpaperRow
        wallpaperImage={wallpaperImage}
        wallpaperBlur={wallpaperBlur}
        wallpaperPixelate={wallpaperPixelate}
        glassOpacity={glassOpacity}
        wallpaperSources={wallpaperSources}
        wallpaperFavorites={wallpaperFavorites}
        skinWallpaperImage={skinWallpaperImage}
        skinWallpaperEnabled={skinWallpaperEnabled}
        t={t}
        setWallpaper={setWallpaper}
        {...(setWallpaperSources === undefined ? {} : { setWallpaperSources })}
        {...(setWallpaperFavorites === undefined ? {} : { setWallpaperFavorites })}
      />

      <BackgroundEffectRow
        backgroundEffect={backgroundEffect}
        backgroundEffectColors={backgroundEffectColors}
        backgroundEffectSpeed={backgroundEffectSpeed}
        backgroundEffectCount={backgroundEffectCount}
        backgroundEffectPreset={backgroundEffectPreset}
        backgroundEffectVariant={backgroundEffectVariant}
        wallpaperSet={effectiveWallpaperImage.length > 0}
        t={t}
        setWallpaper={setWallpaper}
      />

      <CursorEffectRow
        cursorEffectEnabled={cursorEffectEnabled}
        cursorEffect={cursorEffect}
        cursorEffectColors={cursorEffectColors}
        cursorEffectSpeed={cursorEffectSpeed}
        cursorEffectSize={cursorEffectSize}
        cursorEffectPreset={cursorEffectPreset}
        t={t}
        setCursorFx={setCursorFx}
      />

      <MetallicPaintRow
        metallicPaintEnabled={metallicPaintEnabled}
        t={t}
        setMetallicPaint={setMetallicPaint}
      />

      <section className={css.block} aria-labelledby="appearance-glass-heading">
        <div className={css.rowHead}>
          <h2 id="appearance-glass-heading" className={css.heading}>{t('glass.title')}</h2>
          <span className={css.value}>{glassOpacity}%</span>
        </div>
        <p className={css.hint}>{t('glass.description')}</p>
        <input
          type="range"
          className={css.slider}
          min={MIN_GLASS_OPACITY}
          max={MAX_GLASS_OPACITY}
          step={GLASS_OPACITY_STEP}
          value={glassOpacity}
          style={sliderFillStyle(glassOpacity, MIN_GLASS_OPACITY, MAX_GLASS_OPACITY)}
          aria-valuemin={MIN_GLASS_OPACITY}
          aria-valuemax={MAX_GLASS_OPACITY}
          aria-valuenow={glassOpacity}
          aria-label={t('glass.title')}
          disabled={transparentTheme && effectiveWallpaperImage !== ''}
          onChange={(event) => { setGlassOpacity(Number(event.currentTarget.value)) }}
        />
        <Button type="button" variant="ghost" onClick={() => { setGlassOpacity(DEFAULT_GLASS_OPACITY) }}>
          {t('reset')}
        </Button>
        <label className={css.field}>
          <span className={css.rowHead}>
            <span>{t('glass.terminal')}</span>
            <span className={css.value}>{terminalOpacity}%</span>
          </span>
          <input
            type="range"
            className={css.slider}
            min={MIN_TERMINAL_OPACITY}
            max={MAX_TERMINAL_OPACITY}
            step={GLASS_OPACITY_STEP}
            value={terminalOpacity}
            style={sliderFillStyle(terminalOpacity, MIN_TERMINAL_OPACITY, MAX_TERMINAL_OPACITY)}
            aria-valuemin={MIN_TERMINAL_OPACITY}
            aria-valuemax={MAX_TERMINAL_OPACITY}
            aria-valuenow={terminalOpacity}
            aria-label={t('glass.terminal')}
            onChange={(event) => { setTerminalOpacity(Number(event.currentTarget.value)) }}
          />
        </label>
        <p className={css.hint}>
          {effectiveWallpaperImage === '' && backgroundEffect !== 'gradient'
            ? t('glass.terminalNeedsBackdrop')
            : terminalOpacity < TERMINAL_PANE_MIN_SOLIDITY
              ? t('glass.terminalDeepHint')
              : t('glass.terminalHint')}
        </p>
        <label className={css.switchRow}>
          <Switch
            checked={transparentTheme}
            aria-label={t('glass.transparent')}
            onChange={(event) => { setTransparentTheme(event.currentTarget.checked) }}
          />
          <span>{t('glass.transparent')}</span>
        </label>
        <p className={css.hint}>
          {transparentTheme && effectiveWallpaperImage === ''
            ? t('glass.transparentNeedsWallpaper')
            : transparentTheme && wallpaperBlur < TRANSPARENT_MIN_BLUR
              ? t('glass.transparentBlurHint')
              : t('glass.transparentHint')}
        </p>
        <label className={css.switchRow}>
          <Switch
            checked={sidebarMaskHidden}
            aria-label={t('glass.sidebarMask')}
            onChange={(event) => { setSidebarMask(event.currentTarget.checked) }}
          />
          <span>{t('glass.sidebarMask')}</span>
        </label>
        <p className={css.hint}>{t('glass.sidebarMaskHint')}</p>
      </section>

      <section className={css.block} aria-labelledby="appearance-type-heading">
        <div className={css.rowHead}>
          <h2 id="appearance-type-heading" className={css.heading}>{t('type.title')}</h2>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setTypography({
                fontFamilySans: '',
                fontFamilyCode: '',
                fontSizeInterface: DEFAULT_INTERFACE_FONT_SIZE,
                fontSizeCode: DEFAULT_CODE_FONT_SIZE,
                fontFamilyComposer: '',
                fontFamilyTerminal: '',
              })
            }}
          >
            {t('reset')}
          </Button>
        </div>

        <label className={css.field}>
          <span>{t('type.interface')}</span>
          <Input
            value={fontFamilySans}
            placeholder={t('type.placeholder')}
            onChange={(event) => { setTypography({ fontFamilySans: event.currentTarget.value }) }}
          />
          <span className={css.hint}>{t('type.interfaceHint')}</span>
        </label>
        <label className={css.field}>
          <span>{t('type.size')}</span>
          <input
            type="range"
            className={css.slider}
            min={MIN_INTERFACE_FONT_SIZE}
            max={MAX_INTERFACE_FONT_SIZE}
            step={1}
            value={fontSizeInterface}
            style={sliderFillStyle(fontSizeInterface, MIN_INTERFACE_FONT_SIZE, MAX_INTERFACE_FONT_SIZE)}
            aria-label={t('type.size')}
            onChange={(event) => { setTypography({ fontSizeInterface: Number(event.currentTarget.value) }) }}
          />
          <span className={css.value}>{fontSizeInterface}px</span>
        </label>
        <label className={css.field}>
          <span>{t('type.code')}</span>
          <Input
            value={fontFamilyCode}
            placeholder={t('type.placeholder')}
            onChange={(event) => { setTypography({ fontFamilyCode: event.currentTarget.value }) }}
          />
          <span className={css.hint}>{t('type.codeHint')}</span>
        </label>
        <label className={css.field}>
          <span>{t('type.sizeCode')}</span>
          <input
            type="range"
            className={css.slider}
            min={MIN_CODE_FONT_SIZE}
            max={MAX_CODE_FONT_SIZE}
            step={1}
            value={fontSizeCode}
            style={sliderFillStyle(fontSizeCode, MIN_CODE_FONT_SIZE, MAX_CODE_FONT_SIZE)}
            aria-label={t('type.sizeCode')}
            onChange={(event) => { setTypography({ fontSizeCode: Number(event.currentTarget.value) }) }}
          />
          <span className={css.value}>{fontSizeCode}px</span>
        </label>

        <Button
          type="button"
          variant="ghost"
          aria-expanded={advanced}
          onClick={() => { setAdvanced(value => !value) }}
        >
          {t('type.advanced')}
        </Button>
        {advanced ? (
          <div className={css.advanced}>
            <label className={css.field}>
              <span>{t('type.composer')}</span>
              <Input
                value={fontFamilyComposer}
                placeholder={t('type.placeholder')}
                onChange={(event) => { setTypography({ fontFamilyComposer: event.currentTarget.value }) }}
              />
              <span className={css.hint}>{t('type.composerHint')}</span>
            </label>
            <label className={css.field}>
              <span>{t('type.terminal')}</span>
              <Input
                value={fontFamilyTerminal}
                placeholder={t('type.placeholder')}
                onChange={(event) => { setTypography({ fontFamilyTerminal: event.currentTarget.value }) }}
              />
              <span className={css.hint}>{t('type.terminalHint')}</span>
            </label>
          </div>
        ) : null}
      </section>

      {/* Feature-owned appearance rows (typing effects, …) stack last; each
          row draws its own title/description, so no block heading here. */}
      {renderSlot('settings.appearance.item', {})}
    </div>
  )
}
