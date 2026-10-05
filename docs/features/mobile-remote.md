# Feature: 手机远程

| Field | Value |
| --- | --- |
| **id** | `mobile-remote` |
| **status** | `active` |
| **last verified (project audit)** | 2026-09-30 — LAN 静态页畸形请求 400、后续正常请求 200；仅本机/指定网卡/通配监听的实参、快照和落地 URL 对齐；编译后 remote/mobile/preview、daemon runner 与 stdio guard 合计 Node 74 项（71 pass / 3 skip：Windows 不支持 POSIX SIGTERM、dist 已存在时缺失 dist 分支、文件 symlink 权限），其中真实 daemon 随机端口 HTTP 通过；broken stderr 定向 2/2（含真实子进程）通过，网关 UI 51/51。公网中继与 Android 真机本轮未复测。 |
| **last verified (release lock)** | 2026-10-02 — Node 24.21.0 / npm 11.19.0 将根 `@types/node` override 固定为现有锁的 22.20.4，消除浮动范围解析到 22.20.5 的冲突；原失败 dry-run 通过。此前隔离安装因本地代理断连失败；当前代理实际下载原失败包并通过官方 SHA512 校验后，在新隔离目录执行 `npm ci --ignore-scripts` 成功，源锁与隔离锁 SHA256 均未变。不认证安装生命周期脚本或手机协议路径。此前证据见 [候选记录](../qa/results/2026-09-29-release-candidate/README.md)。 |
| **last verified** | 2026-09-29 — Android 原生聊天 debug APK 已保留数据覆盖安装到 `23124RN87C`；冷启动 sticky 重连、Compose 会话列表/历史、IME 返回、旧版页往返草稿及后台 WebView 无障碍隔离在该机通过。Web 315/315、Android `:protocol:test :app:testDebugUnitTest :app:assembleDebug`、49 项 APK 资源审计通过，APK SHA-256 `cf3f0363a1c9e3950a67b6fa7b7398e4e68c561fa8c7b09fcef81a5f33db81ef`。发送/流式/审批、新配对与正式签名升级未验收；见 [原生聊天阶段 QA](../qa/results/2026-09-29-mobile-native-chat/README.md)。此前 2026-09-29 — 连接前 Web／Android 入口改为鲸屿海平线明暗画布，并修正保存电脑把 `serverId` 当名称的问题：新连接优先保存 `server_info.hostname`，自动重连刷新名称，历史 sticky 直接回退「我的电脑」且不清数据；可选名称落盘失败不影响已建立的连接。Web 307/307、连接 QA 320／390／1280px、Android `:protocol:test :app:testDebugUnitTest :app:assembleDebug` 均通过；APK 内 48 个 Web 资源与源码逐字节一致，`missing`／`changed`／`unexpected` 均为空。debug APK 以 `adb install -r` 覆盖安装到设备 `23124RN87C`（序列号 `9TUCYX8TBI6DLRMZ`），保留数据后冷启动；真机浅色、深色、WebView → 原生扫码、扫码页粘贴返回，以及旧 `srv_*` 记录显示「我的电脑」均通过。旧中继本轮连接超时，真机未取得实时 hostname；该升级路径由连接测试覆盖。证据见 [2026-09-29-mobile-connect-horizon](../qa/results/2026-09-29-mobile-connect-horizon/README.md)。本轮未复测公网 relay、完整已配对聊天或正式签名升级。此前 2026-09-24 — 手机 Web 与 Android 连接／权限／扫码页改为 Claude 式结构；Web 302/302、资源测试 20/20、Android 构建与 fake host 十态截图通过，当时未做真机。此前 2026-09-08 — 公网链路迁移到 `https://ayase.cn/dshd/` + `ayase.cn:443`，真实 daemon + 公网 relay + 公网 SPA E2E 10/10。 |

## 当前改造轮次（2026-09-06）

