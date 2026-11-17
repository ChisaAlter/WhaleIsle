# desktop-live2d-pet · 历史记录

自功能卡 [docs/features/desktop-live2d-pet.md](../features/desktop-live2d-pet.md) 迁入（2026-11-17，议题 #458）；以下为该卡原有的历史验证与变更记录，原样保留。

## last verified 记录

| Field | Value |
| --- | --- |
| **last verified** | 2026-10-21 — 用量口径改为 Magpie 定义（token = 未缓存 input + output，缓存读写单列），存在 `usage.jsonl` 时优先聚合 `agent==='dsh'`，日志回退跳过 fork 继承前缀，`growth` 迁移到 `accountingVersion: 2`（保留 points，重置计数与账本）；`pet-growth.test.js` 38/38、相关既有套件全绿。此前 2026-10-02 — 投喂日志收缩复现旧版失败，新账本删除/恢复/重启与迁移定向验证通过；同 SHA CI 和新安装包验收待本轮候选完成。既有视觉行为本次未改动。 |
