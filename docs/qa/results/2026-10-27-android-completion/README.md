# Android 剩余验收与待确认发送身份

接续 [首轮手机结果](../2026-10-27-android-device/README.md) 和 [#285](https://github.com/ChisaAlter/WhaleIsle/issues/285)。本轮基线 main `b871710607`，独立分支 `fix/android-device-completion-20261027`。用户随后明确“手机先跳过”，从该指令起不再占用原物理设备，光学扫码/真实拍照按本轮要求跳过，不标通过。后续 Android 运行以隔离 API35 x86_64 AVD 为准，不能替代物理相机。

## 丢 ACK 的业务身份修复

Android 旧 `session.prompt` 不传业务 `requestId`；桌面 tunnel 每次补一个新ID，因此请求实际已入账、回复丢失时，用户显式重发原文会成为第二条消息。传输层随机 RPC requestId 只负责匹配回复，不能替代该业务身份。

最小修复在 ViewModel 按电脑/会话保存未确认的 `{requestId,text,images,mode}`。用户显式重发完全相同内容、图片和发送模式时复用身份；任何负载变化产生新身份；只有 `accepted:true` 才清待确认记录和草稿。没有新增自动重发或后台 retry。记录属于当前 ViewModel 生命周期，进程重建后的发送恢复不在此实现范围。

验证：两条新定向回归在旧实现均失败；修复后 `DshViewModelRemoteTest` **42项全部通过**，包含丢ACK保留草稿、10秒不自动重放、显式同负载重发同ID、成功后再次同文为新ID、文本/图片/模式变化为新ID、切会话保持各自归属、accepted:false保留图片与草稿。

真实桌面对照：官方 Electron **44.9.1**，独立 profile/端口53876、CDP53877、daemon53878，无 plain-Node execPath DI。专用session `session-019819cd-c18a-41f3-999a-f53f6f327152` 两次提交同业务ID `android-qa-3ea79705-55a6-4ef9-bde2-e556689719ef`，第一回复由调用者丢弃、第二 `accepted:true`；实际持久history仅有 **1条**该 `source.rpcId` 的 `user/message`。这先证明真实服务端去重；尚不能把调用者丢弃回复当作 Android 传输中断。

上轮 plain-Node QA DI 是当时工作绕行，本轮官方同版 Electron daemon 已正常ready/relayConnected，旧限制不能继续笼统标记为“正式daemon不可用”。本轮某次冷启动超过30秒后被父进程停止，一次正常remote off/on后正式daemon成功；不修改产品超时或以冷启动失败冒通过。一次重复启动exit0来自已有同QA单实例锁，监听进程仍存在，不是产品原生崩溃。

## 插件管理 RPC 等待

只将 `pluginManager.installBundle` / `pluginManager.removeBundle` / `pluginManager.waitForInstall` 的 host RPC 等待改为12分钟，匹配实际管理操作时间；其他host方法仍30秒，Git仍120秒。操作归属、显式取消和不确定结果回读由原生管理面实现；加长等待不自动重放请求。

## 环境与后续记录

本机原无模拟器组件/镜像。已从官方URL下载 emulator37.2.12，WHPX检查usable；API35 Google APIs x86_64 r9镜像SHA1 `0103e6dab21290c4b9d16550a3ce99476f884eef` 与官方清单匹配。独立AVD `WhaleAndroidQA35`、端口5556、工作树 `.tmp/avd35`，不操作原1836e17d。

真实当前 Android 正式 `android-v0.3.10` APK 已检查：versionCode4，MLKit/dexopt assets，无SPA，属于原生客户端，不能当旧Web包。旧Web迁移将使用真实历史源码同debug签名的隔离包；正式同签升级另用真实release code4→候选code5，分别记账。

多页历史通过原有 JSONL persistence 创建260消息/781events的专用session `session-android-longhistory-20261027`；该合成历史用于边界检查，不冒充260次真实AI请求。

## 真实 Kotlin 加密通道

2026-10-27 17:52–17:53（Asia/Shanghai），Android 同源码 `DshViewModel` + `RelayClient` 经公网TLS加密relay接官方44.9.1 daemon；这是JVM运行的真实客户端验收，不能标作AVD点击或物理手机。opt-in `AndroidRelayEndToEndTest` 1项通过，用时75.12秒；输入仅通过忽略的专用配置指定，不会默认连接用户电脑。

- 完整分页：50→100→150→200→250→260；260个唯一消息与预期逐条顺序相同，末页 `hasOlder:false`，前后台刷新后仍260条。
- 真实丢ACK：仅专用QA daemon runner在 `session.prompt` 原真实Host成功入账后拦截首回复；日志09:52:55.675Z记录 `receiptOk:true`、业务ID `de6f541b-2b7d-43e7-83ac-020142a2445b`。Android真实30秒等待超时保留草稿；显式重发、确认接受后清草稿，真实持久history始终仅1条该文本。生产runner、加密和transport代码未替换。
- 第一次用例因构建耗尽预取offer而正确拒绝过期配对；随后改为测试执行时从专用host立即取当前offer再跑通过。没有放宽过期检查。

可核查[精简结果](relay-result.json)。网络断开与跨会话回调竞争仍继续补实测，不能用单纯丢回复覆盖它。

## 正式同签 code4→code5 升级

AVD `emulator-5556` 上先安装真实正式 `android-v0.3.10` 原生APK，使用VIEW交接新offer完成真实配对（不涉及物理光学扫码）。UI存入草稿，冷启旧包确认文本实际为 `QA_FORMA`。长ADB输入在初次引导负载下仅录入该前缀，验收按实际存下的内容比较，不把未输入的后缀算通过。

旧、新APK均实际执行 `apksigner verify --print-certs`，SHA-256分发证书相同：`4c292f304130080d89b3a2f5c236169b5dcda1fd7fbb8470ba66a186092273cc`。使用 `adb install -r` 成功覆盖为真实CI候选 `51ae41b3dc` 的0.3.11、versionCode5，未卸载原包；再次force-stop/冷启后电脑Ayase、会话Android Long History260和草稿 `QA_FORMA` 全部保留，随后原加密凭据重连成功。

[旧包冷启UI记录](evidence/formal-code4-preserved.xml)、[新包UI记录](evidence/formal-code5-preserved.xml)、[新包稳定截图](evidence/formal-code5-preserved.png)。冷启瞬间第一张PNG黑屏，稍后稳定画面已重新截图并视觉复核，黑图不作为通过证据。该CI先前失败来自smoke工具对空输入点disabled连接，不能混作产品安装失败；最终修订签名候选仍需再次覆盖检查。

历史Web迁移、网络竞争、外部Git和新增管理入口的后续实测见下。

## 真实历史 Web → 原生非空迁移

从完整原生替换之前的实际源码 `e840f28e0c5ff6502b783fde7c687a387afcdca1` 提取旧 Android/Web，旧包 versionCode2；当前原生源码是独立构建的 versionCode4 debug。两者只把 applicationId 改为 `ai.deepseek.harness.mobile.migrationqa`，使用相同标准 debug 证书，独立于正式包。此机制验收不能描述为已发布正式0.3.10旧Web升级，因为该正式包实际已经原生。

[历史种子 instrumentation](fixtures/LegacySeedInstrumentation.kt) 在旧包的真实 targetContext/加密webAppUrl偏好和 `https://appassets.androidplatform.net` origin 写入2台完全合成电脑与3份中文/多行草稿。初次种子在JS回读后立即finish，Chromium未持久化，导致后续读空；该轮0/0被外部精确数量断言拒绝。修订夹具先destroy WebView、要求实际leveldb非空，再force-stop并启动独立旧进程 readonly读取，确认 **2台电脑/3份草稿** 已真实持久化。只清理过这份纯合成迁移夹具以重建旧基线，正式app数据始终保留。

随后使用 `adb install -r` 同签覆盖到原生迁移包，不卸载、不清数据；通过真实 MainActivity 的异步旧数据读取，等原生入口显示 QA Legacy A/B 后运行现有 `NativeUpgradeInstrumentation`，逐项比较旧凭据字段/secret与原生加密存储、每份草稿原文，实际返回 **PASS: preserved 2 legacy computers and 3 drafts**。2秒早读的‘Migration has not completed’不作为最终结果；未直接调用import或修改生产迁移实现。

[精简实测记录](migration-result.txt)、[原生入口XML](evidence/migration-native-stable.xml)、[原生入口截图](evidence/migration-native-stable.png)、[独立包名构建覆盖](fixtures/migration-variant.gradle)。合成电脑故意指向 localhost:1，入口的连接失败是预期，不代表真实账户认证。

后续仅加强测试 instrumentation：默认拒绝空旧数据，并支持 `-e expectedComputers 2 -e expectedDrafts 3` 精确数量；重新构建androidTest后只回读现有迁移数据，实际仍 [2/3通过](migration-expected-result.txt)。负例传3台电脑/3份草稿，实际 [FAIL: Expected 3 legacy computers, found 2](migration-mismatch-result.txt)。没有重复升级或修改生产迁移逻辑。

## 正式原生 Git → 外部测试仓库

本段在实际CI签名 `d3c32fe027`、0.3.11/code5上完成，不将后续根目录修复外推为该包已具备。独立私有仓库 `ChisaAlter/WhaleIsle-android-qa` 仅含合成验收数据。原生Git页创建并切换 `qa/android-device-20261027`；有两份未跟踪合成文件时取消所有文件勾选，快捷 Commit/push/PR 的最近可点击节点 `enabled:false`，[实际截图](evidence/external-git-zero-selected.png)。Compose文字子节点仍为enabled，判定按按钮祖先而非文字状态。

仅勾选 `qa-selected.txt` 后从正式原生页面填写说明并执行 Commit/push/PR，真实提交 `1d6ee16cdd429b6300a34cfede251682b0048b08` 的文件清单只有该文件，`qa-not-selected.txt` 仍为 `??`；远端分支SHA完全一致。[单文件勾选](evidence/external-git-only-one-selected.png)。PR首次确认被桌面正式实现的工作区须干净规则拒绝，UI保留已完成commit/push和仅剩PR，标题正文仍在，没有重复提交。核对排除文件内容、绝对源路径及不存在的目标后，将这份合成文件保留到本QA忽略证据目录，再从原生页仅继续PR。

原生[确认表单](evidence/external-git-pr-filled.png)实际创建 [QA PR #1](https://github.com/ChisaAlter/WhaleIsle-android-qa/pull/1)。GitHub正规回读显示 OPEN、`isDraft:false`、head为同一 `1d6ee16...`，files仅 `qa-selected.txt`，新增1行；产品此处未提供draft选项，所以不称draftPR。[回读JSON](external-git-result.json)。测试PR保留OPEN供审阅，未合并；不属于产品仓库待合并PR。

期间专属本地QA仓库与另两名同伴的工作树曾物理消失，原因未明，本agent没有清理/移动该目录。恢复前实际核对不存在，再clone同名专属仓库、确认远端没有QA分支后从原生UI重建。该外部环境事件不作为产品Git失败。

## AVD 真实断网恢复

同一正式code5包和外部Git会话中，输入未发送草稿 `QA_OFFLINE_DRAFT_20261027`；仅对 `emulator-5556` 关闭Wi-Fi与移动数据。实际客户端显示DNS/连接失败，发送按钮禁用且草稿保留。重新启用网络后，原保存凭据自动重连，同会话标题/原草稿一致，发送按钮恢复可用。全程未点发送，无隐式重放。[结果JSON](network-result.json)、[离线状态](evidence/network-offline.png)、[恢复状态](evidence/network-recovered.png)。该项是实际AVD网络开关，不替代业务ACK去重或未做的跨会话传输竞争。

## 最终签名 2212 原生 UI 验收

最终CI source `2212a19582757823a21be373a36bfee37e9088e6`、0.3.11/code5，APK 34,572,041字节、SHA256 `e3ecb6e69942b7b2a858f8491d2a5729c64e7c3e63a08532662adfde31223f1a`，分发证书SHA256仍为 `4c292f304130080d89b3a2f5c236169b5dcda1fd7fbb8470ba66a186092273cc`。本机再次实际hash/cert核对后以 `adb install -r` 覆盖d3c code5，未卸载或清正式包数据。先检查原电脑、外部Git会话和 `QA_OFFLINE_DRAFT_20261027` 均保留。[精简结果](final-signed-ui-result.json)。

在该最终签名包上从真实原生工作菜单打开文件：根目录成功列出合成文件，先前d3c的‘path is required’缺陷已消失；[根目录](evidence/final-2212-files-root.png)、[PNG预览](evidence/final-2212-file-image.png)、[全屏图片](evidence/final-2212-file-lightbox.png)均在AVD可见并逐图视觉复核。图片实际内容为‘ANDROID FILES QA20261027’，不是仅以返回base64或空pixel代表界面通过。全屏重置和关闭可操作；未把未量化的双击/双指缩放幅度列为通过。

将同一合成PNG置于AVD `/sdcard/Pictures/qa-image.png` 后经系统媒体扫描，在正式包‘从相册选择’的真实系统picker选择，返回后原生[附件缩略图](evidence/final-2212-gallery-selected.png)实际可见。再次打开picker并取消，已有附件与 `QA_FORMA` 草稿仍在，[取消后记录](evidence/final-2212-gallery-cancelled.xml)；随后移除合成附件，没有发送图片、没有调用物理相机。

最后force-stop/冷启正式包：原保存电脑凭据自动重连，默认打开目录首会话External Git并恢复该会话草稿 `QA_OFFLINE_DRAFT_20261027`；显式选择LongHistory后仍有原 `QA_FORMA`。[冷启重连](evidence/final-2212-cold-reconnected.png)、[另一会话原草稿](evidence/final-2212-original-draft-preserved.png)。产品当前没有持久化‘最后所选会话’，不将此描述为冷启回到上次会话。最终这轮于2026-10-27 18:55（Asia/Shanghai）完成。

物理光学扫码/真实拍照仍按用户‘手机先跳过’明确跳过；公网Kotlin加密通道、正式签名AVD UI、迁移fixture及各自范围分别记录，不作一项全能通过。跨会话回调归属有定向单测，但本轮没有再造真实socket跨会话竞争用例。
