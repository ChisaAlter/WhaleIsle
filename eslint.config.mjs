import globals from 'globals';
import whaleisle from './scripts/eslint-rules/index.mjs';

// Checked scope: own sources only. Anything not matched by the `files`
// patterns below is not linted; the ignores list marks scope-internal
// third-party or bundled artifacts.
const CHECKED_FILES = [
  'src/**/*.{js,mjs,cjs}',
  'scripts/**/*.{js,mjs,cjs}',
  'mobile/web/**/*.{js,mjs,cjs}',
  'tools/**/*.{js,mjs,cjs}',
  'vendor/dsh-whale/lib/**/*.{js,mjs,cjs}',
  'vendor/dsh-project/lib/**/*.{js,mjs,cjs}',
  'vendor/dsh-deepseek-tools/lib/**/*.{js,mjs,cjs}',
  'vendor/dsh-task-control/lib/**/*.{js,mjs,cjs}',
  'vendor/dsh-platform-session/lib/**/*.{js,mjs,cjs}',
  'vendor/dsh-remote/**/*.{js,mjs,cjs}',
  'vendor/dsh-shared/**/*.{js,mjs,cjs}',
  'dsh-acp/**/*.{js,mjs,cjs}',
];

// Node CommonJS sources: src/main, src/launcher, src/preload, src/host,
// src/shared, src/main-launcher and script-side .js/.cjs.
const NODE_CJS_FILES = [
  'src/main/**/*.{js,cjs}',
  'src/preload/**/*.{js,cjs}',
  'src/shared/**/*.{js,cjs}',
  'src/launcher/**/*.{js,cjs}',
  'src/host/**/*.{js,cjs}',
  'src/main-launcher/**/*.{js,cjs}',
  'src/renderer/**/*.cjs',
  'scripts/**/*.{js,cjs}',
  'tools/**/*.cjs',
  'vendor/dsh-remote/**/*.cjs',
  'dsh-acp/**/*.cjs',
];

// Node ESM sources: every .mjs plus the ESM plugin lib trees.
const NODE_ESM_FILES = [
  'src/**/*.mjs',
  'scripts/**/*.mjs',
  'tools/**/*.mjs',
  'vendor/dsh-whale/lib/**/*.{js,mjs}',
  'vendor/dsh-project/lib/**/*.{js,mjs}',
  'vendor/dsh-deepseek-tools/lib/**/*.{js,mjs}',
  'vendor/dsh-task-control/lib/**/*.{js,mjs}',
  'vendor/dsh-platform-session/lib/**/*.{js,mjs}',
  'vendor/dsh-remote/lib/**/*.{js,mjs}',
  'vendor/dsh-remote/plugin-src/**/*.mjs',
  'vendor/dsh-shared/lib/**/*.{js,mjs}',
  'dsh-acp/lib/**/*.{js,mjs}',
  'dsh-acp/tests/**/*.{js,mjs}',
  'dsh-acp/tools/**/*.{js,mjs}',
];

// Classic page scripts (no import/export): the renderer and the plugin
// client injected into the harness page through __ModuleLoader__.
const BROWSER_SCRIPT_FILES = [
  'src/renderer/**/*.js',
  'dsh-acp/client/**/*.js',
];

// Page-side ESM.
const BROWSER_MODULE_FILES = [
  'mobile/web/**/*.{js,mjs}',
  'vendor/dsh-remote/plugin-src/client/**/*.js',
  'dsh-acp/client-src/**/*.js',
];

// Base no-restricted-syntax selectors. File-scoped blocks below must re-include
// these because a later flat-config entry replaces the whole option array.
const RESTRICTED_SYNTAX_BASE = [
  {
    selector: 'Property[key.name="sandbox"][value.value=false], Property[key.value="sandbox"][value.value=false]',
    message: '渲染进程必须开启 Chromium 沙箱；确有必要时用 eslint-disable-next-line 并在 -- 后写明理由。',
  },
  {
    selector: 'CallExpression[callee.object.name="process"][callee.property.name="kill"][arguments.0.type="UnaryExpression"][arguments.0.operator="-"]',
    message: '按进程组发信号请改用 src/shared/process-tree.js 的 killProcessTree。',
  },
  {
    selector: "CallExpression[callee.name=/^(spawn|spawnSync|exec|execSync|execFile|execFileSync)$/][arguments.0.value='taskkill']:has(Literal[value=/^\\/t$/i])",
    message: 'taskkill /T 按树终止请改用 src/shared/process-tree.js 的 killProcessTree。',
  },
  {
    selector: "CallExpression[callee.object.name=/^(child_process|cp)$/][callee.property.name=/^(spawn|spawnSync|exec|execSync|execFile|execFileSync)$/][arguments.0.value='taskkill']:has(Literal[value=/^\\/t$/i])",
    message: 'taskkill /T 按树终止请改用 src/shared/process-tree.js 的 killProcessTree。',
  },
];

