# 2026-08-25 · Windows 安装器品牌化（浅色对齐重制）· Linux/wine 预验证

**对象：** 分支 `cursor/windows-installer-branding-5f26` 第二轮位图——按设计语言把欢迎/完成侧栏从近黑营销面板重制为官方浅色表（启动器同源）：侧栏底 `rgb(249,250,251)`（`--dsw-specific-sidebar-fill` 镜像）+ 近黑鲸标与产品名 `Deepseek-Harness-Desktop`（`--dsw-alias-label-primary`）+ 细蓝强调线（`--dsw-static-deepseek-500`）+ 右缘发丝线；header 鲸标改 label 墨色；卸载侧栏为同一浅色构图的灰阶弱化版。
**方法：** Linux 云端无 Windows 实机。用与仓库相同的 `build.nsis` 块 + 新品牌资产搭 stub 工程，经仓库锁定的 electron-builder 26.15.3 完整跑 `--win nsis` 目标（makensis 原生编译 + wine32 生成卸载器），产出 `Deepseek-Harness-Desktop-Setup-0.0.1.exe` + blockmap；再在 wine + Xvfb 下打开 GUI 向导逐页截图（xdotool 驱动）。卸载器从 Setup 包内 `$R0/Uninstall Deepseek-Harness-Desktop.exe` 提取后单独打开截图。

## 结果

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| NSIS 脚本编译（installer.nsh 宏、新位图、许可、双语言） | Pass — makensis 无错误出包（100MB Setup + blockmap） | stub 构建日志 |
| 欢迎页：浅色侧栏 + 近黑鲸标 + 产品名 + 细蓝线 + 发丝线 | Pass — 不再是近黑面板/平行 wordmark | [wizard-welcome.png](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-25/installer-branding/wizard-welcome.png) |
| 许可页：MIT 原文 + 墨色鲸标 header + BrandingText `Deepseek-Harness-Desktop <version>` | Pass | [wizard-license.png](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-25/installer-branding/wizard-license.png) |
| 安装模式页：默认「仅为我安装」（per-user） | Pass | [wizard-install-mode.png](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-25/installer-branding/wizard-install-mode.png) |
| 目录页：默认 `%LOCALAPPDATA%\Programs\Deepseek-Harness-Desktop`、可改目录 | Pass | [wizard-directory.png](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-25/installer-branding/wizard-directory.png) |
| 卸载向导欢迎页：同一浅色构图的灰阶弱化侧栏 | Pass（位图级） — 从 Setup 内提取的卸载器单独打开验证 | [wizard-uninstall-welcome.png](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-25/installer-branding/wizard-uninstall-welcome.png) |
| 门禁单测（token 镜像 + `#0b0d12` / `--boot-*` 回归拒绝） | Pass — `node --test src/main/installer-branding.test.js` 8/8；`npm test` 1010 pass / 0 fail | 本地运行 |

## 已知限制与发现

- wine 不是 Windows：安装进度页在 wine 下循环误报「Deepseek-Harness-Desktop is running」（上一轮新旧配置 stub 均复现的环境噪声），GUI 走查止于 Installing 页；完成页（复用欢迎页侧栏位图 + 运行勾选 + 仓库链接）、真实 `/S` 静默安装与覆盖升级需在下一个 CI windows artifact 上按 TC-INST-001 / 009 / 010 实机走查。
- 本轮 wine 局点为 en-US，向导取 en_US 语言（与上一轮证据一致）；zh_CN 首选回退逻辑未变，实机中文走查随 TC-INST-001。
- 发现（非本次回归）：卸载器欢迎页标题第三行被裁（`MUI_WELCOMEPAGE_TITLE_3LINES` 只作用于安装器欢迎页，electron-builder 的 un-welcome 页不在 `customWelcomePage`/`customHeader` 白名单可达范围）。属上游模板限制，标题文案本次未改；如要修需评估新增 `customUnWelcomePage` 扩展点是否破坏静默安全白名单。→ **第三轮已修，见下节。**

## 第三轮补充（同日）：卸载欢迎页 3 行标题修复（契约决策 A）

**决策：** 采用方案 A——`build/installer.nsh` 新增第三个（也是最后一个）GUI 宏 `customUnWelcomePage`。机制核对到 MUI2 源码级：electron-builder `assistedInstaller.nsh` 在 `BUILD_UNINSTALLER` 页表里用该宏**替换**裸 `!insertmacro MUI_UNPAGE_WELCOME` 插入点；NSIS 3.0.4.1 `Contrib/Modern UI 2/Pages/Welcome.nsh` 中 `MUI_UNPAGE_WELCOME` 与安装欢迎页共用 `MUI_WELCOMEPAGE_TITLE_3LINES`（标题高 38u vs 28u），且每插一页就 `MUI_UNSET`——所以安装侧的 define 永远到不了卸载器，宏里必须重定义再重插页。纯页面声明，MUI 页在静默模式下从不显示，`/S`/覆盖升级/更新器路径零改动；门禁白名单精确扩为三个宏并断言宏体必须含 `MUI_WELCOMEPAGE_TITLE_3LINES` + `MUI_UNPAGE_WELCOME`（漏插 = 卸载器丢欢迎页）。

**验证（同 stub 方法，fresh VM 重搭 wine9+Xvfb）：** electron-builder 26.15.3 全量重编 NSIS 目标无错误；从 Setup 提取卸载器 GUI 打开——标题「Welcome to / Deepseek-Harness-Desktop / Uninstall」三行完整不裁字，灰阶浅色侧栏不变：修后 [wizard-uninstall-welcome-3lines.png](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-25/installer-branding/wizard-uninstall-welcome-3lines.png) vs 修前 [wizard-uninstall-welcome.png](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-25/installer-branding/wizard-uninstall-welcome.png)（第三行裁半）。门禁 `node --test src/main/installer-branding.test.js` 8/8。

**遗留（实机）：** 完成页 / 真实 `/S` / 卸载全流程 / zh_CN 仍需 CI windows artifact，走查清单见 [TC-INST-RUNBOOK.md](TC-INST-RUNBOOK.md)；本轮尝试 `gh workflow run release.yml --ref cursor/windows-installer-branding-5f26` 被 403（云代理 token 只读），须人触发。
