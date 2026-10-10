# @deepseek-ai/dsh-client-ui-files

English | [中文](README.zh.md)

The Desktop Files tree and editor register native Sidebar `files` and `desktop-file` tab types, with bodies on the keyed `sidebar.right.pane.tab` slot. Tree and search clicks use `workspaces.openPath` with the owning Session and its cwd, including the shared HTML/PDF Files-and-Browser route. The old `surfaces.files` and `surfaces.file` registrations remain compatibility seats. Contract: the [slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md).

The guide exposes one Files directory entry. The `desktop-file` editor opens for a specific Session file resource. Legacy fileless, internal Sidebar, absolute, malformed, and empty-root addresses mount no editor and perform no file reads. Their body reuses the standard Files directory panel, and their title shows localized Files. The owning Session comes from the slot's standard share. Tab records, panes, expanded state, and floating state remain unchanged without replacement or persisted-layout migration. Valid file addresses, tab identity, drafts without a cwd, and save queues stay unchanged.

Workspace root is the owning Session's `cwd` from `useSessions`. Listing and file bytes come from desktop `window.shell` `listDir` / `readFile` / `readFileMedia` / `writeFile`; the renderer never loads Node. Directories expand lazily; the tree can be filtered by name (uncapped DFS under the workspace root; picker rows with full paths open the file). Typing `@` in the composer uses official ui-reference, not a Files path menu. Mention is a row control into the composer (markdown file link) and is omitted without a session id; file-tree rows drag into the composer as the same markdown link (`application/x-dshd-composer-mention`). Skills use official `/` via ui-skill. An in-flight root listing shows a listing message instead of empty-directory. Refresh reloads the root listing; while a search is active it re-walks that search so nested matches are not dropped. Context menus can show a file in the folder, open it in a probed editor, or open it with the system default. The context menu copies relative or absolute path. Images render as data URLs. When the desktop exposes `previewOpenFileWindow`, the preview toolbar also opens the current file in the shell's single read-only, always-on-top viewer; the viewer reads the workspace file from disk and does not share this editor's dirty buffer or save queue. Text within the 1 MiB read cap can be edited and saved (write cap is also 1 MiB); a failed save keeps the editor and the unsaved buffer and reports the error above it. FilePreview rereads when its tab becomes active. A dirty draft stays in the editor (Markdown Source included) when that reread fails, returns truncated or binary bytes, or runs without a cwd; Save writes whenever cwd exists, and a successful write clears truncated/binary. Save rereads disk and keeps the draft with `error.changed` when the file moved under the buffer; a second save overwrites. The Files owner persists dirty drafts in localStorage across reload and quit. `.md` toggles source versus `MarkdownText`. Jump-to-line (`revealLine` / `revealRequestId`) scrolls the source textarea and shows source while that reveal is pending. A non-collapsed source selection shows Add to chat, which appends an `L` range and a `text` fence of those lines to the composer; outside click and Escape dismiss the selection.

The native Sidebar file body stays mounted while hidden, preserving its 500ms save queue across tab and Session switches. The Files owner records every dirty edit in localStorage under its stable Session resource address; reload or quit does not depend on an unload event. Closing or replacing a dirty file uses the shared Modal with Keep editing, Discard, and Save and close. Failed Save or characters entered during Save preserve the tab and draft. Successful Save clears the persistent draft. Discard removes the confirmed draft and cancels its remaining debounce; a late completed write cannot recreate it. A stale close confirmation cannot close a restored occurrence or discard its draft.

The `/client` exports are the plugin body (`apply`/`inject`) plus the contract types only; FilesPanel, FilePreview, and FileTree remain package-internal behind the slot registration.

Search filters the local file list by name or path subsequence before applying the result limit. Nonmatching files are omitted; an empty query keeps file order.

Root listings, lazy expansion and search share at most four in-flight directory requests. Search still visits the complete tree, shows its pending state, and publishes results in the original directory order; changing cwd, Refresh or leaving search prevents superseded work from starting more requests. Already-issued IPC reads finish without publishing into the new request. Further query edits reuse the walked file inventory. The preview and separate-window action subscribe only to the resource's owning cwd. Dirty drafts remain synchronously persisted on every changed edit; repeated writes of an already persisted buffer do not serialize it again.

## Model Experience

None, as the Files surface only reads the workspace for display; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The tree does not mutate the workspace** — there is no create, rename, or delete.

No runtime invariant companion is published; this package owns no independent durable event relationship, and focused package tests cover its UI or service behavior.
