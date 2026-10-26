# Android 原生功能审查与设备测试矩阵

日期：2026-10-26。范围：共享工作区当前源码的只读审查。**本报告没有执行 APK 安装、手机操作、构建、自动测试、桌面运行验证或 Git 操作；没有读取设备/桌面凭据。唯一写入是本报告。以下全部设备用例均为「未执行」，缺陷均为代码证据支持的候选，不计实测 Fail/Pass。**

已先读取 [AGENTS.md][rules]、[维护说明][maintenance]、[领域指引][domain]、[GLOSSARY.md][glossary]；在 `mobile` 内检索未发现更细的 AGENTS。产品基线以 [手机远程功能卡][feature]、[模块说明][module] 和 [现行手机设计语言][design] 为准。[2026-09-29 原生决定][decision] 仍描述后台 WebView 的历史阶段，已被功能卡 2026-10-04 全 Kotlin 迁移说明取代。历史验收不认证当前原生实现。

## 结论与建议执行顺序

源码确有 Kotlin offer/E2EE/设备证明、加密存储、Compose 聊天/管理/目录/Git/设置入口。但不能据此声称「全功能通过」或「与桌面完整对齐」。建议 lead 先在临时测试会话/目录验证 **B01 未初始化 Git、B02 图片回显、B03 审批切会话、B04 新会话附件隔离、B05 Git 迟到回复归属**，再验证断线与首次目录失败恢复；这些路径可能影响后续整轨测试可信度。所有 Git 写操作应由 lead 放在专用临时仓，不在产品仓执行。

双端比较取同一电脑、同一 `sessionId` / `cwd`：会话与归档 ID 集合、工作区 path、最新用户原文/助手正文、模型 `(provider, model, reasoningEffort)`、权限预设、Plan、pending approval、Git `{refName, aheadCount, behindCount, hasWorkingTreeChanges, 主动作}`。不能用标题简称或单端截图替代身份与状态对照；不得把 offer/secret 放进报告或截图。

## 高风险 bug 候选（静态证据，均未复现）

