# 模块：设置导航

## 职责与非目标

**职责：** 从菜单 / 托盘 / 快捷键跳进设置指定 section；列出桌面相关入口。  
**非目标：** 不重写官方各 settings 插件内部表单（模型 / MCP 等属 harness）。

## 用户路径

- `Ctrl+,` 或菜单「设置」。  
- 桌面侧栏底部的账户入口使用 `settings.launcher`：打开账户菜单，可进入设置、远程配对、登录，或明确重开 API Key 引导。账户入口存在时不显示重复的「设置」按钮和独立「远程」行；没有账户入口时保留这两个回退入口。
- `openSettings` / `settings-jump` 可深链到 section（如 `market`、`usage-stats`、`appearance`）。
- 设置 → General：视觉回复开关默认关闭，保存到活动 profile，立即限制新的 HTML 预览和发布；关闭后已发布页面仍可查看。
- 设置 → 关于：「打开运行目录」打开桌面 `dsh-home`（见 [dsh-home.md](dsh-home.md)）。  
- Section id 表：[../appendix/settings-sections.md](../appendix/settings-sections.md)

## 架构要点

- Main：`settings-jump.js`；IPC `shell:open-settings`。  
- 各 section 由 harness / 预置插件注册 `settings.section`。
- `ui-settings-general` 声明并渲染 `settings.launcher`；`ui-settings-account` 提供账户菜单并声明 `settings.launcher.action` 子槽位，`ui-settings-remote` 通过该槽位贡献「远程」菜单项及原有配对弹窗。账户插件以桌面预加载能力识别宿主：DSHD 的 `window.shell` 提供 `getConfig` / `saveConfig`，Harness 原生桌面提供 `window.dshDesktop`。账户从登录弹窗转入 API Key 引导时，即使当前已有会话，也只显式挂载被请求的 `settings.onboarding` 步骤，完成或跳过后解除该挂载。
- DSHD 账户状态流首次发布带授权链接的 `waiting-browser` 状态时，经 `window.shell.openExternal` 打开系统浏览器。同一尝试按 id 去重；失败时登录弹窗仍保留复制链接。
- 旧 `settings.yaml` 首次导入会改名为 `settings.yaml.imported`；曾被合并版缩减 Host Config 拒绝的 `ui-theme` / `ui-conversation` 字段，从该备份一次性补入当前 profile。只补当时漏登记、当前 schema 仍接受且 profile 没有显式设置的字段；每节 marker 防止用户之后重置时旧值复活。

## 实现入口

- `src/main/settings-jump.js`、`menu.js`、`tray.js`

## 不变量

- 市场在设置内，无独立市场窗（见 [marketplace.md](marketplace.md)）。
- 模型 / MCP / 技能写桌面 `dsh-home`，不写 `~/.dsh`（[dsh-home.md](dsh-home.md)）。
- 设置侧栏导航按 section id 使用互异的 16px `currentColor` 线框图标，未知 id 回退齿轮；映射见[设置 section id 附录](../appendix/settings-sections.md)。
- 账户菜单与回退按钮打开同一设置面板；远程菜单项与回退行打开同一配对弹窗。更新、连接状态独立保留，空状态行不占空间。没有账户注册项时不留下占位。
- 桌面登录自动打开浏览器不改变 Host 授权和取消流程；普通 Web 页不启用该账户插件。

## 门槛

- QA：`TC-EXT-001`、`TC-EXT-006`、`TC-EXT-008`；`TC-WS-002`、`TC-WS-003`

## 延伸阅读

- [marketplace.md](marketplace.md)、[usage-stats.md](usage-stats.md)、[wallpaper.md](wallpaper.md)
