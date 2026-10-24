# Feature: SSH 远程工作区（dsh-remote 内置）

| Field | Value |
| --- | --- |
| **id** | `remote-workspace` |
| **status** | `active` |
| **last verified** | 2026-09-29 — 远程 picker 布局修复：真实组件 Chromium 检查覆盖浅色/深色/窄窗、加载/空机器/机器加载失败/目录失败/正常列表、重试/取消/切换保活，见 `docs/qa/results/2026-09-29-remote-picker/`；另有实机复测：真实桌面弹窗从「本机」切到「远程」后内容区留白、底栏独立、取消按钮可见，失败态保留重试。真实 SSH 未运行。此前：2026-09-20 — B3 持久化与负路径定向补测：`hostkey.test.js`（TOFU 首见信任、指纹变更立即拒绝且不改写已存记录、verify 模式拒绝未知主机、损坏 known_hosts 视为空、forgetHost 仅删目标 host:port）、`binding.test.js`（镜像 metadata 决定目标而非 active machine、镜像撤销/缺 meta/畸形/无 host 时拒绝回退、前缀兄弟目录不误判、poolKey 归一）、`sync.test.js`（pull/push 三路冲突均不覆盖、仅 force 覆盖、pushOneFile 冲突、sync-state 损坏读空）、`forwards.test.js`（本地转发只监听 127.0.0.1、只有 local autoStart 重连恢复、reverse 不自动重启、失效显式报错、定义持久化重载）。`node --test --test-timeout=10000 lib/hostkey.test.js lib/binding.test.js lib/forwards.test.js lib/sync.test.js` 26/26 通过，全部使用合成临时目录/假 SFTP/假 SSH client，未接触真实主机、中继或 `~/.dsh`；真实 SSH 与转发实机未执行（NOT RUN）。此前 — 运维脚本非运行契约、真实路由序列、取消传播与资源安全收口：readiness 必须 `ok === true` 且 cookie 非空、launch token 每次运行只兑换一次；缺配置默认输出 `NOT RUN (not PASS)` 并以 0 退出，`--require-live` 时以 2 退出。verify 脚本改为 import-safe，按显式 route→method 表调用真实路由（`/home`、`/current`、`/machines`、`/mirror`、`/write`、`/fs`、`/read`、`/test-connect` 均 POST，不为迁就脚本改产品路由），mirror 指向本次运行自建的目录并附「目标不存在必须被拒」负例；teardown 固定为远端 fixture 清理 → deselect/delete → stop child → 删本地 HOME，`stopChild` 失败时保留 HOME 并报告位置；三类 mutating cleanup 改为校验成功响应体（HTTP 200 + `ok:false`／缺失或畸形 JSON 均计失败），且只在语义通过后才写 ledger。run signal 现在贯穿真实 readiness 链路（`establishLiveSession → probeHarnessReady → fetch`，含嵌套 token 兑换与 origin 重试，调用方预取消在发请求前即抛出），cleanup 有独立预算，`assertInsideRoot` 拒绝 traversal。测试 fixture 的期望 route→method 表与 runner 的 `API_METHODS` 相互独立，并附 GET `/dsh-remote/home` 必须被拒的负例。`node --test scripts/remote-workspace-live-guard.test.mjs scripts/verify-remote-workspace-live.test.mjs` 28/28 通过（8 guard + 20 runner，含完整成功路径、teardown 顺序与 cleanup 语义负例），CLI 实测 0/2；每个用例独享 `mkdtemp` HOME，不再写机器上任何固定路径。真实 SSH 往返 **未在本轮重跑**；2026-09-19 旧结果只作历史记录保留，不构成当前 revision 的实时验收。凭据落盘：vendored `vendor/dsh-remote/lib/credential.js` 已实现 Windows DPAPI / Linux secret-tool 的按机主加密后端，并在 `persistPassword` 失败时明文回退且上报 `secret-store-failed`；是否改为强制加密或迁移既有明文是独立产品决策，本轮未改。 |

## User paths

