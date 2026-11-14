# Mobile/Web Phase 2 QA — P1 远程工作环（Files / Diff / MCP·Skills 只读）

Date: 2026-08-27

Branch: `cursor/mobile-web-phase2-ed5c`（基于 `cursor/mobile-web-phase1-ed5c`）

Plan: [mobile/web Phase 2 执行计划](../../../superpowers/plans/2026-08-27-mobile-web-phase2-execution.md)（scope 来自 [差距分析](../../../superpowers/plans/2026-08-27-mobile-web-desktop-gap-analysis.md) Phase 2）

## Automated results

| Gate | Result | Evidence |
| --- | --- | --- |
| Baseline `node --test "mobile/web/**/*.test.js"` | PASS | 121 pass, 0 fail（Phase 1 终态） |
| Final `node --test "mobile/web/**/*.test.js"` | PASS | **144 pass, 0 fail**（+23）。新增 `chisacode/files.test.js`（11：listDirectoryView 目录优先排序 + path 规范化、breadcrumb/parentPath、searchWorkspacePaths 参数映射 + legacy `directories` fallback + payload error 上抛 + 空 query 本地拒绝、previewSizeGate、classifyFilePreview 四态 + 200KB 截断、fileSizeLabel）、`chisacode/diff.test.js`（7：diffViewState non-git/error/empty/files 判别按 error code、hunk header、diffFileView 丢 tokens 保行级 type、badge 新增/已删除/二进制/过大、异常形状不崩）、`chisacode/extensions.test.js`（5：状态/来源 label、MCP rows 映射含 overrides 计数与 server errors、skills rows 映射、payload 级 errors 透传、client 抛错上抛）；`ui/settings-hub.test.js` +1（`remoteReadOnly` 翻转 MCP/技能/文件 desc）；`parity.test.js` −1（`listMobileDirectory` 被 `files.js` 取代后删除） |
| 全仓 `npm test` | PASS | **1201 pass / 0 fail / 5 skip**（本环境依赖完整；无回归） |
| `node --check` 改动文件 | PASS | 语法干净 |

## Browser integration QA（fake DaemonClient，真实 SPA 栈）

Chrome headless 390×844（puppeteer-core）。harness：`tools/mobile-web-qa/`（真实 `app.js` + 全部 `chisacode/*` 模块原样运行；fake daemon 本轮新增内存文件树（嵌套目录 + text/image/binary/2MB+ 超限文件 + 40 个 vendor 文件用于滚动恢复）、`getDirectorySuggestions`、per-scope 可注入的 `getCheckoutDiff`（uncommitted/base 文件集、非 git、空、错误）、`listAgentMcpServers`/`listAgentSkills` 夹具）。复现：`npm i --no-save puppeteer-core && node tools/mobile-web-qa/run-qa.mjs`。**41/41 checks PASS**（19 Phase 0/1 基线 + 22 Phase 2 新增）：

| 流程 | 检查点 | Result |
| --- | --- | --- |
| Diff | 未提交 scope 只读文件列表：`+a −d` 计数、二进制/文件过大 badge、只读提示、**无 Stage/保存按钮** | PASS |
| Diff | 文件行点击展开 hunk：`@@ -a,b +c,d @@` header + add/remove 行着色（纯文本，不伪造语法高亮） | PASS |
| Diff | 切换「对比主干」调 `getCheckoutDiff(mode:'base')` 并换文件集 | PASS |
| Diff | 空 diff 明确状态（不是错误） | PASS |
| Diff | 非 Git 仓库按 `error.code==='NOT_GIT_REPO'` 判别（非字符串匹配） | PASS |
| Diff | 加载失败显示 daemon 原文并可重试 | PASS |
| 文件 | 根目录列表目录在前、文件带大小 label | PASS |
| 文件 | **目录点击=导航**（进入子目录，不插入 mention，composer 不变） | PASS |
| 文件 | breadcrumb 返回上层 + 该层滚动位置恢复（40 行 vendor 目录往返） | PASS |
| 文件 | 文本文件只读预览（`<pre>` 渲染，无保存按钮） | PASS |
| 文件 | 「插入 @路径 到输入框」是显式按钮动作并回到输入框 | PASS |
| 文件 | 图片预览走 blob URL（`img[src^=blob:]`） | PASS |
| 文件 | 二进制文件明确状态（提示电脑端打开） | PASS |
| 文件 | >2MB 文件不发 `readFile`（QA 断言零调用）且显示真实大小 + 上限说明 | PASS |
| 文件 | 预览失败显示 daemon 原文并可重试 | PASS |
| 文件 | 搜索走 `getDirectorySuggestions`（QA 断言 RPC 参数含 `matchMode:'fuzzy'`）；UI 明示「不是内容全文搜索」 | PASS |
| 文件 | 搜索结果行「@」直接插入路径 | PASS |
| 文件 | 搜索结果目录点击 → 定位进浏览器（清空 query） | PASS |
| MCP | hub desc 标注「只读清单 · 电脑端管理」；pane 列出 transport/来源、启用状态（含「已全局停用」）、「N 处按会话覆盖」、server 级错误行 | PASS |
| 技能 | 只读清单显示来源 scope（项目 / Claude 主目录）与状态；payload 级 errors 提示条可见 | PASS |
| Kill-list | 工作区两个 tab DOM 均无 保存/写入/Stage/Unstage/Discard/暂存/放弃 按钮 | PASS |
| Kill-list | 全程零写 RPC：`upsertAgentMcpServer`/`patchAgentMcpServerPolicy`/`deleteAgentMcpServer`/`installAgentSkills`/`uninstallAgentSkill`/`patchAgentSkillPolicy`/`writeFile`/`saveFile` 调用数 = 0（QA 记录全部 client 调用后断言） | PASS |
| Console | 全程 0 应用 console error | PASS |

