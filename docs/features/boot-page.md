# Feature: Boot page

| Field | Value |
| --- | --- |
| **id** | `boot-page` |
| **status** | `active` |
| **last verified (async links)** | 2026-09-29 — 链接恢复让出主线程，既有日志每五秒报告完成数/总数和耗时，取消不触发重新解压；定向 148/148，详见 [QA](../qa/results/2026-09-29-installation-recovery/README.md)。 |
| **last verified (extraction recovery)** | 2026-09-29 — 低空间、损坏归档、提取超时/取消、目录链接搬迁与中断替换恢复回归通过；本地 2.35 GB 归档冷提取 71.3s、复用 1ms，100ms 事件循环探针最大间隔 116ms；源码冒烟通过。不是 CI Setup 验收，见 [QA](../qa/results/2026-09-29-installation-recovery/README.md)。 |
| **last verified (horizon reveal)** | 2026-10-05 — 独立透明覆盖窗口中的两片静态启动画面向上下移开；完整滑动由原生动画 finished 决定，避免首帧迟到时固定计时提前撤幕。隔离源码 Electron 实测约 600ms 完整运动，91 个动画采样帧，帧间隔中位数 6ms、最大 47ms；主界面和三个窗控正常，覆盖窗口已清理；真实减弱动效实例直切，未保留动画层或 hold。复用本机既有 Harness 构建产物；相关 33 项检查通过，未构建安装包。 |
| **last verified (desktop reveal)** | 2026-09-29 — boot 保持不透明垫底，桌面按双倍基础时长淡入并等待渲染完成；真实 Electron 明暗均有中间帧、减少动态效果无中间透明帧，最终 hold 解除。定向 75/75、隔离源码冒烟通过（标题栏命中、PTY、无页面错误）。新增实机复测：隔离源码实例的 boot 文档保持 `opacity:1` 直到真实 Harness 渲染器挂载，随后 `data-harness-covered:true`，无页面错误。见 `docs/qa/results/2026-09-29-four-fix-live/`；未构建安装包。 |
| **last verified (window controls)** | 2026-09-29 — 窗控对齐主界面 32px / 8px 方钮、零间距与相同内边距；Electron 明暗最终样式及三个按钮命中检查通过。安装包构建暂停。 |
| **last verified (A2 plugin recovery)** | 2026-09-28 — 插件恢复纳入取消世代与共享 import 维护准入；真实 controller + launcher service + task-protection + import guard 回归覆盖 stop、blocked/unreadable journal、恢复先持锁、延迟 start/Remote、异步准备成功/失败及旧 finally 不清新任务。定向 217/217；未修改的原外部 A2 回归在独立证据目录重跑 4/4，原审计证据未覆盖。未重启应用；统一文档门禁与重启由主代理负责。 |
| **last verified (restart)** | 2026-09-08 — 105 项 controller/window/IPC 检查通过；延迟 boot 导航回归及隔离 Electron 内置重启恢复可见 Bot 界面通过 |
| **last verified (boot canvas)** | 2026-09-18 — 用户提供的 `assets/whale-spin.svg` 原样用作 112px 中区旋转加载动画，减少动态效果时换 `assets/whale-head.png`；Electron 两帧验证旋转/静态切换，32 项定向与全量 1775 项通过（2 跳过）；源码预启动构建受已有 openNoDirectory 类型错误阻塞。 |
| **last verified (boot canvas)** | 2026-09-26 — 海平线画布落地：62% 交接线 + 天空层（深空星云/星场或云气）+ 水下层（调暗/表层透光/微粒/暗角）+ 衬线字标扫光 + 底缘 ticker + 毛玻璃日志抽屉；鲸鱼标、角轨、扫描线、角标、双页详情全部移除；动作面回到场景中央。 |
| **last verified (IPC auth, B2)** | 2026-09-20 — boot 角色授权边界复核：`ipcSenderRole` 仅在 sender 属于主窗 boot webContents、frame 为其**顶层 frame**、URL 通过 `isLocalAppNavigationUrl` 且 sender 未销毁时才返回 `IPC_ROLES.BOOT`；子 frame、已销毁 sender、导航离开 boot 页、被替换的 webContents 一律 `null`，`assertIpcSender` 抛 `ERR_DSH_IPC_SENDER`。`ipc-authorization.test.js` 7/7。boot 页动作面仍限定为 `shell:restart` / `shell:open-launcher` 等既有通道，本轮未新增 boot 侧 IPC，也未改 `--boot-*` 作用域。 |
| **last verified** | 2026-09-26 — 品牌副标改两行锁定（用户参照截图）：`鲸屿` 徽块独占一行、`BASED ON DEEPSEEK HARNESS` 次行（muted、不闪）；对抗审查修复字距居中缺陷（`.brand-sub` 缩进补满、`small` 透明填充重置、`.brand` 标题缩进补偿）。原型↔生产品牌区域像素差 0、契约 22/22、doc-sync 8/8（证据 `docs/qa/results/2026-09-26-boot-brand-lockup/`）。前次：2026-09-26 — 中央提示行收编 + 揭示交叉淡化：`#hint`/`#recovery` 从 `.core` 移除，提示/恢复/动作回执三路按优先级复用 ticker 单行（恢复回执 > 状态提示 > 最新日志）；`revealHarnessView` 改交叉淡化——harness 页 `insertCSS` 持 0 透明度挂入透明背景 View → 双 rAF 后淡入，`.scene` 同步淡出，560ms 后 `data-harness-covered` 收尾，注入失败回退瞬时遮盖；减弱动效下两侧均不播过渡（boot 端保持到 covered 直切）。穷举用例 50/50 通过（新增 TC-49 fade 过渡 / TC-50 ticker 优先级），契约 27/27。前次：2026-09-26 — 对抗审查修复轮：渲染侧日志缓冲不再被 `shell:state` 快照（主侧只推尾部 80 行）截断——DOM 尾行与快照尾行一致即保留流式缓冲；取消自动重启失败提示改走 `actionNotice` 持久通道；抽屉层级降到窗控之下（遮罩不再吞窗控点击）；`startupErrorLabel` 接线并统一「桌面端启动失败」；`exit code/with` 文案映射、`nextRetryAt` NaN 防御、`openLauncher` 结果校验、重要行回退正则与 `LOG_ERROR_PATTERN` 对齐；`showLauncherBridge` 补 recovery 各态断言。穷举用例 42/42 通过（`cases.json`/`test-cases.md`），原型↔实现像素差 0.036%（`px-diff-dark.png`/`pixel.json`，差异源=窗控尺寸/caption 宽度等生产 chrome 约定）。前次：2026-09-26 — 海平线画布整体落地（定稿原型 `boot-redesign-b2-horizon.html`）：62% 交接线分开天空/深海（深色读作深空：星云 + 银河带 + 双层星场），鲸鱼标/角轨/扫描线/角标 meta 全部移除；「Whale Isle」衬线字标带 6s 周期扫光；状态只剩「启动中」+ 三点呼吸省略号；底缘单行 ticker（最新行 + `L NN` + 全部日志入口）点开升起毛玻璃日志抽屉（带行号、上限 400 行、ESC/遮罩/× 关闭）；瞬时动作面回到场景中央并按 recovery 态 gating，抽屉不自动弹。`boot-tokens.css` 换海平线色表且星场整层入 token，`boot.css` 零颜色字面量零明暗分支。结构由 `boot-recovery.test.js` + `window-harness-cover.test.js` 静态断言钉死（21/21）；验收证据存 [docs/qa/results/2026-09-26-boot-sea-horizon/](../qa/results/2026-09-26-boot-sea-horizon/report.md)——headless Edge 实拍明/暗 × 启动/异常/短窗/抽屉七态 + 真机 CDP 实拍 starting/covered 两态。决策见 [boot-sea-horizon-scene](../decisions/implemented/product/2026-09-26-boot-sea-horizon-scene.md)。前次：2026-09-19 — 最小化/还原闪屏两连修：①`data-harness-covered` 下 boot 文档 `visibility:hidden` + html/body 画布透明，合成层空窗期回落到与 harness 页面同步的窗口背景而非仪器画布；②harness BrowserView `backgroundThrottling:false`，窗口隐藏期间持续产帧，消除还原时主表面先上屏、View 帧晚一拍的空白闪屏（浅色主题下表现为白屏）。window-harness-cover 契约 11 项通过。此前：2026-09-18 — 用户提供的 `assets/whale-spin.svg` 原样用作 112px 中区旋转加载动画，减少动态效果时换 `assets/whale-head.png`；Electron 两帧验证旋转/静态切换，32 项定向与全量 1775 项通过（2 跳过）；源码预启动构建受已有 openNoDirectory 类型错误阻塞。 |
| **last verified** | 2026-09-28 — 深浅色主题源回接到 `cordis.patch.yml`：`readHarnessThemeSettings` 之前读 `dsh-home/settings.yaml`，但 Host 在首次启动时把该文件 rename 为 `.imported` 并把 `ui-theme` 段迁入 `profiles/<profile>/cordis.patch.yml`，此后所有写入走 SettingsService 全量替换 patch 行——`settings.yaml` 永远停在迁移前状态，boot / launcher / 关闭遮罩的深浅色绑定静默失效（恒等 system+OS）。新增 `readHarnessThemeSettingsLive` + `parseCordisPatchSections`：按 id 锁定 `ui-theme` patch 行取 `config`（preference / activeLightThemeId / activeDarkThemeId / customThemes），未命中再回退 `settings.yaml` 兼容未迁移 profile。`themes.test.js` 10/10 通过。 |

