# Decision: 退出忽略本地连接且不再二次确认

Status: implemented

中文 | [English](2026-09-29-quit-transport-false-positive.en.md)

## Problem

空白工作区退出时误报三条远程连接。Host 直接统计 `upgradedSockets.size`，包含 UI、账号观察和后台服务的本地长连接。现场连接均为 127.0.0.1，来自桌面 Electron 进程。用户要求修复误计数并去掉退出二次确认。

## Decision

连接计数排除已销毁 socket 和回环地址（127/8、::1、IPv4-mapped IPv6），使用 Node `BlockList`/`isIP`；外部和未知来源仍计数。本地发起的 agent/job/在途请求仍独立检查，准入与 drain 不变。

统一 `finalizeQuit` 传 `preConfirmed: true`，保留 inspect→acquire→drain→复查→cleanup→shutdown。主窗配置为退出、菜单/托盘及 before-quit 均覆盖；关闭到托盘设置不变。2026-10-12 按用户再次指出的「退出未完成：重试／强制退出／取消」补全原要求：显式退出也不再弹故障恢复确认。锁/排空或关停失败记录诊断，自动执行有时限的资源及组件清理后结束进程；更新/安装失败仍保留组件清理钩子，重启和重载确认不变。此决定扩展[启动器停止](../product/2026-09-27-launcher-stop-preconfirmed.md)的预确认范围。

## Alternatives considered

只改文案仍让内部连接造成脏检查；只移除确认仍污染其他检查入口，均不足。

删除全部 socket 统计会掩盖外部连接；直接退出绕过协调器会破坏准入/排空，均拒绝。

## Consequences

显式退出不再额外询问是否中断工作，正常关闭仍清理资源并 shutdown 而非强杀。本机代理转发无法仅凭地址区分，但其活动任务仍独立检查。回归覆盖地址变体、未知/外部连接、真实本地 socket、活动任务保留、生产退出接线与 drain 失败无副作用。
