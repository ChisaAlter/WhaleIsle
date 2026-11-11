# Mobile Connect Horizon, 2026-09-29

Feature: `mobile-remote`. Scope is the pre-connection WebView, native permission screen, native CameraX scan entry, and the readable saved-computer name. Paired chat keeps the existing mobile structure.

## Device evidence

- Device: `23124RN87C`, serial `9TUCYX8TBI6DLRMZ`.
- Installation: `adb install -r` of the final debug APK, without uninstalling or clearing app data; cold launch completed successfully.
- [light-final.png](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-mobile-connect-horizon/light-final.png): final `20260929-connect-horizon-v2` APK WebView with the light mist-sky / blue-sea canvas and saved-device reconnect row.
- [dark-final.png](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-mobile-connect-horizon/dark-final.png): the same final APK WebView with the dark star-sky / deep-sea canvas and recoverable connection failure.
- [scan-final.png](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-mobile-connect-horizon/scan-final.png): the WebView primary action opened the native CameraX scanner, with the themed frame and paste fallback.
- [paste-final.png](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-mobile-connect-horizon/paste-final.png): tapping the native scanner's paste fallback returned to Connect, expanded and focused the input, and opened the software keyboard (`dumpsys input_method`: `mInputShown=true`).
- [readable-computer-name-device.png](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-mobile-connect-horizon/readable-computer-name-device.png): the final `20260929-readable-computer-name-v3` APK preserved the legacy sticky while replacing the protocol-internal `srv_*` title with `我的电脑`.
- [readable-computer-name-reconnect.png](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-mobile-connect-horizon/readable-computer-name-reconnect.png): the same readable fallback remained after restarting the desktop app and retrying the saved relay.

## Automated evidence

- `mobile/web/**/*.test.js`: 307 passed, 0 failed, including behavioral native-UA / browser-UA scan routing, saved-computer naming, and storage-failure tolerance.
- `tools/mobile-web-qa/run-connect-qa.mjs`: 320px, 390px, and 1280px passed auto-connect, failure cleanup, legacy sticky fallback, hidden `srv_*` identifiers, superseded retry, chat entry, and consumed-fragment clearing.
- Android `:protocol:test :app:testDebugUnitTest :app:assembleDebug`: passed.
- [apk-audit.json](apk-audit.json): 48 Web runtime files match the current source and embedded manifest; no missing, changed, or unexpected assets. APK SHA-256: `ee32008acdd97138b25330ce81195d0b268ee090a7860697c3d4a9eb85df42ac`.

## Boundary

This is a local debug APK and focused connection-entry acceptance. The preserved relay timed out during this run, so real-device fallback rendering is proven while the upgrade from `我的电脑` to a live `server_info.hostname` is covered by connection tests rather than a live relay. It does not certify the production signature, a signed upgrade, the public relay, or the complete paired-chat T3 matrix.