| ID / 优先级 | 代码证据与推导 | 建议最小复现 / 必须达到的结果 |
| --- | --- | --- |
| **B01 / P0，高置信度** 非 Git 目录无法到达 Initialize | [VM:440–446][v-git-open] 必须依次拿到 status、branches、entries 才打开 Git 页。[Git:294–297][git-status] 对非仓库正常返回 `isRepo:false`；[Git:1200–1211][git-branch] 的 `for-each-ref` 在非仓库失败并返回 `ok:false`，[Relay:126–133][relay-rpc] 将其抛错。因此 [UI:239][ui-git] 的「初始化 Git」按钮所在页面不会打开。 | 登记一个未 init 的临时目录→新会话→Git；应直接呈现 Initialize 并可 init，不能先要求成功列分支。 |
| **B02 / P0，高置信度** 持久化图片历史无法回显 | [Host:421–430][host-admit] 调用图片 admission 后创建消息；[Attachment:108–127][image-ref] 把内联字节替换为 `{type:'image', attachment:{attachmentId,...}}`；[History:434–444][host-history-record] 原样返回事件。原生 [NativeHistory:13–14][native-images] 仅取顶层 `mediaType/data`，本次对整个 Android Kotlin 的检索无 `session.attachment` / `attachmentId` 消费者。[VM:347–349][v-send] 成功后清本地附件；[UI:457–465][ui-image] 空 data 会显示「图片无法预览」。 | 选图→发送→看当前用户气泡→切走再返回/重启→桌面发图后手机打开。应按本会话 `attachmentId` 经白名单 `session.attachment` 读取并显示；失败给明确原因，不能只在发送前缩略图可见。 |
| **B03 / P0，高置信度** 审批关联在切会话/历史恢复时丢失 | [VM:196][v-open] 每次 openSession 清 `approvalRpcIds/liveApprovals`；[VM:272–279][v-mux] 对非当前会话提前返回，只有当前会话 live mux 才记录 rpcId。[NativeHistory:120–133][native-approval] 恢复 pending 内容但无 rpcId；[VM:365–368][v-approve] 以空串默认值发送 `respond`，[隧道:493–495][respond] 明确拒绝缺少 rpcId。当前 Gateway 的关联实际含 clientId/eventId（[mux:198–217][mux-approval]）。 | A 等审批→切 B→回 A→允许/拒绝；或审批在非当前 A 出现、带 pending 重连。必须重新取得当前 Gateway 关联，手机可裁决，桌面同步清 pending，无「respond 缺少 rpcId」和幽灵审批。 |
| **B04 / P0，高置信度** 新会话继承上一会话图片草稿 | [VM:387–391][v-new]、[VM:403–409][v-register] 先把 `chat.sessionId` 改成新 id，再 `openSession(newId)`；[VM:195/200][v-open] 会把当下 `chat.attachments` 保存到“当前 id”键并马上恢复。因此 A 的图片可存到新 B，绕过普通 A→B 切换的归属保护。 | A 添加未发图片→新建已有工作区/无目录/Browse 建会话→B 应无 A 图片；回 A 图片仍在。两个创建入口都测，不能只复用已有普通切换单测。 |
| **B05 / P0，高风险竞态** A 的迟到 Git 数据可驱动 B 操作 | [VM:440–446][v-git-open] 开始读取 A.cwd，返回仅检查连接 epoch，未检查 sessionId/当前面板 revision。work 对话框 [UI:58–64][ui-work] 可在 `panelBusy` 时关闭；[VM:193–194][v-open] 切会话只看 `chat.busy`。迟到数据打开 Git 页后，[VM:456–460][v-git-run] 执行时重新取“当前会话”的 cwd；UI 的 filePaths/状态却来自 A。后续 Git stack 的归属检查只保护执行开始后的切换。 | 在 A 点开 Git、读取未结束时关闭弹窗并切 B→等待 A 回复；不得把 A Git 页弹到 B，更不得把 A 的路径选择/默认分支状态用于 B。用两独立临时仓观察，避免任何真实仓写入。 |
| **B06 / P0，高置信度** 首次目录失败后恢复不会订阅 mux | [VM:139–146][v-connect] 先 `refreshCatalog` / open first session，随后才 `subscribe/startPoll`；目录 RPC 失败会跳过订阅。[VM:309–318][v-foreground] 已连接时重试只 refreshCatalog/refreshHistory/startPoll，没有 subscribe。空闲时 poll 又仅在 running/pending 才读历史（[VM:305–307][v-poll]）。 | E2EE 成功但 Harness 不可用→恢复 Harness→点重试→桌面新会话/改名/改模型/触发审批。目录恢复后也应建立 live 订阅，不能仅“列表重新出现”就 Pass。 |
| **B07 / P0，高置信度** 前台、同网络的掉线没有自动重连路径 | [Relay:170–184][relay-fail] fail 只置 connected=false/拒绝 pending；[VM:134–136][v-observe] observer 只改显示，未启动重连。重连仅有 [VM:309–321][v-foreground] 前台恢复/网络 onAvailable；[Activity:38–39/87–88][activity] 也没有同网络连接失败的触发。另外 [connect:127/143][v-connect] 重建空 chat 并打开目录第一条，未保存原当前会话选择/未切走的图片草稿。 | 手机一直前台且网络不切换，relay 或桌面通道短断后恢复；应自动用保存设备证明重连并重读原当前历史，不能依赖手点或切后台；原会话恰非第一条及存在未发图片时同时核对。认证失效应停止自动重试并保留可忘记记录。 |
| **B08 / P1，高置信度** 切会话期间权限/Plan 仍沿用 A 且可作用于 B | [VM:198–201][v-open] 重置模型字段，但没有重置 permission/current/options/planOn；[UI:320/364/383–384][ui-composer] `available` 不检查 `loading`，故慢速 B.history/projections 返回前，A 的权限控件/Plan 已以 B.id 可点击。 | A 高权限+Plan→切到不同权限 B、延迟读取；加载期间应标明未知/禁用旧值，不得呈现 A 权限为 B 的真相。正常/错误路径均测。 |
| **B09 / P1，高置信度** 桌面切到无 reasoning 模型后旧 effort 不清 | [VM:247/258–261][v-projections] `reasoningEffort.string().ifBlank { modelCurrentEffort }` 把“新模型未提供 effort”解释成保留旧值；[UI:321–322/356][ui-composer] 会把找不到 label 的旧 effort 原文仍拼到 chip。[Web models:68–79][web-models] 对无 reasoning roster 隐藏 effort，原生不同。 | A 模型 high→桌面切无 reasoning B→手机同步；chip 不应显示 `B · high`，模型三元组应包含正确的空 effort。 |
| **B10 / P1，高风险竞态** 提示已接收但 ACK 丢失后，手工重发可重复入队 | [VM:344–349][v-send] 不传 prompt requestId，只有成功返回才清草稿；[隧道:176–182][prompt-id] 每次请求新 mint id；[Host:399–401][host-dedup] 去重以该 id 为依据。RPC 超时保留草稿→再次发送会生成不同 id，无法利用已有去重。 | 临时会话模拟接收已成功、响应丢失；应能对账/复用同一次提交身份，或明确报告结果未知；再次操作不能无提示产生两条相同消息。本报告未造故障、未发消息。 |
| **B11 / P1，高置信度** 「断开这台设备」不清本机配对，冷启会自动回连 | [UI:89][ui-settings] 此标签只调用 leaveComputer；[VM:106–115][v-leave] leave 不删存储，只有 forget 删除；[VM:85][v-start] 冷启仍用 remembered 重连。与功能卡/现行 [Web 设置:48–49][web-settings] 的退出清除本机登录不同。 | 设置断开→关开 App，应按承诺保持断开/清本机配对；若产品要“临时断开”，应明确不同文案，不能宣称与 Web logout 相同。 |
| **B12 / P1，需设备确认** 没有后置相机/CameraX 启动失败可能崩溃 | [Manifest:5–6][manifest] camera 非必需；[Scan:72–96][scan-camera] `future.get()` 和 `bindToLifecycle(DEFAULT_BACK_CAMERA)` 没有异常显示路径；dispose 也未阻止 future listener 迟到绑定。 | 无后摄/权限运行中撤销/快速退出扫码/CameraX 异常时，应回可重试说明与粘贴入口，App 不崩，退出后不继续占用相机。 |

