# Feature: 远程设置

| Field | Value |
| --- | --- |
| **id** | `remote-settings` |
| **status** | `active` |
| **last verified (project audit)** | 2026-09-30 — HTTP 畸形 URL/Host 返回 400 且后续请求仍 200；监听实参与快照/配对 URL 对齐；daemon 端口修改触发真实测试子进程重启；TLS 假控件改为只读协议说明。编译后 remote/mobile/preview、daemon runner 与 stdio guard 合计 Node 74 项（71 pass / 3 skip：Windows 不支持 POSIX SIGTERM、dist 已存在时缺失 dist 分支、文件 symlink 权限），其中真实 daemon 随机端口 HTTP 通过；broken stderr 定向 2/2（含真实子进程）通过；网关 UI 51/51、所改 UI 文件 lint 与本包 i18n 扫描通过；未重跑公网 relay / 真机配对。 |
| **last verified** | 2026-09-25 — 失效监听地址修复：`ensureMobileWebServer` 把 `EADDRNOTAVAIL`/`EACCES` 翻成人话并指回「监听范围」（不静默回落通配、不改写配置），弹窗 `bindGone` 分类，已失效的已存地址在下拉标「已失效」，`ipcErrorMessage` 剥 IPC 包装。`dshd-remote` 37 pass（含 192.0.2.1 确定性 EADDRNOTAVAIL 回归）、`ui-settings-remote` 51/51、locale parity + verify-client-ui-i18n 7/7、包类型检查通过。此前 2026-09-24 — IM 的鲸鱼娘默认路由复用常驻会话；定向验证见本次变更。此前 2026-09-18 — 装机「开启远程→未响应」修复：主进程 `loadServerApi` 窄化为 `pairing-offer.js` + `relay-device-credential-store.js`（原 barrel ~3 万模块同步加载冻结主线程）；`DSH_VENDOR_PACKAGES` 改镜像 + parity 测试。`dshd-remote` 36 pass、`dshd-daemon-runner`/`remote-epipe`/`stdio-guard`/`lan`/`ipc` 80 pass、`ui-settings-remote` 45/45、`check:governance` 6/6、`npm run pack`（80.7MiB runtime、sqlite ABI probe、daemon probe、skip compose）、打包布局窄入口 import+铸码 68ms、真实 Electron `qa:remote` 双冷启动 11/11（含 cold.openShowsQr）。此前：2026-09-11 — rc.1 后 dsh-im 各 channel 的 caller-scoped webServer 注入已修复；dsh-im check 19 pass / 1 skip、官方 remote specs、真实 source smoke 与 package dry-run 通过。再前：2026-09-08 — 默认服务器切到 `ayase.cn:443` + TLS，公网 SPA 切到 `https://ayase.cn/dshd/`；旧内置 IP 精确迁移、自定义服务器保留。VPS relay 容器 `healthy` / 0 restart，nginx live 与候选配置通过；Node 远程聚焦 92 pass / 0 fail / 1 环境 skip，设置 UI 10/10，公网目录一致性通过，真实 daemon + 公网 relay + 公网 SPA E2E 10/10。未执行真机相机、Android WebView 或正式安装包升级验收。 |

## User paths

**当前可用：** `REMOTE_FEATURE_ENABLED=true`；远程是否开启仍由用户控制。

1. 设置 → 「远程」（`remote`）→ **网关**：选 **局域网 / 服务器**（文案区分；扫码传输都经中继）；中继主机默认内置 `ayase.cn:443`，使用 TLS。**无宿主令牌墙**。
2. 设置 → 「远程」→ **消息渠道**：桌面内置 `@xmanrui/dsh-im` 完整 IM UI（九渠 + AI Office）；无商店品牌头。鲸鱼娘 IM 默认接入由 `whale-assistant` 卡定义：指向常驻会话，显式其他预设仍走独立会话。
3. 侧栏底部手机图标打开配对弹窗：开关 → 中继状态；中继已连接才显示扫码二维码 / 复制链接 / 刷新配对码 → 已配对设备 / 重命名 / 解除配对。

## Invariants

