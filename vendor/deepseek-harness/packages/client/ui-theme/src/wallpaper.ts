/** Wallpaper extras: data-URL validation, encode, and surface mixing. */

import type { ThemeTokens } from './theme-family.ts'

/** Lowest wallpaper blur/pixelate the settings slider accepts (percent). */
export const MIN_WALLPAPER_EFFECT = 0
/** Highest wallpaper blur/pixelate the settings slider accepts (percent). */
export const MAX_WALLPAPER_EFFECT = 100
/** Default wallpaper blur/pixelate (percent). */
export const DEFAULT_WALLPAPER_EFFECT = 0
/** Wallpaper effect slider step (percent). */
export const WALLPAPER_EFFECT_STEP = 1

/** Longest data URL accepted in the Host section (keeps settings.yaml bounded). */
export const MAX_WALLPAPER_DATA_URL_CHARS = 1_800_000

/** Maximum local or proxied wallpaper file size before decoding. */
export const MAX_WALLPAPER_FILE_BYTES = 12 * 1024 * 1024

/** Longest source edge kept when encoding a picked file. */
export const MAX_WALLPAPER_EDGE = 1920

/** Fixed layer that paints the wallpaper behind `#root`. */
export const WALLPAPER_LAYER_ID = 'dsh-wallpaper'

/** Inner canvas that carries the cover-cropped (optionally pixelated) bitmap plus blur. */
export const WALLPAPER_INNER_ID = 'dsh-wallpaper-inner'

/** Bleed (px per side) around the viewport so blur has no bright edge halo. */
export const WALLPAPER_BLEED = 48

/** Root attribute flipped on while a wallpaper is live. */
export const WALLPAPER_ATTR = 'data-dsh-wallpaper'

/** Ambient gradient element inside the shared fixed layer. */
export const GRADIENT_LAYER_ID = 'dsh-gradient'

/** Blurred container carrying the looping blooms. */
export const GRADIENT_BLOBS_ID = 'dsh-gradient-blobs'

/** Root attribute flipped on while the gradient backdrop effect is live. */
export const GRADIENT_ATTR = 'data-dsh-gradient'

/**
 * Root attribute flipped on while the transparent theme is effective (the
 * flag is on and a wallpaper is live). The stylesheet drops the wallpaper
 * dim mask under it so the image colors show through unmasked.
 */
export const TRANSPARENT_ATTR = 'data-dsh-transparent'

/**
 * Solidity fed into {@link mixWallpaperSurfaces} while the transparent theme
 * is effective: every chrome surface keeps a 0% fill so only the wallpaper
 * paints behind content. The terminal pane still follows its own
 * `terminalOpacity` setting, which defaults to
 * {@link TERMINAL_PANE_MIN_SOLIDITY}.
 */
export const TRANSPARENT_GLASS_SOLIDITY = 0

/** Lowest terminal pane solidity the Appearance slider offers. */
export const MIN_TERMINAL_OPACITY = 40
/** Highest terminal pane solidity the Appearance slider offers. */
export const MAX_TERMINAL_OPACITY = 100
/**
 * Recommended minimum terminal pane solidity while a backdrop is live. TUIs
 * mark selection with bold plus a foreground color and no cell background,
 * so deeper translucency leaves a selected row indistinguishable on a busy
 * wallpaper. The slider defaults here and the UI hints below it, but an
 * explicit lower value is honored.
 */
export const TERMINAL_PANE_MIN_SOLIDITY = 75
/** Shipped terminal pane solidity: the readability bound. */
export const DEFAULT_TERMINAL_OPACITY = TERMINAL_PANE_MIN_SOLIDITY

/**
 * Frosted-glass blur percent the runtime raises the wallpaper to when the
 * transparent theme becomes effective and the current blur sits below it,
 * so text is not left on a sharp wallpaper with 0% surfaces. One-shot per
 * effective transition — the user may lower the slider again afterwards;
 * Appearance then hints instead of re-clamping.
 */
