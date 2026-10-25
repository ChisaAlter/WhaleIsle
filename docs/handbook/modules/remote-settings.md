# 远程设置（Settings → Remote）

连接方式为「局域网 / 服务器」，未设置时默认服务器（`relay`）。局域网保留为手动选项；默认模式不自动开启远程配对。

设置分区 `remote` 承载连接方式、网关高级项与**桌面内置** IM 渠道（`vendor/dsh-im`）；侧栏手机弹窗只负责开关、设备与扫码配对。产品契约见 [Feature: remote-settings](../../features/remote-settings.md)，配对网关见 [手机远程](mobile-remote.md)。

桌面二维码使用短期一次性凭证，到期或使用后自动补发；「复制链接」使用独立长期配对凭证，不受二维码刷新和应用重启影响。可显式撤销旧链接并生成新链接，既有已配对设备保持有效。启动与断线状态留在二维码区域，旧 daemon 的迟到事件不能覆盖当前进程的中继状态。

网关“监听端口”修改 loopback daemon 的真实端口（默认 6767）；LAN 配对静态页另用 3180。“监听范围”约束该静态页，包含严格的仅本机选项，配对 URL 和快照使用相同地址。传输加密一行只说明当前协议边界：手机会话端到端加密、中继 TLS 随中继主机配置、LAN 静态页 HTTP；没有独立的 LAN TLS 单选控件。畸形 HTTP URL、Host 和编码在静态页请求边界返回 400。

## 结构

| 标签 | id | 所有者 |
| --- | --- | --- |
| 网关 | `gateway` | `ui-settings-remote` |
| 消息渠道 | `channels` | 桌面内置 `@xmanrui/dsh-im`（`dsh-im-desktop.js`，不再软预置拷贝） |

加载入口：`src/main/dsh-im-desktop.js` → 桌面自有 overlay `desktop-plugins/dsh-im/desktop-dsh-im.patch.yml`（包名 insert，每次启动经 `--patch` 传，全量 + skip）+ `node_modules` junction 到 `vendor/dsh-im`；用户的 `cordis.patch.yml` 只做遗留受管块 strip（迁移），绝不写回。禁用名单不适用（config 归一化剔除别名；`shell:disable-plugin(s)` 返回 `desktop-builtin`）。缺依赖挡 `dsh web` 启动（skip 修不了）。市场同名包 `DROPPED`（家族 basename 匹配）。

## 公网部署

- `ayase.cn` 通过 Cloudflare，当前源站为 `94.103.170.66`；公网 SPA 为 `https://ayase.cn/dshd/`。旧 `38.76.185.154` 仅为历史部署地址。
- TLS relay：客户端与 daemon 使用 `ayase.cn:443`，nginx 仅把精确 `/ws` 与 `/health` 转给 `dshd-relay:8787`，其余站点路由不变。
- VPS runtime：`/opt/dshd-relay` Docker Compose，状态持久化在 `/opt/dshd-relay/data`，容器健康检查访问内部 `/health`，重启策略为 `unless-stopped`。
- Web 资产位于 `/opt/baiying-studio-site-20260714-1205/dshd/`，由 `newapi-proxy` 挂载提供。静态更新校验 runtime manifest 后原子交换目录，旧版保存在 `/opt/dshd-relay/web-releases/<版本>/previous`；不需要重启中继。live nginx 与站点候选配置都保留 `DSHD_REMOTE_BEGIN/END` 块，避免后续站点部署覆盖远程路由。源站使用 `no-cache`，Cloudflare 的静态资源缓存另按实际响应检查。
- 2026-10-25 已发布手机 Web 版本 `e09d44045b`：公网 50 个资源与 runtime manifest 的 SHA-256 一致，浅深入口实看通过，真实 daemon + 公网 SPA + TLS relay 的配对、重复使用、撤销与重连 5 项通过；本轮未复测 Harness 会话目录和消息发送。旧版位于 `/opt/dshd-relay/web-releases/20261025-e09d44045b/previous`。桌面配对逻辑与 Android UI 需各自更新客户端，静态页发布不替代客户端升级。
- 2026-10-25 22:00（北京时间）追加发布锚定菜单 Web 版本 `d96188b995`：模型菜单改为按钮上方、右边对齐；公网 50 个实际入口及模块 URL 的 SHA-256 一致，已部署页面配合受控模型目录的 11 项定位/返回/焦点/审批接管检查通过。旧版位于 `/opt/dshd-relay/web-releases/20261025-anchored-menus/previous`，中继与 nginx 配置未改。本次只验证菜单呈现，不重复认证真实配对或发送；Android 同步源码改动尚未发布安装包。
- 历史迁移记录见 [2026-09-08 部署报告](../../qa/results/2026-09-08/remote-ayase-deployment.md)。凭据不得写入仓库、报告或容器配置。