1. 设置 →「远程工作区」section：增删改 SSH 机器（host/port/user + 密码或私钥、跳板机、OTP、指纹策略），「设为当前」，「测试连接」按类别报错（认证 / 网络 / 主机指纹 / 超时），端口转发面板，最近 30 条审计。
2. Add workspace 弹窗 = 「本机 / 远程」双 tab：本机保持页内浏览；远程选机器 → 路径实时补全 / 浏览浮层 → 「设为远程工作区」→ `$DSH_HOME/remote-workspaces/<host>-<user>-<port>/<basename>` 镜像被收养为真实 workspace 并持久化。
3. 会话 cwd 位于镜像内时，system prompt 注入 remote 段，模型可调 20 个 `rw_*` 工具（ls/stat/read/write/edit/append/mkdir/remove/move/exec/search/download/upload/forward/sync/push/connect/pick/info/disconnect）；写/删/移/转发落 `audit.log`。
4. 侧栏「远程文件」tab 直接读/写远端文件（mtime 乐观锁、409 重读/保存）。
5. 内置功能「远程工作区」开关（`remoteWorkspaceEnabled`，默认开）翻转即重启 Harness；关闭后启动无插件行、无 overlay、无残留受管块。

## Invariants

- 挂载只经桌面自有 overlay `desktop-plugins/dsh-remote/desktop-dsh-remote.patch.yml`，`remoteWorkspaceEnabled`（默认 true）为 true 时随**每次**启动（全量 + skip）经 `--patch` 传入；为 false 时 ensure 删除 overlay 并 strip 残留受管块，不校验 vendor、不阻断启动。绝不写用户层 `cordis.patch.yml`。
- 包名保持 `dsh-remote` 并入 `DROPPED_BASENAMES`：市场目录隐藏、in-chat `install_dsh_plugin` 拒绝、`stripDroppedPlugins` 每次启动剥 profile manifest 同名行——内置为唯一供给；用户既有第三方安装的 `$DSH_HOME/remote-workspaces` 数据被内置接管。
- 包名解析走 `profiles/web/node_modules/dsh-remote` junction → `vendor/dsh-remote` 源；运行时依赖（`ssh2`/`schemastery`/`iconv-lite`）随 `vendor/dsh-remote/node_modules` git 跟踪（`.gitignore` 例外，与 dsh-im 同例）；`cpu-features` 可选原生面不跟踪、不放宽构建白名单。
- `vendor/dsh-remote` 砍 `update.js`：插件不做自更新，桌面统一管更新。
- 目录选择器远程入口：`ui-directory-picker-browse` 声明新 `single` 远程 flow 子孔并渲染「本机 / 远程」tab 条；远程 client 占孔，孔空（开关 off / 未挂载）时弹窗退回本机-only；插件原 `-100` 抢孔机制随 client 重写移除，本机 tab 行为不变。
- 凭据（密码/私钥引用）、`known_hosts.json`、镜像、审计、`audit.log` 全部落 `$DSH_HOME/remote-workspaces`，不碰官方 `~/.dsh`。密码按机器可选写入 OS secret store：Windows 走 DPAPI（CurrentUser，`.secrets/*.bin`），Linux 走 `secret-tool`，失败时回退明文并在机器记录/UI 上报 `secret-store-failed`；强制加密、既有明文迁移与失效 keychain 恢复策略仍属独立决策，当前默认保留上游的可选加密模型。
- `rw_*` 工具名过 `[A-Za-z0-9_-]{1,64}` 语法；remote context 是 session 级——只有 cwd 位于镜像内才注入 system prompt，普通本地会话不注入。
- `rw_sync`/`rw_push` 三路冲突检测绝不静默覆盖（`force=true` 才覆盖）；TOFU `accept-new` 下指纹变更立即拒绝连接。
- forensics 把该内置行缺席 profile 清单的缺损标 `inBox`/`desktopRuntimeDamage`（Recovery Board 显示「内置组件损坏」）；disable 名单对 `dsh-remote` 无效；ensure 失败（`remoteWorkspaceEnabled` 时）阻断启动，skip 不可绕。
- 与三个既有 remote 概念不混：`ui-settings-remote`/「远程」section = 手机配对（LAN/relay/QR），`dsh-api-remotes` = client↔host BFF，上游 `packages/ssh/*` = 部署级 POSIX 远程后端——本功能不复用其中任何一个，新 section id 不得撞 `remote`。
- 全部新 UI 走 `ui-primitives` / `--dsw-alias-*` tokens / typed dictionaries（`verify-client-ui-i18n`）；原插件 client 半不搬，按设计语言重写。
- 本机 / 远程页签位置稳定；远程内容与固定底栏分开，24px 水平留白、16px 内容/底栏间距与本机同源，窄窗操作可换行；加载、空机器、失败均可取消；错误走语义错误色并可重试，未选机器禁用目录操作，设为当前机器失败不继续读取旧机器目录。

