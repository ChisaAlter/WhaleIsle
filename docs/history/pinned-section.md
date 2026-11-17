# pinned-section · 历史记录

自功能卡 [docs/features/pinned-section.md](../features/pinned-section.md) 迁入（2026-11-17，议题 #458）；以下为该卡原有的历史验证与变更记录，原样保留。

## last verified 记录

| Field | Value |
| --- | --- |
| **last verified** | 2026-11-01 — 隔离实例 + 假模型：「工作区」与「无工作目录」各置顶一个会话，两行同时出现在侧栏最上面的「已置顶」区（最近置顶在前，行内淡色标出所属工作区），原分组里不再重复；折叠/展开该区、取消置顶（回到原分组）、归档置顶会话（离开该区）、重启后保留，都按预期。vendor ui-workspace 13 个文件 560 项通过（含新增 7 项），`tsc --noEmit` 过，`harness-desktop-forks` 含真实树通过。 |
