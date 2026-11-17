# account-settings-entry · 历史记录

自功能卡 [docs/features/account-settings-entry.md](../features/account-settings-entry.md) 迁入（2026-11-17，议题 #458）；以下为该卡原有的历史验证与变更记录，原样保留。

## last verified 记录

| Field | Value |
| --- | --- |
| **last verified** | 2026-09-23 — 账户菜单「远程」打开原配对弹窗，Esc 关闭后焦点回到账号按钮；源码应用 CDP 确认侧栏旧入口为 0。相关测试 76/76、两个插件类型检查、治理 6/6、文档 8/8 通过；完整官方构建被另一项未跟踪的 `titlebar-fit.e2e.ts` 导入 Host 脚手架挡住，客户端资源与 Web 已单独构建。此前 2026-09-23 — 隐藏深链触发点恢复 settings-jump 打开桌宠分区，设置壳测试 31/31 通过。再前 2026-09-23 — 设置壳 31/31、账户菜单 40/40、TypeScript 检查、官方构建、`doc-sync` 8/8；源码应用重启后 CDP 确认账户按钮可见、独立设置按钮为 0、空状态行 `display: none`。 |
