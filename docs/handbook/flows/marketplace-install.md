# 流程：市场安装插件

## 步骤

1. 打开「设置 → 市场」，或通过托盘 / 菜单的「插件市场」跳转到该设置分区。Harness 未就绪时等待主界面完成启动后跳转；无独立市场窗口。
2. 在桌面商店的「发现」页浏览、搜索、分类过滤、排序或刷新目录；「收藏」页恢复原有收藏和筛选，详情弹窗可查看来源、截图、README 与依赖声明。
3. 按目录 id 安装插件并确认来源和重启影响；需要 `allowBuilds` 时在原内联授权 UI 确认后重试。进度与失败反馈在界面显示，操作记录保存最近 30 项及脱敏日志。
4. 在商店的「已安装」页检查更新、逐项或批量更新、卸载插件。桌面安装引擎继续处理事务、回滚和 Harness 重启；离开设置不取消后台操作，原有收藏和操作历史继续使用。

## 官方「插件 → 发现」

官方发现页同时保留，桌面默认开启官方自定义插件市场，并提供 realguan 社区索引；恢复设置商店不改变其索引配置和停用行为。

1. 打开侧栏「插件 → 发现」浏览、搜索 bundle；「索引源」中可添加、替换或删除源。用户源配置保存在当前 web profile，清空后重启仍为空；已有自定义源保持不变。
2. 通过官方发现页查看并安装 bundle。官方 `pluginMarket` / `pluginManager` 负责规格检查、构建授权、安装反馈和运行时重载。
3. 在「插件 → 已安装」查看、配置、停用或卸载插件。停用官方自定义插件市场后，其「发现」页签消失；保存的源仍在，再次启用可恢复。普通重启不重新启用用户已关闭的 bundle；桌面「设置 → 市场」仍可使用。

会话内 `install_dsh_plugin`、launcher 导入和桌面商店共用桌面安装引擎及原有事务、授权、回滚与重启行为；这些行为不等同于官方发现页的安装流程。桌面向 `runCli` 注入内置 Node / pnpm，不要求系统另装 pnpm。默认源、配置层优先级和两个引擎的实现见[插件市场模块](../modules/marketplace.md)。

## 入口

- 导航：`src/main/window.js`、`src/main/marketplace-jump.js`
- 桌面商店：`src/main/dsh-market-desktop.js`、`vendor/deepseek-harness/packages/client/ui-settings-market`
- 官方 UI：`vendor/deepseek-harness/packages/client/ui-plugin-manager`、`ui-plugin-market`
- 官方默认配置：`src/shared/child-spawn-env.js`、官方 `app-boot/src/profile.ts`、`plugin-market-bundle/cordis.patch.yml`
- 桌面安装引擎：`src/main/marketplace-install.js`、`desktop-install-control.js`、`src/host/install-dsh-plugin-client.js`