## User paths

1. 冷启动先开启动器（更新 / 导入 / 版本 / 问诊）。启动桌面端后，主窗见海平线场景：62% 交接线分开天空（深色=深空星云星场，浅色=高空云气）与深海（调暗 + 表层透光 + 微粒 + 暗角）；中央「Whale Isle」衬线字标带周期扫光，状态下只剩「启动中」+ 三点呼吸省略号；底缘单行 ticker 实时滚最新日志行并记 `L NN` 行数，点击（Enter/Space）从底部升起毛玻璃日志抽屉看全部行，ESC / 点遮罩 / × 关闭；error / 恢复排程 / 重启中时瞬时动作面回到中央并按态逐项 gating，抽屉不自动弹开；插件进度留在此页。
2. 就绪后露出官方 Web UI；不切到官方「正在加载插件」页代替 boot。桌面窗控与全尺寸布局就绪后，从 62% 海天线向上下展开，使用三倍基础动效时长（默认 600ms）；boot 画面保持不透明垫底，等桌面过渡完成再遮盖，减弱动效直切。
3. 失败：ERROR 态、重试、导出日志；自动重启排程或进行期间隐藏「回启动器排查」跳板，恢复停止后该跳板可打开启动器 home tab（Recovery Board）；用户插件弄挂可跳过插件树后再试完整插件。插件级排查（归因、逐项/批量禁用）在 Recovery Board 做，不在 boot 页。

