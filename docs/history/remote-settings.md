# remote-settings · 历史记录

自功能卡 [docs/features/remote-settings.md](../features/remote-settings.md) 迁入（2026-11-17，议题 #458）；以下为该卡原有的历史验证与变更记录，原样保留。

## last verified 记录

| Field | Value |
| --- | --- |
| **last verified (project audit)** | 2026-09-30 — HTTP 畸形 URL/Host 返回 400 且后续请求仍 200；监听实参与快照/配对 URL 对齐；daemon 端口修改触发真实测试子进程重启；TLS 假控件改为只读协议说明。编译后 remote/mobile/preview、daemon runner 与 stdio guard 合计 Node 74 项（71 pass / 3 skip：Windows 不支持 POSIX SIGTERM、dist 已存在时缺失 dist 分支、文件 symlink 权限），其中真实 daemon 随机端口 HTTP 通过；broken stderr 定向 2/2（含真实子进程）通过；网关 UI 51/51、所改 UI 文件 lint 与本包 i18n 扫描通过；未重跑公网 relay / 真机配对。 |
| **last verified** | 2026-09-25 — 失效监听地址修复：`ensureMobileWebServer` 把 `EADDRNOTAVAIL`/`EACCES` 翻成人话并指回「监听范围」（不静默回落通配、不改写配置），弹窗 `bindGone` 分类，已失效的已存地址在下拉标「已失效」，`ipcErrorMessage` 剥 IPC 包装。`dshd-remote` 37 pass（含 192.0.2.1 确定性 EADDRNOTAVAIL 回归）、`ui-settings-remote` 51/51、locale parity + verify-client-ui-i18n 7/7、包类型检查通过。此前 2026-09-24 — IM 的鲸鱼娘默认路由复用常驻会话；定向验证见本次变更。此前 2026-09-18 — 装机「开启远程→未响应」修复：主进程 `loadServerApi` 窄化为 `pairing-offer.js` + `relay-device-credential-store.js`（原 barrel ~3 万模块同步加载冻结主线程）；`DSH_VENDOR_PACKAGES` 改镜像 + parity 测试。`dshd-remote` 36 pass、`dshd-daemon-runner`/`remote-epipe`/`stdio-guard`/`lan`/`ipc` 80 pass、`ui-settings-remote` 45/45、`check:governance` 6/6、`npm run pack`（80.7MiB runtime、sqlite ABI probe、daemon probe、skip compose）、打包布局窄入口 import+铸码 68ms、真实 Electron `qa:remote` 双冷启动 11/11（含 cold.openShowsQr）。此前：2026-09-11 — rc.1 后 dsh-im 各 channel 的 caller-scoped webServer 注入已修复；dsh-im check 19 pass / 1 skip、官方 remote specs、真实 source smoke 与 package dry-run 通过。再前：2026-09-08 — 默认服务器切到 `ayase.cn:443` + TLS，公网 SPA 切到 `https://ayase.cn/dshd/`；旧内置 IP 精确迁移、自定义服务器保留。VPS relay 容器 `healthy` / 0 restart，nginx live 与候选配置通过；Node 远程聚焦 92 pass / 0 fail / 1 环境 skip，设置 UI 10/10，公网目录一致性通过，真实 daemon + 公网 relay + 公网 SPA E2E 10/10。未执行真机相机、Android WebView 或正式安装包升级验收。 |
