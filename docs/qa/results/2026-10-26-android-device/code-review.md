# 本轮 Android / daemon mux diff 复审

2026-10-26 13:36（Asia/Shanghai）。对当前完整未提交 diff（含新增测试）与修改后的源文件进行只读审查；未运行构建、测试、lint、手机操作、应用或 git mutate，未修改产品文件。本报告为唯一写入。已有自动检查通过与 MIUI 阻止当前版安装是 lead 提供的上下文，本审查不将它们转换为真机通过结论。共享工作区在审查过程中继续更新，以下已按最后复读版本区分仍存在和已修复项。

## R1 / R2 处置复核（2026-10-26 13:54，Asia/Shanghai）

android-state 只读复读当前源码与相关回归定义后更新本报告；本次仅修改此报告，未独立重跑 JVM、构建、lint、Node 检查或设备测试。lead 已报告最新 46 项 JVM、assemble、lint 全部通过，host 地址/mux 33 项 Node 及真实 session/projection 调用成功；这些是 lead 的执行结果，不是本报告更新者的独立复验，也不等于图片内存或真机全功能验收。

### R1 · P2 · 已修复 · 一张不可读历史图片阻断同页全部正常图片

当前依据：

- [NativeHistory.kt:23–45](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeHistory.kt#L23-L45) 逐附件处理普通读取/校验失败，生成该图片的 `error` 并继续后续项；每张结果通过 `onResolved` 立即发布。取消会先检查协程活动状态，主动取消继续抛出；单次 RPC 超时作为可读的该图片失败处理。
- [DshViewModel.kt:344–375](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L344-L375) 每张结果提交前检查连接代次、会话 ID 和打开修订号，立即写入当前会话缓存并更新 rows；失败原因同时进入 banner。已有成功数据或失败占位不会被轮询自动重复读取，不新增重试层。
- [NativeImagePreview:510–518](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeChatScreen.kt#L510-L518) 无位图时显示 `image.error`，缺少具体错误时才显示通用占位。
- [VM 混合双图回归:430](../../../../mobile/android/app/src/test/java/ai/deepseek/harness/mobile/DshViewModelRemoteTest.kt#L430) 覆盖坏图在前、好图仍显示、错误可读以及后续历史刷新不重复读取；[立即发布/取消回归:449](../../../../mobile/android/app/src/test/java/ai/deepseek/harness/mobile/DshViewModelRemoteTest.kt#L449) 覆盖好图先显示、另一图仍挂起、切会话取消并禁止迟到显示。[helper 回归:59](../../../../mobile/android/app/src/test/java/ai/deepseek/harness/mobile/NativeChatStateTest.kt#L59) 与[取消回归:72](../../../../mobile/android/app/src/test/java/ai/deepseek/harness/mobile/NativeChatStateTest.kt#L72) 分别检查逐项结果和取消传播。

判定：原先整页成功后才提交的 R1 路径已移除，按当前源码及 lead 报告的相关测试结果标记已修复。本次未独立执行上述用例。

原发现记录（已被以上修复替代）：

- [NativeHistory.kt:19–28](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeHistory.kt#L19-L28) 顺序解析整页图片；任一 `read` 或响应校验抛错，整个函数退出。
- [DshViewModel.kt:333–349](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L333-L349) 只有整页 `resolveHistoryImages` 全部完成后，才把结果写入 `historyImages` 并更新 rows；catch 只显示 banner。
- 这不是假设后端永不出错：[附件存储:440–455](../../../../vendor/deepseek-harness/packages/attachment/attachment-local/src/store.ts#L440-L455) 明确会因对象缺失、读取失败或校验失败报错；[session.attachment:488–498](../../../../vendor/deepseek-harness/packages/api/session-controller/src/commands.ts#L488-L498) 将其转为正常的 Remote 错误。

触发序列：同页有图片 A、B、C，B 对象损坏或已缺失。A 虽已成功读取，尚未进入成功缓存；B 抛错后 A 仍无法预览，C 不会被读取。若 B 在第一张，后面所有图均被挡住。运行中/审批中的 1.5 秒历史刷新还会重复撞上 B。新增 helper 测试仅覆盖全部成功，未覆盖混合成功失败。

建议：按附件隔离失败；成功一个即写入本会话成功缓存并刷新显示，坏图保留独立错误占位，继续读取其余图片；保留取消异常传播，不将取消当普通坏图吞掉。最小回归是 good / rejected / good 三张：两张 good 应显示，失败图有原因且不阻断其它项。本审查未执行该用例。

### R2 · P2 · 已修复 · 新历史图片缓存无限保留已访问会话的原始 base64

当前依据：

- [openSession:259–267](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L259-L267) 每次打开会话先递增 `sessionRevision`，取消所有旧图片读取，清空读取 map、图片缓存和旧历史。当前方案按打开会话归属释放，不使用 LRU，也不跨已访问会话保留历史图片。
- [图片提交:344–373](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L344-L373) 提交检查 epoch/session/revision；`historyImageReads` 仅持有在途 `Deferred<Result<JsonObject>>`，读取完成后在 `finally` 按 Deferred 身份移除，成功和失败都不永久留存完整响应。成功数据由当前会话的已加载历史及图片缓存持有。
- [离开电脑:115–122](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L115-L122)、[连接重置:133–143](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L133-L143) 和[自动重连清理:190–197](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L190-L197) 同样取消/清空两图片表，旧连接与旧打开修订号不能继续提交。
- [当前会话释放回归:449](../../../../mobile/android/app/src/test/java/ai/deepseek/harness/mobile/DshViewModelRemoteTest.kt#L449) 断言切会话取消挂起读取，另一会话不显示旧图片，回到原会话重新读取已成功图片；[既有迟到图片回归:475](../../../../mobile/android/app/src/test/java/ai/deepseek/harness/mobile/DshViewModelRemoteTest.kt#L475) 继续覆盖旧会话结果不进入当前 rows。

判定：R2 所指“遍历多个会话后永久保留各会话 base64”和“完成 Deferred 不释放”两条保留路径已移除，采用 lead 认可的当前会话释放方案。当前会话已主动加载的完整历史及其图片仍可随翻页增长；本次未引入总字节上限、未做 LRU、未独立运行内存压测，不声称测得内存上限、垃圾回收或无 OOM。

原发现记录（已被以上修复替代）：

- [DshViewModel.kt:82–84](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L82-L84) 新增两个无容量/字节预算的 map。
- [DshViewModel.kt:335–346](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L335-L346) 成功的 `Deferred<JsonObject>` 永久留在 `historyImageReads`；其 JSON 持有完整 base64。同时成功图片留在 `historyImages`。二者可能引用同一 String，不应按两份字节简单相加，但任一都足以阻止释放。
- [openSession:258–270](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L258-L270) 切会话仅清 history / rows，不清两图片缓存；[自动恢复:194–197](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L194-L197) 只清读取 map，继续保留成功图缓存。正常长连接期间只能通过主动离开/换电脑清理。
- [默认存储图片预算](../../../../vendor/deepseek-harness/packages/attachment/attachment-local/src/index.ts#L50-L54) 单图归一化目标为 4 MiB，因此合法历史图片仍可很大。

影响：逐个打开图多的会话、加载更早页后，即使切到纯文字会话，已浏览所有图仍由 ViewModel 强引用。仅作规模说明：50 张各 4 MiB 的压缩图，其 base64 约 267 MiB，尚未计解码位图和响应临时对象。这是确定的无界保留，未做内存压测，不声称已实测 OOM。

建议：只保留一个按总字节受限的成功缓存（例如 LRU）；读取 map 仅用于 in-flight 去重，完成后在 finally 中按 Deferred 身份移除；成功值先转入受限缓存。切页/切会话时释放不再需要的读取任务。回归应验证跨多会话浏览后缓存字节上限及离开后释放，不需要手机才能断言容量逻辑。

## 审查期间发现、lead 已修复，当前不再列为问题

1. **前台恢复关闭任务页/PR 审阅。** 早期版本 `onForeground → syncCatalog → openSession` 会清 panel、取消 review、重载当前会话，旋转/系统媒体返回即可触发。已通过即时消息交 lead。最后复读 [onForeground:427–432](../../../../mobile/android/app/src/main/java/ai/deepseek/harness/mobile/DshViewModel.kt#L427-L432) 已恢复为 `refreshCatalog + refreshHistory + startPoll`；新增测试覆盖 Browse/Search/PR candidate 保持。此项已撤下。
2. **共享 mux 的获胜审批缓存不删除。** [Gateway:698–704](../../../../vendor/deepseek-harness/packages/api/gateway/src/index.ts#L698-L704) 先移除答复者 delivery 再 settle，[734–744](../../../../vendor/deepseek-harness/packages/api/gateway/src/index.ts#L734-L744) 只向剩余客户端发 cancel，故不能靠 cancel 清获胜方缓存。已通过即时消息交 lead。最后复读 [hooks respond:111–119](../../../../src/main/dshd-daemon-hooks.mjs#L111-L119) 已在成功 respond 后按捕获 frame 身份检查并广播 resolved；[新增断言](../../../../src/main/dshd-daemon-hooks.test.js#L75-L79) 覆盖无 cancel 的获胜方清理。此项已撤下。

## 已有静态报告中被本轮修复的部分

以下依据当前源码，不重复作为缺陷：非仓库仅读 status 即可到达 Initialize；持久化 attachmentId 已有读取路径，R1/R2 已按上述当前源码复核关闭；新建/登记会话已先 openSession 再刷新目录，避免图片草稿串入新 id；审批记录已按 session/id 分组且保存 rpcId，非当前会话事件不再丢弃；history-only 审批按钮禁用并提示等待路由；openGit 已检查 sessionRevision、panelRevision、cwd 和连接代次，迟到 A 数据不再打开 B Git 页；先 subscribe 再同步目录，目录失败不再跳过 mux；前台同网断线已有 awaitDisconnect 驱动保存 secret 重连；换电脑/离开清目录；权限、Plan、模型在切会话时重置并有 loading 禁用；新模型无 effort 时清旧值；尾部已改真实 tail anchor 与拖动跟随状态；composer/approval 按实际头部后剩余高度预算，滚动正文与动作分开；顶栏改为最小高度；连接 dock/扫码框宽度 modifier 顺序已调整；系统栏与 Markwon 语义色已有深浅主题更新；任务表单已用 rememberSaveable。

这些代码修复不等于真机布局验收。本次未获得可支持“当前仍有横屏布局回归”的具体像素/测量证据，因此不把旧 Q03/Q04 等风险直接复制为新 bug。长代码横滚、lightbox、queue、Git 主动作、子会话层级等静态报告既有功能缺口也不算本轮引入发现。

## 结论

2026-10-26 13:54 复读：R1 单图失败隔离与 R2 跨会话历史图片保留两项已按当前代码标记已修复，不再列为当前可操作发现。R2 使用当前会话归属清理与在途读取 finally 释放，未采用 LRU 或字节上限；不得将此记录解释为内存压测通过。任务页前台恢复、获胜审批重放两项仍维持已修复结论。lead 报告最新 46 项 JVM、assemble、lint 通过，host Node/真实调用结果如上；本报告更新者未独立重跑任何检查、未操作设备。当前 APK 的实际 UI 验证及其范围由 lead/UI 成员另行记录，不由本次源码复读扩张。
