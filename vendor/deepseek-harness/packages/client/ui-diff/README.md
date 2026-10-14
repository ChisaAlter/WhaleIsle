# @deepseek-ai/dsh-client-ui-diff

English | [中文](README.zh.md)

Right-panel Diff occupant of `surfaces.diff` (`single`, `session-maybe`, declared by ui-surfaces). Shows the workspace change list and unified hunks from desktop `window.shell.gitDiff(cwd)`. Working-tree hunks are `git diff HEAD` (staged and unstaged on the same file). A scope menu switches Working tree (porcelain Stage / Unstage / Discard; untracked discard is `git clean -f`, directories `-fd`) and Branch (`gitDiff(cwd, { baseRef })` three-dot range; no index mutations). Stage / Unstage / Discard failures keep the file list and show persistent floating feedback without shifting the file list; the operation button keeps its resting size while busy. The branch Menu searches every listed ref. Collapse all / Expand all toggle hunks. Filename clicks call owner `openFile`. When `gitStatus(cwd)` is null the panel shows `Diff is only available in Git repositories.` Contract: the [slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md).

Workspace root is the current session `cwd` from one `useSessions` read. The renderer never loads Node.

The `/client` exports are the plugin body (`apply`/`inject`) plus the contract types only; DiffPanel remains package-internal behind the slot registration.

## Model Experience

None, as the Diff surface only reads git for display; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No turn-diff, split view, ignore-whitespace, or word-wrap** — branch scope is `baseRef...HEAD` only; there is no checkpoint turn range. Split / wrap / ignore-whitespace toggles are not shipped.
- **Titlebar Commit is unchanged** — Diff stage/unstage/discard does not replace `git add -A`.

No runtime invariant companion is published; this package owns no independent durable event relationship, and focused package tests cover its UI or service behavior.
