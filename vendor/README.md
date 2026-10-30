# vendor/ — vendored source trees

Index of everything vendored into the desktop app. Per-tree provenance and
divergence notes live in each tree's own `DESKTOP-FORK.md` / `AGENTS.md`.

The desktop audit repairs Files draft/close protection, verbatim selection transfer and Session-aware path routing; remote settings now reflect effective binding/daemon ports and disclose LAN HTTP; macOS update feedback describes manual DMG installation. Build-stage credentials include helper/vendor/native inputs and actual platform outputs. See [project audit repairs](../docs/decisions/implemented/bug-fix/2026-09-30-project-audit-fixes.md).

| Tree | What it is | How the desktop uses it |
| --- | --- | --- |
| `deepseek-harness/` | Official DeepSeek Harness monorepo fork (pin in `harness-upstream.json`; sync via `npm run sync:harness`, build via `npm run setup:harness`). | The entire web UI + CLI runtime. Desktop-owned fork packages (the `DESKTOP_PACKAGES` registered in `src/shared/harness-desktop-forks.js`, e.g. `ui-settings-market`, `ui-surfaces`) live inside this tree and mount through the web-app bundle. |
| `dsh-im/` | First-party build of `@xmanrui/dsh-im` (Remote → 消息渠道 IM UI). | **Desktop built-in**, not a user plugin: `src/main/dsh-im-desktop.js` junctions it into the profile `node_modules` and mounts it via the desktop overlay `desktop-dsh-im.patch.yml` on every start (full + skip). Not disable-able; marketplace installs of the same family are `DROPPED`. |
| `dsh-usage-panel/` | Desktop restyle of the usage statistics panel (settings section `usage-stats`). | Desktop built-in: `src/main/usage-panel-preset.js` links the runtime into the profile and mounts `desktop-usage-panel.patch.yml` on every start, including recovery. Local accounting uses the host inherited prefix (projection state v3), so restore-time seed markers cannot hide billed usage. See `docs/features/usage-stats.md`. |
| `chisacode-remote/` | Full ChisaCode AGPL source tree powering mobile pairing/relay. | Main process `ChisaCodeRemote` daemon (see `docs/features/mobile-remote.md` and `chisacode-remote/AGPL-SHIPPING.md`). |
| `dshmarket/` | Attribution stub only (LICENSE + `DESKTOP-FORK.md` + marker `package.json`; source snapshot deleted). | Not packaged, not mounted, hidden from the catalog, install rejected (`DROPPED`). The marketplace is desktop-owned code (`ui-settings-market` + main-process engine); see `docs/features/marketplace-settings.md`. |

`harness-upstream.json` records the upstream pin (repo / ref / sha / npm version)
that `sync:harness` and `setup:harness` operate against.

The ChisaCode workspace lock resolves its root `@types/node` override to 22.20.4 with npm registry integrity metadata, matching npm 11's clean-install resolution under Node 24.21.0. Other locked packages are unchanged; the packaging path still uses `npm ci`.

The source baseline is `dsh-v0.2.1-rc.4` (`504a01a9578abc2c6f1fb896b1dc322c9fe24f66`). Desktop consumers use retained Session references and workspace navigation, including draft transfer before releasing the previous Session. Compatibility decisions and validation gates live in [harness-upstream-sync](../docs/features/harness-upstream-sync.md).

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
