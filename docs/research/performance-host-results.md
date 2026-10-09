# 宿主性能优化结果（T05、T06、T07）

目标：`C:/AI/WhaleIsle-application-performance`，`codex/application-performance-full`，基线 `26205a89` 加本轮未提交候选改动。2026-10-09。主检出及日常实例未修改、未重启；没有提交、推送或 PR。

## 实际采用与范围

| 任务 | 采用 | 保留 / 不采用 |
| --- | --- | --- |
| T05 | 原生 `process.kill(pid, 0)` 查询替代同步 `tasklist`；ESRCH=不存在、EPERM=可能存在，未知错误继续抛出。status/forensics 异步读日志，同一请求复用配置和 last-start；串行异步日志写入/轮转及 stdout/stderr 背压。启动 verdict 前、已退出 child 的 stdio close 后及主进程既有资源清理路径 flush。 | state/row 同步接口、management API/PID/版本校验、最新取证和日志尾部语义保留。日志文件失败仍为 best effort，flush 返回失败信息而不替换原 runtime 错误。没有固定 status IPC 轮询，也没有增加轮询或无证据的在途缓存。 |
| T06 | 两个安装插件 payload 按字节相等跳过复制，内容改变仍更新；launcher 两种导入扫描入口转发 root 实现的 `scanImportAsync`。 | 未重排鲸桥 readiness、插件装配、恢复/skip、首次渠道请求和启动动画。复制量很小，不宣称启动耗时百分比；导入热点及对照由 root 报告。 |
| T07 | 手工 ASAR 遍历改异步 mkdir/readdir/copyFile，staging/版本切换与清理逐处 await；保留每组件锁、registry 和原有 stop/restart 顺序。 | 不新增 worker、取消 API、并行安装服务或重试。组件原本没有取消接口。更新失败仍保留原版本记录和用户数据，不把原本未保证的自动重启报告为新保证。 |

实现入口：`src/launcher/components/lifecycle.js:18,153,167`、`components/index.js:143`、`launcher-service.js:81,608,687`、`forensics-log.js:36,137,149`、`runtime-install.js:495,506,512`、`src/main/plugins.js:268`。主进程正常退出 flush 由 root 在 `src/main/index.js` 的既有 `cleanupDesktopResources` 串行整合。

## 宿主函数对照

Windows，Node v24.19.0，同机本地自有夹具。复制/日志/插件各 3 次对照，PID 各 10 次；这是函数与事件循环观察，不是 Electron 页面交互或安装版启动验收。原始样本见 [performance-host-measurements.json](./performance-host-measurements.json)。采样量不足以外推长期 p95 或整应用节省比例。

| 路径 / 指标 | 基线 | 候选 | 解释 |
| --- | --- | --- | --- |
| 自 PID 查询，10 次 p50 / 最大值 | `tasklist` 310.097 / 832.583ms | 原生查询约 0.0037 / 0.0646ms | 避免每次状态探测创建外部进程；不会发送终止信号。基线未出现在 JSON 中，来自实施前同方法的只读 10 次样本。 |
| 1,000 文件，每文件 8KiB，首个 timer 到达 | 974–1,289ms | 0.62–2.89ms | 目录复制让出主线程。 |
| 同复制夹具，总完成时间 | 974–1,289ms | 1,000–1,205ms | 吞吐在此样本中相近，不宣称每次安装更快。 |
| 40 个约 32KiB 日志 chunk，首个 timer 到达 | 181–402ms | 0.57–0.90ms | 同步 append/轮转阻塞消除。 |
| 同日志突发，最终写入/flush 完成 | 181–402ms | 132–203ms | 最终 verdict 保留，文件保持原 512KiB 上限和行边界轮转。 |
| 未变插件的 payload 复制 / 写入字节 | 每次 2 文件 / 10,663 字节 | 每次 0 / 0 | 确认减少无效 payload 写盘；其他配置/overlay 既有去重仍保留。 |
| 同插件调用耗时 | 2.44–7.56ms | 1.31–8.52ms | 样本有噪声，不能证明启动阶段整体变快。 |

