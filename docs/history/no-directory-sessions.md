# no-directory-sessions · 历史记录

自功能卡 [docs/features/no-directory-sessions.md](../features/no-directory-sessions.md) 迁入（2026-11-17，议题 #458）；以下为该卡原有的历史验证与变更记录，原样保留。

## last verified 记录

| Field | Value |
| --- | --- |
| **last verified** | 2026-09-27 — 修复「工作区加载中选无工作目录失效」：`connectScratchCwd` 在 Workspace baseline 未到时排队等待而非抛错，ready 但缺 cwd 时以可见 `createFailed` 失败，owner 销毁立即中止；`openNoDirectory` 与 `openWorkspace` 的提示语义对齐。真机复现另暴露宿主侧故障——残留的 `sessions\_no-cwd\preset-keep\session.v3.jsonl` 与 `zstd` 后端编码冲突使 `workspace` 插件整条不挂载、`workspace/follow` 返回 `gateway/service-unavailable`；该文件已隔离到 `quarantine/sessions/` 并确认 Host 恢复。新增 3 例回归（排队后成功 / ready 缺 cwd / 等待中销毁），定向 66 例与该卡四包门禁 1332 例通过。此前 2026-09-23 — 修复 #97：文档页通过 `shell:read-file` / `shell:list-dir` 读取 scratch 会话产物时同样获得 Host `no-workspace` 目录授权（`workspace-fs` 的生产 authority 与 preview 一致 `allowScratchCwd: true`）；新增回归验证 scratch 可读且其父目录仍被拒绝，`node --test src/main/workspace-fs.test.js` 10/10 通过。此前 2026-09-18 — no-directory and Workspace New Session share Host-authoritative reuse；25 boundary tests、272 workspace tests 与两条实浏览器首发送/重载流程通过。 |
