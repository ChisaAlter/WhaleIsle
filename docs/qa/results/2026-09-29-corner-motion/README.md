# 20px 圆角与原生动画组合验收 — 2026-09-29

本记录已按用户第二次截图纠正：此前仅验证页面 alpha 和局部角部，漏掉 DWM 矩形非客户区，原先的“修复完成”结论不成立。当前实现是透明 Electron 窗口 + caption/thick-frame 样式 + 禁用 DWM 非客户区绘制，保留 20px 剪影；缘线收细为一个物理像素并保留浏览器 alpha 抗锯齿。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 定向窗口测试 | 本次 44/44 通过（原生桥、注入、工厂、圆角和打包契约） |
| `npm test` | 2825 项：2823 通过、0 失败、2 跳过 |
| `node scripts/run-window-motion-qa.mjs` | 两个生产工厂均通过：20px computed radius、角外 alpha=0、角内实色、真实预加载/授权 IPC、最大化/还原/最小化/恢复、正常尺寸还原、Windows IsZoomed 在最大化时为 true，转换前后 HWND 样式保持、非客户区绘制关闭；描边一个物理像素、AA 至少 8 档覆盖值 |
| `node scripts/run-window-motion-qa.mjs --composed` | 主窗口与启动器均通过激活、失焦、resize、还原的四角桌面像素检查；每次还验证四角内部有实际页面，防止隐藏窗口假通过。证据在 `composed/` 的 PNG/JSON |
| 缩放 | 本机 150%，并以 `--force-device-scale-factor=1` / `1.25` / `2` 验证 100%/125%/200%；两工厂描边、alpha 与原生窗控均通过 |
| 主窗口 + 启动器逐帧录制 | 最终 8 组截图由真实 preload/授权 IPC 触发最大化、还原、最小化；恢复走任务栏等价路径。早期直接调用 ShowWindow 的录制不足以认证按钮路径，已替换 |
| `npm run pack:launcher` | 成功生成 `dist-launcher/win-unpacked` |
| `packaged-probe.cjs` | Koffi 与 win32 平台模块均从生成的 ASAR 解析，原生桥成功作用于真实窗口，未回退到源码依赖 |
| 重启后的实际 Harness | 150% DPI、现有深色主题；20px + 缘线 → 最大化 0px/隐藏缘线 → 还原 20px + 缘线。见 [状态](harness-check.json)、[页面角部](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-corner-motion/harness-corner.png)、[桌面完整外框](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-corner-motion/harness-desktop-final.png)、[四角](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-corner-motion/harness-four-corners-final.png) |
| 治理与文档 | `check:governance` 6/6、`doc-sync` 7/7 通过；命令结果摘录见 [validation.txt](validation.txt) |

独立工厂夹具不启动 Harness，启动页可能显示缺失状态处理器的错误文案，日志也会报告未注册的非窗控 IPC；这里只验窗口外观和窗控，不能据此认证完整产品启动流。临时 profile 与洋红色背景仅用于验收，不修改用户配置。系统动画偏好未修改。

## 逐帧证据

| 窗口 | 最大化 | 还原 | 最小化 | 从最小化恢复 |
| --- | --- | --- | --- | --- |
| 主窗口 / boot | [截图](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-corner-motion/main-maximize.png) | [截图](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-corner-motion/main-unmaximize.png) | [截图](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-corner-motion/main-minimize.png) | [截图](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-corner-motion/main-restore.png) |
| 启动器 | [截图](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-corner-motion/launcher-maximize.png) | [截图](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-corner-motion/launcher-unmaximize.png) | [截图](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-corner-motion/launcher-minimize.png) | [截图](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-corner-motion/launcher-restore.png) |

`production-record.cjs` 使用真实工厂、本地页面和 `capture.ps1`。每组 24 帧，按显示器工作区截图并标注经过时间；捕获本身耗时约 60ms，图中可见约 100–230ms 的中间尺寸。捕获脚本通过 ready 文件通知 Node，然后调用实际 preload/授权 IPC；恢复由 BrowserWindow.restore 触发。

从仓库根使用 Node `spawn(require('electron'), [script], { env, stdio: 'inherit', windowsHide: true })`，其中 `env` 必须删除 `ELECTRON_RUN_AS_NODE`，`script` 为本目录录制或打包探针文件。录制前确保没有其他窗口遮挡；不能把有遮挡的图作为验收结果。

## 方案探针与边界

红绿证据：`native-border-baseline.png/json` 为旧桥的失败结果，圆角外不是背景色；`native-border-border-none.png/json` 说明仅改边框颜色无效；`native-border-nc-disabled.png/json` 的 20 个角外采样均等于背景。Windows 非客户区断言与 `IsZoomed` 断言也分别在旧实现失败，修正后通过。`aa-baseline.png` / `aa-thin.png` / `aa-single.png` 是当前 150% 下的临时描边/裁切对照；采用物理像素描边，不采用额外 clip-path。

`harness-desktop-corner.png` 是前次漏验用的局部裁图，不能作为当前完整外观证据；当前依据是最终完整外框与四角截图。测试桌面不得被其他交互窗口遮挡，也不应与高负载构建/全量测试并行采像：一次高负载捕获出现黑区并被门禁拒绝，独立重跑后四场景均通过。

`probe.cjs`、`style.ps1` 与 `alpha-styles-*.png` 是透明纯色窗口补原生样式的可行性探针。`region-*.png` 是未采用的 setShape 方案，出现白边；两组均不冒充生产页面证据。前次不透明方案 QA 只保留历史意义，不能作为当前外观验收依据。

自动状态检查不能证明屏幕上播放了动画，CSS 数值也不能证明角外透明，所以三者分别检查。本机系统为 150% DPI，并通过 Electron 强制 100%/125%/200% 缩放复验描边、alpha AA 与原生状态；这不代替真实多显示器/DPI 切换和系统动画关闭的完整矩阵；完整桌面安装包未重新发布，本次包内验证使用 slim 启动器与双方共享的解包契约。
