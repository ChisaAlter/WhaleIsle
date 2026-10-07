# Feature: Launcher-managed components（启动器组件平台）

| Field | Value |
| --- | --- |
| **id** | `launcher-components` |
| **status** | `implemented` |
| **last verified** | 2026-09-28 — 跨平台拒绝 Windows 绝对/驱动器相对入口，registry 定向回归通过；2026-09-25 — 组件平台已落地：`src/launcher/components/`（catalog 扫描 + 安装/启停/更新/回滚/卸载 + pid 存活探测 + orphan 接管 + `before-quit` 回收），`main/ipc-components.js` 经共享表注册，`launcher-components.js` 渲染行。持久化在 `userData/components/registry.json` 原子写；样例 catalog 源为 `<root>/components/samples/`（目录不存在时列表为空）。**不随包附带演示组件**——E2E 夹具移到 `tests/fixtures/components/launcher-notes/`（真 payload 全生命周期测试 v1→v2→回滚仍在跑），`components/samples/**/*` 从两个 `files` 列表剔除。31/31 定向绿。 |

## User paths

1. 用户在启动器新增的组件分区浏览项目维护的组件，按需下载、安装、运行或停止工具/服务。
2. 用户独立更新或卸载单个组件；失败时仍可使用上一健康版本，组件数据是否删除由用户单独选择。
3. Launcher 窗口关闭时继续监管已运行服务；退出 Launcher 时停止旧通用组件平台监管的服务。鲸桥独立运行，退出启动器后继续服务 DSH；桌面端直接启动时也会恢复已安装的鲸桥。

## 鲸桥（WhaleBridge）

