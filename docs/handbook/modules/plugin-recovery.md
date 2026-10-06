# 模块：插件启动恢复

## 职责与非目标

**职责：** 启动器按包问诊（禁用 / 删除 / 再试）；boot 侧跳过用户插件树 / 重试 / 日志。  
**非目标：** 不自动静默删除用户插件；不伪造「已满配」状态；通用崩溃不归咎某个插件。

## 用户路径

见 [../flows/plugin-recovery.md](../flows/plugin-recovery.md)。

## 架构要点

- 问诊：`plugin-forensics.js` 解析上次日志；`listInstalledPlugins()` 列包；禁用走 `applyDisabledBundles` + 壳层 `disabledPlugins`。  
- Web boot 单个或多个 entry 激活失败均归入插件故障；归因只使用本次启动的错误与日志。自动跳过时保存原始失败的 `pluginRecovery.reason` 与有界 `logTail`，不把此前启动的旧错误或跳过成功后的日志混入禁用建议。
- 启动失败或自动跳过用户插件后，启动器首页显示恢复建议，并在可见、获得焦点时主动确认一次。确认列出日志指向的已安装用户插件；取消不改配置。同一故障不会因状态刷新重复弹出，首页仍可手动处理。
- 「禁用并启动鲸屿」在主进程复核当前嫌疑名单，只禁用可禁用的用户插件，清除跳过状态后启动一次，其余插件保持原选择。不卸载插件、不删除会话或插件业务数据；内置组件、官方模板、已禁用插件、无安装登记的包不在建议禁用名单。未定位具体包时可引导跳过用户插件；内存、端口、运行时和缓存故障不引导禁用插件。
- 禁用写入与启动共享维护锁；启动被拒绝或再次失败时如实说明「已禁用，启动未完成」，不自动禁用更多插件或循环重试。再次进入跳过模式也不当作完整恢复。
- 失败分类与跳过：`plugin-tree-failure.js`、`plugin-recovery-actions.js`。  
- 跳过旗标须从 CLI 普通 profile 参数解析传到 app-boot；`bundles: 'template'` 只加载该 profile 的出厂 bundle，不改写用户选择或 patch。仅解析 dump 旗标、或仍读取 manifest bundle，均不能视为跳过已生效。
- Controller 持有 recovery 模式；boot-recovery 渲染跳过动作。启动失败时启动器留下。

## 实现入口

- `plugin-forensics.js`、`plugins.js`、`harness-controller.js`、`plugin-tree-failure.js`、`plugin-recovery-actions.js`
- `src/renderer/launcher.js`、`src/renderer/boot-recovery.js`
- Preload launcher：`pluginForensics`、`disablePlugin`、`disableSuspectsAndStart`、`enablePlugin`、`removePlugin`、`skipUserPlugins`、`retryFullPlugins`

## 不变量

- 跳过与重试路径必须可测、可导出日志。  
- 造障类 QA 不得静默标 Pass。
- 官方 `~/.dsh` 隔离（[dsh-home.md](dsh-home.md)）不能代替跳过**桌面** `dsh-home` 里的用户插件。
- 预置包 `dsh-usage-panel` 不允许删除；官方模板 bundle 不允许禁用。市场已内置为桌面自有代码，`dshmarket` 不再是预置包。

## 门槛

- QA：`TC-LAUNCH-005`、`TC-INST-004` … `TC-INST-007`

## 延伸阅读

- [../superpowers/specs/2026-08-18-plugin-startup-recovery-design.md](../../superpowers/specs/2026-08-18-plugin-startup-recovery-design.md)
- [boot-lifecycle.md](boot-lifecycle.md)
- [../../features/desktop-launcher.md](../../features/desktop-launcher.md)
