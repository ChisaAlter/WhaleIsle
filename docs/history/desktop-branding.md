# desktop-branding · 历史记录

自功能卡 [docs/features/desktop-branding.md](../features/desktop-branding.md) 迁入（2026-11-17，议题 #458）；以下为该卡原有的历史验证与变更记录，原样保留。

## last verified 记录

| Field | Value |
| --- | --- |
| **last verified (window icon)** | 2026-10-01 — 属性顺序与通知定向测试 23/23；`36839675533` 安装版单变量 A/B/A 证实 `SHCNE_DELETE`（旧路径,NULL）首启为鲸鱼而 `SHCNE_RENAMEITEM` 为白色文档。正式候选 `36864734935`（`3af7fb6c`）安装版实测：迁移精确执行（原字节备份、DELETE 通知、源码侧不再生成 Electron.lnk），干净 Explorer 会话下任务栏为鲸鱼头像与 Whale Isle 名称；已收窄边界——会话内缓存于旧 `.lnk` 写入事件或会话起始即建立，被污染会话的首启仍显示旧读数（白文档+"Electron"），Explorer 重启/注销后永久恢复，产品不做会话内强制刷新。定向回归 42/42。历史证据见 [执行记录](../qa/results/2026-10-01-release-candidate/README.md)。 |
| **last verified** | 2026-09-25 — 已恢复定稿的中文主字标及原字号，仅应用其他入口使用英文主名；品牌与侧栏定向测试 25/25、官方 profile 完整构建、`check:governance` 与 `doc-sync` 通过。桌面应用已重启。 |
