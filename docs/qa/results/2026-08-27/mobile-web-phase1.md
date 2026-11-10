# Mobile/Web Phase 1 QA — 会话与对话闭环（分页 / 生命周期 / 审批 actions / 模型 / 斜杠 / 富时间线）

Date: 2026-08-27

Branch: `cursor/mobile-web-phase1-ed5c`（基于 `cursor/mobile-web-phase0-ed5c`）

Plan: [mobile/web Phase 1 执行计划](../../../superpowers/plans/2026-08-27-mobile-web-phase1-execution.md)（scope 来自 [差距分析](../../../superpowers/plans/2026-08-27-mobile-web-desktop-gap-analysis.md) Phase 1）

## Automated results

| Gate | Result | Evidence |
| --- | --- | --- |
| Baseline `node --test "mobile/web/**/*.test.js"` | PASS | 86 pass, 0 fail（Phase 0 终态；本轮改造前基线） |
| Final `node --test "mobile/web/**/*.test.js"` | PASS | **121 pass, 0 fail**。新增 `chisacode/directory.test.js`（分页 pageInfo 降级、merge 去重、子智能体分组/孤儿、只读判定、归档历史请求参数与过滤、生命周期 RPC 透传与本地校验）、`chisacode/timeline.test.js`（游标提取、before 请求参数、payload error 上抛、seq 去重合并、无 key 行保留）、`chisacode/approvals.test.js`（actions 原样保留 + 非法项丢弃、快照 pendingPermissions、跨端移除、selectedActionId 回传）、`chisacode/commands.test.js`（slash token 判定、前缀优先过滤、插入、daemon 行归一化与错误）、`conversation/markdown.test.js`（inline/block 解析、javascript:/data: 链接保持字面文本、原始 HTML 不产生元素、未闭合 fence 不丢内容）；扩展 `parity.test.js`（`agentModelState`、`listAgentModels`、createAgent model 透传、provider models 透出）、`controller.test.js`（附件草稿仅内存跨会话）、`fold.test.js`（todo/compaction/turn_changes/reasoning/generative_ui/未知类型 fallback、`toolDetailView` 各 detail 形状） |
| 全仓 `npm test` | PASS（无回归） | 947 pass / 83 fail — 与基线分支完全相同的 83 个环境性失败（Electron 主进程/系统依赖类），Phase 1 新增 35 条全部通过，0 新增失败 |
| `node --check` app.js 等改动文件 | PASS | 语法干净 |

## Browser integration QA（fake DaemonClient，真实 SPA 栈）

Chrome headless 390×844（`/usr/local/bin/google-chrome` + puppeteer-core）。harness 本轮**随仓提交**：`tools/mobile-web-qa/`（`server.mjs` 按原样静态服务 `mobile/web`，仅把 `chisacode/daemon-client.bundle.js` 路由到 `fake-daemon-client.mjs`；`run-qa.mjs` 为场景脚本）。真实 `app.js` 与全部 `chisacode/*`、`conversation/*` 模块原样运行；fake 世界含 131 个活跃 agent、1 个子智能体、1 个预归档 agent、agent-1 的 262 条时间线（tail 200 + before 窗口带 1 条重叠以证明去重）。复现：`npm i --no-save puppeteer-core && node tools/mobile-web-qa/run-qa.mjs`。**19/19 checks PASS**：

| 流程 | 检查点 | Result |
| --- | --- | --- |
| 配对 | offer 链接进入 chat | PASS |
| 会话分页 | 首页 ≤101 行；「加载更多会话」→ >110 行；末页后按钮消失 | PASS |
| 子智能体 | 折叠在父会话下且标注「子智能体」；归档 agent 不进主抽屉 | PASS |
| 富时间线 | tail 200 行 + 顶部「加载更早消息」；Markdown 标题/列表/代码块/http 链接；`<img onerror>` 保持字面文本且 **0 个注入元素**；shell 工具卡摘要 `npm test` + 可展开详情；reasoning/todo/「上下文已压缩」/turn_changes/`暂不支持的消息类型：qa_future_kind`/错误行全部可见 | PASS |
| 向上分页 | 加载后 **262 行 seq 去重**（重叠 1 条被丢）；同一行内容视口偏移 96px → 96px（滚动锚点保持）；seq=1 后按钮消失 | PASS |
| 斜杠命令 | `/` 弹 3 条 → `/co` 过滤到 2 条 → 点击插入 `/commit ` 并关闭 | PASS |
| 模型 | chip 显示快照 `ds-r3`；pane 列「提供方默认」+3 模型且当前项标记；切换调用 `setAgentModel('agent-1','ds-r3-mini')` 并更新 chip；daemon 拒绝 → banner 显示错误原文 + chip 回滚 | PASS |
| 审批 actions | 3 个 daemon actions 按 label/variant/顺序渲染（primary/ghost/danger），composer 隐藏；点击回传 `{behavior:'allow', selectedActionId:'allow-always'}`；无 actions 时通用「拒绝/允许一次」；跨端 `permission_resolved` 清除且**不**触发 respondToPermission | PASS |
| 草稿 | 文本随会话切换互不串（A→B→A 恢复） | PASS |
| 子智能体只读 | 打开显示「子智能体会话（只读）」，composer 隐藏 | PASS |
| 重命名 | 对话框 → `updateAgent(agent-5, {name:'QA 改名'})` → 标题更新 | PASS |
| 归档 | 确认 → `archiveAgent` → 行离开抽屉 | PASS |
| 删除 | daemon 失败（db locked）→ 错误显示在确认框内且**行不移除**；重试成功后移除 | PASS |
| 历史 | 「已归档会话」sheet 分页列出（updated_at desc 跨页）；「取消归档」→ `refreshAgent(agent-5)`；sheet 明示「不会恢复正在运行的任务」 | PASS |
| 新会话 | 工作区→提供方→权限模式→**模型** 四步；`createAgent` 收到 `{provider, cwd, workspaceId, modeId:'plan', model:'ds-r3-mini'}` | PASS |
| Console | 全程 0 应用 console error（favicon 404 为既有 harness 伪影，已按 URL 过滤） | PASS |

