# Android 原生客户端 QA：2026-10-26

替换后的 Android 16 真机已成功调试安装，并实际完成公网配对、文字/图片对话、真实审批拒绝/允许、跨会话返回审批、排队发送、停止、重命名、全文搜索和 Fork。最终候选按用户要求固定竖屏，已保留数据覆盖安装，设备运行时确认portrait；用户停止现正确显示“已停止”。真机另完成新目录登记、模型切换、归档/恢复/删除、本地Git分支/提交，以及1/2倍字体的正常竖屏键盘编辑。后续继续完成本机裸仓Publish/Pull/Commit & Push，修复表格、数学、代码横滚和配对键盘裁切；当前r2包已保留数据安装，冷启1253ms，深浅主题表格与公式、代码读到END及原生短消息回复已真机核对。本轮App末次45项通过；协议15项与定向Node33项沿用此前有效结果，未在富文本末轮重跑。两种debug身份构建成功，lint **0 error / 17 warning**。API26 补充测试与 Android15 旧机安装失败分开记录。全量边界及桌面已有差异仍有未覆盖项，不据此宣称全部功能通过。

报告汇总 android-state 的源码与 JVM 回归、android-ui 的模拟器和替换真机 UI 操作，以及 lead 的构建、安装和真实业务执行记录。每项按实际执行环境与证据归属记录，未做内存压测。原始静态审计中的候选与旧行号不代表最终代码仍有相同问题，处置以本报告和修订审查为准。

## 设备、安装与实际测试边界

| 环境 | 本轮事实 | 验收边界 |
| --- | --- | --- |
| 物理机 `23124RN87C`，Android 15，ADB `9TUCYX8TBI6DLRMZ` | MIUI/HyperOS 的“USB 安装”开关仍关闭；尝试开启提示“请先插入 SIM 卡”，双 SIM 均 `ABSENT`；`adb install` 与 `pm install` 返回 `INSTALL_FAILED_USER_RESTRICTED`。见[实际开关画面](evidence/25-usb-install-toggle.png)。 | 本轮 APK **未安装**；保留原 0.1.1 应用及数据，未卸载、清数据或绕过系统认证。标准包签名也不能据此视作可覆盖旧包。真机功能/布局/升级均未通过。 |
| 替换物理机 `23127PN0CC`，Android16/API36，ADB `1836e17d` | 1200×2670，density480，约400dp；SIM可用，ADB首次系统拒绝后成功新装 QA 包，1055ms冷启；当前r2竖屏包 `install -r -t` 成功，1253ms冷启，配对/草稿保留。 | 初装与同debug身份覆盖均真实执行；不代表正式包签名升级、旧Web迁移、全部硬件和极端边界通过。 |
| 隔离模拟器 `emulator-5580`，Android 8 / API 26 | 1080×1920，density 480，竖屏约 360dp；安装包 `ai.deepseek.harness.mobile.nativeqa`，Activity 为 `ai.deepseek.harness.mobile.MainActivity`；最新 QA 包 `install -r` 成功。 | 属补充实跑，不能替代 Android 15、硬件相机、其它密度/宽高或正式包覆盖升级。UI 字体重点为 1.3/2.0，未完成全部字号/输入法/导航组合。 |
| UI 前阶段 | 使用保存的公网 Ayase 配对，连接已有 source 3181；仅新建 QA 会话，原只读会话仅查看。 | 旧宿主不支持最新 flat 子智能体地址，不能用它认证新地址。部分早期截图在 tight-IME 补修前。 |
| lead 当前源码隔离桌面 | 独立 Electron userData；Harness 53876、daemon 53878，与既有 3080/3181 分开。Android 重新配对当前源码宿主；实际 Gateway、host tunnel 与公网中继参与请求。 | 当前源码宿主配合已有 Web 产物运行；完整桌面重建另有失败，见构建节。 |
| 业务写入范围 | 本轮新会话及仓库外专用 `C:/AI/WhaleIsle-AndroidQA-20261026`；Git 作者仅对该临时仓设置 `--local`。 | 未向原有用户会话发送测试消息，未在产品仓做Git写操作；只Publish/Push到本机专用裸仓，没有向外部仓库发布测试内容。repo 内 `.tmp` 目录可向上找到产品仓，未用它冒充独立非仓目录。 |

## 构建、检查与可定位产物

早期产品源码提交为 `8899d0f147`；后续本分支追加真机重连表单、停止文案与固定竖屏修复。Android 当前配置为 versionName `0.3.10`、versionCode `4`、minSdk `26`、target/compileSdk `36`。standard 与 nativeqa 为同源码的两个身份；安装 nativeqa 不等于正式包升级。

| 产物 | SHA-256 | 本轮设备状态 |
| --- | --- | --- |
| 当前标准debug APK `WhaleIsle-0.3.10-debug-portrait-richtext-r2.apk`，包名 `ai.deepseek.harness.mobile` | `82A1C4A43D5D09B63135418E3F4408C801ECBA87AF79B00A48D8BFB97DDAAA7B` | 构建完成；真机仍使用隔离身份，没有覆盖原正式包。 |
| 当前隔离QA APK `portrait-richtext-nativeqa-r2.apk`，包名 `ai.deepseek.harness.mobile.nativeqa` | `4A756ED75A019729F5AB8BF8971CE58CBCDF48C1DF1A9E528EEEB426F19CF6C3` | Android16保留数据覆盖成功、冷启动1253ms；Activity运行请求portrait。 |
| 早期隔离 QA APK `fixed-nativeqa.apk` | `04CA34D91EA700472453C705645217159C0CD01F8FF5819151A01046B5691C86` | API26与Android16早期业务/主题/扫码；这些早期截图不认证后续修复。 |

APK为本机运行产物，未提交到Git；lead核对exact文件摘要、debug签名、Manifest和真机安装。早期04CA包完成消息/审批/Queue/Stop等业务，4389包补做真实重连/目录/CRUD/Git/键盘，9881包加入目录同步旁路保护后覆盖安装并执行保存配对、Plan关闭和Markdown请求；其后6259包修复富文本/配对键盘，发现表格空白后r2修正并再次安装。没有把早期截图全部认证为当前包重跑。[前一竖屏收尾](portrait-final-results.md)保留历史，[富文本与键盘续测](portrait-richtext-followup.md)记录当前r2与精确摘要。