## 验证与体验证据

产品改动后复用 6 个相关宿主检查文件，首次 129 项通过。针对随后增加的 stdio close 边界、原生 PID 结果和同值插件文件补充检查后，4 个受影响文件 77 项通过。新增 status/异步导入入口检查与日志检查 12 项通过，均无失败；新增 status 的导入返回值用当前公开扫描结果形状，验证两类参数透传。

已有真实 fixture `launcher-notes` 完成安装 → 启动 → 更新 → 回滚 → 卸载，保留组件数据。新增真实 Node 子进程输出约 1.5MiB、慢写盘施加实际 stream pause/resume，退出后 flush 等 stdio close，确认最后 `FINAL_CRASH_EVIDENCE` 完整保留，文件不超过原上限。已有 runtime checks 继续覆盖 spawn failure、grace 内退出、never-started 及其错误日志，原错误判定未被日志失败替换。

status 检查覆盖普通可序列化 IPC 结果、单请求 config/last-start 一致、下一请求仍读取新配置/错误；这不替代真实启动器观察。`git diff --check` 与改动 JS 语法检查通过。没有重复跑整应用测试。

## 尚未验收的真实用户路径

- 候选真实启动器打开、鲸桥外部退出/恢复、后台组件进度、插件失败诊断及聊天响应。
- 安装版冷/热启动、恢复/skip、缺 payload、首次渠道请求和完整启动动画。
- ASAR 包内组件较大 payload 安装/更新及失败恢复；源码 Node 夹具不能证明打包 ASAR 读取。
- UI 操作期间真实输入/窗口响应 p95；当前 timer 对照仅证明宿主事件循环让出。

以上缺口须由同一候选的后续实机与安装包验收补齐，不能标记 T05–T07 用户体验全部完成。回退只回退对应代码调度，不重置 profile、配置、组件版本目录或用户数据。

## 组合源码 QA 观察（2026-10-09，单次）

root 的候选 prestart 准备完成后，仅执行候选已有 `scripts/run-source-qa.mjs` 一次，`DSH_SMOKE_KEEP=1`；未重建、未改产品或断言。启动父进程使用临时工具目录中的 Node v24.21.0，Electron 44.1.1；只在本轮父进程移除 `ELECTRON_RUN_AS_NODE` 和 existing-workspace escape hatch。脚本创建独立 TEMP profile、工作区和 127.0.0.1:50174 端口，测试工作区自身的 Git 初始化/提交不涉及候选产品分支。未操作用户实例、root 的另一个 soak profile、鼠标或其他窗口。

保留产物：`C:/Users/48818/AppData/Local/Temp/dsh-source-qa-RZ0eMc/user-data/dshd-smoke.json`，独立工作区位于相邻 `workspace`。QA 子进程结束后脚本 exit 1；Electron outcome 为 `3221226505`（`0xC0000409`），不是 helper timeout。启动记录 `last-desktop-start.json` 为 `ok:true`，限定范围的 boot/harness API、标题栏基础结构和 PTY `echoed:ok` 已观察到；结果 `pageErrors=[]`。这些不能替代完整验收。

应用内 walk 共 77 项记录：53 通过，23 必需失败，1 可选未通过。通过的实际路径包括独立工作区连接、输入框与命令菜单、分支/Git 菜单、后续右侧栏打开、真实 fixture 文件 README/note 展示与引用、差异预览、浏览器入口、侧栏终端、MCP/技能/插件基础入口和用量统计。差异区域确实显示 `note.md` 的测试内容，不只是空 DOM。

失败分组如下，保留原判定：

