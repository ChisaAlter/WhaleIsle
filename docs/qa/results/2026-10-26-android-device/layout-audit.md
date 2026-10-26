# Android 原生界面静态布局审查 — 2026-10-26

本报告用于 lead 安排真机全量 UI/功能检查。只读取共享工作区源码和设计文档；未连接、操作或安装手机，未启动产品、执行构建或测试，未执行 Git 操作，未修改产品。唯一写入为本报告。下文的“可确认”指源码直接表达的行为；“风险”仍须真机观察，不作为实机 Fail 或 Pass。

## Lead 先看

1. **跨电脑目录残留是优先功能检查项。** 断开/换电脑只重置聊天状态，没有清空工作区和完整会话目录。新连接认证后先解除 offline，再读取目录，旧电脑目录可能在新电脑名下出现并被点击。见 Q01。
2. **长回复滚动有确定的错误判断。** 自动跟随按“最后 5 条消息”判断，随后定位最后一项的起点；短会话和一条很长的流式回答尤其容易被拉回。见 Q02。
3. **横屏 + IME + 多行草稿/附件，以及长审批，是最高优先尺寸组合。** 输入卡/审批卡没有按剩余高度限制总高度；内部控件可能挤走消息区或让工具/审批动作失去可见高度。见 Q03、Q04。
4. **同步、空目录和失败尚不能准确区分。** connected 在目录返回前已为 true，目录失败时抽屉可显示“还没有会话”；首屏连接失败则已经切入空聊天壳。见 Q05、Q11。
5. **大字、系统栏和宽屏需完整截图。** 聊天 52dp 顶栏及扫码 48dp 顶栏容纳双行 sp 文字；系统主题仍固定 Light/白色栏；两个宽度上限写在 fillMaxWidth/fillMaxSize 后，不产生预期的居中窄列。见 Q06、Q07、Q08、Q20。
6. **富内容不能笼统签收。** Android 只有 TextView + Markwon core/linkify；没有代码横向滚动、语义链接/代码主题接入或图片放大。generative_ui 明确要求到电脑查看；Files/Diff/MCP/技能也仍是能力说明，不能算已交付移动功能。见 Q16–Q18 和能力表。
7. **所有短弹窗共用一个实现。** 标题/关闭在滚动正文外、IME 与安全区取 union 是已具备的防护；无需先假定“双重 IME 留白”。重点查极矮高度下固定头尾占满空间、两个非换行底部按钮、大字外观分段和旋转状态。见 Q13–Q15。

## 已读范围与依据

