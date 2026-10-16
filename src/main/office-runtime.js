'use strict';

/**
 * Desktop Office runtime composition (P3): mounts the vendored
 * `@deepseek-ai/dsh-tool-workspace-dependencies` and
 * `@deepseek-ai/dsh-skill-office` plugins into the composed web profile via a
 * desktop-owned `--patch` overlay (`desktop-plugins/office/
 * desktop-office.patch.yml`), mirroring the upstream Desktop Host's
 * `desktop-office` apply (`apps/desktop-host/src/office.ts`).
 *
 * Contract:
 * - `workspace-dependencies` gets `source` (the locked bundled payload:
 *   Node + Python + Office wheels) and `root` (the Harness-home install
 *   directory `dsh-home/dsh-runtimes/dsh-primary-runtime`). The plugin owns
 *   staging → validate → atomic rename there; the old payload survives a
 *   failed replacement.
 * - `skill-office` gets `assetRoot` (payload-sibling `office-skills`), `node`
 *   (the payload's standalone Node, never the Electron binary or PATH), and
 *   `cli` (the real unpacked `libreoffice-kit/lib/cli.js`). `cli:false` is
 *   never emitted — a kit-less deployment is not a complete Office runtime.
 * - Windows x64 requires the native engine package
 *   `@deepseek-ai/libreoffice-kit-win32-x64`; there is no WASM fallback.
 * - The overlay rides EVERY start (full and --skip-user-plugins) — Office is
 *   desktop built-in, not a user plugin, so the disable list never applies.
 * - `DSH_PRIMARY_RUNTIME` overrides the bundled payload directory; an empty
 *   string is the explicit opt-out (upstream carrier semantics).
 * - Windows packaged builds ship the payload at resources/runtime/primary-runtime
 *   and the skills at resources/runtime/office-skills (afterPack asserts
 *   both); a missing Windows packaged payload is runtime damage and fails the start.
 *   Other desktop targets do not currently ship this payload and stay bootable.
 *   A missing dev payload (build/office-runtime, produced by
 *   `npm run prepare:office-runtime`) only warns — dev shells stay bootable.
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { getDesktopDshHome } = require('../shared/dsh-home');
const { webProfileDir } = require('./plugins');

const OFFICE_DIR_NAME = 'office';
const OFFICE_OVERLAY_FILENAME = 'desktop-office.patch.yml';
const PRIMARY_RUNTIME_DIRNAME = 'dsh-primary-runtime';
const OFFICE_SKILLS_DIRNAME = 'office-skills';
const OFFICE_SKILL_FOLDERS = [
  'office', 'office-docx', 'office-pptx', 'office-xlsx',
  'office-render', 'office-recalculate', 'office-export-pdf',
];
const KIT_PACKAGE = '@deepseek-ai/libreoffice-kit';
const KIT_CLI_ENTRY = path.join('lib', 'cli.js');
const WORKSPACE_DEPENDENCIES_PACKAGE = '@deepseek-ai/dsh-tool-workspace-dependencies';
const SKILL_OFFICE_PACKAGE = '@deepseek-ai/dsh-skill-office';

function writeAtomic(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, contents, 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * The native engine package a target requires, or null where the kit's own
 * resolver legally falls back to WASM (Linux without a native build).
 * @param {string} platform
 * @param {string} arch
 * @returns {string|null}
 */
function requiredEnginePackage(platform = process.platform, arch = process.arch) {
  if (!['x64', 'arm64'].includes(arch)) return null;
  if (platform === 'win32' || platform === 'darwin') return `${KIT_PACKAGE}-${platform}-${arch}`;
  if (platform === 'linux') return `${KIT_PACKAGE}-linux-${arch}-glibc`;
  return null;
}

function defaultProjectRoot() {
  try {
    return require('./paths').projectRoot();
  } catch {
    return path.join(__dirname, '..', '..');
  }
}

function defaultHarnessRoot() {
  try {
    return require('./paths').harnessRoot();
  } catch {
    return '';
  }
}

function officeOverlayDir(profileDir) {
  return path.join(profileDir, 'desktop-plugins', OFFICE_DIR_NAME);
}

/**
 * Candidate bundled payload directories in precedence order. An explicit
 * `DSH_PRIMARY_RUNTIME` (even a wrong one) wins — the carrier semantics treat
 * it as the user's chosen payload, so its failure must surface as-is.
 * @param {{ env?: NodeJS.ProcessEnv, isPackaged?: boolean, resourcesPath?: string,
 *   projectRoot?: string }} options
 * @returns {{ candidates: string[], disabled: boolean }}
 */
