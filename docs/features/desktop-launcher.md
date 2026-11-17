# Feature: Desktop launcher

| Field | Value |
| --- | --- |
| **id** | `desktop-launcher` |
| **status** | `active` |
| **last verified (no failure popups)** | 2026-11-08 |
| **last verified (audit update)** | 2026-09-30 |
| **last verified (installation recovery)** | 2026-09-29 |
| **last verified (home state)** | 2026-09-29 |
| **last verified (audit closeout)** | 2026-09-28 |
| **last verified (slim package)** | 2026-09-24 |
| **last verified (visual parity)** | 2026-09-25 |
| **last verified (runtime install layer)** | 2026-09-24 |
| **last verified (service seam)** | 2026-09-24 |
| **last verified (update/import ownership)** | 2026-09-24 |
| **last verified (IPC auth, B2)** | 2026-09-20 |
| **last verified (window motion)** | 2026-09-29 |
| **last verified** | 2026-09-27(续3) |

历史验证与变更记录见 [docs/history/desktop-launcher.md](../history/desktop-launcher.md)。

## User paths

1. 冷启动预创建隐藏启动器并并行检查正式版更新；自动启动且无本地 hold 时立即进入桌面，迟到的新版本提示保留到用户下次打开启动器。关闭自动启动、中断导入恢复或上次失败时先显示启动器，新版本只在可见窗口询问；用户确认后安装当次展示的 release，下载或校验失败留在启动器首页，桌面仍可手动启动。
2. 导入页由用户主动打开；官方 home / 共享技能目录有可导入内容，不阻止自动启动、不改变启动器默认首页，也不在冷启动扫描来源。只有中断导入恢复或未决事务会停在导入页。手动导入仍分类勾选、可另选来源或技能目录，只拷勾选项到桌面 home。
3. 桌面就绪且「启动后退出启动器」为开 → 关启动器窗，**仅**在完整健康启动（`lastStart.ok===true`、非 sticky skip、非 recovery 启动）时生效。启动失败或 sticky skip 时留在启动器并提供默认折叠的 **启动诊断（Recovery Board）**（全插件名单、归因、逐项开关、批量禁用可疑）。跳过用户插件后点「启动桌面端」会清 sticky 并强制重启。插件排查与首页共用同一插件名单渲染；禁用/启用在内核 `ready|starting|error` 时经 `startHarness` 对齐名单，**不**走会关启动器的 `startDesktop`。
4. 托盘 / 文件菜单「打开启动器」随时再打开。版本页顶部常驻「本机版本」卡（版本号+状态徽标+安装路径，源码运行时标注 package.json 版本；若注册表有 Setup 则显示其版本与路径），下面是正式版列表——每行可就地展开该版本的发布日期、安装包大小、更新说明与对应操作（更新/切换/增量，有增量资产时才出现增量按钮）；更新询问与首页更新提示携带 release notes。版本页线路切换为页内下拉弹层（两条线路+说明+当前勾选，外点/Esc 关闭，就地刷新列表），不跳转设置页；左侧 rail 底部「线路 X」同为可点切换钮（向上弹层、共享同一 `route-pop`/`renderRouteOptions` 组件），完整包下 rail 弹层与设置分段常驻可见（版本页线路钮仅 slim 显示）；「立即更新」「切换至此版本」「卸载」等确认一律走 `app-confirm` 窗内确认卡（取消为默认、危险操作 danger 级），组件卸载/回滚同此。可启动 Windows 卸载程序 / 打开「设置 → 应用」移除本机应用（NSIS 单实例，不能并列多版本）。首页恢复动作（跳过用户插件启动/恢复完整插件）收进「启动诊断」折叠区，仅在恢复上下文（启动失败/恢复板/粘性跳过）出现；slim 设置含「关闭时最小化到托盘」（`closeToTray`），slim 托盘 tooltip 中文且右键菜单顶部显示监管组件计数、首次隐藏弹出说明通知。
5. 导入 / 移除在曾停止内核时提示需在首页再启；boot 页 `shell:restart` 仍走 `retryFullPlugins`（清 skip）；启动器 `shell:retry-full-plugins` 走 `startDesktopFromLauncher({ recoveryLaunch, forceRestart })`。
6. 桌面端运行中（`ready|starting|running-external`）时首页只显示「关闭桌面端」，停止后只显示「启动桌面端」——两控件按状态互斥；运行态下重显被关的窗口走托盘。`shell:stop-desktop` 经 task-protection 协调（`preConfirmed`：点击即同意，inspect→Host 接纳锁→commit，永不二次确认）仅停内核并隐藏主窗，启动器保持打开；slim 侧经 peer `stop-desktop` 同按 `preConfirmed` 由外部桌面自行协调退出。导入页「重新扫描」显示进度并保留勾选与会话分组折叠状态。
7. 桌面端「通用设置 → 启动时」与启动器「打开后自动启动桌面端」共用 `autoStartDesktop`：是则冷启动跳过启动器直进桌面（启动器经托盘右键）；否则先开启动器首页。中断导入恢复 / 更新确认 / 上次启动失败时仍先开启动器；可选导入内容不属于阻断条件。

