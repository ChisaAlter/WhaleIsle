# 模块：安全模型（威胁模型）

## 职责与非目标

**职责：** 一页记录当前代码的资产、信任边界、各边界的强制点与对应测试文件，让已实现的安全姿态可被查找。
**非目标：** 不新增流程、清单或审批要求；不写规划中的控制；不代替 [Preload 与 IPC](ipc-preload.md)、[启动与 Harness 生命周期](boot-lifecycle.md)、[手机远程](mobile-remote.md) 的模块职责，细节以各模块页为准。

## 资产

| 资产 | 存放与保护 |
| --- | --- |
| API Key / GitHub token / 远程配对凭据 / 设备凭据 | 集中在 `credentials.json`（`app.getPath('userData')` 下）：`src/main/config.js` 的 `credentialsPath()` / `readCredentials()` / `writeCredentials()`。OS 钥匙串可用时整树经 `safeStorage` 加密信封（`safeStorage-v1:` 前缀）落盘，否则明文 JSON；写入统一走 `writeJson` → `src/shared/fs-safe.js:atomicWriteFileSync`，模式 `0o600`。渲染侧只拿 `publicConfig()` 遮蔽投影（`apiKey` / `githubToken` 显示 `********`，远程令牌与 `remoteDevices` 清空）。测试：`src/main/config-credentials.test.js`、`src/main/config.test.js`、`src/main/config-cache.test.js`。 |
| 工作区文件 | 只允许落在授权根内：`src/main/workspace-authority.js:createWorkspaceAuthority`（`resolveAuthorizedCwd` / `resolveInside` / `containedIn` 拒绝越界、`.git` 元数据与高风险锚点），`src/main/workspace-fs.js` 的 `canonicalInside` / `readFile` / `writeFile` / `listDir` 执行真实路径校验。测试：`src/main/workspace-authority.test.js`、`src/main/workspace-fs.test.js`。 |
| 会话与历史 | 存于桌面 Harness 家目录 `userData/dsh-home`：`src/shared/dsh-home.js` 的 `desktopDshHomeFromUserData` / `applyDesktopDshHome`；打包构建屏蔽继承的 `DSHD_HOME`（`sanitizePackagedDshHomeEnv`，仅 `DSHD_ALLOW_ENV_HOME=1` 放行）。测试：`src/shared/dsh-home.test.js`。 |
| 已配对设备 | 设备令牌由 vendored `RelayDeviceCredentialStore` 落盘在 ChisaCode 家目录；渲染侧只见 `DshdRemote.snapshot` / `publicDevicesFromStore` 投影（不含 secret）；旧 config 的 `remoteDevices` 经 `publicConfig()` 清空。测试：`src/main/dshd-remote.test.js`（快照投影）；store 本身由 vendored `vendor/chisacode-remote/packages/server/src/server/relay-device-auth.test.ts` 覆盖（不在本仓 `npm test` 范围）。 |
| 内部控制令牌 | `DSH_DESKTOP_INSTALL_TOKEN`（`src/main/desktop-install-control.js:startDesktopInstallControl`，每启动 `crypto.randomBytes(32)`）、`DSHD_TASK_CONTROL_TOKEN`（`src/main/task-protection.js:taskControlToken`）、`DSHD_PLATFORM_TOKEN`（`src/main/platform-session.js:platformToken`）均为进程级随机、只在内存；git tunnel 令牌（`src/main/dshd-git-tunnel.js:startGitTunnelServer`）与 harness cookie（`dsh.sessionCookie`，probe 自 `dsh web`）同信道下发。外部桌面握手用 `task-control-peer.json`（`src/main/task-control-peer.js:createTaskControlPeer`，原子落盘 userData）。测试：`src/main/internal-secrets.test.js`、`src/main/task-control-plugin.test.js`。 |

## 渲染进程 ↔ 主进程

