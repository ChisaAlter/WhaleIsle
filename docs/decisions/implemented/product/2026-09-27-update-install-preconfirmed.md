# Decision: 安装/更新链全面预确认 + 启动器窗内确认桥

Status: implemented

中文 | [English](2026-09-27-update-install-preconfirmed.en.md)

## Problem

全量清点确认弹窗后，系统性问题有两类：

1. **同一动作被确认两次（最坏三次）**：启动器版本页点「更新/切换」→ `app-confirm` 已确认 → 下载校验后 `coordinate('update')` 又弹「将中断仍在运行的工作」；slim 更新询问（原生框）→ 完整性确认（原生框）→ peer `prepare-install` 桌面侧确认（无窗退原生框）。冷启动更新询问、设置「检查更新」、「在线安装」按钮同理——进入安装链的每个入口本身即用户显式同意，链内任务保护确认是纯重复。
2. **原生 messagebox 残留**：slim 的更新询问与完整性确认、完整包 `confirmUnverifiedInstall`、quit drain 失败兜底框、渲染崩溃恢复框全走 `dialog.showMessageBox`——明明有可见窗口却弹系统框，与启动器 `app-confirm` 卡/壳层 overlay 观感割裂。

## Decision

1. **`preConfirmed` 扩到全部 install/update 链**：`update.js` 整包车道、`update-updater.js` electron-updater 车道、peer `onPeerInstall`（slim `prepare-install`）的 `coordinate('install')` 均传 `preConfirmed: true`。inspect→acquire→drain→commit 锁序不变，仅跳过确认门。quit/restart/reload 三入口保留确认（关窗/重启不是「刚点过的安装按钮」）。由此 install/update 路径的确认语义从「链内二次确认」变为「入口一次确认」：更新询问、版本卡 `app-confirm`、`installRuntime` 按钮、「在线安装」按钮、增量更新 `app-confirm` 各自承担本路径唯一确认。
2. **`launcher-confirm` 桥统一启动器归属确认**：新模块 `src/launcher/launcher-confirm.js`——主进程 `ask(payload)` 经 `shell:app-confirm` 事件发给启动器渲染层，渲染层复用既有 `app-confirm` 卡应答 `shell:app-confirm:response`（lane 模块经 `registerLauncherChannels` extraChannels 挂载，LAUNCHER_ONLY 授权）。`ask` 返回 `null`（无窗/渲染层销毁）时调用方才回退原生框——桥不可达绝不静默放行。接入方：完整包 `confirmUnverifiedInstall`（launcher-service `deps.askLauncherConfirm`）、slim `confirmUpdateAsk`/`confirmUnverified`。完整包与 slim 同桥同渲染卡。
3. **剩余原生框归一**：quit drain 失败兜底「退出未完成：重试/强制退出」与渲染崩溃恢复框改走 `confirmDialog`（首个可见窗锚定 → 壳层 overlay；无可见窗仍是原生兜底）。崩溃恢复经 `window.js` 新增 `setRecoveryConfirm` 注入（WebContentsView 的 harness 面映射回主窗）。

## Alternatives considered

- **确认路由回发起方窗内卡（peer 双程往返）**— rejected（同 launcher-stop-preconfirmed 的否决理由）：给「刚点过的按钮」再补一次确认是打扰本身。
- **安装链保留任务保护确认** — rejected：用户已把「显式动作 = 同意」立为产品规则；quit 保留确认因关窗动作不携带「杀任务」意图。
- **quit 兜底框直接强制退出不询问** — rejected：drain 失败意味着运行时状态未知，强制退出仍是值得一次明示的最后手段；改成壳层弹窗已消除观感问题。
- **崩溃恢复框复用 `confirmDialog` 但窗口隐藏时新开窗口** — rejected：为兜底框造窗口收益不抵复杂度；原生框在无窗时是可接受的最后手段。

## Consequences

- 版本页「更新/切换/增量」、冷启动与停放的更新询问、设置「检查更新」「在线安装」、slim 更新安装：一次点击 → 一次确认（或无确认），任务保护仍在后台排空+锁定。
- quit/restart/reload 在活动工作时仍确认一次；quit drain 失败仍出现兜底框（壳层化）。
- 启动器进程内所有主进程发起的确认共享 `app-confirm` 卡一种形态；原生框只剩「无可见窗」与初始化失败 `showErrorBox` 两类边缘场景。
- `launcher-stop-preconfirmed` 决策中「preConfirmed 不得扩散到 install/update 路径」的约束被本篇取代（全量清点发现安装链的双确认与停止链同源）。原点原位已注记。

> 2026-11-08 更新：渲染崩溃恢复框与初始化失败 `showErrorBox` 已取消，崩溃改为自动重载并在界面内显示失败页，致命错误只写日志与崩溃报告，见 [desktop-launcher](../../../features/desktop-launcher.md)。
