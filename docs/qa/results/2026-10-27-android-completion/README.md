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

历史Web迁移、网络竞争、外部Git和新增管理入口继续执行，后续结果追加。