export const TRANSPARENT_MIN_BLUR = 20

/**
 * Canvas fill percent never exceeds this while a wallpaper is mixed, so glass
 * 100% still lets the image show through the main chat. Sidebar and raised
 * surfaces keep the glass slider, including 100% opaque.
 */
export const MAX_WALLPAPER_CANVAS_SOLIDITY = 45

/** Glass opacity at or above which Appearance hints that the wallpaper is covered. */
export const WALLPAPER_HIGH_GLASS_HINT = 90

/** Lowest ambient-gradient speed percent the settings slider accepts. */
export const MIN_BACKGROUND_EFFECT_SPEED = 20
/** Highest ambient-gradient speed percent the settings slider accepts. */
export const MAX_BACKGROUND_EFFECT_SPEED = 300
/**
 * Speed percent whose divisor is exactly 1: the authored keyframe durations.
 * The inline `--dsh-gradient-speed` override is omitted at this value.
 */
export const NEUTRAL_BACKGROUND_EFFECT_SPEED = 100

/** Default ambient-gradient speed percent. */
export const DEFAULT_BACKGROUND_EFFECT_SPEED = 190

/**
 * Interval the ambient gradient advances at. Every step re-rasterizes the
 * blurred, blended full-window backdrop; driven at the display rate (up to
 * 165 Hz) an idle window kept the GPU process near half a core busy. The
 * blooms drift on 10–20 s cycles under a 64 px blur, so twelve steps a second
 * still read as continuous motion.
 */
export const GRADIENT_STEP_MS = 1000 / 12

/** Lowest bloom count the ambient gradient paints. */
export const MIN_BACKGROUND_EFFECT_COUNT = 1
/** Highest bloom count; the authored set is five blooms. */
export const MAX_BACKGROUND_EFFECT_COUNT = 5
/** Default ambient-gradient bloom count. */
export const DEFAULT_BACKGROUND_EFFECT_COUNT = MAX_BACKGROUND_EFFECT_COUNT

/** Bloom shapes the ambient gradient can paint (`data-variant` on `#dsh-gradient`). */
export const BACKGROUND_EFFECT_VARIANTS = ['orbs', 'aurora', 'chaos', 'rays'] as const

/** Default bloom shape. */
export const DEFAULT_BACKGROUND_EFFECT_VARIANT = 'orbs'

/** Color slots a stored override may fill: base start, base end, blooms 1–5. */
export const BACKGROUND_EFFECT_COLOR_SLOTS = 7

/** Inline custom-property names the color slots write onto `#dsh-gradient`. */
const GRADIENT_COLOR_VARS = [
  '--dsh-gradient-start',
  '--dsh-gradient-end',
  '--dsh-gradient-1',
  '--dsh-gradient-2',
  '--dsh-gradient-3',
  '--dsh-gradient-4',
  '--dsh-gradient-5',
] as const

const EFFECT_COLOR = /^#[0-9a-f]{6}$/i

/**
 * Clamp an ambient-gradient speed percent into the slider range.
 * @param value - raw slider or Host number.
 * @returns an integer percent, {@link MIN_BACKGROUND_EFFECT_SPEED}–{@link MAX_BACKGROUND_EFFECT_SPEED}.
 */
export function clampBackgroundEffectSpeed(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BACKGROUND_EFFECT_SPEED
  return Math.min(MAX_BACKGROUND_EFFECT_SPEED, Math.max(MIN_BACKGROUND_EFFECT_SPEED, Math.round(value)))
}

/**
 * Clamp an ambient-gradient bloom count into the authored range.
 * @param value - raw slider or Host number.
 * @returns an integer count, {@link MIN_BACKGROUND_EFFECT_COUNT}–{@link MAX_BACKGROUND_EFFECT_COUNT}.
 */
