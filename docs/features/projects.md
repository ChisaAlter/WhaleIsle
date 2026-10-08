# Feature: Local Projects

| Field | Value |
| --- | --- |
| **id** | `projects` |
| **status** | Source implementation under verification; live-provider and packaged acceptance pending |
| **implementation** | `vendor/dsh-project`, native Agent Teams and the desktop directory bridge |

The [product design](../superpowers/specs/2026-10-08-project-product-redesign.md), [Team architecture](../superpowers/specs/2026-10-08-project-team-architecture.md) and [prompt contracts](../superpowers/specs/2026-10-08-project-prompts.md) define the target. [Source research](../research/2026-10-08-project-team-runtime-research.md) records the compared implementations. The former direct-worker implementation has been replaced with native Team membership, tasks and mailbox delivery. This note distinguishes that implementation from outstanding acceptance.

## User paths

Project is a category below Workspace in the existing sidebar, with one coordinator conversation per selected canonical directory. Add from the category or New Conversation's directory menu. The composed directory picker selects the directory without creating a redundant ordinary Workspace. Non-Git directories are supported. Creation starts no model, initializes no repository and creates no branch or worker. Selecting the same directory reopens the original association.

The native conversation and composer remain the main surface. Its coordinator is the real Team Lead; delegated work becomes native Team tasks owned by continuing teammates. The shared Team action opens the native roster and task view. Worker history opens read-only through the retained Session source. Follow-up work retains its member, Session, directory, preset and model routing. A missing original Session is reported rather than silently replaced.

Work progress shares TaskDock with ordinary conversation tasks: an initially collapsed single line above the composer, expanding into bounded scrolling details. An empty project has no empty progress card. The strip distinguishes queued work from running models/Jobs. Reports link actual artifacts; directory changes include untracked files and identify truncated diffs. Materials default to deliverable documents; notes and Project preferences are secondary tabs and retain unsaved edits.

Rename, open directory, archive and restore belong to row menus, including right-click. Archive stops and drains owned work before preserving the project as history. The category menu exposes archived projects. Restoring makes a project available for a new user request and starts no model.

## Runtime invariants

- Project selections persist in `whale_project_local`; their canonical identity supplies desktop directory authority without ordinary Workspace rows. Existing `workspaceId` associations are retained. The Project store does not become a general filesystem, Git or terminal root.
- The coordinator cwd is `$DSH_HOME/projects/<projectId>`, distinct from the selected work directory. Restricted Project tools handle delegation, knowledge and stop; native Team reads and bounded peer messages expose real team facts.
- The native Lead log owns roster, tasks and mailbox. Additive `team/control` events persist host policy, cold capacity, message cancellation, assignment identities and explicit failed-member retries. Unbound ordinary Teams retain their existing behavior.
- Each worker uses native continuable `spawn`. Immutable delegation/run identity prevents stale completion, stale messages and old cancellation notices from changing a newer assignment. Peer messages are scoped to both sender and recipient assignments and never expand permissions.
- A native Team task completes only when its current delegation has a completed structured report, the matching native completed settlement, and no remaining owned Jobs. Idle alone is not completion. Task descriptions follow accepted continuations; dependency and capacity checks remain native Team responsibilities.
- Development uses the selected directory by default. Writers sharing a canonical directory are serialized; read-only investigations can run concurrently. Independent Git worktrees are explicit choices and retain fixed ownership receipts and branch identity.
- Stop establishes an immediate source cutoff, cancels the Lead and workers and drains their owned Jobs even if persistence or notes fail. A stopped request cannot restart itself. Directory occupancy remains held while teardown is uncertain. Only new user input permits continuation; restart itself starts no model.
- Project reports distinguish worker claims from independent verification. A result is associated with the coordinator's actual visible reply only after its explicit report references were supplied; no title-text matching is used. Store reads are paged and do not consume unseen results.
- Worktree cleanup preserves dirty and ignored files, checks original ownership and runtime drain, and retains branches. Existing user directories are never reset, stashed or removed. Archiving retains Session logs, documents and directories.
- `notes.md` preserves the user-owned suffix; `preferences.md` applies only to this Project. `docs/` contains deliverables and `internal/` contains private work records. Actual file previews retain absolute identity and enforce narrow capabilities.
- The desktop overlay mounts Project and native Team UI, resolving peers to the active Harness. Project reuses an existing Team service or mounts its own local service; it does not globally enable independent Team settings. Plugin recovery preserves data and ordinary conversations.

## Responsibility and evidence

Runtime and UI: [plugin documentation](../../vendor/dsh-project/README.md). Desktop composition: `src/main/dsh-project-desktop.js`; authenticated directory/file capabilities: `project-environment.js` and `workspace-authority.js`. Harness changes are confined to shared TaskDock, directory composition, managed Team policy/events and continuation settlement identity. Installed resources remain read-only.

The previous PR #153 was closed without merge; its checks do not certify this redesign. Current focused tests cover native Team retry/capacity, projection, composed directory flow, path authority, cancellation, owned Job drain and stable continuation. The real Harness Host composition check uses a scripted external model adapter while exercising actual tools, Team tasks, Sessions and persistence. Source Electron verification uses an isolated profile from the repair worktree.

The isolated profile's real provider request failed with `MISSING_CREDENTIAL` before worker creation. Real-provider collaboration, nonempty live progress and packaged acceptance are outstanding; source builds and scripted checks cannot certify these paths. The draft PR is not ready to merge on this evidence alone.
