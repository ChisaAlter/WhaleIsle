# 系统蓝图

Deepseek-Harness-Desktop 是 Electron 桌面壳：本机拉起官方 `dsh web`，用 `BrowserView` 嵌官方 Web UI。桌面独占能力（Git、PTY、工作区 FS、Browser 预览、市场安装、壁纸目录、托盘、更新、手机远程）经 `preload` → `window.shell` → `src/main/ipc.js` 桥接；SSH 远程工作区由桌面内置 `dsh-remote` 插件接入 Harness。

## 进程模型

```mermaid
flowchart TB
  main[Electron_main]
  launcher[Launcher_renderer]
  boot[Boot_renderer]
  bv[Harness_BrowserView]
  dsh[dsh_web_subprocess]
  main --> launcher
  main --> boot
  main --> dsh
  main --> bv
  bv -->|loopback_HTTP| dsh
  launcher -->|start_desktop_after_gate| boot
  boot -->|reveal_when_ready| bv
```

| 角色 | 职责 |
| --- | --- |
| Electron main | 生命周期、窗口、IPC、子进程、托盘、更新、远程服务 |
| Launcher renderer | 壳控制面：更新询问、导入、版本、插件问诊；官方 `--dsw-alias-*` |
| Boot renderer | 仅主窗启动页（仪器画布）；日志、插件进度、失败恢复 UI |
| `dsh web` 子进程 | 官方 Harness HTTP（loopback）；对话 / 设置 / 客户端插件 |
| Harness BrowserView | 加载 loopback 官方页；注入标题栏等桌面 chrome；暴露 harness 角色的 `window.shell` |

单实例锁：安装版与源码启动互斥。打包态与源码态都走同一套壳，但 npx 官方包**不含**桌面标题栏 / Git / surfaces / 底栏终端——那些只在本仓库源码启动与安装包路径里。

## 冷启动到主界面（概要）

1. `src/main/index.js` 起应用；`whenReady` 只开启动器，不立刻 `dsh web`。
2. 启动器查 GitHub 正式版：有更新则询问；没有或跳过则（除非空家目录要导入）启动桌面端。
3. 主窗口载 boot 页；main 拉起 `dsh`（`dsh.js` / `DshManager`）。Boot 订阅状态 / 日志 / 插件进度。
4. Harness HTTP 就绪且客户端插件装完后，BrowserView 露出官方 UI；成功且配置允许则关启动器。
5. 桌面失败则启动器留下并打开插件问诊。崩溃或 Harness 挂掉：可回故障态 / 自动重启倒计时（见 [flows/boot-to-ready.md](flows/boot-to-ready.md)、[modules/plugin-recovery.md](modules/plugin-recovery.md)）。

## 表面地图

| 表面 | 谁画 | 谁出能力 |
| --- | --- | --- |
| 启动器 | `src/renderer/launcher.*` | main：更新、导入、版本、插件问诊 |
| 启动页 | `src/renderer/boot.*` | main：状态、日志、恢复动作 |
| 四栏主框（侧栏 / 对话 / 右栏 Surfaces / 底栏终端） | Harness Web UI | 桌面 IPC：FS、Git、PTY、preview |
| 设置各 section | Harness `settings.section` 插件 / 桌面内置模块 | 市场安装、用量统计、SSH 远程工作区、壁纸 catalog、跳转 IPC |
| 托盘 / 应用菜单 | main `tray.js` / `menu.js` | 打开设置、显示窗口、宠物开关、退出 |
| 桌面宠物 | `src/renderer/pet-live2d.*`（Live2D 整屏透明 `BrowserWindow`，`pet://` scheme）/ `pet.*`（Codex BrowserView，feature 关闭） | main `desktop-live2d.js` / `desktop-pet*.js`：窄 IPC、位置与养成持久化 |
| 手机 SPA | `mobile/web` | main `dshd-remote.js` + `mobile-web-server.js`（ChisaCode daemon + offer v2） |
| Android | `mobile/android` | 同协议客户端（Host/Git 白名单经 daemon） |

视觉语言：除启动页仪器例外外，一律官方 `dsh web`（[design-language.md](../design-language.md)）。

## 状态归谁

| 状态 | 权威存储 |
| --- | --- |
| 主题、壁纸图、frost/pixelate、图源、收藏 | 桌面 `userData/dsh-home/settings.yaml`，不是 `~/.dsh` |
| 工作区路径、关闭行为、远程配对、宠物状态（`pet` / `live2dPet`）等壳配置 | `userData/config.json` |
| SSH 工作区开关 | `userData/config.json` 的 `remoteWorkspaceEnabled`；默认开 |
| SSH 机器、凭据、主机密钥、镜像与审计 | 桌面 `$DSH_HOME/remote-workspaces/`；密码可选经操作系统 secret store 加密 |
| 会话、模型、MCP、技能、市场插件 | 桌面 `userData/dsh-home`（插件在 `profiles/web`）；官方 CLI 仍用 `~/.dsh` |
| 壳层默认 API key | `userData/credentials.json` |
| 市场目录缓存 / 安装进度 | main 市场模块 + 安装到桌面 profile |
| PTY / preview 会话 | main 进程内，随窗口生命周期 |

路径明细：[modules/dsh-home.md](modules/dsh-home.md)。安装后桌面 Harness **不读** `~/.dsh`。

## 安全边界（摘要）

- IPC 按 sender 角色区分 boot / harness / launcher / pet / pet-live2d（[modules/ipc-preload.md](modules/ipc-preload.md)）。
- 工作区路径受 `workspace-authority.js` 约束；FS / Git / 打开路径不得任意越权。
- Harness 与远程代理只认 loopback / 已配对通道（`local-url.js`、remote 鉴权）。

## 延伸阅读

- [modules/overview.md](modules/overview.md)
- [modules/boot-lifecycle.md](modules/boot-lifecycle.md)
- [appendix/shell-api.md](appendix/shell-api.md)
- 上游：[vendor/deepseek-harness/docs/architecture.md](../../vendor/deepseek-harness/docs/architecture.md)
