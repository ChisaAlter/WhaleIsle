# Feature: 桌面账户浏览器登录

| Field | Value |
| --- | --- |
| **id** | `account-browser-sign-in` |
| **status** | `active` |
| **last verified** | 2026-09-24 |

历史验证与变更记录见 [docs/history/account-browser-sign-in.md](../history/account-browser-sign-in.md)。

## User paths

1. 在桌面账户菜单或设置中点击「登录」，授权链接就绪后系统浏览器自动打开登录页。
2. 自动打开失败时，登录弹窗仍可复制链接并手动完成登录。

## Invariants

- 同一次登录尝试只自动打开一次；状态流重连不重复弹出。
- 仅桌面壳打开外部浏览器；普通 Web 页不触发桌面登录副作用。
- 浏览器打开失败不取消服务端登录尝试。

## Allowed touch

- `vendor/deepseek-harness/packages/client/ui-settings-account/` — 桌面登录状态与定向测试。
- `docs/design-language*`, `docs/features/`, `docs/handbook/modules/settings.md`, `docs/decisions/` — 呈现、契约与决定。

## Do not touch

- 授权协议、凭据存储与退出登录。
- 账户菜单和弹窗布局。

## Gates

| Kind | What |
| --- | --- |
| Automated | `ui-settings-account` 定向测试、类型检查、治理检查 |
| Manual / QA | 源码桌面点击登录后系统浏览器只打开一次 |

## Sources

- Decision: [桌面账户登录自动打开浏览器](../decisions/implemented/bug-fix/2026-09-24-account-browser-sign-in.md)
- Implementation entry: [ui-settings-account](../../vendor/deepseek-harness/packages/client/ui-settings-account/src/client/index.ts)
- Desktop browser precedent: [Harness desktop](../../vendor/deepseek-harness/apps/desktop/src/main.ts)
