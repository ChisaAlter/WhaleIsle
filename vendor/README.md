# vendor/ — vendored source trees

Index of everything vendored into the desktop app. Per-tree provenance and
divergence notes live in each tree's own `DESKTOP-FORK.md` / `AGENTS.md`.

The desktop audit repairs Files draft/close protection, verbatim selection transfer and Session-aware path routing; remote settings now reflect effective binding/daemon ports and disclose LAN HTTP; macOS update feedback describes manual DMG installation. Build-stage credentials include helper/vendor/native inputs and actual platform outputs. See [project audit repairs](../docs/decisions/implemented/bug-fix/2026-09-30-project-audit-fixes.md).

Every tree is registered in `provenance.json` (kind / origin / source location /
rebuild / consistency spec). `npm run check:vendor` fails when a tree is
unregistered, when this table and `provenance.json` disagree, or when a checked
artifact no longer matches its source. Rebuild-derived registrations can only be
refreshed by `node scripts/check-vendor-provenance.mjs --record <dir>`, which
runs the registered rebuild first — never "accept current bytes".

| Tree | What it is | Origin | Source location | Rebuild | Artifact consistency | How the desktop uses it |
| --- | --- | --- | --- | --- | --- | --- |
| `chisacode-remote/` | Full ChisaCode AGPL source tree powering mobile pairing/relay. | `github.com/ChisaAlter/ChisaCode` (AGPL-3.0-or-later; `DESKTOP-FORK.md`) | Entire npm-workspace source tree | `npm run prepare:dshd-remote` (`packages/*/dist`, `.tmp/desktop-runtime` generated, untracked) | Source snapshot; generated output is untracked, so nothing to compare | Main process `ChisaCodeRemote` daemon (see `docs/features/mobile-remote.md` and `chisacode-remote/AGPL-SHIPPING.md`). |
| `deepseek-harness/` | Official DeepSeek Harness monorepo fork. | `github.com/deepseek-ai/deepseek-harness.git`, pinned in `harness-upstream.json` (`dsh-v0.2.2-rc.2`) | Entire tree | `npm run sync:harness` + `npm run setup:harness` | Existing pin/sync mechanism (`harness-upstream.json`, `scripts/sync-upstream.js`); this check only requires the row | The entire web UI + CLI runtime. Desktop-owned fork packages (the `DESKTOP_PACKAGES` registered in `src/shared/harness-desktop-forks.js`, e.g. `ui-settings-market`, `ui-surfaces`) live inside this tree and mount through the web-app bundle. |
| `dsh-deepseek-tools/` | Configurable speech synthesis, transcription and OCR tools plugin. | 本仓库自有 | `lib/` + `client/` + `tests/` (hand-maintained, no build) | — | None needed (no generated artifacts) | Desktop-owned Harness plugin; tested via `npm run test` / `test:deepseek-tools`. |
| `dsh-im/` | First-party build of `@xmanrui/dsh-im` (Remote → 消息渠道 IM UI). | npm `@xmanrui/dsh-im@3.0.1` (MIT) + desktop patches (`DESKTOP-FORK.md`) | `src/`, `plugin-src/` | `npm run build` in tree = `plugin-src/client|host/build.mjs` | Temp-dir rebuild + byte compare of `lib/client.js`, `lib/index.js`; `siblings: ["dsh-shared"]` is staged because `src/` imports `dsh-shared/lib/internal-secret.mjs` across the tree boundary | **Desktop built-in**, not a user plugin: `src/main/dsh-im-desktop.js` junctions it into the profile `node_modules` and mounts it via the desktop overlay `desktop-dsh-im.patch.yml` on every start (full + skip). Not disable-able; marketplace installs of the same family are `DROPPED`. |
| `dsh-pad/` | Packaged scratch-pad plugin (artifact-only snapshot). | `github.com/ChisaAlter/dsh-pad` `v0.3.1` @ `b4a9b05` + desktop client extensions (`README.md`) | External repo only — no local source | Resync from the registered upstream commit | Whole-tree artifact hash in `provenance.json` | Desktop built-in: mounted by `src/main/dsh-pad-desktop.js`. |
| `dsh-platform-session/` | Publishes the DeepSeek Platform embedded-session snapshot behind a Bearer-gated loopback route. | 本仓库自有 | `lib/` (hand-maintained, no build) | — | None needed (no generated artifacts) | Desktop-owned Harness plugin wired from the main process (`platform-session-overlay`). |
| `dsh-project/` | Local Project conversations with stable continuing workers. | 本仓库自有 | `lib/` + `client/` + `tests/` (hand-maintained, no build) | — | None needed (no generated artifacts) | Desktop-owned plugin; `src/main/dsh-project-desktop.js` and `npm run test` fixtures. |
| `dsh-remote/` | SSH/remote-workspace plugin (`flymysql/dsh-remote`). | `github.com/flymysql/dsh-remote` `v0.8.21` (MIT) + desktop fork (`DESKTOP-FORK.md`) | Host `lib/` is vendored source; client `plugin-src/` | `node plugin-src/client/build.mjs` in tree (`npm run build`); or `--record dsh-remote` | `lib/client.js` guarded by source/artifact hash sets — the vendored-toolchain build is not byte-reproducible by the repo's esbuild | Desktop built-in remote-workspace plugin; client rebuilt by `prepare:dsh-remote-client`. |
| `dsh-shared/` | ESM entry point that lets vendor plugins reuse `src/shared/secret.js` (token compare, bounded request bodies, child secrets). | 本仓库自有 | `lib/` (hand-maintained, no build) | — | None needed (no generated artifacts) | Imported by junction-mounted vendor plugins; shipped through extraResources `dsh-shared/**`. |
| `dsh-task-control/` | Task admission lock, work inspection and loopback control route for quit/update protection. | 本仓库自有 | `lib/` (hand-maintained, no build) | — | None needed (no generated artifacts) | Desktop-owned plugin wired from the main process (`task-control-overlay`). |
| `dsh-usage-panel/` | Desktop restyle of the usage statistics panel (settings section `usage-stats`). | `github.com/AlfredChaos/dsh-usage-panel` (MIT; `VENDOR.md`) | `src/` (TypeScript) | `node scripts/build.mjs` in tree (`npm run build`); or `--record dsh-usage-panel` | `lib/client.js` byte-compared to a temp rebuild; `lib/index.js` + declarations guarded by source/artifact hash sets (built by the vendored toolchain) | Desktop built-in: `src/main/usage-panel-preset.js` links the runtime into the profile and mounts `desktop-usage-panel.patch.yml` on every start, including recovery. Local accounting uses the host inherited prefix (projection state v3), so restore-time seed markers cannot hide billed usage. See `docs/features/usage-stats.md`. |
| `dsh-whale/` | Whale-girl assistant plugin: persistent session, settings, skills, memory, orchestration tools. | 本仓库自有 | `lib/` + `client/` + `presets/` + `stickers/` (hand-maintained, no build) | — | None needed (no generated artifacts) | Desktop-owned first-party plugin mounted by the shell. |
| `dsh-with-chatgpt/` | ChatGPT-account bridge plugin bundle. | 本仓库自有 bundle; `bridge/` is a pinned MIT fork of `github.com/XiaoDuoYa/codex-with-chatgpt` (`bridge/NOTICE.md`) | `lib/` (source) + `bridge/` (TS source) | `npm run prepare:dsh-with-chatgpt-bundle` (bridge `tsc` emits `bridge/dist` at pack time, untracked) | Generated `bridge/dist` is untracked, so nothing committed to compare | Desktop packaged plugin bundle. |
| `dshmarket/` | Attribution stub only (LICENSE + `DESKTOP-FORK.md` + marker `package.json`; source snapshot deleted). | npm `dshmarket@1.14.0` attribution | Stub files only | — | None (attribution stub; retained files are the source) | Not packaged, not mounted, hidden from the catalog, install rejected (`DROPPED`). The marketplace is desktop-owned code (`ui-settings-market` + main-process engine); see `docs/features/marketplace-settings.md`. |
| `open-intelligent-ui/` | OpenUI generative-UI source snapshot. | `github.com/thesysdev/open-intelligent-ui` @ `6a4a0ba` (`UPSTREAM.md`) | Entire source tree | `npm run prepare:whale-ui` (viewer emitted under `src/renderer/whale-ui`, outside vendor, untracked) | Upstream commit pin in `UPSTREAM.md`; generated output is untracked | Feeds the generated `whale-ui` renderer bundle used by the desktop UI. |

