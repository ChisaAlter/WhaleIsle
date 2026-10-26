# Android 原生客户端 QA：2026-10-26

本轮完成连接/会话归属、历史图片、审批路由、Git 入口与紧凑布局修复，并取得 **46 项 JVM、33 项定向 Node、Android debug 构建及 lint 通过**的执行记录。API 26 隔离模拟器已实际完成公网配对、文本/图片对话、权限切换、Plan 启停及临时仓 Git 初始化/建分支/本地提交。**物理 Android 15 尚未安装本轮 APK；本记录是部分验证，不是全功能、全布局或桌面完整对齐验收，真机安装与全量验收仍未完成。**

报告汇总 android-state 的源码复核、android-ui 的模拟器操作及 lead 的构建/宿主/业务执行记录。报告编写者没有独立重跑构建、JVM、Node、lint、设备操作或内存压测；除 APK SHA-256 只读核对外，执行结果按下述来源归属记录。原始静态审计中的候选与旧行号不代表最终代码仍有相同问题，处置以本报告和修订审查为准。

## 设备、安装与实际测试边界

| 环境 | 本轮事实 | 验收边界 |
| --- | --- | --- |
| 物理机 `23124RN87C`，Android 15，ADB `9TUCYX8TBI6DLRMZ` | MIUI/HyperOS 的“USB 安装”开关仍关闭；尝试开启提示“请先插入 SIM 卡”，双 SIM 均 `ABSENT`；`adb install` 与 `pm install` 返回 `INSTALL_FAILED_USER_RESTRICTED`。见[实际开关画面](evidence/25-usb-install-toggle.png)。 | 本轮 APK **未安装**；保留原 0.1.1 应用及数据，未卸载、清数据或绕过系统认证。标准包签名也不能据此视作可覆盖旧包。真机功能/布局/升级均未通过。 |
| 隔离模拟器 `emulator-5580`，Android 8 / API 26 | 1080×1920，density 480，竖屏约 360dp；安装包 `ai.deepseek.harness.mobile.nativeqa`，Activity 为 `ai.deepseek.harness.mobile.MainActivity`；最新 QA 包 `install -r` 成功。 | 属补充实跑，不能替代 Android 15、硬件相机、其它密度/宽高或正式包覆盖升级。UI 字体重点为 1.3/2.0，未完成全部字号/输入法/导航组合。 |
| UI 前阶段 | 使用保存的公网 Ayase 配对，连接已有 source 3181；仅新建 QA 会话，原只读会话仅查看。 | 旧宿主不支持最新 flat 子智能体地址，不能用它认证新地址。部分早期截图在 tight-IME 补修前。 |
| lead 当前源码隔离桌面 | 独立 Electron userData；Harness 53876、daemon 53878，与既有 3080/3181 分开。Android 重新配对当前源码宿主；实际 Gateway、host tunnel 与公网中继参与请求。 | 当前源码宿主配合已有 Web 产物运行；完整桌面重建另有失败，见构建节。 |
| 业务写入范围 | 本轮新会话及仓库外专用 `C:/AI/WhaleIsle-AndroidQA-20261026`；Git 作者仅对该临时仓设置 `--local`。 | 未向原有用户会话发送测试消息，未在产品仓做 Git 写操作，未 Publish/Push 测试仓。repo 内 `.tmp` 目录可向上找到产品仓，未用它冒充独立非仓目录。 |

## 构建、检查与可定位产物

本轮产品源码提交为 `8899d0f147`（lead 提供）。Android 当前配置为 versionName `0.3.10`、versionCode `4`、minSdk `26`、target/compileSdk `36`。standard 与 nativeqa 为同源码的两个身份；安装 nativeqa 不等于正式包升级。

| 产物 | SHA-256 | 本轮设备状态 |
| --- | --- | --- |
| 标准 debug APK `WhaleIsle-0.3.10-debug.apk`，包名 `ai.deepseek.harness.mobile` | `F7D169073FC65F302EA561FC9BE8485B61E54F85B866705F1E339BB7F430DD39` | 构建完成；物理机未装入。 |
| 隔离 QA APK `fixed-nativeqa.apk`，包名 `ai.deepseek.harness.mobile.nativeqa` | `04CA34D91EA700472453C705645217159C0CD01F8FF5819151A01046B5691C86` | API 26 覆盖安装、冷启动与下列部分业务实跑。 |

APK 为本机运行产物，未作为文档附件提交；SHA-256 由 lead 提供并由报告编写者对上述 exact 文件独立只读核对一致。精选截图由 lead 放入本目录的 `evidence/`；报告编写者仅写本 README，没有复制 APK、截图或凭据。

