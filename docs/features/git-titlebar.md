# Feature: Git titlebar

| Field | Value |
| --- | --- |
| **id** | `git-titlebar` |
| **status** | `active` |
| **last verified (session menu)** | 2026-10-06 — 会话头部恢复「…」中的下载日志与反馈；4 个定向测试文件 18/18 通过。Windows 源码桌面在标题栏快捷按钮默认关闭、窄窗隐藏 trailing 区的情况下完成 ZIP 下载，ZIP 内包含该示例会话日志；反馈只打开现有草稿表单，未提交。 |
| **last verified (git fallback resolution)** | 2026-10-03 — PATH 剥离后 `gitStatusEntries` 经标准安装目录回退恢复（`C:\Program Files\Git\cmd\git.exe`），真无 Git 时返回带安装指引的错误文案；`git.test.js` 102/103（唯一失败为本机 symlink 权限环境项）。 |
| **last verified (registry recovery)** | 2026-09-28 — b061501e5b4 的 Windows/macOS 桌面 CI 全绿；漏原生通知的确定性反例先红后绿，去重与停止回归通过。同 SHA 安装树冒烟首次通过；不替代完整生产验收。 |
| **last verified** | 2026-09-20 — `resolveGitPath` 的包含判定由 `rel.startsWith('..')` 改为 `isPathInside(root, target)`：真实名字 `..notes` / `sub/..cache` 恢复可暂存（新用例 `gitStage stages real names that merely begin with two dots` 断言 `git diff --cached --name-only` 可见，且真穿越仍拒绝）；`git*.test.js` 与 workspace 组合套件、根 `npm test`（1849 项，1847 pass / 0 fail / 2 skipped）通过。此前 2026-08-31 — pin `0.1.2-alpha.2` 工作区自动登记改为 Typert HTTP unary `POST /api/workspace/create` + `{ args: { request: { path } } }`（旧点号 `/api/workspace.create` 404，标题栏「切换分支」一直 disabled）。本机 `smoke:source`：surfaces/branch/git 均打开。此前同日 — `gitPush` 成功或 skip 后补齐 `refs/remotes/<primary>/HEAD`（先 `set-head --auto`，否则刚推的分支），非 main 首发仓 `isDefaultRef` 为真，胶囊走 Commit & push。此前 2026-08-25 — 审查批次 3：首载登记竞态根因修复（主进程 watch `workspace.json` → 推 `shell:git-workspaces-changed` → 标题栏即刻重读状态；含武装间隙补发）；win32 `taskkill` 非零退出回退 `child.kill()`；登记兄弟仓 `gitBranchList` 全链路自动化（TC-WS-006/TC-GIT-001 关键断言的 rehearsal）；禁用行 hint Tooltip 与 `shell:git-branch-list` 抛错接线补测。实机 Electron（Linux/xvfb + CDP）验证：未登记兄弟仓 → 写入登记 → renderer 收到信号 → gitStatus/gitBranchList 即刻授权；`smoke:source` 通过。合并树 `ea659884`（consolidation #39 落地后）：desktop `npm test` 997/0/3 绿（git 链单测在内）+ `qa:source` titlebar/branchMenu/gitMenu/commit 步骤 PASS。实机 Windows 仍未覆盖（验证手册见 [合并收口计划 Phase 5](../superpowers/plans/2026-08-25-post-consolidation-closeout.md)） |；本次 alpha.4：source smoke 与 packaged P0 的 titlebar/Git 命中通过。