| 检查 | 实际结果 | 证据/不能推导的结论 |
| --- | --- | --- |
| App JVM / protocol | **App末轮45项通过**（Remote29、基础VM3、NativeChatState8、NativeMarkdown5），0 failure/error/skipped；协议15项沿用此前有效执行，本轮富文本未重新运行。 | [r2构建/回归摘要](evidence/richtext-r2-build-summary.json)；此前[40+15汇总](evidence/recovery-jvm-results.json)。原r2逐suite XML未单独快照，后来取消的实验覆盖XML，不将其时间归r2；原r2任务成功输出与当时读取的19:10:56结果有效。受控测试不是手机E2E。 |
| `:app:assembleDebug` | standard 与 nativeqa 构建成功。 | 前期lead执行，富文本/r2由android-state执行，lead核对身份/签名并安装；未认证release、生产签名兼容或旧Web数据迁移。 |
| `:app:lintDebug` | **0 error / 17 warning**，另有信息项。 | [富文本lint文本](evidence/richtext-lint-results-debug.txt)。旧13项外，新增4条表格物理LEFT/RIGHT对齐的RtlHardcoded重复提示；固定竖屏的两条提示按用户要求保留，不是零警告。 |
| host tunnel / daemon hooks / mux 定向 Node | **33/33 通过**（lead 执行记录）。 | 覆盖真实 Remote payload 适配、flat durable address/游标纠正、审批重放/解决等，不等于整个 desktop 或全部 Web 测试。 |
| 真实 Gateway mux | 收到 `session/projection`。 | [真实 mux 结果](evidence/real-mux-results.json)；不是审批事件通过。 |
| 真实子智能体历史 | 当前 host tunnel 用直接父/子地址读取 **252 events**，`hasMore:false`。 | [真实 child-history 结果](evidence/real-child-history-results.json)；只读，无 child prompt/树形目录验收。 |
| 当前源码隔离 Electron + 模型 | 启动后短桌面模型请求收到 `ANDROID_QA_READY_20261026`。 | [lead E2E 记录](e2e-lead.md)；不能扩张为全桌面构建成功。 |
| 完整 desktop 预启动重建 | **未通过**：client bundle 原生进程退出码 `3221226505`，Web 阶段未执行。 | 使用已有 Web 产物运行，未修改 vendor 源掩盖此失败。首次 daemon 重启 30s 未 ready，之后重新启动恢复 ready/relayConnected；未增加产品重试代码，未宣称一次启动必成。 |

## 本轮代码修复及证据层级

| 问题/修复 | 当前行为及验证边界 |
| --- | --- |
| 新建/登记与跨电脑状态归属（B04、Q01） | 先正确保存旧会话图片草稿再打开新 ID；切电脑/离开清目录；媒体结果按 owner 校验。VM 回归覆盖两种创建入口、电脑切换和迟到结果；模拟器实际新建无目录/已有工作区，未逐一故障注入。 |
| 连接与前台恢复（B06/B07） | 先订阅 mux 再同步目录；首次目录失败可恢复；成功认证后掉线用保存secret恢复原选择/草稿；同电脑同会话的非Git任务面板、路径与输入保留，目录/模型/权限同步完前禁止远端提交，失败有重试；认证拒绝停止自动重试。已连接前台恢复只刷新目录/历史，保留 Browse/Search/Git review；VM 受控回归通过。实际配对与保存设备重连成功，不把所有断网/后台组合记为通过。 |
| 权限、Plan、模型加载归属（B08/B09） | 切会话清旧值，待 history/projections 及普通会话目录加载完解除 loading；UI/VM 阻止加载期间写动作；新模型明确无 effort 会清旧值。VM 及 helper 回归通过；模拟器另实际选择 Low、切 read-only、Plan on/off。 |
| 审批关联（B03） | 按 session/approval 保留 Gateway client/event 回复路由；history-only 无路由时禁用；共享 mux 重放待处理审批、成功 respond 后广播 resolved，旧连接/来源切换不复活已解决项。JVM/Node通过；Android16随后真实完成两次Gateway裁决（拒绝无文件、允许一次有文件），并实际切B再回A保留审批。见新机增补。 |
| 非仓 Git 与异步归属（B01/B05） | `isRepo:false` 时不先要求 branches/entries 成功；迟到 Git 结果检查连接/session/revision/cwd/panel。VM 回归通过；模拟器在仓库外目录实际 init 成功。 |
| 持久化图片（B02、R1/R2） | 消费 durable `attachmentId`，按当前会话经 `session.attachment` 读取；逐图成功立即显示，失败独立占位和可读错误，继续后续项，取消不被吞。缓存仅当前打开会话持有，切换取消并清理，在途 Deferred 完成即 finally 移除。混合好坏图/取消/轮询不重读回归通过；真实好图发送、历史 attachmentId 对账成功。**不是 LRU/总字节预算，也未做内存压测**；当前已加载历史可随分页增长。见[修订审查](code-review.md)。 |
| 子智能体历史 | 保留 origin/parent ID；`session.history` 使用 flat `address:{kind:"subagent",parentSessionId,childSessionId,mode:"unknown"}`；host 严格校验并保留翻页/游标地址。child 只读且跳过 commands/models，projections 按 child ID 读取合法；普通 Fork 有 parent 仍可写。VM/host 回归及真实 child 历史通过，未实现树布局。 |
| 布局与恢复（Q02–Q08/Q15/Q20） | 真实 tail anchor、按剩余高度分配 composer/approval、最小高度顶栏、连接/扫码限宽、系统栏/Markdown 主题、任务表单 rememberSaveable。横屏 IME 将正文压成细线在 API 26 实际复现，补修后 font1.3/2 可读至少一行；其它长审批/分页/TalkBack 仍未验收。 |

## API26早期业务与界面观察

Android 发出短请求后得到 `ANDROID_QA_20261026`，并清空已提交草稿。自动化填框误用 Ctrl+A 曾在原请求前产生 `aa`；host 与 Android 记录一致，实际文本为 `aaReply only ANDROID_QA_20261026. Do not use tools.`，没有把这个工具错误写成产品串改。系统 GetContent 选择测试 PNG 后原生缩略图可见，发送图文请求后得到 `IMAGE_QA_RECEIVED`，历史用户气泡可回显。这里是两次实际 prompt（一次短文本、一次图文），不是两个场景各完整五轮；运行中 Stop/queue 仅被看见，未点击验证。