- 初始标题栏 hit probe 点击右栏后超时：`inner=1441 frame=1441 collapsed=false surfacesCollapsed=true rightbarWidth=0`；因此 `branch/git` hit 计数为 0。后续 `rightbar.open` 通过，不能据最初超时推断侧栏始终不可见。
- `composer.thinkingSwitch`：Low 未呈现 engaged/settled；`terminal.drawer/new` 未打开，而后续 `terminal.surface` 通过；测试工作区 `git.commit` 后 HEAD 仍为 smoke。
- 账户 signed-out 菜单、appearance/gallery、模型提供商、市场内容、interface dshbot/session-log 控件检查未通过（23 个必需失败的完整名称和 detail 保存在原 JSON）。其中多项为脚本未找到控件；尚无直接证据区分产品缺失、定位契约变化和本次操作时序。

`dshd-qa.png` **不存在**；既有 smoke 实现在 `src/main/smoke/index.js` 的 capturePage/write 截图错误分支中吞掉异常，故没有可供 `view_image` 的完整画面。不得把源码的 frame 数字/无 pageErrors 写成视觉通过：截断、叠压、窄侧栏、长路径/标题、实际聊天内容和窄窗口验收均缺直接图像证据。该 profile 未发现本次 crash dump，不能仅凭原生退出码确定崩溃根因；也没有同版本基线 UI 对照，不能把上述失败归因于性能改动。

按单次约束停止，没有原样重跑、弱化断言、补拍其他实例或以新的产品修改规避失败。组合用户体验验收状态为**失败并存在视觉证据缺口**；T05–T07 的定向结果仍有效，但不等于全应用可交付。后续应先针对本次右栏/抽屉/设置定位与原生退出边界做能区分原因的检查，再由授权的真实候选/安装包验收补齐。

### 单次 QA 的后续只读诊断与退出契约修正

Windows Application 事件已把原生异常绑定到本轮：独立 profile 的 `task-control-peer.json` 为 pid=3892，01:14:37.641 的 Application Error 1000 为 PID `0xF34`（3892）、候选 `node_modules/electron/dist/electron.exe`；faulting module 同为 electron.exe，offset `0x3112d55`，exception `0xc0000409`。WER 1001 为 BEX64，P9=7，报告 ID `23c7b4f4-2182-4b2c-8fc2-82dd87345d9d`。系统 WER 归档存在，但读取具体归档目录拒绝访问；没有升权或修改 ACL，当前没有符号堆栈。

结果 JSON 的创建/写入时间为 01:14:35.827。源码顺序是 capturePage catch（`smoke/index.js:833`）→ debugger detach → JSON 同步写盘 → exitSmoke；完整 JSON 已写成证明主进程越过截图分支。原生终止可收窄到后续退出阶段，不能证明发生在 PTY/preview 清理、harness.shutdown 或 app.exit 中的哪一步；截图缺失的异常被无日志 catch 吞掉，仍不明。

解码本轮独立 session 的完整 zstd journal（复用 `pet-growth.zstdDecompressAll`）后，`session-d5aad36e-5578-4cc2-9aec-5375b477e263` 的 seq20 明确为 `model/selection` reasoningEffort=low；两次 request/header 正确为 off→low，Low user/message seq25 已接收。turn/end seq19、29 均为 `MISSING_CREDENTIAL`，缺独立 fixture 的 deepseek-official API key。故“未成功切换/未发送”不能由 `composer.thinkingSwitch` 失败推导；实际切换与请求已落地，QA 的 engaged/idle DOM 条件没有识别该次快速凭证错误。该脚本直接启动真实官方源码/服务，未在此路径设置模型 stub；不能报告真实模型响应通过。

当前源码仍保留 QA 查询的控件契约：`SettingsRoot.tsx:104,114` 的 settings dialog/nav、`WallpaperRow.tsx:132,146,153` 的选择图片/图库/file input、`AccountMenu.tsx:88–90` 的 signed-out 联系/登录项、`ModelsSection.tsx:658,679` 的新增提供商/vision picker、`TerminalWorkspace.tsx:293` 的 `data-terminal-owner="drawer"`。QA 的 `dshDialog()`（`release-ui-walk.js:205`）取首个可见 dialog，账户探针取首个可见 menu，且部分探针返回包含 false 字段的对象后 `waitUntil` 就结束。这些是需要区分的作用域/时序风险，不是当时 DOM 状态的证明；原生堆栈、完整画面和失败当下 DOM 未保留，其他控件失败原因仍未知，不能归因性能改动。