export function clampBackgroundEffectCount(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BACKGROUND_EFFECT_COUNT
  return Math.min(MAX_BACKGROUND_EFFECT_COUNT, Math.max(MIN_BACKGROUND_EFFECT_COUNT, Math.round(value)))
}

/** Whether a slot value is a usable `#rrggbb` color override. */
export function isBackgroundEffectColor(value: unknown): value is string {
  return typeof value === 'string' && EFFECT_COLOR.test(value.trim())
}

/**
 * Keep at most the authored color slots; each entry is a lowercase `#rrggbb`
 * or `''` (the theme token paints that slot). Trailing empty slots are
 * dropped so the stored list stays short.
 * @param values - wire or writer input; non-arrays yield an empty list.
 * @returns a persistable slot list.
 */
export function sanitizeBackgroundEffectColors(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const slots: string[] = []
  for (const raw of values.slice(0, BACKGROUND_EFFECT_COLOR_SLOTS)) {
    slots.push(isBackgroundEffectColor(raw) ? raw.trim().toLowerCase() : '')
  }
  while (slots.length > 0 && slots[slots.length - 1] === '') slots.pop()
  return slots
}

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'])

// The /i flag makes [A-Z] cover lowercase too, so a-z would be a duplicate.
const DATA_URL = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Z0-9+/=\s]+$/i

/**
 * Clamp a wallpaper effect percent into the slider range.
 * @param value - raw slider or Host number.
 * @returns an integer 0–100.
 */
export function clampWallpaperEffect(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_WALLPAPER_EFFECT
  return Math.min(MAX_WALLPAPER_EFFECT, Math.max(MIN_WALLPAPER_EFFECT, Math.round(value)))
}

/**
 * Map the blur slider to a CSS blur radius.
 * @param percent - 0–100.
 * @returns pixels, 0–40.
 */
export function wallpaperBlurPx(percent: number): number {
  return (clampWallpaperEffect(percent) / MAX_WALLPAPER_EFFECT) * 40
}

/**
 * Map the pixelate slider to a CSS scale factor. 0 stays 1 (no pixelation).
 * @param percent - 0–100.
 * @returns a scale ≥ 1.
 */
export function wallpaperPixelFactor(percent: number): number {
  const clamped = clampWallpaperEffect(percent)
  return clamped <= 0 ? 1 : 1 + (clamped / MAX_WALLPAPER_EFFECT) * 19
}

/**
 * Accept only raster image data URLs that fit the Host size cap.
 * @param value - candidate stored string.
 * @returns whether the value may be painted as a wallpaper.
 */
export function isWallpaperDataUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  if (value.length > MAX_WALLPAPER_DATA_URL_CHARS) return false
  return DATA_URL.test(value)
}

/**
 * Read a File as a data URL.
 * @param file - picked image.
 * @returns the FileReader data URL.
 */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '')
    }
    reader.onerror = () => {
      reject(reader.error ?? new Error('read failed'))
    }
    reader.readAsDataURL(file)
  })
}

/**
 * Downscale a data URL onto a JPEG canvas. Returns null when Image/canvas
 * cannot decode (jsdom) so the caller can keep the original.
 * @param dataUrl - already-validated raster data URL.
 * @returns a JPEG data URL, or null.
 */
export function downscaleWallpaper(dataUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined' || typeof document === 'undefined') {
      resolve(null)
      return
    }
    const image = new Image()
    let settled = false
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      image.onload = null
      image.onerror = null
      resolve(value)
    }
    const timer = setTimeout(() => { finish(null) }, 200)
    const paint = (): void => {
      const width = image.naturalWidth || image.width
      const height = image.naturalHeight || image.height
      if (!width || !height) {
        finish(null)
        return
      }
      const scale = Math.min(1, MAX_WALLPAPER_EDGE / Math.max(width, height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      const context = canvas.getContext('2d')
      if (context === null) {
        finish(null)
        return
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      try {
        const jpeg = canvas.toDataURL('image/jpeg', 0.82)
        finish(isWallpaperDataUrl(jpeg) ? jpeg : null)
      } catch {
        finish(null)
      }
    }
    image.onload = paint
    image.onerror = () => { finish(null) }
    image.src = dataUrl
    if (image.complete) paint()
  })
}

