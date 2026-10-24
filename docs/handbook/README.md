# Deepseek-Harness-Desktop 产品手册

中文产品与架构综合视图：**当前态**蓝图、流程、模块入口与验收门槛。给开发者与 Agent 定向用；改行为契约仍以 [Feature Spine](../features/README.md) 为准。

## 读者路径

| 你想… | 先读 |
| --- | --- |
| 搞清进程与表面怎么拼起来 | [blueprint.md](blueprint.md) |
| 搞清会话/插件目录在哪、是否读 `~/.dsh` | [modules/dsh-home.md](modules/dsh-home.md) |
| 跟一条端到端用户路径 | [flows/](flows/boot-to-ready.md)（冷启动先进启动器） |
| 改某一能力、找文件与门槛 | [modules/](modules/overview.md) |
| 查 `window.shell` / 设置 id / main 文件 | [appendix/](appendix/shell-api.md) |
| 开会话改产品且防回归 | [../features/README.md](../features/README.md) + `Touching: <id>` |
| 发版实机验收 | [发布操作流程](modules/release-process.md)选择核心与影响场景；[完整用例库](../qa/production-acceptance-test-cases.md)提供步骤，对象=原始 CI 安装包 |

## 与其他文档的分工

| 层 | 职责 | 本手册是否替代 |
| --- | --- | --- |
| 本手册 `docs/handbook/` | 蓝图、流程、模块当前态 | — |
| [docs/features/](../features/README.md) | Agent 改动契约（路径 / 不变量 / allowed touch / gates） | 否 |
| [docs/design-language.md](../design-language.md) / [motion.md](../motion.md) | 视觉与动效强制规则 | 否；模块只链接 |
| [docs/superpowers/specs](../superpowers/specs/) | 设计与施工过程 | 否；定稿事实收进手册与 feature 卡 |
| [docs/qa/…](../qa/production-acceptance-test-cases.md) | 发版用例库：CI 安装包按核心/影响计划执行 | 否；章节挂用例 ID |
| [docs/decisions/](../decisions/README.md) | 决策记录：为什么 + 被否方案 | 否；手册只写当前态 |
| [vendor/deepseek-harness/docs/architecture.md](../../vendor/deepseek-harness/docs/architecture.md) | Harness 上游 agent-loop / Cordis | 否；不抄上游百科 |

## 目录

### 蓝图

- [系统蓝图](blueprint.md)

### 流程

- [冷启动到就绪](flows/boot-to-ready.md)
- [设置壁纸](flows/wallpaper-set.md)
- [市场安装插件](flows/marketplace-install.md)
- [插件启动恢复](flows/plugin-recovery.md)
- [手机远程配对](flows/remote-pair.md)
- [添加 SSH 远程工作区](flows/remote-workspace.md)

### 模块

- [产品总览](modules/overview.md)
- [桌面 Harness 家目录](modules/dsh-home.md)
- [启动与 Harness 生命周期](modules/boot-lifecycle.md)
- [窗口与 Chrome](modules/window-chrome.md)
- [Preload 与 IPC](modules/ipc-preload.md)
- [工作区与文件系统](modules/workspace-fs.md)
- [Git 标题栏](modules/git-titlebar.md)
- [Surfaces 工作环](modules/surfaces.md)
- [终端](modules/terminal.md)
- [设置导航](modules/settings.md)
- [插件市场](modules/marketplace.md)
- [用量统计](modules/usage-stats.md)
- [桌面宠物（Live2D 鲸鱼娘）](modules/desktop-pet.md)
- [壁纸与外观桥接](modules/wallpaper.md)
- [鲸鱼娘助理（dsh-whale）](modules/whale-assistant.md)
- [托盘、关闭与更新](modules/tray-update.md)
- [远程设置](modules/remote-settings.md)
- [SSH 远程工作区](modules/remote-workspaces.md)
- [手机远程](modules/mobile-remote.md)
- [插件启动恢复](modules/plugin-recovery.md)
- [构建、钉版与发版](modules/build-release.md)
- [设计语言与 Feature Spine](modules/design-and-spine.md)

### 附录

- [`window.shell` 能力索引](appendix/shell-api.md)
- [设置 section id](appendix/settings-sections.md)
- [`src/main` 模块索引](appendix/main-modules.md)

## 章节写法约定

章节按理解当前实现所需的内容组织，通常包含职责、用户路径、架构、实现入口与验证方式，不设页数或空章节要求。事实以仓库代码与现行契约为准；历史链接到提交、决定或 QA 记录，不在手册正文累积。维护操作见 [维护系统](../maintenance/README.md)。