## Invariants

- 2026-09-30：更新/指定版本安装按平台选择资产，Windows 使用 Setup.exe，macOS 使用匹配架构的 DMG；DMG 打开后明确显示手动拖入 Applications 的提示，当前应用保持运行。

- 下载与安装恢复：整包下载分别限制连接（20s）、无数据（45s）及总耗时（2h），暂态错误最多三次尝试；取消覆盖传输与重试等待。完整缓存每次重新校验 SHA512 后才能复用，`.part` 不可执行。下载目标盘做空间预检，未知总大小只显示字节/速度。安装启动失败及时返回；父进程退出不足以证明 UAC 安装完成，同版本修复返回「待确认」，失败优先于注册表变化。终止或未确认状态收起活动进度，版本安装 IPC 拒绝也必须显示失败原因。

- 启动器对外显示 Whale Isle Launcher，桌面运行时显示 Whale Isle；两个 appId 与各自旧版 userData 路径保持稳定，启动器继续识别旧版 Deepseek-Harness-Desktop 的注册表与可执行文件。

- 更新确认必须使用确认框展示的 release 快照；冷启动确认路径下载该快照的完整 Setup，不再二次读取 latest 或使用可移动目标的 `latest.yml`。窗口代际失效导致的放弃重新停放结果；自动启动失败后迟到的新版本只出现在首页更新卡，不再弹询问。
- 同一主进程同一时刻最多一个导入任务；第二个 `shell:run-import` 返回 `import-in-progress`，不能覆盖取消目标或 journal。空选择不写 `import-journal.json`。
- **更新检查不阻塞自动启动（2026-09-22）**：`runColdStartGate` 不再在本地启动判定前 `await checkUpdate()`。`autoStartDesktop` 为真且无本地 hold 时先 `startDesktop()`；迟到结果只 `parkUpdateCheck` + `shell:launcher-hint`，**不**自动打开启动器、**不**触发第二次启动。`autoStartDesktop === false`、导入 hold、上次失败三条路径照旧停在启动器，结果仍走同一 `presentUpdateAsk` 在可见启动器内呈现。`checkUpdate` 进程内 single-flight，显式刷新不被短期结果挡住。gate → `startDesktop` 的 P95 增量目标 ≤100 ms（相对 0 延迟组）。
- 会话缓存 `session_projcache` 的 schema 错误单独归因，不标记用户插件可疑；Recovery Board 的缓存诊断优先于 sticky skip，不建议清空原始会话。Loader 的 `failed to apply loader entry … (包名)` 纳入插件证据，排除 `cordis:include` 包装层。

- 端口预检「无监听者 ≠ 可用」：Windows 动态保留 TCP 端口段（Hyper-V/WinNAT；段内无监听者，connect 探测不可见，bind 即 EACCES）。`resolveLaunchTarget → ensureOwnedPort` 在 connect 探测后必须再过 `canBindPort` 绑定试探；保留/无权端口与被占端口同样改跳相邻可绑定端口（`findFreePort` 逐端口双探测：未占用且可绑定）。启动日志含 `listen EACCES` 归因 `port-excluded`（区别于 `port-in-use`），不列插件嫌疑，Recovery Board verdict 与 session-cache/内置组件损坏同级压过 sticky-skip 横幅——跳过或禁用插件都修不了端口保留。