[最终 Android/host 对账](evidence/android-e2e-results.json) 为 `ok:true`、28 events、`firstReply:true`、`imageReply:true`；持久化 ID 为 `sha256:ce41275f9fd78520adfe028985a22ce864c0679b892c2ef6e5eb7e274ad27e16`。该结果由当前 host helper 与隔离源码桌面读取，不是 FakeRelay echo。可见证据：[当前源码配对后 ready](evidence/emu-e2e-09-owned-ready.png)、[短回复](evidence/emu-e2e-13-owned-reply.png)、[选图后草稿](evidence/emu-e2e-20-image-draft.png)、[图文回复及历史图](evidence/emu-e2e-22-image-reply.png)。没有完成桌面发图、冷重启附件、多格式/多图/损坏图的设备实跑。

在 `C:/AI/WhaleIsle-AndroidQA-20261026`，Android 打开[非仓 Git 页](evidence/emu-e2e-14-git-nonrepo.png)，实际 Initialize 后返回完成，lead 只读确认新 `.git` 在该临时目录，初态 `No commits yet on main`。Android 创建并切换 `android-qa-branch` 成功；第一次 Commit 因无作者出现 `Author identity unknown`，保留表单/所选项并能继续操作（[错误步骤](evidence/emu-e2e-31-git-commit-request.png)）。lead 仅为该仓本地设置 QA 作者后，Android 再提交成功（[完成](evidence/emu-e2e-33-git-commit-retried.png)）；lead 核实 commit `3397a7b`、说明 `Android native QA local commit`、status clean。没有执行 push、publish、pull、PR/MR、远端跟踪或完整 stack。

权限 picker 实际从 workspace-write 改为“仅可查看”，等待 RPC/投影返回后，[最终图 35](evidence/emu-e2e-35-permission-final.png)显示“切换权限：仅可查看”；先前图 34 尚为旧值，不能作为成功证据。composer 输入 `/plan` 实际走命令后，[图 38](evidence/emu-e2e-38-plan-final.png)出现 Plan chip，host 投影 `active:true`；点击 chip 关闭后，[图 40](evidence/emu-e2e-40-plan-off-final.png)不再显示，host 投影 `active:false,pending:false`。权限仍为 read-only。这只证明该方向权限更改与 `/plan` 启停，不涵盖全三态、所有 slash 或双端更改。

横屏长草稿 + IME + font1.3 曾实际只剩细线（[补修前](evidence/emu-ui-04-landscape-ime-long.png)）。最新包隐藏紧凑高度下的 host 次行、压缩纵向 padding，正文最小高度取 `minOf(24sp 换算高度, editableHeight)`，受实际剩余空间限幅，并保留 48dp 操作轨；本机以下场景实际可读一行，不是对任意高度的一行保证：[font1.3 补修后](evidence/emu-ui-45-latest-font13-landscape-ime.png)、[font2 补修后](evidence/emu-ui-46-latest-font2-landscape-ime.png)以及[实际插入文字/光标](evidence/emu-ui-52-latest-font13-end-edit.png)可见。图 52 是当前可见文字中插入 `END_QA`，不是“验证文档末尾”；未独立逐行首尾滚动。模型层往返及旋转保留草稿；设置[浅色](evidence/emu-ui-18-settings-light.png)、font2 [浅色设置](evidence/emu-ui-24-font2-settings.png)/[深色设置](evidence/emu-ui-25-font2-settings-dark.png)实际切换，系统栏有对比。另有[侧栏](evidence/emu-ui-28-drawer.png)、[查询词旋转](evidence/emu-ui-34-search-rotated.png)、[重命名草稿旋转](evidence/emu-ui-41-rename-rotated.png)；后两者没有提交全文搜索/重命名。

仍见限制：紧凑视口主要一行；font2 横屏空态欢迎语部分裁切；API26 font2 系统时钟下沿裁切属于系统区。lead 最终 font1 也实际查看可读且未崩，已归档截图41；抽查 logcat 未见 AndroidRuntime 错误，不表示全时段无崩溃。没有覆盖 320dp、不同 density、全部输入法、三键/手势组合、长审批及真人 TalkBack。不能把单个可用截图推及所有小高度布局。

## API26与早期安装阶段F01–F42执行矩阵

沿用[初始功能审计](function-audit.md)的 42 个 ID，不继承历史 Web 或旧 WebView 版本的 Pass。**部分实跑**仅表示本行的指定子路径真实执行；**static**表示源码/受控自动回归有依据，但该完整设备路径未跑；**未跑**表示本轮无该业务执行。无一行代表整行所有边界全通过；物理Android15仍未验证，替换Android16结果见下方新机矩阵。