`harness-upstream.json` records the upstream pin (repo / ref / sha / npm version)
that `sync:harness` and `setup:harness` operate against.

The ChisaCode workspace lock resolves its root `@types/node` override to 22.20.4 with npm registry integrity metadata, matching npm 11's clean-install resolution under Node 24.21.0. Other locked packages are unchanged; the packaging path still uses `npm ci`.

The source baseline is `dsh-v0.2.2-rc.1` (`66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`). Desktop consumers use retained Session references and workspace navigation, including draft transfer before releasing the previous Session. Compatibility decisions and validation gates live in [harness-upstream-sync](../docs/features/harness-upstream-sync.md).

The desktop session-statistics strip consumes the Interface switch's live preference through its composer dock, so hiding figures does not wait for Host persistence. See the [live toggle repair](../docs/decisions/implemented/bug-fix/2026-09-29-session-stats-live-toggle.md).

Desktop New Session navigation additionally checks complete Host history before reusing a blank identity. Previously titled or plugin-owned Sessions keep their data and remain explicitly openable, but are never repurposed as new drafts. See the [blank Session reuse decision](../docs/decisions/implemented/bug-fix/2026-09-18-blank-session-reuse.md).

The desktop preload opts out of automatic account onboarding through `dshDesktop.onboarding: false`; the account client retains Settings/login without mounting the first-run controller. Other shells keep upstream defaults. See [direct desktop entry](../docs/decisions/implemented/product/2026-09-29-direct-desktop-entry.md).

```powershell
cd C:\ai\Deepseek-Harness-Desktop
npm run setup:harness
```

The desktop right panel uses one full-height Sidebar host for guide and content; `ui-surfaces` only adapts workspace opens and preview events. See [in-place panel decision](../docs/decisions/implemented/architecture/2026-09-28-single-panel-in-place.md).

The desktop Files guide exposes only the directory entry. Legacy fileless viewer tabs show the owning Session's standard directory body and localized title without passing internal Sidebar addresses to file reads. Tab records, pane, expansion, and floating state remain unchanged; valid file tabs and drafts keep their identity. See [Files guide address recovery](../docs/decisions/implemented/bug-fix/2026-10-01-sidebar-files-guide-address.md).

DockKit tab close buttons use the title's flex cross-axis centre instead of a fixed top inset, preserving alignment in both the desktop's 24px tabs and the shared 28px tabs. Their right-side position, hit area and close/drag behaviour are unchanged. See [surfaces work loops](../docs/features/surfaces-work-loops.md).

Release repairs preserve modal focus ownership, retained exits and desktop role geometry through shared tokens; regression fixtures follow the current service and provider contracts. See [GUI and core reconciliation](../docs/decisions/implemented/bug-fix/2026-09-28-release-gui-contract-reconciliation.md). Packaging preserves source module instances through a relocatable directory-link manifest; see [runtime instance layout](../docs/decisions/implemented/architecture/2026-09-28-runtime-instance-layout.md).
