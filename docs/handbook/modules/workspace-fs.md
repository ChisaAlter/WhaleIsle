# 模块：工作区与文件系统

## 职责与非目标

**职责：** 选择工作区、目录列举、读写、系统打开、编辑器列表；为 Files surface 供数。  
**非目标：** 不做云盘；不做任意盘符裸奔（受权威约束）。

## 用户路径

1. 选本地文件夹为工作区 → 进入四栏。Windows 桌面在本机目录弹窗底栏提供「Windows 系统选择器」开关：打开后立即使用系统目录窗口，后续同一应用地址沿用选择方式；取消系统窗口后可在原弹窗再次选择、关闭开关或切换远程。选中目录走原工作区登记，不改启动目录、不重启 Harness。
2. Files：搜索 / 预览 / 保存 / 系统打开 / Mention 送对话。  
3. 非 Git 目录仍可作工作区（Git 能力降级）。

## 架构要点

- `workspace-authority.js` 裁定合法路径。  
- `workspace-fs.js` / `workspace-rpc.js` 实现 list/read/write。  
- `editors.js` 探测外部编辑器。

## 实现入口

- `src/main/workspace-authority.js`、`workspace-fs.js`、`workspace-rpc.js`、`editors.js`
- Harness：`packages/client/ui-files` 等

## 不变量

- 读写不得越出权威根（及明确允许的例外）。  
- 权威读桌面 `dsh-home` 的工作区登记（含启动目录的兄弟项目），不读官方 `~/.dsh`（[dsh-home.md](dsh-home.md)）；`workspace.json` 里的盘符根不进白名单。  
- Surfaces 是工作环，不是空态卡片墙（见 [surfaces.md](surfaces.md)）。

## 门槛

- QA：`TC-WS-001`、`TC-WS-005`；`TC-SURF-001` … `TC-SURF-003`；`TC-CHAT-007`、`TC-CHAT-008`

## 延伸阅读

- [../superpowers/specs/2026-08-19-files-browser-logic-port-design.md](../../superpowers/specs/2026-08-19-files-browser-logic-port-design.md)