/**
 * Encode a user-picked image into a persistable wallpaper data URL.
 * @param file - image file from the file picker.
 * @returns a data URL, or null when the file is not a usable wallpaper.
 */
export async function encodeWallpaperFile(file: File): Promise<string | null> {
  if (file.size > MAX_WALLPAPER_FILE_BYTES) return null
  const named = /\.(png|jpe?g|webp|gif)$/i.test(file.name)
  if (!ALLOWED_TYPES.has(file.type) && !named) return null
  let raw: string
  try {
    raw = await readFileAsDataUrl(file)
  } catch {
    return null
  }
  if (!raw.startsWith('data:image/')) return null
  const resized = await downscaleWallpaper(raw)
  const next = resized ?? (isWallpaperDataUrl(raw) ? raw : null)
  if (next === null || next.length > MAX_WALLPAPER_DATA_URL_CHARS) return null
  return next
}

/** Pixel rectangle passed to CanvasRenderingContext2D.drawImage. */
export interface WallpaperCropRect {
  sx: number
  sy: number
  sw: number
  sh: number
}

/** Calculate a centered, zoomed cover crop for a source image. */
export function wallpaperCropRect(
  width: number,
  height: number,
  aspect: number,
  zoom: number,
  panX: number,
  panY: number,
): WallpaperCropRect {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const safeAspect = Math.max(0.25, aspect || 1)
  const coverWidth = safeWidth / safeHeight >= safeAspect ? safeHeight * safeAspect : safeWidth
  const coverHeight = safeWidth / safeHeight >= safeAspect ? safeHeight : safeWidth / safeAspect
  const safeZoom = Math.max(1, zoom || 1)
  const sw = Math.max(1, Math.min(safeWidth, coverWidth / safeZoom))
  const sh = Math.max(1, Math.min(safeHeight, coverHeight / safeZoom))
  const maxX = Math.max(0, safeWidth - sw)
  const maxY = Math.max(0, safeHeight - sh)
  return {
    sx: Math.round(maxX * Math.min(1, Math.max(0, panX))),
    sy: Math.round(maxY * Math.min(1, Math.max(0, panY))),
    sw: Math.round(sw),
    sh: Math.round(sh),
  }
}

/** Crop a data URL in a bounded browser canvas; decode or canvas failures fail closed. */
export function cropWallpaper(dataUrl: string, rect: WallpaperCropRect): Promise<string | null> {
  return new Promise((resolve) => {
    if (!isWallpaperDataUrl(dataUrl) || typeof Image === 'undefined' || typeof document === 'undefined') {
      resolve(null)
      return
    }
    const image = new Image()
    let settled = false
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      image.onload = null
      image.onerror = null
      resolve(value)
    }
    const timer = setTimeout(() => { finish(null) }, 1000)
    image.onload = (): void => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, rect.sw)
      canvas.height = Math.max(1, rect.sh)
      const context = canvas.getContext('2d')
      if (context === null) {
        finish(null)
        return
      }
      try {
        context.drawImage(image, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, canvas.width, canvas.height)
        const result = canvas.toDataURL('image/jpeg', 0.82)
        finish(isWallpaperDataUrl(result) && result.length <= MAX_WALLPAPER_DATA_URL_CHARS ? result : null)
      } catch {
        finish(null)
      }
    }
    image.onerror = () => { finish(null) }
    image.src = dataUrl
    if (image.complete) image.onload(new Event('load') as unknown as Event)
  })
}

/**
 * Main-canvas solidity derived from the glass slider, before the wallpaper
 * canvas cap. Sidebar mixing uses this so glass 100% still fully opaques the
 * rail.
 * @param kept - glass opacity percent, already clamped 0–100.
 * @returns the uncapped canvas fill percent, 0–100.
 */
