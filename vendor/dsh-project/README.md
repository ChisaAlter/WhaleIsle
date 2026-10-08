# Local Projects

A WhaleIsle Project links one existing local directory to one lasting coordinator conversation. Add Project from the new-conversation directory menu and choose a directory. Repeating the same canonical directory opens its original Project and coordinator. Non-Git directories work without initialization. Creation starts no model and creates no worker or branch. Its coordinator is the native Team Lead. The Project category also exposes the same add action.

The main surface remains the native conversation, composer and model controls. Ask questions, request work, add conditions and stop work there. The coordinator answers short questions directly and delegates actual work to continuing workers. Workstream IDs stay internal; follow-up uses the original worker Session, cwd and history. Worker processes and files run locally; model requests use the configured provider.

## Runtime

`project-coordinator` exposes `project_read_store`, `project_delegate`, `project_stop` and scoped native Team reads. Its cwd is `$DSH_HOME/projects/<projectId>`, distinct from the directory displayed as the Project’s work object. Existing `session/presentation.owner = 'project'` supplies display ownership. The coordinator keeps a normal editable composer and is not attached as a member of the code Workspace.

Each worker uses the independent `project-worker` preset and the existing fresh, continuable `spawn` provider. A caller-reserved childId is persisted before native creation. Existing workers receive assignments through the native Team mailbox; an absent or damaged original Session is reported rather than replaced. The native descriptor preserves the cwd, preset, model route and narrow Project admission policy on cold continuation. The native Team Lead log owns membership, tasks and mailbox. Additive `team/control` records bind the Project host policy, cold capacity, cancelled messages, immutable assignment identities and explicit failed-member retry. No parallel worker execution engine is introduced.

Each delegation records its actual coordinator user-message and tool-call identity. A model request ID is not authorization. Runtime settlement may continue its original workstream within the original user scope, but cannot authorize unrelated work or restart a hold. Initial input uses an empty child seed.

The worker preset is stable across investigation, document work and development. Project roles explicitly use native tool presentation. The coordinator and read-only/document guards reject arbitrary `run_code` execution as well as shell and unrestricted filesystem tools. The effective scope and exact document paths are durable Project facts. Narrow `project_read`/`project_search` inspect the assigned directory; `project_write_document` writes only declared `.md`, `.mdx`, `.txt`, `.rst` and `.adoc` paths. Scope or document-path expansion requires a new actual user message and becomes effective only after the worker consumes its new brief. A busy expansion first interrupts and drains the prior activation, then continues the same Session. Native sandbox and delegated permissions remain authoritative.

Normal development uses the selected existing directory. Project workers serialize writes to the same canonical directory until the previous worker and its owned Jobs stop. Independent read-only work can run in parallel. An independent Git worktree is an explicit parallel-development arrangement, never the default; it remains fixed for that workstream and is not registered as an empty sidebar Workspace. The desktop bridge checks its actual branch/identity, and the user’s selected directory is never reset or deleted.

## Results and lifecycle

`project_report` records `completed`, `blocked` or `failed`, with a summary, real artifact references, evidence and explicit remaining issues. It then concludes the worker turn. A report alone does not complete the workstream: its delegation must match the current consumed request and the actual native terminal event. `done` means the worker reported completion and settled normally; it is not an independent verification claim. Idle without a report, an interrupted turn, missing input and failures remain blocked.

The native settled notice is the sole proactive worker-to-coordinator notification. `subagent/end` persists its run identity and updates notes. The coordinator’s existing pre-step hook waits for the matching bookkeeping barrier, then adds that run’s recorded reports, artifacts, evidence and remaining issues to the same native message. This covers workers that finish through `project_report` without a closing prose message. Message identity, native source and the single wake remain intact. An old run’s report never replaces a newer delegation’s status or grants new authority. Paused/stopped admission rejects automatic wakeups. Domain facts survive even when an Agent inbox is discarded on disposal; recovery reads them and does not publish synthetic replacement notices. A pending result is associated with a real visible coordinator reply after those facts were actually supplied through the native notice or a notes read. Association uses the explicit result references actually supplied to that turn; ambiguous titles are not used as identifiers. Store reads are paged, and unseen results remain pending. This is not a user-read receipt.