首个正式组件从 [Magpie](https://github.com/yetone/magpie) 的源码精简开发；来源固定在 `vendor/whalebridge/upstream.json`，MIT 版权随源码和发布清单保留。编译直接使用此处源码，不下载完整 Magpie 再包装。供应商、订阅登录、模型、路由及用量核心保留，客户端配置接入只保留 DSH；没有上游多客户端设置页、CLI/TUI、Wails 壳或 Skills/MCP 管理入口。

启动器组件页提供安装、启动、停止和运行时打开设置；更新、回滚与卸载放在管理菜单。安装后首页显示组件卡片，可开启、关闭鲸桥及打开设置。管理窗口使用独立的本机认证页面；供应商原始密钥不返回页面。安装和设置保存同步 `dsh-home/profiles/web/cordis.patch.yml` 中 `llm-pi-ai` 的 `providers.whalebridge`；home patch 已覆盖该插件 config 时，只在其现有配置中同步鲸桥渠道，保留其他供应商。网关凭据使用可热加载的 `dsh-home/.credentials.yaml` 受管引用，仅迁移本组件拥有的旧 `.env` key，桌面 Models 中显示「鲸桥」。安装时不覆盖默认模型。卸载只删除这两个持久层的鲸桥渠道及其凭据；默认模型属于鲸桥时清除这一默认选择，聊天记录和其他渠道保留。组件配置是否删除由用户选择。

数据位于桌面共享状态目录的 `components/whalebridge/data`，程序位于版本目录。更新先完成下载及大小/SHA256 校验，再切换进程；新版本无法就绪时恢复原版本。正在生成 DSH 回复或订阅进程等待工具结果时拒绝停止、更新和卸载，不切断流或工具续接。停止失败解除维护冻结；卸载预检查只读，不启动已停止的服务。卸载先确认进程停止并保留可恢复的程序，再原子断开 DSH；断开失败恢复安装记录及原运行状态。组件不启动上游给其他客户端切换账号、修改模型配置或更新插件的后台任务。订阅认证继续使用上游原生 OAuth、官方认证 CLI 和供应商适配器，Claude 内部工具 helper 和本机 token 回调属于订阅功能依赖，不是用户 MCP 管理入口。

源码启动器优先安装 `node scripts/build-whalebridge.mjs` 的本地产物。正式分发使用 `whalebridge-v<版本>` 的独立附件，遵循启动器的 GitHub/CNB 线路；组件发布不替换桌面程序的 latest。

管理页沿用鲸屿透明 logo、侧栏、语义 token 和控件。窗口隐藏独立系统标题栏，原生窗口控制融入右上角，顶部空白可拖动；页面位置、服务状态和刷新操作直接置于主面板，不另设横条。接入概览先说明用途和三步接入；供应商与账号采用卡片，模型列表可搜索并按显示范围筛选，路由成员可从现有模型选择。使用说明包含供应商计费、后台运行、模型同步和卸载说明。订阅登录只展示当前登录方式实际需要的字段；高级接口、代理与路由参数按需展开。窗口支持浅色、深色和窄屏布局。

新增 API 供应商或完成订阅授权后，原弹窗保留明确的成功结果和模型同步说明，不自动关闭。结果区集中显示供应商、账号身份与接入状态，后续操作区说明如何在桌面端使用模型。用户可点击「完成」关闭，或「查看供应商」进入账号管理页；已有订阅重新授权显示授权已更新。表单标签与输入保留 8px 间距，字段组与动态追加的登录方式、区域、代理和密钥字段保留 20px 间距；订阅适配器安装按钮与上方说明保留 12px 间距。账号列表与新增操作、登录回调与提交操作分别留出区块间距，窄屏下长名称与操作按钮可换行。

设置窗口复用启动器的窗口控件样式和图标，保留 48px 拖动区与 32px 最小化、最大化/还原和关闭按钮。沙箱 preload 只提供这三个窗控所需的动作与状态，账号页面不能取得其他桌面权限。普通用户入口沿用前台打开设置。命令启动可以明确选择不激活窗口，使设置页显示而不争用用户正在操作的窗口焦点。组件更新、回滚或卸载在恢复旧版本但管理地址发生变化时，也会释放旧设置窗口，避免继续请求失效地址。

已安装鲸桥也可从桌面侧栏底部账户菜单「鲸桥」打开同一设置窗口；入口规则见 [账户菜单中的桌面入口](account-settings-entry.md)。

## Invariants

- 清单入口在任何宿主上都拒绝 Windows 绝对与驱动器相对路径，并在归一分隔符后验证根内边界。
- 组件是独立进程，不注入 Launcher renderer。鲸桥获得明确授权，仅写自己拥有的 DSH 渠道；遇到同名非鲸桥配置拒绝接管。
- 鲸桥从项目自己的发布源读取清单，校验组件 id、版本、固定入口、大小和 SHA256。当前没有独立签名验证，界面不声称已验证签名。
- 二进制置于 Launcher 自有版本目录，数据置于独立数据目录；暂存验证成功后才切换 active，保留上一健康版本供回滚。
- main 进程直接启动固定入口并跟踪 PID、就绪和版本。鲸桥安装后启动；停止后可手动恢复，没有自动重试循环。
- 组件操作锁与 DSHD 安装锁分离；组件故障不得阻塞 Launcher 的下载/安装/启动主路径。

## Allowed touch

- `src/launcher/` — 组件清单、安装器与进程监管服务；不新建另一套启动器 UI
- `src/renderer/launcher.*`、`src/main/ipc.js`、`src/preload/index.js` 与提取出的启动器服务 — 组件分区、授权 IPC 与状态投影
- `docs/design-language.md` 与 Launcher UI — 组件页视觉角色及交互
- `.github/workflows/`、`scripts/` — 同源签名组件产物与测试夹具

## Do not touch

- `vendor/deepseek-harness` 插件市场、`marketplace-install.js` 的 profile 锁、HarnessController 生命周期
- 任意第三方组件加载或脚本执行入口

## Gates

| Kind | What |
| --- | --- |
| Automated | 清单/哈希、路径边界、安装/回滚、就绪版本、活跃请求保护、配置保留和卸载渠道 |
| Manual / QA | 真实 Windows 工具与服务各一例：安装、运行、关窗托盘、停止、更新、卸载、断网恢复 |

## Sources

- Decision: [跨平台入口与 CI 修复](../decisions/implemented/bug-fix/2026-09-28-clean-ci-portability.md)
- Decision: [启动器独立分发架构](../decisions/proposed/architecture/2026-09-24-launcher-standalone-distribution.md)
- Plan: [启动器重构计划](../superpowers/plans/2026-09-24-launcher-refactor.md)
