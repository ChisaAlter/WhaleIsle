# Android 原生桌面功能补齐

本轮实现来自 `origin/main` 的 `b871710607`，使用独立工作树 `C:/AI/WhaleIsle-android-parity-20261027`、分支 `feat/android-parity-20261027`。Android 原生代码提交为 `db66668c54`、`f6015e885f` 和文件根目录修复 `04d6ddecac`。Host 白名单、图片和账户回调桥由 lead 的 `ee4808d16b`、`09ed3341b7` 提供；发送 ACK 和插件长操作超时由 android-qa 的 `0d64d1b1a9`、`2709841a9c` 提供，各自检查以负责者报告为准。

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

## 真实公网中继验收

`NativeDesktopRealHostTest` 以环境变量 `DSH_ANDROID_E2E_INPUT` 显式选择 android-qa 的独立官方 Electron Host。配对码在测试运行时刷新，使用实际 Kotlin `RelayClient` 经公网 TLS 中继和 E2EE 认证，实际 `NativeDesktopController` 消费 Host/Git 正式服务；没有 MockHost、预设响应或服务替代。夹具使用独立注册目录和新会话，不借用 ACK/Git 验收会话，不发模型 prompt。测试只写自有 MCP/项目技能/临时凭据/无脚本插件包，账户只读，不退出、授权或撤销现有账户。设置只选非 secret 字段，读取新 revision 后按原 user 层路径恢复。会话归档删除与 workspace 注销没有返回清理错误。

首轮完整执行 3 分 41 秒，实际案例执行 158.433 秒：8 项中的 7 项通过，Files 根目录失败并与最终 APK 的模拟器报错一致。根因是 Android 将 UI 的空根目录路径直接传给 Host，而正式服务要求非空路径。`04d6ddecac` 仅在 wire 参数中将空路径转换为 `.`，保留 UI 相对路径语义。只重跑受影响 Files 和原 lookup/分页参数回归，合计 1 分 42 秒通过，真实 Files 用时 26.498 秒，JVM 参数回归 0.224 秒，2 项 0 跳过、0 失败。其他 7 项没有重复执行写操作。

| 真实案例 | 结果与实际断言 |
| --- | --- |
| Files 根目录、分页、图片 | 修复后通过。实际根目录列出 pages.txt，450 行按偏移 1、201、401 读取，与原始行逐字一致，第三页 EOF；pixel.png 返回 image/png，base64 解码后的字节与原 PNG 完全一致。 |
| Diff | 首轮通过。实际未跟踪文件出现于 Git 差异；不存在的 Git 引用使 controller 显示失败；切回工作区差异可恢复。 |
| MCP | 首轮通过。32 字符新 ID 经过真实服务文法，创建 disabled stdio 配置、修改名称/超时、禁用、删除并逐步读取确认；没有连接外部服务器。 |
| 项目技能 | 首轮通过。创建、正文读取、修改正文与分组、修改调用标志、删除，列表和详情确认各步结果。 |
| 设置 | 首轮通过。真实 describe 的 schema/值用于字段编辑，写后读取一致；旧 expectedRevision 被拒绝；按新 revision 恢复原 user 层单字段。 |
| 凭据 | 首轮通过。新 QA_ONLY 引用 set → describe configured → unset；状态响应不包含写入的合成值，未读回真实密钥。 |
| 插件 | 首轮通过。此官方 QA Host 实际挂载 pluginManager；自有无 scripts 本地 bundle 的 inspect、安装、停用、启用、移除以及清单确认均通过，没有以只读缺服务代替写入验收。 |
| 账户 | 首轮通过。实际 account.getState 的状态存在，未创建登录请求，没有执行 signOut。 |

脱敏汇总为同目录 `real-host-results.json`，结果来自首轮 7 项通过加修复后 1 项受影响复验。独立真实测试提交 `b791aa035a` 默认在没有显式 QA 环境输入时跳过；CI 的该跳过不能替代上述实际执行。此前云候选的 103 项测试、lint 和签名结果由 lead 提供；根目录修复与新增 opt-in 测试加入后，最终云签名和设备结果以 lead/android-qa 的最新记录为准。

旧实现工作树在修复提交后变为不可用。已提交的产品代码与 QA 私有运行报告仍在；未提交的测试源码从本会话完整写入及增量编辑记录恢复到新的独立证据工作树，不重跑已通过的真实写操作，不改原用户工作区。

## 虚拟 OAuth 桥贯通验证

新增 `src/shared/dshd-account-callback.integration.test.js`，在独立 Node 测试进程中构造真实 Cordis Context、WebServer、PlatformAccount、AuthorizationService 和 LocalCredentialProvider。平台端是临时 HTTPS 服务，使用现有 TLS 证书生成器产生 localhost 证书，只给本用例独占的 undici Agent 配置信任 CA，每例后恢复原 dispatcher；没有替换 fetch、禁用 TLS 检验或改动产品代码。Host 回调使用实际 loopback HTTP。平台响应的 authorize/authorized 地址保持 HTTPS，符合桥的正式完成地址约束。

本地复用既有 prepared Harness artifacts，以 `DSH_ACCOUNT_INTEGRATION_ROOT=<prepared Harness checkout> node --test --test-concurrency=1 src/shared/dshd-account-callback.integration.test.js` 执行，4/4 通过、0 失败、0 跳过，耗时 14.035 秒。四个案例分别验证：错误 state 拒绝后合法 state 可以完成，成功桥响应前 grant 已实际持久化；已取消 attempt 的晚到回调不能成功；真实 provider 超时后的晚到回调不能成功；平台交换拒绝经正式 HTTP/provider 流程后不存 grant。成功用例额外验证重复回调不再交换、bridge 结果不含 token。

PKCE state/verifier/challenge 均来自正式 PlatformAccount。临时平台校验初始化携带 S256 challenge 且不含 verifier，交换时验证 `base64url(SHA256(code_verifier))` 等于原 challenge，并检查 redirect URI、授权码和实际生成的设备 ID。该验证贯通 `forwardHostRpc(account.completeSignIn)` → 正式 `/oauth/callback` → provider 状态校验/交换 → AuthorizationService 提交 → 本地凭据落盘；没有以单独 provider 单元测试推断 bridge 成功。

永久测试仅在整套所需账户 artifacts 或依赖尚未准备时使用现有 VENDOR_RUNNABLE 约定明确跳过，不使用额外 opt-in 门槛。有完整 artifacts 时 import/runtime 错误会实际失败。隔离文本工作树的默认缺产物检查为 4 跳过，与上述复用既有产物的实际 4 通过分开记录。测试源码初始提交 `57c726f396`，汇总见同目录 `oauth-bridge-results.json`。账户、授权、凭据和 WebServer fibers、临时 HTTPS listener、dispatcher 和用例独占临时凭据目录均已清理。共享 QA Host、AVD、真实用户账户和其他存储文件没有改动。

## 验证限制

上述真实验收验证管理动作在公网加密通道中执行，以及虚拟 OAuth 桥在临时平台上的完整 provider 提交机制；不认证外部 MCP 服务互操作、真实公网平台用户授权或任何真机硬件行为。真实用户浏览器 OAuth、最终签名 APK 的原生逐项操作结合 lead/android-qa 的后续记录。物理手机按用户要求暂跳过；本轮未重启或修改安装中的用户 GUI。
