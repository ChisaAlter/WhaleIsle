# Decision: Pre-confirm every install/update lane + launcher in-window confirm bridge

Status: implemented

[中文](2026-09-27-update-install-preconfirmed.md) | English

## Problem

A full audit of confirmation surfaces found two systematic issues:

1. **One action confirmed twice (three times worst-case)**: the version-page 「update/switch」 click already goes through `app-confirm`, yet `coordinate('update')` asks again after download+verify. The slim path stacked native boxes: update ask → integrity confirm → the desktop-side `prepare-install` confirm (which fell back to an unanchored native box with all windows hidden). Cold-start update asks, the settings 「check for updates」 prompt, and the About 「install online」 button share the same shape — every install-lane entry point is already explicit user consent, so the in-lane task-protection confirm is pure duplication.
2. **Native messagebox residue**: the slim update ask, the unverified-installer warning, the packaged `confirmUnverifiedInstall`, the quit drain-failure fallback, and the renderer crash-recovery box all used `dialog.showMessageBox` — a system-styled dialog even when a perfectly good host window is on screen.

## Decision

1. **`preConfirmed` across every install/update lane**: `update.js`'s whole-file lane, `update-updater.js`'s electron-updater lane, and the peer `onPeerInstall` (`prepare-install`) `coordinate('install')` all pass `preConfirmed: true`. The inspect→acquire→drain→commit lock ordering is unchanged; only the user-facing confirm gates are skipped. quit/restart/reload keep their confirm (closing a window or restarting is not "a button I just clicked to install something"). Confirmation semantics shift from "confirm inside the lane" to "confirm once at the entry point": the update ask, the version card's `app-confirm`, the install-runtime button, the About 「install online」 button, and the delta-update `app-confirm` each carry the single confirmation for their path.
2. **`launcher-confirm` bridge unifies launcher-owned confirms**: new module `src/launcher/launcher-confirm.js` — the main process `ask(payload)` sends a `shell:app-confirm` event to the launcher renderer, which answers through the existing `app-confirm` card via `shell:app-confirm:response` (mounted as a lane module through `registerLauncherChannels` extraChannels, LAUNCHER_ONLY-authorized). `ask` resolves `null` (no window / destroyed webContents) so the caller falls back to the native box — an unreachable bridge can never silently authorize. Wired into: the full package's `confirmUnverifiedInstall` (launcher-service `deps.askLauncherConfirm`) and the slim `confirmUpdateAsk`/`confirmUnverified`. Both packages share the same bridge and the same in-window card.
3. **Remaining native boxes unified**: the quit drain-failure fallback (「retry / force quit」) and the renderer crash-recovery prompt now route through `confirmDialog` (first visible window → shell overlay; native only when nothing is visible). Crash recovery gains a `setRecoveryConfirm` injection in `window.js` (the harness WebContentsView maps back to the main window).

## Alternatives considered

- **Round-trip the confirm back into the caller's in-window card** — rejected (same reasoning as launcher-stop-preconfirmed): re-confirming a button the user just clicked is the annoyance itself.
- **Keep the task-protection confirm inside install lanes** — rejected: the user established "explicit action = consent" as the product rule; quit keeps its confirm because closing a window does not carry "kill my work" intent.
- **Force-quit on drain failure without asking** — rejected: a failed drain means runtime state is unknown; the last-resort choice deserves one explicit prompt, now styled.
- **Open a fresh window for the crash prompt when none is visible** — rejected: a window just for a recovery box costs more than it saves; native is the honest last resort.

## Consequences

- Version-page 「update/switch/delta」, cold-start and parked update asks, settings 「check for updates」/「install online」, slim install/update: one click → one confirm (or none), with task protection still draining and locking in the background.
- quit/restart/reload still confirm once when work is active; the quit drain-failure fallback still appears (now shell-styled).
- Every main-process confirm owned by the launcher shares the single `app-confirm` card form; native boxes remain only for "no visible window" edge cases and the init-failure `showErrorBox`.
- The `launcher-stop-preconfirmed` record's "preConfirmed must not spread to install/update" constraint is superseded by this record (the full audit showed the install lanes' double-confirm is the same defect class). Annotated in place.

> Update 2026-11-08: the renderer crash-recovery box and the init-failure `showErrorBox` are gone. A crash reloads automatically and ends on a failure page inside the surface; fatal errors only write the log and a crash report. See [desktop-launcher](../../../features/desktop-launcher.md).