另需留意可选电脑名写盘失败：原生 [Relay:120–123/139][relay-name] 在 server_info 再次 save 抛错会 fail/关闭连接；Web [session:41–51][web-name] 明确把可选名称保存失败隔离于已建立连接。可作为存储故障注入候选，本轮无实际注入。

## 确定的功能/体验缺口（不当作实测 bug）

| 当前缺口 | 证据 / 与基线的差异 |
| --- | --- |
| 无桌面 Git 顶栏快速主动作；无 ahead/behind/脏态摘要与对应禁用状态表 | [NativeChatScreen:117–126][ui-top] 顶栏仅侧栏/标题/More/新建；Git 藏于 work。 [NativeGitPage:227–263][ui-git] 固定显示 Commit/Push/PR/Pull 等按钮，只对 Pull 禁止 diverged；未复用 [Web resolveGitQuick][quick] 的同状态主标签、clean 禁用、Sync branch、PR 状态决策。Git 源状态虽有 ahead/behind/changes，原生没展示。 |
| Git 数据只在打开时读，无操作后或桌面改分支后的页内同步 | [VM:440–446][v-git-open] 是唯一 Git 快照读入口；[VM:477][v-git-run] 完成只关闭面板并 toast，无 refresh；mux 只处理 Host 目录/历史。重新打开能再读，不等于任务页自动对齐。 |
| 默认分支确认第三选项有隐藏前置 | [UI:281–291][ui-git-confirm] Continue/返回常在，Checkout feature branch & continue 只有用户已在“搜索分支/新分支名称”填写 branch 时才出现。需当场提供可达输入与完整三种选择。 |
| 子智能体层级丢失，无父下折叠与显式子智能体标记 | [VM:176–178][v-catalog] 只把 parentSessionId 化为 readOnly 布尔；[NativeSession:5–14][native-session] 不保留父 id；[Sidebar:220–227][ui-sidebar] 全部同级绘制。只读发送保护已接，层级和集合要另测。 |
| 归档没有默认折叠独立分区，而且归档行可打开 | [Task:175–180][ui-search] 遍历全部 allSessions，归档只加前缀，行始终 openSession；[UI:92–104][ui-session-menu] 归档菜单仍有 Rename/Fork 等活行入口。与功能卡“点归档行不打开；仅取消归档/删除”及 [桌面 archived 入口保护][desktop-archived] 不同。 |
| 无“一个列表”视图；工作区头无单独 `+`；上下移动端点仍可点 | [Sidebar:190–229][ui-sidebar] 仅分组、头只有 More；More 有“在此目录新建”作为绕行。行菜单 [UI:97–100][ui-session-menu] 无首尾/单条检查，VM 越界后静默 return。 |
| 空会话 hero 无工作区可改 chip；创建未传复用 blank id | [Timeline:286–291][ui-hero] 仅品牌/提示；[VM:387–391][v-new] 总是 session.create(workspaceId?)。Host [commands:112–140][host-create] 提供指定 `sessionId` 的 blank 复用参数，原生没有传此参数；是否另有 Host 默认复用不能由此处单独断定。功能卡发首条前可改工作区路径尚无入口。 |
| 目录起点没有按已登记工作区父级 | [UI:56][ui-new] `browse()` 无参数；[VM:393–395][v-browse] 发空 payload；[DirectoryPicker:50][picker] 缺 path 返回 home。Web 有 [browseStartPath:129–132][web-browse] 与对应测试。 |
| 搜索无 hasMore/cap20 提示与独立归档筛选，查询归属无防护 | [VM:436–438][v-search] 只按 epoch 更新共享 panelData；[Task:168–180][ui-search] 接全部 items 无 cap/hint，搜索后仍画标题本地过滤行。查询期间编辑关键字会让旧查询返回结果与当前文本不同；离开面板后迟到结果也会覆盖其它 panelData。 |
| 真实 Queue 的展示/编辑/删除/steer 未接 | [NativeChatState:73–106][native-state] 无 queue 字段；[VM:263–294][v-mux] 对 session/queue 只落 else→刷新历史，未消费队列 items，也无 `session.updateQueue` 调用。发送确为 mode=queue，但不等于队列管理已实现。 |
| 设置 Hub 缩为主题+电脑，连接详情/通用/关于等 Web 项未对齐 | [UI:75–90][ui-settings] 只有外观、已配对电脑、移除/断开；对照 [Web settingsGroups:43–91][web-settings]。受限电脑设置可只读/冻结，不应自动承诺完整编辑能力。 |
| 连接页没有独立“忘记”热区或端点副文案；离线坏记录难管理 | [Connect:299–300/365–394][ui-saved] 已存电脑只点重连；只有成功/失败进入 Chat 后 settings 中提供移除。与现行设计“名称主、端点次、忘记独立命中区”不同。 |
| 长草稿收起阅读、图片 lightbox、消息附件读取未接；Markdown scheme 校验需实测 | [Composer:348–352][ui-composer] 仅固定最大行数；[Image:457–465][ui-image] 仅静态预览；[Markdown:469–473][ui-markdown] 使用默认 Markwon/Linkify，代码没有 http(s) scheme allowlist。禁止假定已防 `javascript:` / `intent:` 外跳；不把库默认行为未经验证说成漏洞。 |

