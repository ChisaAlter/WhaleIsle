# 模块：手机远程

## 职责与非目标

**职责：** LAN / 中继远程、ChisaCode 配对、已配对后将浏览器 `mobile/web` SPA 与 Android 原生 Compose 聊天接到正在跑的 `dsh web`。Android 的协议、存储和界面均由 Kotlin 原生代码负责。
**入口已开放：** `REMOTE_FEATURE_ENABLED=true`，默认关闭配对；远程服务只在用户开启后启动。
**非目标：** 不把启动页仪器风或官方 CSS Modules 整树嵌进手机；不把 PTY、Browser、`writeFile`、`host.pickDirectory` 暴露给手机；保持 ChisaCode 认证和 E2EE wire 协议，不为 Git／文件画无效原生控件。

## 用户路径

见 [../flows/remote-pair.md](../flows/remote-pair.md)。契约以 [手机远程 Feature 卡](../../features/mobile-remote.md) 的 MUST 矩阵为准。

## 架构要点

- 配对：vendored ChisaCode offer v2 / sticky / 中继 E2EE。QR 落地页局域网 `:3180`、外出 `https://ayase.cn/dshd/`；传输走 `ayase.cn:443` 的 `/ws`，不把中继路由当页面。成功握手的 `server_info.hostname` 作为可选 `computerName` 写入手机 sticky，供保存电脑行与已连接主机名称使用；旧 sticky 无此字段时显示「我的电脑」，不得展示内部 `serverId`。
- 已配对 host：daemon 白名单 unary 转发 loopback `dsh web`（剥 Origin / sec-fetch，Host 钉 loopback）。当前 Gateway 审批从 `$events` waterfall 转换为手机审批帧，回复保留 clientId/eventId 经 `/api/$events/result` 返回；旧格式 rpcId 仍走原 `/api/respond`。
- Android 使用 `session.projections` 读取完整模型、权限及 Plan 投影；历史页不携带这些状态。Host 白名单仅新增这一只读方法。
- 会话与工作区：`session.list` / `workspace.list` 是目录真相，`session.history` 供时间线；新会话走 `session.create`，目录浏览/创建/登记走 `host.listDirectory` / `host.createDirectory` / `workspace.create`。模型/思考走 `session.models` / `session.selectModel`，权限、Plan 和斜杠走 Typert `commands/execute`，不回退 ACP agents。
- 已配对 Git：daemon 回调 Electron `git.js`（`dshd-git-dispatch.js`），同一套 `workspace-authority.js`。不在 daemon 里再实现一套 git CLI。
- Git 用户路径：分支搜索/切换/远端跟踪、创建并检出分支、Commit/Push/PR 组合动作与 Publish 均走 `shell:git-*` 白名单；不是「创建分支请到电脑端」。修复已进入当前本地候选，构建通过不代替整轨行为验收。
- Web：`mobile/web` + `--dsw-alias-*` tokens。短面板与全屏任务复用 `ui/surfaces.js` 的头部/正文和焦点范围；`ui/navigation.js` 协调网页与原生返回。Files / Diff / MCP / 技能仍为冻结条。
- Android：`mobile/android` 的 Kotlin `protocol` 模块实现 offer、挑战凭据认证与中继 E2EE；Compose 负责聊天、分页/增量历史、审批、工作区/会话/目录、Git 和设置。加密存储按电脑/会话保留凭据与文字草稿，系统媒体请求校验归属。IME 返回先收键盘，前台恢复同步目录和连接；一次性 offer 不用于重连。
- Android 升级：包名保持稳定，versionCode 3 / versionName 0.2.0；不再打包 Web SPA。唯一临时 WebView 在原 asset origin 的空白页读取旧 localStorage 后销毁，禁止网络，不执行 SPA 或协议，旧数据不删除。迁移完成前不写成功标记。正式签名升级需要独立确认。

## 实现入口