截图：[diff](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-27/mobile-web-phase2-diff.png) · [files](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-27/mobile-web-phase2-files.png) · [preview](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-27/mobile-web-phase2-preview.png) · [search](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-27/mobile-web-phase2-search.png) · [mcp](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-27/mobile-web-phase2-mcp.png) · [skills](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-27/mobile-web-phase2-skills.png)

## Manual / real-device matrix

| Surface / path | Result | Notes |
| --- | --- | --- |
| Live relay + Trent 桌面真 daemon（真实仓库 listDirectory/readFile/getCheckoutDiff/MCP/Skills 走查） | BLOCKED | 云 worker 无 Trent 桌面与控制中继会话；fake-daemon 已按 vendored 协议 schema（`FileExplorerEntrySchema`、`ParsedDiffFile`、`extensions.ts`）逐字段对齐 |
| 真 daemon 大文件（>2MB 预拦截、daemon 侧 64MB 上限）与非 UTF-8 文本 | BLOCKED | 依赖上一条 |
| Android WebView 实机（blob URL 图片预览、diff 长列表滚动） | BLOCKED | 无物理设备/SDK；APK 内置同一 SPA 自动继承本轮变更 |

BLOCKED 行是发布验收工作，浏览器 fake-daemon 结论不替代真机链路。

## Self-review / adversarial review

- PASS — kill-list：`mobile/web/chisacode/{files,diff,extensions}.js` 与 app.js 新增代码无 `writeFile`/`saveFile`/stage/unstage/discard/内容搜索调用点；无 `callUnary`/`callShell`/`/__remote__/`；浏览器 QA 以 DOM 断言 + 全量 RPC 调用记录双重验证。
- PASS — 目录 vs 文件点击语义：目录行点击只导航（QA 断言 composer 不变），插入 mention 是行尾「@」与预览页按钮两个显式动作。
- PASS — 搜索诚实标注：placeholder 与说明行都写明按路径匹配、不是内容全文搜索；RPC 参数断言 `getDirectorySuggestions`。
- PASS — 非 git 判别用 `CheckoutError.code`，不匹配 message 字符串。
- FOUND/FIXED — `loadFilesPath`/`openFilePreview` 无条件把当前 `#options` 滚动位置记到 `scrollTops[pane.path]`：在预览或搜索视图打开另一个文件/目录时会用预览/搜索区的滚动值污染该层列表的恢复位置。加守卫：仅当列表本身在屏（非预览且非搜索）时才记录。
- FOUND/FIXED — `openSession` 在 `updateChisaCodeAgent`（可能改写 `state.cwd`）之后才取 `previousCwd`，导致 cwd 变化时 `resetWorkPanes()` 永不触发、文件/diff 面板残留上一工作区内容。改为先取后比。
- FOUND/FIXED（harness）— Git 操作的「完成」toast 覆盖 `#settings-back` 坐标，Puppeteer 坐标点击被 toast 吞掉导致 MCP 检查间歇超时；QA 改用 DOM `.click()`（与既有 `#menu` 处理一致）。
- ACCEPTED — Diff 用 `getCheckoutDiff` one-shot + 显式「刷新」，不接 `subscribeCheckoutDiff` 实时流（设置 overlay 内按需查看面；实时订阅归 Phase 3，见执行计划「Diff 订阅决策」）。
- ACCEPTED — diff `tokens` 语法高亮 style 是桌面 highlighter 类名，手机端无对应样式表：只渲染 `content` 纯文本 + add/remove/context 行级着色，不伪造语法高亮。
- OBSERVED — Phase 1 遗留的两个 OBSERVED（openSession 失败残留上一会话日志、流事件拉底 vs 阅读历史）未在本轮 scope；连同 `subscribeCheckoutDiff` 与 MCP/Skills 写操作一起归 Phase 3。