- **失败不弹窗（2026-11-08）**：渲染崩溃/无响应/加载失败（`src/main/renderer-recovery.js`）、启动器进程致命错误（`src/main-launcher/index.js`）、组件操作与列表读取失败、更新检查失败都不再用对话框或浮层回应。渲染面先自动重载，失败页在该界面内显示；启动器致命错误只写 `main.log` 与 `logs/crash` 报告；组件失败写在组件行（`data-comp-failure`），更新检查失败写在检查按钮下（`data-update-fail`）。用户点击按钮得到的动作结果（成功提示、需要确认的操作）不在此列。
- 同一 Electron 进程、同一安装包；不是第二套 exe。
- 启动器走官方 `--dsw-alias-*`；`--boot-*` 不得用在启动器页。
- 启动器浅色/深色跟官方 dsh web 表（`data-ds-dark-theme`），不把 Appearance 壁纸种子写进 token。
- 市场 / 壁纸图库仍禁止另开产品窗。
- `/releases/latest` 忽略 draft；正式版 0.2.7 起启动器随 Setup 提供。
- 换版本只下载该 tag 对应平台的安装包，不单独切 vendor/dsh pin。
- 「更新到最新版」优先走 Windows packaged 的 electron-updater blockmap 下载（installFromAsset → downloadLatestViaUpdater），COPY 源仍为安装时自拷贝的 installer.exe；下载失败回退整包。成功下载后检查目标版本与发布清单 SHA512，共用任务保护 commit 内的 spawn，失败不再次安装。指定版本、已确认 release 快照和源码运行不走此通道。差量报告决定 differential 标记；发布 feed 来自 resources/app-update.yml。
- 更新检查请求 10s 超时；差量下载十五分钟、整包两小时总预算，正文中断或长度不符删除半成品；失败保留当前界面与手动启动入口。
- **运行时装与自更新分层**：完整包在操作系统接受安装器 spawn 后退出；slim 包保持存活，以注册表、主 exe 和目标版本匹配观察首次安装或版本切换。同版本修复不能用 mtime 或父进程结束证明完成，父进程结束后返回「待确认」；安装错误立即报告，其余等待八分钟封顶或用户取消后回未确认状态。具体恢复边界见本卡下载不变量。
- **下载线路枚举与镜像权威（2026-10-04）**：`release-source.js` 是唯一线路表（github/cnb）；`downloadRoute` 是 launcher 可写字段（`''` 未选，按系统区域默认：简体中文语言或中国大陆时区为 CNB，其余 GitHub），旧 `gitee` 选择迁移为 `cnb`。CNB 的 latest/list/tag 元数据使用 `cnb.cool/ayasealter/WhaleIsle/-` 公共 JSON 接口，安装包和校验单使用该 Release 的匿名下载地址，不需要用户令牌，也不由 GitHub 静默顶替。未完成附件校验的镜像保持预发布，不进入正式版本列表。同步操作见[发布说明](../handbook/modules/release-process.md)。
- **slim 形态的目标重定向（2026-09-24）**：`product.isLauncherPackage()` 为真时 `status`/`checkUpdate`/`listReleases`/`installRelease`/`installUpdate`/`startDesktop`/`stopDesktop`/`uninstallApp` 全部指向桌面产品身份（`install-detect` `deps.target={appId,productName}`），启动/停止走 spawn exe + tasklist/taskkill 探测（控制通道属后续批次）；renderer 不换通道只看 `launcherPackage`/`installed`/`running-external`。`--dshd-from-launcher` 让被拉起的桌面端跳过自身冷启动门直接进桌面。
- **slim 包 userData 分离 + 桌面状态显式指向（2026-09-24，B-β 修正）**：slim 进程保有**自己的** userData（`%APPDATA%/Deepseek-Harness-Launcher`，独立 config 与单实例锁——锁 mutex 由 userData 路径派生，共享目录会让启动器与运行时互斥）；桌面侧状态（dsh-home、插件清单、last-desktop-start、import journal）经 `product.js` `desktopStateDir`/`desktopUserDataDir` 显式落到运行时目录 `%APPDATA%/Deepseek-Harness-Desktop`，导入与插件归因因此不需要跨进程通道。注意：对外 `productName` 已改为 Whale Isle；两个 Electron 入口在申请单实例锁前通过 `src/shared/product-identity.js` 显式固定旧版 userData 路径，因此显示名变化不会移动配置和锁。slim 入口（`src/main-launcher/index.js`）不实例化 HarnessController、不起远程/PTY/预览；启动器通道面经 `ipc-launcher.js` 共享表注册，与完整包同一实现。`startExternalDesktop` spawn 后按存活宽限（默认 12s `tasklist` 轮询）裁决——进程出现过又消失或始终未出现都返回失败，保证「不留隐藏无窗进程」。
- 壳层 `config.githubToken` 存在时，`checkUpdate` / `listReleases` / 安装请求与下载**首跳**（仅 `api.github.com` / `github.com`）带 `Authorization: Bearer`；重定向跳（签名 CDN）不带；token 不进日志与错误信息。
- 冷启动更新流程绝不留下无窗进程：更新询问前必须 `openLauncher()`；接受更新后除「packaged 且安装器已拉起（随后 app.quit）」外一律落回启动器首页（错误/结果写入 `shell:launcher-hint`），auto start 在该轮被 hold（`shouldAutoStartDesktop.updateFlowHold`）。编排在 `launcher-gate.runColdStartGate`（依赖注入、单测覆盖）。
- `last-desktop-start.json` 写入方唯一集合：启动器 `startDesktopFromLauncher`、boot 页 `shell:restart` / 非 launcher 的 `shell:retry-full-plugins`（仅 harness 面可调用，boot 面不绑定该通道）、菜单/托盘/插件对齐 `restartWithCleanup`（经 `recordLastDesktopStart`）。成功写 `{ok:true}`，失败写 `{ok:false, error}`；launcher 角色 `shell:retry-full-plugins`/`shell:start-desktop` 由 `startDesktopFromLauncher` 代写，不双写。
- sticky skip 判定唯一实现 `launcher-gate.stickySkipActive({pluginRecovery, appVersion})`；ipc 与 `HarnessController.shouldSkipUserPlugins` 共用（后者负责清掉跨版本的陈旧标记）。
- OS 浅深色切换经 `chrome.watchSystemTheme`（`nativeTheme updated` → `applyAppTheme`）即时重绘窗口背景。
- 窗控注入保持自愈：eval retry、导航/focus/show 重断言与按节点 id 的 MutationObserver。Windows 主窗口/启动器的外框与状态遵循 [window-motion](window-motion.md)：透明自绘 20px 圆角、原生桥恢复系统动画样式，以原生 `isMaximized()`/`unmaximize()` 往返；几何回退只用于未启用原生样式的透明窗；自绘缘线在普通窗口持续保留。
- Release 若带 `SHA512SUMS.txt`，下载后强制 sha512 校验（失败即删除并报错）；无清单的 Release **不静默直装**——必须经用户确认（`confirmUnverified`，默认 fail-closed 拒绝即不开始下载），确认后安装但不做校验。
- **启动器归属确认一律渲染在启动器窗内（2026-09-27）**：主进程发起的确认（更新询问、无校验清单安装）经 `src/launcher/launcher-confirm.js` 桥——`shell:app-confirm` 事件发给启动器渲染层走既有 `app-confirm` 卡，应答走 `shell:app-confirm:response`（经 `registerLauncherChannels` extraChannels 挂载，LAUNCHER_ONLY 授权）；桥得 `null`（无窗/渲染层销毁）才回退原生 messagebox，绝不允许静默放行。完整包与 slim 包同一实现（各自进程建 `createLauncherConfirm({getWindow:getLauncherWindow})`）。
- 卸载与「设置 → 应用」回退绝不经 shell 执行注册表命令串：只 spawn 已验证存在的卸载 exe 路径（`extractUninstallExe`），提取失败落「设置 → 应用」。
- 关启动器：桌面主窗还在则只关启动器；主窗不在则退出应用。
- `readLastDesktopStart` 三态：缺文件 `{ ok:null }`（不挡 auto start）；失败 `{ ok:false }`；成功 `{ ok:true }`。
- 「启动桌面端」清除「跳过用户插件」sticky 时必须 `forceRestart`；`HarnessController.restart()` 不得把旧 in-flight Promise 交给新调用方（先 await 再开新 `replaceOperation`）。
- 插件排查禁用/启用写盘后若内核在跑，只经 `startHarness`/`restartWithCleanup` 对齐，不得经 `startDesktopFromLauncher`（避免 `quitAfterStart` 关掉排查窗）。批量禁用可疑走 `shell:disable-plugins`（一次写盘 + 一次 align）。
- 「跳过用户插件」救生启动仍强制 ensure usage、dsh-im、market；只跳过 session-search 和用户插件。desktop-install 仍 required，Project、鲸鱼娘与远程工作区继续按各自开关挂载。Bots/dshbot 及其开关、打包运行时已经移除，全量和 skip 启动只清理旧桌面受管挂载残留，保留 catalog、记忆、preset、Session 等用户数据，见[移除说明](dshbot.md)。
- 桌面自有行只经 `--patch` overlay 挂载：install insert 在 `desktop-install.patch.yml`（**每次**启动传，全量 + skip），usage insert 在 `desktop-usage-panel.patch.yml`（**每次**启动传，全量 + skip），session-search 覆写在 `desktop-plugins/session-search/desktop-session-search.patch.yml`（仅全量启动传；`session-query-sqlite` `openAt: first-search` + 耐久 `dsh-home/session-query.sqlite`，产品语义归 mobile-remote 搜索），dsh-im insert 在 `desktop-plugins/dsh-im/desktop-dsh-im.patch.yml`（**每次**启动传，全量 + skip；产品语义归 remote-settings 卡），market insert 在 `desktop-plugins/dsh-market/desktop-dsh-market.patch.yml`（**每次**启动传，全量 + skip；产品语义归 marketplace-settings 卡）。上述基础行按 install → usage → session-search → dsh-im → market 顺序组合，其他保留的桌面插件遵循各自挂载合同；不再追加 dshbot overlay。profile 的 `cordis.patch.yml` 纯用户所有——ensure 只 strip 遗留受管块（strip 后无内容须归一化回 `[]`，否则 CLI `parsePatchList` fail-loud），绝不写回；保留插件的 strip 与 overlay 写入在同一 ensure 调用内、每次 spawn 前成对发生（CLI insert 不按 id 去重，受管块残留 + overlay 同时组合 = 双挂载）。**绝不**把 `cordis.patch.yml` 传给 `--patch`——CLI 在 `--skip-user-plugins` 下仍应用 overlay，传整份用户层等于没跳过。
- Windows `.cmd` 外部 dsh（`shell: true` spawn）时 `harnessSpawnPlan` 必须给命令与所有含空白参数加引号——overlay 路径在 `AppData\Roaming\<用户名>` 下，用户名带空格是常态，不加引号参数会被 shell 拆开。
- 插件级恢复（归因、逐项/批量禁用、skip、恢复完整插件）**只**存在于启动器 Recovery Board 一处；boot 页只保留瞬时动作（重试 / 取消自动重启 / 下载日志）加「回启动器排查」跳板（`shell:open-launcher`，BOOT 角色发起时附带 show-tab home）。boot 页不得再长出自己的恢复操作副本。
- skip 只能救用户层（profile patch / manifest bundles）；模板 bundle 挂载的内置组件包（`DESKTOP_PACKAGES`）缺失属运行时损坏，`buildLaunch` 启动前探测并报可操作错误（源码运行 → `npm run setup:harness`；安装包 → 重装），不进入无效 skip 循环。探测覆盖「包不可解析」与「manifest 在但声明入口未构建」两种（与打包门禁共用 `missingDeclaredEntries` 判定）。
- skip compose 语义由打包门禁背书：after-pack 对打进 dist 的真实 CLI 跑 `dump-config` skip/full 双轮（`scripts/check-skip-compose-contract.js`，临时 DSH_HOME + 用户层 canary + 预埋受管块回放迁移）——skip 轮 canary 必须消失且 install / usage / dsh-im / market 四个桌面行仍挂载，full 轮 canary 必须回来并按 install → usage → session-search → dsh-im → market 顺序组合；session-search 只允许 full 轮出现。每个 always-on 桌面行必须各**恰好一次**（>1 = 受管块残留与 overlay 双挂载），迁移后 `cordis.patch.yml` 不得再含受管记号（install + dsh-im 两代块都回放）且 canary 用户行必须保留；任一违反即打包失败。单测层不能替代此门禁（单测 mock 了 dsh.start）。
- 启动器自有旗标（`--skip-user-plugins`、`--patch`）必须位于 CLI 语法前缀（首个未知 token 之前），否则被 CLI 当 app args 吞掉——桌面以为跳过、实际满载。`dsh.test.js` 从 vendored `args.ts` 的 web 子命令提取旗标集做语法行走断言，vendor 同步改语法会即刻红。
- Recovery Board 在 sticky skip、`lastStart.ok===false`、desktop error、genericCause、pluginTreeFailure 或存在 suspects 时于首页提供默认折叠的「启动诊断」；启动/关闭进行中隐藏旧诊断，完整错误只在此处展示一次。可选内置功能（用量统计、dsh-im、市场、Office、鲸鱼娘助理、远程工作区、dsh-pad）准备失败不阻止启动：该功能本次不挂载，`last-desktop-start.json` 的 `skipped` 记下名称和原因，桌面运行时首页状态行提示「部分内置功能未加载」，「启动诊断」逐项列出，不弹窗、不显示用户插件名单；任务保护失败仍使启动失败。首页只有一个启动/关闭主操作，失败时复用为重试；启停与两种插件恢复共享忙碌态，展示真实等待时间而非伪造进度。
- 每个 `shell:*` IPC 都必须有 main 侧授权，「preload 没暴露该方法」不构成边界：中央 `registerIpc` 的 `handle` 对每条注册强制 `assertIpcSender(roles)`；不在 wrapper 内的注册点（`chrome.js` 的 `shell:window` / `shell:window-state` / `shell:chrome-metrics`、`pty.js` 四个 `shell:pty-*`、`preview.js` 的 `shell:preview-*`、`preview-file-window.js` 的 `shell:file-preview-state`）必须各自校验。`ipcSenderRole` 对已销毁 sender、非顶层 frame、缺 URL、URL 不属于该 role 的 sender 一律返回 `null`。原生浮窗（桌面宠物 / Live2D）走各自独立门禁，不在中央表内。
- Recovery Board 诚实化：suspect 命中 `DESKTOP_PACKAGES`、dsh-im 别名（`@xmanrui/dsh-im` / `dsh-im` / `xmanrui-dsh-im`）或 install overlay 路径记号（`desktop-plugins/install-dsh-plugin`）（精确名或子路径 specifier）**且不在 profile 插件清单** → 行标 `inBox`（badge「内置组件」）、payload `desktopRuntimeDamage: true`；verdict 换成「内置组件损坏：禁用/跳过均无效，重装安装包或 `npm run setup:harness`」，并压过 sticky skip 文案（skip 修不了运行时损坏）。inBox 行不进批量禁用集合。同名用户插件**在** profile 清单时仍是普通可禁用 suspect。
- `shell:stop-desktop`（启动器专用）取消 harness 自动恢复与在途 restart/start、停止 dsh 内核、清理 PTY/预览并销毁主窗；托盘在内核未运行时打开启动器；不退出 Electron 进程、不关启动器。
- 版本页 `listReleases` 附带 `installed`（运行模式、注册表 Setup 版本/路径、是否可卸载）；卸载优先 NSIS `Uninstall*.exe`，否则打开「设置 → 应用」；源码运行且无注册表安装时隐藏卸载按钮并给出明确说明。
- 导入重新扫描保留 session-rel / skill-id / plugin-name / mcp-id 勾选与会话分组折叠；扫描完成展示计数与时间戳。

