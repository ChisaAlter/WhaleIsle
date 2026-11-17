# Feature: 关闭窗口行为（托盘驻留 vs 直接退出）

| Field | Value |
| --- | --- |
| **id** | `close-behavior` |
| **status** | `active` |
| **last verified** | 2026-09-27 |

历史验证与变更记录见 [docs/history/close-behavior.md](../history/close-behavior.md)。

## User paths

1. `closeToTray`（默认开）决定标题栏「关闭」是收进系统托盘还是退出应用；桌面端「设置 → 通用 → 关闭窗口时」与启动器设置「关闭时最小化到托盘」读写同一字段。
2. `closeToTray` 为开时点关闭即隐藏窗口；**仅首次**附一条系统 toast（说明窗口去了托盘、可在「设置 → 通用 → 关闭窗口时」改），写 userData marker 后不再出现——关窗路径无任何弹窗。
3. 退出无论来自设置、菜单还是托盘，都经任务保护协调：仅存在运行中/定时任务时才要求确认，空闲时静默退出。

## Invariants

- toast 只出现一次：marker `userData/tray-hide-acknowledged` 存在即跳过；通知发送失败不阻塞隐藏、不影响 marker。
- 关窗路径**永不弹模态或按钮式提示**——确认类交互只存在于退出分支的任务保护（有真实工作时才弹）。
- `closeToTray:false` 时关窗 = `quitApp()`（任务保护后退出），绝不藏窗；slim 启动器关窗驻留走自己的 `bindLauncherClose` + `trayHintShown` 通知，不经 `TrayHideNotice`。

## Allowed touch

- `src/main/background-notice.js` — 首次隐藏 toast 状态机
- `src/main/close-behavior.js` — `hideOnClose` 判定
- `src/main/index.js` — 仅 `bindMainClose` / `trayHideNotice` 段
- `vendor/deepseek-harness/packages/client/ui-settings-general` `CloseBehaviorRow` — 桌面设置行
- `src/renderer/launcher.html` / `launcher.js` `opt-tray` 开关、`src/main-launcher/index.js` slim 关窗驻留

## Do not touch

- 托盘菜单本体（`tray.js` / `tray-menu.js`，归 desktop-launcher 卡）
- 任务保护协调器内部（归 task-protection 相关实现）
- 在关窗路径加回任何模态/按钮式提示（「知道了」教学框、行为选择弹窗均已否定）

## Gates

| Kind | What |
| --- | --- |
| Automated | `node --test src/main/background-notice.test.js src/main/close-behavior.test.js` |
| Manual / QA | `TC-DESK-002`（托盘含「打开启动器」）in [production-acceptance-test-cases.md](../qa/production-acceptance-test-cases.md) |

## Sources

- Decision: [2026-09-27-tray-close-once-toast](../decisions/implemented/product/2026-09-27-tray-close-once-toast.md)
- Decision: [2026-09-26-upstream-desktop-bridges](../decisions/implemented/architecture/2026-09-26-upstream-desktop-bridges.md)（`TrayHideNotice` 移植来源）
- Handbook: [tray-update](../handbook/modules/tray-update.md)
- Implementation entry: `src/main/background-notice.js`、`src/main/index.js` `bindMainClose`
