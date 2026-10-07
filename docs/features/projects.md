# Feature: Local Projects

| Field | Value |
| --- | --- |
| **id** | `projects` |
| **status** | Redesign 2.0 implemented and locally verified in the isolated work branch; PR integration pending |
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

The official Harness build and Windows directory package completed. Focused checks exercised continuable identity, scope consumption, cancellation, directory occupancy, linked-path protection, native report delivery, conservative recovery and shutdown. The real Loader composition uses a scripted external model; those checks do not stand in for provider acceptance.

Visible source-window checks in an isolated profile confirmed the directory menu, cancelled draft preservation, non-Git creation without background work, duplicate-directory reuse, selected-directory file browsing and explicit pause controls. A real model through the existing local Magpie gateway wrote and read back a Markdown plan, then continued the same worker Session after restart with an explicitly authorized code change. The coordinator received the matching native report and cleared its pending summary. The final Windows package was launched with a fresh isolated profile and its Project menu, directory selection and sole coordinator creation were observed; no package model request or installer installation was performed.

The primary checkout's HEAD, dirty status and hashes of its 20 existing changed paths were unchanged. Application version and release workflows remain unchanged; development CI and the user's merge decision belong to the PR. Earlier results for the withdrawn Team experiment are not evidence for this design.