- 局域网配对页的监听地址严格采用 `remoteBindAddress`；`127.0.0.1` 不得转换为通配地址，快照和配对 URL 与监听范围一致。daemon 保持 loopback，`remotePort` 控件修改真实 daemon 端口并触发重启；配对静态页独立使用 3180。
- 网关不提供无效的 LAN TLS 开关。手机会话使用 offer v2 的端到端加密，中继 TLS 由中继主机配置决定；LAN 配对静态页使用 HTTP，页面明确说明这三个边界。旧 `remoteLanTls` 持久值不构成启用 TLS 的证据。
- LAN 静态页的畸形 URL、Host 或百分号编码返回 HTTP 400，不得进入主进程未捕获异常处理或弹出系统错误对话框。

- 全部 IM 渠道访问同进程本机 Harness 时通过 `harness-auth-transport.mjs` 复用 `connection.authenticatedUrl` / `authorizeIndex` 换取 Cookie，覆盖 HTTP 与事件 WebSocket；不读取签名密钥、不取消鉴权、不向自定义外部地址或重定向发送本机凭据。旧版无认证 API 保持原行为。
- 检测到 `typertGateway.wireStream` 时使用 `harness-modern-transport.mjs`：旧点式 RPC 映射到当前 Remote API；健康检查取 `$events` ready，工作区/历史取真实 baseline/snapshot；prompt 的 `requestId` 保持原 RPC 归属；审批/问答经 `$events/result` 回传，停止不能越过原 IM 会话的所有权。不得只让健康检查变绿、继续调用已移除的接口。飞书 SDK 补丁先归一 CRLF，仍逐个严格检查源码片段。

- 连接方式文案为「局域网 / 服务器」；未设置时默认服务器（内部值 `relay`），局域网仅在明确选择 `lan` 时使用。既有显式选择保留，不自动开启远程。
- 新安装与空配置使用 `ayase.cn:443` + TLS。升级时，只有精确匹配旧内置中继 `125.124.85.212:8411` 的保存值迁移到新默认；其他自定义中继地址及其 TLS 选择保持不变。旧内置公网页 override `http://125.124.85.212:3389/dshd` 清回默认解析，使二维码落到新公网页。

