# Feature: Local Projects

Project 以左侧边栏独立入口打开主区全高项目工作台（总览画布 + 单项目最多两栏工作台），采用「项目 → 隔离协调者会话 → 并行 Worker 子会话」的轻量化编排模型，完整复用原生 DSH 对话、模型切换、审批、文件预览与 Git Worktree 隔离。

## 入口与壳层集成

- **侧栏入口与全高单层顶栏**：注册在 `sidebar.panellist`（`id: 'projects'`，`order: 30`），在主区 `main` 槽位（`key: 'projects'`）挂载于 `AppFrame` 的 `.mainPanelFull`（`grid-row: 1 / -1`，`data-main-panel-full="projects"`），由工作台自带单层 48px Row 1 顶栏并避让 `--dsh-frame-leading-clearance`、`--dshd-titlebar-conversation-reserve` / `--dshd-wco-controls`，彻底消除双层叠床顶栏。不再在普通侧栏挂 Project 标签、不再在新会话首屏放置 Project 按钮、不再使用 312px 悬浮栏。
- **标题栏尾簇门控与共享右栏文件预览**：在 `activePanelId === 'projects'` 下隐藏无关后台会话的 Git 操作（并跳过其 `gitStatus` 轮询）以及未展开时的终端/普通右栏开关，阻止 `Ctrl+\` 触发无会话表面异常；当用户在项目页嵌入对话或资料库中点击文件路径（`workspaces.openPath`）展开 `ui-sidebar-right` 预览后，右上角收起钮与 `Ctrl+\` 自动恢复可达，关闭即收起。
- **开关与平滑退出**：Settings › Built-in Features › Project 默认开启（`projectEnabled: true`，源码可用 `WHALE_PROJECT=1` 强制开启）。关闭前 `ui-settings-general` 的 `leaveProjectPanel()` 会将当前处于 `'projects'` 面板的主区切回普通对话，再写入配置并重启 Harness；关闭保留 `$DSH_HOME/projects/` 磁盘数据。

## 总览与单项目两栏工作台

1. **总览画布（`ProjectsOverview`）**：
   - **0 项目空态**：垂直居中单画布空态（`[data-projects-empty="true"]`），仅保留清晰标题、一句话说明与单主按钮「新建项目」，无左右空栏与重复标题。
   - **项目卡片网格**：≥ 1 个项目点击顶栏「← 全部项目」进入 `max-width: 920px` 居中卡片网格，展示统一三色状态微点与实时计数，支持归档筛选、进入、设置、归档/恢复与二段确认删除。
2. **单层 48px 顶栏（`WorkspaceTopbar`）、`ProjectSwitcher` 与三色微点**：
   - 移除旧版独立 248px 左项目栏，主区最多呈现 2 栏。
   - 顶栏左侧提供「← 全部项目」、复用 `Menu` 原语的 `ProjectSwitcher`（支持活跃/已归档项目切换与快捷新建）与可点击工作区胶囊（窄窗自动收起避免裁切）；右侧提供派发模式（默认「自动并行」，可切换「手动逐条审批」）、暂停/恢复一键切换、设置齿轮与带状态微点的「线程 · N」项目上下文抽屉开关。
   - **统一三色实时状态微点（`ProjectStatusDot`）**：事件驱动、零模型消耗，按 **`waiting`（黄：`blocked`/`failed`/手动待批） > `running`（蓝呼吸） > `review`（绿） > `idle`（灰）** 统一呈现于总览卡片、`ProjectSwitcher` 触发器及下拉列表、顶栏抽屉开关；运行中任务在窗口失焦时转入 `review` / `blocked` / `failed` 时，幂等安全触发系统 `Notification`（点击聚焦并直达对应项目/任务宽屏详情）。
3. **宽屏主区（`.pj-stage`，最小 400px）**：
   - **隔离协调者对话**：进入项目自动调用 `POST /projects-api/projects/:id/coordinator/ensure` 幂等创建或复用带 `presentation: { owner: 'dsh-project', title, workingDirectory }` 的空白受管协调者会话，不自动发送英文首消息、不污染普通对话侧栏；嵌入式会话传 `variant: 'embedded'` 与 `hero: false, phase: 'active'`，不闪通用欢迎首屏，在壁纸/渐变/透明/亚克力主题下无暗色座位底带；协调者已归档时显示显式恢复横幅。
   - **主区宽屏原位任务钻取（`TaskDetailStage`）与 Diff 定向提修改闭环**：点击任务卡、产物/记忆来源任务或对话内 `projects_dispatch` 工具调用卡（`tool.call.toolview`）时，在主区原位切换为宽屏任务详情；紧凑次级顶栏提供「← 返回协调者」、状态、分支/模型元信息、「对话 / 改动」分段页签及批准/停止/重试/Resolve 动作，让 Worker 真实持续对话与 Diff 审阅、Worktree 合并/清理享有 600px+ 宽屏。
     - `改动` 页签工具栏展示只读 `mergeability` 合并冲突预检徽标（`可无冲突合并` / `存在合并冲突 (N)` / 未提交改动 / 已合并，失败安全降级不阻断 Diff）。
     - 每个变更文件行尾提供轻量「提修改」按钮：点击仅向底部「向此执行者发修改意见」输入框预填 `[文件路径] ` 并聚焦（不误发），确认发送后直发该任务 Worker 会话并自动切回「对话」页签观察修复；嵌入式 Worker 人工追问完成后，`settleWorker` 刷新 `output` 并将 `failed | blocked` 自动回写为 `review`。
4. **按需右侧 3 分段项目上下文抽屉（默认 340px / 最小 280px，不增第三栏）**：
   - **自动收起与窄窗浮层**：项目 0 任务且 0 参考资料时默认自动收起释放全宽（点击顶栏开关可随时展开）；有任务经 `EventSource('/projects-api/events')` 到达时自动展开；容器实测宽度 `< 680px` 时自动切换为玻璃浮层抽屉（`.pj-exec-overlay`），点选任务自动收起浮层不挤压主区。
   - 抽屉顶部以 `SegmentedTabs` 切换 **「线程 / 资料 / 记忆」** 三页签：
     - **`线程` 页签**：按行动优先级固定 5 个可折叠分组：**`等你处理`（`blocked` + `failed`，置顶并带黄色强调）** → `执行中`（蓝呼吸点）→ `待验收`（绿点）→ `待开始`（`queued`）→ `已解决`（`resolved`，默认折叠）。移除原始 `task.id` 噪音芯片，快捷批准/停止位于卡片独立尾部行不遮挡标题与时间；右键菜单支持验收/取消验收、停止、重试与二段防误触删除（「只删任务」或「删除并归档会话」）。
     - **`资料`（Library）页签**：上区 `参考资料` 支持 `+ 添加文件`（路径输入/目录选取与 `aria-invalid` 原位校验，对接 `POST/DELETE /projects-api/projects/:id/library/references`，移除仅删指针不删磁盘文件）；下区 `任务产物` 自动展示 `library.artifacts`，支持点击文件优先走 `workspaces.openPath(path, { sessionId })` 在共享右栏预览（回退 `/projects-api/open-path`），点击来源任务标签直跳宽屏 `TaskDetailStage`。
     - **`记忆` 页签**：上区 `项目规则（Instructions）` 支持抽屉内原位查看、展开编辑与保存；下区 `共享记忆` 展示热记忆主题数/置顶数与 Token 预算条、160ms 防抖本地搜索（`GET /memory?q=...`）、主题卡片一键置顶/取消置顶（`PATCH /memory/:slug` `{ pinned }`）及 `sourceTaskId` 来源任务直跳链接。
5. **设置、目录选择与删除**：
   - 新建/设置/共享记忆编辑器/二段确认弹窗均复用原生 `Modal`（`--dsw-alias-bg-layer-2` + `--dsw-menu-backdrop-filter`，独立滚动正文不裁切底栏），表单单选与下拉采用 `SegmentedControl` / `SettingsSelect`；新建项目默认选中「自动并行（`auto`）」；设置页补齐 `agentPreset` 与「项目名称 + 指令」统一保存；目录选择器优先调用 `uiWorkspace.selectDirectory()`（兼容 `pickDirectory()`）；字段校验走原位 `aria-invalid` 不增高表单，全部 Toast 统一 4500ms 自动淡出。
   - 支持项目删除（`DeleteProjectModal` 对接 `DELETE /projects-api/projects/:id`，可选 `archiveSessions`）：先停止运行中任务并清理关联 Worktree、可选归档协调者及 Worker 会话，经边界与 symlink 校验后删除 `$DSH_HOME/projects/<id>` 与空 worktree 池，永不触碰用户 `workspace` 源码，并推送 `project.deleted` SSE。

## 生命周期、自动回流、资料/记忆与执行治理

- **默认 `auto` 自治度、自动续派与人类验收边界**：
  - `normalizeProject` 与新建项目默认采用 `autonomy: 'auto'`（兼容旧已落盘 `'manual'` 项目与显式切换）。
  - 统一任务状态机为 `queued | running | review | failed | blocked | resolved`，支持 `dependsOn` DAG 依赖环路校验、并发上限（1–8）与项目暂停。
  - `scheduleReadyTasks` 形成完整自动接力调度闭环：批准任务（`approveTask` 返回 `{ task, dispatched }`）、切换 `autonomy: 'auto'`、恢复 `paused: false`（返回 `dispatchedTaskIds`）、`settleWorker()` 释放并发槽位、`resolveTask()` 标记 `resolved` 解锁下游依赖（返回 `dispatchedTaskIds`），以及 `dsh-task-control` 触发 `schedule()` 解锁时，均自动拉起全部就绪任务。
  - `projects_update_task` 代码级拒绝 `status: 'resolved'`——验收与 Worktree 合并严格保留给人类操作。
- **子线程完成/受阻自动回流协调者（1.5s 批合并 + 幂等防重）**：
  - 任务落入 `review` / `failed` / `blocked`（排除人工 `stopTask`、重启僵尸恢复、暂停或已归档项目）后进入 `1500ms` 批合并窗口，将同时段收尾的并行任务合并为单条结构化回执（任务标题、状态、变更文件数、合并预检结果、≤260 字摘要、关联产物及 `allSettled` 标志，绝不灌入原始长日志）投递给协调者主会话。
  - 按 `(projectId, taskId, settledAt)` 幂等防重；投递后广播 SSE `{ type: 'coordinator.notified', projectId, taskIds, allSettled }`；服务卸载 `dispose()` 自动清理全部挂起定时器。
- **Prompt Cache 友好的协调者提示词分层**：
  - **稳定前缀**（`systemPrompt.section`，`projects:coordinator`，order 700，`interpolate: false` 防止目标含 `{{...}}` 崩溃）：固定承载协调者工作协议（1–3 个短问题澄清歧义 → 独立任务直接并行扇出 → 划分不重叠 `writePaths` → 绝不回吐内部 `taskId` → 一句话中文汇报结论与验收建议）、工作区与项目指令（`project.goal`），避免任务与记忆变动击穿 KV Cache，并同步改名/改工作区到协调者 `presentation`。
  - **动态尾部**（优先 `systemPrompt.context`，`projects:coordinator:state`，order 700，`interpolate: false, required: true`，宿主不支持时降级为后置 `section`）：实时注入任务板快照、资料库（Library）索引与 `MEMORY.md` 热索引。
- **重启恢复与并发健壮性**：宿主重启时 `store.primeSync` 触发 `recoverInterruptedTasks`，将未落 `finishedAt` 的僵尸 `running` 任务自动转为 `blocked`（`stopReason: 'interrupted_by_restart'`）释放并发槽位与退出锁；`earlySettlements` 与 `stoppingTasks` 消除极快结束与停止竞态；重启后停止走 `subagents.interrupt`；`routeChanged` 感知项目默认模型/`agentPreset`/思考强度变更以启动新 Worker 会话。
- **工具规范化与作用域隔离**：8 个工具（`projects_list`、`projects_get`、`projects_create`、`projects_update`、`projects_add_task`、`projects_update_task`、`projects_memory`、`projects_dispatch`）全部使用 `defineTool` 注册（严格参数校验 + `presentCall`/`presentResult` 卡片）并在 `src/shared/model-tool-effects.js` 静态对账；通过 `{ when }` 实现严格可见性隔离——普通会话 0 个可见，Worker 仅见 `projects_get` / `projects_memory`，协调者见全部 8 个。
- **大肥鱼移交 `scopeCeiling` 运行时守卫**：`vendor/dsh-project/lib/scope-guard.js` 经 `ctx.tools.guard` 注册。在鲸鱼娘移交回合创建任务时自动继承并钳制 `scopeCeiling` / `writePaths`（只允许收紧、禁止提权）；Worker 运行时按 `readonly` / `research` / `docs` / `development + writePaths` 实施代码级工具拦截（如禁止 shell、禁止写非文档文件或越界路径、禁止 `readonly` 修改共享记忆）。
- **项目资料与产物库（`library.json`）**：
  - 存储在 `$DSH_HOME/projects/<projectId>/library.json`，维护 `references`（仅存安全校验后的文件指针，删引用不删磁盘文件）与 `artifacts`（支持 `projects_update_task` `artifacts` 显式登记 + 任务进入 `review` 时自动归集 worktree 变更文件并按 `(taskId, path)` 去重），变动广播 SSE `library.updated`。
- **分文件共享记忆（置顶、溯源、检索与预算）**：
  - 存储在 `$DSH_HOME/projects/<projectId>/memory/<slug>.md`（配只读 `MEMORY.md` 索引与 `memory/archive/`），frontmatter 扩展记录 `pinned` 与 `sourceTaskId`，元数据汇总 `hotCount`、`pinnedCount`、`estimatedTokens`、`budgetTokens`。
  - `GET /projects-api/projects/:id/memory?q=...` 提供零依赖本地分词 + 中文 2-gram 相关性检索；`PATCH /projects-api/projects/:id/memory/:slug` 支持置顶与元数据更新；置顶记忆在超预算单飞自动归档（`planFileArchive`）中永不被归档。
- **工作区校验、Git Worktree `.worktreeinclude` / `mergeability` 与桌面文件权威**：
  - `validateWorkspacePath` 在前后端一致拒绝非绝对路径、不存在目录、UNC/异常字符、盘符根、用户主目录、`$DSH_HOME` 及系统配置目录（HTTP 返回 `400 { code: 'invalid_workspace' }`）。
  - 开启 `worktreeIsolation` 时在 `$DSH_HOME/project-worktrees/<projectId>/<taskId>` 创建隔离工作树（分支 `project/<taskId>`），Windows 下默认注入 `-c core.longpaths=true`；创建时按仓库根 `.worktreeinclude`（经 `git ls-files`）安全复制匹配的未跟踪/忽略本地文件（如 `.env.local`），严格拦截 `..`、`.git` 与 symlink 逃逸并限制大小与数量。非 Git 仓库自动降级，monorepo 子目录降级共享 Diff 通过 `pathspec` 严格限定在项目子目录内。
  - `getTaskDiff` 返回基于 `git merge-tree --write-tree --name-only` 的只读 `mergeability` 预检对象（`clean` / `conflicts` + `conflictFiles` / `dirty_worktree` / `dirty_workspace` / `already_merged` / `unavailable`），异常安全降级不阻断 Diff。
  - `src/main/workspace-authority.js` 与 `src/main/project-environment.js`（`openPath`）授权 `$DSH_HOME/projects/<projectId>/project.json` 登记的 `workspace`、v2 `projects/<id>/memory`、登记的 `project-worktrees/<id>/<taskId>` 以及 `library.json` 登记的合法 `references`/`artifacts` 文件，同时继续拒绝 `project.json`、`library.json` 与未登记/内部高危目录，保留旧版 `storages/whale_project_local` 只读兼容。
- **宿主流控与大肥鱼桥接**：`ProjectService` 通过 `ctx.provide('projects', service)` 暴露 `available`、`inspect()`、`schedule()`（对接 `dsh-task-control` 退出/更新准入锁）以及 `listBridgeSummaries()`、`inspectBridgeProject()`、`acceptAuthorizedHandoff()`（对接 `dsh-whale` 跨项目移交，自动复用 `ensureCoordinatorSession` 并在协调者已归档时自动恢复）。

## 实现与兼容说明

- 后端与前端实现位于 `vendor/dsh-project/`（HTTP + SSE 前缀 `/projects-api`，插件说明见 [vendor/dsh-project/README.md](../../vendor/dsh-project/README.md)）；壳层全高面板、标题栏门控与嵌入式会话样式位于 `vendor/deepseek-harness/packages/client/{ui-layout,ui-git,ui-titlebar,ui-conversation}`。
- 桌面装配与运行时暂存位于 `src/main/dsh-project-desktop.js`；工作区权威与路径打开分别位于 `src/main/workspace-authority.js` 与 `src/main/project-environment.js`；重做版本保留原有历史会话与磁盘文件不覆盖。
- 历史架构与早期验证记录保留在 [docs/history/projects.md](../history/projects.md)。