function officeRuntimeCandidates(options = {}) {
  const env = options.env || process.env;
  if (typeof env.DSH_PRIMARY_RUNTIME === 'string') {
    if (env.DSH_PRIMARY_RUNTIME.trim() === '') return { candidates: [], disabled: true };
    return { candidates: [path.resolve(env.DSH_PRIMARY_RUNTIME)], disabled: false };
  }
  const resourcesPath = options.resourcesPath || process.resourcesPath || '';
  const bundled = options.bundledRuntimeDir
    || (options.isPackaged
      ? path.join(resourcesPath, 'runtime', 'primary-runtime')
      : path.join(defaultProjectRoot(), 'build', 'office-runtime', 'primary-runtime'));
  return { candidates: [bundled], disabled: false };
}

/**
 * Read and validate a payload manifest. Throws on any structural or
 * platform/architecture mismatch — the error text names the expectation so
 * the caller surfaces it verbatim.
 * @param {string} source - Payload directory containing runtime.json.
 * @returns {object} parsed manifest
 */
function readRuntimeManifest(source) {
  const file = path.join(source, 'runtime.json');
  if (!fs.existsSync(file)) {
    throw new Error(`Office 运行时缺少 runtime.json：${file}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Office 运行时 runtime.json 无法解析：${error.message}`);
  }
  if (!manifest || typeof manifest !== 'object'
    || manifest.platform !== process.platform || manifest.arch !== process.arch) {
    throw new Error(
      `Office 运行时与当前平台不匹配（需要 ${process.platform}/${process.arch}，`
      + `清单为 ${manifest && manifest.platform}/${manifest && manifest.arch}）`,
    );
  }
  if (typeof manifest.payloadDigest !== 'string' || !manifest.payloadDigest) {
    throw new Error('Office 运行时 runtime.json 缺少 payloadDigest');
  }
  return manifest;
}

/**
 * Resolve the LibreOffice Kit package inside the harness runtime and assert
 * the win-x64 native engine when required. Missing pieces throw actionable
 * Chinese errors (buildLaunch preflight surfaces them verbatim).
 * @param {string} harnessRoot - Source or extracted harness root.
 * @returns {{ cli: string, packageDir: string, version: string,
 *   enginePackageDir?: string }}
 */
function resolveOfficeKit(harnessRoot) {
  const cliAnchor = path.join(harnessRoot, 'apps', 'cli', 'package.json');
  const requireFromCli = createRequire(cliAnchor);
  let skillManifestFile;
  try {
    skillManifestFile = requireFromCli.resolve(`${SKILL_OFFICE_PACKAGE}/package.json`);
  } catch {
    throw new Error(`Office 组件缺失：${SKILL_OFFICE_PACKAGE} 在 Harness 运行时中不可解析`);
  }
  // skill-office resolves the kit beside itself at runtime; anchor there so
  // the preflight walks the same path (pnpm links under the package, not the
  // workspace root).
  const requireFromSkill = createRequire(skillManifestFile);
  let manifestFile;
  try {
    manifestFile = requireFromSkill.resolve(`${KIT_PACKAGE}/package.json`);
  } catch {
    throw new Error(`Office 组件缺失：${KIT_PACKAGE} 在 Harness 运行时中不可解析`);
  }
  const packageDir = path.dirname(manifestFile);
  const cli = path.join(packageDir, KIT_CLI_ENTRY);
  if (!fs.existsSync(cli)) {
    throw new Error(`Office 组件缺少 CLI 入口：${cli}`);
  }
  const version = JSON.parse(fs.readFileSync(manifestFile, 'utf8')).version;
  const engineName = requiredEnginePackage();
  if (!engineName) {
    return { cli, packageDir, version };
  }
  // cli.js resolves engine packages relative to itself.
  const requireFromKit = createRequire(manifestFile);
  let engineManifestFile;
  try {
    engineManifestFile = requireFromKit.resolve(`${engineName}/package.json`);
  } catch {
    throw new Error(
      `Office 缺少原生引擎包 ${engineName}（当前平台不允许 WASM 回落）。`
      + '源码运行请执行 npm run setup:harness；安装包请重新下载并重装。',
    );
  }
  const enginePackageDir = path.dirname(engineManifestFile);
  const engineManifest = JSON.parse(fs.readFileSync(engineManifestFile, 'utf8'));
  if (engineManifest.version !== version) {
    throw new Error(`Office 引擎版本不匹配：${engineName}@${engineManifest.version}，kit 需要 ${version}`);
  }
  const prebuildsFile = path.join(enginePackageDir, 'prebuilds.json');
  if (!fs.existsSync(prebuildsFile)) {
    throw new Error(`Office 引擎包缺少 prebuilds.json：${prebuildsFile}`);
  }
  const prebuilds = JSON.parse(fs.readFileSync(prebuildsFile, 'utf8'));
  const target = `${process.platform}-${process.arch}`;
  if (prebuilds.status !== 'built' || prebuilds.platform !== target || prebuilds.version !== version) {
    throw new Error(`Office 引擎清单无效：${prebuildsFile}（platform=${prebuilds.platform}，status=${prebuilds.status}）`);
  }
  const executable = path.join(enginePackageDir, 'bin', process.platform === 'win32' ? 'libreoffice-kit.exe' : 'libreoffice-kit');
  if (!fs.existsSync(executable)) {
    throw new Error(`Office 引擎可执行文件缺失：${executable}`);
  }
  return { cli, packageDir, version, enginePackageDir };
}

