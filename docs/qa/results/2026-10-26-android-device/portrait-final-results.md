# Android 16 最终竖屏候选执行结果

2026-10-26，物理机 `23127PN0CC` / Android16/API36 / 1200×2670 / density480（约400dp），隔离包名 `ai.deepseek.harness.mobile.nativeqa`。本次按用户最终要求固定竖屏，不再执行或要求横屏验收。

最终 nativeqa 候选 `988188…` 已保留数据覆盖安装成功，冷启 **1091ms**，Manifest 与设备运行时请求均为 portrait。最终 App **40/40** 自动回归通过；协议 **15/15** 沿用当日有效缓存，定向 Node **33/33**，两身份 debug 构建成功，lint **0 error / 13 warning**。这些结果没有将手机全部功能、所有边界或桌面一致性提升为通过：重连、目录/CRUD、本地 Git、模型与字号主要在上一竖屏候选 `43894D…` 上实跑；最终包的新增就绪屏障由受控回归覆盖，最终实机另完成安装、保存连接恢复、正文请求及富文本观察。富文本中已实际发现表格、数学、长代码与桌面的差距。

本节补充[主报告](README.md)的最终候选边界，不重复 F01–F42。设备操作、host 对账、两身份构建及 lint 由 lead 执行；android-state 执行 App JVM、只读核对结果及指定截图并编写本文，没有为写文档重跑测试、构建或 ADB。

## 候选身份与检查

| 候选 | SHA-256 | 对应证据范围 |
| --- | --- | --- |
| 最终 nativeqa debug | `9881887992A555D449867CA31A213899D5B9297A5E61C02C7E1C1DB91B683A3F` | 保留 nativeqa 数据安装 `Success`、COLD 1091ms、运行时 `SCREEN_ORIENTATION_PORTRAIT`；最终保存连接恢复、消息110发送及后续富文本/连接页 IME 观察。 |
| 最终 standard debug | `86DA2D0ECD80D2DC19043A42FAE2434F2DA7A7322C0E18E88AC90302AC7149B6` | 构建完成；本机实际安装的是隔离身份，不认证正式包覆盖升级或旧 Web 数据迁移。 |
| 前一竖屏 nativeqa | `43894DF05EC4666479BD71B6ED3B2470438F35C551574B05A17B261260DF44F5` | 下述真实重连、目录/登记/CRUD、模型恢复、本地 Git、字体1/2输入等主要实跑载体。没有把它们写成最终9881包逐项重跑。 |

最终版本配置为 versionName `0.3.10`、versionCode `4`、minSdk26、target/compileSdk36。完整摘要、安装、1091ms、方向与检查汇总见[最终构建摘要](evidence/portrait-final-build-summary.json)；前一包身份见[前一竖屏构建摘要](evidence/portrait-build-summary.json)。新机早期新装、原 Android15 安装被系统阻止及 API26 补充测试仍分别保留在主报告，互不替代。

| 检查 | 实际结果及有效时间 | 不能推导的结论 |
| --- | --- | --- |
| `:app:testDebugUnitTest` | **40项，0 failure/error/skipped**：Remote VM29、基础VM3、NativeChatState8。最终 XML 写出于17:52:12（UTC+8）；对应源码最后修改：VM17:44:50、RemoteTest17:51:24、基础Test17:50:32。见[回归汇总](evidence/recovery-jvm-results.json)。 | FakeRelay/gate控制的掉线、迟到结果和同步测试不等于真机全部网络/生命周期组合。 |
| 协议测试 | **15项，0 failure/error/skipped**：Offer7、PairingIntent4、RelayInterop2、RelayLifecycle2；有效结果来自12:40，最终任务使用缓存。 | 本次末轮没有重新执行15项，不能写成55项都在最终一轮新跑。 |
| host/daemon/mux 定向 Node | **33/33**，lead执行记录，最终摘要引用。 | 不是全部桌面/Web测试，也不抹掉主报告中的完整桌面预启动重建失败记录。 |
| standard/nativeqa assemble | 两身份 debug 构建成功，摘要如上。 | 未认证release、生产签名升级、正式包迁移。 |
| Android lint | **0 error / 13 warning**，lead最终执行摘要。 | 不是零警告；早期11warning的记录属于旧阶段，不用于覆盖最终计数。 |

## 重连与加载屏障