**2026-10-04 Kotlin 原生迁移：** 用户要求 Android 改为 Kotlin 原生；现有 ChisaCode offer、认证和 E2EE wire 协议保持不变，由 Kotlin 实现通信与加密存储，Compose 接管聊天、工作区/目录/会话、Git 和设置。APK 不再内嵌 SPA，也没有旧版工作页入口；唯一升级读取器在原 asset origin 空白页迁移旧凭据与文字草稿，不执行 SPA、不联网。浏览器 Web 路径不变；实际构建与真机结果见对应 PR，历史验证不能认证本轮。

用户已批准[Web 与 Android 交互改造计划](../superpowers/plans/2026-09-06-mobile-web-android-interaction.md)。该轮的 Web 与 Android 本地候选及「共享网页为唯一聊天实现」属于历史基线；T1 公网 Web、适用 T2 LAN、T3 真机整体验收未完成，历史“Android 不签 / Deferred”不作为原生迁移豁免。[分轨证据](../../tools/mobile-web-qa/results/2026-09-06-interaction/README.md)不继承历史 Pass。浏览器仍用 Web SPA，Android 已配对聊天改由 Compose 绘制；短面板、全屏任务、返回与触控命中区按设计语言手机节执行。

## User paths

局域网落地页严格遵循网关的监听范围：仅本机时使用 `127.0.0.1:3180`，单网卡使用所选 IPv4，通配监听才选择可达 LAN IPv4。端到端加密会话仍通过 offer v2 中继，不把静态页监听地址用于开放无鉴权 daemon。

**入口已开放，默认关闭配对：** `REMOTE_FEATURE_ENABLED=true`；远程服务只在用户开启后启动，未配置时默认服务器模式。以下路径仍须针对最终 CI 安装包验收，不能继承历史停放期的 N/A。