允许的能力差异仍应保留：Files/Diff/MCP/技能冻结说明在 [work:72–73][ui-work]；消息编辑/rewind、Trajectory、Context meter、日志下载、终端/表面、Generative UI 等在功能卡 DEFER/NEVER，不把它们计为“原生已对齐”或伪装成功能。Stage/Unstage/Discard、任意 shell、credentials/MCP 写、host.pickDirectory/openPath 不应开放。

## 紧凑全量功能测试矩阵

本表每一行当前执行状态均为 **未执行**。“状态”列是必须覆盖的场景；相关历史 Web 用例可复用步骤，但 Android 必须独立操作和取证。B 编号用于优先回归。`全`指已开放原生能力，不包含上段明确冻结/禁止的桌面独占功能。

| ID | 功能 | 状态 / 操作 | 应验证结果（同电脑双端对照） |
| --- | --- | --- | --- |
| F01 | 安装/升级/冷启 | 新装；同签名递增升级；已有旧 Web 存储；迁移失败/中断；已原生数据 | 包名稳定、版本/签名身份记录；保留设备和文字草稿；迁移失败可见、无成功标记，不卸载/清数据伪造升级。无内嵌 SPA 运行。 |
| F02 | offer URL 解析 | 当前短期/长期；缺 hash、截断、v1、非法 userinfo/scheme/key/endpoint、过期；新 offer 替换旧连接 | 无效输入不假配对；错误后仍能粘贴/扫码；旧代次回复不覆盖新电脑；不在日志/UI暴露 token。 |
| F03 | 原生扫码 | 相机允许/拒绝/永久拒绝；系统设置返回；无后摄；torch；取消；旋转；退出时仍在解码 | 真扫码连接同 daemon；改粘贴自动展开并聚焦；摄像头资源释放；拒绝和无硬件有说明/粘贴（B12）。 |
| F04 | 系统 VIEW handoff | LAN `http://*:3180/#offer`；无 fragment；已运行/冷启；配置重建；公网码 App 内扫 | 完整 URL 保留且只消费一次；普通链接不误配对；系统 HTTPS 打开 browser 属现有 Manifest 行为，应记录与 App 内扫码不同。 |
| F05 | 认证/E2EE | 首配；保存证明；坏 secret；过期/用过码；长期链接重复/撤销；篡改/重放/seq/salt | 与桌面 wire 互通、鉴权失败明确；后续用 deviceSecret 新挑战，不重放 offer；存储不泄漏到消息/报告；已有设备不因链接撤销被删。 |
| F06 | 已保存电脑 | 0/1/多台；名字刷新/历史 srv 名；切电脑；忘记；断开；坏保存记录 | 名称为 hostname/我的电脑；可单独忘记且其它设备不变；断开语义与 Web 对齐（B11）；草稿、附件、迟到回复按电脑隔离。 |
| F07 | 首连失败恢复 | relay 不可达/30s超时；认证后目录失败；存储失败；重复点；快速扫码新 offer | 真实连接/目录状态；可取消/重试、保留 sticky；恢复订阅而非空目录成功（B06）；无永远 loading。 |
| F08 | 断线恢复 | 保持前台同网络短断；Wi-Fi↔移动网；后台/锁屏后恢复；认证撤销 | 横幅可见、草稿保留；自动重连后目录和当前历史补齐，当前会话不任意切第一条（B07）；认证拒绝不重试风暴。 |
| F09 | 生命周期 | 旋转/主题切换/Activity重建/进程重启；前后台快速切；网络 callback 重注册 | 不重复配对/重放写请求；不串会话；文字草稿持久化；图片进程内限制如实；连接/相机/observer 正确释放。 |
| F10 | Harness 状态 | 尚未启动；启动后恢复；目录一个 RPC 失败；空目录；旧数据 | “桌面端未启动/无法加载”可见且可重试；空态与错误区别；目录和 live mux 均恢复（B06）。 |
| F11 | 目录全集/筛选 | 正常、blank/带title blank、dshbot、scratch 无目录、删除登记孤儿、归档缺失占位 | 按桌面会员/scratch 规则对照 ID 集合；隐藏故意差异但不删数据；无假分页；当前 blank 可用但不混活列表。 |
| F12 | 分组/层级/顺序 | 工作区/无目录/空工作区；折叠；平铺；子智能体；桌面拖动工作区与会话顺序 | 分组成员、父子层级、顺序与桌面一致；子智能体只读无 Send；缺失的平铺/层级/头+明确记缺口。 |
| F13 | 列表反向同步 | 桌面新建/删除/重命名/首次标题/运行起止/归档；手机当前在另一会话 | 目录及时跟随且不抢当前选择；只传目录必要投影；无每次全详情风暴；失败有重试。 |
| F14 | 行菜单 | Rename/Fork/上移下移；空名；唯一一条/首尾；操作失败/取消 | 真写 host、桌面同名/同序；fork 新 ID/历史/归组正确；无 live Delete；端点不可用明确、不静默假成功。 |
| F15 | 归档/恢复/删除 | 当前/非当前；running；双向归档；缺失占位；取消；断线；只在临时会话永久删 | 默认折叠，点行不打开；可恢复且不自动打开；删除不可恢复提示；桌面同步；当前归档不留可用编辑器。 |
| F16 | 新会话 | 已有工作区；无目录；已有 blank；快速重复；失败；首条前更改工作区 | cwd/workspaceId 真值正确、桌面归组；能按基线复用 blank；hero 前可改后锁；附件不从 A 跑到 B（B04）。 |
| F17 | 目录浏览 | 起点；父/子/Windows盘符；长路径；截断；无权限/不存在；慢盘返回后退出 | 起点为登记目录父级；路径/crumbs 真实；错误非空态；返回不重放；迟到结果不跳回或覆盖新任务。 |
| F18 | 新目录/登记 | 合法名/重名/非法名；已有登记；创建后 session 失败；取消 | host.createDirectory→workspace.create→session.create 真实写回；已有项不重复；部分完成要说明，不能假全成功。 |
| F19 | 搜索 | 正文/标题；0/1/>20；snippet；skip/full启动；连续改词；失败；已归档/子会话命中 | 真 session.search；最多20及更多提示；当前查询与结果一致；命中 ID 正确；清词恢复全集；无错误当无结果。 |
| F20 | 打开会话/历史 | 最近3轮；空白；加载失败；快速A/B；返回重入 | 标题/ID/正文与桌面一致；失败清旧 rows、可重试；权限/Plan/model未知时不沿用 A（B08）。 |
| F21 | 历史分页 | >200行、多页、重叠 seq、无更多、分页中 live 追加、切会话 | beforeSeq 去重、旧页不丢、锚点不跳；最后消息/加载更早可达；一段历史不出现两个相同消息。 |
| F22 | 发送/多轮 | 旧仓和新目录各完整五轮；空/空白；纯图片；发送中继续编辑；双击 | 同 ID 双端同用户句/助手回合/上下文；空输入不发；只清已提交草稿；仍可新增草稿；不中途串会话。 |
| F23 | 直播/结束/停止 | 手机发/桌面发；running→idle；长任务cancel；错误/max-tokens/中断 | 1.5s运行/pending轮询或mux更新；结束最后正文不丢；空闲不高频poll；两端停止状态一致；正文不靠明文assistant/chunk。 |
| F24 | 提交未知结果 | 接收前断线；接收后ACK丢失/超时；重连/手动重发 | 未发送保留草稿；已接收可核对、不重复入队；明确未知结果而非盲目再次发送（B10）。 |
| F25 | 模型/思考 | 多/单/无模型；可路由/不可路由；无reasoning；默认/高档；目录失败；双向切换 | 三元组一致；成功才改值；失败不假选中；无reasoning隐藏旧effort（B09）；roster失败与无匹配区分。 |
| F26 | 权限 | 三预设；双向更改；写命令策略；commands失败/断网；加载中切B | commands/execute `/permission <id>` 实际生效，失败保持真实值+错误，不生成聊天气泡；只读是权限模式而非子会话锁（B08）。 |
| F27 | Plan/斜杠 | 桌面Plan开/关；点Plan off；输入`/`过滤；未知/失败命令；带图片；审批/只读 | commands/list为真相；命令走execute而非prompt；状态双向一致；审批/子会话不留可执行slash。 |
| F28 | Queue | 无队列；真实running追加多条；队列编辑/移除/steer；另一端更新 | 无队列不画假dock；有队列应消费真实items并接updateQueue；当前未接的管理能力记录缺口。 |
| F29 | 草稿/附件归属 | A/B切换；电脑A/B；New/Browse创建；长文本/选区；断线；重启 | 文字按电脑/会话持久化，图片进程内隔离；选区/滚动按会话保持；新建不继承上一张图（B04）；不因晚回媒体串台。 |
| F30 | 相册/拍照 | 取消；授权拒绝；PNG/JPEG/WebP/GIF；HEIC；10MB边界；损坏/超大尺寸；无相机app | 支持格式正常；不支持/过大明文错误、无崩溃；临时文件清理；模型不支持图片时禁止且不丢草稿。 |
| F31 | 附件历史/预览 | 手机发图；桌面发图；图文混合；切页/重启；引用不属于本会话 | 持久化附件可读/回显，严格会话授权；图片失败不空白；lightbox未实现如实记录（B02）。 |
| F32 | 审批 | 当前/非当前会话；手机允许/拒绝；桌面裁决；多pending；切走重回；带pending重连；超时 | 标题/命令/结果同桌面；保留正确client/event关联；裁决后无幽灵pending；输入与slash被接管；错会话不能答（B03）。 |
| F33 | Git初始/授权 | 非仓、空仓、干净/脏、detached、未授权cwd、登记子目录；branch RPC失败 | Initialize可达（B01）；授权错误不当“无分支”；字段/CTA同桌面；旧A读取不覆盖B（B05）。 |
| F34 | Git分支 | 搜索本地/远端；remote无local track；switchable:false；创建空名/重复/成功；双向切换 | 真检出、远端建立跟踪且非detached；不安全名禁用并说明；创建并检出可达；状态刷新。 |
| F35 | Git Commit | 路径包含/排除；无选中/无改动；自填/生成说明；new branch；失败/取消 | 只在临时仓验证log、精确文件集合与原样说明；new branch实际检出；无改动禁用/提示；不因状态过期误提交。 |
| F36 | Git Stack | commit→push→PR；push→PR；中间失败/重试；PR草稿生成/应用/保留/确认；切电脑/会话 | 一次完整顺序；只续剩余步骤，已完成不重复；PR确认只用当前归属草稿；失败可复制、busy互斥、无永久loading。 |
| F37 | Git同步/默认分支 | ahead/behind/diverged/up-to-date；默认ref Continue/Abort/new branch；桌面改分支时页仍开 | label/禁用与resolveGitQuick一致；分叉无误导Push/Pull；Abort无写入；默认三选择可达；状态保持同步。 |
| F38 | Publish/View PR | 无origin/已有origin；已有remoteURL；创建private；有/无PR；gh失败；URL打开失败 | 真发布/URL返回；不会重复建仓；PR生成与创建分开确认；只合法http(s)外开；缺夹具明确未测而非Pass。 |
| F39 | 设置/主题 | system/light/dark；主题切换时弹窗/输入中；电脑详情/忘记/退出/关于 | 本地主题不改桌面；状态/草稿保留；与Web缺页如实记录；无密钥；退出语义符合F06。 |
| F40 | 只读/冻结/NEVER | Files/Diff/MCP/技能；子会话；归档；禁止host/shell/API；Generative UI历史 | 明确冻结/电脑端说明；无假成功空列表、无受限写入口；白名单与loopback鉴权保持；不把DEFER计完整对齐。 |
| F41 | 文本/Markdown/工具 | 表格/列表/代码/链接/超长路径/emoji/中英混排；javascript/file/intent链接；工具详情/错误 | 内容可读可复制；只允许安全链接；无执行HTML；工具状态和输出对应桌面；无raw JSON替代关键可读信息。 |
| F42 | 多端并行 | 桌面+Web+原生同会话；不同会话；另端改权限/模型/归档/审批 | 所有状态以Host为准；每端当前选择独立；一个裁决清所有pending；无互踢或重复写；记录轮询延迟。 |

