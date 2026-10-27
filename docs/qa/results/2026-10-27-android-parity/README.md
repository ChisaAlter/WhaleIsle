# Android 原生桌面功能补齐

本轮实现来自 `origin/main` 的 `b871710607`，使用独立工作树 `C:/AI/WhaleIsle-android-parity-20261027`、分支 `feat/android-parity-20261027`。Android 原生代码提交为 `db66668c54` 和 `f6015e885f`。Host 白名单、图片和账户回调桥由 lead 的 `ee4808d16b`、`09ed3341b7` 提供；发送 ACK 和插件长操作超时由 android-qa 的 `0d64d1b1a9`、`2709841a9c` 提供，各自检查以负责者报告为准。

## 原需求与边界

已读取 #285 最新正文、根 AGENTS、维护规范、手机远程资料和实际 Kotlin/Host 服务。#285 的桌面差异项为 Files、Diff、MCP、技能、插件、lightbox、子会话树、Git 快速动作与账户设置。Terminal 与完整可执行交互页面不在议题正文的明确新增要求中；现有原生契约排除 PTY、Browser 和 SPA WebView，本轮保持该边界，已向 lead 汇报。主 Activity 的竖屏约束保持。

未改原用户工作区、安装 GUI、用户数据或原服务，没有使用 9229。GitHub PR 写入、发布和集成由 lead 负责。用户后续要求暂跳过物理手机；本报告不认证真机扫码、拍照或最终包的设备结果。

## 实际入口与负责代码

| 入口 | 原生行为与正式服务 |
| --- | --- |
| 会话与工作区 → 文件 | `workspaceFiles.list/read`，真实会话作用域，目录下钻与返回，200 行分页，空目录与读取失败分开；图片使用 lead 的 `workspaceFiles.readImage`，2 MiB 完整读取上限。 |
| 会话与工作区 → 更改 / Diff | 复用 Electron `git-diff`；未提交或指定 Git 引用，逐文件/hunk 查看，差异原文横向滚动，截断提示。`null`/缺少 files 是失败，`files:[]` 才是空更改。 |
| 设置 → MCP 服务器 | `mcpServers.list/upsert/setEnabled/retry/test/delete`；真实连接和工具状态、托管配置增删改、stdio/HTTP、参数、环境与请求头。只读来源保持只读，敏感项以服务脱敏值为准，空白更新保留原值。新 ID 为服务允许的 32 位字符。 |
| 设置 → 技能 | `skillInventory.list/get/create/update/delete/setInvocation`；按当前会话/目录发现，搜索名称/说明/分组，读取 Markdown，用户/项目创建、分组和正文编辑、调用开关、删除确认。按服务返回的 writable 控制写入。 |
| 设置 → 插件 | `pluginInventory.list`；存在 managementAvailable 才调用 `pluginManager` 清单与管理。可检查安装来源、显式安装与批准指定脚本、启用/停用、移除；无管理服务显示真实只读清单。安装使用 requestId，支持取消与人工 `waitForInstall` 恢复；断线/迟到响应不自动重放。恢复无结果不显示成功。 |
| 设置 → 电脑设置与供应商 | `settings.describe/mutate`，解析实际 Schemastery refs/dict/meta/inner/list。按字段路径编辑，隐藏值只输入新值，提交 expectedRevision，冲突保留原描述与编辑。供应商 API 凭据走 `credentials.describe/set/unset`，不能读回密钥。 |
| 设置 → 账户 | 安全账户状态、资料、充值/赠送余额、奖励通知与确认、平台用量/充值链接、退出前运行任务提醒。人工登录复用 `account.startSignIn` 与 lead 的 `account.completeSignIn`。 |
| 图片 | 原生 lightbox、上/下一张、双指缩放、双击和复位，图片按 bounds 采样。聊天与工具结果中的图片可进入查看器，附件仍走现有会话附件读取。 |
| 侧栏 | 按 subagent origin/parentSessionId 显示层级与折叠，父会话工作区归组，Fork 保持普通可编辑行；缺失父项与循环不丢行。 |
| Git 任务页 | 按桌面状态决定快速动作，Fetch、Commit/Push/PR/Pull/Publish/View PR 继续复用既有实际路径。已推送但相对主干仍有更改时保留 Create PR；分叉不伪装可同步；零选中文件在 UI 和 VM 执行入口均拒绝提交。 |

新增组件集中在 `mobile/android/app/src/main/java/ai/deepseek/harness/mobile/ui/NativeDesktop*`、`NativeAccountLogin.kt`、`NativeImageLightbox.kt`。`NativeDesktopController` 按电脑/会话/请求代次保护读取和写后刷新，迟到响应不得调用新电脑的后续 RPC。OAuth 在 IO 线程绑定手机 127.0.0.1 动态端口，校验精确路径、Host、参数与长度；授权码/state 只经 E2EE 提交原发起电脑，不保存到手机。等待 initializing → waiting-browser 使用有界读取，不重发登录操作；活动登录只提供取消，重复点击不会更换回调端口。

## 已执行验证

1. 首轮 `:app:compileDebugKotlin` 通过。
2. 初次新增定向测试运行发现测试 fixture 括号错误，未计通过；修正后 `:app:testDebugUnitTest --tests '*NativeDesktop*' :app:assembleDebug :app:lintDebug` 完整通过。此时新增 12 项，0 失败/跳过；debug APK 38,845,194 字节；lint 0 error、17 warning、2 information。
3. 审查发现并修正 MCP ID、Diff null、活动登录重复点击、迟到 OAuth 跨电脑、Git 零选择、插件重连结果归属和已推送分支 Create PR。最新 `:app:testDebugUnitTest --tests '*NativeDesktop*'` 通过：NativeDesktopControllerTest 10/10，NativeDesktopDataTest 10/10，0 失败/错误/跳过。该命令包含最新产品和测试 Kotlin 编译。
4. 最后一次重复 assemble/lint 在 lead 的正式性能空载测量前主动终止，不计该次通过；最终 signed 产物与模拟器操作由 lead/android-qa 的对应记录认证。没有重新执行既有 App64+protocol15 整体套件。
5. `git diff --check` 与两次实际原生提交的 staged check 均通过。Host 桥、ACK 和长超时提交在本工作树已合入，未重复运行负责者已通过的完整测试。

20 项新增回归包括真实 lookup/分页参数、跨电脑迟到回复隔离、缺插件管理服务只读、设置 revision 冲突、Diff 失败/真空区分、活动登录重复点击、延迟登录返回原电脑取消、安装重连/人工恢复/无结果不重放、创建 MCP ID 文法、Git 零文件选择、已推送分支 Create PR、Schemastery 引用解析和 secret sidecar、目录路径约束、工具图片、子会话折叠/孤儿/循环/Fork 与工作区继承。

## 验证限制

本报告只陈述上述源码、JVM 行为和本地构建结果。真实远程服务的安装/外部鉴权、OAuth 平台授权、最终签名 APK 的逐项原生操作必须结合 lead/android-qa 后续记录，不能用 20 项自动测试替代。物理手机按用户要求暂跳过；本轮未重启或修改安装中的用户 GUI。