1. 桌面开启配对且中继已连接 → 账户菜单「远程」打开 `#offer=` v2 二维码弹窗（账户入口未注册时从原侧栏「远程」行打开；局域网 `http://<LAN>:3180/` 本机 `mobile/web` SPA；外出 `DEFAULT_PUBLIC_APP_BASE_URL` 公网 nginx `https://ayase.cn/dshd/`）。系统相机打开浏览器公网页；App 内扫由 Kotlin 解析 offer，不加载公网 origin。浏览器 `DaemonClient` 与 Kotlin 客户端 经 `ayase.cn:443` TLS 中继完成 E2EE 握手 → `deviceSecret` 落盘（sticky）→ 已配对态。中继未连接时弹窗只显示状态，不展示二维码 / 复制链接 / 刷新配对码。
2. 再次打开手机 SPA（无 hash）：用最近一台已存 `deviceSecret` sticky 重连。「已保存的电脑」点选 / 忘记。跨 origin（公网 `/dshd`、LAN `:3180`、APK asset）不互通 sticky。
3. Android：原生扫码或粘贴完整配对 URL → Kotlin 客户端完成握手并保存加密凭据 → Compose 绘制聊天、会话列表、审批、工作区、Git 与设置。浏览器继续使用 SPA。
4. 配对之后 SPA 是正在跑的 `dsh web` 第二客户端（与桌面 BrowserView 同一进程）。LAN 与外出都走隧道（公网页碰不到 loopback）。Harness 未就绪：抽屉明示「桌面端未启动」，禁止画空的「新会话」假装已对齐。
5. 抽屉对齐桌面侧栏：`session.list` + `workspace.list`；按工作区分组 / 一个列表；搜索 `session.search`（snippet）；行 ⋯ 重命名 / Fork / 上移下移 / 归档；活会话 **没有删除**；已归档取消归档或删除；子智能体只读。
6. 新会话：已有工作区、无工作区文件夹、浏览本机目录（`host.listDirectory` / `host.createDirectory` / `workspace.create` / `session.create`）。禁止 `host.pickDirectory`、禁止 `createAgent`。
7. Composer：模型 + 思考 `session.models` / `session.selectModel`；权限与 Plan / 斜杠走 Typert `commands/execute`（`/permission <id>`、`/plan off`）；发送 `session.prompt`、停止 `session.cancel`；附件进 host；审批保持线协议 `respond`，由 daemon 将当前 Gateway 的 clientId/eventId 回复到 `/api/$events/result`。
8. 顶栏 Git 对齐桌面 titlebar：Init、分支搜索/切换/跟踪远端/**创建并检出**、stacked Commit/Push/PR、Publish、View PR。执行走隧道 `shell:git-*`，不是 ACP checkout。
9. 时间线：`session.history`（`beforeSeq` 向上分页）+ mux 或 1.5s 轮询（running / pending 时）。断线横幅 + 草稿；重连后 `session.list` + 当前 `history`。
10. Files / Diff / MCP / 技能：**冻结条**（「下一轮接 host/gitDiff；请暂时用电脑端」），禁止空列表装做成功能。

## MUST 矩阵（本轮交付物；缺一行不算完成）

对照源：桌面 BrowserView / `ui-workspace` / `ModelSelect` / `PermissionSelect` / `git-titlebar` + `GitActionsControl`。不是旧 ACP。

### A. 对话列表

- 同一批活会话：`session.list`。隐藏 `origin:'dshbot'`。`blank: true` **不出现在列表**（桌面复用 blank 作 New Session）。
- 按工作区分组 + 平铺：`workspace.list`。无用户自建「文件夹」。
- 工作区行：展开；`+` = `session.create({ workspaceId })`；⋯ 重命名 / 删除工作区 = `workspace.rename` / `workspace.delete`（unlist，不删磁盘）。
- 无目录：`session.create` 不带 workspaceId/cwd。
- 搜索：`session.search`（最多 20，有 snippet）。不得把「仅过滤已加载标题」写成与桌面同等。全文索引由桌面全量启动 overlay 打开（`openAt: first-search`），skip 恢复不传该 overlay。
- 行 ⋯：重命名 `session.rename`；Fork `session.fork`；归档 `workspace.archiveSession`。活会话 **没有删除**。
- 已归档：默认折叠、点行不打开；⋯ 取消归档 `workspace.unarchiveSession` 或删除 `session.delete`（仅已归档）。
- 子智能体：`parentSessionId` 折到父下；打开只读 composer。
- 状态点：至少 `running`。审批/计划等待用 mux 或 history 轮询补。
- 手动排序：`workspace.insertSessionBefore`（手机行菜单上移/下移）。
- **禁止：** `fetchAgents` / `createAgent` 当目录或新会话。Host `session.list` v1 一次返回全部：SPA 无假分页。

### B. 新工作目录

- 已有工作区点选 → 该 workspace 新会话或复用 blank。
- 无工作区文件夹。
- 添加本机目录：禁止 `host.pickDirectory`。用 `host.listDirectory` 浏览 + 可选 `host.createDirectory` + `workspace.create({ path })` + `session.create`。
- 浏览根：从已登记工作区路径的父级起步；创建后必须出现在 `workspace.list` 与桌面侧栏。
- 空白会话 hero：发出第一条消息前可改工作区；发出后不再用 chip 改 cwd。
- 可选：`agentPreset.list` + `session.create({ agentPreset })`；没有预设则隐藏，不得假控件。

### C. Composer

- 模型 + 思考：`session.models` + `session.selectModel({ provider, model, reasoningEffort })`。触发器文案 `模型 · effort`。无 reasoning 的模型隐藏思考档。
- 权限：切换 = Typert `commands/execute` 行 `/permission <id>`。失败回滚 + 可见错误。禁止本地假 `accessMode`，禁止把斜杠当 `session.prompt` 聊天。
- Plan：开启时显示 chip；点击 `commands/execute` `/plan off`。未开启则隐藏。
- 斜杠：`/` 拉取 `commands/list`；以 `/` 开头由 `commands/execute` 执行。禁止再打 daemon `listCommands` 当真相。
- 发送 / 停止：`session.prompt`（queue）+ `session.cancel`。
- 附件：image parts 进 host。
- Queue：history/projections 有队列才接 `session.updateQueue`；没有则不画假 dock。
- 只读子智能体 / 审批接管：替换输入区，不得在只读会话仍显示 Send。

### D. 顶栏 Git

对照 `git-titlebar.md` 与 `resolveGitQuick`。SPA `git/quick.js` 标签表保留；执行层走隧道 `shell:git-*`。

- 非仓库：**Initialize Git** → `gitInit`。
- 分支 pill：当前 ref；菜单 `gitBranchList`（搜索本地/远端）。
- 行点击切换；远端无本地跟踪 → `gitSwitchBranch` 的 track 语义；`switchable:false` 列出但禁用。
- **创建并检出** → `gitCreateBranch`。禁止「创建新分支请在电脑端」。
- 主按钮 stacked 一次做完：Commit；Commit & push；Commit, push & PR；Push；Push & create PR；Pull；View PR；Publish。禁止把 `commit_push` 做成只开 commit 对话框。
- Commit 对话框：可选说明、路径包含/排除、**Commit on new branch**。
- 无 origin：**Publish repository** → `gitPublishRepository`。禁止「请在电脑上发布仓库」。
- 分叉：Sync branch 禁用 + rebase/merge hint。
- 默认分支确认：Continue / Abort / Checkout feature branch & continue。
- 进度与失败：错误可复制；不得永久 loading。
- cwd 必须是已登记工作区（或子目录）；授权失败不得画成「没有分支」。

本轮 Git 顶栏不做：stash / merge / rebase / 改名删分支 / Fetch 按钮。Stage / Unstage / Discard 属已签字 DEFER（右栏 Diff）。

### E. 会话能用

- 打开：`session.history` 折成 `conversation/fold.js`；向上分页 `beforeSeq`；失败清旧行 + 重试。
- 直播：mux 经 E2EE（daemon 不转发 `assistant/chunk`；正文靠 `assistant/message` + history 轮询），或 history 短轮询（1.5s；仅 `running` 或有 pending 时）。禁止 `openEventSockets({ origin: location.origin })`。
- 审批：pending 来自 mux 或轮询；回答 `respond` → `POST /api/respond`。跨端解决后清 pending。
- 断线横幅 + 草稿 + 重连后 `session.list` + 当前 `history`。

## 已签字 DEFER（允许冻结，不允许装做成功能）

「请在电脑端操作」**只允许**出现在本段或 NEVER。

- 工作区「文件」「更改」tab 与设置里 MCP/技能：冻结条「下一轮接 host/gitDiff；请暂时用电脑端」。禁止转圈后空列表、禁止残留 ACP 错误当「没有文件」。
- 只读 Files/Diff 的旧契约（不写盘、不 Stage）下一轮仍有效；本轮不转发 `git-stage` / `unstage` / `discard`。
- MCP/技能写操作仍 NEVER（privileged）。
- 消息编辑/rewind、Trajectory、Context meter、Session log 下载、标题栏终端/表面开关、Generative UI：本轮不声称对齐。

## NEVER

- `host.pickDirectory`、`host.openPath`、全部 `PRIVILEGED_METHODS`（settings / credentials / `llm.discoverModels` / MCP 写 / skillInventory）
- 任意 `shell:*`：`pty*`、`writeFile`、打开本机路径（Git 对话框「在资源管理器打开」远程不做，用禁用 + 电脑端）
- 开放 `/api/*` 代理、恢复 HTTP offer v1、把 `:8411` 当 SPA、官方 `dsh web` 整页当手机 UI
- 给 daemon 注入 `DSH_HOME`、双写 `dsh-home`
- PTY 终端、Browser 预览、壁纸图库、市场安装、窗口外观、关闭窗口策略
- Android Bearer `/api`、与桌面 wire 不兼容的 E2EE 或设备凭证格式；未接真实 host 的原生假 Git／模型控件
- 把 `fetchAgents` / `createAgent` 当产品目录或新会话

## Invariants

- 手机 = **同协议客户端**（`mobile/web/chisacode/` + `@chisacode/client` bundle）。用户可见名称是 **dshd daemon / dshd offer / dshd 远程**；协议实现仍是 vendored ChisaCode offer v2，不改 pairing wire、包名或 sticky localStorage 键。配对之后两条已配对通道：host RPC（白名单 unary + `respond`）进 loopback `dsh web`；Git 进 Electron `git.js`（host **没有** Git API）。
- 白名单 unary：`host.describe` / `host.listDirectory` / `host.createDirectory`；`session.list|search|create|history|models|selectModel|rename|fork|prompt|attachment|updateQueue|cancel|delete`；`subagent.list|history|prompt|interrupt`；`workspace.list|create|rename|delete|insertBefore|insertSessionBefore|archiveSession|unarchiveSession`；`skill.list`、`agentPreset.list`、`llm.models` / `llm.providers`；Typert `commands/list`、`commands/execute`。外加 `/api/respond`。
- Git 白名单（进 main）：`git-status`、`git-fetch-status`、`git-pull-request`、`git-init`、`git-diff`、`git-commit`、`git-push`、`git-pull`、`git-create-change-request`、`git-publish`、`git-status-entries`、`git-branch-list`、`git-switch-branch`、`git-create-branch`。本轮不转发 stage/unstage/discard。
- 转发剥 Origin / Referer / 手机 Cookie / sec-fetch-*；Host = `127.0.0.1:<port>`；JSON 不 gzip；URL 必须仍是该 harness loopback。0.1.2 Host API：daemon 带桌面兑到的 `dsh.sessionCookie`（stdin `harness-cookie`），不得把手机 Cookie 转给 loopback；SPA 点名 `session.list` 落到 `/api/session/list`，payload 为 `{ args: { _request } }`。`workspace.list` 在 unary 404 时从 `/api/remote.mux` 的 `workspace/follow` 首帧 baseline 合成 `{ items, archivedSessionIds }`，禁止空目录冒充「没有工作区」。未配对拒绝。`getHarnessOrigin()` 随端口热更新。
- SPA 不得从 `host/offer.js` / `host/login.js` 进入 v1 Cookie 登录；扫描结果保留完整 `#offer=` URL。
- QR **落地页**：局域网 = `preferredLanIp():3180`；外出 = `DEFAULT_PUBLIC_APP_BASE_URL`（`https://ayase.cn/dshd/`），**不是**中继 `/ws`。
- **sticky 三 origin 不互通**。外出配对页使用 HTTPS，fragment 不发送到服务器；LAN `http://<LAN>:3180` 仍是明文，同网段 MITM 可读完整导航链接中的 `#offer=`。
- **一码两入口**：同一张 QR——Android App 内扫＝链接设备；相机 / 浏览器扫＝打开落地页自动连入 web 端。
- Offer v1 / `POST /__remote__/login` / RemoteGateway 配对 **退役**。
- 远程弹窗 QR 闸门只认 `[data-dsh-remote-qr]`；仅 `enabled && relayConnected && pairingUrl` 时提供二维码、复制与刷新。
- Android Compose 接管全部已开放移动端界面，Kotlin 直接使用白名单 Host/Git 隧道；设备凭据只进入加密存储与认证层，不传给 UI。异步回复、媒体结果和草稿校验电脑/会话归属。
- 助手 Markdown 禁止 `innerHTML` 注入：结构化 block → createElement；链接仅 http/https。
- 时间线向上分页按 seq 去重并保持滚动锚点。打开会话失败必须清掉上一会话 rows。
- 「已保存的电脑」是纯本地 sticky；「忘记」只清本机 secret。用户可见名称优先使用握手 `server_info.hostname` 并以可选 `computerName` 增量保存；历史 sticky 无名称时显示「我的电脑」，内部 `serverId` 只作连接键且不得显示为电脑名。
- 保存设备自动 / 手动重连与 offer 首连共用互斥连接入口；连接中显示状态，首次握手失败 / 超时关闭客户端并恢复按钮，不清 sticky。只有成功建立连接后才启用后台自动重连，避免初次失败永久占用选择器。
- 新 offer 取消未完成的旧连接，旧连接结果不得覆盖新连接。配对认证成功后，当前客户端立即改用 deviceSecret，自动重连不得复用一次性 pairingToken；消费后的 offer 从页面 fragment 清除。认证失败停止后台重试但不静默删除保存凭据。
- Android 的连接代次隔离迟到回复，Compose 重组不重复配对；返回前台用保存凭据恢复连接与目录同步，不重放一次性 offer。旧 localStorage 迁移失败必须可见，原数据保留。
- 手机目录转发保留全部 `session.list` 行和原始会话字段，投影只传 `title` / `sessionListMetadata`。模型、权限、计划与用量详情通过打开会话时的 history 按需获取，不能为每次首屏同步重复传输所有会话的详情；history、创建与搜索响应不受目录裁剪影响。目录失败必须可重试，不能假空列表。
- **非 secure context 兼容**：`http://<LAN-IP>:3180` 禁止裸用 `crypto.randomUUID` / `crypto.subtle`；uuid 走 `getRandomValues` fallback；E2EE 保持 tweetnacl。
- 已配对页颜色仍只取 `--dsw-alias-*` / `--dsw-specific-*` 同值表，不另起产品皮肤；连接／权限／扫码入口可用文档化的 `--mobile-connect-*` 与 Compose `DshConnectionPalette` 复述鲸屿海天语义，并仅在品牌字标使用展示衬线，禁止读取 `--boot-*` 或把该例外扩散进聊天。已配对页面结构按[设计语言「手机远程交互」](../design-language.md#手机远程交互)的 Claude 式结构：48px 顶栏、浮动输入卡、抽屉只做导航与「最近」、完整会话列表为全屏任务、输入框触发的选择用底部面板、设置为分组卡片。顶栏／行菜单仍是贴近触发器的 Menu，破坏性确认仍是居中 Modal。
- 全量启动才启用内容搜索：`--patch` `desktop-session-search.patch.yml` 覆写 `session-query-sqlite` 为 `openAt: first-search` 与 `dsh-home/session-query.sqlite`。禁止把这次 opt-in 写进用户 `cordis.patch.yml`。skip 启动保持发版 `openAt: never`。

## Allowed touch

- `mobile/web/`（含 `host/`、`chisacode/`、`conversation/`、`git/`）、`scripts/bundle-chisacode-mobile-client.mjs`、`scripts/prepare-dshd-remote.mjs`
- `src/main/dshd-remote.js`、`src/main/dshd-daemon-runner.mjs`、`src/main/dshd-daemon-hooks.mjs`、`src/main/dshd-git-dispatch.js`、`src/main/dshd-git-tunnel.js`、`src/main/mobile-web-server.js`、`src/shared/dshd-host-tunnel.js`、`src/shared/dshd-mux-sse.js`、`src/shared/lan.js`
- `vendor/chisacode-remote/`（线协议 `dshd.host.rpc.*` / `dshd.git.rpc.*` / `dshd.host.mux.*`）、`ui-settings-remote`、本卡、QA 远程条
- `vendor/deepseek-harness/packages/client/ui-settings/src/client/contract/slots.ts`、`ui-settings-account`、`docs/design-language*`、`docs/handbook/modules/settings.md`、`docs/handbook/modules/mobile-remote.md`、`docs/decisions/` — 账户菜单远程入口、手机视觉合同与原生迁移决策
- `tools/mobile-web-qa/`、`tools/remote-web-qa/`
- `mobile/android/`（Kotlin 协议/E2EE、Compose 界面、扫码 handoff、加密存储与升级迁移；2026-10-04 用户要求全部原生）

## Do not touch

- 恢复 HTTP Bearer Host SPA 为主路径
- 指着 `app.chisacode.sh` / `relay.chisacode.sh` 冒充完成
- 把中继 IP 当作 QR `appBaseUrl`
- 把「创建分支 / Publish / 思考强度 / 新目录浏览」再写成电脑端（那是需求降级）
- 给 daemon 注入 `DSH_HOME`

## Gates

| Kind | What |
| --- | --- |
| Automated | `mobile/web/**/*.test.js`（含 `app-cutover.test.js` 零 `fetchAgents`/`createAgent`；`host/*.test.js`；`git/stack.test.js` 的 `commit_push` 顺序；`git/bridge.test.js` 的 `gitCreateBranch`）；`src/shared/dshd-host-tunnel.test.js`（白名单外 403、非 loopback 拒转发）；`src/main/dshd-git-dispatch.test.js`（不转发 stage/pty/writeFile）；`src/main/dshd-remote.test.js`（运行时裁剪、`DSHD_HARNESS_ORIGIN`、不设 `DSH_HOME`）；Android JVM tests（`:protocol:test` PairingIntent；`:app:testDebugUnitTest` VIEW handoff） |
| Browser | `node tools/mobile-web-qa/run-qa.mjs`（fake **host** 会话，不单靠 fake ACP agents）；`node tools/remote-web-qa/run-e2e.mjs --relay <endpoint>`；`npm run qa:remote` |
| Manual | **全功能执行表：** [docs/qa/mobile-remote-full-web-cases.md](../qa/mobile-remote-full-web-cases.md)（P0 缺一行未填 = 未测完）。原生 Android 必须独立真机验收配对／保存设备重连、列表、历史／增量、发送／停止、审批、IME/Back、草稿隔离与错误恢复；旧 [T3 Deferred](../qa/mobile-remote-live-acceptance.md) 只是历史状态，不构成本轮签收。 |

## Sources

- Decision: [远程入口收束到账户菜单](../decisions/implemented/product/2026-09-23-remote-account-menu.md)
- Decision: [手机远程改用 Claude 式页面结构](../decisions/implemented/product/2026-09-24-mobile-remote-claude-structure.md)
- Decision: [Android 聊天主界面改为原生 Compose](../decisions/implemented/product/2026-09-29-mobile-native-chat.md)

- 2026-09-08 新域名部署与公网 E2E：[远程服务器迁移记录](../qa/results/2026-09-08/remote-ayase-deployment.md)。

- 2026-09-06 目录一致性复核：公网旧版模块的成员筛选缺失已定向部署修复，缓存版本 `20260906T034605Z`；本地与公网浏览器目录 fixture 均 Pass，三个发布文件的公网哈希一致。未替换桌面安装版，不记双端会话实机全量 Pass。证据见 [归档与目录差异](../../tools/mobile-web-qa/results/2026-09-06-session-catalog.md)；复测命令为 `node tools/mobile-web-qa/run-catalog-parity-qa.mjs <公网 SPA 根 URL>`。

- 首连失败回归：`mobile/web/chisacode/connect-lifecycle.test.js`（真实 bundle + 不响应 transport）；`node tools/mobile-web-qa/run-connect-qa.mjs`（受控连接失败与点选重试，390px / 1280px）。
- 公网定向验收：`node tools/mobile-web-qa/run-connect-public-qa.mjs`（使用正在运行的桌面，创建并在 finally 撤销专用 QA 设备）；[部署与现场证据](../../tools/mobile-web-qa/results/2026-09-05-connect.md)。
- 追加修复与未发布边界：[本地恢复回归](../../tools/mobile-web-qa/results/2026-09-05-recovery-local.md)。
- 后续公网复测（两轮超时，非实机 Pass）：[公网性能与实机状态](../../tools/mobile-web-qa/results/2026-09-05-public-retest.md)。
- 本机修复启用后双路径复测：[目录瘦身启用记录](../../tools/mobile-web-qa/results/2026-09-05-catalog-activation.md)。

- Vendored ChisaCode client/app pairing runtime
- Host RPC map：`vendor/deepseek-harness/packages/host/apiproxy/src/api/rpc-map.ts`；斜杠命令：Typert `POST /api/commands/list` · `POST /api/commands/execute`
- Git 标题栏：[git-titlebar.md](git-titlebar.md)
- 归档：[session-archive.md](session-archive.md)
- Kill list：[_kill-http-remote](_kill-http-remote.md)
- Web 全功能执行表：[../qa/mobile-remote-full-web-cases.md](../qa/mobile-remote-full-web-cases.md)
- 缺陷修复计划：[2026-09-02-mobile-remote-defect-remediation.md](../superpowers/plans/2026-09-02-mobile-remote-defect-remediation.md)
