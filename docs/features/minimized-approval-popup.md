# Feature: 最小化审批弹窗与应用图标角标

| Field | Value |
| --- | --- |
| **id** | `minimized-approval-popup` |
| **status** | `active` |

## User paths

1. 主窗口可见且未最小化时收到待审批项（工具越权审批 `approval/request`、CUA 权限审批 `intent.kind === 'approval'`、计划审阅 `intent.kind === 'plan-review'`）：不弹出右下角浮窗，也不显示应用图标数字角标。
2. 主窗口最小化或按 `closeToTray` 隐藏至托盘且 Harness 处于活跃态、存在待审批项时：立即更新应用图标数字角标（Windows 任务栏覆盖图标、Windows 托盘叠加角标与 Tooltip、macOS Dock 角标与托盘 Tooltip）；若 `approvalPopupEnabled` 为开且存在未静默项，同时在主显示器 `workArea` 右下角以不抢焦点（`showInactive()`）方式弹出 380×300px 独立审批浮窗。
3. 用户可在浮窗内直接提交审批决策（允许一次、始终允许、拒绝、要求修改），查看命令预览、翻页浏览多条待审批队列，或点击「查看会话」唤醒主窗口并跳转到对应会话；点关闭钮或按 `Esc` 仅静默收起浮窗，不拒绝审批也不清除角标，后续新审批到达时自动重新唤醒。
4. 「设置 → 通用 → 最小化时弹出审批窗口」可关闭右下角浮窗，关闭后应用图标与托盘数字角标仍保持同步。

## Invariants

- 仅纳入真实审批请求（`approval/request` 及单题 `intent.kind` 为 `approval` / `plan-review` 的 `user-questions/request`）；普通 `ask_user_question`（含限时问询 `wait.timed`）静默忽略，绝不发送 `{ kind: 'next' }` 或占用等待通道。
- 提交结算成功后立即在本地移除对应审批项并刷新角标（Gateway 不向提交方回发 `cancel` 帧）；失败时恢复按钮状态并在固定浮层展示自动淡出 Toast，不挤动布局。
- 浮窗独立于主窗口（无 `parent`），主窗口最小化或隐藏到托盘不影响其显示；主窗口恢复可见时立即隐藏浮窗并清空静默集合；Harness 停止或待审批归零时立即隐藏浮窗并还原应用图标与托盘状态。
- 浮窗在可见状态下切换条目或补全命令预览时不重复调用 `setBounds`，避免 Windows 分层透明窗闪烁或裁切。
- 协议结算配方保存在 `wire.js` 私有映射中，不向状态机或渲染层泄漏 `wireAnswers`；初始视图快照携带 `theme` 与 `locale`，避免首帧闪烁。

## Responsible files

- `src/main/approval-monitor/index.js` — 模块门面与 IPC 注册
- `src/main/approval-monitor/state.js` — 纯函数队列、静默、可见性状态机与安全视图投影
- `src/main/approval-monitor/wire.js` — `/api/remote.mux` 订阅、命令预览补充与私有结算映射
- `src/main/approval-monitor/badge.js` — 零依赖 PNG/BGRA 角标栅格化与跨平台应用器
- `src/main/approval-monitor/popup.js` — 独立无父透明置顶 `BrowserWindow` 控制器
- `src/preload/approval-popup.js`、`src/renderer/approval-popup.{html,css,js}` — 沙箱预加载与浮窗渲染页
- `src/shared/dsh-webui-tokens.css`、`src/shared/ipc-contract.js`、`src/shared/harness-desktop-forks.js`
- `src/main/{window.js,session-jump.js,tray.js,config.js,profile-ops.js,app-shell-state.js,index.js,app-ready.js,app-events.js,app-lifecycle.js}`
- `vendor/deepseek-harness/packages/client/ui-workspace/src/client/index.ts` — `shell:open-session` 跳转订阅
- `vendor/deepseek-harness/packages/client/ui-settings-general/src/client/ApprovalPopupRow.tsx` — 设置开关行

## Gates

| Kind | What |
| --- | --- |
| Automated | `node --test src/main/approval-monitor/state.test.js src/main/approval-monitor/wire.test.js src/main/approval-monitor/badge.test.js src/shared/ipc-contract.test.js src/shared/harness-desktop-forks.test.js` |
| Vendor client | `vitest run packages/client/ui-settings-general/tests/approval-popup-row.client.spec.tsx packages/client/ui-settings-general/tests/apply-desktop.client.spec.ts packages/client/ui-workspace/tests/apply.client.spec.ts` |
| Official build & checks | `pnpm run build:official`（`vendor/deepseek-harness`）、`npm run check:vendor`、`npm run typecheck`、`npm run docs:check` |

## Sources

- Visual contract: [design-language.md](../design-language.md)
- Motion contract: [motion.md](../motion.md)
- Handbook: [tray-update](../handbook/modules/tray-update.md)
