# Agent Note: Host install_dsh_plugin 控制通道

Status: implemented

[English](2026-08-15-marketplace-draft-install.md) | 中文

## 问题

会话里安装 GitHub 插件的工具必须走桌面安装器：SHA 锁定、DROPPED、pnpm shim、`allowBuilds` 和 Harness 重启。没有 Host 工具时，模型会自己编 `dsh plugin add`，并漏掉这些细节。

浏览器里的 `dsh web` 没有 Electron 安装器。设置页目录安装是另一条路径，不走本通道。

## 决策

仅桌面使用的 Host 插件被复制到 `$DSH_HOME/profiles/web/desktop-plugins/install-dsh-plugin/`，并由一段托管的 `cordis.patch.yml` 块插入，注册 `install_dsh_plugin`（`spec`，可选 `allowBuilds[]`）。execute 向 Electron 在 `127.0.0.1` 上用随机端口和 bearer token 启动的回环控制服务器 POST；`DSH_DESKTOP_INSTALL_URL` 经环境变量注入 Harness 子进程，`DSH_DESKTOP_INSTALL_TOKEN` 经 host stdin 密钥通道下发至进程内存储、不进入 `process.env`（#427）。处理函数包装现有 `installPlugin`（SHA 锁定、DROPPED、pnpm shim、`allowBuilds`）。两层都在任何东西到达 `pnpm add` 之前用 `isValidGithubSpec`（`github:owner/repo[#ref]`）校验规格：工具端在客户端返回结构化失败，控制端点回答 400 且绝不调用 `installPlugin`。`needsAllowBuilds` 是规范工具返回值，不是抛出的失败。成功安装的 HTTP 200 返回后，Electron 等待约 500ms 再重启 Harness，以便 `tool/result` 先落盘；这段延迟是固定的宽限期而不是 ACK——比延迟更慢的 tool/result 会被截断，这一点被接受，而不是引入一套重启协议。该插件不进入官方 web-app 组合包。

IPC `shell:install-plugin` 留给其他桌面调用方；控制通道在进程内调用 `installPlugin`。设置页市场安装调用 `installMarketplacePlugin(id)`，不预填输入草稿，也不调用 `installPlugin`；那条路径见[桌面插件市场精选目录](2026-08-18-desktop-marketplace-curated-catalog.zh.md)。

## 曾考虑的替代方案

**让 Host `install_dsh_plugin` 走设置页一键 IPC。** 对本通道否决：Host 工具是经回环控制服务器的会话安装器。设置页目录一键安装见[桌面插件市场精选目录](2026-08-18-desktop-marketplace-curated-catalog.zh.md)。

**只预填输入草稿、不提供 `install_dsh_plugin`。** 否决：SHA 锁定、pnpm shim、`allowBuilds`、DROPPED 和重启都是桌面安装器细节，模型无法用 bash 稳定复现。

**把该工具放进官方 web-app 组合包。** 否决：浏览器里的 `dsh web` 没有 Electron 安装器；Host 工具在那里只会空转或撒谎。profile patch 由桌面端拥有。

## 后果

Host `install_dsh_plugin` 仍只接受 github。设置页目录安装不走本通道。`#path:`、npm 包名、tarball 和本地路径在两层都失败关闭，到不了 `pnpm add`。

## 测试

`src/host/install-dsh-plugin-client.test.js` 钉住 `isValidGithubSpec` 和 `needsAllowBuilds` 文案。`src/main/desktop-install-control.test.js` 钉住：控制服务器先响应再重启；`needsAllowBuilds` 不重启；非 `github:` 规格、非法 `allowBuilds`、缺失 bearer 和非法 JSON 都失败关闭且不触发安装器；`spawnEnv` 收到回环 URL 与 token。`src/main/plugins.test.js` 钉住 profile 复制和 `install_dsh_plugin` 注册。

## 相关

- [桌面插件市场精选目录](2026-08-18-desktop-marketplace-curated-catalog.zh.md)
