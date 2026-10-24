# 附录：设置 section id

桌面与验收常用的设置分区标识。实际注册以 harness / 预置插件的 `settings.section` 为准；跳转经 `shell:open-settings` / `settings-jump.js`。设置 shell 按 id 选择互异的 16px `currentColor` 线框图标，未知 id 回退齿轮。

| id | 用途 | 导航图标 | 备注 |
| --- | --- | --- | --- |
| `general` | 通用设置 | `IconSettingsOutline16` | harness 设置 shell |
| `interface` | 界面设置 | `IconPanelLeftOutline16` | harness 设置 shell |
| `conversation` | 对话：权限、发送、工作详情、链接、下一句提示、可视化回复、自定义指令 | `IconBrowseOutline16` | `settings.conversation.item`，各功能包注册行 |
| `features` | 内置功能：鲸鱼娘助理、Project、远程工作区开关 | `IconPersonalizationOutline16` | `settings.features.item`；仅桌面 |
| `appearance` | 外观、主题、壁纸行 | `IconLightOutline16` | `ui-theme` |
| `models` | 提供方与模型 | `IconDataOutline16` | QA §2 |
| `agent-presets` | Agent 预设 | `IconAgentPresetOutline16` | 组合模型与能力 |
| `plugins` | 已装插件管理 | `IconPersonalizationOutline16` | 与市场分区配合 |
| `skills` | 技能 | `IconSkillOutline16` | QA `TC-EXT-006` |
| `mcp` | MCP 服务器 | `IconServerOutline16` | QA `TC-EXT-006` |
| `market` | 插件市场 | `IconBrowseOutline16` | 桌面自有 fork；无独立 BrowserWindow |
| `remote` | 手机远程 | `IconDeviceOutline16` | 网关 + 预置 dsh-im 渠道 |
| `remote-workspace` | 远程工作区 | 未登记专用图标时回退齿轮 | 内置 `dsh-remote`；与手机配对的 `remote` 分区分开 |
| `about` | 关于、更新、打开运行目录 | `IconInfoOutline16` | 运行目录是桌面 `dsh-home` |
| `usage-stats` | 用量与费用 | `IconChartOutline16` | 预置改版；跨会话 Token，无余额；顶部 `settings.usage.item` 放会话费用与官方峰谷时开关 |

导航按组显示（`ui-settings-general` `settings-placement.ts`）：账户（`account`、`usage-stats`）、通用（`general`、`appearance`、`interface`、`conversation`、`archived-sessions`）、智能体（`models`、`agent-presets`、`skills`、`mcp`、`plugins`、`market`）、功能（`features`、`pet`、`remote`、`remote-workspace`，以及未登记的插件分区）、其他（`about`）。

托盘「插件市场」必须落到设置内 `market`，见 `TC-EXT-002`、`TC-DESK-002`。

深链实现：`src/main/settings-jump.js`。变更 id 时同步本表、市场 Feature Card 与 QA 文案。
