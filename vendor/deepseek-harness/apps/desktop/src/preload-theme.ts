/** Mirrors the Web UI's theme source into Electron's native theme so native chrome and Platform login pages follow the app palette. */

import { ipcRenderer } from 'electron'
import { DESKTOP_IPC } from './ipc.ts'

/** Root attribute written by the Web UI's theme bootstrap and presenter (ui-theme / ui-layout). */
const THEME_SOURCE_ATTRIBUTE = 'data-ds-theme-source'

/**
 * Watches `html[data-ds-theme-source]` and forwards each value to the main
 * process, which sets `nativeTheme.themeSource`. Native chrome and renderer
 * `prefers-color-scheme` queries on every platform then follow the app's
 * theme preference instead of the OS appearance while `system` keeps
 * following the OS; the macOS sidebar vibrancy material is one such consumer.
 * The main process reads the same value back as `shouldUseDarkColors` when a
 * Platform login link needs the resolved palette.
 */
export function syncNativeTheme(): void {
  let sent: string | undefined
  const send = (): void => {
    const value = document.documentElement.getAttribute(THEME_SOURCE_ATTRIBUTE)
    if (value === null || value === sent) return
    sent = value
    ipcRenderer.send(DESKTOP_IPC.nativeThemeSet, value)
  }
  const observe = (): void => {
    new MutationObserver(send).observe(document.documentElement, { attributeFilter: [THEME_SOURCE_ATTRIBUTE] })
    send()
  }
  // The preload runs before the document root exists; the theme bootstrap
  // script writes the attribute before DOMContentLoaded.
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', observe, { once: true })
  else observe()
}

/** Root attribute marking a window that can host the native acrylic material. */
const WINDOW_MATERIAL_SUPPORTED_ATTRIBUTE = 'data-window-material-supported'

/** Root attribute the Web UI sets while it wants the acrylic window material. */
const WINDOW_MATERIAL_ATTRIBUTE = 'data-dsh-window-material'

/** `additionalArguments` flag the main process passes to material-capable windows. */
const WINDOW_MATERIAL_ARGUMENT = '--dsh-window-material=acrylic'

/**
 * Marks `html[data-window-material-supported]` when the main process
 * advertised the acrylic material, then mirrors
 * `html[data-dsh-window-material]` back so the frame material follows the
 * Appearance toggle at runtime: `acrylic` while the attribute is present,
 * `none` once it clears. On unsupported hosts the mark and the observer are
 * never installed, so an inert renderer request cannot reach the frame.
 */
export function syncWindowMaterial(argv: readonly string[] = process.argv): void {
  if (!argv.includes(WINDOW_MATERIAL_ARGUMENT)) return
  let sent: string | undefined
  const send = (): void => {
    const value = document.documentElement.getAttribute(WINDOW_MATERIAL_ATTRIBUTE) === 'acrylic' ? 'acrylic' : 'none'
    if (value === sent) return
    sent = value
    ipcRenderer.send(DESKTOP_IPC.windowMaterialSet, value)
  }
  const install = (): boolean => {
    // lib.dom types documentElement non-null, but a preload runs before the
    // document root exists.
    const root = document.documentElement as HTMLElement | null
    if (root === null) return false
    // The support mark lands before the observer so the theme bootstrap
    // script sees it ahead of first paint.
    root.setAttribute(WINDOW_MATERIAL_SUPPORTED_ATTRIBUTE, '')
    new MutationObserver(send).observe(root, { attributeFilter: [WINDOW_MATERIAL_ATTRIBUTE] })
    send()
    return true
  }
  // The theme bootstrap script reads the mark during parsing, before
  // DOMContentLoaded, so install as soon as the root element lands.
  if (install()) return
  const watcher = new MutationObserver(() => {
    if (install()) watcher.disconnect()
  })
  watcher.observe(document, { childList: true })
}