## 全部布局与交互表面矩阵（同样全部未执行）

至少覆盖 320dp、360dp、390dp、430dp 可用宽度与实际设备原生分辨率；浅/深/跟随系统；竖/横屏；系统字体 1.0 和放大字体；IME隐藏/显示；手势/三键导航与刘海安全区。不要把 dp 当截图像素；记录实际 density、fontScale、IME和系统条配置。每个表面核对 Android 点击目标≥48dp、无相交热区、标签/长文本可读、底部操作可达、滚动到底、TalkBack名称/焦点顺序、弹窗背景不可操作。旧 Web 用例的28px阈值不替代现行48dp。

| ID | 表面 / 状态 | 应观察结果 / 当前代码风险 |
| --- | --- | --- |
| L01 | 连接首屏：无/多保存电脑，粘贴折叠/展开，长错误，失败重试 | 主入口/端点/忘记可达；IME出现后按钮可滚；长错误不遮挡，当前缺独立忘记和端点副文案。 |
| L02 | 相机权限、扫码、手电、粘贴返回；横屏/无摄像头 | 返回/说明/粘贴均可达；预览与框不遮住按钮；退出释放相机；名称和权限操作有无障碍语义。 |
| L03 | 顶栏与侧栏：长标题/主机名、大目录、空/运行/审批/子会话 | 直角贴边、遮罩关闭、固定底栏、独立目录滚动；标题/模型完整无障碍名；Git可达；当前层级/头+缺口。 |
| L04 | 空白hero与普通时间线；长消息/工具详情/代码/图片/多页 | 起始/底部/分页锚点正确；不穿过输入卡；长行不横向挤屏；空白工作区选择缺口。 |
| L05 | composer：长模型名、Plan、running Stop+Send、长草稿、多图；IME与横屏 | 22dp细边无投影；发送不挤掉；≤360dp、running+Plan<440dp及高度<480dp三布局都检查；选区/滚动不丢。 |
| L06 | 模型搜索/无匹配/单模型/思考下钻；权限；输入选项 | 同一紧凑弹窗，列表内部滚；标题/关闭/返回和当前选中清晰；IME先收后退；原控件完整无障碍名。 |
| L07 | 审批：长命令、多操作、错误、IME/小高度 | 命令可滚可复制、允许/拒绝可达、底层Send不可操作；跨端裁决后恢复输入；错误不只6秒消失无出口。 |
| L08 | New/work/settings 短弹窗；重命名/工作区菜单；删除确认 | 背景不可触达；标题/关闭/确认固定；输入/错误可滚；切主题不丢草稿；关闭在忙碌时不能让迟到结果改新任务。 |
| L09 | 长目录任务面：crumbs/上层/新建/截断/授权错误/底部确认 | 路径可复制，父导航明确，底部确认不被IME遮；失败不显示旧目录为新请求结果。 |
| L10 | 搜索/会话管理：长snippet、无结果、>20、归档、长标题 | 当前词与结果匹配；正确空/错态；归档不误打开；返回保留聊天位置；行菜单不与列表点击冲突。 |
| L11 | Git长任务：非仓/分支/路径选择/堆叠状态/错误/长URL | 始终能滚至Publish/PR；复制错误；主动作随状态；无当前会话归属混淆；全页禁用与可取消反馈明确。 |
| L12 | 默认分支确认、PR review多行Markdown、生成候选与应用 | 三种分支选择可达；PR标题/正文编辑不被IME推出；确认/关闭不重放已完成Commit/Push。 |
| L13 | 系统媒体选择器/相机来回；旋转与进程恢复 | 返回当前会话、附件不串电脑；取消无多余图片；系统安全区不重复留白；查看失效来源明文。 |
| L14 | 统一Back/预测返回/焦点/TalkBack | IME→当前选择层→任务页/侧栏→聊天；不意外断开电脑；弹窗关闭恢复触发器、不强拉键盘；隐藏层不可聚焦。 |
| L15 | 断线横幅/6秒task notice/长错误/超时恢复 | 核心失败和重试在浮层消失后仍可达；状态变化不挤正文；错误可复制，不能只靠截断三行提示。 |