- **沙箱面**：BrowserWindow / WebContentsView / `<webview>` 来宾一律 `sandbox: true, contextIsolation: true, nodeIntegration: false`：`src/main/window.js`、`src/main/browser-guests.js`、`src/main/platform-view.js`、`src/main/preview.js`、`src/main/preview-session.js`、`src/main/preview-file-window.js`、`src/main/update-overlay.js`、`src/main/magpie-window.js`（38px 壳窗 preload 仅用于本机 `magpie-shell.html`，内容 `WebContentsView` 采用 `persist:magpie` 零注入且无 preload、仅放行本机 loopback 并拦截外部导航转交系统浏览器）、`src/main/desktop-pet.js`、`src/main/desktop-live2d.js`、`src/main/html-preview.js`、`src/main/composer-official-qa.js`、`src/main/welcome-window.js`。欢迎窗 preload 未打包但保持自包含：语言表经 `dsh-welcome:locale`（sendSync bootstrap，`assertSender` 只认本窗 mainFrame）传入而非本地 `require`；内容面仍是静态 `file://` 文档、`welcome.html` 带 `default-src 'none'` 的 CSP、`will-navigate` 一律 `preventDefault`、`setWindowOpenHandler` 一律 deny。议题 #509。通道注册经 `src/shared/ipc-contract.test.js` 覆盖。测试：`src/preload/shell-api.test.js`（preload 自包含、按角色暴露）、`src/preload/welcome.test.js`、`src/main/window-nav.test.js`。
- **preload 暴露面**：`src/preload/index.js` 按角色（boot / launcher / harness / pet / update-* / welcome）只暴露 `window.shell` 子集，不挂 Node 能力。测试：`src/preload/shell-api.test.js`。
- **单一注册路径**：`src/main/ipc-register.js:registerIpc` / `mount`；通道必须先在 `src/shared/ipc-contract.js:IPC_CONTRACT` 声明（`kind` / `roles` / `validate` / `authorize`），未声明注册即 throw；handler 前先跑 `row.validate` 参数校验与授权，失败不进入 handler。测试：`src/shared/ipc-contract.test.js`、`src/main/ipc-register.test.js`。
- **角色授权**：`src/main/ipc-authorization.js` 的 `ipcSenderRole` / `assertIpcSender`——只认 `senderFrame === mainFrame`，页面 URL 必须命中该角色的导航策略（boot / launcher / harness 各表）；`channel-owned` 行逐 sender 检查页面 URL。测试：`src/main/ipc-authorization.test.js`、`src/main/local-url.test.js`、`src/main/local-url.fuzz.test.js`。
- **双向契约测试**：`src/shared/ipc-contract.test.js` 保证：实际挂载的通道全部声明、每个 preload 通道在两个方向（注册与暴露）一致、surface/role 一致、所有 `webContents.send` 目标通道有 `event` 行。
- **静态门槛**：ESLint `whaleisle/ipc-via-register`（禁契约外注册）、`whaleisle/ipc-channel-contract`（字面量通道必须在契约表）、`whaleisle/ipc-handler-reads-event`，见 `eslint.config.mjs` 与 `scripts/eslint-rules/`。
- **外部打开**：`src/main/open-external.js:openExternalHttp` 只放行 `http:` / `https:` 到系统浏览器。无测试（议题 #510）。

## Harness ↔ 桌面控制面