root 授权后最小修正 QA 专属退出契约：`src/main/smoke/index.js` 导入 `getLive2dPet`，在既有 `harness.shutdown` await 之后、`app.exit` 之前 await 当前 manager 的 `dispose()`。普通 finalizeQuit 已使用此清理，而 QA 专属路径原先绕过它；宠物不可见仍可能有后台 usage worker，因此该差异必须补齐。没有改断言、失败状态、provider、截图 catch、QA 工作负载或其它资源顺序。**这个修正尚不能被宣称为已证明 0xc0000409 根因。** 产品改动完成后仅运行现有基础 `run-source-smoke.mjs` 定向观察退出，没有重跑完整 source QA。

### 退出补丁后的定向基础 smoke（仅一次）

产品两行修正后，JS 语法检查通过，仅运行已有 `scripts/run-source-smoke.mjs`；同样使用 Node v24.21.0、本轮隔离环境和 `DSH_SMOKE_KEEP=1`，没有 `DSH_QA`，没有重建。独立产物为 `C:/Users/48818/AppData/Local/Temp/dsh-source-smoke-hQYVmB/user-data/dshd-smoke.json`，端口 63603，own profile peer PID=22652。

本轮 Electron 实际 outcome `{code:1, signal:null}`，helper exit 1；原判断失败后经 exitSmoke 返回预期失败码，没有变成原生异常码。frame/titlebar、限定范围 API 和 PTY `echoed:ok` 通过，`pageErrors=[]`。原始标题栏右侧栏 probe 仍失败（surfaces=1，branch/git=0，width=0），因此基础 smoke **未通过**；没有修改断言、扩大 skip 或改其失败状态。基础 smoke 默认没有截图，这次也没有完整图像可评判布局。

观察窗口内 Application/WER 没有此 PID 的新增原生崩溃事件，仅保留先前 PID3892 记录。该单次较轻负载证明新的 cleanup await 可以结算并返回原本判定的退出码；未做同负载受控对照，不能据此证明此前 0xc0000409 由 watcher 未清理引起，也不能把原 source QA 的 23 项必需失败或视觉缺口覆盖为成功。没有继续重跑。最终产品 diff 仅 `smoke/index.js` 的导入和退出 await 两行，`git diff --check` 通过，交由 root 安排两轴评审与安装包观察。

### 初始右栏探针的狭窄显示状态对照

未重新执行全套 QA，也未准备 667 MiB 的 HEAD26205 基线构建。独立 TEMP 脚本复用现有工作区配置和连接方法，以标准 `.` 入口启动候选自己的新 profile/workspace；只连接自身 main inspector，通过现有标题栏操作检查右栏，并保留原 `probeTitlebarHits`，没有改变其宽度断言。原 probe 在该最小场景重现原错误，因此不是只从源码猜测。两轮记录分别为 `C:/Users/48818/AppData/Local/Temp/whale-rightbar-live-f9Yclh/rightbar-results.json`（PID29204，未传 launcher 标记）和 `C:/Users/48818/AppData/Local/Temp/whale-rightbar-live-tl8JRQ/rightbar-results.json`（PID51572，传 `--dshd-from-launcher` 且等待公开 `isHarnessLoaded`）。两轮自身 app 都正常退出 code 0；未操作用户实例或 root 的 soak。

未传标记时主窗口 `isVisible=false`、目标 BrowserView 初始 0×0；原 helper 的 viewport 调整后 DOM innerWidth=1441，但 `document.hidden=true`。原 probe 点击后面板 `data-sidebar-right-open=true`、实际 panelWidth=540、aria-hidden 移除，frame 的 inline grid 已设右列 540px；computed grid 仍为 `280px 1161.33px 0px 0px`，rightbar trackWidth=0，CSS `grid-template-columns` transition 的 currentTime=0、playState=running。故实际面板逻辑已打开，而用于探针的布局动画没有推进。随后仅对本 app 调用 `showInactive`，native `isVisible` 变为 true，但文档仍 hidden、动画仍停在 0；公共标题栏按钮可以实际关闭/重开面板，但网格列仍为 0。该轮 `capturePage` 返回 `UnknownVizError`，没有图片可用于完整视觉评判。

