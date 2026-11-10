# Mobile/Web Phase 3 QA — Phase 1 遗留 OBSERVED 修复 + 已保存电脑 chooser

Date: 2026-08-27

Branch: `cursor/mobile-web-phase3-a015`（基于 `main`，Phase 0–2 已合并）

Scope 来源：[差距分析](../../../superpowers/plans/2026-08-27-mobile-web-desktop-gap-analysis.md) Phase 3 + Phase 1/2 QA 报告的 OBSERVED 遗留。

## 本轮改动

1. **修复（OBSERVED，Phase 1 遗留）打开会话失败残留上一会话日志。** `openSession` 现在在拉取 timeline 之前清空上一会话的 rows / pendingApprovals；拉取失败时日志区渲染错误占位（「载入会话失败：<daemon 原文>」+ 重试按钮），banner 同步显示。重试成功后清 banner 并恢复时间线。
2. **修复（OBSERVED，Phase 1 遗留）流事件拉底 vs 阅读历史。** `renderLog` 默认锚点从无条件 `bottom` 改为 `auto`：渲染前测量视口，仅当已贴底（≤48px 松弛）才跟随最新消息，否则保持 scrollTop（`hold`）。判定逻辑抽成纯函数 `resolveLogAnchor`（`chisacode/timeline.js`），向上分页的 `preserve` 锚点语义不变。会话切换 / 重连 resync / 打开会话仍显式 `bottom`。
3. **Phase 3：多台已保存电脑 chooser（纯本地状态，零新增 RPC）。** 连接页新增「已保存的电脑」区：列出所有完整 sticky 记录（serverId · 中继 endpoint · 保存日期），最近保存的排最前；点选行走 `reconnectSticky(serverId)`，「忘记」清除该台的本机 secret。无 hash 自动重连仍指向最近一台（用户路径 2 不变），自动重连未定盘前行按钮禁用。排序/过滤逻辑抽成纯函数 `savedComputerRows`（`chisacode/session.js`）。

## Automated results

| Gate | Result | Evidence |
| --- | --- | --- |
| Baseline `node --test "mobile/web/**/*.test.js"` | PASS | 144 pass, 0 fail（合并树基线） |
| Final `node --test "mobile/web/**/*.test.js"` | PASS | **148 pass, 0 fail**（+4）：`timeline.test.js` +3（`resolveLogAnchor` 显式锚点透传、auto 贴底判定含阈值边界、空/不溢出视为贴底）、`session.test.js` +1（`savedComputerRows` 完整记录过滤 + 最近优先排序） |
| 全仓 `npm test` | PASS | **1224 pass / 0 fail / 5 skip**（无回归） |
| `node --check` 改动文件 | PASS | 语法干净 |

## Browser integration QA（fake DaemonClient，真实 SPA 栈）

Chrome headless 390×844（puppeteer-core）。复现：`npm i --no-save puppeteer-core && node tools/mobile-web-qa/run-qa.mjs`。**48/48 checks PASS**（41 Phase 0–2 基线 + 7 本轮新增）：

| 流程 | 检查点 | Result |
| --- | --- | --- |
| 流事件 | 阅读历史（scrollTop=300）时收到 timeline 流事件：行数 +1 且 scrollTop 不变（不拉底） | PASS |
| 流事件 | 贴底时收到流事件：继续贴底（gap ≤ 2px） | PASS |
| 打开会话失败 | `fetchAgentTimeline` 注入失败：日志区**只剩**错误占位（无上一会话的 assistant 行），占位含 daemon 原文，banner 同步可见 | PASS |
| 打开会话失败 | 「重试」恢复时间线并清 banner；随后正常切回原会话 | PASS |
| 已保存电脑 | 断开当前设备后连接页列出其余电脑（最近优先，显示中继 endpoint），断开清除当前台 secret | PASS |
| 已保存电脑 | 「忘记」移除该台（DOM 行 + localStorage secret 双重断言） | PASS |
| 已保存电脑 | 点选行 sticky 重连进入 chat（`已重连 <serverId>` + 会话目录重拉） | PASS |
| Console | 全程 0 应用 console error | PASS |

截图：[open-failure](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-27/mobile-web-phase3-open-failure.png) · [saved-computers](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-27/mobile-web-phase3-saved-computers.png)

## Manual / real-device matrix

| Surface / path | Result | Notes |
| --- | --- | --- |
| Live relay + Trent 桌面真 daemon（真实断连中打开会话、真实多台电脑 sticky 切换） | BLOCKED | 云 worker 无 Trent 桌面与控制中继会话 |
| Android WebView 实机（错误占位滚动、chooser 触控） | BLOCKED | 无物理设备/SDK；APK 内置同一 SPA 自动继承本轮变更 |

## Self-review / adversarial review

- PASS — kill-list：本轮新增代码零写 RPC、零 `callUnary`/`callShell`/`/__remote__/`；chooser 全部走既有 `reconnectSticky`/`clearSecret` 本地路径。
- PASS — 样式仅 `--dsw-alias-*` token；零 `innerHTML` 类 sink（占位与 chooser 全 createElement/textContent）。
- FOUND/FIXED — 重试成功后 banner 残留错误原文：重试按钮先 `showBanner('')` 再 `openSession`，失败时 catch 重新写 banner。
- FOUND/FIXED — 重连 resync 成功替换 events 时未清 `timelineError`：若上次 openSession 失败后自动重连成功，占位会压住新内容；resync 成功分支现在同步清 error/loading。
- ACCEPTED — 自动重连仍指向最近一台（用户路径 2 不变）；chooser 是连接页新增的手动入口，不改变已有 sticky 语义。「忘记」仅清本机 secret，与桌面撤销设备是两回事（行文案不涉及桌面状态）。
- DEFERRED（Phase 3 剩余项，见差距分析）— `subscribeCheckoutDiff` 实时 diff / Git 状态订阅（Phase 2 已 ACCEPTED one-shot+刷新，订阅生命周期需真 daemon 验证）；ChisaCode rewind 编辑/重发、分支 rename/stash/merge、usage 只读摘要、MCP/技能写操作（均需产品确认 + 安全 UX，不做静默扩围）。
