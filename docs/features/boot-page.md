# Feature: Boot page

| Field | Value |
| --- | --- |
| **id** | `boot-page` |
| **status** | `active` |
| **last verified (async links)** | 2026-09-29 |
| **last verified (extraction recovery)** | 2026-09-29 |
| **last verified (horizon reveal)** | 2026-10-05 |
| **last verified (desktop reveal)** | 2026-09-29 |
| **last verified (window controls)** | 2026-09-29 |
| **last verified (A2 plugin recovery)** | 2026-09-28 |
| **last verified (restart)** | 2026-09-08 |
| **last verified (boot canvas)** | 2026-09-18 |
| **last verified (boot canvas)** | 2026-09-26 |
| **last verified (IPC auth, B2)** | 2026-09-20 |
| **last verified** | 2026-09-26 |
| **last verified** | 2026-09-28 |

历史验证与变更记录见 [docs/history/boot-page.md](../history/boot-page.md)。

## User paths

1. 冷启动先开启动器（更新 / 导入 / 版本 / 问诊）。启动桌面端后，主窗见海平线场景：62% 交接线分开天空（深色=深空星云星场，浅色=高空云气）与深海（调暗 + 表层透光 + 微粒 + 暗角）；中央「WhaleIsle」衬线字标带周期扫光，状态下只剩「启动中」+ 三点呼吸省略号；底缘单行 ticker 实时滚最新日志行并记 `L NN` 行数，点击（Enter/Space）从底部升起毛玻璃日志抽屉看全部行，ESC / 点遮罩 / × 关闭；error / 恢复排程 / 重启中时瞬时动作面回到中央并按态逐项 gating，抽屉不自动弹开；插件进度留在此页。
2. 就绪后露出官方 Web UI；不切到官方「正在加载插件」页代替 boot。桌面窗控与全尺寸布局就绪后，从 62% 海天线向上下展开，使用三倍基础动效时长（默认 600ms）；boot 画面保持不透明垫底，等桌面过渡完成再遮盖，减弱动效直切。
3. 失败：ERROR 态、重试、导出日志；自动重启排程或进行期间隐藏「回启动器排查」跳板，恢复停止后该跳板可打开启动器 home tab（Recovery Board）；用户插件弄挂可跳过插件树后再试完整插件。插件级排查（归因、逐项/批量禁用）在 Recovery Board 做，不在 boot 页。

## Invariants

- 首次/更新后运行时解压先检查用户数据盘空间，在隔离临时目录解压，每 5 秒通过 ticker 报告耗时，15 分钟超时；停止操作中止提取，等待 tar 关闭后清理临时输出。新树验证前保留旧树，正式路径的 Windows junction 重建成功才写完成戳；中断替换从 `.previous` 恢复，不把临时目录当可启动运行时。
- 链接检查、恢复与临时链接清理使用异步磁盘操作，超过五秒通过既有日志报告完成数/总数与耗时。准备阶段在文件操作之间响应取消；正式目录替换开始后先完成链接恢复或回滚，不因取消遗留半成品。

- 启动页是整窗海平线画布例外；`--boot-*` **不得**扩散到启动器、设置、关闭遮罩、标题栏或官方 Web UI。
- 窗控不属于画布视觉例外；尺寸、圆角和间距与主界面一致，保留共享交互色及动作。
- 揭示不让两层同时变透明，不用固定主进程计时提前撤下 boot；关闭、重启或新一轮揭示后，旧回调不得遮盖当前加载页。注入失败仍须挂载全尺寸桌面并清理快照遮罩与透明状态，不能只隐藏 boot。
- 启动画布的品牌名为 WhaleIsle；保留海平线画布视觉（交接线 / 天空层 / 水下层）与既有恢复语义；日志底缘单行 ticker 常驻、完整日志收进 `logdrawer` 底部抽屉（手动开合，不自动弹），场景页保持纯净，布局可按窗口高度压缩。ticker 单行按优先级复用——恢复/动作回执 > 状态提示 > 最新日志，状态行下方不再出现独立提示行；boot → Web UI 揭示为海天线展开（harness 透明挂入 → 启动页快照按 62% 交接线分成上下两片，仅以 transform 移开，露出原位主界面 → 渲染完成后 `data-harness-covered` 收尾）。
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
