# git-titlebar · 历史记录

自功能卡 [docs/features/git-titlebar.md](../features/git-titlebar.md) 迁入（2026-11-17，议题 #458）；以下为该卡原有的历史验证与变更记录，原样保留。

## last verified 记录

| Field | Value |
| --- | --- |
| **last verified (session menu)** | 2026-10-06 — 会话头部恢复「…」中的下载日志与反馈；4 个定向测试文件 18/18 通过。Windows 源码桌面在标题栏快捷按钮默认关闭、窄窗隐藏 trailing 区的情况下完成 ZIP 下载，ZIP 内包含该示例会话日志；反馈只打开现有草稿表单，未提交。 |
| **last verified (git fallback resolution)** | 2026-10-03 — PATH 剥离后 `gitStatusEntries` 经标准安装目录回退恢复（`C:\Program Files\Git\cmd\git.exe`），真无 Git 时返回带安装指引的错误文案；`git.test.js` 102/103（唯一失败为本机 symlink 权限环境项）。 |
| **last verified (registry recovery)** | 2026-09-28 — b061501e5b4 的 Windows/macOS 桌面 CI 全绿；漏原生通知的确定性反例先红后绿，去重与停止回归通过。同 SHA 安装树冒烟首次通过；不替代完整生产验收。 |
| **last verified** | 2026-09-20 — `resolveGitPath` 的包含判定由 `rel.startsWith('..')` 改为 `isPathInside(root, target)`：真实名字 `..notes` / `sub/..cache` 恢复可暂存（新用例 `gitStage stages real names that merely begin with two dots` 断言 `git diff --cached --name-only` 可见，且真穿越仍拒绝）；`git*.test.js` 与 workspace 组合套件、根 `npm test`（1849 项，1847 pass / 0 fail / 2 skipped）通过。此前 2026-08-31 — pin `0.1.2-alpha.2` 工作区自动登记改为 Typert HTTP unary `POST /api/workspace/create` + `{ args: { request: { path } } }`（旧点号 `/api/workspace.create` 404，标题栏「切换分支」一直 disabled）。本机 `smoke:source`：surfaces/branch/git 均打开。此前同日 — `gitPush` 成功或 skip 后补齐 `refs/remotes/<primary>/HEAD`（先 `set-head --auto`，否则刚推的分支），非 main 首发仓 `isDefaultRef` 为真，胶囊走 Commit & push。此前 2026-08-25 — 审查批次 3：首载登记竞态根因修复（主进程 watch `workspace.json` → 推 `shell:git-workspaces-changed` → 标题栏即刻重读状态；含武装间隙补发）；win32 `taskkill` 非零退出回退 `child.kill()`；登记兄弟仓 `gitBranchList` 全链路自动化（TC-WS-006/TC-GIT-001 关键断言的 rehearsal）；禁用行 hint Tooltip 与 `shell:git-branch-list` 抛错接线补测。实机 Electron（Linux/xvfb + CDP）验证：未登记兄弟仓 → 写入登记 → renderer 收到信号 → gitStatus/gitBranchList 即刻授权；`smoke:source` 通过。合并树 `ea659884`（consolidation #39 落地后）：desktop `npm test` 997/0/3 绿（git 链单测在内）+ `qa:source` titlebar/branchMenu/gitMenu/commit 步骤 PASS。实机 Windows 仍未覆盖（验证手册见 [合并收口计划 Phase 5](../superpowers/plans/2026-08-25-post-consolidation-closeout.md)） |；本次 alpha.4：source smoke 与 packaged P0 的 titlebar/Git 命中通过。

| **last verified (refresh read context)** | 2026-09-22 — one titlebar refresh now shares one main-process Git read context (`src/main/git-read-context.js`; 2s TTL, per-worktree, read-only whitelist only). `gitStatus` opens the context and records its result; `gitFetchForStatus` reuses that status when the fetch was skipped inside its cooldown and only drops remote-derived entries after a real fetch (`forget(args[0] !== 'diff')`), so the working-tree diff is not re-read; `gitReadPullRequest` consumes the same status snapshot instead of running a second full `gitStatus(root)`. stage/unstage/discard/commit/push/pull/branch/init all invalidate through `withWriteInvalidation`. Fixed `main + origin + upstream` fixture: warm refresh 37 → 11 git children (-70%), ~1750 ms → ~400 ms (-77%). Gates: real `node:child_process.spawn` counting asserts exactly one `status --porcelain=v2`, one `diff HEAD --numstat`, and ≤11 local git children, plus a write-invalidation negative (status after `gitStage` must see the staged change); `git.test.js` 93/93, `git-read-context.test.js` 12/12. |
| **last verified (titlebar capsules)** | 2026-09-23 — 会话标题栏「在应用中打开」、Session 日志与 Git 胶囊统一为 32px 高、18px 圆角、`--dsw-alias-border-l2` 半像素描边和 14px 图标；文档预览栏保留 24px 控件规格。|
| **last verified (unavailable state)** | 2026-09-23 — 无 cwd、Git 状态加载中或读取不可用时隐藏整组标题栏 Git 控件；`ui-git` 定向测试 62/62 通过，含登记后恢复与非仓库初始化；定向类型检查、客户端打包与 Web 构建通过。|

| **last verified (crowding opt-in + overflow)** | 2026-09-28 — Session 日志胶囊默认收进界面设置（`session-log-download.titlebarAction` 默认 `false`，`ChromeVisibility` 按初始默认收紧谓词）；被 cozy/compact 密度收起的 `conversation.session.header.actions` 由 utilities 前的 28px 箭头座席承接——悬停/聚焦临时弹出、点击 pin 住、Esc/外部点击收起，密度回到 `full` 时座席卸载。`session-log-export` 相关测试（chrome-visibility/client-apply/host/route/archive 61 项）与 `skeleton.client.spec.tsx` 45 项（含两条溢出用例）绿；`desktop-chrome.e2e.ts` 走 `sessionLogTitlebarAction` scaffold 选项验证 opt-in 集群；release QA 新增 `interface.sessionLogSwitch` 步验证开关路径并还原默认。|

## 正文历史段落

最近验证：2026-09-28，登记 watcher 增加低频元数据核对与去重，漏原生事件/创建/改写/删除/停止反例通过；与预览、工作区、编辑器组合 200/200。完整远端候选结果以发布准备报告为准。

| **last verified (reveal reflow)** | 2026-11-15 — 胶囊悬停展开/收起期间 `AppFrame` 不再逐帧更新 trailing 宽度 state：展开开始即一次性让出 `data-titlebar-pending-room` 宣告的额外空间，收起期间保持展开宽度，全部相关过渡 end/cancel 归零后才重测终值；零时长过渡（reduced-motion/minimal）与非动画尺寸变化仍即时照常更新。`vitest run packages/client/ui-layout packages/client/ui-git packages/client/ui-conversation` 105 文件 1617/1617 通过；`tsc -b tsconfig.client.json` 通过；改动行 oxlint 零告警。|
