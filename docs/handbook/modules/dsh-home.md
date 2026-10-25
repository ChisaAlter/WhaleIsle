# 模块：桌面 Harness 家目录

## 职责与非目标

**职责：** 桌面拉起的 `dsh web` / `dsh plugin` 使用独立 `$DSH_HOME`，与官方 CLI 的 `~/.dsh` 分开。  
**非目标：** 不静默从 `~/.dsh` 迁移；不清理官方 home；不增加家目录设置页；不把隔离当成「跳过桌面市场插件」的恢复手段。用户确认的只读导入见启动器 [data-import](../../features/data-import.md)。

## 用户路径

1. 安装或覆盖升级后冷启动：桌面 **不读** 官方 `~/.dsh` 的会话、设置、插件。  
2. 设置 → 市场安装的插件进入桌面 `profiles/web`。  
3. 设置 → 关于 →「打开运行目录」打开桌面 `userData/dsh-home`。  
4. 底栏终端里运行官方 `dsh` 仍用 `~/.dsh`（或用户自己的 `DSH_HOME`）。  
5. 覆盖升级后须在桌面重配会话 / 主题 / 自定义模型；壳层 API key 与工作区路径仍在。

## 架构要点

`whenReady` 最先 `setDesktopDshHome(userData/dsh-home)` 并建目录，早于 IPC 与 `dsh web`。解析顺序：非空 `DSHD_HOME` → 已绑定路径 → throw。永不回落 `~/.dsh`，也不读环境里的 `DSH_HOME`。packaged 构建在 `whenReady` 先 `sanitizePackagedDshHomeEnv`：继承的 `DSHD_HOME` 被丢弃并记日志，除非显式设置 `DSHD_ALLOW_ENV_HOME=1`；dev / 单测不受影响。

`dsh web` 与 `dsh plugin` 的子进程环境覆盖 `DSH_HOME` 为桌面 home。Electron `process.env` 与 PTY **不**写入该值。`DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` 仅在壳层 `baseUrl` 为空或为 `https://api.deepseek.com`（仅 https，明文 http 不别名）时写入；Ayase 等第三方网关不得别名到这两项。

## 落点

产品 `userData`：`%APPDATA%\Deepseek-Harness-Desktop\`  
macOS：`~/Library/Application Support/Deepseek-Harness-Desktop/`

| 内容 | 目录 |
| --- | --- |
| 桌面 Harness `$DSH_HOME` | `userData/dsh-home` |
| 市场 / 用户插件（profile `web`） | `dsh-home/profiles/web` |
| 组合包解析回退 | `dsh-home/profiles/node_modules` |
| 会话、`settings.yaml`、MCP、技能 | `dsh-home/` 下对应文件 |
| 会话全文索引（全量启动 overlay） | `dsh-home/session-query.sqlite` |
| 壳层工作区路径、关闭行为、远程配对 | `userData/config.json` |
| 壳层默认 API key | `userData/credentials.json` |
| 官方 CLI（桌面不读写） | `~/.dsh` |

壳层按文件身份、大小及纳秒级修改/变更时间复用已校验的只读设置，避免普通配置读取重复遍历鲸鱼娘养成账本；每次读取仍重新读取凭据，保存始终重读设置文件。`config.json` 解析失败时先改名为 `config.json.corrupt-<时间戳>` 再写默认值；其他读取失败时保存报错，不用默认值覆盖。`credentials.json` 存在但读不出或解不开（钥匙串锁定、拒绝访问、文件被占用）时，读取视为空，普通保存不写它，保存凭据字段报错，原文件保持不变。

启动日志有一行 `Harness 家目录`，路径必须含 `dsh-home`。

## 实现入口

- `src/shared/dsh-home.js`、`src/shared/official-deepseek-env.js`
- `src/main/index.js` `whenReady`；`open-dsh-home.js`；`dsh.js` `spawnEnv`；`marketplace-install.js` `pluginEnv`；`plugins.js` `webProfileDir`；`workspace-authority.js`；`src/shared/themes.js`
- 设置关于页：`vendor/deepseek-harness/packages/client/ui-settings-general/src/client/AboutSection.tsx`

## 不变量

- Feature card：[../../features/dsh-home.md](../../features/dsh-home.md)
- 短规则：[../../../.cursor/rules/dsh-home-product.mdc](../../../.cursor/rules/dsh-home-product.mdc)
- Harness/PTY 不读、不写、不清理 `~/.dsh`。壳层启动器可只读扫描官方 home、用户技能根与 MCP 文件，经勾选导入到桌面 home（用户确认）。
- 隔离挡的是官方 home 污染；桌面 `dsh-home` 里的用户插件弄挂仍走既有 skip 恢复。

## 门槛

- 单测：`src/shared/dsh-home.test.js` 及 spawnEnv / pluginEnv / PTY / `open-dsh-home` / ipc 打开家目录
- 自动化：`qa:source` / `qa:composer` 不得向 Electron 注入 `DSH_HOME`；结果须含桌面 `dsh-home`
- QA：`TC-INST-009`、`TC-INST-011`、`TC-DESK-009`

## 延伸阅读

- Spec：[../superpowers/specs/2026-08-22-desktop-dsh-home-design.md](../../superpowers/specs/2026-08-22-desktop-dsh-home-design.md)
- [boot-lifecycle.md](boot-lifecycle.md)、[marketplace.md](marketplace.md)、[terminal.md](terminal.md)