| ID | 功能 | 本轮状态 | 已有证据 / 未完成范围 |
| --- | --- | --- | --- |
| F01 | 安装/升级/冷启 | 部分实跑；真机阻塞 | API26 nativeqa 覆盖安装、保存资料冷启；物理机未装当前包，同签升级/旧 Web 迁移/中断恢复未跑。 |
| F02 | offer 解析 | 部分实跑 + JVM | 当前 offer 真实配对；Offer 7/PairingIntent 4 自动回归。畸形/过期等未逐项设备操作。 |
| F03 | 原生扫码 | 未跑 | 相机权限/拒绝/无后摄/torch/迟到解码释放均未跑；静态 B12 仍是待确认风险。 |
| F04 | 系统 VIEW handoff | 部分实跑 + JVM | lead 实际通过配对 intent 冷/热启进入；PairingIntent JVM 有覆盖。非法/缺 fragment、配置重建全部组合及 App 内真实扫码差异未全验收。 |
| F05 | 认证/E2EE | 部分实跑 + JVM | 公网首配、保存设备恢复实际成功，interop/lifecycle 回归通过；真实坏 secret/重放/撤销全组合未跑。 |
| F06 | 已保存电脑 | 部分实跑 | 保存连接及切到隔离宿主；忘记、断开后冷启语义、多台坏记录/写盘失败未验收。 |
| F07 | 首连失败恢复 | static | VM 覆盖首次目录失败仍订阅/后续恢复、初连失败不自动循环；真实超时/存储失败故障注入未跑。 |
| F08 | 断线恢复 | 部分实跑 + JVM | 保存资料重新连接、实际宿主恢复有观察；同网前台强制短断、换网络/锁屏与真实认证撤销未完整实跑。 |
| F09 | 生命周期 | 部分实跑 | 旋转、主题、短层往返、覆盖安装冷启，草稿/查询/改名字段保留；进程强杀/相机生命周期全组合未跑。 |
| F10 | Harness 状态 | 部分实跑 + static | 实际 daemon 首次未 ready 后恢复；目录故障/空态等主要为 VM 回归，未全 UI 故障注入。 |
| F11 | 目录全集/筛选 | 部分实跑 + static | 实际侧栏/工作区可见；集合规则、child 保留有回归，未按全 ID 集合对比 blank/孤儿/归档缺失全部边界。 |
| F12 | 分组/层级/顺序 | 部分实跑；parity 缺口 | 侧栏分组可见，真实 child history 读取成功；未实现父下折叠树/平铺/头部独立 +，未全量对照桌面顺序。 |
| F13 | 列表反向同步 | 部分实跑 | 实际 Gateway 改名收到 session/projection；未逐项完成 Android 当前另一会话下的删除/归档/运行全状态。 |
| F14 | 行菜单 | 部分实跑（表单） | 菜单、改名草稿旋转保留；未提交 Rename/Fork/排序，不将打开弹层记为 host 写成功。 |
| F15 | 归档/恢复/删除 | 未跑；static 差异 | 无真实归档/恢复/永久删除；默认折叠分区、归档行不打开等合同差异仍在。 |
| F16 | 新会话 | 部分实跑 + JVM | 无目录及已登记 repo 外 QA 工作区创建成功；New/Register 图片归属受控测试通过；blank 复用/首条前改 cwd 未实现或未验收。 |
| F17 | 目录浏览 | static | 起点/crumbs/盘符/慢盘/错误/迟到归属未实际浏览；Browse 前台恢复有 VM 回归，不等于浏览业务通过。 |
| F18 | 新目录/登记 | static | VM 创建/登记与附件隔离回归；本轮工作区由 lead 准备，不算 Android 完整 createDirectory→workspace→session 实跑。 |
| F19 | 搜索 | 部分实跑（本地/UI） | 输入查询、本地无匹配与旋转保留；未提交全文 session.search，也未测 >20/hasMore/连续改词。 |
| F20 | 打开会话/历史 | 部分实跑 + JVM | 当前源码宿主真实历史/回复与只读 child 历史；加载归属/控制重置有回归；全部失败/快速 A-B 设备竞态未跑。 |
| F21 | 历史分页 | static | merge/去重与 child older payload 有回归；设备多页锚点、分页时直播追加未跑，252 events 读取不等于翻页 UI 通过。 |
| F22 | 发送/多轮 | 部分实跑 | 一次短文本和一次图文均真实回复、host 对账；未完成旧仓/新目录各五轮、纯图/双击/编辑中发送全组合。 |
| F23 | 直播/结束/停止 | 部分实跑 | sending/running 到最终回复可见；Stop/queue 按钮仅见未点，长流增量/取消/max-tokens 未验收。 |
| F24 | 提交未知结果 | 未跑；static 风险 | 未模拟接收后 ACK 丢失。B10 requestId/重发重复入队风险未宣称已修或通过。 |
| F25 | 模型/思考 | 部分实跑 + JVM | 模型层进入 Low 并回显，当前宿主 GPT6.1 Low 可见，缺 effort 清旧值有回归；多 provider/不可路由/无匹配全组合未跑。 |
| F26 | 权限 | 部分实跑 | workspace-write→read-only 实际生效，最终图35；非全部三态/双向/写命令策略。加载态有受控回归。 |
| F27 | Plan/斜杠 | 部分实跑 | composer `/plan` 启用与 chip 关闭，图38/40和 host 投影对账；未遍历 slash、未知命令、带图或审批组合。 |
| F28 | Queue | 未跑；parity 缺口 | 运行时按钮可见未点击；真实 queue items 展示/编辑/移除/steer/updateQueue 未接。 |
| F29 | 草稿/附件归属 | 部分实跑 + JVM | 长草稿旋转/短层往返实测；A/B/电脑/New/Register/迟到媒体归属有受控回归；强杀后附件恢复未认证。 |
| F30 | 相册/拍照 | 部分实跑 | 系统 GetContent PNG→预览→发送；取消来源层保留草稿。拍照、权限拒绝、其它格式/损坏/10MB 边界未跑。 |
| F31 | 附件历史/预览 | 部分实跑 + JVM | 手机发图、durable attachmentId、当前 helper 回读与回复对账；混合坏图/取消有回归。桌面发图/重启/跨页/unauthorized 设备用例、lightbox 未通过。 |
| F32 | 审批 | 未跑；JVM/Node | 真实写文件尝试被 sandbox 直接 denied，55s 无 Gateway approval event；没有 approve/reject 成功。路由/跨会话/重放/获胜清理为自动回归。 |
| F33 | Git 初始/授权 | 部分实跑 + JVM | repo 外非仓入口实际 init 成功、Git 所在位置核对；迟到 A/B 有回归，detached/授权失败等未设备跑。 |
| F34 | Git 分支 | 部分实跑 | 实际创建并切换 android-qa-branch（初始 unborn）；重复/非法名、远端 tracking、双端切换未跑。 |
| F35 | Git Commit | 部分实跑 | 缺作者错误保留表单→仅临时仓 local author→Android 成功提交3397a7b/status clean；精确多路径排除/生成说明等未全跑。 |
| F36 | Git Stack | static | 已有归属/审阅/前台保持回归；无真实 push→PR 或中途失败重试全链路。 |
| F37 | Git 同步/默认分支 | 未跑；parity 缺口 | ahead/behind/diverged/默认三选择、桌面改分支页内同步未跑；桌面 resolveGitQuick/状态摘要未对齐。 |
| F38 | Publish/View PR | 未跑 | 未发布/Push，未创建或打开 PR/MR；无远端授权夹具，不据按钮存在判通过。 |
| F39 | 设置/主题 | 部分实跑 | 1.3/2 字体下明暗切换、系统栏与草稿保留；system 联动/忘记/退出/完整 Hub 缺页未验收。 |
| F40 | 只读/冻结/NEVER | 部分实跑 + static | 只读提示可见，child 真实历史及受控防写；Files/Diff/MCP/技能仅说明，非移动能力通过；未逐条尝试全部受限接口。 |
| F41 | 文本/Markdown/工具 | 部分实跑（普通文本/图） | 普通回答、图文可读；复杂表格/数学/代码横滚/工具详情、安全 scheme 链接与可复制性未完整实测。 |
| F42 | 多端并行 | 部分实跑（局部对账） | host/Android 用户原文、两回复、图片 ID，真实 mux 与 child 历史对账；桌面+Web+原生并行写/审批/归档全状态未验收。 |

## 仍需保留的 parity 差异与风险

以下来自[功能审计](function-audit.md)、[布局审计](layout-audit.md)及[修订审查](code-review.md)，不把既有缺口包装成新回归，也不把静态候选当实测故障。