- **令牌下发信道（#427）**：`src/main/dsh.js` 在 `web` host 启动时置 `DSHD_INTERNAL_SECRETS_VIA_STDIN=1`，用 `src/shared/secret.js:passSecretToChild` 把 `DSH_DESKTOP_INSTALL_TOKEN` / `DSHD_TASK_CONTROL_TOKEN` / `DSHD_PLATFORM_TOKEN` 逐行写进子进程 stdin，以 `internal-secrets-end` 收尾；`src/main/dsh-cli-runner.mjs` 在 import CLI / 加载插件之前 `collectInternalSecrets`；`src/shared/secret.js:storeInternalSecrets` 存入 `globalThis[Symbol.for('whaleisle.internalSecrets')]` 的只读密钥视图——仅暴露 `get(name)`，底层 Map 不落地、同进程代码无法经视图改写条目（#514，复审 F3），**不写回 `process.env`**。只有桌面自起的 `web` host 走此信道；外部 `dsh` / `npx` 宿主拿不到令牌，控制面对其 fail closed。测试：`src/main/internal-secrets.test.js`（真实进程链、env 与 `/proc/<pid>/environ` 干净）、`src/main/internal-secret-accessors.test.js`、`src/shared/secret.test.js`。
- **控制面服务器**：`src/main/desktop-install-control.js:startDesktopInstallControl` / `createHandler`——只绑 `127.0.0.1`，Bearer 经 `src/shared/secret.js:constantTimeEqual`（先 SHA-256 再 `crypto.timingSafeEqual`）；请求体 `readBodyLimited`，常规上限 64 KiB（`/desktop/html-preview` 例外 52 MiB）。测试：`src/main/desktop-install-control.test.js`、`src/shared/secret.test.js`。
- **`/desktop/confirm`**：`desktop-install-control.js` 的 `handleDesktopConfirm` + `requestModelAction` / `confirmForRequest`——`confirmChain` 串行化；接受 `true` / `'once'` / `'always'`，`'always'` 只进 run-scoped `sessionAllowed`（工具+动作+scope 键——whale_desktop_config 记排序后的敏感键集合、凭据键写按 destructive 永不记忆——不落盘、不跨启动）；级别取 `src/shared/model-tool-effects.js:effectOf`，未注册工具与已注册工具的未登记 action 按 `code` 处理，`destructive` 与 `code` 在 `NEVER_ALWAYS_LEVELS` 中永远不进 `sessionAllowed`（每次都确认）；confirmer 缺失或抛错一律 fail closed，断连后迟到的批准不执行。测试：`src/main/model-tool-effects.test.js`（拒绝路径逐工具）、`src/main/desktop-install-control.test.js`。
- **任务控制对端**：`src/main/task-control-peer.js`——loopback-only、Bearer `constantTimeEqual`、请求体 16 KiB。测试：`src/main/task-control-plugin.test.js`。
- **Host RPC 隧道**：`src/shared/dshd-host-tunnel.js:forwardHostRpc`——`HOST_RPC_METHODS` 方法白名单 + `assertLoopbackHarnessOrigin`（只收 loopback `http(s)`）；harness cookie 经 stdin `harness-cookie` 下发。测试：`src/shared/dshd-host-tunnel.test.js`。

## 插件

- **模型发起的安装/变更需桌面确认（#413）**：`desktop-install-control.js` 的 `handleInstall`（`/install`）与 `handleDesktopPlugin`（`/desktop/plugin`）在 install / remove / enable / disable 前过 `confirmForRequest`；spec 校验 `src/host/install-dsh-plugin-client.js:isValidGithubSpec` 与 `src/main/marketplace-spec.js:isAllowedMarketplaceSpec`，`allowBuilds` 白名单 `src/main/marketplace-allowbuilds.js:parseAllowBuilds`。渲染器侧市场安装是用户发起的 UI 流（`src/main/marketplace-install.js`），不走模型确认通道。测试：`src/main/desktop-install-control.test.js`、`src/main/marketplace-install.test.js`、`src/main/model-tool-effects.test.js`（拒绝路径）。
- **插件读令牌方式**：只能 `internalSecret(name)`——`vendor/dsh-shared/lib/internal-secret.mjs` 与各插件就地副本（CJS 侧 `src/shared/secret.js`），无 `process.env` 回退；子进程环境里只有 `DSH_DESKTOP_INSTALL_URL`（URL，非凭据）。测试：`src/main/internal-secret-accessors.test.js`（全副本同契约、fail closed 语义一致）。
- **vendor 来源登记**：`vendor/provenance.json` 逐树声明 kind（`source` / `pinned` / `rebuild` / `hashed` / `artifacts`）；`npm run check:vendor` → `scripts/check-vendor-provenance.mjs` 核对声明与实树一致：`rebuild` 在临时目录重构建逐字节比对，`hashed` / `artifacts` 按登记哈希核验文件集。测试：`scripts/check-vendor-provenance.test.mjs`。

## 模型

- **工具效果分级**：`src/shared/model-tool-effects.js` 的 `TOOLS` / `ENDPOINTS` / `LEVELS`（`read` / `local` / `destructive` / `external` / `code` / `harness-governed`）。扫描测试保证所有已注册模型工具在表内、无陈旧项、高风险项必有确认路径（`confirm: true` / `'keys'` / `'endpoint'`）。测试：`src/main/model-tool-effects.test.js`。
- **模型 shell 拿不到内部令牌**：令牌不进环境变量，宿主后代进程（模型起的 shell / MCP / LSP）默认继承不到。测试：`src/main/internal-secrets.test.js`（断言 stub CLI 的 env、子孙进程 env、Linux `/proc/<pid>/environ` 均无令牌）。
- Harness 侧另有 vendored 审批层（`shell:set-approval-mode` 等），桌面确认在其之上的 `/desktop/confirm` 串行把关；vendored 层细节不属于本页范围。

