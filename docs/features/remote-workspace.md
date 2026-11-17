# Feature: SSH 远程工作区（dsh-remote 内置）

| Field | Value |
| --- | --- |
| **id** | `remote-workspace` |
| **status** | `active` |
| **last verified** | 2026-09-29 |

历史验证与变更记录见 [docs/history/remote-workspace.md](../history/remote-workspace.md)。

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