- **Git 与会话导航**：没有桌面顶栏快速主动作、ahead/behind/脏态摘要及完整 resolveGitQuick 禁用表；页内操作后/桌面切分支缺自动快照同步；默认分支新分支选择有输入前置；child 虽地址正确仍无树/标记/父下折叠；列表无完整平铺及工作区头独立 +，移动端点控制未对齐；归档未完整遵守独立默认折叠、点击不打开等合同。
- **新建、目录与搜索**：首条前工作区chip/blank复用未对齐；目录起点不是登记目录父级；正文搜索、新目录登记已真机完成，cap20/hasMore/全部筛选仍未完整覆盖。搜索/浏览迟到归属本轮加session/panel revision回归，未设备全竞态注入。
- **对话与富内容**：真实 Queue 管理尚未接；长草稿阅读收起、图片lightbox未齐；9881包表格/数学/长代码差距已在r2定向修复并真机复测，其余图示/Markdown图片/交互内容未完整验收。Generative UI 引导到电脑，未知类型诚实占位，不算支持。Files/Diff/MCP/技能是冻结说明；消息 edit/rewind、Trajectory、Context meter、日志/终端等 DEFER/NEVER 范围不能当完成项；禁止 Stage/Unstage/Discard、任意 shell、凭据/MCP 写等仍需保持边界。
- **失败语义与硬件**：B10 接收成功但 ACK 丢失后重发可能重复，未故障注入/未修；B11 “断开”与忘记本机配对语义不等同，冷启行为未验收；B12 无后摄/CameraX 失败/退出迟到绑定及可选电脑名写盘失败仍是待测候选。链接 scheme 安全需设备验证，不能凭 Markwon 默认行为声称安全通过或已存在漏洞。
- **设置、连接与布局**：设置 Hub 仅主题/电脑，连接详情/通用/关于及 endpoint/独立忘记入口未齐；首次连接/目录失败、长错误提示与空态区分仍需完整UI走查；竖屏1/2倍字体normaldockedIME已实测，多行草稿/发送轨可达；极紧凑高度编辑当前主要一行，极小高度、长审批、短弹层按钮换行、焦点/Back/TalkBack、320dp/平板/其它密度未通过。系统栏和 Markdown 主题修复不等于全部富文本一致。
- **资源与平台**：R1/R2 已关闭，但当前会话多页图片可增长，没有字节上限/LRU/内存压力测试；API26通过不能覆盖Android15；Android16的局部实跑也不能覆盖所有Android版本。正式签名升级、旧 Web 迁移 instrumentation、生产包、真实拍照和QR识码未认证；本地完整桌面重建失败仍保留，前一521cc提交Windows CI构建已成功，不互相覆盖。

早期一次审批尝试直接被sandbox拒绝，未产生Gateway事件；之后Android16在read-only+ask下按系统要求exact operation携单次workspace-write升级，真实形成两个Gateway审批并裁决，未更改全局策略。UI 自动化中同名标题误点、selector/content-desc 不匹配、控制键/空参数与超时等失败已由执行人保留，不计作成功产品动作。上述负向结果同样属于本轮交付事实。

## 证据索引与后续验收

本报告引用精选截图；lead 将 UI/E2E PNG、XML 和动作流水归档在本目录 `evidence/`，未把配对 offer、secret、Cookie、credentials 或原有用户完整历史纳入报告。下列静态/执行报告位于本目录，非敏感 JSON 与 lint 文本位于 `evidence/`；原始来源为本轮临时执行工作区，报告编写者仅消费，不替执行人补造结果。

- [初始功能审计与42矩阵](function-audit.md)、[布局静态审计](layout-audit.md)：先期只读，里面“全部未执行”和旧缺陷是当时状态，不覆盖本报告后续实跑/处置。
- [API26 UI 执行与截图边界](emulator-ui-results.md)、[lead 业务/宿主 E2E](e2e-lead.md)、[R1/R2 修订审查](code-review.md)。lead 后续权限35、Plan38/40与 commit3397a7b 补充直接纳入本报告；早期记录未写到的步骤不能反向变成未执行。
- [早期JVM汇总](evidence/jvm-results.json)、[早期lint0/11](evidence/lint-results-debug.txt)；最终[App40+协议15结果](evidence/recovery-jvm-results.json)、[lint0/13](evidence/portrait-lint-results-debug.txt)、[Android/host 最终对账](evidence/android-e2e-results.json)、[真实 child 历史](evidence/real-child-history-results.json)、[真实 mux](evidence/real-mux-results.json)。

替换手机后安装阻塞已解除，审批跨会话、停止/Queue与正文搜索已有真机结果。仍需保留长历史/坏图、多端竞争、实际QR解码、远端Git、正式签名升级和未执行的全部边界。当前修复供PR审查，**不把部分实跑自动提升为全轨Pass**。


## Android16替换真机执行与F01–F42增补

本节补充替换手机真实执行，早期Android15失败与API26结果保留。最终竖屏包已实际覆盖安装并在运行时请求portrait，已停止文案也已在真机复核；最终重连保表单和目录/CRUD结果由下方收尾记录补充。

### 设备、包与执行边界

| 项目 | 可证实事实 | 边界 |
| --- | --- | --- |
| 新物理机 | serial `1836e17d`，model `23127PN0CC`，Android 16/API36，1200×2670，density480，约400dp。 | 与原 Android15/no-SIM 安装受阻设备分开记录；不反向抹掉旧失败。 |
| 首次安装/冷启 | [安装结果](evidence/newphone-install-results.json)：nativeqa `ai.deepseek.harness.mobile.nativeqa`，versionCode4/name0.3.10、DEBUGGABLE、min26/target36；首次系统拒绝，第二次 ADB 返回 Success；COLD/Status ok/1055ms，落地页可见。早期实跑包 SHA-256 `04CA34D91EA700472453C705645217159C0CD01F8FF5819151A01046B5691C86`。 | 此手机原无同名 QA 包，证明新装，不证明正式包同签覆盖升级或旧 Web 迁移。摘要只对应安装记录中的早期包；后续重建不得继承该摘要。 |
| 隔离宿主 | 当前源码隔离 Electron/Harness53876/CDP53877/daemon53878，真实公网 relay；保存配对通过 VIEW intent 连入，已有文本与 attachmentId 历史可见。 | 未改用户既有3080/3181，不向原有用户会话发送测试消息。 |
| 操作范围 | repo 外专用 QA 工作区 `C:/AI/WhaleIsle-AndroidQA-20261026`；普通 QA 会话内实际手机 Send/菜单/审批/Queue/Stop。 | 填框使用独立 self-target instrumentation ACTION_SET_TEXT；手机真实按钮发起操作，没有以 host RPC 冒充手机 Send。 |
| 输入/锁屏 | WeType 将 ADB input text 转为拼音 composition，损坏草稿未发送，未改默认输入法。用户物理解锁后继续，未输入/尝试 PIN。 | 不把自动化输入局限记为产品串改；helper 并非通用 IME 验收。 |
| 系统恢复 | 原 font_scale1.0、auto rotation0、user_rotation0、night no；lead 临时 USB 常亮，原 `stay_on_while_plugged_in=15`。 | 首个 UI 窗口恢复读数已记录；后续 lead 又改字体/主题与扫码权限，最终恢复须由 lead 收尾，不沿用早期恢复读数。 |