## 相关测试库存与证据边界

- Android 源码声明 **13 个 protocol JVM `@Test`**：offer 7、PairingIntent 4、RelayInterop 2；**8 个 app JVM `@Test`**：ViewModel 4、NativeChatState 4。本次只读了测试内容，**没有运行**，因此这不是通过数量。
- [RelayInteropTest][relay-tests] 的真 WebSocket + vendored crypto observer 可覆盖挑战证明、首配/保存证明、RPC错误、mux外壳、篡改/重放/salt；[fixture:54–58][relay-fixture] RPC成功值主要为 echo，不能认证真实 Host、approval关联、目录、Git、图片引用或 UI。
- [DshViewModelTest][vm-tests] 仅覆盖旧入口迁移/裸链接、迁移合并、普通切会话草稿/迟到图片、扫码转粘贴。未覆盖 connect→目录失败恢复、重连、真实发送/停止/审批、New附件串台、Git异步归属/堆叠、权限/Plan/模型同步。
- [NativeChatStateTest][state-tests] 覆盖分组helper、>200消息分页/去重、流式折叠/工具错误、审批asked/decided helper。分组helper测试直接传 NativeSession，不通过 VM catalog；审批测试没有rpcId/真实respond；未覆盖持久化图片引用。不能用这些 helper 用例宣称端到端已过。
- 唯一 [NativeUpgradeInstrumentation][upgrade-test] 比较旧 localStorage 与原生加密存储，不是全界面/Compose自动操作测试。当前 [app依赖][gradle] 没有Compose UI测试依赖；本次不运行该 instrumentation，也不读取它会访问的真实凭据。
- Web 可复用的代表性断言： [catalog.test][web-catalog-tests]（scratch/会员/归档、父目录、移动、held blank）、[models.test][web-model-tests]（会话projection优先、无reasoning隐藏、route）、[quick.test][quick-tests]（状态表）、[stack.test][stack-tests]（步骤顺序与部分重试）、[host tunnel tests][tunnel-tests]（loopback/白名单/Cookie隔离/命令/history/projections/审批）、[mux tests][mux-tests]（三stream/重连/approval关联）。均未在本次运行；Web通过也不能替代Kotlin消费层验证。