## Invariants

- 首次/更新后运行时解压先检查用户数据盘空间，在隔离临时目录解压，每 5 秒通过 ticker 报告耗时，15 分钟超时；停止操作中止提取，等待 tar 关闭后清理临时输出。新树验证前保留旧树，正式路径的 Windows junction 重建成功才写完成戳；中断替换从 `.previous` 恢复，不把临时目录当可启动运行时。
- 链接检查、恢复与临时链接清理使用异步磁盘操作，超过五秒通过既有日志报告完成数/总数与耗时。准备阶段在文件操作之间响应取消；正式目录替换开始后先完成链接恢复或回滚，不因取消遗留半成品。

- 启动页是整窗海平线画布例外；`--boot-*` **不得**扩散到启动器、设置、关闭遮罩、标题栏或官方 Web UI。
- 窗控不属于画布视觉例外；尺寸、圆角和间距与主界面一致，保留共享交互色及动作。
- 揭示不让两层同时变透明，不用固定主进程计时提前撤下 boot；关闭、重启或新一轮揭示后，旧回调不得遮盖当前加载页。注入失败仍须挂载全尺寸桌面并清理快照遮罩与透明状态，不能只隐藏 boot。
- 启动画布的品牌名为 Whale Isle；保留海平线画布视觉（交接线 / 天空层 / 水下层）与既有恢复语义；日志底缘单行 ticker 常驻、完整日志收进 `logdrawer` 底部抽屉（手动开合，不自动弹），场景页保持纯净，布局可按窗口高度压缩。ticker 单行按优先级复用——恢复/动作回执 > 状态提示 > 最新日志，状态行下方不再出现独立提示行；boot → Web UI 揭示为海天线展开（harness 透明挂入 → 启动页快照按 62% 交接线分成上下两片，仅以 transform 移开，露出原位主界面 → 渲染完成后 `data-harness-covered` 收尾）。
- 插件进度只呈现 controller / 插件事件提供的状态，不估算百分比或添加虚构步骤；启动器跳板只在 settled `error` 且恢复状态非 `scheduled` / `restarting` 时出现。
- 禁止 NERV / MAGI / SEELE / EVA 等商标或官方标志挪用。
- 插件装载进度留在 boot 画布。
- 未完成的 boot 导航由恢复与手动重启共享等待；旧导航不得在新的 Harness 揭示后覆盖主界面。
- 恢复动作与 [plugin-recovery 流程](../handbook/flows/plugin-recovery.md) 一致。
- 自动插件恢复在每个异步恢复边界复查取消世代；stop / cancel / 手动 restart 后旧任务不得继续写插件配置或启动内核。恢复任务的 `finally` 仅清理自身任务引用，不清掉新世代任务。
- 自动插件恢复与导入共享维护准入：先检查 blocked / unreadable import journal，在首个插件配置写入前获取维护 token，持有至完整异步启动（含 Remote 设置）结束；导入先持锁则恢复无写入、无启动，恢复先持锁则导入拒绝。取消或失败也只释放自身 token。
- boot 页动作面 = 瞬时动作（重试 / 取消自动重启 / 下载日志）+「回启动器排查」跳板，仅此四件；插件级恢复操作**只**存在于启动器 Recovery Board，boot 页不得长出自己的副本（`boot-recovery.test.js` 钉死动作行内容）。跳板仅在 settled `error` 态出现（自动重启排程/进行中不出现），经 `shell:open-launcher`（BOOT 角色 → 启动器 home tab）。
- 覆盖安装同一桌面版本时，`userData/runtime/<version>` 必须与安装包 Harness pin + 归档大小一致；无戳或戳不匹配则重新解压。不得只因 `bin.js` 存在而沿用旧 runtime。