- **停放开关：** `src/main/config.js` `REMOTE_FEATURE_ENABLED`。false 时 preload 不暴露 `getRemote`/`saveRemote`/`rotateRemoteToken`/`revokeRemotePairingLink`/`unbindRemoteDevice`/`renameRemoteDevice`，`ui-settings-remote` 不注册侧栏与设置入口；`normalizeRemoteConfig` 把 `remoteEnabled` 钉死为 false；IPC `shell:save-remote` 无法打开。解禁只翻这一处（window argv `--dshd-remote-feature` 跟它走）。
- **配对协议 = dshd offer**（实现为 vendored ChisaCode offer v2）：全量 `createChisaCodeDaemon` 跑在 `dshd-daemon-runner.mjs` 子进程（**禁止**回迁主进程）；主进程 `DshdRemote` 只是进程管理面 + file-backed 配对/快照；QR `appBaseUrl`：局域网 = `preferredLanIp():3180`，服务器 = `DEFAULT_PUBLIC_APP_BASE_URL`（`https://ayase.cn/dshd/`），**禁止**把中继 `/ws` 当 SPA。用户可见文案称 dshd daemon / dshd 配对，不出现 ChisaCode 品牌名。
- **主进程窄 import**：`loadServerApi` 只引 `pairing-offer.js` + `relay-device-credential-store.js` 两个兄弟模块并镜像 `DSH_VENDOR_PACKAGES`（parity 测试钉住 vendored 源）；`exports.js` 全量 barrel（数万模块，ESM 同步加载会冻结主线程）只允许经 launch file 进 daemon 子进程。
- **daemon 子进程契约**：runner 在 `asarUnpack`；stdout 只有 JSON 行（控制行 + pino json）；stdin `stop` 与 stdin 关闭都必须优雅停（孤儿零容忍）；意外退出必须落 `snapshot.error` 并保留弹窗重试；不做自动退避重启循环（对齐上游）。
- **DSHD_* 命名桥**：桌面对外只有 `DSHD_CHISACODE_HOME`（打包需 `DSHD_ALLOW_ENV_HOME=1`，同 dsh-home 守卫）与 `DSHD_DSH_VENDOR_DIR`；`CHISACODE_*` 只允许出现在 daemon 子进程 env 注入处，主进程自身 env 与 PTY / `dsh web` 子进程永不携带；字面量 `DSHD_HOME` 属 dsh-home 卡，不可占用。DEEPSEEK 凭据只经 `official-deepseek-env` 白名单入子进程 env，launch JSON 永不含密钥。
- `snapshot.starting` 表示 daemon 启动请求尚未结束；`relayConnected` / `relayError` 反映真实 relay control。开启、daemon 启动和首次中继握手期间，二维码位置显示 196×196 加载框；listener、中继和配对链接就绪后显示二维码。最终启动失败、明确的中继错误和状态读取失败退出加载，保留错误与重试入口。
- 源码启动若缺 `dist` 会构建 ChisaCode server；pack/dist 额外组装并验证 production daemon 依赖，禁止靠构建机残留产物。
- 侧栏 QR 仅客户端 `qrSvg(pairingUrl)`（`includeQr: false`）。
- 服务器中继禁止 `chisacode.sh` / 上游 `account_id`。AGPL：`AGPL-SHIPPING.md`。内置 `ayase.cn:443` 是 **TLS 传输默认**，不可作 SPA；公网 SPA 由同域 nginx 提供 `https://ayase.cn/dshd/`，中继只占精确 `/ws` 与 `/health` 路由。
- 二维码使用短期、一次性的 pairing token；`pairingExpiresAtMs` 到期后自动补发，启动与状态轮询不得并发铸码或把已就绪的码清空。复制链接使用独立 `pairingLinkUrl` 长期凭证，不随二维码刷新、首次使用或应用重启过期；显式「撤销配对链接」废止旧链接并生成新链接。链接仍通过 offer v2 / E2EE 配对，每台新设备各自取得 `deviceSecret`；撤销链接不解除已经配对的设备。
- 粘性：`deviceSecret` 直至用户解除配对；刷新 QR 只换短期 pairing token。Cloudflare 中继替换 daemon 数据连接时，现有客户端重新连接并进行加密握手、设备证明；旧数据连接迟到的 close 回调不能断开正在使用替代连接的客户端。
- **设备名（2026-09-04 起）：** 配对 hello 的 `relayDeviceAuth.deviceName`（append-only 协议字段，trim 后 1–120）是客户端自报的设备名——手机配对页从 UA 派生（`iPhone · iOS 18.2` / `Android 15 · Pixel 8` / `电脑`，兜底 `设备`，见 `mobile/web/chisacode/session.js#deviceNameFromUa`），daemon 存为 device label（旧客户端兜底 `relay-pair`）。改名走 IPC `shell:rename-remote-device` → `DshdRemote.renameDevice` → `RelayDeviceCredentialStore.renameDevice`（文件落盘、幂等、封顶 120、拒绝已吊销）；两条标签写入路径（签发/改名）都归一 120 预算——`DeviceRecordSchema` 在加载时封顶 `label`，超长持久化标签会让整个 store 文件加载失败。存量 `relay-pair` 行不自动改，用户手动改名即迁移。fork 合同见 `vendor/chisacode-remote/DESKTOP-FORK.md`。
- dsh-im 桌面内置：insert 在自有 overlay `desktop-plugins/dsh-im/desktop-dsh-im.patch.yml`，`--patch` 叠加（full+skip）；`cordis.patch.yml` 不写受管块（只 strip 迁移）；禁插件 / Recovery 不可关（IPC 返回 `desktop-builtin`，config 归一化剔除别名）；vendor 运行时缺损 fail start（skip 修不了）。
- 渠道主操作 36px（飞书扫码无 `size=small`）。
- **断管不崩**：vendored `resolveDshVendorDir` 的 `execSync` 必须携带显式 `stdio`（tripwire 在 `remote-epipe.test.js`）；主进程 stdout/stderr 常驻 `stdio-guard`（断管类流错误吞掉，uncaughtException 仅吞断管写入、其余复刻 Electron 默认对话框）。
- 弹窗失败态可见：持久失败人话（端口占用 / 监听地址失效 `bindGone` / 通用）；未就绪时 On 可重试；打开弹窗立刻 refresh 且缺码时至多一次 sync 自愈，已有启动不重复 sync。启动期间不显示上轮错误，旧轮询不能覆盖操作结果；慢轮询不重叠。弹窗无 raw relay code、无裸 `#offer=` 文本；`HarnessController` 关停走 `stopDaemon()`，引导期 sync 失败必进 dsh 日志。
- 持久化单网卡监听地址失效（`EADDRNOTAVAIL`/`EACCES`）时报人话并指回「监听范围」改选；禁止静默回落 `0.0.0.0` 扩大监听面、禁止归一化时改写仍为合法 IPv4 的已存地址；下拉里已失效的已存地址标注「已失效」。
- `qa:remote` 必含 `cold.openShowsQr` / `cold.noBareOfferText` / `cold.copyAndRotateControls`；第二 Electron 冷 boot（`DSH_QA_REMOTE=cold`，开窗前禁止 `setRemote`）；QR 只认 `[data-dsh-remote-qr]`；中继未连时这三条断言「无码 + 无复制/刷新 + 有 status」。`prestart-ensure` 校验 `copyLink` / `data-dsh-remote-copy-link`。
- 桌面 harness 完备（12 个 dsh vendor 包均有 `lib/index.js`）时才向**子进程**注入 `CHISACODE_DSH_VENDOR_DIR`；优先级 `DSHD_DSH_VENDOR_DIR` > 继承的 `CHISACODE_DSH_VENDOR_DIR` > 完备自带目录 > 不设（子进程内保留已加固的 npm 全局回退）。
- `dsh-acp-demo` shim 仅在 harness acp-demo 构建产物存在时物化（`<home>/bin`，prepend 子进程 PATH）；产物缺失时 provider 如实显示不可用，禁止伪造可用性。

