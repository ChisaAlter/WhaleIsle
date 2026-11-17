# marketplace-settings · 历史记录

自功能卡 [docs/features/marketplace-settings.md](../features/marketplace-settings.md) 迁入（2026-11-17，议题 #458）；以下为该卡原有的历史验证与变更记录，原样保留。

## last verified 记录

| Field | Value |
| --- | --- |
| **last verified** | 2026-09-30 — Windows 普通用户的安装快照保留目录 junction，不再经 `fs.cp` 转成需额外权限的目录 symlink；pnpm 实体文件和包链接失败恢复、成功清理时外部目录保护、快照目标被未知普通目录占据时拒绝覆盖均通过。`marketplace-install.test.js` + `plugins.test.js` 共 85 项通过，无跳过；未运行真实联网 pnpm 或活跃 profile。2026-09-28 — A6：catalog / 会话内 / launcher 导入安装在 CLI 或验证失败后离线恢复安装前元数据和物理依赖，不再 remove 旧安装；快照失败不进 CLI，恢复失败保留备份。原审计覆盖安装探针复跑后 manifest / 包 manifest / 入口 SHA-256 一致。2026-09-14 — 全部安装/更新通道新增 manifest 身份校验（非空 `name` + `version`），堵 versionless 包打爆请求 inventory 的残余路径。2026-09-08 — 迁移 dshmarket 1.45.0 的收藏、排序 / 时间过滤、截图 / README / manifest 声明详情、安装卸载确认、批量更新和持久脱敏操作记录，保留桌面 IPC / profile / HarnessController / DSHD 视觉。来源一致性与模糊 lock commit 判定 fail closed，回滚失败停止批次。桌面 / IPC / preload 141 项、市场 52 项、完整 GUI 5483 项（1 跳过）、市场与滚动条聚焦 73 项、client typecheck、官方 Web 构建及 Electron 源码 smoke 通过。全仓 Web 回放在聊天滚动、设置、PTC 等场景出现失败和长时间超时后主动中止，未通过，未与基线对照确认归因；国际化全仓剩余 25 条其他模块违规，市场无违规。 |