function wallpaperCanvasSolidityUncapped(kept: number): number {
  if (kept <= 40) return Math.round(kept * 0.375)
  if (kept <= 80) return Math.round(15 + (kept - 40) * 0.75)
  return Math.round(45 + (kept - 80) * 2.75)
}

/**
 * Main-canvas solidity derived from the glass slider. The canvas is the
 * surface the wallpaper mostly shows through, so it sits well below the
 * raised-surface solidity around the default setting. The high end of the
 * slider still fully opaques sidebar and raised surfaces; the canvas itself
 * never exceeds {@link MAX_WALLPAPER_CANVAS_SOLIDITY}.
 * @param solidity - glass opacity percent.
 * @returns the canvas fill percent, 0–{@link MAX_WALLPAPER_CANVAS_SOLIDITY}.
 */
export function wallpaperCanvasSolidity(solidity: number): number {
  const kept = Math.min(100, Math.max(0, Math.round(solidity)))
  return Math.min(wallpaperCanvasSolidityUncapped(kept), MAX_WALLPAPER_CANVAS_SOLIDITY)
}

/**
 * Make the main chrome fills translucent so a wallpaper can show through.
 * Solidity is layered: the main canvas is the most see-through (capped),
 * the sidebar sits halfway between the uncapped canvas curve and glass so
 * glass 100% fully opaques the rail, and raised surfaces keep the full
 * glass solidity. A 100% mix stores the solid color, not a color-mix.
 * The terminal pane does not follow the glass slider: it keeps its own
 * `terminalSolidity` value so the well can stay calmer (or more
 * see-through) than the surrounding chrome. Its canvas clears to that DOM
 * fill instead of repainting a second, double-composited mix.
 * @param tokens - current alias tokens (may be empty for DeepSeek).
 * @param mode - resolved half, picks the sheet fallbacks.
 * @param solidity - percent of the solid fill kept (the user's glass opacity).
 * @param terminalSolidity - percent of the terminal pane fill kept (the
 *   user's terminal opacity setting).
 * @returns a new token dictionary.
 */
export function mixWallpaperSurfaces(
  tokens: ThemeTokens,
  mode: 'light' | 'dark',
  solidity: number,
  terminalSolidity: number,
): ThemeTokens {
  const next: ThemeTokens = { ...tokens }
  const kept = Math.min(100, Math.max(0, Math.round(solidity)))
  const canvas = wallpaperCanvasSolidity(kept)
  const sidebar = Math.round((wallpaperCanvasSolidityUncapped(kept) + kept) / 2)
  const base = mode === 'dark'
    ? 'var(--dsw-static-neutral-bluish-950)'
    : 'var(--dsw-static-neutral-bluish-00)'
  const raised = mode === 'dark'
    ? 'var(--dsw-static-neutral-bluish-875)'
    : 'var(--dsw-static-neutral-bluish-00)'
  const surfaces: Record<string, { fallback: string; percent: number }> = {
    '--dsw-alias-bg-base': { fallback: base, percent: canvas },
    '--dsw-alias-bg-layer-1': { fallback: raised, percent: kept },
    '--dsw-alias-bg-layer-2': { fallback: raised, percent: kept },
    '--dsw-specific-sidebar-fill': { fallback: raised, percent: sidebar },
  }
  for (const [name, { fallback, percent }] of Object.entries(surfaces)) {
    const current = next[name]
    const solid = current !== undefined && !current.includes('color-mix') ? current : fallback
    next[name] = percent >= 100
      ? solid
      : `color-mix(in srgb, ${solid} ${percent}%, transparent)`
  }
  const pane = tokens['--dsw-alias-bg-base']
  const paneSolid = pane !== undefined && !pane.includes('color-mix') ? pane : base
  const paneKept = Math.min(100, Math.max(0, Math.round(terminalSolidity)))
  next['--dsw-alias-terminal-pane'] = paneKept >= 100
    ? paneSolid
    : `color-mix(in srgb, ${paneSolid} ${paneKept}%, transparent)`
  return next
}

