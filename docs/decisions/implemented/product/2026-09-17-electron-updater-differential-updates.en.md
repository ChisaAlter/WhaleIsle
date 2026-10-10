# Decision: electron-updater differential channel for latest-version updates

Status: implemented

2026-10-09 update: users explicitly choose incremental or full download. Differential failure no longer starts a full transfer; missing cache or metadata is explained before selection. The original decision follows below; current behavior and verification/install protection are documented in [Tray, close and updates](../../../handbook/modules/tray-update.md).

[中文](2026-09-17-electron-updater-differential-updates.md) | English

## Problem

Every desktop upgrade downloaded the full ~636 MB NSIS Setup via `downloadFile`, even though adjacent releases leave most chunks unchanged. electron-builder already emits a `.exe.blockmap` chunk manifest that ships with every Release asset, but no client consumed it; users paid a full installer download for a one-line change.

## Decision

The "update to latest" path now routes through `electron-updater` (pinned `6.8.9`) for blockmap differential downloads, with the original whole-file download + SHA512SUMS verification kept intact as fallback:

1. **Release pipeline**: `build.publish` changed from `null` to the GitHub provider (metadata only, no `--publish`), so electron-builder emits `resources/app-update.yml` and `dist/latest.yml`; `release.yml` artifacts and the `publish.yml` asset/validation contract now include `latest.yml` (exactly one, hashed into SHA512SUMS).
2. **New module `src/main/update-updater.js`**: `downloadLatestViaUpdater` lazily loads `electron-updater` only on packaged Windows. A missing manifest version returns `no-update-in-manifest`; download progress keeps the existing payload with a `differential` marker (the downloader's report is authoritative; absent means full). The fifteen-minute budget explicitly passes `CancellationToken` into `downloadUpdate(token)`; download failure returns `{ok:false, reason}` for fallback. Success returns an installer path. After checking target version and release SHA512, `update.js` observes spawn inside the task-protection commit with the existing `--updated /S --force-run` silent arguments. Launch failure reports an error and releases admission without attempting installation again. See [project audit repairs](../bug-fix/2026-09-30-project-audit-fixes.en.md).
3. **Seam in `installFromAsset`**: `installUpdate` (latest) tries the updater channel first via `preferUpdater`; non-packaged, non-Windows, or any updater failure falls back to the existing `downloadFile` + sha512 path with identical confirmation and verification semantics. `installRelease` (pinned tag) never passes the flag — electron-updater only installs the version `latest.yml` points at, so pinned versions stay whole-file.
4. **Differential COPY source**: the NSIS installer self-copies into `%LOCALAPPDATA%\<app>-updater\installer.exe` at install time; the differential downloader uses that file as the old-package chunk source rather than depending on installed-file readability. Missing cache → electron-updater falls back to full automatically.
5. **Installer UAC**: `installer.nsh` `customInit` gains a per-machine elevation block (`UAC_RunElevated` single prompt, validates exit code and Inner-instance hash) covering differential installation for non-admin accounts targeting Program Files.
6. **Launcher**: progress payloads with `differential` render as "增量下载 N%"; whole-file keeps "下载 N%".

## Alternatives considered

- **Hand-rolled blockmap + HTTP Range downloader** — rejected: equivalent to re-implementing `GenericDifferentialDownloader` (chunk-table parsing, COPY/DOWNLOAD planning, reassembly, fallback) — thousands of battle-tested lines traded for a bespoke copy.
- **`nsis-web` target (7z-sharded web installer)** — rejected: adds a `*-0.3.x.7z` asset channel and a second downloader, and moves integrity checking to install time instead of download time, weakening the existing fail-closed chain.
- **app.asar-level increment (unpacked diff)** — rejected: NSIS diffing already reuses unchanged installer chunks (asar included); patching installed files must handle locked files and integrity for similar gain at higher complexity.
- **Pinned-tag installs through the updater** — rejected: electron-updater can only install the version `latest.yml` points at; faking per-tag manifests means building a custom feed pipeline, while `installRelease` stays honest and simple as whole-file.
- **Requiring differential on first run** — rejected: installs predating v0.3.2 have no self-copied cache, so the first hop is full by nature; making "cache present" a hard condition would only make the upgrade path more brittle. NSIS self-copy makes v0.3.2→v0.3.3 differential-capable with no extra bootstrap.

## Consequences

- Savings scale with the release delta: business-code-only releases reuse the bulk of Setup chunks (Electron runtime, vendored harness), cutting the download to tens of MB; an Electron major bump approaches a full download. Every failure mode is no worse than today — worst case is the whole-file fallback.
- Disk cost: `%LOCALAPPDATA%\deepseek-harness-desktop-updater\` permanently holds one old installer (~640 MB) as the differential source.
- Integrity contract unchanged: `latest.yml`'s embedded sha512 verifies the same chain as `SHA512SUMS.txt`; the fallback path's checksum/confirmation semantics are preserved verbatim. No code signing: electron-updater warns and skips signature checks on unsigned packages (fail-open, equivalent to today); electron-builder v28 makes this fail-closed — signing must be addressed before upgrading that toolchain.
- Release asset contract is now a trio: Setup + `.blockmap` + `latest.yml` (`publish.yml` hard-checks exactly one of each). The old v0.3.2 candidate (run 35212201134) lacks `latest.yml` and no longer satisfies the contract — a fresh candidate on the new SHA is required before publishing.
- The `desktop-launcher` feature card gains a differential-channel invariant; `.omc/RELEASE_RULE.md`'s asset list is updated in sync.
