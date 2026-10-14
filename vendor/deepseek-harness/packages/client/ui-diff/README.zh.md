# @deepseek-ai/dsh-client-ui-diff

[English](README.md) | 中文

右边栏 Diff occupant，挂在 `surfaces.diff`（`single`，`session-maybe`，由 ui-surfaces 声明）。展示工作区变更列表和统一 diff hunk，数据来自桌面 `window.shell.gitDiff(cwd)`。工作区 hunk 是 `git diff HEAD`（同一文件的暂存与未暂存合并）。范围菜单在「工作区」（porcelain 暂存／取消暂存／还原；未跟踪还原走 `git clean -f`，目录 `-fd`）和「分支」（`gitDiff(cwd, { baseRef })` 三点范围，不改 index）之间切换。暂存／取消暂存／还原失败时文件列表仍在，通过持久浮层反馈，不挤动文件列表；操作按钮在处理中保留原始尺寸。分支 Menu 可搜索全部列出的引用。全部折叠／全部展开切换 hunk。点击文件名调用 owner `openFile`。`gitStatus(cwd)` 为 null 时显示：`差异仅适用于 Git 仓库。` 约定：[slot 系统标准](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.zh.md)。

工作区根是当前会话的 `cwd`，只通过一次 `useSessions` 读取。渲染进程不加载 Node。

`/client` 导出表层只包含插件主体（`apply`／`inject`）及约定类型；DiffPanel 仍由 slot 注册封装在包内。

## 模型体验

无。Diff 面板只为展示读取 git；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包（package）既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **没有 turn diff、左右分栏、忽略空白或折行**：分支范围只做 `baseRef...HEAD`；没有 checkpoint 回合范围。不分栏／折行／忽略空白开关。
- **标题栏 Commit 不变**：Diff 上的暂存／取消暂存／还原不替代 `git add -A`。

不发布运行时 invariant companion；本包不拥有独立的持久事件关系，UI 或服务行为由聚焦的包测试覆盖。
