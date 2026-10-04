# 手机远程

中文 · 扫桌面 **远程** 弹窗里的二维码。浏览器运行 `mobile/web` SPA；Android 使用 Kotlin 协议客户端与 Jetpack Compose 原生界面，扫码、聊天、工作区、Git、设置与媒体选择均由原生代码负责。它们都不是官方四栏 `dsh web`。

**0.3.0 发布范围：** 默认交付 Windows x64 桌面安装包，不发布 Android APK。本文是源码能力说明，Web 第二客户端与 Android 未纳入本次实机放行范围，不能据此视为手机全流程验收通过。见仓库内的[中文发布说明](../.github/release-notes.md)和[英文发布说明](../.github/release-notes.en.md)。

**后续交互改造（2026-09-06，本地候选已构建，验收未完成）：** 上述发布范围保留为历史记录，不豁免本轮 T1 公网 Web、适用 T2 LAN 与 T3 Android 验收。当前修订的 debug APK 已构建，JVM 测试与源码资源审计通过，但不能记为真机 Pass。行为以[手机远程 feature card](../docs/features/mobile-remote.md)为准，候选身份见[打包记录](../tools/mobile-web-qa/results/2026-09-06-interaction/packaging.md)。

**浏览器证据边界：** 早期候选的 60/60 受控 DOM 检查覆盖六种尺寸，动画 snap 状态只证明当时的 DOM/几何，不是动效时序或真机证据。之后源码已修改，最终源复测因 T3 Code preview 的 evaluate/snapshot/navigate 工具超时未完成，**不得宣称最新修订 60/60 Pass**；公网与物理设备也未验收。详见[本轮证据](../tools/mobile-web-qa/results/2026-09-06-interaction/README.md)。

## Web

1. 手动开启桌面远程。未配置时默认「服务器」，「局域网」可手动选择；已保存的模式和地址保持不变。页面地址以桌面生成的配对链接为准，offer 内的中继端点只承载 dshd WebSocket，不是 SPA 页面。
2. 用系统相机扫码，或在 SPA 内用 `BarcodeDetector` + `getUserMedia` 扫码/粘贴完整 `#offer=` URL。
3. SPA 解析 offer v2 后创建浏览器版 `DaemonClient`，通过中继与桌面 daemon 端到端加密通信。首次配对取得的 `deviceSecret` 保存在该 SPA origin 的 localStorage；没有 hash 的后续启动会 sticky 重连。
4. 配对后是桌面 `dsh web` 的同协议第二客户端：daemon 白名单 host 隧道转发 `session.list` / `workspace.list` / `session.history` / `session.prompt` / `session.cancel`，审批走 `respond` → `POST /api/respond`。新会话走 `session.create`，支持已有工作区、无工作目录，以及 `host.listDirectory` / `host.createDirectory` / `workspace.create` 浏览和登记目录；不是 ACP `fetchAgents` / `createAgent`。
5. 模型与思考档走 `session.models` / `session.selectModel`；权限、Plan 与斜杠命令走 Typert `commands/execute`，不能作为聊天文本发送。草稿、附件与异步结果保留设备/会话归属。
6. Git 走 daemon 隧道 `shell:git-*` 到桌面 Electron Git dispatch，不是 ACP checkout/file RPC。支持 Init、分支搜索/切换/跟踪、**创建并检出分支**、Commit/Push/PR 组合动作、Pull、Publish 与 View PR；具体白名单与恢复边界见 feature card。Files / Diff / MCP / 技能仍显示冻结说明，不提供假文件列表；打开电脑路径与受限设置不开放。
7. 权限、模型、附件来源与行菜单用短面板；目录浏览和 Git 表单用全屏任务，设置按目录/详情分层。屏幕返回、浏览器返回和 Android 返回共用网页导航决策；交互样式与动效见[设计语言](../docs/design-language.md#手机远程交互)及[手机动效 inventory](../docs/motion.md#手机交互-inventory)。
8. 开发测试：`node --test "mobile/web/**/*.test.js"`；构建资源与 QA 服务测试：`node --test tools/mobile-web-qa/server.test.mjs tools/mobile-web-qa/runtime-assets.test.mjs`。命令从仓库根目录执行。

应用内扫码的降级（如实呈现，不 vendor 第三方解码库）：

- LAN `http://192.168.x.x:3180` 不是 secure context，取不到相机——按钮不渲染，提示用系统相机扫码或粘贴链接。应用内扫码只在安全 origin（例如 Android asset origin）可用。
- iOS Safari / Firefox 没有 `BarcodeDetector`——同样降级为粘贴。
- 相机权限被拒（`NotAllowedError`）→ 权限说明屏，指引浏览器站点设置，可改用粘贴。
- 扫到异 origin 的配对码 → `location.replace` 整页跳转到二维码里的本机 SPA 地址，token 留在 `#offer=`，不进查询串。

中继能看到连接元数据，但会话内容由 daemon/client 密钥端到端加密。服务器模式使用应用配置的默认地址或用户显式保存的地址；不要把任意公共服务当成可信替代端点。

## Android

工程在 `mobile/android/`（包名 `ai.deepseek.harness.mobile`，minSdk 26，compileSdk/targetSdk 36，versionCode 3 / versionName 0.2.0）。CameraX 扫码、粘贴与系统 VIEW handoff 解析同一条 offer v2 URL；页面地址仅用于识别配对链接，通信直接连接 offer 的中继。

Kotlin `protocol` 模块以 OkHttp WebSocket、TweetNaCl Java 的 Curve25519 / XSalsa20-Poly1305、HMAC-SHA256 实现现有桌面 wire 协议，校验消息认证、salt 和单调序号。首次配对保存设备凭据，后续连接用新挑战证明，不重放一次性 token。凭据与文字草稿使用 Android 加密存储，草稿按电脑/会话隔离；图片附件在进程内按同样归属保留。

Compose 提供会话列表、分页历史、运行中的回复更新、原生 Markdown、工具详情、审批、发送/停止、模型/思考、权限与斜杠命令，以及目录浏览/创建、工作区和会话管理、搜索、Git 与外观设置。Files / Diff / MCP / 技能保留与 Web 相同的未接入说明。系统相册/相机通过受控 URI 返回附件；IME 返回先收键盘，前台恢复重新同步或用保存凭据连接。

APK 不内嵌 SPA、JavaScript bundle 或 WebView 传输桥。覆盖升级首次启动时，唯一临时 WebView 只在原稳定 asset origin 的空白页读取旧 localStorage 凭据和文字草稿，禁用网络后迁移至原生加密存储，随后销毁；不运行旧 SPA、不清除旧数据。迁移失败显示错误，不标记成功。

```text
cd mobile/android
./gradlew :protocol:test :app:testDebugUnitTest
./gradlew :app:assembleDebug
```

需要 Java 17 和 Android SDK。协议互通测试调用仓库 vendored JavaScript NaCl/加密通道作为独立桌面端观察器，因此开发测试还需要 Node 与 `vendor/chisacode-remote` 依赖；Android 构建及运行不依赖 Node。JVM 测试覆盖配对解析、真实 WebSocket 加密互通、错误凭据/重放/篡改、历史分页、草稿与迟到附件归属、数据迁移；它们不代替真机操作。

覆盖升级必须同签名且 versionCode 递增；使用 `adb install -r` 保留数据。debug APK 不建立正式签名更新的验收结论。实际验证范围和未测项在 PR 中如实说明，历史结果不自动继承。
