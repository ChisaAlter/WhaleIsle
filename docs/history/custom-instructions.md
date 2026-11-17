# custom-instructions · 历史记录

自功能卡 [docs/features/custom-instructions.md](../features/custom-instructions.md) 迁入（2026-11-17，议题 #458）；以下为该卡原有的历史验证与变更记录，原样保留。

## last verified 记录

| Field | Value |
| --- | --- |
| **last verified** | 2026-09-16 — 首验通过：694 项 ui-conversation 测试 + host/client typecheck 通过；真实 Electron + 真实模型两轮请求，session 日志确认 system prompt 末尾含指令原文（`{{tone}}` 字面保留），模型两轮均以 `{{tone}} FOX` 结尾；settings.yaml 持久化确认 |
