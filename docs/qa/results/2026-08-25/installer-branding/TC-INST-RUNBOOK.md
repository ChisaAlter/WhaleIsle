# TC-INST 实机走查 Runbook · Windows 安装器品牌化（分支 `cursor/windows-installer-branding-5f26`）

**目的：** Linux/wine 预验证止步的四件事——完成页、真实 `/S` 静默/overlay、卸载向导、zh_CN 本地化——需要一台真 Windows（win10/11 x64）按本清单走完。所有 wine 能验的（欢迎/许可/模式/目录/卸载欢迎页 3 行标题、位图、门禁单测）已在 [EXECUTION-REPORT.md](EXECUTION-REPORT.md) 关账，不在本清单重复。

**对象：** 本分支 CI `Build installers` workflow 产出的 windows artifact，**不是**本机 `dist\`。

---

## 0. 获取 Windows artifact

1. 触发构建（需要 Actions write 权限；云代理 token 只读，2026-08-25 尝试 dispatch 返回 `HTTP 403: Resource not accessible by integration`，须由人触发）：

   ```bash
   gh workflow run release.yml --repo ChisaAlter/Deepseek-Harness-Desktop \
     --ref cursor/windows-installer-branding-5f26
   ```

   或 GitHub UI：Actions → `Build installers` → Run workflow → 选分支 `cursor/windows-installer-branding-5f26`。

2. 等 `windows` job 绿后下载 artifact（macos job 失败不阻塞，artifact 名固定）：

   ```bash
   gh run list --repo ChisaAlter/Deepseek-Harness-Desktop --workflow=release.yml --branch cursor/windows-installer-branding-5f26 --limit 3
   gh run download <run-id> --repo ChisaAlter/Deepseek-Harness-Desktop -n DeepSeek-Harness-windows-x64 -D setup-artifact
   ```

3. 记录 SHA256（写进结果表，作为证据锚点）：

   ```powershell
   Get-FileHash .\setup-artifact\Deepseek-Harness-Desktop-Setup-*.exe -Algorithm SHA256
   ```

4. 前置清场：退出已装的 `Deepseek-Harness-Desktop.exe`（托盘也退），TC-INST-001 用干净机或先卸载旧版。

## 1. TC-INST-001 · GUI 安装走查 + 品牌 checklist（P0）

双击 Setup，逐页核对。**品牌基准 = 官方浅色表（启动器同源）**，参照 wine 截图 [wizard-welcome.png](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-25/installer-branding/wizard-welcome.png) 等：

| 页 | 检查点 |
| --- | --- |
| 欢迎页 | 浅色侧栏 `rgb(249,250,251)` + 近黑鲸标 + 竖排产品名 `Deepseek-Harness-Desktop` + 细蓝强调线 + 右缘发丝线；标题 3 行不裁字；正文本地化 |
| 许可页 | MIT 原文（根 `LICENSE`）；右上白底墨色鲸标 header（150×57 不变形）；底部 BrandingText `Deepseek-Harness-Desktop <version>`（不是 Nullsoft 字样） |
| 安装模式页 | 默认「仅为我安装」（per-user） |
| 目录页 | 默认 `%LOCALAPPDATA%\Programs\Deepseek-Harness-Desktop`；可改目录 |
| 安装进度页 | header 鲸标在；无报错弹窗（wine 的「is running」循环误报不应在真机出现） |
| **完成页** | 复用欢迎页浅色侧栏位图；标题 3 行不裁字；默认勾选「运行 Deepseek-Harness-Desktop」且勾选后真的拉起应用；产品仓库链接 `github.com/ChisaAlter/Deepseek-Harness-Desktop` 可点、开对页 |

装完启动一次进主界面（安装包可启动即本用例期望；版本核对按 [production-acceptance-test-cases.md](../../production-acceptance-test-cases.md#tc-inst-001--安装包校验安装并可启动--p0) 原文）。

**可选（不阻塞）：** 设计师目检——真机 ClearType 下侧栏产品名与标题字渲染无毛边/发虚（wine 的字体栅格化与 Windows 不同，这一项只能真机看）。

## 2. TC-INST-009 / 012 · `/S` 静默 + 同版本 overlay（P0）

1. 已装状态下（上一步装好的即可），管理员不需要，直接：

   ```powershell
   .\Deepseek-Harness-Desktop-Setup-<ver>.exe /S
   ```

2. 期望：**无任何窗口/页面弹出**，进程自然结束；装完应用仍能启动；用户数据（`%APPDATA%\deepseek-harness-desktop` 的 dsh-home、会话）原样保留。
3. 同版本 overlay 后按 TC-INST-012 原文验 harness 重解压 / 启动日志无 `unknown option '--no-open'`。
4. 本轮 `installer.nsh` 只加了 GUI 页宏（含 `customUnWelcomePage`，纯页面声明），`/S` 路径按契约零改动——若静默行为有任何变化即回归缺陷，直接开缺陷单。

## 3. TC-INST-010 · 卸载向导（P1）

系统「设置 → 应用」或开始菜单卸载：

| 检查点 | 期望 |
| --- | --- |
| 卸载欢迎页标题 | 3 行完整显示「Welcome to / Deepseek-Harness-Desktop / Uninstall」（本轮修复；wine 修后证据 [wizard-uninstall-welcome-3lines.png](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-25/installer-branding/wizard-uninstall-welcome-3lines.png)，修前裁字 [wizard-uninstall-welcome.png](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-25/installer-branding/wizard-uninstall-welcome.png)） |
| 卸载侧栏 | 同一浅色构图的**灰阶弱化**版（区分移除语境，不是安装页的彩色蓝线版） |
| 卸载完成 | 快捷方式（桌面 + 开始菜单）移除；`%LOCALAPPDATA%\Programs\Deepseek-Harness-Desktop` 清掉；**`userData`（dsh-home、会话）不删** |

## 4. zh_CN 本地化抽检

`installerLanguages` 是 `zh_CN`（首位 = 兜底）+ `en_US`，MUI 按系统 UI 语言选串：

1. 在显示语言为**中文（简体）**的 Windows（或 zh-CN VM）双击 Setup：全部向导页（含完成页、卸载欢迎页）应为中文 MUI 串，产品名保持英文原文（品牌词不翻译）。
2. 中文标题同样核对 3 行不裁字（`MUI_WELCOMEPAGE_TITLE_3LINES` / `MUI_FINISHPAGE_TITLE_3LINES` 与卸载侧 `customUnWelcomePage` 均已定义）。
3. 英文局点回归一遍欢迎页即可（wine 证据已覆盖 en_US 主路径）。

## 结果表（诚实记录：未实机执行前一律 ☐ / Blocked）

| ID | 优先级 | 结果 | 证据（CI run URL + SHA256 + 截图） | 执行人 | 日期 |
| --- | --- | --- | --- | --- | --- |
| TC-INST-001（GUI + 完成页品牌） | P0 | Blocked — awaiting Windows artifact（dispatch 403，须人触发） | | | |
| TC-INST-009（`/S` overlay） | P0 | Blocked — awaiting Windows artifact | | | |
| TC-INST-012（同版本 overlay 重解压） | P0 | Blocked — awaiting Windows artifact | | | |
| TC-INST-010（卸载向导 + 灰阶侧栏 + 3 行标题） | P1 | Blocked — awaiting Windows artifact | | | |
| zh_CN 抽检 | P1 | Blocked — awaiting zh-CN Windows | | | |
| ClearType 目检（可选） | P2 | ☐ 不阻塞 | | | |
