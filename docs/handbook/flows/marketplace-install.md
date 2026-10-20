# 流程：市场安装插件

## 步骤

1. 打开侧栏「插件 → 发现」，或通过托盘 / 菜单的「插件市场」进入。桌面默认开启官方自定义插件市场，并提供 realguan 社区索引。Harness 未就绪时等待主界面完成启动后跳转；无独立市场窗口。
2. 浏览、搜索插件；「索引源」中可添加、替换或删除源。用户源配置保存在当前 web profile，清空后重启仍为空；已有自定义源保持不变。
3. 通过官方发现页查看并安装 bundle。官方 `pluginMarket` / `pluginManager` 负责规格检查、构建授权、安装反馈和运行时重载；桌面向 `runCli` 注入内置 Node / pnpm，不要求系统另装 pnpm。
4. 在「插件 → 已安装」查看、配置、停用或卸载插件。停用自定义插件市场后发现页签消失；保存的源仍在，再次启用可恢复。

旧「设置 → 市场」入口隐藏，原收藏和操作历史文件保留。会话内 `install_dsh_plugin`、launcher 导入及旧桌面 IPC 继续使用桌面安装引擎和原有事务、授权、回滚与重启行为；这些行为不等同于官方发现页的安装流程。

默认源、配置层优先级和两个引擎的实现见[插件市场模块](../modules/marketplace.md)。

## 入口

- 导航：`src/main/window.js`、`src/main/marketplace-jump.js`
- 官方 UI：`vendor/deepseek-harness/packages/client/ui-plugin-manager`、`ui-plugin-market`
- 默认配置：`src/shared/child-spawn-env.js`、官方 `app-boot/src/profile.ts`、`plugin-market-bundle/cordis.patch.yml`
- 保留的桌面安装：`src/main/marketplace-install.js`、`desktop-install-control.js`、`src/host/install-dsh-plugin-client.js`