### 已执行的业务与必要对账

[功能摘要](evidence/newphone-functional-summary.json)记录主会话 `session-ed28c351-49f1-40ae-a7f2-5ea79168e295` 共 **9 个 user turn**。这包括审批与停止测试，不等于两种工作区各五轮全部成功。以下六个助手 marker 的 `replyCount` 均为 **1**，不能按 raw history 中 wire/message/event 多种表示的文本命中数计重复回复。

| marker | 已验证路径 |
| --- | --- |
| `PHYS_QA_ONE` | 第一次手机原生短文本 Send，host 用户文本与返回对账。 |
| `PHYS_QA_TWO` | 第二次手机短文本 Send；随后以该正文做实际全文搜索。 |
| `PHYS_IMAGE_OK` | 系统 GetContent 选专用测试 PNG，原生预览、手机 Send、模型回图确认。 |
| `PHYS_ALLOWED_DONE` | 真实允许一次后临时文件创建成功。 |
| `PHYS_HOLD_DONE` | 前台只读等待执行完成后的助手回复。 |
| `PHYS_QUEUE_DRAIN` | 运行期间手机入队的下一条请求自动排空，助手回复一次。 |

图片持久化 ID 为 `sha256:d6e1a66b04cbc3fa390cdf534be389e0e3027027fbf41220339aed3fc98026d5`，与 host 对账。只选测试夹具，不选/不发私人相片；系统图库画面含私人缩略图的截图不得公开归档。可公开的应用内选图后证据 [32](evidence/newphone-32-physical-image-selected.png) 和发送完成证据 [35](evidence/newphone-35-image-complete.png)。

权限先由手机从 workspace-write 改为 read-only，host 投影核实。普通 write 被 sandbox 拒绝后，仅 exact write 携 workspace-write 与理由重试一次，产生真实可裁决 Gateway 审批；没有插入合成 history 或降低全局策略。

| 裁决 | approval ID / history序号 | 手机操作与实际结果 |
| --- | --- | --- |
| 拒绝 | `2c14bf9d-437c-4a4f-abf7-5bae5481cb3f`；asked53 → decided54 `rejected` | [37审批卡](evidence/newphone-37-real-approval.png)有 write、理由及允许一次/拒绝；[38拒绝](evidence/newphone-38-approval-rejected.png)。lead 核实 `approval-reject.txt` **不存在**，mux resolved 清理。 |
| 允许一次 | `ba07384c-b462-4e9e-a986-214394d78138`；asked73 → decided74 `allowed-once`，tool/result75成功 | pending 时手机切到旧 QA B 再回 A，[43仍可裁决](evidence/newphone-43-approval-return.png)，[44允许](evidence/newphone-44-approval-allowed.png)。lead 核实 `approval-allow.txt` **存在**且内容 `PHYS_ALLOWED`，助手 `PHYS_ALLOWED_DONE` 一次，mux resolved。 |

真实 Queue 入队/排空见 [47](evidence/newphone-47-queued.png) → [48](evidence/newphone-48-queue-drained.png)。这只认证本次 enqueue→drain→marker once，不认证队列列表管理、编辑/移除/steer/updateQueue，也不认证 ACK 丢失后的幂等性。

Stop 首次点击太晚，turn 已 completed，**不算 Stop 成功**。第二次观察到工具正在运行后点击手机 Stop：[停止结果](evidence/physical-stop-result.json)为 `toolStartedSeq=129`，`turn/end seq=134`、turn9、`reason.kind=aborted`、嵌套 `reason.kind=user`、`cancelled=true`；证据 [52](evidence/newphone-52-real-stop-during-tool.png)。旧包却把该结束展示为“本轮运行失败”，为已实测显示问题。lead已修fold/工具详情并补NativeChatState回归；最终竖屏包[实际回显“已停止”](evidence/newphone-59b-portrait-ready.png)，没有再显示失败。

手机实际重命名为 **Physical QA A**，见 [51](evidence/newphone-51-renamed.png) 和[会话摘要](evidence/newphone-session-summary.json)。全文搜索实际填入 `PHYS_QA_TWO`、点击“搜索内容”，[53](evidence/newphone-53-fulltext-search.png)与[搜索结果](evidence/physical-search-results.json)返回主会话及同一 snippet，`hasMore:false`。此处证明一次真实正文搜索，不覆盖 cap20、分页、归档筛选或连续改词竞态。

手机菜单实际 Fork，见 [54](evidence/newphone-54-fork-created.png)。[会话摘要](evidence/newphone-session-summary.json)确认新 ID `session-e7f2d5af-efc9-4b3c-b2ef-f9dc78fec2aa`，parent 为主 QA 会话，origin=null，属于普通Fork。后续将其临时改为唯一标题Physical QA Fork，最终9881包在此普通Fork实际发送Markdown请求并完成回复，验证可写发送；此前同标题选择歧义已通过同ID对账纠正。

### UI、硬件与修复边界

[UI执行记录](newphone-ui-results.md)包含三个窗口，与后续lead的 动作流水（只留本地临时执行目录）。记录分别归属；最终包收尾见[竖屏最终结果](portrait-final-results.md)：

