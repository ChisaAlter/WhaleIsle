# Feature: Launcher-managed components（启动器组件平台）

| Field | Value |
| --- | --- |
| **id** | `launcher-components` |
| **status** | `implemented` |
| **last verified** | 2026-11-23 |

历史验证与变更记录见 [docs/history/launcher-components.md](../history/launcher-components.md)。

## User paths

1. 用户在启动器「组件」分区浏览与安装官方上游 [Magpie CLI](https://github.com/yetone/magpie)（`magpie-cli`）。
2. 启动器优先复用本机已存在的 Magpie 安装与 `~/.config/magpie` 配置目录；如果本机已有网关（默认 `127.0.0.1:3425`）但尚未开启 Web 界面，受管程序仅作为 `--addr 127.0.0.1:<port> --no-open` UI 伴生实例接入同一配置与网关，不与外部网关冲突。
3. 用户点击「打开设置」时，WhaleIsle 在原生 `BrowserWindow` 壳窗（38px 宿主标题栏）内通过零注入 `WebContentsView` 直接加载上游 Magpie Web UI。
4. 曾安装旧版「鲸桥（WhaleBridge）」的用户在检测或安装 Magpie 时自动迁移配置到 Magpie（只读旧数据、带回滚状态机、安全合并并去重 `usage.jsonl`、按 token 新鲜度保留凭据、完成后自动断开旧 DSH `whalebridge` 渠道）。
5. 受管安装支持在启动器内检查新版本、原地升级与一键回滚，并支持卸载或单独清理配置；外部安装的 Magpie 保持只读保护，不在启动器内强杀或覆盖用户自有二进制，升级时打开官方 Release 页面。

## Magpie 组件生命周期与迁移边界

- **发布与校验**：GitHub 线路经由 `https://github.com/yetone/magpie/releases/latest` 重定向与 `SHA256SUMS` 解析最新版本（无匿名 REST API 配额消耗）；CNB 线路从仓库 CNB Release 读取 `magpie-v<version>` 及 `SHA256SUMS`。下载暂存后校验字节大小与 SHA256，切换时将二进制设为只读，在不修改用户 `settings.json` 的前提下阻止上游程序自更新与生命周期竞争。
- **零注入外壳**：`src/main/magpie-window.js` 使用 `persist:magpie` 会话，仅允许本机 loopback `http://127.0.0.1:<port>` 与 `?theme=dark|light` 渲染上游界面，不挂 `preload`、不注入 CSS/JS，仅将 `http(s)://` 外部 OAuth/外链交还系统默认浏览器打开。
- **并发保护**：停止、切换版本、回滚或卸载前，通过 `/v1/magpie/concurrency` 检查活跃请求、排队任务与子工具状态；存在运行中工作时拒绝切断连接。
- **退出与随动**：Launcher 关闭前回收受管 `magpie-cli`；桌面端直接启动时通过 `ensureMagpieRuntime` 恢复已安装组件。通过 DSH 同步网关确保外部 Magpie 与受管进程共用正确端口及令牌。
- **旧版 WhaleBridge 下线**：不再编译、分发或维护 Go 源码分叉，不再轮询 `/api/subscriptions/alerts/claim`；历史组件产物仅在自动化升级迁移中按只读源读取。

## Invariants

- 任何安装、升级、迁移或 DSH 同步都不得覆盖、终止或清理外部用户自管的 Magpie 进程与配置。
- `BrowserWindow` 壳层的窗口控制 IPC 仅接受来自 `file:` 主框的 `magpie-shell.html` 请求，内容 `WebContentsView` 绝不拥有 `preload` 或 Node/IPC 能力。
- 迁移写入先落事务状态 `migration-state.json` 与备份，任何步骤失败均可原子回滚到迁移前快照；冷拷贝与合并场景按固定字段重写旧相对路径、保留较新 OAuth token，并去重用量记录。
- 组件操作锁与 DSH 主更新锁相互隔离，组件故障不得阻塞启动器或桌面主路径。

## Allowed touch

- `src/launcher/magpie/` — 发布解析、状态检测、旧配置迁移、DSH 同步与生命周期控制
- `src/launcher/components/`、`src/renderer/launcher-components.js`、`src/main/ipc-components.js` — 组件注册、声明式能力映射与启动器交互
- `src/main/magpie-window.js`、`src/preload/magpie-shell.js`、`src/renderer/magpie-shell.*` — 38px 外壳与零注入 `WebContentsView`
- `.github/workflows/magpie-cnb-mirror.yml`、`scripts/sync-magpie-cnb.mjs` — CNB 镜像同步

## Do not touch

- `vendor/deepseek-harness` 插件市场、`marketplace-install.js` 的 profile 锁、HarnessController 生命周期
- 外部用户已运行的 `magpie` 网关进程与任意未授权数据目录

## Gates

| Kind | What |
| --- | --- |
| Automated | 发布清单与 `SHA256SUMS` 校验、4 态复用检测、Scenario A/B/C 迁移与回滚、启动/停止并发锁、升级与回滚、零注入窗口与外链安全、CNB 镜像同步 |
| Manual / QA | 本机已装 Magpie 复用、冷装受管 Magpie、旧版鲸桥自动迁移、启动器内升级与回滚、Shell 窗口打开上游 Web UI |

## Sources

- Impl: `src/launcher/magpie/`、`src/main/magpie-window.js`、`src/main/ipc-components.js`、`scripts/sync-magpie-cnb.mjs`
- Decision: [跨平台入口与 CI 修复](../decisions/implemented/bug-fix/2026-09-28-clean-ci-portability.md)