## Allowed touch

- `vendor/dsh-remote/**`（含 `node_modules` git 跟踪例外）、`src/main/dsh-remote-desktop.js` 及测试（受管块 strip 内建于 ensure，无独立 legacy preset 文件）、`scripts/verify-remote-workspace-live.cjs`（env 门控真机验收）
- `index.js`、`harness-controller.js`、`config.js`、`ipc.js`、`plugin-forensics.js`、`marketplace-catalog.js` / `marketplace-install.js` 的 DROPPED 名单与接线
- `vendor/deepseek-harness/packages/client/ui-directory-picker-browse/**`、`packages/host/directory-picker-browse/**`（远程 flow 孔 + tab 条；`harness-desktop-forks.js` 登记新 marker）
- `package.json` extraResources、`scripts/after-pack.js`、`scripts/check-skip-compose-contract.js` 及对应测试；`src/shared/post-merge-ui.test.js`
- 本卡、handbook、Feature 索引、`.cursor/rules` 短条目、决策记录、QA 记录

## Do not touch

- 手机 remote 面：`ui-settings-remote`、`vendor/dshd-remote`、`dsh-im`、LAN/relay/QR 配对全链路
- 上游 `packages/ssh/*` 与 `dsh-api-remotes`；picker 本机 tab 的现有浏览行为
- 用户层 `cordis.patch.yml`（永远不写受管块）；`marketplace` 目录面除 DROPPED 名单行外
- `vendor/dshd-remote` 目录——与本功能无关且名字相近，别误改

## Gates

| Kind | What |
| --- | --- |
| Automated | `node --test` 覆盖 ensure/overlay/strip/toggle/forensics 归因 + client bundle 组合（`dsh-remote-client.test.js`）；`check-skip-compose-contract.js` 含 remote 行；fork 门禁（`harness-desktop-forks` marker 测试）+ `verify-client-ui-i18n`；`scripts/verify-remote-workspace-live.cjs` 为 env 门控真机路由验收：缺配置默认软跳过并明确打印 `NOT RUN (not PASS)`，`--require-live` 时缺配置非零退出；`node --test scripts/remote-workspace-live-guard.test.mjs scripts/verify-remote-workspace-live.test.mjs` 固定 readiness `ok`+cookie、单次 token 兑换、配置矩阵、真实 route→method 表、run signal 贯穿真实 readiness 链路、cleanup 语义校验、独立 fixture 路由表、成功路径与 teardown 顺序（28/28） |
| Manual / QA | API 级实机验收由 live 脚本覆盖（加机→test-connect→current→ls→写/读/409→fs→镜像→audit），但**脚本覆盖能力 ≠ 本轮已执行**：真实 SSH 往返本轮未跑，不得记 PASS。剩余手测：远程 tab UI 选目录 → `rw_*` 工具 → 侧栏编辑 → 开关翻转 → skip 启动（新 TC 条目落 `production-acceptance-test-cases.md`） |

## Sources

- Design: 会话内方案评审（picker 合并 + 全量 port + 默认开 + 新 section + 保名）
- Decision: [SSH 远程工作区以代码级合并为桌面内置功能](../decisions/implemented/product/2026-09-19-remote-workspace.md)
- Upstream source: `github.com/flymysql/dsh-remote` v0.8.21（MIT）；上游 `packages/ssh/*` 仅作对照，不复用
- 相关卡：`whale-assistant`（vendor 插件 + overlay + 开关管线）、`directory-picker-drives`（picker fork 现状）、`usage-stats`（desktop-plugins 覆盖同名市场安装先例）、`remote-settings`（手机 remote section，区分用）