## 远程设备与中继

- **ChisaCode daemon**：`src/main/dshd-remote.js:DshdRemote` 管理生命周期（默认关闭，启用才启动）；vendored `createChisaCodeDaemon` 只在子进程 `src/main/dshd-daemon-runner.mjs` 运行，主进程零 vendored import；hooks 见 `src/main/dshd-daemon-hooks.mjs`。daemon 绑 loopback `127.0.0.1`（`daemonListen`，默认 6767 或 `remotePort`），loopback 配置 `auth: {}`（上游要求非 loopback 必须 auth）、`corsAllowedOrigins: []`。测试：`src/main/dshd-remote.test.js`、`src/main/dshd-daemon-runner.test.js`、`src/main/dshd-daemon-hooks.test.js`。
- **配对 offer v2**：`DshdRemote.generatePairing` / `refreshPairing` 经 vendored pairing-offer 生成一次性短时 bootstrap token；offer 放 URL fragment（`#offer=`，不发送到服务器）；`RelayPairingLinkStore` 提供可吊销持久链接，`revokePairingLink` → `store.revoke()`；`rotateToken` 只刷新配对码、不影响已配对设备。测试：`src/main/dshd-remote.test.js`（`ensurePairing` / `rotateToken` / `revokePairingLink`）。
- **E2EE**：中继按设计不可信——`vendor/chisacode-remote/packages/relay/src/encrypted-channel.ts`（`e2ee_hello` / `e2ee_ready`、Curve25519 ECDH、Poly1305 鉴别、防重放）+ `packages/server/src/server/relay-transport.ts`；威胁细节见 vendored `SECURITY.md` / `public-docs/security.md`。加密层测试为 vendored `encrypted-channel.test.ts`、`relay-transport.e2e.test.ts`（vitest，不属本仓 `npm test`）；桌面侧无测试。
- **设备撤销**：`DshdRemote.unbindDevice` → `RelayDeviceCredentialStore.revokeDevice`（文件存储，重开生效）；`renameDevice` 同落盘、拒已吊销设备。测试：`dshd-remote.test.js` 覆盖 `unbindDevice`（桌面侧吊销后新开 store 拒绝该凭据的重连 proof 与 secret 认证）与 `renameDevice`；vendored `relay-device-auth.test.ts` 覆盖 store 本身。
- **静态页 / LAN 风险**：`src/main/mobile-web-server.js` 在 `remoteBindAddress`（默认仅本机）+ 3180 供 SPA；`src/main/mobile-web.js:resolveSpaAsset` / `safeJoin` 防目录穿越、NUL 与 `.test.js` 泄露。静态页本身是明文 HTTP——LAN 模式只适合可信网络，见 [mobile-remote.md](mobile-remote.md)。测试：`src/main/mobile-web-server.test.js`、`src/main/mobile-web.test.js`。
- **git tunnel**：`src/main/dshd-git-tunnel.js:startGitTunnelServer`——仅 loopback（显式拒非 loopback 客户端 socket）、`x-dshd-git-token` 经 `constantTimeEqual`、请求体 1 MiB；操作白名单 `src/main/dshd-git-dispatch.js`（`GIT_TUNNEL_ACTIONS` / `dispatchGitTunnel`）。测试：`src/main/dshd-git-tunnel.test.js`、`src/main/dshd-git-dispatch.test.js`。
- **v1 HTTP 中继已删除（#445）**：`RemoteGateway`、`RelayClient`、`RelayServer` 及其手机端 host 模块、v1 offer/帧/鉴权/设备辅助与桌面 remote-shell 网关已从仓库移除；产品远程只有上面的 ChisaCode daemon 路径。

## 外部内容

