/**
 * Crop a wallpaper to the current window aspect before persisting it.
 */
import { useEffect, useRef, useState } from 'react'
import { Button, Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { cropWallpaper, wallpaperCropRect } from '../wallpaper.ts'
import type { ThemeKey } from './locales.ts'
import { sliderFillStyle } from './slider.ts'
import css from './AppearanceSection.module.css'

const MIN_ZOOM = 1
const MAX_ZOOM = 3
const ZOOM_STEP = 0.05

function readWindowAspect(): number {
  /* v8 ignore next -- the browser bundle always has window */
  if (typeof window === 'undefined') return 16 / 9
  return Math.max(0.25, window.innerWidth / Math.max(1, window.innerHeight))
}

/**
 * Render the crop dialog for a loaded wallpaper data URL.
 * @param props.open - whether the dialog is showing.
 * @param props.image - source data URL.
 * @param props.t - Appearance copy.
 * @param props.onClose - dismiss without writing.
 * @param props.onConfirm - persist the cropped data URL.
 * @returns the modal tree.
 */
export function WallpaperCropModal({
  open,
  image,
  t,
  onClose,
  onConfirm,
}: {
  open: boolean
  image: string
  t: (key: ThemeKey) => string
  onClose: () => void
  onConfirm: (dataUrl: string) => void
}) {
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const [panX, setPanX] = useState(0.5)
  const [panY, setPanY] = useState(0.5)
  const [natural, setNatural] = useState({ width: 1, height: 1 })
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)
  const [aspect, setAspect] = useState(readWindowAspect)
  const session = useRef(0)
  const stopDrag = useRef<(() => void) | null>(null)

  useEffect(() => {
    session.current += 1
    stopDrag.current?.()
    stopDrag.current = null
    if (!open) return
    setZoom(MIN_ZOOM)
    setPanX(0.5)
    setPanY(0.5)
    setBusy(false)
    setFailed(false)
    setReady(false)
    setNatural({ width: 1, height: 1 })
    const updateAspect = (): void => { setAspect(readWindowAspect()) }
    updateAspect()
    window.addEventListener('resize', updateAspect)
    return () => {
      window.removeEventListener('resize', updateAspect)
      stopDrag.current?.()
      stopDrag.current = null
    }
  }, [open, image])

  const dismiss = (): void => {
    session.current += 1
    stopDrag.current?.()
    stopDrag.current = null
    onClose()
  }

  const confirm = async (): Promise<void> => {
    if (!ready) return
    const token = session.current
    setBusy(true)
    setFailed(false)
    try {
      const crop = wallpaperCropRect(natural.width, natural.height, aspect, zoom, panX, panY)
      const cropped = await cropWallpaper(image, crop)
      if (token !== session.current) return
      if (cropped === null) {
        setFailed(true)
        return
      }
      onConfirm(cropped)
    } catch {
      if (token === session.current) setFailed(true)
    } finally {
      if (token === session.current) setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={dismiss}
      title={t('wallpaper.crop')}
      closeLabel={t('wallpaper.close')}
      description={t('wallpaper.cropHint')}
      className={css.cropDialog}
      footer={(
        <>
          <Button type="button" onClick={dismiss}>{t('editor.cancel')}</Button>
          <Button type="button" variant="primary" loading={busy} disabled={!ready} onClick={() => { void confirm() }}>
            {t('wallpaper.use')}
          </Button>
        </>
      )}
    >
      <div
        className={css.cropFrame}
        style={{ aspectRatio: String(aspect) }}
        onWheel={(event) => {
          event.preventDefault()
          const delta = event.deltaY < 0 ? ZOOM_STEP * 4 : -ZOOM_STEP * 4
          setZoom((value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value + delta)))
        }}
        onPointerDown={(event) => {
          const frame = event.currentTarget
          const startX = event.clientX
          const startY = event.clientY
          const originX = panX
          const originY = panY
          const move = (next: PointerEvent): void => {
            const dx = (next.clientX - startX) / Math.max(1, frame.clientWidth)
            const dy = (next.clientY - startY) / Math.max(1, frame.clientHeight)
            setPanX(Math.min(1, Math.max(0, originX - dx)))
            setPanY(Math.min(1, Math.max(0, originY - dy)))
          }
          const up = (): void => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
            stopDrag.current = null
          }
          stopDrag.current?.()
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', up)
          stopDrag.current = up
        }}
      >
        {image.length > 0 ? (
          <img
            className={css.cropImage}
            src={image}
            alt=""
            draggable={false}
            style={{
              objectPosition: `${panX * 100}% ${panY * 100}%`,
              transform: `scale(${zoom})`,
              transformOrigin: `${panX * 100}% ${panY * 100}%`,
            }}
            onLoad={(event) => {
              const img = event.currentTarget
              setNatural({
                width: img.naturalWidth || img.width || 1,
                height: img.naturalHeight || img.height || 1,
              })
              setReady(true)
            }}
          />
        ) : null}
      </div>
      {open && failed ? <Toast text={t('wallpaper.cropFailed')} holdMs={null} dismissLabel={t('wallpaper.close')} onDone={() => { setFailed(false) }} /> : null}
      <label className={css.field}>
        <span className={css.rowHead}>
          <span>{t('wallpaper.zoom')}</span>
          <span className={css.value}>{Math.round(zoom * 100)}%</span>
        </span>
        <input
          type="range"
          className={css.slider}
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={ZOOM_STEP}
          value={zoom}
          style={sliderFillStyle(zoom, MIN_ZOOM, MAX_ZOOM)}
          aria-valuemin={MIN_ZOOM}
          aria-valuemax={MAX_ZOOM}
          aria-valuenow={zoom}
          aria-label={t('wallpaper.zoom')}
          onChange={(event) => { setZoom(Number(event.currentTarget.value)) }}
        />
      </label>
    </Modal>
  )
}
