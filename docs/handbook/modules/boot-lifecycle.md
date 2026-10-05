# 模块：启动与 Harness 生命周期

## 职责与非目标

**职责：** 冷启动闸门、拉起 / 监视 `dsh web`、boot 态机、就绪后露出 BrowserView、崩溃重启。
**非目标：** 不实现对话业务；不扩散启动页海平线画布到启动器或其它页。

## 用户路径

1. 自动启动开启时直接进入桌面；关闭或上次启动失败时显示启动器首页。导入由用户主动打开，只有中断事务恢复会自动进入导入页。
2. 桌面主窗见海平线画布与底缘日志 ticker（点击开抽屉看全部） → 插件进度 → 主界面。  
3. 失败：启动器留下并打开插件问诊；boot 仍可重试、取消自动重启、导出日志、回启动器排查；跳过用户插件是自动恢复路径而非按钮。  
4. 运行中 Harness 挂掉：故障态与可选自动重启。

## 架构要点

- `whenReady` 预建隐藏启动器并进入冷启动门；更新检查不阻塞正常自动启动，可选导入来源也不占用启动路径。
- Windows 主窗与启动器通过 `applyWindowsAppDetails` 先写图标、重启命令和产品名，再仅写 AppID；第二次调用触发读取完整品牌信息的任务栏刷新，两次均在首次显示前完成。
- 安装版 Windows 在预建窗口前检查旧通知自动生成、与正式 GUI ID 冲突的 `Electron.lnk`。固定当前用户开始菜单路径及普通文件 / Electron 目标 / 空参数 / 默认图标全部匹配后，将原字节移入 userData 唯一 `Electron.lnk.backup` 备份，不保留 `.lnk` 扩展名；读错或身份不符不修改。只有完成移动才异步通知 Shell 该旧路径 → 备份路径（`SHCNE_RENAMEITEM`、`SHCNF_PATHW | SHCNF_FLUSH`），等待事件投递；原生回调最多等待 500ms，通知失败或超时仍保留备份并继续启动。期限只结束启动等待，不取消原生调用，迟到回调不翻转超时结果；投递完成不证明任务栏像素正确。不匹配分支不加载原生桥，不清全局缓存、不重启 Explorer。原始 Electron 源码通知已禁止重新注册，用户固定项及其它快捷方式保留。见[任务栏身份决定](../../decisions/implemented/bug-fix/2026-10-01-windows-taskbar-identity.md)。
- `HarnessController` 拥有子进程与揭示时机；boot 只消费事件。  
- Windows Setup 在暂存安装目录完成 Harness 归档摘要核验、提取和最终路径 junction 准备，应用启动优先使用 `resources/vendor/deepseek-harness`，不重复写入 userData 运行时树。`pack --dir`、macOS 和旧 tar 安装布局仍走启动提取；该路径的链接批量检查、恢复与清理由异步文件 API 执行，每五秒向既有日志报告完成数/总数。准备阶段可在文件操作之间取消，目录替换开始后完成最终链接或回滚才返回。详见[安装恢复决定](../../decisions/implemented/bug-fix/2026-09-29-installation-recovery.md)。
- 恢复与手动重启共享未完成的 boot 导航；新 Harness 揭示前必须等待旧导航完成，避免迟到的启动页覆盖新界面。
- 插件装载进度留在 boot，不切官方加载页。  
- 揭示先持桌面透明，等待窗控注入与全尺寸布局产帧，捕获启动页快照并按 62% 海天线分为上下两片；主界面在快照后方保持原位，独立透明覆盖窗口中的两片静态图层按三倍基础动效 token 向上下移出窗口；boot 保持不透明，渲染侧报告过渡完成后才遮盖。取消/替换后的旧回调无效，减弱动效直切；失败回退也须挂载并清理快照遮罩与透明状态，而非只隐藏 boot。
- 无账号或模型密钥也直接揭示工作区，不弹原版欢迎窗；登录和密钥配置留在设置。后台账号观察保留授权外开与 Platform 身份刷新，退出/过期不隐藏工作区。冒烟检测到欢迎窗即失败，不自动点击跳过，见 [desktop-welcome](../../features/desktop-welcome.md)。
- 主 frame preload 的 `dshDesktop.onboarding: false` 同时关闭首次用途/过程引导，不创建 controller、不写完成标记或默认偏好；通用设置保留这些选项。冒烟不代点继续/稍后配置。
- 流程详述：[../flows/boot-to-ready.md](../flows/boot-to-ready.md)
- 启动器使用 `src/renderer/launcher.html` / `launcher.css` / `launcher.js` 与共享 `dsh-webui-tokens.css`。`html[data-shell-theme=official]` 下 `theme.js` 只选择 `theme.scheme` 的明暗表，不写 Appearance 壁纸种子，不新增 `data-theme` / `prefers-color-scheme` 色板。首页启停共享操作锁，故障原文和插件恢复保存在默认折叠的「启动诊断」。