- 真实深色设置见 [ui32](evidence/newphone-ui-32-dark-settings.png)，浅色见 [ui37](evidence/newphone-ui-37-light-settings.png)，随后点击跟随系统。早期字体2竖屏与未发送中文草稿见 [ui35](evidence/newphone-ui-35-font2-portrait-ime.png)，字体1.3竖屏见 [ui36](evidence/newphone-ui-36-font13-portrait.png)；画面能读到草稿与操作轨。这些取图并不能证明多行草稿首尾逐行阅读、任意尺寸或光标精确编辑全通过；截图35的名称含IME，但画面未显示键盘，不单凭名称认证IME显示；后续[真实font1键盘](evidence/newphone-82-portrait-ime-edited.png)与[font2键盘](evidence/newphone-95-font2-portrait-ime.png)才是IME证据。
- 曾拍到旧版本横屏大字场景；用户随后明确只做竖屏，lead 已将 Activity 改为 portrait。旧横屏截图作为历史观察保留，不作为最终需求或新版竖屏候选的验收。最终包Manifest值1、运行时请求SCREEN_ORIENTATION_PORTRAIT，实际1200×2670；用户指示后未继续横屏测试。
- 系统相机权限弹层曾出现，随后“仅在使用中允许”，后续扫码预览可见；[ui43控制状态](evidence/newphone-ui-43-torch-on.xml)显示实时取景及“关闭手电”，[ui44控制状态](evidence/newphone-ui-44-torch-off.xml)对应关闭操作。证明有后摄预览及 torch UI 状态往返，不等于真实 QR 解码/自动配对或独立观察到灯光亮灭；拒绝权限、无后摄/CameraX失败、迟到解码等未跑。
- 实际粘贴 `invalid-physical-qa-link` 并连接，[57](evidence/newphone-57-invalid-pairing.png)显示可读“无效的配对链接（需要完整的dshd offer URL）”，之后点击保存电脑“继续”并取得 [58](evidence/newphone-58-saved-reconnected.png)。不扩张为所有畸形/过期链接或安全 scheme 已认证。

实际反复出现 `Software caused connection abort`，旧 VM 自动重连会清 panel，导致表单消失。75秒[只读网络观察](evidence/newphone-network-observation.json)完成15次5秒采样：15:44:08.612–15:45:18.602（UTC+8），默认net327、CELLULAR、validated=true、nativeqa PID3422一致且无采样错误。没有保存原始 dumpsys/IP/SSID/token。该粒度不能排除采样间短故障、同netId内部路径变化或relay/socket故障，不能证明socket稳定，也没有确定断连原因。

已落码的新修复：传输generation继续递增；独立uiOwnerEpoch对同电脑同会话auto/manual重连保持；work/new/settings/sessions/browse及panelData/catalog保留，离线主动关闭不复活；Git/review关闭。dial/catalog/控制加载期间禁止远端任务；目录失败保留错误并可手动重试，空目录解除loading；同代目录同步只在途一次，旧会话点击不能绕开catalogReady。旧连接、session和panel revision隔离迟到结果。**4389竖屏候选真实断开/恢复已通过搜索页与query保留、离线禁用和恢复重新可用**（[结果](evidence/physical-reconnect-result.json)，[离线](evidence/newphone-61-search-during-disconnect.png)→[恢复](evidence/newphone-62-search-after-reconnect.png)）。宿主恢复需第二次enable，实际长于预设12秒，不将其记为精确12秒往返。最终9881加入后续readiness保护，JVM覆盖失败旁路/重复同步/旧代失败；未在手机注入catalog RPC单点失败。

### 9881阶段检查归属（历史）

该阶段App JVM执行17秒、BUILD SUCCESSFUL，40/40（Remote29+基础VM3+Native8），XML17:52:12（UTC+8），全部0失败/错误/跳过。旧无连接fixture任意open的草稿用例与新就绪保护冲突，第一次40项有1失败；迁到真实ready FakeRelay fixture后保留全部原归属断言并增加离线编辑当前草稿/禁止切会话断言，最终40项通过，没有放宽产品保护。协议15是此前12:40执行的有效结果，最终未重新执行；定向Node33同样是此前执行。最终两身份assemble和nativeqa lint成功，0error/13warning，未冒称55项都在最后一轮重新运行。

### F01–F42 新机增补矩阵

表中“部分实跑”只指明确子路径；“pending/未跑”保留未执行范围。API26已有结论不转写为本机通过，初始审核中的静态风险不自动当作新机故障。

