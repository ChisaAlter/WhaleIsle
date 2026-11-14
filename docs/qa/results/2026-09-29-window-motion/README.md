# Windows 窗口动画回归验证

关联：[window-motion](../../../features/window-motion.md)、[决策](../../../decisions/implemented/bug-fix/2026-09-29-native-window-motion.md)。本机 Windows / Electron 43.4.0，系统最小化动画开关读取为 1；未修改系统设置。

## 自动验证

- 修复前 `node scripts/run-window-motion-qa.mjs` 失败：主窗口 `caption:false, thickFrame:false`，`WS_THICKFRAME required for native window transitions`。旧实现的最大化状态往返检查单独运行仍可通过，不能用它证明动画正常。
- 修复后两个生产工厂均为 `caption:true, thickFrame:true, layered:false`。真实 preload → 授权 IPC 最大化/还原、最小化/恢复均通过，正常尺寸保留；页面收到 `nativeFrame:true`，外层 CSS 半径为 0。
- 定向 `chrome-theme`、`window-marketplace`、`window-harness-cover`、`harness-chrome-inject`、`shell-silhouette-radius`：54/54 通过。
- `npm test`：2818 项，2815 通过，2 跳过，1 失败。失败是 `src/main/remote.test.js:846` 对手机页面断言旧文案“等待配对”，当前已有修改为“等待连接”；本任务未修改该页面或断言。
- `npm run check:governance`：6/6；`npm run doc-sync`：7/7。CI 已加入 Windows 原生窗控门禁。

## 可见过渡

`record.cjs` 使用生产窗口创建函数、独立临时 profile 和本地 boot/launcher 页面，不启动 Harness 服务；因此 fixture 上可能显示缺少状态服务的恢复文案，该录制只认证原生窗口过渡。紫色是 QA 背景窗，用于看清系统合成过程中窗口尺寸和位置的变化，不是产品皮肤。`capture.ps1` 发 Win32 `ShowWindowAsync` 并采样桌面，时间标记为实际采样时间；各图均含起始、中间及结束帧。

| 窗口 | 最大化 | 还原 | 最小化 | 从最小化恢复 |
| --- | --- | --- | --- | --- |
| 主窗口 / boot | [逐帧图](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-window-motion/main-maximize.png) | [逐帧图](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-window-motion/main-unmaximize.png) | [逐帧图](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-window-motion/main-minimize.png) | [逐帧图](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-window-motion/main-restore.png) |
| 启动器 | [逐帧图](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-window-motion/launcher-maximize.png) | [逐帧图](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-window-motion/launcher-unmaximize.png) | [逐帧图](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-window-motion/launcher-minimize.png) | [逐帧图](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-window-motion/launcher-restore.png) |

八条路径均观察到系统缩放/位移中间帧。IPC 自动检查和可见 Win32 过渡验证互补，不把单纯状态通过等同于动画播放。

## 真实应用重启

源码 prestart 首次构建在凭据记录阶段缺少 `apps/cli/lib/bin.js`；单独构建该 CLI 产物后重新运行 prestart，官方构建记录 374 项产物并输出 ready。已停止本仓库旧应用/守护进程并从源码重启，Harness 成功加载。通过真实 Harness 的 `window.shell` 执行最大化与还原，分别读到原生 `maximized:true/false`；`nativeFrame:true`、body 和 AppFrame 外缘半径 `0px`、自绘缘线 `display:none`，深色渐变背景铺满客户区，见 [Harness 截图](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-window-motion/harness.png)。未发送模型请求、改会话内容或改用户偏好。

未在本轮认证：多显示器/DPI 切换、系统关闭动画、完整明暗壁纸排列组合；这些继续列在 `TC-WS-008` 发布验收中。非 Windows 保留已有实现，本轮未做该平台实机验收。