## Allowed touch

- 2026-09-30 全修授权：`src/main/update-platform-commit.test.js`、`src/main/update-updater*.js`；`vendor/deepseek-harness/packages/client/ui-settings-general` 的更新反馈源码/测试，限 macOS 手动安装反馈；配对设计文档与本次决策。

- `src/main/install-space.js` 与测试、`src/main/update.test.js`、`src/renderer/launcher-behavior.test.js` — 2026-09-29 用户授权全面优化安装链路的空间预检、故障恢复与反馈回归。

- `src/main/window.js` 启动器窗、`src/renderer/launcher.*`
- `src/renderer/theme.js`、`src/main/chrome.js`、`src/main/harness-chrome-inject.js`、`src/shared/themes.js`
- `src/main/launcher-gate.js`、`src/main/update.js`、`src/main/plugin-forensics.js`
- `src/launcher/`（启动器应用服务与平台边界：`launcher-service.js` 编排、`install-detect.js` 安装探测、`release-source.js` 线路表、`runtime-install.js` 运行时装配、`product.js` 包形态）
- `src/main-launcher/`（slim 包独立入口与 IPC 装配）、`src/main/ipc-launcher.js`（双入口共享的启动器通道表）、`electron-builder.launcher.yml`
- `src/main/index.js` 冷启动闸门、`src/main/ipc.js`、`src/preload/index.js`、托盘/菜单
- `src/main/harness-controller.js` 仅限 sticky skip 判定委托与启动 `patchFiles` 组装（install + usage + dsh-im + market overlay 所有启动，session-search overlay 仅全量且位于 dsh-im 前；不动其余生命周期语义）
- skip 救生链路（2026-08-26 扩入，理由：skip 语义由这些文件共同实现）：`src/main/dsh.js`（`buildLaunch` argv/预检、`harnessSpawnPlan` 引号、`ensureOwnedPort`/`findFreePort`/`canBindPort` 端口预检）、`src/main/plugins.js`（`ensureDesktopInstallPlugin` overlay + 受管块迁移）、`src/main/usage-panel-preset.js`（overlay 化，行为语义归 usage-stats 卡）、`src/main/session-search-overlay.js`（overlay 化，行为语义归 mobile-remote 搜索）、`src/main/plugin-tree-failure.js`、`src/main/plugin-runtime-files.js`、`src/shared/launcher-recovery.js`
- 契约门禁：`scripts/check-skip-compose-contract.js`、`scripts/after-pack.js`（仅 skip compose 契约调用与 `assertDesktopForkRuntime`；打包其余部分归 marketplace-settings / 打包卡）
- 本卡与 QA `TC-LAUNCH-*`