/**
 * The expected kit CLI path inside a not-yet-extracted packaged runtime:
 * afterPack flattens every package into `<harnessRoot>/node_modules`.
 * @param {string} harnessRoot
 * @returns {string}
 */
function expectedPackagedKitCli(harnessRoot) {
  return path.join(harnessRoot, 'node_modules', ...KIT_PACKAGE.split('/'), KIT_CLI_ENTRY);
}

/**
 * Carrier environment for `dsh web` children: declares the bundled payload as
 * `DSH_BUNDLED_PRIMARY_RUNTIME`, mirroring the official carrier. A user
 * `DSH_PRIMARY_RUNTIME` (override or empty-string opt-out) passes through
 * untouched — childSpawnEnv inherits the parent environment.
 * @param {{ env?: NodeJS.ProcessEnv, isPackaged?: boolean, resourcesPath?: string,
 *   projectRoot?: string, bundledRuntimeDir?: string }} [options]
 * @returns {{ DSH_BUNDLED_PRIMARY_RUNTIME?: string }}
 */
function officeRuntimeEnv(options = {}) {
  const env = options.env || process.env;
  if (typeof env.DSH_PRIMARY_RUNTIME === 'string') return {};
  let isPackaged = options.isPackaged;
  if (isPackaged === undefined) {
    try {
      isPackaged = require('electron').app.isPackaged === true;
    } catch {
      isPackaged = false;
    }
  }
  const { candidates } = officeRuntimeCandidates({ ...options, isPackaged });
  const source = candidates.find((dir) => fs.existsSync(path.join(dir, 'runtime.json')));
  return source ? { DSH_BUNDLED_PRIMARY_RUNTIME: source } : {};
}

/**
 * Write the desktop office overlay and validate the bundled payload. Runs
 * before `dsh.start` extracts the packaged Harness, so package-dir checks
 * apply only when the harness tree is already readable (dev always;
 * packaged on every start after the first).
 *
 * @param {{ profileDir?: string, harnessRoot?: string, env?: NodeJS.ProcessEnv,
 *   isPackaged?: boolean, platform?: string, resourcesPath?: string, projectRoot?: string,
 *   dshHome?: string }} [options]
 * @returns {{ ok: boolean, added?: boolean, disabled?: boolean, present?: boolean,
 *   error?: string, warning?: string, overlayFile?: string, source?: string,
 *   root?: string, assetRoot?: string, node?: string, cli?: string,
 *   payloadDigest?: string }}
 */