先读了 [AGENTS.md](../../../../AGENTS.md)、[维护说明](../../../../docs/maintenance/README.md)、[领域指引](../../../../docs/agents/domain.md) 和 [GLOSSARY.md](../../../../GLOSSARY.md)。在 mobile 树内检索 AGENTS.md，无匹配。读取 [设计语言](../../../../docs/design-language.md#L89-L128)、[Android/手机例外与现行手机节](../../../../docs/design-language.md#L209-L227)、[完整手机交互合同](../../../../docs/design-language-mobile.md)、[手机远程模块](../../../../docs/handbook/modules/mobile-remote.md)，以及相关历史决定。旧 Claude 结构已明确被 2026-10-25 合同取代；[2026-09-29 原生聊天决定](../../../../docs/decisions/implemented/product/2026-09-29-mobile-native-chat.md)中“后台 WebView/旧版工作页”的实现描述也已被现行 Kotlin 模块说明与当前源码取代，不用它收缩本轮范围。

已读 app/src/main 下全部含 Compose 的文件、主题、状态/历史折叠与 ViewModel，另读系统主题/Manifest、媒体选择与旧数据迁移、存储接口/实现。图标二进制未做像素比对；本轮只确认使用同源资源入口。必要 Web 对照仅用于解释 Android 的差异，不代替 Android 真机验证。

| 缩写 | 源码入口 |
| --- | --- |
| A | [MainActivity.kt](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/MainActivity.kt) |
| C | [NativeChatScreen.kt](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt) |
| N | [NativeChrome.kt](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChrome.kt) |
| R | [NativeRemoteScreen.kt](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt) |
| D | [DshScreens.kt](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/DshScreens.kt) |
| S | [ScanScreen.kt](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/ScanScreen.kt) |
| V | [DshViewModel.kt](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt) |
| H | [NativeHistory.kt](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeHistory.kt) |
| ST | [NativeChatState.kt](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatState.kt) |
| T | [DshTheme.kt](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/theme/DshTheme.kt)、[DshTokens.kt](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/theme/DshTokens.kt) |
| M | [DshMotion.kt](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/DshMotion.kt) |

现行合同关键数值：正文 14/22、辅助 12/18、输入 16/24；Android 点击目标至少 48dp；输入卡 22dp、无外投影；短弹窗内部滚动、标题/关闭/必要动作留在可见区；侧栏贴边直角、目录独立滚动；操作反馈不挤动原布局；返回先收 IME，再退当前层。依据：[手机合同 19–35](../../../../docs/design-language-mobile.md#L19-L35)。

## 界面、弹窗与状态矩阵

下表列出当前实际实现的表面和状态。所有项均为静态枚举，实机结果待 lead 填写。

### 连接与系统入口

| ID | 表面 / 入口 | 必测状态 | 布局、返回与边界 |
| --- | --- | --- | --- |
| E01 | 根窗口，[A:56–84](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/MainActivity.kt#L56-L84) | system/light/dark；系统明暗变化；竖横屏；手势/三键导航；IME 开关 | edge-to-edge；外层 safeDrawing ∪ ime；分别进入 Connect/Permission/Scan/Chat。系统栏另见 Q20。 |
| E02 | 连接首屏，[D:268–328](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/DshScreens.kt#L268-L328) | 无设备；1 个/多个设备；同名设备；长主机名；扫描按钮；粘贴收展 | 上半品牌、下半限高滚动 dock；保存电脑排在主动作之前。没有 endpoint 与独立忘记入口。 |
| E03 | 粘贴字段，[D:311–318](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/DshScreens.kt#L311-L318) | 空值、完整 offer、缺 #offer、超长 URL；权限/扫码转入后焦点；软键盘 | 单行 16sp、内部水平编辑；聚焦请求已实现；根连接面未提供单独 BackHandler 收起“粘贴展开”状态。 |
| E04 | 配对与保存设备重连，[V:85–147](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L85-L147) | 解析失败；认证中；认证成功+慢目录；连接失败；无保存凭据的重试；已保存凭据的重试；新 offer 替换旧连接 | 合法 offer 后立即 Route.Chat，连接首屏消失；“正在连接电脑…”在聊天通知层显示。错误有首屏 error 与 chat.error 两套呈现。 |
| E05 | 相机权限说明，[D:332–361](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/DshScreens.kt#L332-L361) | 首次拒绝、永久拒绝、设置返回、改用粘贴、横屏/大字 | 两个操作均在滚动 dock；Permission 本身没有返回 Connect 的自定义 BackHandler，系统 Back 行为需观察。 |
| E06 | 原生扫码，[S:61–269](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/ScanScreen.kt#L61-L269) | 预览初始化；可识别/无效 QR；连续 QR；手电开关；粘贴；Back；横屏；后台恢复；相机不可用 | 固定 48dp 双行头部；中间相机 weight；底部粘贴和说明不滚动。二维码扫描器遇首个 QR 就交回，校验失败回连接页。无相机/初始化失败/不支持闪光灯没有专用可见状态。 |
| E07 | 系统权限/系统设置/相册/拍照/浏览器，[A:41–43/63–81](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/MainActivity.kt#L41-L81)、[媒体选择](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/NativeImagePicker.kt#L28-L85) | 授权/拒绝/取消；拍照旋转；选图超 10MB/不支持格式；外部应用不存在；在系统页期间切电脑或会话 | 系统表面不是 Compose；附件归属校验已实现。取消不添加附件，失败走聊天 banner。 |
| E08 | 升级迁移，[旧数据读取器](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/LegacyStorageMigration.kt#L15-L46)、[A:52–55](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/MainActivity.kt#L52-L55) | 无旧数据、成功、解析失败、10 秒超时 | WebView 是不可见迁移读取器，无产品 UI；失败写首屏 error，原数据保留。未发现可见迁移进度或重试按钮；下次启动会再判定迁移。 |

### 聊天、侧栏与输入状态

| ID | 表面 / 入口 | 必测状态 | 布局、返回与边界 |
| --- | --- | --- | --- |
| C01 | 聊天顶栏，[C:117–127](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L117-L127) | 有/无主机名；长标题/主机名；offline；大字；横屏 | 52dp 高，左菜单、标题+主机双行、更多、新会话；当前没有 Git 分支/动作胶囊。 |
| C02 | 贴边侧栏，[C:91–113/185–248](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L185-L248) | 打开/关闭/遮罩/Back；分组展开收起；当前会话；运行/审批点；长目录；无工作区/无会话；同步失败 | RectangleShape；宽 min(340dp, 90%屏宽)；品牌、新会话、搜索/管理在上；中间 LazyColumn；电脑/设置底栏在下。没有独立 catalog-loading/catalog-error 字段。 |
| C03 | 时间线，[C:270–294](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L270-L294) | 空白新会话、加载中、加载失败、长历史、增量回复、加载更早、上翻阅读时更新、不同会话往返 | 列表按 session 保存；普通空态头像+问候，矮屏隐藏头像/辅助文案；无“到底部”入口，自动滚动见 Q02。 |
| C04 | 消息内容，[C:435–473](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L435-L473)、[H:17–117](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeHistory.kt#L17-L117) | user/assistant/reasoning/tool/error/meta；长文本/代码/链接/图像；工具详情收展 | 用户气泡右对齐；assistant 为 Markwon；其余为 Compose 可选择纯文本。工具详情可展开，但未做独立有界滚动。 |
| C05 | 连接与错误通知，[C:298–309](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L298-L309) | connLabel、offline、chat.error、banner；重试；多行错误；自动消失；打开弹窗时隐藏 | 时间线上方叠加，不占正文；最多 3 行省略；在线普通状态 4 秒/error 6 秒消失，offline 不自动消失。仅 error/offline 有重试按钮。 |
| C06 | 常驻输入卡，[C:313–391](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L313-L391) | 无 session 禁用；空草稿；长草稿；1/多张图；model/effort 长标签；idle/running/queue/busy/offline；Plan on/off | 22dp Surface、无 elevation；宽度满屏减 24dp。正常输入 2–6 行/48–144dp，矮屏 1–3 行/24–72dp。窄屏可两行工具轨；矮屏优先单行精简工具轨。 |
| C07 | 输入工具状态组合，同 C06 | 320dp；running+Plan；running+attachments；IME+横屏；大字+长模型名；仅图片发送；模型不支持图片 | 固定图标 48dp；model 为 weight、单行省略。图片支持校验在发送前，失败保留附件。忙碌时附加/停止/发送等按 available 禁用；普通草稿仍可输入。 |
| C08 | 斜杠建议，[C:323–335/394–398](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L323-L398) | /、前缀匹配、无结果、含空格关闭；长 hint/description；键盘中选择/Back；上方空间不足 | Popup 不获取焦点，按 composer 顶边向上放置，顶部至少 0；高最多 96/192dp；点击后填入命令，不自动发送。 |
| C09 | 审批卡，[C:132–137/403–417](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L403-L417) | 短/长 title/reason；拒绝/允许一次；busy/offline；连续审批；审批期间键盘仍开；readOnly+approval | 审批优先于只读和输入卡；背景发送卡被移除，不能继续点发送。正文 64/160dp 限高滚动，标题和 FlowRow 动作不受总高度约束，也未沿用输入卡尺寸。 |
| C10 | 只读状态，[C:132–137](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L132-L137) | 归档/子会话；长只读说明；只读历史分页；只读上有待审批 | 普通 composer 替换为文本说明；未提供统一卡面与固定高度。审批+只读时 UI 动作可呈 enabled，但 [V:329](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L329)会拒绝 approve，需条件覆盖。 |

### 紧凑弹窗、行菜单与确认层

所有短弹窗复用 [N:148–174](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChrome.kt#L148-L174)：居中、max 440dp、safeDrawing ∪ IME、标题/关闭置于滚动正文外。需要同时覆盖短内容、超长列表、横屏、IME、大字、关闭后焦点与聊天草稿。

| ID | 弹窗 / 入口 | 全部状态与操作 | 关键布局与恢复 |
| --- | --- | --- | --- |
| P01 | 模型，[C:142–169](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L142-L169) | 搜索；按 provider 分组；当前项勾选；无结果；有/无 efforts；busy/offline；长 label | 搜索字段随正文一起滚动；没有 sticky 搜索区。模型标签最多两行。 |
| P02 | 思考强度，同 P01 | 模型名；当前 effort；选择；返回模型层；Back 先收键盘 | 同一个 Dialog 更换内容，顶部出现返回。下钻后正文 ScrollState 仍为同一 remembered 值，需查切层是否落在旧滚动位置。 |
| P03 | 权限 / 矮屏“输入选项”，[C:170–178](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L170-L178) | 仅可查看/可写入工作区/完全权限；当前勾选；无权限选项；Plan 开启后的关闭 Plan | 矮屏把权限/Plan 收到输入选项，避免额外 Plan 文字占工具轨。 |
| P04 | 添加图片，[A:80–83](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/MainActivity.kt#L80-L83) | 从相册、拍照、关闭；系统取消/权限失败回返 | 选择来源后关闭 Dialog，再进入系统表面；旋转时 attachmentSource 为 remember，会丢选择层。 |
| P05 | 新会话，[R:50–57](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt#L50-L57) | 无工作目录；已有工作区；浏览目录；创建中/读取中；错误；offline | 固定 64dp 提示/错误槽避免错误新增一行；工作区和操作同正文滚动。busy 会将“无工作目录”和“浏览目录”同时改为忙碌文案，未区分触发项。 |
| P06 | 会话与工作区，[R:58–74](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt#L58-L74) | 新建、搜索、Git、设置、重新同步/重连、每个工作区；忙碌/失败 | Git 为此层入口，主聊天顶栏没有 Git 胶囊；Files/更改/MCP/技能只读说明保持可见。 |
| P07 | 设置，[R:75–90](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt#L75-L90) | system/light/dark；多设备/同名设备/长 endpoint；移除；重连；断开 | 外观三等分横排内嵌 NativeChoiceRow，选中勾也占宽；已配对电脑名称+endpoint，移除独立按钮。 |
| P08 | 管理会话，[R:92–105](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt#L92-L105) | 改名；Fork；上/下移；归档/取消归档；归档项永久删除；busy/offline | 改名字段+动作都在滚动正文；提交后立即关此窗，异步错误转聊天/任务通知。行边界上/下移仍显示，ViewModel 对无效移动直接返回。 |
| P09 | 管理工作区，[R:107–114](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt#L107-L114) | 长完整路径；新会话；改名；移除；busy/offline | 路径无省略，会长行换行；提交后关窗，未将失败保留在原字段。 |
| P10 | 三种移除确认，[R:116–134](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt#L116-L134) | 永久删归档会话；移除工作区登记但保留目录；移除本机凭据但保留草稿；取消/确认/busy | 标题统一“确认移除？”；取消/确认在固定尾栏普通 Row，未自适应换行。确认可叠在原管理/设置 Dialog 上。 |
| P11 | PR/MR 审阅，[R:265–280](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt#L265-L280) | 标题；多行 Markdown 正文；生成/重新生成；候选预览；应用；确认；保留草稿；busy/offline | 必要确认动作在尾栏；生成候选未限高但在正文滚动内；固定两按钮 Row 与 IME 高度见 Q13。标题/正文存 ViewModel，可跨旋转。 |
| P12 | 默认分支确认，[R:281–292](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt#L281-L292) | 返回、继续；已填分支名时“创建工作分支并继续”；关闭 | confirmation 为 remember，旋转会消失；底部按钮不换行。 |

### 长任务面

| ID | 表面 | 状态与操作 | 滚动、键盘与恢复 |
| --- | --- | --- | --- |
| T01 | 目录浏览，[R:138–191](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt#L138-L191) | 根/子目录；上一级；长路径；无目录；截断列表；新文件夹字段；创建；使用当前目录创建会话；读取/创建失败 | 56dp 顶栏，LazyColumn 正文，固定底部确认；Back 先收 IME，再回“新会话”。新文件夹字段位于所有目录项之后，长列表需滚到底。 |
| T02 | 会话管理/全文搜索，[R:167–182](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt#L167-L182) | 标题实时过滤；搜索消息内容；未搜索/搜索中/无结果/旧结果/失败；归档/只读/正常；行菜单 | 搜索字段与触发按钮属于列表首项，会随结果滚走；消息结果最多两行主文+两行 snippet；无按命中位置跳转的实现。新搜索请求期间仍可显示旧 panelData 结果。 |
| T03 | Git 长任务，[R:213–264](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt#L213-L264) | 非仓库初始化；当前/长分支名；搜索/切换/创建分支；提交说明；工作分支 Checkbox；文件勾选；Commit/Commit & Push/Commit,Push & PR/Push/Push & PR/Pull/View PR/Publish | 整个 Git 是 LazyColumn 的单个 item，分支和文件全部 eager forEach；没有底部固定主动作。长列表可能把提交/发布动作推得很远。 |
| T04 | Git 状态流，同 T03，[V:456–529](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L456-L529) | busy；默认分支确认；分叉禁 Pull；部分完成与继续；生成 PR；确认；写入失败；电脑/会话切换中止 | 剩余动作信息会新增在正文顶部，成功后直接关任务面+banner；步骤恢复有 owner 检查。失败 banner 不是 Git 表单的常驻原因说明。 |
| T05 | 任务通知，[R:196–203](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt#L196-L203) | 短/长错误；6 秒消失；重复相同错误；IME/长目录/表单下方 | 叠在正文顶部、不挤动；没有 maxHeight、滚动、行数或可关闭边界，长消息可遮满正文。 |
| T06 | 聊天与任务往返，[R:33–46](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt#L33-L46) | 进入任务、Back 返回、旋转、当前会话草稿/选区/列表位置 | 任务面替换聊天 composition；SaveableStateProvider 按连接 epoch + session 保存聊天 saveable 状态。任务 query/Git 编辑等只是 remember，不能继承同样保证。 |

未接线的 Compose： [D:215–240 的 NavigationRecoveryBanner](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/DshScreens.kt#L215-L240)只声明，app/src/main 中没有调用点；[M 的 overlay/popover/mask/drawer 动效 helpers](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/DshMotion.kt#L47-L100)也未在上述表面接线。不能把这些 helper 算成可达页面或已验收动画；当前 Dialog/Drawer 依靠 Compose/Material 默认行为。

## 可定位问题与风险

优先级：P1 = 最先安排真机复现、可能影响主要流程/数据归属；P2 = 布局、可读性、恢复或桌面一致性问题；P3 = 可用性补充。置信度“可确认”只表示源码事实清楚，仍不等于已复现实机像素。

### P1

**Q01 — 换电脑时保留上一台电脑目录，可误导新会话/管理操作（可确认状态残留，是否出现窗口取决于时序）。**

定位：[V:106–110/120–143](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L106-L143)、[V:161–184](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L161-L184)、[R:40/52–69](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt#L40-L69)。leaveComputer/connect 只重置 chat/history 等，未清 workspaces、allSessions。认证后先设 offline=false 再串行 session.list、workspace.list；原目录继续传给侧栏和“新会话”。这会在 B 电脑上下文显示 A 的目录；若两端同步慢或失败，旧条目仍可能可点。真机：A→断开→B，制造慢/失败目录请求，在侧栏、新会话、工作区管理、会话搜索逐一核对目录归属和 enabled 状态。

**Q02 — 时间线自动滚动按消息索引误判，并定位长消息起点（可确认）。**

定位：[C:274–278](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L274-L278)。条件是 firstVisibleItemIndex >= rows.size-5，未检查最后可见项、offset 或剩余像素；rows≤5 时条件恒覆盖任意阅读位置。scrollToItem(bottom) 把最后一项起点对齐，不是长消息底部。长流式内容可能反复拉回开头，也可能在用户上翻时强制跳。Web 已按 scrollHeight/clientHeight/scrollTop 决策并保留 prepend anchor，见 [Web:1633–1674](../../../../mobile/web/app.js#L1633-L1674)。真机：2–5 条消息中的 200 行回答、50 条历史中的最后一条长回答、主动上翻阅读、加载更早四种分别验证。

**Q03 — 输入卡没有剩余屏高总预算，横屏+IME 可让工具轨被压缩（高置信布局风险）。**

定位：[C:116–138](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L116-L138)、[C:337–387](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L337-L387)。顶栏固定 52dp、时间线为 weight、composer 非 weight；composer 的附件、编辑框和工具轨又依次排在内部 Column。矮屏满三行草稿+图片在默认字号时约需 214dp 输入座位，连顶栏约 266dp。键盘出现后若可用高度低于此预算，后测量的工具轨/时间线可能失去高度；没有对总卡片限高、折叠附件或保留工具轨的约束。真机：320dp 竖屏和最矮横屏，三行/超长草稿、2 张图、running，打开键盘，确认添加/模型/更多/停止/发送全部可见可点，消息末尾止于输入卡上方。

**Q04 — 审批卡高度独立于输入卡，长标题/多行按钮无总限高（可确认合同差异+布局风险）。**

定位：[C:403–417](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L403-L417)，对照 [设计语言:75](../../../../docs/design-language.md#L75)、[手机合同:29](../../../../docs/design-language-mobile.md#L29)。普通 composer 被完全替换，未保存/复用其尺寸；只有 command/error 正文被限 64/160dp，title 可无限换行，动作 FlowRow 可多排。默认短审批在矮屏连顶栏约 250dp，长 toolName、大字、键盘未收起时更高。需要测审批到达瞬间的聊天位置、长命令卡内滚动、拒绝/允许是否始终在屏内，以及取消/完成后的草稿选区恢复。只读+审批组合还需验证 UI enabled 与 [V:329](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L329)拒绝动作的一致性。

**Q05 — 认证成功≠目录同步成功，但 UI 以 connected 判空（可确认）。**

定位：[V:141–147/161–184](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L141-L184)、[C:232/242–243/285–290](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L232-L290)。connected 在 refreshCatalog 前置 true；没有单独 catalog loading/error。空分组在同步中/失败后可被标“还没有会话”，主聊天在 sessionId 尚空时也显示品牌空态。失败消息浮层超时消失后，目录可继续呈空而无持久失败说明。原界面仍有“更多→重新同步”恢复入口，但状态准确性不满足 [手机合同:15/19](../../../../docs/design-language-mobile.md#L15-L19)。真机：认证成功后阻塞 session.list/workspace.list、已有目录刷新失败、真正空目录三态截图对照。

### P2：尺寸、弹窗与恢复

**Q06 — 聊天和任务顶栏的固定 dp 高度不能覆盖大字双行内容（高置信布局风险）。**

定位：[C:117–124](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L117-L124)、[R:148–151](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt#L148-L151)。聊天两行行高 24sp+18sp，固定 52dp，fontScale≈1.3 已超过垂直预算；没有根据大字增高或隐藏次级行。任务标题没有 maxLines/ellipsis，56dp 内长中文标题在 320dp/大字可换三行。可能出现裁切或向相邻区绘制，需完整截图确认。标题和其他图标均有 weight/固定按钮，横向长标题本身会省略而不会无限挤掉两侧按钮，是已具备防护。

**Q07 — 扫码页矮屏只压缩相机，不重排固定头尾（高置信布局风险）。**

定位：[S:115–168/195–266](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/ScanScreen.kt#L115-L266)。头部 48dp 内 22+16sp 两行；底部粘贴面不滚动，中间相机 weight 承担全部压缩。横屏/大字时取景框随 minDimension×0.62 缩小，48dp 手电浮层和底部 18sp 提示可能覆盖整个有效扫描框。底部粘贴可视 pill 固定40dp，高字号文字也有裁切风险。真机须看到完整相机框、提示和手电边界，不只点到粘贴。

**Q08 — 连接 dock 与相机宽度上限被前置 fill 约束抵消（可确认约束顺序）。**

定位：[D:185–189](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/DshScreens.kt#L185-L189)、[S:160–164](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/ScanScreen.kt#L160-L164)。fillMaxWidth().widthIn(max=440dp)、fillMaxSize().widthIn(max=520dp) 中，前一 Modifier 已把 incoming width 固定为父可用宽；后面的 widthIn 无法减小固定 minWidth，因此横屏/平板仍会铺满。此项影响桌面式紧凑度及控制距离，通常不会直接重叠。注意 [N:156](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChrome.kt#L156)的 widthIn(...).fillMaxWidth() 顺序是相反的，不应一起误报。

**Q09 — 长任务错误浮层无高度/滚动上限，可遮住全部工作面（可确认结构风险）。**

定位：[R:196–203](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt#L196-L203)。NativeTaskNotice 在任务正文 Box 顶部叠放完整 message；没有 maxLines、maxHeight 或 verticalScroll，长 Git stderr/目录错误会变成大块遮盖。6 秒后自动隐藏，但重复相同 banner 文本不会触发以 message 为 key 的新计时。聊天通知虽有 3 行上限，完整错误也仅省略，没有“展开原因”入口。需触发长错误观察确认按钮/字段是否被遮挡及重试仍可达。

**Q10 — 连接首屏错误新增正文块，改变 dock 与主操作位置（可确认）。**

定位：[D:283–298](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/DshScreens.kt#L283-L298)，对照 [操作反馈规则:120–128](../../../../docs/design-language.md#L120-L128)。error 非空时插入最高两行+16dp padding 的块；dock 是 bottom 锚定的内容高/限高滚动层，错误出现后会改变其内容分配、滚动范围和相邻按钮位置。错误又被两行省略，长迁移/配对原因无法完整读到。真机从原入口触发空/畸形链接，比较操作前/后完整 dock。

**Q11 — 连接状态离开海天首屏，保存电脑入口还缺 endpoint/独立忘记（可确认合同差异）。**

定位：[V:127–128](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L127-L128)、[D:299–305/365–394](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/DshScreens.kt#L299-L394)。合法链接后立即进入空聊天壳，首屏按钮不显示原位忙碌/失败，失败也停留聊天壳；与 [手机合同:13–15](../../../../docs/design-language-mobile.md#L13-L15)的连接 dock 行为不同。保存电脑只显示 name+泛化副文案，同名电脑无法区分，忘记只能先进入聊天设置。设备多或长名时，全部记录在扫码按钮之前，扫码主动作可能被卷到 dock 下方。Web 有 endpoint/日期/同名序号和独立忘记，见 [Web:578–617](../../../../mobile/web/app.js#L578-L617)。

**Q12 — 长草稿没有阅读收起状态，大字时编辑行数与 dp 高度上限冲突（可确认缺失+风险）。**

定位：[C:318–352](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L318-L352)。只有固定 144/72dp 上限，没有点击聊天收起长草稿、返回编辑恢复高度的交互。[手机合同:29](../../../../docs/design-language-mobile.md#L29)与 [Web composer behavior](../../../../mobile/web/ui/composer-behavior.js#L1-L34)有该能力。16/24sp 字体放大后几行文本就达到 dp 上限，视口中可见行数减少，需查选区手柄、光标跟随、内部滚动及键盘关闭后的阅读空间。草稿/选区使用 TextFieldValue.Saver，已有保存基础，不能把此风险写成文字必丢。

**Q13 — 弹窗在极矮高度下固定头尾可能占满高度，底部按钮不换行（高置信风险）。**

定位：[N:154–170](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChrome.kt#L154-L170)、[R:116–127/265–269/281–285](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt#L116-L285)。正文 weight(fill=false) 可滚动，头至少56dp，反馈槽64dp，尾操作另占高；屏高扣掉 IME 和32dp margin 后若极短，正文甚至必要尾操作可无空间。确认尾栏使用普通 Row、未 FlowRow，320dp+fontScale2 时“保留草稿/确认创建”“取消/确认移除”可能多行、被挤压或部分不可见。短模态要测 IME 首次 Back 仅收键盘、再次 Back 下钻/关闭、关闭后焦点和键盘不被强制重开。代码没有明确的触发器 FocusRequester 恢复，Compose 默认行为需实测，不能静态称已通过。

**Q14 — 外观三等分内嵌通用行，窄屏大字造成标签/勾选争宽（可确认结构+风险）。**

定位：[R:77–80](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt#L77-L80)、[N:118–128](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChrome.kt#L118-L128)。320dp Dialog 内容约264dp，每段约88dp，扣左右24dp、勾16dp、gap10dp后当前项仅剩约38dp供文字；“跟随系统”在正常字级就可能两行，大字两行省略会隐藏关键字。通用行不是紧凑 segmented 控件。需检查选中前后段高是否突变、三段是否仍等高可识别。

**Q15 — 横竖屏切换会丢任务表单和部分弹层状态（可确认保存策略）。**

定位：[R:29–32/144–146/219–225](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt#L29-L225)、[C:67–69](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L67-L69)、[A:58](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/MainActivity.kt#L58)。Git 分支/提交说明/remote/repositoryName/featureBranch/selectedFiles、搜索 query/searched、新目录名、会话/工作区改名选择层、默认分支确认都只是 remember。Activity 正常配置重建后消失；PR 标题正文则在 ViewModel、聊天草稿选区和时间线有 saveable。真机应在每种字段写入不同文本后旋转，不以聊天草稿幸存推断整个应用可恢复。

### P2：对话富内容、主题与桌面一致性

**Q16 — 原生 Markdown 没有接完整语义主题，也没有代码水平滚动（可确认）。**

定位：[C:469–473](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L469-L473)、[依赖:57–58](../../../../mobile/android/app/build.gradle.kts#L57-L58)。TextView 只 setTextColor，Markwon 只启用 LinkifyPlugin；没有 setLinkTextColor、语义 code 背景/heading/quote 样式配置、HorizontalScrollView/horizontalScroll 或 setHorizontallyScrolling。链接颜色及代码等细节会来自 Android/库默认；Light 应用主题下只切 Compose 深色也不会改其默认文本链接主题。长代码默认 TextView 会折行，违背 [代码不换行合同](../../../../docs/design-language.md#L53)。Web 在 [app.css:1387–1408](../../../../mobile/web/app.css#L1387-L1408)显式用等宽、white-space:pre、overflow-x:auto 和业务链接色。需验证深浅主题、系统大字、单行500字符代码、URL、嵌套列表、引用、长链接选择与点击；不应把 core Markdown 全部称“桌面富内容一致”。

**Q17 — 表格、数学、图示、Markdown 图片和可执行交互内容不具备桌面能力（明确限制，另列防止误签）。**

定位：[H:39–53](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeHistory.kt#L39-L53)、[C:469–473](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L469-L473)。没有 table/LaTeX/图表/image-loader 等插件或 Compose 对应 renderer；Markdown 表格等应按普通文本/库回退观察，不能标交互通过。generative_ui 明确显示“需要在电脑端查看”；[Web fold:199–204](../../../../mobile/web/conversation/fold.js#L199-L204)也是同一限制。未知 item 类型显示“暂不支持”，原始事件流也只折已列出的事件类型。文件链接没有与原生文件预览集成，普通链接由 TextView/系统处理，不能据此称附件可在工作环内预览。

**Q18 — 图片只有内联缩略内容，无放大/缩放/原图阅读；解码还在 UI composition（可确认+性能风险）。**

定位：[C:340–345/445/457–465](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L340-L465)、[媒体格式入口](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/NativeImagePicker.kt#L69-L82)。消息图高最多280dp、附件40/56dp，图片本身无点击放大/zoom 状态；附件点击是直接移除。Base64解码+BitmapFactory 在 remember 块同步运行，最多10MB的图片和多图历史会给主线程/GC施压；没有 EXIF 方向处理，GIF 仅 BitmapFactory 静态帧。Web 消息图可开 lightbox，见 [Web:1537–1547](../../../../mobile/web/app.js#L1537-L1547)、[Web lightbox](../../../../mobile/web/app.js#L6114-L6143)。真机覆盖长图/截图文字/横拍JPEG/动态图/坏数据/多图滚动，分别记录“可显示”和“可阅读”。

**Q19 — Git 大列表没有虚拟化，复选框旁标签不整行可点（可确认+规模风险）。**

定位：[R:184/241–248](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt#L184-L248)。Git 被包成外层 LazyColumn 一个 item，内部对全部分支和文件 forEach；大仓库会同时 composition/measure 全表，输入键盘后也缺分区定位。Checkbox 之后的 Text 不是 toggleable/点击标签，只能点 Checkbox 本体；长文件路径全换行，会拉高表单并把动作推出首屏。需覆盖几百条分支/文件、深路径、长分支名；判断卡顿和操作到达成本，不用少量fixture推断大目录通过。

**Q20 — 系统栏仍固定 Light/白色，与 Compose 深色没有完整联动（可确认配置，像素结果依 Android版本）。**

定位：[系统主题:3–6](../../../../mobile/android/app/src/main/res/values/themes.xml#L3-L6)、[A:46/59–61](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/MainActivity.kt#L46-L61)、[SDK范围](../../../../mobile/android/app/build.gradle.kts#L9-L15)。window theme 为 android:Theme.Material.Light.NoActionBar，statusBarColor/navigationBarColor 固定白；只改 isAppearanceLightStatusBars，未显式更新栏底色/导航栏图标。Android8–14 路径可能出现白栏或白色状态文字落在白栏，target36在新系统又有强制 edge-to-edge 差异。需浅/深+手势/三键导航截完整屏幕与系统栏；不要只截 Compose 内容。

**Q21 — 桌面信息层级尚有可确认差异（产品/视觉核对项）。**

定位：[C:117–127/185–248/287–290/337–387](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L117-L387)、[N:49–63](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChrome.kt#L49-L63)。已有贴边直角侧栏、同源头像、按工作区分组、22dp输入卡，但顶栏没有 Git 胶囊，必须“更多→Git”；空白草稿只有“选择工作区”文案，没有画布内工作区选择控件；新会话是36dp近黑主胶囊，Web是36px中性导航行；Android 字标始终中文优先，不随语言切换；普通输入卡没有 Web 的静止内轮廓光/运行beam。以上不能以“已桌面化”总括，需按现行合同及用户桌面体验目标逐项记录接受程度。[手机合同:23/27](../../../../docs/design-language-mobile.md#L23-L27)、[品牌合同](../../../../docs/design-language.md#L26)。

### P3：点击区域、长标签和焦点

**Q22 — 个别自绘点击区域没有显式48dp保留空间，扫码返回无可读名称（部分可确认）。**

定位：[C:448](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L448)、[C:342–345](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L342-L345)、[S:125–133](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/ScanScreen.kt#L125-L133)、[M:36–44](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/DshMotion.kt#L36-L44)。工具“查看详情”文字布局约18+16=34dp高；矮屏附件可点列宽40dp；Compose clickable 可能自动扩触控区，但未在布局中保留48dp，需检查相邻命中与可访问边界，不能静态直接断言实际点击面积不足。扫码返回是可点Canvas，无contentDescription/可见Text，TalkBack无法获得有意义的“返回连接页”名称。其余 NativeIconButton 明确48dp并有完整description，是已具备防护。

**Q23 — 通用行最多两行省略，深路径/同前缀分支容易视觉上不可区分（可确认）。**

定位：[N:124–126](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChrome.kt#L124-L126)，使用场景包括 [R:53–54/162/173/242](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt#L53-L242)。长模型名、工作区完整路径、目录名、搜索snippet和分支名没有可见“完整标签”弹层，选择错误的成本不同。Compose Text 通常保留完整语义文字，不能因为ellipsis就声称无障碍一定丢字；仍需TalkBack/长按检查全名可达。真机用共同长前缀、差异仅在末尾的2条记录核对可识别性。

**Q24 — 弹窗下钻滚动与错误反馈归属需逐入口覆盖（可确认结构，实际体验待测）。**

定位：[N:168–170](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChrome.kt#L168-L170)、[C:144–169](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L144-L169)、[R:95–113](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt#L95-L113)、[V:513–529](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L513-L529)。模型→effort共用正文ScrollState；深列表点到底部模型后下钻可能继承旧scroll，返回模型层也未按条目恢复明确锚点。会话/工作区改名等先关层再等待请求，错误走banner；P05/P06才有固定错误槽。需确认失败后原名称/输入、原条目和重试入口能找回，以及重开相同错误可见。

## 对话富内容与功能能力边界

| 内容 | 当前实现 | 本轮真机需要区分的结果 |
| --- | --- | --- |
| 普通用户/助手正文、粗体、列表、引用、链接、围栏代码 | user为Compose Text，assistant为Markwon core/linkify，[C:435–473](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L435-L473) | 显示完整、文字可选择、链接可触发；代码横滚/同主题/长块阅读另记，不能合成一个Pass。 |
| user/assistant图片block | base64行内Image，高≤280dp，[H:13–14/39–40/85](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeHistory.kt#L13-L85) | 显示、方向、加载卡顿、长图可读性；没有放大/缩放功能。 |
| reasoning | 单独role纯文本，[H:44/71/83](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeHistory.kt#L44-L83) | 非折叠思考面；长思考对滚动影响。 |
| tool调用/结果 | 简短工具行，详情展开纯文本，[H:87–100](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeHistory.kt#L87-L100) | 长参数/结果、详情触控、流式状态；不是桌面终端/结构化文件卡。 |
| todo / turn_changes / compaction / error | 文本折叠，[H:45–51/102–112](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeHistory.kt#L45-L112) | 状态准确与可读；无桌面专用面板交互。 |
| generative_ui / Whale UI / HTML visual | 明确提示到电脑查看，[H:52](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeHistory.kt#L52) | **不支持本机交互，不能标Pass。** Web也保持同限制。 |
| Markdown表格、数学、Mermaid、远程图片链接 | 无专用插件/renderer，[依赖](../../../../mobile/android/app/build.gradle.kts#L57-L58) | 记录实际回退和是否可读，不宣称专用渲染。 |
| 文件、Diff、MCP、技能 | UI明确说明未接入，[R:72–73](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeRemoteScreen.kt#L72-L73) | **当前能力缺口，不能以说明条存在代替功能通过。** |
| 未知 projected item | “暂不支持的消息类型”，[H:53](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeHistory.kt#L53) | 必须能看到诚实占位，不能把原消息隐藏视为通过。 |

## 真机组合与先后顺序建议

这只是覆盖矩阵，不是已执行结果。像素和交互必须从原入口触发；不改业务数据的场景可优先安排。

| 轴 | 至少组合 | 重点表面 / 预期检查 |
| --- | --- | --- |
| 宽高 | 320dp窄屏；常见360/390/412dp；最矮横屏；分屏/平板宽面 | 顶栏按钮无覆盖；输入/审批动作在屏内；dock/相机限宽；侧栏遮罩仍可关。 |
| 字号 | fontScale1.0、1.3、1.5、2.0；默认/较大显示大小 | 聊天/扫码双行头、三段外观、按钮尾栏、长路径、选区手柄。 |
| IME | 关闭、文本编辑、多行、横屏、手势Back、硬件Back | 输入工具始终可达；弹窗先收键盘；再返回/关闭；无安全区重复空白。 |
| 标签 | 100字中文标题、长hostname、同名电脑、共同前缀末尾不同的模型/分支/目录 | 省略不遮动作，完整名称或安全识别方式可用，选择归属明确。 |
| 规模 | 多工作区/百会话；分页历史；单条200行；百/千Git条目 | 独立滚动、底部账号固定、自动跟随不打断阅读、任务表单操作可达。 |
| 连接 | 初连、重连、认证后慢目录、失败、断网/恢复、切A/B电脑 | 不把同步/失败当空目录；不泄露旧目录；草稿和附件归属正确；重试可达。 |
| 输入 | 空/仅图/长草稿/多图；idle/running/queue/busy；Plan+long model；readOnly；approval | 固定发送/停止可点；busy不得重复提交；审批接管；失败保留输入与附件。 |
| 富内容 | 中英长段、URL、表格、代码、引用、图片、tool详情、UI占位、未知类型 | 按上表逐项记录，不以普通文本能显示覆盖全部富内容。 |
| 主题/平台 | 浅/深/跟随系统；Android8–14与15+；手势/三键；减弱动画 | 全屏系统栏对比、TextView链接/代码色、背景/文本不叠读、动作可达。 |
| 状态恢复 | 每个输入/确认/模型层旋转；后台→前台；系统媒体页返回；任务→聊天 | 特别记录非saveable任务字段；不重放写请求；选区/草稿/历史位置真实恢复。 |

优先顺序：Q01跨电脑目录 → Q02长回复滚动 → Q03/Q04横屏IME输入与审批 → Q05同步/失败态 → Q06/Q07/Q13大字头尾 → Q16–Q18富内容与主题 → 所有管理/搜索/Git任务和恢复。任何未进入的状态均记“未测”，源码或构建不认证实机通过。

## 已具备的防护与误报边界

- 根窗口和 Dialog 都使用 union(safeDrawing, ime)，Compose windowInsetsPadding 会消费已应用 inset；不能仅因嵌套 safeDrawing 就判双倍空白。[A:71](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/MainActivity.kt#L71)、[N:154](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChrome.kt#L154)。
- 聊天消息区使用 weight，输入区是其兄弟节点；普通高度下消息不会像 fixed/absolute网页那样天然穿过输入卡。风险来自极矮高度的空间预算，需实际测量。
- 常用图标按钮明确48dp，通用列表项也 min48dp；长模型文本保持完整Text语义，ellipsis不等于无障碍全名必丢。
- Dialog背景是独立原生窗口；短弹层不卸载聊天。任务面卸载聊天时有按epoch/session的saveable容器。没有静态证据可断言背景一定可点或每次打开都丢聊天草稿。
- 主题色主体通过DshTokens和完整M3 ColorScheme映射，未使用Android动态取色；现有22dp输入卡无外投影、侧栏直角、目录LazyColumn、底部电脑栏均已实现。主题风险集中在系统栏和Android TextView等未接语义token的路径。
- 媒体结果有电脑/会话owner校验；Git恢复有epoch/session/cwd校验。Q01目录残留不表示这些已有边界同时失效。

报告完成时未取得任何真机或模拟器截图、UI树、点击轨迹或构建结果；所有实机检查仍由 lead 负责记录。本报告位置依据本次读取的共享工作区，若其他成员继续修改相关源码，应按新行号和实际装配重核。
