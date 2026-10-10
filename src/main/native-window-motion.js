// Keep the page-painted alpha silhouette AND the Win32 styles DWM animates.
// Electron drops caption/thick-frame styles for transparent frameless windows;
// changing the window to opaque would silently replace our 20px corners.
const nativeMotionWindows = new WeakMap();
const GWL_STYLE = -16;
const MOTION_STYLES = 0x00c40000; // WS_CAPTION | WS_THICKFRAME
const FRAME_CHANGED = 0x0037; // NOSIZE | NOMOVE | NOZORDER | NOACTIVATE | FRAMECHANGED
const DWMWA_NCRENDERING_POLICY = 2;
const DWMNCRP_DISABLED = 1;
const WM_DWMNCRENDERINGCHANGED = 0x031f;
let api;

function windowsApi() {
  if (!api) {
    const user32 = require('koffi').load('user32.dll');
    const dwmapi = require('koffi').load('dwmapi.dll');
    api = {
      getStyle: user32.func('int __stdcall GetWindowLongW(uintptr_t hwnd, int index)'),
      setStyle: user32.func('int __stdcall SetWindowLongW(uintptr_t hwnd, int index, int value)'),
      frameChanged: user32.func('bool __stdcall SetWindowPos(uintptr_t hwnd, uintptr_t after, int x, int y, int cx, int cy, uint flags)'),
      isZoomed: user32.func('bool __stdcall IsZoomed(uintptr_t hwnd)'),
      showWindow: user32.func('bool __stdcall ShowWindowAsync(uintptr_t hwnd, int command)'),
      setDwmAttribute: dwmapi.func('int __stdcall DwmSetWindowAttribute(uintptr_t hwnd, uint attribute, uint *value, uint size)'),
    };
  }
  return api;
}

function suppressNonClientRendering(hwnd, bridge) {
  const result = bridge.setDwmAttribute(hwnd, DWMWA_NCRENDERING_POLICY, [DWMNCRP_DISABLED], 4);
  if (result !== 0) {
    throw new Error(`Cannot disable native non-client rendering (${result})`);
  }
}

function enableNativeWindowMotion(win, { platform = process.platform, loadApi = windowsApi } = {}) {
  if (platform !== 'win32' || win.isDestroyed()) return false;
  const handle = win.getNativeWindowHandle();
  const hwnd = handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE());
  const bridge = loadApi();
  const original = bridge.getStyle(hwnd, GWL_STYLE);
  const desired = original | MOTION_STYLES;
  if (original !== desired) {
    bridge.setStyle(hwnd, GWL_STYLE, desired);
    if (!bridge.frameChanged(hwnd, 0, 0, 0, 0, 0, FRAME_CHANGED)) {
      throw new Error('Cannot apply native window motion styles');
    }
  }
  if ((bridge.getStyle(hwnd, GWL_STYLE) & MOTION_STYLES) !== MOTION_STYLES) {
    throw new Error('Native window motion styles did not persist');
  }
  // The style bits enable animations but also make DWM draw a rectangular
  // non-client surface behind the alpha corners. Suppress that surface AFTER
  // FRAMECHANGED; keep the style bits and DWM transition policy untouched.
  suppressNonClientRendering(hwnd, bridge);
  if (!nativeMotionWindows.has(win)) {
    // DWM reports subsequent changes independently of Electron's page paint.
    // Restore the alpha-corner contract when native frame painting turns on.
    // The resulting disabled notification is ignored, so this cannot loop.
    let pending = false;
    win.hookWindowMessage(WM_DWMNCRENDERINGCHANGED, (wParam) => {
      if (win.isDestroyed() || !wParam.readUInt32LE(0) || pending) return;
      pending = true;
      // The notification can arrive inside the operation enabling DWM paint.
      // Apply our policy after that operation commits, not reentrantly.
      setImmediate(() => {
        pending = false;
        if (!win.isDestroyed()) suppressNonClientRendering(hwnd, bridge);
      });
    });
  }
  nativeMotionWindows.set(win, { hwnd, bridge });
  return true;
}

function hasNativeWindowMotion(win) {
  return nativeMotionWindows.has(win);
}

function isNativeWindowMaximized(win) {
  const native = nativeMotionWindows.get(win);
  if (!native || win.isDestroyed()) return undefined;
  return native.bridge.isZoomed(native.hwnd);
}

function toggleNativeMaximize(win) {
  const native = nativeMotionWindows.get(win);
  if (!native || win.isDestroyed()) return false;
  // Electron's transparent-window maximize can only set work-area bounds.
  // Ask Windows to transition its actual window state so DWM animates it.
  const command = native.bridge.isZoomed(native.hwnd) ? 9 : 3; // SW_RESTORE / SW_MAXIMIZE
  if (!native.bridge.showWindow(native.hwnd, command)) {
    throw new Error('Cannot request native maximize/restore');
  }
  return true;
}

module.exports = { enableNativeWindowMotion, hasNativeWindowMotion, isNativeWindowMaximized, toggleNativeMaximize };
