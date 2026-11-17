# Feature: Keyboard shortcuts（统一快捷键）

| Field | Value |
| --- | --- |
| **id** | `keyboard-shortcuts` |
| **status** | `active` |
| **last verified** | 2026-09-26 |

历史验证与变更记录见 [docs/history/keyboard-shortcuts.md](../history/keyboard-shortcuts.md)。

## User paths

1. 侧栏快捷键入口打开面板；搜索动作、查看当前绑定、修改、重置为官方默认。
2. 已受理绑定在物理层先于 DOM 消费（上游一致）；自定义立即生效。
3. 无快捷键历史的旧用户自动得到官方默认，无迁移提示。
4. iframe/webview guest 内的已受理绑定照常触发；未绑定键留在 guest。

## Invariants

- 持久化到 `keybindings.json`（原子写入）；读不到或损坏 = 官方默认，不写回。
- 上游优先策略显式化：`data-shortcut-policy="native-first"` 文档标记驱动，`before-input-event` 在主进程裁定已受理绑定并 `preventDefault()`；未命中键原样进 DOM。
- adapter 对接上游 shortcuts API 与桌面壳菜单/按钮；不造第二套快捷键系统。
- 恢复默认后回到官方表，不留 tombstone。
- 一个物理输入一个执行者：registry 受理的绑定键压制同名菜单 accelerator；菜单点击走 `dispatchMenuCommand`（commandId + revision）。
- overlay 阻断吞全部输入并压菜单 accelerator；recording 抑制、closeWindow revision 复核不变。
- `Ctrl+\`/`Ctrl+`` 在 desktop 只有注册表一个 owner（`surfaces.toggle`/`terminal.drawer.toggle`），PanelToggles 的 DOM 直听仅 web 保留。
- 用户把终端常用键绑给全局命令时原生层先于 xterm 拦截——官方一致的授权语义，不当 bug 修。

## Allowed touch

- `src/main/shortcuts*.js`（持久化 + 原生拦截 + adapter）
- `src/main/menu.js`（命令项键帽与 dispatch 接线）
- `src/preload/index.js`（`dshDesktop` 窄外观：`keyboard`/`shortcuts`）
- `vendor/deepseek-harness/packages/client/shortcuts/`（policy.ts、registry/index 策略接线）
- `vendor/deepseek-harness/packages/client/{ui-titlebar,ui-sidebar-right,ui-sidebar-terminal,ui-user-terminal}/`（面板 chords 收编 + region 标记，fork markers 登记）
- `src/renderer/`（侧栏入口与面板接线；复用既有 UI 槽位）

## Do not touch

- 不改上游快捷键 schema；不写第二份持久化文件。
- 不在拦截层吞未受理键；编辑键在绑定前的本地语义不预判。

## Gates

| Kind | What |
| --- | --- |
| Automated | `src/main/shortcuts.test.js`（持久化/原生拦截/iframe+webview payload/重置/迁移语义） |
| Manual / QA | 面板交互、输入竞争、旧用户首启默认 |

## Sources

- Decision: [上游优先原生快捷键拦截](../decisions/implemented/architecture/2026-09-26-native-first-shortcut-interception.md)（supersedes 09-25 local-first）
- Plan: `docs/superpowers/plans/2026-09-25-upstream-adoption-plan.md` §5/P2
- Evidence: `docs/superpowers/evidence/2026-09-25-upstream-adoption/ledger.md`（K-1…K-10）
