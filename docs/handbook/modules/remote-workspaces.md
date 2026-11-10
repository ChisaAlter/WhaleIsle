# 模块：SSH 远程工作区

## 职责与非目标

**职责：** 把 SSH 机器、远端目录的本地镜像、远程文件与工具接入桌面 Harness。宿主插件 vendored 在 `vendor/dsh-remote`，以 `remoteWorkspaceEnabled` 控制是否挂载。

**非目标：** 不属于设置 `remote`（手机 LAN / relay 配对），不复用 `vendor/dshd-remote` 手机 daemon，也不替代上游部署级 `packages/ssh/*`。

## 用户路径

1. 设置 →「远程工作区」添加 SSH 机器并测试连接；可保存机器凭据、设置当前机器与端口转发。
2. 「添加工作区」选择「远程」tab，选机器并浏览远端目录。确认后，插件为远端目录建立 `$DSH_HOME/remote-workspaces/<host>-<user>-<port>/<basename>` 本地镜像，并把镜像交给工作区 picker。
3. 会话工作目录位于镜像内时，插件提供远程上下文与 `rw_*` 工具；右侧「远程文件」可浏览和编辑远端文件。
4. 通用 → 界面设置中的「远程工作区（SSH）」开关默认开启。切换后 Harness 自动重启；关闭时本机 picker 与普通本地工作区仍可用。

完整路径：[添加 SSH 远程工作区](../flows/remote-workspace.md)。

## 架构要点

- `src/main/dsh-remote-desktop.js` 每次 Harness 启动时检查并准备 `profiles/web/node_modules/dsh-remote` junction 与桌面自有 overlay `desktop-plugins/dsh-remote/desktop-dsh-remote.patch.yml`。开关开启时 overlay 随完整启动和 skip-user-plugins 恢复启动经 `--patch` 传入；启用态 vendor 缺文件或依赖时本次启动不挂载远程工作区，鲸屿照常启动，启动器「启动诊断」列出原因；skip 不可绕过。关闭时删 overlay、不校验 vendor，也不阻断启动。
- profile 目录里的同名插件由桌面内置副本接管；`dsh-remote` 在市场过滤和禁止名单中，配置归一化也剔除其 disable alias。用户层 `cordis.patch.yml` 不写入此 overlay。
- `vendor/dsh-remote/lib/index.js` 提供 SSH/SFTP、镜像同步、远程工具、转发和 API 路由；`lib/client.js` 是注入到 Harness 的客户端 bundle。
- 远程 picker 是 `ui-directory-picker-browse` flow 的可选子槽 occupant。本机浏览器是 picker 自身能力；子槽未挂载时保留本机-only 路径。
- 宿主运行数据放在桌面 `$DSH_HOME/remote-workspaces/`。凭据可逐机器选择 OS secret store：Windows DPAPI、macOS Keychain、Linux `secret-tool`；secret store 失败时会回退明文保存并上报 `secret-store-failed`，以免静默丢掉密码。测试和诊断输出不得包含密钥。

## 实现入口

- `src/main/dsh-remote-desktop.js`、`src/main/harness-controller.js`、`src/main/config.js`、`src/main/profile-ops.js`
- `vendor/dsh-remote/lib/index.js`、`lib/client.js`、`lib/credential.js`、`plugin-src/client/`
- `vendor/deepseek-harness/packages/client/ui-directory-picker-browse/`
- `vendor/deepseek-harness/packages/client/ui-settings-general/src/client/RemoteWorkspaceRow.tsx`
- [`src/main` 模块索引](../appendix/main-modules.md)；设置 id 为 `remote-workspace`，见[设置 section id](../appendix/settings-sections.md)

## 不变量

- 包名保持 `dsh-remote`，目录不要与手机 daemon `vendor/dshd-remote` 混淆。
- 启用态每次启动都 prepare overlay；禁用名单不能移除内置包，启用态的 runtime 缺损必须阻断 Harness 启动。
- 机器列表、凭据、known hosts、镜像与 audit log 属于桌面 `$DSH_HOME/remote-workspaces/`，不写进仓库。
- 镜像同步的三路冲突不得静默覆盖；只有调用方明确给出 `force=true` 才覆盖。TOFU `accept-new` 信任后若主机指纹变化，连接必须被拒绝。
- 手机配对仍使用 `remote` section；此功能使用独立的 `remote-workspace` section id。

## 门槛与当前证据

- 回归覆盖：`src/main/dsh-remote-desktop.test.js`、`src/main/dsh-remote-client.test.js`、Harness 启动/config/forensics 测试，以及 `vendor/dsh-remote/lib/{hostkey,binding,sync,forwards}.test.js`。
- live runner：[verify-remote-workspace-live.cjs](../../../scripts/verify-remote-workspace-live.cjs)。未提供隔离 SSH fixture 配置时会输出 `NOT RUN (not PASS)`；生产验收须使用已安装 CI Windows artifact 和获准的 SSH fixture，见[生产验收表](../../qa/production-acceptance-test-cases.md)。
- 当前源码回归使用合成目录和 fake SSH/SFTP client；真实 SSH 往返、端口转发实机和安装包 UI 验收状态为 **NOT RUN**。自动化用例通过不能替代这几项实机证据。

## 延伸阅读

- [远程工作区 Feature 卡](../../features/remote-workspace.md)
- [SSH 远程工作区决策](../../decisions/implemented/product/2026-09-19-remote-workspace.md)
- [添加 SSH 远程工作区流程](../flows/remote-workspace.md)
- [手机远程](mobile-remote.md)（另一能力）
