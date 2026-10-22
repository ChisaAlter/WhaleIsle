# @deepseek-ai/dsh-client-ui-git

English | [中文](README.zh.md)

Titlebar trailing plugin: a Session-log-style split button that commits, pushes, and opens a change request through desktop `window.shell` git IPC. The entry sits in `shell.titlebar.trailing` at `id: 'git-actions'`, `order: 20`, between Session log (`order: 10`) and the panel toggles (`order: 40`). Interface Settings `ui-git.titlebarGit` (default true) hides that cluster; in-flight toasts and dialogs stay mounted. Contract: the [slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md).

The main-button and dropdown labels follow `resolveQuickAction` English (`Commit, push & PR`, `Commit & push`, `Push & create PR`) in both locales. The branch and action labels collapse to icons at rest and expand on pointer entry, keyboard focus, or while their menu is open, including compact density. Pointer-revealed labels stay expanded until the pointer leaves the cluster so moving between segments does not shift a button away. Touch keeps both labels visible, and reduced motion switches immediately. Initialize Git remains icon-only at compact density. The commit dialog shows the current branch, a file list with `+/-` counts, an optional message, and Cancel / Commit on new branch / Commit. Stacked commit/push/PR and Pull open a top-right progress card immediately (spinner, phase title, elapsed `Running for Ns` or the latest hook line) and keep success or failure, including hook dumps, on that same card. Pull is `git pull --ff-only`. Default-ref confirm offers Abort and continue on this ref; Checkout feature branch & continue appears only when the action includes a commit. Other dialogs and hints still use the `git` dictionary. GitHub wording is Pull request / PR; GitLab uses MR. A missing session `cwd` or a null `gitStatus` disables the main button and shows the hint `Git status is unavailable.` An authorized cwd with `isRepo: false` replaces the split button with Initialize Git and calls `gitInit`. Push and commit_push on the default ref open `resolveDefaultBranchActionDialogCopy` before running. `hasPrimaryRemote` defaults to false when the status omits it. Create PR/MR stays in the menu and on the push-success toast for every provider; desktop `gitCreateChangeRequest` still fails closed off GitHub. A failed or rejected `gitBranchList` keeps the branch picker open and shows `Failed to load branches.` plus the failure detail as label rows, never the `No matching branches` empty state; a rejected git IPC promise lands on the progress toast as a failure instead of stranding it loading. A branch row flagged `switchable: false` (its name is outside the desktop switch whitelist) stays listed but disabled with a hint. A rejected background status/fetch/PR refresh keeps the last snapshot and never surfaces as an error or unhandled rejection. The commit dialog lists live `status.workingTree.files`; it does not snapshot the list at open and there is no `gitChangedFiles` IPC.

`GitActionsProps` composes the titlebar trailing owner share, `useSessions` for the current session cwd, injected git IPC callbacks, and the `git` locale seat. There is no plugin store. Desktop methods live only on `window.shell`; the renderer never loads Node.

The `/client` exports are the plugin body (`apply`/`inject`) plus the contract types only; GitActionsControl remains package-internal behind the slot registration.

## Model Experience

None, as the titlebar Git control only drives desktop git IPC; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Publish uses `gh` or a remote URL** — there is no multi-provider OAuth wizard. The dialog runs `gh repo create --source=. --remote=origin --yes --push`, or `git remote add` plus push when the user pastes a URL. Submit closes the dialog onto the progress card; failure reopens it.
- **Commit and PR copy use the desktop API key** — empty messages call DeepSeek chat when `loadConfig().apiKey` is set and fail the action if that request fails; without a key they use a staged name-status / range heuristic. There is no pluggable writer-model plane.
- **Worktree and thread↔branch binding are not shipped** — this desktop has no per-session worktree metadata.
- **Change requests go through `gh` on GitHub remotes** — an already-open PR is reused via `gh pr list --head`; fork creates pass `--head owner:branch`. Non-GitHub remotes fail closed (GitLab `glab` / other CLIs are not shipped). A missing `gh` after commit+push fails the stacked action on the toast.
- **Open file uses the OS default app** — the commit dialog opens paths with `shell.openPath`, not a preferred-editor picker.
- **Pull is fast-forward only** — `git pull --ff-only`; stash and rebase appear only as disabled menu hints.

No runtime invariant companion is published; this package owns no independent durable event relationship, and focused package tests cover its UI or service behavior.
