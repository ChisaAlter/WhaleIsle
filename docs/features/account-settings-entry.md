# Feature: 账户菜单中的桌面入口

| Field | Value |
| --- | --- |
| **id** | `account-settings-entry` |
| **status** | `active` |
| **last verified** | 2026-09-23 — 账户菜单「远程」打开原配对弹窗，Esc 关闭后焦点回到账号按钮；源码应用 CDP 确认侧栏旧入口为 0。相关测试 76/76、两个插件类型检查、治理 6/6、文档 8/8 通过；完整官方构建被另一项未跟踪的 `titlebar-fit.e2e.ts` 导入 Host 脚手架挡住，客户端资源与 Web 已单独构建。此前 2026-09-23 — 隐藏深链触发点恢复 settings-jump 打开桌宠分区，设置壳测试 31/31 通过。再前 2026-09-23 — 设置壳 31/31、账户菜单 40/40、TypeScript 检查、官方构建、`doc-sync` 8/8；源码应用重启后 CDP 确认账户按钮可见、独立设置按钮为 0、空状态行 `display: none`。 |

## User paths

1. 账户入口存在时，从侧栏底部账户菜单进入设置；登录与未登录状态均可使用。
2. 账户入口未注册时，从侧栏底部的设置按钮进入同一设置面板。
3. `Ctrl+,`、菜单与 `settings-jump` 深链仍打开同一设置面板。
4. 桌面具备远程配对能力时，从账户菜单「远程」打开原配对弹窗；账户入口未注册时使用侧栏底部「远程」行。
5. 已安装鲸桥时，账户菜单「鲸桥」打开现有组件设置窗口；鲸桥停止时先启动再打开，运行时复用并聚焦该窗口。未安装不显示，每次展开菜单重新读取安装状态，不轮询或查询发布目录。

## Invariants

- 账户入口存在时不显示第二个设置按钮；不存在时显示回退按钮。
- 更新与连接状态共用一个固定图标席并互斥显示，展开时与账号同一行，折叠时在账号上方保留固定位置；状态变化不挤高头像。
- 从账户菜单打开的设置面板关闭后，焦点返回账户按钮。
- 账户入口存在时没有独立远程行；远程弹窗的配对、设备管理和 QR 闸门保持原行为，关闭后焦点返回账户按钮。远程能力缺席时菜单不显示该项。
- 鲸桥入口按安装状态而非运行状态显示；管理地址与认证参数留在桌面主进程，账户菜单只获得安装标记及打开结果，不获得安装、卸载或停止权限。

## Allowed touch

- `vendor/deepseek-harness/packages/client/ui-settings-general/` — 入口、焦点与定向测试。
- `vendor/deepseek-harness/packages/client/ui-settings/src/client/contract/slots.ts`, `vendor/deepseek-harness/packages/client/ui-settings-account/`, `vendor/deepseek-harness/packages/client/ui-settings-remote/` — 账户菜单子槽位、远程入口与回退。
- `docs/design-language*`, `docs/handbook/modules/settings.md`, `docs/features/`, `docs/decisions/` — 视觉和行为契约。

## Do not touch

- 账户认证、退出登录与设置表单内容。
- 更新和连接状态的业务行为。

## Gates

| Kind | What |
| --- | --- |
| Automated | `ui-settings-general` 定向测试、官方构建、治理检查 |
| Manual / QA | 桌面侧栏展开与折叠状态下的入口及关闭焦点 |

## Sources

- Design: [设计语言](../design-language.md)
- Decision: [Harness 0.1.7 桌面接口适配](../decisions/implemented/architecture/2026-09-23-harness-017-desktop-adaptation.md)
- Decision: [远程入口收束到账户菜单](../decisions/implemented/product/2026-09-23-remote-account-menu.md)
- Implementation entry: [SettingsRoot.tsx](../../vendor/deepseek-harness/packages/client/ui-settings-general/src/client/SettingsRoot.tsx)