| **last verified (refresh read context)** | 2026-09-22 — one titlebar refresh now shares one main-process Git read context (`src/main/git-read-context.js`; 2s TTL, per-worktree, read-only whitelist only). `gitStatus` opens the context and records its result; `gitFetchForStatus` reuses that status when the fetch was skipped inside its cooldown and only drops remote-derived entries after a real fetch (`forget(args[0] !== 'diff')`), so the working-tree diff is not re-read; `gitReadPullRequest` consumes the same status snapshot instead of running a second full `gitStatus(root)`. stage/unstage/discard/commit/push/pull/branch/init all invalidate through `withWriteInvalidation`. Fixed `main + origin + upstream` fixture: warm refresh 37 → 11 git children (-70%), ~1750 ms → ~400 ms (-77%). Gates: real `node:child_process.spawn` counting asserts exactly one `status --porcelain=v2`, one `diff HEAD --numstat`, and ≤11 local git children, plus a write-invalidation negative (status after `gitStage` must see the staged change); `git.test.js` 93/93, `git-read-context.test.js` 12/12. |
| **last verified (titlebar capsules)** | 2026-09-23 — 会话标题栏「在应用中打开」、Session 日志与 Git 胶囊统一为 32px 高、18px 圆角、`--dsw-alias-border-l2` 半像素描边和 14px 图标；文档预览栏保留 24px 控件规格。|
| **last verified (unavailable state)** | 2026-09-23 — 无 cwd、Git 状态加载中或读取不可用时隐藏整组标题栏 Git 控件；`ui-git` 定向测试 62/62 通过，含登记后恢复与非仓库初始化；定向类型检查、客户端打包与 Web 构建通过。|

| **last verified (crowding opt-in + overflow)** | 2026-09-28 — Session 日志胶囊默认收进界面设置（`session-log-download.titlebarAction` 默认 `false`，`ChromeVisibility` 按初始默认收紧谓词）；被 cozy/compact 密度收起的 `conversation.session.header.actions` 由 utilities 前的 28px 箭头座席承接——悬停/聚焦临时弹出、点击 pin 住、Esc/外部点击收起，密度回到 `full` 时座席卸载。`session-log-export` 相关测试（chrome-visibility/client-apply/host/route/archive 61 项）与 `skeleton.client.spec.tsx` 45 项（含两条溢出用例）绿；`desktop-chrome.e2e.ts` 走 `sessionLogTitlebarAction` scaffold 选项验证 opt-in 集群；release QA 新增 `interface.sessionLogSwitch` 步验证开关路径并还原默认。|

## User paths

最近验证：2026-09-28，登记 watcher 增加低频元数据核对与去重，漏原生事件/创建/改写/删除/停止反例通过；与预览、工作区、编辑器组合 200/200。完整远端候选结果以发布准备报告为准。

1. 标题栏看当前分支 → 打开「选择分支」→ 搜索 / 切换 / 创建并检出。
2. Commit / Push / Pull / 变更请求（有远程且配置允许时）。
3. 已打开的工作区是 Git 仓库时，分支列表来自该仓库，不因启动目录不是其父目录而变空。

## Invariants

- 登记文件的原生通知丢失时，每 2 秒核对一次元数据补发；防抖与已送达状态去重覆盖两路，停止监听必须同时停止轮询。