/**
 * Last state written into the DOM. The wallpaper layer is a document
 * singleton, so this module-level cache is what keeps re-publishes cheap:
 * during a slider drag every theme publish calls {@link applyWallpaperLayer},
 * and re-setting the megabyte-scale data URL or redrawing the bitmap on every
 * tick is what makes dragging janky.
 */
let applied: { image: string; blurPx: number; factor: number; gradient: boolean } | null = null
let decodedFor = ''
let decoded: HTMLImageElement | null = null
let resizeBound = false
let gradientClock: ReturnType<typeof setInterval> | null = null

/** Root attribute the desktop shell sets while its window is minimized or hidden. */
export const WINDOW_HIDDEN_ATTR = 'data-dshd-window-hidden'

function stopGradientClock(): void {
  if (gradientClock === null) return
  clearInterval(gradientClock)
  gradientClock = null
}

/**
 * Hold the bloom animations paused and move them on a {@link GRADIENT_STEP_MS}
 * clock instead of every display frame. Keyframes stay in `wallpaper.css`;
 * animations the stylesheet restarts (variant switch) are caught on the next
 * step. A hidden document takes no steps, nor a desktop window that is
 * minimized or in the tray (`data-dshd-window-hidden`: its view keeps
 * background throttling off, so the page stays "visible"). Without the Web
 * Animations API (jsdom) the CSS animations run unchanged.
 */
function startGradientClock(blobs: HTMLElement | null): void {
  if (gradientClock !== null || blobs === null || typeof blobs.getAnimations !== 'function') return
  const step = (): void => {
    if (!blobs.isConnected) {
      stopGradientClock()
      return
    }
    if (document.visibilityState === 'hidden' || document.documentElement.hasAttribute(WINDOW_HIDDEN_ATTR)) return
    const now = document.timeline?.currentTime
    if (typeof now !== 'number') return
    for (const animation of blobs.getAnimations({ subtree: true })) {
      if (animation.playState !== 'paused') animation.pause()
      animation.currentTime = now
    }
  }
  step()
  gradientClock = setInterval(step, GRADIENT_STEP_MS)
}


/**
 * Build the ambient gradient element: a blurred blob container with five
 * looping blooms. Colors and motion live in
 * `wallpaper.css` on the `--dsw-specific-gradient-*` theme tokens.
 */
function createGradientLayer(): HTMLElement {
  const layer = document.createElement('div')
  layer.id = GRADIENT_LAYER_ID
  const blooms = document.createElement('div')
  blooms.id = GRADIENT_BLOBS_ID
  for (let index = 1; index <= 5; index += 1) {
    const bloom = document.createElement('i')
    bloom.dataset.blob = `${index}`
    blooms.appendChild(bloom)
  }
  layer.appendChild(blooms)
  return layer
}

/** Viewport plus bleed, in CSS px (matches the stylesheet's inset). */
function layerCssSize(): { width: number; height: number } {
  const width = typeof window === 'undefined' ? 0 : window.innerWidth
  const height = typeof window === 'undefined' ? 0 : window.innerHeight
  return {
    width: Math.max(1, width + WALLPAPER_BLEED * 2),
    height: Math.max(1, height + WALLPAPER_BLEED * 2),
  }
}

/**
 * Cover-crop the decoded image into the canvas bitmap at `cssSize / factor`.
 * CSS stretches the bitmap back up with `image-rendering: pixelated`, which
 * is what makes pixelation actually visible (a transform scale is re-rastered
 * by the compositor at the final scale and shows nothing). A missing 2d
 * context (jsdom) leaves the CSS background-image fallback in place.
 */
