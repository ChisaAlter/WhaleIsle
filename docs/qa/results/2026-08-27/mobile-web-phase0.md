# Mobile/Web Phase 0 QA — 真实 mode / workspace chooser / 重连 resync

Date: 2026-08-27

Branch: `cursor/mobile-web-phase0-ed5c`

Plan: [mobile/web Phase 0 执行计划](../../../superpowers/plans/2026-08-27-mobile-web-phase0-execution.md)（scope 来自 [差距分析](../../../superpowers/plans/2026-08-27-mobile-web-desktop-gap-analysis.md) Phase 0）

## Automated results

| Gate | Result | Evidence |
| --- | --- | --- |
| Baseline `node --test "mobile/web/**/*.test.js"` | PASS | 75 pass, 0 fail before implementation |
| Final `node --test "mobile/web/**/*.test.js"` | PASS | 86 pass, 0 fail（含新 `chisacode/controller.test.js` 7 条、重写的 `chisacode/parity.test.js` 10 条、`settings-hub` 权限 fallback 1 条） |
| `chisacode/controller.test.js`（fake client） | PASS | 连接三态映射、初始 connected 不触发 resync、掉线→重连恰好一次 resync、disposer 释放、resync 顺序与错误上抛、按 server/session 草稿存取、坏 storage 内存降级 |
| `chisacode/parity.test.js` | PASS | workspace registry 映射与空注册表可见错误、ready+enabled provider 过滤（含 modes/defaultModeId）、显式 `createAgent` 参数与可选 `modeId` 透传、缺选择拒绝、`agentModeState` 快照推导 |
| `src/main/chisacode-remote.test.js` | PASS | 12 pass, 0 fail, 2 skipped（环境依赖，与基线一致） |
| `node --check` app.js / parity.js / controller.js | PASS | 语法 / 模块解析干净 |

## Browser integration QA（fake DaemonClient，真实 SPA 栈）

Chrome headless 390×844（`/usr/local/bin/google-chrome` + puppeteer-core）。静态 server 按原样服务 `mobile/web`，只把 `chisacode/daemon-client.bundle.js` 替换为行为等价的 fake（记录所有 RPC 调用、可注入连接状态、`setAgentMode('full')` 固定拒绝）。真实 `app.js` / `session.js` / `parity.js` / `controller.js` 全部原样运行，配对经真实 `pairFromOfferUrl` / `reconnectSticky` 路径。**32/32 checks PASS**：

| 流程 | 检查点 | Result |
| --- | --- | --- |
| 配对 | 连接页加载、无效链接「链接无效」、同源 offer 配对进入 chat、`已配对 qa-server` | PASS |
| 真实 mode | access chip 显示 snapshot mode「规划」；权限 pane 列 3 个 daemon modes 且当前项标记；切「自动接受编辑」调用 `setAgentMode(agent-1, auto)` 并更新 chip；「完全访问」被 daemon 拒绝 → banner 显示 daemon 错误原文且 chip 回滚 | PASS |
| Workspace chooser | 新会话 sheet 列出 daemon registry（名称 · 项目 · 分支 · cwd）；provider 步只显示 ready+enabled；mode 步含「使用提供方默认」；`createAgent` 收到 `{provider:'dsh', cwd:'/repo/mobile', workspaceId:'ws-mobile', modeId:'plan'}` 与选择一致 | PASS |
| 草稿 | 切会话草稿互不串（A/B 各自恢复）；localStorage key `dsh-chisacode-drafts:qa-server` 按会话存储 | PASS |
| 连接生命周期 | disconnected → 离线条含 reason、发送按钮禁用、`requestSubmit` 被拒绝且**无** `sendAgentMessage`；connecting →「正在重新连接」；connected → 条隐藏、`fetchAgents` 重拉、当前会话 timeline 重拉、草稿仍在、toast「已重新连接并同步」 | PASS |
| Sticky | 无 hash 刷新 → 用已存 `deviceSecret` 重连回 chat | PASS |
| Console | 全程 0 个应用 console error（浏览器自动请求 `/favicon.ico` 404 为 harness 伪影，index.html 未声明 favicon，属既有状态非本轮回归） | PASS |

截图：[paired-chat](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-27/mobile-web-phase0-paired-chat.png) · [mode-rollback](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-27/mobile-web-phase0-mode-rollback.png) · [workspace-chooser](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-27/mobile-web-phase0-workspace-chooser.png) · [offline-banner](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-08-27/mobile-web-phase0-offline-banner.png)

Harness 复现：本地起静态 server（root `mobile/web`，仅 `chisacode/daemon-client.bundle.js` 路由到 fake 模块），fake 暴露 `window.__qa.emitStatus/calls`；粘贴 `http://127.0.0.1:3180/#offer=QAFAKE` 走全真配对栈。harness 为本地 QA 工具，未随产品资产提交。

## Manual / real-device matrix

| Surface / path | Result | Notes |
| --- | --- | --- |
| Live relay + Trent 桌面 offer-v2 配对 | BLOCKED | 云 worker 无 Trent 桌面与控制中继会话 |
| 真 daemon 多 workspace 新建（`fetchWorkspaces` 实数据） | BLOCKED | 依赖上一条 |
| 真 provider `setAgentMode` 切换与拒绝路径 | BLOCKED | 依赖真实 provider；fake 已覆盖协议语义 |
| 真实断网（关 Wi-Fi）→ 自动重连 → resync | BLOCKED | 依赖真实 relay；连接状态注入已覆盖 SPA 行为 |
| Android WebView 实机 | BLOCKED | 无物理设备/SDK；APK 构建时内置同一 SPA，自动继承本轮变更，需实机回归草稿 localStorage 与重连 |

BLOCKED 行是发布验收工作，浏览器 fake-daemon 结论不替代真机链路。

## Self-review / adversarial review

- PASS — kill-list：`mobile/web/chisacode/` 无 `callUnary` / `callShell` / `/__remote__/`；三个 P0 流程全走 DaemonClient RPC。
- PASS — `state.accessMode` 假状态已删除；mode 唯一来源是 agent snapshot（`agentModeState`），`mode_changed` 流事件写回；无 RPC 的场景（无会话 / 无 modes / 旧 transport）为诚实说明而非假开关。
- PASS — 新会话不再读“第一条 agent”；`discoverAgentDefaults` 已删除，chooser 空注册表 / 无 ready provider 均抛可见错误。
- FOUND/FIXED — `submitNewSession` 中 create 成功后 `openSession` 失败会被 chooser 的 create error handler 静默吞掉（`state.newSession` 已清空导致早退）；已拆分为「会话已创建，但载入失败」独立 banner。
- FOUND/FIXED — provider 无 modes 直接创建时 loading 文案误显示「正在读取提供方…」；补 `creating` 标记。
- ACCEPTED — `controller.js` 草稿 store 的三个 catch 只覆盖 localStorage 可用性（内存降级），不在正确性路径；连接 / resync / mode / create 错误全部上抛进 banner。
- OBSERVED — 设置 overlay 玻璃半透明时 chat banner 文字会透出（截图 mode-rollback 可见）；为既有玻璃设计（`--dsw-alias-glass-opacity`），非本轮引入，不改。
