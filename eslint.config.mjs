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
  'vendor/dsh-with-chatgpt/lib/**/*.{js,mjs,cjs}',
  'vendor/dsh-remote/**/*.{js,mjs,cjs}',
  'dsh-acp/**/*.{js,mjs,cjs}',
];

// Node CommonJS sources: src/main, src/launcher, src/preload, src/host,
// src/shared, src/relay, src/main-launcher and script-side .js/.cjs.
const NODE_CJS_FILES = [
  'src/main/**/*.{js,cjs}',
  'src/preload/**/*.{js,cjs}',
  'src/shared/**/*.{js,cjs}',
  'src/launcher/**/*.{js,cjs}',
  'src/host/**/*.{js,cjs}',
  'src/relay/**/*.{js,cjs}',
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
  'vendor/dsh-with-chatgpt/lib/**/*.{js,mjs}',
  'vendor/dsh-remote/lib/**/*.{js,mjs}',
  'vendor/dsh-remote/plugin-src/**/*.mjs',
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
      'vendor/dsh-with-chatgpt/bridge/**', // 页面侧桥接脚本（本期范围外）
      'vendor/dsh-with-chatgpt/locale/**', // 翻译资源
      'vendor/dsh-with-chatgpt/skills/**', // 技能资源
      'vendor/dsh-with-chatgpt/tests/**', // 插件测试（本期范围外）
      'vendor/dsh-remote/lib/client.js', // 打包产物（esbuild，源码在 plugin-src/client）
      'dsh-acp/lib/vendor/**', // 打包产物（tools/runtime-build 输出）
      // 范围内的打包 / 第三方产物
      'src/whale-ui/**', // TS 项目，由 tsc 负责
      'src/renderer/whale-ui/**', // 同上（任务约定路径）
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
      'no-restricted-syntax': ['error',
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
      ],
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
  {
    files: [['src/main/**/*.{js,mjs,cjs}', '!src/main/**/*.test.{js,mjs,cjs}', '!src/renderer/**/*.child.cjs']],
    plugins: { whaleisle },
    rules: { 'whaleisle/ipc-handler-reads-event': 'error' },
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
];