function ensureDesktopOfficeRuntime(options = {}) {
  let isPackaged = options.isPackaged;
  if (isPackaged === undefined) {
    try {
      isPackaged = require('electron').app.isPackaged === true;
    } catch {
      isPackaged = false;
    }
  }
  const profileDir = options.profileDir || webProfileDir();
  const overlayFile = path.join(officeOverlayDir(profileDir), OFFICE_OVERLAY_FILENAME);
  const env = options.env || process.env;
  const { candidates, disabled } = officeRuntimeCandidates({ ...options, isPackaged });
  const removeOverlay = () => {
    if (fs.existsSync(overlayFile)) fs.unlinkSync(overlayFile);
  };
  if (disabled) {
    removeOverlay();
    return { ok: true, disabled: true, present: false };
  }
  const source = candidates.find((dir) => fs.existsSync(path.join(dir, 'runtime.json')));
  if (!source) {
    removeOverlay();
    const platform = options.platform || process.platform;
    if (isPackaged && platform !== 'win32' && !env.DSH_PRIMARY_RUNTIME) {
      return { ok: true, present: false, warning: '此平台未提供内置 Office 运行时，Office 技能不可用。' };
    }
    if (isPackaged) {
      return {
        ok: false,
        present: false,
        error: `安装包缺少 Office 运行时（${candidates[0]}）。请重新下载并重装。`,
      };
    }
    return {
      ok: true,
      present: false,
      warning: 'Office 运行时未构建，Office 技能不可用。请运行 npm run prepare:office-runtime',
    };
  }
  let manifest;
  try {
    manifest = readRuntimeManifest(source);
  } catch (error) {
    return { ok: false, error: error.message };
  }
  const node = path.join(
    source, 'dependencies', 'node', 'bin',
    process.platform === 'win32' ? 'node.exe' : 'node',
  );
  if (!fs.existsSync(node)) {
    return { ok: false, error: `Office 运行时缺少独立 Node：${node}` };
  }
  const assetRoot = path.join(path.dirname(source), OFFICE_SKILLS_DIRNAME);
  const missingAssets = OFFICE_SKILL_FOLDERS.map((name) => path.join(assetRoot, name, 'SKILL.md'))
    .filter((file) => !fs.existsSync(file));
  if (missingAssets.length) {
    return { ok: false, error: `Office 技能资源缺失：${missingAssets.join('；')}` };
  }
  const harnessRoot = options.harnessRoot || defaultHarnessRoot();
  let cli;
  if (harnessRoot && fs.existsSync(path.join(harnessRoot, 'apps', 'cli', 'package.json'))) {
    try {
      ({ cli } = resolveOfficeKit(harnessRoot));
    } catch (error) {
      return { ok: false, error: error.message };
    }
  } else if (harnessRoot) {
    // Packaged first boot: extraction has not run yet; afterPack already
    // asserted the flattened closure, so assert at the canonical location.
    cli = expectedPackagedKitCli(harnessRoot);
  } else {
    return { ok: false, error: '缺少 Harness 根路径，无法定位 Office 组件' };
  }
  const dshHome = options.dshHome || getDesktopDshHome();
  const root = path.join(dshHome, 'dsh-runtimes', PRIMARY_RUNTIME_DIRNAME);
  const overlayContents = [
    '# Desktop-managed overlay passed to every start (full and skip) via',
    '# --patch: the bundled Office runtime insert rows, never the profile',
    '# user layer. Regenerated on every start; do not edit.',
    '- insert:',
    '    - id: workspace-dependencies',
    `      name: ${JSON.stringify(WORKSPACE_DEPENDENCIES_PACKAGE)}`,
    '      config:',
    `        source: ${JSON.stringify(source)}`,
    `        root: ${JSON.stringify(root)}`,
    '    - id: skill-office',
    `      name: ${JSON.stringify(SKILL_OFFICE_PACKAGE)}`,
    '      config:',
    `        assetRoot: ${JSON.stringify(assetRoot)}`,
    `        node: ${JSON.stringify(node)}`,
    `        cli: ${JSON.stringify(cli)}`,
    '',
  ].join('\n');
  let added = false;
  const existing = overlayFile && fs.existsSync(overlayFile)
    ? fs.readFileSync(overlayFile, 'utf8')
    : '';
  if (existing !== overlayContents) {
    writeAtomic(overlayFile, overlayContents);
    added = !existing;
  }
  return {
    ok: true,
    added,
    present: true,
    overlayFile,
    source,
    root,
    assetRoot,
    node,
    cli,
    payloadDigest: manifest.payloadDigest,
  };
}

module.exports = {
  OFFICE_DIR_NAME,
  OFFICE_OVERLAY_FILENAME,
  PRIMARY_RUNTIME_DIRNAME,
  OFFICE_SKILLS_DIRNAME,
  OFFICE_SKILL_FOLDERS,
  KIT_PACKAGE,
  KIT_CLI_ENTRY,
  WORKSPACE_DEPENDENCIES_PACKAGE,
  SKILL_OFFICE_PACKAGE,
  requiredEnginePackage,
  officeRuntimeCandidates,
  readRuntimeManifest,
  resolveOfficeKit,
  expectedPackagedKitCli,
  officeRuntimeEnv,
  ensureDesktopOfficeRuntime,
};
