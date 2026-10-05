// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GRADIENT_ATTR, GRADIENT_BLOBS_ID, GRADIENT_LAYER_ID,
  MAX_WALLPAPER_DATA_URL_CHARS, MAX_WALLPAPER_CANVAS_SOLIDITY, TERMINAL_PANE_MIN_SOLIDITY,
  TRANSPARENT_ATTR, TRANSPARENT_GLASS_SOLIDITY,
  WALLPAPER_ATTR, WALLPAPER_INNER_ID, WALLPAPER_LAYER_ID,
  applyWallpaperLayer, clampWallpaperEffect, downscaleWallpaper, encodeWallpaperFile,
  isWallpaperDataUrl, mixWallpaperSurfaces, readFileAsDataUrl, wallpaperBlurPx,
  wallpaperCanvasSolidity, wallpaperPixelFactor,
} from '../src/wallpaper.ts'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
// These canvas fixtures exercise the browser DOM, not Electron's webview overload.
const htmlDocument: { createElement(tag: string, options?: ElementCreationOptions): HTMLElement } = document

afterEach(() => {
  // Route teardown through the layer so its module-level applied cache resets.
  applyWallpaperLayer({ wallpaperImage: '', wallpaperBlur: 0, wallpaperPixelate: 0 })
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('wallpaper helpers', () => {
  it('clamps effect percents and maps them to blur px and pixel scale', () => {
    expect(clampWallpaperEffect(Number.NaN)).toBe(0)
    expect(clampWallpaperEffect(-8)).toBe(0)
    expect(clampWallpaperEffect(140)).toBe(100)
    expect(clampWallpaperEffect(33.4)).toBe(33)
    expect(wallpaperBlurPx(0)).toBe(0)
    expect(wallpaperBlurPx(50)).toBe(20)
    expect(wallpaperPixelFactor(0)).toBe(1)
    expect(wallpaperPixelFactor(100)).toBe(20)
  })

  it('accepts only bounded raster data URLs', () => {
    expect(isWallpaperDataUrl('')).toBe(false)
    expect(isWallpaperDataUrl('https://example.com/x.png')).toBe(false)
    expect(isWallpaperDataUrl(PNG)).toBe(true)
    expect(isWallpaperDataUrl(`${PNG}${'A'.repeat(MAX_WALLPAPER_DATA_URL_CHARS)}`)).toBe(false)
  })

  it('derives the layered canvas solidity from the glass slider', () => {
    expect(wallpaperCanvasSolidity(0)).toBe(0)
    expect(wallpaperCanvasSolidity(40)).toBe(15)
    expect(wallpaperCanvasSolidity(80)).toBe(MAX_WALLPAPER_CANVAS_SOLIDITY)
    expect(wallpaperCanvasSolidity(100)).toBe(MAX_WALLPAPER_CANVAS_SOLIDITY)
    expect(wallpaperCanvasSolidity(140)).toBe(MAX_WALLPAPER_CANVAS_SOLIDITY)
  })

  it('mixes layered chrome fills at the given solidity and keeps an existing hex', () => {
    const light = mixWallpaperSurfaces({}, 'light', 80, TERMINAL_PANE_MIN_SOLIDITY)
    expect(light['--dsw-alias-bg-base']).toContain('var(--dsw-static-neutral-bluish-00)')
    // Canvas 45% (capped), sidebar halfway (63%), raised layers at the full 80%.
    expect(light['--dsw-alias-bg-base']).toContain('45%')
    expect(light['--dsw-specific-sidebar-fill']).toContain('63%')
    expect(light['--dsw-alias-bg-layer-1']).toContain('80%')
    // The terminal pane keeps its own slider value instead of following glass.
    expect(light['--dsw-alias-terminal-pane']).toContain('75%')
    const low = mixWallpaperSurfaces({}, 'light', 40, TERMINAL_PANE_MIN_SOLIDITY)
    expect(low['--dsw-alias-bg-base']).toContain('15%')
    expect(low['--dsw-specific-sidebar-fill']).toContain('28%')
    const dark = mixWallpaperSurfaces({ '--dsw-alias-bg-base': '#120e18' }, 'dark', 70, 60)
    expect(dark['--dsw-alias-bg-base']).toContain('#120e18')
    expect(dark['--dsw-alias-bg-base']).toContain('color-mix')
    expect(dark['--dsw-alias-bg-layer-1']).toContain('70%')
    const already = mixWallpaperSurfaces({
      '--dsw-alias-bg-base': 'color-mix(in srgb, #fff 58%, transparent)',
    }, 'light', 120, 120)
    expect(already['--dsw-alias-bg-base']).toContain('var(--dsw-static-neutral-bluish-00)')
    expect(already['--dsw-alias-bg-base']).toContain(`${MAX_WALLPAPER_CANVAS_SOLIDITY}%`)
    const solid = mixWallpaperSurfaces({}, 'light', 100, 100)
    expect(solid['--dsw-alias-bg-base']).toContain(`${MAX_WALLPAPER_CANVAS_SOLIDITY}%`)
    expect(solid['--dsw-specific-sidebar-fill']).toBe('var(--dsw-static-neutral-bluish-00)')
    expect(solid['--dsw-alias-bg-layer-1']).toBe('var(--dsw-static-neutral-bluish-00)')
    expect(solid['--dsw-alias-terminal-pane']).toBe('var(--dsw-static-neutral-bluish-00)')
    // An explicit value below the readability bound is honored — the UI only
    // hints about TUI selection, it does not clamp the user's choice.
    expect(dark['--dsw-alias-terminal-pane']).toBe('color-mix(in srgb, #120e18 60%, transparent)')
  })

  it('dims the wallpaper bitmap with mask-1 and does not blur the terminal pane', () => {
    const css = readFileSync(join(process.cwd(), 'packages/client/ui-theme/src/styles/wallpaper.css'), 'utf8')
    expect(css).toMatch(/#dsh-wallpaper::after[\s\S]{0,220}--dsw-alias-bg-mask-1/)
    expect(css).not.toMatch(/--dsw-terminal-pane-blur/)
  })

  it('mixes every chrome surface to 0% at the transparent-theme solidity', () => {
    const tokens = mixWallpaperSurfaces({}, 'light', TRANSPARENT_GLASS_SOLIDITY, TERMINAL_PANE_MIN_SOLIDITY)
    expect(tokens['--dsw-alias-bg-base']).toContain('0%')
    expect(tokens['--dsw-alias-bg-layer-1']).toContain('0%')
    expect(tokens['--dsw-alias-bg-layer-2']).toContain('0%')
    expect(tokens['--dsw-specific-sidebar-fill']).toContain('0%')
    expect(tokens['--dsw-alias-terminal-pane']).toContain(`${TERMINAL_PANE_MIN_SOLIDITY}%`)
  })

  it('drops the wallpaper dim mask under the transparent-theme attribute', () => {
    const css = readFileSync(join(process.cwd(), 'packages/client/ui-theme/src/styles/wallpaper.css'), 'utf8')
    expect(css).toMatch(/html\[data-dsh-transparent\] #dsh-wallpaper::after[\s\S]{0,120}background: transparent/)
    expect(TRANSPARENT_ATTR).toBe('data-dsh-transparent')
  })

  it('scopes the shared bloom geometry to data-blob elements', () => {
    const css = readFileSync(join(process.cwd(), 'packages/client/ui-theme/src/styles/wallpaper.css'), 'utf8')
    // A `#dsh-gradient-blobs > i` rule would outrank any non-blob child of
    // the container; shared bloom styles stay scoped to [data-blob].
    expect(css).not.toMatch(/#dsh-gradient-blobs > i\b/)
  })
})

describe('applyWallpaperLayer', () => {
  it('is a no-op when document is missing', () => {
    const original = globalThis.document
    vi.stubGlobal('document', undefined)
    applyWallpaperLayer({ wallpaperImage: PNG, wallpaperBlur: 10, wallpaperPixelate: 10 })
    vi.stubGlobal('document', original)
    expect(original.getElementById(WALLPAPER_LAYER_ID)).toBeNull()
  })

  it('creates, updates, and removes the fixed layer', () => {
    applyWallpaperLayer({ wallpaperImage: 'not-an-image', wallpaperBlur: 10, wallpaperPixelate: 10 })
    expect(document.getElementById(WALLPAPER_LAYER_ID)).toBeNull()
    applyWallpaperLayer({ wallpaperImage: PNG, wallpaperBlur: 25, wallpaperPixelate: 50 })
    expect(document.documentElement.hasAttribute(WALLPAPER_ATTR)).toBe(true)
    const inner = document.getElementById(WALLPAPER_INNER_ID)
    expect(inner?.tagName).toBe('CANVAS')
    expect((inner as HTMLCanvasElement).style.backgroundImage).toContain('data:image/png')
    expect(document.documentElement.style.getPropertyValue('--dsh-wallpaper-blur')).toBe('10px')
    applyWallpaperLayer({ wallpaperImage: PNG, wallpaperBlur: 0, wallpaperPixelate: 0 })
    expect(document.getElementById(WALLPAPER_LAYER_ID)).not.toBeNull()
    expect(document.documentElement.style.getPropertyValue('--dsh-wallpaper-blur')).toBe('0px')
    applyWallpaperLayer({ wallpaperImage: '', wallpaperBlur: 0, wallpaperPixelate: 0 })
    expect(document.documentElement.hasAttribute(WALLPAPER_ATTR)).toBe(false)
    expect(document.getElementById(WALLPAPER_LAYER_ID)).toBeNull()
    expect(document.documentElement.style.getPropertyValue('--dsh-wallpaper-blur')).toBe('')
  })

  it('draws a cover-cropped bitmap at cssSize / factor once the image is decoded', () => {
    class InstantImage {
      complete = true
      width = 200
      height = 100
      naturalWidth = 200
      naturalHeight = 100
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) { /* decode already finished */ }
    }
    vi.stubGlobal('Image', InstantImage)
    const drawn: unknown[][] = []
    const context = { drawImage: (...args: unknown[]) => { drawn.push(args) } }
    // String-keyed access keeps the deprecated createElement out of the lint rules.
    const createElement = Reflect.get(document, 'createElement').bind(document)
    const canvas = createElement('canvas')
    Object.defineProperty(canvas, 'getContext', { value: () => context })
    vi.spyOn(htmlDocument, 'createElement').mockImplementation((tag: string) =>
      tag === 'canvas' ? canvas : createElement(tag))

    // 100% pixelation → factor 20 → bitmap = (viewport + bleed) / 20.
    applyWallpaperLayer({ wallpaperImage: PNG, wallpaperBlur: 0, wallpaperPixelate: 100 })
    expect(drawn).toHaveLength(1)
    expect(canvas.width).toBe(Math.max(1, Math.round((window.innerWidth + 96) / 20)))
    expect(canvas.height).toBe(Math.max(1, Math.round((window.innerHeight + 96) / 20)))
    expect(canvas.style.backgroundImage).toBe('')

    // Same state re-applied: no redraw, no DOM churn.
    applyWallpaperLayer({ wallpaperImage: PNG, wallpaperBlur: 0, wallpaperPixelate: 100 })
    expect(drawn).toHaveLength(1)

    // Factor change redraws at the new bitmap size.
    applyWallpaperLayer({ wallpaperImage: PNG, wallpaperBlur: 0, wallpaperPixelate: 0 })
    expect(drawn).toHaveLength(2)
    expect(canvas.width).toBe(window.innerWidth + 96)

    // A viewport resize redraws with the applied state.
    window.dispatchEvent(new Event('resize'))
    expect(drawn).toHaveLength(3)
  })

  it('paints the ambient gradient only while no wallpaper image is set', () => {
    const gradient = { wallpaperImage: '', wallpaperBlur: 0, wallpaperPixelate: 0, backgroundEffect: 'gradient' as const }
    applyWallpaperLayer(gradient)
    expect(document.documentElement.hasAttribute(GRADIENT_ATTR)).toBe(true)
    expect(document.documentElement.hasAttribute(WALLPAPER_ATTR)).toBe(false)
    expect(document.getElementById(GRADIENT_LAYER_ID)).not.toBeNull()
    expect(document.getElementById(GRADIENT_BLOBS_ID)?.children).toHaveLength(5)
    expect(document.getElementById(WALLPAPER_INNER_ID)).toBeNull()
    // The image always wins: the gradient steps aside while a wallpaper is live.
    applyWallpaperLayer({ ...gradient, wallpaperImage: PNG })
    expect(document.documentElement.hasAttribute(WALLPAPER_ATTR)).toBe(true)
    expect(document.documentElement.hasAttribute(GRADIENT_ATTR)).toBe(false)
    expect(document.getElementById(GRADIENT_LAYER_ID)).toBeNull()
    expect(document.getElementById(WALLPAPER_INNER_ID)).not.toBeNull()
    // Clearing the image brings the stored effect back.
    applyWallpaperLayer(gradient)
    expect(document.documentElement.hasAttribute(GRADIENT_ATTR)).toBe(true)
    expect(document.getElementById(WALLPAPER_INNER_ID)).toBeNull()
    // Off tears the whole layer down.
    applyWallpaperLayer({ ...gradient, backgroundEffect: 'none' })
    expect(document.documentElement.hasAttribute(GRADIENT_ATTR)).toBe(false)
    expect(document.getElementById(WALLPAPER_LAYER_ID)).toBeNull()
  })

  it('writes stored color, speed, count, and variant overrides onto the gradient element', () => {
    applyWallpaperLayer({
      wallpaperImage: '',
      wallpaperBlur: 0,
      wallpaperPixelate: 0,
      backgroundEffect: 'gradient',
      backgroundEffectColors: ['#102030', '', '#a1b2c3', 'junk'],
      backgroundEffectSpeed: 160,
      backgroundEffectCount: 3,
      backgroundEffectVariant: 'chaos',
    })
    const layer = document.getElementById(GRADIENT_LAYER_ID) as HTMLElement
    expect(layer.dataset.variant).toBe('chaos')
    expect(layer.style.getPropertyValue('--dsh-gradient-start')).toBe('#102030')
    expect(layer.style.getPropertyValue('--dsh-gradient-end')).toBe('')
    expect(layer.style.getPropertyValue('--dsh-gradient-1')).toBe('#a1b2c3')
    expect(layer.style.getPropertyValue('--dsh-gradient-2')).toBe('')
    expect(layer.style.getPropertyValue('--dsh-gradient-speed')).toBe('1.6')
    const blooms = document.getElementById(GRADIENT_BLOBS_ID)!.querySelectorAll<HTMLElement>('[data-blob]')
    expect([...blooms].map(b => b.hidden)).toEqual([false, false, false, true, true])
    // Reset clears the inline overrides.
    applyWallpaperLayer({
      wallpaperImage: '',
      wallpaperBlur: 0,
      wallpaperPixelate: 0,
      backgroundEffect: 'gradient',
      backgroundEffectColors: [],
      backgroundEffectSpeed: 100,
      backgroundEffectCount: 5,
      backgroundEffectVariant: 'bogus',
    })
    expect(layer.dataset.variant).toBe('orbs')
    expect(layer.style.getPropertyValue('--dsh-gradient-start')).toBe('')
    expect(layer.style.getPropertyValue('--dsh-gradient-speed')).toBe('')
    expect([...document.getElementById(GRADIENT_BLOBS_ID)!.querySelectorAll<HTMLElement>('[data-blob]')]
      .every(b => !b.hidden)).toBe(true)
  })
})

describe('encodeWallpaperFile', () => {
  it('reads a File as a data URL and rejects a non-string result', async () => {
    const bytes = Uint8Array.from(atob(PNG.split(',')[1]!), char => char.charCodeAt(0))
    const file = new File([bytes], 'dot.png', { type: 'image/png' })
    expect(await readFileAsDataUrl(file)).toMatch(/^data:image\/png;base64,/)

    class EmptyReader {
      result: ArrayBuffer = new ArrayBuffer(0)
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      readAsDataURL(): void { this.onload?.() }
    }
    vi.stubGlobal('FileReader', EmptyReader)
    expect(await readFileAsDataUrl(file)).toBe('')
  })

  it('returns null for a rejected type, a FileReader error, and a non-image payload', async () => {
    expect(await encodeWallpaperFile(new File(['x'], 'notes.txt', { type: 'text/plain' }))).toBeNull()

    class BoomReader {
      error = undefined
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      readAsDataURL(): void { this.onerror?.() }
    }
    vi.stubGlobal('FileReader', BoomReader)
    expect(await encodeWallpaperFile(new File(['x'], 'dot.png', { type: 'image/png' }))).toBeNull()
    vi.unstubAllGlobals()

    class TextReader {
      result = 'data:text/plain;base64,eA=='
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      readAsDataURL(): void { this.onload?.() }
    }
    vi.stubGlobal('FileReader', TextReader)
    expect(await encodeWallpaperFile(new File(['x'], 'dot.png'))).toBeNull()
  })

  it('keeps a valid data URL when canvas cannot downscale, and drops an oversized one', async () => {
    class PngReader {
      result = PNG
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      readAsDataURL(): void { this.onload?.() }
    }
    vi.stubGlobal('FileReader', PngReader)
    expect(await encodeWallpaperFile(new File(['x'], 'wall.webp', { type: 'image/webp' }))).toBe(PNG)

    class HugeReader {
      result = `data:image/png;base64,${'A'.repeat(MAX_WALLPAPER_DATA_URL_CHARS)}`
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      readAsDataURL(): void { this.onload?.() }
    }
    vi.stubGlobal('FileReader', HugeReader)
    expect(await encodeWallpaperFile(new File(['x'], 'big.jpg', { type: 'image/jpeg' }))).toBeNull()
  })
})

describe('downscaleWallpaper', () => {
  it('returns null without Image or document, on decode failure, and on a zero-size image', async () => {
    const originalImage = globalThis.Image
    const originalDocument = globalThis.document
    vi.stubGlobal('Image', undefined)
    expect(await downscaleWallpaper(PNG)).toBeNull()
    vi.stubGlobal('Image', originalImage)
    vi.stubGlobal('document', undefined)
    expect(await downscaleWallpaper(PNG)).toBeNull()
    vi.stubGlobal('document', originalDocument)

    class FailImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) { queueMicrotask(() => this.onerror?.()) }
    }
    vi.stubGlobal('Image', FailImage)
    expect(await downscaleWallpaper(PNG)).toBeNull()

    class EmptyImage {
      width = 0
      height = 0
      naturalWidth = 0
      naturalHeight = 0
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) { queueMicrotask(() => this.onload?.()) }
    }
    vi.stubGlobal('Image', EmptyImage)
    expect(await downscaleWallpaper(PNG)).toBeNull()

    class AlreadyCompleteImage {
      complete = true
      width = 0
      height = 0
      naturalWidth = 0
      naturalHeight = 0
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) { /* decode already finished */ }
    }
    vi.stubGlobal('Image', AlreadyCompleteImage)
    expect(await downscaleWallpaper(PNG)).toBeNull()

    class DoubleCallbackImage {
      width = 0
      height = 0
      naturalWidth = 0
      naturalHeight = 0
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) {
        const load = this.onload
        const fail = this.onerror
        load?.()
        fail?.()
      }
    }
    vi.stubGlobal('Image', DoubleCallbackImage)
    expect(await downscaleWallpaper(PNG)).toBeNull()
  })

  it('draws onto a canvas and rejects a missing context, a throwing export, or a bad export', async () => {
    class OkImage {
      width = 64
      height = 32
      naturalWidth = 64
      naturalHeight = 32
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) { queueMicrotask(() => this.onload?.()) }
    }
    vi.stubGlobal('Image', OkImage)
    // String-keyed access keeps the deprecated createElement out of the lint rules.
    const createElement = Reflect.get(document, 'createElement').bind(document)

    const missingContextSpy = vi.spyOn(htmlDocument, 'createElement')
    missingContextSpy.mockImplementation((tag: string) => {
      if (tag !== 'canvas') return createElement(tag)
      return { getContext: () => null } as unknown as HTMLCanvasElement
    })
    expect(await downscaleWallpaper(PNG)).toBeNull()
    missingContextSpy.mockRestore()

    const throwingSpy = vi.spyOn(htmlDocument, 'createElement')
    throwingSpy.mockImplementation((tag: string) => {
      if (tag !== 'canvas') return createElement(tag)
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => undefined }),
        toDataURL: () => { throw new Error('tainted') },
      } as unknown as HTMLCanvasElement
    })
    expect(await downscaleWallpaper(PNG)).toBeNull()
    throwingSpy.mockRestore()

    const badExportSpy = vi.spyOn(htmlDocument, 'createElement')
    badExportSpy.mockImplementation((tag: string) => {
      if (tag !== 'canvas') return createElement(tag)
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => undefined }),
        toDataURL: () => 'not-an-image',
      } as unknown as HTMLCanvasElement
    })
    expect(await downscaleWallpaper(PNG)).toBeNull()
    badExportSpy.mockRestore()

    const okSpy = vi.spyOn(htmlDocument, 'createElement')
    okSpy.mockImplementation((tag: string) => {
      if (tag !== 'canvas') return createElement(tag)
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => undefined }),
        toDataURL: () => PNG,
      } as unknown as HTMLCanvasElement
    })
    expect(await downscaleWallpaper(PNG)).toBe(PNG)
  })
})
