# 聊天内 Open Intelligent UI

桌面聊天可以把 assistant 回复中的 `openui` 代码块直接渲染为交互页面。复用 `thesysdev/open-intelligent-ui` 的完整组件库、函数、样式和资源辅助服务，不替换 WhaleIsle 的聊天壳、模型配置、会话记录、工具或权限链路。`openui-lang` 是同一载体的语言别名；其他代码块保持原有源码展示。

## 使用与状态

让助手制作计算器、交互图表、地图、清单或其他适合在页面内操作的内容。桌面为模型提供完整 OpenUI Lang 指导，模型仍通过现有 provider 生成回复，不需要 Thesys API key。输入、筛选、公式和 `@Set` 在页面本地执行；`@ToAssistant` 和未指定动作的 Button 把用户操作排入**该页面所属会话**，并带上表单值与上下文。

页面随回复流式更新，结束生成和切换源码不会重建 iframe。交互状态按会话、消息、文本块和代码块位置保存在当前浏览器本地存储，历史查看、切换会话和重新加载会恢复；它不提供跨设备状态同步。原始程序保留在既有会话 Markdown 中。

对象字面量中的中文键需加引号，例如 `{"数量": $quantity, "备注": $note}`；上游 SDK 的裸标识符只支持 ASCII，未引号的中文键会变成 `?`。

## 装配与权限

- 原始快照与来源：`vendor/open-intelligent-ui/UPSTREAM.md`。
- `scripts/prepare-openui.mjs` 从固定依赖构建完整 viewer、内嵌地图 worker/字体和三个资源 handler，随产物保留来源记录及 SDK 许可正文；启动过期检查及打包入口都会准备这些产物。
- `src/openui-viewer/` 承载独立 React 19 runtime。原聊天仍用 React 18，不升级全局 React，也不引入上游 Next.js 聊天服务或模型代理。
- `ui-chat` 的 assistant Markdown 提供专用 fence renderer；普通 Markdown、推理和现有 `html_render` 路径保持原约定。只有桌面 Harness 进程通过 `DSHD_OPENUI_ENABLED=1` 宣告这一能力。
- viewer 使用无 same-origin 的 `allow-scripts` iframe，name 为 `whale-openui:<instanceId>`。主进程固定 frame identity 并阻止其导航离开 srcDoc；生成内容无 Node、preload、会话客户端或凭据。
- 父桥接核验精确 frame、协议版本和实例，只处理本地状态、尺寸、用户消息、HTTP(S) 外链、复制和三个固定资源操作。资源 IPC 仅供受信任的 harness 主 frame，不能由生成内容指定任意代理 URL。
- 三个资源 handler 使用 Electron `net.fetch`，与 Harness 的默认 session 共用 Chromium 网络和系统代理；保留上游参数校验、超时、缓存与 HTTP 状态，不改 Node 全局 fetch。
- 地图、图片、字体、YouTube 和 HtmlView 保留上游外部资源能力，因此页面可能向其资源服务发送请求。它不是离线执行环境；HtmlView 仍有自身独立 sandbox。

## 负责代码

桌面桥接在 `src/main/openui.js`、`src/main/ipc.js`、`src/preload/index.js` 与 `src/main/window.js`。客户端入口在 vendored `ui-chat/src/client/chat/OpenUiFrame.tsx`、`openui.ts`、`AssistantMarkdown.tsx`；公共 Markdown 的可选 fence 接口位于 `ui-primitives/src/markdown/`。

## 验证与交付边界（2026-10-16）

官方 native-system、host、client、web 及独立 viewer 构建通过；定向检查覆盖 Markdown fence 身份、流式状态、恢复与错误清除、原会话动作、IPC、导航和打包文件契约。Standards 与 Spec 独立评审发现的问题均已修复复核。

源码 Electron 中，经原 composer、provider、assistant 回复链路验证了流式程序、本地计算、源码切换、重载恢复、发送表单到原会话及生成期间排队；模型请求实际包含完整指导。上述交互验收使用本地 OpenAI-compatible SSE stub。地图矢量底图、拖动缩放、街道路线、标记状态、Wikipedia 图片搜索、SVG 与 HtmlView 交互均已实测；明暗主题与 1440×920 / 960×640 renderer 视口完整画面已检查。

追加实机检查对应产品提交 `be0c26f60b`：通过用户指定的本地 Magpie / `gpt/gpt-6.1-sol`，从原 composer 真实生成计算器。本地输入与加一保持一轮一步；点击确认才把数量 5 和中文备注送回所属 Session，真实第二轮回复正确确认。重新加载同一程序后，用目标 iframe 的真实鼠标及输入事件验证 4→5、平方 16→25；再次重载仍保留 5／25 和备注，没有新增模型调用。

已实际调整正常与最窄原生窗口，`getBounds()` 分别为 1441×920、961×640（DPI 舍入）。完整画面中的控件、结果及会话回执均可达：[正常窗口](../images/openui-native-normal.png)、[最窄窗口](../images/openui-native-narrow.png)。

完整 `prestart-ensure.mjs`、OpenUI 准备、官方客户端构建及直接源码启动已通过。尚未打包、安装或发布。
