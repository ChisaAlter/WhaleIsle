# launcher-components · 历史记录

自功能卡 [docs/features/launcher-components.md](../features/launcher-components.md) 迁入（2026-11-17，议题 #458）；以下为该卡原有的历史验证与变更记录，原样保留。

## last verified 记录

| Field | Value |
| --- | --- |
| **last verified** | 2026-09-28 — 跨平台拒绝 Windows 绝对/驱动器相对入口，registry 定向回归通过；2026-09-25 — 组件平台已落地：`src/launcher/components/`（catalog 扫描 + 安装/启停/更新/回滚/卸载 + pid 存活探测 + orphan 接管 + `before-quit` 回收），`main/ipc-components.js` 经共享表注册，`launcher-components.js` 渲染行。持久化在 `userData/components/registry.json` 原子写；样例 catalog 源为 `<root>/components/samples/`（目录不存在时列表为空）。**不随包附带演示组件**——E2E 夹具移到 `tests/fixtures/components/launcher-notes/`（真 payload 全生命周期测试 v1→v2→回滚仍在跑），`components/samples/**/*` 从两个 `files` 列表剔除。31/31 定向绿。 |
