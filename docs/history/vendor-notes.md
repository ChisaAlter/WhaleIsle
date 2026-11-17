# vendor-notes · 历史记录

自 [vendor/README.md](../../vendor/README.md) 迁入（2026-11-17，议题 #458）；以下为该文件原有的历史修复说明段落，原样保留（相对链接按新位置调整前缀）。

The desktop audit repairs Files draft/close protection, verbatim selection transfer and Session-aware path routing; remote settings now reflect effective binding/daemon ports and disclose LAN HTTP; macOS update feedback describes manual DMG installation. Build-stage credentials include helper/vendor/native inputs and actual platform outputs. See [project audit repairs](../decisions/implemented/bug-fix/2026-09-30-project-audit-fixes.md).

The desktop session-statistics strip consumes the Interface switch's live preference through its composer dock, so hiding figures does not wait for Host persistence. See the [live toggle repair](../decisions/implemented/bug-fix/2026-09-29-session-stats-live-toggle.md).

Desktop New Session navigation additionally checks complete Host history before reusing a blank identity. Previously titled or plugin-owned Sessions keep their data and remain explicitly openable, but are never repurposed as new drafts. See the [blank Session reuse decision](../decisions/implemented/bug-fix/2026-09-18-blank-session-reuse.md).

The desktop preload opts out of automatic account onboarding through `dshDesktop.onboarding: false`; the account client retains Settings/login without mounting the first-run controller. Other shells keep upstream defaults. See [direct desktop entry](../decisions/implemented/product/2026-09-29-direct-desktop-entry.md).

The desktop right panel uses one full-height Sidebar host for guide and content; `ui-surfaces` only adapts workspace opens and preview events. See [in-place panel decision](../decisions/implemented/architecture/2026-09-28-single-panel-in-place.md).

The desktop Files guide exposes only the directory entry. Legacy fileless viewer tabs show the owning Session's standard directory body and localized title without passing internal Sidebar addresses to file reads. Tab records, pane, expansion, and floating state remain unchanged; valid file tabs and drafts keep their identity. See [Files guide address recovery](../decisions/implemented/bug-fix/2026-10-01-sidebar-files-guide-address.md).

DockKit tab close buttons use the title's flex cross-axis centre instead of a fixed top inset, preserving alignment in both the desktop's 24px tabs and the shared 28px tabs. Their right-side position, hit area and close/drag behaviour are unchanged. See [surfaces work loops](../features/surfaces-work-loops.md).

Release repairs preserve modal focus ownership, retained exits and desktop role geometry through shared tokens; regression fixtures follow the current service and provider contracts. See [GUI and core reconciliation](../decisions/implemented/bug-fix/2026-09-28-release-gui-contract-reconciliation.md). Packaging preserves source module instances through a relocatable directory-link manifest; see [runtime instance layout](../decisions/implemented/architecture/2026-09-28-runtime-instance-layout.md).
