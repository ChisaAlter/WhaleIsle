// @vitest-environment jsdom
/** Appearance section: color-scheme tiles, split-preview library, editor, glass, type. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot as WorkspaceListState } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>()
  return { ...actual, writeClipboard: vi.fn(async () => true) }
})
vi.mock('../src/wallpaper.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/wallpaper.ts')>()
  return { ...actual, cropWallpaper: vi.fn() }
})
import { AppearanceSection } from '../src/client/AppearanceSection.tsx'
import { cropWallpaper } from '../src/wallpaper.ts'
import type { AppearanceSectionComponentProps } from '../src/client/AppearanceSection.tsx'
import { createAppearanceRowStore } from '../src/client/settings-store.ts'
import type { AppearanceSyncSnapshot } from '../src/client/settings-store.ts'
import { listThemeFamilies } from '../src/builtin-families.ts'
import { serializeThemeFamily, type ThemeFamily } from '../src/theme-family.ts'
import { DEFAULT_THEME_SETTINGS, type ThemePreference, type WallpaperSource } from '../src/theme-settings.ts'
import { zh } from '../src/client/locales.ts'
import type { WallpaperShell } from '../src/client/wallpaper-shell.ts'

afterEach(() => {
  cleanup()
  localStorage.clear()
  Reflect.deleteProperty(window, 'shell')
})

const COPY = zh
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PNG_BYTES = Uint8Array.from(atob(PNG.split(',')[1]!), char => char.charCodeAt(0))
const CROPPED = 'data:image/jpeg;base64,Y3JvcA=='

beforeEach(() => {
  vi.mocked(cropWallpaper).mockReset()
  vi.mocked(cropWallpaper).mockResolvedValue(CROPPED)
})

async function pickWallpaperFile(
  view: ReturnType<typeof mount>,
  file: File,
): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: COPY['wallpaper.choose'] }))
  const input = view.container.querySelector(
    'input[accept="image/png,image/jpeg,image/webp,image/gif"]',
  ) as HTMLInputElement
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } })
  })
}

function loadCropPreview(): HTMLElement {
  const crop = screen.getByRole('dialog', { name: COPY['wallpaper.crop'] })
  const img = crop.querySelector('img')
  if (img) {
    Object.defineProperty(img, 'naturalWidth', { value: 1920, configurable: true })
    Object.defineProperty(img, 'naturalHeight', { value: 1080, configurable: true })
    fireEvent.load(img)
  }
  return crop
}

function emptySessions() {
  const store = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined })
  return bindSnapshotSelector(store)
}
function emptyWorkspaces() {
  const store = createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  })
  return bindSnapshotSelector(store)
}

const CUSTOM: ThemeFamily = {
  id: 'grove',
  name: 'Grove',
  origin: 'custom',
  light: { accent: '#0f766e', background: '#f3faf7', foreground: '#10211c', contrast: 44 },
  dark: { accent: '#3dd6b5', background: '#071411', foreground: '#e7f6f1', contrast: 50 },
}

function snap(overrides: Partial<AppearanceSyncSnapshot> = {}): AppearanceSyncSnapshot {
  const customThemes = overrides.customThemes ?? []
  return {
    preference: DEFAULT_THEME_SETTINGS.preference,
    active: { colorScheme: overrides.preference === 'dark' ? 'dark' : 'light' },
    activeLightThemeId: 'deepseek',
    activeDarkThemeId: 'deepseek',
    customThemes,
    glassOpacity: DEFAULT_THEME_SETTINGS.glassOpacity,
    terminalOpacity: DEFAULT_THEME_SETTINGS.terminalOpacity,
    transparentTheme: false,
    sidebarMaskHidden: DEFAULT_THEME_SETTINGS.sidebarMaskHidden,
    wallpaperImage: '',
    skinWallpaperImage: '',
    skinWallpaperEnabled: true,
    effectiveWallpaperImage: overrides.effectiveWallpaperImage ?? overrides.wallpaperImage ?? '',
    wallpaperBlur: 0,
    wallpaperPixelate: 0,
    backgroundEffect: DEFAULT_THEME_SETTINGS.backgroundEffect,
    backgroundEffectColors: DEFAULT_THEME_SETTINGS.backgroundEffectColors,
    backgroundEffectSpeed: DEFAULT_THEME_SETTINGS.backgroundEffectSpeed,
    backgroundEffectCount: DEFAULT_THEME_SETTINGS.backgroundEffectCount,
    backgroundEffectPreset: DEFAULT_THEME_SETTINGS.backgroundEffectPreset,
    backgroundEffectVariant: DEFAULT_THEME_SETTINGS.backgroundEffectVariant,
    cursorEffectEnabled: false,
    cursorEffect: 'trail',
    cursorEffectColors: [],
    cursorEffectSpeed: 100,
    cursorEffectSize: 100,
    cursorEffectPreset: 'default',
    fontFamilySans: '',
    fontFamilyCode: '',
    fontSizeInterface: DEFAULT_THEME_SETTINGS.fontSizeInterface,
    fontSizeCode: DEFAULT_THEME_SETTINGS.fontSizeCode,
    fontFamilyComposer: '',
    fontFamilyTerminal: '',
    ...overrides,
    families: overrides.families ?? listThemeFamilies(overrides.customThemes ?? customThemes),
  }
}

function mount(
  preference: ThemePreference = 'system',
  overrides: Partial<AppearanceSyncSnapshot> = {},
  wallpaper?: Pick<WallpaperShell, 'listWallpaperCatalog' | 'downloadWallpaper'>,
  renderSlot: AppearanceSectionComponentProps['renderSlot'] = () => null,
) {
  const store = createAppearanceRowStore().create()
  store.actions.sync(snap({ preference, ...overrides }), 0)
  const setTheme = vi.fn()
  const setThemeHalf = vi.fn()
  const setCustomThemes = vi.fn()
  const previewTheme = vi.fn()
  const setGlassOpacity = vi.fn()
  const setTerminalOpacity = vi.fn()
  const setTransparentTheme = vi.fn()
  const setSidebarMask = vi.fn()
  const setWallpaper = vi.fn()
  const setCursorFx = vi.fn()
  const setMetallicPaint = vi.fn()
  const setTypography = vi.fn()
  const setWallpaperSources = vi.fn()
  const setWallpaperFavorites = vi.fn()
  if (wallpaper !== undefined) {
    Object.defineProperty(window, 'shell', { configurable: true, value: wallpaper })
  }
  const props: AppearanceSectionComponentProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => COPY[key as keyof typeof COPY] ?? key,
    close: vi.fn(),
    renderSlot,
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
    setTypography,
    ...(wallpaper !== undefined ? { setWallpaperSources, setWallpaperFavorites } : {}),
  }
  const view = render(<AppearanceSection {...props} />)
  return {
    store, setTheme, setThemeHalf, setCustomThemes, previewTheme, setGlassOpacity, setTerminalOpacity,
    setTransparentTheme, setSidebarMask, setWallpaper, setCursorFx, setMetallicPaint, setTypography,
    setWallpaperSources, setWallpaperFavorites, ...view,
  }
}

const cube = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}$`) })
const pressed = (name: string): string | null => cube(name).getAttribute('aria-pressed')

describe('AppearanceSection', () => {
  it('renders color-scheme tiles with the preference cube selected', () => {
    mount('dark')
    expect(screen.getByRole('heading', { name: '颜色模式' })).toBeDefined()
    expect(pressed('深色')).toBe('true')
    expect(pressed('浅色')).toBe('false')
    expect(pressed('跟随系统')).toBe('false')
  })

  it('click drives setTheme; selection follows the store mirror', () => {
    const b = mount('dark')
    fireEvent.click(cube('浅色'))
    expect(b.setTheme).toHaveBeenCalledWith('light')
    expect(pressed('深色')).toBe('true')
    act(() => { b.store.actions.sync(snap({ preference: 'light' }), 1) })
    expect(pressed('浅色')).toBe('true')
  })

  it('selects light and dark halves from the split-preview grid', () => {
    const b = mount('system')
    fireEvent.click(screen.getByRole('button', { name: '青瓷 浅色主题' }))
    expect(b.setThemeHalf).toHaveBeenCalledWith('light', 'celadon')
    fireEvent.click(screen.getByRole('button', { name: '青瓷 深色主题' }))
    expect(b.setThemeHalf).toHaveBeenCalledWith('dark', 'celadon')
  })

  it('creates from the light half when the dark id is unknown', () => {
    const b = mount('system', { activeDarkThemeId: 'missing', activeLightThemeId: 'celadon' })
    fireEvent.click(screen.getByRole('button', { name: '创建主题' }))
    expect(screen.getByDisplayValue(/青瓷/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(b.setCustomThemes).not.toHaveBeenCalled()
  })

  it('creates from the first family when neither half id is present', () => {
    mount('system', { activeDarkThemeId: 'missing', activeLightThemeId: 'also-missing' })
    fireEvent.click(screen.getByRole('button', { name: '创建主题' }))
    expect(screen.getByDisplayValue(/DeepSeek/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
  })

  it('keeps typography advanced closed when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined)
    mount('system')
    expect(screen.queryByText('输入框字体')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '高级' }))
    vi.unstubAllGlobals()
  })

  it('treats throwing localStorage reads as collapsed advanced typography', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    })
    mount('system')
    expect(screen.queryByText('输入框字体')).toBeNull()
    vi.unstubAllGlobals()
  })

  it('creates, edits, and saves a custom family from the current half', () => {
    const b = mount('system')
    fireEvent.click(screen.getByRole('button', { name: '创建主题' }))
    const name = screen.getByDisplayValue(/DeepSeek/)
    fireEvent.change(name, { target: { value: 'My Grove' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(b.setCustomThemes).toHaveBeenCalled()
    const saved = b.setCustomThemes.mock.calls[0]![0] as ThemeFamily[]
    expect(saved[0]!.name).toBe('My Grove')
    expect(b.setThemeHalf).toHaveBeenCalledWith('light', saved[0]!.id)
    expect(b.setThemeHalf).toHaveBeenCalledWith('dark', saved[0]!.id)
  })

  it('previews the draft live while the editor is open and clears on close', () => {
    const b = mount('dark')
    fireEvent.click(screen.getByRole('button', { name: '创建主题' }))
    expect(screen.getByText(/正处于深色模式/)).toBeDefined()
    expect(b.previewTheme).toHaveBeenCalledTimes(1)
    const opened = b.previewTheme.mock.calls[0]![0] as ThemeFamily
    expect(opened.origin).toBe('custom')

    const colors = b.container.querySelectorAll('input[type="color"]')
    fireEvent.change(colors[0]!, { target: { value: '#e60000' } })
    const updated = b.previewTheme.mock.calls.at(-1)![0] as ThemeFamily
    expect(updated.light.accent).toBe('#e60000')

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(b.previewTheme).toHaveBeenLastCalledWith(null)
  })

  it('clears the preview when saving and marks the current mode half', () => {
    const b = mount('dark')
    expect(screen.getAllByText('当前模式').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '创建主题' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(b.setCustomThemes).toHaveBeenCalled()
    expect(b.previewTheme).toHaveBeenLastCalledWith(null)
  })

  it('duplicates, edits advanced tokens, and cancels without writing', () => {
    const b = mount('system')
    fireEvent.click(screen.getAllByRole('button', { name: '复制' })[0]!)
    fireEvent.click(screen.getByRole('button', { name: '高级 token' }))
    const override = screen.getAllByPlaceholderText('Auto')[0]!
    fireEvent.change(override, { target: { value: '#112233' } })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(b.setCustomThemes).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull()
  })

  it('edits, exports, and deletes a custom family', async () => {
    const b = mount('system', { customThemes: [CUSTOM] })
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.change(screen.getByDisplayValue('Grove'), { target: { value: 'Grove 2' } })
    const colors = b.container.querySelectorAll('input[type="color"]')
    fireEvent.change(colors[0]!, { target: { value: '#123456' } })
    fireEvent.change(colors[1]!, { target: { value: '#654321' } })
    fireEvent.change(colors[2]!, { target: { value: '#abcdef' } })
    fireEvent.change(colors[3]!, { target: { value: '#fedcba' } })
    fireEvent.change(colors[4]!, { target: { value: '#111111' } })
    fireEvent.change(colors[5]!, { target: { value: '#eeeeee' } })
    fireEvent.change(b.container.querySelector('fieldset input[type="range"]')!, { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(b.setCustomThemes).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    await vi.waitFor(() => { expect(writeClipboard).toHaveBeenCalled() })
    expect(vi.mocked(writeClipboard).mock.calls[0]![0]).toContain('Grove')

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(b.setCustomThemes).toHaveBeenLastCalledWith([])
  })

  it('imports a valid family JSON and ignores invalid files', async () => {
    const b = mount('system')
    fireEvent.click(screen.getByRole('button', { name: '导入主题' }))
    const input = b.container.querySelector('input[type="file"]') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { files: [] } })
    })
    const file = new File([serializeThemeFamily(CUSTOM)], 'grove.json', { type: 'application/json' })
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } })
    })
    await vi.waitFor(() => { expect(b.setCustomThemes).toHaveBeenCalled() })
    const imported = b.setCustomThemes.mock.calls[0]![0] as ThemeFamily[]
    expect(imported[0]!.id).toBe('grove')

    const bad = new File(['{not json'], 'bad.json', { type: 'application/json' })
    await act(async () => {
      fireEvent.change(input, { target: { files: [bad] } })
    })
    expect(b.setCustomThemes).toHaveBeenCalledTimes(1)
  })

  it('writes glass opacity and typography, including the advanced extras toggle', () => {
    const b = mount('system')
    fireEvent.change(screen.getByRole('slider', { name: '玻璃透明度' }), { target: { value: '55' } })
    expect(b.setGlassOpacity).toHaveBeenCalledWith(55)
    fireEvent.click(screen.getAllByRole('button', { name: '重置' })[0]!)
    expect(b.setGlassOpacity).toHaveBeenCalledWith(80)

    const fonts = screen.getAllByPlaceholderText('系统默认')
    fireEvent.change(fonts[0]!, { target: { value: 'Inter' } })
    expect(b.setTypography).toHaveBeenCalledWith({ fontFamilySans: 'Inter' })
    fireEvent.change(fonts[1]!, { target: { value: 'JetBrains Mono' } })
    expect(b.setTypography).toHaveBeenCalledWith({ fontFamilyCode: 'JetBrains Mono' })
    fireEvent.change(screen.getByLabelText('字号'), { target: { value: '18' } })
    expect(b.setTypography).toHaveBeenCalledWith({ fontSizeInterface: 18 })
    fireEvent.change(screen.getByLabelText('代码字号'), { target: { value: '14' } })
    expect(b.setTypography).toHaveBeenCalledWith({ fontSizeCode: 14 })

    fireEvent.click(screen.getByRole('button', { name: '高级' }))
    expect(localStorage.getItem('dsh:typography-advanced')).toBe('1')
    expect(screen.getByText(COPY['type.composerHint'])).toBeDefined()
    expect(screen.getByText(COPY['type.terminalHint'])).toBeDefined()
    const extras = screen.getAllByPlaceholderText('系统默认')
    fireEvent.change(extras[2]!, { target: { value: 'Georgia' } })
    expect(b.setTypography).toHaveBeenCalledWith({ fontFamilyComposer: 'Georgia' })
    fireEvent.change(extras[3]!, { target: { value: 'IBM Plex Mono' } })
    expect(b.setTypography).toHaveBeenCalledWith({ fontFamilyTerminal: 'IBM Plex Mono' })
    const throwing = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    }
    vi.stubGlobal('localStorage', throwing)
    fireEvent.click(screen.getByRole('button', { name: '高级' }))
    vi.unstubAllGlobals()
    fireEvent.click(screen.getAllByRole('button', { name: '重置' })[1]!)
    expect(b.setTypography).toHaveBeenCalledWith({
      fontFamilySans: '',
      fontFamilyCode: '',
      fontSizeInterface: 16,
      fontSizeCode: 13,
      fontFamilyComposer: '',
      fontFamilyTerminal: '',
    })
  })

  it('names the font inputs as installed CSS family names', () => {
    mount('system')
    expect(screen.getByText(COPY['type.interfaceHint'])).toBeDefined()
    expect(screen.getByText(COPY['type.codeHint'])).toBeDefined()
    expect(screen.getAllByPlaceholderText('系统默认')).toHaveLength(2)
  })

  it('toggles the transparent theme and freezes the glass slider while it is effective', () => {
    const b = mount('system', { wallpaperImage: PNG })
    expect(screen.getByText(COPY['glass.transparentHint'])).toBeDefined()
    const toggle = screen.getByRole('switch', { name: COPY['glass.transparent'] })
    fireEvent.click(toggle)
    expect(b.setTransparentTheme).toHaveBeenCalledWith(true)
    act(() => { b.store.actions.sync(snap({ wallpaperImage: PNG, transparentTheme: true }), 1) })
    expect((screen.getByRole('slider', { name: COPY['glass.title'] }) as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('switch', { name: COPY['glass.transparent'] }))
    expect(b.setTransparentTheme).toHaveBeenCalledWith(false)
  })

  it('writes terminal opacity independently of the glass slider and hints below the bound', () => {
    const b = mount('system')
    const slider = screen.getByRole('slider', { name: COPY['glass.terminal'] }) as HTMLInputElement
    expect(slider.disabled).toBe(false)
    // The ambient gradient ships on, so the default copy describes the live rule.
    expect(screen.getByText(COPY['glass.terminalHint'])).toBeDefined()
    fireEvent.change(slider, { target: { value: '60' } })
    expect(b.setTerminalOpacity).toHaveBeenCalledWith(60)
    act(() => { b.store.actions.sync(snap({ terminalOpacity: 60 }), 1) })
    expect(screen.getByText(COPY['glass.terminalDeepHint'])).toBeDefined()
    act(() => { b.store.actions.sync(snap({ terminalOpacity: 60, backgroundEffect: 'none' }), 2) })
    expect(screen.getByText(COPY['glass.terminalNeedsBackdrop'])).toBeDefined()
  })

  it('toggles the sidebar mask independently of the wallpaper state', () => {
    const b = mount('system')
    expect(screen.getByText(COPY['glass.sidebarMaskHint'])).toBeDefined()
    const toggle = screen.getByRole('switch', { name: COPY['glass.sidebarMask'] })
    fireEvent.click(toggle)
    expect(b.setSidebarMask).toHaveBeenCalledWith(false)
    act(() => { b.store.actions.sync(snap({ sidebarMaskHidden: false }), 1) })
    fireEvent.click(screen.getByRole('switch', { name: COPY['glass.sidebarMask'] }))
    expect(b.setSidebarMask).toHaveBeenCalledWith(true)
  })

  it('hints when the frosted-glass blur drops below the readability floor while transparent', () => {
    const b = mount('system', { wallpaperImage: PNG, transparentTheme: true, wallpaperBlur: 5 })
    expect(screen.getByText(COPY['glass.transparentBlurHint'])).toBeDefined()
    act(() => {
      b.store.actions.sync(snap({ wallpaperImage: PNG, transparentTheme: true, wallpaperBlur: 20 }), 1)
    })
    expect(screen.queryByText(COPY['glass.transparentBlurHint'])).toBeNull()
    expect(screen.getByText(COPY['glass.transparentHint'])).toBeDefined()
    // A low blur without the transparent theme keeps the ordinary hint.
    act(() => {
      b.store.actions.sync(snap({ wallpaperImage: PNG, transparentTheme: false, wallpaperBlur: 5 }), 2)
    })
    expect(screen.queryByText(COPY['glass.transparentBlurHint'])).toBeNull()
  })

  it('hints that the transparent theme needs a wallpaper and keeps the slider live without one', () => {
    const b = mount('system', { transparentTheme: true })
    expect(screen.getByText(COPY['glass.transparentNeedsWallpaper'])).toBeDefined()
    expect((screen.getByRole('slider', { name: COPY['glass.title'] }) as HTMLInputElement).disabled).toBe(false)
    expect(b.setTransparentTheme).not.toHaveBeenCalled()
  })

  it('hints that high glass opacity covers a set wallpaper', () => {
    const b = mount('system', { wallpaperImage: PNG, glassOpacity: 80 })
    expect(screen.queryByText(COPY['wallpaper.glassHint'])).toBeNull()
    act(() => { b.store.actions.sync(snap({ wallpaperImage: PNG, glassOpacity: 100 }), 1) })
    expect(screen.getByText(COPY['wallpaper.glassHint'])).toBeDefined()
    expect(screen.getByText(COPY['wallpaper.description'])).toBeDefined()
    expect(screen.getByText(COPY['glass.description'])).toBeDefined()
  })

  it('hides wallpaper sliders until an image is set, then writes blur and pixelate', async () => {
    const b = mount('system')
    expect(screen.queryByRole('slider', { name: '毛玻璃程度' })).toBeNull()
    expect(screen.queryByRole('button', { name: '清除' })).toBeNull()
    const ignored = b.container.querySelector('input[accept="image/png,image/jpeg,image/webp,image/gif"]') as HTMLInputElement
    await act(async () => {
      fireEvent.change(ignored, { target: { files: [] } })
    })
    expect(b.setWallpaper).not.toHaveBeenCalled()

    act(() => {
      b.store.actions.sync(snap({ wallpaperImage: PNG, wallpaperBlur: 20, wallpaperPixelate: 10 }), 1)
    })
    expect(screen.getByRole('img', { name: '背景图' })).toBeDefined()
    fireEvent.change(screen.getByRole('slider', { name: '毛玻璃程度' }), { target: { value: '40' } })
    expect(b.setWallpaper).toHaveBeenCalledWith({ wallpaperBlur: 40 })
    fireEvent.change(screen.getByRole('slider', { name: '像素化程度' }), { target: { value: '70' } })
    expect(b.setWallpaper).toHaveBeenCalledWith({ wallpaperPixelate: 70 })
    fireEvent.click(screen.getByRole('button', { name: '清除' }))
    expect(b.setWallpaper).toHaveBeenCalledWith({ wallpaperImage: '' })
    fireEvent.click(screen.getAllByRole('button', { name: '重置' })[0]!)
    expect(b.setWallpaper).toHaveBeenCalledWith({ wallpaperBlur: 0, wallpaperPixelate: 0 })
  })

  it('shows the theme wallpaper switch only when the active family carries one', () => {
    const withoutSkin = mount('system')
    expect(screen.queryByRole('switch', { name: COPY['wallpaper.skin'] })).toBeNull()
    const b = mount('system', { skinWallpaperImage: PNG, skinWallpaperEnabled: true })
    const toggle = screen.getByRole('switch', { name: COPY['wallpaper.skin'] })
    expect((toggle as HTMLInputElement).checked).toBe(true)
    fireEvent.click(toggle)
    expect(b.setWallpaper).toHaveBeenCalledWith({ skinWallpaperEnabled: false })
  })

  it('opens crop for a local pick and persists cropWallpaper output', async () => {
    const b = mount('system')
    await pickWallpaperFile(b, new File([PNG_BYTES], 'dot.png', { type: 'image/png' }))
    await vi.waitFor(() => {
      expect(screen.getByRole('dialog', { name: COPY['wallpaper.crop'] })).toBeDefined()
    })
    expect(b.setWallpaper).not.toHaveBeenCalled()
    const crop = loadCropPreview()
    fireEvent.click(within(crop).getByRole('button', { name: COPY['wallpaper.use'] }))
    await vi.waitFor(() => {
      expect(b.setWallpaper).toHaveBeenCalledWith({ wallpaperImage: CROPPED })
    })
  })

  it('does not persist a local pick when crop is cancelled', async () => {
    const b = mount('system')
    await pickWallpaperFile(b, new File([PNG_BYTES], 'dot.png', { type: 'image/png' }))
    const crop = await screen.findByRole('dialog', { name: COPY['wallpaper.crop'] })
    fireEvent.click(within(crop).getByRole('button', { name: COPY['editor.cancel'] }))
    expect(b.setWallpaper).not.toHaveBeenCalled()
  })

  it('rejects an unreadable local file without opening crop', async () => {
    const b = mount('system')
    await pickWallpaperFile(b, new File(['nope'], 'notes.txt', { type: 'text/plain' }))
    expect(screen.getByText(COPY['wallpaper.invalidImage'])).toBeDefined()
    expect(screen.queryByRole('dialog', { name: COPY['wallpaper.crop'] })).toBeNull()
    expect(b.setWallpaper).not.toHaveBeenCalled()
  })

  it('reopens crop from the stored wallpaper data URL', () => {
    const b = mount('system', { wallpaperImage: PNG })
    fireEvent.click(screen.getByRole('button', { name: COPY['wallpaper.crop'] }))
    const crop = screen.getByRole('dialog', { name: COPY['wallpaper.crop'] })
    expect(crop.querySelector('img')?.getAttribute('src')).toBe(PNG)
    expect(b.setWallpaper).not.toHaveBeenCalled()
  })

  it('keeps wallpaper sources off Appearance when the desktop gallery is available', async () => {
    const listWallpaperCatalog = vi.fn(async () => ({ items: [] }))
    const downloadWallpaper = vi.fn(async () => ({ dataUrl: 'data:image/png;base64,xx' }))
    mount('system', {}, { listWallpaperCatalog, downloadWallpaper })
    expect(screen.getByRole('button', { name: '浏览图库' })).toBeDefined()
    expect(screen.queryByRole('heading', { name: '图源' })).toBeNull()
    expect(screen.queryByRole('heading', { name: '图库来源' })).toBeNull()
    // Transparent theme, sidebar mask, background effect, cursor effect, and button sheen are the only switches; no source switches.
    expect(screen.getAllByRole('switch')).toHaveLength(5)
    expect(screen.getByRole('switch', { name: COPY['glass.transparent'] })).toBeDefined()
    expect(screen.getByRole('switch', { name: COPY['glass.sidebarMask'] })).toBeDefined()
    expect(screen.getByRole('switch', { name: COPY['cursorFx.title'] })).toBeDefined()
    expect(screen.getByRole('switch', { name: COPY['metallicPaint.title'] })).toBeDefined()
    expect(screen.queryByText('Bing 每日壁纸')).toBeNull()
    expect(screen.queryByLabelText('壁纸目录地址')).toBeNull()
    expect(screen.queryByRole('button', { name: '新增图源' })).toBeNull()
  })

  it('adds, edits, and deletes a catalog source inside the gallery window', async () => {
    const listWallpaperCatalog = vi.fn(async () => ({ items: [] }))
    const downloadWallpaper = vi.fn(async () => ({ dataUrl: 'data:image/png;base64,xx' }))
    const b = mount('system', {}, { listWallpaperCatalog, downloadWallpaper })
    fireEvent.click(screen.getByRole('button', { name: '浏览图库' }))
    await screen.findByRole('dialog', { name: '浏览图库' })
    fireEvent.click(screen.getByRole('button', { name: '图源' }))
    expect(screen.getByRole('button', { name: '返回图库' })).toBeDefined()
    expect(screen.getAllByText('必应').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Wallhaven').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '新增图源' }))
    const addDialog = screen.getByRole('dialog', { name: '新增图源' })
    fireEvent.change(within(addDialog).getByLabelText('类型'), { target: { value: 'catalog' } })
    fireEvent.change(within(addDialog).getByLabelText('显示名'), { target: { value: '我的' } })
    fireEvent.change(within(addDialog).getByLabelText('HTTPS 目录地址'), {
      target: { value: 'https://example.com/pack.json' },
    })
    fireEvent.click(within(addDialog).getByRole('button', { name: '保存' }))
    expect(b.setWallpaperSources).toHaveBeenCalledWith(expect.objectContaining({
      wallpaperSources: expect.arrayContaining([
        expect.objectContaining({ kind: 'catalog', url: 'https://example.com/pack.json', name: '我的' }),
      ]),
    }))
    const added = b.setWallpaperSources.mock.calls[0]![0] as { wallpaperSources: WallpaperSource[] }
    act(() => { b.store.actions.sync(snap({ wallpaperSources: added.wallpaperSources }), 1) })
    fireEvent.click(within(screen.getByText('我的').parentElement!).getByRole('button', { name: '编辑' }))
    const editDialog = screen.getByRole('dialog', { name: '编辑图源' })
    fireEvent.change(within(editDialog).getByLabelText('显示名'), { target: { value: '新目录' } })
    fireEvent.click(within(editDialog).getByRole('button', { name: '保存' }))
    expect(b.setWallpaperSources).toHaveBeenLastCalledWith(expect.objectContaining({
      wallpaperSources: expect.arrayContaining([
        expect.objectContaining({ kind: 'catalog', name: '新目录' }),
      ]),
    }))
    const edited = b.setWallpaperSources.mock.calls.at(-1)![0] as { wallpaperSources: WallpaperSource[] }
    act(() => { b.store.actions.sync(snap({ wallpaperSources: edited.wallpaperSources }), 2) })
    fireEvent.click(within(screen.getByText('新目录').parentElement!).getByRole('button', { name: '删除' }))
    expect(b.setWallpaperSources).toHaveBeenLastCalledWith(expect.objectContaining({
      wallpaperSources: expect.not.arrayContaining([
        expect.objectContaining({ kind: 'catalog' }),
      ]),
    }))
  })

  it('lists bing today when the gallery opens', async () => {
    const listWallpaperCatalog = vi.fn(async () => ({
      items: [{
        id: 'bing-1',
        title: '晨湖',
        copyright: '©',
        thumbUrl: 'https://example.com/t.jpg',
        imageUrl: 'https://example.com/f.jpg',
        source: 'bing',
      }],
    }))
    const downloadWallpaper = vi.fn(async () => ({ dataUrl: PNG }))
    mount('system', {}, { listWallpaperCatalog, downloadWallpaper })
    fireEvent.click(screen.getByRole('button', { name: '浏览图库' }))
    await screen.findByRole('button', { name: /晨湖/ })
    expect(listWallpaperCatalog).toHaveBeenCalledWith(expect.objectContaining({ kind: 'bing' }))
  })

  it('requests wallhaven when that tab is selected', async () => {
    const listWallpaperCatalog = vi.fn(async (query: { kind: string }) => (
      query.kind === 'wallhaven'
        ? {
            items: [{
              id: 'wallhaven-ab',
              title: 'ab',
              copyright: '',
              thumbUrl: 'https://example.com/t.jpg',
              imageUrl: 'https://example.com/f.jpg',
              source: 'wallhaven',
            }],
          }
        : { items: [] }
    ))
    const downloadWallpaper = vi.fn(async () => ({ dataUrl: PNG }))
    mount('system', {}, { listWallpaperCatalog, downloadWallpaper })
    fireEvent.click(screen.getByRole('button', { name: '浏览图库' }))
    await screen.findByRole('dialog', { name: '浏览图库' })
    fireEvent.click(screen.getByRole('button', { name: 'Wallhaven' }))
    await screen.findByRole('button', { name: /^ab$/ })
    expect(listWallpaperCatalog).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'wallhaven',
      categories: '100',
      page: 1,
    }))
  })

  it('filters bing rows by search text', async () => {
    const listWallpaperCatalog = vi.fn(async () => ({
      items: [
        {
          id: 'bing-1',
          title: '晨湖',
          copyright: '',
          thumbUrl: 'https://example.com/t1.jpg',
          imageUrl: 'https://example.com/f1.jpg',
          source: 'bing',
        },
        {
          id: 'bing-2',
          title: '雪山',
          copyright: '',
          thumbUrl: 'https://example.com/t2.jpg',
          imageUrl: 'https://example.com/f2.jpg',
          source: 'bing',
        },
      ],
    }))
    mount('system', {}, { listWallpaperCatalog, downloadWallpaper: vi.fn() })
    fireEvent.click(screen.getByRole('button', { name: '浏览图库' }))
    await screen.findByRole('button', { name: /晨湖/ })
    fireEvent.change(screen.getByLabelText('搜索'), { target: { value: '雪' } })
    expect(screen.getByRole('button', { name: /雪山/ })).toBeDefined()
    expect(screen.queryByRole('button', { name: /晨湖/ })).toBeNull()
  })

  it('stars a gallery item into favorites and shows it on the favorites tab', async () => {
    const listWallpaperCatalog = vi.fn(async () => ({
      items: [{
        id: 'bing-1',
        title: '晨湖',
        copyright: '©',
        thumbUrl: 'https://example.com/t.jpg',
        imageUrl: 'https://example.com/f.jpg',
        source: 'bing',
      }],
    }))
    const b = mount('system', {}, { listWallpaperCatalog, downloadWallpaper: vi.fn() })
    fireEvent.click(screen.getByRole('button', { name: '浏览图库' }))
    await screen.findByRole('button', { name: /晨湖/ })
    fireEvent.click(screen.getByRole('button', { name: '收藏这张' }))
    expect(b.setWallpaperFavorites).toHaveBeenCalledWith(expect.objectContaining({
      wallpaperFavorites: [expect.objectContaining({
        id: 'bing-1',
        sourceId: 'bing',
        title: '晨湖',
        thumbUrl: 'https://example.com/t.jpg',
        imageUrl: 'https://example.com/f.jpg',
      })],
    }))
    const favorite = b.setWallpaperFavorites.mock.calls[0]![0].wallpaperFavorites[0]!
    act(() => { b.store.actions.sync(snap({ wallpaperFavorites: [favorite] }), 1) })
    fireEvent.click(screen.getByRole('button', { name: '收藏' }))
    expect(screen.getByRole('button', { name: /晨湖/ })).toBeDefined()
  })

  it('confirms before downloading a gallery pick', async () => {
    const listWallpaperCatalog = vi.fn(async () => ({
      items: [{
        id: 'bing-1',
        title: '晨湖',
        copyright: '',
        thumbUrl: 'https://example.com/t.jpg',
        imageUrl: 'https://example.com/f.jpg',
        source: 'bing',
      }],
    }))
    const downloadWallpaper = vi.fn(async () => ({ dataUrl: PNG }))
    mount('system', {}, { listWallpaperCatalog, downloadWallpaper })
    fireEvent.click(screen.getByRole('button', { name: '浏览图库' }))
    await screen.findByRole('button', { name: /晨湖/ })
    fireEvent.click(screen.getByRole('button', { name: /晨湖/ }))
    const confirm = await screen.findByRole('dialog', { name: '将这张图设为背景？' })
    fireEvent.click(within(confirm).getByRole('button', { name: '取消' }))
    expect(downloadWallpaper).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /晨湖/ }))
    const again = await screen.findByRole('dialog', { name: '将这张图设为背景？' })
    fireEvent.click(within(again).getByRole('button', { name: '设为壁纸' }))
    await vi.waitFor(() => { expect(downloadWallpaper).toHaveBeenCalledWith('https://example.com/f.jpg') })
    expect(await screen.findByRole('dialog', { name: COPY['wallpaper.crop'] })).toBeDefined()
  })

  it('toggles the ambient gradient effect through setWallpaper', () => {
    const bindings = mount('system', { backgroundEffect: 'none' })
    fireEvent.click(screen.getByRole('switch', { name: COPY['effect.gradient'] }))
    expect(bindings.setWallpaper).toHaveBeenCalledWith({ backgroundEffect: 'gradient' })
  })

  it('explains the default-off effect on a low-power GPU', () => {
    mount('system', { backgroundEffect: 'none' })
    expect(screen.queryByText(COPY['effect.lowPowerGpu'])).toBeNull()
    cleanup()
    vi.stubGlobal('dshDesktop', { renderHints: { lowPowerGpu: true } })
    try {
      mount('system', { backgroundEffect: 'none' })
      expect(screen.getByText(COPY['effect.lowPowerGpu'])).toBeDefined()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('marks the stored effect as paused while a wallpaper is set', () => {
    mount('system', { backgroundEffect: 'gradient', wallpaperImage: PNG })
    expect(screen.getByText(COPY['effect.pausedByWallpaper'])).toBeDefined()
  })

  it('saves a preset scheme through the effect dialog', () => {
    const b = mount('system', { backgroundEffect: 'gradient' })
    const effectSection = screen.getByRole('heading', { name: COPY['effect.title'] }).closest('section')!
    fireEvent.click(within(effectSection).getByRole('button', { name: COPY['effect.configure'] }))
    fireEvent.click(screen.getByRole('radio', { name: COPY['effect.preset.aurora'] }))
    fireEvent.click(screen.getByRole('button', { name: COPY['effect.save'] }))
    expect(b.setWallpaper).toHaveBeenLastCalledWith({
      backgroundEffectPreset: 'aurora',
      backgroundEffectColors: ['', '', '#34d399', '#22d3ee', '#a78bfa', '#4ade80', '#38bdf8'],
      backgroundEffectSpeed: 190,
      backgroundEffectCount: 5,
      backgroundEffectVariant: 'orbs',
    })
  })

  it('saves custom scheme edits through the effect dialog', () => {
    const b = mount('system', { backgroundEffect: 'gradient' })
    const effectSection = screen.getByRole('heading', { name: COPY['effect.title'] }).closest('section')!
    fireEvent.click(within(effectSection).getByRole('button', { name: COPY['effect.configure'] }))
    fireEvent.click(screen.getByRole('radio', { name: COPY['effect.preset.custom'] }))
    fireEvent.change(screen.getByRole('slider', { name: COPY['effect.speed'] }), { target: { value: '160' } })
    fireEvent.change(screen.getByLabelText(`${COPY['effect.colorBloom']} 2`), { target: { value: '#112233' } })
    fireEvent.click(screen.getByRole('button', { name: COPY['effect.variant'] }))
    fireEvent.click(screen.getByRole('menuitem', { name: COPY['effect.variant.chaos'] }))
    fireEvent.click(screen.getByRole('button', { name: COPY['effect.save'] }))
    // The draft starts from the shipped aurora scheme; the color edit lands on it.
    expect(b.setWallpaper).toHaveBeenLastCalledWith({
      backgroundEffectPreset: 'custom',
      backgroundEffectColors: ['', '', '#34d399', '#112233', '#a78bfa', '#4ade80', '#38bdf8'],
      backgroundEffectSpeed: 160,
      backgroundEffectCount: 5,
      backgroundEffectVariant: 'chaos',
    })
  })

  it('previews the draft shape, speed, and count before saving', () => {
    const b = mount('system', { backgroundEffect: 'gradient' })
    const effectSection = screen.getByRole('heading', { name: COPY['effect.title'] }).closest('section')!
    fireEvent.click(within(effectSection).getByRole('button', { name: COPY['effect.configure'] }))
    fireEvent.click(screen.getByRole('radio', { name: COPY['effect.preset.sunset'] }))
    fireEvent.change(screen.getByRole('slider', { name: COPY['effect.speed'] }), { target: { value: '300' } })
    fireEvent.change(screen.getByRole('slider', { name: COPY['effect.count'] }), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: COPY['effect.variant'] }))
    fireEvent.click(screen.getByRole('menuitem', { name: COPY['effect.variant.rays'] }))

    const preview = screen.getByRole('img', { name: COPY['effect.gradient'] })
    expect(preview.id).toBe('dsh-gradient-preview')
    expect(preview.style.getPropertyValue('--dsh-gradient-1')).toBe('#fb923c')
    expect(preview.dataset.variant).toBe('rays')
    expect(preview.style.getPropertyValue('--dsh-gradient-speed')).toBe('3')
    expect([...preview.querySelectorAll<HTMLElement>('[data-blob]')].map(blob => blob.hidden))
      .toEqual([false, true, true, true, true])
    expect(screen.getByRole('radio', { name: COPY['effect.preset.custom'] }).getAttribute('aria-checked')).toBe('true')
    expect(b.setWallpaper).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: COPY['effect.cancel'] }))
    expect(b.setWallpaper).not.toHaveBeenCalled()
  })

  it('keeps background effect draft edits across unrelated theme publishes', () => {
    const b = mount('system', { backgroundEffect: 'gradient' })
    const effectSection = screen.getByRole('heading', { name: COPY['effect.title'] }).closest('section')!
    fireEvent.click(within(effectSection).getByRole('button', { name: COPY['effect.configure'] }))
    fireEvent.change(screen.getByRole('slider', { name: COPY['effect.speed'] }), { target: { value: '300' } })
    fireEvent.change(screen.getByRole('slider', { name: COPY['effect.count'] }), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: COPY['effect.variant'] }))
    fireEvent.click(screen.getByRole('menuitem', { name: COPY['effect.variant.rays'] }))

    act(() => { b.store.actions.sync(snap({ glassOpacity: 61 }), 1) })

    const preview = screen.getByRole('img', { name: COPY['effect.gradient'] })
    expect(preview.dataset.variant).toBe('rays')
    expect(preview.style.getPropertyValue('--dsh-gradient-speed')).toBe('3')
    expect([...preview.querySelectorAll<HTMLElement>('[data-blob]')].map(blob => blob.hidden))
      .toEqual([false, true, true, true, true])
    expect(b.setWallpaper).not.toHaveBeenCalled()
  })

  it('reloads stored background effect values when the dialog reopens', () => {
    const b = mount('system', { backgroundEffect: 'gradient' })
    const effectSection = screen.getByRole('heading', { name: COPY['effect.title'] }).closest('section')!
    fireEvent.click(within(effectSection).getByRole('button', { name: COPY['effect.configure'] }))
    fireEvent.change(screen.getByRole('slider', { name: COPY['effect.speed'] }), { target: { value: '300' } })
    fireEvent.click(screen.getByRole('button', { name: COPY['effect.cancel'] }))
    act(() => {
      b.store.actions.sync(snap({
        backgroundEffect: 'gradient', backgroundEffectSpeed: 120,
        backgroundEffectCount: 2, backgroundEffectVariant: 'aurora',
      }), 1)
    })
    fireEvent.click(within(effectSection).getByRole('button', { name: COPY['effect.configure'] }))
    const preview = screen.getByRole('img', { name: COPY['effect.gradient'] })
    expect(preview.dataset.variant).toBe('aurora')
    expect(preview.style.getPropertyValue('--dsh-gradient-speed')).toBe('1.2')
    expect([...preview.querySelectorAll<HTMLElement>('[data-blob]')].map(blob => blob.hidden))
      .toEqual([false, false, true, true, true])
    expect(b.setWallpaper).not.toHaveBeenCalled()
  })

  it('toggles the pointer effect through setCursorFx', () => {
    const b = mount('system')
    fireEvent.click(screen.getByRole('switch', { name: COPY['cursorFx.title'] }))
    expect(b.setCursorFx).toHaveBeenCalledWith({ cursorEffectEnabled: true })
  })

  it('toggles the button sheen through setMetallicPaint', () => {
    const b = mount('system', { metallicPaintEnabled: true })
    fireEvent.click(screen.getByRole('switch', { name: COPY['metallicPaint.title'] }))
    expect(b.setMetallicPaint).toHaveBeenCalledWith(false)
  })

  it('saves the chosen effect and preset scheme through the cursor dialog', () => {
    const b = mount('system', { cursorEffectEnabled: true })
    const section = screen.getByRole('heading', { name: COPY['cursorFx.title'] }).closest('section')!
    fireEvent.click(within(section).getByRole('button', { name: COPY['effect.configure'] }))
    fireEvent.click(screen.getByRole('radio', { name: COPY['cursorFx.kind.splash'] }))
    fireEvent.click(screen.getByRole('radio', { name: COPY['cursorFx.preset.ocean'] }))
    fireEvent.click(screen.getByRole('button', { name: COPY['effect.save'] }))
    expect(b.setCursorFx).toHaveBeenLastCalledWith({
      cursorEffectEnabled: true,
      cursorEffect: 'splash',
      cursorEffectPreset: 'ocean',
      cursorEffectColors: ['#38bdf8', '#2dd4bf', '#60a5fa', '#818cf8', '#22d3ee', '#67e8f9'],
      cursorEffectSpeed: 100,
      cursorEffectSize: 100,
    })
  })

  it('keeps the cursor draft when a theme publish lands while the dialog is open', () => {
    const b = mount('system', { cursorEffectEnabled: true })
    const section = screen.getByRole('heading', { name: COPY['cursorFx.title'] }).closest('section')!
    fireEvent.click(within(section).getByRole('button', { name: COPY['effect.configure'] }))
    fireEvent.click(screen.getByRole('radio', { name: COPY['cursorFx.preset.ocean'] }))
    act(() => { b.store.actions.sync(snap({ cursorEffectPreset: 'aurora', glassOpacity: 61 }), 1) })
    expect(screen.getByRole('radio', { name: COPY['cursorFx.preset.ocean'] }).getAttribute('aria-checked')).toBe('true')
  })

  it('restores stored values and a fresh canvas when the cursor dialog reopens', async () => {
    const b = mount('system', { cursorEffectEnabled: true })
    const section = screen.getByRole('heading', { name: COPY['cursorFx.title'] }).closest('section')!
    const open = () => { fireEvent.click(within(section).getByRole('button', { name: COPY['effect.configure'] })) }
    open()
    const firstCanvas = document.querySelector('[role=dialog] canvas')
    fireEvent.click(screen.getByRole('radio', { name: COPY['cursorFx.kind.splash'] }))
    const switchedCanvas = document.querySelector('[role=dialog] canvas')
    expect(switchedCanvas === firstCanvas).toBe(false)
    fireEvent.click(screen.getByRole('radio', { name: COPY['cursorFx.preset.ocean'] }))
    fireEvent.click(screen.getByRole('button', { name: COPY['effect.cancel'] }))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)) })
    open()
    expect(screen.getByRole('radio', { name: COPY['cursorFx.kind.trail'] }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: COPY['cursorFx.preset.default'] }).getAttribute('aria-checked')).toBe('true')
    expect(b.setCursorFx).not.toHaveBeenCalled()
  })

  it('marks the cursor scheme custom after a custom edit', () => {
    const b = mount('system', { cursorEffectEnabled: true })
    const section = screen.getByRole('heading', { name: COPY['cursorFx.title'] }).closest('section')!
    fireEvent.click(within(section).getByRole('button', { name: COPY['effect.configure'] }))
    fireEvent.change(screen.getByRole('slider', { name: COPY['cursorFx.speed'] }), { target: { value: '160' } })
    fireEvent.change(screen.getByLabelText(`${COPY['cursorFx.color']} 2`), { target: { value: '#112233' } })
    fireEvent.click(screen.getByRole('button', { name: COPY['effect.save'] }))
    expect(b.setCursorFx).toHaveBeenLastCalledWith({
      cursorEffectEnabled: true,
      cursorEffect: 'trail',
      cursorEffectPreset: 'custom',
      cursorEffectColors: ['', '#112233', '', '', '', ''],
      cursorEffectSpeed: 160,
      cursorEffectSize: 100,
    })
  })

  it('resets, strokes the preview, and cancels the cursor dialog without writing', () => {
    const b = mount('system', { cursorEffectEnabled: true })
    const section = screen.getByRole('heading', { name: COPY['cursorFx.title'] }).closest('section')!
    fireEvent.click(within(section).getByRole('button', { name: COPY['effect.configure'] }))
    const dialog = screen.getByRole('dialog', { name: COPY['cursorFx.title'] })
    fireEvent.click(within(dialog).getByRole('radio', { name: COPY['cursorFx.preset.custom'] }))
    fireEvent.change(within(dialog).getByRole('slider', { name: COPY['cursorFx.size'] }), { target: { value: '180' } })
    const preview = within(dialog).getByText(COPY['cursorFx.previewHint']).parentElement as HTMLElement
    fireEvent.pointerMove(preview, { clientX: 12, clientY: 12 })
    fireEvent.pointerDown(preview, { clientX: 12, clientY: 12 })
    fireEvent.click(within(dialog).getByRole('button', { name: COPY['reset'] }))
    expect(within(dialog).getByRole('slider', { name: COPY['cursorFx.size'] }).value).toBe('100')
    fireEvent.click(within(dialog).getByRole('button', { name: COPY['effect.cancel'] }))
    expect(b.setCursorFx).not.toHaveBeenCalled()
  })

  it('resolves a var()-chained accent for the empty cursor color slots', () => {
    const real = window.getComputedStyle.bind(window)
    const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element, pseudo?: string | null) => {
      const style = real(element, pseudo)
      if (element !== document.body) return style
      return new Proxy(style, {
        get: (target, prop) => prop === 'getPropertyValue'
          ? (name: string) => name === '--dsw-alias-brand-primary'
            ? 'var(--brand-deep)'
            : name === '--brand-deep' ? '#1A2B3C' : target.getPropertyValue(name)
          : target[prop as keyof CSSStyleDeclaration],
      })
    })
    try {
      mount('system', { cursorEffectEnabled: true })
      const section = screen.getByRole('heading', { name: COPY['cursorFx.title'] }).closest('section')!
      fireEvent.click(within(section).getByRole('button', { name: COPY['effect.configure'] }))
      expect(screen.getByLabelText(`${COPY['cursorFx.color']} 1`).value).toBe('#1a2b3c')
    } finally {
      spy.mockRestore()
    }
  })

  it('renders feature-owned appearance item rows after the fixed controls', () => {
    mount('system', {}, undefined, name =>
      name === 'settings.appearance.item' ? <div data-testid="appearance-item" /> : null)
    const item = screen.getByTestId('appearance-item')
    // Feature rows stack after the last fixed section (typography).
    const typography = screen.getByText(COPY['type.title'])
    expect(typography.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
