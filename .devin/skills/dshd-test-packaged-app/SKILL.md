---
name: dshd-test-packaged-app
description: End-to-end test a packaged Deepseek-Harness-Desktop build on macOS — DMG mount/install checks, cold-start expectations (auto-start vs launcher hold), where userData/runtime/logs live, how to surface the launcher and quit, and this VM's focus quirk with the accessibility workaround.
---

# Testing a packaged Deepseek-Harness-Desktop build (macOS)

## Artifacts and install

- `npm run dist:mac` produces `dist/mac-arm64/<product>.app` + `dist/<product>-<ver>-mac-arm64.dmg` (unsigned/adhoc, arm64).
- DMG check: `hdiutil attach -nobrowse -readonly <dmg>` — volume should contain `<product>.app` + `Applications -> /Applications` symlink.
- Install: drag `.app` onto the `Applications` alias in the DMG window (Finder) or `cp -R`. Locally built DMGs carry no `com.apple.quarantine` xattr, so the copied app launches without Gatekeeper. Verify with `xattr -l /Applications/<product>.app`.
- Single-instance lock is shared between source and packaged builds — quit any running instance first.

## Cold-start expectations (clean machine)

`config.js` defaults: `autoStartDesktop: true`, `quitAfterStart: true`, `askOnUpdate: true`.

- Cold start **auto-boots the desktop** (main window → boot page) and keeps the launcher hidden, UNLESS a hold applies: newer GitHub release + askOnUpdate → 「更新/稍后」 dialog on a visible launcher; `dsh-home/sessions` empty AND `~/.dsh` has importable sessions → lands on launcher 导入 tab; `last-desktop-start.json` `ok:false` → stays on launcher home with Recovery Board.
- First launch extracts `Contents/Resources/vendor/deepseek-harness.tar` (~2GB) to `userData/runtime/<version>` — boot-page log shows 「正在解压运行时（仅首次，之后会变快）…」; expect 1–3 min before the Web UI appears.
- Success signal: boot page (DSH-DESKTOP header, whale mark, 「正在启动运行时」, log dock) is replaced by the Harness Web UI (sidebar with New Session/Plugins/Workspaces/Settings, composer). Onboarding may show "Internal Testing Notice" → Continue → "Add an API key" → Configure later.

## Key paths

- `userData` = `~/Library/Application Support/Deepseek-Harness-Desktop/` — `config.json`, `last-desktop-start.json` (`{ok:true}` means healthy start), `dsh-home/`, `runtime/<version>/` (extracted harness).
- Bundled CLI entry: `runtime/<version>/apps/cli/lib/bin.js`; spawned with `DSH_HOME=<userData>/dsh-home` by `Contents/Resources/node`.
- Quick node sanity: `/Applications/<product>.app/Contents/Resources/node --version` and `otool -L` on it — a Homebrew thin driver needs `libnode.*.dylib` at `Contents/lib/` and `/opt/homebrew/opt/*` deps; shipping just the binary is broken on user machines.

## Driving the app in this VM

- The packaged app may never become the frontmost app (menu bar stays "Finder") — a VM/window-server quirk; menus ARE still registered. Use the `computer` tool macOS target: `query role=menuitem text=<label>` then `act press` — works without focus (e.g. `打开启动器`, `退出`).
- After the app restarts (quit + relaunch), cached accessibility observations keep pointing at the dead pid and `inspect`/`query` fail with "did not answer accessibility requests" — get the new pid via `pgrep -f "MacOS/<product>"` and pass it as `app` to `inspect`.
- Launcher while desktop runs: menu 文件 → 打开启动器 (menuitem), or tray 「打开启动器」. Tray icon may be hidden behind the simulator notch on narrow screens.
- Launcher-home assertions when desktop is up: status `当前版本 <v> · 桌面端已就绪`, primary button reads 「关闭桌面端」 (not 「启动桌面端」).
- Quit via menuitem `退出` → closing overlay 「关闭中 · 正在停止本机 Harness 服务」; then `pgrep -f Deepseek-Harness` should be empty.

## Debugging a failed desktop start

- Boot-page log dock and launcher home status carry the failing reason verbatim; `last-desktop-start.json.error` persists it.
- `dsh 进程结束 (code null, signal SIGABRT)` → dyld failure on `Resources/node` (missing libnode/homebrew dylibs). Reproduce with `Resources/node --version`.
- `dsh 进程结束 (code 1)` with `readModuleFallbackManifest` / `Unexpected non-whitespace character after JSON` → corrupted `package.json` inside the runtime tar. Scan: `find <runtime>/0.x.x -name package.json -exec node -e 'try{JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))}catch(e){console.log(process.argv[1])}' {} +`. Corruption signature = valid JSON + leftover tail fragment (parallel `copyFile` race onto one flattened pnpm dest in `scripts/after-pack.js`).