| 检查 | 实际结果 | 证据/不能推导的结论 |
| --- | --- | --- |
| `:protocol:test :app:testDebugUnitTest` | **46 项，0 failure / error / skipped**：Offer 7、PairingIntent 4、RelayInterop 2、RelayLifecycle 2；App Remote VM 20、基础 VM 4、NativeChatState 7。 | [JVM 汇总](evidence/jvm-results.json)。protocol 15 + app 31；其中受控 FakeRelay/延迟测试不是手机端到端。 |
| `:app:assembleDebug` | standard 与 nativeqa 构建成功。 | 本轮 lead 执行；未认证 release、生产签名兼容或旧 Web 数据迁移。 |
| `:app:lintDebug` | **0 error / 11 warning**，另有信息项。 | [lint 文本](evidence/lint-results-debug.txt)：依赖版本提示 8 项、Modifier factory 1 项、迁移 WebView 的 JavaScript 1 项、Android 12+ 数据提取规则 1 项；不是零警告。 |
| host tunnel / daemon hooks / mux 定向 Node | **33/33 通过**（lead 执行记录）。 | 覆盖真实 Remote payload 适配、flat durable address/游标纠正、审批重放/解决等，不等于整个 desktop 或全部 Web 测试。 |
| 真实 Gateway mux | 收到 `session/projection`。 | [真实 mux 结果](evidence/real-mux-results.json)；不是审批事件通过。 |
| 真实子智能体历史 | 当前 host tunnel 用直接父/子地址读取 **252 events**，`hasMore:false`。 | [真实 child-history 结果](evidence/real-child-history-results.json)；只读，无 child prompt/树形目录验收。 |
| 当前源码隔离 Electron + 模型 | 启动后短桌面模型请求收到 `ANDROID_QA_READY_20261026`。 | [lead E2E 记录](e2e-lead.md)；不能扩张为全桌面构建成功。 |
| 完整 desktop 预启动重建 | **未通过**：client bundle 原生进程退出码 `3221226505`，Web 阶段未执行。 | 使用已有 Web 产物运行，未修改 vendor 源掩盖此失败。首次 daemon 重启 30s 未 ready，之后重新启动恢复 ready/relayConnected；未增加产品重试代码，未宣称一次启动必成。 |

## 本轮代码修复及证据层级

| 问题/修复 | 当前行为及验证边界 |
| --- | --- |
| 新建/登记与跨电脑状态归属（B04、Q01） | 先正确保存旧会话图片草稿再打开新 ID；切电脑/离开清目录；媒体结果按 owner 校验。VM 回归覆盖两种创建入口、电脑切换和迟到结果；模拟器实际新建无目录/已有工作区，未逐一故障注入。 |
| 连接与前台恢复（B06/B07） | 先订阅 mux 再同步目录；首次目录失败可恢复；成功认证后掉线用保存 secret 重连并恢复原选择/草稿，认证拒绝停止自动重试。已连接前台恢复只刷新目录/历史，保留 Browse/Search/Git review；VM 受控回归通过。实际配对与保存设备重连成功，不把所有断网/后台组合记为通过。 |
| 权限、Plan、模型加载归属（B08/B09） | 切会话清旧值，待 history/projections 及普通会话目录加载完解除 loading；UI/VM 阻止加载期间写动作；新模型明确无 effort 会清旧值。VM 及 helper 回归通过；模拟器另实际选择 Low、切 read-only、Plan on/off。 |
| 审批关联（B03） | 按 session/approval 保留 Gateway client/event 回复路由；history-only 无路由时禁用；共享 mux 重放待处理审批、成功 respond 后广播 resolved，旧连接/来源切换不复活已解决项。JVM/Node 通过；**本轮没有可裁决的真实审批**。 |
| 非仓 Git 与异步归属（B01/B05） | `isRepo:false` 时不先要求 branches/entries 成功；迟到 Git 结果检查连接/session/revision/cwd/panel。VM 回归通过；模拟器在仓库外目录实际 init 成功。 |
| 持久化图片（B02、R1/R2） | 消费 durable `attachmentId`，按当前会话经 `session.attachment` 读取；逐图成功立即显示，失败独立占位和可读错误，继续后续项，取消不被吞。缓存仅当前打开会话持有，切换取消并清理，在途 Deferred 完成即 finally 移除。混合好坏图/取消/轮询不重读回归通过；真实好图发送、历史 attachmentId 对账成功。**不是 LRU/总字节预算，也未做内存压测**；当前已加载历史可随分页增长。见[修订审查](code-review.md)。 |
| 子智能体历史 | 保留 origin/parent ID；`session.history` 使用 flat `address:{kind:"subagent",parentSessionId,childSessionId,mode:"unknown"}`；host 严格校验并保留翻页/游标地址。child 只读且跳过 commands/models，projections 按 child ID 读取合法；普通 Fork 有 parent 仍可写。VM/host 回归及真实 child 历史通过，未实现树布局。 |
| 布局与恢复（Q02–Q08/Q15/Q20） | 真实 tail anchor、按剩余高度分配 composer/approval、最小高度顶栏、连接/扫码限宽、系统栏/Markdown 主题、任务表单 rememberSaveable。横屏 IME 将正文压成细线在 API 26 实际复现，补修后 font1.3/2 可读至少一行；其它长审批/分页/TalkBack 仍未验收。 |

