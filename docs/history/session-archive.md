# session-archive · 历史记录

自功能卡 [docs/features/session-archive.md](../features/session-archive.md) 迁入（2026-11-17，议题 #458）；以下为该卡原有的历史验证与变更记录，原样保留。

## last verified 记录

| Field | Value |
| --- | --- |
| **last verified (archive filters)** | 2026-10-06 — 恢复列表与搜索的三态归档筛选；5 个现有定向测试文件 297/297 通过，筛选动画重置调整后仅重跑浏览器文件 110/110。Windows 源码桌面实际切换三态、对照相同关键字搜索、从搜索菜单取消归档；归档项点击不恢复、不打开，取消归档不跳转。安装版尚未替换验证。 |
| **last verified** | 2026-09-23 — 保留新版 Harness 后恢复侧栏独立归档分区、默认折叠及界面设置显示开关；ui-workspace 包内 367/367 通过，源码桌面待重启验收。此前 2026-09-17 — 核心契约套件 4729 项全绿（workspace 55、session-controller 删除路径 5）；alpha.1 合并吞掉的未知 unarchive id 拒绝已恢复，幂等用例改以已知未归档 id 断言（见 2026-09-17 漂移裁定记录）。尚未替换安装版验证。 |
