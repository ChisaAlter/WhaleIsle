# dsh-home · 历史记录

自功能卡 [docs/features/dsh-home.md](../features/dsh-home.md) 迁入（2026-11-17，议题 #458）；以下为该卡原有的历史验证与变更记录，原样保留。

## last verified 记录

| Field | Value |
| --- | --- |
| **last verified** | 2026-08-25 — `dsh web` / `dsh plugin` 子进程环境的公共部分（DSH_HOME 覆盖、Electron 变量清理、DEEPSEEK_* 门禁、PATH extras）合并为单实现 `src/shared/child-spawn-env.js`；行为不变，`spawnEnv` / `pluginEnv` 只保留各自的 PATH 顺序与附加项 |
