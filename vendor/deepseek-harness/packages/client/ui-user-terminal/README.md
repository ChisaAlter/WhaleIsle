# @deepseek-ai/dsh-client-ui-user-terminal

English | [中文](README.zh.md)

User terminal: the conversation-column drawer (`shell.terminalDrawer`) and the right-panel Terminal surface (`surfaces.terminal`) each sit on their own `createTerminalSessionStore()` handle, so a pane opened in one shell does not appear in the other. Contract: the [slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md).

The store keeps `sessions[]`, `activeId`, per-session `cols`/`rows`/`buffer`, and split groups capped at `MAX_TERMINALS_PER_GROUP` (4). `appendData` caps the replay buffer at `MAX_TERMINAL_BUFFER` and realigns the head cut to the next line start or ESC within `BUFFER_REALIGN_WINDOW`, so a remount replay never starts mid-escape-sequence. Desktop PTY IPC lives only on `window.shell` (`ptyCreate` / `ptyWrite` / `ptyResize` / `ptyKill` / `onPtyData` / `onPtyExit`); the renderer never loads Node. A missing project cwd does not create a PTY. Each pane is a `libghostty-vt` Canvas adapter (`GhosttyTerminalSurface`), not xterm. Seed replay uses `resetAndWrite` (PTY writer detached). Ghostty owns fit, 150 ms PTY resize debounce, bold as canvas `font-weight: 700`, and the engine ANSI palette (fg/bg/cursor/selection only come from the app). `onResize` forwards Ghostty's fit like `TerminalViewport`. A 30 ms settle fit follows output only when Ghostty reports the viewport is at the bottom. The active pane is focused; pointerdown on a pane activates it without moving DOM focus onto the chrome. The pane fill is `--dsw-alias-terminal-pane`, which mixes toward transparent under a live wallpaper or gradient but never below `TERMINAL_PANE_MIN_SOLIDITY`; the alpha-capable canvas then clears repaint regions back to that DOM fill instead of compositing a second mix, while explicit SGR cell backgrounds still paint solid. The canvas font is `--dsw-font-family-terminal` (then `--ds-font-family-code`), passed through `terminalFontOptions`. Windows PTY spawn uses `resolveShellCandidates` and `createTerminalSpawnEnv`; open size defaults to 120×30; `name` is `xterm-color`. Electron's `TERM=dumb` is dropped on Windows so the PTY matches Windows node-pty (it never writes `name` into `$TERM`).

The drawer toolbar is horizontal split / vertical split / maximize (restore remembers the last height) / new / close. A session list appears when more than one PTY is open. A selection offers Copy, Add to chat (fenced `terminal` draft; disabled without a session id), and Open when the text is a URL or workspace path. ⌘/Ctrl-click activates the same targets. Loopback http(s) opens the Browser surface; other http(s) calls `window.shell.openExternal`. Workspace paths go through `workspaces.openPath` with an optional `{ line }` so FilePreview can jump to that line. Height drag writes `setTerminalDrawer` clamped to `TERMINAL_DRAWER_MIN` ..= 75% of the viewport. Ctrl+` calls `toggleTerminalDrawer` when a cwd exists. `surfaces.terminal` is injected so it attaches when the surfaces shell declares that slot; that occupant has no separate maximize.

The `/client` exports are the plugin body (`apply`/`inject`), the store factory, and the contract types only; drawer and surface components remain package-internal behind the slot registrations.

Before enabling creation, both terminal surfaces query desktop `ptyCanCreate(cwd)` using the same workspace authority as `ptyCreate`. Missing or unauthorized directories disable New and Split with an explanation; automatic opening waits for the current directory's authorization result. The main process still enforces authority when creating the PTY.

## Model Experience

None, as the user terminal only drives desktop PTY IPC and layout geometry; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Right-panel shell is not owned here** — this package injects `surfaces.terminal` and does not declare the surfaces column or its empty-state cards.
- **Maximize is the conversation drawer only** — `surfaces.terminal` has no separate maximize control.

No runtime invariant companion is published; this package owns no independent durable event relationship, and focused package tests cover its UI or service behavior.
