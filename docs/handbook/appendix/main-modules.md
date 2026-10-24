# 附录：`src/main` 模块索引

非测试 `.js` 按职责分组（文件名即路径 `src/main/<name>.js`）。细节以源码为准。

## 生命周期与窗口

| 文件 | 职责 |
| --- | --- |
| `index.js` | 应用入口 |
| `harness-controller.js` | Harness 启停、揭示、恢复模式 |
| `dsh.js` | `dsh web` 子进程管理 |
| `window.js` | 主窗 / BrowserView / 启动器窗 |
| `launcher-gate.js` | 冷启动是否询问更新、自动启桌面、关启动器 |
| `data-import.js` | 只读扫描/拷贝官方 `~/.dsh` 会话与附件；插件名单重装 |
| `chrome.js` / `harness-chrome-inject.js` | 桌面 chrome 注入 |
| `closing-overlay.js` | 关闭遮罩 |
| `config.js` / `remote-patch.js` | 路径与壳配置；远程 IPC 补丁白名单 |
| `../shared/dsh-home.js` | 桌面 Harness 家目录：`userData/dsh-home`，不读 `~/.dsh`；章：[modules/dsh-home.md](../modules/dsh-home.md) |
| `local-url.js` | loopback URL 策略 |

## IPC 与权威

| 文件 | 职责 |
| --- | --- |
| `ipc.js` | IPC 路由 |
| `ipc-authorization.js` | sender / 角色鉴权 |
| `workspace-authority.js` | 工作区路径权威 |
| `workspace-fs.js` / `workspace-rpc.js` | FS 能力 |
| `editors.js` | 外部编辑器 |
| `settings-jump.js` | 设置深链 |
| `download-path.js` | 下载路径 |

## Git / PTY / Preview

| 文件 | 职责 |
| --- | --- |
| `git.js` + `git-*.js` | Git 门面与子能力 |
| `pty.js` | PTY |
| `preview.js` + `preview-*.js` | Browser 预览栈 |

## 市场 / 插件 / 预置

| 文件 | 职责 |
| --- | --- |
| `marketplace-catalog.js` / `marketplace-install.js` / `marketplace-spec.js` / `marketplace-allowbuilds.js` | 市场 |
| `usage-panel-preset.js` | 桌面内置模块：用量统计（dsh-im 模式，每轮都挂，不可禁用） |
| `plugins.js` / `plugin-runtime-files.js` | 插件列表、禁用 bundles、运行时文件 |
| `plugin-forensics.js` | 不启内核解析日志嫌疑包 |
| `plugin-tree-failure.js` / `plugin-recovery-actions.js` | 启动失败恢复 |
| `dsh-remote-desktop.js` | 桌面内置模块：SSH 远程工作区 overlay 与 profile junction |
| `legacy-dshbot-preset.js` | Bots 移除后清理旧桌面受管块、overlay 文件及可确认归属的 junction；保留用户数据 |
| `harness-extract.js` | 打包 harness 提取 |

## 壁纸 / 远程 / 桌面壳

| 文件 | 职责 |
| --- | --- |
| `wallpaper-catalog.js` | 壁纸目录与下载 |
| `remote.js` / `mobile-web.js` / `relay-client.js` | 远程与手机（侧栏入口；默认关、开才监听） |
| `tray.js` / `tray-menu.js` / `menu.js` / `close-behavior.js` / `update.js` | 托盘菜单关闭更新 |
| `boot-log-dump.js` | 导出启动日志 |

## 其它

| 文件 | 职责 |
| --- | --- |
| `composer-official-qa.js` / `appendix-a-qa.js` / `release-ui-walk.js` | QA / 走查辅助 |

手册模块章应链接本索引或具体文件，避免再维护第二份文件清单。