function drawWallpaperBitmap(canvas: HTMLCanvasElement, image: HTMLImageElement, factor: number): void {
  const context = canvas.getContext('2d')
  if (context === null) return
  const { width, height } = layerCssSize()
  const bitmapWidth = Math.max(1, Math.round(width / factor))
  const bitmapHeight = Math.max(1, Math.round(height / factor))
  const sourceWidth = image.naturalWidth || image.width
  const sourceHeight = image.naturalHeight || image.height
  if (!sourceWidth || !sourceHeight) return
  canvas.width = bitmapWidth
  canvas.height = bitmapHeight
  const scale = Math.max(bitmapWidth / sourceWidth, bitmapHeight / sourceHeight)
  const drawWidth = sourceWidth * scale
  const drawHeight = sourceHeight * scale
  context.drawImage(image, (bitmapWidth - drawWidth) / 2, (bitmapHeight - drawHeight) / 2, drawWidth, drawHeight)
  canvas.style.backgroundImage = ''
}

/** Redraw with the currently applied state (image decode or viewport resize). */
function redrawApplied(): void {
  if (applied === null || typeof document === 'undefined') return
  const canvas = document.getElementById(WALLPAPER_INNER_ID)
  if (canvas === null) return
  redrawWallpaper(canvas as HTMLCanvasElement, applied.image, applied.factor)
}

/** Draw now when the image is decoded, otherwise decode once and draw on load. */
function redrawWallpaper(canvas: HTMLCanvasElement, image: string, factor: number): void {
  if (decodedFor === image && decoded !== null) {
    if (decoded.complete) drawWallpaperBitmap(canvas, decoded, factor)
    return
  }
  if (typeof Image === 'undefined') return
  const next = new Image()
  decodedFor = image
  decoded = next
  next.onload = () => {
    if (decoded !== next || applied === null || applied.image !== image) return
    redrawApplied()
  }
  next.src = image
  if (next.complete) drawWallpaperBitmap(canvas, next, factor)
}

/**
 * Write the stored effect overrides onto the gradient element. Empty slots
 * fall back to the theme tokens through the stylesheet's var() chain, so a
 * reset only removes the inline custom properties.
 */
function applyGradientConfig(gradientEl: HTMLElement, extras: {
  backgroundEffectColors?: readonly string[] | undefined
  backgroundEffectSpeed?: number | undefined
  backgroundEffectCount?: number | undefined
  backgroundEffectVariant?: string | undefined
}): void {
  const variant = extras.backgroundEffectVariant ?? ''
  gradientEl.dataset.variant = (BACKGROUND_EFFECT_VARIANTS as readonly string[]).includes(variant)
    ? variant
    : DEFAULT_BACKGROUND_EFFECT_VARIANT
  const colors = sanitizeBackgroundEffectColors(extras.backgroundEffectColors)
  GRADIENT_COLOR_VARS.forEach((name, index) => {
    const value = colors[index] ?? ''
    if (value === '') gradientEl.style.removeProperty(name)
    else gradientEl.style.setProperty(name, value)
  })
  const speed = clampBackgroundEffectSpeed(extras.backgroundEffectSpeed ?? DEFAULT_BACKGROUND_EFFECT_SPEED)
  if (speed === NEUTRAL_BACKGROUND_EFFECT_SPEED) {
    gradientEl.style.removeProperty('--dsh-gradient-speed')
  } else {
    gradientEl.style.setProperty('--dsh-gradient-speed', `${speed / 100}`)
  }
  const count = clampBackgroundEffectCount(extras.backgroundEffectCount ?? DEFAULT_BACKGROUND_EFFECT_COUNT)
  let index = 0
  for (const bloom of gradientEl.querySelectorAll<HTMLElement>('[data-blob]')) {
    index += 1
    bloom.hidden = index > count
  }
}