## Allowed touch

- `vendor/chisacode-remote/`、`src/main/dshd-remote.js`、`src/main/dshd-daemon-runner.mjs`、`src/main/index.js`、`src/main/mobile-web-server.js`、`src/main/stdio-guard.js`
- `vendor/deepseek-harness/packages/client/ui-settings-remote/`
- `src/main/remote-patch.js`、`config.js`、`src/shared/lan.js`、`ipc.js` / preload Remote IPC
- `src/main/dsh-im-desktop.js`、`harness-controller.js`、`plugin-forensics.js`
- `vendor/dsh-im/`、本卡、[mobile-remote](mobile-remote.md)、[_kill-http-remote](_kill-http-remote.md)

## Do not touch

- 自研中继冒充移植；daemon/hello 切片
- 恢复 HTTP 宿主令牌墙
- 把中继 IP 填进 `remoteAppBaseUrl` / QR 落地
- 把 dsh-im 退回可禁用户插件

## Gates

| Kind | What |
| --- | --- |
| IM | `npm --prefix vendor/dsh-im run test:desktop`；`DSH_IM_LIVE_TEST=1 node --test vendor/dsh-im/host-protocol-live.test.mjs`；`node vendor/dsh-im/plugin-src/host/build.mjs`；真实平台账号收发不以模拟测试代替 |
| Automated | `dshd-remote.test.js`；`dshd-daemon-runner.test.js`（runner 协议 + dist-gated 真实 daemon 端到端）；`remote-epipe.test.js`；`stdio-guard.test.js`；`lan.test.js`；dsh-im-desktop / skip-compose；ui-settings-remote specs；`mobile/web/chisacode/session.test.js`（配对 deviceName 上报） |
| Manual | 中继已连接 → 扫码配对 → sticky 重连 → 解除；Windows 打包机：子进程隔离下配对 + 强杀主进程无孤儿 daemon；dev 机（harness 已构建）：手机端 dsh provider 建会话 |

## Sources

- Decision: [全面审查修复](../decisions/implemented/bug-fix/2026-09-30-project-audit-fixes.md)

- Decision: [远端 CLI 身份文件回落到绝对 home](../decisions/proposed/bug-fix/2026-09-19-remote-home-identity-isolation.md)
- Decision: [远程失效监听地址的人话错误与下拉标注](../decisions/implemented/bug-fix/2026-09-25-remote-stale-bind-address.md)

- [2026-09-08 ayase.cn 远程服务器迁移](../qa/results/2026-09-08/remote-ayase-deployment.md)
- Plan：gateway_product_redo / fix_qr_pairing / [2026-08-28-remote-epipe-hardening](../superpowers/plans/2026-08-28-remote-epipe-hardening.md)
- Vendored：`vendor/chisacode-remote/DESKTOP-FORK.md`
