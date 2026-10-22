/**
 * Appearance wallpaper row: pick or browse, crop to window aspect, then frost and pixelate.
 */
import { useRef, useState } from 'react'
import { Button, Switch, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  DEFAULT_WALLPAPER_EFFECT, MAX_WALLPAPER_EFFECT, MIN_WALLPAPER_EFFECT,
  MAX_WALLPAPER_FILE_BYTES, WALLPAPER_EFFECT_STEP, WALLPAPER_HIGH_GLASS_HINT,
  encodeWallpaperFile, isWallpaperDataUrl,
} from '../wallpaper.ts'
import type { ThemeSettings, WallpaperFavorite, WallpaperSource } from '../theme-settings.ts'
import type { ThemeKey } from './locales.ts'
import { sliderFillStyle } from './slider.ts'
import { WallpaperCropModal } from './WallpaperCropModal.tsx'
import { WallpaperGalleryModal } from './WallpaperGalleryModal.tsx'
import { wallpaperShell, type WallpaperCatalogItem } from './wallpaper-shell.ts'
import css from './AppearanceSection.module.css'

/** Persist wallpaper image, the two effect sliders, and/or the backdrop effect and its tunables. */
export type SetWallpaper = (
  patch: Partial<Pick<ThemeSettings,
    'wallpaperImage' | 'wallpaperBlur' | 'wallpaperPixelate' | 'backgroundEffect'
    | 'backgroundEffectColors' | 'backgroundEffectSpeed' | 'backgroundEffectCount'
    | 'backgroundEffectPreset' | 'backgroundEffectVariant' | 'skinWallpaperEnabled'
  >>,
) => void

/**
 * Render the wallpaper picker and, once an image is set, the two sliders.
 * @param props - current extras, glass opacity, copy, and the write callback.
 * @returns the wallpaper block.
 */
