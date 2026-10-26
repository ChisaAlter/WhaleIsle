# Android 桌面体验与设置补齐

2026-10-26，接续[富文本与键盘修复](portrait-richtext-followup.md)。本轮处理用户的四项反馈：话题相对目录的缩进、运行会话加载状态、连接成功前错误路由，以及完整设置和新电脑配对入口。全程保持强制竖屏，没有横屏测试。

## 实际变化

| 用户路径 | 本轮实现 |
| --- | --- |
| 侧栏目录与话题 | 话题标题比工作区标签轻缩进 12dp；空闲、运行、审批共用固定状态槽，状态改变不移动标题。运行显示转圈，审批提醒优先；当前会话直接使用实时运行状态，其余使用目录状态。底部固定齿轮「设置」和电脑连接状态。 |
| 首次连接与入口重连 | 扫码、完整链接、保存电脑启动/选择保持连接页。等待认证、订阅、目录，以及所选会话历史、模型和命令控件加载完成后才进入 Chat；失败留入口、显示错误与显式重试。取消会关闭本代连接，迟到回调不能进 Chat；取消或初次失败不启用后台自动重连。已打开 Chat 的同电脑断线恢复保留任务。 |
| 设置入口 | 独立可返回的完整设置页，可搜索；包含电脑与连接、外观与阅读、对话、模型与权限、归档会话、当前会话用量、关于。新电脑配对在电脑与连接内，对话三点菜单不再放设置。连接入口也可进入设置。 |
| 本机偏好 | 消息字号实际作用到正文、推理、表格、代码和数学渲染；可隐藏推理、默认展开工具详情、Enter 发送（Shift+Enter 换行）、运行时选择排队或交给当前回复。偏好独立存手机，不改凭据格式或电脑配置。关闭推理后的运行空态在 r6 改为「正在回复…」，不误显示欢迎语。 |
| 模型与用量 | 模型页列实际可路由模型、思考档、上下文/输出上限和图片支持，当前选择优先取会话投影。`session.selectModel` 明确 `saveAsDefault:false`，避免顺带改电脑默认模型。权限/Plan 只作用当前会话。用量显示当前会话日志的 input/output/cacheRead/cacheWrite，缺失不伪零，不宣称账户账单。 |
| 待发队列 | 读取真实 `values.inbox` 的 next-turn/next-step，仅有队列时显示。支持有身份用户消息的纯文本非空编辑、移除、运行中将 next-turn 转入当前回复；含附件禁止文字替换。写操作按当前会话/连接代次/只读/同步/运行状态校验，收到确认再同步服务器真值，不先本地删除。r5 起失败保留编辑框文字与错误，确认服务器文字一致才收起。没有重排功能。 |

供应商账号与密钥、MCP、技能/插件配置、完整账户用量、文件浏览、终端和可交互 Visual 回复仍有桌面差异。本轮没有接无效或缺少白名单的接口，也没有用空列表/无效开关冒充这些功能。

## 构建与候选身份

versionName 0.3.10 / versionCode 4，minSdk26 / target36。两个 debug 身份同源码，证书 SHA-256 均为 `14d5f33de2d182088f220f393693eda8468d9d4b1398f748c37bcfe01ca58222`。Manifest 的 MainActivity `screenOrientation=1`（portrait）。[构建与安装汇总](evidence/desktop-parity-build-summary.json)保留每次包的摘要和实际状态。

| 候选 | SHA-256 | 实际状态 |
| --- | --- | --- |
| r4 nativeqa | `3B92BBA2682E47F04C434FBEF3405D15CFB49CEDF8DBC3C681AD075FE91BEBCF` | 保留数据覆盖成功，冷启1098ms；本轮主要设置/连接/侧栏手机截图。 |
| r5 nativeqa | `83B7E7814931BC9C0106B72F33FB2FF40A5B6354E1DA67577DF3DA1BF5D77733` | 加队列编辑失败草稿保留，覆盖成功，冷启853ms；实际重新打开专用QA Fork。**设备断开时仍安装此包。** |
| 最终 r6 nativeqa | `D949B9ABA40C11C5819EAB8B343CB259EBF2BE170B723871F226F83FD2E59F19` | 加隐藏推理时运行空态修正，构建成功；安装前 ADB 已无设备，未安装/未真机复测。 |
| 最终 r6 standard | `F0A2347DBC4DAE620B3940762ACBC69E6C1D8008E3C125D876D12ACB91A7BD37` | 标准身份交付包已构建并验签；没有覆盖原标准应用。 |

最终 r6 实际运行 `:app:testDebugUnitTest :app:assembleDebug :app:lintDebug` 成功；App59项：Remote39、基础VM3、NativeChatState8、NativeMarkdown5、SessionData4，0失败/错误/跳过。新增首连门控/失败/取消/已签发凭据重试/配对数据/模型与发送模式，以及队列参数校验、失败不清队列或草稿、跨电脑迟到确认隔离等回归。lint0error/17warning/2information。协议15项本轮任务为 up-to-date，没有将缓存说成重新执行；Node33项沿用前轮结果，本轮未跑。