当前最缺的自动回归是 B01–B10 的 ViewModel真实状态转换/受控延迟测试、NativeImagePicker与CameraX失败/重建测试、Compose全表面布局/返回测试，以及真实桌面+中继+Android的双端状态与动作验证。矩阵不继承 [历史Web全功能执行表][cases] 的 T3 Deferred 或历史pass；设备安装、正式签名覆盖升级、相机、IME、真实AI多轮/附件/审批/Git以及全部布局，**本报告实际均未测试**。

[rules]: <../../../../AGENTS.md>
[maintenance]: <../../../../docs/maintenance/README.md>
[domain]: <../../../../docs/agents/domain.md>
[glossary]: <../../../../GLOSSARY.md>
[feature]: <../../../../docs/features/mobile-remote.md>
[module]: <../../../../docs/handbook/modules/mobile-remote.md>
[design]: <../../../../docs/design-language-mobile.md>
[decision]: <../../../../docs/decisions/implemented/product/2026-09-29-mobile-native-chat.md>
[cases]: <../../../../docs/qa/mobile-remote-full-web-cases.md>
[v-git-open]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L440-L446>
[git-status]: <../../../../src/main/git.js#L294-L297>
[git-branch]: <../../../../src/main/git.js#L1200-L1211>
[relay-rpc]: <../../../../mobile/android/protocol/src/main/kotlin/ai/deepseek/harness/mobile/remote/RelayClient.kt#L126-L133>
[ui-git]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt#L213-L263>
[host-admit]: <../../../../vendor/deepseek-harness/packages/api/session-controller/src/commands.ts#L421-L430>
[image-ref]: <../../../../vendor/deepseek-harness/packages/attachment/attachment/src/index.ts#L108-L127>
[host-history-record]: <../../../../vendor/deepseek-harness/packages/api/session-controller/src/history.ts#L434-L444>
[native-images]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeHistory.kt#L13-L14>
[v-send]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L337-L350>
[ui-image]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L457-L465>
[v-open]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L193-L224>
[v-mux]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L263-L294>
[native-approval]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeHistory.kt#L120-L133>
[v-approve]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L364-L369>
[respond]: <../../../../src/shared/dshd-host-tunnel.js#L493-L501>
[mux-approval]: <../../../../src/shared/dshd-mux-sse.js#L198-L217>
[v-new]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L387-L391>
[v-register]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L403-L409>
[ui-work]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt#L58-L73>
[v-git-run]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L456-L478>
[v-connect]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L120-L147>
[v-foreground]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L309-L321>
[v-poll]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L305-L307>
[relay-fail]: <../../../../mobile/android/protocol/src/main/kotlin/ai/deepseek/harness/mobile/remote/RelayClient.kt#L170-L184>
[v-observe]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L134-L136>
[activity]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/MainActivity.kt#L34-L101>
[ui-composer]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L313-L387>
[v-projections]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L245-L261>
[web-models]: <../../../../mobile/web/host/models.js#L68-L79>
[prompt-id]: <../../../../src/shared/dshd-host-tunnel.js#L176-L182>
[host-dedup]: <../../../../vendor/deepseek-harness/packages/api/session-controller/src/commands.ts#L399-L401>
[ui-settings]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt#L75-L90>
[v-leave]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L106-L115>
[v-start]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L83-L85>
[web-settings]: <../../../../mobile/web/ui/settings-hub.js#L43-L91>
[manifest]: <../../../../mobile/android/app/src/main/AndroidManifest.xml#L3-L43>
[scan-camera]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/ScanScreen.kt#L68-L105>
[relay-name]: <../../../../mobile/android/protocol/src/main/kotlin/ai/deepseek/harness/mobile/remote/RelayClient.kt#L116-L142>
[web-name]: <../../../../mobile/web/chisacode/session.js#L41-L51>
[ui-top]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L117-L126>
[quick]: <../../../../mobile/web/git/quick.js#L8-L37>
[ui-git-confirm]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt#L281-L291>
[v-catalog]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L161-L184>
[native-session]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatState.kt#L5-L14>
[ui-sidebar]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L185-L247>
[ui-search]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt#L167-L182>
[ui-session-menu]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt#L92-L105>
[desktop-archived]: <../../../../vendor/deepseek-harness/packages/client/ui-workspace/src/client/index.ts#L289-L290>
[ui-hero]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L286-L291>
[host-create]: <../../../../vendor/deepseek-harness/packages/api/session-controller/src/commands.ts#L112-L140>
[ui-new]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt#L50-L56>
[v-browse]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L393-L395>
[picker]: <../../../../vendor/deepseek-harness/packages/host/directory-picker/src/index.ts#L48-L60>
[web-browse]: <../../../../mobile/web/host/catalog.js#L129-L132>
[v-search]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L436-L438>
[native-state]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatState.kt#L73-L106>
[ui-saved]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/DshScreens.kt#L299-L394>
[ui-markdown]: <../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L469-L473>
[relay-tests]: <../../../../mobile/android/protocol/src/test/kotlin/ai/deepseek/harness/mobile/remote/RelayInteropTest.kt>
[relay-fixture]: <../../../../mobile/android/protocol/src/test/fixtures/relay-peer.mjs#L54-L58>
[vm-tests]: <../../../../mobile/android/app/src/test/java/ai/deepseek/harness/mobile/DshViewModelTest.kt>
[state-tests]: <../../../../mobile/android/app/src/test/java/ai/deepseek/harness/mobile/NativeChatStateTest.kt>
[upgrade-test]: <../../../../mobile/android/app/src/androidTest/java/ai/deepseek/harness/mobile/NativeUpgradeInstrumentation.kt>
[gradle]: <../../../../mobile/android/app/build.gradle.kts#L53-L76>
[web-catalog-tests]: <../../../../mobile/web/host/catalog.test.js>
[web-model-tests]: <../../../../mobile/web/host/models.test.js>
[quick-tests]: <../../../../mobile/web/git/quick.test.js>
[stack-tests]: <../../../../mobile/web/git/stack.test.js>
[tunnel-tests]: <../../../../src/shared/dshd-host-tunnel.test.js>
[mux-tests]: <../../../../src/shared/dshd-mux-sse.test.js>
