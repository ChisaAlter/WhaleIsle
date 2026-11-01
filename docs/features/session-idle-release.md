# Feature: 闲置会话释放

| Field | Value |
| --- | --- |
| **id** | `session-idle-release` |
| **status** | `active` |
| **last verified** | 2026-10-30 — 隔离测试实例 + 用户会话副本（910 个会话、1.56 GB）实测，见下方 Gates |

## User paths

1. 应用长时间开着、打开过很多（大）会话之后，切换会话和新建会话不会越来越慢。
2. 切回一个已经释放的会话：从磁盘重新加载（特大会话 1–5 秒，普通会话不到 1 秒），侧栏条目、标题和内容不变。
3. 正在运行、有后台任务、目标续跑、子智能体或 Project 管理的会话照常工作，不会被释放。

## Invariants

- 打开会话（follow）仍会在后台激活 Agent，打开后可以立即发送消息。
- 以下会话一直常驻：任一客户端（含手机远程）正在跟随、Agent 运行中、收件箱有排队输入、名下后台任务处于 running/stopping、目标正在自动续跑（phase active 且 activation armed；恢复后的目标默认 disarmed，不算）、有在线子 Agent、本身是子智能体、带插件 presentation owner（如 Project 协调者）、正在删除。
- 其余会话：除最近活跃的 `idleReleaseKeep`（默认 3）个外，空闲满 `idleReleaseMs`（默认 300000 毫秒）即释放；`idleReleaseMs: 0` 关闭释放。
- 释放只卸载内存中的 Agent，不改持久化数据。宿主改发 `api-session/added`（`agentAvailable: false`），不发 `api-session/removed`，会话留在侧栏。
- 释放会触发 `agent/disposed`：插件按 Agent 记录的进程内状态随之清理，下次恢复时重建，与重启宿主后再打开会话相同。
- session-query 的冷读缓存（`preparedSessionCacheSize`）在桌面装配里为 1：只承接「查看 → 恢复」那一次交接（交接期间条目被租约钉住），不再额外常驻最近 5 个已释放会话的完整日志。

## Upstream differences

- 保护的行为：见上方不变量。上游的 follow 会把会话恢复成 Agent，`SessionLifecycle` 永久持有句柄，只有删除会话时才释放；桌面宿主长时间运行时，打开过的会话全部常驻，堆持续增长，GC 停顿拖慢切换和新建。
- 来源与基线：`dsh-v0.2.1-rc.4`（`504a01a`）。本地新增 `packages/api/session-controller/src/idle-release.ts`，修改同包 `index.ts`（配置项、装配、释放时的列表事件）、`history.ts`（follow 计数）、`lifecycle.ts`（`releasingIds`、`retained()`）、`tsconfig.host.json`、README 与 `docs/config-catalog*.md`；`packages/bundle/base/cordis.patch.yml` 给 `session-query-sqlite` 加 `preparedSessionCacheSize: 1`（上游默认 5）。位置标记见 `src/shared/harness-desktop-forks.js`。
- 上游提供等价的驻留管理后，改用上游实现并删除本地文件。

## Allowed touch

- `vendor/deepseek-harness/packages/api/session-controller/src/idle-release.ts` — 释放策略与常驻条件
- `vendor/deepseek-harness/packages/api/session-controller/src/{index,history,lifecycle}.ts` — 装配、follow 计数、句柄遍历

## Do not touch

- follow 后的后台激活（打开即可发送）
- 删除会话的 `api-session/removed` / 删除流程

## Gates

| Kind | What |
| --- | --- |
| Automated | `npx vitest run packages/api/session-controller/tests/idle-release.host.spec.ts`（在 `vendor/deepseek-harness`）；`node --test src/shared/harness-desktop-forks.test.js` |
| Manual / QA | 隔离测试实例（独立 user-data-dir，导入会话副本，`profiles/web/cordis.patch.yml` 临时把 `session-controller` 的 `idleReleaseMs` 调短）：依次打开大会话后切走，宿主堆回落；切回会话内容完整；侧栏条目不消失 |

## Sources

- Implementation entry: `vendor/deepseek-harness/packages/api/session-controller/src/idle-release.ts`
- 配置说明：`vendor/deepseek-harness/packages/api/session-controller/README.zh.md#configuration`