- **壁纸下载 SSRF**：`src/main/wallpaper-catalog.js`——`parseHttpUrl` 拒非 `http(s)` 与内嵌凭据；`isBlockedWallpaperHost` / `isBlockedIpv4` / `ipv6EmbeddedIpv4` 按解析后 IP 拒私网 / 回环 / 保留段；`assertResolvedWallpaperHost` 在 DNS 解析后复查并返回已校验记录，`fetchBuffer` 用每请求 dispatcher（bundled undici Agent 自定义 `connect.lookup`）把连接固定到这些地址——无二次解析，DNS rebind 窗口关闭，SNI/Host 仍取 URL 主机名；手动重定向逐跳重检（上限 4）、`credentials: 'omit'`、`readLimitedBody` 字节上限与超时。测试：`src/main/wallpaper-catalog.test.js`、`src/main/wallpaper-catalog.fuzz.test.js`。
- **Mermaid SVG**：`src/whale-ui/genui/client/mermaid-safe.ts:assertSafeSvg`（#492，由 `mermaid-core.ts:renderMermaid` 在注入前调用）——元素白名单按 mermaid 11 实际输出核对；默认 `htmlLabels` 把标签文本渲染在 `foreignObject` 内（journey 即使关闭 htmlLabels 也会产出），故 `foreignObject` 及其内 XHTML 标签词汇（`div` / `span` / `table` / `input` 等）在白名单内，但子元素同样过表——`script` / `iframe` / `object` / `embed` / `audio` / `video` / `form` / `meta` / `link` / `math` / SMIL 均不在表、一律拒；另禁 `on*` 事件属性、URL 属性只放行同文档 `#` 片段（远程 `http(s)` 一律拒，#507——白名单图种的真实输出不引用外部资源；普通 Markdown 渲染放行远程图片是 vendored `ui-primitives` 的有意行为，见 `render.tsx:remoteImageUrl`）、CSS 危险构造与外链 `url()` 检查、拒处理指令与 DTD。测试：`src/whale-ui/genui/client/mermaid-safe.fuzz.test.js`。
- **Loopback / 导航判定**：`src/main/local-url.js`——`isLoopbackHttpUrl`（精确回环集、拒 userinfo）、`isSameOriginLoopbackUrl`、`isLocalAppNavigationUrl` / `isLauncherNavigationUrl`、`shouldAllowPrivilegedNavigate` / `shouldAllowPrivilegedRedirect`，用于窗口导航守卫与 IPC sender 角色判定。vendored 侧同策（#506）：`vendor/deepseek-harness/packages/client/ui-user-terminal/src/client/links.ts` 的 `isLoopbackHttpUrl` 同样拒 userinfo，带内嵌凭据的回环形态 URL 不再进内置 Browser surface，改交系统浏览器；该分叉登记于 `src/shared/harness-desktop-forks.js`。测试：`src/main/local-url.test.js`、`src/main/local-url.fuzz.test.js`、`src/main/window-nav.test.js`；vendored `tests/links.client.spec.ts`。
- **更新包校验**：`src/main/update.js`——`SHA512SUMS.txt`（`CHECKSUM_ASSET_NAME`）先于传输解析、`verifyAssetChecksum` / `verifyFileChecksum` 全文件 SHA-512 通过才可安装；`.part` 部分文件同样要求校验通过；`isGithubHost` 限定 `Authorization` 只发 GitHub 主机（token 不随签名 CDN 重定向）；`src/main/download-path.js:sanitizeDownloadFilename` / `downloadSavePath` 文件名净化与逃逸检查。测试：`src/main/update.test.js`、`src/main/update-updater.test.js`、`src/main/update-resume.test.js`、`src/main/update-recovery.test.js`、`src/main/download-path.test.js`。
- **electron-updater 差分**（完整包自更新的下载路径）：`src/main/update-updater.js`——`assertConfirmedTarget`（版本与 asset origin/path 必须与已确认检查一致、`fileInfo.packageInfo` 拒绝）、`prepareDifferentialBase`（只取已验 SHA-512 的安装器做基、`pending.fileName` 必须是 basename）、`bindUpdaterRequests`（range 响应逐字节匹配、>400 失败、超范围拒绝）、`strictNsisUpdaterClass`（delta 渠道禁整文件替换）。测试：`src/main/update-updater.test.js`。
- **launcher 增量包**（`shell:install-delta`，给已注册运行时目录打补丁的另一条 lane）：`src/launcher/delta/install.js:installDelta` 只限 launcher 包且需已注册安装，从 release 资产中挑 `<product>-delta-<from>-<to>.zip`、无 `SHA512SUMS` 即 `delta-unverified` 拒绝，下载后 `src/launcher/delta/apply.js:applyDeltaFile` 先验整包 SHA-512；`launcher-service.js:installDeltaOp` 的 `beforeApply` 在写目标前做受保护停机。manifest 规则在 `src/launcher/delta/manifest.js`：`isSafeRelPath` 拒 `\`、`:`、`.` / `..`、控制字符、Windows 设备名、段尾点/空格；`validateManifest` 按 Windows 语义（NFC + 小写）去重并拒路径互为祖先的冲突。apply 侧 `resolveTarget` 在 resolve 后再拦越界、`preflightBase` 对 patch/delete 逐文件预检基座 SHA-256（漂移即 `base-mismatch`，未写一字节即中止）、payload 逐条 SHA-256 验后进同卷 staging、rename 提交且失败回滚（`apply-failed`，不留半成品树）。测试：`src/launcher/delta/delta.test.js`、`src/launcher/delta/manifest.fuzz.test.js`、`src/launcher/delta/zip.fuzz.test.js`、`src/launcher/delta/install.test.js`。
- **发布流水线 Node 校验**：`scripts/after-pack.js`——`verifyNodeDistArchive`（对照官方 `SHASUMS256.txt` 的 SHA-256）、`probeBundledNode`（`--version` 精确匹配）、`nodeBinaryHasExternalDylibs` / `probeNodeDylibListing`（拒外部动态库依赖）、`bundledNodePinnedVersion`（`.nvmrc`）。测试：`scripts/after-pack.test.mjs`。

## 残余风险（已知、未处理）

- **同用户进程可读 host 进程内存中的内部令牌**（Windows 上尤为直接）：stdin 信道只收缩环境继承面，不防同权限内存检查；见 [boot-lifecycle.md](boot-lifecycle.md)。不建议题（平台限制）。
- **普通 Markdown 渲染放行远程 `http(s)` 图片**（vendored `ui-primitives` `render.tsx:remoteImageUrl`，上游有意行为）：模型可在回复中嵌入远程图片，出网请求可被用于跟踪。Mermaid 侧已收紧为仅 `#` 片段（#507）。
- **LAN 静态页是明文 HTTP**：产品取舍，LAN 模式只适合可信网络；见 [mobile-remote.md](mobile-remote.md)。