标记对照没有证明最小 flag 修复有效：等待 `isHarnessLoaded` 时目标 view 已 1441×920，但主窗口仍 `isVisible=false`、文档 hidden。原 probe 同样失败，公共按钮仍能改变面板状态，`showInactive` 后仍未推进动画，截图同样 `UnknownVizError`。这反驳“加 `--dshd-from-launcher` 即足以使探针在可见 UI 上执行”的当前假说，因而尚未修改 smoke helper flags，也没有以此继续 source/package smoke。

源码契约与观察一致但不替代因果归因：`window.js:229` 的 `ready-to-show` 才自动 `show()`；`isHarnessLoaded` 只确认 harnessRevealed 和 URL，不确认 native/document 可见。`--dshd-from-launcher` 在 `index.js:1367–1376` 只是绕过 cold-start gate 并进入同一 `startDesktopFromLauncher`，没有显式显示动作。source-smoke/package-smoke 当前均 `windowsHide:false`，source-QA 为 true；三者原本均不传该标记。若后续有真实可见证据支持 helper 使用标记，需明确其桌面 UI 入口范围，并独立保留 `src/main/launcher-gate.test.js` 的 cold-start gate 行为检查；不能称其覆盖所有普通启动路径。

**当前停止位置：**已直接观察到隐藏文档、未推进的网格动画与截图错误，尚未证明 native `ready-to-show` 未显示的具体原因。狭窄工具带 main inspector，root 的真实标准 soak 带 remote debugging 且观察到可见文档，两者差异尚未受控；没有 HEAD26205 的真实 UI 对照，不能宣称基线也失败、性能改动未回归或 helper 已修复。没有关闭产品 backgroundThrottling、取消动画、放宽零宽断言、构造新 reveal 抽象或以未显示文档判通过。组合 UI 验收仍失败并缺完整画面。

### T11 长历史输入链路的只读诊断（未采用产品修复）

复用 spec 代理保存的 `performance-history-24-measurements.json` 和 `performance-history-500-measurements.json`：两场后台均 seed 同一个完整 500 轮历史、同 replay/10M context、8 次续写和两次工具，区别为 UI 已加载 24 或 500 轮。500 场 `clickToUserEchoMs` 的 1254–3605ms 是 Node 起表→Playwright Send.click（含定位/actionability）→全页 getByText.waitFor 返回；不是浏览器点击事件→DOM 或绘制。fill 窗也包含 fill、两次 textContent 和 poll。不能把这些数字直接写成真实用户回显卡顿或性能回归。v6 未采历史宿主 CPU，另有一个自有 PiP 诊断实例并行；没有 CPU 隔离证据。

规模关联主要集中在样式和 DevTools：24→500 的初始 DOM nodes 为 4047→44978，8 次续写分别增加 599/598 nodes。相同 698 字符的前七次 fill，24 场 Script=3.7–10.0ms、Style=4.4–22.8ms、DevTools=5.9–7.8ms；500 场 Script=4.1–12.2ms、Style=279.2–443.0ms、DevTools=65.1–111.0ms。stream mutation 批次与记录基本相同。当前不能据此认定输入会重放整段日志、全历史重渲染或内存泄漏。

当前源码已读到的候选与已有机制：

