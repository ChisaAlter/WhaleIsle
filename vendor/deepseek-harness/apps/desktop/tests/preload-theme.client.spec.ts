// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { DESKTOP_IPC } from '../src/ipc.ts'
import { syncNativeTheme, syncWindowMaterial } from '../src/preload-theme.ts'

const send = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ ipcRenderer: { send } }))

/** Observers created by the module under test; jsdom keeps one document per file. */
const observers = new Set<MutationObserver>()
const NativeMutationObserver = MutationObserver

/** Records every observer so teardown detaches it from the shared document. */
class TrackedMutationObserver extends NativeMutationObserver {
  constructor(callback: MutationCallback) {
    super(callback)
    observers.add(this)
  }
}

afterEach(() => {
  for (const observer of observers) observer.disconnect()
  observers.clear()
  document.documentElement.removeAttribute('data-ds-theme-source')
  document.documentElement.removeAttribute('data-dsh-window-material')
  document.documentElement.removeAttribute('data-window-material-supported')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  send.mockClear()
})

it.each(['darwin', 'win32'] as const)('mirrors the application theme source on %s', async (platform) => {
  vi.stubGlobal('MutationObserver', TrackedMutationObserver)
  vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
  document.documentElement.setAttribute('data-ds-theme-source', 'dark')
  syncNativeTheme()
  expect(send).toHaveBeenCalledExactlyOnceWith(DESKTOP_IPC.nativeThemeSet, 'dark')
  document.documentElement.setAttribute('data-ds-theme-source', 'system')
  await vi.waitFor(() => { expect(send).toHaveBeenLastCalledWith(DESKTOP_IPC.nativeThemeSet, 'system') })
  expect(send).toHaveBeenCalledTimes(2)
})

it('defers observation until the document root exists', () => {
  vi.stubGlobal('MutationObserver', TrackedMutationObserver)
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
  syncNativeTheme()
  expect(send).not.toHaveBeenCalled()
  document.documentElement.setAttribute('data-ds-theme-source', 'light')
  window.dispatchEvent(new Event('DOMContentLoaded'))
  expect(send).toHaveBeenCalledExactlyOnceWith(DESKTOP_IPC.nativeThemeSet, 'light')
})

it('marks support and mirrors the window material attribute over IPC', async () => {
  vi.stubGlobal('MutationObserver', TrackedMutationObserver)
  syncWindowMaterial(['node', 'app', '--dsh-window-material=acrylic'])
  expect(document.documentElement.hasAttribute('data-window-material-supported')).toBe(true)
  expect(send).toHaveBeenCalledExactlyOnceWith(DESKTOP_IPC.windowMaterialSet, 'none')
  document.documentElement.setAttribute('data-dsh-window-material', 'acrylic')
  await vi.waitFor(() => { expect(send).toHaveBeenLastCalledWith(DESKTOP_IPC.windowMaterialSet, 'acrylic') })
  document.documentElement.removeAttribute('data-dsh-window-material')
  await vi.waitFor(() => { expect(send).toHaveBeenLastCalledWith(DESKTOP_IPC.windowMaterialSet, 'none') })
  expect(send).toHaveBeenCalledTimes(3)
})

it('stays inert without the material argument', () => {
  vi.stubGlobal('MutationObserver', TrackedMutationObserver)
  syncWindowMaterial(['node', 'app'])
  expect(document.documentElement.hasAttribute('data-window-material-supported')).toBe(false)
  expect(send).not.toHaveBeenCalled()
  expect(observers.size).toBe(0)
})
