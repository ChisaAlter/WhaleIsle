# message-edit · 历史记录

自功能卡 [docs/features/message-edit.md](../features/message-edit.md) 迁入（2026-11-17，议题 #458）；以下为该卡原有的历史验证与变更记录，原样保留。

## last verified 记录

| Field | Value |
| --- | --- |
| **last verified** | 2026-09-19 — 同步 `dsh-v0.1.5-rc.1` 后保留同会话编辑语义并修复一处合并引入的静默失败：surface replace op 随上游改 `startSeq/endSeq`、busy guard 改 `inbox.nextTurn/nextStep`；rc.1 把系统提示词移上表面节点 0 且受保护（仅 system/message 单节点事件可改写），编辑走影回溯曾把节点 0 卷入替换范围导致 turn 静默中止 → 回溯遇 `system/message` 即停。message-edit.host.spec 6/6（含身份行容忍断言）、official build、Desktop tests 全过。此前 2026-09-07 — 同步 `dsh-v0.1.3-alpha.1` 并迁移 Session v2 嵌入式 assistant stream 后，当前会话重发语义保留；Host / Client build、含 ui-message-edit、ui-chat 与 ui-conversation 的重点 Client 101 文件 / 1279 项、Desktop tests 1425 passed / 2 skipped。此前 2026-09-06 的 keyless edit e2e 证据仍有效，本次未重跑。 |

## 正文历史段落

本次附加检查未全绿：Oxlint 类型感知检查对 `ui-message-edit` 的 `ctx.sessions` 报 `error typed`，独立 TypeScript 检查通过；`verify-type-equiv` 的阻断为未改动的 `docs/subsystems/llm-streaming.md` 中 `GenerateOptions.purpose` 与源码不一致。本次未运行全量覆盖率和 CI 安装包实机验收，未生成新安装包。