- `src/main/dshd-remote.js`、`dshd-daemon-runner.mjs`、`dshd-daemon-hooks.mjs`、`dshd-git-tunnel.js`、`mobile-web-server.js`
- `src/shared/dshd-host-tunnel.js`、`src/main/dshd-git-dispatch.js`
- `mobile/web/app.js`、`mobile/web/native-bridge.js`、`mobile/web/host/`、`mobile/web/git/`
- `mobile/web/ui/navigation.js`、`mobile/web/ui/surfaces.js`；交互动效见 [motion 手机 inventory](../../motion.md#手机交互-inventory)
- `mobile/android/app/src/main/java/ai/deepseek/harness/mobile/` 下的 `DshViewModel.kt`、`ui/NativeChatScreen.kt`、`ui/NativeHistory.kt`、`ui/NativeRemoteScreen.kt`、`NativeImagePicker.kt`、`LegacyStorageMigration.kt`；`mobile/android/protocol/src/main/kotlin/ai/deepseek/harness/mobile/remote/`；`mobile/android/app/build.gradle.kts`
- `tools/mobile-web-qa/server.mjs`（支持动态端口与 `/dshd/` 的本地 fixture）、`runtime-assets.mjs`（资源清单/审计）
- 全量启动内容搜索 overlay：`src/main/session-search-overlay.js`（`--patch`，产品契约见 desktop-launcher）
- [mobile/README.md](../../../mobile/README.md)

## 不变量

- 手机页是文档化例外：语义色一致，不挂官方插件树，不用 `--boot-*`。
- 配对后产品真相是桌面 `dsh web` 会话，不是 ACP `chisacode-home/agents`。
- `workspace.create` 的 id 在嵌套 `workspace` 视图里；活列表仍隐藏 blank，但当前打开的 blank 必须能当 `currentRow`，否则顶栏和抽屉会丢行。
- 不给 daemon 注入 `DSH_HOME`、不双写 `dsh-home`。
- Host / Git 白名单见 Feature 卡；白名单外拒绝转发。
- history 只存安全视图标记，不序列化凭证/草稿或在返回时重放写请求；迟到返回回调和附件结果必须仍属于当前请求/会话。
- Android 包名与 asset origin 保持稳定；生产覆盖升级必须核对同签名及递增 versionCode，不通过卸载、清数据或更换 debug 签名绕过验证。

## 安全边界（LAN 模式）

LAN 配对静态页使用 HTTP 3180，只分发 `mobile/web` 应用文件；offer 留在 URL fragment，手机会话仍经 offer v2 中继使用端到端加密。中继传输默认 TLS，自定义中继的 TLS 由中继主机配置决定。HTTP 静态页本身没有 TLS，仍只适合可信网络；不可信网络使用 HTTPS 公网页或 原生 Android 客户端。

- **监听范围**（`remoteBindAddress`）：全部网卡 / 仅本机 `127.0.0.1`（默认）/ 指定网卡 IPv4。仅本机不得转换成通配地址；配对 URL 使用 loopback、所选 NIC 或通配监听下的可达 LAN IP，快照与监听一致。
- **监听端口**（`remotePort`）：loopback daemon 端口，默认 6767；更改后重启 daemon，静态页仍用 3180。静态页监听范围不会开放无鉴权 daemon。
- **传输加密**：网关显示上述端到端加密、中继 TLS 和 LAN HTTP 边界，不提供未实现的自签 LAN TLS 按钮；旧 `remoteLanTls` 配置不改变当前 offer v2 链路。
- 静态页的无效 URL、Host 和百分号编码返回 400，不影响 Electron 主进程或后续正常请求。

## 门槛

- 以 [手机远程 Feature 卡](../../features/mobile-remote.md) 与 [实机全量用例](../../qa/mobile-remote-live-acceptance.md) 为准；改 UI 遵守 design-language 手机 / Android 例外段。
- 2026-09-06 本轮不继承旧 T3 Deferred 豁免。当前本地 APK 已构建且 JVM/资源审计通过，不等于 T1/T2/T3 实机 Pass。早期候选的 60/60 六尺寸受控 DOM 检查不认证最新修订，snap 状态也不是动效、软键盘或真机证据；最终源复测因 T3 Code preview 的 evaluate/snapshot/navigate 工具超时未完成，公网与物理设备未验收。详见[本轮证据](../../../tools/mobile-web-qa/results/2026-09-06-interaction/README.md)及[候选打包记录](../../../tools/mobile-web-qa/results/2026-09-06-interaction/packaging.md)。

## 延伸阅读

- [../superpowers/specs/2026-08-20-mobile-web-client-design.md](../../superpowers/specs/2026-08-20-mobile-web-client-design.md)
- [../superpowers/specs/2026-08-23-mobile-android-client-design.md](../../superpowers/specs/2026-08-23-mobile-android-client-design.md)
- [../superpowers/plans/2026-08-25-mobile-web-scan-android-parity.md](../../superpowers/plans/2026-08-25-mobile-web-scan-android-parity.md)（Web 扫码 + 与 Android 对齐）
