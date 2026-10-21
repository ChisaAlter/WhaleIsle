# @deepseek-ai/dsh-client-ui-git

[English](README.md) | 中文

标题栏尾簇插件：一枚 Session log 语汇的分裂按钮，通过桌面 `window.shell` git IPC 提交、推送并打开变更请求。条目挂在 `shell.titlebar.trailing`，`id: 'git-actions'`，`order: 20`，位于 Session log（`order: 10`）与面板开关（`order: 40`）之间。界面设置 `ui-git.titlebarGit`（默认 true）隐藏该簇；进行中的 toast 与对话框仍保持挂载。约定：[slot 系统标准](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.zh.md)。

主按钮与下拉标签跟随 `resolveQuickAction` 英文（`Commit, push & PR`、`Commit & push`、`Push & create PR`），中英界面相同。分支与操作文案平常收为图标，在鼠标移入、键盘聚焦或对应菜单打开时展开，compact 密度也保留此行为。鼠标移入后已展开的文案保持到指针离开整组，避免跨按钮移动时控件移出指针。触屏保持文字可见，减少动态效果时直接切换。compact 密度下 Initialize Git 仍只留图标。提交对话框展示当前分支、带 `+/-` 的文件列表、可选说明，以及 Cancel / Commit on new branch / Commit。堆叠的提交/推送/PR 与 Pull 会立刻在右上角打开进度卡片（转圈、阶段标题、`Running for Ns` 计时或最新 hook 行），成功或失败（含 hook dump）仍落在同一张卡片上。Pull 是 `git pull --ff-only`。默认分支确认提供 Abort 与在此引用上继续；Checkout feature branch & continue 只在动作包含提交时出现。其余对话框与提示仍走 `git` 字典。GitHub 用语为 Pull request / PR；GitLab 为 MR。当前会话没有 `cwd`，或 `gitStatus` 为 null 时，主按钮 disabled，并提示 Git 状态不可用。已授权但 `isRepo: false` 的 cwd 用「初始化 Git」替换分裂按钮，并调用 `gitInit`。默认分支上的 push / commit_push 先弹出 `resolveDefaultBranchActionDialogCopy` 再执行。状态省略 `hasPrimaryRemote` 时按 false 处理。Create PR/MR 对每个 provider 都留在菜单里，也出现在推送成功 toast 上；桌面 `gitCreateChangeRequest` 在非 GitHub 上仍失败。`gitBranchList` 失败或被拒绝时，分支选择器保持打开，用「分支列表加载失败。」加失败详情两行标签展示，绝不画成「没有匹配的分支」空态；git IPC promise 被拒绝时落到进度卡片上作为失败，而不是让它永远转圈。标记 `switchable: false` 的分支行（名称在桌面切换白名单之外）保持列出但禁用并带 hint。后台状态/fetch/PR 刷新被拒绝时保留上一份快照，绝不表现为错误或未处理的 rejection。提交对话框列出当前 `status.workingTree.files`；不在打开时快照该列表，也没有 `gitChangedFiles` IPC。

`GitActionsProps` 组合标题栏尾簇 owner share、用于当前会话 cwd 的 `useSessions`、注入的 git IPC 回调，以及 `git` 文案 seat。这里没有插件 store。桌面方法只挂在 `window.shell` 上；渲染进程不加载 Node。

`/client` 导出表层只包含插件主体（`apply`／`inject`）及约定类型；GitActionsControl 仍由 slot 注册封装在包内。

## 模型体验

无。标题栏 Git 控件只驱动桌面 git IPC；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包（package）既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **发布走 `gh` 或远程 URL**：没有多提供方 OAuth 向导。对话框执行 `gh repo create --source=. --remote=origin --yes --push`；用户粘贴 URL 时改为 `git remote add` 再推送。提交后关掉对话框、只留进度卡；失败时再打开同一对话框。
- **提交与 PR 文案使用桌面 API key**：空说明在配置了 `loadConfig().apiKey` 时调用 DeepSeek chat，请求失败则整单失败；没有 key 时用 staged name-status / 范围启发式。没有可插拔撰写模型面。
- **不交付 worktree 与线程↔分支绑定**：本桌面没有按会话的 worktree 元数据。
- **变更请求在 GitHub 远程上走 `gh`**：已打开的 PR 通过 `gh pr list --head` 复用；fork 创建会传 `--head owner:branch`。非 GitHub 远程 fail-closed（不交付 GitLab `glab` 等）。commit+push 之后缺少 `gh` 会让整单在 toast 上失败。
- **打开文件走系统默认应用**：提交对话框用 `shell.openPath`，没有首选编辑器选择器。
- **Pull 只快进**：`git pull --ff-only`；stash 与 rebase 只出现在禁用菜单提示里。

不发布运行时 invariant companion；本包不拥有独立的持久事件关系，UI 或服务行为由聚焦的包测试覆盖。