r4、r5、r6按实际代码变化顺序各执行相关构建，不把某次测试认证为另一包的手机通过。首次 apksigner 命令未带 JAVA_HOME 报环境错误；设置本机JDK17后，两最终包实际验签通过。

`npm run docs:check` 实际失败1项：既有研究文档 `docs/research/2026-10-08-project-team-runtime-research.md` 指向已不存在的 `vendor/deepseek-harness/packages/experimental/agent-team/src/mailbox.ts`；本轮新增引用未报错。没有修改无关研究记录或将全库文档检查说成通过。

## Android16 竖屏实测

设备 `23127PN0CC`，ADB `1836e17d`，1200×2670、density480、font_scale1.0，约400dp。测试使用隔离包，配对 lead 独立桌面53876/53878，未停止或改动用户3080/6767、3181/6768服务。进入已有只读会话时只导航，随后明确搜索并选择专用 `Physical QA Fork`（`session-e7f2d5af-efc9-4b3c-b2ef-f9dc78fec2aa`），未向原用户对话发送测试消息。

| 定向检查 | 观察结果 |
| --- | --- |
| 连接中路由 | r4 VIEW 配对后截图明确停在连接页，显示转圈「正在连接电脑…」、取消，未出现聊天输入；成功后才出现 Chat。真实认证后各同步阶段的故障在JVM分别验证，不声称手机逐阶段故障注入通过。 |
| 取消与设备设置 | 冷启动曾显示连接中，后续进入设置并列出保留的 Ayase 配对。自动脚本尝试在未完成连接时点侧栏被拒，反证侧栏尚未出现；后续脚本的取消分支执行时连接已结束，**不把它计为真实取消成功**。取消/重试与不自动重连由定向VM测试覆盖。 |
| 设置层级与明暗主题 | r4实际进入设置首页、电脑与连接、外观与阅读、对话、模型与权限、会话用量。浅/深色显示清楚，标题/关闭/返回可达，没有截图内重叠；选择深色后立即生效。 |
| 侧栏层级 | 实际展开侧栏，QA工作区下的话题比目录标签稍缩进，菜单不挤压长标题；底部设置固定可见。截图时没有进行中的QA turn，**未把静态图计为加载动画的手机运行验收**。 |
| 对话偏好 | 真实点击隐藏思考过程与默认展开工具详情；设置开关可用，r5覆盖后配对保留。未完成各项消费在同一运行消息中的逐项设备对账、全部字号/Enter/Shift+Enter组合。 |
| 模型详情 | 手机显示真实模型、思考档、上下文/输出上限和图片支持；未在本轮真机切换模型。当前会话修改不写桌面默认由VM断言覆盖。 |
| 当前会话用量 | Fork的手机显示4789=input4253+output536，cacheRead89088/cacheWrite0，与同ID主机投影完全一致。 |
| 队列真实操作 | 脚本在读取第一份设备树时返回 `adb.exe: device '1836e17d' not found`，尚未提交任何hold或排队请求；因此本轮**未完成队列编辑/删除/steer真机验收**。不把VM39或解析4项转换为真机通过。 |

精选界面证据：[设置首页](evidence/newphone-169-r4-settings-home.png)、[连接进行中](evidence/newphone-171-r4-owned-connect-attempt.png)、[仅QA工作区的侧栏裁切](evidence/newphone-174-r4-sidebar-qa-only.png)、[浅色外观](evidence/newphone-175-r4-appearance.png)、[深色外观](evidence/newphone-176-r4-dark-appearance.png)、[对话偏好](evidence/newphone-177-r4-conversation.png)、[同会话用量](evidence/newphone-179-r4-session-usage.png)、[模型详情](evidence/newphone-180-r4-model-settings.png)。最终逐suite原始XML另存于[本轮JVM结果目录](evidence/desktop-parity-r6-jvm/)，没有沿用r2后被覆盖的测试文件。

## 断开时状态与后续

20:45左右首次观察 ADB 设备缺失，随后再次 `adb devices -l` 为空；未反复重启ADB、未寻找或配对未授权设备。最终r6安装、运行转圈、队列编辑/移除/steer以及偏好消费的剩余手机复测，等待这台设备重新连接并授权。

最后读取的系统font_scale1.0、accelerometer_rotation0、user_rotation0均未在本轮更改；没有横屏操作。断开前本机偏好为深色、隐藏思考过程、默认展开工具详情、Enter关闭、运行中queue。设备不可达，**未恢复这些本轮测试偏好到此前默认值**；它们只影响隔离QA应用，不改变电脑或标准应用。配对、文字草稿和原有会话未清除。

r6与r5只差隐藏推理时的运行空态三行修正；仍需实际安装r6确认，不能称最终包已在设备验收。更广的真实QR/拍照、外部Git鉴权/PR、历史分页/并发/资源边界和正式签名升级继续沿用[既有未覆盖项](portrait-richtext-followup.md)。Issue285保持OPEN，PR286为draft供审查，不自动合并。
