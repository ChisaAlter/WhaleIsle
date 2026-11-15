/** Windows window material support: the native acrylic frame material. */

import { release } from 'node:os'
import type { BrowserWindow } from 'electron'

/** `additionalArguments` flag the app preload reads to mark acrylic support. */
export const WINDOW_MATERIAL_ARGUMENT = '--dsh-window-material=acrylic'

/** First Windows build whose frame can host the acrylic material (Windows 11 22H2). */
export const ACRYLIC_MINIMUM_WINDOWS_BUILD = 22621

/**
 * Whether this machine can host the native acrylic window material: Windows
 * 11 22H2 or newer, reported as `os.release()` build 22621 or higher.
 * @param platform - operating system hosting Electron.
 * @param osRelease - `os.release()` value (`10.0.<build>` on Windows).
 * @returns true when `setBackgroundMaterial('acrylic')` is honored.
 */
export function windowsAcrylicSupported(
  platform: NodeJS.Platform = process.platform,
  osRelease: string = release(),
): boolean {
  if (platform !== 'win32') return false
  const build = Number(osRelease.split('.')[2])
  return Number.isInteger(build) && build >= ACRYLIC_MINIMUM_WINDOWS_BUILD
}

/** Frame material the renderer may request over `windowMaterialSet`. */
export type WindowMaterial = 'acrylic' | 'none'

/** Opaque caption palette the material swap restores when acrylic turns off. */
export interface WindowChromeColors {
  /** Opaque window base and caption strip fill. */
  color: string
  /** Caption glyph color. */
  symbolColor: string
}

/**
 * Swap the primary window between the native acrylic material and the
 * opaque chrome, keeping the hidden title bar's overlay in step so the
 * caption strip never paints a stale fill over the transparent frame. The
 * acrylic branch keeps the strip transparent and only repaints its glyphs;
 * the `none` branch restores the given chrome palette.
 * @param window - primary window owned by the sender.
 * @param material - requested material.
 * @param chrome - opaque caption palette: the last colors the document
 *   reported over `windowsAppearance`, or the chrome fallback before the
 *   first report.
 * @param titleBarHeight - window-controls overlay height.
 */
export function applyWindowMaterial(
  window: BrowserWindow,
  material: WindowMaterial,
  chrome: WindowChromeColors,
  titleBarHeight: number,
): void {
  if (material === 'acrylic') {
    window.setBackgroundMaterial('acrylic')
    window.setBackgroundColor('#00000000')
    window.setTitleBarOverlay({ color: '#00000000', symbolColor: chrome.symbolColor, height: titleBarHeight })
    return
  }
  window.setBackgroundMaterial('none')
  window.setBackgroundColor(chrome.color)
  window.setTitleBarOverlay({ color: chrome.color, symbolColor: chrome.symbolColor, height: titleBarHeight })
}
