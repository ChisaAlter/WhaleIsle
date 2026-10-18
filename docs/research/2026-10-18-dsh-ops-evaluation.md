# dsh-ops 项目评估：适合作为可选插件与参考实现，不宜直接并入 Whale Isle

日期：2026-10-18  
研究对象：<https://github.com/T-Auto/dsh-ops>  
研究基线：`main` HEAD [`9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd`](https://github.com/T-Auto/dsh-ops/commit/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd)，读取于 2026-10-17/18。基线中的 `package.json` 与 manifest 版本为 `0.3.1`；因此下文讨论的是该提交的源码和文档行为，不把 npm 或 GitHub Release 的“最新”当作代码事实。

## 结论先行

**建议 Whale Isle 先把 dsh-ops 当作可选的外部 DSH 插件和源码参照，不要把它的源码、Rust worker 或 shell 载荷直接复制进 Whale Isle 主仓库。**

理由很具体：

1. **值得借鉴的内核已经清楚。** 它把文件操作和 PTC 批处理收敛成严格 schema、有限输出、CAS revision、no-follow 路径与结构化错误；Rust worker 通过 DSH 的 `sandboxPolicy`、`sandbox`、`subprocess` 执行，缺少隔离时失败关闭。[file contract](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/lib/file/contract.js#L1-L114) · [worker bridge](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/lib/ptc/worker.js#L15-L99) · [native dispatch](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/native/src/lib.rs#L52-L95)
2. **集成耦合比 README 的“低侵入”更深。** 插件依赖 DSH/Cordis v1alpha1 的 host/tool contract，依赖每会话权限、沙箱和子进程服务；Windows shell 还通过固定的 `pwsh-sandbox` loader 行临时覆盖 `pwshPath`。[manifest](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/dsh-plugin.json#L1-L37) · [PowerShell overlay](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/lib/session-pwsh.js#L1-L39) · [DSH version pins](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/package.json#L116-L150)
3. **发布与运行时闭包不应由 Whale Isle 另起一套。** 主包带原生 worker receipt、Windows Bash IPC、可选的 PortableGit/PowerShell payload；发布矩阵只覆盖 `win32-x64`、`linux-x64`、`darwin-arm64`，而 Release workflow 当前被仓库级 `disabled_manually` 关闭，npm 发布仍是维护者本机流程。[runtime matrix](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/lib/ptc/runtime.js#L1-L114) · [package payloads](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/package.json#L81-L114) · [release status](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/docs/release-process.md#L1-L18)
4. **Whale Isle 已有正确的接入边界。** Whale Isle 把桌面 DSH home 隔离在 `userData/dsh-home`，市场插件进入 `dsh-home/profiles/web`，并由现有安装器做 profile 快照、可加载入口校验与失败回滚。[Whale Isle DSH home](../handbook/modules/dsh-home.md) · [Whale Isle plugin install/rollback](../../src/main/marketplace-install.js#L517-L667) 因此优先走“现有 profile 安装 → 重启/加载 → 真实工具验收”，而不是复制包到 `vendor/deepseek-harness` 或把它当成内置组件。

> **事实 / 推断标记**：下文“事实”均可在固定提交、仓库文档或 Whale Isle 当前源码中定位；“推断”是基于这些事实对集成决策的判断。此次只做源码与文档研究，没有执行 dsh-ops 的 DSH runtime，也没有改动 Whale Isle 产品代码。

## 1. 项目定位与当前边界

### 已确认事实

- README 将项目定位为 DSH 的底层工具插件：用 Rust 文件工具、`ops_bash` 和 PTC 工具降低工具描述/结果的 token 与时间开销；DOC/PDF、Web 搜索、HTML-to-Markdown 等仍在 roadmap，当前版本未提供。[README](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/README.en.md#L22-L35)
- `package.json` 的包名/版本是 `dsh-ops@0.3.1`；声明 `win32`、`linux`、`darwin` 与 `x64`/`arm64` 的粗粒度 npm 平台过滤，但代码实际 runtime 白名单只有 `win32-x64`、`linux-x64`、`darwin-arm64`。[package metadata](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/package.json#L1-L32) · [runtime whitelist](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/lib/ptc/runtime.js#L6-L8)
- DSH peer 依赖范围是 `@deepseek-ai/dsh ^0.2.0-rc.2`、`@deepseek-ai/cordis ^4.0.4`；开发/测试依赖把一组 DSH 包锁在 `0.2.0-rc.2`；Node 要求 `^22.19 || >=24`。[package dependencies](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/package.json#L116-L150)
- README 明确承认 97% token reduction 只来自“完整、明确、具体的复杂任务”场景；严谨 benchmark 与具体测试计划尚未随当前版本交付。[benchmark caveat](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/README.en.md#L37-L40)

### 对 Whale Isle 的判断

**推断：** dsh-ops 的产品价值在“高频仓库操作的工具契约与结果压缩”，不是一个可独立替换 Whale Isle DSH 内核的执行平台。Whale Isle 若要采用，应先验证真实会话的工具发现、权限变化、取消/重载和打包运行；不能先按 README 的 token/速度宣传做内置产品承诺。

## 2. 架构与入口

### 声明层

- `dsh-plugin.json` 使用 manifest `0.15`，host facet 入口是 `lib/index.js`，Tool contract 是 `tools.dsh/v1alpha1`，权限声明包括受 DSH policy 管控的 subprocess、读取 worker/provenance，以及写入 DSH home 的 receipt。[manifest](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/dsh-plugin.json#L1-L37)
- manifest 声明五个 component：`ptc`、`shell`、`file` 默认启用，`tui` 和 `hide-official` 默认关闭；工具 namespace 的公开前缀是 `ops_`，文件 namespace 列出 11 个工具，bash namespace 列出 `bash`。[component declarations](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/dsh-plugin.json#L68-L145)
- `cordis.patch.yml` 实际插入 `shell`、`file`、`ptc` 三个启用行，以及关闭的 TUI/official-hiding 行；旧 `background` 行不再插入，遗留行加载为空操作 stub。[bundle patch](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/cordis.patch.yml#L1-L39)

### Host 入口与组件装载

- `lib/index.js` 只负责 host half：校验/迁移 row config，解析 worker 和 shell，注入 prompt section；`applyComponent()` 在 `shell` 行挂载 workspace preparation、PowerShell overlay、按 session 的 `ops_bash`，在 `file` 行挂载独立 Rust file worker。[host entry](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/lib/index.js#L1-L127)
- PTC 走独立子路径 `dsh-ops/ptc`：只有 system prompt 明确呈现为 PTC-only 时才注册 `ops_batch`/`ops_result`；presentation 或 sandbox mode 变化会同步撤回/重发工具，并在卸载时取消活跃 worker。[PTC component](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/lib/ptc/index.js#L1-L131)
- native worker 是 Rust stdin/stdout JSON 程序；`native/src/lib.rs` 将 file tools 与 batch/result 分流，Rust crate `#![forbid(unsafe_code)]`。文件路径使用 cap-std/cap-fs-ext 的 no-follow/handle-relative 操作；请求和结果都有明确预算。[native entry](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/native/src/main.rs#L1-L35) · [dispatch](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/native/src/lib.rs#L1-L95) · [crate](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/native/Cargo.toml#L1-L37)
- `bin/dsh-ops.mjs` 是运维入口：带 `--profile` 时委托官方 DSH profile manager；另有 `build-ptc`、`provision-shells`、`ladder` 与 legacy cleanup。插件装载本身不会自动下载 worker 或 shell。[CLI usage](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/bin/dsh-ops.mjs#L1-L100) · [install docs](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/docs/usage.md#L45-L71)

## 3. 关键能力

| 能力 | 源码事实 | 对 Whale Isle 的价值 |
| --- | --- | --- |
| Rust 文件工具 | `inspect_local_file`、`grep`、`glob`、`replace`、`write_file`、`edit_file`、`diff`、`stat`、`copy`、`move`、`remove`；schema 禁止未知字段，写操作要求 observed SHA-256 revision，native traversal 不跟随 symlink/junction/reparse point，结果有限长。[contract](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/lib/file/contract.js#L7-L114) · [native file walk](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/native/src/file.rs#L1-L180) | 可复用“读/观察 → revision → CAS 写入 → 结构化失败”的契约，比把任意 shell 暴露给模型更适合 Whale Isle 的仓库工作流。 |
| PTC 批处理 | `ops_batch` 支持 `plan`/`run`/同 id `resume`，copy/move/remove 仅相对 root、禁止 overwrite/link traversal；`ops_result` 以 session-owned rows 分页，默认 16 KiB、最大 64 KiB，普通结果 24 小时过期。[PTC contract](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/lib/ptc/contract.js#L1-L50) | 可作为 Project/批量文件动作的契约参考；必须保留 Whale Isle 自己的 task/run/lease/journal 身份，不要另起一套后台 scheduler。 |
| `ops_bash` | 当前调用是前台 bounded call，严格拒绝未声明参数；受限模式要求 DSH `sandbox.confine`，Windows 受限 bash 还要匹配 pinned MSYS IPC runtime。[session shell](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/lib/session-shells.js#L23-L180) · [config](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/docs/configuration-reference.md#L70-L82) | 可借鉴“按当前 session authority 动态发布/撤回工具”；不应在 Whale Isle 里另复制一层 shell policy。 |
| PowerShell 7 overlay | Windows shell row 解析到 plugin-owned pwsh 后，通过 `Fiber.update(rawConfig, true)` 原地重算，卸载时恢复，不写 profile 文件。[overlay](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/lib/session-pwsh.js#L1-L39) | 对 Whale Isle 的自有桌面 shell 组合存在潜在匹配/恢复风险，必须在目标 profile 上做真实检查；只看源码加载成功不够。 |
| TUI / official hiding | TUI 是只读当前会话活动面板；`hide-official` 是严格、可选的官方工具接管，readiness 不满足时按 scope 阻止 assembly/execution。[TUI](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/lib/components/tui/index.js#L1-L35) · [hiding](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/lib/official-tool-hiding.js#L1-L150) | TUI 价值有限；official hiding 不应默认开启，除非 Whale Isle 已逐项验证工具等价、提示词和恢复行为。 |

## 4. 安装、构建与发布路径

### 用户/运维入口

- README/usage 推荐在目标 DSH marketplace 输入 npm 包 `dsh-ops`，或执行 `npx --yes dsh-ops@latest install --profile desktop|web|tui`；desktop 必须使用应用自带 CLI，普通 DSH CLI 不能管理保留的 `desktop` profile。[install commands](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/README.en.md#L42-L74)
- Whale Isle 的桌面路径与之吻合：市场插件落在独立 `userData/dsh-home/profiles/web`，而不是用户的 `~/.dsh`；这支持“按插件安装、按 profile 回滚”的接入方式。[Whale Isle DSH home](../handbook/modules/dsh-home.md)
- 该包不靠 postinstall 下载 shell。Windows 的 `@dsh-ops/bash-win32-x64` 和 `@dsh-ops/pwsh-win32-x64` 是可选依赖；包内 `runtime/<target>` 需要 staged native worker。[package files/deps](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/package.json#L81-L130)

### 源码/CI 路径

- 本地 gate 顺序是 `npm ci --ignore-scripts` → `cargo test --locked` → `npm run build:ptc` → Windows `npm run build:bash-ipc` → `scripts/verify-gate.mjs`；gate 还会检查 suite inventory、平台允许的 skip 和打包后闭包。[CI gate](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/.github/workflows/ci.yml#L23-L90) · [local gate](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/docs/verify-locally.md#L1-L43)
- Release 的 native 矩阵为三个 target；`provenance.json` 记录 version/target/executable/sha256，Windows 另外验证 IPC receipt；GitHub Release 与 npm 是两条渠道。[release workflow](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/.github/workflows/release.yml#L1-L32) · [release process](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/docs/release-process.md#L29-L55)

## 5. 维护、兼容性与安全风险

### 值得肯定的安全/工程做法

- **权限不由模型输入选择。** `read-only`、`workspace-write`、`danger-full-access` 由 DSH authority 决定；权限拒绝返回结构化 `POLICY_DENIED`，并明确要求改变用户选择而不是重试/绕过。[permissions](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/lib/permissions.js#L1-L41)
- **凭据读取有独立 fence。** 默认拒绝 `~/.ssh`、`.aws`、`.azure`、`.kube`、`.npmrc`、`.git-credentials`、`.env`、service-account/credentials 文件名等；目录遍历也跳过 denied roots。[credential policy](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/lib/credential-policy.js#L1-L170)
- **worker 不可用时没有静默下载/无隔离 fallback。** runtime resolver 只从包内 staged worker、源码 build 或显式 `binaryPath` 选择；包内 receipt 只证明字节与 receipt 一致，源码注释明确不是签名/信任边界。[worker resolver](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/lib/ptc/runtime.js#L59-L114)
- **发布闭包有机械门禁。** manifest validator 会把 manifest、bundle patch、tool contract、prompt names 和 npm `files` 白名单交叉检查；CI 还会把打包 artifact 解包再检查。[manifest validator](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/scripts/validate-manifest.mjs#L1-L20) · [CI gate](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/.github/workflows/ci.yml#L73-L90)

### 需要 Whale Isle 先承担的风险

1. **文档与默认行为已经出现漂移。** `cordis.patch.yml` 和 manifest 将 PTC 标为默认启用，但 `docs/component-reference.md`、`docs/configuration-reference.md` 仍写 `dsh-ops/ptc` 默认 Off。[patch](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/cordis.patch.yml#L1-L23) · [manifest](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/dsh-plugin.json#L100-L112) · [stale docs](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/docs/configuration-reference.md#L7-L18)。**推断：** Whale Isle 若把文档当作产品契约，会错误估计安装后的工具面和 system prompt 成本；应以实际 patch/manifest 装配并做运行验收。
2. **平台叙述也有漂移迹象。** usage 文档称 macOS 没有 bundled shell payload、没有 pwsh row；但源码 pin table 已有 `darwin-arm64` PowerShell 7.6.6 pin，npm optionalDependencies 仍只声明 Windows payload。[usage](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/docs/usage.md#L16-L41) · [shell pins](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/lib/shells.js#L205-L284) · [optional deps](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/package.json#L128-L130)。**推断：** Whale Isle 不应把“跨平台可用”简化为一个 OS/CPU 条件，需按组件和实际 payload 验收。
3. **文件工具是 trusted-operation fence，不是任意代码沙箱。** 官方 component reference 明确说 OS-readable paths 在所有模式可读；固定文件操作复用 DSH fs-sandbox 的信任模型，Bash/run_code 才需要 OS confinement；Windows workspace-write 还会先执行带 `WRITE_OWNER` 的 workspace preparation。[component reference](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/docs/component-reference.md#L18-L37) **推断：** 这适合“用户已经授权的仓库操作”，不应作为 Whale Isle 不可信插件/不可信 workspace 的单独隔离边界；ACL/所有者不满足时可能让受限命令整层不可用。
4. **宿主 API 与发行版耦合。** `package.json` 仍以 DSH `0.2.0-rc.2` 为开发基线，roadmap 也要求持续跟踪 upstream DSH；session shell 和 PTC 依赖公共 assembly/sandbox/subprocess/jobs 语义。[package](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/package.json#L132-L150) · [roadmap](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/docs/roadmap.md#L33-L36) **推断：** Whale Isle vendor 版本变化、桌面自有 overlay 或 loader 行名变化，都可能让工具无声撤回或让 pwsh overlay 不生效；必须把“版本/entry/row id”作为兼容矩阵，而不是只看 npm semver。
5. **维护门禁仍有已知缺口。** 仓库 CI 文档声明 rustfmt/clippy 未纳入 blocking gate，actionlint 未使用，Release workflow 尚未端到端执行且当前 disabled；tools-trial 是 `continue-on-error` 信息性 job。[CI gaps](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/docs/ci.md#L87-L100) · [tools trial](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/.github/workflows/ci.yml#L92-L135) **推断：** “源码测试绿”不能替代 Whale Isle 安装包里的 native payload、受限 Windows shell 和实际 UI/profile 生命周期验收。
6. **发布体积与许可证闭包复杂。** Windows shell payload 分别固定 PortableGit 2.56.0.2（约 60 MB archive）与 PowerShell 7.6.6（约 106 MB archive），并携带其上游许可证/NOTICE；主包还有 Rust worker、IPC 与 provenance 文件。[shell pins](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/lib/shells.js#L226-L262) · [payload README](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/packages/README.md#L1-L34) **推断：** 直接吸收这些载荷会扩大 Whale Isle installer、after-pack 和许可证清单的变更面；外部 profile 包更容易回滚和独立升级。

## 6. Whale Isle 的推荐接入方案

### 现在做

1. **保持外部插件边界。** 在 Whale Isle 现有 `dsh-home/profiles/web` 安装 `dsh-ops`，不要把 `lib/`、`native/`、`runtime/` 或 shell payload 复制进 `vendor/deepseek-harness`。
2. **先做一条最小真实路径验收。** 目标是已安装包而不是源码：安装 → 重启/重载 → 普通 workspace 里发现 `ops_*` → read-only / workspace-write / danger-full-access 切换 → 取消/卸载 → 再启动。重点记录实际 manifest、worker 路径、提示词 section、工具 schema 和错误 `effectState`。
3. **先关闭两个高风险开关。** 不启用 `dsh-ops/hide-official`；PTC 以实际装配结果为准，先确认它的默认状态与 prompt 成本，再决定是否在 Whale Isle profile 中保留。
4. **把兼容性问题归到 profile/host 版本。** 若 pwsh overlay 不出现、工具在 reload 后消失或 DSH mode 改变后 schema 残留，优先检查 loader row id/name、`sandboxPolicy`/`subprocess` 服务与 DSH 版本，不要在 Whale Isle 里复制一份 dsh-ops 状态机。

### 暂不做

- 不把它并入 Whale Isle `DESKTOP_PACKAGES` 或 electron-builder `extraResources`；这会把第三方 native target、payload、provenance 与许可证纳入 Whale Isle 自己的发行闭包。
- 不把“97% token reduction”“更快”写入 Whale Isle 的产品承诺；当前 README 已将 benchmark 限定在特定复杂 prompt 场景。
- 不把 dsh-ops 的 Windows `WRITE_OWNER` workspace preparation 当作 Whale Isle 自己的 ACL/沙箱修复；它是插件的宿主前置条件，失败时应保留真实阻断原因。

## 7. 可借鉴与不建议照搬

### 建议借鉴

- **单一契约来源**：schema、公开工具名、prompt guidance、manifest namespace 由同一份 contract 驱动，再由 `validate-manifest` 交叉检查。
- **结构化失败**：统一返回 `code`、`phase`、`retryable`、`effectState`、`nextAction`，把“未执行”“已发布但调用失败”“效果未知”分开。
- **观察后 CAS 写入**：把 revision/expectedRevision 和 read-before-edit 绑定，避免模型根据陈旧内容覆盖用户新改动。
- **凭据与权限分层**：credential fence 独立于 DSH mode；权限改变不靠重试解决；无 confinement 时不悄悄降级为 unrestricted。
- **发布闭包检查**：target、receipt、payload、manifest、package files 一起门禁，避免“构建成功但安装包缺 runtime”。

### 不建议照搬

- 不照搬其独立 Rust worker、PTC durable store 或 shell overlay 到 Whale Isle；Whale Isle 已有自己的 session/task/lease/journal、profile 安装和 Electron packaging 边界。
- 不照搬 `hide-official` 的严格接管开关作为默认策略；它会把某个 scope 的 assembly/execution 变成 fail-closed，要求逐项等价能力和恢复验证。
- 不把固定文件工具的 trusted-operation fence 说成通用沙箱；它不能替代 Whale Isle 对不可信插件、用户数据和 native process 的整体隔离。

## 8. 证据边界与下一步

- 本笔记完成的是固定提交的源码/README/workflow/package/官方仓库文档研究；未运行外部 DSH、未下载 npm payload、未声称 Whale Isle 已安装或通过真实 UI 验收。
- dsh-ops 文档自身说 Release workflow 当前 `disabled_manually`，并列出未 blocking 的 rustfmt/clippy/actionlint 与未端到端执行的 release；这些是维护判断的直接依据，不是本次额外推测。[CI 文档](https://github.com/T-Auto/dsh-ops/blob/9c2ced59f5f58a759f6a74c4e1a655dfb62c4cbd/docs/ci.md#L87-L100)
- **下一责任点：** 如果父任务决定继续，应由 Whale Isle 维护者在现有 `dsh-home/profiles/web` 里做一次安装包级、真实 Windows profile 的 P0 验收；在该证据到手前，结论保持“外部可选插件/参考实现”，不进入内置发布闭包。

## 9. 研究时保护的当前工作树

研究开始与写入本笔记前，Whale Isle 工作树均为：

```text
main...origin/main [ahead 4]
 M src/main/dsh-project-client.test.js
?? .local-node/
```

以上既有修改未被触碰；外部仓库仅克隆到临时目录 `C:\Users\48818\AppData\Local\Temp\dsh-ops-research-20261017`。