## 实现入口

- `src/main/index.js`、`launcher-gate.js`、`harness-controller.js`、`dsh.js`、`harness-extract.js`、`window.js`、`chrome.js`、`../shared/dsh-home.js`、`../shared/themes.js`
- `src/renderer/launcher.html` / `launcher.js` / `launcher.css`
- `src/renderer/boot.html` / `boot.js` / `boot.css` / `boot-tokens.css`；开幕覆盖层 `boot-reveal.html` / `boot-reveal.css`

## 退出/更新保护（P1）

显式 quit 现与安装/启动器停止一样跳过工作清单二次确认，但保留检查、接纳锁和 drain；锁/排空失败仍显示故障恢复提示。Host 不把本地回环空闲长连接计作远程工作，agent/job/在途请求仍独立检查，见[退出修复](../../decisions/implemented/bug-fix/2026-09-29-quit-transport-false-positive.md)。重启/重载仍需活动任务确认。

关闭遮罩的 CSS / 脚本 / 两帧等待在主进程有 500ms 期限。隐藏页面的 requestAnimationFrame 可以不执行，因此它只负责尽力显示反馈，超时或 renderer 出错后照常进入 `harness.shutdown()`；任务保护和正常资源清理不跳过。见[绘制等待决定](../../decisions/implemented/bug-fix/2026-10-01-closing-overlay-paint-deadline.md)。

退出、重启、停止、reload、更新、增量安装全部过 `src/main/task-protection.js` 协调器：`inspect → 脏则确认（壳层弹窗，无可见窗退原生框） → acquire（Host 接纳锁 + drain）→ 复查 → commit`；launcher 发起的停止（peer `stop-desktop` 与自带启动器 `stopOp`）带 `preConfirmed` 跳过两道确认门——点击即同意。Host 侧 `vendor/dsh-task-control`（overlay `desktop-task-control.patch.yml` 每次启动挂载）包裹 webServer 路由/升级/`connection/request` 瀑布与 `sessionController.resolveAgent`、`jobs.start`，锁定期间新工作一律拒绝，解锁时驱动 schedule `requestDrive` 恢复到期投递。slim 包经 userData 的 `task-control-peer.json` 握手让外部桌面自己跑协调；无握手的旧桌面走 WM_CLOSE，进程仍在即阻断，不再 `taskkill /F`。决策记录：[../decisions/implemented/architecture/2026-09-25-task-protection-coordinator.md](../../decisions/implemented/architecture/2026-09-25-task-protection-coordinator.md)。

## 不变量

- Feature card：[../../features/desktop-launcher.md](../../features/desktop-launcher.md)、[../../features/boot-page.md](../../features/boot-page.md)、[../../features/dsh-home.md](../../features/dsh-home.md)、[../../features/task-protection.md](../../features/task-protection.md)
- 启动器走官方 `--dsw-alias-*`；`--boot-*` 不得用于启动器 / 设置 / 官方 UI / 关闭遮罩。
- 启动器浅色/深色跟官方 dsh web 表（`data-ds-dark-theme`），不把 Appearance 壁纸种子写进 token。
- 桌面家目录见 [dsh-home.md](dsh-home.md)：`userData/dsh-home`，不读官方 `~/.dsh`。
- 安装目录内可用的 Harness 优先于 `userData/runtime/<version>`，因此同版本覆盖安装不会被旧的 userData 提取树遮蔽。用户插件、会话与配置仍保存在桌面家目录。
- 启动时提取路径的 `userData/runtime/<version>` 用 pin+归档戳校验；同版本不同归档内容不得沿用旧树。首次/更新后提取在同卷 `.extract-*` 临时目录完成，按未压缩归档的 115% + 256 MiB 预留检查用户数据盘；每五秒记录耗时，十五分钟超时，停止操作会取消 tar。提取进程关闭后才清理半成品，校验通过才替换正式树并重建 Windows junction；`.previous` 保存中断替换的恢复基线。安装目录直接运行和已验证复用路径不要求额外提取空间。

## 门槛

- QA：`TC-LAUNCH-001` … `TC-LAUNCH-008`、`TC-INST-001` … `TC-INST-008`、`TC-INST-009`、`TC-INST-011`

## 延伸阅读

- [../design-language.md](../../design-language.md#桌面启动器)、[桌面启动页](../../design-language.md#桌面启动页)
- [plugin-recovery.md](plugin-recovery.md)、[dsh-home.md](dsh-home.md)
