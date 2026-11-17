# Feature: Terminal drawer

| Field | Value |
| --- | --- |
| **id** | `terminal-drawer` |
| **status** | `active` |
| **last verified** | 2026-09-20 |

历史验证与变更记录见 [docs/history/terminal-drawer.md](../history/terminal-drawer.md)。

## User paths

1. `` Ctrl+` `` 打开底栏终端；可输入命令。
2. 选区送进对话（Composer）。
3. 多会话 / 分屏（若 UI 提供）；销毁后可重建。

## Invariants

- **PTY 输出合并（2026-09-22）**：`createPtyController` 不再对每个 backend chunk 发一条 `shell:pty-data`。空闲后到达的第一个 chunk 立即发布（交互回显不付窗口），随后同一 burst 内按 8 ms 或 32 KiB（UTF-8 字节）先到者 flush；`shell:pty-exit` 与 `kill`/`killAll` 前先 flush 缓冲，退出事件永不越过尾部输出。合并只减少 IPC 条数，不改字节序、不丢内容、不缓冲输入写入与 resize。**背压仍未实现**：node-pty `pause`/`resume` 未被证明能约束生产速度，本卡不声称已具备背压。
- 终端是工作环，不是空态说明卡片。
- PTY 由桌面 `pty.js` 提供；UI 为官方终端组件语言（等宽网格 / Ghostty）。
- `libghostty-vt` wasm 必须能从 `/plugins/<id>/assets/` 读到；源码启动会校验并把 wasm 拷到 `lib/assets`，缺则拒绝启动。
- PTY 生命周期：关抽屉 / 关 surface tab / 切会话都**不** kill（进程保活，回来还在）；kill 只发生在终端 UI 的垃圾桶按钮与 app 退出；renderer reload / 崩溃（`render-process-gone` / 跨文档导航）时 main 收割该 renderer 名下全部 PTY，不留孤儿。
- `shell:pty-*` 必须经中央 `assertIpcSender(HARNESS_ONLY)`：只有 harness 顶层 frame 能创建/写入/调整/终止；单条 PTY 还额外绑定**创建它的 webContents**，别的已授权 renderer 也不能 write/resize/kill（`unknown pty id`）。已销毁 sender 在派发前即拒绝（`ERR_DSH_IPC_SENDER`）。
- 创建与记账之间存在 `await`：`shell:pty-create` 必须在 await 后复检 sender 代际（sender 表身份 + generation + 未销毁），renderer 在创建期间被销毁**或跨文档导航**时把迟到 PTY `kill` 掉再失败，不得只删记账留下后台 shell。尺寸先归一化（整数、`1..1000`，非有限值回落 `120x30`）再进后端。
- `` Ctrl+` `` 在 Ghostty 终端焦点内也切换抽屉（beforeKey 放行给 titlebar window 监听）。
- 不做未承诺的 GPU 终端嵌入。

## Allowed touch

- `src/main/pty.js` 及 PTY 相关测试
- `src/main/dsh.js`、`src/shared/ghostty-assets.js` 及对应测试（源码启动 Ghostty 校验/拷贝）
- Harness `ui-user-terminal`（及桌面接线）
- Harness `ui-titlebar` 的 keybindings / PanelToggles（面板快捷键判定，2026-08-25 硬化计划扩围）
- 本卡与 handbook terminal 章

## Do not touch

- 用空态卡片墙替代可用 PTY
- 无用户授权时改 Surfaces Tab 关闭位置（属 `surfaces-work-loops`）

## Gates

| Kind | What |
| --- | --- |
| Automated | `pty.test.js` / `dsh.test.js` / `ghostty-assets.test.js`；`qa:packaged` 可验证 unpacked 应用的兄弟仓 PTY 与 wasm 加载 |
| Manual / QA | 终端、工作区或工具调用改变时，参考 `TC-TERM-001`…`004`、`TC-CHAT-004`，在登记兄弟仓观察相应真实操作；随包行为使用对应打包或安装版本 |

## Sources

- Decision: none
- Owning decision: [PTY 输出按 burst 合并后再跨 IPC](../decisions/proposed/architecture/2026-09-22-pty-output-coalescing.md)

- Handbook：[../handbook/modules/terminal.md](../handbook/modules/terminal.md)
- Note：`vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-16-surfaces-terminal-work-loops.md`
- 审查与硬化计划：[../superpowers/plans/2026-08-25-surfaces-terminal-hardening.md](../superpowers/plans/2026-08-25-surfaces-terminal-hardening.md)