// Direct removal primitives that must go through src/shared/fs-safe.js
// safeRemove (never throws, can log). Member calls on the conventional
// fs / fs.promises / fsPromises handles are all covered.
const RESTRICTED_FS_REMOVE = [
  {
    selector: 'CallExpression[callee.object.name="fs"][callee.property.name=/^(rmSync|unlinkSync)$/]',
    message: '删除改用 src/shared/fs-safe.js 的 safeRemove/safeRemoveSync（失败不抛出、可记录）；不得直接调用 fs.rmSync/fs.unlinkSync。',
  },
  {
    selector: 'CallExpression[callee.object.object.name="fs"][callee.object.property.name="promises"][callee.property.name=/^(rm|unlink)$/]',
    message: '删除改用 src/shared/fs-safe.js 的 safeRemove（失败不抛出、可记录）；不得直接调用 fs.promises.rm/fs.promises.unlink。',
  },
  {
    selector: 'CallExpression[callee.object.name="fsPromises"][callee.property.name=/^(rm|unlink)$/]',
    message: '删除改用 src/shared/fs-safe.js 的 safeRemove（失败不抛出、可记录）；不得直接调用 fsPromises.rm/fsPromises.unlink。',
  },
];

// Direct writes that must go through src/shared/fs-safe.js atomicWriteFile
// (same-directory temp + rename; a crash mid-write cannot truncate the file).
const RESTRICTED_FS_WRITE = [
  {
    selector: 'CallExpression[callee.object.name="fs"][callee.property.name=/^(writeFile|writeFileSync)$/]',
    message: '写入改用 src/shared/fs-safe.js 的 atomicWriteFile/atomicWriteFileSync（同目录临时文件 + rename）；不得直接调用 fs.writeFile/fs.writeFileSync。',
  },
  {
    selector: 'CallExpression[callee.object.object.name="fs"][callee.object.property.name="promises"][callee.property.name="writeFile"]',
    message: '写入改用 src/shared/fs-safe.js 的 atomicWriteFile（同目录临时文件 + rename）；不得直接调用 fs.promises.writeFile。',
  },
  {
    selector: 'CallExpression[callee.object.name="fsPromises"][callee.property.name="writeFile"]',
    message: '写入改用 src/shared/fs-safe.js 的 atomicWriteFile（同目录临时文件 + rename）；不得直接调用 fsPromises.writeFile。',
  },
];

// Raw mkdtemp in scripts must go through src/shared/fs-safe.js
// withOwnedTempDir, which owns recursive cleanup even when the callback throws.
const RESTRICTED_MKDTEMP = [
  {
    selector: 'CallExpression[callee.name=/^(mkdtemp|mkdtempSync)$/], CallExpression[callee.property.name=/^(mkdtemp|mkdtempSync)$/]',
    message: '临时目录改用 src/shared/fs-safe.js 的 withOwnedTempDir（finally 自动回收）；确需特殊回收方式时用 eslint-disable-next-line 并在 -- 后写明理由。',
  },
];

