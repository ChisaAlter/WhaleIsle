# Feature: Local Projects

| Field | Value |
| --- | --- |
| **id** | `projects` |
| **status** | Repair in review; live-model continuation and packaged acceptance pending |
| **implementation** | `vendor/dsh-project`, optional desktop overlay and narrow directory bridge |

The [accepted design](../superpowers/specs/2026-10-07-local-project-agent-teams.md) uses a restricted coordinator and real continuable background workers. Harness Agent Teams remain optional; creating or starting a Project does not enable Team plugins or change their settings.

## User paths

From New Conversation's directory menu, choose **添加 Project…**, select a local directory, then enter the Project category and its sole coordinator conversation. The existing directory picker and Workspace registration remain the source of directory identity. Cancelling preserves the draft; selecting the same Workspace opens its existing Project. A non-Git directory is valid. Creation binds a directory and creates the coordinator; it never initializes Git, clones a repository, creates a branch or starts development.

The user describes the requirement in the coordinator conversation. Its Project tools delegate work, read the Project store and stop background work. Background execution uses actual Harness continuable subagents; the progress panel shows their state, reports and necessary controls. A settled idle worker without an explicit report does not count as completed work.

Workers use the selected existing directory by default. Writable work in that same canonical directory runs serially; read-only investigation can run in parallel and has no shell or write tools. An independent Git worktree is an explicit choice for work that needs its own directory and branch. Background worktrees do not become ordinary Workspace or sidebar groups.

## Invariants

- One Workspace identifies one Project and one public coordinator Session. Reopening uses the existing association; missing coordinator data requires attention and never silently creates another coordinator.
- The coordinator cwd is `$DSH_HOME/projects/<projectId>`, separate from the selected user directory. Its preset only exposes `project_delegate`, `project_read_store` and `project_stop`; user input continues through the ordinary composer.
- Profile-local storage keeps `notes.md`, `preferences.md`, user deliverables under `docs/` and background material under `internal/<workstreamId>/`. Generated notes preserve the user-owned suffix. Docs capabilities authorize the exact docs directory, not the whole Project store.
- A continuation retains its child Session, canonical cwd, role preset and admission policy. Model choices remain Session-local; Project selections do not overwrite the ordinary global model default.
- Stop records the hold before cancelling work. Harness Jobs and subagent settlement determine whether owned models and processes have actually stopped; Project has no second desktop script/service manager. Directory occupancy remains held while work is active or uncertain.
- Worktree receipts bind the Project/workstream identity, source repository, fixed directory, branch and creation receipt. Changed directory, repository or branch identity requires review before continuation. Existing user directories are retained and never reset, stashed or removed by Project cleanup.
- Cleanup can remove only a clean app-created worktree after the owner has drained its work. The Git branch is retained. Archiving preserves Project history, docs and user directories.
- Git snapshots report actual HEAD, status, changed-file hashes and diff. Non-Git snapshots explicitly report unavailable Git metadata rather than claiming the directory is clean. PR/CI observation is optional and uses an exact repository and PR number.
- The desktop writes its own Project overlay, a small runtime copy and peer links under the profile. Peers resolve to the active Harness instances; installed resources remain read-only. Disabling Project or starting plugin recovery omits that overlay while retaining data. Project preparation or initialization failure must leave ordinary Harness conversations available.

## Responsibility and verification

- [Plugin implementation](../../vendor/dsh-project/README.md) and [design](../superpowers/specs/2026-10-07-local-project-agent-teams.md).
- Desktop mount and recovery: `src/main/dsh-project-desktop.js`, `harness-controller.js`, `dsh.js`, plugin forensics and profile operations. The packaged Harness runtime is prepared before Project peers are mounted.
- Authenticated local directory capabilities: `src/main/project-environment.js`, `/desktop/project` and `workspace-authority.js`. Only exact owned worktree receipts extend desktop file/Git/PTY authority; the Project store is not a general desktop workspace.
- Shipped first-party resources and peer closure: `package.json`, `scripts/after-pack.js` and the Project package manifest. Hidden role presets are registered by the plugin, preserving existing user preset definitions.
- Necessary Harness seams: continuable-subagent cwd/preset/admission and settlement run identity; awaited child composition; Session before-cancel and local model selection; directory action registration and sidebar navigation. Generic Team ownership, managed Session events and Workspace archive hooks are not part of this implementation.

The previous delivery claims were withdrawn after adversarial review found lifecycle, permission, data-preservation and layout defects. PR #153 is closed and was not merged. Its prior screenshots and checks do not certify this repair.

The repair binds native runs to submitted/consumed delegations, retains directory reservations across old settlements, records the user-message cutoff for single-work stops, and drains workers even when generated notes cannot be refreshed. Project roles reject generic preset replacement. Worktree cleanup preserves ignored files, and receipt writes use exclusively created temporary files.

Project materials use a compact header action beside the existing directory control. Work progress follows the composer width. Reported files resolve through the Project capability and retain their absolute identity in the application's existing preview surface. Document tabs use the Host's read-only viewer; Project docs do not become generic desktop write, terminal or Git roots. Unsaved materials remain open across navigation, successful saves remain successful if a later refresh fails, and a history request returning no records preserves the current page.

The 2026-10-08 repair passed focused directory, lifecycle, client and file-preview routing checks, the official client build, and real Loader/Session/continuable-worker composition with a scripted model. Source Electron was restarted from the repair worktree using an isolated profile. The original directory-menu entry created a local non-Git Project without starting work; notes survived restart; the native preview displayed the actual Project docs file instead of a different same-named file in the bound directory. Full target-window captures at 1441×920 and 960×680 logical pixels confirmed a single-line header, truncated sidebar paths, and progress aligned with the composer. Native sidebar and document-preview surfaces were also observed.

An actual model request failed with `MISSING_CREDENTIAL` in the isolated profile before a worker was created. Live-model delegation/continuation and the repaired packaged artifact remain unverified. This is not a ready-to-merge claim.