## Do not touch

- vendor harness
- 把 `--boot-*` 扩到启动器
- 在启动器里做市场、壁纸、完整官方设置

## Gates

| Kind | What |
| --- | --- |
| Automated | `launcher-gate`（含 `runColdStartGate` 编排 / `stickySkipActive` / `recordLastDesktopStart`）/ `update`（listReleases、downloadFile 断流/截断）/ `plugin-forensics`（含 inBox/`desktopRuntimeDamage`/`port-excluded`）/ `launcher-recovery`（verdict 优先级 + 排序）/ IPC LAUNCHER 单测；`dsh.test.js` argv 语法契约（args.ts 提取）+ 端口预检（`canBindPort`/`ensureOwnedPort`/`findFreePort` 保留段改跳）；`skip-compose-contract` 单测 + after-pack 真实 CLI `dump-config` skip/full 双轮门禁；`launcher-theme` / `officialShellBackground` / `windowBackgroundForShell`；`chrome-theme` watchSystemTheme；`session-search-overlay` 与 harness-controller 全量/skip `patchFiles` |
| Manual / QA | `TC-LAUNCH-001`…`008` |

## Sources

- Decision: [项目审查修复](../decisions/implemented/bug-fix/2026-09-30-project-audit-fixes.md)

- Decision: [安装恢复边界](../decisions/implemented/bug-fix/2026-09-29-installation-recovery.md)

