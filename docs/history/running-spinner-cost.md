# running-spinner-cost · 历史记录

自功能卡 [docs/features/running-spinner-cost.md](../features/running-spinner-cost.md) 迁入（2026-11-17，议题 #458）；以下为该卡原有的历史验证与变更记录，原样保留。

## last verified 记录

| Field | Value |
| --- | --- |
| **last verified** | 2026-11-01 — 隔离实例 + 假模型，对话在线增长到约 250 行、约 3 万个 DOM 节点，一轮运行中且左栏有一个转圈。改前（248 行/3.1 万节点）页面每秒帧数 40，事件循环延迟（8ms 定时器实际晚多少）中位数 39.0ms、p95 52.5ms；改后真实构建（252 行/2.9 万节点）155 帧，中位数 4.3ms、p95 13.0ms。转圈在 7 个动画时刻（含非 90° 倍数）与旧实现逐像素比较，每通道最大差 ≤ 24/255（只在弧线边缘的抗锯齿）。vendor ui-primitives 全部 1501 项通过；`harness-desktop-forks` 含真实树通过。 |
