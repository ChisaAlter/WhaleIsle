# Mobile Runtime Packaging And QA

These tools do not deploy Web files, install an APK, clear application data, or sign a production release.

## Fixture Server

```powershell
node tools/mobile-web-qa/server.mjs --port 0 --prefix /dshd/
```

The printed URL contains the actual OS-assigned port. Use that URL in T3 preview; the server does not launch a browser. The prefixed mount redirects `/dshd` to `/dshd/`, serves relative resources with their MIME types and `no-store`, and swaps only `chisacode/daemon-client.bundle.js` for the fake host client. It is a loopback-only fixture, never a deployable runtime.

Existing `startQaServer()` and `startQaServer(port)` callers retain root mounting and default port 3180. New callers can pass `{ port: 0, prefix: '/dshd/' }` and obtain the URL with `qaServerUrl(server)`.

The standalone browser runner accepts `--port`, `--prefix`, and `--screenshots DIR`:

```powershell
# Prerequisites: run `npm run setup` once (installs playwright-core under vendor/chisacode-remote)
# and have Chrome or Edge installed (or set CHROME_PATH; optional PLAYWRIGHT_CORE_PATH override).
node tools/mobile-web-qa/run-qa.mjs
```

`run-qa.mjs` launches headless Chromium via `playwright-core` (reusing the `vendor/chisacode-remote` dependency without extra npm installs) and stores screenshots in an OS temporary directory that is cleaned up automatically on exit unless `--screenshots <dir>` is explicitly passed. It is a separate fake-daemon reproducibility entrypoint, not the T3 live preview workflow.

## Runtime Contract

`runtime-assets.mjs` walks the HTML entry, then uses the existing vendored esbuild to validate the complete static/literal-dynamic ESM and CSS dependency graph. HTML is parsed by existing vendored parse5; APK ZIP entries are decompressed with existing vendored yauzl. No dependencies are installed or upgraded. The vendor development installation used by the existing mobile bundle script must be present.

Only reachable resources are copied, byte-for-byte. Tests, fixtures, development entrypoints, package metadata, sourcemaps and unreachable old modules are excluded. Imports must name real relative files, with explicit extensions; missing imports, external runtime assets, nonliteral dynamic imports and references to development files fail the build. HTML uses external scripts and simple references, without base/srcset. Arbitrary runtime-computed asset URLs are not inferred: a new asset-loading mechanism requires extending this contract and its tests before shipping.

The sorted `mobile-web-runtime-manifest.json` contains byte lengths and SHA-256 hashes, without timestamps or machine paths. Gradle's `stageMobileWebAssets` generates `mobile/android/app/build/generated/mobileWebAssets/`; all Android variants consume that generated directory instead of the raw Web source directory. Restaging removes stale generated files. The application ID and WebView asset origin remain unchanged.

```powershell
node tools/mobile-web-qa/runtime-assets.mjs manifest --report tools/mobile-web-qa/results/candidate/web-manifest.json
node tools/mobile-web-qa/runtime-assets.mjs stage --output tools/mobile-web-qa/results/candidate/web
node tools/mobile-web-qa/runtime-assets.mjs audit --apk mobile/android/app/build/outputs/apk/debug/app-debug.apk --report tools/mobile-web-qa/results/candidate/apk-audit.json
```

For an already extracted APK, pass `--extracted PATH/TO/assets` instead of `--apk`. Audit compares all expected source hashes and the embedded manifest, rejects unexpected assets, and lists the known MLKit barcode model / Android baseline-profile assets separately. It rejects fake clients and tests, including old files accidentally left in an APK. Audit exits nonzero on mismatch. An APK built before a concurrent Web edit must be rebuilt, not given an updated audit manifest.

## Build Gates

```powershell
node --test tools/mobile-web-qa/server.test.mjs tools/mobile-web-qa/runtime-assets.test.mjs
$env:ANDROID_HOME = 'C:/Users/48818/AppData/Local/Android/Sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
# From mobile/android, with existing JDK 17 JAVA_HOME:
.\gradlew.bat :protocol:test :app:testDebugUnitTest :app:assembleDebug --console=plain
```

The ZIP unit test uses `jar` from `JAVA_HOME` (or PATH). No emulator, device, or browser is launched by these Node tests. Coordinate with the Android/Web workers before the final build, then run the APK audit against the final shared source revision. JVM and packaging checks do not establish Android WebView/IME/camera or production upgrade acceptance.

## Candidate Version And Signing

Android candidate: `ai.deepseek.harness.mobile`, versionCode `2`, versionName `0.1.1` (previous local APK: `1` / `0.1.0`). The desktop root package version is untouched. `assembleDebug` uses the local debug key; it is not a production-signed update.

The previous local debug APK's SHA-256 signing-certificate fingerprint was `d309640f2dd361550038a172b81a294cb8a7f847cf569eca3d5f650840b7db52` on 2026-09-06. This does **not** verify the installed production package's certificate. Production signature compatibility, authorized same-signature upgrade, pairing/draft retention and real-device behavior remain unverified. Do not uninstall, clear data, downgrade, or substitute the debug key to manufacture an upgrade pass.