截图：[sessions](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-27/mobile-web-phase1-sessions.png) · [timeline](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-27/mobile-web-phase1-timeline.png) · [slash](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-27/mobile-web-phase1-slash.png) · [model](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-27/mobile-web-phase1-model.png) · [approval](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-27/mobile-web-phase1-approval.png) · [readonly](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-27/mobile-web-phase1-readonly.png) · [history](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-27/mobile-web-phase1-history.png)

## Manual / real-device matrix

| Surface / path | Result | Notes |
| --- | --- | --- |
| Live relay + Trent 桌面真 daemon（>100 agent 分页、>200 时间线、真 provider 模型/审批/斜杠） | BLOCKED | 云 worker 无 Trent 桌面与控制中继会话；fake-daemon 已覆盖协议语义 |
| 真 daemon 归档/删除/重命名落盘与跨端同步 | BLOCKED | 依赖上一条 |
| Android WebView 实机（固定 app-shell 高度 + 长时间线滚动） | BLOCKED | 无物理设备/SDK；APK 内置同一 SPA 自动继承本轮变更，实机需回归 `.phone` 高度改动在 WebView 的滚动行为 |

BLOCKED 行是发布验收工作，浏览器 fake-daemon 结论不替代真机链路。

## Self-review / adversarial review

- PASS — kill-list：`mobile/web/chisacode/`、`conversation/`、`tools/mobile-web-qa/` 无 `callUnary` / `callShell` / `/__remote__/`；全部 Phase 1 流程走 DaemonClient RPC，无 HTTP v1 回退。
- PASS — 无乐观销毁：删除/归档只在 daemon 确认后移除行，失败留在确认框可见（浏览器检查覆盖 db locked 场景）。
- PASS — 无假「恢复」：查证 `resumeAgent(handle)` 语义是按持久化 handle 重建会话，与官方 App「Unarchive」按钮不同路；取消归档采用与官方一致的 `refreshAgent`（服务端 `unarchiveAgentState` + 重载），文案「取消归档」并明示不会恢复运行中任务。
- PASS — 审批 actions 原样：label/variant/顺序不改写，`selectedActionId` 回传；非法 behavior/空 id 的 action 丢弃（协议校验）；通用按钮仅在 actions 为空时出现。
- PASS — Markdown 注入安全：结构化解析 + createElement/textContent，无 `innerHTML`；`javascript:`/`data:` 链接保持字面文本；浏览器检查确认 `<img onerror>` 不产生元素。
- FOUND/FIXED — `.phone` 用 `min-height` 导致整页（window）滚动、`#log` 从不滚动：时间线底部锚定与 load-older 滚动保持在真实长对话下完全失效（Phase 0 内容短未暴露）。改为固定 app-shell 高度（`height:100dvh` + `overflow:hidden`，connect 屏自身可滚），浏览器检查验证锚点 96px→96px。
- FOUND/FIXED — 审批出现时斜杠弹层不重渲染，会悬浮在被隐藏的 composer 上；`renderApproval` 现在始终重渲染弹层（其可见性判定含 pendingApprovals）。
- FOUND/FIXED — 搜索结果里子智能体行丢失「子智能体」标注（分组只在未过滤视图）；搜索行现在按只读判定补标注。
- ACCEPTED — 附件草稿仅内存跨会话切换、不跨刷新（避免 base64 图片打爆 localStorage 配额）；已写进特性卡与测试为约定行为。
- OBSERVED — `openSession` timeline 拉取失败时 banner 可见但日志区仍显示上一会话内容（Phase 0 既有结构，非本轮引入）；建议 Phase 2 顺手清空并显示错误占位。
- OBSERVED — 阅读历史时新流事件到达会把日志拉回底部（`renderLog` 默认 bottom 锚定，Phase 0 既有行为）；与向上分页叠加时体验欠佳，建议 Phase 2 引入「粘底判定」。