export function WallpaperRow({
  wallpaperImage,
  wallpaperBlur,
  wallpaperPixelate,
  glassOpacity,
  wallpaperSources,
  wallpaperFavorites,
  skinWallpaperImage,
  skinWallpaperEnabled,
  t,
  setWallpaper,
  setWallpaperSources,
  setWallpaperFavorites,
}: {
  wallpaperImage: string
  wallpaperBlur: number
  wallpaperPixelate: number
  glassOpacity: number
  wallpaperSources: readonly WallpaperSource[]
  wallpaperFavorites: readonly WallpaperFavorite[]
  skinWallpaperImage: string
  skinWallpaperEnabled: boolean
  t: (key: ThemeKey) => string
  setWallpaper: SetWallpaper
  setWallpaperSources?: (patch: { wallpaperSources: WallpaperSource[] }) => void
  setWallpaperFavorites?: (patch: { wallpaperFavorites: WallpaperFavorite[] }) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const request = useRef(0)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | undefined>(undefined)
  const [picking, setPicking] = useState(false)
  const [cropImage, setCropImage] = useState<string | null>(null)
  const [error, setError] = useState<string | undefined>(undefined)
  const hasImage = wallpaperImage.length > 0
  const shell = wallpaperShell()

  const pick = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return
    setError(undefined)
    if (file.size > MAX_WALLPAPER_FILE_BYTES) {
      setError(t('wallpaper.fileTooLarge'))
      return
    }
    const token = ++request.current
    setPicking(true)
    try {
      const encoded = await encodeWallpaperFile(file)
      if (token !== request.current) return
      if (encoded === null) {
        setError(t('wallpaper.invalidImage'))
        return
      }
      setCropImage(encoded)
    } catch {
      if (token === request.current) setError(t('wallpaper.invalidImage'))
    } finally {
      setPicking(false)
    }
  }

  const closeGallery = (): void => {
    request.current += 1
    setGalleryOpen(false)
    setBusyId(undefined)
  }

  const openGallery = (): void => {
    if (shell === null) return
    setError(undefined)
    setGalleryOpen(true)
  }

  const pickGalleryItem = async (item: WallpaperCatalogItem): Promise<void> => {
    if (shell === null) return
    const token = request.current
    setBusyId(item.id)
    setError(undefined)
    try {
      const result = await shell.downloadWallpaper(item.imageUrl)
      if (token !== request.current) return
      if (!result.dataUrl || !isWallpaperDataUrl(result.dataUrl)) {
        setError(result.error || t('wallpaper.downloadFailed'))
        setBusyId(undefined)
        return
      }
      setGalleryOpen(false)
      setBusyId(undefined)
      setCropImage(result.dataUrl)
    } catch {
      if (token === request.current) {
        setBusyId(undefined)
        setError(t('wallpaper.downloadFailed'))
      }
    }
  }

  return (
    <section className={css.block} aria-labelledby="appearance-wallpaper-heading">
      <div className={css.rowHead}>
        <h2 id="appearance-wallpaper-heading" className={css.heading}>{t('wallpaper.title')}</h2>
      </div>
      <p className={css.hint}>{t('wallpaper.description')}</p>
      {skinWallpaperImage !== '' ? (
        <>
          <label className={css.switchRow}>
            <Switch
              checked={skinWallpaperEnabled}
              aria-label={t('wallpaper.skin')}
              onChange={(event) => { setWallpaper({ skinWallpaperEnabled: event.currentTarget.checked }) }}
            />
            <span>{t('wallpaper.skin')}</span>
          </label>
          <p className={css.hint}>{t('wallpaper.skinHint')}</p>
        </>
      ) : null}
      {hasImage && glassOpacity >= WALLPAPER_HIGH_GLASS_HINT ? (
        <p className={css.hint}>{t('wallpaper.glassHint')}</p>
      ) : null}
      <div className={css.wallpaperActions}>
        <Button type="button" variant="outline" loading={picking} onClick={() => { fileRef.current?.click() }}>
          {t('wallpaper.choose')}
        </Button>
        {hasImage ? (
          <>
            <Button type="button" variant="ghost" onClick={() => { setWallpaper({ wallpaperImage: '' }) }}>
              {t('wallpaper.clear')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => { setCropImage(wallpaperImage) }}>
              {t('wallpaper.crop')}
            </Button>
          </>
        ) : null}
        {shell !== null ? (
          <Button type="button" variant="outline" disabled={picking} onClick={() => { openGallery() }}>
            {t('wallpaper.browse')}
          </Button>
        ) : null}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            void pick(file)
          }}
        />
      </div>
      {error ? <Toast key={error} text={error} holdMs={null} dismissLabel={t('wallpaper.close')} onDone={() => { setError(undefined) }} /> : null}
      {hasImage ? (
        <>
          <div
            className={css.wallpaperPreview}
            style={{ backgroundImage: `url("${wallpaperImage}")` }}
            role="img"
            aria-label={t('wallpaper.title')}
          />
          <label className={css.field}>
            <span className={css.rowHead}>
              <span>{t('wallpaper.blur')}</span>
              <span className={css.value}>{wallpaperBlur}%</span>
            </span>
            <input
              type="range"
              className={css.slider}
              min={MIN_WALLPAPER_EFFECT}
              max={MAX_WALLPAPER_EFFECT}
              step={WALLPAPER_EFFECT_STEP}
              value={wallpaperBlur}
              style={sliderFillStyle(wallpaperBlur, MIN_WALLPAPER_EFFECT, MAX_WALLPAPER_EFFECT)}
              aria-valuemin={MIN_WALLPAPER_EFFECT}
              aria-valuemax={MAX_WALLPAPER_EFFECT}
              aria-valuenow={wallpaperBlur}
              aria-label={t('wallpaper.blur')}
              onChange={(event) => { setWallpaper({ wallpaperBlur: Number(event.currentTarget.value) }) }}
            />
          </label>
          <label className={css.field}>
            <span className={css.rowHead}>
              <span>{t('wallpaper.pixelate')}</span>
              <span className={css.value}>{wallpaperPixelate}%</span>
            </span>
            <input
              type="range"
              className={css.slider}
              min={MIN_WALLPAPER_EFFECT}
              max={MAX_WALLPAPER_EFFECT}
              step={WALLPAPER_EFFECT_STEP}
              value={wallpaperPixelate}
              style={sliderFillStyle(wallpaperPixelate, MIN_WALLPAPER_EFFECT, MAX_WALLPAPER_EFFECT)}
              aria-valuemin={MIN_WALLPAPER_EFFECT}
              aria-valuemax={MAX_WALLPAPER_EFFECT}
              aria-valuenow={wallpaperPixelate}
              aria-label={t('wallpaper.pixelate')}
              onChange={(event) => { setWallpaper({ wallpaperPixelate: Number(event.currentTarget.value) }) }}
            />
          </label>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setWallpaper({
                wallpaperBlur: DEFAULT_WALLPAPER_EFFECT,
                wallpaperPixelate: DEFAULT_WALLPAPER_EFFECT,
              })
            }}
          >
            {t('reset')}
          </Button>
        </>
      ) : null}
      {shell !== null ? (
        <WallpaperGalleryModal
          open={galleryOpen}
          busyId={busyId}
          wallpaperSources={wallpaperSources}
          wallpaperFavorites={wallpaperFavorites}
          listWallpaperCatalog={shell.listWallpaperCatalog}
          {...(setWallpaperSources === undefined ? {} : { setWallpaperSources })}
          {...(setWallpaperFavorites === undefined ? {} : { setWallpaperFavorites })}
          t={t}
          onClose={closeGallery}
          onPick={(item) => { void pickGalleryItem(item) }}
        />
      ) : null}
      <WallpaperCropModal
        open={cropImage !== null}
        image={cropImage ?? ''}
        t={t}
        onClose={() => { setCropImage(null) }}
        onConfirm={(dataUrl) => {
          setWallpaper({ wallpaperImage: dataUrl })
          setCropImage(null)
        }}
      />
    </section>
  )
}
