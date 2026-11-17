# Feature: Task protection（退出/更新任务保护）

| Field | Value |
| --- | --- |
| **id** | `task-protection` |
| **status** | `active` |
| **last verified (job registration)** | 2026-10-02 |
| **last verified (paint deadline)** | 2026-10-01 |
| **last verified (audit update)** | 2026-09-30 |
| **last verified (installer failure)** | 2026-09-29 |
| **last verified (plugin links)** | 2026-09-29 |
| **last verified (quit)** | 2026-09-29 |
| **last verified** | 2026-09-27(续2) |
| **last verified** | 2026-09-28 |

历史验证与变更记录见 [docs/history/task-protection.md](../history/task-protection.md)。

后台长连接卡住更新、关闭和开关重启的事故见 [Postmortem 0002](../postmortem/0002-background-connections-block-drain.md)。

## User paths

1. 显式退出（主窗配置为退出、托盘、菜单、IPC、最后 Launcher 关闭）直接进入关闭流程，不再弹工作清单或「退出未完成」确认；关闭到托盘按用户设置。正常退出保留 inspect→acquire→drain→复查，检查或关停失败则记录诊断并自动清理退出。菜单/托盘的重启、重载遇到活动任务仍确认，取消无副作用；设置里的内置插件开关（Project / 鲸鱼娘 / 远程工作区）和插件启用/禁用引起的重启是 `preConfirmed`，不弹确认。在途请求会在加锁后的 drain 中自然结束，不单独触发确认。
2. 更新 / 重装前锁定任务接纳，排空已接纳请求（最多 10 秒），复查后放行安装器 / 差量写入；锁中 Schedule 与外部 hook 的到期/触发保留状态不丢。安装/更新入口（更新询问、版本卡、「在线安装」、增量更新、runtime 安装、peer prepare-install）本身即用户显式同意，`preConfirmed` 下不再弹第二道确认。更新、peer 停止/安装与启动器「停止桌面」带 `force`：排空超时、Host 不可达等接纳失败只记录诊断（待完成项与标签），照常提交，不因运行中的工作取消。
3. Launcher 侧的「停止桌面」与运行时装对**外部桌面**先走同义握手；旧桌面、忙碌或无响应的 peer 先正常关闭（WM_CLOSE），等待后仍在运行才 `taskkill /F /T` 结束进程树。只有用户自己取消才会停止安装。launcher 发起的停止带 `preConfirmed`——点击即同意，inspect→acquire→commit 照跑但两道确认门整体跳过，永远零弹窗。

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
- `preConfirmed` 用于显式同意的入口（统一 quit、peer `stop-desktop`、launcher `stopOp`、全部 install/update 链、peer `prepare-install`）：inspect、Host 接纳锁与 drain 照常。quit 不再弹工作清单及故障恢复确认；正常流程等待上限 30 秒，失败后附加清理最多等待 5 秒再结束桌面进程。后台清理完成后，最终 Electron 窗口关闭另有 5 秒期限；被 close / beforeunload 拦截或未响应时自动结束进程。退出请求持续合并到实际退出，重复点击不重启清理或重置期限。Windows 组件树的同步 taskkill 单次另有 5 秒系统调用时限，期间 JavaScript 定时器会等待主线程恢复。restart/reload 确认不变。

## Allowed touch

- 2026-10-01 用户全面修复授权下的安装版退出本地修复：`src/main/closing-overlay.js` 与对应测试 — 只限制遮罩绘制等待，不改变主题、任务检查、接纳锁、排空和 Harness 正常关停合同。

- 本次启动链接修复（2026-09-29 用户确认）：`src/main/desktop-plugin-link.js` 与共用测试、`task-control-overlay.js`、`platform-session-overlay.js`、`usage-panel-preset.js`、`dsh-im-desktop.js`、`dsh-whale-desktop.js`、`dsh-remote-desktop.js` 的链接处理；本卡、配套决策与 QA 证据。

- `src/main/task-protection*.js`（新，协调器 + 与入口接线）
- `src/main/index.js` / `launcher-service.js` / `update.js` / `update-updater.js` / `runtime-install.js` / `ipc-delta.js` / `delta/install.js` / `ipc-components.js` / `main-launcher/index.js`（只加协调器调用 + 挪副作用时机）
- `vendor/dsh-task-control/`（新，Host 侧插件）+ `src/main/task-control-overlay.js`（ensure overlay/junction）
- `src/main/dsh.js` / `harness-controller.js`（内部令牌经 host stdin 密钥通道下发、overlay 挂载顺序）

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