/**
 * Paint or remove the shared fixed backdrop layer. The layer hosts exactly
 * one occupant: the wallpaper bitmap canvas while a data-URL image is set,
 * or the ambient gradient element while `backgroundEffect` is `gradient`
 * and no image is set — the image always wins. Idempotent per field: only
 * the fields that actually changed touch the DOM. Safe when `document` is
 * missing.
 * @param extras - stored image, the two effect sliders, and the backdrop effect.
 */
export function applyWallpaperLayer(extras: {
  wallpaperImage: string
  wallpaperBlur: number
  wallpaperPixelate: number
  backgroundEffect?: string | undefined
  backgroundEffectColors?: readonly string[] | undefined
  backgroundEffectSpeed?: number | undefined
  backgroundEffectCount?: number | undefined
  backgroundEffectVariant?: string | undefined
}): void {
  if (typeof document === 'undefined') return
  const image = isWallpaperDataUrl(extras.wallpaperImage) ? extras.wallpaperImage : ''
  const gradient = image.length === 0 && extras.backgroundEffect === 'gradient'
  const root = document.documentElement
  if (!gradient) stopGradientClock()
  if (image.length === 0 && !gradient) {
    applied = null
    decoded = null
    decodedFor = ''
    root.removeAttribute(WALLPAPER_ATTR)
    root.removeAttribute(GRADIENT_ATTR)
    document.getElementById(WALLPAPER_LAYER_ID)?.remove()
    root.style.removeProperty('--dsh-wallpaper-blur')
    if (resizeBound && typeof window !== 'undefined') {
      window.removeEventListener('resize', redrawApplied)
      resizeBound = false
    }
    return
  }
  root.toggleAttribute(WALLPAPER_ATTR, image.length > 0)
  root.toggleAttribute(GRADIENT_ATTR, gradient)
  let layer = document.getElementById(WALLPAPER_LAYER_ID)
  if (layer === null) {
    layer = document.createElement('div')
    layer.id = WALLPAPER_LAYER_ID
    layer.setAttribute('aria-hidden', 'true')
    document.body.insertBefore(layer, document.body.firstChild)
    applied = null
  }
  if (gradient) {
    const gradientEl = document.getElementById(GRADIENT_LAYER_ID) ?? createGradientLayer()
    if (gradientEl.parentElement === null) layer.appendChild(gradientEl)
    document.getElementById(WALLPAPER_INNER_ID)?.remove()
    root.style.removeProperty('--dsh-wallpaper-blur')
    if (resizeBound && typeof window !== 'undefined') {
      window.removeEventListener('resize', redrawApplied)
      resizeBound = false
    }
    applyGradientConfig(gradientEl, extras)
    startGradientClock(document.getElementById(GRADIENT_BLOBS_ID))
    applied = { image: '', blurPx: 0, factor: 1, gradient: true }
    return
  }
  document.getElementById(GRADIENT_LAYER_ID)?.remove()
  const blurPx = wallpaperBlurPx(extras.wallpaperBlur)
  const factor = wallpaperPixelFactor(extras.wallpaperPixelate)
  let canvas = document.getElementById(WALLPAPER_INNER_ID) as HTMLCanvasElement | null
  if (canvas === null) {
    canvas = document.createElement('canvas')
    canvas.id = WALLPAPER_INNER_ID
    layer.appendChild(canvas)
    applied = null
  }
  if (!resizeBound && typeof window !== 'undefined') {
    window.addEventListener('resize', redrawApplied)
    resizeBound = true
  }
  if (applied === null || applied.blurPx !== blurPx) {
    root.style.setProperty('--dsh-wallpaper-blur', `${blurPx}px`)
  }
  const imageChanged = applied === null || applied.image !== image
  const factorChanged = applied === null || applied.factor !== factor
  if (imageChanged) canvas.style.backgroundImage = `url("${image}")`
  applied = { image, blurPx, factor, gradient: false }
  if (imageChanged || factorChanged) redrawWallpaper(canvas, image, factor)
}
