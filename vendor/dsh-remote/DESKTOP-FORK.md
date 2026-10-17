# dsh-remote — desktop fork notes

Vendored snapshot of [flymysql/dsh-remote](https://github.com/flymysql/dsh-remote) **v0.8.21** (MIT, `LICENSE` retained). Remote-work plugin for DeepSeek Harness: multi-machine SSH management, SFTP mirror workspaces, 20 `rw_*` model tools, port forwarding, TOFU host-key verification, audit log.

## Desktop deltas vs upstream v0.8.21

- DSH peers retain the existing RC/alpha.1/alpha.3 ranges and explicitly include `0.2.1-rc.2`. `src/main/dsh-plugin-compatibility.test.js` covers the rc.2 profile preflight and native Host composition; the 20 SSH tool definitions, prompt section and commands use the existing public APIs. No compatibility exemption or user-profile change is needed.
- `lib/update.js` deleted together with its routes (`/dsh-remote/update-*`), the `updateMode`/`updateCheckIntervalMs` Config fields, and the auto-update timer — the desktop owns updates; a plugin must not self-update.
- `lib/client.js` deleted and the `./client` export + `dsh.client` metadata + client peer deps removed — the upstream client is the rewrite reference only (fetch it at tag `v0.8.21` when needed); the desktop client half is rewritten on `ui-primitives` / `--dsw-alias-*` tokens / typed dictionaries (settings section「远程工作区」, picker remote-flow occupant, sidebar remote-files tab).
- The full runtime import chain moved into `dependencies` (`@deepseek-ai/dsh-tools` plus its transitive peers `cordis`/`dsh-agent`/`dsh-attachment`/`dsh-brand`/`dsh-code-runtime`/`dsh-invariants`/`dsh-llm`/`dsh-scope`/`dsh-session`/`dsh-timeout`/`dsh-typert-protocol`/`dsh-user-approval`, all `@0.1.0-rc.8`) — the junction-resolved package needs its own copies; `defineTool` is a plain-data builder and none of these are instantiated as host services (dshbot precedent).
- `node_modules` is git-tracked (`.gitignore` exception, dshbot/dsh-im/usage-panel precedent); `cpu-features`, `buildcheck`, `nan` (ssh2's optional native build surface) are re-ignored — pure-JS crypto path only, build-script allowlist unchanged.
- Package name stays `dsh-remote` and joins `DROPPED_BASENAMES`: the built-in is the sole supply; existing `$DSH_HOME/remote-workspaces` data carries over.
- Host fixes on top of v0.8.21 (upstream candidates): `/dsh-remote/machines` update keeps a stored jump-host password when the edit form posts a blank `proxy.password` (blank = keep, same rule as the main password — the client only ever sees `passwordSet`); `/dsh-remote/test-connect` accepts `machineId` and falls back to that machine's stored `host`/`port`/`username`/`password`/`privateKeyPath`/`passphrase`/proxy secret plus its `useAgent`/`keyboardInteractive`/`hostKeyMode`, so a saved machine is actually testable (upstream only probed the active-machine config + explicit fields, so a saved machine could never be tested without resending everything).

## Client half (rewritten, `plugin-src/client/`)

- `index.js` — plugin entry: bilingual `dsh-remote` dict registration, `settings.section`「远程工作区」, both `*.directoryFlow.remote` picker occupants, and a `ctx.inject(['sidebarRightTabs'], …)` block for the `dsh-remote/explorer` + `dsh-remote/file` tab types and their `sidebar.right.pane.tab`/`sidebar.right.pane.tab.title` seats (sidebar-right is reflect-provided — never a hard inject).
- `api.js` — `/api/dsh-remote/*` fetch wrappers; `sessionId` rides query/body on every fs route so session-bound operations never fall back to the active machine.
- `RemoteFlowPane.jsx` — the picker's「远程」occupant: machine select → remote browse → `/mirror` → `onPicked(localMirror)`; kept mounted across tab switches by the owner.
- `RemoteSettingsSection.jsx` + `MachineForm.jsx` — machine CRUD incl. `~/.ssh/config` import, test/connect/clear-active, port forwards, audit tail. Secrets never leave the host; blank password fields mean "keep".
- `RemoteExplorerBody/Title` + `RemoteFileBody/Title` — sidebar explorer bound to the session's mirror via `/resolve-mirror`, plus `dsh-resource://dsh-remote/<sessionId>/<path>` file tabs with bounded preview, mtime-locked editing, and download-to-mirror.
- `styles.js` — `.dshr-*` stylesheet on `--dsw-alias-*` / `--dsw-font-mono` tokens; `build.mjs` — esbuild CJS bundle wrapped in `window.__ModuleLoader__.load`, platform seeds (`react`, `ui-primitives`) external.

## Boundaries

- Upstream `main`-branch "official Desktop" adaptation (`connection.fetch` + `dsh-app:` channel) is NOT vendored — this shell runs `dsh web`; `/dsh-remote/*` routes register on `dsh-host-webserver`. `lib/http-transport.js` keeps the dual registration untouched, so a future official-desktop host still works.
- Do not confuse with `vendor/dshd-remote` (phone pairing daemon) — unrelated code, one-character name difference.
- Data lives under `$DSH_HOME/remote-workspaces` only; never `~/.dsh`.

Contract: [docs/features/remote-workspace.md](../../docs/features/remote-workspace.md) · Decision: `docs/decisions/proposed/product/2026-09-19-remote-workspace.md`