## 实现入口

- `src/shared/{secret,ipc-contract,dsh-home,relay-auth,fs-safe,dshd-host-tunnel,cleartext-base-url,official-deepseek-env,model-tool-effects}.js`
- `src/main/{config,ipc.js,ipc-register,ipc-authorization,local-url,workspace-authority,workspace-fs,dsh,dsh-cli-runner.mjs,desktop-install-control,task-protection,task-control-peer,platform-session,dshd-remote,dshd-daemon-runner.mjs,dshd-daemon-hooks.mjs,dshd-git-tunnel,dshd-git-dispatch,mobile-web,mobile-web-server,wallpaper-catalog,update,update-updater,download-path,open-external,remote-tls,marketplace-install,marketplace-spec,marketplace-allowbuilds}.js`
- `src/preload/index.js`、`src/whale-ui/genui/client/{mermaid-safe,mermaid-core}.ts`、`src/host/install-dsh-plugin-client.js`
- `src/launcher/launcher-service.js`、`src/launcher/delta/{install,manifest,apply,zip}.js`
- `scripts/{check-vendor-provenance.mjs,after-pack.js}`、`vendor/provenance.json`

## 门槛

- `npm run lint`（IPC ESLint 规则属静态门槛）；`npm test` 覆盖上列测试文件。

## 延伸阅读

- [ipc-preload.md](ipc-preload.md)、[boot-lifecycle.md](boot-lifecycle.md)、[mobile-remote.md](mobile-remote.md)、[remote-settings.md](remote-settings.md)、[dsh-home.md](dsh-home.md)
- vendored：`vendor/chisacode-remote/SECURITY.md`、`vendor/chisacode-remote/public-docs/security.md`
