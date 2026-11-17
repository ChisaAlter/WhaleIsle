# mobile-remote · 历史记录

自功能卡 [docs/features/mobile-remote.md](../features/mobile-remote.md) 迁入（2026-11-17，议题 #458）；以下为该卡原有的历史验证与变更记录，原样保留。

## last verified 记录

| Field | Value |
| --- | --- |
| **last verified (project audit)** | 2026-09-30 — LAN 静态页畸形请求 400、后续正常请求 200；仅本机/指定网卡/通配监听的实参、快照和落地 URL 对齐；编译后 remote/mobile/preview、daemon runner 与 stdio guard 合计 Node 74 项（71 pass / 3 skip：Windows 不支持 POSIX SIGTERM、dist 已存在时缺失 dist 分支、文件 symlink 权限），其中真实 daemon 随机端口 HTTP 通过；broken stderr 定向 2/2（含真实子进程）通过，网关 UI 51/51。公网中继与 Android 真机本轮未复测。 |
| **last verified (release lock)** | 2026-10-02 — Node 24.21.0 / npm 11.19.0 将根 `@types/node` override 固定为现有锁的 22.20.4，消除浮动范围解析到 22.20.5 的冲突；原失败 dry-run 通过。此前隔离安装因本地代理断连失败；当前代理实际下载原失败包并通过官方 SHA512 校验后，在新隔离目录执行 `npm ci --ignore-scripts` 成功，源锁与隔离锁 SHA256 均未变。不认证安装生命周期脚本或手机协议路径。此前证据见 [候选记录](../qa/results/2026-09-29-release-candidate/README.md)。 |
| **last verified** | 2026-09-29 — Android 原生聊天 debug APK 已保留数据覆盖安装到 `23124RN87C`；冷启动 sticky 重连、Compose 会话列表/历史、IME 返回、旧版页往返草稿及后台 WebView 无障碍隔离在该机通过。Web 315/315、Android `:protocol:test :app:testDebugUnitTest :app:assembleDebug`、49 项 APK 资源审计通过，APK SHA-256 `cf3f0363a1c9e3950a67b6fa7b7398e4e68c561fa8c7b09fcef81a5f33db81ef`。发送/流式/审批、新配对与正式签名升级未验收；见 [原生聊天阶段 QA](../qa/results/2026-09-29-mobile-native-chat/README.md)。此前 2026-09-29 — 连接前 Web／Android 入口改为鲸屿海平线明暗画布，并修正保存电脑把 `serverId` 当名称的问题：新连接优先保存 `server_info.hostname`，自动重连刷新名称，历史 sticky 直接回退「我的电脑」且不清数据；可选名称落盘失败不影响已建立的连接。Web 307/307、连接 QA 320／390／1280px、Android `:protocol:test :app:testDebugUnitTest :app:assembleDebug` 均通过；APK 内 48 个 Web 资源与源码逐字节一致，`missing`／`changed`／`unexpected` 均为空。debug APK 以 `adb install -r` 覆盖安装到设备 `23124RN87C`（序列号 `9TUCYX8TBI6DLRMZ`），保留数据后冷启动；真机浅色、深色、WebView → 原生扫码、扫码页粘贴返回，以及旧 `srv_*` 记录显示「我的电脑」均通过。旧中继本轮连接超时，真机未取得实时 hostname；该升级路径由连接测试覆盖。证据见 [2026-09-29-mobile-connect-horizon](../qa/results/2026-09-29-mobile-connect-horizon/README.md)。本轮未复测公网 relay、完整已配对聊天或正式签名升级。此前 2026-09-24 — 手机 Web 与 Android 连接／权限／扫码页改为 Claude 式结构；Web 302/302、资源测试 20/20、Android 构建与 fake host 十态截图通过，当时未做真机。此前 2026-09-08 — 公网链路迁移到 `https://ayase.cn/dshd/` + `ayase.cn:443`，真实 daemon + 公网 relay + 公网 SPA E2E 10/10。 |
