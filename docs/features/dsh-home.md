# Feature: Desktop Harness home

| Field | Value |
| --- | --- |
| **id** | `dsh-home` |
| **status** | `active` |
| **last verified** | 2026-08-25 |

历史验证与变更记录见 [docs/history/dsh-home.md](../history/dsh-home.md)。

## User paths

1. 安装或覆盖升级后冷启动：桌面 **不读** 官方 `~/.dsh`；Harness 只用 `userData/dsh-home`（Windows：`%APPDATA%\Deepseek-Harness-Desktop\dsh-home`）。
2. 设置 → 市场安装进入 `dsh-home/profiles/web`，不是 `~/.dsh`。
3. 设置 → 关于 →「打开运行目录」在资源管理器中打开桌面 `dsh-home`（不打开 `userData` 根、安装目录或当前工作区）。
4. 底栏终端里运行官方 `dsh` 仍使用 `~/.dsh`（或用户自己的 `DSH_HOME`）。
5. 覆盖升级后会话 / 主题 / 自定义模型须在桌面里重配，或经启动器导入官方 `sessions/`；壳层已存的默认 API key 与工作区路径仍可用。

## Invariants

- 桌面 `$DSH_HOME` 仅为 `userData/dsh-home`（测试/调试可用 `DSHD_HOME`；packaged 构建忽略继承的 `DSHD_HOME`，除非显式 `DSHD_ALLOW_ENV_HOME=1`）。忽略环境 `DSH_HOME`，永不回落 `~/.dsh`。
- 桌面 **Harness / PTY / `process.env.DSH_HOME`** 不读、不写、不清理 `~/.dsh`。壳层启动器可**只读**官方 home、`~/.agents/skills` 与用户另选的技能根，以及官方 `mcp-servers.yaml`、`settings.yaml`（白名单节）、`.credentials.yaml`（被引用 refs）、`.agent-presets/`、home `AGENTS.md`，做用户确认后的勾选导入（见 [data-import](data-import.md)）；禁止静默自动迁、禁止写回或删除官方文件。
- 不把桌面 home 写进 Electron `process.env.DSH_HOME`；PTY 不注入该值。
- `dsh web` 与 `dsh plugin` 子进程的 `DSH_HOME` 覆盖为桌面 home。
- 子进程 `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` 仅在壳层 `baseUrl` 为空或为 `https://api.deepseek.com`（仅 https，不接受明文 http）时写入；第三方网关只留给自定义提供方。
- 渲染进程不得把路径交给打开接口；主进程只打开已绑定的桌面 home。
- `--skip-user-plugins` 恢复状态机不变。

## Allowed touch

- `src/shared/dsh-home.js` 与其单测
- `src/main/open-dsh-home.js`、`ipc.js`、`src/preload/index.js` 与其单测
- `vendor/deepseek-harness/packages/client/ui-settings-general` 的 About 页 / desktop-shell / 词典
- `src/shared/official-deepseek-env.js`、`src/shared/child-spawn-env.js` 与其单测
- `src/main/index.js`、`dsh.js`、`plugins.js`、`marketplace-install.js`、`workspace-authority.js`
- `src/shared/themes.js` 读 `settings.yaml` 的路径
- `scripts/smoke-workspace.mjs` 与 `qa:source` / `qa:composer` / `qa:packaged` / packaged smoke 的 spawn 环境
- `src/main/packaged-p0.js`（安装包路径兄弟工作区 / overlay stamp 门禁）
- 本卡、handbook `modules/dsh-home.md`、`.cursor/rules/dsh-home-product.mdc`、QA TC-INST-009 / TC-INST-011 / TC-DESK-009

## Do not touch

- 把恢复改成版本 bump 先 skip
- Appearance 图源、市场独立窗、boot 仪器 token

## Gates

| Kind | What |
| --- | --- |
| Automated | `dsh-home` / `official-deepseek-env` / spawnEnv / workspace-authority / `open-dsh-home` / ipc `open-dsh-home` / AboutSection 单测；冒烟不得注入 `DSH_HOME`；`qa:packaged` 可验证预写兄弟仓，不覆盖真实用户数据迁移 |
| Manual / QA | 数据目录、迁移或工作区解析改变时，参考 `TC-INST-009`、`TC-INST-011`、`TC-WS-006`、`TC-DESK-009`，在对应真实环境观察结果 |

## Sources

- Decision: none

- Spec：[../superpowers/specs/2026-08-22-desktop-dsh-home-design.md](../superpowers/specs/2026-08-22-desktop-dsh-home-design.md)
- Handbook：[../handbook/modules/dsh-home.md](../handbook/modules/dsh-home.md)
- Recovery（不改）：[../superpowers/specs/2026-08-18-plugin-startup-recovery-design.md](../superpowers/specs/2026-08-18-plugin-startup-recovery-design.md)
- Implementation：`src/shared/dsh-home.js`、`src/main/index.js` `whenReady`
