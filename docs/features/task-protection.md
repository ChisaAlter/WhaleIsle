# Feature: Task protection（退出/更新任务保护）

| Field | Value |
| --- | --- |
| **id** | `task-protection` |
| **status** | `active` |
| **last verified (job registration)** | 2026-10-02 — 固定安装候选 36912364842 的真实模型命令轮出现 `unknown job [object Promise]`。任务准入包装器错误改变 `JobRegistry.start` 的同步合同；旧实现三条行为回归均失败，修复后插件定向 16/16 通过。当前源码隔离 CLI Host 挂载同一任务保护 overlay，真实 pwsh 执行 `Write-Output` 返回字符串 `pwsh-1`，输出匹配，观察 running → completed / exit code 0，无 Promise JobId 错误；未使用桌面输入。llm-replay 导入有警告，该 CLI 结果只认证 registry/pwsh 路径；随后源码隔离桌面在 Node24.21.0 下完成四轮真实 MiniMax 会话，模型经桌面调用 pwsh，工具输出和最终回答均为 `workspace`，持久会话记录 4/4 正常结束，见 `.tmp/release/source-model-ui-result.json`。仍不认证新安装候选，不继承旧包验收；原失败见 [候选证据](../qa/releases/v0.3.3/36912364842-evidence.json#realModel)。 |
| **last verified (paint deadline)** | 2026-10-01 — 原 CI 36804159162 实际退出长时间卡在隐藏 boot 页双帧等待，记 Fail；修复定向 43/43，其中遮罩 9/9。隔离真实 Electron 隐藏页中旧 helper 超过 700ms 未完成，新 helper 511ms 返回并正常退出、无强杀或未处理拒绝。新 CI 安装版未验收，见 [执行记录](../qa/results/2026-10-01-release-candidate/README.md)。 |
| **last verified (audit update)** | 2026-09-30 — 差量与整包共享 spawn commit；失败后二次准入、附属清理保留、显式下载取消令牌、macOS 手动安装回归通过，未做真实 NSIS/DMG 安装。 |
| **last verified (installer failure)** | 2026-09-29 — 实际 update 整包调用链 + 真实协调器 + 消失安装器回归验证：spawn ENOENT 拒绝、Host release 执行、committed 保持 false；取消在安装前异步准入后仍阻止 spawn。见 [QA](../qa/results/2026-09-29-installation-recovery/README.md)，未做 CI Setup 实机安装。 |
| **last verified (plugin links)** | 2026-09-29 — 内置插件复用有效链接、保留读取错误，EEXIST 只接受复查为正确目标的链接；未知目录不删除。定向 95/95、真实 Electron 200 次准备（199 次复用）、隔离源码启动/PTY/标题栏通过。安装版未更新，原现场触发条件未完整复现。 |
| **last verified (quit)** | 2026-09-29 — 本地连接误报修复，统一 quit 预确认；32 项定向回归及隔离源码冒烟通过，含真实 TCP socket、生产退出接线与 drain 失败无副作用。旧进程确认框待用户取消后正常重启；未打包。 |
| **last verified** | 2026-09-27(续2) — `preConfirmed` 扩到全部 install/update 链（`update.js` 整包、`update-updater.js` electron-updater、peer `prepare-install` 的 `install`）：安装/更新入口本身即显式同意，链内任务保护不再二次确认；quit/restart/reload 三入口保留确认门。新增 `launcher-confirm` 桥把主进程确认渲染进启动器 app-confirm 卡。launcher-confirm/update/task-protection/ipc/runtime-install/launcher-gate/window-marketplace 定向 175 例绿。决策见 [update-install-preconfirmed](../decisions/implemented/product/2026-09-27-update-install-preconfirmed.md)。前次：2026-09-27(续) — launcher 发起停止（peer `stop-desktop` + 自带启动器 `stopOp`）改 `preConfirmed`：用户点击即同意，两道确认门跳过，消除桌面窗口全隐藏时的原生 messagebox 回退；`confirmTaskStop` 锚点改首个可见窗。task-protection/ipc/runtime-install 定向 102 例绿。决策见 [launcher-stop-preconfirmed](../decisions/implemented/product/2026-09-27-launcher-stop-preconfirmed.md)。前次：2026-09-27 — 修复停止链三层缺陷（token 查询吞控制路径 405 / 升级 socket 终身占 pending 致 drain 超时 / schedule 未按 flag 报 unavailable）+ 启动器控件互斥；实机停止全链路通过（acquire 即刻、commit 执行、Host 子进程退出、启动器回落仅「启动桌面端」），drain-timeout 响应新增 `pendingLabels` 观测面。`src/main/task-protection*` + `task-control-plugin` 23 例、全量 2537 绿。决策见 [launcher-stop-controls](../decisions/implemented/bug-fix/2026-09-27-launcher-stop-controls.md)。前次：2026-09-25 — `node --test` 协调器/插件/契约相关 352 例全过；打包态与实机验收待 C 阶段复跑。 |
| **last verified** | 2026-09-28 — drain timer 保持到等待结束并在 finally 清理，独立 Node 进程回归通过；2026-09-28 — 二次确认窗按设计语言重写：`src/renderer/update-dialog.{html,css,js}` 由固定深色 + `#4d6bfe` 电光蓝改成基线 token（`--dsw-alias-*` / `--dsw-radius-panel` / `--dsw-elevation-prominent` / `--dsw-mask-blur`），`view.scheme` 随 payload 走 main → preload `onTheme` → renderer `data-ds-dark-theme`，`applyAppTheme` 的 `shell:theme` 广播把打开中的卡同步到最新主题。`confirmTaskStop` 按钮序改成 `[仍要X, 取消]`（同 `confirmUnverifiedColdStart` / `openDesktopUpdate`），defaultId/cancelId=1：主操作 index 0 = primary，取消 index 1 = secondary，Enter/Esc 都落取消，"仍要 X"必须显式点击。新增 `view.dangerIds` 通道：main 把"明知有风险的行动"按钮标 danger（`confirmTaskStop`/`confirmUnverifiedColdStart`/`finalizeQuit force`/`attachRendererRecovery` 中的"仍要X"/"强制退出"/"退出应用"），renderer 给非取消按钮 paint `.danger` 描边（`--dsw-alias-state-error-primary`），与 launcher app-confirm 卡 `danger` 字段同源。`launcher.css` 内嵌 `modal-mask`/`modal-card` 同批对齐——mask 改 `--dsw-alias-bg-mask-1` + `--dsw-mask-blur`，卡片去边框换 `radius-panel` + `elevation-prominent`，title 16/24、body 14/22、`padding 22/24`，actions 走 `gap: 8px` 行向。共享 token 表补 `--dsw-radius-xs..panel`、`border-l3/l4` 与 `elevation-stroke/panel/prominent/soft` 派生四件套。`update-dialog.test.js` + `shell-silhouette-radius.test.js` + `chrome-theme.test.js` + `themes.test.js` + `task-protection.test.js` + `close-behavior.test.js` + `launcher-theme.test.js` + `background-notice.test.js` 57/57 通过。 |

后台长连接卡住更新、关闭和开关重启的事故见 [Postmortem 0002](../postmortem/0002-background-connections-block-drain.md)。

## User paths

1. 显式退出（主窗配置为退出、托盘、菜单、IPC、最后 Launcher 关闭）直接进入关闭流程，不再弹工作清单或「退出未完成」确认；关闭到托盘按用户设置。正常退出保留 inspect→acquire→drain→复查，检查或关停失败则记录诊断并自动清理退出。菜单/托盘的重启、重载遇到活动任务仍确认，取消无副作用；设置里的内置插件开关（Project / 鲸鱼娘 / 远程工作区）和插件启用/禁用引起的重启是 `preConfirmed`，不弹确认。在途请求会在加锁后的 drain 中自然结束，不单独触发确认。
2. 更新 / 重装前锁定任务接纳，排空已接纳请求，复查无活动后放行安装器 / 差量写入；锁中 Schedule 与外部 hook 的到期/触发保留状态不丢。安装/更新入口（更新询问、版本卡、「在线安装」、增量更新、runtime 安装、peer prepare-install）本身即用户显式同意，`preConfirmed` 下不再弹第二道确认。
3. Launcher 侧的「停止桌面」与运行时装对**外部桌面**先走同义握手；旧桌面无握手时要求正常退出并确认进程结束，不回退直接 taskkill /F。launcher 发起的停止带 `preConfirmed`——点击即同意，inspect→acquire→commit 照跑但两道确认门整体跳过，永远零弹窗。

## Invariants

- `jobs.start` 的准入包装保留上游同步合同：立即返回原始 JobId，锁内同步拒绝；注册成功或同步抛错都释放本次准入。运行中的任务由 jobs inspection 独立计入，不把注册返回值包装成 Promise。

- 关闭遮罩绘制是尽力显示；主进程等待 CSS / 脚本 / 画帧最多 500ms 后继续既有正常关停。隐藏或无响应的 renderer 不得卡住已通过任务保护的退出；不以 app.exit / 强杀替换正常 cleanup / shutdown。

- 2026-09-30：差量下载和整包安装共用可观测 spawn commit；updater 只下载，不调用 quitAndInstall。安装失败后释放锁且下一次尝试重新 inspect/acquire；macOS 打开 DMG 不提交退出。
- 更新/安装终止操作的附属清理只在 commit 成功后执行；commit 失败保留运行中的组件服务及清理钩子，后续退出仍正常清理。显式 quit 已确定结束进程，Host 检查/关停失败也会执行清理钩子，各资源并发开始关停，单项失败不阻止其他清理。

- 整包更新把安装器 spawn 纳入协调器 commit；启动失败或 commit 前取消须释放 Host 接纳锁，不得提前锁定 committed 或退出当前界面。

- 插件链接准备只将 ENOENT 视为缺失；已解析到同一目录的链接复用，EEXIST 需重新验证目标。普通占位内容不得递归删除，不得跳过任务保护继续启动。

- 回环长连接（127/8、::1、IPv4-mapped IPv6）及已销毁 socket 不计远程连接；外部/未知来源保守保留。本地发起的 agent/job/在途请求仍独立检查。

- 被调用方等待的 drain 截止 timer 必须保持事件循环，完成后清除；没有其他活动句柄时也须返回排空或超时结果。
- 保护发生在第一个副作用之前：`quitting` 标志、`cleanupDesktopResources`、`harness.shutdown()`、`app.quit()`、`quitAndInstall`、拉起安装器、`taskkill` 都排在决策之后。
- 接纳锁按 `hostGeneration` + `owner` 计数；inspect→acquire→drain→inspect 完成前不得放行，drain 中不得把 pending 当空。drain 集合只含会结束的准入（HTTP/fallback 写/resolveAgent/jobs.start/connection 瀑布）——升级 socket 只做连接期准入（锁内新升级 503、存量不进 drain，socket 上交付的工作由服务 chokepoint 拦截）。中断无损的请求同样锁内 503、存量不进 drain：GET/HEAD/OPTIONS 读请求（包括 `GET /api/dsh-pad.stream` 这类窗口打开期间一直保持的 watch 流），以及 `/api/conversation.next-prompt` 的下一句建议（POST，单次最长约 30 秒模型时间）。
- `before-quit` 的 preventDefault 不拦截其他监听者（`ipc-components.js` 的 svc.shutdown、main-launcher tray.destroy）——附属清理由协调器 commit 钩子统一触发。
- Schedule 按声明开关取覆盖：flag 未设报 `intentional-disabled`，已设而服务缺失即 `unavailable`（fail closed）；加载失败/未知/超时一律阻止自动提交。Bots/dshbot 已移除，不再列为生产者覆盖项，保留的旧 catalog 不触发工作检查。
- 壳侧 PTY/preview/components 关停视为「受影响工作」计入确认面，但不算 Host 任务。
- `preConfirmed` 用于显式同意的入口（统一 quit、peer `stop-desktop`、launcher `stopOp`、全部 install/update 链、peer `prepare-install`）：inspect、Host 接纳锁与 drain 照常。quit 不再弹工作清单及故障恢复确认；正常流程等待上限 30 秒，失败后附加清理最多等待 5 秒再结束桌面进程。Windows 组件树的同步 taskkill 单次另有 5 秒系统调用时限，期间 JavaScript 定时器会等待主线程恢复。restart/reload 确认不变。

## Allowed touch

- 2026-10-01 用户全面修复授权下的安装版退出本地修复：`src/main/closing-overlay.js` 与对应测试 — 只限制遮罩绘制等待，不改变主题、任务检查、接纳锁、排空和 Harness 正常关停合同。

- 本次启动链接修复（2026-09-29 用户确认）：`src/main/desktop-plugin-link.js` 与共用测试、`task-control-overlay.js`、`platform-session-overlay.js`、`usage-panel-preset.js`、`dsh-im-desktop.js`、`dsh-whale-desktop.js`、`dsh-remote-desktop.js` 的链接处理；本卡、配套决策与 QA 证据。

- `src/main/task-protection*.js`（新，协调器 + 与入口接线）
- `src/main/index.js` / `launcher-service.js` / `update.js` / `update-updater.js` / `runtime-install.js` / `ipc-delta.js` / `delta/install.js` / `ipc-components.js` / `main-launcher/index.js`（只加协调器调用 + 挪副作用时机）
- `vendor/dsh-task-control/`（新，Host 侧插件）+ `src/main/task-control-overlay.js`（ensure overlay/junction）
- `src/main/dsh.js` / `harness-controller.js`（spawn env 注入 token、overlay 挂载顺序）

## Do not touch

- 不放开 `cordis.patch.yml` 用户面；不引入第二条插件装载通道。
- 不改 `desktop-install-control` 既有路由语义；协调器用同环回 + Bearer 模式新增端点。
- 不静默启用 schedule / 任何上游能力。
- 不把 `taskkill /F` 作为「无握手」回退——旧桌面走正常退出确认。

## Gates

| Kind | What |
| --- | --- |
| Automated | `src/main/task-protection*.test.js`、`src/launcher/launcher-confirm.test.js`、`vendor/dsh-task-control` 单测、相关定向回归 |
| Automated | `src/main/closing-overlay.test.js`：隐藏帧 / 无响应 CSS 或脚本等待有界，正常完成清 timer，renderer 失败继续正常关停 |
| Manual / QA | quit/安装/更新/启动器停止无工作清单二次确认；重启/重载活动任务确认；失败 drain 不提交 |

## Sources

- Decision: [关闭遮罩绘制等待有界](../decisions/implemented/bug-fix/2026-10-01-closing-overlay-paint-deadline.md)

- Decision: [项目审查修复](../decisions/implemented/bug-fix/2026-09-30-project-audit-fixes.md)

- Decision: [安装恢复边界](../decisions/implemented/bug-fix/2026-09-29-installation-recovery.md)

- Decision: [内置插件链接的幂等准备](../decisions/implemented/bug-fix/2026-09-29-desktop-plugin-links.md)

- Decision: [退出本地连接误报与确认移除](../decisions/implemented/bug-fix/2026-09-29-quit-transport-false-positive.md)

- Decision: [干净 CI 与 drain 生命周期修复](../decisions/implemented/bug-fix/2026-09-28-clean-ci-portability.md)
- Decision: [任务保护协调器与 Host 接纳锁](../decisions/implemented/architecture/2026-09-25-task-protection-coordinator.md)
- Decision: [启动器停止失效与控件互斥修复](../decisions/implemented/bug-fix/2026-09-27-launcher-stop-controls.md)
- Plan: `docs/superpowers/plans/2026-09-25-upstream-adoption-plan.md` §5–§6.4
- Upstream seam: `vendor/deepseek-harness/apps/desktop-host/src/update-tasks.ts`、`quit-inspection.ts`、`packages/client/connection/src/index.ts`
- Evidence: `docs/superpowers/evidence/2026-09-25-upstream-adoption/`（p0-baseline.md / producer-manifest.md / ledger.md）
