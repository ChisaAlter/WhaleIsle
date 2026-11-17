# terminal-drawer · 历史记录

自功能卡 [docs/features/terminal-drawer.md](../features/terminal-drawer.md) 迁入（2026-11-17，议题 #458）；以下为该卡原有的历史验证与变更记录，原样保留。

## last verified 记录

| Field | Value |
| --- | --- |
| **last verified** | 2026-09-20 — Checkpoint B2 PTY 负路径覆盖：`registerPtyIpc` 以 sender 代际表替代“创建后即记账”，`shell:pty-create` 在 `await` 之后复检 `isCurrent`（sender 表身份 + 代际 + 未销毁）；renderer 在创建未完成时**销毁**或**跨文档导航**，迟到 PTY 立即 `kill` 并抛 `ERR_DSH_IPC_SENDER`，不再变孤儿（导航用例先红后绿：仅比 sender 表身份时漏检，补代际比较后转绿）。补测非 owner 对他人 PTY 的 write/resize/kill 一律 `unknown pty id`（后端零调用）、已销毁 sender 在任何 dispatch 前 `ERR_DSH_IPC_SENDER`、数据/退出事件只路由 owner、畸形尺寸（`NaN` / `Infinity` / `0` / 负数 / `99999.9`）在触达后端前归一化到 `1..1000`（非有限值回落 `120x30`）、kill 后重复 write/resize/`kill`/`killAll` 为有界 no-op。`pty.test.js` 24/24。终端语义保持不变：关抽屉 / 关 surface tab / 切会话都保留 PTY；只有 renderer 销毁/跨文档导航/崩溃收割。此前 2026-09-11 — `TerminalPane` 的 settle fit 仅在宿主有真实 used box 时通知 PTY，折叠/未布局 pane 不再误报默认网格；ui-user-terminal 45/45，完整 `test:gui` 505 文件 / 6860 通过 / 1 跳过，`npm run smoke:source` PTY 探针通过。此前 2026-09-01 — 已装 CI Setup SHA `F2C571D285B68E730FEFF5E8FB1362F48484761278D939D84E2BFD1298562856`：`packaged.ghostty.wasm` HTTP **200**；`terminal.drawer` / `terminal.new` / `terminal.surface` PASS；`case.terminal.addToChat` 终端 fence（`install-full-report.json`）。 |

## 正文历史段落

> 2026-09-22 补充（PTY 输出合并）：`src/main/pty.js` 在同一 burst 内合并 backend chunk 后再发 IPC，8 ms / 32 KiB 先到者 flush，空闲后的首个 chunk 立即发布；`pty.test.js` 31/31，含「10k × 1 KiB 突发发布条数 ≤ 1/5」「payload ≤32 KiB」「exit 前 flush 尾部输出」「单次输入无延迟」四条门禁；同一实现上 100k × 1 KiB 计数为 100000 → 3126 条（−96.9%）。背压未实现。
