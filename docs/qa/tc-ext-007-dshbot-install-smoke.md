# TC-EXT-007 · Bots 移除与升级数据保留 · 执行手册

本用例检查 CI Windows 安装包中的 Bots/dshbot 移除、旧桌面受管挂载清理和用户数据保留。当前合同见[移除说明](../features/dshbot.md)，用例入口见[生产验收用例库](production-acceptance-test-cases.md#tc-ext-007--bots-移除与升级数据保留--p0)。以下是待执行步骤，不是验证通过记录。旧版安装、建群和卸载的执行结果保留在原 [2026-08-26 报告](results/2026-08-26/tc-ext-007-dshbot.md)，不用于证明当前产品。

## 前置

- 使用 Windows x64 实机或 VM，记录 CI run、SHA、安装包文件名和校验和。
- 用隔离 userData/DSH_HOME 验证升级，备份旧配置、profile 和 Bots 数据。不要修改正在使用的用户目录。
- 旧版样本包含 `dshbotEnabled: true`、`dshbotPreset: true`、旧受管 patch 块、桌面 overlay 和桌面 junction；分别准备指向旧 `desktop-plugins/dshbot` 及安装资源 `vendor/dshbot` 的链接。
- 记录 catalog、记忆、例程笔记、房间 preset、会话日志和附件的文件清单与摘要；准备真实安装目录和 pnpm 链接作为保留对照。

## 全新安装

1. 安装并启动该 CI 安装包。
2. 确认界面设置没有「机器人（Bots）」开关，侧栏没有 Bots 页签，也没有联系人、群聊、任务或例程入口。
3. 检查安装资源不含 `vendor/dshbot`，运行时启动参数不含 dshbot overlay，插件排查不把 dshbot 缺席归为内置组件损坏。
4. 确认市场没有 dshbot 推荐或可安装条目；安装通道继续拒绝该家族，不能借旧 profile 装载行恢复功能。

## 旧版升级

1. 将同一安装包升级到隔离的旧版环境，保留原 userData。
2. 启动后确认旧 `dshbotEnabled`、`dshbotPreset` 不会恢复开关或功能，旧 Bots 任务与例程不再运行。
3. 检查只清理 dshbot 桌面受管 patch 块、overlay 文件，以及已确认指向桌面旧副本或当前安装 `vendor/dshbot` 的 profile junction；profile manifest 的同名装载行继续由 `DROPPED` 剥离。其他用户 patch 保留。
4. 对照升级前清单与摘要：catalog、记忆、例程笔记、房间 preset、会话日志和附件不变；真实安装目录、pnpm 链接及旧目录内其他内容不被迁移清理删除。移除 junction 不得遍历或删除目标内容。
5. 再次正常启动和「跳过用户插件」恢复启动，确认清理可重复、dshbot 不再挂载且数据仍保留。

## 保留能力

确认普通会话和插件受管 Session 的导航、标题、权限及新会话复用边界仍正常；Project、鲸鱼娘助理、IM 和既有 schedule 按各自设置继续工作。旧版插件会话不会被改成普通空白草稿。相关路径按实际执行记录，不以入口出现替代完整业务验证。

## 记录

报告逐项记录实际结果、CI 身份、安装资源和启动参数检查、迁移前后文件摘要与使用的隔离目录。未执行的子路径明确标记未执行；源码检查、旧版报告或仅看不到 Bots 页签，都不能替代安装包迁移与数据保留验证。
