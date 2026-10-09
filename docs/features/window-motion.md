# Feature: 20px 项目圆角与 Windows 原生窗口动画

| Field | Value |
| --- | --- |
| **id** | `window-motion` |
| **status** | `active` |
| **last verified** | 2026-09-29 — 44 定向通过；全量 2823 通过/2 跳过。真实工厂四角桌面像素（激活/失焦/resize/还原）、DWM 非客户区关闭、Win32 IsZoomed 与实际 IPC 通过；1px 物理描边与 alpha AA；100%/125%/150%/200% Electron 缩放检查通过。slim 打包/ASAR 原生桥通过；真实多屏和系统动画关闭矩阵未重跑 |

## User paths

1. 主窗口（启动画布和 Harness）与启动器点击最大化、还原、最小化，任务栏恢复，均使用 Windows 原生窗口行为。
2. 系统关闭动画时尊重系统设置；恢复后尺寸、窗控图标和页面边缘同步。

## Invariants

- 主窗口与启动器保持 `transparent: true`、`roundedCorners: false`，20px 页面圆角、round 角形和缘线不变；最大化收为 0。不得为了修动画改为系统小圆角或不透明背板。
- Windows 在显示前经 `native-window-motion` 补回 `WS_CAPTION` / `WS_THICKFRAME`，系统负责动画。原生桥只改指定 HWND 的样式并刷新非客户区，不改位置/尺寸/焦点/Z 序，不改系统偏好。
- DWM 非客户区绘制必须关闭，透明角外不能有系统矩形描边、填充或阴影；保留 caption/thick-frame 和过渡策略。Harness/启动器缘线宽为一个物理像素，按 DPR 换算，保留 alpha 抗锯齿。交互桌面检查四角，在激活、失焦、resize、还原后均必须通过。
- 原生桥监听 `WM_DWMNCRENDERINGCHANGED`；系统通知非客户区绘制重新开启时，在该原生操作提交后关闭该层，不能只在创建窗口时设置一次或在通知内重入原生操作。关闭中的页面也保留透明窗口底色与 20px 剪影，最大化时圆角为 0。
- 最大化/还原必须经 `ShowWindowAsync(SW_MAXIMIZE / SW_RESTORE)`，状态以 Windows `IsZoomed` 为准；Electron `isMaximized()` 可能只是工作区几何判定，不得仅以 `setBounds()` 或几何覆盖充当 Windows 壳窗最大化。
- 桌宠及透明覆盖层保留自己的窗口类型；非 Windows 保留现有剪影路径。不得改系统动画偏好。
- 改动实际影响窗口行为时，使用下面相关检查并观察动画；无关上游同步不自动触发窗口全套验证。

## Allowed touch

- `src/main/native-window-motion.js` 及对应测试；`package.json`、`package-lock.json`、`electron-builder.launcher.yml`、`src/main/package-contract.test.js` — 窄 Win32 桥与生产打包闭包。
- `src/main/window.js`、`src/main/chrome.js`、`src/main/harness-chrome-inject.js` 及对应窗口测试。
- `src/renderer/boot.css`、`src/renderer/launcher.css`、`src/renderer/window-controls.js` — 原生外缘适配。
- `scripts/` — 独立 Electron 窗控回归；`.github/workflows/test.yml` — Windows 门禁。
- `AGENTS.md`、`docs/`、`.cursor/rules/` — 设计、手册、决策、QA 和同步维护约束。

## Do not touch

- 桌宠透明窗口、系统动画设置、DSH 内部布局、会话和用户数据。

## Gates

| Kind | What |
| --- | --- |
| Automated | `node --test src/main/native-window-motion.test.js src/main/chrome-theme.test.js src/main/window-marketplace.test.js src/main/shell-silhouette-radius.test.js src/main/package-contract.test.js`；Windows：`node scripts/run-window-motion-qa.mjs`（含 DWM 非客户区状态）；交互桌面：`node scripts/run-window-motion-qa.mjs --composed`（四角合成像素）；`npm test` |
| Manual / QA | 主窗口与启动器最大化/还原、最小化/任务栏恢复；浅深色、壁纸、系统动画开关；见 [QA](../qa/production-acceptance-test-cases.md) |

## Sources

- Decision: [圆角与动画同时保留](../decisions/implemented/bug-fix/2026-09-29-rounded-window-motion.md)
- Design: [设计语言](../design-language.md)
- Handbook: [窗口与 Chrome](../handbook/modules/window-chrome.md)
- QA: [2026-09-29 纠正验证](../qa/results/2026-09-29-corner-motion/README.md)
- Implementation entry: `src/main/window.js`、`src/main/chrome.js`
