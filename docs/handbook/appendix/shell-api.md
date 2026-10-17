# 附录：`window.shell` 能力索引

来源：[`src/preload/index.js`](../../../src/preload/index.js)。角色由 `--dshd-shell-role=boot|harness|launcher|pet|pet-live2d` 决定；仅主 frame 暴露。

## Boot 角色

| API | IPC channel |
| --- | --- |
| `windowAction` | `shell:window` (send) |
| `getWindowState` | `shell:window-state` |
| `onWindowState` | `shell:window-state` |
| `onTheme` | `shell:theme` |
| `getConfig` | `shell:get-config` |
| `getState` | `shell:get-state` |
| `restart` | `shell:restart` |
| `cancelRestart` | `shell:cancel-restart` |
| `saveBootLog` | `shell:save-boot-log` |
| `onState` | `shell:state` |
| `onLog` | `shell:log` |
| `onPluginBoot` | `shell:plugin-boot` |

## Launcher 角色

窗口 API 同 boot 的 `windowApi`。配置只走 `saveLauncherConfig`（`quitAfterStart` / `autoStartDesktop` / `askOnUpdate`），不得写 renderer 补丁字段。

| API | Channel |
| --- | --- |
| `getConfig` | `shell:get-config` |
| `saveLauncherConfig` | `shell:save-launcher-config` |
| `launcherStatus` | `shell:launcher-status` |
| `checkUpdate` / `installUpdate` | `shell:check-update` / `shell:install-update` |
| `scanImport` / `runImport` / `cancelImport` / `pickImportSource` / `pickSkillDir` | `shell:scan-import` / `shell:run-import` / `shell:cancel-import` / `shell:pick-import-source` / `shell:pick-skill-dir` |
| `listReleases` / `installRelease` | `shell:list-releases` / `shell:install-release` |
| `pluginForensics` | `shell:plugin-forensics` |
| `disablePlugin` / `disablePlugins` / `enablePlugin` / `removePlugin` | `shell:disable-plugin` / `shell:disable-plugins` / `shell:enable-plugin` / `shell:remove-plugin` |
| `startDesktop` / `stopDesktop` / `uninstallApp` / `skipUserPlugins` / `retryFullPlugins` | `shell:start-desktop` / `shell:stop-desktop` / `shell:uninstall-app` / `shell:start-desktop-skipped` / `shell:retry-full-plugins` |

订阅：`onUpdateProgress`、`onImportProgress`（`shell:import-progress`）、`onPluginProgress`、`onDesktopFailed`、`onDesktopReady`、`onShowTab`、`onLauncherHint`。boot / harness 不得调用导入、装指定 Release、问诊。

## Harness 角色（含窗口 + 配置）

窗口与配置同 boot 的 `windowApi` + `configApi`（含 `saveConfig`），并增加：

### 壳 / 设置 / 更新 / 插件

| API | Channel |
| --- | --- |
| `openExternal` | `shell:open-external` |
| `openSettings` | `shell:open-settings` |
| `reloadPage` | `shell:reload-page`（仅 Harness；复用活动工作确认和 PTY / preview 清理，不重启 ready Host） |
| `retryFullPlugins` | `shell:retry-full-plugins` |
| `checkUpdate` / `installUpdate` | `shell:check-update` / `shell:install-update` |
| `onUpdateProgress` | `shell:update-progress` |
| `reportChrome` | `shell:chrome-metrics` (send) |
| `listMarketplace` / `refreshMarketplace` | `shell:list-marketplace` / `shell:refresh-marketplace` |
| `listWallpaperCatalog` / `downloadWallpaper` | `shell:list-wallpaper-catalog` / `shell:download-wallpaper` |
| `listInstalledPlugins` | `shell:list-installed-plugins` |
| `installPlugin` / `installMarketplacePlugin` / `uninstallPlugin` | `shell:install-plugin` / `shell:install-marketplace-plugin` / `shell:uninstall-plugin` |
| `openMarketplace` | `shell:open-marketplace` |
| `onPluginProgress` | `shell:plugin-progress` |

### Git

`gitStatus`、`gitFetchForStatus`、`gitReadPullRequest`、`gitInit`、`gitDiff`、`gitCommit`、`gitPush`、`gitPull`、`gitCreateChangeRequest`、`gitPublishRepository`、`gitStage`、`gitUnstage`、`gitDiscard`、`gitStatusEntries`、`gitBranchList`、`gitSwitchBranch`、`gitCreateBranch`、`onGitProgress`、`onGitWorkspacesChanged` — channel 前缀 `shell:git-*` / `shell:git-progress` / `shell:git-workspaces-changed`（主进程监视 `dsh-home/storages/workspace.json`，登记变更后推送，标题栏据此立即刷新状态）。

### 工作区 FS

`openWorkspacePath`、`listDir`、`readFile`、`readFileMedia`、`writeFile`、`listEditors`、`openInEditor`、`showItemInFolder`、`openWithSystemDefault`。

### PTY

`ptyCreate`、`ptyWrite`、`ptyResize`、`ptyKill`、`onPtyData`、`onPtyExit`。

### Preview（Browser surface / Files 悬浮预览）

`previewOpen` … `previewClose`、`previewOpenFileWindow`、订阅 `onPreviewStateChange` / `onOpenPreviewUrl` / `onPreviewRecordingFrame` — 详见 preload 同文件列表。`previewOpenFileWindow` 只接收 `cwd + relativePath`，由 main 复用 workspace authority 与 token URL 打开单实例只读置顶窗。曾有的 `previewAutomation*`（含 evaluate / CDP 输入注入）因零消费者、暴露面过大已整链删除（2026-08-25）；恢复须新 feature 卡 + 权限模型。

## Pet 角色（Codex BrowserView 宠物，feature 默认关闭）

| API | Channel |
| --- | --- |
| `getState` | `shell:pet-state` |
| `commitDrag` | `shell:pet-drag-commit` |
| `openMenu` | `shell:pet-menu` |

订阅：`onState`（`shell:pet-state`，主→渲染推送宠物负载）、`onTheme`。主进程按精确 pet BrowserView sender + `pet.html` 主 frame 校验；不暴露其它 shell API。

## Pet-live2d 角色（Live2D 透明窗宠物）

| API | Channel |
| --- | --- |
| `setInteractive` | `shell:live2d-interactive` |
| `dragStart` / `dragMove` / `dragCommit` | `shell:live2d-drag-start` / `shell:live2d-drag-move` / `shell:live2d-drag-commit` |
| `relocate` | `shell:live2d-relocate` |
| `hidePet` | `shell:live2d-hide` |
| `getGrowth` / `feedTokens` / `care` | `shell:live2d-growth` / `shell:live2d-feed` / `shell:live2d-care` |
| `getSettings`（只读） | `shell:live2d-settings-get` |
| `openSettings`（⚙ 格跳主窗 `pet` 分区） | `shell:live2d-open-settings` |

订阅：`onMove`（`shell:live2d-move`）、`onLayout`（`shell:live2d-layout`）、`onCursor`（`shell:live2d-cursor`，主进程 ~30Hz 轮询推送穿透态光标）、`onGrowth`（`shell:live2d-growth` 推送）、`onSettings`（`shell:live2d-settings`）。页面仅经特权 `pet://` scheme 加载；校验 sender 属于宠物窗，不暴露其它 shell API。设置写入只走主窗侧 `shell:live2d-pet-settings`（HARNESS_ONLY）。

## 维护

增删 API 时同步本附录与 `shell-api.test.js`；手册模块章只链到本页，不复制全表。
