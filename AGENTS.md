# WhaleIsle

Electron desktop shell around DeepSeek Harness (`vendor/deepseek-harness`).

<!-- project-build-storage:start -->
## Build storage and disk usage

These rules apply to contributors and all coding agents working on this project, its worktrees and temporary verification environments.

### Before building or verifying

- Reuse the tools' user-level shared caches for ordinary Go, npm, pnpm, Bun, Gradle, browser and compiler downloads. Preserve lockfiles, toolchain versions and explicit caller overrides. Do not create a complete cache per project, worktree or task, or force different projects to share writable node_modules trees.
- Use an isolated cold cache only when the verification objective requires it. Put it in the current task's owned temporary directory, reclaim it on completion and restore environment variables. Prefer an existing project cleanup entry point over a new ad-hoc script.
- Before an install, runtime copy, build or package expected to add more than 1 GiB, check free space on the destination volume and estimate peak usage, including copies, staging and final packages. On the local Windows machine, retain at least 50 GiB free on C:. If the estimate would cross that floor, first reuse artifacts, reclaim clearly owned rebuildable outputs of completed tasks, or use another volume with room. If space is still insufficient, pause that large operation and report the requirement; continue independent small tasks.

### The creator owns cleanup

- Give each task a unique owned temporary directory for compiler intermediates, synthetic profiles, extracted tools, cold caches and verification runtimes. Keep logs, result summaries and final deliverables outside it. Do not move source, unique patches, real accounts or databases into it.
- Use finally, defer or test teardown in the existing build/verification entry point to reclaim owned intermediates after success, failure, timeout and cancellation. Wait for consumers to exit first. If a directory remains in use, retain it and report the exact path rather than stopping user processes to free space.
- Reclaim packaging staging only after the final package and required update metadata succeed and no downstream consumer needs it. Preserve existing StageOnly, failure-diagnostic and subsequent-verification output contracts; new cleanup options must not break old entry points.
- Reuse the same candidate's read-only runtime; copy it only for verification that mutates it. Keep logs and the smallest necessary reproduction as evidence instead of permanently retaining complete source, dependencies, browsers or Electron for each run.

### Cleanup boundaries and delivery

- Delete only freshly created, known-owned task directories or older outputs separately classified and authorized for removal. Before recursive removal, check resolved absolute boundaries and directory junctions. Unlink links without following external targets. Maintain shared caches through official tool commands after confirming no active build uses them.
- Preserve uncommitted code, Git history/worktrees, databases, real profiles, accounts/sessions, attachments, recovery snapshots and valid backups. A name such as tmp, cache, outputs, diagnostics, rollback or archives does not authorize deleting a mixed tree. Do not age-delete mixed directories, uninstall applications, empty the recycle bin, or change paging/hibernation settings without authorization.
- After changing an artifact-producing entry point, exercise the relevant real path and affected failure branches, and confirm repeated runs do not accumulate intermediate environments. Deliver the final artifacts and any temporary paths that genuinely must remain, with reasons. Writing rules does not establish automatic cleanup in unchanged scripts.
<!-- project-build-storage:end -->

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

`npm start` rebuilds stale client output before launching Electron. Remove `ELECTRON_RUN_AS_NODE` from the launch environment if the host sets it. After product runtime changes, restart the repository app; documentation and tooling changes do not require launching it.

Source Electron accepts `--background` to show initial main/launcher windows without activation. Later user entries retain normal focus behavior; recovery, update confirmations and normal quit can still require attention. An older already-running owner does not support this flag, so quit that owner normally before starting the new source.

If the vendor web build reports TS6059/TS6307 for packages outside apps/web, clean stale incremental state with `node node_modules/typescript/bin/tsc -b apps/web --clean` from the vendor directory before rebuilding; do not change the web project file list to hide it.

## Agent skills

### Issue tracker

需求、Bug 和任务使用 GitHub Issues；操作前读取 `docs/agents/issue-tracker.md`。

### Triage labels

议题分类使用五个默认标签；应用标签前读取 `docs/agents/triage-labels.md`。

### Domain docs

采用 single-context 布局；探索领域概念或设计决策前读取 `docs/agents/domain.md`。