- `ui-conversation/src/client/skeleton/ConversationContent.tsx:63–76` 的一个 ResizeObserver 同时观察 composer seat 与 scroller，回调读取 offsetHeight/clientHeight，并在包含完整历史的 scroller 上写两个继承 CSS 变量。当前实际消费者是 `ui-chat/TurnNavigator.module.css:27`、`ui-chat/ChatView.module.css:255` 和 `ui-trajectory/views.module.css:29`。它是样式失效的具体候选，但没有可用 trace 证明耗时归属于该回调；相同值的 setProperty 是否被 Chromium 本身消除也未测量，不能只加重复值 guard 就宣称收益。
- `ConversationContent.tsx:42,227,355` 订阅完整 inputState、构造 zone 并渲染 Views；草稿变化会触发该函数。`DefaultConversationViews` 订阅会话/视图，`ChatView.tsx:67` 的列表与 `ChatNodeSeat.tsx:45` 的逐节点座位已有 memo 和稳定 keyed source。是否因槽位/prop 变化导致额外历史工作，需要 React/CPU stack，不能仅看到 memo 就认为无问题，也不能仅看到 inputState 就断言全历史重渲染。
- `input/facade.ts:190–209` 的编辑提交刷新 composer 自己的投影，selection-only commit 不推进内容 revision；`facade.ts:950–957` 发布 inputState，只有草稿实际变化才调用持久 writer。`conversation/assembler.ts:251` 已有 append 增量路径，replaceWindow 和 prepend 分别负责替换/历史。未看到每次键入直接调用历史日志重放的链路。
- `ui-chat/use-chat-viewport.ts:67–75` 观察 column/scroller/composer 后重新测量；可见 turn 的 DOM 几何读取已有二分（:218–243）与 landing 命中缓存，不是每次全列表逐行测量。精确 anchor 查找（:151–159）仍收集完整可见锚点，触发频次与实际占比未采样。

root 授权一次最小诊断后，在 TEMP `whale-history-trace-284beb17-1fa7-4a85-a0bb-6bfcd3af0377` 用 Vite 内存 transform 复用现有私有 fixture、registration、500 seed/load 和当前 locator，仅安排一次 698 字符 fill/send；未编辑产品、测试或增加 exports、未 build。预期同时记录 Tracing 样式失效、CPU profile、现有 browser click→DOM/2rAF probe，以及两 CSS 变量写入 stack。该次 **诊断失败，exit 1**：日志最终为 replay 的 `1 recorded script(s) never bound`，清理覆盖了首个异常，没有 result/trace/CPU 文件。新增 page.evaluate 使用裸 `performance`，与顶部 Node `performance` import 存在具体编译绑定风险；首层异常没有捕获，不能把此推断写成已证根因。原 fixture teardown 断言未弱化。

依照“新工具准备错误停止”约束，没有修工具后重跑，也没有据此改 CSS、memo、历史加载或消息内容。观察后没有此轮启动时段的残存 Chrome，也无含本诊断 UUID 的 Node 进程；未杀任何进程。T11 当前仅有规模相关的性能机会与计时定义更正，**无可最小修复热点的因果证据，因此本项不采用产品变更**。完整内容、查找、选择、prepend、折叠和原节拍均保持；未知原生显示问题另行冻结。

root 随后明确授权一次修正后的不同实验：TEMP 中新增浏览器回调一律使用 `globalThis.performance`（与现有 probe 同写法，静态确认不引用 Node 同名导入）；复用 v6 catch→收集主错误→finally 收集 cleanup→最后 throw 的模式，确保 browser.close 在 world 清理异常时仍被调用。未改 fixture/locator/exports，仍只展开 500 轮并安排 1 次 fill/send。该次 02:44:04 开始、84.85s 后 **exit 1**，`corrected-run.log` 保存主错误：原 `getByText('LONG_CONTINUATION_USER_1').last().waitFor` 等待 visible 超过 15000ms；未由 replay 清理覆盖。这说明执行进入发送/定位阶段，但没有失败当下 DOM/事件证据，不能将定位超时直接等同于产品未回显，也不能据此归因祖先变量写入。

失败发生在 `continueConversation` 返回前，预定完成时写入的 result、CPU profile、trace 文件均未生成。本次追踪没有形成因果证据；没有新搭工具、重复同一负载、修改断言或产品。因此最终结论保持：T11 的计时窗口已更正，完整 500 场本身通过与诊断阻塞分别记录，源码机会保留 profile gate，本轮不采用未经证实的长历史产品修改。