export default [
  {
    ignores: [
      '**/node_modules/**', // 第三方依赖
      '**/dist/**', // 构建输出
      '**/*.bundle.js', // esbuild 打包产物（src/main/preview-guest-preload、mobile/web/chisacode/daemon-client）
      '**/*.min.js', // 压缩产物
      '**/.*/**', // 点目录（.devin/.cursor/.github/.git 等）不在检查范围
      // 范围外目录：检查范围见 CHECKED_FILES
      'components/**',
      'prototypes/**',
      'tests/**',
      'docs/**',
      'build/**',
      'assets/**',
      'work/**',
      'mobile/android/**', // React Native 工程（本期范围外）
      'mobile/prototype/**', // 原型稿（本期范围外）
      'mobile/*.js', // React Native 入口（含 JSX，本期范围外；mobile/web 仍检查）
      // 上游 vendor（不检查）
      'vendor/deepseek-harness/**',
      'vendor/chisacode-remote/**',
      'vendor/dsh-usage-panel/**',
      'vendor/dsh-im/**',
      'vendor/dsh-pad/**',
      'vendor/open-intelligent-ui/**',
      'vendor/dshmarket/**',
      // 自有插件只检查 lib/ 源码（ignores 不能在已忽略目录内重新包含子目录，故逐个列出范围外部分）
      'vendor/dsh-whale/client/**', // 页面侧注入脚本（本期范围外）
      'vendor/dsh-whale/presets/**', // 数据资源
      'vendor/dsh-whale/stickers/**', // 数据资源
      'vendor/dsh-project/client/**', // 页面侧注入脚本（本期范围外）
      'vendor/dsh-project/tests/**', // 插件测试（本期范围外）
      'vendor/dsh-deepseek-tools/client/**', // 页面侧注入脚本（本期范围外）
      'vendor/dsh-deepseek-tools/tests/**', // 插件测试（本期范围外）
      'vendor/dsh-remote/lib/client.js', // 打包产物（esbuild，源码在 plugin-src/client）
      'dsh-acp/client/client.js', // 打包产物（esbuild，源码在 dsh-acp/client-src）
      'dsh-acp/lib/vendor/**', // 打包产物（tools/runtime-build 输出）
      // 范围内的打包 / 第三方产物
      'src/whale-ui/**', // TS 项目，由 tsc 负责
      'src/renderer/whale-ui/**', // 同上（任务约定路径）
      'src/renderer/openui/**', // gitignore 生成产物
      'mobile/web/whale-ui/**', // 同上
      'src/renderer/welcome/welcome.js', // 打包产物（React production bundle）
      'src/renderer/pet-live2d/anime4k.js', // 第三方 UMD bundle（anime4k.LICENSE）
      'src/renderer/pet-live2d/ort/**', // 第三方产物（ONNX Runtime wasm 加载器）
    ],
  },
  {
    files: CHECKED_FILES,
    plugins: { whaleisle },
    languageOptions: { ecmaVersion: 'latest' },
    rules: {
      'no-dupe-keys': 'error',
      'no-empty': 'error',
      'whaleisle/no-empty-promise-catch': 'error',
      'no-dupe-class-members': 'error',
      'no-dupe-else-if': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'no-unsafe-finally': 'error',
      'no-self-assign': 'error',
      'no-func-assign': 'error',
      'no-import-assign': 'error',
      'no-const-assign': 'error',
      'no-unsafe-negation': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-constant-binary-expression': 'error',
      'no-sparse-arrays': 'error',
      'no-compare-neg-zero': 'error',
      'no-setter-return': 'error',
      'no-async-promise-executor': 'error',
      'whaleisle/open-external-http': 'error',
      'whaleisle/no-secret-compare': 'error',
      'whaleisle/no-request-body-accumulate': 'error',
      'whaleisle/temp-marker-issue': 'error',
      'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX_BASE],
    },
  },
  {
    files: NODE_CJS_FILES,
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
  {
    files: NODE_ESM_FILES,
    languageOptions: {
      sourceType: 'module',
      globals: globals.node,
    },
  },
  {
    files: BROWSER_SCRIPT_FILES,
    languageOptions: {
      sourceType: 'script',
      globals: globals.browser,
    },
  },
  {
    files: BROWSER_MODULE_FILES,
    languageOptions: {
      sourceType: 'module',
      globals: globals.browser,
    },
  },
  // Own plugin lib trees must not ship undefined identifiers (`no-undef` catches missing imports before runtime).
  {
    files: [
      'vendor/dsh-whale/lib/**/*.{js,mjs,cjs}',
      'vendor/dsh-project/lib/**/*.{js,mjs,cjs}',
      'vendor/dsh-deepseek-tools/lib/**/*.{js,mjs,cjs}',
      'vendor/dsh-task-control/lib/**/*.{js,mjs,cjs}',
      'vendor/dsh-platform-session/lib/**/*.{js,mjs,cjs}',
      'vendor/dsh-shared/**/*.{js,mjs,cjs}',
      'vendor/dsh-remote/**/*.{js,mjs,cjs}',
      'dsh-acp/**/*.{js,mjs,cjs}',
    ],
    rules: {
      'no-undef': 'error',
    },
  },
  // Preloads run in an isolated world with both require() and DOM access.
  {
    files: ['src/preload/**/*.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  // openExternalHttp is the single audited wrapper around shell.openExternal.
  {
    files: ['src/main/open-external.js'],
    plugins: { whaleisle },
    rules: { 'whaleisle/open-external-http': 'off' },
  },
  // The shared tree-stop primitive is the one place allowed to signal -pid
  // and run taskkill /T; every caller goes through killProcessTree.
  {
    files: ['src/shared/process-tree.js'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  // The shared request-body primitive is the one place allowed to accumulate
  // req 'data' chunks; every caller goes through readBodyLimited.
  {
    files: ['src/shared/secret.js'],
    rules: { 'whaleisle/no-request-body-accumulate': 'off' },
  },
  {
    files: [['src/main/**/*.{js,mjs,cjs}', '!src/main/**/*.test.{js,mjs,cjs}', '!src/renderer/**/*.child.cjs']],
    plugins: { whaleisle },
    rules: { 'whaleisle/ipc-handler-reads-event': 'error' },
  },
  // All main-process channels mount through ipc-register (#434): direct
  // ipcMain registration is allowed only inside the wrapper itself. Test
  // files keep their fake ipcMain objects outside the gate.
  {
    files: CHECKED_FILES,
    ignores: ['src/main/ipc-register.js', '**/*.test.{js,mjs,cjs}', 'src/renderer/**/*.child.cjs'],
    plugins: { whaleisle },
    rules: { 'whaleisle/ipc-via-register': 'error' },
  },
  // #436: every channel literal a registration call carries must be declared
  // in src/shared/ipc-contract.js — channel tables (IPC constants passed by
  // reference) stay test-checked, literals are lint-checked.
  {
    files: ['src/main/**/*.{js,mjs,cjs}', 'src/launcher/**/*.{js,mjs,cjs}'],
    ignores: ['**/*.test.{js,mjs,cjs}', 'src/shared/ipc-contract.js'],
    plugins: { whaleisle },
    rules: { 'whaleisle/ipc-channel-contract': 'error' },
  },
  {
    files: [
      'src/renderer/**/*.{js,mjs,cjs}',
      'src/launcher/**/*.{js,mjs,cjs}',
      'mobile/web/**/*.{js,mjs}',
      'src/main/*inject*.{js,mjs,cjs}',
      'src/main/preview-*.{js,mjs,cjs}',
    ],
    plugins: { whaleisle },
    rules: { 'whaleisle/no-raw-html': 'error' },
  },
  // fs-safe (#432): deletion in update-center and the workspace writer must not
  // throw or truncate; every call goes through safeRemove/atomicWriteFile.
  {
    files: [
      'src/main/update-center/**/*.{js,cjs}',
      'src/main/workspace-fs.js',
    ],
    ignores: ['**/*.test.{js,mjs,cjs}'],
    rules: { 'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX_BASE, ...RESTRICTED_FS_REMOVE] },
  },
  {
    files: ['src/main/workspace-fs.js', 'src/main/config.js'],
    ignores: ['**/*.test.{js,mjs,cjs}'],
    rules: { 'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX_BASE, ...RESTRICTED_FS_REMOVE, ...RESTRICTED_FS_WRITE] },
  },
  // scripts/** non-test code must not leak or hand-roll temp dirs.
  {
    files: ['scripts/**/*.{js,mjs,cjs}'],
    ignores: ['**/*.test.{js,mjs,cjs}'],
    rules: { 'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX_BASE, ...RESTRICTED_MKDTEMP] },
  },
  // #443: production ownership only. Existing over-budget files/functions
  // retain explicit ceilings in structure-baseline.json; new ones get 800/20.
  {
    files: CHECKED_FILES,
    ignores: ['**/*.test.{js,mjs,cjs}', '**/*.child.cjs', '**/*.fixture.*', '**/*-test-kit.cjs'],
    rules: {
      'whaleisle/max-lines': 'error',
      'whaleisle/complexity': 'error',
    },
  },
];
