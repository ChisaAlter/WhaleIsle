# Android 剩余验收与待确认发送身份

接续 [首轮手机结果](../2026-10-27-android-device/README.md) 和 [#285](https://github.com/ChisaAlter/WhaleIsle/issues/285)。本轮基线 main `b871710607`，独立分支 `fix/android-device-completion-20261027`。用户随后明确“手机先跳过”，从该指令起不再占用原物理设备，光学扫码/真实拍照按本轮要求跳过，不标通过。后续 Android 运行以隔离 API35 x86_64 AVD 为准，不能替代物理相机。

## 丢 ACK 的业务身份修复

Android 旧 `session.prompt` 不传业务 `requestId`；桌面 tunnel 每次补一个新ID，因此请求实际已入账、回复丢失时，用户显式重发原文会成为第二条消息。传输层随机 RPC requestId 只负责匹配回复，不能替代该业务身份。

最小修复在 ViewModel 按电脑/会话保存未确认的 `{requestId,text,images,mode}`。用户显式重发完全相同内容、图片和发送模式时复用身份；任何负载变化产生新身份；只有 `accepted:true` 才清待确认记录和草稿。没有新增自动重发或后台 retry。记录属于当前 ViewModel 生命周期，进程重建后的发送恢复不在此实现范围。

验证：两条新定向回归在旧实现均失败；修复后 `DshViewModelRemoteTest` **42项全部通过**，包含丢ACK保留草稿、10秒不自动重放、显式同负载重发同ID、成功后再次同文为新ID、文本/图片/模式变化为新ID、切会话保持各自归属、accepted:false保留图片与草稿。

真实桌面对照：官方 Electron **44.9.1**，独立 profile/端口53876、CDP53877、daemon53878，无 plain-Node execPath DI。专用session `session-019819cd-c18a-41f3-999a-f53f6f327152` 两次提交同业务ID `android-qa-3ea79705-55a6-4ef9-bde2-e556689719ef`，第一回复由调用者丢弃、第二 `accepted:true`；实际持久history仅有 **1条**该 `source.rpcId` 的 `user/message`。这先证明真实服务端去重；尚不能把调用者丢弃回复当作 Android 传输中断。

上轮 plain-Node QA DI 是当时工作绕行，本轮官方同版 Electron daemon 已正常ready/relayConnected，旧限制不能继续笼统标记为“正式daemon不可用”。本轮某次冷启动超过30秒后被父进程停止，一次正常remote off/on后正式daemon成功；不修改产品超时或以冷启动失败冒通过。一次重复启动exit0来自已有同QA单实例锁，监听进程仍存在，不是产品原生崩溃。

## 插件管理 RPC 等待

只将 `pluginManager.installBundle` / `pluginManager.removeBundle` 的 host RPC 等待改为12分钟，匹配实际管理操作时间；其他host方法仍30秒，Git仍120秒。操作归属、显式取消和不确定结果回读由原生管理面实现；加长等待不自动重放请求。

## 环境与后续记录

本机原无模拟器组件/镜像。已从官方URL下载 emulator37.2.12，WHPX检查usable；API35 Google APIs x86_64 r9镜像SHA1 `0103e6dab21290c4b9d16550a3ce99476f884eef` 与官方清单匹配。独立AVD `WhaleAndroidQA35`、端口5556、工作树 `.tmp/avd35`，不操作原1836e17d。

真实当前 Android 正式 `android-v0.3.10` APK 已检查：versionCode4，MLKit/dexopt assets，无SPA，属于原生客户端，不能当旧Web包。旧Web迁移将使用真实历史源码同debug签名的隔离包；正式同签升级另用真实release code4→候选code5，分别记账。

多页历史已通过原有 JSONL persistence 创建260消息/781events的专用session `session-android-longhistory-20261027`，等待AVD完整分页；该合成历史用于边界检查，不冒充260次真实AI请求。真实传输丢ACK/网络竞争、外部Git、同签升级/历史Web迁移与新增原生入口验收继续执行，后续结果追加于此。
