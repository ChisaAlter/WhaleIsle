# WhaleIsle

Electron desktop shell around DeepSeek Harness (`vendor/deepseek-harness`).

## Development

Use a work branch and PR; the user decides whether to merge. [Maintenance](docs/maintenance/README.md) owns the current workflow for the host and all vendor directories. Development CI is normal feedback; successful main builds publish automatically when the version increases. [Release operations](docs/handbook/modules/release-process.md) explains the commands.

The user replaced the previous local/repository constraints on 2026-10-03. Final-only CI, local-QA certificates, cumulative-attempt approvals, candidate signoff and document governance gates no longer apply to this project. Historical notes and vendored guidelines do not reinstate them.

Implement the requested behavior without silent scope reductions or speculative retries, fallbacks and abstraction layers. Reuse relevant checks, report actual results, and stop repeating checks once the question is answered. Do not claim that files or rules guarantee future agent behavior.

## Find the responsible code

- [Product handbook](docs/handbook/README.md): architecture and module maps.
- [Feature notes](docs/features/README.md): user behavior, invariants and desktop differences.
- [Design language](docs/design-language.md): visual authority, including the boot-page exception.
- [Motion](docs/motion.md) and [native window behavior](docs/features/window-motion.md).
- [Surfaces and terminal work loops](vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-16-surfaces-terminal-work-loops.md).

Read the relevant module, not every document. Update changed product facts in their owning place; ordinary fixes need no new feature card, decision record or translated copy. Allowed touch sections locate code, not approval boundaries. Preserve data, permissions and shipped functionality during upstream integration; use the maintenance guide's upstream section.

## Running the app

`npm start` rebuilds stale client output before launching Electron. Remove `ELECTRON_RUN_AS_NODE` from the launch environment if the host sets it. After product runtime changes, restart the repository app; documentation and tooling changes do not require launching it. `vendor/dshbot` is linked into the runtime, so its changes need a restart.

Source Electron accepts `--background` to show initial main/launcher windows without activation. Later user entries retain normal focus behavior; recovery, update confirmations and normal quit can still require attention. An older already-running owner does not support this flag, so quit that owner normally before starting the new source.

If the vendor web build reports TS6059/TS6307 for packages outside apps/web, clean stale incremental state with `node node_modules/typescript/bin/tsc -b apps/web --clean` from the vendor directory before rebuilding; do not change the web project file list to hide it.
