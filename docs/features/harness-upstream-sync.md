# Feature: Harness 上游同步

| Field | Value |
| --- | --- |
| **id** | `harness-upstream-sync` |
| **last verified (release catalog)** | 2026-09-29 — 会话统计 dock 的 `statsLine` 注入同步到官方生成的 slot catalog；`gen-client-catalog --check` 与 `gen-third-party-notices --check` 通过。仅生成产物补齐，见 [候选记录](../qa/results/2026-09-29-release-candidate/README.md)。 |
| **status** | `active` |
| **last verified (window gate)** | 2026-09-29 — 新增 Windows HWND 样式/真实 IPC 回归与可见动画验收要求；本次未变更上游 pin。 |
| **last verified** | 2026-10-30 — 将 `dsh-v0.2.1-rc.4`（`504a01a`）从 rc.2 pin 三方合并至桌面树，33 处冲突按下方合并裁定解决；lockfile、client slot catalog 与 persistence 目录重新生成。rc.5 当时只在 npm（`latest`），GitHub 无源码 tag，未同步。`setup:harness`（锁定安装 + 官方构建）通过；冲突相关 vendor 包 vitest 4598 项全过；桌面插件兼容（含真实 Loader 启动 SSH / ChatGPT 插件）、鲸桥、差异标记、启动参数与 skip compose 契约 101 项通过，`check-skip-compose-contract.js` 通过。源码应用隔离配置实测：左栏「更多」、右栏「更多工具」卡片、对话头部「更多会话视图」（`no-drag`，桌面两行头部保留）与插件页跳转正常。`sync:harness --dry-run` 本次合并失败却报告空冲突列表，需用手动 `git merge` 复核。更早记录见本文件 Git 历史。 |

## User paths

1. 开发者同步官方 Harness 固定版本，保留桌面扩展和已有用户修改。
2. 完成冲突解决、构建和回归后从源码启动桌面应用。

## Invariants

- Windows 壳窗遵循 [window-motion](window-motion.md)，同时保留原生动画与 20px 自绘外框；同步实际影响窗口样式、Electron 或相关集成时运行 `node scripts/run-window-motion-qa.mjs`，不能以几何状态检查替代原生样式及可见过渡验收。

- 使用以旧 pin 为共同祖先的三方合并，禁止整树覆盖桌面定制。
- 依据[唯一维护准则的上游整合规则](../maintenance/README.md#上游合并与差异保护)保护 WhaleIsle 已交付行为、修复、数据与权限契约；不采用“上游永远优先”或“本地实现永远保留”的默认裁定。等价迁移允许调整旧位置/字符串标记，但须保留真实行为断言，不能借此掩盖回归。
- 对上游增量与本地差异交集及其消费者核对语义冲突，即使 Git 自动合并成功也不省略。相关差异由各功能卡持有，`harness-desktop-forks` 只检查部分结构和源码标记，不是完整功能清单或实际运行证明；未登记差异先查清用途。
- 技术等价适配在授权范围内直接处理；未授权的能力删减、交互/默认值、数据或权限取舍按维护准则给出具体方案，由用户裁定。上游等价接管后移除冗余实现并更新差异归属；明确裁剪的功能和已修复缺陷不得随同步恢复。
- pin 仅在合并树成功应用后更新；未完成验证不得称为可发布版本。
- 不创建分支或发布；仅在用户明确要求时提交同步结果。保留任务开始时本地修改的原始快照及其他任务后续的独立更新。
- 设计语言、关闭按钮在标题右侧、独立桌面家目录和插件恢复契约保持。
- 新槽位拆出的常驻会话 header 与 Session header 共用一层网格和内边距，不能让右栏起点因重复标题容器而下移；`ui-conversation` 的所有浏览器可编辑设置字段须在 Host `Config` 中声明 volatile，以便 `ConfigForm` 写入真正持久化。

- rc.2 合并裁定：模型设置里手写路由的行使用上游推理等级编辑器（等级 + API 值，只剩 Off 时报 `modelReasoningNeedsLevel`），其余行保留桌面思考强度复选框及 `effortOffAlone`；上游编辑器的档位选择改用 `SettingsSelect`，模型设置界面不出现原生 `<select>`。插件管理器“已确认版本”弹窗自行显示拒绝原因与重试，桌面安装 Toast 不再重复该输入错误；其余安装反馈仍走 Toast。模型选择器触发器的标签插槽外层为 `display: contents`，回退时仍是 `FlipText className={css.triggerLabel}`。
- rc.4 合并裁定：用户确认保留上游默认加载的 `ui-entry-customization`（左栏「更多」、对话「更多会话视图」、右栏「更多工具」，提供浏览插件与 Creator 草稿）。Tooltip 采用上游 `placeTooltip`（放不下时换到对侧），保留桌面 `usePresence` 淡出快照；Menu 同时保留桌面 `matchAnchorWidth` 与上游 `minWidthFromAnchor`。右栏引导保留桌面标题与正方形卡片网格及全部描述，「更多工具」占一格。对话头部保留桌面两行布局与显示条件（视图标签设置、托管会话、空白隐藏），叠加上游按宽度折叠；标签间距 36px、行高 27px。左栏埋点改用上游 `trackEntryClick`，`selectPanel` 不再重复上报。新会话保留桌面无目录流程，采用上游按预设筛选空白会话与 `whenDraftExists`；Creator 仍由桌面 `beforeOpen` 在实际打开的会话上设置。DeepSeek 列表代码移入 `llm-deepseek` 后，桌面 `modelOverrides.<id>.disabled`、已配置但未列出的模型与旧版 `models` 换算随之迁移，API Key 路线同样生效。

## Allowed touch

- `vendor/deepseek-harness/` — 官方更新、冲突解决与必要兼容修复。
- `vendor/harness-upstream.json`, `vendor/README.md` — pin 与桌面差异说明。
- `src/shared/harness-desktop-forks.js`, `src/shared/harness-desktop-forks.test.js` — 等价迁移不变量与版本检查。
- `src/main/dsh.test.js` — 随上游解析器变更验证桌面启动参数。
- `docs/design-language*`, `docs/handbook/modules/build-release.md`, `docs/features/`, `docs/decisions/` — 升级契约与兼容裁定记录。

## Do not touch

- 已有发布说明、desktop-pet 和 windows-installer 卡的未提交修改。
- 用户数据、凭据、其他 vendor 插件、发布或部署状态。

## Gates

| Kind | What |
| --- | --- |
| Automated | 实现及冲突裁定完成后，按维护说明的[上游合并与差异保护](../maintenance/README.md#上游合并与差异保护)验证实际受影响的用户路径，复用相关检查；文档修改按需核对链接 |
| Manual / QA | 启动链或跨层集成受影响时执行 `npm run smoke:source` 与源码应用重启；UI、文件、权限等路径按实际影响直接观察 |

## Sources

- Design: [设计语言](../design-language.md)
- Spec / plan: [上游同步方案](../superpowers/plans/2026-08-18-harness-rc7-vendor-pin.md)
- Decision: [alpha.2 桌面适配](../decisions/implemented/architecture/2026-09-18-harness-alpha2-desktop-adaptation.md)
- Decision: [0.1.7-alpha.2 桌面适配](../decisions/implemented/architecture/2026-09-23-harness-017-desktop-adaptation.md)
- Decision: [标题栏点击区域](../decisions/implemented/bug-fix/2026-09-23-titlebar-click-regions.md)
- Implementation entry: [harness-sync.js](../../src/shared/harness-sync.js)
