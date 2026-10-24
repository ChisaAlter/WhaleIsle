# dshbot（已移除）

Whale Isle 已移除 Bots/dshbot 功能、「机器人（Bots）」设置开关及联系人、群聊、任务、例程入口。源码与分发包不再附带 `vendor/dshbot`，全量和 skip 恢复启动均不再装载插件、专用工具或 RPC。

旧版升级经 `src/main/legacy-dshbot-preset.js` 清理桌面受管 patch 块、overlay 文件及可确认属于桌面旧挂载的 junction。真实安装目录、pnpm 链接、旧目录内其他内容，以及 catalog、记忆、例程笔记、房间 preset、会话和附件继续保留；旧 Bots 工作不再执行。`DROPPED` 名单继续剥离旧 profile 中的装载行，并阻止市场或聊天安装自动恢复 dshbot。

通用插件受管 Session、Project、鲸鱼娘、IM 和 schedule 继续保留。详细数据边界见[移除说明](../../features/dshbot.md)，通用能力见[插件会话导航](../../features/plugin-session-navigation.md)。历史资料保留原样。