## 实际业务与界面观察

Android 发出短请求后得到 `ANDROID_QA_20261026`，并清空已提交草稿。自动化填框误用 Ctrl+A 曾在原请求前产生 `aa`；host 与 Android 记录一致，实际文本为 `aaReply only ANDROID_QA_20261026. Do not use tools.`，没有把这个工具错误写成产品串改。系统 GetContent 选择测试 PNG 后原生缩略图可见，发送图文请求后得到 `IMAGE_QA_RECEIVED`，历史用户气泡可回显。这里是两次实际 prompt（一次短文本、一次图文），不是两个场景各完整五轮；运行中 Stop/queue 仅被看见，未点击验证。

[最终 Android/host 对账](evidence/android-e2e-results.json) 为 `ok:true`、28 events、`firstReply:true`、`imageReply:true`；持久化 ID 为 `sha256:ce41275f9fd78520adfe028985a22ce864c0679b892c2ef6e5eb7e274ad27e16`。该结果由当前 host helper 与隔离源码桌面读取，不是 FakeRelay echo。可见证据：[当前源码配对后 ready](evidence/emu-e2e-09-owned-ready.png)、[短回复](evidence/emu-e2e-13-owned-reply.png)、[选图后草稿](evidence/emu-e2e-20-image-draft.png)、[图文回复及历史图](evidence/emu-e2e-22-image-reply.png)。没有完成桌面发图、冷重启附件、多格式/多图/损坏图的设备实跑。

在 `C:/AI/WhaleIsle-AndroidQA-20261026`，Android 打开[非仓 Git 页](evidence/emu-e2e-14-git-nonrepo.png)，实际 Initialize 后返回完成，lead 只读确认新 `.git` 在该临时目录，初态 `No commits yet on main`。Android 创建并切换 `android-qa-branch` 成功；第一次 Commit 因无作者出现 `Author identity unknown`，保留表单/所选项并能继续操作（[错误步骤](evidence/emu-e2e-31-git-commit-request.png)）。lead 仅为该仓本地设置 QA 作者后，Android 再提交成功（[完成](evidence/emu-e2e-33-git-commit-retried.png)）；lead 核实 commit `3397a7b`、说明 `Android native QA local commit`、status clean。没有执行 push、publish、pull、PR/MR、远端跟踪或完整 stack。

权限 picker 实际从 workspace-write 改为“仅可查看”，等待 RPC/投影返回后，[最终图 35](evidence/emu-e2e-35-permission-final.png)显示“切换权限：仅可查看”；先前图 34 尚为旧值，不能作为成功证据。composer 输入 `/plan` 实际走命令后，[图 38](evidence/emu-e2e-38-plan-final.png)出现 Plan chip，host 投影 `active:true`；点击 chip 关闭后，[图 40](evidence/emu-e2e-40-plan-off-final.png)不再显示，host 投影 `active:false,pending:false`。权限仍为 read-only。这只证明该方向权限更改与 `/plan` 启停，不涵盖全三态、所有 slash 或双端更改。

横屏长草稿 + IME + font1.3 曾实际只剩细线（[补修前](evidence/emu-ui-04-landscape-ime-long.png)）。最新包隐藏紧凑高度下的 host 次行、压缩纵向 padding，正文最小高度取 `minOf(24sp 换算高度, editableHeight)`，受实际剩余空间限幅，并保留 48dp 操作轨；本机以下场景实际可读一行，不是对任意高度的一行保证：[font1.3 补修后](evidence/emu-ui-45-latest-font13-landscape-ime.png)、[font2 补修后](evidence/emu-ui-46-latest-font2-landscape-ime.png)以及[实际插入文字/光标](evidence/emu-ui-52-latest-font13-end-edit.png)可见。图 52 是当前可见文字中插入 `END_QA`，不是“验证文档末尾”；未独立逐行首尾滚动。模型层往返及旋转保留草稿；设置[浅色](evidence/emu-ui-18-settings-light.png)、font2 [浅色设置](evidence/emu-ui-24-font2-settings.png)/[深色设置](evidence/emu-ui-25-font2-settings-dark.png)实际切换，系统栏有对比。另有[侧栏](evidence/emu-ui-28-drawer.png)、[查询词旋转](evidence/emu-ui-34-search-rotated.png)、[重命名草稿旋转](evidence/emu-ui-41-rename-rotated.png)；后两者没有提交全文搜索/重命名。

