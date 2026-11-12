# Feature: Office runtime（文档/办公格式处理）

| Field | Value |
| --- | --- |
| **id** | `office-runtime` |
| **status** | `active` |
| **last verified** | 2026-09-25 — office-runtime 装配 + overlay + kit 闭包 + 预览路由落地；office-runtime.test.js 13/13、harness-controller +3、ui-files/ui-surfaces spec 各增用例全绿；打包 payload（primary-runtime 生成）与格式矩阵实机验收进行中。 |

## User paths

1. 对话内 `office` 技能路由至 `office-docx`/`office-pptx`/`office-xlsx` 创建、定点编辑、结构校验 DOCX/PPTX/XLSX；加载 `office` 后按需使用 `office_render`、`office_recalculate`、`office_convert` 工具。Files 树与对话文件点开二进制 Office 文档进入原生只读预览（DOCX/PPTX→PDF，XLSX/XLS→Spreadsheet）。
2. `load_workspace_dependencies` 首调把锁定 payload（Python+numpy/pandas/python-docx/python-pptx/openpyxl/Pillow/lxml/XlsxWriter + standalone Node/pnpm）原子安装进 `dsh-home/dsh-runtimes/dsh-primary-runtime`。
3. 预览路由：Files 树/surfaces 打开 `doc/docx/ppt/pptx/xls/xlsx` 走 `sidebarRight.openResourceIn`→documentpreview；csv/tsv 留在可编辑文本视图（有意分叉）。
4. 区域图、重算与 PDF 导出由 `office-kit` provider 的原生引擎处理；payload 内 standalone Node 供工作区脚本使用。

## Invariants

- 只用打包进来的 standalone Node runtime + 闭包内的 `libreoffice-kit@0.2.3`（按 `prebuilds.json` 解析 win32-x64 native 引擎）；不回退系统 PATH / 系统 LibreOffice / WASM。
- `workspace-dependencies`/`skill-office` 两行由 `desktop-plugins/office/desktop-office.patch.yml` overlay 配置上游已有行（不重复插入），每次启动（full+skip）都传；绝不写进用户 `cordis.patch.yml`。
- `source/root/assetRoot` 全是显式绝对路径，`skill-office` 显式使用 `pythonEnvironment: workspace-dependencies`；`DSH_PRIMARY_RUNTIME` 覆盖整目录、空串退出；`DSH_BUNDLED_PRIMARY_RUNTIME` 只作载体默认声明。
- `prepare-office-runtime.mjs` 先调用上游准备 Python/Node 载荷，再独立复制当前 `skill-office/assets` 到 `build/office-runtime/office-skills`；rc.2 的上游准备器不再输出技能目录。
- payload 校验：runtime.json platform/arch/payloadDigest 匹配 + node.exe + 当前四个技能的 SKILL.md；packaged 缺失或已有载荷但资源不完整=运行时损坏：本次启动跳过 Office，鲸屿照常启动，启动器「启动诊断」列出原因；dev 缺少载荷=警告可启动。
- 依赖安装按 staging→validate→atomic install；失败保留旧 payload，会话/Profile 不受影响。
- 每访问走 workspace 授权；拒绝 symlink/junction 逃逸；缓存随版本/代际失效。
- 加载、取消、错误、大小限制、加密、缺字体失败都显式上报，不静默吞。

## Allowed touch

- `src/main/office-runtime.js`（装配/校验/overlay/env）、`src/main/dsh.js`（spawnEnv）、`src/main/harness-controller.js`（ensure 接线）
- `scripts/prepare-office-runtime.mjs`、`scripts/after-pack.js`（assertOfficeRuntime）、`scripts/check-skip-compose-contract.js`
- `package.json` extraResources + pack/dist 链
- `vendor/deepseek-harness/packages/client/ui-files/src/client/desktop-files.ts`、`ui-surfaces/src/client/{apply.ts,SurfacesRoot.tsx}`（预览路由 fork）

## Do not touch

- 不在 workspace 外落 Office 运行时；不写全局 PATH / 注册表。
- 不伪造 Office 编辑器；不引入第二套文档预览 UI。
- 不把 `cli:false` 写进 overlay（kit-less 部署不是完整 Office 运行时）。
- 非 win32 目标暂不出 payload（assert 门控跳过 `electronPlatformName!=='win32'`）；缺少默认载荷时继续启动且不写 Office overlay，显式指定的运行时仍须完整校验。

## Gates

| Kind | What |
| --- | --- |
| Automated | `src/main/office-runtime.test.js`、`harness-controller.test.js`（office 用例）、`ui-files/tests/apply.client.spec.ts`、`ui-surfaces/tests/apply.client.spec.ts`、fork markers、skip-compose 契约 |
| Packaged | `assertOfficeRuntime`（payload + kit 全闭包 + 引擎清单一致性，win32 目标 fail build） |
| Manual / QA | O-1…O-12 实机验收（见 evidence/2026-09-25-upstream-adoption/ledger.md） |

## Sources

- Decision: [桌面文档运行时](../decisions/implemented/architecture/2026-09-25-desktop-office-runtime.md)
- Plan: `docs/superpowers/plans/2026-09-25-upstream-adoption-plan.md` §5/P3/F7
- Engine resolution: `vendor/deepseek-harness/scripts/libreoffice-packages.mjs` + `prebuilds.json`
- Upstream composition: `vendor/deepseek-harness/packages/bundle/web-app/cordis.patch.yml`
- Evidence: `docs/superpowers/evidence/2026-09-25-upstream-adoption/`
