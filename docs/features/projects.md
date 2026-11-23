# Feature: Local Projects

Project 以左侧边栏独立入口打开主区三栏全页项目看板（项目列表 | 嵌入式协调者对话 | 执行者 Threads 面板），采用「项目 → 协调者会话 → 并行 Worker 子会话」的轻量化编排模型，完整复用原生 DSH 对话、模型切换、审批、文件预览与 Git Worktree 隔离。

## 入口与可用性

- **侧栏入口**：注册在 `sidebar.panellist`（`id: 'projects'`，`order: 30`），点击在主区 `main` 槽位（`key: 'projects'`）挂载三栏项目看板，落在 `AppFrame` 的 `mainPanel` 内容行，不侵入 48px 标题栏与窗口控件。不再在普通侧栏挂 Project 标签、不再在新会话首屏放置 Project 按钮、不再使用 312px 悬浮栏。
- **开关与平滑退出**：Settings › Built-in Features › Project 默认开启（`projectEnabled: true`，源码可用 `WHALE_PROJECT=1` 强制开启）。关闭前 `ui-settings-general` 的 `leaveProjectPanel()` 会将当前处于 `'projects'` 面板的主区切回普通对话，再写入配置并重启 Harness；关闭保留 `$DSH_HOME/projects/` 磁盘数据。

## 三栏看板与核心交互

1. **左栏（项目列表）**：默认 248px / 最小 188px，可折叠为 44px 图标轨；展示项目名、工作区简称与实时状态计数，支持新建项目弹窗与底部折叠展示已归档项目。
2. **中栏（协调者主对话）**：最小 400px，通过 `SessionProvider` + `conversation.content`（`variant: 'embedded'`）直接嵌入真实 DSH 会话，享受完整原生输入栏、模型/思考强度切换、附件、权限与停止能力。顶栏精简为项目名、可点击工作区胶囊、手动审批/自动派发一键切换、暂停/恢复一键切换与设置齿轮；未启动时提供「启动协调者」主按钮，协调者会话归档时提供恢复横幅。对话内的 `projects_dispatch` 工具调用卡（`tool.call.toolview`）点击可直接定位右栏对应任务详情。
3. **右栏（执行者 Threads 面板）**：默认 380px / 最小 280px，可折叠为 44px 计数轨；经 `EventSource('/projects-api/events')` 毫秒级 SSE 实时同步（断线自动重连并补拉）。固定 5 个可折叠分组：`执行中 (running)`、`待验收 (review)`、`等你处理 (blocked + failed)`、`待开始 (queued)`、`已解决 (resolved，默认折叠)`。
   - 卡片支持悬浮快捷停止/批准、右键菜单（验收/取消验收、停止、重试、二段防误触删除：「只删任务」或「删除并归档会话」）。
   - 点击卡片在右栏原位切换为 **任务详情**：粘性顶栏提供返回、批准/停止/重试/Resolve 操作及分支/降级提示；双子标签支持「对话」（原位嵌入 Worker 真实持续会话）与「改动」（查看 Diff 变更列表、安全合并 Worktree 到主分支与清理 Worktree）。
4. **共享右栏文件预览**：`ui-sidebar-right` 在 `activePanelId === 'projects'` 下默认收起不占宽；当用户在项目页嵌入对话中点击文件路径（`workspaces.openPath`）时，自动按需挂载该会话并展开右栏文件预览，关闭即收起。

## 数据模型、共享记忆与执行治理

- **统一任务状态机**：`queued | running | review | failed | blocked | resolved`，支持 `dependsOn` DAG 依赖环路校验、并发上限（1–8）、手动/自动审批与项目暂停。
- **8 个协调者/执行者工具**：`projects_list`、`projects_get`、`projects_create`、`projects_update`、`projects_add_task`、`projects_update_task`、`projects_memory`、`projects_dispatch`，全部在 `src/shared/model-tool-effects.js` 登记并与静态扫描双向对账。
- **分文件共享记忆**：存储在 `$DSH_HOME/projects/<projectId>/memory/<slug>.md`（配只读 `MEMORY.md` 索引与 `memory/archive/`），支持超预算单飞自动归档与应用内双栏设置弹窗预览/编辑/删除。
- **Git Worktree 与工作区权威**：开启 `worktreeIsolation` 时在 `$DSH_HOME/project-worktrees/<projectId>/<taskId>` 创建隔离工作树（分支 `project/<taskId>`），非 Git 仓库自动优雅降级。`src/main/workspace-authority.js` 校验并授权 `$DSH_HOME/projects/<projectId>/project.json` 中的 `workspace` 与位于 `$DSH_HOME/project-worktrees/<projectId>/<taskId>` 的任务工作树，同时保留对旧版 `storages/whale_project_local` 与 `desktop-workspaces` 回执的只读兼容。
- **宿主流控与大肥鱼桥接**：`ProjectService` 通过 `ctx.provide('projects', service)` 暴露 `available`、`inspect()`、`schedule()`（对接 `dsh-task-control` 退出/更新准入锁）以及 `listBridgeSummaries()`、`inspectBridgeProject()`、`acceptAuthorizedHandoff()`（对接 `dsh-whale` 跨项目移交工具）。

## 实现与兼容说明

- 后端与前端实现位于 `vendor/dsh-project/`（HTTP + SSE 前缀 `/projects-api`，插件说明见 [vendor/dsh-project/README.md](../../vendor/dsh-project/README.md)）。
- 桌面装配与运行时暂存位于 `src/main/dsh-project-desktop.js`；工作区与工作树权威位于 `src/main/workspace-authority.js`；旧数据位于 `$DSH_HOME/storages/whale_project_local/` 与 `$DSH_HOME/projects/<id>/`，重做版本保留原有历史会话与磁盘文件不覆盖。
- 历史架构与早期验证记录保留在 [docs/history/projects.md](../history/projects.md)。
