**English** · [中文](./README.zh.md)

---

# dsh-remote

[![npm version](https://img.shields.io/npm/v/dsh-remote)](https://www.npmjs.com/package/dsh-remote)
[![license](https://img.shields.io/github/license/flymysql/dsh-remote)](LICENSE)
[![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-7a3ef3)](https://github.com/topics/dsh-plugin)

![dsh-remote — make any SSH machine a real DSH workspace](docs/cover.png)

**Remote-work assistant for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH).**

Manage several SSH machines, then pick a **remote workspace** (or a **local** one) and let the agent operate right there without leaving the harness — listing files, reading code, running builds & commands over the remote host, and keeping that remote directory mirrored into a real local workspace object.

The harness Web UI intentionally binds `127.0.0.1` (the CLI rejects `--host 0.0.0.0` for safety). This plugin goes the other way: **you connect out** to the machines you maintain, pick a workspace, and work in it through the normal DSH workspace + agent fs flows — no changes to `dsh-workspace` or the harness core.

## Screen previews

Settings → **远程工作区** — a multi-machine SSH registry (add / edit / delete / set-current, password stored locally):

<img src="docs/ui-settings-panel.png" alt="dsh-remote settings — multi-machine registry (light theme, host scrubbed)" width="720"/>

The native **"Add workspace" / "Select workspace"** flow — a centered modal, two tabs, opens on **本机 (local)**; switch to **远程 (remote)**:

- **远程** — a **machine `<select>`**, a path field that **auto-prefills `/` and live-completes** directories (picking one immediately reveals its next level, OS/VSCode-style), plus a **浏览…** floating browser that fills the field without committing — you review, edit, then **设为远程工作区**.

Real capture (host scrubbed to a placeholder):

<img src="docs/ui-picker-panel.png" alt="dsh-remote workspace picker — real dialog; 本机 (local) tab; 远程 machine select + prefilled root path + autocomplete" width="720"/>

---

## Features

- **Multi-machine SSH** — save any number of hosts (`host`/`port`/`user` + **private key** or **password**). Passwords are stored locally and never shown back in the UI. Switch with one click in Settings. Per-machine **passphrase / host-key mode / SSH agent / keyboard-interactive (OTP) / proxy jump (bastion)** and an **optional OS-keychain password** (`加密保存密码` — macOS Keychain / Windows DPAPI / Linux secret-tool).
- **`~/.ssh/config` import** — the Settings page lists your `Host` aliases; one click fills the form (path reference only, the plugin never reads key material).
- **Two-tab workspace picker** (fills the native "Add workspace" flow):
  - **本机 / Local** — opens the **native OS folder chooser** over the host (macOS `osascript` / Linux `zenity`→`kdialog` / **Windows `FolderBrowserDialog`**), or lets you type a local path → adopted directly as a normal DSH local workspace.
  - **远程 / Remote** — the picker is a **centered modal**. Pick a **machine** → on Windows hosts the root shows a **"This PC" drive view** (`C:\`, `D:\`, `E:\`… instead of the Git Bash MSYS root) and the path field live **autocompletes** directories (accepts `C:\Users\…` or `/c/Users/…` — Windows paths are rewritten to the Git Bash form underneath); selecting a directory immediately lists its next level. A **浏览…** floating browser (Windows-aware breadcrumb `此电脑 / C:\ / Users / dev`, drive rows, size + mtime, dirs first, follows symlinks) fills the field without committing; the **回上一级** button works at any depth (even when the browser was opened at the path bar's value). **最近 workspaces** quick-pick, **`~` 主目录** shortcut and **新建目录** are one click away. On confirm it creates a **real local mirror** under `$DSH_HOME/remote-workspaces/<host>-<user>-<port>/<base>` that passes `fs.realpath` → the harness adopts it as a real workspace while dsh-remote keeps it synced over SFTP.
- **Git Bash default terminal (Windows remotes)** — the remote platform is auto-detected (`cmd /c ver`, plus an `uname -s` MINGW/MSYS probe as fallback); on Windows the plugin locates Git Bash (`config.shell` can pin a path or `native` disables wrapping) and pipes every command to `bash -s` over the exec channel, so quoting/backslash escaping is never an issue regardless of the SSH default shell. `rw_exec` runs with a Git Bash cwd (`/c/Users/…` form). `/dsh-remote/status`, `rw_info` and the 测试连接 button report the detected platform + shell.
- **Windows path auto-conversion** — typing `C:\Users\dev\project` (or `C:/…`, `/c/…`, `/C:/…`) is normalized underneath to the Git Bash form `/c/Users/dev/project` for shell commands, while workspaces are stored and shown Windows-style (`C:\Users\dev\project`). All model tools accept and report both forms; SFTP access uses the Win32-OpenSSH `/D:/…` form (see `toSftpPath`).
- **Bidirectional SFTP sync, conflict-aware** — `rw_sync` (remote → mirror) and `rw_push` (mirror → remote) are **three-way** (remote vs local vs last-synced snapshot): files changed on both sides are **reported as conflicts and never silently overwritten** (`force=true` overrides). Defaults are **depth 8 / 2000 files**; hitting a cap is reported as **`TRUNCATED`**. Both support **dry-run**, **background tasks**, and honor **gitignore-style ignore rules**.
- **Model tools** — 20 tools, all Windows/POSIX portable via SFTP: `rw_info`, `rw_connect` (with `save`), `rw_pick_workspace`, `rw_list_dir` (size+mtime), `rw_stat`, `rw_read_file` (encoding-aware: utf-8/gbk), `rw_write_file`, **`rw_edit`** (literal replace + mtime optimistic lock), `rw_append`, `rw_mkdir`, `rw_remove` (recursive, bounded), `rw_move`, `rw_exec` (pty/env), **`rw_search`** (SFTP tree walk — works on Windows too, honors ignore rules, context lines), `rw_download`/`rw_upload` (streaming fastGet/fastPut + size caps), **`rw_forward`** (SSH tunnels), `rw_sync`, `rw_push`, `rw_disconnect`.
- **Port forwarding panel** — create/start/stop/remove **local** (`127.0.0.1:port → remote`) and **reverse** (`remote → local`) tunnels in the Settings page or via `rw_forward`. Both listen only on `127.0.0.1`. Definitions persist; only local tunnels with `autoStart` restart on reconnect. Reverse tunnels require an explicit start and use ssh2 `forwardIn` plus the client `tcp connection` event to reach the configured local target. Stop/remove cancels the remote listener and closes established reverse connections; disconnect stops all tunnels and detach removes the client event listener.
- **Sidebar remote editing** — the remote file tab is **editable**: click **编辑** → edit → **保存到远程** with an mtime optimistic lock (409 + "重新读取" on concurrent change). File ops are **session-bound** (v0.8.19): the explorer sends `sessionId` so two conversations on different hosts do not share the active-machine pool. The explorer rows show file sizes and have a **right-click menu** (下载到本地镜像 / 重命名 / 删除 / 新建目录).
- **Command audit log** — every `rw_exec`/write/remove/move/forward is appended to `$DSH_HOME/remote-workspaces/audit.log` (time · user@host · op · exit code · command); the Settings page shows the last 30.
- **Async long tasks** — `rw_sync`/`rw_push` with `async: true` return a `taskId`; progress/result/cancel via `/dsh-remote/task` (single-flight queue).
- **Connection health** — a **「测试连接」** button validates host/user/key/password (with per-category error hints: auth / network / host key / timeout) before you save a machine; latency is cached on the machine record.
- The active `user@host:/path` is injected into every system prompt (plus active forwards).
- **No official `dsh-workspace` core is modified** — everything is delivered as a normal plugin (directory-flow holes filled by the client half at `priority -100`).
- **Cross-platform remotes** — all file access is SFTP-protocol-level (no shell dependency), so Linux/macOS/Windows remotes all work for listing, reading, writing, searching and syncing.
- **Host-key verification (TOFU)** — every SSH connect verifies the host key
  (`hostKeyMode: accept-new`): first connect records it, a later CHANGE is rejected
  as a possible man-in-the-middle. `verify` also refuses hosts never seen before;
  `off` disables it. Stored at `$DSH_HOME/remote-workspaces/known_hosts.json`; reset
  with `/remote forget-key`.
- **Data lives under the harness home** — machines + mirrors follow `$DSH_HOME`; pre-0.6 data under `~/.dsh/remote-workspaces` is migrated automatically on first run.

## Install

Desktop fork: the remote workspace picker shares the local dialog's title and footer geometry, keeps Cancel available during loading and errors, and offers retry when machine loading fails. Its content scrolls independently so actions stay reachable in short windows.

### Official Desktop compatibility (experimental, unreleased)

This branch adds a compatibility path for the **official**
[DeepSeek Harness Desktop](https://github.com/deepseek-ai/deepseek-harness),
tested against the `0.1.5-rc.2` Host transport. It does not replace the Harness
core or require a listening Web server:

- The SSH settings and directory picker use `/api/dsh-remote/*` over the
  Desktop's `dsh-app:` carrier. Exact Fetch routes are registered on
  `ctx.connection.fetch`; the carrier retains ownership of authentication.
- A native **Remote Files** entry uses `sidebarRightTabs` and the keyed
  `sidebar.right.pane.tab` seat. It reuses the existing explorer/editor and
  gives remote files their own session-scoped resource addresses, rather than
  sending remote paths to the local Files viewer.
- `dsh-better-sidebar` is not bundled. Web hosts may install it separately;
  official Desktop uses the native right-sidebar integration instead.

Since **v0.8.19**, sidebar `/ls` `/read` `/write` `/fs` resolve the session's
mirror binding (same path as `rw_*`) when the client sends `sessionId`. Two
sessions on different hosts no longer share the active-machine pool for file
ops. Host-side tests cover that routing plus the editor 409/re-read/save path.

Official Desktop's native file-tab GUI, failed/cancelled dialogs, non-macOS
hosts, and a full legacy Web UI pass are still experimental. Desktop's package
installer may also require an explicit policy for the optional `ssh2` /
`cpu-features` build scripts. The isolated transport test disabled those
optional scripts; this change does not loosen an application's build allowlist
or automatically approve dependency scripts.

### Published Web bundle

```bash
dsh plugin add dsh-remote            # add the bundle
```

Since **v0.8.18**, `dsh-remote` installs and mounts only itself. The Web sidebar
([dsh-better-sidebar](https://www.npmjs.com/package/dsh-better-sidebar)) is
optional and is no longer a dependency or an automatically mounted row. This
keeps the SSH tools and settings UI independent from a particular sidebar
implementation.

To add the optional Web remote-file explorer/editor, install both bundles:

```bash
dsh plugin add dsh-remote
dsh plugin add dsh-better-sidebar
```

When the standalone sidebar service is present, `dsh-remote` discovers it
dynamically and registers its remote explorer/editor tabs. Without it, all
`rw_*` tools, the settings UI, sync, audit log, and port forwarding continue to
work. Official Desktop uses its native right-sidebar seats and does not need
`dsh-better-sidebar`.

> **Upgrading from 0.7.2–0.8.17:** upgrading to 0.8.18 removes the embedded
> sidebar dependency and mount. Install `dsh-better-sidebar` separately only if
> you still want that Web UI. Any old profile override for
> `id: dsh-remote-sidebar` can be removed because that row no longer exists.

(or `npm install dsh-remote` + add `- id: dsh-remote / name: dsh-remote` in `cordis.patch.yml`).

## Quick start

1. **Add a machine** — Settings → 远程工作区 → add host/port/user + key or password → (optional) set it current.
2. **Open a workspace** — click **Add workspace** in the sidebar / conversation:
   - **本机** → system folder chooser (or type a local path) → local workspace.
     On hosts without a usable OS dialog (DSH Desktop's browse backend, headless
     SSH hosts without zenity/kdialog) the in-app directory browser pops up
     instead — breadcrumbs, Windows drive switch, new-folder, pick-and-fill.
   - **远程** → choose the machine → browse to a remote directory (or type `/path`) → "设为远程工作区" ⇒ a local mirror workspace is created and adopted.
3. **Work with the agent** — treat it like any workspace:
   - `rw_list_dir(path?)`/`rw_read_file` — inspect remote files
   - `rw_write_file(path, content)` / `rw_edit(path, old, new)` — create / patch a remote file directly
   - `rw_stat(path)` / `rw_mkdir(path)` / `rw_remove(path, recursive?)` / `rw_move(path, dest)` — manage remote paths
   - `rw_search(pattern, path?)` — grep remote files (SFTP walk, Windows OK)
   - `rw_exec(command, cwd?, pty?)` — run remote shell commands (defaults to the workspace dir)
   - `rw_forward(listenPort, targetHost?, targetPort?)` — open an SSH tunnel
   - `rw_sync(dryRun?/force?/async?)` / `rw_push(dryRun?/force?/async?)` — conflict-aware mirror pull/push

## CLI defaults (optional)

Provide a default machine in `cordis.patch.yml`:

```yaml
# Example only — use values for your own machine.
- id: dsh-remote
  name: dsh-remote
  config:
    host: 203.0.113.10   # or your real host / hostname
    port: 22
    username: dev
    privateKeyPath: ~/.ssh/id_rsa
    # or password: '…'
    workspace: ~/project
```

If `host` is empty the plugin starts disconnected and you configure machines in the UI.

## CLI quick reference

Installing and driving DSH may live in different shells, so both the `dsh` binary and the `npx` form are shown. Always tell DSH **which profile** to use with `--profile <name>` (usually `web`).

```bash
# install the bundle into a profile (npm is pulled by pnpm; recommended)
dsh plugin --profile web add dsh-remote
# same but when `dsh` is not on PATH (e.g. Windows PowerShell inside a repo)
npx --yes @deepseek-ai/dsh plugin --profile web add dsh-remote

# confirm it is installed wire
dsh plugin --profile web list
npx --yes @deepseek-ai/dsh plugin --profile web list

# start the web surface (reload profile; the plugin activates on boot)
dsh --profile web
npx --yes @deepseek-ai/dsh --profile web   # http://127.0.0.1:3080

# use a local checkout instead of the npm version (dev iteration)
npx --yes @deepseek-ai/dsh plugin --profile web add /path/to/dsh-remote
npx --yes @deepseek-ai/dsh plugin --profile web remove dsh-remote   # back to release
```

After a successful start, `Settings → 远程工作区` appears and the "Add workspace" flow gains the 本机 / 远程 tabs (screenshots above).

## Development (sandbox, not product)

Iterate **in the sandbox**, never by hand-editing a product profile — the
product profile is re-managed by the plugin manager and reverts hand-deployed
files on reinstall. Use the helper script:

```bash
scripts/dev-run.sh --restart   # start / restart the isolated sandbox
scripts/dev-run.sh --stop      # stop it
scripts/dev-run.sh --status    # is it running?
```

- Runs its own DSH instance (`dev-harness/harness` inside this repo) with the
  plugin copied in from `lib/` — it boots through the same `bin.js web --patch`
  path as the desktop app, so the sandbox reproduces the product boot behavior.
- The sandbox web UI serves on `http://127.0.0.1:50599` and the plugin routes
  are live immediately (e.g. `GET /dsh-remote/machines`).
- **Host-half changes** (`lib/index.js`) need a sandbox restart (`--restart`);
  **client-half changes** (`lib/client.js`) need a page refresh.
- Node ESM resolves dependencies from the importing file's real path, so the
  script **copies** `lib/` (hardlink copy, `cp -al`) into the sandbox profile
  instead of symlinking — a symlink breaks `@deepseek-ai/*` resolution.
- Run `scripts/check.mjs` (static framework-constraint gate: command-name
  regex, …) before every commit; `scripts/boot-smoke.sh` boots an isolated
  instance to prove the plugin still starts.
- Full rules live in `scripts/dev-standards.md` (command names, cordis service
  access via `ctx.get()` only, optional framework services may never register,
  verify third-party callback contracts against the real runtime, …).

Deploying to a product profile is a separate, explicit action (`./sync.sh`)
and should be done only when you intend to release.

Focused forwarding regression: run `node --test lib/forwards.test.js` from this
package. It uses the installed ssh2 client/server on owned random loopback ports,
verifies the host key and authentication, echoes binary TCP payloads through a
real reverse SSH channel, and checks stop/remove/detach and error boundaries.
The remote host is simulated in the test process; it does not run a host shell,
an OS sshd, an external physical host or the desktop UI.

## Configuration

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `host` | string | `''` | default SSH host (else start disconnected) |
| `port` | int | `22` | default SSH port |
| `username` | string | `''` | default SSH user |
| `password` | string | `''` | default SSH password (non-empty overrides key) |
| `privateKeyPath` | string | `''` | private key path (used only when explicitly provided) |
| `passphrase` | string | `''` | passphrase for an encrypted private key |
| `workspace` | string | `''` | default remote workspace path |
| `shell` | string | `''` | remote command terminal strategy: `''`=auto-detect (Git Bash on Windows remotes), `'git-bash'`=prefer Git Bash, `'native'`=never wrap, anything else=explicit bash.exe path (e.g. `C:\Program Files\Git\bin\bash.exe`) |
| `commandTimeoutMs` | int | 20000 | per remote command timeout |
| `connectTimeoutMs` | int | 15000 | SSH connect timeout |
| `maxFileBytes` | int | 52428800 | skip mirroring/reading files larger than this (0 = no cap) |
| `hostKeyMode` | string | `accept-new` | host-key policy: `accept-new` (TOFU), `verify` (reject unknown hosts), `off` (skip) |
| `useAgent` | bool | `false` | authenticate via the OpenSSH agent (`SSH_AUTH_SOCK`) |
| `keyboardInteractive` | bool | `false` | allow keyboard-interactive auth (OTP/MFA) with the configured password |
| `proxy` | object | — | jump host: `{ host, port?, username?, password?, privateKeyPath? }` |
| `autoPush` | bool | `false` | auto-push edited mirror files back to the remote (watcher, debounced) |
| `auditLog` | bool | `true` | append executed commands to `$DSH_HOME/remote-workspaces/audit.log` |
| `encoding` | string | `utf-8` | text encoding for remote file reads/writes (e.g. `gbk`) |

## FAQ / troubleshooting

**Host key 变了 / 提示可能中间人** — 主机重装过或密钥更换过：`/remote-forget-key`（或设置页 → 机器 → 重新信任），下次连接重新记录。

**连接报"认证失败"** — 检查用户名/密码/私钥路径；私钥加密了要填 Passphrase；公司机器要求 OTP/动态码时勾选 keyboard-interactive。

**连不上内网机器** — 走跳板机：机器表单里填「跳板机」主机（也可以先把它本身配成一台机器）。主机不可达类错误会给出分类提示。

**rw_sync/rw_push 报冲突** — 远端和本地都改过同一个文件时会跳过并列出冲突（绝不静默覆盖）。处理：手动合并后重新同步，或用 `force=true` 以一边为准。

**Windows 远程** — 列表/读写/搜索/同步全部走 SFTP 协议，不依赖 POSIX shell；中文文件用 `encoding=gbk` 读。

**镜像里没有某个目录** — 默认 ignore 规则（`.git`、`node_modules`、`target` 等）会跳过；在 `$DSH_HOME/remote-workspaces/.dsh-remote-ignore` 加 `!` 之外的条目即可调整（gitignore 语法）。

**侧边栏远程文件保存失败（409）** — 远端文件在你打开后已被改动，重新读取后再编辑（mtime 乐观锁保护）。

**密码怎么加密保存** — 机器表单勾选「加密保存密码」：macOS 用系统钥匙串（security），Windows 用 DPAPI，Linux 需要 secret-tool（libsecret）；后端不可用时自动回退明文。

## Safety

Giving the plugin a machine's credentials lets the agent run **shell commands as your user** on that host. Only add machines you trust. Passwords are saved on the local machine file (or the OS keychain when enabled); treat it as sensitive (you may lock file ACLs). Every executed command is recorded in the audit log when `auditLog` is on — review it from the Settings page.

## License

MIT

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).