## Allowed touch

- `src/main/dsh.js`、`dsh.test.js`、`harness-extract.test.js`、`install-space.js` 及测试 — 2026-09-29 用户授权全面优化安装链路，接入解压取消、空间检查与替换恢复。

- `src/renderer/boot.html` / `boot.css` / `boot.js` / `boot-tokens.css` / `boot-recovery.js` / `boot-recovery.test.js`
- `docs/qa/results/` 下本卡的验收证据目录（截图 + report + 探针 JSON）
- `src/main/harness-controller.js`、`harness-extract.js`、`window.js`、`window-harness-cover.test.js`（boot 布局断言）、`boot-log-dump.js`、`plugin-tree-failure.js`、`plugin-recovery-actions.js`
- `src/main/harness-controller*.test.js`；`src/launcher/launcher-service.js` 仅限自动插件恢复的 import journal 准入接线
- `assets/whale-spin.svg`、`assets/whale-head.png` — 用户指定的加载与品牌资源
- 本卡、[启动页决策记录](../decisions/implemented/product/2026-09-26-boot-sea-horizon-scene.md)、handbook boot / plugin-recovery 章、[design-language 桌面启动页段](../design-language.md#桌面启动页)及其英文配对
- `docs/motion.md` 仅限 boot→harness 揭示清单（2026-09-29 用户确认扩展）
- `src/main/window-marketplace.test.js` 仅补齐揭示清理所需 Electron 替身方法（2026-09-29 用户确认继续）

## Do not touch

- 把 `--boot-*` 用到非启动页
- 用空态卡片或官方加载页替换海平线画布产品路径

## Gates

| Kind | What |
| --- | --- |
| Automated | boot / harness-controller / plugin-recovery 单测；`qa:packaged` 可验证 unpacked 应用的 overlay stamp，不覆盖安装器操作 |
| Manual / QA | 启动、恢复或升级行为改变时，参考[历史 QA 场景库](../qa/production-acceptance-test-cases.md)的 `TC-INST-003`…`007`、`TC-INST-012`、`TC-INST-013`，实际观察相应源码、打包或安装路径 |

## Sources

- Decision: [安装恢复边界](../decisions/implemented/bug-fix/2026-09-29-installation-recovery.md)

- Decision: [启动页窗控对齐主界面](../decisions/implemented/bug-fix/2026-09-29-boot-window-controls.md)

- Decision: [启动器审计收尾修复（A2）](../decisions/implemented/bug-fix/2026-09-28-launcher-audit-closeout-fixes.md)
- Decision: [启动页改海平线画布](../decisions/implemented/product/2026-09-26-boot-sea-horizon-scene.md)
- Decision（已归档）：[启动页使用三段响应式仪器画布](../decisions/archived/product/2026-09-25-boot-page-responsive-instrument-canvas.md)、[日志分区双页制](../decisions/archived/product/2026-09-26-boot-log-details-page.md)
- Decision: [统一鲸鱼品牌资源](../decisions/implemented/product/2026-09-18-whale-brand-assets.md)

- Handbook：[../handbook/modules/boot-lifecycle.md](../handbook/modules/boot-lifecycle.md)、[../handbook/flows/boot-to-ready.md](../handbook/flows/boot-to-ready.md)
- Design：[../design-language.md](../design-language.md#桌面启动页)
- Spec：[../superpowers/specs/2026-08-18-plugin-startup-recovery-design.md](../superpowers/specs/2026-08-18-plugin-startup-recovery-design.md)
