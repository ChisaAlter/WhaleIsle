# T3 Code 生成式 UI 源码调研

**调研日期：** 2026-10-08（Asia/Shanghai）。

**观察版本：** 官方 `pingdotgg/t3code` 的 `main`，固定提交 [`a4c9494b0e3606775cc5fc929fc138399288bd43`](https://github.com/pingdotgg/t3code/commit/a4c9494b0e3606775cc5fc929fc138399288bd43)，提交时间北京时间 2026-10-08 18:31:54。

**本地源码：** `C:/AI/t3code-source-20261008`（独立 Git clone，不修改 WhaleIsle 产品代码）。

**方法：** 实际 Git clone 官方仓库，在独立目录读取 `apps/server`、`apps/web`、`apps/mobile`、`packages`、`docs`；核对官方 PR 的 `merged`/`merged_at` 和发布记录。未安装依赖、未启动 T3 Code、未运行模型或交互测试。本文的运行结果描述来自官方文档或 PR 作者的记录，不能当作本次实测。

## 1. 当前官方能力是什么

官方用户文档把功能称为 **Visual replies**，源码内部称 **HTML renders**。它已经合并：代理可以生成完整 HTML 页面，经 `html_preview` 预览后调用 `html_render`，页面直接出现在对话中。另一个刚合并的功能是 **MCP Apps**：MCP 工具的结果可以携带应用页面，在对话内运行并经宿主桥接调用工具或通知代理。两者都是 HTML 页面宿主，但不是相同的交互产品。[官方用户文档](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/docs/user/html-renders.md)、[HTML 类型与协议](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/packages/shared/src/htmlRender.ts)、[MCP Apps 类型与协议](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/packages/shared/src/mcpApp.ts)。

| 路径 | 页面从哪里来 | 支持的 provider | 页面与代理的关系 |
| --- | --- | --- | --- |
| Visual replies / HTML renders | 代理把完整 HTML 字符串传给内置 `html_render` 工具 | 官方文档声明所有 provider | JavaScript 可以完成页面自身交互；现有宿主桥只提供主题、尺寸、打开链接 |
| MCP Apps | 已配置的 MCP 工具声明 `ui://` 资源，工具完成后 T3 捕获它的 HTML | 当前只有 Codex | 页面可调用所属 MCP server 的工具、读资源、请求发用户消息、更新下一轮模型上下文 |

该区别可直接从客户端验证：HTML renders 使用 `HtmlRenderDocument`，只处理主题、链接、尺寸消息；MCP Apps 使用独立的 `makeMcpAppHost`，处理工具调用、消息、模型上下文等 JSON-RPC 方法。[HTML 宿主](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/web/src/components/files/BrowserDocumentFrame.tsx)、[MCP Apps 宿主](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/packages/client-runtime/src/mcpApps/host.ts)。

### 合并与发布边界

| 变更 | 官方合并状态 | 北京时间 |
| --- | --- | --- |
| [#15968：代理在对话内显示 HTML 页面](https://github.com/pingdotgg/t3code/pull/15968) | 已合并，`677d1527…` | 10 月 6 日 06:43 |
| [#16196：HTML frame 改用 MCP Apps 桥消息](https://github.com/pingdotgg/t3code/pull/16196) | 合入 #15968 的工作分支，随后随其进入 main；原合并提交 `87a7ca49…` | 10 月 6 日 05:19 |
| [#16236：MCP Apps 在对话内渲染和运行](https://github.com/pingdotgg/t3code/pull/16236) | 已合并，`4d976d1f…` | 10 月 8 日 00:44 |
| [#16283：HTML 页面不再截留对话滚动](https://github.com/pingdotgg/t3code/pull/16283) | 已合并，并在观察的 main/nightly 中 | 见 PR 合并记录 |

发布查询与提交对比显示：稳定版 [`v0.0.45`](https://github.com/pingdotgg/t3code/releases/tag/v0.0.45)（`6c8fed35…`，北京时间 10 月 3 日 02:17）尚不含上述新增功能；[`v0.0.46-nightly.20261008.2819`](https://github.com/pingdotgg/t3code/releases/tag/v0.0.46-nightly.20261008.2819)（`5e2225671f705fcd33f1ea5591b79ba612fb6974`，北京时间 10 月 8 日 18:41）已含 HTML renders、MCP Apps 和滚动修复。判断“最新”时应区分稳定版、nightly 与 main；main 存在不等于稳定版已经提供。[稳定版至 nightly 的提交对比](https://github.com/pingdotgg/t3code/compare/v0.0.45...v0.0.46-nightly.20261008.2819)。

## 2. 代理怎样生成和发布页面

### 2.1 是 MCP 工具调用，不是特殊 Markdown

T3 的共享代理指令有 `Showing visuals` 一节：当图表、表格、示意图、图片拼贴或 mockup 比文字更适合表达时，生成自包含 HTML，先预览，后发布，最后补充页面没有说清的文字。工具描述进一步提供主题 CSS 变量和页面布局规则。源码没有把本功能限定为某个模型家族。[代理指令](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/server/src/provider/T3OrchestrationInstructions.ts#L34)、[工具定义](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/server/src/mcp/toolkits/html/tools.ts)。

两个主要工具的契约如下，字段由源码归纳：

| 工具 | 输入 | 返回 | 用途 |
| --- | --- | --- | --- |
| `html_preview` | `html`，可选 `width`、`appearance` | PNG 截图、实际宽度、`contentHeight`、截图高度、控制台消息、可能缺失的本地图片 | 让代理观察和调整页面 |
| `html_render` | `html`、`title`、`height` | `htmlRender: { attachmentId, title, height, heights? }` 和提示文字 | 把成品发布到调用者的对话 |

工具要求 HTML 自包含并使用内联 `<style>`、`<script>`，允许远程 HTTP(S) URL 按原地址加载，例如 CDN 图表库。**源码推断：** 此处的生成式 UI 属于“代理编写可执行 HTML/CSS/JS，再由产品托管”的路径；不是模型选择一套固定 React 组件并生成 props。[页面规则与输入输出 schema](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/server/src/mcp/toolkits/html/tools.ts#L19)。

`html_preview` 只开放给有 T3 thread scope 的调用者；`html_render` 要求调用者的 thread run 仍有效，然后把页面发布进该 thread。独立连接 T3 MCP 的外部客户端没有这种 thread 身份，不能直接冒充对话内的代理发布页面。[工具 handlers](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/server/src/mcp/toolkits/html/handlers.ts)、[调用者权限声明](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/server/src/mcp/McpToolAccess.ts#L131)。

### 2.2 服务端准备和持久化

发布链为：

```text
代理生成 HTML
  → html_preview：独立 headless Chrome 截图及控制台输出
  → html_render handler
  → HtmlRender.prepare：注入主题/尺寸/链接 bootstrap，本地图片转 data URI
  → HtmlRender.publish：保存 attachmentsDir/<attachmentId>.html
  → 工具结果携带 htmlRender 引用
  → completed dynamic_tool 被映射为 html-render 时间线行
  → HtmlRenderFrame 获取签名 attachment URL
  → HtmlRenderDocument 的 sandbox iframe / 移动 WebView 显示页面
```

以上链路对应 [HtmlRender 服务](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/server/src/htmlRender/HtmlRender.ts)、[工具结果识别](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/packages/shared/src/toolOutput.ts#L185)、[时间线投影](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/web/src/session-logic.ts#L717)、[HTML 行组件](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/web/src/components/chat/HtmlRenderFrame.tsx)。

本地图片支持绝对文件路径，包括 HTML 属性、CSS `url(...)` 和 JavaScript 字符串。服务端检查图片实际字节类型后嵌入，不仅按文件扩展名判断；发布时缺失图片会报错，预览则返回缺失列表。因此页面不会依赖原始图片文件一直存在。删除 thread 会收集其 HTML/MCP App 附件，fork 删除不会删除源 thread 的页面。[图片嵌入](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/server/src/htmlRender/HtmlRender.ts#L131)、[附件归属](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/server/src/attachmentStore.ts#L118)、[删除时收集附件](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/server/src/orchestration-v2/ProjectionStore.ts#L4637)。

发布不要求预览浏览器已安装。已安装时会按多个宽度测量高度，测量最多等待 6 秒；失败仍保存页面而不附测量数据。首次预览会下载 T3 管理的浏览器，官方文档估计约 120 MB。[发布与测量](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/server/src/htmlRender/HtmlRender.ts#L328)、[预览说明](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/docs/user/html-renders.md)。

## 3. 页面运行、主题和隔离

网页和 Electron 都使用 `sandbox="allow-scripts allow-forms"` 的 iframe，故意不授予 `allow-same-origin`。附件响应另有 `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups`；浏览器同时执行响应和 iframe 的策略。生成脚本可以在页面内运行，页面以 opaque origin 与 T3 会话、宿主存储隔离。**这不等于禁用网络**：内置 HTML renders 明确允许远程资源，响应 CSP 没有把外部访问全部关掉。[HTML frame](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/web/src/components/files/BrowserDocumentFrame.tsx#L64)、[HTTP 响应策略](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/server/src/http.ts#L56)、[远程资源契约](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/server/src/mcp/toolkits/html/tools.ts#L19)。

主题在首屏前由 URL fragment 传入，后续切换以 JSON-RPC `ui/notifications/host-context-changed` 更新 CSS variables。bootstrap 报告 `ui/notifications/size-changed`；宿主计算 frame 高度，减少网页内滚动对对话滚动的截留。主题指南同时告诉模型避免外层卡片、边框、固定黑底或重复标题，让页面融入回答栏。[共享主题和 bootstrap](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/packages/shared/src/htmlRender.ts)、[动态高度宿主](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/web/src/components/chat/HtmlRenderFrame.tsx)、[滚动修复 PR](https://github.com/pingdotgg/t3code/pull/16283)。

HTML render 链接使用 `ui/open-link`。网页宿主核对消息来自该 iframe、iframe 有焦点、用户近期有实际交互，再打开 HTTP(S) 链接。移动端用 WebView 的窗口事件打开链接，并拒绝页面顶层跳转到其他地址。[网页链接检查](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/web/src/components/files/BrowserDocumentFrame.tsx#L84)、[移动 HTML 页宿主](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/mobile/src/features/threads/HtmlRenderWebView.tsx#L146)。

**源码推断：** 页面内的筛选、动画、计算器、按钮等可以由生成的 JavaScript 自行实现，但 HTML render 宿主没有 `tools/call`、`ui/message` 或 `ui/update-model-context` handler。不能据此声称“HTML 表单提交后自动让代理继续工作”或“页面状态自动持久化”。这类宿主交互是下一节 MCP Apps 的能力。[HTML 宿主完整实现](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/web/src/components/files/BrowserDocumentFrame.tsx)。

## 4. MCP Apps：把页面交互接回工具和代理

### 4.1 协议与捕获

观察源码采用 MCP Apps 协议版本 `2026-01-26`，扩展 ID 为 `io.modelcontextprotocol/ui`，资源 MIME 为 `text/html;profile=mcp-app`。MCP 工具通过 `_meta.ui.resourceUri`（也接受旧的 `ui/resourceUri`）声明 `ui://` 页面。[共享协议常量](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/packages/shared/src/mcpApp.ts)。

Codex adapter 初始化时声明此扩展。工具完成后，T3 从 `mcpAppUi.resourceUri`、`mcpAppResourceUri` 或 `appContext.resourceUri` 取 UI URI，通过 **Codex 自己的 MCP client** 的 `mcpServer/resource/read` 读取资源；因此复用用户为 Codex 配置的 server 和凭据，不另建 T3 直连。资源捕获最多等待 20 秒，失败显示普通工具行。保存成功后，工具 item output 变为 `{ t3McpApp: reference, result: originalCallToolResult }`，原始结果仍供页面重放。[Codex 初始化](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts#L242)、[资源 URI 识别](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts#L487)、[捕获与 item 输出](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts#L3735)。

MCP App 的 HTML 同样保存为 thread attachment，但还在脚本前注入资源声明的 CSP。应用 reference 必须与工具 item 的 server/tool 一致，防止工具输出借一个引用冒充另一个 server 的 app。[保存快照](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/server/src/mcpApps/McpAppSnapshot.ts)、[引用归属检查](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/packages/shared/src/toolOutput.ts#L195)。

### 4.2 宿主消息与交互回传

客户端与页面通过 `postMessage` 传输 JSON-RPC 2.0，网页和移动端复用同一个无传输绑定的 `makeMcpAppHost`。`ui/initialize` 完成后，宿主重放原始 `tool-input`、`tool-result`；host context 提供主题标准变量、尺寸、平台、locale、timeZone、toolInfo 等。[共享 host](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/packages/client-runtime/src/mcpApps/host.ts#L166)。

| 页面请求 | T3 的行为 |
| --- | --- |
| `tools/call` | 仅到该 app 所属 MCP server；检查工具允许 `app` visibility；工具未标 `readOnlyHint: true` 时先询问用户 |
| `resources/read` | 经原 thread 的 live provider session 读取所属 server 的资源 |
| `ui/message` | 仅接受 user role 的文本；每条先询问用户，获准后发到当前屏幕上的对话 |
| `ui/update-model-context` | 保存每个 app 的最新文本/structured JSON，下一轮携带；更新替换旧值，空值删除 |
| `ui/open-link` | 网页要求用户刚与 app 交互；移动端先询问 |
| `ui/request-display-mode` | 支持 inline/fullscreen；有审批或问题待处理时全屏退让 |
| `ui/download-file` | 先询问；网页保存文件，移动端打开分享面板 |
| `ui/resource-teardown` / `request-teardown` | 关闭前通知 app；inline app 可收起为普通行并提供重新打开入口 |

请求路由和 server 归属由 [McpAppRequests](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/server/src/mcpApps/McpAppRequests.ts) 检查；网页批准与发消息路径见 [McpAppFrame](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/web/src/components/chat/McpAppFrame.tsx#L313)，协议方法见 [host](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/packages/client-runtime/src/mcpApps/host.ts)。

模型上下文存进 SQLite `mcp_app_model_context`，按 `(thread_id, item_id)` 替换。下一轮由 `RunExecutionService` 读取，再由 Codex adapter 以 `kind: "untrusted"` 的 user-side context 传入，避免把 MCP server 的文本提升为 developer instructions。上下文支持同一对话及 fork；服务端验证 fork lineage，回滚或删除的 item 不再贡献上下文。[上下文存储](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/server/src/mcpApps/McpAppModelContext.ts)、[下一轮注入](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/server/src/orchestration-v2/RunExecutionService.ts#L1358)、[Codex untrusted context](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts#L761)。

### 4.3 隔离、存活和状态

MCP Apps iframe 也不授予 same-origin。它的 CSP 默认 `default-src 'none'`，仅按资源声明的 `connectDomains`、`resourceDomains`、`frameDomains`、`baseUriDomains` 放开对应访问；内联 JavaScript/CSS 允许执行，未声明的外部源受限。可声明 camera、microphone、geolocation、clipboard-write 等 browser permissions，具体是否可用仍受浏览器权限规则约束。[CSP 和权限构建](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/packages/shared/src/mcpApp.ts#L156)、[网页 sandbox/allow](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/web/src/components/chat/McpAppFrame.tsx#L528)。

捕获的 app 可在 provider 停止后继续显示；调用工具或读取资源要求**创建这个 app 的 thread 的 provider session 仍在运行**，服务端不会为页面自动启动模型 turn。`update-model-context` 是下一轮状态，因此不要求 live session。网页 fullscreen 保持同一个 iframe，保留页面当前状态；移动 fullscreen 是新的 view，app 未自行保存的状态会重新开始。HTML 快照持久化与任意页面运行状态持久化是两件事。[请求服务的 session 边界](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/server/src/mcpApps/McpAppRequests.ts)、[官方状态说明](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/docs/user/html-renders.md)。

应用页面离开原文档后，T3 停止桥接。源码明确说明该导航保护用来防止新页面冒充原 app，**不是机密数据隔离保证**，因为页面本来就能导航自己。移动端外层页面用真实 opaque iframe；Android 原生桥对各 frame 可见，所以 relay 用每个 view 的 secret 校验消息来源。[网页导航保护](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/web/src/components/chat/McpAppFrame.tsx#L253)、[移动 relay](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/mobile/src/features/threads/McpAppWebView.tsx#L50)。

## 5. 当前限制与未实测边界

| 限制 | 源码/官方依据 |
| --- | --- |
| `html` 工具输入最多 512,000 个字符；HTML render 内嵌每张本地图片最多 10 MiB，最终页面最多 25 MiB | [工具 schema](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/server/src/mcp/toolkits/html/tools.ts)、[存储服务](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/server/src/htmlRender/HtmlRender.ts) |
| HTML render 和 MCP App inline frame 高度约束 80–2,000 CSS px；HTML 默认回答栏参考宽度 728 px | [HTML 常量](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/packages/shared/src/htmlRender.ts)、[MCP App 常量](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/packages/shared/src/mcpApp.ts) |
| MCP App HTML 快照最多 5 MiB；每 app 模型上下文最多 16 KiB UTF-8；桥接消息最多 256 KiB、16 个同时请求 | [MCP App 常量](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/packages/shared/src/mcpApp.ts)、[model context](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/server/src/mcpApps/McpAppModelContext.ts)、[host limits](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/packages/client-runtime/src/mcpApps/host.ts#L13) |
| MCP Apps 目前 Codex-only；Claude SDK 缺资源读取，其他 provider 没有 host API，显示普通工具行 | [用户文档](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/docs/user/html-renders.md)、[#16236](https://github.com/pingdotgg/t3code/pull/16236) |
| MCP App 仅在原工具调用完成后挂载；未提供 agent-facing 驱动 app 的工具、picture-in-picture、sampling/createMessage、partial tool input、tool-cancelled | [已合并 PR 的 scope](https://github.com/pingdotgg/t3code/pull/16236)、[当前 host 方法](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/packages/client-runtime/src/mcpApps/host.ts) |
| 不能说功能默认关闭：beta 开关 [#16234](https://github.com/pingdotgg/t3code/pull/16234) 当前仍未合并 | PR 状态与观察的 main |

官方 MCP Apps PR 记录了真实 Codex session、网页及 iOS simulator 验证，并明确 Desktop 和真实 Android/device emulator 尚未验证。这是上游作者的验收边界；本次只读源码，没有独立复现页面质量、Windows Electron 行为、实际 provider 可用性、远程环境行为或恶意页面的完整隔离效果。[#16236 的验证记录](https://github.com/pingdotgg/t3code/pull/16236)。

## 6. 旧提案与许可

检索容易命中的几条社区内容不能当作当前官方功能：[#16720 Mods discussion](https://github.com/pingdotgg/t3code/discussions/16720) 是作者个人分支；[#15827 Claude plugin UI](https://github.com/pingdotgg/t3code/pull/15827) 仍 open、未合并；[#7220 Codex visualize marker](https://github.com/pingdotgg/t3code/pull/7220) 和 [#11460 t3-html fence](https://github.com/pingdotgg/t3code/pull/11460) 已关闭但未合并；[#8143 CopilotKit GenUI review agent](https://github.com/pingdotgg/t3code/pull/8143) 明确为不应合并的 demo-only draft。最新实现应以第 1 节已合并的 HTML renders/MCP Apps 为准。

T3 Code 仓库为 **MIT License**，版权为 T3 Tools Inc. 2026；允许使用、复制、修改、分发和销售，须保留版权及许可声明。该结论针对仓库代码，外部 MCP server、CDN 库、模型服务或生成内容不自动继承相同许可。[固定提交的 LICENSE](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/LICENSE)。

## 7. 可复用的实现判断（调研阶段）

本节记录实施前的源码分析与建议。后续鲸屿已按下节范围实现生成式视觉回复；这里的调研边界不代表当前仍未实施。

**源码推断：** 若目标是在编码代理回答里加入图表、交互解释或一次性小工具，最短的产品链是内置 HTML 工具、附件存储和隔离展示。模型只需会写 HTML，不必学习一个专有组件 schema；预览截图、主题变量和高度反馈把质量约束放进模型实际生成流程。

**源码推断：** 若目标是用户点 UI 后调用真实工具、改变远程数据或让代理据此继续工作，需要 MCP Apps 的 server 归属、工具可见性、用户批准、live session 路由和下一轮 untrusted context。只移植 iframe 或 HTML render 的主题桥，不能获得这些能力。上述两条判断分别依据 [HTML 工具链](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/server/src/mcp/toolkits/html/tools.ts) 与 [MCP App 请求链](https://github.com/pingdotgg/t3code/blob/a4c9494b0e3606775cc5fc929fc138399288bd43/apps/server/src/mcpApps/McpAppRequests.ts)。调研阶段尚未做 WhaleIsle 移植验证；后续实施只覆盖生成式视觉回复，不包含 MCP Apps 的交互回传能力。

**对 WhaleIsle 的参考判断：** 调研阶段的 [Surfaces 文档](../handbook/modules/surfaces.md) 描述了 HTML 交付卡片、聊天区 Browser 悬浮预览和右侧栏打开路径。T3 可借鉴的新增层是模型可调用的预览/发布契约，以及与会话时间线、主题和宽度融合的展示。优先研究这条链能直接服务图表、方案比较和交互解释；需要页面操作回传代理时，再明确 provider 的 MCP Apps 能力和会话归属。这是依据本地文档和 T3 源码提出的实施前建议，当时没有实测 WhaleIsle UI 或实施移植。

## 鲸屿实施范围（2026-10-08）

用户选择生成式视觉回复：模型 HTML、截图预览、会话内展示及设置开关。本次不加入 MCP Apps。当前源码已实现工具与隔离截图、会话附件读取、设置与独立视觉页投影；真实路径验证与 Standards/Spec 评审的最终状态由交付结果记录。默认关闭，执行与发布时读取活动设置，历史页面仍可读取。复用自带 Chromium、已有附件和工具日志，不引入独立浏览器或新会话格式。鲸屿这版页面为自包含 HTML，外部网络禁用，与 T3 支持公网远程资源的做法有差异。正文与通用控件沿用现有产品，不强制视觉化所有回答。

源码入口为 [工具与发布](../../vendor/deepseek-harness/packages/client/ui-visual-replies/src/tools.ts)、[桌面隔离截图](../../src/main/html-preview.js)、[会话附件读取](../../vendor/deepseek-harness/packages/api/session-controller/src/commands.ts)、[客户端服务与槽位注册](../../vendor/deepseek-harness/packages/client/ui-visual-replies/src/client/index.ts) 和 [视觉页时间线投影](../../vendor/deepseek-harness/packages/client/ui-visual-replies/src/client/visual-reply-node.ts)。这些入口说明已实施的范围，不替代真实 UI 验收。

交互预览在鲸屿桌面端提供：桌面宿主根据生成页面的 frame 身份拦截自行导航，并向主界面暴露只读隔离能力。普通浏览器和手机端保留视觉页的源码查看与 HTML 保存，不执行生成页面脚本；缺少桌面隔离能力时明确提示在桌面端打开。预览截图属于 `html_preview` 工具记录中的图片附件，不嵌入已发布的视觉页卡片；截图仍需运行中的鲸屿桌面渲染服务生成。截图在独立内存分区中生成，拒绝网络、导航、权限和下载；大页面写入空白文档，避免 Chromium 的导航 URL 长度上限。

页面展开、查看源码和返回会话复用同一个 iframe，保留当前控件状态；主题变量更新也不重载页面。模型指南约束响应式尺寸、主题颜色、控件标签和截图检查。预览返回有界控制台信息，并提醒 Chromium 不认识的 SVG 标签；附件永久失效与临时读取失败分别显示，只有可重试的读取失败提供重试操作。

**实际验证（2026-10-09）：** 隔离的真实 Electron 源码应用先以控制模型验证工具、附件和设置契约，再向商业 provider `cursor-plugin/auto` 提交自然语言工期问题。模型自行生成 HTML、调用预览并收到 PNG，检查窄宽度与浅色页面，发布可交互的工期估算器；模型发现首版 SVG 标签拼写错误后自行修正、再次预览并发布。没有人工修改其 HTML。首次试验曾因 QA 录制代理中断而出现传输失败，恢复代理并继续会话后完成，因此不把首次尝试记为通过。完成样本耗时约六分钟，不据此宣称模型质量或延迟已达到普遍标准。

真实页面的计算结果、交互控件、展开／源码／返回时的状态保留和深浅主题已检查；原生保存及无 preload 的普通网页路径均下载了与附件完全相同的 16,579 字节 HTML。普通网页没有执行生成页 iframe。关闭开关撤销新生成工具，冷启动可读取历史页面；取消截图在实际 Chromium 中销毁临时窗口且没有产生截图。完整画面检查覆盖正常窗口与 Files 右栏、实际 962 px 窄窗口、展开页和不透字的源码弹窗。窄窗口检查另修复了已有的横屏宽度状态同步问题；最终构建重启后，实际左栏按钮可收起、展开，962 px 窗口内 Files 与视觉页同时显示，无横向溢出，源码返回保留交互状态。所有交互由目标应用的后台接口完成，没有接管桌面焦点；原先记录的右栏焦点阻塞判断已被真实按钮路径排除。

最终 Standards 和 Spec 评审均无未解决发现，包含本轮缩窗修复和最终组合画面。

**验收边界：** 当前证据来自源码应用，尚未验收安装包或真实 Android 设备。普通网页的源码查看和 HTML 保存已实测；手机端采用相同限制，但不把网页验证当作原生设备验证。MCP Apps 的工具调用与代理交互回传不在用户选择的本次范围。任意 JavaScript 运行状态不跨应用重启保存，持久化的是会话 HTML 附件。
