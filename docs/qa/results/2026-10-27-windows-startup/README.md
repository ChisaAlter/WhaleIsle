# Windows 原始 CI 包启动诊断（2026-10-27）

议题：[#277](https://github.com/ChisaAlter/WhaleIsle/issues/277)。测试基线 main `031fdff4d34fdd7872f28aa9308347d9ee2dbd47`，独立工作分支 `fix/windows-native-startup-20261027`。

## 原生故障结论

本机保留的 CI 解包目录及其原始 `Whale Isle.exe` 继承了 Windows `Low Mandatory Level` 文件完整性标签。从 Medium 调用者启动该文件，Windows 实际创建的是 **Low 完整性 browser 主进程（RID 4096）**。Chromium 在 JS 入口之前创建 sandbox alternate window station，收到 `ERROR_ACCESS_DENIED (5)`，随后在 `CHECK(result == SBOX_ALL_OK)` 触发 `0x80000003`。

同一构建的 exe 字节在普通目录启动为 Medium（RID 8192），官方 44.4.3 和官方 44.9.1 最小 GUI 也均能启动。进一步只降低新子进程 token、完全不改文件或参数即可复现同一个 JS 前退出；恢复普通 token 又成功。故本次故障来源是本机诊断目录的完整性标签，不能再据此认定 Electron 44.9.1、GPU、V8 或 PR275 产品代码有原生启动回归。

没有给产品加 `--no-sandbox`、GPU 参数、重试或旧引擎回落，也没有修改依赖版本。没有证据可以断言是哪次工具操作添加了 Low 标签；目录中还存在旧测试 sandbox 的继承 ACE，这只是来源线索，不是来源证明。

## 原始文件身份

CI run [40179132499](https://github.com/ChisaAlter/WhaleIsle/actions/runs/40179132499)，commit `ab4feeb910d8dab74c250b78b7de4a87990db40f`，0.3.10 Setup。此次复用保留的原始安装包和 NSIS 内 `app-64.7z`，未重建产品。

| 文件 | SHA256 |
| --- | --- |
| Setup | `3af2a28c5a2626924540a975e423069b3f5563993b2537d2d52a0076df8b8132` |
| 原始产品 exe | `3982202ffdc44d5107fcfbd82baa48c9388e0c95150e699a4c671c78991131cb` |
| 原始 app.asar | `a6fe6246965986ea1418ca094e2abb8933a616eb1fb6d61750f3e7a712ec18e4` |
| 原始 Harness tar | `009bbe4fa513bd50e30be4b5001cc30fabc51aac5e1167210896f1e0c41a6973` |
| 官方 electron-v44.9.1-win32-x64.zip | `41bd7900bd42d0f49110a81617876137041fbbf473466920248ddb076349ef91` |
| 官方 electron-v44.9.1-win32-x64-symbols.zip | `cc89c46c726342e593311777a381c7b9019be9194d9c1702e896b4470f226685` |

官方 ZIP 和符号包的 hash 均匹配[官方 SHASUMS256](https://github.com/electron/electron/releases/download/v44.9.1/SHASUMS256.txt)及 GitHub release asset digest。CI 原生数据文件（ICU、snapshot、PAK、DLL 等 15 项）与官方同版逐项 SHA256 相同；品牌 exe 因资源编辑与官方 exe 不同。产品 exe 在原故障目录和 fresh 解包目录的 hash 完全相同。

## 符号化证据

使用 `DEBUG_ONLY_THIS_PROCESS` 启动独立测试进程，系统初始断点正常放行。原故障之后的 first/second chance 断点为主 exe RVA `0x33a55fe`，退出 `0x80000003`。官方 Breakpad 模块 ID `8E186078E498DC634C4C44205044422E1`，Code ID `6AD6B64CEC86000`。脱敏原生读数见[断点记录](native-breakpoint.json)。

符号精确对应：

- `sandbox::policy::Sandbox::Initialize(...)`，`sandbox/policy/sandbox.cc:71`。
- 现场 `RAX = 12`：`SBOX_ERROR_CANNOT_CREATE_WINSTATION`。
- 线程 TEB `LastErrorValue` 为 `5`：`ERROR_ACCESS_DENIED`。
- 同版源码先调用 `broker_services->CreateAlternateDesktop(Desktop::kAlternateWinstation)`，再检查结果；失败发生于 JS 前。

源码来自 [Electron v44.9.1 DEPS](https://github.com/electron/electron/blob/v44.9.1/DEPS)指定的 Chromium `152.0.7977.167`：

- [sandbox.cc](https://github.com/chromium/chromium/blob/152.0.7977.167/sandbox/policy/sandbox.cc#L50-L77)
- [ResultCode](https://github.com/chromium/chromium/blob/152.0.7977.167/sandbox/win/src/sandbox_types.h#L20-L48)
- [CreateAltWindowStation](https://github.com/chromium/chromium/blob/152.0.7977.167/sandbox/win/src/window.cc#L18-L50)

无需下载约 2 GB PDB：官方 60 MB Breakpad 符号已有函数和源码行信息，足以回答本次断点位置。原始 dump、模块表和栈候选只保留在独立诊断 scratch 中，未提交内存内容。

## 受控实验

| 运行条件 | 子进程完整性 | JS / GUI | 退出 |
| --- | --- | --- | --- |
| 主仓只读官方 Electron 44.4.3 + 最小 GUI | Medium | ready、可见、截图 | 0 |
| 校验后的官方 44.9.1 + 最小 GUI | Medium | ready、可见、截图 | 0 |
| 官方 44.9.1 仅改 exe 文件名 + 最小 GUI | Medium | ready、可见、截图 | 0 |
| CI 原始 exe + 原始全部原生数据，在普通 scratch + 最小资源 | Medium | ready、可见、截图 | 0 |
| 同一个 CI exe 同一路径，仅 `CreateRestrictedToken` + `TokenIntegrityLevel=Low` | Low | 未到 JS | `0x80000003` |
| 同一个 CI exe，恢复普通启动 | Medium | ready、可见、截图 | 0 |
| 保留原故障目录原始文件 | Low（文件标签继承） | 未到 JS，window station access denied | `0x80000003` |
| 新可复用脚本，官方 44.9.1，普通启动 | Medium | ready、可见、截图 | 0 |
| 新可复用脚本，同一官方 44.9.1，`--low-token` | Low | 未到 JS | `0x80000003` |

Low token 实验只复制当前 token 并改变新 token 的完整性等级，不改变父 token、文件标签或已有应用。曾尝试对自己新建的测试 exe 用 `icacls /setintegritylevel` 做标签实验，Windows 拒绝修改；两次调用均未改变标签，不纳入 Low/Medium 因果证据。未对该拒绝提权重试。

## 完整产品验证

从同一原始 `app-64.7z` **重新完整解出**到普通目录（不使用原资源 junction，不替换 Electron）：7-Zip 正常退出，2473 个目录、15600 个文件、总计 1,247,049,519 字节，没有解包错误。fresh 主 exe 和内置 Node 都没有 Low 标签；主进程 token 为 Medium。

首次空 profile 的运行时提取完成，产品 boot/launcher 页面可用，但 Harness 服务无输出等待到 180 秒超时，首次总驱动也在 15 分钟期限退出。这不是原生崩溃，不能记作完整通过。随后同一隔离 profile 启动并在服务上仅内存加独立 inspector 参数诊断、普通重启服务，完整 Harness 页面于 14:29:15 可用：`document.readyState=complete`、27 个按钮、一个可编辑输入区，截图人工检查通过。主进程 PID29464 以 `app.quit()` 走正常退出流程，14:29:20 exit 0。没有替换产品文件或旧外壳。此次冷启动超时及诊断重启不用于声称冷启动性能通过。

最终追加一次没有服务诊断参数或内存补丁的启动：PID33448，14:30:51 启动，14:31:31 完整页面 ready，14:31:33 普通 `app.quit()` exit 0。该次未修改原包 exe、app.asar、Node 或 Harness tar。约 40 秒的暖启动只证明启动功能恢复，不能视作性能达标；首次冷启动超时没有被抹去。见[完整产品结果](full-product.json)、[页面截图](page-ready.png)及[最小 GUI 对照](minimal-results.json)。

## 重现与实际处理

1. 用 `icacls "<测试目录>\Whale Isle.exe"` 检查文件及其父目录。若出现继承的 `Mandatory Label\Low Mandatory Level`，新 profile 或 TEMP 不会修复该 exe 启动的完整性等级。
2. 保留原目录的 hash 和 `icacls` 输出。从同一经过校验的 Setup/内层归档重新解包到普通用户拥有、未标 Low 的新目录。必须完整保留同版全部原生文件与产品 resources；重新校验 exe、app.asar 和运行时归档 hash。
3. 仍用独立 `--user-data-dir`，在正常非 Low 的 Windows 会话启动。安装版和真实用户数据无需替换。本机保留的故障目录作为证据没有改标签。
4. 若必须修复已有测试目录的标签，应由拥有相应权限的目录所有者先核实继承来源并只修复这个测试目录；不递归改用户目录/系统安全设置。`Unblock-File` 移除的是 Internet Zone 数据，不等于修复 mandatory integrity label。

官方最小 GUI 对照（Python 3.11+，Windows x64，两个新输出目录）：

```powershell
python scripts/diagnose-windows-startup.py --exe C:\scratch\electron-44.9.1\electron.exe --output C:\scratch\startup-normal
python scripts/diagnose-windows-startup.py --exe C:\scratch\electron-44.9.1\electron.exe --output C:\scratch\startup-low --low-token
```

[诊断脚本](../../../../scripts/diagnose-windows-startup.py)启动自己的独立 profile，输出 exe hash、父/子 token RID、JS/截图状态和真实退出码。它拒绝产品 app.asar（避免把忽略外部入口的产品 exe 当成最小 GUI），拒绝重用输出目录，不修改文件 ACL，不关 sandbox，不加载用户配置、凭据或历史。[最小 GUI](../../../../scripts/fixtures/windows-startup-minimal.cjs)只加载 data URL。已有安装版的 PID6308 保留且检查仍在运行；没有向任何会话发消息。

## 范围与剩余事项

本报告足以解释 #277 的 JS 前原生退出；它不代替 #271 的性能验收、Android #285、真实数据原位覆盖安装或完整日常功能验收。此分支只增加诊断工具与实测结果，没有生产运行时改动。GitHub issue/PR 的写入统一交给 lead。