- Git 的 `.git` 保护与 Files 同一套并锚定到**受信任根**：`resolveGitPath` 经 `resolveInside`/`resolveAuthorizedCwd` 解析，调用方传入落在 `.git` 内的 cwd（直接、子目录、或经无害链接）一律拒绝；realpath 失败时区分「真的不存在」与「悬空链接」，后者拒绝。（2026-09-20，`git*.test.js` + workspace 103/103）
- 会话 cwd 只要是桌面 `dsh-home` 已登记的工作区目录（或启动工作区及其子目录），Git IPC 就对该路径生效。
- 登记路径可以是启动工作区的**兄弟目录**（例如 `Documents\Deepseek-Harness-Desktop` 启动、`C:\Ai\ChisaTerminal` 为当前项目）。
- `workspace.json` 里的盘符根（`C:\`、`/`）不得进入 Git/FS/PTY 白名单。
- Git 路径包含判定与 Files 同一套：`resolveGitPath` 按解析后路径判根内，不再用 `rel.startsWith('..')`。名字仅以两点开头的真实子项（`..notes`、`sub/..cache`）必须能暂存/取消暂存，真穿越仍拒绝。
- 高危祖先也不得成为登记信任根：用户主目录、`%APPDATA%` / `Application Support` / `~/.config` / `~/.ssh`、desktop `userData` 与 `dsh-home` 根（等于这些目录、或包含它们的目录一律拒绝）。普通项目目录（含 Documents 下兄弟仓）不受影响。
- 非仓库降级（初始化 Git），不把授权失败画成「没有匹配的分支」；分支列表 IPC 失败在菜单内画「分支列表加载失败。」加详情行，不落空态。
- 无工作目录、当前 cwd 的状态尚未载入或 Git 状态为 `null` 时，不绘制分支、Commit 和下拉；切换 cwd 不闪现上一仓库的控件。已确认非仓库显示「初始化 Git」，有效仓库的禁用快速动作不阻断分支和菜单。
- 分支菜单选无本地同名的远端行（`origin/feature-x`）时 `checkout --track` 建本地跟踪分支，不允许 detached HEAD。
- `shell:git-*` handler 异常必须 resolve 为该通道的失败载荷（状态/diff 类 → `null`，其余 → `{ok:false,message}`），不得让 renderer 的 invoke reject；授权检查仍在兜底之外照常 reject。进度 toast 不允许永久 loading。`shell:open-workspace-path` 同样走该兜底。
- renderer 侧 `refresh()`/`settleStatus()` 的后台 status/fetch/PR 刷新 promise 拒绝时按 `null`/`ok:false` 降级、保留上一份快照，绝不产生 unhandled rejection，也不把已成功的动作重画成失败。
- 一次 refresh 的 `gitStatus` / `gitFetchForStatus` / `gitReadPullRequest` 共用一份**主进程**读取上下文：context 由主进程按 worktree 开启并放在 `git-exec.runGit` 这个唯一 choke point 上，只缓存只读白名单子命令（`config` 仅 getter，带 `limits` 的调用不共享）。renderer 不能提交或指定快照。fetch 在 cooldown 内跳过时复用本轮 status；真实 fetch 后作废远端派生项但保留工作树 diff。**任何写操作后必须失效**，提交、切分支等动作前的安全检查不得读陈旧缓存。
- `safeRefName` 注入白名单**不放宽**；git 合法但白名单外的分支名由 `gitBranchList` 标 `switchable:false`，picker 列出但禁用该行并给 hint（`branch.unsupportedName`），切换/创建被拒绝时的文案说明是名字含不可安全传递的字符。
- Windows 上 git 子进程超时/输出超量必须 `taskkill /PID /T /F` 杀整棵进程树（hooks/ssh 不残留），POSIX 保持 `child.kill()`；taskkill 缺失、spawn 失败或**非零退出**（如拒绝访问）时回退 `child.kill()`，git 直接子进程不得存活持锁；实机 Windows 验证仍缺。
- 首载不留空窗：harness 异步写 `workspace.json` 完成后，主进程 watcher（`git-workspace-watch.js`，watch `storages/` 目录、防抖、目录缺失重试；武装成功时若注册文件已存在则补发一次信号，覆盖「目录创建 + 首次登记都落在重试间隙」的漏窗）推送 `shell:git-workspaces-changed`，标题栏订阅后立即重读状态，不依赖窗口重新聚焦兜底。
- 已知权衡（信任粒度）：通过过滤的登记根对 Git/FS/PTY 全量生效，不做逐操作确认；边界是「登记只来自用户主动打开的工作区」加上盘符根与高危祖先过滤。
- `gitPush`（含 skip）在 `refs/remotes/<primary>/HEAD` 缺失或悬空时补上：先 `git remote set-head <primary> --auto`，失败则指向刚推的分支。这样首发非 `main`/`master` 的仓 `isDefaultRef` 为真，Commit & push 而不是误走 Commit, push & PR。不把 push 失败画成 set-head 失败。
- Git 可执行解析不止看 PATH：父进程（Explorer/终端）持旧 PATH 快照时，已安装的 Git 对子进程不可见。`runGit` 在 ENOENT 后探测 `%ProgramFiles%\Git\cmd\git.exe`、`%ProgramFiles(x86)%`、`%LOCALAPPDATA%\Programs\Git\cmd\git.exe` 命中即缓存复用；两处均缺时错误文案携带安装指引（`winget install Git.Git` / git-scm 链接），不再是死胡同。探测缓存提供 `resetGitExecutableProbe` 测试接缝，避免污染 spawn 计数断言。（2026-10-03，`git.test.js` 103/103 中本机 1 个 symlink fixture 环境失败与 CI 相同类）
- 官方 `dsh web` 标题栏 Git 视觉；不另做皮肤。
- 普通会话标题行的「更多操作」菜单始终提供「下载会话日志」；反馈插件可用时同时提供「反馈」，打开现有反馈表单，不自动提交。该菜单紧随子智能体、智能体团队和模式标签；managed composer 会话保持原有隐藏规则。
- 不再提供外部重复的 Session 日志下载胶囊及其界面设置开关；旧 `titlebarAction` 配置不改变显示。会话「更多操作」菜单和 `/export` 继续共用同一个控制器与结果对话框。
- 会话标题、Agent 项、更多菜单与目录入口保持单排；对话 / 轨迹页签保留在标题下方。目录与 Git 胶囊统一 27px 高、14px 圆角及 l2 细描边；桌面窄窗口优先压缩标题与标签，Git 分支、主操作与菜单保持可见。
- 标题行按实际可用宽度压缩标题与 Agent 标签，保留各操作入口；右栏文件等页签位于应用顶栏下方的面板内部，不与 Git 争用空间。

## Allowed touch

- `src/main/git.js`、`git-*.js` 与其单测
- `src/main/workspace-rpc.js`（启动工作区 unary 登记；Git 标题栏依赖会话 cwd）
- `src/main/workspace-authority.js`（Git cwd 授权）
- Preload / `ipc.js` 的 `shell:git-*`
- 本卡与 handbook `modules/git-titlebar.md`
- vendor `ui-git` 的标题栏可见性及定向测试（仅针对状态不可用时隐藏整组）
- 会话标题栏胶囊的局部修复：vendor `ui-open-in-app` 的目录控件与 `session-log-export` 的标题栏按钮（含默认可见性与界面设置开关）；文档预览文件控件不随之改尺寸
- 会话 header 拥挤兜底：ui-conversation `ConversationSession.tsx` 的单排布局与标题 / 标签压缩及其 `ConversationRoot.module.css` 样式、`skeleton.client.spec.tsx` 定向测试；release-ui-walk 的 titlebar/interface 步

## Do not touch

- vendor `ui-git` 文案/菜单默认不动；本次用户明确要求仅改变状态不可用时的整组可见性
- 官方 `~/.dsh`
- Appearance 图源、底栏终端契约（除非一并 Touching）

## Gates

| Kind | What |
| --- | --- |
| Automated | `src/main/git.test.js`（含登记兄弟仓 `gitBranchList` 全链路）；`workspace-rpc.test.js`（启动工作区 unary 路径/信封）；`workspace-authority.test.js`；`git-workspace-watch.test.js`；`ipc.test.js` 的 git guard/watcher 接线；`qa:packaged` 可验证 unpacked 应用的兄弟仓 `gitBranchList` |
| Automated UI | `vendor/deepseek-harness/packages/client/ui-git/tests/git-actions.client.spec.tsx`：无 cwd、状态 `null`/拒绝、登记恢复、非仓库初始化及有效仓库菜单 |
| Manual / QA | Git 菜单、工作区或随包 Git 行为改变时，参考 `TC-WS-006`、`TC-GIT-001`…`007`，观察登记兄弟仓及相关真实操作；随包行为使用对应打包或安装版本 |

## Sources

- Decision: [Git 标题栏一次 refresh 共用一份读取上下文](../decisions/proposed/architecture/2026-09-22-git-refresh-read-context.md)
- Decision: [Git 状态不可用时隐藏标题栏操作组](../decisions/implemented/bug-fix/2026-09-23-hide-unavailable-git-titlebar.md)
- Decision: [会话日志默认收起 + 次级 Agent 操作溢出按钮](../decisions/implemented/bug-fix/2026-09-28-titlebar-crowding-opt-in-and-overflow.md)

- Handbook：[../handbook/modules/git-titlebar.md](../handbook/modules/git-titlebar.md)
- Spec：[../superpowers/specs/2026-08-18-t3-git-tool-verbatim-leftovers-design.md](../superpowers/specs/2026-08-18-t3-git-tool-verbatim-leftovers-design.md)
