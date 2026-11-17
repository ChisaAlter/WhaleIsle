# transparent-theme · 历史记录

自功能卡 [docs/features/transparent-theme.md](../features/transparent-theme.md) 迁入（2026-11-17，议题 #458）；以下为该卡原有的历史验证与变更记录，原样保留。

## last verified 记录

| Field | Value |
| --- | --- |
| **last verified** | 2026-09-17 — 终端 pane 改为独立 `terminalOpacity` 设置（40–100，默认 75 = `TERMINAL_PANE_MIN_SOLIDITY`），不再跟随玻璃滑杆；低于 75 时设置页提示 TUI 选中行可读性而不钳制。`ui-theme` 定向 spec（wallpaper / theme / settings-store / appearance-section）全绿。此前同日 — 终端 pane 加入壁纸混色（保底 75），Ghostty 画布改 `{alpha:true}` 并在半透明底下 `clearRect` 回 DOM 填充。此前 2026-09-01 — Appearance 规格 UTF-8 恢复后定向 31/31；vendor `test:gui` 431 文件 / 5274 pass / 1 skip。此前 2026-08-28 — 透明主题下 composer seat 不再铺实心 `bluish-950` 底板（`ConversationRoot.module.css` 壁纸渐变加 `:not([data-dsh-transparent])`）；契约测试 `composer-seat-wallpaper.client.spec.ts` 绿。此前 2026-08-27 合并后收口复核：vendor `test:gui` 在合并树复跑全绿（412 文件 / 5409 pass / 1 skip）；QA 记录见 [docs/qa/results/2026-08-27/transparent-theme.md](../qa/results/2026-08-27/transparent-theme.md) |；本次 alpha.4：透明主题及圆角/描边样式门禁通过。 |
