# composer-family-width · 历史记录

自功能卡 [docs/features/composer-family-width.md](../features/composer-family-width.md) 迁入（2026-11-17，议题 #458）；以下为该卡原有的历史验证与变更记录，原样保留。

## last verified 记录

| Field | Value |
| --- | --- |
| **last verified** | 2026-10-18 — 宽度联动 e2e（composer-resize-dock）改用上游已迁移的 `snapshots/web/live-interactions/session.v3.jsonl`，并按当前脚手架使用认证地址与 `[data-composer-input]`，重新通过；删除只被它使用的旧 v2 fixture。此前 2026-09-10 — 同步 `dsh-v0.1.5-rc.1`：统计行随上游 StatsLine→StatsPills 重构，跟随契约（`dsh-composer-resized-width`）迁至 `StatsPills.module.css` 并入 FORK_FILE_MARKERS；宽度合同 8/8、fork marker 与 post-merge UI 测试全过，Desktop tests 1450 全绿。宽度联动 e2e（composer-resize-dock）未复跑：其回放 fixture（live-interactions session.jsonl）为 v2 形态，被 rc.1 的 v2→v3 迁移规则拒绝（首 step 前出现 surface 事件），需重录或手迁 v3 后再验。此前 2026-09-04 — official build 记录 246 个客户端产物；实机保存宽度 654px 时 Hero 行与输入卡均为 x=529、width=654，左右与中心偏差均 0px；宽度合同 8/8、fork marker 10/10、conversation skeleton 26/26 通过。 |