仍见限制：紧凑视口主要一行；font2 横屏空态欢迎语部分裁切；API26 font2 系统时钟下沿裁切属于系统区。lead 最终 font1 也实际查看可读且未崩，已归档截图41；抽查 logcat 未见 AndroidRuntime 错误，不表示全时段无崩溃。没有覆盖 320dp、不同 density、全部输入法、三键/手势组合、长审批及真人 TalkBack。不能把单个可用截图推及所有小高度布局。

## F01–F42 执行矩阵

沿用[初始功能审计](function-audit.md)的 42 个 ID，不继承历史 Web 或旧 WebView 版本的 Pass。**部分实跑**仅表示本行的指定子路径真实执行；**static**表示源码/受控自动回归有依据，但该完整设备路径未跑；**未跑**表示本轮无该业务执行。无一行代表整行所有边界全通过；物理 Android 15 的 42 项全部仍未验证。

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
- **新建、目录与搜索**：首条前工作区 chip/blank 复用未对齐；目录起点不是登记目录父级；搜索 cap20/hasMore/归档筛选与查询/面板异步归属仍有静态差异或风险，实际全文搜索未跑。不能以查询词旋转成功代替它们。
- **对话与富内容**：真实 Queue 管理尚未接；长草稿阅读收起、图片 lightbox、代码水平滚动未齐；完整表格/数学/图示/Markdown 图片/交互内容与桌面不同。Generative UI 引导到电脑，未知类型诚实占位，不算支持。Files/Diff/MCP/技能是冻结说明；消息 edit/rewind、Trajectory、Context meter、日志/终端等 DEFER/NEVER 范围不能当完成项；禁止 Stage/Unstage/Discard、任意 shell、凭据/MCP 写等仍需保持边界。
- **失败语义与硬件**：B10 接收成功但 ACK 丢失后重发可能重复，未故障注入/未修；B11 “断开”与忘记本机配对语义不等同，冷启行为未验收；B12 无后摄/CameraX 失败/退出迟到绑定及可选电脑名写盘失败仍是待测候选。链接 scheme 安全需设备验证，不能凭 Markwon 默认行为声称安全通过或已存在漏洞。
- **设置、连接与布局**：设置 Hub 仅主题/电脑，连接详情/通用/关于及 endpoint/独立忘记入口未齐；首次连接/目录失败、长错误提示与空态区分仍需完整 UI 走查；紧凑编辑当前主要一行，极小高度、长审批、短弹层按钮换行、焦点/Back/TalkBack、320dp/平板/其它密度未通过。系统栏和 Markdown 主题修复不等于全部富文本一致。
- **资源与平台**：R1/R2 已关闭，但当前会话多页图片可增长，没有字节上限/LRU/内存压力测试；API26 通过不能覆盖 Android15。正式签名升级、旧 Web 迁移 instrumentation、生产包、真实相机和完整桌面重建均未认证。

真实审批尝试由 sandbox 直接拒绝，未产生可裁决 Gateway 事件；未降低安全策略重试。UI 自动化中同名标题误点、selector/content-desc 不匹配、控制键/空参数与超时等失败已由执行人保留，不计作成功产品动作。上述负向结果同样属于本轮交付事实。

## 证据索引与后续验收

本报告引用精选截图；lead 将 UI/E2E PNG、XML 和动作流水归档在本目录 `evidence/`，未把配对 offer、secret、Cookie、credentials 或原有用户完整历史纳入报告。下列静态/执行报告位于本目录，非敏感 JSON 与 lint 文本位于 `evidence/`；原始来源为本轮临时执行工作区，报告编写者仅消费，不替执行人补造结果。

- [初始功能审计与42矩阵](function-audit.md)、[布局静态审计](layout-audit.md)：先期只读，里面“全部未执行”和旧缺陷是当时状态，不覆盖本报告后续实跑/处置。
- [API26 UI 执行与截图边界](emulator-ui-results.md)、[lead 业务/宿主 E2E](e2e-lead.md)、[R1/R2 修订审查](code-review.md)。lead 后续权限35、Plan38/40与 commit3397a7b 补充直接纳入本报告；早期记录未写到的步骤不能反向变成未执行。
- [JVM 汇总](evidence/jvm-results.json)、[lint 0/11](evidence/lint-results-debug.txt)、[Android/host 最终对账](evidence/android-e2e-results.json)、[真实 child 历史](evidence/real-child-history-results.json)、[真实 mux](evidence/real-mux-results.json)。

下一轮应先解决真机系统安装授权与签名升级前提，再按 F01–F42 对当前同一包身份补齐真机操作，优先真实审批跨会话/重连、停止/Queue、长历史与坏图、相机/扫码、目录搜索及远端 Git；物理机和补充模拟器结果分别记录。当前代码修复可供审查，**不以本报告关闭真机全量验收，不把部分实跑自动提升为整轨 Pass**。