| ID | 功能 | Android16新机事实及未完成范围 |
| --- | --- | --- |
| F01 | 安装/升级/冷启 | 部分实跑：nativeqa新装、COLD首屏成功；9881阶段冷启1091ms；当前r2覆盖成功、冷启1253ms、配对与历史保留，并完成实际发送。正式签名升级、旧Web迁移未跑。 |
| F02 | offer解析 | 部分实跑：真实offer连入；无效文本有明确错误。过期/各类畸形未逐项跑。 |
| F03 | 原生扫码 | 部分实跑：权限弹层→允许→预览、torch UI往返；真实QR解码、拒绝、无后摄及失败生命周期未跑。 |
| F04 | VIEW handoff | 部分实跑：保存配对VIEW intent实际连当前宿主；全部冷热/非法参数组合未跑。 |
| F05 | 认证/E2EE | 部分实跑：真实relay认证、保存资料恢复；坏secret/重放/撤销未设备注入。 |
| F06 | 保存电脑 | 部分实跑：已保存电脑可继续连接，设置列出设备；忘记、坏记录、写盘失败全组合未跑。 |
| F07 | 首连失败恢复 | JVM新增证明目录失败错误可见、任务禁用且手动同步恢复控制；手机未定向注入该失败。 |
| F08 | 断线恢复 | 实际复现abort及旧版任务表单消失；4389包真实断开/恢复搜索页和query保留、远端禁用→恢复可用；宿主恢复超过12秒，非exact12秒。9881后续加载屏障受控JVM通过。不声称传输原因已修。 |
| F09 | 生命周期 | 部分实跑：图库往返、锁屏后用户解锁、字体/主题窗口；最终portrait请求已核，重装后冷启仍恢复保存配对；杀进程附件恢复未验收。 |
| F10 | Harness状态 | 部分实跑：真实当前宿主ready和实际offline提示；catalog失败/空态主要JVM，不等于UI完整故障验收。 |
| F11 | 目录全集/筛选 | 部分实跑：工作区/会话可见；未逐ID对照blank/孤儿/归档/child全集。 |
| F12 | 分组/层级/顺序 | 分组实际可见；未新增树形/父下折叠/完整顺序验收，parity缺口保留。 |
| F13 | 列表反向同步 | 手机rename后host title核实；另一端运行/删除/归档全部状态未跑。 |
| F14 | 行菜单 | 部分实跑：真实Rename成功；Fork新ID及parent对账；最终包普通Fork实际发送Markdown并完成回复。排序等边界未跑。 |
| F15 | 归档/恢复/删除 | 专用child实际rename→archive→unarchive→archive→删除确认取消→确认移除；host当前/归档/workspace均无该ID，磁盘目录保留。见[CRUD结果](evidence/physical-crud-result.json)。 |
| F16 | 新会话 | 部分实跑：现有repo外工作区真实创建两QA会话；blank复用/首条前改cwd未验收。 |
| F17 | 目录浏览 | 实际home→上级→C:\AI→QA专仓→子目录，滚动列表与返回可用；慢盘/驱动器枚举/全错误未覆盖。 |
| F18 | 新目录/登记 | 实际手机新建phone-created-1645→登记workspace→新session；host核cwd正确，后续模型回复一次。一次坐标未入子目录注册父目录如实保留，随后完整子目录链路成功。 |
| F19 | 搜索 | 真实全文PHYS_QA_TWO命中主会话，hasMore:false；cap20/分页/归档/连续改词未跑。 |
| F20 | 打开会话/历史 | 部分实跑：旧历史/图片、QA A/B往返、pending审批回A仍可裁决；全量失败/竞态未跑。 |
| F21 | 历史分页 | 本机未完成多页锚点及直播追加验收；受控历史回归不转为手机通过。 |
| F22 | 发送/多轮 | 主QA9user turns，六marker各一次；包含审批/queue/stop，不等于两路径各五轮完整验收。 |
| F23 | 直播/结束/Stop | 真实运行/回复可见；第二次Stop工具seq129→turnend134 aborted/user通过。第一次completed不计成功；新版文案已真机显示“已停止”。 |
| F24 | 提交未知结果 | ACK丢失/重复请求未故障注入，B10未修，不能因正常markeronce关闭风险。 |
| F25 | 模型/思考 | 当前模型下线后UNKNOWN_MODEL明确显示；手机选择可用DeepSeek V4.1 Flash1017/Low后新child回复PORTRAIT_CURRENT_MODEL_OK一次。完整多provider边界未覆盖。 |
| F26 | 权限 | 手机workspace-write→read-only，host投影核实；非全三态双向验收。 |
| F27 | Plan/slash | 真机Fork实际/plan启用与chip关闭，正确同ID投影active:true→false、pending:false（[开](evidence/physical-plan-on.json)/[关](evidence/physical-plan-off.json)）；曾错用主A作对账已纠正。 |
| F28 | Queue | 真实运行时入队→排空，PHYS_QUEUE_DRAIN一次；列表编辑/删除/steer/updateQueue未验收或未接。 |
| F29 | 草稿/附件归属 | 填框/图库/字号窗口未发送草稿保留可见；4389真实断开/恢复query保留；1/2倍字体dockedIME精确光标删字符和Back保留草稿。强杀附件恢复未跑。 |
| F30 | 相册/拍照 | GetContent只选专用PNG，预览Send成功；真实拍照、取消/拒绝、多格式/损坏/大小边界未完整跑。 |
| F31 | 附件历史/预览 | PHYS_IMAGE_OK及durable ID对账、已有历史图可见；lightbox、冷启/跨页/坏图设备验收未跑。 |
| F32 | 审批 | 两个真实Gateway请求：reject无文件、allowed-once有文件/内容正确，B→A保pending可裁决、muxresolved；非全重连/多端争抢/过期组合。 |
| F33 | Git初始/授权 | 本机实际打开已初始化QA专仓status/branch/文件清单，后续创建分支和commit；无仓init仍为API26实跑，不转认证本机initialize。 |
| F34 | Git分支 | 实际手机创建并切physical-portrait-qa-1754，host分支核对；非法名/远端tracking未覆盖。 |
| F35 | Git Commit | 实际手机Commit临时fixture，host commit53b977ef、说明一致、statusclean；未push/publish。见[Git结果](evidence/physical-git-result.json)。 |
| F36 | Git Stack | 本机裸仓Commit & Push及默认分支确认真实通过，local/remote3f11585d一致；PR阶段和中途失败重试未跑。断线关闭Git/review是明确行为，非保留Git草稿。 |
| F37 | Git同步/默认分支 | 本机裸仓Pull实际快进53b977ef→164e4aa，文件到账；Commit & Push默认分支确认继续有效。ahead/behind界面摘要、分叉和全三选择仍有缺口。 |
| F38 | Publish/View PR | 手机Publish到显式本机裸仓成功，origin建立且精确HEAD推送；没有外部鉴权或创建/查看PR/MR。见[本机Git传输](evidence/physical-git-remote-result.json)。 |
| F39 | 设置/主题 | 深/浅/跟随系统有实际点击及图；font2/font1.3竖屏局部可读。最终包portrait已核；4389包1/2倍字体normaldockedIME实测，设置Hub/全部密度矩阵未全验收。 |
| F40 | 只读/冻结/NEVER | read-only实际sandbox拒绝后显式单次升级审批有效；未逐个尝试全部受限接口，说明页不算能力通过。 |
| F41 | 文本/Markdown/工具 | 9881旧差距保留；当前r2深浅主题三列表格9cells/数字对齐/长格换行及横滚、行内/块公式、价格美元、代码滚到END已真机通过；Stop已显示“已停止”。链接打开/恶意scheme、全部富内容与选择复制未全验收。 |
| F42 | 多端并行 | 手机真实操作与host消息/marker/图片ID/审批裁决/文件结果/Fork parent局部对账；桌面Web原生并发写/审批竞争/归档全状态未验收。 |


## 前一竖屏候选与当前收尾

[最终收尾记录](portrait-final-results.md)汇总exact包、同ID对账、目录/CRUD/Git/IME、错误配对滚动和Markdown实际差距；[构建安装摘要](evidence/portrait-final-build-summary.json)、[设备恢复读数](evidence/physical-final-restoration.json)保留最后状态。正常字体1.0、自动旋转0、user_rotation0、USB常亮15、系统night1、原输入法与app跟随系统均恢复。

9881包Markdown的[旧底部图](evidence/newphone-121-final-markdown-bottom.png)和[旧配对页滚动图](evidence/newphone-114-final-invalid-ime-scrolled.png)保留为修复前失败。当前r2已完成表格/数学/代码与配对IME按钮定向修复和复测，详见[续测报告](portrait-richtext-followup.md)，不能再把这些旧失败当当前缺陷。真实QR、实际拍照提交、外部Git鉴权/PR、全部分页/竞争/资源边界和正式签名升级仍未完成，Issue保持OPEN，PR供审查不自动合并。

当前r2精确身份、45项回归归属、1253ms安装启动与明暗主题/横滚图证见[续测结果](portrait-richtext-followup.md)。本轮审查已区分通过、修复前失败及未覆盖范围；不是发布签收或全矩阵通过。