前一竖屏包在真实隔离宿主关闭 remote 后，搜索页、查询词 `PHYS_RECONNECT_RETAIN_1626`、错误和禁用态可见；宿主恢复后同页同查询仍在，远端按钮重新可用。[脱敏结果](evidence/physical-reconnect-result.json)为 `queryRetained/searchPageRetained/remoteReady/observedOffline:true`。首次恢复 enable 没有完成，lead 第二次 enable 后才恢复，**实际超过12秒**，不称精确12秒往返或一次恢复成功。

该验证说明表单跨真实重连保持，不证明 `Software caused connection abort` 的传输根因已解决。此前75秒15次5秒采样的默认网/PID稳定，也不能排除采样间故障或同网络内路径变化，见[网络观察](evidence/newphone-network-observation.json)。

最终代码继续以 generation 隔离传输与迟到回调，以独立 UI owner 保持同电脑同会话的 work/new/settings/sessions/browse 表单、目录和搜索数据；用户离线关闭的页面不复活，Git/审阅关闭。末次只读复核发现两条就绪旁路后补修：旧侧栏打开会话不能绕过未就绪目录，聊天写动作同样检查 catalogReady；同代目录同步只允许一轮在途，旧代失败或 finally 不能覆盖新代同步归属。目录失败保持错误与加载屏障，显式前台同步可恢复完整控制；空目录能结束加载。离线仍可编辑当前会话草稿，不能切到其它会话。

这些最终屏障、重复 foreground、旧同步失败、显式重试、草稿/附件 owner 场景已由40项中的对应回归覆盖。**9881最终包没有重放上一包全部重连与故障注入场景**，不能以最终安装成功代替它们。

## 前一竖屏包上完成的真实操作

| 路径 | 实际结果 | 边界与证据 |
| --- | --- | --- |
| 目录浏览、创建与登记 | 手机从home上级进入 `C:/AI`、专用QA仓及 `physical-device-qa`，创建 `phone-created-1645`，host记录创建时间16:48:43。第一次未真正进入child，登记了父目录；随后语义点击明确进入child并登记，新会话 cwd 为 `C:/AI/WhaleIsle-AndroidQA-20261026/physical-device-qa/phone-created-1645`。 | 明确保留第一次选中错误；不是把准备好的目录冒认为手机创建。新会话 `session-e9ba53b5-9e9c-4a35-9332-0a376f31952c`，见[child摘要](evidence/physical-child-summary.json)。 |
| 模型错误与恢复 | 宿主 remote 重启后默认 `magpie/codexgpt6.1sol` 已不在当前模型目录，首次child请求显示 `UNKNOWN_MODEL`。切换当前可用 `clinepass/cline-pass/deepseek-v4.1-flash-1017` / Low 后得到 `PORTRAIT_CURRENT_MODEL_OK` 一次。 | 是具体模型不可用错误及真实切换恢复，不记产品崩溃；旧错误作为历史保留。非全部provider、effort、图片模型组合验收。 |
| 受控 QA 会话 CRUD | child重命名为 Physical QA Child→归档→管理搜索中显示已归档→取消归档→再归档→永久删除确认中取消仍保留→再次确认移除。 | [host结果](evidence/physical-crud-result.json)确认仅测试child从session list、archive、workspace成员中移除；创建的workspace保留，文件目录保留；没有删除主A或Fork。 |
| 本地 Git | 在专用QA仓创建并切换 `physical-portrait-qa-1754`，手机 Commit 成功，commit `53b977efbfea11b309d85ac75b9cda1d6eedf323`，说明 `Physical portrait QA fixture commit`，host status clean。 | [Git结果](evidence/physical-git-result.json)明确为手机调用；未push、publish、pull或PR/MR。与API26早期本地提交分开，不操作产品仓。 |
| font1竖屏 WeType | 中文六行，真实docked键盘可见；移到末尾并Delete精确删最后X，Back后草稿完整保留。 | [font1结果](evidence/physical-ime-result.json)；不是只用setText成功代替键盘编辑。 |
| font2竖屏 WeType | 六行编辑、起点与Back后内容核对正确；正文与发送/模型操作轨可见。 | [font2结果](evidence/physical-font2-ime-result.json)。超出高度须滚动，模型名称省略；不推及任意密度、所有输入法或资源极限。 |

早期主QA会话的9个user turns、六个marker各一次、真实图片、两个审批裁决、Queue排空与用户Stop的精确事实仍见主报告及[功能摘要](evidence/newphone-functional-summary.json)、[停止结果](evidence/physical-stop-result.json)。它们不是本轮最终包全链路重跑，也不以正常marker一次关闭ACK丢失重复请求风险。

## Plan 对账纠正：同一 session 的开启与关闭