Stop first establishes its in-memory hold and real user-message cutoff and cancels owned work; failed persistence or notes cannot prevent cancellation or permit the same request to restart. The durable hold preserves the cutoff across recovery. The existing main composer Cancel hook and natural-language `project_stop` use the same Project stop path. An old coordinator turn cannot delegate itself out of that hold; a genuinely new user message is required. Workers and their owned Jobs drain; uncertain teardown stays `stopping` with a diagnostic and keeps directory occupancy. External user processes are never killed. Restart marks interrupted activity honestly and starts no model. Resume/restore only makes the Project available for a new user message. Archive retains all user directories, Session logs and Project materials.

The existing CLI shutdown owner drains Project before closing the Host storage tree. Bare Fiber unload performs runtime cancellation only, since Cordis releases facilities concurrently. After interruption, ordinary `turn/end` and a worker report do not prove the entire activation settled; recovery preserves these as blocked pending facts. Only a persisted native settlement establishes completion. Windows force termination is not a graceful-shutdown guarantee.

The `whale_project_local` storage domain stores only projects, workstreams, workers and finite delegation/settlement receipts. The abandoned Team experiment’s `whale_project` domain remains untouched and is never silently migrated. Session logs are the actual conversation history; notes are a readable projection. Project startup errors produce an unavailable Project service while ordinary Harness conversations remain available.

## Materials and UI

```text
$DSH_HOME/projects/<projectId>/
  notes.md
  preferences.md
  docs/<workstreamId>/
  internal/<workstreamId>/
```

The generated notes section precedes `<!-- whale-project:user-notes -->`; user prose below it is preserved. Preferences are assembled only in the coordinator scope and included in worker briefs, with current user instructions taking precedence. Deliverables are written as new files so earlier results remain available. Private work notes live outside the repository.

`project_read_store` permits only notes, preferences and docs. Worker material writes stay within its own docs/internal roots. Desktop material opening authorizes only this Project’s docs; reported repository artifacts must match their workstream’s fixed authorized directory. Realpath checks reject directory-link escapes.

The client registers its entry only when the Host reports availability. The sidebar has one row per coordinator. Progress uses the same TaskDock as ordinary conversation tasks, initially one line above the composer and expandable to bounded scrolling detail. Empty projects show no progress card. Rename/archive/restore belong to the Project row context menu; an active archive drains owned work. The category menu exposes archived projects. The shared Team action shows real native members/tasks and opens worker history read-only. Materials default to documents, with notes/preferences editing in secondary tabs. Worker process history uses the existing retained parent/child Session event source in a read-only modal; there is no second worker prompt. Task forms, Guide input, manual dispatch, acceptance and member administration are absent.

Public authenticated RPCs under `/dsh-project` are `list`, `create`, `detail`, `rename`, `stop`, `pause`, `resume`, `archive`, `restore`, `store/list`, `store/read`, `store/write`, `open` and `diff`. Delegation/reporting are scoped model tools and are not public workbench commands. The desktop patch mounts this plugin and native Team UI. Project reuses an existing Team service or composes one locally; it does not force-enable independent Team settings or edit user patch files.

## Validation boundary

Product implementation, focused Host checks, real provider conversation acceptance, visible desktop acceptance and packaged acceptance are separate evidence. Source or scripted-model checks alone do not certify a real-provider or installer path. This package changes no application version, publishing workflow or main branch.

Selected Project directories provide desktop authority through their own durable canonical registrations, without empty ordinary Workspace rows. Creation validates the selected local directory; file/Git/process actions still require the persisted registration. Continuations synchronize the native task description, preserve the original member and only complete after its matching report, settlement and owned Jobs have drained. Peer messages remain bound to both active assignments.
