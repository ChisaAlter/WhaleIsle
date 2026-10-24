# dshbot（已移除）

桌面产品已移除 Bots/dshbot 功能及「机器人（Bots）」设置开关，不再提供联系人、群聊、任务、例程及其专用工具、RPC 和界面。源码和安装包不再附带 `vendor/dshbot`，正常启动与「跳过用户插件」恢复启动均不再挂载 dshbot。旧配置中的 `dshbotEnabled`、`dshbotPreset` 不再生效。

升级只清理旧桌面受管装载残留：`cordis.patch.yml` 中的 dshbot 受管块、桌面 overlay 文件，以及明确指向旧 `desktop-plugins/dshbot` 或当前安装 `resources/vendor/dshbot` 的 profile junction。清理不遍历或删除链接目标，不删除真实安装目录、pnpm 链接或 `desktop-plugins/dshbot` 内的其他内容。`dshbot` 仍列入 `DROPPED`，剥离旧 profile manifest 中的同名装载行并阻止市场或聊天安装恢复该功能。

用户数据保留，包括 catalog、记忆、例程笔记、房间 preset、会话日志与附件；保留这些文件不表示桌面继续执行旧 Bots 任务或例程。移除不改写旧会话的身份、标题和展示记录，也不把旧插件会话复用为普通新草稿。

通用[插件受管 Session 展示与导航](plugin-session-navigation.md)、[Project](projects.md)、[鲸鱼娘助理](whale-assistant.md)、[IM 消息渠道](remote-settings.md)及既有 schedule 能力继续保留。

迁移实现入口为 `src/main/legacy-dshbot-preset.js` 与 `src/main/harness-controller.js`。当前安装包验收步骤见 [TC-EXT-007](../qa/tc-ext-007-dshbot-install-smoke.md)；历史决策、研究、规格和 QA 执行结果保留原样，不代表移除后的验证结果。
