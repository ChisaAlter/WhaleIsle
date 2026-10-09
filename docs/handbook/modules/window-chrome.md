# 模块：窗口与 Chrome

## 职责与非目标

**职责：** 主窗口、boot↔harness 切换、标题栏注入、关闭遮罩、窗口控件，以及桌面宠物浮层（隐藏的 Codex `BrowserView` 宠物与启用的 Live2D 透明窗宠物）。
**非目标：** 不自绘整套窗口皮肤替代系统控件命中区。

## 用户路径

- 最大化 / 最小化 / 关闭走系统区；主题色跟随 token。
- 关闭可进托盘（见 [tray-update.md](tray-update.md)）。
- 标题栏桌面簇（Git 等）由注入 / 官方 slot 承接。
- 桌面宠物在 Harness ready 后出现：Live2D 形态整屏透明窗、悬停才交互；Codex 形态（feature 关闭）是主窗内 80–96px 小矩形视图。

## 架构要点

- 桌面主程序与独立启动器在 Chromium 初始化前设置 `force_high_performance_gpu`，多显卡设备优先使用独显进行 GPU 合成、栅格化和 WebGL 渲染；CSS/DOM 的布局与样式计算仍由 CPU 执行。没有独显时沿用 Electron 的可用渲染设备，实际选卡受系统与驱动影响；该偏好可能增加功耗，完整退出并重新启动后生效。
- 主窗口与启动器保持透明自绘 20px 圆角与缘线；Windows 在首次显示前经 `native-window-motion`（Koffi / N-API）补回 caption/thick-frame 样式，以 `ShowWindowAsync` 切换最大化/还原、`IsZoomed` 读取状态，保留 DWM 动画和原生最大化状态，不切换成系统小圆角。`roundedCorners:false` 禁止第二层 OS 圆角裁切；补样式后设置 `DWMWA_NCRENDERING_POLICY=DWMNCRP_DISABLED`，消除 DWM 在透明角外绘制的矩形表面。缘线使用 `--dsh-window-hairline=1/devicePixelRatio px`，保持一个物理像素，颜色沿用 border-l2。原生桥不碰桌宠；非 Windows 保持原路径。只有未启用原生窗控的透明窗使用几何最大化回退。详见 [window-motion](../../features/window-motion.md) 与[纠正决定](../../decisions/implemented/bug-fix/2026-09-29-rounded-window-motion.md)。注入自愈保持不变。
- `window.js` 管理 Harness BrowserView bounds 与覆盖；`desktop-pet.js` + `desktop-pets.js` 管理 Codex 宠物发现（`${CODEX_HOME:-~/.codex}/pets`、v1/v2 图集）、约 80–96px 宠物 BrowserView、右键换肤菜单、归一化位置和生命周期，feature 默认关闭。
- `desktop-live2d.js` 管理 Live2D 宠物：覆盖虚拟屏的透明 `alwaysOnTop` BrowserWindow，窗口本身永不 `setPosition`（分层透明窗移动会闪空）；默认 `setIgnoreMouseEvents` 穿透，主进程 ~30Hz 轮询 `screen.getCursorScreenPoint()` 推 `shell:live2d-cursor`，渲染器按角色 alpha bounds 决定交互。页面经特权 `pet://` scheme 加载，渲染进程内跑 onnxruntime-web（WebGPU→WASM 回落）。
- `harness-chrome-inject.js` / `chrome.js` 把桌面 chrome 接到官方页。
- `closing-overlay.js` 关闭过渡。
- `pet-growth.js` 的版本化 food 账本将投喂余额与当前日志存量分离；worker 返回按会话与 turn/step 摘要的用量桶，重复扫描、删除或恢复日志不重复发放。旧状态迁移保留等级与原有可用余额，新增消费立即可投喂。见[投喂账本决定](../../decisions/implemented/bug-fix/2026-10-02-pet-feed-ledger.md)。

## 实现入口

- `src/main/window.js`、`desktop-pet.js`、`desktop-pets.js`、`desktop-live2d.js`、`pet-growth.js`、`pet-stats.js`、`chrome.js`、`harness-chrome-inject.js`、`closing-overlay.js`
- `src/renderer/pet.*`（Codex 宠物页）、`pet-live2d.*`、`pet-physics.js`、`pet-dialogue.js`、`dialogue/`、`window-controls.css`

## 不变量

- Windows 任务栏品牌由窗口首次显示前的 Shell 属性声明：既有 AppUserModelID、应用 ICO、正确的重启入口与产品名；WM_GETICON 正确不能替代此项验证。原始 Electron 源码运行不初始化系统通知 presenter，以免自动生成同身份的 Electron 快捷方式；安装版系统通知保持可用，源码保留应用内提示。见 [任务栏身份修复](../../decisions/implemented/bug-fix/2026-10-01-windows-taskbar-identity.md)。
- 栏是 `AppFrame`，不是卡片网格。
- Surface Tab 关闭控件在标题**右侧**。
- 两种宠物形态不得同时可见；宠物 preload/IPC 面收窄，不暴露 Harness workspace/Git/文件/远程/插件权限。

## 门槛

- Windows：`node scripts/run-window-motion-qa.mjs` 检查真实工厂 HWND 样式和 IPC；交互桌面另运行 `--composed` 检查完整四角、失焦、resize、还原后的合成像素；可见动画另作逐帧验收。

- QA：`TC-WS-002` … `TC-WS-004`；`TC-SURF-007`；`TC-DESK-010`（Codex 宠物）、`TC-DESK-011`（Live2D 宠物）

## 延伸阅读

- [design-language.md](../../design-language.md)；卡片：[desktop-pet](../../features/desktop-pet.md)、[desktop-live2d-pet](../../features/desktop-live2d-pet.md)