最初手机选到与主A同名的普通Fork，却拿固定主A ID查询 projections，因而出现“手机有Plan chip、主A投影false”的错误对账。测试宿主将Fork改为唯一名称 **Physical QA Fork** 后明确了手机选择。这属于QA选择同名对象的歧义，未据此确认产品串会话，也没有为该误判修改产品。

正确对账始终使用Fork `session-e7f2d5af-efc9-4b3c-b2ef-f9dc78fec2aa`：

| 手机动作 | 同一Fork的host投影 |
| --- | --- |
| composer `/plan`发送后 | [Plan on](evidence/physical-plan-on.json)：`active:true,pending:false`。 |
| 点击手机Plan chip关闭后 | [Plan off](evidence/physical-plan-off.json)：`active:false,pending:false`。 |

上述同ID开/关是已执行事实；不能再以主A `session-ed28c351-49f1-40ae-a7f2-5ea79168e295` 的旧 `asOfSeq134` 快照否定Fork状态，也不把两份不同时间投影视为同一时刻的矛盾。

## 最终9881包：安装后请求、恢复与可见差距

最终包安装后，通过保存连接重新进入QA；重新进入时经历加载状态，随后返回Fork与已保存内容。最终恢复完成由后续Fork内容画面支持，不能把“正在载入会话”的瞬态截图单独记成恢复完成。

手机消息110实际点击Send，之后host同Fork的最后turn为 `completed`，输出含 `PORTRAIT_FINAL_OK` 标题、二行数据的pipe表格、两项bullet、100字符代码、`$E = mc^2$` 及HTTPS链接；见[脱敏输出](evidence/physical-markdown-result.json)。这里仅保留完成原因、ID和输出文本，未复制runtime、skills或完整host上下文。

lead实际滚到输出底部；[最终正文底部图121](evidence/newphone-121-final-markdown-bottom.png)仅保留H1至输入栏的裁切，去掉上方模型推理，原图留本地临时目录。此图显示以下结果，报告编写者已读图核对：

| 内容 | 最终包实际显示 | 验收结论 |
| --- | --- | --- |
| H1、bullet、链接 | H1有明显标题样式，bullet正确列出，HTTPS链接为可辨样式。 | 本次对应视觉格式已看到；未点链接，不扩张为链接导航或scheme安全通过。 |
| Markdown表格 | 原始pipe与分隔行串成普通文字，没有表格布局。 | **已实测桌面一致性差距**，不是“表格未跑”。 |
| 数学 | `$E = mc^2$` 按原文显示，没有公式排版。 | **已实测公式呈现差距**。 |
| 100字符代码 | 代码区域软换行，未呈现桌面式水平滚动。 | **已实测长代码阅读差距**，不能写横滚已支持。 |

底部输出可滚到并阅读，不能据此称完整Markdown/数学/富内容与桌面一致。以上差距本轮如实保留，不追加产品修改或扩大验收范围。

最终无效配对输入及docked键盘场景中，[图113](evidence/newphone-113-final-invalid-ime-initial.png)初始连接按钮下部裁切；[图114](evidence/newphone-114-final-invalid-ime-scrolled.png)滚动后连接按钮和页脚完整可见，证明本次滚动可达。输入值是 `invalid-final-portrait`；原生click被接受不等于下一帧错误反馈已重新出现，缺少对应最终图证的反馈不提升为全Pass。早期无效链接明确错误与本次最终包滚动可达分别记账。

## 恢复、证据与剩余范围

lead在最终重新连接后读回：`stay_on_while_plugged_in=15`（原值）、`font_scale=1.0`、`accelerometer_rotation=0`、`user_rotation=0`；系统night为原no，应用跟随系统。本节记录该收尾读数，未为编写文档再次连接设备。固定竖屏不等于改变上述系统全局旋转设定。

本节只链接已归档的脱敏结果和指定应用截图；不提交配对offer、secret、Cookie、token、完整host history/runtime/skills、私人图库缩略图或相机实景。工具helper仅临时QA使用，语义click被接受与真实业务完成始终分开核对。

仍未通过或未执行的边界保留：真实呈码QR解码与完整自动配对、真实拍摄图片并发送、相机权限拒绝/无后摄/失败生命周期、完整远端Git授权及push/publish/pull/PR链路、ACK丢失幂等、全部历史分页/坏图/内存和资源极限、正式签名升级与旧Web迁移、全尺寸/密度/输入法/TalkBack、多端并发写与审批竞争。表格、数学、长代码则已有上述明确失败/差距证据，不能与这些未跑项混写。F01–F42的其它限制以主报告为准，本节不关闭全量验收。