- Decision: [首页单一操作与诊断](../decisions/implemented/bug-fix/2026-09-29-launcher-home-state.md)、[可选导入不抢占冷启动](../decisions/implemented/bug-fix/2026-09-29-optional-import-startup.md)

- Decision: [启动器收尾审计修复](../decisions/implemented/bug-fix/2026-09-28-launcher-audit-closeout-fixes.md)

- Decision: [启动器更新确认与导入任务归属](../decisions/implemented/bug-fix/2026-09-24-launcher-update-import-ownership.md)、[透明无边框窗口的注入式窗控自愈与几何最大化判定](../decisions/implemented/bug-fix/2026-09-25-window-chrome-self-heal.md)、[透明窗圆角剪影用嵌边发丝环锚定边缘](../decisions/implemented/bug-fix/2026-09-25-window-silhouette-edge-ring.md)
- Decision: [冷启动的更新检查退出自动启动关键路径](../decisions/proposed/product/2026-09-22-nonblocking-startup-update.md)、[Git 标题栏一次刷新共用一份读取上下文](../decisions/proposed/architecture/2026-09-22-git-refresh-read-context.md)

- Implementation：`src/main/launcher-gate.js`、`src/launcher/launcher-service.js`、`src/launcher/install-detect.js`、`src/launcher/release-source.js`、`src/launcher/runtime-install.js`、`src/launcher/product.js`、`src/renderer/launcher.html`、`src/renderer/theme.js`、`src/shared/themes.js`
