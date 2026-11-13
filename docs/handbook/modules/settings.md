# 模块：设置导航

## 职责与非目标

**职责：** 从菜单 / 托盘 / 快捷键跳进设置指定 section；列出桌面相关入口。  
**非目标：** 不重写官方各 settings 插件内部表单（模型 / MCP 等属 harness）。

## 用户路径

- `Ctrl+,` 或菜单「设置」。  
- 桌面侧栏底部的账户入口使用 `settings.launcher`：打开账户菜单，可进入设置、远程配对、登录，或明确重开 API Key 引导。账户入口存在时不显示重复的「设置」按钮和独立「远程」行；没有账户入口时保留这两个回退入口。
- `openSettings` / `settings-jump` 可深链到 section（如 `market`、`usage-stats`、`appearance`）。
- 设置 → General：视觉回复开关默认关闭，保存到活动 profile，立即限制新的 HTML 预览和发布；关闭后已发布页面仍可查看。
- 设置 → 对话：「下一句提示」开关默认打开；内置建议的生成、采纳和取消行为见 [ui-conversation](../../../vendor/deepseek-harness/packages/client/ui-conversation/README.md#next-prompt-suggestions)。
- 设置 → Agent：默认随包集成独立的 `dsh-acp-agents` 插件，无需从市场另装。配置并启用智能体后，在对话原生模型菜单选择智能体、模型及其支持的推理选项；插件也提供向已配置智能体委派任务的能力。默认加载插件不会自动登录账号或启用尚未配置的智能体。
- 设置 → DeepSeek 应用接口：配置独立接口基础地址、凭据引用、TTS 默认音色与 Markdown 过滤，并分别启用 TTS、ASR、OCR。保存后 AI 工具实时出现或撤下，默认关闭；调用另行计费，ASR / OCR 会上传所选文件。搜索和网页读取复用「插件 → Web 搜索」的新版 Search / Fetch 配置，不改变原有模型和本地语音输入。详见 [接口用法](../../../vendor/dsh-deepseek-tools/README.md)。
- 设置导航按「账户 / 通用 / 智能体 / 功能 / 其他」分组，顶部搜索框按标题、说明和分区名过滤；点结果进入对应分区（隐藏标签页会先切换），滚动到该行并短暂高亮。索引在首次输入时以 `indexOnly` 渲染各分区读取文字，覆盖市场插件的分区，面板关闭即丢弃；用量统计在此模式只提供标题和偏好行，不触发全量日志扫描。
- 设置 → 关于：「打开运行目录」打开桌面 `dsh-home`（见 [dsh-home.md](dsh-home.md)）。  
- Section id 表：[../appendix/settings-sections.md](../appendix/settings-sections.md)

### 极简模式与卡顿建议

设置 → 外观顶部可开启「极简模式」。它暂停壁纸、动态背景、透明模糊材质、指针与输入装饰、输入框流光和界面过渡；主题、字体、业务功能和原有外观偏好保留。下方特效偏好仍可编辑，关闭极简模式后按保存的偏好恢复。模式保存在活动 profile 的 `ui-theme.minimalMode`，默认关闭。

桌面启动后，主界面先积累 10 秒前台就绪时间，再观察 60 秒。长任务由浏览器事件通知；仅在键盘、点击或滚轮交互时补充最多三次、每次约一秒的帧采样，间隔至少五秒。空闲时没有检测用的逐帧循环。失焦、隐藏和最小化暂停观察，休眠产生的时间跳变不作卡顿证据；检测到多次、跨时间段的明显停顿才提出建议。观察结束、判定完成或用户开启极简模式后释放观察器、计时器和监听。

建议在前台且没有其它模态窗口、输入已安静时显示；每次桌面进程启动最多显示一次，不自动改变模式。「暂不开启」延后七天，「不再提醒」关闭 `minimalModeSuggestions`，可在外观页重新开启。`minimalModeSnoozedUntil` 保存延后的截止时间。建议不读取进程 CPU/内存、不调用模型或上报性能数据。

## 架构要点

- Main：`settings-jump.js`；IPC `shell:open-settings`。  
- 各 section 由 harness / 预置插件注册 `settings.section`。
- 极简模式由 `ui-theme` 计算实际外观，`ui-layout` 在 `shell.overlay` 呈现建议；共享动效原语跟随根属性 `data-dsh-minimal` 和 `dsh:render-mode` 事件。桌面 `render-mode.js` 从当前 profile 读取启动策略，之后接收主题服务的内存投影，广播给壳页面；不另存一份偏好。
- `ui-settings-general` 声明并渲染 `settings.launcher`；`ui-settings-account` 提供账户菜单并声明 `settings.launcher.action` 子槽位，`ui-settings-remote` 通过该槽位贡献「远程」菜单项及原有配对弹窗。账户插件以桌面预加载能力识别宿主：DSHD 的 `window.shell` 提供 `getConfig` / `saveConfig`，Harness 原生桌面提供 `window.dshDesktop`。账户从登录弹窗转入 API Key 引导时，即使当前已有会话，也只显式挂载被请求的 `settings.onboarding` 步骤，完成或跳过后解除该挂载。
- DSHD 账户状态流首次发布带授权链接的 `waiting-browser` 状态时，经 `window.shell.openExternal` 打开系统浏览器。同一尝试按 id 去重；失败时登录弹窗仍保留复制链接。
- 旧 `settings.yaml` 首次导入会改名为 `settings.yaml.imported`；曾被合并版缩减 Host Config 拒绝的 `ui-theme` / `ui-conversation` 字段，从该备份一次性补入当前 profile。只补当时漏登记、当前 schema 仍接受且 profile 没有显式设置的字段；每节 marker 防止用户之后重置时旧值复活。

## 实现入口

- `src/main/settings-jump.js`、`menu.js`、`tray.js`

## 不变量

- 市场在设置内，无独立市场窗（见 [marketplace.md](marketplace.md)）。
- 模型 / MCP / 技能写桌面 `dsh-home`，不写 `~/.dsh`（[dsh-home.md](dsh-home.md)）。
- 设置侧栏导航按 section id 使用互异的 16px `currentColor` 线框图标，未知 id 回退齿轮；映射见[设置 section id 附录](../appendix/settings-sections.md)。
- 账户菜单与回退按钮打开同一设置面板；远程菜单项与回退行打开同一配对弹窗。账号与更新/连接状态共用固定底栏，状态互斥；折叠侧栏固定预留状态图标席，状态变化不移动头像。没有账户注册项时显示设置入口。
- 桌面登录自动打开浏览器不改变 Host 授权和取消流程；普通 Web 页不启用该账户插件。

## 门槛

- QA：`TC-EXT-001`、`TC-EXT-006`、`TC-EXT-008`；`TC-WS-002`、`TC-WS-003`

## 延伸阅读

- [marketplace.md](marketplace.md)、[usage-stats.md](usage-stats.md)、[wallpaper.md](wallpaper.md)
